-- ═══════════════════════════════════════════════════════════════════════
--  बैच-18 (2026-10-07) — Sponsored system: prize type (B11) + payout suraksha (B11)
-- ───────────────────────────────────────────────────────────────────────
--  KYA THA (user ki bug-list):
--   B11: "Sponsored create me `price type` jodo (default = real money); jo
--         chuna jaye wahi user ko dikhe + RESULT par wahi mile; real money
--         bhejne ka SURAKSHIT system."
--   B12: "Sponsored match info me 'winner gets free entry + small coin
--         rewards' ki jagah admin ka chuna hua dikhe."
--
--  JANCH KA NATIJAA (live `pg_get_functiondef` se, apply se pehle dobara diff):
--   1. `admin_create_sponsored_match` me `p_prize_type` param PEHLE SE tha
--      (default 'cash') — magar admin form use KABHI bhejta hi nahi tha
--      (`p_prize_type:'cash'` hardcoded tha), aur value validate bhi nahi
--      hoti thi. Yani prize type ka poora feature dead tha.
--   2. Form ka "4th–10th (each)" field DB me KAHIN save hi nahi hota tha
--      (na param tha, na RPC me) — admin bharta tha, asar zero. Distribute
--      modal usi `prizes.fourthToTenth` ko padhta hai → wo 7 fields hamesha
--      khaali rehte the.
--   3. `admin_distribute_sponsored_prize` sirf `users.sponsored_winnings`
--      (cash) credit karta tha aur usme:
--        ❌ koi duplicate-guard nahi (double click = DOUBLE paisa),
--        ❌ pool se zyada dene par bhi koi rok nahi,
--        ❌ coin-currency ka koi rasta nahi,
--        ❌ koi audit trail nahi (kitna pehle tha, kitna baad me — kahin nahi).
--   4. `resolve_sponsored_withdrawal` (asli paisa bahar jaata hai) approve
--      par koi payment reference/UTR MAANGTA hi nahi tha — yani "paisa bheja"
--      ka koi server-side proof hi nahi bachta tha.
--
--  AB KYA HOTA HAI (iske saath admin+user panel ke code changes jude hain):
--   • create: prize type validate (sirf 'cash' | 'coin'), `p_fourth_prize`
--     naya param, pool = 1st+2nd+3rd + 7×4th-10th (yani pool hamesha asli
--     obligation ke barabar), prizes jsonb me fourthToTenth bhi.
--   • distribute: CURRENCY ab SERVER tournament row se uthata hai (client
--     param sirf fallback — B26 jaisa hi anti-tamper rasta), duplicate-guard
--     (ek tournament me ek user ko dobara credit nahi), pool-cap (pool se
--     zyada nahi), coin path (`users.coins`), aur `wallet_audit_log` me
--     before/after balance ke saath entry.
--   • withdrawal approve: **payment reference (UTR) dena ab LAZMI hai** —
--     bina reference approve hi nahi hota; reference txn note me + audit log
--     me hamesha ke liye likha jaata hai.
--
--  ⚠️ APPLY SE PEHLE: teeno functions ka live def `pg_get_functiondef` se
--     padho (koi baad ka change chhoot na jaye), backups lo, PHIR apply karo.
--
--  ⚠️ DROP + CREATE kyun (CREATE OR REPLACE kyun nahi): naya param jodne par
--     Postgres purane signature ko CHHOD deta hai → do overload ban jaate
--     hain aur PostgREST `p_...` naam-wale call par "Could not choose the
--     best candidate function" de deta hai. Isliye pehle purana EXACT
--     signature DROP, phir naya CREATE (grants default PUBLIC par wahi
--     rehta hai — live verify kiya gaya tha).
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- 1) CREATE — prize type (cash/coin) + 4th-10th prizes + pool auto-sum
-- ───────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_create_sponsored_match(text, text, text, integer, timestamp with time zone, numeric, numeric, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_create_sponsored_match(
  p_title text,
  p_sponsor_name text,
  p_mode text DEFAULT 'solo'::text,
  p_max_slots integer DEFAULT 48,
  p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_first_prize numeric DEFAULT 0,
  p_second_prize numeric DEFAULT 0,
  p_third_prize numeric DEFAULT 0,
  p_prize_type text DEFAULT 'cash'::text,
  p_description text DEFAULT NULL::text,
  p_map text DEFAULT 'Bermuda'::text,
  p_fourth_prize numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_uid TEXT := auth.jwt() ->> 'sub';
  v_match_id  TEXT;
  v_pool      NUMERIC;
  v_sched     TIMESTAMPTZ;
  v_pt        TEXT;
  v_p4        NUMERIC;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM users WHERE id = v_admin_uid), false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_title');
  END IF;
  IF p_sponsor_name IS NULL OR length(trim(p_sponsor_name)) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_sponsor_name');
  END IF;
  IF p_mode NOT IN ('solo','duo','squad') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_mode');
  END IF;
  IF p_max_slots < 2 OR p_max_slots > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slot_count');
  END IF;
  IF p_first_prize < 0 OR p_second_prize < 0 OR p_third_prize < 0
     OR COALESCE(p_fourth_prize, 0) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_prize');
  END IF;

  /* ✅ B11: prize type sirf do hi — 'cash' (real money, default) ya 'coin'.
     Purane/hand-typed values ('coins', 'inr', 'money', '₹', '🪙') bhi
     normalize ho jaate hain, taaki koi legacy caller toot na jaye; iske
     alawa kuch bhi bheja gaya to saaf error. */
  v_pt := lower(trim(COALESCE(p_prize_type, 'cash')));
  IF v_pt IN ('cash','inr','money','rupees','rupee','real','real_money','₹') THEN
    v_pt := 'cash';
  ELSIF v_pt IN ('coin','coins','🪙') THEN
    v_pt := 'coin';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'invalid_prize_type');
  END IF;

  v_sched := COALESCE(p_scheduled_at, NOW() + INTERVAL '20 minutes');
  IF v_sched < NOW() + INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_too_soon');
  END IF;

  /* ✅ B11 FIX: 4th-10th (per player) ab asli me count hota hai — 7 players
     (4,5,6,7,8,9,10) × per-player amount. Pehle ye field save hi nahi hoti
     thi (admin bharta tha, DB me kuch nahi jaata tha). Pool ab hamesha = 1st
     + 2nd + 3rd + 7×4th-10th → user card ka "Total Pool" aur asli obligation
     kabhi alag nahi ho sakte. */
  v_p4   := COALESCE(p_fourth_prize, 0);
  v_pool := p_first_prize + p_second_prize + p_third_prize + (7 * v_p4);

  -- Sponsored matches are always free entry — sponsor funds the whole
  -- prize pool, exactly like the existing "Koi entry fee nahi, sirf
  -- free tournament!" sponsored cards already say.
  -- (name intentionally NOT listed — it's GENERATED ALWAYS AS (title))
  INSERT INTO matches (
    title, mode, entry_type, entry_fee, max_slots, filled_slots,
    prize_pool, first_prize, second_prize, third_prize, prize_type,
    map, status, scheduled_at, is_sponsored, room_status
  ) VALUES (
    p_title, p_mode, 'free', 0, p_max_slots, 0,
    v_pool, p_first_prize, p_second_prize, p_third_prize, v_pt,
    p_map, 'upcoming', v_sched, true, 'pending'
  ) RETURNING id INTO v_match_id;

  INSERT INTO sponsored_tournaments (
    title, sponsor_name, prize_pool, prize_type, entry_type, status,
    match_id, description,
    prizes
  ) VALUES (
    p_title, p_sponsor_name, v_pool, v_pt, 'free', 'active',
    v_match_id, p_description,
    jsonb_build_object('first', p_first_prize, 'second', p_second_prize,
                       'third', p_third_prize, 'fourthToTenth', v_p4)
  );

  RETURN jsonb_build_object('success', true, 'match_id', v_match_id,
                            'prize_type', v_pt, 'prize_pool', v_pool);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;


-- ───────────────────────────────────────────────────────────────────────
-- 2) DISTRIBUTE — currency server se, duplicate-guard, pool-cap, audit trail
-- ───────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_distribute_sponsored_prize(text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.admin_distribute_sponsored_prize(
  p_uid text,
  p_amount numeric,
  p_tour_id text DEFAULT NULL::text,
  p_rank text DEFAULT NULL::text,
  p_currency text DEFAULT 'cash'::text
)
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

  INSERT INTO public.wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
  VALUES (v_target_uid,
          CASE WHEN v_cur = 'coin' THEN 'coins' ELSE 'sponsored' END,
          'credit', p_amount, v_reason, COALESCE(p_tour_id, NULL), 'approved');

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
$function$;


-- ───────────────────────────────────────────────────────────────────────
-- 3) WITHDRAWAL APPROVE — payment reference (UTR) ab LAZMI + audit trail
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_sponsored_withdrawal(
  p_txn_id uuid,
  p_action text,
  p_note text DEFAULT NULL::text
)
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
$function$;


-- ───────────────────────────────────────────────────────────────────────
-- VERIFY (apply ke baad چلane wali queries — comment me hi record):
--   SELECT proname, pg_get_function_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND proname IN ('admin_create_sponsored_match','admin_distribute_sponsored_prize','resolve_sponsored_withdrawal')
--    ORDER BY 1;                      -- har naam ka SIRF EK overload hona chahiye
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name IN ('wallet_audit_log','sponsored_tournaments') ORDER BY 1;
-- ───────────────────────────────────────────────────────────────────────
