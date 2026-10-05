/* E2E-lite harness: runs the CHANGED render functions in a stubbed DOM
   environment to prove (a) no runtime exceptions, (b) balanced HTML tags
   in the generated markup, (c) expected new elements present.
   Run: node e2e-render-check.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = '/home/user/ff-user-panel';
let failures = 0;
function ok(msg) { console.log('  ✅ ' + msg); }
function fail(msg) { console.log('  ❌ ' + msg); failures++; }

/* ── stub DOM ── */
function makeEl(id) {
  return {
    id: id,
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    style: new Proxy({}, { get: () => '', set: () => true }),
    className: '',
    files: [],
    click() {}, focus() {}, appendChild() {}, removeChild() {},
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, setAttribute() {}, getAttribute: () => null,
  };
}
const captured = { modals: [] };
const documentStub = {
  getElementById: (id) => makeEl(id),
  createElement: (t) => makeEl('new-' + t),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};
const localStorageStub = { getItem: () => null, setItem() {}, removeItem() {} };

function makeSandbox(extra) {
  const win = {};
  const base = {
    window: win,
    document: documentStub,
    localStorage: localStorageStub,
    navigator: { clipboard: null, share: null, userAgent: 'test' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date, Math, JSON, String, Number, Object, Array, Boolean, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    openModal: (title, html) => { captured.modals.push({ title, html }); },
    closeModal: () => {},
    toast: () => {},
    navTo: () => {},
    Promise, fetch: () => Promise.reject(new Error('offline')),
  };
  Object.assign(base, extra || {});
  base.window = Object.assign(win, base.window || {});
  base.globalThis = base;
  const ctx = vm.createContext(new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      /* unknown global -> benign stub so missing deps can't crash the run */
      return function stub() { return undefined; };
    },
    has() { return true; },
  }));
  return ctx;
}

/* ── tag-balance checker (div only — the structural unit we edited) ── */
function divBalance(html) {
  const open = (html.match(/<div\b/gi) || []).length;
  const close = (html.match(/<\/div>/gi) || []).length;
  return { open, close };
}

/* ── extract a top-level function source by brace matching ── */
function extractFn(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error('function ' + name + ' not found in ' + file);
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

/* ── fake user data ── */
const UD = {
  uid: 'uid123', ign: 'Singham7', displayName: 'Singham7', ffUid: '12345678',
  profileImage: '', bannerImage: '', title: 'BEAST MODE',
  stats: { matches: 30, wins: 12, kills: 87, earnings: 240 },
  realMoney: { deposited: 210, winnings: 40, bonus: 0 },
  coins: 197, greenDiamonds: 5, sponsored_winnings: 0,
  premium: { tier: 2 },
};
const MATCH = {
  id: 'm1', name: 'Clash Squad Showdown', mode: 'squad', type: 'squad',
  matchTime: Date.now() + 3600000, status: 'upcoming', max_slots: 50, filled_slots: 12,
  entryType: 'coin', entryFee: 10, prizeType: 'coin',
  firstPrize: 100, secondPrize: 50, thirdPrize: 25, perKillPrize: 5,
  map: 'Bermuda', matchSubType: 'clash_squad', minRank: 'Gold',
};

/* ═══════════ TEST 1: renderProfile (bugs 6 + 7) ═══════════ */
console.log('\n── TEST 1: renderProfile (bug 6 layout + bug 7 rainbow) ──');
try {
  const fnSrc = extractFn('screens/profile.js', 'renderProfile');
  const sandbox = makeSandbox({
    UD, U: { uid: 'uid123' },
    calcRk: () => ({ color: '#00ff9c', bg: 'rgba(0,255,156,.1)', emoji: '🥇', badge: 'Gold', pts: 820 }),
    getEquippedFrameColor: () => null, getEquippedTagText: () => null, getEquippedCosmetic: () => null,
    isPremiumActive: () => true, /* bare global (app calls it directly) */
    window: { isPremiumActive: () => true }, /* premium user — rainbow path */
    getPlayerBadges: () => [],
    escHtml: (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    updateHdr: () => {},
    $: (id) => makeEl(id),
  });
  vm.runInContext(fnSrc + '\nrenderProfile();', sandbox, { filename: 'profile.js' });
  const html = sandbox.window.__lastHtml || '';
  /* capture via profileContent element — re-run with capture */
  const el = makeEl('profileContent');
  let out = '';
  Object.defineProperty(el, 'innerHTML', { get: () => out, set: (v) => { out = v; } });
  const sb2 = makeSandbox({
    UD, U: { uid: 'uid123' },
    calcRk: () => ({ color: '#00ff9c', bg: 'rgba(0,255,156,.1)', emoji: '🥇', badge: 'Gold', pts: 820 }),
    getEquippedFrameColor: () => null, getEquippedTagText: () => null, getEquippedCosmetic: () => null,
    isPremiumActive: () => true,
    window: { isPremiumActive: () => true },
    getPlayerBadges: () => [],
    escHtml: (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    updateHdr: () => {},
    $: (id) => (id === 'profileContent' ? el : makeEl(id)),
  });
  vm.runInContext(fnSrc + '\nrenderProfile();', sb2, { filename: 'profile.js' });
  const bal = divBalance(out);
  if (bal.open === bal.close) ok('div balanced (' + bal.open + '/' + bal.close + ')');
  else fail('div UNBALANCED ' + JSON.stringify(bal));
  if (out.includes('rb-wrap rb-glow')) ok('premium rainbow wrapper present');
  else fail('rb-wrap missing for premium user');
  if (out.includes('rb-ring')) ok('premium avatar rainbow ring present');
  else fail('rb-ring missing');
  if (out.includes('flex-wrap:wrap') && out.includes('word-break:break-word')) ok('bug6: name row wraps');
  else fail('bug6: name row wrap missing');
  if (out.includes('Singham7')) ok('IGN rendered');
  else fail('IGN missing');
  if (out.includes('Premium II')) ok('premium badge rendered');
  else fail('premium badge missing');
  if (out.includes('BEAST MODE')) ok('title chip rendered');
  else fail('title chip missing');
} catch (e) { fail('renderProfile threw: ' + e.message); }

/* ═══════════ TEST 2: mcHTML (bug 8 rainbow match card) ═══════════ */
console.log('\n── TEST 2: mcHTML (bug 8 premium match card) ──');
try {
  const fnSrc = extractFn('screens/home.js', 'mcHTML');
  for (const prem of [true, false]) {
    const capturedHtml = [];
    const sb = makeSandbox({
      UD, U: { uid: 'uid123' },
      isPremiumActive: () => prem,
      window: { isPremiumActive: () => prem, _prizeIcon: () => '💎', GD_ICON: '💎', escHtml: (x) => String(x), serverNow: () => Date.now() },
      isVO: () => false,
      effSt: () => 'upcoming',
      titleCase: (s) => String(s),
      escHtml: (s) => String(s),
    });
    // capture return value
    const wrapped = fnSrc.replace(/^function\s+mcHTML\s*\(/, 'function mcHTML(') + '\n;globalThis.__mc = mcHTML;';
    vm.runInContext(wrapped, sb);
    const html = sb.__mc(MATCH);
    const bal = divBalance(html);
    if (bal.open !== bal.close) fail('premium=' + prem + ' div UNBALANCED ' + JSON.stringify(bal));
    else ok('premium=' + prem + ' div balanced (' + bal.open + ')');
    const hasRb = html.includes('rb-wrap');
    if (prem && !hasRb) fail('premium viewer: rb-wrap MISSING');
    if (!prem && hasRb) fail('non-premium viewer: rb-wrap should NOT be there');
    if (prem && hasRb) ok('premium viewer: rainbow border on match card');
    if (!prem && !hasRb) ok('non-premium viewer: card unchanged (no wrapper)');
    if (html.includes('data-match-id="m1"')) ok('data-match-id preserved (premium=' + prem + ')');
    else fail('data-match-id missing (premium=' + prem + ')');
  }
} catch (e) { fail('mcHTML threw: ' + e.message); }

/* ═══════════ TEST 3: _renderPlayerCard (bug 10) ═══════════ */
console.log('\n── TEST 3: _renderPlayerCard (bug 10 blue border + VIP rainbow) ──');
try {
  const fnSrc = extractFn('features/player-card.js', '_renderPlayerCard')
    + '\n' + extractFn('features/player-card.js', '_pcRankInfo')
    + '\n' + extractFn('features/player-card.js', '_pcNextTier');
  for (const vip of [true, false]) {
    const mb = makeEl('modalB');
    let out = '';
    Object.defineProperty(mb, 'innerHTML', { get: () => out, set: (v) => { out = v; } });
    const sb = makeSandbox({
      document: Object.assign({}, documentStub, { getElementById: (id) => (id === 'modalB' ? mb : makeEl(id)) }),
      window: { getRankTier: (p) => ({ name: 'Gold', emoji: '🥇', color: '#ffd700', bg: 'rgba(255,215,0,.1)' }), UD: UD, U: { uid: 'uid123' } },
      toast: () => {},
    });
    vm.runInContext(fnSrc + '\n_renderPlayerCard({ id: "u2", ign: "Hunter7", ff_uid: "87654321", rank_points: 700, total_wins: 20, total_kills: 90, total_matches: 60, city: "Delhi", is_vip: ' + vip + ' });', sb);
    if (process.env.DBG3) console.log('    [dbg vip=' + vip + '] rb-wrap=' + out.includes('rb-wrap') + ' blue=' + out.includes('rgba(0,212,255,.45)') + ' len=' + out.length + ' visualIdx=' + out.indexOf('playerCardVisual'));
    const bal = divBalance(out);
    if (bal.open !== bal.close) fail('vip=' + vip + ' div UNBALANCED ' + JSON.stringify(bal));
    else ok('vip=' + vip + ' div balanced (' + bal.open + ')');
    if (vip) {
      if (out.includes('rb-wrap')) ok('VIP target: rainbow border present');
      else fail('VIP target: rb-wrap missing');
      if (out.includes('⭐ VIP')) ok('VIP chip rendered');
      else fail('VIP chip missing');
    } else {
      if (!out.includes('rb-wrap')) ok('non-VIP target: no rainbow (blue border instead)');
      else fail('non-VIP should not have rb-wrap');
      if (out.includes('rgba(0,212,255,.45)')) ok('non-VIP target: BLUE border (bug 10)');
      else fail('non-VIP target: blue border missing');
    }
    if (out.includes('Hunter7')) ok('searched user name rendered (vip=' + vip + ')');
  }
} catch (e) { fail('_renderPlayerCard threw: ' + e.message); }

/* ═══════════ TEST 4: _buyDiamondPkg (bug 16 QR system) ═══════════ */
console.log('\n── TEST 4: _buyDiamondPkg (bug 16 manual payment QR) ──');
try {
  const src = fs.readFileSync(path.join(ROOT, 'js/quick-deposit.js'), 'utf8');
  const sb = makeSandbox({
    UD, U: { uid: 'uid123' },
    window: { CFG: { manualPayment: { enabled: true, upiId: 'miniesports@upi', payeeName: 'Mini eSports', qrImageUrl: 'https://i.ibb.co/test/qr.png', instructions: 'Step 1\nStep 2', minAmount: 10 } }, openModal: (t, html) => captured.modals.push({ title: t, html }), UD: UD },
    openModal: (t, html) => captured.modals.push({ title: t, html }),
  });
  vm.runInContext(src, sb, { filename: 'quick-deposit.js' });
  captured.modals.length = 0;
  vm.runInContext('window._buyDiamondPkg(120, 99);', sb);
  const html = captured.modals.length ? captured.modals[captured.modals.length - 1].html : '';
  if (!html) { fail('no modal captured'); }
  else {
    const bal = divBalance(html);
    if (bal.open === bal.close) ok('div balanced (' + bal.open + '/' + bal.close + ')');
    else fail('div UNBALANCED ' + JSON.stringify(bal));
    if (html.includes('https://i.ibb.co/test/qr.png')) ok('admin QR image rendered');
    else fail('QR image missing');
    if (html.includes('upi://pay?pa=miniesports%40upi')) ok('UPI deep-link with encoded upiId');
    else fail('UPI deep-link wrong: ' + (html.match(/upi:\/\/pay[^"']*/) || ['none'])[0]);
    if (html.includes('&am=99')) ok('deep-link amount prefilled (₹99)');
    else fail('deep-link amount missing');
    if (html.includes('Diamonds-12345678')) ok('payment note = Diamonds-<ffuid>');
    else fail('payment note missing');
    if (html.includes('_diaDepUtr')) ok('UTR input still present (submit flow intact)');
    else fail('UTR input missing');
    if (html.includes('_diaDepBtn')) ok('submit button still present');
    else fail('submit button missing');
    if (html.includes('Step 1')) ok('admin instructions rendered');
    else fail('instructions missing');
  }
  /* disabled state */
  captured.modals.length = 0;
  vm.runInContext('window.CFG.manualPayment.enabled = false; window._buyDiamondPkg(120, 99);', sb);
  const html2 = captured.modals.length ? captured.modals[captured.modals.length - 1].html : '';
  if (html2.includes('Manual UPI payment abhi band hai')) ok('disabled state shows band message');
  else fail('disabled state message missing');
  if (!html2.includes('upi://pay')) ok('disabled state: no deep-link');
  else fail('disabled state should not show deep-link');
  /* XSS attempt in upiId */
  captured.modals.length = 0;
  vm.runInContext('window.CFG.manualPayment.enabled = true; window.CFG.manualPayment.upiId = \'<script>alert(1)</script>\'; window._buyDiamondPkg(120, 99);', sb);
  const html3 = captured.modals.length ? captured.modals[captured.modals.length - 1].html : '';
  if (!html3.includes('<script>')) ok('XSS in upiId escaped');
  else fail('XSS NOT escaped!');
  /* qrImageUrl javascript: scheme blocked */
  captured.modals.length = 0;
  vm.runInContext('window.CFG.manualPayment.upiId = \'miniesports@upi\'; window.CFG.manualPayment.qrImageUrl = \'javascript:alert(1)\'; window._buyDiamondPkg(120, 99);', sb);
  const html4 = captured.modals.length ? captured.modals[captured.modals.length - 1].html : '';
  if (!html4.includes('javascript:alert')) ok('javascript: QR URL blocked');
  else fail('javascript: QR URL NOT blocked!');
} catch (e) { fail('_buyDiamondPkg threw: ' + e.message); }

/* ═══════════ TEST 5: wallet green-diamond card (bug 17) ═══════════ */
console.log('\n── TEST 5: wallet green diamond card (bug 17) ──');
try {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = html.indexOf('Green Diamond card (matches Sky/Coin card style)');
  /* expand to full element: from the card's opening <div> until divs balance */
  const start = html.indexOf('<div', i);
  let depth = 0, end = start;
  for (let j = start; j < html.length; j++) {
    if (html.startsWith('<div', j)) depth++;
    else if (html.startsWith('</div>', j)) { depth--; if (depth === 0) { end = j + 6; break; } }
  }
  const seg = html.slice(start, end);
  const bal = divBalance(seg);
  if (bal.open === bal.close) ok('wallet GD card div balanced');
  else fail('wallet GD card div UNBALANCED ' + JSON.stringify(bal));
  if (seg.includes('green-diamond.png') && seg.includes('width:64px')) ok('64px glowing GD icon (right side) present');
  else fail('GD icon missing');
  if (seg.includes('diaGlow')) ok('diaGlow animation applied');
  else fail('diaGlow missing');
  if (seg.includes('id="greenDiaCount"')) ok('greenDiaCount id preserved (wallet.js updates it)');
  else fail('greenDiaCount id missing — wallet.js will not update count!');
} catch (e) { fail('wallet check threw: ' + e.message); }

console.log('\n════════════════════════════');
if (failures === 0) console.log('🎉 ALL RENDER CHECKS PASSED');
else console.log('⚠️ ' + failures + ' FAILURE(S)');
process.exit(failures ? 1 : 0);
