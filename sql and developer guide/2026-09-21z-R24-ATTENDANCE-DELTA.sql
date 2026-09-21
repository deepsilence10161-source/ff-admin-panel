-- ═══════════════════════════════════════════════════════════════════
-- R24 ROUND DELTA — 2026-09-21z (Live Attendance sync)
-- चलाया गया: Supabase Mgmt API से (LIVE-EXECUTED, live-verified)
-- ═══════════════════════════════════════════════════════════════════
-- admin Live Attendance (fa-admin-v10) joinRequests/{id}/attendanceStatus
-- लिखता/पढ़ता है, पर join_requests में वह स्तंभ नहीं था → toggle सिर्फ़
-- transient था, Supabase में कभी नहीं पहुंचता था (live-proven: set
-- 'present' → readback null)। अब स्थायी-भंडारण।
ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS attendance_status text;
-- सत्यापन: column attendance_status मौजूद ✓
