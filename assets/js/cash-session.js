import { state } from './state.js';
import { KEYS, load, save, remove } from './storage.js';
import { renderFinance, getFinanceSummary } from './finance.js';
import { renderReports, printDailyReport } from './reports.js';
import { formatCurrency, formatDateTimeBR, toNumber } from './utils.js';
import { addHistory } from './history.js';
import { isBackendReady } from './backend-config.js';
import { getCurrentCashSessionService, openCashSessionService, closeCashSessionService } from './services/cash-service.js';

function sessionDurationText(startIso) {
  if (!startIso) return '—';
  const diffMs = Date.now() - new Date(startIso).getTime();
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}min`;
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapCashSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    isOpen: session.status === 'open' || session.isOpen,
    openingAmount: Number(session.openingAmount || 0),
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    closingAmount: Number(session.closingAmount || 0),
    // Calculados no servidor no fechamento (cash.controller.js) — null
    // enquanto o caixa está aberto ou se o backend não estiver configurado.
    expectedAmount: nullableNumber(session.expectedAmount),
    countedAmount: nullableNumber(session.countedAmount),
    difference: nullableNumber(session.difference)
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
    /* leitura: cai pro estado local já carregado acima, não é a operação
       de escrita que este arquivo precisa proteger */
  }
  renderCashSession();
}

export async function openCashSession() {
  if (state.cashSession?.isOpen) return alert('Já existe um caixa aberto.');
  const value = Math.max(0, toNumber(document.getElementById('openingAmount')?.value));

  if (!isBackendReady()) {
    // Modo local explícito (instalação sem backend configurado) — não é uma
    // falha de rede, é o modo de operação atual; mantém o comportamento
    // local já existente para esse caso.
    const session = { isOpen: true, openingAmount: value, openedAt: new Date().toISOString() };
    state.cashSession = session;
    save(KEYS.cashSession, session);
    addHistory('Caixa', 'Caixa aberto', value);
    renderCashSession(); renderFinance(); renderReports();
    const openInput = document.getElementById('openingAmount');
    if (openInput) openInput.value = '';
    return;
  }

  let payload;
  try {
    payload = await openCashSessionService({ openingAmount: value, notes: 'Abertura do expediente' });
  } catch (err) {
    alert(`Não foi possível abrir o caixa: ${err?.message || 'erro ao contatar o servidor.'}`);
    await initCashSession();
    return;
  }

  const session = mapCashSession(payload);
  state.cashSession = session;
  save(KEYS.cashSession, session);
  addHistory('Caixa', 'Caixa aberto', value);
  renderCashSession(); renderFinance(); renderReports();
  const openInput = document.getElementById('openingAmount');
  if (openInput) openInput.value = '';
}

export async function closeCashSession() {
  if (!state.cashSession?.isOpen) return alert('Nenhum caixa aberto no momento.');
  const summary = getFinanceSummary();
  const countedInput = document.getElementById('countedAmount')?.value;
  const countedAmount = countedInput === '' || countedInput === undefined ? null : Math.max(0, toNumber(countedInput));

  if (!isBackendReady()) {
    // Modo local explícito — sem backend não há como calcular o esperado
    // no servidor; mantém o comportamento local já existente.
    const closedAt = new Date().toISOString();
    const session = { ...state.cashSession, isOpen: false, closedAt, closingAmount: summary.currentBalance, countedAmount, expectedAmount: null, difference: null };
    state.cashSession = session;
    save(KEYS.cashSession, session);
    addHistory('Caixa', 'Caixa fechado', summary.currentBalance);
    renderCashSession(); renderFinance(); renderReports();
    printDailyReport();
    const countedInputEl = document.getElementById('countedAmount');
    if (countedInputEl) countedInputEl.value = '';
    return;
  }

  let payload;
  try {
    payload = await closeCashSessionService(state.cashSession.id, {
      closingAmount: summary.currentBalance,
      countedAmount,
      notes: 'Fechamento normal'
    });
  } catch (err) {
    // O backend ainda considera o caixa aberto — nunca fechar a sessão na
    // tela sem confirmação real do servidor. Revalida antes de nova tentativa.
    alert(`Não foi possível fechar o caixa: ${err?.message || 'erro ao contatar o servidor.'}`);
    await initCashSession();
    return;
  }

  const session = mapCashSession(payload);
  state.cashSession = session;
  save(KEYS.cashSession, session);
  addHistory('Caixa', 'Caixa fechado', summary.currentBalance);
  renderCashSession(); renderFinance(); renderReports();
  printDailyReport();
  const countedInputEl = document.getElementById('countedAmount');
  if (countedInputEl) countedInputEl.value = '';
}

function renderCashCloseResult(session) {
  const box = document.getElementById('cashCloseResultBox');
  if (!box) return;

  if (!session || session.isOpen) {
    box.innerHTML = '';
    return;
  }

  if (session.expectedAmount === null) {
    // Sessão fechada sem passar pelo cálculo do servidor (ex: modo local
    // sem backend) — não há o que comparar.
    box.innerHTML = '';
    return;
  }

  if (session.countedAmount === null) {
    box.innerHTML = `<div class="panel metric-card"><span class="mini">Conferência do caixa</span><p class="mini">Esperado (servidor): ${formatCurrency(session.expectedAmount)} — nenhum valor contado foi informado neste fechamento.</p></div>`;
    return;
  }

  const diff = session.difference ?? (session.countedAmount - session.expectedAmount);
  const isEven = Math.abs(diff) < 0.005;
  const label = isEven ? 'Confere' : (diff > 0 ? 'Sobra' : 'Falta');
  const tone = isEven ? 'tag-success' : 'tag-danger';

  box.innerHTML = `
    <div class="dashboard-grid">
      <article class="panel metric-card"><span class="mini">Esperado (servidor)</span><strong>${formatCurrency(session.expectedAmount)}</strong></article>
      <article class="panel metric-card"><span class="mini">Contado</span><strong>${formatCurrency(session.countedAmount)}</strong></article>
      <article class="panel metric-card"><span class="mini">Diferença</span><strong class="tag ${tone}">${label}: ${formatCurrency(Math.abs(diff))}</strong></article>
    </div>
  `;
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
  renderCashCloseResult(session);
}

export function bindCashSessionActions() {
  document.getElementById('openCashBtn')?.addEventListener('click', () => openCashSession());
  document.getElementById('closeCashBtn')?.addEventListener('click', () => closeCashSession());
  document.getElementById('resetCashBtn')?.addEventListener('click', resetCashSession);
  setInterval(() => { if (state.cashSession?.isOpen) renderCashSession(); }, 60000);
}
