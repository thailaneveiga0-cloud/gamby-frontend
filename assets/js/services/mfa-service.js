import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

export async function getMfaStatusService() {
  ensureReady();
  return httpRequest(`${buildEndpoint('mfa')}/status`, { method: 'GET' });
}

export async function setupMfaService() {
  ensureReady();
  return httpRequest(`${buildEndpoint('mfa')}/setup`, { method: 'POST', body: '{}' });
}

export async function verifyMfaService(token) {
  ensureReady();
  return httpRequest(`${buildEndpoint('mfa')}/verify`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function disableMfaService(token) {
  ensureReady();
  return httpRequest(`${buildEndpoint('mfa')}/disable`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}
