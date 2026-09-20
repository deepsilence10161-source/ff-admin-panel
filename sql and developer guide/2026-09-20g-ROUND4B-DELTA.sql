-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20g ROUND-4B DELTA — LIVE RUN ✅ (RPC ownership/amount audit)
-- ═══════════════════════════════════════════════════════════════════
-- Round-4 ke doosre half me SAARE crediting/updating RPCs ka systematic
-- audit kiya (18 crediting + 36 WHERE-id-updating). 5 aur holes mile:
--
-- R4-5 ★ increment_balance — LATENT WALLET-PRINTER + DEAD STATS-PATH:
--       allowed_cols me coins/green_diamonds/sky_diamonds/rank_points
--       the aur self-call (caller==uid) admin-check se bacha hua tha.
--       Panel anon-role se chalta hai isliye AAJ exploit nahi ho raha
--       tha (anon ke paas EXECUTE hi nahi tha → panel ke stats-calls
--       silently 401 ho rahe the = dead path), par kisi bhi
--       authenticated session se millionair banaya ja sakta tha.
--       FIX v2: self = SIRF stats-cols (total_wins/kills/matches,
--       win_streak, clean_matches) cap 100/call; wallet+rank+
--       filled_slots sirf admin/service. anon+authenticated grant
--       (stats-path revived, sub-guard JWT se). Verify: self-coins
--       blocked / stats+10 ok / cap 500-block. ✓
--
-- R4-6 increment_rank_points — SELF RANK-PRINTER: caller==p_uid par
--       koi check hi nahi (unlimited RP → leaderboard/tier/mentor-rewards
--       sab inflate). FIX v2: self = 500/call + 2000/day (users.
--       rp_today/rp_day cols); admin/service bypass. Legit calcRkScore
--       ~111/match — caps generous. Verify: 200 ok / 300-block(after 500
--       cap) / day-cap. ✓
--
-- R4-7 ★ cancel_match_with_refunds — NO GUARD AT ALL: koi bhi user
--       kisi bhi match ko cancel + sab refunds trigger kar sakta tha
--       (match-sabotage, paid matches safe nahi). FIX v2: is_admin
--       guard; p_admin_uid caller se. Verify: non-admin BLOCKED,
--       admin cancel+refund(5 coins, jr→refunded). 2/2 ✓
--
-- R4-8 unlock_squad_bank_cosmetic — CLIENT-COST: member p_cost=1 likh ke
--       koi bhi item unlock (clan-bank funds cheap-drain). FIX v2: cost
--       app_settings 'squad_bank_items' catalog se (8 items seeded,
--       panel squad-bank.js jaisa); p_cost IGNORE; unknown-item reject.
--       Verify: tamper-1 → 50 debit, unknown reject. 2/2 ✓
--
-- R4-9 increment_clan_score — MEMBER-SPAM: membership-guard tha par
--       values unlimited. FIX: per-call caps score≤30, kills≤30,
--       wins≤1 (legit: kills*1+wins*5 per match ≈ max 25). Verify:
--       999-block / legit-12 ok. 2/2 ✓
--
-- AUDIT-CLEAN (koi action nahi):
--   set_user_ban_status / admin_set_fraud_score → is_caller_admin() ✓
--   increment_poll_vote → grants GONE (pehle REVOKE'd) ✓
--   admin_approve/reject_profile, resolve_sd_request, resolve_sponsored_
--   withdrawal, review_creator_video, admin_sync_user_balance,
--   admin_set_coins → sab admin-guarded ✓
--   apply_referral_code / claim_referral_reward → server-config ✓
-- ═══════════════════════════════════════════════════════════════════

-- ── R4-5 cols + increment_balance v2 ──
-- (function bodies COMPLETE_SCHEMA Part H2 me hain — live-run ho chuka)
ALTER TABLE users ADD COLUMN IF NOT EXISTS rp_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rp_day DATE;

-- ── R4-8: squad_bank_items catalog ──
INSERT INTO app_settings(key, value) VALUES ('squad_bank_items', '{
 "banner_fire":{"cost":50},"banner_neon":{"cost":80},"badge_champion":{"cost":120},
 "tag_elite":{"cost":150},"room_theme":{"cost":200},"badge_ghost":{"cost":100},
 "banner_ice":{"cost":60},"tag_shadow":{"cost":180}
}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- NOTE: increment_balance / increment_rank_points / cancel_match_with_
-- refunds / unlock_squad_bank_cosmetic / increment_clan_score ke poore
-- naye bodies live DB me hain aur COMPLETE_SCHEMA Part H2 me merge ho
-- chuke hain (is file me repeat nahi — schema hi source of truth).
