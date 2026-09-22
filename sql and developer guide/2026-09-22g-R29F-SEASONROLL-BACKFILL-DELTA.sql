-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-22g-R29F-SEASONROLL-BACKFILL-DELTA.sql
-- R29F (2026-09-22) — (A) join_requests.ign_at_join BACKFILL (display-name
-- only, non-financial) — R24 fix ke baad ke naye joins khud bhar lenge, ye
-- purane 6 rows (fix se pehle ke, khali) ke liye hai.
-- (B) admin_roll_battle_pass_season() — one-click monthly season roll
-- (admin-only). Agla month bhoolna = koi season nai = users ki BP screen
-- "Season not found" — ab RPC + admin Season Manager card handle karta hai.
-- (C) admin-roll GRANT.
-- ═══════════════════════════════════════════════════════════════════

-- (A) backfill ign_at_join from user_ign else users.ign
UPDATE join_requests jr
SET ign_at_join = COALESCE(NULLIF(jr.user_ign, ''), NULLIF(u.ign, ''), '')
FROM users u
WHERE jr.user_id = u.id
  AND (jr.ign_at_join IS NULL OR jr.ign_at_join = '');

-- (B) admin_roll_battle_pass_season — admin-only monthly season roll
CREATE OR REPLACE FUNCTION public.admin_roll_battle_pass_season()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_admin BOOLEAN;
  v_cur battle_passes%ROWTYPE;
  v_next_key TEXT;
  v_next_num INT;
  v_start DATE;
  v_end DATE;
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
  END IF;
  SELECT is_admin INTO v_admin FROM users WHERE id = v_uid;
  IF NOT COALESCE(v_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
  END IF;
  SELECT * INTO v_cur FROM battle_passes WHERE is_active = true ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active season found');
  END IF;
  IF v_cur.end_date IS NOT NULL AND v_cur.end_date >= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Current season abhi chal raha hai (ends ' || v_cur.end_date || ') — mahina khatam hone ke baad roll karo');
  END IF;
  v_next_num := COALESCE(v_cur.season_num, 0) + 1;
  v_start := date_trunc('month', CURRENT_DATE) + interval '1 month';
  v_end := (date_trunc('month', CURRENT_DATE) + interval '2 months' - interval '1 day')::date;
  v_next_key := to_char(v_start, 'YYYY_MM');
  IF EXISTS (SELECT 1 FROM battle_passes WHERE season_key = v_next_key) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Season ' || v_next_key || ' already exists');
  END IF;
  v_name := 'Season ' || v_next_num || ' — ' || trim(to_char(v_start, 'Mon')) || ' ' || to_char(v_start, 'YYYY');
  UPDATE battle_passes SET is_active = false WHERE is_active = true;
  INSERT INTO battle_passes(id, name, season_num, season_key, is_active, tiers, start_date, end_date)
  VALUES (gen_random_uuid(), v_name, v_next_num, v_next_key, true, v_cur.tiers, v_start, v_end);
  RETURN jsonb_build_object('ok', true, 'season', v_next_key, 'name', v_name, 'tiers', jsonb_array_length(v_cur.tiers));
END;
$function$;

-- (C) grant
REVOKE EXECUTE ON FUNCTION public.admin_roll_battle_pass_season() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_roll_battle_pass_season() TO anon, authenticated, service_role;

-- NOTE: battle_passes.season_key par UNIQUE constraint NAHI hai — roll RPC
-- pehle EXISTS-check karta hai; seed import se bachne ke liye INSERT se
-- pehle SELECT-count karo (COMPLETE_SCHEMA me bhi note hai).
-- END
