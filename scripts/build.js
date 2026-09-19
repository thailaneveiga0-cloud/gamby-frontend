/**
 * Gamby Frontend — Production Build Script
 *
 * Usage:
 *   node scripts/build.js             # minify only (recommended for CI)
 *   node scripts/build.js --obfuscate # minify + javascript-obfuscator
 *
 * Output: dist/
 *   - assets/js/bundle.min.js   bundled + minified (console, debugger, comments removed)
 *   - assets/js/config.js       runtime config (generated from GAMBY_API_URL env var)
 *   - assets/css/*.css          minified stylesheets
 *   - assets/data/*             static data files copied as-is
 *   - index.html                HTML with comments stripped, script src updated
 *
 * Obfuscation is DISABLED by default because:
 *   - It roughly 3× the bundle size
 *   - It breaks source context in error reporting
 *   - Minification + mangling already defeats casual inspection
 * Enable with --obfuscate only for production releases that need maximum hardening.
 */

import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm, copyFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { resolveBuildCommit, buildConfigJs } from './build-info.mjs';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const DIST      = join(ROOT, 'dist');
const OBFUSCATE = process.argv.includes('--obfuscate');
const DEBUG_BUILD = process.argv.includes('--debug'); // preserva console.* para diagnóstico

// ─── Obfuscation config ───────────────────────────────────────────────────────
// Kept deliberately conservative so it doesn't break vanilla JS.
// Avoid: controlFlowFlattening, deadCodeInjection, selfDefending, debugProtection
// Those can introduce infinite loops or crash in strict mode.
const OBFUSCATE_CONFIG = {
  compact:                    true,
  controlFlowFlattening:      false,
  deadCodeInjection:          false,
  debugProtection:            false,
  disableConsoleOutput:       false, // already done by esbuild drop:['console']
  selfDefending:              false,
  stringArray:                true,
  stringArrayEncoding:        ['base64'],
  stringArrayThreshold:       0.8,
  splitStrings:               true,
  splitStringsChunkLength:    10,
  renameGlobals:              false, // dangerous — breaks window.* assignments
  identifierNamesGenerator:  'hexadecimal',
  numbersToExpressions:       false,
  transformObjectKeys:        false,
  unicodeEscapeSequence:      false,
  log:                        false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function clean() {
  if (await exists(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'assets', 'js'),   { recursive: true });
  await mkdir(join(DIST, 'assets', 'css'),  { recursive: true });
  await mkdir(join(DIST, 'assets', 'data'), { recursive: true });
}

// ─── Step 1: Bundle + minify JS ──────────────────────────────────────────────

async function buildJs() {
  await esbuild.build({
    entryPoints: [join(ROOT, 'assets/js/app.js')],
    bundle:      true,
    minify:      true,
    sourcemap:   false,
    format:      'iife',       // self-contained; no import/export in output
    outfile:     join(DIST, 'assets/js/bundle.min.js'),
    drop:        DEBUG_BUILD ? [] : ['console', 'debugger'],
    legalComments: 'none',
    target:      ['es2020'],
    treeShaking: true,
  });
}

// ─── Step 2: Optional obfuscation ────────────────────────────────────────────

async function applyObfuscation() {
  if (!OBFUSCATE) return;
  const JavaScriptObfuscator = require('javascript-obfuscator');
  const src    = await readFile(join(DIST, 'assets/js/bundle.min.js'), 'utf8');
  const result = JavaScriptObfuscator.obfuscate(src, OBFUSCATE_CONFIG);
  await writeFile(join(DIST, 'assets/js/bundle.min.js'), result.getObfuscatedCode(), 'utf8');
}

// ─── Step 3: Minify CSS ──────────────────────────────────────────────────────

async function buildCss() {
  const CleanCSS = require('clean-css');
  const cc = new CleanCSS({ level: 2, returnPromise: false });

  for (const name of ['base', 'auth', 'dashboard', 'layout-overrides']) {
    const src    = await readFile(join(ROOT, `assets/css/${name}.css`), 'utf8');
    const result = cc.minify(src);
    if (result.errors.length) {
      console.warn(`[build] CSS warnings for ${name}.css:`, result.errors);
    }
    await writeFile(join(DIST, `assets/css/${name}.css`), result.styles, 'utf8');
  }
}

// ─── Step 4: Process HTML ────────────────────────────────────────────────────
// - Strip HTML comments (keeps conditional comments <!--[if ...]-->)
// - Replace module script src → bundle.min.js
// - Remove type="module" (bundle is IIFE, not an ES module)

async function processHtml() {
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');

  // Remove HTML comments (preserve IE conditional comments and GAMBY_BUILD_COMMIT marker)
  html = html.replace(/<!--(?!\[if\s)(?! GAMBY_BUILD_COMMIT)[\s\S]*?-->/g, '');

  // Update script reference: app.js → bundle.min.js
  html = html.replace(
    /<script\s+type="module"\s+src="assets\/js\/app\.js"><\/script>/,
    '<script src="assets/js/bundle.min.js"></script>'
  );

  await writeFile(join(DIST, 'index.html'), html, 'utf8');
}

// ─── Step 5b: Fetch Chart.js + compute SRI (sha384) ─────────────────────────
// Fetches a pinned Chart.js version from CDN, computes its sha384 hash, and
// injects an integrity= attribute into dist/index.html. This protects against
// CDN compromise: if cdn.jsdelivr.net serves a tampered file, the browser rejects it.
//
// Pins to a specific semver so the SRI hash stays stable across builds.
// Update CHARTJS_VERSION when intentionally upgrading Chart.js.

const CHARTJS_VERSION = '4.4.4';
const CHARTJS_URL     = `https://cdn.jsdelivr.net/npm/chart.js@${CHARTJS_VERSION}/dist/chart.umd.min.js`;

async function addChartJsSri() {
  let sriHash = null;

  try {
    const res = await fetch(CHARTJS_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf  = Buffer.from(await res.arrayBuffer());
    sriHash    = 'sha384-' + createHash('sha384').update(buf).digest('base64');
    console.log(`[build] SRI hash for chart.js@${CHARTJS_VERSION}: ${sriHash}`);
  } catch (err) {
    console.warn(`[build] WARN: Could not fetch Chart.js for SRI computation: ${err.message}`);
    console.warn('[build] WARN: dist/index.html will NOT have integrity= on chart.js script tag.');
    console.warn('[build] WARN: Re-run the build with network access to fix this.');
  }

  let html = await readFile(join(DIST, 'index.html'), 'utf8');

  // Replace the script tag with a pinned, SRI-protected version
  html = html.replace(
    /<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js[^"]*"><\/script>/,
    sriHash
      ? `<script src="${CHARTJS_URL}" integrity="${sriHash}" crossorigin="anonymous"></script>`
      : `<script src="${CHARTJS_URL}"></script>`
  );

  await writeFile(join(DIST, 'index.html'), html, 'utf8');
  return sriHash;
}

// ─── Step 5c: Compute CSP hashes for inline scripts ──────────────────────────
// Extracts all inline <script> blocks from dist/index.html, computes their
// SHA-256 hashes, and generates dist/_headers with a CSP that replaces
// 'unsafe-inline' with exact script hashes.
//
// The Netlify _headers file overrides netlify.toml headers for matching paths,
// so Content-Security-Policy in netlify.toml is intentionally left for fallback
// (it still has 'unsafe-inline'). The _headers file takes precedence at runtime.

async function generateCspHeaders(sriHash) {
  const html = await readFile(join(DIST, 'index.html'), 'utf8');

  // Extract content of inline <script> blocks (no src= attribute)
  const inlineRe = /<script(?:\s+type="[^"]*")?\s*>([\s\S]*?)<\/script>/gi;
  const scriptHashes = [];
  let m;
  while ((m = inlineRe.exec(html)) !== null) {
    const content = m[1];
    if (!content.trim()) continue;
    const hash = 'sha256-' + createHash('sha256').update(content, 'utf8').digest('base64');
    scriptHashes.push(`'${hash}'`);
  }

  console.log(`[build] CSP: computed ${scriptHashes.length} inline script hash(es)`);

  // Extract <style> block content for style-src hashes
  const styleRe = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi;
  const styleHashes = [];
  let s;
  while ((s = styleRe.exec(html)) !== null) {
    const content = s[1];
    if (!content.trim()) continue;
    const hash = 'sha256-' + createHash('sha256').update(content, 'utf8').digest('base64');
    styleHashes.push(`'${hash}'`);
  }

  console.log(`[build] CSP: computed ${styleHashes.length} inline style hash(es)`);

  // Build CSP value
  const scriptSrcExternal = sriHash
    ? `${CHARTJS_URL}`  // SRI-protected CDN
    : `https://cdn.jsdelivr.net`; // fallback: allow whole CDN

  const cspParts = [
    `default-src 'self'`,
    `script-src 'self' ${scriptHashes.join(' ')} ${scriptSrcExternal}`,
    // style-src-elem: controls <style> blocks and <link rel="stylesheet"> — hash-locked, no unsafe-inline
    `style-src 'self' ${styleHashes.join(' ')} https://fonts.googleapis.com https://fonts.gstatic.com`,
    // style-src-attr: controls inline style="" attributes and CSSOM mutations (element.style.xxx = yyy).
    // Justification for 'unsafe-inline': the HTML contains ~345 static inline style="" attributes
    // authored by developers (not user-injected). Migrating all to CSS classes in a single pass would
    // risk regressions across ~15 feature areas. This directive is scoped to attributes only and does
    // NOT weaken the style-src-elem hash-lock for <style> blocks. Re-evaluate after full utility-class
    // migration. Tracked: https://github.com/thailaneveiga0-cloud/gamby-fluxo-caixa-pro
    `style-src-attr 'unsafe-inline'`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    `connect-src 'self' https:`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];

  const csp = cspParts.join('; ');

  // Write Netlify _headers file (takes precedence over netlify.toml)
  const headersContent =
`/*
  Content-Security-Policy: ${csp}
`;

  await writeFile(join(DIST, '_headers'), headersContent, 'utf8');
  console.log('[build] Generated dist/_headers (style-src hash-locked; style-src-attr unsafe-inline for static HTML attrs)');
}

// ─── Step 5: Copy static assets ──────────────────────────────────────────────

async function copyStatic() {
  // Generate runtime config from environment variable
  // In CI (Cloudflare Pages), GAMBY_API_URL is injected via environment variable; locally falls back to localhost
  const apiUrl = (process.env.GAMBY_API_URL || 'http://localhost:4001').replace(/\/+$/, '');

  const isProduction = process.env.NODE_ENV === 'production' || process.env.CF_PAGES === '1';

  if (!process.env.GAMBY_API_URL) {
    if (isProduction) {
      console.error('[build] ERRO: GAMBY_API_URL não definido em build de produção.');
      console.error('[build] ERRO: Defina GAMBY_API_URL nas variáveis de ambiente do Cloudflare Pages.');
      process.exit(1);
    }
    console.warn('[build] WARN: GAMBY_API_URL não definido — config.js usará http://localhost:4001 (dev local)');
  } else {
    if (isProduction) {
      if (!apiUrl.startsWith('https://')) {
        console.error(`[build] ERRO: GAMBY_API_URL deve começar com https:// em produção. Recebido: ${apiUrl}`);
        process.exit(1);
      }
      if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
        console.error(`[build] ERRO: GAMBY_API_URL não pode apontar para localhost em produção. Recebido: ${apiUrl}`);
        process.exit(1);
      }
    }
    console.log(`[build] GAMBY_API_URL = ${apiUrl}`);
  }
  const buildCommit = resolveBuildCommit();
  console.log(`[build] BUILD COMMIT = ${buildCommit}`);
  await writeFile(
    join(DIST, 'assets/js/config.js'),
    buildConfigJs(apiUrl, buildCommit),
    'utf8'
  );

  // Copy data files
  const dataFile = join(ROOT, 'assets/data/default-products.json');
  if (await exists(dataFile)) {
    await copyFile(dataFile, join(DIST, 'assets/data/default-products.json'));
  }

  // Copy Service Worker to dist root (must be served from root scope)
  const swSrc = join(ROOT, 'sw.js');
  if (await exists(swSrc)) {
    await copyFile(swSrc, join(DIST, 'sw.js'));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  const mode  = OBFUSCATE ? 'minify + obfuscate' : 'minify';
  console.log(`\n[build] Starting production build (${mode})...\n`);

  console.log('[build] 1/5  Cleaning dist/...');
  await clean();

  console.log('[build] 2/5  Bundling JS (esbuild, drop console + debugger)...');
  await buildJs();

  if (OBFUSCATE) {
    console.log('[build] 2b   Applying JS obfuscation (javascript-obfuscator)...');
    await applyObfuscation();
  }

  console.log('[build] 3/5  Minifying CSS (clean-css level 2)...');
  await buildCss();

  console.log('[build] 4/5  Processing HTML (strip comments, update script src)...');
  await processHtml();

  console.log('[build] 5/5  Copying static assets + generating config.js...');
  await copyStatic();

  console.log('[build] 5b   Fetching Chart.js + computing SRI hash...');
  const sriHash = await addChartJsSri();

  console.log('[build] 5c   Computing inline-script CSP hashes + generating dist/_headers...');
  await generateCspHeaders(sriHash);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[build] Done in ${elapsed}s → dist/\n`);
  console.log('[build] Tip: run "npm run validate:frontend-security" to audit the output.\n');
}

main().catch((err) => {
  console.error('\n[build] FAILED:', err.message || err);
  process.exit(1);
});
