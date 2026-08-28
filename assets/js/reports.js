import { state } from './state.js';
import { getFinanceSummary } from './finance.js';
import {
  formatCurrency,
  formatDateTimeBR,
  downloadBlob
} from './utils.js';

function _esc(v) {
  return String(v || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderAv(name) {
  if (typeof window.renderUserAvatar !== 'function') return '';
  return window.renderUserAvatar(
    { name, photoUrl: window.getUserAvatar?.(name) || null },
    { cls: 'av', size: 'sm' }
  );
}

/* ===============================
   Helpers
================================ */

function animateValue(el, start, end, duration = 500) {
  if (!el) return;

  const startTime = performance.now();

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = start + (end - start) * progress;

    el.textContent = formatCurrency(value);

    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function showSkeleton(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="skeleton-line"></div>
    <div class="skeleton-line"></div>
    <div class="skeleton-line"></div>
  `;
}

function getCompanyName() {
  return (
    state.companySettings?.tradeName ||
    state.companySettings?.companyName ||
    'Gamby Fluxo Caixa Pro'
  );
}

function getCompanyFooter() {
  return state.companySettings?.noteFooter || '';
}

function normalizeSales() {
  return Array.isArray(state.sales) ? state.sales : [];
}

function getSaleItemsArray(sale) {
  return Array.isArray(sale?.items) ? sale.items : [];
}

function getSaleItemsCount(sale) {
  return getSaleItemsArray(sale).reduce((acc, item) => {
    return acc + Number(item?.quantity || 0);
  }, 0);
}

function getSaleItemsText(sale) {
  const items = getSaleItemsArray(sale);

  if (!items.length) return '—';

  return items
    .map((item) => {
      const name = item?.name || item?.productName || item?.title || 'Produto';
      const quantity = Number(item?.quantity || 0);
      return `${name} (${quantity}x)`;
    })
    .join(' • ');
}

function getOperatorLabel(sale) {
  return (
    sale?.operatorName ||
    sale?.userName ||
    sale?.sellerName ||
    sale?.cashOperatorName ||
    '—'
  );
}

function getTerminalLabel(sale) {
  return (
    sale?.terminalName ||
    sale?.cashRegisterName ||
    sale?.caixa ||
    '—'
  );
}

function getOperatorRanking() {
  const sales = normalizeSales().filter((sale) => !sale?.cancelled);

  const rankingMap = new Map();

  for (const sale of sales) {
    const name = getOperatorLabel(sale);
    const current = rankingMap.get(name) || {
      operatorName: name,
      totalSales: 0,
      totalAmount: 0,
      itemsSold: 0,
      terminals: new Set()
    };

    current.totalSales += 1;
    current.totalAmount += Number(sale?.total || 0);
    current.itemsSold += getSaleItemsCount(sale);

    const terminal = getTerminalLabel(sale);
    if (terminal && terminal !== '—') {
      current.terminals.add(terminal);
    }

    rankingMap.set(name, current);
  }

  return Array.from(rankingMap.values())
    .map((item) => ({
      ...item,
      terminals: Array.from(item.terminals || [])
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

function getSalesByOperatorRowsHtml() {
  const ranking = getOperatorRanking();

  if (!ranking.length) {
    return `
      <tr>
        <td colspan="5">Nenhuma venda suficiente para montar ranking.</td>
      </tr>
    `;
  }

  return ranking
    .map((row, index) => `
      <tr class="fade-in">
        <td>${index + 1}</td>
        <td><span class="rpt-op-cell">${renderAv(row.operatorName)}${_esc(row.operatorName)}</span></td>
        <td>${_esc(row.terminals.length ? row.terminals.join(', ') : '—')}</td>
        <td>${row.totalSales}</td>
        <td>${formatCurrency(row.totalAmount)}</td>
      </tr>
    `)
    .join('');
}

/* ===============================
   Tabelas
================================ */

function salesRowsHtml() {
  const sales = normalizeSales();

  if (!sales.length) {
    return '<tr><td colspan="7">Nenhuma venda registrada.</td></tr>';
  }

  return sales
    .slice(0, 30)
    .map((sale) => {
      const itemsCount = getSaleItemsCount(sale);
      const productNames = getSaleItemsText(sale);
      const opName = getOperatorLabel(sale);

      return `
        <tr class="fade-in">
          <td>${formatDateTimeBR(sale.createdAt)}</td>
          <td><span class="rpt-op-cell">${renderAv(opName)}${_esc(opName)}</span></td>
          <td>${_esc(getTerminalLabel(sale))}</td>
          <td>${itemsCount}</td>
          <td>${_esc(sale.paymentMethod || '-')}</td>
          <td>${sale.cancelled ? 'Cancelada' : 'Concluída'}</td>
          <td>${formatCurrency(Number(sale.total || 0))}</td>
        </tr>
        <tr class="fade-in">
          <td colspan="7" class="rpt-subrow-td">
            ${_esc(productNames)}
          </td>
        </tr>
      `;
    })
    .join('');
}

function salesRowsPrintHtml() {
  const sales = normalizeSales();

  if (!sales.length) {
    return '<tr><td colspan="8">Nenhuma venda registrada.</td></tr>';
  }

  return sales
    .slice(0, 50)
    .map((sale) => {
      return `
        <tr>
          <td>${formatDateTimeBR(sale.createdAt)}</td>
          <td>${_esc(getOperatorLabel(sale))}</td>
          <td>${_esc(getTerminalLabel(sale))}</td>
          <td>${_esc(getSaleItemsText(sale))}</td>
          <td>${getSaleItemsCount(sale)}</td>
          <td>${_esc(sale.paymentMethod || '-')}</td>
          <td>${sale.cancelled ? 'Cancelada' : 'Concluída'}</td>
          <td>${formatCurrency(Number(sale.total || 0))}</td>
        </tr>
      `;
    })
    .join('');
}

function stockRowsHtml() {
  if (!state.products.length) {
    return '<tr><td colspan="8">Nenhum produto cadastrado.</td></tr>';
  }

  return state.products
    .slice()
    .sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
    )
    .map((product) => {
      const stock = Number(product.stock ?? 0);
      const minStock = Number(product.minStock ?? 0);
      const price = Number(product.price ?? 0);
      const totalValue = stock * price;

      const status =
        stock <= 0
          ? 'Esgotado'
          : stock <= minStock
          ? 'Estoque baixo'
          : 'Normal';

      return `
        <tr class="fade-in">
          <td>${_esc(product.name ?? '-')}</td>
          <td>${_esc(product.code ?? '-')}</td>
          <td>${_esc(product.barcode ?? '-')}</td>
          <td>${_esc(product.category || '-')}</td>
          <td>${formatCurrency(price)}</td>
          <td>${stock}</td>
          <td>${formatCurrency(totalValue)}</td>
          <td>${status}</td>
        </tr>
      `;
    })
    .join('');
}

function stockRowsPrintHtml() {
  if (!state.products.length) {
    return '<tr><td colspan="7">Nenhum produto cadastrado.</td></tr>';
  }

  return state.products
    .slice()
    .sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
    )
    .map((product) => {
      const stock = Number(product.stock ?? 0);
      const minStock = Number(product.minStock ?? 0);
      const price = Number(product.price ?? 0);
      const totalValue = stock * price;

      const status =
        stock <= 0
          ? 'Esgotado'
          : stock <= minStock
          ? 'Estoque baixo'
          : 'Normal';

      return `
        <tr>
          <td>${_esc(product.name ?? '-')}</td>
          <td>${_esc(product.code ?? '-')}</td>
          <td>${_esc(product.category || '-')}</td>
          <td>${formatCurrency(price)}</td>
          <td>${stock}</td>
          <td>${formatCurrency(totalValue)}</td>
          <td>${status}</td>
        </tr>
      `;
    })
    .join('');
}

/* ===============================
   Cálculos
================================ */

function calculateStockTotals() {
  const totalProducts = state.products.length;

  const totalUnits = state.products.reduce(
    (acc, p) => acc + Number(p.stock ?? 0),
    0
  );

  const totalValue = state.products.reduce(
    (acc, p) => acc + Number(p.stock ?? 0) * Number(p.price ?? 0),
    0
  );

  const lowStockCount = state.products.filter((p) => {
    const stock = Number(p.stock ?? 0);
    const minStock = Number(p.minStock ?? 0);
    return stock > 0 && stock <= minStock;
  }).length;

  const outOfStockCount = state.products.filter(
    (p) => Number(p.stock ?? 0) <= 0
  ).length;

  return {
    totalProducts,
    totalUnits,
    totalValue,
    lowStockCount,
    outOfStockCount
  };
}

/* ===============================
   Documento base
================================ */

function baseDocumentStyle(title = '') {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>${title}</title>
        <link rel="stylesheet" href="/assets/css/print-report.css">
      </head>
      <body>
  `;
}

function getSummaryCardsHtml() {
  const financeSummary = getFinanceSummary();
  const stockTotals = calculateStockTotals();
  const sales = normalizeSales();
  const validSales = sales.filter((sale) => !sale.cancelled);

  const totalSalesCount = validSales.length;
  const soldItems = validSales.reduce(
    (acc, sale) => acc + getSaleItemsCount(sale),
    0
  );

  const averageTicket = totalSalesCount
    ? validSales.reduce((acc, sale) => acc + Number(sale.total || 0), 0) / totalSalesCount
    : 0;

  return `
    <div class="report-grid">
      <div class="report-card">
        <span>Saldo em caixa</span>
        <strong>${formatCurrency(financeSummary.currentBalance)}</strong>
      </div>

      <div class="report-card">
        <span>Vendas do dia</span>
        <strong>${formatCurrency(financeSummary.salesToday)}</strong>
      </div>

      <div class="report-card">
        <span>Ticket médio</span>
        <strong>${formatCurrency(averageTicket)}</strong>
      </div>

      <div class="report-card">
        <span>Itens vendidos</span>
        <strong>${soldItems}</strong>
      </div>

      <div class="report-card">
        <span>Total de produtos</span>
        <strong>${stockTotals.totalProducts}</strong>
      </div>

      <div class="report-card">
        <span>Unidades em estoque</span>
        <strong>${stockTotals.totalUnits}</strong>
      </div>

      <div class="report-card">
        <span>Valor em estoque</span>
        <strong>${formatCurrency(stockTotals.totalValue)}</strong>
      </div>

      <div class="report-card">
        <span>Estoque baixo / zerado</span>
        <strong>${stockTotals.lowStockCount} / ${stockTotals.outOfStockCount}</strong>
      </div>
    </div>
  `;
}

/* ===============================
   Impressão
================================ */

export function printDailyReport() {
  const title = `Relatório diário - ${getCompanyName()}`;

  const html = `
    ${baseDocumentStyle(title)}
      <div class="report-wrap">
        <div class="report-head">
          <h1>${_esc(getCompanyName())}</h1>
          <p>Relatório diário gerado em ${formatDateTimeBR(new Date().toISOString())}</p>
        </div>

        ${getSummaryCardsHtml()}

        <h2>Ranking de operadores</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Operador</th>
              <th>Caixa</th>
              <th>Vendas</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${getSalesByOperatorRowsHtml()}
          </tbody>
        </table>

        <h2>Vendas recentes</h2>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Operador</th>
              <th>Caixa</th>
              <th>Itens</th>
              <th>Pagamento</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${salesRowsPrintHtml()}
          </tbody>
        </table>

        <h2>Posição do estoque</h2>
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Código</th>
              <th>Categoria</th>
              <th>Preço</th>
              <th>Qtd</th>
              <th>Valor em estoque</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${stockRowsPrintHtml()}
          </tbody>
        </table>

        <div class="footer">
          ${_esc(getCompanyFooter() || 'Documento emitido pelo Gamby Fluxo Caixa Pro.')}
        </div>
      </div>
    </body>
    </html>
  `;

  const reportWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!reportWindow) return;

  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();

  setTimeout(() => {
    reportWindow.focus();
    reportWindow.print();
  }, 300);
}

/* ===============================
   Exportação Word
================================ */

function buildWordDocumentHtml() {
  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>Relatório Diário</title>
      </head>
      <body>
        <h1>${_esc(getCompanyName())}</h1>
        <p>Relatório diário gerado em ${formatDateTimeBR(new Date().toISOString())}</p>

        <h2>Ranking de operadores</h2>
        <table border="1" cellspacing="0" cellpadding="6">
          <thead>
            <tr>
              <th>#</th>
              <th>Operador</th>
              <th>Caixa</th>
              <th>Vendas</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${getSalesByOperatorRowsHtml()}
          </tbody>
        </table>

        <h2>Vendas</h2>
        <table border="1" cellspacing="0" cellpadding="6">
          <thead>
            <tr>
              <th>Data</th>
              <th>Operador</th>
              <th>Caixa</th>
              <th>Itens</th>
              <th>Pagamento</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${salesRowsPrintHtml()}
          </tbody>
        </table>

        <h2>Estoque</h2>
        <table border="1" cellspacing="0" cellpadding="6">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Código</th>
              <th>Categoria</th>
              <th>Preço</th>
              <th>Qtd</th>
              <th>Valor em estoque</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${stockRowsPrintHtml()}
          </tbody>
        </table>

        <p>${_esc(getCompanyFooter() || 'Documento emitido pelo Gamby Fluxo Caixa Pro.')}</p>
      </body>
    </html>
  `;
}

export function exportDailyReportWord() {
  const html = buildWordDocumentHtml();
  const blob = new Blob(['\ufeff', html], {
    type: 'application/msword'
  });

  downloadBlob(
    blob,
    `relatorio-diario-${new Date().toISOString().slice(0, 10)}.doc`
  );
}

/* ===============================
   Renderização na tela
================================ */

export function renderReports() {
  const container = document.getElementById('reportsSummary');
  if (!container) return;

  showSkeleton(container);

  const financeSummary = getFinanceSummary();
  const stockTotals = calculateStockTotals();
  const sales = normalizeSales().filter((sale) => !sale.cancelled);

  const totalSalesCount = sales.length;
  const totalSalesAmount = sales.reduce(
    (acc, sale) => acc + Number(sale.total || 0),
    0
  );

  const averageTicket = totalSalesCount
    ? totalSalesAmount / totalSalesCount
    : 0;

  setTimeout(() => {
    container.innerHTML = `
      <div class="dashboard-grid rpt-panel-mb">
        <article class="panel metric-card">
          <span class="mini">Saldo atual</span>
          <strong id="reportMetricBalance">R$ 0,00</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Vendas do dia</span>
          <strong id="reportMetricSales">R$ 0,00</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Ticket médio</span>
          <strong id="reportMetricAverage">R$ 0,00</strong>
        </article>

        <article class="panel metric-card">
          <span class="mini">Valor em estoque</span>
          <strong id="reportMetricStockValue">R$ 0,00</strong>
        </article>
      </div>

      <div class="panel rpt-panel-mb">
        <h3 class="rpt-h3-mt0">Ranking de operadores</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Operador</th>
                <th>Caixa</th>
                <th>Vendas</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${getSalesByOperatorRowsHtml()}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel rpt-panel-mb">
        <h3 class="rpt-h3-mt0">Últimas vendas</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Operador</th>
                <th>Caixa</th>
                <th>Itens</th>
                <th>Pagamento</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${salesRowsHtml()}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h3 class="rpt-h3-mt0">Posição do estoque</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Código</th>
                <th>Código de barras</th>
                <th>Categoria</th>
                <th>Preço</th>
                <th>Qtd</th>
                <th>Valor em estoque</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${stockRowsHtml()}
            </tbody>
          </table>
        </div>
      </div>
    `;

    animateValue(
      document.getElementById('reportMetricBalance'),
      0,
      financeSummary.currentBalance
    );

    animateValue(
      document.getElementById('reportMetricSales'),
      0,
      financeSummary.salesToday
    );

    animateValue(
      document.getElementById('reportMetricAverage'),
      0,
      averageTicket
    );

    animateValue(
      document.getElementById('reportMetricStockValue'),
      0,
      stockTotals.totalValue
    );
  }, 180);
}

/* ===============================
   Bind
================================ */

export function bindReportActions() {
  document.getElementById('printDailyReportBtn')?.addEventListener('click', printDailyReport);

  document
    .getElementById('exportDailyReportWordBtn')
    ?.addEventListener('click', exportDailyReportWord);
}