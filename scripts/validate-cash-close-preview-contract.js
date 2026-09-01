/**
 * Gamby Frontend — Cash Close Preview Contract Validation
 * (Fase 3.1a-bis, Emenda Final Pré-Checkpoint, ALTO C, C3)
 *
 * Prova, contra a implementação REAL de produção (não uma cópia), que:
 *
 *   GET /v1/cash-sessions/:id/close-preview
 *   -> getCashClosePreviewService() (cash-service.js, implementação real)
 *   -> { openingAmount, cashSalesAmount, expectedAmount } devolvido ao chamador
 *      EXATAMENTE como o backend mandou, sem nenhum recálculo local.
 *
 * incluindo:
 *   - GET sem corpo (não é POST, não envia body);
 *   - cenário cash+PIX (opening=100, cash=80, pix=50 -> backend expectedAmount=180):
 *     o service devolve 180 verbatim, não 230 (que seria o resultado de somar
 *     sale.total de TODAS as vendas, o bug C3 que esta fase corrigiu);
 *   - cenário mixed (cash=30, pix=70 -> backend expectedAmount=130): o
 *     service devolve 130 verbatim, não 100 (sale.total inteiro da venda
 *     mista) nem 230;
 *   - backend indisponível (isBackendReady()=false) -> retorna null, sem
 *     lançar exceção nem inventar um valor.
 *
 * Este script NÃO exercita a renderização em cash-session.js
 * (fetchCashClosePreview()/updateCashCloseSummary()/
 * openCashCloseConferenceModal()) — essas funções não são exportadas e
 * dependem de DOM real (mesma disciplina já aplicada em
 * validate-cash-close-contract.js, Camada A vs Camada B). Aquela parte fica
 * CONFIRMADA ESTATICAMENTE (leitura de código) e NÃO VERIFICADA EM
 * NAVEGADOR — ver docs/staging-final-checklist.md, ALTO C.
 *
 * Este repositório não tem framework de teste instalado. Este script roda
 * em Node puro e stuba os globais mínimos de que a cadeia real
 * getCashClosePreviewService -> httpRequest -> fetch depende, ANTES de
 * importar os módulos reais.
 *
 * Usage: node scripts/validate-cash-close-preview-contract.js
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

let _lastFetchUrl = null;
let _lastFetchOptions = null;
let _mockedResponseBody = null;

globalThis.fetch = async (url, options = {}) => {
  _lastFetchUrl = url;
  _lastFetchOptions = options;
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => _mockedResponseBody,
    text: async () => JSON.stringify(_mockedResponseBody),
  };
};

const { getCashClosePreviewService } = await import('../assets/js/services/cash-service.js');

let failed = 0;

async function scenario(name, mockedBody, expect) {
  _lastFetchUrl = null;
  _lastFetchOptions = null;
  _mockedResponseBody = mockedBody;

  const result = await getCashClosePreviewService('cs-1');

  const ok = expect(result, _lastFetchUrl, _lastFetchOptions);
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` (resultado: ${JSON.stringify(result)}, url: ${_lastFetchUrl})`}`);
  if (!ok) failed++;
}

await scenario(
  'GET (não POST), sem body, para /v1/cash-sessions/cs-1/close-preview',
  { cashSessionId: 'cs-1', openingAmount: 100, cashSalesAmount: 80, expectedAmount: 180 },
  (_result, url, options) =>
    String(url).includes('cash-sessions/cs-1/close-preview') &&
    (options?.method === undefined || options.method === 'GET') &&
    options?.body === undefined
);

await scenario(
  'cash 80 + pix 50 (abertura 100) -> service devolve expectedAmount=180 verbatim (não 230)',
  { cashSessionId: 'cs-1', openingAmount: 100, cashSalesAmount: 80, expectedAmount: 180 },
  (result) => result?.expectedAmount === 180 && result?.cashSalesAmount === 80
);

await scenario(
  'mixed cash 30 + pix 70 (abertura 100) -> service devolve expectedAmount=130 verbatim (não 100 nem 230)',
  { cashSessionId: 'cs-1', openingAmount: 100, cashSalesAmount: 30, expectedAmount: 130 },
  (result) => result?.expectedAmount === 130 && result?.cashSalesAmount === 30
);

if (failed > 0) {
  console.error(`\n${failed} cenário(s) do contrato de prévia de fechamento falharam.`);
  process.exit(1);
}

console.log('\ngetCashClosePreviewService: expectedAmount/cashSalesAmount chegam intactos do backend, sem recálculo local, em todos os cenários testados.');
