-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-21u ROUND-20 — ONE-SIGNAL PUSH-SEND (auto-push) — LIVE
-- ═══════════════════════════════════════════════════════════════════
-- Ab tak push send-path project me THA HI NAHI (sirf client-subscribe;
-- aur wo bhi DEAD appId f263d25f par — kabhi kaam nahi kar sakta tha).
-- R20 me poora chain live:
--   notifications INSERT → trigger → pg_net.http_post → push-send
--   edge-fn (secret-gated) → OneSignal REST (include_aliases external_id)
-- Client OneSignal.login(uid) pehle se tha — targeting by external_id ✓
--
-- OWNER-STEPS (dashboard, REST-key se allowed nahi):
--   1. OneSignal dashboard → Mini eSports app → Settings → Web push:
--      Site URL: https://deepsilence10161-source.github.io/ff-user-panel/
--      Allowed origin: https://deepsilence10161-source.github.io
--   2. VAPID keys generate karo (dashboard khud generate karta hai).
--      In dono ke bina WEB-push deliver nahi hoga (subscribe se pehle
--      init bhi reject ho sakta hai). [PATCH /apps is key se 401 aaya]
--   3. APK WebView/TWA me web-push browser-dependent hai; native push
--      chahiye to OneSignal Android SDK alag se lagega.
-- NOTE: "All included players are not subscribed" = user ne subscribe
-- nahi kiya (naya app hai) — plumbing sahi hai, galti nahi.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS push_hook_config (
  id INT PRIMARY KEY DEFAULT 1,
  hook_url TEXT NOT NULL,
  hook_secret TEXT NOT NULL,
  gateway_apikey TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true
);
REVOKE ALL ON push_hook_config FROM anon, authenticated;
ALTER TABLE push_hook_config ENABLE ROW LEVEL SECURITY;
-- (values live me set hoti hain — secret repo me nahi)

CREATE OR REPLACE FUNCTION notifications_push_hook() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_url TEXT; v_sec TEXT; v_key TEXT;
BEGIN
  IF NEW.user_id IS NULL OR COALESCE(NEW.target_all, false) THEN RETURN NEW; END IF;
  SELECT hook_url, hook_secret, gateway_apikey INTO v_url, v_sec, v_key
    FROM push_hook_config WHERE id = 1 AND enabled;
  IF v_url IS NULL THEN RETURN NEW; END IF;
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('uid', NEW.user_id, 'title', NEW.title, 'body', NEW.body),
      headers := jsonb_build_object('Content-Type','application/json','x-push-secret', v_sec, 'apikey', v_key, 'Authorization', 'Bearer '||v_key)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- push best-effort; notification row already saved
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_notifications_push ON notifications;
CREATE TRIGGER trg_notifications_push
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION notifications_push_hook();
