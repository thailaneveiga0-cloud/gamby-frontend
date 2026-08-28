import { state } from './state.js';

function _esc(v) {
  return String(v || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Resolves a user's photoUrl from state.internalUsers.
 * Accepts: user id, name, or email (string). Returns null if not found.
 */
export function getUserAvatar(lookup) {
  if (!lookup) return null;
  const needle = String(lookup).trim().toLowerCase();
  const users = Array.isArray(state?.internalUsers) ? state.internalUsers : [];
  const found = users.find(
    (u) =>
      String(u.id || '').toLowerCase() === needle ||
      String(u.name || '').trim().toLowerCase() === needle ||
      String(u.email || '').trim().toLowerCase() === needle
  );
  return found?.photoUrl || null;
}

const _SIZE_MAP = { sm: 'av-sm', md: 'av-md', lg: 'av-lg' };

/**
 * Returns an avatar HTML string.
 * userOrName: full user object (uses .photoUrl + .role) or string name (looked up).
 * opts.cls     — base CSS class (default 'uc-av')
 * opts.role    — role class override
 * opts.size    — 'sm' | 'md' | 'lg' — appends av-sm/av-md/av-lg modifier class
 * opts.style   — extra inline style on the wrapper
 * opts.title   — tooltip text (defaults to name)
 */
export function renderUserAvatar(userOrName, opts = {}) {
  const { cls = 'uc-av', role = '', size = '', style = '', title = '' } = opts;

  const user    = typeof userOrName === 'object' && userOrName !== null ? userOrName : null;
  const name    = user ? (user.name || user.email || '?') : String(userOrName || '?');
  const photo   = user?.photoUrl || getUserAvatar(name);
  const initial = (name[0] || '?').toUpperCase();
  const roleKey = role || (user?.role || '');
  const sizeKey = _SIZE_MAP[size] || '';
  const tip     = _esc(title || name);
  const classes = [cls, sizeKey, roleKey].filter(Boolean).join(' ');

  if (photo) {
    return `<div class="${classes} has-photo" title="${tip}"><img src="${_esc(photo)}" alt="${tip}" class="uc-av-img" /></div>`;
  }
  return `<div class="${classes}" title="${tip}">${initial}</div>`;
}

// Expose globally so PDV, dashboard, reports can call without ES-module import
if (typeof window !== 'undefined') {
  window.getUserAvatar    = getUserAvatar;
  window.renderUserAvatar = renderUserAvatar;
}
