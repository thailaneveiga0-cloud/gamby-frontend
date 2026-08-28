import { state } from './state.js';
import { normalizeRole, isOperatorRole } from './roles.js';

function hideElements(selectors = []) {
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.hasAttribute('data-page-content')) return;
      el.classList.add('hidden');
    });
  });
}

function removeFromDom(selectors = []) {
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.hasAttribute('data-page-content')) return;
      el.remove();
    });
  });
}

function showElements(selectors = []) {
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.hasAttribute('data-page-content')) return;
      el.classList.remove('hidden');
    });
  });
}

export function applyRolePermissions(role = state.currentUser?.role) {
  const normalized = normalizeRole(role);

  // Only target nav buttons ([data-page="X"]), never page sections ([data-page-content="X"]).
  // Page section visibility is managed exclusively by activatePage() / openPageDirect().
  const restrictedNavSelectors = [
    '[data-page="dashboard"]',
    '[data-page="financeiro"]',
    '[data-page="historico"]',
    '[data-page="relatorios"]',
    '[data-page="estoque"]',
    '[data-page="produtos"]',
    '[data-page="usuarios"]',
    '[data-page="marketplace"]',
    '[data-page="configuracoes"]',
    '[data-page="pdv-analytics"]',
  ];

  if (isOperatorRole(normalized)) {
    hideElements(['.dev-only']);
    hideElements(restrictedNavSelectors);

    showElements([
      '[data-page="pdv"]',
      '[data-page="caixa"]',
    ]);

    const sidebar = document.querySelector('.sidebar');
    sidebar?.classList.add('hidden');

    const topActions = document.querySelector('.top-actions');
    topActions?.classList.remove('hidden');

    // Não chama activatePage() aqui — handleAuthenticatedEntry() gerencia
    // a navegação inicial via showPDVOpenCashChoice(). Chamar activatePage
    // neste módulo cria race condition com o requestAnimationFrame de
    // activatePage('dashboard') já agendado, deixando dashboard com
    // classe "fade-in hidden" e sem "active".
    return;
  }

  showElements([
    '[data-page="dashboard"]',
    '[data-page="financeiro"]',
    '[data-page="historico"]',
    '[data-page="relatorios"]',
    '[data-page="estoque"]',
    '[data-page="produtos"]',
    '[data-page="usuarios"]',
    '[data-page="marketplace"]',
    '[data-page="configuracoes"]',
    '[data-page="pdv"]',
    '[data-page="caixa"]',
    '[data-page="pdv-analytics"]',
  ]);

  document.querySelector('.sidebar')?.classList.remove('hidden');

  if (normalized === 'gerente') {
    hideElements(['.dev-only']);
    hideElements(['.backup-only', '.marketplace-only', '.settings-only']);
  }

  if (normalized === 'administrador') {
    hideElements(['.dev-only']);
  }

  if (normalized === 'desenvolvedora') {
    showElements(['.dev-only', '.backup-only', '.marketplace-only', '.settings-only']);
  }
}