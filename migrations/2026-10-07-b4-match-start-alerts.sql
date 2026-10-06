-- ═══════════════════════════════════════════════════════════════════════
--  B4 (2026-10-07) — "Match shuru hone wala hai" alert: SERVER se OneSignal push
-- ───────────────────────────────────────────────────────────────────────
--  KYA THA (user ki bug-list, B4): "5 minute pehle ki notification sirf panel
--  me dikhi, browser notification nahi aayi." Client-side code (admin
--  fa-admin-v10-final.js ka 5-min alert + user panel ka setupMatchAlerts)
--  sirf tab chalta hai jab app/panel KHULA ho aur us window ko Notification
--  ki permission mili ho — is liye asli push kabhi nahi gaya.
--
--  AB (asli ilaaj): yeh function har minute (cron) un matches ko dekhta hai jo
--  `matchStartAlertMins` (default 5, admin Settings se badalta hai) minute ke
--  andar shuru hone wale hain, aur unke SAARE joined players ke liye
--  `notifications` row banata hai. Us table par BEFORE INSERT guard + AFTER
--  INSERT `notifications_push_hook` trigger lagte hain → hook push-send ko
--  call karta hai → OneSignal push (app band ho tab bhi pahunchti hai).
--
--  IDEMPOTENT: har (user, match) ke liye ek hi 'match_starting' row —
--  NOT EXISTS check ki wajah se cron dobara chalne par duplicate push nahi.
--  (matches.reminder_sent ko JAAN-BOOJH KAR nahi use kiya — wo purane admin
--   "30 min" reminder ka flag hai, dono ek doosre ko nahi rokte.)
--
--  ROW BY ROW try/except: ek kharab row (delete ho chuka user / FK fail)
--  poore batch ko nahi rokta (wahi sabak jo send_due_match_reminders me tha).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_match_start_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lead int;
  v_now  timestamptz := now();
  v_sent int := 0;
  r      record;
  v_n    int;
BEGIN
  /* Lead time admin Settings se (live_config.matchStartAlertMins, default 5) */
  SELECT COALESCE((value->>'matchStartAlertMins')::int, 5) INTO v_lead
    FROM public.app_settings WHERE key = 'live_config';
  v_lead := GREATEST(1, COALESCE(v_lead, 5));

  FOR r IN
    SELECT m.id,
           COALESCE(NULLIF(m.name, ''), NULLIF(m.title, ''), 'Match') AS nm,
           m.scheduled_at
      FROM public.matches m
     WHERE m.status = 'upcoming'
       AND m.scheduled_at IS NOT NULL
       AND m.scheduled_at >  v_now
       AND m.scheduled_at <= v_now + (v_lead || ' minutes')::interval
     ORDER BY m.scheduled_at
     LIMIT 50
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, body, ref_id)
      SELECT DISTINCT ON (jr.user_id)
             jr.user_id,
             'match_starting',
             '⚡ ' || r.nm || ' shuru hone wala hai!',
             r.nm || ' ' ||
               GREATEST(1, CEIL(EXTRACT(EPOCH FROM (r.scheduled_at - v_now)) / 60)::int) ||
               ' minute mein start hoga — room ke liye ready ho jao!',
             r.id
        FROM public.join_requests jr
       WHERE jr.match_id = r.id
         AND jr.user_id IS NOT NULL
         AND COALESCE(jr.status, 'joined') NOT IN ('rejected', 'cancelled', 'refunded')
         AND NOT EXISTS (
               SELECT 1 FROM public.notifications n
                WHERE n.user_id = jr.user_id
                  AND n.type    = 'match_starting'
                  AND n.ref_id  = r.id)
       ORDER BY jr.user_id;

      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_sent := v_sent + v_n;
    EXCEPTION WHEN OTHERS THEN
      /* ek match ki galti poore batch ko rok na de */
      RAISE WARNING 'match_start_alert fail (match=%): %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_sent;
END $fn$;

REVOKE ALL ON FUNCTION public.send_match_start_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_match_start_alerts() TO service_role;

/* Har minute — wahi cadence jo sync_match_statuses / send_due_match_reminders
   ka hai, taki status update hone ke turant baad alert nikal sake. */
SELECT cron.schedule('send-match-start-alerts', '* * * * *',
                     'select public.send_match_start_alerts();');
