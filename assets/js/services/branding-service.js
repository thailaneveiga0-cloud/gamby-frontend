import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

export async function uploadPdvLogoService(file) {
  ensureReady();
  const form = new FormData();
  form.append('file', file);
  return httpRequest(`${buildEndpoint('companies')}/me/branding/pdv-logo`, {
    method: 'POST',
    body: form,
  });
}

export async function removePdvLogoService() {
  ensureReady();
  return httpRequest(`${buildEndpoint('companies')}/me/branding/pdv-logo`, {
    method: 'DELETE',
  });
}

export async function uploadCompanyLogoService(file) {
  ensureReady();
  const form = new FormData();
  form.append('file', file);
  return httpRequest(`${buildEndpoint('companies')}/me/branding/logo`, {
    method: 'POST',
    body: form,
  });
}

export async function removeCompanyLogoService() {
  ensureReady();
  return httpRequest(`${buildEndpoint('companies')}/me/branding/logo`, {
    method: 'DELETE',
  });
}
