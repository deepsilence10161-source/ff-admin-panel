-- ============================================================================
-- 2026-09-23b R3 PRODUCTION-HARDENING — BROKEN FEATURE RESTORE: win_streak
-- (APPLIED 2026-09-23 — live DB पर verified)
-- ----------------------------------------------------------------------------
-- PROBLEM (live-proven 2026-09-23):
--   features/streak.js (user panel, "Hot Streak" badge) ye update karta hai:
--     _s().from('users').update({win_streak:newStreak}).eq('id',_uid())
--   Lekin guard_users_self_update() trigger ki self-editable allowlist me
--   'win_streak' NAHI tha → har self-write 'Column win_streak is not
--   self-editable' (P0001) se 400 hota tha → feature silently broken tha
--   (qa1 live-probe: 400). User ko sirf leaderboard ka win_streak dikhta tha
--   jo kabhi update nahi hota tha.
--
-- FIX:
--   guard_users_self_update() v_allowed[] me 'win_streak' add. SAFE:
--   - win_streak = DISPLAY-ONLY stat (streak.entity label/badge). Koi financial
--     column nahi; koi reward RPC win_streak se coins/GD/SD/prize nahi deta.
--   - claim_streak_milestone -> streak_days padhta hai (checkin streak) —
--     win_streak nahi. Dono alag concepts.
--   - increment_balance() ab bhi (stats path) win_streak self-inc allow karta
--     tha (cap 100/call) — allowlist add uske consistent hai.
--   - baaki financial columns (coins/sky_diamonds/green_diamonds/premium_* /
--     is_admin/is_creator/is_banned/rank_points) SAME blocked hain.
--
-- VERIFY (live, 2026-09-23):
--   qa1 self-PATCH win_streak=7 → 204 (feature chalu); win_streak=0 restore →
--   204; coins=999999 self-mint → 400 'Column coins is not self-editable'
--   (suraksha ab bhi intact). qa1 coins 498 unchanged.
-- ============================================================================

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
    'squad_uids','updated_at','last_seen','win_streak',
    'state'
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
