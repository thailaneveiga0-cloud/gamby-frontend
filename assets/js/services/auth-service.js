import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import {
  buildEndpoint,
  isBackendReady,
  saveBackendConfig
} from '../backend-config.js';
import { httpRequest } from '../http.js';

function getLocalAuthUsers() {
  return load(KEYS.authUsers, []);
}

function saveLocalAuthUsers(users) {
  save(KEYS.authUsers, users);
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function planCodeFromName(name = '') {
  const value = String(name).toLowerCase();

  if (value.includes('bas')) return 'basico';
  if (value.includes('econ')) return 'economico';
  if (value.includes('pro')) return 'pro';

  return 'basico';
}

function planNameFromCode(code = '') {
  const value = String(code).toLowerCase();

  if (value === 'basico') return 'Básico';
  if (value === 'economico') return 'Econômico';
  if (value === 'pro') return 'Pró';

  return 'Básico';
}

function paymentMethodCode(value = '') {
  const map = {
    cartao: 'card',
    cartão: 'card',
    pix: 'pix',
    boleto: 'boleto',
    dinheiro: 'cash',
    card: 'card',
    cash: 'cash'
  };

  return map[String(value).toLowerCase()] || 'card';
}

export async function authenticateUser(loginValue, password) {
  const normalizedLogin = normalizeEmail(loginValue);

  if (isBackendReady()) {
    const payload = await httpRequest(buildEndpoint('auth', 'login'), {
      method: 'POST',
      body: JSON.stringify({
        email: normalizedLogin,
        password
      })
    });

    if (!payload || !payload.token) {
      throw new Error('Erro no login.');
    }

    const user = payload.user || {};
    const company = payload.company || {};
    const planCode = user.planCode || 'basico';

    const session = {
      id: user.id || '',
      username: user.email || normalizedLogin,
      email: user.email || normalizedLogin,
      displayName: user.name || normalizedLogin,
      role: user.role || 'administrador',
      company: company.tradeName || '',
      companyId: company.id || user.companyId || '',
      token: payload.token,
      refreshToken: payload.refreshToken || '',
      plan: planCode,
      planCode,
      planName: user.planName || planNameFromCode(planCode)
    };

    if (!session.companyId) {
      throw new Error('Erro no login.');
    }

    state.currentUser = session;
    state.backend = state.backend || {};
    state.backend.tenantId = session.companyId;

    saveBackendConfig({ tenantId: session.companyId });

    return session;
  }

  const users = getLocalAuthUsers();

  const authUser = users.find(
    (u) => normalizeEmail(u.email) === normalizedLogin && u.password === password
  );

  if (authUser) {
    if (!authUser.emailVerified) {
      throw new Error('Conta não verificada.');
    }

    const planCode = authUser.planCode || 'basico';

    return {
      id: authUser.id,
      username: authUser.email,
      email: authUser.email,
      displayName: authUser.name || authUser.email,
      role: 'administrador',
      company: authUser.company || '',
      companyId: authUser.companyId || '',
      token: '',
      refreshToken: '',
      plan: planCode,
      planCode,
      planName: authUser.planName || planNameFromCode(planCode)
    };
  }

  throw new Error('E-mail ou senha inválidos.');
}

export async function registerUser(data) {
  const email = normalizeEmail(data.email);
  const users = getLocalAuthUsers();

  const existing = users.find((u) => normalizeEmail(u.email) === email);

  const planCode = data.planCode || planCodeFromName(data.planName);

  if (existing) {
    if (existing.emailVerified) {
      throw new Error('E-mail já cadastrado.');
    }

    existing.verificationCode = '123456';
    existing.planCode = planCode;

    saveLocalAuthUsers(users);

    return { pending: true };
  }

  const newUser = {
    id: Date.now(),
    name: data.name,
    email,
    password: data.password,
    company: data.companyName,
    planCode,
    planName: data.planName || planNameFromCode(planCode),
    emailVerified: false,
    verificationCode: '123456'
  };

  users.push(newUser);
  saveLocalAuthUsers(users);

  return { created: true };
}

export async function requestVerificationCode(email) {
  const users = getLocalAuthUsers();
  const user = users.find((u) => normalizeEmail(u.email) === normalizeEmail(email));

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  user.verificationCode = '123456';
  saveLocalAuthUsers(users);

  return { sent: true };
}

export async function verifyEmailCode(email, code) {
  const users = getLocalAuthUsers();
  const user = users.find((u) => normalizeEmail(u.email) === normalizeEmail(email));

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  if (String(code) !== String(user.verificationCode)) {
    throw new Error('Código inválido.');
  }

  user.emailVerified = true;
  user.verificationCode = null;

  saveLocalAuthUsers(users);

  return { verified: true };
}