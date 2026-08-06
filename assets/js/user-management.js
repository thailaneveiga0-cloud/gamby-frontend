import { state, DEFAULT_INTERNAL_USERS } from './state.js';
import { KEYS, load, save } from './storage.js';
import { getRoleLabel } from './roles.js';
import { listUsersService, createUserService, deleteUserService } from './services/user-service.js';

export async function initInternalUsers() {
  const backendUsers = await listUsersService().catch(() => null);
  if (Array.isArray(backendUsers) && backendUsers.length) {
    state.internalUsers = backendUsers.map(user => ({ id: user.id, username: user.email, password: '••••••', role: user.role }));
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

  const backendUser = await createUserService({
    name: username.split('@')[0] || username,
    email: username,
    password,
    role,
    isActive: true
  }).catch(() => null);

  state.internalUsers.push(backendUser ? { id: backendUser.id, username: backendUser.email, password: '••••••', role: backendUser.role } : { username, password, role });
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
