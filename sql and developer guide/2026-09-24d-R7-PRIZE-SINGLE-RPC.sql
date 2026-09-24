-- ════════════════════════════════════════════════════════════════════
-- 2026-09-24d  R7 FOLLOW-UP (2) — PRIZE DISTRIBUTION = ONE ATOMIC RPC
-- --------------------------------------------------------------------
-- Idempotent · applies to public schema · append-only
--
--   publish_match_results(p_match_id, p_results)
--     Admin (JWT is_admin) result-publish aur prize-distribution ka EKHI
--     atomic path. Server KHUD prize compute karta hai (matches.* prize
--     columns se) — client sirf {user_id, rank, kills} bhejta hai, koi
--     amount/currency NAHI. captain_pays team aggregation bhi server-side
--     (join_requests.fee_type/captain_uid). Wallet credit + wallet_transactions
--     ledger + join_requests + match_results + users stats + season_stats +
--     platform_earnings + notifications — sab isi RPC ke andar, one txn.
--
--   Correction mode auto-detect: match.result_published_at set hai to per-target
--     delta-adjust (credit/debit, floor 0) + correction ledger row.
--   Double-publish idempotent: matches FOR UPDATE + per-target delta = 0 → no res.
--
--   Replej karता hai (client side se hटाने वाला multi-path):
--     admin-inline-c.js publishResults      (Firebase txn-first + bridge + 4 RPC + 3 insert)
--     features/fa22-match-result.js mrPublishResults + distributePrizesV2 (orphan)
--     admin-supabase-sync.js _wrapPublishResults (post-sync ab inert)
-- ════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.publish_match_results(
    p_match_id text,
    p_results  jsonb          -- [{user_id, rank, kills}, ...] — sirf ye 3 fields server maanta hai
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      TEXT := auth.jwt() ->> 'sub';
  v_is_service  BOOLEAN := (current_setting('role', true) = 'service_role');
  v_is_admin    BOOLEAN;
  v_m           RECORD;
  v_name        TEXT;
  v_currency    TEXT;          -- coins | sky_diamonds | green_diamonds
  v_curr_label  TEXT;
  v_is_corr     BOOLEAN;
  v_first       NUMERIC; v_second NUMERIC; v_third NUMERIC; v_perk NUMERIC; v_entry NUMERIC;
  item          jsonb;
  v_uid         TEXT; v_rank INT; v_kills INT;
  v_join        RECORD;
  v_rank_prize  NUMERIC; v_kill_prize NUMERIC; v_total NUMERIC;
  v_cap         TEXT;          -- jisko paisa credit hoga (captain_pays member → captain)
  v_earn        NUMERIC;       -- is uid ka effective money
  v_capagg      jsonb := '{}'::jsonb;  -- target_uid -> total money
  v_plist       jsonb := '[]'::jsonb;  -- [{uid,rank,kills,cap}]
  v_old         jsonb := '{}'::jsonb;  -- target -> old prize_earned
  v_oldkills    jsonb := '{}'::jsonb;  -- uid -> old kills
  k             TEXT;
  v_delta       NUMERIC;
  v_kill_delta  INT;
  v_rp          INT;
  v_is_winner   BOOLEAN;
  v_month       TEXT := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY_MM');
  v_pub         INT := 0; v_corr INT := 0; v_skip INT := 0; v_win_n INT := 0;
BEGIN
  /* ── Authorization ── */
  IF NOT v_is_service THEN
    IF v_caller IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
    SELECT is_admin INTO v_is_admin FROM users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Admin only');
    END IF;
  END IF;

  IF jsonb_typeof(p_results) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_results must be an array');
  END IF;

  SELECT * INTO v_m FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  END IF;

  v_name       := COALESCE(v_m.name, v_m.title, p_match_id);
  v_is_corr    := (v_m.result_published_at IS NOT NULL);
  v_first      := COALESCE(v_m.first_prize, 0);
  v_second     := COALESCE(v_m.second_prize, 0);
  v_third      := COALESCE(v_m.third_prize, 0);
  v_perk       := COALESCE(v_m.per_kill_prize, 0);
  v_entry      := COALESCE(v_m.entry_fee, 0);

  /* currency: prize_type first, then entry_type inference, then coins */
  IF COALESCE(v_m.prize_type,'') IN ('green_diamond','greenDiamond') THEN
    v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
  ELSIF COALESCE(v_m.prize_type,'') IN ('sky','sky_diamond','skyDiamond') THEN
    v_currency := 'sky_diamonds'; v_curr_label := 'Sky Diamonds';
  ELSIF COALESCE(v_m.prize_type,'') IN ('coin','cash') THEN
    v_currency := 'coins'; v_curr_label := 'Coins';
  ELSE
    IF v_m.entry_type IN ('paid','sky_diamond','skyDiamond') THEN
      v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
    ELSE
      v_currency := 'coins'; v_curr_label := 'Coins';
    END IF;
  END IF;

  /* ── Pass 1: compute prizes + captain aggregation (server-authoritative) ── */
  FOR item IN SELECT jsonb_array_elements(p_results) LOOP
    v_uid  := item->>'user_id';
    v_rank := GREATEST(COALESCE((item->>'rank')::int, 0), 0);
    v_kills := GREATEST(COALESCE((item->>'kills')::int, 0), 0);
    IF v_uid IS NULL OR v_uid = '' THEN v_skip := v_skip + 1; CONTINUE; END IF;

    SELECT * INTO v_join FROM join_requests
    WHERE match_id = p_match_id AND user_id = v_uid;
    IF v_join IS NULL THEN v_skip := v_skip + 1; CONTINUE; END IF;

    v_rank_prize := CASE WHEN v_rank = 1 THEN v_first
                         WHEN v_rank = 2 THEN v_second
                         WHEN v_rank = 3 THEN v_third
                         ELSE 0 END;
    v_kill_prize := v_kills * v_perk;
    v_total      := v_rank_prize + v_kill_prize;

    /* captain_pays member → paisa captain ko */
    v_cap := v_uid;
    IF v_join.fee_type = 'captain_pays'
       AND v_join.captain_uid IS NOT NULL
       AND v_join.captain_uid <> v_uid THEN
      v_cap := v_join.captain_uid;
    END IF;

    v_capagg := jsonb_set(v_capagg, ARRAY[v_cap],
      to_jsonb(COALESCE((v_capagg->>v_cap)::numeric, 0) + v_total), true);

    v_plist := v_plist || jsonb_build_object(
      'uid', v_uid, 'rank', v_rank, 'kills', v_kills, 'cap', v_cap);
  END LOOP;

  /* ── Pass 0 (read olds BEFORE any write) ── */
  FOR k IN SELECT jsonb_object_keys(v_capagg) LOOP
    SELECT COALESCE(prize_earned, 0) INTO v_delta
      FROM match_results WHERE match_id = p_match_id AND user_id = k;
    v_old := jsonb_set(v_old, ARRAY[k], to_jsonb(v_delta), true);
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(v_plist) LOOP
    SELECT COALESCE(kills, 0) INTO v_kill_delta
      FROM match_results WHERE match_id = p_match_id AND user_id = (item->>'uid');
    v_oldkills := jsonb_set(v_oldkills, ARRAY[item->>'uid'], to_jsonb(v_kill_delta), true);
  END LOOP;

  /* ── Pass 2: money per target (credit / correction delta) ── */
  FOR k IN SELECT jsonb_object_keys(v_capagg) LOOP
    v_total := (v_capagg->>k)::numeric;
    v_delta := v_total - COALESCE((v_old->>k)::numeric, 0);

    IF v_is_corr THEN
      IF v_delta <> 0 THEN
        IF v_currency = 'coins' THEN
          UPDATE users SET coins = GREATEST(COALESCE(coins,0) + v_delta, 0),
                           total_winnings = GREATEST(COALESCE(total_winnings,0) + v_delta, 0)
          WHERE id = k;
        ELSIF v_currency = 'sky_diamonds' THEN
          UPDATE users SET sky_diamonds = GREATEST(COALESCE(sky_diamonds,0) + v_delta, 0),
                           total_winnings = GREATEST(COALESCE(total_winnings,0) + v_delta, 0)
          WHERE id = k;
        ELSE
          UPDATE users SET green_diamonds = GREATEST(COALESCE(green_diamonds,0) + v_delta, 0),
                           total_winnings = GREATEST(COALESCE(total_winnings,0) + v_delta, 0)
          WHERE id = k;
        END IF;
        INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, ref_id, created_at)
        VALUES (k, v_currency,
                CASE WHEN v_delta > 0 THEN 'correction_credit' ELSE 'correction_debit' END,
                ABS(v_delta), 'result_correction', 'approved', p_match_id, NOW());

        INSERT INTO notifications(user_id, type, title, body, is_read, created_at, ref_id)
        VALUES (k, 'correction',
                '🔧 Result Correction',
                v_name || ' — ' || ABS(v_delta) || ' ' || v_curr_label || ' ' ||
                CASE WHEN v_delta > 0 THEN 'add kiya gaya.' ELSE 'adjust kiya gaya.' END,
                false, NOW(), p_match_id);
        v_corr := v_corr + 1;
      END IF;
    ELSE
      IF v_total > 0 THEN
        IF v_currency = 'coins' THEN
          UPDATE users SET coins = COALESCE(coins,0) + v_total,
                           total_winnings = COALESCE(total_winnings,0) + v_total
          WHERE id = k;
        ELSIF v_currency = 'sky_diamonds' THEN
          UPDATE users SET sky_diamonds = COALESCE(sky_diamonds,0) + v_total,
                           total_winnings = COALESCE(total_winnings,0) + v_total
          WHERE id = k;
        ELSE
          UPDATE users SET green_diamonds = COALESCE(green_diamonds,0) + v_total,
                           total_winnings = COALESCE(total_winnings,0) + v_total
          WHERE id = k;
        END IF;
        INSERT INTO wallet_transactions(user_id, currency, txn_type, amount, reason, status, ref_id, created_at)
        VALUES (k, v_currency, 'match_win', v_total, 'match_prize', 'approved', p_match_id, NOW());
        v_win_n := v_win_n + 1;
      END IF;
    END IF;
  END LOOP;

  /* ── Pass 3: per-player stats + match_results + join_requests + notifications ── */
  FOR item IN SELECT * FROM jsonb_array_elements(v_plist) LOOP
    v_uid   := item->>'uid';
    v_rank  := (item->>'rank')::int;
    v_kills := (item->>'kills')::int;
    v_earn  := COALESCE((v_capagg->>v_uid)::numeric, 0);   -- member -> 0
    v_is_winner := v_earn > 0;

    IF NOT v_is_corr THEN
      v_rp := CASE WHEN v_rank = 1 THEN 25 WHEN v_rank = 2 THEN 15
                   WHEN v_rank = 3 THEN 10 WHEN v_rank <= 10 THEN 5 ELSE 1 END
              + LEAST(v_kills, 3);
      IF NOT v_is_winner THEN v_rp := 1; END IF;

      UPDATE users SET
        total_kills   = COALESCE(total_kills,0) + v_kills,
        total_matches = COALESCE(total_matches,0) + 1,
        total_wins    = COALESCE(total_wins,0) + CASE WHEN v_is_winner AND v_rank = 1 THEN 1 ELSE 0 END,
        win_streak    = CASE WHEN v_is_winner THEN COALESCE(win_streak,0) + 1 ELSE 0 END,
        rank_points   = COALESCE(rank_points,0) + v_rp
      WHERE id = v_uid;

      INSERT INTO season_stats(month_key, user_id, kills, matches, wins)
      VALUES (v_month, v_uid, v_kills, 1, CASE WHEN v_rank = 1 THEN 1 ELSE 0 END)
      ON CONFLICT (month_key, user_id) DO UPDATE SET
        kills   = season_stats.kills + EXCLUDED.kills,
        matches = season_stats.matches + 1,
        wins    = season_stats.wins + EXCLUDED.wins,
        updated_at = NOW();

      IF v_is_winner THEN
        INSERT INTO notifications(user_id, type, title, body, is_read, created_at, ref_id)
        VALUES (v_uid, 'result', '🏆 Match Result!',
                v_name || ' — jeete! ' || v_earn || ' ' || v_curr_label ||
                ' wallet mein add ho gaye. (Rank #' || v_rank || ', ' || v_kills || ' kills)',
                false, NOW(), p_match_id);
      ELSE
        INSERT INTO notifications(user_id, type, title, body, is_read, created_at, ref_id)
        VALUES (v_uid, 'result', '📋 Match Result',
                v_name || ' ka result publish ho gaya! Rank: #' || v_rank ||
                ', Kills: ' || v_kills || '.',
                false, NOW(), p_match_id);
      END IF;

      /* platform earnings (first publish only) — entry fee server-side */
      INSERT INTO platform_earnings(match_id, entry_fee, prize_given, profit, user_id)
      VALUES (p_match_id, v_entry, v_earn, v_entry - v_earn, v_uid);

    ELSE
      /* correction: sirf kills delta (money delta upar target-loop me) */
      v_kill_delta := v_kills - COALESCE((v_oldkills->>v_uid)::int, 0);
      IF v_kill_delta <> 0 THEN
        UPDATE users SET total_kills = GREATEST(COALESCE(total_kills,0) + v_kill_delta, 0)
        WHERE id = v_uid;
      END IF;
    END IF;

    /* match_results (authoritative result row) */
    INSERT INTO match_results(match_id, user_id, placement, kills, rank,
                              kill_prize, rank_prize, prize_earned, prize)
    VALUES (p_match_id, v_uid, v_rank, v_kills, v_rank,
            v_kills * v_perk,
            CASE WHEN v_rank = 1 THEN v_first WHEN v_rank = 2 THEN v_second
                 WHEN v_rank = 3 THEN v_third ELSE 0 END,
            v_earn, v_earn)
    ON CONFLICT (match_id, user_id) DO UPDATE SET
      placement   = EXCLUDED.placement,
      kills       = EXCLUDED.kills,
      rank        = EXCLUDED.rank,
      kill_prize  = EXCLUDED.kill_prize,
      rank_prize  = EXCLUDED.rank_prize,
      prize_earned = EXCLUDED.prize_earned,
      prize       = EXCLUDED.prize;

    /* join_requests final state */
    UPDATE join_requests SET status = 'completed', placement = v_rank,
                             prize_earned = v_earn, kills = v_kills
    WHERE match_id = p_match_id AND user_id = v_uid;

    v_pub := v_pub + 1;
  END LOOP;

  /* matches → completed + result_published_at (idempotent) */
  UPDATE matches SET status = 'completed', updated_at = NOW(),
                     result_published_at = COALESCE(result_published_at, NOW())
  WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'ok', true,
    'players', v_pub,
    'winners', v_win_n,
    'corrections', v_corr,
    'currency', v_currency,
    'was_correction', v_is_corr,
    'skipped', v_skip);
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_match_results(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_match_results(text, jsonb) TO authenticated, service_role;

COMMIT;
