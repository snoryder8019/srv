import express from "express";
import axios from "axios";
import { readFile, readdir, stat, writeFile, appendFile, mkdir, unlink } from "fs/promises";
import { resolve as resolvePath, join, dirname } from "path";
import mongoose from "mongoose";
import { spawn } from "child_process";
import { uploadToLinode } from "../../lib/linodeStorage.js";

import Agent from "../../api/v1/models/Agent.js";
import AgentAction from "../../api/v1/models/AgentAction.js";
import { isAdmin } from "./middleware.js";

// ==================== MCP TOOL DEFINITIONS ====================

export const MCP_TOOL_DEFINITIONS = {
    'read-file': {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read file contents from the /srv directory',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute file path (must be within /srv)' }
                },
                required: ['path']
            }
        }
    },
    'list-directory': {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List directory contents',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (must be within /srv)' }
                },
                required: ['path']
            }
        }
    },
    'execute': {
        type: 'function',
        function: {
            name: 'execute',
            description: 'Execute a shell command (restricted; working dir is /srv)',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to run' },
                    timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
                },
                required: ['command']
            }
        }
    },
    'tmux-sessions': {
        type: 'function',
        function: {
            name: 'tmux_sessions',
            description: 'List all known tmux sessions and their running status',
            parameters: { type: 'object', properties: {} }
        }
    },
    'tmux-logs': {
        type: 'function',
        function: {
            name: 'tmux_logs',
            description: 'Capture recent terminal output from a tmux session',
            parameters: {
                type: 'object',
                properties: {
                    session: { type: 'string', description: 'Tmux session name' },
                    lines: { type: 'number', description: 'Lines to capture (default 100)' }
                },
                required: ['session']
            }
        }
    },
    'service-port': {
        type: 'function',
        function: {
            name: 'service_port',
            description: 'Check which process is listening on a port',
            parameters: {
                type: 'object',
                properties: {
                    port: { type: 'number', description: 'Port number to check' }
                },
                required: ['port']
            }
        }
    },
    'context': {
        type: 'function',
        function: {
            name: 'get_context',
            description: 'Get the CLAUDE.md context file for a project',
            parameters: {
                type: 'object',
                properties: {
                    project: { type: 'string', description: 'Project name (e.g. madladslab, ps, bih)' }
                },
                required: ['project']
            }
        }
    },
    'write-file': {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write or overwrite a file within /srv. Creates parent directories if needed.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute file path (must be within /srv)' },
                    content: { type: 'string', description: 'Content to write' },
                    append: { type: 'boolean', description: 'If true, append instead of overwrite (default false)' }
                },
                required: ['path', 'content']
            }
        }
    },
    'grep-search': {
        type: 'function',
        function: {
            name: 'grep_search',
            description: 'Search file contents with a regex pattern. Returns matching lines with file paths and line numbers.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Regex pattern to search for' },
                    path: { type: 'string', description: 'Directory or file to search within /srv' },
                    glob: { type: 'string', description: 'File glob filter, e.g. "*.js" or "*.{js,ejs}"' },
                    case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default false)' },
                    max_results: { type: 'number', description: 'Max matching lines to return (default 50)' }
                },
                required: ['pattern', 'path']
            }
        }
    },
    'git-status': {
        type: 'function',
        function: {
            name: 'git_status',
            description: 'Run a read-only git command (status, log, diff, branch, show) on a /srv project repo.',
            parameters: {
                type: 'object',
                properties: {
                    repo: { type: 'string', description: 'Repo path within /srv (e.g. /srv or /srv/madladslab)' },
                    command: { type: 'string', enum: ['status', 'log', 'diff', 'branch', 'show', 'stash list'], description: 'Git subcommand' },
                    args: { type: 'string', description: 'Extra args, e.g. "--oneline -10" for log' }
                },
                required: ['repo', 'command']
            }
        }
    },
    'http-request': {
        type: 'function',
        function: {
            name: 'http_request',
            description: 'Make an HTTP request to a local/internal service. Restricted to localhost and internal hostnames.',
            parameters: {
                type: 'object',
                properties: {
                    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
                    url: { type: 'string', description: 'URL (must be localhost, 127.0.0.1, or *.madladslab.com)' },
                    body: { type: 'object', description: 'Request body (for POST/PUT/PATCH)' },
                    headers: { type: 'object', description: 'Additional request headers' }
                },
                required: ['method', 'url']
            }
        }
    },
    'process-list': {
        type: 'function',
        function: {
            name: 'process_list',
            description: 'List running processes. Optionally filter by name.',
            parameters: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'Filter by process name (e.g. "node", "nginx")' }
                }
            }
        }
    },
    'file-find': {
        type: 'function',
        function: {
            name: 'file_find',
            description: 'Find files matching a name pattern within /srv.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Starting directory within /srv' },
                    name: { type: 'string', description: 'Filename pattern, e.g. "*.log" or "index.js"' },
                    type: { type: 'string', enum: ['file', 'directory', 'any'], description: 'Filter by type (default any)' },
                    max_depth: { type: 'number', description: 'Max directory depth (default 4)' }
                },
                required: ['path', 'name']
            }
        }
    },
    'mongo-find': {
        type: 'function',
        function: {
            name: 'mongo_find',
            description: 'Read-only MongoDB query against a collection in the current database. IMPORTANT: Knowledge Base entries are NOT a separate collection — they are embedded in the agents collection at memory.knowledgeBase and are already injected into your context. Do NOT attempt to query agent_kb, knowledgebase, or similar — they do not exist.',
            parameters: {
                type: 'object',
                properties: {
                    collection: { type: 'string', description: 'Allowed collections: agents, agent_actions, agent_tasks, agent_notes, agent_crons, users, threads, sessions. Agent-scoped collections (agent_tasks, agent_notes, agent_actions, agent_crons) are automatically filtered to your agentId. To read your own KB: collection="agents", filter={"_id":"<your agentId>"}, projection={"memory.knowledgeBase":1}' },
                    filter: { type: 'object', description: 'MongoDB filter query object' },
                    projection: { type: 'object', description: 'Fields to include/exclude' },
                    sort: { type: 'object', description: 'Sort order' },
                    limit: { type: 'number', description: 'Max documents (default 10, max 50)' }
                },
                required: ['collection']
            }
        }
    },
    'mongo-write': {
        type: 'function',
        function: {
            name: 'mongo_write',
            description: 'Write to an allowed MongoDB collection: insert, update, or delete a document.',
            parameters: {
                type: 'object',
                properties: {
                    collection: { type: 'string', description: 'Allowed: agent_notes, agent_tasks. Your agentId is automatically stamped — do not include it in the document.' },
                    operation: { type: 'string', enum: ['insertOne', 'updateOne', 'deleteOne'], description: 'Write operation' },
                    filter: { type: 'object', description: 'Filter for updateOne/deleteOne' },
                    document: { type: 'object', description: 'Document to insert, or update payload ($set etc)' }
                },
                required: ['collection', 'operation']
            }
        }
    },
    'web-search': {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web and return a summary of the top results.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    max_results: { type: 'number', description: 'Max results to return (default 5, max 10)' }
                },
                required: ['query']
            }
        }
    },
    'log-tail': {
        type: 'function',
        function: {
            name: 'log_tail',
            description: 'Tail the last N lines of a log file from /srv or /var/log.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute log file path (must be within /srv or /var/log)' },
                    lines: { type: 'number', description: 'Lines to return (default 50, max 500)' }
                },
                required: ['path']
            }
        }
    },
    'bih-chat': {
        type: 'function',
        function: {
            name: 'bih_chat',
            description: 'Post a message to the bih chat as a system alert. Use for monitoring alerts or notifications.',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Message to send to bih chat' },
                    displayName: { type: 'string', description: 'Display name override (default: agent name)' }
                },
                required: ['message']
            }
        }
    },
    'npm-run': {
        type: 'function',
        function: {
            name: 'npm_run',
            description: 'Run an npm script in a /srv project (read-only scripts: test, lint, build). Does NOT start/stop services.',
            parameters: {
                type: 'object',
                properties: {
                    project: { type: 'string', description: 'Project directory within /srv (e.g. madladslab, ps, bih)' },
                    script: { type: 'string', description: 'npm script name (e.g. test, lint, build)' }
                },
                required: ['project', 'script']
            }
        }
    },
    'fetch-url': {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch the text content of any public web page. Returns the readable text stripped of HTML.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Full URL to fetch (e.g. https://example.com/page)' },
                    max_chars: { type: 'number', description: 'Max characters to return (default 8000, max 20000)' }
                },
                required: ['url']
            }
        }
    },
    'cron-job': {
        type: 'function',
        function: {
            name: 'cron_job',
            description: 'Manage agent-owned cron jobs in /etc/cron.d/agent-*. Use to schedule recurring tasks: list existing jobs, read a job, write/create a new job, or delete a job.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'read', 'write', 'delete'], description: 'Operation to perform' },
                    name: { type: 'string', description: 'Job name (e.g. "health-check" → /etc/cron.d/agent-health-check). Letters, numbers, hyphens only.' },
                    schedule: { type: 'string', description: 'Cron schedule expression (e.g. "*/5 * * * *" for every 5 min, "0 6 * * *" for 6am daily)' },
                    command: { type: 'string', description: 'Shell command to run (runs as root)' },
                    description: { type: 'string', description: 'Human-readable description of what this job does (added as comment)' }
                },
                required: ['action']
            }
        }
    },
    'message-agent': {
        type: 'function',
        function: {
            name: 'message_agent',
            description: 'Send a message to another agent and receive their response. Use to delegate tasks, request information, or coordinate with peer or subordinate agents.',
            parameters: {
                type: 'object',
                properties: {
                    agentId: { type: 'string', description: 'The MongoDB ID of the target agent' },
                    message: { type: 'string', description: 'The message or task to send to that agent' }
                },
                required: ['agentId', 'message']
            }
        }
    },
    'generate-image': {
        type: 'function',
        function: {
            name: 'generate_image',
            description: 'Generate, create, draw, or visualize an image from a text prompt using locally hosted Stable Diffusion. Use this whenever the user asks you to generate, create, draw, paint, render, or show an image. Returns a URL and markdown to display the image inline.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Detailed image generation prompt' },
                    negative_prompt: { type: 'string', description: 'What to avoid in the image (optional)' },
                    size: { type: 'string', description: 'Image dimensions as "WxH", e.g. "512x512" (default) or "768x768"' },
                    num_inference_steps: { type: 'number', description: 'Inference steps — more = higher quality but slower (default 25)' },
                    guidance_scale: { type: 'number', description: 'How closely to follow the prompt (default 7.5)' },
                    seed: { type: 'number', description: 'Seed for reproducible results (optional)' }
                },
                required: ['prompt']
            }
        }
    }
};

const FORBIDDEN_COMMANDS = ['killall', 'pkill -9', 'rm -rf /', 'dd if=', 'mkfs', 'reboot', 'shutdown', 'init 0', 'init 6'];

function mcpRunCommand(command, timeout = 30000) {
    return new Promise((resolve, reject) => {
        if (FORBIDDEN_COMMANDS.some(f => command.includes(f))) {
            return reject(new Error('FORBIDDEN: command contains dangerous operation'));
        }
        const child = spawn('bash', ['-c', command], { cwd: '/srv', timeout, maxBuffer: 1024 * 1024 * 5 });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), success: code === 0 }));
        child.on('error', err => reject(new Error(`Command failed: ${err.message}`)));
        setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Timed out after ${timeout}ms`)); }, timeout);
    });
}

export async function executeMcpTool(toolName, args, agentId = null) {
    switch (toolName) {
        case 'read_file': {
            const resolved = resolvePath(args.path);
            if (!resolved.startsWith('/srv')) throw new Error('Path must be within /srv');
            const info = await stat(resolved);
            if (info.isDirectory()) throw new Error(`"${resolved}" is a directory — use list_directory to list its contents`);
            if (info.size > 10 * 1024 * 1024) throw new Error('File too large (>10MB)');
            const content = await readFile(resolved, 'utf-8');
            return { path: resolved, size: info.size, content };
        }
        case 'list_directory': {
            const resolved = resolvePath(args.path);
            if (!resolved.startsWith('/srv')) throw new Error('Path must be within /srv');
            const files = await readdir(resolved, { withFileTypes: true });
            return { path: resolved, files: files.map(f => ({ name: f.name, type: f.isDirectory() ? 'directory' : 'file', path: join(resolved, f.name) })) };
        }
        case 'execute': {
            const result = await mcpRunCommand(args.command, args.timeout);
            return result;
        }
        case 'tmux_sessions': {
            const result = await mcpRunCommand('tmux ls 2>/dev/null || echo "No sessions"');
            return { raw: result.stdout };
        }
        case 'tmux_logs': {
            const lines = args.lines || 100;
            const result = await mcpRunCommand(`tmux capture-pane -p -t ${args.session} -S -${lines} 2>/dev/null || echo "Session not found"`);
            return { session: args.session, logs: result.stdout };
        }
        case 'service_port': {
            const result = await mcpRunCommand(`lsof -ti:${args.port} 2>/dev/null || echo ""`);
            const pid = result.stdout.trim();
            let process = null;
            if (pid) {
                const ps = await mcpRunCommand(`ps -p ${pid} -o pid,comm,args --no-headers 2>/dev/null || echo ""`);
                process = ps.stdout.trim();
            }
            return { port: args.port, status: pid ? 'listening' : 'not listening', pid: pid || null, process };
        }
        case 'get_context': {
            const contextPath = `/srv/${args.project}/docs/CLAUDE.md`;
            const content = await readFile(contextPath, 'utf-8');
            return { project: args.project, content };
        }
        case 'write_file': {
            const resolved = resolvePath(args.path);
            if (!resolved.startsWith('/srv')) throw new Error('Path must be within /srv');
            const WRITE_FORBIDDEN = ['/srv/.env', '/srv/madladslab/.env', '/srv/ps/.env', '/srv/bih/.env'];
            if (WRITE_FORBIDDEN.includes(resolved)) throw new Error('Writing to env files is forbidden');
            await mkdir(dirname(resolved), { recursive: true });
            if (args.append) {
                await appendFile(resolved, args.content, 'utf-8');
            } else {
                await writeFile(resolved, args.content, 'utf-8');
            }
            const result = { path: resolved, bytes: Buffer.byteLength(args.content), action: args.append ? 'appended' : 'written' };
            if (agentId) {
                new AgentAction({
                    agentId,
                    type: 'file_write',
                    title: `${result.action}: ${resolved.replace('/srv/', '')}`,
                    content: args.content.substring(0, 500),
                    metadata: { path: resolved, bytes: result.bytes, append: !!args.append },
                    status: 'complete'
                }).save().catch(() => {});
            }
            return result;
        }
        case 'grep_search': {
            const resolved = resolvePath(args.path);
            if (!resolved.startsWith('/srv')) throw new Error('Path must be within /srv');
            const maxResults = Math.min(args.max_results || 50, 200);
            const flags = ['-rn', '--color=never'];
            if (args.case_insensitive) flags.push('-i');
            if (args.glob) flags.push(`--include="${args.glob}"`);
            flags.push('--max-count=1');
            const cmd = `grep ${flags.join(' ')} ${JSON.stringify(args.pattern)} ${JSON.stringify(resolved)} 2>/dev/null | head -${maxResults}`;
            const result = await mcpRunCommand(cmd, 15000);
            const lines = result.stdout ? result.stdout.split('\n').filter(Boolean) : [];
            return { pattern: args.pattern, path: resolved, matches: lines, count: lines.length };
        }
        case 'git_status': {
            const resolved = resolvePath(args.repo);
            if (!resolved.startsWith('/srv')) throw new Error('Repo must be within /srv');
            const allowed = ['status', 'log', 'diff', 'branch', 'show', 'stash list'];
            if (!allowed.includes(args.command)) throw new Error(`Allowed git commands: ${allowed.join(', ')}`);
            const extraArgs = (args.args || '').replace(/[;&|`$]/g, '');
            const cmd = `git -C ${JSON.stringify(resolved)} ${args.command} ${extraArgs}`;
            const result = await mcpRunCommand(cmd, 15000);
            return { repo: resolved, command: args.command, output: result.stdout, error: result.stderr || null };
        }
        case 'http_request': {
            const url = args.url;
            const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
            const urlObj = new URL(url);
            const isAllowed = allowedHosts.includes(urlObj.hostname) || urlObj.hostname.endsWith('.madladslab.com');
            if (!isAllowed) throw new Error('http_request restricted to localhost and *.madladslab.com');
            const method = (args.method || 'GET').toUpperCase();
            const reqConfig = {
                method,
                url,
                headers: { 'Content-Type': 'application/json', ...(args.headers || {}) },
                timeout: 10000,
                validateStatus: () => true
            };
            if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) reqConfig.data = args.body;
            const response = await axios(reqConfig);
            const bodyStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            return {
                status: response.status,
                statusText: response.statusText,
                body: bodyStr.substring(0, 4000)
            };
        }
        case 'process_list': {
            const filter = (args.filter || '').replace(/[;&|`$]/g, '');
            const cmd = filter
                ? `ps aux | grep -i "${filter}" | grep -v grep`
                : `ps aux --sort=-%cpu | head -30`;
            const result = await mcpRunCommand(cmd, 10000);
            return { processes: result.stdout };
        }
        case 'file_find': {
            const resolved = resolvePath(args.path);
            if (!resolved.startsWith('/srv')) throw new Error('Path must be within /srv');
            const maxDepth = Math.min(args.max_depth || 4, 8);
            const name = (args.name || '*').replace(/[;&|`$]/g, '');
            const typeFlag = args.type === 'file' ? '-type f' : args.type === 'directory' ? '-type d' : '';
            const cmd = `find ${JSON.stringify(resolved)} -maxdepth ${maxDepth} ${typeFlag} -name "${name}" 2>/dev/null | head -100`;
            const result = await mcpRunCommand(cmd, 15000);
            const files = result.stdout ? result.stdout.split('\n').filter(Boolean) : [];
            return { path: resolved, pattern: name, files, count: files.length };
        }
        case 'mongo_find': {
            const db = mongoose.connection.db;
            if (!db) throw new Error('No database connection');
            const safeCollections = ['agents', 'users', 'threads', 'agent_actions', 'sessions', 'agent_tasks', 'agent_notes', 'agent_crons'];
            if (!safeCollections.includes(args.collection)) throw new Error(`Collection must be one of: ${safeCollections.join(', ')}`);

            // Agent-scoped collections: always inject agentId so agents only see their own data
            const agentScopedCollections = ['agent_tasks', 'agent_notes', 'agent_actions', 'agent_crons'];
            let filter = args.filter || {};
            if (agentScopedCollections.includes(args.collection) && agentId) {
                filter = { ...filter, agentId };
            }

            // Guard: querying 'agents' by name for a non-agent entity is always wrong.
            // Return an explicit error so the agent stops retrying and uses the right approach.
            if (args.collection === 'agents' && filter.name && typeof filter.name === 'string') {
                const nameMatch = await db.collection('agents').findOne({ name: filter.name }, { projection: { _id: 1, name: 1 } });
                if (!nameMatch) {
                    return {
                        collection: 'agents',
                        count: 0,
                        documents: [],
                        _hint: `No agent named "${filter.name}" exists. The 'agents' collection only contains AI agent configs — not people, characters, or external entities. If you are looking for knowledge about "${filter.name}", check your Knowledge Base (already injected in context) or use web_search to research them, then store findings via mongo_write to agent_notes.`
                    };
                }
            }

            const limit = Math.min(args.limit || 10, 50);
            const docs = await db.collection(args.collection)
                .find(filter, { projection: args.projection })
                .sort(args.sort || { _id: -1 })
                .limit(limit)
                .toArray();
            return { collection: args.collection, count: docs.length, documents: docs };
        }
        case 'mongo_write': {
            const db = mongoose.connection.db;
            if (!db) throw new Error('No database connection');
            const writableCollections = ['agent_notes', 'agent_tasks'];
            if (!writableCollections.includes(args.collection)) throw new Error(`Writable collections: ${writableCollections.join(', ')}`);
            const col = db.collection(args.collection);
            let result;
            if (args.operation === 'insertOne') {
                // Always stamp agentId so the document is owned and cascade-deletable
                result = await col.insertOne({ ...args.document, agentId: agentId || args.document?.agentId, _createdAt: new Date() });
            } else if (args.operation === 'updateOne') {
                if (!args.filter) throw new Error('filter required for updateOne');
                // Scope to agentId so agents can't mutate each other's documents
                const scopedFilter = agentId ? { ...args.filter, agentId } : args.filter;
                result = await col.updateOne(scopedFilter, args.document);
            } else if (args.operation === 'deleteOne') {
                if (!args.filter) throw new Error('filter required for deleteOne');
                const scopedFilter = agentId ? { ...args.filter, agentId } : args.filter;
                result = await col.deleteOne(scopedFilter);
            }
            return { collection: args.collection, operation: args.operation, result };
        }
        case 'web_search': {
            const apiKey = process.env.SEARCH_API_KEY;
            const maxResults = Math.min(args.max_results || 5, 10);
            const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${maxResults}`;
            const resp = await axios.get(searchUrl, {
                headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
                timeout: 10000
            });
            const results = (resp.data.web?.results || []).map(r => ({
                title: r.title,
                url: r.url,
                description: r.description
            }));
            return { query: args.query, results };
        }
        case 'log_tail': {
            const resolved = resolvePath(args.path);
            if (!resolved.startsWith('/srv') && !resolved.startsWith('/var/log')) {
                throw new Error('Path must be within /srv or /var/log');
            }
            const lines = Math.min(args.lines || 50, 500);
            const result = await mcpRunCommand(`tail -n ${lines} ${JSON.stringify(resolved)} 2>/dev/null`, 10000);
            return { path: resolved, lines: result.stdout };
        }
        case 'bih_chat': {
            const msg = args.message?.slice(0, 1000);
            if (!msg) throw new Error('message is required');
            const displayName = args.displayName || 'System';
            const resp = await axios.post('http://localhost:3055/api/bot-alert', {
                message: msg,
                displayName,
                secret: process.env.BOT_ALERT_SECRET || 'bih-internal'
            }, { timeout: 5000 }).catch(() => null);
            return { sent: true, message: msg };
        }
        case 'npm_run': {
            const projectPath = resolvePath(`/srv/${args.project.replace(/[^a-z0-9_-]/gi, '')}`);
            if (!projectPath.startsWith('/srv')) throw new Error('Project must be within /srv');
            const allowedScripts = ['test', 'lint', 'build', 'check', 'typecheck', 'validate'];
            if (!allowedScripts.includes(args.script)) throw new Error(`Allowed scripts: ${allowedScripts.join(', ')}`);
            const result = await mcpRunCommand(`cd ${JSON.stringify(projectPath)} && npm run ${args.script} 2>&1`, 60000);
            return { project: projectPath, script: args.script, output: result.stdout.slice(0, 5000) };
        }
        case 'fetch_url': {
            const maxChars = Math.min(args.max_chars || 8000, 20000);
            const resp = await axios.get(args.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                },
                timeout: 15000,
                maxContentLength: 1024 * 1024 * 2
            });
            const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
            // Strip HTML tags and collapse whitespace
            const text = html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\s{2,}/g, ' ')
                .trim();
            return { url: args.url, content: text.slice(0, maxChars), truncated: text.length > maxChars };
        }
        case 'cron_job': {
            const CRON_DIR = '/etc/cron.d';
            const safeName = (args.name || '').replace(/[^a-z0-9-]/gi, '').toLowerCase();

            switch (args.action) {
                case 'list': {
                    const files = await readdir(CRON_DIR);
                    const agentJobs = files.filter(f => f.startsWith('agent-'));
                    const jobs = await Promise.all(agentJobs.map(async f => {
                        const content = await readFile(`${CRON_DIR}/${f}`, 'utf-8').catch(() => '');
                        return { file: f, content: content.trim() };
                    }));
                    return { jobs };
                }
                case 'read': {
                    if (!safeName) throw new Error('name required');
                    const content = await readFile(`${CRON_DIR}/agent-${safeName}`, 'utf-8');
                    return { file: `agent-${safeName}`, content };
                }
                case 'write': {
                    if (!safeName) throw new Error('name required');
                    if (!args.schedule) throw new Error('schedule required');
                    if (!args.command) throw new Error('command required');
                    if (FORBIDDEN_COMMANDS.some(f => args.command.includes(f))) throw new Error('FORBIDDEN: command contains dangerous operation');
                    const desc = args.description ? `# ${args.description}\n` : '';
                    const content = `${desc}# Agent-managed cron job: ${safeName}\nSHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n${args.schedule} root ${args.command}\n`;
                    await writeFile(`${CRON_DIR}/agent-${safeName}`, content, { mode: 0o644 });
                    return { file: `agent-${safeName}`, schedule: args.schedule, command: args.command, written: true };
                }
                case 'delete': {
                    if (!safeName) throw new Error('name required');
                    await unlink(`${CRON_DIR}/agent-${safeName}`);
                    return { file: `agent-${safeName}`, deleted: true };
                }
                default:
                    throw new Error('action must be list, read, write, or delete');
            }
        }
        case 'message_agent': {
            if (!args.agentId || !args.message) throw new Error('agentId and message are required');
            const target = await Agent.findById(args.agentId, 'name').lean();
            if (!target) throw new Error(`Agent ${args.agentId} not found`);
            const resp = await axios.post(`http://localhost:3000/agents/api/agents/${args.agentId}/chat-internal`, {
                secret: process.env.BOT_ALERT_SECRET || 'bih-internal',
                message: args.message,
                fromAgentName: 'Agent (MCP)'
            }, { timeout: 120000 });
            if (!resp.data.success) throw new Error(resp.data.error || 'chat-internal failed');
            return { agentName: target.name, response: resp.data.response };
        }
        case 'generate_image': {
            const sdBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
            const sdApiKey = process.env.OLLAMA_API_KEY;
            const size = args.size || '512x512';
            const payload = {
                prompt: args.prompt,
                size,
                n: 1,
                num_inference_steps: args.num_inference_steps || 25,
                guidance_scale: args.guidance_scale || 7.5
            };
            if (args.negative_prompt) payload.negative_prompt = args.negative_prompt;
            if (args.seed != null) payload.seed = args.seed;

            const genResp = await axios.post(`${sdBaseUrl}/v1/images/generations`, payload, {
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sdApiKey}` },
                timeout: 90000
            });

            const b64 = genResp.data?.data?.[0]?.b64_json;
            if (!b64) throw new Error('Stable Diffusion returned no image data');

            const filename = `sd-${Date.now()}.png`;
            const imageBuffer = Buffer.from(b64, 'base64');
            const imageUrl = await uploadToLinode(imageBuffer, filename, 'agent-generated', true);

            return {
                url: imageUrl,
                prompt: args.prompt,
                size,
                markdown: `![generated image](${imageUrl})`
            };
        }
        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

// ==================== MCP CONFIGURATION ROUTES ====================

const router = express.Router();

// ── Internal execute endpoint — used by bih to run MCP tools in agent mode ──
// Secured by shared BOT_ALERT_SECRET, not session auth
router.post('/api/mcp/execute-internal', async (req, res) => {
    const expected = process.env.BOT_ALERT_SECRET || 'bih-internal';
    const { secret, agentId, toolName, args } = req.body;
    if (secret !== expected) return res.status(403).json({ error: 'Forbidden' });
    if (!agentId || !toolName) return res.status(400).json({ error: 'agentId and toolName required' });

    try {
        const agent = await Agent.findById(agentId).lean();
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        // Verify the tool is in the agent's enabled chat tools
        const enabled = agent.mcpConfig?.enabledTools || [];
        const toolKey = toolName.replace(/_/g, '-');  // read_file → read-file
        if (!enabled.includes(toolKey)) {
            return res.status(403).json({ error: `Tool "${toolName}" is not enabled for this agent` });
        }

        const result = await executeMcpTool(toolName, args || {}, agentId);
        res.json({ success: true, result });
    } catch (error) {
        console.error(`[mcp-internal] ${toolName} error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/api/mcp/available-tools', isAdmin, async (req, res) => {
    try {
        const availableTools = [
            { name: 'read-file',      description: 'Read file contents from /srv directory', category: 'filesystem' },
            { name: 'write-file',     description: 'Write or append a file within /srv', category: 'filesystem' },
            { name: 'list-directory', description: 'List directory contents', category: 'filesystem' },
            { name: 'file-find',      description: 'Find files by name pattern within /srv', category: 'filesystem' },
            { name: 'grep-search',    description: 'Search file contents with regex', category: 'filesystem' },
            { name: 'git-status',     description: 'Read-only git commands (status, log, diff, branch)', category: 'git' },
            { name: 'execute',        description: 'Execute shell commands (restricted)', category: 'shell' },
            { name: 'process-list',   description: 'List running processes (optionally filtered)', category: 'shell' },
            { name: 'tmux-sessions',  description: 'List tmux sessions and their status', category: 'shell' },
            { name: 'tmux-logs',      description: 'Capture recent output from a tmux session', category: 'shell' },
            { name: 'service-port',   description: 'Check which process is on a given port', category: 'shell' },
            { name: 'http-request',   description: 'HTTP request to localhost / *.madladslab.com', category: 'network' },
            { name: 'mongo-find',     description: 'Read-only MongoDB query against a collection', category: 'database' },
            { name: 'mongo-write',    description: 'Write to agent_notes or agent_tasks collection', category: 'database' },
            { name: 'web-search',     description: 'Search the web (Brave Search API)', category: 'network' },
            { name: 'log-tail',       description: 'Tail last N lines of a log file', category: 'filesystem' },
            { name: 'bih-chat',       description: 'Post a message to bih chat (alerts/notifications)', category: 'integrations' },
            { name: 'npm-run',        description: 'Run safe npm scripts (test, lint, build) in a /srv project', category: 'shell' },
            { name: 'context',        description: 'Get project CLAUDE.md context file', category: 'meta' },
            { name: 'cron-job',       description: 'Manage agent-owned cron jobs in /etc/cron.d/agent-*', category: 'shell' },
            { name: 'generate-image',  description: 'Generate image from prompt via locally hosted Stable Diffusion', category: 'media' },
            { name: 'message-agent',   description: 'Send a message to another agent and receive their response', category: 'agents' }
        ];

        res.json({ success: true, tools: availableTools });
    } catch (error) {
        console.error('Error fetching available MCP tools:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/api/agents/:id/mcp', isAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        res.json({
            success: true,
            mcpConfig: agent.mcpConfig || { enabledTools: [] }
        });
    } catch (error) {
        console.error('Error fetching MCP config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/api/agents/:id/mcp/enable', isAdmin, async (req, res) => {
    try {
        const { tools } = req.body;

        if (!Array.isArray(tools)) {
            return res.status(400).json({ success: false, error: 'Tools must be an array' });
        }

        const agent = await Agent.findById(req.params.id);

        if (!agent) {
            return res.status(404).json({ success: false, error: 'Agent not found' });
        }

        await agent.enableMcpTools(tools);
        await agent.addLog('info', `MCP tools updated: ${tools.join(', ')}`);

        res.json({ success: true, enabledTools: agent.mcpConfig.enabledTools });
    } catch (error) {
        console.error('Error enabling MCP tools:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
