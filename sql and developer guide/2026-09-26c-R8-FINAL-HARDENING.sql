-- ═══════════════════════════════════════════════════════════════════════
-- R8 ONE-CLICK FINAL SECURITY + FINANCIAL HARDENING  (2026-09-26c)
-- Admin Panel + User Panel + Supabase — single consolidated delta.
--
-- Scope (empirically proven holes, closed here):
--   P5  users SIGNUP self-INSERT could preset coins/green/is_admin
--       (users_insert_own only checks sub=id)  →  guard_users_insert()
--   P6  clans INSERT could preset squad_bank_gd/leader/score
--       (clans_insert_auth only checks auth)   →  guard_clans_insert()
--   P4  notifications cross-target spoof / broadcast by regular user
--       (notif_insert whitelist has no relationship check) → guard_notification_insert()
--   P3c wallet pending_deposit self-insert could be absurd amount/currency
--       → fft_guard_wallet_insert tightened (currency + cap)
--   P8  admin_end_current_season NOT idempotent → season_finalizations marker
--       (+ server-side rank_points/win_streak reset folded in from Bug#97)
--   P7  admin_reward_suggestion NOT idempotent + looked up empty `suggestions`
--       → suggestion_rewards marker + user_suggestions lookup + optional p_user_id
--   P10 admin_sync_user_balance silent overwrite → audited reconciliation
--        (before/after/delta ledger rows + reason; never a blind overwrite)
--
-- Everything idempotent. All guards bypassed only by service_role / admin.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- P5: users SIGNUP self-INSERT guard — hard-reset financial/admin/status
--     columns to safe defaults for any non-service, non-admin INSERT.
--     (id must still equal the JWT caller via existing users_insert_own,
--     so a regular user can only ever mint a *fresh, zero-balance* row.)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_users_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NOT NULL AND v_caller = NEW.id THEN
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
    IF v_is_admin THEN RETURN NEW; END IF;
  END IF;

  -- Wallet / economy / status hard-reset (self-signup can never mint)
  NEW.coins          := 0;
  NEW.sky_diamonds   := 0;
  NEW.green_diamonds := 0;
  NEW.rank_points    := 0;
  NEW.total_winnings := 0;
  NEW.sponsored_winnings := 0;
  NEW.total_wins     := 0;
  NEW.total_kills    := 0;
  NEW.total_matches  := 0;
  NEW.win_streak     := 0;
  NEW.clean_matches  := 0;
  NEW.has_clean_badge := false;
  NEW.streak_days    := 0;
  NEW.last_checkin_date := NULL;
  NEW.premium_level  := 0;
  NEW.premium_expires := NULL;
  NEW.trial_used     := false;
  NEW.rp_today       := 0;
  NEW.rp_day         := NULL;
  NEW.mpm_today      := 0;
  NEW.mpm_day        := NULL;
  NEW.level          := 1;
  NEW.exp            := 0;
  NEW.rank_tier      := 'Bronze';

  -- Admin / moderation columns (self-promotion impossible)
  NEW.is_admin       := false;
  NEW.is_banned      := false;
  NEW.ban_reason     := NULL;
  NEW.is_vip         := false;
  NEW.vip_granted_at := NULL;
  NEW.vip_reason     := NULL;
  NEW.is_creator     := false;
  NEW.fraud_score    := 0;
  NEW.email_verified := false;
  NEW.is_deleted     := false;
  NEW.penalty_points := 0;
  NEW.leaderboard_hidden := false;

  -- Creator economy columns
  NEW.creator_code               := NULL;
  NEW.creator_rating             := 5.0;
  NEW.creator_rating_count       := 0;
  NEW.creator_strikes            := 0;
  NEW.creator_suspended_until    := NULL;
  NEW.creator_suspended_permanently := false;

  -- Referral / identity-verification columns
  NEW.referred_by        := NULL;
  NEW.referral_applied_at := NULL;
  NEW.age_verified       := false;
  NEW.age_verified_at    := NULL;
  NEW.fraud_checked_at   := NULL;

  -- Membership / team columns
  NEW.clan_id           := NULL;
  NEW.duo_team          := '{}'::jsonb;
  NEW.squad_team        := '{}'::jsonb;
  NEW.squad_uids        := '[]'::jsonb;
  NEW.streak_milestones_claimed := '{}'::jsonb;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_users_insert_guard ON public.users;
CREATE TRIGGER trg_users_insert_guard
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_insert();

-- ───────────────────────────────────────────────────────────────────
-- P6: clans INSERT guard — force leader=caller, zero economy for any
--     non-service, non-admin INSERT. (config fields name/tag/emblem/badge/
--     join_code/is_private stay intact; total_members forced 1.)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_clans_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'clans: authenticated callers only';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = v_caller AND COALESCE(is_admin, false)) THEN
    RETURN NEW;
  END IF;

  NEW.leader_uid             := v_caller;
  NEW.total_members          := 1;
  NEW.weekly_score           := 0;
  NEW.total_wins             := 0;
  NEW.total_kills            := 0;
  NEW.squad_bank_gd          := 0;
  NEW.squad_bank_unlocked    := '{}'::jsonb;
  NEW.squad_bank_contributors := '{}'::jsonb;
  NEW.disbanded_at           := NULL;
  NEW.status                 := 'active';

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_clans_insert_guard ON public.clans;
CREATE TRIGGER trg_clans_insert_guard
  BEFORE INSERT ON public.clans
  FOR EACH ROW EXECUTE FUNCTION public.guard_clans_insert();

-- ───────────────────────────────────────────────────────────────────
-- P4: notifications cross-target spoof guard. Regular (non-admin)
--     callers may only insert:
--       • self notifications (user_id = caller)
--       • cross-user notifications whose peer-relationship actually exists
--     Broadcast (target_all=true) and admin-typed messages stay admin-only.
--     SECDEF RPC inserts run as current_user=postgres → bypass (server path).
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_notification_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'notifications: authenticated callers only';
  END IF;
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
  IF v_is_admin THEN RETURN NEW; END IF;

  IF COALESCE(NEW.target_all, false) THEN
    RAISE EXCEPTION 'notifications: broadcast target_all is admin-only';
  END IF;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'notifications: user_id is required';
  END IF;
  IF NEW.user_id = v_caller THEN
    RETURN NEW;  -- self notification
  END IF;

  -- Cross-user: verify the peer relationship actually exists
  CASE NEW.type
    WHEN 'friend_add' THEN
      IF NOT EXISTS (
        SELECT 1 FROM friendships
        WHERE (user_a = v_caller AND user_b = NEW.user_id)
           OR (user_b = v_caller AND user_a = NEW.user_id)
      ) THEN RAISE EXCEPTION 'notifications: no friendship between caller and target'; END IF;

    WHEN 'duel_challenge','duel_accepted' THEN
      IF NOT EXISTS (
        SELECT 1 FROM duel_challenges
        WHERE (challenger_uid = v_caller AND opponent_uid = NEW.user_id)
           OR (challenger_uid = NEW.user_id AND opponent_uid = v_caller)
      ) THEN RAISE EXCEPTION 'notifications: no duel between caller and target'; END IF;

    WHEN 'mentor_request','mentor_accepted','mentor_reward' THEN
      IF NOT EXISTS (
        SELECT 1 FROM mentor_requests
        WHERE (student_uid = v_caller AND mentor_uid = NEW.user_id)
           OR (student_uid = NEW.user_id AND mentor_uid = v_caller)
      ) THEN RAISE EXCEPTION 'notifications: no mentorship between caller and target'; END IF;

    WHEN 'clan_war_challenge' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM clan_war_challenges cw
        JOIN clan_members m1 ON m1.clan_id = cw.from_clan AND m1.user_id = v_caller     AND m1.role = 'leader'
        JOIN clan_members m2 ON m2.clan_id = cw.to_clan   AND m2.user_id = NEW.user_id AND m2.role = 'leader'
      ) THEN RAISE EXCEPTION 'notifications: clan_war_challenge requires a real war challenge between the two clan leaders'; END IF;

    WHEN 'clan_cosmetic' THEN
      IF NOT EXISTS (
        SELECT 1 FROM clan_members c1
        JOIN clan_members c2 ON c1.clan_id = c2.clan_id
        WHERE c1.user_id = v_caller AND c2.user_id = NEW.user_id
      ) THEN RAISE EXCEPTION 'notifications: clan_cosmetic requires shared clan membership'; END IF;

    WHEN 'team_formed' THEN
      IF NOT EXISTS (
        SELECT 1 FROM auto_squad_queue c1
        JOIN auto_squad_queue c2 ON c1.team_id = c2.team_id
        WHERE c1.user_id = v_caller AND c2.user_id = NEW.user_id
          AND c1.team_id IS NOT NULL AND c1.status = 'matched'
      ) THEN RAISE EXCEPTION 'notifications: team_formed requires same matched auto-squad team'; END IF;

    WHEN 'squad_request' THEN
      IF NOT EXISTS (
        SELECT 1 FROM squad_finder
        WHERE user_id = NEW.user_id AND COALESCE(is_active, false)
      ) THEN RAISE EXCEPTION 'notifications: squad_request requires an active squad-finder listing'; END IF;

    ELSE
      RAISE EXCEPTION 'notifications: type % is not permitted as a client cross-user insert', NEW.type;
  END CASE;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notifications_spoof_guard ON public.notifications;
CREATE TRIGGER trg_notifications_spoof_guard
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_notification_insert();

-- RLS: add team_formed to the client-notification type whitelist (was
-- silently failing before; the relationship trigger now gates it).
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications
  FOR INSERT WITH CHECK (
    (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true)
    OR (
      (auth.jwt() ->> 'sub') IS NOT NULL
      AND (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_banned = false)
      AND type = ANY (ARRAY[
        'clan_cosmetic','clan_war_challenge','duel_accepted','duel_challenge',
        'friend_add','gift_ticket','mentor_accepted','mentor_request','mentor_reward',
        'premium','premium_request','squad_request','team_formed'
      ])
      AND char_length(COALESCE(title, '')) <= 120
      AND char_length(COALESCE(body, '')) <= 400
    )
  );

-- ───────────────────────────────────────────────────────────────────
-- P3c: pending_deposit ledger self-insert tightening — regular users may
--      only ever create their OWN pending_deposit in sky_diamonds and
--      within a sane single-transaction cap. Everything else is refused.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fft_guard_wallet_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Wallet entries sirf authenticated system path se banti hain';
  END IF;

  IF NEW.user_id = v_caller AND NEW.txn_type = 'pending_deposit' THEN
    IF NEW.currency <> 'sky_diamonds' THEN
      RAISE EXCEPTION 'pending_deposit ledger rows must be sky_diamonds';
    END IF;
    IF NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.amount > 100000 THEN
      RAISE EXCEPTION 'pending_deposit amount out of range (1..100000)';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id = v_caller AND NEW.txn_type = 'pending_withdraw' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Wallet entries (%) sirf system create kar sakta hai', NEW.txn_type;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────
-- P8: admin_end_current_season — idempotency marker + atomic
--     rank_points/win_streak reset (folded out of Bug#97's client-side,
--     non-atomic bulk update in admin-fixes-v21.js).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.season_finalizations (
  season_name text PRIMARY KEY,
  finalized_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.admin_end_current_season(p_season_name text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller      TEXT := auth.jwt() ->> 'sub';
  v_is_admin    BOOLEAN;
  v_is_service  BOOLEAN := (current_setting('role', true) = 'service_role');
  v_season_name TEXT;
  v_season_num  INT := 1;
  v_cfg         JSONB;
  u             RECORD;
  v_pos         INT := 0;
  v_score       NUMERIC;
  v_coins       INT;
  v_tier        TEXT;
  v_tier_emoji  TEXT;
  v_pos_badge   TEXT;
  v_pos_reward  TEXT;
  v_pos_emoji   TEXT;
  v_rewarded    INT := 0;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'currentSeason';
  v_season_name := COALESCE(p_season_name, (v_cfg ->> 'name'), 'Season');
  v_season_num  := COALESCE((v_cfg ->> 'seasonNum')::INT, 1);

  /* R8 P8: exactly-once finalization marker. Re-click / concurrent click
     safe — second call inserts nothing and returns already_finalized. */
  INSERT INTO season_finalizations(season_name) VALUES (v_season_name)
  ON CONFLICT (season_name) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_finalized',
                              'season', v_season_name);
  END IF;

  FOR u IN
    SELECT id,
           (COALESCE(total_wins,0)*40 + COALESCE(total_kills,0)*2
            + COALESCE(total_matches,0)*1 + COALESCE(win_streak,0)*10)::NUMERIC AS score
      FROM users
     WHERE COALESCE(total_matches,0) > 0
     ORDER BY 2 DESC, id
     LIMIT 100
  LOOP
    v_pos   := v_pos + 1;
    v_score := u.score;

    IF v_score >= 5000 THEN v_tier := 'Grandmaster'; v_tier_emoji := '🌟';
    ELSIF v_score >= 3500 THEN v_tier := 'Heroic'; v_tier_emoji := '⚔️';
    ELSIF v_score >= 2000 THEN v_tier := 'Legend'; v_tier_emoji := '👑';
    ELSIF v_score >= 1501 THEN v_tier := 'Diamond'; v_tier_emoji := '💎';
    ELSIF v_score >= 1001 THEN v_tier := 'Platinum'; v_tier_emoji := '🔷';
    ELSIF v_score >= 601 THEN v_tier := 'Gold'; v_tier_emoji := '🥇';
    ELSIF v_score >= 301 THEN v_tier := 'Silver'; v_tier_emoji := '🥈';
    ELSE v_tier := 'Bronze'; v_tier_emoji := '🏅';
    END IF;

    IF v_pos = 1 THEN
      v_pos_badge := 'Grandmaster Badge'; v_pos_reward := '🌟 Grandmaster Badge + 500🪙'; v_pos_emoji := '🌟'; v_coins := 500;
    ELSIF v_pos <= 5 THEN
      v_pos_badge := 'Legend Badge'; v_pos_reward := '👑 Legend Badge + 200🪙'; v_pos_emoji := '👑'; v_coins := 200;
    ELSIF v_pos <= 20 THEN
      v_pos_badge := 'Diamond Badge'; v_pos_reward := '💎 Diamond Badge + 100🪙'; v_pos_emoji := '💎'; v_coins := 100;
    ELSE
      v_pos_badge := 'Gold Badge'; v_pos_reward := '🥇 Gold Badge + 50🪙'; v_pos_emoji := '🥇'; v_coins := 50;
    END IF;

    UPDATE users SET coins = COALESCE(coins, 0) + v_coins WHERE id = u.id;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, created_at)
    VALUES (u.id, 'coins', 'credit', v_coins, 'season_reward', 'approved', now());

    INSERT INTO seasonal_league_history(user_id, season_name, season_num, final_tier, points, badge, reward, emoji, created_at)
    VALUES (u.id, v_season_name, v_season_num, v_tier, v_score::INT, v_pos_badge, v_pos_reward, v_pos_emoji, now());

    INSERT INTO notifications(user_id, type, title, body, is_read, created_at)
    VALUES (u.id, 'season_end', '🏆 Season Ended!',
            format('%s mein tumhara rank: #%s! %s mila!', v_season_name, v_pos::text, v_pos_reward),
            false, now());

    v_rewarded := v_rewarded + 1;
  END LOOP;

  /* R8: season reset (rank_points + win_streak) now server-side + atomic
     (previously a non-atomic bulk client UPDATE in admin-fixes-v21 Bug#97). */
  UPDATE users SET rank_points = 0, win_streak = 0, rp_today = 0;

  UPDATE app_settings
     SET value = value || jsonb_build_object('active', false),
         updated_at = now()
   WHERE key = 'currentSeason';
  UPDATE app_settings
     SET value = value || jsonb_build_object('seasonActive', 0),
         updated_at = now()
   WHERE key = 'live_config';

  RETURN jsonb_build_object('success', true, 'season', v_season_name,
                            'rewarded', v_rewarded);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────
-- P7: admin_reward_suggestion — exactly-once per suggestion + works with
--     the real user_suggestions table (legacy `suggestions` table was
--     always empty) + optional admin-supplied p_user_id.
--     reward_type: 'coins' → coins, 'real_money' → green_diamonds.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suggestion_rewards (
  suggestion_ref text PRIMARY KEY,
  user_id        text NOT NULL,
  reward_type    text NOT NULL,
  amount         numeric NOT NULL,
  currency       text NOT NULL,
  awarded_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Remove the older 3-arg overload so only the hardened 4-arg version remains.
DROP FUNCTION IF EXISTS public.admin_reward_suggestion(text, text, numeric);

CREATE OR REPLACE FUNCTION public.admin_reward_suggestion(p_key text, p_reward_type text, p_amount numeric, p_user_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller    TEXT := auth.jwt() ->> 'sub';
  v_is_admin  BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_user_id   TEXT;
  v_col       TEXT;
  v_currency  TEXT;
  v_label     TEXT;
  v_ref       TEXT;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  IF p_amount > 999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount too large');
  END IF;

  IF p_reward_type = 'real_money' THEN
    v_col := 'green_diamonds'; v_currency := 'green_diamonds'; v_label := '₹' || p_amount::text;
  ELSIF p_reward_type = 'coins' THEN
    v_col := 'coins'; v_currency := 'coins'; v_label := p_amount::text || ' coins';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reward type');
  END IF;

  /* Resolve the target user: explicit admin-supplied uid wins; otherwise
     look the suggestion up by id (user_suggestions is the live table). */
  IF p_user_id IS NOT NULL AND p_user_id <> '' THEN
    v_user_id := p_user_id;
  ELSE
    SELECT user_id INTO v_user_id FROM user_suggestions WHERE id::text = p_key LIMIT 1;
    IF v_user_id IS NULL THEN
      SELECT user_id INTO v_user_id FROM suggestions
       WHERE id::text = p_key OR user_id = p_key LIMIT 1;
    END IF;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Suggestion not found');
  END IF;

  v_ref := COALESCE(NULLIF(p_key, ''), 'uid:' || v_user_id || ':' || p_reward_type);

  /* Exactly-once: marker row is unique per suggestion ref. */
  INSERT INTO suggestion_rewards(suggestion_ref, user_id, reward_type, amount, currency, awarded_by)
  VALUES (v_ref, v_user_id, p_reward_type, p_amount, v_currency, v_caller)
  ON CONFLICT (suggestion_ref) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_rewarded');
  END IF;

  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', v_col, v_col)
    USING p_amount, v_user_id;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status, created_at)
  VALUES (v_user_id, v_currency, 'credit', p_amount, 'suggestion_reward', v_ref, 'approved', now());

  /* Align live table status (pending → rewarded-equivalent 'implemented'). */
  UPDATE user_suggestions SET status = 'implemented'
   WHERE id::text = p_key AND status IN ('pending','reviewed');
  UPDATE suggestions SET status = 'rewarded'
   WHERE (id::text = p_key OR user_id = p_key) AND status = 'pending';

  INSERT INTO notifications(user_id, type, title, body, is_read, created_at)
  VALUES (v_user_id, 'wallet_approved', '🏆 Suggestion Reward Mila!',
          format('Teri suggestion ke liye %s reward diya gaya! Shukriya!', v_label), false, now());

  RETURN jsonb_build_object('success', true, 'reward', v_label, 'user_id', v_user_id);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────
-- P10: admin_sync_user_balance — audited reconciliation instead of blind
--      overwrite. Locks the row, computes per-currency deltas, writes
--      before/after/delta ledger rows (reason = p_reason), then applies.
--      Identical values → no-op (no ledger noise). Admin/service only.
-- ═══════════════════════════════════════════════════════════════════
-- Remove the older 4-arg overload so only the hardened 5-arg version remains.
DROP FUNCTION IF EXISTS public.admin_sync_user_balance(text, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric, p_reason text DEFAULT 'admin_reconcile')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_cur record;
  v_before_coins numeric;
  v_before_sky numeric;
  v_before_green numeric;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  IF p_coins < 0 OR p_sky_diamonds < 0 OR p_green_diamonds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Balances must be non-negative');
  END IF;
  IF p_coins > 1e9 OR p_sky_diamonds > 1e9 OR p_green_diamonds > 1e9 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Balance out of sane range');
  END IF;

  SELECT coins, sky_diamonds, green_diamonds
    INTO v_before_coins, v_before_sky, v_before_green
    FROM users WHERE id = p_uid FOR UPDATE;
  IF v_before_coins IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  v_before_coins := COALESCE(v_before_coins, 0);
  v_before_sky   := COALESCE(v_before_sky, 0);
  v_before_green := COALESCE(v_before_green, 0);

  UPDATE users SET
    coins = p_coins,
    sky_diamonds = p_sky_diamonds,
    green_diamonds = p_green_diamonds
  WHERE id = p_uid;

  IF p_coins <> v_before_coins THEN
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status, created_at, description)
    VALUES (p_uid, 'coins',
            CASE WHEN p_coins > v_before_coins THEN 'reconcile_credit' ELSE 'reconcile_debit' END,
            ABS(p_coins - v_before_coins), p_reason, v_caller, 'approved', NOW(),
            'before:' || v_before_coins || ' after:' || p_coins);
  END IF;
  IF p_sky_diamonds <> v_before_sky THEN
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status, created_at, description)
    VALUES (p_uid, 'sky_diamonds',
            CASE WHEN p_sky_diamonds > v_before_sky THEN 'reconcile_credit' ELSE 'reconcile_debit' END,
            ABS(p_sky_diamonds - v_before_sky), p_reason, v_caller, 'approved', NOW(),
            'before:' || v_before_sky || ' after:' || p_sky_diamonds);
  END IF;
  IF p_green_diamonds <> v_before_green THEN
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status, created_at, description)
    VALUES (p_uid, 'green_diamonds',
            CASE WHEN p_green_diamonds > v_before_green THEN 'reconcile_credit' ELSE 'reconcile_debit' END,
            ABS(p_green_diamonds - v_before_green), p_reason, v_caller, 'approved', NOW(),
            'before:' || v_before_green || ' after:' || p_green_diamonds);
  END IF;

  RETURN jsonb_build_object('success', true,
    'before', jsonb_build_object('coins', v_before_coins, 'sky_diamonds', v_before_sky, 'green_diamonds', v_before_green),
    'after',  jsonb_build_object('coins', p_coins, 'sky_diamonds', p_sky_diamonds, 'green_diamonds', p_green_diamonds));
END;
$fn$;

-- R8: lock 5-arg overload grants mirroring the 3-arg (authenticated/service_role
--     only; never anon/PUBLIC wide-open default from CREATE).
REVOKE ALL ON FUNCTION public.join_clan(text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.join_clan(text, uuid, text, text, integer) TO anon, authenticated, service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- R8 EXTRA (same delta): attendance + balance refinements
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- P10: decrement_balance — FOR UPDATE row lock (no TOCTOU), no negative,
--      caller = own uid only. Read-then-write now race-free.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  allowed_cols TEXT[] := ARRAY['coins','green_diamonds','sky_diamonds'];
  v_balance    NUMERIC;
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL OR v_caller <> p_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized — own UID only');
    END IF;
  END IF;

  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-negative');
  END IF;
  IF NOT (p_col = ANY(allowed_cols)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Column not allowed: ' || p_col);
  END IF;

  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1 FOR UPDATE', p_col)
    USING p_uid INTO v_balance;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance',
      'balance', v_balance, 'required', p_amount);
  END IF;

  EXECUTE format(
    'UPDATE users SET %I = GREATEST(COALESCE(%I, 0) - $1, 0) WHERE id = $2',
    p_col, p_col
  ) USING p_amount, p_uid;
  RETURN jsonb_build_object('success', true, 'balance_after', v_balance - p_amount);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────
-- P1/P22: attendance is server-authoritative.
--   (a) clamp trigger now FREEZES status / checked_in / checkin_at for
--       non-admin clients (server RPCs run as postgres → bypass; admins
--       bypass; the ONLY client path left is the check_in_match RPC).
--   (b) check_in_match RPC validates the real check-in window server-side.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clamp_join_requests_client_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(is_admin,false) INTO v_is_admin FROM users WHERE id = auth.jwt() ->> 'sub';
  IF NOT COALESCE(v_is_admin,false) THEN
    -- P1: authoritative join fields are server-only.
    NEW.id             := OLD.id;
    NEW.match_id       := OLD.match_id;
    NEW.user_id        := OLD.user_id;
    NEW.status         := OLD.status;
    NEW.entry_type     := OLD.entry_type;
    NEW.entry_fee      := OLD.entry_fee;
    NEW.entry_fee_paid := OLD.entry_fee_paid;
    NEW.fee_type       := OLD.fee_type;
    NEW.mode           := OLD.mode;
    NEW.captain_uid    := OLD.captain_uid;
    NEW.squad_members  := OLD.squad_members;
    NEW.prize_earned   := OLD.prize_earned;
    NEW.placement      := OLD.placement;
    NEW.kills          := OLD.kills;
    NEW.checked_in     := OLD.checked_in;
    NEW.checkin_at     := OLD.checkin_at;
    NEW.in_room        := OLD.in_room;
    NEW.in_room_at     := OLD.in_room_at;
    NEW.attendance_status := OLD.attendance_status;
    NEW.slot_number    := OLD.slot_number;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_in_match(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid   TEXT := auth.jwt() ->> 'sub';
  v_jr    RECORD;
  v_m     RECORD;
  v_cfg   JSONB;
  v_open  INT := 30;
  v_close INT := 5;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT jr.id, jr.status, jr.checked_in, jr.user_id
    INTO v_jr
    FROM join_requests jr
   WHERE jr.match_id = p_match_id AND jr.user_id = v_uid
     FOR UPDATE;
  IF v_jr.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_joined');
  END IF;
  IF v_jr.status NOT IN ('pending','approved','joined') THEN
    RETURN jsonb_build_object('success', false, 'error', 'join_not_active');
  END IF;
  IF COALESCE(v_jr.checked_in, false) THEN
    RETURN jsonb_build_object('success', true, 'already_checked_in', true);
  END IF;

  SELECT status, scheduled_at INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_found');
  END IF;

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_open  := COALESCE((v_cfg->>'checkInOpenMins')::INT, 30);
  v_close := COALESCE((v_cfg->>'checkInCloseMins')::INT, 5);

  IF now() < (v_m.scheduled_at - (v_open  || ' minutes')::interval) THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_open_yet');
  END IF;
  IF now() >= (v_m.scheduled_at - (v_close || ' minutes')::interval) THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_closed');
  END IF;

  UPDATE join_requests
     SET checked_in = true, checkin_at = NOW()
   WHERE id = v_jr.id AND user_id = v_uid;

  RETURN jsonb_build_object('success', true);
END;
$fn$;

-- R8 EXTRA-1b (P25): matches.room_id / matches.room_password are VESTIGIAL and
--   must never hold real creds — the authoritative room credentials live in
--   match_rooms (admin-read-only RLS, populated only by creator_set_room RPC).
--   This inject-trigger guarantees NO client path (anon/authenticated, non-admin)
--   can ever populate or modify matches.room_id/room_password, so a public
--   matches SELECT can never leak a room password (they stay NULL). Column-level
--   REVOKE was rejected because table-level anon SELECT must stay (public match
--   feed uses select('*')) and PostgREST would 42501 the whole feed.
CREATE OR REPLACE FUNCTION public.guard_matches_room_secrets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(is_admin, false) INTO v_is_admin
    FROM users WHERE id = auth.jwt() ->> 'sub';
  IF COALESCE(v_is_admin, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.room_id       := NULL;
    NEW.room_password := NULL;
  ELSE
    NEW.room_id       := OLD.room_id;
    NEW.room_password := OLD.room_password;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_matches_room_secrets ON public.matches;
CREATE TRIGGER trg_matches_room_secrets
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_matches_room_secrets();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- R8 EXTRA-1c (P1/P22): confirm_in_room — attendance server-authoritative.
--   Room confirm ab RPC se; client ab in_room/in_room_at khud nahi likh
--   sakta (clamp trigger). Caller must own the join request + be in a
--   joinable status. Returns success/error (never silent).
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_in_room(p_join_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_jr  RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, user_id, status, in_room
    INTO v_jr
    FROM join_requests
   WHERE id = p_join_id
     FOR UPDATE;
  IF v_jr.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'join_not_found');
  END IF;
  IF v_jr.user_id <> v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_your_join');
  END IF;
  IF v_jr.status NOT IN ('pending','joined','checked_in') THEN
    RETURN jsonb_build_object('success', false, 'error', 'join_not_active');
  END IF;
  IF COALESCE(v_jr.in_room, false) THEN
    RETURN jsonb_build_object('success', true, 'already_in_room', true);
  END IF;

  UPDATE join_requests
     SET in_room = true, in_room_at = NOW()
   WHERE id = p_join_id AND user_id = v_uid;

  RETURN jsonb_build_object('success', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirm_in_room(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.confirm_in_room(uuid) TO anon, authenticated, service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- R8 EXTRA-2: join_clan — signature compatibility + server member-cap.
--   v30 client calls join_clan(p_user_id, p_clan_id, p_ign, p_max_members);
--   accept + ignore p_ign (server derives ign), enforce member cap from
--   p_max_members (bounded 2..50, default 50). Caller identity still JWT.
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text DEFAULT 'member'::text, p_ign text DEFAULT NULL::text, p_max_members integer DEFAULT NULL::integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_already BOOLEAN;
  v_caller  TEXT := auth.jwt() ->> 'sub';
  v_count   INT;
  v_cap     INT;
BEGIN
  -- R3 P1 FIX + R8: caller identity fail-closed; p_user_id must be caller.
  IF v_caller IS NULL OR v_caller <> p_user_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  p_role := 'member'; -- self-promotion impossible

  IF NOT EXISTS (SELECT 1 FROM clans WHERE id = p_clan_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Clan not found');
  END IF;
  IF EXISTS (SELECT 1 FROM clans WHERE id = p_clan_id AND status = 'disbanded') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clan_disbanded');
  END IF;

  SELECT COUNT(*) INTO v_count FROM clan_members WHERE clan_id = p_clan_id;
  -- Server-side cap: NEVER trust client p_max_members beyond the product
  -- ceiling (v30 MAX_MEMBERS = 10); clamp into [1..10], default 10.
  v_cap := LEAST(GREATEST(COALESCE(p_max_members, 10), 1), 10);
  IF v_count >= v_cap THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clan_full');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_user_id
  ) INTO v_already;
  IF v_already THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already in clan');
  END IF;

  IF EXISTS (SELECT 1 FROM clan_members WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_in_clan');
  END IF;

  INSERT INTO clan_members(clan_id, user_id, role) VALUES(p_clan_id, p_user_id, p_role);
  UPDATE clans SET total_members = COALESCE(total_members, 0) + 1 WHERE id = p_clan_id;
  UPDATE users SET clan_id = p_clan_id::TEXT WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already in clan');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM WHEN 'NOT_AUTHORIZED' THEN 'Not authorized' ELSE SQLERRM END);
END;
$fn$;

COMMIT;
