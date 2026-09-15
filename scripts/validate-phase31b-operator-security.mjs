/**
 * Gamby Frontend — Fase 3.1b Operator Identity Security Validation
 *
 * Verifica os contratos F1-F12 do relatório da Fase 3.1b:
 *   F1/F2  — profile-selector.js não lê user.controlPin/controlPassword.
 *   F3     — sem comparação local de PIN (validateOperatorPin removida).
 *   F4     — seleção Gerente/Operador usa a API real de OperatorPin
 *            (loginWithPinService, POST /v1/pdv/operator-pin/login).
 *   F5     — lista de operadores vem de listOperatorsService()
 *            (GET /v1/pdv/operators), não de GET /v1/users.
 *   F7/F8/F9 — PIN nunca é gravado em activeProfile/sessionStorage/
 *            localStorage (só identidade não-secreta: id/name/role).
 *   F11    — requireOperatorSession() não tem bypass baseado só na
 *            presença de sessionStorage['gamby_active_profile'].
 *   F12    — profile-selector.js não deriva PIN do CPF (sem .slice(-4)/
 *            .slice(0,4) sobre dígitos de CPF).
 *
 * F6 (hasPin só como booleano), F10 (activeProfile só após validação) e
 * F13/F14 (comentários legados removidos) são qualitativos — confirmados
 * por leitura direta do código no relatório da missão, não checados aqui
 * por regex (não são propriedades expressáveis como contrato estático
 * forte sem reimplementar a lógica).
 *
 * Este repositório não tem framework de teste instalado (ver package.json).
 * Este script lê o CÓDIGO-FONTE REAL como texto e verifica contratos
 * estáticos fortes — a implementação de profile-selector.js/
 * operator-session.js não é copiada nem reescrita aqui.
 *
 * Usage: node scripts/validate-phase31b-operator-security.mjs
 * Exit code 1 se qualquer cenário falhar.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE_SELECTOR = join(ROOT, 'assets/js/profile-selector.js');
const OPERATOR_SESSION = join(ROOT, 'assets/js/operator-session.js');

let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

/** Extrai o corpo de uma função nomeada (async ou não, balanceado por chaves). */
function extractFunctionBody(src, fnName) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)\\s*{`);
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0;
  let i = m.index + m[0].length - 1;
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

async function main() {
  console.log('\n=== Fase 3.1b — Validação de identidade operacional segura (F1-F12) ===\n');

  const psSrc = await readFile(PROFILE_SELECTOR, 'utf8');
  const osSrc = await readFile(OPERATOR_SESSION, 'utf8');

  // ── F1/F2 ───────────────────────────────────────────────────────────────

  const controlPinRefs = (psSrc.match(/\bcontrolPin\b/g) || []).length;
  check('F1: profile-selector.js não lê/referencia controlPin', controlPinRefs === 0, `${controlPinRefs} ocorrência(s)`);

  const controlPasswordRefs = (psSrc.match(/\bcontrolPassword\b/g) || []).length;
  check('F2: profile-selector.js não lê/referencia controlPassword', controlPasswordRefs === 0, `${controlPasswordRefs} ocorrência(s)`);

  // ── F3 ──────────────────────────────────────────────────────────────────

  const hasLocalValidateFn = /function\s+validateOperatorPin\s*\(/.test(psSrc);
  check('F3: validateOperatorPin (comparação local de PIN) não existe mais em profile-selector.js', !hasLocalValidateFn);

  // ── F4 ──────────────────────────────────────────────────────────────────

  const importsLoginWithPin = /import\s*\{[^}]*\bloginWithPinService\b[^}]*\}\s*from\s*['"]\.\/services\/pin-service\.js['"]/.test(psSrc);
  const callsLoginWithPin = /\bloginWithPinService\s*\(/.test(psSrc);
  check(
    'F4: profile-selector.js usa a API real de OperatorPin (loginWithPinService, de services/pin-service.js)',
    importsLoginWithPin && callsLoginWithPin,
    `import=${importsLoginWithPin} call=${callsLoginWithPin}`
  );

  // ── F5 ──────────────────────────────────────────────────────────────────

  const loadProfileUsersBody = extractFunctionBody(psSrc, 'loadProfileUsers');
  check(
    'F5: loadProfileUsers() usa listOperatorsService() (GET /v1/pdv/operators), não listUsersService()',
    loadProfileUsersBody !== null && /listOperatorsService\s*\(/.test(loadProfileUsersBody) && !/listUsersService\s*\(/.test(loadProfileUsersBody),
    loadProfileUsersBody === null ? 'função não encontrada' : undefined
  );

  // ── F7/F8/F9 ────────────────────────────────────────────────────────────

  const confirmPinBody = extractFunctionBody(psSrc, '_confirmPin');
  const currentOperatorLiteralMatch = confirmPinBody
    ? /state\.currentOperator\s*=\s*\{([^}]*)\}/.exec(confirmPinBody)
    : null;
  const currentOperatorLiteral = currentOperatorLiteralMatch ? currentOperatorLiteralMatch[1] : '';
  const currentOperatorHasSecret = /\bpin\b|\bcontrolPin\b|\bcontrolPassword\b|\bpinHash\b/i.test(currentOperatorLiteral);
  check(
    'F7/F9: state.currentOperator (persistido em localStorage) não contém pin/controlPin/pinHash',
    confirmPinBody !== null && !currentOperatorHasSecret,
    confirmPinBody === null ? '_confirmPin não encontrada' : (currentOperatorHasSecret ? 'campo secreto encontrado no literal' : 'só identidade não-secreta')
  );

  const setActiveProfileCalls = psSrc.match(/_setActiveProfile\s*\(([^)]*)\)/g) || [];
  const anyActiveProfileCallHasPin = setActiveProfileCalls.some((call) => /\bpin\b/i.test(call));
  check(
    'F8: nenhuma chamada a _setActiveProfile() (sessionStorage) passa um campo pin',
    setActiveProfileCalls.length > 0 && !anyActiveProfileCallHasPin,
    `${setActiveProfileCalls.length} chamada(s) encontrada(s)`
  );

  // ── F11 ─────────────────────────────────────────────────────────────────

  const requireOpSessionBody = extractFunctionBody(osSrc, 'requireOperatorSession');
  const hasActiveProfileBypass = requireOpSessionBody !== null &&
    /sessionStorage\.getItem\(\s*['"]gamby_active_profile['"]\s*\)/.test(requireOpSessionBody);
  check(
    'F11: requireOperatorSession() não tem bypass baseado só em sessionStorage["gamby_active_profile"]',
    requireOpSessionBody !== null && !hasActiveProfileBypass,
    requireOpSessionBody === null ? 'função não encontrada' : (hasActiveProfileBypass ? 'bypass ainda presente' : 'bypass ausente')
  );

  // ── F12 ─────────────────────────────────────────────────────────────────

  const cpfSliceFallbacks = (psSrc.match(/\.slice\(-4\)|\.slice\(0,\s*4\)/g) || []).length;
  check(
    'F12: profile-selector.js não deriva PIN a partir de dígitos do CPF (.slice(-4)/.slice(0,4))',
    cpfSliceFallbacks === 0,
    `${cpfSliceFallbacks} ocorrência(s)`
  );

  console.log('');
  if (failed > 0) {
    console.error(`${failed} cenário(s) falharam.\n`);
    process.exit(1);
  }

  console.log('Todos os contratos F1-F5/F7-F9/F11-F12 confirmados no código-fonte real.\n');
}

main().catch((err) => {
  console.error('[validate-phase31b-operator-security] Fatal error:', err.message);
  process.exit(1);
});
