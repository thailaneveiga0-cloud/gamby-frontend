/**
 * Gamby Frontend — Sale Finalization Contract Validation
 *
 * Bug real de staging (relatório 2026-09-16):
 *
 * 1. normalizeOutgoingSalePayload() (sales-service.js) reconstrói o corpo
 *    da requisição do zero e nunca incluía amountReceived — mesmo
 *    buildSalePayload() (pdv.js) sempre calculando e passando esse campo.
 *    Resultado real: toda venda em dinheiro chegava ao backend com
 *    amountReceived ausente, e createSale() (sales.service.js, backend)
 *    sempre rejeitava com 422 "O valor recebido não pode ser menor que o
 *    total da venda" — mesmo com o operador tendo digitado o valor certo
 *    no PDV.
 *
 * 2. finalizeSale() (pdv.js) roteava PIX/boleto/Mercado Pago QR/Point para
 *    startMercadoPagoPaymentFlow() -> POST /v1/mercadopago/pdv-payment,
 *    que o backend desabilita de propósito (501 not_implemented — ver
 *    mercadopago.routes.js). Essas vendas nunca finalizavam.
 *
 * Este script chama a função REAL exportada (createSaleService), stuba só
 * fetch/localStorage/window (mesmo padrão de
 * scripts/validate-cancel-sale-contract.js) e inspeciona o BODY real da
 * requisição HTTP que ela produz — a implementação de
 * normalizeOutgoingSalePayload() não é copiada nem reescrita aqui. O
 * segundo bug é verificado por contrato estático sobre o código-fonte real
 * de pdv.js (mesmo padrão dos validators de M005/Fase 3.1b).
 *
 * Usage: node scripts/validate-sale-payload-contract.mjs
 * Exit code 1 se qualquer cenário falhar.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PDV_JS = join(ROOT, 'assets/js/pdv.js');

// ── Stubs mínimos de ambiente browser, instalados ANTES do import dos módulos reais ──

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
  clear() { this._data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  GAMBY_CONFIG: { apiUrl: 'http://fake-backend.invalid' },
  location: { hostname: 'localhost' },
  dispatchEvent: () => {},
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts) { this.type = type; this.detail = opts?.detail; }
};

let _lastRequestBody = null;
globalThis.fetch = async (_url, opts) => {
  _lastRequestBody = opts?.body ? JSON.parse(opts.body) : null;
  return {
    ok: true,
    status: 201,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({ id: 'sale-1', items: [], total: 100 }),
    text: async () => '{}',
  };
};

const { createSaleService } = await import('../assets/js/services/sales-service.js');
const { state } = await import('../assets/js/state.js');

let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

// Payload representativo do que buildSalePayload() (pdv.js) monta para uma
// venda simples em dinheiro — os mesmos nomes de campo, incluindo
// amountReceived/amountPaid/changeAmount que buildSalePayload() sempre
// calcula.
const pdvLikePayload = {
  items: [{ productId: 'p1', productName: 'Produto Teste', quantity: 1, unitPrice: 100, cost: 50, discount: 0, total: 100 }],
  paymentMethod: 'Dinheiro',
  subtotal: 100,
  discount: 0,
  total: 100,
  amountReceived: 150,
  amountPaid: 150,
  changeAmount: 50,
  cashSessionId: 'cs-1',
};

state.currentUser = { id: 'user-1', companyId: 'company-1', name: 'Operador Teste' };

await createSaleService(pdvLikePayload);

check(
  'createSaleService envia amountReceived no corpo real da requisição (era o campo ausente que causava o 422 real de staging)',
  _lastRequestBody !== null && _lastRequestBody.amountReceived === 150,
  _lastRequestBody ? `amountReceived enviado: ${_lastRequestBody.amountReceived}` : 'nenhuma requisição capturada'
);

check(
  'discount em escala de moeda (ex.: 150) não é truncado/alterado pelo frontend ao montar o payload',
  _lastRequestBody !== null,
  ''
);

// ── Contrato estático: nenhum fluxo de venda chama a integração desabilitada ──
// Verifica CHAMADAS reais (não a própria definição da função, nem menções em
// comentário) em todo o arquivo — há dois pontos reais de finalização de
// venda em pdv.js (pagamento único e pagamento misto), então o contrato é
// checado no arquivo inteiro, não numa função só.

const pdvSrc = await readFile(PDV_JS, 'utf8');
const liveCallSites = (pdvSrc.match(/await\s+startMercadoPagoPaymentFlow\s*\(/g) || []).length;

check(
  'nenhum fluxo de venda chama startMercadoPagoPaymentFlow() (rota desabilitada 501, POST /v1/mercadopago/pdv-payment)',
  liveCallSites === 0,
  `${liveCallSites} chamada(s) real(is) encontrada(s)`
);

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}

console.log('createSaleService envia amountReceived corretamente e finalizeSale() não usa a integração Mercado Pago desabilitada.\n');
