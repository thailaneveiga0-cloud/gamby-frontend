import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function loadProductsSource() {
  if (isBackendReady()) {
    try {
      const payload = await httpRequest(buildEndpoint('products'));
      return Array.isArray(payload) ? payload.map(normalizeProductFromApi) : [];
    } catch {
      /* fallback local */
    }
  }
  return load(KEYS.products, null);
}

export async function saveProductsSource(products) {
  save(KEYS.products, products);
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
    await httpRequest(buildEndpoint('products', product.id), { method: 'DELETE' });
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
  if (isBackendReady()) return httpRequest(buildEndpoint('products', `export?format=${format}`));
  return null;
}

export async function importProductsService(file) {
  if (isBackendReady()) {
    const form = new FormData();
    form.append('file', file);
    return httpRequest(buildEndpoint('products', 'import'), { method: 'POST', body: form, headers: {} });
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
    salePrice: Number(product.price || product.salePrice || 0),
    costPrice: Number(product.costPrice || 0),
    stock: Number(product.stock || 0),
    minStock: Number(product.minStock || 1),
    isActive: true
  };
}

function normalizeProductFromApi(product) {
  return {
    id: product.id,
    name: product.name,
    code: product.code,
    barcode: product.barcode,
    category: product.category,
    price: Number(product.salePrice ?? product.price ?? 0),
    costPrice: Number(product.costPrice ?? 0),
    stock: Number(product.stock ?? 0),
    minStock: Number(product.minStock ?? 1)
  };
}
