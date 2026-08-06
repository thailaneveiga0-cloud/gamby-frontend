import { state } from './state.js';

export async function httpRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(state.backend?.timeoutMs || 10000));
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = state.currentUser?.token;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const tenantHeader = state.backend?.tenantHeader || 'X-Tenant-Id';
  const tenantId = state.backend?.tenantId || state.currentUser?.companyId || state.currentUser?.activeCompanyId || '';
  if (tenantHeader && tenantId) headers.set(tenantHeader, tenantId);

  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    if (!response.ok) throw new Error(payload?.message || `Erro HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
