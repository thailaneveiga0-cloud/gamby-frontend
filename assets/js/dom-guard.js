/**
 * Gamby — DOM Mutation Guard + Unauthorized Resource Detection
 *
 * Uses MutationObserver to detect <script>, <iframe>, <object>, and <embed>
 * elements injected into the DOM after initial page load. This provides
 * detection (not prevention) of DOM-based XSS injection attempts.
 *
 * THREAT MODEL
 *   Detects:
 *     - <script src="..."> injection from non-allowlisted origins
 *     - <iframe> injection (ANY iframe is suspicious — GAMBY uses none)
 *     - <object> and <embed> element injection
 *     - Subtree injection (entire DOM fragment containing nested scripts)
 *
 *   Does NOT prevent:
 *     - Inline script execution (already running by the time Observer fires)
 *     - Browser extension DOM manipulation (extensions preempt page scripts)
 *     - XSS that doesn't use DOM injection (eval, setTimeout('string'))
 *
 *   Value: catches automated XSS exploitation tools that inject <script> tags,
 *   iframe-based keyloggers, and provides a backend signal for the incident
 *   response pipeline to escalate the session to LOCKDOWN.
 *
 * LIMITATIONS:
 *   MutationObserver fires AFTER the mutation. An inline XSS <script> has
 *   already executed when this fires. The guard is useful for:
 *   a) Detecting src-based script injection (file download, then execution)
 *   b) Generating backend telemetry for incident response
 *   c) Blocking future mutations by revoking the observer if threshold exceeded
 */

let _initialized    = false;
let _lastReportAt   = 0;
let _reportCount    = 0;
const COOLDOWN_MS   = 15_000; // max 1 report per 15s
const MAX_REPORTS   = 5;      // stop reporting after N alerts (rate-limit defense)

// Origins we allow to serve scripts. Must match your CSP script-src.
const ALLOWED_SCRIPT_ORIGINS = [
  location.origin,
  'https://cdn.jsdelivr.net',
];

function _isAllowedScriptSrc(src) {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return false;
  try {
    const u = new URL(src, location.origin);
    return ALLOWED_SCRIPT_ORIGINS.some(o => u.origin === new URL(o).origin);
  } catch {
    return false;
  }
}

function _apiUrl() {
  try { return String(window.GAMBY_CONFIG?.apiUrl || '').replace(/\/+$/, '') || null; }
  catch { return null; }
}

function _token() {
  const keys = ['gamby_auth_session_modular', 'gamby_session', 'session'];
  for (const k of keys) {
    try { const p = JSON.parse(localStorage.getItem(k) || ''); if (p?.token) return String(p.token); } catch {}
  }
  return null;
}

function _report(type, detail) {
  if (_reportCount >= MAX_REPORTS) return;
  const now = Date.now();
  if (now - _lastReportAt < COOLDOWN_MS) return;

  _lastReportAt = now;
  _reportCount++;

  const apiUrl = _apiUrl();
  const token  = _token();
  if (!apiUrl) return;

  fetch(`${apiUrl}/v1/security/frontend-telemetry`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:      JSON.stringify({ type, severity: 'high', metadata: { source: 'dom-guard', ...detail } }),
    keepalive: true,
  }).catch(() => {});
}

function _inspectNode(node) {
  if (!(node instanceof Element)) return;
  const tag = node.tagName.toLowerCase();

  if (tag === 'script') {
    const src = node.getAttribute('src') || '';
    if (src && !_isAllowedScriptSrc(src)) {
      _report('unauthorized_script_injection', { src: src.slice(0, 200) });
    }
    return;
  }

  if (tag === 'iframe') {
    const src = node.getAttribute('src') || node.getAttribute('srcdoc') || '';
    _report('unauthorized_iframe_injection', { src: src.slice(0, 200) });
    return;
  }

  if (tag === 'object' || tag === 'embed') {
    const data = node.getAttribute('data') || node.getAttribute('src') || '';
    _report('suspicious_embed_injection', { tag, src: data.slice(0, 200) });
    return;
  }
}

function _walkMutation(mutation) {
  for (const node of mutation.addedNodes) {
    _inspectNode(node);
    // Subtree check: <div innerHTML="<script src=...>"> adds a div whose child is the script
    if (node instanceof Element) {
      node.querySelectorAll('script[src], iframe, object, embed').forEach(_inspectNode);
    }
  }
}

export function initDomGuard() {
  if (_initialized || typeof MutationObserver === 'undefined') return;
  _initialized = true;

  // Check any scripts/iframes already in the DOM (defensive — shouldn't be any)
  document.querySelectorAll('script[src]').forEach((el) => {
    if (el.getAttribute('src') && !_isAllowedScriptSrc(el.getAttribute('src'))) {
      _report('existing_unauthorized_script', { src: el.getAttribute('src').slice(0, 200) });
    }
  });

  const observer = new MutationObserver((mutations) => {
    if (_reportCount >= MAX_REPORTS) {
      observer.disconnect(); // stop observing after threshold
      return;
    }
    mutations.forEach(_walkMutation);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}
