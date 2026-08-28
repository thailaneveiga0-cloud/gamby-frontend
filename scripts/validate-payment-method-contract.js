/**
 * Gamby Frontend — Payment Method Contract Validation
 *
 * Fase 2 (D1.5, Camada A): importa a implementação REAL de normalização de
 * forma de pagamento (normalizePaymentMethod, ex-_PM_MAP) de
 * assets/js/services/sales-service.js — nunca uma cópia. Para cada uma das
 * 10 opções reais do <select id="salePaymentMethod"> (index.html), confirma
 * o canônico produzido. Se normalizePaymentMethod() mudar de comportamento
 * no futuro sem que este script seja atualizado, ele vai FALHAR (não passar
 * silenciosamente) — é o objetivo de D1.6.
 *
 * Usage: node scripts/validate-payment-method-contract.js
 * Exit code 1 se qualquer expectativa falhar.
 */

import { normalizePaymentMethod } from '../assets/js/services/sales-service.js';

// As 10 opções reais do <select id="salePaymentMethod"> — index.html:1016-1027.
// Canônico esperado: o que normalizePaymentMethod() REALMENTE produz hoje
// (lido do código, não presumido) — ver relatório da Fase 1 desta sessão.
const CASES = [
  ['Dinheiro',            'cash'],
  ['PIX',                 'pix'],
  ['Crédito',             'credit'],
  ['Débito',              'debit'],
  ['Voucher',             'voucher'],
  ['A prazo',             'other'],
  ['Misto',               'mixed'],
  ['Mercado Pago QR',     'other'],
  ['Mercado Pago Point',  'other'],
  ['Boleto',              'other'],
];

let failed = 0;

for (const [uiLabel, expectedCanonical] of CASES) {
  const actual = normalizePaymentMethod(uiLabel);
  const ok = actual === expectedCanonical;
  console.log(`${ok ? '✅' : '❌'} "${uiLabel}" -> "${actual}" (esperado: "${expectedCanonical}")`);
  if (!ok) failed++;
}

// Valor vazio/ausente -> fallback documentado ('cash', não lançar exceção).
const emptyOk = normalizePaymentMethod('') === 'cash' && normalizePaymentMethod(undefined) === 'cash';
console.log(`${emptyOk ? '✅' : '❌'} valor vazio/ausente -> fallback "cash"`);
if (!emptyOk) failed++;

if (failed > 0) {
  console.error(`\n${failed} caso(s) de contrato de paymentMethod falharam.`);
  process.exit(1);
}

console.log('\nTodos os 10 rótulos reais da UI + fallback vazio produzem o canônico esperado.');
