-- ============================================================
-- SESSION DELTA — 2026-08-24
-- 10 bugs fixed across User Panel, Admin Panel, and live Supabase DB.
-- All statements below were already applied live via Supabase MCP
-- during this session; this file is the permanent record for
-- COMPLETE_SCHEMA.sql reconciliation and for replaying on any other
-- environment.
-- ============================================================

-- ── Bug #5: Streak milestone popup re-firing + duplicate coin credit ──
-- Moved off pure-Firebase RTDB (disconnected from Supabase UD) onto a
-- proper atomic Supabase column + RPC, same FOR-UPDATE-locked pattern
-- as purchase_cosmetic.
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_milestones_claimed JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS claim_streak_milestone(integer, integer, text);
CREATE OR REPLACE FUNCTION claim_streak_milestone(p_day INTEGER, p_coins INTEGER, p_badge TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_streak INTEGER;
  v_claimed JSONB;
  v_key TEXT := 'day_' || p_day::text;
  v_new_balance NUMERIC;
  v_current_title TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF p_day IS NULL OR p_coins IS NULL OR p_coins <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_params'); END IF;

  SELECT streak_days, streak_milestones_claimed, title
    INTO v_streak, v_claimed, v_current_title
    FROM users WHERE id = v_uid FOR UPDATE;

  IF v_streak IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'user_not_found'); END IF;
  IF v_streak < p_day THEN RETURN jsonb_build_object('ok', false, 'error', 'streak_not_reached'); END IF;
  IF v_claimed ? v_key THEN RETURN jsonb_build_object('ok', true, 'already_claimed', true); END IF;

  UPDATE users
     SET streak_milestones_claimed = streak_milestones_claimed || jsonb_build_object(v_key, true),
         coins = coins + p_coins,
         title = CASE WHEN p_badge IS NOT NULL AND (title IS NULL OR title = '') THEN p_badge ELSE title END
   WHERE id = v_uid
   RETURNING coins INTO v_new_balance;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', p_coins, 'streak_milestone', p_day || '-day streak bonus');

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new_balance, 'day', p_day);
END;
$$;
REVOKE ALL ON FUNCTION claim_streak_milestone(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_streak_milestone(integer, integer, text) TO authenticated;

-- ── Bug #7: Creator match creation hard-failing on EVERY attempt ──
-- Root cause: matches.name is a GENERATED ALWAYS column (derived from
-- title); the old RPC illegally tried to INSERT into it directly,
-- guaranteed to fail every single call regardless of input. Also adds
-- first_prize/second_prize/third_prize support for creators (same
-- fields admin's own match form already has), capped at max_slots × entry_fee.
DROP FUNCTION IF EXISTS creator_create_match(text, text, text, numeric, integer, numeric, timestamptz);
CREATE OR REPLACE FUNCTION creator_create_match(
  p_title TEXT, p_mode TEXT, p_entry_type TEXT, p_entry_fee NUMERIC,
  p_max_slots INT, p_per_kill_prize NUMERIC, p_scheduled_at TIMESTAMPTZ,
  p_first_prize NUMERIC DEFAULT 0, p_second_prize NUMERIC DEFAULT 0, p_third_prize NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_is_creator BOOLEAN;
  v_prem_level INT;
  v_prem_expires TIMESTAMPTZ;
  v_open_count INT;
  v_match_id TEXT;
  v_max_fee CONSTANT NUMERIC := 50;
  v_max_slots CONSTANT INT := 100;
  v_max_open CONSTANT INT := 3;
  v_creator_ign TEXT;
  v_follower_count INT;
  v_prize_pool NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;

  SELECT is_creator, ign, premium_level, premium_expires INTO v_is_creator, v_creator_ign, v_prem_level, v_prem_expires FROM users WHERE id = v_uid;
  IF NOT COALESCE(v_is_creator, false) THEN RETURN jsonb_build_object('success', false, 'error', 'not_a_creator'); END IF;
  IF COALESCE(v_prem_level, 0) <= 0 OR v_prem_expires IS NULL OR v_prem_expires < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'premium_required');
  END IF;

  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;

  IF p_entry_type NOT IN ('coins', 'sky_diamond') THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_entry_type'); END IF;
  IF p_entry_fee IS NULL OR p_entry_fee < 1 OR p_entry_fee > v_max_fee THEN
    RETURN jsonb_build_object('success', false, 'error', 'entry_fee_out_of_range', 'max', v_max_fee);
  END IF;
  IF p_max_slots IS NULL OR p_max_slots < 2 OR p_max_slots > v_max_slots THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slot_count', 'max', v_max_slots);
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < NOW() + INTERVAL '20 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_too_soon');
  END IF;
  IF p_title IS NULL OR LENGTH(TRIM(p_title)) < 3 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_title'); END IF;

  v_prize_pool := COALESCE(p_first_prize,0) + COALESCE(p_second_prize,0) + COALESCE(p_third_prize,0);
  IF v_prize_pool > (p_max_slots * p_entry_fee) THEN
    RETURN jsonb_build_object('success', false, 'error', 'prize_exceeds_pool', 'max', p_max_slots * p_entry_fee);
  END IF;
  IF p_first_prize < 0 OR p_second_prize < 0 OR p_third_prize < 0 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_prize'); END IF;

  SELECT COUNT(*) INTO v_open_count FROM matches WHERE creator_uid = v_uid AND status IN ('upcoming', 'live');
  IF v_open_count >= v_max_open THEN RETURN jsonb_build_object('success', false, 'error', 'too_many_open_matches', 'max', v_max_open); END IF;

  v_match_id := 'cm_' || gen_random_uuid()::TEXT;

  -- NOTE: `name` intentionally NOT listed — it is a GENERATED column
  -- derived from `title` and Postgres rejects any explicit value for it.
  INSERT INTO matches (
    id, title, mode, entry_type, entry_fee, max_slots, filled_slots,
    per_kill_prize, status, scheduled_at, creator_uid, match_sub_type, created_at,
    first_prize, second_prize, third_prize, prize_pool, prize_type
  ) VALUES (
    v_match_id, TRIM(p_title), p_mode, p_entry_type, p_entry_fee, p_max_slots, 0,
    COALESCE(p_per_kill_prize, 0), 'upcoming', p_scheduled_at, v_uid, 'creator_hosted', NOW(),
    COALESCE(p_first_prize,0), COALESCE(p_second_prize,0), COALESCE(p_third_prize,0), v_prize_pool,
    CASE WHEN p_entry_type = 'coins' THEN 'coins' ELSE 'sky_diamond' END
  );

  INSERT INTO creator_matches (match_id, creator_uid, commission_pct, commission_type, commission_status, created_at)
  VALUES (v_match_id, v_uid, 25, CASE WHEN p_entry_type = 'coins' THEN 'gd' ELSE 'inr' END, 'pending', NOW());

  INSERT INTO notifications(user_id, type, title, body)
  SELECT follower_uid, 'creator_new_match',
    '🎮 ' || COALESCE(v_creator_ign, 'Creator') || ' ne naya match banaya!',
    TRIM(p_title) || ' — Entry: ' || p_entry_fee || (CASE WHEN p_entry_type='coins' THEN ' coins' ELSE ' 💎' END)
  FROM creator_follows WHERE creator_uid = v_uid;

  GET DIAGNOSTICS v_follower_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'match_id', v_match_id, 'notified_followers', v_follower_count);
END;
$$;
REVOKE ALL ON FUNCTION creator_create_match(text, text, text, numeric, integer, numeric, timestamptz, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION creator_create_match(text, text, text, numeric, integer, numeric, timestamptz, numeric, numeric, numeric) TO authenticated;

-- ── Bug #10: Realtime was effectively dead app-wide ──
-- pg_publication_tables showed ONLY app_settings was ever added to the
-- supabase_realtime publication. Every postgres_changes subscription in
-- both panels (matches, users, join_requests, notifications, polls,
-- wallet_transactions, sd_requests, sponsored_tournaments, and dozens
-- more admin-side tables) has been connecting successfully but silently
-- receiving nothing — explains the app-wide "need to refresh" feeling
-- far better than any single screen bug.
ALTER PUBLICATION supabase_realtime ADD TABLE
  matches, users, join_requests, notifications, wallet_transactions, sd_requests,
  sponsored_tournaments, polls, poll_votes, user_cosmetics, creator_matches,
  admin_actions, admin_activity_log, admin_alerts, admin_notes, admin_watchlist,
  admins, auto_squad_queue, ban_appeals, battle_pass_progress, blacklist,
  cheat_reports, city_championship, clan_members, clan_messages,
  clan_war_challenges, clan_wars, clans, coin_requests, creator_codes,
  creator_payouts, creator_stats, disputes, early_access_users, ff_uid_index,
  fraud_cases, gift_tickets, kyc_requests, leaderboard, leaderboard_archive,
  match_feedback, match_results, match_templates, mentor_profiles,
  platform_earnings, platform_stats, premium_requests, profile_requests,
  profile_updates, referrals, refund_requests, scheduled_broadcasts,
  season_pass_requests, seasonal_league_history, suggestions, support_tickets,
  tds_held, tds_records, team_requests, tournament_brackets, user_matches,
  vouchers, wallet_audit_log;

-- ============================================================
-- CLIENT-SIDE-ONLY FIXES (no DB change) — for reference:
--  #1 Cosmetics store fake-owned-until-refresh (User Panel: listeners.js, growth.js)
--  #2 Leaderboard "#1" vs "top 50 se bahar" contradiction (User Panel: growth.js)
--  #3 "Profile abhi ready nahi hai" race condition (User Panel: db.js, boot.js, profile.js)
--  #4 WhatsApp not opening — reverted broken intent:// scheme to wa.me (User Panel: utils.js)
--  #6 Green Diamond 0 in header vs correct in wallet — raw UD reassignment
--     bypassing snake_case→camelCase mapping (User Panel: listeners.js, boot.js)
--  #8 Sponsored tournaments never had a User Panel display at all — new
--     feature built (User Panel: firebase.js, listeners.js, home.js)
--  #9 Admin poll votes always showing 0 — wrong column name (`votes`
--     instead of `vote_counts`) + option-key mismatch (Admin Panel: fa26-poll-suggestion.js)
-- ============================================================

-- ============================================================
-- FOLLOW-UP PASS (same day, 2026-08-24) — "har chij turant live"
-- No new DB migrations in this pass — the 64-table realtime
-- publication above already covered everything needed. This pass was
-- entirely about making the CLIENT actually use it everywhere instead
-- of falling back to slow polling in several spots that had either no
-- realtime channel at all, or a working channel sitting alongside an
-- unnecessarily long poll interval:
--
--  User Panel (core/listeners.js):
--   - referrals: had ZERO realtime channel, 120s poll only → added a
--     live channel on referrals; poll tightened to 60s as safety net.
--   - app_settings (live_config: ticker/banner/payment info): had ZERO
--     realtime channel, 300s (5 MINUTE) poll only — the slowest path in
--     the whole app. Added a live channel; poll tightened to 60s. Also
--     removed a "!tt.textContent" guard that silently blocked any
--     ticker update after the very first one, forever.
--   - matches/sponsored/join-requests/user/notifs/wallet safety-net
--     polls tightened (30-60s → 15-30s) now that realtime is confirmed
--     doing the primary work — these just catch a rare dropped channel
--     faster.
--   - polls: had ZERO realtime channel — home poll banner and any open
--     poll modal only ever updated on-load. Added a live channel.
--
--  Admin Panel:
--   - Poll Manager modal (fa26-poll-suggestion.js): added a live
--     channel so vote counts update while the modal is open, not just
--     on reopen.
--   - Badge counts (profile/join/dispute/team-request pending counts):
--     were 30s-poll-only. Added live channels for all 5 underlying
--     tables.
--   - Tournaments/Matches list (admin-fixes-v22-FINAL.js): was
--     60s-poll-ONLY with zero realtime — the single biggest remaining
--     gap on the admin side, since Tournaments is one of the
--     most-used screens. Added live channels on matches + join_requests;
--     poll kept at 60s purely as a safety net.
--   - Bridge layer (supabase-rtdb-bridge.js)'s .on('value',...) — was
--     already genuinely realtime (not the bug), but re-fetched the
--     ENTIRE table on every single row-change event with no
--     coalescing, so a burst of several rapid changes fired several
--     overlapping full-table re-fetches. Added a 60ms debounce so a
--     burst becomes one fetch instead of N — reduces load AND latency
--     under bursty conditions (bulk admin edits, many users joining a
--     match in the same second).
-- ============================================================
