#!/usr/bin/env python3
"""Live-DB E2E checks for the 27-bug fix set (run: python3 e2e-db-checks.py).
Uses the Supabase Management API (PAT in ~/.supabase_token)."""
import urllib.request, json, os, time, sys

TOK = open(os.path.expanduser('~/.supabase_token')).read().strip()
PROJECT = 'hddhkculuyrfoevxmlwy'
def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {'ERROR': e.read().decode()[:200]}

fails = []
def check(name, cond, extra=''):
    print(('  PASS ' if cond else '  FAIL ') + name + (' — ' + str(extra) if extra else ''))
    if not cond: fails.append(name)

print('== bug 2: notification dedup index ==')
idx = q("select indexname from pg_indexes where indexname='uq_notifications_user_type_ref'")
check('unique index present', bool(idx) and 'ERROR' not in str(idx))

print('== bug 12: server-side reminder push chain ==')
jobs = {r['jobname']: r for r in q("select jobname, active from cron.job")}
check('cron send-match-reminders active', jobs.get('send-match-reminders', {}).get('active') is True)
fn = q("select proname from pg_proc where proname='send_due_match_reminders'")
check('send_due_match_reminders exists', bool(fn) and 'ERROR' not in str(fn))
trg = q("select tgname from pg_trigger where tgname='trg_notifications_push'")
check('push trigger on notifications', bool(trg) and 'ERROR' not in str(trg))
hook = q("select enabled from push_hook_config where id=1")
check('push hook enabled', bool(hook) and hook[0]['enabled'] is True)

print('== bug 13/14: match_interest + match_chat realtime ==')
t = q("select tablename from pg_publication_tables where pubname='supabase_realtime'")
tbls = [r['tablename'] for r in t] if t and 'ERROR' not in str(t) else []
check('match_chat in realtime', 'match_chat' in tbls)
mi = q("select 1 from information_schema.tables where table_name='match_interest'")
check('match_interest table', bool(mi) and 'ERROR' not in str(mi))

print('== bug 16: manual payment config key ==')
mp = q("select value->'manualPayment' as mp from app_settings where key='live_config'")
check('live_config.manualPayment present', bool(mp) and mp[0]['mp'] is not None)

print('== bug 20/22-26: commission chain ==')
fns = [r['routine_name'] for r in q("select routine_name from information_schema.routines where routine_schema='public'")]
for f in ['finalize_creator_commission','lock_creator_commission','release_creator_commission',
          'release_eligible_commissions','claim_match_commission_payout']:
    check(f + '() exists', f in fns)
jobs = {r['jobname']: r for r in q("select jobname, active from cron.job")}
check('cron release-eligible-commissions active', jobs.get('release-eligible-commissions', {}).get('active') is True)

print()
print('RESULT:', 'ALL DB CHECKS PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
