-- ═══════════════════════════════════════════════════════════════════
-- R29B ROUND DELTA — 2026-09-22c
-- क्षेत्र: (1) Paid join AUTO-APPROVE (status 'pending' → 'joined')
--         (2) filled_slots decrement on cancel/refund (drift fix)
-- चलाया जाना है: Supabase Mgmt API / SQL editor से
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) PAID JOIN AUTO-APPROVE ──────────────────────────────────────
-- समस्या (live-proved): validate_and_join_match paid join का पैसा तुरंत
-- काटता है, slot bhi le leta hai, room-access bhi de deta hai (get_room_
-- credentials 'pending' ko allowed maanta hai) — par row ka status
-- 'pending' likhta tha. Koi admin approval-gate hai hi nahi jo use रोके;
-- bas label 'pending' reh jata tha. Iska असली nuksaan:
--   • get_room_credentials check-in branch sirf status='joined' ko
--     'checked_in' flip karta tha → paid players kabhi checked_in nahi
--     hote the (attendance/no-show confusion)
--   • status-vocabulary असंगत (free='joined', paid='pending', Firebase-
--     echo se kabhi 'approved') — admin UI/questions te हैरान karta tha
-- Fix: paid join ab seedha status='joined' — kyonki pura flow (balance
-- deducted, slot reserved, room released) server ne vahi kar liya hota
-- hai. Ye hi असली auto-approve hai.

-- COMPLETE_SCHEMA.sql me jo दो copies hain (L2347 anchor comment वाली
-- पुरानी draft + L6386 real/active copy) — dono update honi chahiye.
-- L6386 वाली real copy hai (grant database me usi से active hai).

-- (a) REAL copy — INSERT ... 'pending' → 'joined'
-- नीचे exact block ke saath replace karna (Mgmt API string-replace नहीं
-- karta — pura CREATE OR REPLACE चलाओ; yahan sirf diff dikhaya hai):

--   INSERT INTO join_requests(user_id, match_id, entry_fee_paid, entry_type, status, ign_at_join, mode)
--   VALUES(
--     p_uid, p_match_id, p_entry_fee,
--     CASE WHEN p_currency='coins' THEN 'coin' ELSE 'sky_diamond' END,
--     'joined',                                   -- <── was 'pending'
--     COALESCE(p_join_data->>'ign', ''),
--     COALESCE(p_join_data->>'mode', 'solo')
--   ) RETURNING id INTO v_jr_id;

-- ── 2) FILLED_SLOTS DECREMENT on cancel (drift fix) ─────────────────
-- समस्या (code-proven, report R28m): cancel_match_with_refunds join rows
-- ko 'refunded'/'cancelled' karta tha par matches.filled_slots kabhi नहीं
-- घटाता था → cancelled matches/dropped players ke बाद भी filled_slots
-- uuncha reh jata tha (joins band hone lagte). Ab cancel-path par
-- dropped-paid-joins ke हिसाब से decrement hota hai.

-- main cancel_match_with_refunds body me, refund-loop ke BAAD:
--   UPDATE join_requests SET status='cancelled'
--   WHERE match_id=p_match_id AND status NOT IN ('cancelled','refunded','rejected');
-- ke तुरंत BAAD ye lines जोड़ो:
--
--   /* R29B: filled_slots sync — jo bhi rows abhi cancel/refund हुए, unki
--      गिनती घटाओ (drift रोकता है; client releaseNoShows sirf no_show घटाता hai). */
--   UPDATE matches SET filled_slots = GREATEST(
--     filled_slots - (
--       SELECT COUNT(*) FROM join_requests
--       WHERE match_id = p_match_id AND status IN ('cancelled','refunded')
--     ), 0)
--   WHERE id = p_match_id;

-- Verify (live, 2026-09-22c):
--  ✓ validate_and_join_match new join → status='joined' (ab 'pending' नहीं)
--  ✓ get_room_credentials ab 'joined' full-check-in flow l一周
--  ✓ cancel path → filled_slots कोई negative नहीं, drift घटता
-- ═══════════════════════════════════════════════════════════════════
