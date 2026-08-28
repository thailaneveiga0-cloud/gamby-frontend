/**
 * billing-service.js — Frontend service for /v1/billing endpoints
 *
 * SECURITY: Never sends companyId, userId, or prices from the frontend.
 * The backend derives companyId exclusively from the JWT bearer token.
 * Plan prices are always resolved server-side.
 */

import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest, getAuthToken } from '../http.js';

/* ─── Public plan catalog (no auth required) ──────────────────────────── */

export async function getPublicPlans() {
  // public: true → no Authorization header, no X-Tenant-Id, no warning
  return httpRequest(billingUrl('plans'), { public: true }).catch(() => null);
}

function billingUrl(suffix = '') {
  const url = buildEndpoint('billing', suffix);
  // Guard: stale persisted localStorage config may not have the billing key,
  // causing buildEndpoint to omit /v1/billing from the URL (→ 404).
  if (url && url.includes('/v1/billing')) return url;
  const base = String(
    (typeof window !== 'undefined' && window.GAMBY_CONFIG?.apiUrl) ||
    localStorage.getItem('gamby_backend_api_url') || ''
  ).replace(/\/+$/, '');
  const suf = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
  return `${base}/v1/billing${suf}`;
}

/* ─── Subscription status ─────────────────────────────────────────────── */

export async function getBillingStatus() {
  if (!isBackendReady() || !getAuthToken()) return null;
  return httpRequest(billingUrl('me'));
}

/* ─── Create checkout (new subscription or re-subscribe) ─────────────── */

export async function createBillingCheckout({ planCode, billingCycle = 'monthly', paymentMethod = 'pix' } = {}) {
  if (!isBackendReady() || !getAuthToken()) throw new Error('Autenticação necessária.');

  return httpRequest(billingUrl('checkout'), {
    method: 'POST',
    body: JSON.stringify({ planCode, billingCycle, paymentMethod })
  });
}

/* ─── Invoice history ─────────────────────────────────────────────────── */

export async function getBillingInvoices({ limit = 20, offset = 0 } = {}) {
  if (!isBackendReady() || !getAuthToken()) return { invoices: [], total: 0 };
  return httpRequest(`${billingUrl('invoices')}?limit=${limit}&offset=${offset}`);
}

/* ─── Cancel subscription ─────────────────────────────────────────────── */

export async function cancelBillingSubscription({ reason = 'user_request' } = {}) {
  if (!isBackendReady() || !getAuthToken()) throw new Error('Autenticação necessária.');

  return httpRequest(billingUrl('cancel'), {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

/* ─── Change plan (for active subscribers) ───────────────────────────── */

export async function changeBillingPlan({ planCode, billingCycle } = {}) {
  if (!isBackendReady() || !getAuthToken()) throw new Error('Autenticação necessária.');

  return httpRequest(billingUrl('plan'), {
    method: 'PUT',
    body: JSON.stringify({ planCode, billingCycle })
  });
}

/* ─── Normalize billing status into the subscription shape the app uses ─ */

export function normalizeBillingStatus(payload) {
  if (!payload) return null;

  return {
    status:        payload.status       ?? 'trial',
    planCode:      payload.planCode     ?? 'basico',
    planName:      payload.planName     ?? 'Básico',
    billingCycle:  payload.billingCycle ?? 'monthly',
    trialEndsAt:   payload.trialEndsAt  ?? null,
    nextBillingAt: payload.nextBillingAt ?? null,
    allowed:       payload.allowed      ?? false,
    checkoutUrl:   payload.checkoutUrl  ?? null,
    provider:      payload.provider     ?? null
  };
}
