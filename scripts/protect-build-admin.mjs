/* ================================================================
   ADMIN PANEL — scripts/protect-build-admin.mjs  (D88, 07-Nov-2026)
   User-panel wali protect-build ka admin version:
     • js ke sabhi .js files obfuscated (globals retained)
     • index.html ke inline <script> blocks bhi obfuscated
     • docs md-files, db SQL, tests public build me NAHI
   Output: build/
   ================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Obf = require('javascript-obfuscator');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build');
const EXCLUDE_TOP = new Set(['.git', '.github', 'node_modules', 'build', 'tests', 'db', 'docs', 'tools']);
const OPTS = {
  compact: true, controlFlowFlattening: false, deadCodeInjection: false,
  debugProtection: false,               // D89-fix: interval storm low-end par boot race karta tha debugProtectionInterval: 0, disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal', renameGlobals: false, selfDefending: true,
  stringArray: false,              // D89-fix: decoder crash vector (user panel me prove hua) stringArrayCallsTransform: false, stringArrayCallsTransformThreshold: 0.5,
  stringArrayEncoding: [], stringArrayRotate: false, stringArrayThreshold: 0.6,
  splitStrings: false, splitStringsChunkLength: 900, unicodeEscapeSequence: false, target: 'browser'
};

function walk(src, dest, rel) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) { if (rel === '' && EXCLUDE_TOP.has(ent.name)) continue; walk(path.join(src, ent.name), path.join(dest, ent.name), r); continue; }
    const ext = path.extname(ent.name).toLowerCase();
    if (ext === '.md') continue;
    const s = path.join(src, ent.name), d = path.join(dest, ent.name);
    if (ext === '.js' && r.split('/')[0] === 'js') {
      fs.writeFileSync(d, Obf.obfuscate(fs.readFileSync(s, 'utf8'), OPTS).getObfuscatedCode());
    } else if (ent.name === 'index.html') {
      let html = fs.readFileSync(s, 'utf8');
      html = html.replace(/<script(?![^>]*src=)([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, code) => {
        if (!code.trim() || code.includes('obf-protected')) return m;
        try { return '<script' + attrs + ' data-obf="1">' + Obf.obfuscate(code, { ...OPTS, debugProtection: false, selfDefending: false }).getObfuscatedCode() + '</script>'; }
        catch (e) { return m; }
      });
      fs.writeFileSync(d, html);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
fs.rmSync(OUT, { recursive: true, force: true });
walk(ROOT, OUT, '');
console.log('ADMIN PROTECT-BUILD OK');
