/**
 * Gamby Frontend — Security Validation Script
 *
 * Usage:  npm run validate:frontend-security
 *
 * Four-phase audit:
 *   Phase 1 — SOURCE scan:    ensures secrets were never committed to source JS
 *   Phase 2 — DIST scan:      ensures the production bundle is clean and hardened
 *   Phase 3 — HEADERS + SRI:  CSP has no unsafe-inline; Chart.js has SRI hash
 *   Phase 4 — MODULES:        enterprise security modules present in source
 *
 * Exit code 1 if any FAIL; 0 if only PASS/WARN.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, dirname }  from 'path';
import { fileURLToPath }           from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SRC  = join(ROOT, 'assets/js');

// ─── Secret patterns — must NOT appear in production JS ──────────────────────
// These are server-side secrets; they must NEVER reach a browser bundle.
const HARD_SECRET_PATTERNS = [
  { label: 'JWT_SECRET',                re: /JWT_SECRET\s*[:=]/i },
  { label: 'DATABASE_URL',             re: /DATABASE_URL\s*[:=]/i },
  { label: 'API_SECRET / API_KEY',     re: /API_SECRET\s*[:=]|API_KEY\s*[:=]/i },
  { label: 'PRIVATE_KEY',              re: /PRIVATE_KEY\s*[:=]/i },
  { label: 'SMTP_PASSWORD',            re: /SMTP_PASSWORD\s*[:=]/i },
  { label: 'MERCADO_PAGO_ACCESS_TOKEN', re: /MERCADO_PAGO_ACCESS_TOKEN\s*[:=]/i },
  { label: 'process.env server vars',  re: /process\.env\.[A-Z_]{4,}/ },
];

// These must NOT appear in SOURCE files (fail the build before it runs)
const SOURCE_FORBIDDEN_PATTERNS = [
  ...HARD_SECRET_PATTERNS,
  // Bypass passwords — must be removed from frontend source permanently
  {
    label: 'Hardcoded developer bypass password (_DEV_MASTER_PASSWORD / G@MBY! pattern)',
    re:    /G@MBY!xK7#d3v\$Pz9Q2|_DEV_MASTER_PASSWORD\s*=\s*['"][^'"]{6,}/,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _pass = 0;
let _warn = 0;
let _fail = 0;

function pass(label, detail = '') {
  _pass++;
  console.log(`  \x1b[32m✔ PASS\x1b[0m  ${label}${detail ? ' — ' + detail : ''}`);
}
function warn(label, detail = '') {
  _warn++;
  console.log(`  \x1b[33m⚠ WARN\x1b[0m  ${label}${detail ? ' — ' + detail : ''}`);
}
function fail(label, detail = '') {
  _fail++;
  console.log(`  \x1b[31m✖ FAIL\x1b[0m  ${label}${detail ? ' — ' + detail : ''}`);
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function collectFiles(dir, ext) {
  const result = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return result; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      result.push(...await collectFiles(full, ext));
    } else if (!ext || extname(e.name) === ext) {
      result.push(full);
    }
  }
  return result;
}

async function readText(p) {
  try { return await readFile(p, 'utf8'); } catch { return ''; }
}

function relPath(p) {
  return p.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 1 — SOURCE FILE AUDIT
//  Catches secrets that should never have been committed.
// ════════════════════════════════════════════════════════════════════

async function auditSources() {
  section('Phase 1 — Source file audit (assets/js/)');

  const jsFiles = await collectFiles(SRC, '.js');
  if (jsFiles.length === 0) { warn('No source JS files found in assets/js/'); return; }

  let anyFail = false;

  for (const file of jsFiles) {
    // Skip our own security modules (they reference pattern strings for detection)
    const rel = relPath(file);
    if (rel.includes('runtime-guard') || rel.includes('devtools-detector')) continue;

    const src = await readText(file);
    for (const { label, re } of SOURCE_FORBIDDEN_PATTERNS) {
      if (re.test(src)) {
        fail(`Secret/bypass in source: ${rel}`, label);
        anyFail = true;
      }
    }
  }

  if (!anyFail) pass('No secrets or bypass passwords in source JS files');
}

// ════════════════════════════════════════════════════════════════════
//  PHASE 2 — DIST BUILD AUDIT
// ════════════════════════════════════════════════════════════════════

async function checkDistExists() {
  try {
    const s = await stat(DIST);
    if (s.isDirectory()) { pass('dist/ directory exists'); return true; }
  } catch {}
  fail('dist/ does not exist', 'run "npm run build" first');
  return false;
}

async function checkNoSourceMaps() {
  const maps = await collectFiles(DIST, '.map');
  if (maps.length === 0) {
    pass('No .map sourcemap files in dist/');
  } else {
    maps.forEach(m => fail('Sourcemap file found', relPath(m)));
  }
}

async function checkBundle() {
  const jsFiles = await collectFiles(join(DIST, 'assets/js'), '.js');
  const bundleFile = jsFiles.find(f => f.includes('bundle.min'));
  if (!bundleFile) {
    fail('bundle.min.js not found in dist/assets/js/');
    return null;
  }
  pass('bundle.min.js exists');
  return bundleFile;
}

async function checkBundleSize(bundleFile) {
  if (!bundleFile) return;
  const d = await stat(bundleFile).catch(() => null);
  if (!d) return;
  if (d.size < 10_000) {
    fail('Bundle is suspiciously small', `${d.size} bytes — build may have failed`);
  } else {
    pass('Bundle size looks correct', `${(d.size / 1024).toFixed(0)} KB`);
  }
}

async function checkNoBundleSourcemapRef(bundleFile) {
  if (!bundleFile) return;
  const src = await readText(bundleFile);
  if (/sourceMappingURL/.test(src)) {
    fail('Bundle contains sourceMappingURL reference');
  } else {
    pass('Bundle has no sourceMappingURL reference');
  }
}

async function checkNoConsoleLog(bundleFile) {
  if (!bundleFile) return;
  const src = await readText(bundleFile);
  if (/console\s*\.\s*(log|warn|error|info|debug)\s*\(/.test(src)) {
    fail('console.* calls found in bundle', "ensure esbuild drop:['console'] is active");
  } else {
    pass('No console.* calls in bundle');
  }
}

async function checkNoDebugger(bundleFile) {
  if (!bundleFile) return;
  const src = await readText(bundleFile);
  if (/\bdebugger\b/.test(src)) {
    fail('debugger statement found in bundle');
  } else {
    pass('No debugger statements in bundle');
  }
}

async function checkNoHardSecrets(bundleFile) {
  if (!bundleFile) return;
  const src = await readText(bundleFile);
  let anyFail = false;
  for (const { label, re } of HARD_SECRET_PATTERNS) {
    if (re.test(src)) {
      fail(`Server-side secret in bundle`, label);
      anyFail = true;
    }
  }
  // Specifically check for the removed bypass password — FAIL if still present
  if (/G@MBY!xK7#d3v\$Pz9Q2/.test(src)) {
    fail('Hardcoded bypass password still in bundle', 'must be removed from source files');
    anyFail = true;
  }
  if (!anyFail) pass('No server-side secrets or bypass passwords in bundle');
}

async function checkConfigJs() {
  const cfg = await readText(join(DIST, 'assets/js/config.js'));
  if (!cfg) { fail('config.js missing from dist/assets/js/'); return; }

  if (HARD_SECRET_PATTERNS.some(({ re }) => re.test(cfg))) {
    fail('config.js exposes server-side secrets');
  } else {
    pass('config.js contains no server-side secrets');
  }

  if (/localhost/.test(cfg)) {
    warn('config.js points to localhost', 'set GAMBY_API_URL in Netlify environment variables');
  }
}

async function checkHtmlNoSecrets() {
  const html = await readText(join(DIST, 'index.html'));
  if (!html) { fail('index.html missing from dist/'); return; }

  if (HARD_SECRET_PATTERNS.some(({ re }) => re.test(html))) {
    fail('index.html contains server-side secret patterns');
  } else {
    pass('index.html contains no server-side secret patterns');
  }
}

async function checkDevToolsDetector(bundleFile) {
  if (!bundleFile) return;
  const src = await readText(bundleFile);
  if (/outerWidth|outerHeight|frontend-telemetry/.test(src)) {
    pass('DevTools detector code present in bundle');
  } else {
    warn('DevTools detector not detected in bundle', 'verify devtools-detector.js is imported in app.js');
  }
}

async function checkRuntimeGuard(bundleFile) {
  if (!bundleFile) return;
  const src = await readText(bundleFile);
  // Check for characteristic identifiers from runtime-guard.js
  // These strings survive minification since they are telemetry event names
  const hasGuard = /prototype_pollution_detected|session_role_mismatch|critical_fn_replaced|config_replacement_attempt/.test(src);
  if (hasGuard) {
    pass('Runtime tamper guard present in bundle');
  } else {
    warn('Runtime tamper guard not detected in bundle', 'verify runtime-guard.js is imported in app.js');
  }
}

async function checkCspInHtml() {
  const toml = await readText(join(ROOT, 'netlify.toml'));

  // HSTS and X-Frame-Options live permanently in netlify.toml
  if (/Strict-Transport-Security/.test(toml)) {
    pass('HSTS configured in netlify.toml');
  } else {
    warn('Strict-Transport-Security (HSTS) not found in netlify.toml');
  }
  if (/X-Frame-Options/.test(toml)) {
    pass('X-Frame-Options configured in netlify.toml');
  } else {
    warn('X-Frame-Options not found in netlify.toml');
  }

  // CSP is now generated at build time into dist/_headers (no 'unsafe-inline')
  const headersPath = join(DIST, '_headers');
  const headers = await readText(headersPath);
  if (!headers) {
    fail('dist/_headers not found', 'run "npm run build" — CSP is generated at build time');
    return;
  }
  pass('dist/_headers exists (runtime-computed CSP)');

  if (/Content-Security-Policy/.test(headers)) {
    pass('CSP present in dist/_headers');
  } else {
    fail('Content-Security-Policy missing from dist/_headers');
  }

  const scriptSrc = headers.match(/(?:^|;\s*)script-src\s+([^;]+)/m)?.[1] || '';
  const styleSrc = headers.match(/(?:^|;\s*)style-src\s+([^;]+)/m)?.[1] || '';

  if (/'unsafe-inline'/.test(scriptSrc) || /'unsafe-inline'/.test(styleSrc)) {
    fail('CSP script-src/style-src still contains unsafe-inline', 'build should use hashes for script/style blocks');
  } else {
    pass('CSP script-src/style-src use hash-based allowlists');
  }

  if (/sha256-/.test(headers)) {
    pass('CSP contains inline-script SHA-256 hashes');
  } else {
    warn('No sha256 hashes found in CSP', 'build may not have computed inline script hashes');
  }
}

async function checkSri() {
  const html = await readText(join(DIST, 'index.html'));
  if (!html) return;

  if (/cdn\.jsdelivr\.net[^"]*"[^>]*integrity="sha384-/.test(html)) {
    pass('Chart.js CDN script tag has SRI integrity attribute');
  } else if (/cdn\.jsdelivr\.net/.test(html)) {
    warn('Chart.js loaded from CDN without SRI integrity attribute',
         'network may have been unavailable during build — rebuild with internet access');
  }
  // If CDN tag was removed entirely, no warning needed
}

async function checkSecureStorage() {
  const files = await collectFiles(SRC, '.js');
  const hasModule = files.some(f => f.includes('secure-storage'));
  if (hasModule) {
    pass('secure-storage.js (Web Crypto encrypted storage) present in source');
  } else {
    warn('secure-storage.js not found in assets/js/', 'encrypted localStorage module missing');
  }
}

async function checkAntiAutomation() {
  const files = await collectFiles(SRC, '.js');
  const hasModule = files.some(f => f.includes('anti-automation'));
  if (hasModule) {
    pass('anti-automation.js (bot detection) present in source');
  } else {
    warn('anti-automation.js not found in assets/js/', 'browser-side bot detection module missing');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m╔══════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m║  Gamby Frontend Security Validation  ║\x1b[0m');
  console.log('\x1b[1m╚══════════════════════════════════════╝\x1b[0m\n');

  // Phase 1 — sources
  await auditSources();

  // Phase 2 — dist
  section('Phase 2 — Production build audit (dist/)');

  const distOk = await checkDistExists();
  if (!distOk) {
    console.log('\n\x1b[31mAbort: dist/ not found. Run "npm run build" first.\x1b[0m\n');
    process.exit(1);
  }

  await checkNoSourceMaps();
  const bundleFile = await checkBundle();
  await checkBundleSize(bundleFile);
  await checkNoBundleSourcemapRef(bundleFile);
  await checkNoConsoleLog(bundleFile);
  await checkNoDebugger(bundleFile);
  await checkNoHardSecrets(bundleFile);
  await checkConfigJs();
  await checkHtmlNoSecrets();
  await checkDevToolsDetector(bundleFile);
  await checkRuntimeGuard(bundleFile);

  section('Phase 3 — Security headers + SRI audit');
  await checkCspInHtml();
  await checkSri();

  section('Phase 4 — Enterprise security modules audit');
  await checkSecureStorage();
  await checkAntiAutomation();

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1m────────────────────────────────────────────\x1b[0m');
  console.log(`  \x1b[32m${_pass} passed\x1b[0m   \x1b[33m${_warn} warnings\x1b[0m   \x1b[31m${_fail} failed\x1b[0m`);
  console.log('\x1b[1m────────────────────────────────────────────\x1b[0m\n');

  if (_fail > 0) {
    console.error('\x1b[31mValidation FAILED. Fix the issues above before deploying.\x1b[0m\n');
    process.exit(1);
  }

  if (_warn > 0) {
    console.warn('\x1b[33mValidation passed with warnings.\x1b[0m\n');
    console.warn('\x1b[33mReview warnings before deploying to production.\x1b[0m\n');
  } else {
    console.log('\x1b[32mAll checks passed. Build is ready for deployment.\x1b[0m\n');
  }
}

main().catch((err) => {
  console.error('[validate] Fatal error:', err.message);
  process.exit(1);
});
