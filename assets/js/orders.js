import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { formatCurrency } from './utils.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _scopedKey(base) {
  const cid = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${base}_${cid}`;
}

function _localSales() {
  if (Array.isArray(state.sales) && state.sales.length > 0) return state.sales;
  return load(_scopedKey(KEYS.sales), []);
}

function _localMkOrders() {
  if (Array.isArray(state.marketplace?.onlineOrders) && state.marketplace.onlineOrders.length > 0) {
    return state.marketplace.onlineOrders;
  }
  // marketplace.js uses KEYS.marketplace without company scoping
  const mk = load(KEYS.marketplace, {});
  return Array.isArray(mk.onlineOrders) ? mk.onlineOrders : [];
}

/* ==================== CONSTANTS ==================== */

const STATUS_LABELS = {
  aguardando_pagamento: 'Aguardando pagamento',
  confirmado: 'Pago / Confirmado',
  separando: 'Separando',
  aguardando_envio: 'Aguardando envio',
  enviado: 'Enviado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
  estornado: 'Estornado'
};

const STATUS_COLORS = {
  aguardando_pagamento: '#fbbf24',
  confirmado: '#22c55e',
  separando: '#60a5fa',
  aguardando_envio: '#fb923c',
  enviado: '#818cf8',
  entregue: '#4ade80',
  cancelado: '#f87171',
  estornado: '#f472b6'
};

const PAYMENT_LABELS = {
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  pix: 'PIX',
  boleto: 'Boleto',
  dinheiro: 'Dinheiro',
  outros: 'Outros'
};

const CHANNEL_LOGOS = {
  pdv:          `<span class="ord-ch-logo ord-ch-pdv">PDV</span>`,
  shopee:       `<span class="ord-ch-logo ord-ch-shopee">SHP</span>`,
  mercadolivre: `<span class="ord-ch-logo ord-ch-ml">ML</span>`,
  site:         `<span class="ord-ch-logo ord-ch-site">SITE</span>`,
  amazon:       `<span class="ord-ch-logo ord-ch-amz">AMZ</span>`,
  magalu:       `<span class="ord-ch-logo ord-ch-mlu">MLU</span>`,
  ifood:        `<span class="ord-ch-logo ord-ch-if">iF</span>`,
  marketplace:  `<span class="ord-ch-logo ord-ch-mkt">MKT</span>`
};

const CHANNEL_COLORS = {
  shopee: '#ee4d2d', mercadolivre: '#f5a623', site: '#60a5fa',
  amazon: '#ff9800', magalu: '#0086ff', ifood: '#ea1d2c', pdv: '#4ade80',
  marketplace: '#a78bfa'
};

const CHANNEL_NAMES = {
  pdv: 'PDV', shopee: 'Shopee', mercadolivre: 'Mercado Livre',
  site: 'Site', amazon: 'Amazon', magalu: 'Magalu', ifood: 'iFood', marketplace: 'Marketplace'
};

/* ==================== STATE ==================== */

let _ordersInitialized = false;
let _currentTab = 'todos';
let _currentPage = 1;
let _perPage = 8;
let _searchQuery = '';
let _channelFilter = '';
let _statusFilter = '';
let _newOrderItems = [];

/* ==================== STORAGE ==================== */

function getScopedOrdersKey() {
  const companyId = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${KEYS.orders}_${companyId}`;
}

function loadStoredOrders() {
  return load(getScopedOrdersKey(), []);
}

function saveStoredOrders(orders) {
  save(getScopedOrdersKey(), orders);
}

/* ==================== DATA ==================== */

function normPaymentKey(raw) {
  const r = String(raw || '').toLowerCase().replace(/\s/g, '_');
  if (r.includes('credito') || r.includes('crédito') || r.includes('credit')) return 'cartao_credito';
  if (r.includes('debito') || r.includes('débito') || r.includes('debit')) return 'cartao_debito';
  if (r.includes('pix')) return 'pix';
  if (r.includes('boleto')) return 'boleto';
  if (r.includes('dinheiro') || r.includes('cash') || r.includes('especie') || r.includes('espécie')) return 'dinheiro';
  return 'outros';
}

function normChannel(raw) {
  const r = String(raw || '').toLowerCase();
  if (r === 'pdv' || r === 'caixa') return 'pdv';
  if (r.includes('shopee')) return 'shopee';
  if (r.includes('mercado') || r === 'ml') return 'mercadolivre';
  if (r === 'site' || r === 'ecommerce' || r === 'e-commerce') return 'site';
  if (r.includes('amazon')) return 'amazon';
  if (r.includes('magalu') || r.includes('magazine')) return 'magalu';
  if (r.includes('ifood') || r === 'if') return 'ifood';
  return 'marketplace';
}

function _mapSaleStatus(sale) {
  const cancelled = sale.cancelled || sale.isCancelled || sale.status === 'cancelled' || sale.status === 'canceled';
  if (cancelled) return 'cancelado';
  const estornado = sale.status === 'refunded' || sale.status === 'estornado';
  if (estornado) return 'estornado';
  if (sale.status === 'pending' || sale.status === 'aguardando_pagamento') return 'aguardando_pagamento';
  return 'entregue';
}

function _mapSalePayStatus(sale) {
  const cancelled = sale.cancelled || sale.isCancelled || sale.status === 'cancelled' || sale.status === 'canceled';
  if (cancelled) return 'estornado';
  return 'pago';
}

function salesToOrders() {
  return _localSales().map(sale => {
    const ts = sale.timestamp || sale.createdAt || sale.date || null;
    const id = sale.id || sale.timestamp || Math.random().toString(36).slice(2);
    const numericId = String(id).replace(/\D/g, '').slice(-5).padStart(5, '0');
    return {
      id: String(id),
      orderNumber: '#' + numericId,
      date: ts,
      channel: 'pdv',
      platformId: null,
      customer: { name: sale.customerName || sale.operatorName || 'Cliente PDV', email: '' },
      items: sale.items || sale.cart || [],
      total: Number(sale.total || sale.grandTotal || 0),
      status: _mapSaleStatus(sale),
      paymentMethod: normPaymentKey(sale.payment || sale.paymentMethod || 'dinheiro'),
      paymentStatus: _mapSalePayStatus(sale),
      delivery: 'Retirada no local',
      tracking: '',
      createdAt: ts,
      _fromSale: true
    };
  });
}

function mkToOrders() {
  return _localMkOrders().map(order => {
    const id = order.id || order.orderId || Math.random().toString(36).slice(2);
    return {
      id: String(id),
      orderNumber: order.orderNumber || '#' + String(id).slice(-5).padStart(5, '0'),
      date: order.createdAt || order.date || null,
      channel: normChannel(order.platform || order.channel || 'marketplace'),
      platformId: order.platform,
      customer: { name: order.customerName || 'Cliente Online', email: order.customerEmail || '' },
      items: order.items || [],
      total: Number(order.total || order.value || 0),
      status: order.status || 'aguardando_envio',
      paymentMethod: normPaymentKey(order.paymentMethod || 'pix'),
      paymentStatus: order.paymentStatus || 'pago',
      delivery: order.shippingMethod || 'Correios PAC',
      tracking: order.trackingCode || '',
      createdAt: order.createdAt || order.date || null,
      _fromMk: true
    };
  });
}

function getAllOrders() {
  const stored = loadStoredOrders();
  const fromSales = salesToOrders();
  const fromMk = mkToOrders();

  const map = new Map();
  [...fromSales, ...fromMk, ...stored].forEach(o => {
    if (!map.has(o.id)) map.set(o.id, o);
    else map.set(o.id, { ...map.get(o.id), ...o });
  });

  return Array.from(map.values()).sort((a, b) => {
    const da = new Date(a.date || a.createdAt || 0).getTime();
    const db = new Date(b.date || b.createdAt || 0).getTime();
    return db - da;
  });
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function getFilteredOrders(orders, tab, search, channelF, statusF) {
  let list = orders;

  if (tab === 'marketplace') list = list.filter(o => o.channel !== 'pdv' && o.channel !== 'site');
  else if (tab === 'site') list = list.filter(o => o.channel === 'site');
  else if (tab === 'pdv') list = list.filter(o => o.channel === 'pdv');
  else if (tab === 'cancelados') list = list.filter(o => o.status === 'cancelado' || o.status === 'estornado');

  if (channelF) list = list.filter(o => o.channel === channelF);
  if (statusF) list = list.filter(o => o.status === statusF);

  if (search) {
    const s = search.toLowerCase();
    list = list.filter(o =>
      (o.orderNumber || '').toLowerCase().includes(s) ||
      (o.customer?.name || '').toLowerCase().includes(s) ||
      CHANNEL_NAMES[o.channel]?.toLowerCase().includes(s)
    );
  }

  return list;
}

function computeKpis(orders) {
  const today = orders.filter(o => isToday(o.date || o.createdAt));
  const total = orders.length;
  const todayCount = today.length;
  const todayRevenue = today.reduce((a, o) => a + (o.total || 0), 0);
  const avgTicket = total > 0 ? orders.reduce((a, o) => a + (o.total || 0), 0) / total : 0;
  const awaitingShip = orders.filter(o => o.status === 'aguardando_envio').length;
  const deliveredToday = today.filter(o => o.status === 'entregue').length;
  return { total, todayCount, todayRevenue, avgTicket, awaitingShip, deliveredToday };
}

function computeTabCounts(orders) {
  return {
    todos: orders.length,
    marketplace: orders.filter(o => o.channel !== 'pdv' && o.channel !== 'site').length,
    site: orders.filter(o => o.channel === 'site').length,
    pdv: orders.filter(o => o.channel === 'pdv').length,
    cancelados: orders.filter(o => o.status === 'cancelado' || o.status === 'estornado').length
  };
}

function computeByChannel(orders) {
  const map = {};
  orders.forEach(o => {
    const ch = o.channel || 'outros';
    map[ch] = (map[ch] || 0) + 1;
  });
  return map;
}

function computeByStatus(orders) {
  const map = {};
  Object.keys(STATUS_LABELS).forEach(k => { map[k] = 0; });
  orders.forEach(o => { if (o.status) map[o.status] = (map[o.status] || 0) + 1; });
  return map;
}

function computeDailyRevenue(orders, days = 7) {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    const rev = orders
      .filter(o => {
        const od = new Date(o.date || o.createdAt || 0);
        return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth() && od.getDate() === d.getDate();
      })
      .reduce((a, o) => a + (o.total || 0), 0);
    result.push({ label, rev });
  }
  return result;
}

function computePaymentMethods(orders) {
  const map = {};
  orders.forEach(o => {
    const k = o.paymentMethod || 'outros';
    map[k] = (map[k] || 0) + 1;
  });
  return map;
}

function computeDeliveryPerf(orders) {
  const shipped = orders.filter(o => ['enviado','entregue'].includes(o.status));
  if (!shipped.length) return { rate: 100, onTime: 0, late: 0, pending: 0 };
  const onTime = shipped.filter(o => o.status === 'entregue').length;
  const late = shipped.filter(o => o.status === 'enviado').length;
  const pending = orders.filter(o => o.status === 'aguardando_envio').length;
  const rate = shipped.length > 0 ? Math.round((onTime / shipped.length) * 100) : 100;
  return { rate, onTime, late, pending };
}

function getLateOrders(orders) {
  return orders
    .filter(o => o.status === 'aguardando_envio' || o.status === 'enviado')
    .slice(0, 3)
    .map((o, i) => ({ ...o, daysLate: i + 1 }));
}

/* ==================== RENDER HELPERS ==================== */

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const min = String(d.getMinutes()).padStart(2,'0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch { return '—'; }
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status || '—';
  const color = STATUS_COLORS[status] || '#94a3b8';
  const span = document.createElement('span');
  span.className = 'ord-status-pill';
  span.textContent = label;
  span.style.background = color + '22';
  span.style.color = color;
  return span.outerHTML;
}

function paymentBadge(method, status) {
  const label = PAYMENT_LABELS[method] || method || '—';
  const isPaid = status === 'pago';
  const isRefunded = status === 'estornado';
  const color = isRefunded ? '#f472b6' : isPaid ? '#4ade80' : '#fbbf24';
  const statusLabel = isRefunded ? 'Estornado' : isPaid ? 'Pago' : 'Pendente';
  const pill = document.createElement('span');
  pill.className = 'ord-pay-pill';
  pill.textContent = statusLabel;
  pill.style.background = color + '22';
  pill.style.color = color;
  const lbl = document.createElement('span');
  lbl.className = 'ord-pay-method-lbl';
  lbl.textContent = label;
  const wrap = document.createElement('div');
  wrap.className = 'ord-pay-wrap';
  wrap.appendChild(lbl);
  wrap.appendChild(pill);
  return wrap.outerHTML;
}

/* ==================== MAIN INJECT ==================== */

function injectOrdersHTML() {
  const section = document.querySelector('[data-page-content="pedidos"]');
  if (!section || section.dataset.ordersInjected) return;
  section.dataset.ordersInjected = '1';

  section.innerHTML = `
<div class="ord-shell">
  <!-- HEADER -->
  <div class="ord-header">
    <div>
      <h2 class="ord-title">Pedidos</h2>
      <p class="ord-subtitle">Centralize, gerencie e acompanhe todos os pedidos dos seus canais de venda.</p>
    </div>
    <div class="ord-header-right">
      <div class="ord-date-selector">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span id="ordDateLabel">Todos os períodos</span>
      </div>
      <button class="ord-new-btn" id="ordNewBtn" type="button">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo pedido
      </button>
    </div>
  </div>

  <!-- TABS -->
  <div class="ord-tabs" id="ordTabs">
    <button class="ord-tab active" data-tab="todos">Todos <span class="ord-tab-count" id="ordTabTodos">0</span></button>
    <button class="ord-tab" data-tab="marketplace">Marketplace <span class="ord-tab-count" id="ordTabMarketplace">0</span></button>
    <button class="ord-tab" data-tab="site">Site <span class="ord-tab-count" id="ordTabSite">0</span></button>
    <button class="ord-tab" data-tab="pdv">PDV <span class="ord-tab-count" id="ordTabPdv">0</span></button>
    <button class="ord-tab" data-tab="cancelados">Cancelados <span class="ord-tab-count" id="ordTabCancelados">0</span></button>
  </div>

  <!-- KPI STRIP -->
  <div class="ord-kpi-strip" id="ordKpiStrip">
    <div class="ord-kpi-card">
      <div class="ord-kpi-icon ord-kpi-ico-blue">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.8"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
      </div>
      <div class="ord-kpi-body">
        <span class="ord-kpi-label">Total de pedidos</span>
        <strong class="ord-kpi-val" id="ordKpiTotal">0</strong>
        <span class="ord-kpi-sub" id="ordKpiTotalSub">vs período anterior</span>
      </div>
    </div>
    <div class="ord-kpi-card">
      <div class="ord-kpi-icon ord-kpi-ico-blue">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="ord-kpi-body">
        <span class="ord-kpi-label">Pedidos hoje</span>
        <strong class="ord-kpi-val" id="ordKpiToday">0</strong>
        <span class="ord-kpi-sub" id="ordKpiTodaySub">vs ontem</span>
      </div>
    </div>
    <div class="ord-kpi-card">
      <div class="ord-kpi-icon ord-kpi-ico-green">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      </div>
      <div class="ord-kpi-body">
        <span class="ord-kpi-label">Faturamento hoje</span>
        <strong class="ord-kpi-val" id="ordKpiRevenue">R$ 0,00</strong>
        <span class="ord-kpi-sub ord-kpi-sub-green" id="ordKpiRevenueSub"></span>
      </div>
    </div>
    <div class="ord-kpi-card">
      <div class="ord-kpi-icon ord-kpi-ico-purple">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      </div>
      <div class="ord-kpi-body">
        <span class="ord-kpi-label">Ticket médio</span>
        <strong class="ord-kpi-val" id="ordKpiTicket">R$ 0,00</strong>
        <span class="ord-kpi-sub" id="ordKpiTicketSub">por pedido</span>
      </div>
    </div>
    <div class="ord-kpi-card">
      <div class="ord-kpi-icon ord-kpi-ico-amber">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="1.8"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      </div>
      <div class="ord-kpi-body">
        <span class="ord-kpi-label">Aguardando envio</span>
        <strong class="ord-kpi-val" id="ordKpiShipping">0</strong>
        <span class="ord-kpi-sub ord-kpi-sub-amber">Ação necessária</span>
      </div>
    </div>
    <div class="ord-kpi-card">
      <div class="ord-kpi-icon ord-kpi-ico-green">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="1.8"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="ord-kpi-body">
        <span class="ord-kpi-label">Entregues hoje</span>
        <strong class="ord-kpi-val" id="ordKpiDelivered">0</strong>
        <span class="ord-kpi-sub" id="ordKpiDeliveredSub">vs ontem</span>
      </div>
    </div>
  </div>

  <!-- MAIN GRID -->
  <div class="ord-main-grid">
    <!-- LEFT: TABLE -->
    <div class="ord-table-area">
      <!-- Filters row -->
      <div class="ord-filter-row">
        <div class="ord-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="ord-search" id="ordSearch" type="text" placeholder="Buscar por número, cliente ou canal..." />
        </div>
        <select class="ord-filter-select" id="ordChannelFilter">
          <option value="">Todos os canais</option>
          <option value="pdv">PDV</option>
          <option value="shopee">Shopee</option>
          <option value="mercadolivre">Mercado Livre</option>
          <option value="site">Site</option>
          <option value="amazon">Amazon</option>
          <option value="magalu">Magalu</option>
          <option value="ifood">iFood</option>
        </select>
        <select class="ord-filter-select" id="ordStatusFilter">
          <option value="">Todos os status</option>
          ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <button class="ord-filter-btn" id="ordExportBtn" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Exportar
        </button>
      </div>

      <!-- Table -->
      <div class="ord-table-wrap">
        <table class="ord-table">
          <thead>
            <tr>
              <th>PEDIDO</th>
              <th>DATA / HORA</th>
              <th>CANAL</th>
              <th>CLIENTE</th>
              <th>STATUS</th>
              <th>PAGAMENTO</th>
              <th>VALOR</th>
              <th>ENTREGA</th>
              <th>AÇÕES</th>
            </tr>
          </thead>
          <tbody id="ordTableBody"></tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="ord-pagination">
        <span id="ordPaginationInfo" class="ord-page-info">Exibindo 0 a 0 de 0 pedidos</span>
        <div class="ord-page-controls">
          <button class="ord-page-btn" id="ordPrevBtn" type="button">&#8249;</button>
          <div id="ordPageNumbers" class="ord-page-numbers"></div>
          <button class="ord-page-btn" id="ordNextBtn" type="button">&#8250;</button>
          <select class="ord-per-page" id="ordPerPage">
            <option value="8">8 por página</option>
            <option value="15">15 por página</option>
            <option value="30">30 por página</option>
          </select>
        </div>
      </div>
    </div>

    <!-- RIGHT SIDEBAR -->
    <div class="ord-sidebar">
      <!-- Channel donut -->
      <div class="ord-side-card">
        <div class="ord-side-card-head">
          <h4>Resumo por canal</h4>
        </div>
        <div class="ord-donut-wrap">
          <canvas id="ordChannelChart" width="120" height="120"></canvas>
          <div class="ord-donut-center" id="ordDonutCenter">0<br><small>Total</small></div>
        </div>
        <div id="ordChannelLegend" class="ord-channel-legend"></div>
        <div class="ord-side-card-footer">
          <span>Ver relatório completo →</span>
        </div>
      </div>

      <!-- Status list -->
      <div class="ord-side-card">
        <div class="ord-side-card-head">
          <h4>Status dos pedidos</h4>
        </div>
        <div id="ordStatusList" class="ord-status-list"></div>
        <div class="ord-side-card-footer">
          <span>Ver todos os status →</span>
        </div>
      </div>

      <!-- Late deliveries -->
      <div class="ord-side-card">
        <div class="ord-side-card-head">
          <h4>Entregas em atraso</h4>
          <button class="ord-side-link" type="button">Ver todos</button>
        </div>
        <div id="ordLateList" class="ord-late-list"></div>
      </div>
    </div>
  </div>

  <!-- ANALYTICS ROW -->
  <div class="ord-analytics-row">
    <div class="ord-chart-card">
      <div class="ord-chart-card-head">
        <h4>Vendas por dia (últimos 7 dias)</h4>
        <strong id="ordRevTotal" class="ord-rev-total">R$ 0,00</strong>
      </div>
      <canvas id="ordSalesChart" height="100"></canvas>
    </div>
    <div class="ord-chart-card">
      <div class="ord-chart-card-head">
        <h4>Formas de pagamento</h4>
      </div>
      <div class="ord-payment-wrap">
        <canvas id="ordPaymentChart" width="100" height="100"></canvas>
        <div id="ordPaymentLegend" class="ord-payment-legend"></div>
      </div>
    </div>
    <div class="ord-chart-card">
      <div class="ord-chart-card-head">
        <h4>Performance de entregas</h4>
      </div>
      <div class="ord-gauge-wrap">
        <canvas id="ordGaugeChart" width="130" height="80"></canvas>
        <div class="ord-gauge-center" id="ordGaugeLabel">100%<br><small>No prazo</small></div>
      </div>
      <div id="ordDeliveryLegend" class="ord-delivery-legend"></div>
    </div>
  </div>

  <!-- QUICK ACTIONS -->
  <div class="ord-quick-actions">
    <button class="ord-qa-btn" type="button" onclick="window._ordAction('etiquetas')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      <strong>Imprimir etiquetas</strong>
      <span>Gerar etiquetas de envio</span>
    </button>
    <button class="ord-qa-btn" type="button" onclick="window._ordAction('romaneio')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <strong>Baixar romaneio</strong>
      <span>Lista de pedidos para envio</span>
    </button>
    <button class="ord-qa-btn" type="button" onclick="window._ordAction('mensagem')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      <strong>Enviar mensagem</strong>
      <span>WhatsApp / E-mail</span>
    </button>
    <button class="ord-qa-btn" type="button" onclick="window._ordAction('exportar')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <strong>Exportar pedidos</strong>
      <span>Excel / PDF</span>
    </button>
    <button class="ord-qa-btn ord-qa-danger" type="button" onclick="window._ordAction('cancelar')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <strong>Cancelar pedidos</strong>
      <span>Gerenciar cancelamentos</span>
    </button>
  </div>
</div>

<!-- NEW ORDER MODAL -->
<div id="ordNewModal" class="ord-modal-overlay hidden">
  <div class="ord-modal">
    <div class="ord-modal-head">
      <h3>Novo Pedido</h3>
      <button class="ord-modal-close" id="ordModalClose" type="button">×</button>
    </div>
    <div class="ord-modal-body">
      <div class="ord-form-grid">
        <div class="ord-field">
          <label>Cliente</label>
          <input id="ordFormCustomer" type="text" placeholder="Nome do cliente" />
        </div>
        <div class="ord-field">
          <label>E-mail</label>
          <input id="ordFormEmail" type="email" placeholder="email@cliente.com" />
        </div>
        <div class="ord-field">
          <label>Canal</label>
          <select id="ordFormChannel">
            <option value="pdv">PDV</option>
            <option value="site">Site</option>
            <option value="shopee">Shopee</option>
            <option value="mercadolivre">Mercado Livre</option>
            <option value="amazon">Amazon</option>
            <option value="magalu">Magalu</option>
            <option value="ifood">iFood</option>
          </select>
        </div>
        <div class="ord-field">
          <label>Forma de pagamento</label>
          <select id="ordFormPayment">
            ${Object.entries(PAYMENT_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="ord-field">
          <label>Status</label>
          <select id="ordFormStatus">
            ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="ord-field">
          <label>Entrega</label>
          <input id="ordFormDelivery" type="text" placeholder="Ex: Correios PAC, Retirada..." />
        </div>
        <div class="ord-field ord-field-full">
          <label>Valor total (R$)</label>
          <input id="ordFormTotal" type="number" min="0" step="0.01" placeholder="0,00" />
        </div>
        <div class="ord-field ord-field-full">
          <label>Observação</label>
          <input id="ordFormObs" type="text" placeholder="Observação opcional..." />
        </div>
      </div>
    </div>
    <div class="ord-modal-foot">
      <button class="ord-modal-cancel" id="ordModalCancelBtn" type="button">Cancelar</button>
      <button class="ord-modal-save" id="ordModalSaveBtn" type="button">Salvar pedido</button>
    </div>
  </div>
</div>
  `;
}

/* ==================== RENDER ==================== */

function renderKpis(orders) {
  const kpis = computeKpis(orders);
  const total = orders.reduce((a, o) => a + (o.total || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('ordKpiTotal', kpis.total);
  set('ordKpiToday', kpis.todayCount);
  set('ordKpiRevenue', formatCurrency(kpis.todayRevenue));
  set('ordKpiTicket', formatCurrency(kpis.avgTicket));
  set('ordKpiShipping', kpis.awaitingShip);
  set('ordKpiDelivered', kpis.deliveredToday);

  const totalRevEl = document.getElementById('ordRevTotal');
  if (totalRevEl) totalRevEl.textContent = `${formatCurrency(total)} Total no período`;
}

function renderTabs(orders) {
  const counts = computeTabCounts(orders);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('ordTabTodos', counts.todos);
  set('ordTabMarketplace', counts.marketplace);
  set('ordTabSite', counts.site);
  set('ordTabPdv', counts.pdv);
  set('ordTabCancelados', counts.cancelados);
}

function renderTable(orders) {
  const tbody = document.getElementById('ordTableBody');
  if (!tbody) return;

  const filtered = getFilteredOrders(orders, _currentTab, _searchQuery, _channelFilter, _statusFilter);
  const total = filtered.length;
  const start = (_currentPage - 1) * _perPage;
  const end = Math.min(start + _perPage, total);
  const slice = filtered.slice(start, end);

  const infoEl = document.getElementById('ordPaginationInfo');
  if (infoEl) infoEl.textContent = `Exibindo ${total ? start + 1 : 0} a ${end} de ${total} pedidos`;

  if (!slice.length) {
    tbody.innerHTML = `<tr><td class="ord-empty-td" colspan="9">Nenhum pedido encontrado.</td></tr>`;
    renderPagination(total);
    return;
  }

  tbody.innerHTML = slice.map(o => {
    const logo = CHANNEL_LOGOS[o.channel] || CHANNEL_LOGOS.marketplace;
    const chName = CHANNEL_NAMES[o.channel] || _esc(o.channel);
    const _oid = _esc(String(o.id ?? ''));
    return `<tr>
      <td><span class="ord-order-num">${_esc(o.orderNumber || '—')}</span></td>
      <td class="ord-td-date">${fmtDate(o.date || o.createdAt)}</td>
      <td><div class="ord-td-ch">${logo}<span class="ord-td-chn">${chName}</span></div></td>
      <td>
        <div class="ord-td-cust">${_esc(o.customer?.name || '—')}</div>
        ${o.customer?.email ? `<div class="ord-td-ceml">${_esc(o.customer.email)}</div>` : ''}
      </td>
      <td>${statusBadge(o.status)}</td>
      <td>${paymentBadge(o.paymentMethod, o.paymentStatus)}</td>
      <td class="ord-td-val">${formatCurrency(o.total || 0)}</td>
      <td class="ord-td-del">${_esc(o.delivery || '—')}</td>
      <td>
        <div class="ord-acts-row">
          <button class="ord-action-btn" title="Ver" onclick="window._ordView('${_oid}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="ord-action-btn" title="Rastrear" onclick="window._ordTrack('${_oid}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          </button>
          <button class="ord-action-btn ord-action-menu" title="Mais" onclick="window._ordMenu(this,'${_oid}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderPagination(total);
}

function renderPagination(total) {
  const totalPages = Math.ceil(total / _perPage) || 1;
  const nums = document.getElementById('ordPageNumbers');
  if (!nums) return;

  let html = '';
  const pages = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (_currentPage > 3) pages.push('...');
    for (let i = Math.max(2, _currentPage - 1); i <= Math.min(totalPages - 1, _currentPage + 1); i++) pages.push(i);
    if (_currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  html = pages.map(p =>
    p === '...'
      ? `<span class="ord-page-ellipsis">...</span>`
      : `<button class="ord-page-num ${p === _currentPage ? 'active' : ''}" data-p="${p}" type="button">${p}</button>`
  ).join('');

  nums.innerHTML = html;

  nums.querySelectorAll('.ord-page-num').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentPage = Number(btn.dataset.p);
      renderTable(_cachedOrders);
    });
  });

  const prev = document.getElementById('ordPrevBtn');
  const next = document.getElementById('ordNextBtn');
  if (prev) prev.disabled = _currentPage <= 1;
  if (next) next.disabled = _currentPage >= totalPages;
}

function renderChannelDonut(orders) {
  const byChannel = computeByChannel(orders);
  const entries = Object.entries(byChannel).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const center = document.getElementById('ordDonutCenter');
  if (center) center.innerHTML = `${total}<br><small>Total</small>`;

  const legend = document.getElementById('ordChannelLegend');
  if (legend) {
    legend.innerHTML = entries.map(([ch, count]) => {
      const pct = total ? ((count / total) * 100).toFixed(1) : '0';
      const color = CHANNEL_COLORS[ch] || '#64748b';
      const name = CHANNEL_NAMES[ch] || _esc(ch);
      return `<div class="ord-ch-leg-row">
        <span class="ord-stat-row">
          <span class="ord-stat-dot" data-dot-color="${color}"></span>
          ${name}
        </span>
        <span class="ord-stat-cnt">${count} (${pct}%)</span>
      </div>`;
    }).join('') || '<p class="ord-no-stat">Nenhum pedido.</p>';
    legend.querySelectorAll('[data-dot-color]').forEach(d => { d.style.background = d.dataset.dotColor; });
  }

  const canvas = document.getElementById('ordChannelChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  if (!entries.length) return;

  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: entries.map(([ch]) => CHANNEL_NAMES[ch] || ch),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([ch]) => CHANNEL_COLORS[ch] || '#64748b'),
        borderWidth: 0
      }]
    },
    options: {
      cutout: '65%',
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      animation: { duration: 400 }
    }
  });
}

function renderStatusList(orders) {
  const byStatus = computeByStatus(orders);
  const el = document.getElementById('ordStatusList');
  if (!el) return;

  el.innerHTML = Object.entries(byStatus).map(([k, count]) => {
    const color = STATUS_COLORS[k] || '#94a3b8';
    const label = STATUS_LABELS[k] || k;
    return `<div class="ord-status-row">
      <span class="ord-del-leg-wrap">
        <span class="ord-stat-dot" data-dot-color="${color}"></span>
        <span class="ord-del-leg-lbl">${label}</span>
      </span>
      <span class="ord-stat-val">${count}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-dot-color]').forEach(d => { d.style.background = d.dataset.dotColor; });
}

function renderLateDeliveries(orders) {
  const late = getLateOrders(orders);
  const el = document.getElementById('ordLateList');
  if (!el) return;

  if (!late.length) {
    el.innerHTML = '<p class="ord-no-del">Nenhuma entrega em atraso.</p>';
    return;
  }

  el.innerHTML = late.map(o => {
    const color = o.daysLate >= 2 ? '#f87171' : '#fbbf24';
    return `<div class="ord-late-row">
      <div>
        <strong class="ord-del-hd">${_esc(o.orderNumber || '—')}</strong>
        <span class="ord-del-sub">Cliente: ${_esc(o.customer?.name || '—')}</span>
      </div>
      <span class="ord-del-days" data-late-color="${color}">${Number(o.daysLate)} dia${o.daysLate !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-late-color]').forEach(d => { d.style.color = d.dataset.lateColor; });
}

function renderSalesChart(orders) {
  const canvas = document.getElementById('ordSalesChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  const daily = computeDailyRevenue(orders, 7);

  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: daily.map(d => d.label),
      datasets: [{
        data: daily.map(d => d.rev),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.1)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#60a5fa',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#94a3b8', font: { size: 10 },
            callback: v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`
          }
        }
      },
      animation: { duration: 400 }
    }
  });
}

function renderPaymentChart(orders) {
  const canvas = document.getElementById('ordPaymentChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  const byMethod = computePaymentMethods(orders);
  const entries = Object.entries(byMethod).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const colors = {
    cartao_credito: '#60a5fa', pix: '#4ade80', boleto: '#a78bfa',
    cartao_debito: '#fb923c', dinheiro: '#fbbf24', outros: '#94a3b8'
  };

  const legend = document.getElementById('ordPaymentLegend');
  if (legend) {
    legend.innerHTML = entries.map(([k, v]) => {
      const pct = total ? ((v / total) * 100).toFixed(1) : '0';
      return `<div class="ord-pay-leg-row">
        <span class="ord-pay-leg">
          <span class="ord-pay-dot" data-dot-color="${colors[k] || '#64748b'}"></span>
          <span class="ord-pay-lbl">${PAYMENT_LABELS[k] || k}</span>
        </span>
        <span class="ord-pay-pct">${pct}%</span>
      </div>`;
    }).join('') || '';
    legend.querySelectorAll('[data-dot-color]').forEach(d => { d.style.background = d.dataset.dotColor; });
  }

  if (!entries.length) return;

  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => PAYMENT_LABELS[k] || k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => colors[k] || '#64748b'),
        borderWidth: 0
      }]
    },
    options: {
      cutout: '60%',
      plugins: { legend: { display: false } },
      animation: { duration: 400 }
    }
  });
}

function renderGaugeChart(orders) {
  const canvas = document.getElementById('ordGaugeChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  const perf = computeDeliveryPerf(orders);
  const label = document.getElementById('ordGaugeLabel');
  if (label) label.innerHTML = `${perf.rate}%<br><small>No prazo</small>`;

  const legend = document.getElementById('ordDeliveryLegend');
  if (legend) {
    legend.innerHTML = `
      <div class="ord-del-leg-row"><span><span class="ord-del-dot ord-del-dot-g"></span>No prazo</span><span class="ord-del-muted">${perf.rate}% (${perf.onTime})</span></div>
      <div class="ord-del-leg-row"><span><span class="ord-del-dot ord-del-dot-r"></span>Atrasadas</span><span class="ord-del-muted">${100-perf.rate}% (${perf.late})</span></div>
      <div class="ord-del-leg-row"><span><span class="ord-del-dot ord-del-dot-y"></span>Pendentes</span><span class="ord-del-muted">${perf.pending}</span></div>
    `;
  }

  canvas._chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [perf.rate, 100 - perf.rate],
        backgroundColor: ['#4ade80', '#1e293b'],
        borderWidth: 0
      }]
    },
    options: {
      circumference: 180,
      rotation: -90,
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 400 }
    }
  });
}

/* ==================== CACHED ORDERS ==================== */

let _cachedOrders = [];

function refreshAllOrderViews() {
  _cachedOrders = getAllOrders();
  renderKpis(_cachedOrders);
  renderTabs(_cachedOrders);
  renderTable(_cachedOrders);
  renderChannelDonut(_cachedOrders);
  renderStatusList(_cachedOrders);
  renderLateDeliveries(_cachedOrders);
  renderSalesChart(_cachedOrders);
  renderPaymentChart(_cachedOrders);
  renderGaugeChart(_cachedOrders);
}

/* ==================== NEW ORDER MODAL ==================== */

function openNewOrderModal() {
  document.getElementById('ordNewModal')?.classList.remove('hidden');
}

function closeNewOrderModal() {
  document.getElementById('ordNewModal')?.classList.add('hidden');
  document.getElementById('ordFormCustomer').value = '';
  document.getElementById('ordFormEmail').value = '';
  document.getElementById('ordFormTotal').value = '';
  document.getElementById('ordFormObs').value = '';
  document.getElementById('ordFormDelivery').value = '';
}

function saveNewOrder() {
  const customer = (document.getElementById('ordFormCustomer')?.value || '').trim();
  const email = (document.getElementById('ordFormEmail')?.value || '').trim();
  const channel = document.getElementById('ordFormChannel')?.value || 'pdv';
  const paymentMethod = document.getElementById('ordFormPayment')?.value || 'dinheiro';
  const status = document.getElementById('ordFormStatus')?.value || 'confirmado';
  const delivery = (document.getElementById('ordFormDelivery')?.value || '').trim();
  const total = parseFloat(document.getElementById('ordFormTotal')?.value || '0') || 0;

  if (!customer) { alert('Informe o nome do cliente.'); return; }

  const id = 'ORD' + Date.now();
  const now = new Date().toISOString();
  const stored = loadStoredOrders();
  const allNums = _cachedOrders.map(o => parseInt((o.orderNumber || '').replace('#','')) || 0);
  const nextNum = (Math.max(0, ...allNums) + 1);

  stored.push({
    id,
    orderNumber: '#' + String(nextNum).padStart(5, '0'),
    date: now,
    channel,
    platformId: null,
    customer: { name: customer, email },
    items: [],
    total,
    status,
    paymentMethod,
    paymentStatus: status === 'cancelado' || status === 'estornado' ? 'estornado' : status === 'aguardando_pagamento' ? 'pendente' : 'pago',
    delivery: delivery || 'A definir',
    tracking: '',
    createdAt: now
  });

  saveStoredOrders(stored);
  closeNewOrderModal();
  refreshAllOrderViews();
}

/* ==================== BIND ==================== */

export function bindOrdersActions() {
  const section = document.querySelector('[data-page-content="pedidos"]');
  if (!section || section.dataset.ordersBound) return;
  section.dataset.ordersBound = '1';

  document.getElementById('ordNewBtn')?.addEventListener('click', openNewOrderModal);
  document.getElementById('ordModalClose')?.addEventListener('click', closeNewOrderModal);
  document.getElementById('ordModalCancelBtn')?.addEventListener('click', closeNewOrderModal);
  document.getElementById('ordModalSaveBtn')?.addEventListener('click', saveNewOrder);

  document.getElementById('ordNewModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('ordNewModal')) closeNewOrderModal();
  });

  document.getElementById('ordTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    document.querySelectorAll('.ord-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    _currentTab = btn.dataset.tab;
    _currentPage = 1;
    renderTable(_cachedOrders);
  });

  document.getElementById('ordSearch')?.addEventListener('input', e => {
    _searchQuery = e.target.value;
    _currentPage = 1;
    renderTable(_cachedOrders);
  });

  document.getElementById('ordChannelFilter')?.addEventListener('change', e => {
    _channelFilter = e.target.value;
    _currentPage = 1;
    renderTable(_cachedOrders);
  });

  document.getElementById('ordStatusFilter')?.addEventListener('change', e => {
    _statusFilter = e.target.value;
    _currentPage = 1;
    renderTable(_cachedOrders);
  });

  document.getElementById('ordPrevBtn')?.addEventListener('click', () => {
    if (_currentPage > 1) { _currentPage--; renderTable(_cachedOrders); }
  });

  document.getElementById('ordNextBtn')?.addEventListener('click', () => {
    const total = getFilteredOrders(_cachedOrders, _currentTab, _searchQuery, _channelFilter, _statusFilter).length;
    const totalPages = Math.ceil(total / _perPage);
    if (_currentPage < totalPages) { _currentPage++; renderTable(_cachedOrders); }
  });

  document.getElementById('ordPerPage')?.addEventListener('change', e => {
    _perPage = Number(e.target.value) || 8;
    _currentPage = 1;
    renderTable(_cachedOrders);
  });

  document.getElementById('ordExportBtn')?.addEventListener('click', () => {
    const filtered = getFilteredOrders(_cachedOrders, _currentTab, _searchQuery, _channelFilter, _statusFilter);
    const rows = [['Pedido','Data','Canal','Cliente','Status','Pagamento','Valor','Entrega']];
    filtered.forEach(o => rows.push([
      o.orderNumber, fmtDate(o.date||o.createdAt), CHANNEL_NAMES[o.channel]||o.channel,
      o.customer?.name||'', STATUS_LABELS[o.status]||o.status,
      PAYMENT_LABELS[o.paymentMethod]||o.paymentMethod,
      formatCurrency(o.total||0), o.delivery||''
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pedidos.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  window._ordView = (id) => {
    const order = _cachedOrders.find(o => o.id === id);
    if (!order) return;
    alert(`Pedido: ${order.orderNumber}\nCliente: ${order.customer?.name}\nTotal: ${formatCurrency(order.total)}\nStatus: ${STATUS_LABELS[order.status]||order.status}\nCanal: ${CHANNEL_NAMES[order.channel]||order.channel}`);
  };

  window._ordTrack = (id) => {
    const order = _cachedOrders.find(o => o.id === id);
    if (!order) return;
    const tracking = order.tracking || 'Sem código de rastreamento.';
    alert(`Rastreamento\nPedido: ${order.orderNumber}\nCódigo: ${tracking}`);
  };

  window._ordMenu = (btn, id) => {
    document.getElementById('_ordCtxMenu')?.remove();
    const menu = document.createElement('div');
    menu.id = '_ordCtxMenu';
    menu.className = 'ctx-drop-menu';
    const r = btn.getBoundingClientRect();
    menu.style.setProperty('--ctx-top',  (r.bottom + 4) + 'px');
    menu.style.setProperty('--ctx-left', (r.left - 120) + 'px');
    const _mid = _esc(String(id ?? ''));

    const mkBtn = (label, cls, action) => {
      const b = document.createElement('button');
      b.className = cls;
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { action(); menu.remove(); });
      return b;
    };

    menu.appendChild(mkBtn('Ver detalhes',  'ctx-drop-item',          () => window._ordView(_mid)));
    menu.appendChild(mkBtn('Alterar status','ctx-drop-item',          () => window._ordChangeStatus(_mid)));
    menu.appendChild(mkBtn('Remover pedido','ctx-drop-item ctx-drop-item--danger', () => window._ordDeleteOrder(_mid)));

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  };

  window._ordChangeStatus = (id) => {
    const opts = Object.entries(STATUS_LABELS).map(([k, v]) => `${k}: ${v}`).join('\n');
    const input = prompt(`Novo status para ${id}:\n\n${opts}\n\nDigite a chave:`);
    if (!input || !STATUS_LABELS[input.trim()]) return;
    const stored = loadStoredOrders();
    const existing = stored.find(o => o.id === id);
    if (existing) {
      existing.status = input.trim();
      saveStoredOrders(stored);
    } else {
      const order = _cachedOrders.find(o => o.id === id);
      if (!order) return;
      stored.push({ ...order, status: input.trim(), _fromSale: false, _fromMk: false });
      saveStoredOrders(stored);
    }
    refreshAllOrderViews();
  };

  window._ordDeleteOrder = (id) => {
    if (!confirm('Remover este pedido?')) return;
    const stored = loadStoredOrders().filter(o => o.id !== id);
    saveStoredOrders(stored);
    refreshAllOrderViews();
  };

  window._ordAction = (action) => {
    const msgs = {
      etiquetas: 'Função de impressão de etiquetas em breve.',
      romaneio: 'Função de romaneio em breve.',
      mensagem: 'Função de envio de mensagem em breve.',
      exportar: 'Use o botão "Exportar" na tabela para exportar CSV.',
      cancelar: 'Selecione um pedido na tabela e use "Alterar status" para cancelar.'
    };
    alert(msgs[action] || '');
  };
}

/* ==================== INIT / RENDER (exported) ==================== */

export function initOrders() {
  if (_ordersInitialized) return;
  _ordersInitialized = true;
  injectOrdersHTML();
  bindOrdersActions();
}

export function renderOrders() {
  injectOrdersHTML();
  bindOrdersActions();
  refreshAllOrderViews();
}
