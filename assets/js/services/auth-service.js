import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady, saveBackendConfig } from '../backend-config.js';
import { httpRequest } from '../http.js';

function getLocalAuthUsers() { return load(KEYS.authUsers, []); }
function saveLocalAuthUsers(users) { save(KEYS.authUsers, users); }

function planCodeFromName(name = '') {
  const value = String(name).toLowerCase();
  if (value.includes('econ')) return 'economico';
  if (value.includes('pró') || value.includes('pro')) return 'pro';
  return 'basico';
}

function paymentMethodCode(value = '') {
  const map = { 'cartão': 'card', 'cartao': 'card', 'pix': 'pix', 'boleto': 'boleto', 'dinheiro': 'cash' };
  return map[String(value).toLowerCase()] || 'card';
}

export async function authenticateUser(loginValue, password) {
  if (isBackendReady()) {
    const payload = await httpRequest(buildEndpoint('auth', 'login'), {
      method: 'POST',
      body: JSON.stringify({ email: loginValue, password })
    });

    const session = {
      username: payload.user?.email || loginValue,
      email: payload.user?.email || loginValue,
      displayName: payload.user?.name || loginValue,
      role: payload.user?.role || 'administrador',
      company: payload.company?.tradeName || '',
      companyId: payload.company?.id || payload.user?.companyId || '',
      token: payload.token,
      refreshToken: payload.refreshToken
    };

    state.currentUser = session;
    if (session.companyId) {
      state.backend.tenantId = session.companyId;
      saveBackendConfig({ tenantId: session.companyId });
    }
    return session;
  }

  const authUser = getLocalAuthUsers().find((u) => u.email === loginValue && u.password === password);
  const internalUser = (state.internalUsers || []).find((u) => u.username === loginValue && u.password === password);
  return authUser ? { username: authUser.email, email: authUser.email, role: 'administrador', company: authUser.company, companyId: authUser.companyId || '' } : internalUser ? { username: internalUser.username, role: internalUser.role } : null;
}

export async function registerUser(registrationData, paymentPayload = {}) {
  if (isBackendReady()) {
    return httpRequest(buildEndpoint('auth', 'register'), {
      method: 'POST',
      body: JSON.stringify({
        name: registrationData.name,
        companyName: registrationData.company,
        email: registrationData.email,
        phone: registrationData.phone,
        password: registrationData.password,
        planCode: planCodeFromName(registrationData.planName),
        paymentMethod: paymentMethodCode(registrationData.paymentMethod),
        payment: paymentPayload
      })
    });
  }
  const users = getLocalAuthUsers();
  if (users.find((u) => u.email === registrationData.email)) throw new Error('Já existe um cadastro com esse e-mail.');
  const user = { id: Date.now(), ...registrationData, ...paymentPayload };
  users.push(user);
  saveLocalAuthUsers(users);
  return user;
}

export async function requestVerificationCode(email) {
  if (isBackendReady()) return httpRequest(buildEndpoint('auth', 'resend-verification'), { method: 'POST', body: JSON.stringify({ email }) });
  return { message: 'Código reenviado na demonstração.' };
}

export async function verifyEmailCode(email, code) {
  if (isBackendReady()) return httpRequest(buildEndpoint('auth', 'verify-email'), { method: 'POST', body: JSON.stringify({ email, code }) });
  return { verified: true };
}
