import { state } from './state.js';
import { formatCurrency, formatDateTimeBR } from './utils.js';
import {
  getFinanceSummaryService,
  getFinanceEntriesService
} from './services/finance-service.js';

/* ================= SECURITY + AVATAR HELPERS ================= */

function _esc(v) {
  return String(v || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function _financeAv(name) {
  if (typeof window.renderUserAvatar !== 'function' || !name || name === '—') return '';
  const users = Array.isArray(state?.internalUsers) ? state.internalUsers : [];
  const u = users.find(u => (u.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return window.renderUserAvatar(
    { name, photoUrl: u?.photoUrl || window.getUserAvatar?.(name) || null, role: u?.role || '' },
    { cls: 'av', size: 'sm' }
  );
}

/* ================= MODULE STATE ================= */

let _period      = 'today';
let _customStart = null;
let _customEnd   = null;
let _finPage     = 1;
let _finPerPage  = 10;
let _finSearch   = '';
let _finType     = 'all';
let _movements   = [];

/* ================= HELPERS ================= */

export function fmt(value) {
  return formatCurrency(value);
}

function getSaleItems(sale) {
  if (Array.isArray(sale?.items))    return sale.items;
  if (Array.isArray(sale?.products)) return sale.products;
  if (Array.isArray(sale?.cart))     return sale.cart;
  return [];
}

function getItemQty(item) {
  return Number(item?.quantity ?? item?.qty ?? item?.amount ?? 1);
}

function getItemPrice(item) {
  return Number(item?.price ?? item?.unitPrice ?? item?.salePrice ?? 0);
}

function getItemCost(item) {
  const direct = Number(item?.cost ?? item?.unitCost ?? 0);
  if (direct > 0) return direct;
  const found = (state.products || []).find(p =>
    p.code === (item?.code || item?.productCode) ||
    p.barcode === item?.barcode ||
    String(p.id) === String(item?.productId || item?.id)
  );
  return Number(found?.cost ?? 0);
}

function computeSaleProfit(sale) {
  const items = getSaleItems(sale);
  if (!items.length) return 0;
  return items.reduce((acc, item) => {
    return acc + (getItemPrice(item) - getItemCost(item)) * getItemQty(item);
  }, 0);
}

/* ================= PERIOD ================= */

function getPeriodRange() {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eod   = new Date(today.getTime() + 86400000 - 1);

  switch (_period) {
    case 'today':
      return { start: today, end: eod };
    case 'yesterday': {
      const s = new Date(today); s.setDate(s.getDate() - 1);
      return { start: s, end: new Date(today.getTime() - 1) };
    }
    case '7days': {
      const s = new Date(today); s.setDate(s.getDate() - 6);
      return { start: s, end: eod };
    }
    case '30days': {
      const s = new Date(today); s.setDate(s.getDate() - 29);
      return { start: s, end: eod };
    }
    case 'month':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      };
    case 'custom': {
      const s = _customStart ? new Date(_customStart + 'T00:00:00') : today;
      const e = _customEnd   ? new Date(_customEnd   + 'T23:59:59') : eod;
      return { start: s, end: e };
    }
    default:
      return { start: new Date(0), end: new Date() };
  }
}

function inRange(date, range) {
  const d = date instanceof Date ? date : new Date(date);
  return !isNaN(d) && d >= range.start && d <= range.end;
}

/* ================= BUILD MOVEMENTS ================= */

function buildMovements() {
  const range = getPeriodRange();
  const rows  = [];

  // Abertura de caixa
  if (state.cashSession?.openedAt) {
    const d = new Date(state.cashSession.openedAt);
    if (inRange(d, range)) {
      rows.push({
        date: d, type: 'Abertura', origin: 'Caixa',
        desc: 'Abertura do caixa', paymentMethod: 'Dinheiro',
        amount: Number(state.cashSession.openingAmount || 0),
        isEntry: true, profit: null,
        operator: state.cashSession.openedBy || state.currentUser?.name || 'Admin'
      });
    }
  }

  // Suprimentos
  const suprimentos = state.cashSession?.suprimentos || state.cashSession?.supplements || [];
  suprimentos.forEach(s => {
    const d = new Date(s.createdAt || s.date || Date.now());
    if (!inRange(d, range)) return;
    rows.push({
      date: d, type: 'Suprimento', origin: 'Caixa',
      desc: s.reason || 'Suprimento de caixa', paymentMethod: 'Dinheiro',
      amount: Number(s.amount || 0),
      isEntry: true, profit: null,
      operator: s.operatorName || s.operator || 'Admin'
    });
  });

  // Sangrias
  const sangrias = state.cashSession?.withdrawals || state.cashSession?.sangrias || [];
  sangrias.forEach(w => {
    const d = new Date(w.createdAt || w.date || Date.now());
    if (!inRange(d, range)) return;
    rows.push({
      date: d, type: 'Sangria', origin: 'Caixa',
      desc: w.reason || 'Sangria autorizada', paymentMethod: 'Dinheiro',
      amount: Number(w.amount || 0),
      isEntry: false, profit: null,
      operator: w.operatorName || w.operator || 'Admin'
    });
  });

  // Vendas e cancelamentos
  (state.sales || []).forEach(sale => {
    const d = new Date(sale.cancelledAt || sale.createdAt || Date.now());
    if (!inRange(d, range)) return;

    const cancelled = Boolean(sale.cancelled);
    const total     = Number(sale.total || 0);
    const profit    = computeSaleProfit(sale);
    const num       = sale.id || sale.number || sale._id || '???';

    rows.push({
      date: d,
      type: cancelled ? 'Cancelamento' : 'Venda',
      origin: `Venda #${num}`,
      desc:   cancelled ? `Cancelamento #${num}` : `Pedido #${num}`,
      paymentMethod: sale.paymentMethod || '—',
      amount: total,
      isEntry: !cancelled,
      profit: cancelled ? -Math.abs(profit) : profit,
      operator: sale.operatorName || sale.operator || 'Admin'
    });
  });

  // Fechamento de caixa
  if (state.cashSession?.closedAt) {
    const d = new Date(state.cashSession.closedAt);
    if (inRange(d, range)) {
      rows.push({
        date: d, type: 'Fechamento', origin: 'Caixa',
        desc: 'Fechamento do caixa', paymentMethod: 'Dinheiro',
        amount: Number(state.cashSession.closingBalance || state.cashSession.closingAmount || 0),
        isEntry: false, profit: null,
        operator: state.cashSession.closedBy || 'Admin'
      });
    }
  }

  return rows.sort((a, b) => a.date - b.date);
}

/* ================= COMPUTE SUMMARY ================= */

function computeSummary(movements) {
  const opening = Number(state.cashSession?.openingAmount || 0);
  let totalSales = 0, totalCancelled = 0, cancellationsCount = 0;
  let totalCost = 0, totalSangria = 0, totalSuprimento = 0, grossProfit = 0;

  movements.forEach(m => {
    switch (m.type) {
      case 'Venda':
        totalSales += m.amount;
        if (m.profit != null) {
          grossProfit += m.profit;
          totalCost   += m.amount - m.profit;
        }
        break;
      case 'Cancelamento':
        totalCancelled += m.amount;
        cancellationsCount++;
        break;
      case 'Sangria':
        totalSangria += m.amount;
        break;
      case 'Suprimento':
        totalSuprimento += m.amount;
        break;
    }
  });

  const netBalance = opening + totalSales + totalSuprimento - totalCancelled - totalSangria;

  return {
    opening, totalSales, totalCost, grossProfit,
    cancellationsCount, totalCancelled, totalSangria, totalSuprimento,
    netBalance, netProfit: grossProfit
  };
}

/* ================= CHART TIME GROUPER ================= */

function getTimeGrouper() {
  const range    = getPeriodRange();
  const diffDays = (range.end - range.start) / 86400000;

  if (diffDays <= 1) {
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}h`);
    return { labels, size: 24, grouper: d => d.getHours() };
  }

  if (diffDays <= 31) {
    const labels = [];
    const cur    = new Date(range.start);
    while (cur <= range.end) {
      labels.push(`${String(cur.getDate()).padStart(2,'0')}/${String(cur.getMonth()+1).padStart(2,'0')}`);
      cur.setDate(cur.getDate() + 1);
    }
    const startTs = range.start.getTime();
    return { labels, size: labels.length, grouper: d => Math.floor((d.getTime() - startTs) / 86400000) };
  }

  // Group by week
  const labels  = [];
  const cur     = new Date(range.start);
  while (cur <= range.end) {
    labels.push(`Sem ${labels.length + 1}`);
    cur.setDate(cur.getDate() + 7);
  }
  const startTs = range.start.getTime();
  return { labels, size: labels.length, grouper: d => Math.floor((d.getTime() - startTs) / (7 * 86400000)) };
}

/* ================= ICON HELPER ================= */

function finIcon(path) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/* ================= TYPE CHIP ================= */

function typeChip(type) {
  const map = {
    'Abertura':     { color: '#60a5fa', bg: 'rgba(37,99,235,0.13)',   label: 'Abertura de caixa' },
    'Venda':        { color: '#4ade80', bg: 'rgba(34,197,94,0.12)',    label: 'Venda concluída' },
    'Cancelamento': { color: '#f87171', bg: 'rgba(239,68,68,0.13)',    label: 'Venda cancelada' },
    'Sangria':      { color: '#fbbf24', bg: 'rgba(245,158,11,0.13)',   label: 'Sangria' },
    'Suprimento':   { color: '#22d3ee', bg: 'rgba(6,182,212,0.13)',    label: 'Suprimento' },
    'Fechamento':   { color: '#c084fc', bg: 'rgba(139,92,246,0.13)',   label: 'Fechamento de caixa' }
  };
  const s = map[type] || map['Venda'];
  const span = document.createElement('span');
  span.className = 'fin-status-pill';
  span.textContent = s.label;
  span.style.color = s.color;
  span.style.background = s.bg;
  return span.outerHTML;
}

/* ================= RENDER KPI CARDS ================= */

function renderKpiCards(s) {
  return `
  <div class="fin-kpi-4col">
    <article class="dashboard-kpi-card green">
      <div class="kpi-icon">${finIcon('<path d="M19 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><polyline points="16 7 12 3 8 7"/>')}</div>
      <div><span>Abertura do caixa</span><strong>${fmt(s.opening)}</strong><small>Valor inicial</small></div>
    </article>
    <article class="dashboard-kpi-card blue">
      <div class="kpi-icon">${finIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>')}</div>
      <div><span>Faturamento bruto</span><strong>${fmt(s.totalSales)}</strong><small>Total de vendas</small></div>
    </article>
    <article class="dashboard-kpi-card purple">
      <div class="kpi-icon">${finIcon('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>')}</div>
      <div><span>Custo total</span><strong>${fmt(s.totalCost)}</strong><small>Custo das vendas</small></div>
    </article>
    <article class="dashboard-kpi-card yellow">
      <div class="kpi-icon">${finIcon('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>')}</div>
      <div><span>Lucro bruto estimado</span><strong>${fmt(s.grossProfit)}</strong><small>Faturamento − Custo</small></div>
    </article>
  </div>
  <div class="fin-kpi-4col-b">
    <article class="dashboard-kpi-card fin-kpi-red">
      <div class="kpi-icon fin-ico-red">${finIcon('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>')}</div>
      <div><span>Cancelamentos</span><strong class="fin-val-red">${s.cancellationsCount}</strong><small>Vendas canceladas</small></div>
    </article>
    <article class="dashboard-kpi-card fin-kpi-red">
      <div class="kpi-icon fin-ico-red">${finIcon('<circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9H10.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H9"/>')}</div>
      <div><span>Valor cancelado</span><strong class="fin-val-red">${fmt(s.totalCancelled)}</strong><small>Total cancelado</small></div>
    </article>
    <article class="dashboard-kpi-card green">
      <div class="kpi-icon">${finIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>')}</div>
      <div><span>Saldo atual (caixa)</span><strong>${fmt(s.netBalance)}</strong><small>Disponível no caixa</small></div>
    </article>
    <article class="dashboard-kpi-card green">
      <div class="kpi-icon">${finIcon('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>')}</div>
      <div><span>Saldo de lucro</span><strong>${fmt(s.netProfit)}</strong><small>Lucro líquido atual</small></div>
    </article>
  </div>`;
}

/* ================= RENDER DEMONSTRATIVO ================= */

function renderDemonstrativo(s) {
  return `
  <article class="panel">
    <h3 class="fin-dem-head">Demonstrativo do período</h3>
    <div class="fin-dem-wrap">
      <div class="fin-dem-row"><span class="fin-dem-lbl">Abertura do caixa</span><strong class="fin-dem-val-g">${fmt(s.opening)}</strong></div>
      <div class="fin-dem-row"><span class="fin-dem-lbl">+ Faturamento bruto</span><strong class="fin-dem-val-g">${fmt(s.totalSales)}</strong></div>
      <div class="fin-dem-row"><span class="fin-dem-lbl">− Cancelamentos</span><strong class="fin-dem-val-r">−${fmt(s.totalCancelled)}</strong></div>
      <div class="fin-dem-row"><span class="fin-dem-lbl">− Sangrias / Saídas</span><strong class="fin-dem-val-r">−${fmt(s.totalSangria)}</strong></div>
      <div class="fin-dem-row"><span class="fin-dem-lbl">− Custos dos produtos vendidos</span><strong class="fin-dem-val-r">−${fmt(s.totalCost)}</strong></div>
      <div class="fin-dem-total"><span>= Saldo financeiro (caixa)</span><strong class="fin-dem-val-b">${fmt(s.netBalance)}</strong></div>
      <div class="fin-dem-row-b"><span>= Lucro líquido do período</span><strong class="fin-dem-val-g">${fmt(s.netProfit)}</strong></div>
    </div>
  </article>`;
}

/* ================= RENDER CHARTS HTML ================= */

function renderChartsHtml(s) {
  return `
  <article class="premium-card">
    <div class="card-head"><h3>Entradas x Saídas</h3></div>
    <div class="dashboard-chart-wrap fin-chart-h130"><canvas id="finEntradasSaidasChart"></canvas></div>
  </article>
  <article class="premium-card">
    <div class="card-head"><h3>Faturamento x Custo x Lucro</h3></div>
    <div class="dashboard-chart-wrap fin-chart-h130"><canvas id="finFaturamentoCustoChart"></canvas></div>
  </article>
  <article class="premium-card">
    <div class="card-head"><h3>Cancelamentos no período</h3></div>
    <div class="dashboard-chart-wrap fin-chart-h130"><canvas id="finCancelamentosChart"></canvas></div>
    <div class="fin-canc-foot">
      <span class="fin-canc-lbl">Total: ${s.cancellationsCount} cancelamento(s)</span>
      <strong class="fin-canc-tot">Total: ${fmt(s.totalCancelled)}</strong>
    </div>
  </article>`;
}

/* ================= INIT CHARTS ================= */

function initFinanceCharts(movements, summary) {
  if (typeof Chart === 'undefined') return;

  const { labels, size, grouper } = getTimeGrouper();

  const baseScales = {
    x: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      ticks: { color: 'rgba(238,243,255,0.45)', font: { size: 10 }, maxRotation: 0, maxTicksLimit: 10 }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      ticks: { color: 'rgba(238,243,255,0.45)', font: { size: 10 }, callback: v => `R$${v}` }
    }
  };

  /* Chart 1 — Entradas x Saídas */
  const c1 = document.getElementById('finEntradasSaidasChart');
  if (c1) {
    if (c1._chart) c1._chart.destroy();
    const entradas = movements.filter(m => m.isEntry).reduce((a, m) => a + m.amount, 0);
    const saidas   = movements.filter(m => !m.isEntry).reduce((a, m) => a + m.amount, 0);
    c1._chart = new Chart(c1, {
      type: 'bar',
      data: {
        labels: ['Entradas', 'Saídas'],
        datasets: [{
          data: [entradas, saidas],
          backgroundColor: ['rgba(34,197,94,0.75)', 'rgba(239,68,68,0.7)'],
          borderRadius: 7,
          label: ''
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } }
        },
        scales: baseScales
      }
    });
  }

  /* Chart 2 — Faturamento x Custo x Lucro */
  const c2 = document.getElementById('finFaturamentoCustoChart');
  if (c2) {
    if (c2._chart) c2._chart.destroy();
    c2._chart = new Chart(c2, {
      type: 'bar',
      data: {
        labels: ['Faturamento', 'Custo', 'Lucro'],
        datasets: [{
          data: [summary.totalSales, summary.totalCost, summary.grossProfit],
          backgroundColor: ['rgba(37,99,235,0.78)', 'rgba(139,92,246,0.72)', 'rgba(34,197,94,0.72)'],
          borderRadius: 7,
          label: ''
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: 'rgba(238,243,255,0.6)', font: { size: 10 }, boxWidth: 10, padding: 12,
              generateLabels: () => [
                { text: 'Faturamento', fillStyle: 'rgba(37,99,235,0.78)',   strokeStyle: 'transparent', hidden: false },
                { text: 'Custo',       fillStyle: 'rgba(139,92,246,0.72)',   strokeStyle: 'transparent', hidden: false },
                { text: 'Lucro',       fillStyle: 'rgba(34,197,94,0.72)',    strokeStyle: 'transparent', hidden: false }
              ]
            }
          },
          tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } }
        },
        scales: baseScales
      }
    });
  }

  /* Chart 3 — Cancelamentos por período */
  const c3 = document.getElementById('finCancelamentosChart');
  if (c3) {
    if (c3._chart) c3._chart.destroy();
    const countData = new Array(size).fill(0);
    const valueData = new Array(size).fill(0);
    movements.filter(m => m.type === 'Cancelamento').forEach(m => {
      const idx = Math.max(0, Math.min(size - 1, grouper(m.date)));
      countData[idx]++;
      valueData[idx] += m.amount;
    });
    c3._chart = new Chart(c3, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Quantidade',
            data: countData,
            borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',
            tension: 0.4, pointRadius: 3, fill: false, yAxisID: 'y'
          },
          {
            label: 'Valor (R$)',
            data: valueData,
            borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',
            tension: 0.4, pointRadius: 3, fill: false, yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: 'rgba(238,243,255,0.6)', font: { size: 10 }, boxWidth: 10, padding: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => ctx.datasetIndex === 1 ? ` ${fmt(ctx.raw)}` : ` ${ctx.raw}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: 'rgba(238,243,255,0.45)', font: { size: 10 }, maxRotation: 0, maxTicksLimit: 10 }
          },
          y: {
            position: 'left', grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#ef4444', font: { size: 9 } },
            title: { display: false }
          },
          y2: {
            position: 'right', grid: { drawOnChartArea: false },
            ticks: { color: '#f59e0b', font: { size: 9 }, callback: v => `R$${v}` }
          }
        }
      }
    });
  }
}

/* ================= TABLE RENDERING ================= */

function getFilteredRows() {
  let rows = [..._movements];

  if (_finType !== 'all') {
    rows = rows.filter(r => r.type === _finType);
  }

  if (_finSearch.trim()) {
    const q = _finSearch.toLowerCase();
    rows = rows.filter(r =>
      (r.desc          || '').toLowerCase().includes(q) ||
      (r.origin        || '').toLowerCase().includes(q) ||
      (r.type          || '').toLowerCase().includes(q) ||
      (r.paymentMethod || '').toLowerCase().includes(q) ||
      (r.operator      || '').toLowerCase().includes(q)
    );
  }

  return rows;
}

function renderMovementsTable() {
  const tbody  = document.getElementById('financeMovementsTableBody');
  const infoEl = document.getElementById('finMovPaginationInfo');
  if (!tbody) return;

  const filtered = getFilteredRows();

  // Compute running balance in chronological order
  const chronological = [...filtered].sort((a, b) => a.date - b.date);
  let balance = Number(state.cashSession?.openingAmount || 0);
  chronological.forEach(r => {
    if (r.type === 'Abertura') balance = Number(state.cashSession?.openingAmount || 0);
    else if (r.isEntry)        balance += r.amount;
    else                       balance -= r.amount;
    r._balance = balance;
  });

  // Display newest first
  const sorted     = chronological.reverse();
  const total      = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / _finPerPage));
  _finPage         = Math.min(_finPage, totalPages);
  const start      = (_finPage - 1) * _finPerPage;
  const pageRows   = sorted.slice(start, start + _finPerPage);

  if (infoEl) {
    infoEl.textContent = total > 0
      ? `Exibindo ${start + 1} a ${Math.min(start + _finPerPage, total)} de ${total} movimentações`
      : 'Sem movimentações no período selecionado';
  }

  tbody.innerHTML = pageRows.length
    ? pageRows.map(r => {
        const entVal  = r.isEntry
          ? `<span class="fin-val-g">${fmt(r.amount)}</span>`
          : `<span class="fin-val-muted">—</span>`;
        const saiVal  = !r.isEntry
          ? `<span class="fin-val-r">${fmt(r.amount)}</span>`
          : `<span class="fin-val-muted">—</span>`;
        const lucroVal = r.profit != null
          ? r.profit >= 0
            ? `<span class="fin-val-g">${fmt(r.profit)}</span>`
            : `<span class="fin-val-r">−${fmt(Math.abs(r.profit))}</span>`
          : `<span class="fin-val-muted">—</span>`;
        return `<tr>
          <td class="fin-td-date">${formatDateTimeBR(r.date)}</td>
          <td>${typeChip(r.type)}</td>
          <td class="fin-td-origin">${_esc(r.origin)}</td>
          <td class="fin-td-desc">${_esc(r.desc)}</td>
          <td class="fin-td-method">${_esc(r.paymentMethod)}</td>
          <td>${entVal}</td>
          <td>${saiVal}</td>
          <td>${lucroVal}</td>
          <td class="fin-td-bal">${fmt(r._balance)}</td>
          <td>
            <div class="rpt-op-cell fin-td-origin">
              ${_financeAv(r.operator)}${_esc(r.operator || '—')}
            </div>
          </td>
        </tr>`;
      }).join('')
    : '<tr><td class="fin-td-empty" colspan="10">Sem movimentações no período selecionado.</td></tr>';

  _renderPagination(totalPages);
}

function _renderPagination(totalPages) {
  const container = document.querySelector('#finMovPaginationRow .fin-pag-btns');
  if (!container) return;
  container.innerHTML = '';

  const make = (label, page, active, disabled) => {
    const btn = document.createElement('button');
    btn.className = active ? 'btn btn-ghost fin-pag-btn fin-pag-btn--active' : 'btn btn-ghost fin-pag-btn';
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', () => { _finPage = page; renderMovementsTable(); });
    return btn;
  };

  container.appendChild(make('‹', _finPage - 1, false, _finPage <= 1));

  const maxPages = Math.min(totalPages, 5);
  const startP   = Math.max(1, Math.min(_finPage - 2, totalPages - maxPages + 1));
  for (let i = startP; i < startP + maxPages && i <= totalPages; i++) {
    container.appendChild(make(String(i), i, i === _finPage, false));
  }

  container.appendChild(make('›', _finPage + 1, false, _finPage >= totalPages));
}

/* ================= MAIN RENDER ================= */

export async function renderFinance() {
  const box = document.getElementById('financeSummary');
  if (!box) return;

  _movements = buildMovements();
  const summary = computeSummary(_movements);

  // Sync dashboard metrics
  const elSales   = document.getElementById('metricSales');
  const elBalance = document.getElementById('metricBalance');
  const elSession = document.getElementById('metricCashSession');
  if (elSales)   elSales.textContent   = fmt(summary.totalSales);
  if (elBalance) elBalance.textContent = fmt(summary.netBalance);
  if (elSession) elSession.textContent = state.cashSession?.isOpen ? 'Aberto' : 'Fechado';

  // Try backend summary merge
  try {
    const bs = await getFinanceSummaryService();
    if (bs) { /* backend data available but we trust local state for now */ }
  } catch { /* use local */ }

  box.innerHTML = `
    ${renderKpiCards(summary)}

    <div class="fin-section-grid">
      ${renderDemonstrativo(summary)}
      ${renderChartsHtml(summary)}
    </div>

    <article class="panel">
      <div class="fin-filter-row">
        <h3>Movimentações financeiras</h3>
        <div class="fin-filter-grp">
          <select id="finTypeFilter" class="field fin-type-sel">
            <option value="all">Todas as movimentações</option>
            <option value="Venda">Vendas</option>
            <option value="Cancelamento">Cancelamentos</option>
            <option value="Sangria">Sangrias</option>
            <option value="Suprimento">Suprimentos</option>
            <option value="Abertura">Aberturas de caixa</option>
            <option value="Fechamento">Fechamentos de caixa</option>
          </select>
          <div class="fin-search-wrap">
            <input id="finSearchInput" class="field fin-search-inp" placeholder="Buscar movimentações..." />
            <svg class="fin-search-ico"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATA / HORA</th><th>TIPO</th><th>ORIGEM</th><th>DESCRIÇÃO</th>
              <th>FORMA DE PAGAMENTO</th><th>ENTRADA</th><th>SAÍDA</th>
              <th>LUCRO GERADO</th><th>SALDO</th><th>OPERADOR</th>
            </tr>
          </thead>
          <tbody id="financeMovementsTableBody"></tbody>
        </table>
      </div>
      <div id="finMovPaginationRow" class="fin-pag-row">
        <span id="finMovPaginationInfo">Exibindo movimentações</span>
        <div class="fin-pag-btns"></div>
      </div>
    </article>
  `;

  setTimeout(() => {
    initFinanceCharts(_movements, summary);
    renderMovementsTable();
    _bindTableFilters();
  }, 0);
}

/* ================= BIND TABLE FILTERS ================= */

function _bindTableFilters() {
  const typeEl = document.getElementById('finTypeFilter');
  if (typeEl) {
    typeEl.value = _finType;
    typeEl.addEventListener('change', e => {
      _finType = e.target.value;
      _finPage = 1;
      renderMovementsTable();
    });
  }

  const searchEl = document.getElementById('finSearchInput');
  if (searchEl) {
    searchEl.value = _finSearch;
    searchEl.addEventListener('input', e => {
      _finSearch = e.target.value;
      _finPage   = 1;
      renderMovementsTable();
    });
  }
}

/* ================= BIND PERIOD FILTERS (called once at init) ================= */

export function bindFinanceFilters() {
  const btns       = document.querySelectorAll('.finance-filter-btn[data-period]');
  const customRange = document.getElementById('finCustomDateRange');
  const dateStart  = document.getElementById('finDateStart');
  const dateEnd    = document.getElementById('finDateEnd');
  const applyBtn   = document.getElementById('finApplyCustomBtn');

  // Set today's date as default for custom range
  const todayStr = new Date().toISOString().slice(0, 10);
  if (dateStart && !dateStart.value) dateStart.value = todayStr;
  if (dateEnd   && !dateEnd.value)   dateEnd.value   = todayStr;

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _period  = btn.dataset.period;
      _finPage = 1;
      _finSearch = '';
      _finType   = 'all';

      if (_period === 'custom') {
        if (customRange) customRange.classList.remove('hidden');
        return;
      }

      if (customRange) customRange.classList.add('hidden');
      renderFinance();
    });
  });

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      _customStart = dateStart?.value || null;
      _customEnd   = dateEnd?.value   || null;
      _finPage = 1;
      renderFinance();
    });
  }
}

/* ================= LEGACY COMPAT ================= */

export function getFinanceSummary() {
  return computeSummary(buildMovements());
}
