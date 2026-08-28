import { state } from './state.js';
import {
  savePaymentSettingsService,
  loadPaymentSettingsService,
  saveSubscriptionPaymentMethod
} from './services/payment-service.js';
import { createSubscription } from './services/mercadopago-service.js';
import { getPublicPlans } from './services/billing-service.js';
import { KEYS, load, save } from './storage.js';
import { permissions } from './roles.js';
import { addDays, formatCurrency } from './utils.js';

/* ================= CONFIG ================= */

export const DEFAULT_PAYMENT_SETTINGS = {
  methods: { card: true, pix: true, boleto: true },
  pixKey: '',
  boletoIssuer: '',
  autoReminderEnabled: true,
  autoDebitEnabled: true,
  reminderDaysBeforeTrialEnd: 1
};

const PLAN_NAME_MAP = {
  basico: 'Básico',
  economico: 'Econômico',
  pro: 'Pró'
};

const PLAN_CODE_MAP = {
  'básico': 'basico',
  basico: 'basico',
  'econômico': 'economico',
  economico: 'economico',
  'pró': 'pro',
  pro: 'pro'
};

const PLAN_DEVICE_MAP = {
  basico: 1,
  economico: 6,
  pro: 12
};

const PRICE_MAP = {
  monthly: {
    basico: 79.90,
    economico: 149.90,
    pro: 249.90
  },
  yearly: {
    basico: 766.80,
    economico: 1438.80,
    pro: 2398.80
  },
  yearlyMonthly: {
    basico: 63.90,
    economico: 119.90,
    pro: 199.90
  }
};

let paymentActionsBound = false;
let premiumCardUIBound = false;
let billingToggleBound = false;
let choosePlanButtonsBound = false;

/* ================= SECURITY HELPERS ================= */

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _safeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/* ================= HELPERS ================= */

function normalizePlanCode(plan) {
  const value = String(plan || '').trim().toLowerCase();
  return PLAN_CODE_MAP[value] || value || 'economico';
}

function getPlanLabel(plan) {
  return PLAN_NAME_MAP[normalizePlanCode(plan)] || 'Econômico';
}

function getPlanDevices(plan) {
  const code = normalizePlanCode(plan);
  return PLAN_DEVICE_MAP[code] || 1;
}

function getCurrentBillingCycle() {
  const cycle = String(
    state.currentBillingCycle ||
    state.registrationData?.billingCycle ||
    'monthly'
  ).toLowerCase();

  return cycle === 'yearly' ? 'yearly' : 'monthly';
}

function getPlanPrice(planCode, billingCycle = 'monthly') {
  const code = normalizePlanCode(planCode);
  const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';

  return Number(PRICE_MAP?.[cycle]?.[code] || 0);
}

function persistPaymentSettingsLocal() {
  save(KEYS.paymentSettings, state.paymentSettings);
}

function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function formatCardNumber(value = '') {
  return onlyDigits(value).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatExpiry(value = '') {
  const digits = onlyDigits(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function detectBrand(number = '') {
  const n = onlyDigits(number);

  if (/^4/.test(n)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(4011|4312|4389)/.test(n) || /^(4514|4576|5041|5067|5090|6277|6362|6363)/.test(n)) return 'elo';
  if (/^(6062|3841)/.test(n)) return 'hipercard';

  return 'card';
}

function getBrandLabel(brand = '') {
  const normalized = String(brand || '').toLowerCase();

  if (normalized === 'visa') return 'VISA';
  if (normalized === 'mastercard') return 'MASTERCARD';
  if (normalized === 'amex') return 'AMEX';
  if (normalized === 'elo') return 'ELO';
  if (normalized === 'hipercard') return 'HIPERCARD';

  return 'CARD';
}

function updateCardBrandUI(brand = '') {
  const brandBadge = document.getElementById('cardBrand');

  if (brandBadge) {
    brandBadge.textContent = getBrandLabel(brand);
  }

  document.documentElement.dataset.cardBrand = brand || 'default';
}

function showCardScreen() {
  document.getElementById('cardScreen')?.classList.remove('hidden');
}

function hideCardScreen() {
  document.getElementById('cardScreen')?.classList.add('hidden');
}

function toggleCardScreenByMethod() {
  const method = String(state.registrationData?.paymentMethod || 'card').toLowerCase();

  if (method === 'card') {
    showCardScreen();
    return;
  }

  hideCardScreen();
}

function markSignupPaymentCompleted(completed = false) {
  if (!state.registrationData) {
    state.registrationData = {};
  }

  state.registrationData.paymentCompleted = Boolean(completed);

  const finishBtn = document.getElementById('finishRegistrationBtn');
  if (finishBtn) {
    finishBtn.disabled = !completed;
    finishBtn.classList.toggle('hidden', !completed);
  }

  const stepPayment = document.getElementById('premiumStepPayment');
  const stepRelease = document.getElementById('premiumStepRelease');

  if (stepPayment) {
    stepPayment.classList.toggle('done', Boolean(completed));
    stepPayment.classList.toggle('current', !completed);
  }

  if (stepRelease) {
    stepRelease.classList.toggle('current', Boolean(completed));
    stepRelease.classList.toggle('done', false);
  }
}

function updateActivationUI() {
  const planCode = normalizePlanCode(state.registrationData?.planCode);
  const paymentCompleted = Boolean(state.registrationData?.paymentCompleted);

  const wrap = document.getElementById('activationSummaryWrap');
  const stepPlan = document.getElementById('premiumStepPlan');
  const stepPayment = document.getElementById('premiumStepPayment');
  const stepRelease = document.getElementById('premiumStepRelease');

  if (wrap) {
    wrap.classList.toggle('hidden', !planCode);
  }

  if (stepPlan) {
    stepPlan.classList.toggle('done', Boolean(planCode));
    stepPlan.classList.toggle('current', Boolean(planCode) && !paymentCompleted);
  }

  if (stepPayment) {
    stepPayment.classList.toggle('current', Boolean(planCode) && !paymentCompleted);
    stepPayment.classList.toggle('done', paymentCompleted);
  }

  if (stepRelease) {
    stepRelease.classList.toggle('current', paymentCompleted);
  }

  markSignupPaymentCompleted(paymentCompleted);
}

function readChosenPriceFromButton(button, billingCycle) {
  if (!button) return 0;

  const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';

  if (cycle === 'yearly') {
    return Number(
      button.dataset.signupPriceYearly ||
      button.dataset.yearlyPrice ||
      0
    );
  }

  return Number(
    button.dataset.signupPrice ||
    button.dataset.monthlyPrice ||
    0
  );
}

function updatePlanCardsVisualState(selectedPlanCode) {
  document.querySelectorAll('[data-action="choose-plan"]').forEach((button) => {
    const planCode = normalizePlanCode(button.dataset.signupPlan || '');
    const card =
      button.closest('.plan-saas-card') ||
      button.closest('.signup-plan-card') ||
      button.closest('.plan-card');

    if (!card) return;

    card.classList.toggle('selected', planCode === selectedPlanCode);
  });
}

// ✅ CORRIGIDO: sincroniza o estado visual dos botões de billing cycle.
// Agora usa data-billing (que é o que o HTML realmente tem), além dos IDs antigos,
// garantindo compatibilidade total.
function syncBillingCycleButtons() {
  const cycle = getCurrentBillingCycle();

  // Botões por ID (caso existam)
  const monthlyIds = ['planMonthlyToggle', 'monthlyBtn'];
  const yearlyIds = ['planYearlyToggle', 'yearlyBtn'];

  monthlyIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', cycle === 'monthly');
  });

  yearlyIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', cycle === 'yearly');
  });

  // ✅ Botões por data-billing (o que o HTML atual usa)
  document.querySelectorAll('.plan-toggle-btn[data-billing]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.billing === cycle);
  });
}

function syncPlanPriceVisibility() {
  const cycle = getCurrentBillingCycle();

  document.querySelectorAll('[data-price]').forEach((el) => {
    const priceType = String(el.dataset.price || '').toLowerCase();
    const shouldShow = priceType === cycle;
    el.classList.toggle('hidden', !shouldShow);
  });

  // Mostra nota do plano anual (total + economia) somente quando "Anual" está ativo
  document.querySelectorAll('[data-price-note]').forEach((el) => {
    el.classList.toggle('hidden', cycle !== 'yearly');
  });
}

/* ================= LOAD ================= */

export async function loadPaymentSettings() {
  try {
    const rawSession =
      localStorage.getItem('gamby_auth_session_modular') ||
      localStorage.getItem('gamby_session') ||
      localStorage.getItem('session');

    const parsedSession = rawSession ? JSON.parse(rawSession) : null;
    const token = parsedSession?.token || '';

    if (!token) {
      return null;
    }

    const settings = await loadPaymentSettingsService();

    if (settings) {
      state.paymentSettings = {
        ...state.paymentSettings,
        ...settings
      };

      persistPaymentSettingsLocal();
    }

    return state.paymentSettings;
  } catch (error) {
    console.warn('Erro ao carregar configurações de pagamento:', error);
    return null;
  }
}

/* ================= BILLING ================= */

export function applyBillingCycle(mode) {
  const selected = mode === 'yearly' ? 'yearly' : 'monthly';

  state.currentBillingCycle = selected;

  if (!state.registrationData) {
    state.registrationData = {};
  }

  state.registrationData.billingCycle = selected;

  const planCode = normalizePlanCode(state.registrationData.planCode || 'economico');
  state.registrationData.planCode = planCode;
  state.registrationData.planPrice = getPlanPrice(planCode, selected);

  syncBillingCycleButtons();
  syncPlanPriceVisibility();
  updatePlanSummary();
  updateActivationUI();
}

// ✅ CORRIGIDO: bindBillingToggle agora captura os botões pelo atributo data-billing
// (que é o que o HTML usa) além dos IDs antigos.
function bindBillingToggle() {
  if (billingToggleBound) return;
  billingToggleBound = true;

  // Botões por ID (legado — caso existam em outro template)
  const monthlyButtons = [
    document.getElementById('planMonthlyToggle'),
    document.getElementById('monthlyBtn')
  ].filter(Boolean);

  const yearlyButtons = [
    document.getElementById('planYearlyToggle'),
    document.getElementById('yearlyBtn')
  ].filter(Boolean);

  monthlyButtons.forEach((button) => {
    button.addEventListener('click', () => applyBillingCycle('monthly'));
  });

  yearlyButtons.forEach((button) => {
    button.addEventListener('click', () => applyBillingCycle('yearly'));
  });

  // ✅ Botões atuais do HTML (data-billing)
  document.querySelectorAll('.plan-toggle-btn[data-billing]').forEach((btn) => {
    if (btn.dataset.billingBound === 'true') return;
    btn.dataset.billingBound = 'true';

    btn.addEventListener('click', () => {
      applyBillingCycle(btn.dataset.billing);
    });
  });
}

function bindChoosePlanButtons() {
  if (choosePlanButtonsBound) return;
  choosePlanButtonsBound = true;

  document.querySelectorAll('[data-action="choose-plan"]').forEach((button) => {
    button.addEventListener('click', () => {
      const billingCycle = getCurrentBillingCycle();
      const planName = String(button.dataset.signupPlan || '').trim();
      const planCode = normalizePlanCode(planName);
      const planPrice = readChosenPriceFromButton(button, billingCycle) || getPlanPrice(planCode, billingCycle);
      const trialDays = Number(button.dataset.signupTrial || 15);
      const devices = Number(button.dataset.signupDevices || getPlanDevices(planCode));

      if (!state.registrationData) {
        state.registrationData = {};
      }

      state.registrationData.planName = getPlanLabel(planCode);
      state.registrationData.planCode = planCode;
      state.registrationData.planPrice = planPrice;
      state.registrationData.trialDays = trialDays;
      state.registrationData.billingCycle = billingCycle;
      state.registrationData.devicesLimit = devices;
      state.registrationData.planSelected = true;
      state.registrationData.registrationStep = 'payment';
      state.registrationData.paymentMethod = 'card';

      updatePlanCardsVisualState(planCode);
      updatePlanSummary();
      toggleCardScreenByMethod();
      updateActivationUI();

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          const paymentStage = document.getElementById('stage-payment');
          paymentStage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    });
  });
}

/* ================= UI ================= */

export function updatePlanSummary() {
  const el = document.getElementById('selectedPlanSummary');
  if (!el) return;

  if (!state.registrationData) {
    state.registrationData = {};
  }

  const planCode = normalizePlanCode(state.registrationData?.planCode || 'economico');
  const billingCycle = getCurrentBillingCycle();
  const price =
    Number(state.registrationData?.planPrice || 0) ||
    getPlanPrice(planCode, billingCycle);

  const trialDays = Number(state.registrationData?.trialDays || 15);
  const dueDate = addDays(new Date(), trialDays);
  const devices = Number(state.registrationData?.devicesLimit || getPlanDevices(planCode));

  el.innerHTML = `
    <strong>Plano:</strong> ${getPlanLabel(planCode)}<br>
    <strong>Ciclo:</strong> ${billingCycle === 'yearly' ? 'Anual' : 'Mensal'}<br>
    <strong>Dispositivos:</strong> ${devices}<br>
    <strong>Valor:</strong> ${formatCurrency(price)}${billingCycle === 'yearly' ? ' /ano' : ' /mês'}<br>
    <strong>Teste grátis:</strong> ${trialDays} dias<br>
    <strong>Primeira cobrança:</strong> ${dueDate.toLocaleDateString('pt-BR')}<br>
    <strong>Forma de pagamento:</strong> Cartão
  `;
}

function renderPaymentSettings() {
  if (!state.registrationData) {
    state.registrationData = {};
  }

  if (!state.currentBillingCycle) {
    state.currentBillingCycle = state.registrationData.billingCycle || 'monthly';
  }

  if (!state.registrationData.paymentMethod) {
    state.registrationData.paymentMethod = 'card';
  }

  syncBillingCycleButtons();
  syncPlanPriceVisibility();
  updatePlanSummary();
  toggleCardScreenByMethod();
  updateActivationUI();
}

/* ================= MÉTODO PAGAMENTO ================= */

export function selectCheckoutPaymentMethod(method) {
  const normalized = String(method || '').toLowerCase();

  if (normalized !== 'card') {
    return;
  }

  if (!state.registrationData) {
    state.registrationData = {};
  }

  state.registrationData.paymentMethod = 'card';

  document.querySelectorAll('[data-payment-method]').forEach((el) => {
    const elementMethod = String(el.dataset.paymentMethod || '').toLowerCase();
    el.classList.toggle('active', elementMethod === 'card');
  });

  updatePlanSummary();
  toggleCardScreenByMethod();
}

/* ================= CARTÃO PREMIUM ================= */

export function initPremiumCardUI() {
  if (premiumCardUIBound) return;
  premiumCardUIBound = true;

  const numberInput = document.getElementById('number');
  const holderInput = document.getElementById('holder');
  const expiryInput = document.getElementById('expiry');
  const cvvInput = document.getElementById('cvv');

  const card = document.getElementById('creditCard');
  const cardNumber = document.getElementById('cardNumber');
  const cardHolder = document.getElementById('cardHolder');
  const cardExpiry = document.getElementById('cardExpiry');
  const cardCvv = document.getElementById('cardCvv');

  if (!numberInput || !holderInput || !expiryInput || !cvvInput) return;
  if (!card || !cardNumber || !cardHolder || !cardExpiry || !cardCvv) return;

  numberInput.addEventListener('input', () => {
    const formatted = formatCardNumber(numberInput.value);
    const brand = detectBrand(formatted);

    numberInput.value = formatted;
    cardNumber.textContent = formatted || '0000 0000 0000 0000';

    updateCardBrandUI(brand);
  });

  holderInput.addEventListener('input', () => {
    const value = String(holderInput.value || '').toUpperCase().slice(0, 26);
    holderInput.value = value;
    cardHolder.textContent = value || 'NOME COMPLETO';
  });

  expiryInput.addEventListener('input', () => {
    const formatted = formatExpiry(expiryInput.value);
    expiryInput.value = formatted;
    cardExpiry.textContent = formatted || '00/00';
  });

  cvvInput.addEventListener('focus', () => {
    card.classList.add('flip');
  });

  cvvInput.addEventListener('blur', () => {
    card.classList.remove('flip');
  });

  cvvInput.addEventListener('input', () => {
    const value = onlyDigits(cvvInput.value).slice(0, 4);
    cvvInput.value = value;
    cardCvv.textContent = value || '000';
  });

  updateCardBrandUI('card');
}

/* ================= SALVAR CARTÃO ================= */

export async function saveCheckoutPaymentMethod() {
  const numberInput = document.getElementById('number');
  const holderInput = document.getElementById('holder');

  const holderName =
    String(holderInput?.value || '').trim() ||
    state.registrationData?.name ||
    'Titular';

  const rawCard = onlyDigits(numberInput?.value || '');

  if (!rawCard || rawCard.length < 13) {
    throw new Error('Informe um número de cartão válido.');
  }

  const brand = detectBrand(rawCard);

  return await saveSubscriptionPaymentMethod({
    type: 'card',
    cardToken: `card-${rawCard.slice(-4)}`,
    holderName,
    lastFour: rawCard.slice(-4),
    brand
  });
}

/* ================= ASSINATURA ================= */

// ✅ CORRIGIDO: substituídos os alert() por mensagens no elemento #subscribePlanStatus.
// O alert() causava a mensagem "ausente" pois bloqueava o thread antes da UI atualizar.
export async function subscribeCurrentPlan() {
  const btn = document.getElementById('subscribePlanBtn');
  const status = document.getElementById('subscribePlanStatus');

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
    status.classList.toggle('is-success', !isError);
  }

  try {
    markSignupPaymentCompleted(false);

    if (!state.registrationData?.planCode) {
      setStatus('Escolha um plano antes de continuar.', true);
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Processando...';
    }

    setStatus('Processando seu cartão...');

    const paymentMethod = 'card';

    if (!state.registrationData) {
      state.registrationData = {};
    }

    state.registrationData.paymentMethod = 'card';
    state.registrationData.billingCycle = getCurrentBillingCycle();
    state.registrationData.planPrice = getPlanPrice(
      state.registrationData.planCode,
      state.registrationData.billingCycle
    );

    await saveCheckoutPaymentMethod();

    const payload = await createSubscription({
      planCode: state.registrationData?.planCode,
      billingCycle: state.registrationData?.billingCycle || 'monthly',
      paymentMethod
    });

    const rawUrl = payload?.initPoint || payload?.checkoutUrl;
    const url = _safeUrl(rawUrl);

    if (!url) {
      throw new Error('Não foi possível gerar o checkout. Tente novamente.');
    }

    window.open(url, '_blank');

    state.registrationData.paymentCompleted = true;
    state.registrationData.registrationStep = 'payment';

    markSignupPaymentCompleted(true);
    updateActivationUI();

    setStatus('Checkout gerado com sucesso. Após concluir a autorização, clique em "Concluir ativação".');
  } catch (err) {
    console.error(err);

    if (state.registrationData) {
      state.registrationData.paymentCompleted = false;
    }

    markSignupPaymentCompleted(false);
    updateActivationUI();

    setStatus(err?.message || 'Erro ao assinar plano. Tente novamente.', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Salvar cartão';
    }
  }
}

/* ================= BLOQUEIO ================= */

export function handleSubscriptionBlock(_status) {
  // fluxo de bloqueio controlado pelo auth.js
}

/* ================= PERMISSÕES ================= */

export function applyPaymentPermissions(role) {
  const roleKey = String(role || '').toLowerCase();
  const canManage = Boolean(permissions[roleKey]?.payments);

  document.querySelectorAll('.payments-only').forEach((el) => {
    el.classList.toggle('hidden', !canManage);
  });
}

/* ================= CONFIG DE PAGAMENTO ================= */

export async function savePaymentSettings(payload) {
  const nextSettings = {
    ...DEFAULT_PAYMENT_SETTINGS,
    ...(state.paymentSettings || {}),
    ...(payload || {})
  };

  state.paymentSettings = nextSettings;
  persistPaymentSettingsLocal();

  try {
    await savePaymentSettingsService(nextSettings);
  } catch (error) {
    console.warn('Erro ao salvar configurações de pagamento:', error);
  }

  return nextSettings;
}

/* ================= BIND ================= */

export function bindPaymentActions() {
  if (paymentActionsBound) return;
  paymentActionsBound = true;

  document.getElementById('subscribePlanBtn')?.addEventListener('click', subscribeCurrentPlan);

  document.querySelectorAll('[data-payment-method]').forEach((el) => {
    el.addEventListener('click', () => {
      selectCheckoutPaymentMethod(el.dataset.paymentMethod);
    });
  });

  bindBillingToggle();
  bindChoosePlanButtons();
  initPremiumCardUI();
  renderPaymentSettings();
}

/* ─── Populate plan cards from backend API (single source of truth) ──── */

const PLAN_CODE_FROM_NAME = {
  'básico': 'basico', 'basico': 'basico',
  'econômico': 'economico', 'economico': 'economico',
  'pró': 'pro', 'pro': 'pro'
};

export async function initPlansFromAPI() {
  try {
    const data = await getPublicPlans();
    if (!data?.plans?.length) return;

    const byCode = {};
    data.plans.forEach(p => { byCode[p.code] = p; });

    // Update PRICE_MAP with server-side values
    data.plans.forEach(p => {
      const k = PLAN_CODE_FROM_NAME[p.code] || p.code;
      if (PRICE_MAP.monthly[k]  !== undefined) PRICE_MAP.monthly[k]  = p.monthlyPrice;
      if (PRICE_MAP.yearly[k]   !== undefined) PRICE_MAP.yearly[k]   = p.annualPrice;
      if (PRICE_MAP.yearlyMonthly[k] !== undefined) PRICE_MAP.yearlyMonthly[k] = p.annualMonthlyEquivalent;
    });

    // Update DOM plan card prices
    document.querySelectorAll('[data-action="choose-plan"]').forEach(btn => {
      const rawName = String(btn.dataset.signupPlan || '').trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      const planKey = { 'basico': 'basico', 'economico': 'economico', 'pro': 'pro' }[rawName] || rawName;
      const plan = byCode[planKey];
      if (!plan) return;

      btn.dataset.signupPrice = String(plan.monthlyPrice);
      btn.dataset.yearlyPrice  = String(plan.annualPrice);

      const card = btn.closest('.plan-saas-card');
      if (!card) return;

      const monthlyEl = card.querySelector('[data-price="monthly"]');
      const yearlyEl  = card.querySelector('[data-price="yearly"]');
      const noteEl    = card.querySelector('[data-price-note="yearly"]');

      if (monthlyEl) monthlyEl.textContent = `R$ ${plan.monthlyPrice.toFixed(2).replace('.', ',')}`;
      if (yearlyEl)  yearlyEl.textContent  = `R$ ${plan.annualMonthlyEquivalent.toFixed(2).replace('.', ',')}`;
      if (noteEl) {
        noteEl.innerHTML = `Plano anual &bull; R$ ${plan.annualPrice.toFixed(2).replace('.', ',')}/ano<br>`
          + `<span class="plans-savings-link">Economize ${_esc(String(Number(plan.annualDiscountPercent) || 0))}%</span>`;
      }
    });
  } catch (err) {
    console.warn('[payments] initPlansFromAPI failed — using static prices', err);
  }
}