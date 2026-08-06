import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getCurrentCashSessionService() {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('cashSessions', 'current'));
}

export async function openCashSessionService(payload) {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('cashSessions', 'open'), { method: 'POST', body: JSON.stringify(payload) });
}

export async function closeCashSessionService(cashSessionId, payload) {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('cashSessions', `${cashSessionId}/close`), { method: 'POST', body: JSON.stringify(payload) });
}
