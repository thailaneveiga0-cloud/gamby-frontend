/**
 * Gamby — Trusted Types Policy
 *
 * Creates a named Trusted Types policy ('gamby-policy') that sanitizes HTML
 * before it can be assigned to dangerous sinks (innerHTML, outerHTML, etc.).
 *
 * WHAT TRUSTED TYPES DOES
 *   Without TT: `element.innerHTML = userString` — any string accepted
 *   With TT + enforcement: `element.innerHTML = userString` → TypeError
 *              `element.innerHTML = GAMBY_TT.createHTML(userString)` → sanitized, allowed
 *
 * CURRENT ENFORCEMENT STATUS: DETECTION ONLY
 *   Adding `require-trusted-types-for 'script'` to CSP would enforce TT but
 *   would immediately break all existing innerHTML assignments in the app.
 *   This file creates the policy as preparation for future enforcement.
 *
 *   MIGRATION PATH:
 *     1. (Done here) Create policy — establishes rules without breaking anything
 *     2. Wrap the riskiest innerHTML usages (user-controlled content) with GAMBY_TT.createHTML()
 *     3. Audit and wrap all remaining innerHTML/outerHTML/insertAdjacentHTML calls
 *     4. Add `trusted-types gamby-policy` to CSP (defines allowed policies)
 *     5. Add `require-trusted-types-for 'script'` to CSP (enforces — last step)
 *
 * SANITIZATION RULES
 *   createHTML: removes <script>, event handler attributes, javascript: URLs,
 *               data: URLs in src attributes. Does NOT use DOMPurify (no dep).
 *               For richer sanitization, replace body with DOMPurify.sanitize().
 *
 *   createScriptURL: only allows URLs from our origin and the pinned CDN.
 *
 *   createScript: blocked entirely (no dynamic script creation needed).
 *
 * USAGE IN APP CODE
 *   import { GAMBY_TT } from './trusted-types-policy.js';
 *
 *   // Instead of:  element.innerHTML = userContent;
 *   // Use:         element.innerHTML = GAMBY_TT ? GAMBY_TT.createHTML(userContent) : _fallbackSanitize(userContent);
 */

// ─── Sanitization helpers (no external dependency) ───────────────────────────

/**
 * Removes the most dangerous XSS vectors from an HTML string.
 * NOT a full-featured sanitizer — use DOMPurify for production if available.
 */
function _sanitizeHtml(html) {
  if (typeof html !== 'string') return '';

  return html
    // Remove <script> blocks entirely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove inline event handlers
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // Remove javascript: and vbscript: URLs
    .replace(/(?:javascript|vbscript)\s*:/gi, 'blocked:')
    // Remove data: URLs in src/href (except allowed image data)
    .replace(/(?:src|href)\s*=\s*["']?data:(?!image\/(?:png|jpe?g|gif|webp|svg\+xml))[^"'\s>]*/gi, 'src="blocked"')
    // Remove <iframe> tags
    .replace(/<\/?iframe\b[^>]*>/gi, '')
    // Remove <object> and <embed>
    .replace(/<\/?(?:object|embed)\b[^>]*>/gi, '');
}

const _ALLOWED_SCRIPT_URLS = [
  location.origin + '/',
  'https://cdn.jsdelivr.net/npm/chart.js',
];

function _isAllowedScriptUrl(url) {
  try {
    const u = new URL(url, location.origin);
    return _ALLOWED_SCRIPT_URLS.some(allowed => url.startsWith(allowed))
        || u.origin === location.origin;
  } catch {
    return false;
  }
}

// ─── Policy creation ──────────────────────────────────────────────────────────

let _policy = null;

if (typeof window.trustedTypes !== 'undefined' && typeof window.trustedTypes.createPolicy === 'function') {
  try {
    _policy = window.trustedTypes.createPolicy('gamby-policy', {
      createHTML(html) {
        return _sanitizeHtml(html);
      },

      createScriptURL(url) {
        if (_isAllowedScriptUrl(url)) return url;
        throw new TypeError(`[TT] Blocked script URL: ${String(url).slice(0, 100)}`);
      },

      createScript(_script) {
        // We never create scripts dynamically — always throw
        throw new TypeError('[TT] Dynamic script creation is not permitted in GAMBY.');
      },
    });
  } catch (err) {
    // Policy may already exist (e.g., HMR or duplicate module import) — ignore
    if (!String(err?.message).includes('already been created')) {
      console.warn('[TT] Could not create gamby-policy:', err?.message);
    }
  }
}

/**
 * The active Trusted Types policy, or null if TT is not supported.
 * Use this to wrap any HTML you assign to innerHTML.
 *
 * @type {TrustedTypePolicy | null}
 */
export const GAMBY_TT = _policy;

/**
 * Safe HTML setter that uses the TT policy when available and falls back
 * to the built-in sanitizer otherwise.
 *
 * @param {Element} element
 * @param {string}  html
 */
export function safeSetInnerHTML(element, html) {
  if (!element) return;
  if (_policy) {
    element.innerHTML = _policy.createHTML(html);
  } else {
    element.innerHTML = _sanitizeHtml(html);
  }
}
