import { state } from './state.js';
import { KEYS, load, save, remove } from './storage.js';
import { authenticateUser, registerUser, requestVerificationCode, verifyEmailCode } from './services/auth-service.js';
import { applyAuthenticatedLayout, applyLoggedOutLayout, setMessage, setStage, toggleRegister } from './ui.js';
import { updatePlanSummary } from './payments.js';
import { addDays, formatDateBR, normalizeString } from './utils.js';
import { DEFAULT_INTERNAL_USERS } from './state.js';
import { validateAccess } from './access-control.js';
import { saveBackendConfig } from './backend-config.js';

function getAuthUsers() {
  return load(KEYS.authUsers, []);
}

function resetRegistrationState() {
  state.registrationData = {
    planName: 'Básico',
    planPrice: 39.90,
    trialDays: 15,
    paymentMethod: 'Cartão'
  };
}

export function tryRestoreSession() {
  const session = load(KEYS.session, null);
  if (!session) return false;
  const hasInternal = (state.internalUsers || DEFAULT_INTERNAL_USERS).some((u) => u.username === session.username && u.role === session.role);
  const hasAuth = getAuthUsers().some((u) => u.email === session.username);
  const hasBackendSession = Boolean(session.token && (session.companyId || session.role === 'desenvolvedora'));
  if (!hasInternal && !hasAuth && !hasBackendSession) {
    remove(KEYS.session);
    return false;
  }
  const access = validateAccess(session, state.development);
  if (!access.ok) {
    remove(KEYS.session);
    return false;
  }
  state.currentUser = access.user;
  if (access.user.companyId) state.backend.tenantId = access.user.companyId;
  applyAuthenticatedLayout(access.user);
  return true;
}

export async function login() {
  const loginValue = normalizeString(document.getElementById('loginUser')?.value || document.getElementById('loginEmail')?.value);
  const password = document.getElementById('loginPass')?.value || document.getElementById('loginPassword')?.value || '';
  try {
    const user = await authenticateUser(loginValue, password);
    if (!user) {
      setMessage('Login não encontrado. Verifique os dados ou faça o cadastro.', true);
      return;
    }
    const access = validateAccess(user, state.development);
    if (!access.ok) {
      state.currentUser = null;
      setMessage(access.message, true);
      return false;
    }
    state.currentUser = access.user;
    if (state.currentUser.companyId) {
      state.backend.tenantId = state.currentUser.companyId;
      saveBackendConfig({ tenantId: state.currentUser.companyId });
    }
    save(KEYS.session, state.currentUser);
    applyAuthenticatedLayout(state.currentUser);
    setMessage(`Acesso liberado para ${state.currentUser.username}.`);
    return true;
  } catch (error) {
    setMessage(error.message || 'Falha ao autenticar.', true);
    return false;
  }
}

export function logout() {
  state.currentUser = null;
  remove(KEYS.session);
  applyLoggedOutLayout();
}

export function openRegisterModal() {
  toggleRegister(true);
  setStage('register');
  updatePlanSummary();
}

export function closeRegisterModal() {
  toggleRegister(false);
}

export function goToEmailVerification() {
  const name = normalizeString(document.getElementById('regName')?.value);
  const company = normalizeString(document.getElementById('regCompany')?.value);
  const email = normalizeString(document.getElementById('regEmail')?.value);
  const phone = normalizeString(document.getElementById('regPhone')?.value);
  const password = document.getElementById('regPassword')?.value || '';
  const confirm = document.getElementById('regPasswordConfirm')?.value || '';

  if (!name || !company || !email || !password || !confirm) {
    alert('Preencha os campos principais para continuar.');
    return;
  }
  if (password !== confirm) {
    alert('As senhas não coincidem.');
    return;
  }

  state.registrationData = {
    ...state.registrationData,
    name,
    company,
    email,
    phone,
    password,
    verificationCode: '123456'
  };
  document.getElementById('verifyEmailDisplay').value = email;
  setStage('verify');
}

export async function resendVerificationCode() {
  try {
    const response = await requestVerificationCode(state.registrationData.email || normalizeString(document.getElementById('verifyEmailDisplay')?.value));
    alert(response?.message || 'Código reenviado.');
  } catch (error) {
    alert(error.message || 'Falha ao reenviar código.');
  }
}

export async function confirmEmailVerification() {
  const email = normalizeString(document.getElementById('verifyEmailDisplay')?.value);
  const code = normalizeString(document.getElementById('verificationCode')?.value);
  if (!code) {
    alert('Digite o código de verificação.');
    return;
  }
  try {
    await verifyEmailCode(email, code);
    setStage('plan');
  } catch (error) {
    alert(error.message || 'Falha ao validar e-mail.');
  }
}

export function selectPlan(planName, planPrice, trialDays) {
  state.registrationData.planName = planName;
  state.registrationData.planPrice = Number(planPrice);
  state.registrationData.trialDays = Number(trialDays);
  updatePlanSummary();
  setStage('payment');
}

export async function finishRegistration() {
  try {
    const createdAt = new Date().toISOString();
    const trialEndsAt = addDays(new Date(), state.registrationData.trialDays).toISOString();
    await registerUser({
      name: state.registrationData.name,
      company: state.registrationData.company,
      email: state.registrationData.email,
      phone: state.registrationData.phone,
      password: state.registrationData.password,
      planName: state.registrationData.planName,
      planPrice: state.registrationData.planPrice,
      trialDays: state.registrationData.trialDays,
      paymentMethod: state.registrationData.paymentMethod,
      createdAt,
      trialEndsAt
    }, {
      cardHolder: normalizeString(document.getElementById('cardHolder')?.value)
    });
    const loginUser = document.getElementById('loginUser') || document.getElementById('loginEmail');
    const loginPass = document.getElementById('loginPass') || document.getElementById('loginPassword');
    if (loginUser) loginUser.value = state.registrationData.email;
    if (loginPass) loginPass.value = state.registrationData.password;
    setMessage(`Cadastro concluído com sucesso para ${state.registrationData.company}. Teste grátis até ${formatDateBR(trialEndsAt)}.`);
    closeRegisterModal();
    resetRegistrationState();
  } catch (error) {
    alert(error.message || 'Falha ao concluir cadastro.');
  }
}
