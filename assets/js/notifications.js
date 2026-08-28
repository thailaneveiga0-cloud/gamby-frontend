import {
  listNotificationsService,
  markNotificationReadService,
  markAllNotificationsReadService,
} from './services/notifications-service.js';
import { isBackendReady } from './backend-config.js';

// Duplicado (não importado de um módulo compartilhado) de propósito — mesmo
// padrão já usado em products.js/pdv.js/cash-session.js/ui.js neste projeto.
function showToast(message, type = 'success') {
  if (!message) return;

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

let _pollTimer = null;
const POLL_INTERVAL_MS = 60_000; // 1 minuto

// _baselineSet (não _lastSeenCreatedAt === null) marca "ainda não sabemos a
// baseline desta sessão" — só dispara toast pra notificação criada DEPOIS da
// primeira checagem, senão um usuário com várias não lidas acumuladas levaria
// uma enxurrada de toasts só de abrir o sistema. Usar null como sentinela
// tinha um bug: quando items vinha vazio na primeira checagem, a função
// retornava antes de marcar a baseline — a PRIMEIRA notificação real que
// chegasse depois caía de novo no ramo "ainda não sei a baseline" e virava
// baseline sem toast, silenciando exatamente o caso "conta zerada, primeira
// notificação nova".
let _lastSeenCreatedAt = null;
let _baselineSet = false;

export function startNotificationPolling() {
  if (_pollTimer) return;
  _lastSeenCreatedAt = null;
  _baselineSet = false;
  _refreshBadge();
  _pollTimer = setInterval(_refreshBadge, POLL_INTERVAL_MS);
}

export function stopNotificationPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _isUserAuthenticated() {
  // Verifica se há sessão válida antes de fazer chamadas autenticadas.
  // Evita 401 no console quando o polling dispara após logout.
  try {
    const raw = localStorage.getItem('gamby_auth_session_modular') ||
                localStorage.getItem('gamby_session') || '{}';
    return Boolean(JSON.parse(raw)?.token);
  } catch {
    return false;
  }
}

async function _refreshBadge() {
  if (!isBackendReady()) return;
  if (!_isUserAuthenticated()) return; // sessão inválida — não chamar endpoint autenticado
  try {
    // unreadOnly + limit pequeno: uma chamada só cobre badge (unreadCount) e
    // toast em tempo real (items mais recentes), em vez de duas.
    const { items, unreadCount } = await listNotificationsService({ unreadOnly: true, limit: 5 });
    _updateBadge(unreadCount);
    _toastNewNotifications(items);
  } catch (_err) { /* silêncio */ }
}

function _toastTypeFor(type) {
  if (type === 'batch_expiry_expired' || type === 'batch_expiry_today' || type === 'batch_shortfall_sale') return 'error';
  return 'warning';
}

// items vem ordenado por createdAt desc (mais novo primeiro) — ver
// listNotifications() no backend.
function _toastNewNotifications(items) {
  if (!Array.isArray(items)) return;

  if (!_baselineSet) {
    _baselineSet = true;
    // null (não o relógio do cliente) quando não há nenhuma não lida ainda —
    // usar new Date() aqui comparava depois contra createdAt do SERVIDOR, e
    // um relógio de cliente adiantado (comum em terminal de PDV ligado por
    // meses) fazia a primeira notificação real cair como "mais antiga que a
    // baseline" e nunca virar toast. null vira "tudo que chegar é novo".
    _lastSeenCreatedAt = items[0]?.createdAt ?? null;
    return;
  }
  if (!items.length) return;

  const newest = _lastSeenCreatedAt === null
    ? items
    : items.filter((n) => new Date(n.createdAt) > new Date(_lastSeenCreatedAt));
  if (!newest.length) return;

  _lastSeenCreatedAt = items[0].createdAt;

  // No máximo 3 toasts de uma vez (ex.: o job de validade rodou e gerou
  // vários lotes de uma só vez) — o resto vira um resumo, pra não empilhar
  // a tela de toasts.
  newest.slice(0, 3).forEach((n) => showToast(n.title, _toastTypeFor(n.type)));
  if (newest.length > 3) {
    showToast(`+${newest.length - 3} outra(s) notificação(ões) nova(s)`, 'warning');
  }
}

function _updateBadge(count) {
  const n = Number(count) || 0;
  const topBadge = document.getElementById('notifBadgeCount');
  if (topBadge) {
    topBadge.textContent = n > 99 ? '99+' : String(n);
    topBadge.classList.toggle('hidden', n === 0);
  }
  const panelBadge = document.getElementById('notifPanelBadge');
  if (panelBadge) panelBadge.textContent = String(n);
  const panelSub = document.getElementById('notifPanelSub');
  if (panelSub) {
    panelSub.textContent = n === 0
      ? 'Nenhuma atualização pendente'
      : `Você possui ${n} atualização${n === 1 ? '' : 'ões'} pendente${n === 1 ? '' : 's'}`;
  }
}

// Ícone/cor por tipo — hoje só notificações de validade de lote (Parte B do
// round de Controle de Validade) usam este canal; outros tipos (ex.:
// admin-movements) caem no ícone genérico.
const _ALERT_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const _BELL_ICON  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

const _TYPE_STYLE = {
  batch_expiry_d30:     { dot: 'blue',   badge: 'badge-informativo', label: 'Informativo', icon: _ALERT_ICON, color: '#60a5fa' },
  batch_expiry_d15:     { dot: 'yellow', badge: 'badge-importante',  label: 'Importante',   icon: _ALERT_ICON, color: '#f59e0b' },
  batch_expiry_d7:      { dot: 'orange', badge: 'badge-importante',  label: 'Importante',   icon: _ALERT_ICON, color: '#f97316' },
  batch_expiry_today:   { dot: 'red',    badge: 'badge-critico',     label: 'Crítico',      icon: _ALERT_ICON, color: '#ef4444' },
  batch_expiry_expired: { dot: 'red',    badge: 'badge-critico',     label: 'Crítico',      icon: _ALERT_ICON, color: '#ef4444' },
  batch_shortfall_sale: { dot: 'red',    badge: 'badge-critico',     label: 'Crítico',      icon: _ALERT_ICON, color: '#ef4444' },
};
const _DEFAULT_STYLE = { dot: 'blue', badge: 'badge-informativo', label: 'Informativo', icon: _BELL_ICON, color: '#60a5fa' };

function _isBatchRelated(type) {
  return String(type || '').startsWith('batch_expiry_') || type === 'batch_shortfall_sale';
}

function _renderItem(n) {
  const style = _TYPE_STYLE[n.type] || _DEFAULT_STYLE;
  const isExpiry = _isBatchRelated(n.type);
  const readClass = n.isRead ? 'notif-read' : 'notif-unread';

  return `
    <div class="notif-item ${readClass}" data-notif-id="${_esc(n.id)}" data-notif-type="${_esc(n.type)}" data-batch-id="${_esc(n.metadata?.batchId || '')}">
      <div class="notif-dot ${style.dot}"></div>
      <div class="notif-ico-wrap" style="background:${style.color}22;color:${style.color}">${style.icon}</div>
      <div class="notif-body">
        <div class="notif-title-row"><strong>${_esc(n.title)}</strong><span class="severity-badge ${style.badge}">${style.label}</span></div>
        <p>${_esc(n.body)}</p>
      </div>
      <div class="notif-meta">
        <span class="notif-time">${_relTime(n.createdAt)}</span>
        ${isExpiry ? '<button class="notif-action-btn" type="button" data-notif-goto="estoque">Ver lote</button>' : ''}
        ${n.isRead ? '<div class="notif-read-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>' : ''}
      </div>
    </div>
  `;
}

export async function loadAndRenderNotificationPanel() {
  if (!isBackendReady()) return;
  const panelList = document.getElementById('notifUnreadList');
  if (!panelList) return;
  panelList.innerHTML = '<p class="notif-loading">Carregando...</p>';
  try {
    const { items, unreadCount } = await listNotificationsService({ limit: 30 });
    _updateBadge(unreadCount);

    if (!items?.length) {
      panelList.innerHTML = '<p class="notif-empty">Nenhuma notificação.</p>';
      return;
    }

    panelList.innerHTML = items.map(_renderItem).join('');

    // Marcar como lida ao clicar; notificações de validade de lote também
    // levam direto para o painel "Controle de validade" em Estoque.
    panelList.querySelectorAll('.notif-item').forEach((el) => {
      el.addEventListener('click', async (event) => {
        const id = el.dataset.notifId;
        if (id && el.classList.contains('notif-unread')) {
          el.classList.remove('notif-unread');
          el.classList.add('notif-read');
          await markNotificationReadService(id).catch(() => null);
          _refreshBadge();
        }
        if (event.target.closest('[data-notif-goto]') || _isBatchRelated(el.dataset.notifType)) {
          if (el.dataset.batchId) window.__pendingExpiryHighlightBatchId = el.dataset.batchId;
          window.openPageDirect?.('estoque');
        }
      });
    });
  } catch (_err) {
    panelList.innerHTML = '<p class="notif-error">Erro ao carregar notificações.</p>';
  }
}

/**
 * Liga o clique no sino do topbar para abrir/fechar o painel de
 * notificações e carregar os dados reais — o painel existe no HTML desde
 * sempre, mas nunca teve handler nenhum (bug pré-existente, não introduzido
 * aqui: o sino nunca abria nada).
 */
let _bellBound = false;

export function bindNotificationBell() {
  if (_bellBound) return; // refreshProtectedAreas() pode rodar mais de uma
                           // vez no boot — sem essa guarda, dois listeners
                           // no mesmo clique abrem e fecham o painel no
                           // mesmo evento (o segundo lê o hidden já alterado
                           // pelo primeiro e reverte).
  const btn   = document.getElementById('notifBellBtn');
  const panel = document.getElementById('notifPanel');
  if (!btn || !panel) return;
  _bellBound = true;

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    if (willOpen) loadAndRenderNotificationPanel();
  });

  document.addEventListener('click', (event) => {
    if (panel.classList.contains('hidden')) return;
    if (panel.contains(event.target) || btn.contains(event.target)) return;
    panel.classList.add('hidden');
  });

  document.getElementById('notifMarkAllRead')?.addEventListener('click', async () => {
    await markAllRead();
    loadAndRenderNotificationPanel();
  });
}

export async function markAllRead() {
  await markAllNotificationsReadService().catch(() => null);
  _updateBadge(0);
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _relTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(dateStr).toLocaleDateString('pt-BR');
}
