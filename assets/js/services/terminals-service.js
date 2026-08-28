import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

const BASE = () => `${buildEndpoint('terminals')}`;

export async function listTerminalsService() {
  ensureReady();
  return httpRequest(BASE());
}

export async function createTerminalService(data) {
  ensureReady();
  return httpRequest(BASE(), { method: 'POST', body: JSON.stringify(data) });
}

export async function renameTerminalService(terminalId, name) {
  ensureReady();
  return httpRequest(`${BASE()}/${terminalId}/rename`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export async function resetTerminalService(terminalId, reason) {
  ensureReady();
  return httpRequest(`${BASE()}/${terminalId}/reset`, { method: 'POST', body: JSON.stringify({ reason }) });
}
