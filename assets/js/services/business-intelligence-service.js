import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getBusinessIntelligenceService() {
  if (!isBackendReady()) return null;
  return httpRequest(`${buildEndpoint('business-intelligence')}/insights`, { method: 'GET' });
}
