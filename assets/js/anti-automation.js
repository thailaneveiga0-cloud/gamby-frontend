/**
 * Gamby — Anti-Automation Browser Detection
 *
 * Score-based detection of automated browsers: Selenium, Puppeteer, Playwright,
 * PhantomJS, headless Chrome, and generic WebDriver environments.
 *
 * This complements the backend anti-automation layer (timing analysis, path entropy,
 * header inspection) with client-side signals that only in-browser code can read.
 *
 * THREAT MODEL
 *   Catches: unsophisticated bots, automated scrapers, CI-driven attacks,
 *            script kiddies using default Selenium/Puppeteer without stealth.
 *
 *   Does NOT catch: Puppeteer-extra + stealth plugin, modern headless Chrome
 *   with --disable-blink-features=AutomationControlled, or motivated operators
 *   who patch navigator properties before page load.
 *
 *   Value: provides a risk signal the backend can combine with other indicators
 *   (device fingerprint, impossible travel, request timing) to score sessions.
 *
 * SCORING
 *   Each check contributes a weight. Score >= THRESHOLD → report to backend.
 *   High-confidence indicators (webdriver flag, known globals) carry more weight.
 */

// ─── Detection checks ────────────────────────────────────────────────────────

const CHECKS = [
  // --- High confidence (40+) ---
  {
    label: 'webdriver_flag',
    score: 45,
    fn: () => navigator.webdriver === true,
  },
  {
    label: 'phantom_global',
    score: 40,
    fn: () => !!(window.callPhantom || window._phantom || window.__phantomas),
  },
  {
    label: 'nightmare_global',
    score: 40,
    fn: () => !!window.__nightmare,
  },
  {
    label: 'selenium_global',
    score: 40,
    fn: () => !!(window.selenium || window.domAutomation || window.domAutomationController),
  },
  {
    label: 'cdc_property',
    score: 40,
    fn: () => {
      // Chromedriver injects __cdc_* properties onto document/window
      try {
        return Object.keys(document).some(k => k.startsWith('__cdc_'))
            || Object.keys(window).some(k => k.startsWith('__cdc_'));
      } catch { return false; }
    },
  },
  {
    label: 'headless_useragent',
    score: 35,
    fn: () => /HeadlessChrome|PhantomJS|SlimerJS|Electron\//i.test(navigator.userAgent),
  },

  // --- Medium confidence (15-25) ---
  {
    label: 'no_plugins',
    score: 20,
    fn: () => navigator.plugins.length === 0,
  },
  {
    label: 'no_languages',
    score: 20,
    fn: () => !navigator.languages || navigator.languages.length === 0,
  },
  {
    label: 'zero_screen_dimensions',
    score: 25,
    fn: () => window.screen.width === 0 || window.screen.height === 0,
  },
  {
    label: 'missing_notification_api',
    score: 15,
    fn: () => typeof window.Notification === 'undefined',
  },

  // --- Low confidence (10-15) ---
  {
    label: 'node_process_global',
    score: 15,
    fn: () => {
      try { return typeof process !== 'undefined' && typeof process.versions?.node === 'string'; }
      catch { return false; }
    },
  },
  {
    label: 'missing_permissions_api',
    score: 10,
    fn: () => typeof navigator.permissions === 'undefined',
  },
  {
    label: 'zero_history_length',
    score: 10,
    fn: () => window.history.length === 0,
  },
  {
    label: 'precise_timing',
    score: 15,
    fn: () => {
      // Headless environments with throttled clocks often report 0ms for tight loops
      try {
        const t1 = performance.now();
        for (let i = 0; i < 2000; i++) { Math.sqrt(i * i + i); }
        return (performance.now() - t1) < 0.01;
      } catch { return false; }
    },
  },
];

const THRESHOLD = 50; // cumulative score that triggers a backend report

// ─── Telemetry ───────────────────────────────────────────────────────────────

function _getSession() {
  const keys = ['gamby_auth_session_modular', 'gamby_session', 'session'];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return p;
    } catch {}
  }
  return null;
}

function _report(score, triggered) {
  const apiUrl = window.GAMBY_CONFIG?.apiUrl
    ? String(window.GAMBY_CONFIG.apiUrl).replace(/\/+$/, '')
    : null;
  if (!apiUrl) return;

  const token = _getSession()?.token ? String(_getSession().token) : null;

  fetch(`${apiUrl}/v1/security/frontend-telemetry`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      type:     'automation_detected',
      severity: score >= 80 ? 'high' : 'medium',
      metadata: { source: 'anti-automation', score, checks: triggered },
    }),
    keepalive: true,
  }).catch(() => {});
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _ran = false;

/**
 * Run all detection checks once. Sends backend telemetry if score >= THRESHOLD.
 * Safe to call multiple times — only runs once per page load.
 */
export function runAutomationChecks() {
  if (_ran) return;
  _ran = true;

  let score = 0;
  const triggered = [];

  for (const { label, score: weight, fn } of CHECKS) {
    try {
      if (fn()) {
        score += weight;
        triggered.push(label);
      }
    } catch {}
  }

  if (score >= THRESHOLD) {
    _report(score, triggered);
  }
}

/**
 * Initialize anti-automation detection.
 * Runs immediately and once more after DOMContentLoaded — some headless
 * environments only surface their fingerprint post-layout.
 */
export function initAntiAutomation() {
  runAutomationChecks();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAutomationChecks, { once: true });
  } else {
    setTimeout(runAutomationChecks, 800);
  }
}
