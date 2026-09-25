-- ============================================================================
-- 2026-09-25d — SECURITY ADVISOR FIXES (pg_net + authenticated SECDEF)
-- ============================================================================
-- Security Advisor findings इस delta से resolve होते हैं:
--   1.  pg_net extension in public schema (WARN)        → extensions schema
--   2.  authenticated SECURITY DEFINER execution (WARN) → 78 → 0
--
-- CLASSIFICATION BASIS (blind revoke नहीं — हर आइटम verified):
--
-- [1] pg_net → extensions
--   • extrelocatable=false है इसलिए ALTER EXTENSION ... SET SCHEMA नहीं चलता;
--     doc-blessed recipe = DROP + CREATE WITH SCHEMA extensions.
--   • Dependency check: सिर्फ़ public.notifications_push_hook (trigger
--     trg_notifications_push ON public.notifications) net.http_post बुलाता है;
--     drop/recreate के बाद net schema functions फिर से उपलब्ध, trigger re-validated
--     (tgenabled='O' intact), pg_net background worker alive (echo-request 200 OK),
--     queue 0 pending (कोई unsent request lost नहीं).
--   • net.http_* पर anon/authenticated EXECUTE PUBLIC-grant की वजह से बना रहता है
--     (grantor supabase_admin — postgres revoke नहीं कर सकता; Supabase platform
--     by-design safe: PostgREST net schema expose नहीं करता, anon/authenticated
--     NOLOGIN हैं — docs "Permissions" section)।
--
-- [2] authenticated SECDEF EXECUTE → REVOKE  (78 functions)
--   • PLATFORM FACT #7 (live re-proven 2026-09-25): Firebase JWT में Supabase
--     role-claim नहीं होता; GoTrue "firebase" OIDC return "Custom OIDC provider
--     not allowed"; auth.users count = 0. मतलब PostgREST हर client request को
--     anon role में resolve करता है — authenticated role production में
--     UNREACHABLE है।
--   • Live proof (post-fix, admin panel real client): is_caller_admin()=true,
--     search (f_user_public_profiles) n=6, admin_approve_profile business-response
--     ("request_not_found", permission-deny नहीं) — सब anon grant से काम कर रहे हैं.
--   • अपवाद नहीं: anon EXECUTE untouched (74 client RPCs + RLS helpers =
--     guarded-body boundary), service_role EXECUTE untouched (93).
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [1] pg_net: drop from public, recreate in extensions (non-relocatable)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS extensions;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- [2] authenticated SECDEF EXECUTE → REVOKE (78; grantor postgres = authorized)
-- ────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.admin_adjust_wallet(p_uid text, p_col text, p_amount numeric, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_approve_profile(p_request_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_confirm_creator_cheat(p_flag_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_create_sponsored_match(p_title text, p_sponsor_name text, p_mode text, p_max_slots integer, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric, p_prize_type text, p_description text, p_map text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_dismiss_creator_flag(p_flag_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_distribute_sponsored_prize(p_uid text, p_amount numeric, p_tour_id text, p_rank text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reject_profile(p_request_id uuid, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_roll_battle_pass_season() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_fraud_score(p_uid text, p_score integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_creator_application(p_uid text, p_code text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer, p_grant_bp boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_premium(p_uid text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cast_poll_vote(p_poll_id uuid, p_option text, p_option_idx integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_ad_reward() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_match_commission_payout() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_match_refund(p_join_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_no_show_refund(p_join_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_referral_reward(p_code text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_watch_earn_reward(p_match_id text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.correct_match_result(p_match_id text, p_user_id text, p_rank integer, p_kills integer, p_manual_amount numeric, p_user_name text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.f_referral_leaderboard() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.f_user_public_profiles() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_poll_vote(p_poll_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_room_credentials(p_match_id text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_match_filled_slots(p_match_id text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_own_match_played() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_caller_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_match_results(p_match_id text, p_results jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rate_creator_match(p_match_id text, p_stars integer, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_reward_item(p_name text, p_address text, p_phone text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_voucher(p_code text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_creator_application(p_uid text, p_note text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.release_eligible_commissions() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_team_invite(p_invite_id uuid, p_accept boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_user_ban_status(p_uid text, p_banned boolean, p_reason text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_user_location_once(p_city text, p_state text, p_lat double precision, p_lng double precision) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.start_free_trial() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_age_verification(p_date_of_birth date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_gd_withdrawal(p_gd_amount numeric, p_amount_inr numeric, p_upi text, p_notes text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_sponsored_withdrawal(p_amount numeric, p_upi text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.user_has_phone(p_phone text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) FROM authenticated;

COMMIT;
