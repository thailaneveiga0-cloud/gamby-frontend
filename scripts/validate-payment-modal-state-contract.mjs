/**
 * Gamby Frontend — Payment Modal / Bottom Bar State Consistency Contract
 *
 * BUG REAL DE STAGING (2026-09-19), Bug C: existem duas superfícies de
 * pagamento no PDV — o dropdown/campo "valor recebido" na área inferior
 * (lidos por finalizeSale(), acionada por F10 -> #finalizeSaleBtn) e o
 * modal de pagamento (_openPaymentModal(), que trabalha com sua própria
 * lista de parcelas/soma paga). O confirm do modal (#pmConfirm) setava
 * sel.value (o dropdown da área inferior) para o backend receber
 * paymentMethod, mas NUNCA sincronizava #amountPaid (a área inferior) com
 * a soma paga no modal. Se a venda falhasse (POST /v1/sales rejeitado), o
 * dropdown ficava com um método preenchido enquanto #amountPaid continuava
 * vazio — uma combinação que finalizeSale() nunca produziria sozinha. Um
 * F10 seguinte não reabria o modal (porque paymentMethod não estava mais
 * vazio) e caía direto na checagem de valor insuficiente, com uma
 * mensagem que não correspondia ao que o operador via na tela.
 *
 * Este script lê o CÓDIGO-FONTE REAL como texto (a função é fortemente
 * acoplada ao DOM/carrinho do PDV — reproduzi-la dinamicamente exigiria
 * montar um DOM completo desproporcional ao tamanho da correção; mesmo
 * padrão de scripts/validate-profile-switch-visual-contract.mjs para
 * casos assim) e verifica que o catch do confirm do modal restaura o
 * dropdown e o campo de valor recebido da área inferior para o estado
 * "nada selecionado" — o mesmo estado que faz F10 reabrir o modal.
 *
 * Usage: node scripts/validate-payment-modal-state-contract.mjs
 * Exit code 1 se qualquer cenário falhar.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PDV_JS = join(ROOT, 'assets/js/pdv.js');

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

const pdvSrc = await readFile(PDV_JS, 'utf8');
const modalBody = extractFunctionBody(pdvSrc, '_openPaymentModal');

check('_openPaymentModal() encontrada em pdv.js', modalBody !== null);

if (modalBody !== null) {
  // Localiza o catch específico do confirm (identificado pela mensagem de
  // erro real usada ali) e olha só o trecho logo depois dele.
  const catchIdx = modalBody.indexOf("showToast(err?.message || 'Erro ao finalizar venda.', 'error');");
  check('catch do #pmConfirm encontrado (mensagem de erro real)', catchIdx !== -1);

  if (catchIdx !== -1) {
    // Janela generosa o bastante para cobrir até o próximo `}` do catch,
    // sem depender de contar chaves manualmente para um trecho pequeno.
    const afterCatch = modalBody.slice(catchIdx, catchIdx + 1500);

    const resetsDropdown = /sel\.value\s*=\s*['"]{2}/.test(afterCatch);
    const resetsAmountField = /getAmountPaidEl\(\)/.test(afterCatch) && /\.value\s*=\s*['"]{2}/.test(afterCatch);

    check(
      'ao falhar, o dropdown de forma de pagamento (sel) volta para vazio (mesmo estado que faz F10 reabrir o modal)',
      resetsDropdown,
      resetsDropdown ? 'reset presente' : 'sel.value não é limpo no catch'
    );

    check(
      'ao falhar, o campo #amountPaid (área inferior) também é limpo — evita a combinação inconsistente que confundia o F10 seguinte',
      resetsAmountField,
      resetsAmountField ? 'reset presente' : 'getAmountPaidEl() não é limpo no catch'
    );
  }

  // A modal continua fechando ANTES da tentativa (_closePaymentModal antes
  // do try) — comportamento pré-existente, não alterado por esta correção.
  // F10 é o caminho de nova tentativa: só faz sentido se o estado acima
  // realmente ficar consistente com "nenhum pagamento selecionado".
  const closesBeforeTry = /_closePaymentModal\(\);\s*\n\s*try\s*{/.test(modalBody);
  check(
    '_closePaymentModal() continua chamada antes da tentativa (comportamento pré-existente preservado — retry é via F10, não reabertura automática)',
    closesBeforeTry
  );
}

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}

console.log('Modal de pagamento e área inferior ficam consistentes após uma tentativa falha.\n');
