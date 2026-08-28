export const permissions = {
  desenvolvedora: {
    label: 'Desenvolvedora',
    devOnly: true,
    financial: true,
    backup: true,
    productManage: true,
    payments: true,
    adminOrDev: true,
    marketplace: true,
    settings: true,
    users: true,
    reports: true,
    dashboard: true,
    estoque: true,
    pdv: true,
    caixa: true
  },

  administrador: {
    label: 'Administrador',
    devOnly: false,
    financial: true,
    backup: true,
    productManage: true,
    payments: true,
    adminOrDev: true,
    marketplace: true,
    settings: true,
    users: true,
    reports: true,
    dashboard: true,
    estoque: true,
    pdv: true,
    caixa: true
  },

  gerente: {
    label: 'Gerente',
    devOnly: false,
    financial: true,
    backup: false,
    productManage: true,
    payments: true,
    adminOrDev: false,
    marketplace: false,
    settings: false,
    users: false,
    reports: true,
    dashboard: true,
    estoque: true,
    pdv: true,
    caixa: true
  },

  operador: {
    label: 'Operador',
    devOnly: false,
    financial: false,
    backup: false,
    productManage: false,
    payments: false,
    adminOrDev: false,
    marketplace: false,
    settings: false,
    users: false,
    reports: false,
    dashboard: false,
    estoque: false,
    pdv: true,
    caixa: true
  }
};

export function getRoleLabel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return permissions[normalized]?.label || 'Usuário';
}

export function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();

  if (permissions[normalized]) return normalized;

  if (normalized === 'admin') return 'administrador';
  if (normalized === 'admin_master') return 'desenvolvedora';
  if (normalized === 'developer') return 'desenvolvedora';
  if (normalized === 'developer_master') return 'desenvolvedora'; // superset — acesso total
  if (normalized === 'platform_admin') return 'administrador';

  return 'operador';
}

export function isDeveloperRole(role) {
  return normalizeRole(role) === 'desenvolvedora';
}

export function isAdminRole(role) {
  return normalizeRole(role) === 'administrador';
}

export function isManagerRole(role) {
  return normalizeRole(role) === 'gerente';
}

export function isOperatorRole(role) {
  return normalizeRole(role) === 'operador';
}

export function canAuthorizeCriticalAction(role) {
  const normalized = normalizeRole(role);
  return (
    normalized === 'desenvolvedora' ||
    normalized === 'administrador' ||
    normalized === 'gerente'
  );
}

export function can(permission, role) {
  const normalizedRole = normalizeRole(role);
  const config = permissions[normalizedRole];

  if (!config) return false;
  return Boolean(config[permission]);
}