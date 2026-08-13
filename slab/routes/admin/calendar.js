/**
 * Slab — Platform Calendar (/admin/calendar)
 * ─────────────────────────────────────────────────────────────────────────────
 * The whole business on one timeline. Social posts, blog/content, email
 * campaigns, meetings, field jobs, invoices due, engagements, client mail,
 * workflow tasks, out-of-office blocks and holidays all arrive through the
 * source registry in plugins/calendarSources.js — this route only decides the
 * RANGE, the FILTERS, and the VIEW, then renders.
 *
 * Views: day | week (7-day) | month | year, all driven by ?view=&date=.
 * Filters: ?src=social,blog,tasks (omitted = every default-on source).
 *
 * The calendar also OWNS two object types nobody else does — workflow tasks
 * (calendar_tasks) and out-of-office blocks (calendar_blocks) — so their CRUD
 * lives here. Everything else is read-only here and links back to its module.
 */

import express from 'express';
import { FEATURES, canSeeFeature } from '../../plugins/featureRegistry.js';
import {
  CALENDAR_SOURCES, SOURCE_MAP, VIEWS,
  loadEvents, resolveRange, monthWeeks, weekDays, dayKey,
  spansDays, layoutSpans, spanDayKeys,
  visibleSources, defaultSourceKeys,
  createTask, updateTask, getTask, setTaskStatus, archiveTask, createBlock, archiveBlock,
  createProject, setProjectStatus, archiveProject, listProjects, listClientOptions, listAssigneeOptions,
} from '../../plugins/calendarSources.js';

const router = express.Router();
const form = express.urlencoded({ extended: false });

// The feature keys this viewer can actually reach — a tenant without Social
// never loads social events and never sees a Social filter chip.
function viewerFeatureKeys(req) {
  const ctx = {
    isSuperAdmin: !!req.isSuperAdmin,
    isOwner: !!req.isOwner,
    userPermissions: req.userPermissions || [],
    featureStages: req.featureStages || {},
    tenantOptIns: req.tenantOptIns || {},
  };
  return FEATURES.filter((f) => canSeeFeature(f, ctx)).map((f) => f.key);
}

function parseAnchor(v) {
  if (!v) return new Date();
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(v));
  if (!m) { const d = new Date(v); return Number.isNaN(d.getTime()) ? new Date() : d; }
  return new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
}

const fmtAnchor = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Shared query resolution: view, anchor date, and the active source filter. */
function resolveQuery(req) {
  const view = VIEWS.includes(req.query.view) ? req.query.view : 'month';
  const anchor = parseAnchor(req.query.date);
  const featureKeys = viewerFeatureKeys(req);
  const allowed = visibleSources(featureKeys);
  const allowedKeys = allowed.map((s) => s.key);

  let active;
  if (typeof req.query.src === 'string') {
    // An explicit empty ?src= means "show nothing" — respect it rather than
    // silently falling back to the default set, which reads as a broken filter.
    active = req.query.src.split(',').map((s) => s.trim()).filter((s) => allowedKeys.includes(s));
  } else {
    active = defaultSourceKeys(allowed);
  }
  // Cross-cutting scope filters: ?project=<id> narrows to one body of work,
  // ?client=<id> shows EVERYTHING for one client (jobs, invoices, meetings,
  // mail, tasks) — the view a client conversation actually needs.
  const projectId = String(req.query.project || '').trim() || null;
  const clientId = String(req.query.client || '').trim() || null;

  return { view, anchor, allowed, active, featureKeys, projectId, clientId };
}

// ── GET /admin/calendar ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const { view, anchor, allowed, active, featureKeys, projectId, clientId } = resolveQuery(req);
    const range = resolveRange(view, anchor);

    const [{ events, byDay, counts, failed }, projects, clientOptions, assigneeOptions] = await Promise.all([
      loadEvents(db, {
        start: range.start, end: range.end, sources: active, features: featureKeys, projectId, clientId,
      }),
      listProjects(db),
      listClientOptions(db),
      listAssigneeOptions(db),
    ]);
    const activeProject = projectId ? projects.find((p) => String(p._id) === projectId) || null : null;
    const activeClient = clientId ? clientOptions.find((c) => c.id === clientId) || null : null;

    // Multi-day events become BARS, not repeated chips. Lay them out per grid
    // row here (server-side) so every view renders from one computed model and
    // the cells know how much vertical room to reserve.
    const spanning = events.filter(spansDays);

    // Per-view cell scaffolding. The year view needs a month-by-month density
    // map rather than every event, or a busy year renders thousands of chips.
    let weeks = null, days = null, months = null, weekSpans = null, spanTint = null;
    if (view === 'month') {
      // Each week carries its own bar layout, so the template never has to
      // recompute a row's start date or its lane count.
      weeks = monthWeeks(range.start).map((cells) => {
        const firstIdx = cells.findIndex((c) => c);
        const rowStart = new Date(cells[firstIdx].date);
        rowStart.setDate(rowStart.getDate() - firstIdx);   // pad back to the row's Sunday
        const { items, laneCount } = layoutSpans(spanning, rowStart, 7);
        return { cells, spans: items, laneCount };
      });
    } else if (view === 'week') {
      days = weekDays(range.start);
      weekSpans = layoutSpans(spanning, new Date(range.start), 7);
    } else if (view === 'day') {
      days = [{ date: new Date(range.start), key: dayKey(range.start) }];
    } else {
      months = Array.from({ length: 12 }, (_, m) => {
        const mStart = new Date(range.start.getFullYear(), m, 1);
        const mEnd = new Date(range.start.getFullYear(), m + 1, 1);
        const bySource = {};
        let total = 0;
        for (const [k, rows] of byDay.entries()) {
          const d = new Date(k + 'T00:00:00');
          if (d < mStart || d >= mEnd) continue;
          for (const ev of rows) { bySource[ev.source] = (bySource[ev.source] || 0) + 1; total++; }
        }
        return {
          index: m,
          label: mStart.toLocaleDateString('en-US', { month: 'short' }),
          anchor: fmtAnchor(mStart),
          weeks: monthWeeks(mStart),
          total, bySource,
        };
      });
      // The year grid is too dense for bars, so a span reads as a tint on every
      // day it covers — the same "this stretches across days" signal at scale.
      spanTint = {};
      for (const ev of spanning) {
        for (const k of spanDayKeys(ev, range.start, range.end)) {
          if (!spanTint[k]) spanTint[k] = ev.source;
        }
      }
    }

    res.render('admin/calendar/index', {
      user: req.adminUser,
      page: 'calendar',
      title: 'Calendar',
      view, views: VIEWS,
      range,
      anchorParam: fmtAnchor(anchor),
      prevParam: fmtAnchor(range.prev),
      nextParam: fmtAnchor(range.next),
      todayParam: fmtAnchor(new Date()),
      sources: allowed,
      sourceMap: SOURCE_MAP,
      active,
      counts, failed,
      byDay,
      weeks, days, months,
      weekSpans, spanTint,
      todayKey: dayKey(new Date()),
      focus: req.query.focus || '',
      projects, clientOptions, assigneeOptions,
      projectId, clientId, activeProject, activeClient,
      qs: req.query,
    });
  } catch (err) {
    console.error('[admin/calendar] render error:', err);
    res.status(500).render('admin/calendar/index', {
      user: req.adminUser, page: 'calendar', title: 'Calendar',
      view: 'month', views: VIEWS,
      range: resolveRange('month', new Date()),
      anchorParam: '', prevParam: '', nextParam: '', todayParam: '',
      sources: [], sourceMap: SOURCE_MAP, active: [], counts: {}, failed: [],
      byDay: new Map(), weeks: [], days: null, months: null,
      weekSpans: null, spanTint: null,
      todayKey: dayKey(new Date()), focus: '',
      projects: [], clientOptions: [], assigneeOptions: [], projectId: null, clientId: null,
      activeProject: null, activeClient: null, qs: {},
      loadError: err.message,
    });
  }
});

// ── GET /admin/calendar/feed.json ────────────────────────────────────────────
// Range feed for the dashboard marquee and any async surface. Dates serialize
// to ISO; the client formats. `days=N` from today is the common call.
router.get('/feed.json', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + days);
    const { active, featureKeys, projectId, clientId } = resolveQuery(req);
    const { events, counts, failed } = await loadEvents(req.db, {
      start, end, sources: active, features: featureKeys, projectId, clientId,
    });
    res.json({
      ok: true, days, counts, failed,
      events: events.map((e) => ({ ...e, at: e.at.toISOString(), endAt: e.endAt ? e.endAt.toISOString() : null })),
    });
  } catch (err) {
    console.error('[admin/calendar] feed error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Workflow tasks ───────────────────────────────────────────────────────────

const backTo = (req, extra = '') => {
  const q = new URLSearchParams();
  if (req.body.view || req.query.view) q.set('view', req.body.view || req.query.view);
  if (req.body.date || req.query.date) q.set('date', req.body.date || req.query.date);
  if (req.body.src || req.query.src) q.set('src', req.body.src || req.query.src);
  if (req.body.project || req.query.project) q.set('project', req.body.project || req.query.project);
  if (req.body.client || req.query.client) q.set('client', req.body.client || req.query.client);
  const s = q.toString();
  return '/admin/calendar' + (s ? '?' + s : '') + extra;
};

router.post('/tasks', form, async (req, res) => {
  try {
    const { title, startDate, startTime, dueDate, dueTime, projectId, clientId, assignee, notes } = req.body;
    const allDay = !startTime && !dueTime;
    // End defaults to the start day: the common case is still a one-day task.
    const startAt = startDate ? new Date(`${startDate}T${startTime || '09:00'}:00`) : null;
    const endSrc = dueDate || startDate;
    const dueAt = endSrc ? new Date(`${endSrc}T${dueTime || startTime || '17:00'}:00`) : null;
    await createTask(req.db, {
      title, startAt, dueAt, allDay, projectId, clientId, assignee, notes,
      createdBy: req.adminUser?.email || null,
    });
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'success=' + encodeURIComponent('Task added')));
  } catch (err) {
    console.error('[admin/calendar] task create error:', err);
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(err.message)));
  }
});

// Full edit. The chip's ⋯ menu opens a modal pre-filled from the event payload,
// so this is the only write path a task edit needs.
router.post('/tasks/:id', form, async (req, res) => {
  try {
    const { title, startDate, startTime, dueDate, dueTime, projectId, clientId, assignee, notes, status } = req.body;
    const allDay = !startTime && !dueTime;
    await updateTask(req.db, req.params.id, {
      title, projectId, clientId, assignee, notes, status, allDay,
      startAt: startDate ? new Date(`${startDate}T${startTime || '09:00'}:00`) : null,
      dueAt: dueDate ? new Date(`${dueDate}T${dueTime || startTime || '17:00'}:00`) : null,
    });
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'success=' + encodeURIComponent('Task updated')));
  } catch (err) {
    console.error('[admin/calendar] task update error:', err);
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(err.message)));
  }
});

// JSON read, for any surface that wants a task without re-rendering the page.
router.get('/tasks/:id.json', async (req, res) => {
  const t = await getTask(req.db, req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'Task not found' });
  res.json({ ok: true, task: t });
});

router.post('/tasks/:id/done', form, async (req, res) => {
  try { await setTaskStatus(req.db, req.params.id, 'done'); } catch (e) { console.error('[admin/calendar] task done:', e.message); }
  res.redirect(backTo(req));
});

router.post('/tasks/:id/reopen', form, async (req, res) => {
  try { await setTaskStatus(req.db, req.params.id, 'open'); } catch (e) { console.error('[admin/calendar] task reopen:', e.message); }
  res.redirect(backTo(req));
});

router.post('/tasks/:id/delete', form, async (req, res) => {
  try { await archiveTask(req.db, req.params.id); } catch (e) { console.error('[admin/calendar] task delete:', e.message); }
  res.redirect(backTo(req));
});

// ── Projects ─────────────────────────────────────────────────────────────────
// Projects are created here (not in Clients) because they exist to carry dates.
// Deleting one detaches its tasks rather than orphaning them — see archiveProject.

router.post('/projects', form, async (req, res) => {
  try {
    const { name, clientId, startDate, dueDate, notes } = req.body;
    await createProject(req.db, {
      name, clientId, notes,
      startAt: startDate ? new Date(`${startDate}T00:00:00`) : null,
      dueAt: dueDate ? new Date(`${dueDate}T17:00:00`) : null,
      createdBy: req.adminUser?.email || null,
    });
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'success=' + encodeURIComponent('Project created')));
  } catch (err) {
    console.error('[admin/calendar] project create error:', err);
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(err.message)));
  }
});

router.post('/projects/:id/complete', form, async (req, res) => {
  try { await setProjectStatus(req.db, req.params.id, 'complete'); } catch (e) { console.error('[admin/calendar] project complete:', e.message); }
  res.redirect(backTo(req));
});

router.post('/projects/:id/reopen', form, async (req, res) => {
  try { await setProjectStatus(req.db, req.params.id, 'active'); } catch (e) { console.error('[admin/calendar] project reopen:', e.message); }
  res.redirect(backTo(req));
});

router.post('/projects/:id/delete', form, async (req, res) => {
  try { await archiveProject(req.db, req.params.id); } catch (e) { console.error('[admin/calendar] project delete:', e.message); }
  res.redirect('/admin/calendar');
});

// ── Out-of-office / blocked time ─────────────────────────────────────────────

router.post('/blocks', form, async (req, res) => {
  try {
    const { title, startDate, endDate, kind, who, notes } = req.body;
    await createBlock(req.db, {
      title, kind, who, notes,
      startAt: startDate ? new Date(`${startDate}T00:00:00`) : null,
      endAt: endDate ? new Date(`${endDate}T23:59:59`) : null,
      createdBy: req.adminUser?.email || null,
    });
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'success=' + encodeURIComponent('Time blocked')));
  } catch (err) {
    console.error('[admin/calendar] block create error:', err);
    res.redirect(backTo(req, (backTo(req).includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(err.message)));
  }
});

router.post('/blocks/:id/delete', form, async (req, res) => {
  try { await archiveBlock(req.db, req.params.id); } catch (e) { console.error('[admin/calendar] block delete:', e.message); }
  res.redirect(backTo(req));
});

export default router;
export { CALENDAR_SOURCES };
