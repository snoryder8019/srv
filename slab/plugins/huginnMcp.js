/**
 * Huginn MCP — Read access to Slab DB + codebase, CRUD for huginn_* collections
 *
 * Design: Slab does the heavy lifting (DB reads, file reads, context assembly).
 * The LLM machine just does conversation. This keeps the small model focused
 * and avoids tool-call loops.
 */

import fs from 'fs/promises';
import path from 'path';
import { getSlabDb, getTenantDb } from './mongo.js';

const SLAB_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');

// ── Huginn DB (uses slab registry DB, huginn_* collections) ─────────────────

function huginnDb() {
  return getSlabDb();
}

// ── Task CRUD (huginn_tasks) ────────────────────────────────────────────────

export async function createTask(task) {
  const doc = {
    title: task.title || 'Untitled',
    body: task.body || '',
    status: task.status || 'pending',    // pending | in_progress | done | blocked
    priority: task.priority || 'normal', // low | normal | high | urgent
    tags: task.tags || [],
    context: task.context || null,        // what triggered this task
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await huginnDb().collection('huginn_tasks').insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function updateTask(id, updates) {
  const { ObjectId } = await import('mongodb');
  const _id = typeof id === 'string' ? new ObjectId(id) : id;
  const set = { ...updates, updatedAt: new Date() };
  delete set._id; // safety
  await huginnDb().collection('huginn_tasks').updateOne({ _id }, { $set: set });
  return huginnDb().collection('huginn_tasks').findOne({ _id });
}

export async function listTasks(filter = {}) {
  const query = {};
  if (filter.status) query.status = filter.status;
  if (filter.priority) query.priority = filter.priority;
  if (filter.tag) query.tags = filter.tag;
  return huginnDb().collection('huginn_tasks')
    .find(query).sort({ updatedAt: -1 }).limit(filter.limit || 50).toArray();
}

export async function getTask(id) {
  const { ObjectId } = await import('mongodb');
  return huginnDb().collection('huginn_tasks').findOne({
    _id: typeof id === 'string' ? new ObjectId(id) : id,
  });
}

// ── Notes / Memory (huginn_notes) ───────────────────────────────────────────

export async function saveNote(note) {
  const doc = {
    topic: note.topic || 'general',
    content: note.content,
    tags: note.tags || [],
    createdAt: new Date(),
  };
  const result = await huginnDb().collection('huginn_notes').insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function searchNotes(query, limit = 10) {
  // Text search on content + topic
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return huginnDb().collection('huginn_notes')
    .find({ $or: [{ content: regex }, { topic: regex }] })
    .sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function listNotes(topic, limit = 20) {
  const query = topic ? { topic } : {};
  return huginnDb().collection('huginn_notes')
    .find(query).sort({ createdAt: -1 }).limit(limit).toArray();
}

// ── Conversation Log (huginn_conversations) ─────────────────────────────────

export async function logConversation(session, role, content, meta = {}) {
  return huginnDb().collection('huginn_conversations').insertOne({
    session,
    role,        // 'user' | 'assistant' | 'system'
    content,
    ...meta,
    createdAt: new Date(),
  });
}

export async function getConversationHistory(session, limit = 20) {
  return huginnDb().collection('huginn_conversations')
    .find({ session }).sort({ createdAt: -1 }).limit(limit).toArray()
    .then(docs => docs.reverse()); // chronological order
}

// ── Slab DB Read (read-only MCP for platform data) ──────────────────────────

export async function readSlabCollection(collection, query = {}, opts = {}) {
  const limit = Math.min(opts.limit || 25, 100);
  const projection = opts.fields
    ? Object.fromEntries(opts.fields.map(f => [f, 1]))
    : undefined;
  return getSlabDb().collection(collection)
    .find(query, { projection })
    .sort(opts.sort || { _id: -1 })
    .limit(limit)
    .toArray();
}

export async function readTenantCollection(tenantDbName, collection, query = {}, opts = {}) {
  const limit = Math.min(opts.limit || 25, 100);
  const projection = opts.fields
    ? Object.fromEntries(opts.fields.map(f => [f, 1]))
    : undefined;
  return getTenantDb(tenantDbName).collection(collection)
    .find(query, { projection })
    .sort(opts.sort || { _id: -1 })
    .limit(limit)
    .toArray();
}

export async function listSlabCollections() {
  const db = getSlabDb();
  const collections = await db.listCollections().toArray();
  return collections.map(c => c.name).sort();
}

export async function listTenantCollections(tenantDbName) {
  const db = getTenantDb(tenantDbName);
  const collections = await db.listCollections().toArray();
  return collections.map(c => c.name).sort();
}

export async function getSlabStats() {
  const slab = getSlabDb();
  const [totalTenants, activeTenants, previewTenants, suspendedTenants, signupCount] =
    await Promise.all([
      slab.collection('tenants').countDocuments(),
      slab.collection('tenants').countDocuments({ status: 'active' }),
      slab.collection('tenants').countDocuments({ status: 'preview' }),
      slab.collection('tenants').countDocuments({ status: 'suspended' }),
      slab.collection('signups').countDocuments(),
    ]);
  return { totalTenants, activeTenants, previewTenants, suspendedTenants, signupCount };
}

// ── Codebase Read (read-only, sandboxed to /srv/slab) ───────────────────────

function safePath(relPath) {
  const resolved = path.resolve(SLAB_ROOT, relPath);
  if (!resolved.startsWith(SLAB_ROOT)) throw new Error('Path outside slab root');
  // Block .env and secrets
  const base = path.basename(resolved);
  if (base === '.env' || base === '.env.local') throw new Error('Cannot read secret files');
  return resolved;
}

export async function readFile(relPath, maxLines = 200) {
  const abs = safePath(relPath);
  const content = await fs.readFile(abs, 'utf-8');
  const lines = content.split('\n');
  const truncated = lines.length > maxLines;
  return {
    path: relPath,
    lines: lines.length,
    truncated,
    content: truncated ? lines.slice(0, maxLines).join('\n') + '\n... (truncated)' : content,
  };
}

export async function listDir(relPath = '.', depth = 1) {
  const abs = safePath(relPath);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const type = e.isDirectory() ? 'dir' : 'file';
    result.push({ name: e.name, type });
    if (type === 'dir' && depth > 1) {
      const sub = await listDir(path.join(relPath, e.name), depth - 1);
      for (const s of sub) {
        result.push({ name: `${e.name}/${s.name}`, type: s.type });
      }
    }
  }
  return result;
}

// ── Context Builder (assembles rich context for LLM system prompt) ──────────

export async function fetchWeather() {
  try {
    const geoRes = await fetch('http://ip-api.com/json/?fields=lat,lon,city,regionName', {
      signal: AbortSignal.timeout(3000),
    });
    const geo = await geoRes.json();
    const lat = geo.lat || 40.76, lon = geo.lon || -73.98;
    const loc = geo.city ? `${geo.city}, ${geo.regionName}` : 'Unknown';

    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`,
      { signal: AbortSignal.timeout(5000) }
    );
    const w = await wRes.json();
    const cur = w.current || {};
    const WMO = { 0:'Clear',1:'Mostly Clear',2:'Partly Cloudy',3:'Overcast',45:'Foggy',
      61:'Rain',63:'Rain',65:'Heavy Rain',71:'Snow',73:'Snow',95:'Thunderstorm' };
    return `${Math.round(cur.temperature_2m || 0)}°F, ${WMO[cur.weather_code] || 'Unknown'}, wind ${Math.round(cur.wind_speed_10m || 0)} mph — ${loc}`;
  } catch { return null; }
}

export async function buildHuginnContext(userMessage) {
  const [stats, pendingTasks, recentNotes, tenants, weather] = await Promise.all([
    getSlabStats(),
    listTasks({ status: 'pending', limit: 5 }),
    listNotes(null, 5),
    readSlabCollection('tenants', {}, {
      limit: 10,
      fields: ['domain', 'status', 'brand.name', 'meta.plan', 'meta.ownerEmail'],
    }),
    fetchWeather(),
  ]);

  const taskSummary = pendingTasks.length
    ? pendingTasks.map(t => `- [${t.priority}] ${t.title} (${t.status})`).join('\n')
    : 'No pending tasks.';

  const notesSummary = recentNotes.length
    ? recentNotes.map(n => `- [${n.topic}] ${n.content.slice(0, 120)}`).join('\n')
    : 'No recent notes.';

  const tenantList = tenants
    .map(t => `- ${t.brand?.name || t.domain} (${t.status}, ${t.meta?.plan || 'free'})`)
    .join('\n');

  const weatherLine = weather ? `**Weather:** ${weather}` : '';

  return `## Slab Platform Context (live)
**Stats:** ${stats.totalTenants} tenants (${stats.activeTenants} active, ${stats.previewTenants} preview, ${stats.suspendedTenants} suspended), ${stats.signupCount} signups
${weatherLine}

**Tenants:**
${tenantList}

**Your Pending Tasks:**
${taskSummary}

**Recent Notes:**
${notesSummary}

## Capabilities
You have read access to the Slab database and codebase through the operator.
When you need data, ask the operator to look something up — they can query any collection or read any file.
When you want to remember something, say "TASK:" or "NOTE:" and it will be saved to your huginn_tasks or huginn_notes collections.

## Personality
You are Huginn, the platform intelligence for sLab. Be conversational, direct, and helpful.
Keep responses concise. You can reference real platform data. When you're unsure, say so.`;
}

// ── Intent Parser (detects task/note intents in LLM response) ───────────────

export async function parseAndSaveIntents(responseText, session) {
  const saved = [];

  // Detect TASK: lines
  const taskMatches = responseText.matchAll(/TASK:\s*(.+?)(?:\n|$)/gi);
  for (const m of taskMatches) {
    const title = m[1].trim();
    if (title) {
      const task = await createTask({ title, context: `auto-created from session: ${session}` });
      saved.push({ type: 'task', title, _id: task._id });
    }
  }

  // Detect NOTE: lines
  const noteMatches = responseText.matchAll(/NOTE:\s*(.+?)(?:\n|$)/gi);
  for (const m of noteMatches) {
    const content = m[1].trim();
    if (content) {
      const note = await saveNote({ content, topic: 'auto', tags: ['huginn-auto'] });
      saved.push({ type: 'note', content: content.slice(0, 80), _id: note._id });
    }
  }

  return saved;
}
