-- ════════════════════════════════════════════════════════════════════════
-- B22 (leftover) — "New Season" button asal me ZINDA karna
-- 2026-10-07 · ff-admin-panel/migrations/2026-10-07-b22-start-season-rpc.sql
--
-- जड़ (live-proven): dashboard header ka "New Season" button
-- `window.startNewSeason()` bulata hai (js/fa-admin-v10-final.js:1183).
-- Us function me teen dikkatein thi:
--   (a) `prompt()` — B3 ke shim (js/app-dialog.js) usse app-UI dialog me
--       badal deta hai aur TURANT null return karta hai → `if (!name) return;`
--       hamesha सच → button kabhi kuch karta hi nahi tha (dead button).
--   (b) likhta tha purane Firebase-bridge path `appSettings/currentSeason` par
--       (bridge → app_settings row), yaani B18 ke canonical save path se ALAG.
--   (c) koi admin guard / validation / atomicity nahi.
--
-- Ab: ek hi authoritative server RPC — `admin_start_new_season()` — jo bilkul
-- WAHI rows/shapes likhta hai jo B18 wala admin Settings save likhta hai
-- (fa-app-settings-v2.js):
--     app_settings.currentSeason = { id, name, active(true), startDate(ISO),
--                                    endDate(ISO|null), seasonNum(old+1) }
--     app_settings.live_config   = seasonName / seasonActive(1) /
--                                  seasonEndDays(din) / seasonEndDate(ms)
-- Season ka aakhiri hissa (ranking + reward) pehle se
-- `admin_end_current_season()` karta hai — is RPC se sirf season SHURU hota hai.
-- Admin guard bilkul usi tarah (Firebase JWT ka `sub` = users.id, is_admin),
-- ya service_role (cron/system).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_start_new_season(p_name text, p_days int DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_admin   BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_name       TEXT := btrim(COALESCE(p_name, ''));
  v_days       INT  := COALESCE(p_days, 90);
  v_old        JSONB;
  v_num        INT;
  v_end_ms     BIGINT;
  v_row        JSONB;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  IF length(v_name) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'season_name_required');
  END IF;
  IF length(v_name) > 40 THEN
    v_name := left(v_name, 40);
  END IF;
  IF v_days < 1 OR v_days > 3650 THEN
    RETURN jsonb_build_object('success', false, 'error', 'days_out_of_range');
  END IF;

  SELECT value INTO v_old FROM app_settings WHERE key = 'currentSeason';
  v_num    := COALESCE((v_old ->> 'seasonNum')::INT, 1) + 1;
  v_end_ms := (extract(epoch from now()) * 1000)::BIGINT + (v_days::BIGINT * 86400000);

  /* naya season row — Settings (B18) wala hi shape, sirf active/naam/tareekh naye */
  v_row := jsonb_build_object(
    'id',        COALESCE(v_old ->> 'id', 'S' || ((extract(epoch from now()) * 1000)::BIGINT)::text),
    'name',      v_name,
    'active',    true,
    'startDate', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endDate',   to_char((to_timestamp(v_end_ms / 1000.0)) AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'seasonNum', v_num
  );

  INSERT INTO app_settings(key, value, updated_at, updated_by)
  VALUES ('currentSeason', v_row, now(), COALESCE(v_caller, 'system'))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;

  /* live_config: sirf season keys (baaki 60+ keys jaisi hain waisi) */
  UPDATE app_settings
     SET value = value || jsonb_build_object(
                   'seasonName',    v_name,
                   'seasonActive',  1,
                   'seasonEndDays', v_days,
                   'seasonEndDate', v_end_ms),
         updated_at = now(),
         updated_by = COALESCE(v_caller, 'system')
   WHERE key = 'live_config';

  RETURN jsonb_build_object(
    'success', true,
    'season',  v_row,
    'prevSeasonNum', COALESCE((v_old ->> 'seasonNum')::INT, 1)
  );
END;
$function$;

/* Master rule #6: har naye function par EXECUTE grant */
GRANT EXECUTE ON FUNCTION public.admin_start_new_season(text, int) TO anon, authenticated, service_role;
