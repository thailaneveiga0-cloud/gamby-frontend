import { permissions, getRoleLabel } from './roles.js';

export function setMessage(message, isError = false) {
  const box = document.getElementById('authMessageBox');
  if (!box) return;
  box.textContent = message;
  box.style.borderColor = isError ? 'rgba(255,112,112,.28)' : 'rgba(85,214,141,.28)';
  box.style.background = isError ? 'rgba(255,112,112,.08)' : 'rgba(85,214,141,.08)';
  box.style.color = isError ? '#ffd5d5' : '#d9fff0';
}

export function toggleRegister(show) {
  const overlay = document.getElementById('registerOverlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !show);
  if (!show) setStage('register');
}

export function setStage(stage) {
  const labels = { register: 'Cadastro', verify: 'Verificação por e-mail', plan: 'Escolha do plano', payment: 'Pagamento' };
  document.querySelectorAll('.auth-stage').forEach((el) => el.classList.remove('active'));
  document.getElementById(`stage-${stage}`)?.classList.add('active');
  const stageLabel = document.getElementById('stageLabel');
  if (stageLabel) stageLabel.textContent = labels[stage] || stage;
}

export function applyRoleVisibility(role) {
  const config = permissions[role] || {};
  document.querySelectorAll('.dev-only').forEach((el) => el.classList.toggle('hidden', !config.devOnly));
  document.querySelectorAll('.financial-only').forEach((el) => el.classList.toggle('hidden', !config.financial));
  document.querySelectorAll('.backup-only').forEach((el) => el.classList.toggle('hidden', !config.backup));
  document.querySelectorAll('.product-manage-only').forEach((el) => el.classList.toggle('hidden', !config.backup));
  document.querySelectorAll('.payments-only').forEach((el) => el.classList.toggle('hidden', !config.payments));
  document.querySelectorAll('.admin-or-dev').forEach((el) => el.classList.toggle('hidden', !config.adminOrDev));
  document.querySelectorAll('.marketplace-only').forEach((el) => el.classList.toggle('hidden', !config.marketplace));
  document.querySelectorAll('.settings-only').forEach((el) => el.classList.toggle('hidden', !config.settings));
}

export function applyAuthenticatedLayout(user) {
  document.getElementById('authRoot')?.classList.add('hidden');
  document.getElementById('appRoot')?.classList.remove('hidden');
  document.getElementById('profileBadge').textContent = `Perfil: ${getRoleLabel(user.role)}`;
  document.getElementById('welcomeRole').textContent = `${getRoleLabel(user.role)} conectada`;
  document.getElementById('metricProfile').textContent = getRoleLabel(user.role);
  document.getElementById('sessionStatus').textContent = user.company ? user.company : 'Sessão ativa';
  applyRoleVisibility(user.role);
  activateDefaultPage();
}

export function applyLoggedOutLayout() {
  document.getElementById('appRoot')?.classList.add('hidden');
  document.getElementById('authRoot')?.classList.remove('hidden');
  toggleRegister(false);
}

export function activateDefaultPage() {
  const firstButton = document.querySelector('.nav-btn[data-page="dashboard"]');
  if (!firstButton) return;
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.remove('active'));
  firstButton.classList.add('active');
  document.querySelectorAll('[data-page-content]').forEach((section) => { section.classList.toggle('hidden', section.dataset.pageContent !== 'dashboard'); });
}

export function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('[data-page-content]').forEach((section) => { section.classList.toggle('hidden', section.dataset.pageContent !== page); });
    });
  });
}
