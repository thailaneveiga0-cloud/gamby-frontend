import { state } from './state.js';
import { KEYS, load, save } from './storage.js';

export const DEFAULT_BACKEND_CONFIG = {
  enabled: true,
  apiBaseUrl: 'https://gamby-api-staging.onrender.com',
  timeoutMs: 10000,
  tenantHeader: 'X-Tenant-Id',
  tenantId: '',
  syncStrategy: 'fallback-local',
  endpoints: {
    health: '/health',
    auth: '/v1/auth',
    products: '/v1/products',
    sales: '/v1/sales',
    payments: '/v1/payments',
    companies: '/v1/companies',
    users: '/v1/users',
    cashSessions: '/v1/cash-sessions',
    finance: '/v1/finance',
    reports: '/v1/reports',
    marketplace: '/v1/marketplace',
    developer: '/v1/developer'
  },
  lastHealthcheck: null,
  health: { ok: false, message: 'Não verificado' }
};

export function loadBackendConfig() {
  const persisted = load(KEYS.backendConfig, {});
  state.backend = {
    ...DEFAULT_BACKEND_CONFIG,
    ...persisted,
    endpoints: { ...DEFAULT_BACKEND_CONFIG.endpoints, ...(persisted.endpoints || {}) }
  };
  return state.backend;
}

export function saveBackendConfig(partial = null) {
  if (partial) {
    state.backend = {
      ...state.backend,
      ...partial,
      endpoints: { ...state.backend.endpoints, ...(partial.endpoints || {}) }
    };
  }
  save(KEYS.backendConfig, state.backend);
  return state.backend;
}

export function isBackendReady() {
  return Boolean(state.backend?.enabled && state.backend?.apiBaseUrl);
}

export function buildEndpoint(pathKey, suffix = '') {
  const base = String(state.backend?.apiBaseUrl || '').replace(/\/$/, '');
  const path = String(state.backend?.endpoints?.[pathKey] || '').replace(/^\//, '');
  const extra = String(suffix || '').replace(/^\//, '');
  return [base, path, extra].filter(Boolean).join('/');
}
