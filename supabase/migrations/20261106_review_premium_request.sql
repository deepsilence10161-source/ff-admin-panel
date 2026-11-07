-- ✅ D84 (06 Nov 2026, owner: "approve karne par request baar baar wapas aa jati hai")
-- Client-side .update() par RLS/grant/purane-cache kisi bhi reason se fail ho
-- to status kabhi approved nahi hota tha (row pending me atki rehti thi, aur
-- har dobara approve par approve_premium RPC premium expiry aur +30 din
-- badha deta tha). Ab review SERVER-SIDE atomic RPC se hota hai:
-- admin-check + status update ek hi SECURITY DEFINER function me.
CREATE OR REPLACE FUNCTION public.review_premium_request(p_req_id text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller TEXT := auth.jwt() ->> 'sub';
  v_is_admin BOOLEAN;
  v_rows INT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Login nahi hai');
  END IF;
  SELECT coalesce(is_admin, false) INTO v_is_admin FROM users WHERE id = v_caller;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin only');
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid status');
  END IF;

  UPDATE premium_requests SET
    status      = p_status,
    approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
    approved_by = CASE WHEN p_status = 'approved' THEN v_caller ELSE approved_by END,
    rejected_at = CASE WHEN p_status = 'rejected' THEN now() ELSE rejected_at END,
    reviewed_at = now(),
    reviewed_by = v_caller
  WHERE id = p_req_id::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request nahi mili');
  END IF;
  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_premium_request(text, text) TO authenticated, service_role;
