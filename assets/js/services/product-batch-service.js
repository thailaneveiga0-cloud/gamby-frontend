import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

// Lotes de estoque com validade exigem backend real (FEFO precisa de uma
// fonte única entre terminais) — sem fallback offline, diferente do resto
// do módulo de produtos (que é cache-first).

export async function createProductBatchService(productId, { quantity, expiresAt }) {
  if (!isBackendReady()) throw new Error('Backend indisponível — controle de validade exige conexão.');

  return httpRequest(buildEndpoint('products', `${productId}/batches`), {
    method: 'POST',
    body: JSON.stringify({ quantity, expiresAt })
  });
}

export async function consumeProductBatchService(productId, quantity) {
  if (!isBackendReady()) throw new Error('Backend indisponível — controle de validade exige conexão.');

  return httpRequest(buildEndpoint('products', `${productId}/batches/consume`), {
    method: 'POST',
    body: JSON.stringify({ quantity })
  });
}

export async function listProductBatchesService(productId) {
  if (!isBackendReady()) return [];

  return httpRequest(buildEndpoint('products', `${productId}/batches`));
}

export async function getExpiryReportService(withinDays = 30) {
  if (!isBackendReady()) return { all: [], expired: [], expiringSoon: [], withinDays };

  return httpRequest(buildEndpoint('products', `expiry-report?withinDays=${withinDays}`));
}

// Ações do painel Controle de Validade (Parte E) — descarte, devolução,
// quarentena, correção de validade, ajuste de estoque, conferência de
// quantidade, e as de só-auditoria (promoção/desconto/priorizar
// exposição/transferência).
export async function performBatchActionService(batchId, { action, quantity, justification, newExpiresAt }) {
  if (!isBackendReady()) throw new Error('Backend indisponível — ações de lote exigem conexão.');

  return httpRequest(buildEndpoint('products', `batches/${batchId}/actions`), {
    method: 'POST',
    body: JSON.stringify({ action, quantity, justification, newExpiresAt })
  });
}

// Conferência de estoque por produto (Parte G) — reconcilia todos os lotes
// ativos de uma vez (confirmar, corrigir quantidade/validade, dividir lote).
export async function verifyProductBatchesService(productId, { batches, notes }) {
  if (!isBackendReady()) throw new Error('Backend indisponível — conferência de estoque exige conexão.');

  return httpRequest(buildEndpoint('products', `${productId}/batches/verify`), {
    method: 'POST',
    body: JSON.stringify({ batches, notes })
  });
}
