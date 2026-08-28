import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function getScopedSalesKey() {
  const companyId = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${KEYS.sales}_${companyId}`;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value, fallback = null) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function getCurrentCashContext() {
  const session = state.cashSession || {};
  const operator = session.operator || null;

  return {
    cashSessionId: session.id || null,
    terminalName:
      session.terminalName ||
      state.currentUser?.terminalName ||
      'Caixa principal',
    terminalCode: session.terminalCode || null,
    operatorId:
      session.operatorId ||
      operator?.id ||
      state.currentUser?.id ||
      null,
    operatorName:
      session.operatorName ||
      operator?.name ||
      state.currentUser?.name ||
      null,
    operatorCpf:
      session.operatorCpf ||
      operator?.cpf ||
      state.currentUser?.cpf ||
      null,
    operatorPin:
      session.operatorPin ||
      operator?.controlPin ||
      state.currentUser?.controlPin ||
      null
  };
}

// Mapa de forma de pagamento: nomes do frontend → enum do backend
// Backend espera: 'cash'|'card'|'pix'|'credit'|'debit'|'voucher'|'mixed'|'other'
const _PM_MAP = {
  dinheiro: 'cash',   cash: 'cash',
  cartão:   'card',   cartao: 'card',   card: 'card',
  crédito:  'credit', credito: 'credit', credit: 'credit',
  débito:   'debit',  debito: 'debit',  debit: 'debit',
  pix:      'pix',
  voucher:  'voucher',
  misto:    'mixed',  mixed: 'mixed',
  'a prazo':'other',  aprazo: 'other',
  other:    'other',
};

function mapPaymentMethod(pm) {
  if (!pm) return 'cash';
  const key = String(pm).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acentos
  return _PM_MAP[key] || 'other';
}

// null/undefined → undefined (Zod .optional() não aceita null)
function opt(v) { return (v == null || v === '') ? undefined : v; }
function optStr(v) {
  if (v == null || v === '') return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function normalizeOutgoingSalePayload(payload = {}) {
  const cashContext = getCurrentCashContext();

  // Mapear items para o schema do backend (strict):
  // aceita: productId, productName, quantity (int), unitPrice, costPrice,
  //         discount, discountType, unit, barcode
  // rejeita: code, name, price, cost, total (e qualquer outro campo extra)
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => {
        const qty = toNumber(item.quantity, 1);
        const mapped = {
          productId:   item.productId || undefined,
          productName: optStr(item.productName || item.name),
          quantity:    Math.max(1, Math.round(qty)), // backend exige int >= 1
          unitPrice:   toNumber(item.unitPrice ?? item.price, 0),
          discount:    toNumber(item.discount, 0),
        };
        // campos opcionais — só inclui se tiver valor
        const costPrice = toNumber(item.costPrice ?? item.cost, 0);
        if (costPrice > 0) mapped.costPrice = costPrice;
        const barcode = optStr(item.barcode);
        if (barcode) mapped.barcode = barcode;
        const unit = optStr(item.unit);
        if (unit) mapped.unit = unit;
        return mapped;
      })
    : [];

  // totalAmount é o nome correto no backend (frontend usava 'total')
  const totalAmount = toNumber(payload.total ?? payload.totalAmount, 0);

  return {
    items,
    paymentMethod: mapPaymentMethod(payload.paymentMethod),
    totalAmount,

    // UUIDs opcionais: null → undefined (Zod rejeita null em _uuid().optional())
    cashSessionId: optStr(payload.cashSessionId ?? cashContext.cashSessionId),
    terminalName:  optStr(payload.terminalName  ?? cashContext.terminalName),
    terminalCode:  optStr(payload.terminalCode  ?? cashContext.terminalCode),
    operatorId:    optStr(payload.operatorId    ?? cashContext.operatorId),
    operatorName:  optStr(payload.operatorName  ?? cashContext.operatorName),
    operatorCpf:   optStr(payload.operatorCpf   ?? cashContext.operatorCpf),
    operatorPin:   optStr(payload.operatorPin   ?? cashContext.operatorPin),
    discount:      toNumber(payload.discount, 0),
    notes:         optStr(payload.notes),
    // customerId, isDelivery, discountType omitidos se não informados
    ...(payload.customerId  ? { customerId:  optStr(payload.customerId)  } : {}),
    ...(payload.discountType ? { discountType: payload.discountType } : {}),
  };
}

export async function loadSales() {
  if (isBackendReady()) {
    try {
      const payload = await httpRequest(buildEndpoint('sales'));
      const normalized = Array.isArray(payload)
        ? payload.map(normalizeSaleFromApi)
        : [];

      save(getScopedSalesKey(), normalized);
      return normalized;
    } catch {
      // fallback local por empresa
    }
  }

  return load(getScopedSalesKey(), []);
}

export async function createSaleService(payload) {
  const normalizedPayload = normalizeOutgoingSalePayload(payload);

  if (isBackendReady()) {
    const created = await httpRequest(buildEndpoint('sales'), {
      method: 'POST',
      body: JSON.stringify(normalizedPayload)
    });

    const normalized = normalizeSaleFromApi(created);

    const current = load(getScopedSalesKey(), []);
    save(getScopedSalesKey(), [normalized, ...current]);

    return normalized;
  }

  const localSale = buildLocalSale(normalizedPayload);
  const current = load(getScopedSalesKey(), []);
  save(getScopedSalesKey(), [localSale, ...current]);

  return localSale;
}

export async function cancelSaleService(
  saleId,
  reason = 'Erro de lançamento',
  authorizationPassword = null
) {
  const current = load(getScopedSalesKey(), []);
  const next = current.map((sale) =>
    String(sale.id) === String(saleId)
      ? {
          ...sale,
          cancelled: true,
          status: 'cancelled',
          cancelReason: reason,
          cancelledAt: new Date().toISOString()
        }
      : sale
  );

  save(getScopedSalesKey(), next);

  if (isBackendReady()) {
    try {
      await httpRequest(buildEndpoint('sales', `${saleId}/cancel`), {
        method: 'POST',
        body: JSON.stringify({
          reason,
          password: authorizationPassword || undefined
        })
      });
    } catch {
      // backend indisponível — operação já salva localmente
    }
  }

  return {
    ok: true,
    saleId,
    message: 'Venda cancelada localmente.'
  };
}

export async function persistSales(sales) {
  save(getScopedSalesKey(), Array.isArray(sales) ? sales : []);
}

function normalizeSaleItem(item) {
  const quantity = toNumber(item.quantity, 0);
  const unitPrice = toNumber(item.unitPrice ?? item.price, 0);
  const total =
    toNumber(
      item.total ??
      item.totalPrice ??
      (quantity * unitPrice),
      0
    );

  return {
    id: item.id || null,
    productId: item.productId || null,
    code: item.code || item.productId || null,
    barcode: item.barcode || null,
    name: item.name || item.productName || '',
    quantity,
    price: unitPrice,
    unitPrice,
    cost: toNumber(item.cost, 0),
    discount: toNumber(item.discount, 0),
    total,
    totalPrice: total
  };
}

function normalizeSaleFromApi(sale) {
  const items = Array.isArray(sale.items)
    ? sale.items.map(normalizeSaleItem)
    : [];

  const cancelled =
    sale.status === 'cancelled' ||
    sale.status === 'canceled' ||
    Boolean(sale.cancelled) ||
    Boolean(sale.isCancelled);

  return {
    id: sale.id,
    number: sale.number || null,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt || null,

    items,
    itemsCount: items.reduce((acc, item) => acc + toNumber(item.quantity, 0), 0),

    subtotal: toNumber(sale.subtotal, items.reduce((acc, item) => acc + toNumber(item.total, 0), 0)),
    discount: toNumber(sale.discount, 0),
    total: toNumber(sale.total, 0),

    paymentMethod: sale.paymentMethod,
    amountPaid: toNumber(sale.amountReceived ?? sale.amountPaid ?? sale.total, 0),
    amountReceived: toNumber(sale.amountReceived ?? sale.amountPaid ?? sale.total, 0),
    change: toNumber(sale.changeAmount ?? sale.change, 0),
    changeAmount: toNumber(sale.changeAmount ?? sale.change, 0),

    status: sale.status || (cancelled ? 'cancelled' : 'completed'),
    cancelled,
    isCancelled: cancelled,
    cancelledAt: sale.cancelledAt || null,
    cancelReason: sale.cancelReason || null,
    cancelAuthorizedBy: sale.cancelAuthorizedBy || null,

    cashSessionId: sale.cashSessionId || null,
    notes: sale.notes || null,
    source: sale.source || 'pdv',

    operatorId: sale.operatorId || null,
    operatorName:
      sale.operatorName ||
      sale.user?.name ||
      null,
    operatorCpf: sale.operatorCpf || null,
    operatorPin: sale.operatorPin || null,

    terminalName:
      sale.terminalName ||
      sale.cashSession?.terminalName ||
      null,
    terminalCode:
      sale.terminalCode ||
      sale.cashSession?.terminalCode ||
      null,

    user: sale.user
      ? {
          id: sale.user.id,
          name: sale.user.name,
          email: sale.user.email,
          role: sale.user.role
        }
      : null
  };
}

function buildLocalSale(payload) {
  const now = new Date().toISOString();
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeSaleItem)
    : [];

  const total = toNumber(
    payload.total,
    items.reduce((acc, item) => acc + toNumber(item.total, 0), 0)
  );

  return {
    id: `local-sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    number: null,
    createdAt: now,
    updatedAt: now,

    items,
    itemsCount: items.reduce((acc, item) => acc + toNumber(item.quantity, 0), 0),

    subtotal: toNumber(payload.subtotal, total),
    discount: toNumber(payload.discount, 0),
    total,

    paymentMethod: payload.paymentMethod || 'Dinheiro',
    amountPaid: toNumber(payload.amountPaid ?? payload.amountReceived, total),
    amountReceived: toNumber(payload.amountReceived ?? payload.amountPaid, total),
    change: toNumber(payload.changeAmount ?? payload.change, 0),
    changeAmount: toNumber(payload.changeAmount ?? payload.change, 0),

    status: 'completed',
    cancelled: false,
    isCancelled: false,
    cancelledAt: null,
    cancelReason: null,
    cancelAuthorizedBy: null,

    cashSessionId: payload.cashSessionId || null,
    notes: payload.notes || null,
    source: payload.source || 'pdv',

    operatorId: payload.operatorId || null,
    operatorName: payload.operatorName || null,
    operatorCpf: payload.operatorCpf || null,
    operatorPin: payload.operatorPin || null,

    terminalName: payload.terminalName || null,
    terminalCode: payload.terminalCode || null,

    user: state.currentUser
      ? {
          id: state.currentUser.id,
          name: state.currentUser.name,
          email: state.currentUser.email,
          role: state.currentUser.role
        }
      : null
  };
}