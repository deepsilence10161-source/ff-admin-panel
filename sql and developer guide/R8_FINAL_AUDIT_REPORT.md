# R8 FINAL — AUDIT REPORT (evidence lock)

**Generated:** 2026-09-26 14:22 UTC  ·  **Scope:** both panels + live Supabase database
**Repos:** admin `63b9578` · user `2f2d062` (both pushed)  ·  **Schema:** `COMPLETE_SCHEMA.sql` v33 (1,291,439 bytes)

Every number below is read from the artifact next to it — nothing is asserted without a file.

## 0. Evidence index (sha256 of the raw artifact, first 16 hex)

| Artifact | sha256 | Result inside |
|---|---|---|
| `_r8d_results/user_smoke.json` | 3cda3aecbc4ba2fb | **56 PASS / 0 FAIL** (User15-format acceptance, ≥44 target) |
| `_r8d_results/admin_smoke.json` | 428d0d0d79a7ebf7 | **59 PASS / 0 FAIL** (Admin16-format acceptance, ≥33 target) |
| `_r8d_results/flow_suite.json` | a09b638f51c6ca09 | **79 PASS / 0 FAIL** deep feature-flow sweep (profile→wallet→match→team→clan→notifications→premium→suggestion→leaderboard→admin) |
| `_r8e_results/adversarial.json` | b74f1390b67097bf | **17 PASS / 0 FAIL** race/adversarial suite |
| `_r8e_results/classification.json` | e3b4e2e6dbddef47 | 52 SECDEF functions individually classified + probed |
| `_r8e_results/secrets_scan.json` | 02a0c673d215615e | 195 frontend files scanned · service_role JWTs: **0** |
| `_r8e_results/db_consistency.json` | 8f6bf855af56994d | live DB invariants (below) |
| `_r8e_results/residue_cleanup.json` | d0fc5dfa5f1722ab | post-test residue: all zero |
| `_r8d_results/fingerprint_pre5.json` / `fingerprint_post5.json` | 408dff6dc5995d6d / 3bd5eb648cb07394 | schema idempotency (11 categories) |
| `_r8d_results/advisor_final.json` | 25f4fd6f60361f01 | live Security Advisor: 57 lints |

## 1. Acceptance suites (fresh lock, this round)

| Suite | Result | Target | Notes |
|---|---|---|---|
| User panel acceptance | **56 PASS / 0 FAIL** | ≥44/44 | reads, direct-write negatives, fail-closed RPC negatives, grant-level, RLS direct-CRUD, secret scan, **live browser** (F1–F6) |
| Admin panel acceptance | **59 PASS / 0 FAIL** | ≥33/33 | ACL/structure, gateway transport (27/27), rollback + concurrency, **live browser** (D1–D6) |
| Deep feature-flow sweep | **79 PASS / 0 FAIL** | — | full end-to-end flows, synthetic data, self-cleaning |
| Adversarial / race suite | **17 PASS / 0 FAIL** | — | see §3 |

## 2. Security posture (live DB)

* Advisor: 52 anon-SECDEF (all classified, §4),
  3 authenticated-SECDEF (same 3 user-action fns),
  2 `rls_enabled_no_policy` (intentional deny-all).
  **Admin-only functions with anon EXECUTE: 0.**
* RLS: **106/106 public tables** have RLS enabled · 216 policies · 17 public triggers · 100 SECURITY DEFINER functions (each either classified client RPC or server-only).
* EXECUTE matrix (admin RPC): anon ✗ · authenticated ✗ · admin-via-gateway ✓ · service_role ✓.
* Migrations: **169 rows** in `supabase_migrations.schema_migrations`, newest
  `20260926000004 r8_final_db_hardening_merged_into_complete_schema_v33`.
* Schema idempotency: apply-twice fingerprint pre **`60fb6e6fd4020e28`** vs post **`60fb6e6fd4020e28`** → **IDENTICAL across all 11 categories**.

## 3. Adversarial / race evidence (every case real concurrency, invariant read from the DB)

| # | Attack | Invariant asserted | Result |
|---|---|---|---|
| R1 | 6× parallel match join (same user) | exactly 1 `join_request`, `filled_slots`=1 | PASS |
| R2 | 5× parallel clan join (same user) | exactly 1 membership, counter exact (=2 with leader) | PASS |
| R3 | 3× parallel results publish | prize credited **exactly once**, 1 `match_prize` ledger row | PASS |
| R4 | 4× parallel suggestion reward | +25 once, 1 marker, 3× `already_rewarded` | PASS |
| R5 | 4× parallel voucher redeem (max_uses=1) | 1 success, 1 redemption row, `used_count`=1, +5 once | PASS |
| R6 | 4× parallel withdrawal (100 bal, 40 each) | pending sum 80 ≤ 100 (never over-balance) | PASS |
| R7 | 4× parallel squad-bank spend (16 GD, 6 each) | exactly 2 accepted, GD 16→4, bank 12, 2 debit rows | PASS |
| R8 | 3× parallel check-in | idempotent, single effect | PASS |
| R9–R11 | wallet floor + cleanup + balance restore | no negative balance; residue 0; balances byte-identical to baseline | PASS |

## 4. SECURITY DEFINER classification (see `SECURITY_DEFINER_CLASSIFICATION.md`)

52 flagged functions individually verified — static ACL/body facts + live impersonation probe
(qa2 passing qa1's uid) + no-JWT probe. **All 52 blocked; side-effect delta across the entire
sweep = NONE.** Buckets: 37 user-action self-service ·
7 user-action domain ·
8 restricted (service/role-gated).
Full per-function table + advisor mapping in the companion document.

## 5. Secrets / credential posture (no secret value is printed anywhere in these reports)

| Check | Result |
|---|---|
| Frontend files scanned (both panels) | **195** |
| JWTs found in frontend sources | **4** — all role=**anon** (public by design), iss=supabase |
| `service_role` JWTs in frontend | **0** |
| Paytm merchant key / OpenAI / Slack / GitHub / private keys in frontend | **0** |
| Google API keys found | 4 — expected Firebase web config (public, not a secret) |
| `service_role` mentions | 15 — all in edge-function code reading `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` or documentation comments; **no value** |
| Payment path | `paytm-create-order` / `paytm-callback` edge functions only (`js/paytm-checkout.js` invokes them); keys live in edge-function env |
| Media/push path | `imgbb-upload`, `push-send` edge functions |
| Admin path | `admin-gateway` edge function (service_role env; re-checks `users.is_admin`) |
| `app_settings` keys | 11 keys — none secret-looking (no paytm/token/key/secret keys) |

**Documented policy (final):** the Paytm merchant keys, the Supabase **service_role** key and any other
server credential **stay server-side only** (Supabase edge-function environment variables). The frontend
intentionally contains only the public `anon` key and the Firebase web config. There is nothing to "fix"
in the frontend — the posture was audited and is correct; every frontend call that needs privileged work
goes through an edge function which re-verifies identity/role in the database.

## 6. Live DB integrity snapshot

| Metric | Value |
|---|---|
| users / clans / clan_members | 6 / 0 / 0 |
| matches / join_requests / wallet_transactions | 44 / 20 / 114 |
| negative wallets | **0** |
| orphan clan_members / dangling users.clan_id | 0 / 0 |
| clan counter mismatches | **0** |
| duplicate active joins (same user+match) | **0** |
| orphan match_results | 0 |
| test residue after cleanup (matches/clans/suggestions/notifications/vouchers) | **0** |

## 7. Standing guarantees (unchanged, re-verified this round)

* Wallet mutation chain: **server RPC → wallet column update (row-locked) → `wallet_transactions` ledger row → audit trail**;
  no client-side read-modify-write, no Firebase-authoritative economy, no silent fallback on RPC failure.
* 27 admin-only RPCs: not anon/authenticated callable; reachable via `admin-gateway` (admin JWT verified) or `service_role`.
* RLS + deny-all on `season_finalizations` / `suggestion_rewards`; exactly-once finalization and suggestion rewards.
* Guard triggers intact: wallet insert guard, users insert/self-update guard, clan insert/update guards,
  notification spoof guard, match room-secret guard.
* Join / payment / refund / team / auto-squad / clan / notification / match-room protections intact.

## 8. FINAL STATUS

**READY** — all acceptance + flow + race + classification evidence regenerated fresh this round,
repos pushed (admin `63b9578`, user `2f2d062`), zero residue on the live database.
