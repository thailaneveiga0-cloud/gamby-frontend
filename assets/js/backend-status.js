import { state } from './state.js';
import { loadBackendConfig, saveBackendConfig, isBackendReady, buildEndpoint } from './backend-config.js';
import { httpRequest } from './http.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getResolvedBaseUrl() {
  return (
    state?.backend?.apiBaseUrl ||
    state?.backend?.baseUrl ||
    ''
  );
}

function syncLegacyBaseUrl() {
  if (!state.backend) return;

  const resolved = getResolvedBaseUrl();
  state.backend.apiBaseUrl = resolved;
  state.backend.baseUrl = resolved;
}

function fillFields() {
  syncLegacyBaseUrl();

  const ids = {
    backendEnabled: state.backend.enabled,
    backendApiBaseUrl: getResolvedBaseUrl(),
    backendTimeoutMs: state.backend.timeoutMs,
    backendTenantHeader: state.backend.tenantHeader,
    backendTenantId: state.backend.tenantId,
    backendSyncStrategy: state.backend.syncStrategy,
    endpointAuth: state.backend.endpoints.auth,
    endpointProducts: state.backend.endpoints.products,
    endpointSales: state.backend.endpoints.sales,
    endpointPayments: state.backend.endpoints.payments,
    endpointCompanies: state.backend.endpoints.companies
  };

  Object.entries(ids).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value ?? '';
    }
  });
}

export function renderBackendStatus() {
  syncLegacyBaseUrl();

  const box = document.getElementById('backendStatusBox');
  const checklist = document.getElementById('backendChecklist');
  if (!box || !checklist) return;

  const ready = isBackendReady();
  const health = state.backend.health || { ok: false, message: 'Não verificado' };
  const baseUrl = getResolvedBaseUrl();

  box.innerHTML = `
    <strong>Modo backend:</strong> ${state.backend.enabled ? 'Ativo' : 'Desligado'}<br>
    <strong>Base URL:</strong> ${_esc(baseUrl || 'Não configurada')}<br>
    <strong>Tenant atual:</strong> ${_esc(state.backend.tenantId || 'Não definido')}<br>
    <strong>Health:</strong> ${health.ok ? 'OK' : 'Pendente'} — ${_esc(health.message)}
  `;

  const items = [
    ['Base URL preenchida', Boolean(baseUrl)],
    ['Modo backend ativado', Boolean(state.backend.enabled)],
    ['Endpoints configurados', Object.values(state.backend.endpoints || {}).every(Boolean)],
    ['Tenant disponível após login', Boolean(state.backend.tenantId) || !state.backend.enabled],
    ['Estratégia de sincronização', Boolean(state.backend.syncStrategy)],
    ['Pronto para integração', ready]
  ];

  checklist.innerHTML = items
    .map(([label, ok]) => `<li>${ok ? '✅' : '⚠️'} ${label}</li>`)
    .join('');
}

export async function runBackendHealthcheck() {
  const status = { ok: false, message: 'Sem resposta' };

  try {
    syncLegacyBaseUrl();

    if (!isBackendReady()) {
      throw new Error('Configure a Base URL e ative o modo backend.');
    }

    const url = buildEndpoint('health');
    const payload = await httpRequest(url, { method: 'GET' });

    status.ok = Boolean(payload?.ok);
    status.message = payload?.service || payload?.message || 'Conectado';
  } catch (error) {
    status.ok = false;
    status.message = error.message;
  }

  state.backend.health = status;
  state.backend.lastHealthcheck = new Date().toISOString();
  saveBackendConfig({
    apiBaseUrl: getResolvedBaseUrl(),
    baseUrl: getResolvedBaseUrl()
  });
  renderBackendStatus();
}

export function saveBackendSettings() {
  const resolvedBaseUrl =
    document.getElementById('backendApiBaseUrl')?.value.trim() || '';

  saveBackendConfig({
    enabled: document.getElementById('backendEnabled')?.checked || false,
    apiBaseUrl: resolvedBaseUrl,
    baseUrl: resolvedBaseUrl,
    timeoutMs: Number(document.getElementById('backendTimeoutMs')?.value || 10000),
    tenantHeader: document.getElementById('backendTenantHeader')?.value.trim() || 'X-Tenant-Id',
    tenantId: document.getElementById('backendTenantId')?.value.trim() || state.backend.tenantId || '',
    syncStrategy: document.getElementById('backendSyncStrategy')?.value || 'fallback-local',
    endpoints: {
      ...state.backend.endpoints,
      auth: document.getElementById('endpointAuth')?.value.trim() || '/v1/auth',
      products: document.getElementById('endpointProducts')?.value.trim() || '/v1/products',
      sales: document.getElementById('endpointSales')?.value.trim() || '/v1/sales',
      payments: document.getElementById('endpointPayments')?.value.trim() || '/v1/payments',
      companies: document.getElementById('endpointCompanies')?.value.trim() || '/v1/companies'
    }
  });

  syncLegacyBaseUrl();
  renderBackendStatus();
}

export function initBackendStatus() {
  loadBackendConfig();
  syncLegacyBaseUrl();
  fillFields();
  renderBackendStatus();
}

export function bindBackendStatusActions() {
  document.getElementById('saveBackendSettingsBtn')?.addEventListener('click', saveBackendSettings);
  document.getElementById('runBackendHealthcheckBtn')?.addEventListener('click', runBackendHealthcheck);
}