/**
 * Gamby Frontend — OperatorPin 401 vs JWT-expiry 401 Contract Validation
 *
 * BUG REAL DE STAGING (2026-09-19), Bug A: httpRequest() (http.js) trata
 * TODO 401 como "JWT pode ter expirado" — tenta refresh e, se falhar,
 * chama _dispatchSessionExpired() (limpa a sessão inteira do localStorage
 * e dispara 'gamby:auth-expired', que redireciona para login).
 *
 * Mas POST /v1/pdv/operator-pin/login e /operator-pin/switch também
 * respondem 401 quando o PIN do OPERADOR está incorreto
 * (operator-pin.service.js:loginWithPin) — um conceito totalmente
 * diferente de "JWT expirado". Resultado real: digitar um PIN de operador
 * errado podia derrubar a sessão principal da conta inteira, mesmo com o
 * JWT perfeitamente válido, sempre que o refresh de token não se
 * completasse a tempo/com sucesso.
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

// ── Cenário 1: PIN de operador incorreto (401) NÃO derruba a sessão ────────

seedSession();
_fetchImpl = async (url) => {
  // Refresh falha de propósito — é exatamente essa combinação (401 de PIN
  // + refresh indisponível/expirado) que reproduz o bug real: sem isso, o
  // retry automático com o token renovado mascararia o problema mesmo no
  // código não corrigido (o retry cai no branch _retried, que nunca chama
  // _dispatchSessionExpired de qualquer forma).
  if (String(url).includes('/v1/auth/refresh')) {
    return jsonResponse(401, { error: 'invalid_refresh_token' });
  }
  return jsonResponse(401, { error: 'unauthorized', message: 'PIN incorreto. 4 tentativa(s) restante(s).' });
};

let threw1 = null;
try {
  await httpRequest('http://fake-backend.invalid/v1/pdv/operator-pin/login', {
    method: 'POST',
    body: JSON.stringify({ userId: 'op-1', pin: '0000' }),
  });
} catch (err) {
  threw1 = err;
}

const sessionAfter1 = globalThis.localStorage.getItem(KEYS.session);

check(
  'PIN de operador incorreto (401 em /operator-pin/login) rejeita a chamada com o erro real',
  threw1 !== null && threw1.status === 401,
  threw1 ? `status=${threw1.status} message=${threw1.message}` : 'não lançou erro'
);

check(
  'PIN de operador incorreto NÃO limpa a sessão principal (gamby_auth_session_modular continua no localStorage)',
  sessionAfter1 !== null,
  sessionAfter1 === null ? 'sessão foi removida — BUG A' : 'sessão preservada'
);

check(
  "PIN de operador incorreto NÃO dispara 'gamby:auth-expired'",
  !_dispatchedEvents.includes('gamby:auth-expired'),
  `eventos disparados: ${JSON.stringify(_dispatchedEvents)}`
);

// ── Cenário 2 (controle/regressão): 401 de rota comum, sem refresh possível, ainda dispara sessão expirada ──

seedSession();
_fetchImpl = async (url) => {
  if (String(url).includes('/v1/auth/refresh')) {
    return jsonResponse(401, { error: 'invalid_refresh_token' }); // refresh falha de propósito
  }
  return jsonResponse(401, { error: 'unauthorized', message: 'Token inválido.' });
};

let threw2 = null;
try {
  await httpRequest('http://fake-backend.invalid/v1/sales', { method: 'GET' });
} catch (err) {
  threw2 = err;
}

const sessionAfter2 = globalThis.localStorage.getItem(KEYS.session);

check(
  'CONTROLE (regressão): 401 de rota comum (JWT realmente inválido, refresh falha) ainda limpa a sessão normalmente',
  threw2 !== null && sessionAfter2 === null,
  sessionAfter2 !== null ? 'sessão NÃO foi limpa — regressão na expiração real de JWT' : 'sessão limpa corretamente'
);

check(
  "CONTROLE (regressão): 401 de rota comum ainda dispara 'gamby:auth-expired'",
  _dispatchedEvents.includes('gamby:auth-expired'),
  `eventos disparados: ${JSON.stringify(_dispatchedEvents)}`
);

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}

console.log('401 de PIN de operador não é mais confundido com JWT expirado, e a expiração real de JWT continua funcionando.\n');
