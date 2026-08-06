import { state } from './state.js';
import { loadBackendConfig, saveBackendConfig, isBackendReady, buildEndpoint } from './backend-config.js';
import { httpRequest } from './http.js';

function fillFields() {
  const ids = {
    backendEnabled: state.backend.enabled,
    backendApiBaseUrl: state.backend.apiBaseUrl,
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
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value ?? '';
  });
}

export function renderBackendStatus() {
  const box = document.getElementById('backendStatusBox');
  const checklist = document.getElementById('backendChecklist');
  if (!box || !checklist) return;
  const ready = isBackendReady();
  const health = state.backend.health || { ok: false, message: 'Não verificado' };
  box.innerHTML = `<strong>Modo backend:</strong> ${state.backend.enabled ? 'Ativo' : 'Desligado'}<br><strong>Base URL:</strong> ${state.backend.apiBaseUrl || 'Não configurada'}<br><strong>Tenant atual:</strong> ${state.backend.tenantId || 'Não definido'}<br><strong>Health:</strong> ${health.ok ? 'OK' : 'Pendente'} — ${health.message}`;
  const items = [
    ['Base URL preenchida', Boolean(state.backend.apiBaseUrl)],
    ['Modo backend ativado', Boolean(state.backend.enabled)],
    ['Endpoints configurados', Object.values(state.backend.endpoints || {}).every(Boolean)],
    ['Tenant disponível após login', Boolean(state.backend.tenantId) || !state.backend.enabled],
    ['Estratégia de sincronização', Boolean(state.backend.syncStrategy)],
    ['Pronto para integração', ready]
  ];
  checklist.innerHTML = items.map(([label, ok]) => `<li>${ok ? '✅' : '⚠️'} ${label}</li>`).join('');
}

export async function runBackendHealthcheck() {
  const status = { ok: false, message: 'Sem resposta' };
  try {
    if (!isBackendReady()) throw new Error('Configure a Base URL e ative o modo backend.');
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
  saveBackendConfig();
  renderBackendStatus();
}

export function saveBackendSettings() {
  saveBackendConfig({
    enabled: document.getElementById('backendEnabled')?.checked || false,
    apiBaseUrl: document.getElementById('backendApiBaseUrl')?.value.trim() || '',
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
  renderBackendStatus();
}

export function initBackendStatus() {
  loadBackendConfig();
  fillFields();
  renderBackendStatus();
}

export function bindBackendStatusActions() {
  document.getElementById('saveBackendSettingsBtn')?.addEventListener('click', saveBackendSettings);
  document.getElementById('runBackendHealthcheckBtn')?.addEventListener('click', runBackendHealthcheck);
}
