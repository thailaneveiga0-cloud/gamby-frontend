import { state } from './state.js';

// ── Escape helper ────────────────────────────────────────────────────────────
function _esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Formatters ───────────────────────────────────────────────────────────────
function _fmtBRL(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _fmtPct(v) {
  return (Number(v) || 0).toFixed(1) + '%';
}

function _fmtDelta(curr, prev) {
  if (!prev || prev === 0) return '';
  const delta = ((curr - prev) / Math.abs(prev)) * 100;
  const cls = delta >= 0 ? 'pdva-delta-up' : 'pdva-delta-down';
  const sign = delta >= 0 ? '↑' : '↓';
  return `<span class="${cls}">${sign}${Math.abs(delta).toFixed(0)}%</span>`;
}

function _fmtTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function _normalizePaymentLabel(method) {
  const m = String(method || '').toLowerCase().trim();
  if (m.includes('pix')) return 'PIX';
  if (m.includes('cr') || m.includes('credit')) return 'Crédito';
  if (m.includes('d') && m.includes('bit') || m.includes('debit')) return 'Débito';
  if (m.includes('voucher') || m.includes('vale')) return 'Voucher';
  if (m.includes('dinheiro') || m.includes('cash')) return 'Dinheiro';
  return _esc(method) || 'Outro';
}

function _paymentIcon(method) {
  const m = String(method || '').toLowerCase();
  if (m.includes('pix')) return '⚡';
  if (m.includes('cr') || m.includes('credit')) return '💳';
  if (m.includes('d') && m.includes('bit') || m.includes('debit')) return '💳';
  if (m.includes('voucher') || m.includes('vale')) return '🎟';
  if (m.includes('dinheiro') || m.includes('cash')) return '💵';
  return '💰';
}

// ── Period helpers ───────────────────────────────────────────────────────────
function _getPeriodRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return {
        start: today,
        end: now,
        label: 'Hoje',
        compareStart: new Date(today.getTime() - 86400000),
        compareEnd: new Date(today.getTime() - 1),
        compareLabel: 'ontem'
      };
    case 'yesterday': {
      const yStart = new Date(today.getTime() - 86400000);
      const yEnd = new Date(today.getTime() - 1);
      return {
        start: yStart,
        end: yEnd,
        label: 'Ontem',
        compareStart: new Date(yStart.getTime() - 86400000),
        compareEnd: new Date(yStart.getTime() - 1),
        compareLabel: 'anteontem'
      };
    }
    case '7days':
      return {
        start: new Date(today.getTime() - 6 * 86400000),
        end: now,
        label: 'Últimos 7 dias',
        compareStart: new Date(today.getTime() - 13 * 86400000),
        compareEnd: new Date(today.getTime() - 7 * 86400000 - 1),
        compareLabel: '7d anteriores'
      };
    case '30days':
      return {
        start: new Date(today.getTime() - 29 * 86400000),
        end: now,
        label: 'Últimos 30 dias',
        compareStart: new Date(today.getTime() - 59 * 86400000),
        compareEnd: new Date(today.getTime() - 30 * 86400000 - 1),
        compareLabel: '30d anteriores'
      };
    case 'month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(monthStart.getTime() - 1);
      return {
        start: monthStart,
        end: now,
        label: 'Este mês',
        compareStart: prevMonthStart,
        compareEnd: prevMonthEnd,
        compareLabel: 'mês anterior'
      };
    }
    case 'prev-month': {
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const ppStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const ppEnd = new Date(prevStart.getTime() - 1);
      return {
        start: prevStart,
        end: prevEnd,
        label: 'Mês anterior',
        compareStart: ppStart,
        compareEnd: ppEnd,
        compareLabel: 'mês retrasado'
      };
    }
    default:
      return _getPeriodRange('today');
  }
}

function _filterSales(sales, start, end, excludeCancelled = true) {
  return sales.filter(s => {
    if (excludeCancelled && (s.cancelled || s.isCancelled)) return false;
    if (!s.createdAt) return false;
    const d = new Date(s.createdAt);
    return d >= start && d <= end;
  });
}

// ── Aggregation ──────────────────────────────────────────────────────────────
function _computeKPIs(sales, compareSales) {
  const totalRevenue = sales.reduce((acc, s) => acc + (s.total || 0), 0);
  const compareRevenue = compareSales.reduce((acc, s) => acc + (s.total || 0), 0);
  const totalItems = sales.reduce((acc, s) => acc + (s.itemsCount || 0), 0);
  const compareItems = compareSales.reduce((acc, s) => acc + (s.itemsCount || 0), 0);
  const avgTicket = sales.length ? totalRevenue / sales.length : 0;
  const compareAvgTicket = compareSales.length ? compareRevenue / compareSales.length : 0;
  const discountsValue = sales.reduce((acc, s) => acc + (s.discount || 0), 0);
  const discountsCount = sales.filter(s => (s.discount || 0) > 0).length;

  return {
    salesCount: sales.length,
    compareSalesCount: compareSales.length,
    totalRevenue,
    compareRevenue,
    avgTicket,
    compareAvgTicket,
    totalItems,
    compareItems,
    discountsCount,
    discountsValue
  };
}

function _computePaymentBreakdown(sales) {
  const map = {};
  for (const s of sales) {
    const m = s.paymentMethod || 'Dinheiro';
    if (!map[m]) map[m] = { count: 0, total: 0 };
    map[m].count++;
    map[m].total += s.total || 0;
  }
  const totalRev = Object.values(map).reduce((acc, d) => acc + d.total, 0);
  return Object.entries(map)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([method, data]) => ({
      method,
      label: _normalizePaymentLabel(method),
      icon: _paymentIcon(method),
      count: data.count,
      total: data.total,
      pct: totalRev > 0 ? (data.total / totalRev) * 100 : 0
    }));
}

function _computeTopProducts(sales, limit = 8) {
  const byProduct = {};
  for (const s of sales) {
    for (const item of (s.items || [])) {
      const key = item.productId || item.code || item.name || '?';
      const name = item.name || item.code || String(key);
      if (!byProduct[key]) byProduct[key] = { name, quantity: 0, revenue: 0, totalCost: 0, salesCount: 0 };
      byProduct[key].quantity += Number(item.quantity) || 0;
      byProduct[key].revenue += Number(item.total) || 0;
      byProduct[key].totalCost += (Number(item.cost) || 0) * (Number(item.quantity) || 0);
      byProduct[key].salesCount++;
    }
  }
  const products = Object.values(byProduct).map(p => ({
    ...p,
    margin: p.revenue > 0 && p.totalCost > 0
      ? ((p.revenue - p.totalCost) / p.revenue) * 100
      : null
  }));

  return {
    byQty: [...products].sort((a, b) => b.quantity - a.quantity).slice(0, limit),
    byRev: [...products].sort((a, b) => b.revenue - a.revenue).slice(0, limit),
    least: [...products].filter(p => p.quantity > 0).sort((a, b) => a.quantity - b.quantity).slice(0, limit)
  };
}

function _computeByHour(sales) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, total: 0 }));
  for (const s of sales) {
    if (!s.createdAt) continue;
    const h = new Date(s.createdAt).getHours();
    hours[h].count++;
    hours[h].total += s.total || 0;
  }
  return hours;
}

function _computeByOperator(sales, cancelledSales) {
  const map = {};

  for (const s of sales) {
    const name = s.operatorName || s.user?.name || 'Sem operador';
    if (!map[name]) map[name] = { name, count: 0, revenue: 0, cancelled: 0 };
    map[name].count++;
    map[name].revenue += s.total || 0;
  }

  for (const s of cancelledSales) {
    const name = s.operatorName || s.user?.name || 'Sem operador';
    if (!map[name]) map[name] = { name, count: 0, revenue: 0, cancelled: 0 };
    map[name].cancelled++;
  }

  return Object.values(map)
    .map(op => ({
      ...op,
      avgTicket: op.count > 0 ? op.revenue / op.count : 0,
      cancellationRate: (op.count + op.cancelled) > 0
        ? (op.cancelled / (op.count + op.cancelled)) * 100
        : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function _computeAlerts(sales, cancelledSales, cashSession, products) {
  const alerts = [];

  // Taxa de cancelamento
  const totalAll = sales.length + cancelledSales.length;
  const cancelRate = totalAll > 0 ? (cancelledSales.length / totalAll) * 100 : 0;
  if (cancelRate >= 10 && cancelledSales.length >= 2) {
    alerts.push({
      level: 'warning',
      msg: `Taxa de cancelamento em ${cancelRate.toFixed(0)}% (${cancelledSales.length} cancelada${cancelledSales.length > 1 ? 's' : ''} de ${totalAll} lançada${totalAll > 1 ? 's' : ''})`
    });
  }

  // Caixa aberto há muito tempo
  if (cashSession?.isOpen && cashSession?.openedAt) {
    const openHours = (Date.now() - new Date(cashSession.openedAt).getTime()) / 3600000;
    if (openHours >= 12) {
      alerts.push({
        level: 'warning',
        msg: `Caixa aberto há ${openHours.toFixed(0)}h — verifique se é necessário fechar.`
      });
    }
  }

  // Longa inatividade de vendas (caixa aberto + houve vendas)
  if (cashSession?.isOpen && sales.length > 0) {
    const lastSale = sales.reduce((latest, s) => {
      const d = new Date(s.createdAt || 0);
      return d > latest ? d : latest;
    }, new Date(0));
    const minutesIdle = (Date.now() - lastSale.getTime()) / 60000;
    if (minutesIdle > 45) {
      alerts.push({
        level: 'info',
        msg: `Nenhuma venda registrada há ${Math.round(minutesIdle)} minutos. Caixa está aberto.`
      });
    }
  }

  // Estoque crítico
  const allProducts = Array.isArray(products) ? products : [];
  const lowStock = allProducts.filter(p => {
    const qty = Number(p.stock ?? 0);
    const min = Number(p.minStock ?? 5);
    return qty > 0 && qty <= min;
  });
  if (lowStock.length > 0) {
    const names = lowStock.slice(0, 3).map(p => _esc(p.name || 'Produto')).join(', ');
    alerts.push({
      level: 'warning',
      msg: `${lowStock.length} produto${lowStock.length > 1 ? 's' : ''} com estoque crítico: ${names}${lowStock.length > 3 ? ` (+${lowStock.length - 3})` : ''}`
    });
  }

  // Sem estoque
  const outOfStock = allProducts.filter(p => Number(p.stock ?? 0) === 0 && p.stockControl !== false);
  if (outOfStock.length > 0) {
    alerts.push({
      level: 'error',
      msg: `${outOfStock.length} produto${outOfStock.length > 1 ? 's' : ''} sem estoque disponível`
    });
  }

  return alerts;
}

// ── Rendering ────────────────────────────────────────────────────────────────
function _renderKPIs(kpis, compareLabel) {
  const cards = [
    {
      icon: '🧾',
      label: 'Vendas',
      value: String(kpis.salesCount),
      delta: _fmtDelta(kpis.salesCount, kpis.compareSalesCount),
      sub: `vs. ${compareLabel}: ${kpis.compareSalesCount}`
    },
    {
      icon: '💰',
      label: 'Receita',
      value: _fmtBRL(kpis.totalRevenue),
      delta: _fmtDelta(kpis.totalRevenue, kpis.compareRevenue),
      sub: `vs. ${compareLabel}: ${_fmtBRL(kpis.compareRevenue)}`
    },
    {
      icon: '📊',
      label: 'Ticket Médio',
      value: _fmtBRL(kpis.avgTicket),
      delta: _fmtDelta(kpis.avgTicket, kpis.compareAvgTicket),
      sub: `vs. ${compareLabel}: ${_fmtBRL(kpis.compareAvgTicket)}`
    },
    {
      icon: '📦',
      label: 'Itens Vendidos',
      value: String(kpis.totalItems),
      delta: _fmtDelta(kpis.totalItems, kpis.compareItems),
      sub: `vs. ${compareLabel}: ${kpis.compareItems}`
    },
    {
      icon: '🏷',
      label: 'Com Desconto',
      value: String(kpis.discountsCount),
      delta: '',
      sub: `Total descontado: ${_fmtBRL(kpis.discountsValue)}`
    }
  ];

  return `
    <div class="pdva-kpi-grid">
      ${cards.map(c => `
        <div class="pdva-kpi-card">
          <div class="pdva-kpi-top">
            <span class="pdva-kpi-icon">${c.icon}</span>
            <span class="pdva-kpi-label">${c.label}</span>
            ${c.delta ? c.delta : ''}
          </div>
          <div class="pdva-kpi-value">${c.value}</div>
          <div class="pdva-kpi-sub">${c.sub}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function _renderAlerts(alerts) {
  if (!alerts.length) return '';
  return `
    <div class="pdva-alerts-panel">
      ${alerts.map(a => `
        <div class="pdva-alert pdva-alert-${_esc(a.level)}">
          <span class="pdva-alert-ico">${a.level === 'error' ? '🔴' : a.level === 'warning' ? '⚠️' : 'ℹ️'}</span>
          <span>${a.msg}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function _renderPaymentBreakdown(breakdown) {
  if (!breakdown.length) {
    return `<div class="pdva-card"><h3 class="pdva-card-title">Formas de Pagamento</h3><p class="pdva-empty">Sem vendas no período.</p></div>`;
  }
  const totalCount = breakdown.reduce((a, b) => a + b.count, 0);
  return `
    <div class="pdva-card">
      <h3 class="pdva-card-title">Formas de Pagamento</h3>
      <div class="pdva-payment-list">
        ${breakdown.map(b => `
          <div class="pdva-payment-row">
            <div class="pdva-payment-head">
              <span class="pdva-payment-icon">${b.icon}</span>
              <span class="pdva-payment-label">${_esc(b.label)}</span>
              <span class="pdva-payment-pct">${_fmtPct(b.pct)}</span>
            </div>
            <div class="pdva-payment-bar-wrap">
              <div class="pdva-payment-bar" style="width:${Math.max(b.pct, 2)}%"></div>
            </div>
            <div class="pdva-payment-meta">
              <span>${b.count} venda${b.count !== 1 ? 's' : ''}</span>
              <span>${_fmtBRL(b.total)}</span>
            </div>
          </div>
        `).join('')}
        <div class="pdva-payment-total">
          <span>${totalCount} vendas no período</span>
        </div>
      </div>
    </div>
  `;
}

function _renderHourlyChart(byHour, period) {
  const maxCount = Math.max(...byHour.map(h => h.count), 1);
  const now = new Date();
  const currentHour = now.getHours();

  // Only show hours with activity or a context window around current hour for today
  const relevant = period === 'today'
    ? byHour.filter(h => h.count > 0 || (h.hour >= 6 && h.hour <= currentHour))
    : byHour.filter(h => h.count > 0);

  if (!relevant.length) {
    return `<div class="pdva-card pdva-card-hour"><h3 class="pdva-card-title">Vendas por Hora</h3><p class="pdva-empty">Sem dados no período.</p></div>`;
  }

  const peakHour = byHour.reduce((peak, h) => h.count > peak.count ? h : peak, byHour[0]);

  return `
    <div class="pdva-card pdva-card-hour">
      <h3 class="pdva-card-title">
        Vendas por Hora
        ${peakHour.count > 0 ? `<span class="pdva-peak-badge">Pico: ${peakHour.hour}h (${peakHour.count} venda${peakHour.count !== 1 ? 's' : ''})</span>` : ''}
      </h3>
      <div class="pdva-hour-chart">
        ${relevant.map(h => {
          const heightPct = Math.round((h.count / maxCount) * 100);
          const isPeak = h.count === maxCount && h.count > 0;
          const isCurrent = period === 'today' && h.hour === currentHour;
          return `
            <div class="pdva-hbar-col${isPeak ? ' pdva-hbar-peak' : ''}${isCurrent ? ' pdva-hbar-now' : ''}"
                 title="${h.hour}h — ${h.count} venda${h.count !== 1 ? 's' : ''} — ${_fmtBRL(h.total)}">
              <div class="pdva-hbar-fill" style="height:${heightPct}%"></div>
              <span class="pdva-hbar-lbl">${h.hour}h</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function _renderTopProducts(topProducts) {
  function _productList(items, valueKey, fmt) {
    if (!items.length) return '<p class="pdva-empty">Sem dados.</p>';
    const max = items[0][valueKey] || 1;
    return items.map((p, i) => `
      <div class="pdva-top-row">
        <span class="pdva-top-rank">${i + 1}</span>
        <div class="pdva-top-info">
          <span class="pdva-top-name">${_esc(p.name)}</span>
          <div class="pdva-top-bar-wrap">
            <div class="pdva-top-bar" style="width:${Math.round((p[valueKey] / max) * 100)}%"></div>
          </div>
        </div>
        <span class="pdva-top-val">${fmt(p[valueKey])}</span>
      </div>
    `).join('');
  }

  return `
    <div class="pdva-card pdva-card-products">
      <h3 class="pdva-card-title">Top Produtos</h3>
      <div class="pdva-tabs">
        <button class="pdva-tab active" data-pdva-tab="qty" type="button">Por Quantidade</button>
        <button class="pdva-tab" data-pdva-tab="rev" type="button">Por Receita</button>
        <button class="pdva-tab" data-pdva-tab="least" type="button">Menos Vendidos</button>
      </div>
      <div class="pdva-tab-panel" data-pdva-panel="qty">
        ${_productList(topProducts.byQty, 'quantity', v => `${v} un.`)}
      </div>
      <div class="pdva-tab-panel hidden" data-pdva-panel="rev">
        ${_productList(topProducts.byRev, 'revenue', v => _fmtBRL(v))}
      </div>
      <div class="pdva-tab-panel hidden" data-pdva-panel="least">
        ${_productList(topProducts.least, 'quantity', v => `${v} un.`)}
      </div>
    </div>
  `;
}

function _renderOperatorRanking(byOperator) {
  if (!byOperator.length) {
    return `<div class="pdva-card pdva-card-operators"><h3 class="pdva-card-title">Desempenho por Operador</h3><p class="pdva-empty">Sem dados no período.</p></div>`;
  }
  return `
    <div class="pdva-card pdva-card-operators">
      <h3 class="pdva-card-title">Desempenho por Operador</h3>
      <div class="pdva-op-table-wrap">
        <table class="pdva-op-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Operador</th>
              <th>Vendas</th>
              <th>Receita</th>
              <th>Ticket Médio</th>
              <th>Cancelamentos</th>
            </tr>
          </thead>
          <tbody>
            ${byOperator.map((op, i) => `
              <tr class="${op.cancellationRate >= 15 ? 'pdva-op-warn' : ''}">
                <td class="pdva-op-rank">${i + 1}</td>
                <td class="pdva-op-name">${_esc(op.name)}</td>
                <td>${op.count}</td>
                <td>${_fmtBRL(op.revenue)}</td>
                <td>${_fmtBRL(op.avgTicket)}</td>
                <td class="${op.cancelled > 0 ? 'pdva-op-cancel' : ''}">
                  ${op.cancelled}${op.cancelled > 0 ? ` <span class="pdva-op-cancel-pct">(${_fmtPct(op.cancellationRate)})</span>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function _renderCashInfo(cashSession) {
  if (!cashSession?.isOpen) return '';
  const openedAt = cashSession.openedAt ? new Date(cashSession.openedAt) : null;
  const openSince = openedAt
    ? openedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const openHours = openedAt ? ((Date.now() - openedAt.getTime()) / 3600000).toFixed(1) : null;
  const operator = cashSession.operatorName || cashSession.operator?.name || '—';
  const terminal = cashSession.terminalName || 'Caixa principal';

  return `
    <div class="pdva-cash-bar">
      <div class="pdva-cash-item">
        <span class="pdva-cash-dot pdva-cash-dot-open"></span>
        <span>Caixa aberto desde <strong>${openSince}</strong>${openHours ? ` (${openHours}h)` : ''}</span>
      </div>
      <div class="pdva-cash-item">
        <span>Operador: <strong>${_esc(operator)}</strong></span>
      </div>
      <div class="pdva-cash-item">
        <span>Terminal: <strong>${_esc(terminal)}</strong></span>
      </div>
    </div>
  `;
}

// ── Tab binding ──────────────────────────────────────────────────────────────
function _bindProductTabs(container) {
  const tabs = container.querySelectorAll('[data-pdva-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const panelId = tab.dataset.pdvaTab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      container.querySelectorAll('[data-pdva-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.pdvaPanel !== panelId);
      });
    });
  });
}

// ── Main render ──────────────────────────────────────────────────────────────
let _currentPeriod = 'today';
let _initialized = false;

export function renderPDVAnalytics(period) {
  _currentPeriod = period || _currentPeriod;

  const content = document.getElementById('pdvaContent');
  const lastUpdated = document.getElementById('pdvaLastUpdated');
  if (!content) return;

  const allSales = Array.isArray(state.sales) ? state.sales : [];
  const products = Array.isArray(state.products) ? state.products : [];
  const cashSession = state.cashSession || null;

  const range = _getPeriodRange(_currentPeriod);
  const sales = _filterSales(allSales, range.start, range.end, true);
  const cancelledInPeriod = _filterSales(allSales, range.start, range.end, false)
    .filter(s => s.cancelled || s.isCancelled);
  const compareSales = _filterSales(allSales, range.compareStart, range.compareEnd, true);

  const kpis = _computeKPIs(sales, compareSales);
  const paymentBreakdown = _computePaymentBreakdown(sales);
  const topProducts = _computeTopProducts(sales);
  const byHour = _computeByHour(sales);
  const byOperator = _computeByOperator(sales, cancelledInPeriod);
  const alerts = _computeAlerts(sales, cancelledInPeriod, cashSession, products);

  const html = `
    ${_renderCashInfo(cashSession)}
    ${_renderAlerts(alerts)}
    ${_renderKPIs(kpis, range.compareLabel)}
    <div class="pdva-row-2">
      ${_renderPaymentBreakdown(paymentBreakdown)}
      ${_renderHourlyChart(byHour, _currentPeriod)}
    </div>
    <div class="pdva-row-3">
      ${_renderTopProducts(topProducts)}
      ${_renderOperatorRanking(byOperator)}
    </div>
  `;

  content.innerHTML = html;
  _bindProductTabs(content);

  if (lastUpdated) {
    lastUpdated.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
}

export function initPDVAnalytics() {
  if (_initialized) {
    renderPDVAnalytics(_currentPeriod);
    return;
  }
  _initialized = true;

  // Period buttons
  document.querySelectorAll('[data-pdva-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentPeriod = btn.dataset.pdvaPeriod;
      document.querySelectorAll('[data-pdva-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPDVAnalytics(_currentPeriod);
    });
  });

  // Refresh button
  document.getElementById('pdvaRefreshBtn')?.addEventListener('click', () => {
    renderPDVAnalytics(_currentPeriod);
  });

  // Live updates from PDV
  document.addEventListener('gamby:sales-updated', () => {
    const section = document.querySelector('[data-page-content="pdv-analytics"]');
    const isActive = section && !section.classList.contains('hidden');
    if (isActive) renderPDVAnalytics(_currentPeriod);
  });

  renderPDVAnalytics(_currentPeriod);
}
