import { permissions, getRoleLabel, normalizeRole } from './roles.js';
import { initDeveloperPanel } from './developer-panel.js';

/* ================= NAVIGATION CALLBACK ================= */
// app.js registers this once so all nav button clicks use the unified engine (openPageDirect)
let _navCallback = null;
export function setNavCallback(fn) { _navCallback = fn; }

/* ================= TOAST ================= */

function showToast(message, type = 'success') {
  if (!message) return;

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* ================= RIPPLE EFFECT ================= */

function applyRippleEffect(element) {
  if (!element || element.dataset.rippleApplied === 'true') return;

  element.dataset.rippleApplied = 'true';

  element.addEventListener('click', () => {
    const circle = document.createElement('span');
    circle.classList.add('ripple');
    element.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  });
}

/* ================= HELPERS ================= */

function blurActiveElement() {
  const active = document.activeElement;
  if (active && typeof active.blur === 'function') {
    active.blur();
  }
}

function showElement(el) {
  if (!el) return;
  el.classList.remove('hidden');
  el.removeAttribute('aria-hidden');
}

function hideElement(el) {
  if (!el) return;
  if (el.contains(document.activeElement)) blurActiveElement();
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
}

function resetRegisterStages() {
  const stages = document.querySelectorAll('.auth-stage');
  stages.forEach((el) => {
    el.classList.remove('active');
    el.classList.remove('fade-in');
  });

  const registerStage = document.getElementById('stage-register');
  if (registerStage) {
    registerStage.classList.add('active');
  }

  const stageLabel = document.getElementById('stageLabel');
  if (stageLabel) {
    stageLabel.textContent = 'Cadastro';
  }
}

function forceBlurIfInside(element) {
  const active = document.activeElement;
  if (element && active && element.contains(active)) {
    active.blur();
  }
}

function closeOverlayElement(element) {
  if (!element) return;

  forceBlurIfInside(element);

  element.classList.add('hidden');
  element.setAttribute('aria-hidden', 'true');
  element.inert = true;
}

function forceCloseAllOverlays() {
  const registerOverlay = document.getElementById('registerOverlay');
  const blockedScreen = document.getElementById('blockedScreen');
  const editUserModal = document.getElementById('editUserModal');
  const secureCashActionOverlay = document.getElementById('secureCashActionOverlay');

  closeOverlayElement(registerOverlay);
  closeOverlayElement(blockedScreen);
  closeOverlayElement(editUserModal);
  closeOverlayElement(secureCashActionOverlay);

  document.body.classList.remove('no-scroll');
}

/* ================= CARD DE ATIVAÇÃO ================= */

export function showRegistrationActivationCard() {
  const wrap = document.getElementById('activationSummaryWrap');
  const side = document.getElementById('signupPaymentSide');
  const finishSection = document.getElementById('finishRegistrationSection');

  if (wrap) wrap.classList.remove('hidden');
  if (side) side.classList.remove('hidden');
  if (finishSection) finishSection.classList.remove('hidden');
}

export function hideRegistrationActivationCard() {
  const wrap = document.getElementById('activationSummaryWrap');
  const side = document.getElementById('signupPaymentSide');
  const finishSection = document.getElementById('finishRegistrationSection');

  if (wrap) wrap.classList.add('hidden');
  if (side) side.classList.add('hidden');
  if (finishSection) finishSection.classList.add('hidden');
}

/* ================= AUTH MESSAGE ================= */

export function setMessage(message, isError = false) {
  const box = document.getElementById('authMessageBox');

  if (box) {
    box.textContent = message || '';
    box.classList.toggle('is-error', isError);
    box.classList.toggle('is-success', !isError && Boolean(message));
  }

  if (message) {
    showToast(message, isError ? 'error' : 'success');
  }
}

/* ================= REGISTER ================= */

export function toggleRegister(show) {
  const overlay = document.getElementById('registerOverlay');
  if (!overlay) return;

  const shouldShow = Boolean(show);

  if (shouldShow) {
    overlay.inert = false;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');

    const firstFocusable =
      overlay.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');

    setTimeout(() => {
      firstFocusable?.focus();
    }, 40);
  } else {
    const active = document.activeElement;
    if (active && overlay.contains(active)) {
      active.blur();
    }

    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    document.body.classList.remove('no-scroll');

    const stages = document.querySelectorAll('.auth-stage');
    stages.forEach((el) => {
      el.classList.remove('active');
      el.classList.remove('fade-in');
    });

    const registerStage = document.getElementById('stage-register');
    if (registerStage) {
      registerStage.classList.add('active');
    }

    const stageLabel = document.getElementById('stageLabel');
    if (stageLabel) {
      stageLabel.textContent = 'Cadastro';
    }
  }
}

/* ================= STAGE ================= */

export function setStage(stage) {
  const labels = {
    register: 'Cadastro',
    verify: 'Verificação por e-mail',
    plan: 'Plano',
    payment: 'Pagamento',
    done: 'Liberação'
  };

  const stages = document.querySelectorAll('.auth-stage');
  if (!stages.length) return;

  stages.forEach((el) => {
    el.classList.remove('active');
    el.classList.remove('fade-in');
  });

  const target = document.getElementById(`stage-${stage}`);

  if (target) {
    requestAnimationFrame(() => {
      target.classList.add('active');
      target.classList.add('fade-in');
    });
  }

  const stageLabel = document.getElementById('stageLabel');
  if (stageLabel) {
    stageLabel.textContent = labels[stage] || stage;
  }

  const progressMap = { register:25, verify:50, plan:75, payment:100 };
  const pct = progressMap[stage] || 25;
  const progressBar = document.querySelector('.reg-progress-bar');
  const progressLabel = document.querySelector('.reg-progress-label');
  if (progressBar) {
    progressBar.classList.remove('progress-w-25','progress-w-50','progress-w-75','progress-w-100');
    progressBar.classList.add(`progress-w-${pct}`);
  }
  if (progressLabel) progressLabel.textContent = pct + '% concluído';

  const stepEls = document.querySelectorAll('.reg-steps-bar .reg-step');
  const stageOrder = ['register','verify','plan','payment'];
  const activeIdx = stageOrder.indexOf(stage);
  stepEls.forEach((el, i) => {
    el.classList.toggle('reg-step-active', i <= activeIdx);
  });

  updateActivationSteps(stage);
}

function updateActivationSteps(stage) {
  const stepPlan = document.getElementById('premiumStepPlan');
  const stepPayment = document.getElementById('premiumStepPayment');
  const stepRelease = document.getElementById('premiumStepRelease');
  const finishBtn = document.getElementById('finishRegistrationBtn');

  [stepPlan, stepPayment, stepRelease].forEach((el) => {
    if (!el) return;
    el.classList.remove('done', 'current');
  });

  if (stepPlan) {
    if (stage === 'plan') {
      stepPlan.classList.add('current');
    } else if (stage === 'payment' || stage === 'done') {
      stepPlan.classList.add('done');
    }
  }

  if (stepPayment) {
    if (stage === 'payment') {
      stepPayment.classList.add('current');
    } else if (stage === 'done') {
      stepPayment.classList.add('done');
    }
  }

  if (stepRelease && stage === 'done') {
    stepRelease.classList.add('current');
  }

  if (finishBtn) {
    if (stage === 'payment' || stage === 'done') {
      finishBtn.classList.remove('hidden');
    } else {
      finishBtn.classList.add('hidden');
    }
  }
}

/* ================= PERMISSÕES ================= */

export function applyRoleVisibility(role) {
  const config = permissions[normalizeRole(role)] || {};

  const map = {
    '.dev-only': config.devOnly,
    '.financial-only': config.financial,
    '.backup-only': config.backup,
    '.product-manage-only': config.productManage,
    '.payments-only': config.payments,
    '.admin-or-dev': config.adminOrDev,
    '.marketplace-only': config.marketplace,
    '.settings-only': config.settings
  };

  Object.entries(map).forEach(([selector, allowed]) => {
    document.querySelectorAll(selector).forEach((el) => {
      // Page sections are managed exclusively by activatePage() — skip them here.
      if (el.hasAttribute('data-page-content')) return;
      el.classList.toggle('hidden', !allowed);
    });
  });

  // ✅ CORRIGIDO: não chama ensureCashNavigation() aqui,
  // pois isso expunha a página de caixa no dashboard.
  // O botão do menu de caixa é gerenciado por app.js separadamente.
}

/* ================= NAVEGAÇÃO ================= */

let developerPanelInitialized = false;

async function ensureDeveloperPanelReady(page) {
  if (page !== 'desenvolvedora') return;
  if (developerPanelInitialized) return;

  try {
    await initDeveloperPanel();
    developerPanelInitialized = true;
  } catch (error) {
    console.error('Erro ao carregar painel desenvolvedora:', error);
  }
}

function handlePageChange(page) {
  const app = document.querySelector('.app-shell');
  if (!app) return;

  app.classList.toggle('pdv-fullscreen', page === 'pdv');
}

// Single atomic source of truth for page section visibility.
// Hides all [data-page-content] sections, shows only the target, queues fade-in.
// Nav button active state is managed separately by callers.
export function setActivePage(pageName = 'dashboard') {
  const pages = [...document.querySelectorAll('[data-page-content]')];
  if (!pages.length) return;

  const target =
    document.querySelector(`[data-page-content="${pageName}"]`) ||
    document.querySelector('[data-page-content="dashboard"]') ||
    pages[0];

  pages.forEach((page) => {
    page.classList.remove('active', 'fade-in');
    page.classList.add('hidden');
    page.setAttribute('aria-hidden', 'true');
  });

  target.classList.remove('hidden');
  target.classList.add('active');
  target.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    if (target.classList.contains('active') && !target.classList.contains('hidden')) {
      target.classList.add('fade-in');
    }
  });

  localStorage.setItem('gamby_current_page', target.dataset.pageContent || pageName);
}

export async function activatePage(page) {
  if (!page) return;

  const targetSection = document.querySelector(`[data-page-content="${page}"]`);
  if (!targetSection) return;

  handlePageChange(page);

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.remove('active');
  });

  const targetButton = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (targetButton && !targetButton.classList.contains('hidden')) {
    targetButton.classList.add('active');
  }

  setActivePage(page);

  const contentArea = document.querySelector('.content-area');
  if (contentArea) contentArea.scrollTo({ top: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, behavior: 'auto' });

  await ensureDeveloperPanelReady(page);

  if (page === 'pdv') {
    setTimeout(() => {
      const input = document.getElementById('saleProductCode');
      input?.focus();
      input?.select?.();
    }, 80);
  }
}

/* ================= SAFETY NET ================= */

export function ensureVisibleActivePage(fallbackPage = 'dashboard') {
  const pages = [...document.querySelectorAll('[data-page-content]')];

  // Use class-only checks — getComputedStyle returns 'none' when a parent is
  // temporarily hidden, causing false negatives and replacing the active page.
  const activeVisible = pages.find(
    (p) => p.classList.contains('active') && !p.classList.contains('hidden')
  );

  if (activeVisible) return;

  const savedPage = localStorage.getItem('gamby_current_page') || fallbackPage;
  const landing =
    document.querySelector(`[data-page-content="${savedPage}"]`) ? savedPage : fallbackPage;

  setActivePage(landing);
}

/* ================= DEFAULT ================= */

export async function activateDefaultPage() {
  const dashboardBtn = document.querySelector('.nav-btn[data-page="dashboard"]');
  const pdvBtn = document.querySelector('.nav-btn[data-page="pdv"]');
  const fallbackBtn = document.querySelector('.nav-btn:not(.hidden)[data-page]');

  let targetPage;
  if (dashboardBtn && !dashboardBtn.classList.contains('hidden')) {
    targetPage = 'dashboard';
  } else if (pdvBtn && !pdvBtn.classList.contains('hidden')) {
    targetPage = 'pdv';
  } else if (fallbackBtn?.dataset?.page) {
    targetPage = fallbackBtn.dataset.page;
  }

  if (!targetPage) return;

  if (_navCallback) {
    _navCallback(targetPage);
  } else {
    await activatePage(targetPage);
  }
}

/* ================= LAYOUT LOGADO ================= */

export async function applyAuthenticatedLayout(user) {
  const authRoot = document.getElementById('authRoot');
  const appRoot = document.getElementById('appRoot');

  forceCloseAllOverlays();

  hideElement(authRoot);
  showElement(appRoot, 'block');

  const roleLabel = getRoleLabel(user?.role);

  const profileBadge = document.getElementById('profileBadge');
  const welcomeRole = document.getElementById('welcomeRole');
  const metricProfile = document.getElementById('metricProfile');
  const sessionStatus = document.getElementById('sessionStatus');

  if (profileBadge) profileBadge.textContent = roleLabel;
  if (welcomeRole) welcomeRole.textContent = `${roleLabel} conectado`;
  if (metricProfile) metricProfile.textContent = roleLabel;

  if (sessionStatus) {
    sessionStatus.textContent =
      user?.company?.tradeName ||
      user?.company?.name ||
      user?.company ||
      'Sessão ativa';
  }

  applyRoleVisibility(user?.role || 'operador');

  // ✅ Garante o botão do menu de caixa acessível (apenas o botão, nunca a página)
  const cashNav = document.querySelector('.nav-btn[data-page="caixa"]');
  if (cashNav) cashNav.classList.remove('hidden');

  await activateDefaultPage();
}

/* ================= LOGOUT ================= */

export function applyLoggedOutLayout() {
  // Encerrar boot-loader: remover classe do <html> para que as regras CSS anti-flash
  // deixem de se aplicar, depois ocultar o loader explicitamente.
  document.documentElement.classList.remove('has-saved-session');
  document.getElementById('appLoader')?.classList.add('hidden');

  const authRoot = document.getElementById('authRoot');
  const appRoot = document.getElementById('appRoot');

  forceCloseAllOverlays();

  showElement(authRoot, 'grid');
  hideElement(appRoot);

  document.querySelectorAll('[data-page-content]').forEach((section) => {
    section.classList.add('hidden');
    section.classList.remove('active', 'fade-in');
    section.setAttribute('aria-hidden', 'true');
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.remove('active');
  });

  developerPanelInitialized = false;
}

/* ================= SETUP ================= */

export function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    applyRippleEffect(btn);

    if (btn.dataset.navBound === 'true') return;
    btn.dataset.navBound = 'true';

    btn.addEventListener('click', () => {
      btn.classList.add('is-pressing');
      setTimeout(() => btn.classList.remove('is-pressing'), 120);
      const page = btn.dataset.page;

      // DIAG — snapshot DOM antes do clique
      if (page && (page === 'customer-success' || page === 'control-center' || page === 'ceo-ai' || page === 'board' || page === 'executive')) {
        const _csEl = document.querySelector('[data-page-content="customer-success"]');
        const _ccEl = document.querySelector('[data-page-content="control-center"]');
        console.group(`%c[DIAG] ▶ CLIQUE no botão "${page}"`, 'color:#e67e22;font-weight:bold;font-size:14px');
        console.log('[DIAG] ANTES — customer-success.className :', _csEl?.className ?? 'NÃO ENCONTRADO');
        console.log('[DIAG] ANTES — control-center.className  :', _ccEl?.className ?? 'NÃO ENCONTRADO');
        console.log('[DIAG] ANTES — window.openPageDirect     :', window.openPageDirect?.name || '(sem nome)');
        console.log('[DIAG] ANTES — window.__gov.openPageDirect:', window.__gov?.openPageDirect?.name || '(sem nome / undefined)');
        console.groupEnd();

        setTimeout(() => {
          const _csEl2 = document.querySelector('[data-page-content="customer-success"]');
          const _ccEl2 = document.querySelector('[data-page-content="control-center"]');
          console.group(`%c[DIAG] ✅ PÓS-CLIQUE 200ms "${page}"`, 'color:#27ae60;font-weight:bold;font-size:14px');
          console.log('[DIAG] APÓS  — customer-success.className :', _csEl2?.className ?? 'NÃO ENCONTRADO');
          console.log('[DIAG] APÓS  — control-center.className  :', _ccEl2?.className ?? 'NÃO ENCONTRADO');
          console.log('[DIAG] APÓS  — localStorage.gamby_current_page:', localStorage.getItem('gamby_current_page'));
          console.groupEnd();
        }, 200);
      }

      if (page && _navCallback) _navCallback(page);
    });
  });
}

// ✅ REMOVIDA: ensureCashNavigation() que manipulava cashPage.classList.remove('hidden')
// causando o bug do controle de caixa aparecer no dashboard.
// A visibilidade da página agora é controlada exclusivamente por activatePage().