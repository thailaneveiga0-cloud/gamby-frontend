import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getFinanceSummaryService() {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('finance', 'summary'));
}

export async function getFinanceEntriesService() {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('finance', 'entries'));
}
