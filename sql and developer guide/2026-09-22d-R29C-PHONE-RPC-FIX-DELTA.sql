-- ══════════════════════════════════════════════════════════════════════════
-- 2026-09-22d — R29C — user_has_phone() anon-grant fix (42501 root-cause)
-- ══════════════════════════════════════════════════════════════════════════
-- Problem (live-proven, browser-authenticated E2E):
--   profile.js ke phone dup-check ke liye user_has_phone() secure RPC banaya
--   gaya tha (R29, "sirf authenticated" grant). Live me real signed-in user
--   ke saath bhi ye RPC 42501 "permission denied for function user_has_phone"
--   deta tha.
--
-- Root cause (live-proven, NOT assumption):
--   is app ka auth "Supabase Third-Party Auth — Firebase" hai: client Firebase
--   ID token ko Authorization Bearer header ke रूप में भेजता है (core/db.js
--   syncFirebaseToken). Supabase उस Firebase JWT को validate करता है, लेकिन
--   उस JWT में कोई `role` claim नहीं होता → PostgREST request ko हमेशा
--   `anon` database role assign करता है (चाहे user signed-in ho)।
--   → verified via temporary SECURITY DEFINER debug RPC जो current_setting('role')
--     echo करता था: signed-in request के बावजूद db_role = 'anon', jwt_role = null.
--   → validate_and_join_match / cancel_match_with_refunds इसलिए काम करते थे
--     क्योंकि उनके ACL में `anon` पहले से मौजूद था।
--   → user_has_phone का ACL सिर्फ authenticated था → anon role को EXECUTE
--     मिल नहीं रहा था → 42501।
--
-- Fix:
--   GRANT anon (authenticated ke साथ)। SAFE है क्योंकि function:
--     * SECURITY DEFINER, सिर्फ {found:true/false} लौटाता है;
--     * कोई uid/phone/ign/other-column output नहीं करता;
--     * v_uid NULL (no JWT) होने पर हमेशा found:false — पहले ही guard है;
--     * caller का अपना phone → found:false (self check);
--     * सिर्फ KISI AUR user के phone पर found:true (profile dup-check).
--
-- Live verification (2026-09-22, browser E2E):
--   ✓ pure-anon pristine client → found:false (दूसरे का phone भी leak नहीं)
--   ✓ signed-in (Third-Party Auth) → self phone → found:false
--   ✓ signed-in → दूसरे user का phone → found:true
--   ✓ signed-in → nonexistent phone → found:false
--   ✓ ACL अब: postgres + authenticated + anon
-- ══════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.user_has_phone(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_has_phone(text) TO authenticated, anon;

-- ══════════════════════════════════════════════════════════════════════════
-- R29C (part 2) — increment_match_filled_slots() anon-grant fix
-- ══════════════════════════════════════════════════════════════════════════
-- Same root-cause: ACL sirf authenticated tha → browser (Firebase-JWT =
-- anon db-role) se call = 42501. Live def SECURITY DEFINER + v_caller guard
-- hai, sirf +1 non-money column — anon grant SAFE.
REVOKE EXECUTE ON FUNCTION public.increment_match_filled_slots(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_match_filled_slots(text) TO authenticated, anon;
