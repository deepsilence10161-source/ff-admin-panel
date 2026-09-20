-- ================================================================
-- SESSION DELTA — 2026-08-26b (second pass, same day)
-- 4 items reported after testing the first 2026-08-26 delivery.
-- One genuine DB-level bug found and fixed (sponsor RPC), one
-- genuine self-inflicted client bug found and reverted (creator
-- match), one client-side hardening applies automatically (match
-- time — same fix as earlier today, now confirmed to cover the
-- "normal match create" path too), and WhatsApp remains unresolved
-- pending a fresh device-side repro from Junaid.
-- ================================================================

-- ── Item #1: "Sponsore match banate vakt error Aa raha hai" —
-- "cannot insert a non-DEFAULT value into column \"name\"" ──
-- admin_create_sponsored_match RPC (live DB)
-- Exact same class of bug creator_create_match hit and fixed on
-- 2026-08-24: matches.name is GENERATED ALWAYS AS (title) STORED —
-- Postgres forbids explicitly inserting into a GENERATED ALWAYS
-- column under any circumstances. The new admin_create_sponsored_match
-- RPC (added earlier today, 2026-08-26 first pass) listed `name`
-- explicitly in its INSERT INTO matches column list alongside `title`
-- — guaranteed to fail on every single call. Fixed by removing `name`
-- from the column list entirely (matches.name fills itself in
-- automatically from title, exactly like every other match-creation
-- path in the app). Verified live: simulated the exact call as the
-- real admin account (AdminAccount, is_admin=true) — now succeeds
-- and returns a real match_id.

-- ── Item #2: "Creator match me match banao pe click karne par kuch
-- ho hi nahi raha" (silent — no error, no success) ── User Panel,
-- features/creator-match-host.js
-- Self-inflicted regression from this morning's "hardening" (first
-- 2026-08-26 pass): added `await window.DB.auth.syncFirebaseToken(...)`
-- immediately before the RPC call, intended to guarantee a fresh
-- Bearer token. But syncFirebaseToken() does far more than refresh a
-- token — it calls firebaseUser.getIdToken(true) (a real network
-- round-trip to Firebase, force-refreshed, no timeout), then tears
-- down and rebuilds window._supa entirely (a brand new Supabase
-- client), then cleans up and re-subscribes ALL realtime channels
-- (matches, wallet, chat — everything) via an 800ms setTimeout. Awaiting
-- this directly on every single "Match Banao" click meant: (a) a slow
-- Firebase network response would leave the button just sitting there
-- indefinitely with zero feedback — exactly "click karo, kuch hota hi
-- nahi" — and (b) even on success, the entire realtime subscription
-- set was being needlessly torn down and rebuilt just to create one
-- match, a disruptive side effect for what should be a lightweight
-- pre-flight check. Reverted submitCreatorMatch() back to a plain
-- (non-async) function with no forced token re-sync — back to relying
-- on the existing onIdTokenChanged background listener, which is what
-- every other write operation in the app already relies on
-- successfully. The r.error-checking fix from two sessions ago (the
-- one that actually surfaces real permission/auth errors instead of a
-- generic message) remains in place underneath.
--
-- Given this bug existed for the last several test rounds, it's
-- plausible some or all of the earlier "permission denied for function
-- creator_create_match" reports were actually this same client-side
-- issue manifesting differently depending on timing, rather than a
-- genuine grant problem — every direct SQL-level and PostgREST-level
-- check across multiple sessions has consistently found the grant
-- itself correct.

-- ── Item #3: "Normal match banata hu... time 1-2 ghante baad set
-- karta hu lekin current time set ho jata hai automatic" ── Admin
-- Panel, js/admin-inline.js (saveTournament)
-- No new fix needed — confirmed the hardening applied earlier today
-- (explicit numeric Date construction instead of new Date(string)
-- parsing, see first 2026-08-26 delta) already covers this: saveTournament()
-- computes `mt` once, near the top of the function, from the same
-- Match Time field, and both the CREATE branch (new match) and EDIT
-- branch reuse that same `mt` value — there's only one computation
-- point, already fixed. If this still reproduces after redeploying
-- today's Admin Panel zip, it needs a fresh test with browser console
-- open (the function already logs the parsed values) so the exact
-- wrong number can be captured and traced, since Firebase RTDB (where
-- this data lives) isn't queryable through this session's tools.

-- ── Item #4: WhatsApp still not opening ── No code change, unresolved.
-- Re-searched the entire User Panel codebase again: every link-
-- generating call site (features/player-card.js, screens/profile.js,
-- js/features-user.js, js/preview-mode.js, core/utils.js's
-- openWhatsApp/_waShareUrl) consistently produces a plain
-- https://wa.me/... URL via a same-tab window.location.href
-- navigation — confirmed correct and consistent, no regression, no
-- intent:// or whatsapp:// scheme anywhere. android/.../
-- MainActivity.java's shouldOverrideUrlLoading already hands any
-- http(s) URL to Intent.ACTION_VIEW correctly. Every layer inspectable
-- from this session is clean. Needs a fresh screenshot of the actual
-- current failure (the last one seen showed a whatsapp:// scheme that
-- cannot originate from this codebase) plus confirmation that WhatsApp
-- is actually installed on the test device, to make any further
-- progress — this cannot be diagnosed further from source code alone.
-- ================================================================

-- Re-applied live (matches what's already deployed to the DB as of
-- this session):
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

  -- (name intentionally NOT listed — it's GENERATED ALWAYS AS (title))
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

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- Files touched this pass: features/creator-match-host.js (User
-- Panel — reverted the async token-sync regression). Admin Panel had
-- no code changes this pass — the sponsor fix is entirely server-side
-- (already live, see above), so AdminPanel-FIXED-v28.zip from earlier
-- today is still current.
-- ================================================================

-- ================================================================
-- ADDENDUM (same session) — WhatsApp root cause FOUND: sw.js
-- ================================================================
-- ── Item #4 resolved: "WhatsApp abhi bhi nahi khulta, sirf APK me" ──
-- User Panel, sw.js
-- The actual root cause of every WhatsApp report across the last 3+
-- sessions was never the WhatsApp link-building code after the first
-- real fix (js/fixes-v7.js's broken intent:// scheme, fixed several
-- sessions ago) — it was the service worker's caching strategy.
-- sw.js serves all app JS/CSS files (including js/fixes-v7.js, which
-- is explicitly listed in LOCAL_FILES) via stale-while-revalidate:
-- the OLD cached copy is served INSTANTLY on every single load, while
-- a background fetch silently updates the cache for the NEXT load.
-- CACHE_VER was never bumped across any of those sessions' fixes, so
-- the wrapped APK's WebView (which persists CacheStorage far more
-- durably than Chrome does for this app) kept serving its original,
-- long-stale cached copy of the broken WhatsApp code forever —
-- completely masking every genuine source fix that shipped after
-- whenever that cache was first populated on the test device.
-- Confirmed via the exact broken URL Junaid's screenshot showed
-- (whatsapp://send/?text=%EF%BF%BD%20Mini%20eSports...) matching the
-- referral-share message shape from features/growth.js's shareMsg,
-- combined with "sirf APK me hota hai, Chrome me nahi" — consistent
-- with a durable WebView cache vs. a less-persistent browser cache of
-- the same service worker.
-- Fixed: bumped CACHE_VER from 'me-v33-8-18' to 'me-v34-8-26'. This
-- forces the existing activate handler to delete the entire old cache
-- and refetch every file fresh on next load — no other code changed.
-- IMPORTANT FOR ALL FUTURE SESSIONS: any release that changes so much
-- as one file listed in sw.js's LOCAL_FILES array MUST bump CACHE_VER,
-- or the exact same "the fix doesn't seem to apply" pattern will keep
-- recurring for that file specifically, not just WhatsApp — this is a
-- general hazard for every JS fix, not a WhatsApp-specific one.
-- ================================================================

-- ================================================================
-- ADDENDUM (same session, later) — 2 new bugs found in live testing
-- of the working sponsor system, plus a WhatsApp native-side safety
-- net after exhaustive JS/Java verification found nothing broken in
-- this codebase.
-- ================================================================

-- ── Sponsor system confirmed WORKING (live screenshots) — but 2 new,
-- separate bugs found once it actually worked:
--
-- (a) Admin Panel showed "🟢 Active" on every sponsored tournament
-- card, which read as "the match is live" even for a match still an
-- hour+ from starting. Not actually a bug — d.status on
-- sponsored_tournaments is a genuinely separate concept (is this
-- sponsorship campaign running/paused/completed) from the linked
-- match's own live/upcoming/completed lifecycle (which lives on
-- matches, not here) — but the label was ambiguous next to what looks
-- like a match card. Relabeled "🟢 Active" → "🟢 Sponsorship Active"
-- and "✅ Completed" → "✅ Prizes Distributed" to remove the ambiguity,
-- and added a link next to the Match ID pointing admin to the Matches
-- tab for the real live/upcoming status. js/fa-sponsored-system.js.
--
-- (b) User Panel kept showing "⚡ Join Now" on a sponsored tournament
-- card even after the user had already joined that match — confirmed
-- via screenshot (Matches tab correctly showed "✅ Joined", but the
-- Home tab's sponsored card still offered Join Now for the same
-- match). Root cause: the sponsored card's button logic only checked
-- whether a matching match exists in memory (s.match_id && MT[s.
-- match_id]) — it never checked whether the CURRENT USER had joined
-- it, unlike every normal match card (which uses hasJ(t.id) for
-- exactly this). Applied the same hasJ() check here; shows a
-- disabled "✅ Joined" button instead. screens/home.js.

-- ── WhatsApp: exhaustive re-verification found NOTHING broken in this
-- codebase (JS or Java) — added a native-side safety net regardless.
-- Re-checked, yet again: every wa.me-generating JS call site (profile.js
-- shareRef — found to be unreachable dead code, fixed anyway as a
-- precaution; growth.js doShareReferral; fixes-v7.js's Invite & Earn
-- button; core/utils.js's openWhatsApp/_waShareUrl itself, byte for
-- byte) is clean. MainActivity.java's shouldOverrideUrlLoading was
-- re-read in full — the http(s)-prefix branch that handles wa.me
-- correctly returns before ever reaching the custom-scheme fallback
-- block, so a plain wa.me URL genuinely cannot reach the part of the
-- code that looked suspicious. Confirmed live on GitHub that the
-- deployed sw.js matches this session's fix byte for byte. Confirmed
-- via device settings that wa.me is already in WhatsApp's own
-- "8 verified links" list (so this isn't an Android App Link
-- verification problem either). Given the reported failure happens
-- "kahi se bhi" (from any button) and every traceable code path is
-- clean, added a defensive catch-all directly in
-- MainActivity.java's shouldOverrideUrlLoading: any whatsapp:// URL,
-- from ANY origin (this app's own code, a third-party SDK, or
-- anything else), is now caught first, its text= parameter extracted,
-- and resent as a proper ACTION_SEND intent addressed directly at the
-- com.whatsapp package — bypassing whatever Uri.parse()+ACTION_VIEW
-- mismatch was causing failures for that exact scheme shape. Falls
-- back to opening the universal wa.me web page if WhatsApp isn't
-- resolvable. This requires a fresh APK rebuild (GitHub Actions
-- triggers automatically on push to main) before it can be tested —
-- it cannot be verified from this session's tools, which can't
-- install or run the compiled APK.
-- ================================================================
