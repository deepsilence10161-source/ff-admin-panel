-- ============================================================================
-- 2026-09-26a — R7 P0 FIXES (client financial authority removal + slot accounting)
-- ============================================================================
-- P0 findings इस delta + client-rewire से resolve होते हैं:
--   1. saveMhCorrections() → correct_match_result() RPC          (admin-inline-e.js)
--   2. _publishResults()  → publish_match_results() RPC          (features-admin.js)
--   3. confirmWithdrawal() → resolve_sd_request / resolve_sponsored_withdrawal
--                                                                (admin-fixes-v24-FINAL.js inert)
--   4. increment_match_filled_slots → client access band         (यह delta, DB-side)
--
-- सिर्फ़ [4] को DB change चाहिए; [1][2][3] client-side rewire हैं
-- (single-authoritative server RPC; Firebase money-write हटाए गए)।
--
-- [4] CLASSIFICATION:
--   • increment_match_filled_slots का कोई live client caller नहीं — user panel
--     join (validate_and_join_match / join_match_team / join_match_team via
--     form_auto_squad_team / ad-watch join) अपने अंदर ही सर्वर-side
--     `UPDATE matches SET filled_slots = COALESCE(filled_slots,0) + v_slots`
--     करते हैं (FOR UPDATE row-lock के साथ, single-txn atomic)।
--   • db-bridge का `matches/{mid}/joinedSlots` → इसे कभी कोई client writer
--     नहीं भेजता (PRE-BOOKING REMOVED — R5); mapping ही legacy है।
--   • इसलिए anon EXECUTE revoke सुरक्षित है: कोई working join path नहीं टूटता।
--   • service_role / postgres intact (server triggers/admin scripts unaffected).
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.increment_match_filled_slots(p_match_id text) FROM anon;

COMMIT;
