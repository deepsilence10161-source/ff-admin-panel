-- ═══════════════════════════════════════════════════════════════════════
--  B26 (2026-10-07) — Daily Check-In rewards ab admin ke editor se aate hain
-- ───────────────────────────────────────────────────────────────────────
--  KYA THA (user ki bug-list B26): "Daily Bonus Editor + Mission Rewards me
--  duplicate → saaf karo, user panel se connect karo."
--
--  JANCH KA NATIJAA (repo ke COMPLETE_SCHEMA se padha gaya — live function se
--  apply se PEHLE dobara diff karna hai, neeche note dekho):
--    * `process_daily_checkin` 2026-09-20 (Round-4) se teeno params IGNORE
--      karta hai aur SERVER CONSTANTS par chalta hai:
--         tiers = {5,7,10,12,15,20,30} (7-din cycle), day-30 par +100.
--      (Wajah: tampered client ne {9999}+50000 bhej kar 59,999 coins nikaal
--      liye the — isliye params ignore kiye gaye the. Woh suraksha BARQARAR
--      rahegi: params aage bhi ignore hi honge.)
--    * Iska matlab: admin ke "Daily Check-In Coins" (checkinCoins) aur
--      "7-Day Streak Bonus" (checkinStreakBonus7) — dono DEAD settings thi,
--      aur Quick Tools ka "Daily Bonus Editor" (Firebase
--      appSettings/dailyBonusRewards) bhi bilkul asar-kaam nahi tha.
--
--  AB KYA HOTA HAI (iske saath admin+user panel ke code changes jude hain):
--    1. Rewards ka EK source: `app_settings.live_config.dailyBonusRewards`
--       {day1..day7, day30Bonus} — admin ka Daily Bonus Editor yahi likhta hai.
--    2. Yeh function usi key se tiers/milestone UTHAATA hai (server-side) —
--       client params jaise the waise IGNORE (tamper-proof rehta hai).
--    3. Value missing/glt ho to purane constants (5,7,10,12,15,20,30 / 100)
--       par fallback — yani is migration se kisi user ka reward kam nahi hota.
--
--  ⚠️ APPLY SE PEHLE: live par `select pg_get_functiondef('process_daily_checkin')`
--     chala kar confirm karo ki body is file se match karti hai (koi baad ka
--     change chhoot na jaye), phir apply karo.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.process_daily_checkin(
  p_tier_rewards   numeric[] DEFAULT NULL,
  p_milestone_bonus numeric DEFAULT NULL,
  p_milestone_days integer   DEFAULT NULL
)
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
  v_cfg JSONB;
  v_t NUMERIC;
  i INT;
BEGIN
  /* teeno params ab bhi IGNORE — server constants/config hi source hain
     (tampered client ne {9999}+50000 bhej kar 59,999 coins nikaal liye the;
     wahi suraksha yahan bani hui hai — sirf source badla hai). */
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  /* ✅ B26: admin ke Daily Bonus Editor ki values (live_config.
     dailyBonusRewards). Kuch bhi galat/missing ho to purane constants chalu. */
  SELECT value -> 'dailyBonusRewards' INTO v_cfg
    FROM public.app_settings WHERE key = 'live_config' LIMIT 1;

  IF v_cfg IS NOT NULL AND jsonb_typeof(v_cfg) = 'object' THEN
    FOR i IN 1..7 LOOP
      BEGIN
        v_t := (v_cfg ->> ('day' || i))::numeric;
      EXCEPTION WHEN others THEN
        v_t := NULL;
      END;
      IF v_t IS NOT NULL AND v_t > 0 AND v_t <= 10000 THEN
        v_tiers[i] := v_t;
      END IF;
    END LOOP;
    BEGIN
      v_t := (v_cfg ->> 'day30Bonus')::numeric;
      IF v_t IS NOT NULL AND v_t >= 0 AND v_t <= 100000 THEN
        v_ms_bonus := v_t;
      END IF;
    EXCEPTION WHEN others THEN
      NULL; /* purana 100 hi chalega */
    END;
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

  /* audit-trail — wallet_transactions me ledger entry */
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

-- ═══════════════════════════════════════════════════════════════════════
--  CONFIG SAFAAI (मरे/duplicate keys)
-- ═══════════════════════════════════════════════════════════════════════

-- 1) live_config: dailyBonusRewards ki asli jagah banao (agar pehle se nahi
--    hai to defaults daalo — wahi jo server constants the, taki behaviour
--    bilkul same rahe).
--    ⚠️ `dailyBonusRewardsLive: true` MARKER zaroori hai: user panel usi ko
--    dekh kar config lagata hai (aur admin editor bhi usi se "applied" batata
--    hai). Iske bina client jaan-bujh kar purane server constants dikhata hai —
--    taki button naya reward dikha kar server purana na de (UI ka jhooth na ho).
UPDATE public.app_settings
   SET value = jsonb_set(
         jsonb_set(
           value - 'checkinCoins' - 'checkinStreakBonus7',
           '{dailyBonusRewards}',
           COALESCE(value -> 'dailyBonusRewards',
                    '{"day1":5,"day2":7,"day3":10,"day4":12,"day5":15,"day6":20,"day7":30,"day30Bonus":100}'::jsonb),
           true),
         '{dailyBonusRewardsLive}',
         'true'::jsonb,
         true)
 WHERE key = 'live_config';

-- 2) B24: video_moderation row (mara hua feature) — hata do.
DELETE FROM public.app_settings WHERE key = 'video_moderation';

-- 3) creator_system: minFollowersForSD (B25 me row hata, koi padhta nahi) hata.
--    ⚠️ coinMatchCommissionPct JAAN-BUJH KAR nahi hata rahe — usse
--    finalize_creator_commission (coin-match fallback) padhta hai; wo paisa
--    ka raasta hai, usse bina zarurat chhedna theek nahi. Panel ab use
--    likhta/likhwata nahi (COALESCE se 10 default hi chalta hai).
UPDATE public.app_settings
   SET value = value - 'minFollowersForSD'
 WHERE key = 'creator_system';

-- 4) Saboot (manual verify ke liye):
--    select key, value ? 'dailyBonusRewards' as has_dbr,
--           (value ? 'checkinCoins') as has_old_checkin,
--           jsonb_object_keys_count from ...
--    (apply ke baad niche ka query chalao)
-- SELECT key, value->'dailyBonusRewards' AS dbr FROM app_settings WHERE key='live_config';
-- SELECT count(*) FROM app_settings WHERE key='video_moderation';   -- 0 hona chahiye
