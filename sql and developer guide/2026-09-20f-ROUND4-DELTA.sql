-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20f ROUND-4 DELTA — LIVE RUN ✅ (deep-testing continue round)
-- ═══════════════════════════════════════════════════════════════════
-- Round-4 fresh-eyes sweep me 3 AUR economy holes mile (sab exploit-
-- verified apne hi QA accounts par, phir fix, phir verify):
--
-- R4-1 ★ process_daily_checkin — MONEY-PRINTER (live-exploited):
--       p_tier_rewards/p_milestone_bonus/p_milestone_days caller-
--       controlled the. Tampered call {9999}+50000+1 → 59,999 coins
--       EK CALL ME (qa3 par live prove kiya). PLUS: koi wallet_transactions
--       entry nahi thi (audit gap — sab checkin-users ka ledger-drift).
--       FIX v2: teeno params IGNORE; server constants ARRAY[5,7,10,12,15,20,30],
--       milestone 100 @30-day streak; wtxn 'daily_checkin' (+milestone
--       alag line). Verify: tampered→5 (day-1), dup same-day block, ledger ✓.
--
-- R4-2 ★ award_mentor_reward — UNLIMITED GD-MINTER:
--       student apne mentor ko koi bhi GD-amount credit kar sakta tha
--       (p_gd_amount 99999 → 99999 GD; student ka kuch nahi katata;
--       2 colluding accounts = infinite premium-currency). Tier-check
--       sirf client-side tha. FIX v2: p_gd_amount IGNORE; server khud
--       student ke rank_points se tier nikalta hai (Bronze1…Legend6),
--       reward = 20 × (new_tier − last_rewarded_tier); naya column
--       mentor_requests.last_rewarded_tier INT NOT NULL DEFAULT 0;
--       repeat-calls 'no_new_tier'. Verify: tampered-99999→40 (delta2),
--       repeat→no_new_tier, rank-up→+40. 3/3 ✓
--
-- R4-3 claim_premium_monthly_bonus — OVERPAY: p_bonus_coins ≤1000 accept
--       hota tha (panel 50/150/400 bhejta hai; tampered 1000 bhej ke
--       +600/month). FIX v2: server-map {1:50,2:150,3:400}; tier must
--       match active premium_level; month-dedup (UNIQUE user_id+month_key
--       pehle se tha, ab EXCEPTION-handler bhi). Verify: 999→50, dedup,
--       wrong-tier reject. 3/3 ✓
--
-- R4-4 2-arg claim_battle_pass_tier(season_key, tier) — legacy overload
--       (rewardCoins-based) DROP kiya (panel 4-arg use karta hai; meera
--       seed rewardCoins rakhta hi nahi → dead surface).
--
-- VERIFIED-SAFE (is sweep me):
--   • 18 crediting RPCs audited — baaki sab server-derived ✓
--   • admin_confirm_creator_cheat / admin_dismiss_creator_flag — is_admin
--     guard andar ✓ (broad grants ke bawajood)
--   • apply_referral_code / claim_referral_reward — server-config, self-ref
--     blocked ✓
--   • RTDB matches root-read DENIED (deployed rules strict) ✓
--   • Known data-notes (action nahi liya): 'Sponsor1' match filled_slots=0
--     vs 1 join (purana sponsored-join path, real user ka row — touch nahi);
--     Hunter7 ledger-drift 54 (5 checkin + 49 pre-ledger-era) — historical.
-- ═══════════════════════════════════════════════════════════════════

-- ── R4-1: process_daily_checkin v2 ──
CREATE OR REPLACE FUNCTION public.process_daily_checkin(p_tier_rewards numeric[] DEFAULT NULL, p_milestone_bonus numeric DEFAULT NULL, p_milestone_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_last DATE;
  v_streak INT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_yesterday DATE := v_today - 1;
  v_new_streak INT;
  v_cycle_pos INT;
  v_reward NUMERIC;
  v_milestone NUMERIC := 0;
  v_tiers NUMERIC[] := ARRAY[5, 7, 10, 12, 15, 20, 30];
  v_ms_bonus NUMERIC := 100;
  v_ms_days INT := 30;
BEGIN
  /* FIX (2026-09-20 Round-4): teeno params ab IGNORE — server constants.
     (Tampered client ne {9999}+50000+1 bheja to 59,999 coins mil rahe the
     — exploit live-confirm kiya gaya tha.) Panel koi args nahi bhejta. */
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT last_checkin_date::date, streak_days INTO v_last, v_streak
    FROM users WHERE id = v_caller FOR UPDATE;
  IF v_last IS NOT NULL AND v_last = v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_checked_in', 'streak', v_streak);
  END IF;

  IF v_last IS NOT NULL AND v_last = v_yesterday THEN
    v_new_streak := COALESCE(v_streak, 0) + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  v_cycle_pos := ((v_new_streak - 1) % array_length(v_tiers, 1)) + 1;
  v_reward := v_tiers[v_cycle_pos];
  IF v_ms_days > 0 AND v_new_streak % v_ms_days = 0 THEN
    v_milestone := v_ms_bonus;
  END IF;

  UPDATE users SET last_checkin_date = v_today, streak_days = v_new_streak,
    coins = COALESCE(coins,0) + v_reward + v_milestone WHERE id = v_caller;
  INSERT INTO daily_checkins (user_id, checkin_date, coins_earned, streak_day)
    VALUES (v_caller, v_today, v_reward + v_milestone, v_new_streak)
    ON CONFLICT (user_id, checkin_date) DO NOTHING;

  /* FIX: audit-trail — ab wallet_transactions bhi (pehle sirf users.coins
     update hota tha, ledger me kuch nahi jaata tha). */
  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_caller, 'coins', 'credit', v_reward, 'daily_checkin');
  IF v_milestone > 0 THEN
    INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
    VALUES (v_caller, 'coins', 'credit', v_milestone, 'checkin_milestone');
  END IF;

  RETURN jsonb_build_object('success', true, 'streak', v_new_streak, 'reward', v_reward,
    'milestone_bonus', v_milestone, 'total', v_reward + v_milestone);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.process_daily_checkin(numeric[], numeric, integer) TO anon, authenticated;

-- ── R4-2: mentor_requests column + award_mentor_reward v2 ──
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS last_rewarded_tier INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_active BOOLEAN;
  v_rp INT;
  v_tier INT;
  v_last_tier INT;
  v_delta INT;
  v_gd INT;
BEGIN
  /* FIX (2026-09-20 Round-4): p_gd_amount IGNORE — reward server khud
     compute karta hai (rank-points se tier, 20 GD per NEW tier). */
  IF v_caller IS NULL OR v_caller <> p_student_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM mentor_requests
    WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted'
  ) INTO v_is_active;
  IF NOT v_is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active mentorship found');
  END IF;

  SELECT COALESCE(rank_points, 0) INTO v_rp FROM users WHERE id = p_student_uid;
  v_tier := CASE
    WHEN v_rp >= 2001 THEN 6
    WHEN v_rp >= 1501 THEN 5
    WHEN v_rp >= 1001 THEN 4
    WHEN v_rp >= 601  THEN 3
    WHEN v_rp >= 301  THEN 2
    ELSE 1 END;

  SELECT COALESCE(last_rewarded_tier, 0) INTO v_last_tier
    FROM mentor_requests
    WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted'
    FOR UPDATE;
  v_delta := v_tier - v_last_tier;
  IF v_delta <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_new_tier', 'tier', v_tier);
  END IF;
  v_gd := 20 * v_delta;

  UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_gd WHERE id = p_mentor_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(p_mentor_uid, 'green_diamonds', 'credit', v_gd, 'mentor_reward', p_student_uid);

  INSERT INTO mentor_profiles(user_id, gd_earned, successful_students)
  VALUES(p_mentor_uid, v_gd, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    gd_earned = mentor_profiles.gd_earned + v_gd,
    successful_students = mentor_profiles.successful_students + 1;

  UPDATE mentor_requests SET last_rewarded_tier = v_tier
  WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted';

  RETURN jsonb_build_object('success', true, 'gd_awarded', v_gd, 'tier', v_tier, 'delta', v_delta);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.award_mentor_reward(text, text, integer) TO anon, authenticated;

-- ── R4-3: claim_premium_monthly_bonus v2 ──
CREATE OR REPLACE FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_prem INT;
  v_month TEXT := TO_CHAR(NOW(), 'YYYY-MM');
  v_bonus INT;
BEGIN
  /* FIX (2026-09-20 Round-4): p_bonus_coins IGNORE — server-map
     {1:50, 2:150, 3:400} (panel CFG.bonuses jaisa). */
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  IF p_tier NOT IN (1,2,3) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid tier');
  END IF;
  v_bonus := CASE p_tier WHEN 1 THEN 50 WHEN 2 THEN 150 ELSE 400 END;

  SELECT COALESCE(premium_level, 0) INTO v_prem FROM users WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_prem, 0) <> p_tier THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is tier ka premium active nahi hai');
  END IF;

  INSERT INTO premium_monthly_bonus_claims(user_id, month_key, tier, bonus_coins)
  VALUES (v_uid, v_month, p_tier, v_bonus);
  UPDATE users SET coins = COALESCE(coins,0) + v_bonus WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', v_bonus, 'premium_bonus', 'Monthly Premium Bonus Tier ' || p_tier);

  RETURN jsonb_build_object('ok', true, 'bonus', v_bonus, 'month', v_month);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Is month ka bonus le liya');
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(integer, integer) TO authenticated;

-- ── R4-4: legacy 2-arg overload drop ──
DROP FUNCTION IF EXISTS public.claim_battle_pass_tier(text, integer);
