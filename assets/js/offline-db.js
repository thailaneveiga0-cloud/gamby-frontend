const DB_NAME    = 'gamby-offline';
const DB_VERSION = 1;

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;

      if (!db.objectStoreNames.contains('catalog')) {
        db.createObjectStore('catalog', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'localId', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = (ev) => {
      _db = ev.target.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

function txStore(db, storeName, mode) {
  return db.transaction([storeName], mode).objectStore(storeName);
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveCatalog(products) {
  const db    = await openDb();
  const store = txStore(db, 'catalog', 'readwrite');
  await promisifyRequest(store.clear());
  for (const p of products) {
    store.put(p);
  }
}

export async function getCatalog() {
  const db    = await openDb();
  const store = txStore(db, 'catalog', 'readonly');
  return promisifyRequest(store.getAll());
}

export async function getCatalogMeta() {
  const db    = await openDb();
  const store = txStore(db, 'meta', 'readonly');
  const row   = await promisifyRequest(store.get('catalogVersion'));
  return row || null;
}

export async function saveCatalogMeta(version, count) {
  const db    = await openDb();
  const store = txStore(db, 'meta', 'readwrite');
  store.put({ key: 'catalogVersion', version, savedAt: Date.now(), count });
}

export async function enqueueOfflineSale(saleData) {
  const db    = await openDb();
  const store = txStore(db, 'syncQueue', 'readwrite');
  const localId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const record  = { ...saleData, localId, offlineAt: new Date().toISOString() };
  await promisifyRequest(store.put(record));
  return localId;
}

export async function getQueuedSales() {
  const db    = await openDb();
  const store = txStore(db, 'syncQueue', 'readonly');
  return promisifyRequest(store.getAll());
}

export async function removeQueuedSale(localId) {
  const db    = await openDb();
  const store = txStore(db, 'syncQueue', 'readwrite');
  return promisifyRequest(store.delete(localId));
}

export async function countQueuedSales() {
  const db    = await openDb();
  const store = txStore(db, 'syncQueue', 'readonly');
  return promisifyRequest(store.count());
}
