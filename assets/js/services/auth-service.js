import { DEFAULT_INTERNAL_USERS, state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
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
  const localDeveloper = DEFAULT_INTERNAL_USERS.find((user) => user.username === loginValue && user.password === password && user.role === 'desenvolvedora');
  if (state.development?.enabled && state.development?.allowLocalDeveloperLogin && localDeveloper) {
    return { username: localDeveloper.username, role: 'desenvolvedora', authenticationSource: 'local-development' };
  }

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
      tenant: payload.tenant,
      subscription: payload.company?.subscription || payload.subscription,
      subscriptionStatus: payload.company?.subscription?.status || payload.subscription?.status || payload.subscriptionStatus || '',
      permissions: payload.user?.permissions || payload.permissions,
      allowedPages: payload.user?.allowedPages || payload.allowedPages || (Array.isArray(payload.user?.permissions) ? payload.user.permissions : undefined),
      token: payload.token,
      refreshToken: payload.refreshToken,
      authenticationSource: 'backend'
    };
    return session;
  }

  const authUser = getLocalAuthUsers().find((u) => u.email === loginValue && u.password === password);
  const internalUser = (state.internalUsers || []).find((u) => u.username === loginValue && u.password === password);
  return authUser ? {
    username: authUser.email,
    email: authUser.email,
    role: authUser.role || 'administrador',
    company: authUser.company,
    companyId: authUser.companyId || `local-company-${authUser.id}`,
    subscriptionStatus: authUser.subscriptionStatus || 'trial',
    authenticationSource: 'local'
  } : internalUser ? { ...internalUser, password: undefined, authenticationSource: 'local' } : null;
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
  const id = Date.now();
  const user = { id, ...registrationData, ...paymentPayload, role: 'administrador', companyId: `local-company-${id}`, subscriptionStatus: 'trial' };
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
