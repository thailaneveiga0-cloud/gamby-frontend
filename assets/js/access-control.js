import { getRoleConfig, normalizeRole, resolveAllowedPages } from './roles.js';

export const SUBSCRIPTION_STATES = Object.freeze(['trial', 'active', 'pending_payment', 'past_due', 'expired', 'cancelled', 'blocked', 'suspended']);
export const BLOCKING_SUBSCRIPTION_STATES = Object.freeze(['past_due', 'expired', 'cancelled', 'blocked', 'suspended']);

export function getTenantId(user) {
  return user?.companyId || user?.activeCompanyId || user?.tenant?.id || user?.company?.id || '';
}

export function getSubscriptionStatus(user) {
  const raw = user?.tenant?.subscription?.status || user?.company?.subscription?.status
    || user?.subscription?.status || user?.subscriptionStatus || user?.company?.subscriptionStatus || '';
  return String(raw).trim().toLowerCase();
}

export function validateAccess(user, development = {}) {
  if (!user || !user.username) return denied('user', 'invalid_user', 'Usuário autenticado inválido.');

  const role = normalizeRole(user.role);
  if (!getRoleConfig(role)) return denied('role', 'invalid_role', 'Perfil de acesso inválido.');

  // Desenvolvedora is a platform role, not a customer-tenant role.
  if (role === 'desenvolvedora') return allowed(user, role, '', 'development_bypass');

  const tenantId = getTenantId(user);
  if (!tenantId) return denied('tenant', 'missing_tenant', 'Empresa não identificada para este usuário.');

  const simulatedStatus = development.enabled && development.simulateSubscription ? development.simulatedSubscriptionStatus : '';
  const subscriptionStatus = String(simulatedStatus || getSubscriptionStatus(user)).toLowerCase();
  if (!SUBSCRIPTION_STATES.includes(subscriptionStatus)) {
    return denied('subscription', 'invalid_subscription', 'Não foi possível validar a assinatura da empresa.');
  }
  if (BLOCKING_SUBSCRIPTION_STATES.includes(subscriptionStatus)) {
    return denied('subscription', 'subscription_blocked', 'Sua assinatura está bloqueada. Regularize o pagamento para continuar.', subscriptionStatus);
  }

  const backendPages = user.allowedPages || (Array.isArray(user.permissions) ? user.permissions : user.permissions?.pages);
  const allowedPages = resolveAllowedPages(role, backendPages);
  if (!allowedPages.length) return denied('permissions', 'missing_permissions', 'Nenhuma permissão foi concedida para este perfil.', subscriptionStatus);
  return allowed(user, role, tenantId, 'subscription_valid', subscriptionStatus, allowedPages);
}

function allowed(user, role, tenantId, reason, subscriptionStatus = '', allowedPages = null) {
  const backendPages = user.allowedPages || (Array.isArray(user.permissions) ? user.permissions : user.permissions?.pages);
  return { ok: true, stage: 'complete', reason, user: { ...user, role, companyId: tenantId || user.companyId || '', subscriptionStatus: subscriptionStatus || getSubscriptionStatus(user), allowedPages: allowedPages || resolveAllowedPages(role, backendPages) } };
}

function denied(stage, code, message, subscriptionStatus = '') {
  return { ok: false, stage, code, message, subscriptionStatus };
}
