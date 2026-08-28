/**
 * marketing.js — Módulo de Marketing GAMBY
 *
 * Sub-tabs: Campanhas · Clientes · Cupons · Automação · WhatsApp · E-mail · Relatórios
 * Funcionalidade real com lifecycle completo de campanhas, validação de canal,
 * navegação direta para Configurações > Canais de Comunicação.
 */

import {
  listCampaigns, createCampaign, updateCampaign, deleteCampaign, duplicateCampaign,
  listMarketingCustomers, createMarketingCustomer, deleteMarketingCustomer,
  listCoupons, createCoupon, toggleCoupon, deleteCoupon,
  listAutomations, createAutomation, toggleAutomation, deleteAutomation,
  getEmailConfig, saveEmailConfig,
  getMarketingReport,
  CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, CAMPAIGN_TYPES, CAMPAIGN_AUDIENCES,
  AUTOMATION_TRIGGERS, AUTOMATION_ACTIONS,
} from './services/marketing-service.js';

import {
  getWhatsAppIntegrationStatus, WA_STATUS,
  listWhatsAppConversations,
} from './services/whatsapp-service.js';

/* ─── Safety helpers ──────────────────────────────────────────────────────── */

function asArray(v) { return Array.isArray(v) ? v : []; }

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; }
}

function _fmtDt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return '—'; }
}

/* ─── State ───────────────────────────────────────────────────────────────── */

let _ctx = {};
let _waStatusCache = null;
let _emailCfgCache = null;

/* ─── Navigation utility ──────────────────────────────────────────────────── */

function _openSettingsChannel(channel) {
  const navBtn = document.querySelector('.nav-btn[data-page="configuracoes"]');
  if (navBtn) navBtn.click();
  setTimeout(() => {
    const canaisBtn = document.querySelector('#settingsTabsBar button[data-tab="canais"]');
    if (canaisBtn) canaisBtn.click();
    setTimeout(() => {
      const chBtn = document.querySelector(`#cfgCanaisTabsBar button[data-canais-tab="${channel}"]`);
      if (chBtn) chBtn.click();
      const panel = document.getElementById('cfgCanaisPanel');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        panel.classList.add('cfg-canais-flash');
        setTimeout(() => panel.classList.remove('cfg-canais-flash'), 1800);
      }
    }, 160);
  }, 100);
}

/* ─── Campaign status map ─────────────────────────────────────────────────── */

const _S = {
  rascunho:  { label: 'Rascunho',          cls: 'mkt-s-draft',     desc: 'Campanha salva mas não ativa.', next: 'Revise os dados e clique em Ativar agora ou Agendar para colocar em funcionamento.' },
  pronta:    { label: 'Pronta para ativar', cls: 'mkt-s-ready',     desc: 'Revisada e pronta para ativação.', next: 'Clique em Ativar agora para iniciar, ou Agendar para envio futuro.' },
  agendada:  { label: 'Agendada',          cls: 'mkt-s-scheduled', desc: 'Programada para envio em data futura.', next: 'Aguardando a data configurada. Você pode alterar o agendamento ou ativar imediatamente.' },
  ativa:     { label: 'Ativa',             cls: 'mkt-s-active',    desc: 'Campanha em andamento.', next: 'Campanha em execução. Pause quando necessário ou encerre ao finalizar.' },
  pausada:   { label: 'Pausada',           cls: 'mkt-s-paused',    desc: 'Interrompida temporariamente.', next: 'Retome quando estiver pronto ou encerre definitivamente.' },
  encerrada: { label: 'Encerrada',         cls: 'mkt-s-ended',     desc: 'Campanha finalizada.', next: 'Você pode duplicar esta campanha para criar uma nova baseada nela.' },
  arquivada: { label: 'Arquivada',         cls: 'mkt-s-archived',  desc: 'Removida da operação ativa. Mantida no histórico.', next: 'Campanha arquivada. Pode ser restaurada se necessário.' },
};

function _statusInfo(st) { return _S[st] || { label: st || '—', cls: 'mkt-s-draft', desc: '', next: '' }; }

/* ─── Actions per status ──────────────────────────────────────────────────── */

function _getActions(status) {
  const A = {
    rascunho:  ['details', 'edit', 'review', 'activate', 'schedule', 'delete'],
    pronta:    ['details', 'activate', 'edit', 'schedule', 'archive'],
    agendada:  ['details', 'activate', 'edit', 'cancel-schedule', 'archive'],
    ativa:     ['details', 'pause', 'end'],
    pausada:   ['details', 'resume', 'edit', 'end', 'archive'],
    encerrada: ['details', 'duplicate', 'archive'],
    arquivada: ['restore', 'delete'],
  };
  return A[status] || ['details', 'edit', 'delete'];
}

const _ACTION_LABEL = {
  details:         'Ver detalhes',
  edit:            'Editar',
  review:          'Marcar como pronta',
  activate:        'Ativar agora',
  schedule:        'Agendar',
  pause:           'Pausar',
  resume:          'Retomar',
  end:             'Encerrar',
  duplicate:       'Duplicar campanha',
  archive:         'Arquivar',
  'cancel-schedule': 'Cancelar agendamento',
  restore:         'Restaurar',
  delete:          'Excluir',
};

/* ─── Entry point ─────────────────────────────────────────────────────────── */

export function renderMarketing(container, ctx = {}) {
  if (!container) return;
  _ctx = ctx;
  _waStatusCache = null;
  _emailCfgCache = null;

  const tabs = [
    { id: 'campaigns',  label: 'Campanhas' },
    { id: 'customers',  label: 'Clientes' },
    { id: 'coupons',    label: 'Cupons' },
    { id: 'automation', label: 'Automação' },
    { id: 'whatsapp',   label: 'WhatsApp' },
    { id: 'email',      label: 'E-mail' },
    { id: 'reports',    label: 'Relatórios' },
  ];

  container.innerHTML = `
    <div class="mkt-page">
      <div class="mkt-header">
        <div class="mkt-header-left">
          <h2 class="mkt-header-title">Marketing</h2>
          <p class="mkt-header-sub">Atraia, fidelize e engaje seus clientes com campanhas inteligentes.</p>
        </div>
      </div>
      <nav class="mkt-tabs-nav" role="tablist">
        ${tabs.map((t, i) => `
          <button class="mkt-tab${i === 0 ? ' active' : ''}" data-tab="${_esc(t.id)}" type="button" role="tab">${_esc(t.label)}</button>
        `).join('')}
      </nav>
      <div class="mkt-tab-content" id="mktTabContent">
        <div class="mkt-loading">Carregando...</div>
      </div>
    </div>`;

  const tabContent = container.querySelector('#mktTabContent');

  container.querySelectorAll('.mkt-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mkt-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _closeAllMenus();
      _renderTab(tabContent, btn.dataset.tab);
    });
  });

  _renderTab(tabContent, 'campaigns');
}

/* ─── Tab router ──────────────────────────────────────────────────────────── */

function _renderTab(el, tab) {
  if (!el) return;
  switch (tab) {
    case 'campaigns':  _renderCampaigns(el);  break;
    case 'customers':  _renderCustomers(el);  break;
    case 'coupons':    _renderCoupons(el);    break;
    case 'automation': _renderAutomation(el); break;
    case 'whatsapp':   _renderWhatsApp(el);   break;
    case 'email':      _renderEmail(el);      break;
    case 'reports':    _renderReports(el);    break;
    default: el.innerHTML = '<p class="mkt-empty-msg">Aba não encontrada.</p>';
  }
}

/* ─── Shared: safe list fetch wrapper ─────────────────────────────────────── */

async function _safeList(fetchFn, el, renderFn) {
  el.innerHTML = `<div class="mkt-loading">Carregando...</div>`;
  try {
    const data = asArray(await fetchFn());
    renderFn(data);
  } catch (err) {
    el.innerHTML = `
      <div class="mkt-error-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>Não foi possível carregar os dados.</p>
        <small>${_esc(err?.message || 'Tente novamente.')}</small>
      </div>`;
  }
}

/* ─── Dropdown menu helpers ───────────────────────────────────────────────── */

function _closeAllMenus() {
  document.querySelectorAll('.mkt-dd-menu.open').forEach(m => m.classList.remove('open'));
}

function _bindDropdowns(el) {
  el.querySelectorAll('.mkt-dd-trigger').forEach(trigger => {
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const menu = trigger.closest('.mkt-dd')?.querySelector('.mkt-dd-menu');
      if (!menu) return;
      const isOpen = menu.classList.contains('open');
      _closeAllMenus();
      if (!isOpen) menu.classList.add('open');
    });
  });
  document.addEventListener('click', _closeAllMenus, { once: true });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: CAMPANHAS
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderCampaigns(el) {
  await _safeList(
    () => listCampaigns(_ctx.companyId),
    el,
    (campaigns) => _buildCampaignsUI(el, campaigns)
  );
}

function _buildCampaignsUI(el, campaigns) {
  const stats = _calcCampaignStats(campaigns);
  const chanMap = Object.fromEntries(asArray(CAMPAIGN_CHANNELS).map(c => [c.value, c.label]));

  const hasDrafts = stats.rascunho > 0;

  el.innerHTML = `
    <div class="mkt-section-wrap">
      <div class="mkt-section-toolbar">
        <h3 class="mkt-section-title">Campanhas</h3>
        <button class="mkt-btn-primary" id="mktNewCampaignBtn" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova campanha
        </button>
      </div>

      <!-- Stats strip (real counts) -->
      <div class="mkt-camp-stats">
        ${_statChip('Total', stats.total, '')}
        ${_statChip('Rascunhos', stats.rascunho, 'draft')}
        ${_statChip('Prontas', stats.pronta, 'ready')}
        ${_statChip('Agendadas', stats.agendada, 'scheduled')}
        ${_statChip('Ativas', stats.ativa, 'active')}
        ${_statChip('Pausadas', stats.pausada, 'paused')}
        ${_statChip('Encerradas', stats.encerrada, 'ended')}
      </div>

      ${hasDrafts ? `
      <div class="mkt-draft-notice">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span><strong>Rascunho</strong> significa que a campanha está salva mas ainda não será enviada nem executada. Para ativar, abra a campanha e escolha <em>Ativar agora</em> ou <em>Agendar</em>.</span>
      </div>` : ''}

      ${campaigns.length === 0 ? _emptyState(
          'Nenhuma campanha criada ainda.',
          'Crie sua primeira campanha para começar a engajar seus clientes.'
        ) : `
        <div class="mkt-table-wrap">
          <table class="mkt-table">
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Tipo / Canal</th>
                <th>Público</th>
                <th>Status</th>
                <th>Criado</th>
                <th>Agendado</th>
                <th class="mkt-th-actions">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${campaigns.filter(c => c.status !== 'arquivada').map(c => _campRow(c, chanMap)).join('')}
            </tbody>
          </table>
        </div>
        ${stats.arquivada > 0 ? `
        <p class="mkt-archived-hint">${stats.arquivada} campanha${stats.arquivada > 1 ? 's' : ''} arquivada${stats.arquivada > 1 ? 's' : ''} — não exibidas na tabela.</p>` : ''}
      `}
    </div>`;

  el.querySelector('#mktNewCampaignBtn')?.addEventListener('click', () => _openCampaignModal(el));
  _bindCampaignActions(el, campaigns);
  _bindDropdowns(el);
}

function _calcCampaignStats(campaigns) {
  const stats = { total: campaigns.length, rascunho: 0, pronta: 0, agendada: 0, ativa: 0, pausada: 0, encerrada: 0, arquivada: 0 };
  campaigns.forEach(c => { if (stats[c.status] !== undefined) stats[c.status]++; });
  return stats;
}

function _statChip(label, val, mod) {
  return `<div class="mkt-stat-chip ${mod ? `mkt-stat-${mod}` : ''}"><strong>${val}</strong><span>${_esc(label)}</span></div>`;
}

function _campRow(c, chanMap) {
  const si = _statusInfo(c.status);
  const ch = chanMap[c.channel] || (c.channel || '—');
  const actions = _getActions(c.status);
  const primaries = actions.slice(0, 2);
  const more = actions.slice(2);

  const audienceMap = Object.fromEntries(asArray(CAMPAIGN_AUDIENCES).map(a => [a.value, a.label]));
  const typeMap     = Object.fromEntries(asArray(CAMPAIGN_TYPES).map(t => [t.value, t.label]));

  const typeLabel = typeMap[c.type] || '—';
  const audLabel  = audienceMap[c.audience] || '—';

  return `
    <tr class="mkt-camp-row" data-id="${_esc(c.id)}">
      <td class="mkt-camp-name-cell">
        <strong>${_esc(c.name)}</strong>
        ${c.notes ? `<span class="mkt-camp-notes-hint">${_esc(c.notes.slice(0, 40))}${c.notes.length > 40 ? '…' : ''}</span>` : ''}
      </td>
      <td>
        <span class="mkt-type-lbl">${_esc(typeLabel)}</span>
        <span class="mkt-channel-pill mkt-ch-${_esc(c.channel)}">${_esc(ch)}</span>
      </td>
      <td class="mkt-aud-cell">${_esc(audLabel)}</td>
      <td>
        <span class="mkt-status-pill ${_esc(si.cls)}" title="${_esc(si.desc)}">${_esc(si.label)}</span>
      </td>
      <td class="mkt-date-cell">${_fmt(c.createdAt)}</td>
      <td class="mkt-date-cell">${c.scheduledAt ? _fmtDt(c.scheduledAt) : '—'}</td>
      <td class="mkt-actions-cell">
        ${primaries.map(a => `
          <button class="mkt-icon-btn mkt-camp-action" data-id="${_esc(c.id)}" data-action="${_esc(a)}" title="${_esc(_ACTION_LABEL[a] || a)}" type="button">
            ${_actionIcon(a)}
          </button>`).join('')}
        ${more.length > 0 ? `
        <div class="mkt-dd">
          <button class="mkt-icon-btn mkt-dd-trigger" title="Mais ações" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
          </button>
          <div class="mkt-dd-menu">
            ${more.map(a => `
              <button class="mkt-dd-item ${a === 'delete' ? 'mkt-dd-danger' : ''} mkt-camp-action" data-id="${_esc(c.id)}" data-action="${_esc(a)}" type="button">
                ${_esc(_ACTION_LABEL[a] || a)}
              </button>`).join('')}
          </div>
        </div>` : ''}
      </td>
    </tr>`;
}

function _actionIcon(action) {
  const icons = {
    details:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    edit:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    activate: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    pause:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    resume:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    delete:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  };
  return icons[action] || `<span>${_esc(_ACTION_LABEL[action]?.[0] || '?')}</span>`;
}

function _bindCampaignActions(el, campaigns) {
  el.querySelectorAll('.mkt-camp-action').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      _closeAllMenus();
      const id     = btn.dataset.id;
      const action = btn.dataset.action;
      const camp   = campaigns.find(c => c.id === id);
      if (!camp) return;
      await _handleCampAction(action, camp, el);
    });
  });

  // Row click → details
  el.querySelectorAll('.mkt-camp-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('.mkt-dd')) return;
      const id = row.dataset.id;
      const camp = campaigns.find(c => c.id === id);
      if (camp) _openCampaignDetail(camp, el);
    });
  });
}

async function _handleCampAction(action, camp, el) {
  const companyId = _ctx.companyId;

  switch (action) {
    case 'details':
      _openCampaignDetail(camp, el);
      break;

    case 'edit':
      _openCampaignModal(el, camp);
      break;

    case 'review':
      await _doStatusChange(camp.id, 'pronta', el);
      break;

    case 'activate':
    case 'activate-now':
      await _activateCampaign(camp, el);
      break;

    case 'schedule':
      _openScheduleModal(camp, el);
      break;

    case 'pause':
      await _doStatusChange(camp.id, 'pausada', el);
      break;

    case 'resume':
      await _activateCampaign(camp, el);
      break;

    case 'end':
      if (!confirm(`Encerrar a campanha "${camp.name}"? Esta ação não pode ser desfeita.`)) return;
      await _doStatusChange(camp.id, 'encerrada', el);
      break;

    case 'duplicate':
      await _doDuplicate(camp.id, el);
      break;

    case 'archive':
      if (!confirm(`Arquivar a campanha "${camp.name}"?`)) return;
      await _doStatusChange(camp.id, 'arquivada', el);
      break;

    case 'cancel-schedule':
      await _doStatusChange(camp.id, 'rascunho', el, { scheduledAt: null });
      break;

    case 'restore':
      await _doStatusChange(camp.id, 'rascunho', el);
      break;

    case 'delete':
      if (!confirm(`Excluir permanentemente a campanha "${camp.name}"?`)) return;
      try { await deleteCampaign(camp.id); _renderCampaigns(el); }
      catch (e) { alert(e?.message || 'Erro ao excluir.'); }
      break;
  }
}

async function _activateCampaign(camp, el) {
  const companyId = _ctx.companyId;

  if (camp.channel === 'whatsapp') {
    let waStatus;
    try { waStatus = _waStatusCache || await getWhatsAppIntegrationStatus(companyId); }
    catch { waStatus = { status: WA_STATUS.NOT_CONFIGURED }; }
    _waStatusCache = waStatus;

    if (waStatus?.status !== WA_STATUS.ACTIVE) {
      _openChannelBlockModal('whatsapp', camp, el);
      return;
    }
  }

  if (camp.channel === 'email') {
    let emailCfg;
    try { emailCfg = _emailCfgCache || await getEmailConfig(companyId); }
    catch { emailCfg = null; }
    _emailCfgCache = emailCfg;

    if (!emailCfg?.connected) {
      _openChannelBlockModal('email', camp, el);
      return;
    }
  }

  await _doStatusChange(camp.id, 'ativa', el);
}

async function _doStatusChange(id, newStatus, el, extra = {}) {
  try {
    await updateCampaign(id, { status: newStatus, ...extra });
    _renderCampaigns(el);
  } catch (e) {
    alert(e?.message || 'Erro ao atualizar campanha.');
  }
}

async function _doDuplicate(id, el) {
  try {
    await duplicateCampaign(id);
    _renderCampaigns(el);
  } catch (e) {
    alert(e?.message || 'Erro ao duplicar campanha.');
  }
}

/* ─── Channel block modal ─────────────────────────────────────────────────── */

function _openChannelBlockModal(channel, camp, el) {
  document.getElementById('mktBlockModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktBlockModal';
  modal.className = 'mkt-modal-overlay';

  const isWa = channel === 'whatsapp';
  const icon = isWa
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a9 9 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>`
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;

  const title = isWa ? 'WhatsApp não conectado' : 'E-mail não configurado';
  const msg   = isWa
    ? 'Para ativar campanhas por WhatsApp, conecte primeiro um número em Configurações > Canais de Comunicação > WhatsApp.'
    : 'Para ativar campanhas por E-mail, configure primeiro um provedor em Configurações > Canais de Comunicação > E-mail.';
  const btnLabel = isWa ? 'Conectar WhatsApp' : 'Configurar E-mail';

  modal.innerHTML = `
    <div class="mkt-modal-card mkt-block-modal">
      <div class="mkt-modal-head">
        <h3 class="mkt-modal-title">${_esc(title)}</h3>
        <button class="mkt-modal-close" id="mktBlockClose" type="button">✕</button>
      </div>
      <div class="mkt-block-body">
        <div class="mkt-block-icon">${icon}</div>
        <p>${_esc(msg)}</p>
        <p class="mkt-block-draft-note">A campanha foi salva como <strong>Rascunho</strong> e não será enviada até que o canal esteja configurado e você ative novamente.</p>
        <div class="mkt-block-actions">
          <button class="mkt-btn-ghost" id="mktBlockCancel" type="button">Fechar</button>
          <button class="mkt-btn-primary" id="mktBlockGo" type="button">${_esc(btnLabel)}</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#mktBlockClose')?.addEventListener('click', close);
  modal.querySelector('#mktBlockCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#mktBlockGo')?.addEventListener('click', () => {
    close();
    _openSettingsChannel(channel);
  });
}

/* ─── Campaign detail modal ───────────────────────────────────────────────── */

function _openCampaignDetail(camp, el) {
  document.getElementById('mktDetailModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktDetailModal';
  modal.className = 'mkt-modal-overlay';

  const si = _statusInfo(camp.status);
  const chanMap = Object.fromEntries(asArray(CAMPAIGN_CHANNELS).map(c => [c.value, c.label]));
  const typeMap = Object.fromEntries(asArray(CAMPAIGN_TYPES).map(t => [t.value, t.label]));
  const audMap  = Object.fromEntries(asArray(CAMPAIGN_AUDIENCES).map(a => [a.value, a.label]));

  const actions = _getActions(camp.status);

  modal.innerHTML = `
    <div class="mkt-modal-card mkt-detail-modal">
      <div class="mkt-modal-head">
        <div class="mkt-detail-title-row">
          <h3 class="mkt-modal-title">${_esc(camp.name)}</h3>
          <span class="mkt-status-pill ${_esc(si.cls)}">${_esc(si.label)}</span>
        </div>
        <button class="mkt-modal-close" id="mktDetailClose" type="button">✕</button>
      </div>

      <div class="mkt-detail-next-action">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${_esc(si.next)}</span>
      </div>

      <div class="mkt-detail-grid">
        ${_detailRow('Tipo', typeMap[camp.type] || '—')}
        ${_detailRow('Canal', chanMap[camp.channel] || camp.channel || '—')}
        ${_detailRow('Público', audMap[camp.audience] || camp.audience || '—')}
        ${_detailRow('Criado em', _fmt(camp.createdAt))}
        ${camp.startDate   ? _detailRow('Início', _fmt(camp.startDate))       : ''}
        ${camp.endDate     ? _detailRow('Término', _fmt(camp.endDate))         : ''}
        ${camp.scheduledAt ? _detailRow('Agendado para', _fmtDt(camp.scheduledAt)) : ''}
        ${_detailRow('Última atualização', _fmtDt(camp.updatedAt))}
      </div>

      ${camp.message ? `
      <div class="mkt-detail-section">
        <label class="mkt-detail-label">Mensagem / Conteúdo</label>
        <div class="mkt-detail-message">${_esc(camp.message)}</div>
      </div>` : ''}

      ${camp.notes ? `
      <div class="mkt-detail-section">
        <label class="mkt-detail-label">Observações internas</label>
        <div class="mkt-detail-notes">${_esc(camp.notes)}</div>
      </div>` : ''}

      <div class="mkt-detail-actions">
        <button class="mkt-btn-ghost" id="mktDetailClose2" type="button">Fechar</button>
        ${actions.includes('edit')     ? `<button class="mkt-btn-ghost mkt-detail-act" data-action="edit" type="button">Editar</button>` : ''}
        ${actions.includes('review')   ? `<button class="mkt-btn-ghost mkt-detail-act" data-action="review" type="button">Marcar como pronta</button>` : ''}
        ${actions.includes('schedule') ? `<button class="mkt-btn-ghost mkt-detail-act" data-action="schedule" type="button">Agendar</button>` : ''}
        ${actions.includes('pause')    ? `<button class="mkt-btn-ghost mkt-detail-act" data-action="pause" type="button">Pausar</button>` : ''}
        ${actions.includes('resume')   ? `<button class="mkt-btn-ghost mkt-detail-act" data-action="resume" type="button">Retomar</button>` : ''}
        ${actions.includes('duplicate')? `<button class="mkt-btn-ghost mkt-detail-act" data-action="duplicate" type="button">Duplicar</button>` : ''}
        ${actions.includes('activate') ? `<button class="mkt-btn-primary mkt-detail-act" data-action="activate" type="button">Ativar agora</button>` : ''}
      </div>
    </div>`;

  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#mktDetailClose')?.addEventListener('click', close);
  modal.querySelector('#mktDetailClose2')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelectorAll('.mkt-detail-act').forEach(btn => {
    btn.addEventListener('click', async () => {
      close();
      await _handleCampAction(btn.dataset.action, camp, el);
    });
  });
}

function _detailRow(label, value) {
  return `
    <div class="mkt-detail-row">
      <span class="mkt-detail-label">${_esc(label)}</span>
      <span class="mkt-detail-value">${_esc(value)}</span>
    </div>`;
}

/* ─── Schedule modal ──────────────────────────────────────────────────────── */

function _openScheduleModal(camp, el) {
  document.getElementById('mktScheduleModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktScheduleModal';
  modal.className = 'mkt-modal-overlay';
  modal.innerHTML = `
    <div class="mkt-modal-card">
      <div class="mkt-modal-head">
        <h3 class="mkt-modal-title">Agendar campanha</h3>
        <button class="mkt-modal-close" id="mktSchClose" type="button">✕</button>
      </div>
      <div class="mkt-modal-form">
        <p class="mkt-sched-name">${_esc(camp.name)}</p>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Data e hora de envio *</label>
          <input type="datetime-local" class="mkt-input" id="mktSchDate" value="${camp.scheduledAt ? camp.scheduledAt.slice(0, 16) : ''}">
        </div>
        <p class="mkt-form-error hidden" id="mktSchError"></p>
        <div class="mkt-modal-actions">
          <button class="mkt-btn-ghost" id="mktSchCancel" type="button">Cancelar</button>
          <button class="mkt-btn-primary" id="mktSchSave" type="button">Confirmar agendamento</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#mktSchClose')?.addEventListener('click', close);
  modal.querySelector('#mktSchCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#mktSchSave')?.addEventListener('click', async () => {
    const dt = modal.querySelector('#mktSchDate')?.value;
    const err = modal.querySelector('#mktSchError');
    if (!dt) { _showErr(err, 'Informe a data e hora de envio.'); return; }
    if (new Date(dt) <= new Date()) { _showErr(err, 'A data deve ser futura.'); return; }
    const btn = modal.querySelector('#mktSchSave');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      await updateCampaign(camp.id, { status: 'agendada', scheduledAt: new Date(dt).toISOString() });
      close();
      _renderCampaigns(el);
    } catch (e) {
      _showErr(err, e?.message || 'Erro ao agendar.');
      btn.disabled = false; btn.textContent = 'Confirmar agendamento';
    }
  });
}

/* ─── Campaign create/edit modal ──────────────────────────────────────────── */

function _openCampaignModal(parentEl, existing = null) {
  document.getElementById('mktCampModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktCampModal';
  modal.className = 'mkt-modal-overlay';

  const c = existing || {};
  const isEdit = Boolean(existing);

  modal.innerHTML = `
    <div class="mkt-modal-card mkt-camp-modal-lg">
      <div class="mkt-modal-head">
        <h3 class="mkt-modal-title">${isEdit ? 'Editar campanha' : 'Nova campanha'}</h3>
        <button class="mkt-modal-close" id="mktCampClose" type="button">✕</button>
      </div>
      <form class="mkt-modal-form" id="mktCampForm" novalidate>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Nome da campanha *</label>
          <input class="mkt-input" id="mktCName" placeholder="Ex: Promoção de Verão" maxlength="120" value="${_esc(c.name || '')}" required>
        </div>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">Tipo de campanha</label>
            <select class="mkt-select" id="mktCType">
              ${asArray(CAMPAIGN_TYPES).map(t => `<option value="${_esc(t.value)}" ${c.type === t.value ? 'selected' : ''}>${_esc(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Canal de envio *</label>
            <select class="mkt-select" id="mktCChannel">
              ${asArray(CAMPAIGN_CHANNELS).map(ch => `<option value="${_esc(ch.value)}" ${c.channel === ch.value ? 'selected' : ''}>${_esc(ch.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Público-alvo *</label>
          <select class="mkt-select" id="mktCAudience">
            ${asArray(CAMPAIGN_AUDIENCES).map(a => `<option value="${_esc(a.value)}" ${c.audience === a.value ? 'selected' : ''}>${_esc(a.label)}</option>`).join('')}
          </select>
        </div>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Mensagem / Conteúdo *</label>
          <textarea class="mkt-textarea" id="mktCMsg" rows="4" placeholder="Conteúdo da mensagem ou descrição da campanha..." maxlength="2000">${_esc(c.message || '')}</textarea>
        </div>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">Data de início</label>
            <input type="date" class="mkt-input" id="mktCStart" value="${c.startDate ? c.startDate.slice(0,10) : ''}">
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Data de término (opcional)</label>
            <input type="date" class="mkt-input" id="mktCEnd" value="${c.endDate ? c.endDate.slice(0,10) : ''}">
          </div>
        </div>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Observações internas</label>
          <input class="mkt-input" id="mktCNotes" placeholder="Notas internas sobre esta campanha..." maxlength="500" value="${_esc(c.notes || '')}">
        </div>
        <div id="mktCChannelWarn" class="mkt-camp-channel-warn hidden"></div>
        <p class="mkt-form-error hidden" id="mktCampError"></p>
        <div class="mkt-modal-actions mkt-camp-actions-row">
          <button class="mkt-btn-ghost" id="mktCampCancel" type="button">Cancelar</button>
          <button class="mkt-btn-ghost" id="mktCampDraft" type="button">Salvar rascunho</button>
          <button class="mkt-btn-ghost" id="mktCampReview" type="button">Marcar como pronta</button>
          <button class="mkt-btn-ghost" id="mktCampSchedule" type="button">Agendar</button>
          <button class="mkt-btn-primary" id="mktCampActivate" type="button">Ativar agora</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#mktCampClose')?.addEventListener('click', close);
  modal.querySelector('#mktCampCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  // Channel warning on select change
  const chanSel = modal.querySelector('#mktCChannel');
  chanSel?.addEventListener('change', () => _checkChannelWarn(modal));
  _checkChannelWarn(modal);

  async function _collectAndSave(targetStatus, scheduledAt = null) {
    const name     = modal.querySelector('#mktCName')?.value.trim();
    const channel  = modal.querySelector('#mktCChannel')?.value;
    const audience = modal.querySelector('#mktCAudience')?.value;
    const message  = modal.querySelector('#mktCMsg')?.value.trim();
    const errEl    = modal.querySelector('#mktCampError');

    if (!name)     { _showErr(errEl, 'Informe o nome da campanha.'); return false; }
    if (!channel)  { _showErr(errEl, 'Selecione o canal.'); return false; }
    if (!audience) { _showErr(errEl, 'Selecione o público-alvo.'); return false; }
    if (!message)  { _showErr(errEl, 'Informe a mensagem ou conteúdo.'); return false; }

    if (targetStatus === 'agendada' && !scheduledAt) { _showErr(errEl, 'Selecione a data/hora de agendamento.'); return false; }

    const data = {
      companyId: _ctx.companyId,
      name,
      type:      modal.querySelector('#mktCType')?.value || 'outro',
      channel,
      audience,
      message,
      startDate: modal.querySelector('#mktCStart')?.value || null,
      endDate:   modal.querySelector('#mktCEnd')?.value   || null,
      notes:     modal.querySelector('#mktCNotes')?.value.trim() || '',
      scheduledAt,
    };

    try {
      if (isEdit) {
        await updateCampaign(existing.id, { ...data, status: targetStatus });
      } else {
        const created = await createCampaign(data);
        if (targetStatus !== 'rascunho') {
          await updateCampaign(created.id, { status: targetStatus, scheduledAt });
        }
      }
      return true;
    } catch (e) {
      _showErr(errEl, e?.message || 'Erro ao salvar.'); return false;
    }
  }

  function _setLoading(btnId, loading) {
    const btn = modal.querySelector(`#${btnId}`);
    if (btn) { btn.disabled = loading; if (!loading) btn.textContent = btn.dataset.label || btn.textContent; }
  }

  // Salvar rascunho
  modal.querySelector('#mktCampDraft')?.addEventListener('click', async () => {
    _setLoading('mktCampDraft', true);
    if (await _collectAndSave('rascunho')) { close(); _renderCampaigns(parentEl); }
    else _setLoading('mktCampDraft', false);
  });

  // Marcar como pronta
  modal.querySelector('#mktCampReview')?.addEventListener('click', async () => {
    _setLoading('mktCampReview', true);
    if (await _collectAndSave('pronta')) { close(); _renderCampaigns(parentEl); }
    else _setLoading('mktCampReview', false);
  });

  // Agendar — opens date/time prompt
  modal.querySelector('#mktCampSchedule')?.addEventListener('click', async () => {
    const name = modal.querySelector('#mktCName')?.value.trim();
    const channel = modal.querySelector('#mktCChannel')?.value;
    const message = modal.querySelector('#mktCMsg')?.value.trim();
    const errEl   = modal.querySelector('#mktCampError');
    if (!name)    { _showErr(errEl, 'Informe o nome antes de agendar.'); return; }
    if (!channel) { _showErr(errEl, 'Selecione o canal.'); return; }
    if (!message) { _showErr(errEl, 'Informe a mensagem.'); return; }

    const dt = prompt('Informe a data e hora do agendamento (DD/MM/AAAA HH:mm):', '');
    if (!dt) return;
    const parsed = _parseLocalDateTime(dt);
    if (!parsed || parsed <= new Date()) { alert('Data inválida ou no passado. Use o formato DD/MM/AAAA HH:mm.'); return; }

    _setLoading('mktCampSchedule', true);
    if (await _collectAndSave('agendada', parsed.toISOString())) { close(); _renderCampaigns(parentEl); }
    else _setLoading('mktCampSchedule', false);
  });

  // Ativar agora
  modal.querySelector('#mktCampActivate')?.addEventListener('click', async () => {
    const name    = modal.querySelector('#mktCName')?.value.trim();
    const channel = modal.querySelector('#mktCChannel')?.value;
    const message = modal.querySelector('#mktCMsg')?.value.trim();
    const errEl   = modal.querySelector('#mktCampError');
    if (!name)    { _showErr(errEl, 'Informe o nome.'); return; }
    if (!message) { _showErr(errEl, 'Informe a mensagem.'); return; }

    // Channel validation
    if (channel === 'whatsapp') {
      let waStatus;
      try { waStatus = _waStatusCache || await getWhatsAppIntegrationStatus(_ctx.companyId); }
      catch { waStatus = { status: WA_STATUS.NOT_CONFIGURED }; }
      _waStatusCache = waStatus;
      if (waStatus?.status !== WA_STATUS.ACTIVE) {
        _showErr(errEl, 'WhatsApp não conectado. Salve como rascunho e conecte o canal antes de ativar.');
        return;
      }
    }
    if (channel === 'email') {
      let emailCfg;
      try { emailCfg = _emailCfgCache || await getEmailConfig(_ctx.companyId); }
      catch { emailCfg = null; }
      _emailCfgCache = emailCfg;
      if (!emailCfg?.connected) {
        _showErr(errEl, 'E-mail não configurado. Salve como rascunho e configure o e-mail antes de ativar.');
        return;
      }
    }

    _setLoading('mktCampActivate', true);
    if (await _collectAndSave('ativa')) { close(); _renderCampaigns(parentEl); }
    else _setLoading('mktCampActivate', false);
  });
}

async function _checkChannelWarn(modal) {
  const channel = modal.querySelector('#mktCChannel')?.value;
  const warnEl  = modal.querySelector('#mktCChannelWarn');
  if (!warnEl) return;

  if (channel === 'whatsapp') {
    let waStatus;
    try { waStatus = _waStatusCache || await getWhatsAppIntegrationStatus(_ctx.companyId); }
    catch { waStatus = { status: WA_STATUS.NOT_CONFIGURED }; }
    _waStatusCache = waStatus;

    if (waStatus?.status !== WA_STATUS.ACTIVE) {
      warnEl.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Canal WhatsApp não conectado. Você pode salvar como rascunho, mas não poderá ativar até conectar.
        <button class="mkt-warn-link" id="mktCampWaLink" type="button">Conectar agora</button>`;
      warnEl.classList.remove('hidden');
      warnEl.querySelector('#mktCampWaLink')?.addEventListener('click', () => {
        document.getElementById('mktCampModal')?.remove();
        _openSettingsChannel('whatsapp');
      });
      return;
    }
  }

  if (channel === 'email') {
    let emailCfg;
    try { emailCfg = _emailCfgCache || await getEmailConfig(_ctx.companyId); }
    catch { emailCfg = null; }
    _emailCfgCache = emailCfg;

    if (!emailCfg?.connected) {
      warnEl.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        E-mail não configurado. Você pode salvar como rascunho, mas não poderá ativar até configurar.
        <button class="mkt-warn-link" id="mktCampEmailLink" type="button">Configurar agora</button>`;
      warnEl.classList.remove('hidden');
      warnEl.querySelector('#mktCampEmailLink')?.addEventListener('click', () => {
        document.getElementById('mktCampModal')?.remove();
        _openSettingsChannel('email');
      });
      return;
    }
  }

  warnEl.classList.add('hidden');
}

function _parseLocalDateTime(str) {
  try {
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: CLIENTES
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderCustomers(el) {
  await _safeList(
    () => listMarketingCustomers(_ctx.companyId),
    el,
    (customers) => {
      el.innerHTML = `
        <div class="mkt-section-wrap">
          <div class="mkt-section-toolbar">
            <h3 class="mkt-section-title">Clientes para marketing</h3>
            <button class="mkt-btn-primary" id="mktNewCustomerBtn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Adicionar cliente
            </button>
          </div>
          ${customers.length === 0 ? _emptyState(
              'Nenhum cliente cadastrado ainda.',
              'Adicione clientes para enviar campanhas segmentadas.'
            ) : `
            <div class="mkt-table-wrap">
              <table class="mkt-table">
                <thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Tags</th><th>Opt-in</th><th></th></tr></thead>
                <tbody>
                  ${customers.map(c => `
                    <tr>
                      <td><strong>${_esc(c.name)}</strong></td>
                      <td>${_esc(c.email || '—')}</td>
                      <td>${_esc(c.phone || '—')}</td>
                      <td>${asArray(c.tags).map(t => `<span class="mkt-tag">${_esc(t)}</span>`).join('') || '—'}</td>
                      <td><span class="mkt-optin-badge ${c.optedIn ? 'optin-yes' : 'optin-no'}">${c.optedIn ? 'Ativo' : 'Inativo'}</span></td>
                      <td>
                        <button class="mkt-action-btn mkt-del-btn" data-id="${_esc(c.id)}" title="Remover" type="button">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>`;

      el.querySelector('#mktNewCustomerBtn')?.addEventListener('click', () => _openCustomerModal(el));
      el.querySelectorAll('.mkt-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remover este cliente?')) return;
          try { await deleteMarketingCustomer(btn.dataset.id); _renderCustomers(el); }
          catch (e) { alert(e?.message || 'Erro.'); }
        });
      });
    }
  );
}

function _openCustomerModal(parentEl) {
  document.getElementById('mktCustModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktCustModal';
  modal.className = 'mkt-modal-overlay';
  modal.innerHTML = `
    <div class="mkt-modal-card">
      <div class="mkt-modal-head">
        <h3 class="mkt-modal-title">Adicionar cliente</h3>
        <button class="mkt-modal-close" id="mktCustClose" type="button">✕</button>
      </div>
      <form class="mkt-modal-form" id="mktCustForm" novalidate>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Nome *</label>
          <input class="mkt-input" id="mktCustName" placeholder="Nome do cliente" maxlength="100" required>
        </div>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">E-mail</label>
            <input class="mkt-input" id="mktCustEmail" type="email" placeholder="email@exemplo.com" maxlength="100">
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Telefone</label>
            <input class="mkt-input" id="mktCustPhone" type="tel" placeholder="(00) 00000-0000" maxlength="20">
          </div>
        </div>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Tags (separadas por vírgula)</label>
          <input class="mkt-input" id="mktCustTags" placeholder="Ex: vip, frequente" maxlength="200">
        </div>
        <p class="mkt-form-error hidden" id="mktCustError"></p>
        <div class="mkt-modal-actions">
          <button class="mkt-btn-ghost" id="mktCustCancel" type="button">Cancelar</button>
          <button class="mkt-btn-primary" id="mktCustSave" type="submit">Salvar</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#mktCustClose')?.addEventListener('click', close);
  modal.querySelector('#mktCustCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#mktCustForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = modal.querySelector('#mktCustName')?.value.trim();
    const errEl = modal.querySelector('#mktCustError');
    if (!name) { _showErr(errEl, 'Informe o nome do cliente.'); return; }
    const saveBtn = modal.querySelector('#mktCustSave');
    saveBtn.disabled = true; saveBtn.textContent = 'Salvando...';
    try {
      const rawTags = modal.querySelector('#mktCustTags')?.value || '';
      await createMarketingCustomer({
        companyId: _ctx.companyId, name,
        email:     modal.querySelector('#mktCustEmail')?.value.trim() || '',
        phone:     modal.querySelector('#mktCustPhone')?.value.trim() || '',
        tags:      rawTags.split(',').map(t => t.trim()).filter(Boolean),
        optedIn:   true,
      });
      close(); _renderCustomers(parentEl);
    } catch (err) {
      _showErr(errEl, err?.message || 'Erro ao salvar.');
      saveBtn.disabled = false; saveBtn.textContent = 'Salvar';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: CUPONS
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderCoupons(el) {
  await _safeList(
    () => listCoupons(_ctx.companyId),
    el,
    (coupons) => {
      el.innerHTML = `
        <div class="mkt-section-wrap">
          <div class="mkt-section-toolbar">
            <h3 class="mkt-section-title">Cupons de desconto</h3>
            <button class="mkt-btn-primary" id="mktNewCouponBtn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Novo cupom
            </button>
          </div>
          ${coupons.length === 0 ? _emptyState(
              'Nenhum cupom criado ainda.',
              'Crie cupons de desconto para atrair e fidelizar clientes.'
            ) : `
            <div class="mkt-table-wrap">
              <table class="mkt-table">
                <thead><tr><th>Código</th><th>Tipo</th><th>Desconto</th><th>Usos</th><th>Validade</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  ${coupons.map(c => {
                    const typeLabel = c.type === 'percent' ? `${c.value}% off` : `R$ ${Number(c.value).toFixed(2).replace('.', ',')}`;
                    const exp = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('pt-BR') : 'Sem validade';
                    const uses = c.maxUses ? `${c.usedCount}/${c.maxUses}` : String(c.usedCount ?? 0);
                    return `
                      <tr>
                        <td><code class="mkt-coupon-code">${_esc(c.code)}</code></td>
                        <td>${c.type === 'percent' ? 'Percentual' : 'Valor fixo'}</td>
                        <td><strong>${_esc(typeLabel)}</strong></td>
                        <td>${_esc(uses)}</td>
                        <td>${_esc(exp)}</td>
                        <td><span class="mkt-optin-badge ${c.active ? 'optin-yes' : 'optin-no'}">${c.active ? 'Ativo' : 'Inativo'}</span></td>
                        <td class="mkt-actions-cell">
                          <button class="mkt-action-btn mkt-toggle-coupon-btn" data-id="${_esc(c.id)}" data-active="${c.active}" title="${c.active ? 'Desativar' : 'Ativar'}" type="button">
                            ${c.active ? '⏸' : '▶'}
                          </button>
                          <button class="mkt-action-btn mkt-del-btn" data-id="${_esc(c.id)}" title="Excluir" type="button">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>`;

      el.querySelector('#mktNewCouponBtn')?.addEventListener('click', () => _openCouponModal(el));
      el.querySelectorAll('.mkt-toggle-coupon-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try { await toggleCoupon(btn.dataset.id, btn.dataset.active !== 'true'); _renderCoupons(el); }
          catch (e) { alert(e?.message || 'Erro.'); }
        });
      });
      el.querySelectorAll('.mkt-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir este cupom?')) return;
          try { await deleteCoupon(btn.dataset.id); _renderCoupons(el); }
          catch (e) { alert(e?.message || 'Erro.'); }
        });
      });
    }
  );
}

function _openCouponModal(parentEl) {
  document.getElementById('mktCouponModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktCouponModal';
  modal.className = 'mkt-modal-overlay';
  modal.innerHTML = `
    <div class="mkt-modal-card">
      <div class="mkt-modal-head">
        <h3 class="mkt-modal-title">Novo cupom</h3>
        <button class="mkt-modal-close" id="mktCouponClose" type="button">✕</button>
      </div>
      <form class="mkt-modal-form" id="mktCouponForm" novalidate>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">Código *</label>
            <input class="mkt-input" id="mktCouponCode" placeholder="PROMO10" maxlength="30" required>
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Tipo</label>
            <select class="mkt-select" id="mktCouponType">
              <option value="percent">Percentual (%)</option>
              <option value="fixed">Valor fixo (R$)</option>
            </select>
          </div>
        </div>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">Valor *</label>
            <input class="mkt-input" id="mktCouponValue" type="number" min="0.01" step="0.01" placeholder="10" required>
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Máx. de usos</label>
            <input class="mkt-input" id="mktCouponMaxUses" type="number" min="1" placeholder="Ilimitado">
          </div>
        </div>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">Pedido mínimo (R$)</label>
            <input class="mkt-input" id="mktCouponMinOrder" type="number" min="0" step="0.01" placeholder="0">
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Validade</label>
            <input class="mkt-input" id="mktCouponExpires" type="date">
          </div>
        </div>
        <p class="mkt-form-error hidden" id="mktCouponError"></p>
        <div class="mkt-modal-actions">
          <button class="mkt-btn-ghost" id="mktCouponCancel" type="button">Cancelar</button>
          <button class="mkt-btn-primary" id="mktCouponSave" type="submit">Criar cupom</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#mktCouponClose')?.addEventListener('click', close);
  modal.querySelector('#mktCouponCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const codeEl = modal.querySelector('#mktCouponCode');
  codeEl?.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); });
  modal.querySelector('#mktCouponForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const code  = codeEl?.value.trim();
    const value = parseFloat(modal.querySelector('#mktCouponValue')?.value);
    const errEl = modal.querySelector('#mktCouponError');
    if (!code)  { _showErr(errEl, 'Informe o código do cupom.'); return; }
    if (!value || value <= 0) { _showErr(errEl, 'Informe um valor válido.'); return; }
    const saveBtn = modal.querySelector('#mktCouponSave');
    saveBtn.disabled = true; saveBtn.textContent = 'Criando...';
    try {
      await createCoupon({
        companyId: _ctx.companyId, code, value,
        type:      modal.querySelector('#mktCouponType')?.value || 'percent',
        maxUses:   modal.querySelector('#mktCouponMaxUses')?.value || null,
        minOrder:  modal.querySelector('#mktCouponMinOrder')?.value || 0,
        expiresAt: modal.querySelector('#mktCouponExpires')?.value || null,
      });
      close(); _renderCoupons(parentEl);
    } catch (err) {
      _showErr(errEl, err?.message || 'Erro ao criar cupom.');
      saveBtn.disabled = false; saveBtn.textContent = 'Criar cupom';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: AUTOMAÇÃO
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderAutomation(el) {
  await _safeList(
    () => listAutomations(_ctx.companyId),
    el,
    (automations) => {
      const trigMap = Object.fromEntries(asArray(AUTOMATION_TRIGGERS).map(t => [t.value, t]));
      const actMap  = Object.fromEntries(asArray(AUTOMATION_ACTIONS).map(a => [a.value, a]));
      el.innerHTML = `
        <div class="mkt-section-wrap">
          <div class="mkt-section-toolbar">
            <h3 class="mkt-section-title">Automações de marketing</h3>
            <button class="mkt-btn-primary" id="mktNewAutoBtn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nova automação
            </button>
          </div>
          ${automations.length === 0 ? _emptyState(
              'Nenhuma automação criada ainda.',
              'Crie automações para enviar mensagens automáticas em momentos-chave da jornada do cliente.'
            ) : `
            <div class="mkt-auto-list">
              ${automations.map(a => {
                const trig = trigMap[a.trigger]?.label || (a.trigger || '—');
                const act  = actMap[a.action]?.label  || (a.action  || '—');
                return `
                  <div class="mkt-auto-card">
                    <div class="mkt-auto-main">
                      <strong class="mkt-auto-name">${_esc(a.name)}</strong>
                      <div class="mkt-auto-flow">
                        <span class="mkt-auto-trigger">${_esc(trig)}</span>
                        <span class="mkt-auto-arrow">→</span>
                        <span class="mkt-auto-action">${_esc(act)}</span>
                      </div>
                      <span class="mkt-auto-runs">${a.runCount ?? 0} execuções</span>
                    </div>
                    <div class="mkt-auto-controls">
                      <button class="mkt-toggle-btn ${a.active ? 'mkt-toggle-on' : 'mkt-toggle-off'} mkt-toggle-auto-btn" data-id="${_esc(a.id)}" data-active="${a.active}" type="button">
                        ${a.active ? 'ON' : 'OFF'}
                      </button>
                      <button class="mkt-action-btn mkt-del-btn" data-id="${_esc(a.id)}" title="Excluir" type="button">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          `}
        </div>`;
      el.querySelector('#mktNewAutoBtn')?.addEventListener('click', () => _openAutomationModal(el));
      el.querySelectorAll('.mkt-toggle-auto-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try { await toggleAutomation(btn.dataset.id, btn.dataset.active !== 'true'); _renderAutomation(el); }
          catch (e) { alert(e?.message || 'Erro.'); }
        });
      });
      el.querySelectorAll('.mkt-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir esta automação?')) return;
          try { await deleteAutomation(btn.dataset.id); _renderAutomation(el); }
          catch (e) { alert(e?.message || 'Erro.'); }
        });
      });
    }
  );
}

function _openAutomationModal(parentEl) {
  document.getElementById('mktAutoModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'mktAutoModal';
  modal.className = 'mkt-modal-overlay';
  modal.innerHTML = `
    <div class="mkt-modal-card">
      <div class="mkt-modal-head">
        <h3 class="mkt-modal-title">Nova automação</h3>
        <button class="mkt-modal-close" id="mktAutoClose" type="button">✕</button>
      </div>
      <form class="mkt-modal-form" id="mktAutoForm" novalidate>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Nome *</label>
          <input class="mkt-input" id="mktAutoName" placeholder="Ex: Boas-vindas novo cliente" maxlength="100" required>
        </div>
        <div class="mkt-form-2col">
          <div class="mkt-field-group">
            <label class="mkt-field-label">Gatilho (quando enviar)</label>
            <select class="mkt-select" id="mktAutoTrigger">
              ${asArray(AUTOMATION_TRIGGERS).map(t => `<option value="${_esc(t.value)}">${_esc(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="mkt-field-group">
            <label class="mkt-field-label">Ação (o que fazer)</label>
            <select class="mkt-select" id="mktAutoAction">
              ${asArray(AUTOMATION_ACTIONS).map(a => `<option value="${_esc(a.value)}">${_esc(a.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="mkt-field-group">
          <label class="mkt-field-label">Mensagem</label>
          <textarea class="mkt-textarea" id="mktAutoMsg" rows="4" placeholder="Conteúdo da mensagem automática..." maxlength="1000"></textarea>
        </div>
        <p class="mkt-form-error hidden" id="mktAutoError"></p>
        <div class="mkt-modal-actions">
          <button class="mkt-btn-ghost" id="mktAutoCancel" type="button">Cancelar</button>
          <button class="mkt-btn-primary" id="mktAutoSave" type="submit">Criar automação</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#mktAutoClose')?.addEventListener('click', close);
  modal.querySelector('#mktAutoCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#mktAutoForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = modal.querySelector('#mktAutoName')?.value.trim();
    const errEl = modal.querySelector('#mktAutoError');
    if (!name) { _showErr(errEl, 'Informe o nome da automação.'); return; }
    const saveBtn = modal.querySelector('#mktAutoSave');
    saveBtn.disabled = true; saveBtn.textContent = 'Criando...';
    try {
      await createAutomation({
        companyId: _ctx.companyId, name,
        trigger:   modal.querySelector('#mktAutoTrigger')?.value,
        action:    modal.querySelector('#mktAutoAction')?.value,
        message:   modal.querySelector('#mktAutoMsg')?.value.trim(),
        channel:   'email',
      });
      close(); _renderAutomation(parentEl);
    } catch (err) {
      _showErr(errEl, err?.message || 'Erro ao criar automação.');
      saveBtn.disabled = false; saveBtn.textContent = 'Criar automação';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: WHATSAPP
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderWhatsApp(el) {
  el.innerHTML = `<div class="mkt-loading">Verificando integração WhatsApp...</div>`;
  try {
    const [waStatus, conversations] = await Promise.all([
      getWhatsAppIntegrationStatus(_ctx.companyId),
      listWhatsAppConversations(_ctx.companyId),
    ]);

    const st = waStatus?.status;
    const isActive = st === WA_STATUS.ACTIVE;
    const isConfigured = st === WA_STATUS.CONFIGURED;

    if (!isActive && !isConfigured) {
      el.innerHTML = `
        <div class="mkt-section-wrap">
          <div class="mkt-wa-not-connected">
            <div class="mkt-wa-nc-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a9 9 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
            </div>
            <h3>WhatsApp não conectado</h3>
            <p>Conecte um canal de WhatsApp para enviar mensagens, usar automações e centralizar conversas com seus clientes.</p>
            <div class="mkt-wa-nc-btns">
              <button class="mkt-btn-primary" id="mktWaGotoSettings" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Configurar WhatsApp
              </button>
            </div>
            <p class="mkt-wa-nc-hint">Acessa direto: <strong>Configurações → Canais de Comunicação → WhatsApp</strong></p>
          </div>
        </div>`;
      el.querySelector('#mktWaGotoSettings')?.addEventListener('click', () => _openSettingsChannel('whatsapp'));
      return;
    }

    const convs = asArray(conversations);
    const statusLabel = {
      [WA_STATUS.ACTIVE]:       'Ativo',
      [WA_STATUS.CONFIGURED]:   'Configurado',
      [WA_STATUS.DISCONNECTED]: 'Desconectado',
      [WA_STATUS.ERROR]:        'Erro de conexão',
    }[st] || 'Configurado';

    el.innerHTML = `
      <div class="mkt-section-wrap">
        <div class="mkt-wa-status-bar">
          <div class="mkt-wa-status-left">
            <span class="mkt-wa-status-dot ${isActive ? 'dot-green' : 'dot-yellow'}"></span>
            <div>
              <strong>${_esc(statusLabel)}</strong>
              <span>WhatsApp Business${waStatus.phone ? ` · ${_esc(waStatus.phone)}` : ''}</span>
            </div>
          </div>
          <button class="mkt-btn-ghost mkt-wa-settings-btn" id="mktWaManageBtn" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Gerenciar integração
          </button>
        </div>
        <h3 class="mkt-section-title">Conversas recentes</h3>
        ${convs.length === 0 ? `
          <div class="mkt-empty-state">
            <div class="mkt-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
            <p>Nenhuma conversa recebida ainda.</p>
            <small>As conversas aparecerão aqui quando o canal estiver ativo e receber mensagens.</small>
          </div>
        ` : convs.map(c => `
          <div class="mkt-conv-row">
            <div class="mkt-conv-avatar">${_esc((c.name || c.phone || '?')[0].toUpperCase())}</div>
            <div class="mkt-conv-body">
              <strong>${_esc(c.name || c.phone || 'Desconhecido')}</strong>
              <span>${_esc(c.lastMessage || '—')}</span>
            </div>
            <span class="mkt-conv-time">${c.lastAt ? _fmtDt(c.lastAt) : ''}</span>
          </div>`).join('')}
      </div>`;

    el.querySelector('#mktWaManageBtn')?.addEventListener('click', () => _openSettingsChannel('whatsapp'));

  } catch (err) {
    el.innerHTML = `<div class="mkt-error-state"><p>Erro ao carregar integração WhatsApp: ${_esc(err?.message || '')}</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: E-MAIL
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderEmail(el) {
  el.innerHTML = `<div class="mkt-loading">Verificando configuração de e-mail...</div>`;
  try {
    const cfg = await getEmailConfig(_ctx.companyId);
    const isConnected = Boolean(cfg?.connected);

    el.innerHTML = `
      <div class="mkt-section-wrap">
        <div class="mkt-email-status-card ${isConnected ? 'mkt-email-ok' : 'mkt-email-nc'}">
          <div class="mkt-email-status-icon">
            ${isConnected
              ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
              : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.7"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`}
          </div>
          <div class="mkt-email-status-body">
            <strong>${isConnected ? 'E-mail configurado' : 'E-mail não configurado'}</strong>
            <span>${isConnected
              ? `Remetente: ${_esc(cfg.fromName || '')} &lt;${_esc(cfg.fromEmail || '')}&gt; via ${_esc(cfg.provider || '—')}`
              : 'Configure um provedor de e-mail para enviar campanhas, automações e notificações.'}</span>
          </div>
          <div class="mkt-email-status-action">
            <button class="mkt-btn-primary" id="mktEmailConfigBtn" type="button">
              ${isConnected ? 'Gerenciar configuração' : 'Configurar E-mail'}
            </button>
          </div>
        </div>

        ${isConnected ? `
        <div class="mkt-email-info-grid">
          <div class="mkt-email-info-row"><span>Provedor</span><strong>${_esc(cfg.provider || '—')}</strong></div>
          <div class="mkt-email-info-row"><span>Remetente</span><strong>${_esc(cfg.fromEmail || '—')}</strong></div>
          <div class="mkt-email-info-row"><span>Servidor SMTP</span><strong>${_esc(cfg.smtpHost || '—')}</strong></div>
          <div class="mkt-email-info-row"><span>Última atualização</span><strong>${_fmt(cfg.updatedAt)}</strong></div>
        </div>
        <div class="mkt-email-note">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          As credenciais sensíveis (API Key, senha SMTP) são armazenadas apenas no backend. Não são salvas no navegador.
        </div>
        ` : `
        <div class="mkt-email-guide">
          <h4>Como configurar o e-mail</h4>
          <ol>
            <li>Clique em <strong>Configurar E-mail</strong> acima</li>
            <li>Escolha seu provedor (SMTP, SendGrid, Mailgun, SES ou Brevo)</li>
            <li>Preencha as credenciais de acesso</li>
            <li>Clique em <strong>Testar conexão</strong> para verificar</li>
            <li>Salve e volte para criar campanhas de e-mail</li>
          </ol>
        </div>
        `}
      </div>`;

    el.querySelector('#mktEmailConfigBtn')?.addEventListener('click', () => _openSettingsChannel('email'));

  } catch (err) {
    el.innerHTML = `<div class="mkt-error-state"><p>Erro ao verificar e-mail: ${_esc(err?.message || 'Tente novamente.')}</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: RELATÓRIOS
   ═══════════════════════════════════════════════════════════════════════════ */

async function _renderReports(el) {
  el.innerHTML = `<div class="mkt-loading">Gerando relatório...</div>`;
  try {
    const report = await getMarketingReport(_ctx.companyId);
    if (!report || (report.totalCampaigns === 0 && report.totalCustomers === 0 && report.activeCoupons === 0)) {
      el.innerHTML = `
        <div class="mkt-empty-state">
          <div class="mkt-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
          <h3>Sem dados suficientes para gerar relatórios.</h3>
          <p>Crie campanhas, cadastre clientes ou configure cupons para visualizar métricas aqui.</p>
        </div>`;
      return;
    }
    el.innerHTML = `
      <div class="mkt-section-wrap">
        <h3 class="mkt-section-title">Resumo de marketing</h3>
        <div class="mkt-report-grid">
          ${_reportCard('Campanhas criadas',    report.totalCampaigns,  'Total',       'purple')}
          ${_reportCard('Campanhas ativas',     report.activeCampaigns, 'Ativas',      'green')}
          ${_reportCard('Clientes cadastrados', report.totalCustomers,  'Lista',       'blue')}
          ${_reportCard('Cupons ativos',        report.activeCoupons,   'Disponíveis', 'yellow')}
          ${_reportCard('Cupons utilizados',    report.usedCoupons,     'Resgates',    'muted')}
          ${_reportCard('Automações ativas',    report.automationsOn,   'Rodando',     'green')}
        </div>
        <div class="mkt-report-note-card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Métricas detalhadas de abertura, cliques e conversão estarão disponíveis após integração com o provedor de envio.
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="mkt-error-state"><p>Erro: ${_esc(err?.message || 'Tente novamente.')}</p></div>`;
  }
}

/* ─── Shared UI helpers ───────────────────────────────────────────────────── */

function _emptyState(title, sub) {
  return `
    <div class="mkt-empty-state">
      <div class="mkt-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div>
      <h3>${_esc(title)}</h3>
      <p>${_esc(sub)}</p>
    </div>`;
}

function _reportCard(label, value, note, color) {
  return `
    <div class="mkt-report-card mkt-kpi-${_esc(color)}">
      <strong class="mkt-report-value">${value ?? 0}</strong>
      <span class="mkt-report-label">${_esc(label)}</span>
      <small class="mkt-report-note">${_esc(note)}</small>
    </div>`;
}

function _showErr(el, msg) { if (!el) return; el.textContent = msg; el.classList.remove('hidden'); }
function _showOk(el, msg)  { if (!el) return; el.textContent = msg; el.classList.remove('hidden'); }
