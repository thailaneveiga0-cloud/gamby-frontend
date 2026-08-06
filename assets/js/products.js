import { state } from './state.js';
import { KEYS, save } from './storage.js';
import { can } from './roles.js';
import { formatCurrency, normalizeString, toNumber } from './utils.js';
import { addHistory } from './history.js';
import { loadProductsSource, saveProductsSource, fetchDefaultProducts, createProductService, deleteProductService, updateProductService } from './services/product-service.js';

export async function initProducts() {
  const persisted = await loadProductsSource();
  if (Array.isArray(persisted) && persisted.length) {
    state.products = persisted;
  } else {
    await restoreDefaultProducts(false);
  }
  renderProducts();
  updateProductMetrics();
  renderLowStock();
  renderRemoveSelector();
}

export async function persistProducts() {
  save(KEYS.products, state.products);
  await saveProductsSource(state.products);
  updateProductMetrics();
  renderLowStock();
  renderRemoveSelector();
}

export async function addProduct() {
  if (!can(state.currentUser?.role, 'backup')) return alert('Sem permissão para cadastrar produtos.');
  const product = {
    name: normalizeString(document.getElementById('productName')?.value),
    code: normalizeString(document.getElementById('productCode')?.value),
    category: normalizeString(document.getElementById('productCategory')?.value),
    price: toNumber(document.getElementById('productPrice')?.value),
    stock: toNumber(document.getElementById('productStock')?.value),
    minStock: toNumber(document.getElementById('productMinStock')?.value, 1)
  };
  if (!product.name || !product.code) return alert('Preencha pelo menos nome e código do produto.');
  if (state.products.some((item) => item.code === product.code)) return alert('Já existe um produto com esse código.');
  const created = await createProductService(product);
  state.products.push(created || product);
  await persistProducts();
  renderProducts();
  clearProductForm();
  addHistory('Estoque', `Produto cadastrado: ${product.name}`, product.price * product.stock);
}

export function clearProductForm() {
  ['productName', 'productCode', 'productCategory', 'productPrice', 'productStock', 'productMinStock'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });
}

export async function removeProduct(index) {
  if (!can(state.currentUser?.role, 'backup')) return alert('Sem permissão para remover produtos.');
  const removed = state.products[index];
  await deleteProductService(removed);
  state.products.splice(index, 1);
  await persistProducts();
  renderProducts();
  addHistory('Estoque', `Produto removido: ${removed?.name || 'Item'}`, 0);
}

export function removeProductByCode() {
  if (!can(state.currentUser?.role, 'backup')) return alert('Sem permissão para remover produtos.');
  const code = document.getElementById('removeProductSelect')?.value;
  const index = state.products.findIndex((p) => p.code === code);
  if (index < 0) return alert('Selecione um produto para remover.');
  removeProduct(index);
}

export async function adjustStock(code, delta) {
  if (!can(state.currentUser?.role, 'backup')) return alert('Sem permissão para ajustar estoque.');
  const product = state.products.find((p) => p.code === code);
  if (!product) return;
  product.stock = Math.max(0, Number(product.stock || 0) + Number(delta || 0));
  const updated = await updateProductService(product);
  if (updated?.id) Object.assign(product, updated);
  await persistProducts();
  renderProducts();
  addHistory('Estoque', `${delta > 0 ? 'Entrada' : 'Saída'} manual de estoque: ${product.name}`, 0);
}

export async function restoreDefaultProducts(confirmAction = true) {
  if (confirmAction && !can(state.currentUser?.role, 'backup')) return alert('Sem permissão para restaurar produtos padrão.');
  if (confirmAction && !window.confirm('Restaurar os produtos padrão do sistema? Isso substituirá a lista atual.')) return;
  const defaults = await fetchDefaultProducts();
  state.products = defaults;
  await persistProducts();
  renderProducts();
  addHistory('Sistema', 'Produtos padrão restaurados', 0);
}

export function renderProducts() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.products.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Nenhum produto cadastrado.</td></tr>';
    return;
  }
  state.products.forEach((product, index) => {
    const low = Number(product.stock ?? 0) <= Number(product.minStock ?? 1);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${product.name}${low ? ' <span class="tag tag-warning">Estoque baixo</span>' : ''}</td>
      <td>${product.code}</td>
      <td>${product.category || '-'}</td>
      <td>${formatCurrency(product.price)}</td>
      <td>${product.stock ?? 0}</td>
      <td class="product-manage-only"><div class="hero-actions compact"><button class="btn btn-ghost btn-sm stock-minus" data-code="${product.code}">-1</button><button class="btn btn-ghost btn-sm stock-plus" data-code="${product.code}">+1</button><button class="btn btn-ghost btn-sm product-remove" data-index="${index}">Excluir</button></div></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.product-remove').forEach((btn) => btn.addEventListener('click', () => removeProduct(Number(btn.dataset.index))));
  tbody.querySelectorAll('.stock-plus').forEach((btn) => btn.addEventListener('click', () => adjustStock(btn.dataset.code, 1)));
  tbody.querySelectorAll('.stock-minus').forEach((btn) => btn.addEventListener('click', () => adjustStock(btn.dataset.code, -1)));
}

export function renderLowStock() {
  const tbody = document.getElementById('lowStockTableBody');
  if (!tbody) return;
  const lowItems = state.products.filter(p => Number(p.stock ?? 0) <= Number(p.minStock ?? 1));
  tbody.innerHTML = lowItems.length ? lowItems.map(p => `<tr><td>${p.name}</td><td>${p.stock ?? 0}</td><td>${p.minStock ?? 1}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">Nenhum item com estoque baixo.</td></tr>';
}

export function renderRemoveSelector() {
  const select = document.getElementById('removeProductSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Selecione um produto</option>' + state.products.map(p => `<option value="${p.code}">${p.name} (${p.code})</option>`).join('');
}

export function updateProductMetrics() {
  const count = state.products.length;
  const totalItems = state.products.reduce((acc, item) => acc + Number(item.stock || 0), 0);
  const productsMetric = document.getElementById('metricProducts');
  const itemsMetric = document.getElementById('metricStockItems');
  if (productsMetric) productsMetric.textContent = String(count);
  if (itemsMetric) itemsMetric.textContent = String(totalItems);
}

export function bindProductActions() {
  document.getElementById('saveProductBtn')?.addEventListener('click', () => addProduct());
  document.getElementById('clearProductBtn')?.addEventListener('click', clearProductForm);
  document.getElementById('restoreDefaultsBtn')?.addEventListener('click', () => restoreDefaultProducts(true));
  document.getElementById('removeProductBySelectBtn')?.addEventListener('click', removeProductByCode);
}

export function applyProductPermissions(role) {
  const canBackup = can(role, 'backup');
  document.querySelectorAll('.backup-only').forEach((el) => el.classList.toggle('hidden', !canBackup));
  document.querySelectorAll('.product-manage-only').forEach((el) => el.classList.toggle('hidden', !canBackup));
}
