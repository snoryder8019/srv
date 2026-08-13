/**
 * Smoke test for the platform calendar (/admin/calendar).
 *
 * Exercises the real route with a real admin session: all four views render,
 * the source registry aggregates, filters apply, the JSON feed serialises, and
 * the calendar's own objects (tasks + out-of-office blocks) round-trip through
 * create → appear on the calendar → delete.
 *
 * Read-only against every module's data. The only writes are the task/block it
 * creates, and both are archived at the end.
 */
import http from 'node:http';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { createLoginToken } from '../middleware/jwtAuth.js';

const HOST = process.env.SMOKE_HOST || 'madladslab.madladslab.com';
const PORT = Number(process.env.SMOKE_PORT || 3602);

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ''}`); };
const bad = (n, e) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n      \x1b[31m${e}\x1b[0m`); };
async function check(name, fn) {
  try { ok(name, await fn()); } catch (e) { bad(name, e.message); }
}

// node:http, not fetch — undici drops the Host header, which tenant routing needs.
function req(path, { method = 'GET', body, cookie, formBody } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Host: HOST };
    if (formBody) {
      data = new URLSearchParams(formBody).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(data);
    } else if (body) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const run = async () => {
  await connectDB();
  const tenant = await getSlabDb().collection('tenants').findOne({ domain: HOST });
  if (!tenant) throw new Error(`tenant ${HOST} not found`);
  const db = getTenantDb(tenant.db, tenant.dbHost);
  const owner = await db.collection('users').findOne({ isAdmin: true });
  if (!owner) throw new Error('admin user missing');

  const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, tenant.db, '24h');
  const ex = await req('/admin?token=' + token);
  const m = /(?:^|,\s*)slab_token=([^;]+)/.exec(ex.headers['set-cookie'] || '');
  if (!m) throw new Error('no session cookie issued');
  const cookie = `slab_token=${m[1]}`;

  const today = new Date();
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayKey = dayKey(today);

  console.log('\n\x1b[1mA. Views render\x1b[0m');

  for (const view of ['day', 'week', 'month', 'year']) {
    await check(`${view} view renders`, async () => {
      const r = await req(`/admin/calendar?view=${view}`, { cookie });
      if (r.status !== 200) throw new Error(`status ${r.status}: ${r.body.slice(0, 300)}`);
      if (!r.body.includes('cal-wrap')) throw new Error('calendar shell missing');
      if (r.body.includes('Calendar could not load')) throw new Error('route reported a load error');
      return `${r.body.length} bytes`;
    });
  }

  await check('Unknown view falls back to month', async () => {
    const r = await req('/admin/calendar?view=decade', { cookie });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.includes('cal-grid')) throw new Error('did not fall back to the month grid');
    return 'month';
  });

  console.log('\n\x1b[1mB. Source registry + filters\x1b[0m');

  await check('Filter chips render for the tenant\'s enabled sources', async () => {
    const r = await req('/admin/calendar', { cookie });
    const chips = (r.body.match(/class="cal-chip/g) || []).length;
    if (chips < 3) throw new Error(`only ${chips} chips rendered`);
    return `${chips} chips`;
  });

  await check('?src= filters down to a single source', async () => {
    const r = await req('/admin/calendar?view=month&src=holidays', { cookie });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!/1 source/.test(r.body)) throw new Error('header did not report a single active source');
    return 'holidays only';
  });

  await check('Empty ?src= shows nothing rather than silently defaulting', async () => {
    const r = await req('/admin/calendar?view=month&src=', { cookie });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!/0 sources/.test(r.body)) throw new Error('empty filter fell back to the default set');
    return '0 sources';
  });

  await check('Holidays land on real dates', async () => {
    // December always contains Christmas — the month view renders event titles
    // (the year view only renders per-day density, so it can't assert this).
    const dec = `${today.getFullYear()}-12-01`;
    const r = await req(`/admin/calendar?view=month&date=${dec}&src=holidays`, { cookie });
    if (!r.body.includes('Christmas')) throw new Error('Christmas missing from December');
    const day = await req(`/admin/calendar?view=day&date=${today.getFullYear()}-12-25&src=holidays`, { cookie });
    if (!day.body.includes('Christmas')) throw new Error('Christmas missing from Dec 25 day view');
    return 'Dec 25 ✓';
  });

  console.log('\n\x1b[1mC. JSON feed (dashboard marquee)\x1b[0m');

  await check('feed.json returns a serialisable 7-day window', async () => {
    const r = await req('/admin/calendar/feed.json?days=7', { cookie });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${r.body.slice(0, 200)}`);
    const j = JSON.parse(r.body);
    if (!j.ok) throw new Error(j.error || 'not ok');
    if (!Array.isArray(j.events)) throw new Error('events is not an array');
    for (const ev of j.events.slice(0, 20)) {
      if (typeof ev.at !== 'string' || Number.isNaN(Date.parse(ev.at))) throw new Error(`bad date on ${ev.id}`);
      if (!ev.source || !ev.title) throw new Error(`event ${ev.id} missing source/title`);
    }
    return `${j.events.length} events, ${Object.keys(j.counts).length} sources`;
  });

  await check('feed.json clamps an absurd range', async () => {
    const r = await req('/admin/calendar/feed.json?days=9999', { cookie });
    const j = JSON.parse(r.body);
    if (j.days !== 90) throw new Error(`expected clamp to 90, got ${j.days}`);
    return '90 days';
  });

  console.log('\n\x1b[1mD. Tasks round-trip\x1b[0m');

  const taskTitle = `smoke task ${Date.now()}`;
  let taskId = null;

  await check('Create a task', async () => {
    const r = await req('/admin/calendar/tasks', {
      method: 'POST', cookie,
      formBody: { title: taskTitle, dueDate: todayKey, dueTime: '14:30', project: 'smoke', view: 'month', date: todayKey },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_tasks').findOne({ title: taskTitle });
    if (!doc) throw new Error('task not written');
    taskId = doc._id;
    return String(doc._id);
  });

  await check('Task appears on the day it is due', async () => {
    const r = await req(`/admin/calendar?view=day&date=${todayKey}`, { cookie });
    if (!r.body.includes(taskTitle)) throw new Error('task missing from the day view');
    return 'visible';
  });

  await check('A task with no title is rejected, not silently dropped', async () => {
    const r = await req('/admin/calendar/tasks', {
      method: 'POST', cookie, formBody: { title: '   ', dueDate: todayKey },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    if (!/error=/.test(r.headers.location || '')) throw new Error('no error surfaced on the redirect');
    return 'rejected';
  });

  await check('Mark done flips status', async () => {
    await req(`/admin/calendar/tasks/${taskId}/done`, { method: 'POST', cookie, formBody: {} });
    const doc = await db.collection('calendar_tasks').findOne({ _id: taskId });
    if (doc.status !== 'done') throw new Error(`status is ${doc.status}`);
    return 'done';
  });

  console.log('\n\x1b[1mE. Out-of-office blocks\x1b[0m');

  const blockTitle = `smoke ooo ${Date.now()}`;
  let blockId = null;
  const plus2 = new Date(today); plus2.setDate(plus2.getDate() + 2);

  await check('Create a multi-day block', async () => {
    const r = await req('/admin/calendar/blocks', {
      method: 'POST', cookie,
      formBody: { title: blockTitle, startDate: todayKey, endDate: dayKey(plus2), kind: 'ooo', who: 'Smoke' },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_blocks').findOne({ title: blockTitle });
    if (!doc) throw new Error('block not written');
    blockId = doc._id;
    return String(doc._id);
  });

  await check('Block spans every day it covers', async () => {
    for (const d of [today, plus2]) {
      const r = await req(`/admin/calendar?view=day&date=${dayKey(d)}&src=blocks`, { cookie });
      if (!r.body.includes(blockTitle)) throw new Error(`block missing on ${dayKey(d)}`);
    }
    return 'start + end day';
  });

  console.log('\n\x1b[1mF. Projects + client attachment\x1b[0m');

  const projName = `smoke project ${Date.now()}`;
  let projId = null;
  const someClient = await db.collection('clients').findOne({});

  await check('Create a project attached to a client', async () => {
    const r = await req('/admin/calendar/projects', {
      method: 'POST', cookie,
      formBody: {
        name: projName, clientId: someClient ? String(someClient._id) : '',
        startDate: todayKey, dueDate: dayKey(plus2), notes: 'smoke',
      },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_projects').findOne({ name: projName });
    if (!doc) throw new Error('project not written');
    if (someClient && String(doc.clientId) !== String(someClient._id)) throw new Error('client not attached');
    projId = doc._id;
    return someClient ? `client ${someClient._id}` : 'no clients in tenant';
  });

  await check('Project milestones show on kickoff and due dates', async () => {
    const start = await req(`/admin/calendar?view=day&date=${todayKey}&src=projects`, { cookie });
    if (!start.body.includes(projName)) throw new Error('kickoff milestone missing');
    const due = await req(`/admin/calendar?view=day&date=${dayKey(plus2)}&src=projects`, { cookie });
    if (!due.body.includes(projName)) throw new Error('due milestone missing');
    return 'both';
  });

  await check('A task inherits its project\'s client when none is given', async () => {
    const t2 = `smoke task inherit ${Date.now()}`;
    const r = await req('/admin/calendar/tasks', {
      method: 'POST', cookie,
      formBody: { title: t2, dueDate: todayKey, projectId: String(projId), clientId: '' },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_tasks').findOne({ title: t2 });
    if (!doc) throw new Error('task not written');
    if (String(doc.projectId) !== String(projId)) throw new Error('project not attached');
    if (someClient && String(doc.clientId) !== String(someClient._id)) {
      throw new Error(`expected inherited client ${someClient._id}, got ${doc.clientId}`);
    }
    await db.collection('calendar_tasks').deleteOne({ _id: doc._id });
    return someClient ? 'inherited' : 'no client to inherit';
  });

  await check('?project= narrows the calendar to that project', async () => {
    const r = await req(`/admin/calendar?view=month&project=${projId}`, { cookie });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.includes(projName)) throw new Error('scoped project not shown');
    if (!/Scoped to/.test(r.body)) throw new Error('scope banner missing');
    return 'scoped';
  });

  await check('Deleting a project detaches its tasks instead of orphaning them', async () => {
    const t3 = `smoke task detach ${Date.now()}`;
    await req('/admin/calendar/tasks', {
      method: 'POST', cookie, formBody: { title: t3, dueDate: todayKey, projectId: String(projId) },
    });
    await req(`/admin/calendar/projects/${projId}/delete`, { method: 'POST', cookie, formBody: {} });
    const task = await db.collection('calendar_tasks').findOne({ title: t3 });
    if (!task) throw new Error('task vanished with the project');
    if (task.projectId) throw new Error('task still points at a deleted project');
    const proj = await db.collection('calendar_projects').findOne({ _id: projId });
    if (!proj.archived) throw new Error('project not archived');
    await db.collection('calendar_tasks').deleteOne({ _id: task._id });
    return 'detached';
  });

  console.log('\n\x1b[1mG. Assignees\x1b[0m');

  await check('Task form offers platform users AND accepts free text', async () => {
    const r = await req('/admin/calendar', { cookie });
    if (!r.body.includes('id="calAssignees"')) throw new Error('assignee datalist missing');
    if (!/<input id="taskWho"[^>]*list="calAssignees"/.test(r.body)) throw new Error('assignee field is not a free-text input bound to the list');
    const opts = (r.body.match(/<datalist id="calAssignees">([\s\S]*?)<\/datalist>/) || [])[1] || '';
    const n = (opts.match(/<option/g) || []).length;
    const users = await db.collection('users').countDocuments({});
    if (users > 0 && n === 0) throw new Error(`tenant has ${users} users but the list is empty`);
    return `${n} user option${n === 1 ? '' : 's'}`;
  });

  await check('An off-platform assignee is stored verbatim', async () => {
    const t = `smoke task assignee ${Date.now()}`;
    const who = 'Dave the subcontractor';
    const r = await req('/admin/calendar/tasks', {
      method: 'POST', cookie, formBody: { title: t, dueDate: todayKey, assignee: who },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_tasks').findOne({ title: t });
    if (!doc) throw new Error('task not written');
    if (doc.assignee !== who) throw new Error(`assignee stored as "${doc.assignee}"`);
    await db.collection('calendar_tasks').deleteOne({ _id: doc._id });
    return 'verbatim';
  });

  console.log('\n\x1b[1mH. Task windows + span bars\x1b[0m');

  const spanTitle = `smoke task span ${Date.now()}`;
  let spanId = null;
  const plus4 = new Date(today); plus4.setDate(plus4.getDate() + 4);

  await check('Create a task with a start and an end', async () => {
    const r = await req('/admin/calendar/tasks', {
      method: 'POST', cookie,
      formBody: { title: spanTitle, startDate: todayKey, startTime: '09:00', dueDate: dayKey(plus4), dueTime: '17:00' },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_tasks').findOne({ title: spanTitle });
    if (!doc) throw new Error('task not written');
    if (!doc.startAt) throw new Error('startAt not stored');
    if (!(doc.dueAt > doc.startAt)) throw new Error('window is not forward');
    spanId = doc._id;
    return `${dayKey(doc.startAt)} → ${dayKey(doc.dueAt)}`;
  });

  await check('Renders as ONE bar per week row, not a chip per day', async () => {
    const r = await req(`/admin/calendar?view=month&date=${todayKey}&src=tasks`, { cookie });
    if (!r.body.includes(spanTitle)) throw new Error('span missing from the month view');
    // Count RENDERED LABELS, not raw title occurrences — the title also appears
    // in each bar's tooltip, menu header and edit payload, so a naive substring
    // count can't tell a bar from a repeated chip.
    const labels = (r.body.match(/<span class="cal-ev-x">[\s\S]*?<\/span>/g) || [])
      .filter((x) => x.includes(spanTitle)).length;
    const bars = (r.body.match(/class="cal-ev cal-span/g) || []).length;
    if (bars < 1) throw new Error('no span bar rendered');
    // A 5-day window straddling a week boundary is at most 2 bars — never 5 chips.
    if (labels > 2) throw new Error(`${labels} labels for ${bars} bar(s) — per-day chips were not replaced`);
    if (labels !== bars) throw new Error(`${labels} labels vs ${bars} bars`);
    return `${bars} bar(s), ${labels} label(s)`;
  });

  await check('Bar carries a grid-column span across the row', async () => {
    const r = await req(`/admin/calendar?view=month&date=${todayKey}&src=tasks`, { cookie });
    const m = /grid-column:(\d+) \/ (\d+)/.exec(r.body);
    if (!m) throw new Error('no grid-column placement on any bar');
    if (Number(m[2]) - Number(m[1]) < 2) throw new Error(`bar covers only ${Number(m[2]) - Number(m[1])} column`);
    return `cols ${m[1]}→${m[2]}`;
  });

  await check('Week view gets a span band', async () => {
    const r = await req(`/admin/calendar?view=week&date=${todayKey}&src=tasks`, { cookie });
    if (!r.body.includes('cal-spanband')) throw new Error('week span band missing');
    if (!r.body.includes(spanTitle)) throw new Error('span missing from the week view');
    return 'band present';
  });

  await check('Year view tints every day the span covers', async () => {
    const r = await req(`/admin/calendar?view=year&date=${todayKey}&src=tasks`, { cookie });
    const tinted = (r.body.match(/class="[^"]*spanned/g) || []).length;
    if (tinted < 2) throw new Error(`only ${tinted} day(s) tinted`);
    return `${tinted} days tinted`;
  });

  await check('A span still appears on a single day view inside its window', async () => {
    const mid = new Date(today); mid.setDate(mid.getDate() + 2);
    const r = await req(`/admin/calendar?view=day&date=${dayKey(mid)}&src=tasks`, { cookie });
    if (!r.body.includes(spanTitle)) throw new Error('span missing from a day inside its window');
    return 'visible mid-window';
  });

  console.log('\n\x1b[1mI. Task editing\x1b[0m');

  await check('Chip carries an edit payload', async () => {
    const r = await req(`/admin/calendar?view=month&date=${todayKey}&src=tasks`, { cookie });
    if (!r.body.includes('data-cal-edit')) throw new Error('no edit payload on any chip');
    if (!r.body.includes('id="calEditWrap"')) throw new Error('edit modal not rendered');
    return 'payload + modal';
  });

  await check('Edit rewrites the window and fields', async () => {
    const plus9 = new Date(today); plus9.setDate(plus9.getDate() + 9);
    const r = await req(`/admin/calendar/tasks/${spanId}`, {
      method: 'POST', cookie,
      formBody: {
        title: spanTitle + ' EDITED', startDate: dayKey(plus2), startTime: '08:30',
        dueDate: dayKey(plus9), dueTime: '16:00', assignee: 'Edited Person', notes: 'edited', status: 'open',
      },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('calendar_tasks').findOne({ _id: spanId });
    if (doc.title !== spanTitle + ' EDITED') throw new Error('title not updated');
    if (dayKey(doc.startAt) !== dayKey(plus2)) throw new Error(`start is ${dayKey(doc.startAt)}`);
    if (dayKey(doc.dueAt) !== dayKey(plus9)) throw new Error(`end is ${dayKey(doc.dueAt)}`);
    if (doc.assignee !== 'Edited Person') throw new Error('assignee not updated');
    return 'window + fields';
  });

  await check('A backwards window is clamped, not stored', async () => {
    const back = new Date(today); back.setDate(back.getDate() - 6);
    await req(`/admin/calendar/tasks/${spanId}`, {
      method: 'POST', cookie,
      formBody: { title: spanTitle + ' EDITED', startDate: todayKey, dueDate: dayKey(back), status: 'open' },
    });
    const doc = await db.collection('calendar_tasks').findOne({ _id: spanId });
    if (doc.startAt > doc.dueAt) throw new Error('stored a negative-width window');
    return 'clamped';
  });

  await check('Editing a missing task fails loudly', async () => {
    const gone = '0'.repeat(24);
    const r = await req(`/admin/calendar/tasks/${gone}`, {
      method: 'POST', cookie, formBody: { title: 'ghost', startDate: todayKey, dueDate: todayKey },
    });
    if (!/error=/.test(r.headers.location || '')) throw new Error('no error surfaced');
    return 'reported';
  });

  await check('Legacy tasks (dueAt only, no startAt) still render', async () => {
    const legacy = `smoke task legacy ${Date.now()}`;
    await db.collection('calendar_tasks').insertOne({
      title: legacy, dueAt: new Date(`${todayKey}T12:00:00`), allDay: false,
      status: 'open', archived: false, createdAt: new Date(), updatedAt: new Date(),
    });
    const r = await req(`/admin/calendar?view=day&date=${todayKey}&src=tasks`, { cookie });
    if (!r.body.includes(legacy)) throw new Error('legacy task disappeared');
    await db.collection('calendar_tasks').deleteMany({ title: legacy });
    return 'renders as a single day';
  });

  console.log('\n\x1b[1mCleanup\x1b[0m');
  await check('Remove smoke rows', async () => {
    await db.collection('calendar_tasks').deleteOne({ _id: taskId });
    await db.collection('calendar_blocks').deleteOne({ _id: blockId });
    await db.collection('calendar_tasks').deleteMany({ title: /^smoke task / });
    await db.collection('calendar_projects').deleteMany({ name: /^smoke project / });
    await db.collection('calendar_blocks').deleteMany({ title: /^smoke ooo / });
    return 'clean';
  });

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\x1b[31mFATAL\x1b[0m', e); process.exit(1); });
