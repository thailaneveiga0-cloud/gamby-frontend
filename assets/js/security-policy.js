import { state } from './state.js';
import { canNavigate as _govCanNavigate } from './gov-access.js';

/* ================= SECURITY POLICY - GAMBY SAAS ================= */

export const ROLES = {
  OPERATOR: 'operador',
  MANAGER: 'gerente',
  ADMIN: 'administrador',
  DEV: 'desenvolvedora',
  DEVELOPER_MASTER: 'developer_master',
  PLATFORM_ADMIN: 'platform_admin',
};

export const PLANS = {
  BASIC: 'basico',
  ECONOMIC: 'economico',
  PRO: 'pro'
};

const ROLE_ACCESS = {
  operador: ['pdv', 'suporte', 'aprendizado'],

  gerente: [
    'dashboard',
    'estoque',
    'produtos',
    'painel-analitico',
    'inteligencia',
    'pdv-analytics',
    'marketing',
    'pedidos',
    'suporte',
    'aprendizado',
    'planos',
    'minha-assinatura'
  ],

  administrador: [
    'dashboard',
    'caixa',
    'pdv',
    'estoque',
    'produtos',
    'financeiro',
    'historico',
    'painel-analitico',
    'inteligencia',
    'pdv-analytics',
    'marketplace',
    'marketing',
    'pedidos',
    'usuarios',
    'configuracoes',
    'suporte',
    'aprendizado',
    'planos',
    'minha-assinatura'
  ],

  desenvolvedora: ['*']
};

const PLAN_ACCESS = {
  basico: [
    'pdv',
    'caixa',
    'estoque',
    'produtos',
    'suporte',
    'aprendizado',
    'planos',
    'minha-assinatura'
  ],

  economico: [
    'pdv',
    'caixa',
    'estoque',
    'produtos',
    'dashboard',
    'painel-analitico',
    'inteligencia',
    'pdv-analytics',
    'marketing',
    'pedidos',
    'suporte',
    'aprendizado',
    'planos',
    'minha-assinatura'
  ],

  // basic and economic code variants (normalized)
  basic: [
    'pdv', 'caixa', 'estoque', 'produtos', 'suporte',
    'aprendizado', 'planos', 'minha-assinatura'
  ],
  economic: [
    'pdv', 'caixa', 'estoque', 'produtos', 'dashboard',
    'painel-analitico', 'inteligencia', 'pdv-analytics', 'marketing', 'pedidos', 'suporte',
    'aprendizado', 'planos', 'minha-assinatura'
  ],

  pro: ['*']
};

// financeiro/historico/usuarios/configuracoes/marketplace removidos por
// pedido explícito da usuária (Round 4) — mesmo motivo do challenge removido
// de _PAGE_RULES em gov-access.js: Administrador com Dashboard já liberado
// não deve reconfirmar senha/pergunta de segurança de novo ao entrar em cada
// uma. Acesso continua restrito por role/plano normalmente (canAccessPage()).
const SENSITIVE_PAGES = [
  'desenvolvedora'
];

const MANAGER_BLOCKED_ACTIONS = [
  'delete_product',
  'delete_user',
  'change_subscription',
  'access_finance',
  'access_settings',
  'access_users'
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export function getCurrentRole() {
  return normalize(state.currentUser?.role || ROLES.OPERATOR);
}

export function getCurrentPlan() {
  return normalize(
    state.currentUser?.planCode ||
    state.currentUser?.plan ||
    state.subscription?.planCode ||
    state.subscription?.plan ||
    PLANS.BASIC
  );
}

export function isDeveloper() {
  return getCurrentRole() === ROLES.DEV;
}

export function isPlatformRole() {
  const r = getCurrentRole();
  return r === ROLES.DEVELOPER_MASTER || r === ROLES.PLATFORM_ADMIN;
}

export function isDeveloperMaster() {
  return getCurrentRole() === ROLES.DEVELOPER_MASTER;
}

export function isPlatformAdmin() {
  return getCurrentRole() === ROLES.PLATFORM_ADMIN;
}

export function isAdmin() {
  return getCurrentRole() === ROLES.ADMIN;
}

export function isManager() {
  return getCurrentRole() === ROLES.MANAGER;
}

export function isOperator() {
  return getCurrentRole() === ROLES.OPERATOR;
}

export function canAccessByRole(page) {
  const role = getCurrentRole();
  const allowed = ROLE_ACCESS[role] || [];

  if (allowed.includes('*')) return true;
  return allowed.includes(page);
}

export function canAccessByPlan(page) {
  const plan = getCurrentPlan();
  const allowed = PLAN_ACCESS[plan] || [];

  if (allowed.includes('*')) return true;
  return allowed.includes(page);
}

export function canAccessPage(page) {
  // Delegates to the Governance Layer's canonical permission registry.
  // gov-access.canNavigate() is the single source of truth for page access rules.
  return _govCanNavigate(String(page || '').trim().toLowerCase());
}

export function isSensitivePage(page) {
  return SENSITIVE_PAGES.includes(normalize(page));
}

export function canPerformAction(action) {
  const actionName = normalize(action);

  if (isDeveloper()) return true;

  if (isAdmin()) {
    return actionName !== 'access_developer_panel';
  }

  if (isManager()) {
    return !MANAGER_BLOCKED_ACTIONS.includes(actionName);
  }

  if (isOperator()) {
    return [
      'access_pdv',
      'create_sale',
      'print_receipt',
      'request_cancel_sale',
      'request_close_cash'
    ].includes(actionName);
  }

  return false;
}

export function shouldRequireSecurityChallenge(pageOrAction) {
  const value = normalize(pageOrAction);

  if (isDeveloper()) return false;

  if (isSensitivePage(value)) return true;

  return [
    'delete_product',
    'cancel_old_sale',
    'close_cash',
    'open_cash',
    'access_dashboard',
    'access_finance',
    'access_settings',
    'access_users',
    'access_history'
  ].includes(value);
}

export function getCpfPinByRole(cpf, role = getCurrentRole()) {
  const digits = String(cpf || '').replace(/\D/g, '');

  if (!digits) return '';

  const normalizedRole = normalize(role);

  if (normalizedRole === ROLES.MANAGER) {
    return digits.slice(0, 4);
  }

  return digits.slice(-4);
}

export function validateCpfPin(cpf, pin, role = getCurrentRole()) {
  const expected = getCpfPinByRole(cpf, role);
  return Boolean(expected && String(pin || '').trim() === expected);
}

export function getSecurityQuestion() {
  return (
    localStorage.getItem('gamby_security_question') ||
    'Qual é a resposta de segurança cadastrada pelo administrador?'
  );
}

export function getSecurityAnswer() {
  return localStorage.getItem('gamby_security_answer') || '';
}

export function setSecurityQuestionAndAnswer(question, answer) {
  localStorage.setItem('gamby_security_question', String(question || '').trim());
  localStorage.setItem('gamby_security_answer', String(answer || '').trim());
}

export function validateSecurityAnswer(answer) {
  const expected = getSecurityAnswer();

  if (!expected) {
    return false;
  }

  return normalize(answer) === normalize(expected);
}

export function getDefaultPageForCurrentUser() {
  if (isDeveloperMaster()) return 'dashboard';
  if (isPlatformAdmin()) return 'control-center';
  if (isOperator()) return 'pdv';
  if (isManager()) return 'dashboard';
  if (isAdmin()) return 'dashboard';
  if (isDeveloper()) return 'dashboard';

  return 'pdv';
}

export function shouldForcePDVMode() {
  return isOperator();
}

export function shouldForceControlCenterMode() {
  return isPlatformAdmin(); // developer_master tem acesso total, não é forçado ao CC
}

export function applyMenuSecurity() {
  const buttons = document.querySelectorAll('.nav-btn[data-page]');

  buttons.forEach((button) => {
    const page = normalize(button.dataset.page);
    const allowed = canAccessPage(page);

    button.classList.toggle('hidden', !allowed);
    button.disabled = !allowed;
    button.setAttribute('aria-hidden', allowed ? 'false' : 'true');
  });

  document.body.classList.toggle('pdv-only-mode', shouldForcePDVMode());
}

export function auditLog(action, details = {}) {
  const key = 'gamby_audit_logs';

  const logs = JSON.parse(localStorage.getItem(key) || '[]');

  logs.unshift({
    id: `audit_${Date.now()}`,
    action,
    details,
    user: {
      id: state.currentUser?.id || null,
      name: state.currentUser?.name || '',
      role: state.currentUser?.role || ''
    },
    companyId: state.currentUser?.companyId || null,
    createdAt: new Date().toISOString()
  });

  localStorage.setItem(key, JSON.stringify(logs.slice(0, 500)));
}

export function requireSecurityAnswer() {
  // Developers bypass via JWT-backed role — no hardcoded password needed.
  // Backend validates all sensitive actions regardless of this frontend check.
  if (isDeveloper()) {
    auditLog('developer_role_bypass');
    return true;
  }

  if (localStorage.getItem('gamby_security_required') === 'false') return true;

  // Se nenhuma resposta foi cadastrada, não bloquear — apenas informar via evento
  const storedAnswer = getSecurityAnswer();
  if (!storedAnswer) {
    document.dispatchEvent(new CustomEvent('gamby:security-no-answer'));
    return true;
  }

  const question = getSecurityQuestion();
  const answer = window.prompt(question);

  if (answer === null) return false;

  const ok = validateSecurityAnswer(answer);

  if (!ok) {
    alert('Resposta de segurança incorreta.');
    auditLog('security_answer_failed');
    return false;
  }

  auditLog('security_answer_success');
  return true;
}

export function requireManagerOrAdminPassword(callback) {
  if (isDeveloper()) {
    callback?.();
    return;
  }

  if (typeof window.openSecureCashCloseModal !== 'function') {
    alert('Validação de senha indisponível.');
    return;
  }

  window.openSecureCashCloseModal(async () => {
    auditLog('secure_password_success');
    callback?.();
  });
}