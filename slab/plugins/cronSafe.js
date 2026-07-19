// ─────────────────────────────────────────────────────────────────────────────
// cronSafe.js — WSL2-tolerant scheduling.
//
// node-cron SKIPS ticks on this host's jittery VM clock (see the slab-wsl-cron
// note): the every-minute post scheduler was dropping ~4 ticks in a row, and a
// DAILY job pinned to a single tick (token refresh 4am, invoices 6am) can be
// dropped for the WHOLE DAY — expired tokens, missed billing.
//
// These helpers replace cron.schedule with a frequent setInterval catch-up:
//  • scheduleDailyJob — records last run in `cron_state` and fires the first time a
//    check runs at/after the target hour that day. A skipped tick just means the
//    next 10-min check runs it. Claims BEFORE running, so it never double-fires
//    (safe for billing).
//  • scheduleIntervalJob — runs on a plain interval (late is fine) with a
//    reentrancy guard + an early post-boot run. For self-healing pollers where
//    "roughly every N" is enough.
// ─────────────────────────────────────────────────────────────────────────────
import { getSlabDb } from './mongo.js';
import { recordCronRun } from './observe.js';

const CHECK_MS = 10 * 60 * 1000;   // how often daily jobs check whether they're due

async function alreadyRanSince(name, target) {
  try {
    const state = await getSlabDb().collection('cron_state').findOne({ _id: name });
    const last = state?.lastRun ? new Date(state.lastRun) : null;
    return !!(last && last >= target);
  } catch { return false; }        // DB hiccup → let it try (idempotent claim guards double-run)
}

async function claimRun(name) {
  try {
    await getSlabDb().collection('cron_state')
      .updateOne({ _id: name }, { $set: { lastRun: new Date() } }, { upsert: true });
    return true;
  } catch { return false; }
}

// Run `fn` once per day at/after `hour`:`minute`, resilient to skipped ticks.
export function scheduleDailyJob(name, hour, fn, { minute = 0, label } = {}) {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const target = new Date(now); target.setHours(hour, minute, 0, 0);
      if (now < target) return;                          // not time yet today
      if (await alreadyRanSince(name, target)) return;   // already ran since today's target
      if (!(await claimRun(name))) return;               // claim FIRST — never double-run
      console.log(`[cronSafe] ${name}: running (daily catch-up)`);
      const t0 = Date.now();
      try {
        await fn();
        recordCronRun({ name, label, kind: 'daily', ok: true, durationMs: Date.now() - t0 });
      } catch (err) {
        console.error(`[cronSafe] ${name} failed:`, err.message);
        recordCronRun({ name, label, kind: 'daily', ok: false, durationMs: Date.now() - t0, error: err.message });
      }
    } catch (err) { console.error(`[cronSafe] ${name} failed:`, err.message); }
    finally { running = false; }
  };
  setInterval(check, CHECK_MS);
  setTimeout(check, 30 * 1000);   // catch a run missed just before boot
  console.log(`[Cron] ${label || name} (daily ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} — WSL-skip-tolerant)`);
}

// Run `fn` every `intervalMs`, late-tolerant, reentrancy-guarded, with an early run.
export function scheduleIntervalJob(name, intervalMs, fn, { label, bootDelayMs = 15000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    try {
      await fn();
      recordCronRun({ name, label, kind: 'interval', ok: true, durationMs: Date.now() - t0 });
    } catch (err) {
      console.error(`[cronSafe] ${name} failed:`, err.message);
      recordCronRun({ name, label, kind: 'interval', ok: false, durationMs: Date.now() - t0, error: err.message });
    } finally { running = false; }
  };
  setInterval(tick, intervalMs);
  setTimeout(tick, bootDelayMs);
  console.log(`[Cron] ${label || name} (every ${Math.round(intervalMs / 1000)}s — WSL-jitter-tolerant)`);
}
