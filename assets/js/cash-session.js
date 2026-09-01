import { state } from './state.js';
import { KEYS, load, save, remove } from './storage.js';
import { renderFinance, getFinanceSummary } from './finance.js';
import { renderReports, printDailyReport } from './reports.js';
import { formatCurrency, formatDateTimeBR, toNumber } from './utils.js';
import { addHistory } from './history.js';
import { audit } from './audit-service.js';
import { clearOperatorSession, requireOperatorSession, requirePDVOperatorSession } from './operator-session.js';
import { checkTerminalBeforeCashOpen, findTerminalByDevice } from './terminal-manager.js';
import { isBackendReady } from './backend-config.js';
import { clearActiveProfile, showProfileSelector } from './profile-selector.js';

import {
  getCurrentCashSessionService,
  openCashSessionService,
  closeCashSessionService,
  reopenCashSessionService,
  getCashClosePreviewService
} from './services/cash-service.js';

function _isSimplifiedPDV() {
  let _mode = state?.pdvSettings?.pdvMode;
  if (!_mode) {
    try { _mode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.pdvMode; } catch {}
  }
  return (_mode ?? 'simplified') === 'simplified';
}

// Lê um campo requireAuth* de state.pdvSettings, com fallback para o cache
// local (cobre a race condition de pdvSettings ainda não ter sido carregado).
function _pdvAuthFlag(key) {
  let v = state?.pdvSettings?.[key];
  if (v === undefined) {
    try { v = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.[key]; } catch {}
  }
  return v;
}

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _cashAv(name, role) {
  if (typeof window.renderUserAvatar !== 'function' || !name || name === '—') return '';
  return window.renderUserAvatar(
    { name, photoUrl: window.getUserAvatar?.(name) || null, role: role || '' },
    { cls: 'av', size: 'sm' }
  );
}

let cashTimer = null;
let cashClosedClockTimer = null;
let cashActionsBound = false;

/* ================= STORAGE ================= */

function getScopedCashSessionKey() {
  const companyId = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${KEYS.cashSession}_${companyId}`;
}

/* ================= HELPERS ================= */

function showToast(message, type = 'success') {
  if (!message) return;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function normalizeCurrencyInput(value = '') {
  const normalized = String(value || '0')
    .trim()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

function getTodayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function isSameBusinessDay(a, b = new Date()) {
  if (!a) return false;
  return getTodayKey(a) === getTodayKey(b);
}

function shouldResetClosedSessionForNewDay(session) {
  if (!session) return false;
  if (session.isOpen) return false;

  const referenceDate = session.closedAt || session.openedAt;
  if (!referenceDate) return false;

  return !isSameBusinessDay(referenceDate, new Date());
}

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

  const isOpen = session.status === 'open' || session.isOpen === true;

  return {
    id: session.id || null,
    isOpen,
    status: session.status || (isOpen ? 'open' : 'closed'),

    businessDate: session.businessDate || getTodayKey(session.openedAt || new Date()),

    openingAmount: Number(session.openingAmount || 0),
    openedAt: session.openedAt || null,
    closedAt: session.closedAt || null,

    closingAmount: Number(session.closingAmount || 0),
    countedAmount: Number(session.countedAmount || 0),
    difference: Number(session.difference || 0),

    authorizedByName: session.authorizedByName || null,
    authorizedById: session.authorizedById || null,
    authorizedByRole: session.authorizedByRole || null,

    openingAmountDefinedById: session.openingAmountDefinedById || session.authorizedById || null,
    openingAmountDefinedByName: session.openingAmountDefinedByName || session.authorizedByName || null,
    openingAmountDefinedByRole: session.openingAmountDefinedByRole || session.authorizedByRole || null,

    terminalName: session.terminalName || 'Caixa principal',
    terminalCode: session.terminalCode || null,

    operator: session.operator || {
      id: session.operatorId || null,
      name: session.operatorName || '',
      cpf: session.operatorCpf || '',
      controlPin: session.operatorPin || ''
    },

    operatorId: session.operatorId || null,
    operatorName: session.operatorName || null,
    operatorCpf: session.operatorCpf || null,
    operatorPin: session.operatorPin || null
  };
}

// Consumidor: card "Vendas do dia" do dashboard (renderCashSession()) — soma
// legitimamente o faturamento total do dia, de qualquer forma de pagamento.
// NÃO usar para o fechamento de caixa — ver getSessionSalesTotal() abaixo
// (Fase 3.1a-bis, C1).
function getTodayValidSalesTotal() {
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const today = new Date().toLocaleDateString('pt-BR');

  return sales.reduce((acc, sale) => {
    if (sale?.cancelled || sale?.isCancelled || sale?.status === 'cancelled') return acc;

    const rawDate = sale?.createdAt || sale?.date;
    if (!rawDate) return acc;

    const saleDate = new Date(rawDate).toLocaleDateString('pt-BR');
    if (saleDate !== today) return acc;

    return acc + Number(sale.total || 0);
  }, 0);
}

// Fase 3.1a-bis (ALTO C, C1): escopa por cashSessionId, não por data local —
// alinhado ao critério real do backend (cash.controller.js:
// prisma.sale.findMany({where:{cashSessionId,...}})). O bug original (ALTO C)
// era exatamente essa divergência de escopo: sessão que atravessa meia-noite,
// duas sessões no mesmo dia (inclusive reabertura — reopenCashController
// sempre cria uma sessão nova, nunca reaproveita o id anterior) faziam o
// preview e o resultado final do backend somarem conjuntos de vendas
// diferentes.
//
// Emenda Final Pré-Checkpoint (C3 CONFIRMADO): esta função soma o TOTAL da
// venda, de qualquer forma de pagamento — não replica a composição por
// método (C2/H1-b) que cash.controller.js aplica na resposta autoritativa
// (soma só a parcela cash de cada venda, via SalePayment, com fallback
// legado). Reproduzir essa regra aqui duplicaria a fórmula de negócio em
// dois lugares que podem divergir — por isso ela deixou de ser a fonte da
// prévia de fechamento (ver fetchCashClosePreview()/updateCashCloseSummary()
// abaixo, que agora consultam GET /v1/cash-sessions/:id/close-preview).
//
// Consumidor restante: closeCashSession() — só como valor local de
// exibição otimista/fallback de countedAmount nos fechamentos "rápidos"
// (#pdvCloseCashBtn, window.closePDVCashFlow, botão de openPDVExitOptions()
// em app.js), que não passam pelo fluxo dedicado de conferência e por isso
// não têm uma prévia buscada previamente. O valor PERSISTIDO de
// expectedAmount nunca vem daqui em nenhum caminho — é sempre recalculado
// no servidor (closeCashController -> calculateExpectedCashAmount()) e
// sobrescreve este valor local assim que a resposta do backend chega. Não
// alterado nesta emenda: mexer nos caminhos rápidos está fora de escopo
// (ver docs/staging-final-checklist.md).
function getSessionSalesTotal() {
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const sessionId = state.cashSession?.id;
  if (!sessionId) return 0;

  return sales.reduce((acc, sale) => {
    if (sale?.cancelled || sale?.isCancelled || sale?.status === 'cancelled') return acc;
    if (String(sale?.cashSessionId || '') !== String(sessionId)) return acc;

    return acc + Number(sale.total || 0);
  }, 0);
}

function getCurrentOperatorForSession() {
  const operator = state.currentOperator || state.cashSession?.operator || null;

  if (operator?.name) {
    return {
      id: operator.id || state.currentUser?.id || null,
      name: operator.name || 'Operador',
      cpf: operator.cpf || '',
      role: operator.role || state.currentUser?.role || 'operador',
      controlPin: operator.controlPin || operator.pin || ''
    };
  }

  const current = state.currentUser || null;
  if (!current) return null;

  return {
    id: current.id || null,
    name: current.name || 'Responsável',
    cpf: current.cpf || '',
    role: current.role || 'operador',
    controlPin: current.controlPin || ''
  };
}

function getCurrentAuthorizer() {
  return {
    id: state.currentUser?.id || null,
    name: state.currentUser?.name || state.currentUser?.email || 'Responsável',
    role: state.currentUser?.role || 'administrador'
  };
}

function getTerminalName() {
  const typed = window.prompt(
    'Informe o nome do caixa/terminal para esta sessão:',
    state.currentOperator?.terminalName || state.cashSession?.terminalName || 'Caixa 1'
  );

  if (typed === null) return null;

  const value = String(typed || '').trim();
  return value || 'Caixa 1';
}

function resetOpeningAmountField(value = '') {
  const openingField =
    document.getElementById('openingAmount') ||
    document.getElementById('openingAmountInput');

  if (openingField) openingField.value = value;
}

function setCashDifferenceVisual(difference) {
  const differenceBox = document.getElementById('cashDifferenceBox');
  const differenceValueEl = document.getElementById('cashDifferenceValue');

  if (!differenceBox || !differenceValueEl) return;

  differenceValueEl.textContent = formatCurrency(difference);
  differenceBox.classList.remove('is-ok', 'is-surplus', 'is-shortage');

  if (Math.abs(difference) < 0.009) {
    differenceBox.classList.add('is-ok');
    return;
  }

  if (difference > 0) {
    differenceBox.classList.add('is-surplus');
    return;
  }

  differenceBox.classList.add('is-shortage');
}

// Emenda Final Pré-Checkpoint (ALTO C, C3 CONFIRMADO) — a prévia do fluxo
// dedicado de conferência (#cashCloseConferenceModal) deixa de reconstruir
// expectedAmount localmente a partir de state.sales. Ela passa a vir de
// GET /v1/cash-sessions/:id/close-preview (mesma função autoritativa —
// calculateExpectedCashAmount() — que closeCashController usa para
// persistir o fechamento real). Isso elimina a divergência que existia
// entre o número mostrado ao operador ANTES de confirmar e o número que o
// backend efetivamente gravava DEPOIS de confirmar (ex.: sessão com venda
// mista cash 30 + pix 70: prévia local somava 100, backend sempre somou 30).
//
// _lastClosePreview: { cashSessionId, openingAmount, cashSalesAmount, expectedAmount } | null
// _closePreviewError: string | null — presença bloqueia a confirmação do
// fechamento (ver requestProtectedCashClose()). NUNCA cai para
// getSessionSalesTotal() como fallback em caso de falha — mostrar erro
// explícito é o comportamento correto aqui, não inventar um valor local.
let _lastClosePreview = null;
let _closePreviewError = null;

async function fetchCashClosePreview() {
  _lastClosePreview = null;
  _closePreviewError = null;

  const sessionId = state.cashSession?.id;
  if (!sessionId) {
    _closePreviewError = 'Sessão de caixa sem identificador — não é possível obter o saldo esperado do servidor.';
    return;
  }

  try {
    const preview = await getCashClosePreviewService(sessionId);
    if (!preview) {
      _closePreviewError = 'Não foi possível obter o saldo esperado do servidor. Tente novamente.';
      return;
    }
    _lastClosePreview = preview;
  } catch (error) {
    _closePreviewError = error?.message || 'Não foi possível obter o saldo esperado do servidor. Tente novamente.';
  }
}

function updateCashCloseSummary() {
  const openingEl = document.getElementById('cashCloseOpeningValue');
  const salesEl = document.getElementById('cashCloseSalesValue');
  const expectedEl = document.getElementById('cashCloseExpectedValue');
  const statusEl = document.getElementById('cashCloseStatusLabel');
  const countedInput = document.getElementById('cashCountedAmount');
  const closeBtn = document.getElementById('closeCashBtn');

  if (!openingEl || !salesEl || !expectedEl || !statusEl) return;

  // Bloqueia a confirmação enquanto o valor autoritativo não estiver
  // disponível (Emenda Final Pré-Checkpoint, Seção 10.1) — nunca habilitar
  // o fechamento com base em um cálculo local de substituição.
  if (closeBtn) closeBtn.disabled = !_lastClosePreview || Boolean(_closePreviewError);

  if (_closePreviewError) {
    openingEl.textContent = '—';
    salesEl.textContent = '—';
    expectedEl.textContent = '—';
    statusEl.textContent = 'Erro ao obter saldo esperado';
    setCashDifferenceVisual(0);
    const diffValueEl = document.getElementById('cashDifferenceValue');
    if (diffValueEl) diffValueEl.textContent = '—';
    return;
  }

  if (!_lastClosePreview) {
    openingEl.textContent = '—';
    salesEl.textContent = '—';
    expectedEl.textContent = '—';
    statusEl.textContent = 'Carregando saldo esperado...';
    return;
  }

  const opening = Number(_lastClosePreview.openingAmount || 0);
  const salesTotal = Number(_lastClosePreview.cashSalesAmount || 0);
  const expected = Number(_lastClosePreview.expectedAmount || 0);
  const counted = Number(countedInput?.value || 0);
  const difference = counted - expected;

  openingEl.textContent = formatCurrency(opening);
  salesEl.textContent = formatCurrency(salesTotal);
  expectedEl.textContent = formatCurrency(expected);

  if (!countedInput?.value) {
    statusEl.textContent = 'Aguardando';
    setCashDifferenceVisual(0);
    return;
  }

  setCashDifferenceVisual(difference);

  if (Math.abs(difference) < 0.009) {
    statusEl.textContent = 'Correto';
    return;
  }

  if (difference > 0) {
    statusEl.textContent = 'Sobra no caixa';
    return;
  }

  statusEl.textContent = 'Falta no caixa';
}

function startRealtimeClock() {
  if (cashTimer) clearInterval(cashTimer);

  cashTimer = setInterval(() => {
    if (state.cashSession?.isOpen) {
      renderCashSession();
      updateCashCloseSummary();
    }
  }, 1000);
}

function stopRealtimeClock() {
  if (cashTimer) {
    clearInterval(cashTimer);
    cashTimer = null;
  }
}

function getSessionAnalytics() {
  if (!state.cashSession?.openedAt) return null;

  const start = new Date(state.cashSession.openedAt).getTime();
  const end = state.cashSession.closedAt
    ? new Date(state.cashSession.closedAt).getTime()
    : Date.now();

  const hours = Math.max(1, (end - start) / 3600000);
  const summary = getFinanceSummary?.() || { currentBalance: 0 };

  return {
    hours,
    profitPerHour: Number(summary.currentBalance || 0) / hours
  };
}

async function refreshSalesState() {
  if (typeof state.loadSales === 'function') {
    const sales = await state.loadSales();
    if (Array.isArray(sales)) state.sales = sales;
  }
}

async function refreshUI() {
  await refreshSalesState();
  renderCashSession();
  renderFinance?.();
  renderReports?.();
  updateCashCloseSummary();
  document.dispatchEvent(new CustomEvent('gamby:sales-updated'));
}

/* ================= TELA DE CAIXA FECHADO ================= */

function startClosedCashClock() {
  if (cashClosedClockTimer) clearInterval(cashClosedClockTimer);

  function tick() {
    const now = new Date();

    const clockEl = document.getElementById('cashClosedLiveClock');
    const dateEl = document.getElementById('cashClosedLiveDate');

    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }

    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
    }
  }

  tick();
  cashClosedClockTimer = setInterval(tick, 1000);
}

function stopClosedCashClock() {
  if (cashClosedClockTimer) {
    clearInterval(cashClosedClockTimer);
    cashClosedClockTimer = null;
  }
}

export function showClosedCashScreen(session) {
  const screen = document.getElementById('cashClosedScreen');
  if (!screen) return;

  const resolvedSession = session || state.cashSession || {};

  const companyName =
    state.currentCompany?.tradeName ||
    state.companySettings?.tradeName ||
    state.companySettings?.companyName ||
    'Gamby Fluxo Caixa Pro';

  const companyNameEl = document.getElementById('cashClosedCompanyName');
  if (companyNameEl) companyNameEl.textContent = companyName;

  // Logo da empresa na tela de caixa fechado — usa logo PDV se existir, senão cai para logo principal da empresa
  const pdvLogoUrl  = state.currentCompany?.pdvClosedLogoUrl || state.currentCompany?.logoUrl || null;
  const logoImg     = document.getElementById('cashClosedLogoImg');
  const logoHolder  = document.getElementById('cashClosedLogoPlaceholder');
  if (logoImg && logoHolder) {
    if (pdvLogoUrl) {
      logoImg.src = pdvLogoUrl;
      logoImg.classList.remove('hidden');
      logoHolder.classList.add('hidden');
    } else {
      logoImg.classList.add('hidden');
      logoHolder.classList.remove('hidden');
    }
  }

  const operatorName =
    resolvedSession.operatorName ||
    resolvedSession.operator?.name ||
    state.currentOperator?.name ||
    state.currentUser?.name ||
    '—';

  const operatorCpf =
    resolvedSession.operatorCpf ||
    resolvedSession.operator?.cpf ||
    state.currentOperator?.cpf ||
    state.currentUser?.cpf ||
    '—';

  const terminalName =
    resolvedSession.terminalName ||
    state.currentOperator?.terminalName ||
    'Caixa principal';

  const operatorNameEl = document.getElementById('cashClosedOperatorName');
  const operatorCpfEl  = document.getElementById('cashClosedOperatorCpf');
  const terminalNameEl = document.getElementById('cashClosedTerminalName');
  const closedTimeEl   = document.getElementById('cashClosedTime');
  const closedDateEl   = document.getElementById('cashClosedDateInfo');

  const closedAtDate = resolvedSession.closedAt ? new Date(resolvedSession.closedAt) : new Date();
  const closedDateStr = closedAtDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const closedTimeStr = closedAtDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (operatorNameEl) {
    const opRole = resolvedSession.operator?.role || '';
    const avHtml = _cashAv(operatorName, opRole);
    if (avHtml) {
      operatorNameEl.classList.add('cs-has-av');
      operatorNameEl.innerHTML = `${avHtml}<span>${_esc(operatorName)}</span>`;
    } else {
      operatorNameEl.classList.remove('cs-has-av');
      operatorNameEl.textContent = operatorName;
    }
  }
  if (operatorCpfEl)  operatorCpfEl.textContent  = operatorCpf;
  if (terminalNameEl) terminalNameEl.textContent  = terminalName;
  if (closedDateEl)   closedDateEl.textContent    = closedDateStr;
  if (closedTimeEl)   closedTimeEl.textContent    = closedTimeStr;

  screen.classList.remove('hidden');
  startClosedCashClock();

  audit('cash_closed_screen_shown', {
    session: resolvedSession,
    operatorName,
    terminalName
  });

  document.dispatchEvent(new CustomEvent('gamby:cash-closed', {
    detail: { session: resolvedSession }
  }));
}

export function hideClosedCashScreen() {
  const screen = document.getElementById('cashClosedScreen');
  if (!screen) return;

  screen.classList.add('hidden');
  stopClosedCashClock();

  document.dispatchEvent(new CustomEvent('gamby:cash-opened', {
    detail: { session: state.cashSession || null }
  }));
}

/* ================= MODAL PREMIUM DE ABERTURA ================= */

function openCashOpeningAmountModal() {
  window._authDebug = window._authDebug || {};
  window._authDebug.openCashChoiceClicked = true;
  document.getElementById('cashOpeningAmountOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cashOpeningAmountOverlay';
  overlay.className = 'overlay';

  overlay.innerHTML = `
    <div class="modal pdv-exit-modal">
      <div class="cs-modal-emoji">💵</div>
      <h3 class="cs-modal-title">Valor de abertura do caixa</h3>
      <p class="mini cs-modal-sub">
        Deseja definir o valor que já existe no caixa antes das vendas?
      </p>
      <div class="field-group cs-modal-fg">
        <label for="cashOpeningAmountModalInput">Valor inicial</label>
        <input
          id="cashOpeningAmountModalInput"
          class="field"
          type="text"
          inputmode="decimal"
          placeholder="0,00"
          value="0,00"
        />
      </div>
      <div class="notice cs-modal-notice">
        <strong>Resumo do fechamento:</strong><br>
        Valor inicial + vendas do dia = saldo esperado.
        <br><br>
        O valor inicial ficará registrado como definido por:
        <strong>${_esc(state.currentUser?.name || state.currentUser?.email || 'responsável autorizado')}</strong>.
      </div>
      <div class="hero-actions compact cs-modal-acts">
        <button id="confirmCashOpeningAmountBtn" class="btn btn-primary" type="button">
          Abrir caixa com valor inicial
        </button>
        <button id="openCashWithoutAmountBtn" class="btn btn-ghost" type="button">
          Abrir sem valor inicial
        </button>
        <button id="cancelCashOpeningAmountBtn" class="btn btn-ghost" type="button">
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = document.getElementById('cashOpeningAmountModalInput');

  setTimeout(() => {
    input?.focus();
    input?.select?.();
  }, 80);

  document.getElementById('cancelCashOpeningAmountBtn')?.addEventListener('click', () => {
    overlay.remove();

    audit('cash_open_cancelled', {
      step: 'opening_amount_modal'
    });
  });

  document.getElementById('openCashWithoutAmountBtn')?.addEventListener('click', async () => {
    overlay.remove();
    await openCashFromPremiumModal(0);
  });

  document.getElementById('confirmCashOpeningAmountBtn')?.addEventListener('click', async () => {
    const raw = String(input?.value || '0').trim();
    const value = normalizeCurrencyInput(raw);

    if (!Number.isFinite(value) || value < 0) {
      showToast('Valor de abertura inválido.', 'warning');
      audit('cash_open_invalid_amount', { raw });
      return;
    }

    overlay.remove();
    await openCashFromPremiumModal(value);
  });
}

async function openCashFromPremiumModal(openingAmount = 0) {
  const operator = getCurrentOperatorForSession();
  const terminalName =
    state.currentOperator?.terminalName ||
    state.cashSession?.terminalName ||
    'Caixa 1';

  if (!operator) {
    showToast('Operador não identificado.', 'error');
    audit('cash_open_failed_operator_missing');
    return;
  }

  const authorizer = getCurrentAuthorizer();

  await openCashSession({
    openingAmount,
    terminalName,
    operator,
    authorizedBy: authorizer,
    notes: openingAmount > 0
      ? `Abertura com valor inicial informado por ${authorizer.name}`
      : `Abertura sem valor inicial informada por ${authorizer.name}`
  });
}

/* ================= FLUXO DE ABERTURA PELO PDV ================= */

// _onAuthCancelled: chamado quando a pessoa cancela (X) o gate de senha
// admin interno abaixo — deixa o CHAMADOR decidir para qual tela voltar
// (a etapa anterior real do caminho percorrido), em vez de sempre assumir
// "tela de caixa fechado" (só correto quando essa tela É de fato a etapa
// anterior, como no "Acesso autorizado" — errado, por exemplo, vindo de
// login normal → seletor → Operador → PIN, onde a etapa anterior é o
// seletor de perfil). Default preserva o comportamento anterior.
export async function startPDVOpenCashFlow(_adminAuth = false, _forceReauth = false, _onAuthCancelled = null) {
  window._authDebug = window._authDebug || {};

  // DEBUG TEMPORÁRIO — remover após confirmar a causa do BUG "modal de valor
  // inicial não aparece". Loga cada decisão desta função para reconstruir a
  // sequência exata de chamadas no console do navegador.
  console.log('[CASH-OPEN-DEBUG] ETAPA 1: iniciando fluxo — startPDVOpenCashFlow() chamado', {
    _adminAuth, _forceReauth,
    cashSessionIsOpen: Boolean(state.cashSession?.isOpen),
    currentOperatorName: state.currentOperator?.name || null,
    activeProfile: state.activeProfile?.profile || null,
  });

  // _forceReauth: login/seleção de perfil NOVA (ver listener de
  // 'gamby:profile-selected' em app.js) — uma sessão de caixa já aberta pode
  // pertencer a outro operador ou a um dia anterior (initCashSession() nunca
  // reseta sessões OPEN por virada de dia, só as fechadas). Em vez de herdar
  // silenciosamente, exige senha admin de novo antes de aceitar/retomar.
  if (state.cashSession?.isOpen && !_forceReauth) {
    console.log('[CASH-OPEN-DEBUG] saída: caixa já aberto e !_forceReauth — toast "já está aberto"');
    showToast('O caixa já está aberto.', 'warning');
    hideClosedCashScreen();
    return;
  }

  // Guarda interna: exige senha admin ANTES de mostrar modal de valor quando o modo é
  // controlado OU quando requireAuthOpenCash está habilitado (abertura de caixa é a única
  // ação protegida por padrão mesmo no modo simplificado — só dispensa se explicitamente false).
  // Cobre todos os caminhos de chamada, inclusive race condition de pdvSettings não carregado.
  let _pdvMode = state?.pdvSettings?.pdvMode;
  if (!_pdvMode) {
    try { _pdvMode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.pdvMode; } catch {}
  }
  const _requireAuthOpenCash = _pdvAuthFlag('requireAuthOpenCash');
  const _needsAuthOpenCash = _pdvMode === 'controlled' || _requireAuthOpenCash !== false;
  console.log('[CASH-OPEN-DEBUG] gate senha admin', { _pdvMode, _requireAuthOpenCash, _needsAuthOpenCash, _adminAuth });
  if (_needsAuthOpenCash && !_adminAuth) {
    window._authDebug.adminAuthRequestedBeforeCashOpen = true;
    console.log('[CASH-OPEN-DEBUG] abrindo modal de senha admin via window.openSecureCashCloseModal, typeof =', typeof window.openSecureCashCloseModal);
    if (typeof window.openSecureCashCloseModal === 'function') {
      window.openSecureCashCloseModal(async () => {
        console.log('[CASH-OPEN-DEBUG] ETAPA 2: senha validada — chamando startPDVOpenCashFlow(true, _forceReauth) de novo');
        await startPDVOpenCashFlow(true, _forceReauth, _onAuthCancelled);
      }, {
        forceAuth: true,
        // BUG CONFIRMADO (Round 3): sem onCancel, cancelar esta senha não
        // fazia nada — se a página do PDV já estivesse renderizada por baixo
        // (ex.: applyProfileRestrictions('operador') já chamou
        // openPageDirect('pdv') ANTES deste gate rodar), ela ficava visível
        // e utilizável mesmo sem o caixa ter sido aberto.
        //
        // BUG CONFIRMADO (Round 4): showClosedCashScreen() incondicional
        // (fix do Round 3) só é a tela certa quando a etapa anterior real É
        // uma tela de caixa fechado (ex.: "Acesso autorizado"). Vindo de
        // login normal → seletor → Operador → PIN, a etapa anterior real é
        // o seletor de perfil — showClosedCashScreen() mostrava uma tela que
        // nunca existiu nesse caminho. _onAuthCancelled deixa o chamador
        // (que sabe de onde veio) decidir; sem ele, mantém o fallback antigo.
        onCancel: () => {
          if (typeof _onAuthCancelled === 'function') {
            _onAuthCancelled();
          } else {
            showClosedCashScreen(state.cashSession);
          }
        }
      });
    } else {
      console.log('[CASH-OPEN-DEBUG] ⛔ window.openSecureCashCloseModal não é uma função — abertura abortada silenciosamente');
    }
    return;
  }

  // Senha admin confirmada (ou dispensada por config) — se chegou até aqui em
  // modo _forceReauth com um caixa já aberto, não há o que abrir de novo (o
  // backend rejeitaria com 409 cash_already_open): a identidade já foi
  // reconfirmada, então só retomamos a sessão existente.
  if (state.cashSession?.isOpen && _forceReauth) {
    console.log('[CASH-OPEN-DEBUG] saída: caixa já aberto + _forceReauth — retomando sessão existente sem modal de valor');
    hideClosedCashScreen();
    showToast('Caixa em aberto retomado após confirmação de identidade.');
    return;
  }

  const _simplified = (_pdvMode ?? 'simplified') === 'simplified';
  console.log('[CASH-OPEN-DEBUG] passou do gate de senha — _simplified:', _simplified, '| currentOperator.name:', state.currentOperator?.name || null);

  if (_simplified) {
    const user = state.currentUser || {};
    const existingTerminal = findTerminalByDevice();
    const terminalName = existingTerminal?.name || 'Caixa Principal';

    state.currentOperator = {
      id: user.id || null,
      name: user.name || 'Responsável',
      cpf: user.cpf || '',
      controlPin: user.controlPin || '',
      terminalName,
      startedAt: new Date().toISOString()
    };

    if (!state.cashSession) state.cashSession = {};
    state.cashSession.terminalName = terminalName;

    console.log('[CASH-OPEN-DEBUG] ETAPA 3: abrindo modal valor inicial — ramo _simplified');
    openCashOpeningAmountModal();
    return;
  }

  // Operador já identificado (e.g. por showPDVOpenCashChoice): pula checkTerminal
  if (state.currentOperator?.name) {
    if (!state.cashSession) state.cashSession = {};
    state.cashSession.terminalName = state.currentOperator.terminalName
      || state.cashSession?.terminalName
      || 'Caixa Principal';
    console.log('[CASH-OPEN-DEBUG] ETAPA 3: abrindo modal valor inicial — ramo currentOperator já identificado');
    openCashOpeningAmountModal();
    return;
  }

  console.log('[CASH-OPEN-DEBUG] ⚠️ nenhum ramo anterior bateu — indo para checkTerminalBeforeCashOpen() (modal antigo)');
  const result = await checkTerminalBeforeCashOpen();

  if (!result) {
    showToast('Identificação cancelada.', 'warning');
    audit('cash_open_operator_not_identified');
    return;
  }

  state.currentOperator = {
    id: result.operator.id || null,
    name: result.operator.name,
    cpf: result.operator.cpf,
    controlPin: result.operator.controlPin,
    terminalName: result.terminalName,
    startedAt: new Date().toISOString()
  };

  if (!state.cashSession) state.cashSession = {};
  state.cashSession.terminalName = result.terminalName;
  state.cashSession.terminalCode = result.terminalCode;

  openCashOpeningAmountModal();
}

/* ================= INIT ================= */

export async function initCashSession() {
  const local = load(getScopedCashSessionKey(), null);
  state.cashSession = local;

  if (shouldResetClosedSessionForNewDay(state.cashSession)) {
    audit('cash_session_reset_new_business_day', {
      previousSession: state.cashSession
    });

    state.cashSession = null;
    remove(getScopedCashSessionKey());
  }

  try {
    const current = await getCurrentCashSessionService();

    if (current) {
      const mapped = mapCashSession(current);

      if (shouldResetClosedSessionForNewDay(mapped)) {
        state.cashSession = null;
        remove(getScopedCashSessionKey());
      } else {
        state.cashSession = mapped;
        save(getScopedCashSessionKey(), state.cashSession);
      }
    } else if (isBackendReady() && state.cashSession?.isOpen) {
      // getCurrentCashSessionService() só retorna null aqui após uma resposta
      // de rede bem-sucedida (isBackendReady() true — não é o caso de backend
      // desabilitado/offline) confirmando que NÃO há sessão ativa. Sem limpar
      // o cache local, um resíduo isOpen:true (ex.: de uma tentativa de
      // abertura que falhou no backend mas já tinha marcado o estado local
      // como aberto, ou um fechamento feito em outro dispositivo/aba) trava
      // o app permanentemente em "caixa aberto" — o fluxo de abertura nunca
      // mais é oferecido e o modal de valor inicial nunca aparece.
      state.cashSession = null;
      remove(getScopedCashSessionKey());
    }
  } catch {
    // falha real de rede/backend — mantém fallback local (não é confirmação)
  }

  renderCashSession();
  updateCashCloseSummary();

  if (state.cashSession?.isOpen) {
    hideClosedCashScreen();
    startRealtimeClock();
  } else {
    stopRealtimeClock();
    resetOpeningAmountField('');

    // Perfil ativo (seletor pós-login) tem prioridade sobre o papel real do JWT
    // aqui — um administrador "navegando como" operador deve ver a tela de
    // caixa fechado normalmente, igual a um operador de verdade veria.
    const role = String(state.activeProfile?.profile || state.currentUser?.role || '').toLowerCase();

    if (role === 'operador') {
      showClosedCashScreen(state.cashSession);
    } else {
      hideClosedCashScreen();
    }
  }
}

/* ================= OPEN ================= */

export async function openCashSession(options = {}) {
  if (state.cashSession?.isOpen) {
    if (!options?.silent) showToast('Já existe um caixa aberto.', 'warning');
    return state.cashSession;
  }

  const explicitOpeningAmount = options?.openingAmount;
  const fieldValue =
    document.getElementById('openingAmount')?.value ??
    document.getElementById('openingAmountInput')?.value ??
    '';

  const value = typeof explicitOpeningAmount === 'number'
    ? Math.max(0, Number(explicitOpeningAmount))
    : Math.max(0, toNumber(fieldValue, 0));

  const terminalName =
    options?.terminalName ||
    state.currentOperator?.terminalName ||
    getTerminalName();

  if (!terminalName) return null;

  const operator = options?.operator || getCurrentOperatorForSession();

  if (!operator) {
    showToast('Operador não identificado.', 'error');

    audit('cash_open_failed_operator_missing', {
      terminalName
    });

    return null;
  }

  const authorizer = options?.authorizedBy || getCurrentAuthorizer();

  let session = {
    id: null,
    isOpen: true,
    status: 'open',
    businessDate: getTodayKey(),
    openingAmount: value,
    openedAt: new Date().toISOString(),
    closedAt: null,
    closingAmount: 0,
    countedAmount: 0,
    difference: 0,

    terminalName,
    terminalCode: options?.terminalCode || null,

    operator,
    operatorId: operator.id || null,
    operatorName: operator.name || '',
    operatorCpf: operator.cpf || '',
    operatorPin: operator.controlPin || '',

    authorizedById: authorizer.id || null,
    authorizedByName: authorizer.name || '',
    authorizedByRole: authorizer.role || '',

    openingAmountDefinedById: authorizer.id || null,
    openingAmountDefinedByName: authorizer.name || '',
    openingAmountDefinedByRole: authorizer.role || ''
  };

  // Senha admin já verificada por openSecureCashCloseModal (se a abertura exigiu
  // autorização) — openCashController também exige esse mesmo campo de forma
  // independente quando pdvSettings.requireAuthOpenCash está ligado. Consumo
  // único: lida e limpa aqui para não vazar/reutilizar em outra chamada.
  const _authPassword = state._pendingCashAuthPassword || null;
  state._pendingCashAuthPassword = null;

  console.log('[CASH-OPEN-DEBUG] ETAPA 4: POST cash-sessions/open — openCashSession() chamando openCashSessionService()', { openingAmount: value });
  try {
    const payload = await openCashSessionService({
      openingAmount: value,
      notes: options?.notes || 'Abertura do expediente',
      terminalName,
      terminalCode: options?.terminalCode || null,
      password: _authPassword,

      operatorId: operator.id || null,
      operatorName: operator.name || '',
      operatorCpf: operator.cpf || '',
      operatorPin: operator.controlPin || '',

      authorizedById: authorizer.id || null,
      authorizedByName: authorizer.name || '',
      authorizedByRole: authorizer.role || '',

      openingAmountDefinedById: authorizer.id || null,
      openingAmountDefinedByName: authorizer.name || '',
      openingAmountDefinedByRole: authorizer.role || '',

      businessDate: getTodayKey()
    });

    if (payload) {
      session = {
        ...mapCashSession(payload),

        businessDate: payload.businessDate || getTodayKey(),

        terminalName: payload.terminalName || terminalName,
        terminalCode: payload.terminalCode || options?.terminalCode || null,

        operator: payload.operator || operator,
        operatorId: payload.operatorId || operator.id || null,
        operatorName: payload.operatorName || operator.name || '',
        operatorCpf: payload.operatorCpf || operator.cpf || '',
        operatorPin: payload.operatorPin || operator.controlPin || '',

        authorizedById: payload.authorizedById || authorizer.id || null,
        authorizedByName: payload.authorizedByName || authorizer.name || '',
        authorizedByRole: payload.authorizedByRole || authorizer.role || '',

        openingAmountDefinedById: payload.openingAmountDefinedById || authorizer.id || null,
        openingAmountDefinedByName: payload.openingAmountDefinedByName || authorizer.name || '',
        openingAmountDefinedByRole: payload.openingAmountDefinedByRole || authorizer.role || ''
      };
    }
  } catch (error) {
    console.error('Erro ao abrir caixa no backend:', error);

    audit('cash_open_backend_error', {
      error: error?.message || String(error),
      status: error?.status || null,
      terminalName,
      operator,
      authorizer
    });

    // BUG CONFIRMADO: até aqui, um 403 (senha inválida/sem permissão) do
    // backend era silenciosamente engolido e o app seguia para o "sucesso"
    // abaixo mesmo assim — state.cashSession local otimista + toast de
    // sucesso, enquanto GET /v1/cash-sessions/current continuava retornando
    // null (o backend nunca criou a sessão). Nunca commitar estado de
    // "aberto" sem confirmação real do backend.
    showToast(
      error?.status === 403
        ? 'Senha incorreta. Tente novamente.'
        : (error?.message || 'Erro ao abrir o caixa. Tente novamente.'),
      'error'
    );

    return null;
  }

  state.cashSession = session;
  save(getScopedCashSessionKey(), session);

  addHistory(
    'Caixa',
    `Caixa aberto • ${terminalName} • Operador: ${operator.name} • Valor inicial: ${formatCurrency(value)}`,
    value
  );

  audit('cash_opened', {
    session,
    openingAmount: value,
    terminalName,
    operator,
    authorizer
  });

  if (!options?.silent) showToast('Caixa aberto com sucesso');

  hideClosedCashScreen();
  startRealtimeClock();
  resetOpeningAmountField('');
  await refreshUI();

  return session;
}

/* ================= CLOSE ================= */

export async function closeCashSession() {
  if (!state.cashSession?.isOpen) {
    showToast('Nenhum caixa aberto no momento.', 'warning');
    return false;
  }

  // Guard defensivo: se kiosk ativo, exige token de autorização prévia.
  // O token é concedido exclusivamente por requirePDVAdminAuthorization('close-cash').
  console.log('[PDV-CASH-CLOSE] closeCashSession-called | __pdvKioskActive:', window.__pdvKioskActive, '| __pdvCashCloseAuthorized:', window.__pdvCashCloseAuthorized);
  if (window.__pdvKioskActive && !window.__pdvCashCloseAuthorized) {
    console.error('[PDV-CASH-CLOSE] BLOQUEADO — flag ausente. Possível problema de timing ou bypass.');
    showToast('Fechar caixa exige autorização administrativa.', 'warning');
    return false;
  }
  window.__pdvCashCloseAuthorized = false; // consumir token one-time

  const summary = getFinanceSummary?.() || { currentBalance: 0 };
  const salesTotal = getSessionSalesTotal();
  const openingAmount = Number(state.cashSession?.openingAmount || 0);
  const expectedAmount = openingAmount + salesTotal;
  const countedValue = Number(document.getElementById('cashCountedAmount')?.value || expectedAmount || 0);
  const closedAt = new Date().toISOString();

  let session = {
    ...state.cashSession,
    isOpen: false,
    status: 'closed',
    closedAt,
    closingAmount: expectedAmount,
    countedAmount: countedValue,
    openingAmount,
    salesAmount: salesTotal,
    expectedAmount,
    difference: countedValue - expectedAmount
  };

  // BUG 422 CONFIRMADO: closeCashSchema (backend) exige 'password' de forma
  // INCONDICIONAL (z.string().min(1), sem .optional()) — a validação Zod
  // rejeita a requisição com 422 ANTES do controller decidir se realmente
  // precisa da senha (operatorMustAuth || pdvSettings.requireAuthCloseCash).
  // closeCashSessionService() nunca enviava esse campo. A senha já foi
  // validada por requirePDVAdminAuthorization('close-cash') alguns instantes
  // antes (confirmSecureCashCloseModal() sempre grava em
  // state._pendingCashAuthPassword, para open E close) — só faltava lê-la
  // aqui, mesmo padrão já usado em openCashSession().
  const _authPassword = state._pendingCashAuthPassword || null;
  state._pendingCashAuthPassword = null;

  try {
    const payload = await closeCashSessionService(state.cashSession.id, {
      closingAmount: expectedAmount,
      countedAmount: countedValue,
      openingAmount,
      salesAmount: salesTotal,
      expectedAmount,
      difference: countedValue - expectedAmount,
      notes: 'Fechamento normal',
      password: _authPassword,
      terminalName: state.cashSession?.terminalName || 'Caixa principal',
      terminalCode: state.cashSession?.terminalCode || null,
      operatorId: state.cashSession?.operatorId || null,
      operatorName: state.cashSession?.operatorName || '',
      operatorCpf: state.cashSession?.operatorCpf || '',
      operatorPin: state.cashSession?.operatorPin || ''
    });

    if (payload) {
      session = {
        ...mapCashSession(payload),

        terminalName: payload.terminalName || state.cashSession?.terminalName || 'Caixa principal',
        terminalCode: payload.terminalCode || state.cashSession?.terminalCode || null,

        operator: payload.operator || state.cashSession?.operator || null,
        operatorId: payload.operatorId || state.cashSession?.operatorId || null,
        operatorName: payload.operatorName || state.cashSession?.operatorName || '',
        operatorCpf: payload.operatorCpf || state.cashSession?.operatorCpf || '',
        operatorPin: payload.operatorPin || state.cashSession?.operatorPin || '',

        openingAmount: Number(payload?.openingAmount ?? openingAmount),
        salesAmount: Number(payload?.salesAmount ?? salesTotal),
        expectedAmount: Number(payload?.expectedAmount ?? expectedAmount),
        countedAmount: Number(payload?.countedAmount ?? countedValue),
        difference: Number(payload?.difference ?? countedValue - expectedAmount)
      };
    }
  } catch (error) {
    console.error('Erro ao fechar caixa no backend:', error);

    audit('cash_close_backend_error', {
      error: error?.message || String(error),
      session: state.cashSession
    });
  }

  state.cashSession = session;
  save(getScopedCashSessionKey(), session);

  addHistory(
    'Caixa',
    `Caixa fechado • ${session?.terminalName || 'Caixa principal'} • Valor inicial: ${formatCurrency(openingAmount)} • Vendas: ${formatCurrency(salesTotal)} • Esperado: ${formatCurrency(expectedAmount)}`,
    expectedAmount
  );

  audit('cash_closed', {
    session,
    openingAmount,
    salesTotal,
    expectedAmount,
    countedAmount: countedValue,
    difference: session.difference
  });

  // Reset session flags — próxima abertura exige nova autorização
  state.adminCashOpenAuthorized = false;
  state.operatorPinValidated = false;

  stopRealtimeClock();
  showToast('Caixa fechado com sucesso');

  resetOpeningAmountField('');
  await refreshUI();

  showClosedCashScreen(session);

  // Relatório de fechamento NÃO é exibido ao operador.
  // renderReports() já foi chamado dentro de refreshUI() acima e atualizou
  // a aba Relatórios em segundo plano. printDailyReport() abria uma nova
  // janela com diálogo de impressão — comportamento removido.

  try {
    clearOperatorSession?.();
  } catch {}

  return true;
}

/* ================= REOPEN ================= */

export async function reopenCashSession(options = {}) {
  const openingAmount = Number(options?.openingAmount || state.cashSession?.openingAmount || 0);
  const terminalName =
    options?.terminalName ||
    state.currentOperator?.terminalName ||
    state.cashSession?.terminalName ||
    getTerminalName();

  if (!terminalName) return null;

  const operator = options?.operator || getCurrentOperatorForSession();

  if (!operator) {
    showToast('Operador não identificado.', 'error');

    audit('cash_reopen_failed_operator_missing', {
      terminalName
    });

    return null;
  }

  const authorizer = options?.authorizedBy || getCurrentAuthorizer();

  let reopened = null;

  try {
    const payload = await reopenCashSessionService({
      openingAmount,
      notes: options?.notes || 'Reabertura do caixa no mesmo dia',
      terminalName,
      terminalCode: options?.terminalCode || null,

      operatorId: operator.id || null,
      operatorName: operator.name || '',
      operatorCpf: operator.cpf || '',
      operatorPin: operator.controlPin || '',

      authorizedById: authorizer.id || null,
      authorizedByName: authorizer.name || '',
      authorizedByRole: authorizer.role || '',

      businessDate: getTodayKey()
    });

    if (payload) {
      reopened = {
        ...mapCashSession(payload),
        businessDate: payload.businessDate || getTodayKey(),
        terminalName: payload.terminalName || terminalName,
        terminalCode: payload.terminalCode || options?.terminalCode || null,
        operator: payload.operator || operator,
        operatorId: payload.operatorId || operator.id || null,
        operatorName: payload.operatorName || operator.name || '',
        operatorCpf: payload.operatorCpf || operator.cpf || '',
        operatorPin: payload.operatorPin || operator.controlPin || ''
      };
    }
  } catch (error) {
    console.error('Erro ao reabrir caixa no backend:', error);

    audit('cash_reopen_backend_error', {
      error: error?.message || String(error),
      terminalName,
      operator,
      authorizer
    });
  }

  if (!reopened) {
    reopened = await openCashSession({
      openingAmount,
      terminalName,
      terminalCode: options?.terminalCode || null,
      operator,
      authorizedBy: authorizer,
      notes: options?.notes || 'Reabertura do caixa no mesmo dia',
      silent: true
    });
  }

  state.cashSession = reopened;
  save(getScopedCashSessionKey(), reopened);

  addHistory(
    'Caixa',
    `Caixa reaberto • ${reopened?.terminalName || terminalName} • ${reopened?.operatorName || operator?.name || 'Operador'}`,
    Number(reopened?.openingAmount || openingAmount || 0)
  );

  audit('cash_reopened', {
    session: reopened,
    terminalName,
    operator,
    authorizer
  });

  hideClosedCashScreen();
  startRealtimeClock();
  showToast('Caixa reaberto com sucesso');
  await refreshUI();

  return reopened;
}

/* ================= ACTIONS ================= */

// Fase 3.1a — a obrigatoriedade de countedAmount vale SOMENTE para esta tela
// interativa de conferência (#closeCashBtn, dentro de #cashCloseConferenceModal).
// Os outros chamadores de closeCashSession() (protectedCloseCash() em pdv.js,
// window.closePDVCashFlow, o botão dinâmico de openPDVExitOptions() em app.js)
// continuam fechando direto, sem essa exigência — não são tocados aqui.
function _readCountedAmountRaw() {
  return String(document.getElementById('cashCountedAmount')?.value ?? '').trim();
}

function requestProtectedCashClose() {
  if (!state.cashSession?.isOpen) {
    showToast('Nenhum caixa aberto para fechar.', 'warning');
    return;
  }

  // Emenda Final Pré-Checkpoint (C3): bloqueia a confirmação enquanto o
  // saldo esperado autoritativo (backend) não tiver sido obtido com
  // sucesso — nunca prosseguir com um cálculo local de substituição.
  if (_closePreviewError || !_lastClosePreview) {
    showToast(_closePreviewError || 'Aguarde o saldo esperado do servidor antes de confirmar.', 'warning');
    return;
  }

  // Vazio (string) é "não informado" — diferente de "0", que é uma contagem
  // legítima (caixa conferido e vazio). Nunca usar expectedAmount como
  // fallback aqui: é exatamente o comportamento que causava o bloqueador
  // ALTO B (difference sempre 0, independente da contagem física real).
  if (!_readCountedAmountRaw()) {
    showToast('Informe o valor contado em caixa.', 'warning');
    document.getElementById('cashCountedAmount')?.focus();
    return;
  }

  audit('cash_close_requested_from_cash_panel', {
    session: state.cashSession
  });

  // Modo controlado: sempre exige senha. Modo simplificado: só exige se
  // requireAuthCloseCash estiver habilitado nas configurações do PDV.
  const _needsAuthCloseCash = !_isSimplifiedPDV() || Boolean(_pdvAuthFlag('requireAuthCloseCash'));
  if (_needsAuthCloseCash && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(async () => {
      await closeCashSession();
      hideCashCloseConferenceModal();
    }, { forceAuth: true });
    return;
  }

  closeCashSession().finally(() => hideCashCloseConferenceModal());
}

/* ================= CONFERÊNCIA (Fase 3.1a) ================= */

// Reseta o campo de contagem para vazio — nunca deixar um valor residual de
// uma abertura anterior do modal vazar para os outros caminhos de fechamento
// (protectedCloseCash() etc.), que também leem #cashCountedAmount via
// closeCashSession() mas não devem herdar uma contagem que não confirmaram.
function _resetCashCountedField() {
  const input = document.getElementById('cashCountedAmount');
  if (input) input.value = '';
  const statusEl = document.getElementById('cashCloseStatusLabel');
  if (statusEl) statusEl.textContent = 'Aguardando';
  // Estado neutro — nem "is-ok" nem "is-surplus"/"is-shortage": nenhuma
  // contagem foi informada ainda, não é o mesmo que "diferença zero".
  document.getElementById('cashDifferenceBox')?.classList.remove('is-ok', 'is-surplus', 'is-shortage');
  const diffValueEl = document.getElementById('cashDifferenceValue');
  if (diffValueEl) diffValueEl.textContent = '—';
}

export async function openCashCloseConferenceModal() {
  if (!state.cashSession?.isOpen) {
    showToast('Nenhum caixa aberto para fechar.', 'warning');
    return;
  }

  _resetCashCountedField();
  _lastClosePreview = null;
  _closePreviewError = null;
  updateCashCloseSummary(); // renderiza estado "Carregando..." imediatamente

  document.getElementById('cashCloseConferenceModal')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('cashCountedAmount')?.focus(), 80);

  await fetchCashClosePreview();
  updateCashCloseSummary();
}

export function hideCashCloseConferenceModal() {
  document.getElementById('cashCloseConferenceModal')?.classList.add('hidden');
  _resetCashCountedField();
}

function printCashCloseReport() {
  audit('cash_close_report_printed', {
    session: state.cashSession
  });

  window.print();
}

function resetCashSession() {
  const confirmed = window.confirm('Deseja realmente resetar a sessão de caixa local?');
  if (!confirmed) return;

  audit('cash_session_local_reset', {
    previousSession: state.cashSession
  });

  state.cashSession = null;
  remove(getScopedCashSessionKey());

  stopRealtimeClock();
  resetOpeningAmountField('');
  showClosedCashScreen(null);
  showToast('Sessão de caixa resetada');
  refreshUI();
}

/* ================= RENDER ================= */

export function renderCashSession() {
  const boxes = document.querySelectorAll('#cashSessionBox');
  const openBtn = document.getElementById('openCashBtn');
  const closeBtn = document.getElementById('closeCashBtn');
  const pdvCloseBtn = document.getElementById('pdvCloseCashBtn');
  const pdvCloseWithCountBtn = document.getElementById('pdvCloseCashWithCountBtn');

  const metricCashSession = document.getElementById('metricCashSession');
  const cashSummaryStatus = document.getElementById('cashSummaryStatus');
  const cashSummaryOpenTime = document.getElementById('cashSummaryOpenTime');
  const cashSummaryOpeningAmount = document.getElementById('cashSummaryOpeningAmount');
  const cashSummarySales = document.getElementById('cashSummarySales');

  if (!boxes.length && !metricCashSession && !cashSummaryStatus) return;

  const session = state.cashSession;
  const analytics = getSessionAnalytics();
  const todaySales = getTodayValidSalesTotal();

  const _opName  = session?.operatorName || session?.operator?.name || '—';
  const _opRole  = session?.operator?.role || '';
  const _opAv    = _cashAv(_opName, _opRole);
  const _opCell  = (_opAv && _opName !== '—')
    ? `<div class="cs-op-row">${_opAv}<strong>${_esc(_opName)}</strong></div>`
    : `<strong>${_esc(_opName)}</strong>`;

  const _authName = session?.openingAmountDefinedByName || session?.authorizedByName || '—';
  const _authRole = session?.openingAmountDefinedByRole || session?.authorizedByRole || '';
  const _authAv   = _cashAv(_authName, _authRole);
  const _authCell = (_authAv && _authName !== '—')
    ? `<div class="cs-op-row">${_authAv}<strong>${_esc(_authName)}</strong></div>`
    : `<strong>${_esc(_authName)}</strong>`;

  const html = !session
    ? `
      <div class="panel metric-card">
        <span class="mini">Status do caixa</span>
        <strong>Fechado</strong>
        <p class="mini">Abra o caixa para iniciar as vendas do dia.</p>
      </div>
    `
    : `
      <div class="dashboard-grid">
        <article class="panel metric-card">
          <span class="mini">Status</span>
          <strong>${session.isOpen ? 'Aberto' : 'Fechado'}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Valor inicial</span>
          <strong>${formatCurrency(session.openingAmount || 0)}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Vendas do dia</span>
          <strong>${formatCurrency(todaySales)}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Saldo esperado</span>
          <strong>${formatCurrency(Number(session.openingAmount || 0) + todaySales)}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Início</span>
          <strong>${formatDateTimeBR(session.openedAt)}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Expediente</span>
          <strong>${session.isOpen ? sessionDurationText(session.openedAt) : 'Encerrado'}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Terminal</span>
          <strong>${_esc(session.terminalName || 'Caixa principal')}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Operador</span>
          ${_opCell}
        </article>

        <article class="panel metric-card">
          <span class="mini">Valor inicial definido por</span>
          ${_authCell}
        </article>

        <article class="panel metric-card">
          <span class="mini">Fechamento</span>
          <strong>${session.closedAt ? formatDateTimeBR(session.closedAt) : '—'}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Valor contado</span>
          <strong>${session.closedAt ? formatCurrency(session.countedAmount || 0) : '—'}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Diferença</span>
          <strong>${session.closedAt ? formatCurrency(session.difference || 0) : '—'}</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Lucro/Hora</span>
          <strong>${analytics ? formatCurrency(analytics.profitPerHour) : '—'}</strong>
        </article>
      </div>
    `;

  boxes.forEach((box) => {
    box.innerHTML = html;
  });

  if (openBtn) openBtn.disabled = !!session?.isOpen;
  if (closeBtn) closeBtn.disabled = !session?.isOpen;
  if (pdvCloseBtn) pdvCloseBtn.disabled = !session?.isOpen;
  if (pdvCloseWithCountBtn) pdvCloseWithCountBtn.disabled = !session?.isOpen;

  if (metricCashSession) metricCashSession.textContent = session?.isOpen ? 'Aberto' : 'Fechado';
  if (cashSummaryStatus) cashSummaryStatus.textContent = session?.isOpen ? 'Aberto' : 'Fechado';

  if (cashSummaryOpenTime) {
    cashSummaryOpenTime.textContent = session?.openedAt
      ? new Date(session.openedAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';
  }

  if (cashSummaryOpeningAmount) {
    cashSummaryOpeningAmount.textContent = formatCurrency(session?.openingAmount || 0);
  }

  if (cashSummarySales) {
    cashSummarySales.textContent = formatCurrency(todaySales);
  }
}

/* ================= BIND ================= */

export function bindCashSessionActions() {
  if (cashActionsBound) return;
  cashActionsBound = true;

  document.getElementById('openCashBtn')?.addEventListener('click', () => {
    // SEMPRE exige senha admin — independente de simplified/controlled.
    const _doOpen = async () => {
      if (!_isSimplifiedPDV() && !state.operatorPinValidated) {
        const ok = await requirePDVOperatorSession('openCashBtn');
        if (!ok) return;
        state.operatorPinValidated = true;
      }
      await startPDVOpenCashFlow(true);
    };
    if (typeof window.requirePDVAdminAuthorization === 'function') {
      window.requirePDVAdminAuthorization('open-cash', _doOpen);
    } else {
      _doOpen(); // fallback — módulo kiosk não carregado
    }
  });

  document.getElementById('closeCashBtn')?.addEventListener('click', requestProtectedCashClose);

  document.getElementById('resetCashBtn')?.addEventListener('click', resetCashSession);
  document.getElementById('cashCountedAmount')?.addEventListener('input', updateCashCloseSummary);
  // "Atualizar resumo": busca a prévia de novo no backend (não só
  // re-renderiza o valor em cache) — cobre o caso de vendas novas terem
  // entrado na sessão enquanto o modal estava aberto.
  document.getElementById('previewCashCloseBtn')?.addEventListener('click', async () => {
    await fetchCashClosePreview();
    updateCashCloseSummary();
  });
  document.getElementById('printCashCloseBtn')?.addEventListener('click', printCashCloseReport);

  // Fase 3.1a — abre/fecha o modal de conferência. #pdvCloseCashBtn (Alt+X,
  // fechamento rápido) não é tocado — continua chamando closeCashSession()
  // direto, sem conferência, exatamente como antes.
  document.getElementById('pdvCloseCashWithCountBtn')?.addEventListener('click', openCashCloseConferenceModal);
  document.getElementById('cancelCashCloseConferenceBtn')?.addEventListener('click', hideCashCloseConferenceModal);

  document.getElementById('reopenCashBtn')?.addEventListener('click', () => {
    audit('cash_reopen_requested', { session: state.cashSession });
    // SEMPRE exige senha admin para reabrir caixa.
    if (typeof window.requirePDVAdminAuthorization === 'function') {
      window.requirePDVAdminAuthorization('reopen-cash', async () => {
        await reopenCashSession();
      });
    } else if (typeof window.openSecureCashCloseModal === 'function') {
      window.openSecureCashCloseModal(async () => { await reopenCashSession(); }, { forceAuth: true });
    }
  });

  document.getElementById('goDashboardAfterCashCloseBtn')?.addEventListener('click', () => {
    audit('cash_closed_dashboard_access_requested', { session: state.cashSession });

    const _go = () => {
      // Liberar kiosk antes de navegar — sem isso gov-nav bloqueia a navegação
      if (typeof window.releasePDVKioskMode === 'function') {
        window.releasePDVKioskMode();
      }
      const dashBtn = document.querySelector('.nav-btn[data-page="dashboard"]');
      if (dashBtn) dashBtn.click();
    };

    // Exige senha admin se kiosk ativo
    if (window.__pdvKioskActive && typeof window.requirePDVAdminAuthorization === 'function') {
      window.requirePDVAdminAuthorization('navigate-dashboard', _go);
    } else {
      _go(); // kiosk não ativo — nav normal pós-fechamento externo
    }
  });

  // Bind direto (backup — pode falhar se botões não estiverem no DOM ainda)
  const _openEl  = document.getElementById('cashClosedOpenCashBtn');
  const _accessEl = document.getElementById('cashClosedAuthorizedAccessBtn');
  console.log('[CashClosed DEBUG] bind | cashClosedOpenCashBtn:', !!_openEl, '| cashClosedAuthorizedAccessBtn:', !!_accessEl, '| running:', window.closedCashActionRunning);

  _openEl?.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    console.log('[CashClosed DEBUG] direct listener: Abrir novo caixa');
    window.handleClosedCashOpenNewCash?.();
  });
  _accessEl?.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    console.log('[CashClosed DEBUG] direct listener: Acesso autorizado');
    window.handleClosedCashAuthorizedAccess?.();
  });
}

/* ================= TELA CAIXA FECHADO — HANDLERS GLOBAIS ================= */

// Expõe handlers no window para que a delegação global e o bind direto usem a mesma lógica.
// Guard: window.closedCashActionRunning impede clique duplo.

function _closedCashGuard(authAction, onSuccess) {
  if (window.closedCashActionRunning) {
    console.warn('[CashClosed] ação em andamento — clique ignorado | running:', window.closedCashActionRunning);
    return;
  }
  window.closedCashActionRunning = true;
  const _done = () => { window.closedCashActionRunning = false; };

  if (typeof window.requirePDVAdminAuthorization === 'function') {
    window.requirePDVAdminAuthorization(
      authAction,
      async () => { try { await onSuccess(); } finally { _done(); } },
      _done
    );
  } else if (typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(
      async () => { try { await onSuccess(); } finally { _done(); } },
      { forceAuth: true, onCancel: _done }
    );
  } else {
    _done();
  }
}

window.handleClosedCashOpenNewCash = function handleClosedCashOpenNewCash() {
  console.log('[CashClosed] handleClosedCashOpenNewCash chamado | running:', window.closedCashActionRunning);
  _closedCashGuard('open-cash', async () => {
    audit('CASH_OPEN_AUTHORIZED', {
      authorizedBy: state.currentUser?.name || state.currentUser?.email || '—',
      operator:     state.currentOperator?.name || '—',
      terminal:     state.currentOperator?.terminalName || '—',
      dateTime:     new Date().toISOString()
    });

    // Perfil ativo (seletor pós-login) já identificou o operador por uma UI
    // diferente — nunca reabrir o modal antigo de identificação por cima
    // disso, mesmo que operatorPinValidated não esteja setado por algum
    // motivo pontual.
    const _hasActiveProfile = Boolean(state.activeProfile);
    console.log('[CASH-OPEN-DEBUG] handleClosedCashOpenNewCash antes do gate de identificação', {
      isSimplified: _isSimplifiedPDV(),
      operatorPinValidated: Boolean(state.operatorPinValidated),
      currentOperatorName: state.currentOperator?.name || null,
      activeProfile: state.activeProfile?.profile || null,
    });
    if (!_hasActiveProfile && !_isSimplifiedPDV() && !state.operatorPinValidated) {
      console.log('[CASH-OPEN-DEBUG] ⚠️ chamando requirePDVOperatorSession (modal antigo de identificação)');
      const ok = await requirePDVOperatorSession('cashClosedOpenCashBtn');
      if (!ok) return;
      state.operatorPinValidated = true;
    }

    const _goToPDV = () => {
      document.removeEventListener('gamby:cash-opened', _goToPDV);
      if (typeof window.openPageDirect === 'function') window.openPageDirect('pdv');
    };
    document.addEventListener('gamby:cash-opened', _goToPDV);
    // _forceReauth: true quando há perfil ativo — "Abrir novo caixa" aqui é
    // sempre um caixa NOVO (a tela de caixa fechado só aparece quando não há
    // sessão ativa), então mesmo que state.cashSession?.isOpen esteja
    // incorretamente true por algum cache desatualizado, forçamos a
    // reconfirmação de senha em vez de silenciosamente retomar uma sessão
    // que não deveria existir neste ponto — em vez de pular o modal de valor
    // inicial (mesmo raciocínio do 'gamby:profile-selected', ver acima).
    await startPDVOpenCashFlow(true, _hasActiveProfile);
    if (state.cashSession?.isOpen) {
      document.removeEventListener('gamby:cash-opened', _goToPDV);
      if (typeof window.openPageDirect === 'function') window.openPageDirect('pdv');
    }
  });
};

// Regra final (substitui a versão anterior que ia direto ao Dashboard): o
// erro do commit f89595b não foi chamar showProfileSelector() — foi chamá-la
// SEM ANTES encerrar o contexto do Operador (kiosk/PIN/perfil), deixando o
// seletor aberto por cima de um estado que ainda achava que era Operador.
// Agora: valida a credencial admin → encerra de fato o contexto do Operador
// → só então abre showProfileSelector(), para a pessoa escolher como entra.
window.handleClosedCashAuthorizedAccess = function handleClosedCashAuthorizedAccess() {
  console.log('[CashClosed] handleClosedCashAuthorizedAccess chamado | running:', window.closedCashActionRunning);
  _closedCashGuard('navigate-dashboard', async () => {
    // result.approvedBy = { id, name, role } — identifica quem realmente
    // digitou a senha (POST /v1/authorization → authorizeAction(), backend),
    // não o papel do JWT do dispositivo. Stashed por confirmSecureCashCloseModal()
    // em state._pendingCashApprovedBy, consumido aqui uma única vez.
    const approvedBy = state._pendingCashApprovedBy || null;
    state._pendingCashApprovedBy = null;
    const role = String(approvedBy?.role || '').toLowerCase();

    // Bootstrap provisório (senha 000000): o backend só devolve isso quando
    // NENHUM administrador/gerente da empresa tem senha configurada ainda —
    // não existe approvedBy porque não há "quem" aprovar, mas o backend já
    // decidiu que é válido. BUG CONFIRMADO: sem checar isso, role virava
    // string vazia e uma senha 000000 correta era rejeitada como se fosse
    // credencial sem permissão administrativa.
    const _isProvisional = Boolean(state._pendingCashProvisional);
    state._pendingCashProvisional = false;

    // Este fluxo é exclusivo de Administrador (desenvolvedora/developer_master
    // tratados como equivalentes — têm acesso total, mas não fazem parte de
    // SELECTABLE_PROFILES do seletor de perfil). Gerente e Operador: negado.
    const _isAdmin = role === 'administrador' || role === 'desenvolvedora' || role === 'developer_master' || _isProvisional;
    if (!_isAdmin) {
      // Credencial válida (backend autenticou alguém), mas sem função
      // administrativa — nunca eleva Gerente/Operador. Mensagem específica
      // pedida, distinta da de senha inválida (essa é tratada pelo próprio
      // modal compartilhado, antes deste callback sequer rodar — ver
      // confirmSecureCashCloseModal() em app.js, usado por várias outras
      // ações de PDV; não alterado aqui para não afetar essas outras ações).
      showToast('Acesso negado. Esta credencial não possui permissão administrativa.', 'error');
      audit('acesso_autorizado_negado', {
        solicitadoPor: state.currentUser?.name || state.currentUser?.email || '—',
        usuarioValidado: approvedBy?.name || '—',
        funcaoValidada: role || 'desconhecida (senha provisória ou sem approvedBy)',
        operadorAtivo: state.currentOperator?.name || '—',
        terminal: state.currentOperator?.terminalName || '—',
        companyId: state.currentUser?.companyId || null,
        motivoFalha: 'credencial sem função administrativa',
        resultado: 'negado',
        saidaContextoOperacional: false,
        entradaAmbienteAdministrativo: false,
        dateTime: new Date().toISOString()
      });
      return; // permanece no PDV / tela de caixa fechado — sem alterar layout
    }

    audit('acesso_autorizado', {
      solicitadoPor: state.currentUser?.name || state.currentUser?.email || '—',
      usuarioValidado: approvedBy?.name || '—',
      funcaoValidada: 'administrador',
      operadorAtivo: state.currentOperator?.name || '—',
      terminal: state.currentOperator?.terminalName || '—',
      companyId: state.currentUser?.companyId || null,
      resultado: 'autorizado',
      saidaContextoOperacional: true,
      entradaAmbienteAdministrativo: true,
      dateTime: new Date().toISOString()
    });

    // 1) Encerra de fato o contexto restrito do Operador ANTES de abrir
    // qualquer outra tela — clearOperatorSession() fecha o "turno"/PIN
    // (mesma função usada ao fechar/trocar de operador de verdade) e
    // clearActiveProfile() derruba o perfil simulado (ex.: 'operador') e sua
    // persistência em sessionStorage. Chamar showProfileSelector() ANTES
    // disso (o erro do commit f89595b) deixava o seletor aberto por cima de
    // um estado que ainda pensava ser Operador — reload ou "Operador" no
    // seletor caía num híbrido quebrado em vez de um contexto limpo.
    clearOperatorSession();
    clearActiveProfile();

    const screen = document.getElementById('cashClosedScreen');
    if (screen) {
      screen.classList.add('hidden');
      screen.classList.add('no-pointer-events'); // substitui screen.style.pointerEvents='none' (CSP)
    }

    // Remover overlay residual "Sair/Sistema" ANTES de liberar kiosk
    document.getElementById('pdvExitOptionsOverlay')?.remove();

    if (typeof window.releasePDVKioskMode === 'function') {
      window.releasePDVKioskMode(); // também remove pdvExitOptionsOverlay internamente
    } else {
      document.body.classList.remove('pdv-only-mode', 'pdv-kiosk-active');
      document.querySelector('.app-shell')?.classList.remove('pdv-fullscreen');
      document.getElementById('pdvExitOptionsOverlay')?.remove();
    }

    // 2) Marca esta sessão do seletor como "veio do Acesso autorizado" —
    // consumida por profile-selector.js quando a pessoa escolhe um perfil:
    //   - Administrador: _selectAdministrador() exige uma segunda senha
    //     administrativa (requirePDVAdminAuthorization) antes de liberar o
    //     Dashboard e, ao confirmar, seta activeProfile.restrictPdv = true —
    //     lido por gov-access.js:canNavigate() para excluir 'pdv' do menu em
    //     toda navegação futura e após reload (não apenas uma vez).
    //   - Operador/Gerente: apenas consome/zera a flag (_confirmPin()), sem
    //     exigir senha extra.
    // Não afeta a seleção normal de Administrador feita fora deste fluxo
    // (login → seletor), que nunca seta esta flag.
    state._acessoAutorizadoPendingConfirm = true;

    // 3) Só agora abre "Como você vai acessar hoje?" — a pessoa que acabou de
    // validar a senha administrativa escolhe Administrador ou Operador.
    // LIMITE DE ARQUITETURA (já relatado, não inventei persistência nova):
    // POST /v1/authorization é autorização PONTUAL (não emite token/sessão
    // novos) — o backend só reconhece o role assinado no JWT real. Se o JWT
    // real deste dispositivo já é administrador (uso estabelecido: admin
    // simulando Operador), escolher Administrador no seletor é sólido. Se o
    // JWT real for de um Operador de verdade, o Dashboard abre mas qualquer
    // rota admin-only responderá 403 do backend — quebrado, não inseguro.
    await showProfileSelector();
  });
};

// ── Delegação global em fase de CAPTURA ──────────────────────────────────────
// Intercept ANTES de qualquer pointer-events, z-index ou overlay invisível.
// Essa delegação garante que os botões respondam mesmo que o bind direto falhe.
// Registrada UMA única vez via flag global.
if (!window.__cashClosedDelegationBound) {
  window.__cashClosedDelegationBound = true;

  document.addEventListener('click', (event) => {
    const openBtn   = event.target.closest('#cashClosedOpenCashBtn');
    const accessBtn = event.target.closest('#cashClosedAuthorizedAccessBtn');

    if (!openBtn && !accessBtn) return;

    console.log('[CashClosed DEBUG] delegação capture: target=', event.target.id || event.target.tagName,
      '| openBtn:', !!openBtn, '| accessBtn:', !!accessBtn,
      '| running:', window.closedCashActionRunning);

    event.preventDefault();
    event.stopPropagation();

    if (openBtn) {
      console.log('[CashClosed] delegação → handleClosedCashOpenNewCash');
      window.handleClosedCashOpenNewCash?.();
    } else {
      console.log('[CashClosed] delegação → handleClosedCashAuthorizedAccess');
      window.handleClosedCashAuthorizedAccess?.();
    }
  }, true); // true = fase de CAPTURA — intercepta antes de qualquer outro handler
}

/* ================= GLOBAL ================= */

window.startPDVOpenCashFlow = startPDVOpenCashFlow;

// Fechar caixa com senha administrativa obrigatória — chamado pelo modal Sair/Sistema
window.closePDVCashFlow = async function closePDVCashFlow() {
  if (!state.cashSession?.isOpen) {
    return; // sem caixa aberto — ignorar silenciosamente
  }

  const _doClose = async () => {
    await closeCashSession();
  };

  if (typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(_doClose, { forceAuth: true });
  } else {
    await _doClose();
  }
};