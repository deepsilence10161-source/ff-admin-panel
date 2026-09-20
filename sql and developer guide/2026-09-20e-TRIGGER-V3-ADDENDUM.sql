-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20e TRIGGER-V3 ADDENDUM (Part E ke redirect-trigger ka fix)
-- LIVE RUN ✅ — ye Part E wale trigger-function ko REPLACE karta hai
-- ═══════════════════════════════════════════════════════════════════
-- Part E wale v2 me DO problems thin:
--   (1) redirect ke baad NEW.room_id := NULL assign CHHUT GAYA tha →
--       creds match_rooms to jaate the par matches me BHI reh jaate
--       (leak wapas!). Edge-test ne pakda.
--   (2) ELSE-branch match_rooms DELETE karta tha → admin bridge ka
--       full-match upsert (room_id: null — RTDB copy me room nahi hota)
--       CREATOR ke room creds ko wipe kar deta. Null-write ab 'clear'
--       NAHI mana jaata.
-- v3 FINAL BEHAVIOR:
--   • non-null room_id → match_rooms upsert + matches cols NULL (assign!)
--   • null/'' write → NO-OP (match_rooms preserve)
--   • explicit clear = match_rooms se DIRECT DELETE (admin/service-role)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.redirect_match_room_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  /* FIX (2026-09-20e): (a) null-writes ko 'clear' NAHI mana — full-sync
     writers ka null 'set nahi kiya' hota hai, match_rooms PRESERVE.
     (b) redirect ke baad matches ke columns NULL assign karna ZAROORI
     (v2 me ye chhut gaya tha — creds matches me reh jaate). */
  IF NEW.room_id IS NOT NULL AND BTRIM(NEW.room_id) <> '' THEN
    INSERT INTO match_rooms(match_id, room_id, room_password, updated_at)
    VALUES (NEW.id, BTRIM(NEW.room_id), COALESCE(BTRIM(NEW.room_password), ''), NOW())
    ON CONFLICT (match_id) DO UPDATE
      SET room_id = EXCLUDED.room_id, room_password = EXCLUDED.room_password, updated_at = NOW();
    NEW.room_id := NULL;
    NEW.room_password := NULL;
  END IF;
  /* ELSE: NO-OP — explicit clear sirf match_rooms direct-delete se */
  RETURN NEW;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live, v3 battery):
--  ✓ redirect + NULL-assign (match_rooms ROOMV3, matches NULL, NULL)
--  ✓ null-write preserve (admin-bridge-style edit → match_rooms intact)
--  ✓ global creds-free (0 rows)
--  ✓ explicit clear (direct delete)
--  ✓ P2 essentials re-run: set_room/owner-bypass/not_released/release 4/4
-- ═══════════════════════════════════════════════════════════════
