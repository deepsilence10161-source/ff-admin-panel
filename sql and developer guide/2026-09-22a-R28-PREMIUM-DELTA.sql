-- ═══════════════════════════════════════════════════════════════════
-- R28 ROUND DELTA — 2026-09-22a
-- क्षेत्र: user-panel Premium audioit (Early Match Access ab ASLI)
-- चलाया गया: Supabase Mgmt API से (LIVE-EXECUTED, live-verified)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) get_room_credentials v4 — Diamond (tier 3) Early Access ──
-- पहले premium-copy "Early Match Access — 15/10 min pehle" ka daava
-- tha par RPC me koi premium-gate tha hi nahi (room sabko ek hi window
-- par milta tha). Daava ya to jhootha tha ya adhoora.
-- Ab: unexpired premium_level>=3 wale JOINED user ko room_id standard
-- release (room_release_minutes) se +10 min pehle milta hai. Join-check
-- (not_joined) pehle hi hota hai — ye sirf WINDOW badhata hai, room
-- access ka koi bypass nahi. security-definer + auth.jwt() pehle jaisa.
CREATE OR REPLACE FUNCTION public.get_room_credentials(p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_m RECORD;
  v_creds RECORD;
  v_allowed BOOLEAN;
  v_is_owner BOOLEAN;
  v_is_admin BOOLEAN;
  v_prem INT;
  v_prem_exp TIMESTAMPTZ;
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

  SELECT room_id, room_password INTO v_creds FROM match_rooms WHERE match_id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'room_not_set');
  END IF;

  SELECT COALESCE(v_m.creator_uid = v_uid, false),
         COALESCE((SELECT is_admin FROM users WHERE id = v_uid), false)
    INTO v_is_owner, v_is_admin;

  IF v_is_owner OR v_is_admin THEN
    RETURN jsonb_build_object('success', true, 'room_id', v_creds.room_id, 'room_password', v_creds.room_password);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM join_requests WHERE user_id = v_uid AND match_id = p_match_id AND status IN ('pending','joined','checked_in')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_joined');
  END IF;

  /* R28 (2026-09-22): Diamond (tier 3) Early Access — room_id standard
     release se 10 min pehle, sirf unexpired premium. Join-check upar hi
     hota hai, ye sirf window badhata hai. */
  SELECT COALESCE(premium_level, 0), premium_expires INTO v_prem, v_prem_exp
    FROM users WHERE id = v_uid;

  v_allowed := (v_m.room_status = 'released' AND v_m.room_released_at IS NOT NULL AND v_m.room_released_at <= NOW())
            OR (NOW() >= v_m.scheduled_at - COALESCE(v_m.room_release_minutes, 5) * INTERVAL '1 minute')
            OR (COALESCE(v_prem, 0) >= 3
                AND (v_prem_exp IS NULL OR v_prem_exp > NOW())
                AND v_m.status = 'upcoming'
                AND NOW() >= v_m.scheduled_at - (COALESCE(v_m.room_release_minutes, 5) + 10) * INTERVAL '1 minute');
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_released_yet');
  END IF;

  UPDATE join_requests SET status = 'checked_in'
  WHERE user_id = v_uid AND match_id = p_match_id AND status = 'joined';

  RETURN jsonb_build_object('success', true, 'room_id', v_creds.room_id, 'room_password', v_creds.room_password);
END;
$function$;

-- VERIFY (live, 2026-09-22):
--  ✓ pg_get_functiondef contains '+10' early window + tier3 gate
--  ✓ join-check (not_joined) intact — access ka koi bypass nahi
-- ═══════════════════════════════════════════════════════════════════
