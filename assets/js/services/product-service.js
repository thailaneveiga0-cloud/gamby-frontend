import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function getScopedProductsKey() {
  const companyId = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${KEYS.products}_${companyId}`;
}

export async function loadProductsSource() {
  if (isBackendReady()) {
    try {
      const payload = await httpRequest(buildEndpoint('products'));
      const normalized = Array.isArray(payload)
        ? payload.map(normalizeProductFromApi)
        : [];

      save(getScopedProductsKey(), normalized);
      return normalized;
    } catch {
      // fallback local por empresa
    }
  }

  return load(getScopedProductsKey(), null);
}

export async function saveProductsSource(products) {
  save(getScopedProductsKey(), Array.isArray(products) ? products : []);
}

export async function createProductService(product) {
  if (isBackendReady()) {
    const created = await httpRequest(buildEndpoint('products'), {
      method: 'POST',
      body: JSON.stringify(normalizeProductToApi(product))
    });

    return normalizeProductFromApi(created);
  }

  return product;
}

export async function deleteProductService(product) {
  if (isBackendReady() && product?.id) {
    await httpRequest(buildEndpoint('products', product.id), {
      method: 'DELETE'
    });
  }

  return true;
}

export async function updateProductService(product) {
  if (isBackendReady() && product?.id) {
    const updated = await httpRequest(buildEndpoint('products', product.id), {
      method: 'PUT',
      body: JSON.stringify(normalizeProductToApi(product))
    });

    return normalizeProductFromApi(updated);
  }

  return product;
}

export async function exportProductsService(format = 'json') {
  if (isBackendReady()) {
    return httpRequest(buildEndpoint('products', `export?format=${format}`));
  }

  return load(getScopedProductsKey(), []);
}

export async function importProductsService(file) {
  if (isBackendReady()) {
    const form = new FormData();
    form.append('file', file);

    return httpRequest(buildEndpoint('products', 'import'), {
      method: 'POST',
      body: form,
      headers: {}
    });
  }

  return null;
}

export async function fetchDefaultProducts() {
  const response = await fetch('./assets/data/default-products.json');
  return response.json();
}

function normalizeProductToApi(product) {
  return {
    name: product.name,
    code: product.code,
    barcode: product.barcode || product.code,
    category: product.category || '',
    // BUG PRÉ-EXISTENTE CONFIRMADO (achado ao implementar isPerishable):
    // este payload enviava 'salePrice'/'allowZeroStock'/'promotional', mas
    // createProductSchema/updateProductSchema (backend, .strict()) só
    // aceitavam 'price' — qualquer chave desconhecida faz o Zod REJEITAR a
    // requisição inteira com 422 (.strict() rejeita, não descarta como o
    // comentário em validate.js sugere). Ou seja, criar/editar produto contra
    // o backend real já estava quebrado antes desta mudança. 'salePrice' e
    // 'promotional' agora são aceitos no schema (era mais seguro/rápido do
    // que reescrever este payload todo); 'allowZeroStock' nunca foi
    // consumido em nenhum outro lugar do frontend, então foi removido daqui
    // em vez de adicionado ao schema.
    salePrice: Number(product.price ?? product.salePrice ?? 0),
    costPrice: Number(product.cost ?? product.costPrice ?? 0),
    stock: Number(product.stock ?? 0),
    minStock: Number(product.minStock ?? 1),
    isActive: product.active !== false && product.isActive !== false,
    promotional: Boolean(product.promotional ?? false),
    isPerishable: Boolean(product.isPerishable ?? false),
    unit: String(product.unit || 'un').trim(),
    imageUrl: product.imageUrl || product.imagem || ''
  };
}

function normalizeProductFromApi(product) {
  const active = product.isActive !== undefined
    ? Boolean(product.isActive)
    : product.active !== false;
  return {
    ...product,
    id: product.id,
    name: product.name,
    code: product.code,
    barcode: product.barcode || '',
    category: product.category || '',
    price: Number(product.salePrice ?? product.price ?? 0),
    cost: Number(product.costPrice ?? product.cost ?? 0),
    stock: Number(product.stock ?? 0),
    minStock: Number(product.minStock ?? 1),
    active,
    isActive: active,
    promotional: Boolean(product.promotional ?? false),
    isPerishable: Boolean(product.isPerishable ?? false),
    unit: String(product.unit || 'un').trim(),
    imageUrl: product.imageUrl || product.imagem || '',
    createdAt: product.createdAt || product.created_at || '',
    updatedAt: product.updatedAt || product.updated_at || ''
  };
}