/**
 * gov-access.js — GAMBY PDV Governance Layer: Permission Registry
 *
 * Canonical source of truth for page access and permission rules.
 * Read-only: does NOT modify DOM. Call applyVisibility() to update nav buttons.
 *
 * Replaces scattered access logic in security-policy.js, role-permissions.js,
 * plan-permissions.js.
 */

import { state } from './state.js';

// ─── Role / Plan constants ────────────────────────────────────────────────────

export const ROLES = {
  OPERATOR:         'operador',
  MANAGER:          'gerente',
  ADMIN:            'administrador',
  DEV:              'desenvolvedora',
  DEVELOPER_MASTER: 'developer_master',
  PLATFORM_ADMIN:   'platform_admin',
};

export const PLANS = {
  BASIC:    'basico',
  ECONOMIC: 'economico',
  PRO:      'pro',
};

// ─── Page rules ───────────────────────────────────────────────────────────────

// Pages visible only to internal GAMBY platform roles — never to client accounts
const _PLATFORM_PAGES = new Set([
  'control-center',
  'customer-success',
  'ceo-ai',
  'board',
  'executive',
]);

/**
 * Canonical page rules.
 * roles:     ['*'] = any authenticated role
 * plans:     ['*'] = any plan including basico
 * challenge: security challenge type required before navigation
 * platform:  true = internal GAMBY pages, blocked for all client roles
 */
// Modelo de permissão confirmado (Round 5): Gerente vê exclusivamente
// dashboard, estoque e relatorios — nenhuma outra página. Administrador vê
// tudo que o plano libera, exceto pdv (ver canNavigate() abaixo). Operador
// vê exclusivamente pdv (+ páginas genéricas abertas a todo mundo, roles:['*']).
const _PAGE_RULES = {
  // ── Client pages ──────────────────────────────────────────────────────────
  dashboard:         { roles: ['gerente','administrador','desenvolvedora','developer_master'],      plans: ['economico','pro','economic'] },
  pdv:               { roles: ['operador','administrador','desenvolvedora','developer_master'],     plans: ['*'] },
  caixa:             { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['*'] },
  estoque:           { roles: ['gerente','administrador','desenvolvedora','developer_master'],      plans: ['*'] },
  produtos:          { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['*'] },
  // challenge:'admin-password' removido destas 5 páginas por pedido explícito
  // da usuária (Round 4) — Administrador com Dashboard já liberado não deve
  // reconfirmar senha de novo ao entrar em cada uma. Acesso continua restrito
  // por role/plano normalmente (roles/plans abaixo, inalterados).
  financeiro:        { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  historico:         { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  relatorios:        { roles: ['gerente','administrador','desenvolvedora','developer_master'],      plans: ['economico','pro','economic'] },
  usuarios:          { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['*'] },
  configuracoes:     { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['*'] },
  marketplace:       { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['pro'] },
  'painel-analitico':{ roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  inteligencia:      { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  'pdv-analytics':   { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  marketing:         { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  pedidos:           { roles: ['administrador','desenvolvedora','developer_master'],                plans: ['economico','pro','economic'] },
  suporte:           { roles: ['*'], plans: ['*'] },
  aprendizado:       { roles: ['*'], plans: ['*'] },
  planos:            { roles: ['*'], plans: ['*'] },
  'minha-assinatura':{ roles: ['*'], plans: ['*'] },
  'gamby-ia':        { roles: ['*'], plans: ['*'] },
  desenvolvedor:     { roles: ['desenvolvedora'], plans: ['*'] },
  desenvolvedora:    { roles: ['desenvolvedora'], plans: ['*'] },

  // ── Internal GAMBY platform pages ─────────────────────────────────────────
  'customer-success':{ roles: ['developer_master'], plans: ['*'], platform: true },
  'ceo-ai':          { roles: ['developer_master'], plans: ['*'], platform: true },
  board:             { roles: ['developer_master'], plans: ['*'], platform: true },
  executive:         { roles: ['developer_master'], plans: ['*'], platform: true },
  'control-center':  { roles: ['developer_master','platform_admin'], plans: ['*'], platform: true },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

export function getCurrentRole() {
  // Perfil ativo (tela de seleção pós-login) tem prioridade sobre o papel real do
  // JWT para fins de navegação/menu — ver state.activeProfile em profile-selector.js.
  // Deliberadamente restrito a este módulo: shouldForcePDVMode()/isDeveloperMaster()
  // (security-policy.js) continuam usando o papel real, para não forçar o modo
  // kiosk de PDV sobre um administrador que só está "navegando como" operador.
  const active = _norm(state.activeProfile?.profile ?? '');
  if (active) return active;
  return _norm(state.currentUser?.role ?? ROLES.OPERATOR);
}

export function getCurrentPlan() {
  return _norm(
    state.currentUser?.planCode ||
    state.currentUser?.plan     ||
    state.subscription?.planCode ||
    state.subscription?.plan    ||
    PLANS.BASIC
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the given page may be navigated to.
 * @param {string} page       Page name (e.g. 'financeiro')
 * @param {string} [userRole] Role override (defaults to state.currentUser.role)
 * @param {string} [plan]     Plan override (defaults to current subscription)
 */
export function canNavigate(page, userRole, plan) {
  const p    = _norm(page);
  const role = _norm(userRole ?? getCurrentRole());
  const sub  = _norm(plan    ?? getCurrentPlan());

  if (!p) return false;

  // PDV é visão operacional exclusiva do Operador — Administrador nunca vê o
  // PDV no menu, em nenhuma origem (login normal ou "Acesso autorizado").
  // Antes disso dependia de state.activeProfile.restrictPdv (setado só pelo
  // fluxo "Acesso autorizado"); a partir deste round a regra é incondicional
  // para o role, então nenhuma flag extra é necessária.
  if (p === 'pdv' && role === ROLES.ADMIN) return false;

  // developer_master: unrestricted access (client + platform) except niche-locked pages —
  // niche is a company context constraint, not a role restriction
  if (role === ROLES.DEVELOPER_MASTER) {
    const rule = _PAGE_RULES[p];
    if (rule?.niche && state.currentCompany?.niche !== rule.niche) return false;
    return true;
  }

  // platform_admin: control-center only
  if (role === ROLES.PLATFORM_ADMIN) return p === 'control-center';

  // desenvolvedora: full client access, no platform pages
  if (role === ROLES.DEV) return !_PLATFORM_PAGES.has(p);

  const rule = _PAGE_RULES[p];
  if (!rule) return false;

  // Platform pages always blocked for client roles
  if (rule.platform) return false;

  // Role check
  const roleOk = rule.roles.includes('*') || rule.roles.includes(role);
  if (!roleOk) return false;

  // Niche requirement: page is only available when company niche matches
  if (rule.niche && state.currentCompany?.niche !== rule.niche) return false;

  // Trial users bypass plan restrictions (backend enforces feature limits)
  if (state.subscription?.status === 'trial') return true;

  // Plan check
  return rule.plans.includes('*') || rule.plans.includes(sub);
}

/**
 * Returns the challenge type required for a page, or null if no challenge needed.
 * developer_master and desenvolvedora always bypass.
 *
 * @param {string} page
 * @returns {'admin-password'|null}
 */
export function requiresChallenge(page) {
  const p    = _norm(page);
  const role = getCurrentRole();
  if (role === ROLES.DEVELOPER_MASTER || role === ROLES.DEV) return null;
  return _PAGE_RULES[p]?.challenge ?? null;
}

/**
 * Default landing page for a given role.
 * @param {string} [userRole]
 */
export function getDefaultPage(userRole) {
  const role = _norm(userRole ?? getCurrentRole());
  if (role === ROLES.DEVELOPER_MASTER) return 'dashboard';
  if (role === ROLES.PLATFORM_ADMIN)   return 'control-center';
  if (role === ROLES.OPERATOR)          return 'pdv';
  return 'dashboard';
}

export function isPlatformPage(page) {
  return _PLATFORM_PAGES.has(_norm(page));
}

export function getPlatformPages() {
  return [..._PLATFORM_PAGES];
}

/**
 * Single DOM update point for nav-button visibility.
 * Replaces applyMenuSecurity(), applyRoleVisibility() calls scattered across modules.
 *
 * @param {string} [userRole]
 * @param {string} [plan]
 */
export function applyVisibility(userRole, plan) {
  const role = _norm(userRole ?? getCurrentRole());
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    const page    = _norm(btn.dataset.page);
    const allowed = canNavigate(page, role, plan);
    btn.classList.toggle('hidden', !allowed);
    btn.disabled = !allowed;
    btn.setAttribute('aria-hidden', allowed ? 'false' : 'true');
  });
  document.body.classList.toggle('pdv-only-mode', role === ROLES.OPERATOR);
}
