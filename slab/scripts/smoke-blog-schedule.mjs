/**
 * Smoke test for blog auto-slot + scheduled publishing.
 *
 * Exercises the real routes with an admin session: scheduling on save, the
 * per-post schedule/unschedule endpoints, ⚡ auto-slot, next-slot suggestion,
 * appearance on the platform calendar's blog lane, and the publisher flipping a
 * due scheduled post live. All writes are cleaned up at the end.
 */
import http from 'node:http';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { createLoginToken } from '../middleware/jwtAuth.js';
import { runDuePosts } from '../plugins/blogSchedule.js';

const HOST = process.env.SMOKE_HOST || 'madladslab.madladslab.com';
const PORT = Number(process.env.SMOKE_PORT || 3602);

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ''}`); };
const bad = (n, e) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n      \x1b[31m${e}\x1b[0m`); };
async function check(name, fn) { try { ok(name, await fn()); } catch (e) { bad(name, e.message); } }

function req(path, { method = 'GET', body, cookie, formBody, xhr } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Host: HOST };
    if (formBody) {
      data = new URLSearchParams(formBody).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c));
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
  const token = createLoginToken({ ...owner, isAdmin: true, isOwner: true }, tenant.db, '24h');
  const ex = await req('/admin?token=' + token);
  const cookie = 'slab_token=' + /slab_token=([^;]+)/.exec(ex.headers['set-cookie'] || '')[1];

  const now = new Date();
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cleanup = { titles: [] };
  const mk = (t) => { cleanup.titles.push(t); return t; };

  console.log('\n\x1b[1mA. Schedule on save\x1b[0m');

  let scheduledId = null;
  await check('Creating with status=scheduled + a future date lands as scheduled', async () => {
    const future = new Date(now); future.setDate(future.getDate() + 3);
    const title = mk(`smoke sched ${Date.now()}`);
    const r = await req('/admin/blog', {
      method: 'POST', cookie,
      formBody: { title, content: '<p>Body enough to be real.</p>', status: 'scheduled',
                  scheduledDate: dayKey(future), scheduledTime: '09:00', contentType: 'blog' },
    });
    if (r.status !== 302) throw new Error(`expected redirect, got ${r.status}`);
    const doc = await db.collection('blog').findOne({ title });
    if (!doc) throw new Error('post not written');
    if (doc.status !== 'scheduled') throw new Error(`status is ${doc.status}`);
    if (!doc.scheduledAt) throw new Error('scheduledAt not set');
    scheduledId = doc._id;
    return `${dayKey(doc.scheduledAt)}`;
  });

  await check('A "scheduled" save with a PAST date publishes now instead of stranding', async () => {
    const past = new Date(now); past.setDate(past.getDate() - 2);
    const title = mk(`smoke past ${Date.now()}`);
    await req('/admin/blog', {
      method: 'POST', cookie,
      formBody: { title, content: '<p>Body.</p>', status: 'scheduled',
                  scheduledDate: dayKey(past), scheduledTime: '09:00', contentType: 'blog' },
    });
    const doc = await db.collection('blog').findOne({ title });
    if (doc.status !== 'published') throw new Error(`status is ${doc.status}, expected published`);
    if (!doc.publishedAt) throw new Error('publishedAt not stamped');
    return 'went live';
  });

  await check('A "scheduled" save with NO date falls back to draft', async () => {
    const title = mk(`smoke nodate ${Date.now()}`);
    await req('/admin/blog', {
      method: 'POST', cookie,
      formBody: { title, content: '<p>Body.</p>', status: 'scheduled', scheduledDate: '', contentType: 'blog' },
    });
    const doc = await db.collection('blog').findOne({ title });
    if (doc.status !== 'draft') throw new Error(`status is ${doc.status}, expected draft`);
    return 'draft';
  });

  console.log('\n\x1b[1mB. Calendar lane\x1b[0m');

  await check('Scheduled post shows on the calendar blog lane on its date', async () => {
    const doc = await db.collection('blog').findOne({ _id: scheduledId });
    const r = await req(`/admin/calendar?view=day&date=${dayKey(doc.scheduledAt)}&src=blog`, { cookie });
    if (!r.body.includes(doc.title)) throw new Error('scheduled post missing from the calendar');
    return 'visible';
  });

  await check('Calendar chip offers Unschedule for a not-yet-live post', async () => {
    const doc = await db.collection('blog').findOne({ _id: scheduledId });
    const r = await req(`/admin/calendar?view=day&date=${dayKey(doc.scheduledAt)}&src=blog`, { cookie });
    if (!r.body.includes(`/admin/blog/${scheduledId}/unschedule`)) throw new Error('no unschedule action on the chip');
    return 'present';
  });

  console.log('\n\x1b[1mC. Per-post schedule / unschedule\x1b[0m');

  await check('Unschedule returns a scheduled post to draft', async () => {
    const r = await req(`/admin/blog/${scheduledId}/unschedule`, { method: 'POST', cookie, xhr: true });
    const j = JSON.parse(r.body);
    if (!j.ok) throw new Error(j.error || 'not ok');
    const doc = await db.collection('blog').findOne({ _id: scheduledId });
    if (doc.status !== 'draft' || doc.scheduledAt) throw new Error(`status ${doc.status}, scheduledAt ${doc.scheduledAt}`);
    return 'draft';
  });

  await check('Schedule puts a draft back on the calendar', async () => {
    const future = new Date(now); future.setDate(future.getDate() + 5);
    const r = await req(`/admin/blog/${scheduledId}/schedule`, {
      method: 'POST', cookie, xhr: true, formBody: { date: dayKey(future), time: '14:00' },
    });
    const j = JSON.parse(r.body);
    if (!j.ok) throw new Error(j.error || 'not ok');
    const doc = await db.collection('blog').findOne({ _id: scheduledId });
    if (doc.status !== 'scheduled') throw new Error(`status is ${doc.status}`);
    return dayKey(doc.scheduledAt);
  });

  await check('Scheduling with no date is rejected', async () => {
    const r = await req(`/admin/blog/${scheduledId}/schedule`, { method: 'POST', cookie, xhr: true, formBody: {} });
    const j = JSON.parse(r.body);
    if (j.ok) throw new Error('accepted an empty date');
    return 'rejected';
  });

  console.log('\n\x1b[1mD. Auto-slot\x1b[0m');

  await check('next-slots suggests spaced future reading hours', async () => {
    const r = await req('/admin/blog/next-slots?n=3', { cookie });
    const j = JSON.parse(r.body);
    if (!j.ok || j.slots.length !== 3) throw new Error(`got ${j.slots?.length} slots`);
    const dates = j.slots.map((s) => new Date(s));
    if (dates.some((d) => d <= now)) throw new Error('a suggested slot is in the past');
    if (!(dates[1] > dates[0] && dates[2] > dates[1])) throw new Error('slots not strictly increasing');
    return j.slots.map((s) => s.slice(0, 10)).join(', ');
  });

  let slotA, slotB;
  await check('Auto-slot schedules ready drafts onto open slots', async () => {
    slotA = mk(`smoke slot A ${Date.now()}`);
    slotB = mk(`smoke slot B ${Date.now()}`);
    for (const t of [slotA, slotB]) {
      await db.collection('blog').insertOne({
        title: t, slug: t.replace(/\s+/g, '-').toLowerCase(), content: '<p>Ready body.</p>',
        status: 'draft', scheduledAt: null, publishedAt: null, contentType: 'blog',
        createdAt: new Date(), updatedAt: new Date(),
      });
    }
    const r = await req('/admin/blog/auto-slot', { method: 'POST', cookie, xhr: true, body: {} });
    const j = JSON.parse(r.body);
    if (!j.ok) throw new Error(j.error || 'not ok');
    const a = await db.collection('blog').findOne({ title: slotA });
    const b = await db.collection('blog').findOne({ title: slotB });
    if (a.status !== 'scheduled' || b.status !== 'scheduled') throw new Error('drafts not scheduled');
    if (dayKey(a.scheduledAt) === dayKey(b.scheduledAt)) throw new Error('both landed on the same day — not spaced');
    return `${dayKey(a.scheduledAt)} + ${dayKey(b.scheduledAt)}`;
  });

  await check('Auto-slot ignores drafts with no body', async () => {
    const empty = mk(`smoke empty ${Date.now()}`);
    await db.collection('blog').insertOne({
      title: empty, slug: empty.replace(/\s+/g, '-').toLowerCase(), content: '',
      status: 'draft', contentType: 'blog', createdAt: new Date(), updatedAt: new Date(),
    });
    await req('/admin/blog/auto-slot', { method: 'POST', cookie, xhr: true, body: {} });
    const doc = await db.collection('blog').findOne({ title: empty });
    if (doc.status !== 'draft') throw new Error('an empty draft was scheduled');
    return 'skipped';
  });

  console.log('\n\x1b[1mE. Publisher flips due posts live\x1b[0m');

  await check('runDuePosts publishes a past-due scheduled post', async () => {
    const title = mk(`smoke due ${Date.now()}`);
    const pastDue = new Date(now.getTime() - 60000);
    const ins = await db.collection('blog').insertOne({
      title, slug: title.replace(/\s+/g, '-').toLowerCase(), content: '<p>Due body.</p>',
      status: 'scheduled', scheduledAt: pastDue, publishedAt: null, contentType: 'blog',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const n = await runDuePosts();
    const doc = await db.collection('blog').findOne({ _id: ins.insertedId });
    if (doc.status !== 'published') throw new Error(`status is ${doc.status}`);
    if (!doc.publishedAt) throw new Error('publishedAt not stamped');
    return `published (${n} total this run)`;
  });

  await check('A future scheduled post is NOT published early', async () => {
    const title = mk(`smoke future ${Date.now()}`);
    const future = new Date(now.getTime() + 3 * 86400000);
    const ins = await db.collection('blog').insertOne({
      title, slug: title.replace(/\s+/g, '-').toLowerCase(), content: '<p>Future.</p>',
      status: 'scheduled', scheduledAt: future, publishedAt: null, contentType: 'blog',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await runDuePosts();
    const doc = await db.collection('blog').findOne({ _id: ins.insertedId });
    if (doc.status !== 'scheduled') throw new Error(`published early — status is ${doc.status}`);
    return 'held';
  });

  console.log('\n\x1b[1mCleanup\x1b[0m');
  await check('Remove smoke posts', async () => {
    const r = await db.collection('blog').deleteMany({ title: { $in: cleanup.titles } });
    await db.collection('blog').deleteMany({ title: /^smoke (sched|past|nodate|slot|empty|due|future) / });
    return `${r.deletedCount} removed`;
  });

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\x1b[31mFATAL\x1b[0m', e); process.exit(1); });
