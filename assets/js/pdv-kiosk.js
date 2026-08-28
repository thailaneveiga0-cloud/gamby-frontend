/**
 * pdv-kiosk.js — PDV Kiosk Enforcement Engine
 *
 * Módulo central responsável por todo o estado kiosk do PDV.
 * Todas as ações críticas do PDV passam OBRIGATORIAMENTE por requirePDVAdminAuthorization().
 *
 * API pública (exportada via ES module):
 *   isPDVActive()                                    – detecta se PDV está ativo
 *   enforcePDVKioskMode()                            – ativa todas as restrições kiosk
 *   releasePDVKioskMode()                            – remove restrições ao sair do PDV
 *   requirePDVAdminAuthorization(action, ok, cancel) – gate obrigatório para ações críticas
 *
 * API global (window.*) — para uso em cash-session.js e outros módulos sem import:
 *   window.requirePDVAdminAuthorization              – alias global da função acima
 *   window.releasePDVKioskMode                       – alias global da função acima
 *   window.__pdvKioskActive                          – flag booleana (lida por gov-nav.js)
 *   window.__pdvCashCloseAuthorized                  – flag one-time para closeCashSession()
 */

import { destroyAiWidget, initAiWidget } from './ai-widget.js';
import { log } from './gov-audit.js';

// ─── Estado interno ───────────────────────────────────────────────────────────

let _active = false;

// ─── isPDVActive ──────────────────────────────────────────────────────────────

/**
 * Detecta se o PDV está ativo de forma confiável.
 * Combina flag interna, localStorage e DOM para cobrir todos os casos.
 */
export function isPDVActive() {
  if (_active) return true;
  if (localStorage.getItem('gamby_current_page') === 'pdv') return true;
  return !!document.querySelector('[data-page-content="pdv"].active:not(.hidden)');
}

// ─── enforcePDVKioskMode ──────────────────────────────────────────────────────

/**
 * Ativa o modo kiosk: aplica restrições visuais e comportamentais.
 * Idempotente — seguro chamar múltiplas vezes.
 */
export function enforcePDVKioskMode() {
  _active = true;
  window.__pdvKioskActive = true;

  const appShell = document.querySelector('.app-shell');
  document.body.classList.add('pdv-kiosk-active');
  appShell?.classList.add('pdv-fullscreen');

  destroyAiWidget(); // remove Copilot do DOM completamente

  log({ category: 'pdv', action: 'kiosk.enter', outcome: 'ok',
        context: { ts: new Date().toISOString() } });
}

// ─── releasePDVKioskMode ──────────────────────────────────────────────────────

/**
 * Remove todas as restrições kiosk.
 * Chamar SOMENTE após confirmação de senha administrativa via requirePDVAdminAuthorization.
 */
export function releasePDVKioskMode() {
  _active = false;
  window.__pdvKioskActive = false;
  window.__pdvCashCloseAuthorized = false; // limpar token de fechamento ao sair

  const appShell = document.querySelector('.app-shell');
  document.body.classList.remove('pdv-kiosk-active', 'pdv-only-mode');
  appShell?.classList.remove('pdv-fullscreen');

  // Garantia: remover overlay residual "Sair/Sistema" que possa ter ficado preso
  // por qualquer caminho de saída do kiosk (abertura de caixa, acesso autorizado, etc.)
  document.getElementById('pdvExitOptionsOverlay')?.remove();

  initAiWidget(); // recria Copilot ao sair do PDV

  log({ category: 'pdv', action: 'kiosk.exit', outcome: 'ok',
        context: { ts: new Date().toISOString() } });
}

// ─── requirePDVAdminAuthorization ─────────────────────────────────────────────

/**
 * Gate obrigatório para TODAS as ações críticas do PDV.
 * Nunca chamar diretamente openPageDirect / closeCashSession / releasePDVKioskMode
 * sem antes passar por esta função.
 *
 * Ações reconhecidas (gravam flag one-time para guards defensivos):
 *   'open-cash'           → não gera flag extra (entry é validado pelo flow de auth)
 *   'close-cash'          → window.__pdvCashCloseAuthorized = true
 *   'reopen-cash'         → window.__pdvCashCloseAuthorized = true
 *   'navigate-dashboard'  → não gera flag extra (releasePDVKioskMode é chamado no callback)
 *   'switch-operator'     → não gera flag extra
 *   outros                → sem flag extra
 *
 * @param {string}   action   – label de auditoria (ex: 'open-cash', 'navigate-dashboard')
 * @param {Function} onSuccess – callback executado após senha correta
 * @param {Function} [onCancel] – callback executado se usuário cancelar
 */
export function requirePDVAdminAuthorization(action, onSuccess, onCancel = null) {
  console.log(`[PDV-AUTH] action="${action}" | openSecureCashCloseModal disponível:`, typeof window.openSecureCashCloseModal, '| __pdvKioskActive:', window.__pdvKioskActive);
  log({ category: 'pdv', action: `kiosk.auth-requested.${action}`, context: {} });

  if (typeof window.openSecureCashCloseModal !== 'function') {
    console.error('[PDV-KIOSK] openSecureCashCloseModal indisponível — ação bloqueada:', action);
    log({ category: 'pdv', action: `kiosk.auth-unavailable.${action}`, outcome: 'error', context: {} });
    if (typeof onCancel === 'function') onCancel();
    return;
  }

  window.openSecureCashCloseModal(
    async () => {
      console.log(`[PDV-AUTH] auth-success action="${action}" | flag antes:`, window.__pdvCashCloseAuthorized);
      log({ category: 'pdv', action: `kiosk.auth-granted.${action}`, outcome: 'ok', context: {} });

      // Conceder token one-time para ações de caixa (consumido por closeCashSession)
      if (action === 'close-cash' || action === 'reopen-cash') {
        window.__pdvCashCloseAuthorized = true;
        console.log('[PDV-AUTH] __pdvCashCloseAuthorized = true (set para close-cash)');
      }

      if (typeof onSuccess === 'function') await onSuccess();

      // Limpar token após execução (caso não tenha sido consumido internamente)
      if (action === 'close-cash' || action === 'reopen-cash') {
        window.__pdvCashCloseAuthorized = false;
      }
    },
    {
      forceAuth:  true,
      actionType: action, // propagado para validateCashClosurePassword → backend audit log
      onCancel: () => {
        log({ category: 'pdv', action: `kiosk.auth-cancelled.${action}`, outcome: 'cancelled', context: {} });
        if (typeof onCancel === 'function') onCancel();
      }
    }
  );
}

// ─── Exposição global ─────────────────────────────────────────────────────────
// cash-session.js e outros módulos sem import direto usam estas referências.

window.requirePDVAdminAuthorization = requirePDVAdminAuthorization;
window.releasePDVKioskMode          = releasePDVKioskMode;
