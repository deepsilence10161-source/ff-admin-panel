-- ============================================================================
-- 2026-09-23a R3 PRODUCTION-HARDENING — P0 JOIN-FEE BYPASS FIX
-- (APPLIED 2026-09-23 — live DB पर verified)
-- ----------------------------------------------------------------------------
-- PROBLEM (live-proven 2026-09-23):
--   public.validate_and_join_match() client-supplied p_entry_fee/p_currency ko
--   SEEDHA debit karta tha; matches.entry_fee se compare nahi karta tha.
--   UPCOMING match 'QA_JoinFlow_Test2' (entry_fee=1 coin) par qa2 ne
--   p_entry_fee=0 → {"ok":true} diya, entry_fee_paid=0 + status='joined' row
--   ban gayi, coins UNCHANGED, filled_slots 0→1. => P0 FEE-BYPASS CONFIRMED.
--
-- FIX:
--   1) validate_and_join_match REWRITE: fee/currency/slot-cap/banned/self-play/
--      duplicate ab SAB SERVER-AUTHORITATIVE (matches row FOR UPDATE lock).
--      p_entry_fee/p_currency = LEGACY SIGNATURE ONLY (IGNORED).
--      Team packing (captain_pays=fee*slots, each_pays=fee) server compute.
--      Mutable search_path bhi fix (SET search_path TO 'public').
--   2) active_matches view se room_id/room_password HATA diye (creds leak).
--      Renewed as DROP+CREATE (Postgres 42P16: CREATE OR REPLACE VIEW columns
--      drop nahi kar sakta). Explicit column list + security_invoker=true.
--
-- BUSINESS RULES PRESERVED (koi change nahi):
--   * Creator SD commission: sirf paid(SD) matches, creator_code wale active
--     non-self creator, sdMatchCommissionPct (default 15), INR ledger, 7-day hold.
--   * entry_type↔currency: coin→coins, paid→sky_diamonds, free/ad→0.
--   * error codes SAME + new: MATCH_NOT_FOUND/MATCH_NOT_JOINABLE.
--
-- VERIFY (run after apply):
--   SELECT proconfig FROM pg_proc WHERE proname='validate_and_join_match';
--     → ['search_path=public']  (mutable fix)
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='active_matches' AND column_name IN ('room_id','room_password');
--     → 0 rows (creds ab view me nahi)
--   Live bypass re-probe: p_entry_fee=0 bhejo → server SIRF bhi matches.entry_fee
--     debit karta hai (qa2 306→305, entry_fee_paid=1) — P0 CLOSED.
-- ============================================================================

-- 1) P0: server-authoritative join fee (full replacement) ----------------------
CREATE OR REPLACE FUNCTION public.validate_and_join_match(
    p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m              RECORD;      -- matches row (FOR UPDATE locked)
  v_balance        NUMERIC;
  v_joined         BOOLEAN := false;
  v_jr_id          UUID;
  v_fee_mode       TEXT;        -- 'coins' | 'sky_diamonds' | 'free' | 'ad'
  v_server_fee     NUMERIC;     -- matches.entry_fee (canonical, per-slot)
  v_slots          INT;         -- solo=1 / duo=2 / squad=4
  v_charge_fee     NUMERIC;     -- this caller's actual charge
  v_available      INT;
  v_caller         TEXT := auth.jwt() ->> 'sub';
  v_creator_code   TEXT;
  v_creator_uid    TEXT;
  v_commission     NUMERIC;
  v_commission_pct NUMERIC;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  /* R3-P0 FIX (2026-09-23): fee server-authoritative; legacy params IGNORED. */

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

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + 1 WHERE id = p_match_id;

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

GRANT EXECUTE ON FUNCTION public.validate_and_join_match(text, text, numeric, text, jsonb) TO anon, authenticated;

-- 2) active_matches view: room creds leak hatao ---------------------------------
--    (DROP+CREATE — Postgres CREATE OR REPLACE VIEW columns drop nahi karta)
DROP VIEW IF EXISTS public.active_matches;

CREATE VIEW public.active_matches WITH (security_invoker = true) AS
 SELECT id, title, name, mode, entry_type, entry_fee, max_slots, filled_slots,
    prize_pool, first_prize, second_prize, third_prize, per_kill_prize, prize_type,
    map, status, scheduled_at, room_status, banner_url, stream_link, youtube_link,
    spectator_count, is_featured, is_sponsored, is_special, special_category,
    ads_required, min_rank, match_sub_type, creator_uid, creator_code,
    prize_distribution, result_screenshot, result_screenshots, result_published_at,
    cancelled_at, cancelled_by, completed_at, reminder_sent, data, created_at,
    updated_at, firebase_id, room_release_minutes, room_released_at
   FROM matches
  WHERE status = ANY (ARRAY['upcoming'::text, 'live'::text])
  ORDER BY scheduled_at;

GRANT SELECT ON public.active_matches TO anon, authenticated;
