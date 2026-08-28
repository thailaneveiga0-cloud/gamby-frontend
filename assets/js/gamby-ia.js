/**
 * gamby-ia.js — GAMBY IA (Página dedicada)
 * Assistente inteligente para usuários empresariais.
 * Endpoint: POST /v1/ai/client/chat (company-scoped, requireAuth + requireTenant)
 *
 * HTTP centralizado em gamby-ai-client.js (sem cliente duplicado aqui).
 */

import { sendGambyAiMessage, gambyAiErrorMessage } from './gamby-ai-client.js';

// ─── Sugestões rápidas ────────────────────────────────────────────────────────

const QUICK = [
  'Quantas vendas foram feitas hoje?',
  'Qual o faturamento de hoje?',
  'Qual o ticket médio hoje?',
  'Quais produtos estão com estoque baixo?',
  'Quantos produtos estão cadastrados?',
  'Como posso ajudar meu negócio a crescer?',
];

// ─── State ────────────────────────────────────────────────────────────────────

let _mounted          = false;
let _conversationId   = null;
let _sending          = false;
let _abortCtrl        = null;    // cancelamento externo da request em-flight
let _requestVersion   = 0;       // incrementado a cada envio; respostas obsoletas são descartadas

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initGambyIa() {
  const shell = document.getElementById('gambyIaShell');
  if (!shell) return;

  if (_mounted) {
    const msgs = document.getElementById('giaMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    return;
  }
  _mounted = true;
  _render(shell);
}

export function destroyGambyIa() {
  _abortCtrl?.abort();
  _abortCtrl      = null;
  _mounted        = false;
  _conversationId = null;
  _sending        = false;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function _render(shell) {
  shell.innerHTML = `
<div class="gia-root">

  <div class="gia-header">
    <div class="gia-header-left">
      <div class="gia-avatar" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div>
        <h2 class="gia-title">GAMBY IA</h2>
        <p class="gia-subtitle">Assistente inteligente do seu negócio</p>
      </div>
    </div>
    <div class="gia-header-actions">
      <button class="gia-btn-ghost" id="giaBtnNew" type="button" title="Nova conversa">Nova conversa</button>
    </div>
  </div>

  <div class="gia-messages" id="giaMessages" role="log" aria-live="polite" aria-label="Conversa com a GAMBY IA">
    <div class="gia-welcome" id="giaWelcome">
      <div class="gia-welcome-icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h3 class="gia-welcome-title">Olá! Sou a GAMBY IA.</h3>
      <p class="gia-welcome-desc">Faço análises com dados reais do seu negócio.<br>Pergunte sobre vendas, estoque, faturamento e mais.</p>
      <div class="gia-suggestions" id="giaSuggestions"></div>
    </div>
  </div>

  <div class="gia-input-area">
    <div class="gia-input-row">
      <textarea
        id="giaInput"
        class="gia-textarea"
        placeholder="Digite sua pergunta sobre o seu negócio..."
        rows="2"
        maxlength="1000"
        aria-label="Mensagem para a GAMBY IA"
      ></textarea>
      <button class="gia-send-btn" id="giaSendBtn" type="button" aria-label="Enviar mensagem">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
    <div class="gia-input-hint">Enter para enviar · Shift+Enter para nova linha</div>
  </div>

</div>`;

  _bindEvents();
  _renderSuggestions();
}

function _renderSuggestions() {
  const el = document.getElementById('giaSuggestions');
  if (!el) return;
  el.innerHTML = '';
  QUICK.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'gia-chip';
    btn.type = 'button';
    btn.textContent = q;
    btn.addEventListener('click', () => _quickSend(q));
    el.appendChild(btn);
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────

function _bindEvents() {
  document.getElementById('giaBtnNew')?.addEventListener('click', _newConversation);
  document.getElementById('giaSendBtn')?.addEventListener('click', _sendFromInput);
  document.getElementById('giaInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendFromInput(); }
  });
}

// ─── Send ─────────────────────────────────────────────────────────────────────

function _sendFromInput() {
  const input = document.getElementById('giaInput');
  const text  = input?.value?.trim() ?? '';
  if (!text || _sending) return;
  input.value = '';
  _send(text);
}

function _quickSend(text) {
  if (_sending) return;
  document.getElementById('giaWelcome')?.remove();
  _send(text);
}

async function _send(text) {
  if (_sending) return;
  _setSending(true);

  // Cancelar qualquer request anterior em-flight
  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const signal  = _abortCtrl.signal;
  const version = ++_requestVersion; // captura versão desta request

  document.getElementById('giaWelcome')?.remove();
  _appendUserMessage(text);
  const typingId = _appendTyping();

  try {
    const result = await sendGambyAiMessage({
      message:        text,
      conversationId: _conversationId,
      signal,
    });
    _removeTyping(typingId);
    if (version !== _requestVersion) return; // resposta obsoleta — nova conversa iniciada
    _conversationId = result.conversationId || _conversationId;
    _appendAssistantMessage(result.reply);
  } catch (err) {
    _removeTyping(typingId);
    if (version !== _requestVersion) return; // descarta erro de request obsoleta
    const msg = gambyAiErrorMessage(err);
    if (msg) _appendError(msg); // null = cancelamento intencional, sem UI de erro
  } finally {
    _abortCtrl = null;
    _setSending(false);
  }
}

function _newConversation() {
  // Cancela request em-flight e invalida versão — respostas em voo são descartadas
  _abortCtrl?.abort();
  _abortCtrl      = null;
  _requestVersion++;        // invalida qualquer request em-flight
  _conversationId = null;
  _sending        = false;

  const messages = document.getElementById('giaMessages');
  if (!messages) return;

  messages.innerHTML = `
    <div class="gia-welcome" id="giaWelcome">
      <div class="gia-welcome-icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h3 class="gia-welcome-title">Nova conversa iniciada.</h3>
      <p class="gia-welcome-desc">Faça uma nova pergunta sobre as operações do seu negócio.</p>
      <div class="gia-suggestions" id="giaSuggestions"></div>
    </div>`;
  _renderSuggestions();

  document.getElementById('giaInput')?.focus();
  _setSending(false);
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function _appendUserMessage(text) {
  const messages = document.getElementById('giaMessages');
  if (!messages) return;

  const div = document.createElement('div');
  div.className = 'gia-msg gia-msg-user';
  const bubble = document.createElement('div');
  bubble.className = 'gia-bubble gia-bubble-user';
  bubble.textContent = text; // XSS seguro: textContent
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function _appendAssistantMessage(text) {
  const messages = document.getElementById('giaMessages');
  if (!messages) return;

  const div = document.createElement('div');
  div.className = 'gia-msg gia-msg-assistant';

  const icon = document.createElement('div');
  icon.className = 'gia-msg-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  const bubble = document.createElement('div');
  bubble.className = 'gia-bubble gia-bubble-assistant';
  bubble.innerHTML = _safeMarkdown(text); // markdown seguro (escape-first)

  div.appendChild(icon);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function _appendError(text) {
  const messages = document.getElementById('giaMessages');
  if (!messages) return;

  const div = document.createElement('div');
  div.className = 'gia-msg gia-msg-error';
  const bubble = document.createElement('div');
  bubble.className = 'gia-bubble gia-bubble-error';
  bubble.textContent = '⚠ ' + text;
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function _appendTyping() {
  const messages = document.getElementById('giaMessages');
  if (!messages) return null;

  const id  = 'giaTyping_' + Date.now();
  const div = document.createElement('div');
  div.id        = id;
  div.className = 'gia-msg gia-msg-assistant gia-msg-typing';

  const icon = document.createElement('div');
  icon.className = 'gia-msg-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  const dots = document.createElement('div');
  dots.className = 'gia-typing-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';

  div.appendChild(icon);
  div.appendChild(dots);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}

function _removeTyping(id) {
  if (id) document.getElementById(id)?.remove();
}

function _setSending(val) {
  _sending = val;
  const btn   = document.getElementById('giaSendBtn');
  const input = document.getElementById('giaInput');
  if (btn)   btn.disabled   = val;
  if (input) input.disabled = val;
}

// ─── Markdown seguro ──────────────────────────────────────────────────────────
// Apenas tags seguras: strong, em, code, li, ul, br — sem innerHTML de input bruto

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _safeMarkdown(text) {
  const escaped = _esc(text);
  const lines = escaped.split('\n');
  const out = [];
  let inList = false;

  for (const raw of lines) {
    const line      = raw.trimEnd();
    const listMatch = line.match(/^[•\-]\s(.+)$/);
    const h1Match   = line.match(/^#{1,3}\s(.+)$/);

    if (listMatch) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + _inlineMarkdown(listMatch[1]) + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (h1Match)    out.push('<p><strong>' + _inlineMarkdown(h1Match[1]) + '</strong></p>');
      else if (!line) out.push('<br>');
      else            out.push('<p>' + _inlineMarkdown(line) + '</p>');
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function _inlineMarkdown(text) {
  return text
    .replace(/\*\*([^*<]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*<]+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`<]+?)`/g,       '<code>$1</code>');
}
