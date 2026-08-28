/**
 * gov-session.js — GAMBY PDV Governance Layer: Session Manager
 *
 * Single source of truth for operational state: cash, operator, PDV mode, auth flags.
 *
 * Pattern: wraps existing state.* (bidirectional sync).
 * Does NOT replace state.* during migration — derives from it on every read.
 *
 * Consumers call getState() for a readonly snapshot and dispatch() for transitions.
 * Legacy code that mutates state.* directly should call sync() afterward.
 */

import { state } from './state.js';

// ─── Types ────────────────────────────────────────────────────────────────────
//
// OperationalState {
//   cashState:            'closed' | 'open' | 'closing'
//   cashSession:          object | null
//   operatorState:        'none' | 'identified' | 'authenticated'
//   currentOperator:      object | null
//   pdvMode:              'simplified' | 'controlled'
//   kioskActive:          boolean
//   adminAuthorized:      boolean
//   operatorPinValidated: boolean
//   currentUser:          object | null
//   userRole:             string
// }

// ─── Derived state ────────────────────────────────────────────────────────────

function _pdvMode() {
  // Primary: live state; fallback: localStorage cache (avoids race on boot)
  let mode = state.pdvSettings?.pdvMode;
  if (!mode) {
    try { mode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}').pdvMode; } catch {}
  }
  return mode === 'controlled' ? 'controlled' : 'simplified';
}

function _derive() {
  const mode       = _pdvMode();
  const cashOpen   = Boolean(state.cashSession?.isOpen);
  const opAuth     = Boolean(state.operatorPinValidated) || Boolean(state.currentOperator?.name);
  const controlled = mode === 'controlled';

  // Kiosk active when the real kiosk lock (window.__pdvKioskActive, set by
  // enforcePDVKioskMode()/cleared by releasePDVKioskMode() in pdv-kiosk.js)
  // is actually engaged AND cash is open AND:
  //   controlled mode → operator must also be authenticated
  //   simplified mode → no extra requirement
  //
  // BUG CONFIRMADO: antes dependia SÓ de cashOpen (+ opAuth), sem checar o
  // estado real do kiosk. Qualquer Administrador navegando pelo menu com o
  // caixa aberto (situação normal do dia a dia) era tratado como "em kiosk"
  // por gov-nav.js:navigate() (passo 3), pedindo senha admin (forceAuth,
  // sem cache TTL) a CADA clique de nav-btn — mesmo já tendo saído do PDV.
  // window.__pdvKioskActive só é true enquanto o kiosk está de fato
  // aplicado (DOM/CSS), então esta checagem só ESTREITA os casos em que
  // kioskActive era true antes, nunca amplia — seguro para os outros
  // consumidores desta função.
  const kioskActive = Boolean(window.__pdvKioskActive) && cashOpen && (controlled ? opAuth : true);

  return {
    cashState:            cashOpen ? 'open' : 'closed',
    cashSession:          state.cashSession ?? null,
    operatorState:        opAuth ? 'authenticated' : 'none',
    currentOperator:      state.currentOperator ?? null,
    pdvMode:              mode,
    kioskActive,
    adminAuthorized:      Boolean(state.adminCashOpenAuthorized),
    operatorPinValidated: Boolean(state.operatorPinValidated),
    currentUser:          state.currentUser ?? null,
    userRole:             String(state.currentUser?.role ?? 'operador'),
  };
}

// ─── Listener registry ────────────────────────────────────────────────────────

let _listeners = [];

function _notify(action, prev) {
  const next = _derive();
  _listeners.forEach(fn => {
    try { fn(next, prev, action); } catch {}
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns an immutable snapshot of current operational state.
 * Always derives fresh from state.* to stay in sync with legacy mutations.
 */
export function getState() {
  return Object.freeze(_derive());
}

/**
 * Subscribe to state changes.
 * @param {(next, prev, action) => void} listener
 * @returns {() => void} unsubscribe function
 */
export function subscribe(listener) {
  _listeners.push(listener);
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

/**
 * Dispatch a state transition action.
 * Actions sync the underlying state.* object and emit gamby:session-changed.
 *
 * @param {{ type: string, payload?: unknown }} action
 */
export function dispatch(action) {
  const prev = _derive();

  switch (action.type) {

    case 'CASH_OPENED': {
      if (!state.cashSession) state.cashSession = {};
      Object.assign(state.cashSession, { isOpen: true }, action.payload ?? {});
      break;
    }

    case 'CASH_CLOSED': {
      if (state.cashSession) state.cashSession.isOpen = false;
      state.adminCashOpenAuthorized = false;
      state.operatorPinValidated    = false;
      state.currentOperator         = null;
      break;
    }

    case 'OP_IDENTIFIED': {
      state.currentOperator      = action.payload ?? null;
      state.operatorPinValidated = true;
      break;
    }

    case 'OP_CLEARED': {
      state.currentOperator      = null;
      state.operatorPinValidated = false;
      break;
    }

    case 'ADMIN_AUTHORIZED': {
      state.adminCashOpenAuthorized = true;
      break;
    }

    case 'ADMIN_AUTH_CLEARED': {
      state.adminCashOpenAuthorized = false;
      break;
    }

    case 'MODE_SET': {
      if (!state.pdvSettings) state.pdvSettings = {};
      state.pdvSettings.pdvMode = action.payload === 'controlled' ? 'controlled' : 'simplified';
      break;
    }

    case 'LOGOUT': {
      state.adminCashOpenAuthorized = false;
      state.operatorPinValidated    = false;
      state.currentOperator         = null;
      if (state.cashSession) state.cashSession.isOpen = false;
      break;
    }

    case 'SYNC':
      // Just re-derive — no state.* mutation needed
      break;

    default:
      // Unknown action — log and skip
      console.warn('[gov-session] Unknown action:', action.type);
      return;
  }

  const next = _derive();

  document.dispatchEvent(new CustomEvent('gamby:session-changed', {
    detail: { prev, next, action },
    bubbles: false,
  }));

  _notify(action, prev);
}

/**
 * Re-sync after legacy code mutates state.* directly.
 * Emits gamby:session-changed with the new derived state.
 */
export function sync() {
  dispatch({ type: 'SYNC' });
}

// ─── Convenience getters ──────────────────────────────────────────────────────

export function isKioskActive() {
  return _derive().kioskActive;
}

export function getPdvMode() {
  return _derive().pdvMode;
}

export function isCashOpen() {
  return _derive().cashState === 'open';
}
