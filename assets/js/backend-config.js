import { state } from './state.js';
import { KEYS, load, save } from './storage.js';

// ─── URL autoritativa de produção ────────────────────────────────────────────
//
// Em produção (hostname ≠ localhost): window.GAMBY_CONFIG.apiUrl é a única
// fonte confiável. Configurações antigas no localStorage têm prioridade mais
// alta nos módulos legados (api.js, http.js) e podem direcionar requisições
// para um hostname inválido mesmo com config.js correto.
//
// resolveApiBaseUrl() centraliza a lógica:
//   - Produção → window.GAMBY_CONFIG.apiUrl (ignora localStorage)
//   - Desenvolvimento → localStorage override permitido (dev convenience)

export function resolveApiBaseUrl() {
  const runtimeUrl = typeof window !== 'undefined'
    ? String(window.GAMBY_CONFIG?.apiUrl || '').trim().replace(/\/+$/, '')
    : '';

  const isProductionHost = typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !window.location.hostname.startsWith('192.168.') &&
    window.location.hostname !== '';

  if (isProductionHost) {
    return runtimeUrl; // produção: config.js é autoritativo, localStorage ignorado
  }

  // desenvolvimento: permite override via localStorage
  const lsOverride = typeof window !== 'undefined'
    ? String(localStorage.getItem('gamby_backend_api_url') || '').trim()
    : '';

  return (lsOverride || runtimeUrl || 'http://localhost:4001').replace(/\/+$/, '');
}

// ─── Migração de configurações antigas ───────────────────────────────────────
//
// Executa uma única vez em produção para remover campos de URL persistidos
// que podem sobrescrever silenciosamente o config.js oficial.

export function migrateStaleApiUrlConfig() {
  if (typeof window === 'undefined') return;

  const isProductionHost =
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !window.location.hostname.startsWith('192.168.') &&
    window.location.hostname !== '';

  if (!isProductionHost) return;

  const MIGRATION_KEY = 'gamby_api_url_config_v1';
  if (localStorage.getItem(MIGRATION_KEY) === '1') return;

  // Remover override de URL do localStorage (prioridade máxima indevida)
  localStorage.removeItem('gamby_backend_api_url');

  // Remover campos de URL do backend config persistido
  try {
    const raw = localStorage.getItem('gamby_backend_config');
    if (raw) {
      const cfg = JSON.parse(raw);
      const hadUrl = 'apiBaseUrl' in cfg || 'baseUrl' in cfg || 'apiUrl' in cfg;
      delete cfg.apiBaseUrl;
      delete cfg.baseUrl;
      delete cfg.apiUrl;
      if (hadUrl) localStorage.setItem('gamby_backend_config', JSON.stringify(cfg));
    }
  } catch {
    localStorage.removeItem('gamby_backend_config');
  }

  localStorage.setItem(MIGRATION_KEY, '1');
}

// Prioridade: window.GAMBY_CONFIG (injetado pelo Netlify CI via config.js) → localhost dev fallback
const _runtimeApiUrl = resolveApiBaseUrl() || null;

export const DEFAULT_BACKEND_CONFIG = {
  enabled: true,
  apiBaseUrl: _runtimeApiUrl || '',
  baseUrl: _runtimeApiUrl || '',
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
    developer: '/v1/developer-panel',
    mercadopago: '/v1/mercadopago',
    billing: '/v1/billing',
    pdv: '/v1/pdv',
    inventoryAlerts: '/v1/inventory-alerts',
    analytics: '/v1/analytics',
    mfa: '/v1/mfa',
    sync: '/v1/sync',
    scale: '/v1/scale',
    'admin-movements':   '/v1/admin-movements',
    'commercial-policy': '/v1/commercial-policy',
    terminals:           '/v1/terminals',
    notifications:       '/v1/notifications',
    'audit-logs':        '/v1/audit-logs',
    'business-profile':        '/v1/business-profile',
    personalization:           '/v1/personalization',
    'business-intelligence':   '/v1/business-intelligence',
    'pdv-settings':            '/v1/pdv-settings'
  },
  lastHealthcheck: null,
  health: { ok: false, message: 'Não verificado' }
};

function normalizeBackendUrls(config = {}) {
  const resolvedBaseUrl =
    String(config.apiBaseUrl || config.baseUrl || DEFAULT_BACKEND_CONFIG.apiBaseUrl).trim();

  return {
    ...config,
    apiBaseUrl: resolvedBaseUrl,
    baseUrl: resolvedBaseUrl
  };
}

export function loadBackendConfig() {
  const persisted = load(KEYS.backendConfig, {});

  // Em produção, nunca deixar apiBaseUrl/baseUrl/apiUrl persistidos sobrescrever o runtime.
  // A função resolveApiBaseUrl() retorna window.GAMBY_CONFIG.apiUrl em produção
  // e ignora qualquer override de localStorage.
  const authoritative = resolveApiBaseUrl();

  // Filtrar campos de URL do objeto persistido antes do merge — apenas em produção
  const isProductionHost = typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !window.location.hostname.startsWith('192.168.') &&
    window.location.hostname !== '';

  const safePersisted = isProductionHost
    ? (({ apiBaseUrl: _a, baseUrl: _b, apiUrl: _u, ...rest }) => rest)(persisted)
    : persisted;

  state.backend = normalizeBackendUrls({
    ...DEFAULT_BACKEND_CONFIG,
    ...safePersisted,
    // Garantir que a URL autoritativa sempre vença em produção
    ...(authoritative ? { apiBaseUrl: authoritative, baseUrl: authoritative } : {}),
    endpoints: {
      ...DEFAULT_BACKEND_CONFIG.endpoints,
      ...(safePersisted.endpoints || {})
    }
  });

  return state.backend;
}

export function saveBackendConfig(partial = null) {
  if (!state.backend) {
    loadBackendConfig();
  }

  if (partial) {
    state.backend = normalizeBackendUrls({
      ...state.backend,
      ...partial,
      endpoints: {
        ...state.backend.endpoints,
        ...(partial.endpoints || {})
      }
    });
  } else {
    state.backend = normalizeBackendUrls(state.backend);
  }

  save(KEYS.backendConfig, state.backend);
  return state.backend;
}

export function getBackendConfig() {
  if (!state.backend) {
    return loadBackendConfig();
  }

  state.backend = normalizeBackendUrls(state.backend);
  return state.backend;
}

export function isBackendReady() {
  const backend = getBackendConfig();
  return Boolean(backend?.enabled && backend?.apiBaseUrl);
}

export function buildEndpoint(pathKey, suffix = '') {
  const backend = getBackendConfig();

  const base = String(backend?.apiBaseUrl || backend?.baseUrl || '').replace(/\/$/, '');
  const path = String(backend?.endpoints?.[pathKey] || '').replace(/^\//, '');
  const extra = String(suffix || '').replace(/^\//, '');

  return [base, path, extra].filter(Boolean).join('/');
}