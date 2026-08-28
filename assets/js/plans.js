/**
 * plans.js — Tela de Planos GAMBY
 *
 * Exibe planos BASIC / ECONOMIC / PRO com preços mensais e anuais.
 * Integra com billing-service.js para iniciar checkout via Mercado Pago.
 */

import { createBillingCheckout } from './services/billing-service.js';
import { showUpgradeModal }      from './upgrade-modal.js';

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

/* ─── Dados dos planos (espelham billing-plans.js do backend) ─────────────── */

const PLANS_DATA = [
  {
    code:            'basic',
    name:            'Básico',
    subtitle:        'Para começar com o essencial',
    badge:           null,
    badgeClass:      null,
    monthlyPrice:    79.90,
    annualPrice:     766.80,
    annualMonthly:   63.90,
    discountPercent: 20,
    features: [
      'Dashboard',
      'PDV (Ponto de Venda)',
      'Cadastro de Produtos',
      'Configurações',
      '1 usuário · 1 caixa',
    ],
    limits: { users: 1, cashRegisters: 1 },
  },
  {
    code:            'economic',
    name:            'Econômico',
    subtitle:        'Melhor custo-benefício',
    badge:           'Mais popular',
    badgeClass:      'badge-popular',
    monthlyPrice:    149.90,
    annualPrice:     1438.80,
    annualMonthly:   119.90,
    discountPercent: 20,
    features: [
      'Tudo do Básico',
      'Histórico de Vendas',
      'Financeiro Completo',
      'Gestão de Clientes',
      'Relatórios Básicos',
      'Gestão de Operadores',
      'Controle de Permissões',
      'Até 10 usuários · 3 caixas',
    ],
    limits: { users: 10, cashRegisters: 3 },
  },
  {
    code:            'pro',
    name:            'PRO',
    subtitle:        'Poder total, sem limites',
    badge:           'Completo',
    badgeClass:      'badge-complete',
    monthlyPrice:    249.90,
    annualPrice:     2398.80,
    annualMonthly:   199.90,
    discountPercent: 20,
    features: [
      'Tudo do Econômico',
      'Controle de Estoque',
      'Analytics Avançado',
      'Marketplace Integrado',
      'Marketing Automatizado',
      'WhatsApp Inteligente',
      'Multiempresa',
      'Auditoria Avançada',
      'Segurança Avançada',
      'Usuários e caixas ilimitados',
    ],
    limits: { users: null, cashRegisters: null },
  },
];

/* ─── State ───────────────────────────────────────────────────────────────── */

let currentCycle    = 'monthly';
let currentPlanCode = null;

/* ─── Render ──────────────────────────────────────────────────────────────── */

export function renderPlansPage(container, { currentPlan = null, onCheckout } = {}) {
  currentPlanCode = currentPlan;

  container.innerHTML = `
    <div class="plans-page">
      <div class="plans-header">
        <h1 class="plans-title">Escolha seu Plano</h1>
        <p class="plans-subtitle">Transparência total. Sem surpresas. Cancele quando quiser.</p>

        <div class="pricing-toggle" id="plansCycleToggle">
          <button class="pricing-toggle-btn active" data-cycle="monthly" type="button">Mensal</button>
          <button class="pricing-toggle-btn" data-cycle="yearly" type="button">
            Anual
            <span class="pricing-discount-pill">−20%</span>
          </button>
        </div>
      </div>

      <div class="pricing-grid" id="plansGrid">
        ${PLANS_DATA.map(p => renderPlanCard(p)).join('')}
      </div>

      <p class="plans-legal">
        Pagamento processado com segurança pelo Mercado Pago.
        Preços em BRL. Plano anual cobrado uma vez por ano.
      </p>
    </div>
  `;

  // Cycle toggle
  container.querySelectorAll('.pricing-toggle-btn[data-cycle]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCycle = btn.dataset.cycle;
      container.querySelectorAll('.pricing-toggle-btn[data-cycle]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshPrices(container);
    });
  });

  // CTA buttons
  container.querySelectorAll('[data-plan-code]').forEach(btn => {
    btn.addEventListener('click', () => {
      const planCode = btn.dataset.planCode;
      if (planCode === currentPlanCode) return;
      if (onCheckout) {
        onCheckout({ planCode, billingCycle: currentCycle });
      } else {
        startCheckout({ planCode, billingCycle: currentCycle });
      }
    });
  });
}

function renderPlanCard(plan) {
  const isCurrent  = plan.code === currentPlanCode;
  const isFeatured = plan.code === 'economic';

  const ctaClass = isCurrent  ? 'pricing-cta-current'
                 : isFeatured ? 'pricing-cta-primary'
                 :              'pricing-cta-secondary';
  const ctaText  = isCurrent ? 'Plano atual' : 'Escolher plano';

  const cardClass = [
    'pricing-card',
    isFeatured ? 'is-featured' : '',
    isCurrent  ? 'is-current'  : '',
  ].filter(Boolean).join(' ');

  const badgeHtml = plan.badge
    ? `<span class="pricing-badge ${_esc(plan.badgeClass)}">${_esc(plan.badge)}</span>`
    : '';

  return `
    <div class="${cardClass}" data-plan="${_esc(plan.code)}">
      <div class="pricing-badge-slot">${badgeHtml}</div>

      <div class="pricing-body">
        <p class="pricing-plan-name">${_esc(plan.name)}</p>
        <p class="pricing-plan-sub">${_esc(plan.subtitle)}</p>

        <div class="pricing-price-row">
          <span class="pricing-price" data-price-block="${_esc(plan.code)}">R$ ${fmtBRL(plan.monthlyPrice)}</span>
          <span class="pricing-period">/mês</span>
        </div>
        <p class="pricing-annual-note" data-annual-note="${_esc(plan.code)}">&nbsp;</p>

        <hr class="pricing-divider">

        <ul class="pricing-features">
          ${plan.features.map(f => `<li>${_esc(f)}</li>`).join('')}
        </ul>

        <button class="pricing-cta ${ctaClass}" data-plan-code="${_esc(plan.code)}" ${isCurrent ? 'disabled' : ''} type="button">
          ${ctaText}
        </button>
      </div>
    </div>
  `;
}

function fmtBRL(value) {
  return value.toFixed(2).replace('.', ',');
}

function refreshPrices(container) {
  PLANS_DATA.forEach(plan => {
    const priceEl = container.querySelector(`[data-price-block="${plan.code}"]`);
    const noteEl  = container.querySelector(`[data-annual-note="${plan.code}"]`);
    if (!priceEl) return;

    if (currentCycle === 'yearly') {
      priceEl.textContent = `R$ ${fmtBRL(plan.annualMonthly)}`;
      if (noteEl) noteEl.innerHTML = `
        <span class="note-year-line">Plano anual &bull; R$ ${fmtBRL(plan.annualPrice)}/ano</span>
        <span class="note-savings">Economize ${plan.discountPercent}%</span>
      `;
    } else {
      priceEl.textContent = `R$ ${fmtBRL(plan.monthlyPrice)}`;
      if (noteEl) noteEl.innerHTML = `&nbsp;`;
    }
  });
}

/* ─── Checkout ────────────────────────────────────────────────────────────── */

async function startCheckout({ planCode, billingCycle, paymentMethod = 'pix' }) {
  try {
    const btn = document.querySelector(`[data-plan-code="${planCode}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Aguarde...'; }

    const result = await createBillingCheckout({ planCode, billingCycle, paymentMethod });

    if (result?.checkoutUrl || result?.initPoint) {
      const safeHref = _safeUrl(result.checkoutUrl || result.initPoint);
      if (!safeHref) throw new Error('URL de checkout inválida.');
      window.location.href = safeHref;
    } else if (result?.qrCode) {
      showPixModal(result);
    } else {
      alert('Checkout iniciado. Verifique sua caixa de entrada ou aguarde o redirecionamento.');
    }
  } catch (err) {
    console.error('[plans] checkout error', err);
    alert(err?.message || 'Erro ao iniciar checkout. Tente novamente.');
  }
}

function showPixModal(result) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="pln-pix-overlay">
      <div class="pln-pix-box">
        <h3 class="pln-pix-title">Pague com PIX</h3>
        ${result.qrCodeBase64
          ? `<img src="data:image/png;base64,${_esc(result.qrCodeBase64)}" class="pln-pix-qr" alt="QR Code PIX">`
          : ''}
        ${result.pixCopyPaste
          ? `<p class="pln-pix-copy-lbl">Copia e Cola:</p>
             <textarea readonly class="pln-pix-copy-ta">${_esc(result.pixCopyPaste)}</textarea>`
          : ''}
        <button class="pln-pix-close" id="pixModalCloseBtn" type="button">Fechar</button>
      </div>
    </div>
  `;
  const overlay = el.firstElementChild;
  overlay.querySelector('#pixModalCloseBtn')?.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

export { startCheckout, PLANS_DATA };
