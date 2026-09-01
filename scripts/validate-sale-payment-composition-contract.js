/**
 * Gamby Frontend — Sale Payment Composition Contract Validation
 * (Fase 3.1a-bis, ALTO C, C2)
 *
 * Prova, contra a implementação REAL de produção (não uma cópia), que a
 * composição por forma de pagamento sai do fluxo de venda e chega intacta
 * (e normalizada) ao corpo de POST /v1/sales:
 *
 *   payload.payments (rótulos de UI, ex.: "Dinheiro"/"PIX")
 *   -> normalizeOutgoingSalePayload() (sales-service.js, implementação real)
 *   -> createSaleService()
 *   -> corpo de POST /v1/sales
 *
 * incluindo:
 *   - normalização de cada `method` via normalizePaymentMethod() real (não
 *     uma cópia do _PM_MAP) — o mesmo validador de
 *     validate-payment-method-contract.js prova essa função isoladamente;
 *     aqui provamos que ela é de fato aplicada dentro do pipeline de venda;
 *   - venda de método único (sem `payments`) -> campo omitido do corpo,
 *     não inventado;
 *   - venda mista (`payments` com 2+ parcelas) -> array preservado, cada
 *     `amount` numérico.
 *
 * Este script NÃO exercita pdv.js (_openPaymentModal(), o ponto onde a
 * composição real é montada a partir da interação do usuário) — aquilo
 * depende de DOM/eventos que reproduziriam a tela inteira dentro do script
 * (proibido pela disciplina desta fase). Essa parte fica CONFIRMADA
 * ESTATICAMENTE (leitura de pdv.js) e NÃO VERIFICADA EM NAVEGADOR — ver
 * docs/staging-final-checklist.md, ALTO C.
 *
 * Este repositório não tem framework de teste instalado. Este script roda
 * em Node puro e stuba os globais mínimos de que a cadeia real
 * createSaleService -> httpRequest -> fetch depende, ANTES de importar os
 * módulos reais.
 *
 * Usage: node scripts/validate-sale-payment-composition-contract.js
 * Exit code 1 se qualquer cenário falhar.
 */

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

let _lastFetchBody = null;
globalThis.fetch = async (_url, options = {}) => {
  _lastFetchBody = options?.body ? JSON.parse(options.body) : null;
  return {
    ok: true,
    status: 201,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({ id: 'sale-1', ...(_lastFetchBody || {}) }),
    text: async () => JSON.stringify(_lastFetchBody || {}),
  };
};

const { createSaleService } = await import('../assets/js/services/sales-service.js');

let failed = 0;

async function scenario(name, payload, expect) {
  _lastFetchBody = null;
  await createSaleService(payload);

  const ok = expect(_lastFetchBody);
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` (body enviado: ${JSON.stringify(_lastFetchBody)})`}`);
  if (!ok) failed++;
}

await scenario(
  'venda mista (parcelas Dinheiro+PIX) -> payments normalizado (cash/pix) e preservado no body',
  {
    items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
    paymentMethod: 'Misto',
    total: 100,
    payments: [
      { method: 'Dinheiro', amount: 30 },
      { method: 'PIX', amount: 70 },
    ],
  },
  (body) => Array.isArray(body?.payments)
    && body.payments.length === 2
    && body.payments[0].method === 'cash' && body.payments[0].amount === 30
    && body.payments[1].method === 'pix' && body.payments[1].amount === 70
);

await scenario(
  'venda de método único sem payments -> campo omitido do body (backend deriva sozinho)',
  {
    items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
    paymentMethod: 'Dinheiro',
    total: 100,
  },
  (body) => body && !Object.prototype.hasOwnProperty.call(body, 'payments')
);

await scenario(
  'venda mista com 3 parcelas (Dinheiro+Crédito+Voucher) -> todas preservadas, normalizadas',
  {
    items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
    paymentMethod: 'Misto',
    total: 100,
    payments: [
      { method: 'Dinheiro', amount: 20 },
      { method: 'Crédito', amount: 50 },
      { method: 'Voucher', amount: 30 },
    ],
  },
  (body) => Array.isArray(body?.payments)
    && body.payments.length === 3
    && body.payments.map(p => p.method).join(',') === 'cash,credit,voucher'
    && body.payments.reduce((s, p) => s + p.amount, 0) === 100
);

if (failed > 0) {
  console.error(`\n${failed} cenário(s) do contrato de composição de pagamento falharam.`);
  process.exit(1);
}

console.log('\ncreateSaleService: composição por forma de pagamento normalizada e preservada no corpo de POST /v1/sales em todos os cenários testados.');
