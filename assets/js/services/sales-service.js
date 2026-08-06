import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function loadSales() {
  if (isBackendReady()) {
    try {
      const payload = await httpRequest(buildEndpoint('sales'));
      return Array.isArray(payload) ? payload.map(normalizeSaleFromApi) : [];
    } catch {
      /* fallback local */
    }
  }
  return load(KEYS.sales, []);
}

export async function createSaleService(payload) {
  if (isBackendReady()) {
    const created = await httpRequest(buildEndpoint('sales'), {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return normalizeSaleFromApi(created);
  }
  return null;
}

export async function cancelSaleService(saleId, reason = 'Erro de lançamento') {
  if (isBackendReady()) {
    return httpRequest(buildEndpoint('sales', `${saleId}/cancel`), {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  }
  return null;
}

export async function persistSales(sales) {
  save(KEYS.sales, sales);
}

function normalizeSaleFromApi(sale) {
  return {
    id: sale.id,
    createdAt: sale.createdAt,
    items: (sale.items || []).map(item => ({
      productId: item.productId,
      code: item.productId,
      quantity: Number(item.quantity || 0),
      price: Number(item.unitPrice || 0)
    })),
    itemsCount: (sale.items || []).reduce((acc, item) => acc + Number(item.quantity || 0), 0),
    paymentMethod: sale.paymentMethod,
    total: Number(sale.total || 0),
    amountPaid: Number(sale.amountReceived || sale.total || 0),
    change: Number(sale.changeAmount || 0),
    cancelled: sale.status === 'cancelled',
    cashSessionId: sale.cashSessionId
  };
}
