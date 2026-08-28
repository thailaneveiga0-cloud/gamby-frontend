import { buildEndpoint, isBackendReady } from './backend-config.js';
import { httpRequest } from './http.js';
import { state } from './state.js';
import {
  saveCatalog,
  getCatalog,
  getCatalogMeta,
  saveCatalogMeta,
  enqueueOfflineSale,
  getQueuedSales,
  removeQueuedSale,
  countQueuedSales,
} from './offline-db.js';

export function isOnline() {
  return navigator.onLine;
}

export function updateConnectionIndicator() {
  const el = document.getElementById('pdvConnectionStatus');
  if (!el) return;
  const online = navigator.onLine;
  el.textContent = online ? 'Online' : 'Offline';
  el.className   = online ? 'conn-badge conn-online' : 'conn-badge conn-offline';
}

async function _updateQueueBadge() {
  const badge = document.getElementById('pdvOfflineQueueBadge');
  if (!badge) return;
  try {
    const count = await countQueuedSales();
    badge.textContent = count > 0 ? String(count) : '';
    badge.classList.toggle('hidden', count === 0);
  } catch (_) {
    badge.classList.add('hidden');
  }
}

export async function refreshCatalog() {
  if (!isBackendReady()) return;

  try {
    const meta    = await getCatalogMeta();
    const remote  = await httpRequest(`${buildEndpoint('sync')}/catalog-version`, { method: 'GET' });

    if (meta?.version === remote.version) return;

    const data = await httpRequest(`${buildEndpoint('sync')}/offline-catalog`, { method: 'GET' });
    const products = Array.isArray(data.products) ? data.products : [];

    await saveCatalog(products);
    await saveCatalogMeta(remote.version, products.length);

    if (!Array.isArray(state.products) || state.products.length === 0) {
      state.products = products;
    }
  } catch (_) {
    // silently use cached catalog
  }
}

export async function loadCatalogIntoState() {
  if (Array.isArray(state.products) && state.products.length > 0) return;
  try {
    const cached = await getCatalog();
    if (cached.length > 0) state.products = cached;
  } catch (_) { /* no IndexedDB or empty */ }
}

export async function queueOfflineSale(saleData) {
  const localId = await enqueueOfflineSale(saleData);
  await _updateQueueBadge();
  return localId;
}

export async function syncPending() {
  if (!isBackendReady() || !isOnline()) return;

  const queued = await getQueuedSales();
  if (!queued.length) return;

  try {
    const result = await httpRequest(`${buildEndpoint('sync')}/offline-sales`, {
      method: 'POST',
      body: JSON.stringify({ sales: queued }),
    });

    for (const r of result.results || []) {
      if (r.ok) await removeQueuedSale(r.localId);
    }

    await _updateQueueBadge();
  } catch (_) {
    // will retry on next online event
  }
}

export function initOfflineSync() {
  updateConnectionIndicator();

  window.addEventListener('online', async () => {
    updateConnectionIndicator();
    await syncPending();
    await refreshCatalog();
  });

  window.addEventListener('offline', () => {
    updateConnectionIndicator();
  });

  if (isOnline() && isBackendReady()) {
    refreshCatalog().catch(() => {});
    syncPending().catch(() => {});
  }

  _updateQueueBadge().catch(() => {});
}
