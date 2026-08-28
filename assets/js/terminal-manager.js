import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { getOrCreateDeviceId } from './api.js';
import { audit } from './audit-service.js';

/* ──────────────────────────────────────────────
   STORAGE
────────────────────────────────────────────── */

function scopedKey() {
  const cid = String(state.currentUser?.companyId || 'local').trim() || 'local';
  return `${KEYS.terminals}_${cid}`;
}

export function getTerminals() {
  return load(scopedKey(), []);
}

function saveTerminals(list) {
  const key = scopedKey();
  const val = Array.isArray(list) ? list : [];
  save(key, val);
  const _d = window._terminalDebug = window._terminalDebug || {};
  _d.saveTerminalsCalled = true;
  _d.savedKey = key;
  _d.savedCount = val.length;
  _d.savedValue = localStorage.getItem(key);
}

export function findTerminalByDevice() {
  const deviceId = getOrCreateDeviceId();
  return getTerminals().find((t) => t.deviceId === deviceId) || null;
}

export function registerTerminal(data) {
  const deviceId = getOrCreateDeviceId();
  const now = new Date().toISOString();
  const terminal = {
    id: 'trm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    deviceId,
    name: String(data.name || 'Caixa 1').trim(),
    code: data.code || null,
    isActive: true,
    requireDailyOperatorId: data.requireDailyOperatorId !== false,
    lastOperatorName: data.operatorName || null,
    lastOperatorCpf: data.operatorCpf || null,
    lastOperatorPin: data.operatorPin || null,
    registeredAt: now,
    lastUsedAt: now
  };
  const _d = window._terminalDebug = window._terminalDebug || {};
  _d.registerTerminalCalled = true;
  _d.registerTerminalData = { name: terminal.name, deviceId, id: terminal.id };
  _d.scopedKeyAtRegister = scopedKey();
  const others = getTerminals().filter((t) => t.deviceId !== deviceId);
  saveTerminals([...others, terminal]);
  return terminal;
}

export function updateTerminal(terminalId, changes) {
  const list = getTerminals().map((t) =>
    t.id === terminalId
      ? { ...t, ...changes, lastUsedAt: new Date().toISOString() }
      : t
  );
  saveTerminals(list);
  return list.find((t) => t.id === terminalId) || null;
}

export function removeTerminal(terminalId) {
  saveTerminals(getTerminals().filter((t) => t.id !== terminalId));
}

/* ──────────────────────────────────────────────
   MODAL UTILITIES
────────────────────────────────────────────── */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _tmAv(name, role) {
  if (typeof window.renderUserAvatar !== 'function' || !name) return '';
  return window.renderUserAvatar(
    { name, photoUrl: window.getUserAvatar?.(name) || null, role: role || '' },
    { cls: 'av', size: 'sm' }
  );
}

function openOverlay(id, html) {
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'tm-overlay';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function closeOverlay(id) {
  document.getElementById(id)?.remove();
}

function applyCpfMask(input) {
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d+)/, '$1.$2');
    input.value = v;
  });
}

function autoFillPin(cpfInput, pinInput) {
  cpfInput.addEventListener('blur', () => {
    const d = cpfInput.value.replace(/\D/g, '');
    if (d.length === 11 && !pinInput.value) pinInput.value = d.slice(-4);
  });
}

function showFormError(formId, msg) {
  document.querySelector(`#${formId} .tm-error`)?.remove();
  const p = document.createElement('p');
  p.className = 'tm-error';
  p.textContent = msg;
  document.getElementById(formId)?.prepend(p);
}

/* ──────────────────────────────────────────────
   FIRST-TIME SETUP MODAL
────────────────────────────────────────────── */

export function showTerminalSetupModal() {
  const _d = window._terminalDebug = window._terminalDebug || {};
  _d.modalOpened = true;
  _d.modalOpenedAt = new Date().toISOString();
  return new Promise((resolve) => {
    openOverlay('tmSetupOverlay', `
      <div class="tm-card">
        <div class="tm-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <h2>Registrar este Caixa</h2>
          <p>Primeiro acesso nesta máquina.<br>Identifique o terminal e o operador responsável.</p>
        </div>
        <form id="tmSetupForm" autocomplete="off">
          <label>Nome do Caixa <span class="tm-req">*</span>
            <input id="tmSetupTerminalName" type="text" placeholder="Ex: Caixa 1, Caixa Preferencial, Balcão…" maxlength="40" />
          </label>
          <label>Nome do Operador <span class="tm-req">*</span>
            <input id="tmSetupOpName" type="text" placeholder="Nome completo" maxlength="60" />
          </label>
          <label>CPF do Operador <span class="tm-req">*</span>
            <input id="tmSetupOpCpf" type="text" placeholder="000.000.000-00" maxlength="14" inputmode="numeric" />
          </label>
          <label>Senha / PIN
            <small class="tm-hint">4 últimos dígitos do CPF — preenchido automaticamente</small>
            <input id="tmSetupOpPin" type="password" placeholder="••••" maxlength="6" inputmode="numeric" />
          </label>
          <label class="tm-toggle-label">
            <input id="tmSetupRequireDaily" type="checkbox" checked />
            <span>Solicitar identificação do operador a cada turno
              <small class="tm-hint tm-hint-block">Recomendado quando vários colaboradores revezam no mesmo caixa.</small>
            </span>
          </label>
          <div class="tm-actions">
            <button type="submit" class="tm-btn-primary">Registrar e Continuar</button>
          </div>
        </form>
      </div>
    `);

    const cpfIn = document.getElementById('tmSetupOpCpf');
    const pinIn = document.getElementById('tmSetupOpPin');
    applyCpfMask(cpfIn);
    autoFillPin(cpfIn, pinIn);

    setTimeout(() => document.getElementById('tmSetupTerminalName')?.focus(), 80);

    document.getElementById('tmSetupForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const _d = window._terminalDebug = window._terminalDebug || {};
      _d.formSubmitted = true;
      _d.formSubmittedAt = new Date().toISOString();

      const termName = document.getElementById('tmSetupTerminalName').value.trim();
      const opName = document.getElementById('tmSetupOpName').value.trim();
      const opCpf = cpfIn.value.trim();
      const requireDaily = document.getElementById('tmSetupRequireDaily').checked;

      _d.formValues = { termName, opName, opCpf: opCpf ? '***' : '', requireDaily };

      if (!termName) { showFormError('tmSetupForm', 'Informe o nome do caixa.'); _d.formError = 'no_termName'; return; }
      if (!opName) { showFormError('tmSetupForm', 'Informe o nome do operador.'); _d.formError = 'no_opName'; return; }
      if (opCpf.replace(/\D/g, '').length !== 11) {
        showFormError('tmSetupForm', 'CPF inválido. Informe os 11 dígitos.');
        _d.formError = 'invalid_cpf';
        return;
      }

      const cpfDigits = opCpf.replace(/\D/g, '');
      const pinRaw    = pinIn.value.trim();
      // PIN deve ser numérico 4-6 dígitos. Se digitado texto (ex: senha de login), rejeitar.
      if (pinRaw && !/^\d{4,6}$/.test(pinRaw)) {
        showFormError('tmSetupForm', 'PIN deve ter entre 4 e 6 dígitos numéricos. O PIN não pode ser uma senha de texto.');
        return;
      }
      const pin = pinRaw || cpfDigits.slice(-4);

      const terminal = registerTerminal({
        name: termName,
        requireDailyOperatorId: requireDaily,
        operatorName: opName,
        operatorCpf: opCpf,
        operatorPin: pin
      });

      _d.terminalAfterRegister = { id: terminal.id, name: terminal.name };

      closeOverlay('tmSetupOverlay');
      audit('terminal_registered', { terminalName: termName, operatorName: opName });

      resolve({ terminal, operatorData: { name: opName, cpf: opCpf, pin } });
    });
  });
}

/* ──────────────────────────────────────────────
   OPERATOR IDENTIFICATION MODAL
────────────────────────────────────────────── */

export function showOperatorIdentModal(terminal) {
  return new Promise((resolve) => {
    const hasLast = Boolean(terminal.lastOperatorName);
    const lastOpAv = hasLast ? _tmAv(terminal.lastOperatorName, '') : '';

    openOverlay('tmOperatorOverlay', `
      <div class="tm-card">
        <div class="tm-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          <h2>Identificação do Operador</h2>
          <p>Terminal: <strong>${esc(terminal.name)}</strong></p>
        </div>
        <form id="tmOpForm" autocomplete="off">
          <label>Nome do Operador <span class="tm-req">*</span>
            <input id="tmOpName" type="text" placeholder="Nome completo" maxlength="60" />
          </label>
          <label>CPF <span class="tm-req">*</span>
            <input id="tmOpCpf" type="text" placeholder="000.000.000-00" maxlength="14" inputmode="numeric" />
          </label>
          <label>Senha / PIN
            <input id="tmOpPin" type="password" placeholder="••••" maxlength="6" inputmode="numeric" />
          </label>
          <div class="tm-actions">
            <button type="button" id="tmOpCancelBtn" class="tm-btn-ghost">Cancelar</button>
            ${hasLast ? `<button type="button" id="tmOpLastBtn" class="tm-btn-ghost tm-op-last-btn">${lastOpAv}<span>↩ ${esc(terminal.lastOperatorName)}</span></button>` : ''}
            <button type="submit" class="tm-btn-primary">Confirmar</button>
          </div>
        </form>
      </div>
    `);

    const cpfIn = document.getElementById('tmOpCpf');
    const pinIn = document.getElementById('tmOpPin');
    applyCpfMask(cpfIn);
    autoFillPin(cpfIn, pinIn);

    setTimeout(() => document.getElementById('tmOpName')?.focus(), 80);

    document.getElementById('tmOpCancelBtn').addEventListener('click', () => {
      closeOverlay('tmOperatorOverlay');
      resolve(null);
    });

    if (hasLast) {
      document.getElementById('tmOpLastBtn')?.addEventListener('click', () => {
        closeOverlay('tmOperatorOverlay');
        resolve({
          name: terminal.lastOperatorName,
          cpf: terminal.lastOperatorCpf || '',
          pin: terminal.lastOperatorPin || ''
        });
      });
    }

    document.getElementById('tmOpForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('tmOpName').value.trim();
      const cpf = cpfIn.value.trim();

      if (!name) { showFormError('tmOpForm', 'Informe o nome do operador.'); return; }
      if (cpf.replace(/\D/g, '').length !== 11) {
        showFormError('tmOpForm', 'CPF inválido. Informe os 11 dígitos.');
        return;
      }

      const pinRaw = pinIn.value.trim();
      if (pinRaw && !/^\d{4,6}$/.test(pinRaw)) {
        showFormError('tmOpForm', 'PIN deve ter entre 4 e 6 dígitos numéricos.');
        return;
      }
      const pin = pinRaw || cpf.replace(/\D/g, '').slice(-4);
      closeOverlay('tmOperatorOverlay');
      resolve({ name, cpf, pin });
    });
  });
}

/* ──────────────────────────────────────────────
   CHANGE OPERATOR MODAL (settings)
────────────────────────────────────────────── */

function showChangeOperatorModal(terminal) {
  return new Promise((resolve) => {
    openOverlay('tmChangeOpOverlay', `
      <div class="tm-card">
        <div class="tm-header">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          <h2>Alterar Operador</h2>
          <p>Terminal: <strong>${esc(terminal.name)}</strong></p>
        </div>
        <form id="tmChOpForm" autocomplete="off">
          <label>Nome do operador <span class="tm-req">*</span>
            <input id="tmChOpName" type="text" maxlength="60" value="${esc(terminal.lastOperatorName || '')}" />
          </label>
          <label>CPF <span class="tm-req">*</span>
            <input id="tmChOpCpf" type="text" maxlength="14" inputmode="numeric" value="${esc(terminal.lastOperatorCpf || '')}" />
          </label>
          <label>Senha / PIN
            <input id="tmChOpPin" type="password" placeholder="••••" maxlength="6" inputmode="numeric" />
          </label>
          <div class="tm-actions">
            <button type="button" id="tmChOpCancelBtn" class="tm-btn-ghost">Cancelar</button>
            <button type="submit" class="tm-btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    `);

    const cpfIn = document.getElementById('tmChOpCpf');
    const pinIn = document.getElementById('tmChOpPin');
    applyCpfMask(cpfIn);
    autoFillPin(cpfIn, pinIn);

    document.getElementById('tmChOpCancelBtn').addEventListener('click', () => {
      closeOverlay('tmChangeOpOverlay');
      resolve(null);
    });

    document.getElementById('tmChOpForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('tmChOpName').value.trim();
      const cpf = cpfIn.value.trim();
      if (!name || cpf.replace(/\D/g, '').length !== 11) {
        showFormError('tmChOpForm', 'Preencha nome e CPF válido.');
        return;
      }
      const pin = pinIn.value.trim() || cpf.replace(/\D/g, '').slice(-4);
      updateTerminal(terminal.id, {
        lastOperatorName: name,
        lastOperatorCpf: cpf,
        lastOperatorPin: pin
      });
      audit('terminal_operator_changed', { terminalName: terminal.name, newOperator: name });
      closeOverlay('tmChangeOpOverlay');
      renderTerminalsSettings();
      resolve({ name, cpf, pin });
    });
  });
}

/* ──────────────────────────────────────────────
   MAIN CASH-OPEN ENTRY POINT
────────────────────────────────────────────── */

export async function checkTerminalBeforeCashOpen() {
  // Rede de segurança: perfil ativo (seletor pós-login) já identificou o
  // operador por uma UI diferente — nunca reabrir showTerminalSetupModal()/
  // showOperatorIdentModal() por cima disso. O chamador (startPDVOpenCashFlow)
  // já evita chegar aqui quando state.currentOperator?.name está setado; esta
  // checagem cobre o caso de currentOperator ainda não estar sincronizado no
  // momento exato da chamada.
  if (sessionStorage.getItem('gamby_active_profile') && state.currentOperator?.name) {
    const op = state.currentOperator;
    return {
      terminalName: op.terminalName || findTerminalByDevice()?.name || 'Caixa Principal',
      terminalCode: findTerminalByDevice()?.code || null,
      operator: {
        id: op.id || null,
        name: op.name,
        cpf: op.cpf || '',
        controlPin: op.controlPin || '',
        terminalName: op.terminalName || 'Caixa Principal'
      }
    };
  }

  let terminal = findTerminalByDevice();
  let opData;

  if (!terminal) {
    const setup = await showTerminalSetupModal();
    if (!setup) return null;
    terminal = setup.terminal;
    opData = setup.operatorData;
  } else if (terminal.requireDailyOperatorId) {
    opData = await showOperatorIdentModal(terminal);
    if (!opData) return null;
  } else {
    opData = {
      name: terminal.lastOperatorName || 'Operador',
      cpf: terminal.lastOperatorCpf || '',
      pin: terminal.lastOperatorPin || ''
    };
  }

  updateTerminal(terminal.id, {
    lastOperatorName: opData.name,
    lastOperatorCpf: opData.cpf,
    lastOperatorPin: opData.pin
  });

  audit('terminal_operator_identified', {
    terminalName: terminal.name,
    operatorName: opData.name
  });

  return {
    terminalName: terminal.name,
    terminalCode: terminal.code,
    operator: {
      id: null,
      name: opData.name,
      cpf: opData.cpf,
      controlPin: opData.pin,
      terminalName: terminal.name
    }
  };
}

/* ──────────────────────────────────────────────
   SETTINGS UI
────────────────────────────────────────────── */

export function renderTerminalsSettings() {
  const panel = document.getElementById('terminalsSettingsPanel');
  if (!panel) return;

  const deviceId = getOrCreateDeviceId();
  const terminals = getTerminals();

  const rows = terminals.length
    ? terminals
        .map((t) => {
          const mine = t.deviceId === deviceId;
          const opAv  = _tmAv(t.lastOperatorName, '');
          const opCell = (opAv && t.lastOperatorName)
            ? `<span class="rpt-op-cell">${opAv}${esc(t.lastOperatorName)}</span>`
            : esc(t.lastOperatorName || '—');
          return `
          <tr class="${mine ? 'tm-row-mine' : ''}">
            <td>
              <strong>${esc(t.name)}</strong>
              ${mine ? '<span class="tm-badge-this">Esta máquina</span>' : ''}
            </td>
            <td>${opCell}</td>
            <td class="tm-td-ctr">
              <label class="tm-toggle-cell">
                <input type="checkbox" class="tm-req-daily-toggle" data-id="${esc(t.id)}"
                  ${t.requireDailyOperatorId ? 'checked' : ''} />
              </label>
            </td>
            <td>
              <button class="tm-action-btn tm-edit-terminal" data-id="${esc(t.id)}" type="button">Renomear</button>
              <button class="tm-action-btn tm-change-operator" data-id="${esc(t.id)}" type="button">Trocar operador</button>
              <button class="tm-action-btn tm-danger tm-remove-terminal" data-id="${esc(t.id)}" type="button">Remover</button>
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="4" class="tm-no-terminals">Nenhuma máquina registrada. O cadastro ocorre automaticamente no primeiro acesso ao PDV.</td></tr>`;

  panel.innerHTML = `
    <div class="tm-panel-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      <h3>Terminais / Caixas cadastrados</h3>
    </div>
    <p class="tm-device-id">ID desta máquina: <code>${esc(deviceId)}</code></p>
    <div class="tm-overflow">
      <table class="tm-terminals-table">
        <thead>
          <tr>
            <th>Terminal</th>
            <th>Último Operador</th>
            <th class="tm-th-ctr">Id. diária</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="tm-btn-actions">
      <button id="tmResetThisBtn" class="btn btn-ghost tm-reset-btn" type="button">
        Resetar esta máquina
      </button>
      <span class="tm-hint-txt">Remove o vínculo desta máquina com o terminal registrado.</span>
    </div>
  `;
}

export function bindTerminalsSettingsActions() {
  const panel = document.getElementById('terminalsSettingsPanel');
  if (!panel) return;

  panel.addEventListener('change', (e) => {
    const toggle = e.target.closest('.tm-req-daily-toggle');
    if (!toggle) return;
    updateTerminal(toggle.dataset.id, { requireDailyOperatorId: toggle.checked });
    renderTerminalsSettings();
  });

  panel.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.tm-edit-terminal');
    if (editBtn) {
      const t = getTerminals().find((x) => x.id === editBtn.dataset.id);
      if (!t) return;
      const name = window.prompt('Novo nome para o terminal:', t.name);
      if (name?.trim()) {
        updateTerminal(t.id, { name: name.trim() });
        renderTerminalsSettings();
      }
      return;
    }

    const opBtn = e.target.closest('.tm-change-operator');
    if (opBtn) {
      const t = getTerminals().find((x) => x.id === opBtn.dataset.id);
      if (t) showChangeOperatorModal(t);
      return;
    }

    const removeBtn = e.target.closest('.tm-remove-terminal');
    if (removeBtn) {
      const t = getTerminals().find((x) => x.id === removeBtn.dataset.id);
      if (!t) return;
      if (window.confirm(`Remover "${t.name}"?\nEsta máquina precisará ser registrada novamente no próximo acesso ao PDV.`)) {
        removeTerminal(t.id);
        audit('terminal_removed', { terminalName: t.name });
        renderTerminalsSettings();
      }
    }
  });

  document.getElementById('terminalsSettingsPanel').addEventListener('click', (e) => {
    if (!e.target.closest('#tmResetThisBtn')) return;
    const t = findTerminalByDevice();
    if (!t) {
      window.alert('Esta máquina não tem terminal registrado.');
      return;
    }
    if (window.confirm(`Resetar a associação desta máquina com "${t.name}"?\nNo próximo acesso ao PDV será solicitado o registro novamente.`)) {
      removeTerminal(t.id);
      audit('terminal_reset', { terminalName: t.name });
      renderTerminalsSettings();
    }
  });
}
