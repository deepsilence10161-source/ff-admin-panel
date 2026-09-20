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
