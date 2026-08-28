import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

export async function getScaleConfigService() {
  ensureReady();
  return httpRequest(buildEndpoint('scale'), { method: 'GET' });
}

export async function saveScaleConfigService(data) {
  ensureReady();
  return httpRequest(buildEndpoint('scale'), { method: 'PUT', body: JSON.stringify(data) });
}
