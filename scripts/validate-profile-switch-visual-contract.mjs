/**
 * Gamby Frontend — Profile Switch Visual Restoration Contract Validation
 *
 * BUG REAL DE STAGING (2026-09-19), Bug D: applyProfileRestrictions()
 * (profile-selector.js) só ADICIONA .hidden em #appSidebar e outros
 * seletores quando role==='operador' ("fallback cirúrgico" — ver
 * comentário no próprio arquivo) — nunca havia um caminho simétrico que
 * os REMOVESSE ao trocar de volta para Gerente/Administrador.
 * releasePDVKioskMode() (pdv-kiosk.js) só desfaz classes do <body>
 * (pdv-kiosk-active/pdv-fullscreen), não estas .hidden aplicadas
 * diretamente nos elementos — então a sidebar ficava escondida
 * permanentemente depois de qualquer sessão como Operador, mesmo depois
 * de trocar corretamente para outro perfil.
 *
 * Este script lê o CÓDIGO-FONTE REAL como texto (a função é fortemente
 * acoplada ao DOM real do app — document.querySelector/getElementById,
 * enforcePDVKioskMode, openPageDirect via window — então testá-la
 * dinamicamente exigiria montar um DOM/mocks desproporcionais ao tamanho
 * da correção; mesmo padrão de scripts/validate-phase31b-operator-security.mjs
 * para casos assim) e verifica que existe uma restauração incondicional
 * dos mesmos seletores ANTES da decisão por role.
 *
 * Usage: node scripts/validate-profile-switch-visual-contract.mjs
 * Exit code 1 se qualquer cenário falhar.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE_SELECTOR = join(ROOT, 'assets/js/profile-selector.js');

let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

/** Extrai o corpo de uma função nomeada (async ou não, balanceado por chaves). */
function extractFunctionBody(src, fnName) {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)\\s*{`);
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

const psSrc = await readFile(PROFILE_SELECTOR, 'utf8');
const fnBody = extractFunctionBody(psSrc, 'applyProfileRestrictions');

check('applyProfileRestrictions() encontrada em profile-selector.js', fnBody !== null);

if (fnBody !== null) {
  const operadorIfIdx = fnBody.indexOf("role === 'operador'");
  check("bloco if (role === 'operador') encontrado", operadorIfIdx !== -1);

  // Precisa existir, ANTES do if de operador, um trecho que remova .hidden
  // de #appSidebar de forma incondicional (não dentro de nenhum if de role).
  const beforeOperadorBlock = operadorIfIdx !== -1 ? fnBody.slice(0, operadorIfIdx) : '';
  const hasUnconditionalReset =
    /#appSidebar/.test(beforeOperadorBlock) &&
    /classList\.remove\(\s*['"]hidden['"]\s*\)/.test(beforeOperadorBlock);

  check(
    "sidebar (#appSidebar) é restaurada (.classList.remove('hidden')) incondicionalmente, antes de qualquer decisão por role",
    hasUnconditionalReset,
    hasUnconditionalReset ? 'restauração incondicional presente' : 'nenhuma restauração incondicional encontrada antes do bloco operador'
  );

  // A restauração precisa cobrir os MESMOS seletores extras que o bloco
  // operador esconde (#pdvExitOptionsBtn/#pdvSystemActionBtn), não só a
  // sidebar — senão sobra seletor esquecido (regressão parcial).
  const hidesExtraButtons = /#pdvExitOptionsBtn/.test(fnBody) && /#pdvSystemActionBtn/.test(fnBody);
  const restoresExtraButtons = /#pdvExitOptionsBtn/.test(beforeOperadorBlock) && /#pdvSystemActionBtn/.test(beforeOperadorBlock);

  check(
    'restauração incondicional também cobre os botões de sistema (#pdvExitOptionsBtn/#pdvSystemActionBtn), não só a sidebar',
    hidesExtraButtons && restoresExtraButtons,
    `esconde=${hidesExtraButtons} restaura=${restoresExtraButtons}`
  );
}

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}

console.log('applyProfileRestrictions() restaura a sidebar simetricamente ao trocar de perfil.\n');
