-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-22f-R29F-BATTLEPASS-COLLECTIBLES-DELTA.sql
-- R29F (2026-09-22) — Battle Pass badges/themes/emojis/titles ab REAL
-- equip-able collectibles. Pehle ye sirf copy/labels the (server sirf
-- GD credit karta tha; 16 cosmetic tiers par premGd=0 matlab paid
-- Season Pass buyer ko vahan kuch bhi nahi milta tha + Tier-50 ke "50
-- GD" bhi 0 milte the).
-- ═══════════════════════════════════════════════════════════════════
-- (A) battle_passes.tiers — live 2026-09-22 UPDATE (already applied ✓)
--     har cosmetic tier par {freeCos|premCos:{type,key,name,icon}} +
--     tier 50 premGd 0 -> 50 (Season Legend Title + 50 GD ka wada).
--     Naye season banate waqt/admin seed karte waqt isi shape me tiers
--     banao. UNIQUE(season_key) NAHI hai — upsert se pehle count-check.
-- (B) claim_battle_pass_tier v4 — server-ab rewards source of truth:
--     GD (freeGd/premGd) + cosmetic collectible grant
--     (user_cosmetics upsert). p_gd_reward ab bhi IGNORE (client ko
--     kuch bhi bhejne ka fayda nahi).
-- (C) GRANT: anon+authenticated+service_role (browser = anon role,
--     body ke guards (has_premium, tier-reached, already-claimed) hi
--     authentication karte hain).
-- ═══════════════════════════════════════════════════════════════════

-- (A) active season tiers — cosmetic rewards + Tier-50 50 GD
UPDATE battle_passes
SET tiers = $tiers$[{"tier":1,"freeGd":5,"premGd":0,"premCos":{"type":"badge","name":"🎖️ Starter Badge","icon":"🎖️","key":"tag_bp_prem_1"}},{"tier":2,"freeGd":5,"premGd":10},{"tier":3,"freeGd":5,"premGd":10},{"tier":4,"freeGd":5,"premGd":10},{"tier":5,"freeGd":0,"premGd":0,"premCos":{"type":"badge","name":"🌟 Chosen One","icon":"🌟","key":"tag_bp_prem_5"},"freeCos":{"type":"badge","name":"🥉 Bronze Warrior","icon":"🥉","key":"tag_bp_free_5"}},{"tier":6,"freeGd":8,"premGd":15},{"tier":7,"freeGd":8,"premGd":15},{"tier":8,"freeGd":8,"premGd":0,"premCos":{"type":"emoji","name":"🔥 Fire Pack","icon":"🔥","key":"emoji_bp_prem_8"}},{"tier":9,"freeGd":8,"premGd":15},{"tier":10,"freeGd":10,"premGd":20},{"tier":11,"freeGd":8,"premGd":15},{"tier":12,"freeGd":8,"premGd":15},{"tier":13,"freeGd":8,"premGd":0,"premCos":{"type":"theme","name":"🔵 Blue Flame Border","icon":"🔵","key":"frame_bp_prem_13"}},{"tier":14,"freeGd":8,"premGd":15},{"tier":15,"freeGd":0,"premGd":0,"premCos":{"type":"badge","name":"🥈 Silver Fighter","icon":"🥈","key":"tag_bp_prem_15"},"freeCos":{"type":"badge","name":"🎖️ Participant","icon":"🎖️","key":"tag_bp_free_15"}},{"tier":16,"freeGd":10,"premGd":20},{"tier":17,"freeGd":10,"premGd":20},{"tier":18,"freeGd":10,"premGd":0,"premCos":{"type":"emoji","name":"⚡ Lightning Pack","icon":"⚡","key":"emoji_bp_prem_18"}},{"tier":19,"freeGd":10,"premGd":20},{"tier":20,"freeGd":10,"premGd":25},{"tier":21,"freeGd":10,"premGd":20},{"tier":22,"freeGd":10,"premGd":20},{"tier":23,"freeGd":10,"premGd":0,"premCos":{"type":"theme","name":"🟣 Purple Haze Border","icon":"🟣","key":"frame_bp_prem_23"}},{"tier":24,"freeGd":10,"premGd":20},{"tier":25,"freeGd":15,"premGd":0,"premCos":{"type":"badge","name":"🥇 Gold Champion","icon":"🥇","key":"tag_bp_prem_25"}},{"tier":26,"freeGd":12,"premGd":25},{"tier":27,"freeGd":12,"premGd":25},{"tier":28,"freeGd":12,"premGd":0,"premCos":{"type":"emoji","name":"👑 Crown Pack","icon":"👑","key":"emoji_bp_prem_28"}},{"tier":29,"freeGd":12,"premGd":25},{"tier":30,"freeGd":0,"premGd":30,"freeCos":{"type":"badge","name":"💪 Grinder","icon":"💪","key":"tag_bp_free_30"}},{"tier":31,"freeGd":12,"premGd":25},{"tier":32,"freeGd":12,"premGd":25},{"tier":33,"freeGd":12,"premGd":0,"premCos":{"type":"theme","name":"🟡 Golden Frame","icon":"🟡","key":"frame_bp_prem_33"}},{"tier":34,"freeGd":12,"premGd":25},{"tier":35,"freeGd":15,"premGd":0,"premCos":{"type":"emoji","name":"🌈 Neon Pack","icon":"🌈","key":"emoji_bp_prem_35"}},{"tier":36,"freeGd":15,"premGd":30},{"tier":37,"freeGd":15,"premGd":30},{"tier":38,"freeGd":15,"premGd":0,"premCos":{"type":"theme","name":"🌊 Ocean Wave Border","icon":"🌊","key":"frame_bp_prem_38"}},{"tier":39,"freeGd":15,"premGd":30},{"tier":40,"freeGd":20,"premGd":0,"premCos":{"type":"badge","name":"💎 Platinum Pro","icon":"💎","key":"tag_bp_prem_40"}},{"tier":41,"freeGd":15,"premGd":35},{"tier":42,"freeGd":15,"premGd":35},{"tier":43,"freeGd":15,"premGd":0,"premCos":{"type":"emoji","name":"🔴 Fire God Pack","icon":"🔴","key":"emoji_bp_prem_43"}},{"tier":44,"freeGd":15,"premGd":35},{"tier":45,"freeGd":0,"premGd":40,"freeCos":{"type":"badge","name":"🎯 Dedicated","icon":"🎯","key":"tag_bp_free_45"}},{"tier":46,"freeGd":15,"premGd":35},{"tier":47,"freeGd":15,"premGd":35},{"tier":48,"freeGd":15,"premGd":0,"premCos":{"type":"theme","name":"🌌 Galaxy Border","icon":"🌌","key":"frame_bp_prem_48"}},{"tier":49,"freeGd":15,"premGd":35},{"tier":50,"freeGd":20,"premGd":50,"premCos":{"type":"title","name":"🏆 Season Legend","icon":"🏆","key":"tag_bp_prem_50"}}]$tiers$::jsonb
WHERE season_key = '2026_09' AND is_active = true;

-- (B) claim_battle_pass_tier v4
CREATE OR REPLACE FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_claimed JSONB;
  v_bp RECORD;
  v_tier_def JSONB;
  v_reward_gd NUMERIC;
  v_cos JSONB;
  v_cos_key TEXT;
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
  /* track-aware GD: free->freeGd, prem->premGd. p_gd_reward IGNORE. */
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

  /* cosmetic collectible grant — badge/theme/emoji/title tier */
  v_cos := CASE p_track WHEN 'free' THEN v_tier_def->'freeCos' ELSE v_tier_def->'premCos' END;
  IF v_cos IS NOT NULL AND jsonb_typeof(v_cos) = 'object' THEN
    v_cos_key := v_cos->>'key';
    IF v_cos_key IS NOT NULL AND v_cos_key <> '' THEN
      INSERT INTO user_cosmetics(user_id, cosmetic_key, is_equipped, purchased_at)
      VALUES(v_uid, v_cos_key, false, now())
      ON CONFLICT (user_id, cosmetic_key) DO NOTHING;
    END IF;
  END IF;

  UPDATE battle_pass_progress
    SET claimed_free = CASE p_track WHEN 'free' THEN claimed_free || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_free END,
        claimed_prem = CASE p_track WHEN 'prem' THEN claimed_prem || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_prem END,
        updated_at = NOW()
    WHERE user_id = v_uid AND season_key = p_season;

  RETURN jsonb_build_object('success', true, 'gd', v_reward_gd, 'track', p_track, 'tier', p_tier,
                            'cosmetic', COALESCE(v_cos, 'null'::jsonb));
END;
$function$;

-- (C) grants — browser (anon role) + authenticated + service_role
REVOKE EXECUTE ON FUNCTION public.claim_battle_pass_tier(text, integer, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(text, integer, text, numeric) TO anon, authenticated, service_role;

-- NOTE: p_gd_reward INTEGER overload ab exist NAHI karta (dropped earlier).
-- Agli month: naya season (2026_10) isi tiers-shape me seed karo —
--   tier object = {"tier":N,"freeGd":G,"premGd":G,
--                  "freeCos":{"type","key","name","icon"} (optional),
--                  "premCos":{"type","key","name","icon"} (optional)}
--   cosmetic_key naming: tag_bp_<track>_<tier> | frame_bp_<track>_<tier> |
--                        emoji_bp_<track>_<tier>
-- END
