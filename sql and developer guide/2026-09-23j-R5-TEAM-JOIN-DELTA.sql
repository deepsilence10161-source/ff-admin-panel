-- ═══════════════════════════════════════════════════════════════════
-- R5 — join_match_team : ATOMIC TEAM JOIN (solo/duo/squad, captain_pays/each_pays)
-- Server derives fee/currency/team-size/eligibility. All-or-nothing.
-- Idempotent against retry via unique (match_id,user_id) active-join recheck.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_m            RECORD;
  v_fee_mode     TEXT;
  v_server_fee   NUMERIC;
  v_slots        INT;
  v_captain_fee  NUMERIC;
  v_member_fee   NUMERIC;
  v_total_collected NUMERIC := 0;
  v_available    INT;
  v_mem          JSONB;
  v_mem_uid      TEXT;
  v_mem_ign      TEXT;
  v_bal          NUMERIC;
  v_col          TEXT;
  v_jr_id        UUID;
  v_idx          INT := 0;
  v_unique_uids  TEXT[] := ARRAY[]::TEXT[];
  v_creator_code TEXT;
  v_creator_uid  TEXT;
  v_commission_pct NUMERIC;
  v_commission   NUMERIC;
  v_first_row_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_mode IS NULL THEN p_mode := 'solo'; END IF;
  p_mode := lower(p_mode);
  v_slots := CASE WHEN p_mode = 'duo' THEN 2 WHEN p_mode = 'squad' THEN 4 ELSE 1 END;

  IF p_team IS NULL OR jsonb_typeof(p_team) <> 'array' OR jsonb_array_length(p_team) = 0 THEN
    RAISE EXCEPTION 'INVALID_TEAM';
  END IF;

  /* captain = team[0]; server identifies from jwt — client team[0].uid सिर्फ़ hint */
  v_mem := p_team -> 0;
  IF (v_mem->>'uid') IS NULL OR (v_mem->>'uid') <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  /* team size must match mode */
  IF (v_slots = 2 AND jsonb_array_length(p_team) <> 2) OR
     (v_slots = 4 AND jsonb_array_length(p_team) <> 4) OR
     (v_slots = 1 AND jsonb_array_length(p_team) <> 1) THEN
    RAISE EXCEPTION 'TEAM_SIZE_MISMATCH';
  END IF;

  SELECT id, status, entry_type, entry_fee, max_slots, filled_slots, creator_uid
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
  IF v_m.status IS DISTINCT FROM 'upcoming' AND v_m.status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'MATCH_NOT_JOINABLE';
  END IF;
  IF v_m.creator_uid IS NOT NULL AND v_m.creator_uid = v_caller THEN
    RAISE EXCEPTION 'SELF_PLAY_BLOCKED';
  END IF;

  /* fee/currency server-derived (client never) */
  CASE COALESCE(lower(regexp_replace(v_m.entry_type, '[_ -]', '', 'g')), 'free')
    WHEN 'coin'  THEN v_server_fee := COALESCE(v_m.entry_fee,0); v_fee_mode := 'coins';
    WHEN 'paid'  THEN v_server_fee := COALESCE(v_m.entry_fee,0); v_fee_mode := 'sky_diamonds';
    WHEN 'free'  THEN v_server_fee := 0; v_fee_mode := 'free';
    WHEN 'ad'    THEN v_server_fee := 0; v_fee_mode := 'ad';
    ELSE
      IF COALESCE(v_m.entry_fee,0) > 0 THEN v_server_fee := v_m.entry_fee; v_fee_mode := 'sky_diamonds';
      ELSE v_server_fee := 0; v_fee_mode := 'free'; END IF;
  END CASE;

  v_col := CASE WHEN v_fee_mode = 'coins' THEN 'coins' ELSE 'sky_diamonds' END;

  IF p_fee_type IS NULL THEN p_fee_type := 'captain_pays'; END IF;
  p_fee_type := lower(p_fee_type);
  IF p_fee_type NOT IN ('captain_pays','each_pays','solo') THEN p_fee_type := 'captain_pays'; END IF;
  IF v_slots = 1 THEN p_fee_type := 'solo'; END IF;

  /* amounts: captain_pays → captain pays fee*slots (members free);
     each_pays → har member apna 1x fee; solo → 1x. */
  v_captain_fee := CASE WHEN p_fee_type = 'each_pays' THEN v_server_fee
                        ELSE v_server_fee * v_slots END;
  v_member_fee := CASE WHEN p_fee_type = 'each_pays' THEN v_server_fee ELSE 0 END;

  /* capacity (player slots) */
  v_available := COALESCE(v_m.max_slots, 999) - COALESCE(v_m.filled_slots, 0);
  IF v_available < v_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  /* validate members & duplicate-active-join BEFORE any write (idempotent guard) */
  FOR v_idx IN 0 .. jsonb_array_length(p_team) - 1 LOOP
    v_mem := p_team -> v_idx;
    v_mem_uid := v_mem->>'uid';
    IF v_mem_uid IS NULL OR v_mem_uid = ANY(v_unique_uids) THEN
      RAISE EXCEPTION 'INVALID_TEAM';
    END IF;
    v_unique_uids := v_unique_uids || v_mem_uid;
    IF COALESCE((SELECT is_banned FROM users WHERE id = v_mem_uid), false) THEN
      RAISE EXCEPTION 'ACCOUNT_BANNED';
    END IF;
    IF EXISTS(SELECT 1 FROM join_requests
              WHERE user_id = v_mem_uid AND match_id = p_match_id
                AND status NOT IN ('cancelled','refunded','no_show')) THEN
      RAISE EXCEPTION 'ALREADY_JOINED';
    END IF;
  END LOOP;

  /* lock every member row + validate balance (atomic; koi bhi fail = full rollback) */
  IF v_server_fee > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(p_team) - 1 LOOP
      v_mem := p_team -> v_idx;
      v_mem_uid := v_mem->>'uid';
      IF v_col = 'coins' THEN
        SELECT coins INTO v_bal FROM users WHERE id = v_mem_uid FOR UPDATE;
      ELSE
        SELECT sky_diamonds INTO v_bal FROM users WHERE id = v_mem_uid FOR UPDATE;
      END IF;
      IF v_bal IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
      IF v_idx = 0 THEN
        IF v_bal < v_captain_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
      ELSE
        IF v_bal < v_member_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
      END IF;
    END LOOP;
  END IF;

  /* debit + join row per member (single transaction) */
  FOR v_idx IN 0 .. jsonb_array_length(p_team) - 1 LOOP
    v_mem := p_team -> v_idx;
    v_mem_uid := v_mem->>'uid';
    v_mem_ign := COALESCE(v_mem->>'ign', '');

    IF v_idx = 0 THEN v_bal := v_captain_fee; ELSE v_bal := v_member_fee; END IF;

    IF v_server_fee > 0 AND v_bal > 0 THEN
      IF v_col = 'coins' THEN
        UPDATE users SET coins = coins - v_bal WHERE id = v_mem_uid;
      ELSE
        UPDATE users SET sky_diamonds = sky_diamonds - v_bal WHERE id = v_mem_uid;
      END IF;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES (v_mem_uid, v_fee_mode, 'debit', v_bal, 'match_entry', p_match_id);
      v_total_collected := v_total_collected + v_bal;
    END IF;

    INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, mode, ign_at_join, fee_type, captain_uid)
    VALUES(
      v_mem_uid, p_match_id, v_bal,
      CASE WHEN v_fee_mode='coins' THEN 'coin'
           WHEN v_fee_mode='sky_diamonds' THEN 'sky_diamond'
           ELSE COALESCE(v_m.entry_type,'free') END,
      'joined', p_mode, v_mem_ign, p_fee_type,
      CASE WHEN v_idx = 0 THEN NULL ELSE v_caller END
    ) RETURNING id INTO v_jr_id;
    IF v_idx = 0 THEN v_first_row_id := v_jr_id; END IF;
  END LOOP;

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + v_slots WHERE id = p_match_id;

  /* creator commission (spend-triggered, sky-only, same rule as validate_and_join_match) */
  IF v_fee_mode = 'sky_diamonds' AND v_total_collected > 0 THEN
    SELECT creator_code INTO v_creator_code FROM users WHERE id = v_caller;
    IF v_creator_code IS NOT NULL THEN
      SELECT user_id INTO v_creator_uid FROM creator_codes WHERE code = v_creator_code;
      IF v_creator_uid IS NOT NULL AND v_creator_uid <> v_caller
         AND EXISTS(SELECT 1 FROM users WHERE id = v_creator_uid AND is_creator = true) THEN
        SELECT COALESCE((value->>'sdMatchCommissionPct')::numeric, 15)
          INTO v_commission_pct FROM app_settings WHERE key = 'creator_system';
        v_commission_pct := COALESCE(v_commission_pct, 15);
        v_commission := ROUND(v_total_collected * v_commission_pct / 100, 2);
        INSERT INTO creator_stats(user_id, total_matches, total_earnings)
        VALUES (v_creator_uid, 1, v_commission)
        ON CONFLICT (user_id) DO UPDATE SET
          total_matches = creator_stats.total_matches + 1,
          total_earnings = creator_stats.total_earnings + v_commission, updated_at = NOW();
        INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
        VALUES (v_creator_uid, p_match_id, v_commission, 'inr', 'hold', NOW() + INTERVAL '7 days');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'captain_row_id', v_first_row_id, 'slots', v_slots);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'        THEN 'Not authorized'
        WHEN 'MATCH_NOT_FOUND'       THEN 'Match not found'
        WHEN 'MATCH_NOT_JOINABLE'    THEN 'Match ab join nahi ho sakta'
        WHEN 'SELF_PLAY_BLOCKED'     THEN 'Apne khud ke hosted match mein join nahi kar sakte'
        WHEN 'ACCOUNT_BANNED'        THEN 'Kisi teammate ka account ban hai'
        WHEN 'ALREADY_JOINED'        THEN 'Koi teammate already is match mein join hai'
        WHEN 'MATCH_FULL'            THEN 'Match full ho gaya'
        WHEN 'INSUFFICIENT_BALANCE'  THEN 'Kisi teammate ke paas balance kam hai'
        WHEN 'USER_NOT_FOUND'        THEN 'Player not found'
        WHEN 'TEAM_SIZE_MISMATCH'    THEN 'Team size galat hai'
        WHEN 'INVALID_TEAM'          THEN 'Team invalid hai'
        ELSE SQLERRM
      END);
END;
$function$;
