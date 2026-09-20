-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20m ROUND-9 — REMAINING RPC AUDIT + FRAUD-TOOL RULES-FIX
-- ═══════════════════════════════════════════════════════════════════
-- LIVE-CONFIRMED + FIXED:
--   R9-1 ★ claim_ad_reward ×8 parallel → 8/8 SUCCESS +80 coins
--     (daily-cap 5 ka bhi ulangh — koi lock nahi tha; coin-printer).
--     FIX: FOR UPDATE on users (watch_earn pattern). Re-probe ×8 →
--     1 success (+10), baki 'Too soon' ✅
--   R9-2 claim_referral_reward: race probe ×4 → UNIQUE(referred_id) ne
--     bacha liya (0 double) — safe as-is ✅ (recommend: FOR UPDATE
--     hygiene jab bhi touch ho).
--   R9-3 increment_own_match_played: uncapped +1 (rank-score matches-
--     component farm). FIX v3: users.mpm_today/mpm_day cols + 50/day cap.
--     Re-probe ×55 → exactly 50 succeeded ✅  (v2 me PL/pgSQL bare-column
--     bug tha — SELECT INTO me day-col bhi saath padha)
--   R9-4 submit_gd_withdrawal / redeem_reward_item / creator_create_match:
--     audit clean (jwt + FOR UPDATE + caps + balance-checks) ✅
--   R9-5 increment_match_filled_slots: stub (koi mutation nahi) ✅
--
-- ADMIN-PANEL (code fixes, is repo me):
--   R9-6 ★ Fraud tools deviceJoins ROOT-read karte the — Round-2 rules ne
--     deny kiya (privacy) → permission_denied. FIX: naya
--     js/admin-devicejoins-bridge.js — users.device_fp list (Supabase)
--     → PER-DEVICE RTDB reads (allowed) → same data-shape walkers.
--     Patched: features-admin.js runFraudCheck, v24 fa73_detectIPClusters,
--     v24 runFraudCheck (paginated) + numChildren replacement.
--   R9-7 Broadcast/PrizeCalc tools: koi real error nahi (slow-init
--     warning harness-timing ki thi). Dashboard init 15s warning =
--     bridge-wait budget — documented, feature intact.
-- ═══════════════════════════════════════════════════════════════════

-- R9-1: claim_ad_reward v2 (FOR UPDATE) — poora body live se, diff sirf lock:
--   (body COMPLETE_SCHEMA Part M me; anchor ke turant baad:)
--   PERFORM 1 FROM users WHERE id = v_caller FOR UPDATE;

-- R9-3: increment_own_match_played v3 + cols
ALTER TABLE users ADD COLUMN IF NOT EXISTS mpm_today INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mpm_day DATE;

CREATE OR REPLACE FUNCTION public.increment_own_match_played()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_today DATE := CURRENT_DATE;
  v_cnt INT;
  v_day DATE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  /* Round-9: 50/day cap (rank-score matches-component farm band) */
  PERFORM 1 FROM users WHERE id = v_caller FOR UPDATE;
  SELECT COALESCE(mpm_today, 0), mpm_day INTO v_cnt, v_day FROM users WHERE id = v_caller;
  IF COALESCE(v_day, '1970-01-01') <> v_today THEN v_cnt := 0; END IF;
  IF v_cnt >= 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Daily limit reached');
  END IF;
  UPDATE users
     SET total_matches = COALESCE(total_matches, 0) + 1,
         mpm_today = v_cnt + 1,
         mpm_day = v_today
   WHERE id = v_caller;
  RETURN jsonb_build_object('success', true);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.increment_own_match_played() TO anon, authenticated;
