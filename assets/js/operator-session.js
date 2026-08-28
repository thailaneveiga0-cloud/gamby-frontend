import { state } from './state.js';
import { audit } from './audit-service.js';
import {
  listOperatorsService,
  loginWithPinService,
  switchOperatorService,
  registerOperatorService,
} from './services/pin-service.js';
import {
  findTerminalByDevice,
  registerTerminal,
  updateTerminal,
  showTerminalSetupModal,
  showOperatorIdentModal,
} from './terminal-manager.js';

/* ================= SESSION PERSISTENCE ================= */

function _sessionsStorageKey() {
  const cid = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `gamby_operator_sessions_${cid}`;
}

function _persistSessions() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todaySessions = (state.operatorSessions || []).filter(
      (s) => (s.startedAt || '').slice(0, 10) === today
    );
    localStorage.setItem(_sessionsStorageKey(), JSON.stringify(todaySessions));
  } catch (e) {
    console.warn('[OperatorSession] Falha ao persistir sessões:', e);
  }
}

export function loadOperatorSessions() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem(_sessionsStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    const todaySessions = Array.isArray(parsed)
      ? parsed.filter((s) => (s.startedAt || '').slice(0, 10) === today)
      : [];

    if (!todaySessions.length && state.cashSession?.isOpen && state.cashSession?.operatorName) {
      const cs = state.cashSession;
      todaySessions.push({
        id: `opsess_restored_${Date.now()}`,
        operatorId: cs.operatorId || null,
        operatorName: cs.operatorName || '',
        terminalName: cs.terminalName || 'Caixa principal',
        startedAt: cs.openedAt || new Date().toISOString(),
        endedAt: null,
        status: 'online',
      });
    }

    state.operatorSessions = todaySessions;
  } catch (e) {
    console.warn('[OperatorSession] Falha ao carregar sessões:', e);
    state.operatorSessions = [];
  }
}

/* ================= SESSION TRACKING ================= */

function _openTrackedSession(operator) {
  if (!Array.isArray(state.operatorSessions)) state.operatorSessions = [];

  const terminal = operator.terminalName || state.cashSession?.terminalName || 'Caixa principal';

  state.operatorSessions = state.operatorSessions.map((s) =>
    s.terminalName === terminal && s.status === 'online'
      ? { ...s, status: 'offline', endedAt: new Date().toISOString() }
      : s
  );

  state.operatorSessions.push({
    id: `opsess_${Date.now()}`,
    operatorId: operator.id || null,
    operatorName: operator.name || '',
    terminalName: terminal,
    startedAt: operator.startedAt || new Date().toISOString(),
    endedAt: null,
    status: 'online',
  });

  _persistSessions();
}

function _closeTrackedSession(operatorName) {
  if (!Array.isArray(state.operatorSessions)) return;

  const now = new Date().toISOString();
  state.operatorSessions = state.operatorSessions.map((s) =>
    s.operatorName === operatorName && s.status === 'online'
      ? { ...s, status: 'offline', endedAt: now }
      : s
  );

  _persistSessions();
}

export function pauseOperatorSession() {
  if (!state.currentOperator?.name || !Array.isArray(state.operatorSessions)) return;
  state.operatorSessions = state.operatorSessions.map((s) =>
    s.operatorName === state.currentOperator.name && s.status === 'online'
      ? { ...s, status: 'paused' }
      : s
  );
  _persistSessions();
}

export function resumeOperatorSession() {
  if (!state.currentOperator?.name || !Array.isArray(state.operatorSessions)) return;
  state.operatorSessions = state.operatorSessions.map((s) =>
    s.operatorName === state.currentOperator.name && s.status === 'paused'
      ? { ...s, status: 'online' }
      : s
  );
  _persistSessions();
}

/* ================= PIN MODAL ================= */

function _esc(v) {
  return String(v || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function _buildModalHtml(operators) {
  const opts = operators.map((op) => {
    const badge = op.hasPin ? '' : ' <span class="pin-badge-warn">(sem PIN)</span>';
    return `<option value="${_esc(op.id)}" data-has-pin="${op.hasPin ? '1' : '0'}">${_esc(op.name)} — ${_esc(op.role)}${badge}</option>`;
  }).join('');

  return `
<div id="pinModal" class="pin-modal-overlay" role="dialog" aria-modal="true" aria-label="Identificação do operador">
  <div class="pin-modal-box">
    <h3 class="pin-modal-title">Identificação do Operador</h3>
    <div class="pin-modal-field">
      <label for="pinOperatorSelect">Operador</label>
      <select id="pinOperatorSelect">${opts}</select>
    </div>
    <div class="pin-modal-field">
      <label for="pinInput">PIN (4-6 dígitos)</label>
      <input id="pinInput" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••" />
    </div>
    <p id="pinModalError" class="pin-modal-error" aria-live="assertive"></p>
    <div class="pin-modal-actions">
      <button id="pinModalCancel" class="btn-secondary">Cancelar</button>
      <button id="pinModalConfirm" class="btn-primary">Confirmar</button>
    </div>
  </div>
</div>`;
}

function _showPinError(msg) {
  const el = document.getElementById('pinModalError');
  if (el) el.textContent = msg;
}

function _removePinModal() {
  document.getElementById('pinModal')?.remove();
}

// onConfirm: optional async (userId, pin) => null | errorString
// Without onConfirm: resolves with {userId, pin} (used by showSwitchOperatorModal)
// With onConfirm: resolves with true on success, false on cancel
function _openPinModal(operators, onConfirm) {
  return new Promise((resolve) => {
    _removePinModal();
    document.body.insertAdjacentHTML('beforeend', _buildModalHtml(operators));

    const overlay  = document.getElementById('pinModal');
    const confirm  = document.getElementById('pinModalConfirm');
    const cancel   = document.getElementById('pinModalCancel');
    const pinInput = document.getElementById('pinInput');
    const select   = document.getElementById('pinOperatorSelect');

    setTimeout(() => pinInput?.focus(), 80);

    function _updateSelectState() {
      const opt = select?.options[select.selectedIndex];
      const hasPin = opt?.dataset?.hasPin === '1';
      if (confirm) confirm.disabled = !hasPin;
      if (!hasPin) {
        _showPinError('Operador sem PIN configurado. Cadastre um PIN na aba Usuários.');
      } else {
        _showPinError('');
      }
    }
    select?.addEventListener('change', _updateSelectState);
    _updateSelectState();

    async function _doConfirm() {
      const userId = select?.value;
      const pin = pinInput?.value?.trim();
      if (!userId) { _showPinError('Selecione um operador.'); return; }
      if (!pin)    { _showPinError('Informe o PIN.'); pinInput?.focus(); return; }

      if (typeof onConfirm === 'function') {
        if (confirm) confirm.disabled = true;
        const errMsg = await onConfirm(userId, pin);
        if (errMsg) {
          _showPinError(errMsg);
          if (confirm) confirm.disabled = false;
          pinInput?.focus();
          return;
        }
        _removePinModal();
        resolve(true);
      } else {
        _removePinModal();
        resolve({ userId, pin });
      }
    }

    confirm?.addEventListener('click', _doConfirm);
    pinInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doConfirm(); });
    cancel?.addEventListener('click', () => {
      _removePinModal();
      resolve(typeof onConfirm === 'function' ? false : null);
    });
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) {
        _removePinModal();
        resolve(typeof onConfirm === 'function' ? false : null);
      }
    });
  });
}

/* ================= REQUIRE SESSION ================= */

// Roles permitidos como operador de caixa — Desenvolvedora/Administrador nunca operam o PDV
const _PDV_OPERATOR_ROLES = new Set(['operador', 'caixa', 'vendedor']);

function _filterOperators(list) {
  return (Array.isArray(list) ? list : []).filter(
    (op) => _PDV_OPERATOR_ROLES.has(String(op.role || '').toLowerCase())
  );
}

/* ── "É você?" modal ─────────────────────────────────────────────────────── */

function _showIsYouModal(operatorName) {
  return new Promise((resolve) => {
    const id = 'pdvIsYouModal';
    document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', `
<div id="${id}" class="pin-modal-overlay" role="dialog" aria-modal="true">
  <div class="pin-modal-box">
    <h3 class="pin-modal-title">Identificação do Operador</h3>
    <p style="margin:10px 0 18px;font-size:.93rem;">Este caixa está vinculado a <strong>${_esc(operatorName)}</strong>. É você?</p>
    <div class="pin-modal-actions">
      <button id="iyu-no" class="btn-secondary">Não, sou outro operador</button>
      <button id="iyu-yes" class="btn-primary">Sim, sou eu</button>
    </div>
    <div style="text-align:center;margin-top:10px;">
      <button id="iyu-cancel" class="btn-ghost" style="font-size:.8rem;opacity:.65;">Cancelar</button>
    </div>
  </div>
</div>`);
    const overlay = document.getElementById(id);
    document.getElementById('iyu-yes')?.addEventListener('click', () => { overlay.remove(); resolve('yes'); });
    document.getElementById('iyu-no')?.addEventListener('click', () => { overlay.remove(); resolve('no'); });
    document.getElementById('iyu-cancel')?.addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay?.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
  });
}

/* ── PIN-only modal (confirm known operator) ────────────────────────────── */

function _openPinOnlyModal(operatorName, onConfirm) {
  return new Promise((resolve) => {
    const id = 'pdvPinOnlyModal';
    document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', `
<div id="${id}" class="pin-modal-overlay" role="dialog" aria-modal="true">
  <div class="pin-modal-box">
    <h3 class="pin-modal-title">Confirme sua identidade</h3>
    <p style="margin:6px 0 14px;font-size:.9rem;color:var(--text-secondary,#666);">Operador: <strong>${_esc(operatorName)}</strong></p>
    <div class="pin-modal-field">
      <label for="ponPinInput">PIN (4–6 dígitos)</label>
      <input id="ponPinInput" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••" />
    </div>
    <p id="ponError" class="pin-modal-error" aria-live="assertive"></p>
    <div class="pin-modal-actions">
      <button id="ponCancel" class="btn-secondary">Cancelar</button>
      <button id="ponConfirm" class="btn-primary">Confirmar</button>
    </div>
  </div>
</div>`);
    const overlay  = document.getElementById(id);
    const pinIn    = document.getElementById('ponPinInput');
    const errEl    = document.getElementById('ponError');
    const confirmBtn = document.getElementById('ponConfirm');

    setTimeout(() => pinIn?.focus(), 80);

    function _showErr(msg) { if (errEl) errEl.textContent = msg; }

    async function _doConfirm() {
      const pin = pinIn?.value?.trim();
      if (!pin) { _showErr('Informe o PIN.'); pinIn?.focus(); return; }
      if (typeof onConfirm === 'function') {
        if (confirmBtn) confirmBtn.disabled = true;
        const errMsg = await onConfirm(pin);
        if (errMsg) {
          _showErr(errMsg);
          if (confirmBtn) confirmBtn.disabled = false;
          pinIn?.focus();
          return;
        }
        overlay.remove();
        resolve(true);
      }
    }

    confirmBtn?.addEventListener('click', _doConfirm);
    pinIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doConfirm(); });
    document.getElementById('ponCancel')?.addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay?.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

/* ── Shared helpers ─────────────────────────────────────────────────────── */

function _setCurrentOperator({ id, name, role, terminalName }) {
  state.currentOperator = {
    id: id || null,
    name,
    role: role || 'operador',
    terminalName: terminalName || 'Caixa principal',
    startedAt: new Date().toISOString(),
  };
  if (!state.cashSession) state.cashSession = {};
  state.cashSession.terminalName = state.currentOperator.terminalName;
  try { localStorage.setItem('gamby_current_operator', JSON.stringify(state.currentOperator)); } catch {}
  _openTrackedSession(state.currentOperator);
  audit('operator_identified', { name, terminalName: state.currentOperator.terminalName });
}

/* ── Backend registration (best-effort) ─────────────────────────────────── */

async function _registerOnBackend(name, cpf, pin) {
  try {
    const op = await registerOperatorService(name, cpf, pin);
    return op?.id || null;
  } catch {
    return null;
  }
}

/* ── Flow branches ──────────────────────────────────────────────────────── */

async function _handleFirstAccess() {
  const _d = window._terminalDebug = window._terminalDebug || {};
  _d.handleFirstAccessCalled = true;
  _d.companyIdAtFirstAccess = state.currentUser?.companyId || null;

  if (!state.currentUser?.companyId) {
    _d.error = 'no_companyId';
    alert('Sessão não identificada. Faça login novamente antes de abrir o caixa.');
    return false;
  }

  _d.expectedKey = 'gamby_terminals_modular_' + state.currentUser.companyId;
  _d.showTerminalSetupModalCalled = true;

  const setup = await showTerminalSetupModal();
  _d.setupResult = setup ? { terminalId: setup.terminal?.id, terminalName: setup.terminal?.name, operatorName: setup.operatorData?.name } : null;

  if (!setup) { _d.error = 'modal_cancelled'; return false; }

  const { terminal, operatorData } = setup;

  const saved = findTerminalByDevice();
  _d.findAfterSave = saved ? { id: saved.id, name: saved.name } : null;
  _d.lsKeyAfterSave = localStorage.getItem(_d.expectedKey);

  if (!saved) {
    _d.error = 'terminal_not_saved';
    alert(
      'Erro: terminal não foi registrado.\n' +
      'Chave esperada: ' + _d.expectedKey + '\n' +
      'lsValue: ' + _d.lsKeyAfterSave + '\n' +
      'Abra o console e verifique window._terminalDebug'
    );
    return false;
  }

  const operatorId = await _registerOnBackend(operatorData.name, operatorData.cpf, operatorData.pin);
  _d.backendOperatorId = operatorId;

  updateTerminal(terminal.id, {
    lastOperatorId: operatorId || null,
    lastOperatorName: operatorData.name,
    lastOperatorCpf: operatorData.cpf,
  });

  _d.success = true;
  _setCurrentOperator({ id: operatorId, name: operatorData.name, terminalName: terminal.name });
  return true;
}

async function _handleKnownOperator(terminal) {
  const answer = await _showIsYouModal(terminal.lastOperatorName);
  if (answer === null) return false;

  if (answer === 'yes') {
    const ok = await _openPinOnlyModal(terminal.lastOperatorName, async (pin) => {
      try {
        const operator = await loginWithPinService(terminal.lastOperatorId, pin);
        if (!operator) return 'Falha na autenticação.';
        _setCurrentOperator({
          id: operator.userId,
          name: operator.name,
          role: operator.role,
          terminalName: terminal.name,
        });
        audit('operator_login_success', { operatorId: terminal.lastOperatorId });
        return null;
      } catch (err) {
        audit('operator_login_failed', { operatorId: terminal.lastOperatorId });
        const msg = err?.message || '';
        return msg.includes('PIN não configurado')
          ? 'Operador sem PIN configurado. Cadastre um PIN na aba Usuários.'
          : (msg || 'Falha na autenticação do operador.');
      }
    });
    return ok === true;
  }

  // "no" → register new operator
  return await _handleNewOperator(terminal);
}

async function _handleNewOperator(terminal) {
  const opData = await showOperatorIdentModal(terminal);
  if (!opData) return false;

  const operatorId = await _registerOnBackend(opData.name, opData.cpf, opData.pin);

  updateTerminal(terminal.id, {
    lastOperatorId: operatorId,
    lastOperatorName: opData.name,
    lastOperatorCpf: opData.cpf,
    lastOperatorPin: opData.pin,
  });

  _setCurrentOperator({ id: operatorId, name: opData.name, terminalName: terminal.name });
  return true;
}

/* ── Main entry point ───────────────────────────────────────────────────── */

export async function requireOperatorSession(forcePin = false) {
  // ── Proteção central ──────────────────────────────────────────────────────
  // Modo controlado sempre exige PIN, independente do parâmetro recebido.
  // Evita que chamadas legadas com forcePin=false/omitido contornem a regra.
  let _pdvMode = state?.pdvSettings?.pdvMode;
  if (!_pdvMode) {
    try { _pdvMode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.pdvMode; } catch {}
  }
  const _isControlled = _pdvMode === 'controlled';
  if (_isControlled) forcePin = true;

  // Preservar entrySource definido pelo helper antes de sobrescrever o objeto
  const _prevEntry = (window._terminalDebug || {}).entrySource || null;

  const _d = window._terminalDebug = {
    timestamp: new Date().toISOString(),
    companyId:    state.currentUser?.companyId || null,
    currentOperator: state.currentOperator?.name || null,
    operatorId:   state.currentOperator?.id || null,
    operatorName: state.currentOperator?.name || null,
    sessionValidated: false,
    forcePin,
    businessMode: _isControlled ? 'controlled' : 'simplified',
    cashStatus: state.cashSession?.isOpen ? 'open' : 'closed',
    entrySource: _prevEntry || 'direct',
    adminCashOpenAuthorized: Boolean(state.adminCashOpenAuthorized),
    operatorPinValidated: Boolean(state.operatorPinValidated),
  };

  // BUG CONFIRMADO: em modo controlado, forcePin é forçado para true acima —
  // o que antes pulava esta saída incondicionalmente (`!forcePin && ...`),
  // mesmo com o operador já identificado (state.currentOperator.name setado
  // E state.operatorPinValidated true — ex.: pelo seletor de perfil pós-login,
  // que valida o MESMO PIN por uma UI diferente). Resultado: qualquer chamador
  // que invocasse requireOperatorSession()/requirePDVOperatorSession() sem
  // checar operatorPinValidated antes reabria o modal antigo "Identificação
  // do Operador" por cima de uma sessão já identificada. forcePin deveria
  // significar apenas "PIN é obrigatório neste modo", não "reidentificar
  // sempre, mesmo já identificado".
  if (state.currentOperator?.name && (state.operatorPinValidated || !forcePin)) {
    _d.exit = 'already_set';
    _d.sessionValidated = true;
    return true;
  }

  // Rede de segurança adicional: perfil ativo definido pelo seletor pós-login
  // (sessionStorage) já passou pela identificação equivalente — nunca reabrir
  // o fluxo antigo de terminal/operador por cima de um perfil simulado, seja
  // qual for o motivo de currentOperator/operatorPinValidated não estarem
  // sincronizados no momento exato desta chamada.
  if (sessionStorage.getItem('gamby_active_profile')) {
    _d.exit = 'active_profile_bypass';
    _d.sessionValidated = true;
    return true;
  }

  const terminal = findTerminalByDevice();
  _d.findTerminalResult = terminal
    ? { id: terminal.id, name: terminal.name, lastOperatorId: terminal.lastOperatorId }
    : null;

  let _success = false;
  if (!terminal) {
    _d.branch = 'firstAccess';
    _success = await _handleFirstAccess();
  } else if (terminal.lastOperatorId && terminal.lastOperatorName) {
    _d.branch = 'knownOperator';
    _success = await _handleKnownOperator(terminal);
  } else {
    _d.branch = 'newOperator';
    _success = await _handleNewOperator(terminal);
  }

  if (_success) {
    _d.sessionValidated  = true;
    _d.currentOperator   = state.currentOperator?.name || null;
    _d.operatorId        = state.currentOperator?.id   || null;
    _d.operatorName      = state.currentOperator?.name || null;
  }

  return _success;
}

// ── Helper central para entradas no PDV ───────────────────────────────────
// Detecta automaticamente o modo e chama requireOperatorSession(forcePin).
// Todo ponto de entrada no PDV deve usar este helper em vez de chamar
// requireOperatorSession() diretamente, garantindo entrySource no debug.
export async function requirePDVOperatorSession(entrySource = 'unknown') {
  let _pdvMode = state?.pdvSettings?.pdvMode;
  if (!_pdvMode) {
    try { _pdvMode = JSON.parse(localStorage.getItem('gamby_pdv_settings_cache') || '{}')?.pdvMode; } catch {}
  }
  const _isControlled = _pdvMode === 'controlled';

  // Pré-popular debug antes da chamada para que requireOperatorSession preserve o entrySource
  window._terminalDebug = {
    ...(window._terminalDebug || {}),
    entrySource,
    forcePin:     _isControlled,
    businessMode: _isControlled ? 'controlled' : 'simplified',
    cashStatus:   state.cashSession?.isOpen ? 'open' : 'closed',
    timestamp:    new Date().toISOString(),
  };

  return requireOperatorSession(_isControlled);
}

/* ================= CLEAR SESSION ================= */

export function clearOperatorSession() {
  const operatorName = state.currentOperator?.name || null;
  audit('operator_session_closed', { operator: state.currentOperator || null });
  if (operatorName) _closeTrackedSession(operatorName);
  state.currentOperator = null;
  state.operatorPinValidated = false;
  try { localStorage.removeItem('gamby_current_operator'); } catch {}
}

/* ================= SWITCH OPERATOR ================= */

export async function switchOperator(newOperator) {
  if (!newOperator?.name) return false;

  const prevName = state.currentOperator?.name || null;
  if (prevName) _closeTrackedSession(prevName);

  state.currentOperator = {
    id: newOperator.id || null,
    name: newOperator.name,
    role: newOperator.role || '',
    terminalName: newOperator.terminalName || state.cashSession?.terminalName || 'Caixa principal',
    startedAt: new Date().toISOString(),
  };

  try { localStorage.setItem('gamby_current_operator', JSON.stringify(state.currentOperator)); } catch {}
  _openTrackedSession(state.currentOperator);

  audit('operator_switch', {
    from: prevName,
    to: newOperator.name,
    terminalName: state.currentOperator.terminalName,
  });

  return true;
}

/* ================= PIN SWITCH MODAL (PDV button) ================= */

export async function showSwitchOperatorModal() {
  let operators = [];
  try {
    const all = await listOperatorsService();
    operators = _filterOperators(all);
  } catch {
    alert('Não foi possível carregar a lista de operadores.');
    return false;
  }

  if (!operators.length) {
    alert('Nenhum operador cadastrado. Cadastre um operador na aba Usuários.');
    return false;
  }

  const result = await _openPinModal(operators);
  if (!result) return false;

  try {
    const cashSessionId = state.cashSession?.id || null;
    const terminalName = state.cashSession?.terminalName || 'Caixa principal';
    await switchOperatorService(result.userId, result.pin, cashSessionId, terminalName);

    const op = operators.find((o) => o.id === result.userId);
    if (op) {
      await switchOperator({ ...op, terminalName });
    }
    return true;
  } catch (err) {
    alert(err?.message || 'Falha ao trocar operador.');
    return false;
  }
}
