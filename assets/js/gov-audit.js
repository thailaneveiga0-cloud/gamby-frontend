/**
 * gov-audit.js — GAMBY PDV Governance Layer: Audit Service
 *
 * Every governed action (navigation, security challenge, session change)
 * produces a structured audit event.
 *
 * Storage: circular localStorage buffer (2000 entries).
 * Sync:    best-effort POST to /v1/audit/batch, non-blocking.
 */

import { state } from './state.js';

const _MAX_ENTRIES = 2000;
const _STORAGE_KEY = 'gamby_gov_audit';
const _BATCH_KEY   = 'gamby_gov_audit_pending';
const _BATCH_SIZE  = 20;
const _BATCH_DELAY = 5000; // ms debounce before sending

let _sessionId  = null;
let _batchTimer = null;

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * Generate a new session ID (call on login / user switch).
 */
export function resetSession() {
  _sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _sid() {
  if (!_sessionId) resetSession();
  return _sessionId;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Log a governed event.
 *
 * @param {{
 *   category:  'navigation'|'security'|'session'|'permission'|'system',
 *   action:    string,
 *   outcome?:  'success'|'denied'|'cancelled'|'error',
 *   actor?:    { operatorId?: string },
 *   context?:  Record<string, unknown>
 * }} event
 * @returns {string} Audit entry ID
 */
export function log(event) {
  const entry = {
    id:        `gov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId: _sid(),
    timestamp: new Date().toISOString(),
    category:  event.category ?? 'system',
    action:    event.action   ?? 'unknown',
    outcome:   event.outcome  ?? 'success',
    actor: {
      userId:     state.currentUser?.id   ?? null,
      role:       state.currentUser?.role ?? null,
      operatorId: event.actor?.operatorId ?? null,
    },
    context: event.context ?? {},
  };

  try {
    const logs = JSON.parse(localStorage.getItem(_STORAGE_KEY) || '[]');
    logs.unshift(entry);
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(logs.slice(0, _MAX_ENTRIES)));
  } catch { /* storage quota exceeded — drop silently */ }

  // Backend sync disabled until /v1/audit/batch is implemented.
  // _scheduleBatchSync(entry);
  return entry.id;
}

/**
 * @param {number} [limit=100]
 * @returns {object[]}
 */
export function getLogs(limit = 100) {
  try {
    return JSON.parse(localStorage.getItem(_STORAGE_KEY) || '[]').slice(0, limit);
  } catch { return []; }
}

export function clearLogs() {
  localStorage.removeItem(_STORAGE_KEY);
  localStorage.removeItem(_BATCH_KEY);
}

// ─── Backend sync (best-effort) ───────────────────────────────────────────────

function _scheduleBatchSync(entry) {
  try {
    const pending = JSON.parse(localStorage.getItem(_BATCH_KEY) || '[]');
    pending.push(entry);
    localStorage.setItem(_BATCH_KEY, JSON.stringify(pending.slice(-_BATCH_SIZE * 2)));
  } catch { return; }

  if (_batchTimer) clearTimeout(_batchTimer);
  _batchTimer = setTimeout(_flushBatch, _BATCH_DELAY);
}

async function _flushBatch() {
  _batchTimer = null;
  try {
    const pending = JSON.parse(localStorage.getItem(_BATCH_KEY) || '[]');
    if (!pending.length) return;

    const apiUrl = window.GAMBY_CONFIG?.apiUrl || 'http://localhost:4001';
    const token  =
      localStorage.getItem('gamby_token') ||
      sessionStorage.getItem('gamby_token') || '';
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`${apiUrl}/v1/audit/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: pending.slice(0, _BATCH_SIZE) }),
    });

    if (res.ok) {
      const remaining = pending.slice(_BATCH_SIZE);
      localStorage.setItem(_BATCH_KEY, JSON.stringify(remaining));
    }
  } catch { /* backend unreachable — keep pending for next flush */ }
}
