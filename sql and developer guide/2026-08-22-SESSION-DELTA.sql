-- ═══════════════════════════════════════════════════════════════════
-- MINI eSPORTS — SESSION DELTA — 2026-08-22
-- Every one of these statements was run LIVE against Supabase
-- (project hddhkculuyrfoevxmlwy) during this session via the Supabase
-- MCP. This file is the complete, re-runnable record — if the DB ever
-- needs to be rebuilt or a change needs to be re-applied, running this
-- file top to bottom reproduces exactly what was done live.
-- All statements are IF-EXISTS / ON-CONFLICT safe to re-run.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- 1. NEW RPC: cancel_match_with_refunds — CRITICAL money bug fix.
--    Admin Panel's deleteTournament() refund logic previously wrote to
--    fake Firebase-style paths (realMoney/deposited) that don't map to
--    any real column — refund silently no-op'd, money vanished on
--    match delete with zero error. This RPC refunds each joiner's
--    ACTUAL entry_fee_paid to the correct currency column, atomically,
--    with a wallet_transactions log entry + notification per player.
--    Called from: admin-panel/js/security-patches.js
--    patchDeleteTournament().
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_match_with_refunds(p_match_id TEXT, p_admin_uid TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_jr RECORD;
  v_refund_count INT := 0;
  v_currency TEXT;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;

  FOR v_jr IN
    SELECT * FROM join_requests
    WHERE match_id = p_match_id
      AND status NOT IN ('cancelled', 'refunded', 'rejected')
      AND COALESCE(entry_fee_paid, 0) > 0
    FOR UPDATE
  LOOP
    v_currency := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

    IF v_currency = 'coins' THEN
      UPDATE users SET coins = COALESCE(coins,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    ELSE
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    END IF;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
    VALUES (v_jr.user_id, v_currency, 'credit', v_jr.entry_fee_paid, 'match_cancelled_refund', p_match_id, 'approved');

    UPDATE join_requests SET status = 'refunded' WHERE id = v_jr.id;

    INSERT INTO notifications(user_id, title, body, type, is_read, created_at, ref_id)
    VALUES (
      v_jr.user_id,
      '💰 Match Cancelled — Refund',
      '"' || COALESCE(v_match.name, v_match.title, p_match_id) || '" cancel ho gaya. Aapka entry fee wapas kar diya gaya hai.',
      'refund', false, NOW(), p_match_id
    );

    v_refund_count := v_refund_count + 1;
  END LOOP;

  UPDATE join_requests
  SET status = 'cancelled'
  WHERE match_id = p_match_id AND status NOT IN ('cancelled', 'refunded', 'rejected');

  UPDATE matches SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = p_admin_uid WHERE id = p_match_id;

  RETURN jsonb_build_object('ok', true, 'refund_count', v_refund_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_match_with_refunds(TEXT, TEXT) TO authenticated, anon;


-- ───────────────────────────────────────────────────────────────────
-- 2. leaderboard_hidden — durable, race-free leaderboard exclusion.
--    Root cause fixed: sync_leaderboard() trigger only removed a row on
--    is_banned/ign IS NULL, so a manual `DELETE FROM leaderboard` got
--    silently undone the next time ANY watched column changed on that
--    user (coins, city, rank_points, etc — unrelated to visibility).
--    Confirmed live as a leaderboard row ("Team Wolf" / #7) flickering
--    back after manual removal.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT false;

-- ✅ FIXED (2026-09-16, live on Supabase project hddhkculuyrfoevxmlwy):
-- this CREATE OR REPLACE dropped SECURITY DEFINER, which the original
-- COMPLETE_SCHEMA.sql definition of this same function always had (see
-- that file's own sync_leaderboard() block). Without SECURITY DEFINER
-- this trigger runs with the CALLING USER's own RLS permissions —
-- meaning any normal player updating their own avatar_url/etc (which
-- fires this trigger, see the UPDATE OF list two blocks below) hit
-- "new row violates row-level security policy for table 'leaderboard'
-- [42501]" on the trigger's own INSERT, because lb_admin_write only
-- lets admins write to leaderboard. Confirmed live: avatar_url updates
-- failed with exactly this error while banner_url updates (not in this
-- trigger's UPDATE OF column list, so it never touched this function at
-- all) succeeded — that asymmetry is what made this traceable. Restored
-- SECURITY DEFINER below so the trigger runs with the function owner's
-- privileges again, bypassing RLS as originally intended.
CREATE OR REPLACE FUNCTION public.sync_leaderboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_banned = true OR NEW.ign IS NULL OR NEW.leaderboard_hidden = true THEN
    DELETE FROM leaderboard WHERE id = NEW.id;
  ELSE
    INSERT INTO leaderboard (id, ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches, updated_at)
    VALUES (NEW.id, NEW.ign, NEW.avatar_url, NEW.city, NEW.ff_uid, NEW.rank_points, NEW.total_wins, NEW.total_kills, NEW.total_matches, NOW())
    ON CONFLICT (id) DO UPDATE SET
      ign=EXCLUDED.ign, avatar_url=EXCLUDED.avatar_url, city=EXCLUDED.city, ff_uid=EXCLUDED.ff_uid,
      rank_points=EXCLUDED.rank_points, total_wins=EXCLUDED.total_wins,
      total_kills=EXCLUDED.total_kills, total_matches=EXCLUDED.total_matches, updated_at=NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- ⚠️ IMPORTANT — this second step is NOT optional. A trigger declared
-- with `UPDATE OF <columns>` only fires when one of the LISTED columns
-- actually changes. The first version of this fix (applied earlier in
-- this same session) updated the function body above but forgot to add
-- leaderboard_hidden to this list — meaning the Admin Panel's new "Hide
-- from Leaderboard" toggle button silently did nothing on its own
-- (since it changes ONLY that one column). Caught and corrected live,
-- same session, before delivery. If you ever add another
-- exclusion-style boolean column that this trigger's function body
-- checks, it must ALSO be added here.
DROP TRIGGER IF EXISTS trg_sync_leaderboard ON users;
CREATE TRIGGER trg_sync_leaderboard
  AFTER INSERT OR UPDATE OF ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches, is_banned, leaderboard_hidden
  ON users FOR EACH ROW EXECUTE FUNCTION sync_leaderboard();


-- ───────────────────────────────────────────────────────────────────
-- 3. claim_battle_pass_tier — dropped duplicate overload + gated the
--    FREE track behind Season Pass purchase (previously only PREMIUM
--    track checked has_premium; FREE track had zero gating anywhere,
--    client or server — a player could claim free-track rewards like
--    5 GD at Tier 1 without ever buying the pass).
--    The duplicate-overload drop fixes "could not choose the best
--    candidate function between ... integer ... numeric" on every
--    single claim attempt (confirmed live via screenshot).
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward integer);

CREATE OR REPLACE FUNCTION claim_battle_pass_tier(
  p_season    TEXT,
  p_tier      INT,
  p_track     TEXT,   -- 'free' | 'prem'
  p_gd_reward NUMERIC DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_claimed JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_track NOT IN ('free','prem') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid track');
  END IF;
  IF p_gd_reward < 0 OR p_gd_reward > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reward amount');
  END IF;

  SELECT * INTO v_row FROM battle_pass_progress
  WHERE user_id = v_uid AND season_key = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No battle pass progress found');
  END IF;
  IF v_row.current_tier < p_tier THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tier not reached yet');
  END IF;
  -- ✅ CHANGED: now gates BOTH tracks (was: only p_track='prem')
  IF NOT COALESCE(v_row.has_premium, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season Pass nahi khareeda — pehle purchase karo');
  END IF;

  v_claimed := CASE p_track WHEN 'free' THEN COALESCE(v_row.claimed_free,'{}'::JSONB)
                            ELSE COALESCE(v_row.claimed_prem,'{}'::JSONB) END;
  IF v_claimed ? p_tier::TEXT THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  IF p_gd_reward > 0 THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + p_gd_reward WHERE id = v_uid;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_uid, 'green_diamonds', 'credit', p_gd_reward, 'battle_pass_tier_claim', p_season || ':' || p_tier || ':' || p_track);
  END IF;

  IF p_track = 'free' THEN
    UPDATE battle_pass_progress SET claimed_free = claimed_free || jsonb_build_object(p_tier::TEXT, true)
    WHERE user_id = v_uid AND season_key = p_season;
  ELSE
    UPDATE battle_pass_progress SET claimed_prem = claimed_prem || jsonb_build_object(p_tier::TEXT, true)
    WHERE user_id = v_uid AND season_key = p_season;
  END IF;

  RETURN jsonb_build_object('success', true, 'tier', p_tier, 'track', p_track, 'gd', p_gd_reward);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION claim_battle_pass_tier(TEXT, INT, TEXT, NUMERIC) TO authenticated, service_role;


-- ───────────────────────────────────────────────────────────────────
-- 4. Verification queries run this session (read-only, informational —
--    no schema effect, included here for the record / re-check).
-- ───────────────────────────────────────────────────────────────────
-- Confirmed wallet_transactions has NO `timestamp` column (only
-- created_at) — root cause of the Sky Diamond approval error was fixed
-- purely in the Admin Panel's JS bridge converter (supabase-rtdb-
-- bridge.js), not a DB change. See DEVELOPER_GUIDE.md session entry
-- 2026-08-22 §12 for the full explanation.
--
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name='wallet_transactions' ORDER BY ordinal_position;

-- ═══════════════════════════════════════════════════════════════════
-- End of 2026-08-22 session delta.
-- Summary: 1 new RPC (cancel_match_with_refunds), 1 new column
-- (users.leaderboard_hidden), 1 trigger function + trigger definition
-- replaced (sync_leaderboard — two-part fix, see §2 note above), 1 RPC
-- replaced + 1 duplicate overload dropped (claim_battle_pass_tier).
-- ═══════════════════════════════════════════════════════════════════
