-- ============================================================================
-- Round-4 — Slot accounting semantic LOCKED (player-slots) + search_path fixes
-- File: 2026-09-23i-R4-SLOT-SEARCHPATH-DELTA.sql
-- Date: 2026-09-23
-- Severity: P1 (duo/squad capacity undercount + stale no-show slots) + P3 (mutable search_path)
-- ============================================================================
-- SEMANTIC DECISION (single definition, JOIN/SETTLE/NO-SHOW/CANCEL all consistent):
--   matches.filled_slots = PLAYER SLOTS.  solo=1 · duo=2 · squad=4
-- Fill:   validate_and_join_match() += v_slots (authoritative; capacity
--         check v_available = max_slots - filled_slots already slot-based)
-- Release: cancel_match_with_refunds / internal_process_no_show_refunds /
--         claim_no_show_refund / claim_match_refund — sirf CAPTAIN/SOLO row
--         weight rakhti hai (partner join_requests rows ka weight 0, kyunki
--         captain row ne hi slots bhare the). captain_uid IS NULL ya = user_id
--         → captain. GREATEST(...,0) floor = negative-impossible.
-- #5: reassign_clan_leader + clamp_join_requests_client_update में explicit
--     SET search_path TO 'public' (mutable search_path warning band).
-- NOTE: gift_match_entry friend auto-join +1 (solo) UNCHANGED — gift है solo.
-- NOTE: increment_match_filled_slots +1 (bridge joinedSlots mirror) UNCHANGED
--       semantic — ye solo/legacy-path mirror hai, RPC-internal slot-fill
--       se अलग (bridge sync dhyan se NOT changed, R4 client-fix handles double-count).
-- ═══════════════════════════════════════════════════════════════════

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

CREATE OR REPLACE FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_jr RECORD;
  v_refund_count INT := 0;
  v_currency TEXT;
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  p_admin_uid := COALESCE(p_admin_uid, v_caller);

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
      'refund',
      false,
      NOW(),
      p_match_id
    );

    v_refund_count := v_refund_count + 1;
  END LOOP;

  UPDATE join_requests
  SET status = 'cancelled'
  WHERE match_id = p_match_id AND status NOT IN ('cancelled', 'refunded', 'rejected');

  /* ROUND-4 v2: captain/solo row weight only; partner rows weight 0. */
  UPDATE matches SET filled_slots = GREATEST(
    filled_slots - COALESCE((
      SELECT SUM(CASE
        WHEN mode IN ('duo','squad') AND COALESCE(captain_uid, user_id) <> user_id THEN 0
        WHEN mode = 'duo' THEN 2
        WHEN mode = 'squad' THEN 4
        ELSE 1 END)
      FROM join_requests
      WHERE match_id = p_match_id AND status IN ('cancelled','refunded')
    ), 0), 0)
  WHERE id = p_match_id;

  UPDATE matches SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = p_admin_uid WHERE id = p_match_id;

  RETURN jsonb_build_object('ok', true, 'refund_count', v_refund_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.internal_process_no_show_refunds()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jr RECORD;
  v_col TEXT;
  v_cfg JSONB;
  v_close_mins INT;
  v_count INT := 0;
BEGIN
  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_close_mins := COALESCE((v_cfg->>'checkInCloseMins')::INT, 5);

  FOR v_jr IN
    SELECT jr.id, jr.user_id, jr.entry_type, jr.entry_fee_paid, jr.match_id, jr.mode, jr.captain_uid
    FROM join_requests jr
    JOIN matches m ON m.id = jr.match_id
    WHERE jr.status IN ('pending', 'approved', 'joined')
      AND COALESCE(jr.checked_in, false) = false
      AND COALESCE(jr.entry_fee_paid, 0) > 0
      AND now() >= (m.scheduled_at - (v_close_mins || ' minutes')::interval)
    FOR UPDATE OF jr SKIP LOCKED
  LOOP
    v_col := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

    EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', v_col, v_col)
      USING v_jr.entry_fee_paid, v_jr.user_id;

    UPDATE join_requests SET status = 'no_show' WHERE id = v_jr.id;

    UPDATE matches SET filled_slots = GREATEST(filled_slots - CASE
      WHEN v_jr.mode IN ('duo','squad') AND COALESCE(v_jr.captain_uid, v_jr.user_id) <> v_jr.user_id THEN 0
      WHEN v_jr.mode = 'duo' THEN 2
      WHEN v_jr.mode = 'squad' THEN 4
      ELSE 1 END, 0)
    WHERE id = v_jr.match_id;

    INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason, ref_id)
    VALUES (v_jr.user_id, v_col, 'credit', v_jr.entry_fee_paid, 'no_show_refund', v_jr.match_id);

    INSERT INTO notifications (user_id, type, title, body)
    VALUES (v_jr.user_id, 'no_show_refund', '⚠️ Check-In Miss — Refund',
            'Tum match mein check-in nahi kiya — slot release ho gaya aur entry fee refund ho gayi.');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_no_show_refund(p_join_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_jr RECORD;
  v_match RECORD;
  v_col TEXT;
  v_cfg JSONB;
  v_close_mins INT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_jr FROM join_requests WHERE id = p_join_id FOR UPDATE;
  IF v_jr IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Join request not found');
  END IF;

  IF v_jr.user_id <> v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not your entry');
  END IF;

  IF v_jr.status = 'refunded' OR v_jr.status = 'no_show' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already processed');
  END IF;

  IF COALESCE(v_jr.checked_in, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'You checked in — not a no-show');
  END IF;

  SELECT status, scheduled_at INTO v_match FROM matches WHERE id = v_jr.match_id;
  IF v_match IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match not found');
  END IF;

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_close_mins := COALESCE((v_cfg->>'checkInCloseMins')::INT, 5);
  IF now() < (v_match.scheduled_at - (v_close_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Check-in has not closed yet');
  END IF;

  IF COALESCE(v_jr.entry_fee_paid, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nothing to refund', 'refunded', 0);
  END IF;

  v_col := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', v_col, v_col)
    USING v_jr.entry_fee_paid, v_caller;

  UPDATE join_requests SET status = 'no_show' WHERE id = p_join_id;

  UPDATE matches SET filled_slots = GREATEST(filled_slots - CASE
    WHEN v_jr.mode IN ('duo','squad') AND COALESCE(v_jr.captain_uid, v_jr.user_id) <> v_jr.user_id THEN 0
    WHEN v_jr.mode = 'duo' THEN 2
    WHEN v_jr.mode = 'squad' THEN 4
    ELSE 1 END, 0)
  WHERE id = v_jr.match_id;

  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason, ref_id)
  VALUES (v_caller, v_col, 'credit', v_jr.entry_fee_paid, 'no_show_refund', v_jr.match_id);

  RETURN jsonb_build_object('success', true, 'refunded', v_jr.entry_fee_paid, 'currency', v_col);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_match_refund(p_join_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_jr RECORD;
  v_match RECORD;
  v_col TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_jr FROM join_requests WHERE id = p_join_id FOR UPDATE;
  IF v_jr IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Join request not found');
  END IF;

  IF v_jr.user_id <> v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not your entry');
  END IF;

  IF v_jr.status = 'refunded' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already refunded');
  END IF;

  SELECT status INTO v_match FROM matches WHERE id = v_jr.match_id;
  IF v_match IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match not found');
  END IF;

  IF v_match.status NOT IN ('cancelled', 'canceled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match is not cancelled');
  END IF;

  IF COALESCE(v_jr.entry_fee_paid, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nothing to refund', 'refunded', 0);
  END IF;

  v_col := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', v_col, v_col)
    USING v_jr.entry_fee_paid, v_caller;

  UPDATE join_requests SET status = 'refunded' WHERE id = p_join_id;

  UPDATE matches SET filled_slots = GREATEST(filled_slots - CASE
    WHEN v_jr.mode IN ('duo','squad') AND COALESCE(v_jr.captain_uid, v_jr.user_id) <> v_jr.user_id THEN 0
    WHEN v_jr.mode = 'duo' THEN 2
    WHEN v_jr.mode = 'squad' THEN 4
    ELSE 1 END, 0)
  WHERE id = v_jr.match_id;

  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason, ref_id)
  VALUES (v_caller, v_col, 'credit', v_jr.entry_fee_paid, 'match_refund', v_jr.match_id);

  RETURN jsonb_build_object('success', true, 'refunded', v_jr.entry_fee_paid, 'currency', v_col);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_clan_leader()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clan_id    UUID;
  v_new_leader TEXT;
BEGIN
  FOR v_clan_id IN
    SELECT id FROM clans WHERE leader_uid = OLD.id
  LOOP
    SELECT user_id INTO v_new_leader
    FROM clan_members
    WHERE clan_id = v_clan_id AND user_id != OLD.id
    ORDER BY joined_at ASC LIMIT 1;
    IF v_new_leader IS NOT NULL THEN
      UPDATE clans SET leader_uid = v_new_leader WHERE id = v_clan_id;
    ELSE
      UPDATE clans SET status = 'disbanded', disbanded_at = NOW() WHERE id = v_clan_id;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clamp_join_requests_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    SELECT COALESCE(is_admin,false) INTO v_is_admin FROM users WHERE id = auth.jwt() ->> 'sub';
    IF NOT COALESCE(v_is_admin,false) THEN
      NEW.status := OLD.status;
      NEW.kills := OLD.kills;
      NEW.placement := OLD.placement;
      NEW.prize_earned := OLD.prize_earned;
      NEW.entry_fee_paid := OLD.entry_fee_paid;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
