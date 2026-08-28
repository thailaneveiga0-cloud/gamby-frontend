import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

const BASE = () => `${buildEndpoint('business-profile')}`;

export async function getBusinessProfileService() {
  ensureReady();
  return httpRequest(BASE());
}

export async function saveBusinessProfileService(data) {
  ensureReady();
  return httpRequest(BASE(), { method: 'PUT', body: JSON.stringify(data) });
}
