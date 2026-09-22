-- ================================================================
-- 2026-09-23c — R3 Production-Hardening — Phase 5 Config SSOT
-- Authoritative config source = app_settings.live_config (admin panel
-- "App Settings" editor). Sibling legacy keys (mission_config,
-- streak_config, cosmetic_prices, squad_bank_items) ABA SE BHI
-- FALLBACK ke roop mein rakhe gaye hain — koi key delete nahi hoti,
-- koi live price/reward value NAHIN badli jaati. Sirf read-priority
-- badli hai taaki admin panel ne jo value dikhaayi/save ki ho, server
-- WAHEE enforce kare (silent divergence khatam).
--
-- Value-parity PROVEN live before this migration:
--   live_config.cosmetics        == cosmetic_prices (8 items, same ₹)
--   live_config.streakMilestones == streak_config  (20/100/200/500/1000/2000)
--   live_config.missions         == mission_config (10/5/50/30/…)
-- Isliye kisi user-visible reward/price par ZERO effect.
-- (data: audit of app_settings rows on 2026-09-23)
-- ================================================================

-- ── 1. purchase_cosmetic: price authority = live_config.cosmetics ──
--       (admin panel cosmetics editor yahi save karta hai). cosmetic_prices
--       legacy/seed catalog ke roop mein fallback.
CREATE OR REPLACE FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_balance NUMERIC;
  v_price NUMERIC;
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_cosmetic_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  -- Already owned? Idempotent.
  IF EXISTS (SELECT 1 FROM user_cosmetics WHERE user_id = v_uid AND cosmetic_key = p_cosmetic_key) THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true);
  END IF;

  /* FIX (2026-09-23c SSOT): price authority = live_config.cosmetics
     (admin panel App Settings editor). cosmetic_prices sirf legacy
     fallback — client p_price ignore (pehle se). */
  SELECT value -> 'cosmetics' -> p_cosmetic_key ->> 'price',
         value -> 'cosmetics' -> p_cosmetic_key ->> 'name'
    INTO v_price, v_name
    FROM app_settings WHERE key = 'live_config';

  IF v_price IS NULL THEN
    SELECT value -> p_cosmetic_key ->> 'price',
           COALESCE(value -> p_cosmetic_key ->> 'name', p_display_name)
      INTO v_price, v_name
      FROM app_settings WHERE key = 'cosmetic_prices';
  END IF;
  v_name := COALESCE(v_name, p_display_name);

  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_cosmetic');
  END IF;

  SELECT sky_diamonds INTO v_balance FROM users WHERE id = v_uid FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance');
  END IF;

  UPDATE users SET sky_diamonds = sky_diamonds - v_price WHERE id = v_uid;
  INSERT INTO user_cosmetics(user_id, cosmetic_key, purchased_at) VALUES (v_uid, p_cosmetic_key, NOW());
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'sky_diamonds', 'debit', v_price, 'cosmetic_purchase', v_name);

  RETURN jsonb_build_object('ok', true, 'new_balance', v_balance - v_price);
END;
$function$;

-- ── 2. claim_streak_milestone: reward authority = live_config.streakMilestones ──
CREATE OR REPLACE FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_streak INTEGER;
  v_claimed JSONB;
  v_key TEXT := 'day_' || p_day::text;
  v_new_balance NUMERIC;
  v_cfg JSONB;
  v_reward NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_day NOT IN (3,7,14,30,60,100) OR p_coins IS NULL OR p_coins <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  /* FIX (2026-09-23c SSOT): reward authority = live_config.streakMilestones
     (admin panel editor). streak_config legacy fallback. LEAST(p_coins, …)
     cap pehle se — client amount kabhi exceed nahi kar sakta. */
  SELECT value -> 'streakMilestones' -> p_day::text ->> 'coins' INTO v_cfg
    FROM app_settings WHERE key = 'live_config';
  IF v_cfg IS NULL THEN
    SELECT value -> p_day::text INTO v_cfg FROM app_settings WHERE key = 'streak_config';
  END IF;
  v_reward := LEAST(p_coins::NUMERIC, COALESCE((v_cfg)::NUMERIC, 50));
  IF v_reward <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  SELECT streak_days, streak_milestones_claimed
    INTO v_streak, v_claimed
    FROM users WHERE id = v_uid FOR UPDATE;

  IF v_streak IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;
  IF v_streak < p_day THEN
    RETURN jsonb_build_object('ok', false, 'error', 'streak_not_reached');
  END IF;
  IF v_claimed ? v_key THEN
    RETURN jsonb_build_object('ok', true, 'already_claimed', true);
  END IF;

  UPDATE users
     SET streak_milestones_claimed = streak_milestones_claimed || jsonb_build_object(v_key, true),
         coins = coins + v_reward
   WHERE id = v_uid
   RETURNING coins INTO v_new_balance;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES (v_uid, 'coins', 'credit', v_reward, 'streak_milestone', v_key);

  RETURN jsonb_build_object('ok', true, 'coins', v_reward, 'new_balance', v_new_balance);
END;
$function$;

-- ── 3. claim_mission_reward: reward authority = live_config.missions ──
CREATE OR REPLACE FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_cfg JSONB;
  v_reward INT := 0;
  v_txt TEXT;
  v_period_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  /* FIX (2026-09-23c SSOT): mission reward authority = live_config.missions
     (admin panel editor, flat {key: coins}). mission_config (legacy,
     {key:{coins,target}} shape) sirf fallback. p_coins IGNORE (pehle se). */
  SELECT value -> 'missions' ->> p_mission_key INTO v_txt
    FROM app_settings WHERE key = 'live_config';
  IF v_txt IS NOT NULL AND v_txt ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_reward := (v_txt::NUMERIC)::INT;
  END IF;

  IF v_reward <= 0 THEN
    SELECT value -> p_mission_key INTO v_cfg FROM app_settings WHERE key = 'mission_config';
    IF v_cfg IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'unknown_mission');
    END IF;
    v_reward := COALESCE((v_cfg->>'coins')::INT, 0);
  END IF;
  IF v_reward <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'mission_reward_not_configured');
  END IF;

  /* Period tamper-guard: daily keys aaj hi ki date par, weekly keys
     current week par hi claim ho sakte hain (panel ke getWeekNum
     formula ke mutabik: ceil((doy + jan1_dow + 1) / 7)). */
  IF p_mission_key LIKE 'daily_%' THEN
    v_period_ok := (p_period = CURRENT_DATE::text);
  ELSIF p_mission_key LIKE 'week_%' THEN
    v_period_ok := (p_period = 'w' || CEIL((EXTRACT(DOY FROM NOW())
                     + EXTRACT(DOW FROM (date_trunc('year', NOW())))::INT + 1)::NUMERIC / 7)::INT);
  ELSE
    v_period_ok := TRUE;
  END IF;
  IF NOT v_period_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'stale_period');
  END IF;

  SELECT * INTO v_row FROM mission_progress
  WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mission not found');
  END IF;
  IF NOT v_row.is_completed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mission abhi complete nahi hui');
  END IF;
  IF v_row.reward_claimed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  UPDATE mission_progress SET reward_claimed = true, updated_at = NOW()
  WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period;

  UPDATE users SET coins = COALESCE(coins, 0) + v_reward WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(v_uid, 'coins', 'credit', v_reward, 'mission_reward', p_mission_key || ':' || p_period);

  RETURN jsonb_build_object('success', true, 'coins', v_reward);
END;
$function$;

-- ── 4. creator_publish_result: wallet_transactions.currency canonical ──
--       matches.entry_type ('sky_diamond') → ledger 'sky_diamonds' (plural).
--       Amount logic UNCHANGED.
CREATE OR REPLACE FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
  v_status TEXT;
  v_max_slots INT;
  v_per_kill NUMERIC;
  v_entry_type TEXT;
  v_total_kills INT;
  v_winner_uid TEXT;
  v_recent_wins INT;
  v_total_payout NUMERIC := 0;
  v_flag_reason TEXT;
  v_ledger_currency TEXT;
  v_max_payout_cap CONSTANT NUMERIC := 500;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT creator_uid, status, max_slots, per_kill_prize, entry_type
    INTO v_owner, v_status, v_max_slots, v_per_kill, v_entry_type
    FROM matches WHERE id = p_match_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_found'); END IF;
  IF v_owner <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_your_match'); END IF;
  IF v_status <> 'live' THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_live'); END IF;

  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;

  /* FIX (R3): 'r' variable vs alias ambiguity — alias ab 'res'.
     Exception-handler bhi: fail par match 'live' atka na rahe. */
  UPDATE join_requests jr
  SET kills = COALESCE((res->>'kills')::INT, 0),
      placement = COALESCE((res->>'placement')::INT, 0)
  FROM jsonb_array_elements(p_results) res
  WHERE jr.id = (res->>'join_request_id')::UUID AND jr.match_id = p_match_id;

  SELECT COALESCE(SUM(kills),0) INTO v_total_kills FROM join_requests WHERE match_id = p_match_id;
  IF v_total_kills > GREATEST(v_max_slots - 1, 1) * 1.5 THEN
    v_flag_reason := 'impossible_kill_count';
  END IF;

  IF v_flag_reason IS NULL THEN
    SELECT user_id INTO v_winner_uid FROM join_requests WHERE match_id = p_match_id AND placement = 1 LIMIT 1;
    IF v_winner_uid IS NOT NULL THEN
      SELECT COUNT(*) INTO v_recent_wins
      FROM creator_matches cm
      JOIN join_requests jr2 ON jr2.match_id = cm.match_id
      WHERE cm.creator_uid = v_uid AND jr2.user_id = v_winner_uid AND jr2.placement = 1
        AND cm.created_at > NOW() - INTERVAL '7 days';
      IF v_recent_wins >= 3 THEN
        v_flag_reason := 'repeat_winner_pattern';
      END IF;
    END IF;
  END IF;

  v_total_payout := v_total_kills * COALESCE(v_per_kill, 0);
  IF v_total_payout > v_max_payout_cap THEN
    v_flag_reason := COALESCE(v_flag_reason, 'payout_cap_exceeded');
  END IF;

  IF v_flag_reason IS NOT NULL THEN
    UPDATE matches SET status = 'pending_review', completed_at = NOW() WHERE id = p_match_id;
    INSERT INTO creator_result_flags(match_id, creator_uid, reason, details)
    VALUES (p_match_id, v_uid, v_flag_reason, jsonb_build_object('total_kills', v_total_kills, 'total_payout', v_total_payout, 'winner_uid', v_winner_uid));
    RETURN jsonb_build_object('success', true, 'status', 'pending_review', 'flagged', true);
  END IF;

  /* SSOT (2026-09-23c): canonical ledger currency — 'sky_diamond' →
     'sky_diamonds' (plural), system-wide canonical. Amount UNCHANGED. */
  v_ledger_currency := CASE WHEN v_entry_type = 'sky_diamond' THEN 'sky_diamonds' ELSE v_entry_type END;

  IF v_per_kill > 0 THEN
    IF v_entry_type = 'coins' THEN
      UPDATE users u SET coins = coins + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    ELSE
      UPDATE users u SET sky_diamonds = sky_diamonds + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    SELECT user_id, v_ledger_currency, 'credit', kills * v_per_kill, 'creator_match_prize', p_match_id
    FROM join_requests WHERE match_id = p_match_id AND kills > 0;
  END IF;

  UPDATE matches SET status = 'completed', completed_at = NOW() WHERE id = p_match_id;
  PERFORM finalize_creator_commission(p_match_id, true);

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'flagged', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'publish_failed', 'detail', SQLERRM);
END;
$function$;

-- ── 5. admin_confirm_creator_cheat: wallet_transactions.currency canonical ──
CREATE OR REPLACE FUNCTION public.admin_confirm_creator_cheat(p_flag_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_match_id TEXT;
  v_owner TEXT;
  v_new_strikes INT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id = v_caller AND is_admin = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;

  SELECT match_id, creator_uid INTO v_match_id, v_owner FROM creator_result_flags WHERE id = p_flag_id AND status = 'open';
  IF v_match_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'flag_not_found_or_resolved'); END IF;

  UPDATE users u SET sky_diamonds = sky_diamonds + jr.entry_fee_paid
  FROM join_requests jr, matches m
  WHERE jr.match_id = v_match_id AND jr.user_id = u.id AND m.id = v_match_id AND m.entry_type = 'sky_diamond' AND jr.entry_fee_paid > 0;
  UPDATE users u SET coins = coins + jr.entry_fee_paid
  FROM join_requests jr, matches m
  WHERE jr.match_id = v_match_id AND jr.user_id = u.id AND m.id = v_match_id AND m.entry_type = 'coins' AND jr.entry_fee_paid > 0;

  /* SSOT (2026-09-23c): canonical ledger currency (plural). Amount UNCHANGED. */
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  SELECT jr.user_id, CASE WHEN m.entry_type = 'sky_diamond' THEN 'sky_diamonds' ELSE m.entry_type END, 'credit', jr.entry_fee_paid, 'creator_match_voided_refund', v_match_id
  FROM join_requests jr JOIN matches m ON m.id = jr.match_id WHERE jr.match_id = v_match_id AND jr.entry_fee_paid > 0;

  UPDATE matches SET status = 'cancelled' WHERE id = v_match_id;
  UPDATE creator_matches SET commission_status = 'voided' WHERE match_id = v_match_id;

  UPDATE users SET creator_strikes = creator_strikes + 1 WHERE id = v_owner RETURNING creator_strikes INTO v_new_strikes;

  IF v_new_strikes >= 6 THEN
    UPDATE users SET creator_suspended_permanently = true, is_creator = false WHERE id = v_owner;
  ELSIF v_new_strikes >= 3 THEN
    UPDATE users SET creator_suspended_until = NOW() + INTERVAL '30 days' WHERE id = v_owner;
    -- FIX: correct column names (premium_level/premium_expires, not
    -- premium_tier/premium_expires_at which don't exist on this table).
    UPDATE users SET premium_level = 0, premium_expires = NULL WHERE id = v_owner;
  END IF;

  UPDATE creator_result_flags SET status = 'confirmed_cheat', resolved_at = NOW(), resolved_by = v_caller WHERE id = p_flag_id;

  INSERT INTO notifications(user_id, type, title, body)
  VALUES (v_owner, 'creator_strike', '⚠️ Match Voided — Cheating Confirmed',
    'Tumhara match "' || v_match_id || '" cheating ke wajah se void kar diya gaya. Strikes: ' || v_new_strikes || '/6.' ||
    CASE WHEN v_new_strikes >= 6 THEN ' Creator Program se permanently ban kar diya gaya.'
         WHEN v_new_strikes >= 3 THEN ' 30 din ke liye hosting suspend kar di gayi hai, aur Premium bhi cancel kar diya gaya hai.'
         ELSE '' END);

  RETURN jsonb_build_object('success', true, 'strikes', v_new_strikes);
END;
$function$;
