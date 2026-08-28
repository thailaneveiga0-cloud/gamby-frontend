import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

export async function getAlertSummaryService() {
  ensureReady();
  return httpRequest(`${buildEndpoint('inventoryAlerts')}/summary`, { method: 'GET' });
}

export async function listAlertsService(status = 'open') {
  ensureReady();
  return httpRequest(`${buildEndpoint('inventoryAlerts')}?status=${status}`, { method: 'GET' });
}

export async function checkAlertsNowService() {
  ensureReady();
  return httpRequest(`${buildEndpoint('inventoryAlerts')}/check`, { method: 'POST' });
}

export async function resolveAlertService(alertId) {
  ensureReady();
  return httpRequest(`${buildEndpoint('inventoryAlerts')}/${encodeURIComponent(alertId)}/resolve`, {
    method: 'PATCH',
  });
}
