import { state } from './state.js';
import { getAuditLogs } from './audit-service.js';

/* ================================================================
   user-stats.js — Camada de dados da Central de Usuários
   Zero DOM. Só leitura de state + audit. A UI consome essas funções.
   ================================================================ */

/* ——————————————————————————————————————————————————
   HELPERS INTERNOS
   —————————————————————————————————————————————————— */

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isToday(isoString) {
  return typeof isoString === 'string' && isoString.slice(0, 10) === todayKey();
}

function isSaleCancelled(sale) {
  return (
    sale.status === 'cancelled' ||
    Boolean(sale.cancelled) ||
    Boolean(sale.isCancelled)
  );
}

function getTodaySales() {
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const today = todayKey();
  return sales.filter((s) => (s.createdAt || s.date || '').slice(0, 10) === today);
}

function durationMinutes(startIso, endIso = null) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 60000));
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function gradeFromMetrics(cancellationRate, revenue) {
  if (revenue === 0) return '—';
  if (cancellationRate <= 1.5 && revenue >= 3000) return 'A+';
  if (cancellationRate <= 3 && revenue >= 1500) return 'A';
  if (cancellationRate <= 4 && revenue >= 800) return 'B+';
  if (cancellationRate <= 6) return 'B';
  return 'C';
}

/* ——————————————————————————————————————————————————
   USUÁRIOS — métricas por perfil e totais
   —————————————————————————————————————————————————— */

export function getUsersMetrics() {
  const users = Array.isArray(state.internalUsers) ? state.internalUsers : [];

  const today = todayKey();
  const accessLogs = getAuditLogs({
    actions: ['operator_login_success', 'cash_opened']
  });
  const accessesToday = accessLogs.filter(
    (l) => (l.createdAt || '').slice(0, 10) === today
  ).length;

  return {
    total: users.length,
    operators: users.filter((u) => u.role === 'operador').length,
    managers: users.filter((u) => u.role === 'gerente').length,
    admins: users.filter((u) => u.role === 'administrador').length,
    devs: users.filter((u) => u.role === 'desenvolvedora').length,
    active: users.filter((u) => u.isActive !== false).length,
    blocked: users.filter((u) => u.isActive === false).length,
    accessesToday
  };
}

export function getUsersByRole() {
  const users = Array.isArray(state.internalUsers) ? state.internalUsers : [];
  return {
    operador: users.filter((u) => u.role === 'operador'),
    gerente: users.filter((u) => u.role === 'gerente'),
    administrador: users.filter((u) => u.role === 'administrador'),
    desenvolvedora: users.filter((u) => u.role === 'desenvolvedora')
  };
}

/* ——————————————————————————————————————————————————
   SESSÕES — operador atual e sessions por terminal
   —————————————————————————————————————————————————— */

export function getCurrentOperatorInfo() {
  const op =
    state.currentOperator ||
    state.cashSession?.operator ||
    null;

  if (!op?.name) return null;

  return {
    id: op.id || null,
    name: op.name,
    cpf: op.cpf || '',
    role: op.role || 'operador',
    terminalName:
      op.terminalName || state.cashSession?.terminalName || 'Caixa principal',
    startedAt: op.startedAt || state.cashSession?.openedAt || null,
    onlineMinutes: durationMinutes(op.startedAt || state.cashSession?.openedAt)
  };
}

export function getActiveSessionsByTerminal() {
  const sessions = Array.isArray(state.operatorSessions)
    ? state.operatorSessions.filter(
        (s) => s.status === 'online' || s.status === 'paused'
      )
    : [];

  if (!sessions.length && state.cashSession?.isOpen) {
    const cs = state.cashSession;
    const opName = cs.operatorName || cs.operator?.name || '';
    const stats = opName ? getSalesByOperatorName(opName) : _emptyOperatorStats();
    return [
      {
        id: cs.id || 'local',
        operatorId: cs.operatorId || null,
        operatorName: opName || '—',
        cpf: cs.operatorCpf || '',
        terminalName: cs.terminalName || 'Caixa principal',
        startedAt: cs.openedAt || null,
        status: 'online',
        onlineMinutes: durationMinutes(cs.openedAt),
        salesToday: stats.revenue,
        salesCount: stats.salesCount
      }
    ];
  }

  return sessions.map((s) => {
    const stats = s.operatorName
      ? getSalesByOperatorName(s.operatorName)
      : _emptyOperatorStats();
    return {
      ...s,
      onlineMinutes: durationMinutes(s.startedAt, s.endedAt),
      salesToday: stats.revenue,
      salesCount: stats.salesCount
    };
  });
}

/* ——————————————————————————————————————————————————
   VENDAS — agregação por operador
   —————————————————————————————————————————————————— */

function _emptyOperatorStats() {
  return {
    salesCount: 0,
    revenue: 0,
    avgTicket: 0,
    cancellations: 0,
    cancellationRate: 0,
    itemsCount: 0
  };
}

export function getSalesByOperatorName(operatorName) {
  const sales = getTodaySales().filter(
    (s) => (s.operatorName || '') === operatorName
  );

  if (!sales.length) return _emptyOperatorStats();

  const valid = sales.filter((s) => !isSaleCancelled(s));
  const cancelled = sales.filter(isSaleCancelled);
  const revenue = valid.reduce((a, s) => a + Number(s.total || 0), 0);
  const itemsCount = valid.reduce(
    (a, s) =>
      a +
      (Array.isArray(s.items)
        ? s.items.reduce((b, i) => b + Number(i.quantity || 1), 0)
        : 1),
    0
  );

  return {
    salesCount: valid.length,
    revenue,
    avgTicket: valid.length > 0 ? revenue / valid.length : 0,
    cancellations: cancelled.length,
    cancellationRate:
      sales.length > 0 ? (cancelled.length / sales.length) * 100 : 0,
    itemsCount
  };
}

export function getOperatorRanking() {
  const sales = getTodaySales();
  const map = new Map();

  for (const sale of sales) {
    const name = sale.operatorName || 'Desconhecido';
    if (!map.has(name)) {
      map.set(name, {
        name,
        terminalName: sale.terminalName || '—',
        allSales: []
      });
    }
    const entry = map.get(name);
    entry.allSales.push(sale);
    if (sale.terminalName) entry.terminalName = sale.terminalName;
  }

  const ranking = [];

  for (const [, data] of map.entries()) {
    const valid = data.allSales.filter((s) => !isSaleCancelled(s));
    const cancelled = data.allSales.filter(isSaleCancelled);
    const revenue = valid.reduce((a, s) => a + Number(s.total || 0), 0);
    const avgTicket = valid.length > 0 ? revenue / valid.length : 0;
    const cancellationRate =
      data.allSales.length > 0
        ? (cancelled.length / data.allSales.length) * 100
        : 0;

    const session = (Array.isArray(state.operatorSessions)
      ? state.operatorSessions
      : []
    ).find((s) => s.operatorName === data.name);

    const onlineMinutes = session
      ? durationMinutes(session.startedAt, session.endedAt)
      : state.cashSession?.operatorName === data.name
        ? durationMinutes(state.cashSession.openedAt)
        : 0;

    ranking.push({
      name: data.name,
      terminalName: data.terminalName,
      salesCount: valid.length,
      revenue,
      avgTicket,
      cancellations: cancelled.length,
      cancellationRate,
      onlineMinutes,
      onlineTime: formatDuration(onlineMinutes),
      grade: gradeFromMetrics(cancellationRate, revenue)
    });
  }

  return ranking.sort((a, b) => b.revenue - a.revenue);
}

export function getTopOperator() {
  const ranking = getOperatorRanking();
  return ranking[0] || null;
}

export function getOperatorsNeedingAttention() {
  const ranking = getOperatorRanking();
  const alerts = [];

  for (const op of ranking) {
    if (op.salesCount < 5 && op.onlineMinutes > 60) {
      alerts.push({
        name: op.name,
        terminal: op.terminalName,
        reason: 'Baixo número de vendas hoje',
        value: `${op.salesCount} vendas`,
        type: 'warning'
      });
    } else if (op.cancellationRate > 4) {
      alerts.push({
        name: op.name,
        terminal: op.terminalName,
        reason: 'Alto índice de cancelamentos',
        value: `${op.cancellationRate.toFixed(1)}%`,
        type: 'danger'
      });
    } else if (op.onlineMinutes > 90 && op.salesCount === 0) {
      alerts.push({
        name: op.name,
        terminal: op.terminalName,
        reason: 'Muito tempo sem venda',
        value: formatDuration(op.onlineMinutes),
        type: 'warning'
      });
    }
  }

  return alerts;
}

/* ——————————————————————————————————————————————————
   AUDITORIA — histórico, alertas, ações do dia
   —————————————————————————————————————————————————— */

const ACTION_META = {
  operator_login_success:  { label: 'Início de sessão (PDV)', color: '#4ade80', type: 'success' },
  operator_login_failed:   { label: 'Tentativa de acesso inválida', color: '#f87171', type: 'danger' },
  operator_session_closed: { label: 'Fim de sessão', color: '#60a5fa', type: 'info' },
  operator_switch:         { label: 'Troca de operador', color: '#60a5fa', type: 'info' },
  operator_blocked:        { label: 'Operador bloqueado', color: '#f87171', type: 'danger' },
  cash_opened:             { label: 'Abertura de caixa', color: '#4ade80', type: 'success' },
  cash_closed:             { label: 'Fechamento de caixa', color: '#60a5fa', type: 'info' },
  cash_reopened:           { label: 'Reabertura de caixa', color: '#fbbf24', type: 'warning' },
  sale_cancelled:          { label: 'Cancelamento de venda', color: '#f87171', type: 'danger' },
  sale_approved:           { label: 'Venda aprovada', color: '#4ade80', type: 'success' },
  cash_bleed:              { label: 'Sangria', color: '#fbbf24', type: 'warning' },
  cash_supply:             { label: 'Suprimento', color: '#a78bfa', type: 'info' },
  admin_access:            { label: 'Acesso gerencial', color: '#fbbf24', type: 'warning' }
};

export function formatAuditLog(log) {
  const meta = ACTION_META[log.action] || {
    label: log.action,
    color: '#64748b',
    type: 'info'
  };

  const dt = log.createdAt ? new Date(log.createdAt) : null;
  const time = dt
    ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const dateTime = dt
    ? dt.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—';

  const userName =
    log.operator?.name ||
    log.user?.name ||
    log.details?.operator?.name ||
    log.details?.name ||
    '—';

  const terminal =
    log.terminalName ||
    log.details?.terminalName ||
    log.details?.session?.terminalName ||
    log.details?.operator?.terminalName ||
    '—';

  const details =
    log.details?.message ||
    (log.details?.operatorName && log.details?.terminalName
      ? `${log.details.operatorName} assumiu ${log.details.terminalName}`
      : '') ||
    (log.details?.openingAmount != null
      ? `Valor inicial: R$ ${Number(log.details.openingAmount)
          .toFixed(2)
          .replace('.', ',')}`
      : '') ||
    (log.details?.from && log.details?.to
      ? `${log.details.from} → ${log.details.to}`
      : '') ||
    '';

  return {
    id: log.id,
    action: log.action,
    label: meta.label,
    type: meta.type,
    color: meta.color,
    time,
    dateTime,
    userName,
    terminal,
    details,
    raw: log
  };
}

export function getActionsToday() {
  const logs = getAuditLogs();
  const today = todayKey();
  const todayLogs = logs.filter((l) => (l.createdAt || '').slice(0, 10) === today);

  return {
    openCash: todayLogs.filter((l) => l.action === 'cash_opened').length,
    closeCash: todayLogs.filter((l) => l.action === 'cash_closed').length,
    cancellations: todayLogs.filter((l) => l.action === 'sale_cancelled').length,
    bleeds: todayLogs.filter((l) => l.action === 'cash_bleed').length,
    supplies: todayLogs.filter((l) => l.action === 'cash_supply').length,
    managerAccess: todayLogs.filter((l) => l.action === 'admin_access').length,
    blocks: todayLogs.filter((l) => l.action === 'operator_blocked').length,
    loginFailed: todayLogs.filter((l) => l.action === 'operator_login_failed').length,
    loginSuccess: todayLogs.filter((l) => l.action === 'operator_login_success').length,
    switches: todayLogs.filter((l) => l.action === 'operator_switch').length
  };
}

export function getAuditAlertsToday() {
  const logs = getAuditLogs();
  const today = todayKey();
  const todayLogs = logs.filter((l) => (l.createdAt || '').slice(0, 10) === today);

  const alerts = [];

  const failed = todayLogs.filter((l) => l.action === 'operator_login_failed');
  if (failed.length > 0) {
    const last = failed[0];
    const t = last.createdAt
      ? new Date(last.createdAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';
    alerts.push({
      type: 'danger',
      title: `${failed.length} tentativa(s) de acesso inválido`,
      detail: `${last.details?.name || last.operator?.name || 'Operador desconhecido'} — ${last.terminalName || '—'}`,
      time: t
    });
  }

  const blocked = todayLogs.filter((l) => l.action === 'operator_blocked');
  if (blocked.length > 0) {
    const last = blocked[0];
    const t = last.createdAt
      ? new Date(last.createdAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';
    alerts.push({
      type: 'danger',
      title: `${blocked.length} operador(es) bloqueado(s)`,
      detail: last.details?.operatorName || last.operator?.name || '—',
      time: t
    });
  }

  const cancellations = todayLogs.filter((l) => l.action === 'sale_cancelled');
  if (cancellations.length > 2) {
    const last = cancellations[0];
    const t = last.createdAt
      ? new Date(last.createdAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';
    alerts.push({
      type: 'warning',
      title: `${cancellations.length} cancelamentos hoje`,
      detail: 'Monitorar se excede a média do período',
      time: t
    });
  }

  const attention = getOperatorsNeedingAttention();
  for (const op of attention) {
    alerts.push({
      type: op.type || 'warning',
      title: op.reason,
      detail: `${op.name} — ${op.value}`,
      time: '—'
    });
  }

  return alerts;
}

export function getLastAccesses(limit = 20, filters = {}) {
  const HISTORY_ACTIONS = [
    'operator_login_success',
    'operator_login_failed',
    'operator_session_closed',
    'operator_switch',
    'cash_opened',
    'cash_closed',
    'cash_reopened',
    'sale_cancelled',
    'cash_bleed',
    'cash_supply',
    'admin_access',
    'operator_blocked'
  ];

  const logs = getAuditLogs({
    actions: filters.actions || HISTORY_ACTIONS,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    operatorName: filters.operatorName
  });

  return logs.slice(0, limit).map(formatAuditLog);
}

/* ——————————————————————————————————————————————————
   EXPORT CONVENIENTE — snapshot completo para a UI
   —————————————————————————————————————————————————— */

export function getUserCentralSnapshot() {
  return {
    metrics: getUsersMetrics(),
    activeSessions: getActiveSessionsByTerminal(),
    currentOperator: getCurrentOperatorInfo(),
    ranking: getOperatorRanking(),
    topOperator: getTopOperator(),
    attention: getOperatorsNeedingAttention(),
    actionsToday: getActionsToday(),
    alerts: getAuditAlertsToday(),
    lastAccesses: getLastAccesses(15)
  };
}
