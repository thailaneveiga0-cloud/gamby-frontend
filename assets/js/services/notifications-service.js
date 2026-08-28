import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

const BASE = () => `${buildEndpoint('notifications')}`;

export async function listNotificationsService(query = {}) {
  ensureReady();
  const params = new URLSearchParams();
  if (query.unreadOnly) params.set('unreadOnly', 'true');
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return httpRequest(`${BASE()}${qs ? '?' + qs : ''}`);
}

export async function countUnreadNotificationsService() {
  ensureReady();
  return httpRequest(`${BASE()}/unread`);
}

export async function markNotificationReadService(notificationId) {
  ensureReady();
  return httpRequest(`${BASE()}/${notificationId}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsReadService() {
  ensureReady();
  return httpRequest(`${BASE()}/read-all`, { method: 'PATCH' });
}
