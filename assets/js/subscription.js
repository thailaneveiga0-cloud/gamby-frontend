import { state } from './state.js';
import { upgradeCompanyPlanService } from './services/company-service.js';
import { createBillingCheckout } from './services/billing-service.js';

const PLAN_ORDER = {
  basico: 1,
  economico: 2,
  pro: 3
};

const PLAN_PRICES = {
  monthly: {
    basico: 79.90,
    economico: 149.90,
    pro: 249.90
  },
  yearly: {
    basico: 766.80,
    economico: 1438.80,
    pro: 2398.80
  }
};

let selectedUpgradePaymentMethod = 'card';
let pendingUpgradePlan = null;

/* ================= HELPERS ================= */

function _safeUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith('javascript:') || normalized.startsWith('data:') || normalized.startsWith('vbscript:')) return null;
  return url;
}

function formatDateBR(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('pt-BR');
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function normalizePlanCode(plan) {
  const value = String(plan || '').trim().toLowerCase();

  if (value.includes('pró') || value.includes('pro')) return 'pro';
  if (value.includes('econ')) return 'economico';
  return 'basico';
}

function normalizeBillingCycle(cycle) {
  const value = String(cycle || '').trim().toLowerCase();

  if (value === 'yearly' || value === 'annual' || value === 'anual') {
    return 'yearly';
  }

  return 'monthly';
}

function getPlanLabel(planCode) {
  const map = {
    basico: 'Básico',
    economico: 'Econômico',
    pro: 'Pró'
  };

  return map[normalizePlanCode(planCode)] || 'Básico';
}

function getBillingCycleLabel(cycle) {
  return normalizeBillingCycle(cycle) === 'yearly' ? 'Anual' : 'Mensal';
}

function getPlanNumericPrice(planCode, billingCycle = 'monthly') {
  const normalizedCycle = normalizeBillingCycle(billingCycle);
  return PLAN_PRICES[normalizedCycle]?.[normalizePlanCode(planCode)] || 0;
}

function getPlanPrice(planCode, billingCycle = 'monthly') {
  return formatCurrency(getPlanNumericPrice(planCode, billingCycle));
}

function getPaymentLabel(method) {
  const map = {
    card: 'Cartão',
    pix: 'Pix',
    boleto: 'Boleto',
    cash: 'Dinheiro',
    cartão: 'Cartão',
    cartao: 'Cartão'
  };

  return map[String(method || '').toLowerCase()] || '—';
}

function getStatusLabel(status) {
  const map = {
    trial: 'Teste grátis ativo',
    active: 'Ativo',
    past_due: 'Pagamento pendente',
    unpaid: 'Bloqueado',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
    blocked: 'Bloqueado',
    pending: 'Pendente'
  };

  return map[String(status || '').toLowerCase()] || '—';
}

function calculateDaysLeft(date) {
  if (!date) return 0;

  const now = new Date();
  const target = new Date(date);

  if (Number.isNaN(target.getTime())) return 0;

  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getCardInfo(subscription) {
  if (!subscription) return '—';

  const brand = subscription.cardBrand || 'Cartão';
  const last4 = subscription.cardLast4 || '••••';

  if (!subscription.cardLast4) {
    return 'Cartão cadastrado';
  }

  return `${brand} final ${last4}`;
}

function getCurrentPlanCode() {
  return normalizePlanCode(
    state.subscription?.planCode ||
      state.currentUser?.planCode ||
      state.subscription?.planName ||
      state.currentUser?.planName ||
      'basico'
  );
}

function getCurrentPlanName() {
  return getPlanLabel(getCurrentPlanCode());
}

function getCurrentBillingCycle() {
  return normalizeBillingCycle(
    state.subscription?.billingCycle ||
      state.currentUser?.billingCycle ||
      state.subscription?.cycle ||
      'monthly'
  );
}

function getPlanRelation(currentPlan, targetPlan) {
  const current = PLAN_ORDER[normalizePlanCode(currentPlan)] || 1;
  const target = PLAN_ORDER[normalizePlanCode(targetPlan)] || 1;

  if (target > current) return 'upgrade';
  if (target < current) return 'downgrade';
  return 'current';
}

function getCycleReferenceDate() {
  return state.subscription?.nextBillingAt || state.subscription?.trialEndsAt || null;
}

function isCycleStillActive() {
  const refDate = getCycleReferenceDate();
  if (!refDate) return false;

  const target = new Date(refDate);
  if (Number.isNaN(target.getTime())) return false;

  return target.getTime() > Date.now();
}

function calculateUpgradeEstimate(targetPlan, targetBillingCycle = null) {
  const currentPlan = getCurrentPlanCode();
  const currentBillingCycle = getCurrentBillingCycle();
  const nextCycle = normalizeBillingCycle(targetBillingCycle || currentBillingCycle);

  const currentPrice = getPlanNumericPrice(currentPlan, currentBillingCycle);
  const targetPrice = getPlanNumericPrice(targetPlan, nextCycle);

  const stillActive = isCycleStillActive();
  const cycleChanged = currentBillingCycle !== nextCycle;

  if (cycleChanged) {
    return {
      chargeType: 'cycle_change',
      amount: targetPrice,
      description:
        `Você está alterando de ${getBillingCycleLabel(currentBillingCycle)} para ${getBillingCycleLabel(nextCycle)}. ` +
        `A cobrança exibida é o valor do novo ciclo, e eventuais abatimentos devem ser calculados pelo backend.`,
      billingCycle: nextCycle
    };
  }

  if (stillActive) {
    const diff = Math.max(0, targetPrice - currentPrice);

    return {
      chargeType: 'proportional',
      amount: diff,
      description:
        diff > 0
          ? `Como seu ciclo ${getBillingCycleLabel(currentBillingCycle).toLowerCase()} ainda está ativo, ` +
            `a cobrança estimada considera a diferença entre os planos no mesmo ciclo.`
          : 'Não há diferença adicional a cobrar no momento.',
      billingCycle: nextCycle
    };
  }

  return {
    chargeType: 'full',
    amount: targetPrice,
    description:
      `Como o período atual já terminou, a cobrança estimada considera o valor integral do novo plano ` +
      `${getBillingCycleLabel(nextCycle).toLowerCase()}.`,
    billingCycle: nextCycle
  };
}

function updateStatusBadge(status) {
  const badge = document.getElementById('subscriptionStatusBadge');
  if (!badge) return;

  badge.textContent = getStatusLabel(status);
  badge.classList.remove('badge-trial', 'badge-active', 'badge-warning', 'badge-danger');

  const normalized = String(status || '').toLowerCase();

  if (normalized === 'trial') {
    badge.classList.add('badge-trial');
    return;
  }

  if (normalized === 'active') {
    badge.classList.add('badge-active');
    return;
  }

  if (normalized === 'past_due' || normalized === 'pending') {
    badge.classList.add('badge-warning');
    return;
  }

  badge.classList.add('badge-danger');
}

function updateSubscriptionHeadline(subscription) {
  const headline = document.getElementById('subscriptionHeadline');
  const summaryText = document.getElementById('subscriptionSummaryText');
  if (!headline || !summaryText) return;

  const planName = subscription.planName || getCurrentPlanName();
  const status = subscription.status || 'trial';
  const nextBillingAt = subscription.nextBillingAt || subscription.trialEndsAt || null;
  const cycle = subscription.billingCycle || getCurrentBillingCycle();

  headline.textContent = `Seu plano atual é ${planName} no ciclo ${getBillingCycleLabel(cycle).toLowerCase()}.`;

  if (String(status).toLowerCase() === 'trial') {
    summaryText.textContent = `Seu período de teste está ativo até ${formatDateBR(nextBillingAt)}.`;
    return;
  }

  summaryText.textContent = `Sua próxima cobrança está prevista para ${formatDateBR(nextBillingAt)}.`;
}

function togglePaymentPanel(show) {
  const panel = document.getElementById('subscriptionPaymentPanel');
  if (!panel) return;

  panel.classList.toggle('hidden', !show);
}

function setPaymentFeedback(message) {
  const feedback = document.getElementById('subscriptionPaymentFeedback');
  if (feedback) feedback.textContent = message;
}

function ensureOtherPlansBox() {
  return document.getElementById('subscriptionOtherPlansBox');
}

function fillUpgradePaymentSummary(targetPlan) {
  const cycleSelect = document.getElementById('upgradeBillingCycle');
  const selectedCycle = normalizeBillingCycle(cycleSelect?.value || getCurrentBillingCycle());

  const estimate = calculateUpgradeEstimate(targetPlan, selectedCycle);
  const currentPlan = getCurrentPlanCode();

  const currentPlanEl = document.getElementById('upgradeCurrentPlanLabel');
  const targetPlanEl = document.getElementById('upgradeTargetPlanLabel');
  const chargeTypeEl = document.getElementById('upgradeChargeTypeLabel');
  const amountEl = document.getElementById('upgradeAmountLabel');
  const descriptionEl = document.getElementById('upgradeDescriptionLabel');

  if (currentPlanEl) {
    currentPlanEl.textContent = `${getPlanLabel(currentPlan)} • ${getBillingCycleLabel(getCurrentBillingCycle())}`;
  }

  if (targetPlanEl) {
    targetPlanEl.textContent = `${getPlanLabel(targetPlan)} • ${getBillingCycleLabel(selectedCycle)}`;
  }

  if (chargeTypeEl) {
    if (estimate.chargeType === 'proportional') {
      chargeTypeEl.textContent = 'Pagamento proporcional';
    } else if (estimate.chargeType === 'cycle_change') {
      chargeTypeEl.textContent = 'Mudança de ciclo';
    } else {
      chargeTypeEl.textContent = 'Pagamento integral';
    }
  }

  if (amountEl) amountEl.textContent = formatCurrency(estimate.amount);
  if (descriptionEl) descriptionEl.textContent = estimate.description;
}

function openUpgradePayment(targetPlan) {
  pendingUpgradePlan = normalizePlanCode(targetPlan);
  togglePaymentPanel(true);

  const cycleSelect = document.getElementById('upgradeBillingCycle');
  if (cycleSelect) {
    cycleSelect.value = getCurrentBillingCycle();
  }

  document.querySelectorAll('[data-upgrade-payment]').forEach((item) => {
    item.classList.toggle(
      'active',
      String(item.dataset.upgradePayment || '').toLowerCase() === selectedUpgradePaymentMethod
    );
  });

  fillUpgradePaymentSummary(targetPlan);
  setPaymentFeedback('Escolha a forma de pagamento para concluir o upgrade.');
}

function resetUpgradePayment() {
  pendingUpgradePlan = null;
  togglePaymentPanel(false);
  setPaymentFeedback('Escolha a forma de pagamento para concluir o upgrade.');
}

/* ================= VISUAL RULES ================= */

export function applySubscriptionUpgradeVisibility() {
  const currentPlan = getCurrentPlanCode();
  const cards = document.querySelectorAll('[data-upgrade-plan]');
  const statusBox = document.getElementById('subscriptionUpgradeStatus');
  const otherPlansBox = ensureOtherPlansBox();

  let visibleUpgradeCount = 0;

  cards.forEach((button) => {
    const targetPlan = normalizePlanCode(button.dataset.upgradePlan);
    const relation = getPlanRelation(currentPlan, targetPlan);
    const card = button.closest('.plan-card');

    if (!card) return;

    card.classList.remove('plan-hidden', 'plan-current', 'plan-downgrade-hidden');
    button.disabled = false;

    if (relation === 'downgrade') {
      card.classList.add('plan-hidden', 'plan-downgrade-hidden');
      return;
    }

    if (relation === 'current') {
      card.classList.add('plan-current');
      button.textContent = 'Plano atual';
      button.disabled = true;
      return;
    }

    visibleUpgradeCount += 1;
    button.textContent = 'Fazer upgrade';
  });

  if (statusBox) {
    if (currentPlan === 'pro') {
      statusBox.textContent = 'Você já está no plano mais completo disponível.';
    } else if (visibleUpgradeCount === 0) {
      statusBox.textContent = 'No momento não há upgrades disponíveis para este plano.';
    } else {
      statusBox.textContent = 'Você pode fazer upgrade para liberar mais recursos.';
    }
  }

  if (otherPlansBox) {
    otherPlansBox.classList.remove('hidden');
  }
}

/* ================= RENDER ================= */

export function renderSubscriptionInfo() {
  const subscription = state.subscription || {};
  const currentUser = state.currentUser || {};

  const planCode = subscription.planCode || currentUser.planCode || 'basico';
  const billingCycle = subscription.billingCycle || currentUser.billingCycle || 'monthly';
  const planName = subscription.planName || currentUser.planName || getPlanLabel(planCode);
  const status = subscription.status || 'trial';
  const paymentMethod = subscription.paymentMethod || 'card';

  const trialEndsAt = subscription.trialEndsAt || null;
  const nextBillingAt = subscription.nextBillingAt || trialEndsAt || null;

  const daysLeft =
    subscription.daysLeft !== undefined && subscription.daysLeft !== null
      ? Number(subscription.daysLeft)
      : calculateDaysLeft(trialEndsAt || nextBillingAt);

  const planNameEl = document.getElementById('subscriptionPlanName');
  const statusEl = document.getElementById('subscriptionStatus');
  const paymentEl = document.getElementById('subscriptionPaymentMethod');
  const daysLeftEl = document.getElementById('subscriptionTrialDaysLeft');
  const nextBillingEl = document.getElementById('subscriptionNextBillingDate');
  const currentPriceEl = document.getElementById('subscriptionCurrentPrice');
  const cardInfoEl = document.getElementById('subscriptionCardInfo');
  const trialEndsEl = document.getElementById('subscriptionTrialEndsAt');
  const billingCycleEl = document.getElementById('subscriptionBillingCycle');

  if (planNameEl) planNameEl.textContent = planName;
  if (statusEl) statusEl.textContent = getStatusLabel(status);
  if (paymentEl) paymentEl.textContent = getPaymentLabel(paymentMethod);
  if (daysLeftEl) daysLeftEl.textContent = `${daysLeft} dia(s)`;
  if (nextBillingEl) nextBillingEl.textContent = formatDateBR(nextBillingAt);
  if (currentPriceEl) currentPriceEl.textContent = getPlanPrice(planCode, billingCycle);
  if (cardInfoEl) cardInfoEl.textContent = getCardInfo(subscription);
  if (trialEndsEl) trialEndsEl.textContent = formatDateBR(trialEndsAt);
  if (billingCycleEl) billingCycleEl.textContent = getBillingCycleLabel(billingCycle);

  const dashboardPlanName = document.getElementById('dashboardPlanName');
  if (dashboardPlanName) {
    dashboardPlanName.textContent = planName || '—';
  }

  const settingsPlanName = document.getElementById('settingsPlanName');
  if (settingsPlanName) {
    settingsPlanName.textContent = planName || '—';
  }

  const settingsPlanStartDate = document.getElementById('settingsPlanStartDate');
  if (settingsPlanStartDate) {
    const rawDate =
      subscription?.trialStartsAt ||
      subscription?.startsAt ||
      subscription?.createdAt ||
      currentUser?.createdAt ||
      null;

    settingsPlanStartDate.textContent = rawDate
      ? new Date(rawDate).toLocaleDateString('pt-BR')
      : '—';
  }

  const settingsSubscriptionStatus = document.getElementById('settingsSubscriptionStatus');
  if (settingsSubscriptionStatus) {
    settingsSubscriptionStatus.textContent =
      `Plano atual: ${planName}. Clique em "Outros planos" para comparar opções e alterar sua assinatura.`;
  }

  updateStatusBadge(status);
  updateSubscriptionHeadline({
    ...subscription,
    planName,
    status,
    billingCycle
  });

  applySubscriptionUpgradeVisibility();
}

/* ================= BINDS ================= */

export function bindSubscriptionActions() {
  document.querySelectorAll('.upgrade-plan-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const selectedPlan = normalizePlanCode(button.dataset.upgradePlan);
      const currentPlan = getCurrentPlanCode();
      const relation = getPlanRelation(currentPlan, selectedPlan);
      const statusBox = document.getElementById('subscriptionUpgradeStatus');

      if (!selectedPlan) return;

      if (relation === 'downgrade') {
        if (statusBox) {
          statusBox.textContent =
            'Este plano é inferior ao seu atual. Use a área de outros planos caso queira comparar opções.';
        }
        return;
      }

      if (relation === 'current') {
        if (statusBox) {
          statusBox.textContent = 'Este já é o seu plano atual.';
        }
        return;
      }

      openUpgradePayment(selectedPlan);

      if (statusBox) {
        statusBox.textContent = `Revise abaixo o pagamento para mudar para o plano ${getPlanLabel(selectedPlan)}.`;
      }
    });
  });

  document.querySelectorAll('[data-upgrade-payment]').forEach((option) => {
    option.addEventListener('click', () => {
      document.querySelectorAll('[data-upgrade-payment]').forEach((item) => {
        item.classList.remove('active');
      });

      option.classList.add('active');
      selectedUpgradePaymentMethod = String(option.dataset.upgradePayment || 'card').toLowerCase();

      setPaymentFeedback(`Forma de pagamento selecionada: ${getPaymentLabel(selectedUpgradePaymentMethod)}.`);
    });
  });

  document.getElementById('upgradeBillingCycle')?.addEventListener('change', () => {
    if (pendingUpgradePlan) {
      fillUpgradePaymentSummary(pendingUpgradePlan);
    }
  });

  document.getElementById('cancelUpgradeBtn')?.addEventListener('click', () => {
    resetUpgradePayment();
  });

  document.getElementById('viewAllPlansBtn')?.addEventListener('click', () => {
    document.getElementById('plansSection')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });

  document.getElementById('confirmUpgradeBtn')?.addEventListener('click', async () => {
    const statusBox = document.getElementById('subscriptionUpgradeStatus');

    if (!pendingUpgradePlan) {
      setPaymentFeedback('Nenhum plano foi selecionado para upgrade.');
      return;
    }

    try {
      const selectedCycle = normalizeBillingCycle(
        document.getElementById('upgradeBillingCycle')?.value || getCurrentBillingCycle()
      );

      setPaymentFeedback('Processando upgrade...');

      const currentStatus = String(state.subscription?.status || '').toLowerCase();
      const hasActiveSub  = currentStatus === 'active' || currentStatus === 'trial';

      if (hasActiveSub) {
        // Already subscribed — change plan (backend resolves price from DB, never from client)
        const updated = await upgradeCompanyPlanService(pendingUpgradePlan, {
          billingCycle: selectedCycle
        });

        if (updated) {
          state.subscription = updated;
          if (state.currentUser) {
            state.currentUser.planCode     = updated.planCode;
            state.currentUser.planName     = updated.planName;
            state.currentUser.billingCycle = updated.billingCycle || selectedCycle;
          }
          renderSubscriptionInfo();
          resetUpgradePayment();
          if (statusBox) {
            statusBox.textContent = `Plano alterado com sucesso para ${updated.planName || pendingUpgradePlan}.`;
          }
        }
      } else {
        // No active subscription — create checkout and redirect to payment page
        const result = await createBillingCheckout({
          planCode:      pendingUpgradePlan,
          billingCycle:  selectedCycle,
          paymentMethod: selectedUpgradePaymentMethod
        });

        const safeCheckoutUrl = _safeUrl(result?.checkoutUrl);
        if (safeCheckoutUrl) {
          window.location.href = safeCheckoutUrl;
        } else {
          setPaymentFeedback('Checkout criado. Aguarde o processamento.');
        }
      }
    } catch (error) {
      const message = error?.message || 'Não foi possível concluir o upgrade.';
      setPaymentFeedback(message);

      if (statusBox) {
        statusBox.textContent = message;
      }
    }
  });
}