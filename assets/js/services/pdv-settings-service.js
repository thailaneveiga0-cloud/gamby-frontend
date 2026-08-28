import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getPdvSettingsService() {
  if (!isBackendReady()) return null;
  return httpRequest(`${buildEndpoint('pdv-settings')}`, { method: 'GET' });
}

export async function savePdvSettingsService(data) {
  if (!isBackendReady()) return null;
  return httpRequest(`${buildEndpoint('pdv-settings')}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
