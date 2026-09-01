import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

export async function getCurrentCashSessionService() {
  if (!isBackendReady()) return null;
  return httpRequest(buildEndpoint('cashSessions', 'current'));
}

export async function openCashSessionService(payload) {
  if (!isBackendReady()) return null;

  // Fase 2 (D2.1): contrato atual do backend (openCashSchema, .strict()):
  // openingAmount, password?, terminalName?, terminalCode?, notes?. Nomes
  // legados (openingBalance) removidos — o backend é a fonte correta dos
  // nomes, o frontend se alinha a ele. 'password' só é exigido pelo
  // controller quando pdvSettings.requireAuthOpenCash estiver ligado.
  const body = {
    openingAmount: typeof payload?.openingAmount === 'number'
      ? payload.openingAmount
      : Number(payload?.openingAmount ?? 0),
    password:      payload?.password      || undefined,
    terminalName:  payload?.terminalName  || undefined,
    terminalCode:  payload?.terminalCode  || undefined,
    notes:         payload?.notes         || undefined,
  };
  // Remover campos undefined para não enviá-los
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

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

  // Fase 2 (D2.2): contrato atual do backend (closeCashSchema, .strict()):
  // closingAmount, countedAmount?, password?, notes?. countedAmount é
  // calculado em cash-session.js e agora chega até a API — antes era
  // descartado aqui, deixando a comparação Confere/Sobra/Falta sempre
  // null no servidor. Campos extras que cash-session.js também envia
  // (terminalName, operatorId etc.) não fazem parte deste schema — não
  // são "esquecidos", são deliberadamente filtrados (o schema é
  // .strict() e rejeitaria qualquer chave desconhecida).
  const body = {
    closingAmount: typeof payload?.closingAmount === 'number'
      ? payload.closingAmount
      : Number(payload?.closingAmount ?? 0),
    countedAmount: payload?.countedAmount != null
      ? Number(payload.countedAmount)
      : undefined,
    password: payload?.password || undefined,
    notes: payload?.notes || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  return httpRequest(buildEndpoint('cashSessions', `${cashSessionId}/close`), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// Fase 3.1a-bis (ALTO C, C3): prévia autoritativa do saldo esperado antes do
// fechamento — GET /v1/cash-sessions/:id/close-preview, mesma fórmula
// (calculateExpectedCashAmount) que o backend usa no fechamento real. Só
// leitura, não persiste nada. Retorna null quando o backend não está
// disponível (mesma convenção dos serviços acima) — quem chamar NÃO deve
// usar isso como sinal para recalcular localmente (ver cash-session.js,
// openCashCloseConferenceModal()/updateCashCloseSummary()): falha aqui deve
// bloquear a conferência com erro explícito, nunca cair para
// getSessionSalesTotal().
export async function getCashClosePreviewService(cashSessionId) {
  if (!isBackendReady()) return null;

  if (!cashSessionId) {
    throw new Error('ID da sessão de caixa não informado.');
  }

  return httpRequest(buildEndpoint('cashSessions', `${cashSessionId}/close-preview`));
}

export async function reopenCashSessionService(payload = {}) {
  if (!isBackendReady()) return null;

  // Fase 2 (D5): contrato atual do backend (reopenCashSchema, .strict()):
  // openingAmount? (opcional), password?, notes?.
  const body = {
    openingAmount: payload?.openingAmount != null
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
