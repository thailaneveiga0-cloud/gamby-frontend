import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest, getAuthToken } from '../http.js';
import { getBillingStatus, changeBillingPlan, normalizeBillingStatus } from './billing-service.js';

function fromApi(company) {
  if (!company) {
    return state.companySettings;
  }

  return {
    companyName: company.legalName || company.companyName || 'Minha Empresa',
    tradeName: company.tradeName || 'Gamby Cliente',
    cnpj: company.cnpj || '',
    phone: company.phone || '',
    email: company.email || '',
    address: company.address || '',
    noteFooter:
      company.reportFooter ||
      'Obrigado pela preferência.'
  };
}

function toApi(settings) {
  return {
    legalName: settings.companyName,
    tradeName: settings.tradeName,
    cnpj: settings.cnpj,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    reportFooter: settings.noteFooter
  };
}

/* ================= SUBSCRIPTION ================= */

function normalizeSubscription(payload) {
  const fallbackPlanCode = state.currentUser?.planCode || 'basico';

  if (!payload) {
    return {
      companyId: state.currentUser?.companyId || '',
      companyName: 'Minha empresa',
      subscriptionId: null,
      status: 'trial',
      billingCycle: 'monthly',
      paymentMethod: 'card',
      autoDebitEnabled: false,
      trialStartsAt: null,
      trialEndsAt: null,
      nextBillingAt: null,
      planCode: fallbackPlanCode,
      planName: 'Básico',
      priceMonthly: 79.90,
      priceYearly: 766.80,
      trialDays: 15,
      cardLast4: null,
      cardBrand: null,
      daysLeft: 0
    };
  }

  return {
    companyId: payload.companyId,
    companyName: payload.companyName,
    subscriptionId: payload.subscriptionId,
    status: payload.status,
    billingCycle: payload.billingCycle,
    paymentMethod: payload.paymentMethod,
    autoDebitEnabled: payload.autoDebitEnabled,

    trialStartsAt: payload.trialStartsAt,
    trialEndsAt: payload.trialEndsAt,
    nextBillingAt: payload.nextBillingAt,

    planCode: payload.planCode,
    planName: payload.planName,

    priceMonthly: payload.priceMonthly,
    priceYearly: payload.priceYearly,
    trialDays: payload.trialDays,

    cardLast4: payload.cardLast4,
    cardBrand: payload.cardBrand,

    daysLeft: payload.daysLeft
  };
}

function syncCurrentUserPlan(subscription) {
  if (!state.currentUser || !subscription) return;

  state.currentUser.planCode = subscription.planCode;
  state.currentUser.planName = subscription.planName;
}

/* ================= COMPANY ================= */

export async function saveCompanySettingsService(settings) {
  if (isBackendReady() && getAuthToken()) {
    try {
      const payload = await httpRequest(buildEndpoint('companies', 'me'), {
        method: 'PUT',
        body: JSON.stringify(toApi(settings))
      });

      const normalized = fromApi(payload);
      save(KEYS.companySettings, normalized);
      state.companySettings = normalized;
      return normalized;
    } catch {
      // fallback local
    }
  }

  save(KEYS.companySettings, settings);
  state.companySettings = settings;
  return settings;
}

export async function loadCompanySettingsService() {
  // Only call authenticated endpoint when a token exists
  if (isBackendReady() && getAuthToken()) {
    try {
      const payload = await httpRequest(buildEndpoint('companies', 'me'));
      const normalized = fromApi(payload);
      save(KEYS.companySettings, normalized);
      state.companySettings = normalized;
      return normalized;
    } catch {
      // fallback local
    }
  }

  const localSettings = load(KEYS.companySettings, state.companySettings);
  state.companySettings = localSettings;
  return localSettings;
}

/* ================= SUBSCRIPTION ================= */

export async function loadCompanySubscriptionService() {
  try {
    if (isBackendReady() && getAuthToken()) {
      // Use unified billing endpoint — companyId sourced from JWT server-side
      const payload = await getBillingStatus();
      const billing = normalizeBillingStatus(payload);

      if (billing) {
        const normalized = normalizeSubscription({
          status:       billing.status,
          planCode:     billing.planCode,
          planName:     billing.planName,
          billingCycle: billing.billingCycle,
          trialEndsAt:  billing.trialEndsAt,
          nextBillingAt: billing.nextBillingAt
        });

        state.subscription = normalized;
        syncCurrentUserPlan(normalized);
        return normalized;
      }
    }
  } catch (error) {
    console.warn('⚠️ Backend não respondeu, usando fallback.', error);
  }

  const fallback = normalizeSubscription(null);
  state.subscription = fallback;
  syncCurrentUserPlan(fallback);
  return fallback;
}

export async function upgradeCompanyPlanService(planCode, options = {}) {
  const normalizedPlanCode = String(planCode || '').trim().toLowerCase();
  if (!normalizedPlanCode) return;

  if (isBackendReady()) {
    try {
      const billingCycle = options?.billingCycle || state.subscription?.billingCycle || 'monthly';

      // Use billing plan endpoint — backend validates plan from DB, never trusts client price
      const payload = await changeBillingPlan({ planCode: normalizedPlanCode, billingCycle });
      const billing = normalizeBillingStatus(payload);

      if (billing) {
        const normalized = normalizeSubscription({
          status:       billing.status,
          planCode:     billing.planCode      || normalizedPlanCode,
          planName:     billing.planName      || normalizedPlanCode,
          billingCycle: billing.billingCycle  || billingCycle
        });

        state.subscription = normalized;
        syncCurrentUserPlan(normalized);
        return normalized;
      }
    } catch (error) {
      console.error('Erro ao atualizar plano:', error);
      throw error;
    }
  }

  return null;
}