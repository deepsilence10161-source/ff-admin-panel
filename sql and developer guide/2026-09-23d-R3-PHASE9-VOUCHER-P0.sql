-- ================================================================
-- 2026-09-23d — R3 Production-Hardening — Phase 9 (Data/RLS)
-- P0: vouchers catalog किसी authenticated user द्वारा editable था
--     (v_update_auth: USING (sub IS NOT NULL)) और publicly readable
--     (v_select_all: USING true). redeem_voucher() — SECURITY
--     DEFINER, owner postgres — reward इसी table से पढ़ता है, isliye
--     user apni row ki reward_amount/status/max_uses/used_count edit
--     karke exploit kar sakta tha (LIVE-PROVEN: qa1 no-op PATCH →
--     200 OK + representation).
--
-- FIX: vouchers ab ADMIN-ONLY read/write (RLS deny-by-default).
--     redeem_voucher() SECURITY DEFINER hai (owner postgres,
--     relforcerowsecurity=false) → table-owner bypass से server-side
--     redemption UNCHANGED kaam karta hai. Admin panel (is_admin JWT)
--     v_admin_write (ALL) से पढ़/लिख सकता है। User panel vouchers
--     table को कभी direct select/update नहीं करता (redeem_voucher
--     RPC ही use करता है — verified: user-repo में .from('vouchers')
--     कोई reference नहीं)।
-- ================================================================

-- 1) user-editable UPDATE policy हटाओ
DROP POLICY IF EXISTS v_update_auth ON public.vouchers;

-- 2) public SELECT policy हटाओ (codes + reward amounts अब enumerate नहीं होंगे)
DROP POLICY IF EXISTS v_select_all ON public.vouchers;

-- 3) explicit admin select/update (redundant with v_admin_write ALL, but explicit & future-proof)
DROP POLICY IF EXISTS v_admin_select ON public.vouchers;
CREATE POLICY v_admin_select ON public.vouchers FOR SELECT
  USING ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true));

DROP POLICY IF EXISTS v_admin_update ON public.vouchers;
CREATE POLICY v_admin_update ON public.vouchers FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true))
  WITH CHECK ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true));
