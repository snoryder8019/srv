/**
 * VM Control Tools for ClaudeTalk
 * Provides system control capabilities through LLM conversation
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Tool definitions for Claude API
 */
export const tools = [
  {
    name: "execute_command",
    description: "Execute a shell command on the server. Use for system operations, checking status, running scripts, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute"
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
          default: 30000
        }
      },
      required: ["command"]
    }
  },
  {
    name: "list_services",
    description: "List all running tmux sessions (services) on the server",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "restart_service",
    description: "Restart a specific service by killing and restarting its tmux session",
    input_schema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "Service name (madladslab, ps, sfg, etc.)"
        }
      },
      required: ["service"]
    }
  },
  {
    name: "get_service_logs",
    description: "Get the console output/logs from a running service",
    input_schema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "Service name"
        },
        lines: {
          type: "number",
          description: "Number of lines to retrieve (default: 50)",
          default: 50
        }
      },
      required: ["service"]
    }
  },
  {
    name: "read_file",
    description: "Read contents of a file on the server",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to file"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write or update a file on the server",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file"
        },
        content: {
          type: "string",
          description: "Content to write"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "list_directory",
    description: "List files and directories at a given path",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path (default: /srv)",
          default: "/srv"
        }
      }
    }
  },
  {
    name: "check_server_status",
    description: "Get overall server status: CPU, memory, disk usage, running services",
    input_schema: {
      type: "object",
      properties: {}
    }
  }
];

/**
 * Tool execution handlers
 */
export async function executeTool(toolName, toolInput) {
  try {
    switch (toolName) {
      case "execute_command":
        return await executeCommand(toolInput);

      case "list_services":
        return await listServices();

      case "restart_service":
        return await restartService(toolInput);

      case "get_service_logs":
        return await getServiceLogs(toolInput);

      case "read_file":
        return await readFile(toolInput);

      case "write_file":
        return await writeFile(toolInput);

      case "list_directory":
        return await listDirectory(toolInput);

      case "check_server_status":
        return await checkServerStatus();

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return {
      error: error.message,
      stack: error.stack
    };
  }
}

// Tool Implementations

async function executeCommand({ command, timeout = 30000 }) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: 1024 * 1024 // 1MB
    });
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || ''
    };
  }
}

async function listServices() {
  try {
    const { stdout } = await execAsync('tmux list-sessions 2>&1');
    const sessions = stdout.trim().split('\n').map(line => {
      const match = line.match(/^([^:]+):/);
      return match ? match[1] : null;
    }).filter(Boolean);

    return {
      success: true,
      services: sessions,
      count: sessions.length
    };
  } catch (error) {
    return {
      success: false,
      services: [],
      error: error.message
    };
  }
}

async function restartService({ service }) {
  const sessionName = service.includes('_session') ? service : `${service}_session`;

  try {
    // Kill existing session
    await execAsync(`tmux kill-session -t ${sessionName} 2>&1`).catch(() => {});

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start new session
    const serviceDir = `/srv/${service.replace('_session', '')}`;
    const startCmd = `npm run dev`;

    await execAsync(`tmux new-session -d -s ${sessionName} -c ${serviceDir} "${startCmd}"`);

    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 2000));

    return {
      success: true,
      message: `Service ${service} restarted successfully`,
      session: sessionName
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function getServiceLogs({ service, lines = 50 }) {
  const sessionName = service.includes('_session') ? service : `${service}_session`;

  try {
    const { stdout } = await execAsync(`tmux capture-pane -t ${sessionName} -p | tail -${lines}`);
    return {
      success: true,
      logs: stdout,
      service: sessionName
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function readFile({ path: filePath }) {
  try {
    const absolutePath = filePath.startsWith('/') ? filePath : path.join('/srv', filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const stats = await fs.stat(absolutePath);

    return {
      success: true,
      path: absolutePath,
      content,
      size: stats.size,
      modified: stats.mtime
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function writeFile({ path: filePath, content }) {
  try {
    const absolutePath = filePath.startsWith('/') ? filePath : path.join('/srv', filePath);

    // Backup existing file if it exists
    try {
      await fs.access(absolutePath);
      const backupPath = `${absolutePath}.backup`;
      await fs.copyFile(absolutePath, backupPath);
    } catch (e) {
      // File doesn't exist, no backup needed
    }

    await fs.writeFile(absolutePath, content, 'utf-8');

    return {
      success: true,
      path: absolutePath,
      message: 'File written successfully'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function listDirectory({ path: dirPath = '/srv' }) {
  try {
    const absolutePath = dirPath.startsWith('/') ? dirPath : path.join('/srv', dirPath);
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    const items = await Promise.all(entries.map(async entry => {
      const itemPath = path.join(absolutePath, entry.name);
      const stats = await fs.stat(itemPath);

      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime
      };
    }));

    return {
      success: true,
      path: absolutePath,
      items,
      count: items.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function checkServerStatus() {
  try {
    const [cpu, memory, disk, services] = await Promise.all([
      execAsync('top -bn1 | grep "Cpu(s)" | awk \'{print $2}\'').catch(() => ({ stdout: 'N/A' })),
      execAsync('free -h | grep Mem | awk \'{print $3 "/" $2}\'').catch(() => ({ stdout: 'N/A' })),
      execAsync('df -h / | tail -1 | awk \'{print $3 "/" $2 " (" $5 ")"}\'').catch(() => ({ stdout: 'N/A' })),
      listServices()
    ]);

    return {
      success: true,
      cpu: cpu.stdout.trim(),
      memory: memory.stdout.trim(),
      disk: disk.stdout.trim(),
      services: services.services || [],
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
