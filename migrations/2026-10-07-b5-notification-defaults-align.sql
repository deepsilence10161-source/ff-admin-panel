CREATE OR REPLACE FUNCTION public.set_match_reminder(p_uid text, p_match_id text, p_mins integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now        bigint;
  v_match_ms   bigint;
  v_mins       integer;
  v_at         bigint;
  v_def        integer;
  v_default_ms bigint;
BEGIN
  IF p_uid IS NULL OR length(btrim(p_uid)) < 5 THEN
    RAISE EXCEPTION 'uid zaroori hai';
  END IF;
  IF p_match_id IS NULL OR length(btrim(p_match_id)) < 1 THEN
    RAISE EXCEPTION 'match id zaroori hai';
  END IF;

  SELECT COALESCE((value->>'matchReminderMins')::int, 30)
    INTO v_def
    FROM public.app_settings WHERE key = 'live_config';
  v_def := COALESCE(v_def, 30);

  v_now := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;

  SELECT (EXTRACT(EPOCH FROM m.scheduled_at) * 1000)::bigint
    INTO v_match_ms
    FROM public.matches m WHERE m.id = p_match_id;

  IF v_match_ms IS NULL OR v_match_ms <= 0 THEN
    RAISE EXCEPTION 'Match ka samay nahi mila';
  END IF;
  IF v_match_ms <= v_now THEN
    RAISE EXCEPTION 'Match shuru ho chuka hai — ab reminder set nahi ho sakta';
  END IF;

  -- user की चुनी अवधि; 1 min se 24 ghante ke andar, aur match ke baad kabhi nahi
  v_mins := GREATEST(1, LEAST(COALESCE(p_mins, v_def), 1440));
  v_default_ms := v_match_ms - (v_mins * 60000);

  IF v_default_ms <= v_now THEN
    -- match में इतना कम समय बचा है कि चुना गया समय बीत चुका — तुरंत भेजो
    v_at   := v_now + 5000;
    v_mins := GREATEST(1, ((v_match_ms - v_at) / 60000)::int);
  ELSE
    v_at := v_default_ms;
  END IF;

  INSERT INTO public.match_reminders (user_id, match_id, match_time, remind_at, remind_mins, created_at)
  VALUES (p_uid, p_match_id, v_match_ms, v_at, v_mins, now())
  ON CONFLICT (user_id, match_id) DO UPDATE
     SET match_time  = EXCLUDED.match_time,
         remind_at   = EXCLUDED.remind_at,
         remind_mins = EXCLUDED.remind_mins,
         created_at  = now();

  RETURN jsonb_build_object(
    'ok', true,
    'remind_at', v_at,
    'remind_mins', v_mins,
    'match_time', v_match_ms,
    'in_minutes', GREATEST(0, ((v_at - v_now) / 60000)::int)
  );
END $function$
;

CREATE OR REPLACE FUNCTION public.send_due_match_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        record;
  v_name   text;
  v_sent   integer := 0;
  v_now    bigint;
  v_def    integer;
  v_left   integer;
BEGIN
  v_now := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;

  SELECT COALESCE((value->>'matchReminderMins')::int, 30)
    INTO v_def FROM public.app_settings WHERE key = 'live_config';
  v_def := COALESCE(v_def, 30);

  FOR r IN
    SELECT mr.user_id, mr.match_id, mr.match_time,
           COALESCE(mr.remind_at, mr.match_time - (v_def * 60000)) AS remind_at
      FROM public.match_reminders mr
     WHERE COALESCE(mr.remind_at, mr.match_time - (v_def * 60000)) <= v_now
       AND mr.match_time > v_now
     ORDER BY mr.match_time
     LIMIT 200
  LOOP
    /* ✅ (2026-10-06) har reminder apne try/except me — pehle ek kharab
       row (jaise delete ho chuka user, FK fail) POORE batch ko rok deti thi
       aur kisi ko bhi reminder nahi jata tha. */
    BEGIN
      SELECT m.name INTO v_name FROM public.matches m WHERE m.id = r.match_id;
      v_name := COALESCE(v_name, 'Match');
      v_left := GREATEST(1, ((r.match_time - v_now) / 60000)::int);

      INSERT INTO public.notifications (user_id, type, title, body, ref_id)
      SELECT r.user_id, 'match_reminder',
             '⏰ Match reminder: ' || v_name,
             v_name || ' ' || v_left || ' minutes mein start hoga. Room ID ready rakho!',
             r.match_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = r.user_id AND n.type = 'match_reminder' AND n.ref_id = r.match_id
      );

      DELETE FROM public.match_reminders
       WHERE user_id = r.user_id AND match_id = r.match_id;

      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reminder fail (user=%, match=%): %', r.user_id, r.match_id, SQLERRM;
      /* bhale hi notification na jaye, purani row ko hamesha ke liye pada na
         chhodo — warna cron har minute wahi row uthata rahega */
      DELETE FROM public.match_reminders
       WHERE user_id = r.user_id AND match_id = r.match_id;
    END;
  END LOOP;

  RETURN v_sent;
END $function$
;
