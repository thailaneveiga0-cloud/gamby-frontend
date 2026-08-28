import { state } from './state.js';
import { api } from './api.js';
import { setMessage } from './ui.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isDeveloperUser(user = state.currentUser) {
  const role = String(user?.role || '').trim().toLowerCase();
  return ['desenvolvedora', 'developer', 'admin_master'].includes(role);
}

/* ================= SETTINGS ================= */

export async function loadDevSettings() {
  const data = await api.getDeveloperSettings();

  return {
    modules: data?.modules || {
      dashboardEnabled: true,
      pdvEnabled: true,
      estoqueEnabled: true,
      produtosEnabled: true,
      financeiroEnabled: true,
      historicoEnabled: true,
      relatoriosEnabled: true,
      marketplaceEnabled: true,
      usuariosEnabled: true,
      configuracoesEnabled: true
    },
    layout: data?.layout || {
      dashboardLayout: 'default',
      pdvLayout: 'default',
      estoqueLayout: 'default',
      financeiroLayout: 'default',
      menuPosition: 'left',
      dashboardCardsOrder: null,
      visibleDashboardCards: null,
      pdvConfig: null
    }
  };
}

export async function saveDevSettings(payload) {
  return api.updateDeveloperSettings(payload);
}

/* ================= MODULES ================= */

// Only target nav buttons — page sections are managed exclusively by activatePage().
const MODULE_SELECTOR_MAP = {
  dashboardEnabled:     '[data-page="dashboard"]',
  pdvEnabled:           '[data-page="pdv"]',
  estoqueEnabled:       '[data-page="estoque"]',
  produtosEnabled:      '[data-page="produtos"]',
  financeiroEnabled:    '[data-page="financeiro"]',
  historicoEnabled:     '[data-page="historico"]',
  relatoriosEnabled:    '[data-page="relatorios"]',
  marketplaceEnabled:   '[data-page="marketplace"]',
  usuariosEnabled:      '[data-page="usuarios"]',
  configuracoesEnabled: '[data-page="configuracoes"]',
};

export function applyDevModules(settings = {}) {
  Object.entries(MODULE_SELECTOR_MAP).forEach(([key, selector]) => {
    const enabled = settings[key] !== false;
    const elements = document.querySelectorAll(selector);

    elements.forEach((el) => {
      el.classList.toggle('hidden', !enabled);
    });
  });
}

/* ================= INPUT HELPERS ================= */

function getInput(id) {
  return document.getElementById(id);
}

function fillDeveloperForm(settings) {
  const modules = settings.modules || {};

  if (getInput('devToggleDashboard')) getInput('devToggleDashboard').checked = modules.dashboardEnabled !== false;
  if (getInput('devTogglePDV')) getInput('devTogglePDV').checked = modules.pdvEnabled !== false;
  if (getInput('devToggleEstoque')) getInput('devToggleEstoque').checked = modules.estoqueEnabled !== false;
  if (getInput('devToggleProdutos')) getInput('devToggleProdutos').checked = modules.produtosEnabled !== false;
  if (getInput('devToggleFinanceiro')) getInput('devToggleFinanceiro').checked = modules.financeiroEnabled !== false;
  if (getInput('devToggleHistorico')) getInput('devToggleHistorico').checked = modules.historicoEnabled !== false;
  if (getInput('devToggleRelatorios')) getInput('devToggleRelatorios').checked = modules.relatoriosEnabled !== false;
  if (getInput('devToggleMarketplace')) getInput('devToggleMarketplace').checked = modules.marketplaceEnabled !== false;
  if (getInput('devToggleUsuarios')) getInput('devToggleUsuarios').checked = modules.usuariosEnabled !== false;
  if (getInput('devToggleConfiguracoes')) getInput('devToggleConfiguracoes').checked = modules.configuracoesEnabled !== false;
}

function readModuleCheckboxes() {
  return {
    dashboardEnabled: Boolean(getInput('devToggleDashboard')?.checked ?? true),
    pdvEnabled: Boolean(getInput('devTogglePDV')?.checked ?? true),
    estoqueEnabled: Boolean(getInput('devToggleEstoque')?.checked ?? true),
    produtosEnabled: Boolean(getInput('devToggleProdutos')?.checked ?? true),
    financeiroEnabled: Boolean(getInput('devToggleFinanceiro')?.checked ?? true),
    historicoEnabled: Boolean(getInput('devToggleHistorico')?.checked ?? true),
    relatoriosEnabled: Boolean(getInput('devToggleRelatorios')?.checked ?? true),
    marketplaceEnabled: Boolean(getInput('devToggleMarketplace')?.checked ?? true),
    usuariosEnabled: Boolean(getInput('devToggleUsuarios')?.checked ?? true),
    configuracoesEnabled: Boolean(getInput('devToggleConfiguracoes')?.checked ?? true)
  };
}

/* ================= LABELS ================= */

function statusLabel(status = '') {
  const value = String(status).trim().toLowerCase();

  if (value === 'active') return 'Ativo';
  if (value === 'blocked') return 'Bloqueado';
  if (value === 'suspended') return 'Suspenso';
  if (value === 'trial') return 'Trial';
  if (value === 'cancelled') return 'Cancelado';

  return value || '-';
}

function billingLabel(mode = '') {
  const value = String(mode).trim().toLowerCase();

  if (value === 'normal') return 'Normal';
  if (value === 'partner') return 'Parceiro';
  if (value === 'free') return 'Grátis';
  if (value === 'lifetime') return 'Vitalício';
  if (value === 'manual') return 'Manual';

  return value || '-';
}

function planLabel(code = '') {
  const value = String(code).trim().toLowerCase();

  if (value === 'basico') return 'Básico';
  if (value === 'economico') return 'Econômico';
  if (value === 'pro') return 'Pró';

  return value || '-';
}

/* ================= CLIENTS ================= */

async function fetchClients() {
  const data = await api.getDeveloperClients();
  return Array.isArray(data?.clients) ? data.clients : [];
}

export async function renderDevClientsTable() {
  const tbody = document.getElementById('devClientsTableBody');
  if (!tbody) return;

  const clients = await fetchClients();

  tbody.innerHTML = clients.map((client) => {
    const _cid = _esc(String(client.id ?? ''));
    return `
    <tr>
      <td>${_esc(client.company || client.tradeName || '-')}</td>
      <td>${_esc(client.email || '-')}</td>
      <td>${statusLabel(client.status)}</td>
      <td>${planLabel(client.plan)}</td>
      <td>${billingLabel(client.billingMode)}</td>
      <td>
        <div class="stock-actions">
          <button class="stock-edit-btn dev-action-btn" data-dev-action="set-normal" data-id="${_cid}" type="button">Normal</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="set-partner" data-id="${_cid}" type="button">Parceiro</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="set-free" data-id="${_cid}" type="button">Grátis</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="set-lifetime" data-id="${_cid}" type="button">Vitalício</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="block-client" data-id="${_cid}" type="button">Bloquear</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="unblock-client" data-id="${_cid}" type="button">Liberar</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="cycle-plan" data-id="${_cid}" type="button">Trocar plano</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

async function updateClientAccess(companyId, payload) {
  return api.updateDeveloperClientAccess(companyId, payload);
}

async function cycleClientPlan(companyId) {
  return api.cycleDeveloperClientPlan(companyId);
}

/* ================= PENDING REGISTRATIONS ================= */

async function fetchPendingRegistrations() {
  const data = await api.getDeveloperPendingRegistrations();
  return Array.isArray(data?.items) ? data.items : [];
}

export async function renderDevPendingTable() {
  const tbody = document.getElementById('devPendingRegistrationsTableBody');
  if (!tbody) return;

  const items = await fetchPendingRegistrations();

  tbody.innerHTML = items.map((item) => {
    const _iid = _esc(String(item.id ?? ''));
    return `
    <tr>
      <td>${_esc(item.name || '-')}</td>
      <td>${_esc(item.companyName || item.company || '-')}</td>
      <td>${_esc(item.email || '-')}</td>
      <td>${_esc(item.step || '-')}</td>
      <td>
        <div class="stock-actions">
          <button class="stock-edit-btn dev-action-btn" data-dev-action="approve-registration" data-id="${_iid}" type="button">Aprovar</button>
          <button class="stock-edit-btn dev-action-btn" data-dev-action="reject-registration" data-id="${_iid}" type="button">Rejeitar</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

async function approveRegistration(id) {
  return api.approveDeveloperPendingRegistration(id);
}

async function rejectRegistration(id) {
  return api.rejectDeveloperPendingRegistration(id);
}

/* ================= ACTION HANDLERS ================= */

async function handleClientAction(action, companyId) {
  if (action === 'set-normal') {
    await updateClientAccess(companyId, {
      accessStatus: 'active',
      billingMode: 'normal',
      canLogin: true,
      monthlyChargeEnabled: true
    });
    setMessage('Cliente voltou para cobrança normal.');
    return;
  }

  if (action === 'set-partner') {
    await updateClientAccess(companyId, {
      accessStatus: 'active',
      billingMode: 'partner',
      canLogin: true,
      monthlyChargeEnabled: false
    });
    setMessage('Cliente marcado como parceiro.');
    return;
  }

  if (action === 'set-free') {
    await updateClientAccess(companyId, {
      accessStatus: 'active',
      billingMode: 'free',
      canLogin: true,
      monthlyChargeEnabled: false
    });
    setMessage('Cliente marcado como gratuito.');
    return;
  }

  if (action === 'set-lifetime') {
    await updateClientAccess(companyId, {
      accessStatus: 'active',
      billingMode: 'lifetime',
      canLogin: true,
      monthlyChargeEnabled: false
    });
    setMessage('Cliente marcado como vitalício.');
    return;
  }

  if (action === 'block-client') {
    await updateClientAccess(companyId, {
      accessStatus: 'blocked',
      canLogin: false
    });
    setMessage('Cliente bloqueado com sucesso.');
    return;
  }

  if (action === 'unblock-client') {
    await updateClientAccess(companyId, {
      accessStatus: 'active',
      canLogin: true
    });
    setMessage('Cliente liberado com sucesso.');
    return;
  }

  if (action === 'cycle-plan') {
    await cycleClientPlan(companyId);
    setMessage('Plano do cliente alterado.');
  }
}

function bindDevTableActions() {
  if (document.body.dataset.devTableActionsBound === 'true') return;
  document.body.dataset.devTableActionsBound = 'true';

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-dev-action]');
    if (!button) return;
    if (!isDeveloperUser()) return;

    const action = button.dataset.devAction;
    const id = button.dataset.id;

    if (!action || !id) return;

    try {
      if (action === 'approve-registration') {
        await approveRegistration(id);
        await renderDevPendingTable();
        await renderDevClientsTable();
        setMessage('Cadastro aprovado.');
        return;
      }

      if (action === 'reject-registration') {
        await rejectRegistration(id);
        await renderDevPendingTable();
        setMessage('Cadastro rejeitado.');
        return;
      }

      await handleClientAction(action, id);
      await renderDevClientsTable();
    } catch (error) {
      setMessage(error?.message || 'Erro ao executar ação do painel.', true);
    }
  });
}

/* ================= SAVE BUTTONS ================= */

function bindDeveloperButtons() {
  if (document.body.dataset.devButtonsBound === 'true') return;
  document.body.dataset.devButtonsBound = 'true';

  getInput('saveDevModulesBtn')?.addEventListener('click', async () => {
    if (!isDeveloperUser()) {
      setMessage('Apenas a desenvolvedora pode alterar os módulos.', true);
      return;
    }

    try {
      const current = await loadDevSettings();

      current.modules = readModuleCheckboxes();

      await saveDevSettings(current);
      applyDevModules(current.modules);
      setMessage('Módulos atualizados com sucesso.');
    } catch (error) {
      setMessage(error?.message || 'Erro ao salvar módulos.', true);
    }
  });
}

/* ================= INIT ================= */

export async function initDeveloperPanel() {
  try {
    if (!isDeveloperUser()) return;

    const settings = await loadDevSettings();

    applyDevModules(settings.modules || {});
    fillDeveloperForm(settings);

    await renderDevClientsTable();
    await renderDevPendingTable();

    bindDeveloperButtons();
    bindDevTableActions();
  } catch (error) {
    console.error('Erro ao iniciar painel desenvolvedora:', error);
  }
}