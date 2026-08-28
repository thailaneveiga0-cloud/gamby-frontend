import { KEYS } from './storage.js';
import { getBackendConfig, resolveApiBaseUrl } from './backend-config.js';

const DEVICE_ID_KEY = 'gamby_device_id';

/* ================= HELPERS ================= */

function getSavedSession() {
  try {
    const raw =
      localStorage.getItem(KEYS.session) ||
      localStorage.getItem('gamby_auth_session_modular') ||
      localStorage.getItem('session') ||
      localStorage.getItem('gamby_session');

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getBaseUrl() {
  // resolveApiBaseUrl() retorna window.GAMBY_CONFIG.apiUrl em produção
  // (ignorando localStorage) e o override de dev em localhost.
  // Isso impede que configurações antigas no localStorage sobrescrevam
  // a URL oficial do config.js publicado pelo Cloudflare Pages.
  const authoritative = resolveApiBaseUrl();
  if (authoritative) return authoritative;

  // Fallback legado (apenas se resolveApiBaseUrl retornar vazio)
  const backend = getBackendConfig?.() || {};
  return String(backend.apiBaseUrl || backend.baseUrl || '').trim().replace(/\/+$/, '');
}

function getTenantId() {
  const backend = getBackendConfig?.() || {};
  const session = getSavedSession();

  return (
    backend.tenantId ||
    session?.companyId ||
    session?.user?.companyId ||
    session?.company?.id ||
    null
  );
}

function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);

    if (existing && String(existing).trim()) {
      return String(existing).trim();
    }

    const generated =
      'dev-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 10);

    localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return 'dev-fallback-' + Date.now().toString(36);
  }
}

function buildHeaders(extraHeaders = {}) {
  const session = getSavedSession();
  const tenantId = getTenantId();

  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };

  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }

  return headers;
}

async function parseResponse(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  try {
    const text = await response.text();
    return text ? { message: text } : {};
  } catch {
    return {};
  }
}

async function request(path, options = {}) {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: buildHeaders(options.headers || {}),
    body: options.body,
    credentials: 'include'
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Erro HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;
    error.code =
      data?.code ||
      data?.errorCode ||
      data?.error ||
      null;

    throw error;
  }

  return data;
}

/* ================= AUTH ================= */

async function login(email, password) {
  return request('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      deviceId: getOrCreateDeviceId()
    })
  });
}

async function logout() {
  const session = getSavedSession();
  try {
    return await request('/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({
        refreshToken: session?.refreshToken || ''
      })
    });
  } catch (error) {
    if (error?.status === 404 || error?.status === 422) {
      return { ok: true };
    }
    throw error;
  }
}

async function me() {
  try {
    return await request('/v1/auth/me', {
      method: 'GET'
    });
  } catch (error) {
    if (error?.status === 404) {
      const company = await request('/v1/companies/me', {
        method: 'GET'
      }).catch(() => null);

      const subscription = await request('/v1/companies/me/subscription', {
        method: 'GET'
      }).catch(() => null);

      return {
        user: getSavedSession()?.user || null,
        company,
        subscription
      };
    }

    throw error;
  }
}

/* ================= REGISTER / VERIFY ================= */

async function register(payload = {}) {
  return request('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function verifyEmail(email, code) {
  return request('/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({
      email,
      code
    })
  });
}

async function resendCode(email) {
  return request('/v1/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

/* ================= PASSWORD RESET ================= */

async function requestPasswordReset(email) {
  return request('/v1/auth/password/request', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

async function validatePasswordResetToken(token) {
  return request(`/v1/auth/password/validate?token=${encodeURIComponent(token)}`, {
    method: 'GET'
  });
}

async function confirmPasswordReset(token, password) {
  return request('/v1/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({
      token,
      password
    })
  });
}

/* ================= ADMIN PASSWORD ================= */

async function setAdminPassword(currentPassword, newPassword) {
  return request('/v1/users/me/admin-password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: currentPassword || null,
      newPassword
    })
  });
}

/* ================= AUTHORIZATION ================= */

async function authorizeAction(payload = {}) {
  return request('/v1/authorization', {
    method: 'POST',
    body: JSON.stringify({
      password: payload.password,
      actionType: payload.actionType,
      targetEntityType: payload.targetEntityType || null,
      targetEntityId: payload.targetEntityId || null,
      reason: payload.reason || null,
      metadata: payload.metadata || null
    })
  });
}

async function authorizeCashClosure(password) {
  return authorizeAction({
    password,
    actionType: 'cash_close'
  });
}

/* ================= ACTIVE SESSIONS ================= */

async function getMySessions() {
  return request('/v1/auth/sessions', {
    method: 'GET'
  });
}

async function revokeMySession(sessionId) {
  const id = String(sessionId || '').trim();

  if (!id) {
    throw new Error('ID da sessão não informado.');
  }

  return request(`/v1/auth/sessions/${id}`, {
    method: 'DELETE'
  });
}

async function revokeAllMySessions() {
  return request('/v1/auth/sessions/revoke-all', {
    method: 'POST',
    body: JSON.stringify({})
  });
}

/* ================= COMPANY / ACCOUNT ================= */

async function deleteMyAccount(confirmText) {
  return request('/v1/companies/delete-account', {
    method: 'POST',
    body: JSON.stringify({
      confirmText: String(confirmText || '').trim()
    })
  });
}

/* ================= DEVELOPER PANEL ================= */

async function getDeveloperSettings() {
  return request('/v1/developer-panel/settings', { method: 'GET' });
}

async function updateDeveloperSettings(payload = {}) {
  return request('/v1/developer-panel/settings', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

async function getDeveloperClients() {
  return request('/v1/developer-panel/clients', { method: 'GET' });
}

async function updateDeveloperClientAccess(companyId, payload = {}) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('ID da empresa não informado.');

  return request(`/v1/developer-panel/clients/${id}/access`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

async function cycleDeveloperClientPlan(companyId) {
  const id = String(companyId || '').trim();
  if (!id) throw new Error('ID da empresa não informado.');

  return request(`/v1/developer-panel/clients/${id}/cycle-plan`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });
}

async function getDeveloperPendingRegistrations() {
  return request('/v1/developer-panel/pending-registrations', { method: 'GET' });
}

async function approveDeveloperPendingRegistration(id) {
  const registrationId = String(id || '').trim();
  if (!registrationId) throw new Error('ID do cadastro não informado.');

  return request(`/v1/developer-panel/pending-registrations/${registrationId}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });
}

async function rejectDeveloperPendingRegistration(id) {
  const registrationId = String(id || '').trim();
  if (!registrationId) throw new Error('ID do cadastro não informado.');

  return request(`/v1/developer-panel/pending-registrations/${registrationId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({})
  });
}

/* ================= EXPORTS ================= */

export {
  getOrCreateDeviceId
};

export const api = {
  request,
  setAdminPassword,
  login,
  logout,
  me,
  register,
  verifyEmail,
  resendCode,
  requestPasswordReset,
  validatePasswordResetToken,
  confirmPasswordReset,
  authorizeAction,
  authorizeCashClosure,
  getMySessions,
  revokeMySession,
  revokeAllMySessions,
  deleteMyAccount,
  getDeveloperSettings,
  updateDeveloperSettings,
  getDeveloperClients,
  updateDeveloperClientAccess,
  cycleDeveloperClientPlan,
  getDeveloperPendingRegistrations,
  approveDeveloperPendingRegistration,
  rejectDeveloperPendingRegistration,
  getOrCreateDeviceId
};