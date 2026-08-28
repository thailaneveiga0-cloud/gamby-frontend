/**
 * my-subscription.js — Tela Minha Assinatura
 *
 * Exibe status, plano, próxima cobrança, faturas e ações de gestão.
 */

import {
  getBillingStatus,
  getBillingInvoices,
  cancelBillingSubscription,
  changeBillingPlan
} from './services/billing-service.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _safeUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  try {
    const p = new URL(v, window.location.origin);
    if (['http:', 'https:'].includes(p.protocol)) return p.href;
    return '';
  } catch { return ''; }
}

const STATUS_LABELS = {
  trial:    { label: 'Trial',        color: '#3b82f6' },
  active:   { label: 'Ativo',        color: '#22c55e' },
  past_due: { label: 'Vencido',      color: '#f59e0b' },
  unpaid:   { label: 'Inadimplente', color: '#ef4444' },
  cancelled:{ label: 'Cancelado',    color: '#64748b' },
  expired:  { label: 'Expirado',     color: '#ef4444' },
  pending:  { label: 'Pendente',     color: '#f59e0b' },
  suspended:{ label: 'Suspenso',     color: '#ef4444' }
};

const PLAN_NAMES = { basic: 'Básico', economic: 'Econômico', pro: 'PRO' };
const CYCLE_LABELS = { monthly: 'Mensal', yearly: 'Anual' };

export async function renderMySubscriptionPage(container, { onNavigateToPlans } = {}) {
  container.innerHTML = `<div class="sub-page"><div class="sub-loading">Carregando assinatura...</div></div>`;

  try {
    const [status, invoicesData] = await Promise.all([
      getBillingStatus(),
      getBillingInvoices({ limit: 10 })
    ]);

    const statusInfo  = STATUS_LABELS[status.status] || { label: _esc(status.status || '—'), color: '#64748b' };
    const planName    = _esc(PLAN_NAMES[status.planCode] || status.planName || '—');
    const cycleLabel  = _esc(CYCLE_LABELS[status.billingCycle] || status.billingCycle || '—');
    const trialEnd    = status.trialEndsAt ? new Date(status.trialEndsAt).toLocaleDateString('pt-BR') : null;
    const nextBilling = status.nextBillingAt ? new Date(status.nextBillingAt).toLocaleDateString('pt-BR') : null;

    container.innerHTML = `
      <div class="sub-page">
        <div class="sub-header">
          <h1 class="sub-title">Minha Assinatura</h1>
        </div>

        <div class="sub-grid">
          <!-- Status card -->
          <div class="sub-card sub-card-main">
            <div class="sub-card-label">Plano atual</div>
            <div class="sub-plan-name">${planName}</div>
            <div class="sub-status-row" data-sub-color="${statusInfo.color}">
              <span class="sub-status-dot"></span>
              <span class="sub-status-text">${statusInfo.label}</span>
              <span class="sub-cycle">${cycleLabel}</span>
            </div>
            ${trialEnd    ? `<div class="sub-meta">Trial expira em: <strong>${trialEnd}</strong></div>` : ''}
            ${nextBilling ? `<div class="sub-meta">Próxima cobrança: <strong>${nextBilling}</strong></div>` : ''}
            ${!status.allowed ? `<div class="sub-warning">⚠ Acesso restrito — regularize sua assinatura.</div>` : ''}
          </div>

          <!-- Actions card -->
          <div class="sub-card sub-card-actions">
            <div class="sub-card-label">Ações</div>
            <button class="sub-action-btn sub-btn-primary" id="subViewPlansBtn">
              Ver todos os planos
            </button>
            ${_safeUrl(status.checkoutUrl)
              ? `<a href="${_esc(_safeUrl(status.checkoutUrl))}" class="sub-action-btn sub-btn-secondary" target="_blank" rel="noopener">
                   Retomar checkout
                 </a>`
              : ''
            }
            ${['active', 'trial'].includes(status.status)
              ? `<button class="sub-action-btn sub-btn-danger" id="subCancelBtn">
                   Cancelar assinatura
                 </button>`
              : ''
            }
          </div>
        </div>

        <!-- Invoices -->
        <div class="sub-invoices">
          <h2 class="sub-section-title">Histórico de Faturas</h2>
          ${renderInvoices(invoicesData?.invoices || [])}
        </div>
      </div>

    `;

    // Apply dynamic status color via CSSOM
    const statusRow = container.querySelector('[data-sub-color]');
    if (statusRow) {
      const clr = statusRow.dataset.subColor;
      const dot = statusRow.querySelector('.sub-status-dot');
      const txt = statusRow.querySelector('.sub-status-text');
      if (dot) dot.style.background = clr;
      if (txt) txt.style.color = clr;
    }

    // Bind buttons
    container.querySelector('#subViewPlansBtn')?.addEventListener('click', () => {
      if (onNavigateToPlans) onNavigateToPlans();
    });

    container.querySelector('#subCancelBtn')?.addEventListener('click', async () => {
      if (!confirm('Tem certeza que deseja cancelar sua assinatura? O acesso continuará até o fim do período pago.')) return;
      try {
        await cancelBillingSubscription({ reason: 'user_request' });
        await renderMySubscriptionPage(container, { onNavigateToPlans });
      } catch (err) {
        alert(err?.message || 'Erro ao cancelar assinatura.');
      }
    });

  } catch (err) {
    container.innerHTML = `
      <div class="sub-page">
        <div class="sub-err-state">
          Erro ao carregar assinatura: ${_esc(err?.message || 'Tente novamente.')}
        </div>
      </div>
    `;
  }
}

function renderInvoices(invoices) {
  if (!invoices.length) {
    return `<div class="invoices-empty">Nenhuma fatura encontrada.</div>`;
  }
  const statusClass = { paid: 'inv-paid', authorized: 'inv-paid', pending: 'inv-pending', rejected: 'inv-rejected' };

  return `
    <table class="invoices-table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Descrição</th>
          <th>Valor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${invoices.map(inv => {
          const cls = statusClass[inv.status] || 'inv-other';
          const date = inv.paidAt
            ? new Date(inv.paidAt).toLocaleDateString('pt-BR')
            : new Date(inv.createdAt).toLocaleDateString('pt-BR');
          const amount = inv.amount != null
            ? `R$ ${Number(inv.amount).toFixed(2).replace('.', ',')}`
            : '—';
          return `
            <tr>
              <td>${date}</td>
              <td>${_esc(inv.description || '—')}</td>
              <td>${amount}</td>
              <td><span class="invoice-status ${cls}">${_esc(inv.status || '—')}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}
