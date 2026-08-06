import { state } from './state.js';
import { KEYS, load, save, remove } from './storage.js';
import { renderFinance, getFinanceSummary } from './finance.js';
import { renderReports, printDailyReport } from './reports.js';
import { formatCurrency, formatDateTimeBR, toNumber } from './utils.js';
import { addHistory } from './history.js';
import { getCurrentCashSessionService, openCashSessionService, closeCashSessionService } from './services/cash-service.js';

function sessionDurationText(startIso) {
  if (!startIso) return '—';
  const diffMs = Date.now() - new Date(startIso).getTime();
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}min`;
}

function mapCashSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    isOpen: session.status === 'open' || session.isOpen,
    openingAmount: Number(session.openingAmount || 0),
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    closingAmount: Number(session.closingAmount || 0)
  };
}

export async function initCashSession() {
  const local = load(KEYS.cashSession, null);
  state.cashSession = local;
  try {
    const current = await getCurrentCashSessionService();
    if (current) {
      state.cashSession = mapCashSession(current);
      save(KEYS.cashSession, state.cashSession);
    }
  } catch {
    /* fallback local */
  }
  renderCashSession();
}

export async function openCashSession() {
  if (state.cashSession?.isOpen) return alert('Já existe um caixa aberto.');
  const value = Math.max(0, toNumber(document.getElementById('openingAmount')?.value));
  let session = { isOpen: true, openingAmount: value, openedAt: new Date().toISOString() };
  try {
    const payload = await openCashSessionService({ openingAmount: value, notes: 'Abertura do expediente' });
    if (payload) session = mapCashSession(payload);
  } catch {
    /* fallback local */
  }
  state.cashSession = session;
  save(KEYS.cashSession, state.cashSession);
  addHistory('Caixa', 'Caixa aberto', value);
  renderCashSession(); renderFinance(); renderReports();
}

export async function closeCashSession() {
  if (!state.cashSession?.isOpen) return alert('Nenhum caixa aberto no momento.');
  const summary = getFinanceSummary();
  const closedAt = new Date().toISOString();
  let session = { ...state.cashSession, isOpen: false, closedAt, closingAmount: summary.currentBalance };
  try {
    const payload = await closeCashSessionService(state.cashSession.id, { closingAmount: summary.currentBalance, notes: 'Fechamento normal' });
    if (payload) session = mapCashSession(payload);
  } catch {
    /* fallback local */
  }
  state.cashSession = session;
  save(KEYS.cashSession, state.cashSession);
  addHistory('Caixa', 'Caixa fechado', summary.currentBalance);
  renderCashSession(); renderFinance(); renderReports();
  printDailyReport();
}

export function resetCashSession() {
  if (state.cashSession?.isOpen && !window.confirm('O caixa ainda está aberto. Deseja realmente resetar a sessão?')) return;
  state.cashSession = null; remove(KEYS.cashSession); renderCashSession(); renderFinance(); renderReports();
}

export function renderCashSession() {
  const box = document.getElementById('cashSessionBox');
  const openBtn = document.getElementById('openCashBtn');
  const closeBtn = document.getElementById('closeCashBtn');
  if (!box) return;
  const session = state.cashSession;
  box.innerHTML = !session ? `
    <div class="panel metric-card"><span class="mini">Status do caixa</span><strong>Fechado</strong><p class="mini">Abra o caixa para iniciar as vendas do dia.</p></div>
  ` : `
    <div class="dashboard-grid">
      <article class="panel metric-card"><span class="mini">Status</span><strong>${session.isOpen ? 'Aberto' : 'Fechado'}</strong></article>
      <article class="panel metric-card"><span class="mini">Abertura</span><strong>${formatCurrency(session.openingAmount || 0)}</strong></article>
      <article class="panel metric-card"><span class="mini">Início</span><strong>${formatDateTimeBR(session.openedAt)}</strong></article>
      <article class="panel metric-card"><span class="mini">Expediente</span><strong>${session.isOpen ? sessionDurationText(session.openedAt) : 'Encerrado'}</strong></article>
      <article class="panel metric-card"><span class="mini">Fechamento</span><strong>${session.closedAt ? formatDateTimeBR(session.closedAt) : '—'}</strong></article>
      <article class="panel metric-card"><span class="mini">Saldo final</span><strong>${session.closedAt ? formatCurrency(session.closingAmount || 0) : '—'}</strong></article>
    </div>
  `;
  if (openBtn) openBtn.disabled = !!session?.isOpen;
  if (closeBtn) closeBtn.disabled = !session?.isOpen;
}

export function bindCashSessionActions() {
  document.getElementById('openCashBtn')?.addEventListener('click', () => openCashSession());
  document.getElementById('closeCashBtn')?.addEventListener('click', () => closeCashSession());
  document.getElementById('resetCashBtn')?.addEventListener('click', resetCashSession);
  setInterval(() => { if (state.cashSession?.isOpen) renderCashSession(); }, 60000);
}
