#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Brand = require('../models/Brand');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const ShiftNote = require('../models/ShiftNote');
const QRCode = require('../models/QRCode');
const QRScan = require('../models/QRScan');

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function todayAt(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function randomToday() {
  const now = new Date();
  const start = new Date(); start.setHours(6, 0, 0, 0);
  const cap = Math.min(now.getTime(), todayAt(23, 30).getTime());
  const span = Math.max(cap - start.getTime(), 60 * 60 * 1000);
  return new Date(start.getTime() + Math.random() * span);
}

async function seed() {
  await mongoose.connect(`${process.env.DB_URL}/${process.env.DB_NAME}`);
  console.log('Connected. Seeding TODAY activity...\n');

  const brand = await Brand.findOne({ slug: 'scottys-grill' });
  if (!brand) { console.error('Brand "scottys-grill" not found. Run seed-test-data.js first.'); process.exit(1); }

  const staff = await User.find({ brand: brand._id, posPin: { $exists: true, $ne: null } });
  const tasks = await Task.find({ brand: brand._id });
  const qrs = await QRCode.find({ brand: brand._id });

  if (!staff.length || !tasks.length || !qrs.length) {
    console.error('Missing staff/tasks/QRs. Run seed-test-data.js first.');
    process.exit(1);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  console.log(`Date: ${todayStr}`);
  console.log(`Brand: ${brand.name}  Staff: ${staff.length}  Tasks: ${tasks.length}  QRs: ${qrs.length}\n`);

  const devices = [
    { device: 'iPhone',      os: 'iOS 17.4',   browser: 'Safari 17.4' },
    { device: 'Pixel 7',     os: 'Android 14', browser: 'Chrome 122' },
    { device: 'iPhone',      os: 'iOS 16.6',   browser: 'Safari 16.6' },
    { device: 'Galaxy S23',  os: 'Android 14', browser: 'Samsung Browser 24' },
    { device: 'iPhone',      os: 'iOS 17.2',   browser: 'Safari 17.2' },
  ];

  // --- Scans (12-22 for today) ---
  const scanCount = Math.floor(Math.random() * 11) + 12;
  for (let i = 0; i < scanCount; i++) {
    const qr = pick(qrs);
    const user = pick(staff);
    const dev = pick(devices);
    const ts = randomToday();
    await QRScan.create({
      qrCode: qr._id,
      brand: brand._id,
      user: user._id,
      posPin: user.posPin,
      type: qr.type,
      ip: `192.168.1.${Math.floor(Math.random() * 50) + 10}`,
      userAgent: `Mozilla/5.0 (${dev.os})`,
      device: dev.device,
      os: dev.os,
      browser: dev.browser,
      webhookCategory: qr.webhookCategory || '',
      createdAt: ts,
      updatedAt: ts
    });
  }
  console.log(`+ ${scanCount} QR scans`);

  // --- Task completions (8-14 for today, unique per task) ---
  const completionCount = Math.floor(Math.random() * 7) + 8;
  const used = new Set();
  let made = 0;
  let guard = 0;
  while (made < completionCount && guard < completionCount * 4) {
    guard++;
    const task = pick(tasks);
    if (used.has(String(task._id))) continue;
    used.add(String(task._id));
    const user = pick(staff);
    const ts = randomToday();
    await TaskCompletion.create({
      task: task._id,
      brand: brand._id,
      user: user._id,
      posPin: user.posPin,
      shiftDate: todayStr,
      shiftTime: pick(['open', 'mid', 'close']),
      note: pick(['', '', '', 'All good', 'Done', 'Checked', 'Restocked fully', 'Temps normal']),
      createdAt: ts,
      updatedAt: ts
    });
    made++;
  }
  console.log(`+ ${made} task completions`);

  // --- A couple of today-specific shift notes ---
  const superadmin = await User.findOne({ email: 'snoryder8019@gmail.com' });
  const scottW = await User.findOne({ email: 'm.scott.wallace@gmail.com' });
  const author = [superadmin, scottW].filter(Boolean)[0];

  const todayNotes = [
    {
      title: `Lineup ${todayStr}`,
      body: 'Pre-shift: Welcome new server Dana. 86 the salmon (out of stock). Push the brisket sliders and lunch combo. Be ready for a 6-top at 6pm.',
      category: 'announcement',
      shiftTime: 'all',
      pinned: true
    },
    {
      title: 'Reservations Tonight',
      body: '5:30 — Patel party of 4 (anniversary, comp dessert). 7:00 — Henderson 8-top. 8:15 — Walk-in expected from the theater crowd.',
      category: 'announcement',
      shiftTime: 'close',
      pinned: false
    },
    {
      title: 'Kitchen Note',
      body: 'Marinara prepped 2 batches this morning. Walk-in temp checked at open (38°F). If you smell gas near the fryer, page Scott immediately.',
      category: 'safety',
      shiftTime: 'all',
      pinned: false
    }
  ];

  let notesAdded = 0;
  for (const n of todayNotes) {
    const exists = await ShiftNote.findOne({ title: n.title, brand: brand._id, shiftDate: todayStr });
    if (exists) continue;
    const ackUsers = staff.slice().sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 4) + 2);
    await ShiftNote.create({
      brand: brand._id,
      author: author?._id,
      title: n.title,
      body: n.body,
      category: n.category,
      shiftDate: todayStr,
      shiftTime: n.shiftTime,
      pinned: n.pinned,
      acknowledgedBy: ackUsers.map(u => ({ user: u._id, at: randomToday() }))
    });
    notesAdded++;
  }
  console.log(`+ ${notesAdded} shift notes`);

  console.log(`\nDone. Today (${todayStr}) seeded for ${brand.name}.`);
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
