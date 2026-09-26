# R8 FINAL — 4 DATABASE HARDENING FIXES — FINAL REPORT

**Date:** 2026-09-26 · **Scope:** FIX #1 (wallet row lock) · FIX #2 (admin-only RPC EXECUTE removal + trusted backend path) · FIX #3 (RLS on internal idempotency tables) · FIX #4 (one clean migration)
**Repos:** `deepsilence10161-source/ff-admin-panel` — HEAD `4213dca` (shim + gateway source + `index.html`) · `deepsilence10161-source/ff-user-panel` — HEAD `fb3317b` (shim + `index.html`)
**Guide:** `DEVELOPER_GUIDE.md` §60 appended.
**Primitives used:** Supabase project `hddhkculuyrfoevxmlwy`; Postgres identity of every panel request = role `anon` (proven: role comes from `Authorization`, never from `apikey`).

---

## 1. FIXED

- **FIX #1 — `admin_adjust_wallet` lost update.** The balance read is now a real row lock: `SELECT COALESCE(<whitelisted col>, 0) FROM public.users WHERE id = p_uid FOR UPDATE`, with the `UPDATE … WHERE id = $2` and the `wallet_transactions` ledger insert executing in the same transaction under that lock. Column whitelist (`coins`/`sky_diamonds`/`green_diamonds`), `p_amount <> 0`, `|p_amount| ≤ 999999`, insufficient-balance protection, admin/service authorization and the return shape are byte-for-byte preserved (no client-side read-modify-write, no fallback).
- **FIX #2 — admin-only RPC EXECUTE removal + trusted backend path.** Classification first, then:
  - **27 genuinely admin-only RPCs** revoked from `PUBLIC`, `anon` **and** `authenticated` (`REVOKE ALL` + `GRANT EXECUTE … TO service_role`, overload/name-safe loop): `admin_adjust_wallet, admin_approve_profile, admin_confirm_creator_cheat, admin_create_sponsored_match, admin_dismiss_creator_flag, admin_distribute_sponsored_prize, admin_end_current_season, admin_reject_profile, admin_revoke_referral_bonus, admin_reward_suggestion, admin_roll_battle_pass_season, admin_send_broadcast_notification, admin_send_notification, admin_set_coins, admin_set_fraud_score, admin_sync_user_balance, approve_creator_application, approve_premium, cancel_match_with_refunds, cancel_premium, correct_match_result, publish_match_results, reject_creator_application, release_eligible_commissions, resolve_sd_request, resolve_sponsored_withdrawal, set_user_ban_status`.
  - **Trusted backend path (new, no service_role key in any frontend):** Edge Function `admin-gateway` (`verify_jwt=false`; Firebase ID token verified **server-side** via Identity Toolkit → uid; the token is never decoded-and-trusted locally) → DB wrapper `admin_gateway_exec(p_fn, p_args, p_actor)` (service_role-only, re-checks `users.is_admin` for the server-derived actor, 27-name allow-list, server-injects `p_admin_uid` for `cancel_match_with_refunds`, injects the verified caller identity as transaction-local `request.jwt.claims` so sub-guarded functions keep working, binds arguments by `pg_proc` name/type) → the target RPC with the service role.
  - **Client shim** `js/r8-admin-gateway-shim.js` in **both** panels wraps `.rpc()` so the 27 names go through `functions.invoke('admin-gateway', …)`; every other RPC is untouched; `{data, error}` shape preserved; gateway failure is surfaced — there is no silent fallback to a direct client write.
  - **User-action RPCs were not touched**: join/check-in/room/clan/voucher/team/cosmetic/withdrawal-request/poll-vote/battle-pass/mission/ad-claim and `is_caller_admin()` (used by 4 RLS policies) / `f_user_public_profiles` (view backing) keep their existing grants. `increment_poll_vote` and `claim_no_show_refund` stay service-only per their earlier documented locks (R3-8 / R15).
- **FIX #3 — RLS on internal idempotency/audit tables.** `season_finalizations` and `suggestion_rewards`: `CREATE TABLE IF NOT EXISTS` + `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated` + `GRANT ALL TO service_role`. No policies are created — deny-all for clients; the `SECURITY DEFINER` writers (owner `postgres`) and `service_role` keep working.
- **FIX #4 — one clean migration.** All of the above lives in a single new file (no duplication of old migrations, idempotent, no credentials).
- **Cleanup:** the temporary role-probe function used for diagnosis is dropped (`r8_zz_role_probe` → 0 rows in `pg_proc`); synthetic test rows and probe ledger/notification/marker rows are removed (final cleanup check: 0 residue).

## 2. VERIFIED

16-point battery — every point executed live, all green (`testing/_r8d_results/verification_16pt.json`):

| # | Point | Result |
|---|---|---|
| 1 | User smoke ≥44/44 | **56/56 PASS** (fresh suite) |
| 2 | Admin smoke ≥33/33 | **59/59 PASS** (fresh suite) |
| 3 | Concurrent admin wallet adjustments — no lost update | PASS — two overlapping service-role adjustments (100 + 200 on balance 1000) → final **1300** |
| 4 | anon cannot execute admin RPCs | PASS — 27/27 `anon` EXECUTE = 0 grants; live call → `42501 permission denied` |
| 5 | Normal authenticated cannot | PASS — 27/27 `authenticated` EXECUTE = 0 grants |
| 6 | Admin JWT can | PASS — 21 live gateway probes return business responses; sub-guarded fns (`set_user_ban_status` → `user_not_found`, `cancel_match_with_refunds` → `MATCH_NOT_FOUND`) prove caller-claim injection; live-browser admin RPC shows the same |
| 7 | service_role can | PASS — service_role EXECUTE intact 27/27; rollback probes C1–C6 execute on the trusted path |
| 8 | RLS enabled on both tables | PASS — `relrowsecurity = true` both |
| 9 | Direct anon CRUD blocked | PASS — SELECT/INSERT/UPDATE/DELETE × 2 tables → `401 42501` (8 checks) |
| 10 | Season finalization exactly-once | PASS — 1st call `success:true`, 2nd → `already_finalized`; SECDEF owners still `postgres` (RLS bypass intact) |
| 11 | Suggestion reward exactly-once | PASS — credited `green_diamonds = 5` with exactly 1 marker; 2nd call → `already_rewarded` |
| 12 | Wallet ledger append-only / trusted | PASS — client credit insert blocked, inflated `pending_deposit` blocked, delete blocked (row counts unchanged); the ledger is written only inside the admin RPC |
| 13 | Join / payment / refund / team / auto-squad intact | PASS — `validate_and_join_match` (uid-mismatch + fake match), `check_in_match`, `confirm_in_room`, `redeem_voucher`, `join_clan`, `respond_team_invite`, `contribute_to_squad_bank`, `purchase_cosmetic`, `submit_sponsored_withdrawal`, `invite_team_members`, `decrement_balance` all callable and fail-closed on invalid input; live user panel works |
| 14 | Clan / notification / match-room guards intact | PASS — 12 R8 guard triggers live (incl. `trg_notifications_spoof_guard`, `trg_matches_room_secrets`, `trg_team_invitation_immutable`, `trg_users_insert_guard`, `trg_clans_*`, `trg_clamp_jr_client`, `trg_guard_users_self_update`, `trg_fft_wallet_insert_guard`); cross-user notification spoof blocked |
| 15 | No service_role key in frontend | PASS — exhaustive scan of both repos (`.js`/`.html`/`.json`, incl. base64 JWT payload decoding): zero service_role credentials |
| 16 | Source-wide financial scan | PASS — 86 client-side financial-table mutation sites catalogued and classified; **none** is a client-authoritative money write (blocked by RLS/guards, inert legacy wrappers, or self-service request rows). Firebase holds only request/status mirrors (`walletRequests` incl. UTR/status) — never balances. Chain intact: server-side authority (RPC/SECDEF) → wallet mutation → `wallet_transactions` ledger → audit triggers |

Additional executed evidence:
- **Live-browser (both panels, GitHub Pages):** admin panel loads with 0 page errors, shim active on the live client, `functions.invoke` available, in-browser `admin_adjust_wallet` returns `{success:false, error:"User not found"}` through the gateway, direct legacy path → `42501`; user panel loads with 0 page errors, admin RPC refused, user RPC (`check_in_match`) returns a normal business response.
- **Migration idempotency:** after the initial two-phase application, the full file was re-applied twice — zero errors, ACL/RLS state unchanged (anon 0 / service intact / RLS on).
- **Gateway re-probe after all re-applications:** healthy (401 without token / 403 non-admin / 200 business responses with admin token).
- **Rollback-only probes:** all exactly-once/idempotency/concurrency probes ran inside `BEGIN … ROLLBACK` or on synthetic rows that were deleted afterwards — verified zero residue (users / wallet rows / season marker all 0).

## 3. STILL OPEN

Documented, non-blocking, none of them a weakening introduced by this round:

1. **`increment_poll_vote` legacy admin-panel call site** (`admin-fixes-v23-FINAL.js:552`): the RPC stays service-only (documented lock from R3-8/R15 — it is an unguarded vote-count inflater), so that legacy call fails closed; its manual `polls` jsonb fallback was already neutralized in the prior round. Kept as-is (removing it would be a feature change).
2. **Self-service deposit annotation insert** (`user-repo/screens/wallet.js:611`) remains by design: own-row `wallet_transactions` row with `txn_type='pending_deposit'`, `currency='sky_diamonds'`, ≤ 100000, no balance authority (guarded by `fft_guard_wallet_insert`). Unchanged from the previous audit’s SAFE verdict.
3. **Three functions remain executable by `authenticated`** (`check_in_match`, `confirm_in_room`, `join_clan`) and a set of user/backend-class functions remain executable by `anon` (52 Advisor lints, all user-action class with JWT/`is_admin` guards, e.g. `increment_balance`, `increment_rank_points`, `get_room_credentials`). Classification says keep — they are the live client paths; listed here for transparency.
4. **Edge-function deploy hygiene:** during deployment an intermediate broken version (empty entrypoint) briefly served 503 and was corrected by redeploy (now `version 4`, healthy). Re-verify `admin-gateway` after any future redeploy.
5. **No destructive positive-money E2E on live data this round** (no real refunds/payouts/joins executed, by design). Positive-path evidence comes from the rollback-transaction probes (season finalization actually rewarding, suggestion reward actually crediting) plus the previous round’s positive tests; the code paths for those flows are unchanged.

## 4. SECURITY ADVISOR RESULT

Re-run after the fix (`GET /v1/projects/<ref>/advisors/security`, snapshot in `testing/_r8d_results/advisor_after.json`):

- **57 lints total:** 52 × `anon_security_definer_function_executable`, 3 × `authenticated_security_definer_function_executable`, 2 × `rls_enabled_no_policy`.
- **Anon-executable SECURITY DEFINER functions: 79 → 52.** The delta is **exactly the 27 admin-only RPCs**; **0 admin-only functions remain in the anon-executable list** (checked name-by-name against the 27).
- The 52 remaining anon-executable entries are user-action RPCs (join/check-in/room/clan/voucher/team/wallet-claims/BP/mission/ad-claims/… — identity from JWT `sub`, no cross-user mutation, no trusted client amounts) — intentionally kept.
- The 3 `authenticated`-executable entries are the same legit user RPCs (`check_in_match`, `confirm_in_room`, `join_clan`).
- The 2 `rls_enabled_no_policy` lints are **our two internal tables** (`season_finalizations`, `suggestion_rewards`) — expected: RLS on, no client policies, deny-all by design (this is the FIX #3 state, not a defect).
- Note: the goal was correct access control, not a green count — the remaining lints are the documented user-action class.

## 5. MIGRATION NAME/VERSION

- **Migration (single, consolidated):** `sql and developer guide/2026-09-26d-R8-FINAL-DB-HARDENING.sql`
  - **Applied status:** applied in two phases (phase 1 = wrapper + FIX #1 + REVOKE/GRANT of the wrapper; phase 2 = FIX #2b revoke loop + FIX #3), then **re-applied twice in full** as one script — 0 errors, idempotent.

> **Merge note (2026-09-26, later round):** this migration was merged into `COMPLETE_SCHEMA.sql` v33 §60 and the standalone file deleted; its history is recorded in `supabase_migrations.schema_migrations` as `20260926000004 r8_final_db_hardening_merged_into_complete_schema_v33`. See DEVELOPER_GUIDE.md §61.
  - Contents: FIX #1 row lock · FIX #2a `admin_gateway_exec` · FIX #2b 27-function EXECUTE cleanup loop · FIX #3 `CREATE TABLE IF NOT EXISTS` + `ENABLE ROW LEVEL SECURITY` + grants/revokes · read-only sanity SELECT. No secrets/credentials.
- **Edge Function:** `admin-gateway` (id `7fd35b96-4839-4e35-8637-c3797d009a3d`, slug `admin-gateway`, `verify_jwt=false`, deployed **version 4**).
- **Client:** `js/r8-admin-gateway-shim.js` (both panels), loaded after the supabase-js UMD/compat layer (admin) / before `core/db.js` (user); admin repo HEAD `4213dca`, user repo HEAD `fb3317b`.

## 6. USER SMOKE RESULT

**56 / 56 PASS** (requirement ≥ 44/44) — fresh suite `testing/r8d_user_smoke.py`, raw output `testing/_r8d_results/user_smoke.json`.
Coverage: 11 live-transport read paths (users/wallet/matches/join_requests/notifications/clans/suggestions/match_results/public-profiles/sd_requests) · 8 guard checks (direct coins/is_admin/is_banned writes blocked, cross-user write blocked, wallet credit + inflated deposit + ledger delete blocked, cross-user notification spoof blocked — all with before/after value or row-count proof) · 14 fail-closed RPC probes + 2 documented service-only refusals · 4 grant checks (19/19 user-action RPCs anon-executable; admin-only = 0; direct + gateway refusal for non-admin) · 8 RLS direct-CRUD checks + server-side idempotency path intact · 2 no-service_role-credential scans · 6 live-browser checks on the user panel.
Note: the previous round’s 44-check script was not present in the workspace, so a fresh equivalent suite was built and executed (this is stated for transparency; the counts above are the executed, reproducible numbers).

## 7. ADMIN SMOKE RESULT

**59 / 59 PASS** (requirement ≥ 33/33) — fresh suite `testing/r8d_admin_smoke.py`, raw output `testing/_r8d_results/admin_smoke.json`.
Coverage: 17 catalog/structure checks (27/27 anon + authenticated revoked, service intact, wrapper ACL + `search_path`, FIX #1 body markers, guards on all 27, RLS + deny-all + ownership) · 26 gateway-transport checks (401 no/garbage token, 403 non-admin, 400 non-allow-listed/missing fn, 21 admin-panel RPCs reachable with business responses, bogus column rejected, legacy direct path refused `42501`) · 8 rollback-only probes (season exactly-once, suggestion reward exactly-once with 1 marker + correct credit, `release_eligible_commissions`, `admin_create_sponsored_match`, FIX #1 concurrency 1000+100+200=1300 no lost update, residue cleanup) · 6 live-browser checks on the admin panel (load, shim active, `functions.invoke`, gateway round-trip, legacy path refusal).
Note: as with the user suite, the previous round’s 33-check script was not recoverable, so this fresh suite defines the executed 59/59.

## 8. FINAL STATUS

**READY**

All four fixes are applied to the live database and verified by executed tests: wallet row-lock (no lost update), admin-only RPC EXECUTE removed for anon+authenticated with the Admin Panel working through the trusted `admin-gateway` path (no service_role key in any frontend), RLS enabled with deny-all on both internal tables, and one idempotent migration file. Smokes: **admin 59/59**, **user 56/56**. Advisor confirms zero admin-only functions remain anon-executable. The residuals in §3 are documented, pre-existing/by-design, and non-blocking.
