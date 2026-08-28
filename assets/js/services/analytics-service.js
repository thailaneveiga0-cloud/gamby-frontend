import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getDashboardAnalyticsService(period = 'today') {
  if (!isBackendReady()) return null;
  return httpRequest(`${buildEndpoint('analytics')}/dashboard?period=${period}`, { method: 'GET' });
}
