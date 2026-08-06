import { state } from './state.js';
import { savePaymentSettingsService, loadPaymentSettingsService, saveSubscriptionPaymentMethod } from './services/payment-service.js';
import { KEYS, load } from './storage.js';
import { permissions } from './roles.js';
import { addDays, formatCurrency, setHtml, setText, toNumber } from './utils.js';

export const DEFAULT_PAYMENT_SETTINGS = {
  methods: { card: true, pix: true, boleto: true, cash: true },
  pixKey: '',
  boletoIssuer: '',
  autoReminderEnabled: true,
  autoDebitEnabled: true,
  reminderDaysBeforeTrialEnd: 1,
  generatedDeviceCodes: []
};

const PRICE_MAP = {
  monthly: {
    'Básico': 39.9,
    'Econômico': 79.9,
    'Pró': 129.9,
    basicHtml: 'R$ 39,90 <small>/mês</small>',
    ecoHtml: 'R$ 79,90 <small>/mês</small>',
    proHtml: 'R$ 129,90 <small>/mês</small>'
  },
  yearly: {
    'Básico': 430.92,
    'Econômico': 767.04,
    'Pró': 1247.04,
    basicHtml: 'R$ 430,92 <small>/ano</small>',
    ecoHtml: 'R$ 767,04 <small>/ano</small>',
    proHtml: 'R$ 1.247,04 <small>/ano</small>'
  }
};

export async function loadPaymentSettings() {
  state.paymentSettings = { ...DEFAULT_PAYMENT_SETTINGS, ...load(KEYS.paymentSettings, {}), ...(await loadPaymentSettingsService()) };
  state.paymentSettings.methods = { ...DEFAULT_PAYMENT_SETTINGS.methods, ...(state.paymentSettings.methods || {}) };
  state.paymentSettings.generatedDeviceCodes = Array.isArray(state.paymentSettings.generatedDeviceCodes)
    ? state.paymentSettings.generatedDeviceCodes
    : [];
  renderPaymentSettings();
  applyBillingCycle(state.currentBillingCycle);
}

export async function savePaymentSettings() {
  await savePaymentSettingsService(state.paymentSettings);
  setText('paymentSettingsStatus', 'Configurações salvas com sucesso.');
}

export function applyBillingCycle(mode) {
  const selectedMode = PRICE_MAP[mode] ? mode : 'monthly';
  state.currentBillingCycle = selectedMode;
  document.getElementById('monthlyBtn')?.classList.toggle('active', selectedMode === 'monthly');
  document.getElementById('yearlyBtn')?.classList.toggle('active', selectedMode === 'yearly');
  setHtml('basicPrice', PRICE_MAP[selectedMode].basicHtml);
  setHtml('ecoPrice', PRICE_MAP[selectedMode].ecoHtml);
  setHtml('proPrice', PRICE_MAP[selectedMode].proHtml);
  if (state.registrationData?.planName && PRICE_MAP[selectedMode][state.registrationData.planName]) {
    state.registrationData.planPrice = PRICE_MAP[selectedMode][state.registrationData.planName];
  }
  updatePlanSummary();
}

export function updatePlanSummary() {
  const summary = document.getElementById('selectedPlanSummary');
  if (!summary) return;
  const dueDate = addDays(new Date(), state.registrationData.trialDays);
  summary.innerHTML = `
    <strong>Plano selecionado:</strong> ${state.registrationData.planName}<br>
    <strong>Valor:</strong> ${formatCurrency(state.registrationData.planPrice)}${state.currentBillingCycle === 'yearly' ? ' /ano' : ' /mês'}<br>
    <strong>Período grátis:</strong> ${state.registrationData.trialDays} dias<br>
    <strong>Primeira cobrança estimada:</strong> ${dueDate.toLocaleDateString('pt-BR')}<br>
    <strong>Forma de pagamento:</strong> ${state.registrationData.paymentMethod}
  `;
}

export function selectCheckoutPaymentMethod(method) {
  state.registrationData.paymentMethod = method;
  document.querySelectorAll('[data-payment-method]').forEach((el) => {
    el.classList.toggle('active', el.dataset.paymentMethod === method);
  });
  updatePlanSummary();
}

export function buildReminderPreview() {
  const days = Number(state.paymentSettings.reminderDaysBeforeTrialEnd || 1);
  const reminderMessage = days === 1 ? 'Lembrete 1 dia antes do fim do teste.' : `Lembrete ${days} dias antes do fim do teste.`;
  setText('paymentReminderPreview', reminderMessage);
}

export function renderPaymentSettings() {
  const settings = state.paymentSettings;
  [['paymentMethodCard', 'card'], ['paymentMethodPix', 'pix'], ['paymentMethodBoleto', 'boleto'], ['paymentMethodCash', 'cash']].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(settings.methods[key]);
  });
  const pixKey = document.getElementById('paymentPixKey');
  const boletoIssuer = document.getElementById('paymentBoletoIssuer');
  const reminderDays = document.getElementById('paymentReminderDays');
  const autoReminder = document.getElementById('paymentAutoReminder');
  const autoDebit = document.getElementById('paymentAutoDebit');
  if (pixKey) pixKey.value = settings.pixKey || '';
  if (boletoIssuer) boletoIssuer.value = settings.boletoIssuer || '';
  if (reminderDays) reminderDays.value = settings.reminderDaysBeforeTrialEnd;
  if (autoReminder) autoReminder.checked = Boolean(settings.autoReminderEnabled);
  if (autoDebit) autoDebit.checked = Boolean(settings.autoDebitEnabled);
  buildReminderPreview();
  renderGeneratedCodes();
}

function readSettingsForm() {
  state.paymentSettings.methods.card = Boolean(document.getElementById('paymentMethodCard')?.checked);
  state.paymentSettings.methods.pix = Boolean(document.getElementById('paymentMethodPix')?.checked);
  state.paymentSettings.methods.boleto = Boolean(document.getElementById('paymentMethodBoleto')?.checked);
  state.paymentSettings.methods.cash = Boolean(document.getElementById('paymentMethodCash')?.checked);
  state.paymentSettings.pixKey = document.getElementById('paymentPixKey')?.value.trim() || '';
  state.paymentSettings.boletoIssuer = document.getElementById('paymentBoletoIssuer')?.value.trim() || '';
  state.paymentSettings.reminderDaysBeforeTrialEnd = Math.max(1, toNumber(document.getElementById('paymentReminderDays')?.value, 1));
  state.paymentSettings.autoReminderEnabled = Boolean(document.getElementById('paymentAutoReminder')?.checked);
  state.paymentSettings.autoDebitEnabled = Boolean(document.getElementById('paymentAutoDebit')?.checked);
}

export async function saveCheckoutPaymentMethod() {
  const holderName = document.getElementById('cardHolder')?.value.trim() || state.registrationData.name || 'Titular';
  const rawCard = (document.getElementById('cardNumber')?.value || '').replace(/\D/g, '');
  if (!rawCard) return null;
  try {
    return await saveSubscriptionPaymentMethod({
      type: state.registrationData.paymentMethod.toLowerCase() === 'cartão' ? 'card' : state.registrationData.paymentMethod.toLowerCase(),
      cardToken: `front-demo-${rawCard.slice(-4)}`,
      holderName,
      lastFour: rawCard.slice(-4),
      brand: 'visa'
    });
  } catch {
    return null;
  }
}

export function generateDeviceCode() {
  const code = `DEV-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  state.paymentSettings.generatedDeviceCodes.unshift({ code, createdAt: new Date().toISOString() });
  state.paymentSettings.generatedDeviceCodes = state.paymentSettings.generatedDeviceCodes.slice(0, 10);
  savePaymentSettings();
  renderGeneratedCodes();
}

export function renderGeneratedCodes() {
  const list = document.getElementById('deviceCodeList');
  if (!list) return;
  const codes = state.paymentSettings.generatedDeviceCodes || [];
  list.innerHTML = codes.length
    ? codes.map((item) => `<li><strong>${item.code}</strong> • ${new Date(item.createdAt).toLocaleString('pt-BR')}</li>`).join('')
    : '<li>Nenhum código gerado ainda.</li>';
}

export function applyPaymentPermissions(role) {
  const canManagePayments = !!permissions[role]?.payments;
  document.querySelectorAll('.payments-only').forEach((el) => el.classList.toggle('hidden', !canManagePayments));
}

export function bindPaymentActions() {
  document.getElementById('monthlyBtn')?.addEventListener('click', () => applyBillingCycle('monthly'));
  document.getElementById('yearlyBtn')?.addEventListener('click', () => applyBillingCycle('yearly'));
  document.querySelectorAll('[data-payment-method]').forEach((item) => {
    item.addEventListener('click', () => selectCheckoutPaymentMethod(item.dataset.paymentMethod));
  });
  document.getElementById('savePaymentSettingsBtn')?.addEventListener('click', async () => {
    readSettingsForm();
    await savePaymentSettings();
    buildReminderPreview();
  });
  document.getElementById('paymentReminderDays')?.addEventListener('input', () => {
    readSettingsForm();
    buildReminderPreview();
  });
  document.getElementById('generateDeviceCodeBtn')?.addEventListener('click', generateDeviceCode);
  document.querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      state.registrationData.planName = button.dataset.plan;
      state.registrationData.planPrice = Number(button.dataset.price);
      state.registrationData.trialDays = Number(button.dataset.trial);
      if (PRICE_MAP[state.currentBillingCycle]?.[button.dataset.plan]) {
        state.registrationData.planPrice = PRICE_MAP[state.currentBillingCycle][button.dataset.plan];
      }
      updatePlanSummary();
    });
  });
}
