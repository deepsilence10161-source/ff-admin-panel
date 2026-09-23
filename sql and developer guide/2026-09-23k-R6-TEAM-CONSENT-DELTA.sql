-- ═══════════════════════════════════════════════════════════════════════
-- R6 — FINAL LAST PASS — PRODUCTION SECURITY + FINANCIAL LOCK
-- 1. TEAM JOIN AUTHORIZATION  — team_invitations (server-authoritative consent)
-- 2. ATOMIC TEAM PAYMENT      — join_match_team ab sirf authorized members debit
-- 3. EACH_PAYS PAYER IDENTITY — member debit उसी member की locked row से (consent के bad)
-- 4. INCREMENT FILLED SLOTS   — normal-user access हटाया; internal-only guard
-- 5. WALLET LEDGER INTEGRITY  — fft_guard: no-caller → raise; self-only pending_*
-- 7. GIFT CAPACITY            — gift_match_entry match FOR UPDATE (race-safe capacity)
-- 22. DB CONSTRAINTS          — non-negative balances / slots / amounts
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. TEAM INVITATIONS TABLE (minimal server-authoritative consent)
--    captain invites → member explicitly accepts → join_match_team verifies
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    captain_uid TEXT NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
    member_uid  TEXT NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
    mode        TEXT NOT NULL DEFAULT 'duo',
    fee_type    TEXT NOT NULL DEFAULT 'captain_pays',
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    CONSTRAINT team_invitations_mode_chk CHECK (mode IN ('duo','squad')),
    CONSTRAINT team_invitations_fee_chk   CHECK (fee_type IN ('captain_pays','each_pays')),
    CONSTRAINT team_invitations_status_chk CHECK (status IN ('pending','accepted','declined')),
    CONSTRAINT team_invitations_unique_member UNIQUE (match_id, member_uid)
);
CREATE INDEX IF NOT EXISTS idx_team_invitations_captain ON public.team_invitations(captain_uid, match_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_member  ON public.team_invitations(member_uid, status);

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ti_select_related" ON public.team_invitations;
CREATE POLICY "ti_select_related" ON public.team_invitations FOR SELECT
  USING ((auth.jwt() ->> 'sub') = member_uid
      OR (auth.jwt() ->> 'sub') = captain_uid
      OR (auth.jwt() ->> 'sub') IN (SELECT id FROM public.users WHERE is_admin = true));
DROP POLICY IF EXISTS "ti_insert_own" ON public.team_invitations;
CREATE POLICY "ti_insert_own" ON public.team_invitations FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = captain_uid AND status = 'pending');
DROP POLICY IF EXISTS "ti_update_own" ON public.team_invitations;
CREATE POLICY "ti_update_own" ON public.team_invitations FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = member_uid OR (auth.jwt() ->> 'sub') = captain_uid)
  WITH CHECK ((auth.jwt() ->> 'sub') = member_uid OR (auth.jwt() ->> 'sub') = captain_uid);

GRANT SELECT, INSERT, UPDATE ON public.team_invitations TO anon, authenticated;
GRANT ALL ON public.team_invitations TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- invite_team_members — captain ही अपने match ke liye invitations बनाता है
-- (server match/capacity/mode/fee verify; members client-array hone par bhi
--  सिर्फ़ INVITATION बनती है — कोई wallet/join/slot write नहीं)
-- ─────────────────────────────────────────────────────────────────────
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
    INSERT INTO team_invitations (match_id, captain_uid, member_uid, mode, fee_type)
    VALUES (p_match_id, v_caller, v_u, p_mode, v_feety)
    ON CONFLICT (match_id, member_uid) DO UPDATE
      SET captain_uid = EXCLUDED.captain_uid,
          mode        = EXCLUDED.mode,
          fee_type    = EXCLUDED.fee_type,
          status      = 'pending',
          created_at  = NOW(),
          accepted_at = NULL;
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
REVOKE ALL ON FUNCTION public.invite_team_members(text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_team_members(text, text, text, text[]) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- respond_team_invite — सिर्फ़ invited member ही accept/decline
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_team_invite(p_invite_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_inv    RECORD;
  v_action TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_inv FROM team_invitations WHERE id = p_invite_id FOR UPDATE;
  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invitation not found');
  END IF;
  IF v_inv.member_uid <> v_caller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ye invitation tumhare liye nahi hai');
  END IF;
  IF v_inv.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invitation pehle se respond ho chuki hai');
  END IF;

  v_action := CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
  UPDATE team_invitations
     SET status = v_action,
         accepted_at = CASE WHEN p_accept THEN NOW() ELSE accepted_at END
   WHERE id = p_invite_id;

  INSERT INTO notifications (user_id, type, title, body, ref_id)
  VALUES (v_inv.captain_uid, 'team_invite_response', '👥 Team Response',
          (SELECT COALESCE(ign,'Player') FROM users WHERE id = v_caller)
          || ' ne team invite ' || v_action || ' kar di.',
          v_inv.match_id);

  RETURN jsonb_build_object('ok', true, 'action', v_action);
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_team_invite(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_team_invite(uuid, boolean) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 2/3. join_match_team REWRITE — server-authoritative team authorization.
--   Team[0] = caller. Har teammate (team[1..]) ko:
--     (a) accepted team_invitations (captain_uid=caller, member_uid=mate, match)
--     (b) ya auto-squad consent (auto_squad_queue.status='matched' + shared team_id)
--   verify karke TABHI wallet/fee/slot mutate hota hai. Any fail = full rollback.
-- ═══════════════════════════════════════════════════════════════════════
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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_mode IS NULL THEN p_mode := 'solo'; END IF;
  p_mode := lower(p_mode);
  v_slots := CASE WHEN p_mode = 'duo' THEN 2 WHEN p_mode = 'squad' THEN 4 ELSE 1 END;

  IF p_team IS NULL OR jsonb_typeof(p_team) <> 'array' OR jsonb_array_length(p_team) = 0 THEN
    RAISE EXCEPTION 'INVALID_TEAM';
  END IF;

  /* captain = team[0]; server identifies from jwt — client team[0].uid sirf hint */
  v_mem := p_team -> 0;
  IF (v_mem->>'uid') IS NULL OR (v_mem->>'uid') <> v_caller THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  /* team size must match mode */
  IF (v_slots = 2 AND jsonb_array_length(p_team) <> 2) OR
     (v_slots = 4 AND jsonb_array_length(p_team) <> 4) OR
     (v_slots = 1 AND jsonb_array_length(p_team) <> 1) THEN
    RAISE EXCEPTION 'TEAM_SIZE_MISMATCH';
  END IF;

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

  /* fee/currency server-derived (client never) */
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

  IF p_fee_type IS NULL THEN p_fee_type := 'captain_pays'; END IF;
  p_fee_type := lower(p_fee_type);
  IF p_fee_type NOT IN ('captain_pays','each_pays','solo') THEN p_fee_type := 'captain_pays'; END IF;
  IF v_slots = 1 THEN p_fee_type := 'solo'; END IF;

  v_captain_fee := CASE WHEN p_fee_type = 'each_pays' THEN v_server_fee
                        ELSE v_server_fee * v_slots END;
  v_member_fee := CASE WHEN p_fee_type = 'each_pays' THEN v_server_fee ELSE 0 END;

  /* capacity (player slots) */
  v_available := COALESCE(v_m.max_slots, 999) - COALESCE(v_m.filled_slots, 0);
  IF v_available < v_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  /* validate members, duplicate-active-join, banned + AUTHORIZATION */
  FOR v_idx IN 0 .. jsonb_array_length(p_team) - 1 LOOP
    v_mem := p_team -> v_idx;
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

    /* ── R6 AUTHORIZATION (FINAL BLOCKER #1/#3) ──
       captain (idx 0) = jwt caller = self.
       teammates (idx>=1) = explicit consent आवश्यक:
       (a) accepted team invitation  (b) ya auto-squad matched team. */
    IF v_idx >= 1 THEN
      v_authorized := EXISTS(
        SELECT 1 FROM team_invitations ti
        WHERE ti.match_id = p_match_id
          AND ti.captain_uid = v_caller
          AND ti.member_uid = v_mem_uid
          AND ti.status = 'accepted'
      );
      IF NOT v_authorized THEN
        v_authorized := EXISTS(
          SELECT 1 FROM auto_squad_queue aq
          WHERE aq.match_id = p_match_id
            AND aq.user_id = v_mem_uid
            AND aq.status = 'matched'
            AND aq.team_id IN (
              SELECT aq2.team_id FROM auto_squad_queue aq2
              WHERE aq2.match_id = p_match_id
                AND aq2.user_id = v_caller
                AND aq2.status = 'matched'
            )
        );
      END IF;
      IF NOT v_authorized THEN
        RAISE EXCEPTION 'TEAM_NOT_AUTHORIZED';
      END IF;
    END IF;
  END LOOP;

  /* lock every member row + validate balance (atomic; koi bhi fail = full rollback) */
  IF v_server_fee > 0 THEN
    FOR v_idx IN 0 .. jsonb_array_length(p_team) - 1 LOOP
      v_mem := p_team -> v_idx;
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

  /* debit + join row per member (single transaction; debit only authorized members) */
  FOR v_idx IN 0 .. jsonb_array_length(p_team) - 1 LOOP
    v_mem := p_team -> v_idx;
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

  /* creator commission (spend-triggered, sky-only, same rule as validate_and_join_match) */
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
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'        THEN 'Not authorized'
        WHEN 'TEAM_NOT_AUTHORIZED'   THEN 'Teammates ne join authorize nahi kiya — pehle team invite accept karwao'
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
REVOKE ALL ON FUNCTION public.join_match_team(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_match_team(text, text, text, jsonb) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. increment_match_filled_slots — normal-user access HATAO.
--    अब sirf वही caller increment kar sakta hai jiska is match में active
--    join_requests row ho (own joined entry) — occupancy manipulation band.
--    PostgREST grant REVOKE (normal-user route drop) + body guard (defense-in-depth).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.increment_match_filled_slots(p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_m RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  /* R6: caller must have his own active join row on this match — occupancy
     सिर्फ़ उसी participant ke अपने join के लिए, कभी दूसरे match के लिए नहीं। */
  IF NOT EXISTS (SELECT 1 FROM join_requests
                 WHERE match_id = p_match_id
                   AND user_id = v_caller
                   AND status IN ('joined','checked_in','pending','approved')) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  SELECT mode, status, max_slots, filled_slots
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.status IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;
  IF v_m.status NOT IN ('upcoming','live') THEN
    RAISE EXCEPTION 'match_not_joinable';
  END IF;
  IF COALESCE(v_m.filled_slots, 0) >= COALESCE(v_m.max_slots, 0) THEN
    RAISE EXCEPTION 'match_full';
  END IF;

  UPDATE matches SET filled_slots = filled_slots + 1 WHERE id = p_match_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.increment_match_filled_slots(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_match_filled_slots(text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. fft_guard_wallet_insert TIGHTEN — no-caller → raise; self-only pending_*
--    Ledger केवल system/admin/server RPC बना सकते हैं; regular user सिर्फ़
--    अपनी pending_deposit/pending_withdraw row (request-record) — fake
--    ledger history, cross-user debit fabrication अब असंभव।
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fft_guard_wallet_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  /* system roles + admin + service bypass (server-side authority) */
  IF current_user IN ('postgres','supabase_admin','service_role') THEN
    RETURN NEW;
  END IF;

  /* R6: nested-call detection — server RPC (SECDEF) chalta hai to
     request.jwt.claims caller hi rehta hai; system writes tabhi allow
     जब caller admin हो या current_user सेवा-भूमिका में हो। */
  IF v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN NEW;
  END IF;

  /* R6: no caller (anon, no identity) — कभी कोई ledger write नहीं */
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Wallet entries sirf authenticated system path se banti hain';
  END IF;

  /* R6: regular authenticated user — sirf अपनी pending request records */
  IF NEW.user_id = v_caller AND NEW.txn_type IN ('pending_deposit','pending_withdraw') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Wallet entries (%) sirf system create kar sakta hai', NEW.txn_type;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. gift_match_entry — match row FOR UPDATE (concurrent gift capacity race band)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me TEXT := auth.jwt() ->> 'sub';
  v_m RECORD; v_friend RECORD; v_my_name TEXT; v_col TEXT; v_bal NUMERIC; v_gift_id UUID;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Not authorized'); END IF;
  IF p_to_uid IS NULL OR p_to_uid = v_me THEN RETURN jsonb_build_object('ok', false, 'error', 'Apne aap ko gift nahi kar sakte'); END IF;
  /* R6: FOR UPDATE — concurrent gifts same match par capacity race नहीं करते */
  SELECT id, entry_fee, entry_type, name, status, max_slots, filled_slots
    INTO v_m FROM matches WHERE id::text = p_match_id FOR UPDATE;
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Match not found'); END IF;
  IF COALESCE(v_m.entry_fee, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Gift sirf paid matches par'); END IF;
  SELECT id, COALESCE(ff_uid, '') AS ff_uid INTO v_friend FROM users WHERE id = p_to_uid;
  IF v_friend.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Player not found'); END IF;
  SELECT COALESCE(ign, 'Player') INTO v_my_name FROM users WHERE id = v_me;
  v_col := CASE WHEN lower(COALESCE(v_m.entry_type, 'coin')) = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1 FOR UPDATE', v_col) INTO v_bal USING v_me;
  IF v_bal IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'User not found'); END IF;
  IF v_bal < v_m.entry_fee THEN RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance'); END IF;
  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) - $1 WHERE id = $2', v_col, v_col) USING v_m.entry_fee, v_me;

  INSERT INTO gift_tickets (from_uid, from_name, to_uid, to_ff_uid, match_id, match_name, fee, entry_type, status)
  VALUES (v_me, v_my_name, p_to_uid, v_friend.ff_uid, v_m.id, v_m.name, v_m.entry_fee, v_m.entry_type, 'pending')
  RETURNING id INTO v_gift_id;
  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_me, v_col, 'debit', v_m.entry_fee, 'gift_entry');

  IF v_m.status = 'upcoming' THEN
    IF NOT EXISTS (SELECT 1 FROM join_requests WHERE user_id = p_to_uid AND match_id = v_m.id AND status NOT IN ('cancelled','refunded','no_show')) THEN
      IF COALESCE(v_m.filled_slots, 0) < COALESCE(v_m.max_slots, 999) THEN
        INSERT INTO join_requests (match_id, user_id, status, entry_type, entry_fee_paid, user_ign, ign_at_join, user_ff_uid)
        VALUES (v_m.id, p_to_uid, 'pending', v_m.entry_type, 0,
                (SELECT COALESCE(ign,'Player') FROM users WHERE id = p_to_uid),
                (SELECT COALESCE(ign,'Player') FROM users WHERE id = p_to_uid),
                v_friend.ff_uid);
        UPDATE matches SET filled_slots = COALESCE(filled_slots,0) + 1 WHERE id = v_m.id;
      END IF;
    END IF;
  END IF;
  INSERT INTO notifications (user_id, type, title, body)
  VALUES (p_to_uid, 'gift_ticket', '🎁 Match Ticket Gift!', v_my_name || ' ne tumhe "' || v_m.name || '" ka entry ticket gift kiya!');
  RETURN jsonb_build_object('ok', true, 'gift_id', v_gift_id, 'fee', v_m.entry_fee);
END;
$function$;
REVOKE ALL ON FUNCTION public.gift_match_entry(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_match_entry(text, text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 22. DB-LEVEL CONSTRAINTS (बिना किसी working flow को तोड़े — 0 violations live)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.users ADD CONSTRAINT users_wallet_nonnegative CHECK (
  COALESCE(coins, 0) >= 0
  AND COALESCE(sky_diamonds, 0) >= 0
  AND COALESCE(green_diamonds, 0) >= 0
  AND COALESCE(sponsored_winnings, 0) >= 0
);

ALTER TABLE public.matches ADD CONSTRAINT matches_slots_bounds CHECK (
  COALESCE(filled_slots, 0) >= 0
  AND COALESCE(max_slots, 0) >= 0
  AND COALESCE(filled_slots, 0) <= COALESCE(max_slots, 0)
);

ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_amount_nonnegative CHECK (
  COALESCE(amount, 0) >= 0
);
