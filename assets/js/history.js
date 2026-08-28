import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { formatCurrency, formatDateTimeBR } from './utils.js';
import { loadSales } from './services/sales-service.js';

function _esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const _PM_LABELS = {
  cash: 'Dinheiro', card: 'Cartão', pix: 'Pix',
  credit: 'Crédito', debit: 'Débito', voucher: 'Voucher',
  mixed: 'Misto', other: 'A prazo'
};

// Padrão '30days': vendas recentes sempre visíveis sem filtrar para "só hoje"
let _currentPeriod = '30days';
let _backendSales = [];

function _periodStart(period) {
  const now = new Date();
  if (period === 'today')   return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === '7days')   return new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  if (period === '30days')  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return null; // 'all'
}

function _pmLabel(pm) {
  return _PM_LABELS[String(pm || '').toLowerCase()] || pm || '';
}

function _salesAsHistoryItems(sales) {
  return sales.map(sale => {
    const cancelled = sale.status === 'cancelled' || Boolean(sale.isCancelled);
    const itemCount = Array.isArray(sale.items) ? sale.items.length : 0;
    const operator  = sale.operatorName || sale.user?.name || null;
    const pm        = _pmLabel(sale.paymentMethod);
    const parts     = [`${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`];
    if (pm)       parts.push(pm);
    if (operator) parts.push(operator);
    if (cancelled && sale.cancelReason) parts.push(`(${sale.cancelReason})`);
    return {
      id:          String(sale.id),
      createdAt:   sale.createdAt,
      type:        cancelled ? 'Cancelamento' : 'Venda',
      description: parts.join(' – '),
      // normalizeSaleFromApi retorna 'total'; raw API pode ter 'totalAmount'
      amount:      cancelled ? 0 : Number(sale.totalAmount ?? sale.total ?? 0)
    };
  });
}

function _filterByPeriod(items, period) {
  const start = _periodStart(period);
  if (!start) return items;
  return items.filter(item => new Date(item.createdAt) >= start);
}

function _mergeAndSort(salesItems, localItems) {
  const ids = new Set(salesItems.map(s => s.id));
  const uniqueLocal = localItems.filter(l => !ids.has(String(l.id)));
  return [...salesItems, ...uniqueLocal].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

async function _fetchSalesFromBackend() {
  try {
    // loadSales() já cuida de isBackendReady(), normalização, cache e fallback local
    const sales = await loadSales();
    return Array.isArray(sales) ? _salesAsHistoryItems(sales) : [];
  } catch {
    return [];
  }
}

function _bindHistoryFilters() {
  const strip = document.getElementById('histFilterStrip');
  if (!strip || strip.dataset.bound) return;
  strip.dataset.bound = '1';
  strip.addEventListener('click', e => {
    const btn = e.target.closest('[data-hist-period]');
    if (!btn) return;
    strip.querySelectorAll('.finance-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _currentPeriod = btn.dataset.histPeriod;
    renderHistory();
  });
}

export async function loadHistoryPage() {
  _backendSales = await _fetchSalesFromBackend();
  renderHistory();
}

export async function initHistory() {
  state.history = load(KEYS.history, []);
  _backendSales = await _fetchSalesFromBackend();
  _bindHistoryFilters();
  renderHistory();
}

export function addHistory(type, description, amount = 0) {
  state.history.unshift({
    id: Date.now() + Math.random(),
    createdAt: new Date().toISOString(),
    type,
    description,
    amount: Number(amount || 0)
  });
  state.history = state.history.slice(0, 300);
  save(KEYS.history, state.history);
  renderHistory();
}

export function renderHistory() {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;
  const merged   = _mergeAndSort(_backendSales, state.history);
  const filtered = _filterByPeriod(merged, _currentPeriod);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Nenhuma movimentação registrada.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(item => `
    <tr>
      <td>${formatDateTimeBR(item.createdAt)}</td>
      <td>${_esc(item.type)}</td>
      <td>${_esc(item.description)}</td>
      <td>${formatCurrency(item.amount)}</td>
    </tr>`).join('');
}
