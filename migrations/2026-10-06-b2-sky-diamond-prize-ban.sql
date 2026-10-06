/* ============================================================================
   B2 (2026-10-06) — "Sky Diamond prize me KABHI nahi diya jata"
   ----------------------------------------------------------------------------
   User ki bug-list: "Match create me prize-type se Sky Diamond hatao
   (sky diamond kabhi prize me nahi diya jata)".

   Admin form ka dropdown pehle hi theek ho chuka tha (option hata diya gaya),
   lekin LIVE SERVER FUNCTION `publish_match_results` me ab bhi purana branch
   maujood tha:

       ELSIF v_m.prize_type IN ('sky','sky_diamond','skyDiamond')
         THEN v_currency := 'sky_diamonds';   -- users.sky_diamonds CREDIT!

   Yani prize distribution ke waqt (aur result-correction ke waqt bhi) Sky
   Diamonds credit ho sakte the — jabki Sky Diamond real money se juda hua
   hai (uska hisaab admin approval + ledger se chalta hai). Ye economy ka
   galti-tha.

   Is migration me:
     1. wo branch hata kar 'sky*' prize_type ko **Green Diamonds** par bheja
        gaya (aaj ke form ka niyam bhi yahi hai: paid/SD-entry match ka prize
        Green Diamond).
     2. legacy spelling 'coins' ko saaf taur par coins me map kiya (pehle ye
        sirf entry_type inference se coins banta tha).
     3. ek HARD GUARD joda — is function se prize ke roop me Sky Diamond
        kabhi credit ho hi na sake (future-proof).

   Rollback (agar kabhi zaroorat pade): same file me neeche wala purana text
   dobara CREATE OR REPLACE kar do — backup:
   evidence/backup-publish_match_results-before-b2.sql
   ========================================================================= */
CREATE OR REPLACE FUNCTION public.publish_match_results(p_match_id text, p_results jsonb)
 RETURNS jsonb
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

  /* ⛔ B2 (2026-10-06) — "Sky Diamond prize me KABHI nahi diya jata":
     yahan pehle ek branch tha jo prize_type IN ('sky','sky_diamond',
     'skyDiamond') par users.sky_diamonds CREDIT kar deta tha. Sky Diamond
     real money se juda hua hai (uski distribution admin ke approval +
     ledger se hoti hai), isliye prize me dena economy ka hisaab bigaadta
     hai. Ab wo branch hata diya: aise (purane) matches ka prize
     Green Diamonds me jata hai — aaj ke admin form ka niyam bhi yahi hai
     (paid / SD-entry match => prize Green Diamond). */
  IF COALESCE(v_m.prize_type,'') IN ('green_diamond','greenDiamond') THEN
    v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
  ELSIF COALESCE(v_m.prize_type,'') IN ('sky','sky_diamond','skyDiamond') THEN
    v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
  ELSIF COALESCE(v_m.prize_type,'') IN ('coin','coins','cash') THEN
    v_currency := 'coins'; v_curr_label := 'Coins';
  ELSE
    IF v_m.entry_type IN ('paid','sky_diamond','skyDiamond') THEN
      v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
    ELSE
      v_currency := 'coins'; v_curr_label := 'Coins';
    END IF;
  END IF;

  /* ⛔ B2 HARD GUARD (2026-10-06): is function se prize ke roop me Sky
     Diamond KABHI credit na ho — chahe upar ki koi bhi shaakh (branch) ho
     ya future me koi naya prize_type aaye. (wallet_transactions me bhi
     isliye hamesha coins/green_diamonds hi jayega.) */
  IF v_currency = 'sky_diamonds' THEN
    v_currency := 'green_diamonds'; v_curr_label := 'Green Diamonds';
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
$function$

/* ============================================================================
   B2 (2026-10-06) — dusra raasta: CREATOR match (user panel se banta hai)
   ----------------------------------------------------------------------------
   `creator_create_match` yahan tak SD-entry match ka prize bhi
   prize_type='sky_diamond' set kar deta tha:

       CASE WHEN p_entry_type='coins' THEN 'coins'
            WHEN p_entry_type='green_diamond' THEN 'green_diamond'
            ELSE 'sky_diamond' END

   ...aur publish par wo users.sky_diamonds credit karta (upar wale fix se
   pehle). Ab SD-entry match ka prize_type 'green_diamond' hota hai — wahi
   niyam jo admin ke paid (SD-entry) match ka hai.
   ========================================================================= */
CREATE OR REPLACE FUNCTION public.creator_create_match(p_title text, p_mode text, p_entry_type text, p_entry_fee numeric, p_max_slots integer, p_per_kill_prize numeric, p_scheduled_at timestamp with time zone, p_first_prize numeric DEFAULT 0, p_second_prize numeric DEFAULT 0, p_third_prize numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_comm_pct NUMERIC;
  v_prize_pool NUMERIC;
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

  /* ✅ BUG FIX (2026-10-04): green_diamond entry bhi allow (price type selection) */
  IF p_entry_type NOT IN ('coins', 'sky_diamond', 'green_diamond') THEN
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

  -- ✅ Creator prize pool is capped at what the match's own entry fees can
  -- plausibly cover (max_slots * entry_fee) so a creator can never promise
  -- payouts beyond what their own small-stakes match actually collects.
  v_prize_pool := COALESCE(p_first_prize,0) + COALESCE(p_second_prize,0) + COALESCE(p_third_prize,0);
  IF v_prize_pool > (p_max_slots * p_entry_fee) THEN
    RETURN jsonb_build_object('success', false, 'error', 'prize_exceeds_pool', 'max', p_max_slots * p_entry_fee);
  END IF;
  IF p_first_prize < 0 OR p_second_prize < 0 OR p_third_prize < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_prize');
  END IF;

  SELECT COUNT(*) INTO v_open_count
  FROM matches WHERE creator_uid = v_uid AND status IN ('upcoming', 'live');
  IF v_open_count >= v_max_open THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many_open_matches', 'max', v_max_open);
  END IF;

  v_match_id := 'cm_' || gen_random_uuid()::TEXT;

  -- ✅ BUG FIX (2026-08-24): "Match create nahi ho paya" for EVERY
  -- creator match attempt, no matter the input. Root cause: matches.name
  -- is a GENERATED ALWAYS column (derived from title) — Postgres hard-
  -- rejects any INSERT that explicitly supplies a value for it
  -- ("cannot insert a non-DEFAULT value into column \"name\"", error
  -- 428C9). The old INSERT explicitly listed `name` with `TRIM(p_title)`
  -- as its value — guaranteed to fail on every single call, for every
  -- creator, regardless of any of the validation above. Confirmed live
  -- via a direct simulated call. Just don't list `name` at all — it
  -- fills itself in from `title` automatically.
  -- ✅ Also added: first_prize/second_prize/third_prize, prize_pool,
  -- and prize_type — the same fields admin's own match-creation form
  -- has, now available to creators too (validated above against the
  -- match's own max possible collected entry fees).
  INSERT INTO matches (
    id, title, mode, entry_type, entry_fee, max_slots, filled_slots,
    per_kill_prize, status, scheduled_at, creator_uid, match_sub_type, created_at,
    first_prize, second_prize, third_prize, prize_pool, prize_type
  ) VALUES (
    v_match_id, TRIM(p_title), p_mode, p_entry_type, p_entry_fee, p_max_slots, 0,
    COALESCE(p_per_kill_prize, 0), 'upcoming', p_scheduled_at, v_uid, 'creator_hosted', NOW(),
    COALESCE(p_first_prize,0), COALESCE(p_second_prize,0), COALESCE(p_third_prize,0), v_prize_pool,
    /* ⛔ B2 (2026-10-06): 'sky_diamond' ENTRY wale match ka prize bhi pehle
         prize_type='sky_diamond' ban jata tha — aur publish ke waqt wo
         users ko Sky Diamond credit kar deta (jo allowed nahi: SD real
         money se juda hai, uska hisaab admin approval + ledger se chalta
         hai). Ab SD-entry match ka prize_type 'green_diamond' hota hai —
         bilkul jaise admin ke paid match ka (SD entry -> GD prize). */
         CASE WHEN p_entry_type = 'coins' THEN 'coins'
              WHEN p_entry_type = 'green_diamond' THEN 'green_diamond'
              ELSE 'green_diamond' END
  );

  /* ✅ BUG FIX (2026-10-04): commission SIRF creator-hosted SKY DIAMOND match
     par — jahan koi user sky diamond kharch kare (user ki exact requirement).
     Coin / green_diamond entry matches par KOI commission nahi. Percentage
     admin-set (creator_system.sdMatchCommissionPct) — single source of truth.
     commission_type: 'inr' = payout ledger path, 'none' = no commission. */
  IF p_entry_type = 'sky_diamond' THEN
    v_comm_pct := COALESCE((SELECT (value->>'sdMatchCommissionPct')::numeric FROM app_settings WHERE key='creator_system' LIMIT 1), 15);
    INSERT INTO creator_matches (match_id, creator_uid, commission_pct, commission_type, commission_status, created_at)
    VALUES (v_match_id, v_uid, v_comm_pct, 'inr', 'pending', NOW());
  ELSE
    INSERT INTO creator_matches (match_id, creator_uid, commission_pct, commission_type, commission_status, created_at)
    VALUES (v_match_id, v_uid, 0, 'none', 'pending', NOW());
  END IF;

  INSERT INTO notifications(user_id, type, title, body)
  SELECT follower_uid, 'creator_new_match',
    '🎮 ' || COALESCE(v_creator_ign, 'Creator') || ' ne naya match banaya!',
    TRIM(p_title) || ' — Entry: ' || p_entry_fee || (CASE WHEN p_entry_type='coins' THEN ' coins' ELSE ' 💎' END)
  FROM creator_follows WHERE creator_uid = v_uid;

  GET DIAGNOSTICS v_follower_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'match_id', v_match_id, 'notified_followers', v_follower_count);
END;
$function$
