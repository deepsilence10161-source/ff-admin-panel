# SECURITY DEFINER RPC — FINAL CLASSIFICATION (Advisor evidence-lock)

**Date:** 2026-09-26  ·  **Round:** R8 FINAL follow-up (items 1 & 3)
**Artifacts:** `_r8e_results/classification.json` (sha256:e3b4e2e6dbddef47) ·
`_r8d_results/advisor_final.json` (sha256:25f4fd6f60361f01)

## 1. What the Advisor reports (exact)

| Lint | Count | Meaning |
|---|---|---|
| `anon_security_definer_function_executable` | **52** | SECURITY DEFINER function executable by `anon` |
| `authenticated_security_definer_function_executable` | **3** | the same functions *additionally* flagged for `authenticated` (`check_in_match`, `confirm_in_room`, `join_clan`) |
| `rls_enabled_no_policy` | **2** | `season_finalizations`, `suggestion_rewards` — intentional deny-all internal tables |

→ **52 unique functions** are flagged (the 3 `authenticated` lints are a subset of the same 52).
**Admin-only functions flagged: 0.**

## 2. Verification method (per function)

1. **Static (live `pg_proc`):** SECURITY DEFINER flag, `search_path` pinned?, exact `has_function_privilege`
   for anon/authenticated/service_role, plus body-derived facts (reads `auth.jwt()`? compares `v_caller`
   to the identity argument? `FOR UPDATE`? wallet columns? ledger insert? `is_admin` check?
   null-caller fail-closed?).
2. **Live impersonation probe:** called as **qa2 while passing qa1's uid** in the identity argument —
   the platform maps a Firebase JWT to the `anon` DB role, so any missed guard shows up here.
3. **Live anon probe:** same call with **no JWT**.
4. **Safety:** both users' wallets + 10 side-effect tables snapshotted before/after the whole sweep.

## 3. Result

| Check | Result |
|---|---|
| `search_path` pinned on all flagged functions | **52 / 52** |
| Anon probe (no JWT) — no unauthorized success | **52 / 52 blocked** |
| Impersonation probe (qa2 passing qa1's uid) | **13 / 13 applicable → blocked** (39 functions derive identity internally and accept no uid argument) |
| Side-effect delta across the entire sweep | **NONE** (wallets, ledger, joins, invites, suggestions, notifications, matches, results, clans, vouchers, withdrawals) |
| Unexpected successes / findings | **0** |

## 4. Classification of all 52 functions

| Function | Class | Identity source | Enforced invariants | Impersonation probe | No-JWT probe |
|---|---|---|---|---|---|
| `cast_poll_vote(p_poll_id uuid, p_option text, p_option_idx integer)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `check_in_match(p_match_id text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE | — | blocked ✓ |
| `claim_ad_reward()` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger | — | blocked ✓ |
| `claim_match_commission_payout()` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `claim_match_refund(p_join_id uuid)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `claim_mission_reward(p_mission_key text, p_period text, p_coins integer)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger | — | blocked ✓ |
| `claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger | — | blocked ✓ |
| `claim_referral_reward(p_code text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `claim_streak_milestone(p_day integer, p_coins integer, p_badge text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger | — | blocked ✓ |
| `claim_watch_earn_reward(p_match_id text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `confirm_in_room(p_join_id uuid)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE | — | blocked ✓ |
| `f_referral_leaderboard()` | user-action (self-service) | read-only aggregate | — | — | blocked ✓ |
| `f_user_public_profiles()` | user-action (self-service) | read-only aggregate | — | — | blocked ✓ |
| `get_my_poll_vote(p_poll_id uuid)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `get_room_credentials(p_match_id text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | is_admin | — | blocked ✓ |
| `gift_match_entry(p_match_id text, p_to_uid text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger | — | blocked ✓ |
| `invite_team_members(p_match_id text, p_mode text, p_fee_type text, p_member_uids text[])` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, null-caller fail-closed | — | blocked ✓ |
| `is_caller_admin()` | user-action (self-service) | JWT (auth.jwt()/uid()) | is_admin | — | blocked ✓ |
| `join_auto_squad_queue(p_match_id text, p_mode text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE | — | blocked ✓ |
| `join_clan(p_user_id text, p_clan_id uuid, p_role text)` | user-action (self-service) | arg `p_user_id` + JWT match | null-caller fail-closed | blocked ✓ | blocked ✓ |
| `join_clan(p_user_id text, p_clan_id uuid, p_role text, p_ign text, p_max_members integer)` | user-action (self-service) | arg `p_user_id` + JWT match | null-caller fail-closed | blocked ✓ | blocked ✓ |
| `join_match_team(p_match_id text, p_mode text, p_fee_type text, p_team jsonb)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `leave_clan(p_user_id text, p_clan_id uuid)` | user-action (self-service) | arg `p_user_id` + JWT match | null-caller fail-closed | blocked ✓ | blocked ✓ |
| `post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger | — | blocked ✓ |
| `rate_creator_match(p_match_id text, p_stars integer, p_reason text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean)` | user-action (self-service) | arg `p_caller_uid` + JWT match | void | blocked ✓ | blocked ✓ |
| `redeem_voucher(p_code text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `respond_team_invite(p_invite_id uuid, p_accept boolean)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, null-caller fail-closed | — | blocked ✓ |
| `set_user_location_once(p_city text, p_state text, p_lat double precision, p_lng double precision)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `start_free_trial()` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE | — | blocked ✓ |
| `submit_age_verification(p_date_of_birth date)` | user-action (self-service) | JWT (auth.jwt()/uid()) | null-caller fail-closed | — | blocked ✓ |
| `submit_sponsored_withdrawal(p_amount numeric, p_upi text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `user_has_phone(p_phone text)` | user-action (self-service) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `apply_referral_code(p_code text, p_reward numeric)` | user-action (domain) | JWT (auth.jwt()/uid()) | FOR UPDATE, wallet, ledger, null-caller fail-closed | — | blocked ✓ |
| `contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric)` | user-action (domain) | arg `p_uid` + JWT match | FOR UPDATE, wallet, ledger, null-caller fail-closed | blocked ✓ | blocked ✓ |
| `creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric, p_second_prize numeric, p_third_prize numeric)` | user-action (domain) | JWT (auth.jwt()/uid()) | wallet | — | blocked ✓ |
| `creator_publish_result(p_match_id text, p_results jsonb)` | user-action (domain) | JWT (auth.jwt()/uid()) | wallet, ledger | — | blocked ✓ |
| `creator_set_room(p_match_id text, p_room_id text, p_room_password text)` | user-action (domain) | JWT (auth.jwt()/uid()) | — | — | blocked ✓ |
| `increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer)` | user-action (domain) | JWT (auth.jwt()/uid()) | null-caller fail-closed, void | — | blocked ✓ |
| `validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb)` | user-action (domain) | arg `p_uid` + JWT match | FOR UPDATE, wallet, ledger, null-caller fail-closed | blocked ✓ | blocked ✓ |
| `award_battle_pass_xp(p_uid text, p_season text, p_xp integer)` | restricted (service/role-gated) | arg `p_uid` + JWT match | — | blocked ✓ | blocked ✓ |
| `award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer)` | restricted (service/role-gated) | arg `p_student_uid` + JWT match | FOR UPDATE, wallet, ledger, null-caller fail-closed | blocked ✓ | blocked ✓ |
| `decrement_balance(p_uid text, p_col text, p_amount numeric)` | restricted (service/role-gated) | arg `p_uid` + JWT match | FOR UPDATE, wallet, null-caller fail-closed | blocked ✓ | blocked ✓ |
| `form_auto_squad_team(p_match_id text, p_mode text, p_needed integer)` | restricted (service/role-gated) | JWT (auth.jwt()/uid()) | FOR UPDATE, null-caller fail-closed | — | blocked ✓ |
| `increment_balance(p_uid text, p_col text, p_amount numeric)` | restricted (service/role-gated) | arg `p_uid` + JWT match | wallet, is_admin, null-caller fail-closed, void | blocked ✓ | blocked ✓ |
| `increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text)` | restricted (service/role-gated) | arg `p_uid` + JWT match | null-caller fail-closed, void | blocked ✓ | blocked ✓ |
| `increment_rank_points(p_uid text, p_points integer)` | restricted (service/role-gated) | arg `p_uid` + JWT match | FOR UPDATE, is_admin, null-caller fail-closed, void | blocked ✓ | blocked ✓ |
| `unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text)` | restricted (service/role-gated) | arg `p_uid` + JWT match | FOR UPDATE, null-caller fail-closed | blocked ✓ | blocked ✓ |

Buckets: **37 user-action self-service · 7 user-action domain · 8 restricted (service/role-gated)**.

## 5. Advisor mapping — vulnerability vs intentional public RPC

| Advisor lint | Verdict | Why it is safe / intentional | Evidence |
|---|---|---|---|
| 52 × anon-executable SECDEF | **Intentional** (classified) | Platform fact: Supabase maps the Firebase JWT to the DB role **anon**, so the client's legitimate self-service RPCs must be anon-executable. Security is enforced *inside* each function: identity from `auth.jwt()->>'sub'`, caller-vs-argument equality, server-derived amounts, `FOR UPDATE` locking, duplicate/replay guards. | §4 table + classification.json (52/52 blocked, 0 side effects) |
| 3 × same functions also flagged for `authenticated` | **Intentional** | `check_in_match`, `confirm_in_room`, `join_clan` are user actions (check in / confirm room / join clan), each identity-checked. | §4 + flow suite C7–C10 |
| 2 × `rls_enabled_no_policy` | **Intentional (hardening)** | `season_finalizations` + `suggestion_rewards` are internal idempotency/audit tables: RLS on, **zero policies** = deny-all for client roles; only SECURITY DEFINER owners / `service_role` touch them (R8 FIX #3). | user smoke D32–D39; admin smoke C1–C2 |
| admin-only RPCs flagged | **None remain** | 27 admin RPCs: anon EXECUTE 0, authenticated 0; reachable only via the `admin-gateway` edge function or `service_role`. | admin smoke A1–A3, B6–B26; flow suite J1–J6 |

## 6. Residual notes (honest)

* `user_has_phone(p_phone)` — signup/verification helper: requires a JWT, returns nothing for the
  caller's own number, anon gets `found:false`. It does let an authenticated user check whether a phone
  number is already registered (enumeration oracle). Kept as-is (existing product behaviour, outside this
  hardening scope) and documented here so the trade-off is explicit. Closing it later = move the check
  into the verification flow server-side.
* `get_room_credentials` — verified gated: caller not in (creator, admin) and not a joined/checked-in
  player ⇒ refusal (flow suite C9/C10 + room-secret guards).
* PUBLIC-default EXECUTE: client RPCs are granted to `anon`/`authenticated` explicitly, while `PUBLIC`
  is revoked on the admin-only set (R8 FIX #2) — nothing leaks via PostgREST's `PUBLIC` fallback.

**Verdict:** every Advisor SECURITY DEFINER warning on this database is **classified, evidence-backed and
intentional**, with the 27 admin-only functions fully locked down. No unclassified executable function remains.
