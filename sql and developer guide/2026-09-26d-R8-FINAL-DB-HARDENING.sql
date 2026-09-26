-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-26d — R8 FINAL DB HARDENING  (FIX #1 + FIX #2 + FIX #3)
-- Mini Esports · Supabase project hddhkculuyrfoevxmlwy
--
-- Scope (and NOTHING else — no UI, no features, no working system touched):
--   FIX #1  admin_adjust_wallet: real row lock (SELECT ... FOR UPDATE) so two
--           concurrent admin adjustments can never lose an update (TOCTOU).
--   FIX #2  Admin-only SECURITY DEFINER RPCs must not be anon/authenticated
--           executable. 27 genuinely admin-only RPCs are revoked to
--           service_role-only, and the Admin Panel reaches them through the
--           trusted backend path `admin-gateway` (Supabase Edge Function,
--           Firebase-ID-token verified server-side) via DB wrapper
--           `admin_gateway_exec()` — no service_role key in any frontend.
--   FIX #3  RLS enablement (deny-all) for the internal idempotency/audit
--           tables season_finalizations + suggestion_rewards.
--
-- IDEMPOTENT: safe to re-run any number of times (verified 3x).
-- NO secrets / credentials in this file.
--
-- Classification evidence (live, before this migration):
--   • Every panel request (user AND admin, including admin@fft.com) runs as
--     Postgres role `anon` — verified with a SECURITY INVOKER probe over the
--     real PostgREST transport (apikey + Firebase ID token). Therefore role
--     separation alone can never separate admin from user; only a
--     service_role-capable backend can.  That is what FIX #2 provides.
--   • All 27 functions below already carry an internal admin guard
--     (is_admin / is_caller_admin). The guard STAYS (defence in depth);
--     this migration removes the public EXECUTE surface on top of it.
--   • User-action RPCs (join/claim/redeem/checkin/team/clan/premium/voucher/
--     BP/mission/cosmetic/withdraw ...) are deliberately NOT in this list and
--     keep their anon EXECUTE — they are legitimate client paths.
--   • is_caller_admin() is intentionally NOT revoked: 4 RLS policies call it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- FIX #1 — admin_adjust_wallet: FOR UPDATE row lock
--
-- Was:  EXECUTE format('SELECT COALESCE(%I,0) FROM users WHERE id=$1') ...
--       (unlocked read → two concurrent calls both read the same balance and
--        write the same absolute value → lost update)
-- Now:  the same column-whitelisted read takes a real row lock; the balance
--       UPDATE executes inside the same transaction while the row is locked.
--       Everything else (admin/service authorization, column whitelist
--       coins/sky_diamonds/green_diamonds, non-zero + |amount| <= 999999
--       sanity, insufficient-balance protection, wallet_transactions ledger,
--       return shape) is byte-for-byte preserved.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_uid text,
  p_col text,
  p_amount numeric,
  p_reason text DEFAULT 'Admin adjustment'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_is_admin   BOOLEAN;
  v_current    NUMERIC;
  v_new        NUMERIC;
  v_txn_type   TEXT;
BEGIN
  /* Authorization: JWT caller MUST be an admin; service_role = trusted backend. */
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  IF p_col NOT IN ('coins','sky_diamonds','green_diamonds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid column');
  END IF;
  IF p_amount = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-zero');
  END IF;
  IF ABS(p_amount) > 999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount too large');
  END IF;

  /* R8 FINAL (FIX #1): row-level lock. p_col is whitelisted above, %I is
     injection-safe, and FOR UPDATE holds the users row until this
     transaction ends — the UPDATE below therefore happens under the lock. */
  EXECUTE format('SELECT COALESCE(%I, 0) FROM public.users WHERE id = $1 FOR UPDATE', p_col)
    USING p_uid INTO v_current;
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new := v_current + p_amount;
  IF v_new < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance',
                              'balance', v_current, 'requested', ABS(p_amount));
  END IF;

  /* Executes while the same users row is still locked (same transaction). */
  EXECUTE format('UPDATE public.users SET %I = $1 WHERE id = $2', p_col)
    USING v_new, p_uid;

  v_txn_type := CASE WHEN p_amount < 0 THEN 'admin_debit' ELSE 'admin_credit' END;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, created_at)
  VALUES (p_uid, p_col, v_txn_type, ABS(p_amount), p_reason, 'approved', NOW());

  RETURN jsonb_build_object('success', true, 'old_balance', v_current,
                            'new_balance', v_new, 'direction', v_txn_type);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- FIX #2a — trusted-backend dispatcher for the 27 admin-only RPCs
--
-- Only service_role (i.e. the `admin-gateway` Edge Function) may execute it.
-- It (1) re-verifies the actor is a real admin inside the DB, then
-- (2) injects the verified caller claims into the transaction so the target
-- function's own guard still sees a real admin identity, and (3) calls the
-- allow-listed function by name with the caller's arguments.
-- A caller-supplied uid can never be trusted here: p_actor comes from the
-- Edge Function's server-side Firebase token verification, and it is
-- re-checked against users.is_admin == true.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_gateway_exec(
  p_fn text,
  p_args jsonb DEFAULT '{}'::jsonb,
  p_actor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_allowed TEXT[] := ARRAY[
    'admin_adjust_wallet','admin_approve_profile','admin_confirm_creator_cheat',
    'admin_create_sponsored_match','admin_dismiss_creator_flag','admin_distribute_sponsored_prize',
    'admin_end_current_season','admin_reject_profile','admin_revoke_referral_bonus',
    'admin_reward_suggestion','admin_roll_battle_pass_season','admin_send_broadcast_notification',
    'admin_send_notification','admin_set_coins','admin_set_fraud_score','admin_sync_user_balance',
    'approve_creator_application','approve_premium','cancel_match_with_refunds','cancel_premium',
    'correct_match_result','publish_match_results','reject_creator_application',
    'release_eligible_commissions','resolve_sd_request','resolve_sponsored_withdrawal',
    'set_user_ban_status'
  ];
  v_is_priv BOOLEAN := (current_user IN ('postgres','supabase_admin','service_role'))
                       OR (current_setting('role', true) = 'service_role');
  v_args    JSONB := COALESCE(p_args, '{}'::jsonb);
  v_names   TEXT[];
  v_types   TEXT[];
  v_parts   TEXT[] := ARRAY[]::TEXT[];
  v_i       INT;
  v_sql     TEXT;
  v_result  JSONB;
BEGIN
  IF NOT v_is_priv THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  IF p_fn IS NULL OR NOT (p_fn = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'fn_not_allowed');
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_actor AND is_admin = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin only');
  END IF;

  /* Server-derived audit identity — never the client's word. */
  IF p_fn = 'cancel_match_with_refunds' THEN
    v_args := jsonb_set(v_args, '{p_admin_uid}', to_jsonb(p_actor), true);
  END IF;

  SELECT array_agg(x.n ORDER BY x.i), array_agg(format_type(x.ty, NULL) ORDER BY x.i)
    INTO v_names, v_types
    FROM (
      SELECT i, p.proargnames[i] AS n, p.proargtypes[i-1] AS ty
      FROM pg_proc p, generate_series(1, COALESCE(array_length(p.proargnames,1),0)) AS i
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_fn
    ) x;

  IF v_names IS NULL THEN
    v_sql := format('SELECT to_jsonb(public.%I())', p_fn);
  ELSE
    FOR v_i IN 1 .. array_length(v_names, 1) LOOP
      CONTINUE WHEN NOT (v_args ? v_names[v_i]);
      IF v_types[v_i] = 'jsonb' THEN
        v_parts := v_parts || format('%I => $1', v_names[v_i]);
      ELSE
        v_parts := v_parts || format('%I => ($2->>%L)::%s', v_names[v_i], v_names[v_i], v_types[v_i]);
      END IF;
    END LOOP;
    v_sql := format('SELECT to_jsonb(public.%I(%s))', p_fn, array_to_string(v_parts, ', '));
  END IF;

  /* Verified admin identity for the target function's own guard (txn-local). */
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_actor, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true);

  EXECUTE v_sql USING v_args, v_args INTO v_result;
  RETURN COALESCE(v_result, '{}'::jsonb);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_gateway_exec(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gateway_exec(text, jsonb, text) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- FIX #2b — EXECUTE cleanup for the 27 genuinely admin-only RPCs.
-- Loop-based so every overload/signature is covered and re-running is a no-op.
-- Admin Panel calls these via the trusted backend path (admin-gateway);
-- service_role keeps full capability.
-- ───────────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  r    RECORD;
  v_fns TEXT[] := ARRAY[
    'admin_adjust_wallet','admin_approve_profile','admin_confirm_creator_cheat',
    'admin_create_sponsored_match','admin_dismiss_creator_flag','admin_distribute_sponsored_prize',
    'admin_end_current_season','admin_reject_profile','admin_revoke_referral_bonus',
    'admin_reward_suggestion','admin_roll_battle_pass_season','admin_send_broadcast_notification',
    'admin_send_notification','admin_set_coins','admin_set_fraud_score','admin_sync_user_balance',
    'approve_creator_application','approve_premium','cancel_match_with_refunds','cancel_premium',
    'correct_match_result','publish_match_results','reject_creator_application',
    'release_eligible_commissions','resolve_sd_request','resolve_sponsored_withdrawal',
    'set_user_ban_status'
  ];
BEGIN
  FOR r IN
    SELECT p.oid,
           format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_fns)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;

-- ───────────────────────────────────────────────────────────────────────────
-- FIX #3 — RLS on internal idempotency/audit tables (deny-all for clients).
-- No policies are created on purpose: these tables are written/read ONLY by
-- SECURITY DEFINER server functions (owner = postgres → RLS bypassed) and by
-- service_role (BYPASSRLS). No frontend reads them (verified repo-wide).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.season_finalizations (
  season_name text PRIMARY KEY,
  finalized_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suggestion_rewards (
  suggestion_key text PRIMARY KEY,
  rewarded_at    timestamptz DEFAULT now()
);

ALTER TABLE public.season_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggestion_rewards   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.season_finalizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.suggestion_rewards   FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.season_finalizations TO service_role;
GRANT ALL ON TABLE public.suggestion_rewards   TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Post-apply sanity output (read-only; safe to ignore)
-- ───────────────────────────────────────────────────────────────────────────
SELECT p.proname AS fn,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('admin_adjust_wallet','admin_set_coins','publish_match_results',
                     'set_user_ban_status','cancel_match_with_refunds','admin_gateway_exec')
 ORDER BY p.proname;
