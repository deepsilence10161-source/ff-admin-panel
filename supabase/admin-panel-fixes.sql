-- ════════════════════════════════════════════════════════════════════════════
--  MINI ESPORTS — Supabase fixes required by the Admin Panel
--  Generated: 2026-08-20   (branch arena/01a01da9-ff-admin-panel)
--
--  KAISE CHALANA HAI
--  1. Supabase Dashboard → SQL Editor → New query
--  2. Pehle SECTION 0 (diagnostics) chalao, output dekho.
--  3. Phir SECTION 1..N me se sirf wahi chalao jo diagnostics me MISSING aaye.
--     (Sab kuch idempotent hai — dobara chalane se kuch tootega nahi.)
--
--  NOTE: is project me users.id Firebase UID (text) hai. Har jagah
--  `id::text = p_uid` use kiya gaya hai taki uuid/text dono me kaam kare.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — DIAGNOSTICS (pehle yeh chalao, kuch change nahi karta)
-- ════════════════════════════════════════════════════════════════════════════

-- 0.1  Kaun se RPC functions exist hain jo admin panel call karta hai?
SELECT
  needed.fn AS function_name,
  CASE WHEN p.proname IS NULL THEN '❌ MISSING' ELSE '✅ exists' END AS status,
  pg_get_function_identity_arguments(p.oid) AS current_signature
FROM (VALUES
  ('approve_premium'), ('cancel_premium'), ('increment_balance'), ('decrement_balance'),
  ('resolve_sd_request'), ('resolve_sponsored_withdrawal'), ('set_user_ban_status'),
  ('admin_approve_profile'), ('admin_reject_profile'), ('admin_send_notification'),
  ('admin_send_broadcast_notification'), ('admin_set_coins'), ('admin_sync_user_balance'),
  ('admin_set_fraud_score'), ('admin_dismiss_creator_flag'), ('admin_confirm_creator_cheat'),
  ('approve_creator_application'), ('reject_creator_application'),
  ('release_eligible_commissions'), ('increment_poll_vote'), ('contribute_to_squad_bank'),
  ('track_mission_progress')
) AS needed(fn)
LEFT JOIN pg_proc p ON p.proname = needed.fn
  AND p.pronamespace = 'public'::regnamespace
ORDER BY status DESC, function_name;

-- 0.2  Kaun si tables exist hain?
SELECT
  needed.t AS table_name,
  CASE WHEN c.table_name IS NULL THEN '❌ MISSING' ELSE '✅ exists' END AS status
FROM (VALUES
  ('users'), ('matches'), ('join_requests'), ('sd_requests'), ('premium_requests'),
  ('profile_requests'), ('profile_updates'), ('team_requests'), ('notifications'),
  ('admin_activity_log'), ('admins'), ('app_settings'), ('wallet_transactions'),
  ('match_results'), ('mission_progress'), ('sponsored_tournaments'), ('ff_uid_index'),
  ('wallet_audit_log'), ('disputes'), ('vouchers'), ('creator_codes'), ('referrals')
) AS needed(t)
LEFT JOIN information_schema.tables c
  ON c.table_schema = 'public' AND c.table_name = needed.t
ORDER BY status DESC, table_name;

-- 0.3  Columns jo admin panel likhta/padhta hai — sd_requests
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sd_requests'
ORDER BY ordinal_position;

-- 0.4  Columns — premium_requests
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'premium_requests'
ORDER BY ordinal_position;

-- 0.5  Columns — admin_activity_log  (code do naam use karta hai: action AUR action_type)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'admin_activity_log'
ORDER BY ordinal_position;

-- 0.6  users me premium columns hain?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('premium_level','premium_expires','premium_tier','premium_expires_at',
                      'coins','sky_diamonds','green_diamonds','sponsored_winnings','ff_uid','ign')
ORDER BY column_name;

-- 0.7  app_settings me live_config ka current ad reward kya hai?
SELECT key,
       value->>'adCoinsPerWatch' AS ad_coins_per_watch,
       value->>'adDailyLimit'    AS ad_daily_limit
FROM app_settings
WHERE key IN ('live_config','ad_rewards');


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — approve_premium()   ⚠️ SABSE ZAROORI
--   Yeh RPC na hone par "Premium request accept" par error aata hai.
--   Admin panel call: rpc('approve_premium', {p_uid, p_tier, p_days})
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. Agar users me premium columns nahi hain to bana do
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS premium_level   int         DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS premium_expires timestamptz;

CREATE OR REPLACE FUNCTION public.approve_premium(
  p_uid  text,
  p_tier int,
  p_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := false;
  v_new_exp  timestamptz;
BEGIN
  -- Sirf admin hi call kar sake
  SELECT EXISTS (
    SELECT 1 FROM public.admins a
    WHERE a.uid::text = auth.uid()::text
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;

  IF p_tier IS NULL OR p_tier < 1 OR p_tier > 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_tier');
  END IF;

  -- Agar premium abhi active hai to usi ke upar din add karo, warna aaj se
  SELECT GREATEST(COALESCE(u.premium_expires, now()), now()) + make_interval(days => COALESCE(p_days, 30))
    INTO v_new_exp
  FROM public.users u
  WHERE u.id::text = p_uid;

  IF v_new_exp IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  UPDATE public.users
     SET premium_level   = p_tier,
         premium_expires = v_new_exp,
         updated_at      = now()
   WHERE id::text = p_uid;

  RETURN jsonb_build_object('success', true, 'tier', p_tier, 'expires_at', v_new_exp);
END;
$$;

REVOKE ALL     ON FUNCTION public.approve_premium(text,int,int) FROM public;
GRANT  EXECUTE ON FUNCTION public.approve_premium(text,int,int) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — cancel_premium()  (admin panel me "cancel premium" button ke liye)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cancel_premium(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admins a WHERE a.uid::text = auth.uid()::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;
  UPDATE public.users
     SET premium_level = 0, premium_expires = NULL, updated_at = now()
   WHERE id::text = p_uid;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_premium(text) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — increment_balance / decrement_balance
--   Poore panel me 17+ jagah use hote hain (SD approve, GD bonus, refunds,
--   mission rewards, ad coins). Agar 0.1 me MISSING aaye to yeh chalao.
--   p_col allowed: coins | sky_diamonds | green_diamonds | sponsored_winnings
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.increment_balance(
  p_uid text, p_col text, p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_new numeric;
BEGIN
  IF p_col NOT IN ('coins','sky_diamonds','green_diamonds','sponsored_winnings') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_column: ' || p_col);
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
  END IF;

  EXECUTE format(
    'UPDATE public.users SET %I = COALESCE(%I,0) + $1, updated_at = now() WHERE id::text = $2 RETURNING %I',
    p_col, p_col, p_col
  ) INTO v_new USING p_amount, p_uid;

  IF v_new IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'new_balance', v_new);
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_balance(text,text,numeric) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.decrement_balance(
  p_uid text, p_col text, p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_cur numeric; v_new numeric;
BEGIN
  IF p_col NOT IN ('coins','sky_diamonds','green_diamonds','sponsored_winnings') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_column: ' || p_col);
  END IF;

  EXECUTE format('SELECT COALESCE(%I,0) FROM public.users WHERE id::text = $1 FOR UPDATE', p_col)
    INTO v_cur USING p_uid;

  IF v_cur IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;
  IF v_cur < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance', 'balance', v_cur);
  END IF;

  EXECUTE format('UPDATE public.users SET %I = %I - $1, updated_at = now() WHERE id::text = $2 RETURNING %I',
                 p_col, p_col, p_col)
    INTO v_new USING p_amount, p_uid;

  RETURN jsonb_build_object('success', true, 'new_balance', v_new);
END;
$$;
GRANT EXECUTE ON FUNCTION public.decrement_balance(text,text,numeric) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — sd_requests: creator_code column
--   Purani "Wallet Requests" table me ek "Creator Code" column tha. Ab wahi
--   column Sky Diamond tab me aa gaya hai. Column exist nahi karta to yeh
--   chalao, warna wo column hamesha "—" dikhayega.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sd_requests ADD COLUMN IF NOT EXISTS creator_code text;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — premium_requests: UTR / screenshot columns
--   Premium tab ab UTR aur Proof column dikhata hai. Agar user panel yeh
--   fields bhejta hai lekin column nahi hai to insert fail hoga.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.premium_requests ADD COLUMN IF NOT EXISTS upi_ref        text;
ALTER TABLE public.premium_requests ADD COLUMN IF NOT EXISTS screenshot_url text;
ALTER TABLE public.premium_requests ADD COLUMN IF NOT EXISTS ff_uid         text;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — admin_activity_log: `action` vs `action_type`
--   Codebase me DONO naam use hote hain (admin-inline.js `action`,
--   admin-activity-log.js / v22 `action_type`). Jo column missing hoga uske
--   insert 42703 se fail honge. Dono rakho — sabse safe.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.admin_activity_log (
  id          bigserial PRIMARY KEY,
  admin_uid   text,
  admin_email text,
  action      text,
  action_type text,
  target_uid  text,
  target_ref  text,
  details     jsonb,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.admin_activity_log ADD COLUMN IF NOT EXISTS action      text;
ALTER TABLE public.admin_activity_log ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE public.admin_activity_log ADD COLUMN IF NOT EXISTS admin_email text;
ALTER TABLE public.admin_activity_log ADD COLUMN IF NOT EXISTS target_ref  text;

-- details kabhi string, kabhi object bheja jaata hai — jsonb dono le lega
-- (JSON.stringify wali string bhi valid jsonb hai).


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — mission_progress + track_mission_progress()
--   ⚠️ YEH "Daily Missions baar-baar khulti hai" BUG KA BACKEND HISSA HAI.
--
--   User panel claim flag `claimed_daily_login_<date>` likhta hai. Agar
--   mission_progress table / RPC nahi hai (ya progress round-trip nahi hota)
--   to panel ko lagta hai claim hua hi nahi → auto-claim → re-render → loop.
--   Frontend fix bhi zaroori hai (handover doc dekho), lekin backend yeh hai.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mission_progress (
  id           bigserial PRIMARY KEY,
  user_id      text NOT NULL,
  mission_key  text NOT NULL,
  period       text NOT NULL,            -- 'YYYY-MM-DD' (daily) ya 'w<week>' (weekly)
  progress     numeric DEFAULT 0,
  target       numeric DEFAULT 1,
  claimed      boolean DEFAULT false,
  claimed_at   timestamptz,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, mission_key, period)
);
ALTER TABLE public.mission_progress ADD COLUMN IF NOT EXISTS claimed    boolean DEFAULT false;
ALTER TABLE public.mission_progress ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS mission_progress_user_period_idx
  ON public.mission_progress (user_id, period);

ALTER TABLE public.mission_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_progress_select_own ON public.mission_progress;
CREATE POLICY mission_progress_select_own ON public.mission_progress
  FOR SELECT USING (user_id = auth.uid()::text);
-- INSERT/UPDATE jaan-boojh kar client ko NAHI diya — sirf RPC se (anti-cheat)

-- progress kabhi peeche nahi jaayega (GREATEST guard)
CREATE OR REPLACE FUNCTION public.track_mission_progress(
  p_mission_key text,
  p_period      text,
  p_progress    numeric,
  p_target      numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid text := auth.uid()::text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  INSERT INTO public.mission_progress (user_id, mission_key, period, progress, target, updated_at)
  VALUES (v_uid, p_mission_key, p_period, COALESCE(p_progress,0), COALESCE(p_target,1), now())
  ON CONFLICT (user_id, mission_key, period) DO UPDATE
    SET progress   = GREATEST(public.mission_progress.progress, EXCLUDED.progress),
        target     = EXCLUDED.target,
        updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.track_mission_progress(text,text,numeric,numeric) TO authenticated;

-- ✅ NAYA: atomic "claim" RPC. User panel ko iski zaroorat hai (handover doc
--    dekho) — ek hi mission do baar claim na ho sake, aur claim flag
--    reliably persist ho (yahi loop rokta hai).
CREATE OR REPLACE FUNCTION public.claim_mission_reward(
  p_mission_key text,
  p_period      text,
  p_coins       numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       text := auth.uid()::text;
  v_already   boolean := false;
  v_new_coins numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF p_coins IS NULL OR p_coins < 0 OR p_coins > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reward');
  END IF;

  -- Row ko lock karo (ya bana do) taaki double-claim race na ho
  INSERT INTO public.mission_progress (user_id, mission_key, period, progress, target, claimed, updated_at)
  VALUES (v_uid, p_mission_key, p_period, 1, 1, false, now())
  ON CONFLICT (user_id, mission_key, period) DO NOTHING;

  SELECT mp.claimed INTO v_already
  FROM public.mission_progress mp
  WHERE mp.user_id = v_uid
    AND mp.mission_key = p_mission_key
    AND mp.period = p_period
  FOR UPDATE;

  IF COALESCE(v_already, false) THEN
    -- Idempotent: dobara claim par coins nahi milenge, par success:true bhejo
    -- taaki UI "claimed" state par settle ho jaaye aur loop na bane.
    SELECT u.coins INTO v_new_coins FROM public.users u WHERE u.id::text = v_uid;
    RETURN jsonb_build_object('success', true, 'already_claimed', true, 'awarded', 0, 'coins', v_new_coins);
  END IF;

  UPDATE public.mission_progress
     SET claimed = true, claimed_at = now(), progress = GREATEST(progress, 1), updated_at = now()
   WHERE user_id = v_uid AND mission_key = p_mission_key AND period = p_period;

  UPDATE public.users
     SET coins = COALESCE(coins,0) + p_coins, updated_at = now()
   WHERE id::text = v_uid
   RETURNING coins INTO v_new_coins;

  -- Audit trail — dynamic EXECUTE isliye ki agar wallet_transactions table
  -- exist hi na kare to function parse-time par fail na ho.
  BEGIN
    IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
      EXECUTE 'INSERT INTO public.wallet_transactions (user_id, currency, txn_type, amount, reason, created_at)
               VALUES ($1, ''coins'', ''credit'', $2, $3, now())'
        USING v_uid, p_coins, 'mission_reward:' || p_mission_key;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- audit log fail ho to reward mat roko
  END;

  RETURN jsonb_build_object('success', true, 'already_claimed', false, 'awarded', p_coins, 'coins', v_new_coins);
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward(text,text,numeric) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — app_settings: ad reward ko sahi jagah set karo
--   Admin panel ka "Ad Reward Settings" card ab live_config me likhta hai
--   (pehle wo dead key 'ad_rewards' me likhta tha jo koi nahi padhta).
--   Yeh query current value seed/fix kar deti hai — 10 coins per ad, 5/day.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('live_config', jsonb_build_object('adCoinsPerWatch', 10, 'adDailyLimit', 5), now())
ON CONFLICT (key) DO UPDATE
  SET value = public.app_settings.value
              || jsonb_build_object('adCoinsPerWatch', 10, 'adDailyLimit', 5),
      updated_at = now();

-- Verify:
-- SELECT value->>'adCoinsPerWatch', value->>'adDailyLimit' FROM app_settings WHERE key='live_config';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — ff_uid_index (profile approve ke liye)
--   approveProfile / approveProfileUpdate `ffUIDIndex/{ffUid} = uid` likhte
--   hain, jo bridge se ff_uid_index table pe jaata hai.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ff_uid_index (
  ff_uid     text PRIMARY KEY,
  uid        text NOT NULL,
  user_id    text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.ff_uid_index ADD COLUMN IF NOT EXISTS user_id text;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — sanity check (fix ke baad chalao)
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT public.approve_premium('PUT_A_REAL_FIREBASE_UID_HERE', 2, 30);
-- SELECT public.increment_balance('PUT_A_REAL_FIREBASE_UID_HERE', 'coins', 10);
-- SELECT id, ign, premium_level, premium_expires, coins
--   FROM users WHERE id::text = 'PUT_A_REAL_FIREBASE_UID_HERE';
