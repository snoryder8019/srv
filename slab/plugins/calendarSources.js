/**
 * Slab — Platform calendar: source registry + aggregation
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE timeline for the whole business. Every module that owns a dated object
 * registers a SOURCE here; the calendar surface, the dashboard marquee, and any
 * future planner all read through loadEvents() and never touch the collections
 * directly. Adding "X should show on the calendar" is a single entry below.
 *
 * This mirrors how featureRegistry.js drives nav and pageSources.js drives page
 * pipes: registry-driven, not hardcoded per surface.
 *
 * NORMALIZED EVENT
 *   {
 *     id        stable string id ("<source>:<mongoId>[:variant]")
 *     source    registry key ('social', 'invoices', …)
 *     kind      sub-type within the source ('scheduled' | 'due' | 'sent' | …)
 *     title     one line, plain text
 *     at        Date — when it sits on the timeline
 *     endAt     Date | null — for durations (meetings, jobs, OOO)
 *     allDay    true → renders in the day's all-day band, no time shown
 *     status    free-form badge text ('scheduled', 'overdue', 'done', …)
 *     tone      'plan' | 'done' | 'warn' | 'muted' — drives the visual treatment
 *     url       where clicking the chip goes (the object's own editor)
 *     actions   [{ label, url, method }] — the chip's ⋯ menu
 *     meta      source-specific extras the views may show (amount, client, …)
 *   }
 *
 * Loaders are best-effort: a source that throws is skipped and reported in
 * `failed[]` rather than blanking the whole calendar. A collection that doesn't
 * exist yet simply returns nothing.
 */

import { ObjectId } from 'mongodb';
import { observancesBetween } from './autoSocial.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const asDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const clip = (s, n = 90) => {
  const t = String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const oidStr = (v) => (v == null ? '' : String(v));

/** Local-day key, 'YYYY-MM-DD'. All bucketing is local-time, matching the UI. */
export function dayKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Safe range read on a collection that may not exist in this tenant DB yet. */
async function findRange(db, coll, query, opts = {}) {
  try {
    let cur = db.collection(coll).find(query);
    if (opts.sort) cur = cur.sort(opts.sort);
    cur = cur.limit(opts.limit || 400);
    if (opts.project) cur = cur.project(opts.project);
    return await cur.toArray();
  } catch {
    return [];
  }
}

const between = (field, start, end) => ({ [field]: { $gte: start, $lt: end } });

/**
 * Batch-resolve display names for a set of ids → Map<idString, name>.
 * One query per collection instead of one per row: the tasks lane joins both
 * projects and clients, and a busy month would otherwise fan out badly.
 * `fields` is tried in order — clients store their label under several keys
 * depending on how the record was created.
 */
async function lookupNames(db, coll, ids, fields) {
  const out = new Map();
  const uniq = [...new Set((ids || []).map(oidStr).filter(Boolean))];
  if (!uniq.length) return out;
  const objectIds = [];
  for (const id of uniq) { try { objectIds.push(new ObjectId(id)); } catch { /* non-oid key */ } }
  if (!objectIds.length) return out;
  try {
    const rows = await db.collection(coll).find({ _id: { $in: objectIds } })
      .project(Object.fromEntries(fields.map((f) => [f, 1]))).toArray();
    for (const r of rows) {
      const name = fields.map((f) => r[f]).find((v) => v && String(v).trim());
      if (name) out.set(String(r._id), String(name).trim());
    }
  } catch { /* collection may not exist */ }
  return out;
}

// ── Source registry ──────────────────────────────────────────────────────────
// `feature` names the featureRegistry key that gates the module, so a tenant
// without Social never loads (or sees a filter chip for) social events.
// `defaultOff` sources are registered and filterable but off until asked for —
// used for the high-volume feeds (mail) that would otherwise bury everything.

export const CALENDAR_SOURCES = [
  {
    key: 'social', label: 'Social', icon: '&#128227;', color: '#7C5CBF', group: 'Marketing',
    feature: 'social',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'social_posts', {
        archived: { $ne: true },
        $or: [between('scheduledAt', start, end), between('publishedAt', start, end)],
      }, { sort: { scheduledAt: 1 }, limit: 500 });
      const out = [];
      for (const p of docs) {
        const posted = asDate(p.publishedAt);
        const sched = asDate(p.scheduledAt);
        const at = (posted && posted >= start && posted < end) ? posted : sched;
        if (!at || at < start || at >= end) continue;
        const done = !!posted;
        out.push({
          id: `social:${oidStr(p._id)}`,
          source: 'social', kind: done ? 'published' : 'scheduled',
          title: clip(p.body || 'Social post', 80),
          at, endAt: null, allDay: false,
          status: done ? 'posted' : (p.status || 'scheduled'),
          tone: done ? 'done' : 'plan',
          url: `/admin/social?tab=compose&edit=${oidStr(p._id)}`,
          meta: { platforms: (p.platforms || []).join(', '), thumb: (p.mediaUrls || [])[0] || null },
          actions: [
            { label: 'Edit post', url: `/admin/social?tab=compose&edit=${oidStr(p._id)}` },
            { label: 'Open Social', url: '/admin/social?tab=calendar' },
          ],
        });
      }
      return out;
    },
  },

  {
    key: 'blog', label: 'Blog & Content', icon: '&#9997;', color: '#2E7D5B', group: 'Marketing',
    feature: 'blog',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'blog', {
        $or: [between('scheduledAt', start, end), between('publishedAt', start, end)],
      }, { sort: { scheduledAt: 1 }, limit: 300 });
      return docs.map((b) => {
        const pub = asDate(b.publishedAt);
        const sched = asDate(b.scheduledAt);
        const live = !!pub && pub >= start && pub < end && b.status === 'published';
        const at = live ? pub : (sched || pub);
        if (!at) return null;
        return {
          id: `blog:${oidStr(b._id)}`,
          source: 'blog', kind: live ? 'published' : 'scheduled',
          title: clip(b.title || 'Untitled post', 80),
          at, endAt: null, allDay: true,
          status: live ? 'published' : (b.status || 'draft'),
          tone: live ? 'done' : 'plan',
          url: `/admin/blog/${oidStr(b._id)}/edit`,
          meta: { contentType: b.contentType || 'blog', category: b.category || '' },
          actions: [
            { label: '✎ Edit post', url: `/admin/blog/${oidStr(b._id)}/edit` },
            // A scheduled (not-yet-live) post can be pulled back off the calendar
            // straight from the chip — the same in-place control social posts get.
            ...(!live ? [{ label: 'Unschedule', url: `/admin/blog/${oidStr(b._id)}/unschedule`, method: 'post' }] : []),
            { label: 'All content', url: '/admin/blog' },
          ],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'email', label: 'Email Campaigns', icon: '@', color: '#B7791F', group: 'Marketing',
    feature: 'email-marketing',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'campaigns', {
        $or: [between('scheduledAt', start, end), between('sentAt', start, end)],
      }, { sort: { scheduledAt: 1 }, limit: 200 });
      return docs.map((c) => {
        const sent = asDate(c.sentAt);
        const sched = asDate(c.scheduledAt);
        const at = (sent && sent >= start && sent < end) ? sent : sched;
        if (!at) return null;
        return {
          id: `email:${oidStr(c._id)}`,
          source: 'email', kind: sent ? 'sent' : 'scheduled',
          title: clip(c.subject || 'Campaign', 80),
          at, endAt: null, allDay: false,
          status: sent ? `sent · ${c.sentCount || 0}` : (c.status || 'scheduled'),
          tone: sent ? 'done' : 'plan',
          url: `/admin/email-marketing/campaigns/${oidStr(c._id)}`,
          meta: { audience: c.targetFunnel || 'all' },
          actions: [
            { label: 'Open campaign', url: `/admin/email-marketing/campaigns/${oidStr(c._id)}` },
            { label: 'Email Marketing', url: '/admin/email-marketing?tab=campaigns' },
          ],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'meetings', label: 'Meetings', icon: '&#9707;', color: '#1C6FB8', group: 'Operations',
    feature: 'meetings',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'meetings', between('scheduledAt', start, end),
        { sort: { scheduledAt: 1 }, limit: 300 });
      return docs.map((m) => {
        const at = asDate(m.scheduledAt);
        if (!at) return null;
        const mins = Number(m.durationMinutes) || 30;
        return {
          id: `meetings:${oidStr(m._id)}`,
          source: 'meetings', kind: 'meeting',
          title: clip(m.title || 'Meeting', 80),
          at, endAt: new Date(at.getTime() + mins * 60000), allDay: false,
          status: m.status || 'active',
          tone: at < new Date() ? 'muted' : 'plan',
          url: `/admin/meetings`,
          meta: { minutes: mins, participants: (m.participants || []).length,
                  clientId: oidStr((m.tags && m.tags.clients && m.tags.clients[0]) || '') },
          actions: [
            { label: 'Open meetings', url: '/admin/meetings' },
            ...(m.token ? [{ label: 'Join room', url: `/meet/${m.token}` }] : []),
          ],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'field', label: 'Field Jobs', icon: '&#128205;', color: '#0F766E', group: 'Operations',
    feature: 'field',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'field_jobs', between('scheduledAt', start, end),
        { sort: { scheduledAt: 1 }, limit: 300 });
      return docs.map((j) => {
        const at = asDate(j.scheduledAt);
        if (!at) return null;
        const mins = Number(j.estimatedMinutes) || 60;
        return {
          id: `field:${oidStr(j._id)}`,
          source: 'field', kind: 'job',
          title: clip(j.title || 'Job', 80),
          at, endAt: new Date(at.getTime() + mins * 60000), allDay: false,
          status: j.status || 'scheduled',
          tone: j.status === 'complete' ? 'done' : 'plan',
          url: `/admin/field/jobs/${oidStr(j._id)}`,
          meta: { address: clip(j.address, 50), minutes: mins, clientId: oidStr(j.clientId) },
          actions: [
            { label: 'Open job', url: `/admin/field/jobs/${oidStr(j._id)}` },
            { label: 'Dispatch board', url: '/admin/field' },
          ],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'invoices', label: 'Invoices', icon: '$', color: '#B45309', group: 'Money',
    feature: 'bookkeeping',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'invoices', {
        $or: [between('dueDate', start, end), between('emailSentAt', start, end)],
      }, { sort: { dueDate: 1 }, limit: 400 });
      const now = new Date();
      const out = [];
      for (const inv of docs) {
        const due = asDate(inv.dueDate);
        const sent = asDate(inv.emailSentAt);
        const paid = String(inv.status || '').toLowerCase() === 'paid';
        if (sent && sent >= start && sent < end) {
          out.push({
            id: `invoices:${oidStr(inv._id)}:sent`,
            source: 'invoices', kind: 'sent',
            title: `Sent ${inv.invoiceNumber || 'invoice'} — ${clip(inv.title, 50)}`,
            at: sent, endAt: null, allDay: false,
            status: 'sent', tone: 'done',
            url: '/admin/bookkeeping',
            meta: { amount: Number(inv.amount) || 0, clientId: oidStr(inv.clientId) },
            actions: [{ label: 'Open bookkeeping', url: '/admin/bookkeeping' }],
          });
        }
        if (due && due >= start && due < end) {
          const overdue = !paid && due < now;
          out.push({
            id: `invoices:${oidStr(inv._id)}:due`,
            source: 'invoices', kind: 'due',
            title: `${inv.invoiceNumber || 'Invoice'} due — ${clip(inv.title, 50)}`,
            at: due, endAt: null, allDay: true,
            status: paid ? 'paid' : (overdue ? 'overdue' : 'due'),
            tone: paid ? 'done' : (overdue ? 'warn' : 'plan'),
            url: '/admin/bookkeeping',
            meta: { amount: Number(inv.amount) || 0, clientId: oidStr(inv.clientId) },
            actions: [{ label: 'Open bookkeeping', url: '/admin/bookkeeping' }],
          });
        }
      }
      return out;
    },
  },

  {
    key: 'engagements', label: 'Engagements', icon: '&#9998;', color: '#5B21B6', group: 'Money',
    feature: 'clients',
    async load(db, { start, end }) {
      const docs = await findRange(db, 'engagements', {
        $or: [between('sentAt', start, end), between('validUntil', start, end), between('acknowledgedAt', start, end)],
      }, { sort: { sentAt: 1 }, limit: 200 });
      const out = [];
      for (const e of docs) {
        const push = (at, kind, title, tone, status) => {
          if (!at || at < start || at >= end) return;
          out.push({
            id: `engagements:${oidStr(e._id)}:${kind}`,
            source: 'engagements', kind, title, at, endAt: null, allDay: true,
            status, tone,
            url: `/admin/clients/${oidStr(e.clientId)}/engagements/${oidStr(e._id)}`,
            meta: { clientId: oidStr(e.clientId) },
            actions: [{ label: 'Open engagement', url: `/admin/clients/${oidStr(e.clientId)}/engagements/${oidStr(e._id)}` }],
          });
        };
        const label = clip(e.title || 'Engagement', 50);
        push(asDate(e.sentAt), 'sent', `Sent — ${label}`, 'done', 'sent');
        push(asDate(e.acknowledgedAt), 'signed', `Signed — ${label}`, 'done', 'signed');
        push(asDate(e.validUntil), 'expires', `Expires — ${label}`, 'warn', 'expiring');
      }
      return out;
    },
  },

  {
    key: 'mail', label: 'Client Email', icon: '&#9993;', color: '#475569', group: 'Operations',
    feature: 'clients', defaultOff: true,
    async load(db, { start, end }) {
      const docs = await findRange(db, 'client_emails', between('sentAt', start, end),
        { sort: { sentAt: -1 }, limit: 300 });
      return docs.map((m) => {
        const at = asDate(m.sentAt) || asDate(m.receivedAt);
        if (!at) return null;
        const inbound = m.direction === 'inbound';
        return {
          id: `mail:${oidStr(m._id)}`,
          source: 'mail', kind: inbound ? 'inbound' : 'outbound',
          title: `${inbound ? '↓' : '↑'} ${clip(m.subject || '(no subject)', 70)}`,
          at, endAt: null, allDay: false,
          status: inbound ? 'received' : 'sent',
          tone: 'muted',
          url: m.clientId ? `/admin/clients/${oidStr(m.clientId)}` : '/admin/clients',
          meta: { who: clip(inbound ? m.from : m.to, 40), clientId: oidStr(m.clientId) },
          actions: [{ label: 'Open client', url: m.clientId ? `/admin/clients/${oidStr(m.clientId)}` : '/admin/clients' }],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'tasks', label: 'Tasks', icon: '&#9745;', color: '#1C2B4A', group: 'Workflow',
    async load(db, { start, end }) {
      // A task now has a WINDOW. Overlap test, not a point-in-range test, or a
      // task that starts before the month and ends inside it would vanish.
      const docs = await findRange(db, 'calendar_tasks', {
        archived: { $ne: true },
        dueAt: { $gte: start },
        $or: [{ startAt: { $lt: end } }, { startAt: null }, { startAt: { $exists: false } }],
      }, { sort: { dueAt: 1 }, limit: 400 });
      if (!docs.length) return [];
      // Resolve project + client names in two lookups rather than per-task, so a
      // busy month doesn't turn into hundreds of round-trips.
      const [projects, clients] = await Promise.all([
        lookupNames(db, 'calendar_projects', docs.map((t) => t.projectId), ['name']),
        lookupNames(db, 'clients', docs.map((t) => t.clientId), ['name', 'businessName', 'company', 'email']),
      ]);
      const now = new Date();
      return docs.map((t) => {
        const due = asDate(t.dueAt);
        if (!due) return null;
        // Legacy rows (dueAt only) read as a task that starts and ends the same day.
        const at = asDate(t.startAt) || due;
        if (at >= end || due < start) return null;
        const done = t.status === 'done';
        const projectName = projects.get(oidStr(t.projectId)) || t.project || '';
        const clientName = clients.get(oidStr(t.clientId)) || '';
        return {
          id: `tasks:${oidStr(t._id)}`,
          source: 'tasks', kind: 'task',
          // The client is the thing you scan for on a busy day, so it leads.
          title: clip((clientName ? clientName + ' — ' : '') + (t.title || 'Task'), 90),
          at, endAt: due, allDay: !!t.allDay,
          // Everything the edit modal needs, so opening it costs no round-trip.
          edit: {
            kind: 'task', id: oidStr(t._id),
            title: t.title || '', notes: t.notes || '',
            assignee: t.assignee || '', status: t.status || 'open',
            projectId: oidStr(t.projectId), clientId: oidStr(t.clientId),
            startAt: at.toISOString(), dueAt: due.toISOString(), allDay: !!t.allDay,
          },
          status: done ? 'done' : (at < now ? 'overdue' : (t.status || 'open')),
          tone: done ? 'done' : (at < now ? 'warn' : 'plan'),
          url: `/admin/calendar?focus=${dayKey(at)}`,
          meta: {
            project: projectName, client: clientName,
            projectId: oidStr(t.projectId), clientId: oidStr(t.clientId),
            assignee: t.assignee || '', notes: clip(t.notes, 120),
          },
          actions: [
            { label: '\u270e Edit task', edit: true },
            ...(done
              ? [{ label: 'Reopen', url: `/admin/calendar/tasks/${oidStr(t._id)}/reopen`, method: 'post' }]
              : [{ label: 'Mark done', url: `/admin/calendar/tasks/${oidStr(t._id)}/done`, method: 'post' }]),
            ...(t.clientId ? [{ label: 'Open client', url: `/admin/clients/${oidStr(t.clientId)}` }] : []),
            ...(t.projectId ? [{ label: 'Project: ' + clip(projectName, 28), url: `/admin/calendar?project=${oidStr(t.projectId)}` }] : []),
            { label: 'Delete', url: `/admin/calendar/tasks/${oidStr(t._id)}/delete`, method: 'post' },
          ],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'projects', label: 'Projects', icon: '&#9634;', color: '#0369A1', group: 'Workflow',
    async load(db, { start, end }) {
      // A project shows twice at most: its kickoff and its due date. The tasks
      // underneath it carry the day-to-day — this lane is the milestone view.
      const docs = await findRange(db, 'calendar_projects', {
        archived: { $ne: true },
        $or: [between('startAt', start, end), between('dueAt', start, end)],
      }, { sort: { dueAt: 1 }, limit: 200 });
      if (!docs.length) return [];
      const clients = await lookupNames(db, 'clients', docs.map((p) => p.clientId), ['name', 'businessName', 'company', 'email']);
      const now = new Date();
      const out = [];
      for (const p of docs) {
        const clientName = clients.get(oidStr(p.clientId)) || '';
        const label = clip((clientName ? clientName + ' — ' : '') + (p.name || 'Project'), 80);
        const done = p.status === 'complete';
        const mk = (at, kind, prefix, tone) => {
          if (!at || at < start || at >= end) return;
          out.push({
            id: `projects:${oidStr(p._id)}:${kind}`,
            source: 'projects', kind,
            title: `${prefix} ${label}`,
            at, endAt: null, allDay: true,
            status: done ? 'complete' : (p.status || 'active'),
            tone: done ? 'done' : tone,
            url: `/admin/calendar?project=${oidStr(p._id)}`,
            meta: { client: clientName, notes: clip(p.notes, 120),
                    projectId: oidStr(p._id), clientId: oidStr(p.clientId) },
            actions: [
              { label: 'Filter to this project', url: `/admin/calendar?project=${oidStr(p._id)}` },
              ...(p.clientId ? [{ label: 'Open client', url: `/admin/clients/${oidStr(p.clientId)}` }] : []),
              ...(done
                ? [{ label: 'Reopen project', url: `/admin/calendar/projects/${oidStr(p._id)}/reopen`, method: 'post' }]
                : [{ label: 'Complete project', url: `/admin/calendar/projects/${oidStr(p._id)}/complete`, method: 'post' }]),
              { label: 'Delete project', url: `/admin/calendar/projects/${oidStr(p._id)}/delete`, method: 'post' },
            ],
          });
        };
        mk(asDate(p.startAt), 'start', '▶', 'plan');
        mk(asDate(p.dueAt), 'due', '◼', (!done && asDate(p.dueAt) < now) ? 'warn' : 'plan');
      }
      return out;
    },
  },

  {
    key: 'blocks', label: 'Out of Office', icon: '&#127796;', color: '#9CA3AF', group: 'Workflow',
    async load(db, { start, end }) {
      // A block overlaps the window when it starts before the end AND ends after
      // the start — a multi-day OOO must show even when neither edge is in range.
      const docs = await findRange(db, 'calendar_blocks', {
        archived: { $ne: true }, startAt: { $lt: end }, endAt: { $gte: start },
      }, { sort: { startAt: 1 }, limit: 200 });
      return docs.map((b) => {
        const at = asDate(b.startAt);
        if (!at) return null;
        return {
          id: `blocks:${oidStr(b._id)}`,
          source: 'blocks', kind: b.kind || 'ooo',
          title: clip(b.title || 'Out of office', 80),
          at, endAt: asDate(b.endAt), allDay: true,
          status: b.kind === 'holiday' ? 'closed' : 'away',
          tone: 'muted',
          url: `/admin/calendar?focus=${dayKey(at)}`,
          meta: { who: b.who || 'Everyone', notes: clip(b.notes, 120) },
          actions: [{ label: 'Delete', url: `/admin/calendar/blocks/${oidStr(b._id)}/delete`, method: 'post' }],
        };
      }).filter(Boolean);
    },
  },

  {
    key: 'holidays', label: 'Holidays', icon: '&#127881;', color: '#BE123C', group: 'Workflow',
    async load(_db, { start, end }) {
      return observancesBetween(start, end).map((o) => ({
        id: `holidays:${dayKey(o.date)}:${o.name.replace(/\W+/g, '')}`,
        source: 'holidays', kind: 'observance',
        title: o.name,
        at: o.date, endAt: null, allDay: true,
        status: '', tone: 'muted',
        url: `/admin/calendar?focus=${dayKey(o.date)}`,
        meta: {},
        actions: [
          { label: 'Plan a post', url: `/admin/social?tab=compose&seed=${encodeURIComponent(o.name)}` },
          { label: 'Plan a campaign', url: `/admin/email-marketing?tab=campaigns` },
        ],
      }));
    },
  },
];

export const SOURCE_MAP = Object.fromEntries(CALENDAR_SOURCES.map((s) => [s.key, s]));
export const SOURCE_GROUPS = [...new Set(CALENDAR_SOURCES.map((s) => s.group))];

/** Registry rows the caller may see, given the tenant's enabled feature keys. */
export function visibleSources(enabledFeatureKeys) {
  if (!enabledFeatureKeys) return CALENDAR_SOURCES;
  const has = new Set(enabledFeatureKeys);
  return CALENDAR_SOURCES.filter((s) => !s.feature || has.has(s.feature));
}

/** Default-on source keys (everything registered except the noisy feeds). */
export function defaultSourceKeys(sources = CALENDAR_SOURCES) {
  return sources.filter((s) => !s.defaultOff).map((s) => s.key);
}

/**
 * Aggregate every requested source across [start, end).
 * Returns { events, byDay, counts, failed }.
 *   byDay  — Map keyed 'YYYY-MM-DD' → events sorted by time (all-day first)
 *   counts — { [sourceKey]: n } for the filter chips
 *   failed — source keys whose loader threw (surfaced, never silent)
 */
export async function loadEvents(db, { start, end, sources = null, features = null, projectId = null, clientId = null } = {}) {
  const allowed = visibleSources(features);
  let wanted = sources ? allowed.filter((s) => sources.includes(s.key)) : allowed.filter((s) => !s.defaultOff);

  // A project filter is inherently a workflow question — only the lanes that
  // carry a projectId can answer it, so don't pay to load the rest. A CLIENT
  // filter is genuinely cross-cutting (jobs, invoices, meetings, mail all carry
  // one), so every lane still loads and the match happens per-event below.
  if (projectId) wanted = wanted.filter((s) => s.key === 'tasks' || s.key === 'projects');

  const settled = await Promise.all(wanted.map(async (s) => {
    try { return { key: s.key, rows: (await s.load(db, { start, end })) || [] }; }
    catch (e) {
      console.warn(`[calendar] source "${s.key}" failed:`, e.message);
      return { key: s.key, rows: [], failed: true };
    }
  }));

  const pid = oidStr(projectId), cid = oidStr(clientId);
  const matches = (ev) => {
    if (pid && oidStr(ev.meta && ev.meta.projectId) !== pid) return false;
    if (cid && oidStr(ev.meta && ev.meta.clientId) !== cid) return false;
    return true;
  };

  const events = [];
  const counts = {};
  const failed = [];
  for (const r of settled) {
    if (r.failed) failed.push(r.key);
    const kept = r.rows.filter((ev) => ev && ev.at && matches(ev));
    counts[r.key] = kept.length;   // chips count what's SHOWN, not what was fetched
    for (const ev of kept) events.push(ev);
  }

  events.sort((a, b) => (a.allDay === b.allDay ? a.at - b.at : (a.allDay ? -1 : 1)));

  const byDay = new Map();
  for (const ev of events) {
    // A ranged event (OOO, multi-day block) lands on every day it covers, capped
    // so a stray decade-long range can't blow the grid up.
    const last = ev.endAt && ev.endAt > ev.at ? ev.endAt : ev.at;
    const cursor = new Date(ev.at.getFullYear(), ev.at.getMonth(), ev.at.getDate());
    let guard = 0;
    while (cursor <= last && guard++ < 400) {
      if (cursor >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) && cursor < end) {
        const k = dayKey(cursor);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(ev);
      }
      cursor.setDate(cursor.getDate() + 1);
      if (!ev.endAt) break;
    }
  }
  for (const rows of byDay.values()) {
    rows.sort((a, b) => (a.allDay === b.allDay ? a.at - b.at : (a.allDay ? -1 : 1)));
  }

  return { events, byDay, counts, failed };
}

// ── Workflow objects owned by the calendar itself ────────────────────────────
// Tasks and blocks have no home module — the calendar IS their module.

const toOid = (v) => {
  const s = oidStr(v).trim();
  if (!s) return null;
  try { return new ObjectId(s); } catch { return null; }
};

/**
 * Resolve a task's window from form input. A task has a START and an END; the
 * end is what "due" always meant, so legacy rows (dueAt only) keep working and
 * simply read as a task that starts and ends the same day.
 */
function taskWindow({ startAt, dueAt, allDay }) {
  const due = asDate(dueAt);
  if (!due) throw Object.assign(new Error('Task needs a due date'), { status: 400 });
  let start = asDate(startAt) || due;
  // A backwards window is a typo, not an intent — clamp instead of storing a
  // range that would render as a negative-width bar.
  if (start > due) start = due;
  return { startAt: start, dueAt: due, allDay: !!allDay };
}

/** Shared shaping for create + update, including the project→client inheritance. */
async function taskFields(db, input) {
  const pid = toOid(input.projectId);
  let cid = toOid(input.clientId);
  // A task attached to a project but not a client inherits the PROJECT's client
  // — the project is the thing that owns the relationship, so the two can never
  // silently disagree.
  if (pid && !cid) {
    try {
      const p = await db.collection('calendar_projects').findOne({ _id: pid }, { projection: { clientId: 1 } });
      if (p && p.clientId) cid = toOid(p.clientId);
    } catch { /* non-fatal */ }
  }
  const win = taskWindow(input);
  return {
    ...win,
    projectId: pid,
    clientId: cid,
    project: String(input.project || '').trim().slice(0, 80),   // legacy free-text label
    assignee: String(input.assignee || '').trim().slice(0, 120),
    notes: String(input.notes || '').trim().slice(0, 2000),
  };
}

export async function createTask(db, input) {
  const t = String(input.title || '').trim();
  if (!t) throw Object.assign(new Error('Task needs a title'), { status: 400 });
  const now = new Date();
  const doc = {
    title: t.slice(0, 200),
    ...(await taskFields(db, input)),
    status: 'open',
    archived: false,
    createdBy: input.createdBy || null,
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection('calendar_tasks').insertOne(doc);
  return { _id: r.insertedId, ...doc };
}

/** Full edit of an existing task — same validation path as create. */
export async function updateTask(db, id, input) {
  const _id = new ObjectId(String(id));
  const t = String(input.title || '').trim();
  if (!t) throw Object.assign(new Error('Task needs a title'), { status: 400 });
  const $set = {
    title: t.slice(0, 200),
    ...(await taskFields(db, input)),
    updatedAt: new Date(),
  };
  if (input.status === 'open' || input.status === 'done') {
    $set.status = input.status;
    $set.completedAt = input.status === 'done' ? new Date() : null;
  }
  const r = await db.collection('calendar_tasks').updateOne({ _id, archived: { $ne: true } }, { $set });
  if (!r.matchedCount) throw Object.assign(new Error('Task not found'), { status: 404 });
  return $set;
}

/** One task, for the edit form. */
export async function getTask(db, id) {
  try { return await db.collection('calendar_tasks').findOne({ _id: new ObjectId(String(id)) }); }
  catch { return null; }
}

// ── Projects ─────────────────────────────────────────────────────────────────
// A project is a named body of work owned by a client, with tasks hanging off
// it. It lives on the calendar (not in Clients) because its whole point is
// dates — kickoff, due, and everything scheduled in between.

export async function createProject(db, { name, clientId, startAt, dueAt, notes, createdBy }) {
  const n = String(name || '').trim();
  if (!n) throw Object.assign(new Error('Project needs a name'), { status: 400 });
  const now = new Date();
  const doc = {
    name: n.slice(0, 160),
    clientId: toOid(clientId),
    startAt: asDate(startAt),
    dueAt: asDate(dueAt),
    notes: String(notes || '').trim().slice(0, 2000),
    status: 'active',
    archived: false,
    createdBy: createdBy || null,
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection('calendar_projects').insertOne(doc);
  return { _id: r.insertedId, ...doc };
}

export async function setProjectStatus(db, id, status) {
  await db.collection('calendar_projects').updateOne(
    { _id: new ObjectId(String(id)) },
    { $set: { status, completedAt: status === 'complete' ? new Date() : null, updatedAt: new Date() } });
}

export async function archiveProject(db, id) {
  const _id = new ObjectId(String(id));
  await db.collection('calendar_projects').updateOne({ _id }, { $set: { archived: true, updatedAt: new Date() } });
  // Tasks outlive their project — detach rather than orphan them onto a project
  // that no longer renders.
  await db.collection('calendar_tasks').updateMany({ projectId: _id }, { $set: { projectId: null, updatedAt: new Date() } });
}

/** Active projects with their client's display name, for pickers and filters. */
export async function listProjects(db, { includeComplete = true, limit = 200 } = {}) {
  let rows = [];
  try {
    const q = { archived: { $ne: true } };
    if (!includeComplete) q.status = { $ne: 'complete' };
    rows = await db.collection('calendar_projects').find(q).sort({ createdAt: -1 }).limit(limit).toArray();
  } catch { return []; }
  const clients = await lookupNames(db, 'clients', rows.map((p) => p.clientId), ['name', 'businessName', 'company', 'email']);
  return rows.map((p) => ({ ...p, clientName: clients.get(oidStr(p.clientId)) || '' }));
}

/**
 * Assignable people on this tenant — every user on the platform, labelled by
 * display name with the email as the stored value. The task form pairs this
 * with a free-text input (datalist) so an assignee can be a real platform user
 * OR anyone else: a subcontractor, a client contact, a name on a whiteboard.
 */
export async function listAssigneeOptions(db, limit = 300) {
  try {
    const rows = await db.collection('users')
      .find({}, { projection: { displayName: 1, name: 1, email: 1, isAdmin: 1, fieldEnabled: 1 } })
      .limit(limit).toArray();
    return rows
      .map((u) => {
        const name = [u.displayName, u.name].find((v) => v && String(v).trim()) || '';
        const email = String(u.email || '').trim();
        return {
          value: email || name,
          label: name && email ? `${name} (${email})` : (name || email),
          role: u.isAdmin ? 'admin' : (u.fieldEnabled ? 'field' : 'user'),
        };
      })
      .filter((u) => u.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch { return []; }
}

/** Client list for the task/project pickers — id + best available label. */
export async function listClientOptions(db, limit = 500) {
  try {
    const rows = await db.collection('clients')
      .find({}, { projection: { name: 1, businessName: 1, company: 1, email: 1 } })
      .limit(limit).toArray();
    return rows
      .map((c) => ({
        id: String(c._id),
        label: [c.name, c.businessName, c.company, c.email].find((v) => v && String(v).trim()) || 'Unnamed client',
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch { return []; }
}

export async function setTaskStatus(db, id, status) {
  const _id = new ObjectId(String(id));
  await db.collection('calendar_tasks').updateOne({ _id }, {
    $set: { status, completedAt: status === 'done' ? new Date() : null, updatedAt: new Date() },
  });
}

export async function archiveTask(db, id) {
  await db.collection('calendar_tasks').updateOne(
    { _id: new ObjectId(String(id)) },
    { $set: { archived: true, updatedAt: new Date() } });
}

export async function createBlock(db, { title, startAt, endAt, kind, who, notes, createdBy }) {
  const s = asDate(startAt);
  if (!s) throw Object.assign(new Error('Block needs a start date'), { status: 400 });
  const e = asDate(endAt) || s;
  const now = new Date();
  const doc = {
    title: String(title || 'Out of office').trim().slice(0, 200),
    startAt: s, endAt: e < s ? s : e,
    kind: ['ooo', 'holiday', 'busy'].includes(kind) ? kind : 'ooo',
    who: String(who || '').trim().slice(0, 120) || 'Everyone',
    notes: String(notes || '').trim().slice(0, 1000),
    archived: false,
    createdBy: createdBy || null,
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection('calendar_blocks').insertOne(doc);
  return { _id: r.insertedId, ...doc };
}

export async function archiveBlock(db, id) {
  await db.collection('calendar_blocks').updateOne(
    { _id: new ObjectId(String(id)) },
    { $set: { archived: true, updatedAt: new Date() } });
}

// ── Range maths for the four views ───────────────────────────────────────────
// One place decides what "day / week / month / year" means, so the route, the
// marquee, and any future export all agree on the boundaries.

export const VIEWS = ['day', 'week', 'month', 'year'];

export function resolveRange(view, anchorDate) {
  const a = anchorDate instanceof Date ? new Date(anchorDate) : new Date();
  a.setHours(0, 0, 0, 0);
  let start, end, label, prev, next;

  if (view === 'day') {
    start = new Date(a);
    end = new Date(a); end.setDate(end.getDate() + 1);
    label = a.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    prev = new Date(a); prev.setDate(prev.getDate() - 1);
    next = new Date(a); next.setDate(next.getDate() + 1);
  } else if (view === 'week') {
    start = new Date(a); start.setDate(start.getDate() - start.getDay());
    end = new Date(start); end.setDate(end.getDate() + 7);
    const lastDay = new Date(end); lastDay.setDate(lastDay.getDate() - 1);
    label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    prev = new Date(start); prev.setDate(prev.getDate() - 7);
    next = new Date(start); next.setDate(next.getDate() + 7);
  } else if (view === 'year') {
    start = new Date(a.getFullYear(), 0, 1);
    end = new Date(a.getFullYear() + 1, 0, 1);
    label = String(a.getFullYear());
    prev = new Date(a.getFullYear() - 1, 0, 1);
    next = new Date(a.getFullYear() + 1, 0, 1);
  } else {
    start = new Date(a.getFullYear(), a.getMonth(), 1);
    end = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    prev = new Date(a.getFullYear(), a.getMonth() - 1, 1);
    next = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  }
  return { start, end, label, prev, next, today: new Date() };
}

/** Month-grid weeks (leading/trailing blanks) for a month range. */
export function monthWeeks(start) {
  const y = start.getFullYear(), m = start.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: new Date(y, m, d), key: dayKey(new Date(y, m, d)) });
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * ── Multi-day spans ─────────────────────────────────────────────────────────
 * An event whose window covers more than one calendar day renders as a
 * CONTINUOUS BAR across the grid rather than as a chip repeated on each day —
 * that's what makes a range legible at a glance. Tasks, projects and
 * out-of-office blocks all qualify; anything with a same-day window stays a
 * chip. `spansDays` is the single predicate both the aggregator and the views
 * use, so the two can never disagree about which events are bars.
 */
export function spansDays(ev) {
  if (!ev || !ev.endAt) return false;
  return dayKey(ev.endAt) !== dayKey(ev.at);
}

const dayIndexBetween = (from, to) => Math.round(
  (new Date(to.getFullYear(), to.getMonth(), to.getDate()) -
   new Date(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);

/**
 * Lay spanning events out across ONE row of `cols` days starting at `rowStart`.
 * Returns [{ ev, colStart, colEnd, lane, clipLeft, clipRight }] where colStart /
 * colEnd are 0-based inclusive column indexes, and clipLeft/clipRight mark a bar
 * that continues past this row (so the view can square that end off).
 *
 * Lanes are assigned greedily by start then length: the earliest, longest bar
 * takes the top lane, which keeps a row stable as you page around.
 */
export function layoutSpans(events, rowStart, cols = 7) {
  const rowEnd = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + cols);
  const items = (events || [])
    .filter(spansDays)
    .filter((ev) => ev.at < rowEnd && ev.endAt >= rowStart)
    .map((ev) => {
      const rawStart = dayIndexBetween(rowStart, ev.at);
      const rawEnd = dayIndexBetween(rowStart, ev.endAt);
      return {
        ev,
        colStart: Math.max(0, rawStart),
        colEnd: Math.min(cols - 1, rawEnd),
        clipLeft: rawStart < 0,
        clipRight: rawEnd > cols - 1,
      };
    })
    .filter((it) => it.colEnd >= it.colStart)
    .sort((a, b) => (a.colStart - b.colStart) || ((b.colEnd - b.colStart) - (a.colEnd - a.colStart)));

  const lanes = [];   // lanes[i] = last occupied column index in lane i
  for (const it of items) {
    let lane = 0;
    while (lanes[lane] !== undefined && lanes[lane] >= it.colStart) lane++;
    lanes[lane] = it.colEnd;
    it.lane = lane;
  }
  return { items, laneCount: lanes.length };
}

/** Day keys covered by a spanning event, clipped to [from, to]. */
export function spanDayKeys(ev, from, to) {
  const keys = [];
  if (!spansDays(ev)) return keys;
  const cur = new Date(ev.at.getFullYear(), ev.at.getMonth(), ev.at.getDate());
  const last = new Date(ev.endAt.getFullYear(), ev.endAt.getMonth(), ev.endAt.getDate());
  let guard = 0;
  while (cur <= last && guard++ < 400) {
    if ((!from || cur >= from) && (!to || cur < to)) keys.push(dayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

/** The 7 dated cells of a week range. */
export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    return { date: d, key: dayKey(d) };
  });
}
