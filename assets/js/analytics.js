import { state } from './state.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ═══════════════════════════════════════════════════════
   DICAS DO DIA  —  3 por dia, rotação diária
═══════════════════════════════════════════════════════ */

const TIPS_POOL = [
  'Acompanhe seus indicadores diariamente para tomar decisões mais inteligentes.',
  'Quarta e quinta-feira tendem a ter maior movimento em negócios de varejo.',
  'Produtos com margem acima de 40% devem ser priorizados nas promoções.',
  'Revise o estoque mínimo dos 5 produtos mais vendidos toda semana.',
  'Operadores com taxa de cancelamento acima de 5% precisam de atenção.',
  'O ticket médio aumenta quando o operador sugere produtos complementares.',
  'Promoções no início do mês aproveitam o pico de renda dos clientes.',
  'Manter o caixa aberto por mais de 8h seguidas aumenta erros operacionais.',
  'Produtos sem giro por 30 dias devem ser avaliados para liquidação.',
  'Uma queda de 10% no ticket médio pode indicar pressão de concorrente.',
  'Vendas à vista com desconto têm impacto menor que parceladas sem juros.',
  'Relatórios semanais dos operadores ajudam a identificar padrões cedo.',
  'O lucro bruto é mais importante que o faturamento para saúde do negócio.',
  'Categorias com mais de 20% de cancelamentos merecem revisão de preços.',
  'Fechar o caixa todo dia no mesmo horário melhora o controle financeiro.',
  'Produtos com baixo custo e alta saída são os melhores para o fluxo de caixa.',
  'Compare sempre o período atual com o mesmo período do ano anterior.',
  'Treinar novos operadores nas horas de menor movimento reduz erros.',
  'Sangrias frequentes podem indicar problema de controle de caixa.',
  'Desconto médio acima de 8% ao dia corrói significativamente a margem.',
  'Clientes que compram 3x ou mais por semana são os mais valiosos para o negócio.'
];

function renderSidebarTips() {
  const el = document.getElementById('sidebarTipText');
  const dots = document.querySelector('.tip-dots');
  if (!el) return;

  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const tips = [
    TIPS_POOL[dayIndex % TIPS_POOL.length],
    TIPS_POOL[(dayIndex + 7) % TIPS_POOL.length],
    TIPS_POOL[(dayIndex + 14) % TIPS_POOL.length]
  ];

  let current = 0;
  const show = (i) => {
    el.textContent = tips[i];
    if (dots) {
      dots.querySelectorAll('span').forEach((s, idx) => {
        s.classList.toggle('active', idx === i);
      });
    }
  };

  show(0);

  if (!window.__gambyTipInterval) {
    window.__gambyTipInterval = setInterval(() => {
      current = (current + 1) % 3;
      show(current);
    }, 6000);
  }
}

/* ═══════════════════════════════════════════════════════
   PERÍODO
═══════════════════════════════════════════════════════ */

let _anStart = null;
let _anEnd   = null;
let _anCompare = 'previous';

function _initDefaultPeriod() {
  const now = new Date();
  _anStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  _anEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
}

function _getPrevPeriod() {
  const dur = _anEnd.getTime() - _anStart.getTime();
  return {
    start: new Date(_anStart.getTime() - dur - 1000),
    end:   new Date(_anStart.getTime() - 1)
  };
}

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */

function _fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function _pct(v) { return Number(v || 0).toFixed(1) + '%'; }
function _n(v)   { return Number(v || 0); }
function _dstr(d){ return d instanceof Date ? d.toLocaleDateString('pt-BR') : '—'; }

function _getSales(start, end) {
  if (!Array.isArray(state.sales)) return [];
  return state.sales.filter(s => {
    const d = new Date(s.createdAt || s.date || s.updatedAt || 0);
    return d >= start && d <= end;
  });
}
function _isCancelled(s) {
  return Boolean(s.cancelled || s.isCancelled || s.status === 'cancelled');
}
function _valid(sales)     { return sales.filter(s => !_isCancelled(s)); }
function _cancelled(sales) { return sales.filter(s => _isCancelled(s)); }
function _total(s)         { return _n(s.total); }
function _items(s) {
  if (Array.isArray(s.items)) return s.items.reduce((a, i) => a + _n(i.quantity), 0);
  return _n(s.itemsCount || s.quantity);
}

/* ═══════════════════════════════════════════════════════
   COMPUTAÇÕES
═══════════════════════════════════════════════════════ */

function _computeKPIs(sales) {
  const valid = _valid(sales);
  const totalRevenue = valid.reduce((a, s) => a + _total(s), 0);
  const count = valid.length;
  const avgTicket = count > 0 ? totalRevenue / count : 0;

  let totalCost = 0;
  let totalDiscount = 0;
  valid.forEach(s => {
    totalDiscount += _n(s.discount || s.discountAmount);
    if (Array.isArray(s.items)) {
      s.items.forEach(i => { totalCost += _n(i.cost) * _n(i.quantity); });
    }
  });

  const grossProfit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const itemsSold = valid.reduce((a, s) => a + _items(s), 0);

  return { totalRevenue, count, avgTicket, grossProfit, margin, itemsSold, totalCost, totalDiscount };
}

function _computeDaily(sales, start, end) {
  const days = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= endDay) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const map = {};
  days.forEach(d => { map[d.toDateString()] = 0; });
  _valid(sales).forEach(s => {
    const k = new Date(s.createdAt || s.date || 0).toDateString();
    if (map[k] !== undefined) map[k] += _total(s);
  });
  return days.map(d => ({ date: d, value: map[d.toDateString()] || 0 }));
}

function _computePayment(sales) {
  const map = {};
  _valid(sales).forEach(s => {
    const m = String(s.paymentMethod || 'Outros').trim();
    map[m] = (map[m] || 0) + _total(s);
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function _computeOperators(sales) {
  const map = {};
  sales.forEach(s => {
    const name = String(s.operatorName || s.operator || 'Desconhecido').trim();
    const term = String(s.terminalName || 'Caixa 01').trim();
    if (!map[name]) map[name] = { name, terminal: term, vendas: 0, faturamento: 0, cancelamentos: 0 };
    if (_isCancelled(s)) { map[name].cancelamentos++; }
    else { map[name].vendas++; map[name].faturamento += _total(s); }
  });
  return Object.values(map).map(op => ({
    ...op,
    ticketMedio: op.vendas > 0 ? op.faturamento / op.vendas : 0,
    cancelRate: (op.vendas + op.cancelamentos) > 0 ? op.cancelamentos / (op.vendas + op.cancelamentos) : 0,
    score: _opScore(op)
  })).sort((a, b) => b.faturamento - a.faturamento);
}

function _opScore(op) {
  const cancelPenalty = Math.min(40, op.cancelRate * 400);
  const base = Math.min(60, op.vendas);
  return Math.max(0, Math.min(100, Math.round(base + 40 - cancelPenalty)));
}

function _opMedal(score) {
  if (score >= 80) return { label: 'Ouro',   cls: 'medal-gold' };
  if (score >= 60) return { label: 'Prata',  cls: 'medal-silver' };
  if (score >= 40) return { label: 'Bronze', cls: 'medal-bronze' };
  return { label: '—', cls: '' };
}

function _stars(rate) {
  const s = Math.max(1, Math.min(5, Math.round((1 - rate) * 5)));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}

function _computeCash(sales) {
  const map = {};
  sales.forEach(s => {
    const term = String(s.terminalName || 'Caixa 01').trim();
    if (!map[term]) map[term] = { terminal: term, vendas: 0, faturamento: 0, cancelamentos: 0 };
    if (_isCancelled(s)) { map[term].cancelamentos++; }
    else { map[term].vendas++; map[term].faturamento += _total(s); }
  });
  return Object.values(map).map(c => ({
    ...c,
    ticketMedio: c.vendas > 0 ? c.faturamento / c.vendas : 0,
    cancelRate: (c.vendas + c.cancelamentos) > 0 ? c.cancelamentos / (c.vendas + c.cancelamentos) : 0,
    nota: Math.max(1, Math.min(5, +((1 - c.cancelamentos / Math.max(1, c.vendas + c.cancelamentos)) * 5).toFixed(1)))
  })).sort((a, b) => b.faturamento - a.faturamento);
}

function _computeSummary(sales, start, end) {
  const daily = _computeDaily(sales, start, end);
  const filled = daily.filter(d => d.value > 0);
  const bestDay  = filled.reduce((b, d) => d.value > (b?.value || 0) ? d : b, null);
  const worstDay = filled.reduce((w, d) => d.value < (w?.value || Infinity) ? d : w, null);
  const totalRev = daily.reduce((a, d) => a + d.value, 0);
  const daysCount = daily.length;
  const dailyAvg = daysCount > 0 ? totalRev / daysCount : 0;
  const cancelTotal = _cancelled(sales).reduce((a, s) => a + _total(s), 0);
  let totalDiscount = 0;
  _valid(sales).forEach(s => { totalDiscount += _n(s.discount || s.discountAmount); });
  return { bestDay, worstDay, daysCount, dailyAvg, cancelTotal, totalDiscount };
}

function _computeScore(kpis, allSales, prevKpis) {
  let score = 50;
  if (prevKpis && prevKpis.totalRevenue > 0) {
    const growth = (kpis.totalRevenue - prevKpis.totalRevenue) / prevKpis.totalRevenue;
    score += Math.min(25, growth * 120);
  }
  score += Math.min(15, kpis.margin / 4);
  const cancelRate = allSales.length > 0 ? _cancelled(allSales).length / allSales.length : 0;
  score -= Math.min(30, cancelRate * 300);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function _computeInsights(kpis, prevKpis, ops, cashArr, allSales) {
  const insights = [];

  const cancelRate = allSales.length > 0 ? _cancelled(allSales).length / allSales.length : 0;
  if (cancelRate > 0.05) {
    insights.push({ type: 'warning', text: `Taxa de cancelamento de ${_pct(cancelRate * 100)} está acima do ideal (5%).` });
  }

  if (ops.length > 0) {
    const best = ops[0];
    insights.push({ type: 'info', text: `${best.name} lidera em faturamento com ${_fmt(best.faturamento)}.` });
  }

  const hourly = new Array(24).fill(0);
  _valid(allSales).forEach(s => { const h = new Date(s.createdAt || s.date || 0).getHours(); hourly[h] += _total(s); });
  const peakH = hourly.indexOf(Math.max(...hourly));
  if (Math.max(...hourly) > 0) {
    insights.push({ type: 'success', text: `O horário das ${peakH}h é o mais lucrativo do período.` });
  }

  if (prevKpis && prevKpis.totalRevenue > 0) {
    const g = ((kpis.totalRevenue - prevKpis.totalRevenue) / prevKpis.totalRevenue) * 100;
    insights.push(g >= 0
      ? { type: 'success', text: `Faturamento cresceu ${Math.abs(g).toFixed(1)}% vs período anterior.` }
      : { type: 'danger',  text: `Faturamento caiu ${Math.abs(g).toFixed(1)}% vs período anterior.` }
    );
  }

  const lowStock = Array.isArray(state.products)
    ? state.products.filter(p => _n(p.stock) <= _n(p.minStock) && p.active !== false).length : 0;
  if (lowStock > 0) {
    insights.push({ type: 'warning', text: `${lowStock} produto(s) com estoque crítico precisam de reposição.` });
  }

  if (cashArr.length > 1) {
    const best = cashArr[0];
    insights.push({ type: 'success', text: `${best.terminal} tem a melhor taxa de aprovação em vendas.` });
  }

  return insights.slice(0, 5);
}

function _computeAlerts(allSales, ops, cashArr) {
  const avgCancelRate = ops.length > 0 ? ops.reduce((a, o) => a + o.cancelRate, 0) / ops.length : 0;
  const highCancelOps = ops.filter(o => o.cancelRate > avgCancelRate * 1.5 && o.cancelRate > 0.03);

  let highDiscountCount = 0;
  _valid(allSales).forEach(s => {
    const disc = _n(s.discount || s.discountAmount);
    const tot  = _total(s);
    if (tot > 0 && disc / tot > 0.15) highDiscountCount++;
  });

  const divergentCash = cashArr.filter(c => c.cancelRate > 0.1);

  let consec = 0, maxConsec = 0;
  allSales.forEach(s => {
    if (_isCancelled(s)) { consec++; maxConsec = Math.max(maxConsec, consec); } else { consec = 0; }
  });

  const lowStockCount = Array.isArray(state.products)
    ? state.products.filter(p => _n(p.stock) <= _n(p.minStock) && p.active !== false).length : 0;

  return [
    { type: highCancelOps.length > 0 ? 'warning' : 'ok', text: 'Cancelamentos acima da média', count: highCancelOps.length },
    { type: highDiscountCount > 0 ? 'warning' : 'ok',    text: 'Descontos excessivos (>15%)',  count: highDiscountCount },
    { type: divergentCash.length > 0 ? 'danger' : 'ok',  text: 'Divergência de caixa',         count: divergentCash.length },
    { type: lowStockCount > 0 ? 'warning' : 'ok',         text: 'Estoque crítico de produtos',  count: lowStockCount },
    { type: maxConsec >= 3 ? 'warning' : 'ok',            text: 'Vendas canceladas em sequência', count: maxConsec >= 3 ? maxConsec : 0 }
  ];
}

function _computeForecasts(daily, kpis, prevKpis) {
  const filled = daily.filter(d => d.value > 0);
  if (filled.length < 2) return null;
  const n = filled.length;
  const xs = filled.map((_, i) => i);
  const ys = filled.map(d => d.value);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = (n * sumX2 - sumX * sumX);
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const totalDays = daily.length;
  const remaining = totalDays - filled.length;
  const projectedExtra = Math.max(0, slope * remaining * (filled.length / 2));
  const projectedRevenue = sumY + projectedExtra;
  const projectedProfit = projectedRevenue * (kpis.margin / 100);
  const lowStockRisk = Array.isArray(state.products)
    ? state.products.filter(p => _n(p.stock) <= _n(p.minStock) * 2 && p.active !== false).length : 0;
  const prevGrowth = (prevKpis && prevKpis.totalRevenue > 0)
    ? ((kpis.totalRevenue - prevKpis.totalRevenue) / prevKpis.totalRevenue) * 100 : 0;
  return { projectedRevenue, projectedProfit, lowStockRisk, prevGrowth, slope };
}

function _computeCritical(allSales) {
  const map = {};
  allSales.forEach(s => {
    const isCan = _isCancelled(s);
    if (Array.isArray(s.items)) {
      s.items.forEach(i => {
        const name = String(i.productName || i.name || 'Produto').trim();
        if (!map[name]) map[name] = { name, cancelledQty: 0, discount: 0, revenue: 0, cost: 0, qty: 0 };
        if (isCan) { map[name].cancelledQty += _n(i.quantity); }
        else {
          map[name].qty     += _n(i.quantity);
          map[name].revenue += _n(i.total);
          map[name].cost    += _n(i.cost) * _n(i.quantity);
          map[name].discount+= _n(i.discount);
        }
      });
    }
  });
  const arr = Object.values(map);
  return {
    mostCancelled:   [...arr].sort((a, b) => b.cancelledQty - a.cancelledQty).slice(0, 5),
    mostDiscounted:  [...arr].sort((a, b) => b.discount - a.discount).slice(0, 5),
    leastProfitable: [...arr].sort((a, b) => (a.revenue - a.cost) - (b.revenue - b.cost)).slice(0, 5)
  };
}

function _computeQuality(kpis, allSales) {
  const total = allSales.length;
  const valid = _valid(allSales).length;
  const approvalRate = total > 0 ? (valid / total) * 100 : 100;
  const prods = Array.isArray(state.products) ? state.products : [];
  const complete = prods.filter(p => p.name && p.code && _n(p.price) > 0).length;
  const precision = prods.length > 0 ? (complete / prods.length) * 100 : 100;
  return { approvalRate, precision };
}

/* ═══════════════════════════════════════════════════════
   CHART INSTANCES
═══════════════════════════════════════════════════════ */

let _chartSales = null, _chartPayment = null, _chartBar = null;

function _destroyChart(ref) { try { ref?.destroy(); } catch {} }

/* ═══════════════════════════════════════════════════════
   RENDER — KPIs
═══════════════════════════════════════════════════════ */

function _renderKPIs(kpis, prevKpis) {
  const set = (id, val, prev, isCount) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('.an-kpi-val').textContent = isCount ? _n(val).toLocaleString('pt-BR') : _fmt(val);
    const badge = el.querySelector('.an-kpi-badge');
    if (badge && prevKpis) {
      const base = _n(prev);
      const pctChg = base > 0 ? ((val - base) / base) * 100 : 0;
      const up = pctChg >= 0;
      badge.textContent = (up ? '▲' : '▼') + ' ' + Math.abs(pctChg).toFixed(1) + '%';
      badge.className = 'an-kpi-badge ' + (up ? 'up' : 'down');
    } else if (badge) { badge.textContent = ''; }
  };

  const pK = prevKpis || {};
  set('anKpiFaturamento', kpis.totalRevenue, pK.totalRevenue);
  set('anKpiVendas',     kpis.count,        pK.count, true);
  set('anKpiTicket',     kpis.avgTicket,    pK.avgTicket);
  set('anKpiLucro',      kpis.grossProfit,  pK.grossProfit);

  const margEl = document.getElementById('anKpiMargem');
  if (margEl) {
    margEl.querySelector('.an-kpi-val').textContent = _pct(kpis.margin);
    const b = margEl.querySelector('.an-kpi-badge');
    if (b && pK.margin != null) {
      const diff = kpis.margin - pK.margin;
      b.textContent = (diff >= 0 ? '▲' : '▼') + ' ' + Math.abs(diff).toFixed(1) + 'pp';
      b.className = 'an-kpi-badge ' + (diff >= 0 ? 'up' : 'down');
    }
  }

  const itensEl = document.getElementById('anKpiItens');
  if (itensEl) {
    itensEl.querySelector('.an-kpi-val').textContent = _n(kpis.itemsSold).toLocaleString('pt-BR') + ' un.';
    const b = itensEl.querySelector('.an-kpi-badge');
    if (b && pK.itemsSold != null) {
      const diff = kpis.itemsSold - pK.itemsSold;
      const pctV = pK.itemsSold > 0 ? (diff / pK.itemsSold) * 100 : 0;
      b.textContent = (diff >= 0 ? '▲' : '▼') + ' ' + Math.abs(pctV).toFixed(1) + '%';
      b.className = 'an-kpi-badge ' + (diff >= 0 ? 'up' : 'down');
    }
  }
}

/* ═══════════════════════════════════════════════════════
   RENDER — EVOLUÇÃO DE VENDAS
═══════════════════════════════════════════════════════ */

function _renderSalesChart(daily, totalRevenue) {
  const canvas = document.getElementById('anSalesChart');
  if (!canvas) return;
  _destroyChart(_chartSales);
  const labels = daily.map(d => d.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
  const data   = daily.map(d => d.value);
  const valEl  = document.getElementById('anSalesTotal');
  if (valEl) valEl.textContent = _fmt(totalRevenue);
  _chartSales = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.10)',
        borderWidth: 2.5,
        pointRadius: daily.length <= 15 ? 4 : 2,
        pointBackgroundColor: '#3b82f6',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => _fmt(c.raw) } } },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => 'R$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — VENDAS POR PAGAMENTO (donut)
═══════════════════════════════════════════════════════ */

const _PAYMENT_COLORS = ['#22c55e','#3b82f6','#a855f7','#f59e0b','#ef4444','#14b8a6','#f97316'];

function _renderPaymentChart(payment) {
  const canvas = document.getElementById('anPaymentChart');
  const legend = document.getElementById('anPaymentLegend');
  if (!canvas) return;
  _destroyChart(_chartPayment);

  const total = payment.reduce((a, [, v]) => a + v, 0);
  const labels = payment.map(([m]) => m);
  const data   = payment.map(([, v]) => v);
  const colors = labels.map((_, i) => _PAYMENT_COLORS[i % _PAYMENT_COLORS.length]);

  _chartPayment = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${_fmt(c.raw)} (${total > 0 ? ((c.raw / total) * 100).toFixed(1) : 0}%)` } } }
    }
  });

  if (legend) {
    legend.innerHTML = payment.map(([m, v], i) => `
      <div class="an-pay-row">
        <span class="an-pay-dot" data-dot-color="${colors[i]}"></span>
        <span class="an-pay-name">${_esc(m)}</span>
        <span class="an-pay-val">${_fmt(v)} (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)</span>
      </div>
    `).join('');
    legend.querySelectorAll('[data-dot-color]').forEach(d => { d.style.background = d.dataset.dotColor; });
  }
}

/* ═══════════════════════════════════════════════════════
   RENDER — RESUMO DO PERÍODO
═══════════════════════════════════════════════════════ */

function _renderSummary(sum, kpis) {
  const el = document.getElementById('anPeriodSummary');
  if (!el) return;
  const row = (label, val) => `<div class="an-sum-row"><span>${label}</span><strong>${val}</strong></div>`;
  el.innerHTML = [
    row('Dias no período',      sum.daysCount),
    row('Melhor dia',           sum.bestDay  ? `${_dstr(sum.bestDay.date)} (${_fmt(sum.bestDay.value)})` : '—'),
    row('Pior dia',             sum.worstDay ? `${_dstr(sum.worstDay.date)} (${_fmt(sum.worstDay.value)})` : '—'),
    row('Média diária de vendas', _fmt(sum.dailyAvg)),
    row('Cancelamentos',        _fmt(sum.cancelTotal)),
    row('Descontos concedidos', _fmt(sum.totalDiscount))
  ].join('');
}

/* ═══════════════════════════════════════════════════════
   RENDER — IA INSIGHTS
═══════════════════════════════════════════════════════ */

const _IA_ICONS = {
  warning: { svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', color: '#f59e0b' },
  info:    { svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', color: '#60a5fa' },
  success: { svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>', color: '#4ade80' },
  danger:  { svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>', color: '#f87171' }
};

function _renderInsights(insights) {
  const el = document.getElementById('anIaInsights');
  if (!el) return;
  if (!insights.length) { el.innerHTML = '<p class="an-empty-p">Dados insuficientes para análise.</p>'; return; }
  el.innerHTML = insights.map(ins => {
    const ico = _IA_ICONS[ins.type] || _IA_ICONS.info;
    return `<div class="an-ia-row">
      <span class="an-ia-icon" data-ia-color="${ico.color}">${ico.svg}</span>
      <span class="an-ia-text">${_esc(ins.text)}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-ia-color]').forEach(d => { d.style.color = d.dataset.iaColor; });
}

/* ═══════════════════════════════════════════════════════
   RENDER — OPERADORES
═══════════════════════════════════════════════════════ */

function _renderOperators(ops) {
  const tbody = document.getElementById('anOperatorsBody');
  const total = document.getElementById('anOperatorsTotal');
  if (!tbody) return;
  if (!ops.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted an-op-empty">Sem dados de operadores no período.</td></tr>';
    return;
  }
  const totalVendas = ops.reduce((a, o) => a + o.vendas, 0);
  const totalFat    = ops.reduce((a, o) => a + o.faturamento, 0);
  const totalCancel = ops.reduce((a, o) => a + o.cancelamentos, 0);
  const avgTicket   = totalVendas > 0 ? totalFat / totalVendas : 0;

  tbody.innerHTML = ops.map((op, i) => {
    const m = _opMedal(op.score);
    const _opN = _esc(op.name);
    const _opT = _esc(op.terminal);
    const avatar = typeof window.renderUserAvatar === 'function'
      ? window.renderUserAvatar({ name: op.name, photoUrl: window.getUserAvatar?.(op.name) || null }, { cls: 'an-op-av' })
      : `<div class="an-avatar-ph">${_esc((op.name || '?')[0])}</div>`;
    return `<tr>
      <td><div class="an-op-name-wrap">${avatar}<span>${_opN}</span></div></td>
      <td>${_opT}</td>
      <td>${op.vendas}</td>
      <td>${_fmt(op.faturamento)}</td>
      <td>${_fmt(op.ticketMedio)}</td>
      <td>${op.cancelamentos} (${_pct(op.cancelRate * 100)})</td>
      <td class="an-op-td-amber">${_stars(op.cancelRate)}</td>
      <td class="an-op-td-grn">${op.score}</td>
      <td><span class="an-medal ${m.cls}">${m.label}</span></td>
    </tr>`;
  }).join('');

  if (total) {
    total.innerHTML = `<tr>
      <td colspan="2"><strong>Total geral</strong></td>
      <td><strong>${totalVendas}</strong></td>
      <td><strong>${_fmt(totalFat)}</strong></td>
      <td><strong>${_fmt(avgTicket)}</strong></td>
      <td><strong>${totalCancel} (${totalVendas + totalCancel > 0 ? _pct(totalCancel / (totalVendas + totalCancel) * 100) : '0%'})</strong></td>
      <td colspan="3"></td>
    </tr>`;
  }
}

/* ═══════════════════════════════════════════════════════
   RENDER — CASH RANKINGS
═══════════════════════════════════════════════════════ */

function _renderCash(cashArr) {
  const tbody = document.getElementById('anCashBody');
  if (!tbody) return;
  if (!cashArr.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted an-cash-empty">Sem dados de caixa no período.</td></tr>';
    return;
  }
  tbody.innerHTML = cashArr.map((c, i) => {
    const noteColor = c.nota >= 4 ? '#4ade80' : c.nota >= 3 ? '#fbbf24' : '#f87171';
    return `<tr>
      <td class="an-cash-num">${i + 1}</td>
      <td>${_esc(c.terminal)}</td>
      <td>${_fmt(c.faturamento)}</td>
      <td>${c.vendas}</td>
      <td>${_fmt(c.ticketMedio)}</td>
      <td class="an-cash-note" data-note-color="${noteColor}">${c.nota.toFixed(1)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-note-color]').forEach(d => { d.style.color = d.dataset.noteColor; });
}

/* ═══════════════════════════════════════════════════════
   RENDER — SCORE GAUGE (Canvas)
═══════════════════════════════════════════════════════ */

function _renderScoreGauge(score) {
  const canvas = document.getElementById('anScoreCanvas');
  const valEl  = document.getElementById('anScoreVal');
  const lblEl  = document.getElementById('anScoreLbl');
  const msgEl  = document.getElementById('anScoreMsg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.72, r = Math.min(W, H) * 0.42;
  const startAngle = Math.PI, endAngle = 2 * Math.PI;
  const scoreAngle = startAngle + (score / 100) * Math.PI;

  const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0,    '#ef4444');
  grad.addColorStop(0.5,  '#f59e0b');
  grad.addColorStop(1,    '#22c55e');

  ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 18; ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, scoreAngle);
  ctx.strokeStyle = grad; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.stroke();

  const px = cx + r * Math.cos(scoreAngle);
  const py = cy + r * Math.sin(scoreAngle);
  ctx.beginPath(); ctx.arc(px, py, 9, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff'; ctx.fill();

  if (valEl) valEl.textContent = score + '%';
  const lbl = score >= 80 ? 'Saudável' : score >= 60 ? 'Regular' : 'Atenção';
  const clr = score >= 80 ? '#4ade80'  : score >= 60 ? '#fbbf24'  : '#f87171';
  if (lblEl) { lblEl.textContent = lbl; lblEl.style.color = clr; }
  const msg = score >= 80 ? 'Excelente desempenho! Continue assim.' : score >= 60 ? 'Resultado aceitável. Há espaço para melhorar.' : 'Negócio precisa de atenção imediata.';
  if (msgEl) msgEl.textContent = msg;
}

/* ═══════════════════════════════════════════════════════
   RENDER — COMPARATIVO DE OPERADORES (barra)
═══════════════════════════════════════════════════════ */

function _renderOperatorsBar(ops, metric) {
  const canvas = document.getElementById('anOpBarChart');
  if (!canvas) return;
  _destroyChart(_chartBar);

  const colors = ['#3b82f6','#22c55e','#a855f7','#f59e0b','#ef4444'];
  const labels = ops.map(o => o.name);
  const data   = ops.map(o => metric === 'vendas' ? o.vendas : o.faturamento);

  _chartBar = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => colors[i % colors.length]), borderRadius: 6, borderWidth: 0 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => metric === 'vendas' ? c.raw + ' vendas' : _fmt(c.raw) } } },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — ALERTAS OPERACIONAIS
═══════════════════════════════════════════════════════ */

function _renderAlerts(alerts) {
  const el = document.getElementById('anAlertsList');
  if (!el) return;
  const iconMap = {
    warning: { c: '#f59e0b', s: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>' },
    danger:  { c: '#f87171', s: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' },
    ok:      { c: '#4ade80', s: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' }
  };
  el.innerHTML = alerts.map(a => {
    const ico = iconMap[a.type] || iconMap.ok;
    return `<div class="an-alert-row">
      <span data-alert-color="${ico.c}">${ico.s}</span>
      <span class="an-alert-text">${a.text}</span>
      <span class="an-alert-badge ${a.type !== 'ok' && a.count > 0 ? 'badge-warn' : 'badge-ok'}">${a.count}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-alert-color]').forEach(d => { d.style.color = d.dataset.alertColor; });
}

/* ═══════════════════════════════════════════════════════
   RENDER — PREVISÕES
═══════════════════════════════════════════════════════ */

function _renderForecasts(fc) {
  const el = document.getElementById('anForecastContent');
  if (!el) return;
  if (!fc) { el.innerHTML = '<p class="an-empty-p">Dados insuficientes para previsão.</p>'; return; }
  const trendDir = fc.slope >= 0 ? '▲' : '▼';
  const trendClr = fc.slope >= 0 ? '#4ade80' : '#f87171';
  const grwClr   = fc.prevGrowth >= 0 ? '#4ade80' : '#f87171';
  el.innerHTML = `
    <div class="an-fc-item">
      <span>Previsão de faturamento</span>
      <strong>${_fmt(fc.projectedRevenue)}</strong>
      <small data-clr="${grwClr}">${trendDir} ${Math.abs(fc.prevGrowth).toFixed(1)}% vs mês anterior</small>
    </div>
    <div class="an-fc-item">
      <span>Previsão de lucro</span>
      <strong>${_fmt(fc.projectedProfit)}</strong>
      <small data-clr="${trendClr}">Tendência ${fc.slope >= 0 ? 'positiva' : 'negativa'}</small>
    </div>
    <div class="an-fc-item ${fc.lowStockRisk > 0 ? 'fc-warn' : ''}">
      <span>Ruptura de estoque prevista</span>
      <strong>${fc.lowStockRisk} produto(s)</strong>
      <a id="anFcStockLink" href="#" class="an-fc-link">Ver lista de produtos</a>
    </div>
  `;
  el.querySelectorAll('[data-clr]').forEach(d => { d.style.color = d.dataset.clr; });
  document.getElementById('anFcStockLink')?.addEventListener('click', e => {
    e.preventDefault(); window.openPageDirect?.('estoque');
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — PRODUTOS CRÍTICOS
═══════════════════════════════════════════════════════ */

function _renderCritical(critical) {
  const el = document.getElementById('anCriticalContent');
  const tabs = document.querySelectorAll('.an-crit-tab');
  if (!el) return;

  let activeTab = 'cancelled';
  const show = (mode) => {
    activeTab = mode;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.critMode === mode));
    const list = mode === 'cancelled' ? critical.mostCancelled
               : mode === 'discounted' ? critical.mostDiscounted
               : critical.leastProfitable;
    if (!list.length) { el.innerHTML = '<p class="an-empty-p-sm">Sem dados.</p>'; return; }
    el.innerHTML = list.map((p, i) => {
      const delta = mode === 'cancelled'
        ? { val: p.cancelledQty + ' un.', clr: '#f87171', pct: '' }
        : mode === 'discounted'
        ? { val: _fmt(p.discount), clr: '#fbbf24', pct: '' }
        : { val: _fmt(p.revenue - p.cost), clr: p.revenue - p.cost >= 0 ? '#4ade80' : '#f87171', pct: '' };
      return `<div class="an-crit-row">
        <span class="an-crit-rank">${i + 1}</span>
        <span class="an-crit-name">${_esc(p.name)}</span>
        <span class="an-prd-delta" data-delta-clr="${delta.clr}">${delta.val}</span>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-delta-clr]').forEach(d => { d.style.color = d.dataset.deltaClr; });
  };

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.critMode)));
  show(activeTab);
}

/* ═══════════════════════════════════════════════════════
   RENDER — AVALIAÇÕES DOS CAIXAS (computed from cancel rate)
═══════════════════════════════════════════════════════ */

function _renderRatings(cashArr) {
  const el = document.getElementById('anRatingsContent');
  if (!el) return;
  if (!cashArr.length) { el.innerHTML = '<p class="an-empty-p-sm">Sem dados.</p>'; return; }

  const ratings = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  cashArr.forEach(c => {
    const r = Math.max(1, Math.min(5, Math.round(c.nota)));
    ratings[r]++;
  });
  const total = cashArr.length;
  const avg   = cashArr.reduce((a, c) => a + c.nota, 0) / total;

  el.innerHTML = [5, 4, 3, 2, 1].map(n => {
    const cnt = ratings[n];
    const pct = total > 0 ? (cnt / total) * 100 : 0;
    const barClr = n >= 4 ? '#22c55e' : n === 3 ? '#f59e0b' : '#ef4444';
    return `<div class="an-rating-row">
      <span class="an-star-lbl">${'★'.repeat(n)}</span>
      <div class="an-rating-bar-wrap"><div class="an-rating-bar" data-bar-pct="${pct}" data-bar-clr="${barClr}"></div></div>
      <span class="an-rating-pct">${pct.toFixed(0)}%</span>
    </div>`;
  }).join('') + `<div class="an-rating-avg"><span class="an-rating-star">★</span> <strong class="an-rating-avg-val">${avg.toFixed(1)}</strong> <span class="an-rating-avg-lbl">Média geral</span></div>`;
  el.querySelectorAll('[data-bar-pct]').forEach(d => {
    d.style.width = d.dataset.barPct + '%';
    d.style.background = d.dataset.barClr;
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — METAS DO PERÍODO
═══════════════════════════════════════════════════════ */

function _renderGoals(kpis) {
  const goalRev  = Number(localStorage.getItem('an_goal_revenue') || 0);
  const goalProfit = Number(localStorage.getItem('an_goal_profit') || 0);

  const revEl = document.getElementById('anGoalRevBar');
  const proEl = document.getElementById('anGoalProfBar');
  const revPct = document.getElementById('anGoalRevPct');
  const proPct = document.getElementById('anGoalProfPct');
  const revLbl = document.getElementById('anGoalRevLbl');
  const proLbl = document.getElementById('anGoalProLbl');

  const setBar = (barEl, pctEl, lblEl, actual, goal) => {
    if (!barEl) return;
    const pct = goal > 0 ? Math.min(100, (actual / goal) * 100) : 0;
    barEl.style.width = pct + '%';
    barEl.style.background = pct >= 90 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#3b82f6';
    if (pctEl) pctEl.textContent = goal > 0 ? pct.toFixed(0) + '%' : '—';
    if (lblEl) lblEl.textContent = goal > 0 ? `${_fmt(actual)} / ${_fmt(goal)}` : `${_fmt(actual)} / Meta não definida`;
  };

  setBar(revEl, revPct, revLbl, kpis.totalRevenue, goalRev);
  setBar(proEl, proPct, proLbl, kpis.grossProfit, goalProfit);
}

/* ═══════════════════════════════════════════════════════
   RENDER — INDICADORES DE QUALIDADE
═══════════════════════════════════════════════════════ */

function _renderQuality(q) {
  const set = (id, val, suffix, isGreen) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val.toFixed(1) + suffix;
      el.style.color = isGreen ? '#4ade80' : '#f87171';
    }
  };
  set('anQApproval',  q.approvalRate, '%', q.approvalRate >= 90);
  set('anQPrecision', q.precision,    '%', q.precision    >= 90);
}

/* ═══════════════════════════════════════════════════════
   RENDER — ATUALIZAÇÃO HEADER
═══════════════════════════════════════════════════════ */

function _renderHeader() {
  const el = document.getElementById('anLastUpdate');
  if (el) el.textContent = 'Última atualização: ' + new Date().toLocaleString('pt-BR');
  const startEl = document.getElementById('anDateStart');
  const endEl   = document.getElementById('anDateEnd');
  if (startEl) startEl.value = _anStart.toISOString().slice(0, 10);
  if (endEl)   endEl.value   = _anEnd.toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════════════════════
   EXPORTAR RELATÓRIOS
═══════════════════════════════════════════════════════ */

function _exportCSV(filename, headers, rows) {
  const csv = [headers.join(';'), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function _exportPrintReport(title, html) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <link rel="stylesheet" href="/assets/css/print-analytics.css">
  </head><body>${html}<div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')} — Gamby Fluxo Caixa Pro</div></body></html>`);
  win.document.close(); setTimeout(() => win.print(), 400);
}

function exportExecutive(kpis, summary, ops, cashArr) {
  const company = _esc(state.companySettings?.tradeName || state.companySettings?.companyName || 'Empresa');
  _exportPrintReport('Relatório Executivo', `
    <h1>Relatório Executivo — ${company}</h1>
    <p>Período: ${_dstr(_anStart)} a ${_dstr(_anEnd)}</p>
    <h2>KPIs Principais</h2>
    <table><tr><th>Indicador</th><th>Valor</th></tr>
    <tr><td>Faturamento total</td><td>${_fmt(kpis.totalRevenue)}</td></tr>
    <tr><td>Total de vendas</td><td>${kpis.count}</td></tr>
    <tr><td>Ticket médio</td><td>${_fmt(kpis.avgTicket)}</td></tr>
    <tr><td>Lucro bruto</td><td>${_fmt(kpis.grossProfit)}</td></tr>
    <tr><td>Margem de lucro</td><td>${_pct(kpis.margin)}</td></tr>
    <tr><td>Itens vendidos</td><td>${kpis.itemsSold}</td></tr></table>
    <h2>Resumo do Período</h2>
    <table><tr><th>Informação</th><th>Valor</th></tr>
    <tr><td>Melhor dia</td><td>${summary.bestDay ? `${_dstr(summary.bestDay.date)} — ${_fmt(summary.bestDay.value)}` : '—'}</td></tr>
    <tr><td>Pior dia</td><td>${summary.worstDay ? `${_dstr(summary.worstDay.date)} — ${_fmt(summary.worstDay.value)}` : '—'}</td></tr>
    <tr><td>Média diária</td><td>${_fmt(summary.dailyAvg)}</td></tr>
    <tr><td>Cancelamentos</td><td>${_fmt(summary.cancelTotal)}</td></tr></table>
  `);
}

function exportFinanceiro(kpis, daily) {
  _exportCSV('relatorio_financeiro.csv',
    ['Data', 'Faturamento do Dia'],
    daily.map(d => [_dstr(d.date), d.value.toFixed(2).replace('.', ',')])
  );
}

function exportOperators(ops) {
  _exportCSV('relatorio_operadores.csv',
    ['Operador', 'Caixa', 'Vendas', 'Faturamento', 'Ticket Médio', 'Cancelamentos', 'Score'],
    ops.map(o => [o.name, o.terminal, o.vendas, o.faturamento.toFixed(2).replace('.', ','), o.ticketMedio.toFixed(2).replace('.', ','), o.cancelamentos, o.score])
  );
}

function exportCashReport(cashArr) {
  _exportCSV('relatorio_caixas.csv',
    ['Terminal', 'Faturamento', 'Vendas', 'Ticket Médio', 'Cancelamentos', 'Nota'],
    cashArr.map(c => [c.terminal, c.faturamento.toFixed(2).replace('.', ','), c.vendas, c.ticketMedio.toFixed(2).replace('.', ','), c.cancelamentos, c.nota.toFixed(1).replace('.', ',')])
  );
}

/* ═══════════════════════════════════════════════════════
   RENDER ALL
═══════════════════════════════════════════════════════ */

let _lastOps = [], _lastCash = [], _lastKpis = {}, _lastDaily = [], _lastCritical = {};

export function renderAnalytics() {
  if (!_anStart) _initDefaultPeriod();

  const allSales = _getSales(_anStart, _anEnd);
  const prev     = _getPrevPeriod();
  const prevSales = _getSales(prev.start, prev.end);

  const kpis     = _computeKPIs(allSales);
  const prevKpis = _computeKPIs(prevSales);
  const daily    = _computeDaily(allSales, _anStart, _anEnd);
  const payment  = _computePayment(allSales);
  const summary  = _computeSummary(allSales, _anStart, _anEnd);
  const ops      = _computeOperators(allSales);
  const cashArr  = _computeCash(allSales);
  const insights = _computeInsights(kpis, prevKpis, ops, cashArr, allSales);
  const alerts   = _computeAlerts(allSales, ops, cashArr);
  const forecasts= _computeForecasts(daily, kpis, prevKpis);
  const critical = _computeCritical(allSales);
  const score    = _computeScore(kpis, allSales, prevKpis);
  const quality  = _computeQuality(kpis, allSales);

  _lastOps = ops; _lastCash = cashArr; _lastKpis = kpis;
  _lastDaily = daily; _lastCritical = critical;

  _renderHeader();
  _renderKPIs(kpis, prevKpis.totalRevenue ? prevKpis : null);
  _renderSalesChart(daily, kpis.totalRevenue);
  _renderPaymentChart(payment);
  _renderSummary(summary, kpis);
  _renderInsights(insights);
  _renderOperators(ops);
  _renderCash(cashArr);
  _renderScoreGauge(score);
  _renderOperatorsBar(ops, document.getElementById('anOpMetricSelect')?.value || 'faturamento');
  _renderAlerts(alerts);
  _renderForecasts(forecasts);
  _renderCritical(critical);
  _renderRatings(cashArr);
  _renderGoals(kpis);
  _renderQuality(quality);

  renderSidebarTips();
}

/* ═══════════════════════════════════════════════════════
   BIND ACTIONS
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   RELATÓRIO PERSONALIZADO
═══════════════════════════════════════════════════════ */

function _openCustomReportModal() {
  document.getElementById('anCustomReportOverlay')?.remove();

  const allSales = _getSales(_anStart, _anEnd);

  const overlay = document.createElement('div');
  overlay.id = 'anCustomReportOverlay';
  overlay.className = 'an-cr-overlay';

  overlay.innerHTML = `
    <div class="an-cr-box">
      <div class="an-cr-head">
        <h3 class="an-cr-title">Relatório personalizado</h3>
        <button id="anCRClose" class="an-cr-close">×</button>
      </div>
      <p class="an-cr-desc">Escolha o tipo de relatório para gerar no período <strong class="an-cr-date">${_dstr(_anStart)} – ${_dstr(_anEnd)}</strong>:</p>
      <div class="an-cr-list" id="anCRList">
        <button class="an-cr-opt" data-cr="cancelamentos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <span>Relatório de cancelamentos</span>
          <small>Vendas canceladas, operador e valor</small>
        </button>
        <button class="an-cr-opt" data-cr="produtos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span>Relatório de produtos vendidos</span>
          <small>Quantidade, receita e margem por produto</small>
        </button>
        <button class="an-cr-opt" data-cr="descontos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span>Relatório de descontos concedidos</span>
          <small>Vendas com desconto, percentual e operador</small>
        </button>
        <button class="an-cr-opt" data-cr="pagamentos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          <span>Relatório por forma de pagamento</span>
          <small>Agrupado por método: dinheiro, cartão, PIX...</small>
        </button>
        <button class="an-cr-opt" data-cr="horarios">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Relatório de horários de pico</span>
          <small>Faturamento por hora do dia</small>
        </button>
      </div>
      <p class="an-cr-footer">Os relatórios são exportados em CSV e abrem diretamente no Excel.</p>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('anCRClose')?.addEventListener('click', () => overlay.remove());

  overlay.querySelectorAll('.an-cr-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.cr;
      overlay.remove();
      _generateCustomReport(type, allSales);
    });
  });
}

function _generateCustomReport(type, allSales) {
  const period = `${_dstr(_anStart)}_${_dstr(_anEnd)}`.replace(/\//g, '-');

  if (type === 'cancelamentos') {
    const rows = _cancelled(allSales).map(s => [
      _dstr(new Date(s.createdAt || s.date || 0)),
      String(s.operatorName || s.operator || '—'),
      String(s.paymentMethod || '—'),
      _total(s).toFixed(2).replace('.', ','),
      String(s.id || '—')
    ]);
    _exportCSV(`cancelamentos_${period}.csv`,
      ['Data', 'Operador', 'Pagamento', 'Valor (R$)', 'ID Venda'], rows);
    return;
  }

  if (type === 'produtos') {
    const map = {};
    _valid(allSales).forEach(s => {
      if (Array.isArray(s.items)) {
        s.items.forEach(i => {
          const name = String(i.productName || i.name || 'Produto');
          if (!map[name]) map[name] = { name, qty: 0, revenue: 0, cost: 0 };
          map[name].qty     += _n(i.quantity);
          map[name].revenue += _n(i.total);
          map[name].cost    += _n(i.cost) * _n(i.quantity);
        });
      }
    });
    const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue).map(p => [
      p.name,
      p.qty,
      p.revenue.toFixed(2).replace('.', ','),
      p.cost.toFixed(2).replace('.', ','),
      (p.revenue - p.cost).toFixed(2).replace('.', ','),
      p.revenue > 0 ? (((p.revenue - p.cost) / p.revenue) * 100).toFixed(1).replace('.', ',') + '%' : '0%'
    ]);
    _exportCSV(`produtos_vendidos_${period}.csv`,
      ['Produto', 'Qtd Vendida', 'Receita (R$)', 'Custo (R$)', 'Lucro (R$)', 'Margem'], rows);
    return;
  }

  if (type === 'descontos') {
    const rows = _valid(allSales)
      .filter(s => _n(s.discount || s.discountAmount) > 0)
      .map(s => {
        const disc = _n(s.discount || s.discountAmount);
        const tot  = _total(s);
        return [
          _dstr(new Date(s.createdAt || s.date || 0)),
          String(s.operatorName || s.operator || '—'),
          tot.toFixed(2).replace('.', ','),
          disc.toFixed(2).replace('.', ','),
          tot > 0 ? ((disc / tot) * 100).toFixed(1).replace('.', ',') + '%' : '0%'
        ];
      });
    _exportCSV(`descontos_${period}.csv`,
      ['Data', 'Operador', 'Valor Venda (R$)', 'Desconto (R$)', '% Desconto'], rows);
    return;
  }

  if (type === 'pagamentos') {
    const map = {};
    _valid(allSales).forEach(s => {
      const m = String(s.paymentMethod || 'Outros');
      if (!map[m]) map[m] = { method: m, count: 0, total: 0 };
      map[m].count++;
      map[m].total += _total(s);
    });
    const rows = Object.values(map).sort((a, b) => b.total - a.total).map(p => [
      p.method, p.count, p.total.toFixed(2).replace('.', ',')
    ]);
    _exportCSV(`pagamentos_${period}.csv`,
      ['Forma de Pagamento', 'Qtd Transações', 'Total (R$)'], rows);
    return;
  }

  if (type === 'horarios') {
    const hourly = new Array(24).fill(0).map((_, h) => ({ hora: h, total: 0, vendas: 0 }));
    _valid(allSales).forEach(s => {
      const h = new Date(s.createdAt || s.date || 0).getHours();
      hourly[h].total  += _total(s);
      hourly[h].vendas += 1;
    });
    const rows = hourly.map(h => [
      `${String(h.hora).padStart(2, '0')}:00 – ${String(h.hora).padStart(2, '0')}:59`,
      h.vendas,
      h.total.toFixed(2).replace('.', ',')
    ]);
    _exportCSV(`horarios_pico_${period}.csv`,
      ['Horário', 'Qtd Vendas', 'Faturamento (R$)'], rows);
    return;
  }
}


let _analyticsBound = false;

export function bindAnalyticsActions() {
  if (_analyticsBound) return;
  _analyticsBound = true;

  // Period filter apply
  document.getElementById('anApplyPeriodBtn')?.addEventListener('click', () => {
    const s = document.getElementById('anDateStart')?.value;
    const e = document.getElementById('anDateEnd')?.value;
    if (s) _anStart = new Date(s + 'T00:00:00');
    if (e) _anEnd   = new Date(e + 'T23:59:59');
    renderAnalytics();
  });

  // Quick period buttons
  document.querySelectorAll('[data-an-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-an-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = btn.dataset.anPeriod;
      const now = new Date();
      if (p === 'today') {
        _anStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        _anEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      } else if (p === '7d') {
        _anEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        _anStart = new Date(_anEnd); _anStart.setDate(_anStart.getDate() - 6); _anStart.setHours(0, 0, 0);
      } else if (p === 'month') {
        _anStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        _anEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      } else if (p === 'lastmonth') {
        _anStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        _anEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      }
      renderAnalytics();
    });
  });

  // Refresh button
  document.getElementById('anRefreshBtn')?.addEventListener('click', renderAnalytics);

  // Compare metric for bar chart
  document.getElementById('anOpMetricSelect')?.addEventListener('change', e => {
    _renderOperatorsBar(_lastOps, e.target.value);
  });

  // Goal editing
  document.getElementById('anSetGoalBtn')?.addEventListener('click', () => {
    const rev = Number(window.prompt('Meta de faturamento para o período (R$):', localStorage.getItem('an_goal_revenue') || '') || 0);
    const pro = Number(window.prompt('Meta de lucro para o período (R$):', localStorage.getItem('an_goal_profit') || '') || 0);
    if (rev >= 0) localStorage.setItem('an_goal_revenue', rev);
    if (pro >= 0) localStorage.setItem('an_goal_profit', pro);
    _renderGoals(_lastKpis);
  });

  // Export buttons
  document.getElementById('anExportExecutive')?.addEventListener('click', () => {
    exportExecutive(_lastKpis, _computeSummary(_getSales(_anStart, _anEnd), _anStart, _anEnd), _lastOps, _lastCash);
  });
  document.getElementById('anExportFinanceiro')?.addEventListener('click', () => exportFinanceiro(_lastKpis, _lastDaily));
  document.getElementById('anExportOperators')?.addEventListener('click', () => exportOperators(_lastOps));
  document.getElementById('anExportCash')?.addEventListener('click', () => exportCashReport(_lastCash));
  document.getElementById('anExportCustom')?.addEventListener('click', _openCustomReportModal);

  // See all insights — scroll to insights panel
  document.getElementById('anSeeAllInsights')?.addEventListener('click', () => {
    document.getElementById('anIaInsights')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

export function initAnalytics() {
  _initDefaultPeriod();
  renderSidebarTips();
}
