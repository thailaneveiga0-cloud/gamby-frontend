import { state } from './state.js';
import { getFinanceSummary } from './finance.js';
import { formatCurrency, formatDateTimeBR, downloadBlob } from './utils.js';

function salesRowsHtml() {
  if (!state.sales.length) return '<tr><td colspan="5">Nenhuma venda registrada.</td></tr>';
  return state.sales.slice(0, 30).map((sale) => `
    <tr>
      <td>${formatDateTimeBR(sale.createdAt)}</td>
      <td>${sale.itemsCount}</td>
      <td>${sale.paymentMethod}</td>
      <td>${sale.cancelled ? 'Cancelada' : 'Concluída'}</td>
      <td>${formatCurrency(sale.total)}</td>
    </tr>
  `).join('');
}

function reportHtml() {
  const summary = getFinanceSummary();
  const company = state.companySettings?.tradeName || state.companySettings?.companyName || 'Gamby Fluxo Caixa Pro';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório Diário</title>
  <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ccc;padding:8px;text-align:left}small{color:#555}</style>
  </head><body>
  <h1>${company}</h1>
  <small>Relatório diário gerado em ${formatDateTimeBR(new Date())}</small>
  <p><strong>Abertura:</strong> ${formatCurrency(summary.opening)}<br><strong>Vendas válidas:</strong> ${formatCurrency(summary.totalSales)}<br><strong>Cancelamentos:</strong> ${formatCurrency(summary.cancellations)}<br><strong>Saldo atual:</strong> ${formatCurrency(summary.currentBalance)}</p>
  <table><thead><tr><th>Data</th><th>Itens</th><th>Pagamento</th><th>Status</th><th>Total</th></tr></thead><tbody>${salesRowsHtml()}</tbody></table>
  <p style="margin-top:20px;">${state.companySettings?.noteFooter || ''}</p>
  </body></html>`;
}

export function renderReports() {
  const box = document.getElementById('reportsSummary');
  if (!box) return;
  const summary = getFinanceSummary();
  box.innerHTML = `
    <div class="panel">
      <h3>Resumo do dia</h3>
      <p class="mini">Abertura: <strong>${formatCurrency(summary.opening)}</strong> • Vendas válidas: <strong>${formatCurrency(summary.totalSales)}</strong> • Cancelamentos: <strong>${formatCurrency(summary.cancellations)}</strong> • Saldo atual: <strong>${formatCurrency(summary.currentBalance)}</strong></p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Itens</th><th>Pagamento</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>${salesRowsHtml()}</tbody>
        </table>
      </div>
    </div>
  `;
}

export function printDailyReport() {
  const html = reportHtml();
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) return;
  reportWindow.document.write(html);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

export function exportDailyReportWord() {
  const html = reportHtml();
  const blob = new Blob([html], { type: 'application/msword' });
  downloadBlob('relatorio-diario-gamby.doc', blob);
}

export function bindReportActions() {
  document.getElementById('printDailyReportBtn')?.addEventListener('click', printDailyReport);
  document.getElementById('exportDailyReportWordBtn')?.addEventListener('click', exportDailyReportWord);
}
