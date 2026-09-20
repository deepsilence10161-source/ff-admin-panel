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
