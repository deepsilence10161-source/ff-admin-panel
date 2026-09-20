-- ================================================================
-- SESSION DELTA — 2026-08-26
-- 4 items from live testing after 2026-08-25's delivery: match-time
-- shift bug, WhatsApp (no code issue found), creator match permission
-- (hardened further), and a full sponsor-system rebuild per explicit
-- request — sponsored tournaments no longer need a separate real
-- match to be manually linked; they now create their own real match
-- directly, same as a normal or creator match.
-- ================================================================

-- ── Item #1: Admin edited a match's time to 08:39, saved, match went
-- LIVE immediately, and reopening the edit form showed 06:39 instead
-- ── Admin Panel, js/admin-inline.js (saveTournament)
-- Traced the full save→status-calculate→edit-reload round trip:
-- getMatchStatus() (epoch-ms comparison, timezone-agnostic), the save
-- path (new Date(mts).getTime()), and the edit-reload path
-- (getFullYear/getHours/getMinutes local-time getters) were all
-- individually verified internally consistent and timezone-safe by
-- code inspection — no root cause could be conclusively identified
-- without live device access (Firebase RTDB, which this admin flow
-- writes to, isn't queryable through the tools available this
-- session). Hardened the most fragile link in the chain regardless:
-- `new Date("YYYY-MM-DDTHH:MM")` is spec-correct as local time in
-- every modern engine, but relies on the exact string being parsed
-- consistently — some Android System WebView versions have shown
-- inconsistent datetime-local string parsing under certain locale/DST
-- configurations. Replaced with explicit numeric Date construction
-- (split the string into parts, pass numbers directly to the Date
-- constructor), which removes any string-parsing ambiguity entirely.
-- Applied the same hardening in the new sponsor-match creation flow
-- (see item #4) so both match-creation paths in Admin Panel share it.

-- ── Item #2: WhatsApp still not opening ── No code change.
-- Re-confirmed: no `whatsapp://` or `intent://` scheme exists
-- anywhere in the User Panel codebase (searched thoroughly again).
-- android/.../MainActivity.java's shouldOverrideUrlLoading already
-- correctly hands any http(s) URL — including wa.me — to
-- Intent.ACTION_VIEW, which is the standard, correct native approach:
-- Android resolves it to whichever WhatsApp variant is installed, or
-- falls back to browser if neither is installed. Needs confirmation
-- from Junaid whether WhatsApp is actually installed on the specific
-- test device — if it is and this still fails, the failure is
-- happening at a layer (native WebView config, or the OS's own
-- app-link verification) that isn't visible in this repo, and would
-- need a device-side trace to diagnose further.

-- ── Item #3: "Creator match abhi bhi nahi ban paya" (permission
-- denied for function creator_create_match) ── User Panel,
-- features/creator-match-host.js
-- Re-verified server-side yet again, this time including Supabase's
-- own live security advisor (get_advisors), which explicitly confirms
-- creator_create_match IS callable by the authenticated role via
-- /rest/v1/rpc/creator_create_match — the grant is correct at the
-- exact layer PostgREST itself uses. No further server-side issue
-- found. Hardened the client instead: submitCreatorMatch() now forces
-- a fresh Firebase→Supabase token re-sync (via the existing
-- DB.auth.syncFirebaseToken) immediately before this specific RPC
-- call, removing any timing gap where a not-yet-refreshed Bearer token
-- could cause PostgREST to authenticate the request as the wrong (or
-- no) role — which would surface as exactly this "permission denied"
-- error even though the underlying grant is correct.

-- ── Item #4: Full sponsor-match system rebuild — explicit request:
-- "Sponsore match kisi existing match se link nahi karne ki jarurat na
-- pade... poora system hona chahiye sponsor aur creator match me bhi
-- jaise normal match bante hain" ── new RPC + Admin Panel
-- js/fa-sponsored-system.js + index.html, User Panel screens/home.js
-- (comment update only, logic was already forward-compatible)
--
-- New RPC: admin_create_sponsored_match(p_title, p_sponsor_name,
-- p_mode, p_max_slots, p_scheduled_at, p_first_prize, p_second_prize,
-- p_third_prize, p_prize_type, p_description, p_map) — SECURITY
-- DEFINER, admin-only (checks users.is_admin). In one atomic call it:
--   1. INSERTs a real matches row — is_sponsored=true, entry_type=
--      'free', entry_fee=0 (sponsor funds the whole pool, matching the
--      existing "Koi entry fee nahi, sirf free tournament!" copy) —
--      this row behaves exactly like any other match: same table, same
--      join flow (cJoin), same status lifecycle (upcoming→live→
--      completed), same everything.
--   2. INSERTs the matching sponsored_tournaments branding row
--      (sponsor name, prize breakdown, description), using the
--      matches.id just generated directly as match_id — no separate
--      ID-entry step exists anymore for admin to forget, which is
--      exactly what caused the "unjoinable" bug two sessions ago.
-- Full validation mirrors creator_create_match's pattern: title/
-- sponsor length, mode enum, slot range, non-negative prizes, and a
-- minimum 5-minute-in-the-future schedule check.
--
-- Admin Panel form (index.html #createSponsoredModal) replaced the old
-- "Match ID (optional/required)" text field entirely with real
-- match-hosting fields — Mode, Max Slots, Map, Match Time — so
-- creating a sponsored tournament is now a single self-contained form,
-- structurally the same shape as creating a normal match.
-- js/fa-sponsored-system.js's createSponsoredTournament() was fully
-- rewritten to call the new RPC directly via window._supa.rpc(...)
-- instead of the old rtdb-bridge push() into sponsoredTournaments
-- (which had no way to also create a matches row) — checks r.error
-- explicitly (see the same r.error-swallowing class of bug fixed in
-- creator-match-host.js last session) and maps every RPC error code to
-- a specific message.
--
-- User Panel's renderSponsoredTournaments() in screens/home.js needed
-- NO logic change — it was already written to show a real "⚡ Join Now"
-- button whenever s.match_id is populated and loaded into MT, which
-- is now guaranteed for every sponsored tournament created going
-- forward. Comment updated to reflect why the old "no match link"
-- warning branch should no longer trigger for new data.
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

  INSERT INTO matches (
    title, name, mode, entry_type, entry_fee, max_slots, filled_slots,
    prize_pool, first_prize, second_prize, third_prize, prize_type,
    map, status, scheduled_at, is_sponsored, room_status
  ) VALUES (
    p_title, p_title, p_mode, 'free', 0, p_max_slots, 0,
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

NOTIFY pgrst, 'reload schema';

-- Also re-applied this session as a defensive measure for the
-- creator_create_match permission-denied report (item #3) — PUBLIC
-- revoke + explicit re-grant + schema/config reload, in case any
-- stale grant interaction was still lingering from before:
REVOKE ALL ON FUNCTION public.creator_create_match(
  text, text, text, numeric, integer, numeric, timestamptz, numeric, numeric, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_create_match(
  text, text, text, numeric, integer, numeric, timestamptz, numeric, numeric, numeric
) TO authenticated;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- ================================================================
-- Files touched this session: js/admin-inline.js,
-- js/fa-sponsored-system.js, index.html (Admin Panel);
-- features/creator-match-host.js, screens/home.js (User Panel).
-- All passed `node -c` syntax validation before packaging.
-- ================================================================
