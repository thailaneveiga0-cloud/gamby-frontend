/**
 * marketing-service.js — Serviço de marketing GAMBY
 *
 * Tenta chamada real para a API; em ausência de backend usa localStorage.
 * Credenciais sensíveis (apiKey, smtpPassword) nunca são salvas localmente.
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

/* ─── localStorage keys ───────────────────────────────────────────────────── */

const LS = {
  CAMPAIGNS:   'gamby_mkt_campaigns',
  CUSTOMERS:   'gamby_mkt_customers',
  COUPONS:     'gamby_mkt_coupons',
  AUTOMATIONS: 'gamby_mkt_automations',
  EMAIL_CONFIG:'gamby_mkt_email_config',
};

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function asArray(v) { return Array.isArray(v) ? v : []; }
function _read(key)       { try { return asArray(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return []; } }
function _readObj(key)    { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function _write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function _uid()           { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function _now()           { return new Date().toISOString(); }

async function _apiFetch(path, opts = {}) {
  const url = apiUrl(path);
  if (!url) throw new Error('Backend não configurado');
  return httpRequest(url, opts);
}

/* ─── Campaigns ───────────────────────────────────────────────────────────── */

export async function listCampaigns(companyId) {
  try {
    const res = await _apiFetch('/v1/marketing/campaigns');
    return asArray(res?.campaigns ?? res);
  } catch {
    const all = _read(LS.CAMPAIGNS);
    return companyId ? all.filter(c => c.companyId === companyId) : all;
  }
}

export async function createCampaign(data) {
  const item = {
    id:          _uid(),
    companyId:   data.companyId || null,
    name:        String(data.name || '').trim(),
    type:        String(data.type || 'outro').trim(),
    channel:     String(data.channel || 'email').trim(),
    audience:    String(data.audience || 'todos').trim(),
    status:      'rascunho',
    targetCount: 0,
    sentCount:   0,
    openCount:   0,
    clickCount:  0,
    message:     String(data.message || '').trim(),
    scheduledAt: data.scheduledAt || null,
    startDate:   data.startDate   || null,
    endDate:     data.endDate     || null,
    notes:       String(data.notes || '').trim(),
    createdAt:   _now(),
    updatedAt:   _now(),
  };
  try {
    const res = await _apiFetch('/v1/marketing/campaigns', { method: 'POST', body: JSON.stringify(item) });
    return res?.campaign ?? res;
  } catch {
    const list = _read(LS.CAMPAIGNS);
    list.unshift(item);
    _write(LS.CAMPAIGNS, list);
    return item;
  }
}

export async function updateCampaign(id, patch) {
  try {
    const res = await _apiFetch(`/v1/marketing/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    return res?.campaign ?? res;
  } catch {
    const list = _read(LS.CAMPAIGNS);
    const idx  = list.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Campanha não encontrada');
    list[idx] = { ...list[idx], ...patch, updatedAt: _now() };
    _write(LS.CAMPAIGNS, list);
    return list[idx];
  }
}

export async function deleteCampaign(id) {
  try {
    await _apiFetch(`/v1/marketing/campaigns/${id}`, { method: 'DELETE' });
  } catch {
    _write(LS.CAMPAIGNS, _read(LS.CAMPAIGNS).filter(c => c.id !== id));
  }
}

export async function duplicateCampaign(id) {
  const list = _read(LS.CAMPAIGNS);
  const orig = list.find(c => c.id === id);
  if (!orig) throw new Error('Campanha não encontrada');
  const copy = {
    ...orig,
    id:          _uid(),
    name:        `Cópia de ${orig.name}`,
    status:      'rascunho',
    sentCount:   0,
    openCount:   0,
    clickCount:  0,
    scheduledAt: null,
    createdAt:   _now(),
    updatedAt:   _now(),
  };
  try {
    const res = await _apiFetch('/v1/marketing/campaigns', { method: 'POST', body: JSON.stringify(copy) });
    return res?.campaign ?? res;
  } catch {
    list.unshift(copy);
    _write(LS.CAMPAIGNS, list);
    return copy;
  }
}

/* ─── Customers ───────────────────────────────────────────────────────────── */

export async function listMarketingCustomers(companyId) {
  try {
    const res = await _apiFetch('/v1/marketing/customers');
    return asArray(res?.customers ?? res);
  } catch {
    const all = _read(LS.CUSTOMERS);
    return companyId ? all.filter(c => c.companyId === companyId) : all;
  }
}

export async function createMarketingCustomer(data) {
  const item = {
    id:        _uid(),
    companyId: data.companyId || null,
    name:      String(data.name || '').trim(),
    email:     String(data.email || '').trim().toLowerCase(),
    phone:     String(data.phone || '').trim(),
    tags:      Array.isArray(data.tags) ? data.tags : [],
    optedIn:   data.optedIn !== false,
    createdAt: _now(),
    updatedAt: _now(),
  };
  try {
    const res = await _apiFetch('/v1/marketing/customers', { method: 'POST', body: JSON.stringify(item) });
    return res?.customer ?? res;
  } catch {
    const list = _read(LS.CUSTOMERS);
    list.unshift(item);
    _write(LS.CUSTOMERS, list);
    return item;
  }
}

export async function deleteMarketingCustomer(id) {
  try {
    await _apiFetch(`/v1/marketing/customers/${id}`, { method: 'DELETE' });
  } catch {
    _write(LS.CUSTOMERS, _read(LS.CUSTOMERS).filter(c => c.id !== id));
  }
}

/* ─── Coupons ─────────────────────────────────────────────────────────────── */

export async function listCoupons(companyId) {
  try {
    const res = await _apiFetch('/v1/marketing/coupons');
    return asArray(res?.coupons ?? res);
  } catch {
    const all = _read(LS.COUPONS);
    return companyId ? all.filter(c => c.companyId === companyId) : all;
  }
}

export async function createCoupon(data) {
  const item = {
    id:        _uid(),
    companyId: data.companyId || null,
    code:      String(data.code || '').toUpperCase().trim(),
    type:      String(data.type || 'percent').trim(),
    value:     Number(data.value) || 0,
    minOrder:  Number(data.minOrder) || 0,
    maxUses:   data.maxUses ? Number(data.maxUses) : null,
    usedCount: 0,
    expiresAt: data.expiresAt || null,
    active:    true,
    createdAt: _now(),
    updatedAt: _now(),
  };
  try {
    const res = await _apiFetch('/v1/marketing/coupons', { method: 'POST', body: JSON.stringify(item) });
    return res?.coupon ?? res;
  } catch {
    const list = _read(LS.COUPONS);
    if (list.some(c => c.code === item.code && c.companyId === item.companyId)) {
      throw new Error('Já existe um cupom com esse código');
    }
    list.unshift(item);
    _write(LS.COUPONS, list);
    return item;
  }
}

export async function toggleCoupon(id, active) {
  try {
    const res = await _apiFetch(`/v1/marketing/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    return res?.coupon ?? res;
  } catch {
    const list = _read(LS.COUPONS);
    const idx  = list.findIndex(c => c.id === id);
    if (idx !== -1) { list[idx].active = active; list[idx].updatedAt = _now(); _write(LS.COUPONS, list); }
    return list[idx] ?? null;
  }
}

export async function deleteCoupon(id) {
  try {
    await _apiFetch(`/v1/marketing/coupons/${id}`, { method: 'DELETE' });
  } catch {
    _write(LS.COUPONS, _read(LS.COUPONS).filter(c => c.id !== id));
  }
}

/* ─── Automations ─────────────────────────────────────────────────────────── */

export async function listAutomations(companyId) {
  try {
    const res = await _apiFetch('/v1/marketing/automations');
    return asArray(res?.automations ?? res);
  } catch {
    const all = _read(LS.AUTOMATIONS);
    return companyId ? all.filter(a => a.companyId === companyId) : all;
  }
}

export async function createAutomation(data) {
  const item = {
    id:        _uid(),
    companyId: data.companyId || null,
    name:      String(data.name || '').trim(),
    trigger:   String(data.trigger || '').trim(),
    action:    String(data.action || '').trim(),
    channel:   String(data.channel || 'email').trim(),
    message:   String(data.message || '').trim(),
    active:    true,
    runCount:  0,
    createdAt: _now(),
    updatedAt: _now(),
  };
  try {
    const res = await _apiFetch('/v1/marketing/automations', { method: 'POST', body: JSON.stringify(item) });
    return res?.automation ?? res;
  } catch {
    const list = _read(LS.AUTOMATIONS);
    list.unshift(item);
    _write(LS.AUTOMATIONS, list);
    return item;
  }
}

export async function toggleAutomation(id, active) {
  try {
    const res = await _apiFetch(`/v1/marketing/automations/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    return res?.automation ?? res;
  } catch {
    const list = _read(LS.AUTOMATIONS);
    const idx  = list.findIndex(a => a.id === id);
    if (idx !== -1) { list[idx].active = active; list[idx].updatedAt = _now(); _write(LS.AUTOMATIONS, list); }
    return list[idx] ?? null;
  }
}

export async function deleteAutomation(id) {
  try {
    await _apiFetch(`/v1/marketing/automations/${id}`, { method: 'DELETE' });
  } catch {
    _write(LS.AUTOMATIONS, _read(LS.AUTOMATIONS).filter(a => a.id !== id));
  }
}

/* ─── E-mail config ───────────────────────────────────────────────────────── */

export async function getEmailConfig(companyId) {
  try {
    const res = await _apiFetch('/v1/integrations/email/status');
    return res ?? _readObj(`${LS.EMAIL_CONFIG}_${companyId || 'default'}`);
  } catch {
    return _readObj(`${LS.EMAIL_CONFIG}_${companyId || 'default'}`);
  }
}

/**
 * Salva configuração de e-mail no backend via POST seguro.
 * SEGURANÇA: apiKey e password nunca são gravados no localStorage.
 * Apenas dados não-sensíveis são persistidos localmente.
 */
export async function saveEmailConfig(companyId, data) {
  const safeCfg = {
    companyId,
    senderName:  String(data.senderName  || data.fromName  || '').trim(),
    senderEmail: String(data.senderEmail || data.fromEmail || '').trim(),
    provider:    String(data.provider    || '').trim(),
    smtpHost:    String(data.smtpHost    || '').trim(),
    smtpPort:    Number(data.smtpPort)   || 587,
    smtpUser:    String(data.smtpUser    || '').trim(),
    updatedAt:   _now(),
    // NOT stored: apiKey, password
  };

  const fullCfg = {
    ...safeCfg,
    password: String(data.password || data.smtpPassword || '').trim(),
    apiKey:   String(data.apiKey   || '').trim(),
  };

  const res = await _apiFetch('/v1/integrations/email/config', {
    method: 'POST',
    body:   JSON.stringify(fullCfg),
  });
  _write(`${LS.EMAIL_CONFIG}_${companyId || 'default'}`, safeCfg);
  return { ...(res ?? {}), saved: true };
}

/* ─── Relatórios (agrega dados reais) ────────────────────────────────────── */

export async function getMarketingReport(companyId) {
  try {
    const res = await _apiFetch('/v1/marketing/reports');
    if (res && typeof res === 'object' && !Array.isArray(res)) return res?.report ?? res;
    throw new Error('invalid');
  } catch {
    const [campaigns, coupons, customers, automations] = await Promise.all([
      listCampaigns(companyId),
      listCoupons(companyId),
      listMarketingCustomers(companyId),
      listAutomations(companyId),
    ]);
    return {
      totalCampaigns:  campaigns.length,
      activeCampaigns: campaigns.filter(c => c.status === 'ativa').length,
      totalCustomers:  customers.length,
      activeCoupons:   coupons.filter(c => c.active).length,
      usedCoupons:     coupons.reduce((s, c) => s + (c.usedCount || 0), 0),
      automationsOn:   automations.filter(a => a.active).length,
    };
  }
}

/* ─── Constantes ──────────────────────────────────────────────────────────── */

export const CAMPAIGN_CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email',    label: 'E-mail' },
  { value: 'sistema',  label: 'Notificação interna' },
  { value: 'manual',   label: 'Manual' },
];

export const CAMPAIGN_STATUSES = [
  { value: 'rascunho',   label: 'Rascunho',          cssClass: 'mkt-s-draft',
    desc: 'Salva mas não ativa. Revise e ative quando estiver pronta.' },
  { value: 'pronta',     label: 'Pronta para ativar', cssClass: 'mkt-s-ready',
    desc: 'Revisada e pronta para ativação ou agendamento.' },
  { value: 'agendada',   label: 'Agendada',           cssClass: 'mkt-s-scheduled',
    desc: 'Programada para envio em data futura.' },
  { value: 'ativa',      label: 'Ativa',              cssClass: 'mkt-s-active',
    desc: 'Em andamento.' },
  { value: 'pausada',    label: 'Pausada',            cssClass: 'mkt-s-paused',
    desc: 'Interrompida temporariamente.' },
  { value: 'encerrada',  label: 'Encerrada',          cssClass: 'mkt-s-ended',
    desc: 'Finalizada.' },
  { value: 'arquivada',  label: 'Arquivada',          cssClass: 'mkt-s-archived',
    desc: 'Fora da operação ativa. Mantida no histórico.' },
];

export const CAMPAIGN_TYPES = [
  { value: 'desconto',    label: 'Desconto' },
  { value: 'cupom',       label: 'Cupom' },
  { value: 'aniversario', label: 'Aniversário' },
  { value: 'reativacao',  label: 'Reativação de clientes' },
  { value: 'divulgacao',  label: 'Divulgação' },
  { value: 'combo',       label: 'Combo / Kit' },
  { value: 'liquidacao',  label: 'Liquidação' },
  { value: 'indicacao',   label: 'Indicação / Referral' },
  { value: 'outro',       label: 'Outro' },
];

export const CAMPAIGN_AUDIENCES = [
  { value: 'todos',          label: 'Todos os clientes' },
  { value: 'ativos',         label: 'Clientes ativos' },
  { value: 'inativos',       label: 'Clientes inativos (sem compra recente)' },
  { value: 'vip',            label: 'Clientes VIP' },
  { value: 'aniversariantes',label: 'Aniversariantes do mês' },
  { value: 'segmento',       label: 'Segmento personalizado' },
];

export const AUTOMATION_TRIGGERS = [
  { value: 'new_customer',   label: 'Novo cliente cadastrado' },
  { value: 'first_purchase', label: 'Primeira compra' },
  { value: 'abandoned_cart', label: 'Carrinho abandonado' },
  { value: 'birthday',       label: 'Aniversário do cliente' },
  { value: 'inactivity_30d', label: '30 dias sem compra' },
  { value: 'inactivity_60d', label: '60 dias sem compra' },
  { value: 'loyalty_points', label: 'Pontos de fidelidade atingidos' },
];

export const AUTOMATION_ACTIONS = [
  { value: 'send_email',    label: 'Enviar e-mail' },
  { value: 'send_whatsapp', label: 'Enviar WhatsApp' },
  { value: 'send_sms',      label: 'Enviar SMS' },
  { value: 'apply_coupon',  label: 'Aplicar cupom automático' },
  { value: 'add_tag',       label: 'Adicionar tag ao cliente' },
];
