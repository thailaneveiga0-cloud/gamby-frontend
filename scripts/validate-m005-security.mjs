/**
 * Gamby Frontend — M005 Security Validation (D1 + D2)
 *
 * D1: controlPin/controlPassword não podem mais ser derivados automaticamente
 *     do CPF em assets/js/user-management.js (criação, edição, fallback
 *     local, payloads persistentes).
 * D2: os textos visíveis do modal de autorização (assets/js/app.js) não
 *     podem instruir o usuário a usar dígitos do CPF como credencial.
 *
 * Este repositório não tem framework de teste instalado (ver package.json).
 * Este script lê o CÓDIGO-FONTE REAL como texto e verifica contratos
 * estáticos fortes (contagem de call-sites reais, extração dos argumentos
 * reais passados às funções de serviço, extração do template literal real
 * do modal) — a implementação de user-management.js/app.js não é copiada
 * nem reescrita aqui.
 *
 * Usage: node scripts/validate-m005-security.mjs
 * Exit code 1 se qualquer cenário falhar.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_MGMT = join(ROOT, 'assets/js/user-management.js');
const APP_JS = join(ROOT, 'assets/js/app.js');

let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

/** Extrai o texto dos argumentos de uma chamada `fnName(...)` (balanceado por parênteses). */
function extractCallArgs(src, fnName) {
  const startMarker = `${fnName}(`;
  const idx = src.indexOf(startMarker);
  if (idx === -1) return null;
  let depth = 0;
  let i = idx + startMarker.length - 1; // posição do '(' de abertura
  const argsStart = i + 1;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(argsStart, i);
    }
  }
  return null; // não balanceado — não deveria acontecer em código válido
}

/** Extrai o corpo de uma função nomeada (balanceado por chaves). */
function extractFunctionBody(src, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*{`);
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0;
  let i = m.index + m[0].length - 1; // posição do '{' de abertura
  const bodyStart = i + 1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
  }
  return null;
}

/** Extrai o conteúdo de um template literal (delimitado por `) a partir de um marcador. */
function extractTemplateLiteral(src, marker) {
  const idx = src.indexOf(marker);
  if (idx === -1) return null;
  const start = src.indexOf('`', idx);
  if (start === -1) return null;
  let i = start + 1;
  for (; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') return src.slice(start + 1, i);
  }
  return null;
}

async function main() {
  console.log('\n=== M005 — Validação D1 (CPF -> controlPin/controlPassword) + D2 (texto de UI) ===\n');

  const userMgmtSrc = await readFile(USER_MGMT, 'utf8');
  const appSrc = await readFile(APP_JS, 'utf8');

  // ── D1 ──────────────────────────────────────────────────────────────────

  const buildFnCallSites = (userMgmtSrc.match(/buildControlPasswordFromCPF\s*\(/g) || []).length;
  check(
    'D1-A/B: buildControlPasswordFromCPF não tem call-sites executáveis em user-management.js',
    buildFnCallSites === 0,
    `${buildFnCallSites} ocorrência(s) encontrada(s)`
  );

  const createArgs = extractCallArgs(userMgmtSrc, 'createUserService');
  const createSendsControlSecret = createArgs !== null && /\bcontrolPin\s*:|\bcontrolPassword\s*:/.test(createArgs);
  check(
    'D1-C: payload de createUserService() não envia controlPin/controlPassword',
    createArgs !== null && !createSendsControlSecret,
    createArgs === null ? 'chamada createUserService não encontrada' : (createSendsControlSecret ? 'controlPin/controlPassword presente no payload' : 'campo ausente, como esperado')
  );

  const updateArgs = extractCallArgs(userMgmtSrc, 'updateUserService');
  const updateSendsControlSecret = updateArgs !== null && /\bcontrolPin\s*:|\bcontrolPassword\s*:/.test(updateArgs);
  check(
    'D1-D: payload de updateUserService() não envia controlPin/controlPassword (edição nunca reescreve a credencial)',
    updateArgs !== null && !updateSendsControlSecret,
    updateArgs === null ? 'chamada updateUserService não encontrada' : (updateSendsControlSecret ? 'controlPin/controlPassword presente no payload' : 'campo ausente, como esperado')
  );

  const mapBackendBody = extractFunctionBody(userMgmtSrc, 'mapBackendUserToInternalUser');
  check(
    'D1: mapBackendUserToInternalUser() não deriva controlPin/controlPassword do CPF',
    mapBackendBody !== null && !/buildControlPasswordFromCPF/.test(mapBackendBody),
    mapBackendBody === null ? 'função não encontrada' : undefined
  );

  const mapLocalBody = extractFunctionBody(userMgmtSrc, 'mapLocalUser');
  check(
    'D1: mapLocalUser() (fallback local) não deriva controlPin/controlPassword do CPF',
    mapLocalBody !== null && !/buildControlPasswordFromCPF/.test(mapLocalBody),
    mapLocalBody === null ? 'função não encontrada' : undefined
  );

  // ── D2 ──────────────────────────────────────────────────────────────────

  const modalTemplate = extractTemplateLiteral(appSrc, 'secureCashActionOverlay');
  check(
    'D2: template do modal de autorização (overlay.innerHTML) não menciona CPF',
    modalTemplate !== null && !/CPF/i.test(modalTemplate),
    modalTemplate === null ? 'template do modal não encontrado' : (/CPF/i.test(modalTemplate) ? 'texto "CPF" ainda presente' : 'sem menção a CPF')
  );

  const openModalBody = extractFunctionBody(appSrc, 'openSecureCashCloseModal');
  check(
    'D2: corpo de openSecureCashCloseModal() não contém texto visível referenciando CPF como credencial',
    openModalBody !== null && !/CPF/i.test(openModalBody),
    openModalBody === null ? 'função não encontrada' : (/CPF/i.test(openModalBody) ? 'texto "CPF" ainda presente' : 'sem menção a CPF')
  );

  console.log('');
  if (failed > 0) {
    console.error(`${failed} cenário(s) falharam.\n`);
    process.exit(1);
  }

  console.log('Todos os contratos D1/D2 confirmados no código-fonte real.\n');
}

main().catch((err) => {
  console.error('[validate-m005-security] Fatal error:', err.message);
  process.exit(1);
});
