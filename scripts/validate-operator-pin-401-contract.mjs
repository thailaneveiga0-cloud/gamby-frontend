/**
 * Gamby Frontend — OperatorPin 401 vs JWT 401 Contract Validation
 *
 * BUG REAL DE STAGING (2026-09-19), Bug A: httpRequest() (http.js) trata
 * TODO 401 como "JWT pode ter expirado" — tenta refresh e, se falhar,
 * chama _dispatchSessionExpired() (limpa a sessão inteira do localStorage
 * e dispara 'gamby:auth-expired', que redireciona para login).
 *
 * POST /v1/pdv/operator-pin/login e /operator-pin/switch respondem 401 por
 * DOIS motivos diferentes na MESMA URL (requireAuth roda antes do
 * controller em pdv.routes.js):
 *   - PIN de operador errado  → {error:'operator_pin_invalid', message}
 *   - JWT ausente/inválido    → {error:'unauthorized'|'invalid_token', message}
 * Só olhar URL/status era insuficiente: ou o PIN errado derrubava a sessão,
 * ou (com exclusão por URL) um JWT realmente inválido nessas rotas nunca
 * era renovado. O frontend agora decide pelo `error` semântico do backend.
 *
 * Este script chama a função REAL exportada (httpRequest), stuba só
 * fetch/localStorage/window (mesmo padrão de
 * scripts/validate-cancel-sale-contract.js) — a implementação de
 * httpRequest() não é copiada nem reescrita aqui.
 *
 * Usage: node scripts/validate-operator-pin-401-contract.mjs
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

let _dispatchedEvents = [];
globalThis.window = {
  GAMBY_CONFIG: { apiUrl: 'http://fake-backend.invalid' },
  location: { hostname: 'localhost' },
  dispatchEvent: (evt) => { _dispatchedEvents.push(evt.type); },
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

const { httpRequest } = await import('../assets/js/http.js');
const { KEYS } = await import('../assets/js/storage.js');

let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

function seedSession() {
  globalThis.localStorage.clear();
  _dispatchedEvents = [];
  const session = { token: 'jwt-valido-de-verdade', refreshToken: 'refresh-valido', companyId: 'company-1' };
  globalThis.localStorage.setItem(KEYS.session, JSON.stringify(session));
}

// Formas REAIS de corpo de resposta do backend (gamby_backend_stage9):
//  - requireAuth (auth.js):         {error:'unauthorized'|'invalid_token', message}
//  - loginWithPin (pdv.controller): {error:'operator_pin_invalid'|'operator_pin_locked', message}
const PIN_INVALID = { error: 'operator_pin_invalid', message: 'PIN incorreto. 4 tentativa(s) restante(s).' };
const PIN_LOCKED = { error: 'operator_pin_locked', message: 'PIN bloqueado por 15 minutos após muitas tentativas.' };
const JWT_INVALID = { error: 'invalid_token', message: 'Token inválido.' };
const OPERATOR_LOGIN_URL = 'http://fake-backend.invalid/v1/pdv/operator-pin/login';
const OPERATOR_OK = { operator: { userId: 'op-1', name: 'Op', role: 'operador' } };

let _calls = [];
const refreshCalls = () => _calls.filter((u) => u.includes('/v1/auth/refresh')).length;
const pinBody = (pin) => ({ method: 'POST', body: JSON.stringify({ userId: 'op-1', pin }) });

async function run(url, opts = {}) {
  try { return { ok: true, value: await httpRequest(url, opts) }; }
  catch (err) { return { ok: false, err }; }
}

// ── A1 + A3: JWT válido + PIN errado → sessão continua, refresh NÃO é chamado ──
seedSession(); _calls = [];
_fetchImpl = async (url) => {
  _calls.push(String(url));
  if (String(url).includes('/v1/auth/refresh')) return jsonResponse(401, { error: 'invalid_refresh_token' });
  return jsonResponse(401, PIN_INVALID);
};
const a1 = await run(OPERATOR_LOGIN_URL, pinBody('0000'));
check('A1: PIN incorreto rejeita com o erro real do backend (401 operator_pin_invalid)', !a1.ok && a1.err.status === 401 && a1.err.payload?.error === 'operator_pin_invalid');
check('A1: PIN incorreto NÃO limpa a sessão JWT', globalThis.localStorage.getItem(KEYS.session) !== null);
check("A1: PIN incorreto NÃO dispara 'gamby:auth-expired'", !_dispatchedEvents.includes('gamby:auth-expired'), JSON.stringify(_dispatchedEvents));
check('A3: PIN incorreto NÃO chama /v1/auth/refresh', refreshCalls() === 0, `refresh chamado ${refreshCalls()}x`);

// ── A1b: PIN bloqueado (429) também não mexe na sessão ──
seedSession(); _calls = [];
_fetchImpl = async (url) => { _calls.push(String(url)); return jsonResponse(429, PIN_LOCKED); };
const a1b = await run(OPERATOR_LOGIN_URL, pinBody('0000'));
check('A1b: PIN bloqueado (429) preserva a sessão e não chama refresh', !a1b.ok && globalThis.localStorage.getItem(KEYS.session) !== null && refreshCalls() === 0);

// ── A2: PIN errado → PIN correto na tentativa seguinte, sem reload ──
seedSession(); _calls = [];
let _attempt = 0;
_fetchImpl = async (url) => {
  _calls.push(String(url));
  if (String(url).includes('/v1/auth/refresh')) return jsonResponse(401, { error: 'invalid_refresh_token' });
  _attempt++;
  return _attempt === 1 ? jsonResponse(401, PIN_INVALID) : jsonResponse(200, OPERATOR_OK);
};
const a2first = await run(OPERATOR_LOGIN_URL, pinBody('0000'));
const a2second = await run(OPERATOR_LOGIN_URL, pinBody('1234'));
check('A2: 1ª tentativa (PIN errado) falha e 2ª (PIN correto) funciona sem reload', !a2first.ok && a2second.ok && a2second.value?.operator?.userId === 'op-1');
check('A2: a sessão JWT segue intacta após errado → correto', globalThis.localStorage.getItem(KEYS.session) !== null);

// ── A4: JWT realmente inválido NA MESMA rota de PIN → refresh continua funcionando ──
seedSession(); _calls = [];
_fetchImpl = async (url, init) => {
  _calls.push(String(url));
  if (String(url).includes('/v1/auth/refresh')) return jsonResponse(200, { token: 'jwt-renovado', refreshToken: 'refresh-2' });
  const auth = init?.headers?.get?.('Authorization') || '';
  return auth === 'Bearer jwt-renovado' ? jsonResponse(200, OPERATOR_OK) : jsonResponse(401, JWT_INVALID);
};
const a4 = await run(OPERATOR_LOGIN_URL, pinBody('1234'));
check('A4: 401 invalid_token na rota de PIN dispara refresh de token', refreshCalls() === 1, `refresh chamado ${refreshCalls()}x`);
check('A4: após refresh bem-sucedido a requisição é repetida com o novo token e funciona', a4.ok && a4.value?.operator?.userId === 'op-1', a4.ok ? 'ok' : `falhou: ${a4.err?.message}`);

// ── A5: refresh realmente falha → aí sim a sessão expira (rota de PIN com JWT inválido) ──
seedSession(); _calls = [];
_fetchImpl = async (url) => {
  _calls.push(String(url));
  if (String(url).includes('/v1/auth/refresh')) return jsonResponse(401, { error: 'invalid_refresh_token' });
  return jsonResponse(401, JWT_INVALID);
};
await run(OPERATOR_LOGIN_URL, pinBody('1234'));
check("A5: JWT inválido + refresh inválido → 'gamby:auth-expired' disparado", _dispatchedEvents.includes('gamby:auth-expired'), JSON.stringify(_dispatchedEvents));
check('A5: JWT inválido + refresh inválido → sessão limpa', globalThis.localStorage.getItem(KEYS.session) === null);

// ── A6: catalog-version (sync) com 401 e refresh OK não destrói sessão válida ──
seedSession(); _calls = [];
_fetchImpl = async (url, init) => {
  _calls.push(String(url));
  if (String(url).includes('/v1/auth/refresh')) return jsonResponse(200, { token: 'jwt-renovado', refreshToken: 'refresh-2' });
  const auth = init?.headers?.get?.('Authorization') || '';
  return auth === 'Bearer jwt-renovado' ? jsonResponse(200, { version: 'v1' }) : jsonResponse(401, JWT_INVALID);
};
const a6 = await run('http://fake-backend.invalid/v1/sync/catalog-version', { method: 'GET' });
check('A6: catalog-version com 401 recupera via refresh sem derrubar a sessão', a6.ok && !_dispatchedEvents.includes('gamby:auth-expired') && globalThis.localStorage.getItem(KEYS.session) !== null);

// ── CONTROLE (regressão): 401 de rota comum sem refresh possível ainda expira a sessão ──
seedSession(); _calls = [];
_fetchImpl = async (url) => {
  if (String(url).includes('/v1/auth/refresh')) return jsonResponse(401, { error: 'invalid_refresh_token' });
  return jsonResponse(401, JWT_INVALID);
};
const c1 = await run('http://fake-backend.invalid/v1/sales', { method: 'GET' });
check('CONTROLE: 401 de rota comum (JWT inválido, refresh falha) ainda limpa a sessão', !c1.ok && globalThis.localStorage.getItem(KEYS.session) === null);
check("CONTROLE: 401 de rota comum ainda dispara 'gamby:auth-expired'", _dispatchedEvents.includes('gamby:auth-expired'));

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}

console.log('401 de PIN de operador é distinguido de 401 de JWT pelo error code, e a expiração real de JWT continua funcionando.\n');
