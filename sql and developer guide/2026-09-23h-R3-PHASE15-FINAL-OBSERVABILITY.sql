-- ============================================================================
-- R3 Phase-15 (Final Production Check) — Observability completion + dedup
-- File: 2026-09-23h-R3-PHASE15-FINAL-OBSERVABILITY.sql
-- Date: 2026-09-23
-- Severity: P1 (wallet_audit_log unwired → 0 rows) + P3 (duplicate line)
-- ============================================================================
-- TWO fixes:
--
-- (A) wallet_audit_log UNWIRED → WIRED (P1 observability)
--     Finding: `wallet_audit_log` table मौजूद थी पर 0 rows और कोई function/trigger
--     उसे INSERT नहीं करता था (admin_activity_log तो client-side JS से लिखा जाता
--     है — live; पर wallet_audit_log का कोई writer ही नहीं था = silent empty
--     audit table)। users के money-balance columns (coins/sky_diamonds/
--     green_diamonds/sponsored_winnings) की हर UPDATE का before/after snapshot
--     अब AFTER-UPDATE trigger से wallet_audit_log में दर्ज होता है।
--     यह pure-observability add है — कोई business rule / amount / path नहीं बदला।
--
-- (B) cancel_match_with_refunds duplicate-line dedup (P3 cleanliness)
--     `v_currency := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE
--     'sky_diamonds' END;` एक ही लाइन लगातार दो बार थी — same value twice assign
--     (harmless redundancy; refund/ledger/notification सब single थे — कोई
--     double-refund नहीं)। एक copy हटाई गई, व्यवहार byte-identical।
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) wallet_audit_log balance-change audit trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_wallet_balance_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 🔒 R3 Phase-13/15 (2026-09-23): wallet_audit_log ab tak UNWIRED tha
  --    (0 rows — koi function INSERT nahi karta). Ab users ke money-
  --    balance columns par har UPDATE ka before/after snapshot yahan
  --    darta hai. SECURITY DEFINER + search_path fixed. NULL-safe
  --    COALESCE so comparison/snapshot kabhi crash nahi hota.
  IF COALESCE(NEW.coins,0)        IS DISTINCT FROM COALESCE(OLD.coins,0) THEN
    INSERT INTO wallet_audit_log(user_id, action, amount, currency, before_balance, after_balance, performed_by, created_at)
    VALUES (NEW.id, 'balance_change', COALESCE(NEW.coins,0) - COALESCE(OLD.coins,0), 'coins',
            COALESCE(OLD.coins,0), COALESCE(NEW.coins,0),
            COALESCE(auth.jwt() ->> 'sub', 'system'), NOW());
  END IF;

  IF COALESCE(NEW.sky_diamonds,0) IS DISTINCT FROM COALESCE(OLD.sky_diamonds,0) THEN
    INSERT INTO wallet_audit_log(user_id, action, amount, currency, before_balance, after_balance, performed_by, created_at)
    VALUES (NEW.id, 'balance_change', COALESCE(NEW.sky_diamonds,0) - COALESCE(OLD.sky_diamonds,0), 'sky_diamonds',
            COALESCE(OLD.sky_diamonds,0), COALESCE(NEW.sky_diamonds,0),
            COALESCE(auth.jwt() ->> 'sub', 'system'), NOW());
  END IF;

  IF COALESCE(NEW.green_diamonds,0) IS DISTINCT FROM COALESCE(OLD.green_diamonds,0) THEN
    INSERT INTO wallet_audit_log(user_id, action, amount, currency, before_balance, after_balance, performed_by, created_at)
    VALUES (NEW.id, 'balance_change', COALESCE(NEW.green_diamonds,0) - COALESCE(OLD.green_diamonds,0), 'green_diamonds',
            COALESCE(OLD.green_diamonds,0), COALESCE(NEW.green_diamonds,0),
            COALESCE(auth.jwt() ->> 'sub', 'system'), NOW());
  END IF;

  IF COALESCE(NEW.sponsored_winnings,0) IS DISTINCT FROM COALESCE(OLD.sponsored_winnings,0) THEN
    INSERT INTO wallet_audit_log(user_id, action, amount, currency, before_balance, after_balance, performed_by, created_at)
    VALUES (NEW.id, 'balance_change', COALESCE(NEW.sponsored_winnings,0) - COALESCE(OLD.sponsored_winnings,0), 'sponsored',
            COALESCE(OLD.sponsored_winnings,0), COALESCE(NEW.sponsored_winnings,0),
            COALESCE(auth.jwt() ->> 'sub', 'system'), NOW());
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_wallet_balance ON public.users;
CREATE TRIGGER trg_audit_wallet_balance
AFTER UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.audit_wallet_balance_changes();

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) cancel_match_with_refunds — duplicate v_currency line dedup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_jr RECORD;
  v_refund_count INT := 0;
  v_currency TEXT;
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  /* FIX (2026-09-20 Round-4): YE RPC BINA GUARD KE THA — koi bhi user
     kisi bhi match ko cancel karke sabko refunds dilwa sakta tha
     (match-sabotage). Ab sirf admin. p_admin_uid ab caller se hi. */
  IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  p_admin_uid := COALESCE(p_admin_uid, v_caller);

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;
  FOR v_jr IN
  SELECT * FROM join_requests
  WHERE match_id = p_match_id
  AND status NOT IN ('cancelled', 'refunded', 'rejected')
  AND COALESCE(entry_fee_paid, 0) > 0
  FOR UPDATE
  LOOP
  -- ✅ R3 Phase-14 (2026-09-23): duplicate `v_currency := ...` line hatai —
  --    same value twice assign ho rahi thi (harmless redundancy, single
  --    refund/ledger/notification insert tha — koi double-refund nahi).
  v_currency := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

    IF v_currency = 'coins' THEN
      UPDATE users SET coins = COALESCE(coins,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    ELSE
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    END IF;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
    VALUES (v_jr.user_id, v_currency, 'credit', v_jr.entry_fee_paid, 'match_cancelled_refund', p_match_id, 'approved');

    UPDATE join_requests SET status = 'refunded' WHERE id = v_jr.id;

    INSERT INTO notifications(user_id, title, body, type, is_read, created_at, ref_id)
    VALUES (
      v_jr.user_id,
      '💰 Match Cancelled — Refund',
      '"' || COALESCE(v_match.name, v_match.title, p_match_id) || '" cancel ho gaya. Aapka entry fee wapas kar diya gaya hai.',
      'refund',
      false,
      NOW(),
      p_match_id
    );

    v_refund_count := v_refund_count + 1;
  END LOOP;

  UPDATE join_requests
  SET status = 'cancelled'
  WHERE match_id = p_match_id AND status NOT IN ('cancelled', 'refunded', 'rejected');

  /* R29B: filled_slots decrement — cancelled/refunded rows count ghato (drift fix). */
  UPDATE matches SET filled_slots = GREATEST(
    filled_slots - (
      SELECT COUNT(*) FROM join_requests
      WHERE match_id = p_match_id AND status IN ('cancelled','refunded')
    ), 0)
  WHERE id = p_match_id;

  UPDATE matches SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = p_admin_uid WHERE id = p_match_id;

  RETURN jsonb_build_object('ok', true, 'refund_count', v_refund_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Live verification (2026-09-23, qa1 — cleanup पूरा):
--   (A) claim_ad_reward (no-params) → coins 495→505; wallet_audit_log में
--       row: currency=coins, action=balance_change, amount=+10,
--       before=495, after=505, performed_by=oLw9VxHKjWb9i4HZA5fj5pX3i033 ✅
--       (ad-reward coins -10 restore + audit rows delete करके cleanup।)
--   (B) live pg_get_functiondef में v_currency assignment अब 1 occurrence ✅
--       (पहले 2)। Refund/ledger/notification single-hi रहे — double-refund नहीं।
--   SECDEF total अब 83 (82 + audit_wallet_balance_changes) — sql_verify_script 30/30।
-- ─────────────────────────────────────────────────────────────────────────────
