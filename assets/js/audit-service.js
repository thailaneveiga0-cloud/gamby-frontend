import { state } from './state.js';

const AUDIT_KEY = 'gamby_audit_logs';

export function audit(action, details = {}) {
  const logs = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');

  logs.unshift({
    id: `audit_${Date.now()}`,
    action,
    details,
    user: {
      id: state.currentUser?.id || null,
      name: state.currentUser?.name || '',
      role: state.currentUser?.role || ''
    },
    operator: state.currentOperator || null,
    cashSessionId: state.cashSession?.id || null,
    terminalName: state.cashSession?.terminalName || '',
    companyId: state.currentUser?.companyId || null,
    createdAt: new Date().toISOString()
  });

  localStorage.setItem(AUDIT_KEY, JSON.stringify(logs.slice(0, 1000)));
}

export function getAuditLogs(filters = {}) {
  const all = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');

  if (!filters || !Object.keys(filters).length) return all;

  return all.filter((log) => {
    if (filters.actions && !filters.actions.includes(log.action)) return false;
    if (filters.companyId && log.companyId !== filters.companyId) return false;
    if (filters.dateFrom && log.createdAt < filters.dateFrom) return false;
    if (filters.dateTo && log.createdAt > filters.dateTo) return false;
    if (filters.operatorName) {
      const name = (log.operator?.name || log.user?.name || log.details?.operatorName || '').toLowerCase();
      if (!name.includes(filters.operatorName.toLowerCase())) return false;
    }
    return true;
  });
}

export function clearAuditLogs() {
  localStorage.removeItem(AUDIT_KEY);
}