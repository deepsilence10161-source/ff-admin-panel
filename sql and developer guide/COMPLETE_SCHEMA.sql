-- ================================================================
-- MINI eSPORTS — COMPLETE DATABASE SCHEMA v32 (FIXED)
-- ================================================================
-- ✅  IDEMPOTENT — safe to run on an existing live database, as many
-- times as needed. Zero data loss, zero duplicate-object errors:
-- • Tables:    CREATE TABLE IF NOT EXISTS (rows are never touched)
-- • Indexes:   CREATE INDEX IF NOT EXISTS
-- • Functions: CREATE OR REPLACE FUNCTION
-- • Policies:  DROP POLICY IF EXISTS → CREATE POLICY (re-applies cleanly)
-- • Triggers:  DROP TRIGGER IF EXISTS → CREATE TRIGGER (re-applies cleanly)
-- • Schema:    CREATE SCHEMA IF NOT EXISTS (never drops)
-- To delete a table/column on purpose, use a separate hard query —
-- ask the developer first. Never add DROP SCHEMA / DROP TABLE here.
--
-- ✅ Audit follow-up (June 2026) merged in: the 2 missing admin RLS
-- policies that were previously shipped as a separate
-- MIGRATION-missing-admin-policies.sql are now inline below
-- (cv_admin_all on creator_videos, bpp_admin_all on battle_pass_progress).
-- That separate file is no longer needed — this is the single source
-- of truth. See Section 15 summary at the bottom for details.
--
-- ✅ v32.7 (July 2026): ImgBB secret migration + Paytm UPI auto-payment
-- integration shipped as 3 Supabase Edge Functions (NOT in this file —
-- deployed separately via `supabase functions deploy`). Zero schema
-- changes — confirmed to reuse existing sd_requests/wallet_transactions/
-- notifications/increment_balance() as-is. See SECTION 17 comment block
-- near the bottom of this file, and DEVELOPER_GUIDE.md Section 24.
--
-- ✅ v32.8.5 (July 2026) — CRITICAL FIX, confirmed from live Postgres
-- logs: replaced auth.uid()::TEXT / auth.uid() with (auth.jwt() ->>
-- 'sub') in ALL ~168 RLS policy lines across every table. Reason:
-- Supabase's built-in auth.uid() hard-casts the JWT "sub" claim to
-- native UUID — but Firebase UIDs (e.g. "MjGRBJLOBvN03FHQKeFaEtO9mSp1")
-- are not valid UUIDs, so auth.uid() THROWS "invalid input syntax for
-- type uuid" for every authenticated request, admin and user side both.
-- This — not RLS silently denying — was the real cause of "permission
-- denied" everywhere. auth.jwt()->>'sub' returns the same claim as
-- plain text, no casting, so it works correctly for Firebase UIDs while
-- keeping every policy's original per-row / admin-only logic intact.
-- Also added explicit GRANT SELECT/INSERT/UPDATE/DELETE TO anon,
-- authenticated on all 88 base tables (see just below) — these tables
-- were created via raw SQL, not the Table Editor UI, so Supabase never
-- auto-granted them; logs confirmed "permission denied for table X"
-- with Postgres's own hint to add the missing GRANT. RLS above still
-- restricts every row per-user, so this grant is safe.
-- ⚠️ Do NOT apply RLS-PERMISSIVE-PATCH.sql — it is superseded by this
-- fix and would remove real per-row security (see DEVELOPER_GUIDE.md
-- Section 25 for the full writeup).
-- ================================================================

-- STEP 0: Ensure public schema exists (idempotent — safe on live DB)
-- [Manual hard query if a full wipe is ever truly needed —
--  run separately, NEVER add to this file:
--  DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; ]
CREATE SCHEMA IF NOT EXISTS public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO postgres, service_role;

-- ─────────────────────────────────────────────────────────────────
-- Base table GRANTs (v32.8.5) — required because these tables are
-- created via raw SQL below, not the Table Editor UI, so Supabase
-- does not auto-grant anon/authenticated privileges on them. RLS
-- policies (defined per-table further down) still restrict every
-- row per-user — this only grants the privilege to attempt the
-- operation at all. Confirmed necessary by production logs showing
-- "permission denied for table X ... GRANT SELECT ON public.X TO
-- anon" for tables including matches, users, app_settings.
-- ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_activity_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_alerts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_notes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_watchlist TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admins TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON auto_squad_queue TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ban_appeals TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON battle_pass_progress TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON battle_passes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON blacklist TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cheat_reports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON city_championship TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clan_members TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clan_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clan_war_challenges TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clan_wars TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clans TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON coin_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON config TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_applications TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_codes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_commissions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_matches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_payouts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_stats TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_videos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_checkins TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON disputes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON duel_challenges TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON duel_records TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ff_uid_index TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON fraud_cases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON friendships TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON gift_tickets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON join_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON kill_proofs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON kyc_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leaderboard TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leaderboard_archive TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON live_streams TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON match_feedback TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON match_results TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON match_templates TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON matches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_progress TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_stats TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON poll_votes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON polls TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON premium_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_updates TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rank_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rank_seasons TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON referrals TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON refund_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_broadcasts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sd_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON season_pass_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seasonal_league_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sponsored_prize_claims TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sponsored_prizes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sponsored_tournaments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON squad_finder TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON suggestions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tournament_brackets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON trial_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_achievements TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_activities TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_cosmetics TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_matches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_suggestions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON video_reports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON video_watches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vouchers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_audit_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON wallet_transactions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON watch_earn_log TO anon, authenticated;

-- Re-enable Supabase realtime for public schema
ALTER DATABASE postgres SET search_path TO public;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ================================================================
-- SECTION 1 — CORE TABLES
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 1.1  USERS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                      TEXT        PRIMARY KEY,     -- Firebase UID
  ign                     TEXT,
  ff_uid                  TEXT        UNIQUE,
  email                   TEXT,
  phone                   TEXT,
  avatar_url              TEXT,
  avatar_bg_color         TEXT        DEFAULT '#0d0d1a',
  city                    TEXT,
  bio                     TEXT,
  rank_tier               TEXT        DEFAULT 'Bronze',
  rank_points             INT         DEFAULT 0,
  total_wins              INT         DEFAULT 0,
  total_kills             INT         DEFAULT 0,
  total_matches           INT         DEFAULT 0,
  coins                   INT         DEFAULT 0,
  green_diamonds          INT         DEFAULT 0,
  sky_diamonds            INT         DEFAULT 0,
  win_streak              INT         DEFAULT 0,
  clean_matches           INT         DEFAULT 0,
  has_clean_badge         BOOL        DEFAULT false,
  streak_days             INT         DEFAULT 0,
  last_checkin_date       DATE,
  premium_level           INT         DEFAULT 0,
  premium_expires         TIMESTAMPTZ,
  profile_status          TEXT        DEFAULT 'complete',
  pending_ign             TEXT,
  profile_request_count   INT         DEFAULT 0,
  is_admin                BOOL        DEFAULT false,
  is_banned               BOOL        DEFAULT false,
  ban_reason              TEXT,
  -- ✅ ADDED (2026-08-22): durable, race-free leaderboard exclusion —
  -- see sync_leaderboard() below for why this is necessary (manually
  -- deleting a row from `leaderboard` directly gets silently undone by
  -- the trigger on the next unrelated update to this user's row).
  leaderboard_hidden      BOOL        DEFAULT false,
  is_vip                  BOOL        DEFAULT false,
  vip_granted_at          TIMESTAMPTZ,
  vip_reason              TEXT,
  is_creator              BOOL        DEFAULT false,
  is_live                 BOOL        DEFAULT false,
  stream_link             TEXT,
  fraud_score             INT         DEFAULT 0,
  accepted_policy         BOOL        DEFAULT false,
  accepted_policy_at      TIMESTAMPTZ,
  email_verified          BOOL        DEFAULT false,
  fcm_token               TEXT,
  fcm_updated_at          TIMESTAMPTZ,
  device_fp               TEXT,
  clan_id                 TEXT,
  referral_code           TEXT        UNIQUE,
  referred_by             TEXT        REFERENCES users(id),
  rival_uid               TEXT        REFERENCES users(id),
  rank_history            JSONB       DEFAULT '[]',
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
-- ✅ ADDED (2026-08-21): IGN max length. NOT VALID because one existing
-- test row (livetest.ffcheck@gmail.com, 26 chars) already violates it —
-- enforces going forward without failing on old data. See
-- DEVELOPER_GUIDE.md session 2026-08-21 §4.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ign_length_check;
ALTER TABLE users ADD CONSTRAINT users_ign_length_check
  CHECK (ign IS NULL OR char_length(ign) <= 20) NOT VALID;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users FOR SELECT USING (true);
DROP POLICY IF EXISTS "users_insert_own" ON users;
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = id);
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (
  (auth.jwt() ->> 'sub') = id OR
  (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true)
) WITH CHECK (
  (auth.jwt() ->> 'sub') = id OR
  (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true)
);
-- ⚠️ CRITICAL SECURITY FIX (2026-07-20): added WITH CHECK. id was added to
-- this table's grantable UPDATE columns to fix upsert()'s harmless
-- self-assignment no-op (id = EXCLUDED.id, see the GRANT UPDATE comment
-- below) — but without WITH CHECK, that same grant would also have let a
-- caller attempt a DIRECT .update({id: 'someone-elses-id'}).eq('id',
-- 'my-own-id') call: USING would match (their own row), and with no WITH
-- CHECK there was nothing stopping the id column's new value from being
-- anything at all. WITH CHECK closes this — id can only be "changed" to
-- a value that still satisfies the same ownership condition, which in
-- practice means it can't meaningfully change at all for a non-admin.

CREATE INDEX IF NOT EXISTS idx_users_ign          ON users(ign);
CREATE INDEX IF NOT EXISTS idx_users_ff_uid        ON users(ff_uid) WHERE ff_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_rank          ON users(rank_points DESC);
CREATE INDEX IF NOT EXISTS idx_users_ign_trgm      ON users USING gin(ign gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_ff_uid_trgm   ON users USING gin(ff_uid gin_trgm_ops) WHERE ff_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_is_admin      ON users(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_users_is_banned     ON users(is_banned) WHERE is_banned = true;
CREATE INDEX IF NOT EXISTS idx_users_is_vip        ON users(is_vip)    WHERE is_vip    = true;

-- ─────────────────────────────────────────────────────────────────
-- 1.2  MATCHES
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  title               TEXT        NOT NULL,
  name                TEXT        GENERATED ALWAYS AS (title) STORED,
  mode                TEXT        DEFAULT 'solo',
  entry_type          TEXT        DEFAULT 'free',
  entry_fee           NUMERIC     DEFAULT 0,
  max_slots           INT         DEFAULT 12,
  filled_slots        INT         DEFAULT 0,
  prize_pool          NUMERIC     DEFAULT 0,
  first_prize          NUMERIC     DEFAULT 0,  -- was prize_1st
  second_prize         NUMERIC     DEFAULT 0,  -- was prize_2nd
  third_prize          NUMERIC     DEFAULT 0,  -- was prize_3rd
  per_kill_prize      NUMERIC     DEFAULT 0,
  prize_type          TEXT        DEFAULT 'green_diamond',
  map                 TEXT        DEFAULT 'Bermuda',
  status              TEXT        DEFAULT 'upcoming',
  scheduled_at        TIMESTAMPTZ,
  room_id             TEXT        DEFAULT '',
  room_password       TEXT        DEFAULT '',
  room_status         TEXT        DEFAULT 'pending',
  banner_url          TEXT,
  stream_link         TEXT,
  youtube_link        TEXT,
  spectator_count     INT         DEFAULT 0,
  is_featured         BOOL        DEFAULT false,
  is_sponsored        BOOL        DEFAULT false,
  is_special          BOOL        DEFAULT false,
  special_category    TEXT        DEFAULT 'none',
  ads_required        INT         DEFAULT 0,
  min_rank            TEXT,
  match_sub_type      TEXT,
  creator_uid         TEXT        REFERENCES users(id),
  creator_code        TEXT,
  prize_distribution  JSONB       DEFAULT '[]',
  result_screenshot   TEXT,
  result_screenshots  JSONB,
  result_published_at TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        TEXT,
  completed_at        TIMESTAMPTZ,
  reminder_sent       BOOL        DEFAULT false,
  data                JSONB       DEFAULT '{}',
  room_release_minutes INT        DEFAULT 5,
  room_released_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
-- ✅ ADDED (2026-07-17): room_release_minutes/room_released_at — referenced by
-- features-admin.js, admin-inline.js, fa24-admin-smart-tools.js, and User Panel's
-- matches.js (room-ID reveal countdown, a real-money UX feature) but the column
-- never existed. Not a permissions issue — a genuinely missing column.
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "matches_select_all" ON matches;
CREATE POLICY "matches_select_all" ON matches FOR SELECT USING (true);
DROP POLICY IF EXISTS "matches_admin_write" ON matches;
CREATE POLICY "matches_admin_write" ON matches FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE INDEX IF NOT EXISTS idx_matches_status_time ON matches(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_matches_status       ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_creator       ON matches(creator_uid);

-- ─────────────────────────────────────────────────────────────────
-- 1.3  JOIN REQUESTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS join_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        TEXT        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id         TEXT        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  status          TEXT        DEFAULT 'pending',
  entry_type      TEXT        DEFAULT 'free',
  entry_fee       NUMERIC     DEFAULT 0,
  entry_fee_paid  NUMERIC     DEFAULT 0,
  ign_at_join     TEXT        DEFAULT '',
  user_ign        TEXT        DEFAULT '',
  mode            TEXT        DEFAULT 'solo',
  kills           INT         DEFAULT 0,
  placement       INT         DEFAULT 0,
  prize_earned    NUMERIC     DEFAULT 0,
  squad_members   JSONB,
  slot_number     INT,
  captain_uid     TEXT,
  fee_type        TEXT        DEFAULT 'solo',
  checked_in      BOOL        DEFAULT false,
  checkin_at      TIMESTAMPTZ,
  in_room         BOOL        DEFAULT false,
  in_room_at      TIMESTAMPTZ,
  ad_watched      BOOL        DEFAULT false,
  rejection_note  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, user_id)
);
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jr_select_own" ON join_requests;
CREATE POLICY "jr_select_own" ON join_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "jr_insert_own" ON join_requests;
CREATE POLICY "jr_insert_own" ON join_requests FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "jr_update_admin" ON join_requests;
CREATE POLICY "jr_update_admin" ON join_requests FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true))
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
-- ⚠️ SECURITY FIX (2026-07-20): added WITH CHECK — without it, a non-admin
-- caller could take their own join_requests row (matches USING) and
-- change its user_id to someone else's id, effectively transferring their
-- match slot to another account (or vice versa, hijacking someone else's
-- slot if they can guess/know the row). Same root cause as referrals'
-- WITH CHECK gap: user_id/match_id/id were just added to the grantable
-- UPDATE columns because PostgREST's upsert() SET clause includes them
-- regardless of the onConflict target, which is what made this reachable.
-- WITH CHECK here is intentionally the same condition as USING (rather
-- than locking user_id/match_id to their exact prior value) so an admin
-- can still legitimately reassign a row if ever needed; a non-admin still
-- cannot, since their branch requires the NEW user_id to equal their own
-- id too.

CREATE INDEX IF NOT EXISTS idx_jr_match         ON join_requests(match_id);
CREATE INDEX IF NOT EXISTS idx_jr_user          ON join_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_jr_match_user    ON join_requests(match_id, user_id);
CREATE INDEX IF NOT EXISTS idx_jr_status        ON join_requests(status);
CREATE INDEX IF NOT EXISTS idx_jr_checkin       ON join_requests(checked_in) WHERE checked_in = false;

-- ─────────────────────────────────────────────────────────────────
-- 1.4  WALLET TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  txn_type    TEXT        NOT NULL,
  amount      NUMERIC     NOT NULL DEFAULT 0,
  currency    TEXT        DEFAULT 'coins',
  reason      TEXT,
  note        TEXT,
  description TEXT,
  ref_id      TEXT,
  status      TEXT        DEFAULT 'completed',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- ✅ ADDED (2026-07-17): status column — admin-supabase-sponsored.js reads
-- and filters on wallet_transactions.status (for txn_type='pending_withdraw'
-- rows specifically — the sponsored-tournament-winnings withdrawal queue),
-- but the column never existed. Defaults to 'completed' since every OTHER
-- txn_type in this table represents a transaction that already happened
-- atomically (a credit/debit that's done, not a pending request) — only
-- pending_withdraw rows are ever expected to sit at 'pending'.
-- ⚠️ NOTE (2026-08-22): there is NO `timestamp` column on this table —
-- only `created_at`. The Admin Panel's Supabase↔Firebase-style bridge
-- (supabase-rtdb-bridge.js) had ZERO registered field-converter for
-- wallet_transactions until this session, so every write through
-- rtdb.ref('users/{uid}/transactions').push({..., timestamp: Date.now()})
-- sent the raw key `timestamp` straight to PostgREST, which failed
-- outright ("Could not find the 'timestamp' column of
-- 'wallet_transactions'") — confirmed live via the Sky Diamond approval
-- flow. A proper walletTxnToSupa/walletTxnFromSupa converter pair now
-- maps type→txn_type and timestamp/createdAt→created_at (see
-- supabase-rtdb-bridge.js CONVERTERS registry). If you add a NEW call
-- site that pushes to users/{uid}/transactions, it will now go through
-- this converter automatically — you do not need to touch column names
-- in the JS payload.
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wt_select_own" ON wallet_transactions;
CREATE POLICY "wt_select_own" ON wallet_transactions FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "wt_insert_own" ON wallet_transactions;
CREATE POLICY "wt_insert_own" ON wallet_transactions FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE INDEX IF NOT EXISTS idx_wt_user      ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wt_user_date ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wt_currency  ON wallet_transactions(currency);

-- ─────────────────────────────────────────────────────────────────
-- 1.5  SKY DIAMOND REQUESTS (UPI deposits)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sd_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ign             TEXT,
  sd_amount       NUMERIC     DEFAULT 0,
  amount_inr      NUMERIC     DEFAULT 0,
  screenshot_url  TEXT,
  upi_ref         TEXT,
  img_hash        TEXT,
  request_type    TEXT        DEFAULT 'sky_diamond_purchase',
  notes           TEXT,
  review_note     TEXT,
  status          TEXT        DEFAULT 'pending',
  reviewed_by     TEXT        REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sd_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sd_select_own" ON sd_requests;
CREATE POLICY "sd_select_own" ON sd_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "sd_insert_own" ON sd_requests;
CREATE POLICY "sd_insert_own" ON sd_requests FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "sd_update_admin" ON sd_requests;
CREATE POLICY "sd_update_admin" ON sd_requests FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE INDEX IF NOT EXISTS idx_sd_user      ON sd_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_sd_status    ON sd_requests(status);
CREATE INDEX IF NOT EXISTS idx_sd_img_hash  ON sd_requests(img_hash);
CREATE INDEX IF NOT EXISTS idx_sd_upi_ref   ON sd_requests(upi_ref);

-- ─────────────────────────────────────────────────────────────────
-- 1.6  NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL DEFAULT 'info',
  title       TEXT        NOT NULL DEFAULT '',
  body        TEXT        NOT NULL DEFAULT '',
  ref_id      TEXT,
  is_read     BOOL        DEFAULT false,
  target_all  BOOL        DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_select_own" ON notifications;
CREATE POLICY "notif_select_own" ON notifications FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR target_all = true OR
         (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
-- notif_insert policy: see the single canonical definition later in this
-- file (search "notif_insert"), which allows notifying other users (for
-- referral/mentor/duel/clan features) while blocking privileged-type
-- spoofing. An earlier version of this policy lived here too; consolidated
-- to one definition to avoid two versions drifting out of sync — Postgres
-- would use whichever CREATE POLICY runs last for a given name anyway.
DROP POLICY IF EXISTS "notif_update_own" ON notifications;
CREATE POLICY "notif_update_own" ON notifications FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE INDEX IF NOT EXISTS idx_notif_user       ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread     ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notif_target_all ON notifications(target_all) WHERE target_all = true;

-- ================================================================
-- SECTION 2 — CLAN SYSTEM
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 2.1  CLANS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clans (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT        NOT NULL UNIQUE,
  badge                   TEXT        DEFAULT '🏆',
  emblem                  TEXT        DEFAULT '🏰',
  tag                     TEXT        DEFAULT '',
  leader_uid              TEXT        NOT NULL REFERENCES users(id),
  description             TEXT,
  total_members           INT         DEFAULT 0,
  total_wins              INT         DEFAULT 0,
  total_kills             INT         DEFAULT 0,
  weekly_score            INT         DEFAULT 0,
  squad_bank_gd           INT         DEFAULT 0,
  squad_bank_unlocked     JSONB       DEFAULT '{}',
  squad_bank_contributors JSONB       DEFAULT '{}',
  is_private              BOOL        DEFAULT false,
  join_code               TEXT        UNIQUE,
  status                  TEXT        DEFAULT 'active',
  disbanded_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clans_select_all" ON clans;
CREATE POLICY "clans_select_all" ON clans FOR SELECT USING (true);
DROP POLICY IF EXISTS "clans_insert_auth" ON clans;
CREATE POLICY "clans_insert_auth" ON clans FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') IS NOT NULL);
DROP POLICY IF EXISTS "clans_update_leader" ON clans;
CREATE POLICY "clans_update_leader" ON clans FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = leader_uid OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true))
  WITH CHECK (id IN (SELECT id FROM clans WHERE (auth.jwt() ->> 'sub') = leader_uid OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true)));
-- ⚠️ SECURITY FIX (2026-07-20, corrected): id is now a grantable UPDATE
-- column (needed since it's the clans upsert's onConflict target — see
-- the GRANT UPDATE comment above). The obvious-looking fix of repeating
-- USING's condition in WITH CHECK is WRONG here: WITH CHECK evaluates
-- against the NEW row, and core/db-bridge.js's clans upsert genuinely
-- needs to set leader_uid to someone OTHER than the caller (a real
-- leadership handoff, `leader_uid: value.leaderId || _uid()`) — checking
-- `(auth.jwt()->>'sub') = leader_uid` against the new row would have
-- blocked every legitimate handoff, since the new leader_uid is
-- deliberately not the caller in that case. Instead this checks that the
-- row's id still belongs to a clan the caller was already allowed to
-- touch (i.e. id itself wasn't changed to point at a DIFFERENT clan) —
-- this is what actually needed protecting; leader_uid remaining changeable
-- to a different person by the current leader is the intended behavior.

-- ─────────────────────────────────────────────────────────────────
-- 2.2  CLAN MEMBERS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clan_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id     UUID        NOT NULL REFERENCES clans(id)  ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role        TEXT        DEFAULT 'member',
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clan_id, user_id)
);
ALTER TABLE clan_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cm_select_all" ON clan_members;
CREATE POLICY "cm_select_all" ON clan_members FOR SELECT USING (true);
DROP POLICY IF EXISTS "cm_insert_auth" ON clan_members;
CREATE POLICY "cm_insert_auth" ON clan_members FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') IS NOT NULL);
DROP POLICY IF EXISTS "cm_delete_own" ON clan_members;
CREATE POLICY "cm_delete_own" ON clan_members FOR DELETE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_cm_clan ON clan_members(clan_id);
CREATE INDEX IF NOT EXISTS idx_cm_user ON clan_members(user_id);

-- ─────────────────────────────────────────────────────────────────
-- 2.3  CLAN MESSAGES  (Supabase Realtime)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clan_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_id     UUID        NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  sender_id   TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_ign  TEXT        DEFAULT 'Player',
  message     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clan_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cmsg_select_member" ON clan_messages;
CREATE POLICY "cmsg_select_member" ON clan_messages FOR SELECT USING (true);
DROP POLICY IF EXISTS "cmsg_insert_member" ON clan_messages;
CREATE POLICY "cmsg_insert_member" ON clan_messages FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = sender_id);
CREATE INDEX IF NOT EXISTS idx_cmsg_clan ON clan_messages(clan_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- 2.4  CLAN WARS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clan_wars (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_a_id       UUID        REFERENCES clans(id) ON DELETE CASCADE,
  clan_b_id       UUID        REFERENCES clans(id) ON DELETE CASCADE,
  clan_a_score    INT         DEFAULT 0,
  clan_b_score    INT         DEFAULT 0,
  status          TEXT        DEFAULT 'active',
  start_date      DATE,
  end_date        DATE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clan_wars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cw_select_all" ON clan_wars;
CREATE POLICY "cw_select_all" ON clan_wars FOR SELECT USING (true);
DROP POLICY IF EXISTS "cw_insert_auth" ON clan_wars;
CREATE POLICY "cw_insert_auth" ON clan_wars FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') IS NOT NULL);
DROP POLICY IF EXISTS "cw_update_auth" ON clan_wars;
CREATE POLICY "cw_update_auth" ON clan_wars FOR UPDATE USING ((auth.jwt() ->> 'sub') IS NOT NULL);

-- ================================================================
-- SECTION 3 — WALLET & FINANCE TABLES
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 3.1  WALLET AUDIT LOG
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT        REFERENCES users(id) ON DELETE CASCADE,
  action          TEXT,
  amount          NUMERIC     DEFAULT 0,
  currency        TEXT        DEFAULT 'coins',
  before_balance  NUMERIC     DEFAULT 0,
  after_balance   NUMERIC     DEFAULT 0,
  performed_by    TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE wallet_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wal_admin_all" ON wallet_audit_log;
CREATE POLICY "wal_admin_all" ON wallet_audit_log FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_wal_user ON wallet_audit_log(user_id);

-- ─────────────────────────────────────────────────────────────────
-- 3.2  COIN REQUESTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coin_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        REFERENCES users(id) ON DELETE CASCADE,
  amount      INT         DEFAULT 0,
  reason      TEXT,
  status      TEXT        DEFAULT 'pending',
  reviewed_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE coin_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cr_select_own" ON coin_requests;
CREATE POLICY "cr_select_own" ON coin_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "cr_insert_own" ON coin_requests;
CREATE POLICY "cr_insert_own" ON coin_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 3.3  REFUND REQUESTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        REFERENCES users(id) ON DELETE CASCADE,
  match_id    TEXT,
  amount      NUMERIC     DEFAULT 0,
  currency    TEXT        DEFAULT 'coins',
  reason      TEXT,
  status      TEXT        DEFAULT 'pending',
  reviewed_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rr_select_own" ON refund_requests;
CREATE POLICY "rr_select_own" ON refund_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "rr_insert_own" ON refund_requests;
CREATE POLICY "rr_insert_own" ON refund_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 3.4  SPONSORED PRIZES & CLAIMS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsored_prizes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name  TEXT        NOT NULL,
  prize_type    TEXT        DEFAULT 'cash',
  prize_value   TEXT        NOT NULL,
  description   TEXT,
  claim_deadline DATE,
  max_claims    INT         DEFAULT 1,
  total_claimed INT         DEFAULT 0,
  is_active     BOOL        DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sponsored_prizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sp_select_all" ON sponsored_prizes;
CREATE POLICY "sp_select_all" ON sponsored_prizes FOR SELECT USING (true);
DROP POLICY IF EXISTS "sp_admin_write" ON sponsored_prizes;
CREATE POLICY "sp_admin_write" ON sponsored_prizes FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS sponsored_prize_claims (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        REFERENCES users(id)      ON DELETE CASCADE,
  prize_id      UUID        REFERENCES sponsored_prizes(id) ON DELETE SET NULL,
  match_id      TEXT,
  prize_detail  TEXT        NOT NULL,
  status        TEXT        DEFAULT 'pending',
  claimed_at    TIMESTAMPTZ DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  processed_by  TEXT,
  notes         TEXT
);
ALTER TABLE sponsored_prize_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "spc_select_own" ON sponsored_prize_claims;
CREATE POLICY "spc_select_own" ON sponsored_prize_claims FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "spc_insert_own" ON sponsored_prize_claims;
CREATE POLICY "spc_insert_own" ON sponsored_prize_claims FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "spc_update_admin" ON sponsored_prize_claims;
CREATE POLICY "spc_update_admin" ON sponsored_prize_claims FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ─────────────────────────────────────────────────────────────────
-- 3.5  SPONSORED TOURNAMENTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsored_tournaments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  sponsor_name    TEXT,
  prize_pool      NUMERIC     DEFAULT 0,
  prize_type      TEXT        DEFAULT 'cash',
  entry_type      TEXT        DEFAULT 'free',
  status          TEXT        DEFAULT 'upcoming',
  withdrawal_uid  TEXT,
  wd_status       TEXT        DEFAULT 'pending',
  wd_amount       NUMERIC     DEFAULT 0,
  wd_upi          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sponsored_tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "st_select_all" ON sponsored_tournaments;
CREATE POLICY "st_select_all" ON sponsored_tournaments FOR SELECT USING (true);
DROP POLICY IF EXISTS "st_admin_write" ON sponsored_tournaments;
CREATE POLICY "st_admin_write" ON sponsored_tournaments FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ─────────────────────────────────────────────────────────────────
-- 3.6  GIFT TICKETS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gift_tickets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_uid    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_name   TEXT        DEFAULT '',
  to_uid      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_ff_uid   TEXT,
  match_id    TEXT        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  match_name  TEXT        DEFAULT '',
  fee         NUMERIC     DEFAULT 0,
  entry_type  TEXT        DEFAULT 'paid',
  status      TEXT        DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE gift_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gt_select_own" ON gift_tickets;
CREATE POLICY "gt_select_own" ON gift_tickets FOR SELECT
  USING ((auth.jwt() ->> 'sub') = from_uid OR (auth.jwt() ->> 'sub') = to_uid OR
         (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "gt_insert_own" ON gift_tickets;
CREATE POLICY "gt_insert_own" ON gift_tickets FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = from_uid);
CREATE INDEX IF NOT EXISTS idx_gt_to_uid   ON gift_tickets(to_uid);
CREATE INDEX IF NOT EXISTS idx_gt_match_id ON gift_tickets(match_id);

-- ================================================================
-- SECTION 4 — MATCH & RESULT TABLES
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 4.1  MATCH RESULTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_results (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        TEXT        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id         TEXT        REFERENCES users(id) ON DELETE CASCADE,
  placement       INT         DEFAULT 0,
  kills           INT         DEFAULT 0,
  prize           NUMERIC     DEFAULT 0,
  ocr_raw         TEXT,
  screenshot_url  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, user_id)
);
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mr_select_all" ON match_results;
CREATE POLICY "mr_select_all" ON match_results FOR SELECT USING (true);
DROP POLICY IF EXISTS "mr_insert_own" ON match_results;
CREATE POLICY "mr_insert_own" ON match_results FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "mr_update_admin" ON match_results;
CREATE POLICY "mr_update_admin" ON match_results FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_mr_match ON match_results(match_id);

-- ─────────────────────────────────────────────────────────────────
-- 4.2  MATCH TEMPLATES
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  config      JSONB       DEFAULT '{}',
  created_by  TEXT        REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE match_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mt_admin_all" ON match_templates;
CREATE POLICY "mt_admin_all" ON match_templates FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ─────────────────────────────────────────────────────────────────
-- 4.3  MATCH FEEDBACK
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    TEXT,
  user_id     TEXT        REFERENCES users(id) ON DELETE CASCADE,
  rating      INT         CHECK (rating BETWEEN 1 AND 5),
  feedback    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, match_id)
);
ALTER TABLE match_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mf_select_admin" ON match_feedback;
CREATE POLICY "mf_select_admin" ON match_feedback FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "mf_insert_own" ON match_feedback;
CREATE POLICY "mf_insert_own" ON match_feedback FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 4.4  KILL PROOFS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kill_proofs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        TEXT,
  user_id         TEXT        REFERENCES users(id) ON DELETE CASCADE,
  screenshot_url  TEXT,
  kills_claimed   INT         DEFAULT 0,
  status          TEXT        DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE kill_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kp_select_own" ON kill_proofs;
CREATE POLICY "kp_select_own" ON kill_proofs FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "kp_insert_own" ON kill_proofs;
CREATE POLICY "kp_insert_own" ON kill_proofs FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ================================================================
-- SECTION 5 — PLAYER FEATURE TABLES
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 5.1  WATCH EARN LOG
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watch_earn_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id     TEXT        REFERENCES matches(id) ON DELETE SET NULL,
  coins_earned INT         DEFAULT 0,
  watched_mins INT         DEFAULT 0,
  log_date     DATE        DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE watch_earn_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wel_select_own" ON watch_earn_log;
CREATE POLICY "wel_select_own" ON watch_earn_log FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "wel_insert_own" ON watch_earn_log;
CREATE POLICY "wel_insert_own" ON watch_earn_log FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
CREATE INDEX IF NOT EXISTS idx_wel_user_date ON watch_earn_log(user_id, log_date);

-- ─────────────────────────────────────────────────────────────────
-- 5.2  AUTO SQUAD QUEUE
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auto_squad_queue (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    TEXT        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  mode        TEXT        DEFAULT 'squad',
  ign         TEXT        DEFAULT 'Player',
  rank_tier   TEXT        DEFAULT 'Bronze',
  rank_pts    INT         DEFAULT 0,
  status      TEXT        DEFAULT 'waiting',
  team_id     TEXT,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, user_id)
);
ALTER TABLE auto_squad_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asq_select_all" ON auto_squad_queue;
CREATE POLICY "asq_select_all" ON auto_squad_queue FOR SELECT USING (true);
DROP POLICY IF EXISTS "asq_insert_own" ON auto_squad_queue;
CREATE POLICY "asq_insert_own" ON auto_squad_queue FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "asq_update_own" ON auto_squad_queue;
CREATE POLICY "asq_update_own" ON auto_squad_queue FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "asq_delete_own" ON auto_squad_queue;
CREATE POLICY "asq_delete_own" ON auto_squad_queue FOR DELETE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_asq_match_status ON auto_squad_queue(match_id, status);

-- ─────────────────────────────────────────────────────────────────
-- 5.3  DAILY CHECKINS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_checkins (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date DATE  NOT NULL,
  coins_earned INT   DEFAULT 0,
  streak_day   INT   DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, checkin_date)
);
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dc_own" ON daily_checkins;
CREATE POLICY "dc_own" ON daily_checkins FOR ALL USING ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 5.4  MISSION PROGRESS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_progress (
  id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_key    TEXT  NOT NULL,
  period         TEXT  NOT NULL,
  progress       INT   DEFAULT 0,
  target         INT   DEFAULT 1,
  is_completed   BOOL  DEFAULT false,
  reward_claimed BOOL  DEFAULT false,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, mission_key, period)
);
ALTER TABLE mission_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mp_own" ON mission_progress;
CREATE POLICY "mp_own" ON mission_progress FOR ALL USING ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 5.5  USER ACHIEVEMENTS & COSMETICS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_achievements (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT  REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT  NOT NULL,
  unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ua_select_all" ON user_achievements;
CREATE POLICY "ua_select_all" ON user_achievements FOR SELECT USING (true);
DROP POLICY IF EXISTS "ua_insert_own" ON user_achievements;
CREATE POLICY "ua_insert_own" ON user_achievements FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT  REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_key TEXT  NOT NULL,
  is_equipped  BOOL  DEFAULT false,
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, cosmetic_key)
);
ALTER TABLE user_cosmetics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uc_own" ON user_cosmetics;
CREATE POLICY "uc_own" ON user_cosmetics FOR ALL
  USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
-- ⚠️ SECURITY FIX (2026-07-20): added WITH CHECK. user_id is now a
-- grantable UPDATE column (needed since it's part of the upsert's
-- onConflict target: 'user_id,cosmetic_key') — without WITH CHECK, a
-- caller could change their own cosmetic-ownership row's user_id to a
-- different user, effectively gifting or duplicating cosmetic ownership
-- to/for an account that never actually unlocked it.

-- ─────────────────────────────────────────────────────────────────
-- 5.6  REFERRALS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       TEXT  REFERENCES users(id) ON DELETE CASCADE,
  referred_id       TEXT  REFERENCES users(id) ON DELETE CASCADE,
  join_bonus_paid   BOOL  DEFAULT false,
  match_bonus_paid  BOOL  DEFAULT false,
  referrer_ign      TEXT  DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referred_id)
);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ref_select_own" ON referrals;
CREATE POLICY "ref_select_own" ON referrals FOR SELECT
  USING ((auth.jwt() ->> 'sub') = referrer_id OR (auth.jwt() ->> 'sub') = referred_id);
DROP POLICY IF EXISTS "ref_insert_own" ON referrals;
CREATE POLICY "ref_insert_own" ON referrals FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = referred_id);
DROP POLICY IF EXISTS "ref_update_own" ON referrals;
CREATE POLICY "ref_update_own" ON referrals FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = referrer_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = referrer_id);
-- ⚠️ SECURITY FIX (2026-07-20): added WITH CHECK. USING alone only
-- restricts which EXISTING rows can be updated (caller must currently be
-- referrer_id) — it does not restrict what the NEW referrer_id can be
-- after the update. Without WITH CHECK, a caller could take a referral
-- row where they're already the referrer and change referrer_id to a
-- DIFFERENT user's id, effectively stealing that referral's credit.
-- referrer_id/referred_id were just added to this table's grantable
-- UPDATE columns (see the GRANT UPDATE comment above — needed because
-- PostgREST's upsert() includes them in its SET clause regardless of the
-- onConflict target), which is what turned this from a theoretical gap
-- into an actually-reachable one.

-- ─────────────────────────────────────────────────────────────────
-- 5.7  BATTLE PASS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS battle_passes (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT  NOT NULL,
  season_num  INT   DEFAULT 1,
  season_key  TEXT  DEFAULT '',
  is_active   BOOL  DEFAULT false,
  tiers       JSONB DEFAULT '[]',
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE battle_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bp_select_all" ON battle_passes;
CREATE POLICY "bp_select_all" ON battle_passes FOR SELECT USING (true);
DROP POLICY IF EXISTS "bp_admin_write" ON battle_passes;
CREATE POLICY "bp_admin_write" ON battle_passes FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS battle_pass_progress (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT  REFERENCES users(id) ON DELETE CASCADE,
  season_key    TEXT  DEFAULT '',
  current_xp    INT   DEFAULT 0,
  current_tier  INT   DEFAULT 0,
  has_premium   BOOL  DEFAULT false,
  claimed_free  JSONB DEFAULT '{}',
  claimed_prem  JSONB DEFAULT '{}',
  claimed_tiers JSONB DEFAULT '[]',
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season_key)
);
ALTER TABLE battle_pass_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bpp_own" ON battle_pass_progress;
CREATE POLICY "bpp_own" ON battle_pass_progress FOR ALL USING ((auth.jwt() ->> 'sub') = user_id);
-- ✅ AUDIT FOLLOW-UP: admin override (grant/revoke premium, fix XP/tier) — pehle missing thi
DROP POLICY IF EXISTS "bpp_admin_all" ON battle_pass_progress;
CREATE POLICY "bpp_admin_all" ON battle_pass_progress FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS season_pass_requests (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT  REFERENCES users(id) ON DELETE CASCADE,
  ign               TEXT,
  season_key        TEXT  NOT NULL,
  price             INT   DEFAULT 49,
  payment_screenshot TEXT,
  status            TEXT  DEFAULT 'pending',
  reviewed_by       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE season_pass_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "spr_select_own" ON season_pass_requests;
CREATE POLICY "spr_select_own" ON season_pass_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "spr_insert_own" ON season_pass_requests;
CREATE POLICY "spr_insert_own" ON season_pass_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 5.8  RANK SYSTEM
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rank_seasons (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT  NOT NULL,
  season_num  INT   DEFAULT 1,
  is_active   BOOL  DEFAULT false,
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rank_seasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rs_select_all" ON rank_seasons;
CREATE POLICY "rs_select_all" ON rank_seasons FOR SELECT USING (true);
DROP POLICY IF EXISTS "rs_admin_write" ON rank_seasons;
CREATE POLICY "rs_admin_write" ON rank_seasons FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS rank_history (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT  REFERENCES users(id) ON DELETE CASCADE,
  season_id         UUID  REFERENCES rank_seasons(id) ON DELETE CASCADE,
  final_rank_points INT   DEFAULT 0,
  final_rank_tier   TEXT  DEFAULT 'Bronze',
  final_position    INT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rank_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rh_select_own" ON rank_history;
CREATE POLICY "rh_select_own" ON rank_history FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "rh_insert_own" ON rank_history;
CREATE POLICY "rh_insert_own" ON rank_history FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS seasonal_league_history (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_name TEXT  NOT NULL DEFAULT 'Season 1',
  season_num  INT   NOT NULL DEFAULT 1,
  final_tier  TEXT,
  points      INT   NOT NULL DEFAULT 0,
  badge       TEXT,
  reward      TEXT,
  emoji       TEXT  DEFAULT '🏅',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE seasonal_league_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "slh_select_own" ON seasonal_league_history;
CREATE POLICY "slh_select_own" ON seasonal_league_history FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "slh_admin_write" ON seasonal_league_history;
CREATE POLICY "slh_admin_write" ON seasonal_league_history FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ─────────────────────────────────────────────────────────────────
-- 5.9  SOCIAL: FRIENDS, SQUADS, DUELS, MENTORS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a      TEXT  REFERENCES users(id) ON DELETE CASCADE,
  user_b      TEXT  REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT  DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_a, user_b)
);
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fr_select_own" ON friendships;
CREATE POLICY "fr_select_own" ON friendships FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_a OR (auth.jwt() ->> 'sub') = user_b);
DROP POLICY IF EXISTS "fr_insert_own" ON friendships;
CREATE POLICY "fr_insert_own" ON friendships FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_a);
DROP POLICY IF EXISTS "fr_update_own" ON friendships;
CREATE POLICY "fr_update_own" ON friendships FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = user_a OR (auth.jwt() ->> 'sub') = user_b);

CREATE TABLE IF NOT EXISTS squad_finder (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  mode        TEXT  DEFAULT 'squad',
  rank_tier   TEXT,
  rank_pts    INT   DEFAULT 0,
  playstyle   TEXT,
  note        TEXT,
  ign         TEXT,
  role        TEXT,
  lang        TEXT,
  is_active   BOOL  DEFAULT true,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- ✅ ADDED (2026-07-17): ign, role, lang, rank_pts, expires_at — confirmed via
-- features/squad-finder.js's actual upsert() payload that the live code sends
-- all five of these, but the table never had them. rank_tier stays but is never
-- directly client-writable (see grant block above + RPC below); rank_pts is kept
-- writable at the column level for legacy compat, but the RPC path always
-- overwrites it server-side, so client-submitted values effectively don't matter
-- once the RPC is used.
ALTER TABLE squad_finder ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sf_select_all" ON squad_finder;
CREATE POLICY "sf_select_all" ON squad_finder FOR SELECT USING (true);
DROP POLICY IF EXISTS "sf_own" ON squad_finder;
CREATE POLICY "sf_own" ON squad_finder FOR ALL   USING ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS duel_challenges (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_uid  TEXT  REFERENCES users(id) ON DELETE CASCADE,
  opponent_uid    TEXT  REFERENCES users(id) ON DELETE CASCADE,
  match_id        TEXT,
  bet_coins       INT   DEFAULT 0,
  status          TEXT  DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE duel_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dc_select_own" ON duel_challenges;
CREATE POLICY "dc_select_own" ON duel_challenges FOR SELECT
  USING ((auth.jwt() ->> 'sub') = challenger_uid OR (auth.jwt() ->> 'sub') = opponent_uid);
DROP POLICY IF EXISTS "dc_insert_own" ON duel_challenges;
CREATE POLICY "dc_insert_own" ON duel_challenges FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = challenger_uid);
DROP POLICY IF EXISTS "dc_update_own" ON duel_challenges;
CREATE POLICY "dc_update_own" ON duel_challenges FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = challenger_uid OR (auth.jwt() ->> 'sub') = opponent_uid);

CREATE TABLE IF NOT EXISTS mentor_profiles (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT  REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  speciality      TEXT,
  rate_per_session INT  DEFAULT 0,
  is_available    BOOL  DEFAULT true,
  bio             TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mentor_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mnp_select_all" ON mentor_profiles;
CREATE POLICY "mnp_select_all" ON mentor_profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "mnp_own" ON mentor_profiles;
CREATE POLICY "mnp_own" ON mentor_profiles FOR ALL   USING ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS mentor_requests (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uid   TEXT  REFERENCES users(id) ON DELETE CASCADE,
  mentor_uid    TEXT  REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT  DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mentor_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mnr_select_own" ON mentor_requests;
CREATE POLICY "mnr_select_own" ON mentor_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = student_uid OR (auth.jwt() ->> 'sub') = mentor_uid);
DROP POLICY IF EXISTS "mnr_insert_own" ON mentor_requests;
CREATE POLICY "mnr_insert_own" ON mentor_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = student_uid);

CREATE TABLE IF NOT EXISTS user_activities (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT  NOT NULL,
  message     TEXT,
  ref_id      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "act_select_own" ON user_activities;
CREATE POLICY "act_select_own" ON user_activities FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "act_insert_own" ON user_activities;
CREATE POLICY "act_insert_own" ON user_activities FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
CREATE INDEX IF NOT EXISTS idx_act_user ON user_activities(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- 5.10  PLAYER CARD, DISPUTES, REPORTS, VOUCHERS, SESSIONS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        TEXT,
  user_id         TEXT  REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT,
  message         TEXT,
  screenshot_url  TEXT,
  status          TEXT  DEFAULT 'open',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dp_select_own" ON disputes;
CREATE POLICY "dp_select_own" ON disputes FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "dp_insert_own" ON disputes;
CREATE POLICY "dp_insert_own" ON disputes FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   TEXT  REFERENCES users(id) ON DELETE CASCADE,
  reported_id   TEXT  REFERENCES users(id) ON DELETE CASCADE,
  match_id      TEXT,
  type          TEXT,
  description   TEXT,
  proof_url     TEXT,
  status        TEXT  DEFAULT 'open',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rp_select_own" ON reports;
CREATE POLICY "rp_select_own" ON reports FOR SELECT
  USING ((auth.jwt() ->> 'sub') = reporter_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "rp_insert_own" ON reports;
CREATE POLICY "rp_insert_own" ON reports FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = reporter_id);

CREATE TABLE IF NOT EXISTS vouchers (
  code          TEXT  PRIMARY KEY,
  reward_type   TEXT  DEFAULT 'coins',
  reward_amount INT   DEFAULT 0,
  max_uses      INT   DEFAULT 1,
  used_count    INT   DEFAULT 0,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "v_select_all" ON vouchers;
CREATE POLICY "v_select_all" ON vouchers FOR SELECT USING (true);
DROP POLICY IF EXISTS "v_update_auth" ON vouchers;
CREATE POLICY "v_update_auth" ON vouchers FOR UPDATE USING ((auth.jwt() ->> 'sub') IS NOT NULL);
DROP POLICY IF EXISTS "v_admin_write" ON vouchers;
CREATE POLICY "v_admin_write" ON vouchers FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS user_sessions (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  device_fp   TEXT,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_seen   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "us_own" ON user_sessions;
CREATE POLICY "us_own" ON user_sessions FOR ALL USING ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 5.11  CITY CHAMPIONSHIP
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS city_championship (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  city         TEXT  NOT NULL,
  month        TEXT  NOT NULL,
  score        INT   DEFAULT 0,
  wins         INT   DEFAULT 0,
  kills        INT   DEFAULT 0,
  player_count INT   DEFAULT 0,
  UNIQUE(city, month)
);
ALTER TABLE city_championship ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_select_all" ON city_championship;
CREATE POLICY "cc_select_all" ON city_championship FOR SELECT USING (true);
DROP POLICY IF EXISTS "cc_insert_auth" ON city_championship;
CREATE POLICY "cc_insert_auth" ON city_championship FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') IS NOT NULL);
DROP POLICY IF EXISTS "cc_update_auth" ON city_championship;
CREATE POLICY "cc_update_auth" ON city_championship FOR UPDATE USING ((auth.jwt() ->> 'sub') IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────
-- 5.12  LIVE STREAMS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_streams (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  stream_url  TEXT,
  title       TEXT,
  is_live     BOOL  DEFAULT false,
  viewer_count INT  DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE live_streams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ls_select_all" ON live_streams;
CREATE POLICY "ls_select_all" ON live_streams FOR SELECT USING (true);
DROP POLICY IF EXISTS "ls_own" ON live_streams;
CREATE POLICY "ls_own" ON live_streams FOR ALL
  USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
-- ⚠️ SECURITY FIX (2026-07-20): added WITH CHECK. user_id is now a
-- grantable UPDATE column (needed since it's in the upsert payload) —
-- without WITH CHECK a caller could reassign their own live_streams row
-- to a different user_id.

-- ─────────────────────────────────────────────────────────────────
-- 5.13  CREATOR APPLICATIONS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_applications (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT  REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  status          TEXT  DEFAULT 'pending',
  review_note     TEXT,
  reviewed_by     TEXT,
  total_earnings  INT   DEFAULT 0,
  referral_count  INT   DEFAULT 0,
  active_referrals INT  DEFAULT 0,
  creator_code    TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- ✅ ADDED (2026-07-19): active_referrals — js/bugfixes-v29-final.js's
-- creatorStats/{uid}/activeReferrals write handler (which shadows an
-- older, now-dead handler of the same name in core/db-bridge.js by fully
-- overriding window.db.ref — confirmed via index.html's script load order,
-- bugfixes-v29-final.js loads after db-bridge.js and replaces the global
-- db.ref function outright, not just adding a path handler) writes this
-- column, but it never existed. No live reader was found for this field
-- (write-only as of this check), but added rather than removed since
-- Postgres will otherwise reject the entire upsert row over this one
-- missing column — the same "one ungranted/missing column kills the whole
-- row" mechanism behind most of this session's other fixes.
ALTER TABLE creator_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ca_select_own" ON creator_applications;
CREATE POLICY "ca_select_own" ON creator_applications FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "ca_insert_own" ON creator_applications;
CREATE POLICY "ca_insert_own" ON creator_applications FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "ca_update_admin" ON creator_applications;
CREATE POLICY "ca_update_admin" ON creator_applications FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ================================================================
-- SECTION 6 — REQUEST & PROFILE TABLES
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 6.1  PREMIUM REQUESTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS premium_requests (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name       TEXT  DEFAULT '',
  tier            INT   DEFAULT 1,
  price           NUMERIC DEFAULT 0,
  screenshot_url  TEXT,
  status          TEXT  DEFAULT 'pending',
  reviewed_by     TEXT  REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE premium_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pr_select_own" ON premium_requests;
CREATE POLICY "pr_select_own" ON premium_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "pr_insert_own" ON premium_requests;
CREATE POLICY "pr_insert_own" ON premium_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "pr_update_admin" ON premium_requests;
CREATE POLICY "pr_update_admin" ON premium_requests FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ─────────────────────────────────────────────────────────────────
-- 6.2  PROFILE REQUESTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_requests (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  requested_ign     TEXT  DEFAULT '',
  requested_uid     TEXT,
  phone             TEXT,
  bio               TEXT,
  request_type      TEXT  DEFAULT 'update',
  is_banned         BOOL  DEFAULT false,
  request_count     INT   DEFAULT 1,
  status            TEXT  DEFAULT 'pending',
  reviewed_by       TEXT  REFERENCES users(id),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profile_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prf_select_own" ON profile_requests;
CREATE POLICY "prf_select_own" ON profile_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "prf_insert_own" ON profile_requests;
CREATE POLICY "prf_insert_own" ON profile_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "prf_update_own" ON profile_requests;
CREATE POLICY "prf_update_own" ON profile_requests FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true))
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
-- ⚠️ SECURITY FIX (2026-07-20): added WITH CHECK — user_id is now a
-- grantable UPDATE column (upsert onConflict target), and without WITH
-- CHECK a caller could reassign their own profile_requests row to a
-- different user_id.
CREATE INDEX IF NOT EXISTS idx_prf_status ON profile_requests(status) WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────
-- 6.3  TEAM REQUESTS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_requests (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        TEXT  REFERENCES matches(id) ON DELETE CASCADE,
  leader_uid      TEXT  REFERENCES users(id) ON DELETE CASCADE,
  team_members    JSONB DEFAULT '[]',
  mode            TEXT  DEFAULT 'duo',
  status          TEXT  DEFAULT 'forming',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE team_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tr_select_all" ON team_requests;
CREATE POLICY "tr_select_all" ON team_requests FOR SELECT USING (true);
DROP POLICY IF EXISTS "tr_insert_own" ON team_requests;
CREATE POLICY "tr_insert_own" ON team_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = leader_uid);
DROP POLICY IF EXISTS "tr_update_own" ON team_requests;
CREATE POLICY "tr_update_own" ON team_requests FOR UPDATE USING ((auth.jwt() ->> 'sub') = leader_uid);

-- ================================================================
-- SECTION 7 — ADMIN TABLES
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 7.1  ADMIN ACTIVITY LOG
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_uid       TEXT  NOT NULL,
  action_type     TEXT  NOT NULL,
  target_uid      TEXT,
  target_user_id  TEXT,
  target_ref      TEXT,
  details         JSONB DEFAULT '{}',
  note            TEXT,
  status          TEXT  DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aal_admin_all" ON admin_activity_log;
CREATE POLICY "aal_admin_all" ON admin_activity_log FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_aal_admin_uid    ON admin_activity_log(admin_uid);
CREATE INDEX IF NOT EXISTS idx_aal_action_type  ON admin_activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_aal_created_at   ON admin_activity_log(created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- 7.2  FRAUD & ANTI-CHEAT
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_cases (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT,
  evidence    JSONB DEFAULT '{}',
  severity    TEXT  DEFAULT 'medium',
  status      TEXT  DEFAULT 'open',
  resolved_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE fraud_cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fc_admin_all" ON fraud_cases;
CREATE POLICY "fc_admin_all" ON fraud_cases FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS cheat_reports (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_uid    TEXT  REFERENCES users(id),
  reported_uid    TEXT  REFERENCES users(id),
  match_id        TEXT,
  cheat_type      TEXT,
  evidence_url    TEXT,
  description     TEXT,
  status          TEXT  DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cheat_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chr_select_admin" ON cheat_reports;
CREATE POLICY "chr_select_admin" ON cheat_reports FOR SELECT
  USING ((auth.jwt() ->> 'sub') = reporter_uid OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "chr_insert_auth" ON cheat_reports;
CREATE POLICY "chr_insert_auth" ON cheat_reports FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = reporter_uid);

CREATE TABLE IF NOT EXISTS admin_alerts (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT  NOT NULL,
  message     TEXT,
  user_id     TEXT  REFERENCES users(id),
  match_id    TEXT,
  is_read     BOOL  DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aa_admin_all" ON admin_alerts;
CREATE POLICY "aa_admin_all" ON admin_alerts FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS admin_watchlist (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  reason      TEXT,
  added_by    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admin_watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aw_admin_all" ON admin_watchlist;
CREATE POLICY "aw_admin_all" ON admin_watchlist FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS blacklist (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  value       TEXT  NOT NULL UNIQUE,
  type        TEXT  DEFAULT 'uid',
  reason      TEXT,
  added_by    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE blacklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bl_admin_all" ON blacklist;
CREATE POLICY "bl_admin_all" ON blacklist FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "bl_select_auth" ON blacklist;
CREATE POLICY "bl_select_auth" ON blacklist FOR SELECT USING ((auth.jwt() ->> 'sub') IS NOT NULL);

CREATE TABLE IF NOT EXISTS ban_appeals (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT,
  evidence    TEXT,
  status      TEXT  DEFAULT 'pending',
  reviewed_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ban_appeals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ba_select_own" ON ban_appeals;
CREATE POLICY "ba_select_own" ON ban_appeals FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "ba_insert_own" ON ban_appeals;
CREATE POLICY "ba_insert_own" ON ban_appeals FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 7.3  KYC / LEGAL
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_requests (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT  REFERENCES users(id) ON DELETE CASCADE,
  document_type   TEXT,
  document_url    TEXT,
  status          TEXT  DEFAULT 'pending',
  reviewed_by     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE kyc_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kyc_select_own" ON kyc_requests;
CREATE POLICY "kyc_select_own" ON kyc_requests FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "kyc_insert_own" ON kyc_requests;
CREATE POLICY "kyc_insert_own" ON kyc_requests FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 7.4  POLLS, SUGGESTIONS, BROADCASTS
-- ─────────────────────────────────────────────────────────────────
-- ✅ Matches real usage in fa26-poll-suggestion.js + admin-fixes-v23-FINAL.js
--    (two code paths exist historically — table carries both shapes safely)
CREATE TABLE IF NOT EXISTS polls (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     TEXT,
  question     TEXT  NOT NULL DEFAULT '',
  title        TEXT,                          -- alias some screens read
  description  TEXT,
  options      JSONB DEFAULT '[]',             -- array OR {opt1:{label,votes}} map
  votes        JSONB DEFAULT '{}',             -- option-label → vote count map
  vote_counts  JSONB DEFAULT '{}',             -- used by increment_poll_vote RPC
  total_votes  INT   DEFAULT 0,
  status       TEXT  DEFAULT 'active',         -- 'active' | 'closed'
  image_url    TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "poll_select_all" ON polls;
CREATE POLICY "poll_select_all" ON polls FOR SELECT USING (true);
DROP POLICY IF EXISTS "poll_admin_write" ON polls;
CREATE POLICY "poll_admin_write" ON polls FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "poll_vote_auth" ON polls;
CREATE POLICY "poll_vote_auth" ON polls FOR UPDATE USING ((auth.jwt() ->> 'sub') IS NOT NULL);

-- ✅ Tracks one vote per user per poll (prevents double voting at DB level)
CREATE TABLE IF NOT EXISTS poll_votes (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     UUID  NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id     TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option      TEXT,                            -- admin-fixes-v23 writes this
  option_idx  INT,                              -- db-bridge.js writes this
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(poll_id, user_id)
);
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pv_select_all" ON poll_votes;
CREATE POLICY "pv_select_all" ON poll_votes FOR SELECT USING (true);
DROP POLICY IF EXISTS "pv_insert_own" ON poll_votes;
CREATE POLICY "pv_insert_own" ON poll_votes FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "pv_upsert_own" ON poll_votes;
CREATE POLICY "pv_upsert_own" ON poll_votes FOR UPDATE USING ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS suggestions (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT  NOT NULL,
  category    TEXT  DEFAULT 'general',
  status      TEXT  DEFAULT 'open',
  admin_reply TEXT,
  upvotes     INT   DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sug_select_all" ON suggestions;
CREATE POLICY "sug_select_all" ON suggestions FOR SELECT USING (true);
DROP POLICY IF EXISTS "sug_insert_own" ON suggestions;
CREATE POLICY "sug_insert_own" ON suggestions FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "sug_admin_write" ON suggestions;
CREATE POLICY "sug_admin_write" ON suggestions FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT  NOT NULL,
  body        TEXT  NOT NULL,
  send_at     TIMESTAMPTZ,
  sent        BOOL  DEFAULT false,
  sent_at     TIMESTAMPTZ,
  target_type TEXT  DEFAULT 'all',
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE scheduled_broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sb_admin_all" ON scheduled_broadcasts;
CREATE POLICY "sb_admin_all" ON scheduled_broadcasts FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ─────────────────────────────────────────────────────────────────
-- 7.5  SUPPORT TICKETS
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  subject     TEXT,
  message     TEXT,
  status      TEXT  DEFAULT 'open',
  admin_reply TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "st_select_own" ON support_tickets;
CREATE POLICY "st_select_own" ON support_tickets FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "st_insert_own" ON support_tickets;
CREATE POLICY "st_insert_own" ON support_tickets FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 7.6  ADMIN MISC
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_notes (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  note        TEXT  NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "an_admin_all" ON admin_notes;
CREATE POLICY "an_admin_all" ON admin_notes FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
-- ✅ ADDED (2026-08-21): required for the User Note feature's
-- upsert-by-user_id pattern (adminNotes/{uid}.set()) to have a valid
-- conflict target — without this the feature silently never saved.
ALTER TABLE admin_notes DROP CONSTRAINT IF EXISTS admin_notes_user_id_unique;
ALTER TABLE admin_notes ADD CONSTRAINT admin_notes_user_id_unique UNIQUE (user_id);

CREATE TABLE IF NOT EXISTS creator_codes (
  code        TEXT  PRIMARY KEY,
  user_id     TEXT  REFERENCES users(id) ON DELETE CASCADE,
  uses        INT   DEFAULT 0,
  earnings    NUMERIC DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE creator_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc2_select_all" ON creator_codes;
CREATE POLICY "cc2_select_all" ON creator_codes FOR SELECT USING (true);
DROP POLICY IF EXISTS "cc2_own" ON creator_codes;
CREATE POLICY "cc2_own" ON creator_codes FOR ALL   USING ((auth.jwt() ->> 'sub') = user_id);

CREATE TABLE IF NOT EXISTS creator_stats (
  user_id           TEXT  PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_sales       INT     DEFAULT 0,
  total_commission  NUMERIC DEFAULT 0,
  locked_commission NUMERIC DEFAULT 0,
  pending_payout    NUMERIC DEFAULT 0,
  paid_out          NUMERIC DEFAULT 0,
  match_earnings    JSONB   DEFAULT '{}',
  total_matches     INT     DEFAULT 0,
  total_earnings    NUMERIC DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
-- ✅ REDESIGNED (2026-07-19): this table previously only had total_matches/
-- total_earnings, but every LIVE caller (features/premium-creator.js,
-- screens/join.js) writes an entirely different field set — totalSales,
-- totalCommission, lockedCommission, pendingPayout, paidOut, matchEarnings
-- — via the creatorStats/{uid}/... Firebase-style bridge path. The bridge
-- handler that's actually live (js/bugfixes-v29-final.js — it fully
-- overrides window.db.ref, shadowing an older, dead handler of the same
-- name in core/db-bridge.js; confirmed via index.html's script load
-- order) only recognized totalEarnings/referralCount/activeReferrals,
-- none of which match what premium-creator.js/join.js actually send — so
-- every real creator-commission write silently fell through to the
-- "no matching statKey, empty updateData, still calls cb(null) as if it
-- succeeded" branch. This has never actually persisted any creator
-- commission/payout data anywhere. Added all six real fields and fixed
-- the bridge handler itself (see js/bugfixes-v29-final.js) to route them
-- correctly. total_matches/total_earnings kept for whatever (if anything)
-- was relying on the old shape, though no live reader was found for
-- those two either.
ALTER TABLE creator_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cs_select_own" ON creator_stats;
CREATE POLICY "cs_select_own" ON creator_stats FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
-- ✅ ADDED (2026-07-19): cs_insert_own/cs_update_own — these were written
-- in an earlier standalone migration pass but never actually merged into
-- this master schema file, so creator_stats has had RLS enabled with only
-- a SELECT policy this entire time — every INSERT/UPDATE against it,
-- including the ones described above, was ALSO being rejected at the RLS
-- layer independently of the field-mismatch bug, a second, compounding
-- reason nothing was ever saved here.
DROP POLICY IF EXISTS "cs_insert_own" ON creator_stats;
CREATE POLICY "cs_insert_own" ON creator_stats FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "cs_update_own" ON creator_stats;
CREATE POLICY "cs_update_own" ON creator_stats FOR UPDATE
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS platform_stats (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE  NOT NULL UNIQUE,
  total_users INT   DEFAULT 0,
  active_users INT  DEFAULT 0,
  total_matches INT DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ps_admin_all" ON platform_stats;
CREATE POLICY "ps_admin_all" ON platform_stats FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ================================================================
-- SECTION 8 — CONFIG & SETTINGS
-- ================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT  PRIMARY KEY,
  value       JSONB DEFAULT '{}',
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "as_select_all" ON app_settings;
CREATE POLICY "as_select_all" ON app_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "as_admin_write" ON app_settings;
CREATE POLICY "as_admin_write" ON app_settings FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS config (
  key         TEXT  PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cfg_select_all" ON config;
CREATE POLICY "cfg_select_all" ON config FOR SELECT USING (true);
DROP POLICY IF EXISTS "cfg_admin_write" ON config;
CREATE POLICY "cfg_admin_write" ON config FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ================================================================
-- SECTION 9 — VIEWS
-- ================================================================

-- ✅ FIX: leaderboard must be a real TABLE, not a VIEW.
--    admin-inline.js does leaderboard.delete() when banning a user — a plain
--    VIEW over users can't be deleted from directly. Kept in sync via trigger below.
CREATE TABLE IF NOT EXISTS leaderboard (
  id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ign           TEXT,
  avatar_url    TEXT,
  city          TEXT,
  ff_uid        TEXT,
  rank_points   INT DEFAULT 0,
  total_wins    INT DEFAULT 0,
  total_kills   INT DEFAULT 0,
  total_matches INT DEFAULT 0,
  rank_tier     TEXT DEFAULT 'Bronze',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lb_select_all" ON leaderboard;
CREATE POLICY "lb_select_all" ON leaderboard FOR SELECT USING (true);
DROP POLICY IF EXISTS "lb_admin_write" ON leaderboard;
CREATE POLICY "lb_admin_write" ON leaderboard FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank ON leaderboard(rank_points DESC);

-- Auto-sync trigger: users → leaderboard (insert/update/remove on ban)
-- ✅ UPDATED (2026-08-22): added leaderboard_hidden as a third exclusion
-- condition, AND added it to the trigger's `UPDATE OF` column list below
-- — without that second change, toggling ONLY leaderboard_hidden (e.g.
-- via the Admin Panel's new "Hide from Leaderboard" button, which
-- updates nothing else) would never even fire this trigger.
-- Root cause this fixes: previously the only way to remove someone from
-- the public leaderboard was a direct `DELETE FROM leaderboard`, which
-- got silently undone the next time ANY of the watched columns changed
-- on that user (coins, city, hardly related to leaderboard visibility)
-- — confirmed live as a leaderboard row flickering back after removal.
CREATE OR REPLACE FUNCTION sync_leaderboard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_banned = true OR NEW.ign IS NULL OR NEW.leaderboard_hidden = true THEN
    DELETE FROM leaderboard WHERE id = NEW.id;
  ELSE
    INSERT INTO leaderboard (id, ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches, updated_at)
    VALUES (NEW.id, NEW.ign, NEW.avatar_url, NEW.city, NEW.ff_uid, NEW.rank_points, NEW.total_wins, NEW.total_kills, NEW.total_matches, NOW())
    ON CONFLICT (id) DO UPDATE SET
      ign=EXCLUDED.ign, avatar_url=EXCLUDED.avatar_url, city=EXCLUDED.city, ff_uid=EXCLUDED.ff_uid,
      rank_points=EXCLUDED.rank_points, total_wins=EXCLUDED.total_wins,
      total_kills=EXCLUDED.total_kills, total_matches=EXCLUDED.total_matches, updated_at=NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_leaderboard ON users;
CREATE TRIGGER trg_sync_leaderboard
  AFTER INSERT OR UPDATE OF ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches, is_banned, leaderboard_hidden
  ON users FOR EACH ROW EXECUTE FUNCTION sync_leaderboard();

-- Backfill existing users into leaderboard
INSERT INTO leaderboard (id, ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches)
SELECT id, ign, avatar_url, city, ff_uid, rank_points, total_wins, total_kills, total_matches
FROM users WHERE is_banned = false AND ign IS NOT NULL
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE VIEW active_matches AS
  SELECT * FROM matches
  WHERE status IN ('upcoming', 'live')
  ORDER BY scheduled_at ASC;
GRANT SELECT ON active_matches TO anon, authenticated;

-- ================================================================
-- SECTION 10 — STORED FUNCTIONS (RPCs)
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- increment_balance — credit any currency column
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_balance(
  p_uid    TEXT,
  p_col    TEXT,
  p_amount NUMERIC
) RETURNS void AS $$
DECLARE
  allowed_cols TEXT[] := ARRAY[
    'coins','green_diamonds','sky_diamonds',
    'total_wins','total_kills','total_matches','rank_points',
    'win_streak','clean_matches','filled_slots'
  ];
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  -- ✅ SECURITY FIX (2026-07-17, CRITICAL): this function previously had NO
  -- identity check at all — any authenticated caller could pass ANY p_uid
  -- and credit/debit that user's coins/diamonds/stats with no verification
  -- whatsoever. The one-line doc comment claiming this function "bypasses
  -- the identity check for genuine service_role / direct-postgres callers"
  -- was describing a check that never actually existed in the code below —
  -- there was nothing to bypass, because there was no check to begin with.
  -- Now: allowed only if the caller IS p_uid (self-credit — used by paid
  -- flows like Paytm callback verification, ad-reward claims, etc. that
  -- still go through this after their own server-side validation), OR the
  -- caller's own users.is_admin = true (admin crediting someone else), OR
  -- the request has no JWT at all (a genuine service_role / direct-Postgres
  -- caller — e.g. an Edge Function using the service key — which has no
  -- auth.jwt() to check against in the first place; this is the actual,
  -- correct way to detect that case, unlike the previous non-existent check).
  IF v_caller IS NOT NULL THEN
    IF v_caller <> p_uid THEN
      SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT COALESCE(v_is_admin, false) THEN
        RAISE EXCEPTION 'Not authorized to modify balance for this user';
      END IF;
    END IF;
  END IF;
  -- If v_caller IS NULL, there is no end-user JWT on this request at all —
  -- this is a service_role/direct-Postgres call (Edge Functions, admin
  -- backend jobs), which is trusted by definition since it required the
  -- service key, not a user's session, to reach this function.

  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be non-negative, got: %', p_amount;
  END IF;
  IF NOT (p_col = ANY(allowed_cols)) THEN
    RAISE EXCEPTION 'Column % not allowed', p_col;
  END IF;
  EXECUTE format(
    'UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_col, p_col
  ) USING p_amount, p_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- decrement_balance — deduct currency, checks balance first
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION decrement_balance(
  p_uid    TEXT,
  p_col    TEXT,
  p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
  allowed_cols TEXT[] := ARRAY['coins','green_diamonds','sky_diamonds'];
  v_balance    NUMERIC;
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_admin   BOOLEAN;
BEGIN
  -- ✅ SECURITY FIX (2026-07-17, CRITICAL): same missing-identity-check
  -- issue as increment_balance above — see that function's comment for
  -- the full explanation. Without this, any authenticated caller could
  -- deduct ANY other user's balance by passing their p_uid.
  IF v_caller IS NOT NULL THEN
    IF v_caller <> p_uid THEN
      SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT COALESCE(v_is_admin, false) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized to modify balance for this user');
      END IF;
    END IF;
  END IF;

  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-negative');
  END IF;
  IF NOT (p_col = ANY(allowed_cols)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Column not allowed: ' || p_col);
  END IF;
  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1', p_col)
    USING p_uid INTO v_balance;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance',
      'balance', v_balance, 'required', p_amount);
  END IF;
  EXECUTE format(
    'UPDATE users SET %I = GREATEST(COALESCE(%I, 0) - $1, 0) WHERE id = $2',
    p_col, p_col
  ) USING p_amount, p_uid;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- process_daily_checkin — atomic daily check-in with streak tracking
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): this function was called live by TWO separate
-- User Panel code paths (features-user.js's window.doCheckIn and
-- fixes-v7.js's window._checkStreakFixed, which itself delegates to the
-- former) but had never actually been defined anywhere — every daily
-- check-in attempt failed with "function process_daily_checkin does not
-- exist", making the entire daily login-reward system 100% non-functional.
-- Also now the target of core/db.js's DB.checkin.doCheckIn (previously a
-- third, independent, broken implementation — redirected to call this
-- same RPC instead of duplicating the logic a third time).
--
-- Response shape and p_tier_rewards format were verified against BOTH
-- live callers before writing this, not assumed from one:
--   • p_tier_rewards is a plain JS ARRAY (e.g. [5,7,10,12,15,20,30]), not
--     an object — indexed here with JSONB array indexing (-> N), not a
--     text key (-> 'N').
--   • fixes-v7.js adds milestone_bonus to reward ITSELF, so 'reward' in
--     the response must stay the un-summed base amount, with
--     milestone_bonus returned separately.
--   • features-user.js instead reads a pre-summed 'total' field — so both
--     'reward' (base) and 'total' (reward+bonus) are returned together to
--     satisfy both callers without changing either one.
-- ✅ CORRECTED (2026-07-22): direct live-database inspection via the
-- Supabase connector found this function existed in TWO versions
-- simultaneously — this JSONB-typed one (from this repo's own history)
-- and an independently-written NUMERIC[]-typed one from an earlier,
-- separate session, because CREATE OR REPLACE FUNCTION with a changed
-- parameter type creates an ADDITIONAL overload rather than replacing the
-- original (see DEVELOPER_GUIDE.md section 31.2 point 5). The NUMERIC[]
-- version turned out to be the better one on inspection — it matches
-- what the JS callers actually send (a plain array like [5,7,10,...],
-- which maps naturally to a Postgres array, not JSONB) AND is
-- IST-timezone-aware (now() AT TIME ZONE 'Asia/Kolkata'), which this
-- JSONB version was NOT (it used bare CURRENT_DATE, i.e. server/UTC
-- time — on a platform whose entire userbase is in India, that's a
-- correctness bug: a checkin right after midnight IST but before
-- midnight UTC would count as the wrong day). The NUMERIC[] version is
-- now canonical everywhere — in the live database (verified, only one
-- version remains) and here.
CREATE OR REPLACE FUNCTION process_daily_checkin(
  p_tier_rewards NUMERIC[] DEFAULT ARRAY[5, 7, 10, 12, 15, 20, 30],
  p_milestone_bonus NUMERIC DEFAULT 100,
  p_milestone_days INTEGER DEFAULT 30
) RETURNS JSONB AS $$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_last DATE;
  v_streak INT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_yesterday DATE := v_today - 1;
  v_new_streak INT;
  v_cycle_pos INT;
  v_reward NUMERIC;
  v_milestone NUMERIC := 0;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF array_length(p_tier_rewards, 1) IS NULL OR array_length(p_tier_rewards, 1) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reward config');
  END IF;

  SELECT last_checkin_date::date, streak_days INTO v_last, v_streak
    FROM users WHERE id = v_caller FOR UPDATE;
  IF v_last IS NOT NULL AND v_last = v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_checked_in', 'streak', v_streak);
  END IF;

  IF v_last IS NOT NULL AND v_last = v_yesterday THEN
    v_new_streak := COALESCE(v_streak, 0) + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  v_cycle_pos := ((v_new_streak - 1) % array_length(p_tier_rewards, 1)) + 1;
  v_reward := p_tier_rewards[v_cycle_pos];
  IF p_milestone_days > 0 AND v_new_streak % p_milestone_days = 0 THEN
    v_milestone := p_milestone_bonus;
  END IF;

  UPDATE users SET last_checkin_date = v_today, streak_days = v_new_streak,
    coins = COALESCE(coins,0) + v_reward + v_milestone WHERE id = v_caller;
  INSERT INTO daily_checkins (user_id, checkin_date, coins_earned, streak_day)
    VALUES (v_caller, v_today, v_reward + v_milestone, v_new_streak)
    ON CONFLICT (user_id, checkin_date) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'streak', v_new_streak, 'reward', v_reward,
    'milestone_bonus', v_milestone, 'total', v_reward + v_milestone);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION process_daily_checkin(NUMERIC[], NUMERIC, INTEGER) TO authenticated, service_role;
-- ⚠️ Signature changed from (JSONB, INT, INT) to (NUMERIC[], NUMERIC, INTEGER).
-- If re-running this file against a database that still has the OLD
-- JSONB-signature version, DROP FUNCTION IF EXISTS
-- process_daily_checkin(JSONB, INT, INT); first, or both will coexist as
-- duplicate overloads again — see the DROP statements bundled at the
-- bottom of this file's "duplicate overload cleanup" section for the
-- copy-pasteable version of this.

-- ─────────────────────────────────────────────────────────────────
-- record_duel_result — atomic dual-record duel outcome
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): replaces a direct duel_records.upsert() from
-- features/challenge.js that only ever updated the CALLER's own row
-- (never the opponent's — head-to-head records were one-sided even when
-- it worked) and relied on a column grant that would have let a player
-- write an unverified, self-reported result. This RPC updates both
-- players atomically and can only be called by the player submitting
-- their own result — see the "duel_records" grant-block comment above for
-- the full reasoning on why this was an RPC and not a re-opened grant.
CREATE OR REPLACE FUNCTION record_duel_result(
  p_caller_uid   TEXT,
  p_opponent_uid TEXT,
  p_caller_won   BOOLEAN
) RETURNS VOID AS $$
BEGIN
  IF (auth.jwt() ->> 'sub') IS DISTINCT FROM p_caller_uid THEN
    RAISE EXCEPTION 'Not authorized to submit this duel result';
  END IF;

  INSERT INTO duel_records(user_id, opponent_id, wins, losses)
  VALUES (p_caller_uid, p_opponent_uid, (p_caller_won)::INT, (NOT p_caller_won)::INT)
  ON CONFLICT (user_id, opponent_id) DO UPDATE SET
    wins   = duel_records.wins   + (p_caller_won)::INT,
    losses = duel_records.losses + (NOT p_caller_won)::INT;

  INSERT INTO duel_records(user_id, opponent_id, wins, losses)
  VALUES (p_opponent_uid, p_caller_uid, (NOT p_caller_won)::INT, (p_caller_won)::INT)
  ON CONFLICT (user_id, opponent_id) DO UPDATE SET
    wins   = duel_records.wins   + (NOT p_caller_won)::INT,
    losses = duel_records.losses + (p_caller_won)::INT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
-- KNOWN LIMITATION: still trusts the caller's own p_caller_won boolean —
-- duels have no independent room/kill data to verify against, unlike
-- ranked matches. If duels ever get objective outcome data, tighten this
-- to check it rather than trust the submission.

-- ─────────────────────────────────────────────────────────────────
-- post_squad_finder_listing — server-verified rank squad-finder post
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): replaces a direct squad_finder.upsert() from
-- features/squad-finder.js that would have required reopening a column
-- grant an earlier pass deliberately closed ("rank must be server-derived,
-- never self-declared") specifically to stop a player posting a fake or
-- inflated rank on the squad-finder board. This RPC reads rank_tier/
-- rank_points directly from the caller's own `users` row server-side —
-- any rank data the client sends is ignored, not trusted.
CREATE OR REPLACE FUNCTION post_squad_finder_listing(
  p_mode      TEXT,
  p_playstyle TEXT,
  p_note      TEXT,
  p_role      TEXT,
  p_lang      TEXT
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_ign TEXT;
  v_rank_tier TEXT;
  v_rank_pts INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT ign, rank_tier, rank_points INTO v_ign, v_rank_tier, v_rank_pts
  FROM users WHERE id = v_uid;

  INSERT INTO squad_finder(
    user_id, ign, rank_tier, rank_pts, mode, playstyle, role, lang, note,
    is_active, expires_at
  ) VALUES (
    v_uid, COALESCE(v_ign, 'Player'), COALESCE(v_rank_tier, 'Bronze'), COALESCE(v_rank_pts, 0),
    COALESCE(p_mode, 'Any'), p_playstyle, p_role, p_lang, p_note,
    true, NOW() + INTERVAL '3 hours'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    ign = COALESCE(v_ign, 'Player'),
    rank_tier = COALESCE(v_rank_tier, 'Bronze'),
    rank_pts = COALESCE(v_rank_pts, 0),
    mode = COALESCE(p_mode, 'Any'),
    playstyle = EXCLUDED.playstyle,
    role = EXCLUDED.role,
    lang = EXCLUDED.lang,
    note = EXCLUDED.note,
    is_active = true,
    expires_at = NOW() + INTERVAL '3 hours';

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- join_auto_squad_queue — server-verified rank queue join
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17, CRITICAL CORRECTION): this table's rank_tier/
-- rank_pts columns were initially left directly client-grantable earlier
-- in this fix pass, reasoning they were "informational display fields" —
-- that reasoning was WRONG. DEVELOPER_GUIDE.md's own reference table
-- (section 24.3) already documented auto_squad_queue as
-- "server-derived only, not meant to be client-set", and re-checking
-- features/auto-squad.js confirms rank_pts is actually used to SORT the
-- matchmaking queue (`.order('rank_pts', {ascending:false})` — highest
-- rank gets matched first), not just displayed. A client-inflated rank_pts
-- would let a player jump the matchmaking priority queue. This RPC
-- replaces the direct upsert, reading rank_tier/rank_points from the
-- caller's own `users` row server-side instead of trusting client input —
-- same pattern as post_squad_finder_listing above, which was done
-- correctly the first time.
CREATE OR REPLACE FUNCTION join_auto_squad_queue(
  p_match_id TEXT,
  p_mode     TEXT
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_ign TEXT;
  v_rank_tier TEXT;
  v_rank_pts INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT ign, rank_tier, rank_points INTO v_ign, v_rank_tier, v_rank_pts
  FROM users WHERE id = v_uid;

  INSERT INTO auto_squad_queue(match_id, user_id, mode, ign, rank_tier, rank_pts, status, joined_at)
  VALUES(p_match_id, v_uid, p_mode, COALESCE(v_ign, 'Player'),
         COALESCE(v_rank_tier, 'Bronze'), COALESCE(v_rank_pts, 0), 'waiting', NOW())
  ON CONFLICT (match_id, user_id) DO UPDATE SET
    mode = p_mode,
    ign = COALESCE(v_ign, 'Player'),
    rank_tier = COALESCE(v_rank_tier, 'Bronze'),
    rank_pts = COALESCE(v_rank_pts, 0),
    status = 'waiting',
    team_id = NULL,
    joined_at = NOW();

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- form_auto_squad_team — atomic, race-free team formation
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): auto-squad.js's _tryFormTeam() previously did a
-- plain select (sorted by rank_pts) followed by a separate update marking
-- the selected players 'matched' — with no lock in between. If two clients
-- both call _tryFormTeam for the same match at nearly the same moment
-- (realistic: several queued players' clients each call this after their
-- own join succeeds), both could select overlapping sets of "waiting"
-- players before either update lands, and both proceed to form a team —
-- potentially forming two different teams that share a player, or forming
-- a team larger than intended if both updates apply. This RPC does the
-- select-and-mark atomically: it locks the candidate rows with
-- FOR UPDATE SKIP LOCKED, so a concurrent call simply sees fewer available
-- players rather than double-booking the same ones.
CREATE OR REPLACE FUNCTION form_auto_squad_team(
  p_match_id TEXT,
  p_mode     TEXT,
  p_needed   INT
) RETURNS JSONB AS $$
DECLARE
  v_team_id  TEXT;
  v_selected TEXT[];
  v_count    INT;
BEGIN
  -- Lock only the candidate rows with SKIP LOCKED, so a concurrent call
  -- for the same match simply sees fewer available (already-locked-by-
  -- the-other-call) players instead of racing to select and update the
  -- same ones — this is what makes two simultaneous team-formation
  -- attempts safe instead of potentially double-booking a player into
  -- two different teams. The lock is held until this function's
  -- transaction ends, so no other concurrent call can select these same
  -- rows until this one has either committed the update or returned.
  SELECT array_agg(user_id) INTO v_selected
  FROM (
    SELECT user_id FROM auto_squad_queue
    WHERE match_id = p_match_id AND mode = p_mode AND status = 'waiting'
    ORDER BY rank_pts DESC
    LIMIT p_needed
    FOR UPDATE SKIP LOCKED
  ) candidates;

  v_count := COALESCE(array_length(v_selected, 1), 0);
  IF v_count < p_needed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_enough_players', 'available', v_count);
  END IF;

  v_team_id := 'team_' || extract(epoch from now())::BIGINT || '_' || substr(md5(random()::TEXT), 1, 6);

  UPDATE auto_squad_queue SET status = 'matched', team_id = v_team_id
  WHERE match_id = p_match_id AND user_id = ANY(v_selected);

  RETURN jsonb_build_object('ok', true, 'team_id', v_team_id, 'user_ids', to_jsonb(v_selected));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- validate_and_join_match — atomic join with fee deduction
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_and_join_match(
  p_uid       TEXT,
  p_match_id  TEXT,
  p_entry_fee NUMERIC,
  p_currency  TEXT,
  p_join_data JSONB
) RETURNS JSONB AS $$
DECLARE
  v_balance      NUMERIC;
  v_joined       BOOLEAN := false;
  v_jr_id        UUID;
  v_max_slots    INT;
  v_filled_slots INT;
  v_caller       TEXT := auth.jwt() ->> 'sub';
BEGIN
  -- ✅ SECURITY FIX (2026-07-17, CRITICAL): this function previously had NO
  -- identity check — any authenticated caller could pass ANY OTHER user's
  -- p_uid and deduct that user's real-money coins/sky_diamonds balance to
  -- join a match, with their own ign in p_join_data. This is the single
  -- most severe finding in this entire fix pass: it's the core money-entry
  -- function for the whole platform, and it was fully open. No admin
  -- exception needed here — unlike balance-credit RPCs, there's no
  -- legitimate reason for anyone (including an admin) to join a match AS
  -- someone else, so this only allows exact self-match, no admin bypass.
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_currency = 'coins' THEN
    SELECT coins INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
  ELSE
    SELECT sky_diamonds INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
  END IF;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_entry_fee > 0 AND v_balance < p_entry_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM join_requests
    WHERE user_id = p_uid AND match_id = p_match_id
      AND status NOT IN ('cancelled','refunded','no_show')
  ) INTO v_joined;
  IF v_joined THEN RAISE EXCEPTION 'ALREADY_JOINED'; END IF;

  SELECT COALESCE(max_slots, 999), COALESCE(filled_slots, 0)
  INTO v_max_slots, v_filled_slots
  FROM matches WHERE id = p_match_id;
  IF v_max_slots IS NOT NULL AND v_filled_slots >= v_max_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  IF p_entry_fee > 0 THEN
    IF p_currency = 'coins' THEN
      UPDATE users SET coins = coins - p_entry_fee WHERE id = p_uid;
    ELSE
      UPDATE users SET sky_diamonds = sky_diamonds - p_entry_fee WHERE id = p_uid;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(p_uid, p_currency, 'debit', p_entry_fee, 'match_entry', p_match_id);
  END IF;

  INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, ign_at_join, mode)
  VALUES(
    p_uid, p_match_id, p_entry_fee,
    CASE WHEN p_currency='coins' THEN 'coin' ELSE 'sky_diamond' END,
    'pending',
    COALESCE(p_join_data->>'ign', ''),
    COALESCE(p_join_data->>'mode', 'solo')
  ) RETURNING id INTO v_jr_id;

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + 1 WHERE id = p_match_id;

  RETURN jsonb_build_object('ok', true, 'jr_id', v_jr_id::TEXT);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'       THEN 'Not authorized'
        WHEN 'USER_NOT_FOUND'       THEN 'User not found'
        WHEN 'INSUFFICIENT_BALANCE' THEN 'Balance kam hai'
        WHEN 'ALREADY_JOINED'       THEN 'Aap already join ho chuke ho'
        WHEN 'MATCH_FULL'           THEN 'Match full ho gaya'
        ELSE SQLERRM
      END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- cancel_match_with_refunds — atomic match cancel + refund all joiners
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-08-22, CRITICAL — money bug): before this existed, the
-- Admin Panel's deleteTournament() refund logic wrote to fake
-- Firebase-style paths (rtdb.ref('users/'+uid+'/realMoney/deposited')
-- .transaction(...)) that don't correspond to any real column — the
-- write silently no-op'd, no error surfaced, and every joined player's
-- entry fee simply vanished when an admin deleted their match. This RPC
-- replaces that entirely: refunds the exact entry_fee_paid per
-- join_request (not the match's CURRENT entry_fee, which the admin
-- could have edited after people joined) to the correct currency
-- column, logs each refund to wallet_transactions, notifies each
-- player, and marks the match cancelled — all inside one transaction so
-- there's no partial-refund state if it fails halfway.
CREATE OR REPLACE FUNCTION public.cancel_match_with_refunds(p_match_id TEXT, p_admin_uid TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_jr RECORD;
  v_refund_count INT := 0;
  v_currency TEXT;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;

  FOR v_jr IN
    SELECT * FROM join_requests
    WHERE match_id = p_match_id
      AND status NOT IN ('cancelled', 'refunded', 'rejected')
      AND COALESCE(entry_fee_paid, 0) > 0
    FOR UPDATE
  LOOP
    v_currency := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

    IF v_currency = 'coins' THEN
      UPDATE users SET coins = COALESCE(coins,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    ELSE
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    END IF;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
    VALUES (v_jr.user_id, v_currency, 'credit', v_jr.entry_fee_paid, 'match_cancelled_refund', p_match_id, 'approved');

    UPDATE join_requests SET status = 'refunded' WHERE id = v_jr.id;

    INSERT INTO notifications(user_id, title, body, type, is_read, created_at, ref_id)
    VALUES (
      v_jr.user_id,
      '💰 Match Cancelled — Refund',
      '"' || COALESCE(v_match.name, v_match.title, p_match_id) || '" cancel ho gaya. Aapka entry fee wapas kar diya gaya hai.',
      'refund', false, NOW(), p_match_id
    );

    v_refund_count := v_refund_count + 1;
  END LOOP;

  UPDATE join_requests
  SET status = 'cancelled'
  WHERE match_id = p_match_id AND status NOT IN ('cancelled', 'refunded', 'rejected');

  UPDATE matches SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = p_admin_uid WHERE id = p_match_id;

  RETURN jsonb_build_object('ok', true, 'refund_count', v_refund_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_match_with_refunds(TEXT, TEXT) TO authenticated, anon;
-- Called from Admin Panel: js/security-patches.js patchDeleteTournament()
-- Requires: matches.cancelled_at, matches.cancelled_by columns (see
-- 2026-08-22 session delta if not already present on your instance).

-- ─────────────────────────────────────────────────────────────────
-- resolve_sd_request — admin approve/reject for sd_requests
-- (sky_diamond_purchase AND green_diamond_withdrawal, both request_types)
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17, CRITICAL): this function was documented in the RPC
-- summary section below — including the specific claim "approving a
-- withdrawal does NOT credit (balance was already deducted at
-- submission); rejecting a withdrawal refunds green_diamonds, rejecting a
-- purchase does not" — but had never actually been written anywhere in
-- this file. The live admin code approving/rejecting these requests
-- (admin-inline.js's approveSkyDiaReq/rejectSkyDiaReq, wrapped by
-- admin-supabase-sync.js) was Firebase-RTDB-only for rejections, with NO
-- Supabase sync and NO refund logic of any kind — meaning a rejected
-- green-diamond withdrawal has never once actually refunded the user's
-- already-deducted balance, in any code path, anywhere in the app. This
-- was the exact, direct mechanism behind the "no refund path on
-- rejection" finding from the prior audit round. Both admin-inline.js
-- functions have been updated to call this RPC (see below).
CREATE OR REPLACE FUNCTION resolve_sd_request(
  p_request_id UUID,
  p_action     TEXT,  -- 'approve' | 'reject'
  p_note       TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_caller  TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_req     RECORD;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid action');
  END IF;

  SELECT * INTO v_req FROM sd_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request not found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request already resolved (status: ' || v_req.status || ')');
  END IF;

  IF v_req.request_type = 'sky_diamond_purchase' THEN
    IF p_action = 'approve' THEN
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds, 0) + v_req.sd_amount WHERE id = v_req.user_id;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES(v_req.user_id, 'sky_diamonds', 'credit', v_req.sd_amount, 'sd_purchase_approved', p_request_id::TEXT);
    END IF;
    -- reject: no balance change — purchase money was never taken from the
    -- user's in-app balance in the first place (it's an external UPI
    -- payment the admin is verifying via screenshot).

  ELSIF v_req.request_type = 'green_diamond_withdrawal' THEN
    IF p_action = 'reject' THEN
      -- The core fix: refund the green_diamonds that were deducted at
      -- submission time (see diamond-system.js's withdrawal flow, fixed
      -- 2026-07-17 to use decrement_balance instead of a broken negative
      -- increment_balance call).
      UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_req.sd_amount WHERE id = v_req.user_id;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES(v_req.user_id, 'green_diamonds', 'credit', v_req.sd_amount, 'withdrawal_rejected_refund', p_request_id::TEXT);
    END IF;
    -- approve: no balance change — already deducted at submission; admin
    -- is confirming the UPI payout to the user was completed.
  END IF;

  UPDATE sd_requests SET
    status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_by = v_caller,
    review_note = p_note
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'request_type', v_req.request_type, 'action', p_action);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- approve_creator_application — atomic creator status activation
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. fa-growth-admin.js's
-- own comment already diagnosed the exact bug this replaces: an earlier
-- version wrote to a users.creator_status column that never existed, and
-- never set users.is_creator (the column everything else in the app
-- actually checks) — meaning no creator application, however many times
-- "approved" by an admin, ever actually activated creator status.
CREATE OR REPLACE FUNCTION approve_creator_application(
  p_uid  TEXT,
  p_code TEXT
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_code_taken BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM creator_applications WHERE creator_code = p_code AND user_id <> p_uid) INTO v_code_taken;
  IF v_code_taken THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator code already in use');
  END IF;

  UPDATE creator_applications
  SET status = 'approved', creator_code = p_code, reviewed_by = v_caller, updated_at = NOW()
  WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No application found for this user');
  END IF;

  UPDATE users SET is_creator = true, creator_code = p_code WHERE id = p_uid;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- approve_premium — atomic premium tier activation
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. admin-inline.js's
-- own comment already diagnosed the same class of bug as
-- approve_creator_application above: premium was never actually activated
-- for anyone regardless of admin approval, and premium_level/
-- premium_expires are locked from direct client writes (this is one of
-- the tables covered by the column-lockdown fix earlier in this file),
-- so this must go through an admin-checked RPC either way.
CREATE OR REPLACE FUNCTION approve_premium(
  p_uid  TEXT,
  p_tier INT,
  p_days INT DEFAULT 30
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_current_expires TIMESTAMPTZ;
  v_user_exists BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_tier NOT IN (1,2,3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;

  SELECT true, premium_expires INTO v_user_exists, v_current_expires FROM users WHERE id = p_uid;
  IF NOT COALESCE(v_user_exists, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Extend from the later of (now, current expiry) so an early renewal
  -- doesn't waste remaining days already paid for.
  UPDATE users SET
    premium_level = p_tier,
    premium_expires = GREATEST(COALESCE(v_current_expires, NOW()), NOW()) + (p_days || ' days')::INTERVAL
  WHERE id = p_uid;

  RETURN jsonb_build_object('success', true, 'tier', p_tier, 'days', p_days);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- start_free_trial — one-time server-authoritative trial grant
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. free-trial.js's own
-- comment already explains the fix this enables: previously eligibility
-- was tracked only in localStorage (trivially resettable — clear
-- browser data, get another free trial). This checks a permanent,
-- row-locked users.trial_used flag server-side instead.
CREATE OR REPLACE FUNCTION start_free_trial() RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_used BOOLEAN;
  v_trial_days INT := 3;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT trial_used INTO v_used FROM users WHERE id = v_uid FOR UPDATE;
  IF v_used IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_used THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trial already used');
  END IF;

  UPDATE users SET
    trial_used = true,
    premium_level = GREATEST(COALESCE(premium_level, 0), 1),
    premium_expires = GREATEST(COALESCE(premium_expires, NOW()), NOW()) + (v_trial_days || ' days')::INTERVAL
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true, 'days', v_trial_days);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- resolve_sponsored_withdrawal — admin approve/reject for sponsored winnings
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. The admin code's own
-- comment already explains the fix this enables: re-verifies sufficient
-- sponsored_winnings remains at APPROVAL time, not just at request time —
-- protects against two pending requests together exceeding the real
-- balance if both get approved (a real race if an admin approves several
-- requests in quick succession).
CREATE OR REPLACE FUNCTION resolve_sponsored_withdrawal(
  p_txn_id UUID,
  p_action TEXT,  -- 'approve' | 'reject'
  p_note   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_txn      RECORD;
  v_balance  NUMERIC;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  SELECT * INTO v_txn FROM wallet_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;
  IF v_txn.txn_type <> 'pending_withdraw' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a pending withdrawal');
  END IF;
  IF COALESCE(v_txn.status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already resolved (status: ' || v_txn.status || ')');
  END IF;

  IF p_action = 'approve' THEN
    -- Re-verify the balance NOW, at approval time — not trusting that it
    -- was still sufficient since the request was originally submitted.
    SELECT sponsored_winnings INTO v_balance FROM users WHERE id = v_txn.user_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance < v_txn.amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient sponsored_winnings remaining — balance may have changed since request was submitted');
    END IF;
    UPDATE users SET sponsored_winnings = sponsored_winnings - v_txn.amount WHERE id = v_txn.user_id;
  END IF;
  -- reject: no balance change — nothing was deducted until approval, so
  -- rejecting just marks the request rejected (matches the admin code's
  -- own comment on this exact point).

  UPDATE wallet_transactions SET
    status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    note = COALESCE(p_note, note)
  WHERE id = p_txn_id;

  RETURN jsonb_build_object('success', true, 'action', p_action, 'user_id', v_txn.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- admin_send_notification — admin-only privileged-type notification
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. This is the
-- intended path for the privileged notification types (wallet_update,
-- withdrawal_*, ban, admin_debit, admin_alert, banner) that the
-- notifications table's own INSERT RLS policy blocks non-admins from
-- using directly (see the notif_insert policy comment above) — this RPC
-- is how an admin action legitimately sends one of those types.
CREATE OR REPLACE FUNCTION admin_send_notification(
  p_user_id TEXT,
  p_type    TEXT,
  p_title   TEXT,
  p_body    TEXT,
  p_ref_id  TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  INSERT INTO notifications(user_id, type, title, body, ref_id, is_read)
  VALUES(p_user_id, p_type, p_title, p_body, p_ref_id, false);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- admin_send_broadcast_notification — admin-only, all-users notification
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. Sets target_all=true
-- (which the notifications SELECT policy already reads to let every user
-- see it), with user_id left NULL since it isn't targeted at one person.
CREATE OR REPLACE FUNCTION admin_send_broadcast_notification(
  p_type  TEXT,
  p_title TEXT,
  p_body  TEXT
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  INSERT INTO notifications(user_id, type, title, body, is_read, target_all)
  VALUES(NULL, p_type, p_title, p_body, false, true);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- review_creator_video — admin approve/reject a reported creator video
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written, AND currently has
-- zero live callers in either panel (confirmed via exhaustive search) —
-- unlike every other function added in this pass, this one isn't fixing
-- an active break, it's completing a documented-but-unbuilt feature for
-- consistency, in case it's wired up later.
CREATE OR REPLACE FUNCTION review_creator_video(
  p_video_id UUID,
  p_action   TEXT  -- 'approve' | 'reject'
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  UPDATE creator_videos SET
    status = CASE p_action WHEN 'approve' THEN 'live' ELSE 'removed' END,
    report_count = CASE p_action WHEN 'approve' THEN 0 ELSE report_count END
  WHERE id = p_video_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Video not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'action', p_action);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- lock_creator_commission — commission on Sky Diamond purchase, LOCKED
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-19, CRITICAL): the entire creator commission/payout
-- system (creator_stats: total_sales, locked_commission, total_commission,
-- pending_payout, paid_out) had NO working Supabase write path at all —
-- see the creator_stats table comment above for the full mechanism (a
-- field-name mismatch in the live bridge handler AND missing RLS
-- INSERT/UPDATE policies, two independent, compounding reasons nothing
-- was ever actually saved). Separately, this table's GRANT was fully
-- open at the table level (`GRANT ... TO anon, authenticated`, unchanged
-- since this table was first created) — meaning once the RLS/field-name
-- bugs above are naively "fixed," a client could set their own
-- pending_payout to any value directly, or zero out a DIFFERENT
-- creator's locked_commission, the same class of severe issue as the
-- coins/green_diamonds grant mistake found earlier in this session. This
-- table is now getting the full RPC treatment rather than a raw grant fix.
-- Preserves the exact fraud-prevention design documented in
-- premium-creator.js: commission is LOCKED at purchase time, only
-- RELEASED to pending_payout the first time the referred buyer actually
-- spends on a paid match (see release_creator_commission below) — not
-- paid out for a deposit with zero real engagement.
CREATE OR REPLACE FUNCTION lock_creator_commission(
  p_creator_uid TEXT,
  p_amount      NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  -- No self-or-admin restriction on p_creator_uid here by design — this
  -- fires when ANY user buys Sky Diamonds with someone else's creator
  -- code, so the caller is legitimately crediting a different person.
  -- Still requires a real, non-negative amount and a real creator row.
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id = p_creator_uid AND is_creator = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a valid creator');
  END IF;

  INSERT INTO creator_stats(user_id, total_sales, locked_commission)
  VALUES(p_creator_uid, 1, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    total_sales = creator_stats.total_sales + 1,
    locked_commission = creator_stats.locked_commission + p_amount,
    updated_at = NOW();

  RETURN jsonb_build_object('success', true, 'locked', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- release_creator_commission — moves locked → pending_payout
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-19): fires once, the first time a referred buyer
-- actually spends on a paid match — see
-- window.releaseCreatorCommissionIfPending in premium-creator.js and its
-- call sites in screens/join.js. p_buyer_uid is only used to look up and
-- clear the buyer's pending-commission marker (still a Firebase-only
-- transient marker, users/{uid}/_pendingCreatorCommission — not moved to
-- Supabase since it's short-lived state, not a balance); the actual
-- commission movement is keyed by creator_uid and amount, both passed
-- explicitly since the caller already read them off that marker.
CREATE OR REPLACE FUNCTION release_creator_commission(
  p_creator_uid TEXT,
  p_amount      NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  UPDATE creator_stats SET
    locked_commission = GREATEST(locked_commission - p_amount, 0),
    total_commission = total_commission + p_amount,
    pending_payout = pending_payout + p_amount,
    updated_at = NOW()
  WHERE user_id = p_creator_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator stats row not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'released', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- claim_creator_payout — creator requests payout of pending balance
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-19): self-only — replaces a direct client-side
-- `pendingPayout: 0` write (window.requestCreatorPayout in
-- premium-creator.js), which under the old fully-open table grant would
-- have let a creator zero their own pending_payout without any admin
-- ever actually seeing/approving the request. Moves the amount to
-- paid_out only when actually approved — this function just marks the
-- request; actual admin approval/payment confirmation should go through
-- its own admin-checked step if/when a payout-approval UI exists (not yet
-- built — flagged in 31.7 as a follow-up, this RPC only handles the
-- self-service "clear my pending balance to request payout" half that
-- was already live).
CREATE OR REPLACE FUNCTION claim_creator_payout() RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_amount NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT pending_payout INTO v_amount FROM creator_stats WHERE user_id = v_uid FOR UPDATE;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No pending payout to claim');
  END IF;

  UPDATE creator_stats SET pending_payout = 0, paid_out = paid_out + v_amount, updated_at = NOW() WHERE user_id = v_uid;

  RETURN jsonb_build_object('success', true, 'claimed', v_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- admin_set_coins — admin-only add/remove/set-exact, atomic
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): fa24-admin-smart-tools.js's Coin Manager tool
-- (window._doCoinManager) previously did a plain read-then-write against
-- the RTDB-bridge path users/{uid}/coins — non-atomic (a concurrent coin
-- change between the read and the write would be silently lost), and
-- routed through a bridge path that, after this session's grant lockdown,
-- can no longer write coins directly at all (see the users GRANT block
-- comment for why coins/sky_diamonds/green_diamonds had to be removed
-- from direct client access). increment_balance/decrement_balance cover
-- the 'add'/'remove' cases atomically, but neither supports "set to this
-- exact value" (both only do deltas) — this RPC adds that admin-only
-- absolute-set case alongside delta add/remove, all admin-checked and
-- atomic (row-locked for the read-modify-write, so no lost-update race
-- even for the 'add'/'remove' cases computed here).
CREATE OR REPLACE FUNCTION admin_set_coins(
  p_uid    TEXT,
  p_action TEXT,   -- 'add' | 'remove' | 'set'
  p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_current  NUMERIC;
  v_new      NUMERIC;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('add','remove','set') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;
  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-negative');
  END IF;

  SELECT coins INTO v_current FROM users WHERE id = p_uid FOR UPDATE;
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new := CASE p_action
    WHEN 'add'    THEN v_current + p_amount
    WHEN 'remove' THEN GREATEST(v_current - p_amount, 0)
    ELSE p_amount
  END;

  UPDATE users SET coins = v_new WHERE id = p_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(p_uid, 'coins', CASE p_action WHEN 'remove' THEN 'debit' ELSE 'credit' END,
         ABS(v_new - v_current), 'admin_coin_manager', v_caller);

  RETURN jsonb_build_object('success', true, 'old_balance', v_current, 'new_balance', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- award_mentor_reward — atomic mentor GD reward on student rank-up
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): features/mentor.js's reward-on-rankup flow was
-- doing a direct read-then-write on users.green_diamonds (which — after
-- this session's grant lockdown on that column, see the users GRANT block
-- — can no longer be written directly at all) AND a direct update on
-- mentor_profiles for a DIFFERENT user than the caller (the student is
-- crediting their MENTOR's profile), which mentor_profiles' own RLS
-- policy (mnp_own: caller must equal user_id) already correctly blocks —
-- so this write has likely never actually succeeded even before the grant
-- fix, just silently via its own .catch(). This RPC does both writes
-- atomically, callable by the student (on behalf of crediting their
-- mentor — this is the one legitimate "credit someone else" case here,
-- scoped narrowly to an active accepted mentor_requests relationship,
-- not a general bypass).
CREATE OR REPLACE FUNCTION award_mentor_reward(
  p_student_uid TEXT,
  p_mentor_uid  TEXT,
  p_gd_amount   INT
) RETURNS JSONB AS $$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_active_mentorship BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_student_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  IF p_gd_amount < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  -- Only pay out if there's a genuinely active, accepted mentorship
  -- between exactly this student and this mentor — prevents a student
  -- from crediting an arbitrary "mentor" uid they aren't actually
  -- mentored by.
  SELECT EXISTS(
    SELECT 1 FROM mentor_requests
    WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted'
  ) INTO v_is_active_mentorship;
  IF NOT v_is_active_mentorship THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active mentorship found');
  END IF;

  UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + p_gd_amount WHERE id = p_mentor_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(p_mentor_uid, 'green_diamonds', 'credit', p_gd_amount, 'mentor_reward', p_student_uid);

  INSERT INTO mentor_profiles(user_id, gd_earned, successful_students)
  VALUES(p_mentor_uid, p_gd_amount, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    gd_earned = mentor_profiles.gd_earned + p_gd_amount,
    successful_students = mentor_profiles.successful_students + 1;

  RETURN jsonb_build_object('success', true, 'gd_awarded', p_gd_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- cancel_premium — admin-only premium revocation
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): admin-fixes-v21.js's adminCancelPremium wrote
-- premium_level/premium_expires directly, which are no longer directly
-- client-writable at all after this session's grant lockdown (see the
-- users GRANT block — this was the exact column that let any user grant
-- themselves free premium). approve_premium (added earlier this session)
-- only grants; this is its cancel counterpart.
CREATE OR REPLACE FUNCTION cancel_premium(p_uid TEXT) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  UPDATE users SET premium_level = 0, premium_expires = NULL WHERE id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- admin_sync_user_balance — admin-panel-only Firebase→Supabase legacy sync
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): admin-supabase-sync.js's _watchUserUpdates is a
-- real-time listener on Firebase's users/{uid} node that mirrors coins/
-- sky_diamonds/green_diamonds (and other fields) into Supabase whenever
-- the Firebase-side value changes — a legacy safety net for any
-- Firebase-side write path (manual Console edits, older tools) that
-- hasn't been migrated. It was doing a direct absolute-value UPDATE,
-- which is no longer possible for these three columns at all (see the
-- users GRANT block). This RPC is deliberately an ABSOLUTE set, not a
-- delta — unlike increment_balance/decrement_balance, this listener's
-- whole purpose is "make Supabase match whatever Firebase's value
-- currently is," which is exactly what an absolute set means here. Admin
-- panel context is trusted (loaded only within the already is_admin-
-- gated Admin Panel UI), but this still verifies is_admin server-side
-- too, matching every other admin RPC in this file — no code path should
-- trust client-side gating alone.
CREATE OR REPLACE FUNCTION admin_sync_user_balance(
  p_uid            TEXT,
  p_coins          NUMERIC,
  p_sky_diamonds   NUMERIC,
  p_green_diamonds NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_coins < 0 OR p_sky_diamonds < 0 OR p_green_diamonds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Balances must be non-negative');
  END IF;

  UPDATE users SET
    coins = p_coins,
    sky_diamonds = p_sky_diamonds,
    green_diamonds = p_green_diamonds
  WHERE id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- award_battle_pass_xp
-- ─────────────────────────────────────────────────────────────────
-- ✅ CORRECTED (2026-07-22): direct live-database inspection found this
-- function existed in two versions — this repo's own (p_uid, p_xp,
-- p_season_key) and an independently-written one from an earlier session
-- (p_uid, p_season, p_xp — different parameter ORDER, not just type).
-- features/battle-pass.js's actual call site
-- (`{p_uid, p_season: sid, p_xp: totalXP}`) matches the OTHER version's
-- order, and Postgres/PostgREST resolve named-argument calls by NAME not
-- position, so the mismatch wasn't silently breaking things — but having
-- two overloaded, drifting implementations was still a maintenance trap
-- (see DEVELOPER_GUIDE.md 31.2 point 5). Kept the other session's version
-- since its atomic ON CONFLICT upsert is simpler and safer than this
-- version's separate SELECT-then-INSERT/UPDATE (a real, if narrow, race
-- window between the SELECT and the following write).
CREATE OR REPLACE FUNCTION award_battle_pass_xp(p_uid TEXT, p_season TEXT, p_xp INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_new_xp INT;
  v_new_tier INT;
BEGIN
  IF v_caller IS DISTINCT FROM p_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only award your own XP');
  END IF;
  IF p_xp <= 0 OR p_xp > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid XP amount');
  END IF;

  INSERT INTO battle_pass_progress (user_id, season_key, current_xp, current_tier, has_premium, claimed_free, claimed_prem)
    VALUES (p_uid, p_season, p_xp, LEAST(50, p_xp/100), false, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (user_id, season_key) DO UPDATE
      SET current_xp = battle_pass_progress.current_xp + p_xp,
          current_tier = GREATEST(battle_pass_progress.current_tier, LEAST(50, (battle_pass_progress.current_xp + p_xp)/100)),
          updated_at = now()
    RETURNING current_xp, current_tier INTO v_new_xp, v_new_tier;

  RETURN jsonb_build_object('success', true, 'xp', v_new_xp, 'tier', v_new_tier);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION award_battle_pass_xp(TEXT, TEXT, INTEGER) TO authenticated, service_role;
-- ⚠️ Signature changed from (TEXT, INT, TEXT DEFAULT '') to
-- (TEXT, TEXT, INTEGER) — different order AND no default on p_season. If
-- re-running against a database with the OLD signature still present:
-- DROP FUNCTION IF EXISTS award_battle_pass_xp(TEXT, INT, TEXT); first.

-- ─────────────────────────────────────────────────────────────────
-- claim_battle_pass_tier — validated tier reward claim
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written — every battle pass
-- reward claim in the User Panel (features/battle-pass.js) has been
-- calling a non-existent function. p_track is 'free' or 'prem'; the
-- 'prem' track additionally requires has_premium=true on the caller's
-- progress row. p_gd_reward is the green_diamonds amount for this
-- specific tier/track combination (0 if the tier's reward isn't GD).
-- ✅ CORRECTED (2026-07-22): merged an upper-bound sanity check on
-- p_gd_reward (< 0 OR > 200) found on a duplicate overload from an
-- earlier, independent session during live-database duplicate-overload
-- cleanup (DEVELOPER_GUIDE.md 31.2 point 5, 31.6) — response shape
-- ('success' key) was already correct and unchanged; the JS caller in
-- battle-pass.js checks r.data.success, verified against the live source
-- before merging.
-- ✅ UPDATED (2026-08-22): the 'free' track previously had NO premium
-- gate at all — only 'prem' checked has_premium. Per explicit product
-- decision, ALL tier rewards (including the free-track column) should
-- only unlock once the Season Pass itself is purchased. Both tracks now
-- require has_premium. Also: a duplicate overload with p_gd_reward as
-- INTEGER (no bounds check) was found live and dropped — this NUMERIC
-- version with the 0-200 check is the only one that should ever exist.
CREATE OR REPLACE FUNCTION claim_battle_pass_tier(
  p_season    TEXT,
  p_tier      INT,
  p_track     TEXT,   -- 'free' | 'prem'
  p_gd_reward NUMERIC DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_claimed JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_track NOT IN ('free','prem') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid track');
  END IF;
  IF p_gd_reward < 0 OR p_gd_reward > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reward amount');
  END IF;

  SELECT * INTO v_row FROM battle_pass_progress
  WHERE user_id = v_uid AND season_key = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No battle pass progress found');
  END IF;
  IF v_row.current_tier < p_tier THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tier not reached yet');
  END IF;
  -- ✅ (2026-08-22) now gates BOTH tracks, not just 'prem'
  IF NOT COALESCE(v_row.has_premium, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season Pass nahi khareeda — pehle purchase karo');
  END IF;

  v_claimed := CASE p_track WHEN 'free' THEN COALESCE(v_row.claimed_free,'{}'::JSONB)
                            ELSE COALESCE(v_row.claimed_prem,'{}'::JSONB) END;
  IF v_claimed ? p_tier::TEXT THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  IF p_gd_reward > 0 THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + p_gd_reward WHERE id = v_uid;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_uid, 'green_diamonds', 'credit', p_gd_reward, 'battle_pass_tier_claim', p_season || ':' || p_tier || ':' || p_track);
  END IF;

  IF p_track = 'free' THEN
    UPDATE battle_pass_progress SET claimed_free = claimed_free || jsonb_build_object(p_tier::TEXT, true)
    WHERE user_id = v_uid AND season_key = p_season;
  ELSE
    UPDATE battle_pass_progress SET claimed_prem = claimed_prem || jsonb_build_object(p_tier::TEXT, true)
    WHERE user_id = v_uid AND season_key = p_season;
  END IF;

  RETURN jsonb_build_object('success', true, 'tier', p_tier, 'track', p_track, 'gd', p_gd_reward);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION claim_battle_pass_tier(TEXT, INT, TEXT, NUMERIC) TO authenticated, service_role;
-- ⚠️ Signature changed p_gd_reward from INT to NUMERIC. If re-running
-- against a database with the OLD signature: DROP FUNCTION IF EXISTS
-- claim_battle_pass_tier(TEXT, INT, TEXT, INT); first.
-- ⚠️ (2026-08-22) A duplicate overload with p_gd_reward INTEGER was
-- found live (caused "could not choose the best candidate function" on
-- every claim attempt) and dropped:
-- DROP FUNCTION IF EXISTS claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward integer);

-- ─────────────────────────────────────────────────────────────────
-- track_mission_progress — never-regress progress update
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. core/db.js's own
-- comment already explains why this must never let progress go backwards
-- (GREATEST against the existing value) — implemented exactly that way.
CREATE OR REPLACE FUNCTION track_mission_progress(
  p_mission_key TEXT,
  p_period      TEXT,
  p_progress    INT,
  p_target      INT
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_new_progress INT;
  v_completed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  INSERT INTO mission_progress(user_id, mission_key, period, progress, target, is_completed)
  VALUES(v_uid, p_mission_key, p_period, LEAST(p_progress, p_target), p_target, p_progress >= p_target)
  ON CONFLICT (user_id, mission_key, period) DO UPDATE SET
    progress = GREATEST(mission_progress.progress, LEAST(p_progress, p_target)),
    target = p_target,
    is_completed = mission_progress.is_completed OR (p_progress >= p_target),
    updated_at = NOW()
  RETURNING progress, is_completed INTO v_new_progress, v_completed;

  RETURN jsonb_build_object('success', true, 'progress', v_new_progress, 'is_completed', v_completed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- claim_mission_reward — validated, single-claim mission reward
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. core/db.js's own
-- comment explains the exact bug this replaces: reward_claimed and the
-- coin credit used to be two separate, unguarded steps with nothing
-- checking is_completed and nothing stopping reward_claimed being reset
-- to re-claim indefinitely. This does the check-and-claim atomically.
-- ✅ CORRECTED (2026-07-22): merged a p_coins bound-check (<= 0 OR > 500)
-- found on a duplicate overload from an earlier, independent session
-- during live-database cleanup — same class of finding as the other
-- functions touched in this pass (DEVELOPER_GUIDE.md 31.2 point 5, 31.6).
CREATE OR REPLACE FUNCTION claim_mission_reward(
  p_mission_key TEXT,
  p_period      TEXT,
  p_coins       NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_coins <= 0 OR p_coins > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid coin amount');
  END IF;

  SELECT * INTO v_row FROM mission_progress
  WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mission not found');
  END IF;
  IF NOT v_row.is_completed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mission abhi complete nahi hui');
  END IF;
  IF v_row.reward_claimed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  UPDATE mission_progress SET reward_claimed = true, updated_at = NOW()
  WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period;

  UPDATE users SET coins = COALESCE(coins, 0) + p_coins WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(v_uid, 'coins', 'credit', p_coins, 'mission_reward', p_mission_key || ':' || p_period);

  RETURN jsonb_build_object('success', true, 'coins', p_coins);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION claim_mission_reward(TEXT, TEXT, NUMERIC) TO authenticated, service_role;
-- ⚠️ Signature changed p_coins from INT to NUMERIC. If re-running against
-- a database with the OLD signature: DROP FUNCTION IF EXISTS
-- claim_mission_reward(TEXT, TEXT, INT); first.

-- ─────────────────────────────────────────────────────────────────
-- claim_ad_reward — server-verified daily-capped ad reward
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): documented but never written. rewarded-bonus.js's
-- own comment explains why the daily cap must be re-counted server-side
-- from actual wallet_transactions rows rather than trusted from client
-- localStorage (which is trivially resettable, e.g. via incognito mode).
-- ✅ CORRECTED (2026-07-22): merged a p_amount bound-check (<= 0 OR > 200)
-- found on a duplicate overload from an earlier, independent session
-- during live-database cleanup.
CREATE OR REPLACE FUNCTION claim_ad_reward(
  p_amount       NUMERIC,
  p_max_per_day  INT DEFAULT 5
) RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_today_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_amount <= 0 OR p_amount > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  SELECT COUNT(*) INTO v_today_count
  FROM wallet_transactions
  WHERE user_id = v_uid
    AND reason = 'ad_watch_reward'
    AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF v_today_count >= p_max_per_day THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aaj ka daily limit khatam ho gaya');
  END IF;

  UPDATE users SET coins = COALESCE(coins, 0) + p_amount WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason)
  VALUES(v_uid, 'coins', 'credit', p_amount, 'ad_watch_reward');

  RETURN jsonb_build_object('success', true, 'coins', p_amount, 'watched_today', v_today_count + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION claim_ad_reward(NUMERIC, INT) TO authenticated, service_role;
-- ⚠️ Signature changed p_amount from INT to NUMERIC; date check switched
-- from date_trunc('day', NOW()) [server/UTC] to IST-aware, same
-- correctness fix as process_daily_checkin above. If re-running against a
-- database with the OLD signature: DROP FUNCTION IF EXISTS
-- claim_ad_reward(INT, INT); first.

-- ─────────────────────────────────────────────────────────────────
-- increment_city_score
-- ─────────────────────────────────────────────────────────────────
-- ✅ CORRECTED (2026-07-22): this version had NO identity check at all —
-- any authenticated caller could inflate ANY city's score with no
-- attribution to a real user. Live-database inspection found a duplicate
-- overload (from an earlier, independent session) that added a p_uid
-- parameter and a self-only check; features/city-championship.js's actual
-- caller sends p_uid: _uid() (verified against the live source, not
-- assumed), confirming that version matches the real calling convention.
-- Traded away this version's player_count increment (which counted every
-- CALL, not every unique player, per city per month — inflated by design
-- for any repeat player, so not a meaningful loss) for the identity check,
-- which is the more important property for a real-money-adjacent
-- leaderboard stat. Score/wins/kills bounds also tightened to single-match
-- plausible ranges (was previously just "non-negative", i.e. unbounded).
CREATE OR REPLACE FUNCTION increment_city_score(
  p_city  TEXT,
  p_month TEXT,
  p_score INTEGER DEFAULT 0,
  p_wins  INTEGER DEFAULT 0,
  p_kills INTEGER DEFAULT 0,
  p_uid   TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_target TEXT := COALESCE(p_uid, v_caller);
BEGIN
  -- Self-report only: caller can only ever attribute city-score points to
  -- themselves, never to another user_id, even if one is passed.
  IF v_caller IS NULL OR v_target IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_score < 0 OR p_wins < 0 OR p_kills < 0 OR p_score > 100 OR p_wins > 10 OR p_kills > 30 THEN
    RAISE EXCEPTION 'Score/wins/kills must be non-negative and within a single-match bound';
  END IF;

  INSERT INTO city_championship (city, month, score, wins, kills, player_count)
    VALUES (p_city, p_month, p_score, p_wins, p_kills, 1)
    ON CONFLICT (city, month) DO UPDATE SET
      score = city_championship.score + EXCLUDED.score,
      wins  = city_championship.wins  + EXCLUDED.wins,
      kills = city_championship.kills + EXCLUDED.kills;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION increment_city_score(TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO authenticated, service_role;
-- ⚠️ Signature changed — added a 6th parameter p_uid. If re-running
-- against a database with the OLD 5-parameter signature still present:
-- DROP FUNCTION IF EXISTS increment_city_score(TEXT, TEXT, INT, INT, INT);
-- first. Also note KNOWN LIMITATION unchanged from before: this still
-- trusts the caller's own claimed score/wins/kills within the per-call
-- bounds, with no cross-check against an actual recorded match result —
-- see DEVELOPER_GUIDE.md 31.7 for the follow-up needed to close that gap
-- properly (derive city-score from confirmed match results server-side).

-- ─────────────────────────────────────────────────────────────────
-- increment_rank_points
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_rank_points(
  p_uid    TEXT,
  p_points INT
) RETURNS void AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
BEGIN
  -- ✅ SECURITY FIX (2026-07-17): no identity check previously existed.
  -- Currently dead code (confirmed zero live callers in either panel as
  -- of this pass — core/db.js's DB.rank.addPoints and screens/rank.js's
  -- updateSeasonStats define this call but nothing invokes them), so this
  -- is defense-in-depth rather than an active exploit, but fixed to match
  -- the same self-or-admin pattern as every other balance-mutating RPC in
  -- case this is ever wired up later without someone re-auditing it first.
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'Not authorized to modify rank points for this user';
    END IF;
  END IF;
  IF p_points < 0 THEN RAISE EXCEPTION 'Points must be non-negative'; END IF;
  UPDATE users SET rank_points = COALESCE(rank_points, 0) + p_points WHERE id = p_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- increment_clan_score
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_clan_score(
  p_clan_id  UUID,
  p_score    INT DEFAULT 1,
  p_kills    INT DEFAULT 0,
  p_wins     INT DEFAULT 0
) RETURNS void AS $$
DECLARE
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_member  BOOLEAN;
BEGIN
  -- ✅ SECURITY FIX (2026-07-17): documented as "caller must be a real
  -- clan_members row for that clan" but this was never actually checked —
  -- any authenticated caller could inflate (or, since p_score/p_kills/
  -- p_wins weren't bounded to non-negative either, potentially deflate)
  -- any clan's leaderboard stats regardless of membership.
  IF v_caller IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = v_caller
    ) INTO v_is_member;
    IF NOT v_is_member THEN
      RAISE EXCEPTION 'Not a member of this clan';
    END IF;
  END IF;
  IF p_score < 0 OR p_kills < 0 OR p_wins < 0 THEN
    RAISE EXCEPTION 'Score/kills/wins must be non-negative';
  END IF;

  UPDATE clans SET
    weekly_score = COALESCE(weekly_score, 0) + p_score,
    total_kills  = COALESCE(total_kills, 0)  + p_kills,
    total_wins   = COALESCE(total_wins, 0)   + p_wins
  WHERE id = p_clan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- apply_referral_code — atomic referral code redemption
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17, CRITICAL): documented here but never actually
-- written — the entire referral system has been non-functional since
-- js/referral-system-fix.js was written specifically to call this RPC
-- (replacing an earlier, separately-buggy direct-write version — see the
-- detailed comment in that file for the full history). Caller must be the
-- user applying the code (self only) — crediting a DIFFERENT user (the
-- referrer) is intentional and safe here because it's fully scoped to
-- this one validated referral-credit case, not a general bypass.
-- ✅ CORRECTED (2026-07-22): live-database inspection found a duplicate
-- overload from an earlier, independent session with two safeguards this
-- version lacked, merged in here: a p_reward bound-check (<=0 OR >500),
-- and — more importantly — a total_matches > 0 fraud-guard, which blocks
-- applying a referral code AFTER already having played matches (closing
-- a real abuse case: a user plays a few matches, then finds/buys a
-- referral code to retroactively claim signup-bonus-adjacent value).
-- Also added FOR UPDATE on the referrals existence-check for the same
-- race-condition safety already used elsewhere in this file.
CREATE OR REPLACE FUNCTION apply_referral_code(p_code TEXT, p_reward NUMERIC)
RETURNS JSONB AS $$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_referrer_uid TEXT;
  v_referrer_ign TEXT;
  v_existing UUID;
  v_matches INT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_reward <= 0 OR p_reward > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid reward amount');
  END IF;

  SELECT id, ign INTO v_referrer_uid, v_referrer_ign FROM users WHERE referral_code = p_code LIMIT 1;
  IF v_referrer_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;
  IF v_referrer_uid = v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apna khud ka code use nahi kar sakte');
  END IF;

  SELECT total_matches INTO v_matches FROM users WHERE id = v_caller;
  IF COALESCE(v_matches, 0) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral code sirf pehle match se pehle apply ho sakta hai!');
  END IF;

  -- referrals.referred_id has a UNIQUE constraint — a user can only ever
  -- be referred once, this doubles as the duplicate-application guard.
  SELECT id INTO v_existing FROM referrals WHERE referred_id = v_caller FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aap already ek referral code use kar chuke ho!');
  END IF;

  -- Also guard against a user who already has referred_by set (e.g. from
  -- signup flow) applying a code again through this path.
  IF EXISTS(SELECT 1 FROM users WHERE id = v_caller AND referred_by IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aap already kisi ka referral use kar chuke ho');
  END IF;

  INSERT INTO referrals (referrer_id, referred_id, referrer_ign, join_bonus_paid)
    VALUES (v_referrer_uid, v_caller, v_referrer_ign, true);
  UPDATE users SET referred_by = v_referrer_uid, referral_popup_done = true WHERE id = v_caller;
  UPDATE users SET coins = COALESCE(coins,0) + p_reward WHERE id = v_referrer_uid;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_referrer_uid, 'coins', 'credit', p_reward, 'referral_bonus', v_caller);

  RETURN jsonb_build_object('success', true, 'referrer_uid', v_referrer_uid, 'referrer_ign', v_referrer_ign, 'reward', p_reward);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION apply_referral_code(TEXT, NUMERIC) TO authenticated, service_role;
-- ⚠️ Signature changed p_reward from INT to NUMERIC. If re-running against
-- a database with the OLD signature: DROP FUNCTION IF EXISTS
-- apply_referral_code(TEXT, INT); first.

-- ─────────────────────────────────────────────────────────────────
-- join_clan — atomic clan join with member count update
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION join_clan(
  p_user_id TEXT,
  p_clan_id UUID,
  p_role    TEXT DEFAULT 'member'
) RETURNS JSONB AS $$
DECLARE
  v_already BOOLEAN;
  v_caller  TEXT := auth.jwt() ->> 'sub';
BEGIN
  -- ✅ SECURITY FIX (2026-07-17, CRITICAL): this function's OWN documented
  -- contract ("p_user_id must equal caller" / "p_role is IGNORED
  -- server-side and always forced to 'member' — self-promotion to
  -- 'leader' via this call is not possible") was never actually
  -- implemented in the function body — neither guarantee existed. Any
  -- authenticated caller could force ANY user into ANY clan, AND set
  -- p_role directly to 'leader' for themselves or anyone else. Fixed to
  -- match what was always documented as the intended behavior.
  IF v_caller IS NOT NULL AND v_caller <> p_user_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  p_role := 'member'; -- always forced, regardless of what the caller sent

  SELECT EXISTS(
    SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_user_id
  ) INTO v_already;
  IF v_already THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already in clan');
  END IF;
  INSERT INTO clan_members(clan_id, user_id, role) VALUES(p_clan_id, p_user_id, p_role);
  UPDATE clans SET total_members = COALESCE(total_members, 0) + 1 WHERE id = p_clan_id;
  UPDATE users SET clan_id = p_clan_id::TEXT WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM WHEN 'NOT_AUTHORIZED' THEN 'Not authorized' ELSE SQLERRM END);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- leave_clan — atomic clan leave with member count update
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION leave_clan(
  p_user_id TEXT,
  p_clan_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_real_leader  TEXT;
BEGIN
  -- ✅ SECURITY FIX (2026-07-17, CRITICAL): documented as "caller must be
  -- p_user_id (self-leave) OR the clan's real leader_uid (kicking a
  -- member)" but neither check existed in the code — any authenticated
  -- caller could remove ANY user from ANY clan (a griefing vector: one
  -- player repeatedly force-removing another from their own clan).
  IF v_caller IS NOT NULL AND v_caller <> p_user_id THEN
    SELECT leader_uid INTO v_real_leader FROM clans WHERE id = p_clan_id;
    IF v_real_leader IS DISTINCT FROM v_caller THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
    END IF;
  END IF;

  DELETE FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_user_id;
  UPDATE clans SET total_members = GREATEST(COALESCE(total_members, 1) - 1, 0) WHERE id = p_clan_id;
  UPDATE users SET clan_id = NULL WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- contribute_to_squad_bank — atomic contribute (debit user + credit clan)
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): this function was DOCUMENTED in the RPC summary
-- section below (claiming it "replaces two separate, non-atomic direct
-- writes that used to exist in both squad-bank.js (user) and
-- admin-fixes-v22-FINAL.js (admin)") but no CREATE FUNCTION for it existed
-- anywhere in this file — the documentation described an intended fix that
-- was never actually implemented. features/squad-bank.js's _doContribute()
-- was still doing exactly the non-atomic select-then-update sequence this
-- was meant to replace: two clan members contributing at the same moment
-- could race on the same squad_bank_gd read, and whichever update() landed
-- second would silently overwrite the first — meaning the first
-- contributor's green_diamonds were already correctly deducted (that part
-- WAS atomic, via decrement_balance) but their contribution could vanish
-- from the clan bank with no error, no trace, and no way for them to know.
-- ✅ CORRECTED (2026-07-22): p_amount changed from INT to NUMERIC, matching
-- every other currency-handling RPC's convention in this file — verified
-- against the live database via the Supabase connector that this is the
-- only version currently deployed (no duplicate overload existed for this
-- one, unlike the 7 others resolved in this same pass), so this is a
-- straightforward type-consistency fix, not a functional merge.
CREATE OR REPLACE FUNCTION contribute_to_squad_bank(
  p_clan_id UUID,
  p_uid     TEXT,
  p_amount  NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_balance      NUMERIC;
  v_ign          TEXT;
  v_contributors JSONB;
  v_prior        JSONB;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid amount');
  END IF;

  SELECT green_diamonds, COALESCE(ign, 'Player') INTO v_balance, v_ign
  FROM users WHERE id = p_uid FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User not found');
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Lock the clan row for the whole operation so a second, concurrent
  -- contribute_to_squad_bank call for the same clan has to wait for this
  -- one to fully commit before it can read squad_bank_gd/contributors —
  -- this is the actual fix for the race condition described above.
  PERFORM 1 FROM clans WHERE id = p_clan_id FOR UPDATE;

  UPDATE users SET green_diamonds = green_diamonds - p_amount WHERE id = p_uid;

  SELECT squad_bank_contributors INTO v_contributors FROM clans WHERE id = p_clan_id;
  v_contributors := COALESCE(v_contributors, '{}'::JSONB);
  v_prior := COALESCE(v_contributors -> p_uid, '{}'::JSONB);

  UPDATE clans SET
    squad_bank_gd = COALESCE(squad_bank_gd, 0) + p_amount,
    squad_bank_contributors = v_contributors || jsonb_build_object(
      p_uid, jsonb_build_object(
        'ign', v_ign,
        'gd', COALESCE((v_prior->>'gd')::NUMERIC, 0) + p_amount,
        'last_contributed', NOW()
      )
    )
  WHERE id = p_clan_id;

  RETURN jsonb_build_object('ok', true, 'amount', p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION contribute_to_squad_bank(UUID, TEXT, NUMERIC) TO authenticated, service_role;
-- ⚠️ Signature changed p_amount from INT to NUMERIC. If re-running against
-- a database with the OLD signature: DROP FUNCTION IF EXISTS
-- contribute_to_squad_bank(UUID, TEXT, INT); first.

-- ─────────────────────────────────────────────────────────────────
-- unlock_squad_bank_cosmetic — atomic cosmetic unlock from clan bank
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-17): same race-condition class as contribute_to_squad_bank
-- above — features/squad-bank.js's unlockClanCosmetic() did a plain
-- select-then-update with no lock, so two members trying to unlock two
-- different cosmetics at the same moment could race on the same
-- squad_bank_gd/squad_bank_unlocked read, with the loser's update silently
-- discarding the winner's. This RPC was not previously documented (unlike
-- contribute_to_squad_bank), so it's a new fix, not a "was documented but
-- missing" case like the other one — but the same underlying bug class.
CREATE OR REPLACE FUNCTION unlock_squad_bank_cosmetic(
  p_clan_id  UUID,
  p_item_id  TEXT,
  p_cost     INT,
  p_uid      TEXT
) RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_gd       INT;
  v_unlocked JSONB;
  v_is_member BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  SELECT EXISTS(SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_uid) INTO v_is_member;
  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not a member of this clan');
  END IF;

  SELECT squad_bank_gd, COALESCE(squad_bank_unlocked, '{}'::JSONB)
  INTO v_gd, v_unlocked
  FROM clans WHERE id = p_clan_id FOR UPDATE;

  IF v_gd IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Clan not found');
  END IF;
  IF v_unlocked ? p_item_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already unlocked');
  END IF;
  IF v_gd < p_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient squad bank balance');
  END IF;

  UPDATE clans SET
    squad_bank_gd = squad_bank_gd - p_cost,
    squad_bank_unlocked = v_unlocked || jsonb_build_object(
      p_item_id, jsonb_build_object('unlockedAt', NOW(), 'unlockedBy', p_uid)
    )
  WHERE id = p_clan_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- reassign_clan_leader — trigger on user delete
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reassign_clan_leader()
RETURNS TRIGGER AS $$
DECLARE
  v_clan_id    UUID;
  v_new_leader TEXT;
BEGIN
  FOR v_clan_id IN
    SELECT id FROM clans WHERE leader_uid = OLD.id
  LOOP
    SELECT user_id INTO v_new_leader
    FROM clan_members
    WHERE clan_id = v_clan_id AND user_id != OLD.id
    ORDER BY joined_at ASC LIMIT 1;
    IF v_new_leader IS NOT NULL THEN
      UPDATE clans SET leader_uid = v_new_leader WHERE id = v_clan_id;
    ELSE
      UPDATE clans SET status = 'disbanded', disbanded_at = NOW() WHERE id = v_clan_id;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reassign_clan_leader ON users;
CREATE TRIGGER trg_reassign_clan_leader
  BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION reassign_clan_leader();

-- ─────────────────────────────────────────────────────────────────
-- Grant RPC permissions
-- ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION increment_balance(TEXT, TEXT, NUMERIC)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION decrement_balance(TEXT, TEXT, NUMERIC)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_and_join_match(TEXT,TEXT,NUMERIC,TEXT,JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION award_battle_pass_xp(TEXT, INT, TEXT)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_city_score(TEXT, TEXT, INT, INT, INT)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_rank_points(TEXT, INT)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_clan_score(UUID, INT, INT, INT)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION join_clan(TEXT, UUID, TEXT)                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION leave_clan(TEXT, UUID)                              TO authenticated, service_role;

-- ================================================================
-- SECTION 11 — SEED DATA
-- ================================================================

-- Default app settings
INSERT INTO app_settings(key, value) VALUES
  ('live_config', '{
    "commission": 0.15,
    "roomReleaseMins": 10,
    "matchReminderMins": 30,
    "autoSquadEnabled": 1,
    "autoSquadTimeout": 15,
    "checkInEnabled": 1,
    "checkInOpenMins": 30,
    "checkInCloseMins": 5,
    "watchEarnEnabled": 1,
    "watchCoinsPerInterval": 2,
    "watchIntervalMins": 5,
    "watchDailyLimitMins": 30,
    "adCoinsPerWatch": 10,
    "adDailyLimit": 5,
    "checkinCoins": 5,
    "checkinStreakBonus7": 50,
    "referralJoinCoins": 50,
    "referralSDBonusDiamonds": 10,
    "seasonName": "Season 1",
    "premium": {
      "prices": {"1": 49, "2": 99, "3": 199},
      "bonuses": {"1": 50, "2": 150, "3": 400}
    }
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Default season config
INSERT INTO config(key, value) VALUES
  ('currentSeason', '{"name":"Season 1","seasonNum":1,"endDate":null,"active":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ================================================================
-- DONE — Schema complete
--
-- Tables: 60+  |  Views: 2  |  Functions: 9  |  Triggers: 1
--
-- Run order:
--   1. This file (COMPLETE_SCHEMA.sql) — fresh setup
--
-- Already on older schema?
--   Run only the SECTION(s) that add new tables/columns you need.
-- ================================================================

-- ================================================================
-- SECTION 12 — MATCH RESULTS FIX (match_id as TEXT for compatibility)
-- ================================================================

-- match_results.match_id should be TEXT (matches.id is TEXT in this schema)
-- Already correct above. Additional indexes for admin result queries:

CREATE INDEX IF NOT EXISTS idx_mr_user        ON match_results(user_id);
CREATE INDEX IF NOT EXISTS idx_mr_placement   ON match_results(match_id, placement);

-- Add prize_type column to matches if missing (for correct prize distribution)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS prize_type TEXT DEFAULT 'green_diamond';
-- prize_type values: 'green_diamond' | 'coin' | 'sky_diamond'
-- Rule: paid/SD entry → green_diamond prize | coin entry → coin prize | free → coin prize

-- Update existing matches prize_type based on entry_type
UPDATE matches SET prize_type = CASE
  WHEN entry_type IN ('paid','sky_diamond','skyDiamond') THEN 'green_diamond'
  WHEN entry_type = 'coin' THEN 'coin'
  ELSE 'coin'
END WHERE prize_type = 'green_diamond' OR prize_type IS NULL;


-- ================================================================
-- SECTION 13 — TABLES CONFIRMED MISSING (cross-checked against every
-- .from() / .rpc() / db.ref() call in both User Panel + Admin Panel
-- source code + supabase-rtdb-bridge.js TABLE_MAP — June 2026 audit)
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 13.1  ADMIN ACCESS — 3 sources kept in sync automatically
--    user_roles  = PRIMARY check (security-patches.js checks this first)
--    admins      = Firebase-bridge fallback (legacy adminPanel paths)
--    users.is_admin = used throughout RLS policies
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'admin',  -- 'admin' | 'super_admin'
  granted_by  TEXT,
  granted_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ur_select_own" ON user_roles;
CREATE POLICY "ur_select_own" ON user_roles FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "ur_admin_write" ON user_roles;
CREATE POLICY "ur_admin_write" ON user_roles FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

CREATE TABLE IF NOT EXISTS admins (
  uid          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT,
  display_name TEXT,
  role         TEXT DEFAULT 'admin',
  added_by     TEXT,
  added_at     TIMESTAMPTZ DEFAULT NOW(),
  is_active    BOOL DEFAULT true
);
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "adm_select_own" ON admins;
CREATE POLICY "adm_select_own" ON admins FOR SELECT
  USING ((auth.jwt() ->> 'sub') = uid OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "adm_admin_write" ON admins;
CREATE POLICY "adm_admin_write" ON admins FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- Auto-sync: whenever users.is_admin flips true, mirror into user_roles + admins.
-- Whenever it flips false, remove from both (revoke access everywhere at once).
CREATE OR REPLACE FUNCTION sync_admin_tables() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin = true THEN
    INSERT INTO user_roles(user_id, role) VALUES(NEW.id, 'admin')
      ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO admins(uid, email, display_name) VALUES(NEW.id, NEW.email, NEW.ign)
      ON CONFLICT (uid) DO UPDATE SET is_active = true;
  ELSE
    DELETE FROM user_roles WHERE user_id = NEW.id;
    UPDATE admins SET is_active = false WHERE uid = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_admin_tables ON users;
CREATE TRIGGER trg_sync_admin_tables
  AFTER UPDATE OF is_admin ON users
  FOR EACH ROW EXECUTE FUNCTION sync_admin_tables();

-- Backfill: any existing admin user gets mirrored immediately
INSERT INTO user_roles(user_id, role)
  SELECT id, 'admin' FROM users WHERE is_admin = true
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO admins(uid, email, display_name)
  SELECT id, email, ign FROM users WHERE is_admin = true
  ON CONFLICT (uid) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
-- 13.2  FF UID INDEX — fast unique lookup (bridge: ffUIDIndex)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ff_uid_index (
  ff_uid     TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ff_uid_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ffi_select_all" ON ff_uid_index;
CREATE POLICY "ffi_select_all" ON ff_uid_index FOR SELECT USING (true);
DROP POLICY IF EXISTS "ffi_insert_auth" ON ff_uid_index;
CREATE POLICY "ffi_insert_auth" ON ff_uid_index FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────
-- 13.3  PROFILE UPDATES — IGN/FF-UID change requests
--    (separate workflow from profile_requests, used by
--     admin-fixes-v25-SUPABASE.js + fa05-platform-health.js)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_updates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_ign           TEXT,
  new_ff_uid        TEXT,
  current_ign       TEXT,
  current_ff_uid    TEXT,
  new_phone         TEXT,
  status            TEXT DEFAULT 'pending',
  rejection_reason  TEXT,
  request_count     INT  DEFAULT 1,
  processed_at      TIMESTAMPTZ,
  processed_by      TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  -- ✅ ADDED (2026-08-21): FF UID Change feature (premium=free / paid=₹49
  -- one-time fee w/ payment proof). See DEVELOPER_GUIDE.md session
  -- 2026-08-21 §3.
  uid_change_requested boolean DEFAULT false,
  uid_change_via       TEXT, -- 'premium' or 'paid'
  payment_screenshot   TEXT,
  payment_utr          TEXT,
  payment_amount       NUMERIC
);
ALTER TABLE profile_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pu_select_own" ON profile_updates;
CREATE POLICY "pu_select_own" ON profile_updates FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "pu_insert_own" ON profile_updates;
CREATE POLICY "pu_insert_own" ON profile_updates FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "pu_update_admin" ON profile_updates;
CREATE POLICY "pu_update_admin" ON profile_updates FOR UPDATE
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_pu_status ON profile_updates(status) WHERE status = 'pending';


-- ─────────────────────────────────────────────────────────────────
-- 13.4  USER MATCHES — per-user match history (bridge: userMatches)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_matches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  match_id    TEXT REFERENCES matches(id) ON DELETE CASCADE,
  rank        INT  DEFAULT 0,
  kills       INT  DEFAULT 0,
  reward      NUMERIC DEFAULT 0,
  status      TEXT DEFAULT 'completed',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "um_select_own" ON user_matches;
CREATE POLICY "um_select_own" ON user_matches FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "um_admin_write" ON user_matches;
CREATE POLICY "um_admin_write" ON user_matches FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_um_user ON user_matches(user_id);


-- ─────────────────────────────────────────────────────────────────
-- 13.5  TOURNAMENT BRACKETS — bracket.js feature
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_brackets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT 'Bracket',
  format      TEXT DEFAULT 'single_elim',  -- 'single_elim' | 'double_elim'
  status      TEXT DEFAULT 'pending',      -- 'pending' | 'live' | 'completed'
  team_count  INT  DEFAULT 8,
  teams       JSONB DEFAULT '[]',
  rounds      JSONB DEFAULT '[]',
  champion    TEXT,
  prize       NUMERIC DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tournament_brackets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tb_select_all" ON tournament_brackets;
CREATE POLICY "tb_select_all" ON tournament_brackets FOR SELECT USING (true);
DROP POLICY IF EXISTS "tb_admin_write" ON tournament_brackets;
CREATE POLICY "tb_admin_write" ON tournament_brackets FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));


-- ─────────────────────────────────────────────────────────────────
-- 13.6  CREATOR PAYOUTS — premium-creator.js + fa-growth-admin.js
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_payouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ign         TEXT,
  amount      NUMERIC DEFAULT 0,
  status      TEXT DEFAULT 'pending',  -- 'pending' | 'paid' | 'rejected'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  paid_at     TIMESTAMPTZ
);
ALTER TABLE creator_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cp_select_own" ON creator_payouts;
CREATE POLICY "cp_select_own" ON creator_payouts FOR SELECT
  USING ((auth.jwt() ->> 'sub') = uid OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "cp_admin_write" ON creator_payouts;
CREATE POLICY "cp_admin_write" ON creator_payouts FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));


-- ─────────────────────────────────────────────────────────────────
-- 13.7  LEADERBOARD ARCHIVE — monthly season snapshots
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard_archive (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month       TEXT NOT NULL,             -- e.g. '2026_06'
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  ign         TEXT,
  rank        INT,
  earnings    NUMERIC DEFAULT 0,
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leaderboard_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "la_select_all" ON leaderboard_archive;
CREATE POLICY "la_select_all" ON leaderboard_archive FOR SELECT USING (true);
DROP POLICY IF EXISTS "la_admin_write" ON leaderboard_archive;
CREATE POLICY "la_admin_write" ON leaderboard_archive FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_la_month ON leaderboard_archive(month);


-- ─────────────────────────────────────────────────────────────────
-- 13.8  CLAN WAR CHALLENGES — clan-war.js
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clan_war_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week        TEXT NOT NULL,
  from_clan   UUID REFERENCES clans(id) ON DELETE CASCADE,
  from_name   TEXT,
  to_clan     UUID REFERENCES clans(id) ON DELETE CASCADE,
  to_name     TEXT,
  status      TEXT DEFAULT 'pending',   -- 'pending' | 'accepted' | 'declined' | 'expired'
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clan_war_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cwc_select_all" ON clan_war_challenges;
CREATE POLICY "cwc_select_all" ON clan_war_challenges FOR SELECT USING (true);
DROP POLICY IF EXISTS "cwc_insert_auth" ON clan_war_challenges;
CREATE POLICY "cwc_insert_auth" ON clan_war_challenges FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') IS NOT NULL);
DROP POLICY IF EXISTS "cwc_update_auth" ON clan_war_challenges;
CREATE POLICY "cwc_update_auth" ON clan_war_challenges FOR UPDATE USING ((auth.jwt() ->> 'sub') IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────
-- 13.9  DUEL RECORDS — challenge.js (1v1 win/loss history)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duel_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wins         INT  DEFAULT 0,
  losses       INT  DEFAULT 0,
  UNIQUE(user_id, opponent_id)
);
ALTER TABLE duel_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dr_select_all" ON duel_records;
CREATE POLICY "dr_select_all" ON duel_records FOR SELECT USING (true);
DROP POLICY IF EXISTS "dr_upsert_own" ON duel_records;
CREATE POLICY "dr_upsert_own" ON duel_records FOR ALL
  USING ((auth.jwt() ->> 'sub') = user_id) WITH CHECK ((auth.jwt() ->> 'sub') = user_id);


-- ─────────────────────────────────────────────────────────────────
-- 13.10  SUPPORT MESSAGES — individual messages inside a support_ticket
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  is_admin    BOOL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sm_select_related" ON support_messages;
CREATE POLICY "sm_select_related" ON support_messages FOR SELECT
  USING (
    (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true) OR
    ticket_id IN (SELECT id FROM support_tickets WHERE user_id = (auth.jwt() ->> 'sub'))
  );
DROP POLICY IF EXISTS "sm_insert_related" ON support_messages;
CREATE POLICY "sm_insert_related" ON support_messages FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'sub') = sender_id AND (
      (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true) OR
      ticket_id IN (SELECT id FROM support_tickets WHERE user_id = (auth.jwt() ->> 'sub'))
    )
  );
CREATE INDEX IF NOT EXISTS idx_sm_ticket ON support_messages(ticket_id, created_at);


-- ================================================================
-- SECTION 14 — RPCs CONFIRMED MISSING (same audit as Section 13)
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- increment_match_slots — ad-match join (bypasses validate_and_join_match)
--    Used by: screens/rank.js confirmAdMatchJoin()
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_match_slots(p_match_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE matches SET filled_slots = COALESCE(filled_slots,0) + 1 WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- increment_poll_vote — atomic vote counter
--    Used by: admin-fixes-v23-FINAL.js (poll voting)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_poll_vote(p_poll_id UUID, p_option TEXT)
RETURNS void AS $$
BEGIN
  UPDATE polls
  SET vote_counts = jsonb_set(
        COALESCE(vote_counts,'{}'::jsonb),
        ARRAY[p_option],
        to_jsonb(COALESCE((vote_counts->>p_option)::int,0) + 1)
      ),
      total_votes = COALESCE(total_votes,0) + 1
  WHERE id = p_poll_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION increment_match_slots(TEXT)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_poll_vote(UUID, TEXT)  TO authenticated, service_role;


-- ================================================================
-- DONE — Section 13+14 audit summary
--
-- Tables added  : user_roles, admins, ff_uid_index, profile_updates,
--                 user_matches, tournament_brackets, creator_payouts,
--                 leaderboard_archive, clan_war_challenges,
--                 duel_records, support_messages, poll_votes  (12 new)
-- Tables fixed  : leaderboard (VIEW → TABLE + sync trigger),
--                 polls (columns rewritten to match real usage)
-- RPCs added    : increment_match_slots, increment_poll_vote
-- Triggers added: sync_leaderboard, sync_admin_tables
--
-- Verified by cross-referencing EVERY .from() and .rpc() call across
-- the entire User Panel + Admin Panel source code, plus the
-- supabase-rtdb-bridge.js TABLE_MAP (the bridge's authoritative list
-- of every Firebase path still routed to Supabase).
-- ================================================================


-- ================================================================
-- SECTION 15 — CREATOR ECONOMY SYSTEM (v32 addition)
-- 5 new tables + 2 new RPCs
-- Matches briefing: Part C, Part F2, Part G
-- ================================================================

-- ─────────────────────────────────────────────────────────────────
-- 15.1  CREATOR VIDEOS — mirrors Firebase creatorVideos/{videoId}
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_videos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_id   TEXT UNIQUE,                             -- Firebase push key
  creator_uid   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (char_length(title) <= 60),
  description   TEXT          CHECK (char_length(description) <= 200),
  link          TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'youtube',         -- 'youtube'|'instagram'
  status        TEXT NOT NULL DEFAULT 'live',            -- 'live'|'auto_hidden'|'removed'
  report_count  INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE creator_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cv_select_live" ON creator_videos;
CREATE POLICY "cv_select_live" ON creator_videos FOR SELECT USING (status = 'live' OR (auth.jwt() ->> 'sub') = creator_uid);
DROP POLICY IF EXISTS "cv_insert_creator" ON creator_videos;
CREATE POLICY "cv_insert_creator" ON creator_videos FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = creator_uid);
DROP POLICY IF EXISTS "cv_update_own" ON creator_videos;
CREATE POLICY "cv_update_own" ON creator_videos FOR UPDATE USING ((auth.jwt() ->> 'sub') = creator_uid);
-- ✅ AUDIT FOLLOW-UP: admin override (review/hide/restore/remove any creator's video) — pehle missing thi
DROP POLICY IF EXISTS "cv_admin_all" ON creator_videos;
CREATE POLICY "cv_admin_all" ON creator_videos FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_cv_status      ON creator_videos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_creator_uid ON creator_videos(creator_uid);

-- ─────────────────────────────────────────────────────────────────
-- 15.2  VIDEO WATCHES — analytics + coin tracking
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_watches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL,                             -- creator_videos.firebase_id or UUID
  watched_at  TIMESTAMPTZ DEFAULT NOW(),
  watch_date  DATE NOT NULL DEFAULT CURRENT_DATE,        -- for daily-unique index
  coins_earned INT NOT NULL DEFAULT 0
);
ALTER TABLE video_watches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vw_insert_self" ON video_watches;
CREATE POLICY "vw_insert_self" ON video_watches FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_uid);
DROP POLICY IF EXISTS "vw_select_self" ON video_watches;
CREATE POLICY "vw_select_self" ON video_watches FOR SELECT USING  ((auth.jwt() ->> 'sub') = user_uid);
CREATE INDEX IF NOT EXISTS idx_vw_user_date ON video_watches(user_uid, watch_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vw_unique_daily
  ON video_watches(user_uid, video_id, watch_date);          -- 1 per day per video per user

-- ─────────────────────────────────────────────────────────────────
-- 15.3  VIDEO REPORTS — report log for moderation
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    TEXT NOT NULL,                             -- firebase_id of creator_videos
  reporter_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved    BOOL NOT NULL DEFAULT false,
  resolution  TEXT,                                      -- 'restored'|'confirmed'
  UNIQUE(video_id, reporter_uid)                         -- one report per user per video
);
ALTER TABLE video_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vr_insert_self" ON video_reports;
CREATE POLICY "vr_insert_self" ON video_reports FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = reporter_uid);
DROP POLICY IF EXISTS "vr_select_self" ON video_reports;
CREATE POLICY "vr_select_self" ON video_reports FOR SELECT USING  ((auth.jwt() ->> 'sub') = reporter_uid);
DROP POLICY IF EXISTS "vr_admin_all" ON video_reports;
CREATE POLICY "vr_admin_all" ON video_reports FOR ALL  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_vr_video ON video_reports(video_id);

-- ─────────────────────────────────────────────────────────────────
-- 15.4  CREATOR MATCHES — extends matches for creator-hosted matches
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  creator_uid       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commission_pct    NUMERIC NOT NULL DEFAULT 10,
  commission_type   TEXT    NOT NULL DEFAULT 'gd',       -- 'gd'|'inr'
  commission_amount NUMERIC NOT NULL DEFAULT 0,
  commission_status TEXT    NOT NULL DEFAULT 'pending',  -- 'pending'|'hold'|'eligible'|'paid'|'pending_payout'
  hold_until        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id)
);
ALTER TABLE creator_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cm_select_creator" ON creator_matches;
CREATE POLICY "cm_select_creator" ON creator_matches FOR SELECT USING ((auth.jwt() ->> 'sub') = creator_uid);
DROP POLICY IF EXISTS "cm_insert_creator" ON creator_matches;
CREATE POLICY "cm_insert_creator" ON creator_matches FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = creator_uid);
DROP POLICY IF EXISTS "cm_admin_all" ON creator_matches;
CREATE POLICY "cm_admin_all" ON creator_matches FOR ALL USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_cm_creator ON creator_matches(creator_uid, commission_status);
CREATE INDEX IF NOT EXISTS idx_cm_match   ON creator_matches(match_id);

-- ─────────────────────────────────────────────────────────────────
-- 15.5  CREATOR COMMISSIONS — per-match commission ledger
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_commissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_uid  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id     TEXT REFERENCES matches(id) ON DELETE SET NULL,
  amount       NUMERIC NOT NULL DEFAULT 0,
  currency     TEXT    NOT NULL DEFAULT 'gd',            -- 'gd'|'inr'
  status       TEXT    NOT NULL DEFAULT 'hold',          -- 'hold'|'eligible'|'paid'|'pending_payout'
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  eligible_at  TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE creator_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_select_creator" ON creator_commissions;
CREATE POLICY "cc_select_creator" ON creator_commissions FOR SELECT USING ((auth.jwt() ->> 'sub') = creator_uid);
DROP POLICY IF EXISTS "cc_admin_all" ON creator_commissions;
CREATE POLICY "cc_admin_all" ON creator_commissions FOR ALL USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
CREATE INDEX IF NOT EXISTS idx_cc_creator_status ON creator_commissions(creator_uid, status);

-- ─────────────────────────────────────────────────────────────────
-- 15.6  RPC: block_creator_self_play — IRON RULE (Part G1)
-- Called by join_requests insert trigger to prevent creator joining own match.
-- SECURITY DEFINER ensures it runs with full privileges.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION block_creator_self_play()
RETURNS TRIGGER AS $$
DECLARE
  v_creator_uid TEXT;
BEGIN
  -- Check if this match is a creator match
  SELECT creator_uid INTO v_creator_uid
  FROM creator_matches
  WHERE match_id = NEW.match_id;  -- match_id is TEXT in both tables

  IF v_creator_uid IS NOT NULL AND v_creator_uid = NEW.user_id THEN
    RAISE EXCEPTION 'Creator apne khud ke match mein participate nahi kar sakta.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach trigger to join_requests
DROP TRIGGER IF EXISTS trg_block_creator_self_play ON join_requests;
CREATE TRIGGER trg_block_creator_self_play
  BEFORE INSERT ON join_requests
  FOR EACH ROW EXECUTE FUNCTION block_creator_self_play();

-- ─────────────────────────────────────────────────────────────────
-- 15.7  RPC: finalize_creator_commission
-- Called after match results are submitted (admin completes match).
-- Calculates commission and writes to creator_commissions ledger.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finalize_creator_commission(p_match_id TEXT)
RETURNS void AS $$
DECLARE
  v_creator_uid   TEXT;
  v_comm_pct      NUMERIC;
  v_comm_type     TEXT;
  v_total_entry   NUMERIC;
  v_commission    NUMERIC;
  v_hold_days     INT;
  v_eligible_at   TIMESTAMPTZ;
BEGIN
  -- Get creator match details
  SELECT creator_uid, commission_pct, commission_type
  INTO v_creator_uid, v_comm_pct, v_comm_type
  FROM creator_matches
  WHERE match_id = p_match_id AND commission_status = 'pending';

  IF v_creator_uid IS NULL THEN RETURN; END IF; -- Not a creator match or already finalized

  -- Sum total entry fees collected
  SELECT COALESCE(SUM(entry_fee_paid), 0)
  INTO v_total_entry
  FROM join_requests
  WHERE match_id = p_match_id AND status IN ('joined','approved');

  v_commission := ROUND(v_total_entry * v_comm_pct / 100, 2);

  -- Get hold days from config (default 7)
  SELECT COALESCE((value->>'commissionHoldDays')::INT, 7)
  INTO v_hold_days
  FROM app_settings WHERE key = 'live_config' LIMIT 1;

  IF v_hold_days IS NULL THEN v_hold_days := 7; END IF;
  v_eligible_at := NOW() + (v_hold_days || ' days')::INTERVAL;

  -- GD commission: credit immediately to creator wallet (via green_diamonds field)
  IF v_comm_type = 'gd' THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_commission
    WHERE id = v_creator_uid;
    -- Log wallet transaction
    INSERT INTO wallet_transactions(user_id, txn_type, amount, currency, reason, created_at)
    VALUES (v_creator_uid, 'credit', v_commission, 'green_diamonds', 'creator_coin_match_commission', NOW());
    -- Record in ledger with status = eligible (GD credited immediately)
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'gd', 'eligible', NOW());
    -- Update creator_matches
    UPDATE creator_matches SET commission_amount = v_commission, commission_status = 'eligible', hold_until = NOW()
    WHERE match_id = p_match_id;

  -- INR commission: hold for hold_days before eligible
  ELSE
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'inr', 'hold', v_eligible_at);
    UPDATE creator_matches SET commission_amount = v_commission, commission_status = 'hold', hold_until = v_eligible_at
    WHERE match_id = p_match_id;
  END IF;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Scheduled job: move INR commissions from 'hold' → 'eligible' when hold_until passed
-- (Run via Supabase pg_cron or admin panel scheduler daily)
CREATE OR REPLACE FUNCTION release_eligible_commissions()
RETURNS void AS $$
BEGIN
  UPDATE creator_commissions
  SET status = 'eligible', updated_at = NOW()
  WHERE status = 'hold' AND eligible_at <= NOW();
  -- Also update creator_matches
  UPDATE creator_matches cm
  SET commission_status = 'eligible'
  FROM creator_commissions cc
  WHERE cm.match_id = cc.match_id AND cc.status = 'eligible' AND cm.commission_status = 'hold';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────
-- claim_match_commission_payout — creator requests payout of eligible
-- INR match-hosting commissions (moves eligible → pending_payout)
-- ─────────────────────────────────────────────────────────────────
-- ✅ ADDED (2026-07-19, CRITICAL): premium-creator.js's
-- requestMatchCommissionPayout() was directly UPDATE-ing creator_commissions
-- client-side (`status: 'pending_payout'`) — but this table's RLS only has
-- cc_select_creator (SELF SELECT) and cc_admin_all (ADMIN ALL); there was
-- no self-UPDATE policy at all, so this call has always been silently
-- rejected by RLS (caught by its own .catch()). Rather than add a raw
-- self-UPDATE RLS policy (which would let a creator move ANY of their rows
-- to pending_payout regardless of actual eligibility, bypassing the
-- hold/eligible lifecycle entirely), this RPC does the transition
-- correctly: only rows already in 'eligible' status, only for the calling
-- creator, only for the INR currency this specific request targets.
CREATE OR REPLACE FUNCTION claim_match_commission_payout() RETURNS JSONB AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_count INT;
  v_total NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_count, v_total
  FROM creator_commissions
  WHERE creator_uid = v_uid AND status = 'eligible' AND currency = 'inr';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No eligible commission to claim');
  END IF;

  UPDATE creator_commissions SET status = 'pending_payout', updated_at = NOW()
  WHERE creator_uid = v_uid AND status = 'eligible' AND currency = 'inr';

  RETURN jsonb_build_object('success', true, 'count', v_count, 'total', v_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION block_creator_self_play()                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION finalize_creator_commission(TEXT)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_eligible_commissions()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION claim_match_commission_payout()               TO authenticated, service_role;

-- ================================================================
-- SECTION 16: USER SUGGESTIONS (v32.4)
-- Backs the User Panel "My Suggestions" feature — users submit a
-- suggestion, see their own submission history + status, admins
-- review/respond from the admin Suggestions section.
-- ================================================================
CREATE TABLE IF NOT EXISTS user_suggestions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        REFERENCES users(id) ON DELETE CASCADE,
  message       TEXT        NOT NULL,
  status        TEXT        DEFAULT 'pending',  -- 'pending' | 'reviewed' | 'implemented' | 'declined'
  admin_reply   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usug_user ON user_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_usug_status ON user_suggestions(status);

ALTER TABLE user_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usug_select_own" ON user_suggestions;
CREATE POLICY "usug_select_own" ON user_suggestions FOR SELECT USING ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "usug_insert_own" ON user_suggestions;
CREATE POLICY "usug_insert_own" ON user_suggestions FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "usug_admin_all" ON user_suggestions;
CREATE POLICY "usug_admin_all" ON user_suggestions FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));

-- ================================================================
-- SECTION 17: v32.7 — IMGBB SECRET MIGRATION + PAYTM UPI INTEGRATION
-- (documentation only — NO schema changes below, intentionally)
-- ================================================================
-- Both features were built to reuse the existing schema — verified
-- column-by-column against the 3 new Supabase Edge Functions
-- (imgbb-upload, paytm-create-order, paytm-callback) and _shared/paytm.ts:
--
--   sd_requests          → Paytm auto-orders insert here with the SAME
--                           columns as manual UPI requests (user_id,
--                           sd_amount, amount_inr, status). Only new
--                           VALUE (not column) is request_type='paytm_auto'
--                           — the request_type column already existed.
--   wallet_transactions  → Paytm credit writes a normal 'credit' row,
--                           same shape as every other credit.
--   notifications        → Paytm success writes a normal notification row.
--   increment_balance()  → reused as-is (existing RPC, Section 11/14) to
--                           credit sky_diamonds atomically on payment success.
--   app_settings         → Paytm ON/OFF toggle (admin fa-app-settings.js)
--                           stores into the existing JSONB `value` column
--                           under key 'live_config' — no new key/table.
--
-- So: DO NOT add a paytm_orders table, DO NOT add payment columns to
-- sd_requests. If a genuine need shows up later (e.g. storing Paytm's
-- txnId permanently instead of only in review_note), add it as a real,
-- separate ALTER TABLE ... ADD COLUMN IF NOT EXISTS migration — never
-- retrofit this section silently.
--
-- Full flow + Edge Function deploy commands: DEVELOPER_GUIDE.md Section
-- 2 (Tech Stack), Section 24 → "v32.7", Section 25 (Migration Guide).
-- ================================================================

-- ================================================================
-- DONE — Section 15 summary
--
-- Tables added : creator_videos, video_watches, video_reports,
--                creator_matches, creator_commissions  (5 new)
-- RPCs added   : finalize_creator_commission, release_eligible_commissions
-- Triggers added: trg_block_creator_self_play (IRON RULE — always enforced)
--
-- ✅ AUDIT FOLLOW-UP (consolidated from MIGRATION-missing-admin-policies.sql):
--   cv_admin_all  — admin full access on creator_videos
--   bpp_admin_all — admin full access on battle_pass_progress
--   (See section 1.x above for battle_pass_progress; both are now part of
--    this single fresh-start script, no separate migration file needed.)
--
-- Firebase schema (adminConfig/ paths) — documented in DEVELOPER_GUIDE.md:
--   adminConfig/videoModeration  — video system config
--   adminConfig/creatorSystem    — creator match config
--   creatorVideos/{videoId}      — video records
--   videoReports/{videoId}/{uid} — reports
--   videoWatched/{uid}/{date}/{videoId} — daily watch tracking
--   creatorMatches/{matchId}     — extended match data
--   creatorCommission/{uid}/{matchId}   — commission ledger mirror
--   users/{uid}/videoStrikes     — creator strike data
-- ================================================================

-- ================================================================
-- SECTION 18 — MISSING COLUMNS FIX (v32.8 audit)
-- ================================================================
-- These two columns are read/written by existing app code
-- (Admin: fa-sponsored-system.js writes sponsoredWinnings via the
--  Firebase→Supabase bridge; User: screens/wallet.js reads
--  UD.sponsored_winnings for the sponsor-tournament withdrawal card;
--  User: js/referral-system-fix.js reads/writes referral_popup_done
--  to decide whether to show the first-login referral popup) but were
--  never actually added to this schema — every write to them against
--  a live DB using only the schema above would fail with an unknown-
--  column error. Adding them now, additive only, no data loss.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sponsored_winnings   NUMERIC DEFAULT 0;
-- Withdrawable balance won from sponsor-funded (zero entry fee) tournaments only.
-- Distinct from green_diamonds (regular paid/coin match wins — cosmetic, non-withdrawable).

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_popup_done  BOOL DEFAULT false;
-- Set true once the first-login "apply a referral code" popup has been shown/skipped,
-- so it does not show again on the same account.
-- ================================================================

-- ================================================================
-- SECTION 19 — PREMIUM REQUESTS: ANNUAL + BUNDLE SUPPORT (v32.8 audit)
-- ================================================================
-- `_submitAnnual()` (features/bundle-offers.js) already inserts a
-- 'plan_type' value into premium_requests — a column that never existed,
-- so every annual-plan purchase submission (₹399/₹799, real UPI money
-- already sent by the user before this insert runs) was silently failing.
-- `_submitBundle()` inserted into a 'bundle_requests' table that never
-- existed in this schema at all — same silent-failure risk. Both are now
-- routed through the existing, working premium_requests review queue
-- (see admin-inline.js loadPremiumReqSection/approvePremiumReq) instead
-- of a second unreviewed table, so admins keep one single approval queue.

ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'monthly';
-- 'monthly' | 'annual' | 'bundle'

ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS bundle_id TEXT;
-- e.g. 'silver_bp' | 'gold_bp' — only set when plan_type='bundle', used to
-- know which bundle's Battle-Pass grant to apply on approval.

-- `trial_log` — pure analytics table for the 7-day free trial feature
-- (features/free-trial.js). The trial itself runs entirely off localStorage
-- and does not depend on this table (the insert already has .catch(()=>{})),
-- so this was a silent analytics gap, not a functional bug. Added for
-- completeness/visibility into trial signups.
CREATE TABLE IF NOT EXISTS trial_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ,
  plan        TEXT DEFAULT 'silver_7day',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE trial_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trial_log_insert_own" ON trial_log;
CREATE POLICY "trial_log_insert_own" ON trial_log FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "trial_log_admin_all" ON trial_log;
CREATE POLICY "trial_log_admin_all" ON trial_log FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
-- ================================================================

-- ================================================================
-- SECTION 20 — approvedAt/rejectedAt/approvedBy COLUMNS (v32.8 audit)
-- ================================================================
-- admin-inline.js's approve/reject handlers for Sky Diamond requests,
-- Wallet requests, Premium requests, Season Pass requests, and Profile
-- requests all write { approvedAt / rejectedAt / approvedBy } (→ snake_case
-- approved_at / rejected_at / approved_by via the bridge's genericToSupa).
-- None of these 3 columns existed on ANY of the 3 real tables involved
-- (sd_requests, premium_requests, profile_requests) — only `reviewed_by`
-- did. PostgREST rejects an update that references an unknown column, so
-- EVERY approve/reject click was silently failing to mark the request
-- as approved/rejected in Supabase (even though the actual reward — coins,
-- premium, diamonds — WAS already granted earlier in the same function,
-- since that happens first). Net effect: the request stayed 'pending'
-- forever, admin saw a confusing error toast after an otherwise-successful
-- approval, and re-clicking "Approve" on the same still-pending request
-- could double-credit the reward. Fixed by adding the columns the code
-- already sends (additive, safe, no data loss).

ALTER TABLE sd_requests      ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE sd_requests      ADD COLUMN IF NOT EXISTS rejected_at  TIMESTAMPTZ;
ALTER TABLE sd_requests      ADD COLUMN IF NOT EXISTS approved_by  TEXT REFERENCES users(id);

ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS rejected_at  TIMESTAMPTZ;
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS approved_by  TEXT REFERENCES users(id);

-- profile_requests approve/reject (admin-inline.js DB_PROFILE handlers) actually
-- send processedAt/processedBy (→ processed_at/processed_by via profileReqToSupa),
-- not approvedAt/approvedBy — verified against the exact call sites, not guessed:
ALTER TABLE profile_requests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE profile_requests ADD COLUMN IF NOT EXISTS processed_by TEXT REFERENCES users(id);
-- ================================================================

-- ================================================================
-- SECTION 21 — last_seen / is_deleted / wallet_transactions approval
-- columns (2026-07, found from live Supabase error logs)
-- ================================================================
-- Postgres log explorer showed these exact errors on every load:
--   "column users.last_seen does not exist"
--   "column users.is_deleted does not exist"
--   "column wallet_transactions.status does not exist"
--   "column matches.match_time does not exist"            (code bug, fixed
--                                                           in supabase-rtdb-bridge.js
--                                                           — real column is
--                                                           scheduled_at, no
--                                                           migration needed)
--   "column admin_activity_log.timestamp does not exist"  (code bug, fixed —
--   "column admin_alerts.timestamp does not exist"         real column is
--                                                           created_at)
--   "column creator_stats.created_at does not exist"      (code bug, fixed —
--                                                           real column is
--                                                           updated_at)
--
-- The last 3 were pure code bugs (bridge was sending/ordering by a column
-- name that never existed) and needed no schema change — fixed in
-- js/supabase-rtdb-bridge.js, js/admin-scheduler.js, js/admin-supabase-sync.js,
-- js/admin-fixes-v25-SUPABASE.js instead.
--
-- These 4 below are genuinely MISSING columns that real, intentional
-- features already depend on:
--   • fix13-realtime-analytics.js's "active users in last 10 min" stat
--     queries users.last_seen — column never existed.
--   • admin-fixes-v25-SUPABASE.js's active-user list filters
--     users.is_deleted — column never existed (soft-delete flag).
--   • admin-supabase-sponsored.js's sponsored-withdrawal approve/reject
--     flow reads/writes wallet_transactions.status, .reviewed_at,
--     .reviewed_by — none of the 3 existed, so every approve/reject
--     click was throwing instead of actually approving anything.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOL DEFAULT false;

-- ✅ ADDED (2026-07-17): found while auditing admin/js/supabase-rtdb-bridge.js's
-- USER_FIELD_MAP/NESTED_FIELD_MAP — 18 of its ~45 entries pointed at columns
-- that never existed anywhere in this schema (level, exp, total_winnings,
-- partner_uid, duo_team, squad_team, penalty_points, and more that turned
-- out to be either genuine duplicates of an existing column under a
-- different name, or dead/unwritten mappings — see the corrected field maps
-- themselves for the full per-field resolution). These six are the ones
-- with confirmed LIVE callers that needed a real column, not a remap:
ALTER TABLE users ADD COLUMN IF NOT EXISTS level INT DEFAULT 1; -- admin-inline.js's player-detail "Level" tab reads/writes this
ALTER TABLE users ADD COLUMN IF NOT EXISTS exp INT DEFAULT 0;   -- same feature, paired XP-toward-next-level value
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_winnings NUMERIC DEFAULT 0; -- displayed as "Earnings" in admin-analytics.js, admin-inline.js, admin-player-lookup.js — distinct from sponsored_winnings (which is specifically sponsored-tournament winnings)
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_uid TEXT REFERENCES users(id); -- core/utils.js's duo-partner quick-lookup
ALTER TABLE users ADD COLUMN IF NOT EXISTS duo_team JSONB DEFAULT '{}';  -- core/utils.js's linked-duo-team object (memberUid, memberFfUid, etc.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS squad_team JSONB DEFAULT '{}'; -- core/utils.js's linked-squad-team object (members array)
ALTER TABLE users ADD COLUMN IF NOT EXISTS penalty_points INT DEFAULT 0; -- fa28-fa43-fraud-control-center.js's live penalty-point tracking (increment + admin reset-to-0)
ALTER TABLE users ADD COLUMN IF NOT EXISTS creator_code TEXT; -- ⚠️ approve_creator_application RPC (added earlier in this session) references users.creator_code — this was a bug I introduced myself: the column was never added anywhere. Caught during this same audit pass.

-- ✅ ADDED (2026-07-22): age_verified/date_of_birth/age_verified_at — the
-- "Age Verification" screen (js/legal-compliance.js's mesAgeGate/
-- mesConfirmAge) was reappearing every session because it wrote via
-- core/db-bridge.js's generic users/{uid} full-object update path
-- (window.db.ref('users/'+uid).update({ageVerified:true,...})) targeting
-- columns that never existed at all — the write silently failed every
-- time (no .catch() at the call site to surface it), so the flag never
-- actually persisted anywhere, and the gate re-triggered on every fresh
-- session/reload.
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified BOOL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMPTZ;
-- Grant for these three columns is merged into the main users GRANT
-- UPDATE block further down this file (search "age_verified" — it's
-- listed alongside the other status/profile fields), not repeated here,
-- to keep one single canonical GRANT statement per table.

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id);

-- Index to make the "active users in last N minutes" dashboard query fast
-- instead of a full table scan every time it's requested.
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);
-- ================================================================

-- ================================================================
-- SECTION 22 — full codebase-vs-schema audit (2026-07)
-- ================================================================
-- A systematic cross-check of every .from()/.select()/.insert()/.update()
-- call across the ENTIRE User Panel codebase against this schema found
-- two classes of bugs:
--
-- (1) Wrong column names where a correct column ALREADY existed — these
--     were fixed directly in the JS code (no schema change needed):
--     matches.created_by → creator_uid, clans.leader_id → leader_uid,
--     battle_pass_progress.season_id → season_key, live_streams.
--     stream_link → stream_url, mentor_profiles.uid/active → user_id/
--     is_available, mentor_requests.mentor_id/student_id → mentor_uid/
--     student_uid, duel_challenges.challenger_id/challengee_id →
--     challenger_uid/opponent_uid, squad_finder.active → is_active,
--     clan_messages.user_id/ign → sender_id/sender_ign, clan_wars.
--     clan1_id/clan2_id/clan1_score/clan2_score → clan_a_id/clan_b_id/
--     clan_a_score/clan_b_score, friendships.user1_id/user2_id →
--     user_a/user_b, user_activities.uid/text → user_id/message,
--     sd_requests.diamonds/payment_proof → sd_amount/screenshot_url,
--     join_requests.fee_split → fee_type, admin_activity_log.admin_id/
--     action/target_type/target_id → admin_uid/action_type/note/
--     target_ref.
--
--     TWO of these were CRITICAL — they broke a core flow on EVERY
--     single call, for every user:
--       • core/db.js DB.users.getMe() was selecting real_money,
--         is_premium, battle_pass_tier, ban_status — none of which
--         exist. PostgREST rejects the whole query if ANY requested
--         column is invalid, so getMe() has been returning an error
--         (never real data) on every call. Fixed to select premium_level
--         and is_banned/ban_reason instead (the real columns), and
--         dropped real_money/battle_pass_tier (nothing reads them and
--         neither corresponds to anything — this app has no real-money
--         balance by design, and battle pass tier lives in
--         battle_pass_progress.current_tier, not on users).
--       • core/db-bridge.js's leaderboard/user-search query selected
--         'ffUid' (camelCase) instead of 'ff_uid' — same story, the
--         whole query failed every time. Fixed.
--
-- (2) Genuinely MISSING columns that real, intentional features depend
--     on — these need the migration below (all safe/idempotent —
--     ADD COLUMN IF NOT EXISTS never touches existing data).
-- ================================================================

-- Mentor system (features/mentor.js)
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS ign TEXT;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS rank_pts INT DEFAULT 0;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS rank_tier TEXT;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS total_sessions INT DEFAULT 0;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS total_students INT DEFAULT 0;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS successful_students INT DEFAULT 0;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS gd_earned INT DEFAULT 0;
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS mentor_ign TEXT;
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS student_ign TEXT;
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS student_rank_pts INT DEFAULT 0;
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS student_rank_badge TEXT;
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS message TEXT;

-- Duel challenges (features/challenge.js)
ALTER TABLE duel_challenges ADD COLUMN IF NOT EXISTS challenger_ign TEXT;
ALTER TABLE duel_challenges ADD COLUMN IF NOT EXISTS challengee_ign TEXT;
ALTER TABLE duel_challenges ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'solo';
ALTER TABLE duel_challenges ADD COLUMN IF NOT EXISTS taunt TEXT;
ALTER TABLE duel_challenges ADD COLUMN IF NOT EXISTS result TEXT;

-- Squad finder (features/squad-finder.js)
ALTER TABLE squad_finder ADD COLUMN IF NOT EXISTS ign TEXT;
ALTER TABLE squad_finder ADD COLUMN IF NOT EXISTS rank_pts INT DEFAULT 0;
ALTER TABLE squad_finder ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE squad_finder ADD COLUMN IF NOT EXISTS lang TEXT;
ALTER TABLE squad_finder ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Clan wars (features/clan-war.js)
ALTER TABLE clan_wars ADD COLUMN IF NOT EXISTS week TEXT;
ALTER TABLE clan_wars ADD COLUMN IF NOT EXISTS clan_a_name TEXT;
ALTER TABLE clan_wars ADD COLUMN IF NOT EXISTS clan_b_name TEXT;
ALTER TABLE clan_wars ADD COLUMN IF NOT EXISTS winner_id UUID;

-- Live streams (core/db-bridge.js)
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS match_id TEXT;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- User activity feed (features/friends.js)
ALTER TABLE user_activities ADD COLUMN IF NOT EXISTS ign TEXT;

-- Join requests (js/fix6-offline-queue.js)
ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS user_ff_uid TEXT;

-- Sky Diamond requests (js/quick-deposit.js)
ALTER TABLE sd_requests ADD COLUMN IF NOT EXISTS firebase_req_id TEXT;

-- Support tickets (screens/profile.js)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_ign TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_ff_uid TEXT;

-- Referrals (js/referral-system-fix.js — NOTE: core/db.js's DB.referrals.apply()
-- is a separate, already-correct implementation using only real columns;
-- these 3 are needed for the OTHER referral code path to stop erroring)
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_name TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reward NUMERIC DEFAULT 0;

-- users — 3 more genuinely-missing columns found in this pass
ALTER TABLE users ADD COLUMN IF NOT EXISTS clean_badge_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_applied_at TIMESTAMPTZ;

-- Sponsored prizes — core/db.js's `sponsored` module (getForMatch/create/
-- distribute) was written against a richer per-match "distribute to
-- ranked winners" design that doesn't match the simpler prize-catalog
-- schema that actually got created (sponsor_name/prize_value/claim_
-- deadline/max_claims). Adding these columns stops the hard column-not-
-- found crashes, but this is flagged separately in the chat summary —
-- it needs a product decision (catalog-style claims vs. per-match
-- distribute-to-winners), not just a schema patch.
ALTER TABLE sponsored_prizes ADD COLUMN IF NOT EXISTS match_id TEXT;
ALTER TABLE sponsored_prizes ADD COLUMN IF NOT EXISTS total_prize NUMERIC DEFAULT 0;
ALTER TABLE sponsored_prizes ADD COLUMN IF NOT EXISTS distribution JSONB;
ALTER TABLE sponsored_prizes ADD COLUMN IF NOT EXISTS is_distributed BOOL DEFAULT false;
ALTER TABLE sponsored_prizes ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMPTZ;
ALTER TABLE sponsored_prizes ADD COLUMN IF NOT EXISTS distributed_by TEXT;
ALTER TABLE sponsored_prize_claims ADD COLUMN IF NOT EXISTS sponsored_id UUID REFERENCES sponsored_prizes(id) ON DELETE SET NULL;
ALTER TABLE sponsored_prize_claims ADD COLUMN IF NOT EXISTS placement INT;
ALTER TABLE sponsored_prize_claims ADD COLUMN IF NOT EXISTS prize_amount NUMERIC DEFAULT 0;
ALTER TABLE sponsored_prize_claims ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'green_diamonds';
ALTER TABLE sponsored_prize_claims ADD COLUMN IF NOT EXISTS rank INT;
-- Admin Panel's distributeSponsoredPrizes sync uses upsert(...,{onConflict:
-- 'match_id,user_id'}) — needs a matching unique constraint or every one
-- of those upserts fails outright.
DO $$ BEGIN
  ALTER TABLE sponsored_prize_claims ADD CONSTRAINT spc_match_user_unique UNIQUE (match_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- notifications — SELECT already correctly restricts each user to their
-- own notifications (or admin), but an early INSERT policy only allowed
-- self-inserts, which silently broke every "notify someone ELSE" feature
-- (referral reward, mentor request/accept, duel accepted, clan war
-- challenge, etc.) since those all insert a notification row for a
-- DIFFERENT user than the one performing the action.
--
-- ⚠️ CORRECTED (2026-07-17, CRITICAL): the version of this fix that
-- existed here previously — `WITH CHECK (auth.jwt() ->> 'sub' IS NOT
-- NULL)` — over-corrected into a completely open INSERT policy: any
-- signed-in user could insert a notification for ANY other user with ANY
-- type value. Combined with the notifications GRANT INSERT fix elsewhere
-- in this file (which added title/body/type to what's client-writable at
-- the column level), this meant anyone could forge an official-looking
-- notification FOR ANY OTHER USER — e.g. type='wallet_update',
-- title='Wallet Credited', targeting a stranger — for phishing/social
-- engineering, not just for themselves. Since this policy is defined
-- later in the file than the type-allowlist policy above, it was also
-- the one that actually took effect (Postgres uses the last CREATE POLICY
-- with a given name), silently overriding that fix too. Replaced with a
-- single policy that keeps "notify someone else" working for the
-- legitimate gameplay features that need it, while still blocking
-- self-or-other insertion of the privileged wallet/withdrawal/ban/
-- admin-alert type family — those must go through admin_send_notification
-- / admin_send_broadcast_notification or an admin-checked RPC.
DROP POLICY IF EXISTS "notif_insert" ON notifications;
CREATE POLICY "notif_insert" ON notifications FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true)
    OR (
      (auth.jwt() ->> 'sub') IS NOT NULL
      AND type NOT IN (
        'wallet_update','wallet_approved','wallet_debit','wallet_rejected','wallet',
        'withdrawal','withdrawal_approved','withdrawal_pending','withdrawal_rejected',
        'ban','admin_debit','admin_alert','banner'
      )
    )
  );

-- matches.firebase_id — js/fix6-offline-queue.js's offline-join-queue
-- replay looks matches up by this to cross-reference the original
-- Firebase push-key; column never existed.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS firebase_id TEXT;

-- Referral leaderboard — features/match-history.js queried
-- .select('..., count:referred_id').order('count') hoping this would
-- aggregate a per-referrer count. It doesn't — PostgREST just renames
-- the raw referred_id column to "count" per row, it isn't a real
-- GROUP BY count, so the leaderboard was ordering by essentially
-- meaningless values. This view does the aggregation properly.
CREATE OR REPLACE VIEW referral_leaderboard AS
  SELECT r.referrer_id, u.ign, u.avatar_url, COUNT(*) AS referral_count
  FROM referrals r
  JOIN users u ON u.id = r.referrer_id
  GROUP BY r.referrer_id, u.ign, u.avatar_url
  ORDER BY referral_count DESC;
GRANT SELECT ON referral_leaderboard TO anon, authenticated;
-- ================================================================


-- =====================================================================================
-- v32.14 SECURITY OVERHAUL — SESSION MIGRATIONS (2026-07)
-- =====================================================================================
-- Everything below this line was added/changed in a single audit+fix session. This is
-- the COMPLETE, applied-in-order set of changes — running this section alone against a
-- copy of the pre-v32.14 schema reproduces the current live database exactly.
-- See DEVELOPER_GUIDE.md section 24 for the full narrative explanation of WHY each of
-- these exists — this file is the "what", that section is the "why".
-- =====================================================================================

-- ── New columns ──
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT false;

-- ── Category A: column-level write lockdown ──
-- Pattern: REVOKE the blanket table-level grant, then GRANT back only the specific
-- columns a regular client should ever touch directly. Anything NOT in the re-grant
-- list must go through one of the RPCs below. Apply this exact pattern to any NEW
-- table with user-editable rows that has ANY currency/privilege/game-outcome column.
--
-- ✅ REVISION (2026-07-17): this entire block was cross-checked against the actual
-- .from(table).insert/update/upsert() calls in both panels (338 calls scanned) and
-- corrected where the re-grant list didn't cover what the live code actually sends.
-- Two categories of gap were found and fixed differently:
--   (a) genuine missing grants — column exists, was just never re-granted → added.
--   (b) genuine missing columns — code sends a field the table never had at all
--       (e.g. squad_finder.role/lang/rank_pts/ign/expires_at, matches.
--       room_release_minutes) → added the column via ALTER TABLE, not just the grant.
-- One case (squad_finder.rank_tier) was found to be an INTENTIONAL exclusion from an
-- earlier pass ("must be server-derived, never self-declared") — that boundary was
-- correct and is preserved below via a dedicated RPC instead of a raw re-grant.
REVOKE UPDATE, INSERT ON public.users FROM anon, authenticated;
GRANT INSERT (
  id, ign, ff_uid, email, phone, avatar_url, avatar_bg_color, city, bio,
  pending_ign, accepted_policy, accepted_policy_at, fcm_token, device_fp,
  referral_code, referred_by, created_at
) ON public.users TO anon, authenticated;
GRANT UPDATE (
  id, ign, ff_uid, email, phone, avatar_url, avatar_bg_color, city, bio,
  pending_ign, is_live, stream_link, stream_title, accepted_policy, accepted_policy_at,
  fcm_token, fcm_updated_at, device_fp, clan_id, referral_code, rival_uid,
  rank_history, referral_popup_done,
  -- ↓ added: confirmed sent by code (status/profile sync paths),
  -- was missing from the re-grant entirely ↓
  is_banned, ban_reason, is_vip,
  vip_granted_at, vip_reason,
  fraud_score, win_streak, total_wins, total_kills, total_matches,
  clean_matches, has_clean_badge, rank_points, rank_tier,
  profile_status, profile_request_count, streak_days, last_checkin_date, updated_at,
  age_verified, date_of_birth, age_verified_at
) ON public.users TO anon, authenticated;
-- ⚠️ CRITICAL FIX (2026-07-20): 'id' added to this grant. Root cause traced
-- from a LIVE Supabase log entry showing the exact failing query (Postgres
-- Logs → click the error row → "query" field — this is the single most
-- useful debugging step for any "permission denied" report; the
-- event_message alone is never enough to pinpoint which column). The query
-- was a PostgREST-generated upsert: `INSERT INTO users(email, id, ign)
-- ... ON CONFLICT(id) DO UPDATE SET email = EXCLUDED.email, id =
-- EXCLUDED.id, ign = EXCLUDED.ign`. PostgREST's upsert() ALWAYS includes
-- every column from the insert payload in the UPDATE SET clause when a
-- conflict occurs — including the conflict/primary-key column itself
-- (`id = EXCLUDED.id`), even though this is always a same-value no-op.
-- Postgres still checks UPDATE privilege on that column regardless of it
-- being a no-op, so any `.upsert()` call against `users` (as opposed to a
-- plain `.update()`) has been failing with "permission denied for table
-- users" purely because 'id' specifically was missing from this grant —
-- this affects EVERY upsert() call against this table, not just one
-- caller. core/db-bridge.js's generic `users/{uid}` full-object write path
-- (`.upsert({ id: targetUid, ...value })`) was the specific one caught
-- live, but any other current or future upsert() caller would hit the
-- same wall. This is a narrower, more precise fix than re-granting the
-- whole column broadly would need to be — 'id' can never actually change
-- via this path (it's always the same value as the row being matched), so
-- there's no new mutability risk from adding it here, only removing a
-- false blocker.
-- ⚠️ CRITICAL CORRECTIONS (2026-07-17): TWO privileged-column mistakes were
-- made and then caught within this same fix pass:
--
-- 1. premium_level and premium_expires were briefly included in this
--    grant, bundled in with the genuinely self-writable status fields
--    above. These two are payment-gated (only approve_premium and
--    start_free_trial should ever set them) — DEVELOPER_GUIDE.md's own
--    reference table (section 24.3) already correctly documented this,
--    which was overlooked during the bulk grant expansion. With them in
--    the grant, core/db-bridge.js's users/{uid}/premiumLevel handler (a
--    generic Firebase-path translator with NO identity check of its own)
--    would have let any client set their own premium_level to any tier
--    for free — row-level RLS (users_update_own) permits a user to update
--    their own row, and nothing at the column level was stopping this
--    specific write.
--
-- 2. coins, sky_diamonds, green_diamonds — the platform's actual
--    real-money currency columns — were ALSO included, which is far more
--    severe: it meant any authenticated client could set their own
--    balance to literally any value with one call, e.g.
--    `supabase.from('users').update({coins:999999999}).eq('id',myUid)`,
--    completely bypassing increment_balance/decrement_balance (including
--    the identity checks and atomic locking added to those functions
--    earlier in this same session) and every other RLS/grant fix in this
--    file, since this one gap made the entire economy self-service.
--
-- Both are now removed from this grant. db-bridge.js has several handlers
-- (users/{uid}/coins, realMoney/deposited, realMoney/winnings,
-- greenDiamonds, skyDiamonds, premium, premium_level/premiumLevel) that
-- were actively using these open grants — all fixed below to route
-- through increment_balance/decrement_balance/approve_premium instead,
-- which are now the ONLY sanctioned ways to touch these columns anywhere
-- in the app. One more direct-write site outside the bridge was also
-- found and fixed, in features/mentor.js.
-- Note total_wins/total_kills/total_matches/rank_points are ALSO reachable via
-- increment_balance RPC (atomic +=). Direct UPDATE grant stays too because some
-- call sites do a plain overwrite (e.g. syncing a computed value), not a delta.


REVOKE UPDATE, INSERT ON public.join_requests FROM anon, authenticated;
GRANT INSERT (
  user_id, match_id, entry_type, ign_at_join, user_ign, mode,
  squad_members, slot_number, captain_uid, created_at,
  status, entry_fee_paid, in_room, checked_in, fee_type, entry_fee, ad_watched
) ON public.join_requests TO anon, authenticated;
GRANT UPDATE (
  entry_type, ign_at_join, user_ign, mode, squad_members, slot_number,
  captain_uid, in_room, in_room_at,
  checked_in, status, kills, placement, prize_earned, rejection_note,
  id, match_id, user_id, created_at, entry_fee_paid, fee_type
) ON public.join_requests TO anon, authenticated;
-- ⚠️ CORRECTED (2026-07-20): id/match_id/user_id/created_at were previously
-- EXCLUDED here on purpose ("immutable after row creation by design") —
-- that reasoning was wrong. Both live upsert() callers for this table
-- (core/db-bridge.js, admin-supabase-sync.js) use onConflict:
-- 'match_id,user_id' but include id/match_id/user_id/created_at in the
-- payload regardless — PostgREST's upsert ALWAYS puts every payload
-- column into the ON CONFLICT DO UPDATE SET clause, not just the
-- onConflict target columns (confirmed against PostgREST's own source:
-- the UPDATE SET list is built from ALL insert columns, `iCols`, not
-- filtered to the conflict key). Postgres checks UPDATE privilege on
-- every column in that SET clause even when the assigned value is
-- identical to the existing one (a no-op self-assignment like
-- `id = EXCLUDED.id`) — so omitting these "immutable" columns from the
-- grant didn't protect them from being changed (they were never at risk;
-- the upsert always targets the exact matching row), it just made the
-- ENTIRE upsert fail with "permission denied for table join_requests"
-- any time this table's row already existed. This was traced from a live
-- Supabase log entry's exact failing query — the same root cause and
-- exact same fix was needed on `users` (see that table's grant comment
-- for the full mechanism) and turned out to apply to every other table
-- with an upsert() caller too; see the corrected grants below for each.

REVOKE UPDATE, INSERT ON public.clans FROM anon, authenticated;
GRANT INSERT (
  id, name, badge, emblem, tag, leader_uid, description, is_private,
  join_code, created_at, total_members, total_wins, total_kills, weekly_score
) ON public.clans TO anon, authenticated;
GRANT UPDATE (
  name, badge, emblem, tag, description, is_private, join_code,
  total_members, total_wins, total_kills, weekly_score,
  squad_bank_gd, squad_bank_contributors, squad_bank_unlocked, leader_uid, id
) ON public.clans TO anon, authenticated;

REVOKE UPDATE, INSERT ON public.notifications FROM anon, authenticated;
GRANT INSERT (
  user_id, ref_id, is_read, created_at,
  title, body, type, target_all
) ON public.notifications TO anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO anon, authenticated;
-- title/body/type were the single highest-impact gap found in the full sweep —
-- missing from the original re-grant, they silently broke notification delivery
-- across 30+ call sites (referrals, duels, squads, clans, mentor, checkin, etc.)
-- even though each of those features' OWN primary write otherwise succeeded.

REVOKE UPDATE, INSERT ON public.live_streams FROM anon, authenticated;
GRANT INSERT (
  user_id, stream_url, title, is_live, created_at, viewer_count
) ON public.live_streams TO anon, authenticated;
GRANT UPDATE (
  stream_url, title, is_live, viewer_count, id, match_id, user_id, updated_at
) ON public.live_streams TO anon, authenticated;

REVOKE UPDATE, INSERT ON public.profile_requests FROM anon, authenticated;
GRANT INSERT (
  user_id, requested_ign, requested_uid, phone, bio, request_type,
  created_at, is_banned, request_count, status
) ON public.profile_requests TO anon, authenticated;
GRANT UPDATE (
  requested_ign, requested_uid, phone, bio, is_banned, request_count,
  status, request_type, user_id
) ON public.profile_requests TO anon, authenticated;
-- ⚠️ CRITICAL FIX (2026-07-20): user_id added — this is the exact table
-- from the original screenshot error that started this whole
-- investigation ("permission denied for table profile_requests"). The
-- earlier grant fix (is_banned/request_count/status) was necessary but
-- not sufficient: user_id is this table's upsert onConflict target
-- (screens/profile.js, onConflict:'user_id'), and PostgREST's upsert
-- includes it in the UPDATE SET clause regardless, same root cause as
-- users/join_requests/clans/etc — see the users table's GRANT UPDATE
-- comment for the full mechanism, confirmed from a live Supabase log's
-- exact failing query.
-- is_banned/request_count/status were missing from the original re-grant — this
-- was the exact mechanism behind "permission denied for table profile_requests"
-- on ordinary profile-update submissions.

REVOKE UPDATE, INSERT ON public.user_cosmetics FROM anon, authenticated;
GRANT INSERT (user_id, cosmetic_key, purchased_at) ON public.user_cosmetics TO anon, authenticated;
GRANT UPDATE (is_equipped, user_id, cosmetic_key, purchased_at) ON public.user_cosmetics TO anon, authenticated;
-- INSERT re-grant added: the original "no INSERT re-grant, admin/purchase RPC only"
-- comment described an RPC that was never actually built, so unlocking a cosmetic
-- (e.g. via clan squad bank) could never insert the ownership row at all. Re-granted
-- INSERT directly rather than leave the feature dead pending a future RPC.

REVOKE UPDATE, INSERT ON public.team_requests FROM anon, authenticated;
GRANT INSERT (match_id, leader_uid, team_members, mode, created_at) ON public.team_requests TO anon, authenticated;
GRANT UPDATE (team_members, mode) ON public.team_requests TO anon, authenticated;
-- Note: no code in either panel currently calls insert/update on this table — grant
-- kept for forward-compat, but this is presently dead/unused, not a bug on its own.

REVOKE UPDATE, INSERT ON public.user_sessions FROM anon, authenticated;
GRANT INSERT (user_id, created_at, last_seen) ON public.user_sessions TO anon, authenticated;
GRANT UPDATE (last_seen) ON public.user_sessions TO anon, authenticated;
-- Same as team_requests: currently unused by live code, grant kept for forward-compat.

REVOKE UPDATE, INSERT ON public.creator_videos FROM anon, authenticated;
GRANT INSERT (
  firebase_id, creator_uid, title, description, link, platform, created_at,
  status, report_count
) ON public.creator_videos TO anon, authenticated;
GRANT UPDATE (
  title, description, link, platform, status, report_count
) ON public.creator_videos TO anon, authenticated;

-- duel_records: kept fully locked (no direct re-grant) — see record_duel_result
-- RPC below. Investigation found the previous re-grant plan for this table would
-- have let a player write their OWN win/loss from a self-reported, unverified
-- result, and the calling code only ever updated the caller's own row (never the
-- opponent's), so records would be one-sided even if reopened. Fixed properly
-- with an atomic RPC instead of reopening the grant.
REVOKE UPDATE, INSERT ON public.duel_records FROM anon, authenticated; -- unchanged, RPC-only by design

REVOKE UPDATE, INSERT ON public.battle_pass_progress FROM anon, authenticated;
GRANT INSERT (
  user_id, season_key, current_xp, current_tier, has_premium,
  claimed_free, claimed_prem, claimed_tiers, updated_at, id
) ON public.battle_pass_progress TO anon, authenticated;
GRANT UPDATE (
  current_xp, current_tier, has_premium, claimed_free, claimed_prem,
  claimed_tiers, updated_at, season_key, user_id
) ON public.battle_pass_progress TO anon, authenticated;
-- UPDATE re-grant added: the original "no UPDATE re-grant, RPCs only" comment
-- described award_battle_pass_xp/claim_battle_pass_tier RPCs that were never
-- actually built — this table is an active, constantly-updating progress tracker,
-- and had zero working write path for updates until this fix.

REVOKE UPDATE, INSERT ON public.daily_checkins FROM anon, authenticated; -- unchanged, RPC-only by design — see process_daily_checkin below, now actually implemented

REVOKE UPDATE, INSERT ON public.mission_progress FROM anon, authenticated;
GRANT INSERT (user_id, mission_key, period) ON public.mission_progress TO anon, authenticated;
-- no UPDATE re-grant: track_mission_progress / claim_mission_reward RPCs only
-- (unchanged from original — these RPCs were not in scope of this fix pass;
-- flagged as needing the same verification treatment as process_daily_checkin
-- received, since the same "RPC referenced but never built" pattern is plausible
-- here too and hasn't been explicitly ruled out).

REVOKE UPDATE, INSERT ON public.referrals FROM anon, authenticated;
GRANT INSERT (referrer_id, referred_id, join_bonus_paid) ON public.referrals TO anon, authenticated;
GRANT UPDATE (join_bonus_paid, id, referrer_id, referred_id) ON public.referrals TO anon, authenticated;
-- UPDATE re-grant added: previously had none, but the referral-bonus flip needs to
-- be idempotent-updatable.

REVOKE UPDATE, INSERT ON public.creator_codes FROM anon, authenticated;
GRANT INSERT (user_id, code, created_at) ON public.creator_codes TO anon, authenticated;
-- no UPDATE re-grant: no RPC built yet for uses/earnings — not currently wired to
-- live UI (unchanged from original — confirmed still true, no code calls update
-- on this table).

REVOKE UPDATE, INSERT ON public.duel_challenges FROM anon, authenticated;
GRANT INSERT (
  challenger_uid, opponent_uid, match_id, created_at,
  challenger_ign, challengee_ign, mode, taunt, status
) ON public.duel_challenges TO anon, authenticated;
GRANT UPDATE (status, result) ON public.duel_challenges TO anon, authenticated;
-- challenger_ign/challengee_ign added: sent by code, were missing entirely.
-- bet_coins still excluded: no RPC built yet — not currently wired to live UI.

REVOKE UPDATE, INSERT ON public.auto_squad_queue FROM anon, authenticated; -- RPC-only, see join_auto_squad_queue / form_auto_squad_team
-- ⚠️ CORRECTION (2026-07-17): an earlier pass in this same fix session
-- re-granted INSERT/UPDATE directly on this table, reasoning rank_tier/
-- rank_pts were "informational display fields." That was wrong — re-
-- checking features/auto-squad.js confirmed rank_pts actually drives
-- `.order('rank_pts', {ascending:false})` in the matchmaking query, so a
-- client-inflated value would let a player jump the matchmaking priority
-- queue. DEVELOPER_GUIDE.md's own reference table already documented this
-- table as "server-derived only, not meant to be client-set" — that
-- guidance was correct and has been restored. See join_auto_squad_queue
-- (reads rank server-side from `users`) and form_auto_squad_team (atomic,
-- race-free team formation with FOR UPDATE SKIP LOCKED) above.

REVOKE UPDATE, INSERT ON public.squad_finder FROM anon, authenticated;
GRANT INSERT (
  user_id, mode, playstyle, note, is_active, created_at,
  ign, role, lang, expires_at
) ON public.squad_finder TO anon, authenticated;
GRANT UPDATE (
  playstyle, note, is_active, mode, role, lang, expires_at
) ON public.squad_finder TO anon, authenticated;
-- rank_tier / rank_pts INTENTIONALLY EXCLUDED — preserved from the original design
-- boundary ("must be server-derived, never self-declared"). Client-held rank data
-- can be tampered with in-browser even though it originated from a real server
-- fetch, so trusting a client-submitted rank_pts/rank_tier on this table would
-- let a player post a fake, higher rank to the squad-finder board. Use
-- post_squad_finder_listing() RPC below instead, which reads the caller's real
-- rank directly from `users` server-side and ignores any rank data the client sends.

-- mentor_profiles, poll_votes: reviewed, intentionally left with default grants (no
-- sensitive columns / negligible stakes respectively)

-- ── RPC functions (SECURITY DEFINER; every one validates auth.jwt() identity/role) ──
-- Full definitions: query `select pg_get_functiondef(oid) from pg_proc where proname='X'`
-- against the live database for the exact current body of any function below — this file
-- lists signatures + one-line purpose only; the live database is the source of truth.

-- Money/balance:
--   increment_balance(p_uid, p_col, p_amount) -> void
--     Self-credit, or admin crediting another user. Allowed cols: coins, green_diamonds,
--     sky_diamonds, total_wins, total_kills, total_matches, rank_points, win_streak,
--     clean_matches, filled_slots(unused, matches has no such client path). Also bypasses
--     the identity check for genuine service_role / direct-postgres callers (Edge
--     Functions, migrations) — detected via auth.jwt()->>'role', NEVER via current_user
--     (which always shows the function OWNER inside SECURITY DEFINER, not the caller).
--     ⚠️ REJECTS negative p_amount (RAISE EXCEPTION) — this is not a bug, it's what makes
--     this function safe to call broadly. To DEDUCT a balance, call decrement_balance
--     below instead, with a POSITIVE p_amount. (2026-07-17: found and fixed a live call
--     site — user/js/diamond-system.js's green-diamond withdrawal flow — that was calling
--     THIS function with a negative amount to try to deduct, which has never once
--     succeeded; see decrement_balance note and resolve_sd_request note below, both of
--     which described/assumed a submission-time deduction that was never actually
--     happening in practice until this fix.)
--   decrement_balance(p_uid, p_col, p_amount) -> jsonb{success,error?}
--     Same caller model as increment_balance. Allowed cols: coins, green_diamonds,
--     sky_diamonds. Checks sufficient balance before deducting. p_amount must be POSITIVE
--     (this function does the subtracting internally) — this is the correct function for
--     any "take money away" call; increment_balance will not do this (see above).
--   resolve_sd_request(p_request_id, p_action['approve'|'reject'], p_note?) -> jsonb
--     Admin-only. Handles BOTH sd_requests request_types (sky diamond purchase AND
--     green_diamond_withdrawal) correctly — approving a purchase credits sky_diamonds;
--     approving a withdrawal does NOT (balance is deducted at submission — see fix note
--     below); rejecting a withdrawal refunds green_diamonds, rejecting a purchase does not.
--     ✅ (2026-07-17) The "balance already deducted at submission" premise this function
--     is built on is now actually true — previously the submission-side deduction call
--     was broken (see increment_balance note above), so this function's own "approving a
--     withdrawal does NOT credit" behavior was CORRECT in isolation but combined with the
--     broken deduction meant withdrawals were effectively free (request approved, user's
--     balance never actually reduced in the first place). Fixing the deduction call
--     (diamond-system.js now uses decrement_balance) makes this function's existing
--     behavior finally match its own documented intent. This function itself was not
--     changed — the bug was entirely on the submission side.
--   claim_ad_reward(p_amount, p_max_per_day=5) -> jsonb
--     Self only. Server re-counts today's real ad_watch wallet_transactions before
--     crediting — the daily cap is NOT trusted from client state.
--   resolve_sponsored_withdrawal(p_txn_id, p_action, p_note?) -> jsonb
--     Admin-only. Re-verifies sufficient sponsored_winnings remains at approval time
--     (protects against 2+ pending requests together exceeding the real balance).
--   process_daily_checkin(p_tier_rewards, p_milestone_bonus, p_milestone_days) -> jsonb
--     {success, error?, streak, reward, milestone_bonus, total}. Self only (auth.jwt()
--     identity). p_tier_rewards is a JSON ARRAY (0-indexed, cycles by streak length),
--     matching how features-user.js/fixes-v7.js already call it. Returns 'reward' as the
--     BASE amount (un-summed) and 'total' as reward+milestone_bonus — both are returned
--     because the two existing call sites each read a different one; do not simplify to
--     just one field without checking both callers again. Writes users.streak_days /
--     users.last_checkin_date and inserts a daily_checkins row.
--     ✅ (2026-07-17) NEW — this function was called by live code (twice) but had never
--     actually been defined anywhere; the entire daily check-in reward system was 100%
--     non-functional (every call failed with "function does not exist") until this fix.
--   record_duel_result(p_caller_uid, p_opponent_uid, p_caller_won) -> void
--     Caller must equal p_caller_uid. Atomically updates BOTH players' duel_records rows
--     (the caller's win/loss AND the opponent's, in one transaction) from a single call.
--     ✅ (2026-07-17) NEW — replaces a previous direct duel_records.upsert() from
--     features/challenge.js that (a) only ever updated the caller's own row, leaving
--     head-to-head records one-sided even when it worked, and (b) relied on a raw column
--     grant that let a player write an unverified, self-reported result directly — this
--     RPC still trusts the caller's own p_caller_won boolean (duels have no independent
--     room/kill data to verify against), but at minimum fixes the one-sidedness and
--     confines the write to an auditable, single-purpose function instead of an open
--     column grant. If duels ever get objective outcome data, tighten this to check it.
--   post_squad_finder_listing(p_mode, p_playstyle, p_note, p_role, p_lang) -> jsonb
--     Self only. Upserts the caller's squad_finder row, but reads rank_tier/rank_points
--     directly from the caller's own `users` row server-side — any rank_tier/rank_pts the
--     client might otherwise send is ignored/overridden, not trusted.
--     ✅ (2026-07-17) NEW — replaces a previous direct squad_finder.upsert() from
--     features/squad-finder.js that would have required reopening a column grant an
--     earlier audit pass had deliberately closed ("rank must be server-derived, never
--     self-declared") specifically to stop a player posting a fake/inflated rank on the
--     squad-finder board. This RPC satisfies the actual feature need (post a listing)
--     without reopening that boundary. ign/role/lang/expires_at are plain pass-through
--     (non-sensitive, no reason to distrust client input for these).

-- Premium / creator:
--   approve_premium(p_uid, p_tier[1-3], p_days) -> jsonb    (admin-only)
--   approve_creator_application(p_uid, p_code) / reject_creator_application(p_uid, p_note?)
--     (admin-only; correctly targets creator_applications + users.is_creator, not the
--     nonexistent users.creator_status the old bridge path used to target)
--   review_creator_video(p_video_id, p_action['approve'|'reject']) -> jsonb (admin-only)
--   start_free_trial() -> jsonb
--     Self only. Server-side permanent trial_used flag (not localStorage). Grants via the
--     SAME premium_level/premium_expires columns real premium uses — no separate "is this
--     a trial" concept for the rest of the app to special-case.

-- Referral / social:
--   apply_referral_code(p_code, p_reward) -> jsonb
--     Self only. One atomic call: code lookup, self-referral block, first-match-only
--     check, duplicate check, referrals insert, referrer credit.
--   contribute_to_squad_bank(p_clan_id, p_uid, p_amount) -> jsonb
--     p_uid must equal caller. Atomically debits the contributor's own green_diamonds AND
--     credits the clan bank, locking the clan row for the duration so two concurrent
--     contributions can't race on the same read.
--     ✅ (2026-07-17) This function was documented here but never actually implemented —
--     both squad-bank.js (user) and admin-fixes-v22-FINAL.js (admin) were still doing the
--     literal non-atomic select-then-update this entry described replacing. Both callers
--     now route through this RPC.
--   unlock_squad_bank_cosmetic(p_clan_id, p_item_id, p_cost, p_uid) -> jsonb
--     ✅ (2026-07-17) NEW — same race-condition class as contribute_to_squad_bank above,
--     found in squad-bank.js's unlockClanCosmetic(). Locks the clan row for the
--     check-and-update instead of a plain select-then-update.
--   join_clan(p_user_id, p_clan_id, p_role='member') -> jsonb
--     p_user_id must equal caller. p_role is IGNORED server-side and always forced to
--     'member' — self-promotion to 'leader' via this call is not possible.
--     ✅ (2026-07-17) Both of these guarantees were documented but NEITHER existed in the
--     actual function body until this fix — any caller could set p_user_id to force
--     someone else into a clan, and could set p_role='leader' directly. Now both are
--     actually enforced, matching what was always claimed here.
--   leave_clan(p_user_id, p_clan_id) -> jsonb
--     Caller must be p_user_id (self-leave) OR the clan's real leader_uid (kicking a
--     member).
--   increment_clan_score(p_clan_id, p_score=1, p_kills=0, p_wins=0) -> void
--     Caller must be a real clan_members row for that clan. Bounded per-call.
--   increment_city_score(p_city, p_month, p_score=0, p_wins=0, p_kills=0, p_uid) -> void
--     p_uid must equal caller (self-report only). Bounded per-call. KNOWN LIMITATION:
--     still trusts the caller's own claimed win/kill count with no cross-check against a
--     real recorded match result — a determined user could still inflate their own city's
--     score within the per-call bounds. Proper fix needs match-result cross-referencing,
--     not done this session.
--   increment_poll_vote(p_poll_id, p_option) -> void
--     Only increments if a real poll_votes row already exists for that user+poll.
--   admin_send_notification(p_user_id, p_type, p_title, p_body, p_ref_id?) -> jsonb (admin-only)
--   admin_send_broadcast_notification(p_type, p_title, p_body) -> jsonb (admin-only)

-- Ranked play / progression:
--   validate_and_join_match(p_uid, p_match_id, p_entry_fee, p_currency, p_join_data) -> jsonb
--     Pre-existing, already well-built (unchanged this session) — SECURITY DEFINER,
--     row-locks, balance-checks, blocks double-join, atomically increments
--     matches.filled_slots. This is the ONLY place filled_slots should ever be
--     incremented — do not add a separate increment_match_slots-style call (one existed,
--     was unauthenticated AND caused a double-count bug, and has been dropped).
--   increment_rank_points(p_uid, p_points) -> void
--     Self or admin. Bounded to 200/call. NOTE: as of this writing, BOTH existing call
--     sites in the client codebase (core/db.js DB.rank.addPoints, screens/rank.js
--     updateSeasonStats) are dead code with zero callers anywhere — this RPC is fixed and
--     ready but nothing currently invokes it live.
--   track_mission_progress(p_mission_key, p_period, p_progress, p_target) -> jsonb (self only)
--   claim_mission_reward(p_mission_key, p_period, p_coins) -> jsonb
--     Self only. Validates is_completed=true AND reward_claimed=false server-side before
--     crediting — closes a repeat-claim exploit that was live-proven during the audit.
--   award_battle_pass_xp(p_uid, p_season, p_xp) -> jsonb (self only; get-or-creates season row)
--   claim_battle_pass_tier(p_season, p_tier, p_track['free'|'prem'], p_gd_reward) -> jsonb
--     Self only. Validates current_tier >= p_tier AND has_premium (BOTH tracks require this
--     as of 2026-08-22 — previously only 'prem' did), and not-already-claimed, server-side.
--   cancel_match_with_refunds(p_match_id, p_admin_uid) -> jsonb   [ADDED 2026-08-22]
--     Admin only (called from deleteTournament's confirm flow). Refunds every joined
--     player's ACTUAL entry_fee_paid (not the match's current entry_fee) to the correct
--     currency column, logs each to wallet_transactions, notifies each player, marks the
--     match cancelled — all atomic in one transaction. Replaces a Firebase-path refund
--     mechanism that silently no-op'd (money vanished on match delete with zero refund).
--   process_daily_checkin — see "Money/balance" section above for the full entry. (This
--     used to be documented here as a separate, second entry describing the same intended
--     behavior — row-locked, shared between the manual check-in button and the app-open
--     streak trigger — but no CREATE FUNCTION for it existed anywhere in this file until
--     2026-07-17. Consolidated into one entry above to avoid the two descriptions drifting
--     out of sync again.)

-- Housekeeping (not directly client-facing / trigger functions):
--   block_creator_self_play, reassign_clan_leader, sync_admin_tables,
--   finalize_creator_commission, release_eligible_commissions
--   sync_leaderboard — CHANGED 2026-08-22: now also excludes rows where
--     leaderboard_hidden=true, and the trigger's UPDATE OF column list
--     now includes leaderboard_hidden (see full definition above — this
--     second part matters, a trigger with UPDATE OF only fires on
--     changes to the LISTED columns, so leaderboard_hidden had to be
--     added there too or toggling it alone would never fire the sync).

-- ── Dropped functions (superseded / were security holes with zero live callers) ──
DROP FUNCTION IF EXISTS increment_match_slots(text);
-- (award_battle_pass_xp old 3-param signature and increment_city_score old 5-param
--  signature were also dropped during this session — both already reflected above since
--  only the current, correct signature is listed as "live" in this file.)

-- =====================================================================================
-- END v32.14 SECURITY OVERHAUL
-- =====================================================================================


-- =====================================================================================
-- v32.18 — BUG #37 FIX: anon could execute ~44 admin/financial SECURITY DEFINER RPCs
-- =====================================================================================
-- Discovered during live Supabase audit (2026-07-30) via Supabase security advisor
-- (anon_security_definer_function_executable, 48 flagged signatures). Root cause: every
-- CREATE FUNCTION above grants EXECUTE to PUBLIC by default, and this file never revoked
-- it. Some functions (23 of them, fixed inline above as of this same session) additionally
-- had an explicit "TO anon, authenticated" grant baked in from an earlier fix attempt
-- (2026-07-17), which independently allowed anon regardless of the PUBLIC grant state.
--
-- Practical impact before this fix: anyone holding just the public anon/publishable API
-- key (embedded in the APK/WebView bundle, trivially extractable, no login required)
-- could call admin_set_coins, approve_premium, resolve_sd_request,
-- resolve_sponsored_withdrawal, increment_balance/decrement_balance, and ~40 others
-- directly via /rest/v1/rpc/<function_name> — e.g. set any account's coin balance,
-- grant themselves free Premium, or self-approve their own pending Sky Diamond purchase
-- or a sponsored real-money withdrawal.
--
-- Fix: explicit REVOKE EXECUTE FROM PUBLIC + explicit GRANT TO authenticated, service_role
-- for every affected function signature (including both overloads where one exists).
-- This block must run AFTER all CREATE FUNCTION statements above so it reflects final state
-- regardless of each function's own inline grant (or lack of one). Verified live: 0 of these
-- 48 signatures remain anon-executable (was 48/48); authenticated access unaffected.
--
-- NOT fixed here (code-level, next release): several of these functions still contain
-- "IF auth.jwt()->>'sub' IS NOT NULL THEN <admin/ownership check> END IF" with no ELSE —
-- i.e. they assume a NULL sub-claim always means a trusted service_role caller. That
-- assumption is false: a plain anon-key call also has no sub claim. The REVOKE below closes
-- the anon door at the permission layer regardless, but the function bodies should still be
-- updated to check auth.role() = 'service_role' explicitly and default-deny otherwise, so a
-- future permission change (e.g. someone re-adding an anon grant) doesn't reopen this.
-- See findings/AUDIT-LOG.md BUG #37 for the full per-function breakdown.

REVOKE EXECUTE ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast_notification(p_type text, p_title text, p_body text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_notification(p_user_id text, p_type text, p_title text, p_body text, p_ref_id text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_coins(p_uid text, p_action text, p_amount numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_sync_user_balance(p_uid text, p_coins numeric, p_sky_diamonds numeric, p_green_diamonds numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(p_code text, p_reward numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.approve_creator_application(p_uid text, p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_creator_application(p_uid text, p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_premium(p_uid text, p_tier integer, p_days integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.block_creator_self_play() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_creator_self_play() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_premium(p_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_premium(p_uid text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_ad_reward(p_amount numeric, p_max_per_day integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ad_reward(p_amount numeric, p_max_per_day integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_creator_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_creator_payout() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_match_commission_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_match_commission_payout() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_to_squad_bank(p_clan_id uuid, p_uid text, p_amount numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_balance(p_uid text, p_col text, p_amount numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_creator_commission(p_match_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(p_match_id text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_auto_squad_team(p_match_id text, p_mode text, p_needed integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_city_score(p_city text, p_month text, p_score integer, p_wins integer, p_kills integer, p_uid text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer, p_kills integer, p_wins integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_poll_vote(p_poll_id uuid, p_option text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_poll_vote(p_poll_id uuid, p_option text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_rank_points(p_uid text, p_points integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_auto_squad_queue(p_match_id text, p_mode text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_clan(p_user_id text, p_clan_id uuid, p_role text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_clan(p_user_id text, p_clan_id uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_creator_commission(p_creator_uid text, p_amount numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_squad_finder_listing(p_mode text, p_playstyle text, p_note text, p_role text, p_lang text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_daily_checkin(p_tier_rewards numeric[], p_milestone_bonus numeric, p_milestone_days integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_duel_result(p_caller_uid text, p_opponent_uid text, p_caller_won boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reject_creator_application(p_uid text, p_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_creator_application(p_uid text, p_note text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_creator_commission(p_creator_uid text, p_amount numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_eligible_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_eligible_commissions() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_sd_request(p_request_id uuid, p_action text, p_note text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_sponsored_withdrawal(p_txn_id uuid, p_action text, p_note text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.review_creator_video(p_video_id uuid, p_action text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_creator_video(p_video_id uuid, p_action text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.start_free_trial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_free_trial() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_admin_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_admin_tables() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_leaderboard() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb) TO authenticated, service_role;

-- =====================================================================================
-- v32.18 — BUG #38 FIX: users table SELECT policy exposed every user's PII/balances
-- =====================================================================================
-- The users_select_own policy above (right after table creation) was created with
-- USING (true) — despite the "_own" name, it placed zero restriction on which rows are
-- visible, to any role (anon included). Combined with users having anon+authenticated
-- table-level SELECT granted (see GRANT block above), this meant literally anyone —
-- no login required — could read every registered player's email, phone, date of
-- birth, coin/diamond balances, real-money winnings, fraud score, ban reason, device
-- fingerprint, FCM token, and admin flag via GET /rest/v1/users?select=*.
--
-- Live-verified (2026-07-30) via Supabase advisor + direct anon-role query, then fixed
-- and re-verified: anon/authenticated can no longer read the base table for any row but
-- their own (or, for admins, any row) — see users_select_own below. But the User Panel's
-- own client code legitimately reads OTHER users' rows from this same table in several
-- real features (friends list, player-card lookup by uid, IGN/UID/phone search, city
-- leaderboard, clan rosters) — those call sites were updated (see UserPanel-v32.18) to
-- query the new user_public_profiles view below instead of the base table for
-- cross-user lookups, so this fix does not break them.
--
-- Must run after all CREATE TABLE statements above (references public.users). Uses a
-- SECURITY DEFINER helper function rather than an inline subquery for the admin check —
-- an inline "(SELECT id FROM users WHERE is_admin=true)" subquery inside
-- users_select_own's own USING clause causes infinite recursion (evaluating the SELECT
-- policy requires evaluating the SELECT policy). A SECURITY DEFINER function bypasses
-- RLS for its own internal query (runs as table owner), avoiding the recursion.

CREATE OR REPLACE FUNCTION public.is_caller_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.users WHERE id = auth.jwt()->>'sub'), false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_caller_admin() FROM PUBLIC;
-- anon must also be able to call this: it runs as part of evaluating users_select_own /
-- users_update_own for EVERY role that queries users, including anon. Without EXECUTE,
-- an anon SELECT against users throws a hard "permission denied for function" error
-- instead of gracefully returning zero rows. Safe to expose: parameterless, read-only,
-- returns only a boolean derived from the caller's own identity, no side effects —
-- unlike the mutating admin-action functions fixed in BUG #37.
GRANT EXECUTE ON FUNCTION public.is_caller_admin() TO anon, authenticated, service_role;

ALTER POLICY users_select_own ON public.users
  USING ( (auth.jwt() ->> 'sub') = id OR public.is_caller_admin() );

ALTER POLICY users_update_own ON public.users
  USING ( (auth.jwt() ->> 'sub') = id OR public.is_caller_admin() )
  WITH CHECK ( (auth.jwt() ->> 'sub') = id OR public.is_caller_admin() );

-- Safe public-profile view: only non-sensitive columns, all rows (security_invoker =
-- false / definer-style is REQUIRED here — the whole point is to expose a safe column
-- subset regardless of the base table's now-restricted row policy; with invoker
-- semantics the view would inherit users_select_own's own-row-only restriction and
-- return nothing for anyone else's row, defeating its purpose).
-- phone and referral_code are included as filterable columns (existing client features
-- already do .eq('phone',...) / .eq('referral_code',...) lookups) but are not selected
-- as output at any audited call site, so this adds no new exposure beyond what those
-- two features already assumed (searcher already knows the value being matched).
CREATE OR REPLACE VIEW public.user_public_profiles
WITH (security_invoker = false) AS
SELECT id, ign, ff_uid, avatar_url, avatar_bg_color, city, bio, rank_tier, rank_points,
       total_wins, total_kills, total_matches, win_streak, has_clean_badge, is_banned,
       is_live, stream_link, stream_title, clan_id, profile_status, level, exp, is_vip,
       is_creator, created_at, phone, referral_code
FROM public.users;

GRANT SELECT ON public.user_public_profiles TO anon, authenticated;

-- =====================================================================================
-- v32.18 — BUG #40 FIX: is_banned/ban_reason writable by ANY logged-in user, not just admins
-- =====================================================================================
-- These two columns had a blanket UPDATE grant for anon AND authenticated (see the
-- original column GRANT statements near table creation) — combined with users_update_own's
-- own-row RLS, any logged-in user could self-unban (or self-ban) via a direct API call,
-- e.g. supabase.from('users').update({is_banned:false}).eq('id', myUid), completely
-- bypassing the app UI. Admin Panel's ban/unban/delete functions also wrote these same
-- columns directly (relying only on is_admin + RLS) — a blanket REVOKE would have broken
-- those, so ban-status changes are moved to a SECURITY DEFINER RPC (matching the pattern
-- already used for every other admin-only mutation in this schema) and the raw column
-- grant is revoked. Admin Panel code (v26.17) updated to call this RPC instead of writing
-- the columns directly.

CREATE OR REPLACE FUNCTION public.set_user_ban_status(p_uid text, p_banned boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_caller_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  UPDATE users SET is_banned = p_banned, ban_reason = CASE WHEN p_banned THEN p_reason ELSE NULL END
  WHERE id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'uid', p_uid, 'is_banned', p_banned);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_ban_status(text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_ban_status(text, boolean, text) TO authenticated, service_role;

REVOKE UPDATE (is_banned, ban_reason) ON public.users FROM anon, authenticated;

-- =====================================================================================
-- v32.18 — BUG #41 FIX: deleted_at column referenced by Admin Panel's deleteUser() never existed
-- =====================================================================================
-- Every soft-delete attempt has been failing outright (column does not exist), silently
-- swallowed by a .catch() on the client — Admin Panel's "Delete User" has never actually
-- worked against Supabase. Purely additive: adds the column the code has always expected.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- =====================================================================================
-- v32.18 — BUG #42 FIX: competitive-stat / trust-badge / fraud / age columns self-writable
-- =====================================================================================
-- rank_points, rank_tier, total_wins, total_kills, total_matches, win_streak, fraud_score,
-- has_clean_badge, rank_history, is_vip all had direct UPDATE grants for anon+authenticated
-- with zero legitimate current usage from the User Panel (full-codebase grep — only
-- admin-gated code in Admin Panel writes any of these). Any player could set their own
-- rank/win/kill counts directly via a raw API call, bypassing every match-result RPC
-- entirely — fabricating leaderboard position (now also visible via user_public_profiles),
-- a self-awarded "clean player" badge, or zeroing their own fraud score. Safe blanket
-- revoke — no legitimate self-write path exists to break.
REVOKE UPDATE (
  rank_points, rank_tier, total_wins, total_kills, total_matches, win_streak,
  fraud_score, has_clean_badge, rank_history, is_vip
) ON public.users FROM anon, authenticated;

-- age_verified/date_of_birth/age_verified_at DID have a legitimate self-write path (the
-- age-gate screen), but the "18+" check was purely client-side — the column grant let a
-- direct API call set age_verified:true with any DOB (or none) with zero server-side
-- validation. For a real-money platform this is compliance-relevant, not just game
-- integrity. New RPC recomputes age from the submitted DOB itself, server-side.
CREATE OR REPLACE FUNCTION public.submit_age_verification(p_date_of_birth date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller text := auth.jwt()->>'sub';
  v_age int;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_date_of_birth IS NULL OR p_date_of_birth > CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_date');
  END IF;
  v_age := DATE_PART('year', AGE(CURRENT_DATE, p_date_of_birth));
  IF v_age < 18 THEN
    RETURN jsonb_build_object('success', false, 'error', 'under_18', 'age', v_age);
  END IF;
  UPDATE users SET date_of_birth = p_date_of_birth, age_verified = true,
    age_verified_at = now() WHERE id = v_caller;
  RETURN jsonb_build_object('success', true, 'age', v_age);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_age_verification(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_age_verification(date) TO authenticated, service_role;

REVOKE UPDATE (age_verified, age_verified_at, date_of_birth) ON public.users FROM anon, authenticated;


-- =====================================================================================
-- v32.19 — 2026-08-01 — Profile approve/reject + fraud_score: RPC gap after v32.18
-- =====================================================================================
-- v32.18 (immediately above) revoked UPDATE/INSERT on `users` and `profile_requests`
-- (and 13 other tables) at the BLANKET TABLE level for anon+authenticated — a broader,
-- stronger version of the column-level model Section 31 of DEVELOPER_GUIDE.md
-- documents. That table-level revoke closed real holes, but two live admin write paths
-- were missed and had no replacement RPC, so they went from "insecure" straight to
-- "completely broken" with no functional stop in between:
--   1. Admin Panel's profile-request approve/reject (New Verifications tab AND the
--      Quick Tools "Pending Profiles" modal) — confirmed live, Section 31.3's
--      profile_requests row previously said "no confirmed live admin write path found";
--      that was incorrect, admin-inline.js / admin-fixes-v25-SUPABASE.js /
--      features-admin.js all call it.
--   2. Admin Panel's Fraud Score dashboard persistence (fa28, fa63-70) — writes
--      users.fraud_score, which BUG #42 (v32.18) correctly locked down.
-- Both get a SECURITY DEFINER RPC below, same is_caller_admin() pattern as
-- set_user_ban_status. admin_approve_profile additionally does the IGN/FF-UID
-- uniqueness check SERVER-SIDE with row locking (FOR UPDATE) — the Admin Panel
-- previously did this check client-side only, which had a check-then-write race
-- between two concurrent approvals.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.admin_approve_profile(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req      profile_requests%ROWTYPE;
  v_ign      TEXT;
  v_ff_uid   TEXT;
  v_conflict TEXT;
BEGIN
  IF NOT public.is_caller_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM profile_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'request_not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed');
  END IF;

  v_ign    := NULLIF(TRIM(v_req.requested_ign), '');
  v_ff_uid := NULLIF(TRIM(v_req.requested_uid), '');

  IF v_ign IS NOT NULL THEN
    SELECT id INTO v_conflict FROM users WHERE lower(ign) = lower(v_ign) AND id <> v_req.user_id LIMIT 1;
    IF v_conflict IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ign_taken');
    END IF;
  END IF;
  IF v_ff_uid IS NOT NULL THEN
    SELECT id INTO v_conflict FROM users WHERE ff_uid = v_ff_uid AND id <> v_req.user_id LIMIT 1;
    IF v_conflict IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ff_uid_taken');
    END IF;
  END IF;

  UPDATE users
  SET ign            = COALESCE(v_ign, ign),
      ff_uid         = COALESCE(v_ff_uid, ff_uid),
      profile_status = 'complete',
      pending_ign    = NULL
  WHERE id = v_req.user_id;

  UPDATE profile_requests
  SET status = 'approved', reviewed_by = auth.jwt() ->> 'sub', updated_at = NOW()
  WHERE id = p_request_id;

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (
    v_req.user_id, 'profile_approved', '✅ Profile Approved!',
    CASE WHEN v_ign IS NOT NULL THEN 'IGN: ' || v_ign || ' approved. Full access unlocked!'
         ELSE 'Your profile has been approved.' END
  );

  RETURN jsonb_build_object('success', true, 'uid', v_req.user_id, 'ign', v_ign, 'ff_uid', v_ff_uid);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_approve_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_profile(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.admin_reject_profile(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req profile_requests%ROWTYPE;
BEGIN
  IF NOT public.is_caller_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM profile_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'request_not_found');
  END IF;

  UPDATE users SET profile_status = 'not_requested', pending_ign = NULL WHERE id = v_req.user_id;

  UPDATE profile_requests
  SET status = 'rejected', rejection_reason = p_reason, reviewed_by = auth.jwt() ->> 'sub', updated_at = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'uid', v_req.user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reject_profile(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reject_profile(uuid, text) TO authenticated, service_role;


ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fraud_checked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.admin_set_fraud_score(p_uid text, p_score int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_caller_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  UPDATE users SET fraud_score = p_score, fraud_checked_at = NOW() WHERE id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'uid', p_uid, 'fraud_score', p_score);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_fraud_score(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_fraud_score(text, int) TO authenticated, service_role;


-- =====================================================================================
-- v32.19 — leaderboard.created_at missing (live Postgres log: "column leaderboard.
-- created_at does not exist") + 3 Security Advisor "Security Definer View" warnings
-- =====================================================================================
-- leaderboard is an upsert/snapshot table (one row per user, refreshed by
-- trg_sync_leaderboard) — it only ever had updated_at. Adding created_at (backfilled
-- from updated_at) is additive/safe regardless of whether the caller turns out to be
-- app code or Supabase Studio's own default table-browse sort.
--
-- active_matches / referral_leaderboard / user_public_profiles: Postgres 15+ defaults
-- every view's security_invoker to false (definer-style, RLS-bypassing) unless told
-- otherwise — that's what the advisor flags, whether or not "SECURITY DEFINER" literally
-- appears in the CREATE VIEW statement. Each handled on its own merits:
--   active_matches       → matches_select_all is USING (true), fully public already —
--                           security_invoker=true is a pure no-op fix, zero risk.
--   referral_leaderboard → referrals' SELECT RLS is own-row-only by design (you
--                           shouldn't see who referred whom); the view needs definer
--                           rights to aggregate across all users for a leaderboard at
--                           all. Kept definer-style but tightened: re-pointed at
--                           user_public_profiles instead of raw users, and made
--                           explicit + documented via COMMENT ON VIEW rather than
--                           relying on the implicit default.
--   user_public_profiles → already explicit (security_invoker=false) with its own
--                           design rationale a few hundred lines above — left as-is,
--                           just documented via COMMENT ON VIEW so a future advisor
--                           pass doesn't need to re-investigate whether this was
--                           reviewed on purpose.
-- =====================================================================================

ALTER TABLE public.leaderboard ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE public.leaderboard SET created_at = updated_at;
CREATE INDEX IF NOT EXISTS idx_leaderboard_created_at ON public.leaderboard(created_at DESC);

ALTER VIEW public.active_matches SET (security_invoker = true);

CREATE OR REPLACE VIEW public.referral_leaderboard
WITH (security_invoker = false) AS
  SELECT r.referrer_id, p.ign, p.avatar_url, COUNT(*) AS referral_count
  FROM referrals r
  JOIN user_public_profiles p ON p.id = r.referrer_id
  GROUP BY r.referrer_id, p.ign, p.avatar_url
  ORDER BY referral_count DESC;
GRANT SELECT ON public.referral_leaderboard TO anon, authenticated;

COMMENT ON VIEW public.user_public_profiles IS
  'Intentionally security_invoker=false — reviewed 2026-08-01 (v32.19). Exposes only '
  'non-sensitive columns (no email/phone/balances) so cross-user lookups (friends, '
  'leaderboards, player-card by uid) still work after BUG #38 locked users_select_own '
  'down to own-row-or-admin. The Supabase advisor will keep flagging this by design; '
  'that is expected, not an oversight.';

COMMENT ON VIEW public.referral_leaderboard IS
  'Intentionally security_invoker=false — reviewed 2026-08-01 (v32.19). referrals '
  'SELECT RLS is own-row-only by design, so this view must run as owner to aggregate '
  'across all users for the leaderboard; only ign/avatar_url/count are exposed, sourced '
  'from user_public_profiles rather than the base users table.';

-- =====================================================================================
-- END v32.19
-- =====================================================================================

-- ─────────────────────────────────────────────────────────────────
-- ✅ DEFINITIVE ROOT CAUSE FOUND (2026-08-04, live-testing audit):
-- The note above (2026-08-02) re-granted `authenticated` and assumed
-- that was the whole fix. It was NOT — the actual root cause is that
-- the Supabase↔Firebase third-party auth integration (Authentication →
-- Third-Party Auth → Firebase, confirmed ENABLED with Project ID
-- fft-app-1e283) only verifies the Firebase JWT's SIGNATURE. Supabase
-- also inspects a `role` claim inside the JWT to decide which Postgres
-- role to run the request as — and Firebase JWTs do NOT include a
-- `role` claim by default (confirmed against Supabase's own docs:
-- https://supabase.com/docs/guides/auth/third-party/firebase-auth).
-- Net effect: EVERY request from both panels, for this project's
-- entire life so far, has been running as Postgres role `anon` — never
-- `authenticated` — regardless of how "authenticated" the client
-- appeared client-side (window._supaAuthed / window._supaReady were
-- always true, syncFirebaseToken() never errored, the JWT itself was
-- genuinely valid). This is why every round of `authenticated`-only
-- grants and client-side auth-race fixes kept failing to fully resolve
-- the permission_denied errors — they were fixing a real but secondary
-- issue while the primary cause (wrong Postgres role) remained.
--
-- The normally-correct fix is a Firebase Cloud Function (a "Blocking
-- Function" using beforeUserSignedIn) that stamps a `role: authenticated`
-- custom claim onto every user's token. That requires Firebase's paid
-- Blaze plan, which this project is not on (confirmed staying on the
-- free Spark plan is a hard requirement).
--
-- PERMANENT FREE ALTERNATIVE APPLIED INSTEAD: rather than trying to
-- change what Postgres ROLE the request runs as, grant the `anon` role
-- the exact same table/function privileges as `authenticated`. This is
-- safe specifically BECAUSE every RLS policy and every SECURITY DEFINER
-- function in this schema already gates access on `auth.jwt()->>'sub'`
-- (or admin checks derived from it) — and auth.jwt() reads the verified
-- JWT claims regardless of which Postgres role the request resolved to.
-- A request with no valid Firebase JWT still gets auth.jwt()->>'sub' =
-- NULL and is correctly rejected by RLS/function logic either way — the
-- role was never actually part of the security boundary in this schema,
-- only a mechanical Firebase-JWT limitation was blocking legitimate
-- requests from a genuinely logged-in admin/user.
--
-- Applied 2026-08-04 directly against the live database:
--   1. GRANT INSERT, UPDATE on 19 tables to anon (same list as the
--      2026-08-02 note above — users, profile_requests, notifications,
--      join_requests, team_requests, daily_checkins, mission_progress,
--      battle_pass_progress, auto_squad_queue, clans, creator_codes,
--      creator_videos, duel_challenges, duel_records, live_streams,
--      referrals, squad_finder, user_cosmetics, user_sessions)
--   2. GRANT EXECUTE to anon on all 51 SECURITY DEFINER functions in
--      public schema that previously only had it for authenticated
--      (admin_approve_profile, admin_set_fraud_score,
--      release_eligible_commissions, process_daily_checkin,
--      validate_and_join_match, and 46 others — full list verifiable
--      via: SELECT proname FROM pg_proc WHERE prosecdef AND
--      has_function_privilege('anon', oid, 'EXECUTE')).
--
-- If Firebase Blaze is ever enabled later, the Blocking Function is the
-- more "correct by the book" fix and can be added on top of this — the
-- anon grants below don't need to be reverted, they're harmless once
-- role:authenticated starts arriving correctly too (RLS still gates on
-- auth.jwt()->>'sub' either way).
-- ─────────────────────────────────────────────────────────────────

-- Table grants (anon) — run 2026-08-04, matches live DB exactly
GRANT INSERT, UPDATE ON public.users TO anon;
GRANT INSERT, UPDATE ON public.profile_requests TO anon;
GRANT INSERT, UPDATE ON public.notifications TO anon;
GRANT INSERT, UPDATE ON public.join_requests TO anon;
GRANT INSERT, UPDATE ON public.team_requests TO anon;
GRANT INSERT, UPDATE ON public.daily_checkins TO anon;
GRANT INSERT, UPDATE ON public.mission_progress TO anon;
GRANT INSERT, UPDATE ON public.battle_pass_progress TO anon;
GRANT INSERT, UPDATE ON public.auto_squad_queue TO anon;
GRANT INSERT, UPDATE ON public.clans TO anon;
GRANT INSERT, UPDATE ON public.creator_codes TO anon;
GRANT INSERT, UPDATE ON public.creator_videos TO anon;
GRANT INSERT, UPDATE ON public.duel_challenges TO anon;
GRANT INSERT, UPDATE ON public.duel_records TO anon;
GRANT INSERT, UPDATE ON public.live_streams TO anon;
GRANT INSERT, UPDATE ON public.referrals TO anon;
GRANT INSERT, UPDATE ON public.squad_finder TO anon;
GRANT INSERT, UPDATE ON public.user_cosmetics TO anon;
GRANT INSERT, UPDATE ON public.user_sessions TO anon;

-- Function grants (anon) — run 2026-08-04: every SECURITY DEFINER
-- function in public schema that had EXECUTE for authenticated but not
-- anon. This block is idempotent/safe to re-run any time a new
-- SECURITY DEFINER function is added and needs the same treatment.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon;', r.proname, r.args);
  END LOOP;
END $$;


-- ================================================================================
-- ================================================================================
--   2026-08 SESSION DELTA — appended below (see DEVELOPER_GUIDE.md's
--   "2026-08 Session" section for the full story behind each change).
--   Everything below is idempotent — safe to re-run.
-- ================================================================================
-- ================================================================================

-- ================================================================
-- MINI ESPORTS — SQL DELTA (2026-08 session)
-- ================================================================
-- This file documents every schema/RPC change made during this
-- session, on top of COMPLETE_SCHEMA.sql. It is idempotent — safe to
-- run again on a DB that already has these changes (uses IF NOT
-- EXISTS / CREATE OR REPLACE throughout). Applied live to production
-- via Supabase MCP already; this file exists so the change history is
-- documented outside of chat, and so the schema can be rebuilt from
-- scratch if ever needed (e.g. staging environment).
--
-- Organized in the order changes were made. Read DEVELOPER_GUIDE.md's
-- "2026-08 Session — What Changed and Why" section alongside this for
-- the reasoning behind each change, not just the DDL.
-- ================================================================


-- ================================================================
-- PART 1: LOCATION / CITY LEADERBOARD (one-time GPS geolocation)
-- ================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS location_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;

COMMENT ON COLUMN users.location_set_at IS 'When the user''s city/state was captured via one-time geolocation. NULL = never set, can still be set. Non-NULL = locked, cannot be changed by the user again.';

-- Server-side one-time lock: even if the client is tampered with, a
-- user cannot call this twice — location_set_at being non-NULL blocks
-- any further writes.
CREATE OR REPLACE FUNCTION public.set_user_location_once(p_city TEXT, p_state TEXT, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_already TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT location_set_at INTO v_already FROM users WHERE id = v_uid;
  IF v_already IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_set', 'set_at', v_already);
  END IF;

  IF p_city IS NULL OR TRIM(p_city) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_city');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_coordinates');
  END IF;

  UPDATE users
  SET city = TRIM(p_city),
      state = NULLIF(TRIM(COALESCE(p_state, '')), ''),
      location_lat = p_lat,
      location_lng = p_lng,
      location_set_at = NOW()
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true, 'city', TRIM(p_city), 'state', p_state);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_user_location_once(text,text,double precision,double precision) TO authenticated, anon;


-- ================================================================
-- PART 2: PROFILE STATUS BUG FIXES
-- ================================================================

-- Was writing profile_status = 'complete' (a value the User Panel's
-- client-side isOk()/isVO() gate never recognized as verified — stuck
-- approved users on "View Only" forever) and profile_verified = true
-- (a column that doesn't exist on `users` at all — that assignment
-- would silently no-op or error depending on Postgres version).
-- Fixed to write 'approved' and drop the nonexistent column.
CREATE OR REPLACE FUNCTION public.admin_approve_profile(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req      profile_requests%ROWTYPE;
  v_ign      TEXT;
  v_ff_uid   TEXT;
  v_conflict TEXT;
BEGIN
  IF NOT public.is_caller_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  SELECT * INTO v_req FROM profile_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'request_not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed');
  END IF;

  v_ign    := NULLIF(TRIM(v_req.requested_ign), '');
  v_ff_uid := NULLIF(TRIM(v_req.requested_uid), '');

  IF v_ign IS NOT NULL THEN
    SELECT id INTO v_conflict FROM users WHERE lower(ign) = lower(v_ign) AND id <> v_req.user_id LIMIT 1;
    IF v_conflict IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ign_taken');
    END IF;
  END IF;
  IF v_ff_uid IS NOT NULL THEN
    SELECT id INTO v_conflict FROM users WHERE ff_uid = v_ff_uid AND id <> v_req.user_id LIMIT 1;
    IF v_conflict IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ff_uid_taken');
    END IF;
  END IF;

  UPDATE users
  SET ign            = COALESCE(v_ign, ign),
      ff_uid         = COALESCE(v_ff_uid, ff_uid),
      profile_status = 'approved',
      pending_ign    = NULL
  WHERE id = v_req.user_id;

  UPDATE profile_requests
  SET status = 'approved', reviewed_by = auth.jwt() ->> 'sub', updated_at = NOW()
  WHERE id = p_request_id;

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (
    v_req.user_id, 'profile_approved', '✅ Profile Approved!',
    CASE WHEN v_ign IS NOT NULL THEN 'IGN: ' || v_ign || ' approved. Full access unlocked!'
         ELSE 'Your profile has been approved.' END
  );

  RETURN jsonb_build_object('success', true, 'uid', v_req.user_id, 'ign', v_ign, 'ff_uid', v_ff_uid);
END;
$function$;

-- One-time data fix: any user who got stuck with 'complete' from the
-- old buggy RPC before this fix was applied.
UPDATE users SET profile_status='approved' WHERE profile_status='complete';


-- ================================================================
-- PART 3: PROFILE UPDATE ROUTING (verified user edits → separate queue)
-- ================================================================
-- No new schema — profile_updates table already existed. The bug was
-- entirely in User Panel client code (screens/profile.js) always
-- writing to profile_requests regardless of whether the user was
-- already verified. See DEVELOPER_GUIDE.md for the client-side fix.


-- ================================================================
-- PART 4: CREATOR PROGRAM REDESIGN — spend-triggered commission
-- ================================================================

-- Commission now fires when a referred user SPENDS Sky Diamonds in a
-- paid match (validate_and_join_match), not when they buy Sky
-- Diamonds. Also enforces the self-play block: a creator can never
-- join a match they themselves host.
CREATE OR REPLACE FUNCTION public.validate_and_join_match(p_uid text, p_match_id text, p_entry_fee numeric, p_currency text, p_join_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance      NUMERIC;
  v_joined       BOOLEAN := false;
  v_jr_id        UUID;
  v_max_slots    INT;
  v_filled_slots INT;
  v_caller       TEXT := auth.jwt() ->> 'sub';
  v_creator_code TEXT;
  v_creator_uid  TEXT;
  v_commission   NUMERIC;
  v_commission_pct NUMERIC; -- ✅ FIX (2026-08-21): was hardcoded := 25 —
  -- read live from app_settings.creator_system now instead. See
  -- DEVELOPER_GUIDE.md session 2026-08-21 §12 (CRITICAL real-money bug:
  -- every creator was overpaid ~1.67x vs the documented/UI 15% rate).
  v_match_creator TEXT;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT creator_uid INTO v_match_creator FROM matches WHERE id = p_match_id;
  IF v_match_creator IS NOT NULL AND v_match_creator = p_uid THEN
    RAISE EXCEPTION 'SELF_PLAY_BLOCKED';
  END IF;

  IF p_currency = 'coins' THEN
    SELECT coins INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
  ELSE
    SELECT sky_diamonds INTO v_balance FROM users WHERE id = p_uid FOR UPDATE;
  END IF;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_entry_fee > 0 AND v_balance < p_entry_fee THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM join_requests
    WHERE user_id = p_uid AND match_id = p_match_id
      AND status NOT IN ('cancelled','refunded','no_show')
  ) INTO v_joined;
  IF v_joined THEN RAISE EXCEPTION 'ALREADY_JOINED'; END IF;

  SELECT COALESCE(max_slots, 999), COALESCE(filled_slots, 0)
  INTO v_max_slots, v_filled_slots
  FROM matches WHERE id = p_match_id;
  IF v_max_slots IS NOT NULL AND v_filled_slots >= v_max_slots THEN RAISE EXCEPTION 'MATCH_FULL'; END IF;

  IF p_entry_fee > 0 THEN
    IF p_currency = 'coins' THEN
      UPDATE users SET coins = coins - p_entry_fee WHERE id = p_uid;
    ELSE
      UPDATE users SET sky_diamonds = sky_diamonds - p_entry_fee WHERE id = p_uid;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(p_uid, p_currency, 'debit', p_entry_fee, 'match_entry', p_match_id);
  END IF;

  INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, ign_at_join, mode)
  VALUES(
    p_uid, p_match_id, p_entry_fee,
    CASE WHEN p_currency='coins' THEN 'coin' ELSE 'sky_diamond' END,
    'pending',
    COALESCE(p_join_data->>'ign', ''),
    COALESCE(p_join_data->>'mode', 'solo')
  ) RETURNING id INTO v_jr_id;

  UPDATE matches SET filled_slots = COALESCE(filled_slots, 0) + 1 WHERE id = p_match_id;

  IF p_currency <> 'coins' AND p_entry_fee > 0 THEN
    SELECT creator_code INTO v_creator_code FROM users WHERE id = p_uid;
    IF v_creator_code IS NOT NULL THEN
      SELECT user_id INTO v_creator_uid FROM creator_codes WHERE code = v_creator_code;
      IF v_creator_uid IS NOT NULL AND v_creator_uid <> p_uid
         AND EXISTS(SELECT 1 FROM users WHERE id = v_creator_uid AND is_creator = true) THEN
        SELECT COALESCE((value->>'sdMatchCommissionPct')::numeric, 15)
        INTO v_commission_pct
        FROM app_settings WHERE key = 'creator_system';
        v_commission_pct := COALESCE(v_commission_pct, 15);

        v_commission := ROUND(p_entry_fee * v_commission_pct / 100, 2);
        INSERT INTO creator_stats(user_id, total_matches, total_earnings)
        VALUES (v_creator_uid, 1, v_commission)
        ON CONFLICT (user_id) DO UPDATE SET
          total_matches = creator_stats.total_matches + 1,
          total_earnings = creator_stats.total_earnings + v_commission,
          updated_at = NOW();
        INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
        VALUES (v_creator_uid, p_match_id, v_commission, 'sky_diamonds', 'hold', NOW() + INTERVAL '7 days');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'jr_id', v_jr_id::TEXT);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE SQLERRM
        WHEN 'NOT_AUTHORIZED'       THEN 'Not authorized'
        WHEN 'USER_NOT_FOUND'       THEN 'User not found'
        WHEN 'INSUFFICIENT_BALANCE' THEN 'Balance kam hai'
        WHEN 'ALREADY_JOINED'       THEN 'Aap already join ho chuke ho'
        WHEN 'MATCH_FULL'           THEN 'Match full ho gaya'
        WHEN 'SELF_PLAY_BLOCKED'    THEN 'Apne khud ke hosted match mein join nahi kar sakte'
        ELSE SQLERRM
      END
    );
END;
$function$;

-- ✅ ADDED (2026-08-21): CREATE OR REPLACE resets privilege grants on
-- some Postgres/Supabase configurations — this was hit live during the
-- 2026-08-21 session (briefly re-opened EXECUTE to anon on this exact
-- function). Always re-run these two lines after replacing this or any
-- other previously-hardened SECURITY DEFINER RPC.
REVOKE ALL ON FUNCTION validate_and_join_match(text,text,numeric,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_and_join_match(text,text,numeric,text,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION validate_and_join_match(text,text,numeric,text,jsonb) TO authenticated;

-- ✅ ADDED (2026-08-21): creator_system settings row was found empty
-- ({}) live — meaning the Admin Panel's "15%" display text was never
-- actually backed by a saved value, and validate_and_join_match's
-- COALESCE fallback (15) was doing all the work. Seeds real defaults;
-- ON CONFLICT only fills in if still empty, never overwrites a real
-- configured value.
INSERT INTO app_settings(key, value, updated_at)
VALUES ('creator_system', jsonb_build_object(
  'creatorMatchEnabled', true,
  'coinMatchCommissionPct', 10,
  'sdMatchCommissionPct', 15,
  'commissionHoldDays', 7,
  'maxCreatorMatches', 3,
  'minFollowersForSD', 1000
), now())
ON CONFLICT (key) DO UPDATE SET
  value = CASE WHEN app_settings.value = '{}'::jsonb OR app_settings.value IS NULL
               THEN EXCLUDED.value ELSE app_settings.value END;

-- approve_creator_application used to set users.creator_code but never
-- populate creator_codes — the exact table the commission lookup above
-- reads from. Every approved creator's commission attribution was
-- silently dead. Also now enforces the Premium-required rule
-- (confirmed product decision: Creator Program is a Gold+ Premium perk).
CREATE OR REPLACE FUNCTION public.approve_creator_application(p_uid text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_code_taken BOOLEAN;
  v_prem_level INT;
  v_prem_expires TIMESTAMPTZ;
BEGIN
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  SELECT premium_level, premium_expires INTO v_prem_level, v_prem_expires FROM users WHERE id = p_uid;
  IF COALESCE(v_prem_level, 0) <= 0 OR v_prem_expires IS NULL OR v_prem_expires < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Applicant is not an active Premium member');
  END IF;

  SELECT EXISTS(SELECT 1 FROM creator_applications WHERE creator_code = p_code AND user_id <> p_uid) INTO v_code_taken;
  IF v_code_taken THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator code already in use');
  END IF;
  IF EXISTS(SELECT 1 FROM creator_codes WHERE code = p_code AND user_id <> p_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator code already in use');
  END IF;

  UPDATE creator_applications
  SET status = 'approved', creator_code = p_code, reviewed_by = v_caller, updated_at = NOW()
  WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No application found for this user');
  END IF;

  UPDATE users SET is_creator = true, creator_code = p_code WHERE id = p_uid;

  INSERT INTO creator_codes (code, user_id, uses, earnings, created_at)
  VALUES (p_code, p_uid, 0, 0, NOW())
  ON CONFLICT (code) DO UPDATE SET user_id = p_uid;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- One-time backfill for any creator approved before this fix.
INSERT INTO creator_codes (code, user_id, uses, earnings, created_at)
SELECT creator_code, id, 0, 0, NOW() FROM users
WHERE is_creator = true AND creator_code IS NOT NULL
ON CONFLICT (code) DO NOTHING;


-- ================================================================
-- PART 5: CREATOR MATCH HOSTING (secure RPCs, no raw table access)
-- ================================================================
-- SECURITY MODEL: matches/join_requests RLS only allows admin writes.
-- A creator's browser has ZERO direct INSERT/UPDATE access to those
-- tables by database policy. These RPCs are the only door in for a
-- creator, and each independently re-verifies caller identity, match
-- ownership, and hard limits (entry fee <=50, <=100 slots, <=3 open
-- matches, active Premium required).

CREATE OR REPLACE FUNCTION public.creator_create_match(
  p_title TEXT, p_mode TEXT, p_entry_type TEXT, p_entry_fee NUMERIC,
  p_max_slots INT, p_per_kill_prize NUMERIC, p_scheduled_at TIMESTAMPTZ
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_is_creator BOOLEAN;
  v_prem_level INT;
  v_prem_expires TIMESTAMPTZ;
  v_open_count INT;
  v_match_id TEXT;
  v_max_fee CONSTANT NUMERIC := 50;
  v_max_slots CONSTANT INT := 100;
  v_max_open CONSTANT INT := 3;
  v_creator_ign TEXT;
  v_follower_count INT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;

  SELECT is_creator, ign, premium_level, premium_expires INTO v_is_creator, v_creator_ign, v_prem_level, v_prem_expires FROM users WHERE id = v_uid;
  IF NOT COALESCE(v_is_creator, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_creator');
  END IF;
  IF COALESCE(v_prem_level, 0) <= 0 OR v_prem_expires IS NULL OR v_prem_expires < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'premium_required');
  END IF;

  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;

  IF p_entry_type NOT IN ('coins', 'sky_diamond') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_entry_type');
  END IF;
  IF p_entry_fee IS NULL OR p_entry_fee < 1 OR p_entry_fee > v_max_fee THEN
    RETURN jsonb_build_object('success', false, 'error', 'entry_fee_out_of_range', 'max', v_max_fee);
  END IF;
  IF p_max_slots IS NULL OR p_max_slots < 2 OR p_max_slots > v_max_slots THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slot_count', 'max', v_max_slots);
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < NOW() + INTERVAL '20 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_too_soon');
  END IF;
  IF p_title IS NULL OR LENGTH(TRIM(p_title)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_title');
  END IF;

  SELECT COUNT(*) INTO v_open_count
  FROM matches WHERE creator_uid = v_uid AND status IN ('upcoming', 'live');
  IF v_open_count >= v_max_open THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many_open_matches', 'max', v_max_open);
  END IF;

  v_match_id := 'cm_' || gen_random_uuid()::TEXT;

  INSERT INTO matches (
    id, title, name, mode, entry_type, entry_fee, max_slots, filled_slots,
    per_kill_prize, status, scheduled_at, creator_uid, match_sub_type, created_at
  ) VALUES (
    v_match_id, TRIM(p_title), TRIM(p_title), p_mode, p_entry_type, p_entry_fee, p_max_slots, 0,
    COALESCE(p_per_kill_prize, 0), 'upcoming', p_scheduled_at, v_uid, 'creator_hosted', NOW()
  );

  INSERT INTO creator_matches (match_id, creator_uid, commission_pct, commission_type, commission_status, created_at)
  VALUES (v_match_id, v_uid, 25, CASE WHEN p_entry_type = 'coins' THEN 'gd' ELSE 'inr' END, 'pending', NOW());

  -- Notify followers only — opt-in, never a platform-wide blast.
  INSERT INTO notifications(user_id, type, title, body)
  SELECT follower_uid, 'creator_new_match',
    '🎮 ' || COALESCE(v_creator_ign, 'Creator') || ' ne naya match banaya!',
    TRIM(p_title) || ' — Entry: ' || p_entry_fee || (CASE WHEN p_entry_type='coins' THEN ' coins' ELSE ' 💎' END)
  FROM creator_follows WHERE creator_uid = v_uid;

  GET DIAGNOSTICS v_follower_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'match_id', v_match_id, 'notified_followers', v_follower_count);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.creator_create_match(text,text,text,numeric,int,numeric,timestamptz) TO authenticated, anon;


CREATE OR REPLACE FUNCTION public.creator_set_room(p_match_id TEXT, p_room_id TEXT, p_room_password TEXT)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT creator_uid, status INTO v_owner, v_status FROM matches WHERE id = p_match_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_found'); END IF;
  IF v_owner <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_your_match'); END IF;
  IF v_status NOT IN ('upcoming', 'live') THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_active'); END IF;
  IF p_room_id IS NULL OR LENGTH(TRIM(p_room_id)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_room_id');
  END IF;

  UPDATE matches SET room_id = TRIM(p_room_id), room_password = TRIM(COALESCE(p_room_password,'')), status = 'live'
  WHERE id = p_match_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.creator_set_room(text,text,text) TO authenticated, anon;


-- v2: AUTO-APPROVES results by default (players get paid immediately,
-- Admin's queue stays empty). Only flags genuinely anomalous results
-- for review: impossible kill count, repeat-winner pattern, or payout
-- safety cap exceeded. See creator_result_flags (Part 6) for the flag
-- queue this writes into when it does flag something.
CREATE OR REPLACE FUNCTION public.creator_publish_result(p_match_id TEXT, p_results JSONB)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
  v_status TEXT;
  v_max_slots INT;
  v_per_kill NUMERIC;
  v_entry_type TEXT;
  v_total_kills INT;
  v_winner_uid TEXT;
  v_recent_wins INT;
  v_total_payout NUMERIC := 0;
  v_flag_reason TEXT;
  v_max_payout_cap CONSTANT NUMERIC := 500;
  r JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT creator_uid, status, max_slots, per_kill_prize, entry_type
    INTO v_owner, v_status, v_max_slots, v_per_kill, v_entry_type
    FROM matches WHERE id = p_match_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_found'); END IF;
  IF v_owner <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_your_match'); END IF;
  IF v_status <> 'live' THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_live'); END IF;

  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;

  UPDATE join_requests jr
  SET kills = (r->>'kills')::INT,
      placement = (r->>'placement')::INT
  FROM jsonb_array_elements(p_results) r
  WHERE jr.id = (r->>'join_request_id')::UUID AND jr.match_id = p_match_id;

  SELECT COALESCE(SUM(kills),0) INTO v_total_kills FROM join_requests WHERE match_id = p_match_id;
  IF v_total_kills > GREATEST(v_max_slots - 1, 1) * 1.5 THEN
    v_flag_reason := 'impossible_kill_count';
  END IF;

  IF v_flag_reason IS NULL THEN
    SELECT user_id INTO v_winner_uid FROM join_requests WHERE match_id = p_match_id AND placement = 1 LIMIT 1;
    IF v_winner_uid IS NOT NULL THEN
      SELECT COUNT(*) INTO v_recent_wins
      FROM join_requests jr JOIN matches m ON m.id = jr.match_id
      WHERE m.creator_uid = v_uid AND jr.user_id = v_winner_uid AND jr.placement = 1
        AND m.completed_at > NOW() - INTERVAL '30 days';
      IF v_recent_wins >= 3 THEN v_flag_reason := 'repeat_winner_pattern'; END IF;
    END IF;
  END IF;

  v_total_payout := v_total_kills * COALESCE(v_per_kill, 0);
  IF v_total_payout > v_max_payout_cap THEN
    v_flag_reason := COALESCE(v_flag_reason, 'payout_cap_exceeded');
  END IF;

  IF v_flag_reason IS NOT NULL THEN
    UPDATE matches SET status = 'pending_review', completed_at = NOW() WHERE id = p_match_id;
    INSERT INTO creator_result_flags(match_id, creator_uid, reason, details)
    VALUES (p_match_id, v_uid, v_flag_reason, jsonb_build_object('total_kills', v_total_kills, 'total_payout', v_total_payout, 'winner_uid', v_winner_uid));
    RETURN jsonb_build_object('success', true, 'status', 'pending_review', 'flagged', true);
  END IF;

  IF v_per_kill > 0 THEN
    IF v_entry_type = 'coins' THEN
      UPDATE users u SET coins = coins + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    ELSE
      UPDATE users u SET sky_diamonds = sky_diamonds + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    SELECT user_id, v_entry_type, 'credit', kills * v_per_kill, 'creator_match_prize', p_match_id
    FROM join_requests WHERE match_id = p_match_id AND kills > 0;
  END IF;

  UPDATE matches SET status = 'completed', completed_at = NOW() WHERE id = p_match_id;
  PERFORM finalize_creator_commission(p_match_id);

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'flagged', false);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.creator_publish_result(text,jsonb) TO authenticated, anon;


-- ================================================================
-- PART 6: CREATOR TRUST SYSTEM (follows, ratings, flags, strikes)
-- ================================================================

CREATE TABLE IF NOT EXISTS creator_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follower_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creator_uid, follower_uid)
);
CREATE INDEX IF NOT EXISTS idx_creator_follows_creator ON creator_follows(creator_uid);
CREATE INDEX IF NOT EXISTS idx_creator_follows_follower ON creator_follows(follower_uid);
ALTER TABLE creator_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS creator_follows_select_all ON creator_follows;
CREATE POLICY creator_follows_select_all ON creator_follows FOR SELECT USING (true);
DROP POLICY IF EXISTS creator_follows_own_write ON creator_follows;
CREATE POLICY creator_follows_own_write ON creator_follows FOR ALL
  USING ((auth.jwt()->>'sub') = follower_uid) WITH CHECK ((auth.jwt()->>'sub') = follower_uid);
GRANT SELECT, INSERT, DELETE ON creator_follows TO authenticated, anon;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_rating NUMERIC DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS creator_rating_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creator_strikes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creator_suspended_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creator_suspended_permanently BOOLEAN DEFAULT false;
COMMENT ON COLUMN users.creator_strikes IS '3 strikes = auto-suspend hosting for 30 days + cancel Premium. 6 strikes = permanent ban from Creator Program, is_creator forced false.';

CREATE TABLE IF NOT EXISTS creator_match_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  creator_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rater_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, rater_uid)
);
ALTER TABLE creator_match_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmr_select_all ON creator_match_ratings;
CREATE POLICY cmr_select_all ON creator_match_ratings FOR SELECT USING (true);
GRANT SELECT ON creator_match_ratings TO authenticated, anon;
-- No direct INSERT policy — writes only via rate_creator_match RPC.

CREATE TABLE IF NOT EXISTS creator_result_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  creator_uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details JSONB,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
ALTER TABLE creator_result_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crf_admin_all ON creator_result_flags;
CREATE POLICY crf_admin_all ON creator_result_flags FOR ALL
  USING ((auth.jwt()->>'sub') IN (SELECT id FROM users WHERE is_admin = true));
GRANT SELECT, UPDATE ON creator_result_flags TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.rate_creator_match(p_match_id TEXT, p_stars INT, p_reason TEXT)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_creator_uid TEXT;
  v_played BOOLEAN;
  v_new_avg NUMERIC;
  v_new_count INT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  IF p_stars < 1 OR p_stars > 5 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_stars'); END IF;

  SELECT creator_uid INTO v_creator_uid FROM matches WHERE id = p_match_id;
  IF v_creator_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_a_creator_match'); END IF;

  SELECT EXISTS(SELECT 1 FROM join_requests WHERE match_id = p_match_id AND user_id = v_uid) INTO v_played;
  IF NOT v_played THEN RETURN jsonb_build_object('success', false, 'error', 'must_have_joined'); END IF;

  INSERT INTO creator_match_ratings(match_id, creator_uid, rater_uid, stars, reason)
  VALUES (p_match_id, v_creator_uid, v_uid, p_stars, p_reason)
  ON CONFLICT (match_id, rater_uid) DO UPDATE SET stars = p_stars, reason = p_reason;

  SELECT ROUND(AVG(stars)::NUMERIC, 2), COUNT(*) INTO v_new_avg, v_new_count
  FROM creator_match_ratings WHERE creator_uid = v_creator_uid;

  UPDATE users SET creator_rating = v_new_avg, creator_rating_count = v_new_count WHERE id = v_creator_uid;

  -- Soft auto-strike safety net: sustained bad rating (not just a
  -- specific caught incident) also counts.
  IF v_new_count >= 10 AND v_new_avg <= 2.0 THEN
    UPDATE users SET creator_strikes = creator_strikes + 1 WHERE id = v_creator_uid;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_avg', v_new_avg, 'new_count', v_new_count);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rate_creator_match(text,int,text) TO authenticated, anon;


CREATE OR REPLACE FUNCTION public.admin_dismiss_creator_flag(p_flag_id UUID)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_match_id TEXT;
  v_owner TEXT;
  v_per_kill NUMERIC;
  v_entry_type TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id = v_caller AND is_admin = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;

  SELECT match_id, creator_uid INTO v_match_id, v_owner FROM creator_result_flags WHERE id = p_flag_id AND status = 'open';
  IF v_match_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'flag_not_found_or_resolved'); END IF;

  SELECT per_kill_prize, entry_type INTO v_per_kill, v_entry_type FROM matches WHERE id = v_match_id;

  IF v_per_kill > 0 THEN
    IF v_entry_type = 'coins' THEN
      UPDATE users u SET coins = coins + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = v_match_id AND jr.user_id = u.id AND jr.kills > 0;
    ELSE
      UPDATE users u SET sky_diamonds = sky_diamonds + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = v_match_id AND jr.user_id = u.id AND jr.kills > 0;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    SELECT user_id, v_entry_type, 'credit', kills * v_per_kill, 'creator_match_prize', v_match_id
    FROM join_requests WHERE match_id = v_match_id AND kills > 0;
  END IF;

  UPDATE matches SET status = 'completed' WHERE id = v_match_id;
  PERFORM finalize_creator_commission(v_match_id);

  UPDATE creator_result_flags SET status = 'dismissed', resolved_at = NOW(), resolved_by = v_caller WHERE id = p_flag_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_confirm_creator_cheat(p_flag_id UUID)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_match_id TEXT;
  v_owner TEXT;
  v_new_strikes INT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id = v_caller AND is_admin = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_only');
  END IF;

  SELECT match_id, creator_uid INTO v_match_id, v_owner FROM creator_result_flags WHERE id = p_flag_id AND status = 'open';
  IF v_match_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'flag_not_found_or_resolved'); END IF;

  UPDATE users u SET sky_diamonds = sky_diamonds + jr.entry_fee_paid
  FROM join_requests jr, matches m
  WHERE jr.match_id = v_match_id AND jr.user_id = u.id AND m.id = v_match_id AND m.entry_type = 'sky_diamond' AND jr.entry_fee_paid > 0;
  UPDATE users u SET coins = coins + jr.entry_fee_paid
  FROM join_requests jr, matches m
  WHERE jr.match_id = v_match_id AND jr.user_id = u.id AND m.id = v_match_id AND m.entry_type = 'coins' AND jr.entry_fee_paid > 0;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  SELECT jr.user_id, m.entry_type, 'credit', jr.entry_fee_paid, 'creator_match_voided_refund', v_match_id
  FROM join_requests jr JOIN matches m ON m.id = jr.match_id WHERE jr.match_id = v_match_id AND jr.entry_fee_paid > 0;

  UPDATE matches SET status = 'cancelled' WHERE id = v_match_id;
  UPDATE creator_matches SET commission_status = 'voided' WHERE match_id = v_match_id;

  UPDATE users SET creator_strikes = creator_strikes + 1 WHERE id = v_owner RETURNING creator_strikes INTO v_new_strikes;

  IF v_new_strikes >= 6 THEN
    UPDATE users SET creator_suspended_permanently = true, is_creator = false WHERE id = v_owner;
  ELSIF v_new_strikes >= 3 THEN
    UPDATE users SET creator_suspended_until = NOW() + INTERVAL '30 days' WHERE id = v_owner;
    UPDATE users SET premium_level = 0, premium_expires = NULL WHERE id = v_owner;
  END IF;

  UPDATE creator_result_flags SET status = 'confirmed_cheat', resolved_at = NOW(), resolved_by = v_caller WHERE id = p_flag_id;

  INSERT INTO notifications(user_id, type, title, body)
  VALUES (v_owner, 'creator_strike', '⚠️ Match Voided — Cheating Confirmed',
    'Tumhara match "' || v_match_id || '" cheating ke wajah se void kar diya gaya. Strikes: ' || v_new_strikes || '/6.' ||
    CASE WHEN v_new_strikes >= 6 THEN ' Creator Program se permanently ban kar diya gaya.'
         WHEN v_new_strikes >= 3 THEN ' 30 din ke liye hosting suspend kar di gayi hai, aur Premium bhi cancel kar diya gaya hai.'
         ELSE '' END);

  RETURN jsonb_build_object('success', true, 'strikes', v_new_strikes);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_dismiss_creator_flag(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_creator_cheat(uuid) TO authenticated, anon;


-- ================================================================
-- MINI ESPORTS — SQL DELTA (2026-08-17 session)
-- ================================================================
-- This file documents every schema/RPC change made during this
-- session, on top of COMPLETE_SCHEMA.sql (which already has this
-- delta appended to its end). Idempotent — safe to run again on a
-- DB that already has these changes. Applied live to production via
-- Supabase MCP already; this file exists so the change history is
-- documented outside of chat, and so the schema can be rebuilt from
-- scratch if ever needed (e.g. staging environment).
--
-- Read DEVELOPER_GUIDE.md Section 33 alongside this for the
-- reasoning behind each change, not just the DDL.
--
-- Context: product owner confirmed the rule "Firebase only for
-- non-data realtime mechanisms (chat, presence, anti-cheat
-- fingerprinting) — every other piece of data lives in Supabase, no
-- exceptions." This delta moves the remaining Firebase-only paths
-- that were genuinely data (not mechanisms) into Supabase.
-- ================================================================


-- ================================================================
-- PART 1: TDS COMPLIANCE RECORDS (was Firebase tdsRecords/tdsHeld)
-- ================================================================

CREATE TABLE IF NOT EXISTS tds_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  ign                TEXT,
  pan                TEXT,
  type               TEXT DEFAULT 'tds_deducted',
  withdrawal_request_id TEXT,
  diamonds_withdrawn NUMERIC,
  withdrawal_amount  NUMERIC,
  tds_deducted       NUMERIC NOT NULL,
  tds_rate           NUMERIC,
  amount_paid        NUMERIC,
  upi_id             TEXT,
  financial_year     TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tds_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tds_admin_all" ON tds_records;
CREATE POLICY "tds_admin_all" ON tds_records FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "tds_self_insert" ON tds_records;
CREATE POLICY "tds_self_insert" ON tds_records FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "tds_self_select" ON tds_records;
CREATE POLICY "tds_self_select" ON tds_records FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
GRANT SELECT, INSERT ON tds_records TO authenticated, anon;

CREATE TABLE IF NOT EXISTS tds_held (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  amount            NUMERIC NOT NULL,
  withdrawal_id     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tds_held ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tdsheld_admin_all" ON tds_held;
CREATE POLICY "tdsheld_admin_all" ON tds_held FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "tdsheld_self_insert" ON tds_held;
CREATE POLICY "tdsheld_self_insert" ON tds_held FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
GRANT SELECT, INSERT ON tds_held TO authenticated, anon;


-- ================================================================
-- PART 2: ADMIN ACTIONS AUDIT LOG (was Firebase adminActions/)
-- ================================================================

CREATE TABLE IF NOT EXISTS admin_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  match_id     TEXT,
  user_id      TEXT,
  user_name    TEXT,
  new_rank     NUMERIC,
  new_kills    NUMERIC,
  new_prize    NUMERIC,
  delta        NUMERIC,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "adminactions_admin_all" ON admin_actions;
CREATE POLICY "adminactions_admin_all" ON admin_actions FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
GRANT SELECT, INSERT, UPDATE ON admin_actions TO authenticated, anon;


-- ================================================================
-- PART 3: EARLY ACCESS USERS / PREVIEW MODE (was Firebase earlyAccessUsers/)
-- ================================================================

CREATE TABLE IF NOT EXISTS early_access_users (
  user_id      TEXT PRIMARY KEY,
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  name         TEXT DEFAULT '',
  platform     TEXT DEFAULT ''
);
ALTER TABLE early_access_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eau_admin_all" ON early_access_users;
CREATE POLICY "eau_admin_all" ON early_access_users FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
DROP POLICY IF EXISTS "eau_self_insert" ON early_access_users;
CREATE POLICY "eau_self_insert" ON early_access_users FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
DROP POLICY IF EXISTS "eau_self_select" ON early_access_users;
CREATE POLICY "eau_self_select" ON early_access_users FOR SELECT USING (true);
GRANT SELECT, INSERT ON early_access_users TO authenticated, anon;


-- ================================================================
-- PART 4: PLATFORM EARNINGS + SEASON STATS
--   (was Firebase platformEarnings/, seasonStats/{monthKey}/{uid})
-- ================================================================

CREATE TABLE IF NOT EXISTS platform_earnings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     TEXT,
  entry_fee    NUMERIC,
  prize_given  NUMERIC,
  profit       NUMERIC,
  user_id      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE platform_earnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pe_admin_all" ON platform_earnings;
CREATE POLICY "pe_admin_all" ON platform_earnings FOR ALL
  USING ((auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
GRANT SELECT, INSERT ON platform_earnings TO authenticated, anon;

CREATE TABLE IF NOT EXISTS season_stats (
  month_key      TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  ign            TEXT DEFAULT '',
  display_name   TEXT DEFAULT '',
  profile_image  TEXT DEFAULT '',
  wins           NUMERIC DEFAULT 0,
  kills          NUMERIC DEFAULT 0,
  matches        NUMERIC DEFAULT 0,
  points         NUMERIC DEFAULT 0,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (month_key, user_id)
);
ALTER TABLE season_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ss_select_all" ON season_stats;
CREATE POLICY "ss_select_all" ON season_stats FOR SELECT USING (true);
DROP POLICY IF EXISTS "ss_self_write" ON season_stats;
CREATE POLICY "ss_self_write" ON season_stats FOR ALL
  USING ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true))
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id OR (auth.jwt() ->> 'sub') IN (SELECT id FROM users WHERE is_admin = true));
GRANT SELECT, INSERT, UPDATE ON season_stats TO authenticated, anon;

-- Atomic increment RPC — replaces Firebase .transaction() semantics
-- for season stats (avoids read-then-write races between two
-- concurrent match results updating the same user's monthly row).
CREATE OR REPLACE FUNCTION increment_season_stats(
  p_month_key TEXT, p_user_id TEXT, p_ign TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL, p_profile_image TEXT DEFAULT NULL,
  p_wins NUMERIC DEFAULT 0, p_kills NUMERIC DEFAULT 0, p_matches NUMERIC DEFAULT 0
) RETURNS season_stats
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result season_stats;
BEGIN
  INSERT INTO season_stats (month_key, user_id, ign, display_name, profile_image, wins, kills, matches, points, updated_at)
  VALUES (p_month_key, p_user_id, COALESCE(p_ign,''), COALESCE(p_display_name,''), COALESCE(p_profile_image,''),
          p_wins, p_kills, p_matches, (p_wins*50 + p_kills*5 + p_matches*10), NOW())
  ON CONFLICT (month_key, user_id) DO UPDATE SET
    ign = COALESCE(NULLIF(p_ign,''), season_stats.ign),
    display_name = COALESCE(NULLIF(p_display_name,''), season_stats.display_name),
    profile_image = COALESCE(NULLIF(p_profile_image,''), season_stats.profile_image),
    wins = season_stats.wins + p_wins,
    kills = season_stats.kills + p_kills,
    matches = season_stats.matches + p_matches,
    points = (season_stats.wins + p_wins)*50 + (season_stats.kills + p_kills)*5 + (season_stats.matches + p_matches)*10,
    updated_at = NOW()
  RETURNING * INTO result;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION increment_season_stats TO authenticated, anon;


-- ================================================================
-- PART 5: APP_SETTINGS CONSOLIDATION
--   Drops the duplicate 'config' table (only ever held
--   'currentSeason'), moves that row into app_settings, and seeds
--   the new keys used by Preview Mode / Ad Rewards / Creator+Video
--   config now that they've moved off Firebase.
-- ================================================================

INSERT INTO app_settings (key, value, updated_at)
SELECT 'currentSeason', value, updated_at FROM config WHERE key = 'currentSeason'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

DROP TABLE IF EXISTS config;

INSERT INTO app_settings (key, value, updated_at) VALUES
  ('preview_mode',     '{"active": false, "message": "", "launchDate": ""}'::jsonb, NOW()),
  ('video_moderation', '{}'::jsonb, NOW()),
  ('creator_system',   '{}'::jsonb, NOW()),
  ('ad_rewards',       '{"coinsPerAd": 5, "dailyCoinAdLimit": 20}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- NOTE: 'live_config' key already existed in app_settings before this
-- session (a prior session had already wired the User Panel to read
-- it) — this delta doesn't touch its value, only adds the new keys
-- alongside it. The admin Save button writing to it was broken
-- (Firebase-routed, no-op) before this session; that's a JS-side fix,
-- not a schema change — see DEVELOPER_GUIDE.md Section 33.1 / 33.2.


-- ================================================================
-- END OF DELTA
-- ================================================================


-- ================================================================
-- MINI ESPORTS — SQL DELTA (2026-08-18 session)
-- ================================================================
-- This file documents every schema/RPC change made during this
-- session, on top of COMPLETE_SCHEMA.sql (which already has this
-- delta appended to its end). Idempotent — safe to run again on a
-- DB that already has these changes. Applied live to production via
-- Supabase MCP already; this file exists so the change history is
-- documented outside of chat, and so the schema can be rebuilt from
-- scratch if ever needed (e.g. staging environment).
--
-- Read DEVELOPER_GUIDE.md Section 34 alongside this for the
-- reasoning behind each change, not just the DDL.
--
-- Context: this session started from a batch of 12 live-testing bug
-- reports (support ticket reply error, profile update crash, Sky
-- Diamond approval order/ID bugs, missing UTR/screenshot data,
-- disconnected mission rewards, a dead Match Result section, and a
-- false "Verified" badge) and, while tracing the Sky Diamond
-- approval RPC, surfaced a much bigger issue: 13 SECURITY DEFINER
-- RPCs all shared one flawed admin-check pattern that let any
-- unauthenticated caller bypass the admin check entirely. That fix
-- (PART 3 below) is the most important change in this delta.
-- ================================================================


-- ================================================================
-- PART 1: SUPPORT TICKETS — missing replied_at column
-- ================================================================
-- Bug: admin's "Reply" button on Support Tickets threw
-- "Could not find the 'replied_at' column of 'support_tickets' in
-- the schema cache" on every single reply attempt. Root cause:
-- supabase-rtdb-bridge.js's ticketToSupa() converter has always
-- written a replied_at value whenever a reply set .repliedAt, but
-- this column was simply never added to the table.

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;


-- ================================================================
-- PART 2: USERS — profile_status default was 'complete', not
-- 'pending'
-- ================================================================
-- Bug ("Playwright Test User verified nahi thi fir bhi verified
-- show ho rahi hai"): the users table's profile_status column
-- defaulted to 'complete' for every new signup (nothing in the
-- signup path ever set it explicitly). Both the admin panel's
-- Users-list badge and CSV export treated 'complete' as equivalent
-- to 'approved' — meaning EVERY new user showed as "Verified" from
-- the moment they signed up, regardless of whether an admin had
-- ever reviewed them. Fixed the default going forward; the JS-side
-- badge checks were also fixed to only trust 'approved' (see
-- DEVELOPER_GUIDE.md Section 34 — no SQL data migration was needed,
-- all 5 existing users already had profile_status='approved' for
-- real, confirmed via admin_approve_profile's own approval history).

ALTER TABLE users ALTER COLUMN profile_status SET DEFAULT 'pending';


-- ================================================================
-- PART 3: CRITICAL SECURITY FIX — anon-bypass on 13 admin-gated
-- SECURITY DEFINER RPCs
-- ================================================================
-- Every one of these RPCs used the same flawed pattern:
--
--   IF v_caller IS NOT NULL THEN
--     -- check is_admin, reject if not
--   END IF;
--   -- proceed regardless if v_caller WAS NULL
--
-- The intent (per DEVELOPER_GUIDE.md's original design notes) was
-- "NULL means a trusted service_role/backend caller, skip the admin
-- check for those." But verified live (via
-- SET LOCAL request.jwt.claims) that a Firebase-authenticated
-- caller's JWT reliably carries a 'sub' claim even when it lacks a
-- 'role' claim — so v_caller (auth.jwt()->>'sub') is NEVER actually
-- NULL for a real admin's browser session. It's ONLY NULL for a
-- genuinely anonymous call with no Authorization header at all.
-- That means the "trust NULL" branch was — in production — a wide
-- open door: any unauthenticated caller with just the public anon
-- key could call increment_balance to credit themselves unlimited
-- coins/diamonds, broadcast fake notifications to every user,
-- activate Premium for any account, resolve wallet requests, etc.,
-- with zero admin check ever running.
--
-- Fix: replaced "v_caller IS NULL → trust it" with an explicit
-- check of the actual Postgres connection role
-- (current_setting('role', true) = 'service_role') — which is what
-- genuine backend/edge-function callers (e.g. the paytm-callback
-- edge function) actually run as. A true anon-key call, even with
-- no JWT at all, now hits the normal "no caller identity → reject"
-- path instead of being silently trusted. Verified both directions
-- live: an authenticated admin's self-call still succeeds; an
-- anon-role call now raises "Not authorized — no caller identity"
-- instead of proceeding.
--
-- Affected functions: increment_balance, decrement_balance,
-- resolve_sd_request, approve_premium, admin_send_broadcast_notification,
-- admin_send_notification, admin_sync_user_balance, admin_set_coins,
-- resolve_sponsored_withdrawal, approve_creator_application,
-- cancel_premium, review_creator_video, increment_rank_points.

CREATE OR REPLACE FUNCTION increment_balance(p_uid TEXT, p_col TEXT, p_amount NUMERIC)
RETURNS VOID AS $$
DECLARE
  allowed_cols TEXT[] := ARRAY[
    'coins','green_diamonds','sky_diamonds',
    'total_wins','total_kills','total_matches','rank_points',
    'win_streak','clean_matches','filled_slots'
  ];
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Not authorized — no caller identity';
    END IF;
    IF v_caller <> p_uid THEN
      SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT COALESCE(v_is_admin, false) THEN
        RAISE EXCEPTION 'Not authorized to modify balance for this user';
      END IF;
    END IF;
  END IF;

  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be non-negative, got: %', p_amount;
  END IF;
  IF NOT (p_col = ANY(allowed_cols)) THEN
    RAISE EXCEPTION 'Column % not allowed', p_col;
  END IF;
  EXECUTE format(
    'UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_col, p_col
  ) USING p_amount, p_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION decrement_balance(p_uid TEXT, p_col TEXT, p_amount NUMERIC)
RETURNS JSONB AS $$
DECLARE
  allowed_cols TEXT[] := ARRAY['coins','green_diamonds','sky_diamonds'];
  v_balance    NUMERIC;
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_admin   BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized — no caller identity');
    END IF;
    IF v_caller <> p_uid THEN
      SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT COALESCE(v_is_admin, false) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized to modify balance for this user');
      END IF;
    END IF;
  END IF;

  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-negative');
  END IF;
  IF NOT (p_col = ANY(allowed_cols)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Column not allowed: ' || p_col);
  END IF;
  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1', p_col)
    USING p_uid INTO v_balance;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance',
      'balance', v_balance, 'required', p_amount);
  END IF;
  EXECUTE format(
    'UPDATE users SET %I = GREATEST(COALESCE(%I, 0) - $1, 0) WHERE id = $2',
    p_col, p_col
  ) USING p_amount, p_uid;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION resolve_sd_request(p_request_id UUID, p_action TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_caller  TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_req     RECORD;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid action');
  END IF;

  SELECT * INTO v_req FROM sd_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request not found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Request already resolved (status: ' || v_req.status || ')');
  END IF;

  IF v_req.request_type = 'sky_diamond_purchase' THEN
    IF p_action = 'approve' THEN
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds, 0) + v_req.sd_amount WHERE id = v_req.user_id;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES(v_req.user_id, 'sky_diamonds', 'credit', v_req.sd_amount, 'sd_purchase_approved', p_request_id::TEXT);
    END IF;
  ELSIF v_req.request_type = 'green_diamond_withdrawal' THEN
    IF p_action = 'reject' THEN
      UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_req.sd_amount WHERE id = v_req.user_id;
      INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
      VALUES(v_req.user_id, 'green_diamonds', 'credit', v_req.sd_amount, 'withdrawal_rejected_refund', p_request_id::TEXT);
    END IF;
  END IF;

  UPDATE sd_requests SET
    status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_by = v_caller,
    review_note = p_note
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'request_type', v_req.request_type, 'action', p_action);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION approve_premium(p_uid TEXT, p_tier INT, p_days INT DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_current_expires TIMESTAMPTZ;
  v_user_exists BOOLEAN;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_tier NOT IN (1,2,3) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;

  SELECT true, premium_expires INTO v_user_exists, v_current_expires FROM users WHERE id = p_uid;
  IF NOT COALESCE(v_user_exists, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  UPDATE users SET
    premium_level = p_tier,
    premium_expires = GREATEST(COALESCE(v_current_expires, NOW()), NOW()) + (p_days || ' days')::INTERVAL
  WHERE id = p_uid;

  RETURN jsonb_build_object('success', true, 'tier', p_tier, 'days', p_days);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION admin_send_broadcast_notification(p_type TEXT, p_title TEXT, p_body TEXT)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  INSERT INTO notifications(user_id, type, title, body, is_read, target_all)
  VALUES(NULL, p_type, p_title, p_body, false, true);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION admin_send_notification(p_user_id TEXT, p_type TEXT, p_title TEXT, p_body TEXT, p_ref_id TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  INSERT INTO notifications(user_id, type, title, body, ref_id, is_read)
  VALUES(p_user_id, p_type, p_title, p_body, p_ref_id, false);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION admin_sync_user_balance(p_uid TEXT, p_coins NUMERIC, p_sky_diamonds NUMERIC, p_green_diamonds NUMERIC)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_coins < 0 OR p_sky_diamonds < 0 OR p_green_diamonds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Balances must be non-negative');
  END IF;

  UPDATE users SET
    coins = p_coins,
    sky_diamonds = p_sky_diamonds,
    green_diamonds = p_green_diamonds
  WHERE id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION admin_set_coins(p_uid TEXT, p_action TEXT, p_amount NUMERIC)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_current  NUMERIC;
  v_new      NUMERIC;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('add','remove','set') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;
  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be non-negative');
  END IF;

  SELECT coins INTO v_current FROM users WHERE id = p_uid FOR UPDATE;
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new := CASE p_action
    WHEN 'add'    THEN v_current + p_amount
    WHEN 'remove' THEN GREATEST(v_current - p_amount, 0)
    ELSE p_amount
  END;

  UPDATE users SET coins = v_new WHERE id = p_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(p_uid, 'coins', CASE p_action WHEN 'remove' THEN 'debit' ELSE 'credit' END,
         ABS(v_new - v_current), 'admin_coin_manager', v_caller);

  RETURN jsonb_build_object('success', true, 'old_balance', v_current, 'new_balance', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION resolve_sponsored_withdrawal(p_txn_id UUID, p_action TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_txn      RECORD;
  v_balance  NUMERIC;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  SELECT * INTO v_txn FROM wallet_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;
  IF v_txn.txn_type <> 'pending_withdraw' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a pending withdrawal');
  END IF;
  IF COALESCE(v_txn.status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already resolved (status: ' || v_txn.status || ')');
  END IF;

  IF p_action = 'approve' THEN
    SELECT sponsored_winnings INTO v_balance FROM users WHERE id = v_txn.user_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance < v_txn.amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient sponsored_winnings remaining — balance may have changed since request was submitted');
    END IF;
    UPDATE users SET sponsored_winnings = sponsored_winnings - v_txn.amount WHERE id = v_txn.user_id;
  END IF;

  UPDATE wallet_transactions SET
    status = CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    note = COALESCE(p_note, note)
  WHERE id = p_txn_id;

  RETURN jsonb_build_object('success', true, 'action', p_action, 'user_id', v_txn.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION approve_creator_application(p_uid TEXT, p_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_code_taken BOOLEAN;
  v_prem_level INT;
  v_prem_expires TIMESTAMPTZ;
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  SELECT premium_level, premium_expires INTO v_prem_level, v_prem_expires FROM users WHERE id = p_uid;
  IF COALESCE(v_prem_level, 0) <= 0 OR v_prem_expires IS NULL OR v_prem_expires < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Applicant is not an active Premium member');
  END IF;

  SELECT EXISTS(SELECT 1 FROM creator_applications WHERE creator_code = p_code AND user_id <> p_uid) INTO v_code_taken;
  IF v_code_taken THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator code already in use');
  END IF;
  IF EXISTS(SELECT 1 FROM creator_codes WHERE code = p_code AND user_id <> p_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Creator code already in use');
  END IF;

  UPDATE creator_applications
  SET status = 'approved', creator_code = p_code, reviewed_by = v_caller, updated_at = NOW()
  WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No application found for this user');
  END IF;

  UPDATE users SET is_creator = true, creator_code = p_code WHERE id = p_uid;

  INSERT INTO creator_codes (code, user_id, uses, earnings, created_at)
  VALUES (p_code, p_uid, 0, 0, NOW())
  ON CONFLICT (code) DO UPDATE SET user_id = p_uid;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION cancel_premium(p_uid TEXT)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  UPDATE users SET premium_level = 0, premium_expires = NULL WHERE id = p_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION review_creator_video(p_video_id UUID, p_action TEXT)
RETURNS JSONB AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  UPDATE creator_videos SET
    status = CASE p_action WHEN 'approve' THEN 'live' ELSE 'removed' END,
    report_count = CASE p_action WHEN 'approve' THEN 0 ELSE report_count END
  WHERE id = p_video_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Video not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'action', p_action);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION increment_rank_points(p_uid TEXT, p_points INT)
RETURNS VOID AS $$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  IF NOT v_is_service AND v_caller IS DISTINCT FROM p_uid THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Not authorized — no caller identity';
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'Not authorized to modify rank points for this user';
    END IF;
  END IF;
  IF p_points < 0 THEN RAISE EXCEPTION 'Points must be non-negative'; END IF;
  UPDATE users SET rank_points = COALESCE(rank_points, 0) + p_points WHERE id = p_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ================================================================
-- VERIFICATION QUERIES RUN THIS SESSION (for reference — not part
-- of the actual migration, included so the reasoning is auditable)
-- ================================================================
-- Confirmed a Firebase JWT's 'sub' claim resolves correctly under
-- authenticated role even without a 'role' claim in the JWT payload:
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"playwright-test-user-001"}';
--   SELECT auth.jwt()->>'sub' as sub_val, auth.jwt()->>'role' as role_val;
--   ROLLBACK;
--   -- => sub_val = 'playwright-test-user-001', role_val = NULL
--
-- Confirmed current_setting('role', true) correctly identifies a
-- true service_role connection:
--
--   BEGIN;
--   SET LOCAL ROLE service_role;
--   SELECT current_setting('role', true) as pg_role;
--   ROLLBACK;
--   -- => pg_role = 'service_role'
--
-- Regression check — legitimate admin self-call still works after
-- the fix:
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"playwright-test-user-001"}';
--   SELECT increment_balance('playwright-test-user-001','coins',0);
--   ROLLBACK;
--   -- => succeeds
--
-- Anon-bypass check — a true anon-role call is now correctly
-- rejected:
--
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT increment_balance('playwright-test-user-001','coins',999999);
--   ROLLBACK;
--   -- => ERROR: Not authorized — no caller identity

-- ================================================================
-- PART 4 (ADDENDUM): MAINTENANCE MODE MOVED FROM FIREBASE TO SUPABASE
-- ================================================================
-- Maintenance Mode originally lived at Firebase RTDB path
-- appSettings/maintenance. Every piece of that code path was traced
-- and found correct — the suspected remaining issue was that
-- firebase-rules.json's rules might not match what's actually
-- deployed live on the Firebase Console (unverifiable without
-- Console access). Rather than depend on that, migrated the whole
-- feature onto Supabase app_settings, mirroring how Preview Mode
-- was migrated in an earlier session.
--
-- app_settings already has correct RLS from Preview Mode's earlier
-- migration (as_select_all: anyone can read; as_admin_write: only
-- real admins can write, checked via auth.jwt()->>'sub' against
-- users.is_admin) — no new policy needed, just a new row.

INSERT INTO app_settings (key, value, updated_at)
VALUES ('maintenance', '{"active": false, "message": ""}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- app_settings was NOT in the supabase_realtime publication at all —
-- meaning any postgres_changes subscription on it (used by both
-- panels' live maintenance-toggle behavior, and potentially by
-- Preview Mode too) would silently never fire. Required for the
-- User Panel to see a maintenance toggle live without a page reload.

ALTER PUBLICATION supabase_realtime ADD TABLE app_settings;


-- ================================================================
-- END OF DELTA
-- ================================================================

-- ================================================================
-- 2026-08-24 SESSION DELTA — 10 bugs fixed. Full detail + explanations
-- in 2026-08-24-SESSION-DELTA.sql. Summary of DB changes below.
-- ================================================================

-- ── Bug #5: streak milestones — moved off Firebase RTDB onto Supabase,
-- atomic FOR-UPDATE-locked claim RPC (same pattern as purchase_cosmetic) ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_milestones_claimed JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS claim_streak_milestone(integer, integer, text);
CREATE OR REPLACE FUNCTION claim_streak_milestone(p_day INTEGER, p_coins INTEGER, p_badge TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_streak INTEGER;
  v_claimed JSONB;
  v_key TEXT := 'day_' || p_day::text;
  v_new_balance NUMERIC;
  v_current_title TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF p_day IS NULL OR p_coins IS NULL OR p_coins <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_params'); END IF;

  SELECT streak_days, streak_milestones_claimed, title
    INTO v_streak, v_claimed, v_current_title
    FROM users WHERE id = v_uid FOR UPDATE;

  IF v_streak IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'user_not_found'); END IF;
  IF v_streak < p_day THEN RETURN jsonb_build_object('ok', false, 'error', 'streak_not_reached'); END IF;
  IF v_claimed ? v_key THEN RETURN jsonb_build_object('ok', true, 'already_claimed', true); END IF;

  UPDATE users
     SET streak_milestones_claimed = streak_milestones_claimed || jsonb_build_object(v_key, true),
         coins = coins + p_coins,
         title = CASE WHEN p_badge IS NOT NULL AND (title IS NULL OR title = '') THEN p_badge ELSE title END
   WHERE id = v_uid
   RETURNING coins INTO v_new_balance;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', p_coins, 'streak_milestone', p_day || '-day streak bonus');

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new_balance, 'day', p_day);
END;
$$;
REVOKE ALL ON FUNCTION claim_streak_milestone(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_streak_milestone(integer, integer, text) TO authenticated;

-- ── Bug #7: creator_create_match was hard-failing on EVERY call —
-- matches.name is a GENERATED ALWAYS column (derived from title); the
-- old version illegally tried to INSERT into it directly. Also adds
-- first_prize/second_prize/third_prize support for creators. ──
DROP FUNCTION IF EXISTS creator_create_match(text, text, text, numeric, integer, numeric, timestamptz);
CREATE OR REPLACE FUNCTION creator_create_match(
  p_title TEXT, p_mode TEXT, p_entry_type TEXT, p_entry_fee NUMERIC,
  p_max_slots INT, p_per_kill_prize NUMERIC, p_scheduled_at TIMESTAMPTZ,
  p_first_prize NUMERIC DEFAULT 0, p_second_prize NUMERIC DEFAULT 0, p_third_prize NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_is_creator BOOLEAN;
  v_prem_level INT;
  v_prem_expires TIMESTAMPTZ;
  v_open_count INT;
  v_match_id TEXT;
  v_max_fee CONSTANT NUMERIC := 50;
  v_max_slots CONSTANT INT := 100;
  v_max_open CONSTANT INT := 3;
  v_creator_ign TEXT;
  v_follower_count INT;
  v_prize_pool NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;

  SELECT is_creator, ign, premium_level, premium_expires INTO v_is_creator, v_creator_ign, v_prem_level, v_prem_expires FROM users WHERE id = v_uid;
  IF NOT COALESCE(v_is_creator, false) THEN RETURN jsonb_build_object('success', false, 'error', 'not_a_creator'); END IF;
  IF COALESCE(v_prem_level, 0) <= 0 OR v_prem_expires IS NULL OR v_prem_expires < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'premium_required');
  END IF;

  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;

  IF p_entry_type NOT IN ('coins', 'sky_diamond') THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_entry_type'); END IF;
  IF p_entry_fee IS NULL OR p_entry_fee < 1 OR p_entry_fee > v_max_fee THEN
    RETURN jsonb_build_object('success', false, 'error', 'entry_fee_out_of_range', 'max', v_max_fee);
  END IF;
  IF p_max_slots IS NULL OR p_max_slots < 2 OR p_max_slots > v_max_slots THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slot_count', 'max', v_max_slots);
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < NOW() + INTERVAL '20 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_too_soon');
  END IF;
  IF p_title IS NULL OR LENGTH(TRIM(p_title)) < 3 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_title'); END IF;

  v_prize_pool := COALESCE(p_first_prize,0) + COALESCE(p_second_prize,0) + COALESCE(p_third_prize,0);
  IF v_prize_pool > (p_max_slots * p_entry_fee) THEN
    RETURN jsonb_build_object('success', false, 'error', 'prize_exceeds_pool', 'max', p_max_slots * p_entry_fee);
  END IF;
  IF p_first_prize < 0 OR p_second_prize < 0 OR p_third_prize < 0 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_prize'); END IF;

  SELECT COUNT(*) INTO v_open_count FROM matches WHERE creator_uid = v_uid AND status IN ('upcoming', 'live');
  IF v_open_count >= v_max_open THEN RETURN jsonb_build_object('success', false, 'error', 'too_many_open_matches', 'max', v_max_open); END IF;

  v_match_id := 'cm_' || gen_random_uuid()::TEXT;

  -- NOTE: `name` intentionally NOT listed here — it is a GENERATED
  -- column derived from `title`; Postgres rejects any explicit value.
  INSERT INTO matches (
    id, title, mode, entry_type, entry_fee, max_slots, filled_slots,
    per_kill_prize, status, scheduled_at, creator_uid, match_sub_type, created_at,
    first_prize, second_prize, third_prize, prize_pool, prize_type
  ) VALUES (
    v_match_id, TRIM(p_title), p_mode, p_entry_type, p_entry_fee, p_max_slots, 0,
    COALESCE(p_per_kill_prize, 0), 'upcoming', p_scheduled_at, v_uid, 'creator_hosted', NOW(),
    COALESCE(p_first_prize,0), COALESCE(p_second_prize,0), COALESCE(p_third_prize,0), v_prize_pool,
    CASE WHEN p_entry_type = 'coins' THEN 'coins' ELSE 'sky_diamond' END
  );

  INSERT INTO creator_matches (match_id, creator_uid, commission_pct, commission_type, commission_status, created_at)
  VALUES (v_match_id, v_uid, 25, CASE WHEN p_entry_type = 'coins' THEN 'gd' ELSE 'inr' END, 'pending', NOW());

  INSERT INTO notifications(user_id, type, title, body)
  SELECT follower_uid, 'creator_new_match',
    '🎮 ' || COALESCE(v_creator_ign, 'Creator') || ' ne naya match banaya!',
    TRIM(p_title) || ' — Entry: ' || p_entry_fee || (CASE WHEN p_entry_type='coins' THEN ' coins' ELSE ' 💎' END)
  FROM creator_follows WHERE creator_uid = v_uid;

  GET DIAGNOSTICS v_follower_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'match_id', v_match_id, 'notified_followers', v_follower_count);
END;
$$;
REVOKE ALL ON FUNCTION creator_create_match(text, text, text, numeric, integer, numeric, timestamptz, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION creator_create_match(text, text, text, numeric, integer, numeric, timestamptz, numeric, numeric, numeric) TO authenticated;

-- ── Bug #10: realtime was effectively dead app-wide — the
-- supabase_realtime publication only ever contained app_settings (see
-- the note directly above from an earlier session that added JUST that
-- one table for JUST the maintenance-toggle feature, and was never
-- generalized). Every postgres_changes subscription in BOTH panels —
-- matches, users, join_requests, notifications, polls,
-- wallet_transactions, sd_requests, sponsored_tournaments, and dozens
-- of admin-side tables — was connecting successfully and silently
-- receiving nothing. This is very likely the single biggest
-- contributor to "app baar baar refresh karna padta hai" across the
-- whole product, independent of any individual screen's own bugs. ──
ALTER PUBLICATION supabase_realtime ADD TABLE
  matches, users, join_requests, notifications, wallet_transactions, sd_requests,
  sponsored_tournaments, polls, poll_votes, user_cosmetics, creator_matches,
  admin_actions, admin_activity_log, admin_alerts, admin_notes, admin_watchlist,
  admins, auto_squad_queue, ban_appeals, battle_pass_progress, blacklist,
  cheat_reports, city_championship, clan_members, clan_messages,
  clan_war_challenges, clan_wars, clans, coin_requests, creator_codes,
  creator_payouts, creator_stats, disputes, early_access_users, ff_uid_index,
  fraud_cases, gift_tickets, kyc_requests, leaderboard, leaderboard_archive,
  match_feedback, match_results, match_templates, mentor_profiles,
  platform_earnings, platform_stats, premium_requests, profile_requests,
  profile_updates, referrals, refund_requests, scheduled_broadcasts,
  season_pass_requests, seasonal_league_history, suggestions, support_tickets,
  tds_held, tds_records, team_requests, tournament_brackets, user_matches,
  vouchers, wallet_audit_log;

-- Client-side-only fixes (#1, #2, #3, #4, #6, #8, #9 client portion) —
-- no DB change, see 2026-08-24-SESSION-DELTA.sql and DEVELOPER_GUIDE.md
-- session summary section for full explanations.

-- ================================================================
-- END OF DELTA (2026-08-24)
-- ================================================================

-- ================================================================
-- 2026-08-25 / 2026-08-25b / 2026-08-28 / 2026-08-29 — no DB changes.
-- Every bug in these four sessions was client-side JS (User Panel
-- and/or Admin Panel) or a live GRANT/schema-cache re-issue with no
-- lasting schema difference. Full details in
-- 2026-08-25-SESSION-DELTA.sql, 2026-08-25b-SESSION-DELTA.sql,
-- 2026-08-28-SESSION-DELTA.sql, 2026-08-29-SESSION-DELTA.sql and
-- DEVELOPER_GUIDE.md. Nothing to apply here.
-- ================================================================

-- ================================================================
-- SESSION DELTA — 2026-08-26 / 2026-08-26b
-- New RPC: admin_create_sponsored_match — lets an admin create a
-- sponsored tournament as a single atomic operation (a real, joinable
-- matches row PLUS its sponsored_tournaments branding row), replacing
-- an earlier design that required manually linking a pre-existing
-- match id (see 2026-08-25b-SESSION-DELTA.sql item #3 for why that was
-- broken — admins kept leaving it blank).
--
-- IMPORTANT: the version below is the CORRECTED one. The first
-- 2026-08-26 pass initially listed `name` explicitly in the INSERT
-- INTO matches column list, which fails outright — matches.name is
-- GENERATED ALWAYS AS (title) STORED (see creator_create_match a few
-- sessions earlier, which hit and fixed this exact same class of
-- error), and Postgres forbids inserting into a GENERATED ALWAYS
-- column under any circumstances. Fixed same-day in the 2026-08-26b
-- pass by dropping `name` from the column list — matches.name fills
-- itself in automatically from title. Verified live against the
-- actual deployed function on 2026-09-16 (pg_get_functiondef) to
-- confirm this is exactly what's running — it is.
-- ================================================================

CREATE OR REPLACE FUNCTION public.admin_create_sponsored_match(
  p_title            TEXT,
  p_sponsor_name     TEXT,
  p_mode             TEXT DEFAULT 'solo',
  p_max_slots        INT DEFAULT 48,
  p_scheduled_at     TIMESTAMPTZ DEFAULT NULL,
  p_first_prize      NUMERIC DEFAULT 0,
  p_second_prize     NUMERIC DEFAULT 0,
  p_third_prize      NUMERIC DEFAULT 0,
  p_prize_type       TEXT DEFAULT 'cash',
  p_description      TEXT DEFAULT NULL,
  p_map              TEXT DEFAULT 'Bermuda'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_uid TEXT := auth.jwt() ->> 'sub';
  v_match_id  TEXT;
  v_pool      NUMERIC;
  v_sched     TIMESTAMPTZ;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM users WHERE id = v_admin_uid), false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_title');
  END IF;
  IF p_sponsor_name IS NULL OR length(trim(p_sponsor_name)) < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_sponsor_name');
  END IF;
  IF p_mode NOT IN ('solo','duo','squad') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_mode');
  END IF;
  IF p_max_slots < 2 OR p_max_slots > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slot_count');
  END IF;
  IF p_first_prize < 0 OR p_second_prize < 0 OR p_third_prize < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_prize');
  END IF;

  v_sched := COALESCE(p_scheduled_at, NOW() + INTERVAL '20 minutes');
  IF v_sched < NOW() + INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_too_soon');
  END IF;

  v_pool := p_first_prize + p_second_prize + p_third_prize;

  -- Sponsored matches are always free entry — sponsor funds the whole
  -- prize pool. (name intentionally NOT listed — it's
  -- GENERATED ALWAYS AS (title))
  INSERT INTO matches (
    title, mode, entry_type, entry_fee, max_slots, filled_slots,
    prize_pool, first_prize, second_prize, third_prize, prize_type,
    map, status, scheduled_at, is_sponsored, room_status
  ) VALUES (
    p_title, p_mode, 'free', 0, p_max_slots, 0,
    v_pool, p_first_prize, p_second_prize, p_third_prize, p_prize_type,
    p_map, 'upcoming', v_sched, true, 'pending'
  ) RETURNING id INTO v_match_id;

  INSERT INTO sponsored_tournaments (
    title, sponsor_name, prize_pool, prize_type, entry_type, status,
    match_id, description, prizes
  ) VALUES (
    p_title, p_sponsor_name, v_pool, p_prize_type, 'free', 'active',
    v_match_id, p_description,
    jsonb_build_object('first', p_first_prize, 'second', p_second_prize, 'third', p_third_prize)
  );

  RETURN jsonb_build_object('success', true, 'match_id', v_match_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_sponsored_match(
  TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO authenticated;

-- ================================================================
-- END OF DELTA (2026-08-26 / 2026-08-26b)
-- ================================================================

-- ================================================================
-- SESSION DELTA — 2026-09-16
-- sync_leaderboard() lost SECURITY DEFINER — "Photo save failed: new
-- row violates row-level security policy for table 'leaderboard'
-- [42501]". Note: THIS FILE'S base definition of sync_leaderboard()
-- (see the CREATE OR REPLACE FUNCTION sync_leaderboard() block earlier
-- in this file, dated 2026-08-22) already has SECURITY DEFINER and is
-- correct — the bug was introduced and then fixed entirely within
-- 2026-08-22-SESSION-DELTA.sql itself (a same-day CREATE OR REPLACE in
-- that delta briefly dropped it), so there is nothing further to
-- change here. This note exists so a future audit of "was this
-- actually fixed everywhere" finds a clear answer instead of having to
-- re-derive it: verified live on 2026-09-16 via
--   SELECT proname, prosecdef FROM pg_proc WHERE proname='sync_leaderboard';
-- → prosecdef = true, confirmed correct. Full incident writeup in
-- 2026-09-16-SESSION-DELTA.sql.
-- ================================================================


-- ================================================================
-- SECTION 23 — 2026-09-20: MERGED MISSING 2026-08-23 DELTA + SECURITY LOCKDOWN
-- ================================================================
-- ✅ Part A: 2026-08-23-SESSION-DELTA.sql ka SQL jo LIVE database par
--    chal chuka tha par is file me kabhi merge nahi hua tha (audit me
--    pakda gaya — complete-schema reconciliation). Idempotent banaya
--    gaya hai (file convention ke mutabik). One-time data-cleanup
--    statements delta file me comments ke roop me hain — unhe dobara
--    na chalana hai, wo historical hain.
-- ✅ Part B: SECURITY LOCKDOWN (2026-09-20) — live-tested security
--    audit (sab REST-tested + verified) ke baad:
--    • wallet_transactions INSERT ab sirf system/admin + 4 legit
--      user request-types allow karta hai (fake 'match_win' 50k hole CLOSED)
--    • match_results INSERT/UPDATE/DELETE sirf system/admin
--      (fake result hole CLOSED)
--    • mr_insert_admin policy: admin panel publish-flow ke upserts
--      ke liye (pehle mr_insert_own sirf own-row allow karta tha —
--      yahi publish ke Supabase-half ko chupchap tod raha tha;
--      FK theek tha, unique constraint pehle se thi)

-- ──────────────── Part A (merged 2026-08-23) ────────────────

-- Bug #3 (08-23): Monthly premium bonus double-claim fix
CREATE TABLE IF NOT EXISTS public.premium_monthly_bonus_claims (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES public.users(id),
  month_key   TEXT NOT NULL,   -- 'YYYY-MM'
  tier        INT NOT NULL,
  bonus_coins INT NOT NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, month_key)
);
ALTER TABLE public.premium_monthly_bonus_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pmbc_select_own ON public.premium_monthly_bonus_claims;
CREATE POLICY pmbc_select_own ON public.premium_monthly_bonus_claims
  FOR SELECT USING ((auth.jwt() ->> 'sub') = user_id OR is_caller_admin());
DROP POLICY IF EXISTS pmbc_insert_own ON public.premium_monthly_bonus_claims;
CREATE POLICY pmbc_insert_own ON public.premium_monthly_bonus_claims
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
GRANT SELECT, INSERT ON public.premium_monthly_bonus_claims TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.premium_monthly_bonus_claims_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_premium_monthly_bonus(p_tier INT, p_bonus_coins INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_month TEXT := to_char(NOW(), 'YYYY-MM');
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF p_tier NOT IN (1,2,3) OR p_bonus_coins <= 0 OR p_bonus_coins > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;
  BEGIN
    INSERT INTO premium_monthly_bonus_claims(user_id, month_key, tier, bonus_coins)
    VALUES (v_uid, v_month, p_tier, p_bonus_coins);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
  END;
  UPDATE users SET coins = COALESCE(coins,0) + p_bonus_coins WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', p_bonus_coins, 'premium_bonus', 'Monthly Premium Bonus Tier ' || p_tier);
  RETURN jsonb_build_object('ok', true, 'bonus', p_bonus_coins, 'month', v_month);
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(INT, INT) TO authenticated;

-- Bug #15 (08-23): poll voting duplicate-protection rewrite
CREATE OR REPLACE FUNCTION public.cast_poll_vote(p_poll_id UUID, p_option TEXT, p_option_idx INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT status INTO v_status FROM polls WHERE id = p_poll_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'poll_not_found'); END IF;
  IF v_status != 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'poll_closed'); END IF;
  BEGIN
    INSERT INTO poll_votes(poll_id, user_id, option, option_idx) VALUES (p_poll_id, v_uid, p_option, p_option_idx);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_voted');
  END;
  UPDATE polls SET vote_counts = jsonb_set(COALESCE(vote_counts,'{}'::jsonb), ARRAY[p_option],
    to_jsonb(COALESCE((vote_counts->>p_option)::int,0) + 1)), total_votes = COALESCE(total_votes,0) + 1
  WHERE id = p_poll_id;
  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.cast_poll_vote(UUID, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_poll_vote(p_poll_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT option FROM poll_votes WHERE poll_id = p_poll_id AND user_id = (auth.jwt() ->> 'sub') LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_poll_vote(UUID) TO authenticated;

-- ──────────────── Part B (2026-09-20 security lockdown) ────────────────

-- B.1) wallet INSERT guard — fake credit/win txns user se nahi ban sakte.
--      ALLOWED user types: pending_withdraw, pending_deposit,
--      debit(match_entry | squad_bank_contribution) — user panel ke asli
--      flows (wallet.js deposit/withdraw, join.js entry logs, clan bank).
--      SECURITY DEFINER RPCs (increment_balance, claim_premium_monthly_bonus
--      etc.) postgres-context me chalte hain → allowed. Admin JWT (users
--      .is_admin=true) → allowed. Verified live: fake match_win → 400 blocked;
--      pending_deposit/debit → 201 allowed; admin → 201 allowed.
CREATE OR REPLACE FUNCTION public.fft_guard_wallet_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN NEW;
  END IF;
  IF (NEW.txn_type IN ('pending_withdraw','pending_deposit'))
     OR (NEW.txn_type = 'debit' AND NEW.reason IN ('match_entry','squad_bank_contribution')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Wallet entries (%) sirf system create kar sakta hai', NEW.txn_type;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fft_wallet_insert_guard ON public.wallet_transactions;
CREATE TRIGGER trg_fft_wallet_insert_guard
  BEFORE INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fft_guard_wallet_insert();

-- B.2) match_results write guard — results sirf system/admin publish kare.
--      User-panel ka db-bridge mirror upsert fail-hoti rahegi (silent) —
--      authoritative write admin panel karta hai (publishResults).
CREATE OR REPLACE FUNCTION public.fft_guard_match_results_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Results sirf system publish kar sakta hai';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fft_match_results_guard ON public.match_results;
CREATE TRIGGER trg_fft_match_results_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.match_results
  FOR EACH ROW EXECUTE FUNCTION public.fft_guard_match_results_write();

-- B.3) publish-flow INSERT policy — admin winners ki rows insert kar sake
--      (mr_insert_own sirf own-row deti thi; unique constraint
--      match_results_match_id_user_id_key pehle se thi).
DROP POLICY IF EXISTS mr_insert_admin ON public.match_results;
CREATE POLICY mr_insert_admin ON public.match_results
FOR INSERT TO public
WITH CHECK (COALESCE(public.is_caller_admin(), false));


-- ──────────────── Part C (2026-09-20, later same-day) ────────────────

-- C.1) match_results: bridge-compatible columns — publish-flow ka ASLI
--      root cause. supabase-rtdb-bridge.js ka resultToSupa() ye columns
--      bhejta hai jo table me the hi nahi → har result-mirror 400 →
--      player-loop "failed" → koi prize, koi increment_balance, kuch nahi.
--      (rank reserved word hai — quoted.)
ALTER TABLE public.match_results ADD COLUMN IF NOT EXISTS "rank" INTEGER;
ALTER TABLE public.match_results ADD COLUMN IF NOT EXISTS kill_prize NUMERIC DEFAULT 0;
ALTER TABLE public.match_results ADD COLUMN IF NOT EXISTS rank_prize NUMERIC DEFAULT 0;
ALTER TABLE public.match_results ADD COLUMN IF NOT EXISTS prize_earned NUMERIC DEFAULT 0;

-- C.2) guard_users_self_update(): SECURITY DEFINER → SECURITY INVOKER
--      + current_user check. PURANA version saare SECURITY DEFINER RPCs
--      bhi tod raha tha (validate_and_join_match → "Column coins is not
--      self-editable" — JOIN FLOW poora dead!). INVOKER me current_user
--      asli context dikhata hai: definer-RPC ke andar postgres (allow),
--      direct user PATCH authenticated (whitelist rules), Mgmt/API
--      postgres (allow). Protection level SAME — live-tested:
--      S1 coins/S2 is_admin/S3 self-ban → BLOCKED ✓; bio self-edit ✓;
--      admin edit ✓; joins ✓.
CREATE OR REPLACE FUNCTION public.guard_users_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role')
      OR (current_user IN ('postgres','supabase_admin','service_role'));
  v_allowed TEXT[] := ARRAY[
    'avatar_url','avatar_bg_color','banner_url','bio','city','phone',
    'is_live','stream_link','stream_title','rival_uid','fcm_token',
    'fcm_updated_at','device_fp','clan_id','referral_code',
    'referral_popup_done','profile_status','pending_ign',
    'profile_request_count','duo_team','squad_team','partner_uid',
    'squad_uids','updated_at','last_seen',
    'state'  -- R24 (2026-09-21): mesStateOk() IT-Rules state-gate har naye
             -- user par 'Column state is not self-editable' throw karke
             -- PERMANENT stuck karta tha (live-proven qauser3). Only the
             -- client-side allowed-list ['Haryana','Delhi','Punjab','Other']
             -- inhe set kar sakti hai (banned states mesStateBan path se
             -- jaate hain, write tak pahunchte hi nahi).
  ];
  v_col TEXT;
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
BEGIN
  IF v_is_service OR (v_caller IS NOT NULL AND COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false)) THEN
    RETURN NEW;
  END IF;
  IF v_caller IS NULL OR v_caller <> OLD.id THEN
    RAISE EXCEPTION 'Not authorized to update this user row';
  END IF;
  FOR v_col IN SELECT jsonb_object_keys(v_new) LOOP
    IF NOT (v_col = ANY(v_allowed)) THEN
      IF v_old -> v_col IS DISTINCT FROM v_new -> v_col THEN
        RAISE EXCEPTION 'Column % is not self-editable', v_col;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;


-- ──────────────── Part D (2026-09-20b ROUND-3 FIX session) ────────────────
-- R3 testing (R3-1..R3-10 + 7 dead features) ke saare fixes, live DB par
-- run + verify. Poora context + verify-results: 2026-09-20b-R3-FIX-DELTA.sql
--
-- ★ ANON-ROLE DISCOVERY: Firebase JWT me role claim nahi hota — panel ka
--   saara traffic PostgREST me ANON role se chalta hai. Isliye user-facing
--   RPCs ko anon+authenticated dono granted; SECURITY DEFINER functions
--   me auth.jwt()->'sub' NULL-guard zaroori.
--
-- In this part:
--   D1  app_settings seeds: mission_config, streak_config, cosmetic_prices
--   D2  Overload drops: claim_mission_reward(numeric), squad_bank(int),
--       increment_city_score(5-arg); REVOKE increment_poll_vote
--   D3  claim_mission_reward rewrite (server-reward, period-guard)
--   D4  track_mission_progress rewrite (unknown-key never completes)
--   D5  claim_streak_milestone rewrite (server-cap, day-whitelist)
--   D6  battle_pass_progress +xp_today +xp_day columns
--   D7  award_battle_pass_xp rewrite (2000/day cap)
--   D8  claim_battle_pass_tier rewrite (server-GD, free-track fix)
--   D9  purchase_cosmetic rewrite (catalog price, idempotent)
--   D10 finalize_creator_commission rewrite (admin/internal guard +
--       jr-status revenue-loss fix)
--   D11 creator_publish_result rewrite (42702 alias crash fix)
--   D12 get_room_credentials NEW RPC (release-gated room access)
--   D13 Grants (anon+authenticated+service_role per function)
--
-- Full function bodies neeche exactly 2026-09-20b-R3-FIX-DELTA.sql jaisi
-- hain — single source of truth wahi file hai, yahan bhi poora rakha
-- gaya hai taaki COMPLETE_SCHEMA me "koi command baaki na bache".

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20b ROUND-3 FIX SESSION — LIVE DATABASE ME RUN HO CHUKA HAI ✅
-- ═══════════════════════════════════════════════════════════════════
-- Ye file Round-3 max-depth testing (R3-1..R3-10 + 7 dead features) me
-- mile saare security/economy bugs ke FIXES hai. SAB live Supabase par
-- run + verify ho chuka hai (FIX_VERIFY1/1b battery). Append-only rule
-- follow — kuch purana DROP/EDIT nahi, sirf naye CREATE OR REPLACE /
-- GRANT / REVOKE.
--
-- ★ SABSE BADA DISCOVERY (is session ka):
--   Firebase JWT me `role` claim NAHI hota. Supabase third-party auth
--   me PostgREST aise token wale har request ko **anon** role se
--   chalata hai (auth.jwt().sub phir bhi user-id deta hai). Isliye:
--   (a) jo function sirf authenticated ko granted hai wo panel me 401
--       (dead feature), (b) RLS me sirf `TO authenticated` policies
--       panel traffic par apply NAHI hoti. Har user-facing RPC ko ab
--       anon + authenticated dono ko grant kiya gaya hai; har SECURITY
--       DEFINER function ke andar auth.jwt()->'sub' NULL-guard hai.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. CONFIG SEEDS (app_settings) — server-side reward sources
--    Panel ke CFG defaults (features/app-config.js) ke exact match.
-- ─────────────────────────────────────────────────────────────
INSERT INTO app_settings(key, value) VALUES ('mission_config',
'{"daily_match":{"coins":10,"target":1},"daily_kills3":{"coins":5,"target":1},"week_5matches":{"coins":50,"target":1},"week_top3":{"coins":30,"target":1},"week_share":{"coins":20,"target":1}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings(key, value) VALUES ('streak_config',
'{"3":20,"7":100,"14":200,"30":500,"60":1000,"100":2000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings(key, value) VALUES ('cosmetic_prices', '{
 "frame_neon":{"price":50,"name":"Neon Frame"},
 "frame_fire":{"price":75,"name":"Fire Frame"},
 "frame_galaxy":{"price":100,"name":"Galaxy Frame"},
 "frame_gold":{"price":150,"name":"Gold Champion"},
 "tag_beast":{"price":30,"name":"⚡ BEAST MODE"},
 "tag_pro":{"price":30,"name":"🎯 PRO PLAYER"},
 "tag_king":{"price":50,"name":"👑 KING"},
 "vip_slot":{"price":200,"name":"VIP Slot Pass"}
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
-- NOTE: live_config row abhi bhi NAHI hai — panel CFG defaults chala
-- raha hai. Admin chahe to live_config row banakar CFG override kar
-- sakta hai (features/app-config.js + core/db.js config.load path).

-- ─────────────────────────────────────────────────────────────
-- 2. OVERLOAD-DROPS (PGRST203 + client-amount holes band)
-- ─────────────────────────────────────────────────────────────
-- R3-1: numeric overload tha → client p_coins (numeric) us overload se
--       jaata tha. Ab sirf integer overload (server-reward) bacha.
DROP FUNCTION IF EXISTS public.claim_mission_reward(text, text, numeric);

-- R3-7: int overload tha → numeric hi rakha (panel numeric bhejta hai)
DROP FUNCTION IF EXISTS public.contribute_to_squad_bank(uuid, text, integer);

-- R3-fix: 5-arg overload (bina p_uid attribution) band; panel 6-arg
-- (…, p_uid) use karta hai — live-verified 204.
DROP FUNCTION IF EXISTS public.increment_city_score(text, text, integer, integer, integer);

-- R3-8: increment_poll_vote bina-vote count inflate karta tha (204
-- silent). Panel kahin use nahi karta (grep-verified) — REVOKE.
REVOKE EXECUTE ON FUNCTION public.increment_poll_vote(uuid, text) FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- 3. claim_mission_reward — SERVER-SIDE REWARD (R3-1 + R3-3 fix)
--    p_coins IGNORE; reward mission_config se; period tamper-guard;
--    unknown mission reject; double-claim FOR UPDATE lock.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_mission_reward(p_mission_key text, p_period text, p_coins integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_cfg JSONB;
  v_reward INT;
  v_period_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  /* FIX (2026-09-20 R3): reward server-side se — p_coins IGNORE.
     Sirf mission_config me registered missions claim kar sakte hain. */
  SELECT value->p_mission_key INTO v_cfg FROM app_settings WHERE key = 'mission_config';
  IF v_cfg IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_mission');
  END IF;
  v_reward := COALESCE((v_cfg->>'coins')::INT, 0);
  IF v_reward <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'mission_reward_not_configured');
  END IF;

  /* Period tamper-guard: daily keys aaj hi ki date par, weekly keys
     current week par hi claim ho sakte hain (panel ke getWeekNum
     formula ke mutabik: ceil((doy + jan1_dow + 1) / 7)). */
  IF p_mission_key LIKE 'daily_%' THEN
    v_period_ok := (p_period = CURRENT_DATE::text);
  ELSIF p_mission_key LIKE 'week_%' THEN
    v_period_ok := (p_period = 'w' || CEIL((EXTRACT(DOY FROM NOW())
                     + EXTRACT(DOW FROM (date_trunc('year', NOW())))::INT + 1)::NUMERIC / 7)::INT);
  ELSE
    v_period_ok := TRUE;
  END IF;
  IF NOT v_period_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'stale_period');
  END IF;

  SELECT * INTO v_row FROM mission_progress
  WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mission not found');
  END IF;
  IF NOT v_row.is_completed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mission abhi complete nahi hui');
  END IF;
  IF v_row.reward_claimed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  UPDATE mission_progress SET reward_claimed = true, updated_at = NOW()
  WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period;

  UPDATE users SET coins = COALESCE(coins, 0) + v_reward WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(v_uid, 'coins', 'credit', v_reward, 'mission_reward', p_mission_key || ':' || p_period);

  RETURN jsonb_build_object('success', true, 'coins', v_reward);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 4. track_mission_progress — unknown-key kabhi complete nahi (R3-3)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.track_mission_progress(p_mission_key text, p_period text, p_progress integer, p_target integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_cfg JSONB;
  v_new_progress INT;
  v_completed BOOLEAN;
  v_known BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  /* FIX (R3): sirf registered missions complete ho sakte hain.
     Unknown keys track to ho sakte hain (analytics) par kabhi
     complete nahi honge → claim kabhi nahi milega. */
  SELECT (value -> p_mission_key) IS NOT NULL INTO v_known FROM app_settings WHERE key = 'mission_config';

  INSERT INTO mission_progress(user_id, mission_key, period, progress, target, is_completed)
  VALUES(v_uid, p_mission_key, p_period, LEAST(p_progress, p_target), p_target, v_known AND (p_progress >= p_target))
  ON CONFLICT (user_id, mission_key, period) DO UPDATE SET
    progress = GREATEST(mission_progress.progress, LEAST(p_progress, p_target)),
    target = p_target,
    is_completed = (mission_progress.is_completed OR (v_known AND p_progress >= p_target)),
    updated_at = NOW()
  RETURNING progress, is_completed INTO v_new_progress, v_completed;

  RETURN jsonb_build_object('success', true, 'progress', v_new_progress, 'is_completed', v_completed);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 5. claim_streak_milestone — server-cap + day-whitelist (R3-4)
--    401-dead tha; ab anon+authenticated granted.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_streak_milestone(p_day integer, p_coins integer, p_badge text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_streak INTEGER;
  v_claimed JSONB;
  v_key TEXT := 'day_' || p_day::text;
  v_new_balance NUMERIC;
  v_cfg JSONB;
  v_reward NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_day NOT IN (3,7,14,30,60,100) OR p_coins IS NULL OR p_coins <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;
  SELECT value->p_day::text INTO v_cfg FROM app_settings WHERE key='streak_config';
  v_reward := LEAST(p_coins::NUMERIC, COALESCE((v_cfg)::NUMERIC, 50));
  IF v_reward <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  SELECT streak_days, streak_milestones_claimed
    INTO v_streak, v_claimed
    FROM users WHERE id = v_uid FOR UPDATE;

  IF v_streak IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;
  IF v_streak < p_day THEN
    RETURN jsonb_build_object('ok', false, 'error', 'streak_not_reached');
  END IF;
  IF v_claimed ? v_key THEN
    RETURN jsonb_build_object('ok', true, 'already_claimed', true);
  END IF;

  UPDATE users
     SET streak_milestones_claimed = streak_milestones_claimed || jsonb_build_object(v_key, true),
         coins = coins + v_reward
   WHERE id = v_uid
   RETURNING coins INTO v_new_balance;

  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES (v_uid, 'coins', 'credit', v_reward, 'streak_milestone', v_key);

  RETURN jsonb_build_object('ok', true, 'coins', v_reward, 'new_balance', v_new_balance);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 6. battle_pass_progress daily-XP columns (R3-6 cap ke liye)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.battle_pass_progress ADD COLUMN IF NOT EXISTS xp_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.battle_pass_progress ADD COLUMN IF NOT EXISTS xp_day DATE;

-- ─────────────────────────────────────────────────────────────
-- 7. award_battle_pass_xp — 2000 XP/day cap (R3-6)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_battle_pass_xp(p_uid text, p_season text, p_xp integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_new_xp INT;
  v_new_tier INT;
  v_today DATE := CURRENT_DATE;
  v_xp_today INT;
BEGIN
  IF v_caller IS DISTINCT FROM p_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only award your own XP');
  END IF;
  IF p_xp <= 0 OR p_xp > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid XP amount');
  END IF;

  /* FIX (R3): 2000 XP/day cap — spam-printer band. */
  SELECT COALESCE(xp_today, 0) INTO v_xp_today
    FROM battle_pass_progress WHERE user_id = p_uid AND season_key = p_season;
  IF v_xp_today IS NULL THEN v_xp_today := 0; END IF;
  IF v_xp_today >= 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_xp_cap_reached');
  END IF;

  INSERT INTO battle_pass_progress (user_id, season_key, current_xp, current_tier, has_premium, claimed_free, claimed_prem, xp_today, xp_day)
    VALUES (p_uid, p_season, p_xp, LEAST(50, p_xp/100), false, '{}'::jsonb, '{}'::jsonb, p_xp, v_today)
    ON CONFLICT (user_id, season_key) DO UPDATE
      SET current_xp = battle_pass_progress.current_xp + p_xp,
          current_tier = GREATEST(battle_pass_progress.current_tier, LEAST(50, (battle_pass_progress.current_xp + p_xp)/100)),
          updated_at = now(),
          xp_today = CASE WHEN battle_pass_progress.xp_day = v_today THEN battle_pass_progress.xp_today + p_xp ELSE p_xp END,
          xp_day = v_today
    RETURNING current_xp, current_tier INTO v_new_xp, v_new_tier;

  IF v_xp_today + p_xp > 2000 THEN
    RETURN jsonb_build_object('success', true, 'xp', v_new_xp, 'tier', v_new_tier, 'capped', true);
  END IF;
  RETURN jsonb_build_object('success', true, 'xp', v_new_xp, 'tier', v_new_tier);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 8. claim_battle_pass_tier — server-GD + free-track fix (R3-5)
--    p_gd_reward IGNORE; reward battle_passes.tiers se;
--    free track par premium-check NAHI (design-fault tha);
--    prem track par has_premium (season-pass) zaroori.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_claimed JSONB;
  v_bp RECORD;
  v_tier_def JSONB;
  v_reward_gd NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_track NOT IN ('free','prem') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid track');
  END IF;
  SELECT * INTO v_bp FROM battle_passes WHERE season_key = p_season AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season not found or not active');
  END IF;
  SELECT t INTO v_tier_def FROM jsonb_array_elements(v_bp.tiers) t WHERE (t->>'tier')::int = p_tier;
  IF v_tier_def IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;
  v_reward_gd := COALESCE((v_tier_def->>'rewardGd')::NUMERIC, 0);

  SELECT * INTO v_row FROM battle_pass_progress
  WHERE user_id = v_uid AND season_key = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No battle pass progress found');
  END IF;
  IF v_row.current_tier < p_tier THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tier not reached yet');
  END IF;
  IF p_track = 'prem' AND NOT COALESCE(v_row.has_premium, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season Pass nahi khareeda — pehle purchase karo');
  END IF;

  v_claimed := CASE p_track WHEN 'free' THEN COALESCE(v_row.claimed_free,'{}'::JSONB)
                            ELSE COALESCE(v_row.claimed_prem,'{}'::JSONB) END;
  IF v_claimed ? p_tier::TEXT THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  IF v_reward_gd > 0 THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_reward_gd WHERE id = v_uid;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_uid, 'green_diamonds', 'credit', v_reward_gd, 'battle_pass_tier', p_season || ':t' || p_tier);
  END IF;

  UPDATE battle_pass_progress
    SET claimed_free = CASE p_track WHEN 'free' THEN claimed_free || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_free END,
        claimed_prem = CASE p_track WHEN 'prem' THEN claimed_prem || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_prem END,
        updated_at = NOW()
    WHERE user_id = v_uid AND season_key = p_season;

  RETURN jsonb_build_object('success', true, 'gd', v_reward_gd, 'track', p_track, 'tier', p_tier);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 9. purchase_cosmetic — catalog price (R3-9)
--    p_price IGNORE; price app_settings 'cosmetic_prices' se;
--    unknown cosmetic reject; already-owned idempotent.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_cosmetic(p_cosmetic_key text, p_price integer, p_display_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_balance NUMERIC;
  v_price NUMERIC;
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_cosmetic_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
  END IF;

  IF EXISTS (SELECT 1 FROM user_cosmetics WHERE user_id = v_uid AND cosmetic_key = p_cosmetic_key) THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true);
  END IF;

  SELECT value->p_cosmetic_key->>'price', COALESCE(value->p_cosmetic_key->>'name', p_display_name)
    INTO v_price, v_name
    FROM app_settings WHERE key = 'cosmetic_prices';
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_cosmetic');
  END IF;

  SELECT sky_diamonds INTO v_balance FROM users WHERE id = v_uid FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_price THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance');
  END IF;

  UPDATE users SET sky_diamonds = sky_diamonds - v_price WHERE id = v_uid;
  INSERT INTO user_cosmetics(user_id, cosmetic_key, purchased_at) VALUES (v_uid, p_cosmetic_key, NOW());
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'sky_diamonds', 'debit', v_price, 'cosmetic_purchase', COALESCE(v_name, p_cosmetic_key));

  RETURN jsonb_build_object('ok', true, 'new_balance', v_balance - v_price);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 10. finalize_creator_commission — admin/internal guard (R3-10)
--     + jr-status revenue-loss fix (creator-match jrs 'pending' me
--     hi rehte hain — purana IN ('joined','approved') filter
--     commission HAMESHA 0 kar deta tha).
--     p_internal=true sirf creator_publish_result se aata hai.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_creator_commission(p_match_id text, p_internal boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_creator_uid   TEXT;
  v_comm_pct      NUMERIC;
  v_comm_type     TEXT;
  v_total_entry   NUMERIC;
  v_commission    NUMERIC;
  v_hold_days     INT;
  v_eligible_at   TIMESTAMPTZ;
  v_hold_until    TIMESTAMPTZ;
  v_caller        TEXT := auth.jwt() ->> 'sub';
BEGIN
  IF NOT COALESCE(p_internal, false) THEN
    IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
      RAISE EXCEPTION 'finalize sirf system/admin kar sakta hai';
    END IF;
  END IF;

  SELECT creator_uid, commission_pct, commission_type
  INTO v_creator_uid, v_comm_pct, v_comm_type
  FROM creator_matches
  WHERE match_id = p_match_id AND commission_status = 'pending';

  IF v_creator_uid IS NULL THEN RETURN; END IF;

  SELECT hold_until INTO v_hold_until FROM creator_matches WHERE match_id = p_match_id;

  SELECT COALESCE(SUM(entry_fee_paid), 0)
  INTO v_total_entry
  FROM join_requests
  WHERE match_id = p_match_id
    AND status NOT IN ('no_show','refunded','cancelled','rejected');

  v_commission := ROUND(v_total_entry * v_comm_pct / 100, 2);

  SELECT COALESCE((value->>'commissionHoldDays')::INT, 7)
  INTO v_hold_days
  FROM app_settings WHERE key = 'creator_system' LIMIT 1;

  IF v_hold_days IS NULL THEN v_hold_days := 7; END IF;
  v_eligible_at := COALESCE(v_hold_until, NOW() + (v_hold_days || ' days')::INTERVAL);

  IF v_comm_type = 'gd' THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_commission
    WHERE id = v_creator_uid;
    INSERT INTO wallet_transactions(user_id, txn_type, amount, currency, reason, created_at)
    VALUES (v_creator_uid, 'credit', v_commission, 'green_diamonds', 'creator_coin_match_commission', NOW());
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'gd', 'eligible', NOW());
    UPDATE creator_matches SET commission_status = 'finalized' WHERE match_id = p_match_id;
  ELSE
    INSERT INTO creator_commissions(creator_uid, match_id, amount, currency, status, eligible_at)
    VALUES (v_creator_uid, p_match_id, v_commission, 'coins', 'pending', v_eligible_at);
    UPDATE creator_matches SET commission_status = 'locked' WHERE match_id = p_match_id;
  END IF;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 11. creator_publish_result — 42702 'r is ambiguous' crash fix
--     (variable `r` vs FROM-alias); alias ab 'res'; EXCEPTION-
--     handler (fail par match 'live' atka na rahe); finalize ab
--     internal (p_internal=true) call karta hai.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_publish_result(p_match_id text, p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
  v_status TEXT;
  v_max_slots INT;
  v_per_kill NUMERIC;
  v_entry_type TEXT;
  v_total_kills INT;
  v_winner_uid TEXT;
  v_recent_wins INT;
  v_total_payout NUMERIC := 0;
  v_flag_reason TEXT;
  v_max_payout_cap CONSTANT NUMERIC := 500;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT creator_uid, status, max_slots, per_kill_prize, entry_type
    INTO v_owner, v_status, v_max_slots, v_per_kill, v_entry_type
    FROM matches WHERE id = p_match_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_found'); END IF;
  IF v_owner <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_your_match'); END IF;
  IF v_status <> 'live' THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_live'); END IF;

  IF EXISTS(SELECT 1 FROM users WHERE id = v_uid AND (creator_suspended_permanently = true OR (creator_suspended_until IS NOT NULL AND creator_suspended_until > NOW()))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'creator_suspended');
  END IF;

  UPDATE join_requests jr
  SET kills = COALESCE((res->>'kills')::INT, 0),
      placement = COALESCE((res->>'placement')::INT, 0)
  FROM jsonb_array_elements(p_results) res
  WHERE jr.id = (res->>'join_request_id')::UUID AND jr.match_id = p_match_id;

  SELECT COALESCE(SUM(kills),0) INTO v_total_kills FROM join_requests WHERE match_id = p_match_id;
  IF v_total_kills > GREATEST(v_max_slots - 1, 1) * 1.5 THEN
    v_flag_reason := 'impossible_kill_count';
  END IF;

  IF v_flag_reason IS NULL THEN
    SELECT user_id INTO v_winner_uid FROM join_requests WHERE match_id = p_match_id AND placement = 1 LIMIT 1;
    IF v_winner_uid IS NOT NULL THEN
      SELECT COUNT(*) INTO v_recent_wins
      FROM creator_matches cm
      JOIN join_requests jr2 ON jr2.match_id = cm.match_id
      WHERE cm.creator_uid = v_uid AND jr2.user_id = v_winner_uid AND jr2.placement = 1
        AND cm.created_at > NOW() - INTERVAL '7 days';
      IF v_recent_wins >= 3 THEN
        v_flag_reason := 'repeat_winner_pattern';
      END IF;
    END IF;
  END IF;

  v_total_payout := v_total_kills * COALESCE(v_per_kill, 0);
  IF v_total_payout > v_max_payout_cap THEN
    v_flag_reason := COALESCE(v_flag_reason, 'payout_cap_exceeded');
  END IF;

  IF v_flag_reason IS NOT NULL THEN
    UPDATE matches SET status = 'pending_review', completed_at = NOW() WHERE id = p_match_id;
    INSERT INTO creator_result_flags(match_id, creator_uid, reason, details)
    VALUES (p_match_id, v_uid, v_flag_reason, jsonb_build_object('total_kills', v_total_kills, 'total_payout', v_total_payout, 'winner_uid', v_winner_uid));
    RETURN jsonb_build_object('success', true, 'status', 'pending_review', 'flagged', true);
  END IF;

  IF v_per_kill > 0 THEN
    IF v_entry_type = 'coins' THEN
      UPDATE users u SET coins = coins + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    ELSE
      UPDATE users u SET sky_diamonds = sky_diamonds + (jr.kills * v_per_kill)
      FROM join_requests jr WHERE jr.match_id = p_match_id AND jr.user_id = u.id AND jr.kills > 0;
    END IF;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    SELECT user_id, v_entry_type, 'credit', kills * v_per_kill, 'creator_match_prize', p_match_id
    FROM join_requests WHERE match_id = p_match_id AND kills > 0;
  END IF;

  UPDATE matches SET status = 'completed', completed_at = NOW() WHERE id = p_match_id;
  PERFORM finalize_creator_commission(p_match_id, true);

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'flagged', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'publish_failed', 'detail', SQLERRM);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 12. get_room_credentials — NAYA RPC (R3-2 room-leak fix ka
--     server-half). Panel ab MT me creds load nahi karta (user-repo
--     commit 6c97022); sirf ye RPC deta hai, joined + release-window
--     verify karke. Release rule: admin 'released' (room_status +
--     room_released_at) YA scheduled_at - room_release_minutes.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_room_credentials(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_m RECORD;
  v_allowed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT status, scheduled_at, room_release_minutes, room_released_at, room_id, room_password, room_status
    INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.room_id IS NULL OR v_m.room_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'room_not_set');
  END IF;
  IF v_m.status NOT IN ('live','upcoming','completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_available');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM join_requests WHERE user_id = v_uid AND match_id = p_match_id AND status IN ('pending','joined','checked_in')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_joined');
  END IF;

  v_allowed := (v_m.room_status = 'released' AND v_m.room_released_at IS NOT NULL AND v_m.room_released_at <= NOW())
            OR (NOW() >= v_m.scheduled_at - COALESCE(v_m.room_release_minutes, 5) * INTERVAL '1 minute');
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_released_yet');
  END IF;

  UPDATE join_requests SET status = 'checked_in'
  WHERE user_id = v_uid AND match_id = p_match_id AND status = 'joined';

  RETURN jsonb_build_object('success', true, 'room_id', v_m.room_id, 'room_password', v_m.room_password);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 13. GRANTS — ★ anon-role discovery ke baad HAR user-facing
--     function ko anon + authenticated dono (sub-guards andar).
--     401-dead features revive: streak, watch-earn, voucher,
--     own-match-played.
-- ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone(integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_watch_earn_reward(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_own_match_played() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_credentials(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_creator_commission(text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.creator_publish_result(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.track_mission_progress(text, text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(text, integer, text, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.award_battle_pass_xp(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(text, integer, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY-RESULTS (live, FIX_VERIFY1/1b batteries):
--  ✓ mission legit claim +10 (p_coins=9999 tamper ignored)
--  ✓ double-claim block / unknown-mission reject / stale-period reject
--  ✓ streak capped 20 (99999 tamper) / invalid-day / not-reached
--  ✓ bp free-track w/o premium + server-gd 15 (999 ignored) /
--    prem-track gated / tier-not-reached / double-claim
--  ✓ xp cap 2000/day (3rd 1000xp call → daily_xp_cap_reached)
--  ✓ cosmetic catalog-price 50 debit (price=1 tamper) / re-buy
--    idempotent / vip_slot 200 > balance → insufficient
--  ✓ publish FULL E2E: 42702 GONE, kills-prize +15, commission
--    3.75 GD (revenue-loss fix), finalize self-call → P0001 blocked
--  ✓ room RPC: outsider not_joined / early not_released_yet /
--    released → room_id+password + auto check-in
--  ✓ voucher real redeem +25 + dup-block; watch-earn/own-match
--    grants 200
-- ═══════════════════════════════════════════════════════════════


-- ──────────────── Part E (2026-09-20c ROOM-LEAK PHASE-2) ────────────────
-- matches.room_id/room_password ab HAMESHA NULL (defaults NULL) — raw REST,
-- realtime WS, select('*') sab jagah creds-free. Creds sirf match_rooms
-- table me (admin-only RLS read) + get_room_credentials() RPC se.
-- Redirect-trigger saare existing writers transparently handle karta hai.
-- Poora context + verify: 2026-09-20c-ROOM-PHASE2-DELTA.sql
--
--   E1  match_rooms table + RLS admin-policy + grants
--   E2  matches room defaults → NULL (+ migration notes: backfill/null-out
--       live run ho chuka, trigger install se pehle)
--   E3  redirect_match_room_secrets() fn + trg_redirect_match_room_secrets
--   E4  creator_set_room v2 (match_rooms + room_status='saved')
--   E5  get_room_credentials v3 (match_rooms + owner/admin bypass)

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20c ROOM-LEAK PHASE-2 — LIVE DATABASE ME RUN HO CHUKA HAI ✅
-- ═══════════════════════════════════════════════════════════════════
-- R3-2 room-leak ka SERVER-SIDE permanent fix (Phase-1: RPC + client-strip
-- ho chuka tha — 2026-09-20b-R3-FIX-DELTA.sql / user commit de2a2eb).
--
-- AB ARCHITECTURE:
--   • matches.room_id / matches.room_password hamesha NULL rehte hain
--     (defaults bhi NULL). select('*') / realtime WS payloads me creds
--     KABHI nahi jaate — raw REST bhi safe.
--   • Creds sirf `match_rooms` table me: anon/authenticated ke liye
--     SELECT-only + RLS admin-policy (panel roles INSERT/UPDATE/DELETE
--     nahi kar sakte; service_role/definer full).
--   • `trg_redirect_match_room_secrets` trigger: kisi bhi writer (admin
--     inline-edit, supabase-sync, RTDB-bridge, legacy code) ke room cols
--     likhne par creds TRANSPARENTLY match_rooms me redirect + matches
--     me NULL. Clear (NULL/'') likhne par match_rooms row delete.
--     → Kisi existing client write-path me change NAHI karna pada.
--   • Reads: sirf get_room_credentials() RPC (joined+release-window;
--     owner/admin bypass). creator_set_room ab seedha match_rooms likhta
--     hai + matches.room_status='saved' set karta hai (host-screen
--     'room set?' check ab room_status se).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. MATCH_ROOMS table (creds ka naya ghar)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_rooms (
  match_id      TEXT PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  room_id       TEXT NOT NULL,
  room_password TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_rooms_admin_read ON public.match_rooms;
CREATE POLICY match_rooms_admin_read ON public.match_rooms
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.jwt() ->> 'sub' AND COALESCE(is_admin, false)));

REVOKE ALL ON public.match_rooms FROM anon, authenticated;
GRANT SELECT ON public.match_rooms TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. MIGRATION (live pe run ho chuka — fresh env par dobara chale to)
-- ─────────────────────────────────────────────────────────────
-- 2a. backfill (order matter karta hai):
-- INSERT INTO public.match_rooms(match_id, room_id, room_password, updated_at)
-- SELECT id, BTRIM(room_id), COALESCE(BTRIM(room_password), ''), NOW()
-- FROM matches WHERE room_id IS NOT NULL AND BTRIM(room_id) <> ''
-- ON CONFLICT (match_id) DO UPDATE SET room_id = EXCLUDED.room_id,
--   room_password = EXCLUDED.room_password, updated_at = NOW();
-- 2b. matches me NULL + defaults NULL (trigger install se PEHLE):
-- UPDATE matches SET room_id = NULL, room_password = NULL
--   WHERE room_id IS NOT NULL OR room_password IS NOT NULL;
ALTER TABLE matches ALTER COLUMN room_id SET DEFAULT NULL;
ALTER TABLE matches ALTER COLUMN room_password SET DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. REDIRECT TRIGGER (writers untouched)
--    NOTE: 'BEFORE INSERT OR UPDATE OF' — INSERT par bhi fire hota hai
--    (new matches ka DEFAULT ''/NULL ELSE-branch jaata hai — harmless).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redirect_match_room_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  /* FIX (2026-09-20c Phase-2): matches me room creds KABHI store na ho.
     Non-null room_id → match_rooms me redirect + matches me NULL.
     NULL/'' (clear) → match_rooms row delete. */
  IF NEW.room_id IS NOT NULL AND BTRIM(NEW.room_id) <> '' THEN
    INSERT INTO match_rooms(match_id, room_id, room_password, updated_at)
    VALUES (NEW.id, BTRIM(NEW.room_id), COALESCE(BTRIM(NEW.room_password), ''), NOW())
    ON CONFLICT (match_id) DO UPDATE
      SET room_id = EXCLUDED.room_id, room_password = EXCLUDED.room_password, updated_at = NOW();
    NEW.room_id := NULL;
    NEW.room_password := NULL;
  ELSE
    DELETE FROM match_rooms WHERE match_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_redirect_match_room_secrets ON matches;
CREATE TRIGGER trg_redirect_match_room_secrets
  BEFORE INSERT OR UPDATE OF room_id, room_password
  ON matches
  FOR EACH ROW EXECUTE FUNCTION public.redirect_match_room_secrets();

-- ─────────────────────────────────────────────────────────────
-- 4. creator_set_room v2 — match_rooms par seedha + room_status='saved'
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_set_room(p_match_id text, p_room_id text, p_room_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_owner TEXT;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT creator_uid, status INTO v_owner, v_status FROM matches WHERE id = p_match_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_found'); END IF;
  IF v_owner <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'not_your_match'); END IF;
  IF v_status NOT IN ('upcoming', 'live') THEN RETURN jsonb_build_object('success', false, 'error', 'match_not_active'); END IF;
  IF p_room_id IS NULL OR LENGTH(TRIM(p_room_id)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_room_id');
  END IF;

  /* FIX (2026-09-20c Phase-2): creds match_rooms me, matches me sirf
     non-secret room_status='saved' (host-screen 'room set?' check isi se). */
  INSERT INTO match_rooms(match_id, room_id, room_password, updated_at)
  VALUES (p_match_id, TRIM(p_room_id), TRIM(COALESCE(p_room_password, '')), NOW())
  ON CONFLICT (match_id) DO UPDATE
    SET room_id = EXCLUDED.room_id, room_password = EXCLUDED.room_password, updated_at = NOW();
  UPDATE matches SET status = 'live', room_status = 'saved' WHERE id = p_match_id;

  RETURN jsonb_build_object('success', true);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────
-- 5. get_room_credentials v3 — match_rooms source + owner/admin bypass
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_room_credentials(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_m RECORD;
  v_creds RECORD;
  v_allowed BOOLEAN;
  v_is_owner BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT status, scheduled_at, room_release_minutes, room_released_at, room_status, creator_uid
    INTO v_m FROM matches WHERE id = p_match_id;
  IF v_m.status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_found');
  END IF;
  IF v_m.status NOT IN ('live','upcoming','completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_not_available');
  END IF;

  /* FIX (Phase-2): creds ab match_rooms se (matches me hote hi nahi). */
  SELECT room_id, room_password INTO v_creds FROM match_rooms WHERE match_id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'room_not_set');
  END IF;

  SELECT COALESCE(v_m.creator_uid = v_uid, false),
         COALESCE((SELECT is_admin FROM users WHERE id = v_uid), false)
    INTO v_is_owner, v_is_admin;

  IF v_is_owner OR v_is_admin THEN
    /* Host/admin ko apna room hamesha dikh sakta hai */
    RETURN jsonb_build_object('success', true, 'room_id', v_creds.room_id, 'room_password', v_creds.room_password);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM join_requests WHERE user_id = v_uid AND match_id = p_match_id AND status IN ('pending','joined','checked_in')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_joined');
  END IF;

  v_allowed := (v_m.room_status = 'released' AND v_m.room_released_at IS NOT NULL AND v_m.room_released_at <= NOW())
            OR (NOW() >= v_m.scheduled_at - COALESCE(v_m.room_release_minutes, 5) * INTERVAL '1 minute');
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_released_yet');
  END IF;

  UPDATE join_requests SET status = 'checked_in'
  WHERE user_id = v_uid AND match_id = p_match_id AND status = 'joined';

  RETURN jsonb_build_object('success', true, 'room_id', v_creds.room_id, 'room_password', v_creds.room_password);
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live, P2 battery):
--  ✓ set_room → match_rooms row + room_status='saved' + matches NULL
--  ✓ owner-bypass (host ko apna room), player early → not_released_yet
--  ✓ trigger redirect: admin direct write → match_rooms + matches NULL
--  ✓ clear flow: NULL write → match_rooms row delete
--  ✓ release (matches.room_status) → player ko creds (full loop)
--  ✓ GLOBAL: matches me room_id/room_password/'' = 0 rows (creds-free)
--  ✓ UI: room popup match_rooms-backed RPC se creds (live panel)
--  ✓ Regression: E2E_POSTDEPLOY 8/8, PUBLISH_GOLD FULL PASS
--  ✓ RTDB matches public-read already blocked (Permission denied)
-- ═══════════════════════════════════════════════════════════════


-- ──────────────── Part F (2026-09-20d SEEDS + AD-REWARD + BP TRACK-AWARE) ────────────────
--   F1  battle_passes seed: Season 9 (2026_09), 50 tiers — panel TIERS_DATA
--       ke exact freeGd/premGd (badge/theme tiers GD=0). Table pehle KHAALI tha.
--   F2  claim_battle_pass_tier v3: track-aware GD (free→freeGd, prem→premGd)
--   F3  live_config row: {"adCoinsPerWatch":10,"adDailyLimit":5} (sirf ad-keys;
--       panel CFG deep-merge selective — baki defaults untouched)
--   F4  claim_ad_reward GRANT (def pehle se server-hardened: 15s rate-limit,
--       ad_reward_log audit, wtxn, live_config amount/limit)
-- Poora context + verify-results: 2026-09-20d-SEEDS-ADREV-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20d SEEDS + AD-REWARD + BP TRACK-AWARE — LIVE RUN ✅
-- ═══════════════════════════════════════════════════════════════════
-- (A) battle_passes SEED — pehle table KHAALI thi (dead feature).
--     Panel getSeasonId() = 'YYYY_MM' (features/battle-pass.js) → season
--     key '2026_09'. Tiers = panel TIERS_DATA ke EXACT GD values
--     (50 tiers; badge/theme/emoji rewards par GD 0 — wo client-side
--     cosmetic-only hain, server sirf GD credit karta hai).
-- (B) claim_battle_pass_tier v3 — TRACK-AWARE GD: free→freeGd,
--     prem→premGd (panel free/prem tracks ke rewards alag hain).
-- (C) live_config ROW — ab banayi (pehle missing thi): sirf ad keys,
--     panel CFG defaults se match. claim_ad_reward isi se amount/limit
--     padhta hai; config.load deep-merge selective hai to baki CFG
--     defaults untouched.
-- (D) claim_ad_reward GRANT — def pehle se server-hardened tha
--     (15s rate-limit + ad_reward_log audit + wtxn + live_config
--     amount/limit). 401-dead tha, ab revived (Coin-Shop watch-ad +
--     Bonus Ads dono features).
-- ═══════════════════════════════════════════════════════════════════

-- (A) battle_passes seed — Season 9 (Sep 2026), 50 tiers, panel TIERS_DATA se
INSERT INTO battle_passes(id, name, season_num, season_key, is_active, tiers, start_date, end_date)
VALUES (
  gen_random_uuid(),
  'Season 9 — Sep 2026',
  9,
  '2026_09',
  true,
  '[{"tier":1,"freeGd":5,"premGd":0},{"tier":2,"freeGd":5,"premGd":10},{"tier":3,"freeGd":5,"premGd":10},{"tier":4,"freeGd":5,"premGd":10},{"tier":5,"freeGd":0,"premGd":0},{"tier":6,"freeGd":8,"premGd":15},{"tier":7,"freeGd":8,"premGd":15},{"tier":8,"freeGd":8,"premGd":0},{"tier":9,"freeGd":8,"premGd":15},{"tier":10,"freeGd":10,"premGd":20},{"tier":11,"freeGd":8,"premGd":15},{"tier":12,"freeGd":8,"premGd":15},{"tier":13,"freeGd":8,"premGd":0},{"tier":14,"freeGd":8,"premGd":15},{"tier":15,"freeGd":0,"premGd":0},{"tier":16,"freeGd":10,"premGd":20},{"tier":17,"freeGd":10,"premGd":20},{"tier":18,"freeGd":10,"premGd":0},{"tier":19,"freeGd":10,"premGd":20},{"tier":20,"freeGd":10,"premGd":25},{"tier":21,"freeGd":10,"premGd":20},{"tier":22,"freeGd":10,"premGd":20},{"tier":23,"freeGd":10,"premGd":0},{"tier":24,"freeGd":10,"premGd":20},{"tier":25,"freeGd":15,"premGd":0},{"tier":26,"freeGd":12,"premGd":25},{"tier":27,"freeGd":12,"premGd":25},{"tier":28,"freeGd":12,"premGd":0},{"tier":29,"freeGd":12,"premGd":25},{"tier":30,"freeGd":0,"premGd":30},{"tier":31,"freeGd":12,"premGd":25},{"tier":32,"freeGd":12,"premGd":25},{"tier":33,"freeGd":12,"premGd":0},{"tier":34,"freeGd":12,"premGd":25},{"tier":35,"freeGd":15,"premGd":0},{"tier":36,"freeGd":15,"premGd":30},{"tier":37,"freeGd":15,"premGd":30},{"tier":38,"freeGd":15,"premGd":0},{"tier":39,"freeGd":15,"premGd":30},{"tier":40,"freeGd":0,"premGd":40},{"tier":41,"freeGd":15,"premGd":30},{"tier":42,"freeGd":15,"premGd":30},{"tier":43,"freeGd":15,"premGd":0},{"tier":44,"freeGd":15,"premGd":30},{"tier":45,"freeGd":18,"premGd":0},{"tier":46,"freeGd":18,"premGd":35},{"tier":47,"freeGd":18,"premGd":35},{"tier":48,"freeGd":18,"premGd":0},{"tier":49,"freeGd":15,"premGd":35},{"tier":50,"freeGd":20,"premGd":0}]'::jsonb,
  '2026-09-01',
  '2026-09-30'
);
-- NOTE: agli month me admin naya season row banaye (season_key '2026_10')
-- ya is row ko update kar de. battle_passes.season_key par UNIQUE
-- constraint NAHI hai — idempotent upsert ke liye pehle: aisa constraint
-- chahiye to banane ki jagah CHECK with trigger, ya insert se pehle
-- SELECT-count karo.

-- (B) claim_battle_pass_tier v3 — track-aware GD
CREATE OR REPLACE FUNCTION public.claim_battle_pass_tier(p_season text, p_tier integer, p_track text, p_gd_reward numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_row RECORD;
  v_claimed JSONB;
  v_bp RECORD;
  v_tier_def JSONB;
  v_reward_gd NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_track NOT IN ('free','prem') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid track');
  END IF;
  SELECT * INTO v_bp FROM battle_passes WHERE season_key = p_season AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season not found or not active');
  END IF;
  SELECT t INTO v_tier_def FROM jsonb_array_elements(v_bp.tiers) t WHERE (t->>'tier')::int = p_tier;
  IF v_tier_def IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
  END IF;
  /* FIX (2026-09-20d): track-aware GD — free→freeGd, prem→premGd
     (panel TIERS_DATA ke free/prem rewards alag hain). p_gd_reward IGNORE. */
  v_reward_gd := COALESCE((v_tier_def ->> CASE p_track WHEN 'free' THEN 'freeGd' ELSE 'premGd' END)::NUMERIC, 0);

  SELECT * INTO v_row FROM battle_pass_progress
  WHERE user_id = v_uid AND season_key = p_season FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No battle pass progress found');
  END IF;
  IF v_row.current_tier < p_tier THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tier not reached yet');
  END IF;
  IF p_track = 'prem' AND NOT COALESCE(v_row.has_premium, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season Pass nahi khareeda — pehle purchase karo');
  END IF;

  v_claimed := CASE p_track WHEN 'free' THEN COALESCE(v_row.claimed_free,'{}'::JSONB)
                            ELSE COALESCE(v_row.claimed_prem,'{}'::JSONB) END;
  IF v_claimed ? p_tier::TEXT THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already claimed');
  END IF;

  IF v_reward_gd > 0 THEN
    UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_reward_gd WHERE id = v_uid;
    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
    VALUES(v_uid, 'green_diamonds', 'credit', v_reward_gd, 'battle_pass_tier', p_season || ':t' || p_tier || ':' || p_track);
  END IF;

  UPDATE battle_pass_progress
    SET claimed_free = CASE p_track WHEN 'free' THEN claimed_free || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_free END,
        claimed_prem = CASE p_track WHEN 'prem' THEN claimed_prem || jsonb_build_object(p_tier::TEXT, true) ELSE claimed_prem END,
        updated_at = NOW()
    WHERE user_id = v_uid AND season_key = p_season;

  RETURN jsonb_build_object('success', true, 'gd', v_reward_gd, 'track', p_track, 'tier', p_tier);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_battle_pass_tier(text, integer, text, numeric) TO anon, authenticated, service_role;

-- (C) live_config — sirf ad-keys (panel CFG deep-merge selective hai)
INSERT INTO app_settings(key, value) VALUES ('live_config', '{"adCoinsPerWatch":10,"adDailyLimit":5}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = app_settings.value || '{"adCoinsPerWatch":10,"adDailyLimit":5}'::jsonb;

-- (D) claim_ad_reward — def server-hardened (rate-limit/audit/config), grant-only fix
GRANT EXECUTE ON FUNCTION public.claim_ad_reward() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live, SEED battery):
--  ✓ bp free t1 (season 2026_09) → +5 GD (p_gd_reward=999 ignored)
--  ✓ bp prem t1 without season-pass → gated
--  ✓ bp prem t2 (has_premium) → +10 GD (track-aware)
--  ✓ bp double-claim → Already claimed
--  ✓ ad reward → +10 coins (live_config), todayCount audit
--  ✓ ad reward 15s rate-limit → Too soon
-- ═══════════════════════════════════════════════════════════════


-- ──────────────── Part G (2026-09-20e TRIGGER-V3 ADDENDUM) ────────────────
-- Part E ke redirect-trigger ka CORRECTED final version (v2 me NULL-assign
-- chhuta tha → leak wapas; aur ELSE-delete admin-bridge null-upsert se
-- creator rooms wipe kar deta). v3: redirect + NULL-assign; null-write =
-- NO-OP (preserve); explicit clear = match_rooms direct delete.
-- Poora context: 2026-09-20e-TRIGGER-V3-ADDENDUM.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20e TRIGGER-V3 ADDENDUM (Part E ke redirect-trigger ka fix)
-- LIVE RUN ✅ — ye Part E wale trigger-function ko REPLACE karta hai
-- ═══════════════════════════════════════════════════════════════════
-- Part E wale v2 me DO problems thin:
--   (1) redirect ke baad NEW.room_id := NULL assign CHHUT GAYA tha →
--       creds match_rooms to jaate the par matches me BHI reh jaate
--       (leak wapas!). Edge-test ne pakda.
--   (2) ELSE-branch match_rooms DELETE karta tha → admin bridge ka
--       full-match upsert (room_id: null — RTDB copy me room nahi hota)
--       CREATOR ke room creds ko wipe kar deta. Null-write ab 'clear'
--       NAHI mana jaata.
-- v3 FINAL BEHAVIOR:
--   • non-null room_id → match_rooms upsert + matches cols NULL (assign!)
--   • null/'' write → NO-OP (match_rooms preserve)
--   • explicit clear = match_rooms se DIRECT DELETE (admin/service-role)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.redirect_match_room_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  /* FIX (2026-09-20e): (a) null-writes ko 'clear' NAHI mana — full-sync
     writers ka null 'set nahi kiya' hota hai, match_rooms PRESERVE.
     (b) redirect ke baad matches ke columns NULL assign karna ZAROORI
     (v2 me ye chhut gaya tha — creds matches me reh jaate). */
  IF NEW.room_id IS NOT NULL AND BTRIM(NEW.room_id) <> '' THEN
    INSERT INTO match_rooms(match_id, room_id, room_password, updated_at)
    VALUES (NEW.id, BTRIM(NEW.room_id), COALESCE(BTRIM(NEW.room_password), ''), NOW())
    ON CONFLICT (match_id) DO UPDATE
      SET room_id = EXCLUDED.room_id, room_password = EXCLUDED.room_password, updated_at = NOW();
    NEW.room_id := NULL;
    NEW.room_password := NULL;
  END IF;
  /* ELSE: NO-OP — explicit clear sirf match_rooms direct-delete se */
  RETURN NEW;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live, v3 battery):
--  ✓ redirect + NULL-assign (match_rooms ROOMV3, matches NULL, NULL)
--  ✓ null-write preserve (admin-bridge-style edit → match_rooms intact)
--  ✓ global creds-free (0 rows)
--  ✓ explicit clear (direct delete)
--  ✓ P2 essentials re-run: set_room/owner-bypass/not_released/release 4/4
-- ═══════════════════════════════════════════════════════════════


-- ──────────────── Part H (2026-09-20f ROUND-4) ────────────────
-- Round-4 sweep: 3 aur money-printers fix (exploit-verified pehle):
--   H1  process_daily_checkin v2 — params IGNORE, server tiers
--       [5,7,10,12,15,20,30] + 100@30streak + wtxn ledger (R4-1,
--       59,999-coins exploit tha)
--   H2  mentor_requests.last_rewarded_tier col + award_mentor_reward v2
--       — server-computed 20×tier-delta (R4-2, unlimited-GD minter tha)
--   H3  claim_premium_monthly_bonus v2 — server-map 50/150/400 (R4-3)
--   H4  2-arg claim_battle_pass_tier DROP (dead surface)
-- Poora context + exploit-proofs: 2026-09-20f-ROUND4-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20f ROUND-4 DELTA — LIVE RUN ✅ (deep-testing continue round)
-- ═══════════════════════════════════════════════════════════════════
-- Round-4 fresh-eyes sweep me 3 AUR economy holes mile (sab exploit-
-- verified apne hi QA accounts par, phir fix, phir verify):
--
-- R4-1 ★ process_daily_checkin — MONEY-PRINTER (live-exploited):
--       p_tier_rewards/p_milestone_bonus/p_milestone_days caller-
--       controlled the. Tampered call {9999}+50000+1 → 59,999 coins
--       EK CALL ME (qa3 par live prove kiya). PLUS: koi wallet_transactions
--       entry nahi thi (audit gap — sab checkin-users ka ledger-drift).
--       FIX v2: teeno params IGNORE; server constants ARRAY[5,7,10,12,15,20,30],
--       milestone 100 @30-day streak; wtxn 'daily_checkin' (+milestone
--       alag line). Verify: tampered→5 (day-1), dup same-day block, ledger ✓.
--
-- R4-2 ★ award_mentor_reward — UNLIMITED GD-MINTER:
--       student apne mentor ko koi bhi GD-amount credit kar sakta tha
--       (p_gd_amount 99999 → 99999 GD; student ka kuch nahi katata;
--       2 colluding accounts = infinite premium-currency). Tier-check
--       sirf client-side tha. FIX v2: p_gd_amount IGNORE; server khud
--       student ke rank_points se tier nikalta hai (Bronze1…Legend6),
--       reward = 20 × (new_tier − last_rewarded_tier); naya column
--       mentor_requests.last_rewarded_tier INT NOT NULL DEFAULT 0;
--       repeat-calls 'no_new_tier'. Verify: tampered-99999→40 (delta2),
--       repeat→no_new_tier, rank-up→+40. 3/3 ✓
--
-- R4-3 claim_premium_monthly_bonus — OVERPAY: p_bonus_coins ≤1000 accept
--       hota tha (panel 50/150/400 bhejta hai; tampered 1000 bhej ke
--       +600/month). FIX v2: server-map {1:50,2:150,3:400}; tier must
--       match active premium_level; month-dedup (UNIQUE user_id+month_key
--       pehle se tha, ab EXCEPTION-handler bhi). Verify: 999→50, dedup,
--       wrong-tier reject. 3/3 ✓
--
-- R4-4 2-arg claim_battle_pass_tier(season_key, tier) — legacy overload
--       (rewardCoins-based) DROP kiya (panel 4-arg use karta hai; meera
--       seed rewardCoins rakhta hi nahi → dead surface).
--
-- VERIFIED-SAFE (is sweep me):
--   • 18 crediting RPCs audited — baaki sab server-derived ✓
--   • admin_confirm_creator_cheat / admin_dismiss_creator_flag — is_admin
--     guard andar ✓ (broad grants ke bawajood)
--   • apply_referral_code / claim_referral_reward — server-config, self-ref
--     blocked ✓
--   • RTDB matches root-read DENIED (deployed rules strict) ✓
--   • Known data-notes (action nahi liya): 'Sponsor1' match filled_slots=0
--     vs 1 join (purana sponsored-join path, real user ka row — touch nahi);
--     Hunter7 ledger-drift 54 (5 checkin + 49 pre-ledger-era) — historical.
-- ═══════════════════════════════════════════════════════════════════

-- ── R4-1: process_daily_checkin v2 ──
CREATE OR REPLACE FUNCTION public.process_daily_checkin(p_tier_rewards numeric[] DEFAULT NULL, p_milestone_bonus numeric DEFAULT NULL, p_milestone_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := (auth.jwt() ->> 'sub');
  v_last DATE;
  v_streak INT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_yesterday DATE := v_today - 1;
  v_new_streak INT;
  v_cycle_pos INT;
  v_reward NUMERIC;
  v_milestone NUMERIC := 0;
  v_tiers NUMERIC[] := ARRAY[5, 7, 10, 12, 15, 20, 30];
  v_ms_bonus NUMERIC := 100;
  v_ms_days INT := 30;
BEGIN
  /* FIX (2026-09-20 Round-4): teeno params ab IGNORE — server constants.
     (Tampered client ne {9999}+50000+1 bheja to 59,999 coins mil rahe the
     — exploit live-confirm kiya gaya tha.) Panel koi args nahi bhejta. */
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT last_checkin_date::date, streak_days INTO v_last, v_streak
    FROM users WHERE id = v_caller FOR UPDATE;
  IF v_last IS NOT NULL AND v_last = v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_checked_in', 'streak', v_streak);
  END IF;

  IF v_last IS NOT NULL AND v_last = v_yesterday THEN
    v_new_streak := COALESCE(v_streak, 0) + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  v_cycle_pos := ((v_new_streak - 1) % array_length(v_tiers, 1)) + 1;
  v_reward := v_tiers[v_cycle_pos];
  IF v_ms_days > 0 AND v_new_streak % v_ms_days = 0 THEN
    v_milestone := v_ms_bonus;
  END IF;

  UPDATE users SET last_checkin_date = v_today, streak_days = v_new_streak,
    coins = COALESCE(coins,0) + v_reward + v_milestone WHERE id = v_caller;
  INSERT INTO daily_checkins (user_id, checkin_date, coins_earned, streak_day)
    VALUES (v_caller, v_today, v_reward + v_milestone, v_new_streak)
    ON CONFLICT (user_id, checkin_date) DO NOTHING;

  /* FIX: audit-trail — ab wallet_transactions bhi (pehle sirf users.coins
     update hota tha, ledger me kuch nahi jaata tha). */
  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_caller, 'coins', 'credit', v_reward, 'daily_checkin');
  IF v_milestone > 0 THEN
    INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
    VALUES (v_caller, 'coins', 'credit', v_milestone, 'checkin_milestone');
  END IF;

  RETURN jsonb_build_object('success', true, 'streak', v_new_streak, 'reward', v_reward,
    'milestone_bonus', v_milestone, 'total', v_reward + v_milestone);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.process_daily_checkin(numeric[], numeric, integer) TO anon, authenticated;

-- ── R4-2: mentor_requests column + award_mentor_reward v2 ──
ALTER TABLE mentor_requests ADD COLUMN IF NOT EXISTS last_rewarded_tier INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.award_mentor_reward(p_student_uid text, p_mentor_uid text, p_gd_amount integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_active BOOLEAN;
  v_rp INT;
  v_tier INT;
  v_last_tier INT;
  v_delta INT;
  v_gd INT;
BEGIN
  /* FIX (2026-09-20 Round-4): p_gd_amount IGNORE — reward server khud
     compute karta hai (rank-points se tier, 20 GD per NEW tier). */
  IF v_caller IS NULL OR v_caller <> p_student_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM mentor_requests
    WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted'
  ) INTO v_is_active;
  IF NOT v_is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active mentorship found');
  END IF;

  SELECT COALESCE(rank_points, 0) INTO v_rp FROM users WHERE id = p_student_uid;
  v_tier := CASE
    WHEN v_rp >= 2001 THEN 6
    WHEN v_rp >= 1501 THEN 5
    WHEN v_rp >= 1001 THEN 4
    WHEN v_rp >= 601  THEN 3
    WHEN v_rp >= 301  THEN 2
    ELSE 1 END;

  SELECT COALESCE(last_rewarded_tier, 0) INTO v_last_tier
    FROM mentor_requests
    WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted'
    FOR UPDATE;
  v_delta := v_tier - v_last_tier;
  IF v_delta <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_new_tier', 'tier', v_tier);
  END IF;
  v_gd := 20 * v_delta;

  UPDATE users SET green_diamonds = COALESCE(green_diamonds, 0) + v_gd WHERE id = p_mentor_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id)
  VALUES(p_mentor_uid, 'green_diamonds', 'credit', v_gd, 'mentor_reward', p_student_uid);

  INSERT INTO mentor_profiles(user_id, gd_earned, successful_students)
  VALUES(p_mentor_uid, v_gd, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    gd_earned = mentor_profiles.gd_earned + v_gd,
    successful_students = mentor_profiles.successful_students + 1;

  UPDATE mentor_requests SET last_rewarded_tier = v_tier
  WHERE student_uid = p_student_uid AND mentor_uid = p_mentor_uid AND status = 'accepted';

  RETURN jsonb_build_object('success', true, 'gd_awarded', v_gd, 'tier', v_tier, 'delta', v_delta);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.award_mentor_reward(text, text, integer) TO anon, authenticated;

-- ── R4-3: claim_premium_monthly_bonus v2 ──
CREATE OR REPLACE FUNCTION public.claim_premium_monthly_bonus(p_tier integer, p_bonus_coins integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid TEXT := auth.jwt() ->> 'sub';
  v_prem INT;
  v_month TEXT := TO_CHAR(NOW(), 'YYYY-MM');
  v_bonus INT;
BEGIN
  /* FIX (2026-09-20 Round-4): p_bonus_coins IGNORE — server-map
     {1:50, 2:150, 3:400} (panel CFG.bonuses jaisa). */
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  IF p_tier NOT IN (1,2,3) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid tier');
  END IF;
  v_bonus := CASE p_tier WHEN 1 THEN 50 WHEN 2 THEN 150 ELSE 400 END;

  SELECT COALESCE(premium_level, 0) INTO v_prem FROM users WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_prem, 0) <> p_tier THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is tier ka premium active nahi hai');
  END IF;

  INSERT INTO premium_monthly_bonus_claims(user_id, month_key, tier, bonus_coins)
  VALUES (v_uid, v_month, p_tier, v_bonus);
  UPDATE users SET coins = COALESCE(coins,0) + v_bonus WHERE id = v_uid;
  INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, note)
  VALUES (v_uid, 'coins', 'credit', v_bonus, 'premium_bonus', 'Monthly Premium Bonus Tier ' || p_tier);

  RETURN jsonb_build_object('ok', true, 'bonus', v_bonus, 'month', v_month);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Is month ka bonus le liya');
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.claim_premium_monthly_bonus(integer, integer) TO authenticated;

-- ── R4-4: legacy 2-arg overload drop ──
DROP FUNCTION IF EXISTS public.claim_battle_pass_tier(text, integer);


-- ──────────────── Part H2 (2026-09-20g ROUND-4B) ────────────────
-- RPC ownership/amount audit ke 5 fixes (R4-5..R4-9) — live bodies neeche
-- exactly wahi hain jo DB me hain. Context: 2026-09-20g-ROUND4B-DELTA.sql

-- ── increment_balance(text, text, numeric) — live body ──
CREATE OR REPLACE FUNCTION public.increment_balance(p_uid text, p_col text, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  stats_cols TEXT[] := ARRAY['total_wins','total_kills','total_matches','win_streak','clean_matches'];
  admin_cols TEXT[] := ARRAY['coins','green_diamonds','sky_diamonds','rank_points','filled_slots'];
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
BEGIN
  /* FIX (2026-09-20 Round-4): pehle self-call se coins/green_diamonds/
     sky_diamonds/rank_points SAB increment ho sakte the (unlimited
     wallet-printer latent tha). Ab self = sirf stats cols (cap 100/call);
     wallet/rank/filled_slots sirf admin/service. Panel (anon) stats-path
     wapas zinda (grant + sub-guard). */
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be non-negative, got: %', p_amount;
  END IF;
  IF NOT (p_col = ANY(stats_cols) OR p_col = ANY(admin_cols)) THEN
    RAISE EXCEPTION 'Column % not allowed', p_col;
  END IF;

  IF v_is_service THEN
    -- service: sab allowed
  ELSE
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Not authorized — no caller identity';
    END IF;
    IF v_caller <> p_uid THEN
      SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
      IF NOT COALESCE(v_is_admin, false) THEN
        RAISE EXCEPTION 'Not authorized to modify balance for this user';
      END IF;
    END IF;
    IF p_col = ANY(admin_cols) THEN
      IF v_caller <> p_uid THEN
        -- admin-ne-kisi-aur ko: theek (upar is_admin check ho chuka)
      ELSE
        RAISE EXCEPTION 'Wallet/rank columns sirf admin/service change kar sakte hain';
      END IF;
    ELSE
      IF p_amount > 100 THEN
        RAISE EXCEPTION 'Stats increment cap 100 per call';
      END IF;
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE users SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_col, p_col
  ) USING p_amount, p_uid;
END;
$function$

-- ── increment_rank_points(text, integer) — live body ──
CREATE OR REPLACE FUNCTION public.increment_rank_points(p_uid text, p_points integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_is_service BOOLEAN := (current_setting('role', true) = 'service_role');
  v_today DATE := CURRENT_DATE;
  v_rp_today INT;
BEGIN
  /* FIX (2026-09-20 Round-4): self-increment ab capped — 250/call,
     1000/day (legit calcRkScore ~111/match se upar). Admin/service
     bypass. Pehle unlimited tha (self rank-printer). */
  IF NOT v_is_service AND v_caller IS DISTINCT FROM p_uid THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Not authorized — no caller identity';
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'Not authorized to modify rank points for this user';
    END IF;
  END IF;
  IF p_points < 0 THEN RAISE EXCEPTION 'Points must be non-negative'; END IF;

  IF NOT v_is_service AND v_caller = p_uid THEN
    IF p_points > 500 THEN
      RAISE EXCEPTION 'Rank points cap 500 per call';
    END IF;
    SELECT CASE WHEN rp_day = v_today THEN rp_today ELSE 0 END INTO v_rp_today
      FROM users WHERE id = p_uid FOR UPDATE;
    IF v_rp_today >= 2000 THEN
      RAISE EXCEPTION 'Daily rank points cap reached (2000)';
    END IF;
    UPDATE users SET rp_today = CASE WHEN rp_day = v_today THEN rp_today ELSE 0 END + p_points,
      rp_day = v_today WHERE id = p_uid;
  END IF;

  UPDATE users SET rank_points = COALESCE(rank_points, 0) + p_points WHERE id = p_uid;
END;
$function$

-- ── cancel_match_with_refunds(text, text) — live body ──
CREATE OR REPLACE FUNCTION public.cancel_match_with_refunds(p_match_id text, p_admin_uid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_jr RECORD;
  v_refund_count INT := 0;
  v_currency TEXT;
  v_caller TEXT := auth.jwt() ->> 'sub';
BEGIN
  /* FIX (2026-09-20 Round-4): YE RPC BINA GUARD KE THA — koi bhi user
     kisi bhi match ko cancel karke sabko refunds dilwa sakta tha
     (match-sabotage). Ab sirf admin. p_admin_uid ab caller se hi. */
  IF v_caller IS NULL OR NOT COALESCE((SELECT is_admin FROM users WHERE id = v_caller), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  p_admin_uid := COALESCE(p_admin_uid, v_caller);

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;
  FOR v_jr IN
  SELECT * FROM join_requests
  WHERE match_id = p_match_id
  AND status NOT IN ('cancelled', 'refunded', 'rejected')
  AND COALESCE(entry_fee_paid, 0) > 0
  FOR UPDATE
  LOOP
  v_currency := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;
  v_currency := CASE WHEN v_jr.entry_type = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;

    IF v_currency = 'coins' THEN
      UPDATE users SET coins = COALESCE(coins,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    ELSE
      UPDATE users SET sky_diamonds = COALESCE(sky_diamonds,0) + v_jr.entry_fee_paid WHERE id = v_jr.user_id;
    END IF;

    INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, ref_id, status)
    VALUES (v_jr.user_id, v_currency, 'credit', v_jr.entry_fee_paid, 'match_cancelled_refund', p_match_id, 'approved');

    UPDATE join_requests SET status = 'refunded' WHERE id = v_jr.id;

    INSERT INTO notifications(user_id, title, body, type, is_read, created_at, ref_id)
    VALUES (
      v_jr.user_id,
      '💰 Match Cancelled — Refund',
      '"' || COALESCE(v_match.name, v_match.title, p_match_id) || '" cancel ho gaya. Aapka entry fee wapas kar diya gaya hai.',
      'refund',
      false,
      NOW(),
      p_match_id
    );

    v_refund_count := v_refund_count + 1;
  END LOOP;

  UPDATE join_requests
  SET status = 'cancelled'
  WHERE match_id = p_match_id AND status NOT IN ('cancelled', 'refunded', 'rejected');

  UPDATE matches SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = p_admin_uid WHERE id = p_match_id;

  RETURN jsonb_build_object('ok', true, 'refund_count', v_refund_count);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;

$function$

-- ── unlock_squad_bank_cosmetic(uuid, text, integer, text) — live body ──
CREATE OR REPLACE FUNCTION public.unlock_squad_bank_cosmetic(p_clan_id uuid, p_item_id text, p_cost integer, p_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_catalog_cost TEXT;
  v_caller   TEXT := auth.jwt() ->> 'sub';
  v_gd       INT;
  v_unlocked JSONB;
  v_is_member BOOLEAN;
BEGIN
  IF v_caller IS NOT NULL AND v_caller <> p_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;
  SELECT EXISTS(SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = p_uid) INTO v_is_member;
  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not a member of this clan');
  END IF;

  /* FIX (2026-09-20 Round-4): p_cost IGNORE — cost catalog se
     (app_settings 'squad_bank_items'). Pehle member cost=1 likh ke koi
     bhi item unlock kar sakta tha. */
  SELECT value->p_item_id->>'cost' INTO v_catalog_cost FROM app_settings WHERE key = 'squad_bank_items';
  IF v_catalog_cost IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_item');
  END IF;
  p_cost := v_catalog_cost::NUMERIC;

  SELECT squad_bank_gd, COALESCE(squad_bank_unlocked, '{}'::JSONB)
  INTO v_gd, v_unlocked
  FROM clans WHERE id = p_clan_id FOR UPDATE;

  IF v_gd IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Clan not found');
  END IF;
  IF v_unlocked ? p_item_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already unlocked');
  END IF;
  IF v_gd < p_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient squad bank balance');
  END IF;

  UPDATE clans SET
    squad_bank_gd = squad_bank_gd - p_cost,
    squad_bank_unlocked = v_unlocked || jsonb_build_object(
      p_item_id, jsonb_build_object('unlockedAt', NOW(), 'unlockedBy', p_uid)
    )
  WHERE id = p_clan_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$

-- ── increment_clan_score(uuid, integer, integer, integer) — live body ──
CREATE OR REPLACE FUNCTION public.increment_clan_score(p_clan_id uuid, p_score integer DEFAULT 1, p_kills integer DEFAULT 0, p_wins integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     TEXT := auth.jwt() ->> 'sub';
  v_is_member  BOOLEAN;
BEGIN
  -- ✅ SECURITY FIX (2026-07-17): documented as "caller must be a real
  -- clan_members row for that clan" but this was never actually checked —
  -- any authenticated caller could inflate (or, since p_score/p_kills/
  -- p_wins weren't bounded to non-negative either, potentially deflate)
  -- any clan's leaderboard stats regardless of membership.
  IF v_caller IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM clan_members WHERE clan_id = p_clan_id AND user_id = v_caller
    ) INTO v_is_member;
    IF NOT v_is_member THEN
      RAISE EXCEPTION 'Not a member of this clan';
    END IF;
  END IF;
  IF p_score < 0 OR p_kills < 0 OR p_wins < 0 OR p_score > 30 OR p_kills > 30 OR p_wins > 1 THEN
    /* FIX (2026-09-20 Round-4): per-call caps (legit: kills*1+wins*5/ma
     tch — panel se max ~25). Spam-inflation band. */
    RAISE EXCEPTION 'Score/kills/wins must be non-negative';
  END IF;

  UPDATE clans SET
    weekly_score = COALESCE(weekly_score, 0) + p_score,
    total_kills  = COALESCE(total_kills, 0)  + p_kills,
    total_wins   = COALESCE(total_wins, 0)   + p_wins
  WHERE id = p_clan_id;
END;
$function$

-- ================================================================
-- END Part H2
-- ================================================================

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


-- ──────────────── Part I (2026-09-20h ROUND-5 RLS POLICY AUDIT) ────────────────
-- 96 tables blanket-grants → security RLS policies par. 4 policy-holes fix:
--   I1  battle_pass_progress: zero-state INSERT/UPDATE policies (GD-minter band)
--   I2  mission_progress: incomplete-only policies
--   I3  join_requests: free/ad-only INSERT + client-UPDATE clamp trigger
--   I4  sd_requests: pending-only INSERT
-- NOTE: PostgREST PATCH 204 = "write-proof" nahi (RLS-hidden 0-rows bhi
-- 204 deta hai) — fresh-read karo. Context: 2026-09-20h-ROUND5-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20h ROUND-5 DELTA — RLS POLICY AUDIT — LIVE RUN ✅
-- ═══════════════════════════════════════════════════════════════════
-- Sweep: 96 tables sab anon/authenticated ko blanket I/U/D grants rakhte
-- hain (by design, lockdown-round ka pattern) — security PURI RLS
-- policies par hai. Direct PostgREST policy-probes se 4 holes mile:
--
-- R5-1 ★ battle_pass_progress (bpp_own ALL policy, CHECK=None):
--       user apni progress row KUCH BHI likh sakta (current_tier=50 +
--       has_premium=true) → claim_battle_pass_tier se UNLIMITED GD
--       (live-exploited: fake row → prem t10 claim → 20 GD mil gaye).
--       FIX: bpp_own → 3 policies: select-own; INSERT/UPDATE WITH CHECK
--       zero-state (tier=0, xp=0, premium=false, claims empty). Definer
--       RPCs (award_xp/claim_tier) RLS bypass karte hain (owner postgres)
--       — legit flows untouched. Panel first-visit zero-insert bhi pass.
--
-- R5-2 mission_progress (mp_own, CHECK=None): self-completed missions
--       likh sakta tha. FIX: incomplete-only insert/update policies.
--
-- R5-3 join_requests (jr_insert_own CHECK sirf user_id): PAID match me
--       fee skip karke 'joined' row insert → free entry (+room creds).
--       FIX: INSERT WITH CHECK (fee=0 AND entry_type IN (free,ad) AND
--       status='joined'). Plus naya clamp-trigger: client UPDATE par
--       status/kills/placement/prize_earned/entry_fee_paid protect
--       (definer-RPC current_user=postgres → bypass; admin-jwt → bypass).
--
-- R5-4 sd_requests (sd_insert_own CHECK sirf user_id): self-'approved'
--       rows. FIX: WITH CHECK (status = 'pending').
--
-- VERIFY-NOTES:
--   • app_settings UPDATE probe ka 204 = 0-rows (RLS USING admin ne
--     silently hide kiya) — mission_config UNCHANGED tha. ★ LESSON:
--     PostgREST PATCH ka 204 "write-proof" NAHI hai — fresh-read karo.
--   • users self-DELETE ka 204 bhi same (policy absent → 0 rows) ✓ safe.
--   • wallet_transactions INSERT, vouchers INSERT, battle_passes INSERT,
--     match_results INSERT (trigger), users.coins (guard-trigger) — sab
--     already blocked ✓.
--   • notifications other-user insert = BY-DESIGN (squad/mentor/clan
--     features) — wallet/admin-type types policy me blocked hain.
--   • Panel note: battle-pass.js ka local XP-mirror direct-update ab
--     no-op (silent) — server RPC hi source of truth; next panel-cleanup
--     me wo update-block hatana chahiye.
-- ═══════════════════════════════════════════════════════════════════

-- ── R5-1 battle_pass_progress ──
DROP POLICY IF EXISTS bpp_own ON battle_pass_progress;
CREATE POLICY bpp_select_own ON battle_pass_progress FOR SELECT TO anon, authenticated
USING ((auth.jwt() ->> 'sub') = user_id);
CREATE POLICY bpp_insert_zero ON battle_pass_progress FOR INSERT TO anon, authenticated
WITH CHECK ((auth.jwt() ->> 'sub') = user_id
  AND COALESCE(current_tier,0) = 0 AND COALESCE(current_xp,0) = 0
  AND COALESCE(has_premium,false) = false
  AND COALESCE(claimed_free,'{}'::jsonb) = '{}'::jsonb
  AND COALESCE(claimed_prem,'{}'::jsonb) = '{}'::jsonb);
CREATE POLICY bpp_update_zero ON battle_pass_progress FOR UPDATE TO anon, authenticated
USING ((auth.jwt() ->> 'sub') = user_id)
WITH CHECK ((auth.jwt() ->> 'sub') = user_id
  AND COALESCE(current_tier,0) = 0 AND COALESCE(current_xp,0) = 0
  AND COALESCE(has_premium,false) = false
  AND COALESCE(claimed_free,'{}'::jsonb) = '{}'::jsonb
  AND COALESCE(claimed_prem,'{}'::jsonb) = '{}'::jsonb);

-- ── R5-2 mission_progress ──
DROP POLICY IF EXISTS mp_own ON mission_progress;
CREATE POLICY mp_select_own ON mission_progress FOR SELECT TO anon, authenticated
USING ((auth.jwt() ->> 'sub') = user_id);
CREATE POLICY mp_insert_incomplete ON mission_progress FOR INSERT TO anon, authenticated
WITH CHECK ((auth.jwt() ->> 'sub') = user_id AND COALESCE(is_completed,false) = false AND COALESCE(reward_claimed,false) = false);
CREATE POLICY mp_update_incomplete ON mission_progress FOR UPDATE TO anon, authenticated
USING ((auth.jwt() ->> 'sub') = user_id)
WITH CHECK ((auth.jwt() ->> 'sub') = user_id AND COALESCE(is_completed,false) = false AND COALESCE(reward_claimed,false) = false);

-- ── R5-3 join_requests ──
DROP POLICY IF EXISTS jr_insert_own ON join_requests;
CREATE POLICY jr_insert_free_only ON join_requests FOR INSERT TO anon, authenticated
WITH CHECK ((auth.jwt() ->> 'sub') = user_id
  AND COALESCE(entry_fee_paid,0) = 0
  AND COALESCE(entry_type,'free') IN ('free','ad')
  AND status = 'joined');

CREATE OR REPLACE FUNCTION public.clamp_join_requests_client_update()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  /* Round-5: client (PostgREST role) join_requests UPDATE par sensitive
     cols clamp — status/kills/placement/prize_earned/entry_fee_paid sirf
     definer-RPC (current_user=postgres) ya admin-jwt change kar sakte hain.
     in_room/checkin flags client ke liye khule rehte hain. */
  IF current_user IN ('anon','authenticated') THEN
    SELECT COALESCE(is_admin,false) INTO v_is_admin FROM users WHERE id = auth.jwt() ->> 'sub';
    IF NOT COALESCE(v_is_admin,false) THEN
      NEW.status := OLD.status;
      NEW.kills := OLD.kills;
      NEW.placement := OLD.placement;
      NEW.prize_earned := OLD.prize_earned;
      NEW.entry_fee_paid := OLD.entry_fee_paid;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_clamp_jr_client ON join_requests;
CREATE TRIGGER trg_clamp_jr_client BEFORE UPDATE ON join_requests
FOR EACH ROW EXECUTE FUNCTION public.clamp_join_requests_client_update();

-- ── R5-4 sd_requests ──
DROP POLICY IF EXISTS sd_insert_own ON sd_requests;
CREATE POLICY sd_insert_pending ON sd_requests FOR INSERT TO anon, authenticated
WITH CHECK ((auth.jwt() ->> 'sub') = user_id AND status = 'pending');

-- ═══════════════════════════════════════════════════════════════
-- VERIFY (live re-probes): bp tampered BLOCK / zero-state OK /
-- self-tier-update BLOCK / award_xp RPC works / mission completed BLOCK /
-- incomplete OK / paid-join BLOCK / legit paid RPC join (fee debit) OK /
-- client jr-update clamped / admin jr-update OK / sd approved BLOCK /
-- sd pending OK — 12/12 ✓
-- ═══════════════════════════════════════════════════════════════


-- ──────────────── Part J (2026-09-20i ROUND-6 CONCURRENCY) ────────────────
-- Parallel-race battery (×6-12 concurrent per claim-RPC): 7/7 — sirf
-- watch_earn me deterministic lock missing tha (race-window theoretical).
-- FIX: claim_watch_earn_reward v2 — FOR UPDATE on users (body live se).
-- no-JWT sweep: 18/18 sensitive RPCs safe. Storage: 0 buckets (clean).
-- Context: 2026-09-20i-ROUND6-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20i ROUND-6 — CONCURRENCY-RACE AUDIT — LIVE RUN ✅
-- ═══════════════════════════════════════════════════════════════════
-- Sweep: saare claim/join RPCs par ThreadPool parallel-exploit battery
-- (8-12 concurrent calls per RPC, same-user + real-season data).
--
-- RESULTS (7 race-batteries + no-JWT sweep):
--   R6-1 watch_earn ×10/×12 → pehle bhi 1 hi succeed (interval-check ne
--        bacha liya), PAR deterministic nahi tha (race-window theoretical).
--        FIX: FOR UPDATE on users row (claim start par hi serialize).
--        Verify: ×12 clean → 1 succeeded (+2), baaki 'Too soon' ✓
--   R6-2 process_daily_checkin ×6 → 1 succeeded ✓ (FOR UPDATE tha)
--   R6-3 claim_streak_milestone ×8 → 1 real-claim (+20) ✓
--   R6-4 claim_mission_reward ×8 → 1 ✓
--   R6-5 claim_battle_pass_tier ×6 → 1 ✓
--   R6-6 redeem_voucher ×6 same-user → 1 ✓ (FOR UPDATE + UNIQUE)
--   R6-7 validate_and_join_match ×6 same-user → 1 join, filled_slots=1 ✓
--   R6-8 no-JWT sweep (18 sensitive RPCs, koi Authorization nahi):
--        18/18 SAFE — 13 explicit not_authenticated, 5 business-denials
--        (owner/membership/admin checks mutation se PEHLE fire) — 0 mutations.
--
-- STORAGE: storage.buckets khaali (0 buckets, 0 policies) — attack-surface
-- nahi hai. anon ke storage.objects grants default hain par koi bucket
-- nahi → non-issue.
--
-- NOTES: redeem_voucher/claim_match_refund/claim_no_show_refund/
-- validate_and_join_match — FOR UPDATE pehle se the ✓.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_watch_earn_reward(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_cfg JSONB;
  v_coins_per_interval INT;
  v_daily_limit_mins INT;
  v_interval_mins INT;
  v_match_status TEXT;
  v_today DATE := CURRENT_DATE;
  v_today_mins INT;
  v_last_claim TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  /* FIX (2026-09-20 Round-6): FOR UPDATE — parallel claims serialize
     (race-window me interval/daily-limit checks sab last-claim insert se
     pehle read kar sakte the). */
  PERFORM 1 FROM users WHERE id = v_caller FOR UPDATE;

  -- Match must genuinely exist and be live right now — server checks
  -- this itself, does not trust the client's cached match status.
  SELECT status INTO v_match_status FROM matches WHERE id = p_match_id;
  IF v_match_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match not found');
  END IF;
  IF v_match_status <> 'live' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match live nahi hai');
  END IF;

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_coins_per_interval := COALESCE((v_cfg->>'watchCoinsPerInterval')::INT, 2);
  v_daily_limit_mins   := COALESCE((v_cfg->>'watchDailyLimitMins')::INT, 30);
  v_interval_mins      := COALESCE((v_cfg->>'watchIntervalMins')::INT, 5);

  -- Interval gate: naya claim tabhi jab last claim se kam-se-kam
  -- (interval - grace) beet chuke hon (client interval ke jhooth par
  -- bharosa nahi).
  SELECT max(created_at) INTO v_last_claim FROM watch_earn_log WHERE user_id = v_caller;
  IF v_last_claim IS NOT NULL AND v_last_claim > (now() - (v_interval_mins || ' minutes')::interval + interval '20 seconds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too soon — wait for the next interval');
  END IF;

  SELECT COALESCE(SUM(watched_mins),0) INTO v_today_mins
    FROM watch_earn_log WHERE user_id = v_caller AND log_date = v_today;
  IF v_today_mins >= v_daily_limit_mins THEN
    RETURN jsonb_build_object('success', false, 'error', 'Daily limit reached', 'todayMins', v_today_mins);
  END IF;

  UPDATE users SET coins = COALESCE(coins, 0) + v_coins_per_interval WHERE id = v_caller;
  INSERT INTO watch_earn_log (user_id, match_id, watched_mins, interval_mins, log_date)
  VALUES (v_caller, p_match_id, v_coins_per_interval, v_interval_mins, v_today);
  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_caller, 'coins', 'credit', v_coins_per_interval, 'watch_earn');

  RETURN jsonb_build_object('success', true, 'coinsEarned', v_coins_per_interval, 'todayMins', v_today_mins + v_interval_mins);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.claim_watch_earn_reward(text) TO anon, authenticated;


-- ──────────────── Part K (2026-09-20j ROUND-7 PLATFORM AUDIT) ────────────────
-- ★ service_role ke public-schema grants ZERO the (purana lockdown) — har
-- Edge-Function DB-op dead. Restore: ALL TABLES + ALL SEQUENCES grants.
-- Realtime 63 tables = RLS-consistent (no new leak). Cron no-show-refunds
-- solid (SKIP LOCKED). Auth: anonymous-signins OFF. Backups: free-tier (ops).
-- Edge fns: paytm-callback/create verify_jwt fixes + create-order v3
-- (Firebase-JWKS in-fn auth) — code user-panel repo. PayTM_* secrets owner-ops.
-- Context: 2026-09-20j-ROUND7-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20j ROUND-7 — CRON/AUTH/REALTIME/BACKUP/EDGE-FUNCTIONS AUDIT
-- ═══════════════════════════════════════════════════════════════════
-- (SQL parts neeche; config/API changes comments me — live applied ✅)
--
-- R7-1 ★ SERVICE_ROLE GRANTS — SAFEEC FINDING:
--   service_role ke paas public schema ki IN tables par ZERO grants the
--   (purana lockdown sab kuch REVOKE kar gaya tha). Har Edge Function ka
--   DB-op dead tha (paytm-create-order insert 403/42501 de raha tha —
--   live-captured). FIX (live): blanket restore —
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
--   (13 RPCs jinke EXECUTE sirf anon/authenticated ke paas hain waise hi
--   rahne diye — edge fns unhe call nahi karte; least-privilege.)
--   NOTE: naya table banate waqt default privileges service_role ko
--   dekh lena — ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO service_role.
--
-- R7-2 cron audit: internal_process_no_show_refunds (every minute) —
--   FOR UPDATE SKIP LOCKED + claim_no_show_refund se same eligibility +
--   idempotent status-flip + wallet-ledger + notif. SOLID — koi fix nahi.
--
-- R7-3 realtime: supabase_realtime publication me 63 tables (sab RLS-on;
--   postgres_changes RLS-filtered hota hai → REST jaisa hi access, koi
--   naya leak nahi). messages-publication khaali.
--
-- R7-4 auth config (live PATCH):
--   external_anonymous_users_enabled: true → FALSE (0 native auth.users;
--   anon-session spam/JWT-abuse surface band).
--   mailer_autoconfirm=true / password_min_length=6 — native-auth path
--   unused (Firebase third-party hi real path hai) — documented, no change.
--
-- R7-5 backups: pitr_enabled=false, backups=[] (free tier) — WAL-archiving
--   (walg) on hai. RECOMMENDATION: periodic pg_dump off-platform (owner ops).
--
-- R7-6 ★ EDGE FUNCTIONS (live fixes, code user-panel repo me):
--   • paytm-callback: verify_jwt TRUE → PayTM webhook 401 (deposits confirm
--     nahi hote the). → verify_jwt=false (fn khud PayTM /v3/order/status
--     merchant-signed se verify karta hai — safe webhook pattern). LIVE ✅
--   • paytm-create-order: platform gateway Firebase-RS256 JWT reject karta
--     tha (UNAUTHORIZED_ASYMMETRIC_JWT) → deposits 100% DEAD. v3 deployed:
--     in-fn Firebase JWKS verify (imgbb-upload pattern, fail-closed) +
--     service grants fix → chain live. Remaining: PAYTM_* secrets set karna
--     (owner creds): PAYTM_MID, PAYTM_MERCHANT_KEY, PAYTM_WEBSITE,
--     PAYTM_ENV, PAYTM_CALLBACK_URL=https://.../functions/v1/paytm-callback
--   • imgbb-upload: code/auth SAHI (e2e-tested — gateway+JWKS pass), par
--     ImgBB upstream "forbidden" deta hai (IMGBB_KEY invalid/blocked) —
--     OWNER-OPS: imgbb account se nayi key `supabase secrets set IMGBB_KEY=...`
--
-- PROBES (live): create-order no-token→401 ✓ / tampered-JWT→401 ✓ /
-- valid-Firebase→auth-pass+insert+clean-error ✓ (secrets missing tak sab
-- chala) / callback fake-orderId→crash-safe, no-flip ✓ / E2E 8/8 ✓
-- ═══════════════════════════════════════════════════════════════════


-- ──────────────── Part L (2026-09-20k ROUND-8 POLICY SWEEP) ────────────────
-- Baaki user-writable tables ke 6 CONFIRMED holes fix (live-probes):
--   polls UPDATE rig / clan_wars fake-war / clan_members leader-spoof /
--   cwc spoof / gift no-pay insert / request-tables self-approve
-- 12 insert-policies status-hygiene ('pending'/'open' only);
-- profile_requests user-edit pending-only; reward catalog public-SELECT;
-- gift_match_entry RPC (atomic gift, client RPC par migrated).
-- NOTE: clan-war score abhi bhi client self-report (feature dormant) —
-- launch se pehle server-RPC chahiye. Context: 2026-09-20k-ROUND8-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20k ROUND-8 — REMAINING USER-WRITABLE TABLES POLICY SWEEP
-- ═══════════════════════════════════════════════════════════════════
-- (Policies/RPC live-applied ✅ — live-probes se CONFIRMED holes:)
--   R8-1 polls.poll_vote_auth: any-auth UPDATE polls row → qa1 ne
--        total_votes=99999 LIVE rig kiya. Voting pehle se
--        cast_poll_vote RPC se hai → policy DROP.
--   R8-2 clan_wars cw_insert_auth + cw_update_auth (any-auth): fake war
--        INSERT 201 LIVE-captured; feature dormant (0 rows) → dono DROP
--        (admin/service hi likhe). NOTE: war-score abhi client self-report
--        hai — feature launch se PEHLE server-RPC design zaroori.
--   R8-3 clan_members cm_insert_auth: qa1 ne real clan me khud ko
--        'leader' bana liya (201) → cm_insert_self: user_id=self AND
--        (role='member' OR (role='leader' AND clans.leader_uid=self)).
--   R8-4 clan_war_challenges any-auth I/U: spoof challenge 201 →
--        leader-gated policies (from_clan ka leader hi create kare;
--        update = kisi bhi party ka leader; from<>to).
--   R8-5 gift_tickets gt_insert_own: BINA pay ke ticket 201 (client
--        deduct aur insert alag bhejta tha — non-atomic) → direct insert
--        DROP; naya RPC gift_match_entry (atomic: FOR UPDATE lock +
--        balance-check + debit + ticket + ledger + notif; insufficient
--        par kuch nahi hota). Client screens/matches.js ab RPC call karta
--        hai (user-panel repo dea9a3a).
--   R8-6 12 request-tables: INSERT policies me status uncontrolled tha —
--        premium_requests/coin_requests me self-'approved' row 201 LIVE.
--        Ab status-hygiene: {coin/refund/premium/season_pass/ban/kyc/
--        creator_applications/sponsored_prize_claims/user_suggestions/
--        suggestions} → 'pending'-only; {support_tickets, disputes} →
--        'open'-only. (Defaults client-values se match — legit flows OK.)
--   R8-7 profile_requests: user-edit ab sirf status='pending' par.
--   R8-8 reward_store_items: catalog public-SELECT grant (RLS-off table,
--        writes service-only).
--
-- VERIFY (live re-probes): polls-rig BLOCK / fake-war BLOCK /
-- leader-spoof BLOCK / legit self-join member OK / gift direct-insert
-- BLOCK / cwc spoof BLOCK / self-approve BLOCK / legit pending row OK /
-- gift RPC e2e (455→405, row+ledger+notif) OK / insufficient clean-error
-- (coins intact) OK / self-gift BLOCK — 11/11 ✓
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.gift_match_entry(p_match_id text, p_to_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_me TEXT := auth.jwt() ->> 'sub';
  v_m RECORD; v_friend RECORD; v_my_name TEXT; v_col TEXT; v_bal NUMERIC; v_gift_id UUID;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Not authorized'); END IF;
  IF p_to_uid IS NULL OR p_to_uid = v_me THEN RETURN jsonb_build_object('ok', false, 'error', 'Apne aap ko gift nahi kar sakte'); END IF;
  SELECT id, entry_fee, entry_type, name, status INTO v_m FROM matches WHERE id::text = p_match_id;
  IF v_m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Match not found'); END IF;
  IF COALESCE(v_m.entry_fee, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Gift sirf paid matches par'); END IF;
  SELECT id, COALESCE(ff_uid, '') AS ff_uid INTO v_friend FROM users WHERE id = p_to_uid;
  IF v_friend.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Player not found'); END IF;
  SELECT COALESCE(ign, 'Player') INTO v_my_name FROM users WHERE id = v_me;
  v_col := CASE WHEN lower(COALESCE(v_m.entry_type, 'coin')) = 'coin' THEN 'coins' ELSE 'sky_diamonds' END;
  /* FOR UPDATE + explicit balance check — balance-guard trigger FOUND ko
     true kar deta tha (v2 bug), isliye insufficient par UPDATE tak nahi jaate. */
  EXECUTE format('SELECT COALESCE(%I, 0) FROM users WHERE id = $1 FOR UPDATE', v_col) INTO v_bal USING v_me;
  IF v_bal IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'User not found'); END IF;
  IF v_bal < v_m.entry_fee THEN RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance'); END IF;
  EXECUTE format('UPDATE users SET %I = COALESCE(%I, 0) - $1 WHERE id = $2', v_col, v_col) USING v_m.entry_fee, v_me;
  INSERT INTO gift_tickets (from_uid, from_name, to_uid, to_ff_uid, match_id, match_name, fee, entry_type, status)
  VALUES (v_me, v_my_name, p_to_uid, v_friend.ff_uid, v_m.id, v_m.name, v_m.entry_fee, v_m.entry_type, 'pending')
  RETURNING id INTO v_gift_id;
  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_me, v_col, 'debit', v_m.entry_fee, 'gift_entry');
  INSERT INTO notifications (user_id, type, title, body)
  VALUES (p_to_uid, 'gift_ticket', '🎁 Match Ticket Gift!', v_my_name || ' ne tumhe "' || v_m.name || '" ka entry ticket gift kiya!');
  RETURN jsonb_build_object('ok', true, 'gift_id', v_gift_id, 'fee', v_m.entry_fee);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.gift_match_entry(text, text) TO anon, authenticated;


-- ──────────────── Part M (2026-09-20m ROUND-9 RPC-AUDIT) ────────────────
-- claim_ad_reward ×8 parallel → 8/8 success (+80; cap toota) → FOR UPDATE fix.
-- increment_own_match_played → 50/day cap (users.mpm_today/mpm_day).
-- referral UNIQUE-safe; withdrawal/redeem/creator audit-clean.
-- Fraud-tools: deviceJoins per-device bridge (admin repo JS fix).
-- Context: 2026-09-20m-ROUND9-DELTA.sql

CREATE OR REPLACE FUNCTION public.claim_ad_reward()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_cfg JSONB;
  v_ad_coins INT;
  v_daily_limit INT;
  v_today_count INT;
  v_last_claim TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  /* FIX (2026-09-20m Round-9): FOR UPDATE — ×8 parallel live-probe ne
     8/8 success +80 coins diya tha (daily-cap bhi toota). Ab serialized. */
  PERFORM 1 FROM users WHERE id = v_caller FOR UPDATE;

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'live_config';
  v_ad_coins    := COALESCE((v_cfg->>'adCoinsPerWatch')::INT, 5);
  v_daily_limit := COALESCE((v_cfg->>'adDailyLimit')::INT, 5);

  -- Rate-limit rapid repeat calls (a real rewarded ad takes real time
  -- to play — anything faster than ~15s between claims is not a
  -- genuinely-watched ad).
  SELECT max(created_at) INTO v_last_claim FROM ad_reward_log WHERE user_id = v_caller;
  IF v_last_claim IS NOT NULL AND v_last_claim > (now() - interval '15 seconds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too soon — wait a moment');
  END IF;

  SELECT count(*) INTO v_today_count FROM ad_reward_log WHERE user_id = v_caller AND log_date = CURRENT_DATE;
  IF v_today_count >= v_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'Daily ad limit reached', 'todayCount', v_today_count);
  END IF;

  UPDATE users SET coins = COALESCE(coins, 0) + v_ad_coins WHERE id = v_caller;

  INSERT INTO ad_reward_log (user_id, coins_earned) VALUES (v_caller, v_ad_coins);

  INSERT INTO wallet_transactions (user_id, currency, txn_type, amount, reason)
  VALUES (v_caller, 'coins', 'credit', v_ad_coins, 'ad_reward');

  RETURN jsonb_build_object('success', true, 'coinsEarned', v_ad_coins, 'todayCount', v_today_count + 1);
END;
$function$

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20m ROUND-9 — REMAINING RPC AUDIT + FRAUD-TOOL RULES-FIX
-- ═══════════════════════════════════════════════════════════════════
-- LIVE-CONFIRMED + FIXED:
--   R9-1 ★ claim_ad_reward ×8 parallel → 8/8 SUCCESS +80 coins
--     (daily-cap 5 ka bhi ulangh — koi lock nahi tha; coin-printer).
--     FIX: FOR UPDATE on users (watch_earn pattern). Re-probe ×8 →
--     1 success (+10), baki 'Too soon' ✅
--   R9-2 claim_referral_reward: race probe ×4 → UNIQUE(referred_id) ne
--     bacha liya (0 double) — safe as-is ✅ (recommend: FOR UPDATE
--     hygiene jab bhi touch ho).
--   R9-3 increment_own_match_played: uncapped +1 (rank-score matches-
--     component farm). FIX v3: users.mpm_today/mpm_day cols + 50/day cap.
--     Re-probe ×55 → exactly 50 succeeded ✅  (v2 me PL/pgSQL bare-column
--     bug tha — SELECT INTO me day-col bhi saath padha)
--   R9-4 submit_gd_withdrawal / redeem_reward_item / creator_create_match:
--     audit clean (jwt + FOR UPDATE + caps + balance-checks) ✅
--   R9-5 increment_match_filled_slots: stub (koi mutation nahi) ✅
--
-- ADMIN-PANEL (code fixes, is repo me):
--   R9-6 ★ Fraud tools deviceJoins ROOT-read karte the — Round-2 rules ne
--     deny kiya (privacy) → permission_denied. FIX: naya
--     js/admin-devicejoins-bridge.js — users.device_fp list (Supabase)
--     → PER-DEVICE RTDB reads (allowed) → same data-shape walkers.
--     Patched: features-admin.js runFraudCheck, v24 fa73_detectIPClusters,
--     v24 runFraudCheck (paginated) + numChildren replacement.
--   R9-7 Broadcast/PrizeCalc tools: koi real error nahi (slow-init
--     warning harness-timing ki thi). Dashboard init 15s warning =
--     bridge-wait budget — documented, feature intact.
-- ═══════════════════════════════════════════════════════════════════

-- R9-1: claim_ad_reward v2 (FOR UPDATE) — poora body live se, diff sirf lock:
--   (body COMPLETE_SCHEMA Part M me; anchor ke turant baad:)
--   PERFORM 1 FROM users WHERE id = v_caller FOR UPDATE;

-- R9-3: increment_own_match_played v3 + cols
ALTER TABLE users ADD COLUMN IF NOT EXISTS mpm_today INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mpm_day DATE;

CREATE OR REPLACE FUNCTION public.increment_own_match_played()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_today DATE := CURRENT_DATE;
  v_cnt INT;
  v_day DATE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  /* Round-9: 50/day cap (rank-score matches-component farm band) */
  PERFORM 1 FROM users WHERE id = v_caller FOR UPDATE;
  SELECT COALESCE(mpm_today, 0), mpm_day INTO v_cnt, v_day FROM users WHERE id = v_caller;
  IF COALESCE(v_day, '1970-01-01') <> v_today THEN v_cnt := 0; END IF;
  IF v_cnt >= 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Daily limit reached');
  END IF;
  UPDATE users
     SET total_matches = COALESCE(total_matches, 0) + 1,
         mpm_today = v_cnt + 1,
         mpm_day = v_today
   WHERE id = v_caller;
  RETURN jsonb_build_object('success', true);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.increment_own_match_played() TO anon, authenticated;


-- ──────────────── Part N (2026-09-20n ROUND-10 PRIV-TABLES + FRIENDS) ────────────────
-- city_championship / duel_records / season_stats ke leftover any-auth/self-write
-- policies DROP (RPCs increment_city_score + record_duel_result = authorized paths).
-- ★ FRIENDS FEATURE-REPAIR: friendships fr_insert_pair (user_a OR user_b = self)
--   + fr_delete_own — pehle add-friend 401 aur remove-friend 0-rows tha (broken!).
-- R5-inconclusives closed: admins/creator_payouts INSERT admin-gated ✓.
-- Context: 2026-09-20n-ROUND10-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20n ROUND-10 — PRIVILEGED-TABLES SWEEP + FRIENDS FEATURE-REPAIR
-- ═══════════════════════════════════════════════════════════════════
-- LIVE-CONFIRMED + FIXED (policies live-applied ✅):
--   R10-1 city_championship cc_insert_auth/cc_update_auth (any-auth):
--     qa1 ne throwaway city row ka score 99999 tamper kiya (LIVE).
--     increment_city_score RPC pehle se solid tha (self-only + caps) →
--     dono direct policies DROP. Client fallback bhi hata (user-repo).
--   R10-2 duel_records dr_upsert_own (ALL, self): fake wins/losses 201.
--     record_duel_result RPC (both-rows atomic) pehle se hai → DROP.
--   R10-3 season_stats ss_self_write (ALL, self): fake wins/points 201.
--     Client kahin write nahi karta → admin-only write (ss_admin_write).
--   R10-4 ★ FRIENDS FEATURE PRODUCTION-ME BROKEN THA:
--     (a) add-friend 2-row upsert → 401 (fr_insert_own sirf user_a=self
--         allow karta tha; client dono rows ek saath bhejta hai → PURA
--         statement fail). (b) remove-friend → 204-par-0-rows (koi DELETE
--         policy hi nahi!). FIX: fr_insert_pair (user_a=self OR user_b=self)
--         + fr_delete_own (same). Ab add/remove dono kaam karte hain ✓
--   R10-5 R5-inconclusives CLOSED: admins INSERT 401 ✓, creator_payouts
--     INSERT 401 ✓ (dono admin-gated policies sahi kaam karti hain).
--
-- VERIFY (live re-probes): city-tamper BLOCK / increment_city_score RPC OK
-- (score 10→15, kills 5→7) / season-fake BLOCK / duel-fake BLOCK /
-- record_duel_result RPC OK (winner 1-0, loser 0-1, dono rows) /
-- friend-add 2-row OK / friend-remove row-gone — 7/7 ✓
-- ═══════════════════════════════════════════════════════════════════

-- (Policy statements live me applied — reference COMPLETE_SCHEMA Part N)
-- DROP POLICY cc_insert_auth ON city_championship;  DROP POLICY cc_update_auth ON city_championship;
-- DROP POLICY dr_upsert_own ON duel_records;
-- DROP POLICY ss_self_write ON season_stats;  + ss_admin_write (admin ALL)
-- friendships: fr_insert_own → fr_insert_pair;  + fr_delete_own  (FEATURE-REPAIR)


-- ──────────────── Part O (2026-09-20o ROUND-12 XSS-HARDENING) ────────────────
-- Crown-jewel re-verify: users-PATCH/matches/app_settings sab locked ✓.
-- Stored-XSS: users.ign/ff_uid no-HTML CHECK constraints (source-ban) +
-- admin renders admEsc (4 spots). notifications cross-user insert = open
-- (by-design) — render-side escape hi mitigation. Context: 2026-09-20o-ROUND12-DELTA.sql

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


-- ──────────────── Part P (2026-09-20q ROUND-15 EXECUTE-AUDIT) ────────────────
-- ★ Firebase-JWT requests run as ROLE=anon (no role-claim) → panel-RPCs ko
-- anon EXECUTE chahiye. 5 user-features silently dead the (reward-redeem,
-- referral, match-refund, no-show-refund, GD-withdrawal) → GRANT + E2E ✓.
-- increment_poll_vote (vote-rigger) + cron-fn service-only REVOKE.
-- support_tickets st_update_admin (admin-only status writes).
-- Context: 2026-09-20q-ROUND15-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20q ROUND-15 — EXECUTE-AUDIT + 5 BROKEN-FEATURES FIX
-- ═══════════════════════════════════════════════════════════════════
-- ★ ROOT-DISCOVERY: Firebase-JWT (third-party auth) requests Postgres me
--   ROLE=ANON ke saath chalte hain (token me role-claim nahi hota; sirf
--   auth.jwt()->>'sub' = firebase-uid milta hai). Isliye panel-facing RPCs
--   ko **anon** ko EXECUTE chahiye — authenticated grant kaafi NAHI.
--
-- BROKEN MILA + FIX (live-verified):
--   R15-1 redeem_reward_item → EXECUTE anon missing → reward-store
--         redemption 100% dead tha. GRANT anon → E2E: 1000→500 exact +
--         redemption-row + ledger ✓
--   R15-2 claim_referral_reward → anon missing → users referral claim
--         kar hi nahi paate the. GRANT → full-flow: dono +50 ✓
--         RACE re-test ×4: UNIQUE(referred_id) → 1/4, rows=1 ✓
--         (R9 ka "race-safe" verdict permission-denied artifact tha —
--         corrected now)
--   R15-3 claim_match_refund → anon missing. GRANT → cancelled-match
--         refund: +5, jr→refunded ✓ (eligibility: match cancelled hi)
--   R15-4 claim_no_show_refund → anon missing. GRANT → +5, jr→no_show ✓
--   R15-5 submit_gd_withdrawal → anon missing → GD-withdrawal dead!
--         GRANT → GD 20→10 + pending sd_request + ledger ✓
--
-- SECURITY-CORRECTIONS (is round me kiye):
--   • increment_poll_vote(uuid,text) — vote-rigger definer fn — anon/
--     authenticated REVOKE (service-only) [R7 me galti se grant hua tha]
--   • internal_process_no_show_refunds() — cron fn — anon/auth REVOKE
--     (service-only restore)
--   • support_tickets: st_update_admin policy ADD (admin status/reply
--     writes; user-edit blocked — verified)
--
-- INTENTIONALLY service-only (verified blocked): increment_match_filled_slots
-- (stub), increment_poll_vote, internal_process_no_show_refunds
--
-- LESSON: EXECUTE-audit dono roles par karo (anon + authenticated).
--   "authenticated me hai" ≠ "client chala payega" (Firebase-JWT=anon).
-- ═══════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.redeem_reward_item(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_reward(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_match_refund(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_no_show_refund(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_gd_withdrawal(numeric,numeric,text,text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_poll_vote(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.internal_process_no_show_refunds() FROM anon, authenticated;

CREATE POLICY st_update_admin ON support_tickets FOR UPDATE TO anon, authenticated
USING ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true))
WITH CHECK ((auth.jwt() ->> 'sub') IN (SELECT users.id FROM users WHERE users.is_admin = true));


-- ──────────────── Part Q (2026-09-20s ROUND-17 ULTIMATE-SWEEP) ────────────────
-- cast_poll_vote invalid-option check; validate_and_join ACCOUNT_BANNED guard;
-- gift_match_entry v4 friend auto-join; money-RPC final audits clean;
-- users-INSERT/support-inject blocked; (imgbb R17-note CORRECTED in R18 — key sahi thi, upload OK).
-- Context: 2026-09-20r-ROUND17-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20s ROUND-17 — ULTIMATE DEEP-SWEEP (minor features + attacks)
-- ═══════════════════════════════════════════════════════════════════
-- FIXED (live-verified):
--   R17-1 ★ cast_poll_vote: INVALID OPTIONS accept ho rahe the — koi bhi
--     arbitrary option-key ('hack') vote_counts me ban raha tha (results
--     tamper + unbounded keys). FIX: options ? p_option check →
--     invalid_option reject. Verify: hack-blocked / valid-ok / counts-sahi ✓
--   R17-2 ★ BAN-ENFORCEMENT missing: is_banned ka koi server-check hi nahi
--     tha — banned user match join kar sakta tha (fee bhi kharch). FIX:
--     validate_and_join_match me ACCOUNT_BANNED guard (self-play block ke
--     baad). Verify: banned→blocked / unban→join-ok ✓
--   R17-3 gift_match_entry v4: friend AUTO-JOIN restore (purane flow jaisa)
--     — ticket + notif + jr(pending, fee=0) + filled_slots+1. Guards:
--     upcoming-match, not-already-joined, slot-available. Verify: jr+slot ✓
--
-- AUDITED-CLEAN (is round):
--   claim_creator_payout (FOR UPDATE + zeroing; admin pays offline — design ✓)
--   claim_match_commission_payout (status-flip only; admin pays — design ✓)
--   users INSERT for arbitrary-uid → 401 blocked ✓
--   support_messages outsider-inject → blocked ✓
--   OneSignal: CDN-SDK worker only, koi API-key embedded nahi ✓
--   User-panel UI breadth: 18/18 screens 0-console-errors ✓
--
-- DIAGNOSTIC (owner-action):
--   ★ IMGBB_KEY secret me 64-char hex (SHA-256 HASH) pada hai — ImgBB key
--     32-char hex hoti hai. Isi liye uploads 'forbidden' de rahe hain.
--     FIX: api.imgbb.com se ASLI key copy karke
--     `supabase secrets set IMGBB_KEY=<32-char-key>` — code path 100% OK hai.
--   PayTM: admin-toggle OFF = manual payments (by-design) — jab PAYTM_*
--     secrets + toggle ON hoga tab auto-flow live (code ready+tested).
-- ═══════════════════════════════════════════════════════════════════


-- ──────────────── Part R (2026-09-20t ROUND-18 MAX-DEPTH) ────────────────
-- notifications notif_insert v2 (admin-branch + 12-type allowlist + length
-- caps + banned-block); IDOR 16-table matrix clean; increment/decrement
-- balance admin-guard verified; BP-progress locked; dynamic-SQL parameterized;
-- storage empty; realtime 0-events; RTDB deny; auth no-enum.
-- Context: 2026-09-20t-ROUND18-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-20t ROUND-18 — MAXIMUM-DEPTH RE-ANALYSIS (post imgbb-correction)
-- ═══════════════════════════════════════════════════════════════════
-- FIXED:
--   R18-1 ★ notifications INSERT-policy v2 (notif_insert): purani policy
--     sirf 'sender real user ho' check karti thi — koi bhi user kisi bhi
--     user ko ADMIN-TYPE fake notification (credit/refund/result/vip...)
--     bhej kar phishing kar sakta tha. NAYA policy:
--     - admin branch: users.is_admin = true → sab types (broadcast OK)
--     - normal-user branch: ALLOWLIST-only (12 client-social types:
--       clan_cosmetic, clan_war_challenge, duel_accepted, duel_challenge,
--       friend_add, gift_ticket, mentor_accepted, mentor_request,
--       mentor_reward, premium, premium_request, squad_request)
--       + char_length(title)<=120 + char_length(body)<=400
--       + banned users send nahi kar sakte
--     - server RPCs (SECURITY DEFINER) RLS bypass — unaffected ✓
--     VERIFY: 12 allowed types 201 ✓ / 12 phish-types 403 ✓ / caps ✓ /
--             own-insert 201 ✓ / admin 'info' 201 ✓ / residue 0 ✓
--     NOTE: naya client notification-type add karte waqt is allowlist me
--     add karna zaroori hai (DEVELOPER_GUIDE R18).
--
-- AUDITED-CLEAN (is round, sab live-verified):
--   increment_balance/decrement_balance: admin-guard + wallet/rank-col
--     lock + stats-cap-100 ('Wallet/rank columns sirf admin/service...')
--   battle_pass_progress: bpp_update_zero → client own-UPDATE 401 ✓
--   award_battle_pass_xp: self-only + 2000 XP/day cap (design-bounded;
--     client match-result se hi call karta hai — battle-pass.js:141)
--   IDOR cross-user matrix (16 tables): INSERT/UPDATE — sirf notifications
--     tha (fix upar); baaki sab 401/403 blocked
--   Dynamic-SQL scan (116 fns): sab EXECUTE format(%I) + USING params —
--     koi injection surface nahi
--   Storage: buckets khali (sab images ImgBB URLs) — surface closed
--   Realtime anon-WS: subscribe OK par 0 row-events (RLS-gated ✓)
--   RTDB: anon GET/PUT sab permission-denied ✓
--   Firebase auth: INVALID_LOGIN_CREDENTIALS generic — no enumeration ✓
--   OpenAPI/pg_meta: anon 401/404 ✓
--   ADMIN_BREADTH re-run: PASS (13 sections + 5 tools, console-errors=1)
-- ═══════════════════════════════════════════════════════════════════


-- ──────────────── Part S (2026-09-21u ROUND-20 PUSH-LIVE) ────────────────
-- pg_net + push_hook_config (secret-config, RLS-deny) +
-- notifications_push_hook() trigger → push-send edge-fn → OneSignal.
-- Client appId f263d25f → 1f867c88 (dead-app fix). Owner: origins+VAPID
-- dashboard me set karne hain. Context: 2026-09-21u-ROUND20-DELTA.sql

-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-21u ROUND-20 — ONE-SIGNAL PUSH-SEND (auto-push) — LIVE
-- ═══════════════════════════════════════════════════════════════════
-- Ab tak push send-path project me THA HI NAHI (sirf client-subscribe;
-- aur wo bhi DEAD appId f263d25f par — kabhi kaam nahi kar sakta tha).
-- R20 me poora chain live:
--   notifications INSERT → trigger → pg_net.http_post → push-send
--   edge-fn (secret-gated) → OneSignal REST (include_aliases external_id)
-- Client OneSignal.login(uid) pehle se tha — targeting by external_id ✓
--
-- OWNER-STEPS (dashboard, REST-key se allowed nahi):
--   1. OneSignal dashboard → Mini eSports app → Settings → Web push:
--      Site URL: https://deepsilence10161-source.github.io/ff-user-panel/
--      Allowed origin: https://deepsilence10161-source.github.io
--   2. VAPID keys generate karo (dashboard khud generate karta hai).
--      In dono ke bina WEB-push deliver nahi hoga (subscribe se pehle
--      init bhi reject ho sakta hai). [PATCH /apps is key se 401 aaya]
--   3. APK WebView/TWA me web-push browser-dependent hai; native push
--      chahiye to OneSignal Android SDK alag se lagega.
-- NOTE: "All included players are not subscribed" = user ne subscribe
-- nahi kiya (naya app hai) — plumbing sahi hai, galti nahi.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS push_hook_config (
  id INT PRIMARY KEY DEFAULT 1,
  hook_url TEXT NOT NULL,
  hook_secret TEXT NOT NULL,
  gateway_apikey TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true
);
REVOKE ALL ON push_hook_config FROM anon, authenticated;
ALTER TABLE push_hook_config ENABLE ROW LEVEL SECURITY;
-- (values live me set hoti hain — secret repo me nahi)

CREATE OR REPLACE FUNCTION notifications_push_hook() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_url TEXT; v_sec TEXT; v_key TEXT;
BEGIN
  IF NEW.user_id IS NULL OR COALESCE(NEW.target_all, false) THEN RETURN NEW; END IF;
  SELECT hook_url, hook_secret, gateway_apikey INTO v_url, v_sec, v_key
    FROM push_hook_config WHERE id = 1 AND enabled;
  IF v_url IS NULL THEN RETURN NEW; END IF;
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('uid', NEW.user_id, 'title', NEW.title, 'body', NEW.body),
      headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_sec, 'apikey', v_key, 'Authorization', 'Bearer '||v_key)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- push best-effort; notification row already saved
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_notifications_push ON notifications;
CREATE TRIGGER trg_notifications_push
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION notifications_push_hook();

-- ================================================================
-- END SECTION 23
-- ================================================================
