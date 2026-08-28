/**
 * business-intelligence.js
 * Central de Inteligência — módulo frontend
 * Todos os dados vêm da API real. Sem mocks, sem dados fixos.
 */

import { getBusinessIntelligenceService } from './services/business-intelligence-service.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _fmtPct(v) {
  return Number(v || 0).toFixed(1) + '%';
}

function _fmtNum(v) {
  return Number(v || 0).toLocaleString('pt-BR');
}

/* ── Estado ── */
let _data = null;
let _loading = false;
let _biChart = null;

/* ── Skeleton loader ── */
function _showSkeleton() {
  const el = document.getElementById('biContent');
  if (!el) return;
  el.innerHTML = `
    <div class="bi-skeleton-grid">
      ${Array(4).fill('<div class="bi-skeleton-card"><div class="sk-line sk-w60"></div><div class="sk-line sk-w40 sk-mt"></div></div>').join('')}
    </div>
    <div class="bi-skeleton-grid bi-skeleton-grid--3">
      ${Array(3).fill('<div class="bi-skeleton-card bi-skeleton-card--tall"><div class="sk-line sk-w50"></div><div class="sk-line sk-w80 sk-mt"></div><div class="sk-line sk-w70 sk-mt"></div></div>').join('')}
    </div>
  `;
}

/* ── Estado vazio ── */
function _showEmpty(message) {
  const el = document.getElementById('biContent');
  if (!el) return;
  el.innerHTML = `
    <div class="bi-empty-state">
      <div class="bi-empty-ico">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#3b82f6" stroke-width="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      </div>
      <p class="bi-empty-title">Dados insuficientes</p>
      <p class="bi-empty-sub">${_esc(message || 'Realize vendas para que os insights apareçam aqui.')}</p>
    </div>
  `;
}

/* ── Renderiza alertas inteligentes ── */
function _renderAlerts(alerts) {
  const el = document.getElementById('biAlerts');
  if (!el) return;
  if (!alerts || !alerts.length) { el.innerHTML = ''; return; }

  const iconMap = {
    alert:          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    pause:          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>',
    'trending-down':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
    percent:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  };

  const colorMap = { danger: '#f87171', warning: '#fbbf24', info: '#60a5fa' };

  el.innerHTML = alerts.map(a => {
    const ico   = iconMap[a.icon] || iconMap.alert;
    const color = colorMap[a.type] || '#60a5fa';
    return `
      <div class="bi-alert-card bi-alert-card--${_esc(a.type)}" data-alert-color="${color}">
        <span class="bi-alert-ico">${ico}</span>
        <div class="bi-alert-body">
          <strong class="bi-alert-title">${_esc(a.title)}</strong>
          <span class="bi-alert-msg">${_esc(a.message)}</span>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-alert-color]').forEach(d => {
    d.style.borderLeftColor = d.dataset.alertColor;
    d.querySelector('.bi-alert-ico').style.color = d.dataset.alertColor;
  });
}

/* ── Renderiza previsão de faturamento ── */
function _renderRevenueForecast(rf) {
  const el = document.getElementById('biRevenueForecast');
  if (!el || !rf) return;

  const progressPct = rf.totalDays > 0
    ? Math.min(100, (rf.currentRevenue / (rf.projectedRevenue || 1)) * 100)
    : 0;

  const growthColor = rf.growthVsLastMonth === null ? '#94a3b8'
    : rf.growthVsLastMonth >= 0 ? '#4ade80' : '#f87171';
  const growthText  = rf.growthVsLastMonth === null ? '—'
    : (rf.growthVsLastMonth >= 0 ? '▲' : '▼') + ' ' + Math.abs(rf.growthVsLastMonth).toFixed(1) + '% vs mês anterior';

  el.innerHTML = `
    <div class="bi-fc-header">
      <div class="bi-fc-label">Faturamento do mês</div>
      <span class="bi-fc-growth" data-growth-color="${growthColor}">${_esc(growthText)}</span>
    </div>
    <div class="bi-fc-value">${_fmt(rf.projectedRevenue)}</div>
    <div class="bi-fc-sub">Projeção para ${rf.totalDays} dias · ${_fmt(rf.currentRevenue)} realizados em ${rf.daysElapsed} dia(s)</div>
    <div class="bi-fc-bar-wrap">
      <div class="bi-fc-bar" data-pct="${progressPct.toFixed(0)}"></div>
    </div>
    <div class="bi-fc-row">
      <span class="bi-fc-row-lbl">Média diária atual</span>
      <strong>${_fmt(rf.dailyAvg)}</strong>
    </div>
    <div class="bi-fc-row">
      <span class="bi-fc-row-lbl">Média diária mês anterior</span>
      <strong>${rf.lastMonthDailyAvg > 0 ? _fmt(rf.lastMonthDailyAvg) : '—'}</strong>
    </div>
    <div class="bi-fc-row">
      <span class="bi-fc-row-lbl">Dias restantes</span>
      <strong>${rf.daysRemaining}</strong>
    </div>
  `;

  el.querySelector('[data-growth-color]')?.style.setProperty('color', growthColor);
  const bar = el.querySelector('.bi-fc-bar');
  if (bar) {
    bar.style.width = progressPct.toFixed(0) + '%';
    bar.style.background = progressPct >= 80 ? '#22c55e' : progressPct >= 50 ? '#3b82f6' : '#f59e0b';
  }
}

/* ── Renderiza previsão de lucro ── */
function _renderProfitForecast(pf) {
  const el = document.getElementById('biProfitForecast');
  if (!el || !pf) return;

  const marginColor = pf.profitMarginPct >= 20 ? '#4ade80'
    : pf.profitMarginPct >= 10 ? '#f59e0b' : '#f87171';

  el.innerHTML = `
    <div class="bi-fc-label">Lucro estimado do mês</div>
    <div class="bi-fc-value" data-margin-color="${marginColor}">${_fmt(pf.projectedProfit)}</div>
    <div class="bi-fc-sub">Projeção · ${_fmt(pf.currentProfit)} realizados até agora</div>
    <div class="bi-fc-row bi-fc-row--mt">
      <span class="bi-fc-row-lbl">Margem bruta atual</span>
      <strong data-margin-color="${marginColor}">${_fmtPct(pf.profitMarginPct)}</strong>
    </div>
  `;

  el.querySelectorAll('[data-margin-color]').forEach(d => { d.style.color = marginColor; });
}

/* ── Renderiza risco de ruptura ── */
function _renderRuptureRisk(items) {
  const el = document.getElementById('biRuptureRisk');
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<p class="bi-empty-p">Nenhum produto em risco de ruptura. Estoque saudável.</p>';
    return;
  }

  const levelMeta = {
    critical:  { label: 'Crítico',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
    high:      { label: 'Alto',      color: '#fb923c', bg: 'rgba(251,146,60,0.12)'  },
    medium:    { label: 'Médio',     color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
    low_stock: { label: 'Mín.',      color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
  };

  el.innerHTML = items.map(p => {
    const m = levelMeta[p.level] || levelMeta.low_stock;
    const daysText = p.daysUntilOut !== null
      ? `<strong data-ri-color="${m.color}">${p.daysUntilOut} dia(s)</strong>`
      : '<strong>—</strong>';
    return `
      <div class="bi-ri-row">
        <div class="bi-ri-info">
          <span class="bi-ri-name">${_esc(p.name)}</span>
          <span class="bi-ri-cat">${_esc(p.category || '')}</span>
        </div>
        <div class="bi-ri-meta">
          <span class="bi-ri-stock">Estoque: ${_fmtNum(p.stock)}</span>
          <span class="bi-ri-avg">Média: ${p.dailySalesAvg.toFixed(1)}/dia</span>
        </div>
        <div class="bi-ri-days">${daysText}</div>
        <span class="bi-ri-badge" data-ri-bg="${m.bg}" data-ri-color="${m.color}">${m.label}</span>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-ri-color]').forEach(d => { d.style.color = d.dataset.riColor; });
  el.querySelectorAll('[data-ri-bg]').forEach(d => {
    d.style.background = d.dataset.riBg;
    d.style.color      = d.dataset.riColor;
  });
}

/* ── Renderiza produtos sem giro ── */
let _deadStockMode = 30;

function _renderDeadStock(deadStock) {
  const el = document.getElementById('biDeadStockList');
  if (!el || !deadStock) return;

  const items = _deadStockMode === 15 ? deadStock.days15
    : _deadStockMode === 60 ? deadStock.days60
    : deadStock.days30;

  // Update badges
  const c = deadStock.counts;
  const b15 = document.getElementById('biDsBadge15');
  const b30 = document.getElementById('biDsBadge30');
  const b60 = document.getElementById('biDsBadge60');
  if (b15) b15.textContent = c.days15;
  if (b30) b30.textContent = c.days30;
  if (b60) b60.textContent = c.days60;

  if (!items || !items.length) {
    el.innerHTML = '<p class="bi-empty-p">Todos os produtos tiveram venda neste período.</p>';
    return;
  }

  el.innerHTML = items.slice(0, 15).map(p => `
    <div class="bi-ds-row">
      <span class="bi-ds-name">${_esc(p.name)}</span>
      <span class="bi-ds-cat">${_esc(p.category || '—')}</span>
      <span class="bi-ds-stock">${_fmtNum(p.stock)} un.</span>
    </div>
  `).join('');
}

/* ── Renderiza ranking de produtos lucrativos ── */
function _renderProfitableProducts(products) {
  const el = document.getElementById('biProfitableList');
  if (!el) return;
  if (!products || !products.length) {
    el.innerHTML = '<tr><td colspan="5" class="bi-empty-p">Sem dados de lucro no período.</td></tr>';
    return;
  }

  el.innerHTML = products.map((p, i) => {
    const marginColor = p.margin >= 30 ? '#4ade80' : p.margin >= 15 ? '#fbbf24' : '#f87171';
    return `
      <tr>
        <td class="bi-pp-rank">${i + 1}</td>
        <td class="bi-pp-name">${_esc(p.name)}</td>
        <td class="bi-pp-qty">${_fmtNum(p.quantity)} un.</td>
        <td class="bi-pp-revenue">${_fmt(p.revenue)}</td>
        <td class="bi-pp-profit" data-profit-color="${marginColor}">${_fmt(p.profit)} <small>(${_fmtPct(p.margin)})</small></td>
      </tr>
    `;
  }).join('');

  el.querySelectorAll('[data-profit-color]').forEach(d => { d.style.color = d.dataset.profitColor; });
}

/* ── Renderiza horário de pico ── */
function _renderPeakHours(peakHours) {
  const canvas = document.getElementById('biPeakChart');
  if (!canvas) return;

  if (_biChart) { try { _biChart.destroy(); } catch {} _biChart = null; }

  if (!peakHours || !peakHours.some(h => h.salesCount > 0)) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.parentElement.querySelector('.bi-peak-empty')?.remove();
    const p = document.createElement('p');
    p.className = 'bi-empty-p bi-peak-empty';
    p.textContent = 'Sem dados de horário no período.';
    canvas.parentElement.appendChild(p);
    return;
  }

  const labels  = peakHours.map(h => `${String(h.hour).padStart(2, '0')}h`);
  const sales   = peakHours.map(h => h.salesCount);
  const revenue = peakHours.map(h => h.revenue);
  const maxRev  = Math.max(...revenue, 1);
  const bgColors = revenue.map(r => {
    const pct = r / maxRev;
    if (pct >= 0.75) return 'rgba(34,197,94,0.85)';
    if (pct >= 0.40) return 'rgba(59,130,246,0.75)';
    return 'rgba(59,130,246,0.35)';
  });

  _biChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Vendas',
        data: sales,
        backgroundColor: bgColors,
        borderRadius: 4,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.raw} venda(s) · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(revenue[ctx.dataIndex])}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#64748b', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });

  // Top 3 horários de pico
  const top3 = document.getElementById('biPeakTop');
  if (top3) {
    const sorted = [...peakHours].filter(h => h.salesCount > 0).sort((a, b) => b.salesCount - a.salesCount).slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    top3.innerHTML = sorted.map((h, i) => `
      <div class="bi-peak-top-row">
        <span class="bi-peak-medal">${medals[i]}</span>
        <span class="bi-peak-hour-lbl">${String(h.hour).padStart(2, '0')}h – ${String(h.hour + 1).padStart(2, '0')}h</span>
        <span class="bi-peak-sales">${h.salesCount} venda(s)</span>
        <span class="bi-peak-rev">${_fmt(h.revenue)}</span>
      </div>
    `).join('');
  }
}

/* ── Renderiza header com timestamp ── */
function _renderHeader(generatedAt) {
  const el = document.getElementById('biLastUpdate');
  if (!el || !generatedAt) return;
  try {
    const d = new Date(generatedAt);
    el.textContent = 'Atualizado às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { el.textContent = ''; }
}

/* ── Render principal ── */
function _renderAll(data) {
  _renderHeader(data.generatedAt);
  _renderAlerts(data.alerts);
  _renderRevenueForecast(data.revenueForecast);
  _renderProfitForecast(data.profitForecast);
  _renderRuptureRisk(data.ruptureRisk);
  _renderDeadStock(data.deadStock);
  _renderProfitableProducts(data.profitableProducts);
  _renderPeakHours(data.peakHours);
}

/* ── Carrega dados da API ── */
async function _loadData(force = false) {
  if (_loading) return;
  if (_data && !force) { _renderAll(_data); return; }

  _loading = true;

  const btn = document.getElementById('biRefreshBtn');
  if (btn) btn.disabled = true;

  _showSkeleton();

  try {
    const result = await getBusinessIntelligenceService();

    if (!result || result.error) {
      _showEmpty('Não foi possível carregar os dados. Verifique a conexão.');
      return;
    }

    _data = result;
    _buildLayout();
    _renderAll(_data);
  } catch (err) {
    console.error('[BI] Erro ao carregar insights:', err);
    _showEmpty('Erro ao conectar com o servidor. Tente novamente.');
  } finally {
    _loading = false;
    if (btn) btn.disabled = false;
  }
}

/* ── Monta o layout da aba ── */
function _buildLayout() {
  const el = document.getElementById('biContent');
  if (!el) return;

  el.innerHTML = `
    <!-- Alertas -->
    <div id="biAlerts" class="bi-alerts-strip"></div>

    <!-- Previsões -->
    <div class="bi-forecast-row">
      <div class="bi-panel bi-panel--blue" id="biRevenueForecast"></div>
      <div class="bi-panel bi-panel--green" id="biProfitForecast"></div>

      <!-- Horário de pico -->
      <div class="bi-panel bi-panel--span2">
        <div class="bi-panel-head">
          <h3>Horário de pico <span class="bi-panel-sub">— últimos 30 dias</span></h3>
        </div>
        <div id="biPeakTop" class="bi-peak-top-list"></div>
        <div class="bi-peak-chart-wrap"><canvas id="biPeakChart"></canvas></div>
      </div>
    </div>

    <!-- Risco de ruptura + sem giro -->
    <div class="bi-mid-row">
      <div class="bi-panel">
        <div class="bi-panel-head">
          <h3>Produtos em risco de ruptura</h3>
          <span class="bi-panel-sub">Estoque vs. média de venda diária</span>
        </div>
        <div id="biRuptureRisk" class="bi-ri-list"></div>
      </div>

      <div class="bi-panel">
        <div class="bi-panel-head">
          <h3>Produtos sem giro</h3>
          <div class="bi-ds-tabs">
            <button class="bi-ds-tab" data-ds-days="15" type="button">15 dias <span class="bi-ds-badge" id="biDsBadge15">0</span></button>
            <button class="bi-ds-tab active" data-ds-days="30" type="button">30 dias <span class="bi-ds-badge" id="biDsBadge30">0</span></button>
            <button class="bi-ds-tab" data-ds-days="60" type="button">60 dias <span class="bi-ds-badge" id="biDsBadge60">0</span></button>
          </div>
        </div>
        <div class="bi-ds-header-row">
          <span>Produto</span><span>Categoria</span><span>Estoque</span>
        </div>
        <div id="biDeadStockList" class="bi-ds-list"></div>
      </div>
    </div>

    <!-- Ranking lucrativo -->
    <div class="bi-panel">
      <div class="bi-panel-head">
        <h3>Ranking de produtos mais lucrativos <span class="bi-panel-sub">— últimos 30 dias</span></h3>
      </div>
      <div class="bi-table-wrap">
        <table class="bi-table">
          <thead><tr><th>#</th><th>PRODUTO</th><th>QTDE</th><th>FATURAMENTO</th><th>LUCRO (MARGEM)</th></tr></thead>
          <tbody id="biProfitableList"></tbody>
        </table>
      </div>
    </div>
  `;

  // Bind dead-stock tabs
  el.querySelectorAll('.bi-ds-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.bi-ds-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _deadStockMode = Number(btn.dataset.dsDays);
      if (_data) _renderDeadStock(_data.deadStock);
    });
  });
}

/* ── Init e bind ── */
let _bound = false;

export function initBusinessIntelligence() {
  // noop — carregamento lazy quando a aba é aberta
}

export function onBusinessIntelligenceOpen() {
  if (!_bound) {
    _bound = true;
    _bindActions();
  }
  _loadData();
}

function _bindActions() {
  document.getElementById('biRefreshBtn')?.addEventListener('click', () => _loadData(true));
}
