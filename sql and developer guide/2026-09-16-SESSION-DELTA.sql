-- ================================================================
-- SESSION DELTA — 2026-09-16 / 2026-09-17
-- 1 database item (applied live on Supabase project
-- hddhkculuyrfoevxmlwy on 2026-09-16, verified working end-to-end):
-- sync_leaderboard() had silently lost SECURITY DEFINER, breaking
-- profile photo saves. This file makes that fix permanent in the SQL
-- history so a full schema rebuild from COMPLETE_SCHEMA.sql + every
-- delta in order reproduces the CORRECT (fixed) state, not the bug.
--
-- The other bugs fixed this round (global notifications not reaching
-- users, duplicate notifications, sponsored match showing twice,
-- Home not refreshing after joining, triple coin reward for one
-- check-in, blank first-load screen, Preview/Maintenance mode needing
-- a refresh) were ALL client-side JS fixes in the User Panel/Admin
-- Panel codebases — no other database changes were made or are
-- needed for them. See DEVELOPER_GUIDE.md and the delivered zips'
-- inline code comments for those.
-- ================================================================

-- ── sync_leaderboard() lost SECURITY DEFINER — "Photo save failed:
-- new row violates row-level security policy for table 'leaderboard'
-- [42501]" ──
-- Root cause: COMPLETE_SCHEMA.sql originally created this function
-- WITH SECURITY DEFINER (see that file's own sync_leaderboard block,
-- ~line 1895). 2026-08-22-SESSION-DELTA.sql later did a
-- `CREATE OR REPLACE FUNCTION` to add the leaderboard_hidden
-- exclusion feature, but that replacement's LANGUAGE/AS clause did
-- NOT re-declare SECURITY DEFINER — Postgres silently reverted the
-- function to the default SECURITY INVOKER at that point. That file
-- has now been corrected in place (see its own updated comment), but
-- is repeated here as a standalone, idempotent statement so this one
-- fix can be re-applied on its own without needing to know which
-- historical delta caused it.
--
-- Effect of the bug: from 2026-08-22 onward, every UPDATE of
-- avatar_url (or ign/city/ff_uid/rank_points/total_wins/total_kills/
-- total_matches/is_banned/leaderboard_hidden — see this trigger's
-- UPDATE OF column list below) ran this trigger with the CALLING
-- PLAYER's own RLS permissions instead of the function owner's —
-- and a normal player has no write access to `leaderboard` under the
-- lb_admin_write policy, so the trigger's own INSERT/DELETE into
-- leaderboard was rejected with 42501, which aborted the entire
-- users UPDATE statement (not just the trigger) since triggers run
-- inside the same transaction. banner_url is NOT in this trigger's
-- UPDATE OF list, which is why banner uploads kept working while
-- profile photo uploads specifically failed — that asymmetry is what
-- made this traceable rather than looking like a blanket "uploads
-- are broken" bug.
--
-- Verified live (2026-09-16): confirmed prosecdef=false before this
-- fix and prosecdef=true after, via
--   SELECT proname, prosecdef FROM pg_proc WHERE proname='sync_leaderboard';
-- then confirmed the actual UPDATE succeeds end-to-end by simulating
-- the exact failing operation as the real affected user account under
-- RLS (SET LOCAL ROLE authenticated + request.jwt.claims sub=<uid>) —
-- no 42501, avatar_url updates cleanly.
CREATE OR REPLACE FUNCTION public.sync_leaderboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_banned = true OR NEW.ign IS NULL OR NEW.leaderboard_hidden = true THEN
    DELETE FROM leaderboard WHERE id = NEW.id;
  ELSE
    INSERT INTO leaderboard (id, ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches, updated_at)
    VALUES (NEW.id, NEW.ign, NEW.avatar_url, NEW.city, NEW.ff_uid, NEW.rank_points, NEW.total_wins, NEW.total_kills, NEW.total_matches, NOW())
    ON CONFLICT (id) DO UPDATE SET
      ign=EXCLUDED.ign, avatar_url=EXCLUDED.avatar_url, city=EXCLUDED.city, ff_uid=EXCLUDED.ff_uid,
      rank_points=EXCLUDED.rank_points, total_wins=EXCLUDED.total_wins,
      total_kills=EXCLUDED.total_kills, total_matches=EXCLUDED.total_matches, updated_at=NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger definition itself is unchanged (still points at this
-- function by name, same UPDATE OF column list) — re-asserted here
-- only so this file is a complete, standalone, idempotent unit.
DROP TRIGGER IF EXISTS trg_sync_leaderboard ON users;
CREATE TRIGGER trg_sync_leaderboard
  AFTER INSERT OR UPDATE OF ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches, is_banned, leaderboard_hidden
  ON users FOR EACH ROW EXECUTE FUNCTION sync_leaderboard();

-- Verification query — prosecdef must read `true`.
SELECT p.proname, p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'sync_leaderboard';
