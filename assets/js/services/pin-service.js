import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function ensureReady() {
  if (!isBackendReady()) throw new Error('Serviço indisponível no momento.');
}

export async function listOperatorsService() {
  ensureReady();
  const res = await httpRequest(`${buildEndpoint('pdv')}/operators`, { method: 'GET' });
  return res?.operators || [];
}

export async function loginWithPinService(userId, pin) {
  ensureReady();
  const res = await httpRequest(`${buildEndpoint('pdv')}/operator-pin/login`, {
    method: 'POST',
    body: JSON.stringify({ userId, pin }),
  });
  return res?.operator || null;
}

export async function switchOperatorService(userId, pin, cashSessionId, terminalName) {
  ensureReady();
  const res = await httpRequest(`${buildEndpoint('pdv')}/operator-pin/switch`, {
    method: 'POST',
    body: JSON.stringify({ userId, pin, cashSessionId, terminalName }),
  });
  return res;
}

export async function setOperatorPinService(userId, pin) {
  ensureReady();
  const res = await httpRequest(`${buildEndpoint('pdv')}/operator-pin/set`, {
    method: 'POST',
    body: JSON.stringify({ userId, pin }),
  });
  return res;
}

export async function setOwnPinService(pin) {
  ensureReady();
  const res = await httpRequest(`${buildEndpoint('pdv')}/operator-pin/self`, {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  return res;
}

export async function removeOperatorPinService(userId) {
  ensureReady();
  const res = await httpRequest(`${buildEndpoint('pdv')}/operator-pin/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  return res;
}

export async function registerOperatorService(name, cpf, pin) {
  ensureReady();
  // Sanitizar PIN: backend exige 4-6 dígitos numéricos.
  // Se pin tiver letras (ex: usuário digitou senha de login), extrair apenas dígitos.
  const sanitizedPin = String(pin || '').replace(/\D/g, '').slice(0, 6);
  // Fase 2 (D4.2): log removido — chegava a expor 5 de 6 dígitos do PIN em
  // claro no console (.replace(/./, '*') sem flag 'g' só troca o primeiro
  // caractere). PIN não vai para log de nenhuma forma, nem mascarado.
  if (!name || sanitizedPin.length < 4) {
    console.warn('[PDV-REGISTER-OPERATOR] payload incompleto | name:', !!name, '| pin dígitos:', sanitizedPin.length);
    return null;
  }
  const res = await httpRequest(`${buildEndpoint('pdv')}/register-operator`, {
    method: 'POST',
    body: JSON.stringify({ name, cpf: cpf || null, pin: sanitizedPin }),
  });
  console.log('[PDV-REGISTER-OPERATOR] response:', res?.operator?.id ?? 'null');
  return res?.operator || null;
}
