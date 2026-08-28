import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { can } from './roles.js';
import { formatCurrency, formatDateBR, normalizeString, toNumber } from './utils.js';
import { addHistory } from './history.js';
import { isBackendReady } from './backend-config.js';
import {
  loadProductsSource,
  saveProductsSource,
  createProductService,
  deleteProductService,
  updateProductService
} from './services/product-service.js';
import {
  createProductBatchService,
  consumeProductBatchService,
  getExpiryReportService,
  performBatchActionService,
  listProductBatchesService,
  verifyProductBatchesService
} from './services/product-batch-service.js';
import {
  getAlertSummaryService,
  listAlertsService,
  checkAlertsNowService,
  resolveAlertService,
} from './services/inventory-alerts-service.js';

let editingProductCode = null;
let _pendingImageData = '';

/* ================= SECURITY HELPERS ================= */

function _esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function _safeImageUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (!['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/* ================= UX HELPERS ================= */

function showToast(message, type = 'success') {
  if (!message) return;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* ================= CORE ================= */

function getScopedProductsKey() {
  const companyId = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${KEYS.products}_${companyId}`;
}

function _getImgKey(code) {
  const companyId = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `gamby_pimg_${companyId}_${code}`;
}

function _saveImgToStorage(code, imageUrl) {
  if (!code) return;
  const key = _getImgKey(code);
  if (!imageUrl) { localStorage.removeItem(key); return; }
  try { localStorage.setItem(key, imageUrl); }
  catch (e) { console.warn('[Img] Quota exceeded for product image:', code); }
}

function _loadImgFromStorage(code) {
  if (!code) return '';
  try { return localStorage.getItem(_getImgKey(code)) || ''; }
  catch { return ''; }
}

function normalizeProduct(product) {
  return {
    ...product,
    name: normalizeString(product?.name),
    code: normalizeString(product?.code),
    barcode: normalizeString(product?.barcode),
    category: normalizeString(product?.category),
    unit: String(product?.unit || 'un').trim(),
    minStock: Number(product?.minStock ?? 5),
    stock: Number(product?.stock ?? 0),
    price: Number(product?.price ?? product?.salePrice ?? 0),
    createdAt: product?.createdAt || new Date().toISOString(),
    cost: Number(product?.cost ?? product?.costPrice ?? 0),
    active: product?.active !== false,
    promotional: Boolean(product?.promotional),
    isPerishable: Boolean(product?.isPerishable),
    imageUrl: product?.imageUrl || product?.imageData || ''
  };
}

function dedupeProducts(products = []) {
  const map = new Map();

  for (const raw of products) {
    const product = normalizeProduct(raw);
    const key =
      normalizeString(product.code) ||
      normalizeString(product.barcode) ||
      normalizeString(product.name);

    if (!key) continue;

    map.set(key, product);
  }

  return Array.from(map.values());
}

function setProducts(products = []) {
  state.products = dedupeProducts(products);
}

function loadScopedProductsCache() {
  const products = load(getScopedProductsKey(), []);
  return products.map(p => ({ ...p, imageUrl: p.imageUrl || _loadImgFromStorage(p.code) }));
}

function saveScopedProductsCache(products) {
  products.forEach(p => _saveImgToStorage(p.code, p.imageUrl));
  const stripped = products.map(p => ({ ...p, imageUrl: '' }));
  save(getScopedProductsKey(), dedupeProducts(stripped));
}

function calculateGrandTotal() {
  return (state.products || []).reduce((acc, product) => {
    const stock = Number(product.stock ?? 0);
    const price = Number(product.price ?? 0);
    return acc + stock * price;
  }, 0);
}

function updateGrandTotal() {
  const totalEl = document.getElementById('stockGrandTotal');
  if (!totalEl) return;

  totalEl.textContent = formatCurrency(calculateGrandTotal());
}

function refreshAllProductViews() {
  renderProducts();
  renderStockTable();
  updateProductMetrics();
  renderLowStock();
  renderRemoveSelector();
  renderRemoveProductsChecklist();
  updateGrandTotal();
}

function canManageProducts() {
  return can('productManage', state.currentUser?.role);
}

/* ================= INIT ================= */

export async function initProducts() {
  try {
    if (isBackendReady()) {
      const persisted = await loadProductsSource();
      // Merge images stored in localStorage so they survive backend sync cycles
      const withImages = (persisted || []).map((p) => ({
        ...p,
        imageUrl: p.imageUrl || _loadImgFromStorage(p.code) || ''
      }));
      setProducts(withImages);
      saveScopedProductsCache(state.products);
    } else {
      const cache = loadScopedProductsCache();
      setProducts(cache || []);
    }
  } catch (error) {
    console.warn('Erro ao carregar produtos:', error);

    const cache = loadScopedProductsCache();
    setProducts(cache || []);
  }

  refreshAllProductViews();
}

/* ================= SAVE ================= */

export async function persistProducts() {
  state.products = dedupeProducts(state.products);
  saveScopedProductsCache(state.products);

  try {
    await saveProductsSource(state.products);
  } catch (error) {
    console.warn('Erro ao salvar no backend:', error);
  }

  refreshAllProductViews();
}

/* ================= FORM ================= */

function getProductFormData() {
  return {
    name: normalizeString(document.getElementById('productName')?.value),
    code: normalizeString(document.getElementById('productCode')?.value),
    barcode: normalizeString(document.getElementById('productBarcode')?.value),
    category: normalizeString(document.getElementById('productCategory')?.value),
    unit: document.getElementById('productUnit')?.value || 'un',
    saleType: document.getElementById('productSaleType')?.value || 'unit',
    pricePerKg: toNumber(document.getElementById('productPricePerKg')?.value),
    allowFractional: document.getElementById('productAllowFractional')?.checked !== false,
    price: toNumber(document.getElementById('productPrice')?.value),
    cost: toNumber(document.getElementById('productCost')?.value),
    stock: toNumber(document.getElementById('productStock')?.value),
    minStock: toNumber(document.getElementById('productMinStock')?.value, 1),
    active: document.getElementById('productActive')?.checked !== false,
    promotional: Boolean(document.getElementById('productPromotional')?.checked),
    isPerishable: Boolean(document.getElementById('productIsPerishable')?.checked),
    imageUrl: _pendingImageData || ''
  };
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function startProductEdit(code) {
  const product = state.products.find((p) => p.code === code);
  if (!product) return;

  editingProductCode = code;

  setFieldValue('productName', product.name);
  setFieldValue('productCode', product.code);
  setFieldValue('productBarcode', product.barcode);
  setFieldValue('productCategory', product.category);
  setFieldValue('productUnit', product.unit || 'un');
  setFieldValue('productPrice', product.price);
  setFieldValue('productCost', product.cost);
  setFieldValue('productStock', product.stock);
  setFieldValue('productMinStock', product.minStock);

  const activeEl = document.getElementById('productActive');
  if (activeEl) activeEl.checked = product.active !== false;
  const promoEl = document.getElementById('productPromotional');
  if (promoEl) promoEl.checked = Boolean(product.promotional);

  setFieldValue('productSaleType', product.saleType || 'unit');
  setFieldValue('productPricePerKg', product.pricePerKg || '');
  const fracEl = document.getElementById('productAllowFractional');
  if (fracEl) fracEl.checked = product.allowFractional !== false;
  const perishableEl = document.getElementById('productIsPerishable');
  if (perishableEl) perishableEl.checked = Boolean(product.isPerishable);
  _updateSaleTypeVisibility();

  _pendingImageData = product.imageUrl || '';
  _applyImagePreview(_pendingImageData);
  updateProductMarginCalc();

  const productPageButton = document.querySelector('[data-page="produtos"]');
  if (productPageButton) {
    productPageButton.click();
  }

  showToast('Produto carregado para edição');
}

/* ================= CREATE ================= */

export async function addProduct() {
  if (!canManageProducts()) {
    return showToast('Sem permissão.', 'error');
  }

  const product = getProductFormData();

  if (!product.name || !product.code) {
    return showToast('Preencha nome e código.', 'error');
  }

  if (editingProductCode) {
    // Parte H — produto já cadastrado, sem validade, com estoque > 0 e sem
    // nenhum ProductBatch: ativar "possui validade" agora precisa de um jeito
    // de dizer quais validades correspondem ao estoque que já existe, senão
    // esse estoque fica "invisível" pro FEFO/relatório de vencimento mesmo
    // contando no total (mesmo problema que o fluxo de criação já resolve
    // para produto novo, aqui aplicado a uma edição).
    const previous = state.products.find((p) => p.code === editingProductCode);
    const turningOnPerishable = Boolean(previous) && !previous.isPerishable && product.isPerishable;

    if (turningOnPerishable && Number(previous.stock) > 0 && previous.id && isBackendReady()) {
      const existingBatches = await listProductBatchesService(previous.id).catch(() => []);
      if (!existingBatches?.length) {
        _openDistributeStockModal(previous, product);
        return;
      }
      // Não deveria haver lote com a flag desativada (validado antes de
      // implementar), mas por segurança: se já existir lote por algum motivo,
      // não abre o fluxo de distribuição (evitaria duplicar o estoque já
      // rastreado) — avisa e segue a edição normal, o usuário pode conferir
      // esses lotes em Estoque > Controle de Validade (Parte G) depois.
      showToast('Este produto já tem lotes registrados — use "Conferir estoque" em Controle de Validade se precisar ajustá-los.', 'warning');
    }

    return updateExistingProduct(editingProductCode, product);
  }

  if (state.products.some((p) => p.code === product.code)) {
    return showToast('Código já existe.', 'error');
  }

  // Produto perecível com quantidade inicial > 0: essa quantidade precisa
  // virar um ProductBatch com validade, não um número solto em product.stock
  // — sem isso, o estoque inicial fica "invisível" para o FEFO e para o
  // relatório de vencimento, mesmo contando no total. Sem quantidade inicial
  // não há nada a rastrear ainda, então segue o fluxo normal.
  if (product.isPerishable && Number(product.stock) > 0) {
    _openInitialBatchExpiryModal(product, (expiresAtIso) => {
      _createProductWithInitialBatch(product, expiresAtIso);
    });
    return;
  }

  await _createProductPlain(product);
}

async function _createProductPlain(product) {
  let createdProduct = normalizeProduct(product);

  try {
    const created = await createProductService(product);
    createdProduct = normalizeProduct({
      ...product,
      ...(created || {})
    });
  } catch {
    createdProduct = normalizeProduct(product);
  }

  state.products = dedupeProducts([...state.products, createdProduct]);

  await persistProducts();
  clearProductForm();
  cancelProductEdit();

  showToast('Produto cadastrado');
  addHistory(
    'Estoque',
    `Produto cadastrado: ${createdProduct.name}`,
    Number(createdProduct.price) * Number(createdProduct.stock)
  );
}

// Cria o produto já com stock=0 — quem soma o estoque de verdade é o lote
// criado logo em seguida (createProductBatchService, mesma função usada pelo
// atalho "+"), para que o estoque inicial fique rastreado por validade desde
// o começo. Recarrega o catálogo do backend ao final (initProducts()) em vez
// de tentar mesclar manualmente o resultado dos dois passos — mais simples e
// evita drift entre product.stock e a soma dos lotes.
async function _createProductWithInitialBatch(product, expiresAtIso) {
  if (!isBackendReady()) {
    showToast('Controle de validade exige conexão com o backend para o estoque inicial.', 'warning');
    return;
  }

  const initialQty = Number(product.stock) || 0;

  try {
    const created = await createProductService({ ...product, stock: 0 });
    if (!created?.id) {
      throw new Error('Produto criado sem identificador retornado pelo backend.');
    }

    await createProductBatchService(created.id, { quantity: initialQty, expiresAt: expiresAtIso });

    await initProducts();
    clearProductForm();
    cancelProductEdit();

    showToast('Produto cadastrado com lote inicial de validade.');
    addHistory(
      'Estoque',
      `Produto cadastrado: ${product.name} (lote inicial: ${initialQty} un., validade ${formatDateBR(expiresAtIso)})`,
      Number(product.price) * initialQty
    );
  } catch (error) {
    console.error('Erro ao cadastrar produto com lote inicial:', error);
    showToast(error?.message || 'Erro ao cadastrar produto com lote inicial.', 'error');
  }
}

function _openInitialBatchExpiryModal(product, onConfirm) {
  document.getElementById('productInitialBatchOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'productInitialBatchOverlay';
  overlay.className = 'overlay';

  const todayIso = new Date().toISOString().slice(0, 10);
  const qty = Number(product.stock) || 0;

  overlay.innerHTML = `
    <div class="modal pdv-exit-modal">
      <div class="cs-modal-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="m7.5 4.27 9 5.15"/>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
          <path d="m3.3 7 8.7 5 8.7-5"/>
          <path d="M12 22V12"/>
        </svg>
      </div>
      <h3 class="cs-modal-title">Validade do estoque inicial</h3>
      <p class="mini cs-modal-sub">
        <strong>${_esc(product.name)}</strong> possui controle de validade.
        Informe a validade das <strong>${qty}</strong> unidade(s) de estoque inicial.
      </p>
      <div class="field-group cs-modal-fg">
        <label for="initialBatchExpiry">Validade</label>
        <input id="initialBatchExpiry" class="field" type="date" min="${todayIso}" />
      </div>
      <div class="hero-actions compact cs-modal-acts">
        <button id="confirmInitialBatchBtn" class="btn btn-primary" type="button">Cadastrar produto</button>
        <button id="cancelInitialBatchBtn" class="btn btn-ghost" type="button">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const expiryInput = document.getElementById('initialBatchExpiry');
  setTimeout(() => expiryInput?.focus(), 80);

  document.getElementById('cancelInitialBatchBtn')?.addEventListener('click', () => overlay.remove());

  document.getElementById('confirmInitialBatchBtn')?.addEventListener('click', () => {
    const expiryRaw = expiryInput?.value;
    if (!expiryRaw) {
      showToast('Informe a validade.', 'warning');
      return;
    }
    overlay.remove();
    onConfirm(new Date(`${expiryRaw}T00:00:00`).toISOString());
  });
}

/* ---- Parte H: distribuir estoque já existente em lotes ao ativar validade ---- */

let _distributeRows = [];
let _distributeRowSeq = 0;
let _distributeExpected = 0;

function _closeDistributeStockModal(revertCheckbox) {
  document.getElementById('distributeStockOverlay')?.remove();
  _distributeRows = [];
  if (revertCheckbox) {
    // Cancelar não pode deixar o produto com validade "ativada" sem os
    // lotes correspondentes — reverte o checkbox pro estado anterior e
    // deixa o usuário decidir o próximo passo no formulário ainda aberto.
    const perishableEl = document.getElementById('productIsPerishable');
    if (perishableEl) perishableEl.checked = false;
  }
}

function _distributeRowHtml(row) {
  return `
    <div class="batch-verify-row" data-row-id="${row._id}">
      <div class="field-group">
        <label>Quantidade</label>
        <input type="number" class="field distribute-qty" min="0" step="0.001" value="${_esc(String(row.quantity))}" />
      </div>
      <div class="field-group">
        <label>Validade</label>
        <input type="date" class="field distribute-date" value="${_esc(row.expiresAt)}" />
      </div>
      <div class="batch-verify-row-actions">
        <button type="button" class="btn btn-ghost btn-xs distribute-remove-btn">Remover</button>
      </div>
    </div>
  `;
}

function _renderDistributeRows() {
  const container = document.getElementById('distributeRows');
  if (!container) return;
  container.innerHTML = _distributeRows.length
    ? _distributeRows.map(_distributeRowHtml).join('')
    : '<p class="mini empty-row">Adicione ao menos um lote.</p>';
  _updateDistributeTotal();
}

function _updateDistributeTotal() {
  const expected = _distributeExpected;
  const totalEl = document.getElementById('distributeTotal');
  const confirmBtn = document.getElementById('distributeConfirmBtn');
  const total = _distributeRows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);

  if (totalEl) {
    totalEl.textContent = total.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    totalEl.classList.toggle('distribute-total-mismatch', total !== expected);
  }
  if (confirmBtn) confirmBtn.disabled = total !== expected || _distributeRows.length === 0;
}

function _openDistributeStockModal(previousProduct, formData) {
  _closeDistributeStockModal(false);

  const expected = Number(previousProduct.stock) || 0;
  _distributeExpected = expected;

  const overlay = document.createElement('div');
  overlay.id = 'distributeStockOverlay';
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal pdv-exit-modal batch-verify-modal">
      <h3 class="cs-modal-title">Distribuir estoque existente em lotes</h3>
      <p class="mini cs-modal-sub">
        <strong>${_esc(previousProduct.name)}</strong> já tem <strong>${expected}</strong> unidade(s) em estoque, sem lote de validade.
        Informe a validade de cada parte dessas unidades antes de ativar o controle de validade.
      </p>
      <div id="distributeRows" class="batch-verify-rows"></div>
      <button type="button" id="distributeAddBtn" class="btn btn-ghost btn-xs">+ Adicionar lote</button>
      <p class="mini">Total informado: <strong id="distributeTotal">0</strong> de <strong>${expected}</strong> unidade(s)</p>
      <div id="distributeError" class="auth-status hidden"></div>
      <div class="hero-actions compact cs-modal-acts">
        <button id="distributeCancelBtn" class="btn btn-ghost" type="button">Cancelar</button>
        <button id="distributeConfirmBtn" class="btn btn-primary" type="button" disabled>Confirmar e salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('distributeCancelBtn')?.addEventListener('click', () => _closeDistributeStockModal(true));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeDistributeStockModal(true); });

  document.getElementById('distributeAddBtn')?.addEventListener('click', () => {
    _distributeRows.push({ quantity: 0, expiresAt: '', _id: ++_distributeRowSeq });
    _renderDistributeRows();
  });

  const rowsContainer = document.getElementById('distributeRows');
  rowsContainer?.addEventListener('input', (e) => {
    const rowEl = e.target.closest('.batch-verify-row');
    if (!rowEl) return;
    const row = _distributeRows.find((r) => String(r._id) === rowEl.dataset.rowId);
    if (!row) return;
    if (e.target.classList.contains('distribute-qty')) {
      row.quantity = Number(e.target.value) || 0;
      _updateDistributeTotal();
    } else if (e.target.classList.contains('distribute-date')) {
      row.expiresAt = e.target.value;
    }
  });

  rowsContainer?.addEventListener('click', (e) => {
    if (!e.target.classList.contains('distribute-remove-btn')) return;
    const rowEl = e.target.closest('.batch-verify-row');
    const idx = _distributeRows.findIndex((r) => String(r._id) === rowEl?.dataset.rowId);
    if (idx !== -1) { _distributeRows.splice(idx, 1); _renderDistributeRows(); }
  });

  document.getElementById('distributeConfirmBtn')?.addEventListener('click', async () => {
    const errorEl = document.getElementById('distributeError');
    const total = _distributeRows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);

    if (total !== expected) {
      if (errorEl) { errorEl.textContent = `O total informado (${total}) precisa ser igual ao estoque atual (${expected}).`; errorEl.classList.remove('hidden'); }
      return;
    }
    for (const row of _distributeRows) {
      if (!(row.quantity > 0) || !row.expiresAt) {
        if (errorEl) { errorEl.textContent = 'Informe quantidade (maior que zero) e validade em todos os lotes.'; errorEl.classList.remove('hidden'); }
        return;
      }
    }

    await _saveProductWithBatchDistribution(previousProduct, formData, _distributeRows.slice(), errorEl);
  });

  _distributeRows = [{ quantity: expected, expiresAt: '', _id: ++_distributeRowSeq }];
  _renderDistributeRows();
}

// Salva as edições do formulário (nome, preço etc. + isPerishable=true) com
// stock=0, depois cria um ProductBatch por linha informada — mesma função
// usada pelo atalho "+" e pelo cadastro de produto novo (createProductBatchService),
// para que o estoque final volte a bater exatamente com o que já existia,
// só que agora rastreado por lote em vez de solto em product.stock.
async function _saveProductWithBatchDistribution(previousProduct, formData, rows, errorEl) {
  try {
    const updated = normalizeProduct({ ...previousProduct, ...formData, stock: 0 });
    await updateProductService(updated);

    for (const row of rows) {
      await createProductBatchService(previousProduct.id, {
        quantity: row.quantity,
        expiresAt: new Date(`${row.expiresAt}T00:00:00`).toISOString()
      });
    }

    _closeDistributeStockModal(false);
    await initProducts();
    clearProductForm();
    cancelProductEdit();

    const totalQty = rows.reduce((acc, r) => acc + Number(r.quantity), 0);
    showToast('Produto atualizado — estoque existente distribuído em lotes de validade.');
    addHistory(
      'Estoque',
      `Validade ativada para ${updated.name}: ${totalQty} unidade(s) existentes distribuídas em ${rows.length} lote(s).`
    );
  } catch (err) {
    if (errorEl) { errorEl.textContent = err?.message || 'Erro ao salvar produto com distribuição de lotes.'; errorEl.classList.remove('hidden'); }
  }
}

/* ================= UPDATE ================= */

export async function updateExistingProduct(code, data) {
  if (!canManageProducts()) {
    return showToast('Sem permissão.', 'error');
  }

  const index = state.products.findIndex((p) => p.code === code);
  if (index < 0) {
    return showToast('Produto não encontrado.', 'error');
  }

  const hasDuplicateCode = state.products.some(
    (p, i) => i !== index && p.code === data.code
  );

  if (hasDuplicateCode) {
    return showToast('Já existe outro produto com esse código.', 'error');
  }

  const updated = normalizeProduct({ ...state.products[index], ...data });

  try {
    const saved = await updateProductService(updated);
    state.products[index] = normalizeProduct({
      ...updated,
      ...(saved || {})
    });
  } catch {
    state.products[index] = updated;
  }

  state.products = dedupeProducts(state.products);

  await persistProducts();

  clearProductForm();
  cancelProductEdit();

  showToast('Produto atualizado');
  addHistory(
    'Estoque',
    `Produto atualizado: ${updated.name}`,
    Number(updated.price) * Number(updated.stock)
  );
}

/* ================= DELETE ================= */

export async function removeProduct(index) {
  if (!canManageProducts()) {
    return showToast('Sem permissão.', 'error');
  }

  const removed = state.products[index];
  if (!removed) return;

  if (!confirm(`Remover ${removed.name}?`)) return;

  _saveImgToStorage(removed.code, '');

  try {
    await deleteProductService(removed);
  } catch (error) {
    console.warn('Erro ao remover no backend:', error);
  }

  state.products.splice(index, 1);
  state.products = dedupeProducts(state.products);

  await persistProducts();

  if (editingProductCode === removed.code) {
    clearProductForm();
    cancelProductEdit();
  }

  showToast('Produto removido');
  addHistory(
    'Estoque',
    `Produto removido: ${removed.name}`,
    Number(removed.price) * Number(removed.stock)
  );
}

async function removeMultipleProducts(codesToRemove = []) {
  if (!canManageProducts()) {
    return showToast('Sem permissão.', 'error');
  }

  if (!codesToRemove.length) {
    return showToast('Selecione ao menos um produto.', 'error');
  }

  const selectedProducts = (state.products || []).filter((product) =>
    codesToRemove.includes(product.code)
  );

  if (!selectedProducts.length) {
    return showToast('Nenhum produto válido foi selecionado.', 'error');
  }

  if (!confirm(`Remover ${selectedProducts.length} produto(s) selecionado(s)?`)) {
    return;
  }

  for (const product of selectedProducts) {
    _saveImgToStorage(product.code, '');
    try {
      await deleteProductService(product);
    } catch (error) {
      console.warn(`Erro ao remover no backend: ${product.name}`, error);
    }
  }

  state.products = (state.products || []).filter(
    (product) => !codesToRemove.includes(product.code)
  );

  state.products = dedupeProducts(state.products);

  await persistProducts();

  if (editingProductCode && codesToRemove.includes(editingProductCode)) {
    clearProductForm();
    cancelProductEdit();
  }

  showToast(`${selectedProducts.length} produto(s) removido(s).`);

  addHistory(
    'Estoque',
    `Remoção múltipla de produtos (${selectedProducts.length})`,
    selectedProducts.reduce((acc, product) => {
      return acc + Number(product.price ?? 0) * Number(product.stock ?? 0);
    }, 0)
  );
}

/* ================= STOCK ================= */

// Produto com validade (isPerishable): "+" abre o modal de entrada por lote
// (quantidade + validade, cria um ProductBatch); "-" desconta via FEFO no
// backend (nunca por escolha manual do operador). Produto sem validade:
// comportamento inalterado — incremento/decremento direto do contador.
export async function adjustStock(code, delta) {
  const product = state.products.find((p) => p.code === code);
  if (!product) return;

  if (product.isPerishable) {
    if (Number(delta) > 0) {
      _openBatchEntryModal(product);
    } else {
      await _consumeBatchStock(product, Math.abs(Number(delta)));
    }
    return;
  }

  // BUG CONFIRMADO: quando updateProductService() falhava (ex.: imageUrl
  // acima do limite do schema — ver fix no backend), o erro era só um
  // console.warn — o incremento otimista abaixo continuava na tela e o
  // toast de sucesso disparava incondicionalmente, como se tivesse
  // funcionado. O número só "voltava" sozinho no próximo initProducts()
  // (F5, trocar de aba), sem nenhuma mensagem explicando o motivo. Agora,
  // se o backend recusar, desfaz o incremento local e mostra o erro real
  // (extractErrorMessage(), via http.js) em vez de fingir sucesso.
  const previousStock = Number(product.stock) || 0;
  product.stock = Math.max(0, previousStock + Number(delta));

  try {
    await updateProductService(product);
  } catch (error) {
    console.warn('Erro ao atualizar estoque no backend:', error);
    product.stock = previousStock;
    await persistProducts();
    showToast(error?.message || 'Erro ao atualizar estoque.', 'error');
    return;
  }

  await persistProducts();

  showToast(delta > 0 ? 'Entrada no estoque' : 'Saída no estoque');
  addHistory(
    'Estoque',
    `${delta > 0 ? 'Entrada' : 'Saída'} de estoque: ${product.name}`,
    Number(product.price) * Math.abs(Number(delta))
  );
}

async function _consumeBatchStock(product, quantity) {
  if (!isBackendReady()) {
    showToast('Controle de validade exige conexão com o backend.', 'warning');
    return;
  }

  try {
    await consumeProductBatchService(product.id, quantity);
    await initProducts();
    showToast('Saída no estoque (lote mais próximo do vencimento)');
    addHistory('Estoque', `Saída de estoque: ${product.name}`, Number(product.price) * quantity);
  } catch (error) {
    console.error('Erro ao consumir lote:', error);
    showToast(error?.message || 'Erro ao registrar saída de estoque.', 'error');
  }
}

function _openBatchEntryModal(product) {
  document.getElementById('productBatchEntryOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'productBatchEntryOverlay';
  overlay.className = 'overlay';

  const todayIso = new Date().toISOString().slice(0, 10);

  overlay.innerHTML = `
    <div class="modal pdv-exit-modal">
      <div class="cs-modal-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="m7.5 4.27 9 5.15"/>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
          <path d="m3.3 7 8.7 5 8.7-5"/>
          <path d="M12 22V12"/>
        </svg>
      </div>
      <h3 class="cs-modal-title">Entrada de lote</h3>
      <p class="mini cs-modal-sub">
        <strong>${_esc(product.name)}</strong> possui controle de validade.
        Informe a quantidade e a validade desta entrada.
      </p>
      <div class="field-group cs-modal-fg">
        <label for="batchEntryQty">Quantidade</label>
        <input id="batchEntryQty" class="field" type="number" min="1" step="1" value="1" />
      </div>
      <div class="field-group cs-modal-fg">
        <label for="batchEntryExpiry">Validade</label>
        <input id="batchEntryExpiry" class="field" type="date" min="${todayIso}" />
      </div>
      <div class="hero-actions compact cs-modal-acts">
        <button id="confirmBatchEntryBtn" class="btn btn-primary" type="button">Registrar entrada</button>
        <button id="cancelBatchEntryBtn" class="btn btn-ghost" type="button">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const qtyInput = document.getElementById('batchEntryQty');
  setTimeout(() => { qtyInput?.focus(); qtyInput?.select?.(); }, 80);

  document.getElementById('cancelBatchEntryBtn')?.addEventListener('click', () => overlay.remove());

  document.getElementById('confirmBatchEntryBtn')?.addEventListener('click', async () => {
    const qty = Math.max(1, Math.floor(Number(qtyInput?.value) || 0));
    const expiryRaw = document.getElementById('batchEntryExpiry')?.value;

    if (!qty) {
      showToast('Informe uma quantidade válida.', 'warning');
      return;
    }
    if (!expiryRaw) {
      showToast('Informe a validade.', 'warning');
      return;
    }

    if (!isBackendReady()) {
      showToast('Controle de validade exige conexão com o backend.', 'warning');
      return;
    }

    overlay.remove();

    try {
      await createProductBatchService(product.id, {
        quantity: qty,
        expiresAt: new Date(`${expiryRaw}T00:00:00`).toISOString()
      });
      await initProducts();
      showToast(`Entrada registrada: ${qty} unidade(s), validade ${formatDateBR(expiryRaw)}`);
      addHistory(
        'Estoque',
        `Entrada de lote: ${product.name} (${qty} un., validade ${formatDateBR(expiryRaw)})`,
        Number(product.price) * qty
      );
    } catch (error) {
      console.error('Erro ao registrar entrada de lote:', error);
      showToast(error?.message || 'Erro ao registrar entrada de lote.', 'error');
    }
  });
}

/* ================= RENDER PRODUCTS TABLE ================= */

export function renderProducts() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!state.products.length) {
    tbody.innerHTML = '<tr><td colspan="7">Nenhum produto</td></tr>';
    return;
  }

  state.products.forEach((p, i) => {
    const tr = document.createElement('tr');
    const _n = _esc(p.name ?? '-');
    const _c = _esc(p.code ?? '-');
    const isWeight = p.saleType === 'weight';
    const priceDisplay = isWeight && p.pricePerKg
      ? formatCurrency(Number(p.pricePerKg)) + '/KG'
      : formatCurrency(Number(p.price ?? 0));
    const stockDisplay = isWeight
      ? Number(p.stock ?? 0).toFixed(3).replace('.', ',') + ' KG'
      : String(Number(p.stock ?? 0));

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${_n}${isWeight ? ' <span class="prd-kg-badge">KG</span>' : ''}</td>
      <td>${_c}</td>
      <td>${priceDisplay}</td>
      <td>${stockDisplay}</td>
      <td>
        <button class="stock-plus" data-code="${_c}">+</button>
        <button class="stock-minus" data-code="${_c}">-</button>
        <button class="product-edit" data-code="${_c}">Editar</button>
        <button class="remove" data-index="${i}">Excluir</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.stock-plus').forEach((button) =>
    button.addEventListener('click', () => adjustStock(button.dataset.code, 1))
  );

  tbody.querySelectorAll('.stock-minus').forEach((button) =>
    button.addEventListener('click', () => adjustStock(button.dataset.code, -1))
  );

  tbody.querySelectorAll('.product-edit').forEach((button) =>
    button.addEventListener('click', () => startProductEdit(button.dataset.code))
  );

  tbody.querySelectorAll('.remove').forEach((button) =>
    button.addEventListener('click', () => removeProduct(Number(button.dataset.index)))
  );
}

/* ================= RENDER STOCK CONTROL TABLE ================= */

export function renderStockTable() {
  const tbody = document.getElementById('stockTableBody');
  if (!tbody) return;

  let products = Array.isArray(state.products) ? state.products : [];

  const searchVal = (document.getElementById('stockSearchInput')?.value || '').toLowerCase().trim();
  const catFilter = document.getElementById('stockCategoryFilter')?.value || '';
  const statusFilter = document.getElementById('stockStatusFilter')?.value || '';
  const lowOnly = document.getElementById('stockLowOnlyToggle')?.checked || false;

  if (searchVal) products = products.filter(p => (p.name||'').toLowerCase().includes(searchVal) || (p.code||'').toLowerCase().includes(searchVal) || (p.barcode||'').toLowerCase().includes(searchVal));
  if (catFilter) products = products.filter(p => (p.category||'') === catFilter);
  if (statusFilter) products = products.filter(p => { const s=Number(p.stock||0),m=Number(p.minStock||5); return statusFilter==='zero'?s<=0:statusFilter==='low'?s>0&&s<=m:s>m; });
  if (lowOnly) products = products.filter(p => { const s=Number(p.stock||0),m=Number(p.minStock||5); return s<=m; });

  const infoEl = document.getElementById('stockPaginationInfo');
  if (infoEl) infoEl.textContent = `Exibindo 1 a ${Math.min(products.length,20)} de ${products.length} produtos`;

  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="prd-empty-td">Nenhum produto encontrado.</td></tr>';
    updateGrandTotal();
    updatePremiumProductVisuals();
    return;
  }

  const catColors = { 'Bebidas':'#2563eb','Alimentos':'#22c55e','Papelaria':'#8b5cf6','Doces':'#f59e0b','Laticínios':'#06b6d4','Higiene':'#10b981','Eletrônicos':'#60a5fa','Salgadinhos':'#fb923c','Outros':'#64748b' };

  tbody.innerHTML = products.map((product) => {
    const stock = Number(product.stock ?? 0);
    const price = Number(product.price ?? 0);
    const cost = Number(product.cost ?? product.costPrice ?? 0);
    const totalValue = stock * cost;
    const minStock = Number(product.minStock ?? 5);
    const statusClass = stock <= 0 ? 'zero' : stock <= minStock ? 'low' : 'normal';
    const statusText = stock <= 0 ? 'Zerado' : stock <= minStock ? 'Baixo' : 'Normal';
    let qtyClass = 'qty-badge';
    if (stock <= 0) qtyClass += ' stock-zero';
    else if (stock <= minStock) qtyClass += ' stock-low';
    const thumbColor = catColors[product.category] || '#475569';
    const thumbInitial = (product.name || '?')[0].toUpperCase();
    const _pName = _esc(product.name ?? '-');
    const _pCode = _esc(product.code ?? '-');
    const _pCat  = _esc(product.category || '-');
    const _pBar  = _esc(product.barcode || '-');
    const _pImg  = _safeImageUrl(product.imageUrl);
    const thumbHtml = _pImg
      ? `<div class="stock-thumb"><img src="${_esc(_pImg)}" alt="${_pName}" /></div>`
      : `<div class="stock-thumb prd-thumb" data-thumb-clr="${_esc(thumbColor)}">${thumbInitial}</div>`;
    const isWeight = product.saleType === 'weight';
    const priceDisplay = isWeight && product.pricePerKg
      ? formatCurrency(Number(product.pricePerKg)) + '/KG'
      : formatCurrency(price);
    const stockDisplay = isWeight
      ? stock.toFixed(3).replace('.', ',') + ' KG'
      : String(stock);

    return `
      <tr>
        <td>
          <div class="stock-product-cell">
            ${thumbHtml}
            <div>
              <div class="stock-product-name">${_pName}${isWeight ? ' <span class="prd-kg-badge">KG</span>' : ''}</div>
              <div class="stock-product-cat">${isWeight ? 'Venda por KG &bull; ' : ''}${_pCat}</div>
            </div>
          </div>
        </td>
        <td>${_pCode}</td>
        <td>${_pBar}</td>
        <td>${priceDisplay}</td>
        <td>${formatCurrency(cost)}</td>
        <td><span class="${qtyClass}">${stockDisplay}</span></td>
        <td>${formatCurrency(totalValue)}</td>
        <td><span class="stock-status ${statusClass}">${statusText}</span></td>
        <td>
          <div class="stock-actions">
            <button class="stock-plus" data-code="${_pCode}" title="+1">+1</button>
            <button class="stock-minus" data-code="${_pCode}" title="-1">-1</button>
            <button class="stock-edit stock-edit-btn" data-code="${_pCode}" title="Editar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="stock-hist" data-code="${_pCode}" title="Histórico">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.prd-thumb[data-thumb-clr]').forEach(el => {
    const c = el.dataset.thumbClr;
    el.style.setProperty('--thumb-clr',  c);
    el.style.setProperty('--thumb-bg-a', c + '33');
    el.style.setProperty('--thumb-bg-b', c + '11');
    el.style.setProperty('--thumb-bd',   c + '44');
  });
  tbody.querySelectorAll('.stock-plus').forEach((button) => button.addEventListener('click', () => adjustStock(button.dataset.code, 1)));
  tbody.querySelectorAll('.stock-minus').forEach((button) => button.addEventListener('click', () => adjustStock(button.dataset.code, -1)));
  tbody.querySelectorAll('.stock-edit').forEach((button) => button.addEventListener('click', () => startProductEdit(button.dataset.code)));
  updateGrandTotal();
  updatePremiumProductVisuals();
}
export function renderRemoveProductsChecklist(filter = '') {
  const container = document.getElementById('removeProductsChecklist');
  if (!container) return;

  const products = Array.isArray(state.products) ? state.products : [];
  const search = filter.toLowerCase().trim();
  const filtered = search
    ? products.filter(p => (p.name || '').toLowerCase().includes(search) || (p.code || '').toLowerCase().includes(search))
    : products;

  if (!filtered.length) {
    container.innerHTML = `<div class="mini prd-empty-wrap">${search ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado.'}</div>`;
    _updateRemoveCountLabel();
    return;
  }

  container.innerHTML =
    '<div class="rpc-head">' +
      '<span></span>' +
      '<span>PRODUTO</span>' +
      '<span>CÓDIGO</span>' +
      '<span>PREÇO</span>' +
      '<span>QTD.</span>' +
    '</div>' +
    filtered.map((p) => {
      const _pn = _esc(p.name || '-');
      const _pc = _esc(p.code || '');
      return '<label class="rpc-row">' +
        '<input type="checkbox" value="' + _pc + '" />' +
        '<div class="rpc-name">' + _pn + '</div>' +
        '<div class="rpc-code">' + (_pc || '-') + '</div>' +
        '<div class="rpc-price">' + formatCurrency(Number(p.price || 0)) + '</div>' +
        '<div class="rpc-qty">' + Number(p.stock || 0) + ' un.</div>' +
      '</label>';
    }).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
    cb.addEventListener('change', function() {
      const row = cb.closest('.rpc-row');
      if (row) row.classList.toggle('rpc-row-checked', cb.checked);
      _updateRemoveCountLabel();
    });
  });

  _updateRemoveCountLabel();
}

/* ================= LOW STOCK ================= */

export function renderLowStock() {
  const lowStockList = document.getElementById('lowStockList');
  const lowStockTableBody = document.getElementById('lowStockTableBody');

  const lowStockProducts = state.products.filter((product) => {
    const stock = Number(product.stock ?? 0);
    const minStock = Number(product.minStock ?? 5);
    return stock <= minStock;
  });

  if (lowStockList) {
    if (!lowStockProducts.length) {
      lowStockList.innerHTML = '<p class="mini">Nenhum produto com estoque baixo.</p>';
    } else {
      lowStockList.innerHTML = lowStockProducts
        .map((product) => {
          const stock = Number(product.stock ?? 0);
          const minStock = Number(product.minStock ?? 5);
          const _lName = _esc(product.name ?? 'Produto sem nome');
          const _lCode = _esc(product.code ?? '-');

          return `
            <article class="low-stock-item">
              <strong>${_lName}</strong>
              <span>Código: ${_lCode}</span>
              <span>Estoque: ${stock}</span>
              <span>Mínimo: ${minStock}</span>
            </article>
          `;
        })
        .join('');
    }
  }

  if (lowStockTableBody) {
    if (!lowStockProducts.length) {
      lowStockTableBody.innerHTML = '<tr><td colspan="3">Nenhum produto com estoque baixo.</td></tr>';
    } else {
      const _catColors = { 'Bebidas':'#2563eb','Alimentos':'#22c55e','Papelaria':'#8b5cf6','Doces':'#f59e0b','Laticínios':'#06b6d4','Higiene':'#10b981','Eletrônicos':'#60a5fa','Salgadinhos':'#fb923c','Outros':'#64748b' };
      lowStockTableBody.innerHTML = lowStockProducts
        .map((product) => {
          const stock = Number(product.stock ?? 0);
          const minStock = Number(product.minStock ?? 5);
          const c = _catColors[product.category] || '#64748b';
          const _tName = _esc(product.name ?? '-');
          const initial = (product.name || '?')[0].toUpperCase();
          const _tImg = _safeImageUrl(product.imageUrl);
          const thumb = _tImg
            ? `<img src="${_esc(_tImg)}" alt="${_tName}" class="prd-thumb-img" />`
            : `<div class="prd-thumb" data-thumb-clr="${_esc(c)}">${initial}</div>`;
          return `<tr>
            <td><div class="prd-name-cell">${thumb}<span>${_tName}</span></div></td>
            <td class="prd-td-ctr">${stock}</td>
            <td class="prd-td-red">${minStock}</td>
          </tr>`;
        })
        .join('');
      lowStockTableBody.querySelectorAll('.prd-thumb[data-thumb-clr]').forEach(el => {
        const c = el.dataset.thumbClr;
        el.style.setProperty('--thumb-clr',  c);
        el.style.setProperty('--thumb-bg-a', c + '33');
        el.style.setProperty('--thumb-bg-b', c + '11');
        el.style.setProperty('--thumb-bd',   c + '44');
      });
    }
  }
}

/* ================= REMOVE SELECTOR ================= */

export function renderRemoveSelector() {
  const select = document.getElementById('removeProductSelect');
  if (!select) return;

  select.innerHTML = '';

  if (!state.products.length) {
    select.innerHTML = '<option value="">Nenhum produto disponível</option>';
    return;
  }

  select.innerHTML = '<option value="">Selecione um produto</option>';

  state.products.forEach((product, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${product.name ?? '-'} (${product.code ?? '-'})`;
    select.appendChild(option);
  });
}

/* ================= METRICS ================= */

export function updateProductMetrics() {
  const products = state.products || [];

  const totalUnits = products.reduce((acc, p) => acc + Number(p.stock ?? 0), 0);
  const lowStockCount = products.filter((p) => {
    const stock = Number(p.stock ?? 0);
    const minStock = Number(p.minStock ?? 5);
    return stock > 0 && stock <= minStock;
  }).length;
  const outOfStockCount = products.filter((p) => Number(p.stock ?? 0) <= 0).length;
  const totalStockValue = products.reduce(
    (acc, p) => acc + Number(p.stock ?? 0) * Number(p.price ?? 0),
    0
  );

  const totalUnitsEl = document.getElementById('totalUnitsCount');
  const lowStockEl = document.getElementById('lowStockCount');
  const outOfStockEl = document.getElementById('outOfStockCount');
  const stockValueEl = document.getElementById('stockValueCount');

  if (totalUnitsEl) totalUnitsEl.textContent = String(totalUnits);
  if (lowStockEl) lowStockEl.textContent = String(lowStockCount);
  if (outOfStockEl) outOfStockEl.textContent = String(outOfStockCount);
  if (stockValueEl) stockValueEl.textContent = formatCurrency(totalStockValue);

  updateGrandTotal();
}


function setTextContent(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

function updatePremiumProductVisuals() {
  const products = Array.isArray(state.products) ? state.products : [];
  const totalUnits = products.reduce((a,p)=>a+Number(p.stock||0),0);
  const totalCost = products.reduce((a,p)=>a+Number(p.stock||0)*Number(p.cost||0),0);
  const totalSale = products.reduce((a,p)=>a+Number(p.stock||0)*Number(p.price||0),0);
  const profit = totalSale - totalCost;
  const low = products.filter(p=>Number(p.stock||0)>0 && Number(p.stock||0)<=Number(p.minStock||5));
  const zero = products.filter(p=>Number(p.stock||0)<=0);
  const categories = new Set(products.map(p=>p.category).filter(Boolean));
  const mostExpensive = products.slice().sort((a,b)=>Number(b.price||0)-Number(a.price||0))[0];
  const highestQty = products.slice().sort((a,b)=>Number(b.stock||0)-Number(a.stock||0))[0];
  const last = products[products.length-1];
  setTextContent('productsRegisteredCount', String(products.length));
  setTextContent('productsCategoriesCount', String(categories.size));
  setTextContent('lastProductRegisteredName', last?.name || '—');
  setTextContent('stockProductsCount', String(products.length));
  setTextContent('stockLowKpiCount', String(low.length + zero.length));
  setTextContent('stockMostExpensivePrice', formatCurrency(Number(mostExpensive?.price||0)));
  setTextContent('stockMostExpensiveName', mostExpensive?.name || '—');
  setTextContent('stockHighestQty', highestQty ? Number(highestQty.stock||0)+' un.' : '0 un.');
  setTextContent('stockHighestQtyName', highestQty?.name || '—');
  setTextContent('stockTotalCostInvested', formatCurrency(totalCost));
  setTextContent('stockPotentialSaleValue', formatCurrency(totalSale));
  setTextContent('stockPotentialProfit', formatCurrency(profit));
  setTextContent('stockPotentialMargin', totalSale ? ((profit/totalSale)*100).toFixed(2).replace('.', ',')+'%' : '0%');

  const recent = document.getElementById('productsRecentTableBody');
  if (recent) {
    const fmtDate = (iso) => {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const yyyy = d.getFullYear();
        const hh = String(d.getHours()).padStart(2,'0');
        const min = String(d.getMinutes()).padStart(2,'0');
        return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
      } catch(e) { return '—'; }
    };
    const stock_active = (p) => (p.active !== false) ? '<span class="stock-status normal">Ativo</span>' : '<span class="stock-status zero">Inativo</span>';
    recent.innerHTML = products.slice(-6).reverse().map(p => {
      const _rn = _esc(p.name||'-'); const _rc = _esc(p.code||'-'); const _rcat = _esc(p.category||'-');
      return `<tr><td>${_rn}</td><td>${_rc}</td><td>${_rcat}</td><td>${formatCurrency(Number(p.price||0))}</td><td>${formatCurrency(Number(p.cost||0))}</td><td>${Number(p.stock||0)}</td><td>${Number(p.minStock||0)}</td><td class="prd-td-nowrap">${fmtDate(p.createdAt)}</td><td>${stock_active(p)}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">Nenhum produto cadastrado.</td></tr>';
  }
  const settingsRecent = document.getElementById('settingsRecentProductsTableBody');
  if (settingsRecent) settingsRecent.innerHTML = products.slice(-5).reverse().map(p=>{
    const _sn = _esc(p.name||'-'); const _sc = _esc(p.code||'-'); const _sb = _esc(p.barcode||'-'); const _scat = _esc(p.category||'-');
    return `<tr><td>${_sn}</td><td>${_sc}</td><td>${_sb}</td><td>${_scat}</td><td>${formatCurrency(Number(p.price||0))}</td><td>${formatCurrency(Number(p.cost||0))}</td><td>${Number(p.stock||0)}</td><td>${Number(p.minStock||0)}</td><td>25/04/2025</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="muted">Nenhum produto recente.</td></tr>';
  const catColors = { 'Bebidas':'#2563eb','Alimentos':'#22c55e','Papelaria':'#8b5cf6','Doces':'#f59e0b','Laticínios':'#06b6d4','Higiene':'#10b981','Eletrônicos':'#60a5fa','Salgadinhos':'#fb923c','Outros':'#64748b' };
  const alertHtml = [...low,...zero].slice(0,8).map(p => {
    const isZero = Number(p.stock||0) <= 0;
    const qty = Number(p.stock||0);
    const stockText = isZero ? '0 un. em estoque' : `${qty} un. restante${qty !== 1 ? 's' : ''}`;
    return `<div class="stock-alert-row">
      <svg class="prd-stk-warn" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span class="prd-stk-val">${_esc(p.name || '—')}</span>
      <span class="prd-stk-sub">• ${stockText}</span>
    </div>`;
  }).join('') || '<p class="mini">Nenhum alerta de estoque.</p>';
  const alerts = document.getElementById('stockLowAlertsPanel');
  if (alerts) alerts.innerHTML = alertHtml;
  const prodAlerts = document.getElementById('productAlertsContainer');
  if (prodAlerts) prodAlerts.innerHTML = alertHtml;
  const prodAlertsFooter = document.getElementById('productAlertsFooter');
  if (prodAlertsFooter) prodAlertsFooter.textContent = (low.length + zero.length) > 0 ? `${low.length + zero.length} produto(s) em alerta` : '';
  const top = document.getElementById('stockTopValueProducts');
  if (top) top.innerHTML = products.slice().sort((a,b)=>(Number(b.stock||0)*Number(b.cost||0))-(Number(a.stock||0)*Number(a.cost||0))).slice(0,5).map((p,i)=>`<div class="top-value-row"><span>${i+1}. ${_esc(p.name || '—')}</span><strong>${formatCurrency(Number(p.stock||0)*Number(p.cost||0))}</strong></div>`).join('') || '<p class="mini">Nenhum produto.</p>';
  const catMap = new Map();
  products.forEach(p => catMap.set(p.category||'Outros', (catMap.get(p.category||'Outros')||0) + Number(p.stock||0)*Number(p.cost||0)));
  const catEntries = Array.from(catMap.entries()).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const catTotal = catEntries.reduce((s,[,v])=>s+v,0);
  const catBox = document.getElementById('stockCategoryValues');
  if (catBox) {
    catBox.innerHTML = catEntries.map(([k,v])=>{
      const color = catColors[k]||'#64748b';
      const pct = catTotal ? ((v/catTotal)*100).toFixed(1) : '0';
      return `<div class="category-value-row"><span><span class="category-dot" data-cat-clr="${_esc(color)}"></span>${_esc(k)} ${pct}%</span><strong>${formatCurrency(v)}</strong></div>`;
    }).join('') || '<p class="mini">Sem categorias.</p>';
    catBox.querySelectorAll('.category-dot[data-cat-clr]').forEach(el => { el.style.setProperty('--cat-clr', el.dataset.catClr); });
  }
  const canvas = document.getElementById('stockCategoryChart');
  if (canvas && catEntries.length && typeof Chart !== 'undefined') {
    if (canvas._chartInstance) canvas._chartInstance.destroy();
    canvas._chartInstance = new Chart(canvas.getContext('2d'), {
      type:'doughnut',
      data:{
        labels: catEntries.map(([k])=>k),
        datasets:[{ data: catEntries.map(([,v])=>v), backgroundColor: catEntries.map(([k])=>catColors[k]||'#64748b'), borderWidth:0, hoverOffset:4 }]
      },
      options:{ cutout:'65%', plugins:{ legend:{display:false}, tooltip:{callbacks:{label:(c)=>`${c.label}: ${formatCurrency(c.raw)}`}}}, animation:{duration:400} }
    });
  }
}

/* ================= PERMISSIONS ================= */

export function applyProductPermissions() {
  const canEdit = canManageProducts();

  const saveBtn = document.getElementById('saveProductBtn');
  if (saveBtn) saveBtn.disabled = !canEdit;

  const clearBtn = document.getElementById('clearProductBtn');
  if (clearBtn) clearBtn.disabled = !canEdit;

  const removeBtn = document.getElementById('removeProductBtn');
  if (removeBtn) removeBtn.disabled = !canEdit;

  const removeBySelectBtn = document.getElementById('removeProductBySelectBtn');
  if (removeBySelectBtn) removeBySelectBtn.disabled = !canEdit;

  const removeSelectedBtn = document.getElementById('removeSelectedProductsBtn');
  if (removeSelectedBtn) removeSelectedBtn.disabled = !canEdit;

  const fields = [
    'productName',
    'productCode',
    'productBarcode',
    'productCategory',
    'productPrice',
    'productCost',
    'productStock',
    'productMinStock'
  ];

  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canEdit;
  });

  document
    .querySelectorAll('#removeProductsChecklist input[type="checkbox"]')
    .forEach((checkbox) => {
      checkbox.disabled = !canEdit;
    });
}

/* ================= SALE TYPE VISIBILITY ================= */

function _updateSaleTypeVisibility() {
  const saleType = document.getElementById('productSaleType')?.value ?? 'unit';
  const wrap = document.getElementById('productPricePerKgWrap');
  if (wrap) wrap.classList.toggle('hidden', saleType !== 'weight');
}

/* ================= BINDS ================= */

export function bindProductActions() {
  document.getElementById('saveProductBtn')?.addEventListener('click', addProduct);
  document.getElementById('productSaleType')?.addEventListener('change', _updateSaleTypeVisibility);

  // Stock filter bindings
  ['stockSearchInput','stockCategoryFilter','stockStatusFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => renderStockTable());
  });
  document.getElementById('stockLowOnlyToggle')?.addEventListener('change', () => renderStockTable());
  document.getElementById('stockNewProductBtn')?.addEventListener('click', () => {
    document.querySelector('[data-page="produtos"]')?.click();
  });

  document.getElementById('clearProductBtn')?.addEventListener('click', () => {
    clearProductForm();
    cancelProductEdit();
  });

  document.getElementById('cancelEditProductBtn')?.addEventListener('click', () => {
    clearProductForm();
    cancelProductEdit();
  });

  // Generate code buttons
  document.getElementById('generateCodeBtn')?.addEventListener('click', () => {
    const codeEl = document.getElementById('productCode');
    if (codeEl && !codeEl.value.trim()) {
      codeEl.value = generateNextCode();
    }
  });

  document.getElementById('autoGenerateCodeBtn')?.addEventListener('click', () => {
    const codeEl = document.getElementById('productCode');
    if (codeEl) codeEl.value = generateNextCode();
  });

  // Live profit/margin calc
  document.getElementById('productPrice')?.addEventListener('input', updateProductMarginCalc);
  document.getElementById('productCost')?.addEventListener('input', updateProductMarginCalc);

  // Image preview
  _bindImageInput();

  // Select all in remove checklist
  document.getElementById('selectAllProductsBtn')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#removeProductsChecklist input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      const row = cb.closest('.rpc-row');
      if (row) row.classList.toggle('rpc-row-checked', !allChecked);
    });
    _updateRemoveCountLabel();
  });

  // Search filter in remove panel
  document.getElementById('removeProductSearch')?.addEventListener('input', (e) => {
    renderRemoveProductsChecklist(e.target.value);
  });

  // Remove selected
  document.getElementById('removeSelectedProductsBtn')?.addEventListener('click', async () => {
    const checked = Array.from(
      document.querySelectorAll('#removeProductsChecklist input[type="checkbox"]:checked')
    );
    const codesToRemove = checked.map((item) => item.value);
    await removeMultipleProducts(codesToRemove);
  });

  document.getElementById('removeProductBySelectBtn')?.addEventListener('click', () => {
    const select = document.getElementById('removeProductSelect');
    const value = String(select?.value || '');

    if (value === '') {
      showToast('Selecione um produto para remover.', 'error');
      return;
    }

    const index = Number(value);

    if (Number.isNaN(index)) {
      showToast('Selecione um produto válido.', 'error');
      return;
    }

    removeProduct(index);
  });
}

/* ================= UTIL ================= */

export function clearProductForm() {
  [
    'productName',
    'productCode',
    'productBarcode',
    'productCategory',
    'productUnit',
    'productPrice',
    'productCost',
    'productStock',
    'productMinStock'
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') { el.selectedIndex = 0; }
    else { el.value = ''; }
  });

  const activeEl = document.getElementById('productActive');
  if (activeEl) activeEl.checked = true;
  const promoEl = document.getElementById('productPromotional');
  if (promoEl) promoEl.checked = false;

  const saleTypeEl = document.getElementById('productSaleType');
  if (saleTypeEl) saleTypeEl.value = 'unit';
  const pkgEl = document.getElementById('productPricePerKg');
  if (pkgEl) pkgEl.value = '';
  const fracEl = document.getElementById('productAllowFractional');
  if (fracEl) fracEl.checked = true;
  const perishableEl = document.getElementById('productIsPerishable');
  if (perishableEl) perishableEl.checked = false;
  _updateSaleTypeVisibility();

  _pendingImageData = '';
  _applyImagePreview('');
  updateProductMarginCalc();
}

export function cancelProductEdit() {
  editingProductCode = null;
}

/* ================= IMAGE PREVIEW ================= */

function _applyImagePreview(dataUrl) {
  const wrap = document.getElementById('productImagePreview');
  const img = document.getElementById('productImagePreviewImg');
  const label = document.getElementById('productImageLabel');

  if (!wrap) return;

  if (dataUrl) {
    if (img) { img.src = dataUrl; img.classList.remove('hidden'); }
    if (label) label.classList.add('hidden');
  } else {
    if (img) { img.src = ''; img.classList.add('hidden'); }
    if (label) label.classList.remove('hidden');
  }
}

function _compressImage(dataUrl, maxSide, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxSide || h > maxSide) {
        if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
        else { w = Math.round(w * maxSide / h); h = maxSide; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function _bindImageInput() {
  const input = document.getElementById('productImageInput');
  if (!input) return;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    // BUG CONFIRMADO: este limite (e o aviso na tela, ainda mais desatualizado
    // em "2MB") barrava o arquivo ORIGINAL antes de qualquer compressão — mas
    // _compressImage() já redimensiona para 480px no lado maior + qualidade
    // 0.72 antes de salvar, então o tamanho final em base64 depende quase só
    // do conteúdo da foto reduzida, não do arquivo de entrada. Medido: até
    // fotos "ruidosas" (pior caso) de 12MP (~11MB) e 48MP (~44MB) geram saída
    // comprimida de ~5-12 mil caracteres — muito abaixo do limite do backend
    // (imageUrl max 500_000). Fotos reais de celular comprimem ainda melhor.
    // 15MB no arquivo original é generoso o bastante pra cobrir qualquer foto
    // de celular moderna sem risco nenhum pro tamanho final salvo.
    if (file.size > 15 * 1024 * 1024) {
      showToast('Imagem muito grande. Máximo 15MB.', 'error');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      _pendingImageData = await _compressImage(e.target.result, 480, 0.72);
      _applyImagePreview(_pendingImageData);
    };
    reader.readAsDataURL(file);
  });
}

/* ================= PROFIT / MARGIN CALC ================= */

function updateProductMarginCalc() {
  const price = toNumber(document.getElementById('productPrice')?.value);
  const cost  = toNumber(document.getElementById('productCost')?.value);
  const profit = price - cost;
  const margin = price > 0 ? (profit / price) * 100 : 0;

  const profitEl  = document.getElementById('productLucroPreview');
  const marginEl  = document.getElementById('productMargemPreview');

  if (profitEl) {
    profitEl.textContent = formatCurrency(profit);
    profitEl.classList.toggle('is-profit', profit >= 0);
    profitEl.classList.toggle('is-loss', profit < 0);
  }
  if (marginEl) {
    marginEl.textContent = margin.toFixed(2).replace('.', ',') + '%';
    marginEl.classList.toggle('is-profit', margin >= 0);
    marginEl.classList.toggle('is-loss', margin < 0);
  }
}

window.updateProductMargin = updateProductMarginCalc;

/* ================= GENERATE CODE ================= */

function generateNextCode() {
  const codes = (state.products || [])
    .map(p => Number(p.code))
    .filter(n => Number.isFinite(n) && n > 0);

  return codes.length ? String(Math.max(...codes) + 1) : '1001';
}

/* ================= COUNT LABEL ================= */

function _updateRemoveCountLabel() {
  const label = document.getElementById('removeCountLabel');
  if (!label) return;

  const checked = document.querySelectorAll('#removeProductsChecklist input[type="checkbox"]:checked').length;

  if (checked > 0) {
    label.innerHTML =
      '<span class="prd-sel-count">' + checked + ' produto' + (checked > 1 ? 's' : '') + ' selecionado' + (checked > 1 ? 's' : '') + '</span>' +
      ' &nbsp;<button type="button" id="clearSelectionBtn" class="prd-clr-sel">Limpar seleção</button>';
    document.getElementById('clearSelectionBtn')?.addEventListener('click', function() {
      document.querySelectorAll('#removeProductsChecklist input[type="checkbox"]').forEach(function(cb) {
        cb.checked = false;
        const row = cb.closest('.rpc-row');
        if (row) row.classList.remove('rpc-row-checked');
      });
      _updateRemoveCountLabel();
    });
  } else {
    label.innerHTML = '';
  }
}

/* ================= INVENTORY ALERTS ================= */

export async function loadInventoryAlerts() {
  const panel  = document.getElementById('stockAlertPanel');
  const tbody  = document.getElementById('stockAlertTableBody');
  const badge  = document.getElementById('navEstoqueBadge');
  const banner = document.getElementById('dashStockAlertBanner');
  const bannerText = document.getElementById('dashStockAlertText');

  if (!isBackendReady()) return;

  try {
    const [summaryData, listData] = await Promise.all([
      getAlertSummaryService(),
      listAlertsService('open'),
    ]);

    const open = summaryData?.open || 0;

    // Nav badge
    if (badge) {
      badge.textContent = open > 0 ? String(open) : '';
      badge.hidden = open === 0;
    }

    // Dashboard banner
    if (banner) {
      if (open > 0) {
        banner.classList.remove('hidden');
        if (bannerText) bannerText.textContent = `${open} produto(s) com estoque abaixo do mínimo`;
      } else {
        banner.classList.add('hidden');
      }
    }

    // Estoque page panel
    if (panel) {
      if (open > 0) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    }

    // Table
    if (tbody) {
      const alerts = listData?.alerts || [];
      if (!alerts.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhum alerta de estoque crítico.</td></tr>';
      } else {
        tbody.innerHTML = alerts.map((a) => `
          <tr>
            <td>${_esc(a.productName)}</td>
            <td>${_esc(a.category || '—')}</td>
            <td><strong>${Number(a.currentStock).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></td>
            <td>${Number(a.minimumStock).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
            <td><span class="ia-badge open">Crítico</span></td>
            <td>
              <button class="btn-link resolve-alert-btn" data-alert-id="${_esc(a.id)}" type="button">Resolver</button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Bind resolve buttons
    document.querySelectorAll('.resolve-alert-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const alertId = btn.dataset.alertId;
        try {
          await resolveAlertService(alertId);
          await loadInventoryAlerts();
        } catch (err) {
          alert(err?.message || 'Erro ao resolver alerta.');
        }
      });
    });

  } catch {
    // Backend unavailable — silently skip
  }
}

export function bindInventoryAlertActions() {
  document.getElementById('checkAlertsNowBtn')?.addEventListener('click', async () => {
    try {
      await checkAlertsNowService();
      await loadInventoryAlerts();
    } catch (err) {
      alert(err?.message || 'Erro ao verificar alertas.');
    }
  });

  document.getElementById('dashStockAlertBtn')?.addEventListener('click', () => {
    window.openPageDirect?.('estoque');
  });
}

/* ================= EXPIRY REPORT / CONTROLE DE VALIDADE (B4 + Parte D) ================= */

const _SITUACAO_BADGE = {
  'Vencido':               'badge-critico',
  'Vence hoje':            'badge-critico',
  'Vence em até 7 dias':   'badge-importante',
  'Vence em até 15 dias':  'badge-importante',
  'Vence em até 30 dias':  'badge-informativo',
  'Em quarentena':         'badge-informativo',
  'Normal':                'badge-informativo',
};

// Parte J — faixa colorida na lateral da linha inteira, reforçando a
// hierarquia visual que o badge de Situação já dá (vencido é bem mais
// urgente que "vence em até 30 dias").
const _SITUACAO_ROW_CLASS = {
  'Vencido':               'expiry-row-critical',
  'Vence hoje':            'expiry-row-critical',
  'Vence em até 7 dias':   'expiry-row-warning',
  'Vence em até 15 dias':  'expiry-row-warning',
  'Em quarentena':         'expiry-row-muted',
};

function _daysLabel(days) {
  if (days < 0) return `Vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Vence hoje';
  return `Faltam ${days} dia${days === 1 ? '' : 's'}`;
}

// Parte E — ações por lote. As 4 marcadas "auditOnly" só registram a
// intenção (quantidade + justificativa) na auditoria: não existe motor de
// promoção/desconto nem conceito de unidade/filial no sistema hoje. As
// demais mexem de verdade no lote/estoque (ver product-batch-action.service.js).
const _ACOES_NAO_VENCIDO = [
  { key: 'promocao',            label: 'Criar promoção' },
  { key: 'desconto',             label: 'Aplicar desconto' },
  { key: 'priorizar_exposicao',  label: 'Priorizar exposição' },
  { key: 'devolucao',            label: 'Devolver ao fornecedor' },
  { key: 'transferencia',        label: 'Transferir para outra unidade' },
  { key: 'conferir_quantidade',  label: 'Conferir quantidade' },
];
const _ACOES_VENCIDO = [
  { key: 'descarte',            label: 'Registrar descarte' },
  { key: 'devolucao',           label: 'Registrar devolução ao fornecedor' },
  { key: 'quarentena',          label: 'Colocar lote em quarentena' },
  { key: 'corrigir_validade',   label: 'Corrigir a validade cadastrada' },
  { key: 'ajuste_estoque',      label: 'Realizar ajuste de estoque' },
];
const _ACAO_LABEL_BY_KEY = Object.fromEntries(
  [..._ACOES_NAO_VENCIDO, ..._ACOES_VENCIDO].map((a) => [a.key, a.label])
);

function _acoesDisponiveisPara(situacao) {
  if (situacao === 'Vencido' || situacao === 'Vence hoje') return _ACOES_VENCIDO;
  if (situacao === 'Em quarentena') return [];
  return _ACOES_NAO_VENCIDO;
}

function _expiryRow(entry) {
  const badgeClass = _SITUACAO_BADGE[entry.situacao] || 'badge-informativo';
  const rowClass = _SITUACAO_ROW_CLASS[entry.situacao] || '';
  const acoes = _acoesDisponiveisPara(entry.situacao);
  const selectHtml = acoes.length
    ? `<select class="field expiry-action-select" data-batch-id="${_esc(entry.batchId)}" data-product-name="${_esc(entry.productName)}">
        <option value="">Escolha uma ação...</option>
        ${acoes.map((a) => `<option value="${a.key}">${_esc(a.label)}</option>`).join('')}
      </select>`
    : '';
  // Parte G — conferência de estoque opera no produto inteiro (todos os
  // lotes), não só neste lote/situação, então fica disponível em toda linha
  // (inclusive lotes em quarentena, que não têm outras ações).
  const conferirBtn = `<button type="button" class="btn btn-ghost btn-xs expiry-conferir-btn" data-product-id="${_esc(entry.productId)}" data-product-name="${_esc(entry.productName)}">Conferir estoque</button>`;

  return `
    <tr data-batch-id="${_esc(entry.batchId)}" class="${rowClass}">
      <td class="expiry-product-cell" title="${_esc(entry.productName)}">${_esc(entry.productName)}</td>
      <td class="mono">${_esc(entry.batchId.slice(0, 8))}</td>
      <td>${Number(entry.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
      <td>${formatDateBR(entry.expiresAt)}</td>
      <td>${_daysLabel(entry.daysRemaining)}</td>
      <td>${formatCurrency(entry.costAtRisk)}</td>
      <td><span class="severity-badge ${badgeClass}">${_esc(entry.situacao)}</span></td>
      <td>${_esc(entry.lastMovementBy || '—')}</td>
      <td class="expiry-actions-cell"><div class="expiry-actions-group">${selectHtml}${conferirBtn}</div></td>
    </tr>
  `;
}

/* ---- Modal de ação de lote (quantidade + justificativa [+ nova validade]) ---- */

function _closeBatchActionModal() {
  document.getElementById('batchActionOverlay')?.remove();
}

function _openBatchActionModal(batchId, productName, actionKey) {
  _closeBatchActionModal();

  const label = _ACAO_LABEL_BY_KEY[actionKey] || actionKey;
  const needsDate = actionKey === 'corrigir_validade';

  const overlay = document.createElement('div');
  overlay.id = 'batchActionOverlay';
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal pdv-exit-modal">
      <h3 class="cs-modal-title">${_esc(label)}</h3>
      <p class="mini cs-modal-sub"><strong>${_esc(productName)}</strong> — lote ${_esc(batchId.slice(0, 8))}</p>
      <div class="field-group">
        <label for="batchActionQuantity">Quantidade</label>
        <input id="batchActionQuantity" class="field" type="number" min="0" step="0.001" placeholder="0" />
      </div>
      ${needsDate ? `
      <div class="field-group">
        <label for="batchActionNewDate">Nova data de validade</label>
        <input id="batchActionNewDate" class="field" type="date" />
      </div>` : ''}
      <div class="field-group">
        <label for="batchActionJustification">Justificativa</label>
        <textarea id="batchActionJustification" class="field" rows="3" placeholder="Explique o motivo desta ação..."></textarea>
      </div>
      <div id="batchActionError" class="auth-status hidden"></div>
      <div class="hero-actions compact cs-modal-acts">
        <button id="batchActionCancelBtn" class="btn btn-ghost" type="button">Cancelar</button>
        <button id="batchActionConfirmBtn" class="btn btn-primary" type="button">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('batchActionCancelBtn')?.addEventListener('click', _closeBatchActionModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeBatchActionModal(); });

  document.getElementById('batchActionConfirmBtn')?.addEventListener('click', async () => {
    const errorEl = document.getElementById('batchActionError');
    const quantity = Number(document.getElementById('batchActionQuantity')?.value || 0);
    const justification = String(document.getElementById('batchActionJustification')?.value || '').trim();
    const newExpiresAt = needsDate ? document.getElementById('batchActionNewDate')?.value : undefined;

    if (justification.length < 3) {
      if (errorEl) { errorEl.textContent = 'Justificativa é obrigatória (mínimo 3 caracteres).'; errorEl.classList.remove('hidden'); }
      return;
    }
    if (needsDate && !newExpiresAt) {
      if (errorEl) { errorEl.textContent = 'Informe a nova data de validade.'; errorEl.classList.remove('hidden'); }
      return;
    }

    try {
      await performBatchActionService(batchId, { action: actionKey, quantity, justification, newExpiresAt });
      _closeBatchActionModal();
      await loadExpiryReport();
      await initProducts(); // estoque pode ter mudado (descarte/devolução/ajuste)
    } catch (err) {
      if (errorEl) { errorEl.textContent = err?.message || 'Erro ao registrar ação.'; errorEl.classList.remove('hidden'); }
    }
  });
}

/* ---- Modal de conferência de estoque por produto (Parte G) ---- */

let _verifyProductId = null;
let _verifyProductName = null;
let _verifyRows = []; // [{ batchId: string|null, quantity: number, expiresAt: 'YYYY-MM-DD', quarantined: boolean }]
let _verifyRowSeq = 0;

function _closeBatchVerifyModal() {
  document.getElementById('batchVerifyOverlay')?.remove();
  _verifyProductId = null;
  _verifyProductName = null;
  _verifyRows = [];
}

function _toDateInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function _verifyRowHtml(row) {
  return `
    <div class="batch-verify-row" data-row-id="${row._id}">
      <div class="field-group">
        <label>Quantidade</label>
        <input type="number" class="field batch-verify-qty" min="0" step="0.001" value="${_esc(String(row.quantity))}" />
      </div>
      <div class="field-group">
        <label>Validade</label>
        <input type="date" class="field batch-verify-date" value="${_esc(row.expiresAt)}" />
      </div>
      <div class="batch-verify-row-meta">
        ${row.quarantined ? '<span class="severity-badge badge-informativo">Em quarentena</span>' : ''}
        ${row.batchId ? '' : '<span class="severity-badge badge-informativo">Novo (divisão)</span>'}
      </div>
      <div class="batch-verify-row-actions">
        <button type="button" class="btn btn-ghost btn-xs batch-verify-split-btn" title="Dividir este lote em dois, com validades diferentes">Dividir</button>
        <button type="button" class="btn btn-ghost btn-xs batch-verify-remove-btn" title="Remover — contagem física não encontrou este lote">Remover</button>
      </div>
    </div>
  `;
}

function _renderVerifyRows() {
  const container = document.getElementById('batchVerifyRows');
  if (!container) return;
  container.innerHTML = _verifyRows.length
    ? _verifyRows.map(_verifyRowHtml).join('')
    : '<p class="mini empty-row">Nenhum lote — use "Adicionar lote" para registrar o que a contagem física encontrou.</p>';
  _updateVerifyTotal();
}

function _updateVerifyTotal() {
  const totalEl = document.getElementById('batchVerifyTotal');
  if (!totalEl) return;
  const total = _verifyRows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
  totalEl.textContent = total.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

async function _openBatchVerifyModal(productId, productName) {
  _closeBatchVerifyModal();
  _verifyProductId = productId;
  _verifyProductName = productName;

  const overlay = document.createElement('div');
  overlay.id = 'batchVerifyOverlay';
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal pdv-exit-modal batch-verify-modal">
      <h3 class="cs-modal-title">Conferir estoque</h3>
      <p class="mini cs-modal-sub"><strong>${_esc(productName)}</strong> — confirme ou corrija a quantidade e a validade de cada lote. Divida um lote se ele tiver validades diferentes misturadas.</p>
      <div id="batchVerifyRows" class="batch-verify-rows"><p class="mini">Carregando lotes...</p></div>
      <button type="button" id="batchVerifyAddBtn" class="btn btn-ghost btn-xs">+ Adicionar lote</button>
      <p class="mini">Total informado: <strong id="batchVerifyTotal">0</strong> unidade(s)</p>
      <div class="field-group">
        <label for="batchVerifyNotes">Observação (opcional)</label>
        <textarea id="batchVerifyNotes" class="field" rows="2" placeholder="Ex.: contagem física de estoque de 26/07..."></textarea>
      </div>
      <div id="batchVerifyError" class="auth-status hidden"></div>
      <div class="hero-actions compact cs-modal-acts">
        <button id="batchVerifyCancelBtn" class="btn btn-ghost" type="button">Cancelar</button>
        <button id="batchVerifyConfirmBtn" class="btn btn-primary" type="button">Confirmar conferência</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('batchVerifyCancelBtn')?.addEventListener('click', _closeBatchVerifyModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeBatchVerifyModal(); });

  document.getElementById('batchVerifyAddBtn')?.addEventListener('click', () => {
    _verifyRows.push({ batchId: null, quantity: 0, expiresAt: '', quarantined: false, _id: ++_verifyRowSeq });
    _renderVerifyRows();
  });

  // Delegado — as linhas são recriadas a cada Dividir/Remover/Adicionar.
  const rowsContainer = document.getElementById('batchVerifyRows');
  rowsContainer?.addEventListener('input', (e) => {
    const rowEl = e.target.closest('.batch-verify-row');
    if (!rowEl) return;
    const row = _verifyRows.find((r) => String(r._id) === rowEl.dataset.rowId);
    if (!row) return;
    if (e.target.classList.contains('batch-verify-qty')) {
      row.quantity = Number(e.target.value) || 0;
      _updateVerifyTotal();
    } else if (e.target.classList.contains('batch-verify-date')) {
      row.expiresAt = e.target.value;
    }
  });

  rowsContainer?.addEventListener('click', (e) => {
    const rowEl = e.target.closest('.batch-verify-row');
    if (!rowEl) return;
    const idx = _verifyRows.findIndex((r) => String(r._id) === rowEl.dataset.rowId);
    if (idx === -1) return;

    if (e.target.classList.contains('batch-verify-remove-btn')) {
      _verifyRows.splice(idx, 1);
      _renderVerifyRows();
    } else if (e.target.classList.contains('batch-verify-split-btn')) {
      const original = _verifyRows[idx];
      _verifyRows.splice(idx + 1, 0, { batchId: null, quantity: 0, expiresAt: original.expiresAt, quarantined: false, _id: ++_verifyRowSeq });
      _renderVerifyRows();
    }
  });

  document.getElementById('batchVerifyConfirmBtn')?.addEventListener('click', async () => {
    const errorEl = document.getElementById('batchVerifyError');
    const notes = String(document.getElementById('batchVerifyNotes')?.value || '').trim();

    for (const row of _verifyRows) {
      if (!(row.quantity >= 0)) {
        if (errorEl) { errorEl.textContent = 'Quantidade inválida em um dos lotes.'; errorEl.classList.remove('hidden'); }
        return;
      }
      if (!row.expiresAt) {
        if (errorEl) { errorEl.textContent = 'Informe a validade de todos os lotes.'; errorEl.classList.remove('hidden'); }
        return;
      }
    }

    try {
      await verifyProductBatchesService(_verifyProductId, {
        batches: _verifyRows.map((r) => ({ batchId: r.batchId, quantity: r.quantity, expiresAt: r.expiresAt })),
        notes: notes || undefined
      });
      _closeBatchVerifyModal();
      await loadExpiryReport();
      await initProducts(); // estoque pode ter mudado (correção de quantidade)
    } catch (err) {
      if (errorEl) { errorEl.textContent = err?.message || 'Erro ao registrar conferência.'; errorEl.classList.remove('hidden'); }
    }
  });

  try {
    const batches = await listProductBatchesService(productId);
    _verifyRows = (batches || []).map((b) => ({
      batchId: b.id,
      quantity: Number(b.quantity),
      expiresAt: _toDateInputValue(b.expiresAt),
      quarantined: Boolean(b.quarantinedAt),
      _id: ++_verifyRowSeq
    }));
    _renderVerifyRows();
  } catch (err) {
    const container = document.getElementById('batchVerifyRows');
    if (container) container.innerHTML = `<p class="mini">Erro ao carregar lotes: ${_esc(err?.message || '')}</p>`;
  }
}

// Clicar numa notificação de validade (sino, Parte I) grava o batchId aqui
// antes de navegar pra Estoque — assim que a tabela terminar de renderizar,
// rola até o lote e pisca um destaque nele, em vez de só abrir a página
// genericamente (mesma ideia do link do Dashboard, Parte C, só que apontando
// pro lote exato em vez do painel inteiro).
function _highlightPendingExpiryBatch(tableBody) {
  const batchId = window.__pendingExpiryHighlightBatchId;
  if (!batchId) return;
  window.__pendingExpiryHighlightBatchId = null;

  const row = tableBody.querySelector(`tr[data-batch-id="${CSS.escape(batchId)}"]`);
  if (!row) return;

  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('row-highlight-flash');
  setTimeout(() => row.classList.remove('row-highlight-flash'), 2600);
}

export async function loadExpiryReport(withinDays = 30) {
  const panel      = document.getElementById('expiryReportPanel');
  const tableBody  = document.getElementById('expiryReportTableBody');
  const dashBanner = document.getElementById('dashExpiryAlertBanner');
  const dashText   = document.getElementById('dashExpiryAlertText');

  if (!isBackendReady()) return;

  try {
    const report = await getExpiryReportService(withinDays);
    const all = report?.all || [];
    const expired = report?.expired || [];

    // Painel fica visível mesmo vazio, mostrando "Nenhum lote..." em vez de
    // sumir da tela.
    if (panel) panel.classList.remove('hidden');

    if (tableBody) {
      tableBody.innerHTML = all.length
        ? all.map(_expiryRow).join('')
        : `<tr><td colspan="9" class="empty-row">Nenhum lote nos próximos ${withinDays} dias.</td></tr>`;
      _highlightPendingExpiryBatch(tableBody);
    }

    // Destaque no Dashboard — some sozinho assim que não há mais lote
    // vencido pendente (resolvido via ação em Estoque > Controle de
    // Validade, Parte E deste round).
    if (dashBanner) {
      if (expired.length > 0) {
        dashBanner.classList.remove('hidden');
        if (dashText) {
          const names = [...new Set(expired.map((e) => e.productName))];
          const label = names.length === 1 ? names[0] : `${names.length} produtos`;
          dashText.textContent = expired.length === 1
            ? `${label} com lote vencido`
            : `${label} com ${expired.length} lotes vencidos`;
        }
      } else {
        dashBanner.classList.add('hidden');
      }
    }
  } catch (error) {
    console.warn('Erro ao carregar relatório de validade:', error);
  }
}

export function bindExpiryReportActions() {
  document.getElementById('expiryReportRangeSelect')?.addEventListener('change', (e) => {
    loadExpiryReport(Number(e.target.value) || 30);
  });

  document.getElementById('dashExpiryAlertBtn')?.addEventListener('click', () => {
    window.openPageDirect?.('estoque');
  });

  // Delegado no tbody — as linhas (e os <select> de ação) são recriadas a
  // cada loadExpiryReport(), então o listener precisa estar num ancestral
  // estável em vez de em cada <select> individualmente.
  document.getElementById('expiryReportTableBody')?.addEventListener('change', (e) => {
    const select = e.target.closest('.expiry-action-select');
    if (!select || !select.value) return;

    const batchId = select.dataset.batchId;
    const productName = select.dataset.productName;
    const actionKey = select.value;
    select.value = ''; // volta ao placeholder — a ação real só acontece após confirmar no modal

    _openBatchActionModal(batchId, productName, actionKey);
  });

  document.getElementById('expiryReportTableBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.expiry-conferir-btn');
    if (!btn) return;
    _openBatchVerifyModal(btn.dataset.productId, btn.dataset.productName);
  });
}
