-- ═══════════════════════════════════════════════════════════════════
-- R7 FINAL SECURITY LOCK — TEAM CONSENT + AUTO-SQUAD (2026-09-24)
--
-- 1) team_invitations: direct INSERT/UPDATE REVOKE (anon/authenticated);
--    DROP ti_update_own + ti_insert_own RLS; accepted-immutability trigger।
-- 2) invite_team_members: re-invite accepted invitation ko kabhi
--    pending/reset nahi karta (ON CONFLICT … WHERE status<>'accepted');
--    pending = terms frozen; declined = fresh pending (payment-term tamper band)।
-- 3) auto_squad_queue: INSERT/UPDATE REVOKE (anon/auth) — rank server-
--    derived; +fee_type column ('each_pays'); +status/mode/fee_type CHECK।
-- 4) join_auto_squad_queue: match/mode validate + matched-rejoin band।
-- 5) form_auto_squad_team: caller ko waiting-queue memberships chahiye;
--    p_needed server-derived (mode se); caller-first (no victim match);
--    status='waiting' re-check (no re-match)।
-- 6) join_match_team: consent BIND — invitation accepted+match+mode+fee_type
--    EXACT; auto-squad matched + same team_id + mode + fee_type EXACT।
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='auto_squad_queue'
                   AND column_name='fee_type') THEN
    ALTER TABLE public.auto_squad_queue ADD COLUMN fee_type text NOT NULL DEFAULT 'each_pays';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='auto_squad_queue_status_chk') THEN
    ALTER TABLE public.auto_squad_queue ADD CONSTRAINT auto_squad_queue_status_chk
      CHECK (status IN ('waiting','matched'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='auto_squad_queue_mode_chk') THEN
    ALTER TABLE public.auto_squad_queue ADD CONSTRAINT auto_squad_queue_mode_chk
      CHECK (mode IN ('duo','squad'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='auto_squad_queue_fee_type_chk') THEN
    ALTER TABLE public.auto_squad_queue ADD CONSTRAINT auto_squad_queue_fee_type_chk
      CHECK (fee_type IN ('captain_pays','each_pays'));
  END IF;
END $$;

-- ── 1) team_invitations: sirf SELECT + (RPC ke zariye) state change ──
DROP POLICY IF EXISTS "ti_update_own" ON public.team_invitations;
DROP POLICY IF EXISTS "ti_insert_own" ON public.team_invitations;
REVOKE UPDATE ON public.team_invitations FROM anon, authenticated;
REVOKE INSERT ON public.team_invitations FROM anon, authenticated;

-- ── 2) auto_squad_queue: sirf SELECT (display) + DELETE (leave) + RPC state ──
DROP POLICY IF EXISTS "asq_update_own" ON public.auto_squad_queue;
DROP POLICY IF EXISTS "asq_insert_own" ON public.auto_squad_queue;
REVOKE UPDATE ON public.auto_squad_queue FROM anon, authenticated;
REVOKE INSERT ON public.auto_squad_queue FROM anon, authenticated;

-- ── 3) join_auto_squad_queue: match/mode validate + matched-rejoin band ──
CREATE OR REPLACE FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_ign TEXT;
  v_rank_tier TEXT;
  v_rank_pts INT;
  v_st   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  p_mode := lower(COALESCE(p_mode, 'squad'));
  IF p_mode NOT IN ('duo','squad') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'match_not_found');
  END IF;

  SELECT status INTO v_st FROM auto_squad_queue
   WHERE match_id = p_match_id AND user_id = v_uid FOR UPDATE;
  IF v_st = 'matched' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Team already ban chuki hai — pehle us team se bahar aao');
  END IF;

  SELECT ign, rank_tier, rank_points INTO v_ign, v_rank_tier, v_rank_pts
  FROM users WHERE id = v_uid;

  INSERT INTO auto_squad_queue(match_id, user_id, mode, ign, rank_tier, rank_pts, status, fee_type, joined_at)
  VALUES(p_match_id, v_uid, p_mode, COALESCE(v_ign, 'Player'),
         COALESCE(v_rank_tier, 'Bronze'), COALESCE(v_rank_pts, 0), 'waiting', 'each_pays', NOW())
  ON CONFLICT (match_id, user_id) DO UPDATE SET
    mode = p_mode,
    ign = COALESCE(v_ign, 'Player'),
    rank_tier = COALESCE(v_rank_tier, 'Bronze'),
    rank_pts = COALESCE(v_rank_pts, 0),
    status = 'waiting',
    team_id = NULL,
    fee_type = 'each_pays',
    joined_at = NOW();

  RETURN jsonb_build_object('ok', true, 'mode', p_mode, 'fee_type', 'each_pays');
END;
$function$;

-- ── 4) form_auto_squad_team: caller-queue guard + server-derived need ──
CREATE OR REPLACE FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_team_id  TEXT;
  v_selected TEXT[];
  v_count    INT;
  v_need     INT;
  v_my_st    TEXT;
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

  /* R7: caller khud usi match+mode ki waiting queue me hona chahiye —
     gair-queued attacker team nahi bana sakta (authorization manufacture band)। */
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

  SELECT array_agg(user_id) INTO v_selected
  FROM (
    SELECT user_id FROM auto_squad_queue
    WHERE match_id = p_match_id AND mode = p_mode AND status = 'waiting'
    ORDER BY (user_id = v_caller) DESC, rank_pts DESC, joined_at ASC
    LIMIT v_need
    FOR UPDATE SKIP LOCKED
  ) candidates;

  v_count := COALESCE(array_length(v_selected, 1), 0);
  IF v_count < v_need THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_enough_players', 'available', v_count);
  END IF;

  v_team_id := 'team_' || extract(epoch from now())::BIGINT || '_' || substr(md5(random()::TEXT), 1, 6);

  /* status='waiting' re-check: already-matched row dobara match nahi hoti। */
  UPDATE auto_squad_queue SET status = 'matched', team_id = v_team_id, fee_type = 'each_pays'
  WHERE match_id = p_match_id AND user_id = ANY(v_selected) AND status = 'waiting';

  RETURN jsonb_build_object('ok', true, 'team_id', v_team_id, 'user_ids', to_jsonb(v_selected));
END;
$function$;

-- ── 5) invite_team_members: accepted-invitation kabhi reset nahi ──
CREATE OR REPLACE FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_slots  INT;
  v_m      RECORD;
  v_u      TEXT;
  v_count  INT := 0;
  v_feety  TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;

  p_mode := lower(COALESCE(p_mode, 'duo'));
  v_slots := CASE WHEN p_mode = 'duo' THEN 2 WHEN p_mode = 'squad' THEN 4 ELSE 1 END;
  IF v_slots = 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid team mode');
  END IF;
  IF p_member_uids IS NULL OR array_length(p_member_uids, 1) <> (v_slots - 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Team size galat hai');
  END IF;

  v_feety := lower(COALESCE(p_fee_type, 'captain_pays'));
  IF v_feety NOT IN ('captain_pays','each_pays') THEN v_feety := 'captain_pays'; END IF;

  SELECT id, status, max_slots, filled_slots, creator_uid
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match not found');
  END IF;
  IF v_m.status IS DISTINCT FROM 'upcoming' AND v_m.status IS DISTINCT FROM 'live' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match ab join nahi ho sakta');
  END IF;
  IF v_m.creator_uid IS NOT NULL AND v_m.creator_uid = v_caller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apne khud ke hosted match mein join nahi kar sakte');
  END IF;
  IF COALESCE(v_m.filled_slots, 0) + v_slots > COALESCE(v_m.max_slots, 999) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match full ho gaya');
  END IF;

  FOREACH v_u IN ARRAY p_member_uids LOOP
    IF v_u IS NULL OR v_u = v_caller THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_u) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Player not found');
    END IF;
    IF EXISTS (SELECT 1 FROM team_invitations
               WHERE match_id = p_match_id AND member_uid = v_u AND status = 'accepted') THEN
      CONTINUE;
    END IF;
    INSERT INTO team_invitations (match_id, captain_uid, member_uid, mode, fee_type)
    VALUES (p_match_id, v_caller, v_u, p_mode, v_feety)
    ON CONFLICT (match_id, member_uid) DO UPDATE
      SET captain_uid = EXCLUDED.captain_uid,
          mode        = EXCLUDED.mode,
          fee_type    = EXCLUDED.fee_type,
          status      = 'pending',
          created_at  = NOW(),
          accepted_at = NULL
      WHERE team_invitations.status <> 'accepted';
    v_count := v_count + 1;
    INSERT INTO notifications (user_id, type, title, body, ref_id)
    VALUES (v_u, 'team_invite', '👥 Team Invitation',
            (SELECT COALESCE(ign,'Player') FROM users WHERE id = v_caller)
            || ' ne tumhe ' || upper(p_mode) || ' match ke liye invite kiya hai — accept/decline karo.',
            p_match_id);
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Koi valid member nahi mila');
  END IF;

  RETURN jsonb_build_object('ok', true, 'invited', v_count, 'mode', p_mode, 'fee_type', v_feety);
END;
$function$;

REVOKE ALL ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) TO service_role;

-- ── join_match_team: consent BIND + server-derived auto-squad ──
CREATE OR REPLACE FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_m            RECORD;
  v_fee_mode     TEXT;
  v_server_fee   NUMERIC;
  v_slots        INT;
  v_captain_fee  NUMERIC;
  v_member_fee   NUMERIC;
  v_total_collected NUMERIC := 0;
  v_available    INT;
  v_mem          JSONB;
  v_mem_uid      TEXT;
  v_mem_ign      TEXT;
  v_bal          NUMERIC;
  v_col          TEXT;
  v_jr_id        UUID;
  v_idx          INT := 0;
  v_unique_uids  TEXT[] := ARRAY[]::TEXT[];
  v_creator_code TEXT;
  v_creator_uid  TEXT;
  v_commission_pct NUMERIC;
  v_commission   NUMERIC;
  v_first_row_id UUID;
  v_authorized   BOOLEAN;
  v_team         JSONB := '[]'::jsonb;
  v_auto_squad   BOOLEAN := false;
  v_team_id_for_as TEXT;
  v_q            RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_mode IS NULL THEN p_mode := 'solo'; END IF;
  p_mode := lower(p_mode);
  v_slots := CASE WHEN p_mode = 'duo' THEN 2 WHEN p_mode = 'squad' THEN 4 ELSE 1 END;

  IF p_fee_type IS NULL THEN p_fee_type := 'captain_pays'; END IF;
  p_fee_type := lower(p_fee_type);
  IF p_fee_type NOT IN ('captain_pays','each_pays','solo') THEN p_fee_type := 'captain_pays'; END IF;
  IF v_slots = 1 THEN p_fee_type := 'solo'; END IF;

  SELECT id, status, entry_type, entry_fee, max_slots, filled_slots, creator_uid
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
  IF v_m.status IS DISTINCT FROM 'upcoming' AND v_m.status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'MATCH_NOT_JOINABLE';
  END IF;
  IF v_m.creator_uid IS NOT NULL AND v_m.creator_uid = v_caller THEN
    RAISE EXCEPTION 'SELF_PLAY_BLOCKED';
  END IF;

  CASE COALESCE(lower(regexp_replace(v_m.entry_type, '[_ -]', '', 'g')), 'free')
    WHEN 'coin'  THEN v_server_fee := COALESCE(v_m.entry_fee,0); v_fee_mode := 'coins';
    WHEN 'paid'  THEN v_server_fee := COALESCE(v_m.entry_fee,0); v_fee_mode := 'sky_diamonds';
    WHEN 'free'  THEN v_server_fee := 0; v_fee_mode := 'free';
    WHEN 'ad'    THEN v_server_fee := 0; v_fee_mode := 'ad';
    ELSE
      IF COALESCE(v_m.entry_fee,0) > 0 THEN v_server_fee := v_m.entry_fee; v_fee_mode := 'sky_diamonds';
      ELSE v_server_fee := 0; v_fee_mode := 'free'; END IF;
  END CASE;
  v_col := CASE WHEN v_fee_mode = 'coins' THEN 'coins' ELSE 'sky_diamonds' END;

  /* ══ TEAM ASSEMBLY ══
     AUTO-SQUAD PATH: jab p_team khali/null ho (duo/squad) — server apni
     authoritative matched queue se teammates derive karta hai. Client ki
     koi victim-UID list accept NAHI hoti. Payment model server-se
     'each_pays' force hota hai (har participant ne apne queue-action se
     khud consent diya — isliye khud pay karta hai). */
  IF v_slots >= 2 AND (p_team IS NULL OR jsonb_typeof(p_team) <> 'array' OR jsonb_array_length(p_team) = 0) THEN
    SELECT team_id INTO v_team_id_for_as
      FROM auto_squad_queue
     WHERE match_id = p_match_id AND user_id = v_caller
       AND status = 'matched' AND mode = p_mode AND team_id IS NOT NULL
     FOR UPDATE;
    IF v_team_id_for_as IS NULL THEN
      RAISE EXCEPTION 'AUTO_SQUAD_NO_MATCH';
    END IF;
    v_auto_squad := true;
    p_fee_type := 'each_pays';
    FOR v_q IN
      SELECT aq.user_id AS uid, COALESCE(u.ign, aq.ign, 'Player') AS ign
        FROM auto_squad_queue aq
        LEFT JOIN users u ON u.id = aq.user_id
       WHERE aq.match_id = p_match_id AND aq.team_id = v_team_id_for_as
         AND aq.status = 'matched' AND aq.mode = p_mode
       ORDER BY (aq.user_id = v_caller) DESC, aq.rank_pts DESC, aq.joined_at ASC
       FOR UPDATE OF aq
    LOOP
      v_team := v_team || jsonb_build_object('uid', v_q.uid, 'ign', v_q.ign);
    END LOOP;
    IF jsonb_array_length(v_team) <> v_slots THEN
      RAISE EXCEPTION 'AUTO_SQUAD_INCOMPLETE';
    END IF;
  ELSE
    /* INVITATION PATH: client candidate list = server verify karta hai. */
    IF p_team IS NULL OR jsonb_typeof(p_team) <> 'array' OR jsonb_array_length(p_team) = 0 THEN
      RAISE EXCEPTION 'INVALID_TEAM';
    END IF;
    v_team := p_team;
  END IF;

  /* captain = team[0]; server identifies from jwt — client team[0].uid sirf hint */
  v_mem := v_team -> 0;
  IF (v_mem->>'uid') IS NULL OR (v_mem->>'uid') <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF jsonb_array_length(v_team) <> v_slots THEN
    RAISE EXCEPTION 'TEAM_SIZE_MISMATCH';
  END IF;

  v_captain_fee := CASE WHEN p_fee_type = 'each_pays' THEN v_server_fee
                        ELSE v_server_fee * v_slots END;
  v_member_fee := CASE WHEN p_fee_type = 'each_pays' THEN v_server_fee ELSE 0 END;

  v_available := COALESCE(v_m.max_slots, 999) - COALESCE(v_m.filled_slots, 0);
  IF v_available < v_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_team) - 1 LOOP
    v_mem := v_team -> v_idx;
    v_mem_uid := v_mem->>'uid';
    IF v_mem_uid IS NULL OR v_mem_uid = ANY(v_unique_uids) THEN
      RAISE EXCEPTION 'INVALID_TEAM';
    END IF;
    v_unique_uids := v_unique_uids || v_mem_uid;
    IF COALESCE((SELECT is_banned FROM users WHERE id = v_mem_uid), false) THEN
      RAISE EXCEPTION 'ACCOUNT_BANNED';
    END IF;
    IF EXISTS(SELECT 1 FROM join_requests
              WHERE user_id = v_mem_uid AND match_id = p_match_id
                AND status NOT IN ('cancelled','refunded','no_show')) THEN
      RAISE EXCEPTION 'ALREADY_JOINED';
    END IF;

    /* ── CONSENT (invitation path only; auto-squad already server-derived) ──
       teammates (idx>=1) = explicit consent:
       (a) accepted team invitation whose mode+fee_type EXACT match current
           request (terms bind — captain_pays invite + each_pays request = REJECT)
       (b) ya shared matched auto-squad team (same team_id+mode, fee_type='each_pays') */
    IF v_idx >= 1 AND NOT v_auto_squad THEN
      v_authorized := EXISTS(
        SELECT 1 FROM team_invitations ti
        WHERE ti.match_id    = p_match_id
          AND ti.captain_uid = v_caller
          AND ti.member_uid  = v_mem_uid
          AND ti.status      = 'accepted'
          AND ti.mode        = p_mode
          AND ti.fee_type    = p_fee_type
      );
      IF NOT v_authorized THEN
        v_authorized := EXISTS(
          SELECT 1 FROM auto_squad_queue my
          JOIN auto_squad_queue them
            ON them.match_id = my.match_id
           AND them.team_id  = my.team_id
         WHERE my.match_id   = p_match_id
           AND my.user_id    = v_caller
           AND my.status     = 'matched'
           AND my.mode       = p_mode
           AND them.user_id  = v_mem_uid
           AND them.status   = 'matched'
           AND them.mode     = p_mode
           AND my.team_id IS NOT NULL
           AND COALESCE(my.fee_type, them.fee_type, 'each_pays') = p_fee_type
        );
      END IF;
      IF NOT v_authorized THEN
        IF EXISTS(
          SELECT 1 FROM team_invitations ti
          WHERE ti.match_id = p_match_id
            AND ti.captain_uid = v_caller
            AND ti.member_uid = v_mem_uid
            AND ti.status = 'accepted'
        ) THEN
          RAISE EXCEPTION 'TEAM_TERMS_MISMATCH';
        END IF;
        RAISE EXCEPTION 'TEAM_NOT_AUTHORIZED';
      END IF;
    END IF;
  END LOOP;

  IF v_server_fee > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(v_team) - 1 LOOP
      v_mem := v_team -> v_idx;
      v_mem_uid := v_mem->>'uid';
      IF v_col = 'coins' THEN
        SELECT coins INTO v_bal FROM users WHERE id = v_mem_uid FOR UPDATE;
      ELSE
        SELECT sky_diamonds INTO v_bal FROM users WHERE id = v_mem_uid FOR UPDATE;
      END IF;
      IF v_bal IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
      IF v_idx = 0 THEN
        IF v_bal < v_captain_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
      ELSE
        IF v_bal < v_member_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
      END IF;
    END LOOP;
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_team) - 1 LOOP
    v_mem := v_team -> v_idx;
    v_mem_uid := v_mem->>'uid';
    v_mem_ign := COALESCE(v_mem->>'ign', '');

    IF v_idx = 0 THEN v_bal := v_captain_fee; ELSE v_bal := v_member_fee; END IF;

    IF v_server_fee > 0 AND v_bal > 0 THEN
      IF v_col = 'coins' THEN
        UPDATE users SET coins = coins - v_bal WHERE id = v_mem_uid;
      ELSE
        UPDATE users SET sky_diamonds = sky_diamonds - v_bal WHERE id = v_mem_uid;
      END IF;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES (v_mem_uid, v_fee_mode, 'debit', v_bal, 'match_entry', p_match_id);
      v_total_collected := v_total_collected + v_bal;
    END IF;

    INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, mode, ign_at_join, fee_type, captain_uid)
    VALUES(
      v_mem_uid, p_match_id, v_bal,
      CASE WHEN v_fee_mode='coins' THEN 'coin'
           WHEN v_fee_mode='sky_diamonds' THEN 'sky_diamond'
           ELSE COALESCE(v_m.entry_type,'free') END,
      'joined', p_mode, v_mem_ign, p_fee_type,
      CASE WHEN v_idx = 0 THEN NULL ELSE v_caller END
    ) RETURNING id INTO v_jr_id;
    IF v_idx = 0 THEN v_first_row_id := v_jr_id; END IF;
  END LOOP;

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + v_slots WHERE id = p_match_id;

  IF v_fee_mode = 'sky_diamonds' AND v_total_collected > 0 THEN
    SELECT creator_code INTO v_creator_code FROM users WHERE id = v_caller;
    IF v_creator_code IS NOT NULL THEN
      SELECT user_id INTO v_creator_uid FROM creator_codes WHERE code = v_creator_code;
      IF v_creator_uid IS NOT NULL AND v_creator_uid <> v_caller
         AND EXISTS(SELECT 1 FROM users WHERE id = v_creator_uid AND is_creator = true) THEN
        SELECT COALESCE((value->>'sdMatchCommissionPct')::numeric, 15)
          INTO v_commission_pct FROM app_settings WHERE key = 'creator_system';
        v_commission_pct := COALESCE(v_commission_pct, 15);
        v_commission := ROUND(v_total_collected * v_commission_pct / 100, 2);
        INSERT INTO creator_stats(user_id, total_matches, total_earnings)
        VALUES (v_creator_uid, 1, v_commission)
        ON CONFLICT (user_id) DO UPDATE SET
          total_matches = creator_stats.total_matches + 1,
          total_earnings = creator_stats.total_earnings + v_commission, updated_at = NOW();
        INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
        VALUES (v_creator_uid, p_match_id, v_commission, 'inr', 'hold', NOW() + INTERVAL '7 days');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'captain_row_id', v_first_row_id, 'slots', v_slots);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', SQLERRM, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'        THEN 'Not authorized'
        WHEN 'TEAM_NOT_AUTHORIZED'   THEN 'Teammates ne join authorize nahi kiya — pehle team invite accept karwao'
        WHEN 'TEAM_TERMS_MISMATCH'   THEN 'Invite ke terms match nahi — invite me jo mode/fee-type thi wahi chun ke join karo'
        WHEN 'AUTO_SQUAD_NO_MATCH'   THEN 'Tumhari koi matched auto-squad team nahi hai'
        WHEN 'AUTO_SQUAD_INCOMPLETE' THEN 'Auto-squad team abhi poori nahi hui'
        WHEN 'MATCH_NOT_FOUND'       THEN 'Match not found'
        WHEN 'MATCH_NOT_JOINABLE'    THEN 'Match ab join nahi ho sakta'
        WHEN 'SELF_PLAY_BLOCKED'     THEN 'Apne khud ke hosted match mein join nahi kar sakte'
        WHEN 'ACCOUNT_BANNED'        THEN 'Kisi teammate ka account ban hai'
        WHEN 'ALREADY_JOINED'        THEN 'Koi teammate already is match mein join hai'
        WHEN 'MATCH_FULL'            THEN 'Match full ho gaya'
        WHEN 'INSUFFICIENT_BALANCE'  THEN 'Kisi teammate ke paas balance kam hai'
        WHEN 'USER_NOT_FOUND'        THEN 'Player not found'
        WHEN 'TEAM_SIZE_MISMATCH'    THEN 'Team size galat hai'
        WHEN 'INVALID_TEAM'          THEN 'Team invalid hai'
        ELSE SQLERRM
      END);
END;
$function$;

REVOKE ALL ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) TO service_role;

-- ── grants: join_auto_squad_queue ──
REVOKE ALL ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO anon;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO postgres;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO service_role;

-- ── grants: form_auto_squad_team ──
REVOKE ALL ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO anon;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO service_role;

-- ── 7) team_invitations accepted-immutability trigger ──
CREATE OR REPLACE FUNCTION public.trg_team_invitation_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'accepted' THEN
    IF NEW.captain_uid IS DISTINCT FROM OLD.captain_uid
       OR NEW.member_uid IS DISTINCT FROM OLD.member_uid
       OR NEW.match_id IS DISTINCT FROM OLD.match_id
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR NEW.fee_type IS DISTINCT FROM OLD.fee_type
       OR NEW.status IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'ACCEPTED_INVITATION_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_team_invitation_immutable ON public.team_invitations;
CREATE TRIGGER trg_team_invitation_immutable
  BEFORE UPDATE ON public.team_invitations
  FOR EACH ROW EXECUTE FUNCTION public.trg_team_invitation_immutable();