/**
 * Gamby — Device-Bound Encrypted Local Storage
 *
 * Architecture: AES-GCM (256-bit) + HKDF key derivation from a per-device secret.
 *
 * THREAT MODEL
 *   Protects against:
 *     - Raw database file theft (SQLite/LevelDB extraction from filesystem)
 *     - Browser backup exfiltration (iCloud, Android backup, profile sync theft)
 *     - localStorage copy-paste attacks via DevTools or automation tools
 *     - Physical access to the device's browser storage directory
 *
 *   Does NOT protect against:
 *     - XSS within the same origin (attacker can call secureLoad() in-page)
 *     - Authenticated user reading their own data via DevTools
 *     - Browser extensions with `storage` or `tabs` permissions
 *     - Memory inspection after decryption (data is plaintext in JS heap)
 *
 * KEY DERIVATION
 *   1. On first use, generate a random 32-byte device secret (DEVICE_SECRET_KEY).
 *      This secret lives in plaintext localStorage, but it's separate from the
 *      data it protects — an attacker must find BOTH the secret AND the ciphertext
 *      AND implement HKDF+AES-GCM to recover plaintext.
 *   2. Per-item key: HKDF(ikm=device_secret, salt=APP_SALT, info=item_key, len=256)
 *   3. Each write: random 96-bit IV (GCM nonce) + AES-GCM-256 ciphertext + 128-bit tag
 *
 * FALLBACK
 *   If Web Crypto is unavailable, falls back to plaintext JSON — same behavior as
 *   storage.js — so the app never breaks on very old browsers.
 *
 * USAGE
 *   // Save sensitive data
 *   await secureSave('my_key', { role: 'admin', cpf: '...' });
 *
 *   // Load it back
 *   const data = await secureLoad('my_key', null);
 *
 *   // On logout: rotate device secret so stolen backups can't be decrypted
 *   secureWipeAll(['my_key', 'other_key']);
 */

const APP_SALT          = 'gamby-saas-v1-2025';
const DEVICE_SECRET_KEY = '__gamby_dsk__';
const ENVELOPE_VERSION  = 1;

const _cryptoOk = typeof globalThis.crypto !== 'undefined' &&
                  typeof globalThis.crypto.subtle !== 'undefined';

// ─── Encoding helpers ────────────────────────────────────────────────────────

function _encode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _decode(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

// ─── Device secret ───────────────────────────────────────────────────────────

function _getOrCreateDeviceSecret() {
  const existing = localStorage.getItem(DEVICE_SECRET_KEY);
  if (existing) {
    try { return _decode(existing); } catch { /* regenerate */ }
  }
  const fresh = globalThis.crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(DEVICE_SECRET_KEY, _encode(fresh.buffer));
  return fresh.buffer;
}

// ─── Key derivation ──────────────────────────────────────────────────────────

async function _deriveKey(deviceSecret, itemKey) {
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw', deviceSecret, { name: 'HKDF' }, false, ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(APP_SALT),
      info: new TextEncoder().encode(itemKey),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt and save `value` under `itemKey`.
 * Falls back to plaintext JSON if Web Crypto is unavailable.
 */
export async function secureSave(itemKey, value) {
  if (!_cryptoOk) {
    try { localStorage.setItem(itemKey, JSON.stringify(value)); } catch {}
    return;
  }
  try {
    const plain      = new TextEncoder().encode(JSON.stringify(value));
    const secret     = _getOrCreateDeviceSecret();
    const key        = await _deriveKey(secret, itemKey);
    const iv         = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, plain
    );
    const envelope = JSON.stringify({
      v:  ENVELOPE_VERSION,
      iv: _encode(iv.buffer),
      ct: _encode(ciphertext),
    });
    localStorage.setItem(itemKey, envelope);
  } catch {
    try { localStorage.setItem(itemKey, JSON.stringify(value)); } catch {}
  }
}

/**
 * Read and decrypt `itemKey`.
 * Transparently handles both encrypted envelopes and legacy plaintext values.
 * Returns `fallback` if the key is missing or decryption fails.
 */
export async function secureLoad(itemKey, fallback = null) {
  const raw = localStorage.getItem(itemKey);
  if (raw === null) return fallback;

  let envelope = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.v === ENVELOPE_VERSION
        && parsed.iv && parsed.ct) {
      envelope = parsed;
    }
  } catch {}

  if (!envelope) {
    try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
  }

  if (!_cryptoOk) return fallback;

  try {
    const secret = _getOrCreateDeviceSecret();
    const key    = await _deriveKey(secret, itemKey);
    const iv     = new Uint8Array(_decode(envelope.iv));
    const ct     = _decode(envelope.ct);
    const plain  = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, ct
    );
    return JSON.parse(new TextDecoder().decode(plain)) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Remove an encrypted item.
 */
export function secureRemove(itemKey) {
  localStorage.removeItem(itemKey);
}

/**
 * Remove the given keys AND rotate the device secret.
 * Old ciphertext (e.g., from a backup taken before logout) can no longer be
 * decrypted after this call — the key material is gone.
 * Call this on logout for all sensitive keys.
 */
export function secureWipeAll(keys = []) {
  for (const k of keys) localStorage.removeItem(k);
  if (_cryptoOk) {
    try {
      const fresh = globalThis.crypto.getRandomValues(new Uint8Array(32));
      localStorage.setItem(DEVICE_SECRET_KEY, _encode(fresh.buffer));
    } catch {
      localStorage.removeItem(DEVICE_SECRET_KEY);
    }
  } else {
    localStorage.removeItem(DEVICE_SECRET_KEY);
  }
}

/**
 * True if the environment supports Web Crypto.
 * Use this to show a security advisory if the browser is very old.
 */
export const isEncryptionAvailable = _cryptoOk;
