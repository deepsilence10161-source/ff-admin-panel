# R8 FINAL — FOLLOW-UP ROUND REPORT (2026-09-26)

Scope of this round: **P0** migration-history sync · **P1** `leaveClan()` canonical-RPC-only ·
**P2** `_doCreateClan` self-heal variable-order bug · **schema consolidation** (merge all delta
files into `COMPLETE_SCHEMA.sql`, delete the deltas) · **full live panel testing of both panels**.

---

## 1. FIXED

**P0 — migration history sync (was stuck at `20260920045314`).**
The live database carried all hardening through R8, but `supabase_migrations.schema_migrations`
stopped at `20260920045314 add_users_self_update_column_guard`. **All 64 migrations that had been
applied but never recorded are now inserted** — history **105 → 169 rows**, newest
`20260926000004 r8_final_db_hardening_merged_into_complete_schema_v33`. Each row is explicitly
named `*_merged_into_complete_schema_v33`, stores the original file's sha256 + full SQL in
`statements`, is idempotent (`ON CONFLICT (version) DO NOTHING`) and reversible
(`DELETE … WHERE name LIKE '%_merged_into_complete_schema_v33'`).

**Schema consolidation — one single source of truth.**
All **64 delta/migration files** (`2026-08-22-SESSION-DELTA.sql` … `2026-09-26d-R8-FINAL-DB-HARDENING.sql`)
were merged into **`COMPLETE_SCHEMA.sql` v33 §60** and **deleted**. The folder now holds exactly
`COMPLETE_SCHEMA.sql` (~1.29 MB, 22,698 lines), `DEVELOPER_GUIDE.md`, `R8_FINAL_REPORT.md`.
§60 (5,927 lines) was generated **from the live database** — missing tables/columns, 21 final
function bodies, 6 R8 guard triggers, 139 indexes, 216 policies, RLS on all 106 tables,
260 guarded constraints, sequences, views and the exact table/column privilege state — so the
single file reproduces live exactly. Proven by applying it to the live DB and comparing a
full-schema fingerprint before/after: **identical (idempotent)**.

**P1 — `leaveClan()` (user panel): canonical RPC is the sole authority.**
The direct-Supabase fallback (`clan_members.delete()` → `users.update({clan_id:null})`) is removed;
`leave_clan` is the only path, its `{ok:false}`/error contract is handled, and an RPC failure now
changes nothing locally. (Commit `2f2d062`.)

**P2 — `_doCreateClan` self-heal variable-order bug.**
The orphaned-pointer self-heal ran `.eq('id', uid)` **before** `var uid = _uid();` was declared —
var-hoisting made `uid` `undefined`, so the heal silently did nothing (exactly the lockout it was
written to prevent). `uid` is now declared first; `joinClan`'s heal normalised the same way.
(Commit `2f2d062`.)

**Defects found by the new deep live-flow sweep and fixed in the same pass:**

1. **Trusted gateway could not pass jsonb arguments.** `admin_gateway_exec` emitted
   `"p_results" => $1` (the whole args object) for any `jsonb` parameter, so
   **`publish_match_results` was completely unreachable through the R8 trusted path**
   (“p_results must be an array”). Fixed to `($1 -> 'p_results')`, and array-typed parameters are
   now converted via `jsonb_array_elements_text` with an element cast (empty-array safe).
2. **Clan counter drift — `join_clan` was not idempotent for the leader.** The creator/leader is
   counted in `clans.total_members` **without** a `clan_members` row, so a leader re-join inserted
   a row and bumped the counter again. Both overloads now treat leader = already a member and the
   counter is **count-exact** (`rows + (leader row-less ? 1 : 0)`) instead of a blind `+1`;
   `leave_clan` recomputes the same way (never negative, retry-safe). One-time data repair applied.
3. **Clan leader could not earn clan score / contribute to the squad bank** —
   `increment_clan_score` and `contribute_to_squad_bank` gated on a `clan_members` row the leader
   doesn't have. Leader now counts as a member in both; every other guard untouched
   (caller == `p_uid`, amount validation, `FOR UPDATE` lock order, balance check).

**Edge function rebuilt/redeployed.** The deployed `admin-gateway` edge function was returning
`503 BOOT_ERROR` (its bundle was replaced by the platform with an empty `entrypoint_path`).
It was re-deployed through the official deploy flow at its canonical slug and re-verified.

`COMPLETE_SCHEMA.sql` §60 was regenerated after every fix, so the single file carries them all.

## 2. VERIFIED

| Check | Result |
|---|---|
| `COMPLETE_SCHEMA.sql` §60 applied to live | **2054/2054 statements OK** |
| Schema fingerprint before vs after applying the file | **identical** (11 categories incl. raw relacl/attacl) |
| Column-privilege fidelity of the merge | 165/165 triples restored, 453 total, **0 privileges lost** |
| Concurrent admin wallet adjustments (8 parallel `+1`) | coins **+8 exactly**, 8/8 accepted, **8 ledger rows** (row lock proven) |
| Admin-only RPCs reachable via trusted gateway | **27/27** |
| EXECUTE matrix on an admin RPC | anon **✗** · authenticated **✗** · admin via gateway **✓** · service_role **✓** |
| RLS on `season_finalizations` + `suggestion_rewards` | enabled, **0 policies** (deny-all); SECDEF/service paths still work |
| Direct anon CRUD on both internal tables (SELECT/INSERT/UPDATE/DELETE ×2) | all **blocked** |
| Suggestion reward exactly-once | first `{success:true}` credits once; second → `already_rewarded` |
| Match results publishing (end-to-end) | gateway publish `{ok:true, players:1, winners:1}`; winner credited 65 (rank 50 + 3×5); ledger row written; **re-publish does not double-credit** |
| Match lifecycle join→check-in→room→results | join RPC + slots, duplicate-join blocked, foreign-uid blocked, check-in window, own-join-only room confirm |
| Join/payment/refund/team/auto-squad protections | invite → accept → foreign-invite refused; team joins fail-closed; guards intact |
| Clan lifecycle (create→join→duplicate→leader re-join→leave→double-leave) | counter == truth at **every** step |
| Squad-bank contribution (real money round-trip) | GD 16→14, bank 0→2, ledger `green_diamonds/debit/squad_bank_contribution/approved`, contributor jsonb shape intact, data reverted |
| Wallet guard probes (voucher/ad/BP/mission/referral/commission, foreign-uid increment/decrement) | all fail-closed, **no balance or ledger change** |
| Notification spoof guard + broadcast via gateway | cross-user & self-fabrication blocked; admin broadcast writes rows; own mark-as-read works; re-targeting blocked |
| Deep live-flow suite (profile, wallet, match, team, clan, notifications, premium, suggestions, leaderboard, admin surface) | **79 PASS / 0 FAIL** |
| Both live panels in a real browser (login, client init, gateway shim, admin-RPC routing, user-RPC routing) | all green (user F1–F6, admin D1–D6) |
| service_role credential scan of both panels | none found |
| Test hygiene | all synthetic rows deleted, qa1/qa2 balances restored byte-for-byte |

## 3. STILL OPEN

- The legacy **3-argument `join_clan` overload** cannot be disambiguated by PostgREST if a client
  sends exactly three keys (PGRST203). The live panel sends four keys
  (`p_ign`, `p_max_members`), which resolves uniquely to the current overload — so the shipped
  path is unaffected. Left in place deliberately to preserve signature compatibility; it can be
  dropped in a later cleanup if you want the ambiguity gone.
- Security-advisor items **52 anon + 3 authenticated SECURITY DEFINER functions** remain *by
  design* (they are the classified user-action/self-service RPCs; the platform maps Firebase JWTs
  to the `anon` role, so revoking them would break the app). Each was verified to derive identity
  server-side from `auth.jwt()`, reject foreign-uid calls, and compute money server-side.
- The 2 advisor `rls_enabled_no_policy` notices are the **intentional deny-all** internal tables
  (exactly what the “no anon/authenticated CRUD” requirement asks for).
- Browser verification covers the panel smoke sections (load, client init, gateway shim, RPC
  routing) — it is not an exhaustive click-through of every screen in both UIs.
- No trusted backend exists in either repo other than the deployed `admin-gateway` edge function;
  any future admin feature needing server-side secrets must go through that same path.

## 4. SECURITY ADVISOR RESULT

Live advisor (`/advisors/security`): **57 lints** —
`anon_security_definer_function_executable` **52** (all classified user-action/self-service RPCs),
`authenticated_security_definer_function_executable` **3** (`check_in_match`, `confirm_in_room`,
`join_clan` — user-action), `rls_enabled_no_policy` **2** (`season_finalizations`,
`suggestion_rewards` — the intentional deny-all internal tables).
**Admin-only RPCs still anon-executable: 0.** No unclassified executable function remains.

## 5. MIGRATION NAME / VERSION

**`20260926000004` — `r8_final_db_hardening_merged_into_complete_schema_v33`**
(recorded in `supabase_migrations.schema_migrations`; history now has **169** rows,
newest entry as above). The consolidated, re-runnable schema is **`COMPLETE_SCHEMA.sql` v33**
(section 60), which is idempotent — verified by applying it live twice with an identical
fingerprint. No service_role key or credential is present in any SQL.

## 6. USER SMOKE RESULT

**56 PASS / 0 FAIL** (target ≥ 44/44) — reads, direct-write negatives, fail-closed RPC negatives,
grant-level checks, RLS direct-CRUD blocks, service_role credential scan, and live browser checks.

## 7. ADMIN SMOKE RESULT

**59 PASS / 0 FAIL** (target ≥ 33/33) — ACL/structure, gateway transport (27/27), rollback &
concurrency (FIX#1 row lock), and live browser checks.

## 8. FINAL STATUS

**READY**
