import { state } from './state.js';
import { closeCashSession } from './cash-session.js';
import { formatCurrency } from './utils.js';
import { addHistory } from './history.js';
import { api } from './api.js';
import { requireOperatorSession, requirePDVOperatorSession } from './operator-session.js';
import { audit } from './audit-service.js';
import { clearActiveProfile, showProfileSelector } from './profile-selector.js';

import {
  createSaleService,
  cancelSaleService,
  loadSales,
  normalizePaymentMethod
} from './services/sales-service.js';
import { getScaleConfigService } from './services/scale-service.js';
import { createSingleFlight } from './single-flight.js';
import { decideSearch, rankProducts, nextHighlight, productThumb, looksLikeBarcode } from './product-search.js';

/* ── scale config cache ── */
let _scaleConfig = null;

async function _loadScaleConfig() {
  try {
    _scaleConfig = await getScaleConfigService();
  } catch (_) {
    _scaleConfig = null;
  }
}

function _parseScaleBarcode(barcode) {
  const cfg = _scaleConfig;
  if (!cfg?.enabled || cfg.connectionType !== 'barcode_label') return null;

  const digits  = onlyDigits(barcode);
  const prefix  = String(cfg.barcodePrefix ?? '2');
  if (!digits.startsWith(prefix) || digits.length < 8) return null;

  const pStart  = Number(cfg.productCodeStart  ?? 1);
  const pLen    = Number(cfg.productCodeLength  ?? 5);
  const wStart  = Number(cfg.weightStart        ?? 6);
  const wLen    = Number(cfg.weightLength       ?? 5);
  const decimal = Number(cfg.decimalPlaces      ?? 3);

  const productCode  = digits.substring(pStart, pStart + pLen);
  const weightDigits = digits.substring(wStart, wStart + wLen);

  if (!productCode || !weightDigits) return null;
  const weight = parseInt(weightDigits, 10) / Math.pow(10, decimal);
  if (isNaN(weight) || weight <= 0) return null;

  return { productCode, weight };
}

/* ================= SECURITY + AVATAR HELPERS ================= */

function _esc(v) {
  return String(v || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function _pdvAv(name, role) {
  if (typeof window.renderUserAvatar !== 'function' || !name || name === '—') return '';
  const users = Array.isArray(state?.internalUsers) ? state.internalUsers : [];
  const u = users.find(u => (u.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return window.renderUserAvatar(
    { name, photoUrl: u?.photoUrl || window.getUserAvatar?.(name) || null, role: role || u?.role || '' },
    { cls: 'av', size: 'sm' }
  );
}

let cart = [];
let pdvActionsBound = false;
let kioskGuardBound = false;
let paymentPollingTimer = null;
let installmentInfo = null;
let pdvPaymentDiscount = 0;
let pdvCardMachineInfo = null;
let currentSaleCustomer = null; // { name, cpf, phone }

/* ================= HELPERS ================= */

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

function getCartTableBody() { return document.getElementById('cartTableBody'); }
function getRecentSalesWrap() { return document.getElementById('recentSalesTableBody'); }
function getTotalEl() { return document.getElementById('pdvTotal'); }
function getItemsEl() { return document.getElementById('pdvSummaryQuantity'); }
function getDiscountEl() { return document.getElementById('pdvSummaryDiscount'); }
function getCartCardsList() { return document.getElementById('cartCardsList'); }
function getUnitPriceEl() { return document.getElementById('pdvSummaryUnitPrice'); }
function getAmountPaidEl() { return document.getElementById('amountPaid'); }
function getChangeEl() { return document.getElementById('changePreview'); }
function getSearchField() { return document.getElementById('saleProductCode'); }
function getQuantityField() { return document.getElementById('saleQuantity'); }
function getPaymentMethodField() { return document.getElementById('salePaymentMethod'); }
function getMercadoPagoBox() { return document.getElementById('pdvMercadoPagoBox'); }
function getMercadoPagoStatusEl() { return document.getElementById('pdvMercadoPagoStatus'); }
function getMercadoPagoQrWrap() { return document.getElementById('pdvMercadoPagoQrWrap'); }
function getMercadoPagoQrImage() { return document.getElementById('pdvMercadoPagoQrImage'); }
function getMercadoPagoCopyCode() { return document.getElementById('pdvMercadoPagoCopyCode'); }

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function focusPDVInput() {
  const input = getSearchField();
  if (!input) return;

  setTimeout(() => {
    // BUG CONFIRMADO: openPageDirect('pdv') já agenda initSales() (que chama
    // esta função) 80ms após navegar, e initSales() some mais 80ms aqui —
    // esse foco atrasado (~160ms) chegava DEPOIS do modal de senha admin
    // (openSecureCashCloseModal, focado via requestAnimationFrame, ~16ms)
    // já ter focado seu próprio campo, roubando o foco de volta para a busca
    // do PDV assim que o operador começava a digitar a senha. Não é um caso
    // de propagação de teclado (já bloqueada por stopPropagation no input do
    // modal) — é uma chamada .focus() de um timer independente. Não roubar
    // foco de nenhum modal aberto (todos usam a classe .overlay).
    if (document.querySelector('.overlay')) return;
    input.focus();
    input.select?.();
  }, 80);
}

function getCartSubtotal() {
  return cart.reduce((acc, item) => acc + Number(item.total || 0), 0);
}

function getEffectivePDVTotal() {
  return Math.max(0, getCartSubtotal() - pdvPaymentDiscount);
}

function getCartDiscountTotal() {
  return cart.reduce((acc, item) => acc + Number(item.discount || 0), 0);
}

function getCartItemsCount() {
  return cart.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
}

function getLastAddedItem() {
  return cart.length ? cart[cart.length - 1] : null;
}

function getCurrentCashOperator() {
  const session = state.cashSession || {};

  return (
    state.currentOperator ||
    session.operator ||
    {
      id: session.operatorId || state.currentUser?.id || null,
      name: session.operatorName || state.currentUser?.name || '',
      cpf: session.operatorCpf || state.currentUser?.cpf || '',
      controlPin: session.operatorPin || state.currentUser?.controlPin || ''
    }
  );
}

function getCurrentTerminalName() {
  return (
    state.currentOperator?.terminalName ||
    state.cashSession?.terminalName ||
    state.currentUser?.terminalName ||
    'Caixa principal'
  );
}

function isCashOpen() {
  return Boolean(state.cashSession?.isOpen);
}

function persistCurrentPage() {
  if (isPDVPageActive()) {
    localStorage.setItem('gamby_current_page', 'pdv');
    localStorage.setItem('gamby_last_page', 'pdv');
    _saveKioskState();
  }
}

function isPDVPageActive() {
  // localStorage é atualizado por openPageDirect e setActivePage — fonte primária
  if (localStorage.getItem('gamby_current_page') === 'pdv') return true;
  // Fallback: verificar DOM (cobre casos de recarga sem persistência)
  const pdvPage = document.querySelector('[data-page-content="pdv"]');
  return Boolean(
    pdvPage &&
    !pdvPage.classList.contains('hidden') &&
    pdvPage.style.display !== 'none'
  );
}

// Kiosk ativo quando: PDV visível E (caixa aberto OU operador autenticado OU modo controlado)
function isKioskActive() {
  if (!isPDVPageActive()) return false;
  const cashOpen     = Boolean(state.cashSession?.isOpen);
  const opAuth       = Boolean(state.operatorPinValidated) || Boolean(state.currentOperator?.name);
  const controlled   = !isSimplifiedMode();
  return cashOpen || opAuth || controlled;
}

function _updateKioskDebug(extra = {}) {
  const cashOpen   = Boolean(state.cashSession?.isOpen);
  const opAuth     = Boolean(state.operatorPinValidated) || Boolean(state.currentOperator?.name);
  const prev       = window._kioskDebug || {};
  window._kioskDebug = {
    kioskActive:          isKioskActive(),
    cashOpen,
    operatorAuthenticated: opAuth,
    adminAuthRequested:   Boolean(prev.adminAuthRequested || extra.adminAuthRequested),
    adminAuthGranted:     Boolean(prev.adminAuthGranted   || extra.adminAuthGranted),
    navigationBlocked:    Boolean(prev.navigationBlocked  || extra.navigationBlocked),
    logoutBlocked:        Boolean(prev.logoutBlocked      || extra.logoutBlocked),
    sidebarBlocked:       Boolean(prev.sidebarBlocked     || extra.sidebarBlocked),
    lastBlockedAction:    extra.lastBlockedAction || prev.lastBlockedAction || null,
    timestamp:            new Date().toISOString(),
  };
}

const _KIOSK_STATE_KEY     = 'gamby_kiosk_state';
const _KIOSK_CART_KEY      = 'gamby_kiosk_cart';
const _KIOSK_STATE_TTL     = 30 * 60 * 1000; // 30 min
const _SUSPENDED_SALES_KEY = 'gamby_suspended_sales';

function _saveKioskState() {
  if (!isPDVPageActive()) return;
  try {
    const data = {
      operatorPinValidated: Boolean(state.operatorPinValidated),
      operatorName:  state.currentOperator?.name || '',
      cashOpen:      Boolean(state.cashSession?.isOpen),
      cashId:        state.cashSession?.id || state.cashSession?.sessionId || '',
      paymentMethod: getPaymentMethodField()?.value || '',
      amountPaid:    getAmountPaidEl()?.value || '',
      savedAt:       Date.now(),
    };
    localStorage.setItem(_KIOSK_STATE_KEY, JSON.stringify(data));
    if (Array.isArray(cart) && cart.length > 0) {
      localStorage.setItem(_KIOSK_CART_KEY, JSON.stringify(cart));
    } else {
      localStorage.removeItem(_KIOSK_CART_KEY);
    }
  } catch {}
}

function _restoreKioskState() {
  try {
    const raw = localStorage.getItem(_KIOSK_STATE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if ((Date.now() - data.savedAt) > _KIOSK_STATE_TTL) {
      localStorage.removeItem(_KIOSK_STATE_KEY);
      localStorage.removeItem(_KIOSK_CART_KEY);
      return false;
    }
    const sameCash     = data.cashId && data.cashId === (state.cashSession?.id || state.cashSession?.sessionId || '');
    const cashStillOpen = Boolean(state.cashSession?.isOpen);

    if (data.operatorPinValidated && cashStillOpen && sameCash) {
      state.operatorPinValidated = true;
    }

    if (cashStillOpen && sameCash && (!Array.isArray(cart) || cart.length === 0)) {
      const cartRaw = localStorage.getItem(_KIOSK_CART_KEY);
      if (cartRaw) {
        const savedCart = JSON.parse(cartRaw);
        if (Array.isArray(savedCart) && savedCart.length > 0) {
          cart.push(...savedCart);
        }
      }
      // Restaurar forma de pagamento e valor pago após DOM pronto
      if (data.paymentMethod || data.amountPaid) {
        setTimeout(() => {
          const pmField = getPaymentMethodField();
          if (pmField && data.paymentMethod) {
            pmField.value = data.paymentMethod;
            pmField.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const apEl = getAmountPaidEl();
          if (apEl && data.amountPaid) {
            apEl.value = data.amountPaid;
            apEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 150);
      }
    }
    return true;
  } catch {
    return false;
  }
}


function isMoneyMethod() {
  const method = String(getPaymentMethodField()?.value || '').trim().toLowerCase();
  return method === 'dinheiro' || method === 'cash';
}

function isMercadoPagoPDVMethod() {
  const method = String(getPaymentMethodField()?.value || '').trim().toLowerCase();

  return (
    method === 'pix' ||
    method === 'boleto' ||
    method === 'mercado pago qr' ||
    method === 'mercado pago point' ||
    method === 'cartão mp' ||
    method === 'cartao mp'
  );
}

function normalizeGatewayPaymentMethod() {
  const method = String(getPaymentMethodField()?.value || '').trim().toLowerCase();

  if (method === 'pix') return 'pix';
  if (method === 'boleto') return 'boleto';
  if (method === 'mercado pago qr') return 'pix';
  if (method === 'mercado pago point') return 'card';
  if (method === 'cartão mp' || method === 'cartao mp') return 'card';
  if (method === 'cartão' || method === 'cartao') return 'card';

  return method || 'cash';
}

function getReadablePaymentMethod() {
  return String(getPaymentMethodField()?.value || 'Dinheiro').trim();
}

function isCardMethod() {
  const m = String(getPaymentMethodField()?.value || '').trim().toLowerCase();
  return m === 'cartão' || m === 'cartao';
}

function isPixMethod() {
  const m = String(getPaymentMethodField()?.value || '').trim().toLowerCase();
  return m === 'pix';
}

function getPaymentSettings() {
  return state.paymentSettings || {};
}

function getEnabledCardMachines() {
  const machines = getPaymentSettings().cardMachines || [];
  return machines.filter((m) => m.enabled !== false);
}

function populateCardMachineSelect() {
  const sel = document.getElementById('pdvCardMachineSelect');
  if (!sel) return;
  const machines = getEnabledCardMachines();
  const defaultId = getPaymentSettings().defaultCardMachine || (machines[0]?.id || '');
  sel.innerHTML = machines.map((m) => `<option value="${_esc(m.id)}" ${m.id === defaultId ? 'selected' : ''}>${_esc(m.name)}</option>`).join('');
}

function refreshCardFeeInfo() {
  const sel = document.getElementById('pdvCardMachineSelect');
  const modeSel = document.getElementById('pdvCardModeSelect');
  const rateEl = document.getElementById('pdvFeeRate');
  const netEl = document.getElementById('pdvFeeNet');
  if (!sel || !modeSel) return;

  const machines = getEnabledCardMachines();
  const machine = machines.find((m) => m.id === sel.value) || machines[0];
  const mode = modeSel.value || 'debito';
  const rate = machine ? (Number(machine[mode]) || 0) : 0;
  const subtotal = getCartSubtotal();
  const net = subtotal * (1 - rate / 100);

  if (rateEl) rateEl.textContent = `${rate.toFixed(2)}%`;
  if (netEl) netEl.textContent = formatCurrency(net);

  pdvCardMachineInfo = machine ? { name: machine.name, mode, rate, net } : null;
}

function applyPaymentMethodBenefits() {
  const cardBox = document.getElementById('pdvCardMachineBox');
  const discountBox = document.getElementById('pdvPayDiscountBox');
  const discountText = document.getElementById('pdvPayDiscountText');
  const totalOrigEl = document.getElementById('pdvTotalOriginal');

  pdvPaymentDiscount = 0;
  pdvCardMachineInfo = null;

  const isCard = isCardMethod();
  const isPix = isPixMethod();
  const isCash = isMoneyMethod();
  const ps = getPaymentSettings();

  if (cardBox) cardBox.classList.toggle('hidden', !isCard);
  if (discountBox) discountBox.classList.add('hidden');
  if (totalOrigEl) totalOrigEl.classList.add('hidden');

  if (isCard) {
    populateCardMachineSelect();
    refreshCardFeeInfo();
    return;
  }

  let discountEnabled = false;
  let discountMode = 'percent';
  let discountValue = 0;

  if (isCash && ps.cashDiscountEnabled) {
    discountEnabled = true;
    discountMode = ps.cashDiscountMode || 'percent';
    discountValue = Number(ps.cashDiscountValue) || 0;
  } else if (isPix && ps.pixDiscountEnabled) {
    discountEnabled = true;
    discountMode = ps.pixDiscountMode || 'percent';
    discountValue = Number(ps.pixDiscountValue) || 0;
  }

  if (discountEnabled && discountValue > 0) {
    const subtotal = getCartSubtotal();
    if (discountMode === 'percent') {
      pdvPaymentDiscount = subtotal * (discountValue / 100);
    } else {
      pdvPaymentDiscount = Math.min(discountValue, subtotal);
    }

    if (pdvPaymentDiscount > 0) {
      const label = discountMode === 'percent'
        ? `Desconto ${isCash ? 'dinheiro' : 'PIX'}: ${discountValue}%`
        : `Desconto ${isCash ? 'dinheiro' : 'PIX'}: ${formatCurrency(discountValue)}`;
      if (discountText) discountText.textContent = `${label} (-${formatCurrency(pdvPaymentDiscount)})`;
      if (discountBox) discountBox.classList.remove('hidden');
      if (totalOrigEl) {
        totalOrigEl.textContent = formatCurrency(subtotal);
        totalOrigEl.classList.remove('hidden');
      }
    }
  }
}

/* ================= SUMMARY / RENDER ================= */

function updateSummary() {
  const subtotal = getCartSubtotal();
  const discount = getCartDiscountTotal();
  const items = getCartItemsCount();
  const lastItem = getLastAddedItem();

  const itemsEl = getItemsEl();
  const unitPriceEl = getUnitPriceEl();
  const discountEl = getDiscountEl();
  const totalEl = getTotalEl();

  if (itemsEl) itemsEl.textContent = String(items || 0);
  if (unitPriceEl) unitPriceEl.textContent = lastItem ? formatCurrency(lastItem.price) : formatCurrency(0);
  if (discountEl) discountEl.textContent = formatCurrency(discount);
  if (totalEl) totalEl.textContent = formatCurrency(getEffectivePDVTotal());

  if (isCardMethod()) refreshCardFeeInfo();

  updateChangePreview();
}

function renderCartCards() {
  const list = getCartCardsList();
  if (!list) return;

  if (!cart.length) {
    list.innerHTML = `<div class="pdv-empty-card">Nenhum item na venda.</div>`;
    return;
  }

  list.innerHTML = cart.map((item, index) => `
    <div class="pdv-cart-card">
      <div class="pdv-cart-card-title">${_esc(item.name)}</div>
      <div class="pdv-cart-card-subtitle">
        Qtd: ${item.quantity} • Unitário: ${formatCurrency(item.price)}
      </div>
      <div class="pdv-cart-card-subtitle pdv-cart-sub-mt">
        Total: ${formatCurrency(item.total)}
      </div>
      <div class="pdv-cart-disc-mt">
        <button
          class="btn btn-danger pdv-remove-btn"
          data-remove-cart-index="${index}"
          type="button"
        >
          Remover
        </button>
      </div>
    </div>
  `).join('');
}

function renderCartTable() {
  const tbody = getCartTableBody();
  if (!tbody) return;

  if (!cart.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="pdv-empty-row">Nenhum item na venda.</td></tr>`;
    return;
  }

  tbody.innerHTML = cart.map((item, index) => {
    const _initial = (item.name || '?')[0].toUpperCase();
    const imgHtml = item.imageUrl
      ? `<img src="${_esc(item.imageUrl)}" alt="${_esc(item.name)}" class="pdv-thumb-img">`
      : `<div class="pdv-thumb-fb">${_initial}</div>`;

    return `
      <tr>
        <td class="pdv-cell-img">${imgHtml}</td>
        <td class="pdv-cell-name">
          <strong>${_esc(item.name)}</strong>
          ${item.code ? `<span>Cód: ${_esc(item.code)}</span>` : ''}
        </td>
        <td class="pdv-cell-qty">
          <div class="pdv-qty-ctrl">
            <button class="pdv-qty-ctrl-btn" data-dec-cart-index="${index}" type="button" title="Diminuir" aria-label="Diminuir quantidade">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <span>${item.quantity}</span>
            <button class="pdv-qty-ctrl-btn" data-inc-cart-index="${index}" type="button" title="Aumentar" aria-label="Aumentar quantidade">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </td>
        <td class="pdv-cell-price">${formatCurrency(item.price)}</td>
        <td class="pdv-cell-total">${formatCurrency(item.total)}</td>
        <td>
          <button class="pdv-rm-btn" data-remove-cart-index="${index}" title="Remover item" aria-label="Remover item do carrinho" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderCart() {
  renderCartTable();
  renderCartCards();
  applyPaymentMethodBenefits();
  updateSummary();
  _saveKioskState();
}

function clearCurrentSale() {
  cart = [];
  installmentInfo = null;
  pdvPaymentDiscount = 0;
  pdvCardMachineInfo = null;

  const cardBox = document.getElementById('pdvCardMachineBox');
  const discountBox = document.getElementById('pdvPayDiscountBox');
  const totalOrigEl = document.getElementById('pdvTotalOriginal');
  if (cardBox) cardBox.classList.add('hidden');
  if (discountBox) discountBox.classList.add('hidden');
  if (totalOrigEl) totalOrigEl.classList.add('hidden');

  stopPaymentPolling();
  renderCart();

  const searchField = getSearchField();
  if (searchField) searchField.value = '';
  _pdvCloseSearchDropdown();

  const quantityField = getQuantityField();
  if (quantityField) quantityField.value = 1;

  const amountPaid = getAmountPaidEl();
  if (amountPaid) amountPaid.value = '';

  const paySelect = getPaymentMethodField();
  if (paySelect) paySelect.value = '';

  clearMercadoPagoUI();
  updateChangePreview();
  currentSaleCustomer = null;
  _pdvUpdateClientDisplay();
  focusPDVInput();
}

/* ================= BUSCA DE PRODUTO — LISTA COMPACTA ================= */

// A decisão (barcode > SKU > nome exato > começa com > contém) vive em
// product-search.js. Aqui fica só o DOM: dropdown logo abaixo do campo de
// busca, no máximo SEARCH_VISIBLE_ITEMS itens visíveis (rolagem além disso)
// e SEARCH_MAX_RENDER itens no DOM (nunca centenas).
const SEARCH_MAX_RENDER = 30;
let _searchMatches = [];
let _searchHighlight = -1;
let _lastCartAddAt = 0;

function _pdvSearchOpen() {
  const box = document.getElementById('pdvSearchDropdown');
  return Boolean(box && !box.classList.contains('hidden') && _searchMatches.length);
}

function _pdvCloseSearchDropdown() {
  _searchMatches = [];
  _searchHighlight = -1;
  const box = document.getElementById('pdvSearchDropdown');
  if (box) {
    box.classList.add('hidden');
    box.innerHTML = '';
  }
}

function _pdvRenderSearchDropdown() {
  const bar = getSearchField()?.closest('.pdv-search-bar');
  if (!bar) return;

  let box = document.getElementById('pdvSearchDropdown');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pdvSearchDropdown';
    box.className = 'pdv-search-dropdown hidden';
    box.setAttribute('role', 'listbox');
    bar.appendChild(box);
  }

  const shown = _searchMatches.slice(0, SEARCH_MAX_RENDER);
  if (!shown.length) {
    _pdvCloseSearchDropdown();
    return;
  }

  box.innerHTML = shown.map((match, i) => {
    const p = match.product;
    const thumb = productThumb(p);
    const stock = Number(p.stock || 0);
    const price = Number(p.salePrice || p.price || 0);
    const label = String(p.name || 'Produto');
    const sku = String(p.code || p.sku || '').trim();
    const thumbHtml = thumb
      ? `<img class="pdv-search-thumb" src="${_esc(thumb)}" alt="" loading="lazy" />`
      : `<span class="pdv-search-thumb pdv-search-thumb-empty" aria-hidden="true">${_esc(label.charAt(0).toUpperCase())}</span>`;
    return `<div class="pdv-search-item${i === _searchHighlight ? ' is-active' : ''}${stock <= 0 ? ' is-out' : ''}" role="option" aria-selected="${i === _searchHighlight}" data-search-idx="${i}">
      ${thumbHtml}
      <span class="pdv-search-info">
        <span class="pdv-search-name">${_esc(label)}</span>
        <span class="pdv-search-meta">${formatCurrency(price)} • Estoque ${stock}${sku ? ` • ${_esc(sku)}` : ''}</span>
      </span>
    </div>`;
  }).join('');

  box.classList.remove('hidden');
  box.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
}

function _pdvOpenSearchDropdown(matches) {
  _searchMatches = Array.isArray(matches) ? matches : [];
  _searchHighlight = -1;
  _pdvRenderSearchDropdown();
}

function _pdvPickSearchProduct(product) {
  _pdvCloseSearchDropdown();
  _pdvAddResolvedProduct(product);
}

// Lista ao vivo enquanto digita. Não abre para código de barras (leitor
// digita rápido e termina com Enter — o fluxo de Enter resolve direto) nem
// para etiqueta de balança.
function _pdvUpdateLiveSearch() {
  const field = getSearchField();
  const value = String(field?.value || '').trim();
  if (value.length < 2 || looksLikeBarcode(value) || _parseScaleBarcode(value)) {
    _pdvCloseSearchDropdown();
    return;
  }
  const { matches } = rankProducts(state.products, value);
  if (!matches.length) {
    _pdvCloseSearchDropdown();
    return;
  }
  _pdvOpenSearchDropdown(matches);
}

function _bindSearchDropdown() {
  const field = getSearchField();
  if (!field || field.dataset.searchDropdownBound === 'true') return;
  field.dataset.searchDropdownBound = 'true';

  field.addEventListener('input', _pdvUpdateLiveSearch);

  field.addEventListener('keydown', (event) => {
    if (!_pdvSearchOpen()) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      _searchHighlight = nextHighlight(_searchHighlight, Math.min(_searchMatches.length, SEARCH_MAX_RENDER), event.key);
      _pdvRenderSearchDropdown();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      _pdvCloseSearchDropdown();
    }
  });

  const bar = field.closest('.pdv-search-bar');
  bar?.addEventListener('mousedown', (event) => {
    // mantém o foco no campo ao clicar num item da lista
    if (event.target.closest('#pdvSearchDropdown')) event.preventDefault();
  });
  bar?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-search-idx]');
    if (!item) return;
    const match = _searchMatches[Number(item.dataset.searchIdx)];
    if (match) _pdvPickSearchProduct(match.product);
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.pdv-search-bar')) _pdvCloseSearchDropdown();
  });
}

/* ================= CART / PRODUTO ================= */

function _isWeightProduct(product) {
  return product.saleType === 'weight' ||
    product.unit === 'kg' ||
    product.unit === 'g';
}

function _addWeightItemToCart(product, weightKg) {
  const pricePerKg = Number(product.pricePerKg || product.salePrice || product.price || 0);
  const total      = Math.round(pricePerKg * weightKg * 100) / 100;
  const name       = String(product.name || 'Produto');

  cart.push({
    id:         product.id,
    name,
    quantity:   weightKg,
    price:      pricePerKg,
    cost:       Number(product.costPerKg || product.cost || 0),
    barcode:    product.barcode || null,
    code:       product.code   || null,
    imageUrl:   product.imageUrl || product.imagem || null,
    discount:   0,
    total,
    weightKg,
    unitLabel:  'kg',
    unit:       product.unit || 'kg'
  });

  audit('cart_item_added', {
    productId: product.id,
    name,
    weightKg,
    pricePerKg,
    total,
    operator:     getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });

  renderCart();
}

function _openWeightModal(product) {
  const modal      = document.getElementById('pdvWeightModal');
  const nameEl     = document.getElementById('pdvWeightProductName');
  const priceEl    = document.getElementById('pdvWeightPricePerKg');
  const totalEl    = document.getElementById('pdvWeightTotal');
  const weightInp  = document.getElementById('pdvWeightInput');

  if (!modal) return;

  const pricePerKg = Number(product.pricePerKg || product.salePrice || product.price || 0);
  if (nameEl)  nameEl.textContent  = String(product.name || 'Produto');
  if (priceEl) priceEl.textContent = formatCurrency(pricePerKg);
  if (totalEl) totalEl.textContent = formatCurrency(0);
  if (weightInp) weightInp.value   = '';

  function _recalc() {
    const w = parseFloat(weightInp?.value || 0) || 0;
    if (totalEl) totalEl.textContent = formatCurrency(w * pricePerKg);
  }

  weightInp?.removeEventListener('input', weightInp._recalcHandler);
  weightInp._recalcHandler = _recalc;
  weightInp?.addEventListener('input', _recalc);

  modal._pendingProduct = product;
  modal.classList.remove('hidden');
  weightInp?.focus();
}

function addItemToCart() {
  const searchField = getSearchField();
  const qtyField    = getQuantityField();

  const search = searchField?.value || '';

  // Enter com um item destacado na lista (ArrowUp/ArrowDown) escolhe esse
  // item. Vem antes de tudo: a lista aberta é uma escolha explícita do
  // operador e nunca deve ser reinterpretada pelo texto do campo.
  if (_pdvSearchOpen() && _searchHighlight >= 0) {
    const highlighted = _searchMatches[_searchHighlight];
    if (highlighted) {
      _pdvPickSearchProduct(highlighted.product);
      return;
    }
  }

  /* ── Scale barcode label: prefix "2", parse product code + weight ── */
  const scaleParsed = _parseScaleBarcode(search);
  if (scaleParsed) {
    const products = Array.isArray(state.products) ? state.products : [];
    const product  = products.find((p) => {
      const code = onlyDigits(String(p.code || '').trim());
      return code === scaleParsed.productCode || code === scaleParsed.productCode.replace(/^0+/, '');
    });

    if (!product) {
      showToast('Produto não encontrado para este código de balança.', 'warning');
      focusPDVInput();
      return;
    }

    _addWeightItemToCart(product, scaleParsed.weight);

    audit('scale_barcode_scanned', {
      barcode: search,
      productId: product.id,
      weightKg: scaleParsed.weight,
      operator: getCurrentCashOperator()
    });

    if (searchField) searchField.value = '';
    if (qtyField)    qtyField.value    = 1;
    focusPDVInput();
    return;
  }

  if (!search.trim()) {
    // Enter dispara addItemToCart() duas vezes no campo de busca (atalho
    // global + bindBarcodeScanner) — a segunda chamada já encontra o campo
    // limpo pela primeira. Não avisar "digite o produto" nesse caso.
    if (Date.now() - _lastCartAddAt < 300) return;
    showToast('Digite o nome ou código do produto.', 'warning');
    focusPDVInput();
    return;
  }

  const decision = decideSearch(state.products, search);

  if (decision.action === 'not_found') {
    _pdvCloseSearchDropdown();
    showToast(
      decision.reason === 'barcode' ? 'Código de barras não encontrado.' : 'Produto não encontrado.',
      'warning'
    );
    focusPDVInput();
    return;
  }

  if (decision.action === 'list') {
    // Ambíguo (vários parciais, ou mais de um produto com o mesmo nome
    // exato): nunca escolher sozinho — o operador escolhe na lista.
    _pdvOpenSearchDropdown(decision.matches);
    focusPDVInput();
    return;
  }

  _pdvCloseSearchDropdown();
  _pdvAddResolvedProduct(decision.product);
}

function _pdvAddResolvedProduct(product) {
  const searchField = getSearchField();
  const qtyField    = getQuantityField();

  /* ── Weight product without scale barcode: open weight modal ── */
  if (_isWeightProduct(product)) {
    _openWeightModal(product);
    _lastCartAddAt = Date.now();
    if (searchField) searchField.value = '';
    return;
  }

  const quantity     = Math.max(1, Number(qtyField?.value || 1));
  const currentStock = Number(product.stock || 0);

  if (currentStock <= 0) {
    showToast('Produto sem estoque disponível.', 'warning');
    focusPDVInput();
    return;
  }

  const existingQty = cart.find((item) => item.id === product.id)?.quantity || 0;

  if ((existingQty + quantity) > currentStock) {
    showToast(`Estoque insuficiente para "${String(product.name || 'Produto')}". Disponível: ${currentStock} unidade(s).`, 'warning');
    focusPDVInput();
    return;
  }

  _finishAddItemToCart(product, quantity, searchField, qtyField);
}

function _finishAddItemToCart(product, quantity, searchField, qtyField) {
  const price = Number(product.salePrice || product.price || 0);
  const name  = String(product.name || 'Produto');

  const existing = cart.find((item) => item.id === product.id);

  if (existing) {
    existing.quantity += quantity;
    existing.total = (existing.quantity * existing.price) - Number(existing.discount || 0);
  } else {
    cart.push({
      id:       product.id,
      name,
      quantity,
      price,
      cost:     Number(product.cost || 0),
      barcode:  product.barcode || null,
      code:     product.code   || null,
      imageUrl: product.imageUrl || product.imagem || null,
      discount: 0,
      total:    quantity * price,
      unit:     product.unit || 'un'
    });
  }

  audit('cart_item_added', {
    productId: product.id,
    name,
    quantity,
    price,
    operator:     getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });

  renderCart();

  _lastCartAddAt = Date.now();
  if (searchField) searchField.value = '';
  if (qtyField)    qtyField.value    = 1;

  focusPDVInput();
}

/* ================= RECIBO ================= */

// Dados da última venda finalizada — acessível pelo botão "Imprimir" do modal de conclusão
let _lastReceiptSale    = null;
let _lastReceiptPayload = null;

function printSaleReceipt(sale, payload) {
  // Usa dados passados ou cai para última venda + carrinho atual
  const _sale    = sale    || _lastReceiptSale;
  const _payload = payload || _lastReceiptPayload;
  const _items   = _payload?.items || cart;

  if (!_items || !_items.length) {
    showToast('Nenhuma venda para imprimir.', 'warning');
    return;
  }

  const operator    = getCurrentCashOperator();
  const company     = state.companySettings || {};
  const subtotal    = _payload?.subtotal   ?? getCartSubtotal();
  const discount    = _payload?.discount   ?? (getCartDiscountTotal() + (pdvPaymentDiscount || 0));
  const total       = _payload?.total      ?? getEffectivePDVTotal();
  const amtReceived = _payload?.amountReceived ?? 0;
  const change      = _payload?.changeAmount   ?? 0;
  const pm          = _payload?.paymentMethod  ?? getReadablePaymentMethod();
  const saleId      = _sale?.id ? String(_sale.id).slice(-8).toUpperCase() : '—';
  const installments= _payload?.installments ?? 1;

  const e = (v) => _esc(String(v ?? ''));
  const cur = (v) => formatCurrency(Number(v || 0));
  const sep = '—'.repeat(32);
  const now = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const itemsHtml = _items.map((item) => {
    const qty   = Number(item.quantity || 1);
    const price = Number(item.unitPrice || item.price || 0);
    const tot   = Number(item.total || qty * price);
    const disc  = Number(item.discount || 0);
    const name  = e(item.productName || item.name || 'Item');
    return `
      <div class="prt-item">
        <span class="prt-name">${name}</span>
        <div class="prt-line">
          <span>${qty}x ${cur(price)}${disc > 0 ? ` <em>(- ${cur(disc)})</em>` : ''}</span>
          <span>${cur(tot)}</span>
        </div>
      </div>`;
  }).join('');

  const discountRow = discount > 0
    ? `<div class="prt-row"><span>Desconto</span><span>- ${cur(discount)}</span></div>` : '';

  const changeRow = pm.toLowerCase() === 'dinheiro' && change > 0
    ? `<div class="prt-row"><span>Troco</span><span>${cur(change)}</span></div>` : '';

  const installRow = installments > 1
    ? `<div class="prt-row"><span>Parcelas</span><span>${installments}x de ${cur(total / installments)}</span></div>` : '';

  const cnpj    = e(company.cnpj    || '');
  const address = e(company.address || '');
  const phone   = e(company.phone   || '');
  const footer  = e(company.noteFooter || 'Obrigado pela preferência!');

  // Sem <style> inline e sem style="" atributos — todos os estilos estão em base.css.
  // <style> blocks injetados via innerHTML em runtime violam o style-src da CSP
  // (que só aceita hashes de <style> presentes no HTML em tempo de build).
  const html = `
<div class="prt-company">${e(company.tradeName || 'Estabelecimento')}</div>
${cnpj    ? `<div class="prt-center">CNPJ: ${cnpj}</div>` : ''}
${address ? `<div class="prt-center">${address}</div>` : ''}
${phone   ? `<div class="prt-center">Tel: ${phone}</div>` : ''}

<hr class="prt-sep">
<div class="prt-center prt-bold">CUPOM NÃO FISCAL</div>
<hr class="prt-sep">

<div class="prt-row"><span>Venda nº</span><span>#${saleId}</span></div>
<div class="prt-row"><span>Data</span><span>${now}</span></div>
<div class="prt-row"><span>Terminal</span><span>${e(getCurrentTerminalName())}</span></div>
<div class="prt-row"><span>Operador</span><span>${e(operator?.name || state.currentUser?.name || '—')}</span></div>

<hr class="prt-sep">
<div class="prt-section-hd">ITENS</div>
${itemsHtml}

<hr class="prt-sep">
${discount > 0 ? `<div class="prt-row"><span>Subtotal</span><span>${cur(subtotal + discount)}</span></div>` : ''}
${discountRow}
<div class="prt-total"><span>TOTAL</span><span>${cur(total)}</span></div>

<hr class="prt-sep">
<div class="prt-row"><span>Pagamento</span><span>${e(pm)}${installments > 1 ? ` (${installments}x)` : ''}</span></div>
${amtReceived > 0 ? `<div class="prt-row"><span>Valor recebido</span><span>${cur(amtReceived)}</span></div>` : ''}
${changeRow}
${installRow}

<hr class="prt-sep">
<div class="prt-footer">${footer}</div>
<div class="prt-footer-gap">.</div>`;

  document.getElementById('cupomImpressao')?.remove();

  const wrapper = document.createElement('div');
  wrapper.id = 'cupomImpressao';
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  audit('receipt_printed', {
    saleId: _sale?.id || null,
    total,
    operator,
    terminalName: getCurrentTerminalName()
  });

  window.addEventListener('afterprint', () => {
    document.getElementById('cupomImpressao')?.remove();
  }, { once: true });

  window.print();
}

/* ================= MODAL DE PAGAMENTO MISTO ================= */

// Mapeamento frontend → enum backend
const _PM_BACKEND = {
  'dinheiro': 'cash', 'pix': 'pix', 'crédito': 'credit', 'credito': 'credit',
  'débito': 'debit', 'debito': 'debit', 'voucher': 'voucher',
  'a prazo': 'other', 'misto': 'mixed', 'other': 'other',
  'cartão': 'card', 'cartao': 'card'
};

function _pmToBackend(pm) {
  const k = String(pm || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  // strip accents and lookup
  const clean = String(pm || '').toLowerCase().trim();
  return _PM_BACKEND[clean] || _PM_BACKEND[k] || 'other';
}

const _PAY_MODAL_OPTIONS = ['Dinheiro', 'PIX', 'Crédito', 'Débito', 'Voucher'];

function _openPaymentModal() {
  if (!cart.length) {
    showToast('Adicione itens antes de ir para pagamento.', 'warning');
    return;
  }

  const totalVenda = getEffectivePDVTotal();
  let parcelas = []; // { method: string, value: number }

  // Dropdown inicia na forma atual selecionada no PDV; campo inicia com valor total
  const formAtual = getReadablePaymentMethod();
  const initialMethod = _PAY_MODAL_OPTIONS.includes(formAtual) ? formAtual : 'Dinheiro';

  // ── helpers ──────────────────────────────────────────────────────────────
  const somaPaga = () => parcelas.reduce((s, p) => s + p.value, 0);
  const falta    = () => Math.max(0, totalVenda - somaPaga());
  const troco    = () => {
    const excedente = somaPaga() - totalVenda;
    if (excedente <= 0) return 0;
    const temDinheiro = parcelas.some(p => p.method.toLowerCase() === 'dinheiro');
    return temDinheiro ? excedente : 0;
  };
  const temAPrazo   = () => parcelas.some(p => p.method === 'A prazo');
  const podeConcluir = () => falta() <= 0.005;

  // ── build HTML ────────────────────────────────────────────────────────────
  function _renderParcelas() {
    if (parcelas.length === 0) return '<p class="pdv-pay-modal-total-row" style="opacity:.5;font-size:12px">Nenhuma parcela adicionada</p>';
    return parcelas.map((p, i) => `
      <div class="pdv-pay-parcela" tabindex="0" data-idx="${i}">
        <span class="pdv-pay-parcela-method">${_esc(p.method)}</span>
        <span class="pdv-pay-parcela-value">${formatCurrency(p.value)}</span>
        <button class="pdv-pay-parcela-rm" data-rm="${i}" type="button" title="Remover" aria-label="Remover parcela">×</button>
      </div>`).join('');
  }

  function _renderTotals(container) {
    const pago = somaPaga();
    const f    = falta();
    const tc   = troco();
    const ok   = podeConcluir();

    const faltaEl  = container.querySelector('#pmFalta');
    const pagoEl   = container.querySelector('#pmPago');
    const trocoEl  = container.querySelector('#pmTroco');
    const confirmEl= container.querySelector('#pmConfirm');
    const trocoRow = container.querySelector('#pmTrocoRow');
    const addVal   = container.querySelector('#pmAddValue');

    if (pagoEl)  pagoEl.textContent  = formatCurrency(pago);
    if (faltaEl) {
      faltaEl.textContent = f > 0.005 ? `- ${formatCurrency(f)}` : 'Tudo pago ✓';
      faltaEl.className   = f > 0.005 ? 'pdv-pay-modal-remaining' : 'pdv-pay-modal-remaining-ok';
    }
    if (trocoRow) trocoRow.classList.toggle('hidden', tc <= 0.005);
    if (trocoEl)  trocoEl.textContent = formatCurrency(tc);
    if (confirmEl) confirmEl.disabled = !ok;
    // Sugerir valor restante no campo de adição
    if (addVal && !addVal.dataset.userEdited) {
      addVal.value = f > 0.005 ? f.toFixed(2) : '';
    }
  }

  function _buildModal() {
    const parcelasHtml = _renderParcelas();
    const opts = _PAY_MODAL_OPTIONS.map(o =>
      `<option value="${o}"${o === initialMethod ? ' selected' : ''}>${o}</option>`
    ).join('');

    return `
<div class="pdv-pay-modal-overlay" id="pdvPaymentModal" role="dialog" aria-modal="true">
  <div class="pdv-pay-modal">
    <div class="pdv-pay-modal-title">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      Pagamento
    </div>
    <div class="pdv-pay-modal-totals">
      <div class="pdv-pay-modal-total-row"><span>Total da venda</span><strong>${formatCurrency(totalVenda)}</strong></div>
      <div class="pdv-pay-modal-total-row"><span>Pago até agora</span><strong id="pmPago">${formatCurrency(somaPaga())}</strong></div>
      <div class="pdv-pay-modal-total-row"><span>Falta</span><span id="pmFalta" class="${falta() > 0 ? 'pdv-pay-modal-remaining' : 'pdv-pay-modal-remaining-ok'}">${falta() > 0.005 ? `- ${formatCurrency(falta())}` : 'Tudo pago ✓'}</span></div>
      <div class="pdv-pay-modal-total-row hidden" id="pmTrocoRow"><span>Troco</span><span id="pmTroco" class="pdv-pay-modal-change">${formatCurrency(troco())}</span></div>
    </div>
    <div class="pdv-pay-parcelas" id="pmParcelas">${parcelasHtml}</div>
    <div class="pdv-pay-add-row">
      <select id="pmAddMethod" aria-label="Forma de pagamento">${opts}</select>
      <input id="pmAddValue" type="number" min="0.01" step="0.01" placeholder="Valor" aria-label="Valor da parcela"
             value="${totalVenda.toFixed(2)}" />
      <button class="pdv-pay-add-btn" type="button" id="pmAddBtn">+ Adicionar</button>
    </div>
    <div class="pdv-pay-modal-actions">
      <button class="pdv-pay-modal-confirm" type="button" id="pmConfirm"
        ${podeConcluir() ? '' : 'disabled'}>Confirmar venda</button>
      <button class="pdv-pay-modal-cancel" type="button" id="pmCancel">Cancelar</button>
    </div>
  </div>
</div>`;
  }

  // ── render + bind ─────────────────────────────────────────────────────────
  document.getElementById('pdvPaymentModal')?.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = _buildModal();
  const overlay = wrapper.firstElementChild;
  document.body.appendChild(overlay);

  const container  = overlay;
  const addMethod  = overlay.querySelector('#pmAddMethod');
  const addVal     = overlay.querySelector('#pmAddValue');
  const parcelasEl = overlay.querySelector('#pmParcelas');

  // Foco inicial no dropdown de forma
  requestAnimationFrame(() => addMethod?.focus());

  function _refreshUI() {
    parcelasEl.innerHTML = _renderParcelas();
    _renderTotals(container);
    _bindParcelaKeys();
    // Aviso se A prazo misturado
    const warn = container.querySelector('.pdv-pay-aprazo-warn');
    if (warn) warn.remove();
    if (temAPrazo() && parcelas.length > 1) {
      const w = document.createElement('p');
      w.className = 'pdv-pay-aprazo-warn';
      w.textContent = 'Pagamento A prazo não pode ser misturado com outras formas.';
      overlay.querySelector('.pdv-pay-add-row')?.after(w);
    }
  }

  function _addParcela() {
    const method = addMethod?.value || 'Dinheiro';
    const raw    = String(addVal?.value || '0').replace(',', '.');
    const value  = parseFloat(raw);
    if (!value || value <= 0) { addVal?.focus(); return; }

    // A prazo não pode misturar
    if (temAPrazo() && parcelas.length > 0) {
      showToast('Remova a parcela A prazo antes de adicionar outra forma.', 'warning');
      return;
    }
    if (method === 'A prazo' && parcelas.length > 0) {
      showToast('A prazo não pode ser misturado. Remova as parcelas anteriores.', 'warning');
      return;
    }

    // Não-Dinheiro não pode exceder o que falta pagar (Dinheiro pode dar troco)
    if (method !== 'Dinheiro' && value > falta() + 0.005) {
      showToast('Valor excede o que falta pagar. Use Dinheiro para dar troco.', 'warning');
      addVal?.focus();
      return;
    }

    parcelas.push({ method, value });
    if (addVal) { addVal.value = ''; delete addVal.dataset.userEdited; }
    _refreshUI();
  }

  function _removeParcela(idx) {
    parcelas.splice(idx, 1);
    if (addVal) delete addVal.dataset.userEdited;
    _refreshUI();
    addMethod?.focus();
  }

  function _bindParcelaKeys() {
    overlay.querySelectorAll('.pdv-pay-parcela').forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const idx = Number(el.dataset.idx);
          _removeParcela(idx);
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); el.nextElementSibling?.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); el.previousElementSibling?.focus(); }
      });
      el.querySelector('.pdv-pay-parcela-rm')?.addEventListener('click', () => {
        _removeParcela(Number(el.dataset.idx));
      });
    });
  }
  _bindParcelaKeys();

  overlay.querySelector('#pmAddBtn')?.addEventListener('click', _addParcela);

  addVal?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _addParcela(); }
  });
  addVal?.addEventListener('input', () => { addVal.dataset.userEdited = '1'; });

  // Confirmar
  overlay.querySelector('#pmConfirm')?.addEventListener('click', async () => {
    if (!podeConcluir()) return;
    const isAPrazo = temAPrazo();
    if (isAPrazo && !currentSaleCustomer?.id) {
      showToast('Selecione um cliente para venda a prazo.', 'warning');
      return;
    }

    const paymentMethod = parcelas.length === 1 ? parcelas[0].method : 'Misto';
    // Setar o dropdown principal para que buildSalePayload funcione
    const sel = getPaymentMethodField();
    if (sel) {
      // Adicionar option temporário se necessário
      let opt = Array.from(sel.options).find(o => o.value === paymentMethod || o.text === paymentMethod);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = paymentMethod;
        opt.text  = paymentMethod;
        opt.dataset.temp = '1';
        sel.add(opt);
      }
      sel.value = paymentMethod;
    }

    // Notas sobre parcelas para o cupom
    const parcNotes = parcelas.map(p => `${p.method}: ${formatCurrency(p.value)}`).join(' | ');
    const notesExtra = parcelas.length > 1 ? `Pagamento misto — ${parcNotes}` : (isAPrazo ? 'A prazo' : null);

    // Fase 3.1a-bis (C2): a composição real (parcelas) só é enviada quando há
    // mais de uma parcela — é exatamente quando paymentMethod vira 'Misto'/
    // 'mixed' acima. Para 1 parcela, o backend já deriva uma única linha a
    // partir de paymentMethod (sales.service.js) — não precisa duplicar.
    // Usa a implementação REAL de normalização (normalizePaymentMethod, de
    // sales-service.js) — nunca o mapa duplicado/morto _pmToBackend deste
    // arquivo.
    const paymentsComposition = parcelas.length > 1
      ? parcelas.map(p => ({
          method: normalizePaymentMethod(p.method),
          amount: Number(p.value)
        }))
      : null;

    _closePaymentModal();
    try {
      const payload = buildSalePayload();
      if (notesExtra) payload.notes = notesExtra;
      if (paymentsComposition) payload.payments = paymentsComposition;
      // Troco — só conta se houver dinheiro
      payload.changeAmount = troco();
      payload.amountReceived = somaPaga();
      payload.amountPaid = somaPaga();

      // BUG REAL DE STAGING (2026-09-16): mesma correção do fluxo de
      // pagamento único (finalizeSale) — a rota de pagamento Mercado Pago
      // está desabilitada de propósito no backend (501); registrar a
      // venda normalmente em vez de tentar abrir um pagamento ao vivo.
      await persistApprovedSale(payload);
    } catch (err) {
      showToast(err?.message || 'Erro ao finalizar venda.', 'error');

      // BUG REAL DE STAGING (2026-09-19), Bug C: sel.value (setado acima
      // para o backend receber paymentMethod) ficava preso no método da
      // tentativa que falhou, mas o valor recebido da área inferior do PDV
      // (#amountPaid) nunca foi sincronizado por este fluxo — o modal
      // trabalha inteiramente com sua própria soma de parcelas
      // (somaPaga()), nunca escreve nesse campo. Sem este reset, o próximo
      // F10 lia essa combinação inconsistente (paymentMethod preenchido +
      // #amountPaid vazio) e caía direto na checagem "valor recebido
      // menor que o total" em vez de reabrir o modal de pagamento — a
      // segunda tentativa nunca tinha as mesmas condições da primeira.
      const amountEl = getAmountPaidEl();
      if (sel) sel.value = '';
      if (amountEl) amountEl.value = '';
    } finally {
      // Limpar option temporário
      getPaymentMethodField()?.querySelector('[data-temp]')?.remove();
    }
  });

  // Cancelar + Esc
  overlay.querySelector('#pmCancel')?.addEventListener('click', _closePaymentModal);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); _closePaymentModal(); }
    if (e.key === 'F10' || (e.key === 'Enter' && e.target?.id === 'pmConfirm')) {
      e.preventDefault();
      if (podeConcluir()) overlay.querySelector('#pmConfirm')?.click();
    }
  });

  // Focus trap: Tab
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button:not([disabled]),input,select,[tabindex="0"]')];
    const idx = focusable.indexOf(document.activeElement);
    e.preventDefault();
    if (e.shiftKey) {
      focusable[(idx - 1 + focusable.length) % focusable.length]?.focus();
    } else {
      focusable[(idx + 1) % focusable.length]?.focus();
    }
  });

  _renderTotals(container);
}

function _closePaymentModal() {
  document.getElementById('pdvPaymentModal')?.remove();
  focusPDVInput();
}

/* ================= MERCADO PAGO ================= */

function clearMercadoPagoUI() {
  stopPaymentPolling();

  const box = getMercadoPagoBox();
  if (box) box.classList.add('hidden');

  const status = getMercadoPagoStatusEl();
  if (status) status.textContent = 'Aguardando início.';

  const qrWrap = getMercadoPagoQrWrap();
  if (qrWrap) qrWrap.classList.add('hidden');

  const qr = getMercadoPagoQrImage();

  if (qr) {
    qr.src = '';
    qr.removeAttribute('src');
  }

  const copyCode = getMercadoPagoCopyCode();
  if (copyCode) copyCode.textContent = '';
}

function stopPaymentPolling() {
  if (paymentPollingTimer) {
    clearInterval(paymentPollingTimer);
    paymentPollingTimer = null;
  }
}

async function pollMercadoPagoStatus(reference, payload) {
  if (!reference) return;

  stopPaymentPolling();

  let attempts = 0;

  paymentPollingTimer = setInterval(async () => {
    attempts += 1;

    try {
      const statusResponse = await api.request(`/v1/mercadopago/pdv-payment/status/${encodeURIComponent(reference)}`, {
        method: 'GET'
      });

      const status = String(
        statusResponse?.status ||
        statusResponse?.paymentStatus ||
        statusResponse?.detail ||
        ''
      ).trim().toLowerCase();

      const statusEl = getMercadoPagoStatusEl();

      if (statusEl) {
        statusEl.textContent = `Status do pagamento: ${status || 'aguardando confirmação'}`;
      }

      if (status === 'approved' || status === 'paid' || status === 'authorized') {
        stopPaymentPolling();
        await persistApprovedSale(payload);
        return;
      }

      if (status === 'rejected' || status === 'cancelled' || status === 'canceled' || status === 'expired') {
        stopPaymentPolling();
        showToast('Pagamento não aprovado.', 'warning');

        audit('payment_rejected', {
          reference,
          status,
          payload,
          operator: getCurrentCashOperator()
        });
      }

      if (attempts >= 36) stopPaymentPolling();
    } catch (error) {
      console.error('Erro ao consultar status do pagamento Mercado Pago:', error);

      if (attempts >= 8) stopPaymentPolling();
    }
  }, 5000);
}

function renderMercadoPagoPaymentData(data, gatewayMethod) {
  const box = getMercadoPagoBox();
  const statusEl = getMercadoPagoStatusEl();
  const qrWrap = getMercadoPagoQrWrap();
  const qrImage = getMercadoPagoQrImage();
  const copyCode = getMercadoPagoCopyCode();

  if (box) box.classList.remove('hidden');

  const qrBase64 =
    data?.qrCodeBase64 ||
    data?.qr_code_base64 ||
    data?.qrCode ||
    data?.qr_code ||
    null;

  const qrText =
    data?.copyPaste ||
    data?.copy_paste ||
    data?.pixCode ||
    data?.pix_code ||
    data?.qrCodeText ||
    data?.qr_code_text ||
    '';

  const boletoUrl =
    data?.boletoUrl ||
    data?.ticketUrl ||
    data?.ticket_url ||
    data?.paymentUrl ||
    data?.payment_url ||
    data?.checkoutUrl ||
    data?.checkout_url ||
    data?.initPoint ||
    data?.init_point ||
    null;

  if (statusEl) {
    if (gatewayMethod === 'pix') statusEl.textContent = 'QR Code Pix gerado. Aguarde a confirmação do pagamento.';
    else if (gatewayMethod === 'boleto') statusEl.textContent = 'Boleto gerado com sucesso.';
    else if (gatewayMethod === 'card') statusEl.textContent = 'Cobrança no cartão iniciada.';
    else statusEl.textContent = 'Pagamento iniciado.';
  }

  if (gatewayMethod === 'pix') {
    if (qrWrap) qrWrap.classList.remove('hidden');

    if (qrImage && qrBase64) {
      qrImage.src = String(qrBase64).startsWith('data:image')
        ? qrBase64
        : `data:image/png;base64,${qrBase64}`;
    }

    if (copyCode) copyCode.textContent = qrText || 'Código Pix não retornado pelo gateway.';
  } else {
    if (qrWrap) qrWrap.classList.add('hidden');
    if (copyCode) copyCode.textContent = '';
  }

  if (gatewayMethod === 'boleto' && boletoUrl) {
    window.open(boletoUrl, '_blank');
    showToast('Boleto gerado e aberto em nova aba.');
  }

  if (gatewayMethod === 'card' && boletoUrl) {
    window.open(boletoUrl, '_blank');
  }
}

async function startMercadoPagoPaymentFlow(payload) {
  const gatewayMethod = normalizeGatewayPaymentMethod();

  clearMercadoPagoUI();

  const box = getMercadoPagoBox();
  const statusEl = getMercadoPagoStatusEl();

  if (box) box.classList.remove('hidden');
  if (statusEl) statusEl.textContent = 'Gerando pagamento...';

  const reference = `PDV-${Date.now()}`;

  const response = await api.request('/v1/mercadopago/pdv-payment', {
    method: 'POST',
    body: JSON.stringify({
      paymentMethod: gatewayMethod,
      total: payload.total,
      items: payload.items,
      saleReference: reference,
      description: `Venda PDV • ${getCurrentTerminalName()}`
    })
  });

  audit('payment_started', {
    reference,
    gatewayMethod,
    total: payload.total,
    operator: getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });

  renderMercadoPagoPaymentData(response, gatewayMethod);

  const referenceFromApi =
    response?.reference ||
    response?.saleReference ||
    response?.externalReference ||
    reference;

  if (gatewayMethod === 'pix' || gatewayMethod === 'card') {
    await pollMercadoPagoStatus(referenceFromApi, payload);
    return;
  }

  if (gatewayMethod === 'boleto') {
    showToast('Boleto gerado com sucesso.');
  }
}

/* ================= PAGAMENTO / TROCO ================= */

function _calcBillBreakdown(change) {
  if (change < 0.01) return '';
  const cents  = Math.round(change * 100);
  const denoms = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
  const labels = ['R$200','R$100','R$50','R$20','R$10','R$5','R$2','R$1','50¢','25¢','10¢','5¢','1¢'];
  let rem = cents;
  const parts = [];
  for (let i = 0; i < denoms.length && rem > 0; i++) {
    const n = Math.floor(rem / denoms[i]);
    if (n > 0) { parts.push(`${n}×${labels[i]}`); rem -= n * denoms[i]; }
  }
  return parts.join(' + ');
}

function updateChangePreview() {
  const amountPaid = Number(getAmountPaidEl()?.value || 0);
  const total      = getEffectivePDVTotal();
  const changeEl   = getChangeEl();
  const breakEl    = document.getElementById('pdvChangeBreakdown');

  if (!changeEl) return;

  if (!isMoneyMethod()) {
    changeEl.textContent = formatCurrency(0);
    if (breakEl) breakEl.textContent = '';
    return;
  }

  const change = Math.max(0, amountPaid - total);
  changeEl.textContent = formatCurrency(change);
  if (breakEl) breakEl.textContent = _calcBillBreakdown(change);
}

function requestInstallments() {
  if (!cart.length) {
    showToast('Adicione itens antes de parcelar.', 'warning');
    return;
  }

  const input = window.prompt('Informe o número de parcelas:', installmentInfo?.count || '2');
  if (input === null) return;

  const count = Number(String(input).replace(/\D/g, ''));

  if (!Number.isInteger(count) || count < 2 || count > 24) {
    showToast('Informe uma quantidade de parcelas entre 2 e 24.', 'warning');
    return;
  }

  installmentInfo = { count };

  const paymentField = getPaymentMethodField();
  if (paymentField) paymentField.value = 'Cartão';

  audit('installments_selected', {
    installments: count,
    total: getCartSubtotal(),
    operator: getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });

  showToast(`Pagamento parcelado configurado em ${count}x.`);
  focusPDVInput();
}

function applyDiscountPrompt() {
  if (!cart.length) {
    showToast('Nenhum item no carrinho.', 'warning');
    return;
  }

  const input = window.prompt('Informe o valor do desconto total (R$):', '0');
  if (input === null) return;

  const discount = Math.max(0, Number(String(input).replace(',', '.')) || 0);
  if (!discount) return;

  const subtotal = getCartSubtotal();

  // ── Validação de política comercial ──────────────────────────────────────
  const policy = state.commercialPolicy;
  if (policy && subtotal > 0) {
    const discountPct = (discount / subtotal) * 100;
    const role = String(state.currentUser?.role || '').toLowerCase();
    const maxByRole = role === 'operador'     ? Number(policy.maxDiscountOperador ?? 10)
                    : role === 'gerente'       ? Number(policy.maxDiscountGerente  ?? 20)
                    : Number(policy.maxDiscountAdmin ?? 50);
    const maxGlobal = Number(policy.maxDiscountPercent ?? 20);
    const maxPct = Math.min(maxByRole, maxGlobal);

    if (discountPct > maxPct) {
      showToast(
        `Desconto de ${discountPct.toFixed(1)}% excede o máximo permitido (${maxPct.toFixed(0)}%) para o perfil ${role}. Solicite autorização de gerente/admin.`,
        'error'
      );
      return;
    }
  }

  const newTotal = Math.max(0, subtotal - discount);

  if (cart.length) {
    const factor = subtotal > 0 ? newTotal / subtotal : 1;

    cart = cart.map((item) => {
      const newItemTotal = Number(item.total || 0) * factor;
      const originalItemTotal = Number(item.quantity || 0) * Number(item.price || 0);
      const itemDiscount = Math.max(0, originalItemTotal - newItemTotal);

      return {
        ...item,
        total: newItemTotal,
        discount: itemDiscount
      };
    });
  }

  audit('discount_applied', {
    discount,
    subtotal,
    newTotal,
    operator: getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });

  renderCart();
  showToast('Desconto aplicado.');
}

/* ================= VENDA ================= */

function buildSalePayload() {
  const paymentMethod = String(getPaymentMethodField()?.value || 'Dinheiro').trim();
  const subtotalBeforePayDiscount = getCartSubtotal();
  const total = getEffectivePDVTotal();
  const amountReceived = Number(getAmountPaidEl()?.value || 0);

  const changeAmount = paymentMethod.toLowerCase() === 'dinheiro'
    ? Math.max(0, amountReceived - total)
    : 0;

  const operator = getCurrentCashOperator();

  const notes = [
    installmentInfo?.count ? `Pagamento parcelado em ${installmentInfo.count}x` : null,
    pdvCardMachineInfo ? `Maquininha: ${pdvCardMachineInfo.name} (${pdvCardMachineInfo.mode}) - taxa ${pdvCardMachineInfo.rate}%` : null,
    pdvPaymentDiscount > 0 ? `Desconto ${isPixMethod() ? 'PIX' : 'dinheiro'} de ${formatCurrency(pdvPaymentDiscount)} aplicado` : null
  ].filter(Boolean).join(' | ') || null;

  return {
    items: cart.map((item) => ({
      productId: item.id,
      productName: item.name,
      name: item.name,
      code: item.code || null,
      barcode: item.barcode || null,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.price || 0),
      cost: Number(item.cost || 0),
      discount: Number(item.discount || 0),
      total: Number(item.total || 0),
      unit: item.unit || null
    })),

    paymentMethod,
    subtotal: subtotalBeforePayDiscount + getCartDiscountTotal(),
    discount: getCartDiscountTotal() + pdvPaymentDiscount,
    total,
    amountReceived,
    amountPaid: amountReceived,
    changeAmount,
    installments: installmentInfo?.count || 1,
    notes,
    cardMachineName: pdvCardMachineInfo?.name || null,
    cardMachineMode: pdvCardMachineInfo?.mode || null,
    cardMachineRate: pdvCardMachineInfo?.rate || null,
    cardNetAmount: pdvCardMachineInfo ? pdvCardMachineInfo.net : null,
    paymentDiscount: pdvPaymentDiscount || null,

    cashSessionId: state.cashSession?.id || null,

    operatorId: operator?.id || state.currentUser?.id || null,
    operatorName: operator?.name || state.currentUser?.name || '',
    operatorCpf: operator?.cpf || state.currentUser?.cpf || '',
    operatorPin: operator?.controlPin || state.currentUser?.controlPin || '',

    terminalName: getCurrentTerminalName(),

    customerName:  currentSaleCustomer?.name  || null,
    customerCpf:   currentSaleCustomer?.cpf   || null,
    customerPhone: currentSaleCustomer?.phone || null,
  };
}

async function refreshSalesState() {
  const sales = await loadSales();

  if (Array.isArray(sales)) {
    state.sales = sales;
  } else {
    state.sales = [];
  }
}

// Único ponto que persiste venda (F10/#finalizeSaleBtn, #pmConfirm do modal e
// pollMercadoPagoStatus convergem aqui). Uma venda em voo por vez: duplo
// clique/F10 repetido durante o POST /v1/sales era capaz de criar duas vendas.
// O lock é liberado em sucesso E falha, então a tentativa seguinte é sempre
// aceita; o erro original continua propagando para o chamador.
const _saleSingleFlight = createSingleFlight();

async function persistApprovedSale(payload) {
  const result = await _saleSingleFlight(() => _persistApprovedSaleOnce(payload));
  if (result.skipped) {
    showToast('A venda já está sendo finalizada. Aguarde.', 'warning');
  }
}

async function _persistApprovedSaleOnce(payload) {
  const createdSale = await createSaleService(payload);

  if (createdSale) {
    state.sales = Array.isArray(state.sales) ? state.sales : [];
    state.sales.unshift(createdSale);

    if (Array.isArray(state.products)) {
      createdSale.items?.forEach((saleItem) => {
        const product = state.products.find(
          (p) => String(p.id) === String(saleItem.productId)
        );

        if (!product) return;

        const currentStock = Number(product.stock || 0);
        product.stock = Math.max(0, currentStock - Number(saleItem.quantity || 0));
      });
    }
  } else {
    await refreshSalesState();
  }

  audit('sale_created', {
    saleId: createdSale?.id || null,
    total: Number(createdSale?.total || payload.total || 0),
    paymentMethod: payload.paymentMethod,
    items: payload.items,
    operator: getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });

  try {
    addHistory?.(
      'Venda',
      `Venda concluída • ${getCurrentTerminalName()} • ${getCurrentCashOperator()?.name || state.currentUser?.name || 'Operador'}`,
      Number(createdSale?.total || payload.total || 0)
    );
  } catch {}

  document.dispatchEvent(new CustomEvent('gamby:sales-updated'));

  // Salvar dados para o botão "Imprimir" do modal de conclusão
  _lastReceiptSale    = createdSale;
  _lastReceiptPayload = payload;

  // Impressão automática — sempre ocorre ao finalizar venda
  // cart ainda disponível aqui; será limpo apenas ao fechar o modal de conclusão
  try { printSaleReceipt(createdSale, payload); } catch (printErr) {
    console.warn('[PDV] Falha na impressão automática:', printErr);
  }

  // Modal de conclusão — botão "Imprimir" usa _lastReceiptSale / _lastReceiptPayload
  _showSaleCompleteModal(createdSale, payload);
}

async function finalizeSale() {
  if (!isPDVPageActive()) return;

  const simplified = isSimplifiedMode();

  // Modo controlado: exige caixa aberto obrigatoriamente
  if (!simplified && !isCashOpen()) {
    showToast('Abra o caixa antes de vender.', 'warning');
    return;
  }

  // Modo controlado: exige identificação do operador (safety net — não pede PIN novamente se já validado)
  if (!simplified && !state.operatorPinValidated) {
    const operatorOk = await requirePDVOperatorSession('finalizeSale');
    if (!operatorOk) {
      showToast('Operador não identificado.', 'warning');
      return;
    }
    state.operatorPinValidated = true;
  }

  if (!cart.length) {
    showToast('Adicione itens antes de finalizar.', 'warning');
    focusPDVInput();
    return;
  }

  const paymentMethod = getReadablePaymentMethod().toLowerCase();
  const total = getEffectivePDVTotal();

  // Sem forma selecionada → exige escolha via modal de pagamento
  if (!getPaymentMethodField()?.value) {
    showToast('Selecione a forma de pagamento.', 'warning');
    _openPaymentModal();
    return;
  }

  // "Misto" → abrir modal de pagamento misto
  if (paymentMethod === 'misto' || paymentMethod === 'mixed') {
    _openPaymentModal();
    return;
  }

  // "A prazo" → exige cliente cadastrado
  if (paymentMethod === 'a prazo') {
    if (!currentSaleCustomer?.id) {
      showToast('Selecione um cliente para venda a prazo.', 'warning');
      return;
    }
  }

  const amountPaid = Number(getAmountPaidEl()?.value || 0);
  if (paymentMethod === 'dinheiro' && amountPaid < total) {
    showToast('Informe o valor recebido igual ou maior que o total da venda.', 'warning');
    getAmountPaidEl()?.focus();
    getAmountPaidEl()?.select?.();
    return;
  }

  try {
    const payload = buildSalePayload();

    // BUG REAL DE STAGING (2026-09-16): POST /v1/mercadopago/pdv-payment
    // está desabilitada de propósito no backend (501 not_implemented — o
    // valor não era validado contra uma venda real; ver
    // mercadopago.routes.js). PIX/boleto/Mercado Pago QR/Point continuam
    // registrando a venda normalmente por aqui, como qualquer outra forma
    // de pagamento — sem tentar abrir um pagamento ao vivo pela integração
    // desabilitada. A função de pagamento ao vivo e o detector de método
    // Mercado Pago ficam sem caller neste fluxo (não reimplementados nem
    // removidos nesta correção — fora de escopo).
    await persistApprovedSale(payload);
  } catch (error) {
    console.error('Erro ao finalizar venda:', error);

    audit('sale_create_error', {
      error: error?.message || String(error),
      operator: getCurrentCashOperator(),
      terminalName: getCurrentTerminalName()
    });

    showToast(error?.message || 'Erro ao finalizar venda.', 'error');
  }
}

/* ================= CANCELAMENTO ================= */

async function executeCancelSale(id, reason) {
  const saleId = String(id || '').trim();
  const cancelReason = String(reason || '').trim() || 'Cancelamento manual';

  if (!saleId) {
    showToast('Venda inválida para cancelamento.', 'warning');
    return;
  }

  try {
    // Usar state.sales já carregado (painel estava aberto) — evitar re-fetch que pode
    // retornar IDs diferentes e causar "não encontrada" mesmo com a venda existindo.
    let saleBeforeCancel = Array.isArray(state.sales)
      ? state.sales.find((sale) => String(sale.id) === saleId)
      : null;

    // Fallback: tentar refresh apenas se a venda não foi encontrada localmente
    if (!saleBeforeCancel) {
      await refreshSalesState();
      saleBeforeCancel = Array.isArray(state.sales)
        ? state.sales.find((sale) => String(sale.id) === saleId)
        : null;
    }

    if (!saleBeforeCancel) {
      showToast('Venda não encontrada na lista carregada. Atualize o histórico e tente novamente.', 'warning');

      audit('sale_cancel_not_found', {
        saleId,
        operator: getCurrentCashOperator(),
        terminalName: getCurrentTerminalName()
      });

      return;
    }

    const alreadyCancelled =
      saleBeforeCancel.cancelled ||
      saleBeforeCancel.isCancelled ||
      saleBeforeCancel.status === 'cancelled';

    if (alreadyCancelled) {
      showToast('Essa venda já está cancelada.', 'warning');

      audit('sale_cancel_already_cancelled', {
        saleId,
        operator: getCurrentCashOperator(),
        terminalName: getCurrentTerminalName()
      });

      return;
    }

    // Fase 2 (D4.3/D4.4): backend é a fonte da verdade — nenhuma mutação
    // local (marcar cancelada, devolver estoque, renderizar) acontece
    // ANTES da confirmação real do servidor. A versão anterior aplicava
    // tudo isso "otimisticamente" e só ENTÃO chamava o backend; como
    // cancelSaleService() engolia qualquer erro do backend (catch vazio),
    // um 403/422/500 nunca desfazia a mutação local — a UI ficava mostrando
    // "cancelada" e estoque devolvido mesmo quando o backend rejeitou.
    // Agora: chama o backend primeiro; só depois de sucesso real (sem
    // exceção) é que o estado local é atualizado.
    await cancelSaleService(saleId, cancelReason);

    // Só a partir daqui sabemos que o backend confirmou o cancelamento —
    // aplicar as mesmas mutações de antes, agora depois da confirmação
    // (não há endpoint de reload de produtos disponível neste módulo para
    // revalidar o estoque a partir do servidor; refreshSalesState() só
    // recarrega vendas, não produtos — ver app.js:2922-2937).
    saleBeforeCancel.status      = 'cancelled';
    saleBeforeCancel.cancelled   = true;
    saleBeforeCancel.isCancelled = true;
    saleBeforeCancel.cancelReason  = cancelReason;
    saleBeforeCancel.cancelledAt   = new Date().toISOString();

    if (Array.isArray(saleBeforeCancel.items) && Array.isArray(state.products)) {
      saleBeforeCancel.items.forEach((saleItem) => {
        const productId = saleItem.productId || saleItem.id;
        const product = state.products.find((p) => String(p.id) === String(productId));
        if (!product) return;
        product.stock = Number(product.stock || 0) + Number(saleItem.quantity || 0);
      });
    }

    audit('sale_cancelled', {
      saleId,
      sale: saleBeforeCancel,
      operator: getCurrentCashOperator(),
      terminalName: getCurrentTerminalName()
    });

    try {
      addHistory?.(
        'Venda',
        `Venda cancelada manualmente • ID ${saleId}`,
        0
      );
    } catch {}

    showToast('Venda cancelada com sucesso.');
    document.dispatchEvent(new CustomEvent('gamby:sales-updated'));

    // Revalidar vendas a partir do servidor (fonte de verdade) em cima da
    // mutação local já confirmada.
    await refreshSalesState();
    renderRecentSales();
  } catch (error) {
    console.error('Erro ao cancelar venda:', error);

    try {
      audit('sale_cancel_error', {
        saleId,
        error: error?.message || String(error),
        operator: getCurrentCashOperator(),
        terminalName: getCurrentTerminalName()
      });
    } catch {}

    showToast(error?.message || 'Erro ao cancelar venda.', 'error');

    // Fase 2 (D4.3/D4.4): nenhuma mutação local foi feita antes desta
    // falha — nada para desfazer. Revalida mesmo assim, por segurança
    // (ex.: se o backend processou a operação mas a resposta se perdeu
    // na rede, o próximo refresh reflete o estado real do servidor em
    // vez do estado local desatualizado).
    try {
      await refreshSalesState();
      renderRecentSales();
    } catch {}
  }
}

/* ================= AÇÕES PROTEGIDAS ================= */

async function protectedCancelCurrentSale() {
  if (!Array.isArray(cart) || cart.length === 0) {
    showToast('Não há venda atual para cancelar.', 'warning');
    return;
  }

  const action = async () => {
    audit('current_sale_cancelled', {
      cart,
      total: getCartSubtotal(),
      operator: getCurrentCashOperator(),
      terminalName: getCurrentTerminalName()
    });

    clearCurrentSale();
    showToast('Venda atual cancelada.');
  };

  // Modo controlado: sempre exige supervisor; modo simplificado: cancela livremente
  const requireAuth = !isSimplifiedMode() || Boolean(state?.pdvSettings?.requireAuthCancelSale);

  if (requireAuth && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(action, { forceAuth: true });
    return;
  }

  await action();
}

async function protectedCancelLastSale() {
  const lastSale = Array.isArray(state.sales)
    ? state.sales.find((sale) => !sale.cancelled && sale.status !== 'cancelled')
    : null;

  if (!lastSale) {
    showToast('Nenhuma venda feita para cancelar.', 'warning');
    return;
  }

  const action = async () => {
    await executeCancelSale(lastSale.id);
  };

  const requireAuth = !isSimplifiedMode() || Boolean(state?.pdvSettings?.requireAuthCancelSale);

  if (requireAuth && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(action, { forceAuth: true });
    return;
  }

  await action();
}

/* ── Modal: confirmar cancelamento de venda finalizada ──────────────────────── */

let _cancelSaleId   = null;
let _cancelSaleReason = null;

function _openCancelSaleModal(saleId) {
  _cancelSaleId   = String(saleId || '').trim();
  _cancelSaleReason = null;

  const sale = Array.isArray(state.sales)
    ? state.sales.find((s) => String(s.id) === _cancelSaleId)
    : null;

  const infoEl = document.getElementById('pdvCancelSaleInfo');
  if (infoEl) {
    const date  = sale?.createdAt ? new Date(sale.createdAt).toLocaleString('pt-BR') : '—';
    const total = formatCurrency(sale?.total || 0);
    const pm    = _esc(sale?.paymentMethod || '—');
    infoEl.innerHTML = `
      <div class="pdv-cancel-sale-info-row"><span>Total</span><strong>${total}</strong></div>
      <div class="pdv-cancel-sale-info-row"><span>Pagamento</span><span>${pm}</span></div>
      <div class="pdv-cancel-sale-info-row"><span>Data</span><span>${date}</span></div>
    `;
  }

  const reasonEl = document.getElementById('pdvCancelSaleReason');
  if (reasonEl) reasonEl.value = '';

  const hintEl = document.getElementById('pdvCancelSaleHint');
  if (hintEl) { hintEl.textContent = ''; hintEl.className = 'pdv-cancel-sale-hint'; }

  document.getElementById('pdvCancelSaleModal')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('pdvCancelSaleReason')?.focus(), 40);
}

function _closeCancelSaleModal() {
  document.getElementById('pdvCancelSaleModal')?.classList.add('hidden');
  _cancelSaleId   = null;
  _cancelSaleReason = null;
}

async function _confirmCancelSale() {
  const hintEl   = document.getElementById('pdvCancelSaleHint');
  const reasonEl = document.getElementById('pdvCancelSaleReason');
  const reason   = String(reasonEl?.value || '').trim();

  if (reason.length < 10) {
    if (hintEl) { hintEl.textContent = 'O motivo deve ter pelo menos 10 caracteres.'; hintEl.className = 'pdv-cancel-sale-hint is-error'; }
    reasonEl?.focus();
    return;
  }

  _cancelSaleReason = reason;
  const saleId = _cancelSaleId;

  _closeCancelSaleModal();

  const action = async () => {
    await executeCancelSale(saleId, _cancelSaleReason || reason);
    renderRecentSales();  // safety net: garante atualização mesmo se executeCancelSale sair cedo
  };

  const requireAuth = !isSimplifiedMode() || Boolean(state?.pdvSettings?.requireAuthCancelSale);

  if (requireAuth && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(action, { forceAuth: true, actionType: 'cancel-sale' });
    return;
  }

  await action();
}

function _bindCancelSaleModal() {
  const overlay = document.getElementById('pdvCancelSaleModal');
  if (!overlay) return;

  document.getElementById('pdvCancelSaleCloseBtn')?.addEventListener('click', _closeCancelSaleModal);
  document.getElementById('pdvCancelSaleBackBtn')?.addEventListener('click', _closeCancelSaleModal);
  document.getElementById('pdvCancelSaleConfirmBtn')?.addEventListener('click', _confirmCancelSale);

  document.getElementById('pdvCancelSaleReason')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); _closeCancelSaleModal(); }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _closeCancelSaleModal();
  });
}

async function protectedCancelLastSaleById(saleId) {
  const id = String(saleId || '').trim();
  if (!id) { showToast('Venda inválida.', 'warning'); return; }
  _openCancelSaleModal(id);
}

async function protectedCloseCash() {
  if (!state.cashSession?.isOpen) {
    showToast('Nenhum caixa aberto para fechar.', 'warning');
    return;
  }

  const action = async () => {
    audit('cash_close_requested', {
      terminalName: getCurrentTerminalName(),
      operator: getCurrentCashOperator(),
      cashSession: state.cashSession
    });

    await closeCashSession();

    audit('cash_closed_from_pdv', {
      terminalName: getCurrentTerminalName(),
      operator: getCurrentCashOperator()
    });
  };

  // Modo controlado: sempre exige senha. Modo simplificado: só exige se
  // requireAuthCloseCash estiver habilitado nas configurações do PDV.
  const requireAuth = !isSimplifiedMode() || Boolean(state?.pdvSettings?.requireAuthCloseCash);

  if (requireAuth && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(action, { forceAuth: true });
    return;
  }

  await action();
}

/* ================= VENDAS RECENTES ================= */

// Painel "Recentes" do PDV (Alt+H) mostra apenas as últimas 48h — histórico
// completo, sem limite de tempo, continua disponível na aba Histórico do sistema.
const RECENT_SALES_WINDOW_MS = 48 * 60 * 60 * 1000;

function _isWithinRecentWindow(sale) {
  if (!sale?.createdAt) return false;
  const createdAt = new Date(sale.createdAt).getTime();
  if (Number.isNaN(createdAt)) return false;
  return (Date.now() - createdAt) < RECENT_SALES_WINDOW_MS;
}

function _getRecentSales() {
  return Array.isArray(state.sales)
    ? state.sales.filter(_isWithinRecentWindow).slice(0, 100)
    : [];
}

function _updateRecentBadge(sales) {
  const count = Array.isArray(sales)
    ? sales.filter((s) => !s.cancelled && !s.isCancelled && s.status !== 'cancelled').length
    : 0;
  const badge = document.getElementById('pdvRecentBadge');
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count === 0);
}

function renderRecentSales() {
  const wrap = getRecentSalesWrap();
  if (!wrap) return;

  const sales = _getRecentSales();

  _updateRecentBadge(sales);

  if (!sales.length) {
    wrap.innerHTML = `<tr><td colspan="6" class="muted">Nenhuma venda recente.</td></tr>`;
    return;
  }

  wrap.innerHTML = sales.map((sale) => {
    const date = sale.createdAt
      ? new Date(sale.createdAt).toLocaleString('pt-BR')
      : '—';

    const itemsCount = Array.isArray(sale.items)
      ? sale.items.reduce((acc, item) => acc + Number(item.quantity || 0), 0)
      : Number(sale.itemsCount || 0);

    const cancelled = Boolean(
      sale.cancelled ||
      sale.isCancelled ||
      sale.status === 'cancelled'
    );

    // Painel Recentes: cancelar só é permitido dentro da janela de 48h. Fora
    // dela, o operador é direcionado à aba Histórico (sem limite, para admin).
    const canCancel = !cancelled && _isWithinRecentWindow(sale);

    const opName = sale.operatorName || sale.operator?.name || '';

    return `
      <tr>
        <td>${date}</td>
        <td>${itemsCount}</td>
        <td>${_esc(sale.paymentMethod || '—')}</td>
        <td>${formatCurrency(sale.total || 0)}</td>
        <td>
          <div class="rpt-op-cell pdv-op-muted">
            ${_pdvAv(opName)}${_esc(opName || '—')}
          </div>
        </td>
        <td>
          ${cancelled
            ? '<span class="mini">Cancelada</span>'
            : (canCancel
                ? `<button class="btn btn-danger" data-cancel-sale-id="${_esc(sale.id)}" type="button">Cancelar</button>`
                : '<span class="mini">—</span>')
          }
        </td>
      </tr>
    `;
  }).join('');
}

/* ================= SCANNER ================= */

function bindBarcodeScanner() {
  const field = getSearchField();
  if (!field || field.dataset.scannerBound === 'true') return;

  field.dataset.scannerBound = 'true';

  // Detecção de velocidade de digitação para distinguir scanner de teclado manual.
  // Scanners HID tipicamente enviam todos os caracteres em < 50ms e terminam com Enter.
  // Detecção de scan rápido: ≥ 4 caracteres em < SCAN_MAX_MS → auto-add sem precisar de Enter
  // (ex: impressora de etiqueta mal configurada sem terminador, ou simulador de teclado rápido).
  const SCAN_MAX_MS = 80; // ms entre o primeiro e o último caractere para ser considerado scan
  const SCAN_MIN_CHARS = 4; // mínimo de caracteres para ativar a detecção automática
  let _firstKeyTime = 0;
  let _charCount    = 0;
  let _scanTimer    = null;

  field.addEventListener('keydown', (event) => {
    const key = event.key;

    if (key === 'Enter') {
      event.preventDefault();
      clearTimeout(_scanTimer);
      _firstKeyTime = 0;
      _charCount    = 0;
      addItemToCart();
      return;
    }

    // Rastrear velocidade de digitação apenas para caracteres imprimíveis
    if (key.length !== 1) return;

    const now = Date.now();
    if (_charCount === 0) {
      _firstKeyTime = now;
    }
    _charCount++;

    // Se o scanner não enviar Enter (atípico), auto-adicionar após pausa
    clearTimeout(_scanTimer);
    _scanTimer = setTimeout(() => {
      const elapsed = Date.now() - _firstKeyTime;
      const isLikelyScan = _charCount >= SCAN_MIN_CHARS && elapsed <= SCAN_MAX_MS * _charCount;
      if (isLikelyScan && field.value.trim().length >= SCAN_MIN_CHARS) {
        addItemToCart();
      }
      _firstKeyTime = 0;
      _charCount    = 0;
    }, SCAN_MAX_MS + 20); // espera um pouco além do intervalo esperado de scan
  });
}

/* ================= HEADER STATUS ================= */

function updatePDVHeader() {
  const operator = getCurrentCashOperator();
  const terminal = getCurrentTerminalName();
  const isOpen = Boolean(state.cashSession?.isOpen);

  const statusEl = document.getElementById('pdvHdrStatus');
  if (statusEl) {
    statusEl.textContent = isOpen ? 'ABERTO' : 'FECHADO';
    statusEl.className = isOpen ? 'pdv-hdr-status-open' : 'pdv-hdr-status-closed';
  }

  const opEl = document.getElementById('pdvHdrOperator');
  if (opEl) {
    const opName = operator?.name || state.currentUser?.name || '';
    if (opName && typeof window.renderUserAvatar === 'function') {
      const avHtml = window.renderUserAvatar(
        { name: opName, photoUrl: window.getUserAvatar?.(opName) || null, role: operator?.role || state.currentUser?.role || '' },
        { cls: 'pdv-op-av' }
      );
      opEl.innerHTML = `${avHtml}<strong>${_esc(opName)}</strong>`;
    } else {
      opEl.textContent = opName || '—';
    }
  }

  const termEl = document.getElementById('pdvHdrTerminal');
  if (termEl) termEl.textContent = terminal || '—';
}

/* ================= INIT ================= */

export async function initSales() {
  await refreshSalesState();
  _restoreKioskState();  // restaurar carrinho/PIN antes de renderizar
  renderRecentSales();
  renderCart();
  updatePDVHeader();

  if (!isPDVPageActive()) {
    return;
  }

  const simplified = isSimplifiedMode();
  // debug: inspecione window._pdvDebug no console do browser
  window._pdvDebug = { pdvMode: state?.pdvSettings?.pdvMode ?? 'simplified', requireOperator: !simplified };

  if (!simplified) {
    if (!state.cashSession?.isOpen) {
      showToast('Caixa fechado. Abra o caixa antes de vender.', 'warning');
      return;
    }

    // Pedir PIN apenas se não validado nesta sessão (evita reprompt após F5 ou showPDVOpenCashChoice)
    if (!state.operatorPinValidated) {
      const operatorOk = await requirePDVOperatorSession('initSales');
      if (!operatorOk) {
        audit('operator_session_required_cancelled', { page: 'pdv' });
        return;
      }
      state.operatorPinValidated = true;
    }
  }

  _updateKioskDebug();

  persistCurrentPage();
  focusPDVInput();

  audit('pdv_initialized', {
    operator: getCurrentCashOperator(),
    terminalName: getCurrentTerminalName()
  });
}

/* ================= GUARD ================= */

function bindKioskGuard() {
  if (kioskGuardBound) return;
  kioskGuardBound = true;

  // ── beforeunload: salva estado e bloqueia saída com caixa aberto ─────────
  window.addEventListener('beforeunload', (event) => {
    _saveKioskState(); // sempre persiste antes de qualquer unload
    if (!state.cashSession?.isOpen) return;
    if (!isPDVPageActive()) return;
    event.preventDefault();
    event.returnValue = 'Existe um caixa aberto em operação.';
  });

  // ── popstate: bloquear botão Voltar/Avançar do browser ───────────────────
  window.addEventListener('popstate', () => {
    if (!isKioskActive()) return;
    // Re-push para travar URL — impede navegação pelo histórico do browser
    history.pushState(null, '', location.href);
    _updateKioskDebug({ navigationBlocked: true, lastBlockedAction: 'popstate' });
    showToast('Navegação bloqueada. PDV em operação.', 'warning');
  });

  // Registra posição inicial no histórico para garantir que popstate dispare
  if (isPDVPageActive()) {
    history.pushState(null, '', location.href);
  }

  // ── history.pushState / replaceState: bloquear navegação SPA ─────────────
  if (!window.__gambyHistoryPatched) {
    window.__gambyHistoryPatched = true;
    const _orig = { push: history.pushState.bind(history), replace: history.replaceState.bind(history) };
    const _patch = (fn, name) => function (...args) {
      if (isKioskActive()) {
        const _url = String(args[2] || '');
        // Permitir apenas se a URL for a própria página (sem rota diferente)
        const _curPath = location.pathname + location.search;
        if (_url && _url !== _curPath && !_url.includes('#pdv')) {
          _updateKioskDebug({ navigationBlocked: true, lastBlockedAction: `history.${name}` });
          return;
        }
      }
      return fn.apply(this, args);
    };
    history.pushState    = _patch(_orig.push,    'pushState');
    history.replaceState = _patch(_orig.replace, 'replaceState');
  }

  // ── Navegação via nav-btn em modo kiosk: delegada ao gov-nav.js ─────────
  // O kiosk guard de navegação foi movido para gov-nav.navigate(), que executa
  // o mesmo fluxo (operador → bloqueio permanente, outros → admin-password)
  // de forma centralizada e auditada.
  // Esta seção foi removida na implantação da PDV Governance Layer.

  // ── Logout: bloqueado com caixa aberto; exige auth em modo controlado ─────
  document.addEventListener('click', (event) => {
    const logoutBtn = event.target?.closest?.('[data-action="logout"]');
    if (!logoutBtn) return;
    if (!isPDVPageActive()) return;
    if (!isKioskActive()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    _updateKioskDebug({ logoutBlocked: true, lastBlockedAction: 'logout' });

    if (state.cashSession?.isOpen) {
      // Caixa aberto: logout impossível sem fechar o caixa primeiro
      showToast('Feche o caixa antes de sair do sistema.', 'warning');
      audit('logout_blocked_cash_open', { operator: getCurrentCashOperator(), terminalName: getCurrentTerminalName() });
      return;
    }

    // Modo controlado sem caixa: exige senha admin antes do logout
    if (!isSimplifiedMode() && typeof window.openSecureCashCloseModal === 'function') {
      _updateKioskDebug({ adminAuthRequested: true });
      window.openSecureCashCloseModal(() => {
        _updateKioskDebug({ adminAuthGranted: true, logoutBlocked: false });
        audit('logout_authorized_controlled', { operator: getCurrentCashOperator(), terminalName: getCurrentTerminalName() });
        logoutBtn.click();
      }, { forceAuth: true });
    }
  }, true);

  // Inicializar debug
  _updateKioskDebug();
}

/* ================= CLIENTE RÁPIDO (F6) ================= */

function _pdvUpdateClientDisplay() {
  const el = document.getElementById('pdvClientDisplay');
  if (!el) return;
  if (currentSaleCustomer?.name) {
    el.innerHTML = `<strong style="color:var(--accent,#f59e0b)">${_esc(currentSaleCustomer.name)}</strong>${currentSaleCustomer.cpf ? ` <small style="color:var(--muted2)">${_esc(currentSaleCustomer.cpf)}</small>` : ''}`;
  } else {
    el.textContent = 'Consumidor final';
  }
  // Atualizar customerName em vendas em espera se houver cliente
  const clearBtn = document.getElementById('pdvClientClearBtn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !currentSaleCustomer?.name);
}

function _openCustomerModal() {
  const modal = document.getElementById('pdvCustomerModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Preencher com dados existentes se já identificado
  const nameEl = document.getElementById('pdvCustName');
  const cpfEl  = document.getElementById('pdvCustCpf');
  const phoneEl = document.getElementById('pdvCustPhone');
  if (nameEl)  nameEl.value  = currentSaleCustomer?.name  || '';
  if (cpfEl)   cpfEl.value   = currentSaleCustomer?.cpf   || '';
  if (phoneEl) phoneEl.value = currentSaleCustomer?.phone || '';
  setTimeout(() => nameEl?.focus(), 50);
}

function _closeCustomerModal() {
  document.getElementById('pdvCustomerModal')?.classList.add('hidden');
  focusPDVInput();
}

function _confirmCustomer() {
  const name  = String(document.getElementById('pdvCustName')?.value  || '').trim();
  const cpf   = String(document.getElementById('pdvCustCpf')?.value   || '').trim();
  const phone = String(document.getElementById('pdvCustPhone')?.value || '').trim();
  if (!name && !cpf && !phone) { _closeCustomerModal(); return; }
  currentSaleCustomer = { name: name || (cpf || phone), cpf, phone };
  _pdvUpdateClientDisplay();
  _closeCustomerModal();
  showToast(`Cliente identificado: ${currentSaleCustomer.name}`, 'success');
}

function _bindCustomerModal() {
  const modal   = document.getElementById('pdvCustomerModal');
  const confirm = document.getElementById('pdvCustConfirmBtn');
  const cancel  = document.getElementById('pdvCustCancelBtn');
  const clear   = document.getElementById('pdvClientClearBtn');

  confirm?.addEventListener('click', _confirmCustomer);
  cancel?.addEventListener('click',  _closeCustomerModal);
  clear?.addEventListener('click', () => {
    currentSaleCustomer = null;
    _pdvUpdateClientDisplay();
    showToast('Cliente removido.', 'info');
  });

  modal?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { _closeCustomerModal(); return; }
    if (e.key === 'Enter') {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input') {
        // Tab-forward entre campos, confirmar no último
        const inputs = Array.from(modal.querySelectorAll('input'));
        const idx = inputs.indexOf(e.target);
        if (idx >= 0 && idx < inputs.length - 1) { inputs[idx + 1]?.focus(); }
        else { _confirmCustomer(); }
        e.preventDefault();
      }
    }
  });
}

/* ================= VENDA EM ESPERA ================= */

function _listSuspendedSales() {
  try {
    const raw = localStorage.getItem(_SUSPENDED_SALES_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function _saveSuspendedSales(list) {
  try { localStorage.setItem(_SUSPENDED_SALES_KEY, JSON.stringify(list)); } catch {}
}

function _suspendCurrentSale() {
  if (!Array.isArray(cart) || cart.length === 0) {
    showToast('Carrinho vazio. Nada para suspender.', 'warning');
    return false;
  }
  const sales = _listSuspendedSales();
  const seq   = String(sales.length + 1).padStart(3, '0');
  const suspended = {
    id:           `VE-${Date.now()}`,
    seq,
    operatorName: getCurrentCashOperator()?.name || state.currentUser?.name || '',
    terminalName: getCurrentTerminalName() || '',
    createdAt:    new Date().toISOString(),
    customerName: currentSaleCustomer?.name || null,
    items:        JSON.parse(JSON.stringify(cart)),
    paymentMethod: getPaymentMethodField()?.value || '',
    amountPaid:   Number(getAmountPaidEl()?.value || 0),
    total:        getEffectivePDVTotal(),
    note:         null,
  };
  sales.push(suspended);
  _saveSuspendedSales(sales);

  audit('sale_suspended', {
    id: suspended.id, seq: suspended.seq, total: suspended.total,
    itemCount: cart.length, operator: getCurrentCashOperator(), terminalName: getCurrentTerminalName(),
  });

  clearCurrentSale();
  _updateSuspendedBadge();
  showToast(`Venda ${suspended.id} suspensa. Carrinho liberado.`, 'success');
  focusPDVInput();
  return true;
}

function _resumeSuspendedSale(id) {
  const sales = _listSuspendedSales();
  const idx   = sales.findIndex((s) => s.id === id);
  if (idx === -1) { showToast('Venda em espera não encontrada.', 'warning'); return false; }
  const suspended = sales[idx];

  if (Array.isArray(cart) && cart.length > 0) {
    if (!window.confirm(`Substituir carrinho atual pela venda ${suspended.id}?`)) return false;
    clearCurrentSale();
  }

  cart.push(...JSON.parse(JSON.stringify(suspended.items)));

  setTimeout(() => {
    const pmField = getPaymentMethodField();
    if (pmField && suspended.paymentMethod) {
      pmField.value = suspended.paymentMethod;
      pmField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const apEl = getAmountPaidEl();
    if (apEl && suspended.amountPaid > 0) {
      apEl.value = suspended.amountPaid;
      apEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, 80);

  // Remover da lista de espera
  sales.splice(idx, 1);
  _saveSuspendedSales(sales);
  _updateSuspendedBadge();
  renderCart();
  _closeSuspendedPanel();

  audit('sale_resumed', {
    id: suspended.id, seq: suspended.seq, total: suspended.total,
    itemCount: suspended.items.length, operator: getCurrentCashOperator(), terminalName: getCurrentTerminalName(),
  });

  showToast(`Venda ${suspended.id} recuperada.`, 'success');
  focusPDVInput();
  return true;
}

function _cancelSuspendedSale(id) {
  const _do = () => {
    const sales = _listSuspendedSales();
    const idx   = sales.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const removed = sales.splice(idx, 1)[0];
    _saveSuspendedSales(sales);
    _updateSuspendedBadge();
    audit('sale_suspended_cancelled', {
      id: removed.id, seq: removed.seq, total: removed.total,
      operator: getCurrentCashOperator(), terminalName: getCurrentTerminalName(),
    });
    showToast(`Venda ${removed.id} cancelada.`, 'info');
    _renderSuspendedPanel();
  };
  if (!isSimplifiedMode() && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(_do, { forceAuth: true });
  } else {
    _do();
  }
}

function _updateSuspendedBadge() {
  const badge = document.getElementById('pdvSuspendedBadge');
  if (!badge) return;
  const count = _listSuspendedSales().length;
  badge.textContent = String(count);
  badge.classList.toggle('hidden', count === 0);
}

function _renderSuspendedPanel() {
  const tbody = document.getElementById('pdvSuspendedTableBody');
  if (!tbody) return;
  const sales = _listSuspendedSales();
  if (sales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="pdv-empty-row">Nenhuma venda em espera.</td></tr>';
    return;
  }
  tbody.innerHTML = sales.map((s) => {
    const time  = new Date(s.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const total = formatCurrency(s.total);
    const cust  = _esc(s.customerName || 'Não identificado');
    return `<tr>
      <td>${_esc(s.id)}</td>
      <td>${cust}</td>
      <td>${s.items.length} iten${s.items.length !== 1 ? 's' : ''}</td>
      <td>${total}</td>
      <td>${time}</td>
      <td class="pdv-suspended-actions">
        <button class="btn btn-sm btn-primary" type="button" data-resume-id="${_esc(s.id)}">Recuperar</button>
        <button class="btn btn-sm btn-ghost"   type="button" data-cancel-id="${_esc(s.id)}">Cancelar</button>
      </td>
    </tr>`;
  }).join('');
}

function _openSuspendedPanel() {
  _renderSuspendedPanel();
  document.getElementById('pdvSuspendedPanel')?.classList.remove('hidden');
}

function _closeSuspendedPanel() {
  document.getElementById('pdvSuspendedPanel')?.classList.add('hidden');
}

function _bindSuspendedPanelEvents() {
  document.getElementById('pdvCloseSuspendedBtn')?.addEventListener('click', _closeSuspendedPanel);
  document.getElementById('pdvSuspendedPanel')?.addEventListener('click', (e) => {
    const resumeBtn = e.target.closest('[data-resume-id]');
    if (resumeBtn) { _resumeSuspendedSale(resumeBtn.dataset.resumeId); return; }
    const cancelBtn = e.target.closest('[data-cancel-id]');
    if (cancelBtn) { _cancelSuspendedSale(cancelBtn.dataset.cancelId); }
  });
  document.getElementById('pdvToggleSuspendedBtn')?.addEventListener('click', () => {
    const hasItems = Array.isArray(cart) && cart.length > 0;
    if (hasItems) { _suspendCurrentSale(); } else { _openSuspendedPanel(); }
  });
}

/* ================= MODAL VENDA FINALIZADA ================= */

function _showSaleCompleteModal(createdSale, payload) {
  const modal = document.getElementById('pdvSaleCompleteModal');

  // Apagar carrinho do localStorage assim que a venda é gravada (F5 não restaura venda já paga)
  localStorage.removeItem(_KIOSK_CART_KEY);

  if (!modal) {
    showToast('Venda finalizada com sucesso!', 'success');
    clearCurrentSale();
    renderRecentSales();
    focusPDVInput();
    return;
  }

  const total = formatCurrency(createdSale?.total ?? payload?.total ?? 0);
  const pm    = _esc(payload?.paymentMethod || createdSale?.paymentMethod || '—');
  const count = payload?.items?.length ?? createdSale?.items?.length ?? 0;
  const summaryEl = document.getElementById('pdvSaleCompleteSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `Total: <strong>${total}</strong> &nbsp;•&nbsp; ${pm} &nbsp;•&nbsp; ${count} iten${count !== 1 ? 's' : ''}`;
  }

  // Aplicar configurações de visibilidade dos botões opcionais
  const cfg = state?.pdvSettings || {};
  const showPrint    = cfg.saleCompleteShowPrint    ?? true;
  const showWhatsApp = cfg.saleCompleteShowWhatsApp ?? false;
  const showEmail    = cfg.saleCompleteShowEmail    ?? false;
  const hasAnyOption = showPrint || showWhatsApp || showEmail;

  const printBtn    = document.getElementById('pdvSaleCompletePrint');
  const waBtn       = document.getElementById('pdvSaleCompleteWhatsApp');
  const emailBtn    = document.getElementById('pdvSaleCompleteEmail');

  if (printBtn)  printBtn.classList.toggle('hidden', !showPrint);
  if (waBtn)     waBtn.classList.toggle('hidden',    !showWhatsApp);
  if (emailBtn)  emailBtn.classList.toggle('hidden', !showEmail);

  if (modal._autoCloseTimer) clearTimeout(modal._autoCloseTimer);
  modal.classList.remove('hidden');

  if (!hasAnyOption) {
    // Sem opções ativas → auto-close em 2s com countdown no botão "Nova venda"
    const newBtn = document.getElementById('pdvSaleCompleteNew');
    let remaining = 2;
    const originalLabel = newBtn?.textContent || 'Nova venda';
    if (newBtn) newBtn.textContent = `Nova venda (${remaining}s)`;

    const tick = setInterval(() => {
      remaining--;
      if (newBtn) newBtn.textContent = remaining > 0 ? `Nova venda (${remaining}s)` : originalLabel;
      if (remaining <= 0) {
        clearInterval(tick);
        _closeSaleCompleteModal();
      }
    }, 1000);

    modal._autoCloseTimer = setTimeout(() => {
      clearInterval(tick);
      if (document.getElementById('pdvSaleCompleteNew')) {
        document.getElementById('pdvSaleCompleteNew').textContent = originalLabel;
      }
      _closeSaleCompleteModal();
    }, 2000);
  } else {
    modal._autoCloseTimer = setTimeout(_closeSaleCompleteModal, 60_000);
  }

  // Foco automático em "Nova venda" — operador opera sem mouse
  requestAnimationFrame(() => {
    document.getElementById('pdvSaleCompleteNew')?.focus();
  });
}

function _closeSaleCompleteModal() {
  const modal = document.getElementById('pdvSaleCompleteModal');
  if (modal) {
    if (modal._autoCloseTimer) clearTimeout(modal._autoCloseTimer);
    modal.classList.add('hidden');
  }
  clearCurrentSale();
  renderRecentSales();
  focusPDVInput();
}

function _bindSaleCompleteModal() {
  const modal = document.getElementById('pdvSaleCompleteModal');

  document.getElementById('pdvSaleCompletePrint')?.addEventListener('click', () => {
    try { printSaleReceipt(_lastReceiptSale, _lastReceiptPayload); } catch {}
  });
  document.getElementById('pdvSaleCompleteWhatsApp')?.addEventListener('click', () => {
    showToast('Envio por WhatsApp em breve.', 'info');
  });
  document.getElementById('pdvSaleCompleteEmail')?.addEventListener('click', () => {
    showToast('Envio por e-mail em breve.', 'info');
  });
  document.getElementById('pdvSaleCompleteNew')?.addEventListener('click', _closeSaleCompleteModal);
  document.getElementById('pdvSaleCompleteClose')?.addEventListener('click', _closeSaleCompleteModal);

  // ── Navegação por teclado (operação sem mouse) ────────────────────────────
  if (!modal) return;

  modal.addEventListener('keydown', (e) => {
    if (modal.classList.contains('hidden')) return;

    const key = e.key;
    const focusable = [...modal.querySelectorAll('button:not([disabled])')];
    const currentIdx = focusable.indexOf(document.activeElement);

    // Esc = fechar modal (equivalente a "Nova venda")
    if (key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      _closeSaleCompleteModal();
      return;
    }

    // Atalhos de letra enquanto modal estiver aberto
    if (key === 'p' || key === 'P') {
      e.preventDefault(); e.stopPropagation();
      document.getElementById('pdvSaleCompletePrint')?.click();
      return;
    }
    if (key === 'w' || key === 'W') {
      e.preventDefault(); e.stopPropagation();
      document.getElementById('pdvSaleCompleteWhatsApp')?.click();
      return;
    }
    if (key === 'e' || key === 'E') {
      e.preventDefault(); e.stopPropagation();
      document.getElementById('pdvSaleCompleteEmail')?.click();
      return;
    }

    // Setas e Tab → navegar entre botões (focus trap dentro do modal)
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      focusable[(currentIdx + 1) % focusable.length]?.focus();
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      focusable[(currentIdx - 1 + focusable.length) % focusable.length]?.focus();
      return;
    }
    if (key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) {
        focusable[(currentIdx - 1 + focusable.length) % focusable.length]?.focus();
      } else {
        focusable[(currentIdx + 1) % focusable.length]?.focus();
      }
    }
  });
}

/* ================= ATALHOS ================= */

function _pdvRemoveLastCartItem() {
  if (!Array.isArray(cart) || cart.length === 0) {
    showToast('Carrinho vazio.', 'warning');
    return false;
  }
  const _do = () => {
    const removed = cart.splice(cart.length - 1, 1)[0];
    renderCart();
    showToast(`"${removed?.name || 'Item'}" removido do carrinho.`, 'info');
    audit('cart_item_cancelled_f7', { item: removed, operator: getCurrentCashOperator() });
    focusPDVInput();
  };
  const requireAuth = !isSimplifiedMode() || Boolean(state?.pdvSettings?.requireAuthCancelSale);
  if (requireAuth && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(_do, { forceAuth: true });
    return true;
  }
  _do();
  return true;
}

/* ───── F7 Cancel-Item Modal ──────────────────────────────────────────────── */

function _pdvCloseCancelItemModal() {
  document.getElementById('pdvCancelItemModal')?.classList.add('hidden');
  focusPDVInput();
}

function _pdvRenderCancelItemList() {
  const list = document.getElementById('pdvCancelItemList');
  if (!list) return;
  list.innerHTML = cart.map((item, i) => `
    <li class="pdv-cancel-item-row"
        data-cancel-idx="${i}"
        data-item-qty="${item.quantity}"
        tabindex="0"
        role="option"
        aria-selected="false">
      <span class="pdv-cancel-item-check" aria-hidden="true"></span>
      <span class="pdv-cancel-item-name">${_esc(item.name)}</span>
      <span class="pdv-cancel-item-qty-ctrl">
        <span class="pdv-cancel-qty-txt">Qtd a remover:</span>
        <input class="pdv-cancel-qty-input"
               type="number"
               min="1"
               max="${item.quantity}"
               value="1"
               tabindex="0"
               aria-label="Quantidade a remover de ${_esc(item.name)}">
        <span class="pdv-cancel-qty-of">de ${item.quantity}</span>
      </span>
      <span class="pdv-cancel-item-unit" data-unit-price="${item.price || 0}">${formatCurrency(item.price || 0)}/un</span>
    </li>
  `).join('');

  list.querySelectorAll('.pdv-cancel-qty-input').forEach(input => {
    input.addEventListener('input', _onCancelQtyChange);
  });
}

function _onCancelQtyChange(e) {
  const input = e.target;
  const row = input.closest('.pdv-cancel-item-row');
  if (!row) return;
  const unitPrice = Number(row.querySelector('.pdv-cancel-item-unit')?.dataset.unitPrice || 0);
  const max = Number(input.max || 1);
  const qty = Math.min(Math.max(1, Number(input.value) || 1), max);
  const unitEl = row.querySelector('.pdv-cancel-item-unit');
  if (unitEl) {
    unitEl.textContent = qty > 1
      ? formatCurrency(unitPrice * qty)
      : `${formatCurrency(unitPrice)}/un`;
  }
}

function _pdvConfirmCancelSelected() {
  const list = document.getElementById('pdvCancelItemList');
  const selected = [...(list?.querySelectorAll('.pdv-cancel-item-row.selected') || [])];
  if (selected.length === 0) {
    showToast('Selecione ao menos um item para cancelar.', 'warning');
    return;
  }

  const removals = selected.map(el => {
    const idx    = Number(el.dataset.cancelIdx);
    const maxQty = Number(el.dataset.itemQty) || 1;
    const inputQty = Number(el.querySelector('.pdv-cancel-qty-input')?.value || 1);
    const qty    = Math.min(Math.max(1, inputQty), maxQty);
    return { idx, qty };
  }).filter(r => r.idx >= 0 && r.idx < cart.length);

  if (removals.length === 0) { _pdvCloseCancelItemModal(); return; }

  const toSplice  = [];
  const toReduce  = [];

  removals.forEach(({ idx, qty }) => {
    const item = cart[idx];
    if (!item) return;
    if (qty >= item.quantity) toSplice.push(idx);
    else toReduce.push({ idx, qty });
  });

  // Partial reductions first — don't shift indices
  toReduce.forEach(({ idx, qty }) => {
    const item = cart[idx];
    if (!item) return;
    item.quantity -= qty;
    item.total = item.quantity * item.price - Number(item.discount || 0);
  });

  // Full removals in reverse index order
  const removed = [];
  toSplice.sort((a, b) => b - a).forEach(idx => {
    const [item] = cart.splice(idx, 1);
    if (item) removed.push(item);
  });

  renderCart();

  if (removed.length === 1 && toReduce.length === 0) {
    showToast(`"${removed[0]?.name || 'Item'}" removido do carrinho.`, 'info');
  } else if (removed.length > 1 && toReduce.length === 0) {
    showToast(`${removed.length} itens removidos do carrinho.`, 'info');
  } else {
    showToast('Carrinho atualizado.', 'info');
  }

  audit('cart_items_cancelled_f7', { removed, partial: toReduce, operator: getCurrentCashOperator() });
  _pdvCloseCancelItemModal();
}

function _pdvCancelAllCartItems() {
  if (!Array.isArray(cart) || cart.length === 0) return;
  const removed = [...cart];
  cart.length = 0;
  renderCart();
  showToast('Todos os itens foram removidos do carrinho.', 'info');
  audit('cart_all_cancelled_f7', { items: removed, operator: getCurrentCashOperator() });
  _pdvCloseCancelItemModal();
}

function _pdvOpenCancelItemModalInner() {
  if (!Array.isArray(cart) || cart.length === 0) {
    showToast('Carrinho vazio.', 'warning');
    return;
  }
  _pdvRenderCancelItemList();
  const overlay = document.getElementById('pdvCancelItemModal');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  const firstRow = overlay.querySelector('.pdv-cancel-item-row');
  (firstRow || overlay.querySelector('#pdvCancelItemCloseBtn'))?.focus();
}

function _pdvOpenCancelItemModal() {
  if (!Array.isArray(cart) || cart.length === 0) {
    showToast('Carrinho vazio.', 'warning');
    return;
  }
  const requireAuth = !isSimplifiedMode() || Boolean(state?.pdvSettings?.requireAuthCancelSale);
  if (requireAuth && typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(_pdvOpenCancelItemModalInner, { forceAuth: true });
    return;
  }
  _pdvOpenCancelItemModalInner();
}

function _bindCancelItemModal() {
  const overlay = document.getElementById('pdvCancelItemModal');
  if (!overlay) return;

  overlay.addEventListener('keydown', (e) => {
    // When focus is inside the qty input, only intercept Enter/Escape
    if (e.target.classList.contains('pdv-cancel-qty-input')) {
      if (e.key === 'Enter') { e.preventDefault(); _pdvConfirmCancelSelected(); }
      if (e.key === 'Escape') { e.preventDefault(); _pdvCloseCancelItemModal(); }
      return;
    }

    const items = [...overlay.querySelectorAll('.pdv-cancel-item-row')];
    const focused = overlay.querySelector('.pdv-cancel-item-row:focus');
    const idx = items.indexOf(focused);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[Math.min(idx + 1, items.length - 1)]?.focus();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[Math.max(idx - 1, 0)]?.focus();
      return;
    }
    if (e.key === ' ' && focused) {
      e.preventDefault();
      focused.classList.toggle('selected');
      focused.setAttribute('aria-selected', String(focused.classList.contains('selected')));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      _pdvConfirmCancelSelected();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _pdvCloseCancelItemModal();
      return;
    }
  });
}

function _pdvSetPaymentMethod(keywords) {
  const sel = getPaymentMethodField();
  if (!sel) return false;
  const opt = Array.from(sel.options).find((o) =>
    keywords.some((k) => o.value.toLowerCase().includes(k) || o.text.toLowerCase().includes(k))
  );
  if (!opt) return false;
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function _pdvCloseActiveModal() {
  // Prioridade: modal de pagamento misto
  const payModal = document.getElementById('pdvPaymentModal');
  if (payModal) { _closePaymentModal(); return true; }
  // Modal de conclusão de venda — Esc = Nova venda
  const saleCompleteModal = document.getElementById('pdvSaleCompleteModal');
  if (saleCompleteModal && !saleCompleteModal.classList.contains('hidden')) {
    _closeSaleCompleteModal();
    return true;
  }
  const weightModal = document.getElementById('pdvWeightModal');
  if (weightModal && !weightModal.classList.contains('hidden')) {
    document.getElementById('pdvWeightCancelBtn')?.click();
    return true;
  }
  const cancelItemModal = document.getElementById('pdvCancelItemModal');
  if (cancelItemModal && !cancelItemModal.classList.contains('hidden')) {
    _pdvCloseCancelItemModal();
    return true;
  }
  if (typeof window.closeSecureCashCloseModal === 'function') {
    const overlay = document.getElementById('secureCashActionOverlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      window.closeSecureCashCloseModal();
      return true;
    }
  }
  const recentPanel = document.getElementById('pdvRecentPanel');
  if (recentPanel && !recentPanel.classList.contains('hidden')) {
    document.getElementById('pdvCloseRecentBtn')?.click();
    return true;
  }
  return false;
}

function bindPDVKeyboardShortcuts() {
  if (window.__gambyPDVHotkeysBound) return;
  window.__gambyPDVHotkeysBound = true;
  window._authDebug = window._authDebug || {};
  window._authDebug.shortcutListenerInstalled = true;

  window._pdvShortcuts = {
    'F2':    'Buscar produto (foco no campo de busca)',
    'F3':    'Alterar quantidade (foco no campo de quantidade)',
    'F4':    'Aplicar desconto',
    'F5':    'Nova venda / limpar carrinho',
    'F6':    'Identificar cliente (CPF/Telefone/Nome)',
    'F7':    'Selecionar e cancelar itens do carrinho (auth em modo controlado)',
    'F8':    'Suspender venda [em breve]',
    'F9':    'Abrir tela de pagamento',
    'F10':   'Confirmar pagamento e concluir venda',
    'Enter': 'Confirmar / adicionar produto (fora de inputs)',
    'Esc':   'Fechar modal ativo',
    '*':     'Aumentar quantidade (fora de inputs)',
    '-':     'Diminuir quantidade (fora de inputs)',
    'Alt+P': 'Selecionar PIX',
    'Alt+D': 'Selecionar Dinheiro',
    'Alt+C': 'Selecionar Cartão',
    'Alt+V': 'Selecionar Voucher',
    'Alt+S': 'Sangria (requer auth)',
    'Alt+U': 'Suprimento (requer auth)',
    'Alt+O': 'Trocar operador',
    'Alt+G': 'Solicitar autorização gerencial',
    'Alt+X': 'Fechar caixa',
    'Alt+A': 'Abrir caixa',
  };

  let hotkeyLock = false;

  document.addEventListener('keydown', async (event) => {
    const key  = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    const alt  = event.altKey;

    // Apenas F2-F10 são mapeados — F1/F11/F12 pertencem ao browser
    const isMappedFKey = /^F[2-9]$/.test(key) || key === 'F10';

    const pdvActive = isPDVPageActive();

    // Bloquear F2-F10 no PDV antes de qualquer outro listener (capture phase)
    if (pdvActive && isMappedFKey && !ctrl && !alt) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }

    // Bloquear Alt+combos mapeados para evitar defaults do browser (ex: Alt+D = barra de endereços no Firefox)
    const _altMapped = 'pPdDcCvVsSeEuUoOgGxXaAhH';
    const isAltCombo = alt && !ctrl && _altMapped.includes(key);
    if (pdvActive && isAltCombo) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }

    // Debug em toda tecla relevante — mesmo fora do PDV
    const _isTracked = isMappedFKey || isAltCombo || key === '*' || key === '-' || key === 'Enter' || key === 'Escape';
    if (_isTracked) {
      window._authDebug = window._authDebug || {};
      window._authDebug.shortcutLastKey = key;
      window._shortcutDebug = { key, pdvActive, targetFound: null, action: null, executed: false, ts: new Date().toISOString() };
    }

    if (!pdvActive) return;

    // Modal aberto — deixar o overlay gerir todos os eventos.
    // pdvPaymentModal: dinâmico (criado/removido via JS) — checar visibilidade.
    // pdvCancelItemModal: SEMPRE no DOM como HTML estático com class="hidden" —
    // checar apenas existência causaria return eterno mesmo com modal fechado.
    const payModal    = document.getElementById('pdvPaymentModal');
    const cancelModal = document.getElementById('pdvCancelItemModal');
    const isPayModalOpen    = payModal    && !payModal.classList.contains('hidden');
    const isCancelModalOpen = cancelModal && !cancelModal.classList.contains('hidden') && cancelModal.style.display !== 'none';
    if (isPayModalOpen || isCancelModalOpen) return;

    const el      = document.activeElement;
    const tag     = el?.tagName?.toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el?.isContentEditable);

    const isF2  = key === 'F2';
    const isF3  = key === 'F3';
    const isF4  = key === 'F4';
    const isF5  = key === 'F5';
    const isF6  = key === 'F6';
    const isF7  = key === 'F7';
    const isF8  = key === 'F8';
    const isF9  = key === 'F9';
    const isF10 = key === 'F10';

    const isAltP = alt && (key === 'p' || key === 'P');
    const isAltD = alt && (key === 'd' || key === 'D');
    const isAltC = alt && (key === 'c' || key === 'C');
    const isAltV = alt && (key === 'v' || key === 'V');
    const isAltS = alt && (key === 's' || key === 'S');
    const isAltU = alt && (key === 'u' || key === 'U');
    const isAltO = alt && (key === 'o' || key === 'O');
    const isAltG = alt && (key === 'g' || key === 'G');
    const isAltX = alt && (key === 'x' || key === 'X');
    const isAltA = alt && (key === 'a' || key === 'A');
    const isAltH = alt && (key === 'h' || key === 'H');

    const isAsterisk = !inInput && !alt && !ctrl && (key === '*' || event.code === 'NumpadMultiply');
    const isMinus    = !inInput && !alt && !ctrl && (key === '-' || event.code === 'NumpadSubtract' || event.code === 'Minus');
    // Enter funciona: fora de qualquer input OU quando o foco está no campo de busca
    const isSaleSearchFocused = el?.id === 'saleProductCode';
    const isEnter    = key === 'Enter' && (!inInput || isSaleSearchFocused);
    const isEsc      = key === 'Escape';

    const isActive =
      isF2||isF3||isF4||isF5||isF6||isF7||isF8||isF9||isF10||
      isAltP||isAltD||isAltC||isAltV||isAltS||isAltU||isAltO||isAltG||isAltX||isAltA||isAltH||
      isAsterisk||isMinus||isEnter||isEsc;

    if (!isActive) return;

    if (isAsterisk || isMinus) event.preventDefault();
    // Prevenir submit nativo quando Enter dispara do campo de busca
    if (isEnter && isSaleSearchFocused) event.preventDefault();

    if (hotkeyLock) return;
    hotkeyLock = true;

    const _dbg = window._shortcutDebug;

    try {
      // ── F-keys ───────────────────────────────────────────
      if (isF2) {
        const sf = getSearchField();
        if (_dbg) { _dbg.targetFound = Boolean(sf); _dbg.action = 'saleProductCode.focus'; }
        if (sf) setTimeout(() => { sf.focus(); sf.select?.(); }, 30);
        if (_dbg) _dbg.executed = Boolean(sf);
        return;
      }

      if (isF3) {
        const qf = getQuantityField();
        if (_dbg) { _dbg.targetFound = Boolean(qf); _dbg.action = 'saleQuantity.focus'; }
        if (qf) setTimeout(() => { qf.focus(); qf.select?.(); }, 30);
        if (_dbg) _dbg.executed = Boolean(qf);
        return;
      }

      if (isF4) {
        const btn = document.getElementById('pdvDiscountBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'pdvDiscountBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      if (isF5) {
        // Se o modal de conclusão de venda estiver aberto, F5 fecha o modal
        // (equivalente a "Nova venda") em vez de limpar o carrinho diretamente.
        const _saleModal = document.getElementById('pdvSaleCompleteModal');
        if (_saleModal && !_saleModal.classList.contains('hidden')) {
          if (_dbg) { _dbg.targetFound = true; _dbg.action = 'closeSaleCompleteModal (F5)'; }
          _closeSaleCompleteModal();
          if (_dbg) _dbg.executed = true;
          return;
        }
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'clearCurrentSale'; }
        clearCurrentSale();
        if (_dbg) _dbg.executed = true;
        return;
      }

      if (isF6) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'openCustomerModal'; }
        _openCustomerModal();
        if (_dbg) _dbg.executed = true;
        return;
      }

      if (isF7) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'openCancelItemModal'; }
        _pdvOpenCancelItemModal();
        if (_dbg) _dbg.executed = true;
        return;
      }

      if (isF8) {
        const hasCartItems = Array.isArray(cart) && cart.length > 0;
        if (_dbg) { _dbg.targetFound = true; _dbg.action = hasCartItems ? 'suspendCurrentSale' : 'openSuspendedPanel'; }
        const ok = hasCartItems ? _suspendCurrentSale() : (_openSuspendedPanel(), true);
        if (_dbg) _dbg.executed = Boolean(ok);
        return;
      }

      if (isF9) {
        if (Array.isArray(cart) && cart.length > 0) {
          // Com itens: abrir modal de pagamento
          if (_dbg) { _dbg.targetFound = true; _dbg.action = 'openPaymentModal'; }
          _openPaymentModal();
          if (_dbg) _dbg.executed = true;
        } else {
          // Sem itens: avisar
          if (_dbg) { _dbg.targetFound = false; _dbg.action = 'F9-carrinho-vazio'; }
          showToast('Adicione itens antes de ir para pagamento.', 'warning');
          if (_dbg) _dbg.executed = false;
        }
        return;
      }

      if (isF10) {
        const btn = document.getElementById('finalizeSaleBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'finalizeSaleBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      // ── Enter / Esc / ± ──────────────────────────────────
      if (isEnter) {
        // Prioridade 1: confirmar modal de autenticação se estiver aberto
        const secureOverlay = document.getElementById('secureCashActionOverlay');
        const secureConfirm = secureOverlay && !secureOverlay.classList.contains('hidden')
          ? (secureOverlay.querySelector('[data-confirm]') || secureOverlay.querySelector('button[type="submit"]') || secureOverlay.querySelector('.btn-confirm') || null)
          : null;
        if (secureConfirm) {
          if (_dbg) { _dbg.targetFound = true; _dbg.action = 'secureModal.confirm'; }
          secureConfirm.click();
          if (_dbg) _dbg.executed = true;
          return;
        }
        // Prioridade 2: adicionar produto ao carrinho (campo busca focado ou fora de input)
        const btn = document.getElementById('addToCartBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'addToCartBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      if (isEsc) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'closeActiveModal'; }
        const closed = _pdvCloseActiveModal();
        if (_dbg) _dbg.executed = closed;
        return;
      }

      if (isAsterisk) {
        const btn = document.getElementById('pdvQtyIncBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'pdvQtyIncBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      if (isMinus) {
        const btn = document.getElementById('pdvQtyDecBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'pdvQtyDecBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      // ── Alt + combos financeiros ──────────────────────────
      if (isAltP) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'setPayment:PIX'; }
        const _okP = _pdvSetPaymentMethod(['pix']);
        if (_dbg) _dbg.executed = _okP;
        return;
      }

      if (isAltD) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'setPayment:Dinheiro'; }
        const _okD = _pdvSetPaymentMethod(['dinheiro', 'cash']);
        if (_dbg) _dbg.executed = _okD;
        return;
      }

      if (isAltC) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'setPayment:Cartão'; }
        const _okC = _pdvSetPaymentMethod(['cartão', 'cartao', 'card', 'débito', 'crédito']);
        if (_dbg) _dbg.executed = _okC;
        return;
      }

      if (isAltV) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'setPayment:Voucher'; }
        const _okV = _pdvSetPaymentMethod(['voucher']);
        if (_dbg) _dbg.executed = _okV;
        return;
      }

      // ── Alt + combos administrativos ─────────────────────
      if (isAltS) {
        if (_dbg) { _dbg.targetFound = false; _dbg.action = 'sangria [sem acesso direto no PDV]'; }
        showToast('Sangria: use o menu lateral ou Configurações > Movimentações.', 'info');
        if (_dbg) _dbg.executed = false;
        return;
      }

      if (isAltU) {
        if (_dbg) { _dbg.targetFound = false; _dbg.action = 'suprimento [sem acesso direto no PDV]'; }
        showToast('Suprimento: use o menu lateral ou Configurações > Movimentações.', 'info');
        if (_dbg) _dbg.executed = false;
        return;
      }

      if (isAltO) {
        const btn = document.getElementById('pdvSwitchOperatorBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'pdvSwitchOperatorBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      if (isAltG) {
        if (_dbg) { _dbg.targetFound = true; _dbg.action = 'openSecureCashCloseModal (auth gerencial)'; }
        if (typeof window.openSecureCashCloseModal === 'function') {
          window.openSecureCashCloseModal(() => { showToast('Autorização gerencial concedida.', 'success'); }, { forceAuth: true });
        }
        if (_dbg) _dbg.executed = true;
        return;
      }

      if (isAltH) {
        const btn = document.getElementById('pdvToggleRecentBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'pdvToggleRecentBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      if (isAltX) {
        const btn = document.getElementById('pdvCloseCashBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'pdvCloseCashBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

      if (isAltA) {
        const btn = document.getElementById('cashClosedOpenCashBtn') || document.getElementById('openCashBtn');
        if (_dbg) { _dbg.targetFound = Boolean(btn); _dbg.action = 'openCashBtn.click'; }
        btn?.click();
        if (_dbg) _dbg.executed = Boolean(btn);
        return;
      }

    } finally {
      setTimeout(() => { hotkeyLock = false; }, 350);
    }
  }, true);
}

/* ================= WEB SERIAL ================= */

async function _readWeightViaSerial() {
  const statusEl    = document.getElementById('pdvWeightSerialStatus');
  const weightInput = document.getElementById('pdvWeightInput');

  function _setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className   = `pdv-weight-serial-status ${cls || ''}`;
  }

  if (!('serial' in navigator)) {
    _setStatus('API Web Serial não disponível. Use Chrome/Edge ou bipé etiqueta da balança.', 'serial-unavailable');
    return;
  }

  _setStatus('Aguardando seleção de porta...', 'serial-connecting');

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (_) {
    _setStatus('Seleção de porta cancelada.', '');
    return;
  }

  const cfg = _scaleConfig || {};
  const baudRate = Number(cfg.baudRate ?? 9600);

  try {
    await port.open({ baudRate });
  } catch (err) {
    _setStatus(`Erro ao abrir porta: ${err.message}`, 'serial-error');
    return;
  }

  _setStatus('Conectado. Aguardando peso...', 'serial-connected');

  const reader = port.readable.getReader();
  let raw = '';
  const timeout = setTimeout(async () => {
    try { await reader.cancel(); } catch (_) {}
  }, 5000);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += new TextDecoder().decode(value);
      const match = raw.match(/(\d+[.,]\d+)/);
      if (match) {
        clearTimeout(timeout);
        const parsed = parseFloat(match[1].replace(',', '.'));
        if (!isNaN(parsed) && parsed > 0) {
          if (weightInput) weightInput.value = parsed.toFixed(3);
          weightInput?.dispatchEvent(new Event('input'));
          _setStatus(`Peso lido: ${parsed.toFixed(3)} kg`, 'serial-ok');
        }
        break;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      _setStatus(`Erro na leitura: ${err.message}`, 'serial-error');
    } else {
      _setStatus('Tempo esgotado. Verifique a balança e tente novamente.', 'serial-error');
    }
  } finally {
    try { reader.releaseLock(); await port.close(); } catch (_) {}
  }
}

/* ================= WEIGHT MODAL ================= */

function _bindWeightModal() {
  const modal        = document.getElementById('pdvWeightModal');
  const closeBtn     = document.getElementById('pdvWeightModalCloseBtn');
  const cancelBtn    = document.getElementById('pdvWeightCancelBtn');
  const confirmBtn   = document.getElementById('pdvWeightConfirmBtn');
  const weightInput  = document.getElementById('pdvWeightInput');
  const serialWrap   = document.getElementById('pdvWeightSerialWrap');
  const serialBtn    = document.getElementById('pdvWeightReadSerialBtn');

  /* Show Web Serial button only when scale config uses serial and API is supported */
  function _updateSerialBtnVisibility() {
    const cfg        = _scaleConfig || {};
    const isSerial   = ['serial', 'usb_serial', 'tcp_ip'].includes(cfg.connectionType);
    const hasApi     = 'serial' in navigator;
    if (serialWrap) serialWrap.classList.toggle('hidden', !(isSerial && hasApi));
  }
  _updateSerialBtnVisibility();

  serialBtn?.addEventListener('click', () => _readWeightViaSerial());

  function _close() {
    modal?.classList.add('hidden');
    if (modal) modal._pendingProduct = null;
    const statusEl = document.getElementById('pdvWeightSerialStatus');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'pdv-weight-serial-status'; }
    focusPDVInput();
  }

  closeBtn?.addEventListener('click',  _close);
  cancelBtn?.addEventListener('click', _close);

  confirmBtn?.addEventListener('click', () => {
    const product = modal?._pendingProduct;
    if (!product) { _close(); return; }

    const weightKg = parseFloat(weightInput?.value || '0') || 0;
    if (weightKg <= 0) {
      showToast('Informe o peso do produto.', 'warning');
      weightInput?.focus();
      return;
    }

    audit('manual_weight_entry', {
      productId:    product.id,
      productName:  product.name,
      weightKg,
      operator:     getCurrentCashOperator(),
      terminalName: getCurrentTerminalName()
    });

    _close();
    _addWeightItemToCart(product, weightKg);
  });

  weightInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn?.click();
    if (e.key === 'Escape') _close();
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) _close();
  });
}

/* ================= MODO DE OPERAÇÃO ================= */

/**
 * Retorna true se o PDV estiver em modo simplificado (padrão).
 * Modo simplificado: dono único / MEI — sem exigência de operador, supervisor ou caixa aberto.
 * Modo controlado : equipes — exige operador, caixa aberto, supervisor para ações críticas.
 */
function isSimplifiedMode() {
  return (state?.pdvSettings?.pdvMode ?? 'simplified') === 'simplified';
}

/* ================= BLOQUEIO POR INATIVIDADE ================= */

let _inactivityTimer = null;
let _inactivityBound = false;

function _resetInactivityTimer() {
  const cfg = state?.pdvSettings;
  if (!cfg?.inactivityLockEnabled) return;
  clearTimeout(_inactivityTimer);
  const ms = Math.max(1, cfg.inactivityLockMinutes || 15) * 60 * 1000;
  _inactivityTimer = setTimeout(_triggerInactivityLock, ms);
}

function _triggerInactivityLock() {
  if (!isPDVPageActive()) return;
  if (typeof window.openSecureCashCloseModal === 'function') {
    window.openSecureCashCloseModal(() => { _resetInactivityTimer(); }, { forceAuth: true });
  }
}

function _startInactivityLock() {
  const cfg = state?.pdvSettings;
  if (!cfg?.inactivityLockEnabled) return;

  clearTimeout(_inactivityTimer);
  const ms = Math.max(1, cfg.inactivityLockMinutes || 15) * 60 * 1000;
  _inactivityTimer = setTimeout(_triggerInactivityLock, ms);

  if (!_inactivityBound) {
    _inactivityBound = true;
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev => {
      document.addEventListener(ev, _resetInactivityTimer, { passive: true });
    });
  }
}

/**
 * Aplica configurações do PDV que dependem de state.pdvSettings.
 * Chamado do app.js após o carregamento assíncrono das configurações.
 */
export function applyPdvSettings() {
  // Reinicia o timer de inatividade com os novos valores
  clearTimeout(_inactivityTimer);
  _inactivityTimer = null;
  _startInactivityLock();
}

/* ================= BIND PRINCIPAL ================= */

export function bindPDVActions() {
  if (pdvActionsBound) return;
  pdvActionsBound = true;

  _loadScaleConfig();

  bindKioskGuard();
  bindPDVKeyboardShortcuts();
  bindBarcodeScanner();
  _bindSearchDropdown();
  _bindWeightModal();
  _bindCancelItemModal();
  _bindCancelSaleModal();
  _bindSuspendedPanelEvents();
  _bindSaleCompleteModal();
  _bindCustomerModal();
  _updateSuspendedBadge();
  _pdvUpdateClientDisplay();

  if (!window.__gambyPDVClockBound) {
    window.__gambyPDVClockBound = true;
    setInterval(() => {
      const el = document.getElementById('pdvHdrClock');
      if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
    }, 1000);
  }

  // updatePDVHeader() só era chamada dentro de initSales() (navegação para o
  // PDV) — depois de abrir/fechar caixa com sucesso (openCashSession() /
  // closeCashSession(), em cash-session.js), state.cashSession.isOpen mudava
  // mas o badge "#pdvHdrStatus" no header ficava com o valor antigo até um
  // reload forçar initSales() a rodar de novo. cash-session.js já dispara
  // 'gamby:cash-opened'/'gamby:cash-closed' nesses fluxos — só faltava algo
  // ouvindo para re-renderizar o header.
  if (!window.__gambyPDVHeaderSyncBound) {
    window.__gambyPDVHeaderSyncBound = true;
    document.addEventListener('gamby:cash-opened', () => updatePDVHeader());
    document.addEventListener('gamby:cash-closed', () => updatePDVHeader());
  }

  // Inatividade — tentativa inicial; re-aplicado via applyPdvSettings() após load
  _startInactivityLock();

  document.addEventListener('click', async (event) => {
    if (!isPDVPageActive()) return;

    if (event.target.closest('#addToCartBtn')) {
      event.preventDefault();
      addItemToCart();
      return;
    }

    if (event.target.closest('#finalizeSaleBtn')) {
      event.preventDefault();
      await finalizeSale();
      return;
    }

    if (event.target.closest('#printReceiptBtn')) {
      event.preventDefault();
      printSaleReceipt();
      return;
    }

    if (event.target.closest('#pdvDiscountBtn')) {
      event.preventDefault();
      applyDiscountPrompt();
      focusPDVInput();
      return;
    }

    if (event.target.closest('#pdvInstallmentBtn')) {
      event.preventDefault();
      requestInstallments();
      focusPDVInput();
      return;
    }

    if (event.target.closest('#clearSaleBtn')) {
      event.preventDefault();

      if (Array.isArray(cart) && cart.length > 0) {
        await protectedCancelCurrentSale();
      } else {
        await protectedCancelLastSale();
      }

      return;
    }

    if (event.target.closest('#pdvCloseCashBtn')) {
      event.preventDefault();
      await protectedCloseCash();
      return;
    }

    // ── Novos botões da grade — sincronizados com atalhos reais ──────────────
    if (event.target.closest('#pdvFocusSearchBtn')) {
      event.preventDefault();
      const sf = getSearchField();
      if (sf) setTimeout(() => { sf.focus(); sf.select?.(); }, 30);
      return;
    }

    if (event.target.closest('#pdvFocusQtyBtn')) {
      event.preventDefault();
      const qf = getQuantityField();
      if (qf) setTimeout(() => { qf.focus(); qf.select?.(); }, 30);
      return;
    }

    if (event.target.closest('#pdvFocusPaymentBtn')) {
      event.preventDefault();
      if (Array.isArray(cart) && cart.length > 0) {
        _openPaymentModal();
      } else {
        showToast('Adicione itens antes de ir para pagamento.', 'warning');
      }
      return;
    }

    if (event.target.closest('#pdvCancelLastItemBtn')) {
      event.preventDefault();
      _pdvOpenCancelItemModal();
      return;
    }

    if (event.target.closest('#pdvCancelItemCloseBtn') || event.target.closest('#pdvCancelItemCloseBtn2')) {
      event.preventDefault();
      _pdvCloseCancelItemModal();
      return;
    }

    if (event.target.closest('#pdvCancelItemConfirmBtn')) {
      event.preventDefault();
      _pdvConfirmCancelSelected();
      return;
    }

    if (event.target.closest('#pdvCancelItemAllBtn')) {
      event.preventDefault();
      _pdvCancelAllCartItems();
      return;
    }

    const cancelItemRow = event.target.closest('.pdv-cancel-item-row');
    if (cancelItemRow && !event.target.classList.contains('pdv-cancel-qty-input')) {
      event.preventDefault();
      cancelItemRow.classList.toggle('selected');
      cancelItemRow.setAttribute('aria-selected', String(cancelItemRow.classList.contains('selected')));
      return;
    }

    if (event.target.closest('#pdvCustomerBtn')) {
      event.preventDefault();
      _openCustomerModal();
      return;
    }

    const removeBtn = event.target.closest('[data-remove-cart-index]');

    if (removeBtn) {
      event.preventDefault();

      const index = Number(removeBtn.dataset.removeCartIndex);

      if (!Number.isInteger(index) || index < 0 || index >= cart.length) {
        return;
      }

      const removed = cart[index];

      cart.splice(index, 1);
      renderCart();

      audit('cart_item_removed', {
        index,
        item: removed,
        operator: getCurrentCashOperator(),
        terminalName: getCurrentTerminalName()
      });

      return;
    }

    const incBtn = event.target.closest('[data-inc-cart-index]');
    if (incBtn) {
      event.preventDefault();
      const index = Number(incBtn.dataset.incCartIndex);
      if (!Number.isInteger(index) || index < 0 || index >= cart.length) return;
      const item = cart[index];
      const product = Array.isArray(state.products)
        ? state.products.find((p) => String(p.id) === String(item.id))
        : null;
      const maxStock = product ? Number(product.stock || 0) : Infinity;
      if (item.quantity >= maxStock) {
        showToast('Quantidade máxima em estoque atingida.', 'warning');
        return;
      }
      item.quantity += 1;
      item.total = (item.quantity * item.price) - Number(item.discount || 0);
      renderCart();
      return;
    }

    const decBtn = event.target.closest('[data-dec-cart-index]');
    if (decBtn) {
      event.preventDefault();
      const index = Number(decBtn.dataset.decCartIndex);
      if (!Number.isInteger(index) || index < 0 || index >= cart.length) return;
      const item = cart[index];
      if (item.quantity <= 1) {
        cart.splice(index, 1);
      } else {
        item.quantity -= 1;
        item.total = (item.quantity * item.price) - Number(item.discount || 0);
      }
      renderCart();
      return;
    }

    const cancelSaleBtn = event.target.closest('[data-cancel-sale-id]');

    if (cancelSaleBtn) {
      event.preventDefault();

      const saleId = String(cancelSaleBtn.dataset.cancelSaleId || '').trim();
      if (!saleId) return;

      await protectedCancelLastSaleById(saleId);
    }
  });

  document.getElementById('pdvQtyDecBtn')?.addEventListener('click', () => {
    const f = getQuantityField();
    if (f) f.value = Math.max(1, Number(f.value) - 1);
  });

  document.getElementById('pdvQtyIncBtn')?.addEventListener('click', () => {
    const f = getQuantityField();
    if (f) f.value = Number(f.value) + 1;
  });

  document.getElementById('pdvToggleRecentBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('pdvRecentPanel');
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    if (isHidden) renderRecentSales();
    panel.classList.toggle('hidden');
  });

  document.getElementById('pdvSwitchOperatorBtn')?.addEventListener('click', async () => {
    // Perfil ativo (seletor pós-login) em uso: "trocar operador" volta ao
    // seletor de perfil. Trocar quem opera o caixa é uma ação administrativa
    // (poderia ser usada para "virar" Administrador sem permissão) — exige
    // senha admin/gerente ANTES de mostrar o seletor, igual ao fluxo antigo
    // (showSwitchOperatorModal, abaixo) já exigia.
    const _doSwitchProfile = async () => {
      clearActiveProfile();
      document.getElementById('switchProfileBtn')?.classList.add('hidden');
      // releasePDVKioskMode() NÃO é chamado aqui antes de showProfileSelector().
      // showProfileSelector() faz um await (listUsersService()) antes de
      // efetivamente exibir o overlay — liberar o kiosk primeiro revelava a sidebar
      // topbar por baixo por um instante (flash) até o overlay do seletor
      // cobrir a tela. A transição de kiosk é tratada naturalmente por
      // openPageDirect() quando um novo perfil for confirmado (mesmo fluxo já
      // usado na primeira seleção de perfil).
      const shown = await showProfileSelector();
      if (!shown && typeof window.openPageDirect === 'function') {
        window.openPageDirect('dashboard');
      }
    };

    if (state.activeProfile) {
      if (typeof window.openSecureCashCloseModal === 'function') {
        window.openSecureCashCloseModal(_doSwitchProfile, { forceAuth: true });
      } else {
        await _doSwitchProfile();
      }
      return;
    }

    // Sem perfil simulado — fluxo antigo de terminal (PDV standalone, sem
    // seletor): troca de operador exige senha admin, como sempre.
    const doSwitch = async () => {
      const { showSwitchOperatorModal } = await import('./operator-session.js');
      const switched = await showSwitchOperatorModal();
      if (switched) {
        const name = state.currentOperator?.name || '';
        showToast(`Operador trocado: ${name}`, 'success');
      }
    };

    if (typeof window.openSecureCashCloseModal === 'function') {
      window.openSecureCashCloseModal(doSwitch, { forceAuth: true });
      return;
    }

    await doSwitch();
  });

  document.getElementById('pdvCloseRecentBtn')?.addEventListener('click', () => {
    document.getElementById('pdvRecentPanel')?.classList.add('hidden');
  });

  document.getElementById('amountPaid')?.addEventListener('input', updateChangePreview);

  document.getElementById('salePaymentMethod')?.addEventListener('change', () => {
    applyPaymentMethodBenefits();
    updateSummary();

    if (!isMercadoPagoPDVMethod()) {
      clearMercadoPagoUI();
    }

    focusPDVInput();
  });

  document.getElementById('pdvCardMachineSelect')?.addEventListener('change', refreshCardFeeInfo);
  document.getElementById('pdvCardModeSelect')?.addEventListener('change', refreshCardFeeInfo);

  getQuantityField()?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    addItemToCart();
  });

  document.addEventListener('click', (event) => {
    if (!isPDVPageActive()) return;

    const target = event.target;
    const input = getSearchField();

    if (!input) return;
    if (target === input) return;

    const tag = target?.tagName?.toLowerCase?.();

    if (tag === 'button' || target?.closest('button')) return;
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

    focusPDVInput();
  });
}