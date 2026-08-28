/**
 * gov-nav.js — GAMBY PDV Governance Layer: Navigation Engine
 *
 * Single entry point for ALL page changes in the SPA.
 *
 * Flow per navigate(page) call:
 *   1. Validate: authenticated?
 *   2. Validate: canNavigate (role + plan)?
 *   3. Kiosk guard: if kiosk active and going outside PDV → require admin auth
 *   4. Security challenge: if page requires challenge (financeiro, usuarios, …)
 *   5. DOM: openPageDirect(page) — the only caller of this function
 *   6. Audit: log navigation event
 *   7. Event: dispatch gamby:page-changed
 *
 * Replaces:
 *   - requestProtectedPageNavigation (app.js)  → now delegates here
 *   - repairBlankSpaPage (app.js)               → uses navigate with source:'repair'
 *   - kiosk guard nav listener (pdv.js)         → check is inside this engine
 */

import { canNavigate, requiresChallenge, getDefaultPage, getCurrentRole, ROLES } from './gov-access.js';
import { challenge, clearAll as clearAuthAll }                                    from './gov-auth.js';
import { log }                                                                     from './gov-audit.js';
import { getState }                                                                from './gov-session.js';

// ─── Navigate options ─────────────────────────────────────────────────────────
//
// NavigateOptions {
//   source?:               'user-click' | 'system' | 'repair' | 'login'
//   skipSecurityChallenge?: boolean
//   bypassKiosk?:           boolean   // used by openPDVExitOptions after user confirms
//   auditContext?:          object
// }

// ─── In-flight guard ─────────────────────────────────────────────────────────

let _navigating = false;
let _currentPage = '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _norm(v) { return String(v ?? '').trim().toLowerCase(); }

function _currentUser() {
  // Reads from window.state via gov-session's _derive; avoids circular import
  return window.__govStateRef?.currentUser ?? null;
}

function _isAuthenticated() {
  // Delegate to whatever app.js exposes; fallback to checking currentUser
  if (typeof window.isAuthenticated === 'function') return window.isAuthenticated();
  return Boolean(_currentUser());
}

function _openPageDirect(page) {
  const fnGov  = window.__gov?.openPageDirect;
  const fnWin  = window.openPageDirect;
  const chosen = fnGov ?? fnWin; // prefer saved real impl; fall back to window binding

  console.log('[KIOSK-DEBUG] _openPageDirect()', { page, hasFnGov: typeof fnGov === 'function', hasFnWin: typeof fnWin === 'function' });

  if (typeof chosen === 'function') {
    chosen(page);
    return;
  }
  console.error('[gov-nav] openPageDirect not available yet');
}

function _showToast(msg, type = 'warning') {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.warn('[gov-nav]', msg);
}

function _getCurrentPage() {
  return localStorage.getItem('gamby_current_page') || _currentPage || '';
}

// ─── Public: navigate ─────────────────────────────────────────────────────────

/**
 * Navigate to a page.
 *
 * @param {string} page
 * @param {NavigateOptions} [opts]
 * @returns {Promise<boolean>} true if navigation proceeded
 */
export async function navigate(page, opts = {}) {
  const target = _norm(page);
  console.log('[KIOSK-DEBUG] gov-nav.navigate() chamado', { page: target, opts, pdvKioskActive: window.__pdvKioskActive });
  if (!target) return false;

  // ── 0. PDV Kiosk guard ────────────────────────────────────────────────────
  // Enquanto o PDV estiver ativo, nenhuma navegação administrativa é permitida.
  // A saída do PDV acontece exclusivamente via openPDVExitOptions() com senha admin.
  if (target !== 'pdv' && window.__pdvKioskActive) {
    console.log('[KIOSK-DEBUG] navigate() bloqueado por PDV Kiosk guard (passo 0)');
    log({ category: 'navigation', action: 'navigate.blocked.pdv-kiosk', outcome: 'denied',
          context: { to: target, source: opts.source } });
    return false;
  }

  // ── 1. Authentication ──────────────────────────────────────────────────────
  if (!_isAuthenticated()) {
    console.log('[KIOSK-DEBUG] navigate() bloqueado — não autenticado (passo 1)');
    log({ category: 'navigation', action: 'navigate.blocked.unauthenticated', outcome: 'denied',
          context: { to: target, ...opts.auditContext } });
    return false;
  }

  // ── 2. Permission (role + plan) ────────────────────────────────────────────
  if (!canNavigate(target)) {
    console.log('[KIOSK-DEBUG] navigate() bloqueado — canNavigate() false (passo 2) | role:', getCurrentRole());
    _showToast('Acesso restrito para este perfil ou plano.', 'warning');
    log({ category: 'navigation', action: 'navigate.blocked.permission', outcome: 'denied',
          context: { to: target, role: getCurrentRole(), ...opts.auditContext } });
    return false;
  }

  const from = _getCurrentPage();

  // ── 3. Kiosk guard ────────────────────────────────────────────────────────
  const session = getState();
  if (session.kioskActive && target !== 'pdv' && !opts.bypassKiosk) {
    const role = getCurrentRole();

    // Operators can never leave PDV while kiosk is active
    if (role === ROLES.OPERATOR) {
      _showToast('Operadores não possuem acesso ao sistema administrativo.', 'warning');
      log({ category: 'navigation', action: 'navigate.kiosk.operator-blocked', outcome: 'denied',
            context: { to: target, from } });
      return false;
    }

    // Admin/gerente/dev: require admin password to exit kiosk
    log({ category: 'security', action: 'challenge.admin-password.kiosk-nav-requested',
          context: { to: target, from } });
    const result = await challenge('admin-password', {
      forceAuth: true,
      context:   'kiosk-navigation',
    });

    if (!result.success) {
      log({ category: 'navigation', action: 'navigate.kiosk.auth-denied', outcome: 'cancelled',
            context: { to: target, from } });
      return false;
    }

    // Kiosk guard passed — remove PDV-only styling before transition
    document.body.classList.remove('pdv-only-mode');
    document.querySelector('.app-shell')?.classList.remove('pdv-fullscreen');
  }

  // ── 4. Security challenge (sensitive pages) ────────────────────────────────
  const challengeType = requiresChallenge(target);
  if (challengeType && !opts.skipSecurityChallenge) {
    const result = await challenge(challengeType, { page: target, context: 'page-access' });
    if (!result.success) {
      log({ category: 'navigation', action: 'navigate.challenge.failed', outcome: 'cancelled',
            context: { to: target, from, challengeType } });
      return false;
    }
  }

  // ── 5. Prevent re-entrant navigation ──────────────────────────────────────
  if (_navigating) {
    console.log('[KIOSK-DEBUG] navigate() bloqueado — _navigating já true (passo 5, reentrância)');
    return false;
  }
  _navigating = true;

  try {
    // ── 6. DOM transition ────────────────────────────────────────────────────
    console.log('[KIOSK-DEBUG] navigate() chegou ao passo 6 — chamando _openPageDirect(', target, ')');
    _openPageDirect(target);
    _currentPage = target;

    // ── 7. Audit ─────────────────────────────────────────────────────────────
    log({
      category: 'navigation',
      action:   'navigate.success',
      context:  { from, to: target, source: opts.source ?? 'unknown', ...opts.auditContext },
    });

    // ── 8. Event ─────────────────────────────────────────────────────────────
    document.dispatchEvent(new CustomEvent('gamby:page-changed', {
      detail:  { page: target, from, source: opts.source },
      bubbles: false,
    }));

    return true;
  } finally {
    _navigating = false;
  }
}

// ─── Public: repair ───────────────────────────────────────────────────────────

/**
 * Repair blank SPA page by navigating to the last known / default page.
 * Used by the SPA watchdog (replaces repairBlankSpaPage in app.js).
 *
 * @param {string} [reason] Diagnostic label
 */
export async function repair(reason = 'unknown') {
  if (!_isAuthenticated()) return;

  const pages = [...document.querySelectorAll('[data-page-content]')];
  if (!pages.length) return;

  const hasActive = pages.some(
    p => p.classList.contains('active') && !p.classList.contains('hidden')
  );
  if (hasActive) return;

  let target =
    localStorage.getItem('gamby_current_page') ||
    localStorage.getItem('gamby_last_page')    ||
    getDefaultPage();

  // Guard: never auto-restore PDV — PDV entry always requires admin password via openPDVExitOptions
  if (target === 'pdv') {
    target = getDefaultPage();
  }

  // Guard: never auto-restore control-center for non-platform_admin
  if (target === 'control-center' && getCurrentRole() !== ROLES.PLATFORM_ADMIN) {
    target = getDefaultPage();
  }

  // Guard: never auto-restore a page the user can no longer access
  if (!canNavigate(target)) {
    target = getDefaultPage();
  }

  log({
    category: 'system',
    action:   'spa.repair',
    context:  { reason, target },
  });

  // Repair uses openPageDirect directly to avoid triggering security challenges
  _openPageDirect(target);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Clear auth state on logout.
 */
export function onLogout() {
  clearAuthAll();
  _currentPage = '';
}
