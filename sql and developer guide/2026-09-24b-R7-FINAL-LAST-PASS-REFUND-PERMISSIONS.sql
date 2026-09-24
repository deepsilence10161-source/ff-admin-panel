/* ══════════════════════════════════════════════════════════════════
   R7 FINAL LAST PASS — REFUND + PERMISSIONS + SCHEMA CONSOLIDATION
   Idempotent delta · Generated 2026-09-24 · applies to public schema

   S1 cancel_match_with_refunds REWRITE — single authoritative atomic refund.
      (a) caller = auth.jwt()->>'sub' MUST be admin; p_admin_uid audit-only/ignored
      (b) matches row locked FOR UPDATE (dup/concurrent serialize)
      (c) idempotent: already-cancelled → ok, refund_count=0
      (d) per-join FOR UPDATE refund loop, server fee (entry_fee_paid)
      (e) non-paid joins → cancelled; (f) hold commissions void
      (g) slot bookkeeping; (h) cancelled_by = JWT caller
   S2 Grant consolidation (classifier blocks below)
   S3 user_public_profiles + referral_leaderboard: anon-SELECT revoke
   S4 push_hook_config RLS policies (admin-only)
   S5 pg_net schema-USAGE lockdown (SSRF); pg_trgm stays (documented)
   ══════════════════════════════════════════════════════════════════ */
BEGIN;

/* ────────────────────────────────────────────────────────────────────── */
-- S1 cancel_match_with_refunds REWRITE
CREATE OR REPLACE FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD; v_jr RECORD; v_refund_count INT := 0; v_currency TEXT;
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_match.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;
  IF v_match.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'refund_count', 0, 'already_cancelled', true);
  END IF;
  FOR v_jr IN
    SELECT * FROM join_requests
    WHERE match_id = p_match_id
      AND status NOT IN ('cancelled','refunded','rejected')
      AND COALESCE(entry_fee_paid, 0) > 0
    FOR UPDATE
  LOOP
    v_currency := CASE WHEN COALESCE(v_jr.entry_type,'') = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;
    IF v_currency = 'coins' THEN
      UPDATE users SET coins = COALESCE(coins,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    ELSE
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
    VALUES (v_jr.user_id, v_currency, 'credit', v_jr.entry_fee_paid, 'match_cancelled_refund', p_match_id, 'approved');
    UPDATE join_requests SET status = 'refunded' WHERE id = v_jr.id;
    INSERT INTO notifications(user_id, type, title, body, is_read, created_at, ref_id)
    VALUES (v_jr.user_id, 'refund', '💰 Match Cancelled — Refund',
            CHR(34)||COALESCE(v_match.name, v_match.title, p_match_id)||CHR(34)||' cancel ho gaya. Aapka entry fee wapas kar diya gaya hai.',
            false, NOW(), p_match_id);
    v_refund_count := v_refund_count + 1;
  END LOOP;
  UPDATE join_requests SET status = 'cancelled'
  WHERE match_id = p_match_id AND status NOT IN ('cancelled','refunded','rejected');
  UPDATE creator_commissions SET status = 'cancelled', updated_at = NOW()
  WHERE match_id = p_match_id AND status = 'hold';
  UPDATE matches SET filled_slots = GREATEST(
    filled_slots - COALESCE((SELECT SUM(CASE
      WHEN mode IN ('duo','squad') AND COALESCE(captain_uid, user_id) <> user_id THEN 0
      WHEN mode = 'duo' THEN 2
      WHEN mode = 'squad' THEN 4
      ELSE 1 END)
    FROM join_requests
    WHERE match_id = p_match_id AND status IN ('cancelled','refunded')), 0), 0)
  WHERE id = p_match_id;
  UPDATE matches SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = v_caller
  WHERE id = p_match_id;
  RETURN jsonb_build_object('ok', true, 'refund_count', v_refund_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

/* ────────────────────────────────────────────────────────────────────── */
-- S2 GRANT CONSOLIDATION
-- ADMIN classifier (23 fns): revoke anon+PUBLIC; authenticated (admin JWT)+service_role stay.
REVOKE ALL ON FUNCTION public.admin_approve_profile(p_request_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_profile(p_request_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_confirm_creator_cheat(p_flag_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_creator_cheat(p_flag_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_sponsored_match(p_title text, p_sponsor_name text, p_mode text, p_max_slots integer, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric, p_prize_type text, p_description text, p_map text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsored_match(p_title text, p_sponsor_name text, p_mode text, p_max_slots integer, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric, p_prize_type text, p_description text, p_map text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_dismiss_creator_flag(p_flag_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_creator_flag(p_flag_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_distribute_sponsored_prize(p_uid text, p_amount numeric, p_tour_id text, p_rank text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_distribute_sponsored_prize(p_uid text, p_amount numeric, p_tour_id text, p_rank text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_reject_profile(p_request_id uuid, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_profile(p_request_id uuid, p_reason text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_roll_battle_pass_season() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_roll_battle_pass_season() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_fraud_score(p_uid text, p_score integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_fraud_score(p_uid text, p_score integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_creator_application(p_uid text, p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_creator_application(p_uid text, p_code text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer, p_grant_bp boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer, p_grant_bp boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_premium(p_uid text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_premium(p_uid text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_eligible_commissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_eligible_commissions() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.review_creator_video(p_video_id uuid, p_action text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_creator_video(p_video_id uuid, p_action text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_user_ban_status(p_uid text, p_banned boolean, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_ban_status(p_uid text, p_banned boolean, p_reason text) TO authenticated, service_role;
-- AUTH_USER classifier: revoke anon+PUBLIC (all null-caller fail-closed); authenticated stays.
REVOKE ALL ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cast_poll_vote(p_poll_id uuid, p_option text, p_option_idx integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(p_poll_id uuid, p_option text, p_option_idx integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_ad_reward() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ad_reward() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_match_commission_payout() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_match_commission_payout() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_match_refund(p_join_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_match_refund(p_join_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_no_show_refund(p_join_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_no_show_refund(p_join_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_referral_reward(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(p_code text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_watch_earn_reward(p_match_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_watch_earn_reward(p_match_id text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_creator_commission(p_match_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(p_match_id text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_poll_vote(p_poll_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_poll_vote(p_poll_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_room_credentials(p_match_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_room_credentials(p_match_id text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_own_match_played() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_own_match_played() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_season_stats(p_month_key text, p_user_id text, p_ign text, p_display_name text, p_profile_image text, p_wins numeric, p_kills numeric, p_matches numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_season_stats(p_month_key text, p_user_id text, p_ign text, p_display_name text, p_profile_image text, p_wins numeric, p_kills numeric, p_matches numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rate_creator_match(p_match_id text, p_stars integer, p_reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_creator_match(p_match_id text, p_stars integer, p_reason text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.redeem_reward_item(p_name text, p_address text, p_phone text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_reward_item(p_name text, p_address text, p_phone text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.redeem_voucher(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(p_code text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_creator_application(p_uid text, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_creator_application(p_uid text, p_note text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_team_invite(p_invite_id uuid, p_accept boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_team_invite(p_invite_id uuid, p_accept boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_user_location_once(p_city text, p_state text, p_lat double precision, p_lng double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_location_once(p_city text, p_state text, p_lat double precision, p_lng double precision) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_free_trial() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_free_trial() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_age_verification(p_date_of_birth date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_age_verification(p_date_of_birth date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_gd_withdrawal(p_gd_amount numeric, p_amount_inr numeric, p_upi text, p_notes text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_gd_withdrawal(p_gd_amount numeric, p_amount_inr numeric, p_upi text, p_notes text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_sponsored_withdrawal(p_amount numeric, p_upi text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_sponsored_withdrawal(p_amount numeric, p_upi text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_has_phone(p_phone text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_phone(p_phone text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) TO authenticated, service_role;
-- TRIGGER/SECDEF-INTERNAL (7 fns): no client role may invoke.
REVOKE ALL ON FUNCTION public.audit_wallet_balance_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_wallet_balance_changes() TO service_role;
REVOKE ALL ON FUNCTION public.block_creator_self_play() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_creator_self_play() TO service_role;
REVOKE ALL ON FUNCTION public.block_creator_self_play_check(p_uid text, p_match_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_creator_self_play_check(p_uid text, p_match_id text) TO service_role;
REVOKE ALL ON FUNCTION public.notifications_push_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notifications_push_hook() TO service_role;
REVOKE ALL ON FUNCTION public.redirect_match_room_secrets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redirect_match_room_secrets() TO service_role;
REVOKE ALL ON FUNCTION public.sync_admin_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_admin_tables() TO service_role;
REVOKE ALL ON FUNCTION public.sync_leaderboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_leaderboard() TO service_role;
-- TRIGGER/NON-SECDEF helpers (6 fns): revoke PUBLIC default (trigger firing needs no EXECUTE grant).
REVOKE ALL ON FUNCTION public.clamp_join_requests_client_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clamp_join_requests_client_update() TO service_role;
REVOKE ALL ON FUNCTION public.fft_guard_match_results_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fft_guard_match_results_write() TO service_role;
REVOKE ALL ON FUNCTION public.fft_guard_wallet_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fft_guard_wallet_insert() TO service_role;
REVOKE ALL ON FUNCTION public.guard_users_self_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_users_self_update() TO service_role;
REVOKE ALL ON FUNCTION public.reassign_clan_leader() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_clan_leader() TO service_role;
REVOKE ALL ON FUNCTION public.trg_team_invitation_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_team_invitation_immutable() TO service_role;

/* ────────────────────────────────────────────────────────────────────── */
-- S3 VIEWS — anon-SELECT revoked (authenticated stays). Column-set already leak-free.
--   security_invoker stays false (documented): public-directory semantics need
--   cross-user reads; users RLS is self/admin-only so invoker=true would break
--   profile search / friends / player-card / leaderboards for logged-in users.
REVOKE SELECT ON public.user_public_profiles FROM anon;
REVOKE SELECT ON public.referral_leaderboard FROM anon;

/* ────────────────────────────────────────────────────────────────────── */
-- S4 push_hook_config RLS — admin-only (holds hook_secret / gateway_apikey).
DROP POLICY IF EXISTS phc_admin_all ON public.push_hook_config;
CREATE POLICY phc_admin_all ON public.push_hook_config
  FOR ALL USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true))
  WITH CHECK ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
ALTER TABLE public.push_hook_config ENABLE ROW LEVEL SECURITY;

/* ────────────────────────────────────────────────────────────────────── */
-- S5 EXTENSIONS
-- pg_net (non-relocatable, public schema): revoke USAGE from client roles — closes
--   the SSRF hole (net.http_* had PUBLIC default EXECUTE). postgres + service_role keep
--   USAGE (notifications_push_hook calls net.http_post as trigger/owner).
REVOKE USAGE ON SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA net TO postgres, service_role;
-- pg_trgm: kept in public by design — GIN opclass + % operator resolve against public
--   search_path for idx_users_ign_trgm / idx_users_ff_uid_trgm; relocating would break
--   operator/opclass resolution in future index DDL. Pure string functions only, no data path.

COMMIT;
