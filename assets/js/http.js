import { state } from './state.js';
import { KEYS } from './storage.js';
import { resolveApiBaseUrl } from './backend-config.js';
import { getOrCreateDeviceId } from './api.js';

/* ======================================================
   HMAC REQUEST SIGNING
   Signs every authenticated request to sensitive routes
   with HMAC-SHA256 derived from the session JWT.

   Wire headers:
     X-Request-Timestamp  unix seconds
     X-Request-Nonce      24 random hex chars
     X-Request-Signature  64 hex chars (HMAC-SHA256)

   Key derivation:
     HKDF-SHA256(IKM=token, salt="gamby-request-signing-v1", info="api-request-hmac", len=32)

   Signed message:
     "{METHOD}\n{pathname+search}\n{timestamp}\n{nonce}\n{sha256(body)}"
   ====================================================== */

const _SIGNED_PREFIXES = ['/v1/cash-sessions', '/v1/sales', '/v1/finance', '/v1/payments'];

let   _signingKeyCache      = null;
let   _signingKeyTokenRef   = null; // token the key was derived from
const _CRYPTO_OK            = typeof globalThis.crypto !== 'undefined' &&
                              typeof globalThis.crypto.subtle !== 'undefined';

async function _getSigningKey(token) {
  if (!_CRYPTO_OK || !token) return null;
  if (_signingKeyCache && _signingKeyTokenRef === token) return _signingKeyCache;

  try {
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(token),
      { name: 'HKDF' },
      false,
      ['deriveKey']
    );

    _signingKeyCache    = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('gamby-request-signing-v1'),
        info: new TextEncoder().encode('api-request-hmac'),
      },
      baseKey,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['sign']
    );
    _signingKeyTokenRef = token;
    return _signingKeyCache;
  } catch {
    return null;
  }
}

async function _buildSignatureHeaders(method, url, body, token) {
  const key = await _getSigningKey(token);
  if (!key) return null;

  try {
    let urlPath;
    try {
      const parsed = new URL(url);
      urlPath = parsed.pathname + parsed.search;
    } catch {
      urlPath = url;
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonceBytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Body hash: SHA-256 of the raw body string
    const bodyStr = !body
      ? ''
      : (body instanceof FormData || body instanceof ArrayBuffer)
        ? ''
        : typeof body === 'string' ? body : JSON.stringify(body);

    const bodyHashBuf = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(bodyStr)
    );
    const bodyHash = Array.from(new Uint8Array(bodyHashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const message = `${method.toUpperCase()}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyHash}`;
    const sigBuf  = await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(message)
    );
    const signature = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return { 'X-Request-Timestamp': timestamp, 'X-Request-Nonce': nonce, 'X-Request-Signature': signature };
  } catch {
    return null;
  }
}

function _shouldSign(url) {
  return _SIGNED_PREFIXES.some(p => String(url || '').includes(p));
}

/* ======================================================
   TOKEN REFRESH — intercepta 401 e renova o access token
   uma única vez por ciclo (deduplicação via _refreshPromise)
   ====================================================== */

let _refreshPromise = null;

async function _tryRefreshToken() {
  const session = getSession();
  if (!session?.refreshToken) return null;

  // resolveApiBaseUrl(): produção = window.GAMBY_CONFIG.apiUrl (ignora localStorage)
  const baseUrl = resolveApiBaseUrl();

  try {
    const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // O backend vincula a sessão a sha256(deviceId|ip|userAgent|...) calculado
      // no login (que envia deviceId no body). O refresh precisa reenviar o
      // MESMO deviceId (mesmo canal do login — refreshTokenSchema aceita
      // deviceId), senão o hash recalculado nunca bate e todo refresh de uma
      // sessão vinculada responde 401 device_mismatch → sessão derrubada.
      body: JSON.stringify({ refreshToken: session.refreshToken, deviceId: getOrCreateDeviceId() })
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data?.token) return null;

    const updated = {
      ...session,
      token: data.token,
      refreshToken: data.refreshToken || session.refreshToken
    };

    const raw = JSON.stringify(updated);
    [KEYS.session, 'gamby_auth_session_modular', 'session', 'gamby_session'].forEach((k) =>
      localStorage.setItem(k, raw)
    );

    return data.token;
  } catch {
    return null;
  }
}

function _dispatchSessionExpired() {
  clearStoredSession();
  window.dispatchEvent(new CustomEvent('gamby:auth-expired'));
}

// Único ponto de extração de mensagem de erro de API — usado por httpRequest()
// abaixo, então beneficia toda chamada de backend do sistema automaticamente.
//
// BUG CONFIRMADO (achado investigando por que "Preço é obrigatório" nunca
// aparecia pro usuário): o middleware validate.js (backend) já retorna o
// campo exato que falhou em `details` — ex.:
//   { error: 'validation_error', message: 'Dados inválidos na requisição.',
//     details: [{ field: 'price', issue: 'Preço é obrigatório', code: '...' }] }
// mas só `payload.message` (o texto genérico) era usado, escondendo o
// `issue` específico — que já vem em português, escrito nos próprios
// schemas Zod (ex.: _amount('Preço')), pronto pra mostrar ao usuário.
function extractErrorMessage(payload, status) {
  if (!payload) return `Erro HTTP ${status}`;

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  if (typeof payload === 'object') {
    if (Array.isArray(payload.details) && payload.details.length) {
      const issues = payload.details.map((d) => d?.issue).filter(Boolean);
      if (issues.length) {
        // Mais de um campo com erro: lista os até 3 primeiros — não precisa
        // ser exaustivo, só melhor que o texto genérico.
        return issues.length === 1 ? issues[0] : issues.slice(0, 3).join('; ');
      }
    }

    return (
      payload.message ||
      payload.error_description ||
      payload.error ||
      payload.title ||
      `Erro HTTP ${status}`
    );
  }

  return `Erro HTTP ${status}`;
}

function isProbablyConnectionError(error) {
  const message = String(error?.message || '').toLowerCase();

  return (
    error instanceof TypeError &&
    (
      message.includes('failed to fetch') ||
      message.includes('fetch') ||
      message.includes('networkerror') ||
      message.includes('load failed')
    )
  );
}

function getSession() {
  try {
    const raw =
      localStorage.getItem(KEYS.session) ||
      localStorage.getItem('gamby_auth_session_modular') ||
      localStorage.getItem('session') ||
      localStorage.getItem('gamby_session') ||
      '{}';

    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clearStoredSession() {
  localStorage.removeItem(KEYS.session);
  localStorage.removeItem('gamby_auth_session_modular');
  localStorage.removeItem('session');
  localStorage.removeItem('gamby_session');
}

export function getAuthToken() {
  const session = getSession();

  return (
    session?.token ||
    state?.session?.token ||
    ''
  );
}

function getTenantId() {
  const session = getSession();

  const tenantId =
    state.currentUser?.companyId ||
    state.backend?.tenantId ||
    session?.companyId ||
    session?.company?.id ||
    session?.user?.companyId ||
    null;

  // Only warn when an auth token exists but tenant is missing (authenticated context only)
  if (!tenantId && session?.token) {
    console.warn('⚠️ Tenant ID não encontrado no frontend');
  }

  return tenantId;
}

function buildRequestBody(body) {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (body instanceof FormData) {
    return body;
  }

  if (typeof body === 'string') {
    return body;
  }

  return JSON.stringify(body);
}

// Public routes that never need auth or tenant headers
const _PUBLIC_ROUTES = [
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/verify-email',
  '/v1/auth/resend-verification',
  '/v1/auth/password/request',
  '/v1/auth/password/reset',
  '/v1/billing/plans',   // public plan catalog
  '/health',
];

function isPublicRoute(url) {
  const u = String(url || '').toLowerCase();
  return _PUBLIC_ROUTES.some(p => u.includes(p));
}

function shouldAttachTenant(url) {
  if (!url) return false;
  return !isPublicRoute(url);
}

function shouldAttachAuth(url) {
  if (!url) return true;
  return !isPublicRoute(url);
}

// BUG REAL DE STAGING (2026-09-19), Bug A: POST /v1/pdv/operator-pin/login e
// /switch podem responder 401 por dois motivos na MESMA URL, porque
// requireAuth roda antes do controller: (1) PIN de operador errado — o JWT
// está válido; (2) JWT ausente/inválido. Só (2) deve passar pelo pipeline
// de refresh/expiração de sessão; tratar (1) assim derrubava a sessão da
// conta inteira por causa de um PIN errado. Excluir a URL inteira (versão
// anterior desta correção) também era errado: um JWT realmente inválido
// nessas rotas nunca era renovado. A decisão vem do `error` semântico do
// backend (operator-pin.service.js/pdv.controller.js), nunca de URL/status.
const _OPERATOR_PIN_ERROR_CODES = new Set([
  'operator_pin_invalid',
  'operator_pin_locked',
  'operator_pin_not_configured',
  'operator_inactive',
]);

function isOperatorPinBusinessError(payload) {
  return _OPERATOR_PIN_ERROR_CODES.has(payload?.error);
}

export async function httpRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(state.backend?.timeoutMs || 10000);

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const headers = new Headers(options.headers || {});
  const body = buildRequestBody(options.body);

  // options.public = true → skip all auth and tenant headers (public endpoints)
  const skipAuth   = options.public === true || options.auth   === false;
  const skipTenant = options.public === true || options.tenant === false;

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAuthToken();
  if (!skipAuth && token && shouldAttachAuth(url) && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const tenantHeader = String(state.backend?.tenantHeader || 'X-Tenant-Id').trim();
  const tenantId = getTenantId();

  if (!skipTenant && tenantHeader && tenantId && shouldAttachTenant(url)) {
    headers.set(tenantHeader, String(tenantId).trim());
  }

  // HMAC request signing for financial/sensitive endpoints
  if (token && _shouldSign(url) && !options._retried) {
    const sigHeaders = await _buildSignatureHeaders(options.method || 'GET', url, options.body, token);
    if (sigHeaders) {
      for (const [k, v] of Object.entries(sigHeaders)) headers.set(k, v);
    }
  }

  try {
    const DEBUG_HTTP = false;

if (DEBUG_HTTP) {
  console.log('📡 REQUEST:', {
    url,
    method: options.method || 'GET',
    tenantId: tenantId || null,
    token: token ? 'OK' : 'MISSING'
  });
}
    const response = await fetch(url, {
      ...options,
      headers,
      body,
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    let payload = null;

    try {
      if (response.status === 204) {
        payload = null;
      } else if (isJson) {
        payload = await response.json();
      } else {
        const text = await response.text();
        payload = text?.trim() ? text : null;
      }
    } catch {
      payload = null;
    }

    if (DEBUG_HTTP) {
  console.log('📥 RESPONSE:', {
    url,
    status: response.status,
    ok: response.ok,
    payload
  });
}

    if (!response.ok) {
      const errorMessage = extractErrorMessage(payload, response.status);

      if (response.status === 401 && !options._retried && !isOperatorPinBusinessError(payload)) {
        if (!_refreshPromise) {
          _refreshPromise = _tryRefreshToken().finally(() => { _refreshPromise = null; });
        }
        const newToken = await _refreshPromise;
        if (newToken) {
          clearTimeout(timeout);
          return httpRequest(url, { ...options, _retried: true });
        }
        _dispatchSessionExpired();
      }

      const error = new Error(errorMessage);
      error.status = response.status;
      error.payload = payload;

      throw error;
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `A requisição demorou demais e foi interrompida (${timeoutMs / 1000}s).`
      );
      timeoutError.code = 'request_timeout';
      timeoutError.url = url;
      throw timeoutError;
    }

    const message = String(error?.message || '').toLowerCase();

    if (
      message.includes('signal is aborted') ||
      message.includes('aborted without reason')
    ) {
      const timeoutError = new Error(
        `A requisição foi interrompida por tempo limite (${timeoutMs / 1000}s).`
      );
      timeoutError.code = 'request_timeout';
      timeoutError.url = url;
      throw timeoutError;
    }

    if (isProbablyConnectionError(error)) {
      const connectionError = new Error(
        'Não foi possível conectar ao backend. Verifique se o servidor está rodando.'
      );
      connectionError.code = 'backend_unreachable';
      connectionError.url = url;
      throw connectionError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}