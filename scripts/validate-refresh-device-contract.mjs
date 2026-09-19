/**
 * Gamby Frontend — refresh de sessão × vínculo de dispositivo (D1–D8)
 *
 * INCIDENTE DE STAGING (2026-09-19): "device_mismatch" derrubava a sessão.
 * O login envia { deviceId } no body e o backend guarda um hash que inclui
 * esse deviceId. O refresh (http.js:_tryRefreshToken) enviava só
 * { refreshToken } → o backend recalculava o hash SEM deviceId → todo refresh
 * de sessão por senha falhava com 401 device_mismatch → 'gamby:auth-expired'.
 * Como o access token expira (JWT_EXPIRES_IN=1h), qualquer sessão mais velha
 * que isso caía no primeiro 401 (ex.: /v1/sync/catalog-version) e era
 * derrubada — coincidindo com o uso do PIN de operador.
 *
 * Este script chama o httpRequest() REAL, stuba só fetch/localStorage/window
 * e inspeciona o BODY real da requisição de refresh.
 *
 * Classificação: VALIDADO LOCALMENTE (funções reais, rede simulada).
 * NÃO VERIFICADO EM NAVEGADOR / NÃO VERIFICADO EM STAGING.
 *
 * Usage: node scripts/validate-refresh-device-contract.mjs
 */

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
  clear() { this._data.clear(); }
}
globalThis.localStorage = new MemoryStorage();
let _events = [];
globalThis.window = {
  GAMBY_CONFIG: { apiUrl: 'http://fake-backend.invalid' },
  location: { hostname: 'localhost' },
  dispatchEvent: (e) => { _events.push(e.type); },
};
globalThis.CustomEvent = class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } };

let _fetchImpl = null;
globalThis.fetch = (...a) => _fetchImpl(...a);
const resp = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

const { httpRequest } = await import('../assets/js/http.js');
const { KEYS } = await import('../assets/js/storage.js');

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

const DEVICE = 'dev-mk3x9-abc12345';
const OLD_TOKEN = 'access-antigo-expirado';
const NEW_TOKEN = 'access-renovado';

function seed() {
  localStorage.clear(); _events = [];
  localStorage.setItem('gamby_device_id', DEVICE); // gravado no login (api.js:getOrCreateDeviceId)
  localStorage.setItem(KEYS.session, JSON.stringify({ token: OLD_TOKEN, refreshToken: 'refresh-valido-0123456789', companyId: 'c1' }));
}
const savedSession = () => JSON.parse(localStorage.getItem(KEYS.session) || 'null');
const run = async (url, opts = {}) => { try { return { ok: true, value: await httpRequest(url, opts) }; } catch (err) { return { ok: false, err }; } };

// ── D1/D6: access token expirado → refresh legítimo mantém o dispositivo ────────
seed();
let refreshBody = null; let refreshCalls = 0; const seenAuth = [];
_fetchImpl = async (url, init) => {
  if (String(url).includes('/v1/auth/refresh')) { refreshCalls++; refreshBody = JSON.parse(init.body); return resp(200, { token: NEW_TOKEN, refreshToken: 'refresh-novo-0123456789' }); }
  const auth = init?.headers?.get?.('Authorization') || '';
  seenAuth.push(auth);
  return auth === `Bearer ${NEW_TOKEN}` ? resp(200, { version: 'v1' }) : resp(401, { error: 'invalid_token', message: 'Token inválido.' });
};
const d1 = await run('http://fake-backend.invalid/v1/sync/catalog-version', { method: 'GET' });
check('D1: sessão válida — a chamada expira, faz refresh e é repetida com sucesso', d1.ok && refreshCalls === 1 && seenAuth.at(-1) === `Bearer ${NEW_TOKEN}`, `refresh=${refreshCalls}`);
check('D6/R1: o refresh envia o MESMO deviceId do login no body (senão o backend responde device_mismatch)', refreshBody?.deviceId === DEVICE, `body=${JSON.stringify(refreshBody)}`);
check('R2: body do refresh só tem campos aceitos pelo schema .strict() do backend (refreshToken, deviceId)', refreshBody && Object.keys(refreshBody).every((k) => ['refreshToken', 'deviceId'].includes(k)), Object.keys(refreshBody || {}).join(','));
check('D6: o refresh não troca nem apaga o deviceId persistido', localStorage.getItem('gamby_device_id') === DEVICE);
check('D6: a sessão é atualizada com os tokens novos e sem evento de expiração', savedSession()?.token === NEW_TOKEN && !_events.includes('gamby:auth-expired'));

// ── D2/D3/D4/D5: PIN errado não mexe em dispositivo nem em sessão ──────────────
seed(); refreshCalls = 0; let pinAttempt = 0;
_fetchImpl = async (url) => {
  if (String(url).includes('/v1/auth/refresh')) { refreshCalls++; return resp(200, { token: NEW_TOKEN, refreshToken: 'x'.repeat(20) }); }
  pinAttempt++;
  return pinAttempt === 1
    ? resp(401, { error: 'operator_pin_invalid', message: 'PIN incorreto. 3 tentativa(s) restante(s).' })
    : resp(200, { operator: { userId: 'op-1', name: 'Op', role: 'operador' } });
};
const wrong = await run('http://fake-backend.invalid/v1/pdv/operator-pin/login', { method: 'POST', body: JSON.stringify({ userId: 'op-1', pin: '0000' }) });
check('D2: PIN errado → erro operator_pin_invalid', !wrong.ok && wrong.err.payload?.error === 'operator_pin_invalid');
check('D3: PIN errado NÃO altera o deviceId', localStorage.getItem('gamby_device_id') === DEVICE);
check('D5: o mesmo access token continua na sessão após o PIN errado (sem refresh, sem rotação)', savedSession()?.token === OLD_TOKEN && refreshCalls === 0);
const right = await run('http://fake-backend.invalid/v1/pdv/operator-pin/login', { method: 'POST', body: JSON.stringify({ userId: 'op-1', pin: '1234' }) });
check('D4: PIN correto logo depois funciona, sem reload', right.ok && right.value?.operator?.userId === 'op-1' && !_events.includes('gamby:auth-expired'));

// ── D8: device_mismatch REAL continua encerrando a sessão (nada é mascarado) ───
seed();
_fetchImpl = async (url) => {
  if (String(url).includes('/v1/auth/refresh')) return resp(401, { error: 'device_mismatch', message: 'Dispositivo não autorizado. Faça login novamente.', details: null });
  return resp(401, { error: 'invalid_token', message: 'Token inválido.' });
};
const d8 = await run('http://fake-backend.invalid/v1/sales', { method: 'GET' });
check("D8: refresh respondendo device_mismatch → sessão limpa e 'gamby:auth-expired' disparado", !d8.ok && savedSession() === null && _events.includes('gamby:auth-expired'));

console.log('');
if (failed > 0) { console.error(`${failed} cenário(s) falharam.\n`); process.exit(1); }
console.log('O refresh reenvia o deviceId do login; device_mismatch real continua derrubando a sessão.\n');
