import { state } from './state.js';
import { can } from './roles.js';
import { persistProducts, renderProducts, updateProductMetrics } from './products.js';
import { downloadBlob } from './utils.js';

function isValidProduct(item) {
  return item && typeof item.name === 'string' && typeof item.code === 'string';
}

export function exportProductsJSON() {
  if (!can(state.currentUser?.role, 'backup')) return alert('Sem permissão para exportar backup.');
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 'stage7',
    products: state.products
  };
  downloadBlob('gamby-produtos-backup.json', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
}

export function importProductsJSON(event) {
  if (!can(state.currentUser?.role, 'backup')) {
    alert('Sem permissão para importar backup.');
    event.target.value = '';
    return;
  }
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const importedProducts = Array.isArray(data) ? data : data.products;
      if (!Array.isArray(importedProducts) || importedProducts.some((item) => !isValidProduct(item))) {
        throw new Error('Formato inválido');
      }
      state.products = importedProducts;
      persistProducts();
      renderProducts();
      updateProductMetrics();
      alert('Backup importado com sucesso.');
    } catch {
      alert('Não foi possível importar o arquivo. Verifique o formato do backup.');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

export function bindBackupActions() {
  document.getElementById('exportProductsBtn')?.addEventListener('click', exportProductsJSON);
  document.getElementById('importProductsFile')?.addEventListener('change', importProductsJSON);
}
