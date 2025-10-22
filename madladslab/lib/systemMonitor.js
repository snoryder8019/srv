/**
 * System Monitor
 * Monitors all apps running in /srv and their health status
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

const execAsync = promisify(exec);

// Configuration for each app
const APP_CONFIG = {
  madladslab: { port: 3000, path: '/srv/madladslab', domain: 'madladslab.com', session: 'madladslab' },
  ps: { port: 3399, path: '/srv/ps', domain: 'ps.madladslab.com', session: 'ps' },
  'game-state': { port: 3500, path: '/srv/game-state-service', domain: 'svc.madladslab.com', session: 'game-state' },
  acm: { port: 3001, path: '/srv/acm', domain: 'acmcreativeconcepts.com', session: 'acm' },
  nocometalworkz: { port: 3002, path: '/srv/nocometalworkz', domain: 'nocometalworkz.com', session: 'nocometalworkz' },
  sfg: { port: 3003, path: '/srv/sfg', domain: 'sfg.madladslab.com', session: 'sfg' },
  sna: { port: 3004, path: '/srv/sna', domain: 'somenewsarticle.com', session: 'sna' },
  twww: { port: 3005, path: '/srv/twww', domain: 'theworldwidewallet.com', session: 'twww' },
  w2portal: { port: 3006, path: '/srv/w2MongoClient', domain: 'localhost', session: 'w2portal' },
  madThree: { port: 3007, path: '/srv/madThree', domain: 'three.madladslab.com', session: 'madThree' }
};

/**
 * Get status of all apps
 */
export async function getAllAppsStatus() {
  const apps = Object.keys(APP_CONFIG);
  const results = await Promise.all(
    apps.map(async (appName) => {
      try {
        const status = await getAppStatus(appName);
        return { appName, ...status };
      } catch (error) {
        return {
          appName,
          status: 'error',
          error: error.message,
          running: false
        };
      }
    })
  );

  return results;
}

/**
 * Get detailed status for a single app
 */
export async function getAppStatus(appName) {
  const config = APP_CONFIG[appName];

  if (!config) {
    throw new Error(`Unknown app: ${appName}`);
  }

  const [
    tmuxStatus,
    portStatus,
    healthCheck,
    resourceUsage,
    appInfo
  ] = await Promise.all([
    checkTmuxSession(appName),
    checkPort(config.port),
    checkHealth(config.port),
    getResourceUsage(appName),
    getAppInfo(config.path)
  ]);

  const isHealthy = tmuxStatus.running && portStatus.listening && healthCheck.responding;

  return {
    status: isHealthy ? 'healthy' : (tmuxStatus.running ? 'unhealthy' : 'stopped'),
    running: tmuxStatus.running,
    port: config.port,
    domain: config.domain,
    path: config.path,
    tmux: tmuxStatus,
    port: portStatus,
    health: healthCheck,
    resources: resourceUsage,
    info: appInfo,
    lastChecked: new Date().toISOString()
  };
}

/**
 * Check if tmux session exists
 */
async function checkTmuxSession(appName) {
  try {
    const config = APP_CONFIG[appName];
    const sessionName = config ? config.session : appName;
    const { stdout } = await execAsync(`tmux list-sessions 2>&1 | grep "^${sessionName}:" || echo "not found"`);

    if (stdout.includes('not found')) {
      return { running: false, session: null };
    }

    // Get pane content to check for errors
    try {
      const { stdout: paneContent } = await execAsync(`tmux capture-pane -t ${sessionName} -p | tail -5`);
      const hasError = paneContent.toLowerCase().includes('error') ||
                       paneContent.toLowerCase().includes('crashed');

      return {
        running: true,
        session: sessionName,
        hasErrors: hasError,
        recentOutput: paneContent.trim()
      };
    } catch (err) {
      return { running: true, session: sessionName, hasErrors: false };
    }
  } catch (error) {
    return { running: false, error: error.message };
  }
}

/**
 * Check if port is listening
 */
async function checkPort(port) {
  try {
    const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null || echo "not listening"`);

    if (stdout.trim() === 'not listening') {
      return { listening: false, port };
    }

    const pid = stdout.trim();
    return { listening: true, port, pid: parseInt(pid) };
  } catch (error) {
    return { listening: false, port, error: error.message };
  }
}

/**
 * Health check via HTTP
 */
async function checkHealth(port) {
  try {
    const startTime = Date.now();
    const response = await axios.get(`http://localhost:${port}`, {
      timeout: 5000,
      validateStatus: () => true // Accept any status code
    });
    const responseTime = Date.now() - startTime;

    return {
      responding: response.status < 500,
      statusCode: response.status,
      responseTime,
      healthy: response.status === 200 || response.status === 302
    };
  } catch (error) {
    return {
      responding: false,
      error: error.code || error.message,
      healthy: false
    };
  }
}

/**
 * Get resource usage (CPU, Memory)
 */
async function getResourceUsage(appName) {
  try {
    const config = APP_CONFIG[appName];
    const sessionName = config ? config.session : appName;

    // Get PID from tmux session
    const { stdout: pidOutput } = await execAsync(
      `tmux list-panes -t ${sessionName} -F "#{pane_pid}" 2>/dev/null || echo ""`
    );

    if (!pidOutput.trim()) {
      return { available: false };
    }

    const pid = pidOutput.trim();

    // Get process stats using ps
    const { stdout: psOutput } = await execAsync(
      `ps -p ${pid} -o %cpu,%mem,vsz,rss 2>/dev/null | tail -1`
    );

    const [cpu, mem, vsz, rss] = psOutput.trim().split(/\s+/).map(parseFloat);

    return {
      available: true,
      cpu: cpu || 0,
      memory: mem || 0,
      memoryMB: Math.round(rss / 1024) || 0,
      virtualMemoryMB: Math.round(vsz / 1024) || 0,
      pid: parseInt(pid)
    };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

/**
 * Get app info from package.json
 */
async function getAppInfo(appPath) {
  try {
    const packagePath = path.join(appPath, 'package.json');
    const content = await fs.readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(content);

    // Get git info
    let gitInfo = null;
    try {
      const { stdout: branch } = await execAsync(`cd ${appPath} && git branch --show-current 2>/dev/null || echo "unknown"`);
      const { stdout: commit } = await execAsync(`cd ${appPath} && git rev-parse --short HEAD 2>/dev/null || echo "unknown"`);
      const { stdout: lastCommit } = await execAsync(`cd ${appPath} && git log -1 --format="%ar" 2>/dev/null || echo "unknown"`);

      gitInfo = {
        branch: branch.trim(),
        commit: commit.trim(),
        lastCommit: lastCommit.trim()
      };
    } catch (err) {
      gitInfo = { error: 'Git info unavailable' };
    }

    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      git: gitInfo
    };
  } catch (error) {
    return {
      name: path.basename(appPath),
      error: 'Package.json not found'
    };
  }
}

/**
 * Get system-wide stats
 */
export async function getSystemStats() {
  try {
    const [cpu, memory, disk, uptime, loadAvg] = await Promise.all([
      execAsync('top -bn1 | grep "Cpu(s)" | awk \'{print $2}\' | cut -d"%" -f1').catch(() => ({ stdout: '0' })),
      execAsync('free | grep Mem | awk \'{printf "%.1f", ($3/$2) * 100}\'').catch(() => ({ stdout: '0' })),
      execAsync('df -h / | tail -1 | awk \'{print $5}\' | cut -d"%" -f1').catch(() => ({ stdout: '0' })),
      execAsync('uptime -p').catch(() => ({ stdout: 'unknown' })),
      execAsync('uptime | awk -F"load average:" \'{print $2}\'').catch(() => ({ stdout: '0, 0, 0' }))
    ]);

    const [load1, load5, load15] = loadAvg.stdout.trim().split(',').map(s => parseFloat(s.trim()) || 0);

    return {
      cpu: parseFloat(cpu.stdout.trim()) || 0,
      memory: parseFloat(memory.stdout.trim()) || 0,
      disk: parseFloat(disk.stdout.trim()) || 0,
      uptime: uptime.stdout.trim(),
      loadAverage: {
        '1min': load1,
        '5min': load5,
        '15min': load15
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Restart an app
 */
export async function restartApp(appName) {
  const config = APP_CONFIG[appName];

  if (!config) {
    throw new Error(`Unknown app: ${appName}`);
  }

  const sessionName = config.session;

  try {
    // Kill existing session
    await execAsync(`tmux kill-session -t ${sessionName} 2>&1`).catch(() => {});

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start new session
    await execAsync(`tmux new-session -d -s ${sessionName} -c ${config.path} "PORT=${config.port} npm start"`);

    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 3000));

    return {
      success: true,
      message: `${appName} restarted successfully`,
      session: sessionName
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get logs from an app
 */
export async function getAppLogs(appName, lines = 50) {
  const config = APP_CONFIG[appName];

  if (!config) {
    throw new Error(`Unknown app: ${appName}`);
  }

  const sessionName = config.session;

  try {
    const { stdout } = await execAsync(`tmux capture-pane -t ${sessionName} -p | tail -${lines}`);
    return {
      success: true,
      logs: stdout,
      lines: stdout.split('\n').length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  getAllAppsStatus,
  getAppStatus,
  getSystemStats,
  restartApp,
  getAppLogs
};
