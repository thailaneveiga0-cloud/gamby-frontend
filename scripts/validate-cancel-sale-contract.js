/**
 * Gamby Frontend — cancelSaleService Contract Validation
 *
 * Fase 2 (D4.5): prova que cancelSaleService (assets/js/services/sales-service.js)
 * respeita "backend é a fonte de verdade" (D4.3/D4.4): só marca a venda como
 * cancelada no localStorage DEPOIS de uma resposta 2xx real do backend; em
 * qualquer erro (4xx, 5xx, falha de rede) a função deve REJEITAR a Promise
 * (não engolir o erro) e o estado local da venda deve permanecer intocado.
 *
 * Este repositório não tem framework de teste instalado (ver package.json).
 * Este script roda em Node puro (sem browser/jsdom) e por isso stuba os
 * globais mínimos de que a cadeia real httpRequest -> fetch depende
 * (localStorage, window, fetch) ANTES de importar os módulos reais — a
 * própria implementação de cancelSaleService/httpRequest não é copiada nem
 * reescrita aqui.
 *
 * Usage: node scripts/validate-cancel-sale-contract.js
 * Exit code 1 se qualquer cenário falhar.
 */

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

// fetch controlável por cenário — sobrescrita antes de cada chamada abaixo.
let _fetchImpl = null;
globalThis.fetch = (...args) => _fetchImpl(...args);

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const { cancelSaleService } = await import('../assets/js/services/sales-service.js');
const { KEYS } = await import('../assets/js/storage.js');

const SALE_ID = 'sale-1';
const SALES_KEY = `${KEYS.sales}_local`; // state.currentUser é null -> escopo 'local'

function seedUncancelledSale() {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(
    SALES_KEY,
    JSON.stringify([{ id: SALE_ID, total: 100, cancelled: false, status: 'open' }])
  );
}

function readSale() {
  const raw = JSON.parse(globalThis.localStorage.getItem(SALES_KEY));
  return raw.find((s) => String(s.id) === SALE_ID);
}

let failed = 0;

async function scenario(name, { fetchImpl, expectSuccess }) {
  seedUncancelledSale();
  _fetchImpl = fetchImpl;

  let threw = null;
  let result = null;
  try {
    result = await cancelSaleService(SALE_ID, 'Erro de lançamento');
  } catch (err) {
    threw = err;
  }

  const saleAfter = readSale();

  let ok;
  if (expectSuccess) {
    ok = threw === null && result?.ok === true && saleAfter.cancelled === true && saleAfter.status === 'cancelled';
  } else {
    // Erro NÃO pode ser engolido (threw !== null) e o estado local NÃO pode
    // ter sido mutado como se tivesse dado certo.
    ok = threw !== null && saleAfter.cancelled === false && saleAfter.status === 'open';
  }

  console.log(`${ok ? '✅' : '❌'} ${name}${threw ? ` (rejeitou: ${threw.message})` : ''}`);
  if (!ok) failed++;
}

await scenario('backend 2xx -> venda marcada cancelada localmente', {
  fetchImpl: async () => jsonResponse(200, { ok: true, saleId: SALE_ID }),
  expectSuccess: true,
});

await scenario('backend 409 (conflito) -> rejeita, venda NÃO marcada cancelada', {
  fetchImpl: async () => jsonResponse(409, { error: 'conflict', message: 'Venda já cancelada.' }),
  expectSuccess: false,
});

await scenario('backend 422 (validação) -> rejeita, venda NÃO marcada cancelada', {
  fetchImpl: async () => jsonResponse(422, { error: 'validation_error', message: 'Motivo inválido.' }),
  expectSuccess: false,
});

await scenario('backend 403 (sem permissão) -> rejeita, venda NÃO marcada cancelada', {
  fetchImpl: async () => jsonResponse(403, { error: 'forbidden', message: 'Sem permissão.' }),
  expectSuccess: false,
});

await scenario('backend 500 (erro interno) -> rejeita, venda NÃO marcada cancelada', {
  fetchImpl: async () => jsonResponse(500, { error: 'internal_error', message: 'Erro interno.' }),
  expectSuccess: false,
});

await scenario('falha de rede (fetch rejeita) -> rejeita, venda NÃO marcada cancelada', {
  fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  expectSuccess: false,
});

if (failed > 0) {
  console.error(`\n${failed} cenário(s) de cancelSaleService falharam.`);
  process.exit(1);
}

console.log('\ncancelSaleService: backend é sempre a fonte de verdade em todos os 6 cenários testados.');
