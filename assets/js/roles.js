export const ROLE_NAMES = Object.freeze(['desenvolvedora', 'administrador', 'gerente', 'operador']);

export const permissions = Object.freeze({
  desenvolvedora: {
    label: 'Desenvolvedora', devOnly: true, adminOrDev: true, financial: true, backup: true,
    payments: true, globalAccess: true, manageUsers: true, marketplace: true, settings: true,
    pages: ['dashboard', 'produtos', 'pdv', 'financeiro', 'historico', 'relatorios', 'marketplace', 'usuarios', 'configuracoes', 'desenvolvedora']
  },
  administrador: {
    label: 'Administrador', devOnly: false, adminOrDev: true, financial: true, backup: true,
    payments: false, globalAccess: false, manageUsers: true, marketplace: true, settings: true,
    pages: ['dashboard', 'produtos', 'pdv', 'financeiro', 'historico', 'relatorios', 'marketplace', 'usuarios', 'configuracoes']
  },
  gerente: {
    label: 'Gerente', devOnly: false, adminOrDev: false, financial: true, backup: false,
    payments: false, globalAccess: false, manageUsers: false, marketplace: false, settings: false,
    pages: ['dashboard', 'produtos', 'pdv', 'financeiro', 'historico', 'relatorios']
  },
  operador: {
    label: 'Operador', devOnly: false, adminOrDev: false, financial: false, backup: false,
    payments: false, globalAccess: false, manageUsers: false, marketplace: false, settings: false,
    pages: ['pdv']
  }
});

export function normalizeRole(role = '') {
  const value = String(role).trim().toLowerCase();
  const aliases = { developer: 'desenvolvedora', desenvolvedor: 'desenvolvedora', admin: 'administrador', manager: 'gerente', operator: 'operador' };
  return aliases[value] || value;
}

export function getRoleConfig(role) { return permissions[normalizeRole(role)] || null; }
export function getRoleLabel(role) { return getRoleConfig(role)?.label || role; }
export function can(role, permission) { return Boolean(getRoleConfig(role)?.[permission]); }

export function resolveAllowedPages(role, backendPages) {
  const normalizedRole = normalizeRole(role);
  const localCeiling = getRoleConfig(normalizedRole)?.pages || [];
  if (normalizedRole === 'desenvolvedora') return [...localCeiling];
  if (normalizedRole === 'operador') return ['pdv'];
  if (!Array.isArray(backendPages)) return [...localCeiling];
  return backendPages.filter((page) => localCeiling.includes(page));
}

export function isManagementRole(role) {
  return ['desenvolvedora', 'administrador', 'gerente'].includes(normalizeRole(role));
}
