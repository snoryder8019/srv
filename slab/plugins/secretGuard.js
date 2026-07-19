/**
 * Slab — Secret Guard
 * ─────────────────────────────────────────────────────────────────────────────
 * Redacts API-key-shaped secrets from EVERYTHING written to the console, so a
 * key can never end up in a log — even if some code logs a string containing it,
 * or logs an object/Error that inspects to reveal it. Patch once at boot
 * (bin/www.js). This is defence-in-depth: the right primary control is never
 * printing keys, but a stray debug line shouldn't be able to burn a tenant's key
 * the way a leak did before.
 *
 * Covered shapes: Anthropic (sk-ant-…), generic OpenAI-style (sk-…),
 * Anthropic webhook signing (whsec_…), Anthropic OAuth (sk-ant-oat…).
 */
import util from 'node:util';

const KEY_RE = /(sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9_-]{6,})/g;

/** Redact secrets in a formatted log string, keeping a short prefix for triage. */
export function redactSecrets(s) {
  return String(s).replace(KEY_RE, (m) => m.slice(0, 10) + '…[REDACTED]');
}

/** Patch console.* so every log line is formatted then scrubbed. Idempotent. */
export function installSecretGuard() {
  if (globalThis.__slabSecretGuard) return;
  globalThis.__slabSecretGuard = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      try { orig(redactSecrets(util.format(...args))); }
      catch { orig(...args); } // never let the guard swallow a log
    };
  }
}

// Self-install on import so a plain `import './secretGuard.js'` (placed first in
// the entry point) activates the guard before anything else can log.
installSecretGuard();
