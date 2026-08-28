import { state, DEFAULT_COMPANY_SETTINGS } from './state.js';
import { api, getOrCreateDeviceId } from './api.js';
import { renderTerminalsSettings, bindTerminalsSettingsActions } from './terminal-manager.js';
import {
  saveCompanySettingsService,
  loadCompanySettingsService
} from './services/company-service.js';
import { formatCurrency } from './utils.js';
import { KEYS, save, load } from './storage.js';
import {
  WA_STATUS,
  getWhatsAppIntegrationStatus,
  saveWhatsAppMetaConfig,
  testWhatsAppMetaConnection,
  disconnectWhatsApp,
  getWhatsAppMetaSafeConfig,
} from './services/whatsapp-service.js';
import {
  getEmailConfig,
  saveEmailConfig,
} from './services/marketing-service.js';
import {
  getMfaStatusService,
  setupMfaService,
  verifyMfaService,
  disableMfaService,
} from './services/mfa-service.js';
import {
  uploadPdvLogoService, removePdvLogoService,
  uploadCompanyLogoService, removeCompanyLogoService,
} from './services/branding-service.js';
import { getScaleConfigService, saveScaleConfigService } from './services/scale-service.js';
import { getCommercialPolicyService, saveCommercialPolicyService } from './services/commercial-policy-service.js';
import { listAdminMovementsService, createAdminMovementService } from './services/admin-movements-service.js';
import { getBusinessProfileService, saveBusinessProfileService } from './services/business-profile-service.js';
import { getPdvSettingsService, savePdvSettingsService } from './services/pdv-settings-service.js';
import { getPersonalizationService, savePersonalizationService } from './services/personalization-service.js';
import { listTerminalsService, resetTerminalService, renameTerminalService } from './services/terminals-service.js';
import { listAuditLogsService } from './services/audit-log-service.js';
import { isBackendReady } from './backend-config.js';
import { applyVisibility } from './gov-access.js';

/* ================= HELPERS DE PERMISSÃO ================= */

function getCurrentRole() {
  return String(state?.currentUser?.role || '').trim().toLowerCase();
}

function canManageActiveSessions() {
  const role = getCurrentRole();
  return role === 'administrador' || role === 'desenvolvedora';
}

function getActiveSessionsPanelElements() {
  return {
    status: document.getElementById('activeSessionsStatus'),
    tbody: document.getElementById('activeSessionsTableBody'),
    reloadBtn: document.getElementById('reloadSessionsBtn'),
    revokeAllBtn: document.getElementById('revokeAllSessionsBtn')
  };
}

function hideActiveSessionsPanelForUnauthorized() {
  const { status, tbody, reloadBtn, revokeAllBtn } = getActiveSessionsPanelElements();

  if (reloadBtn) reloadBtn.closest('.hero-actions')?.classList.add('hidden');
  if (revokeAllBtn) revokeAllBtn.classList.add('hidden');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="muted">A visualização de sessões ativas está disponível apenas para administrador e desenvolvedora.</td>
      </tr>
    `;
  }

  if (status) {
    status.textContent = 'Acesso restrito por perfil.';
    status.classList.remove('notice-error');
  }
}

function showActiveSessionsPanelForAuthorized() {
  const { reloadBtn, revokeAllBtn } = getActiveSessionsPanelElements();

  if (reloadBtn) reloadBtn.closest('.hero-actions')?.classList.remove('hidden');
  if (revokeAllBtn) revokeAllBtn.classList.remove('hidden');
}

/* ================= SETTINGS ================= */

export async function initSettings() {
  state.companySettings = {
    ...DEFAULT_COMPANY_SETTINGS,
    ...(await loadCompanySettingsService())
  };

  renderSettings();
  renderSelfTests();
  await renderActiveSessions();
  if (isBackendReady()) await loadMfaStatus();
  loadBrandingPreview();
}

export async function saveCompanySettings() {
  state.companySettings = {
    companyName: document.getElementById('companyName')?.value.trim() || '',
    tradeName: document.getElementById('tradeName')?.value.trim() || '',
    cnpj: document.getElementById('companyCnpj')?.value.trim() || '',
    phone: document.getElementById('companyPhone')?.value.trim() || '',
    email: document.getElementById('companyEmail')?.value.trim() || '',
    address: document.getElementById('companyAddress')?.value.trim() || '',
    noteFooter: document.getElementById('companyFooter')?.value.trim() || ''
  };

  await saveCompanySettingsService(state.companySettings);

  const status = document.getElementById('companySettingsStatus');
  if (status) {
    status.textContent = 'Configurações da empresa salvas com sucesso.';
    status.classList.remove('notice-error');
  }
}

function _renderHeroCards() {
  const company = state.currentCompany || state.companySettings || {};
  const sub     = state.subscription  || {};

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };

  setEl('heroCompanyName', company.tradeName || company.companyName || '—');
  setEl('heroCompanyCnpj', company.cnpj || '—');
  setEl('heroPlanName',    sub.planName || sub.plan?.name || '—');
  setEl('heroPlanStatus',  sub.status   || '—');

  // Sincroniza também os cards antigos (ainda podem existir no DOM)
  setEl('settingsCompanyNameCard', company.tradeName || company.companyName || '—');
  setEl('settingsCompanyCnpjCard', company.cnpj || '—');

  // Perfil do negócio no hero
  const bpEl = document.getElementById('heroBusinessType');
  const BTYPE = {
    papelaria:'Papelaria', mercado:'Mercado', acaiteria:'Açaiteria',
    restaurante:'Restaurante', roupas:'Loja de Roupas',
    conveniencia:'Conveniência', servicos:'Serviços', outro:'Outro',
  };
  if (bpEl) bpEl.textContent = BTYPE[company.businessType] || '— não configurado —';

  const featsEl = document.getElementById('heroFeaturesList');
  if (featsEl) {
    const feats = [];
    if (company.featStock)       feats.push('Estoque: Ativo');
    if (company.featMarketplace) feats.push('Marketplace: Ativo');
    if (company.featDelivery)    feats.push('Delivery: Ativo');
    if (company.featWeighing)    feats.push('Pesagem: Ativo');
    if (company.featServices)    feats.push('Serviços: Ativo');
    featsEl.textContent = feats.length ? feats.join(' · ') : 'Nenhum recurso configurado';
  }
}

export function renderSettings() {
  const s = state.companySettings || {};

  const ids = {
    companyName: s.companyName,
    tradeName: s.tradeName,
    companyCnpj: s.cnpj,
    companyPhone: s.phone,
    companyEmail: s.email,
    companyAddress: s.address,
    companyFooter: s.noteFooter
  };

  Object.entries(ids).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  });

  const toggle = document.getElementById('securityPasswordToggle');
  if (toggle) {
    toggle.checked = localStorage.getItem('gamby_security_required') !== 'false';
  }

  _renderHeroCards();
  renderCfgProductsTable();
  renderTerminalsSettings();
  renderCardMachinesSettings();
  renderPayDiscountSettings();
  renderScaleSettings();
  renderCommercialPolicySettings();
  renderAdminMovementUsers();
  renderAdminMovementsList();
  renderBusinessProfile();
  renderPdvSettings();
  renderAdvancedTerminals();
}

function renderCfgProductsTable(filter) {
  const tbody = document.getElementById('cfgProductsTableBody');
  if (!tbody) return;

  const products = Array.isArray(state.products) ? state.products : [];
  const search = (filter || '').trim().toLowerCase();

  const filtered = search
    ? products.filter((p) =>
        (p.name || '').toLowerCase().includes(search) ||
        (p.code || '').toLowerCase().includes(search) ||
        (p.category || '').toLowerCase().includes(search)
      )
    : products;

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="cfg-empty-td">' +
      (products.length === 0 ? 'Nenhum produto cadastrado ainda.' : 'Nenhum produto encontrado para essa busca.') +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((p) => {
    const name     = escapeHtml(p.name     || '—');
    const code     = escapeHtml(p.code     || '—');
    const category = escapeHtml(p.category || '—');
    const price    = formatCurrency(Number(p.price  ?? 0));
    const stock    = Number(p.stock ?? 0);
    const minStock = Number(p.minStock ?? 5);
    const active   = p.active !== false;

    let statusBadge;
    if (!active) {
      statusBadge = '<span class="badge badge-inactive">Inativo</span>';
    } else if (stock <= 0) {
      statusBadge = '<span class="badge red">Sem estoque</span>';
    } else if (stock <= minStock) {
      statusBadge = '<span class="badge yellow">Estoque baixo</span>';
    } else {
      statusBadge = '<span class="badge green">Normal</span>';
    }

    return (
      '<tr>' +
        '<td><strong>' + name + '</strong><br/><span class="cfg-code-lbl">' + code + '</span></td>' +
        '<td>' + category + '</td>' +
        '<td>' + price + '</td>' +
        '<td>' + stock + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><button class="btn btn-ghost cfg-prod-edit-btn cfg-edit-btn" data-code="' + code + '" type="button">Editar</button></td>' +
      '</tr>'
    );
  }).join('');

  tbody.querySelectorAll('.cfg-prod-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.openPageDirect?.('produtos');
    });
  });
}

/* ================= AUTOTESTES ================= */

export function renderSelfTests() {
  const list = document.getElementById('selfTestsList');
  if (!list) return;

  const isDev = getCurrentRole() === 'desenvolvedora';

  const checks = [
    ['Produtos carregados',               isDev || (Array.isArray(state.products) && state.products.length > 0)],
    ['Vendas estruturadas',               isDev || Array.isArray(state.sales)],
    ['Sessão de caixa inicializada',      isDev || state.cashSession !== undefined],
    ['Usuários internos carregados',      isDev || Array.isArray(state.internalUsers)],
    ['Configurações de pagamento presentes', isDev || (!!state.paymentSettings && !!state.paymentSettings.methods)],
    ['Configurações da empresa presentes',   isDev || (!!state.companySettings && typeof state.companySettings.companyName === 'string')],
    ['Produtos padrão disponíveis',       isDev || (Array.isArray(state.products) ? state.products.every((p) => p && p.code && p.name) : false)],
    ['Permissões carregadas',             true]
  ];

  list.innerHTML = checks
    .map(([label, ok]) => `<li class="cfg-check-li">${ok ? '✅' : '⚠️'} ${label}</li>`)
    .join('');
}

/* ================= SESSÕES ATIVAS ================= */

function setActiveSessionsStatus(message, isError = false) {
  const status = document.getElementById('activeSessionsStatus');
  if (!status) return;

  status.textContent = message;
  status.classList.toggle('notice-error', !!isError);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTime(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('pt-BR');
}

function detectDeviceLabel(session) {
  const userAgent = String(session?.userAgent || '').toLowerCase();
  const platform = String(session?.platform || '').trim();

  if (userAgent.includes('android')) return 'Android';
  if (userAgent.includes('iphone')) return 'iPhone';
  if (userAgent.includes('ipad')) return 'iPad';
  if (userAgent.includes('windows')) return 'Windows';
  if (userAgent.includes('mac os') || userAgent.includes('macintosh')) return 'Mac';
  if (userAgent.includes('linux')) return 'Linux';

  if (platform) return platform;

  return 'Dispositivo';
}

function detectBrowserLabel(session) {
  const userAgent = String(session?.userAgent || '').toLowerCase();

  if (userAgent.includes('edg/')) return 'Edge';
  if (userAgent.includes('opr/') || userAgent.includes('opera')) return 'Opera';
  if (userAgent.includes('chrome/')) return 'Chrome';
  if (userAgent.includes('firefox/')) return 'Firefox';
  if (userAgent.includes('safari/') && !userAgent.includes('chrome/')) return 'Safari';

  return 'Navegador';
}

function formatSessionDevice(session) {
  const device = detectDeviceLabel(session);
  const browser = detectBrowserLabel(session);
  const platform = String(session?.platform || '').trim();

  if (platform && platform !== device) {
    return `${device} • ${browser} • ${platform}`;
  }

  return `${device} • ${browser}`;
}

function getCurrentDeviceId() {
  try {
    return getOrCreateDeviceId();
  } catch {
    return null;
  }
}

function isCurrentSession(session) {
  const currentDeviceId = getCurrentDeviceId();
  const sessionDeviceId = String(session?.deviceId || '').trim();

  if (!currentDeviceId || !sessionDeviceId) return false;
  return currentDeviceId === sessionDeviceId;
}

function buildSessionBadge(session) {
  if (isCurrentSession(session)) {
    return `<span class="pill pill-sm">Este dispositivo</span>`;
  }

  return '';
}

function buildSessionRow(session) {
  const sessionId = String(session?.id || '').trim();
  const deviceLabel = escapeHtml(formatSessionDevice(session));
  const ipAddress = escapeHtml(session?.ipAddress || '-');
  const createdAt = escapeHtml(formatDateTime(session?.createdAt));
  const expiresAt = escapeHtml(formatDateTime(session?.expiresAt));
  const badge = buildSessionBadge(session);

  return `
    <tr class="${isCurrentSession(session) ? 'cfg-sess-bg' : ''}">
      <td>
        <div class="cfg-sess-dev">
          <strong class="cfg-sess-name">${deviceLabel}</strong>
          ${badge || '<span class="mini">Sessão ativa</span>'}
        </div>
      </td>
      <td>${ipAddress}</td>
      <td>${createdAt}</td>
      <td>${expiresAt}</td>
      <td>
        <button
          class="btn btn-danger revoke-session-btn"
          data-session-id="${escapeHtml(sessionId)}"
          type="button"
          ${isCurrentSession(session) ? 'title="Você também pode encerrar esta sessão atual."' : ''}
        >
          Encerrar
        </button>
      </td>
    </tr>
  `;
}

async function revokeSession(sessionId) {
  if (!sessionId) return;

  const confirmed = window.confirm('Deseja realmente encerrar esta sessão?');
  if (!confirmed) return;

  try {
    setActiveSessionsStatus('Encerrando sessão...');
    await api.revokeMySession(sessionId);
    setActiveSessionsStatus('Sessão encerrada com sucesso.');
    await renderActiveSessions();
  } catch (error) {
    setActiveSessionsStatus(error?.message || 'Erro ao encerrar sessão.', true);
  }
}

function bindSessionButtons(tbody) {
  tbody.querySelectorAll('.revoke-session-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const sessionId = button.dataset.sessionId;
      await revokeSession(sessionId);
    });
  });
}

export async function renderActiveSessions() {
  const tbody = document.getElementById('activeSessionsTableBody');
  if (!tbody) return;

  if (!canManageActiveSessions()) {
    hideActiveSessionsPanelForUnauthorized();
    return;
  }

  showActiveSessionsPanelForAuthorized();

  const rawSession =
    localStorage.getItem('gamby_auth_session_modular') ||
    localStorage.getItem('session') ||
    localStorage.getItem('gamby_session') ||
    null;

  let parsedSession = null;

  try {
    parsedSession = rawSession ? JSON.parse(rawSession) : null;
  } catch {
    parsedSession = null;
  }

  const token = parsedSession?.token || '';

  if (!token) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="muted">Faça login para visualizar as sessões ativas.</td>
      </tr>
    `;
    setActiveSessionsStatus('Sessão não autenticada.', true);
    return;
  }

  try {
    setActiveSessionsStatus('Carregando sessões ativas...');

    const response = await api.getMySessions();
    const sessions = Array.isArray(response?.sessions) ? response.sessions : [];

    if (!sessions.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="muted">Nenhuma sessão ativa encontrada.</td>
        </tr>
      `;
      setActiveSessionsStatus('Nenhuma sessão ativa encontrada.');
      return;
    }

    const sortedSessions = [...sessions].sort((a, b) => {
      if (isCurrentSession(a) && !isCurrentSession(b)) return -1;
      if (!isCurrentSession(a) && isCurrentSession(b)) return 1;

      const aDate = new Date(a?.createdAt || 0).getTime();
      const bDate = new Date(b?.createdAt || 0).getTime();

      return bDate - aDate;
    });

    tbody.innerHTML = sortedSessions.map(buildSessionRow).join('');
    bindSessionButtons(tbody);

    const currentCount = sortedSessions.filter(isCurrentSession).length;
    const total = sortedSessions.length;

    if (currentCount > 0) {
      setActiveSessionsStatus(`Sessões ativas carregadas: ${total}. Seu dispositivo atual foi identificado.`);
    } else {
      setActiveSessionsStatus(`Sessões ativas carregadas: ${total}.`);
    }
  } catch (error) {
    if (error?.status === 401) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="muted">Sua sessão expirou. Faça login novamente.</td>
        </tr>
      `;
      setActiveSessionsStatus('Sessão expirada ou inválida.', true);
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="muted">
          ${escapeHtml(error?.message || 'Erro ao carregar sessões ativas.')}
        </td>
      </tr>
    `;
    setActiveSessionsStatus(error?.message || 'Erro ao carregar sessões ativas.', true);
  }
}

async function revokeAllSessions() {
  const confirmed = window.confirm(
    'Deseja realmente encerrar todas as sessões ativas? Você poderá precisar fazer login novamente em outros dispositivos.'
  );

  if (!confirmed) return;

  try {
    setActiveSessionsStatus('Encerrando todas as sessões...');
    await api.revokeAllMySessions();
    setActiveSessionsStatus('Todas as sessões foram encerradas com sucesso.');
    await renderActiveSessions();
  } catch (error) {
    setActiveSessionsStatus(error?.message || 'Erro ao encerrar todas as sessões.', true);
  }
}

/* ================= CANCELAMENTO DEFINITIVO ================= */

function setDeleteAccountStatus(message, isError = false) {
  const status = document.getElementById('deleteMyAccountStatus');
  if (!status) return;

  status.textContent = message;
  status.classList.toggle('notice-error', !!isError);
}

async function deleteMyAccount() {
  const input = String(document.getElementById('deleteAccountConfirmText')?.value || '').trim();

  if (input !== 'EXCLUIR MINHA CONTA') {
    setDeleteAccountStatus(
      'Digite exatamente EXCLUIR MINHA CONTA para confirmar.',
      true
    );
    return;
  }

  const confirmed = window.confirm(
    'Tem certeza? Todos os dados da empresa serão excluídos permanentemente do banco de dados. Essa ação não poderá ser desfeita.'
  );

  if (!confirmed) return;

  try {
    setDeleteAccountStatus('Excluindo conta permanentemente...');

    await api.deleteMyAccount(input);

    localStorage.removeItem('gamby_auth_session_modular');
    localStorage.removeItem('session');
    localStorage.removeItem('gamby_session');

    window.location.reload();
  } catch (error) {
    setDeleteAccountStatus(error?.message || 'Erro ao excluir a conta.', true);
  }
}

/* ================= MFA ================= */

async function loadMfaStatus() {
  const statusLabel   = document.getElementById('mfaStatusLabel');
  const hint          = document.getElementById('mfaHint');
  const setupBtn      = document.getElementById('mfaSetupBtn');
  const disableSection = document.getElementById('mfaDisableSection');
  const msg           = document.getElementById('mfaMsg');
  const qrSection     = document.getElementById('mfaQrSection');

  if (!statusLabel) return;

  try {
    const data = await getMfaStatusService();

    if (data.isEnabled) {
      statusLabel.textContent = 'Ativo';
      statusLabel.className = 'mfa-status-badge mfa-active';
    } else {
      statusLabel.textContent = 'Inativo';
      statusLabel.className = 'mfa-status-badge mfa-inactive';
    }

    if (hint) {
      if (data.isRequired) {
        hint.textContent = 'MFA obrigatório para este perfil.';
      } else if (data.isRecommended) {
        hint.textContent = 'MFA recomendado para este perfil.';
      } else {
        hint.textContent = '';
      }
    }

    if (setupBtn)        setupBtn.classList.toggle('hidden', data.isEnabled);
    if (disableSection)  disableSection.classList.toggle('hidden', !data.isEnabled || data.isRequired);
    if (qrSection)       qrSection.classList.add('hidden');
    if (msg)             msg.textContent = '';
  } catch (err) {
    if (statusLabel) statusLabel.textContent = '—';
    if (msg) { msg.textContent = err.message; msg.className = 'notice-error'; }
  }
}

/* ================= BRANDING PDV ================= */

function _getCurrentRole() {
  return String(state?.currentUser?.role || '').trim().toLowerCase();
}

function _canManageBranding() {
  return ['desenvolvedora', 'administrador', 'gerente'].includes(_getCurrentRole());
}

function _applyBrandingPreview(url) {
  const img      = document.getElementById('brandingPreviewImg');
  const holder   = document.getElementById('brandingPreviewPlaceholder');
  const removeBtn = document.getElementById('brandingRemoveBtn');

  if (url) {
    if (img)     { img.src = url; img.classList.remove('hidden'); }
    if (holder)   holder.classList.add('hidden');
    if (removeBtn) removeBtn.classList.remove('hidden');
  } else {
    if (img)     img.classList.add('hidden');
    if (holder)   holder.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');
  }
}

function _applyCompanyLogoPreview(url) {
  // Security sidebar card
  const img       = document.getElementById('companyLogoPreviewImg');
  const holder    = document.getElementById('companyLogoPreviewPlaceholder');
  const removeBtn = document.getElementById('companyLogoRemoveBtn');
  if (url) {
    if (img)      { img.src = url; img.classList.remove('hidden'); }
    if (holder)    holder.classList.add('hidden');
    if (removeBtn) removeBtn.classList.remove('hidden');
  } else {
    if (img)      img.classList.add('hidden');
    if (holder)    holder.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');
  }

  // Inline preview in "Dados da empresa"
  const inlineImg         = document.getElementById('companyLogoInlineImg');
  const inlinePlaceholder = document.getElementById('companyLogoInlinePlaceholder');
  const inlineRemove      = document.getElementById('companyLogoInlineRemoveBtn');
  if (url) {
    if (inlineImg)         { inlineImg.src = url; inlineImg.classList.remove('hidden'); }
    if (inlinePlaceholder)  inlinePlaceholder.classList.add('hidden');
    if (inlineRemove)       inlineRemove.classList.remove('hidden');
  } else {
    if (inlineImg)         { inlineImg.src = ''; inlineImg.classList.add('hidden'); }
    if (inlinePlaceholder)  inlinePlaceholder.classList.remove('hidden');
    if (inlineRemove)       inlineRemove.classList.add('hidden');
  }
}

function loadBrandingPreview() {
  _applyBrandingPreview(state.currentCompany?.pdvClosedLogoUrl || null);
  _applyCompanyLogoPreview(state.currentCompany?.logoUrl || null);

  const canManage = _canManageBranding();
  const brandingCard = document.getElementById('brandingCard');
  if (brandingCard) brandingCard.classList.toggle('hidden', !canManage);
  const logoCard = document.getElementById('companyLogoCard');
  if (logoCard) logoCard.classList.toggle('hidden', !canManage);
}

/* ================= PDV MODE SELECTOR ================= */

/**
 * Seleciona o modo de operação do PDV visualmente.
 * Usa IDs diretos (#pdvModeSimplified / #pdvModeControlled) — sem depender do container pai.
 * Chamado nos click listeners dos cards, em renderPdvSettings() e em savePdvSettingsAction().
 */
function selectPdvMode(mode) {
  const simCard  = document.getElementById('pdvModeSimplified');
  const ctrlCard = document.getElementById('pdvModeControlled');
  if (simCard)  simCard.classList.toggle('is-active',  mode === 'simplified');
  if (ctrlCard) ctrlCard.classList.toggle('is-active', mode === 'controlled');
}

/**
 * Lê o modo de operação atualmente ativo lendo diretamente os cards.
 * Não depende de data-attributes, container ou select oculto.
 */
function getSelectedPdvMode() {
  return document.getElementById('pdvModeControlled')?.classList.contains('is-active')
    ? 'controlled'
    : 'simplified';
}

/* ================= BIND ================= */

export function bindSettingsActions() {
  /* ---- botões existentes ---- */
  document.getElementById('saveCompanySettingsBtn')?.addEventListener('click', saveCompanySettings);
  document.getElementById('runSelfTestsBtn')?.addEventListener('click', renderSelfTests);
  document.getElementById('reloadSessionsBtn')?.addEventListener('click', async () => { await renderActiveSessions(); });
  document.getElementById('revokeAllSessionsBtn')?.addEventListener('click', async () => { await revokeAllSessions(); });
  document.getElementById('deleteMyAccountBtn')?.addEventListener('click', async () => { await deleteMyAccount(); });
  document.getElementById('viewSessionsBtn')?.addEventListener('click', async () => { await renderActiveSessions(); });

  document.getElementById('securityPasswordToggle')?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    localStorage.setItem('gamby_security_required', enabled ? 'true' : 'false');
    const msg = enabled
      ? 'Senha de segurança ativada. Ações protegidas voltarão a exigir senha.'
      : 'Senha de segurança desativada. Ações protegidas não exigirão senha.';
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.className = `toast ${enabled ? 'toast-success' : 'toast-warning'}`;
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  });

  /* ---- abas de configuração — mostra/esconde data-tab-section ---- */
  function _activateSettingsTab(tab) {
    document.querySelectorAll('#settingsTabsBar button[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('[data-tab-section]').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.tabSection !== tab);
    });
    // Lazy render: carregar dados da aba ao abrir pela primeira vez
    if (tab === 'notificacoes') renderSettingsNotifications();
    if (tab === 'auditoria')    { /* já renderiza ao clicar no botão */ }
    if (tab === 'perfil-negocio') renderBusinessProfile();
    if (tab === 'pdv-caixa')      renderPdvSettings();
    if (tab === 'cfg-avancada')   renderAdvancedTerminals();
    if (tab === 'personalizacao') renderPersonalizationPanel();
    if (tab === 'politica-comercial') renderCommercialPolicySettings();
    if (tab === 'movim-admin') { renderAdminMovementUsers(); renderAdminMovementsList(); }
    // Salva tab ativa no sessionStorage para restaurar no refresh
    try { sessionStorage.setItem('gamby_settings_tab', tab); } catch (_) {}
  }

  document.getElementById('settingsTabsBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    _activateSettingsTab(btn.dataset.tab);
  });

  // Hero cards — navegação rápida
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settings-action]');
    if (!btn) return;
    const action = btn.dataset.settingsAction;
    if (action === 'go-perfil-negocio') _activateSettingsTab('perfil-negocio');
    if (action === 'go-details') { /* formulário já está na aba geral */ }
  });

  // Restaura tab ativa se houver sessão salva
  const _savedTab = (() => { try { return sessionStorage.getItem('gamby_settings_tab'); } catch (_) { return null; } })();
  if (_savedTab) _activateSettingsTab(_savedTab);

  /* ---- busca na tabela de produtos ---- */
  document.getElementById('cfgProductSearch')?.addEventListener('input', (e) => {
    renderCfgProductsTable(e.target.value);
  });

  /* ---- botão novo produto: redireciona para página de produtos ---- */
  document.getElementById('cfgAddProductBtn')?.addEventListener('click', () => {
    // Clica no botão de navegação do menu (fluxo completo e correto)
    const navBtn = document.querySelector('.nav-btn[data-page="produtos"]');
    if (navBtn) {
      navBtn.click();
    } else {
      window.openPageDirect?.('produtos');
    }
    // Foca o campo nome do produto para o usuário já poder digitar
    setTimeout(() => {
      const nameField = document.getElementById('productName');
      if (nameField) {
        nameField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nameField.focus();
      }
    }, 180);
  });

  /* ---- links de navegação nos KPI cards ---- */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-settings-action]');
    if (!link) return;
    e.preventDefault();
    const action = link.dataset.settingsAction;
    if (action === 'go-users') {
      window.openPageDirect?.('usuarios');
    } else if (action === 'go-backup') {
      document.getElementById('doBackupBtn')?.click();
    } else if (action === 'go-details' || action === 'go-all') {
      /* Já estamos na página de configurações — scroll até o formulário */
      document.getElementById('companyName')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  /* ---- manutenção ---- */
  _bindMaintenanceBtn('doBackupBtn', 'Fazer backup', 'Fazendo backup...', 'Backup salvo!', _runBackup);
  _bindMaintenanceBtn('clearCacheBtn', 'Executar', 'Limpando...', 'Cache limpo!', _runClearCache);
  _bindMaintenanceBtn('reindexDataBtn', 'Executar', 'Reindexando...', 'Concluído!', () => Promise.resolve());

  /* ---- personalização visual: cor do tema ---- */
  _bindThemeColors();

  /* ---- cards de tema visíveis (darkThemeCard / lightThemeCard) ---- */
  document.getElementById('darkThemeCard')?.addEventListener('click', () => {
    _applyThemeMode('dark');
    _pendingPersonalization.themeMode = 'dark';
  });
  document.getElementById('lightThemeCard')?.addEventListener('click', () => {
    _applyThemeMode('light');
    _pendingPersonalization.themeMode = 'light';
  });

  /* ---- modo escuro / claro — botões legados (mantidos para compat.) ---- */
  document.getElementById('darkModeBtn')?.addEventListener('click', () => {
    _applyThemeMode('dark');
    _pendingPersonalization.themeMode = 'dark';
  });
  document.getElementById('lightModeBtn')?.addEventListener('click', () => {
    _applyThemeMode('light');
    _pendingPersonalization.themeMode = 'light';
  });

  /* ---- cor personalizada via color picker ---- */
  document.getElementById('customThemeColor')?.addEventListener('input', (e) => {
    const color = e.target.value;
    _applyThemeColor(color);
    _pendingPersonalization.primaryColor = color;
    const hexEl = document.getElementById('customColorHex');
    if (hexEl) hexEl.textContent = color;
  });

  /* ---- salvar personalização no backend ---- */
  document.getElementById('savePersonalizationBtn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('personalizationStatus');
    if (statusEl) { statusEl.textContent = 'Salvando...'; statusEl.className = 'cfg-status-msg'; }
    try {
      const payload = {
        ..._pendingPersonalization,
        loginMessage:         document.getElementById('pzLoginMessage')?.value?.trim()         || null,
        receiptMessage:       document.getElementById('pzReceiptMessage')?.value?.trim()       || null,
        closedCashierMessage: document.getElementById('pzClosedCashierMessage')?.value?.trim() || null,
        reportHeaderText:     document.getElementById('pzReportHeaderText')?.value?.trim()     || null,
        reportFooterText:     document.getElementById('pzReportFooterText')?.value?.trim()     || null,
      };
      await savePersonalizationService(payload);
      _pendingPersonalization = {};
      if (statusEl) { statusEl.textContent = 'Personalização salva!'; statusEl.className = 'cfg-status-msg cfg-status-ok'; }
      setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cfg-status-msg'; } }, 3000);
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message || 'Erro ao salvar.'; statusEl.className = 'cfg-status-msg cfg-status-error'; }
    }
  });

  /* ---- Notificações e Alertas: preferências de canal/tipo (local, sem endpoint de backend) ---- */
  _loadNotificationsSettingsForm();
  document.getElementById('saveNotificationsSettingsBtn')?.addEventListener('click', saveNotificationsSettings);

  /* ---- marcar todas notificações como lidas ---- */
  document.getElementById('markAllNotifReadBtn')?.addEventListener('click', async () => {
    try {
      const { markAllNotificationsReadService } = await import('./services/notifications-service.js');
      await markAllNotificationsReadService();
      renderSettingsNotifications();
    } catch (_err) {}
  });

  /* ---- gerenciamento de terminais ---- */
  bindTerminalsSettingsActions();

  /* ---- maquininhas de cartão ---- */
  document.getElementById('saveCardMachinesBtn')?.addEventListener('click', saveCardMachinesSettings);
  document.getElementById('defaultCardMachineSelect')?.addEventListener('change', () => {
    const val = document.getElementById('defaultCardMachineSelect')?.value;
    if (val) {
      state.paymentSettings = { ...state.paymentSettings, defaultCardMachine: val };
    }
  });

  /* ---- desconto dinheiro/PIX ---- */
  document.getElementById('savePayDiscountBtn')?.addEventListener('click', savePayDiscountSettings);
  document.getElementById('cashDiscountEnabled')?.addEventListener('change', _updateDiscountFieldVisibility);
  document.getElementById('pixDiscountEnabled')?.addEventListener('change', _updateDiscountFieldVisibility);

  /* ---- Pagamentos: botão "Salvar alterações" do rodapé da aba — aciona os dois saves reais ---- */
  document.getElementById('savePaymentSettingsBtn')?.addEventListener('click', () => {
    saveCardMachinesSettings();
    savePayDiscountSettings();
  });

  /* ---- MFA ---- */
  document.getElementById('mfaSetupBtn')?.addEventListener('click', async () => {
    const msg      = document.getElementById('mfaMsg');
    const qrSection = document.getElementById('mfaQrSection');
    const qrImg    = document.getElementById('mfaQrImg');
    if (msg) { msg.textContent = 'Gerando QR code...'; msg.className = ''; }
    try {
      const data = await setupMfaService();
      if (qrImg)     qrImg.src = data.qrDataUrl;
      if (qrSection) qrSection.classList.remove('hidden');
      if (msg)       msg.textContent = 'Escaneie o QR code com seu aplicativo autenticador e confirme o código abaixo.';
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'notice-error'; }
    }
  });

  document.getElementById('mfaVerifyBtn')?.addEventListener('click', async () => {
    const token = document.getElementById('mfaVerifyInput')?.value.trim();
    const msg   = document.getElementById('mfaMsg');
    if (!token) {
      if (msg) { msg.textContent = 'Digite o código do aplicativo autenticador.'; msg.className = 'notice-error'; }
      return;
    }
    if (msg) { msg.textContent = 'Verificando...'; msg.className = ''; }
    try {
      await verifyMfaService(token);
      if (msg) { msg.textContent = 'MFA ativado com sucesso!'; msg.className = 'notice-success'; }
      document.getElementById('mfaVerifyInput').value = '';
      await loadMfaStatus();
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'notice-error'; }
    }
  });

  document.getElementById('mfaDisableBtn')?.addEventListener('click', async () => {
    const token = document.getElementById('mfaDisableInput')?.value.trim();
    const msg   = document.getElementById('mfaMsg');
    if (!token) {
      if (msg) { msg.textContent = 'Digite o código do aplicativo para confirmar a desativação.'; msg.className = 'notice-error'; }
      return;
    }
    if (msg) { msg.textContent = 'Desativando MFA...'; msg.className = ''; }
    try {
      await disableMfaService(token);
      if (msg) { msg.textContent = 'MFA desativado.'; msg.className = 'notice-success'; }
      document.getElementById('mfaDisableInput').value = '';
      await loadMfaStatus();
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'notice-error'; }
    }
  });

  /* ---- Logo principal da empresa ---- */
  document.getElementById('companyLogoFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const msg  = document.getElementById('companyLogoMsg');
    if (!file) return;
    if (msg) { msg.textContent = 'Enviando logo...'; msg.className = 'cfg-hint'; }
    try {
      const result = await uploadCompanyLogoService(file);
      if (state.currentCompany) state.currentCompany.logoUrl = result.logoUrl;
      _applyCompanyLogoPreview(result.logoUrl);
      if (msg) { msg.textContent = 'Logo da empresa atualizada.'; msg.className = 'cfg-hint cfg-hint-ok'; }
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'cfg-hint cfg-hint-err'; }
    }
    e.target.value = '';
  });

  document.getElementById('companyLogoRemoveBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('companyLogoMsg');
    if (msg) { msg.textContent = 'Removendo logo...'; msg.className = 'cfg-hint'; }
    try {
      await removeCompanyLogoService();
      if (state.currentCompany) state.currentCompany.logoUrl = null;
      _applyCompanyLogoPreview(null);
      if (msg) { msg.textContent = 'Logo removida.'; msg.className = 'cfg-hint cfg-hint-ok'; }
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'cfg-hint cfg-hint-err'; }
    }
  });

  /* ---- Logo inline em Dados da empresa ---- */
  document.getElementById('companyLogoInlineBtn')?.addEventListener('click', () => {
    document.getElementById('companyLogoInlineInput')?.click();
  });

  document.getElementById('companyLogoInlineInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const msg  = document.getElementById('companyLogoInlineMsg');
    if (!file) return;
    if (msg) { msg.textContent = 'Enviando logo...'; msg.className = 'mini text-center'; }
    try {
      const result = await uploadCompanyLogoService(file);
      if (state.currentCompany) state.currentCompany.logoUrl = result.logoUrl;
      _applyCompanyLogoPreview(result.logoUrl);
      if (msg) { msg.textContent = 'Logo atualizada!'; msg.className = 'mini text-center cfg-hint-ok'; }
      setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
    } catch (err) {
      if (msg) { msg.textContent = err.message || 'Erro ao enviar.'; msg.className = 'mini text-center cfg-hint-err'; }
    }
    e.target.value = '';
  });

  document.getElementById('companyLogoInlineRemoveBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('companyLogoInlineMsg');
    if (msg) { msg.textContent = 'Removendo logo...'; msg.className = 'mini text-center'; }
    try {
      await removeCompanyLogoService();
      if (state.currentCompany) state.currentCompany.logoUrl = null;
      _applyCompanyLogoPreview(null);
      if (msg) { msg.textContent = 'Logo removida.'; msg.className = 'mini text-center cfg-hint-ok'; }
      setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
    } catch (err) {
      if (msg) { msg.textContent = err.message || 'Erro ao remover.'; msg.className = 'mini text-center cfg-hint-err'; }
    }
  });

  /* ---- Balança ---- */
  bindScaleSettingsActions();

  /* ---- Política Comercial ---- */
  document.getElementById('saveCommercialPolicyBtn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('commercialPolicyStatus');
    if (statusEl) { statusEl.textContent = 'Salvando...'; statusEl.className = 'cfg-status-msg'; }
    try {
      await saveCommercialPolicyService({
        maxDiscountPercent: parseFloat(document.getElementById('cpMaxDiscountPercent')?.value) || 20,
        minMarginPercent:   parseFloat(document.getElementById('cpMinMarginPercent')?.value) || 0,
        maxDiscountOperador: parseFloat(document.getElementById('cpMaxDiscountOperador')?.value) || 10,
        maxDiscountGerente:  parseFloat(document.getElementById('cpMaxDiscountGerente')?.value) || 20,
        maxDiscountAdmin:    parseFloat(document.getElementById('cpMaxDiscountAdmin')?.value) || 50,
        blockBelowCost:        document.getElementById('cpBlockBelowCost')?.checked ?? true,
        requireAuthForDiscount: document.getElementById('cpRequireAuthForDiscount')?.checked ?? false,
        requireJustification:   document.getElementById('cpRequireJustification')?.checked ?? false,
      });
      if (statusEl) { statusEl.textContent = 'Política comercial salva!'; statusEl.className = 'cfg-status-msg cfg-status-ok'; }
      setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cfg-status-msg'; } }, 3000);
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message || 'Erro ao salvar.'; statusEl.className = 'cfg-status-msg cfg-status-error'; }
    }
  });

  /* ---- Movimentações Administrativas ---- */
  document.getElementById('saveAdminMovementBtn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('adminMovementStatus');

    const _executeAdminMovement = async () => {
      if (statusEl) { statusEl.textContent = 'Registrando...'; statusEl.className = 'cfg-status-msg'; }
      try {
        await createAdminMovementService({
          type:           document.getElementById('amType')?.value,
          amount:         parseFloat(document.getElementById('amAmount')?.value) || 0,
          reason:         document.getElementById('amReason')?.value?.trim(),
          description:    document.getElementById('amDescription')?.value?.trim(),
          responsibleId:  document.getElementById('amResponsibleId')?.value,
          authorizedById: document.getElementById('amAuthorizedById')?.value,
          notes:          document.getElementById('amNotes')?.value?.trim() || null,
        });
        if (statusEl) { statusEl.textContent = 'Movimentação registrada com sucesso!'; statusEl.className = 'cfg-status-msg cfg-status-ok'; }
        ['amType','amAmount','amReason','amNotes'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        const descEl = document.getElementById('amDescription');
        if (descEl) descEl.value = '';
        await renderAdminMovementsList();
        setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cfg-status-msg'; } }, 3000);
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message || 'Erro ao registrar.'; statusEl.className = 'cfg-status-msg cfg-status-error'; }
      }
    };

    // Modo controlado: sangria e suprimento sempre exigem supervisor
    // Modo simplificado: só exige se o cliente ativou explicitamente nas configurações
    const pdvCfg = state?.pdvSettings;
    const isControlled = pdvCfg?.pdvMode === 'controlled';
    const movType      = String(document.getElementById('amType')?.value || '').toLowerCase();
    const isSangria    = movType.includes('sangria')    || movType.includes('bleed');
    const isSuprimento = movType.includes('suprimento') || movType.includes('supply');
    const needsAuth    = isControlled
      ? (isSangria || isSuprimento)
      : (isSangria && Boolean(pdvCfg?.requireAuthSangria)) || (isSuprimento && Boolean(pdvCfg?.requireAuthSuprimento));

    if (needsAuth && typeof window.openSecureCashCloseModal === 'function') {
      window.openSecureCashCloseModal(_executeAdminMovement, { forceAuth: true });
      return;
    }

    await _executeAdminMovement();
  });

  /* ---- Senha do Administrador — salvar ---- */
  document.getElementById('saveAdminPasswordBtn')?.addEventListener('click', saveAdminPasswordAction);

  /* ---- PDV e Caixa — salvar ---- */
  document.getElementById('savePdvSettingsBtn')?.addEventListener('click', savePdvSettingsAction);

  /* Modo de operação — listeners diretos nos cards (sem depender do container pai) */
  document.getElementById('pdvModeSimplified')?.addEventListener('click', () => selectPdvMode('simplified'));
  document.getElementById('pdvModeControlled')?.addEventListener('click', () => selectPdvMode('controlled'));

  /* Suporte a teclado */
  document.getElementById('pdvModeSimplified')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPdvMode('simplified'); }
  });
  document.getElementById('pdvModeControlled')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPdvMode('controlled'); }
  });

  /* ---- Perfil do Negócio — cards de segmento ---- */
  document.getElementById('bpBizGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.bp-biz-card[data-biz-value]');
    if (!card) return;
    const segment = card.dataset.bizValue;
    _syncBizCards(segment);
    applyBusinessProfilePreset(segment);
  });

  /* Suporte a teclado nos cards */
  document.getElementById('bpBizGrid')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.bp-biz-card[data-biz-value]');
    if (!card) return;
    e.preventDefault();
    const segment = card.dataset.bizValue;
    _syncBizCards(segment);
    applyBusinessProfilePreset(segment);
  });

  /* Botão Restaurar — re-carrega do backend sem aplicar preset */
  document.getElementById('bpRestoreBtn')?.addEventListener('click', () => renderBusinessProfile());

  /* ---- Perfil do Negócio — salvar ---- */
  document.getElementById('saveBusinessProfileBtn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('businessProfileStatus');
    if (statusEl) { statusEl.textContent = 'Salvando...'; statusEl.className = 'cfg-status-msg'; }
    try {
      const businessType = document.getElementById('bpBusinessType')?.value || null;
      const result = await saveBusinessProfileService({
        businessType,
        featStock:       document.getElementById('bpFeatStock')?.checked ?? true,
        featDelivery:    document.getElementById('bpFeatDelivery')?.checked ?? false,
        featWeighing:    document.getElementById('bpFeatWeighing')?.checked ?? false,
        featServices:    document.getElementById('bpFeatServices')?.checked ?? false,
        featMarketplace: document.getElementById('bpFeatMarketplace')?.checked ?? false,
        featProduction:  document.getElementById('bpFeatProduction')?.checked ?? false,
        featFiado:       document.getElementById('bpFeatFiado')?.checked ?? false,
        featComandas:    document.getElementById('bpFeatComandas')?.checked ?? false,
      });

      // Sincronizar niche no estado local para que o menu atualize imediatamente
      if (result?.niche !== undefined && state.currentCompany) {
        state.currentCompany.niche = result.niche;
      } else if (result?.niche !== undefined) {
        state.currentCompany = { niche: result.niche };
      }
      applyVisibility();

      if (statusEl) { statusEl.textContent = 'Perfil salvo!'; statusEl.className = 'cfg-status-msg cfg-status-ok'; }
      setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cfg-status-msg'; } }, 4000);
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message || 'Erro ao salvar.'; statusEl.className = 'cfg-status-msg cfg-status-error'; }
    }
  });

  /* ---- Terminal Management (Advanced) ---- */
  document.getElementById('reloadTerminalsBtn')?.addEventListener('click', () => renderAdvancedTerminals());

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reset-terminal-id]');
    if (!btn) return;
    const terminalId   = btn.dataset.resetTerminalId;
    const terminalName = btn.dataset.resetTerminalName;
    const modal        = document.getElementById('terminalResetModal');
    if (!modal) return;
    modal.dataset.terminalId = terminalId;
    document.getElementById('terminalResetName').value = terminalName || '';
    document.getElementById('terminalResetReason').value = '';
    document.getElementById('terminalResetPassword').value = '';
    document.getElementById('terminalResetModalStatus').textContent = '';
    modal.classList.remove('hidden');
  });

  document.getElementById('terminalResetModalClose')?.addEventListener('click',  () => document.getElementById('terminalResetModal')?.classList.add('hidden'));
  document.getElementById('terminalResetModalCancel')?.addEventListener('click', () => document.getElementById('terminalResetModal')?.classList.add('hidden'));

  document.getElementById('terminalResetConfirmBtn')?.addEventListener('click', async () => {
    const modal    = document.getElementById('terminalResetModal');
    const statusEl = document.getElementById('terminalResetModalStatus');
    const terminalId = modal?.dataset.terminalId;
    const reason     = document.getElementById('terminalResetReason')?.value?.trim();
    if (!reason) { if (statusEl) { statusEl.textContent = 'Motivo obrigatório.'; statusEl.className = 'cfg-status-msg cfg-status-error'; } return; }
    if (statusEl) { statusEl.textContent = 'Resetando...'; statusEl.className = 'cfg-status-msg'; }
    try {
      await resetTerminalService(terminalId, reason);
      if (statusEl) { statusEl.textContent = 'Terminal resetado com sucesso.'; statusEl.className = 'cfg-status-msg cfg-status-ok'; }
      setTimeout(() => { modal.classList.add('hidden'); renderAdvancedTerminals(); }, 1500);
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message || 'Erro ao resetar.'; statusEl.className = 'cfg-status-msg cfg-status-error'; }
    }
  });

  /* ---- Auditoria ---- */
  document.getElementById('loadAuditLogsBtn')?.addEventListener('click', () => renderAuditLogs());

  /* ---- Branding PDV ---- */
  document.getElementById('brandingFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const msg  = document.getElementById('brandingMsg');
    if (!file) return;
    if (msg) { msg.textContent = 'Enviando imagem...'; msg.className = ''; }
    try {
      const result = await uploadPdvLogoService(file);
      if (state.currentCompany) state.currentCompany.pdvClosedLogoUrl = result.pdvClosedLogoUrl;
      _applyBrandingPreview(result.pdvClosedLogoUrl);
      if (msg) { msg.textContent = 'Imagem da tela de caixa fechado atualizada com sucesso.'; msg.className = 'notice-success'; }
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'notice-error'; }
    }
    e.target.value = '';
  });

  document.getElementById('brandingRemoveBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('brandingMsg');
    if (msg) { msg.textContent = 'Removendo imagem...'; msg.className = ''; }
    try {
      await removePdvLogoService();
      if (state.currentCompany) state.currentCompany.pdvClosedLogoUrl = null;
      _applyBrandingPreview(null);
      if (msg) { msg.textContent = 'Imagem removida. O sistema usará o placeholder padrão.'; msg.className = 'notice-success'; }
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'notice-error'; }
    }
  });
}

/* ================= MAQUININHAS ================= */

function renderCardMachinesSettings() {
  const ps       = state.paymentSettings || {};
  const machines = ps.cardMachines || [];
  const wrap     = document.getElementById('cardMachinesTableWrap');

  if (wrap) {
    wrap.innerHTML = machines.length
      ? machines.map((m) => {
          const mId   = escapeHtml(m.id   || '');
          const mName = escapeHtml(m.name || '—');
          const chk   = m.enabled !== false ? 'checked' : '';
          return `
            <div class="cmc-card" data-machine-id="${mId}">
              <div class="cmc-top">
                <div class="cmc-brand">
                  <div class="cmc-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                  </div>
                  <div>
                    <strong class="cmc-name">${mName}</strong>
                    <span class="cmc-sub">Maquininha de cartão</span>
                  </div>
                </div>
                <label class="cfg-switch-pill cmc-toggle" title="Habilitar maquininha">
                  <input type="checkbox" class="cm-enabled" ${chk} />
                  <span class="cfg-pill-track"><span class="cfg-pill-thumb"></span></span>
                </label>
              </div>
              <div class="cmc-rates">
                <div class="cmc-rate-cell">
                  <label class="cmc-rate-label">Débito</label>
                  <div class="cm-rate-input-wrap">
                    <input type="number" class="cfg-input-sm cm-rate" data-field="debito" value="${Number(m.debito) || 0}" step="0.01" min="0" />
                    <span class="cm-pct">%</span>
                  </div>
                </div>
                <div class="cmc-rate-cell">
                  <label class="cmc-rate-label">Créd. à vista</label>
                  <div class="cm-rate-input-wrap">
                    <input type="number" class="cfg-input-sm cm-rate" data-field="credito" value="${Number(m.credito) || 0}" step="0.01" min="0" />
                    <span class="cm-pct">%</span>
                  </div>
                </div>
                <div class="cmc-rate-cell">
                  <label class="cmc-rate-label">Créd. 2–6x</label>
                  <div class="cm-rate-input-wrap">
                    <input type="number" class="cfg-input-sm cm-rate" data-field="credito2a6" value="${Number(m.credito2a6) || 0}" step="0.01" min="0" />
                    <span class="cm-pct">%</span>
                  </div>
                </div>
                <div class="cmc-rate-cell">
                  <label class="cmc-rate-label">Créd. 7–12x</label>
                  <div class="cm-rate-input-wrap">
                    <input type="number" class="cfg-input-sm cm-rate" data-field="credito7a12" value="${Number(m.credito7a12) || 0}" step="0.01" min="0" />
                    <span class="cm-pct">%</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')
      : '<p class="cfg-empty-hint">Nenhuma maquininha cadastrada. Configure no menu PDV &gt; Pagamentos.</p>';
  }

  const defSel = document.getElementById('defaultCardMachineSelect');
  if (defSel) {
    defSel.innerHTML = machines.map((m) =>
      `<option value="${escapeHtml(m.id)}" ${m.id === ps.defaultCardMachine ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');
  }
}

function saveCardMachinesSettings() {
  const ps       = state.paymentSettings || {};
  const machines = [...(ps.cardMachines || [])];

  document.querySelectorAll('#cardMachinesTableWrap .cmc-card[data-machine-id]').forEach((card) => {
    const id  = card.dataset.machineId;
    const idx = machines.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const updated = { ...machines[idx] };
    card.querySelectorAll('.cm-rate').forEach((inp) => {
      const field = inp.dataset.field;
      if (field) updated[field] = Number(inp.value) || 0;
    });
    const enabledCb = card.querySelector('.cm-enabled');
    if (enabledCb) updated.enabled = enabledCb.checked;
    machines[idx] = updated;
  });

  const defaultMachine = document.getElementById('defaultCardMachineSelect')?.value || ps.defaultCardMachine;
  state.paymentSettings = { ...ps, cardMachines: machines, defaultCardMachine: defaultMachine };
  save(KEYS.paymentSettings, state.paymentSettings);

  _showCfgStatus('cardMachinesStatus', 'Maquininhas salvas!', false);
}

/* ================= NOTIFICAÇÕES E ALERTAS (preferências locais) ================= */

const NOTIFICATION_SETTINGS_CHECKBOX_IDS = [
  'notifChannelSystem', 'notifChannelEmail', 'notifChannelWhatsApp', 'notifChannelSms',
  'notifOnCashOpen', 'notifOnCashClose', 'notifOnZeroStock', 'notifOnCashDiff',
  'notifOnAdminMove', 'notifOnTerminalReset', 'notifOnDiscountBlock',
];

function _loadNotificationsSettingsForm() {
  const saved = load(KEYS.notificationSettings, null);
  if (!saved) return;
  NOTIFICATION_SETTINGS_CHECKBOX_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && typeof saved[id] === 'boolean') el.checked = saved[id];
  });
}

function saveNotificationsSettings() {
  const prefs = {};
  NOTIFICATION_SETTINGS_CHECKBOX_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) prefs[id] = el.checked;
  });
  save(KEYS.notificationSettings, prefs);
  _showCfgStatus('notificationsSettingsStatus', 'Preferências de notificação salvas!', false);
}

/* ================= SHARED STATUS HELPER ================= */

function _showCfgStatus(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `cfg-status-msg ${isError ? 'cfg-status-error' : 'cfg-status-ok'}`;
  setTimeout(() => { el.textContent = ''; el.className = 'cfg-status-msg'; }, 3000);
}

/* ================= DESCONTO DINHEIRO / PIX ================= */

function _updateDiscountFieldVisibility() {
  const cashEnabled = document.getElementById('cashDiscountEnabled')?.checked;
  const pixEnabled  = document.getElementById('pixDiscountEnabled')?.checked;
  document.getElementById('cashDiscountFields')?.classList.toggle('hidden', !cashEnabled);
  document.getElementById('pixDiscountFields')?.classList.toggle('hidden', !pixEnabled);
}

function renderPayDiscountSettings() {
  const ps = state.paymentSettings || {};

  const cashEn   = document.getElementById('cashDiscountEnabled');
  const cashMode = document.getElementById('cashDiscountMode');
  const cashVal  = document.getElementById('cashDiscountValue');
  const pixEn    = document.getElementById('pixDiscountEnabled');
  const pixMode  = document.getElementById('pixDiscountMode');
  const pixVal   = document.getElementById('pixDiscountValue');

  if (cashEn)   cashEn.checked   = Boolean(ps.cashDiscountEnabled);
  if (cashMode) cashMode.value   = ps.cashDiscountMode || 'percent';
  if (cashVal)  cashVal.value    = ps.cashDiscountValue ?? 5;
  if (pixEn)    pixEn.checked    = Boolean(ps.pixDiscountEnabled);
  if (pixMode)  pixMode.value    = ps.pixDiscountMode || 'percent';
  if (pixVal)   pixVal.value     = ps.pixDiscountValue ?? 5;

  _updateDiscountFieldVisibility();
}

function savePayDiscountSettings() {
  const ps = state.paymentSettings || {};
  state.paymentSettings = {
    ...ps,
    cashDiscountEnabled: document.getElementById('cashDiscountEnabled')?.checked || false,
    cashDiscountMode:    document.getElementById('cashDiscountMode')?.value || 'percent',
    cashDiscountValue:   Number(document.getElementById('cashDiscountValue')?.value) || 0,
    pixDiscountEnabled:  document.getElementById('pixDiscountEnabled')?.checked || false,
    pixDiscountMode:     document.getElementById('pixDiscountMode')?.value || 'percent',
    pixDiscountValue:    Number(document.getElementById('pixDiscountValue')?.value) || 0
  };

  save(KEYS.paymentSettings, state.paymentSettings);
  _showCfgStatus('payDiscountStatus', 'Descontos salvos!', false);
}

/* ---- helpers de manutenção ---- */

function _btnText(id, text) {
  const btn = document.getElementById(id);
  if (btn) btn.textContent = text;
}

function _bindMaintenanceBtn(id, labelIdle, labelRunning, labelDone, task) {
  document.getElementById(id)?.addEventListener('click', async () => {
    _btnText(id, labelRunning);
    try {
      await task();
      _btnText(id, labelDone);
    } catch {
      _btnText(id, 'Erro');
    }
    setTimeout(() => _btnText(id, labelIdle), 2200);
  });
}

async function _runBackup() {
  const data = {
    exportedAt: new Date().toISOString(),
    products: Array.isArray(state.products) ? state.products : [],
    sales: Array.isArray(state.sales) ? state.sales : [],
    companySettings: state.companySettings || {}
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gamby-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function _runClearCache() {
  const keysToKeep = new Set([
    'gamby_auth_session_modular', 'session', 'gamby_session',
    'internalUsers', 'gamby_internal_users_modular', 'gamby_auth_users_modular',
    'gamby_current_page', 'gamby_last_page', 'gamby_company_settings_modular',
    'gamby_security_answer', 'gamby_theme_color'
  ]);
  Object.keys(localStorage).forEach((key) => {
    if (!keysToKeep.has(key)) localStorage.removeItem(key);
  });
  return Promise.resolve();
}

/* ---- helpers de tema ---- */

function _applyThemeColor(color) {
  document.documentElement.style.setProperty('--blue', color);
  localStorage.setItem('gamby_theme_color', color);

  const checkSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

  document.querySelectorAll('[data-theme-color]').forEach((s) => {
    const isActive = s.dataset.themeColor === color;
    s.classList.toggle('is-active', isActive);
    s.innerHTML = isActive ? checkSvg : '';
  });
}

function _bindThemeColors() {
  document.getElementById('themeColorSwatches')?.addEventListener('click', (e) => {
    const swatch = e.target.closest('[data-theme-color]');
    if (!swatch) return;
    _applyThemeColor(swatch.dataset.themeColor);
  });

  /* restaura cor salva ao inicializar */
  const savedColor = localStorage.getItem('gamby_theme_color');
  if (savedColor) {
    _applyThemeColor(savedColor);
  }

  /* restaura tema claro/escuro salvo ao inicializar */
  const savedMode = localStorage.getItem('gamby_theme_mode');
  if (savedMode) {
    _applyThemeMode(savedMode);
  }
}

/* ================= CANAIS DE COMUNICAÇÃO ================= */

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _cfgWaTab = 'whatsapp';

function renderCfgCanaisPanel() {
  const panel = document.getElementById('cfgCanaisPanel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="cfg-canais-shell">
      <div class="cfg-panel-head">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 5.36 5.36l1.72-1.72a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        <h3>Canais de Comunicação</h3>
      </div>
      <p class="cfg-canais-desc">Configure os canais de envio de mensagens integrados ao GAMBY.</p>

      <div class="cfg-canais-tabs" id="cfgCanaisTabsBar">
        <button class="${_cfgWaTab === 'whatsapp' ? 'active' : ''}" data-canais-tab="whatsapp" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 5.36 5.36l1.72-1.72a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          WhatsApp
        </button>
        <button class="${_cfgWaTab === 'email' ? 'active' : ''}" data-canais-tab="email" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          E-mail
        </button>
        <button class="${_cfgWaTab === 'sms' ? 'active' : ''}" data-canais-tab="sms" type="button">SMS</button>
      </div>

      <div id="cfgCanaisContent"></div>
    </div>
  `;

  document.getElementById('cfgCanaisTabsBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-canais-tab]');
    if (!btn) return;
    _cfgWaTab = btn.dataset.canaisTab;
    document.querySelectorAll('#cfgCanaisTabsBar button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _renderCanaisContent();
  });

  _renderCanaisContent();
}

function _renderCanaisContent() {
  const el = document.getElementById('cfgCanaisContent');
  if (!el) return;
  if (_cfgWaTab === 'whatsapp') _renderWaContent(el);
  else if (_cfgWaTab === 'email') _renderEmailContent(el);
  else _renderSmsContent(el);
}

/* ─── WhatsApp ─────────────────────────────────────────────────────────────── */

async function _renderWaContent(el) {
  const companyId = state?.currentUser?.companyId || state?.session?.companyId || 'default';
  el.innerHTML = '<div class="cfg-wa-loading">Verificando status da integração...</div>';

  let status;
  try {
    status = await getWhatsAppIntegrationStatus(companyId);
  } catch {
    status = { status: WA_STATUS.NOT_CONFIGURED };
  }

  const st = status?.status || WA_STATUS.NOT_CONFIGURED;
  const phone = _esc(status?.phone || '');
  const lastConnectedRaw = status?.lastConnectedAt ? new Date(status.lastConnectedAt).toLocaleString('pt-BR') : null;
  const lastConnected = lastConnectedRaw ? _esc(lastConnectedRaw) : null;

  const statusBadge = {
    [WA_STATUS.NOT_CONFIGURED]: '<span class="cfg-wa-badge cfg-wa-badge--gray">Não configurado</span>',
    [WA_STATUS.CONFIGURED]:     '<span class="cfg-wa-badge cfg-wa-badge--yellow">Configurado</span>',
    [WA_STATUS.ACTIVE]:         '<span class="cfg-wa-badge cfg-wa-badge--green">Ativo</span>',
    [WA_STATUS.DISCONNECTED]:   '<span class="cfg-wa-badge cfg-wa-badge--red">Desconectado</span>',
    [WA_STATUS.ERROR]:          '<span class="cfg-wa-badge cfg-wa-badge--red">Erro de conexão</span>',
  }[st] || '<span class="cfg-wa-badge cfg-wa-badge--gray">Não configurado</span>';

  const isActive = st === WA_STATUS.ACTIVE;
  const savedMetaCfg = getWhatsAppMetaSafeConfig(companyId);

  el.innerHTML = `
    <div class="cfg-wa-wrap">

      <!-- Status bar -->
      <div class="cfg-wa-status-bar">
        <div class="cfg-wa-status-left">
          <span class="cfg-wa-status-label">Status atual:</span>
          ${statusBadge}
          ${phone ? `<span class="cfg-wa-phone">${phone}</span>` : ''}
          ${lastConnected ? `<span class="cfg-wa-lastsync">Conectado em: ${lastConnected}</span>` : ''}
        </div>
        ${isActive ? `
        <div class="cfg-wa-status-right">
          <button class="btn btn-ghost btn-sm" id="cfgWaDisconnectBtn" type="button">Desconectar</button>
        </div>` : ''}
      </div>

      <!-- API Meta form -->
      <article class="panel cfg-wa-meta-form">
        <div class="cfg-panel-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
          <h4>Configuração — WhatsApp Business Platform (Meta)</h4>
        </div>
        <div class="settings-duo-grid">
          <div class="field-group">
            <label>Business Account ID <span class="req">*</span></label>
            <input id="cfgWaBusinessAccountId" class="field" placeholder="Ex.: 123456789012345" value="${_esc(savedMetaCfg?.businessAccountId || '')}" />
          </div>
          <div class="field-group">
            <label>Phone Number ID <span class="req">*</span></label>
            <input id="cfgWaPhoneNumberId" class="field" placeholder="Ex.: 987654321098765" value="${_esc(savedMetaCfg?.phoneNumberId || '')}" />
          </div>
          <div class="field-group">
            <label>App ID</label>
            <input id="cfgWaAppId" class="field" placeholder="ID do App no Meta Developers" value="${_esc(savedMetaCfg?.appId || '')}" />
          </div>
          <div class="field-group">
            <label>WABA ID (WhatsApp Business Account)</label>
            <input id="cfgWaWabaId" class="field" placeholder="ID da conta WABA" />
          </div>
          <div class="field-group">
            <label>Access Token <span class="req">*</span></label>
            <input id="cfgWaAccessToken" class="field" type="password" placeholder="Token de acesso permanente" autocomplete="off" />
            <span class="cfg-wa-field-note">Nunca salvo localmente — enviado ao backend de forma segura.</span>
          </div>
          <div class="field-group">
            <label>App Secret</label>
            <input id="cfgWaAppSecret" class="field" type="password" placeholder="App Secret do Meta Developers" autocomplete="off" />
            <span class="cfg-wa-field-note">Nunca salvo localmente — enviado ao backend de forma segura.</span>
          </div>
        </div>
        <div class="cfg-wa-meta-actions">
          ${isActive ? `<button class="btn btn-ghost" id="cfgWaMetaTestBtn" type="button">Testar conexão</button>` : ''}
          <button class="btn btn-primary" id="cfgWaMetaSaveBtn" type="button">Salvar configuração</button>
        </div>
        <div id="cfgWaMetaStatus" class="notice info hidden"></div>
      </article>

      <!-- Aviso de custo -->
      <div class="cfg-wa-cost-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Os custos de envio seguem as regras vigentes da <strong>WhatsApp Business Platform</strong> e podem variar conforme categoria, país e volume. Consulte a tabela oficial da Meta para valores atualizados.
      </div>

      ${isActive ? `
      <div class="cfg-wa-connected-info">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>WhatsApp ativo${phone ? ` — ${phone}` : ''}. Você pode enviar mensagens pela aba <strong>Marketing</strong>.</span>
      </div>
      ` : ''}

    </div><!-- /cfg-wa-wrap -->
  `;

  _bindWaActions(companyId);
}

function _bindWaActions(companyId) {
  /* Disconnect */
  document.getElementById('cfgWaDisconnectBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('cfgWaDisconnectBtn');
    if (btn) btn.textContent = 'Desconectando...';
    try {
      await disconnectWhatsApp(companyId);
    } catch {
      // status will reflect in next render
    }
    const el = document.getElementById('cfgCanaisContent');
    if (el) await _renderWaContent(el);
  });

  /* Test Meta connection */
  document.getElementById('cfgWaMetaTestBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('cfgWaMetaTestBtn');
    const statusEl = document.getElementById('cfgWaMetaStatus');
    if (btn) btn.textContent = 'Testando...';
    try {
      const res = await testWhatsAppMetaConnection(companyId);
      if (statusEl) {
        statusEl.classList.remove('hidden', 'notice-error');
        statusEl.textContent = res?.success
          ? `Conexão testada com sucesso${res.phone ? ` — ${_esc(res.phone)}` : ''}!`
          : 'Não foi possível concluir o teste. Verifique os dados informados.';
        if (!res?.success) statusEl.classList.add('notice-error');
      }
    } catch {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('notice-error');
        statusEl.textContent = 'Não foi possível concluir o teste. Tente novamente em alguns instantes.';
      }
    }
    if (btn) btn.textContent = 'Testar conexão';
  });

  /* Save Meta config */
  document.getElementById('cfgWaMetaSaveBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('cfgWaMetaSaveBtn');
    const statusEl = document.getElementById('cfgWaMetaStatus');
    if (btn) btn.textContent = 'Salvando...';

    const config = {
      businessAccountId: document.getElementById('cfgWaBusinessAccountId')?.value.trim() || '',
      phoneNumberId:     document.getElementById('cfgWaPhoneNumberId')?.value.trim() || '',
      appId:             document.getElementById('cfgWaAppId')?.value.trim() || '',
      wabaId:            document.getElementById('cfgWaWabaId')?.value.trim() || '',
      accessToken:       document.getElementById('cfgWaAccessToken')?.value.trim() || '',
      appSecret:         document.getElementById('cfgWaAppSecret')?.value.trim() || '',
    };

    if (!config.businessAccountId || !config.phoneNumberId || !config.accessToken) {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('notice-error');
        statusEl.textContent = 'Preencha os campos obrigatórios: Business Account ID, Phone Number ID e Access Token.';
      }
      if (btn) btn.textContent = 'Salvar configuração';
      return;
    }

    try {
      const res = await saveWhatsAppMetaConfig(companyId, config);
      if (statusEl) {
        statusEl.classList.remove('hidden', 'notice-error');
        statusEl.textContent = res?.saved
          ? 'Configuração salva com sucesso!'
          : 'Configuração salva.';
      }
      const el = document.getElementById('cfgCanaisContent');
      if (el) setTimeout(() => _renderWaContent(el), 700);
    } catch {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('notice-error');
        statusEl.textContent = 'Não foi possível salvar a configuração. Verifique os dados e tente novamente.';
      }
    }
    if (btn) btn.textContent = 'Salvar configuração';
  });
}

/* ─── E-mail ───────────────────────────────────────────────────────────────── */

async function _renderEmailContent(el) {
  const companyId = state?.currentUser?.companyId || state?.session?.companyId || 'default';
  el.innerHTML = '<div class="cfg-wa-loading">Carregando configuração de e-mail...</div>';

  let saved = null;
  try { saved = await getEmailConfig(companyId); } catch { saved = null; }

  const isActive     = saved?.status === 'active';
  const isConfigured = isActive || saved?.status === 'configured';
  const provider     = saved?.provider || '';
  const isSmtp       = provider === 'smtp' || provider === 'outro' || (!provider && !!saved?.smtpHost);
  const isApiProv    = !isSmtp && !!provider;

  const statusBadge = isActive
    ? '<span class="cfg-wa-badge cfg-wa-badge--green">Ativo</span>'
    : isConfigured
      ? '<span class="cfg-wa-badge cfg-wa-badge--yellow">Configurado</span>'
      : '<span class="cfg-wa-badge cfg-wa-badge--gray">Não configurado</span>';

  el.innerHTML = `
    <div class="cfg-wa-wrap">

      <!-- Status bar -->
      <div class="cfg-wa-status-bar">
        <div class="cfg-wa-status-left">
          <span class="cfg-wa-status-label">Status atual:</span>
          ${statusBadge}
          ${isConfigured && (saved?.email || saved?.senderEmail) ? `<span class="cfg-wa-phone">${_esc(saved.email || saved.senderEmail)}</span>` : ''}
          ${isConfigured && saved?.senderName ? `<span class="cfg-wa-lastsync">De: ${_esc(saved.senderName)}</span>` : ''}
        </div>
        ${isConfigured ? `
        <div class="cfg-wa-status-right">
          <button class="btn btn-ghost btn-sm" id="cfgEmailDisconnectBtn" type="button">Desconectar</button>
        </div>` : ''}
      </div>

      <!-- Form -->
      <div class="cfg-email-form">
        <div class="settings-duo-grid">
          <div class="field-group">
            <label>Nome do remetente <span class="req">*</span></label>
            <input id="cfgEmailFromName" class="field" placeholder="Ex.: Loja GAMBY" value="${_esc(saved?.senderName || '')}" />
          </div>
          <div class="field-group">
            <label>E-mail do remetente <span class="req">*</span></label>
            <input id="cfgEmailFromEmail" class="field" type="email" placeholder="contato@suaempresa.com" value="${_esc(saved?.email || saved?.senderEmail || '')}" />
          </div>
          <div class="field-group cfg-email-col-full">
            <label>Provedor de envio <span class="req">*</span></label>
            <select id="cfgEmailProvider" class="field">
              <option value="">Selecione o provedor...</option>
              <option value="smtp"     ${provider === 'smtp'     ? 'selected' : ''}>SMTP (Gmail, Outlook, servidor próprio…)</option>
              <option value="sendgrid" ${provider === 'sendgrid' ? 'selected' : ''}>SendGrid</option>
              <option value="mailgun"  ${provider === 'mailgun'  ? 'selected' : ''}>Mailgun</option>
              <option value="ses"      ${provider === 'ses'      ? 'selected' : ''}>Amazon SES</option>
              <option value="brevo"    ${provider === 'brevo'    ? 'selected' : ''}>Brevo (ex-Sendinblue)</option>
              <option value="outro"    ${provider === 'outro'    ? 'selected' : ''}>Outro provedor</option>
            </select>
          </div>
        </div>

        <!-- SMTP fields -->
        <div id="cfgEmailSmtpFields" class="${isSmtp ? '' : 'hidden'}">
          <div class="settings-duo-grid">
            <div class="field-group">
              <label>Servidor SMTP <span class="req">*</span></label>
              <input id="cfgEmailSmtpHost" class="field" placeholder="smtp.gmail.com" value="${_esc(saved?.smtpHost || '')}" />
            </div>
            <div class="field-group">
              <label>Porta</label>
              <input id="cfgEmailSmtpPort" class="field" type="number" placeholder="587" value="${saved?.smtpPort || 587}" />
            </div>
            <div class="field-group">
              <label>Usuário SMTP</label>
              <input id="cfgEmailSmtpUser" class="field" placeholder="usuario@email.com" value="${_esc(saved?.smtpUser || '')}" />
            </div>
            <div class="field-group">
              <label>Senha SMTP</label>
              <input id="cfgEmailSmtpPassword" class="field" type="password" placeholder="Senha do servidor SMTP" autocomplete="new-password" />
              <span class="cfg-wa-field-note">Nunca salva localmente — enviada ao backend quando disponível.</span>
            </div>
          </div>
        </div>

        <!-- API Key fields (SendGrid, Mailgun, SES, Brevo, Outro) -->
        <div id="cfgEmailApiFields" class="${isApiProv ? '' : 'hidden'}">
          <div class="settings-duo-grid">
            <div class="field-group cfg-email-col-full">
              <label>API Key <span class="req">*</span></label>
              <input id="cfgEmailApiKey" class="field" type="password" placeholder="Chave de API do provedor" autocomplete="new-password" />
              <span class="cfg-wa-field-note">Nunca salva localmente — enviada ao backend quando disponível.</span>
            </div>
          </div>
        </div>

        <!-- Security note -->
        <div class="cfg-email-security-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Senha e API Key nunca são salvas no navegador — enviadas ao backend de forma segura. Apenas dados públicos (nome, e-mail remetente, provedor) são armazenados localmente.
        </div>

        <div class="cfg-wa-meta-actions">
          ${isConfigured ? `<button class="btn btn-ghost" id="cfgEmailTestBtn" type="button">Testar conexão</button>` : ''}
          <button class="btn btn-primary" id="cfgEmailSaveBtn" type="button">Salvar configuração</button>
        </div>
        <div id="cfgEmailStatus" class="notice info hidden"></div>
      </div>

    </div>
  `;

  /* ── provider toggle ── */
  document.getElementById('cfgEmailProvider')?.addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('cfgEmailSmtpFields')?.classList.toggle('hidden', val !== 'smtp');
    document.getElementById('cfgEmailApiFields')?.classList.toggle('hidden', !val || val === 'smtp');
  });

  /* ── save ── */
  document.getElementById('cfgEmailSaveBtn')?.addEventListener('click', async () => {
    const btn      = document.getElementById('cfgEmailSaveBtn');
    const statusEl = document.getElementById('cfgEmailStatus');
    const senderEmail = document.getElementById('cfgEmailFromEmail')?.value.trim() || '';
    const prov        = document.getElementById('cfgEmailProvider')?.value || '';
    if (!senderEmail || !prov) {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('notice-error');
        statusEl.textContent = 'Preencha os campos obrigatórios: E-mail do remetente e Provedor.';
      }
      return;
    }
    if (btn) btn.textContent = 'Salvando...';
    const data = {
      senderName:  document.getElementById('cfgEmailFromName')?.value.trim() || '',
      senderEmail,
      provider:    prov,
      smtpHost:    document.getElementById('cfgEmailSmtpHost')?.value.trim() || '',
      smtpPort:    Number(document.getElementById('cfgEmailSmtpPort')?.value) || 587,
      smtpUser:    document.getElementById('cfgEmailSmtpUser')?.value.trim() || '',
      password:    document.getElementById('cfgEmailSmtpPassword')?.value    || '',
      apiKey:      document.getElementById('cfgEmailApiKey')?.value           || '',
    };
    try {
      const res = await saveEmailConfig(companyId, data);
      if (statusEl) {
        statusEl.classList.remove('hidden', 'notice-error');
        statusEl.textContent = res?.saved
          ? 'Configuração de e-mail salva com sucesso!'
          : 'Configuração salva.';
      }
      setTimeout(() => _renderEmailContent(el), 600);
    } catch {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('notice-error');
        statusEl.textContent = 'Não foi possível salvar a configuração. Verifique os dados informados.';
      }
    }
    if (btn) btn.textContent = 'Salvar configuração';
  });

  /* ── test ── */
  document.getElementById('cfgEmailTestBtn')?.addEventListener('click', async () => {
    const btn      = document.getElementById('cfgEmailTestBtn');
    const statusEl = document.getElementById('cfgEmailStatus');
    if (btn) btn.textContent = 'Testando...';
    try {
      const apiBase = String(
        (typeof window !== 'undefined' && window.GAMBY_CONFIG?.apiUrl) ||
        localStorage.getItem('gamby_backend_api_url') || ''
      ).replace(/\/+$/, '');
      const token = sessionStorage.getItem('gamby_access_token') || localStorage.getItem('gamby_access_token') || '';
      const r = await fetch(`${apiBase}/v1/integrations/email/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (statusEl) {
        statusEl.classList.remove('hidden', 'notice-error');
        if (r.ok) {
          statusEl.textContent = `Conexão testada com sucesso${data.email ? ` — ${_esc(data.email)}` : ''}!`;
        } else {
          statusEl.classList.add('notice-error');
          statusEl.textContent = 'Não foi possível concluir o teste. Verifique os dados informados.';
        }
      }
    } catch {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('notice-error');
        statusEl.textContent = 'Não foi possível concluir o teste. Tente novamente em alguns instantes.';
      }
    }
    if (btn) btn.textContent = 'Testar conexão';
  });

  /* ── disconnect ── */
  document.getElementById('cfgEmailDisconnectBtn')?.addEventListener('click', async () => {
    if (!window.confirm('Deseja desconectar o provedor de e-mail?')) return;
    try {
      const apiBase = String(
        (typeof window !== 'undefined' && window.GAMBY_CONFIG?.apiUrl) ||
        localStorage.getItem('gamby_backend_api_url') || ''
      ).replace(/\/+$/, '');
      const token = sessionStorage.getItem('gamby_access_token') || localStorage.getItem('gamby_access_token') || '';
      await fetch(`${apiBase}/v1/integrations/email/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
    } catch {}
    await _renderEmailContent(el);
  });
}

/* ─── SMS ──────────────────────────────────────────────────────────────────── */

function _renderSmsContent(el) {
  el.innerHTML = `
    <div class="cfg-wa-wrap">
      <div class="cfg-canais-coming-soon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <h4>Configuração de SMS</h4>
        <p>Integre um provedor de SMS para envio de alertas, confirmações e campanhas por mensagem de texto. Disponível na próxima versão.</p>
        <span class="cfg-canais-badge-soon">Em breve</span>
      </div>
    </div>
  `;
}

/* ================= BALANÇA ================= */

const _SERIAL_TYPES = new Set(['serial', 'usb_serial', 'tcp_ip']);

async function renderScaleSettings() {
  const statusEl = document.getElementById('scaleSettingsStatus');
  try {
    const cfg = await getScaleConfigService();
    _applyScaleForm(cfg);
  } catch (_err) {
    if (statusEl) { statusEl.textContent = 'Não foi possível carregar configurações da balança.'; statusEl.className = 'notice-error'; }
  }
}

function _applyScaleForm(cfg) {
  _setVal('scaleEnabled',               cfg.enabled              ?? false, 'checkbox');
  _setVal('scaleConnectionType',        cfg.connectionType       ?? 'barcode_label');
  _setVal('scalePort',                  cfg.port                 ?? '');
  _setVal('scaleBaudRate',              cfg.baudRate             ?? 9600);
  _setVal('scaleProtocol',              cfg.protocol             ?? 'generic');
  _setVal('scaleBarcodePrefix',         cfg.barcodePrefix        ?? '2');
  _setVal('scaleLabelType',             cfg.labelType            ?? 'weight');
  _setVal('scaleProductCodeStart',      cfg.productCodeStart     ?? 1);
  _setVal('scaleProductCodeLength',     cfg.productCodeLength    ?? 5);
  _setVal('scaleWeightStart',           cfg.weightStart          ?? 6);
  _setVal('scaleWeightLength',          cfg.weightLength         ?? 5);
  _setVal('scaleDecimalPlaces',         cfg.decimalPlaces        ?? 3);
  _setVal('scaleUnitType',              cfg.unitType             ?? 'kg');
  _setVal('scaleAllowManualWeight',     cfg.allowManualWeight    ?? true,  'checkbox');
  _setVal('scaleRequireManagerForManual', cfg.requireManagerForManual ?? false, 'checkbox');
  _updateScaleVisibility();
}

function _setVal(id, value, type) {
  const el = document.getElementById(id);
  if (!el) return;
  if (type === 'checkbox') el.checked = Boolean(value);
  else el.value = value ?? '';
}

function _updateScaleVisibility() {
  const connType = document.getElementById('scaleConnectionType')?.value ?? 'barcode_label';
  const isSerial = _SERIAL_TYPES.has(connType);
  const isBarcode = connType === 'barcode_label';

  const agentNotice  = document.getElementById('scaleAgentNotice');
  const portWrap     = document.getElementById('scalePortWrap');
  const protocolWrap = document.getElementById('scaleProtocolWrap');
  const baudWrap     = document.getElementById('scaleBaudWrap');
  const barcodeSection = document.getElementById('scaleBarcodeSection');

  if (agentNotice)    agentNotice.classList.toggle('hidden', !isSerial);
  if (portWrap)       portWrap.classList.toggle('hidden', !isSerial);
  if (protocolWrap)   protocolWrap.classList.toggle('hidden', !isSerial);
  if (baudWrap)       baudWrap.classList.toggle('hidden', !isSerial);
  if (barcodeSection) barcodeSection.classList.toggle('hidden', !isBarcode);
}

function bindScaleSettingsActions() {
  document.getElementById('scaleConnectionType')?.addEventListener('change', _updateScaleVisibility);

  document.getElementById('saveScaleSettingsBtn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('scaleSettingsStatus');
    if (statusEl) { statusEl.textContent = 'Salvando...'; statusEl.className = ''; }

    const data = {
      enabled:                _getBool('scaleEnabled'),
      connectionType:         _getStr('scaleConnectionType'),
      port:                   _getStr('scalePort') || null,
      baudRate:               _getInt('scaleBaudRate', 9600),
      protocol:               _getStr('scaleProtocol'),
      barcodePrefix:          _getStr('scaleBarcodePrefix'),
      labelType:              _getStr('scaleLabelType'),
      productCodeStart:       _getInt('scaleProductCodeStart', 1),
      productCodeLength:      _getInt('scaleProductCodeLength', 5),
      weightStart:            _getInt('scaleWeightStart', 6),
      weightLength:           _getInt('scaleWeightLength', 5),
      decimalPlaces:          _getInt('scaleDecimalPlaces', 3),
      unitType:               _getStr('scaleUnitType'),
      allowManualWeight:      _getBool('scaleAllowManualWeight'),
      requireManagerForManual: _getBool('scaleRequireManagerForManual'),
    };

    try {
      await saveScaleConfigService(data);
      if (statusEl) { statusEl.textContent = 'Configurações da balança salvas com sucesso.'; statusEl.className = 'notice-success'; }
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message; statusEl.className = 'notice-error'; }
    }
  });
}

function _getBool(id) { return document.getElementById(id)?.checked ?? false; }
function _getStr(id)  { return (document.getElementById(id)?.value ?? '').trim(); }
function _getInt(id, def = 0) { return parseInt(document.getElementById(id)?.value ?? '', 10) || def; }

/* ================= POLÍTICA COMERCIAL ================= */

async function renderCommercialPolicySettings() {
  if (!isBackendReady()) return;
  try {
    const policy = await getCommercialPolicyService();
    if (!policy || !policy.id) return;
    // Sincroniza com state global para uso no PDV
    state.commercialPolicy = policy;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    set('cpMaxDiscountPercent',  policy.maxDiscountPercent  ?? 20);
    set('cpMinMarginPercent',    policy.minMarginPercent    ?? 0);
    set('cpMaxDiscountOperador', policy.maxDiscountOperador ?? 10);
    set('cpMaxDiscountGerente',  policy.maxDiscountGerente  ?? 20);
    set('cpMaxDiscountAdmin',    policy.maxDiscountAdmin    ?? 50);
    chk('cpBlockBelowCost',         policy.blockBelowCost         ?? true);
    chk('cpRequireAuthForDiscount', policy.requireAuthForDiscount ?? false);
    chk('cpRequireJustification',   policy.requireJustification   ?? false);
  } catch (_err) { /* silêncio — dados ainda não configurados */ }
}

/* ================= MOVIMENTAÇÕES ADMINISTRATIVAS ================= */

async function renderAdminMovementUsers() {
  if (!isBackendReady()) return;
  const respSel = document.getElementById('amResponsibleId');
  const authSel = document.getElementById('amAuthorizedById');
  if (!respSel || !authSel) return;

  const users = Array.isArray(state.users) ? state.users : [];
  const managers = users.filter((u) => ['gerente', 'administrador', 'desenvolvedora'].includes(u.role));

  const allOpts = users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');
  const mgrOpts = managers.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('');

  respSel.innerHTML = `<option value="">— Selecione —</option>${allOpts}`;
  authSel.innerHTML = `<option value="">— Gerente/Admin —</option>${mgrOpts}`;
}

async function renderAdminMovementsList() {
  const listEl = document.getElementById('adminMovementsList');
  if (!listEl || !isBackendReady()) return;

  const LABELS = {
    despesa_emergencial:  'Despesa Emergencial',
    compra_emergencial:   'Compra Emergencial',
    manutencao:           'Manutenção',
    pagamento_operacional:'Pagamento Operacional',
    ajuste_administrativo:'Ajuste Administrativo',
    outros:               'Outros',
  };

  try {
    const { items } = await listAdminMovementsService({ limit: 20 });
    if (!items?.length) {
      listEl.innerHTML = '<p class="am-empty">Nenhuma movimentação registrada ainda.</p>';
      return;
    }
    listEl.innerHTML = items.map((m) => `
      <div class="am-item">
        <div class="am-item-head">
          <span class="am-item-type">${escapeHtml(LABELS[m.type] ?? m.type)}</span>
          <span class="am-item-amount">R$ ${Number(m.amount).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="am-item-reason">${escapeHtml(m.reason)}</div>
        <div class="am-item-meta">
          Responsável: ${escapeHtml(m.responsible?.name ?? '—')} &bull;
          Autorizado: ${escapeHtml(m.authorizedBy?.name ?? '—')} &bull;
          ${new Date(m.createdAt).toLocaleString('pt-BR')}
        </div>
      </div>
    `).join('');
  } catch (_err) {
    listEl.innerHTML = '<p class="am-empty">Não foi possível carregar o histórico.</p>';
  }
}

/* ================= PDV E CAIXA ================= */

async function renderPdvSettings() {
  if (!isBackendReady()) return;
  try {
    const cfg = await getPdvSettingsService();
    if (!cfg) return;

    // Guarda no state para que pdv.js possa consumir sem nova requisição
    if (typeof state !== 'undefined') state.pdvSettings = cfg;

    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    const num = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? 15; };

    // Modo de operação — restaura o card correto pelos IDs diretos
    selectPdvMode(cfg.pdvMode || 'simplified');

    // Checkboxes mapeados
    chk('pdvRequireAuthOpen',         cfg.requireAuthOpenCash);
    chk('pdvRequireAuthClose',        cfg.requireAuthCloseCash);
    chk('pdvRequireAuthCancelSale',   cfg.requireAuthCancelSale);
    chk('pdvRequireAuthSangria',      cfg.requireAuthSangria);
    chk('pdvRequireAuthSuprimento',   cfg.requireAuthSuprimento);
    chk('pdvAutoPrintReceipt',        cfg.autoPrintReceipt);
    chk('pdvInactivityLockEnabled',   cfg.inactivityLockEnabled);
    num('pdvSessionTimeout',          cfg.inactivityLockMinutes);
    // Modal de conclusão de venda
    chk('pdvSaleCompleteShowPrint',    cfg.saleCompleteShowPrint    ?? true);
    chk('pdvSaleCompleteShowWhatsApp', cfg.saleCompleteShowWhatsApp ?? false);
    chk('pdvSaleCompleteShowEmail',    cfg.saleCompleteShowEmail    ?? false);
  } catch (_err) { /* silêncio */ }
}

async function saveAdminPasswordAction() {
  const msgEl = document.getElementById('adminPasswordMsg');
  const setMsg = (text, ok) => {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = ok ? 'cfg-hint cfg-hint-ok' : 'cfg-hint cfg-hint-err';
  };

  const currentPassword = String(document.getElementById('adminCurrentPassword')?.value || '').trim() || null;
  const newPassword     = String(document.getElementById('adminNewPassword')?.value    || '').trim();
  const confirmPassword = String(document.getElementById('adminConfirmPassword')?.value || '').trim();

  if (!newPassword)                    { setMsg('Informe a nova senha.', false); return; }
  if (newPassword.length < 4)          { setMsg('A senha deve ter pelo menos 4 caracteres.', false); return; }
  if (newPassword !== confirmPassword) { setMsg('As senhas não conferem.', false); return; }

  try {
    await api.setAdminPassword(currentPassword, newPassword);
    setMsg('Senha salva com sucesso.', true);
    ['adminCurrentPassword', 'adminNewPassword', 'adminConfirmPassword'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    setTimeout(() => { if (msgEl) { msgEl.textContent = ''; msgEl.className = 'cfg-hint'; } }, 4000);
  } catch (err) {
    setMsg(err.message || 'Erro ao salvar senha.', false);
  }
}

async function savePdvSettingsAction() {
  const statusEl = document.getElementById('pdvSettingsStatus');
  if (statusEl) { statusEl.textContent = 'Salvando...'; statusEl.className = 'cfg-status-msg'; }

  const chkVal = (id, def) => {
    const el = document.getElementById(id);
    return el ? el.checked : def;
  };
  const numVal = (id, def) => {
    const el = document.getElementById(id);
    return el ? (Number(el.value) || def) : def;
  };

  // Lê o modo via IDs diretos — sem depender de container ou data-attributes
  const mode = getSelectedPdvMode();

  const payload = {
    pdvMode:               mode,
    requireAuthOpenCash:   chkVal('pdvRequireAuthOpen',       true),
    requireAuthCloseCash:  chkVal('pdvRequireAuthClose',      true),
    requireAuthCancelSale: chkVal('pdvRequireAuthCancelSale', false),
    requireAuthSangria:    chkVal('pdvRequireAuthSangria',    false),
    requireAuthSuprimento: chkVal('pdvRequireAuthSuprimento', false),
    autoPrintReceipt:         chkVal('pdvAutoPrintReceipt',         false),
    inactivityLockEnabled:    chkVal('pdvInactivityLockEnabled',    false),
    inactivityLockMinutes:    numVal('pdvSessionTimeout',           15),
    // Modal de conclusão de venda
    saleCompleteShowPrint:    chkVal('pdvSaleCompleteShowPrint',    true),
    saleCompleteShowWhatsApp: chkVal('pdvSaleCompleteShowWhatsApp', false),
    saleCompleteShowEmail:    chkVal('pdvSaleCompleteShowEmail',    false),
  };

  try {
    const saved = await savePdvSettingsService(payload);
    if (typeof state !== 'undefined' && saved) {
      state.pdvSettings = saved;
      state.pdvSettingsLoaded = true;
      localStorage.setItem('gamby_pdv_settings_cache', JSON.stringify(saved));
    }
    if (statusEl) { statusEl.textContent = 'Configurações do PDV salvas!'; statusEl.className = 'cfg-status-msg cfg-status-ok'; }
    setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cfg-status-msg'; } }, 3000);
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || 'Erro ao salvar.'; statusEl.className = 'cfg-status-msg cfg-status-error'; }
  }
}

/* ================= PERFIL DO NEGÓCIO ================= */

/* Presets de recursos por segmento.
   Aplicados SOMENTE quando o usuário clica em um card — nunca sobrescreve ao restaurar/reload. */
const BP_PRESETS = {
  papelaria:    { featStock: true,  featDelivery: false, featWeighing: false, featServices: false, featMarketplace: false, featProduction: false, featFiado: true,  featComandas: false },
  mercado:      { featStock: true,  featDelivery: false, featWeighing: true,  featServices: false, featMarketplace: false, featProduction: false, featFiado: true,  featComandas: false },
  acaiteria:    { featStock: true,  featDelivery: true,  featWeighing: false, featServices: false, featMarketplace: false, featProduction: true,  featFiado: false, featComandas: true  },
  restaurante:  { featStock: true,  featDelivery: true,  featWeighing: false, featServices: false, featMarketplace: false, featProduction: true,  featFiado: false, featComandas: true  },
  roupas:       { featStock: true,  featDelivery: false, featWeighing: false, featServices: false, featMarketplace: true,  featProduction: false, featFiado: false, featComandas: false },
  conveniencia: { featStock: true,  featDelivery: false, featWeighing: false, featServices: false, featMarketplace: false, featProduction: false, featFiado: true,  featComandas: false },
  servicos:     { featStock: false, featDelivery: false, featWeighing: false, featServices: true,  featMarketplace: false, featProduction: false, featFiado: true,  featComandas: false },
  outro:        { featStock: true,  featDelivery: false, featWeighing: false, featServices: false, featMarketplace: false, featProduction: false, featFiado: false, featComandas: false },
};

/* Sincroniza a seleção visual dos cards com um valor de businessType. */
function _syncBizCards(value) {
  const sel = document.getElementById('bpBusinessType');
  if (sel) sel.value = value ?? '';
  document.querySelectorAll('.bp-biz-card').forEach(c => {
    c.classList.toggle('is-active', c.dataset.bizValue === value);
  });
}

/* Aplica o preset de recursos para o segmento selecionado.
   Chamado APENAS no clique do card — não no reload, para respeitar ajustes manuais. */
function applyBusinessProfilePreset(segment) {
  const preset = BP_PRESETS[segment];
  if (!preset) return;
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
  chk('bpFeatStock',       preset.featStock);
  chk('bpFeatDelivery',    preset.featDelivery);
  chk('bpFeatWeighing',    preset.featWeighing);
  chk('bpFeatServices',    preset.featServices);
  chk('bpFeatMarketplace', preset.featMarketplace);
  chk('bpFeatProduction',  preset.featProduction);
  chk('bpFeatFiado',       preset.featFiado);
  chk('bpFeatComandas',    preset.featComandas);
}

async function renderBusinessProfile() {
  if (!isBackendReady()) return;
  try {
    const profile = await getBusinessProfileService();
    if (!profile) return;
    const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    /* Sincroniza o select oculto E o estado visual dos cards */
    _syncBizCards(profile.businessType);
    chk('bpFeatStock',       profile.featStock       ?? true);
    chk('bpFeatDelivery',    profile.featDelivery    ?? false);
    chk('bpFeatWeighing',    profile.featWeighing    ?? false);
    chk('bpFeatServices',    profile.featServices    ?? false);
    chk('bpFeatMarketplace', profile.featMarketplace ?? false);
    chk('bpFeatProduction',  profile.featProduction  ?? false);
    chk('bpFeatFiado',       profile.featFiado       ?? false);
    chk('bpFeatComandas',    profile.featComandas    ?? false);
  } catch (_err) { /* silêncio */ }
}

/* ================= TERMINAIS AVANÇADOS ================= */

async function renderAdvancedTerminals() {
  const listEl   = document.getElementById('advTerminalList');
  const statusEl = document.getElementById('terminalMgmtStatus');
  if (!listEl || !isBackendReady()) return;

  listEl.innerHTML = '<p class="cfg-empty-hint">Carregando...</p>';
  try {
    const terminals = await listTerminalsService();
    if (!Array.isArray(terminals) || !terminals.length) {
      listEl.innerHTML = '<p class="cfg-empty-hint">Nenhum terminal cadastrado via API. Terminais registrados via PDV aparecerão aqui após o primeiro uso.</p>';
      return;
    }
    listEl.innerHTML = terminals.map((t) => `
      <div class="at-item${t.isActive ? '' : ' at-item--inactive'}">
        <div class="at-item-head">
          <div class="at-item-info">
            <span class="at-item-name">${escapeHtml(t.name)}</span>
            <span class="at-item-code">#${escapeHtml(t.code)}</span>
          </div>
          <span class="at-item-status${t.isOnline ? ' at-status-online' : ' at-status-offline'}">${t.isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div class="at-item-meta">
          ${t.lastOperatorName ? `Último operador: <strong>${escapeHtml(t.lastOperatorName)}</strong> &bull; ` : ''}
          ${t.lastAccessAt ? `Último acesso: ${new Date(t.lastAccessAt).toLocaleString('pt-BR')}` : 'Sem acesso registrado'}
          ${!t.isActive ? ' &bull; <span class="at-reset-label">Resetado</span>' : ''}
        </div>
        <div class="at-item-actions">
          <button class="btn btn-ghost btn-xs" type="button"
            data-reset-terminal-id="${t.id}"
            data-reset-terminal-name="${escapeHtml(t.name)}"
            ${!t.isActive ? 'disabled title="Terminal já resetado"' : ''}>
            Resetar terminal
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<p class="cfg-empty-hint">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
  }
}

/* ================= AUDITORIA ================= */

let _auditPage = 1;

async function renderAuditLogs() {
  const listEl = document.getElementById('auditLogsList');
  if (!listEl || !isBackendReady()) return;

  const action     = document.getElementById('auditFilterAction')?.value?.trim() || '';
  const entityType = document.getElementById('auditFilterEntity')?.value || '';

  listEl.innerHTML = '<p class="cfg-empty-hint">Carregando registros...</p>';

  try {
    const { items, total } = await listAuditLogsService({
      action:     action || undefined,
      entityType: entityType || undefined,
      page:       _auditPage,
      limit:      50,
    });

    if (!items?.length) {
      listEl.innerHTML = '<p class="cfg-empty-hint">Nenhum registro encontrado para os filtros aplicados.</p>';
      return;
    }

    listEl.innerHTML = items.map((log) => `
      <div class="audit-item">
        <div class="audit-item-head">
          <span class="audit-action">${escapeHtml(log.action)}</span>
          <span class="audit-time">${new Date(log.createdAt).toLocaleString('pt-BR')}</span>
        </div>
        ${log.description ? `<div class="audit-desc">${escapeHtml(log.description)}</div>` : ''}
        <div class="audit-meta">
          ${log.user ? `Usuário: <strong>${escapeHtml(log.user.name)}</strong> (${log.user.role}) &bull; ` : ''}
          ${log.entityType ? `Módulo: ${escapeHtml(log.entityType)} &bull; ` : ''}
          ${log.entityId   ? `ID: ${escapeHtml(log.entityId)}` : ''}
        </div>
      </div>
    `).join('');

    const pageEl = document.getElementById('auditLogsPagination');
    if (pageEl) {
      pageEl.textContent = `Total: ${total} registros — Página ${_auditPage}`;
    }
  } catch (err) {
    listEl.innerHTML = `<p class="cfg-empty-hint">Erro: ${escapeHtml(err.message)}</p>`;
  }
}

/* ================= PERSONALIZAÇÃO REAL ================= */

let _pendingPersonalization = {};

export async function applyPersonalizationOnBoot() {
  if (!isBackendReady()) return;
  try {
    const p = await getPersonalizationService();
    if (p && p.id) _applyPersonalizationLocally(p);
  } catch (_err) { /* silêncio — aplicar defaults */ }
}

function _applyPersonalizationLocally(p) {
  if (p.themeMode) _applyThemeMode(p.themeMode);
  if (p.primaryColor) _applyThemeColor(p.primaryColor);
}

function _applyThemeMode(mode) {
  const isLight = mode === 'light';
  const root = document.documentElement;

  // 1. Aplica/remove classe no <html> — única fonte de verdade
  root.classList.toggle('theme-light', isLight);
  root.classList.toggle('theme-dark',  !isLight);

  // 2. Persiste no localStorage para restaurar no próximo carregamento
  localStorage.setItem('gamby_theme_mode', isLight ? 'light' : 'dark');

  // 3. Sincroniza os cards visuais visíveis ao usuário
  document.getElementById('darkThemeCard')?.classList.toggle('is-active', !isLight);
  document.getElementById('lightThemeCard')?.classList.toggle('is-active',  isLight);

  // 4. Atualiza botões legados ocultos (compatibilidade com código existente)
  const darkBtn  = document.getElementById('darkModeBtn');
  const lightBtn = document.getElementById('lightModeBtn');
  if (darkBtn && lightBtn) {
    darkBtn.className  = !isLight ? 'btn btn-primary cfg-mode-btn' : 'btn btn-ghost cfg-mode-btn';
    lightBtn.className =  isLight ? 'btn btn-primary cfg-mode-btn' : 'btn btn-ghost cfg-mode-btn';
  }
}

async function renderPersonalizationPanel() {
  if (!isBackendReady()) return;
  try {
    const p = await getPersonalizationService();
    if (!p || !p.id) return;
    _applyPersonalizationLocally(p);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('pzLoginMessage',         p.loginMessage);
    set('pzReceiptMessage',       p.receiptMessage);
    set('pzClosedCashierMessage', p.closedCashierMessage);
    set('pzReportHeaderText',     p.reportHeaderText);
    set('pzReportFooterText',     p.reportFooterText);
    const colorInput  = document.getElementById('customThemeColor');
    const colorHexEl  = document.getElementById('customColorHex');
    if (p.primaryColor && colorInput) { colorInput.value = p.primaryColor; }
    if (p.primaryColor && colorHexEl) { colorHexEl.textContent = p.primaryColor; }
    if (p.primaryColor) {
      document.querySelectorAll('[data-theme-color]').forEach((s) => {
        s.classList.toggle('is-active', s.dataset.themeColor === p.primaryColor);
        s.innerHTML = s.dataset.themeColor === p.primaryColor
          ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
          : '';
      });
    }
  } catch (_err) { /* silêncio */ }
}

/* ================= NOTIFICAÇÕES NAS CONFIGURAÇÕES ================= */

async function renderSettingsNotifications() {
  const listEl = document.getElementById('settingsNotifList');
  if (!listEl || !isBackendReady()) return;
  try {
    const { items } = await (await import('./services/notifications-service.js')).listNotificationsService({ limit: 20 });
    if (!items?.length) {
      listEl.innerHTML = '<p class="am-empty">Nenhuma notificação recente.</p>';
      return;
    }
    listEl.innerHTML = items.map((n) => `
      <div class="am-item${n.isRead ? '' : ' am-item--unread'}">
        <div class="am-item-head">
          <span class="am-item-type">${escapeHtml(n.title)}</span>
          <span class="audit-time">${new Date(n.createdAt).toLocaleString('pt-BR')}</span>
        </div>
        <div class="am-item-reason">${escapeHtml(n.body)}</div>
      </div>
    `).join('');
  } catch (_err) {
    listEl.innerHTML = '<p class="am-empty">Erro ao carregar.</p>';
  }
}

export { renderScaleSettings };