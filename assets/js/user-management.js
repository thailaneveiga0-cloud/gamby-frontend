import { state, DEFAULT_INTERNAL_USERS } from './state.js';
import { KEYS, load, save } from './storage.js';
import { getRoleLabel } from './roles.js';
import { listUsersService, createUserService, deleteUserService } from './services/user-service.js';

export async function initInternalUsers() {
  const backendUsers = await listUsersService().catch(() => null);
  if (Array.isArray(backendUsers) && backendUsers.length) {
    state.internalUsers = backendUsers.map(user => ({ id: user.id, username: user.email, hasPassword: true, role: user.role, companyId: user.companyId || state.currentUser?.companyId, subscriptionStatus: user.subscriptionStatus || state.currentUser?.subscriptionStatus }));
  } else {
    state.internalUsers = load(KEYS.internalUsers, DEFAULT_INTERNAL_USERS);
  }
  renderInternalUsers();
}

function persist() {
  save(KEYS.internalUsers, state.internalUsers);
}

export async function addInternalUser() {
  const username = String(document.getElementById('newInternalUsername')?.value || '').trim();
  const password = String(document.getElementById('newInternalPassword')?.value || '').trim();
  const role = document.getElementById('newInternalRole')?.value || 'operador';
  if (!username || !password) return alert('Informe usuário e senha.');
  if (state.internalUsers.some(u => u.username === username)) return alert('Já existe um usuário com esse login.');
  // O campo "Usuário" é enviado como e-mail de login (backend exige formato
  // de e-mail tanto na criação quanto no login — ver createUserSchema/
  // loginSchema). Validar aqui evita um 422 confuso depois de preencher
  // todo o formulário.
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/.test(username)) {
    return alert('O campo "Usuário" precisa ser um e-mail válido (ex.: novo.usuario@suaempresa.com) — é isso que a pessoa vai usar para fazer login.');
  }

  let backendUser;
  try {
    backendUser = await createUserService({
      name: username.split('@')[0] || username,
      email: username,
      password,
      role,
      isActive: true
    });
  } catch (err) {
    // Nunca cair para um usuário só local: sem confirmação real do backend
    // (por exemplo, limite de usuários do plano atingido), a criação falhou
    // de verdade e precisa aparecer como erro, não como sucesso silencioso.
    alert(`Não foi possível criar o usuário: ${err?.message || 'erro ao contatar o servidor.'}`);
    return;
  }

  state.internalUsers.push({
    id: backendUser.id,
    username: backendUser.email,
    hasPassword: true,
    role: backendUser.role,
    companyId: backendUser.companyId || state.currentUser?.companyId,
    subscriptionStatus: backendUser.subscriptionStatus || state.currentUser?.subscriptionStatus
  });
  persist();
  renderInternalUsers();
  document.getElementById('newInternalUsername').value='';
  document.getElementById('newInternalPassword').value='';
}

export async function deleteInternalUser(username) {
  if (!state.currentUser) return;
  if (state.currentUser.username === username) return alert('Você não pode excluir o usuário atualmente logado.');
  const target = state.internalUsers.find(u => u.username === username);
  if (target?.id) await deleteUserService(target.id).catch(() => null);
  state.internalUsers = state.internalUsers.filter(u => u.username !== username);
  persist();
  renderInternalUsers();
}

export function renderInternalUsers() {
  const tbody = document.getElementById('internalUsersTableBody');
  if (!tbody) return;
  tbody.innerHTML = state.internalUsers.map(user => `
    <tr>
      <td>${user.username}</td>
      <td>${getRoleLabel(user.role)}</td>
      <td><button class="btn btn-ghost btn-sm delete-user" data-user="${user.username}">Excluir</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.delete-user').forEach(btn => btn.addEventListener('click', ()=>deleteInternalUser(btn.dataset.user)));
}

export function bindUserManagementActions() {
  document.getElementById('addInternalUserBtn')?.addEventListener('click', () => addInternalUser());
}
