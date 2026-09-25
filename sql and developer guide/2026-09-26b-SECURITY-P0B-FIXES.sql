-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-26b SECURITY P0-B FIXES
-- Client-side money-writes (realMoney/coins) → authoritative server RPCs
-- source: 4 actively-loaded admin files:
--   • fa14-player-lookup.js        → fa14GiveCoins() direct coins credit
--   • fa26-poll-suggestion.js      → rewardSuggestion() coins + realMoney/bonus
--   • fa44-fa52-final-admin-tools.js → revokeReferralBonus() direct coins debit
--   • fa-admin-v10-final.js        → endCurrentSeason() top-100 coins credit
-- Live-verified supercede facts: users.realMoney/bonus + referralBonusCoins
-- Firebase fields do NOT exist as users columns (bridge NESTED_FIELD_MAP only
-- maps realMoney/winnings→green_diamonds, realMoney/deposited→sky_diamonds),
-- so today those writes are guaranteed no-ops / column-denied. This delta adds
-- the authoritative single-transaction server paths instead.
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- [1] admin_reward_suggestion — suggestion reward (coins | real_money→green_diamonds)
--     single txn: balance credit + wallet_transactions + suggestion status + notification
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reward_suggestion(
  p_key         TEXT,     -- suggestions.id (uuid) OR user_id (legacy)
  p_reward_type TEXT,     -- 'coins' | 'real_money'
  p_amount      NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_caller    TEXT := auth.jwt() ->> 'sub';
  v_is_admin  BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_user_id   TEXT;
  v_col       TEXT;
  v_currency  TEXT;
  v_label     TEXT;
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

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  IF p_amount > 999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount too large');
  END IF;

  IF p_reward_type = 'real_money' THEN
    v_col := 'green_diamonds'; v_currency := 'green_diamonds'; v_label := '₹' || p_amount::text;
  ELSIF p_reward_type = 'coins' THEN
    v_col := 'coins'; v_currency := 'coins'; v_label := p_amount::text || ' coins';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reward type');
  END IF;

  SELECT user_id INTO v_user_id
    FROM suggestions
   WHERE id::text = p_key OR user_id = p_key
   LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Suggestion not found');
  END IF;

  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2', v_col, v_col)
    USING p_amount, v_user_id;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status, created_at)
  VALUES (v_user_id, v_currency, 'credit', p_amount, 'suggestion_reward', v_caller, 'approved', now());

  UPDATE suggestions SET status = 'rewarded'
   WHERE id::text = p_key OR user_id = p_key;

  INSERT INTO notifications(user_id, type, title, body, is_read, created_at)
  VALUES (v_user_id, 'wallet_approved', '🏆 Suggestion Reward Mila!',
          format('Teri suggestion ke liye %s reward diya gaya! Shukriya!', v_label), false, now());

  RETURN jsonb_build_object('success', true, 'reward', v_label, 'user_id', v_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_reward_suggestion(text, text, numeric) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reward_suggestion(text, text, numeric) TO anon, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- [2] admin_revoke_referral_bonus — referral-fraud coin clawback
--     single txn: coins debit + wallet_transactions + admin_actions log
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_referral_bonus(
  p_uid    TEXT,
  p_amount NUMERIC,
  p_reason TEXT DEFAULT 'Referral fraud'
) RETURNS JSONB AS $$
DECLARE
  v_caller    TEXT := auth.jwt() ->> 'sub';
  v_is_admin  BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_current   NUMERIC;
  v_deduct    NUMERIC;
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

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  IF p_amount > 999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount too large');
  END IF;

  SELECT coins INTO v_current FROM users WHERE id = p_uid FOR UPDATE;
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_deduct := LEAST(v_current, p_amount);
  IF v_deduct <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No coins to revoke', 'balance', v_current);
  END IF;

  UPDATE users SET coins = coins - v_deduct WHERE id = p_uid;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status, created_at)
  VALUES (p_uid, 'coins', 'debit', v_deduct, 'referral_bonus_revoke', v_caller, 'approved', now());

  INSERT INTO admin_actions(action, user_id, delta, created_at)
  VALUES ('referral_bonus_revoke', p_uid, -v_deduct, now());

  INSERT INTO notifications(user_id, type, title, body, is_read, created_at)
  VALUES (p_uid, 'admin_alert', '💸 Referral Bonus Revoked',
          format('%s referral-bonus coins clawed back (fraud).', v_deduct::text), false, now());

  RETURN jsonb_build_object('success', true, 'revoked', v_deduct,
                            'old_balance', v_current, 'new_balance', v_current - v_deduct);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_revoke_referral_bonus(text, numeric, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_referral_bonus(text, numeric, text) TO anon, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- [3] admin_end_current_season — server-side ranking + top-100 coin rewards +
--     seasonal_league_history archive + season deactivation. Single txn.
--     Score formula = calcRkScore (wins*40 + kills*2 + matches + streak*10);
--     tier formula = calcRk; position rewards = calcSeasonReward (1→500, ≤5→200,
--     ≤20→100, else 50). All values shared verbatim with client helpers in
--     supabase-init-early.js so season-end dena/arkao matches live rank display.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_end_current_season(
  p_season_name TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_caller      TEXT := auth.jwt() ->> 'sub';
  v_is_admin    BOOLEAN;
  v_is_service  BOOLEAN := (current_setting('role', true) = 'service_role');
  v_season_name TEXT;
  v_season_num  INT := 1;
  v_cfg         JSONB;
  u             RECORD;
  v_pos         INT := 0;
  v_score       NUMERIC;
  v_coins       INT;
  v_tier        TEXT;
  v_tier_emoji  TEXT;
  v_pos_badge   TEXT;
  v_pos_reward  TEXT;
  v_pos_emoji   TEXT;
  v_rewarded    INT := 0;
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

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'currentSeason';
  v_season_name := COALESCE(p_season_name, (v_cfg ->> 'name'), 'Season');
  v_season_num  := COALESCE((v_cfg ->> 'seasonNum')::INT, 1);

  FOR u IN
    SELECT id,
           (COALESCE(total_wins,0)*40 + COALESCE(total_kills,0)*2
            + COALESCE(total_matches,0)*1 + COALESCE(win_streak,0)*10)::NUMERIC AS score
      FROM users
     WHERE COALESCE(total_matches,0) > 0
     ORDER BY 2 DESC, id
     LIMIT 100
  LOOP
    v_pos   := v_pos + 1;
    v_score := u.score;

    -- calcRk tier (identical thresholds)
    IF v_score >= 5000 THEN v_tier := 'Grandmaster'; v_tier_emoji := '🌟';
    ELSIF v_score >= 3500 THEN v_tier := 'Heroic'; v_tier_emoji := '⚔️';
    ELSIF v_score >= 2000 THEN v_tier := 'Legend'; v_tier_emoji := '👑';
    ELSIF v_score >= 1501 THEN v_tier := 'Diamond'; v_tier_emoji := '💎';
    ELSIF v_score >= 1001 THEN v_tier := 'Platinum'; v_tier_emoji := '🔷';
    ELSIF v_score >= 601 THEN v_tier := 'Gold'; v_tier_emoji := '🥇';
    ELSIF v_score >= 301 THEN v_tier := 'Silver'; v_tier_emoji := '🥈';
    ELSE v_tier := 'Bronze'; v_tier_emoji := '🏅';
    END IF;

    -- calcSeasonReward (position-based)
    IF v_pos = 1 THEN
      v_pos_badge := 'Grandmaster Badge'; v_pos_reward := '🌟 Grandmaster Badge + 500🪙'; v_pos_emoji := '🌟'; v_coins := 500;
    ELSIF v_pos <= 5 THEN
      v_pos_badge := 'Legend Badge'; v_pos_reward := '👑 Legend Badge + 200🪙'; v_pos_emoji := '👑'; v_coins := 200;
    ELSIF v_pos <= 20 THEN
      v_pos_badge := 'Diamond Badge'; v_pos_reward := '💎 Diamond Badge + 100🪙'; v_pos_emoji := '💎'; v_coins := 100;
    ELSE
      v_pos_badge := 'Gold Badge'; v_pos_reward := '🥇 Gold Badge + 50🪙'; v_pos_emoji := '🥇'; v_coins := 50;
    END IF;

    UPDATE users SET coins = COALESCE(coins, 0) + v_coins WHERE id = u.id;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, created_at)
    VALUES (u.id, 'coins', 'credit', v_coins, 'season_reward', 'approved', now());

    INSERT INTO seasonal_league_history(user_id, season_name, season_num, final_tier, points, badge, reward, emoji, created_at)
    VALUES (u.id, v_season_name, v_season_num, v_tier, v_score::INT, v_pos_badge, v_pos_reward, v_pos_emoji, now());

    INSERT INTO notifications(user_id, type, title, body, is_read, created_at)
    VALUES (u.id, 'season_end', '🏆 Season Ended!',
            format('%s mein tumhara rank: #%s! %s mila!', v_season_name, v_pos::text, v_pos_reward),
            false, now());

    v_rewarded := v_rewarded + 1;
  END LOOP;

  -- Deactivate season (app_settings.currentSeason.active + live_config.seasonActive)
  UPDATE app_settings
     SET value = value || jsonb_build_object('active', false),
         updated_at = now()
   WHERE key = 'currentSeason';
  UPDATE app_settings
     SET value = value || jsonb_build_object('seasonActive', 0),
         updated_at = now()
   WHERE key = 'live_config';

  RETURN jsonb_build_object('success', true, 'season', v_season_name,
                            'rewarded', v_rewarded);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_end_current_season(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_end_current_season(text) TO anon, service_role;
