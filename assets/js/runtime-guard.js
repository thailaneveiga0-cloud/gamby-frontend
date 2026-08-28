/**
 * Gamby — Runtime Tamper Detection
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHAT THIS DOES (and why it matters)
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1. CONFIG LOCK
 *    Freezes window.GAMBY_CONFIG and makes it non-replaceable via
 *    Object.defineProperty. Prevents an attacker in the browser console
 *    from redirecting all API calls to an attacker-controlled server:
 *      window.GAMBY_CONFIG.apiUrl = 'http://evil.com'   ← BLOCKED
 *      window.GAMBY_CONFIG = { apiUrl: 'http://evil.com' } ← BLOCKED
 *    The API URL is also captured at init so our own telemetry is
 *    immune to a replaced GAMBY_CONFIG.
 *
 * 2. CRITICAL FUNCTION LOCK
 *    Wraps critical window-accessible functions with Object.defineProperty
 *    so they cannot be replaced from the console:
 *      window.openSecureCashCloseModal = (cb) => cb() ← BLOCKED
 *      window.openPageDirect = () => {}               ← BLOCKED
 *    Computes a djb2 hash of each function's source at init.
 *    If the hash changes (monkey-patching succeeded via other means),
 *    a telemetry event is sent.
 *
 * 3. PROTOTYPE POLLUTION DETECTION
 *    Snapshots Object.prototype property names at init.
 *    Prototype pollution (Object.prototype.isAdmin = true) is a common
 *    attack that bypasses authorization checks relying on property
 *    existence. Any new property on Object.prototype triggers a
 *    high-severity telemetry event.
 *
 * 4. SESSION / JWT CONSISTENCY CHECK
 *    The stored session in localStorage contains user.role and companyId.
 *    The JWT token (also in localStorage) encodes the same values —
 *    but is SIGNED by the backend, so it cannot be forged.
 *    If someone manually edits localStorage to change user.role to
 *    'desenvolvedora' without forging a new JWT, the values diverge.
 *    We detect this mismatch periodically.
 *
 * 5. NATIVE CONSTRUCTOR INTEGRITY
 *    Checks that Object.prototype.constructor and Function.prototype.constructor
 *    are still the native implementations. Some attacks replace these to
 *    intercept all object creation and property access.
 *
 * ═══════════════════════════════════════════════════════════════════
 * LIMITATIONS (honest assessment)
 * ═══════════════════════════════════════════════════════════════════
 *
 * - Browser extensions with the `page` or `tabs` permission have full
 *   access to the JS runtime and can bypass all of this before it runs.
 *
 * - Object.defineProperty freezes against console-level tampering; it
 *   does NOT stop native browser devtools patches via "Override content"
 *   or service workers that intercept the bundle download.
 *
 * - A determined attacker with the bundle source (after deobfuscation)
 *   can study and disable this guard before any check fires.
 *
 * VALUE: catches automated tampering scripts, opportunistic/accidental
 * modifications, copy-paste hacks, and provides detection signals for
 * the backend security pipeline. Defense in depth.
 *
 * ═══════════════════════════════════════════════════════════════════
 * INTEGRATION: call initRuntimeGuard() AFTER window.openSecureCashCloseModal
 * and window.openPageDirect are assigned in app.js.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── State ────────────────────────────────────────────────────────────────────

let _initialized    = false;
let _capturedApiUrl = null;                  // captured BEFORE config is frozen
let _lastTamperAt   = 0;
const _TAMPER_COOLDOWN_MS = 30_000;          // max 1 telemetry per 30s per guard check

// Names of properties expected on Object.prototype at startup
const _protoBaseline = new Set(Object.getOwnPropertyNames(Object.prototype));

// Map<fnName, djb2hash> — populated at init, compared periodically
const _fnHashes = new Map();

// Window-accessible functions we consider critical to protect
const _CRITICAL_FNS = ['openSecureCashCloseModal', 'openPageDirect'];

// ─── djb2 hash (fast, non-cryptographic — good enough for tamper detection) ───
function _hash(str) {
  let h = 5381;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h >>> 0; // unsigned
}

// ─── Minimal session reader (own impl — does NOT depend on storage.js) ────────
function _getSession() {
  const keys = ['gamby_auth_session_modular', 'gamby_session', 'session'];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return p;
    } catch { /* continue */ }
  }
  return null;
}

function _getToken() {
  const s = _getSession();
  return s?.token ? String(s.token) : null;
}

// ─── Minimal JWT payload decoder (read-only, no signature verification) ───────
// We use this only to CHECK the signed claims against localStorage values.
// The backend already validates the signature on every API call.
function _decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // pad to multiple of 4
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(b64));
  } catch { return null; }
}

// ─── Telemetry sender ────────────────────────────────────────────────────────
// Uses _capturedApiUrl (frozen copy of GAMBY_CONFIG.apiUrl captured before lock).
// This means: even if window.GAMBY_CONFIG was replaced by an attacker,
// our telemetry still reaches the REAL backend.
function _send(type, meta = {}) {
  const now = Date.now();
  if (now - _lastTamperAt < _TAMPER_COOLDOWN_MS) return;
  if (!_capturedApiUrl) return;

  _lastTamperAt = now;
  const token = _getToken();

  fetch(`${_capturedApiUrl}/v1/security/frontend-telemetry`, {
    method:    'POST',
    headers:   {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body:      JSON.stringify({
      type,
      severity: 'high',
      metadata: { source: 'runtime-guard', ...meta },
    }),
    keepalive: true,
  }).catch(() => { /* telemetry is best-effort */ });
}

// ─── Guard 1: Lock window.GAMBY_CONFIG ───────────────────────────────────────
function _lockConfig() {
  if (typeof window === 'undefined') return;

  const cfg = window.GAMBY_CONFIG;
  if (!cfg || typeof cfg !== 'object') return;

  // Capture the real URL before locking (used by _send for all runtime-guard events)
  _capturedApiUrl = String(cfg.apiUrl || '').replace(/\/+$/, '');

  // Deep-freeze the config object so property writes fail silently in strict mode
  try { Object.freeze(cfg); } catch { /* ignore */ }

  // Make window.GAMBY_CONFIG itself non-replaceable
  try {
    const _frozen = cfg;
    Object.defineProperty(window, 'GAMBY_CONFIG', {
      get:          ()  => _frozen,
      set:          (_) => { _send('config_replacement_attempt', {}); },
      configurable: false,
      enumerable:   true,
    });
  } catch {
    // Some environments (old browser, locked browser extension) reject this — acceptable.
  }
}

// ─── Guard 2: Lock and snapshot critical window functions ─────────────────────
function _lockCriticalFunctions() {
  for (const name of _CRITICAL_FNS) {
    const fn = window[name];
    if (typeof fn !== 'function') {
      // DIAG
      console.log(`%c[RUNTIME-GUARD] "${name}" ainda não definida em window — SKIP (não será travada agora)`, 'color:#7f8c8d');
      continue;
    }

    // DIAG
    console.log(`%c[RUNTIME-GUARD] Travando window.${name} = "${fn.name || '(fn sem nome)'}"`, 'color:#e67e22;font-weight:bold');

    // Store hash of current source (minified code in production)
    try { _fnHashes.set(name, _hash(fn.toString())); } catch { /* ignore */ }

    // Prevent replacement via window.X = ...
    try {
      const _orig = fn;
      Object.defineProperty(window, name, {
        get:          ()  => _orig,
        set:          (v) => {
          // DIAG
          const _desc = typeof v === 'function' ? (v.name || '(fn sem nome)') : String(v).slice(0, 60);
          console.error(`%c[RUNTIME-GUARD] ⛔ Tentativa de substituir window.${name} BLOQUEADA → novo valor: "${_desc}"`, 'color:#c0392b;font-weight:bold;font-size:12px');
          console.error(`%c[RUNTIME-GUARD]    Se este log aparecer para openPageDirect, confirma o BUG: runtime-guard travou o wrapper errado na pass 1`, 'color:#c0392b');
          _send('critical_fn_replaced', { fn: name });
        },
        configurable: false,
        enumerable:   true,
      });
    } catch { /* non-fatal — function still protected by hash check */ }
  }
}

// ─── Check: Prototype pollution ───────────────────────────────────────────────
// Prototype pollution (Object.prototype.isAdmin = true) is a common bypass for
// authorization checks that use `if (user.isAdmin)` — adding the property to
// the prototype makes every object appear to have it.
function _checkPrototypePollution() {
  try {
    const current = Object.getOwnPropertyNames(Object.prototype);
    for (const key of current) {
      if (!_protoBaseline.has(key)) {
        _protoBaseline.add(key); // prevent repeated alerts for same key
        _send('prototype_pollution_detected', { key });
      }
    }
  } catch { /* ignore */ }
}

// ─── Check: Session / JWT consistency ────────────────────────────────────────
// If someone edits localStorage to change user.role to 'desenvolvedora'
// without forging a new signed JWT (which requires the server-side JWT_SECRET),
// the JWT payload's role claim will differ from the stored user object's role.
function _checkSessionIntegrity() {
  try {
    const s = _getSession();
    if (!s?.token) return; // not logged in

    const jwt = _decodeJwtPayload(s.token);
    if (!jwt) return;

    const storedRole    = String(s?.user?.role    || s?.role    || '').toLowerCase().trim();
    const jwtRole       = String(jwt?.role        || '').toLowerCase().trim();
    const storedCompany = String(s?.user?.companyId || s?.companyId || '');
    const jwtCompany    = String(jwt?.companyId   || '');

    if (storedRole && jwtRole && storedRole !== jwtRole) {
      _send('session_role_mismatch', { stored: storedRole, expected: jwtRole });
    }

    if (storedCompany && jwtCompany && storedCompany !== jwtCompany) {
      _send('session_company_mismatch', {});
    }
  } catch { /* ignore */ }
}

// ─── Check: Critical function integrity ──────────────────────────────────────
// If defineProperty succeeded, the function cannot be replaced.
// If it failed (rare), this hash check is the fallback.
function _checkFunctionIntegrity() {
  for (const name of _CRITICAL_FNS) {
    const fn = window[name];

    if (typeof fn !== 'function') {
      if (_fnHashes.has(name)) {
        _send('critical_fn_removed', { fn: name });
      }
      continue;
    }

    try {
      const current = _hash(fn.toString());
      const stored  = _fnHashes.get(name);
      if (stored !== undefined && current !== stored) {
        _send('critical_fn_hash_changed', { fn: name });
        _fnHashes.set(name, current); // update to avoid repeated alerts
      }
    } catch { /* ignore */ }
  }
}

// ─── Check: Native constructor integrity ─────────────────────────────────────
// Some attacks replace Object.prototype.constructor to intercept all object
// creation and insert malicious properties.
function _checkNativeConstructors() {
  try {
    // These are === comparisons to the known native values
    if (({}).constructor !== Object) {
      _send('object_constructor_tampered', {});
    }
    if ((function() {}).constructor !== Function) {
      _send('function_constructor_tampered', {});
    }
  } catch { /* ignore */ }
}

// ─── Check: Service Worker integrity ─────────────────────────────────────────
// An attacker who can register a service worker on the same origin can intercept
// ALL network requests, inject responses, and completely bypass TLS protections.
// We verify that no unexpected service workers are registered.
//
// Limitation: we can only CHECK, not PREVENT registration of a SW by other
// same-origin code. If this fires, it means a script on the page has registered
// an unauthorized SW — which is a serious compromise indicator.
async function _checkServiceWorkerIntegrity() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const swUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
      // Flag any SW whose URL doesn't belong to our own origin
      if (swUrl && !swUrl.startsWith(location.origin + '/')) {
        _send('unauthorized_service_worker', { swUrl: swUrl.slice(0, 120) });
        return;
      }
      // Flag SWs from our own origin too — we don't register any, so any SW is unexpected
      if (swUrl) {
        _send('unexpected_service_worker', { swUrl: swUrl.slice(0, 120) });
        return;
      }
    }
  } catch { /* navigator.serviceWorker may be restricted in some contexts */ }
}

// ─── Periodic monitoring loop ─────────────────────────────────────────────────
function _runChecks() {
  _checkPrototypePollution();
  _checkSessionIntegrity();
  _checkFunctionIntegrity();
  _checkNativeConstructors();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call this once, AFTER window.openSecureCashCloseModal and window.openPageDirect
 * have been assigned in app.js. Order matters: we snapshot the legitimate functions
 * first, then lock them.
 */
export function initRuntimeGuard() {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;

  // Immediate: lock config and snapshot+lock critical functions
  _lockConfig();
  _lockCriticalFunctions();

  // Short delay: let the app fully initialize before first session check
  setTimeout(_checkSessionIntegrity, 2000);

  // Check for unauthorized service workers once at startup (async — non-blocking)
  _checkServiceWorkerIntegrity().catch(() => {});

  // Periodic: run all checks every 10 seconds
  const _interval = setInterval(_runChecks, 10_000);
  if (_interval.unref) _interval.unref(); // don't block Node.js process in tests
}
