/**
 * upgrade-modal.js — Elegant upgrade modal for locked plan features
 *
 * Shows when the backend returns { error: 'plan_upgrade_required' }.
 * Maintains GAMBY visual identity: dark mode, neon borders, glass effect.
 *
 * Usage:
 *   import { showUpgradeModal, interceptPlanErrors } from './upgrade-modal.js';
 *
 *   // Auto-intercept: wrap any fetch call
 *   interceptPlanErrors();
 *
 *   // Manual: show modal directly
 *   showUpgradeModal({ feature: 'inventory', requiredPlan: 'pro', currentPlan: 'basic' });
 */

const PLAN_LABELS = { basic: 'Básico', economic: 'Econômico', pro: 'PRO' };
const PLAN_COLORS = { basic: '#94a3b8', economic: '#94a3b8', pro: '#a855f7' };

const FEATURE_LABELS = {
  inventory:       'Controle de Estoque',
  analytics:       'Analytics Avançado',
  marketplace:     'Marketplace',
  marketing:       'Marketing',
  whatsapp:        'WhatsApp Inteligente',
  multiCompany:    'Multiempresa',
  advancedReports: 'Relatórios Avançados',
  advancedAudit:   'Auditoria Avançada',
  advancedSecurity:'Segurança Avançada',
  financial:       'Financeiro Completo',
  basicReports:    'Relatórios',
  clients:         'Gestão de Clientes',
  operators:       'Gestão de Operadores',
  permissions:     'Controle de Permissões'
};

/* ─── Modal HTML injection ────────────────────────────────────────────── */

function injectModal() {
  if (document.getElementById('gamby-upgrade-modal')) return;

  const el = document.createElement('div');
  el.id = 'gamby-upgrade-modal';
  el.innerHTML = `
    <div class="upgrade-overlay" id="upgradeOverlay">
      <div class="upgrade-card" role="dialog" aria-modal="true" aria-labelledby="upgradeModalTitle">
        <div class="upgrade-badge" id="upgradeBadge">PRO</div>
        <h2 class="upgrade-title" id="upgradeModalTitle">Recurso exclusivo</h2>
        <p class="upgrade-description" id="upgradeDescription">
          Este recurso está disponível em um plano superior.
        </p>
        <div class="upgrade-plan-info">
          <span class="upgrade-label">Seu plano:</span>
          <span class="upgrade-current-plan" id="upgradeCurrentPlan">—</span>
          <span class="upgrade-arrow">→</span>
          <span class="upgrade-required-plan" id="upgradeRequiredPlan">PRO</span>
        </div>
        <div class="upgrade-actions">
          <a href="#" class="upgrade-btn-primary" id="upgradeCtaBtn">Atualizar plano</a>
          <button class="upgrade-btn-secondary" id="upgradeBenefitsBtn">Ver benefícios</button>
          <button class="upgrade-btn-ghost" id="upgradeCloseBtn">Fechar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(el);
}

/* ─── Public API ──────────────────────────────────────────────────────── */

export function showUpgradeModal({ feature = '', requiredPlan = 'pro', currentPlan = 'basic' } = {}) {
  injectModal();

  const overlay      = document.getElementById('upgradeOverlay');
  const badge        = document.getElementById('upgradeBadge');
  const description  = document.getElementById('upgradeDescription');
  const currentEl    = document.getElementById('upgradeCurrentPlan');
  const requiredEl   = document.getElementById('upgradeRequiredPlan');
  const ctaBtn       = document.getElementById('upgradeCtaBtn');

  const reqLabel  = PLAN_LABELS[requiredPlan]  || requiredPlan.toUpperCase();
  const featLabel = FEATURE_LABELS[feature]    || feature;

  badge.textContent       = reqLabel;
  badge.dataset.plan      = requiredPlan;
  description.textContent = `"${featLabel}" está disponível no plano ${reqLabel}. Atualize para desbloquear este recurso.`;
  currentEl.textContent   = PLAN_LABELS[currentPlan] || currentPlan;
  requiredEl.textContent  = reqLabel;
  ctaBtn.href             = `/checkout?plan=${requiredPlan}`;

  overlay.classList.remove('hidden');

  const close = () => { overlay.classList.add('hidden'); };
  document.getElementById('upgradeCloseBtn').onclick   = close;
  document.getElementById('upgradeBenefitsBtn').onclick = () => {
    close();
    document.getElementById('plansSection')?.scrollIntoView({ behavior: 'smooth' });
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
}

/**
 * Globally intercepts 402 plan_upgrade_required responses from the backend
 * and shows the upgrade modal automatically. Call once at app initialization.
 */
export function interceptPlanErrors() {
  const original = window.fetch;
  window.fetch   = async (...args) => {
    const res = await original(...args);
    if (res.status === 402) {
      const clone = res.clone();
      clone.json().then(body => {
        if (body?.error === 'plan_upgrade_required') {
          showUpgradeModal({
            feature:      body.feature      || '',
            requiredPlan: body.requiredPlan || 'pro',
            currentPlan:  body.currentPlan  || 'basic'
          });
        }
      }).catch(() => {});
    }
    return res;
  };
}
