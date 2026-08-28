import { state } from './state.js';
import { KEYS } from './storage.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _safeImageUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  try {
    const p = new URL(v, window.location.origin);
    if (['http:', 'https:', 'blob:', 'data:'].includes(p.protocol)) return v;
    return '';
  } catch { return ''; }
}
import { initDevToolsDetector }  from './devtools-detector.js';
import { initRuntimeGuard }     from './runtime-guard.js';
import { initAntiAutomation }   from './anti-automation.js';
import { initDomGuard }         from './dom-guard.js';
import './trusted-types-policy.js'; // initializes window.trustedTypes policy at module load time

import {
  login,
  logout,
  openRegisterModal,
  goToEmailVerification,
  resendVerificationCode,
  confirmEmailVerification,
  selectPlan,
  finishRegistration,
  tryRestoreSession,
  forgotPassword,
  validateCashClosurePassword,
  bindBlockedActions,
  isDeveloperUser,
  getPendingRegistrationStep,
  startGoogleOAuth,
  startMicrosoftOAuth,
  openSupportModal,
  closeSupportModal,
  bindLoginFieldValidation,
  bindRegisterFieldValidation
} from './auth.js';

import {
  setupNavigation,
  setNavCallback,
  toggleRegister,
  applyAuthenticatedLayout,
  applyLoggedOutLayout,
  ensureVisibleActivePage,
  setActivePage,
  setStage,
  showRegistrationActivationCard,
  hideRegistrationActivationCard,
  setMessage
} from './ui.js';

import { applyPlanPermissions } from './plan-permissions.js';
import { applyRolePermissions } from './role-permissions.js';

import {
  initProducts,
  bindProductActions,
  applyProductPermissions,
  renderProducts,
  renderLowStock,
  loadInventoryAlerts,
  bindInventoryAlertActions,
  loadExpiryReport,
  bindExpiryReportActions,
} from './products.js';

import { bindBackupActions } from './backup.js';
import { initSales, bindPDVActions, applyPdvSettings } from './pdv.js';

import {
  initCashSession,
  bindCashSessionActions,
  renderCashSession,
  closeCashSession,
  startPDVOpenCashFlow,
  hideClosedCashScreen,
  showClosedCashScreen,
} from './cash-session.js';

import { renderFinance, bindFinanceFilters } from './finance.js';
import { renderReports, bindReportActions } from './reports.js';

import {
  bindPaymentActions,
  loadPaymentSettings,
  applyPaymentPermissions,
  initPlansFromAPI
} from './payments.js';

import { initHistory, renderHistory, loadHistoryPage } from './history.js';
import { initAnalytics, renderAnalytics, bindAnalyticsActions } from './analytics.js';
import { initBusinessIntelligence, onBusinessIntelligenceOpen } from './business-intelligence.js';
import { initPDVAnalytics, renderPDVAnalytics } from './pdv-analytics.js';
import { initControlCenter } from './control-center.js';
import { initCustomerSuccess } from './customer-success.js';
import { initExecutive }       from './executive.js';
import { initBoard }           from './board.js';
import { initCeoAi }           from './ceo-ai.js';
import { initGambyIa, destroyGambyIa } from './gamby-ia.js';
import { initAiWidget, destroyAiWidget } from './ai-widget.js';
import {
  isPDVActive,
  enforcePDVKioskMode,
  releasePDVKioskMode,
  requirePDVAdminAuthorization,
} from './pdv-kiosk.js';
import { getPdvSettingsService } from './services/pdv-settings-service.js';
import { getDashboardAnalyticsService } from './services/analytics-service.js';
import { initOfflineSync, loadCatalogIntoState } from './offline-sync.js';
import { startNotificationPolling, stopNotificationPolling, bindNotificationBell } from './notifications.js';
import { migrateStaleApiUrlConfig, isBackendReady } from './backend-config.js';

import {
  initInternalUsers,
  bindUserManagementActions,
  renderInternalUsers,
  renderUsersOverview
} from './user-management.js';

import {
  initMarketplace,
  bindMarketplaceActions,
  renderMarketplace
} from './marketplace.js';

import {
  initOrders,
  bindOrdersActions,
  renderOrders
} from './orders.js';

import {
  initSettings,
  bindSettingsActions,
  renderSettings,
  renderSelfTests,
  applyPersonalizationOnBoot
} from './settings.js';

import {
  initBackendStatus,
  bindBackendStatusActions,
  renderBackendStatus
} from './backend-status.js';

import { loadCompanySubscriptionService } from './services/company-service.js';
import { loadSales } from './services/sales-service.js';
import { loadOperatorSessions, requireOperatorSession, requirePDVOperatorSession, clearOperatorSession } from './operator-session.js';
import { renderSubscriptionInfo, bindSubscriptionActions } from './subscription.js';
import { renderSuporte }   from './suporte.js';
import { renderMarketing } from './marketing.js';

// ── Novas páginas SaaS ──────────────────────────────────────────────────────
import { renderPlansPage }            from './plans.js';
import { renderMySubscriptionPage }   from './my-subscription.js';
import { initLearningPage }           from './learning.js';
import { showUpgradeModal, interceptPlanErrors } from './upgrade-modal.js';

import {
  canAccessPage,
  applyMenuSecurity,
  getDefaultPageForCurrentUser,
  shouldForcePDVMode,
  shouldForceControlCenterMode,
  isPlatformRole,
  isPlatformAdmin,
  isDeveloperMaster,
  auditLog,
  shouldRequireSecurityChallenge,
  requireSecurityAnswer,
  requireManagerOrAdminPassword
} from './security-policy.js';

import { navigate as _govNavigate, repair as _govRepair, onLogout as _govOnLogout } from './gov-nav.js';
import { resetSession as _govAuditResetSession } from './gov-audit.js';
import { sync as _govSessionSync } from './gov-session.js';
import { initGovCompat } from './gov-compat.js';

import {
  restoreActiveProfileFromSession,
  hasActiveProfile,
  clearActiveProfile,
  showProfileSelector,
  applyProfileRestrictions,
  applyProfileMenuVisibility,
  bindProfileSelectorActions,
} from './profile-selector.js';

let authActionsBound = false;
let overlayBound = false;
let billingToggleBound = false;
let dashboardClockStarted = false;
let salesUpdateBound = false;
let appInitialized = false;
let pendingCashCloseAction = null;
let pendingActionType = 'pdv_action'; // usado por validateCashClosurePassword para auditoria
let _secureModalKeydownGuard = null; // listener de captura — ver openSecureCashCloseModal()
let _dashFinancePeriod = 'today';
let _dashPeakPeriod = 'today';
let _financeChartAnimId = null;
let _peakChartAnimId = null;
let _weeklyChartInst    = null;
let _monthlyChartInst   = null;
let _paymentChartInst   = null;
let _abcChartInst       = null;
let _operatorsChartInst = null;

// gov-nav.js needs access to openPageDirect and isAuthenticated before they are defined.
// We expose them as late-bound window references resolved at call time.
window.isAuthenticated = () => isAuthenticated();
// window.openPageDirect is set below alongside openSecureCashCloseModal (already done)

// Engine única de navegação: todos os cliques em nav-btn passam pela Governance Layer.
// _govNavigate() → gov-nav.js handles kiosk guard, security challenge, audit, and finally
// calls openPageDirect() as the sole DOM primitive.
// PDV entry still goes through requestProtectedPageNavigation → showPDVOpenCashChoice
// because it requires operator PIN + cash open sequence (not pure navigation).
setNavCallback((page) => {
  const p = String(page || '').trim().toLowerCase();
  if (p === 'pdv') {
    requestProtectedPageNavigation(p);
    return;
  }
  _govNavigate(p, { source: 'user-click' });
});

/* ================= SEGURANÇA / AUTORIZAÇÃO ================= */

function isFirstAccessWithoutSecuritySetup() {
  const possibleUserKeys = [
    'internalUsers',
    'gamby_internal_users_modular',
    'gamby_auth_users_modular'
  ];

  let hasUsers = false;

  possibleUserKeys.forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];

      if (Array.isArray(parsed) && parsed.length > 0) {
        hasUsers = true;
      }
    } catch {}
  });

  const hasSecurityAnswer = Boolean(localStorage.getItem('gamby_security_answer'));

  return !hasUsers && !hasSecurityAnswer;
}

function _isSecurityPasswordRequired() {
  return localStorage.getItem('gamby_security_required') !== 'false';
}

// opts.forceAuth = true: nunca bypassa mesmo se pdvSettings não estiver carregado
// opts.forceAuth = true também bloqueia bypass de isDeveloperUser — operações de caixa exigem senha real
function openSecureCashCloseModal(onSuccess, opts = {}) {
  // forceAuth: operações críticas de caixa sempre exigem senha, mesmo para developer/admin_master
  const _forceAuth = Boolean(opts?.forceAuth);
  if (!_forceAuth && isDeveloperUser(state.currentUser)) {
    if (typeof onSuccess === 'function') onSuccess();
    return;
  }

  const _isControlled = _forceAuth || (state?.pdvSettings?.pdvMode) === 'controlled';

  if (!_isControlled && !_isSecurityPasswordRequired()) {
    if (typeof onSuccess === 'function') onSuccess();
    return;
  }

  pendingCashCloseAction           = onSuccess;
  pendingCashCloseAction._onCancel = opts.onCancel ?? null;
  // Armazenar actionType para auditoria correta: PDV usa 'pdv_action'; abas sensíveis
  // nunca chegam aqui (canNavigate() bloqueia gerente antes do challenge disparar).
  pendingActionType = String(opts.actionType || 'pdv_action');

  document.getElementById('secureCashActionOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'secureCashActionOverlay';
  overlay.className = 'overlay sc-overlay-fixed';

  overlay.innerHTML = `
    <div id="secureCashModalBox">
      <div class="sc-modal-head">
        <div>
          <span class="sc-modal-badge">Ação protegida</span>
          <h3 class="sc-modal-title">Autorização necessária</h3>
          <p class="sc-modal-sub">
            Digite a senha do gerente (4 últimos dígitos do CPF) ou do administrador.
          </p>
        </div>
        <button id="closeSecureCashActionBtn" type="button" class="sc-close-btn">×</button>
      </div>
      <div class="sc-modal-body">
        <label for="secureCashPassword" class="sc-modal-label">Senha</label>
        <input id="secureCashPassword" type="password" placeholder="Digite a senha autorizada" class="sc-modal-input" />
      </div>
      <div id="secureCashActionMessage" class="sc-modal-msg">Gerente: últimos 4 dígitos do CPF. Administrador: senha livre configurada nas configurações do PDV.</div>
      <div class="sc-modal-actions">
        <button id="confirmSecureCashActionBtn" type="button" class="sc-btn-confirm">Confirmar</button>
        <button id="cancelSecureCashActionBtn" type="button" class="sc-btn-cancel">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Captura (useCapture:true) ANTES de bindPDVKeyboardShortcuts() (pdv.js),
  // que registra seu próprio listener de document em fase de captura — sem
  // isso, teclas digitadas aqui poderiam ser interpretadas como atalhos do
  // PDV (F2-F10, Alt+combos) enquanto este modal estiver por cima dele.
  // Removido em closeSecureCashCloseModal() e no sucesso de
  // confirmSecureCashCloseModal() (os dois caminhos de saída do modal).
  _secureModalKeydownGuard = (event) => { event.stopPropagation(); };
  document.addEventListener('keydown', _secureModalKeydownGuard, true);

  const passwordInput = document.getElementById('secureCashPassword');
  const closeBtn = document.getElementById('closeSecureCashActionBtn');
  const cancelBtn = document.getElementById('cancelSecureCashActionBtn');
  const confirmBtn = document.getElementById('confirmSecureCashActionBtn');

  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      stop(event);
      closeSecureCashCloseModal();
    }
  });

  document.getElementById('secureCashModalBox')?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  closeBtn?.addEventListener('click', (event) => {
    stop(event);
    closeSecureCashCloseModal();
  });

  cancelBtn?.addEventListener('click', (event) => {
    stop(event);
    closeSecureCashCloseModal();
  });

  confirmBtn?.addEventListener('click', async (event) => {
    stop(event);
    await confirmSecureCashCloseModal();
  });

  passwordInput?.addEventListener('keydown', async (event) => {
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      await confirmSecureCashCloseModal();
    }
  });

  requestAnimationFrame(() => {
    passwordInput?.focus();
    passwordInput?.select?.();
  });
}

function closeSecureCashCloseModal() {
  const onCancel = pendingCashCloseAction?._onCancel ?? null;
  pendingCashCloseAction = null;
  document.getElementById('secureCashActionOverlay')?.remove();
  if (_secureModalKeydownGuard) {
    document.removeEventListener('keydown', _secureModalKeydownGuard, true);
    _secureModalKeydownGuard = null;
  }
  // Notify gov-auth.js (and any other caller) that the modal was cancelled
  if (typeof onCancel === 'function') onCancel();
}

async function confirmSecureCashCloseModal() {
  const password = String(document.getElementById('secureCashPassword')?.value || '').trim();
  const message = document.getElementById('secureCashActionMessage');

  try {
    const result = await validateCashClosurePassword(password, pendingActionType);

    // CRÍTICO: NÃO usar closeSecureCashCloseModal() aqui.
    // closeSecureCashCloseModal() chama _onCancel, que resolve a Promise com success:false,
    // fazendo a .then() do govCompat chamar onCancel em vez de onSuccess.
    // O fluxo correto é: salvar action → limpar estado manualmente → chamar action (_onSuccess).
    const action = pendingCashCloseAction;
    pendingCashCloseAction = null;                              // limpa sem acionar _onCancel
    document.getElementById('secureCashActionOverlay')?.remove(); // remove overlay diretamente
    if (_secureModalKeydownGuard) {
      document.removeEventListener('keydown', _secureModalKeydownGuard, true);
      _secureModalKeydownGuard = null;
    }

    // Conceder token de fechamento de caixa para o guard defensivo em closeCashSession().
    window.__pdvCashCloseAuthorized = true;

    // A senha digitada aqui já foi verificada (validateCashClosurePassword acima),
    // mas openCashController/closeCashController no backend exigem o MESMO campo
    // 'password' de novo, de forma independente (findAuthorizedUserByPassword),
    // sempre que pdvSettings.requireAuthOpenCash estiver ligado. openCashSession()
    // nunca reenviava essa senha — a abertura de caixa falhava com 403 no backend
    // (silenciosamente engolido pelo catch de lá), mesmo com o toast de sucesso
    // aparecendo. Consumo único: openCashSession() limpa isso após ler.
    state._pendingCashAuthPassword = password;

    // result.approvedBy = { id, name, role } — identifica QUEM realmente digitou
    // a senha (backend, ver authorizeAction() em authorization-service.js), não
    // o papel do JWT logado no dispositivo. Usado por handleClosedCashAuthorizedAccess()
    // para aplicar o layout correto (admin/gerente) em vez de misturar com o
    // perfil simulado que possa estar ativo. Ausente no caso "provisório" (senha
    // 000000 de primeiro acesso, sem ninguém cadastrado ainda).
    state._pendingCashApprovedBy = result?.approvedBy || null;

    // BUG CONFIRMADO: o caso provisório (000000, primeiro acesso sem nenhuma
    // senha administrativa configurada na empresa) nunca tinha essa flag
    // acessível ao callback — só approvedBy, que vem ausente exatamente
    // nesse caso. Consumidores que checam "approvedBy.role === administrador"
    // (handleClosedCashAuthorizedAccess, _confirmAdminAccessPassword) rejeitavam
    // uma senha 000000 correta como se fosse credencial sem permissão, porque
    // role virava string vazia. Exposto aqui para esses dois lugares tratarem
    // o provisório como Administrador válido (o próprio backend só chega
    // nesse retorno quando não há gerente nem admin com senha configurada —
    // não é uma brecha nova, é o mesmo bootstrap já usado no resto do PDV).
    state._pendingCashProvisional = Boolean(result?.provisional);

    if (typeof action === 'function') {
      try {
        await action();
      } catch (actionErr) {
        // overlay já foi removido; criar toast diretamente para não sumir o erro
        let _tc = document.getElementById('toastContainer');
        if (!_tc) { _tc = document.createElement('div'); _tc.id = 'toastContainer'; document.body.appendChild(_tc); }
        const _t = document.createElement('div');
        _t.className = 'toast toast-error';
        _t.textContent = actionErr?.message || 'Erro ao executar ação.';
        _tc.appendChild(_t);
        requestAnimationFrame(() => _t.classList.add('is-visible'));
        setTimeout(() => { _t.classList.remove('is-visible'); setTimeout(() => _t.remove(), 300); }, 2500);
      }
    }

    if (result?.provisional) {
      setTimeout(() => {
        alert('Senha provisória utilizada.\nAtualize seu cadastro para definir sua senha administrativa.');
      }, 300);
    }
  } catch (error) {
    const passwordInput = document.getElementById('secureCashPassword');

    // Exibir mensagem de erro com estilo vermelho
    if (message) {
      message.textContent = error?.message || 'Senha inválida.';
      message.classList.add('sc-msg-error');
    }

    // Animação shake no campo de senha (estilo bancário)
    if (passwordInput) {
      passwordInput.classList.add('sc-input-error');
      setTimeout(() => {
        passwordInput.classList.remove('sc-input-error');
        message?.classList.remove('sc-msg-error');
        passwordInput.value = '';           // limpa apenas o campo de senha
        requestAnimationFrame(() => passwordInput.focus()); // refoco imediato
      }, 600);
    }
    // Modal permanece aberto — usuário tenta novamente
  }
}

function bindSecureCashActionModal() {
  // O modal é recriado dinamicamente por openSecureCashCloseModal.
}

window.openSecureCashCloseModal = openSecureCashCloseModal;
window.closeSecureCashCloseModal = closeSecureCashCloseModal;

/* ═══════════════════ SECURITY RUNTIME ═══════════════════
   Order matters:
   1. window.openSecureCashCloseModal is set just above
   2. initGovCompat() patches openSecureCashCloseModal → gov-auth.challenge()
      and saves the original to window.__gov.openSecureCashCloseModal
   3. initRuntimeGuard snapshots + locks the COMPAT WRAPPER (not the original)
      → console can no longer replace openSecureCashCloseModal
   4. initDevToolsDetector polls for open DevTools
   5. initAntiAutomation runs bot-detection checks
   ═══════════════════════════════════════════════════════ */

// First pass: patches openSecureCashCloseModal (openPageDirect not set yet, skipped)
initGovCompat();
initRuntimeGuard();
initDevToolsDetector();
initAntiAutomation();
initDomGuard();

// When DevTools is detected on a sensitive page, the detector dispatches
// 'gamby:devtools:sensitive'. We respond with a security re-auth challenge.
// If the user fails (or dismisses), navigate them to a safe page.
document.addEventListener('gamby:devtools:sensitive', () => {
  if (!state.currentUser) return;
  const ok = requireSecurityAnswer();
  if (!ok) openPageDirect(getDefaultPageForCurrentUser());
});

/* ================= HELPERS ================= */

function focusPDVInput() {
  const input =
    document.getElementById('saleProductCode') ||
    document.querySelector('#saleProductCode');

  if (!input) return;

  setTimeout(() => {
    input.focus();
    input.select?.();
  }, 80);
}

function getSavedSession() {
  try {
    const raw =
      localStorage.getItem(KEYS.session) ||
      localStorage.getItem('gamby_auth_session_modular') ||
      localStorage.getItem('session') ||
      localStorage.getItem('gamby_session');

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hasValidSavedSession() {
  const session = getSavedSession();
  return Boolean(session?.token && session?.user);
}

function clearInvalidSession() {
  localStorage.removeItem(KEYS.session);
  localStorage.removeItem('gamby_auth_session_modular');
  localStorage.removeItem('session');
  localStorage.removeItem('gamby_session');
}

function getCurrentPlan() {
  return (
    state.currentUser?.planCode ||
    state.currentUser?.plan ||
    state.subscription?.planCode ||
    state.registrationData?.planCode ||
    'basico'
  );
}

function getCurrentRole() {
  return String(state.currentUser?.role || 'operador').trim().toLowerCase();
}

function isAuthenticated() {
  return Boolean(state.currentUser);
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getSaleDateValue(sale) {
  return new Date(sale.createdAt || sale.date || sale.updatedAt || Date.now()).getTime();
}

function isSaleCancelled(sale) {
  return Boolean(
    sale?.cancelled ||
    sale?.isCancelled ||
    sale?.status === 'cancelled' ||
    sale?.status === 'canceled'
  );
}

function getSaleItems(sale) {
  return Array.isArray(sale?.items) ? sale.items : [];
}

function getSaleTotal(sale) {
  return Number(sale?.total || 0);
}

function getItemQuantity(item) {
  return Number(item?.quantity || item?.qtd || 0);
}

function getItemCost(item) {
  return Number(item?.cost || item?.unitCost || item?.purchasePrice || 0);
}

function getItemName(item) {
  return item?.name || item?.productName || item?.description || 'Produto';
}

function getTodayString() {
  return new Date().toLocaleDateString('pt-BR');
}

function isTodaySale(sale) {
  const rawDate = sale?.createdAt || sale?.date || sale?.updatedAt;
  if (!rawDate) return false;

  return new Date(rawDate).toLocaleDateString('pt-BR') === getTodayString();
}

function getValidTodaySales() {
  return Array.isArray(state.sales)
    ? state.sales.filter((sale) => isTodaySale(sale) && !isSaleCancelled(sale))
    : [];
}

function getCancelledTodaySales() {
  return Array.isArray(state.sales)
    ? state.sales.filter((sale) => isTodaySale(sale) && isSaleCancelled(sale))
    : [];
}

function getPeriodRangeDash(period) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  if (period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { start: startOfDay(y), end: endOfDay(y) };
  }
  if (period === '7days') {
    const s = new Date(now); s.setDate(s.getDate() - 6);
    return { start: startOfDay(s), end: endOfDay(now) };
  }
  if (period === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), end: endOfDay(now) };
  }
  return { start: startOfDay(now), end: endOfDay(now) };
}

function getSalesByPeriod(period) {
  if (!Array.isArray(state.sales)) return [];
  const { start, end } = getPeriodRangeDash(period);
  return state.sales.filter((sale) => {
    const d = new Date(sale.createdAt || sale.date || sale.updatedAt || 0);
    return d >= start && d <= end;
  });
}

function getDashboardStats() {
  const validSales = getValidTodaySales();
  const cancelledSales = getCancelledTodaySales();

  let totalSales = 0;
  let totalCancelled = 0;
  let totalCost = 0;
  let totalItems = 0;

  const productMap = new Map();
  const hourlyTotals = new Array(24).fill(0);
  const hourlyCounts = new Array(24).fill(0);

  validSales.forEach((sale) => {
    const saleTotal = getSaleTotal(sale);
    totalSales += saleTotal;

    const date = new Date(sale.createdAt || sale.date || Date.now());
    const hour = date.getHours();

    hourlyTotals[hour] += saleTotal;
    hourlyCounts[hour] += 1;

    getSaleItems(sale).forEach((item) => {
      const quantity = getItemQuantity(item);
      const cost = getItemCost(item);
      const name = getItemName(item);

      totalItems += quantity;
      totalCost += cost * quantity;

      productMap.set(name, (productMap.get(name) || 0) + quantity);
    });
  });

  cancelledSales.forEach((sale) => {
    totalCancelled += getSaleTotal(sale);
  });

  let topProduct = '—';
  let topProductQty = 0;

  productMap.forEach((qty, name) => {
    if (qty > topProductQty) {
      topProductQty = qty;
      topProduct = name;
    }
  });

  const estimatedProfit = totalSales - totalCost;
  const averageTicket = validSales.length ? totalSales / validSales.length : 0;

  let peakHour = -1;
  let peakAmount = 0;

  hourlyTotals.forEach((amount, hour) => {
    if (amount > peakAmount) {
      peakAmount = amount;
      peakHour = hour;
    }
  });

  const openingAmount = Number(state.cashSession?.openingAmount || 0);
  const cashBalance = openingAmount + totalSales - totalCancelled;

  return {
    validSales,
    cancelledSales,
    totalSales,
    totalCancelled,
    totalCost,
    totalItems,
    estimatedProfit,
    averageTicket,
    topProduct,
    topProductQty,
    hourlyTotals,
    hourlyCounts,
    peakHour,
    peakAmount,
    openingAmount,
    cashBalance
  };
}

/* ================= SAAS SECURITY / NAVIGATION ================= */

const PAGE_AUTH_KEY_PREFIX = 'gamby_page_authorized_until_';

function getPageAuthKey(pageName) {
  return `${PAGE_AUTH_KEY_PREFIX}${String(pageName || '').trim().toLowerCase()}`;
}

function setTemporaryPageAuthorization(pageName, minutes = 5) {
  const expiresAt = Date.now() + (minutes * 60 * 1000);
  sessionStorage.setItem(getPageAuthKey(pageName), String(expiresAt));
}

function hasTemporaryPageAuthorization(pageName) {
  const expiresAt = Number(sessionStorage.getItem(getPageAuthKey(pageName)) || 0);
  return expiresAt > Date.now();
}

function clearTemporaryPageAuthorizations() {
  Object.keys(sessionStorage).forEach((key) => {
    if (key.startsWith(PAGE_AUTH_KEY_PREFIX)) {
      sessionStorage.removeItem(key);
    }
  });
}

function denyAccess(pageName) {
  alert('Acesso restrito para este perfil ou plano.');

  auditLog('page_access_denied', {
    page: pageName,
    role: state.currentUser?.role || '',
    plan: getCurrentPlan()
  });
}

function pageNeedsExtraSecurity(pageName) {
  if (!shouldRequireSecurityChallenge(pageName)) return false;
  if (hasTemporaryPageAuthorization(pageName)) return false;
  return true;
}

function authorizeAndOpenPage(pageName) {
  requireManagerOrAdminPassword(() => {
    const ok = requireSecurityAnswer();

    if (!ok) return;

    setTemporaryPageAuthorization(pageName, 5);

    auditLog('sensitive_page_access_authorized', {
      page: pageName
    });

    openPageDirect(pageName);
  });
}

async function showPDVOpenCashChoice() {
  // Senha administrativa obrigatória em TODOS os casos.
  // Nenhum bypass por caixa já aberto, sessão anterior ou adminCashOpenAuthorized.
  requirePDVAdminAuthorization('open-cash', async () => {
    state.adminCashOpenAuthorized = true;
    auditLog('admin_authorized_cash_open', {
      operator: state.currentOperator?.name,
      terminalName: state.currentOperator?.terminalName
    });

    // Modo controlado: identificar operador APÓS autenticação administrativa
    let _pdvMode = state?.pdvSettings?.pdvMode;
    if (!_pdvMode) {
      try { _pdvMode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.pdvMode; } catch {}
    }
    if (_pdvMode === 'controlled' && !state.operatorPinValidated) {
      const operatorOk = await requirePDVOperatorSession('showPDVOpenCashChoice');
      if (!operatorOk) { state.adminCashOpenAuthorized = false; return; }
      state.operatorPinValidated = true;
    }

    // Se caixa já está aberto → entra direto no PDV (sem abrir novamente)
    if (state.cashSession?.isOpen) {
      openPageDirect('pdv');
      return;
    }

    const openAfterCashReady = () => {
      document.removeEventListener('gamby:cash-opened', openAfterCashReady);
      openPageDirect('pdv');
    };
    document.addEventListener('gamby:cash-opened', openAfterCashReady);

    if (typeof window.startPDVOpenCashFlow === 'function') {
      await window.startPDVOpenCashFlow(true);
    }

    if (state.cashSession?.isOpen) {
      document.removeEventListener('gamby:cash-opened', openAfterCashReady);
      openPageDirect('pdv');
    }
  }, () => {
    // Operador cancelou a senha (X/Cancelar) sem chegar a abrir o caixa —
    // mostrar a tela de caixa fechado em vez de deixá-lo "preso" numa página
    // sem página nenhuma ativa (nenhum openPageDirect foi chamado até aqui).
    showClosedCashScreen(state.cashSession);
  });
}

function openPDVExitOptions() {
  console.log('[PDV-NAV-SYSTEM] openPDVExitOptions chamado | __pdvKioskActive:', window.__pdvKioskActive, '| pdvPage ativo:', !!document.querySelector('[data-page-content="pdv"].active'));
  document.getElementById('pdvExitOptionsOverlay')?.remove();

  // Perfil Operador simulado (seletor de perfil) nunca deve ter uma saída via
  // senha admin para o dashboard aqui — mesmo que a conta real por trás seja
  // administrador (e portanto conheça a própria senha, "escapando" da
  // simulação). O objetivo do perfil simulado é refletir fielmente a
  // experiência de um operador real, que nunca teria essa senha. Sair do
  // perfil deve passar pelo botão "Trocar perfil" no topbar, não por aqui.
  const _isSimulatedOperador = state.activeProfile?.profile === 'operador';

  const overlay = document.createElement('div');
  overlay.id = 'pdvExitOptionsOverlay';
  overlay.className = 'overlay';

  overlay.innerHTML = _isSimulatedOperador ? `
    <div class="modal pdv-exit-modal">
      <div class="pdv-exit-emoji">🔒</div>
      <h3 class="pdv-exit-title">Acesso restrito</h3>
      <p class="mini pdv-modal-sub">
        Perfil Operador não tem acesso ao restante do sistema. Chame o administrador.
      </p>
      <div class="hero-actions compact pdv-modal-acts">
        <button id="pdvCloseCashBtn" class="btn btn-secondary" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          Fechar Caixa
        </button>
        <button id="pdvExitCancelBtn" class="btn btn-ghost" type="button">
          Cancelar
        </button>
      </div>
    </div>
  ` : `
    <div class="modal pdv-exit-modal">
      <div class="pdv-exit-emoji">🔐</div>
      <h3 class="pdv-exit-title">Acesso ao Sistema</h3>
      <p class="mini pdv-modal-sub">
        Ação administrativa. Senha de gerente ou administrador obrigatória.
      </p>
      <div class="hero-actions compact pdv-modal-acts">
        <button id="pdvExitDashboardBtn" class="btn btn-primary" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Sistema
        </button>
        <button id="pdvCloseCashBtn" class="btn btn-secondary" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          Fechar Caixa
        </button>
        <button id="pdvExitCancelBtn" class="btn btn-ghost" type="button">
          Cancelar
        </button>
      </div>
      <p class="mini pdv-modal-sub" style="margin-top:10px;font-size:11px;opacity:.6">
        Todas as ações exigem autenticação administrativa.
      </p>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cancelar — permanece no PDV
  document.getElementById('pdvExitCancelBtn')?.addEventListener('click', () => {
    overlay.remove();
  });

  // SISTEMA — senha admin → releasePDVKioskMode() → Dashboard
  // (botão nem existe no DOM quando _isSimulatedOperador — ver template acima)
  document.getElementById('pdvExitDashboardBtn')?.addEventListener('click', () => {
    console.log('[PDV-NAV-SYSTEM] botão Sistema clicado — iniciando auth');
    overlay.remove();
    requirePDVAdminAuthorization('navigate-dashboard', () => {
      console.log('[PDV-NAV-SYSTEM] auth-success — releasePDVKioskMode + dashboard');
      // A senha admin real acabou de ser validada — encerra qualquer perfil
      // simulado (ex.: Gerente) antes de navegar. Sem isso, openPageDirect()
      // barra 'dashboard' pelo mesmo gate de página que respeita activeProfile
      // (gov-access.canNavigate), caindo de volta no perfil restrito.
      clearActiveProfile();
      document.getElementById('switchProfileBtn')?.classList.add('hidden');
      releasePDVKioskMode();
      openPageDirect('dashboard');
    });
  });

  // FECHAR CAIXA — senha admin → fecha caixa diretamente (sem duplo modal)
  document.getElementById('pdvCloseCashBtn')?.addEventListener('click', () => {
    console.log('[PDV-CASH-CLOSE] botão Fechar Caixa clicado — __pdvCashCloseAuthorized:', window.__pdvCashCloseAuthorized, '| __pdvKioskActive:', window.__pdvKioskActive);
    overlay.remove();
    requirePDVAdminAuthorization('close-cash', async () => {
      console.log('[PDV-CASH-CLOSE] auth-success — flag antes de closeCashSession:', window.__pdvCashCloseAuthorized);
      await closeCashSession();
      console.log('[PDV-CASH-CLOSE] closeCashSession concluído');
    });
  });
}

window.openPDVExitOptions = openPDVExitOptions;

function requestProtectedPageNavigation(pageName) {
  const page = String(pageName || '').trim().toLowerCase();

  if (!page) return;
  if (!isAuthenticated()) return;

  if (!canAccessPage(page)) {
    denyAccess(page);
    return;
  }

  if (page === 'pdv') {
    // Mesmo raciocínio do guard em handleAuthenticatedEntry(): showPDVOpenCashChoice()
    // sempre exige senha admin de novo, por design, para o boot de um kiosk PDV
    // direto (sem seletor). Mas activateDefaultPage() (ui.js) também chama este
    // mesmo _navCallback quando decide a página padrão no boot/reload — inclusive
    // quando o botão de nav do Dashboard já foi ocultado por applyProfileMenuVisibility()
    // para um perfil Operador/Gerente simulado. Sem este guard, TODO reload com
    // activeProfile válido caía aqui e pedia senha admin de novo, ignorando
    // currentOperator/cashSession já restaurados por maybeEnterWithProfileSelection().
    if (hasActiveProfile()) {
      openPageDirect(page);
      return;
    }
    showPDVOpenCashChoice();
    return;
  }

  if (pageNeedsExtraSecurity(page)) {
    authorizeAndOpenPage(page);
    return;
  }

  openPageDirect(page);
}

// persistCurrentPageNavigation() removida — substituída pelo callback em setupNavigation()
// Todos os cliques em nav-btn agora vão direto para requestProtectedPageNavigation via setNavCallback

function bindPageJumpButtons() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page-jump]');
    if (!btn) return;

    const page = String(btn.dataset.pageJump || '').trim();
    if (!page) return;

    const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);

    if (navBtn) {
      navBtn.click();
      return;
    }

    requestProtectedPageNavigation(page);
  });
}

function applySaaSVisualMode() {
  const appShell = document.querySelector('.app-shell');

  if (!isAuthenticated()) {
    document.body.classList.remove('pdv-only-mode');
    appShell?.classList.remove('pdv-fullscreen');
    return;
  }

  // Mesmo raciocínio de openPageDirect(): shouldForcePDVMode() usa só o papel
  // real do JWT do dispositivo — um activeProfile explicitamente diferente
  // de 'operador' (seletor de perfil ou "Acesso autorizado") é um override
  // deliberado e deve suspender o força-kiosk visual enquanto ativo. Sem
  // isso, .pdv-fullscreen/.pdv-only-mode continuavam sendo reaplicados aqui
  // (chamado de dentro de openPageDirect()) mesmo depois do kiosk ter sido
  // liberado, escondendo a sidebar de novo.
  const _activeProfileOverridesForcedKiosk =
    state.activeProfile && state.activeProfile.profile !== 'operador';
  const forcePDV = shouldForcePDVMode() && !_activeProfileOverridesForcedKiosk;

  document.body.classList.toggle('pdv-only-mode', forcePDV);

  // Usar isPDVActive() do módulo central — nunca remover pdv-fullscreen enquanto PDV ativo.
  if (forcePDV || isPDVActive()) {
    appShell?.classList.add('pdv-fullscreen');
  } else {
    appShell?.classList.remove('pdv-fullscreen');
  }

  applyMenuSecurity();
}

/* ================= REGISTRO / FLUXO ================= */

async function promptOpenCashWhenEnteringPDV() {
  // Sempre exige senha admin — sem bypass por caixa já aberto.
  showPDVOpenCashChoice();
}

function forcePendingRegistrationFlow() {
  const user = state.currentUser;

  if (!user) return false;
  if (isDeveloperUser(user)) return false;

  const pendingStep = getPendingRegistrationStep(user, state.subscription);

  if (!pendingStep) return false;

  document.getElementById('appRoot')?.classList.add('hidden');
  document.getElementById('authRoot')?.classList.remove('hidden');

  openRegisterModal({ keepSession: true });
  showRegistrationActivationCard();
  toggleRegister(true);

  setTimeout(() => {
    setStage(pendingStep);
  }, 80);

  return true;
}

/* ================= DASHBOARD ================= */

function updateDashboardClock() {
  const clockEl = document.getElementById('dashboardLiveClock');
  const dateEl = document.getElementById('dashboardLiveDate');

  if (!clockEl || !dateEl) return;

  const now = new Date();

  clockEl.textContent = now.toLocaleTimeString('pt-BR');

  dateEl.textContent = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function initDashboardClock() {
  if (dashboardClockStarted) return;

  dashboardClockStarted = true;

  updateDashboardClock();
  setInterval(updateDashboardClock, 1000);
}

function getChartPanel(canvas) {
  return canvas?.closest('.acard') || canvas?.closest('.premium-card') || canvas?.closest('.dashboard-pro-card') || null;
}

function showChartUpdatedBadge(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.closest('.chart-wrap') || canvas.parentElement;
  if (!wrap) return;
  let badge = wrap.querySelector('.chart-updated-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'chart-updated-badge';
    badge.textContent = '● Atualizado agora';
    wrap.appendChild(badge);
  }
  badge.classList.remove('chart-badge-fade');
  badge.classList.add('chart-badge-show');
  clearTimeout(badge._fadeTimer);
  badge._fadeTimer = setTimeout(() => badge.classList.add('chart-badge-fade'), 2200);
}

function renderDashboardFinanceChart(period) {
  const usedPeriod = period || _dashFinancePeriod || 'today';
  const canvas = document.getElementById('dashboardFinanceChart');
  const empty = document.getElementById('dashboardFinanceChartEmpty');
  const panel = getChartPanel(canvas);

  if (!canvas || !panel) return;

  const role = getCurrentRole();
  const canView = role === 'administrador' || role === 'desenvolvedora' || role === 'gerente';
  panel.classList.toggle('hidden', !canView);
  if (!canView) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (_financeChartAnimId) { cancelAnimationFrame(_financeChartAnimId); _financeChartAnimId = null; }

  // Série horária: soma por hora (somente vendas válidas)
  const sales = getSalesByPeriod(usedPeriod).filter((s) => !isSaleCancelled(s));

  const hourlyAmounts = new Array(24).fill(0);
  sales.forEach((sale) => {
    const h = new Date(sale.createdAt || sale.date || Date.now()).getHours();
    hourlyAmounts[h] += getSaleTotal(sale);
  });

  // Acumulado: carregar valor anterior para horas sem venda
  const cumulative = new Array(24).fill(0);
  let running = 0;
  for (let h = 0; h < 24; h++) {
    running += hourlyAmounts[h];
    cumulative[h] = running;
  }

  const finalBalance = running;
  setText('dashboardAccumulatedBalance', formatBRL(finalBalance));

  // vs ontem
  const vsWrap = document.getElementById('dashVsYesterdayWrap');
  const vsEl = document.getElementById('dashVsYesterday');
  if (vsWrap && vsEl && usedPeriod === 'today') {
    const { start: ys, end: ye } = getPeriodRangeDash('yesterday');
    const ySales = (Array.isArray(state.sales) ? state.sales : []).filter((s) => {
      const d = new Date(s.createdAt || s.date || 0);
      return d >= ys && d <= ye && !isSaleCancelled(s);
    });
    const yTotal = ySales.reduce((acc, s) => acc + getSaleTotal(s), 0);
    if (yTotal > 0) {
      const pct = ((finalBalance - yTotal) / yTotal * 100).toFixed(0);
      const up = finalBalance >= yTotal;
      vsEl.textContent = `${up ? '↑' : '↓'} ${Math.abs(pct)}%`;
      vsEl.classList.toggle('dash-vs-up',   up);
      vsEl.classList.toggle('dash-vs-down', !up);
      vsWrap.classList.remove('hidden');
    } else {
      vsWrap.classList.add('hidden');
    }
  } else if (vsWrap) {
    vsWrap.classList.add('hidden');
  }

  if (!sales.length) {
    if (empty) empty.classList.remove('hidden');
    const ctx2 = canvas.getContext('2d');
    const dw = canvas.offsetWidth || 600;
    canvas.width = dw * (window.devicePixelRatio || 1);
    canvas.height = 240 * (window.devicePixelRatio || 1);
    canvas.classList.add('chart-canvas-rendered');
    canvas.style.setProperty('--display-w', `${dw}px`);
    canvas.style.setProperty('--display-h', '240px');
    ctx2?.clearRect(0, 0, dw, 240);
    return;
  }
  if (empty) empty.classList.add('hidden');

  // Último horário com venda (para ponto de destaque)
  let lastSaleHour = -1;
  for (let h = 23; h >= 0; h--) { if (hourlyAmounts[h] > 0) { lastSaleHour = h; break; } }

  const displayWidth = canvas.offsetWidth || 600;
  const displayHeight = 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.classList.add('chart-canvas-rendered');
  canvas.style.setProperty('--display-w', `${displayWidth}px`);
  canvas.style.setProperty('--display-h', `${displayHeight}px`);

  const pL = 52, pR = 18, pT = 22, pB = 34;
  const cW = displayWidth - pL - pR;
  const cH = displayHeight - pT - pB;
  const maxVal = Math.max(...cumulative, 1);

  function xH(h) { return pL + (h / 23) * cW; }
  function yV(v) { return pT + ((maxVal - v) / maxVal) * cH; }

  function drawFrame(eased) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Y animado: cada valor cresce de 0 até o real conforme eased (0→1)
    // Horas sem venda ficam no zero → permanecem na base, visíveis desde o frame 1
    function yVA(v) { return pT + ((maxVal - v * eased) / maxVal) * cH; }

    // Grid horizontal (estático, não animado)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = maxVal - (maxVal * i) / 4;
      const y = yV(v);
      ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(displayWidth - pR, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.font = '10px Arial';
      ctx.fillText(formatBRL(v), 4, y + 3);
    }

    // Labels X (a cada 4h)
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.font = '10px Arial';
    [0, 4, 8, 12, 16, 20, 23].forEach((h) => {
      ctx.fillText(`${String(h).padStart(2, '0')}h`, xH(h) - 8, displayHeight - 9);
    });

    // Linha vertical no horário atual
    const nowH = new Date().getHours();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(xH(nowH), pT); ctx.lineTo(xH(nowH), pT + cH); ctx.stroke();
    ctx.setLineDash([]);

    // Area fill — todos os 24 pontos, valores animados
    const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
    grad.addColorStop(0, 'rgba(74,222,128,0.22)');
    grad.addColorStop(1, 'rgba(74,222,128,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xH(0), yVA(cumulative[0]));
    for (let h = 1; h < 24; h++) ctx.lineTo(xH(h), yVA(cumulative[h]));
    ctx.lineTo(xH(23), pT + cH);
    ctx.lineTo(xH(0), pT + cH);
    ctx.closePath();
    ctx.fill();

    // Linha principal — todos os 24 pontos, valores animados
    ctx.beginPath();
    ctx.moveTo(xH(0), yVA(cumulative[0]));
    for (let h = 1; h < 24; h++) ctx.lineTo(xH(h), yVA(cumulative[h]));
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Pontos nos horários com venda (animados junto)
    for (let h = 0; h < 24; h++) {
      if (hourlyAmounts[h] > 0) {
        ctx.beginPath();
        ctx.arc(xH(h), yVA(cumulative[h]), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#4ade80';
        ctx.fill();
      }
    }

    // Ponto de destaque com halo + label (aparece quando animação completa)
    if (eased >= 0.98 && lastSaleHour >= 0) {
      const lx = xH(lastSaleHour);
      const ly = yVA(cumulative[lastSaleHour]);

      ctx.beginPath();
      ctx.arc(lx, ly, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74,222,128,0.13)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(lx, ly, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#4ade80';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const label = formatBRL(cumulative[lastSaleHour]);
      ctx.font = 'bold 11px Arial';
      const lw = ctx.measureText(label).width;
      const lx2 = Math.min(Math.max(lx - lw / 2, pL + 2), displayWidth - pR - lw - 2);
      const ly2 = Math.max(ly - 14, pT + 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx2, ly2);
    }
  }

  // Animação ease-out
  const t0 = performance.now();
  const dur = 650;
  function animate(now) {
    const p = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    drawFrame(eased);
    if (p < 1) { _financeChartAnimId = requestAnimationFrame(animate); }
    else { _financeChartAnimId = null; }
  }
  _financeChartAnimId = requestAnimationFrame(animate);

  showChartUpdatedBadge('dashboardFinanceChart');
}

function renderDashboardPeakChart(period) {
  const usedPeriod = period || _dashPeakPeriod || 'today';
  const canvas = document.getElementById('dashboardPeakChart');
  const empty = document.getElementById('dashboardPeakChartEmpty');
  const panel = getChartPanel(canvas);

  if (!canvas || !panel) return;

  const role = getCurrentRole();
  const canView = role === 'administrador' || role === 'desenvolvedora' || role === 'gerente';
  panel.classList.toggle('hidden', !canView);
  if (!canView) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (_peakChartAnimId) { cancelAnimationFrame(_peakChartAnimId); _peakChartAnimId = null; }

  const periodSales = getSalesByPeriod(usedPeriod).filter((s) => !isSaleCancelled(s));

  // Agrupar em 12 faixas de 2h: 00h, 02h, 04h ... 22h
  const BUCKETS = 12;
  const bucketTotals = new Array(BUCKETS).fill(0);
  const bucketCounts = new Array(BUCKETS).fill(0);

  periodSales.forEach((sale) => {
    const h = new Date(sale.createdAt || sale.date || Date.now()).getHours();
    const b = Math.floor(h / 2);
    bucketTotals[b] += getSaleTotal(sale);
    bucketCounts[b] += 1;
  });

  let peakBucket = -1;
  let peakAmount = 0;
  bucketTotals.forEach((v, i) => { if (v > peakAmount) { peakAmount = v; peakBucket = i; } });

  const hasData = bucketTotals.some((v) => v > 0);

  const displayWidth = canvas.offsetWidth || 600;
  const displayHeight = 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.classList.add('chart-canvas-rendered');
  canvas.style.setProperty('--display-w', `${displayWidth}px`);
  canvas.style.setProperty('--display-h', `${displayHeight}px`);

  if (!hasData) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    if (empty) empty.classList.remove('hidden');
    setText('dashboardPeakText', '—');
    return;
  }
  if (empty) empty.classList.add('hidden');

  const max = Math.max(...bucketTotals, 1);
  const pL = 12, pR = 12, pT = 18, pB = 36;
  const cW = displayWidth - pL - pR;
  const cH = displayHeight - pT - pB;
  const barSlot = cW / BUCKETS;
  const barW = Math.max(4, barSlot - 6);
  const peakHourLabel = peakBucket >= 0
    ? `${String(peakBucket * 2).padStart(2, '0')}h–${String(peakBucket * 2 + 1).padStart(2, '0')}h`
    : '—';

  setText(
    'dashboardPeakText',
    peakBucket >= 0 ? `${peakHourLabel} • ${formatBRL(peakAmount)}` : '—'
  );

  const t0 = performance.now();
  const dur = 600;

  function drawPeakFrame(progress) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Grid horizontal
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pT + (i * cH) / 3;
      ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(displayWidth - pR, y); ctx.stroke();
    }

    bucketTotals.forEach((val, b) => {
      const targetH = (val / max) * cH;
      const animH = targetH * progress;
      const x = pL + b * barSlot + (barSlot - barW) / 2;
      const y = pT + cH - animH;

      const isPeak = b === peakBucket;

      if (animH > 0) {
        // Gradiente da barra
        const grad = ctx.createLinearGradient(x, y, x, pT + cH);
        if (isPeak) {
          grad.addColorStop(0, 'rgba(96,165,250,1)');
          grad.addColorStop(1, 'rgba(59,130,246,0.4)');
        } else {
          grad.addColorStop(0, 'rgba(96,165,250,0.7)');
          grad.addColorStop(1, 'rgba(59,130,246,0.15)');
        }
        ctx.fillStyle = grad;

        // Barra com cantos arredondados no topo
        const r = Math.min(4, barW / 2, animH / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, pT + cH);
        ctx.lineTo(x, pT + cH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();

        // Destaque barra pico: brilho lateral
        if (isPeak) {
          ctx.strokeStyle = 'rgba(147,197,253,0.6)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Contador de vendas acima da barra
        if (progress >= 1 && bucketCounts[b] > 0) {
          ctx.fillStyle = isPeak ? '#fff' : 'rgba(255,255,255,0.65)';
          ctx.font = isPeak ? 'bold 10px Arial' : '10px Arial';
          const txt = String(bucketCounts[b]);
          const tw = ctx.measureText(txt).width;
          ctx.fillText(txt, x + barW / 2 - tw / 2, y - 5);
        }
      }

      // Labels X (hora da faixa)
      ctx.fillStyle = isPeak ? 'rgba(147,197,253,0.9)' : 'rgba(255,255,255,0.42)';
      ctx.font = isPeak ? 'bold 10px Arial' : '10px Arial';
      const lbl = `${String(b * 2).padStart(2, '0')}h`;
      const lw = ctx.measureText(lbl).width;
      ctx.fillText(lbl, x + barW / 2 - lw / 2, displayHeight - 10);
    });
  }

  function animatePeak(now) {
    const p = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    drawPeakFrame(eased);
    if (p < 1) { _peakChartAnimId = requestAnimationFrame(animatePeak); }
    else {
      _peakChartAnimId = null;
      showChartUpdatedBadge('dashboardPeakChart');
    }
  }

  _peakChartAnimId = requestAnimationFrame(animatePeak);
}

function renderDashboardCashSummary() {
  const { totalSales } = getDashboardStats();

  const session = state.cashSession || {};
  const isOpen = Boolean(session.isOpen);

  setText('cashSummaryStatus', isOpen ? 'Aberto' : 'Fechado');
  const cashDot = document.getElementById('cashDot');
  if (cashDot) {
    cashDot.classList.toggle('open', isOpen);
    cashDot.classList.toggle('closed', !isOpen);
  }

  const openedAt =
    session.openedAt ||
    session.startTime ||
    session.createdAt ||
    null;

  setText(
    'cashSummaryOpenTime',
    openedAt
      ? new Date(openedAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—'
  );

  setText('cashSummaryOpeningAmount', formatBRL(session.openingAmount || 0));
  setText('cashSummarySales', formatBRL(totalSales));
}

function renderDashboardAdvancedMetrics() {
  const stats = getDashboardStats();

  setText('metricBalance', formatBRL(stats.cashBalance));
  setText('metricSales', formatBRL(stats.totalSales));
  setText('metricEstimatedProfit', formatBRL(stats.estimatedProfit));
  setText('metricAverageTicket', formatBRL(stats.averageTicket));
  setText('metricTopProduct', stats.topProduct);
  setText('metricSoldItems', String(stats.totalItems));
  setText('dashboardTopProductName', stats.topProduct);
  setText('dashboardTopProductQty', String(stats.topProductQty));

  updateDashboardSparklines(stats.hourlyTotals);

  const imgWrap = document.getElementById('dashTopProductImgWrap');
  if (imgWrap) {
    const found = Array.isArray(state.products)
      ? state.products.find((p) => (p.name || p.nome || '') === stats.topProduct)
      : null;
    const cid = String(state.currentUser?.companyId || 'local').trim() || 'local';
    const imgKey = found?.code ? `gamby_pimg_${cid}_${found.code}` : null;
    const imgUrl =
      found?.imageUrl ||
      found?.imagem ||
      (imgKey ? localStorage.getItem(imgKey) || '' : '');
    if (imgUrl) {
      imgWrap.innerHTML = `<img src="${_esc(_safeImageUrl(imgUrl))}" alt="${_esc(stats.topProduct)}" class="dash-tp-img">`;
    } else {
      const _tpInitial = (stats.topProduct || '?')[0].toUpperCase();
      imgWrap.innerHTML = `<div class="tp-thumb-fb">${_tpInitial}</div>`;
    }
  }

  const planLabel =
    state.currentUser?.planName ||
    state.currentUser?.plan ||
    state.subscription?.planName ||
    state.subscription?.planCode ||
    'Básico';

  setText('dashboardPlanName', String(planLabel));

  setText('reportTotalSales', formatBRL(stats.totalSales));
  setText('reportCancelledSales', formatBRL(stats.totalCancelled));
  setText('reportEstimatedProfit', formatBRL(stats.estimatedProfit));
  setText('reportAverageTicket', formatBRL(stats.averageTicket));
  setText(
    'reportBestHour',
    stats.peakHour >= 0 ? `${String(stats.peakHour).padStart(2, '0')}h` : '—'
  );
  setText('reportBestProduct', stats.topProduct);
  setText('reportItemsSold', String(stats.totalItems));
  setText('reportCashStatus', state.cashSession?.isOpen ? 'Aberto' : 'Fechado');

  const metricCashSession = document.getElementById('metricCashSession');
  if (metricCashSession) metricCashSession.textContent = state.cashSession?.isOpen ? 'Aberto' : 'Fechado';
}

function renderDashboardLowStock() {
  const tbody = document.getElementById('lowStockTableBody');
  const banner = document.getElementById('lowStockWarnBanner');
  const warnText = document.getElementById('lowStockWarnText');
  if (!tbody) return;

  const lowProducts = Array.isArray(state.products)
    ? state.products.filter((p) => {
        const active = p.active !== false;
        const stock = Number(p.stock ?? p.estoque ?? 0);
        const min = Number(p.minStock ?? p.estoqueMinimo ?? 0);
        return active && stock <= min;
      })
    : [];

  if (!lowProducts.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="sa-td-empty">Sem alertas de estoque</td></tr>';
    if (banner) banner.classList.add('hidden');
    return;
  }

  const _lowStockCatColors = { 'Bebidas':'#2563eb','Alimentos':'#22c55e','Papelaria':'#8b5cf6','Doces':'#f59e0b','Laticínios':'#06b6d4','Higiene':'#10b981','Eletrônicos':'#60a5fa','Salgadinhos':'#fb923c','Outros':'#64748b' };
  tbody.innerHTML = lowProducts.slice(0, 5).map((p) => {
    const _name = _esc(p.name || p.nome || '—');
    const stock = Number(p.stock ?? p.estoque ?? 0);
    const min = Number(p.minStock ?? p.estoqueMinimo ?? 0);
    const colorCls = stock === 0 ? 'txt-danger' : 'txt-amber';
    const _cid = String(state.currentUser?.companyId || 'local').trim() || 'local';
    const rawImgUrl =
      p.imageUrl ||
      p.imagem ||
      (p.code ? localStorage.getItem(`gamby_pimg_${_cid}_${p.code}`) || '' : '');
    const safeImg = _safeImageUrl(rawImgUrl);
    const _clr = _lowStockCatColors[p.category] || '#64748b';
    const _lsInitial = (_esc(p.name || p.nome || '?'))[0].toUpperCase();
    const imgHtml = safeImg
      ? `<img src="${_esc(safeImg)}" alt="${_name}" class="sa-img">`
      : `<div class="sa-thumb" data-sa-color="${_esc(_clr)}">${_lsInitial}</div>`;
    return `<tr>
      <td class="sa-row-cell">
        <div class="sa-name-wrap">
          ${imgHtml}
          <span class="sa-name-txt" title="${_name}">${_name}</span>
        </div>
      </td>
      <td class="sa-td-stock ${colorCls}">${stock}</td>
      <td class="sa-td-min">${min}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-sa-color]').forEach(d => {
    d.style.setProperty('--sa-color', d.dataset.saColor);
  });

  if (banner) {
    banner.classList.remove('hidden');
    if (warnText) warnText.textContent = `${lowProducts.length} produto(s) com estoque baixo`;
  }
}

function renderDashboardInsights() {
  const el = document.getElementById('financeSummaryDash');
  if (!el) return;

  const stats = getDashboardStats();

  if (!stats.validSales.length && !stats.cancelledSales.length) {
    el.textContent = 'Suas vendas e movimentações serão analisadas automaticamente conforme o sistema for registrando dados.';
    return;
  }

  const parts = [];

  if (stats.totalSales > 0) {
    parts.push(`Hoje você faturou ${formatBRL(stats.totalSales)} em ${stats.validSales.length} venda(s).`);
  }
  if (stats.estimatedProfit > 0) {
    const margin = stats.totalSales > 0 ? ((stats.estimatedProfit / stats.totalSales) * 100).toFixed(1) : 0;
    parts.push(`Lucro estimado de ${formatBRL(stats.estimatedProfit)} (margem ${margin}%).`);
  }
  if (stats.peakHour >= 0) {
    parts.push(`Pico de movimento às ${String(stats.peakHour).padStart(2, '0')}h com ${formatBRL(stats.peakAmount)} em vendas.`);
  }
  if (stats.topProduct !== '—') {
    parts.push(`Produto destaque: "${stats.topProduct}" com ${stats.topProductQty} unidade(s) vendida(s).`);
  }
  if (stats.totalCancelled > 0) {
    parts.push(`${stats.cancelledSales.length} cancelamento(s) totalizando ${formatBRL(stats.totalCancelled)}.`);
  }
  if (stats.averageTicket > 0) {
    parts.push(`Ticket médio de ${formatBRL(stats.averageTicket)} por venda.`);
  }

  el.textContent = parts.length ? parts.join(' ') : 'Continue registrando vendas para obter insights detalhados.';
}

// ─── Chart.js helpers ─────────────────────────────────────────────────────────

const _CJ_GRID  = 'rgba(255,255,255,0.05)';
const _CJ_TICK  = 'rgba(255,255,255,0.45)';
const _CJ_FONT  = { size: 10 };
const _CJ_EMPTY_BKG = 'rgba(255,255,255,0.06)';

function _cjAxesXY(yFmt = true) {
  return {
    x: { grid: { color: _CJ_GRID }, ticks: { color: _CJ_TICK, font: _CJ_FONT } },
    y: {
      grid: { color: _CJ_GRID },
      ticks: { color: _CJ_TICK, font: _CJ_FONT, callback: yFmt ? v => formatBRL(v) : undefined },
      beginAtZero: true,
    },
  };
}

// ─── Faturamento Semanal ───────────────────────────────────────────────────────

function renderDashboardWeeklyChart() {
  const canvas = document.getElementById('dashWeeklyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_weeklyChartInst) { _weeklyChartInst.destroy(); _weeklyChartInst = null; }

  const now  = new Date();
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i))
  );

  const sales = getSalesByPeriod('7days').filter(s => !isSaleCancelled(s));
  const totals = days.map(d => {
    const y = d.getFullYear(), mo = d.getMonth(), da = d.getDate();
    return sales.filter(s => {
      const sd = new Date(s.createdAt || s.date || 0);
      return sd.getFullYear() === y && sd.getMonth() === mo && sd.getDate() === da;
    }).reduce((acc, s) => acc + getSaleTotal(s), 0);
  });

  const WDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const labels = days.map(d => `${WDAYS[d.getDay()]} ${d.getDate()}`);
  const isEmpty = totals.every(v => v === 0);
  const emptyEl = document.getElementById('dashWeeklyChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', !isEmpty);

  _weeklyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: totals,
        backgroundColor: days.map(d =>
          d.toDateString() === now.toDateString() ? 'rgba(96,165,250,0.55)' : 'rgba(96,165,250,0.22)'
        ),
        borderColor: '#60a5fa',
        borderWidth: 1.5,
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatBRL(ctx.parsed.y) } } },
      scales: _cjAxesXY(),
    },
  });
}

// ─── Faturamento Mensal ────────────────────────────────────────────────────────

function renderDashboardMonthlyChart() {
  const canvas = document.getElementById('dashMonthlyChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_monthlyChartInst) { _monthlyChartInst.destroy(); _monthlyChartInst = null; }

  const now  = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const curDay = now.getDate();
  const days   = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const sales = getSalesByPeriod('month').filter(s => !isSaleCancelled(s));
  const totals = days.map(day =>
    sales.filter(s => {
      const sd = new Date(s.createdAt || s.date || 0);
      return sd.getFullYear() === now.getFullYear() &&
             sd.getMonth()    === now.getMonth()    &&
             sd.getDate()     === day;
    }).reduce((acc, s) => acc + getSaleTotal(s), 0)
  );

  const isEmpty = totals.every(v => v === 0);
  const emptyEl = document.getElementById('dashMonthlyChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', !isEmpty);

  const bkgs   = days.map(d => d > curDay ? 'rgba(255,255,255,0.04)' : d === curDay ? 'rgba(74,222,128,0.45)' : 'rgba(74,222,128,0.22)');
  const bdrs   = days.map(d => d > curDay ? 'rgba(255,255,255,0.08)'  : '#4ade80');

  _monthlyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: days.map(String),
      datasets: [{ data: totals, backgroundColor: bkgs, borderColor: bdrs, borderWidth: 1, borderRadius: 3, borderSkipped: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => formatBRL(ctx.parsed.y), title: ctx => `Dia ${ctx[0].label}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: _CJ_TICK, font: { size: 9 }, maxTicksLimit: 10 } },
        y: { grid: { color: _CJ_GRID }, ticks: { color: _CJ_TICK, font: _CJ_FONT, callback: v => formatBRL(v) }, beginAtZero: true },
      },
    },
  });
}

// ─── Métodos de Pagamento ──────────────────────────────────────────────────────

function renderDashboardPaymentMethodsChart() {
  const canvas = document.getElementById('dashPaymentMethodsChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_paymentChartInst) { _paymentChartInst.destroy(); _paymentChartInst = null; }

  const _PM = {
    cash:'Dinheiro', CASH:'Dinheiro', dinheiro:'Dinheiro',
    pix:'PIX', PIX:'PIX',
    credit:'Crédito', credit_card:'Crédito', CREDIT_CARD:'Crédito', credito:'Crédito',
    debit:'Débito', debit_card:'Débito', DEBIT_CARD:'Débito', debito:'Débito',
    voucher:'Vale', VOUCHER:'Vale', ticket:'Vale',
  };

  const sales = getSalesByPeriod('month').filter(s => !isSaleCancelled(s));
  const pmMap = new Map();
  sales.forEach(s => {
    const raw   = s.paymentMethod || s.payment_method || s.metodoPagamento || s.payment || '';
    const label = _PM[raw] || _PM[String(raw).toLowerCase()] || (raw ? String(raw) : 'Outros');
    pmMap.set(label, (pmMap.get(label) || 0) + getSaleTotal(s));
  });

  const entries = [...pmMap.entries()].sort((a, b) => b[1] - a[1]);
  const isEmpty = entries.length === 0 || entries.every(([, v]) => v === 0);
  const emptyEl = document.getElementById('dashPaymentChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', !isEmpty);

  const COLS  = ['#60a5fa','#4ade80','#c084fc','#fbbf24','#f87171','#34d399'];
  const labels = isEmpty ? ['Sem dados'] : entries.map(([l]) => l);
  const data   = isEmpty ? [1]           : entries.map(([, v]) => v);
  const bkg    = isEmpty ? [_CJ_EMPTY_BKG] : COLS.slice(0, entries.length);

  _paymentChartInst = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: bkg, borderColor: 'rgba(0,0,0,0)', borderWidth: 0, hoverOffset: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%', animation: { duration: 400 },
      plugins: {
        legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,0.55)', font: { size: 10 }, padding: 8, boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: ctx => isEmpty ? 'Sem dados' : `${ctx.label}: ${formatBRL(ctx.parsed)}` } },
      },
    },
  });
}

// ─── Curva ABC de Produtos ─────────────────────────────────────────────────────

function renderDashboardAbcChart() {
  const canvas = document.getElementById('dashAbcChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_abcChartInst) { _abcChartInst.destroy(); _abcChartInst = null; }

  const sales = getSalesByPeriod('month').filter(s => !isSaleCancelled(s));
  const revMap = new Map();
  sales.forEach(s => {
    getSaleItems(s).forEach(item => {
      const name = getItemName(item);
      const qty  = getItemQuantity(item);
      const price = Number(item.price || item.unitPrice || item.salePrice || item.preco || 0);
      revMap.set(name, (revMap.get(name) || 0) + price * qty);
    });
    if (!getSaleItems(s).length && getSaleTotal(s) > 0) {
      revMap.set('Produto', (revMap.get('Produto') || 0) + getSaleTotal(s));
    }
  });

  const sorted = [...revMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const totalRev = sorted.reduce((acc, [, v]) => acc + v, 0);
  let running = 0;
  const colors = sorted.map(([, v]) => {
    running += v;
    const pct = totalRev > 0 ? running / totalRev : 1;
    return pct <= 0.8 ? '#4ade80' : pct <= 0.95 ? '#fbbf24' : '#f87171';
  });

  const isEmpty = sorted.length === 0;
  const emptyEl = document.getElementById('dashAbcChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', !isEmpty);

  const labels = isEmpty ? ['Sem dados'] : sorted.map(([n]) => n.length > 14 ? n.slice(0, 14) + '…' : n);
  const data   = isEmpty ? [0]           : sorted.map(([, v]) => v);

  _abcChartInst = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: isEmpty ? _CJ_EMPTY_BKG : colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatBRL(ctx.parsed.x) } } },
      scales: {
        x: { grid: { color: _CJ_GRID }, ticks: { color: _CJ_TICK, font: _CJ_FONT, callback: v => formatBRL(v) }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.55)', font: _CJ_FONT } },
      },
    },
  });
}

// ─── Ranking de Operadores ─────────────────────────────────────────────────────

function renderDashboardOperatorsChart() {
  const canvas = document.getElementById('dashOperatorsChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_operatorsChartInst) { _operatorsChartInst.destroy(); _operatorsChartInst = null; }

  const sales = getSalesByPeriod('month').filter(s => !isSaleCancelled(s));
  const opMap = new Map();
  sales.forEach(s => {
    const op = s.operatorName || s.operator || s.userName || s.createdBy || s.userId || 'Operador';
    opMap.set(op, (opMap.get(op) || 0) + getSaleTotal(s));
  });

  const sorted = [...opMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const isEmpty = sorted.length === 0;
  const emptyEl = document.getElementById('dashOperatorsChartEmpty');
  if (emptyEl) emptyEl.classList.toggle('hidden', !isEmpty);

  const COLS = ['#c084fc','#a78bfa','#8b5cf6','#7c3aed','#6d28d9','#5b21b6'];

  _operatorsChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: isEmpty ? ['Sem dados'] : sorted.map(([n]) => n.length > 10 ? n.slice(0, 10) + '…' : n),
      datasets: [{ data: isEmpty ? [0] : sorted.map(([, v]) => v), backgroundColor: isEmpty ? _CJ_EMPTY_BKG : COLS.slice(0, sorted.length), borderRadius: 5, borderSkipped: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatBRL(ctx.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: _CJ_TICK, font: _CJ_FONT } },
        y: { grid: { color: _CJ_GRID }, ticks: { color: _CJ_TICK, font: _CJ_FONT, callback: v => formatBRL(v) }, beginAtZero: true },
      },
    },
  });
}

// ─── Comparativos ─────────────────────────────────────────────────────────────

function renderDashboardComparisons() {
  const todayTotal = getDashboardStats().totalSales;

  const { start: ys, end: ye } = getPeriodRangeDash('yesterday');
  const ySales = (Array.isArray(state.sales) ? state.sales : []).filter(s => {
    if (isSaleCancelled(s)) return false;
    const d = new Date(s.createdAt || s.date || 0);
    return d >= ys && d <= ye;
  });
  const yTotal = ySales.reduce((acc, s) => acc + getSaleTotal(s), 0);

  setText('dashTodayTotal',     formatBRL(todayTotal));
  setText('dashYesterdayTotal', formatBRL(yTotal));

  const todayDiffEl = document.getElementById('dashTodayVsDiff');
  if (todayDiffEl) {
    if (yTotal > 0) {
      const pct = ((todayTotal - yTotal) / yTotal * 100).toFixed(1);
      const up  = todayTotal >= yTotal;
      todayDiffEl.textContent = `${up ? '↑' : '↓'} ${Math.abs(Number(pct))}%`;
      todayDiffEl.className = up ? 'dpg-compare-vs dpg-vs-up' : 'dpg-compare-vs dpg-vs-down';
    } else if (todayTotal > 0) {
      todayDiffEl.textContent = '↑ novo';
      todayDiffEl.className = 'dpg-compare-vs dpg-vs-up';
    } else {
      todayDiffEl.textContent = '—';
      todayDiffEl.className = 'dpg-compare-vs';
    }
  }

  const now            = new Date();
  const currMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const allSales       = Array.isArray(state.sales) ? state.sales : [];

  const currMonthTotal = allSales.filter(s => {
    if (isSaleCancelled(s)) return false;
    return new Date(s.createdAt || s.date || 0) >= currMonthStart;
  }).reduce((acc, s) => acc + getSaleTotal(s), 0);

  const prevMonthTotal = allSales.filter(s => {
    if (isSaleCancelled(s)) return false;
    const d = new Date(s.createdAt || s.date || 0);
    return d >= prevMonthStart && d <= prevMonthEnd;
  }).reduce((acc, s) => acc + getSaleTotal(s), 0);

  setText('dashCurrentMonthTotal', formatBRL(currMonthTotal));
  setText('dashPrevMonthTotal',    formatBRL(prevMonthTotal));

  const monthDiffEl = document.getElementById('dashMonthVsDiff');
  if (monthDiffEl) {
    if (prevMonthTotal > 0) {
      const pct = ((currMonthTotal - prevMonthTotal) / prevMonthTotal * 100).toFixed(1);
      const up  = currMonthTotal >= prevMonthTotal;
      monthDiffEl.textContent = `${up ? '↑' : '↓'} ${Math.abs(Number(pct))}%`;
      monthDiffEl.className = up ? 'dpg-compare-vs dpg-vs-up' : 'dpg-compare-vs dpg-vs-down';
    } else if (currMonthTotal > 0) {
      monthDiffEl.textContent = '↑ novo';
      monthDiffEl.className = 'dpg-compare-vs dpg-vs-up';
    } else {
      monthDiffEl.textContent = '—';
      monthDiffEl.className = 'dpg-compare-vs';
    }
  }
}

function renderDashboardSessionInfo() {
  const user = state.currentUser;
  if (!user) return;

  const roleMap = {
    administrador: 'Administrador',
    gerente: 'Gerente',
    operador: 'Operador',
    desenvolvedora: 'Desenvolvedora',
    financeiro: 'Financeiro'
  };
  const roleEl = document.getElementById('dashUserRole');
  if (roleEl) roleEl.textContent = roleMap[user.role] || user.role || 'Usuário';

  const avatarEl = document.getElementById('dashUserAvatar');
  if (avatarEl) {
    const name = user.name || user.email || 'U';
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }

  const lowCount = Array.isArray(state.products)
    ? state.products.filter((p) => {
        if (p.active === false) return false;
        return Number(p.stock ?? p.estoque ?? 0) <= Number(p.minStock ?? p.estoqueMinimo ?? 0);
      }).length
    : 0;

  const badge = document.getElementById('dashNotifBadge');
  if (badge) {
    if (lowCount > 0) {
      badge.textContent = String(lowCount);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function updateDashboardSparklines(hourlyTotals) {
  if (!Array.isArray(hourlyTotals)) return;
  const nowHour = new Date().getHours();

  const cumulative = [];
  let sum = 0;
  for (let h = 0; h <= nowHour; h++) {
    sum += hourlyTotals[h] || 0;
    cumulative.push(sum);
  }

  if (cumulative.length < 2) return;

  const max = Math.max(...cumulative, 0.01);
  const pts = cumulative
    .map((v, i) => {
      const x = ((i / (cumulative.length - 1)) * 120).toFixed(1);
      const y = (30 - (v / max) * 27).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');

  ['sparkGLine', 'sparkBLine', 'sparkPLine', 'sparkYLine'].forEach((id) => {
    document.getElementById(id)?.setAttribute('points', pts);
  });
}

function renderPremiumDashboard() {
  _updateDashboardConnectionBanner();
  renderDashboardSessionInfo();
  renderDashboardFinanceChart();
  renderDashboardPeakChart();
  renderDashboardCashSummary();
  renderDashboardAdvancedMetrics();
  renderDashboardLowStock();
  renderDashboardInsights();
  renderDashboardWeeklyChart();
  renderDashboardMonthlyChart();
  renderDashboardPaymentMethodsChart();
  renderDashboardAbcChart();
  renderDashboardOperatorsChart();
  renderDashboardComparisons();
}

async function applyRealAnalytics(period = 'today') {
  try {
    const data = await getDashboardAnalyticsService(period);
    if (!data) return;

    if (data.revenue  != null) setText('metricSales',            formatBRL(data.revenue));
    if (data.estimatedProfit != null) setText('metricEstimatedProfit', formatBRL(data.estimatedProfit));
    if (data.avgTicket != null) setText('metricAverageTicket',   formatBRL(data.avgTicket));
    if (data.topProduct?.name) {
      setText('metricTopProduct',       data.topProduct.name);
      setText('dashboardTopProductName', data.topProduct.name);
    }
    if (data.salesCount != null) {
      setText('metricSoldItems', String(data.salesCount));
      setText('reportItemsSold', String(data.salesCount));
    }
    if (data.estimatedProfit != null) setText('reportEstimatedProfit', formatBRL(data.estimatedProfit));
    if (data.avgTicket != null)       setText('reportAverageTicket',   formatBRL(data.avgTicket));
    if (data.revenue != null)         setText('reportTotalSales',      formatBRL(data.revenue));
    if (data.peakHour)                setText('reportBestHour',        data.peakHour);
    if (data.topProduct?.name)        setText('reportBestProduct',     data.topProduct.name);
  } catch {
    // Backend analytics unavailable — keep local metrics
  }
}

function _updateDashboardConnectionBanner() {
  const frame = document.querySelector('[data-page-content="dashboard"] .dash-frame');
  if (!frame) return;

  const existing = document.getElementById('dashboardConnectionBanner');
  const noData = state._dataLoaded
    && Array.isArray(state.sales) && state.sales.length === 0
    && Array.isArray(state.products) && state.products.length === 0
    && isBackendReady();

  if (!noData) { existing?.remove(); return; }
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'dashboardConnectionBanner';
  banner.className = 'conn-banner';
  banner.innerHTML = `
    <div class="conn-banner-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 6s4-4 11-4 11 4 11 4"/><path d="M5 10s2.5-2.5 7-2.5 7 2.5 7 2.5"/>
        <path d="M9 14s1-1 3-1 3 1 3 1"/><line x1="12" y1="20" x2="12.01" y2="20"/>
        <line x1="2" y1="2" x2="22" y2="22"/>
      </svg>
    </div>
    <div class="conn-banner-body">
      <strong>Não foi possível carregar os dados agora</strong>
      <span>Verifique sua conexão ou aguarde o servidor acordar e tente novamente.</span>
    </div>
    <button class="btn btn-ghost conn-banner-retry" id="dashboardRetryBtn" type="button">
      Tentar novamente
    </button>
  `;
  frame.insertAdjacentElement('afterbegin', banner);

  document.getElementById('dashboardRetryBtn')?.addEventListener('click', async () => {
    banner.remove();
    state._dataLoaded = false;
    await refreshProtectedAreas();
  });
}

/* ================= CORE HELPERS ================= */

async function runSafe(label, callback, { silent = false } = {}) {
  try {
    return await callback();
  } catch (error) {
    if (!silent) console.error(label, error);
    return null;
  }
}

function bindAction(actionName, handler) {
  document.querySelectorAll(`[data-action="${actionName}"]`).forEach((element) => {
    if (element.dataset.boundAction === actionName) return;

    element.dataset.boundAction = actionName;
    element.addEventListener('click', handler);
  });
}

function extractPlanFromButton(button) {
  return {
    planName: String(button?.dataset?.signupPlan || 'Básico').trim(),
    planPrice: Number(button?.dataset?.signupPrice || 39.9),
    trialDays: Number(button?.dataset?.signupTrial || 15)
  };
}

function focusLoginField() {
  document.getElementById('loginUser')?.focus();
}

function animateAuthCardIn() {
  const card = document.querySelector('.auth-card-minimal');

  if (!card) return;

  card.classList.remove('ui-enter-ready');
  void card.offsetWidth;
  card.classList.add('ui-enter-ready');
}

/* ================= BILLING TOGGLE ================= */

function setupBillingToggle() {
  if (billingToggleBound) return;

  billingToggleBound = true;

  const toggleBtns    = document.querySelectorAll('.plan-toggle-btn[data-billing]');
  const monthlyPrices = document.querySelectorAll('[data-price="monthly"]');
  const yearlyPrices  = document.querySelectorAll('[data-price="yearly"]');
  const yearlyNotes   = document.querySelectorAll('[data-price-note="yearly"]');

  if (!toggleBtns.length) return;

  function applyBilling(type) {
    toggleBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.billing === type);
    });

    if (type === 'yearly') {
      monthlyPrices.forEach((el) => el.classList.add('hidden'));
      yearlyPrices.forEach((el) => el.classList.remove('hidden'));
      yearlyNotes.forEach((el) => el.classList.remove('hidden'));
    } else {
      yearlyPrices.forEach((el) => el.classList.add('hidden'));
      monthlyPrices.forEach((el) => el.classList.remove('hidden'));
      yearlyNotes.forEach((el) => el.classList.add('hidden'));
    }
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => applyBilling(btn.dataset.billing));
  });

  applyBilling('monthly');
}

function bindGlobalHotkeys() {
  // Hotkeys do PDV ficam somente no pdv.js.
}

const DASH_PERIOD_LABELS = { today: 'Hoje ▾', yesterday: 'Ontem ▾', '7days': '7 dias ▾', month: 'Mês ▾' };
const DASH_PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: '7days', label: 'Últimos 7 dias' },
  { value: 'month', label: 'Este mês' }
];

function _buildDashDropdown(btn, currentPeriod, onSelect) {
  document.getElementById('_dashDropdown')?.remove();
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = '_dashDropdown';
  menu.className = 'dash-drop-menu';
  menu.style.setProperty('--drop-top',  (rect.bottom + 4) + 'px');
  menu.style.setProperty('--drop-left', rect.left + 'px');
  DASH_PERIOD_OPTIONS.forEach((opt) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = opt.label;
    item.className = opt.value === currentPeriod ? 'dash-drop-item dash-drop-item--active' : 'dash-drop-item';
    item.addEventListener('click', () => { menu.remove(); onSelect(opt.value, opt.label); });
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  const close = (e) => { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function bindDashboardPeriodFilters() {
  const finBtn = document.getElementById('dashFinanceFilterBtn');
  const peakBtn = document.getElementById('dashPeakFilterBtn');

  if (finBtn && !finBtn.dataset.bound) {
    finBtn.dataset.bound = '1';
    finBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _buildDashDropdown(finBtn, _dashFinancePeriod, (val, label) => {
        _dashFinancePeriod = val;
        finBtn.textContent = `${label} ▾`;
        renderDashboardFinanceChart(val);
      });
    });
  }

  if (peakBtn && !peakBtn.dataset.bound) {
    peakBtn.dataset.bound = '1';
    peakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _buildDashDropdown(peakBtn, _dashPeakPeriod, (val, label) => {
        _dashPeakPeriod = val;
        peakBtn.textContent = `${label} ▾`;
        renderDashboardPeakChart(val);
      });
    });
  }
}

/* ================= ACCESS ================= */

function applyAccessRules() {
  if (!isAuthenticated()) return;

  const currentRole = getCurrentRole();
  const currentPlan = getCurrentPlan();

  if (currentRole === 'desenvolvedora' || currentRole === 'developer_master') {
    runSafe('Erro ao aplicar permissões da desenvolvedora:', () => applyRolePermissions('desenvolvedora'), { silent: true });
    runSafe('Erro ao aplicar permissões de produtos:', () => applyProductPermissions(), { silent: true });
    runSafe('Erro ao aplicar permissões de pagamentos:', () => applyPaymentPermissions('desenvolvedora'), { silent: true });

    applyMenuSecurity();
    return;
  }

  runSafe('Erro ao aplicar permissões do plano:', () => applyPlanPermissions(currentPlan), { silent: true });
  runSafe('Erro ao aplicar permissões do perfil:', () => applyRolePermissions(currentRole), { silent: true });
  runSafe('Erro ao aplicar permissões de produtos:', () => applyProductPermissions(), { silent: true });
  runSafe('Erro ao aplicar permissões de pagamentos:', () => applyPaymentPermissions(currentRole), { silent: true });

  applyMenuSecurity();
}

async function refreshProtectedAreas() {
  if (!isAuthenticated()) return;
  if (!hasValidSavedSession()) return;

  // Carrega cache local de pdvSettings imediatamente (síncrono) — evita race condition
  // Se backend demorar ou falhar, o cache garante que o modo correto é usado
  const _pdvCached = localStorage.getItem('gamby_pdv_settings_cache');
  if (_pdvCached && !state.pdvSettings) {
    try { state.pdvSettings = JSON.parse(_pdvCached); } catch {}
  }

  await runSafe('Erro ao carregar configurações de pagamento:', () => loadPaymentSettings(), { silent: true });
  await runSafe('Erro ao carregar assinatura da empresa:', () => loadCompanySubscriptionService(), { silent: true });

  applyAccessRules();

  await runSafe('Erro ao iniciar usuários internos:', () => initInternalUsers(), { silent: true });
  await runSafe('Erro ao iniciar produtos:', () => initProducts(), { silent: true });
  await runSafe('Erro ao carregar catálogo offline:', () => loadCatalogIntoState(), { silent: true });
  await runSafe('Erro ao carregar alertas de estoque:', () => loadInventoryAlerts(), { silent: true });
  bindInventoryAlertActions();
  await runSafe('Erro ao carregar relatório de validade:', () => loadExpiryReport(), { silent: true });
  bindExpiryReportActions();
  await runSafe('Erro ao carregar vendas:', async () => {
    const sales = await loadSales();
    if (Array.isArray(sales)) state.sales = sales;
  }, { silent: true });
  await runSafe('Erro ao iniciar caixa:', () => initCashSession(), { silent: true });
  runSafe('Erro ao carregar sessões de operador:', () => loadOperatorSessions(), { silent: true });
  await runSafe('Erro ao renderizar financeiro:', () => renderFinance(), { silent: true });
  runSafe('Erro ao vincular filtros financeiros:', () => bindFinanceFilters(), { silent: true });
  runSafe('Erro ao vincular ações de relatórios:', () => bindReportActions(), { silent: true });

  await runSafe('Erro ao iniciar histórico:', () => initHistory(), { silent: true });
  await runSafe('Erro ao iniciar marketplace:', () => initMarketplace(), { silent: true });
  await runSafe('Erro ao iniciar pedidos:', () => initOrders(), { silent: true });
  await runSafe('Erro ao iniciar configurações:', () => initSettings(), { silent: true });
  runSafe('Erro ao iniciar painel analítico:', () => initAnalytics(), { silent: true });
  runSafe('Erro ao iniciar central de inteligência:', () => initBusinessIntelligence(), { silent: true });
  // await obrigatório — showPDVOpenCashChoice lê pdvMode logo após refreshProtectedAreas()
  await runSafe('Erro ao carregar configurações do PDV:', async () => {
    const cfg = await getPdvSettingsService();
    if (cfg) {
      state.pdvSettings = cfg;
      localStorage.setItem('gamby_pdv_settings_cache', JSON.stringify(cfg));
      applyPdvSettings();
    }
  }, { silent: true });
  state.pdvSettingsLoaded = true;
  runSafe('Erro ao iniciar notificações:', () => startNotificationPolling(), { silent: true });
  runSafe('Erro ao vincular painel de notificações:', () => bindNotificationBell(), { silent: true });
  runSafe('Erro ao aplicar personalização:', () => applyPersonalizationOnBoot(), { silent: true });

  runSafe('Erro ao renderizar estoque baixo:', () => renderLowStock(), { silent: true });
  runSafe('Erro ao renderizar sessão de caixa:', () => renderCashSession(), { silent: true });
  runSafe('Erro ao renderizar histórico:', () => renderHistory(), { silent: true });
  runSafe('Erro ao renderizar usuários internos:', () => renderInternalUsers(), { silent: true });
  runSafe('Erro ao renderizar visão geral de usuários:', () => renderUsersOverview(), { silent: true });
  runSafe('Erro ao renderizar marketplace:', () => renderMarketplace(), { silent: true });
  runSafe('Erro ao renderizar configurações:', () => renderSettings(), { silent: true });
  runSafe('Erro ao renderizar autotestes:', () => renderSelfTests(), { silent: true });
  runSafe('Erro ao renderizar status do backend:', () => renderBackendStatus(), { silent: true });
  runSafe('Erro ao renderizar assinatura:', () => renderSubscriptionInfo(), { silent: true });

  state._dataLoaded = true;
  renderPremiumDashboard();
  applyRealAnalytics('today');
}

/* ====== SPA VISIBILITY WATCHDOG ====== */

function repairBlankSpaPage(reason = 'unknown') {
  // Delegate to the Governance Layer — it handles auth check, guards, and audit
  _govRepair(reason);
}

let _pageObserver = null;

function initSpaWatchdog() {
  setTimeout(() => repairBlankSpaPage('50ms'),   50);
  setTimeout(() => repairBlankSpaPage('250ms'),  250);
  setTimeout(() => repairBlankSpaPage('1000ms'), 1000);
  setTimeout(() => repairBlankSpaPage('2000ms'), 2000);

  if (_pageObserver) return;
  _pageObserver = new MutationObserver(() => repairBlankSpaPage('mutation-observer'));
  document.querySelectorAll('[data-page-content]').forEach((page) => {
    _pageObserver.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
}

// FASE 1 — Seleção de perfil pós-login.
// developer_master e contas administrador sem nenhum operador/gerente
// cadastrado pulam a seleção e entram direto (comportamento inalterado).
// Caso contrário, exibe a tela de seleção ANTES do dashboard aparecer;
// handleAuthenticatedEntry() só é chamado quando um perfil é definido
// (evento 'gamby:profile-selected', ouvido em bindAuthActions()).
async function maybeEnterWithProfileSelection({ freshLogin = false } = {}) {
  if (freshLogin) {
    clearActiveProfile();
  } else {
    restoreActiveProfileFromSession();
  }

  // Papéis internos da plataforma NUNCA recebem um perfil simulado — mesmo que
  // sessionStorage tenha um valor restaurado de uma sessão anterior na mesma
  // aba (ex.: troca de conta sem fechar o navegador). Checado antes de confiar
  // em hasActiveProfile() para não aplicar restrições erradas a esses papéis.
  const role = String(state.currentUser?.role || '').toLowerCase();
  const bypassesSelector = ['developer_master', 'platform_admin', 'desenvolvedora'].includes(role);

  if (bypassesSelector) {
    if (hasActiveProfile()) clearActiveProfile();
    await handleAuthenticatedEntry();
    return;
  }

  if (hasActiveProfile()) {
    const profile = state.activeProfile.profile;

    // Mesmo ajuste do listener de 'gamby:profile-selected': ocultar o botão de
    // nav do Dashboard ANTES de handleAuthenticatedEntry() evita que
    // activateDefaultPage() escolha 'dashboard' por padrão neste reload.
    applyProfileMenuVisibility(profile);

    await handleAuthenticatedEntry();
    applyProfileRestrictions(profile);

    // Reload com perfil Operador/Gerente já identificado (PIN confirmado antes
    // do reload) e sem caixa aberto: seguir direto para o modal de valor
    // inicial, igual ao fluxo de primeira seleção — sem isso, o operador cairia
    // na tela de caixa fechado e precisaria clicar manualmente para abrir.
    if ((profile === 'operador' || profile === 'gerente') && !state.cashSession?.isOpen) {
      hideClosedCashScreen();
      await startPDVOpenCashFlow();
    }
    return;
  }

  const shown = await showProfileSelector();
  if (!shown) {
    await handleAuthenticatedEntry();
  }
  // se shown === true, a tela está visível; a entrada prossegue via
  // o listener de 'gamby:profile-selected' registrado em bindAuthActions()
}

async function handleAuthenticatedEntry() {
  // Capturar ANTES de qualquer navigate — repair() sobrescreve localStorage para 'dashboard'
  const _pdvPageBeforeNav = localStorage.getItem('gamby_current_page');

  if (!isAuthenticated()) return;
  if (!hasValidSavedSession()) return;

  if (forcePendingRegistrationFlow()) return;

  hideRegistrationActivationCard();
  toggleRegister(false);

  // New governance session starts with each authenticated entry
  _govAuditResetSession();

  // developer_master: pré-autoriza todos os botões de menu antes de activateDefaultPage()
  // (sem isso, apenas botões .dev-only ficam visíveis durante o layout inicial)
  if (isDeveloperMaster()) {
    applyMenuSecurity();
  }

  await applyAuthenticatedLayout(state.currentUser);

  // ─── Snapshot de diagnóstico do sidebar ────────────────────────────────────
  window._sidebarDebug = {
    classes: document.querySelector('.app-shell')?.className,
    pinned:  localStorage.getItem('gamby_sidebar_pinned'),
  };
  console.log('[SIDEBAR POST-LOGIN]', window._sidebarDebug);

  // ─── platform_admin: Control Center apenas ────────────────────────────────
  // platform_admin não possui company context — não inicializar módulos de cliente
  if (shouldForceControlCenterMode()) {
    document.body.classList.add('cc-platform-mode');
    document.querySelectorAll('.cc-platform-only').forEach(el => el.classList.remove('hidden'));
    setActivePage('control-center');
    initControlCenter();
    _resetSidebarState();
    initSpaWatchdog();
    document.documentElement.classList.remove('has-saved-session');
    document.getElementById('appLoader')?.classList.add('hidden');
    return;
  }

  // ─── developer_master e usuários cliente: inicializa módulos de cliente ─────
  repairBlankSpaPage('post-layout');

  // developer_master sem companyId não chama APIs de cliente (evita cascade 403)
  const skipClientApis = isDeveloperMaster() && !state.currentUser?.companyId;
  if (!skipClientApis) {
    await refreshProtectedAreas();
    repairBlankSpaPage('post-refresh');
  }

  // ── Restaurar operador do PDV após reload ─────────────────────────────────
  // state.currentOperator é in-memory: perdido no reload. Duas fontes possíveis
  // de restauração, ambas via 'gamby_current_operator':
  //   1. PDV real (operator-session.js): só restaura se o caixa ainda estiver
  //      aberto (comportamento original — evita reidentificar sem sessão).
  //   2. Perfil Operador/Gerente simulado (seletor de perfil): o PIN já foi
  //      confirmado antes do reload (state.activeProfile ainda válido, restaurado
  //      de sessionStorage por restoreActiveProfileFromSession() antes desta
  //      função ser chamada) — restaurar mesmo SEM caixa aberto, senão o modal
  //      de identificação de operador reaparece à toa; se não houver caixa
  //      aberto, o fluxo de abertura (startPDVOpenCashFlow) segue normalmente
  //      para o modal de valor inicial, não para identificação.
  const _hasSimulatedOperatorProfile =
    state.activeProfile?.profile === 'operador' || state.activeProfile?.profile === 'gerente';

  if ((_pdvPageBeforeNav === 'pdv' && state.cashSession?.isOpen) || _hasSimulatedOperatorProfile) {
    try {
      const _raw = localStorage.getItem('gamby_current_operator');
      if (_raw) {
        const _op = JSON.parse(_raw);
        if (_op?.name) {
          state.currentOperator = _op;
          state.operatorPinValidated = true;
        }
      }
    } catch {}
  }

  // developer_master: ativa botões de plataforma na sidebar sem ocultar os de cliente
  // usa dev-master-mode (não cc-platform-mode) para não disparar CSS que oculta nav
  // Apenas o botão de nav é desocultado — a seção da página é gerenciada por setActivePage()
  if (isDeveloperMaster()) {
    document.body.classList.add('dev-master-mode');
    const ccNavBtn = document.querySelector('.nav-btn[data-page="control-center"]');
    if (ccNavBtn) ccNavBtn.classList.remove('hidden');
  }

  applySaaSVisualMode();
  repairBlankSpaPage('post-saas');

  // ── PDV Kiosk Reload Restore ───────────────────────────────────────────────
  // _pdvPageBeforeNav foi capturado no início desta função, ANTES de qualquer
  // navigate/repair sobrescrever o localStorage. A sessão JWT já foi revalidada
  // por api.me() acima — não é necessário pedir senha novamente.
  // openPageDirect('pdv') chama enforcePDVKioskMode() internamente.
  // Exclui: forced-PDV-mode (fluxo próprio via showPDVOpenCashChoice abaixo)
  //         e control-center-mode (usuário de plataforma, sem caixa).
  // Um activeProfile explicitamente diferente de 'operador' (seletor de
  // perfil ou "Acesso autorizado" persistindo activeProfile='administrador'
  // num dispositivo cujo JWT real é Operador) é um override deliberado do
  // força-kiosk baseado no papel real — sem isso, um simples reload depois de
  // "Acesso autorizado" bem-sucedido jogava o admin de volta para o PDV aqui
  // (shouldForcePDVMode() só olha o JWT real, nunca soube de activeProfile).
  const _activeProfileOverridesForcedKiosk =
    state.activeProfile && state.activeProfile.profile !== 'operador';

  const _restorePDVKiosk =
    _pdvPageBeforeNav === 'pdv' &&
    !shouldForcePDVMode() &&
    !shouldForceControlCenterMode();

  // Perfil operador simulado (state.activeProfile, definido pelo seletor de perfil
  // ANTES de handleAuthenticatedEntry ser chamado) também deve aterrissar no PDV,
  // mesmo sem shouldForcePDVMode() (que é para operador REAL logado direto, não
  // simulação por um admin/gerente). Sem isso, ensureVisibleActivePage manda para
  // 'dashboard' e só é corrigido depois por applyProfileRestrictions(), causando
  // o flash do dashboard antes do PDV.
  const _isSimulatedOperador = state.activeProfile?.profile === 'operador';

  // BUG CONFIRMADO (F5 em qualquer página não-PDV sempre voltava para o
  // Dashboard): esta checagem só cobria isDeveloperMaster() — para qualquer
  // outro papel (administrador, gerente, desenvolvedora) sem perfil simulado
  // ativo, o código caía direto no branch `else` abaixo, que chama
  // ensureVisibleActivePage(defaultLanding='dashboard'). Isso por si só não
  // seria um problema (ensureVisibleActivePage já consulta gamby_current_page
  // antes de usar o fallback) — o problema real é que, ALGUNS PARÁGRAFOS
  // ACIMA, applyAuthenticatedLayout(state.currentUser) (chamada no início
  // desta função) já tinha executado activateDefaultPage() incondicionalmente,
  // que SEMPRE ativa 'dashboard' (o botão de nav do Dashboard nunca fica
  // oculto para admin/gerente) e GRAVA 'dashboard' em gamby_current_page —
  // sobrescrevendo o valor real da página anterior ('estoque', por exemplo)
  // ANTES de ensureVisibleActivePage() ter a chance de lê-lo. Como
  // ensureVisibleActivePage() também teria feito nada de qualquer forma (o
  // Dashboard já estava 'active' por essa mesma chamada), o valor errado
  // nunca era corrigido. applyProfileRestrictions() (profile-selector.js),
  // que roda DEPOIS desta função e tenta restaurar a página real, lia
  // gamby_current_page já contaminado com 'dashboard' — seu próprio fix
  // (Round 3) nunca tinha chance de funcionar para nenhum papel.
  // _pdvPageBeforeNav foi capturado ANTES de applyAuthenticatedLayout() rodar
  // (comentário no topo da função), preservando o valor real — só faltava
  // usá-lo aqui para TODO papel, não só developer_master.
  const _lastPageToRestore =
    _pdvPageBeforeNav && _pdvPageBeforeNav !== 'pdv' ? _pdvPageBeforeNav : null;

  // Nunca restaurar a página anterior por cima de um pouso forçado em PDV
  // (kiosk real ou perfil Operador simulado) — esses dois casos têm seus
  // próprios fluxos dedicados (mais acima/abaixo) e não devem ser
  // sobrepostos por este restore genérico.
  const _shouldRestoreLastPage =
    _lastPageToRestore &&
    !_isSimulatedOperador &&
    !(shouldForcePDVMode() && !_activeProfileOverridesForcedKiosk);

  if (_restorePDVKiosk) {
    openPageDirect('pdv');
  } else if (_shouldRestoreLastPage) {
    openPageDirect(_lastPageToRestore);
  } else {
    const defaultLanding = ((shouldForcePDVMode() && !_activeProfileOverridesForcedKiosk) || _isSimulatedOperador) ? 'pdv' : 'dashboard';
    ensureVisibleActivePage(defaultLanding);
  }
  repairBlankSpaPage('post-ensure');

  _resetSidebarState();
  initSpaWatchdog();

  // showPDVOpenCashChoice() sempre exige senha admin de novo e reidentifica o
  // operador do zero, por design ("Nenhum bypass por caixa já aberto, sessão
  // anterior ou adminCashOpenAuthorized" — ver comentário na própria função) —
  // correto para o boot real de um dispositivo kiosk PDV dedicado. Mas quando
  // há um activeProfile (seletor de perfil, inclusive para uma conta operador
  // REAL que passou por ele), esse fluxo já é tratado à parte por
  // maybeEnterWithProfileSelection()/o listener de 'gamby:profile-selected'
  // (restaura currentOperator/cashSession e só chama startPDVOpenCashFlow()
  // quando realmente necessário). Sem o !hasActiveProfile() aqui, os dois
  // fluxos competem: showPDVOpenCashChoice() pede senha admin (e, se
  // controlado, identificação) TODA VEZ — inclusive no reload com sessão de
  // caixa já aberta — ignorando o estado que acabou de ser restaurado.
  if (shouldForcePDVMode() && !hasActiveProfile()) showPDVOpenCashChoice();
  initAiWidget();
  document.documentElement.classList.remove('has-saved-session');
  document.getElementById('appLoader')?.classList.add('hidden');
}

/* ================= BIND AUTH ================= */

function bindAuthActions() {
  if (authActionsBound) return;

  authActionsBound = true;

  bindAction('open-register', () => {
    hideRegistrationActivationCard();
    openRegisterModal();
    setTimeout(() => setStage('register'), 50);
  });

  bindAction('close-register', () => {
    toggleRegister(false);
  });

  bindAction('forgot-password', forgotPassword);

  bindAction('login', async () => {
    await login();
    await maybeEnterWithProfileSelection({ freshLogin: true });
  });

  bindProfileSelectorActions();
  window.addEventListener('gamby:profile-selected', async (e) => {
    const profile = e.detail?.profile || state.activeProfile?.profile;

    // Loading overlay cobre a transição inteira (carregamento pesado de
    // refreshProtectedAreas() dentro de handleAuthenticatedEntry, ~vários
    // segundos) — só é removido no fim de handleAuthenticatedEntry(), que já
    // faz isso incondicionalmente. Sem isso, a UI por baixo ficaria visível
    // durante a carga.
    document.getElementById('appLoader')?.classList.remove('hidden');

    // Ocultar o botão de nav do Dashboard (e aplicar o resto da visibilidade
    // do perfil) ANTES de handleAuthenticatedEntry() — ver comentário em
    // applyProfileMenuVisibility(). Sem isso, activateDefaultPage() (chamado
    // dentro de handleAuthenticatedEntry) escolhe 'dashboard' por padrão e o
    // usuário vê o dashboard renderizado antes da correção tardia para 'pdv'.
    applyProfileMenuVisibility(profile);

    await handleAuthenticatedEntry();
    applyProfileRestrictions(profile);

    // Operador/Gerente acabaram de se identificar com PIN — isso já é o
    // início do turno deles, então pula a tela de caixa fechado e abre
    // startPDVOpenCashFlow() direto (mesmo fluxo/gates de sempre: senha
    // admin se requireAuthOpenCash estiver ligado, modal de valor inicial
    // em seguida). Administrador segue para o dashboard normalmente.
    //
    // gamby_just_selected_profile (setada por _confirmPin() em profile-selector.js)
    // distingue esta seleção NOVA de uma restauração de reload — uma sessão
    // de caixa já aberta no backend pode pertencer a outro operador ou a um
    // dia anterior (initCashSession() nunca reseta sessões OPEN por virada de
    // dia), então SEMPRE chamamos startPDVOpenCashFlow() com forceReauth,
    // mesmo com state.cashSession?.isOpen true — ele exige senha admin de
    // novo antes de aceitar/retomar a sessão existente, em vez de herdá-la
    // silenciosamente.
    const _justSelectedProfile = Boolean(sessionStorage.getItem('gamby_just_selected_profile'));
    try { sessionStorage.removeItem('gamby_just_selected_profile'); } catch {}

    if ((profile === 'operador' || profile === 'gerente') && (_justSelectedProfile || !state.cashSession?.isOpen)) {
      hideClosedCashScreen();
      await startPDVOpenCashFlow(false, _justSelectedProfile, _justSelectedProfile ? () => {
        // Cancelar a senha admin aqui volta para o seletor de perfil — a
        // etapa anterior REAL deste caminho (login normal → seletor →
        // Operador/Gerente → PIN). Nunca existiu uma tela de caixa fechado
        // neste caminho (só existe no "Acesso autorizado"), então mostrá-la
        // deixava a pessoa "perdida". Desfaz a identificação recém-feita
        // (PIN/perfil) para que o seletor reabra limpo, e libera o kiosk que
        // applyProfileRestrictions() já tinha aplicado por antecipação.
        releasePDVKioskMode();
        clearOperatorSession();
        clearActiveProfile();
        showProfileSelector();
      } : null);
    }
  });

  bindAction('logout', async () => {
    auditLog('logout', {
      user: state.currentUser || null
    });

    stopNotificationPolling(); // parar polling antes de limpar a sessão

    await logout();

    _govOnLogout(); // clear gov-auth TTL cache + gov-session auth flags
    clearInvalidSession();
    clearTemporaryPageAuthorizations();
    clearActiveProfile();
    document.getElementById('switchProfileBtn')?.classList.add('hidden');

    document.body.classList.remove('pdv-only-mode');

    const appShell = document.querySelector('.app-shell');
    appShell?.classList.remove('pdv-fullscreen');

    applyLoggedOutLayout();
  });

  bindAction('go-verify', async () => {
    await goToEmailVerification();
  });

  bindAction('resend-code', async () => {
    await resendVerificationCode();
  });

  bindAction('confirm-verify', async () => {
    await confirmEmailVerification();
  });

  bindAction('finish-register', async () => {
    await finishRegistration();
    await maybeEnterWithProfileSelection({ freshLogin: true });
  });

  document.querySelectorAll('[data-action="choose-plan"]').forEach((button) => {
    if (button.dataset.boundPlan === 'true') return;

    button.dataset.boundPlan = 'true';

    button.addEventListener('click', () => {
      const { planName, planPrice, trialDays } = extractPlanFromButton(button);
      selectPlan(planName, planPrice, trialDays);
    });
  });

  document.getElementById('viewOtherPlansBtn')?.addEventListener('click', () => {
    showRegistrationActivationCard();
    openRegisterModal();
    setTimeout(() => setStage('plan'), 50);
  });
}

function bindOverlayClose() {
  if (overlayBound) return;

  overlayBound = true;

  document.getElementById('registerOverlay')?.addEventListener('click', (event) => {
    if (event.target?.id === 'registerOverlay') {
      toggleRegister(false);
    }
  });
}

/* ================= INIT MODULES ================= */

async function initializePublicModules() {
  // Fetch plan data from backend (single source of truth for prices)
  initPlansFromAPI().catch(() => {});
  runSafe('Erro ao vincular ações de pagamento:', () => bindPaymentActions(), { silent: true });
  runSafe('Erro ao configurar navegação:', () => setupNavigation(), { silent: true });
  runSafe('Erro ao vincular ações de produtos:', () => bindProductActions(), { silent: true });
  runSafe('Erro ao vincular ações de backup:', () => bindBackupActions(), { silent: true });
  runSafe('Erro ao vincular ações do PDV:', () => bindPDVActions(), { silent: true });
  runSafe('Erro ao vincular ações de caixa:', () => bindCashSessionActions(), { silent: true });
  runSafe('Erro ao vincular ações de usuários:', () => bindUserManagementActions(), { silent: true });
  runSafe('Erro ao vincular ações de marketplace:', () => bindMarketplaceActions(), { silent: true });
  runSafe('Erro ao vincular ações de pedidos:', () => bindOrdersActions(), { silent: true });
  runSafe('Erro ao vincular ações de configurações:', () => bindSettingsActions(), { silent: true });
  runSafe('Erro ao vincular ações do status do backend:', () => bindBackendStatusActions(), { silent: true });
  runSafe('Erro ao vincular ações de assinatura:', () => bindSubscriptionActions(), { silent: true });
  runSafe('Erro ao vincular painel analítico:', () => bindAnalyticsActions(), { silent: true });
  bindInlineReplacementHandlers();

  await runSafe('Erro ao iniciar status do backend:', () => initBackendStatus(), { silent: true });
}

// Substitui todos os handlers inline removidos do index.html (CSP compliance)
function bindInlineReplacementHandlers() {
  // PDV — Sair / Sistema (header button e action grid)
  document.getElementById('pdvExitOptionsBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPDVExitOptions();
  });
  document.getElementById('pdvSystemActionBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPDVExitOptions();
  });

  // Auth — mostrar/ocultar senha
  document.getElementById('loginPassEyeBtn')?.addEventListener('click', () => {
    const input = document.getElementById('loginPass');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Produto — selecionar imagem (preview div e botão)
  document.getElementById('productImagePreview')?.addEventListener('click', () => {
    document.getElementById('productImageInput')?.click();
  });
  document.getElementById('productImageSelectBtn')?.addEventListener('click', () => {
    document.getElementById('productImageInput')?.click();
  });

  // Produto — atualizar margem ao digitar preço/custo
  document.getElementById('productPrice')?.addEventListener('input', () => {
    window.updateProductMargin?.();
  });
  document.getElementById('productCost')?.addEventListener('input', () => {
    window.updateProductMargin?.();
  });
}

async function restoreSessionIfPossible() {
  const restored = await runSafe('Erro ao restaurar sessão:', async () => {
    return await tryRestoreSession();
  });

  if (restored && state.currentUser && hasValidSavedSession()) {
    await maybeEnterWithProfileSelection();
    return;
  }

  const savedSession = getSavedSession();

  if (savedSession?.token && savedSession?.user && !state.currentUser) {
    state.currentUser = savedSession.user;
    state.currentCompany = savedSession.company || null;
    state.subscription = savedSession.subscription || null;

    try {
      await maybeEnterWithProfileSelection();
      return;
    } catch (error) {
      console.warn('Falha ao reidratar sessão salva:', error);
    }
  }

  clearInvalidSession();

  state.currentUser = null;
  state.currentCompany = null;
  state.subscription = null;

  document.getElementById('appLoader')?.classList.add('hidden');
  applyLoggedOutLayout();
}

function bindSalesUpdateListener() {
  if (salesUpdateBound) return;

  salesUpdateBound = true;

  document.addEventListener('gamby:sales-updated', async () => {
    try {
      const sales = await loadSales();
      if (Array.isArray(sales)) {
        state.sales = sales;
      }

      renderFinance?.();
      renderLowStock?.();
      renderCashSession?.();

      renderPremiumDashboard();
    } catch (error) {
      console.error('Erro ao atualizar dashboard após venda:', error);
    }
  });

  document.addEventListener('gamby:cash-opened', () => {
    renderPremiumDashboard();
  });

  document.addEventListener('gamby:cash-closed', () => {
    renderPremiumDashboard();
  });

  // Informativo: resposta de segurança não cadastrada (requireSecurityAnswer retorna true, mas avisa)
  document.addEventListener('gamby:security-no-answer', () => {
    const t = document.createElement('div');
    t.className = 'toast toast-warning';
    t.textContent = 'Nenhuma resposta de segurança foi cadastrada. Configure em Configurações > Segurança.';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-visible'));
    setTimeout(() => { t.classList.remove('is-visible'); setTimeout(() => t.remove(), 300); }, 5000);
  });
}

/* ================= COLLAPSIBLE SIDEBAR ================= */

const _SIDEBAR_PIN_KEY = 'gamby_sidebar_pinned';

// Sidebar bloqueada quando: PDV ativo E (modo controlado OU caixa aberto)
// Usa gamby_current_page (localStorage) + cache de pdvSettings para evitar race conditions
function _isPDVControlledLocked() {
  let _mode = state?.pdvSettings?.pdvMode;
  if (!_mode) {
    try { _mode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.pdvMode; } catch {}
  }
  const _inPDV     = localStorage.getItem('gamby_current_page') === 'pdv'
    || Boolean(document.querySelector('.app-shell.pdv-fullscreen'));
  const _cashOpen  = Boolean(state?.cashSession?.isOpen);
  const _controlled = _mode === 'controlled';
  return _inPDV && (_controlled || _cashOpen);
}

function initCollapsibleSidebar() {
  const shell     = document.querySelector('.app-shell');
  const sidebar   = document.getElementById('appSidebar');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  const hoverZone = document.getElementById('sidebarHoverZone');
  const scrim     = document.getElementById('sidebarScrim');

  console.log('[SIDEBAR INIT]', {
    shell:     !!shell,
    sidebar:   !!sidebar,
    toggleBtn: !!toggleBtn,
    hoverZone: !!hoverZone,
    scrim:     !!scrim,
  });

  if (!shell || !sidebar) {
    console.warn('[SIDEBAR INIT] ABORTADO — shell ou sidebar ausente');
    return;
  }

  const pinned = localStorage.getItem(_SIDEBAR_PIN_KEY) === 'true';
  console.log('[SIDEBAR PIN]', pinned);
  _applySidebarState(shell, sidebar, toggleBtn, pinned);
  console.log('[SIDEBAR CLASSES]', shell.className);

  // Tooltip nativo (title) como reforço de acessibilidade — funciona mesmo se o
  // hover-expand por JS falhar, e não depende de nenhum evento de mouse.
  sidebar.querySelectorAll('.nav-btn').forEach((btn) => {
    const label = btn.querySelector('.nav-label')?.textContent?.trim();
    if (label && !btn.title) btn.title = label;
  });

  let openTimer  = null;
  let closeTimer = null;

  function openSidebar() {
    console.log('[SIDEBAR OPEN]');
    shell.classList.add('sidebar-open');
    console.log('[SIDEBAR CLASSES]', shell.className);
    // Verificar se transform foi aplicado após micro-task
    requestAnimationFrame(() => {
      console.log('[SIDEBAR CSS TRANSFORM]', getComputedStyle(sidebar).transform);
    });
    sidebar.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    console.log('[SIDEBAR CLOSE]');
    shell.classList.remove('sidebar-open');
    console.log('[SIDEBAR CLASSES]', shell.className);
    if (!shell.classList.contains('sidebar-pinned')) {
      sidebar.setAttribute('aria-expanded', 'false');
    }
  }

  function setPinned(value) {
    console.log('[SIDEBAR PIN]', value);
    localStorage.setItem(_SIDEBAR_PIN_KEY, String(value));
    _applySidebarState(shell, sidebar, toggleBtn, value);
    shell.classList.remove('sidebar-open');
    console.log('[SIDEBAR CLASSES]', shell.className);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      // Bloquear completamente quando PDV ativo — sem senha, sem abertura
      if (isPDVActive()) return;
      setPinned(!shell.classList.contains('sidebar-pinned'));
    });
  }

  if (hoverZone) {
    hoverZone.addEventListener('mouseenter', () => {
      if (isPDVActive()) return; // PDV ativo — nenhum hover abre a sidebar
      if (!shell.classList.contains('sidebar-collapsed')) return;
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      openTimer = setTimeout(openSidebar, 250);
    });
    hoverZone.addEventListener('mouseleave', () => {
      clearTimeout(openTimer);
      closeTimer = setTimeout(closeSidebar, 350);
    });
    hoverZone.addEventListener('click', () => {
      if (isPDVActive()) return;
      if (shell.classList.contains('sidebar-collapsed')) openSidebar();
    });
  }

  sidebar.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
  });
  sidebar.addEventListener('mouseleave', () => {
    if (shell.classList.contains('sidebar-collapsed')) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(closeSidebar, 350);
    }
  });

  scrim?.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shell.classList.contains('sidebar-open')) {
      closeSidebar();
    }
  });

  window._sidebarDebug = {
    classes: shell.className,
    pinned:  localStorage.getItem(_SIDEBAR_PIN_KEY),
  };
}

function _applySidebarState(shell, sidebar, toggleBtn, pinned) {
  shell.classList.toggle('sidebar-pinned', pinned);
  shell.classList.toggle('sidebar-collapsed', !pinned);
  sidebar.setAttribute('aria-expanded', String(pinned));
  if (toggleBtn) toggleBtn.title = pinned ? 'Recolher menu' : 'Expandir menu';
}

// Re-aplica o estado do sidebar sem registrar novos listeners.
// Chamado após mudanças de layout (login, troca de modo) para garantir
// que sidebar-collapsed/sidebar-pinned refletem o localStorage atual.
function _resetSidebarState() {
  const shell     = document.querySelector('.app-shell');
  const sidebar   = document.getElementById('appSidebar');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  if (!shell || !sidebar) return;
  const pinned = localStorage.getItem(_SIDEBAR_PIN_KEY) === 'true';
  _applySidebarState(shell, sidebar, toggleBtn, pinned);
  console.log('[SIDEBAR RESET]', shell.className);
}

/* ================= SIDEBAR DIAGNÓSTICO GLOBAL ================= */

// Disponível imediatamente no console — não depende de init() ou login.
// Retorna objeto para aparecer inline no console (não void como console.log).
window._sidebarCheck = function () {
  const sh = document.querySelector('.app-shell');
  const sb = document.getElementById('appSidebar');
  const hz = document.getElementById('sidebarHoverZone');
  const tb = document.getElementById('sidebarToggleBtn');

  const result = {
    shell:         sh?.className ?? 'NOT FOUND',
    hoverZone:     !!hz,
    toggleBtn:     !!tb,
    sidebar:       !!sb,
    transform:     sb ? getComputedStyle(sb).transform : 'N/A',
    pointerEvents: hz ? getComputedStyle(hz).pointerEvents : 'N/A',
    hoverDisplay:  hz ? getComputedStyle(hz).display : 'N/A',
    pinLS:         localStorage.getItem('gamby_sidebar_pinned'),
    pdvLocked:     typeof _isPDVControlledLocked === 'function' ? _isPDVControlledLocked() : 'fn not ready',
    elementsAtLeft: document.elementsFromPoint(7, 300).map(el => ({
      tag:       el.tagName,
      id:        el.id || '',
      className: el.className || '',
    })),
  };

  console.log('[SIDEBAR CHECK]', result);
  return result;
};

/* ================= INIT ================= */

async function init() {
  if (appInitialized) return;

  appInitialized = true;

  // Anti-flash de boot: se há token salvo, ocultar a tela de login e mostrar o
  // loader enquanto api.me() valida a sessão (evita flash de login / dashboard).
  try {
    const _raw = localStorage.getItem('gamby_auth_session_modular');
    if (_raw && JSON.parse(_raw)?.token) {
      document.getElementById('authRoot')?.classList.add('hidden');
      document.getElementById('appLoader')?.classList.remove('hidden');
    }
  } catch {}

  // Remover configurações de URL antigas do localStorage que poderiam sobrescrever
  // o config.js oficial publicado pelo Cloudflare Pages.
  migrateStaleApiUrlConfig();

  // Intercept 402 plan_upgrade_required globally — shows upgrade modal automatically
  interceptPlanErrors();

  bindAuthActions();
  bindOverlayClose();
  bindSecureCashActionModal();
  bindSalesUpdateListener();
  bindGlobalHotkeys();
  bindPageJumpButtons();
  bindDashboardPeriodFilters();
  setupBillingToggle();
  initDashboardClock();
  bindBlockedActions();

  initCollapsibleSidebar();

  animateAuthCardIn();
  focusLoginField();
  bindLoginFieldValidation();
  bindRegisterFieldValidation();

  await initializePublicModules();

  // Limpar caches antigos do Service Worker que podem estar servindo arquivos
  // quebrados. O SW temporário (sw.js) cuida do restante ao se instalar.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'GAMBY_SW_PURGE') {
        window.location.reload();
      }
    });
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
  }
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
  }

  // Registro do SW desativado temporariamente para estabilizar a SPA.
  // Reativar quando o modo offline for retomado com controle adequado de versão.
  // if ('serviceWorker' in navigator) {
  //   window.addEventListener('load', () => {
  //     navigator.serviceWorker.register('/sw.js').catch(() => {});
  //   });
  // }

  await restoreSessionIfPossible();

  // Sync de catálogo usa contexto de empresa — não chamar para platform roles sem company
  if (!isPlatformRole()) {
    initOfflineSync();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // OAuth + support buttons bound here (DOMContentLoaded guaranteed)
  document.getElementById('loginGoogleBtn')?.addEventListener('click', startGoogleOAuth);
  document.getElementById('loginMsBtn')?.addEventListener('click', startMicrosoftOAuth);
  document.getElementById('regGoogleBtn')?.addEventListener('click', startGoogleOAuth);
  document.getElementById('regMsBtn')?.addEventListener('click', startMicrosoftOAuth);
  document.getElementById('loginSupportBtn')?.addEventListener('click', openSupportModal);
  document.getElementById('regSupportBtn')?.addEventListener('click', openSupportModal);
  document.getElementById('supportModalCloseBtn')?.addEventListener('click', closeSupportModal);

  init().catch((error) => {
    console.error('Erro fatal na inicialização do app:', error);
    setMessage('Ocorreu um erro ao iniciar o sistema.', true);
  });
});

window.addEventListener('gamby:auth-expired', () => {
  stopNotificationPolling(); // sessão expirou — parar polling imediatamente
  state.currentUser = null;
  state.currentCompany = null;
  state.subscription = null;

  // BUG CONFIRMADO: este handler limpava a autenticação mas nunca o perfil
  // ativo (state.activeProfile / sessionStorage['gamby_active_profile']) nem
  // o operador identificado — se a sessão expirasse com perfil 'operador'
  // ativo, esse resíduo sobrevivia à expiração (sessionStorage não é limpo
  // por token vencido) e o LOGIN SEGUINTE, na mesma aba, encontrava
  // hasActiveProfile()===true e pulava o seletor de perfil direto para
  // PDV/Operador — mesmo para quem loga de novo como Administrador.
  // clearActiveProfile() também zera currentOperator + storages associados.
  clearActiveProfile();
  releasePDVKioskMode();
  try {
    localStorage.removeItem('gamby_current_page');
    localStorage.removeItem('gamby_last_page');
  } catch {}

  applyLoggedOutLayout();
  setMessage('Sua sessão expirou. Faça login novamente.', true);
});

/* ================= PAGE CONTROL ================= */

function restoreForcedPage() {
  if (shouldForceControlCenterMode()) {
    document.body.classList.add('cc-platform-mode');
    document.querySelectorAll('.cc-platform-only').forEach(el => el.classList.remove('hidden'));
    openPageDirect('control-center');
    return;
  }

  if (shouldForcePDVMode()) {
    showPDVOpenCashChoice();
    return;
  }

  const defaultPage = getDefaultPageForCurrentUser();

  const savedPage =
    localStorage.getItem('gamby_current_page') ||
    localStorage.getItem('gamby_last_page') ||
    defaultPage;

  const page = canAccessPage(savedPage) ? savedPage : defaultPage;

  if (page === 'pdv') {
    showPDVOpenCashChoice();
    return;
  }

  openPageDirect(page);
}

function openPageDirect(pageName) {
  const requestedPage = String(pageName || '').trim().toLowerCase();
  const defaultPage = getDefaultPageForCurrentUser();
  const safePage = canAccessPage(requestedPage) ? requestedPage : defaultPage;

  console.log('[KIOSK-DEBUG] openPageDirect() (original, app.js)', {
    requestedPage, defaultPage, safePage,
    canAccessRequested: canAccessPage(requestedPage),
    activeProfile: state.activeProfile?.profile || null,
  });

  if (!canAccessPage(safePage)) {
    console.log('[KIOSK-DEBUG] denyAccess — safePage também não permitido:', safePage);
    denyAccess(requestedPage);
    return;
  }

  setActivePage(safePage);

  document.querySelectorAll('.nav-btn[data-page]').forEach((btn) => {
    btn.classList.remove('active');
  });

  const targetBtn = document.querySelector(`.nav-btn[data-page="${safePage}"]`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }

  localStorage.setItem('gamby_last_page', safePage);
  localStorage.setItem('gamby_current_page', safePage);

  applySaaSVisualMode();

  // shouldForcePDVMode() usa o papel REAL do JWT do dispositivo (isOperator(),
  // security-policy.js — deliberadamente não ciente de activeProfile, para não
  // travar um administrador simulando Operador em kiosk "de verdade"). Isso
  // criava o problema inverso para "Acesso autorizado": um dispositivo cujo
  // JWT real É operador, mas que acabou de receber activeProfile='administrador'
  // (autorização pontual validada), continuava sendo forçado de volta ao
  // kiosk aqui mesmo depois de navegar para 'dashboard' — o "retorna ao PDV"
  // relatado. Um activeProfile explicitamente diferente de 'operador' é um
  // override deliberado (seletor de perfil ou "Acesso autorizado") e deve
  // suspender o força-kiosk do papel real enquanto estiver ativo.
  const _activeProfileOverridesForcedKiosk =
    state.activeProfile && state.activeProfile.profile !== 'operador';
  console.log('[KIOSK-DEBUG] decisão kiosk:', { safePage, shouldForcePDVMode: shouldForcePDVMode(), _activeProfileOverridesForcedKiosk });
  if (safePage === 'pdv' || (shouldForcePDVMode() && !_activeProfileOverridesForcedKiosk)) {
    console.log('[KIOSK-DEBUG] chamando enforcePDVKioskMode()');
    enforcePDVKioskMode(); // aplica todas as restrições kiosk (CSS + Copilot + flags)

    setTimeout(async () => {
      await initSales();
      // Não roubar foco de um modal aberto (ex.: senha admin ainda pendente
      // logo após navegar para o PDV) — ver mesmo guard em focusPDVInput().
      if (!document.querySelector('.overlay')) {
        document.getElementById('saleProductCode')?.focus();
      }
    }, 80);
  } else {
    console.log('[KIOSK-DEBUG] chamando releasePDVKioskMode()');
    releasePDVKioskMode(); // remove restrições (CSS + recria Copilot)
  }

  if (safePage === 'dashboard')      renderPremiumDashboard();
  if (safePage === 'financeiro')     renderFinance();
  if (safePage === 'historico')      loadHistoryPage();
  if (safePage === 'relatorios')     renderReports();
  if (safePage === 'usuarios')       { renderInternalUsers(); renderUsersOverview(); }
  if (safePage === 'marketplace')    renderMarketplace();
  if (safePage === 'pedidos')        renderOrders();
  if (safePage === 'configuracoes')  renderSettings();
  if (safePage === 'painel-analitico') renderAnalytics();
  if (safePage === 'inteligencia')    onBusinessIntelligenceOpen();
  if (safePage === 'pdv-analytics')   initPDVAnalytics();
  if (safePage === 'control-center')  initControlCenter();
  if (safePage === 'customer-success') initCustomerSuccess();
  if (safePage === 'executive')        initExecutive();
  if (safePage === 'board')            initBoard();
  if (safePage === 'ceo-ai')           initCeoAi();
  if (safePage === 'gamby-ia')         initGambyIa();
  if (safePage === 'suporte') {
    const c = document.getElementById('suportePageContainer');
    if (c) {
      const role = state.session?.role || state.auth?.role;
      renderSuporte(c, {
        userId:    state.session?.userId || state.auth?.userId,
        companyId: state.session?.companyId || state.auth?.companyId,
        userEmail: state.session?.email || state.auth?.email,
        userName:  state.session?.name || state.auth?.name,
        role,
        isDeveloper: role === 'desenvolvedora',
      });
    }
  }
  if (safePage === 'marketing') {
    const c = document.getElementById('marketingPageContainer');
    if (c) {
      const role = state.session?.role || state.auth?.role;
      renderMarketing(c, {
        userId:    state.session?.userId || state.auth?.userId,
        companyId: state.session?.companyId || state.auth?.companyId,
        role,
        isDeveloper: role === 'desenvolvedora',
      });
    }
  }
  if (safePage === 'produtos')       renderProducts();
  if (safePage === 'estoque')        { renderProducts(); renderLowStock(); loadExpiryReport(); }

  // ── Novas páginas SaaS ───────────────────────────────────────────────────
  if (safePage === 'planos') {
    const c = document.getElementById('plansPageContainer');
    if (c) {
      const currentPlan = state.subscription?.planCode || null;
      renderPlansPage(c, {
        currentPlan,
        onCheckout: ({ planCode, billingCycle }) => {
          import('./services/billing-service.js').then(({ createBillingCheckout }) =>
            createBillingCheckout({ planCode, billingCycle, paymentMethod: 'pix' })
              .then(r => { if (r?.checkoutUrl || r?.initPoint) window.location.href = r.checkoutUrl || r.initPoint; })
              .catch(err => alert(err?.message || 'Erro ao iniciar checkout.'))
          );
        }
      });
    }
  }

  if (safePage === 'minha-assinatura') {
    const c = document.getElementById('subscriptionPageContainer');
    if (c) {
      renderMySubscriptionPage(c, {
        onNavigateToPlans: () => openPageDirect('planos')
      });
    }
  }

  if (safePage === 'aprendizado') {
    const c = document.getElementById('learningPageContainer');
    if (c) {
      const role    = state.session?.role || state.auth?.role;
      const isDev   = role === 'desenvolvedora';
      initLearningPage(c, { isDeveloper: isDev, sessionRole: role });
    }
  }

  auditLog('page_opened', {
    page: safePage
  });
}

window.promptOpenCashWhenEnteringPDV = promptOpenCashWhenEnteringPDV;
window.restoreForcedPage = restoreForcedPage;
window.openPageDirect = openPageDirect;
window.__gambyRepairBlankSpaPage = repairBlankSpaPage;
window.__gambySetActivePage = setActivePage;

// Second pass (idempotent): openPageDirect is now defined, so initGovCompat patches it.
// openSecureCashCloseModal was already patched + locked in the first pass above.
initGovCompat();
