-- =====================================================================
-- 2026-09-22e — R29E AUDIT-FIXES DELTA (report.txt 2026-09-22, P0 + P1)
-- =====================================================================
-- Scope: user ke audit report (uploads/report.txt, 1530 lines) ke
-- P0 (launch-blocker) aur P1 items ka fix. Har change ko LIVE Supabase
-- par apply karke verify kiya gaya (SQL-Mgmt API, current_user=postgres).
--
-- ALL APPLIED LIVE. Ye file = live-state ka documented record (idempotent
-- re-run safe: CREATE OR REPLACE / DROP IF EXISTS / COMMENT ON).
-- ---------------------------------------------------------------------

-- ═══ P0-1: reward_store_items RLS (was DISABLED live) ═══
ALTER TABLE public.reward_store_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rsi_read_all ON public.reward_store_items;
CREATE POLICY rsi_read_all ON public.reward_store_items
  FOR SELECT USING (true);
-- (write path keval postgres/service_role ke paas hai — anon/authenticated
--  ke paas pehle se sirf SELECT grant tha; verified live: INSERT/UPDATE/
--  DELETE as anon = 42501.)

-- ═══ P0-2: release_creator_commission authorization flaw ═══
-- Purana body sirf auth maangta tha — koi bhi caller kisi bhi creator ka
-- locked_commission release kar sakta tha. Ab service/admin/self-only +
-- anon REVOKED (koi live client caller nahi tha).
CREATE OR REPLACE FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
    END IF;
    IF v_caller <> p_creator_uid THEN
      SELECT COALESCE(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT v_is_admin THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
      END IF;
    END IF;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;
  UPDATE creator_stats SET
    locked_commission = GREATEST(locked_commission - p_amount, 0),
    total_commission = total_commission + p_amount,
    pending_payout = pending_payout + p_amount,
    updated_at = NOW()
  WHERE user_id = p_creator_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator stats row not found');
  END IF;
  RETURN jsonb_build_object('success', true, 'released', p_amount);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.release_creator_commission(text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_creator_commission(text,numeric) TO authenticated, service_role;

-- ═══ P0-3: hosted commission hardcoded 25% → admin config ═══
-- creator_create_match me commission_pct ab creator_system config se:
-- coin-match → coinMatchCommissionPct (10), SD-match → sdMatchCommissionPct (15).
CREATE OR REPLACE FUNCTION public.creator_create_match(
  p_title text, p_mode text, p_entry_type text, p_entry_fee numeric,
  p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamptz,
  p_first_prize numeric DEFAULT 0, p_second_prize numeric DEFAULT 0, p_third_prize numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  v_comm_pct NUMERIC;
  v_prize_pool NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT is_creator, ign, premium_level, premium_expires INTO v_is_creator, v_creator_ign, v_prem_level, v_prem_expires FROM users WHERE id = v_uid;
  IF NOT COALESCE(v_is_creator, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_creator');
  END IF;
  IF COALESCE(v_prem_level, 0) <= 0 OR v_prem_expires IS NULL OR v_prem_expires < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'premium_required');
  END IF;
  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;
  IF p_entry_type NOT IN ('coins', 'sky_diamond') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_entry_type');
  END IF;
  IF p_entry_fee IS NULL OR p_entry_fee < 1 OR p_entry_fee > v_max_fee THEN
    RETURN jsonb_build_object('success', false, 'error', 'entry_fee_out_of_range', 'max', v_max_fee);
  END IF;
  IF p_max_slots IS NULL OR p_max_slots < 2 OR p_max_slots > v_max_slots THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slot_count', 'max', v_max_slots);
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < NOW() + INTERVAL '20 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_too_soon');
  END IF;
  IF p_title IS NULL OR LENGTH(TRIM(p_title)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_title');
  END IF;
  v_prize_pool := COALESCE(p_first_prize,0) + COALESCE(p_second_prize,0) + COALESCE(p_third_prize,0);
  IF v_prize_pool > (p_max_slots * p_entry_fee) THEN
    RETURN jsonb_build_object('success', false, 'error', 'prize_exceeds_pool', 'max', p_max_slots * p_entry_fee);
  END IF;
  IF p_first_prize < 0 OR p_second_prize < 0 OR p_third_prize < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_prize');
  END IF;
  SELECT COUNT(*) INTO v_open_count FROM matches WHERE creator_uid = v_uid AND status IN ('upcoming', 'live');
  IF v_open_count >= v_max_open THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many_open_matches', 'max', v_max_open);
  END IF;
  v_match_id := 'cm_' || gen_random_uuid()::TEXT;
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
  /* R29E P0-FIX: hosted commission admin-config se (coin 10% / SD 15%),
     hardcoded 25% nahi. commission_type + currency IN-sync:
     coin-match → 'gd' (green_diamonds, non-withdrawable, finalize me
     immediately credit hota hai); SD-match → 'inr' ledger (payout path). */
  v_comm_pct := CASE WHEN p_entry_type = 'coins'
    THEN COALESCE((SELECT (value->>'coinMatchCommissionPct')::numeric FROM app_settings WHERE key='creator_system' LIMIT 1), 10)
    ELSE COALESCE((SELECT (value->>'sdMatchCommissionPct')::numeric FROM app_settings WHERE key='creator_system' LIMIT 1), 15)
  END;
  INSERT INTO creator_matches (match_id, creator_uid, commission_pct, commission_type, commission_status, created_at)
  VALUES (v_match_id, v_uid, v_comm_pct, CASE WHEN p_entry_type = 'coins' THEN 'gd' ELSE 'inr' END, 'pending', NOW());
  INSERT INTO notifications(user_id, type, title, body)
  SELECT follower_uid, 'creator_new_match',
    '🎮 ' || COALESCE(v_creator_ign, 'Creator') || ' ne naya match banaya!',
    TRIM(p_title) || ' — Entry: ' || p_entry_fee || (CASE WHEN p_entry_type='coins' THEN ' coins' ELSE ' 💎' END)
  FROM creator_follows WHERE creator_uid = v_uid;
  GET DIAGNOSTICS v_follower_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'match_id', v_match_id, 'notified_followers', v_follower_count);
END;
$function$;

-- ═══ P0-4: SD hosted commission currency 'coins'/'pending' → 'inr'/'hold' ═══
-- finalize_creator_commission(text,boolean) ke SD-branch me galat ledger fix.
CREATE OR REPLACE FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_creator_uid   TEXT;
  v_comm_pct      NUMERIC;
  v_comm_type     TEXT;
  v_total_entry   NUMERIC;
  v_commission    NUMERIC;
  v_hold_days     INT;
  v_eligible_at   TIMESTAMPTZ;
  v_hold_until    TIMESTAMPTZ;
  v_caller        TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF NOT COALESCE(p_internal, false) THEN
    IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
      RAISE EXCEPTION 'finalize sirf system/admin kar sakta hai';
    END IF;
  END IF;
  SELECT creator_uid, commission_pct, commission_type
  INTO v_creator_uid, v_comm_pct, v_comm_type
  FROM creator_matches
  WHERE match_id = p_match_id AND commission_status = 'pending';
  IF v_creator_uid IS NULL THEN RETURN; END IF;
  SELECT hold_until INTO v_hold_until FROM creator_matches WHERE match_id = p_match_id;
  SELECT COALESCE(SUM(entry_fee_paid), 0) INTO v_total_entry
  FROM join_requests
  WHERE match_id = p_match_id
    AND status NOT IN ('no_show','refunded','cancelled','rejected');
  v_commission := ROUND(v_total_entry * v_comm_pct / 100, 2);
  SELECT COALESCE((value->>'commissionHoldDays')::INT, 7)
  INTO v_hold_days
  FROM app_settings WHERE key = 'creator_system' LIMIT 1;
  IF v_hold_days IS NULL THEN v_hold_days := 7; END IF;
  v_eligible_at := COALESCE(v_hold_until, NOW() + (v_hold_days || ' days')::INTERVAL);
  IF v_comm_type = 'gd' THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_commission
    WHERE id = v_creator_uid;
    INSERT INTO wallet_transactions(user_id, txn_type, amount, currency, reason, created_at)
    VALUES (v_creator_uid, 'credit', v_commission, 'green_diamonds', 'creator_coin_match_commission', NOW());
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'gd', 'eligible', NOW());
    UPDATE creator_matches SET commission_status = 'finalized' WHERE match_id = p_match_id;
  ELSE
    /* R29E P0-FIX: SD hosted commission ab 'inr' + 'hold' (payout path). */
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'inr', 'hold', v_eligible_at);
    UPDATE creator_matches SET commission_status = 'locked' WHERE match_id = p_match_id;
  END IF;
END;
$function$;

-- bare overload ab admin-checked boolean overload ko delegate karta hai
CREATE OR REPLACE FUNCTION public.finalize_creator_commission(p_match_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.finalize_creator_commission(p_match_id, false);
END;
$function$;

-- ═══ P0-5: submit_gd_withdrawal refuse (GD non-withdrawable economy) ═══
CREATE OR REPLACE FUNCTION public.submit_gd_withdrawal(p_gd_amount numeric, p_amount_inr numeric, p_upi text, p_notes text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('ok', false, 'error', 'Green Diamonds withdrawal nahi hai — GD non-withdrawable hai. Sponsored winnings hi withdraw ho sakti hai.');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.submit_gd_withdrawal(numeric,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_gd_withdrawal(numeric,numeric,text,text) TO authenticated, service_role;

-- ═══ P0-8 grants drift: orphan financial RPCs — anon revoke + guards ═══
-- increment_season_stats: ZERO guard tha (koi bhi kisi ke stats badha sakta tha)
CREATE OR REPLACE FUNCTION public.increment_season_stats(
  p_month_key text, p_user_id text, p_ign text DEFAULT NULL::text,
  p_display_name text DEFAULT NULL::text, p_profile_image text DEFAULT NULL::text,
  p_wins numeric DEFAULT 0, p_kills numeric DEFAULT 0, p_matches numeric DEFAULT 0)
RETURNS season_stats
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  result season_stats;
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'not_authenticated';
    END IF;
    IF v_caller <> p_user_id THEN
      SELECT COALESCE(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT v_is_admin THEN
        RAISE EXCEPTION 'admin_only';
      END IF;
    END IF;
  END IF;
  INSERT INTO season_stats (month_key, user_id, ign, display_name, profile_image, wins, kills, matches, points, updated_at)
  VALUES (p_month_key, p_user_id, COALESCE(p_ign,''), COALESCE(p_display_name,''), COALESCE(p_profile_image,''),
          p_wins, p_kills, p_matches, (p_wins*50 + p_kills*5 + p_matches*10), NOW())
  ON CONFLICT (month_key, user_id) DO UPDATE SET
    ign = COALESCE(NULLIF(p_ign,''), season_stats.ign),
    display_name = COALESCE(NULLIF(p_display_name,''), season_stats.display_name),
    profile_image = COALESCE(NULLIF(p_profile_image,''), season_stats.profile_image),
    wins = season_stats.wins + p_wins,
    kills = season_stats.kills + p_kills,
    matches = season_stats.matches + p_matches,
    points = (season_stats.wins + p_wins)*50 + (season_stats.kills + p_kills)*5 + (season_stats.matches + p_matches)*10,
    updated_at = NOW()
  RETURNING * INTO result;
  RETURN result;
END;
$function$;

-- lock_creator_commission: koi bhi caller kisi creator ka lock badha sakta tha
CREATE OR REPLACE FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
    END IF;
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT v_is_admin THEN
      RETURN jsonb_build_object('success', false, 'error', 'admin_only');
    END IF;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id = p_creator_uid AND is_creator = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a valid creator');
  END IF;
  INSERT INTO creator_stats(user_id, total_sales, locked_commission)
  VALUES(p_creator_uid, 1, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    total_sales = creator_stats.total_sales + 1,
    locked_commission = creator_stats.locked_commission + p_amount,
    updated_at = NOW();
  RETURN jsonb_build_object('success', true, 'locked', p_amount);
END;
$function$;

-- ═══ P0-9: SECURITY DEFINER public views — documented-intent markers ═══
COMMENT ON VIEW public.referral_leaderboard IS
  'Intentionally security_invoker=false — reviewed 2026-09-22 (R29E). referrals SELECT RLS is own-row-only by design, so this view must run as owner to aggregate across all users for the leaderboard; only referrer_id/ign/avatar_url/count are exposed, sourced from user_public_profiles rather than the base users table.';
COMMENT ON VIEW public.active_matches IS
  'Intentionally security_invoker=true — reviewed 2026-09-22 (R29E). Matches table policy matches_select_all is USING(true) (fully public catalog by design), so invoker-style is a pure no-op alignment; view honors base-table RLS rather than owner privileges.';

-- ═══ P1: bundle approval atomic (Premium + Battle Pass) ═══
-- approve_premium 3-arg overload DROP (ambiguity PGRST203 root cause).
DROP FUNCTION IF EXISTS public.approve_premium(text, integer, integer);
CREATE OR REPLACE FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer DEFAULT 30, p_grant_bp boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_current_expires TIMESTAMPTZ;
  v_user_exists BOOLEAN;
  v_bp_granted BOOLEAN := false;
  v_season TEXT;
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
  IF p_tier NOT IN (1,2,3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;
  SELECT true, premium_expires INTO v_user_exists, v_current_expires FROM users WHERE id = p_uid;
  IF NOT COALESCE(v_user_exists, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  UPDATE users SET
    premium_level = p_tier,
    premium_expires = GREATEST(COALESCE(v_current_expires, NOW()), NOW()) + (p_days || ' days')::INTERVAL
  WHERE id = p_uid;
  IF p_grant_bp THEN
    SELECT season_key INTO v_season FROM battle_passes
      WHERE is_active = true ORDER BY start_date DESC LIMIT 1;
    IF v_season IS NULL THEN
      v_season := to_char(now(), 'YYYY_MM');
    END IF;
    INSERT INTO battle_pass_progress (user_id, season_key, has_premium)
    VALUES (p_uid, v_season, true)
    ON CONFLICT (user_id, season_key) DO UPDATE SET has_premium = true, updated_at = NOW();
    v_bp_granted := true;
  END IF;
  RETURN jsonb_build_object('success', true, 'tier', p_tier, 'days', p_days,
                            'battlePass', v_bp_granted, 'season', v_season);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.approve_premium(text,integer,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_premium(text,integer,integer,boolean) TO anon, authenticated, service_role;

-- ═══ P1: remove legacy claim_creator_payout() ═══
DROP FUNCTION IF EXISTS public.claim_creator_payout();

-- ═══ P1: unify creator commission ledger ═══
-- validate_and_join_match referral commission currency sky_diamonds → inr
CREATE OR REPLACE FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_balance      NUMERIC;
  v_joined       BOOLEAN := false;
  v_jr_id        UUID;
  v_max_slots    INT;
  v_filled_slots INT;
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_creator_code TEXT;
  v_creator_uid  TEXT;
  v_commission   NUMERIC;
  v_commission_pct NUMERIC;
  v_match_creator TEXT;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  SELECT creator_uid INTO v_match_creator FROM matches WHERE id = p_match_id;
  IF v_match_creator IS NOT NULL AND v_match_creator = p_uid THEN
    RAISE EXCEPTION 'SELF_PLAY_BLOCKED';
  END IF;
  IF COALESCE((SELECT is_banned FROM users WHERE id = p_uid), false) THEN
    RAISE EXCEPTION 'ACCOUNT_BANNED';
  END IF;
  IF p_currency = 'coins' THEN
    SELECT coins INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
  ELSE
    SELECT sky_diamonds INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
  END IF;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_entry_fee > 0 AND v_balance < p_entry_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM join_requests
    WHERE user_id = p_uid AND match_id = p_match_id
      AND status NOT IN ('cancelled','refunded','no_show')
  ) INTO v_joined;
  IF v_joined THEN RAISE EXCEPTION 'ALREADY_JOINED'; END IF;
  SELECT COALESCE(max_slots, 999), COALESCE(filled_slots, 0)
  INTO v_max_slots, v_filled_slots
  FROM matches WHERE id = p_match_id;
  IF v_max_slots IS NOT NULL AND v_filled_slots >= v_max_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;
  IF p_entry_fee > 0 THEN
    IF p_currency = 'coins' THEN
      UPDATE users SET coins = coins - p_entry_fee WHERE id = p_uid;
    ELSE
      UPDATE users SET sky_diamonds = sky_diamonds - p_entry_fee WHERE id = p_uid;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(p_uid, p_currency, 'debit', p_entry_fee, 'match_entry', p_match_id);
  END IF;
  INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, ign_at_join, mode)
  VALUES(
    p_uid, p_match_id, p_entry_fee,
    CASE WHEN p_currency='coins' THEN 'coin' ELSE 'sky_diamond' END,
    'joined',
    COALESCE(p_join_data->>'ign', ''),
    COALESCE(p_join_data->>'mode', 'solo')
  ) RETURNING id INTO v_jr_id;
  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + 1 WHERE id = p_match_id;
  IF p_currency <> 'coins' AND p_entry_fee > 0 THEN
    SELECT creator_code INTO v_creator_code FROM users WHERE id = p_uid;
    IF v_creator_code IS NOT NULL THEN
      SELECT user_id INTO v_creator_uid FROM creator_codes WHERE code = v_creator_code;
      IF v_creator_uid IS NOT NULL AND v_creator_uid <> p_uid
         AND EXISTS(SELECT 1 FROM users WHERE id = v_creator_uid AND is_creator = true) THEN
        SELECT COALESCE((value->>'sdMatchCommissionPct')::numeric, 15)
        INTO v_commission_pct
        FROM app_settings WHERE key = 'creator_system';
        v_commission_pct := COALESCE(v_commission_pct, 15);
        v_commission := ROUND(p_entry_fee * v_commission_pct / 100, 2);
        INSERT INTO creator_stats(user_id, total_matches, total_earnings)
        VALUES (v_creator_uid, 1, v_commission)
        ON CONFLICT (user_id) DO UPDATE SET
          total_matches = creator_stats.total_matches + 1,
          total_earnings = creator_stats.total_earnings + v_commission,
          updated_at = NOW();
        /* R29E P1-FIX: referral SD commission ab 'inr' (payout path). */
        INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
        VALUES (v_creator_uid, p_match_id, v_commission, 'inr', 'hold', NOW() + INTERVAL '7 days');
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'jr_id', v_jr_id::TEXT);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'       THEN 'Not authorized'
        WHEN 'USER_NOT_FOUND'       THEN 'User not found'
        WHEN 'INSUFFICIENT_BALANCE' THEN 'Balance kam hai'
        WHEN 'ALREADY_JOINED'       THEN 'Aap already join ho chuke ho'
        WHEN 'MATCH_FULL'           THEN 'Match full ho gaya'
        WHEN 'SELF_PLAY_BLOCKED'    THEN 'Apne khud ke hosted match mein join nahi kar sakte'
        ELSE SQLERRM
      END
    );
END;
$function$;

-- claim_match_commission_payout: server-authoritative creator_payouts row
CREATE OR REPLACE FUNCTION public.claim_match_commission_payout()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_count INT;
  v_total NUMERIC;
  v_ign TEXT;
  v_payout_id UUID;
  v_payouts_cnt INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_count, v_total
  FROM creator_commissions
  WHERE creator_uid = v_uid AND status = 'eligible' AND currency = 'inr';
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No eligible commission to claim');
  END IF;
  UPDATE creator_commissions SET status = 'pending_payout', updated_at = NOW()
  WHERE creator_uid = v_uid AND status = 'eligible' AND currency = 'inr';
  SELECT COUNT(*) INTO v_payouts_cnt FROM creator_payouts
  WHERE uid = v_uid AND status = 'pending';
  IF v_payouts_cnt = 0 THEN
    SELECT COALESCE(ign, 'Player') INTO v_ign FROM users WHERE id = v_uid;
    INSERT INTO creator_payouts (uid, ign, amount, status, created_at)
    VALUES (v_uid, v_ign, v_total, 'pending', NOW())
    RETURNING id INTO v_payout_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'count', v_count, 'total', v_total,
                            'payout_id', v_payout_id, 'already_pending', v_payouts_cnt > 0);
END;
$function$;

-- ═══ P1: restrict release_eligible_commissions to internal/admin ═══
CREATE OR REPLACE FUNCTION public.release_eligible_commissions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'not_authenticated';
    END IF;
    SELECT COALESCE(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'admin_only';
    END IF;
  END IF;
  UPDATE creator_commissions
  SET status = 'eligible', updated_at = NOW()
  WHERE status = 'hold' AND eligible_at <= NOW();
  UPDATE creator_matches cm
  SET commission_status = 'eligible'
  FROM creator_commissions cc
  WHERE cm.match_id = cc.match_id AND cc.status = 'eligible' AND cm.commission_status = 'hold';
END;
$function$;

-- ═══ P1: seed complete live_config (missions/streakMilestones/cosmetics + core) ═══
UPDATE public.app_settings
SET value = value::jsonb ||
  jsonb_build_object(
    'sdPackages', jsonb_build_array(
      jsonb_build_object('diamonds',50,'price',49,'label','Starter'),
      jsonb_build_object('diamonds',120,'price',99,'label','Popular'),
      jsonb_build_object('diamonds',260,'price',199,'label','Value'),
      jsonb_build_object('diamonds',600,'price',399,'label','Mega')),
    'premium', jsonb_build_object(
      'prices',  jsonb_build_object('1',49,'2',99,'3',199),
      'bonuses', jsonb_build_object('1',50,'2',150,'3',400)),
    'battlePassPrice', 49,
    'coinMatchCommissionPct', 10,
    'sdMatchCommissionPct', 15,
    'commissionHoldDays', 7,
    'creatorMinPayout', 100,
    'checkinCoins', 5,
    'paytmEnabled', true,
    'missions', jsonb_build_object(
      'daily_match', 10, 'daily_kills3', 5, 'week_5matches', 50, 'week_top3', 30),
    'streakMilestones', jsonb_build_object(
      '3',  jsonb_build_object('coins', 20),
      '7',  jsonb_build_object('coins', 100, 'badge', '🔥 Unstoppable'),
      '14', jsonb_build_object('coins', 200),
      '30', jsonb_build_object('coins', 500, 'badge', '⚡ Dedicated'),
      '60', jsonb_build_object('coins', 1000, 'badge', '👑 Legend'),
      '100', jsonb_build_object('coins', 2000, 'badge', '🌟 Immortal')),
    'cosmetics', jsonb_build_object(
      'frame_neon',   jsonb_build_object('name','Neon Frame','price',50,'icon','🟢','type','frame'),
      'frame_fire',   jsonb_build_object('name','Fire Frame','price',75,'icon','🔥','type','frame'),
      'frame_galaxy', jsonb_build_object('name','Galaxy Frame','price',100,'icon','🌌','type','frame'),
      'frame_gold',   jsonb_build_object('name','Gold Champion','price',150,'icon','🏆','type','frame'),
      'tag_beast',    jsonb_build_object('name','⚡ BEAST MODE','price',30,'icon','⚡','type','tag'),
      'tag_pro',      jsonb_build_object('name','🎯 PRO PLAYER','price',30,'icon','🎯','type','tag'),
      'tag_king',     jsonb_build_object('name','👑 KING','price',50,'icon','👑','type','tag'),
      'vip_slot',     jsonb_build_object('name','VIP Slot Pass','price',200,'icon','⭐','type','slot')))
WHERE key = 'live_config';


-- lock_creator_commission: anon REVOKE (orphan; admin/service-guard body ke saath)
REVOKE EXECUTE ON FUNCTION public.lock_creator_commission(text,numeric) FROM anon;

-- =====================================================================
-- END 2026-09-22e — R29E AUDIT FIXES
-- =====================================================================


-- ═══ P0-6 ext: claim_premium_monthly_bonus config-aware (live_config.premium.bonuses) ═══
CREATE OR REPLACE FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer DEFAULT NULL::integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_prem INT;
  v_month TEXT := TO_CHAR(NOW(), 'YYYY-MM');
  v_bonus INT;
  v_cfg JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  IF p_tier NOT IN (1,2,3) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid tier');
  END IF;
  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_bonus := COALESCE(
    (v_cfg->'premium'->'bonuses'->p_tier::text)::INT,
    CASE p_tier WHEN 1 THEN 50 WHEN 2 THEN 150 ELSE 400 END);
  SELECT COALESCE(premium_level, 0) INTO v_prem FROM users WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_prem, 0) <> p_tier THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is tier ka premium active nahi hai');
  END IF;
  INSERT INTO premium_monthly_bonus_claims(user_id, month_key, tier, bonus_coins)
  VALUES (v_uid, v_month, p_tier, v_bonus);
  UPDATE users SET coins = COALESCE(coins,0) + v_bonus WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', v_bonus, 'premium_bonus', 'Monthly Premium Bonus Tier ' || p_tier);
  RETURN jsonb_build_object('ok', true, 'bonus', v_bonus, 'month', v_month);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Is month ka bonus le liya');
END;
$function$;

