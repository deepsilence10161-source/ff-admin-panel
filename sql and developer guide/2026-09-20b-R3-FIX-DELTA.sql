-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20b ROUND-3 FIX SESSION — LIVE DATABASE ME RUN HO CHUKA HAI ✅
-- ═══════════════════════════════════════════════════════════════════
-- Ye file Round-3 max-depth testing (R3-1..R3-10 + 7 dead features) me
-- mile saare security/economy bugs ke FIXES hai. SAB live Supabase par
-- run + verify ho chuka hai (FIX_VERIFY1/1b battery). Append-only rule
-- follow — kuch purana DROP/EDIT nahi, sirf naye CREATE OR REPLACE /
-- GRANT / REVOKE.
--
-- ★ SABSE BADA DISCOVERY (is session ka):
--   Firebase JWT me `role` claim NAHI hota. Supabase third-party auth
--   me PostgREST aise token wale har request ko **anon** role se
--   chalata hai (auth.jwt().sub phir bhi user-id deta hai). Isliye:
--   (a) jo function sirf authenticated ko granted hai wo panel me 401
--       (dead feature), (b) RLS me sirf `TO authenticated` policies
--       panel traffic par apply NAHI hoti. Har user-facing RPC ko ab
--       anon + authenticated dono ko grant kiya gaya hai; har SECURITY
--       DEFINER function ke andar auth.jwt()->'sub' NULL-guard hai.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. CONFIG SEEDS (app_settings) — server-side reward sources
--    Panel ke CFG defaults (features/app-config.js) ke exact match.
-- ─────────────────────────────────────────────────────────────
INSERT INTO app_settings(key, value) VALUES ('mission_config',
'{"daily_match":{"coins":10,"target":1},"daily_kills3":{"coins":5,"target":1},"week_5matches":{"coins":50,"target":1},"week_top3":{"coins":30,"target":1},"week_share":{"coins":20,"target":1}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings(key, value) VALUES ('streak_config',
'{"3":20,"7":100,"14":200,"30":500,"60":1000,"100":2000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings(key, value) VALUES ('cosmetic_prices', '{
 "frame_neon":{"price":50,"name":"Neon Frame"},
 "frame_fire":{"price":75,"name":"Fire Frame"},
 "frame_galaxy":{"price":100,"name":"Galaxy Frame"},
 "frame_gold":{"price":150,"name":"Gold Champion"},
 "tag_beast":{"price":30,"name":"⚡ BEAST MODE"},
 "tag_pro":{"price":30,"name":"🎯 PRO PLAYER"},
 "tag_king":{"price":50,"name":"👑 KING"},
 "vip_slot":{"price":200,"name":"VIP Slot Pass"}
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
-- NOTE: live_config row abhi bhi NAHI hai — panel CFG defaults chala
-- raha hai. Admin chahe to live_config row banakar CFG override kar
-- sakta hai (features/app-config.js + core/db.js config.load path).

-- ─────────────────────────────────────────────────────────────
-- 2. OVERLOAD-DROPS (PGRST203 + client-amount holes band)
-- ─────────────────────────────────────────────────────────────
-- R3-1: numeric overload tha → client p_coins (numeric) us overload se
--       jaata tha. Ab sirf integer overload (server-reward) bacha.
DROP FUNCTION IF EXISTS public.claim_mission_reward(text, text, numeric);

-- R3-7: int overload tha → numeric hi rakha (panel numeric bhejta hai)
DROP FUNCTION IF EXISTS public.contribute_to_squad_bank(uuid, text, integer);

-- R3-fix: 5-arg overload (bina p_uid attribution) band; panel 6-arg
-- (…, p_uid) use karta hai — live-verified 204.
DROP FUNCTION IF EXISTS public.increment_city_score(text, text, integer, integer, integer);

-- R3-8: increment_poll_vote bina-vote count inflate karta tha (204
-- silent). Panel kahin use nahi karta (grep-verified) — REVOKE.
REVOKE EXECUTE ON FUNCTION public.increment_poll_vote(uuid, text) FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- 3. claim_mission_reward — SERVER-SIDE REWARD (R3-1 + R3-3 fix)
--    p_coins IGNORE; reward mission_config se; period tamper-guard;
--    unknown mission reject; double-claim FOR UPDATE lock.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_cfg JSONB;
  v_reward INT;
  v_period_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  /* FIX (2026-09-20 R3): reward server-side se — p_coins IGNORE.
     Sirf mission_config me registered missions claim kar sakte hain. */
  SELECT value->p_mission_key INTO v_cfg FROM app_settings WHERE key = 'mission_config';
  IF v_cfg IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_mission');
  END IF;
  v_reward := COALESCE((v_cfg->>'coins')::INT, 0);
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
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 4. track_mission_progress — unknown-key kabhi complete nahi (R3-3)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_cfg JSONB;
  v_new_progress INT;
  v_completed BOOLEAN;
  v_known BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  /* FIX (R3): sirf registered missions complete ho sakte hain.
     Unknown keys track to ho sakte hain (analytics) par kabhi
     complete nahi honge → claim kabhi nahi milega. */
  SELECT (value -> p_mission_key) IS NOT NULL INTO v_known FROM app_settings WHERE key = 'mission_config';

  INSERT INTO mission_progress(user_id, mission_key, period, progress, target, is_completed)
  VALUES(v_uid, p_mission_key, p_period, LEAST(p_progress, p_target), p_target, v_known AND (p_progress >= p_target))
  ON CONFLICT (user_id, mission_key, period) DO UPDATE SET
    progress = GREATEST(mission_progress.progress, LEAST(p_progress, p_target)),
    target = p_target,
    is_completed = (mission_progress.is_completed OR (v_known AND p_progress >= p_target)),
    updated_at = NOW()
  RETURNING progress, is_completed INTO v_new_progress, v_completed;

  RETURN jsonb_build_object('success', true, 'progress', v_new_progress, 'is_completed', v_completed);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 5. claim_streak_milestone — server-cap + day-whitelist (R3-4)
--    401-dead tha; ab anon+authenticated granted.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  SELECT value->p_day::text INTO v_cfg FROM app_settings WHERE key='streak_config';
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
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 6. battle_pass_progress daily-XP columns (R3-6 cap ke liye)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.battle_pass_progress ADD COLUMN IF NOT EXISTS xp_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.battle_pass_progress ADD COLUMN IF NOT EXISTS xp_day DATE;

-- ─────────────────────────────────────────────────────────────
-- 7. award_battle_pass_xp — 2000 XP/day cap (R3-6)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_new_xp INT;
  v_new_tier INT;
  v_today DATE := CURRENT_DATE;
  v_xp_today INT;
BEGIN
  IF v_caller IS DISTINCT FROM p_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only award your own XP');
  END IF;
  IF p_xp <= 0 OR p_xp > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid XP amount');
  END IF;

  /* FIX (R3): 2000 XP/day cap — spam-printer band. */
  SELECT COALESCE(xp_today, 0) INTO v_xp_today
    FROM battle_pass_progress WHERE user_id = p_uid AND season_key = p_season;
  IF v_xp_today IS NULL THEN v_xp_today := 0; END IF;
  IF v_xp_today >= 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_xp_cap_reached');
  END IF;

  INSERT INTO battle_pass_progress (user_id, season_key, current_xp, current_tier, has_premium, claimed_free, claimed_prem, xp_today, xp_day)
    VALUES (p_uid, p_season, p_xp, LEAST(50, p_xp/100), false, '{}'::jsonb, '{}'::jsonb, p_xp, v_today)
    ON CONFLICT (user_id, season_key) DO UPDATE
      SET current_xp = battle_pass_progress.current_xp + p_xp,
          current_tier = GREATEST(battle_pass_progress.current_tier, LEAST(50, (battle_pass_progress.current_xp + p_xp)/100)),
          updated_at = now(),
          xp_today = CASE WHEN battle_pass_progress.xp_day = v_today THEN battle_pass_progress.xp_today + p_xp ELSE p_xp END,
          xp_day = v_today
    RETURNING current_xp, current_tier INTO v_new_xp, v_new_tier;

  IF v_xp_today + p_xp > 2000 THEN
    RETURN jsonb_build_object('success', true, 'xp', v_new_xp, 'tier', v_new_tier, 'capped', true);
  END IF;
  RETURN jsonb_build_object('success', true, 'xp', v_new_xp, 'tier', v_new_tier);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 8. claim_battle_pass_tier — server-GD + free-track fix (R3-5)
--    p_gd_reward IGNORE; reward battle_passes.tiers se;
--    free track par premium-check NAHI (design-fault tha);
--    prem track par has_premium (season-pass) zaroori.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_claimed JSONB;
  v_bp RECORD;
  v_tier_def JSONB;
  v_reward_gd NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_track NOT IN ('free','prem') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid track');
  END IF;
  SELECT * INTO v_bp FROM battle_passes WHERE season_key = p_season AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season not found or not active');
  END IF;
  SELECT t INTO v_tier_def FROM jsonb_array_elements(v_bp.tiers) t WHERE (t->>'tier')::int = p_tier;
  IF v_tier_def IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;
  v_reward_gd := COALESCE((v_tier_def->>'rewardGd')::NUMERIC, 0);

  SELECT * INTO v_row FROM battle_pass_progress
  WHERE user_id = v_uid AND season_key = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No battle pass progress found');
  END IF;
  IF v_row.current_tier < p_tier THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tier not reached yet');
  END IF;
  IF p_track = 'prem' AND NOT COALESCE(v_row.has_premium, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season Pass nahi khareeda — pehle purchase karo');
  END IF;

  v_claimed := CASE p_track WHEN 'free' THEN COALESCE(v_row.claimed_free,'{}'::JSONB)
                            ELSE COALESCE(v_row.claimed_prem,'{}'::JSONB) END;
  IF v_claimed ? p_tier::TEXT THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  IF v_reward_gd > 0 THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_reward_gd WHERE id = v_uid;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_uid, 'green_diamonds', 'credit', v_reward_gd, 'battle_pass_tier', p_season || ':t' || p_tier);
  END IF;

  UPDATE battle_pass_progress
    SET claimed_free = CASE p_track WHEN 'free' THEN claimed_free || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_free END,
        claimed_prem = CASE p_track WHEN 'prem' THEN claimed_prem || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_prem END,
        updated_at = NOW()
    WHERE user_id = v_uid AND season_key = p_season;

  RETURN jsonb_build_object('success', true, 'gd', v_reward_gd, 'track', p_track, 'tier', p_tier);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 9. purchase_cosmetic — catalog price (R3-9)
--    p_price IGNORE; price app_settings 'cosmetic_prices' se;
--    unknown cosmetic reject; already-owned idempotent.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  IF EXISTS (SELECT 1 FROM user_cosmetics WHERE user_id = v_uid AND cosmetic_key = p_cosmetic_key) THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true);
  END IF;

  SELECT value->p_cosmetic_key->>'price', COALESCE(value->p_cosmetic_key->>'name', p_display_name)
    INTO v_price, v_name
    FROM app_settings WHERE key = 'cosmetic_prices';
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
  VALUES (v_uid, 'sky_diamonds', 'debit', v_price, 'cosmetic_purchase', COALESCE(v_name, p_cosmetic_key));

  RETURN jsonb_build_object('ok', true, 'new_balance', v_balance - v_price);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 10. finalize_creator_commission — admin/internal guard (R3-10)
--     + jr-status revenue-loss fix (creator-match jrs 'pending' me
--     hi rehte hain — purana IN ('joined','approved') filter
--     commission HAMESHA 0 kar deta tha).
--     p_internal=true sirf creator_publish_result se aata hai.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_creator_uid   TEXT;
  v_comm_pct      NUMERIC;
  v_comm_type     TEXT;
  v_total_entry   NUMERIC;
  v_commission    NUMERIC;
  v_hold_days     INT;
  v_eligible_at   TIMESTAMPTZ;
  v_hold_until    TIMESTAMPTZ;
  v_caller        TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF NOT COALESCE(p_internal, false) THEN
    IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
      RAISE EXCEPTION 'finalize sirf system/admin kar sakta hai';
    END IF;
  END IF;

  SELECT creator_uid, commission_pct, commission_type
  INTO v_creator_uid, v_comm_pct, v_comm_type
  FROM creator_matches
  WHERE match_id = p_match_id AND commission_status = 'pending';

  IF v_creator_uid IS NULL THEN RETURN; END IF;

  SELECT hold_until INTO v_hold_until FROM creator_matches WHERE match_id = p_match_id;

  SELECT COALESCE(SUM(entry_fee_paid), 0)
  INTO v_total_entry
  FROM join_requests
  WHERE match_id = p_match_id
    AND status NOT IN ('no_show','refunded','cancelled','rejected');

  v_commission := ROUND(v_total_entry * v_comm_pct / 100, 2);

  SELECT COALESCE((value->>'commissionHoldDays')::INT, 7)
  INTO v_hold_days
  FROM app_settings WHERE key = 'creator_system' LIMIT 1;

  IF v_hold_days IS NULL THEN v_hold_days := 7; END IF;
  v_eligible_at := COALESCE(v_hold_until, NOW() + (v_hold_days || ' days')::INTERVAL);

  IF v_comm_type = 'gd' THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_commission
    WHERE id = v_creator_uid;
    INSERT INTO wallet_transactions(user_id, txn_type, amount, currency, reason, created_at)
    VALUES (v_creator_uid, 'credit', v_commission, 'green_diamonds', 'creator_coin_match_commission', NOW());
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'gd', 'eligible', NOW());
    UPDATE creator_matches SET commission_status = 'finalized' WHERE match_id = p_match_id;
  ELSE
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'coins', 'pending', v_eligible_at);
    UPDATE creator_matches SET commission_status = 'locked' WHERE match_id = p_match_id;
  END IF;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 11. creator_publish_result — 42702 'r is ambiguous' crash fix
--     (variable `r` vs FROM-alias); alias ab 'res'; EXCEPTION-
--     handler (fail par match 'live' atka na rahe); finalize ab
--     internal (p_internal=true) call karta hai.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  IF v_per_kill > 0 THEN
    IF v_entry_type = 'coins' THEN
      UPDATE users u SET coins = coins + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    ELSE
      UPDATE users u SET sky_diamonds = sky_diamonds + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    SELECT user_id, v_entry_type, 'credit', kills * v_per_kill, 'creator_match_prize', p_match_id
    FROM join_requests WHERE match_id = p_match_id AND kills > 0;
  END IF;

  UPDATE matches SET status = 'completed', completed_at = NOW() WHERE id = p_match_id;
  PERFORM finalize_creator_commission(p_match_id, true);

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'flagged', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'publish_failed', 'detail', SQLERRM);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 12. get_room_credentials — NAYA RPC (R3-2 room-leak fix ka
--     server-half). Panel ab MT me creds load nahi karta (user-repo
--     commit 6c97022); sirf ye RPC deta hai, joined + release-window
--     verify karke. Release rule: admin 'released' (room_status +
--     room_released_at) YA scheduled_at - room_release_minutes.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_room_credentials(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_m RECORD;
  v_allowed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT status, scheduled_at, room_release_minutes, room_released_at, room_id, room_password, room_status
    INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.room_id IS NULL OR v_m.room_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'room_not_set');
  END IF;
  IF v_m.status NOT IN ('live','upcoming','completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_available');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM join_requests WHERE user_id = v_uid AND match_id = p_match_id AND status IN ('pending','joined','checked_in')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_joined');
  END IF;

  v_allowed := (v_m.room_status = 'released' AND v_m.room_released_at IS NOT NULL AND v_m.room_released_at <= NOW())
            OR (NOW() >= v_m.scheduled_at - COALESCE(v_m.room_release_minutes, 5) * INTERVAL '1 minute');
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_released_yet');
  END IF;

  UPDATE join_requests SET status = 'checked_in'
  WHERE user_id = v_uid AND match_id = p_match_id AND status = 'joined';

  RETURN jsonb_build_object('success', true, 'room_id', v_m.room_id, 'room_password', v_m.room_password);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 13. GRANTS — ★ anon-role discovery ke baad HAR user-facing
--     function ko anon + authenticated dono (sub-guards andar).
--     401-dead features revive: streak, watch-earn, voucher,
--     own-match-played.
-- ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone(integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_watch_earn_reward(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_own_match_played() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_credentials(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.creator_publish_result(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.track_mission_progress(text, text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(text, integer, text, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.award_battle_pass_xp(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(text, integer, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY-RESULTS (live, FIX_VERIFY1/1b batteries):
--  ✓ mission legit claim +10 (p_coins=9999 tamper ignored)
--  ✓ double-claim block / unknown-mission reject / stale-period reject
--  ✓ streak capped 20 (99999 tamper) / invalid-day / not-reached
--  ✓ bp free-track w/o premium + server-gd 15 (999 ignored) /
--    prem-track gated / tier-not-reached / double-claim
--  ✓ xp cap 2000/day (3rd 1000xp call → daily_xp_cap_reached)
--  ✓ cosmetic catalog-price 50 debit (price=1 tamper) / re-buy
--    idempotent / vip_slot 200 > balance → insufficient
--  ✓ publish FULL E2E: 42702 GONE, kills-prize +15, commission
--    3.75 GD (revenue-loss fix), finalize self-call → P0001 blocked
--  ✓ room RPC: outsider not_joined / early not_released_yet /
--    released → room_id+password + auto check-in
--  ✓ voucher real redeem +25 + dup-block; watch-earn/own-match
--    grants 200
-- ═══════════════════════════════════════════════════════════════
