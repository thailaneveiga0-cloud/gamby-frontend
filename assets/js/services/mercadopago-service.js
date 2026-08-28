import { api } from '../api.js';
import { KEYS } from '../storage.js';

function getSavedSession() {
  try {
    const raw =
      localStorage.getItem(KEYS.session) ||
      localStorage.getItem('gamby_auth_session_modular') ||
      localStorage.getItem('gamby_auth_session') ||
      localStorage.getItem('session');

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePaymentMethod(value = '') {
  const method = String(value || '').trim().toLowerCase();

  if (method === 'pix') return 'pix';
  if (method === 'boleto') return 'boleto';
  return 'card';
}

function normalizeBillingCycle(value = '') {
  const cycle = String(value || '').trim().toLowerCase();
  return cycle === 'yearly' ? 'yearly' : 'monthly';
}

function normalizePlanCode(value = '') {
  const plan = String(value || '').trim().toLowerCase();

  if (plan.includes('pro')) return 'pro';
  if (plan.includes('econ')) return 'economico';
  return 'basico';
}

export async function createSubscription(payload = {}) {
  const session = getSavedSession();

  if (!session?.token) {
    throw new Error('Usuário não autenticado.');
  }

  // companyId is derived from JWT on the backend — never trusted from client
  const paymentMethod = normalizePaymentMethod(payload?.paymentMethod);
  const billingCycle  = normalizeBillingCycle(payload?.billingCycle);
  const planCode      = normalizePlanCode(payload?.planCode);
  const successUrl    = String(payload?.successUrl || '').trim() || window.location.origin;

  return api.request('/v1/mercadopago/subscription', {
    method: 'POST',
    body: JSON.stringify({ planCode, billingCycle, paymentMethod, successUrl })
  });
}