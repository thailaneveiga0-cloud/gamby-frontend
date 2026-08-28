import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureBackendReady() {
  if (!isBackendReady()) {
    throw new Error('Backend indisponível no momento.');
  }
}

function ensureUserId(userId) {
  const value = String(userId || '').trim();

  if (!value) {
    throw new Error('ID do usuário não informado.');
  }

  return value;
}

function normalizeCpf(value = '') {
  return String(value).replace(/\D/g, '');
}

/* ================= LIST ================= */

export async function listUsersService() {
  ensureBackendReady();

  const response = await httpRequest(buildEndpoint('users'), {
    method: 'GET'
  });

  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.users)) return response.users;

  return [];
}

/* ================= CREATE ================= */

export async function createUserService(payload = {}) {
  ensureBackendReady();

  const body = {
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim().toLowerCase(),
    password: String(payload.password || ''),
    role: String(payload.role || 'operador').trim().toLowerCase(),
    cpf: normalizeCpf(payload.cpf || ''),
    isActive: payload.isActive ?? true,
    photoUrl: payload.photoUrl || null
  };

  const response = await httpRequest(buildEndpoint('users'), {
    method: 'POST',
    body: JSON.stringify(body)
  });

  return response?.user || response;
}

/* ================= UPDATE ================= */

export async function updateUserService(userId, payload = {}) {
  ensureBackendReady();

  const id = ensureUserId(userId);

  const body = {
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim().toLowerCase(),
    role: String(payload.role || 'operador').trim().toLowerCase(),
    cpf: normalizeCpf(payload.cpf || ''),
    isActive: payload.isActive,
    photoUrl: payload.photoUrl !== undefined ? payload.photoUrl : undefined
  };
  // Strip undefined keys so we don't accidentally clear photoUrl when not passed
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  const response = await httpRequest(buildEndpoint('users', id), {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  return response?.user || response;
}

/* ================= DELETE ================= */

export async function deleteUserService(userId) {
  ensureBackendReady();

  return httpRequest(buildEndpoint('users', ensureUserId(userId)), {
    method: 'DELETE'
  });
}