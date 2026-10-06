/* ================================================================
   B20 (2026-10-07) — Referral rules ko sach me LIVE karna.

   Jaanch me teen asli khamiyan mili (admin panel ki settings aur DB
   ke vyavhaar me farq):

   1) "👥 Dost join kare → Coins"  (referralJoinCoins, hint: "Dono ko
      milenge") — apply_referral_code sirf REFERRER ko coins deta tha,
      dost (referred user) ko kuch nahi. Profile wale manual-code path
      (claim_referral_reward) dono ko deta tha — isliye ek hi code ka
      nateeja do jagah alag tha. Ab dono RPC ek jaise: DONO ko bonus.

   2) "💎 Dost SD kharido → Sky Diamond Bonus" (referralSDBonusDiamonds)
      — yeh setting admin panel me saloon se thi, par DB me KAHIN bhi
      lagu nahi thi (koi function/trigger ise padhta hi nahi tha).
      Ab resolve_sd_request me: dost ki PEHLI approved Sky Diamond
      purchase par referrer ko SD bonus (aur referral row par
      sd_bonus_paid flag — dobara kabhi nahi).

   3) "🎮 Dost 5 matches khele → Coins" (referralMatchCoins) — yeh
      bhi kahin lagu nahi thi, aur referrals.match_bonus_paid column
      bina kisi istemaal ke pada tha. Ab users.total_matches badhne
      par (increment_own_match_played aur publish_match_results — dono
      paths) trigger bonus deta hai, aur threshold bhi admin setting
      ban gaya: referralMatchThreshold (default 5).

   Double-credit guard: har bonus apne referral row par ek atomic
   claim (UPDATE ... WHERE COALESCE(flag,false) = false RETURNING)
   se milta hai — doosri baar kabhi nahi. Reversal ke liye admin ke
   paas admin_revoke_referral_bonus (ledger-based) pehle se hai.
   ================================================================ */

/* ─── 1. referrals: SD bonus ka claim-flag ─────────────────────── */
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS sd_bonus_paid boolean NOT NULL DEFAULT false;

/* ─── 2. live_config: match threshold bhi ab setting ───────────── */
UPDATE public.app_settings
   SET value = value || '{"referralMatchThreshold":5}'::jsonb
 WHERE key = 'live_config'
   AND value->>'referralMatchThreshold' IS NULL;

/* ─── 3. apply_referral_code: join bonus ab DONO ko ───────────── */
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_reward numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_referrer_uid TEXT;
  v_referrer_ign TEXT;
  v_existing UUID;
  v_matches INT;
  v_cfg JSONB;
  v_real_reward NUMERIC;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  /* ✅ SECURITY FIX (2026-09-08): "server-authoritative wallet RPC"
     audit — p_reward was a client-supplied parameter, sanity-bounded
     only to <= 500. A user could call this RPC directly with
     p_reward=500 and get 10x the real configured referral bonus
     (referralJoinCoins, normally ~50). The reward amount is now
     always read from server-side config here — the p_reward argument
     is kept (so the existing call site in referral-system-fix.js
     doesn't need to change its call signature) but is IGNORED; only
     the server's own config value is ever actually credited. */
  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_real_reward := COALESCE((v_cfg->>'referralJoinCoins')::NUMERIC, 50);

  SELECT id, ign INTO v_referrer_uid, v_referrer_ign FROM users WHERE referral_code = p_code LIMIT 1;
  IF v_referrer_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;
  IF v_referrer_uid = v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apna khud ka code use nahi kar sakte');
  END IF;

  SELECT total_matches INTO v_matches FROM users WHERE id = v_caller;
  IF COALESCE(v_matches, 0) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral code sirf pehle match se pehle apply ho sakta hai!');
  END IF;

  -- referrals.referred_id has a UNIQUE constraint — a user can only ever
  -- be referred once, this doubles as the duplicate-application guard.
  SELECT id INTO v_existing FROM referrals WHERE referred_id = v_caller FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aap already ek referral code use kar chuke ho!');
  END IF;

  -- Also guard against a user who already has referred_by set (e.g. from
  -- signup flow) applying a code again through this path.
  IF EXISTS(SELECT 1 FROM users WHERE id = v_caller AND referred_by IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aap already kisi ka referral use kar chuke ho');
  END IF;

  INSERT INTO referrals (referrer_id, referred_id, referrer_ign, join_bonus_paid)
    VALUES (v_referrer_uid, v_caller, v_referrer_ign, true);
  UPDATE users SET referred_by = v_referrer_uid, referral_popup_done = true WHERE id = v_caller;

  /* ✳️ B20 (2026-10-07): pehle yahan sirf REFERRER ko coins milte the,
     jabki admin panel ka hint kehta hai "Dono ko milenge" (aur profile
     wala claim_referral_reward path dono ko deta tha). Ab dono paths
     ek jaise: dono ko bonus + dono ka wallet_transactions entry. */
  UPDATE users SET coins = COALESCE(coins,0) + v_real_reward WHERE id = v_referrer_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_referrer_uid, 'coins', 'credit', v_real_reward, 'referral_bonus', v_caller);

  UPDATE users SET coins = COALESCE(coins,0) + v_real_reward WHERE id = v_caller;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_caller, 'coins', 'credit', v_real_reward, 'referral_join_bonus', v_referrer_uid);

  RETURN jsonb_build_object('success', true, 'referrer_uid', v_referrer_uid,
                            'referrer_ign', v_referrer_ign,
                            'reward', v_real_reward,
                            'reward_self', v_real_reward);
END;
$function$;

/* ─── 4. resolve_sd_request: pehli SD purchase par referrer bonus ── */
CREATE OR REPLACE FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller  TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_req     RECORD;
  /* ✳️ B20 (2026-10-07): SD referral bonus ke variables */
  v_is_first_sd   BOOLEAN := false;
  v_ref_uid       TEXT;
  v_sd_bonus      NUMERIC;
  v_ref_row       TEXT;
  v_cfg           JSONB;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid action');
  END IF;

  SELECT * INTO v_req FROM sd_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request not found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request already resolved (status: ' || v_req.status || ')');
  END IF;

  IF v_req.request_type = 'sky_diamond_purchase' THEN
    IF p_action = 'approve' THEN
      /* ✳️ B20: PEHLI SD purchase ki pehchaan — approve hote hi jo
         ledger entry neeche insert hoti hai, usse PEHLE koi
         sd_purchase_approved entry nahi honi chahiye. */
      SELECT NOT EXISTS(
        SELECT 1 FROM wallet_transactions
         WHERE user_id = v_req.user_id AND reason = 'sd_purchase_approved'
      ) INTO v_is_first_sd;

      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds, 0) + v_req.sd_amount WHERE id = v_req.user_id;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES(v_req.user_id, 'sky_diamonds', 'credit', v_req.sd_amount, 'sd_purchase_approved', p_request_id::TEXT);

      /* ✳️ B20 (2026-10-07): "💎 Dost SD kharido → Sky Diamond Bonus"
         (referralSDBonusDiamonds) — yeh setting pehle DB me kahin lagu
         hi nahi thi. Ab: dost ki PEHLI approved SD purchase par
         referrer ko SD bonus. referrals.sd_bonus_paid atomic claim se
         dobara kabhi nahi milta; referred_by na ho to chup-chaap skip. */
      IF v_is_first_sd THEN
        SELECT referred_by INTO v_ref_uid FROM users WHERE id = v_req.user_id;
        IF v_ref_uid IS NOT NULL AND v_ref_uid <> v_req.user_id THEN
          SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
          v_sd_bonus := COALESCE((v_cfg->>'referralSDBonusDiamonds')::NUMERIC, 10);
          IF v_sd_bonus > 0 THEN
            UPDATE referrals SET sd_bonus_paid = true
             WHERE referred_id = v_req.user_id AND COALESCE(sd_bonus_paid, false) = false
             RETURNING referrer_id INTO v_ref_row;
            IF v_ref_row IS NOT NULL AND v_ref_row <> v_req.user_id THEN
              UPDATE users SET sky_diamonds = COALESCE(sky_diamonds, 0) + v_sd_bonus WHERE id = v_ref_row;
              INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
              VALUES(v_ref_row, 'sky_diamonds', 'credit', v_sd_bonus, 'referral_sd_bonus', p_request_id::TEXT);
              INSERT INTO notifications (user_id, type, title, body, ref_id)
              VALUES(v_ref_row, 'referral', '💎 Referral Sky Diamond Bonus!',
                      'Aapke dost ne pehli Sky Diamond purchase ki! +' || v_sd_bonus || ' 💎 mil gaye!',
                      p_request_id::TEXT);
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_req.request_type = 'green_diamond_withdrawal' THEN
    IF p_action = 'reject' THEN
      UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_req.sd_amount WHERE id = v_req.user_id;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES(v_req.user_id, 'green_diamonds', 'credit', v_req.sd_amount, 'withdrawal_rejected_refund', p_request_id::TEXT);
    END IF;
  END IF;

  UPDATE sd_requests SET
    status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_by = v_caller,
    review_note = p_note
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'request_type', v_req.request_type, 'action', p_action);
END;
$function$;

/* ─── 5. Match-bonus trigger: "Dost N matches khele → Coins" ────── */
CREATE OR REPLACE FUNCTION public.fn_referral_match_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg       JSONB;
  v_threshold INT;
  v_reward    NUMERIC;
  v_ref_uid   TEXT;
  v_claimed   TEXT;
BEGIN
  /* Sirf tab jab total_matches WAKAI badha ho (nahi to chhod do —
     correction/re-publish par double na ho). */
  IF NEW.total_matches IS NULL THEN RETURN NEW; END IF;
  IF OLD.total_matches IS NOT NULL AND NEW.total_matches <= COALESCE(OLD.total_matches, 0) THEN
    RETURN NEW;
  END IF;
  IF NEW.referred_by IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_threshold := COALESCE((v_cfg->>'referralMatchThreshold')::INT, 5);
  v_reward    := COALESCE((v_cfg->>'referralMatchCoins')::NUMERIC, 30);
  /* reward 0 = admin ne feature band kiya (ya 5 se pehle hi milestone nahi) */
  IF v_reward <= 0 OR NEW.total_matches < v_threshold THEN RETURN NEW; END IF;

  /* ✳️ B20 atomic claim — match_bonus_paid (pehle se maujood column,
     ab pehli baar asli istenaal me) ek hi baar true hota hai. */
  UPDATE referrals SET match_bonus_paid = true
   WHERE referred_id = NEW.id AND COALESCE(match_bonus_paid, false) = false
   RETURNING referrer_id INTO v_claimed;

  IF v_claimed IS NULL OR v_claimed = NEW.id THEN
    RETURN NEW;   /* already paid / self-row (kabhi ho hi nahi sakta) — kuch nahi */
  END IF;
  v_ref_uid := COALESCE((SELECT referred_by FROM users WHERE id = NEW.id), v_claimed);

  UPDATE users SET coins = COALESCE(coins, 0) + v_reward WHERE id = v_ref_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(v_ref_uid, 'coins', 'credit', v_reward, 'referral_match_bonus', NEW.id);
  INSERT INTO notifications (user_id, type, title, body, ref_id)
  VALUES(v_ref_uid, 'referral', '🎮 Referral Match Bonus!',
          'Aapke dost ne ' || NEW.total_matches || ' matches khele! +' || v_reward || ' 🪙 mil gaye!',
          NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ref_match_bonus ON public.users;
CREATE TRIGGER trg_ref_match_bonus
  AFTER UPDATE OF total_matches ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_referral_match_bonus();
