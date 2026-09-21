-- ═══════════════════════════════════════════════════════════════
-- R24 ROUND DELTA — 2026-09-21y (VOUCHER system fix)
-- चलाया गया: Supabase Mgmt API से (LIVE-EXECUTED, live-verified)
-- ═══════════════════════════════════════════════════════════════

-- 1) vouchers.used tabular-safe status स्तंभ (admin Disable पहले no-op)
--    redeem_voucher अब disabled voucher रिजेक्ट करता है।
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
-- (updated_at भी आवश्यक — bridge का supaSet-क्रम हर तालिका के upsert में
--  updated_at stamp करता है); बिना-इस-स्तंभ उसका upsert चुपचाप असफल रहता है।
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2) redeem_voucher: status-check + reward_type-उपलब्धिदायक (admin 'money'
--    विकल्प अब coins-पथ पर गिरता है; old ELSE sky_diamonds था — cash-voucher
--    गलत मुद्रा में जमा होता था)। 2026-09-08 वाली server-authoritative
--    semantics बरकरार (unique_redemption, FOR UPDATE, atomic used_count)।
CREATE OR REPLACE FUNCTION public.redeem_voucher(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_voucher RECORD;
  v_col TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_voucher FROM vouchers WHERE code = upper(p_code) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid voucher code');
  END IF;

  IF COALESCE(v_voucher.status, 'active') <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher disabled');
  END IF;

  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher expired');
  END IF;

  IF COALESCE(v_voucher.used_count, 0) >= COALESCE(v_voucher.max_uses, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher limit reach ho gaya');
  END IF;

  BEGIN
    INSERT INTO voucher_redemptions (voucher_code, user_id) VALUES (upper(p_code), v_caller);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aap already yeh voucher redeem kar chuke ho');
  END;

  v_col := CASE COALESCE(v_voucher.reward_type, 'coins')
    WHEN 'coins' THEN 'coins'
    WHEN 'green_diamonds' THEN 'green_diamonds'
    WHEN 'sky_diamonds' THEN 'sky_diamonds'
    ELSE 'coins'
  END;

  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', v_col, v_col)
    USING v_voucher.reward_amount, v_caller;

  UPDATE vouchers SET used_count = COALESCE(used_count, 0) + 1 WHERE code = upper(p_code);

  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason, ref_id)
  VALUES (v_caller, v_col, 'credit', v_voucher.reward_amount, 'voucher', upper(p_code));

  RETURN jsonb_build_object('success', true, 'currency', v_col, 'amount', v_voucher.reward_amount);
END;
$function$;

-- (डेटा-परिवर्तन नहीं — नई status स्तंभ + function-body।)
-- सत्यापन: column status मौजूद ✓; functiondef में 'Voucher disabled' ✓
