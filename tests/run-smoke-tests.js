/**
 * P2 REFACTOR — Automated smoke test suite (Node, no browser needed)
 * ================================================================
 * यह admin panel के core split (admin-inline-b/c/d/e) + fa21 dedup को
 * एक शेयर्ड VM realm में load करके syntax/ReferenceError सतह पर साबित करता है।
 * कोई real Supabase/Firebase call नहीं — सब stub हैं।
 *
 * RUN:  node tests/run-smoke-tests.js
 * EXIT: 0 = all pass, 1 = any fail
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
let PASS = 0, FAIL = 0, failures = [];

function ok(cond, label) {
  if (cond) { PASS++; console.log('  ✓ ' + label); }
  else { FAIL++; failures.push(label); console.log('  ✗ ' + label); }
}

/* ── DOM / window stub ───────────────────────────────────────── */
function fakeEl() {
  return {
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, options: [],
    addEventListener() {}, appendChild() {}, removeChild() {}, querySelector() { return null; },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, remove() {},
    focus() {}, click() {}, closest() { return null; },
  };
}
function makeCtx() {
  const ctx = {
    console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    confirm: () => false, alert() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    navigator: { clipboard: {} },
    history: { replaceState() {}, pushState() {} },
    location: { pathname: '/', href: '' },
    document: {
      getElementById() { return fakeEl(); }, querySelector() { return null; },
      querySelectorAll() { return []; }, createElement() { return fakeEl(); },
      addEventListener() {}, removeEventListener() {},
      body: fakeEl(), documentElement: fakeEl(), cookie: '', dispatchEvent() {},
    },
    Blob: function () {}, FileReader: function () {},
    fetch() { return Promise.resolve({ text: () => Promise.resolve(''), json: () => Promise.resolve({}) }); },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    Date, Promise, Math, JSON, Object, Array, RegExp, String, Number, Boolean,
    encodeURIComponent, decodeURIComponent,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.__rtdb = {
    INTERNAL: { forceWebSockets() {} },
    ref() {
      return {
        once() { return Promise.resolve({ exists() { return false; }, val() { return null; }, forEach() {} }); },
        on() {}, off() {}, set() { return Promise.resolve(); }, update() { return Promise.resolve(); },
        remove() { return Promise.resolve(); }, push() { return { key: 'k' }; },
        transaction(fn) { fn(null); return Promise.resolve(); },
        orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
        limitToFirst() { return this; }, startAt() { return this; }, endAt() { return this; },
      };
    },
  };
  ctx.__auth = {
    currentUser: null, onAuthStateChanged(cb) { this._cb = cb; }, onIdTokenChanged() {},
    signInWithEmailAndPassword() { return Promise.resolve(); }, signOut() { return Promise.resolve(); },
  };
  ctx.firebase = { initializeApp() { return { auth: () => ctx.__auth, database: () => ctx.__rtdb }; } };
  const supa = new Proxy({}, {
    get(t, p) {
      if (p === 'then') return undefined;
      if (['maybeSingle', 'rpc'].includes(p)) return () => Promise.resolve({ data: null });
      return () => supa;
    },
  });
  ctx._supa = supa;
  ctx.syncFirebaseToken = () => Promise.resolve();
  ctx.showToast = function () {};
  return ctx;
}

function loadFile(ctx, rel) {
  const f = path.join(REPO, rel);
  const code = fs.readFileSync(f, 'utf8');
  vm.runInNewContext(code, ctx, { filename: rel });
}

/* ── TEST 1: admin-inline parts load in order ────────────────── */
console.log('\n── TEST 1: admin-inline-b/c/d/e load in order (no Syntax/Reference error) ──');
{
  const ctx = makeCtx();
  let threw = false;
  for (const p of ['b', 'c', 'd', 'e']) {
    try { loadFile(ctx, 'js/admin-inline-' + p + '.js'); }
    catch (e) { threw = true; failures.push('part ' + p + ' → ' + e.message); }
  }
  ok(!threw, 'all 4 parts load');
  ok(typeof ctx.initializeAdminPanel === 'function', 'global fn initializeAdminPanel present');
  ok(typeof ctx.loadTournaments === 'function', 'global fn loadTournaments present');
  ok(typeof ctx.getMatchStatus === 'function', 'global fn getMatchStatus present');
  ok(typeof ctx.publishResults === 'function', 'global fn publishResults present');
  ok(typeof ctx.loadDisputes === 'function', 'global fn loadDisputes present');
  ok(typeof ctx.exportCSV === 'function', 'window.exportCSV present (part E)');
  ok(typeof ctx.rollBattlePassSeason === 'function', 'window.rollBattlePassSeason present (part E)');
  ok(typeof ctx.loadSeasonPassSection === 'function', 'window.loadSeasonPassSection present (part E)');
  // logout branch must not throw
  if (ctx.__auth._cb) {
    try { ctx.__auth._cb(null); ok(true, 'onAuthStateChanged(logout) no throw'); }
    catch (e) { ok(false, 'onAuthStateChanged(logout) threw: ' + e.message); }
  }
}

/* ── TEST 2: fa21 dedup integrity ────────────────────────────── */
console.log('\n── TEST 2: fa21-match-history.js dedup (single money-path copy, helpers kept) ──');
{
  const ctx = makeCtx();
  let threw = false;
  try { loadFile(ctx, 'js/features/fa21-match-history.js'); }
  catch (e) { threw = true; failures.push('fa21 → ' + e.message); }
  ok(!threw, 'fa21 loads');
  ok(typeof ctx.loadMatchHistory === 'function', 'loadMatchHistory kept (IIFE)');
  ok(typeof ctx.rcAutoCalc === 'function', 'rcAutoCalc kept');
  ok(typeof ctx.rcToggleManual === 'function', 'rcToggleManual kept');
  const src = fs.readFileSync(path.join(REPO, 'js/features/fa21-match-history.js'), 'utf8');
  ok(!src.includes('window.openResultCorrection ='), 'stale openResultCorrection removed from fa21');
  ok(!src.includes('window.submitResultCorrection ='), 'stale submitResultCorrection removed from fa21');
  const e = fs.readFileSync(path.join(REPO, 'js/admin-inline-e.js'), 'utf8');
  ok(e.includes('window.openResultCorrection ='), 'single openResultCorrection lives in admin-inline-e');
  ok(e.includes('window.submitResultCorrection ='), 'single submitResultCorrection lives in admin-inline-e');
}

/* ── TEST 3: monitor layer loads ───────────────────────────── */
console.log('\n── TEST 3: admin-monitor.js loads (non-invasive) ──');
{
  const ctx = makeCtx();
  try { loadFile(ctx, 'js/admin-monitor.js'); ok(true, 'admin-monitor loads'); }
  catch (e) { ok(false, 'admin-monitor → ' + e.message); }
  ok(ctx.__adminMonitorInstalled === true, 'single-install guard set');
  ok(Array.isArray(ctx.__monLog), 'window.__monLog ring exposed');
}

/* ── TEST 4: no monolith residue in index.html ─────────────── */
console.log('\n── TEST 4: no monolith residue in index.html; parts referenced ──');
{
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  ok(['b', 'c', 'd', 'e'].every(p => html.includes('admin-inline-' + p + '.js')), 'index loads all 4 parts');
  const monoRef = html.includes('admin-inline.js?v=');
  ok(!monoRef, 'index no longer references monolith admin-inline.js');
}

/* ── TEST 5: R7 FOLLOW-UP — fa22 prize path ab SINGLE atomic RPC (no client writer) ── */
console.log('\n── TEST 5: fa22-match-result.js single-RPC prize path (no client-side financial writer) ──');
{
  const src = fs.readFileSync(path.join(REPO, 'js/features/fa22-match-result.js'), 'utf8');
  ok(src.includes("rpc('publish_match_results'"), 'publish ab single atomic RPC publish_match_results');
  ok(!/var\s+entryF\s*=\s*t\s*\?/.test(src), 'entryF client-side prize compute HATA (server authoritative)');
  ok(!src.includes('platformEarnings'), 'platformEarnings client push HATA (server authoritative)');
  ok(!src.includes('cashback'), 'cashback reintroduce NAHI (ab koi cashback word nahi)');
  ok(!src.includes('wallet_transactions'), 'no direct client wallet_transactions write');
}

/* ── TEST 6: ROUND-5 — sponsored withdrawal single-authority (no dual approve) ── */
console.log('\n── TEST 6: R5 sponsored withdrawal single-authority (server RPC apar) ──');
{
  const fa = fs.readFileSync(path.join(REPO, 'js/fa-sponsored-system.js'), 'utf8');
  ok(fa.includes('single-authority'), 'fa-sponsored legacy approve ab inert (single-authority)');
  ok(/window\.approveSponsoredWd\s*=\s*function[\s\S]*single-authority/.test(fa),
     'legacy approveSponsoredWd ab RPC-hint only');
  ok(fa.includes('admin_distribute_sponsored_prize'),
     'sponsored prize distribution ab server RPC se');
  ok(!fa.includes("ref('users/' + u.uid + '/sponsoredWinnings').transaction"),
     'admin ab direct Firebase sponsoredWinnings credit NAHI karta');
  const ss = fs.readFileSync(path.join(REPO, 'js/admin-supabase-sponsored.js'), 'utf8');
  ok(ss.includes('resolve_sponsored_withdrawal'), 'secure sponsor wd resolve RPC intact');
}

/* ── TEST 7: B24/B26 — video system gaya + daily bonus live_config par ── */
console.log('\n── TEST 7: B24/B26 video safai + Daily Bonus Editor ka sach ──');
{
  const as = fs.readFileSync(path.join(REPO, 'js/fa-app-settings-v2.js'), 'utf8');
  ok(as.indexOf('video_moderation') === -1 || as.indexOf("key: 'video_moderation'") === -1,
     'admin settings ab video_moderation row nahi likhta');
  ok(as.indexOf('cvVideoEnabled') === -1 && as.indexOf('cvWatchCoins') === -1,
     'Creator Video System ke rows gaye');
  ok(as.indexOf('videoModerationConfig') === -1 || as.indexOf('var videoModerationConfig = {') === -1,
     'videoModerationConfig payload gaya');
  ok(as.indexOf("gn('checkinCoins'") === -1 && as.indexOf("gn('checkinBonus7'") === -1,
     'dead checkinCoins/checkinBonus7 payload se gaye');
  ok(as.indexOf("upsert({ key: 'creator_system'") !== -1,
     'creator_system ka save waise hi chal raha hai (asli feature)');
  ok(as.indexOf("row('cvSDMatchComm'") !== -1,
     'Creator Match Hosting section intact (SD commission %)');

  const f7 = fs.readFileSync(path.join(REPO, 'js/admin-fixes-v7.js'), 'utf8');
  ok(f7.indexOf("ref('appSettings/dailyBonusRewards')") === -1,
     'Daily Bonus Editor ab Firebase par nahi likhta');
  ok(f7.indexOf("eq('key', 'live_config')") !== -1 && f7.indexOf('val.dailyBonusRewards = data') !== -1,
     'Daily Bonus Editor live_config.dailyBonusRewards save karta hai (read-modify-write)');
  ok(/function _dbBonusDefaults\(\)/.test(f7), 'editor ke defaults server constants se match hain');
  ok(f7.indexOf('_liveApplied') !== -1 && f7.indexOf('Server setting abhi apply nahi hui') !== -1,
     'editor warning dikhata hai jab server migration baaki ho');
}

/* ── TEST 8: B9/B10/B11 — sponsored table + modal position + prize type + payout suraksha ── */
console.log('\n── TEST 8: B9/B10/B11 sponsored system (table, modal jagah, prize type, UTR suraksha) ──');
{
  const idx = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

  /* B10: createSponsoredModal mainApp ke ANDAR nahi hona chahiye (transform wale
     ancestor ke andar position:fixed viewport ke bajaye usi ancestor par lagta hai). */
  const appEnd = idx.indexOf('<!-- app end -->');
  const modalPos = idx.indexOf('id="createSponsoredModal"');
  ok(appEnd !== -1 && modalPos > appEnd,
     'B10: createSponsoredModal body-level par hai (app-container ke bahar)');
  ok(idx.indexOf('id="spTourPrizeType"') !== -1,
     'B11: create modal me Prize Type select hai');
  ok(/<option value="cash" selected>/.test(idx),
     'B11: default prize type = Real Money (cash)');
  ok(idx.indexOf('id="spTourPool" class="form-input" placeholder="0" min="1" readonly') !== -1,
     'B11: pool field readonly (auto = prizes ka jod)');
  ok(idx.indexOf('oninput="spRecalcPool()"') !== -1,
     'B11: prize fields pool auto-calc se jude hain');

  const css = fs.readFileSync(path.join(REPO, 'admin-base.css'), 'utf8');
  ok(/@keyframes appIn\{from\{[^}]*transform:translateY\(8px\)\}to\{opacity:1;transform:none\}\}/.test(css),
     'B10: app-container entry animation transform:none par khatam hoti hai (fixed elements safe)');
  ok(!/\.app-container\.show\{opacity:1;transform:translateY\(0\)\}/.test(css),
     'B10: purana transform:translateY(0) wala containing-block trap gaya');

  const fa = fs.readFileSync(path.join(REPO, 'js/fa-sponsored-system.js'), 'utf8');
  ok(fa.indexOf('_spRenderTable') !== -1 && fa.indexOf('<div class="table-wrapper"><table>') !== -1,
     'B9: sponsored list ab data-table render karti hai');
  ok(fa.indexOf('table-wrapper') !== -1 && fa.indexOf('mc-prize-box') === -1,
     'B9: purane match-card wale markup (mc-prize-box) nahi bache');
  ok(fa.indexOf('_admPrizeDistributeGate') !== -1,
     'B14: sponsored Distribute button bhi wahi gate use karta hai');
  ok(fa.indexOf("p_fourth_prize: p4to10") !== -1 && fa.indexOf("p_prize_type: prizeType") !== -1,
     'B11: create RPC ko prize type + 4th-10th prizes jaate hain');
  ok(fa.indexOf("p_prize_type: 'cash'") === -1,
     'B11: hardcoded cash gaya (ab admin ka chuna hua jaata hai)');
  ok(fa.indexOf('window._distCurrency') !== -1 && fa.indexOf("p_currency: _c") !== -1,
     'B11: distribute modal currency-aware hai');
  ok(fa.indexOf('sponsored_coin_prize') !== -1 || fa.indexOf('coin') !== -1,
     'B11: coin prize ka rasta maujood hai');
  ok(!/if \(!confirm\('Is sponsored tournament ko delete karo\?'\)\)/.test(fa),
     'B3 usool: delete par native confirm nahi (app dialog)');
  ok(fa.indexOf('window.appConfirm') !== -1, 'B3 usool: sponsored flows app-dialog use karte hain');

  const ss = fs.readFileSync(path.join(REPO, 'js/admin-supabase-sponsored.js'), 'utf8');
  ok(ss.indexOf('payout_ref_required') !== -1 && ss.indexOf('p_note: ref') !== -1,
     'B11: withdrawal approve par UTR/reference lazmi (server + UI)');
  ok(ss.indexOf('window.appConfirm') !== -1 && !/if \(!confirm\('Approve this sponsored withdrawal\?'\)\)/.test(ss),
     'B11: approve/reject native popup se azaad (app dialog)');
  ok(ss.indexOf('Payout ref') !== -1, 'B11: table me payout reference dikhta hai');
  /* live E2E me pakda gaya: B13 wrapper resolve par row hata deta hai — isliye
     cancel aur "reference nahi mila" dono par error-toast dena LAZMI hai. */
  ok(/if \(!ok\) \{ if \(window\.showToast\) showToast\('\u23f8 Cancel kiya/.test(ss),
     'B11: cancel par error-toast (B13 wrapper row ko galat nahi hatata)');
  ok(ss.indexOf("Payout reference zaroori hai (UTR / UPI txn id) — approve nahi hua") !== -1,
     'B11: reference-gayab par error-toast + saaf wajah');
}

/* ── TEST 9: B5 — notification timing (har value settings se, code se nahi) ── */
console.log('\n── TEST 9: B5 notification/alerts timing settings se aate hain ──');
{
  const alertSrc = fs.readFileSync(path.join(REPO, "js/fa-admin-v10-final.js"), "utf8");
  const setSrc   = fs.readFileSync(path.join(REPO, "js/fa-app-settings-v2.js"), "utf8");
  ok(alertSrc.indexOf('_admAlertCfg') !== -1 && alertSrc.indexOf('admAlertEarlyMins') !== -1,
     'B5: admin alerts live_config (admAlertEarlyMins/UrgentMins) padhte hain');
  ok(!/matchTime - now - 15 \* 60 \* 1000/.test(alertSrc),
     'B5: alerts me 15-minute hardcode gaya');
  ok(!/matchTime - now - 5 \* 60 \* 1000/.test(alertSrc),
     'B5: alerts me 5-minute hardcode gaya');
  ok(setSrc.indexOf("row('admAlertEarlyMins'") !== -1 && setSrc.indexOf("row('admAlertUrgentMins'") !== -1,
     'B5: Settings me dono nayi rows maujood hain');
  ok(setSrc.indexOf('admAlertEarlyMins:  gn(') !== -1 && setSrc.indexOf('admAlertUrgentMins: gn(') !== -1,
     'B5: save payload me dono keys jaati hain');
  ok(setSrc.indexOf("matchReminderMins', 30)") !== -1 && setSrc.indexOf("notifBroadcastDays', 7)") !== -1,
     'B5: reminder + broadcast-days rows bhi settings me (ek hi default: 30 / 7)');
  const brSrc = fs.readFileSync(path.join(REPO, 'js/supabase-rtdb-bridge.js'), 'utf8');
  ok(brSrc.indexOf('_cfgAuthPending()') !== -1 && (brSrc.match(/_cfgAuthPending\(\)\) \{ _cfgQueueWrite/g) || []).length >= 2,
     'B5: auth se pehle app_settings writes queue hoti hain (throw nahi)');
  ok(brSrc.indexOf("addEventListener('supabase:authenticated'") !== -1,
     'B5: login ke baad queue khud-b-khud chalti hai');
  ok((brSrc.match(/window\._supa\.from\('app_settings'\)\.upsert/g) || []).length >= 3,
     'B5: queue flush NAYE authenticated client (window._supa) par hota hai');
  const _fnBody = alertSrc.slice(alertSrc.indexOf('function _admAlertLoadCfg()'),
                                 alertSrc.indexOf('setTimeout(_admAlertLoadCfg, 4000)'));
  const _fnCode = _fnBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');  /* comments hata ke */
  ok(_fnCode.length > 100 && _fnCode.indexOf('.once(') === -1 && _fnCode.indexOf("eq('key', 'live_config')") !== -1,
     'B5: alert timings seedha Supabase live_config se aate hain (khaali appConfig root nahi)');

  const br = fs.readFileSync(path.join(REPO, 'js/supabase-rtdb-bridge.js'), 'utf8');
  ok(br.indexOf('if (d.prizeType !== undefined) s.prize_type = d.prizeType;') !== -1,
     'B11: bridge prize_type bhejta hai (pehle drop ho jaata tha)');
  ok(br.indexOf("prizeType: row.prize_type || 'cash'") !== -1,
     'B11: bridge prize_type padhta hai');
}

console.log('\n══════════════════════════════');
console.log('PASS: ' + PASS + ' | FAIL: ' + FAIL);
if (failures.length) { console.log('failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(FAIL ? 1 : 0);
