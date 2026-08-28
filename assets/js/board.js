/**
 * GAMBY BOARD — Fase 10
 * Centro executivo da plataforma. Responde: "Como está a GAMBY hoje?"
 * 7 sub-tabs: Visão Geral | Receita | Clientes | CS & Saúde | Produto | IA | Alertas
 */

import { getAuthToken } from './http.js';

// ─── API helper ──────────────────────────────────────────────────────────────

const API = () => window.GAMBY_CONFIG?.apiUrl || 'http://localhost:4001';

function _authHeaders() {
  const token = getAuthToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API()}${path}`, { headers: _authHeaders(), ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── State ───────────────────────────────────────────────────────────────────

let _mounted   = false;
let _activeTab = 'overview';
let _cache     = null; // cached overview data

// ─── Mount ───────────────────────────────────────────────────────────────────

export function initBoard() {
  if (_mounted) return;
  _mounted = true;

  const shell = document.getElementById('boardShell');
  if (!shell) return;

  shell.innerHTML = `
    <div class="board-root">
      <div class="board-header">
        <div class="board-header-left">
          <h2 class="board-title">GAMBY BOARD</h2>
          <span class="board-subtitle">Como está a GAMBY hoje?</span>
        </div>
        <div class="board-header-right">
          <button class="board-refresh-btn" onclick="boardRefresh()" title="Atualizar dados">↺ Atualizar</button>
          <div id="boardAlertBadge" class="board-alert-badge hidden"></div>
        </div>
      </div>
      <nav class="board-tabs">
        <button class="board-tab active" data-tab="overview">Visão Geral</button>
        <button class="board-tab" data-tab="revenue">Receita</button>
        <button class="board-tab" data-tab="clients">Clientes</button>
        <button class="board-tab" data-tab="cs">CS & Saúde</button>
        <button class="board-tab" data-tab="product">Produto</button>
        <button class="board-tab" data-tab="ai">IA</button>
        <button class="board-tab" data-tab="alerts">Alertas <span id="boardAlertCount" class="board-alert-count"></span></button>
        <button class="board-tab board-tab-ai-summary" data-tab="ai-summary">✦ Resumo IA</button>
      </nav>
      <div class="board-body" id="boardBody">
        <div class="board-loading"><span class="board-spinner"></span> Carregando GAMBY BOARD...</div>
      </div>
    </div>`;

  shell.querySelectorAll('.board-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      shell.querySelectorAll('.board-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab = btn.dataset.tab;
      _loadTab(_activeTab);
    });
  });

  _loadTab('overview');
}

window.boardRefresh = () => {
  _cache = null;
  _loadTab(_activeTab);
};

// ─── Tab router ──────────────────────────────────────────────────────────────

async function _loadTab(tab) {
  const body = document.getElementById('boardBody');
  if (!body) return;
  body.innerHTML = '<div class="board-loading"><span class="board-spinner"></span> Carregando...</div>';

  try {
    // overview data cached para evitar chamadas repetidas ao trocar de tab
    if (!_cache && tab !== 'alerts') {
      const resp = await apiFetch('/v1/board/overview');
      _cache = resp.data;
      _updateAlertBadge(_cache);
    }

    switch (tab) {
      case 'overview':   _renderOverview(body, _cache);   break;
      case 'revenue':    _renderRevenue(body, _cache);    break;
      case 'clients':    _renderClients(body, _cache);    break;
      case 'cs':         _renderCS(body, _cache);         break;
      case 'product':    _renderProduct(body, _cache);    break;
      case 'ai':         _renderAI(body, _cache);         break;
      case 'alerts':     await _renderAlerts(body);       break;
      case 'ai-summary': await _renderAiSummary(body);   break;
    }
  } catch (err) {
    body.innerHTML = `<div class="board-error"><strong>Erro ao carregar:</strong> ${_esc(err.message)}</div>`;
  }
}

function _updateAlertBadge(data) {
  // alerts vêm embutidos nos dados de overview via unreadCount
  // Não fazemos chamada extra aqui — apenas atualizamos via dados já carregados
}

// ─── TAB 1 — VISÃO GERAL ─────────────────────────────────────────────────────

function _renderOverview(body, d) {
  if (!d) { body.innerHTML = '<div class="board-error">Dados indisponíveis.</div>'; return; }

  const warn = d.dataWarnings?.length
    ? `<div class="board-warn">${d.dataWarnings.map((w) => `⚠ ${_esc(w)}`).join('<br>')}</div>` : '';

  body.innerHTML = `
    ${warn}
    <section class="board-section">
      <h3 class="board-section-title">Resumo Executivo</h3>
      <div class="board-kpi-grid">
        ${_kpi('Receita do Mês', _brl(d.revenueThisMonth), 'MRR atual')}
        ${_kpi('Receita Prevista', _brl(d.revenueNextMonthForecast), 'Próximo mês (conservador)')}
        ${_kpi('MRR', _brl(d.mrr), 'Receita mensal recorrente')}
        ${_kpi('ARR', _brl(d.arr), 'Receita anual projetada')}
        ${_kpi('Crescimento MRR', d.mrrGrowthPct !== null ? (d.mrrGrowthPct > 0 ? '+' : '') + d.mrrGrowthPct + '%' : _insuf(), d.mrrGrowthNote || 'vs 30 dias atrás', d.mrrGrowthPct !== null && d.mrrGrowthPct < 0)}
        ${_kpi('Clientes Ativos', _num(d.activeCompanyCount), 'Empresas com status ativo')}
        ${_kpi('Em Trial', _num(d.trialCount), 'Em período de avaliação')}
        ${_kpi('Tier Premium', _num(d.clientsPremium), 'Plano Pro / Economic')}
        ${_kpi('Tier Growth', _num(d.clientsGrowth), 'Plano Economico / Economic')}
        ${_kpi('Inadimplentes', _num(d.pastDueCount), 'Pagamento em atraso', (d.pastDueCount ?? 0) > 0)}
        ${_kpi('Em Risco Churn', _num(d.churnRiskCount), 'Prob. cancelamento ≥ 50%', (d.churnRiskCount ?? 0) > 0)}
        ${_kpi('Upgrades Pendentes', d.upgradesPending !== null ? _num(d.upgradesPending) : _insuf(), d.upgradesPendingNote || 'Oportunidades abertas')}
        ${_kpi('Downgrades', _insuf(), d.downgradesNote)}
        ${_kpi('Health Score Médio', d.avgHealthScore !== null ? d.avgHealthScore + '/100' : _insuf(), 'Saúde média da base')}
        ${_kpi('Churn Rate', d.monthlyChurnRate !== null ? d.monthlyChurnRate + '%' : _insuf(), 'Cancelamentos / base ativa')}
        ${_kpi('Chamados Abertos', _num(d.openSupportTickets), 'Suporte em aberto', (d.openSupportTickets ?? 0) > 15)}
      </div>
    </section>

    ${d.churnTop10?.length ? `
    <section class="board-section">
      <h3 class="board-section-title">Top Riscos de Churn</h3>
      <div class="board-risk-list">
        ${d.churnTop10.map((c) => `
          <div class="board-risk-card board-risk-${c.riskCategory}">
            <span class="board-risk-name">${_esc(c.companyName)}</span>
            <span class="board-risk-prob">${c.probability}%</span>
            ${c.topAction ? `<span class="board-risk-action">${_esc(c.topAction)}</span>` : ''}
          </div>`).join('')}
      </div>
    </section>` : ''}

    <div class="board-ts">Gerado em ${new Date(d.generatedAt).toLocaleString('pt-BR')}</div>`;
}

// ─── TAB 2 — RECEITA ─────────────────────────────────────────────────────────

function _renderRevenue(body, d) {
  const rev = d?.revenue;

  body.innerHTML = `
    <section class="board-section">
      <h3 class="board-section-title">Receita por Plano</h3>
      ${!rev?.planStats?.length
        ? `<p class="board-empty">${_insuf()}</p>`
        : `<div class="board-table-wrap">
            <table class="board-table">
              <thead>
                <tr>
                  <th>Plano</th><th>Empresas</th><th>MRR</th><th>ARR</th>
                  <th>ARPU</th><th>Churn Rate</th><th>Tickets/empresa</th>
                </tr>
              </thead>
              <tbody>
                ${rev.planStats.map((p) => `
                  <tr>
                    <td><strong>${_esc(p.planName)}</strong><br><small>${_esc(p.planCode)}</small></td>
                    <td>${p.companies}</td>
                    <td>${_brl(p.mrr)}</td>
                    <td>${_brl(p.arr)}</td>
                    <td>${_brl(p.arpu)}</td>
                    <td class="${p.churnRate > 5 ? 'board-warn-cell' : ''}">${p.churnRate}%</td>
                    <td class="${p.ticketsPerCompany > 2 ? 'board-warn-cell' : ''}">${p.ticketsPerCompany}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="board-rankings">
            ${rev.rankings ? `
              <div class="board-rank-item">🏆 Maior MRR: <strong>${_esc(rev.rankings.highestMrr ?? '—')}</strong></div>
              <div class="board-rank-item">⚡ Maior ARPU: <strong>${_esc(rev.rankings.highestArpu ?? '—')}</strong></div>
              <div class="board-rank-item">⚠ Maior Churn: <strong>${_esc(rev.rankings.highestChurn ?? '—')}</strong></div>
              <div class="board-rank-item">🎯 Menor Churn: <strong>${_esc(rev.rankings.lowestChurn ?? '—')}</strong></div>
            ` : ''}</div>`}
    </section>

    <section class="board-section">
      <h3 class="board-section-title">Receita Recorrente vs Inadimplência</h3>
      <div class="board-kpi-grid board-kpi-grid-sm">
        ${_kpi('MRR Atual', _brl(d?.mrr), 'Receita mensal recorrente confirmada')}
        ${_kpi('ARR Projetado', _brl(d?.arr), 'Baseado no MRR atual × 12')}
        ${_kpi('Inadimplentes', _num(d?.pastDueCount), 'Assinaturas com pagamento atrasado', (d?.pastDueCount ?? 0) > 0)}
        ${_kpi('Downgrades', _insuf(), 'Evento não rastreado no billing')}
      </div>
    </section>`;
}

// ─── TAB 3 — CLIENTES ────────────────────────────────────────────────────────

function _renderClients(body, d) {
  const fun = d?.funnel;

  body.innerHTML = `
    <section class="board-section">
      <h3 class="board-section-title">Base de Clientes</h3>
      <div class="board-kpi-grid">
        ${_kpi('Ativos', _num(d?.activeCompanyCount), 'Status ativo')}
        ${_kpi('Em Trial', _num(d?.trialCount), 'Em avaliação')}
        ${_kpi('Novos (mês)', _num(d?.newThisMonth), 'Criados este mês')}
        ${_kpi('Cancelados (mês)', _num(d?.cancelledThisMonth), 'Cancelados este mês', (d?.cancelledThisMonth ?? 0) > 0)}
        ${_kpi('Inadimplentes', _num(d?.pastDueCount), 'Pagamento em atraso', (d?.pastDueCount ?? 0) > 0)}
        ${_kpi('Tier Premium', _num(d?.clientsPremium), 'Planos Pro / Economic')}
        ${_kpi('Tier Growth', _num(d?.clientsGrowth), 'Planos Economico / Economic')}
        ${_kpi('Tier Starter', _num(d?.clientsStarter), 'Planos Basico / Basic')}
        ${_kpi('Enterprise', _insuf(), d?.enterpriseNote ?? 'Tier não disponível')}
        ${_kpi('Em Risco', _num(d?.churnRiskCount), 'Prob. churn ≥ 50%', (d?.churnRiskCount ?? 0) > 0)}
      </div>
    </section>

    <section class="board-section">
      <h3 class="board-section-title">Funil de Conversão</h3>
      ${!fun || fun.dataWarnings?.length
        ? `<p class="board-empty">${fun?.dataWarnings?.[0] ?? _insuf()}</p>`
        : `<div class="board-funnel">
            ${(fun.funnelStages || []).map((s, i) => `
              <div class="board-funnel-stage">
                <div class="board-funnel-bar-wrap">
                  <div class="board-funnel-bar" style="width:${Math.min(100, s.pct ?? 100)}%"></div>
                </div>
                <div class="board-funnel-info">
                  <span class="board-funnel-name">${_esc(s.stage)}</span>
                  <span class="board-funnel-count">${_num(s.count)}</span>
                  <span class="board-funnel-conv">${i > 0 ? s.pct + '% conv.' : 'base'}</span>
                </div>
              </div>`).join('')}
          </div>
          <div class="board-kpi-grid board-kpi-grid-sm" style="margin-top:16px">
            ${_kpi('Reg → Trial', (fun.convRegToTrial ?? _insuf()) + (fun.convRegToTrial != null ? '%' : ''), 'Conversão de cadastro para trial')}
            ${_kpi('Trial → Sub', (fun.convTrialToSub ?? _insuf()) + (fun.convTrialToSub != null ? '%' : ''), 'Conversão de trial para pago')}
            ${_kpi('Tempo Reg→Trial', fun.avgDaysRegToTrial != null ? fun.avgDaysRegToTrial + ' dias' : _insuf(), 'Tempo médio')}
            ${_kpi('Tempo Trial→Sub', fun.avgDaysTrialToSub != null ? fun.avgDaysTrialToSub + ' dias' : _insuf(), 'Tempo médio')}
          </div>`}
    </section>`;
}

// ─── TAB 4 — CS & SAÚDE ──────────────────────────────────────────────────────

function _renderCS(body, d) {
  const dist = d?.healthDistribution ?? {};
  const total = Object.values(dist).reduce((s, v) => s + v, 0);

  body.innerHTML = `
    <section class="board-section">
      <h3 class="board-section-title">Health Score da Base</h3>
      <div class="board-kpi-grid board-kpi-grid-sm">
        ${_kpi('Score Médio', d?.avgHealthScore != null ? d.avgHealthScore + '/100' : _insuf(), 'Saúde média de todos os clientes')}
        ${_kpi('Saudáveis', _num(dist.healthy), '90–100 pts')}
        ${_kpi('Atenção', _num(dist.attention), '70–89 pts')}
        ${_kpi('Risco', _num(dist.risk), '50–69 pts', (dist.risk ?? 0) > 0)}
        ${_kpi('Crítico', _num(dist.critical), '0–49 pts', (dist.critical ?? 0) > 0)}
      </div>
      <div class="board-health-bars">
        ${_healthBar('Saudável',  dist.healthy  ?? 0, total, 'bar-healthy')}
        ${_healthBar('Atenção',   dist.attention ?? 0, total, 'bar-attention')}
        ${_healthBar('Risco',     dist.risk     ?? 0, total, 'bar-risk')}
        ${_healthBar('Crítico',   dist.critical ?? 0, total, 'bar-critical')}
      </div>
    </section>

    <section class="board-section">
      <h3 class="board-section-title">Empresas Críticas — Ação Imediata</h3>
      ${!d?.churnTop10?.length
        ? `<p class="board-empty">Nenhuma empresa com probabilidade de churn ≥ 50%.</p>`
        : `<div class="board-churn-table-wrap">
            <table class="board-table">
              <thead><tr><th>Empresa</th><th>Risco Churn</th><th>Categoria</th><th>Ação Prioritária</th></tr></thead>
              <tbody>
                ${d.churnTop10.map((c) => `
                  <tr>
                    <td><strong>${_esc(c.companyName)}</strong></td>
                    <td><span class="board-prob-badge board-prob-${c.riskCategory}">${c.probability}%</span></td>
                    <td>${_riskLabel(c.riskCategory)}</td>
                    <td>${c.topAction ? _esc(c.topAction) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
    </section>

    <section class="board-section">
      <h3 class="board-section-title">Upgrades Pendentes</h3>
      ${!d?.upgradesTop5?.length
        ? `<p class="board-empty">Nenhuma oportunidade de upgrade identificada.</p>`
        : `<div class="board-upgrade-list">
            ${d.upgradesTop5.map((u) => `
              <div class="board-upgrade-row">
                <span class="board-upgrade-name">${_esc(u.companyName)}</span>
                <span class="board-plan-chip">${_esc(u.currentPlan)}</span>
                <span class="board-arrow">→</span>
                <span class="board-plan-chip board-plan-suggested">${_esc(u.suggestedPlan ?? '?')}</span>
                <span class="board-score-sm">${u.upgradeScore}/100</span>
              </div>`).join('')}
          </div>`}
    </section>`;
}

// ─── TAB 5 — PRODUTO ─────────────────────────────────────────────────────────

function _renderProduct(body, d) {
  const modules = d?.productModules ?? [];

  body.innerHTML = `
    <section class="board-section">
      <h3 class="board-section-title">Módulos Mais Utilizados — últimos 90 dias</h3>
      ${!modules.length
        ? `<p class="board-empty">${_insuf()}</p>`
        : `<div class="board-module-list">
            ${modules.map((m, i) => {
              const maxCount = modules[0]?.actionCount || 1;
              const pct = Math.round((m.actionCount / maxCount) * 100);
              return `
                <div class="board-module-row">
                  <span class="board-module-rank">${i + 1}</span>
                  <span class="board-module-name">${_esc(m.module)}</span>
                  <div class="board-module-bar-wrap">
                    <div class="board-module-bar board-heat-${m.status}" style="width:${pct}%"></div>
                  </div>
                  <span class="board-module-count">${m.actionCount.toLocaleString('pt-BR')}</span>
                  <span class="board-module-adoption">${m.adoptionRate}% adoção</span>
                  <span class="board-heat-badge board-heat-${m.status}">${_statusLabel(m.status)}</span>
                </div>`;
            }).join('')}
          </div>`}
    </section>

    <section class="board-section">
      <h3 class="board-section-title">Destaques</h3>
      <div class="board-kpi-grid board-kpi-grid-sm">
        ${_kpi('Módulo Líder', d?.topModule ? _esc(d.topModule) : _insuf(), 'Mais ações nos últimos 90 dias')}
        ${_kpi('Menor Adoção', d?.bottomModule ? _esc(d.bottomModule) : _insuf(), 'Módulo com menos uso relativo')}
        ${_kpi('Retenção por módulo', _insuf(), 'Dado insuficiente — correlação com cancelamentos não rastreada')}
      </div>
    </section>`;
}

// ─── TAB 6 — IA ──────────────────────────────────────────────────────────────

function _renderAI(body, d) {
  const ai = d?.aiMonitor;

  body.innerHTML = `
    <section class="board-section">
      <h3 class="board-section-title">Consumo de IA — últimos 30 dias</h3>
      ${!ai
        ? `<p class="board-empty">${_insuf()}</p>`
        : `<div class="board-kpi-grid board-kpi-grid-sm">
            ${_kpi('Custo Total Estimado', '$' + (ai.totalCostUsdEstimated ?? 0).toFixed(2), 'Baseado em tabela pública de preços')}
            ${_kpi('Conversações', _num(ai.totalConversations), 'Conversações únicas')}
            ${_kpi('Tokens Totais', _tok(ai.totalTokens), 'Input + Output')}
          </div>
          <h4 style="font-size:.88rem;font-weight:600;margin:16px 0 8px">Por Modelo</h4>
          <div class="board-table-wrap">
            <table class="board-table">
              <thead>
                <tr><th>Modelo</th><th>Tokens In</th><th>Tokens Out</th><th>Custo USD</th><th>Conversações</th></tr>
              </thead>
              <tbody>
                ${(ai.modelStats || []).map((m) => `
                  <tr>
                    <td><code>${_esc(m.model)}</code></td>
                    <td>${_tok(m.tokensInput)}</td>
                    <td>${_tok(m.tokensOutput)}</td>
                    <td>$${m.costUsdEstimated.toFixed(4)}</td>
                    <td>${m.conversations}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${ai.topCompanies?.length ? `
          <h4 style="font-size:.88rem;font-weight:600;margin:16px 0 8px">Top Consumidoras</h4>
          <div class="board-table-wrap">
            <table class="board-table">
              <thead><tr><th>Empresa</th><th>Conversações</th><th>Tokens</th><th>Custo</th></tr></thead>
              <tbody>
                ${ai.topCompanies.slice(0, 5).map((c) => `
                  <tr>
                    <td>${_esc(c.companyName)}</td>
                    <td>${c.conversations}</td>
                    <td>${_tok(c.tokensTotal)}</td>
                    <td>$${c.costUsdEstimated.toFixed(4)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
          <p class="board-note">${_esc(ai.costNote ?? '')}</p>`}
    </section>`;
}

// ─── TAB 7 — ALERTAS ─────────────────────────────────────────────────────────

async function _renderAlerts(body) {
  const { data } = await apiFetch('/v1/board/alerts?includeRead=false');
  const { alerts, unreadCount } = data;

  // Atualiza badge
  const countEl = document.getElementById('boardAlertCount');
  if (countEl) countEl.textContent = unreadCount > 0 ? unreadCount : '';

  body.innerHTML = `
    <section class="board-section">
      <div class="board-alert-header">
        <h3 class="board-section-title">Alertas Estratégicos</h3>
        <div class="board-alert-actions">
          <button class="board-btn-sm" onclick="boardGenerateAlerts()">↺ Gerar Alertas</button>
          <label class="board-check-label">
            <input type="checkbox" id="showReadAlerts" onchange="boardToggleRead(this.checked)"> Mostrar lidos
          </label>
        </div>
      </div>
      ${!alerts?.length
        ? `<p class="board-empty">Nenhum alerta ativo. Clique em "Gerar Alertas" para analisar a plataforma.</p>`
        : `<div class="board-alerts-list">
            ${alerts.map((a) => `
              <div class="board-alert-card board-alert-${a.severity}">
                <div class="board-alert-top">
                  <span class="board-alert-badge board-badge-${a.severity}">${_sevLabel(a.severity)}</span>
                  <span class="board-alert-cat">${_catLabel(a.category)}</span>
                  <strong class="board-alert-title">${_esc(a.title)}</strong>
                  <span class="board-alert-time">${_relTime(a.generatedAt)}</span>
                  <button class="board-dismiss-btn" onclick="boardDismiss('${a.id}')">✓ Lido</button>
                </div>
                <p class="board-alert-msg">${_esc(a.messagePtBr)}</p>
              </div>`).join('')}
          </div>`}
    </section>`;
}

window.boardGenerateAlerts = async () => {
  const body = document.getElementById('boardBody');
  if (body) body.innerHTML = '<div class="board-loading"><span class="board-spinner"></span> Gerando alertas...</div>';
  try {
    const { data } = await apiFetch('/v1/board/alerts/generate', { method: 'POST' });
    alert(`Alertas gerados: ${data.created}${data.errors?.length ? '\nErros: ' + data.errors.join(', ') : ''}`);
    _cache = null;
    await _renderAlerts(body);
  } catch (e) {
    alert('Erro: ' + e.message);
  }
};

window.boardDismiss = async (id) => {
  try {
    await apiFetch(`/v1/board/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'PATCH' });
    const body = document.getElementById('boardBody');
    await _renderAlerts(body);
  } catch (e) {
    alert('Erro: ' + e.message);
  }
};

window.boardToggleRead = async (showRead) => {
  const body = document.getElementById('boardBody');
  if (!body) return;
  try {
    const { data } = await apiFetch(`/v1/board/alerts?includeRead=${showRead}`);
    const { alerts, unreadCount } = data;
    const listEl = body.querySelector('.board-alerts-list');
    if (!listEl) return;
    const countEl = document.getElementById('boardAlertCount');
    if (countEl) countEl.textContent = unreadCount > 0 ? unreadCount : '';
    if (!alerts?.length) {
      listEl.innerHTML = '<p class="board-empty">Nenhum alerta encontrado.</p>';
      return;
    }
    listEl.innerHTML = alerts.map((a) => `
      <div class="board-alert-card board-alert-${a.severity}${a.isRead ? ' board-alert-read' : ''}">
        <div class="board-alert-top">
          <span class="board-alert-badge board-badge-${a.severity}">${_sevLabel(a.severity)}</span>
          <span class="board-alert-cat">${_catLabel(a.category)}</span>
          <strong class="board-alert-title">${_esc(a.title)}</strong>
          <span class="board-alert-time">${_relTime(a.generatedAt)}</span>
          ${!a.isRead ? `<button class="board-dismiss-btn" onclick="boardDismiss('${a.id}')">✓ Lido</button>` : '<span class="board-read-label">Lido</span>'}
        </div>
        <p class="board-alert-msg">${_esc(a.messagePtBr)}</p>
      </div>`).join('');
  } catch (e) {
    alert('Erro: ' + e.message);
  }
};

// ─── Helpers de formatação ────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}
function _brl(n) {
  if (n == null) return _insuf();
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _num(n) {
  if (n == null) return _insuf();
  return Number(n).toLocaleString('pt-BR');
}
function _tok(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}
function _insuf() {
  return '<span class="board-insuf">Dado insuficiente para cálculo real.</span>';
}
function _kpi(label, value, sub, warn = false) {
  return `
    <div class="board-kpi${warn ? ' board-kpi-warn' : ''}">
      <div class="board-kpi-label">${_esc(label)}</div>
      <div class="board-kpi-value">${value}</div>
      <div class="board-kpi-sub">${_esc(sub)}</div>
    </div>`;
}
function _healthBar(label, count, total, cls) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="board-hbar-row">
      <span class="board-hbar-label">${_esc(label)}</span>
      <div class="board-hbar-track"><div class="board-hbar-fill ${cls}" style="width:${pct}%"></div></div>
      <span class="board-hbar-count">${count} (${pct}%)</span>
    </div>`;
}
// ─── TAB 8 — RESUMO IA (10.4) ────────────────────────────────────────────────

async function _renderAiSummary(body) {
  body.innerHTML = '<div class="board-loading"><span class="board-spinner"></span> Carregando resumo...</div>';

  let summary = null;
  try {
    const resp = await apiFetch('/v1/board/ai-summary/latest');
    summary = resp.data;
  } catch (_) {}

  const today = new Date().toLocaleDateString('pt-BR');

  body.innerHTML = `
    <section class="board-section board-ai-summary-section">
      <div class="board-ai-summary-header">
        <div>
          <h3 class="board-section-title">✦ Resumo Executivo — IA</h3>
          <p class="board-ai-summary-desc">Análise automática da plataforma gerada por IA a partir dos dados reais.</p>
        </div>
        <div class="board-ai-summary-actions">
          <button class="board-btn-primary" onclick="boardGenerateAiSummary()" id="btnGenerateSummary">
            ✦ Gerar Resumo de Hoje
          </button>
        </div>
      </div>

      ${summary ? `
        <div class="board-ai-summary-card" id="aiSummaryCard">
          <div class="board-ai-summary-meta">
            <span class="board-ai-summary-date">📅 ${new Date(summary.snapshotDate).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span class="board-ai-summary-gen">Gerado em ${new Date(summary.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div class="board-ai-summary-body">${_mdToHtml(summary.summaryPtBr)}</div>

          ${summary.keyInsights?.length ? `
            <div class="board-ai-insights">
              <strong>Principais métricas</strong>
              <div class="board-ai-insights-list">
                ${summary.keyInsights.map(i => `<span class="board-ai-insight-chip">✓ ${_esc(i)}</span>`).join('')}
              </div>
            </div>` : ''}

          ${summary.topRisks?.length ? `
            <div class="board-ai-risks">
              <strong>Pontos de atenção</strong>
              ${summary.topRisks.map(r => `
                <div class="board-ai-risk-item">
                  <span class="board-ai-risk-title">⚠ ${_esc(r.title)}</span>
                  <span class="board-ai-risk-impact">${_esc(r.impact)}</span>
                  <span class="board-ai-risk-action">→ ${_esc(r.action)}</span>
                </div>`).join('')}
            </div>` : ''}
        </div>
      ` : `
        <div class="board-ai-summary-empty">
          <p>Nenhum resumo gerado ainda hoje (${today}).</p>
          <p>Clique em <strong>"Gerar Resumo de Hoje"</strong> para criar o primeiro resumo executivo com IA.</p>
        </div>
      `}
    </section>`;
}

window.boardGenerateAiSummary = async () => {
  const btn = document.getElementById('btnGenerateSummary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando...'; }

  try {
    await apiFetch('/v1/board/ai-summary/generate', { method: 'POST' });
    await _renderAiSummary(document.getElementById('boardBody'));
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '✦ Gerar Resumo de Hoje'; }
    alert('Erro ao gerar resumo: ' + err.message);
  }
};

function _mdToHtml(md) {
  if (!md) return '';
  return md
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 class="board-md-h4">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="board-md-h3">$1</h3>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => line.startsWith('<') ? line : `<p>${line}</p>`)
    .replace(/<p><\/p>/g, '');
}

function _riskLabel(cat) {
  return { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' }[cat] ?? cat;
}
function _statusLabel(s) {
  return { popular: 'Popular', moderate: 'Moderado', low: 'Baixo', unused: 'Sem uso' }[s] ?? s;
}
function _sevLabel(s)  {
  return { critical: 'Crítico', warning: 'Atenção', info: 'Info' }[s] ?? s;
}
function _catLabel(c)  {
  return { revenue: 'Receita', churn: 'Churn', product: 'Produto', cs: 'CS', ai: 'IA', growth: 'Crescimento', support: 'Suporte' }[c] ?? c;
}
function _relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'agora';
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
