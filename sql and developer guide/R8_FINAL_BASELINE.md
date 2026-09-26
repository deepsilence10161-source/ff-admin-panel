# R8 FINAL — FROZEN BASELINE (evidence lock)

**Frozen:** 2026-09-26 17:20 UTC · **Repos:** admin `6b62db4` · user `d277934` (both pushed) · **Schema:** `COMPLETE_SCHEMA.sql` v33 (single source of truth)
**Status: READY** — every line below is backed by an artifact in this table.

## 0. Frozen artifacts (sha256, first 16 hex)

| Artifact | sha256 | Result |
|---|---|---|
| `_r8d_results/user_smoke.json` | 38adf93ba88b99ab | 56 PASS / 0 FAIL (User16 acceptance) |
| `_r8d_results/admin_smoke.json` | be5a57c827881e27 | 59 PASS / 0 FAIL (Admin17 acceptance) |
| `_r8d_results/flow_suite.json` | a09b638f51c6ca09 | 79 PASS / 0 FAIL (deep flow sweep) |
| `_r8e_results/adversarial.json` | b74f1390b67097bf | 17 PASS / 0 FAIL (race suite) |
| `_r8e_results/classification.json` | e3b4e2e6dbddef47 | 52 SECDEF fns classified + probed |
| `_r8e_results/authorization_evidence.json` | fe913597d7943ace | items 1/2/3 live probes (amounts, 3 auth RPCs, RLS) |
| `_r8e_results/pending_deposit_evidence.json` | 185ce6592603f590 | item 5 (no financial authority) |
| `_r8e_results/payout_gateway_evidence.json` | 003429c6627f8892 | items 6+7 (gateway health, entry/prize/refund) |
| `_r8e_results/commission_cycle.json` | 0948c3000b612171 | item 7 commission cycle |
| `_r8e_results/secrets_scan.json` | 02a0c673d215615e | 195 files · service_role JWTs 0 |
| `_r8d_results/advisor_final.json` | 25f4fd6f60361f01 | live Security Advisor: 57 lints |

## 1. ADMIN17 — admin panel baseline

| # | Area | Status | Evidence |
|---|---|---|---|
| 1. Admin auth + gateway transport | **PASS** | admin smoke A1–A3, B6–B26, D1–D6 · flow J1–J6 · item6 health 27/27, no-token 401 / non-admin 403 / unknown-fn 400 |
| 2. Player lookup + profile actions | **PASS** | gateway reachability (flow J1 27/27) · approve/reject profile guards intact · fa14/fa24 admin_set_coins via gateway |
| 3. Wallet adjust + ledger integrity | **PASS** | flow B11–B12 (8× concurrent +1 → +8 exact, 8 ledger rows) · admin smoke C7 (100+200=1300) · item6 wallet round-trip |
| 4. Deposit (SD) resolution | **PASS** | item5: resolve credits SD + ledger (70→75), double-resolve refused, self-approve blocked at RLS |
| 5. Withdrawal resolution (sponsored / GD) | **PASS** | flow B6 + race R6 (4× parallel never over-balance) · resolve_sponsored_withdrawal reachable via gateway |
| 6. Match management (create/publish/correct/cancel+refund) | **PASS** | flow C11–C16 (publish OK, non-admin 401, no double-credit) · item7 7.5 refund credited + join status refunded |
| 7. Team / auto-squad admin surface | **PASS** | flow D1–D5 (invite → accept → foreign refused) · auto-squad RPCs callable, fail-closed on bad payload |
| 8. Clan admin surface + counter integrity | **PASS** | flow E1–E11 · counter drift fix verified (create/join/dup/leader/leave/double-leave) · DB counter_mismatch = 0 |
| 9. Creator system (applications, flags, cheats, videos) | **PASS** | all creator admin RPCs reachable via gateway (flow J1) · client calls refused 401 (ACL) |
| 10. Commissions (accrue → release → payout) | **PASS** | item7 8.1–8.5 full cycle: 15% hold 1.50 inr → release via gateway → claim → payout row → double-claim refused → reverted |
| 11. Growth / referrals / mentor | **PASS** | admin_revoke_referral_bonus reachable · apply_referral_code fail-closed (flow B6) · award_mentor_reward ignores client amount (item1 1.11) |
| 12. Notifications (send / broadcast) | **PASS** | flow F4–F5 (broadcast via gateway writes rows) · spoof guard blocks client inserts (F2–F3) |
| 13. Season / battle-pass admin | **PASS** | season finalization exactly-once (admin C1–C2) · admin_roll_battle_pass_season + admin_end_current_season reachable via gateway |
| 14. Suggestions / polls admin | **PASS** | flow H2–H5 (reward exactly-once) · item4: poll vote path now canonical cast_poll_vote (dead RPC + client count-write removed) |
| 15. Fraud control + smart tools (fa28, fa44–52, fa63–70) | **PASS** | all reachable via gateway; ACL layer denies direct client calls |
| 16. Automation / security patches | **PASS** | security-patches.js + bundles route through gateway · revoked fns refused 42501 at DB (admin smoke D6) |
| 17. Admin browser + client integrity | **PASS** | admin smoke D1–D6 (page loads, client init, shim active, gateway JSON, legacy path refused) |

## 2. USER16 — user panel baseline

| # | Area | Status | Evidence |
|---|---|---|---|
| 1. Auth + profile self-update guard | **PASS** | flow A1–A4 (allowed col works, ign self-update blocked) |
| 2. Wallet read + balances | **PASS** | flow B1–B2 · item1: no unauthorized wallet/RP/ledger movement across all probes |
| 3. Deposit request (pending self-row) | **PASS** | item5 5.1–5.5 (own pending only; self-approve/foreign-uid/status-flip blocked; no balance effect) |
| 4. Sponsored withdrawal | **PASS** | race R6/R6b (never over-balance, exactly 2 of 4 accepted, pending_sum 80 ≤ 100) |
| 5. Match join + entry fee | **PASS** | flow C2–C6 · item7 7.1 (10 coins debited, ledger match_entry) · race R1 (6× join → 1 row, slots=1) |
| 6. Check-in + room credentials | **PASS** | flow C7–C10 · item2 2.1–2.6 (own OK, foreign refused, no-JWT refused) · room-secret guard intact |
| 7. Teams + invitations | **PASS** | flow D1–D5 · race-free invite → accept; foreign invite answered by others refused |
| 8. Auto-squad | **PASS** | join_auto_squad_queue + form_auto_squad_team callable, guarded (no client economy write) |
| 9. Clan (create/join/leave/score/bank) | **PASS** | flow E1–E11 · item2 2.7–2.11 · counter fix + leader membership fix · race R2 (5× join → 1 membership) |
| 10. Notifications | **PASS** | flow F1–F7 (own read, mark-read works, spoof/retarget blocked) |
| 11. Premium / free trial | **PASS** | flow G1–G3 (trial once, self-approve premium blocked 401, tier unchanged) |
| 12. Missions / battle pass / streak / ad reward | **PASS** | item1 1.2 (XP bounds), 1.3 (mission config gate), 1.5 (check-in uses server rewards), 1.6 (tier claim season-gated) · flow B10 (ad reward server-computed) |
| 13. Leaderboard / rank points | **PASS** | flow I1–I4 · item1 1.1 (rank cap 500/call + 2000/day enforced, no change on inflated input) |
| 14. Suggestions / polls | **PASS** | flow H1–H5 · item1 1.4 (reward uses server config, stale_period refusal) · poll vote canonical RPC |
| 15. Referrals / vouchers / cosmetics | **PASS** | race R5 (4× redeem max_uses=1 → exactly 1) · item1 1.7/1.8 (forged price/cost refused) · flow B5 (bogus code) |
| 16. Security guards (wallet insert, spoof, room secrets, deny-all RLS) | **PASS** | flow B8–B9, F2–F3 · user smoke D32–D39 (anon CRUD blocked on both internal tables) · item3 RLS state |

## 3. Live database + migrations

| Metric | Value |
|---|---|
| users / matches / join_requests / wallet_transactions / clans | 6 / 43 / 18 / 111 / 0 |
| negative wallets · clan counter mismatches · duplicate active joins | 0 · 0 · 0 |
| test residue (matches/clans/suggestions/vouchers/creator codes) | **0** |
| RLS enabled | **106/106 tables** · 216 policies · 17 triggers |
| migrations recorded | **169 rows**, newest `20260926000004 r8_final_db_hardening_merged_into_complete_schema_v33` |
| schema idempotency | apply-twice fingerprint `60fb6e6fd4020e28` identical (11 categories) |

## 4. Advisor + classification (frozen)

* 57 lints: 52 anon-SECDEF + 3 authenticated-SECDEF (same user-action fns) + 2 `rls_enabled_no_policy` — **all classified**, mapping in `SECURITY_DEFINER_CLASSIFICATION.md`.
* **Admin-only functions with anon EXECUTE: 0** (27/27 revoked; trusted-path only).
* Probes: 52/52 anon-blocked, 13/13 impersonation-blocked, side-effect delta across sweep = NONE.

## 5. Adversarial / race (frozen)

R1 join · R2 clan join · R3 publish (exactly-once) · R4 suggestion reward (exactly-once) · R5 voucher `max_uses=1` ·
R6 withdrawal over-balance · R7 squad-bank overspend · R8 check-in idempotency · R9 negative-balance floor ·
R10/R11 cleanup + byte-identical balance restore → **17/17 PASS**.

## 6. Money-path evidence (positive flows, QA accounts, all reverted)

| Flow | Result |
|---|---|
| Entry debit | 10 coins debited, ledger `match_entry` (debit) |
| Prize payout | +15 coins, ledger `match_win/match_prize`, `match_results.prize_earned=15` |
| Refund (admin cancel) | +10 coins, ledger `match_cancelled_refund`, join status `refunded`, `refund_count=1` |
| Creator commission | paid join → `1.50 inr` hold (`eligible_at +7d`, 15% `sdMatchCommissionPct`) → release via gateway → `eligible` → claim → `pending_payout` + `creator_payouts` row → double-claim refused |
| Squad bank | leader contributes 2 GD → GD 16→14, bank 0→2, ledger `squad_bank_contribution`, contributor jsonb shape intact |
| Suggestion reward | +25 once via gateway, 2nd call `already_rewarded` |
| Voucher | 4× parallel redeem `max_uses=1` → exactly 1 success, +5 once |
| Sponsored withdrawal | 4× parallel (100 balance, 40 each) → exactly 2 accepted, pending 80 ≤ 100 |

## 7. Legacy / dead code cleanup (frozen)

| Call-site | Action | Why |
|---|---|---|
| `admin-fixes-v23-FINAL.js` → `increment_poll_vote` | **removed** — now canonical `cast_poll_vote` | RPC is service_role-only (always 42501); its fallback wrote `polls.vote_counts` from the client = double-count hazard |
| `core/db.js` → `users.setBan` | **removed** (zero callers) | called service-only `set_user_ban_status`; admin banning goes through the gateway |
| `core/db-bridge.js` → `matches/<id>/joinedSlots` | **explicit no-op** | called service-only `increment_match_filled_slots`; slots are authoritative in `validate_and_join_match` |
| Admin panel's 46 other service-only call-sites | **kept (live)** | routed through `admin-gateway` by the R8 shim — verified working (admin smoke D5) |

## 8. Gateway (frozen health)

* slug `admin-gateway` · id `5b72e5dc-bf91-4f50-bdc0-d4bf4f93990d` · ACTIVE · `verify_jwt=false` · deployed bundle contains `admin_gateway_exec` + `fn_not_allowed` (verified by fetching the bundle by id; the slug-based GET returns an empty view after the rename).
* **27/27 admin RPCs reachable** · latency min/median/max = 528 / 594 / 1555 ms · no-token **401** · non-admin **403** · unknown fn **400** · wallet +1/−1 round-trip verified then reverted.

## 9. FINAL STATUS

**READY** — all 8 remaining items closed with executed, non-fabricated evidence; repos pushed (admin `6b62db4`, user `d277934`);
live DB residue 0, zero negative balances, zero counter mismatches, zero duplicate joins.
