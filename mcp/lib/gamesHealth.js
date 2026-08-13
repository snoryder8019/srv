/**
 * Games platform health — one-call status for the /srv/games service fleet.
 *
 * Built for phone use: a single call answers "what is broken right now" instead
 * of a round trip per service. It lives here in the MCP server rather than
 * inside the games portal on purpose — a health check hosted by the thing it
 * checks is useless in the exact case you need it.
 *
 * Three independent signals per service, because any one of them lies on its own:
 *   - systemd state  — the unit's opinion of itself
 *   - TCP probe      — is anything actually holding the port
 *   - HTTP probe     — is the app answering, or wedged with the socket open
 * A wedged Node process reports `active` to systemd and accepts TCP while
 * serving nothing, so the HTTP probe is what catches it.
 */

import { spawn } from 'child_process';
import net from 'net';
import http from 'http';

/**
 * The fleet. Ports and units verified against /etc/systemd/system/srv-*.service
 * on 2026-07-20. `health` is set only where a real health endpoint exists; for
 * everything else any HTTP response at all (404, 302) still proves liveness.
 */
export const GAMES_SERVICES = [
  { unit: 'srv-games', port: 3500, label: 'portal — identity/wallet/presence' },
  { unit: 'srv-matchmaking', port: 3610, label: 'matchmaking intake', health: '/health' },
  { unit: 'srv-cards', port: 3600, label: 'arcade — cards' },
  { unit: 'srv-tiles', port: 3625, label: 'arcade — tiles' },
  { unit: 'srv-td', port: 3720, label: 'arcade — towers' },
  { unit: 'srv-madlands', port: 3730, label: 'arcade — madlands' },
  { unit: 'srv-reels', port: 3740, label: 'arcade — reels' },
];

const PROBE_TIMEOUT = 3000;

/**
 * Batch every unit into one `systemctl show` rather than one call per service —
 * seven spawns is slow enough to notice on a tethered connection.
 * Output is blank-line-separated property blocks, one per unit.
 */
function systemdStates(units) {
  return new Promise((resolve) => {
    const args = ['show', '-p', 'Id', '-p', 'ActiveState', '-p', 'SubState',
      '-p', 'NRestarts', '-p', 'ActiveEnterTimestamp', ...units.map(u => `${u}.service`)];
    const child = spawn('systemctl', args, { timeout: PROBE_TIMEOUT });

    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('error', () => resolve({}));
    child.on('close', () => {
      const byUnit = {};
      for (const block of out.split(/\n\s*\n/)) {
        const props = {};
        for (const line of block.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1);
        }
        if (props.Id) byUnit[props.Id.replace(/\.service$/, '')] = props;
      }
      resolve(byUnit);
    });
  });
}

/** Is anything holding the port? Connect rather than parsing `ss` — works for
 *  both 127.0.0.1-bound and *-bound listeners without special-casing. */
function tcpProbe(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (open) => { sock.destroy(); resolve(open); };
    sock.setTimeout(PROBE_TIMEOUT);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, '127.0.0.1');
  });
}

/** Any HTTP status proves the app is answering. Only a timeout or a socket
 *  error means wedged/dead — a 404 is a perfectly healthy sign of life. */
function httpProbe(port, path = '/') {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: PROBE_TIMEOUT },
      (res) => {
        let body = '';
        res.on('data', d => { if (body.length < 2048) body += d.toString(); });
        res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 2048) }));
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ status: null, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: null, error: e.code || e.message }));
    req.end();
  });
}

/** "Sun 2026-06-28 13:46:46 MDT" → human uptime. The zone abbreviation is not
 *  reliably parseable, so drop it and read the rest as local time — this box
 *  and the units share a clock. */
function uptimeFrom(stamp) {
  if (!stamp || stamp === 'n/a') return null;
  const m = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(stamp);
  if (!m) return null;
  const started = new Date(m[1]);
  if (Number.isNaN(started.getTime())) return null;

  const secs = Math.floor((Date.now() - started.getTime()) / 1000);
  if (secs < 0) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const mn = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${mn}m`;
  return `${mn}m`;
}

/**
 * Probe the whole fleet concurrently.
 * @returns {Promise<{allOk:boolean, checkedAt:string, services:Array, problems:Array}>}
 */
export async function checkGamesHealth() {
  const states = await systemdStates(GAMES_SERVICES.map(s => s.unit));

  const services = await Promise.all(GAMES_SERVICES.map(async (svc) => {
    const st = states[svc.unit] || {};
    const listening = await tcpProbe(svc.port);
    // Skip the HTTP probe when nothing holds the port — it can only time out,
    // and three wasted seconds per dead service adds up on a bad connection.
    const probe = listening ? await httpProbe(svc.port, svc.health || '/') : null;

    const activeState = st.ActiveState || 'unknown';
    const restarts = Number(st.NRestarts || 0);
    const responding = !!probe && probe.status !== null;

    const issues = [];
    if (activeState !== 'active') issues.push(`unit ${activeState}`);
    if (!listening) issues.push(`port ${svc.port} closed`);
    else if (!responding) issues.push(`not answering HTTP (${probe.error}) — likely wedged`);
    if (restarts > 0) issues.push(`${restarts} restart${restarts > 1 ? 's' : ''}`);

    return {
      unit: svc.unit,
      label: svc.label,
      port: svc.port,
      activeState,
      subState: st.SubState || 'unknown',
      restarts,
      uptime: uptimeFrom(st.ActiveEnterTimestamp),
      listening,
      httpStatus: probe ? probe.status : null,
      healthBody: svc.health && probe?.body ? probe.body : undefined,
      ok: activeState === 'active' && listening && responding,
      issues,
    };
  }));

  const problems = services.filter(s => !s.ok);
  return {
    allOk: problems.length === 0,
    checkedAt: new Date().toISOString(),
    services,
    problems: problems.map(s => `${s.unit}: ${s.issues.join(', ')}`),
  };
}

/** Compact fixed-width render — this is read on a phone, so it has to survive
 *  a narrow screen and be scannable without parsing JSON. */
export function formatGamesHealth(result) {
  const lines = result.services.map((s) => {
    const mark = s.ok ? 'OK  ' : 'DOWN';
    const http = s.httpStatus ? `http ${s.httpStatus}` : (s.listening ? 'no-response' : 'port closed');
    const up = s.uptime ? `up ${s.uptime}` : '';
    const warn = s.restarts > 0 ? `  !${s.restarts} restarts` : '';
    return `${mark} ${s.unit.padEnd(16)} :${s.port}  ${s.activeState.padEnd(8)} ${http.padEnd(12)} ${up}${warn}`;
  });

  const header = result.allOk
    ? 'GAMES FLEET: all 7 services healthy'
    : `GAMES FLEET: ${result.problems.length} of ${result.services.length} degraded`;

  const detail = result.allOk ? '' : `\n\nProblems:\n${result.problems.map(p => `  - ${p}`).join('\n')}`;

  return `${header}\n${'-'.repeat(72)}\n${lines.join('\n')}${detail}\n\nChecked ${result.checkedAt}`;
}
