-- ============================================================================
-- R3 Phase-9 (cont.) / Phase-11 — SECDEF NULL-CALLER DEFAULT-ALLOW FIX (family)
-- File: 2026-09-23f-R3-PHASE9-CLAN-NULLCALLER.sql
-- Date: 2026-09-23
-- Severity: P0 (contribute_to_squad_bank anon GD-burn) +
--           P0 (validate_and_join_match anon wallet-attack) +
--           P1 (join_clan/leave_clan anon forgery)
-- ============================================================================
-- ROOT CAUSE (same SECDEF trap class as increment_clan_score in 2026-09-23e):
--   `IF v_caller IS NOT NULL AND v_caller <> p_uid THEN ...` guard pattern
--   mein NULL caller (anon / service / कोई भी बिना auth.jwt) पर check SKIP
--   ho जाता था → fail-open. Live-proven:
--     • anon RPC contribute_to_squad_bank(fake_clan, qa1_uid, 1) → 200 ok:true,
--       qa1 का असली green_diamonds 14→13 घटा, clans में कुछ जमा नहीं,
--       wallet_transactions में कोई row नहीं  ⇒ **GD silently burn** (P0 money).
--     • contribute_to_squad_bank / join_clan / leave_clan /
--       unlock_squad_bank_cosmetic सबको EXECUTE grant `anon` को भी था।
-- FIX:
--   (A) Body guard fail-closed: NULL caller → block (सिर्फ़ है-नहीं तो नहीं,
--       हमेशा identity चाहिए)।
--   (B) contribute_to_squad_bank: clan मौजूद है + caller उस clan का member
--       (leader founder भी clan_members.row रखता है — create path proven)
--       तभी debit; UPDATE ... WHERE id और found-flag से कोई phantom row नहीं।
--   (C) ⚠️ anon EXECUTE revoke **मत** करो — यह app Firebase JWT को Bearer की
--       तरह भेजता है (role claim नहीं होता) → PostgREST सबको anon मानता है;
--       revoke करने पर authenticated भी 42501 पाते हैं (live-proven)।
--       असली security = body guard ही, grant वाला नहीं।
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) contribute_to_squad_bank — P0 money-burn close
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contribute_to_squad_bank(
  p_clan_id UUID,
  p_uid     TEXT,
  p_amount  NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_balance      NUMERIC;
  v_ign          TEXT;
  v_contributors JSONB;
  v_prior        JSONB;
  v_clan_ok      BOOLEAN;
  v_is_member    BOOLEAN;
BEGIN
  -- 🔒 R3 P0 FIX (2026-09-23): SECDEF NULL-caller trap — fail-closed.
  --    पहले `IS NOT NULL AND <>` था ⇒ anon (NULL caller) पर guard skip होकर
  --    किसी भी user का GD काट सकता था (fake clan में burn). अब कोई identity
  --    न हो तो तुरंत रोक। service_role इस RPC को बुलाता ही नहीं (client-केवल)।
  IF v_caller IS NULL OR v_caller <> p_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;

  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid amount');
  END IF;

  -- 🔒 R3 P0 FIX (2026-09-23): clan exist + membership — पहले fake/nonexistent
  --    clan_id से भी debit हो जाता था (join update no-op) और GD गायब (=burn).
  SELECT EXISTS (SELECT 1 FROM clans WHERE id = p_clan_id) INTO v_clan_ok;
  IF NOT v_clan_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Clan not found');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_uid
  ) INTO v_is_member;
  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not a member of this clan');
  END IF;

  SELECT green_diamonds, COALESCE(ign, 'Player') INTO v_balance, v_ign
  FROM users WHERE id = p_uid FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Counterparty row lock — ab exist प्रमाणित है, race-safe read+update.
  PERFORM 1 FROM clans WHERE id = p_clan_id FOR UPDATE;

  UPDATE users
     SET green_diamonds = green_diamonds - p_amount
   WHERE id = p_uid;

  SELECT squad_bank_contributors INTO v_contributors FROM clans WHERE id = p_clan_id;
  v_contributors := COALESCE(v_contributors, '{}'::JSONB);
  v_prior := COALESCE(v_contributors -> p_uid, '{}'::JSONB);

  UPDATE clans
     SET squad_bank_gd = COALESCE(squad_bank_gd, 0) + p_amount,
         squad_bank_contributors = v_contributors || jsonb_build_object(
           p_uid, jsonb_build_object(
             'ign', v_ign,
             'gd', COALESCE((v_prior->>'gd')::NUMERIC, 0) + p_amount,
             'last_contributed', NOW()
           )
         )
   WHERE id = p_clan_id;

  RETURN jsonb_build_object('ok', true, 'amount', p_amount);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) join_clan — P1 null-caller membership forgery close
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_clan(
  p_user_id TEXT,
  p_clan_id UUID,
  p_role    TEXT DEFAULT 'member'::TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_already BOOLEAN;
  v_caller  TEXT := auth.jwt() ->> 'sub';
BEGIN
  -- 🔒 R3 P1 FIX (2026-09-23): NULL-caller fail-closed — anon पहले किसी भी
  --    user को किसी भी clan में डाल सकता था (total_members/users.clan_id फोर्ज)।
  IF v_caller IS NULL OR v_caller <> p_user_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  p_role := 'member'; -- हमेशा forced — self-promotion संभव नहीं

  SELECT EXISTS(
    SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_user_id
  ) INTO v_already;
  IF v_already THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already in clan');
  END IF;
  INSERT INTO clan_members(clan_id, user_id, role) VALUES(p_clan_id, p_user_id, p_role);
  UPDATE clans SET total_members = COALESCE(total_members, 0) + 1 WHERE id = p_clan_id;
  UPDATE users SET clan_id = p_clan_id::TEXT WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM WHEN 'NOT_AUTHORIZED' THEN 'Not authorized' ELSE SQLERRM END);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) leave_clan — P1 null-caller griefing close
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_clan(p_user_id TEXT, p_clan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      TEXT := auth.jwt() ->> 'sub';
  v_real_leader TEXT;
BEGIN
  -- 🔒 R3 P1 FIX (2026-09-23): NULL-caller fail-closed — anon पहले किसी भी
  --    user को उसके clan से निकाल सकता था (griefing).
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  IF v_caller <> p_user_id THEN
    SELECT leader_uid INTO v_real_leader FROM clans WHERE id = p_clan_id;
    IF v_real_leader IS DISTINCT FROM v_caller THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
    END IF;
  END IF;

  DELETE FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_user_id;
  UPDATE clans SET total_members = GREATEST(COALESCE(total_members, 1) - 1, 0) WHERE id = p_clan_id;
  UPDATE users SET clan_id = NULL WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) unlock_squad_bank_cosmetic — null-caller fail-closed (shape consistent)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unlock_squad_bank_cosmetic(
  p_clan_id UUID,
  p_item_id TEXT,
  p_cost    INTEGER,
  p_uid     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_catalog_cost TEXT;
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_gd       INT;
  v_unlocked JSONB;
  v_is_member BOOLEAN;
BEGIN
  -- 🔒 R3 P1 FIX (2026-09-23): NULL-caller fail-closed.
  IF v_caller IS NULL OR v_caller <> p_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  SELECT EXISTS(SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_uid) INTO v_is_member;
  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not a member of this clan');
  END IF;

  /* FIX (2026-09-20 Round-4): p_cost IGNORE — cost catalog se
     (app_settings 'squad_bank_items'). Pehle member cost=1 likh ke koi
     bhi item unlock kar sakta tha. */
  SELECT value->p_item_id->>'cost' INTO v_catalog_cost FROM app_settings WHERE key = 'squad_bank_items';
  IF v_catalog_cost IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_item');
  END IF;
  p_cost := v_catalog_cost::NUMERIC;

  SELECT squad_bank_gd, COALESCE(squad_bank_unlocked, '{}'::JSONB)
  INTO v_gd, v_unlocked
  FROM clans WHERE id = p_clan_id FOR UPDATE;

  IF v_gd IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Clan not found');
  END IF;
  IF v_unlocked ? p_item_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already unlocked');
  END IF;
  IF v_gd < p_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient squad bank balance');
  END IF;

  UPDATE clans SET
    squad_bank_gd = squad_bank_gd - p_cost,
    squad_bank_unlocked = v_unlocked || jsonb_build_object(
      p_item_id, jsonb_build_object('unlockedAt', NOW(), 'unlockedBy', p_uid)
    )
  WHERE id = p_clan_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (5) GRANTS — 🔴 anon revoke मत करो (platform fact, नीचे वजह)
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔒 R3 PLATFORM FACT (2026-09-23, live-proven — DEVELOPER_GUIDE §H में भी दर्ज):
--   यह app Firebase JWT को सीधे Bugएअर header की तरह भेजता है (core/db.js
--   "Recreate Supabase client with Firebase token as Bearer"). Firebase JWT
--   में `role` CLaim नहीं होता → PostgREST हर request को **anon** role मानता
--   है (authenticated नहीं)। इसीलिए:
--     • जिन RPCs में `anon EXECUTE` grant है वे चलते हैं;
--     • अगर `REVOKE ... FROM anon` कर दो तो **authenticated users भी 42501**
--       पाते हैं (असली app टूट जाती है) — live-proven is fix के दौरान।
--   इसलिए इन functions की असली security = **BODY GUARD** (fail-closed
--   null-caller check), grant-level revoke नहीं। anon grant बरक़रार रहता है।
--
--   नोट: `existing` deploy में ये functions already anon-granted थे; यह file
--   उन्हें restore/confirm ही करती है (कोई new grant नहीं):
GRANT EXECUTE ON FUNCTION public.contribute_to_squad_bank(UUID, TEXT, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_clan(TEXT, UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_clan(TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlock_squad_bank_cosmetic(UUID, TEXT, INTEGER, TEXT) TO anon, authenticated, service_role;



-- ════════════════════════════════════════════════════════════════════════════
-- (6) validate_and_join_match — P0 null-caller wallet-attack close
-- ════════════════════════════════════════════════════════════════════════════
-- MONEY-PATH JOIN RPC. Fail-open guard live-proven (2026-09-23):
--   anon RPC fake-match → 'Match not found' (guard skip), जबकि authenticated
--   cross-uid को 'Not authorized'। यानी anon किसी भी user का balance काटकर
--   उसे किसी भी match में forced-join करा सकता था। Fail-closed now:
CREATE OR REPLACE FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m              RECORD;
  v_balance        NUMERIC;
  v_joined         BOOLEAN := false;
  v_jr_id          UUID;
  v_fee_mode       TEXT;
  v_server_fee     NUMERIC;
  v_slots          INT;
  v_charge_fee     NUMERIC;
  v_available      INT;
  v_caller         TEXT := auth.jwt() ->> 'sub';
  v_creator_code   TEXT;
  v_creator_uid    TEXT;
  v_commission     NUMERIC;
  v_commission_pct NUMERIC;
BEGIN
  -- 🔒 R3 P0 FIX (2026-09-23): NULL-caller fail-closed.
  IF v_caller IS NULL OR v_caller <> p_uid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  /* R3-P0 FIX (2026-09-23): fee/pricing server-authoritative.
     p_entry_fee/p_currency = legacy signature only, IGNORED. */

  SELECT id, title, status, entry_type, entry_fee, max_slots, filled_slots, creator_uid
    INTO v_m
    FROM matches
   WHERE id = p_match_id
     FOR UPDATE;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_m.status IS DISTINCT FROM 'upcoming' AND v_m.status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'MATCH_NOT_JOINABLE';
  END IF;

  IF v_m.creator_uid IS NOT NULL AND v_m.creator_uid = p_uid THEN
    RAISE EXCEPTION 'SELF_PLAY_BLOCKED';
  END IF;

  IF COALESCE((SELECT is_banned FROM users WHERE id = p_uid), false) THEN
    RAISE EXCEPTION 'ACCOUNT_BANNED';
  END IF;

  CASE COALESCE(lower(regexp_replace(v_m.entry_type, '[_ -]', '', 'g')), 'free')
    WHEN 'coin' THEN
      v_server_fee := COALESCE(v_m.entry_fee, 0);
      v_fee_mode   := 'coins';
    WHEN 'paid' THEN
      v_server_fee := COALESCE(v_m.entry_fee, 0);
      v_fee_mode   := 'sky_diamonds';
    WHEN 'free' THEN
      v_server_fee := 0; v_fee_mode := 'free';
    WHEN 'ad' THEN
      v_server_fee := 0; v_fee_mode := 'ad';
    ELSE
      IF COALESCE(v_m.entry_fee, 0) > 0 THEN
        v_server_fee := v_m.entry_fee; v_fee_mode := 'sky_diamonds';
      ELSE
        v_server_fee := 0; v_fee_mode := 'free';
      END IF;
  END CASE;

  v_slots := 1;
  IF p_join_data IS NOT NULL AND p_join_data ? 'mode' THEN
    IF p_join_data->>'mode' = 'duo'  THEN v_slots := 2; END IF;
    IF p_join_data->>'mode' = 'squad' THEN v_slots := 4; END IF;
  END IF;

  v_charge_fee :=
    CASE
      WHEN v_slots = 1 THEN v_server_fee
      WHEN (p_join_data->>'feeType') = 'each_pays' THEN v_server_fee
      ELSE v_server_fee * v_slots
    END;

  IF v_server_fee > 0 THEN
    IF v_fee_mode = 'coins' THEN
      SELECT coins INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
    ELSE
      SELECT sky_diamonds INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
    END IF;
    IF v_balance IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
    IF v_balance < v_charge_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM join_requests
    WHERE user_id = p_uid AND match_id = p_match_id
      AND status NOT IN ('cancelled','refunded','no_show')
  ) INTO v_joined;
  IF v_joined THEN RAISE EXCEPTION 'ALREADY_JOINED'; END IF;

  v_available := COALESCE(v_m.max_slots, 999) - COALESCE(v_m.filled_slots, 0);
  IF v_available < v_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  IF v_server_fee > 0 THEN
    IF v_fee_mode = 'coins' THEN
      UPDATE users SET coins = coins - v_charge_fee WHERE id = p_uid;
    ELSE
      UPDATE users SET sky_diamonds = sky_diamonds - v_charge_fee WHERE id = p_uid;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(p_uid, v_fee_mode, 'debit', v_charge_fee, 'match_entry', p_match_id);
  END IF;

  INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, mode, ign_at_join, fee_type)
  VALUES(
    p_uid, p_match_id, v_charge_fee,
    CASE WHEN v_fee_mode='coins' THEN 'coin'
         WHEN v_fee_mode='sky_diamonds' THEN 'sky_diamond'
         ELSE COALESCE(v_m.entry_type, 'free') END,
    'joined',
    COALESCE(p_join_data->>'mode', 'solo'),
    COALESCE(p_join_data->>'ign', ''),
    COALESCE(p_join_data->>'feeType', 'solo')
  ) RETURNING id INTO v_jr_id;

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + 1 WHERE id = p_match_id;

  IF v_fee_mode = 'sky_diamonds' AND v_charge_fee > 0 THEN
    SELECT creator_code INTO v_creator_code FROM users WHERE id = p_uid;
    IF v_creator_code IS NOT NULL THEN
      SELECT user_id INTO v_creator_uid FROM creator_codes WHERE code = v_creator_code;
      IF v_creator_uid IS NOT NULL AND v_creator_uid <> p_uid
         AND EXISTS(SELECT 1 FROM users WHERE id = v_creator_uid AND is_creator = true) THEN
        SELECT COALESCE((value->>'sdMatchCommissionPct')::numeric, 15)
          INTO v_commission_pct
          FROM app_settings WHERE key = 'creator_system';
        v_commission_pct := COALESCE(v_commission_pct, 15);

        v_commission := ROUND(v_charge_fee * v_commission_pct / 100, 2);
        INSERT INTO creator_stats(user_id, total_matches, total_earnings)
        VALUES (v_creator_uid, 1, v_commission)
        ON CONFLICT (user_id) DO UPDATE SET
          total_matches = creator_stats.total_matches + 1,
          total_earnings = creator_stats.total_earnings + v_commission,
          updated_at = NOW();
        INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
        VALUES (v_creator_uid, p_match_id, v_commission, 'inr', 'hold', NOW() + INTERVAL '7 days');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'jr_id', v_jr_id::TEXT);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'       THEN 'Not authorized'
        WHEN 'MATCH_NOT_FOUND'      THEN 'Match not found'
        WHEN 'MATCH_NOT_JOINABLE'   THEN 'Match ab join nahi ho sakta'
        WHEN 'USER_NOT_FOUND'       THEN 'User not found'
        WHEN 'INSUFFICIENT_BALANCE' THEN 'Balance kam hai'
        WHEN 'ALREADY_JOINED'       THEN 'Aap already join ho chuke ho'
        WHEN 'MATCH_FULL'           THEN 'Match full ho gaya'
        WHEN 'SELF_PLAY_BLOCKED'    THEN 'Apne khud ke hosted match mein join nahi kar sakte'
        WHEN 'ACCOUNT_BANNED'       THEN 'Aapka account ban hai'
        ELSE SQLERRM
      END
    );
END;
$function$;
