/**
 * Gamby Frontend — Cash Close Contract Validation (Fase 3.1a, Camada A)
 *
 * Prova, contra a implementação REAL de produção (não uma cópia), que:
 *
 *   countedAmount digitado -> payload -> corpo de POST /v1/cash-sessions/:id/close
 *
 * incluindo o caso countedAmount=0 (contagem legítima, não "ausente") e o
 * caso countedAmount ausente (omitido do corpo, comportamento já existente
 * e coberto pelos testes HTTP do backend — reconfirmado aqui na camada de
 * service do frontend).
 *
 * Isto é a Camada A (contrato/service) do bloqueador ALTO B — ver
 * docs/staging-final-checklist.md. A Camada B (renderização de
 * Esperado/Contado/Diferença/Status e a obrigatoriedade de contagem na tela
 * de conferência, em cash-session.js) NÃO é exercitada aqui: as funções
 * envolvidas (updateCashCloseSummary, setCashDifferenceVisual,
 * requestProtectedCashClose) não são exportadas — exportá-las só para
 * facilitar este script não tem necessidade técnica real, e reproduzir o
 * DOM inteiro da tela reimplementaria a tela dentro do script. Por isso a
 * Camada B fica CONFIRMADA ESTATICAMENTE (leitura de código) e NÃO
 * VERIFICADA EM NAVEGADOR — ver o checklist.
 *
 * Este repositório não tem framework de teste instalado. Este script roda
 * em Node puro e stuba os globais mínimos de que a cadeia real
 * closeCashSessionService -> httpRequest -> fetch depende, ANTES de
 * importar os módulos reais.
 *
 * Usage: node scripts/validate-cash-close-contract.js
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
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({ id: 'cs-1', status: 'closed', ...(_lastFetchBody || {}) }),
    text: async () => JSON.stringify(_lastFetchBody || {}),
  };
};

const { closeCashSessionService } = await import('../assets/js/services/cash-service.js');

let failed = 0;

async function scenario(name, payload, expect) {
  _lastFetchBody = null;
  await closeCashSessionService('cs-1', payload);

  const ok = expect(_lastFetchBody);
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` (body enviado: ${JSON.stringify(_lastFetchBody)})`}`);
  if (!ok) failed++;
}

await scenario(
  'countedAmount = 0 (contagem legítima) -> body contém countedAmount: 0, não omitido',
  { closingAmount: 150, countedAmount: 0 },
  (body) => body && Object.prototype.hasOwnProperty.call(body, 'countedAmount') && body.countedAmount === 0
);

await scenario(
  'countedAmount = valor digitado igual ao esperado -> body reflete exatamente o valor',
  { closingAmount: 150, countedAmount: 150 },
  (body) => body?.countedAmount === 150
);

await scenario(
  'countedAmount = valor digitado acima do esperado (sobra) -> body reflete o valor real, não o esperado',
  { closingAmount: 150, countedAmount: 200 },
  (body) => body?.countedAmount === 200
);

await scenario(
  'countedAmount = valor digitado abaixo do esperado (falta) -> body reflete o valor real, não o esperado',
  { closingAmount: 150, countedAmount: 80 },
  (body) => body?.countedAmount === 80
);

await scenario(
  'countedAmount ausente (undefined) -> omitido do body, não convertido para 0 nem para closingAmount',
  { closingAmount: 150 },
  (body) => body && !Object.prototype.hasOwnProperty.call(body, 'countedAmount')
);

if (failed > 0) {
  console.error(`\n${failed} cenário(s) do contrato de fechamento de caixa falharam.`);
  process.exit(1);
}

console.log('\ncloseCashSessionService: countedAmount digitado chega intacto ao corpo de POST /v1/cash-sessions/:id/close em todos os cenários testados (Camada A).');
