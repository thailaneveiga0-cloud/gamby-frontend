import { state, DEFAULT_INTERNAL_USERS } from './state.js';
import { getRoleLabel } from './roles.js';
import { setMessage } from './ui.js';
import {
  listUsersService,
  createUserService,
  deleteUserService,
  updateUserService
} from './services/user-service.js';
import { setOperatorPinService } from './services/pin-service.js';
import { getUserCentralSnapshot, getLastAccesses } from './user-stats.js';
import { getUserAvatar } from './avatar-utils.js';
import { evaluatePasswordStrength } from './auth.js';

const INTERNAL_USERS_KEY = 'internalUsers';
let editingUserId        = null;
let _pendingNewUserPhoto = null;       // base64 set during create form
let _pendingEditUserPhoto = undefined; // undefined=unchanged, null=remove, str=new photo

/* ================= HELPERS ================= */

function generateId() {
  if (globalThis?.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCPF(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function maskCPF(value = '') {
  const cpf = normalizeCPF(value);

  if (cpf.length !== 11) return value || '';

  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}`;
}

function buildControlPasswordFromCPF(cpf = '') {
  const cleanCpf = normalizeCPF(cpf);
  if (cleanCpf.length < 4) return '';
  return cleanCpf.slice(-4);
}

function roleCanHaveControlPassword(role = '') {
  const normalized = String(role || '').trim().toLowerCase();
  return ['gerente', 'administrador', 'desenvolvedora', 'operador'].includes(normalized);
}

function getNormalizedEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value = '') {
  const email = getNormalizedEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidCPF(cpf = '') {
  const value = normalizeCPF(cpf);

  if (!value || value.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(value)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(value[i]) * (10 - i);
  }

  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== Number(value[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(value[i]) * (11 - i);
  }

  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;

  return remainder === Number(value[10]);
}

function normalizeRole(value = '') {
  const role = String(value || '').trim().toLowerCase();

  if (role === 'desenvolvedora') return 'desenvolvedora';
  if (role === 'developer_master') return 'desenvolvedora';
  if (role === 'administrador') return 'administrador';
  if (role === 'gerente') return 'gerente';
  return 'operador';
}

function escapeHtml(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getCurrentUserLogin() {
  return getNormalizedEmail(
    state?.currentUser?.email || state?.currentUser?.username || ''
  );
}

function getCurrentUserId() {
  return String(state?.currentUser?.id || '').trim();
}

function canManageUsers() {
  const role = String(state?.currentUser?.role || '').trim().toLowerCase();
  return role === 'desenvolvedora' || role === 'developer_master' || role === 'administrador';
}

function canEditOrDeactivateTargetUser(target) {
  const currentRole = String(state?.currentUser?.role || '').trim().toLowerCase();
  const targetRole = String(target?.role || '').trim().toLowerCase();

  if (!['desenvolvedora', 'developer_master', 'administrador'].includes(currentRole)) {
    return false;
  }

  if (targetRole === 'desenvolvedora' && currentRole !== 'desenvolvedora') {
    return false;
  }

  return true;
}

function isBackendUnavailableError(error) {
  const code = String(error?.code || '').toLowerCase();
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();

  if (status >= 500) return true;
  if (code === 'backend_unreachable') return true;
  if (code === 'request_timeout') return true;
  if (message.includes('backend indisponível')) return true;
  if (message.includes('não foi possível conectar ao backend')) return true;
  if (message.includes('failed to fetch')) return true;
  if (message.includes('networkerror')) return true;

  return false;
}

/* ================= FORMULÁRIO DE CADASTRO: ERRO INLINE ================= */

// Traduções best-effort para mensagens padrão do Zod (details[i].issue vêm em inglês
// quando não há required_error customizado no schema do backend).
const _VALIDATION_ISSUE_TRANSLATIONS = [
  [/^required$/i,                        'Campo obrigatório.'],
  [/^invalid email$/i,                   'E-mail inválido.'],
  [/unrecognized key/i,                  'A requisição contém um campo não suportado pelo servidor.'],
  [/invalid enum value/i,                'Valor inválido para o campo.'],
  [/string must contain at least (\d+) character/i, (m) => `Deve ter no mínimo ${m[1]} caracteres.`],
  [/string must contain at most (\d+) character/i,  (m) => `Deve ter no máximo ${m[1]} caracteres.`],
];

function _translateValidationIssue(issue) {
  const value = String(issue || '').trim();
  if (!value) return 'Dados inválidos. Verifique os campos.';

  for (const [pattern, replacement] of _VALIDATION_ISSUE_TRANSLATIONS) {
    const match = value.match(pattern);
    if (match) return typeof replacement === 'function' ? replacement(match) : replacement;
  }

  return value;
}

function _setCreateUserError(message) {
  const box = document.getElementById('createUserStatus');
  if (!box) return;

  if (!message) {
    box.textContent = '';
    box.classList.add('hidden');
    return;
  }

  box.textContent = message;
  box.classList.remove('hidden');
}

function _describeCreateUserError(error) {
  const status = Number(error?.status || 0);

  if (status === 422) {
    const issue = error?.payload?.details?.[0]?.issue;
    return issue ? _translateValidationIssue(issue) : 'Dados inválidos. Verifique os campos.';
  }

  if (status === 403) {
    return error?.message || 'Você não tem permissão para cadastrar usuários.';
  }

  if (status === 409) {
    const code = String(error?.payload?.error || '').toLowerCase();
    if (code === 'cpf_conflict')   return 'CPF já cadastrado no sistema.';
    if (code === 'email_conflict') return 'E-mail já está em uso.';
    return error?.message || 'Este e-mail ou CPF já está em uso.';
  }

  return error?.message || 'Erro ao cadastrar usuário. Tente novamente.';
}

/* ================= FORMULÁRIO DE CADASTRO: FORÇA DA SENHA ================= */

function _toggleNewUserPasswordRequirement(id, passed) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('is-ok', !!passed);
  el.classList.toggle('is-missing', !passed);
  const icon = el.querySelector('.req-icon');
  if (icon) icon.textContent = passed ? '✓' : '•';
}

function _resetNewUserPasswordStrength() {
  const wrap = document.getElementById('newUserPassStrength');
  if (wrap) wrap.className = 'uc-pass-strength hidden';

  const label = document.getElementById('newUserStrengthLabel');
  if (label) label.textContent = '';

  ['newUserReqLength', 'newUserReqCase', 'newUserReqNumber', 'newUserReqSymbol'].forEach((id) => {
    _toggleNewUserPasswordRequirement(id, false);
  });
}

function updateNewUserPasswordStrength() {
  const password = document.getElementById('newInternalPassword')?.value || '';
  const email = document.getElementById('newInternalEmail')?.value || '';
  const wrap = document.getElementById('newUserPassStrength');

  if (!password) {
    _resetNewUserPasswordStrength();
    return;
  }

  const result = evaluatePasswordStrength(password, { email });

  if (wrap) wrap.className = `uc-pass-strength level-${result.level}`;

  const label = document.getElementById('newUserStrengthLabel');
  if (label) label.textContent = `Senha ${result.label.toLowerCase()}`;

  _toggleNewUserPasswordRequirement('newUserReqLength', result.checks.length);
  _toggleNewUserPasswordRequirement('newUserReqCase',   result.checks.upper && result.checks.lower);
  _toggleNewUserPasswordRequirement('newUserReqNumber', result.checks.number);
  _toggleNewUserPasswordRequirement('newUserReqSymbol', result.checks.symbol);
}

function getLocalUsers() {
  try {
    const raw = localStorage.getItem(INTERNAL_USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : DEFAULT_INTERNAL_USERS;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Erro ao ler usuários locais:', error);
    return Array.isArray(DEFAULT_INTERNAL_USERS) ? DEFAULT_INTERNAL_USERS : [];
  }
}

function persistLocalUsers() {
  try {
    localStorage.setItem(
      INTERNAL_USERS_KEY,
      JSON.stringify(Array.isArray(state.internalUsers) ? state.internalUsers : [])
    );
  } catch (error) {
    console.error('Erro ao salvar usuários locais:', error);
  }
}

function mapBackendUserToInternalUser(user) {
  const normalizedRole = normalizeRole(user?.role);
  const rawCpf = normalizeCPF(user?.cpf || '');

  return {
    id: user?.id ?? generateId(),
    companyId: user?.companyId ?? null,
    name: user?.name || user?.email || '',
    username: user?.email || '',
    email: user?.email || '',
    password: '••••••',
    controlPassword: roleCanHaveControlPassword(normalizedRole)
      ? (user?.controlPin || buildControlPasswordFromCPF(rawCpf))
      : '',
    controlPin: roleCanHaveControlPassword(normalizedRole)
      ? (user?.controlPin || buildControlPasswordFromCPF(rawCpf))
      : '',
    cpf: rawCpf,
    cpfMasked: user?.cpf || (rawCpf ? maskCPF(rawCpf) : ''),
    role: normalizedRole,
    photoUrl: user?.photoUrl || null,
    isActive: user?.isActive ?? true,
    emailVerified: user?.emailVerified ?? false,
    createdAt: user?.createdAt ?? new Date().toISOString(),
    updatedAt: user?.updatedAt ?? new Date().toISOString()
  };
}

function mapLocalUser(user) {
  const normalizedRole = normalizeRole(user?.role);
  const rawCpf = normalizeCPF(user?.cpf || '');

  return {
    id: user?.id ?? generateId(),
    companyId: user?.companyId ?? null,
    name: user?.name || user?.username || user?.email || '',
    username: user?.username || user?.email || '',
    email: user?.email || user?.username || '',
    password: user?.password || '••••••',
    controlPassword: roleCanHaveControlPassword(normalizedRole)
      ? (user?.controlPassword || user?.controlPin || buildControlPasswordFromCPF(rawCpf))
      : '',
    controlPin: roleCanHaveControlPassword(normalizedRole)
      ? (user?.controlPin || user?.controlPassword || buildControlPasswordFromCPF(rawCpf))
      : '',
    cpf: rawCpf,
    cpfMasked: user?.cpfMasked || (rawCpf ? maskCPF(rawCpf) : ''),
    role: normalizedRole,
    photoUrl: user?.photoUrl || null,
    isActive: user?.isActive ?? true,
    emailVerified: user?.emailVerified ?? false,
    createdAt: user?.createdAt ?? new Date().toISOString(),
    updatedAt: user?.updatedAt ?? new Date().toISOString()
  };
}

function getVisibleUsers() {
  return (state.internalUsers || []).filter((user) => user?.isActive !== false);
}

function getUserById(id) {
  return (state.internalUsers || []).find(
    (user) => String(user.id || '').trim() === String(id || '').trim()
  );
}

function emailAlreadyExists(email, ignoreUserId = null) {
  const normalized = getNormalizedEmail(email);

  return getVisibleUsers().some((user) => {
    const sameEmail =
      getNormalizedEmail(user.email || user.username || '') === normalized;
    const sameUser =
      ignoreUserId && String(user.id || '') === String(ignoreUserId || '');
    return sameEmail && !sameUser;
  });
}

function cpfAlreadyExists(cpf, ignoreUserId = null) {
  const normalized = normalizeCPF(cpf);

  if (!normalized) return false;

  return getVisibleUsers().some((user) => {
    const sameCpf = normalizeCPF(user.cpf || '') === normalized;
    const sameUser =
      ignoreUserId && String(user.id || '') === String(ignoreUserId || '');
    return sameCpf && !sameUser;
  });
}

function replaceUserInState(updatedUser) {
  state.internalUsers = (state.internalUsers || []).map((user) => {
    if (String(user.id || '') !== String(updatedUser.id || '')) return user;
    return {
      ...user,
      ...updatedUser
    };
  });

  persistLocalUsers();
}

function clearUserForm() {
  const nameField = document.getElementById('newInternalUsername');
  const emailField = document.getElementById('newInternalEmail');
  const passwordField = document.getElementById('newInternalPassword');
  const cpfField = document.getElementById('newInternalCpf');
  const roleField = document.getElementById('newInternalRole');
  const statusField = document.getElementById('newInternalStatus');
  const previewField = document.getElementById('controlPasswordPreview');
  const previewWrap = document.getElementById('controlPasswordPreviewWrap');

  if (nameField) nameField.value = '';
  if (emailField) emailField.value = '';
  if (passwordField) passwordField.value = '';
  if (cpfField) cpfField.value = '';
  if (roleField) roleField.value = 'operador';
  if (statusField) statusField.value = 'active';
  if (previewField) previewField.value = '';
  if (previewWrap) previewWrap.classList.add('hidden');

  _clearPhotoUpload('newUserPhotoInput', 'newUserPhotoRing', 'newUserPhotoRemoveBtn');
  _pendingNewUserPhoto = null;

  _setCreateUserError('');
  _resetNewUserPasswordStrength();
}

function updateControlPasswordPreview() {
  const roleEl = document.getElementById('newInternalRole');
  const cpfEl = document.getElementById('newInternalCpf');
  const wrapEl = document.getElementById('controlPasswordPreviewWrap');
  const previewEl = document.getElementById('controlPasswordPreview');

  if (!roleEl || !cpfEl || !wrapEl || !previewEl) return;

  const role = normalizeRole(roleEl.value || '');
  const cpf = cpfEl.value || '';

  if (!roleCanHaveControlPassword(role)) {
    wrapEl.classList.add('hidden');
    previewEl.value = '';
    return;
  }

  wrapEl.classList.remove('hidden');
  previewEl.value = buildControlPasswordFromCPF(cpf);
}

function confirmAction(message) {
  return window.confirm(message);
}

/* ================= MODAL EDITAR ================= */

function applyEditControlPasswordVisibility() {
  // PIN field is always visible — no role-based hiding needed
}

function openEditUserModalById(userId) {
  if (!canManageUsers()) {
    setMessage('Você não tem permissão para editar usuários.', true);
    return;
  }

  const user = getUserById(userId);
  if (!user) {
    setMessage('Usuário não encontrado.', true);
    return;
  }

  if (!canEditOrDeactivateTargetUser(user)) {
    setMessage('Você não tem permissão para editar esse usuário.', true);
    return;
  }

  editingUserId = String(user.id || '').trim();

  const modal = document.getElementById('editUserModal');
  const nameEl = document.getElementById('editUserName');
  const emailEl = document.getElementById('editUserEmail');
  const roleEl = document.getElementById('editUserRole');
  const cpfEl = document.getElementById('editUserCpf');

  if (nameEl) nameEl.value = user.name || '';
  if (emailEl) emailEl.value = user.email || '';
  if (roleEl) roleEl.value = user.role || 'operador';
  if (cpfEl) cpfEl.value = user.cpf || '';

  // Populate photo preview
  _setPhotoPreview('editUserPhotoRing', user.photoUrl || null);
  const editRemoveBtn = document.getElementById('editUserPhotoRemoveBtn');
  if (editRemoveBtn) editRemoveBtn.classList.toggle('hidden', !user.photoUrl);
  _pendingEditUserPhoto = undefined;

  applyEditControlPasswordVisibility(
    user.role,
    user.cpf || '',
    roleCanHaveControlPassword(user.role)
      ? (user.controlPin || buildControlPasswordFromCPF(user.cpf || ''))
      : ''
  );

  if (modal) {
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    modal.removeAttribute('aria-hidden');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { document.getElementById('editUserName')?.focus(); });
  }
}

function closeEditUserModal() {
  editingUserId = null;
  const modalEl = document.getElementById('editUserModal');
  if (modalEl) {
    modalEl.classList.add('hidden');
    modalEl.setAttribute('inert', '');
    modalEl.setAttribute('aria-hidden', 'true');
  }

  const nameEl = document.getElementById('editUserName');
  const emailEl = document.getElementById('editUserEmail');
  const roleEl = document.getElementById('editUserRole');
  const cpfEl = document.getElementById('editUserCpf');
  if (nameEl) nameEl.value = '';
  if (emailEl) emailEl.value = '';
  if (roleEl) roleEl.value = 'operador';
  if (cpfEl) cpfEl.value = '';
  const pinEl = document.getElementById('editUserPin');
  if (pinEl) pinEl.value = '';

  _clearPhotoUpload('editUserPhotoInput', 'editUserPhotoRing', 'editUserPhotoRemoveBtn');
  _pendingEditUserPhoto = undefined;
}

function updateEditControlPasswordPreview() {
  const roleEl = document.getElementById('editUserRole');
  const cpfEl = document.getElementById('editUserCpf');

  if (!roleEl || !cpfEl) return;

  const role = normalizeRole(roleEl.value || '');
  const cpf = cpfEl.value || '';

  applyEditControlPasswordVisibility(role, cpf);
}

/* ================= INIT ================= */

export async function initInternalUsers() {
  const localUsers = getLocalUsers();
  // Preserve locally-stored photos even when syncing from backend
  const localPhotoMap = {};
  localUsers.forEach((u) => { if (u.id && u.photoUrl) localPhotoMap[u.id] = u.photoUrl; });

  try {
    const backendUsers = await listUsersService();

    if (Array.isArray(backendUsers)) {
      state.internalUsers = backendUsers.map((u) => {
        const mapped = mapBackendUserToInternalUser(u);
        if (!mapped.photoUrl && localPhotoMap[mapped.id]) {
          mapped.photoUrl = localPhotoMap[mapped.id];
        }
        return mapped;
      });

      persistLocalUsers();
      renderInternalUsers();
      return;
    }
  } catch (error) {
    console.warn('Backend de usuários indisponível, usando localStorage.', error);
  }

  state.internalUsers = localUsers.map(mapLocalUser);
  persistLocalUsers();
  renderInternalUsers();
}

/* ================= CRIAR ================= */

export async function addInternalUser() {
  _setCreateUserError('');

  if (!canManageUsers()) {
    _setCreateUserError('Você não tem permissão para cadastrar usuários.');
    return;
  }

  const name = String(
    document.getElementById('newInternalUsername')?.value || ''
  ).trim();

  const email = getNormalizedEmail(
    document.getElementById('newInternalEmail')?.value || ''
  );

  const password = String(
    document.getElementById('newInternalPassword')?.value || ''
  ).trim();

  const cpf = String(
    document.getElementById('newInternalCpf')?.value || ''
  ).trim();

  const role = normalizeRole(
    document.getElementById('newInternalRole')?.value || 'operador'
  );

  const isActive = document.getElementById('newInternalStatus')?.value !== 'inactive';

  if (!name || !email || !password) {
    _setCreateUserError('Preencha nome, e-mail e senha.');
    return;
  }

  if (!isValidEmail(email)) {
    _setCreateUserError('Informe um e-mail válido.');
    return;
  }

  if (emailAlreadyExists(email)) {
    _setCreateUserError('E-mail já está em uso.');
    return;
  }

  if (password.length < 8) {
    _setCreateUserError('A senha deve ter pelo menos 8 caracteres.');
    return;
  }

  if (!isValidCPF(cpf)) {
    _setCreateUserError('Informe um CPF válido.');
    return;
  }

  if (cpfAlreadyExists(cpf)) {
    _setCreateUserError('CPF já cadastrado no sistema.');
    return;
  }

  const newPhotoUrl = _pendingNewUserPhoto || null;

  try {
    const backendResponse = await createUserService({
      name,
      email,
      password,
      role,
      cpf: normalizeCPF(cpf),
      controlPin: buildControlPasswordFromCPF(cpf),
      photoUrl: newPhotoUrl,
      isActive
    });

    const savedUser = backendResponse?.user
      ? mapBackendUserToInternalUser(backendResponse.user)
      : mapBackendUserToInternalUser(backendResponse);

    // Always apply local photo (backend may not echo it back)
    if (newPhotoUrl) savedUser.photoUrl = newPhotoUrl;

    state.internalUsers = Array.isArray(state.internalUsers)
      ? [...state.internalUsers, savedUser]
      : [savedUser];

    persistLocalUsers();
    renderInternalUsers();
    clearUserForm();
    updateControlPasswordPreview();

    setMessage('Usuário cadastrado com sucesso.');
  } catch (error) {
    if ([422, 403, 409].includes(Number(error?.status))) {
      _setCreateUserError(_describeCreateUserError(error));
      return;
    }

    if (!isBackendUnavailableError(error)) {
      console.error('Erro ao cadastrar usuário no backend:', error);
      _setCreateUserError(_describeCreateUserError(error));
      return;
    }

    const fallbackUser = mapLocalUser({
      id: generateId(),
      companyId: state.currentUser?.companyId || null,
      name,
      username: email,
      email,
      password,
      cpf: normalizeCPF(cpf),
      cpfMasked: maskCPF(cpf),
      role,
      controlPassword: buildControlPasswordFromCPF(cpf),
      controlPin: buildControlPasswordFromCPF(cpf),
      photoUrl: newPhotoUrl,
      isActive: true,
      emailVerified: true
    });

    state.internalUsers = Array.isArray(state.internalUsers)
      ? [...state.internalUsers, fallbackUser]
      : [fallbackUser];

    persistLocalUsers();
    renderInternalUsers();
    clearUserForm();
    updateControlPasswordPreview();

    console.warn('Usuário salvo localmente por indisponibilidade real do backend.', error);
    setMessage('Backend indisponível no momento. Usuário salvo localmente.');
  }
}

/* ================= EDITAR ================= */

async function saveEditedUser() {
  if (!editingUserId) {
    setMessage('Usuário não selecionado.', true);
    return;
  }

  const current = getUserById(editingUserId);
  if (!current) {
    setMessage('Usuário não encontrado.', true);
    return;
  }

  const name = String(document.getElementById('editUserName')?.value || '').trim();
  const email = getNormalizedEmail(document.getElementById('editUserEmail')?.value || '');
  const role = normalizeRole(document.getElementById('editUserRole')?.value || 'operador');
  const cpf = normalizeCPF(document.getElementById('editUserCpf')?.value || '');

  if (!name || !email) {
    setMessage('Preencha nome e e-mail.', true);
    return;
  }

  if (!isValidEmail(email)) {
    setMessage('Informe um e-mail válido.', true);
    return;
  }

  if (emailAlreadyExists(email, editingUserId)) {
    setMessage('Este e-mail já está em uso por outro usuário.', true);
    return;
  }

  if (!isValidCPF(cpf)) {
    setMessage('Informe um CPF válido.', true);
    return;
  }

  if (cpfAlreadyExists(cpf, editingUserId)) {
    setMessage('Este CPF já está cadastrado para outro usuário.', true);
    return;
  }

  const resolvedPhoto = _pendingEditUserPhoto !== undefined
    ? (_pendingEditUserPhoto || null)
    : (current.photoUrl || null);

  const nextUser = {
    ...current,
    name,
    email,
    username: email,
    role,
    cpf,
    cpfMasked: maskCPF(cpf),
    controlPassword: roleCanHaveControlPassword(role)
      ? buildControlPasswordFromCPF(cpf)
      : '',
    controlPin: roleCanHaveControlPassword(role)
      ? buildControlPasswordFromCPF(cpf)
      : '',
    photoUrl: resolvedPhoto,
    updatedAt: new Date().toISOString()
  };

  try {
    const backendResponse = await updateUserService(editingUserId, {
      name,
      email,
      role,
      cpf,
      controlPin: nextUser.controlPin,
      photoUrl: resolvedPhoto
    });

    const savedUser = backendResponse?.user
      ? mapBackendUserToInternalUser(backendResponse.user)
      : mapBackendUserToInternalUser({
          ...nextUser,
          ...(backendResponse || {})
        });

    // Always apply resolved photo (backend may not echo base64)
    savedUser.photoUrl = resolvedPhoto;
    _pendingEditUserPhoto = undefined;

    replaceUserInState(savedUser);
    renderInternalUsers();

    // Optionally set operator PIN if provided
    const pinValue = String(document.getElementById('editUserPin')?.value || '').trim();
    if (pinValue) {
      try {
        await setOperatorPinService(editingUserId, pinValue);
      } catch (pinErr) {
        setMessage(`Usuário salvo, mas PIN não foi definido: ${pinErr?.message || 'erro'}`, true);
        closeEditUserModal();
        return;
      }
    }

    closeEditUserModal();
    setMessage('Usuário atualizado com sucesso.');
  } catch (error) {
    if (error?.status === 422) {
      setMessage(error?.message || 'Dados inválidos. Verifique os campos.', true);
      return;
    }

    if (error?.status === 403) {
      setMessage(error?.message || 'Você não tem permissão para editar este usuário.', true);
      return;
    }

    if (error?.status === 409) {
      setMessage(error?.message || 'Este e-mail ou CPF já está em uso.', true);
      return;
    }

    if (!isBackendUnavailableError(error)) {
      console.error('Erro ao atualizar usuário no backend:', error);
      setMessage(error?.message || 'Erro ao atualizar usuário.', true);
      return;
    }

    replaceUserInState(nextUser);
    renderInternalUsers();
    closeEditUserModal();

    console.warn('Usuário atualizado localmente por indisponibilidade real do backend.', error);
    setMessage('Backend indisponível no momento. Usuário atualizado localmente.');
  }
}

/* ================= EXCLUIR / DESATIVAR ================= */

async function deactivateOrDeleteUser(userId) {
  const user = getUserById(userId);
  if (!user) {
    setMessage('Usuário não encontrado.', true);
    return;
  }

  if (!canEditOrDeactivateTargetUser(user)) {
    setMessage('Você não tem permissão para remover esse usuário.', true);
    return;
  }

  const currentUserId = getCurrentUserId();
  const currentUserEmail = getCurrentUserLogin();

  if (
    String(user.id || '') === currentUserId ||
    getNormalizedEmail(user.email || user.username || '') === currentUserEmail
  ) {
    setMessage('Você não pode remover o usuário logado.', true);
    return;
  }

  if (!confirmAction(`Deseja remover/desativar ${user.name || user.email}?`)) {
    return;
  }

  try {
    await deleteUserService(userId);
  } catch (error) {
    if (!isBackendUnavailableError(error)) {
      console.error('Erro ao remover usuário no backend:', error);
      setMessage(error?.message || 'Erro ao remover usuário.', true);
      return;
    }

    console.warn('Falha ao remover no backend, removendo localmente.', error);
  }

  state.internalUsers = (state.internalUsers || []).map((item) => {
    if (String(item.id || '') !== String(userId || '')) return item;
    return {
      ...item,
      isActive: false,
      updatedAt: new Date().toISOString()
    };
  }).filter((item) => item.isActive !== false);

  persistLocalUsers();
  renderInternalUsers();
  setMessage('Usuário removido com sucesso.');
}

/* ================= RENDER ================= */

export function renderInternalUsers() {
  const tbody = document.getElementById('internalUsersTableBody');
  const countEl = document.getElementById('ucUserCount');
  const users = getVisibleUsers();

  if (countEl) countEl.textContent = users.length;

  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="uc-empty-users">
      <div class="uc-empty-col">
        <div class="uc-empty-icon-wrap">${_ucSvg('users')}</div>
        <div class="uc-empty-lbl">Nenhum usuário cadastrado</div>
        <div class="uc-empty-sub">Use o formulário acima para adicionar o primeiro usuário</div>
      </div>
    </td></tr>`;
    return;
  }

  const editIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const delIcon  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

  tbody.innerHTML = users.map((user) => {
    const displayName = escapeHtml(user.name || user.email || 'Usuário');
    const roleLabel   = escapeHtml(getRoleLabel(user.role || 'operador'));
    const roleKey     = escapeHtml(user.role || 'operador');
    const cpf         = escapeHtml(user.cpfMasked || maskCPF(user.cpf || '') || '—');
    const pin         = escapeHtml(user.controlPin || user.controlPassword || '—');
    const initial     = (user.name || user.email || '?')[0].toUpperCase();
    const active      = user.isActive !== false;
    const sinceParts  = user.createdAt
      ? new Date(user.createdAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
      : null;

    return `<tr>
      <td>
        <div class="uc-user-cell">
          ${_ucAvatar(user, { cls: 'uc-user-av' })}
          <div>
            <div class="uc-user-name">${displayName}</div>
            <div class="uc-user-email">${escapeHtml(user.email || '—')}</div>
            ${sinceParts ? `<div class="uc-user-since">desde ${sinceParts}</div>` : ''}
          </div>
        </div>
      </td>
      <td><span class="uc-role-badge ${roleKey}">${roleLabel}</span></td>
      <td>
        <div class="uc-name-col">
          <span class="uc-cpf-pill">${cpf}</span>
          <span class="uc-pin-pill">PIN ${pin}</span>
        </div>
      </td>
      <td><span class="uc-status-pill ${active ? 'active' : 'inactive'}">${active ? 'Ativo' : 'Inativo'}</span></td>
      <td>
        <div class="uc-act-col">
          <button class="uc-action-btn edit" data-user-id="${escapeHtml(user.id)}" type="button" title="Editar usuário">${editIcon}</button>
          <button class="uc-action-btn del" data-user-id="${escapeHtml(user.id)}" type="button" title="Desativar usuário">${delIcon}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  /* Bind direto nos botões — evita problemas de delegação com SVG */
  tbody.querySelectorAll('.uc-action-btn.edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const userId = btn.getAttribute('data-user-id');
      openEditUserModalById(userId);
    });
  });

  tbody.querySelectorAll('.uc-action-btn.del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const userId = btn.getAttribute('data-user-id');
      deactivateOrDeleteUser(userId);
    });
  });
}

/* ================= BINDS ================= */

export function bindUserManagementActions() {
  document.getElementById('addInternalUserBtn')?.addEventListener('click', addInternalUser);

  // ── Create form: photo upload ──
  document.getElementById('newUserPhotoInput')?.addEventListener('change', async () => {
    _pendingNewUserPhoto = await _handlePhotoInput('newUserPhotoInput', 'newUserPhotoRing', 'newUserPhotoRemoveBtn');
  });
  document.getElementById('newUserPhotoBtn')?.addEventListener('click', () => {
    document.getElementById('newUserPhotoInput')?.click();
  });
  document.getElementById('newUserPhotoRemoveBtn')?.addEventListener('click', () => {
    _clearPhotoUpload('newUserPhotoInput', 'newUserPhotoRing', 'newUserPhotoRemoveBtn');
    _pendingNewUserPhoto = null;
  });
  const newPhotoDrop = document.getElementById('newUserPhotoDrop');
  if (newPhotoDrop) {
    newPhotoDrop.addEventListener('dragover', (e) => { e.preventDefault(); newPhotoDrop.classList.add('drag-over'); });
    newPhotoDrop.addEventListener('dragleave', () => newPhotoDrop.classList.remove('drag-over'));
    newPhotoDrop.addEventListener('drop', async (e) => {
      e.preventDefault();
      newPhotoDrop.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const input = document.getElementById('newUserPhotoInput');
      if (input) {
        try { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; } catch { return; }
        _pendingNewUserPhoto = await _handlePhotoInput('newUserPhotoInput', 'newUserPhotoRing', 'newUserPhotoRemoveBtn');
      }
    });
  }

  // ── Edit modal: photo upload ──
  document.getElementById('editUserPhotoInput')?.addEventListener('change', async () => {
    _pendingEditUserPhoto = await _handlePhotoInput('editUserPhotoInput', 'editUserPhotoRing', 'editUserPhotoRemoveBtn');
  });
  document.getElementById('editUserPhotoBtn')?.addEventListener('click', () => {
    document.getElementById('editUserPhotoInput')?.click();
  });
  document.getElementById('editUserPhotoRemoveBtn')?.addEventListener('click', () => {
    _clearPhotoUpload('editUserPhotoInput', 'editUserPhotoRing', 'editUserPhotoRemoveBtn');
    _pendingEditUserPhoto = null;
  });

  document.getElementById('newInternalCpf')?.addEventListener('input', updateControlPasswordPreview);
  document.getElementById('newInternalRole')?.addEventListener('change', updateControlPasswordPreview);

  document.getElementById('newInternalPassword')?.addEventListener('input', updateNewUserPasswordStrength);

  document.getElementById('cancelEditUserBtn')?.addEventListener('click', closeEditUserModal);
  document.getElementById('saveEditUserBtn')?.addEventListener('click', saveEditedUser);

  document.getElementById('editUserCpf')?.addEventListener('input', updateEditControlPasswordPreview);
  document.getElementById('editUserRole')?.addEventListener('change', updateEditControlPasswordPreview);

  // Validate CPF button — inject shield icon on first bind
  const validateBtn = document.getElementById('validateCpfBtn');
  if (validateBtn && !validateBtn.querySelector('svg')) {
    validateBtn.innerHTML = `${_ucSvg('shield')} Validar CPF`;
  }
  validateBtn?.addEventListener('click', updateControlPasswordPreview);

  // Clear form button
  document.getElementById('clearUserFormBtn')?.addEventListener('click', clearUserForm);

  // Histórico filter buttons
  document.getElementById('ucHistApplyFilters')?.addEventListener('click', () => renderUcHistorico());
  document.getElementById('ucHistClearFilters')?.addEventListener('click', () => {
    const clear = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
    ['ucHistFilterOperator','ucHistFilterAction','ucHistFilterDateFrom','ucHistFilterDateTo'].forEach(clear);
    renderUcHistorico();
  });

  // User Central tab switching
  const ucTabsBar = document.getElementById('userCentralTabs');
  if (ucTabsBar) {
    ucTabsBar.querySelectorAll('[data-uc-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ucTabsBar.querySelectorAll('[data-uc-tab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.ucTab;
        document.querySelectorAll('.uc-tab-panel').forEach((p) => p.classList.add('hidden'));
        document.getElementById(`ucPanel-${tab}`)?.classList.remove('hidden');
        if (tab === 'visao-geral') renderUsersOverview();
        else if (tab === 'cadastrar') renderUcCadastrar();
        else if (tab === 'operadores') renderUcOperadores();
        else if (tab === 'historico') renderUcHistorico();
      });
    });
  }
}

/* ================= USER CENTRAL — SHARED HELPERS ================= */

function _ucBRL(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
}

/* ── Photo helpers ── */

function resizeImageToBase64(file, maxPx = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = maxPx;
        canvas.height = maxPx;
        const ctx  = canvas.getContext('2d');
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const ox   = (img.naturalWidth  - side) / 2;
        const oy   = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, ox, oy, side, side, 0, 0, maxPx, maxPx);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

const _PERSON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

function _setPhotoPreview(ringId, photoUrl) {
  const ring = document.getElementById(ringId);
  if (!ring) return;
  if (photoUrl) {
    ring.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="Foto" class="uc-av-img" />`;
    ring.classList.add('has-photo');
  } else {
    ring.innerHTML = _PERSON_SVG;
    ring.classList.remove('has-photo');
  }
}

async function _handlePhotoInput(inputId, ringId, removeBtnId) {
  const input = document.getElementById(inputId);
  if (!input?.files?.length) return null;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    setMessage('Imagem muito grande. Máximo: 5MB.', true);
    input.value = '';
    return null;
  }
  try {
    const b64 = await resizeImageToBase64(file);
    _setPhotoPreview(ringId, b64);
    const btn = document.getElementById(removeBtnId);
    if (btn) btn.classList.remove('hidden');
    return b64;
  } catch {
    setMessage('Não foi possível processar a imagem.', true);
    input.value = '';
    return null;
  }
}

function _clearPhotoUpload(inputId, ringId, removeBtnId) {
  const input = document.getElementById(inputId);
  if (input) input.value = '';
  _setPhotoPreview(ringId, null);
  const btn = document.getElementById(removeBtnId);
  if (btn) btn.classList.add('hidden');
}

/* ── Avatar renderer ── */
function _ucAvatar(nameOrUser, { cls = 'uc-user-av', role = '', extraClass = '', dataColor = '', dataColorBg = false } = {}) {
  const user    = typeof nameOrUser === 'object' && nameOrUser !== null ? nameOrUser : null;
  const name    = user ? (user.name || user.email || '?') : String(nameOrUser || '?');
  const photo   = user?.photoUrl || getUserAvatar(name);
  const initial = (name[0] || '?').toUpperCase();
  const roleKey = role || (user?.role || '');
  const colorAttr = dataColor ? ` data-av-color="${escapeHtml(dataColor)}"${dataColorBg ? ' data-av-bg' : ''}` : '';
  const classStr = [cls, roleKey, extraClass].filter(Boolean).join(' ');
  if (photo) {
    return `<div class="${classStr} has-photo"${colorAttr}><img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" class="uc-av-img" /></div>`;
  }
  return `<div class="${classStr}"${colorAttr}>${initial}</div>`;
}
function _ucGrade(g) { return ({ 'A+': 'ap', A: 'a', 'B+': 'bp', B: 'b', C: 'c' })[g] || 'dash'; }
function _ucInit(name) { return (String(name || '?')[0] || '?').toUpperCase(); }
function _ucDotHtml(status) {
  return `<span class="uc-dot ${status === 'online' ? 'online' : status === 'paused' ? 'paused' : 'offline'}"></span>`;
}
function _ucSvg(type) {
  const icons = {
    users:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    check:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    lock:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    key:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2 9 14"/><path d="m15 5 3 3"/></svg>`,
    xc:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    down:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
    monitor:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    star:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    alert:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.29 3.86-8.26 14.26A1 1 0 0 0 2.9 20h18.2a1 1 0 0 0 .87-1.5L13.71 3.86a1 1 0 0 0-1.72 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    history:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    person:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    terminal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    zap:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    shield:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    activity: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    login:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    cash:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    trending: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    clock:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    block:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
    info:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    switch2:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`
  };
  return icons[type] || '';
}

/* ================= VISÃO GERAL ================= */

function _renderKpi(metrics, actionsToday) {
  const el = document.getElementById('ucKpiGrid');
  if (!el) return;

  const activePct   = metrics.total > 0 ? Math.round((metrics.active / metrics.total) * 100) : 0;
  const blockedPct  = metrics.total > 0 ? Math.round((metrics.blocked / metrics.total) * 100) : 0;
  const loginTotal  = actionsToday.loginSuccess + actionsToday.loginFailed;
  const loginOkPct  = loginTotal > 0 ? Math.round((actionsToday.loginSuccess / loginTotal) * 100) : 0;

  const cards = [
    { icon: 'users',    cls: 'blue',   label: 'Total usuários',  value: metrics.total,
      sub: `${metrics.operators} op · ${metrics.managers} ger`,
      barPct: activePct, barColor: '#60a5fa' },
    { icon: 'check',    cls: 'green',  label: 'Usuários ativos', value: metrics.active,
      sub: `${activePct}% do cadastro`,
      barPct: activePct, barColor: '#4ade80' },
    { icon: 'lock',     cls: 'red',    label: 'Bloqueados',      value: metrics.blocked,
      sub: metrics.blocked > 0 ? 'requer atenção' : 'tudo normal',
      barPct: blockedPct, barColor: '#f87171' },
    { icon: 'login',    cls: 'blue',   label: 'Acessos hoje',    value: metrics.accessesToday,
      sub: `${loginOkPct}% de sucesso`,
      barPct: loginOkPct, barColor: '#60a5fa' },
    { icon: 'xc',       cls: 'yellow', label: 'Cancelamentos',   value: actionsToday.cancellations,
      sub: actionsToday.cancellations > 0 ? 'vendas canceladas' : 'sem cancelamentos',
      barPct: null, barColor: null },
    { icon: 'cash',     cls: 'purple', label: 'Sangrias',        value: actionsToday.bleeds,
      sub: `${actionsToday.supplies} suprimento${actionsToday.supplies !== 1 ? 's' : ''}`,
      barPct: null, barColor: null }
  ];

  el.innerHTML = cards.map(({ icon, cls, label, value, sub, barPct, barColor }) =>
    `<div class="uc-kpi-card">
      <div class="uc-kpi-icon ${cls}">${_ucSvg(icon)}</div>
      <div class="uc-kpi-body">
        <span>${label}</span>
        <strong>${value}</strong>
        ${sub ? `<small>${sub}</small>` : ''}
        ${barPct !== null ? `<div class="uc-kpi-mini-track"><div class="uc-kpi-mini-fill" data-fill-pct="${barPct}" data-fill-clr="${barColor}"></div></div>` : ''}
      </div>
    </div>`).join('');
  el.querySelectorAll('.uc-kpi-mini-fill[data-fill-pct]').forEach(d => {
    d.style.width = d.dataset.fillPct + '%';
    d.style.background = d.dataset.fillClr;
  });
}

function _renderSessions(activeSessions) {
  const el = document.getElementById('ucCashOperations');
  if (!el) return;
  const count = activeSessions.length;
  const palette = ['#60a5fa', '#4ade80', '#c084fc', '#fbbf24', '#f87171', '#34d399'];
  const _STATUS_LABELS = { online: 'Online', paused: 'Pausa', offline: 'Livre', blocked: 'Bloqueado', available: 'Disponível' };

  const _card = (s, i, placeholder = false) => {
    const status      = placeholder ? 'offline' : (s.status || 'offline');
    const color       = placeholder ? 'var(--muted2)' : palette[i % palette.length];
    const mins        = Number(s.onlineMinutes || 0);
    const onlineLabel = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? (mins % 60) + 'm' : ''}` : `${mins}min`;
    const avgTicket   = s.salesCount > 0 ? (s.salesToday / s.salesCount) : 0;
    const actPct      = s.salesCount > 0 ? Math.min(100, Math.round((s.salesCount / 15) * 100)) : 0;
    const statusLabel = placeholder ? 'Livre' : (_STATUS_LABELS[status] || 'Offline');

    return `<div class="uc-terminal-card ${status}${placeholder ? ' placeholder' : ''}">
      <div class="uc-tc-header">
        <div class="uc-tc-name">${escapeHtml(s.terminalName)}</div>
        <span class="uc-op-session-badge ${status}">${statusLabel}</span>
      </div>
      <div class="uc-tc-body">
        ${placeholder
          ? `<div class="uc-tc-avatar uc-tc-av-empty">—</div>`
          : _ucAvatar(s.operatorName, { cls: 'uc-tc-avatar', dataColor: color, dataColorBg: true })}
        <div>
          <div class="uc-tc-op">${escapeHtml(s.operatorName || 'Livre')}</div>
          ${!placeholder && s.lastSaleTime ? `<div class="uc-tc-time">última: ${escapeHtml(s.lastSaleTime)}</div>` : ''}
        </div>
      </div>
      <div class="uc-tc-stats">
        <div class="uc-tc-stat">
          <div class="uc-tc-stat-val ${placeholder ? '' : 'uc-tc-rev'}">${placeholder ? '—' : _ucBRL(s.salesToday || 0)}</div>
          <div class="uc-tc-stat-lbl">receita</div>
        </div>
        <div class="uc-tc-stat">
          <div class="uc-tc-stat-val">${placeholder ? '—' : (s.salesCount || 0)}</div>
          <div class="uc-tc-stat-lbl">vendas</div>
        </div>
        <div class="uc-tc-stat">
          <div class="uc-tc-stat-val">${placeholder ? '—' : onlineLabel}</div>
          <div class="uc-tc-stat-lbl">online</div>
        </div>
      </div>
      <div class="uc-tc-activity-wrap">
        <div class="uc-tc-activity">
          <div class="uc-tc-activity-fill" data-act-pct="${placeholder ? 3 : actPct}" data-act-clr="${color}"></div>
        </div>
      </div>
      <div class="uc-tc-footer">
        <span class="uc-tick-lbl">${placeholder ? 'aguardando' : 'ticket médio'}</span>
        <span class="uc-tc-time-badge">${placeholder ? 'livre' : (avgTicket > 0 ? _ucBRL(avgTicket) : '—')}</span>
      </div>
    </div>`;
  };

  const _placeholders = [
    { terminalName: 'Caixa 01', operatorName: 'Livre' },
    { terminalName: 'Caixa 02', operatorName: 'Livre' },
    { terminalName: 'Caixa 03', operatorName: 'Livre' }
  ];

  el.innerHTML = `
    <div class="uc-panel-head">
      <h4>${_ucSvg('monitor')} Caixas em operação</h4>
      <span class="uc-badge ${count > 0 ? 'green' : 'gray'}">${count} ativo${count !== 1 ? 's' : ''}</span>
    </div>
    <div class="uc-terminal-grid">
      ${count > 0
        ? activeSessions.map((s, i) => _card(s, i, false)).join('')
        : _placeholders.map((s, i) => _card(s, i, true)).join('')}
    </div>`;
  el.querySelectorAll('.uc-tc-activity-fill[data-act-pct]').forEach(d => {
    d.style.width = d.dataset.actPct + '%';
    d.style.background = d.dataset.actClr;
  });
  el.querySelectorAll('[data-av-color]').forEach(av => {
    const c = av.dataset.avColor;
    av.style.borderColor = c + '22';
    av.style.color = c;
    if (av.hasAttribute('data-av-bg')) av.style.background = c + '0d';
  });
}

function _renderRanking(ranking) {
  const el = document.getElementById('ucRanking');
  if (!el) return;

  const registeredUsers = Array.isArray(state.internalUsers)
    ? state.internalUsers.filter((u) => u.isActive !== false)
    : [];
  const usePlaceholder = !ranking.length && registeredUsers.length > 0;
  const rows = ranking.length
    ? ranking
    : usePlaceholder
      ? registeredUsers.map((u) => ({
          name: u.name || u.email || 'Usuário',
          terminalName: '—', salesCount: 0, revenue: 0,
          avgTicket: 0, cancellations: 0, onlineTime: '—', grade: '—'
        }))
      : [];

  const maxRev = rows.reduce((m, op) => Math.max(m, op.revenue || 0), 0);
  const _medalColors = ['#fbbf24', '#94a3b8', '#cd7c3c'];
  const _trendCls  = (g) => (['A+', 'A'].includes(g) ? 'up' : g === 'C' ? 'down' : 'flat');
  const _trendChar = (g) => (['A+', 'A'].includes(g) ? '▲' : g === 'C' ? '▼' : '·');

  el.innerHTML = `
    <div class="uc-panel-head">
      <h4>${_ucSvg('star')} Ranking de performance</h4>
      <span class="uc-badge ${ranking.length ? 'blue' : 'gray'}">${ranking.length ? 'Hoje' : 'Aguardando vendas'}</span>
    </div>
    ${!rows.length
      ? `<div class="uc-empty">${_ucSvg('users')} Nenhum operador cadastrado.</div>`
      : `<table class="uc-rank-table">
          <thead><tr>
            <th></th><th>Operador</th><th>Caixa</th>
            <th class="uc-th-r">Vendas</th><th class="uc-th-r">Receita</th>
            <th class="uc-th-r">Ticket</th><th class="uc-th-r">Canc.</th>
            <th class="uc-th-r">Nota</th>
          </tr></thead>
          <tbody>${rows.map((op, i) => {
            const medalCls  = !usePlaceholder && i === 0 ? 'gold' : !usePlaceholder && i === 1 ? 'silver' : !usePlaceholder && i === 2 ? 'bronze' : '';
            const medalChar = !usePlaceholder && i === 0 ? '🥇' : !usePlaceholder && i === 1 ? '🥈' : !usePlaceholder && i === 2 ? '🥉' : String(i + 1);
            const dash      = `<span class="uc-dash-muted">—</span>`;
            const revPct    = maxRev > 0 ? Math.round(((op.revenue || 0) / maxRev) * 100) : 0;
            const revBarColor = _medalColors[i] || '#60a5fa';
            return `<tr${usePlaceholder ? ' class="uc-rank-row-placeholder"' : ''}>
              <td><span class="uc-rank-num ${medalCls}">${medalChar}</span></td>
              <td>
                <div class="uc-rank-cell">
                  ${_ucAvatar(op.name, { cls: 'uc-rank-av' })}
                  <div>
                    <div class="uc-rank-name">${escapeHtml(op.name)}</div>
                    <div class="uc-rank-sub">${escapeHtml(op.onlineTime)}</div>
                  </div>
                </div>
              </td>
              <td class="uc-hist-term">${escapeHtml(op.terminalName)}</td>
              <td>${usePlaceholder ? dash : op.salesCount}</td>
              <td class="uc-td-r">
                ${usePlaceholder ? dash : `<div class="uc-rank-rev-wrap">${_ucBRL(op.revenue)}</div>
                  <div class="uc-rank-rev-bar"><div class="uc-rank-rev-fill" data-rev-pct="${revPct}" data-rev-clr="${revBarColor}"></div></div>`}
              </td>
              <td>${usePlaceholder ? dash : _ucBRL(op.avgTicket)}</td>
              <td>${usePlaceholder ? dash : op.cancellations}</td>
              <td>
                ${usePlaceholder ? dash : `<span class="uc-grade ${_ucGrade(op.grade)}">${op.grade}</span><span class="uc-rank-trend ${_trendCls(op.grade)}">${_trendChar(op.grade)}</span>`}
              </td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`}`;
  el.querySelectorAll('.uc-rank-rev-fill[data-rev-pct]').forEach(d => {
    d.style.width = d.dataset.revPct + '%';
    d.style.background = d.dataset.revClr;
  });
}

const _UC_PAL = ['#60a5fa','#4ade80','#c084fc','#fbbf24','#f87171','#34d399'];

function _renderChart(ranking) {
  const el = document.getElementById('ucChart');
  if (!el) return;

  const registeredUsers = Array.isArray(state.internalUsers)
    ? state.internalUsers.filter((u) => u.isActive !== false)
    : [];
  const usePlaceholder = !ranking.length && registeredUsers.length > 0;
  const rows = ranking.length
    ? ranking
    : usePlaceholder
      ? registeredUsers.map((u) => ({ name: u.name || u.email || 'Usuário', revenue: 0 }))
      : [];

  const maxRev = rows.reduce((m, op) => Math.max(m, op.revenue), 0);

  el.innerHTML = `
    <div class="uc-panel-head">
      <h4>${_ucSvg('activity')} Produtividade — receita hoje</h4>
      <span class="uc-badge ${ranking.length ? 'blue' : 'gray'}">Por operador</span>
    </div>
    ${!rows.length
      ? `<div class="uc-empty">${_ucSvg('activity')} Sem operadores cadastrados.</div>`
      : `<div class="uc-chart-wrap">
          <div class="uc-chart-grid-bg"></div>
          ${rows.map((op, i) => {
          const pct   = maxRev > 0 ? Math.round((op.revenue / maxRev) * 100) : 0;
          const color = usePlaceholder ? 'rgba(255,255,255,0.1)' : _UC_PAL[i % _UC_PAL.length];
          const fill  = usePlaceholder ? 6 : pct;
          return `<div class="uc-chart-row">
            <div class="uc-chart-label-cell">
              ${_ucAvatar(op.name, { cls: 'uc-chart-mini-av' })}
              <span class="uc-chart-label" title="${escapeHtml(op.name)}">${escapeHtml(op.name.split(' ')[0])}</span>
            </div>
            <div class="uc-chart-track">
              <div class="uc-chart-fill" data-fill-pct="${fill}" data-fill-clr="${color}"${!usePlaceholder ? ` data-fill-shadow="${color}"` : ''}></div>
            </div>
            <span class="uc-chart-pct">${usePlaceholder ? '—' : pct + '%'}</span>
            <span class="uc-chart-val">${usePlaceholder ? '—' : _ucBRL(op.revenue)}</span>
          </div>`;
        }).join('')}
          ${usePlaceholder ? `<div class="uc-chart-subtitle">Aguardando dados de vendas do dia</div>` : ''}
        </div>`}`;
  el.querySelectorAll('.uc-chart-fill[data-fill-pct]').forEach(d => {
    d.style.width = d.dataset.fillPct + '%';
    d.style.background = d.dataset.fillClr;
    if (d.dataset.fillShadow) d.style.boxShadow = `0 0 8px ${d.dataset.fillShadow}44`;
  });
}

function _renderTopOp(topOperator) {
  const el = document.getElementById('ucTopOperator');
  if (!el) return;

  const firstUser = !topOperator && Array.isArray(state.internalUsers)
    ? state.internalUsers.find((u) => u.isActive !== false)
    : null;
  const isPlaceholder = !topOperator && !!firstUser;
  const op = topOperator || (firstUser
    ? { name: firstUser.name || firstUser.email || '—', terminalName: '—', grade: '—', revenue: 0, salesCount: 0, avgTicket: 0, cancellations: 0 }
    : null);

  el.innerHTML = `
    <div class="uc-panel-head">
      <h4>${_ucSvg('star')} Operador destaque</h4>
      <span class="uc-badge yellow">Hoje</span>
    </div>
    ${!op
      ? `<div class="uc-empty">${_ucSvg('person')} Nenhum operador cadastrado.</div>`
      : `<div class="uc-top-card${isPlaceholder ? ' is-placeholder' : ''}">
          <span class="uc-top-crown">${isPlaceholder ? '🏆' : '👑'}</span>
          ${_ucAvatar(op.name, { cls: `uc-top-avatar${!isPlaceholder ? ' has-top' : ''}` })}
          <div class="uc-top-name">${escapeHtml(op.name)}</div>
          <div class="uc-top-terminal">${isPlaceholder ? 'Nenhuma venda registrada hoje' : escapeHtml(op.terminalName)}</div>
          ${isPlaceholder
            ? `<span class="uc-grade dash uc-grade-sm uc-dash-muted">aguardando</span>`
            : `<span class="uc-grade ${_ucGrade(op.grade)} uc-grade-sm">${op.grade}</span>`}
          <div class="uc-top-stats">
            <div class="uc-top-stat">
              <div class="uc-top-stat-label">Receita</div>
              <div class="uc-top-stat-value uc-stat-sm">${isPlaceholder ? '—' : _ucBRL(op.revenue)}</div>
            </div>
            <div class="uc-top-stat">
              <div class="uc-top-stat-label">Vendas</div>
              <div class="uc-top-stat-value">${isPlaceholder ? '—' : op.salesCount}</div>
            </div>
            <div class="uc-top-stat">
              <div class="uc-top-stat-label">Ticket médio</div>
              <div class="uc-top-stat-value uc-stat-sm">${isPlaceholder ? '—' : _ucBRL(op.avgTicket)}</div>
            </div>
            <div class="uc-top-stat">
              <div class="uc-top-stat-label">Cancelamentos</div>
              <div class="uc-top-stat-value">${isPlaceholder ? '—' : op.cancellations}</div>
            </div>
          </div>
        </div>`}`;
}

function _renderActions(actionsToday) {
  const el = document.getElementById('ucActionsToday');
  if (!el) return;
  const items = [
    { label: 'Abertura caixa',   value: actionsToday.openCash,      cls: actionsToday.openCash > 0      ? 'hl-green'  : '', icon: 'cash' },
    { label: 'Fechamento caixa', value: actionsToday.closeCash,      cls: '',                                                icon: 'cash' },
    { label: 'Logins OK',        value: actionsToday.loginSuccess,   cls: actionsToday.loginSuccess > 0  ? 'hl-green'  : '', icon: 'login' },
    { label: 'Falhas login',     value: actionsToday.loginFailed,    cls: actionsToday.loginFailed > 0   ? 'hl-red'    : '', icon: 'block' },
    { label: 'Cancelamentos',    value: actionsToday.cancellations,  cls: actionsToday.cancellations > 0 ? 'hl-yellow' : '', icon: 'xc' },
    { label: 'Sangrias',         value: actionsToday.bleeds,         cls: actionsToday.bleeds > 0        ? 'hl-purple' : '', icon: 'zap' },
    { label: 'Suprimentos',      value: actionsToday.supplies,       cls: actionsToday.supplies > 0      ? 'hl-blue'   : '', icon: 'trending' },
    { label: 'Acesso gerencial', value: actionsToday.managerAccess,  cls: actionsToday.managerAccess > 0 ? 'hl-yellow' : '', icon: 'shield' }
  ];
  el.innerHTML = `
    <div class="uc-panel-head"><h4>${_ucSvg('activity')} Ações hoje</h4></div>
    <div class="uc-actions-grid">${items.map(({ label, value, cls, icon }) =>
      `<div class="uc-action-item ${cls}">
        <div class="uc-action-label"><span class="uc-action-icon-inline">${_ucSvg(icon)}</span>${label}</div>
        <div class="uc-action-value">${value}</div>
      </div>`).join('')}</div>`;
}

function _renderAlerts(alerts) {
  const el = document.getElementById('ucAlertsToday');
  if (!el) return;
  const _alertIcon = (type) => {
    if (type === 'danger')  return _ucSvg('xc');
    if (type === 'warning') return _ucSvg('alert');
    if (type === 'success') return _ucSvg('check');
    return _ucSvg('info');
  };
  el.innerHTML = `
    <div class="uc-panel-head">
      <h4>${_ucSvg('alert')} Alertas do dia</h4>
      <span class="uc-badge ${alerts.length > 0 ? 'red' : 'green'}">${alerts.length}</span>
    </div>
    ${!alerts.length
      ? `<div class="uc-empty uc-empty-ok">${_ucSvg('check')} Nenhum alerta — sistema normal.</div>`
      : `<div class="uc-alert-list">${alerts.map((a) =>
          `<div class="uc-alert-item ${a.type || 'info'}">
            <div class="uc-alert-icon-wrap">${_alertIcon(a.type || 'info')}</div>
            <div class="uc-alert-body">
              <div class="uc-alert-title">${escapeHtml(a.title)}</div>
              ${a.detail ? `<div class="uc-alert-detail">${escapeHtml(a.detail)}</div>` : ''}
            </div>
            ${a.time && a.time !== '—' ? `<div class="uc-alert-time">${escapeHtml(a.time)}</div>` : ''}
          </div>`).join('')}</div>`}`;
}

function _renderAttention(attention) {
  const el = document.getElementById('ucAttention');
  if (!el) return;
  const _attIcon = (type) => {
    if (type === 'danger')  return _ucSvg('block');
    if (type === 'warning') return _ucSvg('alert');
    return _ucSvg('info');
  };
  el.innerHTML = `
    <div class="uc-panel-head">
      <h4>${_ucSvg('alert')} Atenção necessária</h4>
      <span class="uc-badge ${attention.length > 0 ? 'yellow' : 'green'}">${attention.length}</span>
    </div>
    ${!attention.length
      ? `<div class="uc-empty uc-empty-ok">${_ucSvg('check')} Todos os operadores dentro do esperado.</div>`
      : `<div class="uc-attention-list">${attention.map((a) =>
          `<div class="uc-attention-item ${a.type || 'warning'}">
            ${_ucAvatar(a.name, { cls: 'uc-access-mini-av', extraClass: 'uc-av-style-fs0' })}
            <div class="uc-attention-indicator">${_attIcon(a.type || 'warning')}</div>
            <div class="uc-attention-body">
              <div class="uc-attention-name">${escapeHtml(a.name)}</div>
              <div class="uc-attention-reason">${escapeHtml(a.reason)}</div>
              <div class="uc-attention-value">${escapeHtml(a.value)} · ${escapeHtml(a.terminal)}</div>
            </div>
          </div>`).join('')}</div>`}`;
}

function _renderAccessList(logs, targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const isMain = targetId === 'ucLastAccesses';
  const head = isMain
    ? `<div class="uc-panel-head"><h4>${_ucSvg('history')} Últimos acessos</h4><span class="uc-badge blue">${logs.length}</span></div>`
    : `<div class="uc-panel-head"><h4>Acessos recentes</h4><span class="uc-badge blue">${logs.length}</span></div>`;
  el.innerHTML = head + (!logs.length
    ? `<div class="uc-empty uc-empty-subtle">${_ucSvg('clock')}<span>Nenhum acesso registrado.<small>Os registros aparecerão conforme os operadores utilizem o sistema.</small></span></div>`
    : `<div class="uc-access-list">${logs.map((log) =>
        `<div class="uc-access-item">
          ${_ucAvatar(log.userName, { cls: 'uc-access-mini-av', extraClass: 'uc-av-style-fs0' })}
          <span class="uc-access-dot ${log.type || 'info'} uc-av-style-fs0"></span>
          <div class="uc-access-body">
            <div class="uc-access-label">${escapeHtml(log.label)}</div>
            <div class="uc-access-who">${escapeHtml(log.userName)} · ${escapeHtml(log.terminal)}</div>
          </div>
          <div class="uc-access-time">${escapeHtml(log.time)}</div>
        </div>`).join('')}</div>`);
}

export function renderUsersOverview() {
  if (!document.getElementById('ucPanel-visao-geral')) return;
  const snap = getUserCentralSnapshot();
  _renderKpi(snap.metrics, snap.actionsToday);
  _renderSessions(snap.activeSessions);
  _renderRanking(snap.ranking);
  _renderChart(snap.ranking);
  _renderAccessList(snap.lastAccesses, 'ucLastAccesses');
  _renderTopOp(snap.topOperator);
  _renderActions(snap.actionsToday);
  _renderAlerts(snap.alerts);
  _renderAttention(snap.attention);
}

/* ================= CADASTRAR — side panels ================= */

export function renderUcCadastrar() {
  const { lastAccesses } = getUserCentralSnapshot();
  _renderAccessList(lastAccesses.slice(0, 8), 'ucSidebarAccesses');
  const cadEl = document.getElementById('ucCadLastAccesses');
  if (cadEl) {
    const hasData = lastAccesses.length > 0;
    cadEl.innerHTML = `
      <div class="uc-panel-head"><h4>${_ucSvg('history')} Últimos acessos ao sistema</h4></div>
      ${!hasData
        ? `<div class="uc-access-skeleton">
            ${[0, 1, 2, 3].map((i) => `
              <div class="uc-skel-row" data-delay="${(i * 0.12).toFixed(2)}s">
                <div class="uc-skel-dot" data-delay="${(i * 0.12).toFixed(2)}s"></div>
                <div class="uc-skel-body">
                  <div class="uc-skel-line long" data-delay="${(i * 0.12).toFixed(2)}s"></div>
                  <div class="uc-skel-line short" data-delay="${(i * 0.12 + 0.08).toFixed(2)}s"></div>
                </div>
                <div class="uc-skel-time" data-delay="${(i * 0.12).toFixed(2)}s"></div>
              </div>`).join('')}
            <div class="uc-skel-note">${_ucSvg('clock')} Sem acessos registrados — aguardando uso operacional</div>
          </div>`
        : `<div class="uc-access-list">${lastAccesses.slice(0, 6).map((log) =>
            `<div class="uc-access-item">
              ${_ucAvatar(log.userName, { cls: 'uc-access-mini-av', extraClass: 'uc-av-style-fs0' })}
              <span class="uc-access-dot ${log.type || 'info'} uc-av-style-fs0"></span>
              <div class="uc-access-body">
                <div class="uc-access-label">${escapeHtml(log.label)}</div>
                <div class="uc-access-who">${escapeHtml(log.userName)} · ${escapeHtml(log.terminal)}</div>
              </div>
              <div class="uc-access-time">${escapeHtml(log.dateTime)}</div>
            </div>`).join('')}</div>`}`;
    cadEl.querySelectorAll('[data-delay]').forEach(el => { el.style.animationDelay = el.dataset.delay; });
  }
}

/* ================= OPERADORES E ACESSOS ================= */

const _OP_PERMS = {
  operador: {
    label: 'Operador (PDV)', color: '#60a5fa',
    can:    ['Registrar vendas no PDV', 'Abrir sessão de caixa', 'Emitir comprovantes', 'Consultar produtos'],
    cannot: ['Cancelar vendas sem gerente', 'Acessar relatórios', 'Cadastrar usuários', 'Ver configurações']
  },
  gerente: {
    label: 'Gerente', color: '#4ade80',
    can:    ['Tudo do operador', 'Cancelar vendas', 'Aprovar liberações', 'Ver relatórios básicos', 'Fazer sangrias'],
    cannot: ['Acessar configurações financeiras', 'Cadastrar usuários', 'Ver painel developer']
  },
  administrador: {
    label: 'Administrador', color: '#c084fc',
    can:    ['Acesso completo ao sistema', 'Gerenciar usuários', 'Ver todos os relatórios', 'Configurações financeiras'],
    cannot: ['Acessar painel Gamby Dev']
  }
};

export function renderUcOperadores() {
  const { activeSessions, alerts } = getUserCentralSnapshot();
  const allUsers = Array.isArray(state.internalUsers) ? state.internalUsers : [];

  // Terminal cards
  const termEl = document.getElementById('ucOp-terminals');
  if (termEl) {
    const palette = ['#60a5fa', '#4ade80', '#c084fc', '#fbbf24'];
    const _opPlaceholders = [
      { terminalName: 'Caixa 01', operatorName: 'Livre', status: 'offline' },
      { terminalName: 'Caixa 02', operatorName: 'Livre', status: 'offline' },
      { terminalName: 'Caixa 03', operatorName: 'Livre', status: 'offline' }
    ];
    const opCards = activeSessions.length > 0 ? activeSessions : _opPlaceholders;
    const opIsPlaceholder = activeSessions.length === 0;
    termEl.innerHTML = `<div class="uc-terminal-grid uc-tm-grid">${opCards.map((s, i) => {
      const color = opIsPlaceholder ? 'var(--muted2)' : palette[i % palette.length];
      const avgTicket = s.salesCount > 0 ? (s.salesToday / s.salesCount) : 0;
      return `<div class="uc-terminal-card ${opIsPlaceholder ? 'placeholder' : (s.status || 'offline')}">
        <div class="uc-tc-header"><div class="uc-tc-name">${escapeHtml(s.terminalName)}</div>${_ucDotHtml(s.status || 'offline')}</div>
        <div class="uc-tc-body">
          ${opIsPlaceholder
            ? `<div class="uc-tc-avatar uc-tc-av-empty">—</div>`
            : _ucAvatar(s.operatorName, { cls: 'uc-tc-avatar', dataColor: color })}
          <div class="uc-tc-op">${escapeHtml(s.operatorName || 'Livre')}</div>
        </div>
        <div class="uc-tc-stats">
          <div class="uc-tc-stat"><div class="uc-tc-stat-val ${opIsPlaceholder ? '' : 'uc-tc-rev'}">${opIsPlaceholder ? '—' : _ucBRL(s.salesToday || 0)}</div><div class="uc-tc-stat-lbl">receita</div></div>
          <div class="uc-tc-stat"><div class="uc-tc-stat-val">${opIsPlaceholder ? '—' : (s.salesCount || 0)}</div><div class="uc-tc-stat-lbl">vendas</div></div>
        </div>
        <div class="uc-tc-footer">
          <span class="uc-tick-lbl">${opIsPlaceholder ? 'aguardando' : 'ticket médio'}</span>
          <span class="uc-tc-time-badge">${opIsPlaceholder ? 'livre' : (avgTicket > 0 ? _ucBRL(avgTicket) : '—')}</span>
        </div>
      </div>`;
    }).join('')}</div>`;
    termEl.querySelectorAll('[data-av-color]').forEach(av => {
      const c = av.dataset.avColor;
      av.style.borderColor = c + '22';
      av.style.color = c;
      if (av.hasAttribute('data-av-bg')) av.style.background = c + '0d';
    });
  }

  // Operators table
  const tableEl = document.getElementById('ucOp-table');
  if (tableEl) {
    const activeSet = new Set(activeSessions.map((s) => s.operatorName));
    const onlineCount = allUsers.filter((u) => activeSet.has(u.name) && u.isActive !== false).length;
    tableEl.innerHTML = `
      <div class="uc-panel-head">
        <h4>${_ucSvg('person')} Operadores cadastrados</h4>
        <span class="uc-badge blue">${allUsers.length}</span>
      </div>
      <div class="uc-quick-bar">
        <span class="uc-quick-btn">${_ucSvg('check')} ${onlineCount} online</span>
        <span class="uc-quick-btn">${_ucSvg('users')} ${allUsers.filter(u => u.isActive !== false).length} ativos</span>
      </div>
      <table class="uc-op-table">
        <thead><tr>
          <th>Usuário</th><th>Perfil</th><th>Sessão</th><th>CPF</th><th>PIN</th>
        </tr></thead>
        <tbody>${!allUsers.length
          ? `<tr><td colspan="5" class="muted uc-no-ops-td">Nenhum operador cadastrado.</td></tr>`
          : allUsers.map((u) => {
              const name = escapeHtml(u.name || u.email || 'Usuário');
              const role = escapeHtml(getRoleLabel(u.role || 'operador'));
              const cpf = escapeHtml(u.cpfMasked || maskCPF(u.cpf || '') || '—');
              const pin = escapeHtml(u.controlPin || u.controlPassword || '—');
              const online = activeSet.has(u.name);
              const active = u.isActive !== false;
              const badgeCls = !active ? 'blocked' : online ? 'online' : 'offline';
              const badgeLabel = !active ? 'Bloqueado' : online ? 'Online' : 'Offline';
              return `<tr>
                <td>
                  <div class="uc-rank-cell">
                    ${_ucAvatar(u, { cls: 'uc-rank-av' })}
                    <div>
                      <div class="uc-rank-name">${name}</div>
                      <div class="uc-rank-sub">${escapeHtml(u.email || '—')}</div>
                    </div>
                  </div>
                </td>
                <td><span class="uc-role-td">${role}</span></td>
                <td><span class="uc-op-session-badge ${badgeCls}">${badgeLabel}</span></td>
                <td><span class="uc-cpf-pill">${cpf}</span></td>
                <td><span class="uc-pin-pill">${pin}</span></td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>`;
  }

  // Recent events
  const eventsEl = document.getElementById('ucOp-events');
  if (eventsEl) {
    const { lastAccesses } = getUserCentralSnapshot();
    _renderAccessList(lastAccesses.slice(0, 10), 'ucOp-events');
  }

  // Permissions by role
  const permsEl = document.getElementById('ucOp-perms');
  if (permsEl) {
    permsEl.innerHTML = `
      <div class="uc-panel-head"><h4>Permissões por perfil</h4></div>
      ${Object.values(_OP_PERMS).map((r) => `
        <div class="uc-perms-role">
          <div class="uc-perms-role-title">
            <span class="cat-dot" data-cat-clr="${escapeHtml(r.color)}"></span>
            ${r.label}
          </div>
          <div class="uc-perms-list">
            ${r.can.map((p) => `<div class="uc-perms-item can"><div class="uc-perms-dot can"></div>${p}</div>`).join('')}
            ${r.cannot.map((p) => `<div class="uc-perms-item cannot"><div class="uc-perms-dot cannot"></div>${p}</div>`).join('')}
          </div>
        </div>`).join('')}`;
    permsEl.querySelectorAll('.cat-dot[data-cat-clr]').forEach(el => { el.style.background = el.dataset.catClr; });
  }

  // Access alerts
  const alertsEl = document.getElementById('ucOp-alerts');
  if (alertsEl) {
    alertsEl.innerHTML = `
      <div class="uc-panel-head">
        <h4>${_ucSvg('alert')} Alertas de acesso</h4>
        <span class="uc-badge ${alerts.length > 0 ? 'red' : 'green'}">${alerts.length}</span>
      </div>
      ${!alerts.length
        ? `<div class="uc-empty">Nenhum alerta hoje.</div>`
        : `<div class="uc-alert-list">${alerts.map((a) =>
            `<div class="uc-alert-item ${a.type || 'info'}">
              <div class="uc-alert-title">${escapeHtml(a.title)}</div>
              ${a.detail ? `<div class="uc-alert-detail">${escapeHtml(a.detail)}</div>` : ''}
            </div>`).join('')}</div>`}`;
  }
}

/* ================= HISTÓRICO DE ACESSOS ================= */


export function renderUcHistorico() {
  const snap = getUserCentralSnapshot();

  // Summary KPI strip
  const statsEl = document.getElementById('ucHist-stats');
  if (statsEl) {
    const at = snap.actionsToday;
    const statCards = [
      { label: 'Logins OK',        value: at.loginSuccess,  cls: 'green' },
      { label: 'Falhas de login',  value: at.loginFailed,   cls: at.loginFailed > 0 ? 'red' : 'gray' },
      { label: 'Cancelamentos',    value: at.cancellations, cls: at.cancellations > 0 ? 'yellow' : 'gray' },
      { label: 'Trocas operador',  value: at.switches,      cls: 'blue' },
      { label: 'Abertura caixa',   value: at.openCash,      cls: 'green' },
      { label: 'Acesso gerencial', value: at.managerAccess, cls: at.managerAccess > 0 ? 'purple' : 'gray' }
    ];
    statsEl.innerHTML = statCards.map(({ label, value, cls }) =>
      `<div class="uc-kpi-card">
        <div class="uc-kpi-icon ${cls}">${_ucSvg(cls === 'green' ? 'check' : cls === 'red' ? 'xc' : cls === 'yellow' ? 'alert' : cls === 'purple' ? 'lock' : 'history')}</div>
        <div class="uc-kpi-body"><span>${label}</span><strong>${value}</strong></div>
      </div>`).join('');
  }

  // Build filter object
  const opName = (document.getElementById('ucHistFilterOperator')?.value || '').trim();
  const actionVal = document.getElementById('ucHistFilterAction')?.value || '';
  const dateFrom = document.getElementById('ucHistFilterDateFrom')?.value || '';
  const dateTo = document.getElementById('ucHistFilterDateTo')?.value || '';

  const accessFilters = {};
  if (opName) accessFilters.operatorName = opName;
  if (actionVal) accessFilters.actions = [actionVal];
  if (dateFrom) accessFilters.dateFrom = dateFrom + 'T00:00:00.000Z';
  if (dateTo)   accessFilters.dateTo   = dateTo   + 'T23:59:59.999Z';

  const hasFilters = Object.keys(accessFilters).length > 0;
  const logs = hasFilters ? getLastAccesses(200, accessFilters) : snap.lastAccesses;

  // Audit table
  const tableEl = document.getElementById('ucHist-table');
  if (tableEl) {
    tableEl.innerHTML = `
      <div class="uc-panel-head">
        <h4>${_ucSvg('history')} Registro de auditoria</h4>
        <span class="uc-badge blue">${logs.length} eventos</span>
      </div>
      <div class="uc-hist-table-wrap">
        <table class="uc-hist-table">
          <thead><tr>
            <th class="uc-th-28">#</th>
            <th>Hora</th><th>Evento</th><th>Usuário / Operador</th>
            <th>Caixa / Terminal</th><th>Detalhes</th>
          </tr></thead>
          <tbody>${!logs.length
            ? `<tr><td colspan="6" class="muted uc-no-hist-td">${_ucSvg('clock')} Nenhum registro encontrado para os filtros aplicados.</td></tr>`
            : logs.map((log, i) => {
                const chipCls = log.type || 'info';
                const timeDisplay = escapeHtml(log.dateTime || log.time);
                return `<tr>
                  <td class="uc-hist-row-num">${i + 1}</td>
                  <td>${timeDisplay}</td>
                  <td><span class="uc-hist-event-chip ${chipCls}">${escapeHtml(log.label)}</span></td>
                  <td class="uc-hist-td">
                    <div class="uc-hist-name-wrap">
                      ${_ucAvatar(log.userName, { cls: 'uc-access-mini-av', extraClass: 'uc-av-style-sm' })}
                      ${escapeHtml(log.userName)}
                    </div>
                  </td>
                  <td class="uc-hist-term">${escapeHtml(log.terminal)}</td>
                  <td class="uc-hist-det">${escapeHtml(log.details)}</td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Timeline
  const tlEl = document.getElementById('ucHist-timeline');
  if (tlEl) {
    const recent = logs.slice(0, 10);
    const _tlIcon = (type) => {
      if (type === 'danger')  return _ucSvg('xc');
      if (type === 'warning') return _ucSvg('alert');
      if (type === 'success') return _ucSvg('check');
      return _ucSvg('clock');
    };
    tlEl.innerHTML = `
      <div class="uc-panel-head"><h4>${_ucSvg('activity')} Linha do tempo — eventos recentes</h4></div>
      ${!recent.length
        ? `<div class="uc-empty uc-empty-subtle">${_ucSvg('clock')}<span>Sem eventos para exibir.<small>Aplique filtros ou aguarde novos registros.</small></span></div>`
        : `<div class="uc-timeline">${recent.map((log) =>
            `<div class="uc-tl-item">
              ${_ucAvatar(log.userName, { cls: 'uc-access-mini-av', extraClass: 'uc-av-style-fs0-asc' })}
              <div class="uc-tl-dot ${log.type || 'info'}"></div>
              <div class="uc-tl-body">
                <div class="uc-tl-label"><span class="uc-tl-icon-inline">${_tlIcon(log.type || 'info')}</span>${escapeHtml(log.label)}</div>
                <div class="uc-tl-who">${escapeHtml(log.userName)} · ${escapeHtml(log.terminal)}</div>
              </div>
              <div class="uc-tl-time">${escapeHtml(log.dateTime || log.time)}</div>
            </div>`).join('')}</div>`}`;
  }
}