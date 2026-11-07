-- ═══════════════════════════════════════════════════════════════════════
-- GEHRI AUDIT (2026-10-07) — live_config ka chup-chaap hue wipe ko wapas sahi
-- ═══════════════════════════════════════════════════════════════════════
-- Kya hua tha (live proof): B24/B26 migration (2026-10-07-b24-b26-...sql) ne
-- live_config me `dailyBonusRewards` + marker `dailyBonusRewardsLive: true`
-- daale the. Uske baad admin panel ke Settings → "Save" ne poori live_config
-- ko apne form-object se REPLACE kar diya (upsert value = config) — jisme ye
-- do keys nahi thi — aur wo dono DB se gayab ho gaye. Natija: admin ka Daily
-- Bonus Editor bekaar (client marker na dekh kar purane constants dikhata tha,
-- server config padhta hai = UI vs server mismatch), jabki comment/UI dono
-- "connected" batate the.
--
-- Ab code ka root-cause bhi fix hai (fa-app-settings-v2.js me read-modify-write
-- + sirf mare hue keys ki delete-list), aur ye migration data wapas laata hai.
-- Dono ek saath: value wapas + dobara wipe hone ka rasta band.
--
-- Idempotent: dobara chalane par kuch nahi bigadta (COALESCE + jsonb_set true).
-- ═══════════════════════════════════════════════════════════════════════

UPDATE public.app_settings
   SET value = jsonb_set(
         jsonb_set(
           value,
           '{dailyBonusRewards}',
           COALESCE(value -> 'dailyBonusRewards',
                    '{"day1":5,"day2":7,"day3":10,"day4":12,"day5":15,"day6":20,"day7":30,"day30Bonus":100}'::jsonb),
           true),
         '{dailyBonusRewardsLive}',
         'true'::jsonb,
         true),
       updated_at = now()
 WHERE key = 'live_config';

-- Saboot (apply ke baad apne aap chalta hai):
DO $$
DECLARE v JSONB;
BEGIN
  SELECT value INTO v FROM public.app_settings WHERE key = 'live_config';
  IF v -> 'dailyBonusRewards' IS NULL OR (v ->> 'dailyBonusRewardsLive') <> 'true' THEN
    RAISE EXCEPTION 'live_config restore fail — dailyBonusRewards/marker maujood nahi';
  END IF;
  RAISE NOTICE '✅ live_config: dailyBonusRewards=% , marker=%', v -> 'dailyBonusRewards', v ->> 'dailyBonusRewardsLive';
END $$;
