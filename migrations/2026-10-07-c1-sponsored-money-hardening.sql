-- ════════════════════════════════════════════════════════════════════
-- C1 (2026-10-07) — Sponsored real-money: "shoonya galti" hardening
-- ════════════════════════════════════════════════════════════════════
-- Context: sponsored prize ka real money users.sponsored_winnings me aata hai,
-- aur nikalna sirf admin-approved `resolve_sponsored_withdrawal` RPC se hota
-- hai (payout reference / UTR lazmi). Ye migration us path ki teen bachi hui
-- kamzoriyan band karta hai — sab fail-closed (galti par kuch nahi hota):
--   1. `fft_guard_wallet_insert` — user apna pending_withdraw ledger row sirf
--      asli shape me bana sakta hai (amount > 0, currency 'sponsored',
--      status pending).
--   2. `admin_distribute_sponsored_prize` — per-tournament advisory lock
--      (race-proof duplicate-guard + pool-cap) aur DB-level unique index par
--      `already_credited` ka friendly error.
--   3. `resolve_sponsored_withdrawal` — amount <= 0 wali degenerate row bhi
--      process nahi hoti.
-- Index: ek user ko ek hi tournament ka prize sirf EK BAAR (atomic).
-- ════════════════════════════════════════════════════════════════════

-- 0) Pehle se padhe hue duplicate (agar koi ho) ka saaf check — index tabhi
--    banega jab data saaf ho (live: sponsored_prize rows = 0).
DO $$
DECLARE v_dupes int;
BEGIN
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT user_id, ref_id FROM public.wallet_transactions
    WHERE reason IN ('sponsored_prize','sponsored_coin_prize') AND ref_id IS NOT NULL
    GROUP BY 1,2 HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'C1: % duplicate sponsored-prize rows mile — pehle inhe saaf karo', v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wt_sponsored_prize_once
  ON public.wallet_transactions (user_id, ref_id)
  WHERE reason IN ('sponsored_prize','sponsored_coin_prize') AND ref_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fft_guard_wallet_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','authenticator') THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Wallet entries sirf authenticated system path se banti hain';
  END IF;

  IF NEW.user_id = v_caller AND NEW.txn_type = 'pending_deposit' THEN
    IF NEW.currency <> 'sky_diamonds' THEN
      RAISE EXCEPTION 'pending_deposit ledger rows must be sky_diamonds';
    END IF;
    IF NEW.amount IS NULL OR NEW.amount <= 0 OR NEW.amount > 100000 THEN
      RAISE EXCEPTION 'pending_deposit amount out of range (1..100000)';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id = v_caller AND NEW.txn_type = 'pending_withdraw' THEN
    /* ✅ C1-HARDENING (2026-10-07): ek user apna OORAA ledger row nahi bana
       sakta. Pehle yahan koi shape-check hi nahi tha — koi bhi logged-in user
       REST se `amount = 0` / `currency = 'xyz'` / khud `status = 'approved'`
       likh kar wallet history me jhooti entry daal sakta tha (balance column
       guard-users se mehfooz hi tha, par ledger ganda aur admin-confusion
       ban sakta tha). Ab sirf ASLI request shape chalti hai:
       amount > 0, currency 'sponsored' (ekमात्र withdrawable balance — SD
       sd_requests se, GD band, dono server RPC se),
       aur status NULL/'pending' (khud approve karna namumkin).
       Fail-closed hai: galat shape = request fail, koi paisa nahi hilta. */
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
      RAISE EXCEPTION 'pending_withdraw amount 0 se bada hona chahiye';
    END IF;
    IF NEW.currency IS DISTINCT FROM 'sponsored' THEN
      RAISE EXCEPTION 'pending_withdraw sirf sponsored winnings ke liye hai (currency: sponsored)';
    END IF;
    IF NEW.status IS NOT NULL AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'pending_withdraw khud approve/reject nahi ho sakta (status: pending hi rahega)';
    END IF;
    IF NEW.txn_type = 'pending_withdraw' AND COALESCE(NEW.reason, 'sponsored_withdrawal') <> 'sponsored_withdrawal' THEN
      RAISE EXCEPTION 'pending_withdraw reason sirf sponsored_withdrawal';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Wallet entries (%) sirf system create kar sakta hai', NEW.txn_type;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_distribute_sponsored_prize(p_uid text, p_amount numeric, p_tour_id text DEFAULT NULL::text, p_rank text DEFAULT NULL::text, p_currency text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_target_uid TEXT;
  v_uname TEXT;
  v_clean TEXT := trim(COALESCE(p_uid, ''));
  v_cur   TEXT;
  /* ✅ record ke bajaye scalar — `SELECT INTO <record>` sirf tab chalta hai
     jab wo statement sach me chali ho; p_tour_id khaali hone par record
     "not assigned yet" error deta. Scalars hamesha NULL set hote hain. */
  v_tour_id   UUID;
  v_tour_pt   TEXT;
  v_tour_pool NUMERIC;
  v_pool  NUMERIC;
  v_paid  NUMERIC;
  v_before NUMERIC;
  v_after  NUMERIC;
  v_reason TEXT;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL OR NOT public.is_caller_admin() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
  END IF;
  IF v_clean = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  -- Resolve by exact user id first, then FF UID, then case-insensitive IGN
  SELECT id, COALESCE(ign, 'Player') INTO v_target_uid, v_uname
  FROM public.users
  WHERE id = v_clean
  LIMIT 1;

  IF v_target_uid IS NULL THEN
    SELECT id, COALESCE(ign, 'Player') INTO v_target_uid, v_uname
    FROM public.users
    WHERE ff_uid = v_clean
    LIMIT 1;
  END IF;

  IF v_target_uid IS NULL THEN
    SELECT id, COALESCE(ign, 'Player') INTO v_target_uid, v_uname
    FROM public.users
    WHERE lower(ign) = lower(v_clean)
    LIMIT 1;
  END IF;

  IF v_target_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found: ' || v_clean);
  END IF;

  /* ✅ B11: tournament row (agar mile to) — currency AUR pool dono wahi se
     aate hain, client ke param se nahi (anti-tamper, B26 wala hi usool).
     `id::text = p_tour_id` — isliye ki purane/hand-made non-uuid keys par
     bhi cast-error na aaye. */
  IF p_tour_id IS NOT NULL AND trim(p_tour_id) <> '' THEN
    SELECT id, prize_type, prize_pool INTO v_tour_id, v_tour_pt, v_tour_pool
    FROM public.sponsored_tournaments WHERE id::text = trim(p_tour_id) LIMIT 1;
  END IF;

  IF v_tour_id IS NOT NULL THEN
    v_cur := CASE WHEN lower(COALESCE(v_tour_pt,'cash')) IN ('coin','coins') THEN 'coin' ELSE 'cash' END;
    v_pool := COALESCE(v_tour_pool, 0);
  ELSE
    v_cur := CASE WHEN lower(COALESCE(p_currency,'cash')) IN ('coin','coins','🪙') THEN 'coin' ELSE 'cash' END;
    v_pool := 0;   /* purana/nirjan tournament — pool-cap skip */
  END IF;
  v_reason := CASE WHEN v_cur = 'coin' THEN 'sponsored_coin_prize' ELSE 'sponsored_prize' END;

  /* ✅ C1-HARDENING (2026-10-07): ek hi tournament ke saare credits ko
     serialize karne ke liye per-tournament advisory lock — do windows/tabs se
     ek saath click hone par bhi duplicate-guard aur pool-cap ki race namumkin
     (`pg_advisory_xact_lock` transaction ke end tak rehta hai; jahan tour id
     nahi hai wahan bhi ek hi lock ('-') par line lagti hai, yani legacy call
     bhi serial — 96 rows wali condition ab do jagah nahi gir sakti). */
  IF p_tour_id IS NOT NULL AND trim(p_tour_id) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('ffsprize:' || trim(p_tour_id))::bigint);
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('ffsprize:-')::bigint);
  END IF;

  /* ✅ B11 DUPLICATE-GUARD: ek hi sponsored tournament ka prize ek hi user ko
     DOBARA credit nahi hoga (button do baar dab gaya, page refresh, ya jaan-
     bujh kar dobara call). Pehle aisa koi rok nahi tha → double paisa nikal
     sakta tha. Galat winner sudharne ke liye alag user ka payment chalta hai. */
  IF p_tour_id IS NOT NULL AND trim(p_tour_id) <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.wallet_transactions
      WHERE ref_id = trim(p_tour_id)
        AND user_id = v_target_uid
        AND reason IN ('sponsored_prize','sponsored_coin_prize')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_credited',
                                'user_id', v_target_uid, 'ign', v_uname);
    END IF;
  END IF;

  /* ✅ B11 POOL-CAP: us tournament me ab tak kitna baant diya — pool se zyada
     kabhi nahi. (Pehle pool ka koi hisaab hi nahi rakha jaata tha.) */
  IF v_pool > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.wallet_transactions
    WHERE ref_id = trim(COALESCE(p_tour_id,''))
      AND reason IN ('sponsored_prize','sponsored_coin_prize');
    IF v_paid + p_amount > v_pool THEN
      RETURN jsonb_build_object('success', false, 'error', 'exceeds_prize_pool',
                                'pool', v_pool, 'already_paid', v_paid,
                                'requested', p_amount);
    END IF;
  END IF;

  IF v_cur = 'coin' THEN
    /* 🪙 Coin prize: seedha users.coins me (sponsored_winnings = real-money
       wallet hai, usme coins nahi daale jaate). */
    SELECT COALESCE(coins, 0) INTO v_before FROM public.users WHERE id = v_target_uid FOR UPDATE;
    UPDATE public.users SET coins = COALESCE(coins, 0) + p_amount WHERE id = v_target_uid;
    v_after := v_before + p_amount;
  ELSE
    SELECT COALESCE(sponsored_winnings, 0) INTO v_before FROM public.users WHERE id = v_target_uid FOR UPDATE;
    UPDATE public.users
    SET sponsored_winnings = COALESCE(sponsored_winnings, 0) + p_amount
    WHERE id = v_target_uid;
    v_after := v_before + p_amount;
  END IF;

  /* ✅ C1-HARDENING (2026-10-07): ledger row + unique index
     `uq_wt_sponsored_prize_once` — dup-guard ab DB-level par bhi
     (atomic). Kabhi bhi unique_violation aaya to friendly
     'already_credited' hi lautega, koi double-paisa nahi. */
  BEGIN
    INSERT INTO public.wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
    VALUES (v_target_uid,
            CASE WHEN v_cur = 'coin' THEN 'coins' ELSE 'sponsored' END,
            'credit', p_amount, v_reason, COALESCE(p_tour_id, NULL), 'approved');
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_credited',
                              'user_id', v_target_uid, 'ign', v_uname);
  END;

  /* ✅ B11 AUDIT TRAIL: kis admin ne, kitna, kis user ko, pehle/baad balance
     kya tha — hamesha ke liye likha jaata hai. */
  INSERT INTO public.wallet_audit_log(user_id, action, amount, currency, before_balance, after_balance, performed_by, note)
  VALUES (v_target_uid, v_reason, p_amount,
          CASE WHEN v_cur = 'coin' THEN 'coins' ELSE 'sponsored_winnings' END,
          v_before, v_after, COALESCE(v_caller, 'service_role'),
          'Sponsored prize ' || COALESCE(p_rank, '') || ' | tour: ' || COALESCE(p_tour_id, '-'));

  INSERT INTO public.notifications(user_id, type, title, body, is_read)
  VALUES (
    v_target_uid,
    'sponsored_prize',
    '🏆 Sponsored Prize Mili!',
    COALESCE(p_rank, 'Winner') || ' — ' ||
      CASE WHEN v_cur = 'coin'
           THEN '🪙 ' || p_amount || ' coins aapke wallet mein add ho gaye!'
           ELSE '₹' || p_amount || ' aapke wallet mein add ho gayi! Wallet > Withdraw se UPI pe bhej sakte hain.'
      END,
    false
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount, 'currency', v_cur,
                            'user_id', v_target_uid, 'resolved_uid', v_target_uid, 'ign', v_uname);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_txn      RECORD;
  v_balance  NUMERIC;
  v_after    NUMERIC;
  v_ref      TEXT := trim(COALESCE(p_note, ''));
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  SELECT * INTO v_txn FROM wallet_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;
  IF v_txn.txn_type <> 'pending_withdraw' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a pending withdrawal');
  END IF;
  IF COALESCE(v_txn.status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already resolved (status: ' || v_txn.status || ')');
  END IF;
  /* ✅ C1-HARDENING (2026-10-07): degenerate amount par ruk jao — approve par
     `balance - amount` hi hota hai, isliye 0/negative row ka koi matlab nahi;
     ab ledger me sirf asli request (amount > 0) hi process hoti hai. */
  IF v_txn.amount IS NULL OR v_txn.amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
  END IF;

  IF p_action = 'approve' THEN
    /* ✅ B11 FIX (asli paisa bahar jaane wala rasta): APPROVE ke liye payment
       reference (UPI/UTR/transaction id) DENA LAZMI hai. Pehle bina kisi
       proof ke approve ho jaata tha — "paisa bheja ya nahi" ka koi server-
       side record hi nahi bachta tha. 6 se chhota text = mana. */
    IF length(v_ref) < 6 THEN
      RETURN jsonb_build_object('success', false, 'error', 'payout_ref_required',
                                'message', 'Payout reference (UTR / UPI transaction id) daalna zaroori hai');
    END IF;

    SELECT sponsored_winnings INTO v_balance FROM users WHERE id = v_txn.user_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance < v_txn.amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient sponsored_winnings remaining — balance may have changed since request was submitted');
    END IF;
    v_after := v_balance - v_txn.amount;
    UPDATE users SET sponsored_winnings = sponsored_winnings - v_txn.amount WHERE id = v_txn.user_id;

    INSERT INTO public.wallet_audit_log(user_id, action, amount, currency, before_balance, after_balance, performed_by, note)
    VALUES (v_txn.user_id, 'sponsored_withdrawal_paid', v_txn.amount, 'sponsored_winnings',
            v_balance, v_after, COALESCE(v_caller, 'service_role'),
            'Payout ref: ' || v_ref || ' | txn: ' || p_txn_id::text
            || ' | ' || COALESCE(NULLIF(v_txn.note, ''), ''));
  END IF;

  UPDATE wallet_transactions SET
    status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    /* approve: purani UPI-info ke saath payout reference hamesha ke liye
       note me jud jaata hai (audit ke liye). reject: reason. */
    note = CASE p_action
             WHEN 'approve' THEN COALESCE(NULLIF(v_txn.note, ''), '') || ' | Payout ref: ' || v_ref
             ELSE COALESCE(p_note, v_txn.note)
           END,
    reviewed_at = now(),
    reviewed_by = COALESCE(v_caller, 'service_role')
  WHERE id = p_txn_id;

  RETURN jsonb_build_object('success', true, 'action', p_action, 'user_id', v_txn.user_id,
                            'amount', v_txn.amount, 'balance_after', (CASE WHEN p_action='approve' THEN v_after ELSE v_balance END));
END;
$function$
;
