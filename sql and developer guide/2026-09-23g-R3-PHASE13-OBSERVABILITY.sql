-- ============================================================================
-- R3 Phase-13 (Observability) — contribute_to_squad_bank LOST-MONEY-LEDGER FIX
-- File: 2026-09-23g-R3-PHASE13-OBSERVABILITY.sql
-- Date: 2026-09-23
-- Severity: P1 (audit gap — पैसा हिलता था पर ledger में trace नहीं)
-- ============================================================================
-- FINDING (live-proven):
--   30 money-mutating SECURITY DEFINER functions में से 5 का कोई
--   wallet_transactions INSERT नहीं:
--     admin_sync_user_balance, contribute_to_squad_bank, decrement_balance,
--     finalize_creator_commission, increment_balance.
--   इनमें से contribute_to_squad_bank में असली user-GD debit होता है
--   (users.green_diamonds -= amount) और वही debit कभी wallet_transactions में
--   लिखा नहीं जाता था — squad_bank में जमा होते हुए भी trace नहीं मिलता था।
--   (बाक़ी 4 admin/derived updaters हैं — admin_activity_log/wallet_audit_log
--    से cover होंगे; देखें Phase-12/13 planner।)
--
--   wallet_audit_log table मौजूद है पर 0 rows और कोई function उसे INSERT
--   नहीं करता; admin_activity_log में 6 rows हैं पर कोई function उसे भी
--   reference नहीं करता — ये gaps अलग से closed होंगे (Phase-12/13 planner)
--   ताकि असली audit trail बने, केवल silent table नहीं।
--
-- FIX (इस delta में):
--   contribute_to_squad_bank के debit के साथ wallet_transactions row जोड़ी
--   (currency = 'green_diamonds', txn_type = 'debit', reason =
--   'squad_bank_contribution', ref_id = clan_id, status = 'approved') —
--   ठीक वैसे ही जैसे gift_match_entry / purchase_cosmetic / claim_ad_reward
--   करते हैं। बाक़ी सारा behaviour (clan-exist, membership, caller check,
--   race-safe row locks, return shape) अपरिवर्तित।
-- ============================================================================

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

  -- 🔒 R3 P1 FIX (2026-09-23, observability/audit): ye debit ka koi
  --    wallet_transactions ledger row nahi tha (baaki sab money RPCs की
  --    तरह) — GD ab contribution trace hota hai.
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
  VALUES (p_uid, 'green_diamonds', 'debit', p_amount, 'squad_bank_contribution', p_clan_id::text, 'approved');

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
-- (2) Live verification (2026-09-23, qa1 — test clan के साथ, cleanup बाद):
--   contribute 2 GD → ok:true; users.green_diamonds 16→14;
--   clans.squad_bank_gd 0→2; wallet_transactions रो दिखी:
--     currency=green_diamonds, txn_type=debit, amount=2,
--     reason=squad_bank_contribution, status=approved  ✅
--   (test fixtures clan/member/ledger row हटा कर qa1 GD restore कर दिया।)
-- ─────────────────────────────────────────────────────────────────────────────
