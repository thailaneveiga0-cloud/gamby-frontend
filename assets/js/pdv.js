import { can } from './roles.js';
import { state } from './state.js';
import { KEYS, save } from './storage.js';
import { renderProducts, persistProducts, initProducts } from './products.js';
import { renderFinance, fmt } from './finance.js';
import { renderReports } from './reports.js';
import { addHistory } from './history.js';
import { createSaleService, loadSales, cancelSaleService, persistSales } from './services/sales-service.js';

let cart = [];

function findProductByCode(code) {
  return state.products.find((p) => String(p.code).toLowerCase() === String(code).toLowerCase());
}

function cartTotal() {
  return cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
}

function renderRecentSales() {
  const tbody = document.getElementById('recentSalesTableBody');
  if (!tbody) return;
  const sales = state.sales.slice(0, 20);
  tbody.innerHTML = sales.length ? sales.map((sale) => `
    <tr>
      <td>${new Date(sale.createdAt).toLocaleString('pt-BR')}</td>
      <td>${sale.itemsCount}</td>
      <td>${sale.paymentMethod}</td>
      <td>${fmt(sale.total)}</td>
      <td>${sale.cancelled ? '<span class="tag tag-danger">Cancelada</span>' : '<button class="btn btn-ghost btn-sm cancel-sale" data-id="'+sale.id+'">Cancelar</button>'}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">Nenhuma venda registrada.</td></tr>';
  tbody.querySelectorAll('.cancel-sale').forEach(btn => btn.addEventListener('click', ()=>cancelSale(btn.dataset.id)));
}

function renderCart() {
  const tbody = document.getElementById('cartTableBody');
  const totalBox = document.getElementById('pdvTotal');
  if (!tbody || !totalBox) return;
  tbody.innerHTML = '';
  if (!cart.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Nenhum item na venda.</td></tr>';
  } else {
    cart.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name}</td>
        <td>${fmt(item.price)}</td>
        <td>${item.quantity}</td>
        <td>${fmt(item.price * item.quantity)}</td>
        <td><button class="btn btn-ghost btn-sm remove-cart-item" data-index="${index}">Remover</button></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.remove-cart-item').forEach((btn) => btn.addEventListener('click', () => removeCartItem(Number(btn.dataset.index))));
  }
  totalBox.textContent = fmt(cartTotal());
}

function removeCartItem(index) {
  cart.splice(index, 1);
  renderCart();
  updateChangePreview();
}

function updateChangePreview() {
  const paid = parseFloat(document.getElementById('amountPaid')?.value || '0');
  const change = Math.max(0, paid - cartTotal());
  const changeBox = document.getElementById('changePreview');
  if (changeBox) changeBox.textContent = fmt(change);
}

export async function initSales() {
  state.sales = await loadSales();
  renderCart();
  renderRecentSales();
}

export function addItemToCart() {
  if (!state.cashSession?.isOpen) return alert('Abra o caixa antes de iniciar uma venda.');
  const code = document.getElementById('saleProductCode')?.value.trim();
  const qty = parseInt(document.getElementById('saleQuantity')?.value || '1', 10);
  if (!code) return alert('Informe o código do produto.');
  const product = findProductByCode(code);
  if (!product) return alert('Produto não encontrado.');
  if (qty <= 0) return alert('Quantidade inválida.');
  if (Number(product.stock || 0) < qty) return alert('Estoque insuficiente para este produto.');
  const existing = cart.find((item) => item.code === product.code);
  if (existing) {
    if (Number(product.stock || 0) < existing.quantity + qty) return alert('Estoque insuficiente para aumentar a quantidade.');
    existing.quantity += qty;
  } else {
    cart.push({ code: product.code, productId: product.id, name: product.name, price: Number(product.price || 0), quantity: qty });
  }
  document.getElementById('saleProductCode').value = '';
  document.getElementById('saleQuantity').value = '1';
  renderCart();
  updateChangePreview();
}

export async function finalizeSale() {
  if (!state.cashSession?.isOpen) return alert('Abra o caixa antes de finalizar uma venda.');
  if (!cart.length) return alert('Adicione itens à venda antes de finalizar.');
  const paymentMethod = document.getElementById('salePaymentMethod')?.value || 'Dinheiro';
  const total = cartTotal();
  const amountPaid = parseFloat(document.getElementById('amountPaid')?.value || String(total));
  if (paymentMethod === 'Dinheiro' && amountPaid < total) return alert('Valor pago insuficiente.');

  for (const item of cart) {
    const product = state.products.find((p) => p.code === item.code);
    if (!product || Number(product.stock || 0) < Number(item.quantity || 0)) {
      return alert(`Estoque insuficiente para ${item.name}. Atualize a venda e tente novamente.`);
    }
  }

  let sale;
  try {
    sale = await createSaleService({
      cashSessionId: state.cashSession.id || undefined,
      items: cart.map((item) => ({ productId: item.productId || item.id, quantity: item.quantity, unitPrice: item.price })),
      paymentMethod,
      amountReceived: amountPaid,
      notes: 'Venda balcão'
    });
  } catch (error) {
    // fallback local
  }

  if (sale) {
    state.sales.unshift(sale);
    await persistSales(state.sales);
    await initProducts();
  } else {
    cart.forEach((item) => {
      const product = state.products.find((p) => p.code === item.code);
      if (product) product.stock = Number(product.stock || 0) - Number(item.quantity || 0);
    });

    sale = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      items: cart.map((item) => ({ ...item })),
      itemsCount: cart.reduce((acc, item) => acc + item.quantity, 0),
      paymentMethod,
      total,
      amountPaid,
      change: Math.max(0, amountPaid - total),
      cancelled: false
    };
    state.sales.unshift(sale);
    save(KEYS.sales, state.sales);
    await persistProducts();
    renderProducts();
  }

  cart = [];
  document.getElementById('amountPaid').value = '';
  renderCart();
  renderRecentSales();
  addHistory('Venda', `Venda finalizada (${paymentMethod})`, total);
  renderFinance();
  renderReports();
  alert('Venda finalizada com sucesso.');
}

export async function cancelSale(id) {
  if (!can(state.currentUser?.role, 'financial')) return alert('Sem permissão para cancelar venda.');
  const sale = state.sales.find(s => String(s.id) === String(id));
  if (!sale || sale.cancelled) return;
  if (!window.confirm('Cancelar esta venda e devolver os itens ao estoque?')) return;

  try { await cancelSaleService(id); } catch { /* fallback local */ }

  sale.cancelled = true;
  sale.cancelledAt = new Date().toISOString();
  sale.items.forEach(item => {
    const product = state.products.find(p => p.code === item.code || p.id === item.productId);
    if (product) product.stock = Number(product.stock || 0) + Number(item.quantity || 0);
  });
  save(KEYS.sales, state.sales);
  await persistProducts();
  renderProducts();
  renderRecentSales();
  addHistory('Cancelamento de venda', `Venda ${id} cancelada`, -Number(sale.total || 0));
  renderFinance();
  renderReports();
}

export function bindPDVActions() {
  document.getElementById('addToCartBtn')?.addEventListener('click', addItemToCart);
  document.getElementById('finalizeSaleBtn')?.addEventListener('click', () => finalizeSale());
  document.getElementById('amountPaid')?.addEventListener('input', updateChangePreview);
}
