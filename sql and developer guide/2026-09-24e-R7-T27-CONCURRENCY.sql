-- ══════════════════════════════════════════════════════════════════
-- 2026-09-24e-R7-T27-CONCURRENCY.sql
-- R7 FOLLOW-UP regression: T27 concurrency flake → root-cause fix (v2).
--
--   Problem (pre-existing, R7 migration se unrelated):
--     do concurrent form_auto_squad_team() callers ek match ke liye
--     race karte the. Ek caller apne candidate-SELECT me doosre caller
--     (jiski row abhi 'waiting' thi) ko partner bana leta tha (rank-tie
--     me arbitrary), to doosra caller 'already_matched' fail hota tha
--     aur baaki waiting players orphan reh jaate the (4 players me 1 hi
--     team banti thi, 2 players pending).
--
--   Security: koi double-booking kabhi nahi thi — unique constraint +
--     'waiting' re-check + FOR UPDATE SKIP LOCKED enforced; ye functional
--     race thi, not a vulnerability.
--
--   Fix (v2, correct): match-level pg_advisory_xact_lock ANDAR seedhe
--     greedy drain — jitni PURA teams ban saken, sab ek hi authorized
--     call me ban jaati hain. Chahe koi bhi caller lock jeete, final
--     state deterministic (2 teams of 2, koi orphan nahi). Caller apni
--     first team me (ORDER BY (user_id=caller) DESC), client flat
--     {ok, team_id, user_ids} contract BYTE-SAME rehta hai.
--
--   SECDEF / owner / ACL / search_path BYTE-SAME (no security change).
-- Idempotent: CREATE OR REPLACE hai.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      TEXT := auth.jwt() ->> 'sub';
  v_team_id     TEXT;
  v_selected    TEXT[];
  v_count       INT;
  v_need        INT;
  v_my_st       TEXT;
  v_cap_team_id TEXT;
  v_cap_users   TEXT[] := '{}';
  v_first       BOOLEAN := TRUE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  p_mode := lower(COALESCE(p_mode, 'squad'));
  IF p_mode NOT IN ('duo','squad') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'match_not_found');
  END IF;
  v_need := CASE WHEN p_mode = 'duo' THEN 2 ELSE 4 END;

  /* 2026-09-24e R7 FOLLOW-UP — match-level advisory lock + greedy drain.
     Do concurrent form_auto_squad_team() calls isi match ke liye
     serialize hoti hain (transaction-scoped lock; commit/rollback par
     auto-release). Lock ke ANDAR poora greedy drain chalta hai:
       1) caller authz guard — caller isi match+mode ki 'waiting' queue
          me hona chahiye, warna not_in_queue / already_matched /
          queue_mode_mismatch (authorization manufacture band).
       2) waiting queue se jitni PURA teams (v_need each) ban saken,
          sab ban jaati hain — concurrent calls me koi orphan nahi.
       3) caller hamesha first team me (ORDER BY (user_id=caller) DESC),
          response flat {ok, team_id, user_ids} — client contract same.
     SECURITY INVARIANT: koi user kabhi do team me nahi — har pass
     status='waiting' re-check + unique constraint + FOR UPDATE
     SKIP LOCKED. Gair-queued attacker team nahi banata. */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_match_id::text, 0));

  /* caller authorization guard (lock ke andar, same transaction) */
  SELECT status INTO v_my_st FROM auto_squad_queue
   WHERE match_id = p_match_id AND user_id = v_caller FOR UPDATE;
  IF v_my_st IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_queue');
  END IF;
  IF v_my_st <> 'waiting' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_matched');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auto_squad_queue
                 WHERE match_id = p_match_id AND user_id = v_caller AND mode = p_mode) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'queue_mode_mismatch');
  END IF;

  /* greedy drain: har authorized call poori waiting-queue se jitni
     full teams ban saken bana deta hai — caller pehli team me. */
  LOOP
    SELECT array_agg(user_id) INTO v_selected
    FROM (
      SELECT user_id FROM auto_squad_queue
      WHERE match_id = p_match_id AND mode = p_mode AND status = 'waiting'
      ORDER BY (user_id = v_caller) DESC, rank_pts DESC, joined_at ASC
      LIMIT v_need
      FOR UPDATE SKIP LOCKED
    ) candidates;

    v_count := COALESCE(array_length(v_selected, 1), 0);
    EXIT WHEN v_count < v_need;

    v_team_id := 'team_' || extract(epoch from now())::BIGINT || '_' || substr(md5(random()::TEXT), 1, 6);

    /* status='waiting' re-check: already-matched row dobara match nahi hoti। */
    UPDATE auto_squad_queue SET status = 'matched', team_id = v_team_id, fee_type = 'each_pays'
    WHERE match_id = p_match_id AND user_id = ANY(v_selected) AND status = 'waiting';

    IF v_first THEN
      v_first := FALSE;
      v_cap_team_id := v_team_id;
      v_cap_users := v_selected;
    END IF;
  END LOOP;

  IF v_cap_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_enough_players',
                              'available', COALESCE(v_count, 0));
  END IF;

  RETURN jsonb_build_object('ok', true, 'team_id', v_cap_team_id,
                            'user_ids', to_jsonb(v_cap_users));
END;
$function$;

-- ACL/owner guards (exactly match live state: owner postgres,
-- SECDEF true, authenticated+service_role EXECUTE — postgres owner default)
ALTER FUNCTION public.form_auto_squad_team(text, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.form_auto_squad_team(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(text, text, integer) TO service_role;
