-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20k ROUND-8 — REMAINING USER-WRITABLE TABLES POLICY SWEEP
-- ═══════════════════════════════════════════════════════════════════
-- (Policies/RPC live-applied ✅ — live-probes se CONFIRMED holes:)
--   R8-1 polls.poll_vote_auth: any-auth UPDATE polls row → qa1 ne
--        total_votes=99999 LIVE rig kiya. Voting pehle se
--        cast_poll_vote RPC se hai → policy DROP.
--   R8-2 clan_wars cw_insert_auth + cw_update_auth (any-auth): fake war
--        INSERT 201 LIVE-captured; feature dormant (0 rows) → dono DROP
--        (admin/service hi likhe). NOTE: war-score abhi client self-report
--        hai — feature launch se PEHLE server-RPC design zaroori.
--   R8-3 clan_members cm_insert_auth: qa1 ne real clan me khud ko
--        'leader' bana liya (201) → cm_insert_self: user_id=self AND
--        (role='member' OR (role='leader' AND clans.leader_uid=self)).
--   R8-4 clan_war_challenges any-auth I/U: spoof challenge 201 →
--        leader-gated policies (from_clan ka leader hi create kare;
--        update = kisi bhi party ka leader; from<>to).
--   R8-5 gift_tickets gt_insert_own: BINA pay ke ticket 201 (client
--        deduct aur insert alag bhejta tha — non-atomic) → direct insert
--        DROP; naya RPC gift_match_entry (atomic: FOR UPDATE lock +
--        balance-check + debit + ticket + ledger + notif; insufficient
--        par kuch nahi hota). Client screens/matches.js ab RPC call karta
--        hai (user-panel repo dea9a3a).
--   R8-6 12 request-tables: INSERT policies me status uncontrolled tha —
--        premium_requests/coin_requests me self-'approved' row 201 LIVE.
--        Ab status-hygiene: {coin/refund/premium/season_pass/ban/kyc/
--        creator_applications/sponsored_prize_claims/user_suggestions/
--        suggestions} → 'pending'-only; {support_tickets, disputes} →
--        'open'-only. (Defaults client-values se match — legit flows OK.)
--   R8-7 profile_requests: user-edit ab sirf status='pending' par.
--   R8-8 reward_store_items: catalog public-SELECT grant (RLS-off table,
--        writes service-only).
--
-- VERIFY (live re-probes): polls-rig BLOCK / fake-war BLOCK /
-- leader-spoof BLOCK / legit self-join member OK / gift direct-insert
-- BLOCK / cwc spoof BLOCK / self-approve BLOCK / legit pending row OK /
-- gift RPC e2e (455→405, row+ledger+notif) OK / insufficient clean-error
-- (coins intact) OK / self-gift BLOCK — 11/11 ✓
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_me TEXT := auth.jwt() ->> 'sub';
  v_m RECORD; v_friend RECORD; v_my_name TEXT; v_col TEXT; v_bal NUMERIC; v_gift_id UUID;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Not authorized'); END IF;
  IF p_to_uid IS NULL OR p_to_uid = v_me THEN RETURN jsonb_build_object('ok', false, 'error', 'Apne aap ko gift nahi kar sakte'); END IF;
  SELECT id, entry_fee, entry_type, name, status INTO v_m FROM matches WHERE id::text = p_match_id;
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Match not found'); END IF;
  IF COALESCE(v_m.entry_fee, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Gift sirf paid matches par'); END IF;
  SELECT id, COALESCE(ff_uid, '') AS ff_uid INTO v_friend FROM users WHERE id = p_to_uid;
  IF v_friend.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Player not found'); END IF;
  SELECT COALESCE(ign, 'Player') INTO v_my_name FROM users WHERE id = v_me;
  v_col := CASE WHEN lower(COALESCE(v_m.entry_type, 'coin')) = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;
  /* FOR UPDATE + explicit balance check — balance-guard trigger FOUND ko
     true kar deta tha (v2 bug), isliye insufficient par UPDATE tak nahi jaate. */
  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1 FOR UPDATE', v_col) INTO v_bal USING v_me;
  IF v_bal IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'User not found'); END IF;
  IF v_bal < v_m.entry_fee THEN RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance'); END IF;
  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) - $1 WHERE id = $2', v_col, v_col) USING v_m.entry_fee, v_me;
  INSERT INTO gift_tickets (from_uid, from_name, to_uid, to_ff_uid, match_id, match_name, fee, entry_type, status)
  VALUES (v_me, v_my_name, p_to_uid, v_friend.ff_uid, v_m.id, v_m.name, v_m.entry_fee, v_m.entry_type, 'pending')
  RETURNING id INTO v_gift_id;
  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_me, v_col, 'debit', v_m.entry_fee, 'gift_entry');
  INSERT INTO notifications (user_id, type, title, body)
  VALUES (p_to_uid, 'gift_ticket', '🎁 Match Ticket Gift!', v_my_name || ' ne tumhe "' || v_m.name || '" ka entry ticket gift kiya!');
  RETURN jsonb_build_object('ok', true, 'gift_id', v_gift_id, 'fee', v_m.entry_fee);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.gift_match_entry(text, text) TO anon, authenticated;
