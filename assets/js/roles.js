export const permissions = {
  desenvolvedora: {
    label: 'Desenvolvedora',
    devOnly: true,
    adminOrDev: true,
    financial: true,
    backup: true,
    payments: true,
    globalAccess: true,
    manageUsers: true,
    marketplace: true,
    settings: true
  },
  administrador: {
    label: 'Administradora',
    devOnly: false,
    adminOrDev: true,
    financial: true,
    backup: true,
    payments: false,
    globalAccess: false,
    manageUsers: true,
    marketplace: true,
    settings: true
  },
  operador: {
    label: 'Operador',
    devOnly: false,
    adminOrDev: false,
    financial: false,
    backup: false,
    payments: false,
    globalAccess: false,
    manageUsers: false,
    marketplace: false,
    settings: false
  }
};

export function getRoleLabel(role) {
  return permissions[role]?.label || role;
}


export function can(role, permission) {
  return Boolean(permissions[role]?.[permission]);
}

export function isManagementRole(role) {
  return role === 'desenvolvedora' || role === 'administrador';
}
