/**
 * Customer Success Platform — Fase 8 GAMBY
 * Painel completo com 5 sub-tabs:
 *   1. Visão Geral    — KPIs da carteira
 *   2. Health Scores  — Ranking de empresas
 *   3. Empresas em Risco — Ordenadas por probabilidade de cancelamento
 *   4. Recomendações  — Fila de ações CS
 *   5. Customer Success AI — Digital Account Manager
 */

import { getAuthToken } from './http.js';

const API = () => window.GAMBY_CONFIG?.apiUrl || 'http://localhost:4001';
const BASE = '/v1/customer-success';

function _authHeaders() {
  const token = getAuthToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function apiFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${API()}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { ..._authHeaders(), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Estado ───────────────────────────────────────────────────────────────────

let _tab      = 'overview';
let _shell    = null;
let _aiConvId = null;
let _initialized = false;

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export function initCustomerSuccess() {
  _shell = document.getElementById('csShell');
  if (!_shell) return;
  if (_initialized) { _render(); return; }
  _initialized = true;
  _shell.innerHTML = _buildShell();
  _bindTabClicks();
  _render();
}

// ─── Estrutura base ───────────────────────────────────────────────────────────

function _buildShell() {
  return `
    <div class="cs-header">
      <div class="cs-header-left">
        <h2 class="cs-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cs-title-icon"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          Customer Success Platform
        </h2>
        <p class="cs-subtitle">Monitoramento inteligente da carteira de clientes GAMBY</p>
      </div>
    </div>
    <nav class="cs-tabs">
      <button class="cs-tab active" data-cs-tab="overview">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Visão Geral
      </button>
      <button class="cs-tab" data-cs-tab="health-scores">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Health Scores
      </button>
      <button class="cs-tab" data-cs-tab="risks">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Empresas em Risco
      </button>
      <button class="cs-tab" data-cs-tab="recommendations">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Recomendações
      </button>
      <button class="cs-tab" data-cs-tab="cs-ai">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        CS AI
      </button>
    </nav>
    <div class="cs-content" id="csContent">
      <div class="cs-loading">Carregando...</div>
    </div>
  `;
}

function _bindTabClicks() {
  _shell.querySelectorAll('.cs-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      _shell.querySelectorAll('.cs-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _tab = btn.dataset.csTab;
      _render();
    });
  });
}

function _render() {
  const content = document.getElementById('csContent');
  if (!content) return;
  content.innerHTML = '<div class="cs-loading"><div class="cs-spinner"></div> Carregando...</div>';

  switch (_tab) {
    case 'overview':        _renderOverview(content); break;
    case 'health-scores':   _renderHealthScores(content); break;
    case 'risks':           _renderRisks(content); break;
    case 'recommendations': _renderRecommendations(content); break;
    case 'cs-ai':           _renderCsAi(content); break;
  }
}

// ─── Tab 1: Visão Geral ───────────────────────────────────────────────────────

async function _renderOverview(el) {
  try {
    const res = await apiFetch(`${BASE}/dashboard`);
    const d = res.data;
    el.innerHTML = `
      <div class="cs-section">
        <h3 class="cs-section-title">Saúde da Carteira</h3>
        <div class="cs-kpi-grid">
          ${_kpi('Saudáveis', d.distribution?.healthy ?? 0, 'healthy', 'Empresas com score 90-100')}
          ${_kpi('Atenção', d.distribution?.attention ?? 0, 'attention', 'Score 70-89')}
          ${_kpi('Risco', d.distribution?.risk ?? 0, 'risk', 'Score 50-69')}
          ${_kpi('Críticas', d.distribution?.critical ?? 0, 'critical', 'Score 0-49')}
        </div>
      </div>
      <div class="cs-section">
        <h3 class="cs-section-title">Métricas da Plataforma</h3>
        <div class="cs-kpi-grid">
          ${_kpi('Score Médio', (d.avgScore ?? 0) + '/100', 'neutral', 'Health Score médio da carteira')}
          ${_kpi('Risco de Churn', d.churnRiskCount ?? 0, 'risk', 'Empresas com cancelamento ≥50%')}
          ${_kpi('MRR', 'R$ ' + _fmt(d.mrr), 'healthy', 'Receita mensal recorrente')}
          ${_kpi('ARR', 'R$ ' + _fmt(d.arr), 'neutral', 'Receita anual recorrente')}
        </div>
      </div>
      <div class="cs-section">
        <h3 class="cs-section-title">Recomendações Pendentes</h3>
        <div class="cs-kpi-grid">
          ${_kpi('Ações Pendentes', d.pendingRecommendations ?? 0, d.pendingRecommendations > 10 ? 'critical' : 'attention', 'Recomendações aguardando ação da equipe CS')}
          ${_kpi('Total Empresas', d.totalCompanies ?? 0, 'neutral', 'Empresas ativas na plataforma')}
          ${_kpi('Com Score', d.scoredCompanies ?? 0, 'neutral', 'Empresas com Health Score calculado')}
        </div>
      </div>
      ${_topRiskTable(d.topRiskCompanies || [])}
    `;
  } catch (e) {
    el.innerHTML = _errBox(e.message);
  }
}

function _topRiskTable(companies) {
  if (!companies.length) return '';
  const rows = companies.map((c) => `
    <tr>
      <td><strong>${_esc(c.name)}</strong></td>
      <td>${_scoreBadge(c.score, c.classification)}</td>
      <td>${_riskBadge(c.cancellationProbability)}</td>
      <td>
        <button class="btn-cs-action" onclick="csOpenCompany('${c.id}')">Ver perfil</button>
      </td>
    </tr>
  `).join('');
  return `
    <div class="cs-section">
      <h3 class="cs-section-title">Top Riscos — Ação Imediata</h3>
      <div class="cs-table-wrap">
        <table class="cs-table">
          <thead><tr><th>Empresa</th><th>Score</th><th>Risco Cancelamento</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Tab 2: Health Scores ─────────────────────────────────────────────────────

let _hsPage = 1;

async function _renderHealthScores(el) {
  try {
    const res = await apiFetch(`${BASE}/health-scores?page=${_hsPage}&limit=20`);
    const { data, total, pages } = res;

    const rows = data.map((c) => `
      <tr>
        <td><strong>${_esc(c.name)}</strong></td>
        <td>${_scoreBadge(c.score, c.classification)}</td>
        <td>
          <div class="cs-score-bars">
            <div class="cs-bar-row"><span>Utilização</span><div class="cs-bar"><div class="cs-bar-fill util" style="width:${(c.utilizationScore/30*100).toFixed(0)}%"></div></div><span>${c.utilizationScore}/30</span></div>
            <div class="cs-bar-row"><span>Financeiro</span><div class="cs-bar"><div class="cs-bar-fill fin" style="width:${(c.financialScore/25*100).toFixed(0)}%"></div></div><span>${c.financialScore}/25</span></div>
            <div class="cs-bar-row"><span>Suporte</span><div class="cs-bar"><div class="cs-bar-fill sup" style="width:${(c.supportScore/20*100).toFixed(0)}%"></div></div><span>${c.supportScore}/20</span></div>
            <div class="cs-bar-row"><span>Operacional</span><div class="cs-bar"><div class="cs-bar-fill ops" style="width:${(c.operationalScore/25*100).toFixed(0)}%"></div></div><span>${c.operationalScore}/25</span></div>
          </div>
        </td>
        <td>${_riskBadge(c.cancellationProbability)}</td>
        <td>
          <button class="btn-cs-sm" onclick="csRecalculate('${c.id}', this)">Recalcular</button>
          <button class="btn-cs-action" onclick="csOpenCompany('${c.id}')">Detalhe</button>
        </td>
      </tr>
    `).join('');

    el.innerHTML = `
      <div class="cs-toolbar">
        <span class="cs-count">${total} empresas com score calculado</span>
      </div>
      <div class="cs-table-wrap">
        <table class="cs-table cs-table-hs">
          <thead><tr><th>Empresa</th><th>Score</th><th>Componentes</th><th>Risco</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${_pagination(_hsPage, pages, (p) => { _hsPage = p; _renderHealthScores(el); })}
    `;
  } catch (e) {
    el.innerHTML = _errBox(e.message);
  }
}

window.csRecalculate = async function(id, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    await apiFetch(`${BASE}/recalculate/${id}`, { method: 'POST' });
    _render();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Recalcular';
    alert('Erro: ' + e.message);
  }
};

// ─── Tab 3: Empresas em Risco ──────────────────────────────────────────────────

let _riskPage = 1;

async function _renderRisks(el) {
  try {
    const res = await apiFetch(`${BASE}/risks?page=${_riskPage}&limit=20&minProbability=30`);
    const { data, total, pages } = res;

    if (!data.length) {
      el.innerHTML = '<div class="cs-empty"><p>Nenhuma empresa com risco elevado no momento.</p></div>';
      return;
    }

    const rows = data.map((c) => {
      const factors = (c.riskFactors || []).map((f) => `<span class="cs-factor">${_factorLabel(f)}</span>`).join('');
      return `
        <tr>
          <td>
            <strong>${_esc(c.name)}</strong>
            <div class="cs-factor-list">${factors}</div>
          </td>
          <td>${_scoreBadge(c.score, c.classification)}</td>
          <td>
            <div class="cs-risk-prob ${_riskClass(c.cancellationProbability)}">
              ${c.cancellationProbability}%
            </div>
            <div class="cs-risk-bar-wrap">
              <div class="cs-risk-bar-fill" style="width:${c.cancellationProbability}%"></div>
            </div>
          </td>
          <td>${_subBadge(c.subscriptionStatus)}</td>
          <td>
            <button class="btn-cs-action cs-urgent" onclick="csOpenCompany('${c.id}')">Agir agora</button>
          </td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <div class="cs-toolbar">
        <span class="cs-count cs-alert">${total} empresas em risco (prob. cancelamento ≥30%)</span>
      </div>
      <div class="cs-table-wrap">
        <table class="cs-table">
          <thead><tr><th>Empresa / Fatores</th><th>Score</th><th>Prob. Cancelamento</th><th>Assinatura</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${_pagination(_riskPage, pages, (p) => { _riskPage = p; _renderRisks(el); })}
    `;
  } catch (e) {
    el.innerHTML = _errBox(e.message);
  }
}

// ─── Tab 4: Recomendações ─────────────────────────────────────────────────────

let _recPage   = 1;
let _recStatus = 'pending';

async function _renderRecommendations(el) {
  try {
    const res = await apiFetch(`${BASE}/recommendations?page=${_recPage}&limit=20&status=${_recStatus}`);
    const { data, total, pages } = res;

    const filterBtns = ['pending', 'in_progress', 'done', 'dismissed'].map((s) => `
      <button class="cs-filter-btn ${_recStatus === s ? 'active' : ''}" onclick="csRecFilter('${s}')">${_recStatusLabel(s)}</button>
    `).join('');

    const rows = !data.length
      ? `<tr><td colspan="5" class="cs-empty-row">Nenhuma recomendação encontrada.</td></tr>`
      : data.map((r) => `
          <tr>
            <td>
              <div class="cs-rec-company">${_esc(r.company?.tradeName ?? r.companyId)}</div>
              <div class="cs-rec-title">${_esc(r.title)}</div>
              <div class="cs-rec-desc">${_esc(r.description)}</div>
            </td>
            <td>${_recTypeBadge(r.type)}</td>
            <td>${_priorityBadge(r.priority)}</td>
            <td><span class="cs-rec-status cs-rec-status--${r.status}">${_recStatusLabel(r.status)}</span></td>
            <td class="cs-rec-actions">
              ${r.status === 'pending' || r.status === 'in_progress' ? `
                <button class="btn-cs-sm" onclick="csRecUpdate('${r.id}', 'in_progress')">Em progresso</button>
                <button class="btn-cs-sm btn-cs-done" onclick="csRecUpdate('${r.id}', 'done')">Concluir</button>
                <button class="btn-cs-sm btn-cs-dismiss" onclick="csRecUpdate('${r.id}', 'dismissed')">Descartar</button>
              ` : ''}
            </td>
          </tr>
        `).join('');

    el.innerHTML = `
      <div class="cs-toolbar">
        <div class="cs-filter-group">${filterBtns}</div>
        <span class="cs-count">${total} recomendações</span>
      </div>
      <div class="cs-table-wrap">
        <table class="cs-table">
          <thead><tr><th>Empresa / Recomendação</th><th>Tipo</th><th>Prioridade</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${_pagination(_recPage, pages, (p) => { _recPage = p; _renderRecommendations(el); })}
    `;
  } catch (e) {
    el.innerHTML = _errBox(e.message);
  }
}

window.csRecFilter = function(status) {
  _recStatus = status;
  _recPage = 1;
  _renderRecommendations(document.getElementById('csContent'));
};

window.csRecUpdate = async function(id, status) {
  try {
    await apiFetch(`${BASE}/recommendations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    _renderRecommendations(document.getElementById('csContent'));
  } catch (e) {
    alert('Erro ao atualizar: ' + e.message);
  }
};

// ─── Tab 5: Customer Success AI ───────────────────────────────────────────────

function _renderCsAi(el) {
  el.innerHTML = `
    <div class="cs-ai-layout">
      <div class="cs-ai-header">
        <div class="cs-ai-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20v-1a8 8 0 0 1 16 0v1"/></svg>
        </div>
        <div>
          <div class="cs-ai-name">GAMBY Success AI</div>
          <div class="cs-ai-role">Digital Account Manager</div>
        </div>
      </div>
      <div class="cs-ai-messages" id="csAiMessages">
        <div class="cs-ai-msg cs-ai-msg--assistant">
          <div class="cs-ai-bubble">
            Olá! Sou o GAMBY Success AI, seu Digital Account Manager.<br><br>
            Posso responder perguntas como:<br>
            <em>• "Quem devo ligar hoje?"</em><br>
            <em>• "Quais empresas estão em risco?"</em><br>
            <em>• "Quem não acessa há mais de 15 dias?"</em><br>
            <em>• "Quem pode receber upgrade?"</em><br><br>
            Utilizo dados reais da plataforma para todas as respostas.
          </div>
        </div>
      </div>
      <div class="cs-ai-input-area">
        <input type="text" class="cs-ai-input" id="csAiInput" placeholder="Pergunte sobre sua carteira de clientes..." />
        <button class="cs-ai-send" id="csAiSend" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  `;

  const input  = document.getElementById('csAiInput');
  const sendBtn = document.getElementById('csAiSend');
  const msgs   = document.getElementById('csAiMessages');

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;

    _appendMsg(msgs, text, 'user');
    const typing = _appendTyping(msgs);

    try {
      const res = await apiFetch(`${BASE}/ai/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: text, conversationId: _aiConvId }),
      });
      _aiConvId = res.data?.conversationId ?? _aiConvId;
      typing.remove();
      _appendMsg(msgs, res.data?.response ?? '', 'assistant');
    } catch (e) {
      typing.remove();
      _appendMsg(msgs, 'Erro ao processar: ' + e.message, 'assistant');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

function _appendMsg(container, text, role) {
  const div = document.createElement('div');
  div.className = `cs-ai-msg cs-ai-msg--${role}`;
  div.innerHTML = `<div class="cs-ai-bubble">${_formatMarkdown(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function _appendTyping(container) {
  const div = document.createElement('div');
  div.className = 'cs-ai-msg cs-ai-msg--assistant';
  div.innerHTML = '<div class="cs-ai-bubble cs-ai-typing"><span></span><span></span><span></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function _formatMarkdown(text) {
  return (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// ─── Modal de perfil de empresa ───────────────────────────────────────────────

window.csOpenCompany = async function(id) {
  const modal = document.createElement('div');
  modal.className = 'cs-modal-overlay';
  modal.innerHTML = `
    <div class="cs-modal">
      <div class="cs-modal-header">
        <h3>Carregando perfil...</h3>
        <button class="cs-modal-close" onclick="this.closest('.cs-modal-overlay').remove()">×</button>
      </div>
      <div class="cs-modal-body"><div class="cs-spinner"></div></div>
    </div>
  `;
  document.body.appendChild(modal);

  try {
    const res = await apiFetch(`${BASE}/company/${id}`);
    const { company, healthScore: hs, recommendations, events, latestTickets } = res.data;

    const recList = recommendations.slice(0, 5).map((r) => `
      <div class="cs-rec-item cs-rec-item--${r.priority}">
        <div class="cs-rec-item-title">${_esc(r.title)}</div>
        <div class="cs-rec-item-action">${_esc(r.recommendation)}</div>
      </div>
    `).join('') || '<p class="cs-empty-text">Nenhuma recomendação ativa.</p>';

    const eventList = events.slice(0, 8).map((e) => `
      <div class="cs-event-item cs-event--${e.severity}">
        <span class="cs-event-dot"></span>
        <div>
          <div class="cs-event-title">${_esc(e.title)}</div>
          <div class="cs-event-time">${_relativeTime(e.createdAt)}</div>
        </div>
      </div>
    `).join('') || '<p class="cs-empty-text">Sem eventos recentes.</p>';

    const ticketList = latestTickets.slice(0, 5).map((t) => `
      <div class="cs-ticket-row">
        <span class="cs-ticket-status cs-ticket--${t.status}">${t.status}</span>
        <span>${_esc(t.subject)}</span>
      </div>
    `).join('') || '<p class="cs-empty-text">Nenhum chamado.</p>';

    const sub = company.billingSubscriptions?.[0];

    modal.querySelector('.cs-modal-header h3').textContent = company.tradeName;
    modal.querySelector('.cs-modal-body').innerHTML = `
      <div class="cs-modal-grid">
        <div class="cs-modal-col">
          <h4>Health Score</h4>
          <div class="cs-score-big ${_classLabel(hs?.classification)}">${hs?.score ?? '—'}</div>
          <div class="cs-classification-badge cs-cls-${hs?.classification ?? 'critical'}">${_classLabel(hs?.classification)}</div>
          <div class="cs-score-detail-bars">
            ${_detailBar('Utilização', hs?.utilizationScore, 30, 'util')}
            ${_detailBar('Financeiro', hs?.financialScore, 25, 'fin')}
            ${_detailBar('Suporte', hs?.supportScore, 20, 'sup')}
            ${_detailBar('Operacional', hs?.operationalScore, 25, 'ops')}
          </div>
          <div class="cs-cancel-risk">
            <span class="cs-cancel-label">Prob. Cancelamento:</span>
            <span class="cs-cancel-value cs-cancel--${_riskLevel(hs?.cancellationProbability)}">${hs?.cancellationProbability ?? 0}%</span>
          </div>
          <h4 class="cs-modal-subtitle">Assinatura</h4>
          <p>${_subBadge(sub?.status)} ${sub?.nextBillingAt ? '· Próx. cobrança: ' + _dateStr(sub.nextBillingAt) : ''}</p>
        </div>
        <div class="cs-modal-col">
          <h4>Recomendações CS</h4>
          ${recList}
          <h4 class="cs-modal-subtitle">Chamados Recentes</h4>
          ${ticketList}
        </div>
        <div class="cs-modal-col cs-modal-col--full">
          <h4>Timeline de Eventos CS</h4>
          <div class="cs-event-list">${eventList}</div>
        </div>
      </div>
    `;
  } catch (e) {
    modal.querySelector('.cs-modal-body').innerHTML = `<p class="cs-error">${e.message}</p>`;
  }
};

// ─── Helpers de render ────────────────────────────────────────────────────────

function _kpi(label, value, type, hint) {
  return `
    <div class="cs-kpi cs-kpi--${type}" title="${hint}">
      <div class="cs-kpi-value">${value}</div>
      <div class="cs-kpi-label">${label}</div>
    </div>
  `;
}

function _scoreBadge(score, cls) {
  return `<span class="cs-score-badge cs-cls-${cls}">${score}/100</span>`;
}

function _riskBadge(prob) {
  const level = _riskLevel(prob);
  return `<span class="cs-risk-badge cs-risk--${level}">${prob}%</span>`;
}

function _riskLevel(prob) {
  if (prob >= 70) return 'critical';
  if (prob >= 50) return 'high';
  if (prob >= 30) return 'medium';
  return 'low';
}

function _riskClass(prob) {
  if (prob >= 70) return 'cs-risk-critical';
  if (prob >= 50) return 'cs-risk-high';
  if (prob >= 30) return 'cs-risk-medium';
  return 'cs-risk-low';
}

function _subBadge(status) {
  const map = {
    authorized: ['healthy', 'Ativa'],
    active:     ['healthy', 'Ativa'],
    pending:    ['attention', 'Pendente'],
    past_due:   ['risk', 'Em Atraso'],
    cancelled:  ['critical', 'Cancelada'],
    blocked:    ['critical', 'Bloqueada'],
    paused:     ['attention', 'Pausada'],
  };
  const [cls, label] = map[status] ?? ['neutral', status ?? 'N/D'];
  return `<span class="cs-sub-badge cs-sub--${cls}">${label}</span>`;
}

function _priorityBadge(priority) {
  return `<span class="cs-priority-badge cs-priority--${priority}">${_priorityLabel(priority)}</span>`;
}

function _priorityLabel(p) {
  return { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' }[p] ?? p;
}

function _recTypeBadge(type) {
  const labels = {
    contact_inactive:     'Inatividade',
    billing_alert:        'Cobrança',
    usage_training:       'Treinamento',
    upgrade_opportunity:  'Upgrade',
    retention_risk:       'Retenção',
    onboarding_incomplete:'Onboarding',
    support_overload:     'Suporte',
    low_module_adoption:  'Adoção',
    no_sales:             'Sem Vendas',
  };
  return `<span class="cs-type-badge">${labels[type] ?? type}</span>`;
}

function _recStatusLabel(s) {
  return { pending: 'Pendente', in_progress: 'Em Progresso', done: 'Concluída', dismissed: 'Descartada' }[s] ?? s;
}

function _factorLabel(f) {
  const map = {
    access_gap_60d:         'Sem acesso 60d',
    access_gap_30d:         'Sem acesso 30d',
    access_gap_14d:         'Sem acesso 14d',
    access_gap_7d:          'Sem acesso 7d',
    subscription_cancelled: 'Assinatura cancelada',
    past_due_14d:           'Atraso >14d',
    past_due:               'Pagamento atrasado',
    support_overload:       'Muitos chamados',
    support_high:           'Chamados elevados',
    no_sales_30d:           'Sem vendas 30d',
    critical_score:         'Score crítico',
  };
  return map[f] ?? f;
}

function _classLabel(cls) {
  return { healthy: 'Saudável', attention: 'Atenção', risk: 'Risco', critical: 'Crítico' }[cls] ?? (cls ?? '—');
}

function _detailBar(label, val, max, cls) {
  const pct = val != null ? (val / max * 100).toFixed(0) : 0;
  return `
    <div class="cs-bar-row">
      <span>${label}</span>
      <div class="cs-bar"><div class="cs-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <span>${val ?? 0}/${max}</span>
    </div>
  `;
}

function _pagination(page, pages, onPage) {
  if (pages <= 1) return '';
  const prevDisabled = page === 1 ? 'disabled' : '';
  const nextDisabled = page >= pages ? 'disabled' : '';
  return `
    <div class="cs-pagination">
      <button class="cs-page-btn" ${prevDisabled} onclick="csPaginate(${page - 1})">‹</button>
      <span>Página ${page} de ${pages}</span>
      <button class="cs-page-btn" ${nextDisabled} onclick="csPaginate(${page + 1})">›</button>
    </div>
  `;
}

window.csPaginate = function(page) {
  if (_tab === 'health-scores')   { _hsPage = page; _renderHealthScores(document.getElementById('csContent')); }
  if (_tab === 'risks')           { _riskPage = page; _renderRisks(document.getElementById('csContent')); }
  if (_tab === 'recommendations') { _recPage = page; _renderRecommendations(document.getElementById('csContent')); }
};

function _errBox(msg) {
  return `<div class="cs-error-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Erro: ${_esc(msg)}</div>`;
}

function _esc(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _dateStr(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

function _relativeTime(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}
