/**
 * CEO AI — Fase 11.1 GAMBY
 * Interface conversacional para o CEO AI.
 * Responde perguntas estratégicas sobre a plataforma com dados reais.
 */

import { getAuthToken } from './http.js';

// ─── API helper ───────────────────────────────────────────────────────────────

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

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── State ────────────────────────────────────────────────────────────────────

let _mounted    = false;
let _sessionId  = null;
let _history    = [];  // [{role, content}]
let _isTyping   = false;

const QUICK_QUESTIONS = [
  'Como está a GAMBY hoje?',
  'Qual é o MRR atual?',
  'Quais empresas têm maior risco de churn?',
  'Quais são as oportunidades de upgrade?',
  'Como está o funil de conversão?',
  'Qual é a previsão de receita para o próximo mês?',
  'Quais módulos geram mais chamados de suporte?',
  'Como estamos crescendo em relação ao mês passado?',
];

// ─── Mount ────────────────────────────────────────────────────────────────────

export function initCeoAi() {
  if (_mounted) return;
  const shell = document.getElementById('ceoAiShell');
  if (!shell) return;
  _mounted = true;

  shell.innerHTML = `
    <div class="ceo-root">

      <div class="ceo-header">
        <div class="ceo-header-left">
          <div class="ceo-avatar">✦</div>
          <div>
            <h2 class="ceo-title">CEO AI</h2>
            <p class="ceo-subtitle">Inteligência Estratégica da Plataforma GAMBY</p>
          </div>
        </div>
        <div class="ceo-header-right">
          <button class="ceo-btn-ghost" id="ceoNewSessionBtn" title="Nova conversa">+ Nova conversa</button>
          <button class="ceo-btn-ghost" id="ceoListSessionsBtn" title="Histórico">Histórico</button>
        </div>
      </div>

      <div class="ceo-body">

        <div class="ceo-chat-area" id="ceoChatArea">
          <div class="ceo-welcome" id="ceoWelcome">
            <div class="ceo-welcome-icon">✦</div>
            <h3>Olá! Sou o CEO AI da GAMBY.</h3>
            <p>Faço análises estratégicas sobre a plataforma com dados reais.<br>
               Respondo sobre receita, churn, upgrades, suporte, crescimento e mais.</p>

            <div class="ceo-suggestions">
              <p class="ceo-suggestions-label">Perguntas frequentes:</p>
              <div class="ceo-suggestions-grid" id="ceoSuggestions"></div>
            </div>
          </div>
        </div>

        <div class="ceo-input-area">
          <div class="ceo-input-row">
            <textarea
              id="ceoInput"
              class="ceo-textarea"
              placeholder="Pergunte sobre a plataforma GAMBY..."
              rows="2"></textarea>
            <button class="ceo-send-btn" id="ceoSendBtn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
          <div class="ceo-input-meta">
            <span class="ceo-input-hint">Enter para enviar · Shift+Enter para nova linha</span>
            <span class="ceo-tool-badge" id="ceoToolBadge"></span>
          </div>
        </div>

      </div>

    </div>`;

  // Preencher sugestões e vincular eventos via addEventListener (sem onclick inline)
  const suggestionsEl = document.getElementById('ceoSuggestions');
  if (suggestionsEl) {
    suggestionsEl.innerHTML = QUICK_QUESTIONS.map(q =>
      `<button class="ceo-suggestion-chip" data-q="${_esc(q)}">${_esc(q)}</button>`
    ).join('');
    suggestionsEl.querySelectorAll('.ceo-suggestion-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.q;
        if (q) _sendMessage(q);
      });
    });
  }

  // Botão enviar
  document.getElementById('ceoSendBtn')?.addEventListener('click', _handleSendClick);

  // Textarea — Enter envia, Shift+Enter nova linha
  document.getElementById('ceoInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _handleSendClick();
    }
  });

  // Nova conversa
  document.getElementById('ceoNewSessionBtn')?.addEventListener('click', () => {
    _sessionId = null;
    _history   = [];
    const area    = document.getElementById('ceoChatArea');
    const welcome = document.getElementById('ceoWelcome');
    if (area) {
      Array.from(area.children).forEach(c => { if (c.id !== 'ceoWelcome') c.remove(); });
    }
    if (welcome) welcome.style.display = '';
    const badge = document.getElementById('ceoToolBadge');
    if (badge) badge.textContent = '';
  });

  // Histórico
  document.getElementById('ceoListSessionsBtn')?.addEventListener('click', async () => {
    try {
      const resp = await apiFetch('/v1/ceo/sessions');
      const sessions = resp.data ?? [];
      if (!sessions.length) { alert('Nenhuma conversa anterior.'); return; }
      const lines = sessions.slice(0, 10).map((s, i) =>
        `${i + 1}. ${s.title ?? 'Sem título'} — ${new Date(s.updatedAt).toLocaleDateString('pt-BR')} (${s._count?.messages ?? 0} msgs)`
      ).join('\n');
      alert(`Últimas conversas:\n\n${lines}`);
    } catch (err) {
      alert('Erro ao buscar histórico: ' + err.message);
    }
  });
}

function _handleSendClick() {
  const input = document.getElementById('ceoInput');
  const question = input?.value?.trim() ?? '';
  if (!question) return;
  if (input) input.value = '';
  _sendMessage(question);
}

// ─── Envio de mensagem ────────────────────────────────────────────────────────

async function _sendMessage(question) {
  if (!question?.trim() || _isTyping) return;

  _isTyping = true;
  const sendBtn = document.getElementById('ceoSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  const welcome = document.getElementById('ceoWelcome');
  if (welcome) welcome.style.display = 'none';

  _appendMessage('user', question);
  const typingId = _appendTypingIndicator();

  try {
    if (!_sessionId) {
      const sessResp = await apiFetch('/v1/ceo/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: question.slice(0, 60) }),
      });
      _sessionId = sessResp.data?.id ?? null;
    }

    const resp = await apiFetch('/v1/ceo/chat', {
      method: 'POST',
      body: JSON.stringify({
        question,
        sessionId: _sessionId,
        history: _history.slice(-6),
      }),
    });

    const data = resp.data;
    _removeTypingIndicator(typingId);

    _appendMessage('assistant', data.answer, {
      intents:   data.intents,
      tools:     data.toolsUsed,
      tokens:    data.tokensUsed,
      cost:      data.costBrl,
      latencyMs: data.latencyMs,
    });

    _history.push({ role: 'user', content: question });
    _history.push({ role: 'assistant', content: data.answer });

    _updateToolBadge(data.toolsUsed, data.intents);

  } catch (err) {
    _removeTypingIndicator(typingId);
    console.error('[CEO AI]', err);
    const raw = String(err?.message || '').toLowerCase();
    const isBilling = raw.includes('credit') || raw.includes('balance') || raw.includes('insufficient') || raw.includes('402') || raw.includes('billing');
    const userMsg = isBilling
      ? 'A IA está temporariamente indisponível porque a conta Anthropic está sem créditos. Adicione créditos em Plans & Billing para reativar o CEO AI.'
      : `Erro ao processar resposta: ${err.message}`;
    _appendMessage('error', userMsg);
  } finally {
    _isTyping = false;
    if (sendBtn) sendBtn.disabled = false;
    document.getElementById('ceoInput')?.focus();
  }
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function _appendMessage(role, content, meta = null) {
  const area = document.getElementById('ceoChatArea');
  if (!area) return;

  const id  = 'msg-' + Date.now();
  const div = document.createElement('div');
  div.id    = id;
  div.className = `ceo-message ceo-message-${role}`;

  if (role === 'user') {
    div.innerHTML = `
      <div class="ceo-msg-bubble ceo-msg-user">
        <span class="ceo-msg-content">${_esc(content)}</span>
      </div>`;
  } else if (role === 'assistant') {
    div.innerHTML = `
      <div class="ceo-msg-avatar">✦</div>
      <div class="ceo-msg-bubble ceo-msg-assistant">
        <div class="ceo-msg-content">${_markdownToHtml(content)}</div>
        ${meta ? `
          <div class="ceo-msg-meta">
            ${meta.intents?.length  ? `<span class="ceo-meta-chip">🎯 ${meta.intents.join(', ')}</span>` : ''}
            ${meta.tools?.length    ? `<span class="ceo-meta-chip">🔧 ${meta.tools.join(', ')}</span>` : ''}
            ${meta.tokens           ? `<span class="ceo-meta-chip">📊 ${meta.tokens} tokens</span>` : ''}
            ${meta.cost             ? `<span class="ceo-meta-chip">💰 R$ ${meta.cost.toFixed(4)}</span>` : ''}
            ${meta.latencyMs        ? `<span class="ceo-meta-chip">⏱ ${meta.latencyMs}ms</span>` : ''}
          </div>` : ''}
      </div>`;
  } else {
    div.innerHTML = `
      <div class="ceo-msg-bubble ceo-msg-error">
        ⚠ ${_esc(content)}
      </div>`;
  }

  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return id;
}

function _appendTypingIndicator() {
  const area = document.getElementById('ceoChatArea');
  if (!area) return null;
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id    = id;
  div.className = 'ceo-message ceo-message-assistant';
  div.innerHTML = `
    <div class="ceo-msg-avatar">✦</div>
    <div class="ceo-msg-bubble ceo-msg-assistant ceo-typing">
      <span class="ceo-dot"></span>
      <span class="ceo-dot"></span>
      <span class="ceo-dot"></span>
    </div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return id;
}

function _removeTypingIndicator(id) {
  if (!id) return;
  document.getElementById(id)?.remove();
}

function _updateToolBadge(tools, intents) {
  const badge = document.getElementById('ceoToolBadge');
  if (!badge) return;
  if (!tools?.length) { badge.textContent = ''; return; }
  badge.textContent = `Ferramentas: ${tools.join(' · ')}`;
}

function _markdownToHtml(md) {
  if (!md) return '';
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/^📊 \*\*(.+)\*\*$/gm, '<h4 class="ceo-md-section ceo-md-blue">📊 <strong>$1</strong></h4>')
    .replace(/^📋 \*\*(.+)\*\*$/gm, '<h4 class="ceo-md-section ceo-md-purple">📋 <strong>$1</strong></h4>')
    .replace(/^💥 \*\*(.+)\*\*$/gm, '<h4 class="ceo-md-section ceo-md-red">💥 <strong>$1</strong></h4>')
    .replace(/^💡 \*\*(.+)\*\*$/gm, '<h4 class="ceo-md-section ceo-md-green">💡 <strong>$1</strong></h4>')
    .replace(/^⚡ \*\*(.+)\*\*$/gm, '<h4 class="ceo-md-section ceo-md-orange">⚡ <strong>$1</strong></h4>')
    .replace(/^#{1,3} (.+)$/gm, '<h4 class="ceo-md-h4">$1</h4>')
    .replace(/^[•\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .split('\n\n').map(p => p.startsWith('<') ? p : `<p>${p}</p>`).join('\n')
    .replace(/<p><\/p>/g, '');
}
