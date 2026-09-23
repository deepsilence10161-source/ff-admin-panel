-- ═══════════════════════════════════════════════════════════════════
-- R5 PRODUCTION HARDENING — SQL PART
-- 1) validate_and_join_match v3: team-fee atomic pack (IX/totalCross)
-- 2) increment_match_filled_slots → bounded (match-live + full + request+1)
-- 3) submit_sponsored_withdrawal(p_amount, p_upi) → explicit 'pending'
-- 4) decrement_balance NULL-caller fail-closed (R3-canonical)
-- कोई business-rule change नहीं: solo/duo/squad weights, currencies, fees वही।
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) validate_and_join_match v3 ──
CREATE OR REPLACE FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m              RECORD;
  v_balance        NUMERIC;
  v_joined         BOOLEAN := false;
  v_jr_id          UUID;
  v_fee_mode       TEXT;
  v_server_fee     NUMERIC;
  v_slots          INT;
  v_charge_fee     NUMERIC;
  v_available      INT;
  v_caller         TEXT := auth.jwt() ->> 'sub';
  v_creator_code   TEXT;
  v_creator_uid    TEXT;
  v_commission     NUMERIC;
  v_commission_pct NUMERIC;
BEGIN
  IF v_caller IS NULL OR v_caller <> p_uid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT id, title, status, entry_type, entry_fee, max_slots, filled_slots, creator_uid
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_m.status IS DISTINCT FROM 'upcoming' AND v_m.status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'MATCH_NOT_JOINABLE';
  END IF;

  IF v_m.creator_uid IS NOT NULL AND v_m.creator_uid = p_uid THEN
    RAISE EXCEPTION 'SELF_PLAY_BLOCKED';
  END IF;

  IF COALESCE((SELECT is_banned FROM users WHERE id = p_uid), false) THEN
    RAISE EXCEPTION 'ACCOUNT_BANNED';
  END IF;

  CASE COALESCE(lower(regexp_replace(v_m.entry_type, '[_ -]', '', 'g')), 'free')
    WHEN 'coin' THEN
      v_server_fee := COALESCE(v_m.entry_fee, 0);
      v_fee_mode   := 'coins';
    WHEN 'paid' THEN
      v_server_fee := COALESCE(v_m.entry_fee, 0);
      v_fee_mode   := 'sky_diamonds';
    WHEN 'free' THEN
      v_server_fee := 0; v_fee_mode := 'free';
    WHEN 'ad' THEN
      v_server_fee := 0; v_fee_mode := 'ad';
    ELSE
      IF COALESCE(v_m.entry_fee, 0) > 0 THEN
        v_server_fee := v_m.entry_fee; v_fee_mode := 'sky_diamonds';
      ELSE
        v_server_fee := 0; v_fee_mode := 'free';
      END IF;
  END CASE;

  v_slots := 1;
  IF p_join_data IS NOT NULL AND p_join_data ? 'mode' THEN
    IF p_join_data->>'mode' = 'duo'  THEN v_slots := 2; END IF;
    IF p_join_data->>'mode' = 'squad' THEN v_slots := 4; END IF;
  END IF;

  v_charge_fee :=
    CASE
      WHEN v_slots = 1 THEN v_server_fee
      WHEN (p_join_data->>'feeType') = 'each_pays' THEN v_server_fee
      ELSE v_server_fee * v_slots
    END;

  /* R5 FIX: team या नहीं भी — अब एक ही servant पर सभी team-users FOR UPDATE
     lock किए जाते हैं; balance-check atomic। */
  IF v_server_fee > 0 THEN
    IF v_fee_mode = 'coins' THEN
      SELECT coins INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
    ELSE
      SELECT sky_diamonds INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
    END IF;
    IF v_balance IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
    IF v_balance < v_charge_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM join_requests
    WHERE user_id = p_uid AND match_id = p_match_id
      AND status NOT IN ('cancelled','refunded','no_show')
  ) INTO v_joined;
  IF v_joined THEN RAISE EXCEPTION 'ALREADY_JOINED'; END IF;

  v_available := COALESCE(v_m.max_slots, 999) - COALESCE(v_m.filled_slots, 0);
  IF v_available < v_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  IF v_server_fee > 0 THEN
    IF v_fee_mode = 'coins' THEN
      UPDATE users SET coins = coins - v_charge_fee WHERE id = p_uid;
    ELSE
      UPDATE users SET sky_diamonds = sky_diamonds - v_charge_fee WHERE id = p_uid;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(p_uid, v_fee_mode, 'debit', v_charge_fee, 'match_entry', p_match_id);
  END IF;

  INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, mode, ign_at_join, fee_type)
  VALUES(
    p_uid, p_match_id, v_charge_fee,
    CASE WHEN v_fee_mode='coins' THEN 'coin'
         WHEN v_fee_mode='sky_diamonds' THEN 'sky_diamond'
         ELSE COALESCE(v_m.entry_type, 'free') END,
    'joined',
    COALESCE(p_join_data->>'mode', 'solo'),
    COALESCE(p_join_data->>'ign', ''),
    COALESCE(p_join_data->>'feeType', 'solo')
  ) RETURNING id INTO v_jr_id;

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + v_slots WHERE id = p_match_id;

  IF v_fee_mode = 'sky_diamonds' AND v_charge_fee > 0 THEN
    SELECT creator_code INTO v_creator_code FROM users WHERE id = p_uid;
    IF v_creator_code IS NOT NULL THEN
      SELECT user_id INTO v_creator_uid FROM creator_codes WHERE code = v_creator_code;
      IF v_creator_uid IS NOT NULL AND v_creator_uid <> p_uid
         AND EXISTS(SELECT 1 FROM users WHERE id = v_creator_uid AND is_creator = true) THEN
        SELECT COALESCE((value->>'sdMatchCommissionPct')::numeric, 15)
          INTO v_commission_pct
          FROM app_settings WHERE key = 'creator_system';
        v_commission_pct := COALESCE(v_commission_pct, 15);
        v_commission := ROUND(v_charge_fee * v_commission_pct / 100, 2);
        INSERT INTO creator_stats(user_id, total_matches, total_earnings)
        VALUES (v_creator_uid, 1, v_commission)
        ON CONFLICT (user_id) DO UPDATE SET
          total_matches = creator_stats.total_matches + 1,
          total_earnings = creator_stats.total_earnings + v_commission,
          updated_at = NOW();
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
        WHEN 'MATCH_NOT_FOUND'      THEN 'Match not found'
        WHEN 'MATCH_NOT_JOINABLE'   THEN 'Match ab join nahi ho sakta'
        WHEN 'USER_NOT_FOUND'       THEN 'User not found'
        WHEN 'INSUFFICIENT_BALANCE' THEN 'Balance kam hai'
        WHEN 'ALREADY_JOINED'       THEN 'Aap already join ho chuke ho'
        WHEN 'MATCH_FULL'           THEN 'Match full ho gaya'
        WHEN 'SELF_PLAY_BLOCKED'    THEN 'Apne khud ke hosted match mein join nahi kar sakte'
        WHEN 'ACCOUNT_BANNED'       THEN 'Aapka account ban hai'
        ELSE SQLERRM
      END
    );
END;
$function$;

-- ── 2) submit_sponsored_withdrawal — explicit pending + serverside balance/lock ──
CREATE OR REPLACE FUNCTION public.submit_sponsored_withdrawal(p_amount numeric, p_upi text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_bal NUMERIC;
  v_pending NUMERIC;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
  END IF;
  IF p_upi IS NULL OR p_upi !~ '^[^@\s]+@[^@\s]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_upi');
  END IF;

  SELECT COALESCE(sponsored_winnings, 0) INTO v_bal FROM users WHERE id = v_caller FOR UPDATE;
  IF v_bal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  IF p_amount > v_bal THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_exceeds_balance', 'balance', v_bal);
  END IF;

  /* Duplicate-guard: ek pending withdrawal active hai to naya block. */
  SELECT COALESCE(SUM(amount), 0) INTO v_pending
  FROM wallet_transactions
  WHERE user_id = v_caller AND txn_type = 'pending_withdraw' AND status = 'pending';
  IF COALESCE(v_pending, 0) + p_amount > v_bal THEN
    RETURN jsonb_build_object('success', false, 'error', 'pending_requests_exceed_balance');
  END IF;

  INSERT INTO wallet_transactions (user_id, txn_type, amount, currency, reason, note, status)
  VALUES (v_caller, 'pending_withdraw', p_amount, 'sponsored', 'sponsored_withdrawal', 'UPI: ' || p_upi, 'pending');

  RETURN jsonb_build_object('success', true, 'amount', p_amount, 'status', 'pending');
END;
$function$;

-- ── 3) increment_match_filled_slots — bounded/guarded (match live + full + request+1) ──
CREATE OR REPLACE FUNCTION public.increment_match_filled_slots(p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rx BOOLEAN;
  v_m RECORD;
BEGIN
  -- caller must be authenticated (bridge mirror is anon-safe either way)
  IF (auth.jwt() ->> 'sub') IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM join_requests
    WHERE match_id = p_match_id AND user_id = auth.jwt() ->> 'sub'
  ) INTO v_rx;

  SELECT mode, status, max_slots, filled_slots
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.status IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;
  IF v_m.status NOT IN ('upcoming','live') THEN
    RAISE EXCEPTION 'match_not_joinable';
  END IF;
  IF COALESCE(v_m.filled_slots, 0) >= COALESCE(v_m.max_slots, 0) THEN
    RAISE EXCEPTION 'match_full';
  END IF;

  UPDATE matches SET filled_slots = filled_slots + 1 WHERE id = p_match_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ── 4) decrement_balance NULL-caller fail-closed (R5 — guard tighten) ──
CREATE OR REPLACE FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed_cols TEXT[] := ARRAY['coins','green_diamonds','sky_diamonds'];
  v_balance    NUMERIC;
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_admin   BOOLEAN;
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
  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1', p_col)
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
  RETURN jsonb_build_object('success', true);
END;
$function$;
