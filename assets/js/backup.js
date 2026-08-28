import { state } from './state.js';
import { can } from './roles.js';
import {
  persistProducts,
  renderProducts,
  renderStockTable,
  renderLowStock,
  renderRemoveSelector,
  updateProductMetrics
} from './products.js';
import { downloadBlob, toNumber } from './utils.js';
import { setMessage } from './ui.js';

function isValidProduct(item) {
  return item && typeof item.name === 'string' && typeof item.code === 'string';
}

function normalizeImportedProduct(item) {
  return {
    ...item,
    name: String(item.name || '').trim(),
    code: String(item.code || '').trim(),
    barcode: String(item.barcode || '').trim(),
    category: String(item.category || '').trim(),
    price: toNumber(item.price ?? item.salePrice, 0),
    cost: toNumber(item.cost ?? item.costPrice, 0),
    stock: toNumber(item.stock, 0),
    minStock: toNumber(item.minStock, 1)
  };
}

function userCanBackup() {
  return can(state.currentUser?.role, 'backup');
}

export function exportProductsJSON() {
  if (!userCanBackup()) {
    setMessage('Sem permissão para exportar backup.', true);
    return;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 'stage10',
    companyId: state.currentUser?.companyId || null,
    products: Array.isArray(state.products) ? state.products : []
  };

  downloadBlob(
    'gamby-produtos-backup.json',
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    })
  );

  setMessage('Backup dos produtos exportado com sucesso.');
}

export async function importProductsJSON(event) {
  if (!userCanBackup()) {
    setMessage('Sem permissão para importar backup.', true);
    if (event?.target) event.target.value = '';
    return;
  }

  const file = event?.target?.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const raw = JSON.parse(e.target.result);
      const importedProducts = Array.isArray(raw) ? raw : raw.products;

      if (!Array.isArray(importedProducts)) {
        throw new Error('Formato inválido');
      }

      const normalizedProducts = importedProducts
        .filter((item) => isValidProduct(item))
        .map(normalizeImportedProduct)
        .filter((item) => item.name && item.code);

      if (!normalizedProducts.length) {
        throw new Error('Nenhum produto válido encontrado');
      }

      state.products = normalizedProducts;

      await persistProducts();
      renderProducts();
      renderStockTable();
      renderLowStock();
      renderRemoveSelector();
      updateProductMetrics();

      setMessage('Backup importado com sucesso.');
    } catch (error) {
      console.error('Erro ao importar backup:', error);
      setMessage('Não foi possível importar o arquivo. Verifique o formato do backup.', true);
    } finally {
      if (event?.target) {
        event.target.value = '';
      }
    }
  };

  reader.readAsText(file);
}

export function bindBackupActions() {
  document.getElementById('exportProductsBtn')?.addEventListener('click', exportProductsJSON);
  document.getElementById('importProductsFile')?.addEventListener('change', importProductsJSON);
}