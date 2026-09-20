-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20q ROUND-15 — EXECUTE-AUDIT + 5 BROKEN-FEATURES FIX
-- ═══════════════════════════════════════════════════════════════════
-- ★ ROOT-DISCOVERY: Firebase-JWT (third-party auth) requests Postgres me
--   ROLE=ANON ke saath chalte hain (token me role-claim nahi hota; sirf
--   auth.jwt()->>'sub' = firebase-uid milta hai). Isliye panel-facing RPCs
--   ko **anon** ko EXECUTE chahiye — authenticated grant kaafi NAHI.
--
-- BROKEN MILA + FIX (live-verified):
--   R15-1 redeem_reward_item → EXECUTE anon missing → reward-store
--         redemption 100% dead tha. GRANT anon → E2E: 1000→500 exact +
--         redemption-row + ledger ✓
--   R15-2 claim_referral_reward → anon missing → users referral claim
--         kar hi nahi paate the. GRANT → full-flow: dono +50 ✓
--         RACE re-test ×4: UNIQUE(referred_id) → 1/4, rows=1 ✓
--         (R9 ka "race-safe" verdict permission-denied artifact tha —
--         corrected now)
--   R15-3 claim_match_refund → anon missing. GRANT → cancelled-match
--         refund: +5, jr→refunded ✓ (eligibility: match cancelled hi)
--   R15-4 claim_no_show_refund → anon missing. GRANT → +5, jr→no_show ✓
--   R15-5 submit_gd_withdrawal → anon missing → GD-withdrawal dead!
--         GRANT → GD 20→10 + pending sd_request + ledger ✓
--
-- SECURITY-CORRECTIONS (is round me kiye):
--   • increment_poll_vote(uuid,text) — vote-rigger definer fn — anon/
--     authenticated REVOKE (service-only) [R7 me galti se grant hua tha]
--   • internal_process_no_show_refunds() — cron fn — anon/auth REVOKE
--     (service-only restore)
--   • support_tickets: st_update_admin policy ADD (admin status/reply
--     writes; user-edit blocked — verified)
--
-- INTENTIONALLY service-only (verified blocked): increment_match_filled_slots
-- (stub), increment_poll_vote, internal_process_no_show_refunds
--
-- LESSON: EXECUTE-audit dono roles par karo (anon + authenticated).
--   "authenticated me hai" ≠ "client chala payega" (Firebase-JWT=anon).
-- ═══════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.redeem_reward_item(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_match_refund(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_no_show_refund(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_gd_withdrawal(numeric,numeric,text,text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_poll_vote(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.internal_process_no_show_refunds() FROM anon, authenticated;

CREATE POLICY st_update_admin ON support_tickets FOR UPDATE TO anon, authenticated
USING ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true))
WITH CHECK ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true));
