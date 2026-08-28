/**
 * Executive Intelligence Platform — Fase 9 GAMBY
 * 7 sub-tabs: Dashboard | Analytics | Revenue | Produto | IA Monitor | Upgrade | Churn
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

let _execMounted = false;
let _activeTab   = 'dashboard';
let _dashData    = null;

// ─── Mount ───────────────────────────────────────────────────────────────────

export function initExecutive() {
  if (_execMounted) return;
  _execMounted = true;

  const shell = document.getElementById('execShell');
  if (!shell) return;

  shell.innerHTML = `
    <div class="exec-root">
      <div class="exec-header">
        <h2 class="exec-title">Executive Intelligence Platform</h2>
        <span class="exec-badge">Fase 9</span>
      </div>
      <nav class="exec-tabs">
        <button class="exec-tab active" data-tab="dashboard">Dashboard</button>
        <button class="exec-tab" data-tab="analytics">Analytics</button>
        <button class="exec-tab" data-tab="revenue">Revenue</button>
        <button class="exec-tab" data-tab="product">Produto</button>
        <button class="exec-tab" data-tab="ai-monitor">IA Monitor</button>
        <button class="exec-tab" data-tab="upgrade">Upgrade</button>
        <button class="exec-tab" data-tab="churn">Churn</button>
      </nav>
      <div class="exec-body" id="execBody">
        <div class="exec-loading">Carregando...</div>
      </div>
    </div>`;

  shell.querySelectorAll('.exec-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      shell.querySelectorAll('.exec-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab = btn.dataset.tab;
      _loadTab(_activeTab);
    });
  });

  _loadTab('dashboard');
}

// ─── Tab router ──────────────────────────────────────────────────────────────

async function _loadTab(tab) {
  const body = document.getElementById('execBody');
  if (!body) return;
  body.innerHTML = '<div class="exec-loading"><span class="exec-spinner"></span> Carregando...</div>';

  try {
    switch (tab) {
      case 'dashboard': await _renderDashboard(body); break;
      case 'analytics': await _renderAnalytics(body); break;
      case 'revenue':   await _renderRevenue(body);   break;
      case 'product':   await _renderProduct(body);   break;
      case 'ai-monitor':await _renderAiMonitor(body); break;
      case 'upgrade':   await _renderUpgrade(body);   break;
      case 'churn':     await _renderChurn(body);     break;
    }
  } catch (err) {
    body.innerHTML = `<div class="exec-error"><strong>Erro ao carregar:</strong> ${_esc(err.message)}</div>`;
  }
}

// ─── 9.1 — Dashboard ─────────────────────────────────────────────────────────

async function _renderDashboard(body) {
  const { data } = await apiFetch('/v1/executive/dashboard');
  _dashData = data;

  const warn = data.dataWarnings?.length
    ? `<div class="exec-warn">${data.dataWarnings.map((w) => `⚠ ${_esc(w)}`).join('<br>')}</div>` : '';

  body.innerHTML = `
    ${warn}
    <div class="exec-kpi-grid">
      ${_kpi('MRR', _currency(data.mrr), 'Receita mensal recorrente')}
      ${_kpi('ARR', _currency(data.arr), 'Receita anual projetada')}
      ${_kpi('LTV', data.ltv ? _currency(data.ltv) : '—', data.ltvNote || 'Valor do ciclo de vida', !data.ltv)}
      ${_kpi('Churn Rate', data.monthlyChurnRate + '%', 'Cancelamentos / base ativa (mês)')}
      ${_kpi('Clientes Ativos', data.activeCompanyCount, 'Empresas com status ativo')}
      ${_kpi('Em Trial', data.trialCount, 'Empresas no período de trial')}
      ${_kpi('Inadimplentes', data.pastDueCount, 'Past due no billing', data.pastDueCount > 0)}
      ${_kpi('Novos (mês)', data.newThisMonth, 'Criadas neste mês')}
      ${_kpi('Cancelamentos (mês)', data.cancelledThisMonth, 'Canceladas neste mês', data.cancelledThisMonth > 0)}
      ${_kpi('Health Score Médio', data.avgHealthScore, '/100 — saúde média da base')}
      ${_kpi('Em Risco de Churn', data.churnRiskCount, 'Prob. cancelamento ≥ 50%', data.churnRiskCount > 0)}
      ${_kpi('Chamados Abertos', data.openSupportTickets, 'Tickets em aberto na plataforma', data.openSupportTickets > 5)}
    </div>

    <div class="exec-section-row">
      <div class="exec-card">
        <h4>Saúde da Base</h4>
        ${_healthBars(data.healthDistribution, data.activeCompanyCount)}
      </div>
      <div class="exec-card">
        <h4>MRR por Plano</h4>
        ${_planTable(data.planDistribution)}
      </div>
    </div>

    <div class="exec-section-actions">
      <button class="exec-btn-sm" onclick="execRefreshDash()">↺ Atualizar</button>
      <button class="exec-btn-sm" onclick="execSnapshot()">📸 Salvar Snapshot</button>
      <small class="exec-ts">Gerado em ${new Date(data.generatedAt).toLocaleString('pt-BR')}</small>
    </div>`;
}

function _kpi(label, value, sub, warn = false) {
  return `
    <div class="exec-kpi${warn ? ' exec-kpi-warn' : ''}">
      <div class="exec-kpi-label">${_esc(label)}</div>
      <div class="exec-kpi-value">${value}</div>
      <div class="exec-kpi-sub">${_esc(sub)}</div>
    </div>`;
}

function _healthBars(dist, total) {
  const items = [
    { key: 'healthy',   label: 'Saudável',  cls: 'bar-healthy'   },
    { key: 'attention', label: 'Atenção',   cls: 'bar-attention' },
    { key: 'risk',      label: 'Risco',     cls: 'bar-risk'      },
    { key: 'critical',  label: 'Crítico',   cls: 'bar-critical'  },
  ];
  return items.map((i) => {
    const count = dist[i.key] || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="exec-bar-row">
        <span class="exec-bar-label">${i.label}</span>
        <div class="exec-bar-track"><div class="exec-bar-fill ${i.cls}" style="width:${pct}%"></div></div>
        <span class="exec-bar-count">${count} (${pct}%)</span>
      </div>`;
  }).join('');
}

function _planTable(plans) {
  if (!plans?.length) return '<p class="exec-empty">Sem dados de plano</p>';
  return `
    <table class="exec-table">
      <thead><tr><th>Plano</th><th>Empresas</th><th>MRR</th></tr></thead>
      <tbody>
        ${plans.map((p) => `
          <tr>
            <td>${_esc(p.planName)}</td>
            <td>${p.companies}</td>
            <td>${_currency(p.mrr)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

window.execRefreshDash = async () => {
  _dashData = null;
  _loadTab('dashboard');
};
window.execSnapshot = async () => {
  try {
    await apiFetch('/v1/executive/snapshot', { method: 'POST' });
    alert('Snapshot salvo com sucesso.');
  } catch (e) {
    alert('Erro ao salvar snapshot: ' + e.message);
  }
};

// ─── 9.2 — Analytics (Funil) ─────────────────────────────────────────────────

async function _renderAnalytics(body) {
  const { data } = await apiFetch('/v1/executive/funnel');

  const warn = data.dataWarnings?.length
    ? `<div class="exec-warn">${data.dataWarnings.map((w) => `⚠ ${_esc(w)}`).join('<br>')}</div>` : '';

  body.innerHTML = `
    ${warn}
    <h3 class="exec-section-title">Funil de Aquisição SaaS</h3>
    <div class="exec-funnel">
      ${data.funnelStages.map((s, i) => `
        <div class="exec-funnel-stage">
          <div class="exec-funnel-bar-wrap">
            <div class="exec-funnel-bar" style="width:${Math.min(100, s.pct ?? 100)}%"></div>
          </div>
          <div class="exec-funnel-info">
            <span class="exec-funnel-name">${_esc(s.stage)}</span>
            <span class="exec-funnel-count">${s.count}</span>
            ${i > 0 ? `<span class="exec-funnel-conv">${s.pct}% conv.</span>` : '<span class="exec-funnel-conv">base</span>'}
          </div>
        </div>`).join('')}
    </div>

    <div class="exec-section-row">
      ${_kpi('Reg → Trial', data.convRegToTrial + '%', 'Conversão de cadastro para trial')}
      ${_kpi('Trial → Assinatura', data.convTrialToSub + '%', 'Conversão de trial para pago')}
      ${_kpi('Tempo Reg→Trial', data.avgDaysRegToTrial != null ? data.avgDaysRegToTrial + ' dias' : 'Dado insuficiente', 'Tempo médio até primeiro login')}
      ${_kpi('Tempo Trial→Sub', data.avgDaysTrialToSub != null ? data.avgDaysTrialToSub + ' dias' : 'Dado insuficiente', 'Tempo médio até primeiro pagamento')}
    </div>`;
}

// ─── 9.3 — Revenue Intelligence ──────────────────────────────────────────────

async function _renderRevenue(body) {
  const { data } = await apiFetch('/v1/executive/revenue');
  const { planStats, rankings } = data;

  body.innerHTML = `
    <h3 class="exec-section-title">Revenue Intelligence — por Plano</h3>
    <div class="exec-table-wrap">
      <table class="exec-table exec-table-revenue">
        <thead>
          <tr>
            <th>Plano</th>
            <th>Empresas</th>
            <th>MRR</th>
            <th>ARR</th>
            <th>ARPU</th>
            <th>Tickets/empresa</th>
            <th>Cancelados</th>
            <th>Churn Rate</th>
          </tr>
        </thead>
        <tbody>
          ${(planStats || []).map((p) => `
            <tr>
              <td><strong>${_esc(p.planName)}</strong><br><small>${_esc(p.planCode)}</small></td>
              <td>${p.companies}</td>
              <td>${_currency(p.mrr)}</td>
              <td>${_currency(p.arr)}</td>
              <td>${_currency(p.arpu)}</td>
              <td class="${p.ticketsPerCompany > 2 ? 'exec-warn-cell' : ''}">${p.ticketsPerCompany}</td>
              <td>${p.cancelledTotal}</td>
              <td class="${p.churnRate > 5 ? 'exec-warn-cell' : ''}">${p.churnRate}%</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="exec-rankings">
      <div class="exec-ranking-item">🏆 Maior MRR: <strong>${_esc(rankings.highestMrr ?? '—')}</strong></div>
      <div class="exec-ranking-item">⚡ Maior ARPU: <strong>${_esc(rankings.highestArpu ?? '—')}</strong></div>
      <div class="exec-ranking-item">⚠ Maior Churn: <strong>${_esc(rankings.highestChurn ?? '—')}</strong></div>
      <div class="exec-ranking-item">🎯 Menor Churn: <strong>${_esc(rankings.lowestChurn ?? '—')}</strong></div>
      <div class="exec-ranking-item">📞 Mais Suporte: <strong>${_esc(rankings.mostSupport ?? '—')}</strong></div>
    </div>`;
}

// ─── 9.4 — Product Intelligence ──────────────────────────────────────────────

async function _renderProduct(body) {
  const { data } = await apiFetch('/v1/executive/product');
  const { modules, totalActions, dataWarnings } = data;

  const warn = dataWarnings?.length
    ? `<div class="exec-warn">${dataWarnings.map((w) => `⚠ ${_esc(w)}`).join('<br>')}</div>` : '';

  const maxCount = modules[0]?.actionCount || 1;

  body.innerHTML = `
    ${warn}
    <h3 class="exec-section-title">Heatmap de Módulos — últimos 90 dias (${totalActions.toLocaleString('pt-BR')} ações)</h3>
    <div class="exec-heatmap">
      ${(modules || []).map((m) => {
        const pct = Math.round((m.actionCount / maxCount) * 100);
        const statusCls = { popular: 'heat-popular', moderate: 'heat-moderate', low: 'heat-low', unused: 'heat-unused' }[m.status] ?? '';
        return `
          <div class="exec-heat-card ${statusCls}">
            <div class="exec-heat-name">${_esc(m.module)}</div>
            <div class="exec-heat-bar"><div class="exec-heat-fill" style="width:${pct}%"></div></div>
            <div class="exec-heat-meta">
              <span>${m.actionCount.toLocaleString('pt-BR')} ações</span>
              <span>${m.adoptionRate}% empresas</span>
              <span class="exec-heat-badge exec-heat-${m.status}">${_statusLabel(m.status)}</span>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function _statusLabel(s) {
  return { popular: 'Popular', moderate: 'Moderado', low: 'Baixo', unused: 'Sem uso' }[s] ?? s;
}

// ─── 9.5 — AI Monitor ────────────────────────────────────────────────────────

async function _renderAiMonitor(body) {
  const { data } = await apiFetch('/v1/executive/ai-monitor');
  const { modelStats, topCompanies, totalCostUsdEstimated, totalConversations, totalTokens, periodDays } = data;

  body.innerHTML = `
    <h3 class="exec-section-title">AI Platform Monitor — últimos ${periodDays} dias</h3>
    <div class="exec-kpi-grid exec-kpi-grid-sm">
      ${_kpi('Custo Total Estimado', _usd(totalCostUsdEstimated), '(tabela pública de preços)')}
      ${_kpi('Conversações', totalConversations.toLocaleString('pt-BR'), 'conversações únicas')}
      ${_kpi('Tokens Totais', _formatTokens(totalTokens), 'input + output')}
    </div>

    <h4>Por Modelo</h4>
    <div class="exec-table-wrap">
      <table class="exec-table">
        <thead>
          <tr><th>Provedor</th><th>Modelo</th><th>Tokens In</th><th>Tokens Out</th><th>Custo USD</th><th>Conversações</th><th>Empresas</th></tr>
        </thead>
        <tbody>
          ${(modelStats || []).map((m) => `
            <tr>
              <td>${_esc(m.provider)}</td>
              <td><code>${_esc(m.model)}</code></td>
              <td>${_formatTokens(m.tokensInput)}</td>
              <td>${_formatTokens(m.tokensOutput)}</td>
              <td>$${m.costUsdEstimated.toFixed(4)}</td>
              <td>${m.conversations}</td>
              <td>${m.companies}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <h4>Top Consumidoras</h4>
    <div class="exec-table-wrap">
      <table class="exec-table">
        <thead>
          <tr><th>Empresa</th><th>Conversações</th><th>Tokens Totais</th><th>Custo Estimado</th></tr>
        </thead>
        <tbody>
          ${(topCompanies || []).map((c) => `
            <tr>
              <td>${_esc(c.companyName)}</td>
              <td>${c.conversations}</td>
              <td>${_formatTokens(c.tokensTotal)}</td>
              <td>$${c.costUsdEstimated.toFixed(4)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="exec-note">${_esc(data.costNote)}</p>`;
}

// ─── 9.6 — Upgrade Intelligence ──────────────────────────────────────────────

async function _renderUpgrade(body) {
  const { data } = await apiFetch('/v1/executive/upgrades?limit=50');
  const opps = data.data || [];

  body.innerHTML = `
    <h3 class="exec-section-title">Upgrade Intelligence — ${data.total} oportunidades</h3>
    ${opps.length === 0
      ? '<p class="exec-empty">Nenhuma oportunidade de upgrade identificada.</p>'
      : `<div class="exec-upgrade-list">
          ${opps.map((o) => `
            <div class="exec-upgrade-card">
              <div class="exec-upgrade-header">
                <strong>${_esc(o.companyName)}</strong>
                <span class="exec-score-badge exec-score-${_scoreClass(o.upgradeScore)}">${o.upgradeScore}/100</span>
              </div>
              <div class="exec-upgrade-plan">
                <span class="exec-plan-chip">${_esc(o.currentPlan)}</span>
                →
                <span class="exec-plan-chip exec-plan-suggested">${_esc(o.suggestedPlan)}</span>
              </div>
              <div class="exec-upgrade-signals">
                ${o.signalLabels.map((s) => `<span class="exec-signal-tag">${_esc(s)}</span>`).join('')}
              </div>
              <div class="exec-upgrade-actions">
                <select onchange="execUpgradeStatus('${_esc(o.companyId)}', this.value)" class="exec-select-sm">
                  <option value="">Alterar status...</option>
                  <option value="contacted">Contatado</option>
                  <option value="converted">Convertido</option>
                  <option value="dismissed">Descartado</option>
                </select>
              </div>
            </div>`).join('')}
        </div>`}`;
}

window.execUpgradeStatus = async (companyId, status) => {
  if (!status) return;
  try {
    await apiFetch(`/v1/executive/upgrades/${encodeURIComponent(companyId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    _loadTab('upgrade');
  } catch (e) {
    alert('Erro: ' + e.message);
  }
};

// ─── 9.7 — Churn Intelligence ────────────────────────────────────────────────

async function _renderChurn(body) {
  const { data } = await apiFetch('/v1/executive/churn?limit=50&minProb=30');
  const analyses = data.data || [];

  body.innerHTML = `
    <h3 class="exec-section-title">Churn Intelligence — ${data.total} empresas em risco</h3>
    ${analyses.length === 0
      ? '<p class="exec-empty">Nenhuma empresa com probabilidade de cancelamento ≥ 30%.</p>'
      : `<div class="exec-churn-list">
          ${analyses.map((a) => `
            <div class="exec-churn-card exec-churn-${a.riskCategory}">
              <div class="exec-churn-header">
                <strong>${_esc(a.companyName)}</strong>
                <span class="exec-prob-badge exec-prob-${a.riskCategory}">${a.cancellationProbability}% risco</span>
                <span class="exec-hs-mini">HS: ${a.healthScore}</span>
              </div>
              <pre class="exec-explanation">${_esc(a.explanation)}</pre>
              <div class="exec-action-plan">
                <strong>Plano de Ação:</strong>
                <ol>
                  ${(a.actionPlan || []).map((ap) => `<li><strong>${_esc(ap.action)}:</strong> ${_esc(ap.description)}</li>`).join('')}
                </ol>
              </div>
            </div>`).join('')}
        </div>`}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}

function _currency(n) {
  if (n == null) return '—';
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _usd(n) {
  return '$' + Number(n || 0).toFixed(2);
}

function _formatTokens(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

function _scoreClass(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}
