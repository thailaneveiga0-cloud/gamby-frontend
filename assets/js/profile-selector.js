/**
 * profile-selector.js — Seleção de perfil pós-login
 *
 * Camada puramente visual sobre uma sessão já autenticada (JWT inalterado).
 * Deixa o usuário logado (administrador/developer_master) escolher "como" vai
 * navegar hoje — Administrador, Gerente ou Operador — sem precisar de outra
 * senha... exceto que Gerente/Operador NÃO pulam autenticação real: exigem
 * confirmação de identidade via a API real de OperatorPin do PDV (Fase 3.1b)
 * — o mesmo mecanismo já usado por operator-session.js/pin-service.js
 * (POST /v1/pdv/operator-pin/switch), nunca comparação local.
 *
 * O PIN é sempre enviado ao backend para validação (nunca comparado no
 * frontend). A lista de candidatos vem de GET /v1/pdv/operators
 * (listOperatorsService), que devolve só `hasPin` (booleano, não-segredo) —
 * nunca o PIN nem qualquer valor derivado de CPF. A identidade usada para
 * ativar o perfil é sempre a devolvida pelo backend na resposta de sucesso,
 * nunca o objeto local que o usuário clicou na lista.
 *
 * state.activeProfile (ver state.js) é o estado deste módulo — controla
 * apenas visibilidade de menu/página (gov-access.getCurrentRole()). Nunca
 * contém PIN nem qualquer credencial.
 * state.currentOperator já existia antes e representa "quem está fisicamente
 * no caixa do PDV". Ao confirmar o PIN de um perfil Operador/Gerente, este
 * módulo TAMBÉM popula state.currentOperator com a identidade retornada pelo
 * backend — é a mesma pessoa que acabou de se identificar, e sem isso
 * startPDVOpenCashFlow() (modo controlled) pede identificação de novo. Não
 * confundir com state.activeProfile: um controla o que a pessoa VÊ, o outro
 * é registro de auditoria/turno de quem está OPERANDO o caixa — mas agora os
 * dois só existem depois de uma validação real de backend.
 */

import { state } from './state.js';
import { listUsersService } from './services/user-service.js';
import { listOperatorsService, loginWithPinService } from './services/pin-service.js';
import { getRoleLabel } from './roles.js';
import { applyRoleVisibility } from './ui.js';
import { applyVisibility as govApplyVisibility, getDefaultPage as govGetDefaultPage, canNavigate as govCanNavigate } from './gov-access.js';
import { applyMenuSecurity } from './security-policy.js';
import { enforcePDVKioskMode, releasePDVKioskMode, requirePDVAdminAuthorization } from './pdv-kiosk.js';
import { audit } from './audit-service.js';

const ACTIVE_PROFILE_KEY = 'gamby_active_profile';
const SELECTABLE_PROFILES = ['administrador', 'gerente', 'operador'];

let _companyUsers = [];
let _roleUsers = [];
let _pendingUser = null;
let _pendingRole = null;

/* ================= HELPERS ================= */

function _esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _initial(name) {
  const value = String(name || '').trim();
  return value ? value.charAt(0).toUpperCase() : '?';
}

function _userIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
}

/* ================= PERSISTÊNCIA (sessionStorage) ================= */

export function restoreActiveProfileFromSession() {
  try {
    const raw = sessionStorage.getItem(ACTIVE_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && SELECTABLE_PROFILES.includes(parsed.profile)) {
      state.activeProfile = parsed;
      return parsed;
    }
  } catch {}
  return null;
}

export function hasActiveProfile() {
  return Boolean(state.activeProfile);
}

export function clearActiveProfile() {
  state.activeProfile = null;
  try { sessionStorage.removeItem(ACTIVE_PROFILE_KEY); } catch {}

  // Encerra também a identidade de operador que _confirmPin() associou ao
  // perfil simulado (state.currentOperator + 'gamby_current_operator') — sem
  // isso, trocar de perfil (ou sair para o dashboard) e entrar como outro
  // Operador/Gerente depois reaproveitaria por engano os dados do anterior.
  state.currentOperator = null;
  state.operatorPinValidated = false;
  try { localStorage.removeItem('gamby_current_operator'); } catch {}

  // Higiene: nunca deixar a marca de "seletor veio do Acesso autorizado"
  // vazar para uma sessão de seletor futura e não relacionada (ex.: logout
  // seguido de novo login comum).
  state._acessoAutorizadoPendingConfirm = false;
}

function _setActiveProfile(profile, userId, name, extra = {}) {
  const value = { profile, userId: userId || null, name: name || null, ...extra };
  state.activeProfile = value;
  try { sessionStorage.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(value)); } catch {}
  return value;
}

/* ================= DADOS ================= */

// Fase 3.1b: lista vem de GET /v1/pdv/operators (listOperatorsService), não
// mais de GET /v1/users — esse endpoint é o dedicado do PDV, tenant-scoped,
// e devolve hasPin (booleano não-secreto) em vez de qualquer credencial.
// Devolve TODOS os usuários do papel pedido (mesmo sem PIN configurado
// ainda) — quem decide o que fazer com hasPin===false é a UI (ver
// _renderUserStep), não este helper.
export async function loadProfileUsers(role) {
  const operators = await listOperatorsService().catch(() => []);
  const target = String(role || '').toLowerCase();
  return operators.filter((op) => String(op.role || '').toLowerCase() === target);
}

/* ================= RESTRIÇÕES DE VISIBILIDADE ================= */

// Apenas a parte de visibilidade de menu (sem navegar) — extraída para poder
// ser chamada ANTES de handleAuthenticatedEntry(). activateDefaultPage() (via
// applyAuthenticatedLayout, dentro de handleAuthenticatedEntry) decide a
// página inicial olhando se o botão de nav do Dashboard está oculto; se essa
// ocultação só acontece DEPOIS (como applyProfileRestrictions fazia sozinho),
// o dashboard é escolhido, renderizado e fica visível durante toda a carga de
// refreshProtectedAreas() (vários segundos) até ser corrigido — o "flash" do
// dashboard antes do PDV para o perfil Operador.
export function applyProfileMenuVisibility(profile) {
  const role = String(profile || '').toLowerCase();
  if (!SELECTABLE_PROFILES.includes(role)) return;

  govApplyVisibility(role);
  applyMenuSecurity();
  applyRoleVisibility(role);
}

// Aplica a visibilidade de menu/página do perfil ativo (não do papel real do
// JWT) e navega para a página padrão desse perfil. Chamado após:
//   1. seleção de perfil bem-sucedida (login com múltiplos perfis disponíveis)
//   2. restauração de perfil ativo salvo em sessionStorage (reload de página)
export function applyProfileRestrictions(profile) {
  const role = String(profile || '').toLowerCase();
  if (!SELECTABLE_PROFILES.includes(role)) return;

  applyProfileMenuVisibility(role);

  const label = getRoleLabel(role);
  const badge = document.getElementById('profileBadge');
  const welcome = document.getElementById('welcomeRole');
  const metric = document.getElementById('metricProfile');
  if (badge) badge.textContent = label;
  if (welcome) welcome.textContent = `${label} conectado`;
  if (metric) metric.textContent = label;

  document.getElementById('switchProfileBtn')?.classList.remove('hidden');

  // BUG REAL DE STAGING (2026-09-19), Bug D: o bloco "Fallback cirúrgico"
  // abaixo só ADICIONA .hidden nesses seletores para o perfil Operador —
  // nunca havia um caminho simétrico que os REMOVESSE ao trocar para
  // Gerente/Administrador. releasePDVKioskMode() (chamada em outro ponto
  // do fluxo de autorização) só desfaz as classes do <body>
  // (pdv-kiosk-active/pdv-fullscreen), não estas .hidden aplicadas
  // diretamente nos elementos — então a sidebar ficava escondida para
  // sempre depois de um perfil Operador, mesmo trocando de perfil
  // corretamente depois. Restaurado incondicionalmente aqui, no início,
  // antes de qualquer decisão por role — mesmo padrão "fallback cirúrgico"
  // já usado no bloco abaixo, só que no sentido inverso.
  [
    '#appSidebar', '#mainSidebar', '#sidebar',
    '.app-sidebar', '.main-nav', '.nav-sidebar',
    '[data-sidebar]', '.side-menu', '#sideMenu',
    '.sidebar-hover-zone', '.sidebar-scrim', '.sidebar-toggle-btn',
    '#pdvExitOptionsBtn', '#pdvSystemActionBtn',
  ].forEach((sel) => {
    document.querySelector(sel)?.classList.remove('hidden');
  });

  // O kiosk também vive em classes de <body>/.app-shell (pdv-kiosk-active,
  // pdv-fullscreen, pdv-only-mode), cujo CSS esconde sidebar, hover zone,
  // toggle e topbar com !important — remover .hidden acima não desfaz isso.
  // openPageDirect() (chamada mais abaixo) só libera o kiosk DEPOIS de dois
  // returns antecipados (canAccessPage/denyAccess), então uma transição que
  // caísse neles deixava o Administrador/Gerente preso no layout do Operador
  // ("às vezes sem sidebar"). Liberação determinística aqui, guardada por
  // window.__pdvKioskActive para não gerar auditoria "kiosk.exit"/recriar o
  // Copilot no login normal, onde o kiosk nunca esteve ligado.
  if (role !== 'operador' && window.__pdvKioskActive) releasePDVKioskMode();

  // Chamada direta e explícita — não depende só da cadeia openPageDirect()
  // (que já chama isso para safePage==='pdv') chegar até o fim corretamente.
  // enforcePDVKioskMode() é idempotente (só seta flags/classes), então
  // chamá-la de novo logo abaixo (via openPageDirect) não tem efeito colateral.
  if (role === 'operador') {
    console.log('[KIOSK-DEBUG] applyProfileRestrictions(operador) — chamando enforcePDVKioskMode() diretamente');
    enforcePDVKioskMode();

    // Fallback cirúrgico via JS: mesmo com body.pdv-kiosk-active já presente
    // (CSS deveria bastar — display:none !important em layout-overrides.css),
    // ocultar a sidebar diretamente por classe garante o resultado
    // independente de cache de CSS desatualizado ou qualquer regra externa
    // não mapeada. Lista inclui o nome real confirmado (#appSidebar) e
    // variações defensivas caso a marcação mude no futuro.
    [
      '#appSidebar', '#mainSidebar', '#sidebar',
      '.app-sidebar', '.main-nav', '.nav-sidebar',
      '[data-sidebar]', '.side-menu', '#sideMenu',
      '.sidebar-hover-zone', '.sidebar-scrim', '.sidebar-toggle-btn',
    ].forEach((sel) => {
      document.querySelector(sel)?.classList.add('hidden');
    });

    // Botão "Sistema" (topbar #pdvExitOptionsBtn + grid de ações
    // #pdvSystemActionBtn) — ambos abrem openPDVExitOptions(), já restrito
    // para não oferecer a opção "Sistema" quando activeProfile.profile ===
    // 'operador' (ver app.js), mas o report pede o botão em si oculto.
    // Seguro esconder os dois: "Fechar Caixa" continua disponível pelo botão
    // dedicado #pdvCloseCashBtn (Alt+X) no grid de ações, independente deste.
    ['#pdvExitOptionsBtn', '#pdvSystemActionBtn'].forEach((sel) => {
      document.querySelector(sel)?.classList.add('hidden');
    });
  }

  // NOTA: a ocultação do PDV para Administrador vindo do "Acesso autorizado"
  // não é mais feita aqui "por fora" via classList — um classList.add('hidden')
  // manual neste ponto era desfeito segundos depois por applyMenuSecurity()
  // (chamada dentro de openPageDirect() → applySaaSVisualMode(), alguns
  // parágrafos abaixo), que reconstrói TODOS os nav-btn a partir de
  // canAccessPage()/canNavigate() — sem saber da flag, ele reexibia o botão.
  // A regra agora vive em gov-access.js:canNavigate(), consultando
  // state.activeProfile.restrictPdv (setado por _selectAdministrador() neste
  // arquivo) — fonte única de verdade, respeitada por toda navegação futura
  // e sobrevive a reload junto com o resto de activeProfile.

  // Preferir a página em que a pessoa estava antes do reload em vez de
  // sempre forçar a página padrão do perfil (Dashboard para Administrador/
  // Gerente). gamby_current_page é persistido por openPageDirect() a cada
  // navegação (app.js) — sem esta checagem, TODO reload com activeProfile
  // restaurado (login normal → seletor OU "Acesso autorizado") "esquecia" a
  // página atual e voltava para o padrão do perfil. Bug pré-existente à
  // função (não introduzido pelos rounds do "Acesso autorizado"), mas que
  // este fluxo tornou mais visível. Operador fica de fora: kiosk sempre o
  // prende no PDV, então nunca faz sentido restaurar outra página para ele.
  // 'pdv' nunca é restaurado aqui fora do perfil Operador — abrir o PDV
  // sempre passa pelo fluxo de identificação/senha dedicado
  // (startPDVOpenCashFlow), nunca por navegação direta.
  const _savedPage = role !== 'operador' ? localStorage.getItem('gamby_current_page') : null;
  const target =
    (_savedPage && _savedPage !== 'pdv' && govCanNavigate(_savedPage, role))
      ? _savedPage
      : govGetDefaultPage(role);
  console.log('[KIOSK-DEBUG] applyProfileRestrictions:', { role, target, savedPage: _savedPage, hasOpenPageDirect: typeof window.openPageDirect === 'function' });
  if (target && typeof window.openPageDirect === 'function') {
    window.openPageDirect(target);
  }
}

/* ================= UI ================= */

function _showStep(id) {
  ['psStepRole', 'psStepUser', 'psStepPin'].forEach((stepId) => {
    document.getElementById(stepId)?.classList.toggle('hidden', stepId !== id);
  });
}

// Saída de segurança: developer_master já pula esta tela inteiramente (ver
// showProfileSelector() e maybeEnterWithProfileSelection() em app.js) — este
// botão/atalho é apenas uma rede de segurança redundante caso algum caminho
// futuro acabe exibindo a tela para esse papel por engano. Nunca ativa para
// administrador/gerente/operador reais.
function _isDeveloperMasterUser() {
  return String(state.currentUser?.role || '').toLowerCase() === 'developer_master';
}

function _exitToDeveloperMode() {
  if (!_isDeveloperMasterUser()) return;
  clearActiveProfile();
  hideProfileSelector();
  window.location.reload();
}

function _renderRoleStep({ hasOperador, hasGerente }) {
  const list = document.getElementById('psRoleList');
  if (!list) return;

  document.getElementById('psDevModeBtn')?.classList.toggle('hidden', !_isDeveloperMasterUser());

  const buttons = [{ role: 'administrador', label: 'Administrador' }];
  if (hasGerente)  buttons.push({ role: 'gerente',  label: 'Gerente'  });
  if (hasOperador) buttons.push({ role: 'operador', label: 'Operador' });

  list.innerHTML = buttons.map((b) => `
    <button type="button" class="ps-role-btn" data-ps-role="${b.role}">
      <span class="ps-role-icon" aria-hidden="true">${_userIconSvg()}</span>
      <span class="ps-role-name">${_esc(b.label)}</span>
    </button>
  `).join('');
}

async function _openUserStep(role) {
  _pendingRole = role;
  const list = document.getElementById('psUserList');
  const title = document.getElementById('psUserStepTitle');
  if (title) title.textContent = getRoleLabel(role);
  if (list) list.innerHTML = '<p class="ps-empty">Carregando...</p>';

  _showStep('psStepUser');

  const users = await loadProfileUsers(role);
  _roleUsers = users;

  if (!list) return;

  if (!users.length) {
    list.innerHTML = `<p class="ps-empty">Nenhum ${_esc(getRoleLabel(role).toLowerCase())} cadastrado.</p>`;
    return;
  }

  // hasPin===false: fail-closed (Fase 3.1b, P24/P56) — o botão fica marcado
  // e o clique mostra uma mensagem em vez de abrir a etapa de PIN. Nunca
  // criar um PIN automático nem liberar o perfil sem credencial real.
  list.innerHTML = users.map((u) => `
    <button type="button" class="ps-user-btn${u.hasPin ? '' : ' ps-user-btn-no-pin'}" data-ps-user-id="${_esc(u.id)}">
      <span class="ps-user-avatar">${_esc(_initial(u.name))}</span>
      <span class="ps-user-name">${_esc(u.name || 'Usuário')}${u.hasPin ? '' : ' <small>(sem PIN)</small>'}</span>
    </button>
  `).join('');
}

function _openPinStep(user) {
  // Fail-closed (P24/P56): sem PIN configurado, nem abre a etapa de PIN —
  // nunca inventar credencial nem liberar o perfil sem validação real.
  if (!user?.hasPin) {
    _toast('Este operador ainda não possui PIN configurado. Cadastre um PIN na aba Usuários.', 'error');
    return;
  }

  _pendingUser = user;

  const info = document.getElementById('psPinUserInfo');
  if (info) {
    info.innerHTML = `
      <span class="ps-user-avatar">${_esc(_initial(user.name))}</span>
      <span class="ps-user-name">${_esc(user.name || 'Usuário')}</span>
    `;
  }

  const input = document.getElementById('psPinInput');
  if (input) input.value = '';
  document.getElementById('psPinError')?.classList.add('hidden');

  _showStep('psStepPin');
  setTimeout(() => input?.focus(), 60);
}

function _shake(el) {
  if (!el) return;
  el.classList.remove('ps-shake');
  void el.offsetWidth;
  el.classList.add('ps-shake');
}

function _showPinStepError(message, input) {
  _shake(document.getElementById('psStepPin'));
  const errEl = document.getElementById('psPinError');
  if (errEl) {
    errEl.textContent = message || 'PIN incorreto. Tente novamente.';
    errEl.classList.remove('hidden');
  }
  if (input) { input.value = ''; input.focus(); }
}

// Fase 3.1b: PIN é sempre validado no backend real (POST
// /v1/pdv/operator-pin/login, via loginWithPinService) — nunca comparado
// localmente. A identidade usada a partir daqui (id/name/role) é sempre a
// devolvida pela resposta do servidor, nunca o objeto _pendingUser que só
// serviu para o usuário escolher QUEM tentar autenticar.
async function _confirmPin() {
  const input = document.getElementById('psPinInput');
  const confirmBtn = document.getElementById('psPinConfirmBtn');
  const pin = input?.value || '';

  if (!_pendingUser) return;

  if (!pin) {
    _showPinStepError('Informe o PIN.', input);
    return;
  }

  if (confirmBtn) confirmBtn.disabled = true;

  let operator = null;
  try {
    operator = await loginWithPinService(_pendingUser.id, pin);
  } catch (err) {
    // Mensagem real do backend (inclui tentativas restantes / minutos de
    // bloqueio quando aplicável — ver operator-pin.service.js) — nunca
    // reescrita ou suavizada aqui.
    _showPinStepError(err?.message, input);
    return;
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }

  if (!operator) {
    _showPinStepError(null, input);
    return;
  }

  // Já verificado pelo backend — marcar a sessão como identificada evita um
  // segundo prompt de identificação ao entrar no PDV logo em seguida (perfil
  // Operador cai direto lá).
  state.operatorPinValidated = true;

  // Popula state.currentOperator com a identidade retornada pelo SERVIDOR
  // (nunca com _pendingUser) — startPDVOpenCashFlow() (modo controlled) só
  // pula direto para o modal de valor inicial quando currentOperator.name já
  // está definido; sem isso, cai em checkTerminalBeforeCashOpen() e pede
  // identificação de novo. Nenhum PIN/credencial é armazenado aqui — só
  // identidade não-secreta.
  state.currentOperator = {
    id: operator.userId,
    name: operator.name,
    role: operator.role,
    startedAt: new Date().toISOString()
  };
  // state.currentOperator é in-memory — some no reload (F5). operator-session.js
  // (fluxo real de identificação no PDV) sempre persiste em 'gamby_current_operator'
  // logo após identificar; este fluxo (seletor de perfil) espelha o mesmo
  // comportamento, senão um F5 na PDV perdia o operador confirmado e o modal
  // de identificação reaparecia mesmo com PIN já validado e activeProfile
  // ainda válido em sessionStorage.
  try { localStorage.setItem('gamby_current_operator', JSON.stringify(state.currentOperator)); } catch {}

  // Sinaliza para o listener de 'gamby:profile-selected' (app.js) que esta é
  // uma seleção NOVA (não uma restauração de reload) — uma sessão de caixa já
  // aberta no backend pode pertencer a outro operador ou a um dia anterior, e
  // não deve ser herdada silenciosamente; o listener consome e remove esta
  // flag, forçando startPDVOpenCashFlow() a reconfirmar a senha admin mesmo
  // com sessão ativa. Sessão-scoped (não sessionStorage-persistente entre
  // logins) por natureza: setada aqui, lida e removida um instante depois.
  try { sessionStorage.setItem('gamby_just_selected_profile', '1'); } catch {}

  // Escolher Operador/Gerente encerra a pendência de confirmação extra do
  // "Acesso autorizado" (essa segunda senha é exclusiva de Administrador) —
  // sem isso, um clique futuro em Administrador (via "Trocar perfil", já fora
  // deste fluxo) herdaria a exigência por engano.
  state._acessoAutorizadoPendingConfirm = false;

  const profile = _setActiveProfile(operator.role, operator.userId, operator.name);
  hideProfileSelector();
  window.dispatchEvent(new CustomEvent('gamby:profile-selected', { detail: profile }));
}

function _toast(message, type = 'error') {
  if (!message) return;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Confirmação extra de senha administrativa — exigida sempre que Administrador
// é escolhido no seletor (login normal ou "Acesso autorizado"). Reaproveita o
// mesmo modal/validação de backend já usado por todas as outras ações
// administrativas do PDV (requirePDVAdminAuthorization → openSecureCashCloseModal
// → POST /v1/authorization) — nenhuma senha em texto puro é guardada:
// state._pendingCashAuthPassword/_pendingCashApprovedBy já existem para esse
// fim e são consumidos uma única vez.
//
// PDV nunca aparece para Administrador (gov-access.js:canNavigate() nega
// incondicionalmente para o role, independente de origem) — não é mais
// necessário marcar nada aqui para isso. _fromAcessoAutorizado é mantido só
// para diferenciar a origem nos registros de auditoria.
function _confirmAdminAccessPassword() {
  const _fromAcessoAutorizado = Boolean(state._acessoAutorizadoPendingConfirm);

  audit('acesso_autorizado_admin_confirmacao_solicitada', {
    solicitadoPor: state.currentUser?.name || state.currentUser?.email || '—',
    origem: _fromAcessoAutorizado ? 'acesso_autorizado' : 'login_normal',
    dateTime: new Date().toISOString()
  });

  requirePDVAdminAuthorization(
    'confirm-admin-profile',
    async () => {
      state._acessoAutorizadoPendingConfirm = false;

      const approvedBy = state._pendingCashApprovedBy || null;
      state._pendingCashApprovedBy = null;
      const role = String(approvedBy?.role || '').toLowerCase();

      // Bootstrap provisório (senha 000000): o backend só devolve isso quando
      // NENHUM administrador/gerente da empresa tem senha configurada ainda —
      // não existe approvedBy porque não há "quem" aprovar, mas o backend já
      // decidiu que é válido. BUG CONFIRMADO: sem checar isso, role virava
      // string vazia e uma senha 000000 correta era rejeitada como se fosse
      // credencial sem permissão administrativa.
      const _isProvisional = Boolean(state._pendingCashProvisional);
      state._pendingCashProvisional = false;

      // Exclusivamente Administrador (desenvolvedora/developer_master tratados
      // como equivalentes, mesmo padrão de handleClosedCashAuthorizedAccess()
      // em cash-session.js) — Gerente/Operador nunca assumem este perfil por
      // aqui, mesmo com credencial válida para OUTRAS ações do PDV.
      const _isAdmin = role === 'administrador' || role === 'desenvolvedora' || role === 'developer_master' || _isProvisional;
      if (!_isAdmin) {
        _toast('Acesso negado. Esta credencial não possui permissão administrativa.', 'error');
        audit('acesso_autorizado_admin_confirmacao_negada', {
          usuarioValidado: approvedBy?.name || '—',
          funcaoValidada: role || 'desconhecida (senha provisória ou sem approvedBy)',
          dateTime: new Date().toISOString()
        });
        return; // permanece no seletor de perfil — nada é liberado
      }

      audit('acesso_autorizado_admin_confirmado', {
        usuarioValidado: approvedBy?.name || state.currentUser?.name || '—',
        funcaoValidada: role || (_isProvisional ? 'administrador (senha provisória)' : 'desconhecida'),
        origem: _fromAcessoAutorizado ? 'acesso_autorizado' : 'login_normal',
        dateTime: new Date().toISOString()
      });

      const profile = _setActiveProfile(
        'administrador',
        approvedBy?.id || state.currentUser?.id,
        approvedBy?.name || state.currentUser?.name
      );
      hideProfileSelector();
      window.dispatchEvent(new CustomEvent('gamby:profile-selected', { detail: profile }));
    },
    () => {
      // Cancelado ou desistiu após senha(s) incorreta(s) — nada é liberado,
      // o seletor de perfil permanece visível por baixo (nunca foi ocultado).
      audit('acesso_autorizado_admin_confirmacao_cancelada', {
        solicitadoPor: state.currentUser?.name || state.currentUser?.email || '—',
        dateTime: new Date().toISOString()
      });
    }
  );
}

// Escolher Administrador no seletor sempre exige a 2ª senha — em qualquer
// origem (login normal ou "Acesso autorizado"). O que muda por origem é só
// se restrictPdv é aplicado (ver _confirmAdminAccessPassword() acima).
function _selectAdministrador() {
  _confirmAdminAccessPassword();
}

/**
 * Exibe a tela de seleção de perfil.
 * Retorna `true` se a UI foi exibida (chamador deve aguardar o evento
 * 'gamby:profile-selected' antes de prosseguir), ou `false` se a seleção foi
 * pulada (developer_master, ou administrador sem operadores/gerentes
 * cadastrados) — chamador deve prosseguir imediatamente para o dashboard.
 */
export async function showProfileSelector() {
  const screen = document.getElementById('profileSelectorScreen');
  if (!screen) return false;

  const role = String(state.currentUser?.role || '').toLowerCase();
  if (role === 'developer_master') return false;

  _companyUsers = await listUsersService().catch(() => []);

  const hasOperador = _companyUsers.some((u) => String(u.role || '').toLowerCase() === 'operador' && u.isActive !== false);
  const hasGerente  = _companyUsers.some((u) => String(u.role || '').toLowerCase() === 'gerente'  && u.isActive !== false);

  // Administrador sem nenhum operador/gerente cadastrado: nada para escolher.
  if (role === 'administrador' && !hasOperador && !hasGerente) return false;

  const companyName =
    state.currentCompany?.tradeName ||
    state.currentCompany?.name ||
    state.currentUser?.company?.tradeName ||
    '—';
  const nameEl = document.getElementById('psCompanyName');
  if (nameEl) nameEl.textContent = companyName;

  _renderRoleStep({ hasOperador, hasGerente });
  _showStep('psStepRole');

  document.getElementById('appLoader')?.classList.add('hidden');
  document.getElementById('authRoot')?.classList.add('hidden');
  document.documentElement.classList.remove('has-saved-session');
  screen.classList.remove('hidden');

  return true;
}

export function hideProfileSelector() {
  document.getElementById('profileSelectorScreen')?.classList.add('hidden');
}

/* ================= BIND (chamado uma vez na inicialização) ================= */

let _bound = false;

export function bindProfileSelectorActions() {
  if (_bound) return;
  _bound = true;

  document.getElementById('psRoleList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ps-role]');
    if (!btn) return;
    const role = btn.dataset.psRole;
    if (role === 'administrador') { _selectAdministrador(); return; }
    _openUserStep(role);
  });

  document.getElementById('psUserList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ps-user-id]');
    if (!btn) return;
    const userId = btn.dataset.psUserId;
    const user = _roleUsers.find((u) => String(u.id) === String(userId));
    if (user) _openPinStep(user);
  });

  document.getElementById('psBackToRoleBtn')?.addEventListener('click', () => {
    _showStep('psStepRole');
  });

  document.getElementById('psBackToUserBtn')?.addEventListener('click', () => {
    if (_pendingRole) _openUserStep(_pendingRole);
  });

  document.getElementById('psPinConfirmBtn')?.addEventListener('click', _confirmPin);

  document.getElementById('psPinInput')?.addEventListener('input', (e) => {
    // Fase 3.1b (P8): OperatorPin aceita 4-6 dígitos, não só 4 — mesmo
    // formato validado pelo backend (operator-pin.service.js).
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    document.getElementById('psPinError')?.classList.add('hidden');
  });

  document.getElementById('psPinInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _confirmPin(); }
  });

  document.getElementById('psDevModeBtn')?.addEventListener('click', _exitToDeveloperMode);

  // Atalho redundante ao botão psDevModeBtn — só age se a tela estiver
  // visível E o usuário real for developer_master (ver _exitToDeveloperMode).
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== 'd') return;
    const screen = document.getElementById('profileSelectorScreen');
    if (!screen || screen.classList.contains('hidden')) return;
    e.preventDefault();
    _exitToDeveloperMode();
  });

  // Header: "Trocar perfil" — limpa o perfil ativo e volta para a seleção.
  document.getElementById('switchProfileBtn')?.addEventListener('click', async () => {
    clearActiveProfile();
    document.getElementById('switchProfileBtn')?.classList.add('hidden');
    const shown = await showProfileSelector();
    if (!shown) {
      // developer_master ou admin sem outros perfis — não deveria expor o botão,
      // mas por segurança, se chegou aqui, simplesmente reaplica o papel real.
      window.location.reload();
    }
  });
}
