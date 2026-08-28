import { state } from './state.js';
import { api } from './api.js';

/* ══════════════════════════════════════════════════════
   VISUAL FIELD VALIDATION
   ══════════════════════════════════════════════════════ */

const _touched = new Map(); // fieldId → boolean

function _fieldGroup(id) {
  return document.getElementById(id)?.closest('.auth-field-group, .field-group');
}

function _ensureErrorEl(group, id) {
  let el = group.querySelector(`.auth-field-error[data-for="${id}"]`);
  if (!el) {
    el = document.createElement('p');
    el.className  = 'auth-field-error';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('data-for', id);
    el.id = `${id}Error`;
    group.appendChild(el);
  }
  return el;
}

function _setFieldState(id, state_) {
  const input = document.getElementById(id);
  const group = _fieldGroup(id);
  if (!group) return;

  group.classList.remove('is-error', 'is-valid');
  if (input) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }

  const errEl = _ensureErrorEl(group, id);
  errEl.textContent = '';

  if (state_.error) {
    group.classList.add('is-error');
    errEl.textContent = state_.error;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `${id}Error`);
    }
  } else if (state_.valid) {
    group.classList.add('is-valid');
    if (input) input.setAttribute('aria-invalid', 'false');
  }
}

function _validateField(id, value) {
  const v = String(value ?? document.getElementById(id)?.value ?? '').trim();

  switch (id) {
    case 'loginUser':
      if (!v) return 'E-mail obrigatório';
      if (!isValidEmail(v)) return 'E-mail inválido';
      return null;

    case 'loginPass':
      if (!v) return 'Senha obrigatória';
      return null;

    case 'regName':
      if (!v) return 'Nome obrigatório';
      if (v.length < 3) return 'Mínimo de 3 caracteres';
      return null;

    case 'regCompany':
      if (!v) return 'Nome da empresa obrigatório';
      if (v.length < 2) return 'Mínimo de 2 caracteres';
      return null;

    case 'regEmail':
      if (!v) return 'E-mail obrigatório';
      if (!isValidEmail(v)) return 'E-mail inválido';
      return null;

    case 'regPhone': {
      if (!v) return null; // optional — only validate format if provided
      const digits = v.replace(/\D/g, '');
      if (digits.length < 10) return 'Telefone inválido (mínimo 10 dígitos)';
      return null;
    }

    case 'regPassword':
      if (!v) return 'Senha obrigatória';
      if (!isStrongPassword(v)) return 'Mínimo 8 caracteres com maiúscula, minúscula, número e símbolo';
      return null;

    case 'regPasswordConfirm': {
      const pw = String(document.getElementById('regPassword')?.value ?? '');
      if (!v) return 'Confirmação obrigatória';
      if (v !== pw) return 'As senhas não coincidem';
      return null;
    }

    default:
      return null;
  }
}

function _touchField(id) {
  _touched.set(id, true);
  const err = _validateField(id);
  _setFieldState(id, err ? { error: err } : { valid: true });
}

function _touchAllAndValidate(ids) {
  let hasError = false;
  for (const id of ids) {
    _touched.set(id, true);
    const err = _validateField(id);
    _setFieldState(id, err ? { error: err } : { valid: true });
    if (err) hasError = true;
  }
  return hasError;
}

function _bindField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('blur', () => _touchField(id));
  el.addEventListener('input', () => {
    if (_touched.get(id)) {
      const err = _validateField(id);
      _setFieldState(id, err ? { error: err } : { valid: true });
      // Re-validate confirm when password changes
      if (id === 'regPassword' && _touched.get('regPasswordConfirm')) {
        const cErr = _validateField('regPasswordConfirm');
        _setFieldState('regPasswordConfirm', cErr ? { error: cErr } : { valid: true });
      }
    }
  });
}

function _shake(selector) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!el) return;
  el.classList.remove('auth-shake');
  void el.offsetWidth;
  el.classList.add('auth-shake');
  el.addEventListener('animationend', () => el.classList.remove('auth-shake'), { once: true });
}

export function bindLoginFieldValidation() {
  ['loginUser', 'loginPass'].forEach(_bindField);
}

export function bindRegisterFieldValidation() {
  ['regName', 'regCompany', 'regEmail', 'regPhone', 'regPassword', 'regPasswordConfirm'].forEach(_bindField);
  _bindPasswordStrength();
  _bindTermsCheckbox();
}

/* ══════════════════════════════════════════════════════
   PASSWORD STRENGTH BAR
   ══════════════════════════════════════════════════════ */

const _COMMON_PASSWORDS = [
  '12345678','123456789','password','senha123','admin123',
  'gamby123','qwerty123','111111111','iloveyou','letmein'
];

export function evaluatePasswordStrength(password, context) {
  const value      = String(password || '');
  const lower      = value.toLowerCase();
  const emailPart  = String((context && context.email) || '').split('@')[0].toLowerCase();

  const checks = {
    length:      value.length >= 8,
    upper:       /[A-Z]/.test(value),
    lower:       /[a-z]/.test(value),
    number:      /\d/.test(value),
    symbol:      /[^A-Za-z0-9]/.test(value),
    noSequence:  !/(123|234|345|456|567|678|789|abc|bcd|cde|qwerty|asdf)/i.test(value),
    notCommon:   !_COMMON_PASSWORDS.includes(lower),
    notPersonal: !(emailPart && emailPart.length > 2 && lower.includes(emailPart))
  };

  const score = Object.values(checks).filter(Boolean).length;

  if (!value) {
    return { checks, score: 0, level: 'empty', label: '', percent: 0 };
  }
  if (score <= 3) return { checks, score, level: 'weak',       label: 'Fraca',      percent: 25  };
  if (score <= 5) return { checks, score, level: 'medium',     label: 'Média',      percent: 50  };
  if (score <= 7) return { checks, score, level: 'strong',     label: 'Forte',      percent: 75  };
  return                 { checks, score, level: 'very-strong', label: 'Muito forte', percent: 100 };
}

function _updatePasswordRequirement(id, passed) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('is-ok',      !!passed);
  el.classList.toggle('is-missing', !passed);
  const icon = el.querySelector('.req-icon');
  if (icon) icon.textContent = passed ? '✓' : '•';
}

function updatePasswordStrengthUI() {
  const password = String(document.getElementById('regPassword')?.value  || '');
  const email    = String(document.getElementById('regEmail')?.value     || '');
  const result   = evaluatePasswordStrength(password, { email });

  const fill  = document.getElementById('regStrengthFill');
  const label = document.getElementById('regStrengthLabel');

  if (fill) {
    fill.className = `reg-strength-fill strength-${result.level}`;
  }
  if (label) {
    label.textContent = result.label;
    label.className   = `reg-strength-label strength-${result.level}`;
  }

  _updatePasswordRequirement('passReqLength',   result.checks.length);
  _updatePasswordRequirement('passReqUpper',    result.checks.upper);
  _updatePasswordRequirement('passReqLower',    result.checks.lower);
  _updatePasswordRequirement('passReqNumber',   result.checks.number);
  _updatePasswordRequirement('passReqSymbol',   result.checks.symbol);
  _updatePasswordRequirement('passReqSequence', result.checks.noSequence);
  _updatePasswordRequirement('passReqCommon',   result.checks.notCommon);
}

function _resetStrengthUI() {
  const fill  = document.getElementById('regStrengthFill');
  const label = document.getElementById('regStrengthLabel');
  if (fill)  { fill.className = 'reg-strength-fill strength-empty'; }
  if (label) { label.textContent = '';  label.className = 'reg-strength-label strength-empty'; }
  ['passReqLength','passReqUpper','passReqLower','passReqNumber','passReqSymbol','passReqSequence','passReqCommon'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-ok', 'is-missing');
    const icon = el.querySelector('.req-icon');
    if (icon) icon.textContent = '•';
  });
}

function _bindPasswordStrength() {
  const input = document.getElementById('regPassword');
  if (!input) return;
  // Remove previous listeners by replacing with fresh listeners (idempotent pattern)
  input.removeEventListener('input', updatePasswordStrengthUI);
  input.removeEventListener('blur',  updatePasswordStrengthUI);
  input.addEventListener('input', updatePasswordStrengthUI);
  input.addEventListener('blur',  updatePasswordStrengthUI);
  _resetStrengthUI();
}

function _bindTermsCheckbox() {
  const checkbox   = document.getElementById('regTerms');
  const termsError = document.getElementById('regTermsError');
  const termsLabel = document.getElementById('regTermsLabel');
  if (!checkbox) return;
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      termsError?.classList.add('hidden');
      termsLabel?.classList.remove('is-error');
    }
  });
}

export function resetRegisterValidationState() {
  const regFields = ['regName', 'regCompany', 'regEmail', 'regPhone', 'regPassword', 'regPasswordConfirm'];
  regFields.forEach((id) => {
    _touched.delete(id);
    const group = _fieldGroup(id);
    if (!group) return;
    group.classList.remove('is-valid', 'is-error');
    const errEl = group.querySelector(`.auth-field-error[data-for="${id}"]`);
    if (errEl) errEl.textContent = '';
  });
  _resetStrengthUI();
  document.getElementById('regTermsError')?.classList.add('hidden');
  document.getElementById('regTermsLabel')?.classList.remove('is-error');
}

/* ══════════════════════════════════════════════════════
   OAUTH — Google & Microsoft
   ══════════════════════════════════════════════════════ */

function _apiBase() {
  return (window.GAMBY_CONFIG?.apiUrl || 'https://gamby-api.onrender.com').replace(/\/$/, '');
}

export function startGoogleOAuth() {
  window.location.href = `${_apiBase()}/v1/auth/google`;
}

export function startMicrosoftOAuth() {
  window.location.href = `${_apiBase()}/v1/auth/microsoft`;
}

// Window fallbacks so inline onclick attributes and late-binding code can call these
if (typeof window !== 'undefined') {
  window.startGoogleOAuth    = startGoogleOAuth;
  window.startMicrosoftOAuth = startMicrosoftOAuth;
}

/* ══════════════════════════════════════════════════════
   SUPPORT MODAL
   ══════════════════════════════════════════════════════ */

export function openSupportModal() {
  const modal = document.getElementById('supportModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.removeAttribute('aria-hidden');
  // Focus first interactive element
  const focusTarget = modal.querySelector('a, button');
  if (focusTarget) { setTimeout(() => focusTarget.focus(), 80); }
  // Close on Escape
  modal._escHandler = (e) => { if (e.key === 'Escape') closeSupportModal(); };
  document.addEventListener('keydown', modal._escHandler);
}

export function closeSupportModal() {
  const modal = document.getElementById('supportModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (modal._escHandler) {
    document.removeEventListener('keydown', modal._escHandler);
    modal._escHandler = null;
  }
}

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
import { KEYS, load, save, remove } from './storage.js';
import {
  applyAuthenticatedLayout,
  applyLoggedOutLayout,
  setMessage,
  setStage,
  toggleRegister,
  showRegistrationActivationCard,
  hideRegistrationActivationCard
} from './ui.js';
import { updatePlanSummary } from './payments.js';
import { addDays, formatDateBR } from './utils.js';
import { saveBackendConfig } from './backend-config.js';

/* ================= HELPERS ================= */

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function planCodeFromPlanName(name = '') {
  const value = String(name || '').trim().toLowerCase();

  if (value.includes('bas')) return 'basico';
  if (value.includes('econ')) return 'economico';
  if (value.includes('pro')) return 'pro';

  return 'basico';
}

function isValidEmail(email = '') {
  const value = normalizeEmail(email);
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(value);
}

function isStrongPassword(password = '') {
  const value = String(password || '');

  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|`~]/.test(value)
  );
}

export function isDeveloperUser(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  return [
    'desenvolvedora',
    'developer',
    'admin_master',
    'developer_master',
    'platform_admin',
  ].includes(role);
}

function ensureRegistrationState() {
  if (!state.registrationData) {
    resetRegistrationState();
  }
}

function resetRegistrationState() {
  state.registrationData = {
    name: '',
    company: '',
    email: '',
    password: '',
    planName: '',
    planCode: '',
    planPrice: 0,
    trialDays: 0,
    paymentMethod: 'card',
    billingCycle: 'monthly',
    userCreated: false,
    emailVerified: false,
    planSelected: false,
    paymentCompleted: false,
    onboardingCompleted: false,
    registrationStep: 'register'
  };
}

function clearCompanyScopedLocalData(companyId) {
  const keysToRemove = [
    'gamby_products_modular',
    'gamby_sales_modular',
    'gamby_cash_session_modular',
    'gamby_payment_settings_modular',
    'gamby_internal_users_modular',
    'gamby_company_settings_modular',
    'gamby_marketplace_modular',
    'gamby_history_modular',
    'gamby_last_page',
    'gamby_current_page',
    'gamby_current_operator'
  ];

  keysToRemove.forEach((key) => {
    localStorage.removeItem(key);
  });

  // products, sales e cashSession NÃO usam a chave nua acima — são gravados com
  // sufixo '_<companyId>' (ver products.js/sales-service.js/cash-session.js
  // getScopedCashSessionKey()). Removê-los sem o sufixo era um no-op: a chave
  // real nunca era limpa no logout, então um login seguinte para a MESMA
  // empresa (mesmo com usuário diferente) herdava produtos/vendas/sessão de
  // caixa antigos do localStorage — inclusive um cache isOpen:true obsoleto
  // que fazia o fluxo login → seletor → operador → PIN pular a senha admin e
  // o modal de valor inicial (o app achava que o caixa já estava aberto).
  const scopedId = String(companyId || 'local').trim() || 'local';
  ['gamby_products_modular', 'gamby_sales_modular', 'gamby_cash_session_modular'].forEach((base) => {
    localStorage.removeItem(`${base}_${scopedId}`);
  });
}

function resetAuthenticatedState() {
  state.currentUser = null;
  state.currentCompany = null;
  state.subscription = null;

  if (state.backend) {
    state.backend.tenantId = null;
  }
}

function setTenant(user) {
  if (!user?.companyId) return;

  state.backend = state.backend || {};
  state.backend.tenantId = user.companyId;

  saveBackendConfig({ tenantId: user.companyId });
}

function saveSession(response) {
  const sessionData = {
    token: response?.token || '',
    refreshToken: response?.refreshToken || '',
    user: response?.user || null,
    company: response?.company || null,
    subscription: response?.subscription || null,
    companyId:
      response?.user?.companyId ||
      response?.company?.id ||
      null
  };

  save(KEYS.session, sessionData);
  localStorage.setItem(KEYS.session, JSON.stringify(sessionData));
  localStorage.setItem('gamby_auth_session_modular', JSON.stringify(sessionData));
  localStorage.setItem('session', JSON.stringify(sessionData));
  localStorage.setItem('gamby_session', JSON.stringify(sessionData));
}

function clearAllSessions() {
  remove(KEYS.session);
  localStorage.removeItem(KEYS.session);
  localStorage.removeItem('gamby_auth_session_modular');
  localStorage.removeItem('session');
  localStorage.removeItem('gamby_session');
}

function getSavedSession() {
  try {
    const raw =
      localStorage.getItem(KEYS.session) ||
      localStorage.getItem('gamby_auth_session_modular') ||
      localStorage.getItem('session') ||
      localStorage.getItem('gamby_session');

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getPaymentMethodFromGrid() {
  const activeOption = document.querySelector('.payment-option.active');
  const rawValue =
    activeOption?.dataset?.paymentMethod ||
    state.registrationData?.paymentMethod ||
    'card';

  const value = String(rawValue).trim().toLowerCase();

  if (value === 'cartão' || value === 'cartao' || value === 'card') return 'card';
  if (value === 'pix') return 'pix';
  if (value === 'boleto') return 'boleto';

  return 'card';
}

function getBillingCycleFromUI() {
  const activeButton = document.querySelector('[data-billing].active');
  const rawValue =
    activeButton?.dataset?.billing ||
    state.registrationData?.billingCycle ||
    'monthly';

  const value = String(rawValue).trim().toLowerCase();

  return value === 'yearly' || value === 'annual' || value === 'anual'
    ? 'yearly'
    : 'monthly';
}

export function getPendingRegistrationStep(
  user = state.currentUser,
  subscription = state.subscription
) {
  if (!user) return null;

  if (isDeveloperUser(user)) {
    return null;
  }

  const emailVerified = Boolean(user?.emailVerified);

  const planCode =
    user?.planCode ||
    user?.plan ||
    state.registrationData?.planCode ||
    subscription?.planCode ||
    '';

  const subscriptionStatus = String(
    subscription?.status || user?.subscriptionStatus || ''
  ).toLowerCase();

  const paymentCompleted =
    ['active', 'authorized', 'paid', 'trial'].includes(subscriptionStatus) ||
    Boolean(user?.paymentCompleted);

  if (!emailVerified) return 'verify';
  if (!planCode) return 'plan';
  if (!paymentCompleted) return 'payment';

  return null;
}

function syncRegistrationDataFromUser(
  user = state.currentUser,
  company = state.currentCompany,
  subscription = state.subscription
) {
  ensureRegistrationState();

  const pendingStep = getPendingRegistrationStep(user, subscription);

  state.registrationData = {
    ...(state.registrationData || {}),
    name: user?.name || state.registrationData?.name || '',
    company:
      company?.tradeName ||
      company?.name ||
      state.registrationData?.company ||
      '',
    email: user?.email || state.registrationData?.email || '',
    planCode:
      user?.planCode ||
      user?.plan ||
      subscription?.planCode ||
      state.registrationData?.planCode ||
      '',
    emailVerified: Boolean(user?.emailVerified),
    planSelected: Boolean(
      user?.planCode ||
      user?.plan ||
      subscription?.planCode ||
      state.registrationData?.planCode
    ),
    paymentCompleted: pendingStep !== 'payment',
    onboardingCompleted: pendingStep === null,
    userCreated: true,
    registrationStep: pendingStep || 'done'
  };

  return pendingStep;
}

function updateActivationProgress(step) {
  const wrap = document.getElementById('activationSummaryWrap');
  const stepPlan = document.getElementById('premiumStepPlan');
  const stepPayment = document.getElementById('premiumStepPayment');
  const stepRelease = document.getElementById('premiumStepRelease');
  const finishBtn = document.getElementById('finishRegistrationBtn');

  if (wrap) {
    wrap.classList.remove('hidden');
  }

  [stepPlan, stepPayment, stepRelease].forEach((el) => {
    el?.classList.remove('done', 'current');
  });

  if (step === 'verify') {
    if (finishBtn) {
      finishBtn.classList.add('hidden');
      finishBtn.disabled = true;
    }
    return;
  }

  if (step === 'plan') {
    stepPlan?.classList.add('current');
    if (finishBtn) {
      finishBtn.classList.add('hidden');
      finishBtn.disabled = true;
    }
    return;
  }

  if (step === 'payment') {
    stepPlan?.classList.add('done');
    stepPayment?.classList.add('current');
    if (finishBtn) {
      finishBtn.classList.add('hidden');
      finishBtn.disabled = true;
    }
    return;
  }

  if (step === 'done') {
    stepPlan?.classList.add('done');
    stepPayment?.classList.add('done');
    stepRelease?.classList.add('current');
    if (finishBtn) {
      finishBtn.disabled = false;
      finishBtn.classList.remove('hidden');
    }
  }
}

function openPendingRegistrationFlow(step) {
  ensureRegistrationState();
  state.registrationData.registrationStep = step;

  showRegistrationActivationCard();
  toggleRegister(true);
  setStage(step);
  updatePlanSummary();
  updateActivationProgress(step);
}

/* ================= BLOQUEIO DE ASSINATURA ================= */

function showBlockedScreen(message = '') {
  if (isDeveloperUser(state.currentUser)) {
    hideBlockedScreen();
    return;
  }

  const blockedScreen = document.getElementById('blockedScreen');
  const blockedReason = document.getElementById('blockedReason');

  blockedScreen?.classList.remove('hidden');

  if (blockedReason) {
    blockedReason.textContent =
      message || 'Sua assinatura está pendente de pagamento.';
  }

  applyLoggedOutLayout();
}

function hideBlockedScreen() {
  document.getElementById('blockedScreen')?.classList.add('hidden');
  hidePixContainer();
}

function setPaymentFeedback(message = '', isError = false) {
  const feedback = document.getElementById('paymentFeedback');
  if (!feedback) return;

  feedback.textContent = message;
  feedback.classList.toggle('notice-error', Boolean(isError));
}

function hidePixContainer() {
  const container = document.getElementById('pixContainer');
  if (!container) return;
  container.innerHTML = '';
}

function renderPix(data) {
  const container = document.getElementById('pixContainer');
  if (!container) return;

  const qrCodeBase64 = data?.qrCodeBase64 || '';
  const pixCopyPaste = data?.pixCopyPaste || data?.qrCode || '';

  container.innerHTML = `
    <div class="blocked-pix-box">
      <h3>Pagamento via Pix</h3>
      <p class="mini">Escaneie o QR Code ou copie o código Pix abaixo.</p>

      ${
        qrCodeBase64
          ? `
            <div class="blocked-pix-qr-wrap">
              <img
                id="blockedPixQrImage"
                src="data:image/png;base64,${_esc(qrCodeBase64)}"
                alt="QR Code Pix"
              />
            </div>
          `
          : ''
      }

      <textarea
        id="blockedPixCode"
        class="field blocked-pix-code"
        readonly
        placeholder="O código Pix aparecerá aqui"
      >${_esc(pixCopyPaste)}</textarea>

      <div class="blocked-pix-actions">
        <button id="copyPixBtn" class="btn btn-primary" type="button">
          Copiar código Pix
        </button>

        <button id="refreshBlockedPixStatusBtn" class="btn btn-ghost" type="button">
          Já paguei, verificar agora
        </button>
      </div>
    </div>
  `;

  document.getElementById('copyPixBtn')?.addEventListener('click', async () => {
    try {
      const code = document.getElementById('blockedPixCode')?.value || '';

      if (!code) {
        throw new Error('Nenhum código Pix disponível para copiar.');
      }

      await navigator.clipboard.writeText(code);
      setPaymentFeedback('Código Pix copiado com sucesso.');
    } catch (error) {
      setPaymentFeedback(error?.message || 'Erro ao copiar o código Pix.', true);
    }
  });

  document.getElementById('refreshBlockedPixStatusBtn')?.addEventListener('click', async () => {
    try {
      setPaymentFeedback('Verificando pagamento...');

      const meResponse = await api.me();

      if (meResponse?.user) {
        state.currentUser = {
          ...(state.currentUser || {}),
          ...meResponse.user
        };
      }

      if (isDeveloperUser(state.currentUser)) {
        hideBlockedScreen();
        await applyAuthenticatedLayout(state.currentUser);
        setMessage('Acesso liberado para conta desenvolvedora.');
        return;
      }

      hidePixContainer();
      hideBlockedScreen();
      await applyAuthenticatedLayout(state.currentUser);
      setMessage('Pagamento identificado com sucesso. Acesso liberado.');
    } catch (error) {
      showBlockedScreen(
        'Pagamento ainda não identificado. Se você acabou de pagar, aguarde alguns segundos e tente novamente.'
      );
      setPaymentFeedback(error?.message || 'Pagamento ainda não identificado.', true);
    }
  });
}

async function generateBlockedPayment(method) {
  const session = getSavedSession();

  const companyId =
    session?.companyId ||
    session?.user?.companyId ||
    session?.company?.id ||
    '';

  if (!session?.token || !companyId) {
    throw new Error('Sessão não encontrada. Faça login novamente.');
  }

  return api.request('/v1/mercadopago/subscription', {
    method: 'POST',
    body: JSON.stringify({
      companyId,
      paymentMethod: method,
      billingCycle: 'monthly',
      successUrl: window.location.origin
    })
  });
}

export function bindBlockedActions() {
  document.getElementById('retryPaymentBtn')?.addEventListener('click', async () => {
    try {
      hidePixContainer();
      setPaymentFeedback('Gerando cobrança no cartão...');

      const data = await generateBlockedPayment('card');
      window.open(data.checkoutUrl || data.initPoint, '_blank');

      setPaymentFeedback('Finalize o pagamento para liberar o acesso.');
    } catch (error) {
      setPaymentFeedback(error?.message || 'Erro ao tentar cobrança.', true);
    }
  });

  document.getElementById('payPixBtn')?.addEventListener('click', async () => {
    try {
      setPaymentFeedback('Gerando Pix...');
      const data = await generateBlockedPayment('pix');
      renderPix(data);
      setPaymentFeedback('Escaneie o QR Code ou copie o código Pix para pagar.');
    } catch (error) {
      setPaymentFeedback(error?.message || 'Erro ao gerar Pix.', true);
    }
  });

  document.getElementById('payBoletoBtn')?.addEventListener('click', async () => {
    try {
      hidePixContainer();
      setPaymentFeedback('Gerando boleto...');

      const data = await generateBlockedPayment('boleto');

      if (data.boletoUrl) {
        window.open(data.boletoUrl, '_blank');
      } else if (data.checkoutUrl || data.initPoint) {
        window.open(data.checkoutUrl || data.initPoint, '_blank');
      }

      setPaymentFeedback('Boleto gerado com sucesso.');
    } catch (error) {
      setPaymentFeedback(error?.message || 'Erro ao gerar boleto.', true);
    }
  });

  document.getElementById('changeCardBtn')?.addEventListener('click', async () => {
    try {
      hidePixContainer();
      setPaymentFeedback('Abrindo atualização de cartão...');

      const data = await generateBlockedPayment('card');
      window.open(data.checkoutUrl || data.initPoint, '_blank');

      setPaymentFeedback('Atualize seu cartão no checkout.');
    } catch (error) {
      setPaymentFeedback(error?.message || 'Erro ao alterar cartão.', true);
    }
  });
}

function getReadableLoginError(error) {
  const code =
    error?.data?.code ||
    error?.data?.errorCode ||
    error?.code ||
    '';

  if (code === 'subscription_payment_required') {
    return 'Pagamento pendente. Atualize sua forma de pagamento para continuar.';
  }

  if (code === 'subscription_blocked') {
    return 'Sua assinatura está bloqueada. Regularize o pagamento para continuar.';
  }

  if (code === 'email_not_verified') {
    return 'Seu e-mail ainda não foi verificado.';
  }

  return error?.message || 'Erro no login.';
}

/* ================= LOGIN ================= */

export async function login() {
  const hasError = _touchAllAndValidate(['loginUser', 'loginPass']);
  if (hasError) {
    _shake('.auth-login-card');
    return null;
  }

  const email    = normalizeEmail(document.getElementById('loginUser')?.value || '');
  const password = String(document.getElementById('loginPass')?.value || '');

  try {
    setMessage('Entrando... aguarde um momento.');
    const response = await api.login(email, password);

    if (!response?.user) {
      throw new Error('Resposta de login inválida.');
    }

    resetAuthenticatedState();

    state.currentUser = response.user;
    state.currentCompany = response.company || null;
    state.subscription = response.subscription || null;

    // Precisa rodar DEPOIS de state.currentUser ser setado: produtos/vendas/
    // sessão de caixa são cacheados com sufixo '_<companyId>' (ver
    // getScopedCashSessionKey() etc.), então limpar antes (como era feito
    // aqui) nunca tinha o companyId para montar a chave certa — virava no-op,
    // e um cache antigo (ex.: isOpen:true de uma sessão de caixa de teste
    // anterior para a mesma empresa) sobrevivia para o próximo login, fazendo
    // o fluxo login → seletor → operador → PIN pular a senha admin e o modal
    // de valor inicial por achar que o caixa já estava aberto.
    clearCompanyScopedLocalData(response.user.companyId);

    setTenant(response.user);
    saveSession(response);

    if (isDeveloperUser(response.user)) {
      hideBlockedScreen();
      hideRegistrationActivationCard();
      toggleRegister(false);
      setMessage('Login realizado com sucesso.');
      return response;
    }

    const pendingStep = syncRegistrationDataFromUser(
      state.currentUser,
      state.currentCompany,
      state.subscription
    );

    if (pendingStep) {
      hideBlockedScreen();
      openPendingRegistrationFlow(pendingStep);

      if (pendingStep === 'verify') {
        setMessage('Seu cadastro está pendente. Continue a verificação do e-mail.', true);
      } else if (pendingStep === 'plan') {
        setMessage('Seu cadastro está pendente. Escolha um plano para continuar.', true);
      } else if (pendingStep === 'payment') {
        setMessage('Seu cadastro está pendente. Finalize o pagamento para continuar.', true);
      }

      return response;
    }

    hideBlockedScreen();
    hideRegistrationActivationCard();
    toggleRegister(false);
    setMessage('Login realizado com sucesso.');
    return response;
  } catch (error) {
    const readableError = getReadableLoginError(error);

    hideBlockedScreen();
    setMessage(readableError, true);
    throw error;
  }
}

/* ================= LOGOUT ================= */

export async function logout() {
  // Capturado ANTES de resetAuthenticatedState() (abaixo) apagar state.currentUser —
  // clearCompanyScopedLocalData() precisa do companyId para montar as mesmas
  // chaves com sufixo usadas por getScopedCashSessionKey() e afins.
  const companyId = state.currentUser?.companyId || null;

  try {
    await api.logout();
  } catch (error) {
    console.warn('Erro ao deslogar no backend:', error);
  }

  resetAuthenticatedState();
  state.registrationData = null;

  clearAllSessions();
  clearCompanyScopedLocalData(companyId);
  hideBlockedScreen();
  hideRegistrationActivationCard();

  applyLoggedOutLayout();
  setMessage('Sessão encerrada.');
}

/* ================= RECUPERAÇÃO ================= */

export function forgotPassword() {
  const email = normalizeEmail(document.getElementById('loginUser')?.value || '');

  if (!email) {
    setMessage('Informe seu e-mail para recuperar a senha.', true);
    return;
  }

  if (!isValidEmail(email)) {
    setMessage('Informe um e-mail válido.', true);
    return;
  }

  api.requestPasswordReset(email)
    .then(() => {
      setMessage('Enviamos o link de redefinição para o seu e-mail.');
    })
    .catch((error) => {
      setMessage(error?.message || 'Não foi possível enviar o e-mail de recuperação.', true);
    });
}

/* ================= MODAL DE CADASTRO ================= */

export function openRegisterModal(options = {}) {
  if (!options.keepSession) {
    clearAllSessions();
    clearCompanyScopedLocalData(state.currentUser?.companyId);
    resetAuthenticatedState();
    hideBlockedScreen();
  }

  if (!state.registrationData || !options.keepSession) {
    resetRegistrationState();
  }

  resetRegisterValidationState();
  showRegistrationActivationCard();
  toggleRegister(true);

  const currentStep = state.registrationData?.registrationStep || 'register';
  setStage(currentStep);
  updatePlanSummary();
  updateActivationProgress(currentStep);
}

export function closeRegisterModal() {
  hideRegistrationActivationCard();
  toggleRegister(false);
}

/* ================= CADASTRO E VERIFICAÇÃO ================= */

export async function goToEmailVerification() {
  ensureRegistrationState();

  const regFields = ['regName', 'regCompany', 'regEmail', 'regPassword', 'regPasswordConfirm'];
  const hasError  = _touchAllAndValidate(regFields);

  // Terms checkbox
  const termsChecked = document.getElementById('regTerms')?.checked;
  const termsError   = document.getElementById('regTermsError');
  const termsLabel   = document.getElementById('regTermsLabel');
  if (!termsChecked) {
    termsError?.classList.remove('hidden');
    termsLabel?.classList.add('is-error');
    _shake('#regTermsLabel');
  } else {
    termsError?.classList.add('hidden');
    termsLabel?.classList.remove('is-error');
  }

  if (hasError || !termsChecked) {
    _shake('.reg-form-card, .reg-form-col');
    throw new Error('Corrija os campos destacados antes de continuar.');
  }

  const name    = String(document.getElementById('regName')?.value || '').trim();
  const company = String(document.getElementById('regCompany')?.value || '').trim();
  const email   = normalizeEmail(document.getElementById('regEmail')?.value || '');
  const password = String(document.getElementById('regPassword')?.value || '');
  const confirm  = String(document.getElementById('regPasswordConfirm')?.value || '');

  const planCode = state.registrationData?.planCode || '';
  const paymentMethod = getPaymentMethodFromGrid();
  const billingCycle = getBillingCycleFromUI();

  let response;

  try {
    response = await api.register({
      name,
      companyName: company,
      email,
      password,
      planCode,
      paymentMethod,
      billingCycle,
      acceptedTerms: true
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const code =
      error?.data?.code ||
      error?.data?.errorCode ||
      error?.code ||
      '';

    if (
      error?.status === 409 ||
      code === 'email_already_registered' ||
      code === 'email_conflict' ||
      message.includes('já cadastrado') ||
      message.includes('already registered') ||
      message.includes('already exists') ||
      message.includes('conflict')
    ) {
      throw new Error('Este e-mail já está cadastrado. Faça login para continuar.');
    }

    if (message.includes('email') && message.includes('verificado')) {
      throw new Error('Seu e-mail ainda não foi verificado.');
    }

    throw new Error(error?.message || 'Não foi possível concluir o cadastro.');
  }

  state.registrationData.name = name;
  state.registrationData.company = company;
  state.registrationData.email = email;
  state.registrationData.password = password;
  state.registrationData.planCode = planCode;
  state.registrationData.paymentMethod = paymentMethod;
  state.registrationData.billingCycle = billingCycle;
  state.registrationData.userCreated = Boolean(response?.verificationRequired ?? true);
  state.registrationData.registrationStep = 'verify';

  const verifyEmailDisplay = document.getElementById('verifyEmailDisplay');
  if (verifyEmailDisplay) {
    verifyEmailDisplay.value = email;
  }

  setStage('verify');
  updateActivationProgress('verify');
}

export async function resendVerificationCode() {
  ensureRegistrationState();

  const email = normalizeEmail(state.registrationData?.email || '');

  if (!email) {
    throw new Error('E-mail não encontrado para reenvio.');
  }

  await api.resendCode(email);
  setMessage('Código reenviado com sucesso.');
}

export async function confirmEmailVerification() {
  ensureRegistrationState();

  const email = normalizeEmail(state.registrationData?.email || '');
  const code = String(document.getElementById('verificationCode')?.value || '').trim();

  if (!email) {
    throw new Error('E-mail não encontrado.');
  }

  if (!code) {
    throw new Error('Digite o código de verificação.');
  }

  const response = await api.verifyEmail(email, code);

  if (!response?.verified) {
    throw new Error('Código inválido.');
  }

  state.registrationData.emailVerified = true;
  state.registrationData.registrationStep = 'plan';

  clearAllSessions();
  clearCompanyScopedLocalData(state.currentUser?.companyId);
  resetAuthenticatedState();

  setStage('plan');
  updateActivationProgress('plan');
  setMessage('E-mail confirmado com sucesso. Agora escolha o plano ideal para continuar.');
}

/* ================= PLANOS ================= */

export function selectPlan(planName, planPrice, trialDays) {
  ensureRegistrationState();

  state.registrationData.planName = String(planName || '');
  state.registrationData.planCode = planCodeFromPlanName(planName);
  state.registrationData.planPrice = Number(planPrice || 0);
  state.registrationData.trialDays = Number(trialDays || 0);
  state.registrationData.billingCycle = getBillingCycleFromUI();
  state.registrationData.paymentMethod = 'card';
  state.registrationData.planSelected = true;
  state.registrationData.registrationStep = 'payment';

  updatePlanSummary();
  updateActivationProgress('payment');
  setStage('payment');
}

/* ================= FINALIZAÇÃO ================= */

async function authenticateRegisteredUserForCheckout() {
  const email = normalizeEmail(state.registrationData?.email || '');
  const password = String(state.registrationData?.password || '');

  if (!email || !password) {
    throw new Error('Credenciais do cadastro não encontradas.');
  }

  clearAllSessions();
  clearCompanyScopedLocalData(state.currentUser?.companyId);
  resetAuthenticatedState();

  const response = await api.login(email, password);

  if (!response?.user) {
    throw new Error('Não foi possível autenticar o usuário após a verificação.');
  }

  state.currentUser = response.user;
  state.currentCompany = response.company || null;
  state.subscription = response.subscription || null;

  // Empresa recém-conhecida após o login acima — limpar de novo com o
  // companyId correto (a chamada logo antes só tinha o companyId de uma
  // sessão anterior, se houvesse, não o desta conta recém-autenticada).
  clearCompanyScopedLocalData(response.user.companyId);

  setTenant(response.user);
  saveSession(response);
  hideBlockedScreen();
}

export async function finishRegistration() {
  ensureRegistrationState();

  if (!state.registrationData.userCreated) {
    throw new Error('Faça o cadastro primeiro.');
  }

  if (!state.registrationData.emailVerified) {
    throw new Error('Verifique o e-mail primeiro.');
  }

  if (!state.registrationData.planCode) {
    throw new Error('Escolha um plano.');
  }

  if (!state.registrationData.paymentCompleted) {
    throw new Error('Finalize a etapa de pagamento antes de concluir o cadastro.');
  }

  const currentSession = getSavedSession();

  if (!currentSession?.token || !currentSession?.user) {
    await authenticateRegisteredUserForCheckout();
  }

  const trialEndsAt = addDays(new Date(), state.registrationData.trialDays || 0);

  state.registrationData.onboardingCompleted = true;
  state.registrationData.registrationStep = 'done';

  updateActivationProgress('done');
  closeRegisterModal();

  setMessage(`Cadastro concluído. Teste grátis até ${formatDateBR(trialEndsAt)}.`);
}

/* ================= RESET DE SENHA ================= */

export async function completePasswordReset(token, password) {
  if (!token) {
    throw new Error('Token de recuperação não informado.');
  }

  if (!isStrongPassword(password)) {
    throw new Error('A nova senha deve ter no mínimo 8 caracteres, com maiúscula, minúscula, número e caractere especial.');
  }

  const response = await api.confirmPasswordReset(token, password);

  if (!response?.success) {
    throw new Error(response?.message || 'Não foi possível redefinir a senha.');
  }

  return response;
}

/* ================= OAUTH CALLBACK HANDLER ================= */

async function _handleOAuthCallbackIfPresent() {
  const params      = new URLSearchParams(window.location.search);
  const oauthToken  = params.get('oauth_token');
  const oauthRefresh = params.get('oauth_refresh');
  const oauthError  = params.get('oauth_error');

  if (!oauthToken && !oauthError) return; // not an OAuth callback

  history.replaceState({}, document.title, window.location.pathname);

  if (oauthError) {
    const messages = {
      access_denied: 'Autenticação cancelada.',
      invalid_state: 'Erro de segurança na autenticação. Tente novamente.',
      no_email: 'O provedor não forneceu um e-mail verificado.',
      token_exchange_failed: 'Falha ao obter token do provedor. Tente novamente.',
      server_error: 'Erro interno durante autenticação social.',
      account_disabled: 'Conta desativada. Entre em contato com o suporte.'
    };
    setMessage(messages[oauthError] || 'Erro na autenticação social. Tente novamente.', true);
    return;
  }

  if (oauthToken) {
    saveSession({
      token: oauthToken,
      refreshToken: oauthRefresh || '',
      user: null,
      company: null,
      subscription: null,
      companyId: null
    });
    setMessage('Autenticado com sucesso. Carregando...');
  }
}

/* ================= RESTORE SESSION ================= */

export async function tryRestoreSession() {
  await _handleOAuthCallbackIfPresent();

  try {
    const session = getSavedSession();

    if (!session) return false;

    if (!session?.token || !session?.user) {
      clearAllSessions();
      resetAuthenticatedState();
      return false;
    }

    resetAuthenticatedState();

    state.currentUser = session.user;
    state.currentCompany = session.company || null;
    state.subscription = session.subscription || null;

    setTenant(session.user);

    const meResponse = await api.me();

    if (!meResponse?.user) {
      throw new Error('Sessão inválida.');
    }

    state.currentUser = {
      ...session.user,
      ...meResponse.user
    };

    state.currentCompany =
      meResponse.company ||
      session.company ||
      null;

    state.subscription =
      meResponse.subscription ||
      session.subscription ||
      null;

    saveSession({
      token: session.token,
      refreshToken: session.refreshToken,
      user: state.currentUser,
      company: state.currentCompany,
      subscription: state.subscription
    });

    if (isDeveloperUser(state.currentUser)) {
      hideBlockedScreen();
      hideRegistrationActivationCard();
      toggleRegister(false);
      return true;
    }

    const pendingStep = syncRegistrationDataFromUser(
      state.currentUser,
      state.currentCompany,
      state.subscription
    );

    if (pendingStep) {
      hideBlockedScreen();
      openPendingRegistrationFlow(pendingStep);

      if (pendingStep === 'verify') {
        setMessage('Seu cadastro está pendente. Continue a verificação do e-mail.', true);
      } else if (pendingStep === 'plan') {
        setMessage('Seu cadastro está pendente. Escolha um plano para continuar.', true);
      } else if (pendingStep === 'payment') {
        setMessage('Seu cadastro está pendente. Finalize o pagamento para continuar.', true);
      }

      return false;
    }

    hideBlockedScreen();
    hideRegistrationActivationCard();
    toggleRegister(false);
    return true;
  } catch (error) {
    console.warn('Sessão inválida:', error);

    const isInvalidToken =
      error?.status === 401 ||
      String(error?.message || '').toLowerCase().includes('token inválido') ||
      String(error?.message || '').toLowerCase().includes('token expired') ||
      String(error?.message || '').toLowerCase().includes('jwt');

    clearAllSessions();
    resetAuthenticatedState();
    hideBlockedScreen();
    hideRegistrationActivationCard();
    applyLoggedOutLayout();

    if (isInvalidToken) {
      setMessage('Sua sessão expirou. Faça login novamente.', true);
      return false;
    }

    setMessage('Não foi possível restaurar sua sessão. Faça login novamente.', true);
    return false;
  }
}

/* ================= FECHAMENTO DE CAIXA / AUTORIZAÇÃO ================= */

export async function validateCashClosurePassword(password, actionType = 'cash_close') {
  const typedPassword = String(password || '').trim();

  if (!typedPassword) {
    throw new Error('Senha não informada.');
  }

  try {
    const response = await api.authorizeAction({
      password: typedPassword,
      actionType
    });

    if (!response?.authorized) {
      throw new Error('Senha inválida ou sem permissão.');
    }

    return response;
  } catch (err) {
    // Erro de conectividade (backend inacessível ou timeout):
    // NÃO fazer fallback local — exigir que o backend esteja acessível.
    // Falhas de autorização nunca devem recorrer a credenciais locais.
    const isConnectivityError =
      err?.code === 'backend_unreachable' ||
      err?.code === 'request_timeout' ||
      String(err?.message || '').toLowerCase().includes('failed to fetch') ||
      String(err?.message || '').toLowerCase().includes('network') ||
      String(err?.message || '').toLowerCase().includes('conectar ao backend');

    if (isConnectivityError) {
      throw new Error(
        'Não foi possível verificar a autorização. Verifique a conexão com o servidor antes de continuar.'
      );
    }

    // Authorization is backend-authoritative; never fall back to local credentials.
    throw err;
  }
}