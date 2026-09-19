/**
 * Gamby Frontend — Cash-open parity / no-auto-open guard (B1–B5)
 *
 * MISSÃO DE FECHAMENTO DO PDV (2026-09-19), Bug B: relato de staging — "Login →
 * escolher Operador diretamente abre o caixa automaticamente; Admin → trocar
 * para Operador pergunta o valor inicial".
 *
 * RESULTADO DA INVESTIGAÇÃO (leitura estática de app.js, cash-session.js,
 * profile-selector.js, operator-session.js, pdv-kiosk.js e cash.controller.js):
 * os dois caminhos (login → seletor → Operador → PIN, e Admin → Trocar perfil →
 * Operador → PIN) passam pelo MESMO código: _confirmPin() dispara
 * 'gamby:profile-selected' e o listener de app.js chama
 * startPDVOpenCashFlow(false, forceReauth, onCancel). Não existe divergência
 * de código entre eles, e NENHUM caminho abre a sessão sem o modal: as únicas
 * chamadas de openCashSession() são openCashFromPremiumModal() (valor vindo do
 * usuário) e o fallback de reopenCashSession().
 *
 * ⚠️  ESTE VALIDATOR NASCE GREEN — NÃO reproduz o bug relatado (não existe
 * RED honesto: o código lido já obedece à regra). Ele fixa as invariantes para
 * que uma regressão futura seja pega. O auto-open relatado NÃO FOI REPRODUZIDO
 * por análise estática; falta o console real de staging ([CASH-OPEN-DEBUG]
 * ETAPA 1–4 já existem no código) e a confirmação do build implantado.
 *
 * Classificação: CONFIRMADO ESTATICAMENTE. NÃO VERIFICADO EM NAVEGADOR /
 * NÃO VERIFICADO EM STAGING.
 *
 * Usage: node scripts/validate-cash-open-parity-contract.mjs
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

function extractFunctionBody(src, fnName) {
  const m = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)\\s*{`).exec(src);
  if (!m) return null;
  let depth = 0; let i = m.index + m[0].length - 1; const start = i + 1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i); } }
  return null;
}
const codeOnly = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const cash = await readFile(join(ROOT, 'assets/js/cash-session.js'), 'utf8');
const app = await readFile(join(ROOT, 'assets/js/app.js'), 'utf8');
const allJs = { cash, app };

// B1/B2 — startPDVOpenCashFlow nunca abre a sessão diretamente
const flow = codeOnly(extractFunctionBody(cash, 'startPDVOpenCashFlow') || '');
check('startPDVOpenCashFlow() existe', flow.length > 0);
check('B1: startPDVOpenCashFlow() nunca chama openCashSession()/openCashSessionService() diretamente (nada de auto-open)', !/openCashSession\s*\(|openCashSessionService\s*\(/.test(flow));
const modalCalls = (flow.match(/openCashOpeningAmountModal\(\)/g) || []).length;
check('B2: todo ramo que segue para abrir passa pelo modal oficial de valor inicial (openCashOpeningAmountModal)', modalCalls >= 3, `chamadas ao modal=${modalCalls} (simplificado, operador já identificado, terminal/identificação)`);

// B1 — em nenhum outro arquivo/lugar a abertura é disparada sem o modal
const openCallers = [];
for (const [file, src] of Object.entries(allJs)) {
  for (const m of codeOnly(src).matchAll(/(?<![A-Za-z_])openCashSession\s*\(/g)) openCallers.push(`${file}@${m.index}`);
}
const cashCode = codeOnly(cash);
// só CHAMADAS reais (`await openCashSession(`) — não a definição nem texto de log.
// Para cada chamada, descobre em qual função ela está: a declaração de função
// mais próxima antes do ponto da chamada.
const CALL = 'await openCashSession(';
const callerFunctions = [];
let from = 0;
for (;;) {
  const at = cashCode.indexOf(CALL, from);
  if (at === -1) break;
  const before = cashCode.slice(0, at);
  const declRe = /function\s+([A-Za-z_]\w*)\s*\(/g;
  let last = null;
  for (let m = declRe.exec(before); m; m = declRe.exec(before)) last = m[1];
  callerFunctions.push(last);
  from = at + CALL.length;
}
const sortedCallers = [...callerFunctions].sort().join(',');
check(
  'B1: openCashSession() só é chamado por openCashFromPremiumModal() (modal) e pelo fallback de reopenCashSession()',
  sortedCallers === 'openCashFromPremiumModal,reopenCashSession',
  `chamadores=${sortedCallers}`
);
check('nenhum arquivo além de cash-session.js chama openCashSession()', !/(?<![A-Za-z_])openCashSession\s*\(/.test(codeOnly(app)));

// B3 — openingAmount só nasce de decisão explícita do usuário
const premium = codeOnly(extractFunctionBody(cash, 'openCashOpeningAmountModal') || '');
check('B3: valor inicial vem do botão explícito "Abrir sem valor inicial" (0 deliberado) ou do campo digitado e validado', /openCashWithoutAmountBtn/.test(premium) && /openCashFromPremiumModal\(0\)/.test(premium) && /openCashFromPremiumModal\(value\)/.test(premium) && /Valor de abertura inválido/.test(premium));
check('B3: openCashFromPremiumModal() só é chamado dentro do modal (handlers de clique)', (cashCode.match(/openCashFromPremiumModal\(/g) || []).length === 3, 'definição + 2 handlers de clique');

// B4 — caixa já aberto é reutilizado (nenhum modal / nenhuma nova sessão)
check('B4: com caixa já aberto + forceReauth, retoma a sessão existente sem abrir modal nem POST', /state\.cashSession\?\.isOpen && _forceReauth[\s\S]{0,400}Caixa em aberto retomado/.test(flow));
check('B4: sem forceReauth, caixa já aberto apenas avisa e não abre outra', /state\.cashSession\?\.isOpen && !_forceReauth[\s\S]{0,300}já está aberto/.test(flow));

// B5 — proteção contra sessão duplicada
const openBody = codeOnly(extractFunctionBody(cash, 'openCashSession') || '');
check('B5: openCashSession() devolve a sessão existente se já houver caixa aberto (não cria duas)', /if\s*\(state\.cashSession\?\.isOpen\)\s*{[\s\S]{0,200}return state\.cashSession/.test(openBody));

// A entrada do seletor de perfil é única e comum aos dois caminhos
const listener = codeOnly(app.slice(app.indexOf("window.addEventListener('gamby:profile-selected'"), app.indexOf("bindAction('logout'")));
check('paridade: o listener único de profile-selected chama startPDVOpenCashFlow() com forceReauth para Operador/Gerente (mesmo código para login→Operador e Admin→Trocar perfil)', /startPDVOpenCashFlow\(false,\s*_justSelectedProfile/.test(listener));
check('paridade: nenhuma chamada a openCashSession()/openCashSessionService() no listener de profile-selected', !/openCashSession(Service)?\s*\(/.test(listener));

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}
console.log('Nenhum caminho de código abre o caixa sem o modal oficial de valor inicial (auto-open relatado NÃO reproduzido estaticamente).\n');
