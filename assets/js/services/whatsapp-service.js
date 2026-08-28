/**
 * whatsapp-service.js — Integração WhatsApp Business Platform (Meta Cloud API)
 *
 * Segurança:
 *   - Tokens e secrets são enviados ao backend via POST (nunca em localStorage)
 *   - Apenas IDs públicos são salvos localmente (phoneNumberId, businessAccountId, appId)
 *   - Nenhuma mensagem técnica é exposta ao usuário final
 */

import { httpRequest } from '../http.js';

/* ─── URL builder ─────────────────────────────────────────────────────────── */

function apiUrl(path) {
  const base = String(
    (typeof window !== 'undefined' && window.GAMBY_CONFIG?.apiUrl) ||
    localStorage.getItem('gamby_backend_api_url') ||
    ''
  ).replace(/\/+$/, '');
  if (!base) return null;
  return `${base}${path}`;
}

async function _apiFetch(path, opts = {}) {
  const url = apiUrl(path);
  if (!url) throw new Error('url_not_configured');
  return httpRequest(url, opts);
}

/* ─── localStorage keys (apenas IDs públicos) ─────────────────────────────── */

const LS_META_SAFE = 'gamby_wa_meta_safe';

function _readMetaSafe(companyId) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_META_SAFE) || '{}');
    return all[companyId] ?? null;
  } catch { return null; }
}

function _writeMetaSafe(companyId, cfg) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_META_SAFE) || '{}');
    all[companyId] = cfg;
    localStorage.setItem(LS_META_SAFE, JSON.stringify(all));
  } catch {}
}

function _clearMetaSafe(companyId) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_META_SAFE) || '{}');
    delete all[companyId];
    localStorage.setItem(LS_META_SAFE, JSON.stringify(all));
  } catch {}
}

/* ─── Status constants ────────────────────────────────────────────────────── */

export const WA_STATUS = {
  NOT_CONFIGURED: 'not_configured',
  CONFIGURED:     'configured',
  ACTIVE:         'active',
  DISCONNECTED:   'disconnected',
  ERROR:          'error',
};

/* ─── getWhatsAppStatus ───────────────────────────────────────────────────── */

export async function getWhatsAppIntegrationStatus(companyId) {
  try {
    const res = await _apiFetch('/v1/integrations/whatsapp/status');
    return res ?? { status: WA_STATUS.NOT_CONFIGURED, phone: null };
  } catch {
    return { status: WA_STATUS.NOT_CONFIGURED, phone: null };
  }
}

/* ─── saveWhatsAppMetaConfig ──────────────────────────────────────────────── */

/**
 * Envia configuração ao backend via POST seguro.
 * Tokens e secrets nunca ficam em localStorage.
 * Localmente salva apenas IDs públicos para exibição.
 */
export async function saveWhatsAppMetaConfig(companyId, config) {
  const safeCfg = {
    businessAccountId: String(config.businessAccountId || '').trim(),
    phoneNumberId:     String(config.phoneNumberId || '').trim(),
    appId:             String(config.appId || '').trim(),
    updatedAt:         new Date().toISOString(),
  };

  const fullCfg = {
    ...safeCfg,
    wabaId:       String(config.wabaId || config.businessAccountId || '').trim(),
    accessToken:  String(config.accessToken || '').trim(),
    appSecret:    String(config.appSecret || '').trim(),
  };

  const res = await _apiFetch('/v1/integrations/whatsapp/config', {
    method: 'POST',
    body:   JSON.stringify(fullCfg),
  });

  _writeMetaSafe(companyId, safeCfg);
  return { success: true, ...(res ?? {}) };
}

/* ─── testWhatsAppMetaConnection ─────────────────────────────────────────── */

export async function testWhatsAppMetaConnection(companyId) {
  const res = await _apiFetch('/v1/integrations/whatsapp/test', {
    method: 'POST',
    body:   JSON.stringify({}),
  });
  return { success: true, ...(res ?? {}) };
}

/* ─── disconnectWhatsApp ──────────────────────────────────────────────────── */

export async function disconnectWhatsApp(companyId) {
  try {
    await _apiFetch('/v1/integrations/whatsapp/disconnect', {
      method: 'POST',
      body:   JSON.stringify({}),
    });
  } catch {
    // Even if request fails, clear local data
  }
  _clearMetaSafe(companyId);
  return { success: true };
}

/* ─── sendWhatsAppMessage ─────────────────────────────────────────────────── */

export async function sendWhatsAppMessage(companyId, payload) {
  const res = await _apiFetch('/v1/integrations/whatsapp/send', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
  return res;
}

/* ─── listWhatsAppConversations ───────────────────────────────────────────── */

export async function listWhatsAppConversations(companyId) {
  try {
    const res = await _apiFetch('/v1/integrations/whatsapp/conversations');
    return Array.isArray(res) ? res : (res?.conversations ?? []);
  } catch {
    return [];
  }
}

/* ─── listWhatsAppMessages ────────────────────────────────────────────────── */

export async function listWhatsAppMessages(companyId, conversationId) {
  try {
    const res = await _apiFetch(`/v1/integrations/whatsapp/conversations/${conversationId}/messages`);
    return Array.isArray(res) ? res : (res?.messages ?? []);
  } catch {
    return [];
  }
}

/* ─── getWhatsAppMetaSafeConfig (exibição apenas) ────────────────────────── */

export function getWhatsAppMetaSafeConfig(companyId) {
  return _readMetaSafe(companyId);
}
