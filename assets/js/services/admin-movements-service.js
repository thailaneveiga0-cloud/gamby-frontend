import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

const BASE = () => `${buildEndpoint('admin-movements')}`;

export async function listAdminMovementsService(query = {}) {
  ensureReady();
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return httpRequest(`${BASE()}${qs ? '?' + qs : ''}`);
}

export async function createAdminMovementService(data) {
  ensureReady();
  return httpRequest(BASE(), { method: 'POST', body: JSON.stringify(data) });
}

export async function getAdminMovementService(movementId) {
  ensureReady();
  return httpRequest(`${BASE()}/${movementId}`);
}
