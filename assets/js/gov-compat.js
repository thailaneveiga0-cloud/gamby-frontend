/**
 * gov-compat.js — GAMBY PDV Governance Compatibility Layer
 *
 * Bridges legacy `window.openPageDirect` / `window.openSecureCashCloseModal` calls
 * to the Governance Layer (gov-nav.js / gov-auth.js).
 *
 * Called twice by app.js:
 *   Pass 1 (~line 403): before openPageDirect is defined — patches modal only
 *   Pass 2 (~line 3007): after openPageDirect is defined — saves original,
 *                         installs govCompat_wrapper, adds listeners
 *
 * Three independent flags ensure each block runs exactly once and at the right time.
 * This eliminates the circular loop that was caused by the single _initialized flag
 * which prevented pass 2 from saving window.__gov.openPageDirect.
 */

import { navigate as _govNavigate }              from './gov-nav.js';
import { challenge as _govChallenge }             from './gov-auth.js';
import { canNavigate as _govCanNavigate,
         applyVisibility as _govApplyVisibility,
         getCurrentRole }                         from './gov-access.js';
import { sync as _govSync, getState as _govGetState } from './gov-session.js';
import { log as _govLog, getLogs as _govGetLogs } from './gov-audit.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _modalPatched    = false; // openSecureCashCloseModal already wrapped
let _navPatched      = false; // openPageDirect: original saved + wrapper installed
let _listenersAdded  = false; // DOM event listeners added

// ─── Public: init ─────────────────────────────────────────────────────────────

export function initGovCompat() {
  window.__gov = window.__gov || {};

  // ── Modal patch ─────────────────────────────────────────────────────────────
  // Runs in pass 1 — openSecureCashCloseModal is already defined at this point.
  if (!_modalPatched && typeof window.openSecureCashCloseModal === 'function') {
    window.__gov.openSecureCashCloseModal = window.openSecureCashCloseModal;
    if (window.closeSecureCashCloseModal) {
      window.__gov.closeSecureCashCloseModal = window.closeSecureCashCloseModal;
    }

    window.openSecureCashCloseModal = function govCompat_openSecureCashCloseModal(onSuccess, opts = {}) {
      _govChallenge('admin-password', {
        forceAuth:  opts.forceAuth ?? true,
        onCancel:   opts.onCancel  ?? null,
        // BUG CONFIRMADO: actionType nunca era repassado adiante — toda
        // chamada que passava por este wrapper (qualquer uso de
        // requirePDVAdminAuthorization) chegava ao backend/validateCashClosurePassword
        // como o rótulo genérico 'pdv_action' (default de openSecureCashCloseModal
        // real, em app.js), nunca com o actionType real pedido pelo chamador.
        // Isso não mudava comportamento para os actionTypes já existentes
        // ('open-cash', 'close-cash', 'reopen-cash', 'navigate-dashboard',
        // 'switch-operator', 'cancel-sale' — todos já dentro de
        // PDV_ACTION_TYPES no backend, igual a 'pdv_action'), mas fazia
        // 'confirm-admin-profile' (2ª senha da seleção de perfil Administrador)
        // ser tratado como ação de PDV — que aceita Gerente — em vez de
        // ação exclusiva de Administrador.
        actionType: opts.actionType,
        context:    'legacy-compat',
      }).then(result => {
        // DEBUG TEMPORÁRIO — remover após confirmar a causa do BUG "modal de
        // valor inicial não aparece".
        console.log('[CASH-OPEN-DEBUG] govCompat_openSecureCashCloseModal resolveu', result);
        if (result.success) {
          if (typeof onSuccess === 'function') onSuccess();
        } else {
          if (typeof opts.onCancel === 'function') opts.onCancel();
        }
      });
    };

    _modalPatched = true;
  }

  // ── Nav patch ────────────────────────────────────────────────────────────────
  // Skipped in pass 1 because openPageDirect is not yet defined.
  // Runs in pass 2 after app.js line ~3001 assigns window.openPageDirect.
  // runtime-guard skips locking openPageDirect in pass 1 (it is undefined then),
  // so pass 2 can freely replace it with the wrapper.
  if (!_navPatched && typeof window.openPageDirect === 'function') {
    window.__gov.openPageDirect = window.openPageDirect; // save real implementation

    window.openPageDirect = function govCompat_openPageDirect(page) {
      _govNavigate(String(page || '').trim().toLowerCase(), {
        source:                'legacy-compat',
        bypassKiosk:           true,
        skipSecurityChallenge: true,
      });
    };

    _navPatched = true;
  }

  // ── Event listeners ─────────────────────────────────────────────────────────
  if (!_listenersAdded) {
    document.addEventListener('gamby:cash-opened', () => _govSync(), { passive: true });
    document.addEventListener('gamby:cash-closed',  () => _govSync(), { passive: true });
    _listenersAdded = true;
  }

  // ── Public namespace ─────────────────────────────────────────────────────────
  window.gov = {
    navigate:        (page, opts) => _govNavigate(String(page || ''), opts),
    challenge:       (type, opts) => _govChallenge(type, opts),
    canNavigate:     (page)       => _govCanNavigate(page),
    applyVisibility: ()           => _govApplyVisibility(),
    getState:        ()           => _govGetState(),
    getLogs:         (limit = 50) => _govGetLogs(limit),
    sync:            ()           => _govSync(),
    get role()   { return getCurrentRole(); },
    get __orig() { return window.__gov; },
  };
}
