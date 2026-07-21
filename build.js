/**
 * Mini eSports — Production Build Script
 * ----------------------------------------
 * Minifies JS + CSS + HTML and writes to dist/ folder.
 *
 * Setup:
 *   npm install terser clean-css-cli html-minifier-terser --save-dev
 *
 * Run:
 *   node build.js
 *
 * Output:
 *   dist/  — production-ready, minified files
 */

const fs   = require('fs');
const path = require('path');

/* ── Try loading minifiers; graceful degradation if not installed ── */
let Terser, CleanCSS, htmlMinifier;
try { Terser       = require('terser'); }           catch(e) { console.warn('terser not found — JS will be copied as-is'); }
try { CleanCSS     = require('clean-css'); }         catch(e) { console.warn('clean-css not found — CSS will be copied as-is'); }
try { htmlMinifier = require('html-minifier-terser');} catch(e) { console.warn('html-minifier-terser not found'); }

const SRC  = __dirname;
const DIST = path.join(__dirname, 'dist');

/* ── Helpers ── */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/* ── Collect files recursively ── */
function walk(dir, base) {
  base = base || dir;
  var results = [];
  fs.readdirSync(dir).forEach(function(file) {
    var full = path.join(dir, file);
    var stat = fs.statSync(full);
    if (stat.isDirectory()) {
      /* Skip dist/, node_modules/ */
      if (file === 'dist' || file === 'node_modules' || file === '.git') return;
      results = results.concat(walk(full, base));
    } else {
      results.push({ full: full, rel: path.relative(base, full) });
    }
  });
  return results;
}

async function build() {
  console.log('🏗️  Building Mini eSports for production...\n');
  ensureDir(DIST);

  var files = walk(SRC);
  var jsCount = 0, cssCount = 0, htmlCount = 0, copyCount = 0;
  var errors = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var dest = path.join(DIST, f.rel);
    ensureDir(path.dirname(dest));

    var ext = path.extname(f.full).toLowerCase();

    /* ── Minify JavaScript ── */
    if (ext === '.js' && Terser) {
      try {
        var code = fs.readFileSync(f.full, 'utf8');
        var result = await Terser.minify(code, {
          compress: {
            drop_console: true,   /* remove console.log in production */
            drop_debugger: true,
            passes: 2
          },
          mangle: {
            reserved: [
              /* Preserve global names used cross-file */
              'window', 'document', 'firebase', 'supabase',
              'escapeHtml', 'eh', 'showToast', 'showModal',
              'openAdminModal', 'showAdminModal', 'closeModal',
              'loadTournaments', 'loadUsers', 'approveProfile',
              'banUser', 'unbanUser', 'deleteUser'
            ]
          },
          format: { comments: false }
        });
        if (result.error) throw result.error;
        fs.writeFileSync(dest, result.code, 'utf8');
        jsCount++;
        process.stdout.write('.');
      } catch(e) {
        /* Fallback: copy as-is if minification fails */
        copyFile(f.full, dest);
        errors.push('JS minify failed (copied): ' + f.rel + ' — ' + e.message);
      }

    /* ── Minify CSS ── */
    } else if (ext === '.css' && CleanCSS) {
      try {
        var css = fs.readFileSync(f.full, 'utf8');
        var output = new CleanCSS({ level: 2 }).minify(css);
        fs.writeFileSync(dest, output.styles, 'utf8');
        cssCount++;
        process.stdout.write('.');
      } catch(e) {
        copyFile(f.full, dest);
        errors.push('CSS minify failed (copied): ' + f.rel);
      }

    /* ── Minify HTML ── */
    } else if (ext === '.html' && htmlMinifier) {
      try {
        var html = fs.readFileSync(f.full, 'utf8');
        var minHtml = await htmlMinifier.minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          minifyCSS: true,
          minifyJS: false   /* JS already minified separately */
        });
        fs.writeFileSync(dest, minHtml, 'utf8');
        htmlCount++;
        process.stdout.write('.');
      } catch(e) {
        copyFile(f.full, dest);
        errors.push('HTML minify failed (copied): ' + f.rel);
      }

    /* ── Copy everything else (images, json, etc.) ── */
    } else if (
      /* Skip source-map files and build script itself */
      ext !== '.map' &&
      f.rel !== 'build.js' &&
      f.rel !== 'firebase-rules.json' &&
      !f.rel.startsWith('.git')
    ) {
      copyFile(f.full, dest);
      copyCount++;
    }
  }

  console.log('\n\n✅ Build complete!');
  console.log('   JS minified:   ' + jsCount);
  console.log('   CSS minified:  ' + cssCount);
  console.log('   HTML minified: ' + htmlCount);
  console.log('   Files copied:  ' + copyCount);
  console.log('   Output:        ' + DIST);

  if (errors.length) {
    console.log('\n⚠️  Warnings (' + errors.length + '):');
    errors.forEach(function(e) { console.log('   ' + e); });
  }

  console.log('\n📋 Next steps:');
  console.log('   1. Upload contents of dist/ to your server');
  console.log('   2. Do NOT upload: firebase-rules.json, build.js, node_modules/');
  console.log('   3. Apply firebase-rules.json in Firebase Console → Database → Rules');
  console.log('   4. Run supabase-admin-schema.sql in Supabase SQL Editor');
}

build().catch(function(e) {
  console.error('Build failed:', e);
  process.exit(1);
});
