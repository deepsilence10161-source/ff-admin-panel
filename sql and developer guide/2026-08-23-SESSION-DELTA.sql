-- ============================================================
-- SESSION DELTA — 2026-08-23
-- All migrations applied live via Supabase MCP this session.
-- Already APPLIED to the live database (hddhkculuyrfoevxmlwy) —
-- this file is a record of what changed, not something that
-- still needs to be run. Kept here for COMPLETE_SCHEMA.sql
-- reconciliation and audit trail purposes.
-- ============================================================

-- ── Bug #3: Monthly Premium Bonus re-crediting on every refresh ──
-- Root cause: "already claimed this month" check lived on a fake
-- Firebase-bridge path with no matching case in db-bridge.js — both
-- read and write silently no-op'd. Real, atomically-enforced home:
CREATE TABLE IF NOT EXISTS public.premium_monthly_bonus_claims (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES public.users(id),
  month_key   TEXT NOT NULL,   -- 'YYYY-MM'
  tier        INT NOT NULL,
  bonus_coins INT NOT NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, month_key)
);
ALTER TABLE public.premium_monthly_bonus_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmbc_select_own ON public.premium_monthly_bonus_claims
  FOR SELECT USING ((auth.jwt() ->> 'sub') = user_id OR is_caller_admin());
CREATE POLICY pmbc_insert_own ON public.premium_monthly_bonus_claims
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
GRANT SELECT, INSERT ON public.premium_monthly_bonus_claims TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.premium_monthly_bonus_claims_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_premium_monthly_bonus(p_tier INT, p_bonus_coins INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_month TEXT := to_char(NOW(), 'YYYY-MM');
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF p_tier NOT IN (1,2,3) OR p_bonus_coins <= 0 OR p_bonus_coins > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;
  BEGIN
    INSERT INTO premium_monthly_bonus_claims(user_id, month_key, tier, bonus_coins)
    VALUES (v_uid, v_month, p_tier, p_bonus_coins);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
  END;
  UPDATE users SET coins = COALESCE(coins,0) + p_bonus_coins WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', p_bonus_coins, 'premium_bonus', 'Monthly Premium Bonus Tier ' || p_tier);
  RETURN jsonb_build_object('ok', true, 'bonus', p_bonus_coins, 'month', v_month);
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(INT, INT) TO authenticated;

-- ── Bug #5: bogus duplicate "Entry Fee" transaction after SD approval ──
-- Data cleanup (one-time, code fix in admin-inline.js prevents recurrence):
-- DELETE FROM wallet_transactions WHERE id = '61834682-b8e4-4230-b8b2-4b15b17f737d';
-- (Already executed live this session.)

-- ── Bug #6: orphaned clan_id pointing at a non-existent clan ──
UPDATE users SET clan_id = NULL
WHERE clan_id IS NOT NULL AND clan_id NOT IN (SELECT id::text FROM clans);
-- (Already executed live this session — affected 1 user.)

-- ── Bug #7: Cosmetics Store "unlock ho gaya" but nothing unlocks ──
CREATE OR REPLACE FUNCTION public.purchase_cosmetic(p_cosmetic_key TEXT, p_price INT, p_display_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_balance NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF p_cosmetic_key IS NULL OR p_price IS NULL OR p_price <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;
  IF EXISTS (SELECT 1 FROM user_cosmetics WHERE user_id = v_uid AND cosmetic_key = p_cosmetic_key) THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true);
  END IF;
  SELECT sky_diamonds INTO v_balance FROM users WHERE id = v_uid FOR UPDATE;
  IF v_balance IS NULL OR v_balance < p_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance');
  END IF;
  UPDATE users SET sky_diamonds = sky_diamonds - p_price WHERE id = v_uid;
  INSERT INTO user_cosmetics(user_id, cosmetic_key, purchased_at) VALUES (v_uid, p_cosmetic_key, NOW());
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'sky_diamonds', 'debit', p_price, 'cosmetic_purchase', COALESCE(p_display_name, p_cosmetic_key));
  RETURN jsonb_build_object('ok', true, 'new_balance', v_balance - p_price);
END; $$;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(TEXT, INT, TEXT) TO authenticated;
-- NOTE: one pre-existing purchase (Fire Frame, user TyHtzFOnggMxWbEdTnTdEl2j7oF3)
-- was left uncharged rather than retroactively deducted — the failed
-- deduction was a platform bug, not user error. Cosmetic itself was
-- already legitimately unlocked in the DB before this session.

-- ── Bug #11: banner_url column missing entirely ──
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- ── Bug #12: squad_uids column missing entirely ──
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS squad_uids JSONB DEFAULT '[]'::jsonb;
-- (duo_team, squad_team, partner_uid already existed — bridge was
-- writing to wrong camelCase names for these; see db-bridge.js fix.)

-- ── Bug #13: sponsored_tournaments missing columns + no dedicated bridge converter ──
ALTER TABLE public.sponsored_tournaments ADD COLUMN IF NOT EXISTS prizes JSONB;
ALTER TABLE public.sponsored_tournaments ADD COLUMN IF NOT EXISTS match_id TEXT;
ALTER TABLE public.sponsored_tournaments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.sponsored_tournaments ADD COLUMN IF NOT EXISTS prize_distributed BOOLEAN DEFAULT false;
-- (title, sponsor_name, prize_pool already existed — client was sending
-- name/sponsor/prizePool, none of which matched; see supabase-rtdb-bridge.js
-- new sponsoredTournamentToSupa/FromSupa converter.)

-- ── Bug #15: poll voting had zero duplicate-vote protection ──
-- Discovered poll_votes ALREADY existed (id uuid, poll_id, user_id,
-- option, option_idx, created_at, UNIQUE(poll_id,user_id)) but
-- increment_poll_vote never used it. Rewrote as cast_poll_vote:
CREATE OR REPLACE FUNCTION public.cast_poll_vote(p_poll_id UUID, p_option TEXT, p_option_idx INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT status INTO v_status FROM polls WHERE id = p_poll_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found'); END IF;
  IF v_status != 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'poll_closed'); END IF;
  BEGIN
    INSERT INTO poll_votes(poll_id, user_id, option, option_idx) VALUES (p_poll_id, v_uid, p_option, p_option_idx);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_voted');
  END;
  UPDATE polls SET vote_counts = jsonb_set(COALESCE(vote_counts,'{}'::jsonb), ARRAY[p_option],
    to_jsonb(COALESCE((vote_counts->>p_option)::int,0) + 1)), total_votes = COALESCE(total_votes,0) + 1
  WHERE id = p_poll_id;
  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(UUID, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_poll_vote(p_poll_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT option FROM poll_votes WHERE poll_id = p_poll_id AND user_id = (auth.jwt() ->> 'sub') LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_poll_vote(UUID) TO authenticated;

-- ============================================================
-- IMPORTANT — Firebase Realtime Database rules (Bug #17):
-- admin/firebase-rules.json was updated (deviceJoins root .read added)
-- but this does NOT auto-deploy. Must be manually published:
--   Firebase Console → Realtime Database → Rules tab → paste → Publish
-- ============================================================
