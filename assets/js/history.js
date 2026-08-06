import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { formatCurrency, formatDateTimeBR } from './utils.js';

export function initHistory() {
  state.history = load(KEYS.history, []);
  renderHistory();
}

export function addHistory(type, description, amount = 0) {
  state.history.unshift({ id: Date.now() + Math.random(), createdAt: new Date().toISOString(), type, description, amount: Number(amount || 0) });
  state.history = state.history.slice(0, 300);
  save(KEYS.history, state.history);
  renderHistory();
}

export function renderHistory() {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.history.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">Nenhuma movimentação registrada.</td></tr>';
    return;
  }
  tbody.innerHTML = state.history.map(item => `
    <tr>
      <td>${formatDateTimeBR(item.createdAt)}</td>
      <td>${item.type}</td>
      <td>${item.description}</td>
      <td>${formatCurrency(item.amount)}</td>
    </tr>`).join('');
}
