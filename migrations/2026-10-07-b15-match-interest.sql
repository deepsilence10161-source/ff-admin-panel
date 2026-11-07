-- ═══════════════════════════════════════════════════════════════════════
--  B15 (2026-10-07) — "Mark as Interested" ka data admin tak pakka pahunche
-- ───────────────────────────────────────────────────────────────────────
--  KYA THA (user ki bug-list B15): "Interested in match ka data admin tak
--  pahunchta hi nahi — poora flow theek karo." 2026-10-04 ko aadha-ilaaj hua
--  tha (user panel seedha `match_interest` table me likhne laga, admin usi
--  table se count padhta hai) — par wo raasta client ke Supabase AUTH par
--  tikta hai (RLS: auth.uid() = user_id). Client ka token sync na ho / refresh
--  na ho to insert chupke se fail hota hai aur admin ko kuch nahi milta
--  (live DB me table khaali padi thi).
--
--  AB (house pattern — bilkul join_auto_squad_queue / get_my_poll_vote jaisa):
--    * toggle_match_interest(p_uid, p_match_id, p_name) — SECURITY DEFINER.
--      Pehchaan `auth.jwt() ->> 'sub'` se aati hai (Firebase JWT jo user panel
--      Supabase client me bhejta hai). p_uid sirf FALLBACK hai — agar token
--      sync na ho (ya koi purana client ho) to client wala uid chalega, taki
--      feature kabhi chupke se fail na ho. Insert/delete khud karta hai, aur
--      us match ka TAAZA count lauta deta hai.
--    * my_match_interests(p_uid) — user ke apne interested match ids, taki
--      button "✓ Interested" dikha sake (pehle koi state nahi thi — user ko
--      pata hi nahi chalta tha ki wo pehle se interested hai ya nahi).
--    * admin_match_interests(p_match_id?) — admin panel ke liye (is_caller_admin
--      ya service role), count + list ka bharosemand raasta.
--
--  NOTE: purani `match_interest` table + uski RLS policies waise hi hain
--  (admin panel aaj bhi unse padh sakta hai) — yeh sab ADDITIVE hai.
-- ═══════════════════════════════════════════════════════════════════════

/* Asli caller ka uid: JWT (Firebase) pehle, warna diya gaya fallback.
   ⚠️ SECURITY DEFINER ke andar `current_user` hamesha definer hota hai —
   isliye role/identity ke liye `auth.jwt()` / `session_user` dekho. */
CREATE OR REPLACE FUNCTION public._mi_uid(p_uid text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(NULLIF(btrim(COALESCE(auth.jwt() ->> 'sub', '')), ''), NULLIF(btrim(COALESCE(p_uid,'')), ''));
$fn$;

CREATE OR REPLACE FUNCTION public.toggle_match_interest(
  p_uid      text,
  p_match_id text,
  p_name     text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid    text;
  v_had    boolean;
  v_count  integer;
  v_name   text;
BEGIN
  v_uid := public._mi_uid(p_uid);

  IF v_uid IS NULL OR length(btrim(v_uid)) < 5 THEN
    RAISE EXCEPTION 'uid zaroori hai';
  END IF;
  IF p_match_id IS NULL OR length(btrim(p_match_id)) < 1 THEN
    RAISE EXCEPTION 'match id zaroori hai';
  END IF;

  /* naam client par bharosa karne ke bajaye DB se — IGN hi sach hai */
  SELECT COALESCE(NULLIF(u.ign, ''), NULLIF(btrim(p_name), ''), 'Player')
    INTO v_name
    FROM public.users u WHERE u.id = v_uid;
  v_name := COALESCE(v_name, NULLIF(btrim(p_name), ''), 'Player');

  SELECT EXISTS (
    SELECT 1 FROM public.match_interest
     WHERE match_id = p_match_id AND user_id = v_uid
  ) INTO v_had;

  IF v_had THEN
    DELETE FROM public.match_interest
     WHERE match_id = p_match_id AND user_id = v_uid;
  ELSE
    INSERT INTO public.match_interest (match_id, user_id, name)
    VALUES (p_match_id, v_uid, v_name)
    ON CONFLICT (match_id, user_id) DO NOTHING;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.match_interest WHERE match_id = p_match_id;

  RETURN jsonb_build_object('interested', NOT v_had, 'count', v_count, 'uid', v_uid);
END $fn$;

CREATE OR REPLACE FUNCTION public.my_match_interests(p_uid text DEFAULT NULL)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(array_agg(mi.match_id ORDER BY mi.match_id), ARRAY[]::text[])
    FROM public.match_interest mi
   WHERE mi.user_id = COALESCE(public._mi_uid(p_uid), '');
$fn$;

CREATE OR REPLACE FUNCTION public.admin_match_interests(p_match_id text DEFAULT NULL)
RETURNS TABLE (match_id text, user_id text, name text, interested_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  /* admin panel ka client (Firebase JWT) ya service role — dono chalenge.
     ⚠️ SECURITY DEFINER ke andar `current_user` HAMESHA definer (postgres)
     hota hai — pehle wahi check likha tha aur wo har caller ko andar kar deta
     tha (anon ne bhi list padh li — live test me pakda gaya). Sahi tareeka:
     `session_user` (asli connecting role) aur `auth.role()` (JWT ka role). */
  IF NOT (
      public.is_caller_admin()
      OR session_user IN ('postgres', 'supabase_admin', 'service_role')
      OR COALESCE(auth.role(), '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'sirf admin';
  END IF;

  RETURN QUERY
    SELECT mi.match_id, mi.user_id, mi.name, mi.created_at
      FROM public.match_interest mi
     WHERE p_match_id IS NULL OR mi.match_id = p_match_id
     ORDER BY mi.created_at DESC
     LIMIT 500;
END $fn$;

GRANT EXECUTE ON FUNCTION public._mi_uid(text)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_match_interest(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_match_interests(text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_match_interests(text)           TO anon, authenticated;

-- ek (match, user) ki ek hi row — toggle ka ON CONFLICT isi par tike
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_interest'::regclass AND contype IN ('p','u')
  ) THEN
    ALTER TABLE public.match_interest
      ADD CONSTRAINT match_interest_pk PRIMARY KEY (match_id, user_id);
  END IF;
END $$;
