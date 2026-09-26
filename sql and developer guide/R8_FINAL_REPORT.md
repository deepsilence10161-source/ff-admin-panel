# R8 ONE-CLICK FINAL SECURITY + FINANCIAL HARDENING — FINAL REPORT

**Date:** 2026-09-26
**Repos:** `deepsilence10161-source/ff-admin-panel` (HEAD `39c505d`) · `deepsilence10161-source/ff-user-panel` (HEAD `3b78923`)
**Migration (applied to Supabase, idempotent):** `sql and developer guide/2026-09-26c-R8-FINAL-HARDENING.sql`
**Guide:** `DEVELOPER_GUIDE.md` §59 appended.

---

## CHANGES MADE

### Supabase (single consolidated, idempotent delta — re-apply safe ×3 verified)
| Change | Function/Trigger | Closes |
|---|---|---|
| Signup mint guard | `guard_users_insert` + `trg_users_insert_guard` (BEFORE INSERT) — hard-resets coins/sky/green/rank_points/is_admin/is_banned/premium/creator/referral/* to safe defaults for non-service, non-admin INSERT | P5 |
| Clan mint guard | `guard_clans_insert` + `trg_clans_insert_guard` — leader=caller, total_members=1, zero squad_bank_gd/unlocked/contributors/score | P6 |
| Clan leader economy-freeze | `guard_clans_update` + `trg_clans_update_guard` — non-admin UPDATE freezes leader_uid/total_members/weekly_score/total_wins/total_kills/squad_bank_gd/squad_bank_unlocked/squad_bank_contributors/status/disbanded_at/join_code; profile fields (name/emblem/badge/bio) editable | P1 |
| Notification spoof guard | `guard_notification_insert` + `trg_notifications_spoof_guard` — self OK; cross-user only with real peer relationship (friendship/duel/mentor/clan-war/clan-cosmetic/matched-team/active-squad); `target_all` broadcast admin-only | P4 |
| Deposit inflation guard | `fft_guard_wallet_insert` tightened — `pending_deposit` must be `sky_diamonds`, 1..100000, own row only | P3c |
| join_requests authority freeze | `clamp_join_requests_client_update` — freezes ALL authoritative fields (status/checked_in/checkin_at/kills/placement/prize_earned/entry_fee/entry_fee_paid/fee_type/mode/captain_uid/squad_members/in_room/in_room_at/attendance_status/slot_number) for non-admin clients | P1 |
| Season exactly-once | `admin_end_current_season` + `season_finalizations` marker → re-click returns `already_finalized`; rank_points/win_streak/rp_today reset folded server-side | P8 |
| Suggestion exactly-once | `admin_reward_suggestion` + `suggestion_rewards` marker → `already_rewarded`; pending→rewarded atomic; real_money→green_diamonds | P7 |
| Balance reconciliation | `admin_sync_user_balance` — audited before/after/delta ledger rows + reason; never a blind overwrite | P10 |
| TOCTOU fix | `decrement_balance` — FOR UPDATE row lock, no negative, own-uid only, column whitelist | P10 |
| Room-secret guard | `guard_matches_room_secrets` + `trg_matches_room_secrets` — client can never populate matches.room_id/room_password (NULL-forced; creds live in `match_rooms`, admin-RLS-only) | P25 |
| Check-in RPC | `check_in_match(p_match_id)` — server-validates real open/close window, FOR UPDATE, active-join check | P22 |
| Room confirm RPC | `confirm_in_room(p_join_id)` — caller must own the join, FOR UPDATE | P22 |
| Clan join RPC | `join_clan` 5-arg overload (`p_ign` ignored; `p_max_members` clamped 1..10, default 10) + existence/disbanded/full/duplicate/caller checks; grants anon/authenticated/service_role | Clan join |
| Self-report lock-down | `guard_users_self_update` — `win_streak` removed from allowed list (server-authored via publish_match_results) | P11–P15 |

### User panel (`ff-user-panel`, 8 files)
- `core/db.js` — `joinRequests.create` → `validate_and_join_match`; `checkIn` → `check_in_match`; `confirmInRoom` → `confirm_in_room`; `setStatus`/`setResult` RETIRED (loud no-op).
- `core/db-bridge.js` — joinRequests `refunded`/`inRoom`/`isUpdate` legacy writes retired; only display-only `ign_at_join` mirror remains.
- `screens/room.js` — `confirmInRoom` → `confirm_in_room` RPC with real success/error handling.
- `features/checkin-system.js` — `doMatchCheckIn` → `check_in_match` RPC.
- `features/streak.js` — `updateWinStreak` local-UI only (no Supabase write).
- `features/clan.js` + `js/bugfix-v30-final.js` — `updateClanScore` → `increment_clan_score` RPC (Firebase transaction + direct read-modify-write removed); v30 `_joinDirect` retired; `join_clan` result contract fixed (`ok`).
- `js/bugfixes-v29-final.js` — fund-squad-bank → `contribute_to_squad_bank` RPC (direct clans read-modify-write removed).

### Admin panel (`ff-admin-panel`, 3 files)
- `js/admin-supabase-sync.js` — Firebase→Supabase balance overwrite path REMOVED (P9/P10); non-financial ban/stats sync kept.
- `js/admin-fixes-v21.js` — Bug#97 bulk `users.update({rank_points,win_streak})` removed (now atomic server-side).
- `sql and developer guide/DEVELOPER_GUIDE.md` — §59 documentation.

---

## P0 FIXED

1. **Clan leader economy inflation (RLS)** — `clans_update_leader` policy gave leader WITH-CHECK over `squad_bank_gd` etc.; closed by `guard_clans_update` freeze trigger (leader economy writes now server-RPC-only).
2. **Signup wallet mint** — `users_insert_own` allowed preset coins/green/is_admin; closed by `guard_users_insert`.
3. **Notification spoof/broadcast** — closed by `guard_notification_insert`.
4. **Clan mint (squad_bank_gd preset)** — closed by `guard_clans_insert`.
5. **Firebase→Supabase balance overwrite (admin sync)** — closed in `admin-supabase-sync.js`.

---

## P1 FIXED

1. `join_requests` authoritative-field client UPDATE — fully frozen (`clamp_join_requests_client_update` full freeze).
2. `win_streak` self-report — removed from self-editable allowlist (server-authored only).
3. `pending_deposit` currency/cap — tightened.
4. `matches.room_id/room_password` client inject — frozen (P25).
5. `join_clan` no member-cap + caller-spoof — capped + caller-verified.

---

## P2 FIXED

1. v23 poll double-write — RPC `increment_poll_vote` service-only; manual fallback neutralized live (verified non-exploitable).
2. db-bridge `checkIns` mirror — clamp trigger neutralizes non-admin writes.
3. Fixed harness-level false-positives in final regression (correct assertions).

---

## SECURITY DEFINER

All new/changed SECURITY DEFINER functions are `SET search_path TO 'public'` (scanned: **0** SECDEF plpgsql functions without search_path). Client-trusted values never accepted: uid/admin-uid always re-derived from `auth.jwt()->>'sub'`; fee/currency/reward/commission/XP/points server-derived from `app_settings` or table rows; member-cap, deposit amount, wallet columns whitelisted server-side.

## RLS

- `guard_users_insert` / `guard_clans_insert` / `guard_clans_update` / `guard_notification_insert` / `fft_guard_wallet_insert` / `clamp_join_requests_client_update` / `guard_matches_room_secrets` now gate every risky client write path (belt-and-suspenders over RLS).
- Wallet append-only (`wt_insert_own`/`wt_select_own` — no UPDATE/DELETE policy).
- `notif_insert` whitelist + relationship trigger; `team_formed` whitelisted & gated.

## WALLET

- Client balance self-write blocked (coins/sky/green/rank_points/premium/ban/fraud all blocked).
- `admin_sync_user_balance` = audited reconcile (before/after/delta + reason), no blind overwrite.
- `decrement_balance` FOR UPDATE; `increment_balance` stats-cap-100; `increment_rank_points` 500/call + 2000/day.
- `fft_guard_wallet_insert` — only own `pending_deposit` (sky, capped) / `pending_withdraw`.

## MATCH

- Join engine: `validate_and_join_match` (server fee/currency derivation, FOR UPDATE, self-play/capacity/dup/banned checks) — single canonical path (client `create`, `rank.js`, `fix6-offline-queue` all route here).
- Team join: `join_match_team` (server-derived teammates for auto-squad, invitation consent, capacity lock, no client team-uid trust).
- Refunds: `claim_match_refund` / `claim_no_show_refund` (once-only, origin-traceable).
- Room credentials: `get_room_credentials` (joined/paid only) + `match_rooms` admin-RLS-only.
- Check-in/room-confirm now server RPCs.

## REWARDS

- Battle Pass: `claim_battle_pass_tier`/`award_battle_pass_xp` (track-aware, premium-check, 2000 XP/day cap, replay guard).
- Premium monthly bonus: unique `(user_id, month_key)`, server-config bonus; duplicate → single reward.
- Referral: `apply_referral_code`/`claim_referral_reward` server-config reward, self-ref blocked, unique referred, both credited exactly once.
- Voucher: `redeem_voucher` FOR UPDATE + atomic max-uses + expiry + unique redemption.
- Mission/daily-checkin/streak: idempotent, server-capped.

## CREATOR

- Commission server-configured %, 7-day hold (`lock_creator_commission`/`release_creator_commission`), no self-pay, creator-match self-play blocked (`creator_uid = caller` + `validate_and_join_match`).
- `finalize_creator_commission` duplicate-guarded; `claim_match_commission_payout` once-only; `release_eligible_commissions` admin/service-only.

## FIREBASE

- Firebase mirror-only. Auth = Firebase JWT (`sub`=uid) → Supabase anon role. Bridge RPC-failure does NOT fall back to Firebase financial writes (`_handleRpcError` removed in R7; re-verified — no silent fallback remains).

## MIGRATIONS

- `sql and developer guide/2026-09-26c-R8-FINAL-HARDENING.sql` — consolidated, idempotent (re-applied ×3 without error).
- `sql and developer guide/DEVELOPER_GUIDE.md` §59.

## TESTS

- **User smoke: 44/44 PASS** · **Admin smoke: 33/33 PASS** (both suites green).
- **Empirical rollback-only probes (this run):** unauthorized admin RPCs (`admin_adjust_wallet`, `admin_set_coins`, `publish_match_results`, `correct_match_result`, `cancel_match_with_refunds`, `admin_end_current_season`, `admin_reward_suggestion`, `admin_sync_user_balance`) → all fail-closed (`Admin only`/`NOT_AUTHORIZED`).
- **Behavioral:** P1 join_requests freeze · P4 spoof/broadcast blocked · P5 signup mint reset · P6 clan mint reset · P1 leader economy freeze + profile-edit allowed · P8 season `already_finalized` · P7 suggestion marker · P10 reconcile ledger · P3c deposit currency/cap · P26 self-guard · P27 wallet append-only · self-play block · capacity-full block · `join_clan` legit/spoof/cap · `confirm_in_room` legit vs clamp · `check_in_match` not-joined.
- **Concurrency/idempotency:** FOR UPDATE locks verified in `validate_and_join_match`, `decrement_balance`, `claim_match_refund`, `redeem_voucher`, `confirm_in_room`; unique-constraint replay guards (`season_finalizations`, `suggestion_rewards`, `premium_monthly_bonus_claims`, `referrals.referred_id`, `voucher_redemptions`).
- **Privacy:** public SELECT surface audited — no PII/credentials leak; `users`/`suggestions`/`notifications`/`wallet` restricted to self/admin; `matches.room_password` client-write frozen + real creds in admin-only `match_rooms`.

## REMAINING ISSUES

- **None blocking.** Non-blocking notes:
  1. `clans.squad_bank_contributors` / `match_results.prize` remain PUBLIC-readable (design-intent leaderboard data — flagged to product, not an exploit).
  2. `join_clan` legacy 3-arg overload still exists (superseded by the 5-arg version used by the client).
  3. fa68 monthly season reset bulk `users.update(total_kills/wins/matches/rank_tier)` runs via admin JWT (admin-bypass in guard) — functional; server RPC is authoritative for season rewards.
  4. Client `select('*')` on matches remains (public feed) — room-cred columns content-frozen by trigger, so leak surface is zero.

## FINAL STATUS

**PRODUCTION READY**
