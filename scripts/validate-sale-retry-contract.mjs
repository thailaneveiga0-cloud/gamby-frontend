/**
 * Gamby Frontend — Sale finalization / retry / single-POST contract
 *
 * MISSÃO DE FECHAMENTO DO PDV (2026-09-19), Bug F (F10 / retry / duplicate POST).
 *
 * Todo caminho que persiste venda no PDV (F10/#finalizeSaleBtn → finalizeSale()
 * e o #pmConfirm do modal de pagamento) converge em UMA função,
 * persistApprovedSale(). Antes desta correção ela não tinha proteção contra
 * execução concorrente: duplo clique / F10 durante a requisição podia disparar
 * dois POST /v1/sales (venda duplicada).
 *
 * Classificação da evidência:
 *   - single-flight.js: VALIDADO LOCALMENTE (função real importada e executada)
 *   - convergência/ordem em pdv.js: CONFIRMADO ESTATICAMENTE (pdv.js é acoplado
 *     ao DOM; mesmo padrão de validate-payment-modal-state-contract.mjs)
 *   - NÃO VERIFICADO EM NAVEGADOR / NÃO VERIFICADO EM STAGING
 *
 * Usage: node scripts/validate-sale-retry-contract.mjs
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

// ── 1) helper single-flight (execução real) ───────────────────────────────────
let createSingleFlight = null;
try {
  ({ createSingleFlight } = await import('../assets/js/single-flight.js'));
} catch { /* ainda não existe → checks abaixo falham */ }

check('single-flight.js exporta createSingleFlight()', typeof createSingleFlight === 'function');

if (typeof createSingleFlight === 'function') {
  // V7: duas chamadas concorrentes → a função interna roda UMA vez
  const run = createSingleFlight();
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = run(async () => { calls++; await gate; return 'ok'; });
  const second = await run(async () => { calls++; return 'dup'; });
  release();
  const firstResult = await first;
  check('V7: segunda chamada concorrente é descartada (skipped) e a função roda uma única vez', second.skipped === true && calls === 1 && firstResult.value === 'ok', `calls=${calls}`);

  // V6: depois de sucesso, a próxima tentativa roda normalmente
  const afterOk = await run(async () => 'segunda-tentativa');
  check('V6: depois de concluir com sucesso, nova tentativa é aceita', afterOk.skipped === false && afterOk.value === 'segunda-tentativa');

  // V5/V6: depois de FALHA, o lock é liberado (retry funciona) e o erro propaga
  const runF = createSingleFlight();
  let thrown = null;
  try { await runF(async () => { throw new Error('Erro interno do servidor.'); }); } catch (e) { thrown = e; }
  const retry = await runF(async () => 'retry-ok');
  check('V4/V5: falha propaga o erro (não vira sucesso falso) e libera o lock', thrown?.message === 'Erro interno do servidor.' && retry.skipped === false && retry.value === 'retry-ok');
}

// ── 2) pdv.js: convergência e guarda (estático) ───────────────────────────────
const pdv = await readFile(join(ROOT, 'assets/js/pdv.js'), 'utf8');

const persistBody = extractFunctionBody(pdv, 'persistApprovedSale') || '';
check('persistApprovedSale() usa o single-flight (uma venda em voo por vez)', /_saleSingleFlight\s*\(/.test(persistBody), persistBody ? '' : 'função não encontrada');

// Chamadores conhecidos: finalizeSale, #pmConfirm (_openPaymentModal) e
// pollMercadoPagoStatus (código morto desde a remoção do roteamento
// Mercado Pago, mas continua sendo um caminho de persistência). Todos passam
// pela MESMA função, então o guard único os cobre.
const callers = [...pdv.matchAll(/await\s+persistApprovedSale\(/g)].length;
check('os 3 chamadores conhecidos (finalizeSale, #pmConfirm, pollMercadoPagoStatus[morto]) convergem em persistApprovedSale — nenhum caminho novo', callers === 3, `chamadores=${callers}`);

const directPost = [...pdv.matchAll(/createSaleService\(/g)].length;
check('createSaleService() só é chamado dentro de persistApprovedSale (único caminho ao POST /v1/sales)', directPost === 1, `ocorrências=${directPost}`);

const finalizeBody = extractFunctionBody(pdv, 'finalizeSale') || '';
const emptyIdx = finalizeBody.indexOf('!getPaymentMethodField()?.value');
const cashIdx = finalizeBody.indexOf("paymentMethod === 'dinheiro' && amountPaid < total");
check('V1: sem forma selecionada, finalizeSale() abre o modal ANTES de qualquer checagem do campo inferior', emptyIdx !== -1 && cashIdx !== -1 && emptyIdx < cashIdx && /_openPaymentModal\(\)/.test(finalizeBody.slice(emptyIdx, cashIdx)));

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}
console.log('Finalização de venda converge em um único caminho, protegido contra POST duplicado.\n');
