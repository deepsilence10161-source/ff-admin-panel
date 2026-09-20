# 🎮 MINI eSPORTS — COMPLETE DEVELOPER GUIDE
## User Panel v32.16 | Admin Panel v26.12 | Last Updated: 2026-08-24

> ⚠️ **READ THIS FIRST**: this codebase went through a full security audit + fix pass in
> July 2026 (v32.14 Security Overhaul). If you're touching ANY code that writes to the
> database — a new feature, a bug fix, anything — read **Section 24** before you start.
> The short version: `users`, `join_requests`, `clans`, and 14 other tables no longer
> allow direct client writes to their currency/privilege/game-outcome columns. Everything
> now goes through an admin-checked or self-checked RPC. If your write silently fails with
> a permission-denied error, this is why — check Section 24's RPC reference for the
> correct function to call instead of writing to the table directly.
>
> ⚠️ **ALSO READ Section 34.1** (2026-08-18): a CRITICAL security fix to 13 of those
> admin-checked RPCs — they had an anon-bypass hole that let any unauthenticated caller
> skip the admin check entirely. If you're writing a new SECURITY DEFINER function with a
> service_role/backend-caller exception, read 34.1's "Note for future RPCs" first —
> do not copy the old `auth.jwt()->>'sub' IS NULL` pattern from elsewhere in this codebase.
>
> ⚠️ **ALSO READ 2026-08-24's session notes below** — the single biggest finding: the
> `supabase_realtime` publication only ever contained ONE table (`app_settings`). Every
> `postgres_changes` subscription across BOTH panels was connecting successfully and
> silently receiving nothing. 64 tables are now published — if you add a new realtime
> subscription in future, you MUST also `ALTER PUBLICATION supabase_realtime ADD TABLE
> your_new_table;` or it will look like it works (connects fine) while doing nothing.
>
> ⚠️ **ALSO READ — CACHE-BUSTING, 2026-08-28**: every future release that changes ANY
> local file in either panel — a `.js` file, `.css` file, anything referenced from
> `index.html` — MUST bump the cache-busting version tag in **both** of these places, or
> the exact same "I fixed it but the bug is still there" pattern that wasted multiple
> entire sessions earlier will happen again:
> 1. **`index.html`'s own `?v=...` query strings** — every local `<script src="...">` and
>    `<link href="...">` tag in both panels carries a `?v=20260828a` suffix. Bump that date
>    tag to today's date (or any new unique string) on every release, in **both** panels'
>    `index.html`, for every tag whose target file changed. GitHub Pages' CDN and the
>    wrapped APK's WebView HTTP cache will otherwise keep serving the old file indefinitely
>    — this happened repeatedly for at least three separate bugs (WhatsApp, match-time
>    parsing, and others) before this gap was found and closed.
> 2. **User Panel's `sw.js`** — has its OWN separate caching layer (a service worker,
>    which Admin Panel does not have). Two things must be bumped together, every time:
>    `CACHE_VER` (near the top of the file — forces the old CacheStorage cache to be
>    deleted entirely on activate) **and** `ASSET_VER` (used to build every URL in
>    `LOCAL_FILES`'s precache list — must match whatever version tag `index.html` is
>    currently using, or the precache list becomes a permanent miss against real requests).
>    Forgetting `sw.js` specifically is what caused the WhatsApp fix to appear to silently
>    fail across several sessions even after the JS bug itself was genuinely fixed each
>    time — the wrapped APK's WebView persists this cache far more durably than a normal
>    browser does, so it is the easiest of the two to forget and the most costly to skip.

---

## 🗓️ 2026-08-24 SESSION SUMMARY (10 bugs, see 2026-08-24-SESSION-DELTA.sql)

1. **Cosmetics store fake-owned** — `_loadExtras()` fetched `user_cosmetics` 2s after
   boot but never re-synced `UD.cosmetics` or re-rendered; owned items reverted to "Buy"
   on every refresh. Fixed: immediate fetch + re-sync after every purchase.
2. **Leaderboard "#1" vs "top 50 se bahar"** — two independent UI blocks both tried to
   show the user's rank, and the rank query used `.gt()` (tie-blind) instead of accounting
   for ties. Unified into one block with a tie-aware count query.
3. **"Profile abhi ready nahi hai" for brand-new users** — genuine race: boot.js's own
   fire-and-forget `DB.users.create()` and profile.js's `_ensureUserRowExists()` self-heal
   could both fire for the same new uid; the loser got `PGRST116` (0 rows from
   `.select().single()` under `ignoreDuplicates`), which wasn't handled (only `23505` was).
   Fixed both the race (profile.js now awaits boot.js's in-flight promise) and the error
   handling (`PGRST116` now treated the same as `23505`).
4. **WhatsApp not opening** — the *previous* session's fix (raw `intent://` URL via
   `window.location.href`) was itself the bug; `intent://` is only parsed by Chrome's own
   link-click handler, not by JS-driven navigation, and broke WhatsApp universally outside
   one narrow case. Reverted to the standard `https://wa.me/` deep link.
5. **Streak milestone popup + duplicate coins every refresh** — was pure Firebase RTDB,
   completely disconnected from the Supabase `users` row `UD` is built from; the claimed-flag
   never round-tripped back to `UD`, so the check always re-passed. Moved to
   `streak_milestones_claimed` JSONB column + `claim_streak_milestone()` RPC (atomic,
   `FOR UPDATE`-locked, same pattern as `purchase_cosmetic`).
6. **Green Diamond 0 in header vs correct in wallet** — several `window.UD = <raw row>`
   reassignments (boot.js, bugfixes.js's fallback path) bypassed `_applyUser`'s
   snake_case→camelCase mapping, silently wiping `UD.greenDiamonds` back to `undefined`.
   `_applyUser` is now exported on `window` and every raw-reassignment site routes through it.
7. **Creator match creation always failing** — `matches.name` is a `GENERATED ALWAYS`
   column (derived from `title`); `creator_create_match()` illegally tried to INSERT into
   it directly, guaranteed to fail on every single call. Confirmed live via a rolled-back
   test call. Also added `first_prize`/`second_prize`/`third_prize` support for creators
   (same fields admin's own match form has), capped at `max_slots × entry_fee`.
8. **Sponsored tournaments not showing in User Panel** — not a bug, a missing feature;
   admin's sponsored-tournament tooling was only ever built with a matching User Panel
   display. Built end-to-end: `SP_T` global + `_bootSponsored()` realtime/poll loader in
   listeners.js, `renderSponsoredTournaments()` card in home.js.
9. **Poll votes not showing in admin** — admin's Poll Manager selected a column called
   `votes`, which is legacy/unused and always empty; the real voting RPC (`cast_poll_vote`)
   writes to `vote_counts`. Also fixed a second, independent bug: after fixing the column
   name, option keys still didn't match because `Object.values(poll.options)` discarded the
   `opt1`/`opt2` keys that `vote_counts` is keyed by.
10. **App-wide "need to refresh" feeling** — `supabase_realtime` publication only ever
    contained `app_settings`. Every realtime subscription in both panels was silently inert.
    64 tables added to the publication in one migration — this is very likely the single
    biggest contributor to the "refresh baar baar karna padta hai" complaint, independent
    of any individual screen bug.

---

## 📋 TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [Tech Stack — Har Tool Kisliye](#2-tech-stack)
3. [File Structure](#3-file-structure)
24. [**v32.14 Security Overhaul — Data Access Model & RPC Reference (READ FIRST)**](#24-v3214-security-overhaul)

4. [All Credentials & Service IDs](#4-credentials)
5. [Database — Supabase Complete Schema](#5-database)
6. [Firebase — Allowed Paths ONLY](#6-firebase-allowed-paths)

7. [DB Bridge — How It Works](#7-db-bridge)
8. [Auth Flow — Step by Step](#8-auth-flow)
9. [All Features — Kahan Kya Hai](#9-features)
10. [Global Variables & Core Functions](#10-globals)
11. [Currency & Economy System](#11-currency)
12. [Rank System](#12-rank)
13. [Premium Tiers](#13-premium)
14. [Ad System — AdMob](#14-ads)
15. [Push Notifications — OneSignal](#15-push)
16. [Remote Config (CFG)](#16-config)
17. [Security & Anti-Cheat](#17-security)
18. [Legal Compliance (MES)](#18-legal)
19. [How to Add a New Feature](#19-new-feature)
20. [How to Add a New Supabase Table](#20-new-table)
21. [Common Code Patterns](#21-patterns)
22. [v31 Changes — What Was Fixed](#22-v31-changes)
23. [Creator Economy System (2026-08 rebuild)](#23-creator-economy-system-2026-08-rebuild)
24. [v32.1 Audit Follow-up — Admin v26 + Cross-Panel Fixes](#24-audit-followup)
25. [Migration Guide — Run Order](#25-migration)
26. [Deployment Checklist](#26-deploy)
27. [Troubleshooting](#27-troubleshoot)
28. [Admin Panel — Complete Reference](#28-admin-reference)
29. [Zip Packaging Rules — Developer Ke Liye](#29-zip-rules)
30. [v32.8.5 Critical Fix — auth.uid() + Missing GRANTs](#30-v3285-critical-fix)
31. [Data Access Model & RPC Reference](#31-data-access-model--rpc-reference-updated-2026-07-19)
32. [2026-08 Session — Live-Testing Follow-up (UX + bug fixes)](#32-2026-08-session--live-testing-follow-up-user-panel-ux--bug-fixes)

---

## 1. PROJECT OVERVIEW

Mini eSports — **free-to-play, PROGA-2025 compliant** esports tournament platform for Free Fire / BGMI.

**Architecture:**
```
PRIMARY DB:  Supabase (PostgreSQL + RLS + Realtime)
AUTH:        Firebase Google OAuth → Supabase Third-Party Auth (JWT Bearer)
REALTIME:    Supabase Realtime channels (clan chat, match updates)
MEDIA:       ImgBB (screenshots, avatars)
ADS:         AdMob (rewarded, interstitial, banner)
PUSH:        OneSignal
ANALYTICS:   Firebase Analytics + Crashlytics
CHAT:        Firebase RTDB (support chat ONLY)
```

**Business Model:**
```
Revenue:
├── AdMob Ads          → rewarded (join match), interstitial, banner
├── Premium (₹49/99/199/month) → Silver/Gold/Diamond tiers
└── Sky Diamonds       → UPI purchase → match entry only

NOT ALLOWED (Halal + PROGA-2025 compliance):
❌ Real money withdrawal
❌ Coins ↔ money conversion
❌ Interest-based deposits
❌ Real gambling mechanics
```

---

## 2. TECH STACK

### 🟢 Supabase (PRIMARY DATABASE)
**File:** `core/db.js`

Supabase handles **everything** — users, matches, wallet, joins, clans, notifications, all features.

```
URL:      https://hddhkculuyrfoevxmlwy.supabase.co
Proj ID:  hddhkculuyrfoevxmlwy
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkZGhrY3VsdXlyZm9ldnhtbHd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NTQ1MTgsImV4cCI6MjA5NDAzMDUxOH0.2hhDGez1fVFjS5ljSU3tSOEJuusLmQpERjcrh45T7po
```

### 🔥 Firebase
**File:** `core/firebase.js`

Firebase sirf **4 cheezein** karta hai:
| Use | Detail |
|-----|--------|
| Google Auth | Login ke liye ONLY |
| Support Chat | User ↔ Admin chat (RTDB `support/`) |
| Analytics | Auto-collected events |
| Crashlytics | App crash reports |

```
Project ID:  fft-app-1e283
RTDB URL:    https://fft-app-1e283-default-rtdb.firebaseio.com
API Key:     AIzaSyA-v9AYigDrg96D_fos0vOW3wU2GY2UYec
App ID:      1:247829466483:web:6961488f1d3c4e3fff4906
```

### 🖼️ ImgBB
**File:** `core/imgbb.js` (User) / `js/imgbb.js` (Admin) → **Supabase Edge Function** `imgbb-upload`
```
⚠️ v32.7: KEY AB CLIENT MEIN NAHI HAI — server-side secret ban gayi hai.
Pehle IMGBB_KEY seedha core/imgbb.js mein hardcoded thi → GitHub Pages
pe publicly visible thi, koi bhi chura ke apni images upload kar sakta
tha. Ab dono panels ka imgbb.js seedha api.imgbb.com ko call NAHI karte
— Edge Function ko call karte hain (Firebase ID token ke saath, taaki
sirf logged-in users hi upload kar sakein).

Key ab kahan hai: Supabase Dashboard → Edge Functions → Secrets → IMGBB_KEY
Usage:   Profile photos, payment screenshots, match banners
Max:     32MB per image
Response shape unchanged (d.data.url) — client code tod-phod nahi hua.
```

### 💳 Paytm UPI (Auto-Payment) — v32.7 NEW
**Files:** `js/paytm-checkout.js` (User) + 3 Supabase Edge Functions
```
Naya optional "Pay Instantly via Paytm" button Sky Diamond wallet mein —
manual UPI screenshot flow ke saath-saath, usko replace nahi karta.

Flow:
  1. User "Pay via Paytm" dabata hai → paytm-checkout.js →
     paytm-create-order Edge Function call karta hai (Firebase token ke saath)
  2. Edge Function sd_requests mein PENDING row banata hai
     (request_type='paytm_auto') — row ka UUID hi Paytm ka orderId hai
  3. Paytm "Initiate Transaction" API call hota hai (UPI-only mode),
     txnToken wapas milta hai
  4. Client Paytm JS SDK popup kholta hai us txnToken se
  5. Payment ke baad Paytm apna webhook paytm-callback pe hit karta hai
     → yeh orderId se khud Paytm ki Transaction Status API call karta hai
       (incoming payload pe bharosa nahi karta — ground truth API se leta hai)
     → TXN_SUCCESS par hi credit — idempotent (double-webhook se bhi
       double-credit nahi hoga)
  6. Client bhi 5-second poll karta hai sd_requests status pe (backup UX,
     agar webhook slow ho)

✅ KOI NAYI SQL TABLE/COLUMN NAHI CHAHIYE — existing sd_requests,
   wallet_transactions, notifications aur increment_balance() RPC hi
   reuse ho rahe hain. COMPLETE_SCHEMA.sql is feature ke liye unchanged hai.

Secrets (Supabase → Edge Functions → Secrets, Paytm business account
banne ke baad set karne hain — abhi PENDING hai):
  PAYTM_MID, PAYTM_MERCHANT_KEY, PAYTM_ENV, PAYTM_WEBSITE, PAYTM_CALLBACK_URL

Jab tak secrets set nahi, admin panel App Settings → "Paytm Instant
Checkout" toggle OFF rakho — button users ko dikhega hi nahi (manual UPI
flow already normally kaam karta hai).
```

### 📱 AdMob
**File:** `features/ads.js`
```
App ID:          ca-app-pub-1032532795123223~9674995485
Rewarded:        ca-app-pub-1032532795123223/5092857849
Interstitial:    ca-app-pub-1032532795123223/7817221971
Banner:          ca-app-pub-1032532795123223/9718498564
```

### 🔔 OneSignal
**File:** `index.html` line ~32
```
App ID:   9c00aa92-4577-484c-996d-4494e8c6afad
Worker:   OneSignalSDKWorker.js (root mein hona chahiye)
```

### 💳 UPI
```
UPI ID: miniesports@upi
Flow:   User screenshot → ImgBB → Supabase sd_requests → Admin approve
```

---

## 3. FILE STRUCTURE

```
USER PANEL v32/
├── index.html                    ← Entry point, all scripts load yahan
├── styles.css                    ← Base CSS (layout, components, variables)
├── style.css                     ← CSS upgrade (animations, special pills)
├── manifest.json                 ← PWA manifest
├── sw.js                         ← Service Worker
├── OneSignalSDKWorker.js         ← Push notification worker
├── firebase-security-rules.json  ← RTDB security rules (support/ + deviceJoins/ + appSettings/ + creator paths)
├── BUGFIX_CHANGELOG.md           ← Historical fix log (v7→v32)
│
├── core/                         ← LOAD FIRST — Foundation layer
│   ├── firebase.js               ← Firebase init + global vars (U, UD, MT, JR...)
│   ├── db.js                     ← Supabase client + DB.* API layer
│   ├── db-bridge.js              ← Routes db.ref() calls → Supabase
│   ├── bugfixes.js               ← $ = getElementById, early patches
│   ├── utils.js                  ← toast(), goBack(), hasJ(), effSt(), fmtTime()
│   ├── router.js                 ← navTo(), setST(), setCat()
│   ├── modal.js                  ← openModal(), closeModal(), applyState()
│   ├── header.js                 ← updateHdr(), updateBell()
│   ├── auth.js                   ← doGoogleLogin(), afterLogin(), _handleSignIn()
│   ├── imgbb.js                  ← uploadToImgBB(), uploadToImgBBBase64()
│   ├── listeners.js              ← boot() — all Supabase data listeners
│   └── boot.js                   ← App start sequence
│
├── screens/                      ← One file per screen
│   ├── home.js                   ← renderHome(), renderSP(), mcHTML()
│   ├── matches.js                ← renderMM() — My Matches
│   ├── join.js                   ← cJoin(), _doJoinCore() — match entry
│   ├── room.js                   ← showRP() — room ID reveal
│   ├── wallet.js                 ← renderWallet(), startAdd(), startWd()
│   ├── rank.js                   ← renderRank(), calcRk(), confirmAdMatchJoin()
│   ├── profile.js                ← renderProfile(), profile update flow
│   ├── notifications.js          ← renderNotifs(), showCoinShop()
│   └── support.js                ← sendChat() — Firebase RTDB ONLY screen
│
├── features/                     ← Feature modules (one feature per file)
│   ├── admin-badge.js            ← Admin badge display on profile/leaderboard
│   ├── ads.js                    ← AdMob + web fallback, coin reward (Supabase only)
│   ├── app-config.js             ← Remote config CFG from Supabase app_settings
│   ├── auto-squad.js             ← ✅ v31: 100% Supabase auto_squad_queue
│   ├── battle-pass.js            ← 50-tier battle pass
│   ├── battle-pass-xp.js         ← Battle pass XP award helper
│   ├── bracket.js                ← Tournament brackets
│   ├── bundle-offers.js          ← Coin/SD bundle offers
│   ├── challenge.js              ← 1v1 Duel system
│   ├── checkin-system.js         ← ✅ v31: 100% Supabase join_requests
│   ├── city-championship.js      ← Monthly city vs city
│   ├── clan-war.js               ← Weekly clan wars
│   ├── clan.js                   ← Clan core (overridden by bugfix-v30-final.js)
│   ├── clean-badge.js            ← 30 clean matches badge
│   ├── free-trial.js             ← Free-trial entry flow
│   ├── friends.js                ← Friends + activity feed
│   ├── growth.js                 ← Missions, achievements, cosmetics
│   ├── india-map.js              ← SVG India player map
│   ├── match-history.js          ← Match history — ✅ v32.1: renderSeasonHistory() real field names (was placeholder)
│   ├── mentor.js                 ← Mentor-student system
│   ├── player-card.js            ← Shareable player card
│   ├── premium-creator.js        ← ✅ v32: Creator Dashboard + Video Upload + Match Hosting + Earnings
│   ├── creator-video-feed.js     ← ✅ v32 NEW: Video feed, 20s watch detection, coin credit, report
│   ├── creator-match-host.js     ← ✅ v32 NEW: Creator match form, room ID entry, commission view
│   ├── premium.js                ← ✅ v31: Supabase premium_requests
│   ├── rewarded-bonus.js         ← Rewarded-ad bonus tracking
│   ├── seasonal-league.js        ← ✅ v31: Supabase config table · ✅ v32.1: reward/emoji columns now mapped
│   ├── skill-matchmaking.js      ← Rank filter chips
│   ├── spectator.js              ← Watch live matches
│   ├── squad-bank.js             ← Clan GD pool
│   ├── squad-finder.js           ← Looking For Squad
│   ├── streak.js                 ← Win streak badges
│   └── watch-earn.js             ← ✅ v31: daily limit Supabase, no Firebase
│
└── js/                           ← Utilities, patches, fix batches
    ├── user-ui-v10.css           ← UI theme (neon, glassmorphism)
    ├── anti-cheat.js             ← ✅ v31: syntax fixed, device fingerprinting
    ├── ad-manager.js             ← AdMob manager
    ├── device-identity.js        ← Device ID generation
    ├── diamond-system.js         ← GD conversion config
    ├── features-user.js          ← Extra feature functions
    ├── fix5-listener-manager.js  ← Event listener dedup
    ├── fix6-offline-queue.js     ← Offline action queue
    ├── fix8-lazy-loading.js      ← Lazy image loading
    ├── fix9-toast-queue.js       ← Toast queue manager
    ├── fix10-server-time-sync.js ← Server time sync
    ├── fix12-push-notifications.js
    ├── fixes-v7.js               ← Bug fix batch v7
    ├── fixes-v8.js               ← Bug fix batch v8
    ├── fixes-v9.js               ← Bug fix batch v9
    ├── fixes-v10-all-bugs.js     ← Bug fix batch v10
    ├── fixes-v29-all-bugs.js     ← v29 comprehensive fixes
    ├── bugfixes-v29-final.js     ← v29 final patch
    ├── bugfix-v30-final.js       ← ✅ v30+v31: clan Supabase, chat Realtime
    ├── legal-compliance.js       ← MES age gate, state ban
    ├── match-result-detail.js    ← Detailed result view
    ├── match-timer.js            ← Countdown timers
    ├── offline-handler.js        ← Offline banner
    ├── preview-mode.js           ← Read-only preview mode (pre-login browse)
    ├── profile-card.js           ← Profile card render
    ├── quick-deposit.js          ← SD purchase flow
    ├── paytm-checkout.js         ← ✅ v32.7 NEW: Paytm Instant Checkout — Edge Function call + SDK popup + status poll
    ├── rank-system.js            ← RANK_TIERS definition
    ├── referral-system-fix.js    ← Referral fixes
    ├── referral-tracker.js       ← Referral dashboard
    ├── room-reveal.js            ← Room reveal animation
    ├── safe-loader.js            ← Sequential boot loader
    ├── security-patches.js       ← Rate limit, self-exclusion
    ├── security.js               ← Additional security
    ├── smart-automations.js      ← Auto check-in, reminders
    ├── ui-fixes.js               ← UI patches
    └── wallet-history.js         ← Wallet history rendering

⚠️  DELETED in v31 (were never loaded — duplicate dead files):
    ❌ js/battle-pass.js      → features/battle-pass.js is canonical
    ❌ js/clan-system.js      → features/clan.js + bugfix-v30 is canonical
    ❌ js/premium-system.js   → features/premium.js is canonical
    ❌ js/spectator-mode.js   → features/spectator.js is canonical
    ❌ js/streak.js           → features/streak.js is canonical
```

### ✅ v32.7 NEW — Supabase Edge Functions (server-side, secrets-protected)

```
supabase/functions/
├── _shared/
│   └── paytm.ts               ← Checksum (AES-128-CBC+SHA-256), config reader,
│                                 idempotent creditIfFirstTime()/markFailedIfPending()
├── imgbb-upload/
│   └── index.ts                ← Proxies ImgBB upload — IMGBB_KEY reads server-side only
├── paytm-create-order/
│   └── index.ts                ← Verifies Firebase token → sd_requests pending row →
│                                  Paytm Initiate Transaction → returns txnToken
└── paytm-callback/
    └── index.ts                ← Paytm webhook target — re-verifies via Paytm Transaction
                                   Status API (ground truth, never trusts incoming payload)
                                   → credits Sky Diamonds on TXN_SUCCESS
```
Deploy: `supabase functions deploy <name>` (Section 25/26 mein exact commands hain).
Koi in mein se koi bhi client-facing static file nahi hai — yeh Deno runtime pe
Supabase ke servers par chalte hain, repo mein sirf source ke liye hain.

---

## 4. CREDENTIALS

| Service | File | Key / ID |
|---------|------|----------|
| Firebase API Key | `core/firebase.js` | `AIzaSyA-v9AYigDrg96D_fos0vOW3wU2GY2UYec` |
| Firebase Project | `core/firebase.js` | `fft-app-1e283` |
| Supabase URL | `core/db.js` | `https://hddhkculuyrfoevxmlwy.supabase.co` |
| Supabase Anon Key | `core/db.js` | `eyJhbGci...T7po` (see db.js line ~28) |
| ImgBB Key | ⚠️ **v32.7: client se hata di gayi** — ab Supabase Edge Function secret hai (`IMGBB_KEY`, `supabase secrets set`) | `c977a42da70cbc98fe176af64fbc484f` (koi bhi client `.js` file mein nahi milegi ab) |
| AdMob App ID | `features/ads.js` | `ca-app-pub-1032532795123223~9674995485` |
| AdMob Rewarded | `features/ads.js` | `ca-app-pub-1032532795123223/5092857849` |
| AdMob Interstitial | `features/ads.js` | `ca-app-pub-1032532795123223/7817221971` |
| AdMob Banner | `features/ads.js` | `ca-app-pub-1032532795123223/9718498564` |
| OneSignal | `index.html` | `9c00aa92-4577-484c-996d-4494e8c6afad` |
| UPI (manual) | `features/premium.js` | `miniesports@upi` |
| Paytm MID | Supabase secret `PAYTM_MID` | ⏳ **PENDING** — Paytm business account abhi nahi bana (skip kiya gaya hai for now) |
| Paytm Merchant Key | Supabase secret `PAYTM_MERCHANT_KEY` | ⏳ **PENDING** — kabhi bhi client mein nahi jaani chahiye |
| Paytm Env/Website/Callback | Supabase secrets `PAYTM_ENV` / `PAYTM_WEBSITE` / `PAYTM_CALLBACK_URL` | ⏳ **PENDING** — Section 2 mein exact `supabase secrets set` commands hain |

---

## 5. DATABASE — SUPABASE COMPLETE SCHEMA

### A. CORE TABLES

**`users`**
```sql
id                    UUID PK     -- Firebase Auth UID
ign                   TEXT        -- In-game name
ff_uid                TEXT        -- Free Fire UID
avatar_url            TEXT        -- ImgBB URL
avatar_bg_color       TEXT='#0d0d1a'
city                  TEXT
coins                 INT=0
green_diamonds        INT=0       -- Won by winning only
sky_diamonds          INT=0       -- Purchased with UPI only
rank_points           INT=0
win_streak            INT=0
clean_matches         INT=0
has_clean_badge       BOOL=false
total_wins            INT=0
total_kills           INT=0
total_matches         INT=0
profile_status        TEXT='complete'
pending_ign           TEXT
profile_request_count INT=0
bio                   TEXT
phone                 TEXT
premium_level         INT=0       -- 0=free 1=Silver 2=Gold 3=Diamond
premium_expires       TIMESTAMPTZ
is_banned             BOOL=false
is_admin              BOOL=false
clan_id               UUID FK → clans.id
referral_code         TEXT UNIQUE
referred_by           UUID FK → users.id
referral_popup_done   BOOL=false  -- v32.8: set true once first-login referral popup shown/skipped
sponsored_winnings    NUMERIC=0   -- v32.8: withdrawable, sponsor-tournament wins only (NOT green_diamonds)
email                 TEXT
created_at            TIMESTAMPTZ
```

**`matches`**
```sql
id                UUID PK
title             TEXT            -- "Summer Cup 2025"
mode              TEXT            -- 'solo'|'duo'|'squad'
entry_type        TEXT            -- 'free'|'coins'|'sky_diamond'|'ad'
entry_fee         NUMERIC=0
prize_pool        NUMERIC=0
prize_1st         NUMERIC=0
prize_2nd         NUMERIC=0
prize_3rd         NUMERIC=0
per_kill_prize    NUMERIC=0
max_slots         INT=100
filled_slots      INT=0           -- ✅ v31: always updated in Supabase
status            TEXT='upcoming' -- 'upcoming'|'live'|'completed'|'cancelled'
scheduled_at      TIMESTAMPTZ
room_id           TEXT
room_password     TEXT
map               TEXT='Bermuda'
min_rank          TEXT            -- rank filter
is_featured       BOOL=false
is_sponsored      BOOL=false
banner_url        TEXT
stream_link       TEXT
youtube_link      TEXT
spectator_count   INT=0
creator_code      TEXT
prize_distribution JSONB=[]
match_sub_type    TEXT
ads_required      INT=2
created_by        UUID FK → users.id
```

**`join_requests`**
```sql
id              UUID PK
match_id        UUID FK → matches.id
user_id         UUID FK → users.id
status          TEXT    -- 'pending'|'approved'|'rejected'|'joined'|'no_show'
entry_type      TEXT
entry_fee_paid  NUMERIC=0
ign_at_join     TEXT
mode            TEXT
in_room         BOOL=false    -- ✅ v31: user confirmed entering room
in_room_at      TIMESTAMPTZ
checked_in      BOOL=false    -- ✅ v31: pre-match check-in status
checkin_at      TIMESTAMPTZ
ad_watched      BOOL=false    -- ✅ v31: for ad-match joins
created_at      TIMESTAMPTZ
UNIQUE(match_id, user_id)
```

**`notifications`**
```sql
id          UUID PK
user_id     UUID FK → users.id
type        TEXT    -- see types below
title       TEXT
body        TEXT
ref_id      TEXT    -- related resource ID
is_read     BOOL=false
created_at  TIMESTAMPTZ

Types:
'match_room'        → Room ID released
'match_result'      → Result announced
'friend_add'        → Friend added
'squad_request'     → Squad invite
'duel_challenge'    → 1v1 challenge
'clan_war_challenge'→ Clan war
'mentor_request'    → Student request
'premium'           → Premium activated
'no_show_refund'    → Check-in miss refund
'team_formed'       → Auto-squad team ready
'gift_ticket'       → Gift ticket received
'info'              → General
```

**`wallet_transactions`**
```sql
id          UUID PK
user_id     UUID FK → users.id
txn_type    TEXT    -- 'credit'|'debit'
amount      NUMERIC
currency    TEXT    -- 'coins'|'green_diamonds'|'sky_diamonds'
reason      TEXT    -- human description
ref_id      TEXT    -- match/request ID
created_at  TIMESTAMPTZ
```

**`sd_requests`** (Sky Diamond purchase)
```sql
id              UUID PK
user_id         UUID FK
ign             TEXT
sd_amount       INT
amount_inr      NUMERIC
screenshot_url  TEXT
upi_ref         TEXT
status          TEXT='pending'
reviewed_by     UUID FK → users.id
created_at      TIMESTAMPTZ
```

---

### B. CLAN TABLES

**`clans`**
```sql
id                    UUID PK
name                  TEXT UNIQUE
badge                 TEXT        -- Emoji
leader_id             UUID FK → users.id
description           TEXT
total_members         INT=0
total_wins            INT=0
weekly_score          INT=0
is_private            BOOL=false
join_code             TEXT UNIQUE
squad_bank_gd         INT=0
squad_bank_unlocked   JSONB={}
squad_bank_contributors JSONB={}
```

**`clan_members`**
```sql
id        UUID PK
clan_id   UUID FK
user_id   UUID FK
role      TEXT  -- 'leader'|'co-leader'|'member'
joined_at TIMESTAMPTZ
UNIQUE(clan_id, user_id)
```

**`clan_messages`**  ← ✅ v31: Supabase Realtime, NOT Firebase
```sql
id          UUID PK
clan_id     UUID FK
sender_id   UUID FK → users.id
sender_ign  TEXT      -- ✅ v31: stored directly, no join needed
message     TEXT
created_at  TIMESTAMPTZ
```

---

### C. v31 NEW TABLES

**`auto_squad_queue`**
```sql
id          UUID PK
match_id    UUID FK → matches.id
user_id     UUID FK → users.id
mode        TEXT='squad'  -- 'duo'|'squad'
ign         TEXT
rank_tier   TEXT='Bronze'
rank_pts    INT=0
status      TEXT='waiting' -- 'waiting'|'matched'|'cancelled'
team_id     TEXT          -- set when team formed
joined_at   TIMESTAMPTZ
UNIQUE(match_id, user_id)
```

**`gift_tickets`**
```sql
id          UUID PK
from_uid    UUID FK → users.id
from_name   TEXT
to_uid      UUID FK → users.id
to_ff_uid   TEXT
match_id    UUID FK → matches.id
match_name  TEXT
fee         NUMERIC=0
entry_type  TEXT='paid'
status      TEXT='pending'
created_at  TIMESTAMPTZ
```

**`watch_earn_log`**
```sql
id           UUID PK
user_id      UUID FK → users.id
match_id     UUID FK → matches.id
coins_earned INT=0
watched_mins INT=0
log_date     DATE=CURRENT_DATE    -- ✅ daily limit check
created_at   TIMESTAMPTZ
```

**`premium_requests`**
```sql
id              UUID PK
user_id         UUID FK UNIQUE
user_name       TEXT
tier            INT=1
price           NUMERIC=0
screenshot_url  TEXT
status          TEXT='pending'
reviewed_by     UUID FK → users.id
reviewed_at     TIMESTAMPTZ
created_at      TIMESTAMPTZ
```

**`profile_requests`**
```sql
id                UUID PK
user_id           UUID FK UNIQUE
requested_ign     TEXT
requested_uid     TEXT
phone             TEXT
bio               TEXT
request_type      TEXT='update'
is_banned         BOOL=false
request_count     INT=1
status            TEXT='pending'
reviewed_by       UUID FK → users.id
rejection_reason  TEXT
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

**`seasonal_league_history`**
```sql
id          UUID PK
user_id     UUID FK
season_name TEXT
season_num  INT
final_tier  TEXT
points      INT=0
badge       TEXT
reward      TEXT
emoji       TEXT='🏅'
created_at  TIMESTAMPTZ
```

**`config`**
```sql
key        TEXT PK   -- 'currentSeason', 'liveConfig', etc.
value      JSONB
updated_at TIMESTAMPTZ
```

---

### D. FEATURE TABLES

**`squad_finder`**, **`friendships`**, **`user_activities`**,
**`duel_challenges`**, **`duel_records`**, **`city_championship`**,
**`clan_wars`**, **`clan_war_challenges`**, **`tournament_brackets`**,
**`mentor_profiles`**, **`mentor_requests`**, **`battle_pass_progress`**,
**`daily_checkins`**, **`mission_progress`**, **`user_achievements`**,
**`user_cosmetics`**, **`rank_history`**, **`rank_seasons`**,
**`referrals`**, **`sponsored_prizes`**, **`support_tickets`**,
**`creator_applications`**, **`app_settings`**

*(Full schema in `SUPABASE_SQL_SETUP.sql` / `COMPLETE_SCHEMA.sql`)*

---

### E. ✅ v32 NEW TABLES (Creator Economy System)

**`creator_videos`** ← mirrors Firebase `creatorVideos/{videoId}`
```sql
id            UUID PK
firebase_id   TEXT UNIQUE       -- Firebase push key
creator_uid   TEXT FK → users.id
title         TEXT  (max 60 chars)
description   TEXT  (max 200 chars)
link          TEXT
platform      TEXT   -- 'youtube'|'instagram'
status        TEXT   -- 'live'|'auto_hidden'|'removed'
report_count  INT=0
created_at    TIMESTAMPTZ
```

**`video_watches`** ← daily watch tracking for coin crediting
```sql
id            UUID PK
user_uid      TEXT FK → users.id
video_id      TEXT               -- firebase_id of creator_videos
watched_at    TIMESTAMPTZ
coins_earned  INT=0
UNIQUE(user_uid, video_id, watched_at::DATE)  -- 1x per video per day
```

**`video_reports`** ← report log for moderation
```sql
id            UUID PK
video_id      TEXT               -- firebase_id
reporter_uid  TEXT FK → users.id
reason        TEXT
created_at    TIMESTAMPTZ
resolved      BOOL=false
resolution    TEXT               -- 'restored'|'confirmed'
UNIQUE(video_id, reporter_uid)
```

**`creator_matches`** ← extends matches for creator-hosted
```sql
id                UUID PK
match_id          UUID FK → matches.id UNIQUE
creator_uid       TEXT FK → users.id
commission_pct    NUMERIC=10
commission_type   TEXT='gd'      -- 'gd'|'inr'
commission_amount NUMERIC=0
commission_status TEXT='pending'  -- 'pending'|'hold'|'eligible'|'paid'
hold_until        TIMESTAMPTZ
created_at        TIMESTAMPTZ
```

**`creator_commissions`** ← per-match commission ledger
```sql
id           UUID PK
creator_uid  TEXT FK → users.id
match_id     UUID FK → matches.id
amount       NUMERIC
currency     TEXT   -- 'gd'|'inr'
status       TEXT   -- 'hold'|'eligible'|'paid'|'pending_payout'
created_at   TIMESTAMPTZ
eligible_at  TIMESTAMPTZ
paid_at      TIMESTAMPTZ
```

---

### E. SUPABASE VIEWS

**`leaderboard`** — Used by rank.js
```sql
SELECT id, ign, avatar_url, city, ff_uid,    -- ✅ v31: ff_uid added
       rank_points, total_wins, total_kills, total_matches,
       is_banned,
       RANK() OVER (ORDER BY rank_points DESC) AS global_rank
FROM users WHERE is_banned = false AND ign IS NOT NULL
ORDER BY rank_points DESC;
```

---

### F. KEY RPCs (Stored Functions)

> ⚠️ This list was superseded in the v32.14 Security Overhaul — see **Section 24** for the
> complete, current, accurate RPC reference (25+ functions, all with security notes). The
> function names/parameters below are OUTDATED — e.g. `award_battle_pass_xp` now takes
> `(p_uid, p_season, p_xp)` not `(p_uid, p_xp)`, and `claim_battle_pass_reward` was never
> actually built — the real function is `claim_battle_pass_tier`. Do not copy code from
> this section; jump to Section 24 instead.

---

## 6. FIREBASE — ALLOWED PATHS ONLY

```
⛔ RULE: Firebase RTDB pe sirf yeh paths allowed hain:

✅ ALLOWED:
  support/{ticketId}/messages/{msgId}     ← User-Admin chat
  deviceJoins/{deviceId}/{matchId}        ← Anti-cheat device check

✅ READ-ONLY (app config fallback):
  appSettings/liveConfig                  ← Emergency config fallback
  appSettings/tdsConfig                   ← TDS tax rates
  appSettings/diamondPackages             ← SD package prices

✅ OPTIONAL (non-critical, silent fail OK):
  matches/{id}/spectators/{uid}           ← Watch & Earn presence
  matches/{id}/spectatorCount             ← Live spectator count

❌ EVERYTHING ELSE → Supabase via DB Bridge
```

**RTDB Security Rules (set exactly):**
```json
{
  "rules": {
    "support": {
      "$ticketId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "deviceJoins": {
      "$deviceId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "appSettings": {
      ".read": true,
      ".write": false
    },
    "adminConfig": {
      ".read": true,
      ".write": false
    },
    "creatorVideos": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "videoReports": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "videoWatched": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    },
    "creatorMatches": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "creatorCommission": {
      "$uid": {
        ".read": "$uid === auth.uid || root.child('users').child(auth.uid).child('is_admin').val() === true",
        ".write": "root.child('users').child(auth.uid).child('is_admin').val() === true"
      }
    },
    "adminAlerts": {
      ".read": "root.child('users').child(auth.uid).child('is_admin').val() === true",
      ".write": "auth != null"
    },
    "$other": {
      ".read": false,
      ".write": false
    }
  }
}
```

---

## 7. DB BRIDGE — HOW IT WORKS

**File:** `core/db-bridge.js`

`db-bridge.js` patches `window.db` so old `db.ref()` calls automatically route to Supabase.

```javascript
// Old code (works via bridge):
db.ref('joinRequests').push().key         → Supabase join_requests INSERT
db.ref('joinRequests/id').set(data)       → Supabase join_requests INSERT
db.ref('matches/id/joinedSlots').transaction() → Supabase matches.filled_slots UPDATE
db.ref('users/uid/coins').transaction()   → Supabase users.coins UPDATE
db.ref('users/uid/notifications').push()  → Supabase notifications INSERT

// Unmapped paths → Firebase RTDB fallback:
db.ref('support/...')                     → Firebase RTDB (intended)
db.ref('deviceJoins/...')                 → Firebase RTDB (intended)
db.ref('appSettings/...')                 → Firebase RTDB read-only (intended)
```

**⚠️ NEW CODE rule:** Never use `db.ref()` for new features.
Always use `window._supa.from(...)` directly.

---

## 8. AUTH FLOW — STEP BY STEP

```
1. User clicks "Continue with Google"
         ↓
2. Firebase GoogleAuthProvider
   (signInWithPopup for web, signInWithRedirect for WebView)
         ↓
3. Firebase onAuthStateChanged fires → user object milta hai
         ↓
4. core/auth.js → _handleSignIn(user) runs:
   a. window.U = { uid, email, displayName, photoURL }
   b. DB.auth.syncFirebaseToken(user) AWAITED:
      - user.getIdToken(true) → fresh JWT (1hr valid)
      - Supabase client RECREATED with Authorization: Bearer <jwt>
      - Supabase validates via Firebase JWKS endpoint
      - auth.uid() in PostgreSQL = Firebase UID ✅
   c. afterLogin(user) → boot() → listeners.js starts
         ↓
5. onIdTokenChanged (every ~1hr):
   - Auto token refresh
   - DB.auth.syncFirebaseToken() called again
   - Supabase channels cleaned up + re-subscribed ✅
```

**❌ Kabhi mat karo (these all FAIL):**
```javascript
// ❌ "Unsupported provider" error
await _supa.auth.signInWithIdToken({ provider: 'firebase', token });

// ❌ Supabase Google OAuth (not enabled)
await _supa.auth.signInWithOAuth({ provider: 'google' });

// ❌ Method doesn't exist
await _supa.auth.signInWithCustomToken(token);
```

**✅ Sahi tarika:**
```javascript
// core/db.js mein defined — always use this
await DB.auth.syncFirebaseToken(firebaseUser);
```

**Supabase Dashboard Setup:**
```
Authentication → Third-Party Auth → Firebase → ENABLED
Firebase Project ID: fft-app-1e283
```

---

## 9. ALL FEATURES — KAHAN KYA HAI

| Feature | File | Entry Point | DB |
|---------|------|-------------|-----|
| Match Listing | `screens/home.js` | Auto | Supabase `matches` |
| Match Join | `screens/join.js` | `cJoin(id)` | Supabase `join_requests` |
| Ad Match Join | `screens/rank.js` | `showAdJoinPopup()` | ✅v31 Supabase `join_requests` |
| Room Reveal | `screens/room.js` | Auto | Supabase `matches` |
| My Matches | `screens/matches.js` | Nav | Supabase `join_requests` |
| Wallet | `screens/wallet.js` | Nav | Supabase `wallet_transactions` |
| Rank | `screens/rank.js` | Nav | Supabase `leaderboard` |
| Profile | `screens/profile.js` | Nav | Supabase `users` |
| Notifications | `screens/notifications.js` | Bell | Supabase `notifications` |
| Support Chat | `screens/support.js` | Profile menu | **Firebase** `support/` |
| Battle Pass | `features/battle-pass.js` | `showBattlePass()` | Supabase `battle_pass_progress` |
| Clan | `features/clan.js` + bugfix-v30 | `showClanHome()` | Supabase `clans` |
| Clan Chat | bugfix-v30-final.js | `showClanChat(id)` | ✅v31 Supabase Realtime |
| Check-In | `features/checkin-system.js` | `doCheckIn()` | ✅v31 Supabase `join_requests` |
| Watch & Earn | `features/watch-earn.js` | `startWatching(id)` | ✅v31 Supabase `watch_earn_log` |
| Auto Squad | `features/auto-squad.js` | `showAutoSquadJoin()` | ✅v31 Supabase `auto_squad_queue` |
| Premium | `features/premium.js` | `showPremiumUpgrade()` | ✅v31 Supabase `premium_requests` |
| Seasonal League | `features/seasonal-league.js` | Pill | ✅v31 Supabase `config` |
| Gift Ticket | `screens/matches.js` | Match card | ✅v31 Supabase `gift_tickets` |
| Profile Request | `screens/profile.js` | Edit profile | ✅v31 Supabase `profile_requests` |
| Ads | `features/ads.js` | Auto | AdMob SDK |
| App Config | `features/app-config.js` | Auto | Supabase `app_settings` |
| Spectator | `features/spectator.js` | Pill | Supabase `active_matches` |
| Match History | `features/match-history.js` | Profile tab | Supabase `join_requests` |
| Missions | `features/growth.js` | `showMissionsPanel()` | Supabase `mission_progress` |
| Achievements | `features/growth.js` | `showAchievements()` | Supabase `user_achievements` |
| Cosmetics | `features/growth.js` | `showCosmeticsStore()` | Supabase `user_cosmetics` |
| Squad Finder | `features/squad-finder.js` | `showSquadFinder()` | Supabase `squad_finder` |
| Friends | `features/friends.js` | `showFriends()` | Supabase `friendships` |
| 1v1 Duel | `features/challenge.js` | `sendDuelChallenge()` | Supabase `duel_challenges` |
| Player Card | `features/player-card.js` | `showPlayerCard()` | Supabase `users` |
| Win Streak | `features/streak.js` | Auto (header) | Supabase `users.win_streak` |
| City Champ | `features/city-championship.js` | `showCityChampionship()` | Supabase `city_championship` |
| Clean Badge | `features/clean-badge.js` | `showCleanBadgeStatus()` | Supabase `users.clean_matches` |
| Bracket | `features/bracket.js` | `showBracket()` | Supabase `tournament_brackets` |
| Squad Bank | `features/squad-bank.js` | `showSquadBank()` | Supabase `clans.squad_bank_*` |
| Mentor | `features/mentor.js` | `showMentorHub()` | Supabase `mentor_profiles` |
| Clan War | `features/clan-war.js` | `showClanWar()` | Supabase `clan_wars` |
| India Map | `features/india-map.js` | `showIndiaMap()` | Supabase `city_championship` |

---

## 10. GLOBAL VARIABLES & CORE FUNCTIONS

### Global Variables (all declared in `core/firebase.js`)

```javascript
U             // Firebase Auth user (null = not logged in)
UD            // User data from Supabase users table
MT            // All matches {}  — key = matchId, value = match object
JR            // Join requests {} — key = join_request.id
NOTIFS        // Notifications []
WH            // Wallet history [] (from Supabase sd_requests)
TXNS          // Wallet transactions [] (from Supabase wallet_transactions)
REFS          // Referrals []
PAY           // Payment data {}
prevMTKeys    // Previous MT keys (for change detection)
curScr        // Current screen ('home'|'wallet'|'rank'|'profile'|'notifications')
prevScr       // Previous screen
hSF           // Home status filter
hCF           // Home category filter
mmSF          // My Matches status filter
db            // Firebase RTDB (support chat ONLY)
cdInt         // Countdown interval reference
```

### MT Object (Match) — from `_toMT()` in listeners.js

```javascript
MT[matchId] = {
  id, title, name,
  status,           // 'upcoming'|'live'|'completed'|'cancelled'
  mode,             // 'solo'|'duo'|'squad'
  entryFee,
  entryType,        // 'coin'|'paid'|'free'|'ad'
  firstPrize,
  maxSlots,
  filledSlots,      // current joined count
  joinedSlots,      // ✅ v31: same as filledSlots (both present)
  matchTime,        // Unix ms
  roomId,
  roomPassword,
  roomStatus,       // 'released'|'pending'
  bannerUrl,
  isSponsored,
  prize1st, prize2nd, prize3rd, perKillPrize,
  isFeatured, minRank, adsRequired,
  _src: 'supabase'  // always Supabase
}
```

### UD Object (User Data)

```javascript
window.UD = {
  id, ign, ff_uid, avatar_url, city,
  coins, green_diamonds, sky_diamonds,
  rank_points, win_streak, clean_matches, has_clean_badge,
  total_wins, total_kills, total_matches,
  profile_status, premium_level, is_banned, clan_id,
  referral_code, bio, phone, avatar_bg_color,
  // Computed by listeners.js:
  premium: { tier, expiresAt },
  premiumLevel,   // = premium_level
  _winStreak,     // = win_streak
}
```

### Core Function Reference

```javascript
// Navigation
navTo('wallet')              // Go to screen
goBack()                     // Previous screen
setST('upcoming')            // Status filter
setCat('free')               // Category filter

// Modal
openModal('Title', '<html>') // Open modal
closeModal()                 // Close modal

// UI
toast('Message', 'ok')       // 'ok'|'err'|'inf'|'warn'
updateHdr()                  // Refresh header balances

// Utils
$(id)                        // getElementById shorthand
hasJ(matchId)                // true if user joined this match
effSt(matchObj)              // Effective match status
fmtTime(timestamp)           // Format timestamp to readable
isVO()                       // Profile verification pending?
titleCase(str)               // Capitalize each word
escHtml(str)                 // XSS-safe HTML escape
serverNow()                  // Server-synced timestamp

// Activity
logActivity('win', 'Won!')   // Log to user_activities
```

---

## 11. CURRENCY & ECONOMY

```
┌─────────────────────────────────────────────────────────────┐
│  3 CURRENCIES — ALL VIRTUAL, ZERO REAL MONEY VALUE         │
├────────────┬──────────────┬────────────────┬───────────────┤
│ 🪙 Coins   │ Ads, check-in│ Coin matches   │ ❌ NO money   │
│            │ Referrals    │ Coin shop      │               │
├────────────┼──────────────┼────────────────┼───────────────┤
│ 💎 Green   │ Win matches  │ Cosmetics only │ ❌ NO money   │
│ Diamonds   │ ONLY source  │ Squad Bank     │               │
├────────────┼──────────────┼────────────────┼───────────────┤
│ 🔷 Sky     │ UPI purchase │ SD matches     │ ✅ Purchase   │
│ Diamonds   │ (₹ → SD)    │ only           │ only, no WD   │
└────────────┴──────────────┴────────────────┴───────────────┘
```

**All balance changes must use Supabase RPC:**
```javascript
// ✅ CORRECT — atomic, race-condition safe
window._supa.rpc('increment_balance', {
  p_uid: window.U.uid, p_col: 'coins', p_amount: 10
});

// ❌ WRONG — race condition, read-modify-write
window._supa.from('users').update({ coins: UD.coins + 10 }).eq('id', U.uid);

// ❌ WRONG — Firebase RTDB (double credit risk)
db.ref('users/' + U.uid + '/coins').transaction(v => (v||0) + 10);
```

---

## 12. RANK SYSTEM

**File:** `js/rank-system.js`

```javascript
window.RANK_TIERS = [
  { name: 'Bronze',   min: 0,    max: 300,  emoji: '🏅', color: '#cd7f32' },
  { name: 'Silver',   min: 301,  max: 600,  emoji: '🥈', color: '#c0c0c0' },
  { name: 'Gold',     min: 601,  max: 1000, emoji: '🥇', color: '#ffd700' },
  { name: 'Platinum', min: 1001, max: 1500, emoji: '🔷', color: '#e0e0ff' },
  { name: 'Diamond',  min: 1501, max: 2000, emoji: '💎', color: '#00d4ff' },
  { name: 'Legend',   min: 2001, max: 9999, emoji: '👑', color: '#b964ff' },
];

// Usage
var tier = window.calcRk(UD.stats || {});  // returns { badge, pts, color, emoji }
```

**Points System:**
```
1st place:   +25 pts
2nd place:   +15 pts
3rd place:   +10 pts
Top 10:      +5 pts
Others:      +1 pt (participation)
Per kill:    +1 pt
5-kill game: +3 pts bonus
10-kill game:+7 pts bonus
```

---

## 13. PREMIUM TIERS

**File:** `features/premium.js`

| Tier | Price | Label | Key Benefits |
|------|-------|-------|-------------|
| 0 | Free | Free | Ads shown |
| 1 | ₹49/mo | 🥈 Silver | No ads, Silver badge, +5 GD |
| 2 | ₹99/mo | 🥇 Gold | +Mentor access, private matches, +15 GD |
| 3 | ₹199/mo | 💎 Diamond | +Early access, exclusive theme, +35 GD |

**Check in code:**
```javascript
var tier = Number(window.UD.premium_level || 0);
var isActive = tier > 0 && window.UD.premium && window.UD.premium.expiresAt > Date.now();
if (tier < 2) { toast('Gold Premium chahiye', 'err'); return; }
```

**Flow (v31):**
```
User → showPremiumUpgrade() → screenshot UPI → uploadToImgBB()
     → Supabase premium_requests INSERT (NOT Firebase)
     → Admin panel → review → approve
     → users.premium_level updated → UD refreshed
```

---

## 14. AD SYSTEM

**File:** `features/ads.js`

```
3 AD TYPES:
Rewarded      → "Watch Ad" to join Ad Match → +10 coins (CFG)
Interstitial  → After match ends → no reward
Banner        → Home screen always → no reward

Web mode:  5-second countdown overlay → simulates ad
APK mode:  Real AdMob SDK via Android WebView bridge
           Android calls window.onAdRewarded() on success

onAdReward() — v31 FIXED:
  • Single definition (no duplicate)
  • Routes to onAdRewardForMatch() if _adMatchPending is set
  • Otherwise: Supabase RPC coin credit ONCE (not twice)
  • No self-calling loop
```

---

## 15. PUSH NOTIFICATIONS

**OneSignal push (external, from backend/dashboard):**
```bash
POST https://onesignal.com/api/v1/notifications
Authorization: Basic <REST_API_KEY>
{
  "app_id": "9c00aa92-4577-484c-996d-4494e8c6afad",
  "filters": [{"field":"tag","key":"uid","relation":"=","value":"USER_UID"}],
  "headings": {"en": "Title"},
  "contents": {"en": "Message"}
}
```

**In-app notification (Supabase):**
```javascript
window._supa.from('notifications').insert({
  user_id: targetUid,
  type: 'info',
  title: '📢 Title',
  body: 'Message text'
}).catch(function(){});
```

---

## 16. REMOTE CONFIG (CFG)

**File:** `features/app-config.js`
**Source:** Supabase `app_settings` table (key = `'live_config'`)

```javascript
window.CFG = {
  commission: 0.15,
  roomReleaseMins: 10,
  matchReminderMins: 30,
  autoSquadEnabled: 1,
  autoSquadTimeout: 15,
  checkInEnabled: 1,
  checkInOpenMins: 30,
  checkInCloseMins: 5,
  watchEarnEnabled: 1,
  watchCoinsPerInterval: 2,
  watchIntervalMins: 5,
  watchDailyLimitMins: 30,     // ✅ v31: enforced via Supabase
  seasonName: 'Season 1',
  adCoinsPerWatch: 10,
  adDailyLimit: 5,
  checkinCoins: 5,
  checkinStreakBonus7: 50,
  referralJoinCoins: 50,
  referralSDBonusDiamonds: 10,
  premium: { prices: { 1:49, 2:99, 3:199 }, bonuses: { 1:50, 2:150, 3:400 } },
};
```

**Edit via:** Admin Panel → Settings → Live Config JSON

---

### 16b. FORCE UPDATE CONTROL (2026-07)

**Files:** `features/app-config.js` (check + full-screen lock), `android/.../MainActivity.java` (`getAppVersion()`, `getSigningHash()` bridge methods), Admin Panel → Settings → "📱 App Force Update Control"

New `app_settings.live_config` keys:

```javascript
appLatestVersion:        '1.3.8',   // display-only, e.g. shown in "update available" UI
appMinSupportedVersion:  '1.3.5',   // installed version < this → hard-locked
appApkUrl:               'https://.../MiniESports.apk',
appForceUpdateEnabled:   false,     // emergency ON/OFF switch — no release needed to disable
appSupportContact:       '',        // optional WhatsApp number, shows "Contact Support" on lock screen
appExpectedSigningHash:  '',        // optional SHA-256 of release keystore's signing cert
```

**How it works:**
1. On every config load (cold boot, cache-read, Supabase fetch, Firebase fallback, app resume via `visibilitychange`, and manual Retry) — `_checkForceUpdate()` runs.
2. It reads the **actual installed APK version** via `window.Android.getAppVersion()` (native `PackageManager`, not anything the web page stores) and compares it to `appMinSupportedVersion`.
3. If older (or, when `appExpectedSigningHash` is set, if the signing cert doesn't match — catches a resigned/tampered APK with a faked version string), a full-screen overlay (`#forceUpdateOverlay`) is appended directly to `document.body` — outside the app's router/screens, so switching screens or pressing back never removes it.
4. The decision is **never cached/trusted from local storage** — it's recomputed fresh every time, so clearing app data, restarting, or backing out does not bypass it.
5. `appForceUpdateEnabled: false` is the **emergency kill switch** — flip it off in Admin Panel to instantly unlock everyone without a new release.

**Note:** client-side version/signature checks raise the bar but are not a substitute for server-side security — payment/wallet logic must keep enforcing its own checks (RLS + Edge Function checksum) regardless of what version a client claims.

---

### 16c. SCHEMA/CODE COLUMN MISMATCH FIXES (2026-07)

Found via live Supabase Postgres error logs (`column X does not exist`). Two categories:

**Pure code bugs (no schema change — fixed in JS):**
| Wrong column the code used | Real column | Fixed in |
|---|---|---|
| `matches.match_time` | `scheduled_at` | `supabase-rtdb-bridge.js`, `admin-scheduler.js`, `admin-supabase-sync.js`, `admin-fixes-v25-SUPABASE.js` |
| `matches.name` (write) | `title` (`name` is `GENERATED ALWAYS AS (title) STORED` — can't be written directly) | same files |
| `matches.game_mode` / `match_type` / `map_name` | `mode` / `match_sub_type` / `map` | `supabase-rtdb-bridge.js` |
| `admin_activity_log.timestamp`, `admin_alerts.timestamp` (generic bridge default) | `created_at` | `supabase-rtdb-bridge.js` (`resolveOrderCol()`) |
| `creator_stats.created_at` (generic bridge default) | `updated_at` | `supabase-rtdb-bridge.js` (`defaultTimeCol()`) |

**Genuinely missing columns (schema migration — see SECTION 21 in `COMPLETE_SCHEMA.sql`):**
- `users.last_seen` — powers the admin "active users in last 10 min" stat (`fix13-realtime-analytics.js`)
- `users.is_deleted` — soft-delete flag used by the active-user list filter (`admin-fixes-v25-SUPABASE.js`)
- `wallet_transactions.status`, `.reviewed_at`, `.reviewed_by` — sponsored-withdrawal approve/reject flow (`admin-supabase-sponsored.js`) was throwing on every click since none of the 3 existed

**Action required:** run the SECTION 21 block from `COMPLETE_SCHEMA.sql` against the live Supabase project once (safe/idempotent — `ADD COLUMN IF NOT EXISTS`).

---

## 17. SECURITY & ANTI-CHEAT

**`js/anti-cheat.js`** — v31 FIXED (syntax error was here)
- Device fingerprinting → Firebase `deviceJoins/`
- Duplicate join prevention
- Headless browser detection

**`js/security-patches.js`**
- Join rate limit (1 join/4s)
- Self-exclusion live DB check
- Offline queue routing
- Referral code lock

**`js/legal-compliance.js`** — MES system
- State ban check
- Age gate (18+)
- Self-exclusion periods
- Legal footer on payment screens

---

## 18. LEGAL COMPLIANCE

**PROGA 2025 Compliant because:**
- Sky Diamonds = virtual entry currency (not real money tokens)
- Green Diamonds = non-withdrawable virtual prizes
- Sponsor tournaments = free entry + sponsor prizes
- Platform falls under eSports exemption

**Never break these rules:**
```
❌ Real money withdrawal
❌ Coins purchasable with money
❌ Green Diamonds ↔ real money
❌ Guaranteed returns on entry
```

---

## 19. HOW TO ADD A NEW FEATURE

**Step 1 — Create `features/your-feature.js`:**
```javascript
/* ================================================================
   FEATURE NAME — description
   v31 Pattern: Supabase only, no Firebase writes
   Tables: your_table_name
================================================================ */
(function() { 'use strict';

function _s()  { return window._supa; }
function _uid(){ return window.U && window.U.uid; }
function _ud() { return window.UD || {}; }

window.showMyFeature = function() {
  if (!_uid()) { if (window.toast) toast('Pehle login karo', 'err'); return; }
  if (!_s())  { if (window.toast) toast('Connection error', 'err'); return; }

  openModal('🎯 Feature Title',
    '<div id="myFeatCont" style="min-height:120px">' +
    '<div style="text-align:center;padding:30px;color:var(--txt2)">' +
    '<i class="fas fa-spinner fa-spin"></i></div></div>'
  );
  _load();
};

function _load() {
  _s().from('your_table')
    .select('*')
    .eq('user_id', _uid())
    .order('created_at', { ascending: false })
    .limit(20)
    .then(function(r) { _render(r.data || []); })
    .catch(function() {
      var c = document.getElementById('myFeatCont');
      if (c) c.innerHTML =
        '<div style="color:#ff6b6b;text-align:center;padding:20px">' +
        'Load error — dobara try karo</div>';
    });
}

function _render(items) {
  var c = document.getElementById('myFeatCont');
  if (!c) return;
  if (!items.length) {
    c.innerHTML =
      '<div style="text-align:center;padding:30px;color:var(--txt2)">' +
      '<div style="font-size:36px;opacity:.3;margin-bottom:8px">🎯</div>' +
      'Kuch nahi mila</div>';
    return;
  }
  var h = '<div style="display:flex;flex-direction:column;gap:8px">';
  items.forEach(function(item) {
    h += '<div style="padding:12px;border-radius:12px;' +
         'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)">';
    h += '<div style="font-size:14px;font-weight:800">' +
         (window.escHtml ? window.escHtml(item.title || '') : item.title) + '</div>';
    h += '</div>';
  });
  h += '</div>';
  c.innerHTML = h;
}

})();
```

**Step 2 — Add to `index.html` BEFORE `core/listeners.js`:**
```html
<script src="features/your-feature.js"></script>
```

**Step 3 — Syntax check (mandatory):**
```bash
node --check features/your-feature.js
```

---

## 20. HOW TO ADD A NEW SUPABASE TABLE

```sql
-- 1. Create table
CREATE TABLE IF NOT EXISTS your_table (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field1     TEXT        NOT NULL DEFAULT '',
  field2     INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. RLS — MANDATORY
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- 3. Policies
CREATE POLICY "yt_select_own" ON your_table
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "yt_insert_own" ON your_table
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "yt_update_own" ON your_table
  FOR UPDATE USING (auth.uid() = user_id);

-- 4. Indexes
CREATE INDEX idx_your_table_user ON your_table(user_id);
CREATE INDEX idx_your_table_date ON your_table(created_at DESC);
```

---

## 21. COMMON CODE PATTERNS

### Balance Deduction (safe)
```javascript
function deductCoins(amt, reason, onSuccess) {
  var cur = (window.UD && window.UD.coins) || 0;
  if (cur < amt) { toast('Coins kam hain — deposit karo', 'err'); return; }
  window._supa.rpc('increment_balance', {
    p_uid: window.U.uid, p_col: 'coins', p_amount: -amt
  }).then(function() {
    window.UD.coins = cur - amt;
    if (window.updateHdr) updateHdr();
    window._supa.from('wallet_transactions').insert({
      user_id: window.U.uid, txn_type: 'debit',
      amount: amt, currency: 'coins', reason: reason
    }).catch(function(){});
    if (onSuccess) onSuccess();
  }).catch(function() { toast('Transaction error', 'err'); });
}
```

### Send Notification
```javascript
function notify(targetUid, type, title, body, refId) {
  if (!window._supa) return;
  window._supa.from('notifications').insert({
    user_id: targetUid, type: type,
    title: title, body: body,
    ref_id: refId || null
  }).catch(function(){});
}
```

### Award Green Diamonds
```javascript
function awardGD(amt, reason) {
  var cur = (window.UD && window.UD.green_diamonds) || 0;
  window._supa.rpc('increment_balance', {
    p_uid: window.U.uid, p_col: 'green_diamonds', p_amount: amt
  }).then(function() {
    window.UD.green_diamonds = cur + amt;
    if (window.updateHdr) updateHdr();
    if (window.logActivity) logActivity('win', '+' + amt + '💎 Green Diamonds!');
  }).catch(function(){});
}
```

### Supabase Realtime Subscription
```javascript
var _channel = null;
function _subscribe() {
  if (!window._supa) return;
  if (_channel) { try { _channel.unsubscribe(); } catch(e) {} }
  _channel = window._supa
    .channel('unique-channel-name')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'your_table',
      filter: 'user_id=eq.' + window.U.uid
    }, function(payload) {
      if (payload.new) _handleNewRow(payload.new);
    })
    .subscribe();
}
```

### Loading / Empty / Error States
```javascript
// Loading
'<div style="text-align:center;padding:30px;color:var(--txt2)">' +
'<i class="fas fa-spinner fa-spin"></i></div>'

// Empty
'<div style="text-align:center;padding:30px;color:var(--txt2)">' +
'<div style="font-size:36px;opacity:.3;margin-bottom:8px">🎮</div>' +
'<div style="font-size:13px">Kuch nahi mila</div></div>'

// Error
'<div style="color:#ff6b6b;text-align:center;padding:20px;font-size:13px">' +
'Load error — dobara try karo</div>'
```

### CSS Variables (inline styles mein use karo)
```
--bg          Background (#050507)
--card        Card background
--txt         Primary text (#fff)
--txt2        Muted text (#7a7a8e)
--border      Border (rgba)
--green       Accent green (#00ff6a)
--yellow      Gold (#ffd700)
--red         Error (#ff2e2e)
--blue        Info (#00d4ff)
--purple      (#b964ff)
--orange      (#ff8c00)
```

---

## 22. v31 CHANGES — WHAT WAS FIXED

### Syntax Errors Fixed (4 files)
| File | Bug |
|------|-----|
| `js/anti-cheat.js` | Missing `}` in if block — headless detection broken |
| `screens/profile.js` | Comment embedded in JS string — profile screen crash |
| `screens/matches.js` | `''` inside onclick string broke gift ticket button |
| `screens/notifications.js` | Same `''` issue in room copy button |

### Critical Logic Bugs Fixed
| File | Bug | Fix |
|------|-----|-----|
| `screens/rank.js` | `UD.coins += adCoins` written twice | Single update |
| `screens/rank.js` | `window.onAdReward` overrode itself → infinite loop | Removed second definition |
| `screens/rank.js` | Ad match join used Firebase only | Supabase `join_requests` |
| `core/listeners.js` | `joinedSlots` missing from `_toMT()` → slot counter = 0 | Added `joinedSlots: _filled` |
| `core/listeners.js` | Bare render calls with no null guard | `if (window.fn) fn()` |
| `core/db.js` | `ignoreDuplicates: false` → simultaneous signup crash | `true` |

### Firebase → Supabase Migrations
| File | Old | New |
|------|-----|-----|
| `bugfix-v30-final.js` | Firebase `clanChats/` | Supabase Realtime `clan_messages` |
| `features/auto-squad.js` | Firebase `autoMatchQueue/` | Supabase `auto_squad_queue` |
| `features/watch-earn.js` | Firebase `watchEarnings/` daily limit | Supabase `watch_earn_log` |
| `features/watch-earn.js` | Firebase `matches/status` poll | Supabase-backed `MT` object |
| `features/checkin-system.js` | Firebase `checkIns/` | Supabase `join_requests.checked_in` |
| `features/checkin-system.js` | Firebase `joinedPlayers/` no-show | Supabase `join_requests` |
| `features/premium.js` | Firebase `premiumRequests/` | Supabase `premium_requests` |
| `features/ads.js` | Firebase `users/uid/coins` double credit | Supabase RPC only |
| `features/seasonal-league.js` | Firebase `appSettings/currentSeason` | Supabase `config` table |
| `screens/room.js` | Firebase `seenRoomPopup/` | `localStorage` (no DB needed) |
| `screens/room.js` | Firebase `joinRequests/id` in-room confirm | Supabase `join_requests.in_room` |
| `screens/room.js` | JR cache only for room reveal | Supabase fallback query |
| `screens/matches.js` | Firebase `giftTickets/` | Supabase `gift_tickets` |
| `screens/profile.js` | Firebase `profileRequests/` | Supabase `profile_requests` |
| `core/router.js` | Firebase `readNotifications/` | Supabase `notifications.is_read` |

### Duplicate Files Deleted (5)
```
js/battle-pass.js      → features/battle-pass.js (canonical)
js/clan-system.js      → features/clan.js + bugfix-v30 (canonical)
js/premium-system.js   → features/premium.js (canonical)
js/spectator-mode.js   → features/spectator.js (canonical)
js/streak.js           → features/streak.js (canonical)
```

### New SQL (MIGRATION_V31.sql — 14 sections)
```
auto_squad_queue        — Auto squad matching
gift_tickets            — Gifted match entries
watch_earn_log          — Daily watch limit tracking
premium_requests        — Premium subscription requests
profile_requests        — Profile verification requests
seasonal_league_history — Past season records
config                  — App config key-value (season, etc.)
join_requests columns   — in_room, checked_in, ad_watched, ign_at_join
users columns           — ff_uid, avatar_bg_color, profile fields
leaderboard view        — Added ff_uid column
clan_messages column    — sender_ign (for fast chat render)
Trigram indexes         — Fast ILIKE search on ign + ff_uid
watch_earn_log index    — user_id + log_date composite
profile_requests index  — status partial index
```

---

## 23. CREATOR ECONOMY SYSTEM (2026-08 rebuild — supersedes old v32 doc)

### Why this section was rewritten

The original v32 "Creator Economy System" documented below (video
sharing + purchase-triggered commission + a creator-match-hosting UI)
was **never actually working**. A 2026-08 audit found:

- `features/creator-video-feed.js` and the video-sharing half of
  `features/creator-match-host.js` had **zero callers anywhere** —
  dead code from day one, confirmed via exhaustive grep across both
  panels. Removed entirely.
- The old commission model paid a creator the instant someone *bought*
  Sky Diamonds with their code — even if that buyer never played a
  single match. `core/db-bridge.js` never even mapped the
  `creatorProfile` Firebase path to Supabase, so every "signup" before
  this fix wrote to a dead end and no creator ever actually got set up
  correctly in the first place.
- `matches`/`join_requests` RLS only allows admin writes — the old
  match-hosting UI's raw `db().ref('matches/...').set(...)` calls
  would have been rejected by the database even if a creator reached
  that screen. Nothing was actually exploitable, but nothing worked
  either.

This section documents the system as it actually exists now.

### Product model (confirmed decisions — do not change without re-confirming)

1. **Creator Program requires an active Premium subscription (Gold
   tier or above)** — this is enforced in three places independently:
   the signup UI, `approve_creator_application` (checks at approval
   time), and `creator_create_match` (checks every time a match is
   created, so a lapsed Premium blocks new hosting even for an
   already-approved creator).
2. **Commission triggers on SPEND, not purchase.** A referred user
   must actually pay a Sky Diamond entry fee into a real paid match.
   25% of that entry fee goes to the referring creator, every single
   time that user plays — not a one-time payout. Enforced entirely
   server-side inside `validate_and_join_match`.
3. **Creators host their own matches end-to-end** — create, set room,
   submit results — through dedicated SECURITY DEFINER RPCs, never
   raw table access (RLS blocks that regardless). Hard limits: entry
   fee ≤ ₹50, ≤ 100 slots, ≤ 3 open matches per creator at once.
4. **Result auto-approves by default.** The moment a creator submits
   results, prizes credit immediately and the match completes — zero
   admin work for the normal case. Only genuinely anomalous results
   (impossible kill totals, a suspicious repeat-winner pattern, or a
   payout over the ₹500 safety cap) get held in `creator_result_flags`
   for Admin to review via the **Creator Match Review** section in
   Admin Panel (repurposed from the old, unused Creator Video Review
   slot — same nav position, same badge behavior).
5. **A creator can never pay themselves.** Self-play is blocked at the
   DB level (`validate_and_join_match` raises `SELF_PLAY_BLOCKED` if
   `matches.creator_uid = p_uid`) — a host cannot join, and therefore
   cannot win a prize in, their own match.
6. **Notifications are opt-in via follow, never a platform blast.**
   `creator_follows` — a user must explicitly follow a creator before
   getting notified about that creator's new matches. Prevents "har
   vakt irritating" notification fatigue.
7. **Trust system with real teeth.** Players rate creator-hosted
   matches after playing (`rate_creator_match` — only if they actually
   joined, one rating per match). A creator's `users.creator_rating`
   is public. Confirmed cheating (`admin_confirm_creator_cheat`) voids
   the match, refunds every player, and strikes the creator:
   **3 strikes → 30-day hosting suspension + Premium is cancelled**,
   **6 strikes → permanent ban from Creator Program**
   (`is_creator = false`, `creator_suspended_permanently = true`).
   A sustained low rating (≤2.0 average with 10+ ratings) also
   auto-adds a strike even without a specific admin-caught incident.

### Files — User Panel

| File | Role |
|------|------|
| `features/premium-creator.js` | Signup (Premium-gated), dashboard, commission history, follow/rating entry points |
| `features/creator-match-host.js` | Match creation form, room-ID entry, result submission, public creator profile (follow button + rating), rewritten 2026-08 to call RPCs only — **no direct table writes** |
| `core/utils.js` | `isPremiumActive(minTier)` — the one shared premium-tier check every gate uses |

Removed entirely (dead code, zero callers): `features/creator-video-feed.js`
and its `<script>` tag in `index.html`.

### Files — Admin Panel

| File | Role |
|------|------|
| `js/fa-creator-video-review.js` | Repurposed (2026-08) from the unused Creator Video Review into the Creator Match Review flag queue — `loadCreatorMatchFlags()`, `adminDismissCreatorFlag()`, `adminConfirmCreatorCheat()`, `loadCreatorStrikeHistory()`, `adminLiftCreatorSuspension()` |
| `index.html` | Nav item + section repurposed from `creatorVideoReview` → `creatorMatchReview`, same sidebar slot |

### Supabase tables

| Table | Purpose |
|-------|---------|
| `creator_applications` | Signup requests, admin approves/rejects |
| `creator_codes` | code → creator_uid lookup (the table `validate_and_join_match`'s commission logic actually reads) |
| `creator_stats` | Running totals: `total_matches`, `total_earnings` |
| `creator_commissions` | Per-match commission ledger, hold → eligible → paid |
| `creator_matches` | Links a `matches` row to its hosting creator + commission terms |
| `creator_follows` | Opt-in follow relationships (new, 2026-08) |
| `creator_match_ratings` | Per-match 1-5 star ratings (new, 2026-08) |
| `creator_result_flags` | Anomaly queue for Admin review (new, 2026-08) |
| `creator_videos`, `video_reports`, `video_watches` | Legacy — tables still exist (harmless to leave), but nothing writes to them anymore. Safe to drop in a future cleanup once confirmed unused in analytics. |

### Key RPCs

| RPC | Purpose |
|-----|---------|
| `validate_and_join_match` | The money-movement chokepoint for every match join — also where self-play block and creator commission attribution live |
| `approve_creator_application(uid, code)` | Admin approves signup — checks active Premium, populates BOTH `users.creator_code` and `creator_codes` (the 2026-08 fix — the old version only did the first, so commission could never fire even for approved creators) |
| `creator_create_match(...)` | Creator hosts a new match — validates Premium + suspension + limits, notifies followers only |
| `creator_set_room(match_id, room_id, room_password)` | Creator sets room → match flips to `live` |
| `creator_publish_result(match_id, results[])` | Auto-approves + pays out, OR flags for review — see anomaly rules above |
| `rate_creator_match(match_id, stars, reason)` | Player rates a match they joined; feeds `users.creator_rating` + soft auto-strike |
| `admin_dismiss_creator_flag(flag_id)` | False alarm — pays out normally, no strike |
| `admin_confirm_creator_cheat(flag_id)` | Confirmed cheat — voids match, refunds players, strikes creator, cascades to suspension/ban/Premium-cancel at thresholds |
| `finalize_creator_commission(match_id)` | Existing RPC (pre-2026-08, unchanged) — computes creator's 25% cut from a completed match's real entry fees |

### Anti-fraud summary

| Rule | How enforced |
|------|--------------|
| Self-play block | `validate_and_join_match` — DB-level, cannot be bypassed by client |
| No direct table access | `matches`/`join_requests` RLS = admin-only writes; creators only have RPC doors, each independently re-checking ownership |
| Entry fee / slot / open-match caps | Hard-coded constants inside `creator_create_match`, re-validated every call |
| Premium required to host | Checked at 3 points: signup, approval, and every match creation (so a lapse mid-program blocks new hosting) |
| Anomaly auto-flag | `creator_publish_result` — impossible kills, repeat-winner pattern, payout cap |
| Cheating consequence | Match void + player refund + strike, cascading to suspend/ban/Premium-cancel |
| Notification spam prevention | Opt-in follow only — never a platform-wide blast |

---
## 24. v32.1 AUDIT FOLLOW-UP — ADMIN v26 + CROSS-PANEL FIXES

> Yeh section us audit ka record hai jisme Admin Panel v25 → v26 ke
> 10 confirmed bugs fix hue, **aur** Admin Panel cross-check karte
> waqt User Panel mein bhi 1 confirmed display bug mila (alag se fix
> hua). Dono panels iss wajah se ab consistent hain. Pura detail
> niche hai — yeh project ke saath ship hone wala official record hai.

### Admin Panel v26 — kya fix hua

| # | Severity | File(s) | Bug |
|---|----------|---------|-----|
| 1 | 🔴 Critical | `supabase-init-early.js`, `admin-inline.js` | Firebase ID token Supabase ko kabhi forward nahi hota tha → har RLS-protected call "permission denied". Naya `syncFirebaseToken()` + `onIdTokenChanged` auto-refresh. |
| 2 | 🔴 Critical | `admin-supabase-sync.js` | `_patchAdminFunctions()` (approveAddMoney/publishResults/banUser/approveSkyDia/manualCredit Supabase-sync wrapper) kabhi trigger hi nahi hota tha — duplicate client-creation guard decouple kiya. |
| 3 | 🔴 Critical | `firebase-rules.json` | `appSettings`/`adminConfig` pe `.write:false` tha — poora Settings page permission-denied. 6 missing RTDB paths add kiye. **Deploy karna padega — file save hone se khud live nahi hoti.** |
| 4 | 🔴 Critical | `supabase-rtdb-bridge.js` | 6 orphaned paths `FIREBASE_ONLY` mein add kiye, `videoStrikes` subpath-routing, 3 table-name mismatch fix (`battle_pass`→`battle_pass_progress`, `season_history`→`seasonal_league_history`, `auto_match_queue`→`auto_squad_queue`). |
| 5 | 🟠 High | `features-admin.js`, `admin-fixes-v7.js`, `index.html` | Mobile overflow ke 2 confirmed source (quick-actions bar + galat CSS selector se 4 buttons wrong jagah inject) — dono fix, dedicated `#v7ToolsPanel` container add kiya, missing 4th FAB button add kiya. |
| 6 | 🟠 High | `index.html`, `fa-creator-video-review.js` | Creator Video Review feature wire kiya — script tag, sidebar nav-item, containers. |
| 7 | 🟠 High | DB (see below) | 2 missing admin RLS policies — `creator_videos`, `battle_pass_progress`. **Ab COMPLETE_SCHEMA.sql mein hi inline hain — Section 25 dekho.** |
| 8 | 🟡 Medium | `features/fa53-ocr-autofill.js` | `_ocrWorker` vars kabhi declared nahi thi → tab-switch/close pe crash. |
| 9 | 🟡 Medium | `supabase-init-early.js` | `getDB`/`getSupa`/`getAuth`/`getAdminUid`/`escH`/`patchWhenReady` IIFE-local the, global nahi — "Live Attendance" section khulne pe crash. Ab true global (idempotent `window.X = window.X || ...` pattern). |
| 10 | 🟡 Medium | `admin-inline.js` | Dead nav-lookup (hamesha null return) clean kiya. |
| 11 | 🟢 Low | `index.html` | `<option>` ke andar invalid `<img>` tag — emoji se replace. |
| 12 | 🟢 Low | `index.html` | `X-Frame-Options`/CSP meta tags — yeh sirf real HTTP header se kaam karte hain, meta se hate diye (real fix = hosting config, Section 28 dekho). |

### Cross-panel fix — Season History (4 confirmed bugs, dono panel)

Admin Panel ke season-end logic ko User Panel ke season-history display se cross-check karne par 4 independent bugs mile:

| Where | Bug | Fix |
|-------|-----|-----|
| Admin: `supabase-rtdb-bridge.js` → `userFromSupa()` | `stats.matches`/`stats.wins` non-existent columns (`matches_played`/`wins`) padh rahe the — real columns `total_matches`/`total_wins` | Column names fix kiye |
| Admin: `fa63-fa70-automation-bundle.js` → `fa68_checkSeasonReset` (auto, month-end) | Galat columns se tier/points nikalta tha | `calcRk()` se User Panel ke EXACT formula use karta hai ab |
| Admin: `fa-admin-v10-final.js` → `endCurrentSeason` (manual, admin button) | `'stats/rankPoints'` field exist hi nahi karta — ranking meaningless thi | Sab users fetch karke `calcRkScore()` se JS-side sort |
| **User Panel:** `features/match-history.js` → `renderSeasonHistory()` | Display `s.season.name`/`s.final_rank_tier`/`s.final_position` expect karta tha — yeh fields `seasonal-league.js` actually deta hi nahi (`s.seasonName`/`s.finalTier`/`s.points`/`s.badge`). Data sahi hone par bhi UI hamesha placeholder dikhata tha. | Real field names use karta hai ab, `reward`/`emoji` bhi dikhata hai (✅ is zip mein already merged) |
| **User Panel:** `features/seasonal-league.js` | `reward`/`emoji` columns table mein hone ke bawajood map/read nahi ho rahe the | Map kar diya (✅ is zip mein already merged) |

**Naya shared helper:** `window.calcRk`/`calcRkScore`/`calcSeasonReward` — `supabase-init-early.js` (Admin Panel) mein add kiya, User Panel ke `screens/rank.js` formula se **exactly** match karta hua. Dono season-end functions (aur future koi bhi admin code) ab consistent scoring use karte hain — yeh wahi consistency hai jo iss audit ka core goal tha.

### ⚠️ Aapko khud kya karna hai (DB/server access ki zaroorat hai)

1. `firebase-rules.json` deploy karo (Firebase Console ya `firebase deploy --only database`).
2. `COMPLETE_SCHEMA.sql` (poora file) Supabase SQL Editor mein run karo — admin RLS policies already inline hain, separate migration file ki zaroorat nahi.
3. Hosting config mein real `X-Frame-Options: DENY` + `X-Content-Type-Options: nosniff` headers add karo (Firebase Hosting `firebase.json`, Nginx, ya Vercel — client HTML se possible nahi).

### v26.1 — Final pre-production audit (found + fixed in this packaging pass)

Before shipping this zip, every JS file in both panels was syntax-checked,
every script-tag was cross-referenced against actual files (no orphans/no
missing refs), and every admin sidebar section + every user screen was
exercised in a real headless browser (Playwright) at 3 mobile widths with
real fake data injected — not just checked for console errors, but
checked that the data **actually renders**. This caught 4 more critical
bugs that produced **zero console errors** (so the earlier "0 errors
across 33 sections" testing pass legitimately wouldn't have caught them —
they're silent data/crash bugs, not noisy ones):

| # | Severity | File | Bug | Fix |
|---|----------|------|-----|-----|
| 1 | 🔴 Critical | `supabase-rtdb-bridge.js` (`SupaRef`) | `.startAt()`/`.endAt()`/`.startAfter()`/`.endBefore()` were never implemented on the Supabase query-bridge object, only `.orderByChild()`/`.equalTo()`/`.limitToLast()`/`.limitToFirst()` were. Real Firebase supports all of these and **7 call sites across 5 admin files** use them on bridged paths (`users`, `matches`, `adminAlerts`, `adminActivityLog`) — every one crashed with `"... is not a function"`. Affected: Fraud Control Center (penalty-point query + live alerts), Admin Activity Log, season-reset automation, IGN/FF-UID server-side search (the search meant for 500+ user databases), sponsored-tournament pagination. | Implemented all 4 as proper range filters (`.gte`/`.gt`/`.lte`/`.lt` on the `orderByChild` column), translated through to real Supabase queries. |
| 2 | 🔴 Critical | `admin-fixes-v25-SUPABASE.js` → `setupProfileListener` | Called `window.renderProfileRequests(requests)` with a plain `{id: data}` object. The real renderer expects a Firebase-snapshot-shaped object with `.forEach((child) => ...)`. **Profile Verification section crashed every single time it was opened**, with 0 or 100 pending requests — guaranteed, not an edge case. | Added a tiny shared snapshot-shim (`_mkSnap`) that wraps a plain object so `.forEach()` behaves like a real Firebase snapshot; verified end-to-end with real data (renders rows correctly). |
| 3 | 🔴 Critical | `admin-fixes-v25-SUPABASE.js` → `setupProfileUpdateListener` | Called `window.renderProfileUpdateRequests(updates)` — that function **does not exist anywhere in the codebase** (real name is `renderProfileUpdates`). The `typeof === 'function'` guard silently swallowed this, so **Profile Updates section never rendered live data, with no error at all.** | Fixed the name + applied the same `_mkSnap` shim. |
| 4 | 🔴 Critical | `admin-fixes-v25-SUPABASE.js` → `setupUsersListener` (×2: initial load + realtime) | `renderUsers()`, the player-search autocomplete, `admin-player-lookup.js`, and `admin-analytics.js`'s per-user breakdown all read a **lexically-scoped `let usersSnapshot`** declared in `admin-inline.js` (shared across `<script>` tags in the same page, but **not** a `window` property). The Supabase patch only ever set `window.usersCache`, never touched real `usersSnapshot` binding — so it silently stayed `null` forever and **the entire Users table rendered empty by default**, with zero console errors, regardless of how many real users existed in Supabase. *(First attempt at this fix used `window.usersSnapshot = ...`, which looked correct but does nothing — caught only by testing with real injected data, not by the crash/overflow sweep. Confirmed with an isolated multi-`<script>`-tag test that `let` at top level of one script tag is readable/assignable by bare reference from a later script tag, but is never exposed on `window`.)* | Changed to a bare assignment (`usersSnapshot = _mkSnap(window.usersCache)`, no `window.` prefix) so it correctly mutates the real shared binding. Verified end-to-end: injected a fake user and confirmed it renders in the table. |

### v26.2 / v32.2 — Button-click audit (every onclick checked against real definitions)

After a direct question — "is any button actually not working?" — every `onclick="..."`
in both panels was extracted and cross-checked against actual function
definitions (not just "does it crash" — "does the wired-up function exist
at all"). Found and fixed 2 more silent dead buttons, plus 3 more critical
boot-time bugs that this exercise surfaced:

| # | Severity | File | Bug | Fix |
|---|----------|------|-----|-----|
| 1 | 🔴 Critical | `core/db-bridge.js` | `db.ref()` with **no path** (used 3 places: `clan.js` joinClan, `spectator.js` go-live toggle, `fixes-v7.js` poll vote — all do Firebase-style multi-path atomic updates) crashed instantly on every use ("Cannot read properties of undefined"). Worse: even fixing just the crash by routing root-updates to Firebase would have been wrong — every key actually used (`clans/*`, `users/*`, `liveStreams/*`, `polls/*`) is already Supabase-backed, so it would have silently shown "✅ success" while writing to a dead Firebase location nothing reads anymore. | Root `.update()` now splits the multi-path object key-by-key and routes each through the same logic every other call already uses, batching any genuinely-Firebase-only keys into one real Firebase update and dispatching Supabase-bound keys individually. |
| 2 | 🔴 Critical | `js/fix5-listener-manager.js` | The *exact same* joinRequests listener was registered **twice** back-to-back — a broken first attempt (crashed every boot, see #1) immediately followed by a comment "Direct ref approach (more reliable)" and a second, correct, fully redundant copy. Classic leftover-after-a-fix that never got cleaned up. | Deleted the broken first copy, kept the working one. |
| 3 | 🟠 High | `js/fix5-listener-manager.js` | Uncovered only after fixing #2 (was previously unreachable — #1 always crashed first): `fn: arguments.callee` — illegal in strict mode (throws), and even without that, it captured the wrong function reference entirely (the outer IIFE, not the actual listener callback), so `LM.off()`/`destroyAll()` could never have detached this listener correctly anyway. | Named the callback properly and stored that reference instead. |
| 4 | 🟠 High | `js/fixes-admin-v9.js` | `replaceGDInNode()` (replaces the Green Diamond `<img>` placeholder with the real icon) was declared inside one IIFE; a second, separate IIFE (`_patchModalGD`, patches `openAdminModal`/`showAdminModal` etc. to re-run the replacement after any modal opens) called it without access to it. **Every single admin modal open threw `replaceGDInNode is not defined`** 60ms after opening, and Green Diamond icons inside dynamically-rendered modals never got replaced. | Exposed it as `window.replaceGDInNode`, same pattern already used for `window.ADMIN_GD` one line above it. |
| 5 | 🟡 Medium | `screens/profile.js`, `js/features-user.js` | "My Suggestions", "Performance Dashboard" (profile screen) and "Result" screenshot button (match history) called functions that don't exist anywhere — silent dead taps, no feedback at all. | Wired up clear "feature coming soon" toasts instead of leaving them silent — not a fake implementation, just honest feedback instead of a tap that looks broken. |
| 6 | 🟡 Medium | `js/admin-inline.js` | "DB Rules" header button (`showSecurityRules`) — same silent-dead-button issue. | Implemented properly: fetches and displays the actual deployed `firebase-rules.json` so it's a real, useful reference, not a stub. |
| 7 | 🟡 Medium | `js/features/fa28-fa43-fraud-control-center.js` | "Fraud Scan" header button (`runFraudScan`) — same issue, but a fully-built, already-correct feature (`showFraudScoreDashboard`) already existed for exactly this — just never aliased to the name the button expected. | `window.runFraudScan = window.runFraudScan \|\| window.showFraudScoreDashboard;` — same alias pattern this codebase already uses elsewhere. |

### v32.3 — Calendar removal + UI polish + compliance text fix

| # | Severity | File(s) | What |
|---|----------|---------|------|
| 1 | 🟡 Cleanup | `js/features-user.js`, `features/match-history.js`, `js/fixes-v7.js` | Calendar feature fully deleted (not just hidden). Previously: a real calendar was built (`showMatchCalendar`, `showTournamentCalendar`), the button to open it was removed at some point, but the function bodies were left behind as dead code — and a separate runtime hack (`_rmCal` in fixes-v7.js) existed just to forcibly delete a `#mesCalWrap` DOM node that, by this point, nothing even creates anymore. All of it is now gone: both dead functions and the now-pointless cleanup hack. |
| 2 | 🔴 **Compliance risk** | `js/features-user.js` | The first-login onboarding tutorial told every new user, in the "Wallet" step: *"UPI se paise add karo aur jeetne par direct bank mein lo"* (add money via UPI, take it straight to your bank when you win) — this directly contradicts the app's own Withdrawal Policy modal shown moments later ("Match jeetne par koi real-money prize nahi milta") and the project's PROGA-2025 compliance stance (virtual currencies only, no real-money withdrawal from gameplay). Reworded to accurately describe the real model (Sky Diamonds via UPI, Coins/rank/rewards on winning, explicitly skill-based not real-money). Worth a careful read of any other onboarding/marketing copy for the same kind of drift between what was written and what the policy actually says. |
| 3 | 🟢 Polish | `index.html`, `style.css`, `features/growth.js` | The two horizontally-scrollable chip rows on the home screen (quick-access icons, special-event pills) cut off abruptly at the screen edge with no hint there's more to scroll. Added a reusable `.scroll-fade-x` class (soft mask-image fade on the trailing edge — the standard mobile "swipe for more" cue) and applied it to both. |

**Note on this round of UI review:** screenshots taken in this sandbox initially looked broken (several icons render as empty boxes, e.g. the header search/bell icons) — that's because FontAwesome loads from `cdnjs.cloudflare.com`, which this offline sandbox can't reach, not a real bug. With a temporary local emoji stand-in (test-only, not shipped) the actual screens render cleanly: card-based layout, consistent color-coding, decent visual hierarchy on Home/Wallet/Rank/Profile. The bottom nav's "Matches" button having a raised, colorful FAB-style treatment is intentional design (like Instagram's center button), not a layout bug — it only looked confusing in screenshots because its icon was invisible for the same CDN reason.

### v32.4 — Profile page click audit

Every clickable item on the Profile screen (23 distinct onclick targets) was
called directly in a real browser and checked for an actual visible result
(modal/sheet opening, or — for the 3 still-stubbed buttons from the earlier
audit — the "coming soon" toast), not just "does it exist".

| # | Severity | File | Bug | Fix |
|---|----------|------|-----|-----|
| 1 | 🔴 Critical | `features/clan.js` | `renderClanBrowse()` was called from the Supabase branch of `_showClanBrowse()` but never defined anywhere — **any user without a clan** (the majority, especially new users) crashed instantly the moment they tapped "Clan" from their profile. The Firebase-fallback branch right below it had the exact correct rendering logic inline (never reached, since the Supabase branch returns first when `window._supa` exists) — extracted that into a real shared `renderClanBrowse()` function so both branches use the same, now-correct implementation. Verified end-to-end: Clans modal opens correctly with real buttons and empty-state message. |

Everything else on the profile screen checks out:
- `showProfileSettings`, `showProfileUpdate`, `showClanHome` (now fixed) each have 2-3 layered definitions across files (`profile.js`/`clan.js` base + `ui-fixes.js`/`premium.js`/`bugfix-v30-final.js` wrappers) — all follow the same intentional "capture original, wrap it" pattern used throughout this codebase, none are silently conflicting.
- `saveTM` correctly no-ops outside its actual context (the "Add Teammate" sheet, where its expected `#tmUid` input exists) — calling it standalone (as a raw click-test does) isn't a real usage scenario.
- The 3 "coming soon" buttons fixed in the earlier audit (My Suggestions, Performance Dashboard) still correctly show their toast — flagging again here since they're honest placeholders, not real features yet, in case that's not what's wanted long-term.

### v32.5 — My Suggestions + Performance Dashboard (fully implemented)

Both stub buttons that previously only showed "coming soon" toasts are now
real, working features:

**My Suggestions** (`screens/profile.js`, `features/fa26-poll-suggestion.js`, `COMPLETE_SCHEMA.sql`)

Users can submit platform feedback from their profile → "My Suggestions".
Each submission saved to a new `user_suggestions` Supabase table (Section 16
in `COMPLETE_SCHEMA.sql` — 87 tables total now). The modal shows: a submit
textarea with length validation (10–500 chars), a filter-based list of all
past submissions with their current status (Pending / Reviewed / Implemented
/ Declined), and any admin reply inline. Admin panel gets a new "User Feedback"
button (header, next to existing Suggestions) that opens a full admin view:
filter by status, one-tap status update, or a "Reply" action that writes back
to `admin_reply` and marks the entry as Reviewed — user sees it immediately
on next open.

**Performance Dashboard** (`screens/profile.js`)

Real data from `join_requests` — same table match-history reads, but aggregated
instead of listed. Shows: total matches, win rate %, average kills/match, best
placement ever (4 stat cards), a mode breakdown with visual win-rate bars (Solo/
Duo/Squad), and a "Recent Form" strip of last 10 matches with placement + kills.
Uses the same async-load-into-existing-modal pattern as the Suggestions feature.

**SQL note**: `user_suggestions` table (Section 16) ships inside
`COMPLETE_SCHEMA.sql`, which is now fully idempotent (v32.6, see Section 25)
— just run the whole file on the live DB, it'll add this table cleanly
without touching anything else.

### v32.6 — `COMPLETE_SCHEMA.sql` made fully idempotent (bulletproof, zero data loss)

User ne specifically pucha: file kitni bhi baar run karo, na koi existing
table dobara bane (error de), na kisi table ka data delete ho. Pehle yeh
file 3 jagah se non-idempotent thi:

| # | Problem | Fix |
|---|---------|-----|
| 1 | 🔴 `DROP SCHEMA IF EXISTS public CASCADE;` at the very top — running this file a second time on a live DB would **permanently delete every table and every row**, no undo. | Removed entirely. Replaced with `CREATE SCHEMA IF NOT EXISTS public;` and a comment showing the exact hard-query if a real wipe is ever genuinely needed (must be run separately, by hand, never added back to this file). |
| 2 | 🟠 162 of 190 `CREATE POLICY` statements had no `DROP POLICY IF EXISTS` before them — re-running the file would fail with `policy "x" for table "y" already exists` the moment it hit the first one. (28 already had this from an earlier session, in a slightly inconsistent "grouped" style.) | Every single `CREATE POLICY` now has its own `DROP POLICY IF EXISTS <exact name> ON <exact table>;` immediately before it — verified statement-by-statement (dollar-quote-aware SQL splitter) that all 191 pairs match by name and table, 1:1, no orphans. |
| 3 | 🟡 Triggers were already idempotent from an earlier session (`DROP TRIGGER IF EXISTS` before each of the 4) — verified this is still correct and intact, not touched. |

**Already-correct patterns, verified, left alone:** all 87 `CREATE TABLE`
use `IF NOT EXISTS` (rows are genuinely never touched — these statements
no-op completely if the table exists, full stop). All 57 `CREATE INDEX` use
`IF NOT EXISTS`. All 17 functions use `CREATE OR REPLACE FUNCTION` (logic
updates cleanly, no data involved). All 87 `ALTER TABLE ... ENABLE ROW
LEVEL SECURITY` statements are naturally idempotent in Postgres on their
own. A full scan for any other `DROP` statement in the file (`DROP TABLE`,
`DROP COLUMN`, `DROP TYPE`, etc.) found **zero** — the only two DROP
statement types anywhere in the file are the safe `DROP POLICY IF EXISTS`
and `DROP TRIGGER IF EXISTS` described above.

**If a real wipe is ever genuinely wanted** (fresh test DB, starting over
on purpose): that's a "hard query", intentionally **not** part of this
file. The exact command is documented in a comment at the top of
`COMPLETE_SCHEMA.sql` — copy it out, run it by itself in the SQL Editor,
confirm it's really what's wanted, then run `COMPLETE_SCHEMA.sql` again
afterward to rebuild everything fresh.

**Confirmed NOT bugs** (investigated and ruled out during this pass, noted here so nobody "fixes" them again unnecessarily):
- User Panel registers its service worker from **two** places (`index.html` → `/ff-user-panel/sw.js`, scope `/ff-user-panel/`; `core/bugfixes.js` → `/sw.js`, scope `/`, with retry backoff). This looks like duplicate logic but isn't — the app ships to **two real domains** (GitHub Pages at `.../ff-user-panel/` *and* Cloudflare Workers at root, per `android/app/src/main/java/.../MainActivity.java`). Each registration is the correct one for a different deployment target; on any given domain, exactly one succeeds and the other harmlessly 404s.
- `safe-loader.js`'s "Splash still visible after full load — forcing hide" warning is an intentional watchdog ("blank screen kabhi nahi"), not a bug — it only fires as a safety net and did its job correctly when tested.

### Known, intentionally-not-fixed item

`userFromSupa()` converter mein 12+ aur fields (`level`, `exp`, `totalWinnings`, `referralCount`, `premiumTier`, `premiumExpiresAt`, `status`, `approved`, `pendingUid`, `profileRequired`, `accessMode`, `profileVerified`, `lastSeen`) `users` table mein columns hi nahi hain. Sirf woh 2 fix kiye jo season-history ko block kar rahe the (`matches`/`wins`). Baaki 12+ ko nahi chheda — alag features affect karte hain jo abhi scope mein nahi the, aur kuch genuinely planned-but-not-built features ho sakte hain. Galat guess karne se better hai transparently batana — agar zaroorat ho to separate pass mein poora audit ho sakta hai.

### v32.7 — Secret Migration (ImgBB) + Paytm UPI Auto-Payment Integration

**1. ImgBB key ab client mein nahi hai**

| Problem | Fix |
|---|---|
| `IMGBB_KEY` `core/imgbb.js` mein hardcoded thi — GitHub Pages pe static hosting hone ki wajah se **publicly readable** thi. Koi bhi browser DevTools se key chura ke apni images ImgBB pe (tumhare account ke quota se) upload kar sakta tha. | Nayi Edge Function `imgbb-upload` banayi — key ab sirf Supabase secret mein hai, kabhi client ko nahi bheji jaati. `core/imgbb.js` (User) aur `js/imgbb.js` (Admin) dono ab is function ko Firebase ID token ke saath call karte hain (sirf logged-in users upload kar sakein). `admin/index.html` se `window.IMGBB_KEY` line hata di gayi. Response shape same hai (`d.data.url`) — koi calling code todna nahi pada. |

**2. Paytm UPI Instant Checkout — naya optional payment path**

3 naye Edge Functions + `_shared/paytm.ts` (Section 3 mein poora structure hai). Manual UPI screenshot flow **already-working hai, replace nahi hua** — Paytm sirf ek extra button hai jab configure ho.

| Piece | Kaam |
|---|---|
| `paytm.ts` | Paytm ka official checksum algorithm (AES-128-CBC + SHA-256) — idempotent credit helper bhi yahin hai taaki webhook + client-poll dono fire ho jayein to bhi double-credit kabhi na ho |
| `paytm-create-order` | Firebase token verify → `sd_requests` mein pending row (`request_type='paytm_auto'`) → Paytm Initiate Transaction (UPI-only mode) → `txnToken` client ko |
| `paytm-callback` | Paytm ka webhook target — incoming data pe trust nahi karta, orderId se khud Paytm Transaction Status API call karta hai (ground truth) → `TXN_SUCCESS` par hi credit |
| `js/paytm-checkout.js` | Frontend — Edge Function call → Paytm JS SDK popup → 5-second poll `sd_requests` status pe (webhook slow ho to bhi UX theek rahe) |
| Admin: `js/fa-app-settings.js` | App Settings mein naya "⚡ Paytm Instant Checkout" ON/OFF toggle — jab tak secrets set nahi, OFF rakhna (button users ko dikhega hi nahi) |

**✅ Zero SQL changes required** — `sd_requests`, `wallet_transactions`, `notifications` tables aur `increment_balance()` RPC pehle se hi is flow ke liye kaafi hain. `COMPLETE_SCHEMA.sql` is feature ki wajah se bilkul unchanged hai (verified column-by-column against both Edge Functions).

**3. Android — custom URI scheme fix (`MainActivity.java`)**

| Problem | Fix |
|---|---|
| WebView sirf `http://`/`https://` URLs handle karta tha. Paytm/UPI apps `upi://`, `gpay://`, `phonepe://`, `intent://` links se khulte hain — yeh silently fail ho rahe the (koi error nahi, bas kuch open nahi hota tha). | `shouldOverrideUrlLoading` mein custom-scheme handling add ki — `intent://` ke liye `Intent.parseUri()`, baaki sab custom schemes ke liye `ACTION_VIEW`. Dono main WebView aur popup WebView (naya window khulne wale flows) mein fix kiya. |

**⚠️ Abhi kya PENDING hai** (khud karna hai, jab time mile):
- Paytm business account (`business.paytm.com`) banake KYC complete karna, MID + Merchant Key lena
- Tab tak: sirf ImgBB secret migration live hai, Paytm button admin toggle se OFF/hidden rehta hai, manual UPI flow normal kaam karta hai
- Deploy steps Section 25/26 mein hain

---

### v32.8 — Full Cross-Panel Audit (verified 31 previously-reported bugs + found 4 new ones)

A prior set of 3 bug-hunting sessions had left behind 31 numbered findings
(12 for Admin, 19 for User) that were never individually checked off against
the actual shipped code. This pass verified every single one against
AdminPanel v26.3 / UserPanel v32.7 line-by-line, fixed the ones still real,
and documented the ones that were already fixed or never real to begin with —
so nobody re-investigates them again.

**Result: 27 of the 31 were already fixed or not real bugs to begin with — only 5 needed action.** Full disposition of all 31, so the record is complete:

| Old # | Panel | Verdict |
|---|---|---|
| Admin #1 | Admin | 🔴 **Real — fixed** (see below) |
| Admin #2 | Admin | 🔴 **Real — fixed** (see below) |
| Admin #3–#10 | Admin | ✅ Already fixed in v26.3 (join_requests refund sync, atomic wallet transaction, Supabase range-query bridge, room notification dual-write, profile-approve Supabase sync, 3 doc typos already correct) |
| Admin #11 | Admin | 🟢 Minor — applied (`nav-section-label` font-size 9px→11px, mobile) |
| Admin #12 | Admin | Not a real selector (`.topbar_logout-btn` doesn't exist) — mobile already handled via `.hide-mobile` span on the label |
| User #1–#2 (doc set 1) | User | ✅ Already fixed, better than originally proposed (`_joinInFlight` guard, ban-check built directly into `doJoin`) |
| User #3 (doc set 1) | User | Misdiagnosed at the time — real bug was different, see 🔴 New Bug B below |
| User #4 (doc set 1) | User | ✅ Already fixed (bounded self-clearing interval, not an infinite loop) |
| User #5–#6, #9, #13–#14 | User | ✅ Already fixed in v32.7 |
| User #7 | User | Not a bug — epoch timestamps (`Date.now()`) are timezone-agnostic; the proposed "IST fix" would have *introduced* a 5.5hr bug |
| User #8 | User | Misdiagnosed at the time — real bug was different, see 🔴 New Bug B below |
| User #10 | User | Not a bug — Sky Diamonds are intentionally the paid-match currency, not combined real-money balance |
| User #11 | User | Not a bug — "My Matches"/"Special" tabs filter on different dimensions (status/special-type) by design, mode-filter doesn't apply there |
| User #12 | User | 🟡 **Real — fixed** (see below) |
| User #15 | User | Not a bug — the `waitFor`/`_v7RankInstalled` one-shot-install pattern was misread; it works correctly |
| User #16 | User | 🟢 Minor — applied (defensive `typeof cb === 'function'` guard) |
| User #17 | User | ✅ Already fixed (clan-war pill uses the same bounded self-clearing pattern as city-championship) |
| User #18 | User | Not a bug — plain top-level `function` declarations are global by default; no IIFE/module wrapper hides it |
| User #19 | User | ✅ Already fixed (`_cfgLoaded` already set at the end of `_applyCfg`, not in `loadAppConfig`) |

**🔴 New Bug A — dead AdManager file silently un-deadened itself and won reward-ad conflicts**

`js/ad-manager.js` (an old pre-refactor version of the ad system, superseded by
`features/ads.js`) was correctly removed from `index.html`'s static `<script>`
tags at some point — but nobody noticed `js/safe-loader.js` *dynamically*
re-injects it anyway (`FEATURE_SCRIPTS` array, loaded after DOMContentLoaded,
i.e. **after every static script including `features/ads.js` has already run**).
Because it's loaded last, its hard `window.watchAdForCoins`/`window.AdManager`/
`window.onAdRewarded` assignments silently overwrote the current ones —
wiping out the daily ad-limit, the CFG-driven reward amount, the Supabase
balance sync, and even the `battle-pass-xp.js` reward-XP wrapper (which relies
on wrapping, not replacing, `window.onAdRewarded`). Net effect in the shipped
APK: watching a rewarded ad credited a hardcoded +5 coins with **no daily cap**
(farmable) and **never touched Supabase** (so the credited coins didn't
reliably show in the balance the rest of the app reads). This is very likely
the same class of issue as the "duplicate `watchAdForCoins()`" conflict fixed
earlier — that fix addressed the static `<script>` tags but missed the
dynamic loader still pulling the old file back in. **Fix:** removed the
`{ src: 'js/ad-manager.js' }` entry from `safe-loader.js`; deleted the now
fully-orphaned file. `features/ads.js` is the sole AdManager implementation now.

**🔴 New Bug B — `sponsored_winnings` / `referral_popup_done` never reached the UI (this is what old #3 and #8 were actually circling)**

Both columns are written by existing code (`fa-sponsored-system.js` on the
Admin side; `referral-system-fix.js` on the User side) but:
1. **They didn't exist in `COMPLETE_SCHEMA.sql` at all** — every write to
   them against a schema-only DB would have failed outright with an
   unknown-column error. Added via a new `ADD COLUMN IF NOT EXISTS`
   migration (Section 18 of the schema file, additive/safe).
2. Even once present, `core/listeners.js` → `_applyUser()` (the function
   that populates `window.UD` from the Supabase row on every login and
   every realtime update) never copied `sp.sponsored_winnings` or
   `sp.referred_by`/`sp.referral_popup_done` onto `UD`. Concretely this meant:
   - `screens/wallet.js`'s sponsor-tournament withdrawal card always
     computed a ₹0 balance and never rendered — sponsor-tournament
     winners had no way to withdraw, silently.
   - `UD.referredBy` was always `undefined`, so the "already applied a
     referral code" input-lock in `security-patches.js` never engaged.
   - The first-login referral popup's own re-show guards (`UD.referredBy`,
     `UD.referralPopupDone`) never worked; only the per-device `localStorage`
     flag was actually preventing repeats — which meant reinstalling the
     app or logging in on a second device showed the popup again even for
     users who had already skipped/applied it once.
   **Fix:** added the missing `_applyUser()` mappings; also made
   `showFirstLoginReferralPopup()` persist `referral_popup_done: true` to
   Supabase (it only wrote to Firebase RTDB `users/` before, which this
   app's post-migration client no longer reads for this field).

**🟡 New Bug C — duplicate CSS payload**

`style.css` and `js/user-ui-v10.css` were ~99% byte-identical (778 of 791
lines) and both loaded on every page load. Kept `style.css` (the strict
superset — it has 13 lines `user-ui-v10.css` lacked, for `.special-access-bar`
scroll behavior and `.scroll-fade-x`), removed the `<link>` for
`js/user-ui-v10.css`, removed it from `sw.js`'s precache list, and deleted
the now-unused file. `styles.css` (with the s — the actual base theme file)
is unrelated and untouched.

**Also bumped:** `sw.js` `CACHE_VER` → `me-v32-8` so existing installs
actually pick up this pass's fixes instead of serving stale cache-first files
indefinitely.

---

---

### v32.8.1 — Live Test Report Fix (Critical) — closeModal() was globally broken

Reported live on a deployed build: the X (close) button did nothing
**anywhere in the app**, and the Withdrawal Policy screen could never be
dismissed. Traced to `js/fixes-v10-all-bugs.js`'s "New Bug 7 Fix":

```js
// BROKEN:
var modal = document.getElementById('modal');   // this id doesn't exist — real one is 'modalOv'
if (modal && (...)) { _origCloseModal(); }        // always false → real close() never ran
```

Since `document.getElementById('modal')` always returned `null` (the real
overlay is `id="modalOv"`, defined in `core/modal.js`/`index.html`), the
guard was permanently false and the actual `closeModal()` logic **never
ran, for anything, from the moment this file loaded** — not the header X
button, not tap-outside-to-close, not the Withdrawal Policy's own confirm
flow. This is a maximum-severity UX bug (the whole app becomes a one-way
door once any modal opens) hiding behind an innocuous-looking null-check.
Fixed to use the correct id + the real `'show'` class check, with a
fail-open default so a missing element never again silently blocks a
close request.

**Also found in the same pass** (schema/table cross-reference, not
user-reported): `bundle_requests` table referenced by
`features/bundle-offers.js` didn't exist — bundle purchase submissions
were failing *after* the user had already sent real UPI money, with
no record and no admin visibility. Same root issue affected Annual Plan
purchases (missing `plan_type` column) and the approve/reject buttons for
Sky Diamond / Premium / Profile requests (writing to columns —
`approvedAt/rejectedAt`, `processedAt/processedBy` — that didn't exist on
those tables, so the reward was granted but the request stayed stuck
'pending' forever). All fixed via Section 19/20 schema additions +
routing bundles through the existing `premium_requests` review queue.

**Action needed:** re-run `COMPLETE_SCHEMA.sql` (Sections 19-20 are new,
additive, safe) and redeploy the User Panel + Admin Panel.

---

---

### v32.8.2 — "Permission denied" root cause: firebase-rules.json was missing rules for paths the app actively uses

Both panels deliberately keep a small set of paths on real Firebase RTDB
(everything else is bridged to Supabase) — `core/db-bridge.js`'s
`_isFirebasePath()` whitelist names them explicitly: `.info`, `support`,
`supportTyping`, `supportRequests`, `appSettings`, `admins`, `presence`.
But the actual deployed `firebase-rules.json` only had rules for `support`,
`appSettings`, `presence`, plus some Admin-only paths (`deviceJoins`,
`adminConfig`, `creatorVideos`, etc.) — **`supportTyping`, `supportRequests`,
and `admins` had no rule at all**, so they fell through to the catch-all
`"$other": {".read": false, ".write": false}` and every access to them
returned `PERMISSION_DENIED`. This is exactly the class of error reported —
support-chat typing indicators, support ticket submission (`screens/profile.js`,
`js/features-user.js`), and the admin login access-check (`admin-inline.js`,
`security-patches.js`) were all silently/visibly failing depending on how
each caller handled the error.

**Fixed:** added rules for all 3 missing paths to `firebase-rules.json`
(`supportTyping` and `supportRequests` mirror `support`'s `auth != null`
pattern; `admins` is `.read: auth != null, .write: false` since it's
never written from client code — verified by search — only ever read to
check "is this uid an admin").

Also found `announcements` listed in User Panel's Firebase whitelist but
never actually used by any User Panel screen (verified by search), while
Admin Panel already routes the same path name to Supabase's
`scheduled_broadcasts` table — a dead, inconsistent stub. Removed from the
whitelist rather than adding a 4th Firebase rule for a path nothing reads.

**Action needed:** this is the one fix in this whole audit that isn't just
a code file — `firebase-rules.json` has to be manually published in the
Firebase Console (Realtime Database → Rules tab → paste → Publish). Static
files and Supabase SQL redeploy on their own; Firebase rules do not.

---

---

### v32.8.3 — Root cause: match data reading from Firebase in Admin Panel

User-reported: match data was visibly coming from Firebase instead of
Supabase in the Admin Panel. Traced to a startup race condition in
`js/supabase-rtdb-bridge.js`:

```js
// BEFORE — unconditional 100ms delay before the FIRST install attempt:
setTimeout(installBridge, 100);
```

`admin-inline.js` initializes `rtdb` as **real Firebase**
(`_adminApp.database()`) immediately on load. `supabase-rtdb-bridge.js`
is supposed to replace `window.rtdb` with a Supabase-backed proxy shortly
after — but it waited a flat 100ms before even trying, on top of its own
internal readiness retry. If the admin's Firebase Auth session was cached
(a returning admin, the common case), `onAuthStateChanged` could fire and
reach `initializeAdminPanel()` — which sets up `loadTournaments()`,
`setupJoinRequestsListener()`, `setupWalletListener()`, etc. — **before**
that 100ms elapsed. Anything using a persistent `.on()` realtime listener
that attached during that window stayed bound to raw Firebase for the
rest of the session — reassigning `window.rtdb` afterward doesn't
retroactively fix a listener already attached to the old reference.

**Fixed two ways (belt + suspenders):**
1. Removed the pointless flat delay — `installBridge()` already self-checks
   `window.rtdb.ref` and `window._supa` and retries every 300ms if either
   isn't ready, so calling it immediately only shrinks the race window,
   never breaks anything.
2. `initializeAdminPanel()` now explicitly waits (polls every 100ms, up to
   ~4s, then logs a loud console error if it never resolves) for
   `window.rtdb._isSupaBridge === true` before touching any match/wallet/
   join-request listener — closing the race completely regardless of how
   fast auth resolves in the future.

If match data still appears to come from Firebase after this fix + a hard
refresh, check the browser console for the new
`"Supabase bridge never installed"` error — that would point to
`window._supa` (the Supabase client) failing to initialize at all, which
is a different, upstream problem (check Supabase project URL/anon key in
the config).

---

---

### v32.8.4 — Live Test Report Fixes, Round 2 (no schema changes needed)

Six more issues reported from live testing — full detail in
`UserPanel/BUGFIX_CHANGELOG.md` v32.8.4 entry. Summary: duplicate
`DOMContentLoaded` init block causing the onboarding tutorial to
re-race itself; pull-to-refresh over-triggering on normal scroll
(`overscroll-behavior` strengthened); profile IGN/UID submit swallowing
the real Postgres error instead of showing it; **Daily Check-In (both
the manual button and the automatic on-login version) silently not
working** because they used Firebase-style paths (`lastCheckIn`,
`loginStreak`, `lastLoginDate`, `totalLoginStreak`) with no
`core/db-bridge.js` mapping — rewritten to use the real, already-existing
schema (`users.last_checkin_date`, `users.streak_days`,
`daily_checkins` table, `increment_balance` RPC) instead of adding new
columns; and a stuck notification-bell red dot. No SQL migration
needed for any of these — all fixes were client-side, using
infrastructure that already existed in `COMPLETE_SCHEMA.sql`.

---

## 25. MIGRATION GUIDE — RUN ORDER


**Ek hi file hai ab — `COMPLETE_SCHEMA.sql`.**
Pehle ki 6 alag files (`SUPABASE_SQL_SETUP.sql`, `MIGRATION_V29/V30/V31.sql`,
`supabase-admin-schema.sql`, `ADMIN_MIGRATION_V25.sql`) sab isi ek file mein
merge ho gayi hain.

> ## ✅ v32.6: FILE AB FULLY IDEMPOTENT HAI — JITNI BAAR CHAHO RUN KARO
> Pehle yahan ek critical warning thi ki yeh file sirf fresh/empty DB par
> chalani hai, kyunki uss waqt file mein `DROP SCHEMA IF EXISTS public
> CASCADE;` tha jo **sab data permanently delete** kar deta — har user,
> wallet, match, sab. Woh ab **completely hata diya gaya hai**.
>
> **Ab file kya karti hai, run karne par:**
> - **Tables**: `CREATE TABLE IF NOT EXISTS` — agar table already hai to kuch
>   nahi hota, agar nahi hai to ban jaati hai. **Kisi bhi existing row ko
>   kabhi touch nahi karta.**
> - **Policies**: har ek `DROP POLICY IF EXISTS` se pehle clean karke
>   `CREATE POLICY` se dobara banती hai — values/structure update ho jaati
>   hai agar tumne policy logic change ki ho, lekin yeh sirf access-rules
>   hain, koi user data nahi.
> - **Triggers**: same pattern — drop-then-recreate.
> - **Indexes**: `CREATE INDEX IF NOT EXISTS`.
> - **Functions**: `CREATE OR REPLACE FUNCTION` — naya logic apply ho jaata
>   hai, koi data nahi chhuta.
> - **Schema**: `CREATE SCHEMA IF NOT EXISTS` — kabhi drop nahi karta.
>
> **Matlab**: ab production DB par bhi yeh file jitni baar chaho safely
> chala sakte ho — naye fixes/policies apply karne ke liye, ya verify
> karne ke liye ki sab kuch sahi se laga hua hai. Koi duplicate-object
> error nahi aayega, koi data loss nahi hoga.
>
> **Agar kabhi genuinely poora database wipe karna ho** (sirf testing ke
> liye, ya bilkul fresh shuru karna ho): yeh ek **hard query** hai, is file
> mein kabhi add mat karna. Top par ek comment mein likha hua hai exact
> command — manually copy karke, sochke, alag se run karna:
> ```sql
> DROP SCHEMA IF EXISTS public CASCADE;
> CREATE SCHEMA public;
> ```
> Iske baad `COMPLETE_SCHEMA.sql` dobara run karke sab tables/policies/
> functions fresh ban jaayenge.

```
Supabase SQL Editor mein (fresh ya existing DB, dono par safe):
  → COMPLETE_SCHEMA.sql ka poora content paste karo
  → Run
```

**Is file mein kya hai (15 sections):**
| Section | Kya hai |
|---|---|
| 1–9 | Core tables: users, matches, join_requests, wallet, clans, battle pass, social, requests, admin tables, config |
| 10 | Views: `active_matches` |
| 11 | RPCs: increment/decrement_balance, validate_and_join_match, award_battle_pass_xp, join_clan/leave_clan, vagaira |
| 12 | Seed data: default app_settings + season |
| 13 | **June 2026 audit** — har `.from()` aur `.rpc()` call User Panel + Admin Panel dono mein scan karke jo 12 tables missing thi (user_roles, admins, ff_uid_index, profile_updates, user_matches, tournament_brackets, creator_payouts, leaderboard_archive, clan_war_challenges, duel_records, support_messages, poll_votes) — sab add ki gayi |
| 14 | 2 missing RPCs add kiye: `increment_match_slots`, `increment_poll_vote` |
| **15** | **✅ v32 Creator Economy** — 5 new tables (`creator_videos`, `video_watches`, `video_reports`, `creator_matches`, `creator_commissions`) + 2 RPCs (`finalize_creator_commission`, `release_eligible_commissions`) + Iron Rule trigger (`trg_block_creator_self_play`) + **2 admin RLS policies** (`cv_admin_all`, `bpp_admin_all` — audit follow-up, see Section 24) |
| 16 | `user_suggestions` table (in-app feedback/suggestions) |
| 17 | v32.7 — documentation only, no schema changes (ImgBB + Paytm reuse existing tables, see Section 24) |
| **18** | **✅ v32.8 audit** — 2 missing `users` columns added: `sponsored_winnings` (withdrawable sponsor-tournament winnings), `referral_popup_done` (first-login referral popup gate). Both were already being read/written by app code with no matching column — see Section 24. |
| **19** | **✅ v32.19 (2026-08-01)** — 2 live admin write paths broken by v32.18's blanket table revoke had no replacement RPC: profile approve/reject (`admin_approve_profile`, `admin_reject_profile` — also moves IGN/FF-UID uniqueness checking server-side with row locking) and fraud-score persistence (`admin_set_fraud_score` + missing `fraud_checked_at` column). Also: `leaderboard.created_at` missing column (live Postgres log error), and 3 Security Advisor "Security Definer View" warnings resolved (`active_matches` → `security_invoker=true`; `referral_leaderboard` re-pointed at `user_public_profiles` and documented via `COMMENT ON VIEW`, same for `user_public_profiles` itself). |

**Firebase RTDB Rules — v32 mein add karo:**
Firebase Console → Realtime Database → Rules mein nayi paths add karo
(dekho Section 6 — Firebase Allowed Paths — v32 rules sab wahan hain)

---

**✅ v32.7 — ImgBB secret + Paytm: koi SQL run nahi karna, sirf Edge Functions deploy karna hai**

Yeh feature `COMPLETE_SCHEMA.sql` ko bilkul touch nahi karta — koi naya
table/column/RPC nahi hai. Iske bajaye teen alag Edge Functions deploy
karni hain (Termux/local machine se, ek hi baar):

```bash
npm install -g supabase          # pehli baar
supabase login
supabase link --project-ref hddhkculuyrfoevxmlwy

supabase functions deploy imgbb-upload
supabase functions deploy paytm-create-order
supabase functions deploy paytm-callback

supabase secrets set IMGBB_KEY=c977a42da70cbc98fe176af64fbc484f
```

Paytm secrets (`PAYTM_MID`, `PAYTM_MERCHANT_KEY`, `PAYTM_ENV`,
`PAYTM_WEBSITE`, `PAYTM_CALLBACK_URL`) sirf tab set karna jab Paytm
business account ban jaaye — poora command list Section 24 → v32.7 mein
hai. Tab tak Paytm button admin toggle se OFF rehna chahiye.

**Bade fixes is audit mein:**
- `leaderboard` pehle VIEW thi — admin ban-user flow `.delete()` karta hai jo VIEW pe kaam nahi karta. Ab real TABLE hai + trigger se `users` table se auto-sync hoti hai.
- `polls` table ke columns real feature code (fa26-poll-suggestion.js) se match nahi karte the — fix kiya.
- Admin access 3 jagah check hota hai (`user_roles`, `admins`, `users.is_admin`) — ek trigger se teeno automatically sync rehte hain.

---

**✅ v32.8 — 2 missing columns: `COMPLETE_SCHEMA.sql` dobara run karna hai (poora file, safe/idempotent)**

Sirf Section 18 (naya, file ke bilkul end mein) actually kuch karta hai —
`ALTER TABLE users ADD COLUMN IF NOT EXISTS` do baar, `sponsored_winnings`
aur `referral_popup_done` ke liye. Baaki poora file already-applied
statements dobara run karega (harmless, idempotent, Section 25 ke top
wali warning dekho). Koi Edge Function deploy nahi karni, koi Firebase
rules change nahi. Sirf: **poora `COMPLETE_SCHEMA.sql` Supabase SQL
Editor mein paste karke Run karo, ek baar.**

---


## 26. DEPLOYMENT CHECKLIST

```
□ node --check on all JS files → 0 errors
  (Run: for f in screens/*.js core/*.js features/*.js js/*.js; do node --check "$f"; done)

□ COMPLETE_SCHEMA.sql run in Supabase SQL Editor (single file, all 87 tables)
  ✅ Idempotent — safe on fresh OR existing live DB, zero data loss, run
     as many times as needed (see Section 25 for what each statement does)

□ Supabase Third-Party Auth → Firebase enabled
  (Authentication → Third-Party Auth → Firebase → Project ID: fft-app-1e283)

□ Firebase RTDB security rules set (only support/ + deviceJoins/ + appSettings/)

□ RLS enabled on ALL tables (check: Table Editor → RLS column)

□ Supabase Realtime enabled for clan_messages table
  (Database → Replication → Tables → clan_messages → Enable)

□ config table has currentSeason row (MIGRATION_V31 seeds it)

□ OneSignalSDKWorker.js in root folder (not in /js/)

□ manifest.json icons in /icons/ folder

□ HTTPS enabled (required for PWA + OneSignal)

□ ImgBB key valid: test upload (ab via imgbb-upload Edge Function — direct client call nahi)

□ v32.7: 3 Edge Functions deployed (imgbb-upload, paytm-create-order, paytm-callback)
  (`supabase functions deploy <name>` — Section 25 mein exact commands)

□ v32.7: IMGBB_KEY secret set (`supabase secrets set IMGBB_KEY=...`)
  — is ke bina image upload 500 error dega

□ v32.7: Paytm secrets — sirf jab business account ban jaaye (abhi PENDING,
  tab tak admin toggle OFF rakhna): PAYTM_MID, PAYTM_MERCHANT_KEY, PAYTM_ENV,
  PAYTM_WEBSITE, PAYTM_CALLBACK_URL

□ All credentials unchanged in their files (check Section 4)

□ index.html script load order correct:
  1. Firebase SDK
  2. Supabase SDK
  3. core/firebase.js
  4. core/db.js
  5. core/db-bridge.js
  6. core/*.js (bugfixes, utils, router, modal, header, auth, imgbb)
  7. screens/*.js
  8. features/*.js
  9. js/fixes-*.js and js/bugfix-*.js (v29 → v30 → v31 order)
  10. core/listeners.js (LAST — boots app)
```

---

## 27. TROUBLESHOOTING

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Admin: every action "permission denied" | Firebase token not synced to Supabase | Ensure `syncFirebaseToken()` runs on login (fixed v26) |
| Admin: Settings page won't save | `firebase-rules.json` not deployed | Run `firebase deploy --only database` |
| Admin: "Live Attendance" crashes `getDB is not defined` | Old `supabase-init-early.js` | Ensure v26 file deployed (globals fix) |
| Admin: 4 buttons in wrong panel / mobile overflow | Old `admin-fixes-v7.js` / missing CSS | Ensure v26 files + `admin-base.css` deployed |
| Season history shows "Season / Bronze / #— / 0 pts" always | Old `match-history.js` field-name mismatch | Ensure latest `match-history.js` + `seasonal-league.js` deployed |
| Admin: Fraud Control / Activity Log / search crashes "is not a function" | Old `supabase-rtdb-bridge.js` missing range-query methods | Ensure v26.1 file deployed |
| Admin: Profile Verification section crashes on open | Old `admin-fixes-v25-SUPABASE.js` | Ensure v26.1 file deployed |
| Admin: Profile Updates always empty, Users table always empty | Old `admin-fixes-v25-SUPABASE.js` | Ensure v26.1 file deployed |
| Admin: Settings page won't load saved UPI/payee/min-withdraw values | Old `admin-inline.js` (unguarded missing DOM fields) | Ensure v26.1 file deployed |
| Blank white screen | `styles.css` missing | Check file in root |
| Unstyled neon UI | `js/user-ui-v10.css` missing | Check file in js/ folder |
| Login button dead | `doGoogleLogin` undefined | Check `core/auth.js` loaded |
| "Unsupported provider" error | Old Supabase auth call | Use `DB.auth.syncFirebaseToken()` |
| Supabase 401 after 1hr | Firebase token expired, not refreshed | `onIdTokenChanged` in auth.js handles auto-refresh |
| RLS 403 error | Policy missing on table | Add SELECT/INSERT policy |
| Slot counter always 0 | `joinedSlots` missing (fixed v31) | Ensure MIGRATION_V31 run |
| Ad coins double credit | Old onAdReward bug (fixed v31) | Ensure latest rank.js deployed |
| Clan chat not loading | Old Firebase clanChats code | bugfix-v30-final.js loaded? |
| Auto squad broken | Firebase autoMatchQueue (fixed v31) | Ensure MIGRATION_V31 run |
| Watch limit not enforced | Firebase watchEarnings (fixed v31) | Ensure watch_earn_log table exists |
| Check-in not saving | Old Firebase path (fixed v31) | Ensure join_requests has checked_in col |
| Premium request lost | Old Firebase premiumRequests (fixed v31) | Ensure premium_requests table exists |
| ff_uid undefined in leaderboard | Old view without ff_uid (fixed v31) | Re-run MIGRATION_V31 |
| Room not shown after join | JR cache empty (fixed v31) | Supabase fallback query now in place |
| Profile screen crash | Syntax error in profile.js (fixed v31) | Ensure latest profile.js deployed |
| Gift ticket not saving | Old Firebase giftTickets (fixed v31) | Ensure gift_tickets table exists |
| Season config not loading | Firebase appSettings (fixed v31) | Ensure config table + row exists |
| Anti-cheat not running | Syntax error in anti-cheat.js (fixed v31) | Latest file deployed |
| Modal black/frozen | `applyState` undefined | `if (window.applyState)` guard added in v31 |
| Supabase Realtime no messages | `clan_messages` Replication off | Enable in Supabase Dashboard |
| Image upload fails | ImgBB quota/key expired | New key from imgbb.com |
| Image upload 500 error (v32.7+) | `IMGBB_KEY` secret not set on Supabase | `supabase secrets set IMGBB_KEY=...` then redeploy `imgbb-upload` |
| Paytm button not showing | Toggle OFF in Admin App Settings, or secrets not set | Expected until Paytm business account is set up — this is intentional |
| Paytm payment stuck "processing" | Webhook not reaching `paytm-callback` yet | Client-side 5s poll will catch it once webhook/status API responds; check `supabase functions logs paytm-callback` |
| UPI/Paytm app doesn't open from WebView | Old `MainActivity.java` (pre-v32.7) | Ensure v32.7 `shouldOverrideUrlLoading` custom-scheme fix is in the built APK |
| Push not arriving | OneSignal tag not set | Check `uid` tag being set after login |
| Admin sections missing | `fa-v17-features.js` not in admin panel | Check admin index.html |

---

*Guide version: **v32.1** | Updated: June 2026*
*v31 changes: 24 bugs fixed, 5 duplicate files deleted, 14 new SQL sections,*
*complete Firebase→Supabase migration for auto-squad, clan chat, watch-earn,*
*checkin, premium, ads, seasonal-league, room tracking, gift tickets, profile requests.*
*v32 changes: Creator Economy System — 3 new features (Video Sharing, Creator Hosted Matches, Commission System),*
*2 new user panel files, 2 modified user panel files, 1 new admin panel file, 1 modified admin panel file,*
*5 new Supabase tables, 2 new RPCs, 1 Iron Rule DB trigger, 8 new Firebase paths, 13 new CFG keys.*
*v32.1 audit follow-up: Admin Panel v25→v26 (12 bugs fixed — JWT bridge, mobile overflow, missing RLS,*
*globals, OCR crash, dead code), 2 User Panel files fixed (season-history field-name mismatch),*
*2 admin RLS policies consolidated into COMPLETE_SCHEMA.sql, 1 shared rank-formula helper added*
*for Admin↔User consistency. See Section 24.*
*v26.1 final pre-production audit: 4 more critical silent bugs found + fixed (Supabase bridge missing*
*range-query methods, Profile Verification crash, Profile Updates wrong function name, Users table*
*silently empty due to let-vs-window scope bug) — all verified by injecting real fake data into a*
*headless-browser run of both panels, not just checking for console errors. 0 syntax errors, 0 orphan/*
*missing script refs, 0 duplicate top-level declarations, 0 horizontal overflow across 360/390/414px*
*on all 9 user screens + all 25 admin sections.*
*v26.2/v32.2 button-click audit: every onclick="..." in both panels cross-checked against real*
*function definitions. Found + fixed 2 more critical boot-time bugs (root-path db.ref() crash that*
*risked silently writing to a dead Firebase location instead of real Supabase data; a duplicate*
*dead listener with an illegal arguments.callee use only exposed once the first bug was fixed), 1*
*more critical bug (Green Diamond icon replacement crashed on every admin modal open), and 5 silent*
*dead buttons (called functions that never existed) — all now either properly implemented or give*
*honest "coming soon" feedback instead of a tap that does nothing.*
*v32.7: ImgBB key migrated out of client code into a Supabase Edge Function secret (was publicly*
*readable on GitHub Pages). Added optional Paytm UPI Instant Checkout — 3 new Edge Functions +*
*1 new frontend file, zero new SQL (reuses sd_requests/wallet_transactions/notifications +*
*increment_balance RPC). Fixed Android MainActivity.java to handle upi://, gpay://, phonepe://,*
*intent:// links in WebView (were silently failing before). Paytm secrets intentionally not yet*
*set — business account pending, toggle stays OFF until then.*

---

## 28. ADMIN PANEL — COMPLETE REFERENCE

### Overview

**Admin Panel v26** — MiniESports-Migrated  
Single-page admin dashboard. Firebase Auth + Supabase DB.

```
URL:      Deployed on web server (HTTPS required)
Auth:     Firebase Google (is_admin = true in Supabase users table)
DB:       Supabase (same project as User Panel)
Firebase: Firebase Auth + RTDB activityLogs (dual-write)
```

---

### Admin File Structure

```
AdminPanel-v26/
├── index.html                         ← Single page app
├── admin-base.css                     ← Base layout CSS
├── style.css                          ← Theme CSS
├── firebase-rules.json                ← RTDB security rules
├── green-diamond.png                  ← Asset
├── build.js                           ← Build/version-stamp script
├── ESLINT_SETUP.md                    ← Lint setup notes
├── .htaccess                          ← Apache redirect rules
├── .eslintrc.json                     ← Lint config (hidden file — zaruri)
├── .prettierrc                        ← Format config (hidden file — zaruri)
│
└── js/
    ├── supabase-init-early.js         ← Supabase client init (FIRST) — ✅ v26: true-global helpers + calcRk/calcRkScore/calcSeasonReward
    ├── security-hardening.js          ← XSS guards, input validators
    ├── security-patches.js            ← Additional security patches
    ├── admin-inline.js                ← Core admin logic (large file) — ✅ v26: JWT sync on login, dead nav lookup removed · ✅ v26.1: loadSettings/saveSettings/saveGameSettings no longer crash on missing UPI/payee/min-withdraw fields
    ├── supabase-rtdb-bridge.js        ← Routes Firebase→Supabase — ✅ v26: 6 path fixes, 3 table-name fixes, userFromSupa() column fix · ✅ v26.1: added missing startAt/endAt/startAfter/endBefore range-query methods
    ├── admin-ui-v10.css               ← Dark admin theme
    ├── admin-roster.js                ← User management
    ├── admin-live-dash.js             ← Live dashboard
    ├── admin-analytics.js             ← Analytics
    ├── admin-scheduler.js             ← Match scheduling
    ├── admin-player-lookup.js         ← Player search
    ├── admin-notif-templates.js       ← Notification templates
    ├── admin-chat-enhance.js          ← Support chat
    ├── admin-activity-log.js          ← Activity timeline
    ├── features-admin.js              ← Admin features — ✅ v26: #adminQuickActions mobile-overflow fix
    ├── imgbb.js                       ← Image upload
    ├── admin-supabase-sync.js         ← Supabase sync patches — ✅ v26: patch-trigger decoupled (was never firing)
    ├── admin-supabase-sponsored.js    ← Sponsored WD approval
    ├── fixes-admin-v9.js              ← v9 patches
    ├── fix8-lazy-loading.js           ← Lazy-load fix
    ├── fix13-realtime-analytics.js    ← Realtime analytics fix
    ├── admin-fixes-v7.js              ← v7 patches — ✅ v26: selector fix (was wrongly matching .topbar-actions), FAB 4th button added
    ├── admin-fixes-v21.js             ← v21 patches
    ├── admin-fixes-v22-FINAL.js       ← v22 patches
    ├── admin-fixes-v23-FINAL.js       ← v23 patches
    ├── admin-fixes-v24-FINAL.js       ← v24 patches
    ├── admin-fixes-v25-SUPABASE.js    ← v25 Supabase patches — ✅ v26.1: fixed Profile Verification crash, Profile Updates wrong fn name, Users table silently-empty scope bug
    ├── fa-admin-v10.js                ← Feature additions
    ├── fa-admin-v10-final.js          ← Feature additions final — ✅ v26: endCurrentSeason uses calcRkScore()
    ├── fa-sponsored-system.js         ← Sponsor system
    ├── fa-growth-admin.js             ← Growth tracking
    ├── fa-app-settings.js             ← ✅ v26: App settings + Creator & Video System settings
    ├── fa-creator-video-review.js     ← ✅ v26 NEW: Creator Video Review + Strike management
    │
    └── features/
        ├── fa-v17-features.js         ← v17 admin features
        ├── fa02-smart-search.js       ← Smart user search
        ├── fa03-quick-match-creator.js← Quick match creator
        ├── fa04-bulk-notification.js  ← Bulk push notifications
        ├── fa05-platform-health.js    ← Health monitor
        ├── fa06-duplicate-detector.js ← Duplicate account detection
        ├── fa08-match-autopublish.js  ← Auto publish matches
        ├── fa10-user-activity-heatmap.js
        ├── fa11-result-auto-calc.js   ← Auto result calculation
        ├── fa12-bulk-notify.js        ← Bulk notifications v2
        ├── fa13-match-clone.js        ← Clone existing match
        ├── fa14-player-lookup.js      ← Player lookup v2
        ├── fa15-match-result-reminder.js
        ├── fa16-quick-ban.js          ← Quick ban/unban
        ├── fa17-pending-profiles.js   ← Profile verification queue
        ├── fa18-match-stats.js        ← Match statistics
        ├── fa19-auto-status.js        ← Auto match status
        ├── fa21-match-history.js      ← Match history view
        ├── fa22-match-result.js       ← Result management
        ├── fa24-admin-smart-tools.js  ← Smart admin tools
        ├── fa25-fraud-dashboard.js    ← Fraud dashboard
        ├── fa26-poll-suggestion.js    ← Poll/suggestion system
        ├── fa27-anticheat-complete.js ← Anti-cheat admin
        ├── fa28-fa43-fraud-control-center.js
        ├── fa44-fa52-final-admin-tools.js
        ├── fa53-ocr-autofill.js       ← OCR screenshot reading — ✅ v26: worker vars declared (crash fix)
        ├── fa-legal-kyc-dispute.js    ← KYC/dispute handling
        ├── fa56-fa62-automation-bundle.js
        ├── fa63-fa70-automation-bundle.js ← ✅ v26: fa68_checkSeasonReset uses calcRk()
        ├── fa71-fa80-automation-bundle.js
        └── fix7-server-side-search.js
```

---

### Admin Auth — How It Works

```
1. Admin opens admin panel URL
2. Firebase Google Login → only allowed if:
   users.is_admin = true  (check Supabase users table)
3. If not admin → redirect to login
4. adminUser = firebase.auth().currentUser

Setting a user as admin:
  Supabase → Table Editor → users → find user → set is_admin = true
  OR run: UPDATE users SET is_admin = true WHERE ign = 'YourAdminIGN';
```

---

### Admin SQL — Run Order

```sql
-- Single file, same DB as User Panel:
COMPLETE_SCHEMA.sql      -- ✅ Idempotent, safe on fresh OR existing live DB
                         -- (see Section 25 for exactly what each statement
                         -- type does — tables/indexes never touch existing
                         -- data, policies/triggers cleanly drop-then-recreate)
-- Old separate files (supabase-admin-schema.sql, ADMIN_MIGRATION_V25.sql,
-- MIGRATION-missing-admin-policies.sql) are now fully merged into this
-- one file — see Section 24 / Section 25 for details.
```

---

### Admin Panel Features

| Section | Function | Supabase Table |
|---------|----------|----------------|
| Dashboard | Live stats | `matches`, `users`, `join_requests` |
| Match Management | Create/edit/delete | `matches` |
| Match Results | Publish results, award GD | `match_results`, `join_requests` |
| Room Reveal | Set room ID + password | `matches.room_id` |
| User Management | Ban/unban, reset | `users` |
| Profile Verification | Approve IGN changes | `profile_requests` |
| SD Requests | Approve UPI deposits | `sd_requests` |
| Withdrawal | Process withdrawals | `wallet_transactions` |
| Sponsored WD | Sponsored prize WD | `sponsored_tournaments` |
| Notifications | Send push/in-app | `notifications` + OneSignal |
| Bulk Notify | Mass notification | `notifications` |
| App Settings | Live config JSON — includes v32.7 "⚡ Paytm Instant Checkout" toggle | `app_settings` + `config` |
| Analytics | User/match stats | `platform_stats` |
| Fraud Detection | Anti-cheat flags | `fraud_cases`, `cheat_reports` |
| KYC / Disputes | Legal compliance | `kyc_requests`, `disputes` |
| Activity Log | Admin audit trail | `admin_activity_log` |
| Support Chat | User messages | Firebase RTDB `support/` |
| Auto Squad Queue | View queue | `auto_squad_queue` |
| Watch Earn Log | Daily stats | `watch_earn_log` |
| Season Config | Set current season | `config` |

---

### Critical Admin Rules

```
✅ ALWAYS use Supabase for:
  - Balance changes (rpc increment_balance)
  - Match updates
  - User bans
  - Result publication
  - SD request approval

✅ Firebase RTDB (admin allowed):
  - Support chat (support/)
  - Activity logs (activityLogs/)
  - TDS records (tdsRecords/)
  - Admin alerts (adminAlerts/)

❌ NEVER:
  - Manually set users.coins without wallet_transactions record
  - Approve SD without screenshot verification
  - Delete matches with pending join_requests (refund first)
```

---

### Admin Syntax Fixes (cumulative — v25 + v26)

| File | Bug Fixed |
|------|-----------|
| `admin-inline.js` | `openUserModal('')` unescaped quotes in search results HTML *(v25)* |
| `admin-inline.js` | Multi-line `confirm()` string with literal newlines *(v25)* |
| `admin-fixes-v21.js` | `getElementById('v21DeviceVerifyEmail')` — unescaped quotes in onclick *(v25)* |
| `admin-supabase-sponsored.js` | Duplicate IIFE close + truncated function body *(v25)* |
| `admin-supabase-sync.js` | Unclosed IIFE stub at end of file *(v25)* |
| `features/fa53-ocr-autofill.js` | `_ocrWorker`/`_ocrWorkerReady`/`_ocrWorkerBusy` never declared — crash on tab-switch *(v26)* |
| `supabase-init-early.js` | Globals (`getDB` etc.) were IIFE-local, not window-scoped — crash on Live Attendance *(v26)* |

v26 full list: see **Section 24** above (12 bugs — JWT bridge, RTDB rules, bridge paths, mobile overflow, Creator Video Review wiring, dead code, invalid HTML).

---

*Admin Panel version: **v26.2** | Cumulative bugs fixed: 7 files, 12 bugs (v25+v26) + 4 critical silent bugs (v26.1) + 3 more critical/high + 2 dead buttons (v26.2 button audit, see Section 24)*
*v32.7 update (not a version-number bump — feature addition): `js/imgbb.js` now calls the `imgbb-upload` Edge Function instead of ImgBB directly; `js/fa-app-settings.js` has a new Paytm Instant Checkout toggle. See Section 24.*


---

## 29. ZIP PACKAGING RULES — DEVELOPER KE LIYE (ZARURI PADHO)

> Ye section isliye add kiya gaya hai kyunki packaging ke dauran kuch mistakes huin.
> Agli baar zip banate waqt ye sab dhyan se follow karo.

---

### ❌ MISTAKE 1 — Dotfiles (Hidden Files) Missing

**Problem:**
Bash mein `mv folder/* destination/` ya `cp folder/* destination/` command dotfiles (`.` se shuru hone wale files) ko **skip kar deta hai** by default.

Missing ho jaati hain ye files:
```
.htaccess
.prettierrc
.eslintrc.json
.gitignore
.env.example
.github/          ← hidden folder bhi skip hota hai
```

**Sahi tarika — HAMESHA `find` use karo:**
```bash
# ❌ Galat — dotfiles miss ho jaenge
mv AdminPanel-v25-CLEAN/* /destination/

# ✅ Sahi — sab kuch move hoga
find AdminPanel-v25-CLEAN -maxdepth 1 -mindepth 1 -exec mv {} /destination/ \;
```

---

### ❌ MISTAKE 2 — Zip ke andar Unnecessary Subfolder

**Problem:**
Agar zip banate waqt parent folder ke andar se zip karo to ek extra subfolder aa jaata hai:
```
# ❌ Galat result — extra subfolder
SQL-and-DeveloperGuide.zip
└── sql-guide/
    ├── COMPLETE_SCHEMA.sql
    └── DEVELOPER_GUIDE.md
```

**Sahi tarika — files ke andar jaake zip banao:**
```bash
# ❌ Galat — subfolder aa jaayega
cd /build && zip -r output.zip sql-guide/

# ✅ Sahi — files seedha root pe
cd /build/sql-guide && zip -q /output.zip COMPLETE_SCHEMA.sql DEVELOPER_GUIDE.md
```

---

### ❌ MISTAKE 3 — Duplicate / Wrong Format Files

**Problem:**
- `.sql` file ko `.txt` copy banane ki zaroorat **nahi** hai — `.sql` already plain text hai
- DeepSeek ya koi bhi AI `.sql` file seedha read kar sakta hai
- Extra copies se user confuse hota hai

**Rule:**
```
SQL files  → sirf .sql format  (Supabase SQL Editor + AI dono ke liye same file)
Guide      → sirf .md format
Zip mein extra/duplicate files mat daalo
```

---

### ❌ MISTAKE 4 — `-x "*.git*"` Apna Hi `.gitignore` Bhi Hata Deta Hai

**Ye galti genuinely hui thi (2026-07-19 session) — is se seekho.**

**Problem:**
`zip -r output.zip . -x "*.git*"` likhne ka intent hota hai sirf `.git/` folder
(version-control metadata) exclude karna. Lekin `*.git*` ek **substring-match
wildcard** hai — ye sirf `.git/` folder ke path ko match nahi karta, balki **kisi
bhi file ka naam jisme kahin bhi "git" letters aayein**, wahan bhi match ho jaata
hai. `.gitignore` khud is pattern se match ho jaata hai, kyunki uske naam ke
andar hi "`git`" hai — matlab command khud apni hi zaroori config-file ko hata
deta hai, silently, bina koi error diye.

Ye galti pehli baar tab pakड़ी gayi jab do baar-baar shipped zips mein se
`UserPanel`'s `.gitignore` gayab tha — koi crash nahi hua, koi warning nahi
aayi, sirf file chup-chaap missing thi. Isi tarah ki galti aage bhi ho sakti hai
kisi doosre naam ke saath jisme "git" substring ho.

**Sahi tarika — sirf actual `.git/` DIRECTORY ko path-anchored exclude karo,
substring-match mat karo:**
```bash
# ❌ Galat — .gitignore bhi hata deta hai (substring match)
zip -r output.zip . -x "*.git*"

# ✅ Sahi — sirf .git/ folder ka content exclude hota hai, .gitignore file bachi rehti hai
zip -r output.zip . -x ".git/*" -x "*/.git/*"
```

**Zip banane ke baad HAMESHA verify karo** ki source directory ke saare
dotfiles (`.gitignore`, `.env.example`, `.htaccess`, `.eslintrc.json`,
`.prettierrc`, etc.) zip ke andar bhi hain — sirf command likh dena kaafi
nahi hai, khud diff nikaal ke confirm karo:
```bash
# Source aur zip ke beech file-list ka farak dekho — dono taraf khaali aana chahiye
find source_dir -type f | sed 's|source_dir/||' | sort > /tmp/source.txt
unzip -Z1 output.zip | grep -v '/$' | sort > /tmp/zipped.txt
comm -3 /tmp/source.txt /tmp/zipped.txt   # koi bhi output = kuch miss ya extra hai
```

---

### ✅ CORRECT ZIP STRUCTURE — Reference

**Admin Panel zip:**
```
AdminPanel-v26.zip
├── .htaccess           ← hidden file — zaruri
├── .prettierrc         ← hidden file — zaruri
├── .eslintrc.json      ← hidden file — zaruri
├── index.html
├── admin-base.css
├── style.css
├── firebase-rules.json
├── green-diamond.png
├── build.js
├── ESLINT_SETUP.md
└── js/                 ← 34 files
```

**User Panel zip:**
```
UserPanel-v32.zip
├── .gitignore          ← hidden file — zaruri
├── .env.example        ← hidden file — zaruri
├── .github/            ← hidden folder — zaruri
│   └── workflows/
│       └── build-apk.yml
├── index.html
├── features/           ← sab feature files
├── core/
├── screens/
├── js/
└── ... baaki sab
```

**SQL + Guide zip:**
```
SQL-and-DeveloperGuide-v32.zip
├── COMPLETE_SCHEMA.sql    ← seedha root pe, koi subfolder nahi
└── DEVELOPER_GUIDE.md     ← seedha root pe
```

---

### ✅ ZIP BANANE KA SAHI TARIKA — Template

```bash
# Step 1: Fresh folder banao
rm -rf /build/myfolder && mkdir -p /build/myfolder

# Step 2: Original zip extract karo
cd /build/myfolder
unzip -q /path/to/original.zip

# Step 3: Dotfiles sahi se move karo (find use karo, mv * nahi)
find ExtractedFolderName -maxdepth 1 -mindepth 1 -exec mv {} . \;
rm -rf ExtractedFolderName

# Step 4: Modified files replace karo
cp /new/modified-file.js /build/myfolder/js/

# Step 5: Zip banao — files ke parent se, correct path pe
cd /build/myfolder
zip -qr /output/FinalName.zip .

# Step 6: Verify — dotfiles hain ya nahi
unzip -l /output/FinalName.zip | grep "\." | head -20
```

---

*Packaging rules added: v32 | June 2026*

---

## 30. v32.8.5 CRITICAL FIX — auth.uid() UUID Crash + Missing GRANTs (replaces RLS-PERMISSIVE-PATCH.sql)

### Symptom
Production logs (Supabase → Logs → Postgres) showed two error patterns app-wide, both admin and user side:
```
ERROR: permission denied for table matches
HINT: Grant the required privileges to the current role with: GRANT SELECT ON public.matches TO anon;

ERROR: invalid input syntax for type uuid: "MjGRBJLOBvN03FHQKeFaEtO9mSp1"
```

### Root cause #1 — missing GRANTs
All 88 tables in `COMPLETE_SCHEMA.sql` are created via raw SQL (SQL Editor), not the Table Editor UI. Supabase only auto-grants `anon`/`authenticated` privileges for tables created through the dashboard UI — raw-SQL tables get **no grant at all** unless you add one explicitly. This is why Postgres's own hint literally tells you the fix.

A separate patch file (`RLS-PERMISSIVE-PATCH.sql`) had already attempted to fix this with a `GRANT ... TO anon, authenticated` block, but it only covered 69 of the 88 tables — it missed `matches`, `app_settings`, and 17 others, so the errors would have continued even after applying it.

### Root cause #2 — the real reason for "permission denied" everywhere (bigger than #1)
Supabase's built-in `auth.uid()` function is defined as:
```sql
select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
```
It **force-casts** the JWT `sub` claim to a native Postgres `uuid`. This app authenticates via Firebase (Third-Party Auth), and Firebase UIDs (e.g. `MjGRBJLOBvN03FHQKeFaEtO9mSp1`, 28 base62 chars) are **not valid UUIDs**. Every time an authenticated request hit an RLS policy using `auth.uid()::TEXT`, the cast inside `auth.uid()` itself threw an error — the query crashed, it did not just silently deny the row. This is a documented, known incompatibility (Supabase's own Auth0/Clerk third-party-auth docs describe the same class of bug for any non-UUID user ID system).

All ~168 RLS policy lines in `COMPLETE_SCHEMA.sql` used `auth.uid()::TEXT` or bare `auth.uid()` — meaning almost every authenticated read/write was affected, not just a handful of edge cases.

### Why RLS-PERMISSIVE-PATCH.sql was rejected
That patch "fixed" the symptom by rewriting ~120 policies to `USING (true)` / `WITH CHECK (true)` — which works only because it stops calling `auth.uid()` at all, removing the crash by removing the security check. Combined with its `GRANT ... TO anon` block, this would let **anyone holding the public anon key** (hardcoded in the client JS, trivially extracted from the APK, no login required) read every user's `wallet_transactions`/`kyc_requests`/personal data and directly `UPDATE` their own `coins`/`sky_diamonds`/`green_diamonds`/`premium_level`, fabricate `match_results`, or delete other users' rows — all via raw Supabase REST calls, completely bypassing app code. For a platform whose core loop is virtual currency tied to real prizes, this is a critical hole, not a theoretical one.

### The actual fix (applied in this version)
1. **Global replace** in `COMPLETE_SCHEMA.sql`: every `auth.uid()::TEXT` and bare `auth.uid()` → `(auth.jwt() ->> 'sub')`. `auth.jwt()` returns the raw JWT claims as `jsonb` with **no** uuid casting, so `->> 'sub'` returns the Firebase UID as plain text — directly comparable to every `user_id`/`uid`/`id` column, which are all `TEXT` in this schema (verified: no user-identity column anywhere is typed `uuid`). Every policy's original per-row / admin-only logic is preserved exactly — only the broken expression was swapped.
2. **Extended the GRANT block** to cover all 88 tables (`GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO anon, authenticated;`), now inserted directly in `COMPLETE_SCHEMA.sql` near the top (after the schema-level grants) so it's part of the single source of truth for fresh installs too. This grant is safe on its own: RLS still restricts every row per-user regardless of which Postgres role (anon/authenticated) is attempting the operation.

### Migration for the live database
A standalone file, `RLS-AND-GRANT-FIX-v1.sql`, contains just the `DROP POLICY`/`CREATE POLICY`/`GRANT` statements extracted from the corrected schema — safe to paste into Supabase SQL Editor and run directly against the existing live database (idempotent, touches zero data, only security-rule definitions). **Do not run `RLS-PERMISSIVE-PATCH.sql`** — it is superseded by this fix.

### Takeaway for future third-party-auth work
Anywhere Firebase (or any non-UUID identity provider) is used with Supabase RLS, always use `(auth.jwt() ->> 'sub')` instead of `auth.uid()`. Never use `auth.uid()` in this codebase going forward.

*v32.8.5 fix added: July 2026*

---

## 31. DATA ACCESS MODEL & RPC REFERENCE (updated 2026-07-19)

*(This section makes the earlier audit findings unnecessary to reference separately — everything
a developer needs going forward is here. First written for v32.14, updated across several rounds
through v32.15 as verification uncovered more issues. History of what changed each round is kept
in 31.6 rather than deleted, since some of it — especially 31.6.3 — is a pattern worth
remembering, not just a changelog entry.)*

### 31.1 — Why this happened

A full audit found that most tables' RLS policies only checked **"is this my own row"** —
never **"which columns am I changing."** Supabase's default table-level GRANTs (`GRANT UPDATE
ON users TO authenticated`, applied when the table was first created) meant that once RLS let a
write through, **every column was writable**, including `sky_diamonds`, `is_admin`, `is_banned`,
match outcomes, everything. This was live-proven exploitable with real database calls — a
regular logged-in user could set their own balance to 999,999,999 and make themselves admin
using nothing but the browser console and the app's own public anon key.

**The fix, applied to 19 tables:** `REVOKE UPDATE, INSERT ON <table> FROM anon, authenticated`,
then `GRANT` back only the specific columns a client should ever touch directly (profile fields,
UI preferences — genuinely low-stakes stuff). Every currency, privilege, and game-outcome column
is now **only writable through a SECURITY DEFINER RPC function** that validates the caller's
identity (and, where relevant, business rules like "is this mission actually completed") before
touching anything.

### 31.2 — The pattern for any NEW table you add

If a new table has ANY column representing money, a privilege flag, or a game-verifiable outcome
(wins, kills, completion status, claimed-reward flags):

1. Do **not** rely on RLS alone. `REVOKE UPDATE, INSERT ON <table> FROM anon, authenticated`
   immediately after creating it.
2. `GRANT` back only cosmetic/preference columns directly, if any.
3. Write a `SECURITY DEFINER` function for every legitimate write path. Inside it:
   - Get the real caller: `v_caller := (auth.jwt() ->> 'sub')`
   - For **self-only actions**: `IF v_caller IS DISTINCT FROM p_uid THEN RAISE EXCEPTION ...`
   - For **admin actions**: check `SELECT is_admin FROM users WHERE id = v_caller`
   - For **service-role/backend-only actions** (Edge Functions using `SUPABASE_SERVICE_ROLE_KEY`):
     these have NO end-user JWT at all, so `auth.jwt() ->> 'sub'` reads as `NULL` — treat
     `v_caller IS NULL` as "trusted, this is a service_role/direct-Postgres caller," not as
     "reject." Confirmed against `supabase/functions/paytm-callback`, which genuinely calls
     `increment_balance` this way. **Never check `current_user`** for this — it always shows the
     function's OWNER inside a SECURITY DEFINER function, not the actual caller.
   - Row-lock anything you read-then-write: `SELECT ... FOR UPDATE`. If you need to select-then-
     update a SET of candidate rows without two concurrent calls racing on the same ones (e.g.
     matchmaking, team formation), use `FOR UPDATE SKIP LOCKED` instead — see
     `form_auto_squad_team` for a working example.
   - Bound any client-supplied numeric amount to a sane maximum, even for self-actions.
   - **Return a JSONB `{success/ok, error?}` shape rather than `RAISE EXCEPTION` where the caller
     needs to distinguish "this specific business rule failed" from "something broke."**
     `RAISE EXCEPTION` surfaces as `error` in the JS client and is fine for hard authorization
     failures; a JSONB return with `success:false` is better for expected, recoverable outcomes
     (insufficient balance, already claimed, etc.) since the caller can show a real message
     instead of a generic error toast. **Whichever you choose, check BOTH real callers' response
     handling before finalizing the shape** — `process_daily_checkin` originally returned a
     shape that satisfied only one of its two actual call sites and would have silently
     miscounted rewards for the other; caught by re-reading both callers before shipping.
4. `GRANT EXECUTE ON FUNCTION your_function(...) TO authenticated;`
5. **Use `CREATE OR REPLACE FUNCTION` carefully.** If you change the parameter list at all
   (add/remove/reorder/retype a parameter), Postgres creates an ADDITIONAL overloaded function
   instead of replacing the original — the OLD, possibly-insecure version keeps existing and
   stays directly callable. This bit us twice in an earlier session (`award_battle_pass_xp`,
   `increment_city_score`) before it was caught. **After any signature change, always run:**
   ```sql
   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='your_function';
   ```
   If more than one row comes back, `DROP FUNCTION your_function(<old signature>);` explicitly.
6. Test both directions before considering it done: confirm a malicious cross-user/cross-role
   call is rejected, AND confirm the legitimate self-service call still succeeds.
7. **Before adding a column to a GRANT list, ask "could a client set this to benefit themselves
   for free?" — not just "does the client send this field."** The single most severe bug found in
   this round of fixes was `coins`/`green_diamonds`/`sky_diamonds`/`premium_level`/
   `premium_expires` being bundled into a bulk grant expansion alongside genuinely safe fields
   (bio, city, avatar_url) because *some* code path sent them — without separately checking
   whether a client benefits from writing them directly. It does not matter that
   `increment_balance` also exists; if the raw column is grantable, a client can skip the RPC
   entirely and call `.update({coins: 999999999})` directly. **Any column representing money or a
   paid privilege must never appear in a client GRANT list, full stop — no exceptions for
   "informational display fields" either**, since `auto_squad_queue.rank_pts` looked purely
   informational until it turned out to also drive matchmaking sort order. When genuinely unsure
   whether a field affects anything beyond display, default to RPC-only and route it through one,
   same as the pattern above — the cost of an unnecessary RPC is small; the cost of an
   unnecessary open column is the whole economy.

### 31.3 — Which tables are locked, and what to call instead

| Table | Locked columns | Use this RPC instead |
|---|---|---|
| `users` | is_admin, is_creator, email_verified (never client-writable, no RPC either — admin/system only), coins, sky_diamonds, green_diamonds, premium_level, premium_expires, sponsored_winnings, fraud_score, rank_tier, rank_points, total_wins/kills/matches, win_streak, clean_matches, streak_days, last_checkin_date, referred_by, level, exp, penalty_points, creator_code | `increment_balance` / `decrement_balance` / `admin_set_coins` / `admin_sync_user_balance` (currency), `approve_premium` / `cancel_premium` / `start_free_trial` (premium), `approve_creator_application` (creator), `increment_rank_points` (rank), `process_daily_checkin` (streak), `admin_set_fraud_score` (fraud_score — v32.19; also see v32.18 which additionally locked `ign`/`ff_uid`/`profile_status`/`pending_ign` at the whole-table level, now covered by `admin_approve_profile`/`admin_reject_profile` below) |
| `join_requests` | status, entry_fee_paid, kills, placement, prize_earned, checked_in, ad_watched, rejection_note, fee_type | `validate_and_join_match` (join); match results are admin/publish-flow only, not client-writable at all |
| `clans` | squad_bank_gd, squad_bank_contributors, squad_bank_unlocked, total_wins/kills, weekly_score, leader_uid | `contribute_to_squad_bank`, `unlock_squad_bank_cosmetic`, `increment_clan_score`, `join_clan`, `leave_clan` |
| `notifications` | user_id-for-privileged-types (see below), type-for-non-admins (see below) | `admin_send_notification`, `admin_send_broadcast_notification` — required for the privileged type family (`wallet_update`, `withdrawal_*`, `ban`, `admin_debit`, `admin_alert`, `banner`); everything else (referral, duel, squad, clan, mentor, checkin) is client-INSERT-able directly, including for a DIFFERENT user, since notifying someone else is a legitimate need for those features — see the `notif_insert` RLS policy for the exact allowlist |
| `profile_requests` | entire table (v32.18 moved this from a column-level grant to a blanket table-level `REVOKE UPDATE, INSERT ... FROM anon, authenticated`) | `admin_approve_profile`, `admin_reject_profile` (v32.19) — **correction:** this row previously said "no confirmed live admin write path found," which was wrong; the Admin Panel's New Verifications tab, its Quick Tools "Pending Profiles" modal, and `submitReject()`'s profile branch all write here and had been silently permission-denied since v32.18 with no RPC to fall back to. See 31.6.4. |
| `user_cosmetics` | (fully open again — INSERT re-granted) | *(re-opened rather than RPC'd: cosmetic ownership rows have no currency/privilege value on their own, they're granted alongside a currency transaction elsewhere, e.g. squad-bank unlock, which IS RPC'd)* |
| `team_requests` | (grant exists) | ⚠️ **correction (v32.19):** previously documented as "confirmed dead code — zero live callers" — that was wrong. `admin-inline.js`'s `approveTeam()` and `submitReject()`'s `'team'` branch both write here directly and are almost certainly hitting the same v32.18 blanket-revoke permission error as profile_requests did (see above) — not yet confirmed live/fixed as of this round, deferred to a future session. Needs the same treatment: an `admin_approve_team`/`admin_reject_team`-style RPC. |
| `user_sessions`, `creator_codes` | (grant exists) | *(confirmed dead code — zero live callers as of this round — grants kept for forward-compat only, not a live gap)* |
| `creator_videos` | status, report_count | `review_creator_video` *(confirmed zero live callers as of this round — written for consistency, not an active break)* |
| `duel_records` | wins, losses (entire table, no direct grant) | `record_duel_result` — confirmed LIVE (features-user.js's `challengeFriend`), contradicting an earlier note here claiming it wasn't wired; always re-verify live-caller status against the actual codebase, not a previous note |
| `battle_pass_progress` | current_xp, current_tier, has_premium, claimed_free, claimed_prem | `award_battle_pass_xp`, `claim_battle_pass_tier` |
| `daily_checkins` | entire table | `process_daily_checkin` |
| `mission_progress` | progress, target, is_completed, reward_claimed | `track_mission_progress`, `claim_mission_reward` |
| `referrals` | join_bonus_paid, match_bonus_paid | `apply_referral_code` |
| `duel_challenges` | (bet_coins not yet wired to any RPC) | direct grant for challenger_ign/challengee_ign/mode/taunt/status; `bet_coins` column exists but has zero live UI path — do not wire it to a direct grant when that day comes, write an RPC first |
| `auto_squad_queue` | rank_tier, rank_pts, status, team_id (entire table, no direct grant) | `join_auto_squad_queue` (reads rank server-side from `users`), `form_auto_squad_team` (atomic team formation, `FOR UPDATE SKIP LOCKED`) — corrected mid-session after briefly being direct-granted by mistake; rank_pts drives matchmaking sort order, not just display |
| `squad_finder` | rank_tier, rank_pts (ign/role/lang/note/mode/playstyle/expires_at ARE directly grantable) | `post_squad_finder_listing` for the rank fields specifically — reads the caller's real rank server-side rather than trusting client input |
| `wallet_transactions` (sponsored withdrawal rows) | status | `resolve_sponsored_withdrawal` |
| `sd_requests` | status, reviewed_by, review_note | `resolve_sd_request` — now actually implemented; previously documented here but the function didn't exist, so every approve/reject in the live admin UI was Firebase-only with zero refund logic on a rejected withdrawal |
| `mentor_profiles` | gd_earned, successful_students (student cannot write mentor's row directly — RLS blocks it) | `award_mentor_reward` — validates an active accepted mentorship exists between exactly the two users before crediting |

### 31.4 — Full RPC reference

See `COMPLETE_SCHEMA.sql`'s RPC function definitions (search `CREATE OR REPLACE FUNCTION`) for
the full, current, authoritative signature and body of every RPC — 44 as of this update. The
inline `-- ✅` comments on each explain what it replaced and why, if relevant. That file is kept
in sync with the live database; this guide explains the *why*, that file is the *what*. When in
doubt, the live database's `pg_get_functiondef()` output is always the ultimate source of truth —
comments in either file can drift, the database cannot lie.

**A caution from this round, worth repeating:** documentation drift runs both ways. This exact
section previously listed several functions (`resolve_sd_request`, `apply_referral_code`,
`process_daily_checkin`, and 13 others) as if they existed, with full descriptions of their
intended behavior — but no `CREATE FUNCTION` for any of them existed anywhere in the schema file.
The features they backed had been silently 100% broken since whenever that documentation was
written. **Documentation describing intended behavior is not evidence the behavior was ever
implemented.** Before trusting a table in this guide, or a comment anywhere, confirm the actual
`CREATE OR REPLACE FUNCTION` exists in `COMPLETE_SCHEMA.sql` — a `grep` takes ten seconds and
would have caught this months earlier.

### 31.5 — Bridge field-map integrity (`admin/js/supabase-rtdb-bridge.js`)

This file's `USER_FIELD_MAP` and `NESTED_FIELD_MAP` translate Firebase-style
`db.ref('users/{uid}/someField').set(...)` calls into Supabase column writes. As of this round,
**18 of its ~45 entries pointed at Supabase columns that never existed** — the exact class of
error visible in live Postgres logs (`column users.referral_count does not exist... Perhaps you
meant users.referral_code`). If you add a new field to either map, verify the target column with
a direct `grep` against `COMPLETE_SCHEMA.sql`'s `CREATE TABLE`/`ALTER TABLE ADD COLUMN`
statements before assuming it exists — don't trust the Firebase-era field name's similarity to a
real column name as evidence it's correct. This bridge also has **no identity check of its own on
any path** — it relies entirely on the target table's RLS/grants for protection, which is exactly
why the `coins`/`premium_level` grant mistake in 31.1 was so severe: the bridge dutifully
forwarded whatever write the open grant allowed, for any `targetUid` embedded in the path string.

### 31.6 — Change history (most recent first)

**31.6.4 (2026-08-01) — profile approve/reject and fraud_score broken by v32.18's own
blanket revoke; profile_requests documentation was wrong.** v32.18 (the round directly
above, in the same file) moved several tables — including `users` and `profile_requests`
— from column-level grants to a full blanket `REVOKE UPDATE, INSERT ... FROM anon,
authenticated`, which is stronger than the column-level model this section otherwise
describes. Two live Admin Panel write paths had no RPC to fall back to and went straight
from "insecure" to "silently 100% broken": profile-request approve/reject, and
fraud-score persistence. `admin_approve_profile`/`admin_reject_profile`/
`admin_set_fraud_score` added (v32.19, same file). The `profile_requests` row in 31.3
previously claimed no live admin write path existed at all — it did, just broken; treat
that as a live example of the exact "documentation drift" 31.4 already warns about,
running in the opposite direction (falsely claiming a callsite *doesn't* exist, instead
of falsely claiming an RPC *does*). Same audit also found the `team_requests` row's
"zero live callers" claim is similarly false (`approveTeam()` is live) — not yet fixed,
see that row's correction note.

**31.6.3 (2026-07-19) — coins/green_diamonds/sky_diamonds/premium_level grant mistake, found and
fixed same-session.** While auditing the RTDB bridge's field maps (31.5), found that an earlier
step in this same fix pass had bundled the platform's actual currency columns and
premium_level/premium_expires into a bulk `GRANT UPDATE` alongside genuinely low-stakes fields
(bio, city, avatar_url) — see 31.2 point 7 for the generalized lesson. Removed immediately;
`admin_set_coins`, `admin_sync_user_balance`, `cancel_premium`, `award_mentor_reward` were added
to give the legitimate direct-write callers a real RPC path instead. This is flagged here
specifically so a future audit doesn't have to rediscover it: **if you ever see coins,
sky_diamonds, green_diamonds, premium_level, or premium_expires in a `GRANT UPDATE` list on
`users` again, that is a regression, not a feature.**

**31.6.2 (2026-07-17/19) — 16 documented-but-unimplemented RPCs written, 8 pre-existing RPCs
found missing an identity check and fixed** (`increment_balance`, `decrement_balance`,
`validate_and_join_match`, `award_battle_pass_xp`, `increment_rank_points`, `join_clan`,
`leave_clan`, `increment_clan_score` — the last three had documented guarantees that were never
actually coded). Also found and fixed a `notifications` INSERT RLS policy that had been fully
open (any user, any target, any type — a phishing/impersonation vector), overriding a more
correct, narrower policy defined earlier in the same file. See 31.3/31.4 for current state.

**31.6.1 (2026-07-17) — original permission-denied root cause pass.** Column-level GRANT lists
found incomplete on `users`, `profile_requests`, `join_requests`, `notifications`, `clans` (a
single ungranted column rejects the entire row — this was the direct cause of the
`profile_requests` "permission denied" reports). `users.is_admin` found to never be set by any
code path despite three different UI-unlock mechanisms checking for admin status — Admin Panel
login and the `is_admin` Postgres column are separate systems that were never actually connected.
`creator_stats` found with RLS enabled but zero INSERT/UPDATE policy of any kind. Widespread
silent `.catch(function(){})` patterns found masking failed writes as apparent successes,
starting with Quick-Create-Match showing a success toast for a row that was never actually
inserted.

### 31.7 — Still open (not fixed, tracked so it isn't lost)

- **`team_requests` approve/reject (`approveTeam()`, `submitReject()`'s `'team'` branch in
  admin-inline.js)** — almost certainly broken by the same v32.18 blanket revoke that hit
  profile_requests (see 31.6.4); confirmed live caller, not yet fixed. Needs an
  `admin_approve_team`/`admin_reject_team` RPC pair following the exact
  `admin_approve_profile`/`admin_reject_profile` pattern (v32.19).
- **Firebase RTDB rules** (`admin/firebase-rules.json`) still need manual deployment via Firebase
  Console or `firebase deploy --only database` — no automated tooling for this exists in this
  environment.
- **BUG #41 (Responsible Gaming / self-exclusion)** remains a confirmed UI-only illusion — the
  `selfExcluded`/`selfExcludedTill` fields in the bridge deliberately still point at non-existent
  columns rather than being "fixed" with a column add, because self-exclusion needs to be
  *enforced* at login/match-join time to mean anything, not just stored. Adding the column alone
  would make the feature look fixed without actually protecting anyone. Needs its own design pass.
- `rewarded-bonus.js`'s XP and match-credit ad-reward paths still share a client-side-only daily
  counter (only the coins path, via `claim_ad_reward`, was made server-authoritative this round).
- `increment_city_score` self-report is bounded but not fully verified against an actual match
  result — a determined user could still inflate their own city's score within the per-call
  bounds. A proper fix derives city-score from confirmed match results server-side.
- `duel_challenges.bet_coins` and `creator_codes.uses/earnings` remain un-wired to any RPC —
  confirmed zero live UI callers as of this round, but write one before wiring either up (see
  31.2's pattern), don't grant the column directly when that day comes.
- ~33 of 40 `core/db.js` `DB.*` API helper functions confirmed never called anywhere in either
  panel. `DB.checkin.doCheckIn` specifically was found, fixed (redirected to
  `process_daily_checkin` rather than its own separate, broken logic), and remains unwired —
  safe reference implementation if this ever needs a live caller. Broader dead-code cleanup
  across all ~33 is safe but not urgent.




## 32. 2026-08 SESSION — LIVE-TESTING FOLLOW-UP (User Panel UX + bug fixes)

This section covers everything fixed in the 2026-08 session **other**
than the Creator Economy rebuild (see Section 23 for that — it's
substantial enough to warrant its own section). All fixes below are
User Panel (`UserPanel-FIXED-v10.zip`) and Admin Panel
(`AdminPanel-FIXED-v13.zip`) client-side unless a Supabase change is
explicitly called out. All DB-side changes are in
`2026-08-SESSION-DELTA.sql` (appended to the end of
`COMPLETE_SCHEMA.sql`) and were applied live via Supabase MCP already
— re-running the delta file is safe (idempotent) but not required.

### 32.1 — Completed matches tab was structurally empty

`core/listeners.js`'s `_loadMatches()` only ever queried
`status IN ('upcoming','live')`, and the realtime handler deleted a
match from the in-memory `MT` table the instant it turned
`'completed'`. The Completed tab had nothing to show *by
construction*, independent of what was actually completed in the DB.
Fixed: also loads completed matches from the last 7 days (capped at
100), and stops purging completed matches from `MT` on realtime
update — only `cancelled`/`deleted` matches are still removed.

### 32.2 — Verified user's profile edit landed in the wrong admin queue

`screens/profile.js`'s `_doSubmitProfileRequest` always wrote to
`profile_requests` (Admin's "New Verifications" queue), even for a
user who was already approved and just editing their IGN/UID. Admin
Panel reads "Profile Updates" from a **separate** `profile_updates`
table. Fixed: an already-approved user's edit now goes to
`profile_updates` via a new `_submitProfileUpdateForVerifiedUser()`
function, and — critically — does NOT touch `users.profile_status`,
so the user stays verified (and able to join matches) while the edit
is pending review.

### 32.3 — Verified users stuck on "View Only", couldn't join matches

Root cause: the `admin_approve_profile` RPC was writing
`profile_status = 'complete'`, a value the client's `isOk()`/`isVO()`
gate never recognized as `'approved'`. Fixed at the RPC (now writes
`'approved'`), with `isOk()`/`isVO()` also hardened to accept both
values as defense-in-depth for any already-affected accounts. One-time
data fix applied: every user stuck with `'complete'` was corrected.

### 32.4 — Admin Panel user-detail modal showed garbage text + "Unknown"

Two independent bugs stacked: (1) `supabase-rtdb-bridge.js`'s `.once()`
wrapped a single-row Supabase read in an unnecessary array before
handing it to `makeSnapshot()`, flipping it into "multiple rows keyed
by id" mode — so `snap.val()` returned `{ "<uid>": {...} }` instead of
the row directly, making every field read `undefined`. (2) Separately,
`admin-inline.js`'s `openUserModal()` had an escaped-quote typo
(`\\'` instead of `'`) on 3 lines, so even with correct data those
specific stat rows would have rendered as literal unescaped template
text. Both fixed. Also replaced 3 dead `u.profileVerified` reads
(a Firebase-only field the bridge never actually populated from a real
column) with `u.profileStatus === 'approved'`.

### 32.5 — Coin History / Room ID modals showed raw HTML as text

`js/fixes-v29-all-bugs.js` called `window.openModal(html, key)` in two
places — but `openModal(title, html)` takes **title first, html
second** (title is set via `.textContent`, html via `.innerHTML`).
With the arguments swapped, the HTML content landed in the title slot
and rendered as literal escaped text (exactly what the "Coin History"
screenshot showed). Both call sites fixed — this also affected the
Room ID/Password reveal modal, a more consequential bug since it meant
match room details could render unreadable.

### 32.6 — Coin-earned transactions showed a diamond icon in history

`screens/wallet.js`'s internal-transaction render branch hardcoded 💎
regardless of the row's actual `currency` field (which was already
being read correctly upstream in `core/listeners.js`). Fixed to pick
🪙/💎/🌿 based on `w.currency`.

### 32.7 — Daily bonus "available" toast fired even right after check-in

`js/fixes-v7.js` compared `UD.lastCheckIn` (a Postgres `YYYY-MM-DD`
date string) against `new Date().toDateString()` (`"Tue Aug 11 2026"`)
— two formats that can never match, so the reminder always fired.
Fixed to compare like-for-like ISO date strings.

### 32.8 — Profile photo / banner change gated to Premium

Per product decision, changing your avatar or banner image is now a
Premium perk (any tier, Silver+). `uploadProfImg`/`uploadBannerImg` in
`screens/profile.js` check `isPremiumActive()` before allowing the
file picker to do anything; non-Premium users get a clear toast + a
link to the Premium modal instead of a silent no-op. Lock icons added
to both buttons in the UI for visual affordance.

### 32.9 — City Leaderboard: one-time automatic geolocation

`showCityLeaderboard()` didn't exist anywhere before this — the
Profile screen's button called a function that was never defined. The
old manual state/city dropdown (`_showSetLocation`/`_saveLocation`)
was also never wired to anything. Replaced both with a proper flow:
`navigator.geolocation` requests device permission, reverse-geocodes
via OpenStreetMap Nominatim (free, no API key), and calls the new
`set_user_location_once` RPC — which is a **one-time, server-enforced
lock** (`users.location_set_at` — once non-NULL, the RPC refuses to
run again for that user, regardless of what the client sends).

### 32.10 — Legal & Compliance moved out of Profile screen

Previously rendered unconditionally at the bottom of Profile on every
render. Moved into its own modal (`mesShowLegalModal()`), triggered
from a new "Legal & Compliance" entry in the Settings (⚙) modal,
positioned directly above Logout.

### 32.11 — Daily Missions moved from Profile to Wallet

The button moved screens; it now sits in the exact slot the old
"Ads Dekho — Bonus Pao" row used to occupy at the top of the Wallet
tab (`features/rewarded-bonus.js`'s `injectDailyMissionsButton()`,
replacing the old `injectEarnButton()`). The ad-earn entry point isn't
lost — it's consolidated into the Coin Shop modal and Daily Missions
itself instead of having two separate "earn via ads" entry points.

### 32.12 — Sky Diamond non-refundable warning moved to point-of-intent

Previously an always-visible info box on the Wallet card. Moved to
only show — in red, as a clear warning rather than passive info —
inside the "Enter Amount" step of the actual buy flow
(`showWFStep()` step 1 in `screens/wallet.js`), right before the user
commits to spending.

### 32.13 — Rank tab: duplicate "#1 / YOU" row + cluttered season banner

`js/fixes-v7.js` completely overrides `screens/rank.js`'s
`renderRank` (the latter is dead code, confirmed via load order — do
not edit `screens/rank.js`'s rank-list functions expecting them to
run). The "My Rank" card always rendered even when the user was
already visible in the top-3 podium, so a rank-#1 user saw their own
position duplicated in two different visual styles stacked on top of
each other. Fixed: the My Rank card only renders when the user is
**not** in the podium (rank > 3); the podium itself now shows a small
"(YOU)" badge + highlighted ring instead. Season banner compacted
(smaller padding/fonts, single-line layout) so it doesn't visually
compete with the rank-formula banner above it.

### 32.14 — Native `<select>` dropdowns rendered as an unstyleable white popup

Android Chrome/WebView renders native `<select>` popups as a
plain white OS-level overlay — no CSS can theme them. The Status and
Rank filter dropdowns on Home were converted to a fully custom
component (`core/custom-dropdown.js`) — a styled `<div>` trigger +
a JS-rendered dark popover — functionally identical (tap → pick →
closes) but entirely within app-controlled DOM/CSS. `core/router.js`'s
`setST()` and `features/skill-matchmaking.js`'s `_syncRankSelect()`
were updated to sync the new `.dd-current` label instead of a
`<select>`'s `.value`.

### 32.15 — Premium tier perks list was out of date; `showPremiumInfo` didn't exist

Several places (photo/banner gate, live-stream gate, creator
dashboard) called `window.showPremiumInfo()` — a function that was
**never defined anywhere in the codebase**. All references corrected
to the real function, `window.showPremiumUpgrade`. Also added
`isPremiumActive(minTier)` as the one shared tier-aware check (e.g.
`isPremiumActive(2)` requires Gold or above) and updated
`features/premium.js`'s `TIERS` array to list the new perks
accurately: Silver = photo/banner change; Gold = Creator Program
unlock + Live Stream slot (in addition to existing perks).

### 32.16 — Live Stream slot gated to Premium (previously ungated)

`features/spectator.js`'s `showStreamSettings()` had no premium check
at all before this — any user could set up a live-stream link. Now
requires Gold+ (`isPremiumActive(2)`), consistent with the Premium
tier list and the Creator Program's positioning (a creator without
Premium can still earn referral commission, but needs Gold+ Premium
specifically to unlock the in-app stream slot).

### 32.17 — Profile card visual polish

Avatar ring glow intensified (added a soft outer bloom layer, thicker
border), avatar size increased slightly, and the card's background
gradient deepened to a richer blue-purple to better match the
reference design the product owner provided.

### Still open / not done this session

- Admin Panel's Match Result screen doesn't yet have any awareness of
  `pending_review`-status matches beyond what's now in the dedicated
  **Creator Match Review** section (Section 23) — that section only
  covers the anomaly-flag queue, not general match-result review for
  admin-created matches. No change was needed there since
  admin-created matches were never routed through
  `creator_publish_result` in the first place.
- `creator_videos`, `video_reports`, `video_watches` tables are now
  fully unused (the feature they backed was removed) but were left in
  place rather than dropped, in case they're referenced by an
  analytics dashboard not covered in this session's audit. Safe to
  drop once confirmed unused elsewhere.

## 33. 2026-08 SESSION (Aug 17) — Firebase→Supabase completion, `.catch()` bug class, 9 UI bugs

This session had two goals: (1) finish the Firebase→Supabase migration
per the rule confirmed by the product owner — **Firebase only for
non-data realtime mechanisms (chat, presence, anti-cheat
fingerprinting); every other piece of data lives in Supabase, no
exceptions** — and (2) fix 9 specific UI/functional bugs reported from
live use. Delivered `AdminPanel-FIXED-v15.zip` (was v14) and
`UserPanel-FIXED-v11.zip` (was v10). All DB changes are in
`2026-08-17-SESSION-DELTA.sql` (appended to `COMPLETE_SCHEMA.sql`),
applied live via Supabase MCP already.

### 33.1 — Firebase-only allowlist narrowed to true non-data paths

Before this session, `appSettings/`, `adminConfig/`, `analytics/`,
`platformEarnings/`, `seasonStats/`, `tdsRecords/`, `tdsHeld/`,
`adminActions/`, `earlyAccessUsers/`, `creatorVideos/`, `videoReports/`
were all still on the Firebase-only list in both bridges (admin's
`supabase-rtdb-bridge.js` and user's `db-bridge.js`) — some for
legitimate-sounding reasons (e.g. "no Supabase table exists"), some
just never revisited. Per the product owner's explicit confirmation,
all of these are genuinely "data," not realtime mechanisms, so they
all needed a home in Supabase:

| Firebase path | New Supabase location |
|---|---|
| `appSettings/liveConfig` | `app_settings` row, `key='live_config'` |
| `appSettings/previewMode` | `app_settings` row, `key='preview_mode'` |
| `appSettings/adRewards` | `app_settings` row, `key='ad_rewards'` |
| `appSettings/diamondPackages` | merged into `app_settings.live_config.sdPackages` (was a second, disconnected package-price source — see 33.8) |
| `adminConfig/videoModeration` | `app_settings` row, `key='video_moderation'` |
| `adminConfig/creatorSystem` | `app_settings` row, `key='creator_system'` |
| `tdsRecords/`, `tdsHeld/` | new tables `tds_records`, `tds_held` |
| `adminActions/` | new table `admin_actions` |
| `earlyAccessUsers/` | new table `early_access_users` |
| `platformEarnings/` | new table `platform_earnings` |
| `seasonStats/{monthKey}/{uid}` | new table `season_stats` (composite PK `month_key, user_id`) + new RPC `increment_season_stats(...)` for atomic increments (replaces Firebase `.transaction()` semantics) |
| `creatorVideos/`, `videoReports/`, `videoWatched/`, `users/{uid}/videoStrikes` | **not migrated — removed.** Confirmed dead (video-sharing feature retired, see Section 32's "Still open" note above and Section 24's earlier finding). |

Also dropped the duplicate `config` table (only ever held
`currentSeason`, which now lives in `app_settings` too) — this had
been sitting alongside `app_settings` as an accidental second
key-value config table since an earlier session, and was part of what
made "Settings vs App Settings" feel duplicated (see 33.9).

**Still genuinely Firebase-only (unchanged):** `support/`, `chats/`,
`supportChats/`, `supportTyping/` (chat), `deviceJoins/`,
`flaggedDevices/`, `deviceBlacklist/` (anti-cheat), `.info`,
`presence/` (connection state — no Supabase equivalent), Firebase
Auth/Analytics/Crashlytics.

### 33.2 — The `.catch()` bug class, round 3 (~90 more instances)

Sections 24 and 32 already fixed ~74 + a handful of these. This
session found and fixed roughly 90 more across both panels — the bug
recurs because it's an easy mistake to make and no lint rule catches
it: `supabase-js`'s `PostgrestBuilder` (what `.from()` and `.rpc()`
chains return) implements `.then()` to satisfy the `PromiseLike`
interface, but does **not** implement `.catch()` or `.finally()`.
Calling `.catch()` directly on the chain — even after a `.then()` —
throws `TypeError: ...catch is not a function`, which either crashes
the enclosing function or (if wrapped in a bare try/catch elsewhere)
silently swallows the intended error handler.

Fix pattern, as established in prior sessions: replace
`.then(onSuccess).catch(onError)` with `.then(onSuccess, onError)`,
or for a bare `.catch(fn)` with no preceding `.then()`, replace with
`.then(null, fn)`.

Heaviest concentration was in `user-work/core/db-bridge.js` (34
instances, the User Panel's central Firebase-API-emulation bridge —
meaning a wide range of features had their error paths silently
broken end to end) and `admin-work/js/admin-inline.js` (24
instances, spread across match-result payout, wallet transactions,
preview mode, and more). Full file list is in the chat session log;
every touched file passes `node -c` syntax validation.

One real, load-bearing bug this exposed: **App Settings' main Save
button was completely broken** — `fa-app-settings.js`'s
`saveAppSettings()` had a `.catch()` chained straight onto a
`.update().eq()` call, which threw before the save ever completed,
surfacing to the admin as `Error: supa.from(...).insert(...).catch
is not a function`. This was reported directly by the product owner
mid-session (with a screenshot) and is now fixed as part of 33.1's
rewrite of that function.

### 33.3 — "Verified" badge always showed "Unverified"

`supabase-rtdb-bridge.js`'s `userFromSupa()` converter read
`row.profile_verified` to populate `u.profileVerified` — but
`profile_verified` is **not a column** in the `users` table; only
`profile_status` is. (Section 32.4 had already fixed 3 call sites that
read `u.profileVerified` directly, replacing them with
`u.profileStatus === 'approved'`, but the *converter itself* — the
actual source of the field — was never corrected, and 2 more call
sites in `admin-player-lookup.js` and `admin-fixes-v25-SUPABASE.js`
still read the dead field.) Every read of `.profileVerified` therefore
silently evaluated to `false` regardless of actual verification state.

This also broke a security safeguard: `admin-inline.js`'s
identity-change flow checked
`currentUser.profileVerified === true || currentUser.profile_status
=== 'APPROVED'` before blocking an IGN/UID change on an
already-verified profile — the first half was always false (see
above), and the second half checked uppercase `'APPROVED'` when live
data is always lowercase `'approved'` (confirmed via `SELECT DISTINCT
profile_status FROM users`), so the safeguard never actually
triggered via either path.

And a write-side instance of the same root cause: the profile-approval
flow (`admin-inline.js`, "Approve Profile" button) wrote
`profile_verified: true` as part of its Supabase sync call — silently
failing every time, since the column doesn't exist, though this
particular call site already had correct `.then(null, ...)` error
handling so it only logged a console warning rather than crashing.

**Fixed:** converter now derives `profileVerified` from
`profile_status === 'approved'`; the identity-change safeguard checks
lowercase `'approved'` only; the dead `profile_verified` write was
removed from the approval flow; the 2 additional dead-field readers
were corrected. `profile_status` is now the single source of truth for
verification state everywhere in both panels — no more shadow
`profileVerified`/`profile_verified` field.

### 33.4 — Duplicate "Quick Create" button in Matches section

`fa-admin-v10.js` and `fa-admin-v10-final.js` each independently
injected a "Quick Create" button (different DOM ids — `_qcBtn` vs
`_v10QcBtn` — so neither's own dedup-guard caught the other) and each
defined its own `window.showQuickCreate`, with the later-loading
`-final.js` version silently winning at runtime and shadowing the
older one's modal entirely. The older file's ~290-line Quick Create
block (templates, modal, button injection) was fully dead/shadowed
code. Removed it; kept `fa-admin-v10-final.js`'s version (also drives
the manual-creation form's template bar, a feature the older version
lacked).

### 33.5 — Live Attendance appeared in 3 different places

Turned out to be three separate, independently-built implementations,
not two:
1. A standalone sidebar nav item + dedicated section
   (`fa-admin-v10.js`'s `renderLiveAttendance`).
2. A second, page-level "inline" rendering also with its own sidebar
   nav item (`fa-admin-v10-final.js`, `window._loadAttSection` /
   `_renderAttInline` — "Section 7: INLINE ATTENDANCE SECTION").
3. A modal opened from inside Joined Players
   (`fa-admin-v10-final.js`'s `renderV10Attendance`).

(2) and (3) share the same underlying action functions
(`_v10MarkAbsent`, `_v10CopyIGNs`, `_v10StartMatch`,
`_v10ToggleStatus`) and are the more actively-developed pair — (3) is
a strict superset of (1)'s features (mark-absent, copy-IGNs) plus
per-player status toggling, a Start Match action, and tabs for Auto
Queue / Check-Ins. (1) had nothing unique. Kept (3) — reached via the
button inside Joined Players, no separate nav entry needed — removed
(1) and (2) entirely along with their sidebar nav items and HTML
sections. `_goToAttendance()` (called from match-start alert popups)
now redirects into the kept modal instead of the removed standalone
section.

### 33.6 — Coin Requests removed (feature was fully dead)

Confirmed zero code path in the User Panel ever creates a
`coin_requests` row — there is no coin-purchase UI anywhere in the
User Panel, coins are only ever earned (ads, missions, streaks,
referrals), never bought. `SELECT count(*) FROM coin_requests` was 0
and would stay 0 forever. Removed the sidebar nav item, dashboard
stat tile, the whole admin section (approve/reject queue), the
`loadCoinRequests`/`approveCoinRequest`/`rejectCoinRequest` functions,
and the Supabase Realtime badge-polling subscription in
`admin-fixes-v21.js`. The `coin_requests` table itself and the
bridge's `coinRequests` → `coin_requests` path mapping were left in
place (harmless, inert infrastructure) rather than removed, since
nothing calls it anymore either way.

### 33.7 — Ad Rewards Settings: removed the "Sky Diamond Reward" box

Confirmed no code anywhere in the User Panel grants diamonds for
watching ads — `features/watch-earn.js` (the only ad-watching reward
logic) only ever credits `coins`. The admin's "Sky Diamond Reward"
sub-box (ads-to-diamonds config: how many ads per diamond, daily
limit) was never read by any User Panel code — fully disconnected.
Removed that half of the card; kept "Coin Reward" (which is live) and
migrated its config from the broken Firebase path
(`appSettings/adRewards`) to `app_settings` (see 33.1).

### 33.8 — Two disconnected "Diamond Package" price editors

The Settings section had its own "💎 Diamond Package Settings" card
(`#diamondPkgEditor`, writing to `appSettings/diamondPackages` on
Firebase) that was a complete duplicate of App Settings' "Sky Diamond
Packages" card (writing to `app_settings.live_config.sdPackages` on
Supabase) — same purpose, two different editors, two different
storage locations. Worse: the User Panel's two diamond-purchase
screens each read from a *different* one of the two —
`screens/wallet.js` read `window.CFG.sdPackages` (App Settings'
source, correct), while `js/quick-deposit.js`'s `startAdd()` (the
primary "Buy Sky Diamonds" flow) read `appSettings/diamondPackages`
directly from Firebase (the other, now-broken source) — meaning an
admin editing prices in App Settings would silently not affect what
users saw on the main purchase screen. Removed the Settings-page
editor and its `saveDiamondPackages`/`addDiaPkgRow`/`loadDiaPkgEditor`
functions; fixed `quick-deposit.js` to read `window.CFG.sdPackages`
like `wallet.js` does. Manage diamond package prices from **App
Settings only** going forward.

### 33.9 — 7 admin sections rendered completely blank

Creator Program, Growth Analytics, Brackets, Clan Wars, City
Championship, Mentors, and Clean Badges all showed an empty body when
clicked — nav highlighted correctly, header text changed, but no
content ever appeared. Two independent root causes, found by tracing
where each section's HTML actually gets built (none of these exist as
static markup in `index.html` — all 7 are dynamically injected):

1. **CSS specificity bug.** `fa-growth-admin.js` (Creator Program,
   Growth Analytics) and `features/fa-v17-features.js` (the other 5)
   both set an inline `element.style.display = 'none'` on the
   dynamically-created `<div class="section">`. The stylesheet's
   `.section { display:none } .section.active { display:block }`
   rule is what `showSection()` relies on to reveal a section — but
   an inline style always wins over a class-based rule regardless of
   which loads later or how specific the selector is. So even after
   `showSection()` correctly added the `.active` class and the
   section's content was correctly built and inserted, it stayed
   invisible forever. Confirmed by comparing against working static
   sections in `index.html`, none of which set this inline style —
   they rely purely on the CSS class. Fix: removed the inline style
   from both files; the CSS class alone is sufficient.

2. **Wrong DB handle** (`features/fa-v17-features.js` only, affecting
   Brackets/Clan Wars/City Championship/Mentors/Clean Badges).
   `getDB()` returned `window.db` — which, per
   `supabase-rtdb-bridge.js`'s own installation comment
   ("`window.db` is Firestore — DO NOT override it"), is an unrelated
   Firestore client, not the RTDB-style Supabase bridge these
   functions actually call `.ref()`/`.once()` on. Firestore has no
   `.ref()` method, so every load function in this file would have
   thrown `TypeError: db.ref is not a function` the instant it ran —
   independent of and in addition to bug (1) above. Fixed `getDB()`
   to return `window.rtdb` (with a bridge-ready check, returning
   `null` cleanly — which every caller already handles via its own
   `if(!db){...'DB error'...}` guard — rather than risk hitting raw
   pre-bridge Firebase on these Supabase-only paths).

   Also fixed 5 more `.catch()`-on-builder instances found while
   auditing this file (see 33.2).

Verified live: `tournament_brackets`, `clan_wars`, `mentor_profiles`,
`city_championship` tables all exist with data flowing correctly.
Clean Badges has no dedicated table by design — it reads/writes
`clean_matches`/`has_clean_badge` columns directly on `users` (both
confirmed to exist), consistent with an earlier session's fix noted
in this file (bridge mapping for Clean Badge Admin was previously
corrected; the blank-screen bug was unrelated to that fix and is what
this session addressed).

### 33.10 — Stale "Firebase" labels in App Settings UI text

Two leftover UI strings in `index.html`'s App Settings section header
still read "— Firebase mein save hota hai, user app mein live" and
"Ye settings Firebase mein save hoti hain..." — accurate before 33.1's
migration, misleading after. Both corrected to say Supabase.

### Left unchanged this session (by explicit instruction)

**Player Lookup sidebar item** — flagged as a possible duplicate of
the dashboard header's quick-search (`handleGlobalSearch`), since both
let an admin search by UID/username and open the same user-detail
modal. Investigated the dedicated Player Lookup section
(`admin-player-lookup.js`) before touching anything: it's not a pure
duplicate — it additionally searches by phone/email, computes
win-rate, and flags accounts with a suspiciously high win rate (>70%)
for manual review, none of which the header search does. Since the
sidebar nav item is the *only* entry point into that section, removing
it would make ~270 lines of that extra functionality permanently
unreachable rather than just tidying navigation. Flagged this
trade-off; product owner chose to leave it as-is for now, revisit
later.

### Files changed this session

**Admin Panel:** `index.html`, `js/supabase-rtdb-bridge.js`,
`js/fa-app-settings.js`, `js/admin-inline.js`, `js/fa-admin-v10.js`,
`js/fa-admin-v10-final.js`, `js/fa-growth-admin.js`,
`js/features/fa-v17-features.js`, `js/admin-fixes-v21.js`,
`js/admin-fixes-v25-SUPABASE.js`.

**User Panel:** `core/db-bridge.js`, `core/listeners.js`,
`core/router.js`, `screens/wallet.js`, `screens/matches.js`,
`screens/profile.js`, `screens/join.js`, `screens/rank.js`,
`features/ads.js`, `features/checkin-system.js`,
`features/premium-creator.js`, `features/premium.js`,
`features/growth.js`, `features/battle-pass.js`,
`features/match-history.js`, `features/watch-earn.js`,
`features/creator-video-feed.js`, `features/bundle-offers.js`,
`features/clan.js`, `js/diamond-system.js`, `js/quick-deposit.js`,
`js/fixes-v9.js`, `js/fixes-v29-all-bugs.js`,
`js/fix6-offline-queue.js`, `js/preview-mode.js` (read-side only, no
change needed — already correctly pointed at the Supabase path
Preview Mode now uses).


## 34. 2026-08 SESSION (Aug 18) — Anon-bypass security fix (13 RPCs), Sky Diamond approval order/ID bugs, missing UTR data, dead Match Result section, disconnected mission rewards

This session started from a batch of 12 live-testing bug reports and
grew significantly once tracing the Sky Diamond approval bug
surfaced a shared, critical flaw across 13 admin-gated RPCs. That fix
(34.1) is the most important change in this session — read it even
if you're only interested in one of the other bugs below.

### 34.1 — CRITICAL: anon-bypass on 13 SECURITY DEFINER RPCs

**This was a live, exploitable security hole, not just a bug.**

Every one of these RPCs shared the same pattern:

```sql
IF v_caller IS NOT NULL THEN
  -- check is_admin, reject if not
END IF;
-- falls through and proceeds regardless if v_caller WAS NULL
```

where `v_caller := auth.jwt() ->> 'sub'`. The original design intent
(documented elsewhere in this guide, Section 31) was "`v_caller IS
NULL` means a trusted service_role/backend caller (e.g. the
paytm-callback edge function) — skip the admin check for those,
since a backend job legitimately has no end-user JWT to check."

That assumption turned out to be wrong in a way that mattered. Two
things were verified live this session, in this order:

1. **A Firebase-authenticated caller's JWT reliably carries a `sub`
   claim even without a `role` claim.** Simulated via
   `SET LOCAL request.jwt.claims = '{"sub":"..."}'` (no `role` key at
   all) and confirmed `auth.jwt()->>'sub'` still resolves correctly.
   This matches this project's known "Firebase JWTs lack a `role`
   claim so Postgres treats the request as `anon`" issue (Section 17)
   — but that issue affects the Postgres *role* the connection runs
   as, not the JWT *claims* Postgres can read from it. `v_caller`
   should essentially never be NULL for a genuine logged-in admin's
   browser session.

2. **Therefore `v_caller IS NULL` was, in production, almost
   exclusively hit by genuinely anonymous callers** — anyone with
   just the public `anon` key and no `Authorization: Bearer <jwt>`
   header at all, which any browser's dev console or a basic script
   can send directly to the Supabase REST/RPC endpoint.

The practical impact: any unauthenticated caller could call
`increment_balance` to credit their own account (or anyone else's)
unlimited coins/diamonds, broadcast fake notifications to every
user, activate Premium on any account for free, approve/reject
wallet or creator requests, or adjust rank points — all with zero
admin check ever executing, as long as they simply didn't send a JWT
at all.

**Fix:** replaced the "trust a NULL claim" logic with a check of the
actual Postgres connection role:

```sql
v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
...
IF NOT v_is_service THEN
  IF v_caller IS NULL THEN
    -- reject: no caller identity, and not a real service_role call
  END IF;
  -- normal admin check
END IF;
```

`current_setting('role', true)` reports the actual Postgres role the
connection is using — `service_role` only for genuine backend/edge
function callers (confirmed live via `SET LOCAL ROLE service_role`),
never for a browser-originated `anon`/`authenticated` call regardless
of what JWT claims are or aren't present. This closes the hole
without touching the one legitimate use case (true backend/service
calls) the original NULL-check was meant to protect.

**Verified both directions live, after the fix:**
- Admin self-call (`SET LOCAL ROLE authenticated` +
  `request.jwt.claims` with a real `sub`) → still succeeds, no
  regression.
- True anon call (`SET LOCAL ROLE anon`, no JWT claims at all) →
  now raises `Not authorized — no caller identity` instead of
  silently proceeding.

**Affected functions (all 13 fixed identically):**
`increment_balance`, `decrement_balance`, `resolve_sd_request`,
`approve_premium`, `admin_send_broadcast_notification`,
`admin_send_notification`, `admin_sync_user_balance`,
`admin_set_coins`, `resolve_sponsored_withdrawal`,
`approve_creator_application`, `cancel_premium`,
`review_creator_video`, `increment_rank_points`.

Full DDL for all 13 is in `2026-08-18-SESSION-DELTA.sql` Part 3
(also appended to `COMPLETE_SCHEMA.sql`), including the exact
verification queries run.

**Note for future RPCs:** if you're writing a new SECURITY DEFINER
function that needs to allow a genuine backend/service_role caller
to skip the normal admin/self check, use
`current_setting('role', true) = 'service_role'` — do NOT use
`auth.jwt() ->> 'sub' IS NULL` as a proxy for "trusted caller." It
isn't one.

### 34.2 — Sky Diamond approval: wrong-order writes + Firebase-key/Supabase-UUID mismatch

Two independent bugs compounded into "approval sometimes shows an
error, but the request still vanishes from the list, and the user
sometimes gets the diamonds anyway, sometimes doesn't":

1. **Wrong order.** `_wrapApproveAddMoney` and `_wrapApproveSkyDia`
   (`admin-supabase-sync.js`) both called `orig.apply()` — the
   Firebase-side status flip + success toast + list refresh — BEFORE
   the actual Supabase crediting logic ran. If the Supabase step
   failed for any reason, the admin had already seen "success" and
   watched the row disappear from the list, with no money ever
   credited. Paisa baad mein milna chahiye tha karne ke baad
   confirm hone ke, na ki UI turant "success" dikha de aur baad mein
   pata chale ki fail ho gaya.

2. **ID mismatch.** The Approve/Reject buttons in every Sky Diamond
   UI table (`renderWalletRequests`, `loadSkyDiamondReqSection`)
   pass the Firebase key (e.g. `-Nx7f...` or a `sb_...` synthetic
   key) as the request ID — but `resolve_sd_request(p_request_id
   UUID, ...)` expects `sd_requests.id`, a real Supabase UUID. These
   never matched, so the RPC always returned "Request not found" (or
   coincidentally "already resolved" if a retry landed on a
   different, already-processed row) — exactly the error seen in
   testing, arriving *after* the Firebase side had already shown
   success.

**Fix:** reordered every approve/reject path (`approveAddMoney`,
`approveSkyDiaReq`, `rejectSkyDiaReq`, `rejectSkyDiamond`) so the
Supabase RPC call happens FIRST and only updates
Firebase/UI/notifications after Supabase confirms success — a failed
credit now correctly shows an error and leaves the request visibly
pending, instead of falsely appearing resolved. Added a shared
helper `window._resolveSdRequestId(rawId)` (in
`admin-supabase-sync.js`, available globally once that script loads)
that detects whether `rawId` is already a real UUID (regex-tested)
or a legacy Firebase key needing lookup via
`sd_requests.firebase_req_id`, and resolves to the correct
`sd_requests.id` either way. All four approve/reject call sites now
route through this helper instead of assuming the ID format.

### 34.3 — UTR/UPI and screenshot never actually reached storage

**"Wallet request me UTR/UPI, proof, status missing hai jabki photo
add ki gai thi"** — traced to `quick-deposit.js` (User Panel, the
"Buy Sky Diamonds" flow):

1. The form never had a UTR/UPI reference number input field at
   all — nothing was ever collected to send.
2. The screenshot WAS uploaded to ImgBB correctly, but the returned
   `url` was silently discarded — `_doSubmit()` was called with no
   arguments, so neither Firebase nor Supabase ever received it.
   Firebase instead got the raw base64 data URL (`screenshotBase64`)
   written directly, bypassing the whole point of the ImgBB upload
   (keeping large blobs out of the realtime DB).
3. The Supabase `sd_requests` INSERT never included `screenshot_url`
   or `upi_ref` at all, even though both columns already existed on
   the table from an earlier session.

**Fix:** added a required UTR/UPI text input to the deposit form;
fixed `_doSubmit(screenshotUrl)` to actually receive and use the
ImgBB URL; both Firebase (`screenshotUrl`, `utrNumber`) and Supabase
(`screenshot_url`, `upi_ref`) now get the real values. Also removed
a self-notification this flow used to send ("you submitted a
diamond purchase request") — per direct product-owner feedback, a
user doesn't need to be told they just did something they did
themselves; it only adds noise. A real notification still arrives
once admin approves/rejects, via `admin_send_notification`.

Since the admin-side Sky Diamond tables were still reading this data
from Firebase (which never had it, and even after this fix wouldn't
show it consistently since Supabase is the real source of truth for
`sd_requests`), also switched `loadSkyDiamondReqSection()` and the
unified wallet table's data source
(`setupWalletListener`/`_refreshSdRequestsIntoWallet`) to read
sky-diamond-purchase rows directly from Supabase `sd_requests`,
adding a UTR/UPI column to `loadSkyDiamondReqSection`'s table that
didn't exist before. Withdrawal-type rows (sponsored prize payouts)
are untouched and still come from Firebase — that table lives in
`wallet_transactions`, a separate system from `sd_requests`, and
wasn't part of the reported bug.

### 34.4 — Profile update crash: `Cannot create property 'ff_uid' on string`

`approveProfileUpdate` (admin-inline.js) calls
`rtdb.ref('ffUIDIndex/' + newFfUid).set(uid)` — passing a raw string
(`uid`) as the value, not an object. `supabase-rtdb-bridge.js`'s
`supaSet()` had no dedicated handler for a scalar `.set()` against
`ffUIDIndex` specifically; `getNestedTableHandler` returns
`{table, filter}` with no `.field` and no `.insertPatch` for this
path, so it fell through to the generic "upsert row at root table"
branch. That branch calls `genericToSupa(data)`, which returns
non-object data completely unchanged (since it can't spread a
string into snake_case keys) — then tries
`upsertData[mapping.id] = p.id`, i.e. assigning a property onto a
string primitive, which throws exactly
`Cannot create property 'ff_uid' on string '<uid>'` — matching the
crash seen on every profile-update approval that changed the FF UID.

**Fix:** added an explicit scalar-set handler in `supaSet()` for
`p.root === 'ffUIDIndex'` with non-object data, which upserts
`{ff_uid: p.id, user_id: data}` into `ff_uid_index` directly — no
change needed on the caller side, since `approveProfile` and
`approveProfileUpdate` were already calling `.set(uid)` with a plain
string, which is exactly what the new handler expects.

### 34.5 — Daily login mission: claimed but still shows as unclaimed

**"Daily login claim ho chuka hai fir bhi green hai, button dabane
par sahi claimed message aata hai vaise bas button dekhne par nahi
lagta"** — `showMissionsPanel()` renders the whole modal
synchronously using a `prog` snapshot fetched via `.once('value')`
*before* checking whether daily login needs auto-claiming. The
auto-claim (`claimMission('daily_login', ...)`) then fires
asynchronously right after — but the modal's HTML, including the
"Claim +5" button, was already drawn from the stale pre-claim
snapshot. `claimMission`'s success path does re-render the panel
~300ms later, but its **already-claimed early-return path used to
skip that re-render entirely** — so a second claim attempt (e.g. the
user tapping the still-visible "Claim +5" button) correctly showed
an "already claimed" toast but never visually updated the card,
leaving it looking permanently un-claimed until the panel was
manually closed and reopened.

**Fix:** the already-claimed branch in `claimMission()` now also
triggers the same re-render as the success path, so any claim
attempt — genuinely new or already-done — always leaves the UI in
sync with the real backend state.

### 34.6 — Result Share: Weekly Mission card never completes, its own +20 unreachable

**"Result share karne par koi coin nahi"** — `giveShareCoins()` (the
Match screen's share button) and the Weekly Mission "Result Share
Karo" card in the Missions panel are two completely disconnected
reward systems that happened to share similar names. Sharing via the
match screen correctly pays its own +20 coins immediately (tracked
via `shareRewards/{today}`) — but never sets
`missionProgress/wShare_{weekNum}`, which is the ONLY thing the
Weekly Mission's `week_share` card actually checks (`week_share`
mission's `.check` reads `prog['wShare_'+weekNum] === true`). That
meant the Weekly Mission card could never show as complete, could
never be claimed, and its separate +20 reward was permanently
unreachable regardless of how many times the user shared.

**Fix:** `giveShareCoins()` now also writes
`missionProgress/wShare_{weekNum} = true` after crediting its own
coins, so the Weekly Mission card correctly flips to "done" and
becomes claimable the same week the user shares — without changing
the immediate share-coins reward at all (these remain two separate,
intentional reward pools: instant coins for the act of sharing, plus
a weekly bonus for having shared at least once that week).

### 34.7 — Match Result section: "Select Match" dropdown always empty

**"Match ka result upload karne ke liye select match par click karne
par match show hi nahi ho raha"** — traced to
`loadMatchResultSection()`, called by the sidebar's "Match Result"
nav item, being **called but never defined anywhere in the entire
codebase**. Confirmed via exhaustive search across every JS file —
zero definitions, zero even as a stub.

Tracing further revealed the whole `section-matchResult` panel this
nav item opens has never had a working foundation at all — not just
the dropdown-populate function, but also `mrPublishResults`,
`mrAddScreenshots`, and `mrClearScreenshots`:

- `mrPublishResults` exists ONLY as four layered wrapper-patches
  (`security-patches.js`, `admin-fixes-v21.js`,
  `admin-fixes-v22-FINAL.js`, `admin-fixes-v23-FINAL.js`), each
  written as `var orig = window.mrPublishResults; if (!orig) return;`
  — expecting an earlier version to already exist. None ever does.
  `patchWhenReady()` (the helper these patches use to wait for a
  base to appear) polls up to ~24 seconds then gives up silently.
  `window.mrPublishResults` was permanently `undefined` — clicking
  "Publish Results & Distribute Prizes" in this section would have
  thrown `mrPublishResults is not defined`.
- `mrAddScreenshots` — same pattern, only a wrapper in
  `fa-admin-v10.js`, no base.
- `mrClearScreenshots` — no definition anywhere, not even a wrapper.
  The Clear button's `onclick` would throw immediately.

Meanwhile `section-results` (a separate, near-identical duplicate
section, reachable only via a "Publish Result" button inside a
specific match's row rather than the sidebar) has a complete,
working implementation: `loadParticipants()` for the player table,
`publishResults()` as a genuine base function, already synced to
Supabase via `admin-supabase-sync.js`'s `_wrapPublishResults`, and
already tested/working in this session's live-testing pass.

**Fix:** rather than hand-building an entire second
OCR/screenshot/anomaly-check result-publishing pipeline from
scratch — duplicating real, working, already-tested logic, with all
the risk of introducing new bugs that implies — the sidebar's "Match
Result" nav item now goes straight to `section-results` instead of
the broken `section-matchResult`
(`showSection('results',this);loadMatchResultSection()` in
`index.html`). `loadMatchResultSection()` is now defined as a small
defensive function that ensures `resultTournamentSelect` is
populated (falling back to building it from `allTournaments`
directly if the normal central `loadTournaments()` population pass
hasn't run yet), rather than a full redirect implementation, since
`showSection('results', this)` is now called directly by the nav
item itself.

`section-matchResult`'s HTML block and its unused
`mrPublishResults`/`mrAddScreenshots`/`mrClearScreenshots` patch
files were intentionally left in place rather than deleted — no
other code path references `'matchResult'` anymore (confirmed via
search), so they're inert, and removing them wasn't necessary to fix
the reported bug. Flagging here in case a future cleanup pass wants
to remove the dead files outright.

### 34.8 — "Verified" badge showed for users who were never approved

Related to but distinct from 34.9 below. Two spots in
`admin-inline.js` (the Users list table's badge, and the CSV export)
treated `profileStatus === 'complete'` as equivalent to `'approved'`
when deciding whether to show a green verified checkmark. `'complete'`
was never meant to mean "approved by an admin" — it meant "profile
info fields are filled in," and (per 34.9) was also the column's
default value for every brand-new signup. The practical effect: every
new user showed as "Verified" in the admin Users list the instant
they signed up, regardless of whether anyone had ever reviewed them.

**Fix:** both spots now only treat `'approved'` as verified.

### 34.9 — `users.profile_status` defaulted to `'complete'`, not `'pending'`

Root cause behind 34.8, and behind the specific report "Playwright
Test User ki profile verified nahi thi fir bhi verified show ho raha
hai" — though in that specific case, the user's `profile_status`
genuinely was `'approved'` in the database already (confirmed via
direct query — this user really had been through
`admin_approve_profile` during earlier live-testing in this same
session), so the *displayed* badge was technically accurate for that
one row. The column-default bug is real regardless and affects every
*other*, never-reviewed user: `ALTER TABLE users ALTER COLUMN
profile_status SET DEFAULT 'complete'` (its state before this
session) meant every new signup got `'complete'` with nothing in the
signup path ever setting it explicitly — combined with 34.8's badge
logic, this made every new user appear pre-verified.

**Fix:** `ALTER TABLE users ALTER COLUMN profile_status SET DEFAULT
'pending'`. No data migration needed — all 5 existing users already
had `profile_status = 'approved'` for real, via genuine admin
approval.

### 34.10 — Global broadcast notification error: already resolved, false alarm

A screenshot showed `supa.from(...).insert(...).catch is not a
function` on the "Send to All" button. Traced the exact call chain
(`sendGlobalNotification` → `window._adminNotifyAll`) and confirmed
this is already fixed by the current code: `admin-inline.js` defines
a `_adminNotifyAll` that does a direct `.from('notifications').insert()`
(vulnerable to exactly this bug if it were live), but
`supabase-rtdb-bridge.js` — which loads AFTER `admin-inline.js` —
overwrites it with a version that correctly calls the
`admin_send_broadcast_notification` RPC instead. Verified both this
RPC and `admin_send_notification` exist live and are executable by
`authenticated`/`anon`. The screenshot was from before this fix was
deployed; no further code change was needed here. (While verifying
these two RPCs, found and fixed the anon-bypass issue described in
34.1 — this is what led to discovering that broader problem.)

### 34.11 — Maintenance Mode: migrated off Firebase entirely, onto Supabase

**"Maintenance mode on hai par kaam nahi kar raha"** — traced the
entire Firebase-based path on both panels and found every piece of
it individually correct in code (admin's `toggleMaintenance()`
genuinely wrote to real Firebase via proper Firebase Auth; User
Panel's `checkMaintenance()` genuinely read the same real Firebase
path via the bridge's Firebase-only passthrough allowlist;
`firebase-rules.json`'s rule for `appSettings` was correct). The
most likely explanation was that the rules actually deployed live on
the Firebase Console differed from `firebase-rules.json` in this
repo — rules aren't auto-deployed on push, that's a manual step —
but this couldn't be confirmed or fixed without Firebase Console
access.

Rather than leave this dependent on a manual Firebase Console step
that couldn't be verified, **Maintenance Mode was migrated off
Firebase entirely**, onto Supabase `app_settings` — the same
approach already used successfully for Preview Mode
(`preview_mode` key). This removes the Firebase-rules dependency
completely.

**What changed:**
- New `app_settings` row: `key='maintenance'`,
  `value={"active": bool, "message": ""}`.
- `app_settings` already had correct, tested RLS policies from
  Preview Mode's earlier migration — `as_select_all` (anyone can
  read) and `as_admin_write` (`auth.jwt()->>'sub'` must match a
  `users.id` with `is_admin=true`) — reused as-is, no new policy
  needed. Verified live: a real admin's write succeeds; a non-admin
  user's write is silently filtered out by RLS (0 rows affected).
- Admin's `toggleMaintenance()`/`loadMaintenanceState()` now
  read/write `app_settings` directly via `window._supa`, with the
  same read-back verification hardening added in the previous
  session kept in place (confirms the value that comes back matches
  what was just set).
- User Panel's `checkMaintenance()` now reads `app_settings` on load
  and subscribes to Supabase Realtime (`postgres_changes` on
  `UPDATE`) for live updates — replacing Firebase's `.on('value')`
  behavior. **Important:** `app_settings` was not in the
  `supabase_realtime` publication at all — `ALTER PUBLICATION
  supabase_realtime ADD TABLE app_settings;` was required, or these
  subscriptions would have silently never fired (same class of
  "looks wired up correctly but the underlying publication was never
  turned on" issue as the earlier RLS-policy tracing in this
  session). This also benefits Preview Mode's own realtime behavior
  going forward, if it wasn't already covered by a table already in
  the publication.

No Firebase Console action is needed for this feature anymore.
`appSettings/maintenance` in `firebase-rules.json` is now unused by
this specific feature (the `appSettings` path itself may still be
used by other things — not removed).

### Files changed this session


**Admin Panel:** `index.html`, `js/supabase-rtdb-bridge.js`,
`js/admin-inline.js`, `js/admin-supabase-sync.js`.

**User Panel:** `js/quick-deposit.js`, `js/features-user.js`,
`features/growth.js`.

**Database (via Supabase MCP, project `hddhkculuyrfoevxmlwy`):**
`support_tickets` (added `replied_at` column), `users`
(`profile_status` default changed), and 13 RPC functions replaced
(see 34.1). Full DDL: `2026-08-18-SESSION-DELTA.sql`.


---

## Session: 2026-08-21 — 16-issue live-fix batch

Junaid reported 16 issues from live-testing screenshots in one batch
(v14/v18 zips). Full DDL for every live Supabase change this session:
`2026-08-21-SESSION-DELTA.sql`. All 16 confirmed fixed by end of
session.

### 1. WhatsApp share — "web page not available"
Root cause: refer/share buttons used the native `whatsapp://send?...`
URI scheme, which only resolves inside the wrapped Android app's
WebView (MainActivity.java intercepts it). Opened in a plain browser
(confirmed via screenshot showing `net::ERR_UNKNOWN_URL_SCHEME`), there
is no handler for the bare custom scheme. Fixed by switching all 6
occurrences to the universal `https://wa.me/?text=...` (and
`https://wa.me/<phone>?text=...` for the one with a phone number) —
works identically in both the wrapped app and a plain browser.
**Files:** `features/growth.js` (×2), `screens/profile.js`,
`features/player-card.js` (×2), `features/premium-creator.js`,
`features/app-config.js`.

### 2. Leaderboard stuck on "Loading..."
Root cause: the Supabase-path branch of `loadCityLeaderboard`
(growth.js) called `window.renderCityLeaderboard(...)` — a function
that was never defined anywhere in the codebase. The only similarly-
named function, `_renderCityLeaderboardModal` (modal.js), is unrelated.
So the query would succeed but silently render nothing, leaving the
spinner forever. Fixed by extracting the real, working row-rendering
logic (previously only reachable via the legacy Firebase path below it)
into a shared `renderLeaderList()` function used by both paths.
**File:** `features/growth.js`.

### 3. Profile Update "FF UID already taken" + new UID-change feature
Investigated the reported false-positive (IGN-only change getting
rejected as a UID collision) — traced through
`getNestedTableHandler`'s `ffUIDIndex` read path and confirmed the
2026-08-19 fix (scalar `user_id` return via `isScalar` snapshot) was
already correctly in place; this specific false-positive is not
reproducible in current code, just needs a fresh deploy.

New feature per Junaid's request: users can now actually request an FF
UID change (previously permanently locked with no in-app path). Premium
members get it free; everyone else pays a one-time ₹49 fee with
payment-screenshot + UTR proof (same pattern as Sky Diamond/Season Pass
purchases), reviewed manually by admin in the Profile Updates queue.
**New DB columns:** `profile_updates.uid_change_requested`,
`uid_change_via`, `payment_screenshot`, `payment_utr`, `payment_amount`
(see delta SQL §1). **Files:** `screens/profile.js` (new
`showChangeFfUid()` flow), `supabase-rtdb-bridge.js`
(`profileUpdFromSupa`/`profileUpdToSupa` converters extended to pass
these fields through — previously a fixed whitelist silently dropped
them even though the User Panel wrote them fine), `admin-inline.js`
(`renderProfileUpdates` now shows a Premium/Paid badge + payment proof
thumbnail + UTR).

### 4. IGN character limit
No limit existed; some users had set very long IGNs. Added client-side
`maxlength="20"` + JS validation (`screens/profile.js`) and a DB-level
`CHECK` constraint (`users_ign_length_check`, NOT VALID — one existing
test row already exceeds 20 chars, see delta SQL §2 for details on why
NOT VALID was used instead of a hard VALIDATE).

### 5. User Note feature never saved anything
`adminNotes/{uid}` was in `TABLE_MAP` pointed at `admin_notes` with
`id: 'id'` — meaning `p.id` (the uid) was being written into the
table's own UUID primary key column instead of `user_id`, and
`admin_notes` had no unique constraint on `user_id` for a proper
upsert-by-user pattern anyway. In practice: `rtdb.ref('adminNotes/'+uid)
.set(text)` either crashed (assigning a property onto a boxed string
data value in the generic upsert path) or silently no-op'd. Fixed by
moving `adminNotes` out of the generic `TABLE_MAP` and into
`getNestedTableHandler` as a proper field-scalar handler (same pattern
as `battlePass`), plus added `admin_notes_user_id_unique` (delta SQL
§3) so the upsert has a real conflict target. **Files:**
`supabase-rtdb-bridge.js`, `js/features/fa24-admin-smart-tools.js`.

### 6. Season Pass approve error ("Cannot create property 'created_at'
on boolean 'true'") + horizontal scroll
Traced the exact bridge path for `battlePass/{season}/{uid}/hasPremium`
`.set(true)` end-to-end (including a standalone Node simulation of the
path-parsing logic) — confirmed it correctly resolves to the
`has_premium` field-scalar branch in current code and never reaches the
boolean-crashing generic-upsert fallback that would explain this error.
This specific error is not reproducible against the current zip; the
screenshot predates a prior fix. No code change needed here — just
redeploy.

Horizontal scroll was real and is **fixed globally**: no `.data-table`
anywhere had an overflow wrapper, so on mobile landscape any table with
more columns than fit the screen just got cut off with no way to reach
the rest (confirmed on both Season Pass Requests and Cosmetics
Revenue). Fixed once at the CSS level — `.data-table` is now
`display:block; overflow-x:auto` with `thead`/`tbody` forced back to
`display:table` to preserve column alignment — so every current and
future `.data-table` gets horizontal scroll automatically, no per-table
patching needed. Also added the missing `class="data-table"` to the
Cosmetics Revenue table, which had no class at all. **Files:**
`style.css`, `js/admin-ui-v10.css` (duplicate rule, same fix applied to
both), `js/fa-growth-admin.js`.

### 7. Team Request system — removed entirely
Confirmed via `screens/profile.js` that direct squad add/remove (no
approval step) was already the live, working mechanism — Team Requests
was dead legacy infrastructure only surfaced in the Admin Panel nav.
Removed completely: nav item, section HTML, `loadTeamRequests()`,
`approveTeam()`, the `DB_TEAM` constant, the `teamBadge` listener, the
dashboard-load call, the section-switch call, and the
`openRejectModal('team', ...)` handler branch — all removed together so
nothing references a since-deleted DOM element or constant. **File:**
`admin-inline.js`, `index.html`.

### 8. Support Ticket UI — WhatsApp-style redesign
Old UI: one flat card per ticket row, `replyTicket()` used a native
`prompt()` popup, and a back-and-forth with the same user rendered as a
pile of disconnected boxes rather than a conversation (schema-wise
`support_tickets` is still one-message-per-row — no thread table
exists). Redesigned `loadSupportTickets()` to group rows by `user_id`
client-side and render each user's ticket history as a proper chat
thread: user messages as left/grey bubbles, admin replies as
right/green bubbles, with an inline reply textarea (replacing the
`prompt()` popup) per thread. **File:** `admin-inline.js`.

### 9. Global "Send to All" — silently did nothing
`_adminNotifyAll` called the `admin_send_broadcast_notification` RPC
with only `.catch()` — but the RPC returns `{success:false,
error:'Admin only'}` as a normal 200 response (a jsonb payload) rather
than a thrown error when the caller isn't recognized as admin, so
`.catch()` never fired for that case and the button gave zero feedback
either way. Fixed to inspect the actual returned payload and surface a
real toast on both success and failure. Also removed a redundant
per-user Firebase-loop in `sendGlobalNotification()` that wrote an
individual notification row per user *in addition to* the RPC call —
`notifications.target_all` already serves every user with one row, so
the loop was duplicate write load for nothing. **Files:**
`supabase-rtdb-bridge.js`, `admin-inline.js`.

### 10. "Global Message" — investigated reported duplicate
No literal UI duplicate exists. Settings tab's "Global Message" (a
persistent banner shown to all users until cleared, fanned out to 3
Firebase paths — `appSettings/banner` for the dynamic banner box,
`appSettings/ticker` for the scrolling ticker strip, and
`appSettings/globalMessage` as the field's own storage so the Settings
textarea repopulates correctly on page load — all 3 are genuinely
consumed elsewhere in `features-user.js`, confirmed, not dead writes)
is a completely different feature from the Notifications tab's
"Global" broadcast (a one-time bell notification via
`sendGlobalNotification`/`_adminNotifyAll`, issue #9 above). The
identical wording ("Global"/"Message" in both places) is what caused
the perceived duplication. Relabeled the Settings field to "📢 Sticky
Banner Text" with an inline note pointing to the Notifications tab for
one-time announcements, to remove the ambiguity. **File:** `index.html`.

### 11. Preview Mode — toggle had no effect on users
Root cause: `preview-mode.js`'s `checkPreviewMode()` in the User Panel
was still listening on `window.db.ref('appSettings/previewMode')` — a
Firebase RTDB path — while the Admin Panel's `togglePreviewMode()` had
already been migrated to Supabase `app_settings` (key=`preview_mode`).
The two were completely disconnected: admin toggles it on, writes to
Supabase, and the User Panel's listener — still pointed at the dead
Firebase path — never sees the change. Fixed using the same pattern
already established for Maintenance Mode: initial Supabase read +
`postgres_changes` realtime subscription on `app_settings` filtered to
`key=eq.preview_mode`. Also fixed the early-access-user upsert inside
this same function, which used the wrong column name (`uid` instead of
`user_id`) for the `early_access_users` table. **File:**
`js/preview-mode.js`.

### 12. Creator Program commission — CRITICAL, real-money bug
The `validate_and_join_match` RPC had the creator commission percentage
**hardcoded to 25** (`v_commission_pct NUMERIC := 25;`), completely
disconnected from the Admin Panel's Creator Program settings, which
default to and display **15%** everywhere in the UI. Every creator
match was silently paying out ~1.67x the documented/intended rate, with
no error anywhere to surface it — this was caught only by directly
reading the live RPC source and comparing it against the settings UI,
not from any error report. Fixed to read
`app_settings.creator_system.sdMatchCommissionPct` live (falling back
to 15 only if that row is ever missing/malformed) — see delta SQL §5
for full DDL, including seeding the previously-empty `creator_system`
settings row with real defaults (delta SQL §4).

**Important gotcha hit live this session:** replacing the RPC with
`CREATE OR REPLACE FUNCTION` reset its privilege grants and briefly
re-opened `EXECUTE` to the `anon` role — a security hole that had been
explicitly closed in an earlier session's audit (the original
"unauthenticated coin farming" class of bug). The `REVOKE ALL ...
FROM anon` + `GRANT EXECUTE ... TO authenticated` at the end of delta
SQL §5 is not optional boilerplate — it must be re-run any time this or
any other previously-hardened `SECURITY DEFINER` RPC is replaced.
Verified via `has_function_privilege('anon', oid, 'EXECUTE')` before
closing this out.

Also fixed the Admin Panel's Creator Program info card, which had the
"15%" figure hardcoded in the HTML string and would never reflect a
real settings change — now reads the live value on section load.
**Files:** DB migration (delta SQL §4, §5), `js/fa-growth-admin.js`.

### 13. Coin Earn Settings — duplicate editor
Confirmed a real functional duplicate, not just similar naming (unlike
#10 above): the Settings tab's standalone "Ad Rewards Settings" card
(writing `app_settings` key=`ad_rewards`, fields `coinsPerAd` /
`dailyCoinAdLimit`) and App Settings' "Coin Earn Settings" section
(writing key=`live_config`, fields `adCoinsPerWatch` / `adDailyLimit`)
both claimed to control the ad-watch coin reward. Traced the actual
User Panel ad-watch code (`features/ads.js`) and confirmed it only ever
reads `window.CFG.adCoinsPerWatch` / `adDailyLimit` — sourced from
`live_config`. The "Ad Rewards Settings" card was **fully dead**:
changing it had its own working save button, its own success toast, and
zero effect on the live app, since nothing ever read the `ad_rewards`
key it wrote to. Removed the dead card, its save/load functions
(`saveAdRewards`, `loadAdRewards`), and the now-orphaned call sites.
**Files:** `index.html`, `admin-inline.js`.

### 14. My Titles — locked titles weren't shown
`showPlayerTitles()` only rendered titles the user had already
unlocked; with zero unlocked it just showed one generic "keep playing"
message with no indication of what titles exist or how close the user
is. Separately, `fixes-v29-all-bugs.js` had a richer, unused 14-tier
title catalog (rank tiers, kill milestones, dynamic Supabase
achievements) sitting inside a `getMyTitles()` function that nothing
ever called — it waited on `window.showMyTitles`, which was never
defined anywhere, so that whole block was dead on arrival. Merged the
richer catalog into the real `showPlayerTitles()` and changed it to
always show the full catalog: unlocked titles highlighted normally,
locked ones dimmed with a 🔒 icon and a live progress readout (e.g.
"7/10 wins") where the underlying stat is numeric — standard
gamification pattern, showing the locked goals is what drives progress.
Removed the now-fully-merged dead block from `fixes-v29-all-bugs.js`.
**Files:** `features/match-history.js`, `js/fixes-v29-all-bugs.js`.

### Files changed this session

**Admin Panel:** `index.html`, `style.css`, `js/admin-ui-v10.css`,
`js/admin-inline.js`, `js/supabase-rtdb-bridge.js`,
`js/fa-growth-admin.js`, `js/features/fa24-admin-smart-tools.js`.

**User Panel:** `features/growth.js`, `screens/profile.js`,
`features/player-card.js`, `features/premium-creator.js`,
`features/app-config.js`, `features/match-history.js`,
`js/preview-mode.js`, `js/fixes-v29-all-bugs.js`.

**Database (via Supabase MCP, project `hddhkculuyrfoevxmlwy`):**
`profile_updates` (5 new columns), `users` (new `ign` length CHECK,
NOT VALID), `admin_notes` (new unique constraint on `user_id`),
`app_settings` (seeded `creator_system` row), `validate_and_join_match`
RPC replaced (commission % now dynamic, not hardcoded) + its EXECUTE
grants re-hardened after the replace. Full DDL, in the exact order
applied live:  `2026-08-21-SESSION-DELTA.sql`.

---

## Session: 2026-08-22 — 26-bug live-fix batch (Admin + User Panel + DB)

Delivered: `UserPanel-FIXED-v18.zip`, `AdminPanel-FIXED-v22.zip`.
26 bugs reported in one batch this session; all 26 fixed and verified
(DB queries, `node -c` syntax check on every touched file, or both).

### 1. Match delete → no refund (CRITICAL, money bug)
Same root-cause shape as prior refund bugs in this codebase:
`deleteTournament`'s refund logic wrote to fake Firebase-style paths
(`rtdb.ref('users/'+uid+'/realMoney/deposited').transaction(...)`) that
don't map to any real column — the write silently no-op'd, no error
surfaced, and every joined player's entry fee vanished when a match was
deleted. New `cancel_match_with_refunds()` RPC replaces this: refunds
each joiner's *actual* `entry_fee_paid` (not the match's current
`entry_fee`, which the admin could have edited after people joined) to
the correct currency column, atomically, with a `wallet_transactions`
log + notification per player. DB-tested inside a rolled-back
transaction before wiring into the UI. **Files:** DB migration (see
`2026-08-22-SESSION-DELTA.sql` §1), `js/security-patches.js`.

### 2. WhatsApp share not opening (11 call sites)
Root cause different from the Aug 21 session's WhatsApp fix (that one
was about the URL scheme — `whatsapp://` vs `wa.me`). This time the
scheme was already correct everywhere, but `window.open(url,'_blank')`
and `<a target="_blank">` are silently swallowed by the wrapped app's
WebView — only top-level navigation (`window.location.href`) gets
intercepted by `MainActivity` and handed off to the real WhatsApp app;
a *new window* open just goes nowhere. Fixed all 11 occurrences across
`growth.js`, `player-card.js`, `premium-creator.js`, `screens/profile.js`
(including its `navigator.share().catch()` fallback path), `features-user.js`
(2 spots), `fixes-v7.js` (2 spots, `<a>` tags), `preview-mode.js`.

### 3. Creator request submitted but invisible to admin
`loadCreatorApplications()` in the Admin Panel queried a dead
Firebase-style path (`users/{uid}/creatorProfile/code`, which the
bridge maps to `users.creator_code` — a column that only ever gets SET
on *approval*). The User Panel's actual submission
(`submitCreatorSignup()`) writes straight to the separate
`creator_applications` table — the two were never connected, so a
pending application could never appear in the admin queue no matter how
long you waited. Rewrote to query `creator_applications` directly via
Supabase, joined to `users` for the IGN. **File:** `js/fa-growth-admin.js`.

### 4. My Matches "Details" button does nothing
`showDet(id)` referenced an undefined variable `jr` (only `t` — the
match — is actually in scope in this function), throwing a silent
`ReferenceError` partway through building the modal HTML, before
`openModal()` was ever called. Also fixed a second, unrelated bug in
the same function: `onclick="copyTxt(String(t.roomId||''))"` referenced
the closure variable `t` from inside a *global-scope* onclick string —
`t` doesn't exist there, so the copy buttons threw `t is not defined`
too. **File:** `screens/matches.js`.

### 5. Room Details copy icon does nothing — see #4 (same fix, same function)

### 6. Same room notification appearing 3-4x
Found **four independent** notify-loops all firing for the same
room-release event: `saveTournament`'s inline block (with a comment
literally saying *"skip check, duplicates are harmless"*),
`_releaseRoom()` (a separate standalone "Release Now" button handler),
`sendRoomNotificationToMatch()` (called from the auto-release
scheduler), and a redundant direct-Supabase dual-write inside the v23
patch on top of what the Firebase-bridge push already persists. Any
admin flow that touched more than one of these for the same release
fired 2-4 duplicate notifications per player. Consolidated to one
single, deduped `sendRoomNotificationToMatch()` (dedupes by uid across
*both* `join_requests` and `matches/{id}/joined` — a player showing up
in both no longer gets notified twice); every other trigger now calls
it instead of duplicating the notify logic. **Files:**
`js/admin-inline.js`, `features-admin.js`, `admin-fixes-v23-FINAL.js`.

### 7. Clan created but doesn't show
`showCreateClan()` in the User Panel **re-defined**
`window._doCreateClan` every single time the Create Clan modal opened —
clobbering a correct, Supabase-native version (already fixed in
`bugfix-v30-final.js`, loaded later in the page) with a broken
Firebase-only write using field names (`memberCount`, `leader`,
`weeklyScore`) that don't exist in the real `clans` schema
(`total_members`, `leader_uid`, `weekly_score`). Live DB query confirmed
`clans` was completely empty despite a "✅ Clan banaya!" success toast.
Removed the competing re-definition; the correct implementation now
marks itself with a `._v30Supa` flag so nothing can silently re-clobber
it again in the future. **File:** `features/clan.js`.

### 8. Joined player invisible in Admin Panel "Joined Players"
Found the identical broken `isJoined` status check copy-pasted **5
times** across `admin-inline.js`:
```js
var isJoined=(j.status==='approved'||j.status==='joined'||j.status==='confirmed'||!j.status);
```
`validate_and_join_match` sets `status='pending'` by default on every
successful join (money already deducted at that point) — but `'pending'`
isn't in this whitelist and isn't falsy either, so every genuinely-
joined-and-paid player sitting in `pending` was silently excluded from
Joined Players, refund lists, and notification loops. Fixed all 5
occurrences to exclude only the genuinely-not-joined terminal statuses
(`cancelled`, `refunded`, `rejected`, `no_show`) instead of an allowlist
that didn't cover the RPC's own default state.

### 9. "Create Sponsored Tournament" button does nothing
The bridge's `SupaRef.prototype.push = function(data)` takes **only one
argument** — it's Promise-based, no callback parameter exists at all.
`createSponsoredTournament()` called
`.push(data, function(err){ ...entire success handler... })` — the
callback was simply never invoked, so `closeSponsoredModal()`,
`showToast()`, `loadSponsoredTournaments()`, and the error path were all
dead code. Switched to `.then()/.catch()`. **File:** `js/fa-sponsored-system.js`.

### 10. Leaderboard race condition — row flickers back after removal
Root cause in the `sync_leaderboard()` trigger: it only removed a row
from `leaderboard` when `is_banned=true` or `ign IS NULL` — there was
no "admin manually excluded this person" flag at all. So a direct
`DELETE FROM leaderboard` got silently undone the very next time
*anything else* about that user's row changed (coins, city, rank
points — nothing to do with leaderboard visibility), because the
trigger's `INSERT ... ON CONFLICT DO UPDATE` re-inserted them.
Confirmed live: the reported "#7 Team Wolf" row.
Fix has **two required parts** (only doing the first looked like a fix
but silently didn't work — caught and corrected live, same session):
1. New `users.leaderboard_hidden` column + `sync_leaderboard()` checks it.
2. The trigger's `UPDATE OF <columns>` clause **must also list**
   `leaderboard_hidden` — a trigger declared this way only fires when a
   *listed* column changes, so the Admin Panel's new "Hide from
   Leaderboard" toggle (which touches only that one column) would
   otherwise never fire the sync at all. Verified via
   `pg_get_triggerdef()` after the fact, then corrected live.
Added a proper "Hide from Leaderboard" / "Show on Leaderboard" toggle
button in the Admin Panel's user modal — no more manual SQL needed
going forward. **Files:** DB (`2026-08-22-SESSION-DELTA.sql` §2),
`js/admin-inline.js`, `js/supabase-rtdb-bridge.js` (new
`leaderboardHidden` → `leaderboard_hidden` field mapping).

### 11. Messy/duplicate "match starting soon" admin alert banners
Two **entire independent** alert-scheduling engines were running in
parallel: `fa-admin-v10.js` Section 2 (fixed top-center, single alert,
its own `setTimeout`-based scheduler reading `matches` every page load)
and `fa-admin-v10-final.js` (the newer, better one — top-right stacking,
3-alert cap, per-match dismissal, browser Notification API support).
The same file already had this exact duplicate-feature pattern found
and fixed twice before (Quick Create, Live Attendance — both documented
with removal comments in the same file), but this third instance
(Section 2's alerts) was missed. Removed the entire superseded engine
(`_scheduleMatchAlert`, `_showAdminAlert`, `_goToAttendance`,
`_playAlertSound`, `_initAlerts` + its polling loop) — kept
`fa-admin-v10-final.js`'s. **File:** `js/fa-admin-v10.js`.

### 12. Sky Diamond approval — "timestamp column not found" + "already resolved" errors
Two separate bugs surfacing on the same screen:
- **Root cause A:** `wallet_transactions` had **zero** registered
  field-converter in the Admin Panel's Firebase-bridge (`CONVERTERS`
  registry in `supabase-rtdb-bridge.js`) — every write through
  `rtdb.ref('users/{uid}/transactions').push({..., timestamp: Date.now()})`
  fell through to the generic snake-case converter, which sent the raw
  key `timestamp` straight to PostgREST. The real column is
  `created_at` — this failed outright, confirmed live via the exact
  error text ("Could not find the 'timestamp' column of
  'wallet_transactions'"). Wrote a proper `walletTxnToSupa` /
  `walletTxnFromSupa` converter pair (maps `type`→`txn_type`,
  `timestamp`/`createdAt`→`created_at`, normalizes shorthand currency
  values like `'sky'`→`'sky_diamonds'`) and registered it. DB-verified
  the exact resulting insert shape works.
- **Root cause B:** Approve/Reject buttons had no double-click guard.
  `resolve_sd_request()` correctly row-locks (`FOR UPDATE`) and rejects
  a second concurrent call with "Request already resolved" — but
  nothing stopped a fast double-tap (very easy on a touchscreen button)
  from firing both requests before the first one's response re-rendered
  the list. Added `data-req-id` + a `_guardedApprove`/`_guardedReject`
  wrapper that disables the exact button immediately on first click
  (re-enabling only on a genuine RPC failure, so a real error doesn't
  leave dead buttons behind).
(The reported "UID not showing" turned out to be a false alarm — the
User + FF UID columns were already present in this table; the
screenshot just had them scrolled off-screen on a narrow phone, fixed
as a side-effect of #23 below.)
**Files:** `js/supabase-rtdb-bridge.js`, `js/admin-inline.js`,
`js/admin-supabase-sync.js`.

### 13. Premium "Seedha khareedna hai → Plans dekho" always re-shows Free Trial
`_showTrialPrompt()` used to do
`window._origShowPremium = window.showPremiumUpgrade;` **inside** the
wrapper function — at the exact point where `window.showPremiumUpgrade`
had *already* been overwritten by that same wrapper two lines earlier.
So `_origShowPremium` was really just a self-reference: clicking "Plans
dekho" called the wrapper again, which re-ran the same "trial not used
yet → show trial prompt" check and looped back to the same modal
forever, never reaching the real plans list. Fixed by capturing the
true original function (`_orig`, already correctly captured in the
outer closure *before* the overwrite) exactly once, in
`injectTrialButton()` itself, and removing the stale re-capture from
inside the trial-prompt modal. **File:** `features/free-trial.js`.

### 14. Support chat UI — WhatsApp-style rebuild
Every user's **entire** message thread rendered stacked inline on one
screen, all at once — unreadable once more than a couple of tickets
existed (confirmed via screenshot). Rebuilt as a proper 2-screen flow
inside the same `#supportTicketsList` container: a list screen (one row
per user, avatar-style initial, last-message preview, open/closed
badge) → tapping a row opens *only* that thread with a real back
button. Reply and close/reopen now reload data but stay inside the same
open thread (by re-finding it via `uid` after refresh) instead of
dumping the admin back to the list on every action. **File:**
`js/admin-inline.js`.

### 15. Season Pass claim — "could not choose the best candidate function" error
Two duplicate `claim_battle_pass_tier` overloads existed live — one
with `p_gd_reward INTEGER`, one with `p_gd_reward NUMERIC` — so
Postgres couldn't disambiguate which to call on *every single* claim
attempt, confirmed via the exact error screenshot. Dropped the weaker
overload (it also lacked the 0-200 bounds-check the numeric one has).
**DB:** see `2026-08-22-SESSION-DELTA.sql` §3.

### 16. Admin credited 35 GD, User Panel shows 0
Live DB query confirmed the credit itself was 100% correct
(`green_diamonds: 35` on the actual row) — so this was purely a
client-side display corruption, not a missing/failed credit. Root
cause: a "Bug #22 currency normalization" patch in
`fixes-v29-all-bugs.js` ran on every boot and unconditionally
recomputed `green_diamonds` from the old Firebase-era `realMoney` shape
whenever the *snake_case* `UD.green_diamonds` field was falsy — but
`core/listeners.js`'s `_applyUser()` only ever sets the *camelCase*
`UD.greenDiamonds`, meaning the snake_case guard was **always** true,
meaning this patch **always** overwrote the correct freshly-fetched
value with `realMoney.winnings + realMoney.deposited` — which are
themselves just aliases of `UD.greenDiamonds`/`UD.skyDiamonds` set one
line earlier — mixing sky and green diamonds together on every single
boot. Rewrote the patch to *only* ever mirror the correct camelCase
value into the snake_case alias (never recompute from `realMoney`),
since several other files (`squad-bank.js`, `diamond-system.js`,
`room.js`, `rank.js`, `skill-matchmaking.js`) genuinely need that
snake_case alias to exist. **File:** `js/fixes-v29-all-bugs.js`.

### 17. Season Pass "FREE" column unlocked without buying the pass
Confirmed the RPC already correctly gated the PREMIUM track behind
`has_premium` — but the FREE track had **zero** gating anywhere, client
or server; a player could claim Tier 1's 5 GD without ever purchasing
the Season Pass. Per explicit product decision this session, ALL tier
rewards (including the free-track column) should only unlock once the
pass itself is bought. Fixed both the client UI (`battle-pass.js`
render logic) and the RPC itself (server-side enforcement — the client
check alone is trivially bypassable by calling the RPC directly).
**Files:** `features/battle-pass.js`, DB (see §15/§3 above — same RPC).

### 18-20. Duplicates of #14, #3, #7 respectively (reported twice in the
same batch under different numbers — same root cause, same fix, not
re-documented separately here).

### 21. Growth Analytics UI overflowing screen width
Fixed 2-column CSS grid (`grid-template-columns:1fr 1fr`) with no
responsive breakpoint and no overflow containment — badge grids and
leaderboard rows forced the whole section wider than the viewport on a
narrow phone instead of wrapping or scrolling internally (confirmed via
the horizontal-scroll-arrow indicator strip visible at the bottom of
the section in the screenshot). Added a `@media (max-width:640px)`
breakpoint that stacks to 1 column, plus `min-width:0` on each grid
child (required for a flex/grid child to actually shrink instead of
enforcing its content's natural width on the track) and
`overflow-x:auto` on each card's body. **File:** `js/fa-growth-admin.js`.

### 22 / 26. Result-share-for-coins feature — fully removed
Per explicit instruction, removed end-to-end rather than just hiding
the button: `giveShareCoins()` function deleted entirely (was writing
`users/{uid}/shareRewards/{date}` + crediting coins via
`increment_balance` once per day), the "+20 Coins" reward banner in the
share modal removed, the "Result Share Karo (+20🪙)" button in My
Matches removed, the now-permanently-unclaimable "Share/Week" weekly
mission card removed (its only progress source, `wShare_{weekNum}`, no
longer gets set by anything), and the corresponding "Share Result
Coins" / "Share/Week" config fields removed from Admin Panel → App
Settings (they no longer control anything). **Sharing itself still
works** — the WhatsApp/generic share buttons remain, just with no coin
reward attached. **Files:** `features/growth.js`, `screens/matches.js`,
`js/fa-app-settings.js`.

### 23. Season Pass admin table can't scroll horizontally
Missing the `.table-wrapper` div (`overflow-x:auto` +
`-webkit-overflow-scrolling:touch`, defined in `admin-base.css`) that
every *other* admin data table already uses — this one rendered a raw
`<table>` with no way to reach columns past the viewport edge on a
narrow phone. Wrapped it. **File:** `js/admin-inline.js`
(`loadSeasonPassSection`).

### 24. Transaction History — coins jumped far more than any single row should account for
Root cause: a genuine double-credit in `checkPremiumMonthlyBonus()`.
The code called **both**
`db().ref('users/uid/coins').transaction(v => (v||0)+bonus)` **and** a
direct `increment_balance` RPC call for the exact same monthly bonus.
This looked like a leftover-Firebase-path bug (the usual pattern this
session), but it wasn't — `core/db-bridge.js`'s `.transaction()` is
*fully* wired to Supabase (`_supaTransaction` reads the current
balance, computes the delta, writes it via `increment_balance`
internally) — so both calls independently succeeded, crediting the
bonus **twice** (Tier 3: 400 + 400 = 800 actually credited, even though
each individual `wallet_transactions` row correctly said "400"),
matching the reported symptom exactly ("pehle kuch sau the, phir
ekdam se bahut sara badh gaya"). Removed the redundant `.transaction()`
call — only the direct RPC path remains. Checked every other
`.transaction()` call site in the User Panel for the same shape (11+
files); this was the only one with a duplicate RPC alongside it.
**File:** `features/premium-creator.js`.

### 25. Premium Club modal — vertical scroll refreshes page instead of scrolling
The modal's own scroll CSS was already structurally correct
(`overflow-y:auto` + `flex:1` on `.modal-body`, non-conflicting with
the separate `style.css` overrides that only touch `padding`/`max-height`).
Page-level pull-to-refresh was also already blocked
(`overscroll-behavior:none` on `body`/`html`/`#mainContent`). Added
`overscroll-behavior:contain` at all three modal layers
(`.modal-overlay`, `.modal-box`, `.modal-body`) as a defensive
reinforcement against scroll-chaining in WebViews where a touch-drag
starting inside a `position:fixed` modal can still bubble past it in
some engines. **File:** `styles.css`.

### 26. See #22 (fully removed, documented above — not a separate fix)

### Files changed this session

**Admin Panel:** `js/security-patches.js`, `js/admin-inline.js`,
`js/features-admin.js`, `js/admin-fixes-v23-FINAL.js`,
`js/fa-admin-v10.js`, `js/admin-supabase-sync.js`,
`js/supabase-rtdb-bridge.js`, `js/fa-growth-admin.js`,
`js/fa-sponsored-system.js`, `js/fa-app-settings.js`.

**User Panel:** `features/growth.js`, `features/player-card.js`,
`features/premium-creator.js`, `features/clan.js`,
`features/free-trial.js`, `features/battle-pass.js`,
`screens/matches.js`, `screens/profile.js`, `js/features-user.js`,
`js/fixes-v7.js`, `js/preview-mode.js`, `js/fixes-v29-all-bugs.js`,
`styles.css`.

**Database (via Supabase MCP, project `hddhkculuyrfoevxmlwy`):** 1 new
RPC (`cancel_match_with_refunds`), 1 new column
(`users.leaderboard_hidden`), `sync_leaderboard()` function + trigger
definition both replaced (two-part fix — see §10 above for why both
parts were required), `claim_battle_pass_tier` RPC replaced + 1
duplicate overload dropped. Full DDL, in the exact order applied live,
including the mid-session trigger correction:
`2026-08-22-SESSION-DELTA.sql`.

Every touched JS file passed `node -c` syntax validation (zero errors,
both panels) before packaging. `COMPLETE_SCHEMA.sql` updated in-place
to reflect the final, corrected state of every changed table/function —
not just appended as a delta — so it remains the single source of
truth for a from-scratch rebuild.

## Session: 2026-08-23 — 18-bug live-fix batch (Admin + User Panel + DB)

18 bugs reported and fixed this session, spanning both panels and the
live database. Highlights of root causes found (full detail in each
file's inline comments):

- **Profile verification FK crash (new users):** a prior self-heal call
  existed but its return value was never checked — a genuine failure
  still fell through to the FK-violating insert. Now verifies and
  retries before proceeding, with an honest error instead of a raw DB
  message.
- **Green Diamond header/wallet mismatch:** `bugfixes.js`'s
  network-reconnect handler did `window.UD = u` (raw snake_case row)
  instead of merging through `_applyUser()` — wiped camelCase fields
  the UI actually reads, on every reconnect.
- **Monthly Premium Bonus re-crediting every refresh:** the "already
  claimed" check used a fake Firebase-bridge path with no matching
  case in `db-bridge.js` — silently no-op'd on both read and write.
  Replaced with `claim_premium_monthly_bonus` RPC + a real
  `UNIQUE(user_id, month_key)`-backed table.
- **Winning box showing Green Diamonds as ₹:** `UD.realMoney.winnings`
  was a plain alias for Green Diamonds, never real currency. Wallet
  stats card now reads `UD.sponsored_winnings` instead.
- **Bogus "Entry Fee" transaction after Sky Diamond approval:**
  `admin-inline.js`'s `approveSkyDiaReq` was writing a SECOND,
  redundant `wallet_transactions` row on top of the RPC's own correct
  insert — and that duplicate's non-standard `txn_type` string fell
  outside the User Panel's credit allow-list, got flipped to a
  negative debit, and displayed as a fake Entry Fee. Removed the
  duplicate write; hardened the classifier to catch
  `_credit/_bonus/_paid/_refund/_approved/_win`-suffixed types too.
- **Clan invisible / "chhodo current clan" lockout:** a since-patched
  legacy path had written a synthetic non-UUID key to a user's
  `clan_id`, pointing at a clan that never existed in `clans` (table
  confirmed empty). Cleaned the live data; added self-heal so any
  future orphaned pointer clears itself instead of permanently
  locking someone out.
- **Cosmetics Store "unlock ho gaya" but nothing unlocks:** two bugs —
  (1) the old flow showed success without checking if the writes
  worked, replaced with atomic `purchase_cosmetic` RPC; (2) even
  successful purchases were stored as an array by `_loadExtras()` but
  read as an object keyed by `cosmetic_key` everywhere else — always
  looked "not owned" regardless of what was actually purchased.
- **Leaderboard never shows your own rank:** only ever rendered
  `players.slice(0,20)` with zero fallback below that. Added a pinned
  "You" row + an exact-rank lookup (`gt('rank_points', myRp)` count)
  when outside the fetched top-50 window entirely.
- **WhatsApp not opening:** the native Android WebView's ad SDK was
  intercepting outbound `wa.me` clicks and rewriting them into a
  broken `whatsapp://...&type=custom_url&app_absent=0` intent nothing
  on-device resolves. Added a shared `openWhatsApp()`/`_waShareUrl()`
  helper (`core/utils.js`) using Android's `intent://` scheme with an
  explicit `browser_fallback_url`, and routed all ~11 WhatsApp share
  call-sites across the User Panel through it.
- **Creator code "already liya hua" on a fresh code:**
  `creator_applications` has `UNIQUE(user_id)`, not
  `unique(creator_code)` — the error message assumed the wrong
  constraint. `showCreatorSignup()` now checks for an existing
  application first and shows its real status instead of a
  never-submittable blank form.
- **Profile photo/banner not saving:** `users.banner_url` didn't exist
  as a column at all (added via migration); both uploads fired
  "updated!" without checking if the DB write actually succeeded, and
  wrote to field names (`avatar_url`/`UD.avatar_url`) that don't match
  what any screen reads (`UD.profileImage`/`UD.bannerImage`). Also
  found `DB.users.update()` returned `null` on BOTH success (no
  `.select()` chained → PostgREST returns no representation) and
  failure — made it return an explicit `{ok:true/false}` so callers
  can actually tell the difference.
- **Add Duo Partner "not found" for real users:** the code immediately
  after a successful lookup referenced an undefined variable (`s`, a
  leftover Firebase snapshot reference) — threw silently, so a real
  match looked identical to "not found." Separately, the actual save
  (`duoTeam`/`squadTeam`/`partnerUid`/`squadUids`) was writing to
  camelCase columns when the real ones are snake_case
  (`duo_team`/`squad_team`/`partner_uid`) — every write failed
  outright even after the lookup was fixed. `squad_uids` didn't exist
  under any name; added it.
- **Sponsor "Create Tournament" doing nothing:** `sponsored_tournaments`
  had no dedicated bridge converter — fell through to generic
  top-level snake-casing, which never turns `name` into `title` (the
  real, NOT NULL column). Every insert failed outright. Added
  `sponsoredTournamentToSupa`/`FromSupa` + the missing
  `prizes`/`match_id`/`description`/`prize_distributed` columns.
- **Bulk Message button doing nothing:** `fa04-bulk-notification.js`
  silently overwrote `window.showBulkMessage` (the working version in
  `features-admin.js`) with a version whose local `showAdminModal()`
  targeted `#adminModal`/`#adminModalTitle`/`#adminModalBody` —
  elements that don't exist anywhere in the HTML. Its guard was always
  false, so it did nothing, no error. Routed through the real global
  modal system instead.
- **"Suggestions" vs "User Feedback" apparent duplication:** genuinely
  two different features (one dead Firebase-only path always showing
  "0", one live Supabase-backed one) — removed the dead one from Quick
  Tools rather than trying to explain the distinction in the UI.
- **Fraud Check `permission_denied` at `/deviceJoins`:**
  `runFraudCheck()` does a bulk read of the whole node, but the
  Firebase rule only declared `.read` on the `$deviceId` wildcard
  child — a parent-level bulk read isn't reliably granted by a
  children-only rule. Added an explicit `.read` at the `deviceJoins`
  root. **Requires manual republish in Firebase Console — saving the
  file does not deploy it.**
- **Daily Bonus Editor "duplicate" in Quick Tools:** not a real
  duplicate — a floating action button (FAB) fallback rendered
  globally on top of every section (including Quick Tools) any time
  the real Settings-panel injection hadn't completed yet in that
  session. Removed the FAB; the one real copy stays in Settings.
- **Polls — Admin Panel slow, User Panel missing entirely:**
  `showPollManager()` gave zero visual feedback until its query
  resolved (felt broken even on a fast connection) — now opens with a
  spinner immediately. Built the entire User Panel voting feature from
  scratch (`features/polls.js`): home-screen active-poll banner,
  full poll list, vote/results view. Discovered `poll_votes` already
  existed with the right schema but the vote RPC never used it (zero
  duplicate-vote protection); rewrote `cast_poll_vote` to use it
  atomically via the existing `UNIQUE(poll_id, user_id)` constraint.

### Files changed this session

**Admin Panel:** `js/admin-inline.js`, `js/supabase-rtdb-bridge.js`,
`js/features/fa04-bulk-notification.js`, `js/features/fa26-poll-suggestion.js`,
`js/admin-fixes-v7.js`, `index.html`, `firebase-rules.json`
(requires manual Firebase Console republish).

**User Panel:** `screens/profile.js`, `core/listeners.js`,
`core/bugfixes.js`, `core/db.js`, `core/db-bridge.js`, `core/imgbb.js`,
`core/utils.js`, `features/premium-creator.js`, `features/growth.js`,
`features/player-card.js`, `features/app-config.js`,
`features/polls.js` (**new file**), `js/fixes-v7.js`,
`js/features-user.js`, `js/preview-mode.js`, `js/bugfix-v30-final.js`,
`index.html`.

**Database (via Supabase MCP, project `hddhkculuyrfoevxmlwy`):** 3 new
tables considerations (`premium_monthly_bonus_claims` new;
`user_cosmetics`, `poll_votes` already existed), 3 new RPCs
(`claim_premium_monthly_bonus`, `purchase_cosmetic`, `cast_poll_vote`
replacing `increment_poll_vote`), 1 new helper RPC
(`get_my_poll_vote`), new columns: `users.banner_url`,
`users.squad_uids`, `sponsored_tournaments.prizes`/`match_id`/
`description`/`prize_distributed`. 1 dead transaction row deleted, 1
orphaned `clan_id` pointer cleared. Full DDL in the order applied
live: `2026-08-23-SESSION-DELTA.sql`.

Every touched JS file passed `node -c` syntax validation (zero errors,
both panels) before packaging. `firebase-rules.json` and both
`index.html` files validated for structural correctness.

**⚠️ Action needed from Junaid, outside this zip:** the
`firebase-rules.json` fix for the Fraud Check bug must be manually
pasted into Firebase Console → Realtime Database → Rules → Publish.
Nothing in these zips can do that step automatically.

---

## 2026-08-25 Session — 7 live-reported bugs, User Panel only, zero DB changes

All 7 bugs (Google-name-as-IGN, verification/update modal wording,
WhatsApp `intent://` crash, Green Diamond header desync, Cosmetics
Store rollback-on-refresh, Creator "Match Banao" generic error,
Sponsored Tournaments + Invite & Earn blinking) traced back to
client-side JS only. Two of them (Cosmetics Store, Creator Match) were
first suspected as server bugs and individually verified live via
Supabase MCP — RPC logic, grants, and RLS were all confirmed already
correct in both cases before the real (client-side) root cause was
found. Full root-cause writeup for each: see
`2026-08-25-SESSION-DELTA.sql`.

Files touched: `core/boot.js`, `js/ui-fixes.js`, `screens/profile.js`,
`js/fixes-v7.js`, `js/bugfixes-v29-final.js`, `features/squad-bank.js`,
`js/diamond-system.js`, `features/growth.js`, `screens/home.js`,
`core/listeners.js`, `features/creator-match-host.js` — all passed
`node -c` syntax validation before packaging.

**Worth flagging for a future session:** while investigating the
Creator Match bug, found that `.rpc()` call sites across the User
Panel generally only check `r.data`, not `r.error` — Supabase JS v2
resolves (doesn't reject) on a genuine PostgREST error, so any site
with this pattern can silently swallow real server errors behind a
generic message, exactly like this session's bug #6. Only that one
call site was fixed this session (it's what was reported); a focused
sweep of the other ~25 `.rpc()` call sites across the codebase would
likely surface similar hidden failure points.

---

## 2026-08-25 Session (second pass, same day) — 3 bugs + 1 architecture question

Found after Junaid tested the first delivery. Full root-cause writeup
for each: see `2026-08-25b-SESSION-DELTA.sql`.

1. **Green Diamond header still 0** — `js/diamond-system.js` fully
   overrides `window.updateHdr()` for Sky Diamond/coins and never
   touched the Green Diamond chip at all, so the earlier
   `core/header.js` fix never actually ran. Fixed inside the override
   itself.
2. **"permission denied for function creator_create_match"** — not a
   code bug. Grant + RLS were confirmed correct live (simulated the
   real `authenticated` role directly). Cause: PostgREST's schema
   cache hadn't picked up the previous day's signature change.
   Re-issued the grant and sent `NOTIFY pgrst, 'reload schema'`
   directly against the live DB.
3. **Sponsored tournaments active but unjoinable** — admin's Match ID
   field was mislabeled "(optional)" with no enforcement, and the User
   Panel sponsored card never had a real Join button. Fixed both:
   admin now requires and verifies a real match id before allowing
   creation; User Panel now shows a working "⚡ Join Now" button (or a
   clear warning for any older entry still missing a match id).

**WhatsApp architecture (no code change — confirmed already correct):**
Junaid asked why the app uses `wa.me` links instead of opening the
WhatsApp package directly. `android/app/src/main/java/.../
MainActivity.java`'s `shouldOverrideUrlLoading` already hands any
`http(s)` URL — including `wa.me` — to `Intent.ACTION_VIEW`, which is
the correct native approach: Android itself resolves it to whichever
WhatsApp variant (regular or Business) is installed, with a graceful
browser fallback if neither is installed. This is more robust than
hardcoding `package="com.whatsapp"`, which would only match the
regular app. The `whatsapp://send/?...` error in Junaid's latest
screenshot doesn't come from anywhere in this codebase (searched
thoroughly) — most likely explanation is WhatsApp not being installed
on that specific test device. Flagged for Junaid to confirm; will dig
further only if it still fails with WhatsApp actually installed.

---

## 2026-08-26 Session — match-time bug, creator match hardening, full sponsor system rebuild

Full root-cause writeup for each: see `2026-08-26-SESSION-DELTA.sql`.

1. **Match time silently shifted (08:39 → 06:39) after edit save** —
   traced the entire save→status→reload round trip in
   `js/admin-inline.js`'s `saveTournament()`; every step verified
   internally timezone-safe by code inspection, but no live-device
   root cause could be confirmed (Firebase RTDB, which this flow
   writes to, isn't queryable through this session's tools). Hardened
   the fragile link anyway: replaced `new Date(string)` parsing with
   explicit numeric `Date` construction, removing any string-parsing
   ambiguity regardless of what the real device-side cause turns out
   to be. Applied identically in the new sponsor-match creation flow.
2. **Creator match "permission denied" persisted** — re-confirmed via
   Supabase's own live security advisor that the grant is genuinely
   correct at the exact layer PostgREST uses. Hardened the client:
   `submitCreatorMatch()` now forces a fresh Firebase→Supabase token
   re-sync immediately before the RPC call, closing any timing gap
   where a stale Bearer token could cause this exact error even with a
   correct grant.
3. **Full sponsor-match system rebuild** (explicit request — "poora
   system hona chahiye jaise normal match bante hain") — new RPC
   `admin_create_sponsored_match` creates a real, fully joinable
   `matches` row (`is_sponsored=true`) and its sponsor-branding row
   together, atomically. Admin Panel's create form now has real
   match-hosting fields (Mode, Slots, Map, Time) instead of a
   match-ID-linking field — creating a sponsored tournament is now a
   single self-contained action, same shape as creating a normal or
   creator match. No manual linking step exists anymore.

---

## 2026-08-26 Session (second + third pass, same day) — sponsor RPC bug, creator match regression, WhatsApp root cause finally found

Full writeup: see `2026-08-26b-SESSION-DELTA.sql`.

1. **Sponsor create error** ("cannot insert a non-DEFAULT value into
   column \"name\"") — the new `admin_create_sponsored_match` RPC
   (added earlier the same day) hit the exact same `matches.name` is
   `GENERATED ALWAYS AS (title)` bug `creator_create_match` already
   fixed on 2026-08-24 — `name` was explicitly listed in its INSERT.
   Removed it; verified live with the real admin account, works.
2. **Creator match "click karo, kuch hota hi nahi"** — this was a
   regression from the very hardening added earlier the same day:
   forcing `await syncFirebaseToken()` before every submit doesn't
   just refresh a token — it tears down and rebuilds the entire
   Supabase client and every realtime channel, with no timeout, so a
   slow network response left the button hanging indefinitely with no
   feedback. Reverted to the simple, non-async version.
3. **WhatsApp — actual root cause found** after 3+ sessions of "still
   doesn't open, APK only": it was never the link-building code after
   the first real JS fix — it's `sw.js`'s service worker. App files
   are served stale-while-revalidate (old cached copy served
   *instantly* every load, refreshed only in the background for next
   time), and `CACHE_VER` was never bumped across any prior session's
   fix, so the wrapped APK's WebView kept serving its original,
   long-stale cached copy of the broken WhatsApp code forever — Chrome
   wasn't affected the same way because it doesn't persist this
   service worker's cache as durably. Bumped `CACHE_VER` to force a
   full cache purge + refetch. **Any future release touching a file
   listed in `sw.js`'s `LOCAL_FILES` must bump `CACHE_VER` too, or this
   exact "fix doesn't seem to apply in the APK" pattern will recur for
   that file** — this is a general hazard, not specific to WhatsApp.

## Session: 2026-09-20 — SECURITY LOCKDOWN (wallet/match_results guards), publish RLS fix, support-chat fixes, schema reconciliation

**Panels:** Admin `v26.13` (admin-inline/live-dash `?v=20260920a`) • User `v32.17` (admin-badge `?v=20260920a`)

### DB changes (live-applied + COMPLETE_SCHEMA SECTION 23 me merged — idempotent)
1. **`fft_guard_wallet_insert()` + `trg_fft_wallet_insert_guard`** — wallet_transactions INSERT sirf system/admin. User ke legit 4 types allow: `pending_withdraw`, `pending_deposit`, `debit(match_entry)`, `debit(squad_bank_contribution)`. Fake `match_win`/`credit` user se ab 400.
2. **`fft_guard_match_results_write()` + `trg_fft_match_results_guard`** — match_results INSERT/UPDATE/DELETE sirf system/admin.
3. **`mr_insert_admin` policy** — match_results INSERT me admin bypass (pehle `mr_insert_own` sirf own-row deti thi — **yahi publish-flow ka Supabase-half chupchap tod raha tha**). Unique constraint `match_results_match_id_user_id_key` pehle se thi.
4. **2026-08-23 delta merge** — `premium_monthly_bonus_claims` table + `claim_premium_monthly_bonus` + `cast_poll_vote` + `get_my_poll_vote` + pmbc policies COMPLETE_SCHEMA me add (live DB me the, file me missing the).
5. Cleanup: 3 audit-fake rows deleted (2 wallet + 1 match_results).
6. NOTE: `guard_users_self_update` (pehle se) ki wajah se SQL Editor/Mgmt API se users-row update blocked hota hai — `SET LOCAL role='service_role';` batch use karo.

### Admin panel code changes
- **Support inbox fix (HIGH):** `loadSupportChats()` root-level RTDB reads (`support/`, `supportChats/`) rules me PERMISSION_DENIED the → inbox hamesha "No conversations". Naya `_scanSupportInboxes()`: Supabase users-list → per-uid `support/{uid}` reads (15-parallel batches) → 20s auto-refresh. Rules change ki zaroorat nahi.
- **Thread render fix (HIGH):** `openChat()` ka `renderMessages()` broken `Promise.all` (secondary path denied → poora render abort) tha + galat sort key (`timestamp` vs user-side `createdAt`). Ab single-path read + `(createdAt||timestamp)` sort + error-state UI.
- **markAsRead:** secondary path skip (denied reads).
- **Entry Type "free":** `#tEntryType` me `free` option + validation update (pehle entry_type=free matches edit-modal me khaali select → "Please select a valid Entry Type").
- **normalizeWalletType polyfill** admin-live-dash.js me (console ReferenceError fix).
- **match_results upsert error-logging** publishResults me (silent `.then(null)` ki jagah console.error — aage debug aasan).

### User panel code changes
- **Help-menu "Support Chat" button fix (HIGH):** `features/admin-badge.js` — button ab `closeModal(); navTo('chat')` karta hai. Pehle `startChat()` call hoti thi jo sirf listeners lagati hai, screen-switch nahi karti → button dead tha. (Chat screen = `#scrChat`, entry = `navTo('chat')` — router khud `startChat()` karta hai.)

### Verified flows (live tests)
- Support chat E2E: user msg → RTDB `support/{uid}/messages` → admin thread render → admin reply → user ko realtime ✓
- Security: fake wallet/result writes user se BLOCKED; legit deposit/join/log flows ALLOWED; admin flows ALLOWED ✓
- Realtime: match-edit user ko 0s, coins 4s, naya match instant (Supabase channels — untouched) ✓

### Same-day Part C — publish ka ASLI root cause + join-flow fix
1. **match_results missing columns** — bridge `resultToSupa()` `rank`, `kill_prize`, `rank_prize`, `prize_earned` bhejta tha jo table me nahi the → har result-mirror 400 → publish me har player "failed" → **zero prizes** (yahi months-purana publish bug tha!). Fix: 4 columns add (idempotent, SECTION 23 Part C).
2. **guard_users_self_update INVOKER fix** — purana SECURITY DEFINER guard SECURITY DEFINER RPCs ko bhi block kar raha tha (`validate_and_join_match` → "Column coins is not self-editable" → **JOIN FLOW poora dead**). Ab INVOKER + current_user check — RPCs (postgres context) allow, direct user tampering ab bhi blocked. **Live-verified:** joins ok:true; S1/S2/S3 blocked; bio self-edit OK; admin edit OK.
3. **PUBLISH FULL E2E PASS (pehli baar!):** fresh match → 2 joins → checked_in → admin UI publish → 2 match_results rows (placement 1/2, kills, prize 110/55) → coins +110/+55 (increment_balance) → wallet `match_win` rows → join_requests completed+prize_earned → match completed+published. Phir poora revert.
4. Firebase RTDB admin-token se direct REST writes denied (matches/status) — panel ke apne flows hi RTDB likhte hain; test-match status reset ke liye fresh match banao, published_at clear karna kaafi nahi (Firebase fallback check bhi hai).

## Session: 2026-09-20b — ROUND-3 FIX BATCH (R3-1..R3-10 economy/security fixes + room-leak RPC + anon-role discovery)

Round-3 max-depth testing ke saare found-bugs fix kiye gaye. Sab live DB par run + verify
(FIX_VERIFY1/1b batteries). Delta SQL: `2026-09-20b-R3-FIX-DELTA.sql`; schema merge:
COMPLETE_SCHEMA SECTION 23 Part D.

### ★★ ANON-ROLE DISCOVERY (sabse important — future kaam me hamesha yaad rakho)
Firebase JWT me `role` claim **nahi** hota. Third-party auth me PostgREST aise tokens ko
**anon** role se chalata hai (`auth.jwt().sub` user-id deta hai, par `auth.uid()`/role
authenticated nahi hota). Iska matlab:
- Sirf `authenticated` ko granted RPC panel me **401 permission denied** deta hai — yehi
  5 "dead features" (streak/watch-earn/voucher/own-match-played + naye RPCs) ka root cause tha.
- RLS me sirf `TO authenticated` policies panel traffic par apply **nahi** hoti — anon
  policies lagti hain. New tables/policies likhte waqt dhyan do.
- Rule: **har user-facing RPC anon+authenticated dono ko grant karo** aur function ke andar
  `auth.jwt()->'sub' IS NULL` guard rakho (real anonymous blocked).

### Fixed RPCs (one-line)
1. `claim_mission_reward` — reward ab server-side (mission_config); p_coins ignore; stale-
   period/unknown-mission/double-claim guards; numeric overload DROPPED (PGRST203 mukti).
2. `track_mission_progress` — unknown keys kabhi complete nahi (claim-chain band).
3. `claim_streak_milestone` — server-cap LEAST(p_coins, streak_config[day]), days whitelist
   {3,7,14,30,60,100}, FOR UPDATE, wtxn; revived via grants.
4. `claim_battle_pass_tier` — GD ab battle_passes.tiers->rewardGd se (p_gd_reward ignored);
   free-track par premium-check hata (design-fault); prem-track season-pass gated.
5. `award_battle_pass_xp` — 2000 XP/day cap (battle_pass_progress.xp_today/xp_day cols added).
6. `purchase_cosmetic` — price catalog (app_settings.cosmetic_prices) se; p_price ignored;
   already-owned idempotent; balance check FOR UPDATE.
7. `finalize_creator_commission` — naya p_internal flag: sirf internal publish-call ya admin;
   **revenue-loss fix**: jr-status filter IN('joined','approved')→NOT IN('no_show','refunded',
   'cancelled','rejected') — creator-match jrs 'pending' me hi rehte hain, commission
   HAMESHA 0 ban raha tha (E2E me 15-fee match par 3.75 GD ab sahi credit hua).
8. `creator_publish_result` — 42702 "r is ambiguous" crash FIXED (var `r` vs alias; ab `res`);
   EXCEPTION-handler (fail par match 'live' atka nahi); finalize internal(p_internal=true).
9. `get_room_credentials` — NAYA RPC (R3-2 room-leak ka server-half): joined + release-window
   (admin release YA scheduled_at−release_minutes) verify karke hi room_id/password deta hai;
   joined→checked_in auto-update.
10. Overload drops: `contribute_to_squad_bank(int)`, `increment_city_score(5-arg)`;
    `increment_poll_vote` REVOKE (bina-vote count inflation).
11. Grants revived (401→200): claim_watch_earn_reward, redeem_voucher, increment_own_match_played,
    claim_streak_milestone — sab real-E2E verified (voucher +25 coins + dup-block).

### New config rows (app_settings)
- `mission_config` {daily_match:10, daily_kills3:5, week_5matches:50, week_top3:30, week_share:20}
  — panel CFG defaults ke exact match (week_share growth.js me removed hai, entry harmless).
- `streak_config` {3:20, 7:100, 14:200, 30:500, 60:1000, 100:2000}
- `cosmetic_prices` — 8 catalog items (frame_neon…vip_slot) panel defaults se.
- NOTE: `live_config` row aaj bhi NAHI hai — panel CFG defaults chala raha hai; admin Settings
  se live_config banaye to overrides apply honge (core/db.js config.load).

### User-panel code fix (commits 6c97022 → 8f77908 → de2a2eb)
ROOM-LEAK (R3-2) client-half — **4 surfaces** par creds-band:
- `core/listeners.js _toMT`: room_id/room_password strip (REST + realtime dono paths);
  room-notify ab room_status='released' par trigger.
- `screens/room.js`: showRP entry-guard sirf `!t` (creds RPC se); `_fetchRoomAndShow` +
  global `_showRoomViaRpc(mid, btn)` helper (not_released/not_joined/room_not_set toasts).
- `screens/matches.js`: room-box readiness roomStatus se; creds hone par inline box, warna
  '🔑 Room Details dekho' fetch-button; countdown creds-independent.
- `screens/notifications.js` + `js/fixes-v29-all-bugs.js` showRP wrapper: released+no-creds →
  pehle `get_room_credentials` fetch, phir render.
- sw CACHE_VER me-v42-9-20b; index.html ?v bumps (room/matches/notifications/fixes-v29).

### ⚠ Room-leak Phase-2 PENDING (server-side)
Client-strip + RPC-gating se PANEL safe hai, par `matches` ke room columns raw REST/realtime
WS par ab bhi anon ko dikh sakte hain (column-level privileges realtime par apply nahi hote).
Phase-2 plan: room cols alag `match_rooms` table me (RLS: joined+released policy) ya matches
view-swap — dono panels ke saare matches-selects audit karke hi karna (select('*') break hota
hai column-grants se).

### Design decisions (bugs NAHI, as-is rakha)
- `rate_creator_match` re-rate = upsert design (avg recompute, count sahi) — bug nahi.
- `claim_match_commission_payout` sirf coins-type claim karta hai; GD commissions publish par
  instant credit (design).
- `increment_poll_vote` panel-unused tha; revoke safe (grep-verified).


## Session: 2026-09-20c — ROOM-LEAK PHASE-2 (server-side permanent fix)

Phase-1 (RPC + client-strip) ke baad ab raw-API surface bhi band. Delta: `2026-09-20c-ROOM-PHASE2-DELTA.sql`,
schema SECTION 23 **Part E**.

### New table: `match_rooms`
`match_id PK/FK→matches ON DELETE CASCADE, room_id, room_password, updated_at`. RLS ON, sirf
admin-select policy (users.is_admin via auth.jwt sub), panel roles ko SELECT-only grant —
INSERT/UPDATE/DELETE denied (sirf SECURITY DEFINER functions likhte hain).

### Redirect trigger (kisi writer me change nahi lagana pada)
`trg_redirect_match_room_secrets` BEFORE INSERT/UPDATE OF room_id,room_password ON matches:
non-null room_id → match_rooms upsert + NEW.room_id/room_password NULL; NULL/'' → match_rooms
delete. Isliye admin-inline-edit, admin-supabase-sync, RTDB-bridge, legacy releaseRoom — sab
bina badle hi safe ho gaye. ⚠ Future me naya room-writer likhna ho to seedha match_rooms na
likho — matches par likho (trigger sambhal lega) ya SECURITY DEFINER RPC banao.

### RPC changes
- `creator_set_room` v2: match_rooms me likhta hai + matches.room_status='saved' (host-screen
  check ab room_status-based — user repo commit 5e5152f: creator-match-host select swap).
- `get_room_credentials` v3: creds match_rooms se; **owner (creator_uid) / admin ko window se
  pehle bhi creds**; players ko wahi joined+release-window rules.

### Migration notes (live run order)
backfill → matches NULL → defaults NULL → trigger install (trigger PEHLE install hota to
null-out step match_rooms rows delete kar deta — order critical).

### Verified
set_room redirect / owner-bypass / not_released / trigger-redirect / clear-flow / release-loop /
global creds-free (0 rows) / UI popup / E2E_POSTDEPLOY 8/8 / PUBLISH_GOLD FULL PASS /
RTDB matches public-read already denied.


## Session: 2026-09-20d — battle_passes seed + ad-reward revive + BP track-aware claims

Delta: `2026-09-20d-SEEDS-ADREV-DELTA.sql`; schema SECTION 23 **Part F**.

- **battle_passes ab seeded**: season_key `2026_09` (panel `getSeasonId()` = `YYYY_MM` format),
  50 tiers, GD values panel `TIERS_DATA` se exact extract karke (badge/theme/emoji tiers par
  GD 0). ⚠ Har naye month me admin ko naya season row banana hoga (season_key par UNIQUE
  constraint nahi hai — upsert-idempotency ke liye pehle SELECT-check karo).
- **claim_battle_pass_tier v3**: `freeGd`/`premGd` track-aware (panel free/prem rewards alag).
  `p_gd_reward` ab bhi IGNORE (server-authoritative).
- **live_config row ab exist karti hai** (pehle missing thi → panel CFG defaults chalate the):
  sirf `{"adCoinsPerWatch":10,"adDailyLimit":5}` — deep-merge selective hai, baki CFG defaults
  untouched. Admin isme aur keys daal sakta hai (Settings) — wo abhi se apply honge.
- **claim_ad_reward revived** (grant-only; def pehle se hardened: 15s rate-limit,
  ad_reward_log, wtxn, live_config amount/limit). Coin-Shop watch-ad + Bonus Ads dono live.
  ⚠ ads.js local `UD.coins += coinReward` optimistic display — server value hi source of
  truth (refresh par sync) — ab dono 10 par match.


## Session: 2026-09-20e — TRIGGER-V3 (Phase-2 trigger ke 2 bugs pakde aur fix)

Edge-testing me Phase-2 trigger (Part E v2) ke do apne hi bugs mile:
1. **NULL-assign chhuta** — v2 ne creds match_rooms me bheje par matches
   columns NULL nahi kiye → leak wapas. (Edge-test: UPDATE room_id='X' ke
   baad matches.room_id still 'X'.)
2. **ELSE-delete khatarnak** — admin bridge full-match upsert room_id:null
   bhejta hai (RTDB copy me room nahi hota); v2 usse creator ke room creds
   WIPE kar deta.

**v3 final**: non-null → match_rooms upsert + `NEW.room_id/room_password := NULL`;
null/'' → NO-OP (preserve). Explicit clear = match_rooms se direct DELETE.
⚠ Trigger function badlo to hamesha triple-check: (a) NULL-assign, (b) kya
hoga jab writer null bheje, (c) global creds-free sweep.
Delta: `2026-09-20e-TRIGGER-V3-ADDENDUM.sql`; schema SECTION 23 **Part G**.


### ⚠ Aakhri manual item (admin ke liye): Fraud/Health — deviceJoins RTDB rules
`runFraudCheck` `/deviceJoins` root-read par `permission_denied` deta hai (deployed rules me
read sirf `$deviceId/$matchId` depth par hai; root enumeration denied). Ye rules-deploy mangta
hai jo repo se nahi ho sakta — **Firebase Console → Realtime Database → Rules** me deviceJoins
block ko is se replace karo:

```json
"deviceJoins": {
  ".read": "auth != null",
  "rules": {
    "$deviceId": {
      "$matchId": { ".read": "auth != null", ".write": "auth != null" }
    }
  }
}
```

(phir Publish). Ye user-repo ke `firebase-security-rules.json` me bhi daal dena (file me abhi
root .read nahi hai). NOTE: RTDB `matches` root-read deployed rules me ALREADY denied hai
(repo-file se strict) — room-creds RTDB-leak ka koi risk nahi (enumeration impossible).
