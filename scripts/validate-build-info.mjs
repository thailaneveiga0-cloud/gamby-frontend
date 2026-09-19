/**
 * Gamby Frontend — build identification (release instrumentation)
 *
 * INCIDENTE DE STAGING (2026-09-19): staging estava rodando um bundle ANTIGO
 * e não havia como saber isso sem baixar e inspecionar o JS. O build agora
 * grava o commit em config.js (público, sem cache imutável):
 *
 *   window.__GAMBY_BUILD_COMMIT__ = '<sha7>';
 *
 * Confirma no console do navegador (window.__GAMBY_BUILD_COMMIT__) ou com
 *   curl https://<site>/assets/js/config.js
 *
 * Usage: node scripts/validate-build-info.mjs
 */

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

let mod = null;
try { mod = await import('./build-info.mjs'); } catch { /* ainda não existe */ }
check('build-info.mjs exporta resolveBuildCommit() e buildConfigJs()', Boolean(mod?.resolveBuildCommit && mod?.buildConfigJs));

if (mod?.resolveBuildCommit) {
  const { resolveBuildCommit, buildConfigJs } = mod;
  const FULL = 'd3e47acae4d7c7e13fb4ede2ee3b8e3db364d82d';

  check('Cloudflare Pages: usa CF_PAGES_COMMIT_SHA (abreviado a 7)', resolveBuildCommit({ CF_PAGES_COMMIT_SHA: FULL }, () => 'ignorado') === 'd3e47ac');
  check('local: cai para o git rev-parse quando não há variável de CI', resolveBuildCommit({}, () => `${FULL}\n`) === 'd3e47ac');
  check('sem CI e sem git: "unknown" (o build nunca quebra por causa disso)', resolveBuildCommit({}, () => { throw new Error('no git'); }) === 'unknown');
  check('valor malformado nunca vira código injetado no config.js', resolveBuildCommit({ CF_PAGES_COMMIT_SHA: "x';alert(1);//" }, () => 'unknown') === 'unknown');

  const js = buildConfigJs('https://api.exemplo.com', 'd3e47ac');
  check('config.js mantém window.GAMBY_CONFIG.apiUrl', /window\.GAMBY_CONFIG = \{ apiUrl: 'https:\/\/api\.exemplo\.com' \};/.test(js));
  check('config.js expõe window.__GAMBY_BUILD_COMMIT__', /window\.__GAMBY_BUILD_COMMIT__ = 'd3e47ac';/.test(js));
}

console.log('');
if (failed > 0) { console.error(`${failed} cenário(s) falharam.\n`); process.exit(1); }
console.log('O build grava o commit implantado em config.js.\n');
