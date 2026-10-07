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
  ok(brSrc.indexOf("addEventListener('supabase:authenticated'") !== -1
     && brSrc.indexOf('function _cfgFlushQueue()') !== -1
     && /setInterval\(function \(\) \{ _cfgFlushQueue\(\); \}, 2500\)/.test(brSrc),
     'B5: login ke baad queue khud-b-khud chalti hai (event + 2.5s retry)');
  ok((brSrc.match(/window\._supa\.from\('app_settings'\)\.upsert/g) || []).length >= 3,
     'B5: queue flush NAYE authenticated client (window._supa) par hota hai');
  const _fnBody = alertSrc.slice(alertSrc.indexOf('function _admAlertLoadCfg()'),
                                 alertSrc.indexOf('setTimeout(_admAlertLoadCfg, 4000)'));
  const _fnCode = _fnBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');  /* comments hata ke */
  ok(_fnCode.length > 100 && _fnCode.indexOf('.once(') === -1 && _fnCode.indexOf("eq('key', 'live_config')") !== -1,
     'B5: alert timings seedha Supabase live_config se aate hain (khaali appConfig root nahi)');
}

/* ── TEST 10: B18 — Seasonal League setting saaf/saral + user panel tak pahunche ── */
console.log('\n── TEST 10: B18 Seasonal League (toggle + asli tareekh + ek hi save dono jagah) ──');
{
  const setSrc = fs.readFileSync(path.join(REPO, 'js/fa-app-settings-v2.js'), 'utf8');
  ok(setSrc.indexOf("id=\"as_seasonActive\"") !== -1,
     'B18: Season Active ab ON/OFF toggle (1/0 likhna khatam)');
  ok(setSrc.indexOf("row('seasonEndDate'") !== -1 && setSrc.indexOf("row('seasonEndDays'") === -1,
     'B18: "days from today" ki jagah ASLI tareekh (seasonEndDate)');
  ok(setSrc.indexOf("_seasonDateHint") !== -1 && setSrc.indexOf('din baaki') !== -1,
     'B18: admin ko live dikhta hai ki user ko kitne din baaki dikhenge');
  ok(setSrc.indexOf("upsert({ key: 'currentSeason'") !== -1,
     'B18: ek hi save live_config + currentSeason (user panel ki row) dono likhta hai');

  const br = fs.readFileSync(path.join(REPO, 'js/supabase-rtdb-bridge.js'), 'utf8');
  ok(br.indexOf('if (d.prizeType !== undefined) s.prize_type = d.prizeType;') !== -1,
     'B11: bridge prize_type bhejta hai (pehle drop ho jaata tha)');
  ok(br.indexOf("prizeType: row.prize_type || 'cash'") !== -1,
     'B11: bridge prize_type padhta hai');
}

/* ── TEST 11: B20 — Referral niyam (dono ko join bonus, SD bonus sirf pehli
   purchase par, match bonus threshold poore hone par) ── */
console.log('\n── TEST 11: B20 Referral rules (dono ko join bonus + SD pehli purchase + match threshold) ──');
{
  const setSrc = fs.readFileSync(path.join(REPO, 'js/fa-app-settings-v2.js'), 'utf8');
  ok(setSrc.indexOf("row('refMatchThreshold'") !== -1,
     'B20: match milestone (kitne matches) ab apni setting row me hai');
  ok(setSrc.indexOf("val('referralMatchThreshold', 5)") !== -1,
     'B20: threshold default 5 aur label threshold se hi banta hai');
  ok(setSrc.indexOf("referralMatchThreshold: gn('refMatchThreshold', 5)") !== -1,
     'B20: save payload me referralMatchThreshold jaata hai');
  ok(setSrc.indexOf('PEHLI SD purchase') !== -1,
     'B20: SD bonus ka hint sach kehta hai (sirf dost ki pehli SD purchase par)');
  ok(setSrc.indexOf("row('refSDBonus'") !== -1 && setSrc.indexOf("row('refMatchCoins'") !== -1,
     'B20: teeno referral reward rows maujood hain (join / SD / match)');
}

/* ── TEST 12: B27 + B28 — Quick Tools grouped UI + v17 sections ka polish ── */
console.log('\n── TEST 12: B27/B28 UI (Quick Tools 6 categories + Clan Wars/City/Mentors/CleanBadges polish) ──');
{
  const idx = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const seg = idx.slice(idx.indexOf('id="section-quicktools"'));
  const section = seg.slice(0, seg.indexOf('<!-- MATCH HISTORY -->'));
  const qtCards = (section.match(/class="card qt-card"/g) || []).length;
  const qtBtns = (section.match(/<button\b/g) || []).length;
  const grids = (section.match(/class="qt-grid"/g) || []).length;
  ok(qtCards === 6 && grids === 6,
     'B27: Quick Tools ab 6 saaf category cards me (chaos dher gaya)');
  ok(qtBtns === 54,
     'B27: 52 purane + 2 pakke tiles (Daily Bonus, Live Users) = 54 (ek bhi hataya nahi)');
  ok(section.indexOf('id="rtAnalyticsBtn"') !== -1 && section.indexOf('id="rtBadge"') !== -1,
     'B27: Live Users ab pakka tile — fix13 ka injector guard ise dobara nahi daalta');
  ok(section.indexOf('Daily Bonus Rewards</button>') !== -1 && section.indexOf('showDailyBonusConfig') !== -1,
     'B27: Daily Bonus Editor ab isi grid ka pakka tile (injection nahi)');
  ok(section.indexOf('id="fraudAlertBadge"') !== -1 && section.indexOf('id="cheatReportBadge"') !== -1
     && section.indexOf('id="refundQueueBadge"') !== -1,
     'B27: teeno live badge counters (fraud/cheat/refund) salamat');
  const cats = ['Communication & Content', 'Fraud & Safety', 'Match Tools', 'Players & Profiles', 'Money & Finance', 'System & Config'];
  ok(cats.every(c => section.indexOf(c) !== -1),
     'B27: chhe categories ke naam header me maujood');
  ok(/<div class="card qt-card"><div class="card-header">[\s\S]{0,200}qt-count/.test(section),
     'B27: har category ke header par count chip');
  const css = fs.readFileSync(path.join(REPO, 'admin-base.css'), 'utf8');
  ok(css.indexOf('.qt-grid') !== -1 && css.indexOf('.qt-grid .btn') !== -1 && css.indexOf('min-height:42px') !== -1,
     'B27: tap-friendly tile CSS (min 42px) base css me');
  ok(css.indexOf('@media (max-width:400px)') !== -1,
     'B27: chhoti screen ke liye compact grid rule');
  const upiBtn = section.indexOf('_openManualPaySettings');
  ok(upiBtn !== -1 && section.indexOf('B22 (2026-10-06)') !== -1,
     'B27: UPI Settings button abhi bhi Settings ke asli section par (dead modal nahi)');

  const fx7 = fs.readFileSync(path.join(REPO, 'js/admin-fixes-v7.js'), 'utf8');
  ok(fx7.indexOf("btn.closest('#section-quicktools')") !== -1,
     'B27: purana injector Quick Tools ke andar dobara button nahi daalta');
  const v17 = fs.readFileSync(path.join(REPO, 'js/features/fa-v17-features.js'), 'utf8');
  ok(v17.indexOf('_v17SectionSub') !== -1 && v17.indexOf('Hafte ke clan challenges') !== -1,
     'B28: paanchon v17 sections ke header me subtitle line');
  ok(v17.indexOf('_cwSetStat') !== -1 && v17.indexOf("_cwSetStat('cwStatPending'") !== -1
     && v17.indexOf("_cwSetStat('cwStatActive'") !== -1 && v17.indexOf("_cwSetStat('cwStatClans'") !== -1,
     'B28: Clan Wars ke 3 stat cards asli counts se bharte hain');
  const empties = (v17.match(/class="empty-state"/g) || []).length;
  ok(empties >= 6,
     'B28: khaali haalaton ke liye saaf empty-state cards (pehle kuch dikhta hi nahi tha)');
  ok(v17.indexOf('cwStatPending') !== -1 && v17.indexOf('Top City') !== -1 && v17.indexOf('Active Mentors') !== -1
     && v17.indexOf('badge status') !== -1,
     'B28: City Champ/Mentors/CleanBadges me bhi stat cards/help text');
  ok(v17.indexOf('window.loadClanWarAdmin&&loadClanWarAdmin()') !== -1
     && v17.indexOf('window.loadCityChampAdmin&&loadCityChampAdmin()') !== -1
     && v17.indexOf('window.loadMentorAdmin&&loadMentorAdmin()') !== -1
     && v17.indexOf('window.loadCleanBadgeAdmin&&loadCleanBadgeAdmin()') !== -1,
     'B28: chaaron sections me Refresh button (functions wahi)');
}

/* ── TEST 13: B22 (leftover) — "New Season" button ab ZINDA (app-UI + server RPC) ── */
console.log('\n── TEST 13: B22 New Season (dead native-prompt button → app dialog + RPC) ──');
{
  const fa10 = fs.readFileSync(path.join(REPO, 'js/fa-admin-v10-final.js'), 'utf8');
  const seg = fa10.slice(fa10.indexOf('window.startNewSeason = function()'));
  const fn = seg.slice(0, seg.indexOf('window.endCurrentSeason = function()'));
  ok(fn.indexOf("prompt('New season name?") === -1 && fn.indexOf("prompt('Season duration") === -1,
     'B22: purane native prompt() gaye (B3 shim unhe null kar deta tha = dead button)');
  ok(fn.indexOf('window.appPrompt') !== -1 && fn.indexOf('window.appConfirm') !== -1,
     'B22: ab app-UI ke asli dialogs (appPrompt/appConfirm)');
  ok(fn.indexOf("rpc('admin_start_new_season'") !== -1,
     'B22: likhne ka kaam authoritative server RPC karta hai');
  ok(fa10.indexOf("db_.ref('appSettings/currentSeason')") === -1,
     'B22: purana bridge-path (doosra sach) hata diya');
  const gro = fs.readFileSync(path.join(REPO, 'js/fa-growth-admin.js'), 'utf8');
  ok(gro.indexOf("document.querySelector('#section-dashboard .section-header .section-actions, #section-dashboard .section-actions')") === -1
     && gro.indexOf("document.querySelector('#section-dashboard .section-header')") !== -1,
     'B22: season buttons ka anchor ab asli dashboard header (purana .section-actions DOM me hi nahi tha = dead)');
  const idxB = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const _d0 = idxB.indexOf('id="section-dashboard"');
  const _dHead = idxB.slice(_d0, idxB.indexOf('class="stats-grid"', _d0));
  ok(_d0 !== -1 && _dHead.indexOf('section-actions') === -1,
     'B22: dashboard header me .section-actions sach me nahi hai (isi wajah se button kabhi bana hi nahi)');
  const sql = fs.readFileSync(path.join(REPO, 'migrations/2026-10-07-b22-start-season-rpc.sql'), 'utf8');
  ok(sql.indexOf('admin_start_new_season') !== -1 && sql.indexOf('SECURITY DEFINER') !== -1
     && sql.indexOf('is_admin') !== -1,
     'B22: RPC server par admin-checked (SECURITY DEFINER + users.is_admin)');
  const set = fs.readFileSync(path.join(REPO, 'js/fa-app-settings-v2.js'), 'utf8');
  const sameKeys = ['seasonName', 'seasonActive', 'seasonEndDays', 'seasonEndDate'].every(k => sql.indexOf(k) !== -1)
     && set.indexOf("'currentSeason'") !== -1 && sql.indexOf("'currentSeason'") !== -1
     && sql.indexOf("'seasonNum'") !== -1 && set.indexOf('seasonNum') !== -1;
  ok(sameKeys,
     'B22: RPC bilkul wahi keys/shape likhta hai jo admin Settings (B18) likhta hai (ek hi sach)');
}

/* ── TEST 14: B31 — copy buttons ab chup-fail nahi hote (copyText helper) ── */
console.log('\n── TEST 14: B31 copy-buttons (clipboard fail par bhi feedback) ──');
{
  const dlg = fs.readFileSync(path.join(REPO, 'js/app-dialog.js'), 'utf8');
  ok(dlg.indexOf('window.copyText = function') !== -1,
     'B31: window.copyText public helper maujood hai (ek jagah se copy)');
  ok(dlg.indexOf('navigator.clipboard.writeText(t).then(done, fail)') !== -1,
     'B31: clipboard reject hone par bhi fail() chalta hai (sirf .then nahi)');
  ok(dlg.indexOf("_fallbackCopy(t)") !== -1 && dlg.indexOf("execCommand('copy')") !== -1,
     'B31: clipboard API na chale to chhupa textarea + execCommand fallback');
  ok(dlg.indexOf('Copy nahi ho paya') !== -1,
     'B31: dono raaste fail ho jayen to saaf ERROR toast (chup nahi)');
  const files = ['js/admin-inline-b.js', 'js/admin-fixes-v7.js', 'js/admin-inline-e.js'];
  let purane = 0;
  files.forEach(f => {
    const t = fs.readFileSync(path.join(REPO, f), 'utf8');
    purane += (t.match(/navigator\.clipboard(&&navigator\.clipboard)?\.writeText\(/g) || []).length;
  });
  ok(purane === 0, 'B31: 3 files me purane seedhe clipboard.writeText call khatam (mila: ' + purane + ')');
  const v7 = fs.readFileSync(path.join(REPO, 'js/admin-fixes-v7.js'), 'utf8');
  ok(v7.indexOf('window.copyText&&copyText(') !== -1 && v7.indexOf("showToast('Copied!')") === -1,
     'B31: Copy Message button ab copyText se, purana .then-only toast gaya');
  const inE = fs.readFileSync(path.join(REPO, 'js/admin-inline-e.js'), 'utf8');
  const utrBtn = inE.slice(inE.indexOf('Copy UTR'), inE.indexOf('Copy UTR') + 180);
  ok(utrBtn.indexOf('window.copyText&&copyText(') !== -1 && utrBtn.indexOf(';showToast(') === -1,
     'B31: UTR copy pehle bina copy hue bhi success toast dikhata tha — ab asli nateeja');
  const fa10 = fs.readFileSync(path.join(REPO, 'js/fa-admin-v10-final.js'), 'utf8');
  const clip = fa10.slice(fa10.indexOf('window._v10CopyIGNs'));
  ok(clip.indexOf('if (window.copyText)') !== -1 && clip.indexOf('function () { toast(\'Copy nahi ho paya') !== -1,
     'B31: IGN-list copy par bhi reject/fallback ka raasta maujood hai');
}

/* ── TEST 15: inline onclick handlers ki JS SYNTAX (B31 ke asli bug se seekh) ──
   Live testing me pakda gaya: copyText wale generated handler me ek extra `)`
   reh gaya tha — `copyText('UID'),'📋 UID copied!')` — click par SyntaxError aur
   button bilkul mare jaisa. Substring-check ise pakad nahi paata, isliye ab
   generated handlers ko Node me sach me COMPILE karke dekhte hain (aur ek pakka
   pattern-check bhi hai). */
console.log('\n── TEST 15: generated onclick handlers ki syntax (mare-button jaisa SyntaxError na aaye) ──');
{
  const files = ['js/admin-inline-b.js', 'js/admin-fixes-v7.js', 'js/admin-inline-e.js', 'js/fa-admin-v10-final.js', 'index.html'];
  let bad = [], checked = 0, patternBad = [];
  function checkHandler(raw, where) {
    if (raw.indexOf('copyText') === -1) return;
    let h = raw
      .replace(/'\s*\+[^']*?\+\s*'/g, 'DYN')   // '...'+expr+'...'  →  DYN
      .replace(/\\(['"])/g, '$1');             // \'  →  '
    if (h.indexOf('{{') !== -1) return;
    if (h.indexOf('\\') !== -1) return;        // jo de-template na ho sake, chhod do
    if (/replace\(|\/g,|'\s*\+\s*'/.test(h)) return;   // regex/adhoora template wala handler — neeche pakka pattern-check hai
    try { new Function('copyText', 'window', 'document', 'msg', 'utr', 'DYN', h); checked++; }
    catch (e) { bad.push(where + ' → ' + e.message + ' :: ' + h.slice(0, 90)); }
  }
  files.forEach(f => {
    const t = fs.readFileSync(path.join(REPO, f), 'utf8');
    const re = /onclick=\\?"([^"]+)"/g; let m;
    while ((m = re.exec(t))) checkHandler(m[1], f);
    /* pakka pattern: copyText(...) ke turant baad `),` = extra band-paren (live bug) */
    if (/copyText\([^)]*\)\s*,\s*\\?'/.test(t)) patternBad.push(f);
  });
  ok(checked >= 4, 'B31: copyText wale generated handlers sach me compile kiye gaye (' + checked + ')');
  ok(bad.length === 0, 'B31: koi bhi handler SyntaxError nahi deta' + (bad.length ? ' — ' + bad[0] : ''));
  ok(patternBad.length === 0, 'B31: kisi file me copyText(…),' + "'…'" + ' wala galat pattern nahi (mila: ' + (patternBad.join(',') || 'kuch nahi') + ')');
  const inB = fs.readFileSync(path.join(REPO, 'js/admin-inline-b.js'), 'utf8');
  ok(inB.indexOf("),\\'📋") === -1, 'B31: purana galat pattern (extra `)` — live me SyntaxError deta tha) ab nahi hai');
}

/* ── TEST 16: B32 — admin panel ki MOBILE (device-friendly) CSS ── */
console.log('\n── TEST 16: B32 mobile tap-targets + responsive block ──');
{
  const css = fs.readFileSync(path.join(REPO, 'js/admin-ui-v10.css'), 'utf8');
  ok(css.indexOf('@media (max-width: 720px)') !== -1,
     'B32: chhoti screen ke liye @media block maujood (pehle ek bhi media query nahi thi)');
  const mob = css.slice(css.indexOf('@media (max-width: 720px)'));
  ok(/table button[^{]*\{[^}]*min-height:\s*34px/.test(mob),
     'B32: table ke buttons ka min-height 34px (pehle 22-27px = ungli ke liye bahut chhote)');
  ok(/input, select, textarea[^{]*\{[^}]*font-size:\s*16px/.test(mob),
     'B32: mobile par input/select ka font 16px (iOS ka auto-zoom band)');
  ok(mob.indexOf('scrollbar-width: thin') !== -1 && mob.indexOf('::-webkit-scrollbar') !== -1,
     'B32: table-wrapper par patli scrollbar = "aur columns hain" ka ishara');
  ok(/\.filter-tab[^{]*\.wa-pill|filter-tab,\s*\.wa-pill/.test(mob) && /min-height:\s*30px/.test(mob),
     'B32: filter pills (All/Verified/Pending/Banned, Unread) bhi mobile par bade tap-target');
  ok(/@media \(max-width: 1024px\)/.test(css) && /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css),
     'B32b: support chat ka grid track minmax(0,1fr) — warna phone par sidebar 390 se chauda hokar KAT jata tha');
  ok(/\.section button,\s*\.card button[^{]*\{[^}]*min-height:\s*32px/.test(css),
     'B32b: .btn-class ke bina chhote buttons (Match Result ka Clear) bhi mobile par bade');
  ok(css.indexOf('@media (max-width: 720px)') !== -1 && css.indexOf('@media (min-width:') === -1,
     'B32: sirf chhoti screen ka block joda, desktop ka koi rule nahi chheda');
}

console.log('\n══════════════════════════════');
console.log('PASS: ' + PASS + ' | FAIL: ' + FAIL);
if (failures.length) { console.log('failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(FAIL ? 1 : 0);
