/**
 * GAMBY CONTROL CENTER
 * Painel interno exclusivo para developer_master e platform_admin.
 * Invisível para todos os usuários clientes.
 */

import { state }           from './state.js';
import { isDeveloperMaster } from './security-policy.js';
import { getAuthToken }    from './http.js';

const API = () => window.GAMBY_CONFIG?.apiUrl || 'http://localhost:4001';

function authHeaders() {
  const token = getAuthToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function ccFetch(path, opts = {}) {
  const res = await fetch(`${API()}/v1/control-center${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── State ───────────────────────────────────────────────────────────────────

let _activeTab = 'dashboard';
let _companyPage = 1;
let _companySearch = '';
let _companyStatus = '';
let _subPage = 1;
let _subStatus = '';
let _auditPage = 1;
let _auditSearch = '';
let _userPage = 1;
// new tabs
let _contractorPage = 1;
let _contractorSearch = '';
let _contractorStatus = '';
let _contractorRisk = '';
let _paymentPage = 1;
let _paymentStatus = '';
let _ticketPage = 1;
let _ticketStatus = '';
let _ticketPriority = '';
let _notifPage = 1;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export function initControlCenter() {
  const shell = document.getElementById('ccShell');
  if (!shell) return;

  _renderShell(shell);
  _switchTab('dashboard');
}

function _renderShell(shell) {
  shell.innerHTML = `
    <div class="cc-layout">
      <!-- Sidebar -->
      <aside class="cc-sidebar">
        <div class="cc-brand">
          <div class="cc-brand-icon">⚙</div>
          <div>
            <div class="cc-brand-name">GAMBY</div>
            <div class="cc-brand-sub">CONTROL CENTER</div>
          </div>
        </div>

        <nav class="cc-nav">
          <button class="cc-nav-btn active" data-tab="dashboard">
            <span class="cc-nav-ico">📊</span> Dashboard Executivo
          </button>
          <button class="cc-nav-btn" data-tab="contractors">
            <span class="cc-nav-ico">🏢</span> Contratantes
          </button>
          <button class="cc-nav-btn" data-tab="subscriptions">
            <span class="cc-nav-ico">💳</span> Assinaturas
          </button>
          <button class="cc-nav-btn" data-tab="payments">
            <span class="cc-nav-ico">💰</span> Pagamentos
          </button>
          <button class="cc-nav-btn" data-tab="funnel">
            <span class="cc-nav-ico">🎯</span> Funil de Cadastro
          </button>
          <button class="cc-nav-btn" data-tab="cc-support">
            <span class="cc-nav-ico">🎫</span> Suporte
          </button>
          <button class="cc-nav-btn" data-tab="notifications">
            <span class="cc-nav-ico">🔔</span> Notificações
          </button>
          <button class="cc-nav-btn" data-tab="users">
            <span class="cc-nav-ico">👥</span> Usuários
          </button>
          <button class="cc-nav-btn" data-tab="monitoring">
            <span class="cc-nav-ico">🖥</span> Monitoramento
          </button>
          <button class="cc-nav-btn" data-tab="audit">
            <span class="cc-nav-ico">🔍</span> Auditoria
          </button>
          <button class="cc-nav-btn" data-tab="versions">
            <span class="cc-nav-ico">🚀</span> Versões
          </button>
        </nav>

        <div class="cc-sidebar-footer">
          <div class="cc-user-badge">
            <div class="cc-user-dot"></div>
            <div>
              <div class="cc-user-name">${state.currentUser?.name || 'Platform User'}</div>
              <div class="cc-user-role">${_roleLabel(state.currentUser?.role)}</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="cc-main" id="ccMain">
        <div class="cc-loading">Carregando...</div>
      </main>
    </div>
  `;

  shell.querySelectorAll('.cc-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
  });
}

function _switchTab(tab) {
  _activeTab = tab;
  const shell = document.getElementById('ccShell');
  if (!shell) return;

  shell.querySelectorAll('.cc-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  const main = document.getElementById('ccMain');
  if (!main) return;

  main.innerHTML = `<div class="cc-loading"><div class="cc-spinner"></div>Carregando...</div>`;

  const handlers = {
    dashboard:     _renderDashboard,
    companies:     _renderCompanies,
    contractors:   _renderContractors,
    subscriptions: _renderSubscriptions,
    payments:      _renderPayments,
    funnel:        _renderFunnel,
    'cc-support':  _renderCCSupport,
    notifications: _renderNotifications,
    users:         _renderUsers,
    monitoring:    _renderMonitoring,
    audit:         _renderAudit,
    versions:      _renderVersions,
  };

  (handlers[tab] || _renderDashboard)().catch(err => {
    main.innerHTML = `<div class="cc-error-block">Erro ao carregar: ${err.message}</div>`;
  });
}

// ─── Dashboard Executivo ──────────────────────────────────────────────────────

async function _renderDashboard() {
  const [summary, health] = await Promise.all([
    ccFetch('/summary'),
    ccFetch('/monitoring/health'),
  ]);

  const main = document.getElementById('ccMain');
  if (!main) return;

  const c = summary.companies;
  const s = summary.sales;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Dashboard Executivo</h1>
      <div class="cc-header-badges">
        <span class="cc-status-badge ${health.status === 'operational' ? 'cc-badge-ok' : 'cc-badge-warn'}">
          ${health.status === 'operational' ? '🟢 Sistema Operacional' : '🟡 Degradado'}
        </span>
        <span class="cc-ts">Atualizado ${new Date().toLocaleTimeString('pt-BR')}</span>
      </div>
    </div>

    <!-- KPI Grid -->
    <div class="cc-kpi-grid">
      ${_kpiCard('Total de Empresas', c.total, '', 'cc-kpi-neutral')}
      ${_kpiCard('Ativas', c.active, '', 'cc-kpi-green')}
      ${_kpiCard('Trial', c.trial, '', 'cc-kpi-yellow')}
      ${_kpiCard('Bloqueadas', c.blocked, '', 'cc-kpi-red')}
      ${_kpiCard('Canceladas', c.cancelled, '', 'cc-kpi-gray')}
      ${_kpiCard('Usuários Ativos', summary.users.total, '', 'cc-kpi-blue')}
      ${_kpiCard('Ativos 7 dias', summary.users.activeIn7d, '', 'cc-kpi-blue')}
      ${_kpiCard('Vendas 24h', s.last24h.count, _fmtBRL(s.last24h.revenue), 'cc-kpi-neutral')}
    </div>

    <!-- Two-column row -->
    <div class="cc-row-2col">
      <!-- Status das Empresas -->
      <div class="cc-card">
        <div class="cc-card-header">Status das Empresas</div>
        <div class="cc-status-bars">
          ${_statusBar('Ativas',     c.active,    c.total, '#22c55e')}
          ${_statusBar('Trial',      c.trial,     c.total, '#f59e0b')}
          ${_statusBar('Bloqueadas', c.blocked,   c.total, '#ef4444')}
          ${_statusBar('Canceladas', c.cancelled, c.total, '#6b7280')}
        </div>
      </div>

      <!-- Saúde dos Serviços -->
      <div class="cc-card">
        <div class="cc-card-header">Saúde dos Serviços</div>
        <div class="cc-service-list">
          ${Object.entries(health.services).map(([name, svc]) => `
            <div class="cc-service-row">
              <span class="cc-service-dot ${_svcColor(svc.status)}"></span>
              <span class="cc-service-name">${_svcLabel(name)}</span>
              <span class="cc-service-status">${_svcText(svc)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Server Info -->
    <div class="cc-card cc-server-card">
      <div class="cc-card-header">Servidor</div>
      <div class="cc-server-grid">
        <div><span class="cc-sl">Uptime</span><strong>${health.server.uptimeHuman}</strong></div>
        <div><span class="cc-sl">Node</span><strong>${health.server.nodeVersion}</strong></div>
        <div><span class="cc-sl">CPUs</span><strong>${health.server.cpuCount} cores</strong></div>
        <div><span class="cc-sl">Load avg</span><strong>${health.server.loadAvg1m}</strong></div>
        <div><span class="cc-sl">Heap</span><strong>${health.memory.heapUsedMb} / ${health.memory.heapTotalMb} MB</strong></div>
        <div><span class="cc-sl">RAM usada</span><strong>${health.memory.usedPct}%</strong></div>
        <div><span class="cc-sl">DB latency</span><strong>${health.services.database.latencyMs}ms</strong></div>
        <div><span class="cc-sl">Erros 24h</span><strong>${health.recentErrors}</strong></div>
      </div>
    </div>
  `;

  document.getElementById('ccMain').querySelector('.cc-kpi-grid')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

// ─── Gestão de Clientes ───────────────────────────────────────────────────────

async function _renderCompanies() {
  const data = await ccFetch(`/companies?page=${_companyPage}&limit=50&status=${_companyStatus}&search=${encodeURIComponent(_companySearch)}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Gestão de Clientes</h1>
      <span class="cc-badge-count">${data.total} empresas</span>
    </div>

    <div class="cc-filters">
      <input class="cc-input" id="ccCompanySearch" type="text" placeholder="Buscar empresa, CNPJ, e-mail..." value="${_escHtml(_companySearch)}">
      <select class="cc-select" id="ccCompanyStatus">
        <option value="">Todos os status</option>
        <option value="active"    ${_companyStatus === 'active'    ? 'selected' : ''}>🟢 Ativo</option>
        <option value="trial"     ${_companyStatus === 'trial'     ? 'selected' : ''}>🟡 Trial</option>
        <option value="blocked"   ${_companyStatus === 'blocked'   ? 'selected' : ''}>🔴 Bloqueado</option>
        <option value="cancelled" ${_companyStatus === 'cancelled' ? 'selected' : ''}>⚫ Cancelado</option>
      </select>
      <button class="cc-btn-primary" id="ccCompanySearchBtn">Filtrar</button>
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead>
          <tr>
            <th>Empresa</th><th>CNPJ</th><th>Plano</th><th>Status</th>
            <th>Usuários</th><th>Vendas</th><th>Cadastro</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(c => `
            <tr>
              <td>
                <div class="cc-company-name">${_escHtml(c.tradeName)}</div>
                ${c.email ? `<div class="cc-company-email">${_escHtml(c.email)}</div>` : ''}
              </td>
              <td class="cc-mono">${c.cnpj ? _fmtCnpj(c.cnpj) : '—'}</td>
              <td>${_planBadge(c.subscription?.plan?.code)}</td>
              <td>${_statusDot(c.status)}</td>
              <td class="cc-num">${c._count?.users ?? 0}</td>
              <td class="cc-num">${c._count?.sales ?? 0}</td>
              <td class="cc-date">${_fmtDate(c.createdAt)}</td>
              <td>
                <button class="cc-btn-sm" data-company-id="${c.id}" data-action="details">Detalhes</button>
                ${isDeveloperMaster() ? `
                  <select class="cc-select-sm cc-status-sel" data-company-id="${c.id}" data-action="status">
                    <option value="">Status...</option>
                    <option value="active">Ativar</option>
                    <option value="blocked">Bloquear</option>
                    <option value="cancelled">Cancelar</option>
                  </select>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-company-page')}
  `;

  main.querySelector('#ccCompanySearchBtn')?.addEventListener('click', () => {
    _companySearch = main.querySelector('#ccCompanySearch')?.value || '';
    _companyStatus = main.querySelector('#ccCompanyStatus')?.value || '';
    _companyPage   = 1;
    _renderCompanies().catch(console.error);
  });

  main.querySelectorAll('[data-action="details"]').forEach(btn => {
    btn.addEventListener('click', () => _showCompanyDetails(btn.dataset.companyId));
  });

  main.querySelectorAll('[data-action="status"]').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const name = sel.closest('tr')?.querySelector('.cc-company-name')?.textContent;
      if (!confirm(`Alterar status de "${name}" para "${sel.value}"?`)) { sel.value = ''; return; }
      try {
        await ccFetch(`/companies/${sel.dataset.companyId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        _renderCompanies();
      } catch (err) {
        alert(`Erro: ${err.message}`);
        sel.value = '';
      }
    });
  });

  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _companyPage = Number(btn.dataset.page);
      _renderCompanies().catch(console.error);
    });
  });
}

async function _showCompanyDetails(id) {
  const main = document.getElementById('ccMain');
  if (!main) return;
  main.innerHTML = `<div class="cc-loading"><div class="cc-spinner"></div>Carregando empresa...</div>`;

  try {
    const { company, metrics, recentAudit } = await ccFetch(`/companies/${id}`);
    const sub = company.subscriptions?.[0];

    main.innerHTML = `
      <div class="cc-page-header">
        <button class="cc-btn-back" id="ccBackBtn">← Voltar</button>
        <h1 class="cc-page-title">${_escHtml(company.tradeName)}</h1>
        ${_statusDot(company.status)}
      </div>

      <div class="cc-detail-grid">
        <!-- Info Principal -->
        <div class="cc-card">
          <div class="cc-card-header">Informações</div>
          <div class="cc-detail-rows">
            <div class="cc-dr"><span>Razão Social</span><strong>${_escHtml(company.legalName || '—')}</strong></div>
            <div class="cc-dr"><span>CNPJ</span><strong class="cc-mono">${company.cnpj ? _fmtCnpj(company.cnpj) : '—'}</strong></div>
            <div class="cc-dr"><span>E-mail</span><strong>${_escHtml(company.email || '—')}</strong></div>
            <div class="cc-dr"><span>Telefone</span><strong>${_escHtml(company.phone || '—')}</strong></div>
            <div class="cc-dr"><span>Segmento</span><strong>${_escHtml(company.businessType || '—')}</strong></div>
            <div class="cc-dr"><span>Cadastro</span><strong>${_fmtDate(company.createdAt)}</strong></div>
          </div>
        </div>

        <!-- Assinatura -->
        <div class="cc-card">
          <div class="cc-card-header">Assinatura</div>
          <div class="cc-detail-rows">
            <div class="cc-dr"><span>Plano</span><strong>${sub ? _planBadge(sub.plan?.code) : '—'}</strong></div>
            <div class="cc-dr"><span>Status</span><strong>${_subStatusBadge(sub?.status)}</strong></div>
            <div class="cc-dr"><span>Ciclo</span><strong>${sub?.billingCycle || '—'}</strong></div>
            <div class="cc-dr"><span>Vencimento</span><strong>${sub?.currentPeriodEnd ? _fmtDate(sub.currentPeriodEnd) : '—'}</strong></div>
            <div class="cc-dr"><span>Trial encerra</span><strong>${sub?.trialEndsAt ? _fmtDate(sub.trialEndsAt) : '—'}</strong></div>
            <div class="cc-dr"><span>Auto-renovação</span><strong>${sub?.autoDebitEnabled ? '✓ Ativo' : '✗ Não'}</strong></div>
          </div>
        </div>

        <!-- Métricas -->
        <div class="cc-card">
          <div class="cc-card-header">Métricas (30 dias)</div>
          <div class="cc-kpi-mini-grid">
            <div class="cc-kpi-mini"><div class="cc-kpi-mini-val">${metrics.salesLast30d.count}</div><div>Vendas</div></div>
            <div class="cc-kpi-mini"><div class="cc-kpi-mini-val">${_fmtBRL(metrics.salesLast30d.revenue)}</div><div>Receita</div></div>
            <div class="cc-kpi-mini"><div class="cc-kpi-mini-val">${company._count?.users ?? 0}</div><div>Usuários</div></div>
            <div class="cc-kpi-mini"><div class="cc-kpi-mini-val">${company._count?.products ?? 0}</div><div>Produtos</div></div>
          </div>
        </div>

        <!-- Usuários -->
        <div class="cc-card">
          <div class="cc-card-header">Usuários Ativos</div>
          <div class="cc-user-mini-list">
            ${(company.users || []).slice(0, 8).map(u => `
              <div class="cc-user-mini-row">
                <span class="cc-role-tag cc-role-${u.role}">${_roleTag(u.role)}</span>
                <span>${_escHtml(u.name)}</span>
                <span class="cc-date">${u.lastLoginAt ? _fmtDate(u.lastLoginAt) : 'nunca'}</span>
              </div>
            `).join('') || '<div class="cc-empty">Nenhum usuário ativo</div>'}
          </div>
        </div>
      </div>

      <!-- Auditoria recente -->
      <div class="cc-card">
        <div class="cc-card-header">Auditoria Recente</div>
        ${recentAudit.length ? `
          <table class="cc-table cc-audit-mini">
            <thead><tr><th>Ação</th><th>Data</th></tr></thead>
            <tbody>
              ${recentAudit.map(a => `
                <tr>
                  <td class="cc-mono">${_escHtml(a.action)}</td>
                  <td class="cc-date">${_fmtDateTime(a.createdAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>` : '<div class="cc-empty">Sem registros recentes</div>'}
      </div>
    `;

    main.querySelector('#ccBackBtn')?.addEventListener('click', () => {
      _companyPage = 1;
      _renderCompanies();
    });
  } catch (err) {
    main.innerHTML = `<div class="cc-error-block">Erro ao carregar: ${err.message}</div>
      <button class="cc-btn-back" onclick="">← Voltar</button>`;
    main.querySelector('.cc-btn-back')?.addEventListener('click', () => _renderCompanies());
  }
}

// ─── Assinaturas ─────────────────────────────────────────────────────────────

async function _renderSubscriptions() {
  const data = await ccFetch(`/subscriptions?page=${_subPage}&limit=50&status=${_subStatus}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  const byStatus = {};
  data.data.forEach(s => { byStatus[s.status] = (byStatus[s.status] || 0) + 1; });

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Assinaturas</h1>
      <span class="cc-badge-count">${data.total} registros</span>
    </div>

    <div class="cc-sub-stats">
      ${['active','trial','past_due','cancelled','blocked'].map(s => `
        <div class="cc-sub-stat-card cc-sub-${s}">
          <div class="cc-sub-stat-val">${byStatus[s] || 0}</div>
          <div class="cc-sub-stat-lbl">${_subStatusLabel(s)}</div>
        </div>
      `).join('')}
    </div>

    <div class="cc-filters">
      <select class="cc-select" id="ccSubStatus">
        <option value="">Todos os status</option>
        ${['active','trial','past_due','unpaid','cancelled','blocked','suspended','paused'].map(s => `
          <option value="${s}" ${_subStatus === s ? 'selected' : ''}>${_subStatusLabel(s)}</option>
        `).join('')}
      </select>
      <button class="cc-btn-primary" id="ccSubFilterBtn">Filtrar</button>
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead>
          <tr><th>Empresa</th><th>Plano</th><th>Ciclo</th><th>Status</th><th>Vencimento</th><th>MRR est.</th></tr>
        </thead>
        <tbody>
          ${data.data.map(s => `
            <tr>
              <td>
                <div class="cc-company-name">${_escHtml(s.company?.tradeName || '—')}</div>
                <div class="cc-company-email">${_escHtml(s.company?.email || '')}</div>
              </td>
              <td>${_planBadge(s.plan?.code)}</td>
              <td>${s.billingCycle === 'monthly' ? 'Mensal' : 'Anual'}</td>
              <td>${_subStatusBadge(s.status)}</td>
              <td class="cc-date">${s.currentPeriodEnd ? _fmtDate(s.currentPeriodEnd) : s.trialEndsAt ? `Trial: ${_fmtDate(s.trialEndsAt)}` : '—'}</td>
              <td class="cc-num">${s.billingCycle === 'monthly' ? _fmtBRL(s.priceMonthly) : _fmtBRL(s.priceYearly / 12)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-sub-page')}
  `;

  main.querySelector('#ccSubFilterBtn')?.addEventListener('click', () => {
    _subStatus = main.querySelector('#ccSubStatus')?.value || '';
    _subPage = 1;
    _renderSubscriptions().catch(console.error);
  });
  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _subPage = Number(btn.dataset.page); _renderSubscriptions().catch(console.error); });
  });
}

// ─── Usuários ────────────────────────────────────────────────────────────────

async function _renderUsers() {
  const data = await ccFetch(`/users?page=${_userPage}&limit=50&search=${encodeURIComponent(_companySearch)}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  const byRole = {};
  data.data.forEach(u => { byRole[u.role] = (byRole[u.role] || 0) + 1; });

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Usuários da Plataforma</h1>
      <span class="cc-badge-count">${data.total} usuários</span>
    </div>

    <div class="cc-role-stats">
      ${Object.entries(byRole).map(([role, count]) => `
        <div class="cc-role-stat">
          <span class="cc-role-tag cc-role-${role}">${_roleTag(role)}</span>
          <strong>${count}</strong>
        </div>
      `).join('')}
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead>
          <tr><th>Nome</th><th>E-mail</th><th>Empresa</th><th>Função</th><th>Status</th><th>Último login</th></tr>
        </thead>
        <tbody>
          ${data.data.map(u => `
            <tr>
              <td>${_escHtml(u.name)}</td>
              <td class="cc-company-email">${_escHtml(u.email)}</td>
              <td>${_escHtml(u.company?.tradeName || '—')}</td>
              <td><span class="cc-role-tag cc-role-${u.role}">${_roleLabel(u.role)}</span></td>
              <td>${u.isActive ? '<span class="cc-badge-active">Ativo</span>' : '<span class="cc-badge-inactive">Inativo</span>'}</td>
              <td class="cc-date">${u.lastLoginAt ? _fmtDateTime(u.lastLoginAt) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-user-page')}
  `;

  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _userPage = Number(btn.dataset.page); _renderUsers().catch(console.error); });
  });
}

// ─── Monitoramento ────────────────────────────────────────────────────────────

async function _renderMonitoring() {
  const [health, stats] = await Promise.all([
    ccFetch('/monitoring/health'),
    ccFetch('/monitoring/stats'),
  ]);
  const main = document.getElementById('ccMain');
  if (!main) return;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Monitoramento</h1>
      <button class="cc-btn-secondary" id="ccRefreshHealth">↺ Atualizar</button>
    </div>

    <!-- Status dos Serviços -->
    <div class="cc-card">
      <div class="cc-card-header">Status dos Serviços</div>
      <div class="cc-monitor-grid">
        ${Object.entries(health.services).map(([name, svc]) => `
          <div class="cc-monitor-card cc-svc-${svc.status}">
            <div class="cc-monitor-dot ${_svcColor(svc.status)}"></div>
            <div class="cc-monitor-name">${_svcLabel(name)}</div>
            <div class="cc-monitor-status">${_svcStatusLabel(svc.status)}</div>
            ${svc.latencyMs ? `<div class="cc-monitor-latency">${svc.latencyMs}ms</div>` : ''}
            ${svc.note ? `<div class="cc-monitor-note">${svc.note}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Servidor -->
    <div class="cc-row-2col">
      <div class="cc-card">
        <div class="cc-card-header">Recursos do Servidor</div>
        <div class="cc-monitor-meter">
          <div class="cc-meter-label">RAM utilizada</div>
          <div class="cc-meter-bar"><div class="cc-meter-fill" style="width:${health.memory.usedPct}%"></div></div>
          <div class="cc-meter-val">${health.memory.usedPct}% — ${health.memory.freeMb}MB livre de ${health.memory.totalMb}MB</div>
        </div>
        <div class="cc-monitor-meter">
          <div class="cc-meter-label">Heap Node.js</div>
          <div class="cc-meter-bar"><div class="cc-meter-fill cc-meter-blue" style="width:${Math.round(health.memory.heapUsedMb / health.memory.heapTotalMb * 100)}%"></div></div>
          <div class="cc-meter-val">${health.memory.heapUsedMb}MB de ${health.memory.heapTotalMb}MB</div>
        </div>
        <div class="cc-server-grid cc-mt">
          <div><span class="cc-sl">Load avg (1m)</span><strong>${health.server.loadAvg1m}</strong></div>
          <div><span class="cc-sl">Load avg (5m)</span><strong>${health.server.loadAvg5m}</strong></div>
          <div><span class="cc-sl">CPUs</span><strong>${health.server.cpuCount} cores</strong></div>
          <div><span class="cc-sl">Plataforma</span><strong>${health.server.platform} / ${health.server.arch}</strong></div>
        </div>
      </div>

      <div class="cc-card">
        <div class="cc-card-header">Estatísticas da Plataforma</div>
        <div class="cc-detail-rows">
          <div class="cc-dr"><span>Versão</span><strong>${stats.version}</strong></div>
          <div class="cc-dr"><span>Ambiente</span><strong class="cc-env-badge">${stats.buildEnv}</strong></div>
          <div class="cc-dr"><span>Node.js</span><strong>${stats.nodeVersion}</strong></div>
          <div class="cc-dr"><span>Uptime</span><strong>${health.server.uptimeHuman}</strong></div>
          <div class="cc-dr"><span>Iniciado em</span><strong>${_fmtDateTime(stats.startedAt)}</strong></div>
          <div class="cc-dr"><span>Total de empresas</span><strong>${stats.totals.companies}</strong></div>
          <div class="cc-dr"><span>Total de usuários</span><strong>${stats.totals.users}</strong></div>
          <div class="cc-dr"><span>Total de vendas</span><strong>${stats.totals.sales.toLocaleString('pt-BR')}</strong></div>
        </div>
      </div>
    </div>

    <!-- Dispositivos e integrações externas (stubs) -->
    <div class="cc-card">
      <div class="cc-card-header">Device Hub & Integrações Externas <span class="cc-badge-stub">Em desenvolvimento</span></div>
      <div class="cc-stub-grid">
        ${['Impressoras','Scanners','Gavetas de Caixa','Balanças','TEF','PIX','NFC-e','SAT','Cloudflare','Redis','WhatsApp API'].map(d => `
          <div class="cc-stub-item"><span class="cc-stub-dot"></span>${d}</div>
        `).join('')}
      </div>
    </div>
  `;

  main.querySelector('#ccRefreshHealth')?.addEventListener('click', () => _renderMonitoring());
}

// ─── Auditoria ────────────────────────────────────────────────────────────────

async function _renderAudit() {
  const data = await ccFetch(`/audit-logs?page=${_auditPage}&limit=100&action=${encodeURIComponent(_auditSearch)}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Auditoria da Plataforma</h1>
      <span class="cc-badge-count">${data.total} eventos</span>
    </div>

    <div class="cc-filters">
      <input class="cc-input" id="ccAuditSearch" type="text" placeholder="Filtrar por ação..." value="${_escHtml(_auditSearch)}">
      <button class="cc-btn-primary" id="ccAuditSearchBtn">Filtrar</button>
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table cc-audit-table">
        <thead>
          <tr><th>Empresa</th><th>Usuário</th><th>Ação</th><th>Data/Hora</th></tr>
        </thead>
        <tbody>
          ${data.data.map(log => `
            <tr>
              <td>${_escHtml(log.company?.tradeName || '—')}</td>
              <td>${_escHtml(log.user?.name || '—')}<br><span class="cc-company-email">${_escHtml(log.user?.role || '')}</span></td>
              <td class="cc-mono cc-action-cell">${_escHtml(log.action)}</td>
              <td class="cc-date">${_fmtDateTime(log.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-audit-page')}
  `;

  main.querySelector('#ccAuditSearchBtn')?.addEventListener('click', () => {
    _auditSearch = main.querySelector('#ccAuditSearch')?.value || '';
    _auditPage = 1;
    _renderAudit().catch(console.error);
  });
  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _auditPage = Number(btn.dataset.page); _renderAudit().catch(console.error); });
  });
}

// ─── Versões ──────────────────────────────────────────────────────────────────

async function _renderVersions() {
  const stats = await ccFetch('/monitoring/stats');
  const main  = document.getElementById('ccMain');
  if (!main) return;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Versões & Governança</h1>
    </div>

    <div class="cc-row-2col">
      <div class="cc-card">
        <div class="cc-card-header">Versão Atual</div>
        <div class="cc-detail-rows">
          <div class="cc-dr"><span>Versão da API</span><strong class="cc-version-badge">v${stats.version}</strong></div>
          <div class="cc-dr"><span>Ambiente</span><strong class="cc-env-badge">${stats.buildEnv}</strong></div>
          <div class="cc-dr"><span>Node.js</span><strong>${stats.nodeVersion}</strong></div>
          <div class="cc-dr"><span>Deploy em</span><strong>${_fmtDateTime(stats.startedAt)}</strong></div>
        </div>
      </div>

      <div class="cc-card">
        <div class="cc-card-header">Controle de Releases <span class="cc-badge-stub">Em desenvolvimento</span></div>
        <div class="cc-stub-features">
          <div class="cc-stub-feature">🚀 Deploy controlado por empresa</div>
          <div class="cc-stub-feature">🔄 Rollback de versão</div>
          <div class="cc-stub-feature">🏳 Feature Flags por empresa</div>
          <div class="cc-stub-feature">📦 Distribuição gradual (canary)</div>
          <div class="cc-stub-feature">🧪 Ambiente Beta separado</div>
        </div>
      </div>
    </div>

    <div class="cc-card">
      <div class="cc-card-header">Módulos da Plataforma</div>
      <div class="cc-modules-grid">
        ${['PDV','Estoque','Financeiro','Caixa','Dashboard','Analytics','PDV Analytics',
           'Business Intelligence','WhatsApp','Email','Marketplace','Aprendizado',
           'GAMBY Copilot (em desenvolvimento)','Device Hub (em desenvolvimento)'].map((m, i) => `
          <div class="cc-module-item ${i >= 12 ? 'cc-module-dev' : 'cc-module-active'}">
            ${i >= 12 ? '🔧' : '✓'} ${m}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── Contratantes ─────────────────────────────────────────────────────────────

async function _renderContractors() {
  const q = `page=${_contractorPage}&limit=50&status=${_contractorStatus}&search=${encodeURIComponent(_contractorSearch)}&risk=${_contractorRisk}`;
  const data = await ccFetch(`/contractors?${q}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  const riskLabels = { healthy: '🟢 Saudável', warning: '🟡 Atenção', at_risk: '🔴 Risco', inactive: '⚫ Inativo' };

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Contratantes</h1>
      <span class="cc-badge-count">${data.total} empresas</span>
    </div>

    <div class="cc-filters">
      <input class="cc-input" id="ccCtSearch" type="text" placeholder="Buscar empresa..." value="${_escHtml(_contractorSearch)}">
      <select class="cc-select" id="ccCtStatus">
        <option value="">Todos status</option>
        <option value="active"    ${_contractorStatus==='active'    ? 'selected':''}>🟢 Ativo</option>
        <option value="trial"     ${_contractorStatus==='trial'     ? 'selected':''}>🟡 Trial</option>
        <option value="blocked"   ${_contractorStatus==='blocked'   ? 'selected':''}>🔴 Bloqueado</option>
        <option value="cancelled" ${_contractorStatus==='cancelled' ? 'selected':''}>⚫ Cancelado</option>
      </select>
      <select class="cc-select" id="ccCtRisk">
        <option value="">Todos riscos</option>
        <option value="healthy"  ${_contractorRisk==='healthy'  ? 'selected':''}>🟢 Saudável</option>
        <option value="warning"  ${_contractorRisk==='warning'  ? 'selected':''}>🟡 Atenção</option>
        <option value="at_risk"  ${_contractorRisk==='at_risk'  ? 'selected':''}>🔴 Em risco</option>
        <option value="inactive" ${_contractorRisk==='inactive' ? 'selected':''}>⚫ Inativo</option>
      </select>
      <button class="cc-btn-primary" id="ccCtSearchBtn">Filtrar</button>
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead>
          <tr><th>Empresa</th><th>Plano</th><th>Status</th><th>Risco</th><th>Último Login</th><th>Última Venda</th><th>Tickets</th><th>Ações</th></tr>
        </thead>
        <tbody>
          ${data.data.map(c => `
            <tr>
              <td>
                <div class="cc-company-name">${_escHtml(c.tradeName)}</div>
                <div class="cc-company-email">${_escHtml(c.email || '')}</div>
              </td>
              <td>${_planBadge(c.subscription?.plan?.code)}</td>
              <td>${_statusDot(c.status)}</td>
              <td><span class="cc-risk-${c.riskLevel}">${riskLabels[c.riskLevel] || c.riskLevel}</span></td>
              <td class="cc-date">${c.lastLoginAt ? _fmtDate(c.lastLoginAt) : '<span class="cc-empty-cell">Nunca</span>'}</td>
              <td class="cc-date">${c.lastSaleAt  ? _fmtDate(c.lastSaleAt)  : '<span class="cc-empty-cell">Nenhuma</span>'}</td>
              <td class="cc-num">${c._count?.supportTickets ?? 0}</td>
              <td>
                <button class="cc-btn-sm" data-contractor-id="${c.id}" data-action="ct-details">Detalhes</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-ct-page')}
  `;

  main.querySelector('#ccCtSearchBtn')?.addEventListener('click', () => {
    _contractorSearch = main.querySelector('#ccCtSearch')?.value || '';
    _contractorStatus = main.querySelector('#ccCtStatus')?.value || '';
    _contractorRisk   = main.querySelector('#ccCtRisk')?.value   || '';
    _contractorPage   = 1;
    _renderContractors().catch(console.error);
  });
  main.querySelectorAll('[data-action="ct-details"]').forEach(btn => {
    btn.addEventListener('click', () => _showContractorDetails(btn.dataset.contractorId));
  });
  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _contractorPage = Number(btn.dataset.page); _renderContractors().catch(console.error); });
  });
}

async function _showContractorDetails(id) {
  const main = document.getElementById('ccMain');
  if (!main) return;
  main.innerHTML = `<div class="cc-loading"><div class="cc-spinner"></div>Carregando...</div>`;

  try {
    const { company, lifecycle, tickets, salesLast90d } = await ccFetch(`/contractors/${id}`);

    main.innerHTML = `
      <div class="cc-page-header">
        <button class="cc-btn-back" id="ccBackBtn">← Contratantes</button>
        <h1 class="cc-page-title">${_escHtml(company.tradeName)}</h1>
        ${_statusDot(company.status)}
      </div>

      <div class="cc-row-2col">
        <div class="cc-card">
          <div class="cc-card-header">Informações</div>
          <div class="cc-detail-rows">
            <div class="cc-dr"><span>CNPJ</span><strong class="cc-mono">${company.cnpj ? _fmtCnpj(company.cnpj) : '—'}</strong></div>
            <div class="cc-dr"><span>E-mail</span><strong>${_escHtml(company.email || '—')}</strong></div>
            <div class="cc-dr"><span>Segmento</span><strong>${_escHtml(company.businessType || '—')}</strong></div>
            <div class="cc-dr"><span>Usuários</span><strong>${company._count?.users ?? 0}</strong></div>
            <div class="cc-dr"><span>Produtos</span><strong>${company._count?.products ?? 0}</strong></div>
            <div class="cc-dr"><span>Vendas totais</span><strong>${company._count?.sales?.toLocaleString('pt-BR') ?? 0}</strong></div>
            <div class="cc-dr"><span>Vendas 90d</span><strong>${salesLast90d.count} — ${_fmtBRL(salesLast90d.revenue)}</strong></div>
          </div>
        </div>

        <div class="cc-card">
          <div class="cc-card-header">Tickets de Suporte</div>
          ${tickets.length ? `
            <div class="cc-mini-ticket-list">
              ${tickets.map(t => `
                <div class="cc-mini-ticket">
                  <span class="cc-ticket-status-dot cc-ts-${t.status}"></span>
                  <span class="cc-mini-ticket-subject">${_escHtml(t.subject)}</span>
                  <span class="cc-date">${_fmtDate(t.createdAt)}</span>
                </div>
              `).join('')}
            </div>` : '<div class="cc-empty">Nenhum ticket de suporte</div>'}
        </div>
      </div>

      <div class="cc-card">
        <div class="cc-card-header">Timeline do Cliente</div>
        ${lifecycle.length ? `
          <div class="cc-lifecycle-list">
            ${lifecycle.map(ev => `
              <div class="cc-lifecycle-item">
                <div class="cc-lc-dot cc-lc-${ev.eventType.split('_')[0]}"></div>
                <div class="cc-lc-content">
                  <div class="cc-lc-type">${_lifecycleLabel(ev.eventType)}</div>
                  <div class="cc-date">${_fmtDateTime(ev.occurredAt)}</div>
                </div>
              </div>
            `).join('')}
          </div>` : '<div class="cc-empty">Nenhum evento registrado</div>'}
      </div>
    `;

    main.querySelector('#ccBackBtn')?.addEventListener('click', () => _renderContractors());
  } catch (err) {
    main.innerHTML = `<div class="cc-error-block">Erro: ${err.message}</div>`;
  }
}

// ─── Pagamentos ───────────────────────────────────────────────────────────────

async function _renderPayments() {
  const data = await ccFetch(`/payments?page=${_paymentPage}&limit=50&status=${_paymentStatus}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Pagamentos</h1>
      <span class="cc-badge-count">${data.total} registros</span>
    </div>

    ${data.note ? `<div class="cc-info-banner">${data.note === 'billing_module_unavailable' ? 'Módulo de faturamento ainda não configurado.' : data.note}</div>` : ''}

    <div class="cc-filters">
      <select class="cc-select" id="ccPayStatus">
        <option value="">Todos os status</option>
        ${['paid','pending','overdue','failed','cancelled'].map(s => `
          <option value="${s}" ${_paymentStatus===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>
        `).join('')}
      </select>
      <button class="cc-btn-primary" id="ccPayFilterBtn">Filtrar</button>
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead>
          <tr><th>Empresa</th><th>Ref.</th><th>Valor</th><th>Status</th><th>Vencimento</th><th>Pgto</th></tr>
        </thead>
        <tbody>
          ${data.data.length ? data.data.map(inv => `
            <tr>
              <td>
                <div class="cc-company-name">${_escHtml(inv.company?.tradeName || '—')}</div>
                <div class="cc-company-email">${_escHtml(inv.company?.email || '')}</div>
              </td>
              <td class="cc-mono">${_escHtml(inv.referenceMonth || inv.id?.slice(0,8) || '—')}</td>
              <td class="cc-num cc-bold">${_fmtBRL(inv.amount)}</td>
              <td>${_payStatusBadge(inv.status)}</td>
              <td class="cc-date">${inv.dueDate ? _fmtDate(inv.dueDate) : '—'}</td>
              <td class="cc-date">${inv.paidAt  ? _fmtDate(inv.paidAt)  : '—'}</td>
            </tr>
          `).join('') : '<tr><td colspan="6" class="cc-empty">Nenhum pagamento encontrado</td></tr>'}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-pay-page')}
  `;

  main.querySelector('#ccPayFilterBtn')?.addEventListener('click', () => {
    _paymentStatus = main.querySelector('#ccPayStatus')?.value || '';
    _paymentPage   = 1;
    _renderPayments().catch(console.error);
  });
  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _paymentPage = Number(btn.dataset.page); _renderPayments().catch(console.error); });
  });
}

// ─── Funil de Cadastro ────────────────────────────────────────────────────────

async function _renderFunnel() {
  const data = await ccFetch('/funnel');
  const main = document.getElementById('ccMain');
  if (!main) return;

  const s = data.steps || {};
  const total = data.total || 0;

  const steps = [
    { key: 'email_sent',      label: 'E-mail enviado',       val: s.email_sent      || total, color: '#6366f1' },
    { key: 'email_confirmed', label: 'E-mail confirmado',    val: s.email_confirmed || 0,     color: '#3b82f6' },
    { key: 'plan_selected',   label: 'Plano selecionado',    val: s.plan_selected   || 0,     color: '#10b981' },
    { key: 'payment_done',    label: 'Pagamento realizado',  val: s.payment_done    || 0,     color: '#f59e0b' },
    { key: 'converted',       label: 'Conta ativada',        val: s.converted       || 0,     color: '#22c55e' },
  ];

  const maxVal = steps[0].val || 1;

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Funil de Cadastro</h1>
      <span class="cc-badge-count">${total} iniciativas</span>
    </div>

    ${data.note ? `<div class="cc-info-banner">${data.note}</div>` : ''}

    <!-- KPIs do Funil -->
    <div class="cc-kpi-grid cc-kpi-grid-4">
      ${_kpiCard('Cadastros Iniciados', total, '', 'cc-kpi-neutral')}
      ${_kpiCard('E-mails Confirmados', s.email_confirmed || 0, '', 'cc-kpi-blue')}
      ${_kpiCard('Pagamentos', s.payment_done || 0, '', 'cc-kpi-yellow')}
      ${_kpiCard('Taxa de Conversão', `${data.conversionRate || 0}%`, '', 'cc-kpi-green')}
    </div>

    <!-- Funil Visual -->
    <div class="cc-card">
      <div class="cc-card-header">Etapas do Funil</div>
      <div class="cc-funnel">
        ${steps.map((step, i) => {
          const pct = maxVal > 0 ? Math.round((step.val / maxVal) * 100) : 0;
          const dropPct = i > 0 ? data.abandonRates?.[Object.keys(data.abandonRates)[i-1]] || 0 : null;
          return `
            <div class="cc-funnel-step">
              <div class="cc-funnel-label">${step.label}</div>
              <div class="cc-funnel-bar-wrap">
                <div class="cc-funnel-bar" style="width:${Math.max(pct, 5)}%;background:${step.color}">
                  <span class="cc-funnel-count">${step.val.toLocaleString('pt-BR')}</span>
                </div>
              </div>
              ${dropPct ? `<div class="cc-funnel-drop">-${dropPct}% abandono</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Taxas de Abandono -->
    <div class="cc-card">
      <div class="cc-card-header">Taxas de Abandono por Etapa</div>
      <div class="cc-detail-rows">
        <div class="cc-dr"><span>Confirmação de e-mail</span><strong>${data.abandonRates?.emailVerification || 0}% abandonaram</strong></div>
        <div class="cc-dr"><span>Seleção de plano</span><strong>${data.abandonRates?.planSelection || 0}% abandonaram</strong></div>
        <div class="cc-dr"><span>Pagamento</span><strong>${data.abandonRates?.payment || 0}% abandonaram</strong></div>
      </div>
    </div>
  `;
}

// ─── Suporte CC (visão da plataforma) ─────────────────────────────────────────

async function _renderCCSupport() {
  const q = `page=${_ticketPage}&limit=50&status=${_ticketStatus}&priority=${_ticketPriority}`;
  const data = await ccFetch(`/support-tickets?${q}`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  const priorityLabel = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
  const statusLabel   = { open: 'Aberto', in_analysis: 'Em análise', waiting_client: 'Aguardando cliente', in_development: 'Em dev', resolved: 'Resolvido', closed: 'Fechado' };

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Suporte — Visão da Plataforma</h1>
      <span class="cc-badge-count">${data.total} tickets</span>
    </div>

    <div class="cc-filters">
      <select class="cc-select" id="ccTicketStatus">
        <option value="">Todos os status</option>
        ${Object.entries(statusLabel).map(([v, l]) => `<option value="${v}" ${_ticketStatus===v?'selected':''}>${l}</option>`).join('')}
      </select>
      <select class="cc-select" id="ccTicketPriority">
        <option value="">Todas prioridades</option>
        ${Object.entries(priorityLabel).map(([v, l]) => `<option value="${v}" ${_ticketPriority===v?'selected':''}>${l}</option>`).join('')}
      </select>
      <button class="cc-btn-primary" id="ccTicketFilterBtn">Filtrar</button>
    </div>

    <div class="cc-table-wrap">
      <table class="cc-table">
        <thead>
          <tr><th>Empresa</th><th>Assunto</th><th>Prioridade</th><th>Status</th><th>Msgs</th><th>Abertura</th><th>Ações</th></tr>
        </thead>
        <tbody>
          ${data.data.length ? data.data.map(t => `
            <tr>
              <td>
                <div class="cc-company-name">${_escHtml(t.company?.tradeName || '—')}</div>
                <div class="cc-company-email">${_escHtml(t.user?.name || '')}</div>
              </td>
              <td>${_escHtml(t.subject)}</td>
              <td><span class="cc-priority-${t.priority}">${priorityLabel[t.priority] || t.priority}</span></td>
              <td><span class="cc-ticket-status-${t.status}">${statusLabel[t.status] || t.status}</span></td>
              <td class="cc-num">${t._count?.messages ?? 0}</td>
              <td class="cc-date">${_fmtDate(t.createdAt)}</td>
              <td><button class="cc-btn-sm" data-ticket-id="${t.id}" data-action="ticket-detail">Responder</button></td>
            </tr>
          `).join('') : '<tr><td colspan="7" class="cc-empty">Nenhum ticket encontrado</td></tr>'}
        </tbody>
      </table>
    </div>

    ${_pagination(data.page, data.pages, 'cc-ticket-page')}
  `;

  main.querySelector('#ccTicketFilterBtn')?.addEventListener('click', () => {
    _ticketStatus   = main.querySelector('#ccTicketStatus')?.value   || '';
    _ticketPriority = main.querySelector('#ccTicketPriority')?.value || '';
    _ticketPage     = 1;
    _renderCCSupport().catch(console.error);
  });
  main.querySelectorAll('[data-action="ticket-detail"]').forEach(btn => {
    btn.addEventListener('click', () => _showCCTicketDetail(btn.dataset.ticketId));
  });
  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _ticketPage = Number(btn.dataset.page); _renderCCSupport().catch(console.error); });
  });
}

async function _showCCTicketDetail(ticketId) {
  const main = document.getElementById('ccMain');
  if (!main) return;
  main.innerHTML = `<div class="cc-loading"><div class="cc-spinner"></div>Carregando ticket...</div>`;

  try {
    const ticket = await ccFetch(`/support-tickets/${ticketId}`);
    const statusLabel = { open: 'Aberto', in_analysis: 'Em análise', waiting_client: 'Ag. cliente', in_development: 'Em dev', resolved: 'Resolvido', closed: 'Fechado' };

    main.innerHTML = `
      <div class="cc-page-header">
        <button class="cc-btn-back" id="ccBackBtn">← Suporte</button>
        <h1 class="cc-page-title cc-ticket-title">${_escHtml(ticket.subject)}</h1>
        <span class="cc-ticket-status-${ticket.status}">${statusLabel[ticket.status] || ticket.status}</span>
      </div>

      <div class="cc-row-2col">
        <div class="cc-card">
          <div class="cc-card-header">Informações do Ticket</div>
          <div class="cc-detail-rows">
            <div class="cc-dr"><span>Empresa</span><strong>${_escHtml(ticket.company?.tradeName || '—')}</strong></div>
            <div class="cc-dr"><span>Solicitante</span><strong>${_escHtml(ticket.user?.name || '—')}</strong></div>
            <div class="cc-dr"><span>Categoria</span><strong>${ticket.category}</strong></div>
            <div class="cc-dr"><span>Prioridade</span><strong>${ticket.priority}</strong></div>
            <div class="cc-dr"><span>Abertura</span><strong>${_fmtDateTime(ticket.createdAt)}</strong></div>
            ${ticket.firstResponseAt ? `<div class="cc-dr"><span>1ª resposta</span><strong>${_fmtDateTime(ticket.firstResponseAt)}</strong></div>` : ''}
          </div>
        </div>

        <div class="cc-card">
          <div class="cc-card-header">Alterar Status</div>
          <div class="cc-ticket-actions">
            ${['in_analysis','waiting_client','in_development','resolved','closed'].map(s => `
              <button class="cc-btn-status ${ticket.status === s ? 'active' : ''}" data-set-status="${s}">${statusLabel[s]}</button>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Conversa -->
      <div class="cc-card">
        <div class="cc-card-header">Conversa</div>
        <div class="cc-thread" id="ccThread">
          ${ticket.messages?.map(m => `
            <div class="cc-msg cc-msg-${m.authorType}">
              <div class="cc-msg-header">
                <strong>${_escHtml(m.authorName)}</strong>
                <span class="cc-msg-role">${m.authorType === 'platform' ? '(Plataforma)' : '(Cliente)'}</span>
                <span class="cc-date">${_fmtDateTime(m.createdAt)}</span>
              </div>
              <div class="cc-msg-body">${_escHtml(m.body)}</div>
            </div>
          `).join('') || '<div class="cc-empty">Nenhuma mensagem ainda.</div>'}
        </div>

        <!-- Reply Box -->
        <div class="cc-reply-box">
          <textarea class="cc-textarea" id="ccReplyText" placeholder="Escreva a resposta para o cliente..." rows="4"></textarea>
          <div class="cc-reply-footer">
            <label class="cc-checkbox-label">
              <input type="checkbox" id="ccReplyInternal"> Nota interna (apenas equipe CC)
            </label>
            <button class="cc-btn-primary" id="ccSendReply">Enviar Resposta</button>
          </div>
        </div>
      </div>
    `;

    main.querySelector('#ccBackBtn')?.addEventListener('click', () => _renderCCSupport());

    main.querySelectorAll('[data-set-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.setStatus;
        try {
          await ccFetch(`/support-tickets/${ticketId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus }),
          });
          _showCCTicketDetail(ticketId);
        } catch (err) {
          alert(`Erro ao atualizar: ${err.message}`);
        }
      });
    });

    main.querySelector('#ccSendReply')?.addEventListener('click', async () => {
      const body       = main.querySelector('#ccReplyText')?.value?.trim();
      const isInternal = main.querySelector('#ccReplyInternal')?.checked;
      if (!body) return;

      try {
        await ccFetch(`/support-tickets/${ticketId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body, isInternal }),
        });
        _showCCTicketDetail(ticketId);
      } catch (err) {
        alert(`Erro ao enviar: ${err.message}`);
      }
    });

  } catch (err) {
    main.innerHTML = `<div class="cc-error-block">Erro: ${err.message}</div>`;
    main.innerHTML += `<button class="cc-btn-back">← Voltar</button>`;
    main.querySelector('.cc-btn-back')?.addEventListener('click', () => _renderCCSupport());
  }
}

// ─── Notificações da Plataforma ───────────────────────────────────────────────

async function _renderNotifications() {
  const data = await ccFetch(`/notifications?page=${_notifPage}&limit=50`);
  const main = document.getElementById('ccMain');
  if (!main) return;

  const typeLabel = {
    new_ticket:       '🎫 Novo ticket',
    payment_failed:   '💳 Falha de pagamento',
    client_inactive:  '😴 Cliente inativo',
    client_at_risk:   '⚠️ Cliente em risco',
    new_client:       '🎉 Novo cliente',
  };

  main.innerHTML = `
    <div class="cc-page-header">
      <h1 class="cc-page-title">Notificações</h1>
      <span class="cc-badge-count">${data.total} total</span>
    </div>

    <div class="cc-notif-list">
      ${data.data.length ? data.data.map(n => `
        <div class="cc-notif-item ${n.isRead ? 'cc-notif-read' : 'cc-notif-unread'}" data-notif-id="${n.id}">
          <div class="cc-notif-type">${typeLabel[n.type] || n.type}</div>
          <div class="cc-notif-title">${_escHtml(n.title)}</div>
          <div class="cc-notif-body">${_escHtml(n.body)}</div>
          <div class="cc-notif-footer">
            <span class="cc-date">${_fmtDateTime(n.createdAt)}</span>
            ${!n.isRead ? `<button class="cc-btn-sm" data-mark-read="${n.id}">Marcar lida</button>` : ''}
          </div>
        </div>
      `).join('') : '<div class="cc-empty cc-empty-large">Nenhuma notificação</div>'}
    </div>

    ${_pagination(data.page, data.pages, 'cc-notif-page')}
  `;

  main.querySelectorAll('[data-mark-read]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await ccFetch(`/notifications/${btn.dataset.markRead}/read`, { method: 'PATCH' });
        _renderNotifications();
      } catch (err) {
        alert(`Erro: ${err.message}`);
      }
    });
  });
  main.querySelectorAll('.cc-page-btn').forEach(btn => {
    btn.addEventListener('click', () => { _notifPage = Number(btn.dataset.page); _renderNotifications().catch(console.error); });
  });
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function _kpiCard(label, value, sub, cls) {
  return `
    <div class="cc-kpi-card ${cls}">
      <div class="cc-kpi-val">${typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</div>
      ${sub ? `<div class="cc-kpi-sub">${sub}</div>` : ''}
      <div class="cc-kpi-label">${label}</div>
    </div>`;
}

function _statusBar(label, count, total, color) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="cc-sbar-row">
      <span class="cc-sbar-label">${label}</span>
      <div class="cc-sbar-track"><div class="cc-sbar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="cc-sbar-count">${count}</span>
    </div>`;
}

function _pagination(page, pages, cls) {
  if (pages <= 1) return '';
  const start = Math.max(1, page - 2);
  const end   = Math.min(pages, page + 2);
  let html = `<div class="cc-pagination">`;
  if (page > 1)  html += `<button class="cc-page-btn" data-page="${page - 1}">← Anterior</button>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="cc-page-btn ${i === page ? 'cc-page-active' : ''}" data-page="${i}">${i}</button>`;
  }
  if (page < pages) html += `<button class="cc-page-btn" data-page="${page + 1}">Próxima →</button>`;
  html += `<span class="cc-page-info">Página ${page} de ${pages}</span></div>`;
  return html;
}

function _statusDot(status) {
  const map = { active: '🟢 Ativo', trial: '🟡 Trial', blocked: '🔴 Bloqueado', cancelled: '⚫ Cancelado' };
  return `<span class="cc-status-${status}">${map[status] || status}</span>`;
}

function _planBadge(code) {
  if (!code) return '—';
  const map = { basico: 'cc-plan-basic', economico: 'cc-plan-eco', basic: 'cc-plan-basic', economic: 'cc-plan-eco', pro: 'cc-plan-pro' };
  const cls = map[String(code).toLowerCase()] || 'cc-plan-basic';
  return `<span class="cc-plan-badge ${cls}">${code.charAt(0).toUpperCase() + code.slice(1)}</span>`;
}

function _subStatusBadge(status) {
  if (!status) return '—';
  const map = { active: 'cc-sub-ok', trial: 'cc-sub-trial', past_due: 'cc-sub-warn', cancelled: 'cc-sub-cancel', blocked: 'cc-sub-block', unpaid: 'cc-sub-warn' };
  return `<span class="cc-sub-badge ${map[status] || ''}">${_subStatusLabel(status)}</span>`;
}

function _subStatusLabel(s) {
  const m = { active: 'Ativa', trial: 'Trial', past_due: 'Vencida', cancelled: 'Cancelada', blocked: 'Bloqueada', unpaid: 'Não paga', suspended: 'Suspensa', paused: 'Pausada', pending: 'Pendente', expired: 'Expirada' };
  return m[s] || s;
}

function _svcColor(s) {
  return s === 'operational' ? 'cc-dot-green' : s === 'degraded' ? 'cc-dot-yellow' : 'cc-dot-gray';
}

function _svcStatusLabel(s) {
  return s === 'operational' ? 'Operacional' : s === 'degraded' ? 'Degradado' : 'Desconhecido';
}

function _svcText(svc) {
  if (svc.status === 'operational' && svc.latencyMs) return `${svc.latencyMs}ms`;
  if (svc.note) return svc.note.split(' — ')[0];
  return _svcStatusLabel(svc.status);
}

function _svcLabel(name) {
  const m = { api: 'API', database: 'Banco de Dados', cache: 'Cache (Redis)', cloudflare: 'Cloudflare', deviceHub: 'Device Hub' };
  return m[name] || name;
}

function _roleLabel(role) {
  const m = { developer_master: 'Developer Master', platform_admin: 'Platform Admin', support_analyst: 'Support Analyst', desenvolvedora: 'Desenvolvedora', administrador: 'Administrador', gerente: 'Gerente', operador: 'Operador' };
  return m[role] || role || '—';
}

function _roleTag(role) {
  const m = { developer_master: 'DEV MASTER', platform_admin: 'PLATFORM', desenvolvedora: 'DEV', administrador: 'ADMIN', gerente: 'GERENTE', operador: 'OPERADOR' };
  return m[role] || role;
}

function _fmtBRL(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
}

function _fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

function _fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _fmtCnpj(v) {
  const d = String(v).replace(/\D/g, '');
  if (d.length !== 14) return v;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function _escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _payStatusBadge(status) {
  if (!status) return '—';
  const map = { paid: 'cc-pay-paid', pending: 'cc-pay-pending', overdue: 'cc-pay-overdue', failed: 'cc-pay-failed', cancelled: 'cc-pay-cancel' };
  const labels = { paid: 'Pago', pending: 'Pendente', overdue: 'Vencido', failed: 'Falhou', cancelled: 'Cancelado' };
  return `<span class="cc-pay-badge ${map[status] || ''}">${labels[status] || status}</span>`;
}

function _lifecycleLabel(type) {
  const m = {
    account_created:  '🎉 Conta criada',
    email_confirmed:  '✉️ E-mail confirmado',
    plan_selected:    '📋 Plano selecionado',
    first_payment:    '💳 Primeiro pagamento',
    first_login:      '🔓 Primeiro login',
    first_product:    '📦 Primeiro produto',
    first_sale:       '🛒 Primeira venda',
    ticket_opened:    '🎫 Ticket aberto',
    plan_changed:     '🔄 Plano alterado',
    payment_failed:   '❌ Pagamento falhou',
    blocked:          '🚫 Conta bloqueada',
    cancelled:        '⚫ Conta cancelada',
    reactivated:      '✅ Reativado',
  };
  return m[type] || type;
}
