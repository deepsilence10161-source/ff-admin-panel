-- ═══════════════════════════════════════════════════════════════════
-- R24 ROUND DELTA — 2026-09-21w
-- चलाया गया: Supabase Mgmt API से (LIVE-EXECUTED, live-verified)
-- क्रम: R24 money-chain E2E दौरान मिले fixes
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) guard_users_self_update: self-editable list में 'state' जोड़ा ──
-- BUG (live-proven, qauser3): user-panel का IT-Rules State-Gate
-- (legal-compliance.js mesStateOk) users.update({state}) करता है —
-- guard की v_allowed array में 'state' नहीं था → "Column state is not
-- self-editable" → हर नया user state-gate पर स्थायी-फँसाव (mesStateOk
-- का catch-branch toast करके modal खुली रखता है)। qa1/qa2 को gate इसलिए
-- नहीं मिला क्योंकि उनकी state पहले से भरी थी।
-- सुरक्षा: कोई कमी नहीं — banned states (Telangana/AP/TN) mesStateBan
-- path से block होते हैं, write तक पहुँचते ही नहीं; own-row + allowed-
-- list नियंत्रण पहले जैसा। COMPLETE_SCHEMA C.2 में भी वही अद्यतन।
CREATE OR REPLACE FUNCTION public.guard_users_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role')
      OR (current_user IN ('postgres','supabase_admin','service_role'));
  v_allowed TEXT[] := ARRAY[
    'avatar_url','avatar_bg_color','banner_url','bio','city','phone',
    'is_live','stream_link','stream_title','rival_uid','fcm_token',
    'fcm_updated_at','device_fp','clan_id','referral_code',
    'referral_popup_done','profile_status','pending_ign',
    'profile_request_count','duo_team','squad_team','partner_uid',
    'squad_uids','updated_at','last_seen',
    'state'  /* R24 FIX (2026-09-21): mesStateOk() IT-compliance state-gate
                was permanently stuck for every new user — 'Column state is
                not self-editable' (live-proven qauser3). */
  ];
  v_col TEXT;
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
BEGIN
  IF v_is_service OR (v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false)) THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NULL OR v_caller <> OLD.id THEN
    RAISE EXCEPTION 'Not authorized to update this user row';
  END IF;
  FOR v_col IN SELECT jsonb_object_keys(v_new) LOOP
    IF NOT (v_col = ANY(v_allowed)) THEN
      IF v_old -> v_col IS DISTINCT FROM v_new -> v_col THEN
        RAISE EXCEPTION 'Column % is not self-editable', v_col;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- (कोई table/column बदलाव नहीं — केवल function-body।)
-- सत्यापन: patch后的 pg_get_functiondef में R24-comment मौजूद ✓;
-- qauser3 live-login → state/age/terms gates सब पार → join+publish E2E ✓
