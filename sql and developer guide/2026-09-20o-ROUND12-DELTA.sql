-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20o ROUND-12 — CROWN-JEWEL RE-VERIFY + STORED-XSS HARDENING
-- ═══════════════════════════════════════════════════════════════════
-- PROBES (sab live):
--   ✓ users direct-PATCH (total_wins/kills/streak/clean/rank_points/
--     is_admin) → sab 400/blocked — R2/R4 guards intact, NO privesc
--   ✓ matches direct INSERT (fake 50k-prize match) → 401 blocked
--   ✓ matches UPDATE real prize_pool → blocked (prize unchanged)
--   ✓ app_settings INSERT new key → 401 blocked
--   ✗ notifications cross-user insert (promo/squad_invite → admin/qa2)
--     → 201 OPEN (blacklist-policy hi hai; 401-jo-dikha tha wo
--     return=representation artifact tha — RETURNING ko SELECT chahiye)
--     → title/body HTML rakh sakta hai → STORED-XSS surface
--   ✓ ADMIN panel renders: Notifications-tab canary render nahi hua
--     (tab-filter), user-panel notifications.js escHtml ✓
--   ✗ admin-inline.js openUserModal (u.ign raw innerHTML), profile-feed
--     (d.ign raw), fa-admin clan-lists (p.ign/ci.ign raw) — code-level
--     raw interpolation confirmed
--
-- FIXES (live ✅):
--   1. SOURCE-LEVEL: users.ign + users.ff_uid par no-HTML CHECK
--      constraints (validated — existing data clean):
ALTER TABLE users ADD CONSTRAINT ign_no_html
  CHECK (ign NOT LIKE '%<%' AND ign NOT LIKE '%>%');
ALTER TABLE users ADD CONSTRAINT ffuid_no_html
  CHECK (ff_uid NOT LIKE '%<%' AND ff_uid NOT LIKE '%>%');
--      Ab koi bhi writer (client/RPC/admin) HTML-wala ign/ff_uid likh
--      hi nahi sakta. Verify: bad<img> write → blocked; normal → OK ✓
--   2. RENDER-LEVEL (admin repo JS): window.admEsc helper +
--      4 raw-ign spots escaped (openUserModal avatar+name,
--      profile-feed badge, fa-admin clan players/clan-list).
-- NOTE: notifications title/body free-text hi rahenge (emojis legit)
--       — user-panel render escaped hai; admin notif-list render par
--       nazar rakhna jab tak tab user-content dikhaye.
-- ═══════════════════════════════════════════════════════════════════
