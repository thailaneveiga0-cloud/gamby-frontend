/**
 * Gamby — DevTools Detector
 *
 * Detection method: window size heuristic.
 * When DevTools is docked (the common case), the inner viewport shrinks while
 * the outer window stays the same. A delta > 200px on either axis is a strong
 * signal. Undocked/floating DevTools in a separate window is NOT detectable
 * via this method — that is an accepted limitation.
 *
 * Behavior:
 *   - Polls every 3 seconds (low overhead; no observable UI impact)
 *   - Fires at most once per MIN_INTERVAL_MS per session
 *   - Sends a lightweight authenticated fetch to /v1/security/frontend-telemetry
 *   - If the current page is sensitive, also dispatches 'gamby:devtools:sensitive'
 *     so app.js can trigger a re-auth challenge
 *
 * What this does NOT do:
 *   - Lock the UI (no aggressive defense)
 *   - Disable right-click / keyboard shortcuts (ineffective and annoying)
 *   - Run more than once per interval
 */

const SENSITIVE_PAGES = new Set([
  'financeiro',
  'historico',
  'usuarios',
  'configuracoes',
  'marketplace',
  'desenvolvedora',
]);

const MIN_INTERVAL_MS = 60_000;  // max 1 backend call per minute
const POLL_INTERVAL_MS = 3_000;  // check every 3 seconds
const WIDTH_THRESHOLD  = 200;    // px delta that triggers detection

let _initialized    = false;
let _devToolsOpen   = false;
let _lastReportedAt = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _getCurrentPage() {
  return String(
    localStorage.getItem('gamby_current_page') ||
    localStorage.getItem('gamby_last_page') ||
    ''
  ).toLowerCase().trim();
}

function _isSensitivePage() {
  return SENSITIVE_PAGES.has(_getCurrentPage());
}

function _getToken() {
  try {
    const keys = [
      'gamby_auth_session_modular',
      'gamby_session',
      'session',
    ];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.token) return parsed.token;
    }
    return null;
  } catch {
    return null;
  }
}

function _getApiUrl() {
  return String(
    (typeof window !== 'undefined' && window.GAMBY_CONFIG?.apiUrl) ||
    localStorage.getItem('gamby_backend_api_url') ||
    ''
  ).replace(/\/+$/, '');
}

// ─── Backend telemetry ────────────────────────────────────────────────────────

function _sendTelemetry(type, page) {
  const token = _getToken();
  if (!token) return; // not authenticated — skip

  const url  = `${_getApiUrl()}/v1/security/frontend-telemetry`;
  const body = JSON.stringify({
    type,
    page,
    severity: type === 'devtools_sensitive' ? 'medium' : 'low',
    metadata: {},
  });

  fetch(url, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body,
    keepalive: true,
  }).catch(() => { /* telemetry is best-effort */ });
}

// ─── Detection ────────────────────────────────────────────────────────────────

function _isDevToolsOpen() {
  // Guard: some browsers/extensions add chrome-extension bars that slightly
  // reduce innerHeight. Use a generous threshold (200px) to avoid false positives.
  const widthDelta  = window.outerWidth  - window.innerWidth;
  const heightDelta = window.outerHeight - window.innerHeight;
  return widthDelta > WIDTH_THRESHOLD || heightDelta > WIDTH_THRESHOLD;
}

function _onStateChange(nowOpen) {
  if (nowOpen === _devToolsOpen) return; // no state change
  _devToolsOpen = nowOpen;

  if (!nowOpen) return; // only act on open event, not close

  const now = Date.now();
  if (now - _lastReportedAt < MIN_INTERVAL_MS) return; // rate limit
  _lastReportedAt = now;

  const page      = _getCurrentPage();
  const sensitive = _isSensitivePage();
  const type      = sensitive ? 'devtools_sensitive' : 'devtools_opened';

  _sendTelemetry(type, page);

  if (sensitive) {
    document.dispatchEvent(
      new CustomEvent('gamby:devtools:sensitive', {
        bubbles: false,
        detail:  { page, detectedAt: now },
      })
    );
  }
}

function _poll() {
  try {
    _onStateChange(_isDevToolsOpen());
  } catch {
    // never throw from a polling function
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initDevToolsDetector() {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;

  // Poll on a timer
  setInterval(_poll, POLL_INTERVAL_MS);

  // Also check immediately on resize (catches dock/undock transitions faster)
  window.addEventListener('resize', _poll, { passive: true });
}
