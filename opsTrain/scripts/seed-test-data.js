#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const QRCodeLib = require('qrcode');

const User = require('../models/User');
const Brand = require('../models/Brand');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const ShiftNote = require('../models/ShiftNote');
const Special = require('../models/Special');
const QRCode = require('../models/QRCode');
const QRScan = require('../models/QRScan');

const DOMAIN = process.env.DOMAIN || 'https://ops-train.madladslab.com';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(Math.floor(Math.random() * 14) + 6, Math.floor(Math.random() * 60));
  return d;
}
function dateStr(d) { return d.toISOString().slice(0, 10); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function seed() {
  await mongoose.connect(`${process.env.DB_URL}/${process.env.DB_NAME}`);
  console.log('Connected. Seeding test data...\n');

  // --- Brand ---
  let brand = await Brand.findOne({ slug: 'scottys-grill' });
  if (!brand) {
    brand = await Brand.create({
      name: "Scotty's Bar & Grill",
      slug: 'scottys-grill',
      location: 'Downtown',
      address: '742 Evergreen Terrace',
      phone: '555-0199',
      color: '#d97706',
      description: 'Full-service restaurant & bar',
      settings: {
        requirePinForTasks: true,
        shiftNoteRequired: true,
        specialsEnabled: true,
        webhooksEnabled: true
      }
    });
    console.log('+ Brand: Scotty\'s Bar & Grill');
  } else {
    console.log('= Brand already exists');
  }

  // --- Staff Users (POS pins) ---
  const staffData = [
    { displayName: 'Mike Torres',    firstName: 'Mike',   lastName: 'Torres',    posPin: '1234', role: 'user' },
    { displayName: 'Jamie Chen',     firstName: 'Jamie',  lastName: 'Chen',      posPin: '2345', role: 'user' },
    { displayName: 'Alex Rivera',    firstName: 'Alex',   lastName: 'Rivera',    posPin: '3456', role: 'user' },
    { displayName: 'Sam Okafor',     firstName: 'Sam',    lastName: 'Okafor',    posPin: '4567', role: 'user' },
    { displayName: 'Taylor Brooks',  firstName: 'Taylor', lastName: 'Brooks',    posPin: '5678', role: 'user' },
    { displayName: 'Jordan Reeves',  firstName: 'Jordan', lastName: 'Reeves',    posPin: '6789', role: 'user' },
    { displayName: 'Casey Medina',   firstName: 'Casey',  lastName: 'Medina',    posPin: '7890', role: 'user' },
    { displayName: 'Dana Kim',       firstName: 'Dana',   lastName: 'Kim',       posPin: '8901', role: 'user' },
  ];

  const staff = [];
  for (const s of staffData) {
    let u = await User.findOne({ posPin: s.posPin, brand: brand._id });
    if (!u) {
      u = await User.create({ ...s, brand: brand._id, provider: 'local' });
      console.log(`+ User: ${s.displayName} (PIN ${s.posPin})`);
    }
    staff.push(u);
  }

  // Link scott wallace as admin for this brand
  await User.updateOne(
    { email: 'm.scott.wallace@gmail.com' },
    { $set: { brand: brand._id } }
  );
  console.log('= Linked m.scott.wallace to brand');

  // --- Tasks ---
  const taskData = [
    { title: 'Sweep & mop front of house',    type: 'cleaning',   category: 'sidework',  frequency: 'daily', shiftTime: 'close', sortOrder: 1 },
    { title: 'Restock bar napkins & straws',   type: 'sidework',   category: 'sidework',  frequency: 'daily', shiftTime: 'open',  sortOrder: 2 },
    { title: 'Check walk-in fridge temps',     type: 'inspection', category: 'inspection', frequency: 'daily', shiftTime: 'open',  sortOrder: 3, requiresNote: true },
    { title: 'Prep house salad mix',           type: 'prep',       category: 'prep',       frequency: 'daily', shiftTime: 'open',  sortOrder: 4 },
    { title: 'Prep marinara (2 batches)',      type: 'prep',       category: 'prep',       frequency: 'daily', shiftTime: 'open',  sortOrder: 5 },
    { title: 'Roll silverware (50 sets)',      type: 'sidework',   category: 'sidework',  frequency: 'daily', shiftTime: 'mid',   sortOrder: 6 },
    { title: 'Clean fryer & filter oil',       type: 'cleaning',   category: 'cleaning',  frequency: 'daily', shiftTime: 'close', sortOrder: 7 },
    { title: 'Wipe down all tables & booths',  type: 'cleaning',   category: 'cleaning',  frequency: 'per-shift', shiftTime: 'any', sortOrder: 8 },
    { title: 'Restock dessert case',           type: 'sidework',   category: 'sidework',  frequency: 'daily', shiftTime: 'open',  sortOrder: 9 },
    { title: 'Take out trash & recycling',     type: 'cleaning',   category: 'cleaning',  frequency: 'per-shift', shiftTime: 'any', sortOrder: 10 },
    { title: 'Check restroom supplies',        type: 'inspection', category: 'inspection', frequency: 'per-shift', shiftTime: 'any', sortOrder: 11 },
    { title: 'Polish glassware',               type: 'sidework',   category: 'sidework',  frequency: 'daily', shiftTime: 'open',  sortOrder: 12 },
  ];

  const tasks = [];
  for (const t of taskData) {
    let task = await Task.findOne({ title: t.title, brand: brand._id });
    if (!task) {
      task = await Task.create({ ...t, brand: brand._id });
      console.log(`+ Task: ${t.title}`);
    }
    tasks.push(task);
  }

  // --- QR Codes ---
  const qrData = [
    { label: 'Front Door — Shift Login',      type: 'shift-login',  area: 'entrance',  position: '' },
    { label: 'Kitchen — Full Task List',       type: 'task-list',    area: 'kitchen',   position: 'wall' },
    { label: 'Walk-in Fridge — Left Section',  type: 'webhook',      area: 'walk-in',   position: 'left',   webhookCategory: 'fridge-temp-check' },
    { label: 'Walk-in Fridge — Center',        type: 'webhook',      area: 'walk-in',   position: 'center', webhookCategory: 'fridge-temp-check' },
    { label: 'Walk-in Fridge — Right Section', type: 'webhook',      area: 'walk-in',   position: 'right',  webhookCategory: 'fridge-temp-check' },
    { label: 'Fryer Station — Clean Check',    type: 'task-checkin', area: 'kitchen',   position: 'fryer',  taskIndex: 6 },
    { label: 'Prep Station — Marinara',        type: 'prep-log',     area: 'kitchen',   position: 'prep-1', taskIndex: 4 },
    { label: 'Prep Station — Salad',           type: 'prep-log',     area: 'kitchen',   position: 'prep-2', taskIndex: 3 },
    { label: 'Trash Area — Dumpster',          type: 'webhook',      area: 'back',      position: '',       webhookCategory: 'trash-out' },
    { label: 'Roll-out Fridge — Behind Bar',   type: 'webhook',      area: 'bar',       position: 'back',   webhookCategory: 'appliance-rollout' },
    { label: 'Restroom — Supply Check',        type: 'task-checkin', area: 'restroom',  position: '',       taskIndex: 10 },
    { label: 'Bar — Restock Station',          type: 'task-checkin', area: 'bar',       position: 'front',  taskIndex: 1 },
  ];

  const qrs = [];
  for (const q of qrData) {
    let qr = await QRCode.findOne({ label: q.label, brand: brand._id });
    if (!qr) {
      const code = crypto.randomBytes(6).toString('hex');
      const scanUrl = `${DOMAIN}/scan/${code}`;
      const dataUrl = await QRCodeLib.toDataURL(scanUrl, { width: 400, margin: 2 });
      qr = await QRCode.create({
        brand: brand._id,
        label: q.label,
        code,
        type: q.type,
        task: q.taskIndex !== undefined ? tasks[q.taskIndex]._id : undefined,
        webhookCategory: q.webhookCategory || '',
        area: q.area,
        position: q.position,
        dataUrl
      });
      console.log(`+ QR: ${q.label}`);
    }
    qrs.push(qr);
  }

  // --- Shift Notes ---
  const noteData = [
    { title: 'Uniform Reminder',     body: 'Black non-slip shoes required. No visible logos on shirts. Aprons must be clean at shift start.',                               category: 'uniform',      shiftTime: 'all', pinned: true },
    { title: 'VIP Party Tonight',    body: '8-top reservation at 7:30pm for the Henderson party. They are regulars — comp a round of apps. Ask Scott for details.',           category: 'announcement', shiftTime: 'close' },
    { title: 'New Menu Item',        body: 'Smoked brisket sliders are on special starting today. $14. Comes with house slaw and fries. Push these — we prepped heavy.',     category: 'specials',     shiftTime: 'all' },
    { title: 'Walk-in Reorganized',  body: 'Dairy is now on shelf 2, produce shelf 3. Labels are up. Do NOT move things around without checking with the kitchen manager.',   category: 'announcement', shiftTime: 'open' },
    { title: 'Safety: Wet Floor',    body: 'The back hallway near the walk-in has a slow leak. Wet floor sign is up. Maintenance scheduled for Thursday.',                    category: 'safety',       shiftTime: 'all', pinned: true },
  ];

  const today = new Date().toISOString().slice(0, 10);
  for (const n of noteData) {
    const exists = await ShiftNote.findOne({ title: n.title, brand: brand._id });
    if (!exists) {
      // pick a random admin-level user as author
      const superadmin = await User.findOne({ email: 'snoryder8019@gmail.com' });
      const scottW = await User.findOne({ email: 'm.scott.wallace@gmail.com' });
      const author = pick([superadmin, scottW].filter(Boolean));
      await ShiftNote.create({
        brand: brand._id,
        author: author?._id,
        title: n.title,
        body: n.body,
        category: n.category,
        shiftDate: today,
        shiftTime: n.shiftTime || 'all',
        pinned: n.pinned || false
      });
      console.log(`+ Note: ${n.title}`);
    }
  }

  // --- Specials ---
  const specialData = [
    { name: 'Smoked Brisket Sliders',  description: 'Three sliders with house slaw & fries', price: '$14.00', shiftTime: 'all' },
    { name: 'Half-Price Wings',         description: 'All flavors, dine-in only',              price: '$7.50',  shiftTime: 'close' },
    { name: '$5 Draft Pints',           description: 'All local taps',                         price: '$5.00',  shiftTime: 'close' },
    { name: 'Lunch Combo',             description: 'Soup + half sandwich + drink',            price: '$11.00', shiftTime: 'open' },
  ];

  for (const sp of specialData) {
    const exists = await Special.findOne({ name: sp.name, brand: brand._id });
    if (!exists) {
      await Special.create({ brand: brand._id, ...sp });
      console.log(`+ Special: ${sp.name}`);
    }
  }

  // --- Simulate scan + completion activity over past 14 days ---
  const existingScans = await QRScan.countDocuments({ brand: brand._id });
  if (existingScans < 10) {
    console.log('\nGenerating scan & completion history...');

    const devices = [
      { device: 'iPhone', os: 'iOS 17.4', browser: 'Safari 17.4' },
      { device: 'Pixel 7', os: 'Android 14', browser: 'Chrome 122' },
      { device: 'iPhone', os: 'iOS 16.6', browser: 'Safari 16.6' },
      { device: 'Galaxy S23', os: 'Android 14', browser: 'Samsung Browser 24' },
      { device: 'iPhone', os: 'iOS 17.2', browser: 'Safari 17.2' },
    ];

    for (let day = 0; day < 14; day++) {
      // 8-20 scans per day
      const scanCount = Math.floor(Math.random() * 13) + 8;
      for (let s = 0; s < scanCount; s++) {
        const qr = pick(qrs);
        const user = pick(staff);
        const dev = pick(devices);
        const ts = daysAgo(day);

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

      // 4-10 task completions per day
      const completionCount = Math.floor(Math.random() * 7) + 4;
      const usedTasks = new Set();
      for (let c = 0; c < completionCount; c++) {
        const task = pick(tasks);
        const user = pick(staff);
        const ts = daysAgo(day);
        const sd = dateStr(ts);

        // avoid duplicate task completions same day
        const key = `${task._id}-${sd}`;
        if (usedTasks.has(key)) continue;
        usedTasks.add(key);

        await TaskCompletion.create({
          task: task._id,
          brand: brand._id,
          user: user._id,
          posPin: user.posPin,
          shiftDate: sd,
          shiftTime: pick(['open', 'mid', 'close']),
          note: pick(['', '', '', 'All good', 'Done', 'Checked', 'Restocked fully', 'Temps normal']),
          createdAt: ts,
          updatedAt: ts
        });
      }

      console.log(`  Day -${day}: ${scanCount} scans, ${completionCount} completions`);
    }

    // Acknowledge some shift notes with random staff
    const notes = await ShiftNote.find({ brand: brand._id });
    for (const note of notes) {
      const ackCount = Math.floor(Math.random() * 5) + 2;
      const ackUsers = staff.sort(() => Math.random() - 0.5).slice(0, ackCount);
      await ShiftNote.findByIdAndUpdate(note._id, {
        $set: {
          acknowledgedBy: ackUsers.map(u => ({ user: u._id, at: daysAgo(0) }))
        }
      });
    }
    console.log('  + Shift note acknowledgements added');
  } else {
    console.log('\nScan data already exists, skipping activity generation.');
  }

  console.log('\nDone! Test data seeded for Scotty\'s Bar & Grill.');
  console.log(`Brand ID: ${brand._id}`);
  console.log('Staff PINs: 1234, 2345, 3456, 4567, 5678, 6789, 7890, 8901');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
