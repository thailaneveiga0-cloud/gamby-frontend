import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

const BASE = () => `${buildEndpoint('audit-logs')}`;

export async function listAuditLogsService(query = {}) {
  ensureReady();
  const params = new URLSearchParams();
  if (query.action)     params.set('action',     query.action);
  if (query.entityType) params.set('entityType', query.entityType);
  if (query.page)       params.set('page',       String(query.page));
  if (query.limit)      params.set('limit',       String(query.limit));
  const qs = params.toString();
  return httpRequest(`${BASE()}${qs ? '?' + qs : ''}`);
}
