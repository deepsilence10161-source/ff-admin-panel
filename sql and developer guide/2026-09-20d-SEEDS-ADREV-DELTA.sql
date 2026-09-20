-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20d SEEDS + AD-REWARD + BP TRACK-AWARE — LIVE RUN ✅
-- ═══════════════════════════════════════════════════════════════════
-- (A) battle_passes SEED — pehle table KHAALI thi (dead feature).
--     Panel getSeasonId() = 'YYYY_MM' (features/battle-pass.js) → season
--     key '2026_09'. Tiers = panel TIERS_DATA ke EXACT GD values
--     (50 tiers; badge/theme/emoji rewards par GD 0 — wo client-side
--     cosmetic-only hain, server sirf GD credit karta hai).
-- (B) claim_battle_pass_tier v3 — TRACK-AWARE GD: free→freeGd,
--     prem→premGd (panel free/prem tracks ke rewards alag hain).
-- (C) live_config ROW — ab banayi (pehle missing thi): sirf ad keys,
--     panel CFG defaults se match. claim_ad_reward isi se amount/limit
--     padhta hai; config.load deep-merge selective hai to baki CFG
--     defaults untouched.
-- (D) claim_ad_reward GRANT — def pehle se server-hardened tha
--     (15s rate-limit + ad_reward_log audit + wtxn + live_config
--     amount/limit). 401-dead tha, ab revived (Coin-Shop watch-ad +
--     Bonus Ads dono features).
-- ═══════════════════════════════════════════════════════════════════

-- (A) battle_passes seed — Season 9 (Sep 2026), 50 tiers, panel TIERS_DATA se
INSERT INTO battle_passes(id, name, season_num, season_key, is_active, tiers, start_date, end_date)
VALUES (
  gen_random_uuid(),
  'Season 9 — Sep 2026',
  9,
  '2026_09',
  true,
  '[{"tier":1,"freeGd":5,"premGd":0},{"tier":2,"freeGd":5,"premGd":10},{"tier":3,"freeGd":5,"premGd":10},{"tier":4,"freeGd":5,"premGd":10},{"tier":5,"freeGd":0,"premGd":0},{"tier":6,"freeGd":8,"premGd":15},{"tier":7,"freeGd":8,"premGd":15},{"tier":8,"freeGd":8,"premGd":0},{"tier":9,"freeGd":8,"premGd":15},{"tier":10,"freeGd":10,"premGd":20},{"tier":11,"freeGd":8,"premGd":15},{"tier":12,"freeGd":8,"premGd":15},{"tier":13,"freeGd":8,"premGd":0},{"tier":14,"freeGd":8,"premGd":15},{"tier":15,"freeGd":0,"premGd":0},{"tier":16,"freeGd":10,"premGd":20},{"tier":17,"freeGd":10,"premGd":20},{"tier":18,"freeGd":10,"premGd":0},{"tier":19,"freeGd":10,"premGd":20},{"tier":20,"freeGd":10,"premGd":25},{"tier":21,"freeGd":10,"premGd":20},{"tier":22,"freeGd":10,"premGd":20},{"tier":23,"freeGd":10,"premGd":0},{"tier":24,"freeGd":10,"premGd":20},{"tier":25,"freeGd":15,"premGd":0},{"tier":26,"freeGd":12,"premGd":25},{"tier":27,"freeGd":12,"premGd":25},{"tier":28,"freeGd":12,"premGd":0},{"tier":29,"freeGd":12,"premGd":25},{"tier":30,"freeGd":0,"premGd":30},{"tier":31,"freeGd":12,"premGd":25},{"tier":32,"freeGd":12,"premGd":25},{"tier":33,"freeGd":12,"premGd":0},{"tier":34,"freeGd":12,"premGd":25},{"tier":35,"freeGd":15,"premGd":0},{"tier":36,"freeGd":15,"premGd":30},{"tier":37,"freeGd":15,"premGd":30},{"tier":38,"freeGd":15,"premGd":0},{"tier":39,"freeGd":15,"premGd":30},{"tier":40,"freeGd":0,"premGd":40},{"tier":41,"freeGd":15,"premGd":30},{"tier":42,"freeGd":15,"premGd":30},{"tier":43,"freeGd":15,"premGd":0},{"tier":44,"freeGd":15,"premGd":30},{"tier":45,"freeGd":18,"premGd":0},{"tier":46,"freeGd":18,"premGd":35},{"tier":47,"freeGd":18,"premGd":35},{"tier":48,"freeGd":18,"premGd":0},{"tier":49,"freeGd":15,"premGd":35},{"tier":50,"freeGd":20,"premGd":0}]'::jsonb,
  '2026-09-01',
  '2026-09-30'
);
-- NOTE: agli month me admin naya season row banaye (season_key '2026_10')
-- ya is row ko update kar de. battle_passes.season_key par UNIQUE
-- constraint NAHI hai — idempotent upsert ke liye pehle: aisa constraint
-- chahiye to banane ki jagah CHECK with trigger, ya insert se pehle
-- SELECT-count karo.

-- (B) claim_battle_pass_tier v3 — track-aware GD
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
  /* FIX (2026-09-20d): track-aware GD — free→freeGd, prem→premGd
     (panel TIERS_DATA ke free/prem rewards alag hain). p_gd_reward IGNORE. */
  v_reward_gd := COALESCE((v_tier_def ->> CASE p_track WHEN 'free' THEN 'freeGd' ELSE 'premGd' END)::NUMERIC, 0);

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
    VALUES(v_uid, 'green_diamonds', 'credit', v_reward_gd, 'battle_pass_tier', p_season || ':t' || p_tier || ':' || p_track);
  END IF;

  UPDATE battle_pass_progress
    SET claimed_free = CASE p_track WHEN 'free' THEN claimed_free || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_free END,
        claimed_prem = CASE p_track WHEN 'prem' THEN claimed_prem || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_prem END,
        updated_at = NOW()
    WHERE user_id = v_uid AND season_key = p_season;

  RETURN jsonb_build_object('success', true, 'gd', v_reward_gd, 'track', p_track, 'tier', p_tier);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(text, integer, text, numeric) TO anon, authenticated, service_role;

-- (C) live_config — sirf ad-keys (panel CFG deep-merge selective hai)
INSERT INTO app_settings(key, value) VALUES ('live_config', '{"adCoinsPerWatch":10,"adDailyLimit":5}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = app_settings.value || '{"adCoinsPerWatch":10,"adDailyLimit":5}'::jsonb;

-- (D) claim_ad_reward — def server-hardened (rate-limit/audit/config), grant-only fix
GRANT EXECUTE ON FUNCTION public.claim_ad_reward() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live, SEED battery):
--  ✓ bp free t1 (season 2026_09) → +5 GD (p_gd_reward=999 ignored)
--  ✓ bp prem t1 without season-pass → gated
--  ✓ bp prem t2 (has_premium) → +10 GD (track-aware)
--  ✓ bp double-claim → Already claimed
--  ✓ ad reward → +10 coins (live_config), todayCount audit
--  ✓ ad reward 15s rate-limit → Too soon
-- ═══════════════════════════════════════════════════════════════
