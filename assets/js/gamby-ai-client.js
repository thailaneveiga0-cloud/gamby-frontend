/**
 * gamby-ai-client.js — Cliente HTTP compartilhado para GAMBY IA
 * Utilizado por: gamby-ia.js (página dedicada) e ai-widget.js (widget flutuante)
 *
 * Centraliza: base URL, token, AbortController, timeout, headers, tratamento de erros.
 * HMAC não é aplicado a /v1/ai/client/chat — não está nos _SIGNED_PREFIXES do http.js.
 */

// ─── Resolução de URL da API ──────────────────────────────────────────────────
// Em produção: window.GAMBY_CONFIG.apiUrl vem de dist/assets/js/config.js gerado pelo build.
// Em dev local (localhost/127.0.0.1): fallback aceitável.
// Em produção sem config: erro controlado — nunca silencia para localhost.

function _isLocalDevelopment() {
  try {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function _getApiUrl() {
  const configured = String(window.GAMBY_CONFIG?.apiUrl || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  if (_isLocalDevelopment()) return 'http://localhost:4001';

  // Ambiente publicado sem configuração: erro explícito
  throw Object.assign(
    new Error('A conexão com o servidor não está configurada. Entre em contato com o suporte GAMBY.'),
    { code: 'API_URL_MISSING' }
  );
}

// ─── Token: mesmo lookup que api.js (getSavedSession) ─────────────────────────
const _SESSION_KEY      = 'gamby_auth_session_modular';
const _SESSION_FALLBACKS = ['gamby_auth_session', 'session', 'gamby_session'];

function _getToken() {
  for (const key of [_SESSION_KEY, ..._SESSION_FALLBACKS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.token) return parsed.token;
    } catch {}
  }
  return (
    localStorage.getItem('gamby_token') ||
    localStorage.getItem('token') ||
    sessionStorage.getItem('gamby_token') ||
    ''
  );
}

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

/**
 * Envia mensagem para a GAMBY IA empresarial.
 *
 * @param {object} opts
 * @param {string}       opts.message           — Texto da mensagem (já validado no frontend)
 * @param {string|null}  [opts.conversationId]  — ID da conversa para continuação
 * @param {number}       [opts.timeoutMs=30000] — Timeout em ms
 * @param {AbortSignal}  [opts.signal]          — Sinal externo de cancelamento (ex: destroyGambyIa)
 *
 * @returns {Promise<{reply: string, conversationId: string, model: string, latencyMs: number}>}
 * @throws Error com: .status (401|403|422|429|503), .code ('API_URL_MISSING'), .isTimeout = true
 */
export async function sendGambyAiMessage({ message, conversationId = null, timeoutMs = 30_000, signal: externalSignal = null }) {
  // Resolver URL (pode lançar API_URL_MISSING em produção sem config)
  const apiUrl = _getApiUrl();

  const ctrl    = new AbortController();
  const timerId = setTimeout(() => ctrl.abort(), timeoutMs);

  // Propagar cancelamento externo (ex: nova conversa, destroy, logout)
  const onExternalAbort = () => ctrl.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(`${apiUrl}/v1/ai/client/chat`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${_getToken()}`,
      },
      body:   JSON.stringify({ message, conversationId: conversationId || undefined }),
      signal: ctrl.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw Object.assign(
        new Error(body.error || body.message || `HTTP ${res.status}`),
        { status: res.status, code: body.error || null, data: body }
      );
    }
    return body;

  } catch (err) {
    if (err.name === 'AbortError') {
      // Distingue timeout de cancelamento externo
      if (externalSignal?.aborted) {
        throw Object.assign(new Error('cancelled'), { isCancelled: true });
      }
      throw Object.assign(new Error('timeout'), { isTimeout: true });
    }
    throw err;
  } finally {
    clearTimeout(timerId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

// ─── Mapeamento de erros → mensagens amigáveis ────────────────────────────────

/**
 * Converte um erro de sendGambyAiMessage em string amigável para o usuário.
 * Preserva distinção entre erros de empresa, auth, rate limit e infra.
 */
export function gambyAiErrorMessage(err) {
  if (err.isCancelled)            return null; // cancelamento intencional — não exibir erro
  if (err.isTimeout)              return 'A resposta demorou muito. Verifique sua conexão e tente novamente.';
  if (err.code === 'API_URL_MISSING') return 'A conexão com o servidor não está configurada. Entre em contato com o suporte GAMBY.';

  // Erros por código do backend (body.error)
  if (err.code === 'company_inactive')               return 'Sua empresa não está ativa. Entre em contato com o suporte GAMBY.';
  if (err.code === 'company_required')               return 'Empresa não identificada na sessão. Faça login novamente.';
  if (err.code === 'company_validation_unavailable') return 'Não foi possível validar sua empresa neste momento. Tente novamente em instantes.';
  if (err.code === 'ai_rate_limit')                  return 'Você atingiu o limite temporário de mensagens. Aguarde alguns minutos e tente novamente.';
  if (err.code === 'message_required')               return 'Digite uma pergunta antes de enviar.';
  if (err.code === 'message_too_long')               return 'Sua mensagem ultrapassa o limite de 1000 caracteres.';

  // Por status HTTP (fallback quando body.error não está disponível)
  if (err.status === 429)         return 'Você atingiu o limite temporário de mensagens. Aguarde alguns minutos e tente novamente.';
  if (err.status === 422)         return 'Mensagem inválida. Verifique o conteúdo e tente novamente.';
  if (err.status === 401)         return 'Sua sessão expirou. Faça login novamente.';
  if (err.status === 403)         return 'Seu perfil não possui permissão para utilizar este recurso.';
  if (err.status === 503 || err.status === 502) return 'A GAMBY IA está temporariamente indisponível. Tente novamente em instantes.';
  if (err.name === 'TypeError')   return 'Não foi possível conectar ao servidor. Verifique sua conexão.';

  return 'Não foi possível obter uma resposta. Tente novamente.';
}
