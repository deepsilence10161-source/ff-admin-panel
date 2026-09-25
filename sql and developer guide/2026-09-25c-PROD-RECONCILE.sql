-- ═══════════════════════════════════════════════════════════════════════
-- 2026-09-25c — PROD RECONCILE (source-of-truth sync)  [R7 FOLLOW-UP #9]
-- Brings COMPLETE_SCHEMA up to EXACT live state (idempotent, non-destructive).
--
-- ROOT FINDING first (why this file exists): this deployment runs PostgREST
-- requests under the `anon` role — Firebase Third-Party-Auth JWTs carry the
-- user's `sub`, but not an `authenticated` role claim (auth.users=0 live;
-- /auth/v1/user returns bad_jwt:RS256 for the fed token). This is COMPLETE_SCHEMA
-- PLATFORM FACT #7 (line 21). Therefore the 09-24c 'authenticated-only'
-- REVOKEs made 77 client-called SECDEF RPCs + both public views unreachable
-- from the shipped panels (live: search → 0 rows; resolve_sd_request → 42501).
-- Fix model = body-guard security (fail-closed caller/admin checks + server-config
-- price authority) + RLS. Grants on guarded RPCs are restored to anon below;
-- genuinely-internal/unguarded functions stay service-role-only.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_gd_withdrawal(p_gd_amount numeric, p_amount_inr numeric, p_upi text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  /* R29E P0-FIX: GD economy NON-withdrawable hai (user policy + diamond-system).
     Puraana flow user ka GD deduct karta tha aur sd_requests me ek
     green_diamond_withdrawal row daal deta tha jise admin approve karne par
     koi REAL payout nahi milta (na cash, na refund) — paisa-trapped cheque.
     Koi live caller nahi (0 rows live, grep-verified). Ab RPC refuse karta hai:
     balance untouched, koi row nahi. Sponsored winnings hi ekमात्र
     withdrawable path hai (submitSponsoredWd). */
  RETURN jsonb_build_object('ok', false, 'error', 'Green Diamonds withdrawal nahi hai — GD non-withdrawable hai. Sponsored winnings hi withdraw ho sakti hai.');
END;
$function$

CREATE OR REPLACE FUNCTION public.f_user_public_profiles()
 RETURNS TABLE(id text, ign text, ff_uid text, avatar_url text, avatar_bg_color text, city text, bio text, rank_tier text, rank_points integer, total_wins integer, total_kills integer, total_matches integer, win_streak integer, has_clean_badge boolean, is_banned boolean, is_live boolean, stream_link text, stream_title text, clan_id text, profile_status text, level integer, exp integer, is_vip boolean, is_creator boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, ign, ff_uid, avatar_url, avatar_bg_color, city, bio, rank_tier,
         rank_points, total_wins, total_kills, total_matches, win_streak,
         has_clean_badge, is_banned, is_live, stream_link, stream_title,
         clan_id, profile_status, level, exp, is_vip, is_creator, created_at
  FROM users
$function$

CREATE OR REPLACE FUNCTION public.f_referral_leaderboard()
 RETURNS TABLE(referrer_id text, ign text, avatar_url text, referral_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.referrer_id, u.ign, u.avatar_url, count(*)::bigint
  FROM referrals r
  JOIN users u ON u.id = r.referrer_id
  GROUP BY r.referrer_id, u.ign, u.avatar_url
  ORDER BY count(*) DESC
$function$

CREATE OR REPLACE FUNCTION public.correct_match_result(p_match_id text, p_user_id text, p_rank integer DEFAULT NULL::integer, p_kills integer DEFAULT NULL::integer, p_manual_amount numeric DEFAULT NULL::numeric, p_user_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      TEXT := auth.jwt() ->> 'sub';
  v_is_service  BOOLEAN := (current_setting('role', true) = 'service_role');
  v_is_admin    BOOLEAN;
  v_m           RECORD;
  v_mr          RECORD;
  v_jr          RECORD;
  v_currency    TEXT := 'coins';
  v_curr_label  TEXT := 'Coins';
  v_first       NUMERIC; v_second NUMERIC; v_third NUMERIC; v_perk NUMERIC;
  v_old_rank    INT; v_old_kills INT;
  v_new_rank    INT; v_new_kills INT;
  v_rank_prize  NUMERIC; v_kill_prize NUMERIC;
  v_old_prize   NUMERIC; v_new_prize NUMERIC;
  v_target      TEXT;
  v_delta       NUMERIC;
  v_name        TEXT;
BEGIN
  /* ── Authorization ── */
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
  END IF;

  IF p_match_id IS NULL OR p_user_id IS NULL OR p_user_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'match_id/user_id required');
  END IF;

  /* match lock + business prize params (server-authoritative) */
  SELECT * INTO v_m FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;
  IF v_m.result_published_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESULT_NOT_PUBLISHED');
  END IF;

  v_name   := COALESCE(v_m.name, v_m.title, p_match_id);
  v_first  := COALESCE(v_m.first_prize, 0);
  v_second := COALESCE(v_m.second_prize, 0);
  v_third  := COALESCE(v_m.third_prize, 0);
  v_perk   := COALESCE(v_m.per_kill_prize, 0);

  /* currency mapping — publish_match_results jaisa hi */
  IF COALESCE(v_m.prize_type,'') IN ('green_diamond','greenDiamond') THEN
    v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
  ELSIF COALESCE(v_m.prize_type,'') IN ('sky','sky_diamond','skyDiamond') THEN
    v_currency := 'sky_diamonds'; v_curr_label := 'Sky Diamonds';
  ELSIF COALESCE(v_m.prize_type,'') IN ('coin','cash') THEN
    v_currency := 'coins'; v_curr_label := 'Coins';
  ELSE
    IF v_m.entry_type IN ('paid','sky_diamond','skyDiamond') THEN
      v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
    END IF;
  END IF;

  /* authoritative published result row + join row */
  SELECT * INTO v_mr FROM match_results
    WHERE match_id = p_match_id AND user_id = p_user_id FOR UPDATE;
  IF v_mr.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESULT_NOT_FOUND');
  END IF;

  SELECT * INTO v_jr FROM join_requests
    WHERE match_id = p_match_id AND user_id = p_user_id;
  IF v_jr.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'JOIN_NOT_FOUND');
  END IF;

  v_old_rank  := COALESCE(v_mr.rank, 0);
  v_old_kills := COALESCE(v_mr.kills, 0);
  v_new_rank  := COALESCE(p_rank, v_old_rank);
  v_new_kills := COALESCE(p_kills, v_old_kills);

  v_rank_prize := CASE WHEN v_new_rank = 1 THEN v_first
                       WHEN v_new_rank = 2 THEN v_second
                       WHEN v_new_rank = 3 THEN v_third
                       ELSE 0 END;
  v_kill_prize := v_new_kills * v_perk;

  /* prize: server compute by default; manual override sirf admin-checked
     path par (yahan admin check upar ho chuka + service) */
  v_old_prize := COALESCE(v_mr.rank_prize, 0) + (COALESCE(v_old_kills,0) * v_perk);
  IF p_manual_amount IS NOT NULL THEN
    v_new_prize := GREATEST(p_manual_amount, 0);
  ELSE
    v_new_prize := v_rank_prize + v_kill_prize;
  END IF;

  /* captain_pays member → paisa captain ko (publish jaisa aggregation) */
  v_target := p_user_id;
  IF v_jr.fee_type = 'captain_pays'
     AND v_jr.captain_uid IS NOT NULL
     AND v_jr.captain_uid <> p_user_id THEN
    v_target := v_jr.captain_uid;
  END IF;

  v_delta := v_new_prize - v_old_prize;

  /* ── wallet delta on target (credit/debit, floor 0) ── */
  IF v_delta <> 0 THEN
    IF v_currency = 'coins' THEN
      UPDATE users SET coins = GREATEST(COALESCE(coins,0) + v_delta, 0),
                       total_winnings = GREATEST(COALESCE(total_winnings,0) + v_delta, 0)
      WHERE id = v_target;
    ELSIF v_currency = 'sky_diamonds' THEN
      UPDATE users SET sky_diamonds = GREATEST(COALESCE(sky_diamonds,0) + v_delta, 0),
                       total_winnings = GREATEST(COALESCE(total_winnings,0) + v_delta, 0)
      WHERE id = v_target;
    ELSE
      UPDATE users SET green_diamonds = GREATEST(COALESCE(green_diamonds,0) + v_delta, 0),
                       total_winnings = GREATEST(COALESCE(total_winnings,0) + v_delta, 0)
      WHERE id = v_target;
    END IF;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, ref_id, created_at)
    VALUES (v_target, v_currency,
            CASE WHEN v_delta > 0 THEN 'correction_credit' ELSE 'correction_debit' END,
            ABS(v_delta), 'result_correction', 'approved', p_match_id, NOW());

    INSERT INTO notifications(user_id, type, title, body, is_read, created_at, ref_id)
    VALUES (v_target, 'correction', '🔧 Result Correction',
            v_name || ' — ' || ABS(v_delta) || ' ' || v_curr_label || ' ' ||
            CASE WHEN v_delta > 0 THEN 'add kiya gaya.' ELSE 'adjust kiya gaya.' END,
            false, NOW(), p_match_id);
  END IF;

  /* ── kills delta on the player (stats) ── */
  IF v_new_kills <> COALESCE(v_old_kills, 0) THEN
    UPDATE users SET total_kills = GREATEST(COALESCE(total_kills,0)
              + (v_new_kills - COALESCE(v_old_kills,0)), 0)
    WHERE id = p_user_id;
  END IF;

  /* ── match_results (authoritative) ── */
  /* publish_match_results kI tarah: captain_pays member kI row ka prize 0
     rehta hai (paisa captain ko aggregate hota hai) — prize + prize_earned
     dono byte-consistent. */
  UPDATE match_results SET
    placement   = v_new_rank,
    kills       = v_new_kills,
    rank        = v_new_rank,
    kill_prize  = v_kill_prize,
    rank_prize  = v_rank_prize,
    prize_earned = CASE WHEN v_jr.fee_type = 'captain_pays'
                         AND v_jr.captain_uid IS NOT NULL
                         AND v_jr.captain_uid <> p_user_id
                        THEN 0 ELSE v_new_prize END,
    prize       = CASE WHEN v_jr.fee_type = 'captain_pays'
                         AND v_jr.captain_uid IS NOT NULL
                         AND v_jr.captain_uid <> p_user_id
                        THEN 0 ELSE v_new_prize END
  WHERE match_id = p_match_id AND user_id = p_user_id;

  /* ── join_requests final state ── */
  UPDATE join_requests SET
    status = 'completed', placement = v_new_rank,
    prize_earned = CASE WHEN v_jr.fee_type = 'captain_pays'
                         AND v_jr.captain_uid IS NOT NULL
                         AND v_jr.captain_uid <> p_user_id
                        THEN 0 ELSE v_new_prize END,
    kills = v_new_kills
  WHERE match_id = p_match_id AND user_id = p_user_id;

  /* ── admin_actions audit log ── */
  INSERT INTO admin_actions(action, match_id, user_id, user_name, new_rank, new_kills, new_prize, delta, created_at)
  VALUES ('result_correction', p_match_id, p_user_id,
          NULLIF(p_user_name, ''), v_new_rank, v_new_kills, v_new_prize, v_delta, NOW());

  RETURN jsonb_build_object(
    'ok', true,
    'match_id', p_match_id,
    'user_id', p_user_id,
    'target', v_target,
    'currency', v_currency,
    'old_rank', v_old_rank, 'new_rank', v_new_rank,
    'old_kills', v_old_kills, 'new_kills', v_new_kills,
    'old_prize', v_old_prize, 'new_prize', v_new_prize,
    'delta', v_delta);
END;
$function$

CREATE OR REPLACE VIEW public.user_public_profiles WITH (security_invoker = true) AS
SELECT id,
    ign,
    ff_uid,
    avatar_url,
    avatar_bg_color,
    city,
    bio,
    rank_tier,
    rank_points,
    total_wins,
    total_kills,
    total_matches,
    win_streak,
    has_clean_badge,
    is_banned,
    is_live,
    stream_link,
    stream_title,
    clan_id,
    profile_status,
    level,
    exp,
    is_vip,
    is_creator,
    created_at
   FROM f_user_public_profiles() f_user_public_profiles(id, ign, ff_uid, avatar_url, avatar_bg_color, city, bio, rank_tier, rank_points, total_wins, total_kills, total_matches, win_streak, has_clean_badge, is_banned, is_live, stream_link, stream_title, clan_id, profile_status, level, exp, is_vip, is_creator, created_at);

ALTER VIEW public.user_public_profiles SET (security_invoker = true);
GRANT SELECT ON public.user_public_profiles TO anon, authenticated;

CREATE OR REPLACE VIEW public.referral_leaderboard WITH (security_invoker = true) AS
SELECT referrer_id,
    ign,
    avatar_url,
    referral_count
   FROM f_referral_leaderboard() f_referral_leaderboard(referrer_id, ign, avatar_url, referral_count);

ALTER VIEW public.referral_leaderboard SET (security_invoker = true);
GRANT SELECT ON public.referral_leaderboard TO anon, authenticated;

-- guarded client RPCs + RLS helpers → anon EXECUTE (body guards are the auth)
REVOKE ALL ON FUNCTION public.admin_adjust_wallet(p_uid text, p_col text, p_amount numeric, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(p_uid text, p_col text, p_amount numeric, p_reason text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_approve_profile(p_request_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_profile(p_request_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_confirm_creator_cheat(p_flag_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_confirm_creator_cheat(p_flag_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_sponsored_match(p_title text, p_sponsor_name text, p_mode text, p_max_slots integer, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric, p_prize_type text, p_description text, p_map text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsored_match(p_title text, p_sponsor_name text, p_mode text, p_max_slots integer, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric, p_prize_type text, p_description text, p_map text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_dismiss_creator_flag(p_flag_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_creator_flag(p_flag_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_distribute_sponsored_prize(p_uid text, p_amount numeric, p_tour_id text, p_rank text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_distribute_sponsored_prize(p_uid text, p_amount numeric, p_tour_id text, p_rank text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reject_profile(p_request_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reject_profile(p_request_id uuid, p_reason text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_roll_battle_pass_season() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_roll_battle_pass_season() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_fraud_score(p_uid text, p_score integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_fraud_score(p_uid text, p_score integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_creator_application(p_uid text, p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_creator_application(p_uid text, p_code text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer, p_grant_bp boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer, p_grant_bp boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_premium(p_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_premium(p_uid text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cast_poll_vote(p_poll_id uuid, p_option text, p_option_idx integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(p_poll_id uuid, p_option text, p_option_idx integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_ad_reward() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ad_reward() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_match_commission_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_match_commission_payout() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_match_refund(p_join_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_match_refund(p_join_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_referral_reward(p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(p_code text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_watch_earn_reward(p_match_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_watch_earn_reward(p_match_id text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.correct_match_result(p_match_id text, p_user_id text, p_rank integer, p_kills integer, p_manual_amount numeric, p_user_name text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_match_result(p_match_id text, p_user_id text, p_rank integer, p_kills integer, p_manual_amount numeric, p_user_name text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.f_referral_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f_referral_leaderboard() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.f_user_public_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f_user_public_profiles() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_poll_vote(p_poll_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_poll_vote(p_poll_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_room_credentials(p_match_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_credentials(p_match_id text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_match_filled_slots(p_match_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_match_filled_slots(p_match_id text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_caller_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_caller_admin() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_match_results(p_match_id text, p_results jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_match_results(p_match_id text, p_results jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rate_creator_match(p_match_id text, p_stars integer, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_creator_match(p_match_id text, p_stars integer, p_reason text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redeem_voucher(p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(p_code text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_creator_application(p_uid text, p_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_creator_application(p_uid text, p_note text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_eligible_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_eligible_commissions() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_team_invite(p_invite_id uuid, p_accept boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_team_invite(p_invite_id uuid, p_accept boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_user_ban_status(p_uid text, p_banned boolean, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_ban_status(p_uid text, p_banned boolean, p_reason text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_user_location_once(p_city text, p_state text, p_lat double precision, p_lng double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_location_once(p_city text, p_state text, p_lat double precision, p_lng double precision) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_free_trial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_free_trial() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_age_verification(p_date_of_birth date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_age_verification(p_date_of_birth date) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_sponsored_withdrawal(p_amount numeric, p_upi text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_sponsored_withdrawal(p_amount numeric, p_upi text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_has_phone(p_phone text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_phone(p_phone text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) TO anon, authenticated, service_role;

-- internal/unguarded/scheduled/owner-nested → service_role ONLY
REVOKE ALL ON FUNCTION public.increment_poll_vote(p_poll_id uuid, p_option text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_poll_vote(p_poll_id uuid, p_option text) TO service_role;
REVOKE ALL ON FUNCTION public.internal_process_no_show_refunds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_process_no_show_refunds() TO service_role;
REVOKE ALL ON FUNCTION public.notifications_push_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notifications_push_hook() TO service_role;
REVOKE ALL ON FUNCTION public.sync_admin_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_admin_tables() TO service_role;
REVOKE ALL ON FUNCTION public.sync_leaderboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_leaderboard() TO service_role;
REVOKE ALL ON FUNCTION public.block_creator_self_play() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_creator_self_play() TO service_role;
REVOKE ALL ON FUNCTION public.block_creator_self_play_check(p_uid text, p_match_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_creator_self_play_check(p_uid text, p_match_id text) TO service_role;
REVOKE ALL ON FUNCTION public.redirect_match_room_secrets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redirect_match_room_secrets() TO service_role;
REVOKE ALL ON FUNCTION public.audit_wallet_balance_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_wallet_balance_changes() TO service_role;
REVOKE ALL ON FUNCTION public.finalize_creator_commission(p_match_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(p_match_id text) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean) TO service_role;
REVOKE ALL ON FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric) TO service_role;
REVOKE ALL ON FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric) TO service_role;
REVOKE ALL ON FUNCTION public.increment_season_stats(p_month_key text, p_user_id text, p_ign text, p_display_name text, p_profile_image text, p_wins numeric, p_kills numeric, p_matches numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_season_stats(p_month_key text, p_user_id text, p_ign text, p_display_name text, p_profile_image text, p_wins numeric, p_kills numeric, p_matches numeric) TO service_role;
REVOKE ALL ON FUNCTION public.review_creator_video(p_video_id uuid, p_action text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_creator_video(p_video_id uuid, p_action text) TO service_role;

