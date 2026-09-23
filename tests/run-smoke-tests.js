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

/* ── TEST 5: ROUND-4 — fa22 entryF defined (no ReferenceError) ── */
console.log('\n── TEST 5: R4 fa22-match-result.js entryF restore (cashback NOT reintroduced) ──');
{
  const src = fs.readFileSync(path.join(REPO, 'js/features/fa22-match-result.js'), 'utf8');
  ok(/var\s+entryF\s*=\s*t\s*\?\s*\(?t\.entryFee/, src,
     'entryF defined (authoritative t.entryFee)');
  ok(src.includes('platformEarnings'), 'platformEarnings push intact');
  ok(!src.includes('cashback no real money refund से अलग 25% cashback'), 'cashback reintroduce NAHI');
  // orphan-path hai — still safe: entryF use hone se pehle define
  const defIdx = src.indexOf('var entryF');
  const useIdx = src.indexOf('entryFee: entryF');
  ok(defIdx !== -1 && useIdx > defIdx, 'entryF define use-se-pehle (order safe)');
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

console.log('\n══════════════════════════════');
console.log('PASS: ' + PASS + ' | FAIL: ' + FAIL);
if (failures.length) { console.log('failures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(FAIL ? 1 : 0);
