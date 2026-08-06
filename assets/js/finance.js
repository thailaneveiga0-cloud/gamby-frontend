import { state } from './state.js';
import { formatCurrency, formatDateTimeBR } from './utils.js';
import { getFinanceSummaryService, getFinanceEntriesService } from './services/finance-service.js';

export function fmt(value) { return formatCurrency(value); }

export function getFinanceSummary() {
  const validSales = (state.sales || []).filter(sale => !sale.cancelled);
  const totalSales = validSales.reduce((acc, sale) => acc + Number(sale.total || 0), 0);
  const totalItems = validSales.reduce((acc, sale) => acc + Number(sale.itemsCount || 0), 0);
  const opening = Number(state.cashSession?.openingAmount || 0);
  const currentBalance = opening + totalSales;
  const cancellations = (state.sales || []).filter(sale => sale.cancelled).reduce((acc,sale)=>acc+Number(sale.total||0),0);
  return { opening, totalSales, totalItems, currentBalance, salesCount: validSales.length, cancellations };
}

async function renderFinanceTable() {
  const tbody = document.getElementById('financeMovementsTableBody');
  if (!tbody) return;
  let rows = [];
  try {
    const entries = await getFinanceEntriesService();
    if (Array.isArray(entries) && entries.length) {
      rows = entries.map(entry => ({ date: entry.occurredAt || entry.createdAt, type: entry.type, desc: entry.description || entry.category || '-', amount: Number(entry.amount || 0) * (entry.type === 'expense' ? -1 : 1) }));
    }
  } catch {
    /* fallback local */
  }
  if (!rows.length) {
    if (state.cashSession?.openedAt) rows.push({ date: state.cashSession.openedAt, type: 'Abertura', desc: 'Abertura do caixa', amount: Number(state.cashSession.openingAmount || 0) });
    (state.sales || []).forEach(sale => rows.push({ date: sale.cancelledAt || sale.createdAt, type: sale.cancelled ? 'Cancelamento' : 'Venda', desc: `${sale.paymentMethod} • ${sale.itemsCount} itens`, amount: sale.cancelled ? -Number(sale.total || 0) : Number(sale.total || 0) }));
  }
  tbody.innerHTML = rows.length ? rows.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(row => `<tr><td>${formatDateTimeBR(row.date)}</td><td>${row.type}</td><td>${row.desc}</td><td>${formatCurrency(row.amount)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Sem movimentações financeiras.</td></tr>';
}

export async function renderFinance() {
  const financeBox = document.getElementById('financeSummary');
  const dashboardSales = document.getElementById('metricSales');
  const dashboardBalance = document.getElementById('metricBalance');
  const dashboardSession = document.getElementById('metricCashSession');
  let summary = getFinanceSummary();
  try {
    const backendSummary = await getFinanceSummaryService();
    if (backendSummary) {
      summary = {
        opening: Number(state.cashSession?.openingAmount || 0),
        totalSales: Number(backendSummary.todaySalesTotal || 0),
        totalItems: Number(backendSummary.stockItemsCount || 0),
        currentBalance: Number(backendSummary.cashBalance || 0),
        salesCount: state.sales.filter(s => !s.cancelled).length,
        cancellations: 0,
        estimatedProfit: Number(backendSummary.estimatedProfit || 0)
      };
    }
  } catch {
    /* fallback local */
  }

  if (dashboardSales) dashboardSales.textContent = formatCurrency(summary.totalSales);
  if (dashboardBalance) dashboardBalance.textContent = formatCurrency(summary.currentBalance);
  if (dashboardSession) dashboardSession.textContent = state.cashSession?.isOpen ? 'Aberto' : 'Fechado';

  if (financeBox) {
    financeBox.innerHTML = `
      <div class="dashboard-grid">
        <article class="panel metric-card"><span class="mini">Abertura do caixa</span><strong>${formatCurrency(summary.opening)}</strong></article>
        <article class="panel metric-card"><span class="mini">Vendas válidas do dia</span><strong>${formatCurrency(summary.totalSales)}</strong></article>
        <article class="panel metric-card"><span class="mini">Cancelamentos</span><strong>${formatCurrency(summary.cancellations)}</strong></article>
        <article class="panel metric-card"><span class="mini">Saldo atual</span><strong>${formatCurrency(summary.currentBalance)}</strong></article>
      </div>
      <div class="panel" style="margin-top:18px;">
        <h3>Movimentações financeiras</h3>
        <div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th></tr></thead><tbody id="financeMovementsTableBody"></tbody></table></div>
      </div>
    `;
  }
  await renderFinanceTable();
}
