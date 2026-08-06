import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function listUsersService() {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('users'));
}

export async function createUserService(payload) {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('users'), { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteUserService(userId) {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('users', userId), { method: 'DELETE' });
}
