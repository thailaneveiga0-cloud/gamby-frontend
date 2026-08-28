/**
 * ai-widget.js — GAMBY Copilot (widget flutuante)
 * Widget de IA para usuários clientes — disponível em qualquer página.
 * Endpoint: POST /v1/ai/client/chat (company-scoped).
 *
 * HTTP centralizado em gamby-ai-client.js (sem cliente duplicado aqui).
 */

import { sendGambyAiMessage, gambyAiErrorMessage } from './gamby-ai-client.js';

// ─── State ─────────────────────────────────────────────────────────────────

let _conversationId = null;
let _isOpen         = false;
let _initialized    = false;
let _sending        = false;
let _abortCtrl      = null;
let _requestVersion = 0;

// ─── Entry point ───────────────────────────────────────────────────────────

export function initAiWidget() {
  // Nunca montar enquanto o PDV estiver ativo — independente de quem chama.
  if (document.querySelector('[data-page-content="pdv"].active:not(.hidden)')) return;
  if (_initialized) return;
  _initialized = true;
  _mount();
}

export function destroyAiWidget() {
  _abortCtrl?.abort();
  _abortCtrl      = null;
  _requestVersion++;
  document.getElementById('gambyAiWidget')?.remove();
  _initialized    = false;
  _conversationId = null;
  _isOpen         = false;
  _sending        = false;
}

// ─── Mount ─────────────────────────────────────────────────────────────────

function _mount() {
  const existing = document.getElementById('gambyAiWidget');
  if (existing) return;

  const wrap = document.createElement('div');
  wrap.id = 'gambyAiWidget';
  wrap.innerHTML = `
    <!-- Floating button -->
    <button class="ai-fab" id="aiFab" aria-label="Abrir GAMBY Copilot" title="GAMBY Copilot">
      <svg class="ai-fab-ico ai-fab-open" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <svg class="ai-fab-ico ai-fab-close hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <span class="ai-fab-label">Copilot</span>
    </button>

    <!-- Chat drawer -->
    <div class="ai-drawer hidden" id="aiDrawer" role="dialog" aria-label="GAMBY Copilot">
      <div class="ai-drawer-header">
        <div class="ai-drawer-brand">
          <div class="ai-drawer-dot"></div>
          <div>
            <div class="ai-drawer-title">GAMBY Copilot</div>
            <div class="ai-drawer-sub">IA do seu negócio</div>
          </div>
        </div>
        <button class="ai-drawer-close" id="aiDrawerClose" aria-label="Fechar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="ai-messages" id="aiMessages">
        <div class="ai-welcome">
          <div class="ai-welcome-icon">🤖</div>
          <p>Olá! Sou o <strong>GAMBY Copilot</strong>.<br>Posso te ajudar com vendas, estoque, produtos e mais.</p>
          <div class="ai-suggestions">
            <button class="ai-suggest" data-msg="Quantas vendas foram feitas hoje?">Vendas de hoje</button>
            <button class="ai-suggest" data-msg="Quais produtos estão com estoque baixo?">Estoque baixo</button>
            <button class="ai-suggest" data-msg="Quantos produtos estão cadastrados?">Total de produtos</button>
          </div>
        </div>
      </div>

      <div class="ai-input-wrap">
        <input class="ai-input" id="aiInput" type="text" placeholder="Pergunte algo sobre seu negócio..." maxlength="1000" autocomplete="off">
        <button class="ai-send-btn" id="aiSendBtn" aria-label="Enviar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);
  _bindEvents(wrap);
}

// ─── Events ────────────────────────────────────────────────────────────────

function _bindEvents(wrap) {
  const fab    = wrap.querySelector('#aiFab');
  const drawer = wrap.querySelector('#aiDrawer');
  const close  = wrap.querySelector('#aiDrawerClose');
  const input  = wrap.querySelector('#aiInput');
  const send   = wrap.querySelector('#aiSendBtn');

  fab?.addEventListener('click', () => {
    _isOpen = !_isOpen;
    drawer?.classList.toggle('hidden', !_isOpen);
    wrap.querySelector('.ai-fab-open')?.classList.toggle('hidden', _isOpen);
    wrap.querySelector('.ai-fab-close')?.classList.toggle('hidden', !_isOpen);
    if (_isOpen) input?.focus();
  });

  close?.addEventListener('click', () => {
    _isOpen = false;
    drawer?.classList.add('hidden');
    wrap.querySelector('.ai-fab-open')?.classList.remove('hidden');
    wrap.querySelector('.ai-fab-close')?.classList.add('hidden');
  });

  send?.addEventListener('click', () => _send(wrap));
  input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) _send(wrap); });

  wrap.querySelectorAll('.ai-suggest').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = btn.dataset.msg;
      if (!msg || _sending) return;
      _appendMessage(wrap, 'user', msg);
      btn.closest('.ai-suggestions')?.remove();
      _callApi(wrap, msg);
    });
  });
}

// ─── Send ──────────────────────────────────────────────────────────────────

function _send(wrap) {
  const input = wrap.querySelector('#aiInput');
  const text  = input?.value.trim();
  if (!text || _sending) return;
  input.value = '';

  _appendMessage(wrap, 'user', text);
  wrap.querySelector('.ai-welcome')?.remove();

  _callApi(wrap, text);
}

async function _callApi(wrap, message) {
  if (_sending) return;
  _setSending(wrap, true);

  _abortCtrl?.abort();
  _abortCtrl = new AbortController();
  const signal  = _abortCtrl.signal;
  const version = ++_requestVersion;

  const typingId = _appendTyping(wrap);

  try {
    const result = await sendGambyAiMessage({
      message,
      conversationId: _conversationId,
      signal,
    });
    _removeTyping(wrap, typingId);
    if (version !== _requestVersion) return;
    _conversationId = result.conversationId || _conversationId;
    _appendMessage(wrap, 'assistant', result.reply);
  } catch (err) {
    _removeTyping(wrap, typingId);
    if (version !== _requestVersion) return;
    const msg = gambyAiErrorMessage(err);
    if (msg) _appendMessage(wrap, 'error', msg);
  } finally {
    _abortCtrl = null;
    _setSending(wrap, false);
  }
}

// ─── DOM helpers ───────────────────────────────────────────────────────────

function _appendMessage(wrap, role, text) {
  const messages = wrap.querySelector('#aiMessages');
  if (!messages) return;

  const div = document.createElement('div');
  div.className = `ai-msg ai-msg-${role}`;

  if (role === 'assistant') {
    div.innerHTML = `<div class="ai-msg-ico">🤖</div><div class="ai-msg-text ai-msg-formatted">${_formatMarkdown(text)}</div>`;
  } else if (role === 'user') {
    div.innerHTML = `<div class="ai-msg-text">${_escHtml(text)}</div>`;
  } else {
    div.innerHTML = `<div class="ai-msg-text ai-msg-error">⚠ ${_escHtml(text)}</div>`;
  }

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function _appendTyping(wrap) {
  const messages = wrap.querySelector('#aiMessages');
  if (!messages) return null;

  const id  = `aiTyping_${Date.now()}`;
  const div = document.createElement('div');
  div.id        = id;
  div.className = 'ai-msg ai-msg-assistant ai-msg-typing';
  div.innerHTML = `<div class="ai-msg-ico">🤖</div><div class="ai-typing-dots"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}

function _removeTyping(wrap, id) {
  if (!id) return;
  wrap.querySelector(`#${id}`)?.remove();
}

function _setSending(wrap, val) {
  _sending = val;
  const btn   = wrap.querySelector('#aiSendBtn');
  const input = wrap.querySelector('#aiInput');
  if (btn)   btn.disabled   = val;
  if (input) input.disabled = val;
}

function _escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _formatMarkdown(text) {
  return _escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
