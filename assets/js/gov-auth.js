/**
 * gov-auth.js — GAMBY PDV Governance Layer: Security Orchestrator
 *
 * All security challenges flow through a single function: challenge().
 * Guarantees:
 *   - One modal at a time (mutex per type)
 *   - State always cleaned up on any exit (success / cancel / ESC / error)
 *   - developer_master and desenvolvedora bypass every challenge
 *   - Temporary page authorization with 5-minute TTL
 *
 * Challenge types:
 *   'admin-password'    → Administrative password modal (delegates to openSecureCashCloseModal)
 *   'operator-pin'      → PDV operator PIN (delegates to requirePDVOperatorSession)
 *   'security-question' → Security question (prompt-based)
 *
 * @returns {Promise<{ success: boolean, cancelledBy?: string }>}
 */

import { log } from './gov-audit.js';
import { getCurrentRole, ROLES } from './gov-access.js';

const _TTL = 5 * 60 * 1000; // 5 minutes

// Active challenge mutex (type → Promise resolve fn)
let _active = null;

// Page-scoped TTL cache: page → expiresAt (ms timestamp)
const _tempAuths = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Request a security challenge.
 *
 * @param {'admin-password'|'operator-pin'|'security-question'} type
 * @param {{ page?: string, context?: string, forceAuth?: boolean }} [opts]
 * @returns {Promise<{ success: boolean, cancelledBy?: string }>}
 */
export function challenge(type, opts = {}) {
  const role = getCurrentRole();

  // Privileged roles bypass non-forced challenges.
  // forceAuth:true é usado por ações críticas do PDV (fechar caixa, abrir, ir para Dashboard)
  // e nunca pode ser bypassado — mesmo para developer_master.
  if ((role === ROLES.DEVELOPER_MASTER || role === ROLES.DEV) && !opts.forceAuth) {
    log({ category: 'security', action: `challenge.${type}.bypass`, context: opts });
    return Promise.resolve({ success: true, cancelledBy: 'bypass' });
  }

  // TTL cache hit: page already authorized within the last 5 minutes
  if (opts.page && !opts.forceAuth) {
    const exp = _tempAuths.get(opts.page);
    if (exp && Date.now() < exp) {
      log({ category: 'security', action: `challenge.${type}.cached`, context: opts });
      return Promise.resolve({ success: true, cancelledBy: 'cached' });
    }
  }

  // Concurrent-challenge guard: silently reject if a challenge is already open
  if (_active) {
    // DEBUG TEMPORÁRIO — remover após confirmar a causa do BUG "modal de valor
    // inicial não aparece". Se este log aparecer no console, um challenge
    // anterior (_active.type) ainda não tinha sido resolvido quando este novo
    // pedido chegou — o novo challenge é rejeitado SEM mostrar nada.
    console.log('[CASH-OPEN-DEBUG] ⚠️ challenge() rejeitado por concurrent-guard — _active:', _active?.type, '| tentando abrir:', type, opts);
    return Promise.resolve({ success: false, cancelledBy: 'concurrent' });
  }

  switch (type) {
    case 'admin-password':    return _adminPasswordChallenge(opts);
    case 'operator-pin':      return _operatorPinChallenge(opts);
    case 'security-question': return _securityQuestionChallenge(opts);
    default:
      log({ category: 'security', action: 'challenge.unknown-type', outcome: 'error', context: { type, ...opts } });
      return Promise.resolve({ success: false, cancelledBy: 'unknown-type' });
  }
}

/** Clear a single page's cached authorization. */
export function clearPageAuth(page) {
  _tempAuths.delete(String(page));
}

/** Clear all temporary authorizations (call on logout / user switch). */
export function clearAll() {
  _tempAuths.clear();
  _active = null;
}

/** Returns true if the page has an active temporary authorization. */
export function isPageAuthorized(page) {
  const exp = _tempAuths.get(String(page));
  return exp != null && Date.now() < exp;
}

// ─── Admin Password ───────────────────────────────────────────────────────────

function _adminPasswordChallenge(opts) {
  return new Promise(resolve => {
    const _modal = window.__gov?.openSecureCashCloseModal ?? window.openSecureCashCloseModal;
    const _govType = typeof window.__gov?.openSecureCashCloseModal;
    const _winType = typeof window.openSecureCashCloseModal;

    console.log('[PDV-AUTH-CHAIN] _adminPasswordChallenge',
      '| __gov:', _govType, '| window:', _winType,
      '| usando:', _govType === 'function' ? '__gov (original)' : (_winType === 'function' ? 'window (wrapper)' : 'NENHUM'),
      '| forceAuth:', opts.forceAuth);

    if (typeof _modal !== 'function') {
      console.error('[PDV-AUTH-CHAIN] ⛔ _modal não é função — challenge abortado');
      log({ category: 'security', action: 'challenge.admin-password.unavailable', outcome: 'error', context: opts });
      resolve({ success: false, cancelledBy: 'no-modal' });
      return;
    }

    // Guard: a Promise só pode ser resolvida uma vez.
    // Sem isso, _onCancel + _onSuccess no mesmo fluxo fazem a primeira resolução vencer.
    let _settled = false;
    function _resolveOnce(result) {
      if (_settled) {
        console.log('[PDV-AUTH-CHAIN] resolveOnce ignored duplicate | resultado ignorado:', result.success ? 'success' : 'cancel');
        return;
      }
      _settled = true;
      console.log('[PDV-AUTH-CHAIN] resolveOnce | success:', result.success, '| cancelledBy:', result.cancelledBy);
      resolve(result);
    }

    _active = { type: 'admin-password', resolve: _resolveOnce };

    const _onSuccess = () => {
      if (opts.page) _tempAuths.set(opts.page, Date.now() + _TTL);
      log({ category: 'security', action: 'challenge.admin-password.success', context: opts });
      _active = null;
      _resolveOnce({ success: true });
    };

    const _onCancel = () => {
      log({ category: 'security', action: 'challenge.admin-password.cancelled', outcome: 'cancelled', context: opts });
      _active = null;
      _resolveOnce({ success: false, cancelledBy: 'user' });
    };

    _modal(_onSuccess, {
      forceAuth:  opts.forceAuth !== false,
      onCancel:   _onCancel,
      actionType: opts.actionType, // ver comentário em gov-compat.js — repassar sem perder o rótulo real
    });
  });
}

// ─── Operator PIN ─────────────────────────────────────────────────────────────

function _operatorPinChallenge(opts) {
  return new Promise(resolve => {
    _active = { type: 'operator-pin', resolve };

    import('./operator-session.js').then(({ requirePDVOperatorSession }) => {
      requirePDVOperatorSession('gov-auth', (operator) => {
        log({ category: 'security', action: 'challenge.operator-pin.success', context: opts });
        _active = null;
        resolve({ success: true, operator });
      }, () => {
        log({ category: 'security', action: 'challenge.operator-pin.cancelled', outcome: 'cancelled', context: opts });
        _active = null;
        resolve({ success: false, cancelledBy: 'user' });
      });
    }).catch(() => {
      _active = null;
      resolve({ success: false, cancelledBy: 'module-error' });
    });
  });
}

// ─── Security Question ────────────────────────────────────────────────────────

function _securityQuestionChallenge(opts) {
  return new Promise(resolve => {
    const storedAnswer = localStorage.getItem('gamby_security_answer') || '';

    // No answer registered → warn but never block
    if (!storedAnswer) {
      document.dispatchEvent(new CustomEvent('gamby:security-no-answer'));
      log({ category: 'security', action: 'challenge.security-question.no-config', context: opts });
      resolve({ success: true, cancelledBy: 'no-config' });
      return;
    }

    // Security question globally disabled
    if (localStorage.getItem('gamby_security_required') === 'false') {
      resolve({ success: true, cancelledBy: 'disabled' });
      return;
    }

    _active = { type: 'security-question', resolve };

    const question =
      localStorage.getItem('gamby_security_question') ||
      'Qual é a resposta de segurança cadastrada pelo administrador?';

    const answer = window.prompt(question);

    if (answer === null) {
      log({ category: 'security', action: 'challenge.security-question.cancelled', outcome: 'cancelled', context: opts });
      _active = null;
      resolve({ success: false, cancelledBy: 'user' });
      return;
    }

    const norm = s => String(s || '').trim().toLowerCase();
    const ok   = norm(answer) === norm(storedAnswer);

    if (ok) {
      if (opts.page) _tempAuths.set(opts.page, Date.now() + _TTL);
      log({ category: 'security', action: 'challenge.security-question.success', context: opts });
      _active = null;
      resolve({ success: true });
    } else {
      alert('Resposta de segurança incorreta.');
      log({ category: 'security', action: 'challenge.security-question.failed', outcome: 'denied', context: opts });
      _active = null;
      resolve({ success: false, cancelledBy: 'wrong-answer' });
    }
  });
}
