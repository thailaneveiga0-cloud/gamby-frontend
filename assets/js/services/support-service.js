/**
 * support-service.js — Serviço de chamados de suporte GAMBY
 *
 * Tenta chamada real para a API; em ausência de backend usa localStorage
 * como persistência local. Estrutura pronta para integração com backend.
 */

import { httpRequest } from '../http.js';

const LS_KEY         = 'gamby_support_tickets';
const LS_REPLIES_KEY = 'gamby_support_replies';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function asArray(v) { return Array.isArray(v) ? v : []; }

function _apiUrl(path) {
  const base = String(
    (typeof window !== 'undefined' && window.GAMBY_CONFIG?.apiUrl) ||
    localStorage.getItem('gamby_backend_api_url') ||
    ''
  ).replace(/\/+$/, '');
  if (!base) return null;
  return `${base}${path}`;
}

function _token() {
  return localStorage.getItem('gamby_token') || sessionStorage.getItem('gamby_token') || '';
}

async function _apiFetch(path, opts = {}) {
  const url = _apiUrl(path);
  if (!url) throw new Error('Backend não configurado');
  return httpRequest(url, opts);
}

function _readTickets() {
  try { return asArray(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return []; }
}
function _writeTickets(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
function _readReplies() {
  try { return asArray(JSON.parse(localStorage.getItem(LS_REPLIES_KEY) || '[]')); } catch { return []; }
}
function _writeReplies(list) { localStorage.setItem(LS_REPLIES_KEY, JSON.stringify(list)); }
function _uid() { return `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function _now() { return new Date().toISOString(); }

// Mapeia status do backend para o formato local
function _mapStatus(backendStatus) {
  const map = {
    open:            'aberto',
    in_analysis:     'em_atendimento',
    waiting_client:  'aguardando',
    in_development:  'em_atendimento',
    resolved:        'resolvido',
    closed:          'fechado',
  };
  return map[backendStatus] || backendStatus;
}

function _mapTicketFromApi(t) {
  if (!t) return t;
  return {
    ...t,
    status: _mapStatus(t.status),
    // messages -> replies para compatibilidade com UI
    replies: asArray(t.messages).map(m => ({
      id:         m.id,
      ticketId:   t.id,
      message:    m.body,
      authorId:   m.authorId,
      authorName: m.authorName,
      isStaff:    m.authorType === 'platform',
      createdAt:  m.createdAt,
    })),
  };
}

/* ─── Tickets ─────────────────────────────────────────────────────────────── */

export async function listTickets(ctx = {}) {
  try {
    const res = await _apiFetch('/v1/support');
    const items = asArray(res?.items ?? res);
    return items.map(_mapTicketFromApi);
  } catch {
    const all = _readTickets();
    if (!ctx.userId) return all;
    if (ctx.role === 'desenvolvedora') return all;
    if (ctx.role === 'admin' || ctx.role === 'gerente') {
      return ctx.companyId ? all.filter(t => t.companyId === ctx.companyId) : all;
    }
    return all.filter(t => t.userId === ctx.userId);
  }
}

export async function createTicket(data) {
  const payload = {
    subject:     String(data.subject || '').trim(),
    category:    String(data.category || 'outro').trim(),
    priority:    String(data.priority || 'medium').trim(),
    description: String(data.description || '').trim(),
    module:      data.module || null,
  };

  try {
    const res = await _apiFetch('/v1/support', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return _mapTicketFromApi(res?.ticket ?? res);
  } catch {
    const ticket = {
      id:        _uid(),
      ...payload,
      status:    'aberto',
      userId:    data.userId || null,
      companyId: data.companyId || null,
      createdAt: _now(),
      updatedAt: _now(),
    };
    const list = _readTickets();
    list.unshift(ticket);
    _writeTickets(list);
    return ticket;
  }
}

export async function getTicket(ticketId) {
  try {
    const res = await _apiFetch(`/v1/support/${ticketId}`);
    return _mapTicketFromApi(res?.ticket ?? res);
  } catch {
    return _readTickets().find(t => t.id === ticketId) ?? null;
  }
}

export async function updateTicketStatus(ticketId, patch) {
  try {
    const res = await _apiFetch(`/v1/support/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return _mapTicketFromApi(res?.ticket ?? res);
  } catch {
    const list = _readTickets();
    const idx  = list.findIndex(t => t.id === ticketId);
    if (idx === -1) throw new Error('Chamado não encontrado');
    list[idx] = { ...list[idx], ...patch, updatedAt: _now() };
    _writeTickets(list);
    return list[idx];
  }
}

/* ─── Replies / Messages ─────────────────────────────────────────────────── */

export async function listReplies(ticketId) {
  try {
    const ticket = await getTicket(ticketId);
    return asArray(ticket?.replies ?? ticket?.messages ?? []);
  } catch {
    return _readReplies().filter(r => r.ticketId === ticketId);
  }
}

export async function addReply(ticketId, data) {
  const payload = { body: String(data.message || '').trim() };

  try {
    const res = await _apiFetch(`/v1/support/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const msg = res?.message ?? res;
    return {
      id:         msg.id,
      ticketId,
      message:    msg.body || payload.body,
      authorId:   msg.authorId,
      authorName: msg.authorName || data.authorName || 'Você',
      isStaff:    msg.authorType === 'platform',
      createdAt:  msg.createdAt || _now(),
    };
  } catch {
    const reply = {
      id:         _uid(),
      ticketId,
      message:    payload.body,
      authorId:   data.authorId || null,
      authorName: data.authorName || null,
      isStaff:    Boolean(data.isStaff),
      createdAt:  _now(),
    };
    const replies = _readReplies();
    replies.push(reply);
    _writeReplies(replies);
    const tickets = _readTickets();
    const idx = tickets.findIndex(t => t.id === ticketId);
    if (idx !== -1) {
      tickets[idx].status    = data.isStaff ? 'em_atendimento' : 'aguardando';
      tickets[idx].updatedAt = _now();
      _writeTickets(tickets);
    }
    return reply;
  }
}

/* ─── Upload de anexo ────────────────────────────────────────────────────── */

export async function uploadAttachment(ticketId, file) {
  const url = _apiUrl(`/v1/support/${ticketId}/attachments`);
  if (!url) throw new Error('Backend não configurado');

  const token = _token();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/* ─── Estatísticas (kpis) ─────────────────────────────────────────────────── */

export async function getTicketStats(ctx = {}) {
  try {
    const res = await _apiFetch('/v1/support');
    if (res && typeof res === 'object') {
      const items = asArray(res?.items ?? []);
      return {
        total:      res.total ?? items.length,
        open:       items.filter(t => ['aberto','open'].includes(t.status)).length,
        inProgress: items.filter(t => ['em_atendimento','in_analysis','in_development'].includes(t.status)).length,
        resolved:   items.filter(t => ['resolvido','resolved'].includes(t.status)).length,
        closed:     items.filter(t => ['fechado','closed'].includes(t.status)).length,
      };
    }
    throw new Error('invalid');
  } catch {
    const tickets = await listTickets(ctx);
    return {
      total:      tickets.length,
      open:       tickets.filter(t => t.status === 'aberto').length,
      inProgress: tickets.filter(t => t.status === 'em_atendimento').length,
      resolved:   tickets.filter(t => t.status === 'resolvido').length,
      closed:     tickets.filter(t => t.status === 'fechado').length,
    };
  }
}

/* ─── Categorias ──────────────────────────────────────────────────────────── */

export const TICKET_CATEGORIES = [
  { value: 'pdv',          label: 'PDV / Caixa' },
  { value: 'estoque',      label: 'Estoque' },
  { value: 'produtos',     label: 'Produtos' },
  { value: 'financeiro',   label: 'Financeiro' },
  { value: 'pagamento',    label: 'Cobrança / Planos' },
  { value: 'integracao',   label: 'Integração / API' },
  { value: 'configuracao', label: 'Configurações' },
  { value: 'impressao',    label: 'Impressão / Hardware' },
  { value: 'login',        label: 'Login / Acesso' },
  { value: 'duvida',       label: 'Dúvida geral' },
  { value: 'bug',          label: 'Bug / Erro' },
  { value: 'sugestao',     label: 'Sugestão' },
  { value: 'outro',        label: 'Outro' },
];

export const TICKET_PRIORITIES = [
  { value: 'low',      label: 'Baixa' },
  { value: 'medium',   label: 'Normal' },
  { value: 'high',     label: 'Alta' },
  { value: 'critical', label: 'Urgente' },
];

export const TICKET_STATUSES = [
  { value: 'aberto',          label: 'Aberto',          cssClass: 'status-open' },
  { value: 'em_atendimento',  label: 'Em atendimento',  cssClass: 'status-progress' },
  { value: 'aguardando',      label: 'Aguardando',      cssClass: 'status-waiting' },
  { value: 'resolvido',       label: 'Resolvido',       cssClass: 'status-resolved' },
  { value: 'fechado',         label: 'Fechado',         cssClass: 'status-closed' },
];
