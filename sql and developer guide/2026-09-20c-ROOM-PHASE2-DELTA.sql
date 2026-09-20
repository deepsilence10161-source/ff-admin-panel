-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20c ROOM-LEAK PHASE-2 — LIVE DATABASE ME RUN HO CHUKA HAI ✅
-- ═══════════════════════════════════════════════════════════════════
-- R3-2 room-leak ka SERVER-SIDE permanent fix (Phase-1: RPC + client-strip
-- ho chuka tha — 2026-09-20b-R3-FIX-DELTA.sql / user commit de2a2eb).
--
-- AB ARCHITECTURE:
--   • matches.room_id / matches.room_password hamesha NULL rehte hain
--     (defaults bhi NULL). select('*') / realtime WS payloads me creds
--     KABHI nahi jaate — raw REST bhi safe.
--   • Creds sirf `match_rooms` table me: anon/authenticated ke liye
--     SELECT-only + RLS admin-policy (panel roles INSERT/UPDATE/DELETE
--     nahi kar sakte; service_role/definer full).
--   • `trg_redirect_match_room_secrets` trigger: kisi bhi writer (admin
--     inline-edit, supabase-sync, RTDB-bridge, legacy code) ke room cols
--     likhne par creds TRANSPARENTLY match_rooms me redirect + matches
--     me NULL. Clear (NULL/'') likhne par match_rooms row delete.
--     → Kisi existing client write-path me change NAHI karna pada.
--   • Reads: sirf get_room_credentials() RPC (joined+release-window;
--     owner/admin bypass). creator_set_room ab seedha match_rooms likhta
--     hai + matches.room_status='saved' set karta hai (host-screen
--     'room set?' check ab room_status se).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. MATCH_ROOMS table (creds ka naya ghar)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_rooms (
  match_id      TEXT PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  room_id       TEXT NOT NULL,
  room_password TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_rooms_admin_read ON public.match_rooms;
CREATE POLICY match_rooms_admin_read ON public.match_rooms
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.jwt() ->> 'sub' AND COALESCE(is_admin, false)));

REVOKE ALL ON public.match_rooms FROM anon, authenticated;
GRANT SELECT ON public.match_rooms TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. MIGRATION (live pe run ho chuka — fresh env par dobara chale to)
-- ─────────────────────────────────────────────────────────────
-- 2a. backfill (order matter karta hai):
-- INSERT INTO public.match_rooms(match_id, room_id, room_password, updated_at)
-- SELECT id, BTRIM(room_id), COALESCE(BTRIM(room_password), ''), NOW()
-- FROM matches WHERE room_id IS NOT NULL AND BTRIM(room_id) <> ''
-- ON CONFLICT (match_id) DO UPDATE SET room_id = EXCLUDED.room_id,
--   room_password = EXCLUDED.room_password, updated_at = NOW();
-- 2b. matches me NULL + defaults NULL (trigger install se PEHLE):
-- UPDATE matches SET room_id = NULL, room_password = NULL
--   WHERE room_id IS NOT NULL OR room_password IS NOT NULL;
ALTER TABLE matches ALTER COLUMN room_id SET DEFAULT NULL;
ALTER TABLE matches ALTER COLUMN room_password SET DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. REDIRECT TRIGGER (writers untouched)
--    NOTE: 'BEFORE INSERT OR UPDATE OF' — INSERT par bhi fire hota hai
--    (new matches ka DEFAULT ''/NULL ELSE-branch jaata hai — harmless).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redirect_match_room_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  /* FIX (2026-09-20c Phase-2): matches me room creds KABHI store na ho.
     Non-null room_id → match_rooms me redirect + matches me NULL.
     NULL/'' (clear) → match_rooms row delete. */
  IF NEW.room_id IS NOT NULL AND BTRIM(NEW.room_id) <> '' THEN
    INSERT INTO match_rooms(match_id, room_id, room_password, updated_at)
    VALUES (NEW.id, BTRIM(NEW.room_id), COALESCE(BTRIM(NEW.room_password), ''), NOW())
    ON CONFLICT (match_id) DO UPDATE
      SET room_id = EXCLUDED.room_id, room_password = EXCLUDED.room_password, updated_at = NOW();
    NEW.room_id := NULL;
    NEW.room_password := NULL;
  ELSE
    DELETE FROM match_rooms WHERE match_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_redirect_match_room_secrets ON matches;
CREATE TRIGGER trg_redirect_match_room_secrets
  BEFORE INSERT OR UPDATE OF room_id, room_password
  ON matches
  FOR EACH ROW EXECUTE FUNCTION public.redirect_match_room_secrets();

-- ─────────────────────────────────────────────────────────────
-- 4. creator_set_room v2 — match_rooms par seedha + room_status='saved'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT creator_uid, status INTO v_owner, v_status FROM matches WHERE id = p_match_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_found'); END IF;
  IF v_owner <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_your_match'); END IF;
  IF v_status NOT IN ('upcoming', 'live') THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_active'); END IF;
  IF p_room_id IS NULL OR LENGTH(TRIM(p_room_id)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_room_id');
  END IF;

  /* FIX (2026-09-20c Phase-2): creds match_rooms me, matches me sirf
     non-secret room_status='saved' (host-screen 'room set?' check isi se). */
  INSERT INTO match_rooms(match_id, room_id, room_password, updated_at)
  VALUES (p_match_id, TRIM(p_room_id), TRIM(COALESCE(p_room_password, '')), NOW())
  ON CONFLICT (match_id) DO UPDATE
    SET room_id = EXCLUDED.room_id, room_password = EXCLUDED.room_password, updated_at = NOW();
  UPDATE matches SET status = 'live', room_status = 'saved' WHERE id = p_match_id;

  RETURN jsonb_build_object('success', true);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 5. get_room_credentials v3 — match_rooms source + owner/admin bypass
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_room_credentials(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_m RECORD;
  v_creds RECORD;
  v_allowed BOOLEAN;
  v_is_owner BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT status, scheduled_at, room_release_minutes, room_released_at, room_status, creator_uid
    INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_found');
  END IF;
  IF v_m.status NOT IN ('live','upcoming','completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_available');
  END IF;

  /* FIX (Phase-2): creds ab match_rooms se (matches me hote hi nahi). */
  SELECT room_id, room_password INTO v_creds FROM match_rooms WHERE match_id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'room_not_set');
  END IF;

  SELECT COALESCE(v_m.creator_uid = v_uid, false),
         COALESCE((SELECT is_admin FROM users WHERE id = v_uid), false)
    INTO v_is_owner, v_is_admin;

  IF v_is_owner OR v_is_admin THEN
    /* Host/admin ko apna room hamesha dikh sakta hai */
    RETURN jsonb_build_object('success', true, 'room_id', v_creds.room_id, 'room_password', v_creds.room_password);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM join_requests WHERE user_id = v_uid AND match_id = p_match_id AND status IN ('pending','joined','checked_in')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_joined');
  END IF;

  v_allowed := (v_m.room_status = 'released' AND v_m.room_released_at IS NOT NULL AND v_m.room_released_at <= NOW())
            OR (NOW() >= v_m.scheduled_at - COALESCE(v_m.room_release_minutes, 5) * INTERVAL '1 minute');
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_released_yet');
  END IF;

  UPDATE join_requests SET status = 'checked_in'
  WHERE user_id = v_uid AND match_id = p_match_id AND status = 'joined';

  RETURN jsonb_build_object('success', true, 'room_id', v_creds.room_id, 'room_password', v_creds.room_password);
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live, P2 battery):
--  ✓ set_room → match_rooms row + room_status='saved' + matches NULL
--  ✓ owner-bypass (host ko apna room), player early → not_released_yet
--  ✓ trigger redirect: admin direct write → match_rooms + matches NULL
--  ✓ clear flow: NULL write → match_rooms row delete
--  ✓ release (matches.room_status) → player ko creds (full loop)
--  ✓ GLOBAL: matches me room_id/room_password/'' = 0 rows (creds-free)
--  ✓ UI: room popup match_rooms-backed RPC se creds (live panel)
--  ✓ Regression: E2E_POSTDEPLOY 8/8, PUBLISH_GOLD FULL PASS
--  ✓ RTDB matches public-read already blocked (Permission denied)
-- ═══════════════════════════════════════════════════════════════
