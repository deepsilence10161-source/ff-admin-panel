/* ══════════════════════════════════════════════════════════════════════════
   admin-gateway  —  Supabase Edge Function  (deploy: verify_jwt = false)

   R8 FINAL / FIX #2 trusted backend path for the 27 admin-only RPCs that are
   no longer executable by the anon/authenticated Postgres roles.

   Security model
   ──────────────
   1. The caller must present a Firebase ID token (Authorization: Bearer …).
      The token is verified SERVER-SIDE against Google Identity Toolkit
      (accounts:lookup) — a forged/expired token resolves to no uid → 401.
      The token is never trusted by decoding it locally.
   2. The resolved uid is sent to admin_gateway_exec() as p_actor, where the
      database re-checks users.is_admin = true. Non-admins get "Admin only"
      → 403. The client can never supply or influence the actor identity.
   3. Only allow-listed function names are dispatchable (enforced again inside
      admin_gateway_exec). No arbitrary SQL, no arbitrary function.
   4. The RPC executes with the SERVICE ROLE via admin_gateway_exec() (which is
      itself service-role-only). Failures are surfaced, never swallowed.

   No secret reaches the frontend: the service_role key lives only in this
   function's environment (SUPABASE_SERVICE_ROLE_KEY, auto-injected by the
   platform). The Firebase web API key below is public (it already ships in
   the app's frontend bundle) and grants no privileges by itself.

   Zero external imports on purpose: this function is deployed via the
   Management API body upload (no bundler), so it uses only Web/Deno built-ins.
   ══════════════════════════════════════════════════════════════════════════ */

const FIREBASE_WEB_API_KEY = 'AIzaSyA-v9AYigDrg96D_fos0vOW3wU2GY2UYec';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/* Server-side Firebase ID-token → uid resolution (no local JWT parsing). */
async function resolveUid(idToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const uid = data?.users?.[0]?.localId;
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) return json({ error: 'missing_token' }, 401);

    const uid = await resolveUid(idToken);
    if (!uid) return json({ error: 'invalid_token' }, 401);

    const raw = await req.text();
    let body: { fn?: unknown; args?: unknown } | null = null;
    try { body = JSON.parse(raw || '{}'); } catch (_e) { body = null; }

    const fn = body?.fn;
    const args = (body?.args ?? {}) as Record<string, unknown>;
    if (typeof fn !== 'string' || fn.length === 0) {
      return json({ error: 'missing_fn' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json({ error: 'gateway_not_configured' }, 500);

    /* Service-role call into the DB wrapper (service key as Authorization, as
       PostgREST takes the effective role from the Authorization header). */
    const rpcRes = await fetch(`${url}/rest/v1/rpc/admin_gateway_exec`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_fn: fn, p_args: args, p_actor: uid }),
    });

    const text = await rpcRes.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch (_e) { payload = { error: text.slice(0, 300) }; }

    if (!rpcRes.ok) {
      return json({ error: 'rpc_http_' + rpcRes.status, detail: payload }, 502);
    }

    const obj = (payload ?? {}) as Record<string, unknown>;
    const err = typeof obj.error === 'string' ? obj.error : '';
    if (err === 'Admin only' || err === 'not_authorized') {
      return json(obj, 403);
    }
    if (err === 'fn_not_allowed' || err === 'fn_not_found') {
      return json(obj, 400);
    }

    /* Business-level errors travel as HTTP 200 so the panel's existing
       `res.data.success === false` checks keep working unchanged. */
    return json(obj, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: 'gateway_exception: ' + msg }, 500);
  }
});
