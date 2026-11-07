-- ══════════════════════════════════════════════════════════════════════════
-- B6 + B21 (2026-10-06): Room ID/password timing — EK jagah (Room Manager) +
-- har haal me THEEK SAMAY par fire ho.
--
-- User ki shikayat / niyam:
--   * "Room ID/password timing sirf ROOM MANAGER me rahe, aur waqt par fire ho."
--   * B6  : timing do jagah thi (match create + room manager) -> match create se hatao
--   * B21 : Room ID release setting settings tab + room manager dono me -> ek jagah
--
-- ASLI JAD (live DB jaanch, 2026-10-06):
--   `matches` table me room_release_minutes (default 5), room_released_at,
--   room_status, room_id, room_password — sab maujood hain, aur bridge inhe
--   Firebase ke roomId/roomPassword/roomStatus/roomReleasedAt/roomReleaseMinutes
--   se map karta hai. Lekin release KARNE WALA koi server process nahi tha:
--   sirf admin panel ki khuli hui tab me setInterval (60s) release karta tha
--   (js/features-admin.js -> window._autoReleaseRooms). Yaani panel band =
--   match ke waqt par room ID kabhi release hi nahi hoti thi (cron me
--   sync_match_statuses har minute chalti hai, par room ke liye aisa kuch nahi).
--
-- ✅ ASLI JAD #2 (is file ka asli nikhar): `matches.room_id`/`room_password`
--   columns KHAALI rehte hain — trigger `redirect_match_room_secrets` har
--   write ko `match_rooms` table me le jata hai aur matches ke columns NULL
--   kar deta hai (secrets ek hi jagah, admin-only RLS). Live jaanch:
--   matches me 0 rows me room_id hai, jabki match_rooms me asli creds pade
--   hain. Isliye release ka faisla bhi `match_rooms` se hi hona chahiye.
--   (User ko creds `get_room_credentials()` RPC deta hai — wahi is release
--   ke baad turant khul jate hain.)
--
-- YEH FILE: server-side `release_due_rooms()` + pg_cron (har minute) —
--   bilkul wahi andaz jo sync_match_statuses()/send_due_match_reminders()
--   ka pehle se hai. Client ke _autoReleaseRooms (idempotent guard) bane
--   rehne dete hain — wo ab sirf "turant" wala raasta hai, asli bharosa server.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.release_due_rooms()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
/* Room ID/password theek waqt par (match se room_release_minutes pehle) release.
   Niyam (client wale _autoReleaseRooms se bilkul milte-julte, taki dono jagah
   ek hi logic rahe):
     • sirf wahi matches jinme room_id AUR room_password dono bhare hue hain
       (match_rooms ki asli copy — matches ke columns to redirect trigger
       ne jaan-boojh kar khaali rakhe hain)
     • jo abhi tak release nahi hue (room_status <> 'released',
       room_released_at IS NULL)
     • jo zinda hain (status 'upcoming' ya 'live') — cancel/resultPublished
       chhua hi nahi jata, aur 1 ghante se purane khatam matches ko bhi
       wapas notification nahi jati
     • release ka waqt = scheduled_at - room_release_minutes (default 5)
   Har row apne exception-guard me hai (send_due_match_reminders jaisa) —
   ek kharab row poore batch ko na roke. Notifications me dedup hai, isliye
   admin panel ke apne auto-release se takraav hone par bhi player ko EK hi
   notification jati hai. */
declare
  r          record;
  v_released integer := 0;
  v_upd      integer := 0;
  v_notified integer := 0;
  v_active   text[] := array['upcoming', 'live'];
begin
  for r in
    select m.id,
           coalesce(nullif(m.name, ''), nullif(m.title, ''), 'Match') as match_name,
           mr.room_id,
           mr.room_password
      from public.matches m
      join public.match_rooms mr on mr.match_id = m.id
     where mr.room_id is not null and btrim(mr.room_id) <> ''
       and mr.room_password is not null and btrim(mr.room_password) <> ''
       and coalesce(m.room_status, 'pending') <> 'released'
       and m.room_released_at is null
       and m.scheduled_at is not null
       and m.status = any (v_active)
       and now() >= m.scheduled_at
                  - make_interval(mins => coalesce(m.room_release_minutes, 5))
     order by m.scheduled_at
     limit 200
  loop
    begin
      update public.matches m
         set room_status      = 'released',
             room_released_at = now(),
             updated_at       = now()
       where m.id = r.id
         and m.room_released_at is null
         and coalesce(m.room_status, 'pending') <> 'released';
      get diagnostics v_upd = row_count;

      if v_upd > 0 then
        v_released := v_released + 1;

        /* Sirf asli joined players — wahi chhavni jo admin panel ke
           sendRoomNotificationToMatch() me hai (cancelled/refunded/rejected/
           no_show chhod kar baaki sab joined maane jate hain). */
        insert into public.notifications (user_id, type, title, body, ref_id)
        select jr.user_id,
               'room_released',
               '🎮 Room Details!',
               'Match: ' || r.match_name || chr(10)
                 || 'Room ID: ' || r.room_id || chr(10)
                 || 'Password: ' || r.room_password,
               r.id
          from public.join_requests jr
         where jr.match_id = r.id
           and jr.user_id is not null
           and coalesce(jr.status, 'joined')
               not in ('cancelled', 'refunded', 'rejected', 'no_show')
           and not exists (
             select 1 from public.notifications n
              where n.user_id = jr.user_id
                and n.type = 'room_released'
                and n.ref_id = r.id
           );
      end if;
    exception when others then
      raise warning 'release_due_rooms fail (match=%): %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'released', v_released, 'at', now());
end
$function$;

comment on function public.release_due_rooms() is
  'B6/B21 (2026-10-06): match se room_release_minutes pehle Room ID/password '
  'release karta hai (server-side, admin panel band ho to bhi). Joined players '
  'ko dedup ke sath room_released notification bhi jati hai.';

-- har minute — jaise sync_match_statuses() aur send_due_match_reminders()
do $$
begin
  if exists (select 1 from cron.job where jobname = 'release-due-rooms') then
    perform cron.unschedule('release-due-rooms');
  end if;
  perform cron.schedule('release-due-rooms', '* * * * *', 'select public.release_due_rooms();');
end $$;
