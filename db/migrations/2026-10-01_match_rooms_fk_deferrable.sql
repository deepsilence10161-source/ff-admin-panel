-- ============================================================================
-- FIX (live-testing 2026-10-01, ADMIN-QC-001)
-- Quick Match Create (aur koi bhi match-insert jisme Room ID/Password ho)
-- 100% fail ho raha tha: 409 +
--   [Bridge] INSERT failed for table "matches":
--   insert or update on table "match_rooms" violates foreign key constraint
--   "match_rooms_match_id_fkey"
--
-- ROOT CAUSE:
--   BEFORE INSERT trigger `trg_redirect_match_room_secrets`
--   (function redirect_match_room_secrets) room_id/room_password ko
--   match_rooms table me daalta hai — par wo matches row se PEHLE chalta hai
--   (BEFORE INSERT), aur us waqt matches row exist hi nahi karti. FK
--   immediate hone ki wajah se INSERT hamesha fail hota tha. UI me sirf
--   console me error dikhta tha; admin ko koi toast nahi milta tha aur
--   Quick Create overlay khula reh jata tha (silent failure).
--
-- FIX: FK ko DEFERRABLE INITIALLY DEFERRED karo — check transaction ke
--   aakhir me hota hai, jab matches row ban chuki hoti hai. Design wahi
--   rehta hai (creds matches me nahi, match_rooms me hi redirect hote hain;
--   matches.room_id NULL hi rehta hai — live-verified).
--
-- VERIFIED (asli admin UI, walk9r / walk9r2):
--   Quick Create (Solo Blitz + Room QA1234/qa99) -> match row bana
--   ("Solo Blitz — 1:08"), match_rooms me creds (QA1234/qa99), matches.room_id
--   NULL, overlay band, 0 console error / 0 4xx; cascade delete par
--   match_rooms row bhi delete; UPDATE-path (room creds baad me save) bhi ok.
-- ============================================================================

ALTER TABLE public.match_rooms DROP CONSTRAINT match_rooms_match_id_fkey;
ALTER TABLE public.match_rooms
  ADD CONSTRAINT match_rooms_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES public.matches(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- Rollback (agar kabhi purani behaviour chahiye ho):
-- ALTER TABLE public.match_rooms DROP CONSTRAINT match_rooms_match_id_fkey;
-- ALTER TABLE public.match_rooms
--   ADD CONSTRAINT match_rooms_match_id_fkey
--   FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;
