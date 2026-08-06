import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { persistProducts, renderProducts, updateProductMetrics } from './products.js';
import { addHistory } from './history.js';
import { formatCurrency, formatDateTimeBR, toNumber } from './utils.js';
import { renderFinance } from './finance.js';
import { renderReports } from './reports.js';

export function initMarketplace() {
  state.marketplace = load(KEYS.marketplace, { channels: [], onlineOrders: [] });
  state.marketplace.channels ||= [];
  state.marketplace.onlineOrders ||= [];
  renderMarketplace();
}

function persist() { save(KEYS.marketplace, state.marketplace); }

export function addChannel() {
  const name = String(document.getElementById('marketplaceChannelName')?.value || '').trim();
  if (!name) return alert('Informe o nome do canal.');
  state.marketplace.channels.push({ id: Date.now(), name, connectedAt: new Date().toISOString() });
  persist();
  renderMarketplace();
  document.getElementById('marketplaceChannelName').value='';
}

export function simulateOnlineSale() {
  const channelId = Number(document.getElementById('marketplaceChannelSelect')?.value || 0);
  const code = String(document.getElementById('marketplaceProductCode')?.value || '').trim();
  const quantity = toNumber(document.getElementById('marketplaceQuantity')?.value, 1);
  const product = state.products.find(p => String(p.code) === code);
  if (!channelId || !product) return alert('Selecione um canal e informe um código de produto válido.');
  if ((product.stock || 0) < quantity) return alert('Estoque insuficiente para a venda online.');
  product.stock = Number(product.stock || 0) - quantity;
  const channel = state.marketplace.channels.find(c => c.id === channelId);
  const order = { id: Date.now(), channelId, channelName: channel?.name || 'Canal', productCode: product.code, productName: product.name, quantity, total: Number(product.price || 0) * quantity, createdAt: new Date().toISOString() };
  state.marketplace.onlineOrders.unshift(order);
  persist();
  persistProducts();
  renderProducts();
  updateProductMetrics();
  addHistory('Marketplace', `Venda online em ${order.channelName}: ${order.productName} x${quantity}`, order.total);
  renderFinance();
  renderReports();
  renderMarketplace();
}

export function renderMarketplace() {
  const list = document.getElementById('marketplaceChannelsList');
  const select = document.getElementById('marketplaceChannelSelect');
  const tbody = document.getElementById('marketplaceOrdersTableBody');
  if (list) {
    list.innerHTML = state.marketplace.channels.length ? state.marketplace.channels.map(c => `<li><strong>${c.name}</strong> • ${formatDateTimeBR(c.connectedAt)}</li>`).join('') : '<li>Nenhum canal vinculado.</li>';
  }
  if (select) {
    select.innerHTML = '<option value="">Selecione</option>' + state.marketplace.channels.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  if (tbody) {
    tbody.innerHTML = state.marketplace.onlineOrders.length ? state.marketplace.onlineOrders.slice(0,20).map(o => `
      <tr><td>${formatDateTimeBR(o.createdAt)}</td><td>${o.channelName}</td><td>${o.productName}</td><td>${o.quantity}</td><td>${formatCurrency(o.total)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Nenhum pedido online.</td></tr>';
  }
}

export function bindMarketplaceActions() {
  document.getElementById('addMarketplaceChannelBtn')?.addEventListener('click', addChannel);
  document.getElementById('simulateMarketplaceSaleBtn')?.addEventListener('click', simulateOnlineSale);
}
