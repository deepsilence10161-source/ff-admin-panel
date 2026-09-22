-- ═══════════════════════════════════════════════════════════════════
-- R29 ROUND DELTA — 2026-09-22b
-- क्षेत्र: (1) user_public_profiles privacy leak fix
--         (2) admin-panel maintenance/preview realtime (code-only, is file
--             me sirf SQL नहीं — admin-inline.js / features-admin.js)
-- चलाया गया: Supabase Mgmt API से (LIVE-EXECUTED, live-verified)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) PRIVACY: user_public_profiles से phone + referral_code हटाना ──
-- Live-proof (2026-09-22): anon (बिना login) इस view से kisi bhi
-- registered user ka `phone` aur `referral_code` पढ़ सकता था —
-- referral_code असली values (e.g. Hunter7 ka TYHTZFON) leak hue.
-- Root: view security_invoker=false (definer, RLS-bypass) + GRANT SELECT
-- TO anon + phone/referral_code columns shamil the.
--
-- User-panel client kabhi in columns ko select/output नहीं karta tha
-- (sab call-sites whitelisted columns select karte hain) — leak view-level
-- tha, direct PostgREST query se hota tha. Fix: view re-create bina
-- phone/referral_code. Dependents: referral_leaderboard (JOIN के साथ) —
-- pehle drop, aakhir me re-create.

DROP VIEW IF EXISTS public.referral_leaderboard;
DROP VIEW IF EXISTS public.user_public_profiles;

CREATE OR REPLACE VIEW public.user_public_profiles
WITH (security_invoker = false) AS
SELECT id, ign, ff_uid, avatar_url, avatar_bg_color, city, bio, rank_tier, rank_points,
       total_wins, total_kills, total_matches, win_streak, has_clean_badge, is_banned,
       is_live, stream_link, stream_title, clan_id, profile_status, level, exp, is_vip,
       is_creator, created_at
FROM public.users;

GRANT SELECT ON public.user_public_profiles TO anon, authenticated;

CREATE OR REPLACE VIEW public.referral_leaderboard
WITH (security_invoker = false) AS
  SELECT r.referrer_id, p.ign, p.avatar_url, COUNT(*) AS referral_count
  FROM referrals r
  JOIN user_public_profiles p ON p.id = r.referrer_id
  GROUP BY r.referrer_id, p.ign, p.avatar_url
  ORDER BY COUNT(*) DESC;

GRANT SELECT ON public.referral_leaderboard TO anon, authenticated;

COMMENT ON VIEW public.user_public_profiles IS
  'Public-profile view — non-sensitive columns only (no email/phone/referral_code/balances). security_invoker=false by design so cross-user lookups (friends, leaderboards, player-card, search) work after users RLS lock. reviewed 2026-09-22 (v32.21 privacy fix: phone+referral_code removed).';

-- ── 2) Secure phone-dup-check RPC — profile "phone pehle se hai" ke liye ──
-- User-panel profile.js ka dup-check पहले view se .eq('phone', ...) karta
-- tha; view se phone hataya to wo bandwidth break hoti. Ye RPC sifr
-- existence-check deta hai (found:true/false), koi uid/phone/ign output
-- nahi. SECURITY DEFINER + sirf authenticated role.

CREATE OR REPLACE FUNCTION public.user_has_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF p_phone IS NULL OR length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 10 THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT id INTO v_owner FROM users
   WHERE regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
   LIMIT 1;
  IF v_owner IS NULL OR v_owner = v_uid THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object('found', true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.user_has_phone(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_has_phone(text) TO authenticated;

-- VERIFY (live, 2026-09-22):
--  ✓ anon → view .select('phone') → 42703 "column does not exist"
--  ✓ anon → view 'id,ign,ff_uid' → 200 (sामान्य lookup intact)
--  ✓ anon → RPC user_has_phone → 42501 permission denied
--  ✓ referral_leaderboard → 200 (empty set, view re-created OK)
--  ✓ RPC grant = authenticated only (postgres+authenticated; anon=no)
-- ═══════════════════════════════════════════════════════════════════
