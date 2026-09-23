-- ================================================================
-- 2026-09-23d — R3 Production-Hardening — Phase 9 (Data/RLS)
-- [P2] increment_clan_score — anon (no-JWT) caller bypass बंद।
--      Pehle: "IF v_caller IS NOT NULL THEN member-check" — मतलब बिना
--      JWT वाला caller किसी भी clan का weekly_score/total_kills/
--      total_wins inflate/deflate कर सकता था (LIVE-PROVEN: anon RPC →
--      204 OK)।
--
--      v_is_service PATTERN NOTE (IMPORTANT): SECURITY DEFINER function
--      ke andar `current_user` HAMESHA owner (postgres) return karta hai,
--      isliye `current_user IN ('postgres',...)` wala OR-clause sabko
--      service मान लेता है और guard dead ho jaata hai. Sahi pattern
--      (increment_balance jaisa) = SIRF `current_setting('role', true) =
--      'service_role'` — यह real initiating role देता है। यही wageh hai
--      ki पहली draft apply होकर भी anon re-probe 204 deta raha।
-- ================================================================

CREATE OR REPLACE FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer DEFAULT 1, p_kills integer DEFAULT 0, p_wins integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_is_member  BOOLEAN;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Not authorized — no caller identity';
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = v_caller
    ) INTO v_is_member;
    IF NOT v_is_member THEN
      RAISE EXCEPTION 'Not a member of this clan';
    END IF;
  END IF;

  IF p_score < 0 OR p_kills < 0 OR p_wins < 0 OR p_score > 30 OR p_kills > 30 OR p_wins > 1 THEN
    RAISE EXCEPTION 'Score/kills/wins must be non-negative';
  END IF;

  UPDATE clans SET
    weekly_score = COALESCE(weekly_score, 0) + p_score,
    total_kills  = COALESCE(total_kills, 0)  + p_kills,
    total_wins   = COALESCE(total_wins, 0)   + p_wins
  WHERE id = p_clan_id;
END;
$function$;
