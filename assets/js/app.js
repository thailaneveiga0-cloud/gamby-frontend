import { state } from './state.js';
import { login, logout, openRegisterModal, closeRegisterModal, goToEmailVerification, resendVerificationCode, confirmEmailVerification, selectPlan, finishRegistration, tryRestoreSession } from './auth.js';
import { setupNavigation, toggleRegister, applyAuthenticatedLayout } from './ui.js';
import { initProducts, bindProductActions, applyProductPermissions, renderLowStock } from './products.js';
import { bindBackupActions } from './backup.js';
import { initSales, bindPDVActions } from './pdv.js';
import { initCashSession, bindCashSessionActions, renderCashSession } from './cash-session.js';
import { renderFinance } from './finance.js';
import { renderReports, bindReportActions } from './reports.js';
import { bindPaymentActions, loadPaymentSettings, applyPaymentPermissions } from './payments.js';
import { initHistory, renderHistory } from './history.js';
import { initInternalUsers, bindUserManagementActions, renderInternalUsers } from './user-management.js';
import { initMarketplace, bindMarketplaceActions, renderMarketplace } from './marketplace.js';
import { initSettings, bindSettingsActions, renderSettings, renderSelfTests } from './settings.js';
import { initBackendStatus, bindBackendStatusActions, renderBackendStatus } from './backend-status.js';
import { initDevelopmentConfig, bindDevelopmentConfigActions, renderDevelopmentConfig } from './development-config.js';

async function refreshProtectedAreas() {
  if (!state.currentUser) return;
  applyProductPermissions(state.currentUser.role);
  applyPaymentPermissions(state.currentUser.role);
  renderLowStock();
  renderCashSession();
  await renderFinance();
  renderReports();
  renderHistory();
  renderInternalUsers();
  renderMarketplace();
  renderSettings();
  renderSelfTests();
  renderBackendStatus();
  renderDevelopmentConfig();
}

function bindAuthActions() {
  document.querySelector('[data-action="focus-login"]')?.addEventListener('click', () => document.getElementById('loginUser')?.focus());
  document.querySelectorAll('[data-action="open-register"]').forEach((btn) => btn.addEventListener('click', openRegisterModal));
  document.querySelector('[data-action="close-register"]')?.addEventListener('click', closeRegisterModal);
  document.querySelector('[data-action="login"]')?.addEventListener('click', async () => { if (await login()) await refreshProtectedAreas(); });
  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  document.querySelector('[data-action="go-verify"]')?.addEventListener('click', goToEmailVerification);
  document.querySelector('[data-action="resend-code"]')?.addEventListener('click', resendVerificationCode);
  document.querySelector('[data-action="confirm-verify"]')?.addEventListener('click', confirmEmailVerification);
  document.querySelector('[data-action="finish-register"]')?.addEventListener('click', finishRegistration);
  document.querySelectorAll('[data-plan]').forEach((btn) => btn.addEventListener('click', () => selectPlan(btn.dataset.plan, btn.dataset.price, btn.dataset.trial)));
  document.getElementById('loginPass')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') { event.preventDefault(); if (await login()) await refreshProtectedAreas(); }
  });
}

function bindOverlayClose() {
  document.getElementById('registerOverlay')?.addEventListener('click', (event) => {
    if (event.target.id === 'registerOverlay') toggleRegister(false);
  });
}

async function init() {
  initDevelopmentConfig();
  bindAuthActions(); bindOverlayClose(); bindPaymentActions(); setupNavigation(); bindProductActions(); bindBackupActions(); bindPDVActions(); bindCashSessionActions(); bindReportActions(); bindUserManagementActions(); bindMarketplaceActions(); bindSettingsActions(); bindBackendStatusActions(); bindDevelopmentConfigActions();
  initBackendStatus();
  await loadPaymentSettings();
  await initProducts();
  await initSales();
  await initCashSession();
  initHistory();
  initMarketplace();
  await initSettings();
  await initInternalUsers();
  await renderFinance();
  renderReports();

  const restored = tryRestoreSession();
  if (restored && state.currentUser) await refreshProtectedAreas();
}

init();
