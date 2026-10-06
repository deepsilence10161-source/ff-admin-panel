#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   MINI eSPORTS — VERSION SYNC (हर cache-busting नंबर का एक ही स्रोत)
   ══════════════════════════════════════════════════════════════════════════

   समस्या (लाइव शोध से सिद्ध): रिलीज़ पर नंबर कई जगह बदलने पड़ते हैं और एक भी
   जगह छूटी तो फिक्स यूज़र्स तक पहुँचता ही नहीं (पुरानी cache सर्व होती रहती है):
     1. index.html        → ~101 × ?v=XXXXXXXX
     2. sw.js ASSET_VER   → index.html के ?v= के बराबर होना ज़रूरी (comment में लिखा)
     3. sw.js CACHE_VER   → न बढ़ाओ तो activate handler पुरानी cache नहीं मिटाता
     4. manifest.json     → PWA icons के ?v=
     5. js/screens/features के अंदर के ?v= strings
     6. DB app_settings.live_config.appLatestVersion → CI अपने-आप सेट करता है

   स्टैम्प का रूप: YYYYMMDD + अक्षर (जैसे 20261006a) — एक ही दिन दूसरी रिलीज़ = b

   ⚠️ कमेंट के अंदर लिखे इतिहास वाले नंबर (जैसे “पहले ?v=20260828a stale था”)
      जान-बूझकर नहीं बदले जाते — इसके लिए सही टोकनाइज़र (mask) लगा है।

   इस्तेमाल:
     node scripts/version-sync.mjs --check                        # जाँच
     node scripts/version-sync.mjs --check --require-if-changed    # CI gate
     node scripts/version-sync.mjs --bump                          # नंबर बढ़ाओ
     node scripts/version-sync.mjs --bump-if-needed --quiet --print-changed  # hook
     node scripts/version-sync.mjs --print
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

process.env.TZ = 'Asia/Kolkata';   // hook (लोकल) और CI — दोनों एक ही तारीख गिनें

/* ── सेटिंग ── */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'tests', 'docs', 'dist', 'build', 'out', 'coverage',
  '.gradle', '.github', 'screenshots', 'assets', 'icons', 'sql and developer guide',
]);
const SCAN_EXT  = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json']);
const CACHE_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json',
                           '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webmanifest', '.xml']);
const SW_VARS_FILE = 'sw.js';                 // इसमें ASSET_VER + CACHE_VER भी सम्भलते हैं
const STAMP_RE  = /\?v=([0-9]{8}[a-z]*)/g;    // ?v=20261006a
const STAMP_OK  = /^[0-9]{8}[a-z]*$/;

/* ── args ── */
const args = new Set(process.argv.slice(2));
const MODE =
  args.has('--print') ? 'print' :
  args.has('--bump') ? 'bump' :
  args.has('--bump-if-needed') ? 'bump-if-needed' : 'check';
const QUIET = args.has('--quiet');
const PRINT_CHANGED = args.has('--print-changed');
const REQ_IF_CHANGED = args.has('--require-if-changed');

const log = (...a) => { if (!QUIET) console.log(...a); };
const changedFiles = [];

/* ── repo ── */
const ROOT = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();
function git(cmd, fallback = '') {
  try { return execSync(cmd, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return fallback; }
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
const commitCount    = parseInt(git('git rev-list --count HEAD', '0'), 10) || 0;
const headDate       = git('git log -1 --format=%cd --date=format:%Y%m%d', today());
const stagedFiles    = git('git diff --cached --name-only').split('\n').filter(Boolean);
const committedFiles = git('git diff --name-only HEAD^ HEAD').split('\n').filter(Boolean);
const isCacheable = (f) => CACHE_EXT.has(path.extname(f).toLowerCase()) && !f.startsWith('tests/') && !f.startsWith('docs/');

/* ══════════════════════════════════════════════════════════════════════════
   MASK BUILDER — कमेंट को हटाकर वैसी ही लंबाई का "अंधा" टेक्स्ट बनाता है।
   स्ट्रिंग्स (quotes) नहीं छिपतीं क्योंकि हमारे ?v= उन्हीं के अंदर रहते हैं।
   ══════════════════════════════════════════════════════════════════════════ */
function buildMask(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0, inBlock = false, inLine = false, quote = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; else out[i] = ' '; i++; continue; }
    if (inBlock) {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; inBlock = false; continue; }
      if (c !== '\n') out[i] = ' '; i++; continue;
    }
    if (quote) { if (c === '\\') { i += 2; continue; } if (c === quote) quote = null; i++; continue; }
    if (c === '/' && n === '/') { inLine = true; out[i] = ' '; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '<' && src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i);
      const end = e === -1 ? src.length : e + 3;
      blank(i, end); i = end; continue;
    }
    i++;
  }
  return out.join('');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), out);
    } else if (SCAN_EXT.has(path.extname(e.name)) && !e.name.endsWith('.min.js')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const FILES = walk(ROOT);

/* हर फ़ाइल का mask एक बार बनाकर रख लो (तेज़ + एक जैसा व्यवहार) */
const MASKED = new Map();
function masked(f) {
  if (!MASKED.has(f)) MASKED.set(f, buildMask(fs.readFileSync(f, 'utf8')));
  return MASKED.get(f);
}

/* ── मौजूदा (सबसे प्रचलित) स्टैम्प ── */
function findCurrentStamp() {
  const tally = {};
  for (const f of FILES)
    for (const m of masked(f).matchAll(new RegExp(STAMP_RE.source, 'g')))
      tally[m[1]] = (tally[m[1]] || 0) + 1;
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return { stamp: sorted.length ? sorted[0][0] : '', tally: sorted };
}
function nextStamp(cur) {
  const t = today();
  if (cur && cur.slice(0, 8) === t) {
    const arr = (cur.slice(8) || 'a').split('');
    let i = arr.length - 1;
    while (i >= 0) { if (arr[i] === 'z') { arr[i] = 'a'; i--; } else { arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1); break; } }
    if (i < 0) arr.unshift('a');
    return t + arr.join('');
  }
  return t + 'a';
}

/* ── एक फ़ाइल में सारे ?v= बदलो (mask के हिसाब से) ── */
function rewriteFile(file, newStamp) {
  const src = fs.readFileSync(file, 'utf8');
  const mask = masked(file);
  const re = new RegExp(STAMP_RE.source, 'g');
  let out = '', last = 0, touched = false, m;
  while ((m = re.exec(mask))) {
    if (m[1] === newStamp) continue;
    out += src.slice(last, m.index) + '?v=' + newStamp;
    last = m.index + m[0].length;
    touched = true;
  }
  out += src.slice(last);

  /* sw.js के अपने variables */
  const r = rel(file);
  if (r === SW_VARS_FILE) {
    const assetRe = /(var\s+ASSET_VER\s*=\s*')[^']*(')/;
    const cacheRe = /(var\s+CACHE_VER\s*=\s*')me-v(\d+)-([^']*)(')/;
    if (assetRe.test(out) && out.match(assetRe)[0] !== `var ASSET_VER = '${newStamp}'`) touched = true;
    out = out.replace(assetRe, `$1${newStamp}$2`);
    if (cacheRe.test(out)) {
      const before = out.match(cacheRe)[0];
      out = out.replace(cacheRe, `$1me-v${commitCount + 1}-${newStamp}$4`);
      if (before !== out.match(cacheRe)[0]) touched = true;
    } else {
      log(`  ⚠️  ${r}: CACHE_VER नहीं मिला — जाँचें`);
    }
  }

  if (touched) { fs.writeFileSync(file, out); MASKED.delete(file); changedFiles.push(r); }
  return touched;
}

/* ── हर फ़ाइल में मौजूद स्टैम्प (check के लिए) ── */
function stampsPerFile() {
  return FILES.map((f) => {
    const set = new Set();
    for (const m of masked(f).matchAll(new RegExp(STAMP_RE.source, 'g'))) set.add(m[1]);
    return { rel: rel(f), stamps: [...set] };
  }).filter((r) => r.stamps.length);
}
function swVars() {
  const p = path.join(ROOT, 'sw.js');
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8');
  const a = s.match(/var\s+ASSET_VER\s*=\s*'([^']*)'/);
  const c = s.match(/var\s+CACHE_VER\s*=\s*'me-v(\d+)-([^']*)'/);
  return { asset: a ? a[1] : null, cacheStamp: c ? c[2] : null, cacheCount: c ? c[1] : null, found: !!c };
}

/* ══ main ══ */
const { stamp: current, tally } = findCurrentStamp();
log(`\n🔎 Mini eSports Version Sync — ${path.basename(ROOT)}`);
log(`   मौजूदा स्टैम्प : ${current || '(कोई नहीं)'}   (${tally.slice(0, 5).map(([s, n]) => s + '×' + n).join(', ')})`);
log(`   HEAD तारीख (IST): ${headDate}   |   commit संख्या: ${commitCount}`);

if (MODE === 'print') { console.log(current); process.exit(0); }

function problemsList() {
  const problems = [];
  const rows = stampsPerFile();
  const distinct = [...new Set(rows.flatMap((r) => r.stamps))].filter((d) => STAMP_OK.test(d));
  if (distinct.length > 1) {
    problems.push(`एक से ज़्यादा स्टैम्प मिले (सब बराबर होने चाहिए): ${distinct.join(', ')}`);
    rows.filter((r) => r.stamps.length > 1).forEach((r) => log(`   • ${r.rel}: ${r.stamps.join(' + ')}`));
  }
  if (!distinct.length) problems.push('कोई ?v= स्टैम्प नहीं मिला — index.html जाँचें');

  const swv = swVars();
  if (swv) {
    if (swv.asset !== current) problems.push(`sw.js ASSET_VER (${swv.asset}) ≠ स्टैम्प (${current})`);
    if (!swv.found) problems.push('sw.js CACHE_VER का format बदला हुआ है');
    else if (swv.cacheStamp !== current) problems.push(`sw.js CACHE_VER (${swv.cacheStamp}) ≠ स्टैम्प (${current}) — CACHE_VER न बढ़े तो पुरानी cache कभी नहीं मिटेगी`);
  }
  return problems;
}

function runCheck() {
  const problems = problemsList();
  const stale = !!current && current.slice(0, 8) < headDate;
  const relevantChanges = (REQ_IF_CHANGED ? committedFiles : stagedFiles).filter(isCacheable);

  if (stale && (REQ_IF_CHANGED ? relevantChanges.length : true)) {
    problems.push(`स्टैम्प (${current}) commit तारीख (${headDate}) से पुराना है — इस रिलीज़ पर नंबर नहीं बढ़ा`);
  }
  if (REQ_IF_CHANGED && relevantChanges.length === 0) {
    log(`   ℹ️  इस commit में cacheable फ़ाइल नहीं बदली (${committedFiles.length} फ़ाइलें) — बम्प ज़रूरी नहीं`);
  }
  /* ✅ FIX (2026-10-06): ek hi din me DOOSRI release par bhi stamp badalna
     ZAROORI hai — warna nayi build purane stamp ke saath publish hoti hai
     aur users ke WebView me purani cache hi serve hoti rehti hai (wahi
     "fix lagta hi nahi" bimari). Isliye: is commit me cacheable files
     badli hain aur stamp pichhle commit ke stamp jaisa hi hai → FAIL. */
  if (REQ_IF_CHANGED && relevantChanges.length > 0) {
    const hs = headStamp();
    if (hs && hs === current) {
      problems.push(`इस commit में cacheable फ़ाइलें बदली हैं पर स्टैम्प नहीं बढ़ा (${current} — पिछले commit jaisa hi) — same-day release me bhi bump zaroori hai`);
    }
  }

  if (!problems.length) {
    log(`\n✅ VERSION SYNC OK — स्टैम्प ${current} हर जगह एक जैसा` + (REQ_IF_CHANGED ? '' : `  |  CACHE_VER: ${swVars() ? swVars().cacheCount : '-'}`));
    return 0;
  }
  console.log('\n❌ VERSION SYNC FAIL:');
  problems.forEach((p) => console.log('   • ' + p));
  console.log('\n   ठीक करने का तरीक़ा (एक कमांड):');
  console.log('     node scripts/version-sync.mjs --bump');
  console.log('     git add -A && git commit -m "chore(version): stamp bump" && git push');
  return 1;
}

function doBump() {
  const next = nextStamp(current);
  log(`\n♻️  स्टैम्प ${current || '(कोई नहीं)'} → ${next}   |   CACHE_VER → me-v${commitCount + 1}-${next}`);
  for (const f of FILES) rewriteFile(f, next);
  log(`\n✅ ${changedFiles.length} फ़ाइलें अपडेट हुईं:`);
  changedFiles.forEach((f) => log('   • ' + f));
  if (PRINT_CHANGED) changedFiles.forEach((f) => console.log('CHANGED:' + f));
  return 0;
}

/* HEAD (पिछले commit) में जो स्टैम्प था — यह जानने के लिए कि इस commit में
   नंबर पहले ही बढ़ाया जा चुका है या नहीं (दोबारा बढ़ाने की ज़रूरत नहीं) */
function headStamp() {
  try {
    const html = execSync('git show HEAD:index.html', { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    const tally = {};
    for (const m of buildMask(html).matchAll(new RegExp(STAMP_RE.source, 'g')))
      tally[m[1]] = (tally[m[1]] || 0) + 1;
    const s = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    return s.length ? s[0][0] : '';
  } catch { return ''; }
}

function bumpIfNeeded() {
  const p = problemsList();
  const stale = !!current && current.slice(0, 8) < headDate;
  const stagedCacheable = stagedFiles.filter(isCacheable);
  const hs = headStamp();
  const alreadyBumped = !!hs && hs !== current;   // इस commit me pehle hi bump ho chuka
  /* ✅ FIX (2026-10-06): same-day second release bhi bump karegi — dekho runCheck
     me diya explanation. Yaani: cacheable changes staged + stamp == HEAD ka
     stamp → bump. */
  const must = p.length > 0 || stale || (stagedCacheable.length > 0 && !alreadyBumped);
  if (!must) {
    log('\nℹ️  स्टैम्प पहले से ताज़ा/एक जैसा' + (alreadyBumped ? ` (इस commit में ${hs} → ${current} हो चुका)` : '') + ' — कुछ बदलना नहीं पड़ा');
    return 0;
  }
  if (p.length) p.forEach((x) => log('   ! ' + x));
  if (stale) log(`   ! स्टैम्प ${current} अभी भी ${headDate} पर अटका है`);
  return doBump();
}

let code = 0;
if (MODE === 'check') code = runCheck();
else if (MODE === 'bump') code = doBump();
else if (MODE === 'bump-if-needed') code = bumpIfNeeded();
process.exit(code);
