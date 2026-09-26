/* ══════════════════════════════════════════════════════════════════════════
   r8-admin-gateway-shim.js   (2026-09-26d · R8 FINAL, FIX #2)

   Admin-only RPCs are no longer executable by the anon/authenticated Postgres
   roles (see migration 2026-09-26d-R8-FINAL-DB-HARDENING.sql). The Admin Panel
   reaches them through the project's trusted backend path — the Supabase Edge
   Function `admin-gateway`, which verifies the Firebase ID token on the
   server, re-checks users.is_admin in the database, and then executes the
   RPC with the service role.  No service_role key exists in this frontend.

   This shim is a transparent transport swap: it wraps the Supabase client's
   `.rpc()` so that ONLY the allow-listed admin functions go through the
   gateway. Every other RPC (all normal user/creator/cron paths) is untouched.
   Response shape is preserved exactly ({ data, error }), and a gateway
   failure is surfaced as an error — there is NO silent fallback to a direct
   client write.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Exactly the admin-only RPCs revoked in the R8 FINAL migration. */
  var GW_FNS = [
    'admin_adjust_wallet', 'admin_approve_profile', 'admin_confirm_creator_cheat',
    'admin_create_sponsored_match', 'admin_dismiss_creator_flag', 'admin_distribute_sponsored_prize',
    'admin_end_current_season', 'admin_reject_profile', 'admin_revoke_referral_bonus',
    'admin_reward_suggestion', 'admin_roll_battle_pass_season', 'admin_send_broadcast_notification',
    'admin_send_notification', 'admin_set_coins', 'admin_set_fraud_score', 'admin_sync_user_balance',
    'approve_creator_application', 'approve_premium', 'cancel_match_with_refunds', 'cancel_premium',
    'correct_match_result', 'publish_match_results', 'reject_creator_application',
    'release_eligible_commissions', 'resolve_sd_request', 'resolve_sponsored_withdrawal',
    'set_user_ban_status'
  ];
  var GW_NAME = 'admin-gateway';

  function wrapClient(client) {
    if (!client || client.__r8GatewayPatched) return client;
    try { client.__r8GatewayPatched = true; } catch (e) { return client; }
    if (typeof client.rpc !== 'function') return client;

    var origRpc = client.rpc.bind(client);

    client.rpc = function (fn, args, opts) {
      if (GW_FNS.indexOf(fn) === -1) return origRpc(fn, args, opts);

      if (!client.functions || typeof client.functions.invoke !== 'function') {
        return Promise.resolve({
          data: null,
          error: { message: 'admin-gateway: supabase-js functions.invoke unavailable' }
        });
      }

      var call;
      try {
        call = client.functions.invoke(GW_NAME, { body: { fn: fn, args: args || {} } });
      } catch (e) {
        call = Promise.reject(e);
      }

      return Promise.resolve(call).then(function (res) {
        if (res && res.error) return { data: null, error: res.error };
        return { data: res ? res.data : null, error: null };
      }, function (e) {
        return { data: null, error: { message: (e && e.message) || 'admin-gateway unreachable' } };
      });
    };

    return client;
  }

  function patchCreateClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return false;
    if (window.supabase.createClient.__r8GatewayPatched) return true;

    var orig = window.supabase.createClient;
    var patched = function () { return wrapClient(orig.apply(this, arguments)); };
    try { patched.__r8GatewayPatched = true; } catch (e) { /* ignore */ }
    window.supabase.createClient = patched;

    /* any client that was created before this shim loaded */
    if (window._supa) window._supa = wrapClient(window._supa);
    return true;
  }

  if (!patchCreateClient()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchCreateClient() || ++tries > 200) clearInterval(iv);
    }, 100);
  }

  /* supabase-init-early.js fires this when it creates its (pre-login) client,
     and syncFirebaseToken() recreates the client afterwards — both are covered
     by the createClient patch above; this listener only covers the ordering
     where the event fires before the patch is installed. */
  document.addEventListener('supabase:ready', function () {
    if (window._supa) window._supa = wrapClient(window._supa);
  });

  console.log('%c[R8 Gateway] admin-only RPCs routed via trusted backend path (' +
    GW_FNS.length + ' fns)', 'color:#00d4ff;font-weight:700');
})();
