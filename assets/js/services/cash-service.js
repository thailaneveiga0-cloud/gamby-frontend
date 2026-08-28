import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getCurrentCashSessionService() {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('cashSessions', 'current'));
}

export async function openCashSessionService(payload) {
  if (!isBackendReady()) return null;

  // Backend schema (openCashSchema, strict): openingBalance, password, terminalName,
  // terminalCode, notes. Campo do frontend é 'openingAmount' → mapear para
  // 'openingBalance'. Campos extras (operatorId, authorizedById, businessDate etc.)
  // são rejeitados por .strict(). 'password' é obrigatório no controller sempre que
  // pdvSettings.requireAuthOpenCash estiver ligado — sem isso, abre 403 silencioso.
  const body = {
    openingBalance: typeof payload?.openingAmount === 'number'
      ? payload.openingAmount
      : Number(payload?.openingAmount ?? payload?.openingBalance ?? 0),
    password:      payload?.password      || undefined,
    terminalName:  payload?.terminalName  || undefined,
    terminalCode:  payload?.terminalCode  || undefined,
    notes:         payload?.notes         || undefined,
  };
  // Remover campos undefined para não enviá-los
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  console.log('[CASH-OPEN] payload enviado para /v1/cash-sessions/open:', JSON.stringify(body));

  return httpRequest(buildEndpoint('cashSessions', 'open'), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function closeCashSessionService(cashSessionId, payload) {
  if (!isBackendReady()) return null;

  if (!cashSessionId) {
    throw new Error('ID da sessão de caixa não informado.');
  }

  // Backend schema (closeCashSchema, strict): closingBalance, password (opcional
  // na validação, mas exigido pelo controller quando operatorMustAuth ||
  // pdvSettings.requireAuthCloseCash — sem enviá-lo, esses casos 403/422),
  // notes. Frontend usa 'closingAmount' → mapear para 'closingBalance'.
  // Campos extras (countedAmount, openingAmount, salesAmount etc.) rejeitados por .strict().
  const body = {
    closingBalance: typeof payload?.closingAmount === 'number'
      ? payload.closingAmount
      : Number(payload?.closingAmount ?? payload?.closingBalance ?? 0),
    password: payload?.password || undefined,
    notes: payload?.notes || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  console.log('[CASH-CLOSE] payload enviado para /v1/cash-sessions/close:', JSON.stringify(body));

  return httpRequest(buildEndpoint('cashSessions', `${cashSessionId}/close`), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function reopenCashSessionService(payload = {}) {
  if (!isBackendReady()) return null;

  // Backend schema (reopenCashSchema, strict): openingBalance (opt), password (opt), notes.
  const body = {
    openingBalance: payload?.openingAmount != null
      ? Number(payload.openingAmount)
      : undefined,
    notes: payload?.notes || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  return httpRequest(buildEndpoint('cashSessions', 'reopen'), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}