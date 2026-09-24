-- ════════════════════════════════════════════════════════════════════
-- 2026-09-24c  R7 FOLLOW-UP — AUTHORITATIVE LEDGER + GRANT CLASSIFICATION + EXTENSIONS
-- --------------------------------------------------------------------
-- Idempotent · applies to public schema · append-only (no destructive change)
--
--   F1  admin_adjust_wallet RPC  — ONE atomic admin wallet mutation.
--        Server does the read-modify-write (FOR-UPDATE-style row lock via
--        single UPDATE) AND writes the wallet_transactions ledger inside
--        the same RPC → single authoritative mutation. Client (admin JS)
--        sends only (uid, col, ±amount, reason); never trusted to enqueue
--        its own ledger rows.
--   F2  finalize_creator_commission  — external client invoke band.
--        body regression-proof: authenticated caller can no longer reach
--        it (creator_publish_result's internal SECDEF PERFORM unaffected —
--        that runs as function owner, not by EXECUTE grant).
--   F3  net.http_*  — REVOKE client EXECUTE / schema USAGE (SSRF clamp).
--        Note: pg_net is NON-relocatable and its functions are owned by
--        supabase_admin; if this role (postgres) lacks grantor privilege
--        the REVOKE no-ops — verified separately in this session.
-- ════════════════════════════════════════════════════════════════════
BEGIN;

/* ────────────────────────────────────────────────────────────────────
   F1  admin_adjust_wallet — single authoritative atomic ledger mutation
   ──────────────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
    p_uid    text,
    p_col    text,             -- 'coins' | 'sky_diamonds' | 'green_diamonds'
    p_amount numeric,          -- +ve = credit, -ve = debit
    p_reason text DEFAULT 'Admin adjustment'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  /* Read current balance with row lock (single UPDATE below is the atomic
     gate; read-then-update inside one plpgsql txn is race-free). */
  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1', p_col)
    USING p_uid INTO v_current;
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new := v_current + p_amount;
  IF v_new < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance',
                              'balance', v_current, 'requested', ABS(p_amount));
  END IF;

  EXECUTE format('UPDATE users SET %I = $1 WHERE id = $2', p_col)
    USING v_new, p_uid;

  v_txn_type := CASE WHEN p_amount < 0 THEN 'admin_debit' ELSE 'admin_credit' END;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, created_at)
  VALUES (p_uid, p_col, v_txn_type, ABS(p_amount), p_reason, 'approved', NOW());

  RETURN jsonb_build_object('success', true, 'old_balance', v_current,
                            'new_balance', v_new, 'direction', v_txn_type);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_wallet(text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(text, text, numeric, text) TO authenticated, service_role;

/* ────────────────────────────────────────────────────────────────────
   F2  finalize_creator_commission — client invoke band
   (creator_publish_result's internal PERFORM unaffected: nested SECDEF
   call runs as function owner, not via EXECUTE grant)
   ──────────────────────────────────────────────────────────────────── */
REVOKE ALL ON FUNCTION public.finalize_creator_commission(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(text) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_creator_commission(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(text, boolean) TO service_role;

/* ────────────────────────────────────────────────────────────────────
   F3  net.http_*  — SSRF clamp
   pg_net is NON-relocatable (extrelocatable=false) and lives in the
   `net` schema; notifications_push_hook calls net.http_post schema-
   qualified, so relocation is impossible by design. Client roles get
   EXECUTE/USAGE revoked. (Owner is supabase_admin — if this role cannot
   revoke, this statement no-ops; keep for idempotent re-application.)
   ──────────────────────────────────────────────────────────────────── */
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO service_role, postgres;
REVOKE USAGE ON SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA net TO postgres, service_role;

COMMIT;
