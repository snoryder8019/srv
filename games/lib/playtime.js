'use strict';

/**
 * Playtime Tracker — tracks hours per user per billing cycle.
 * 40 hours free, then monthly fee kicks in.
 */

const FREE_HOURS = 40;

let db = null;

function init(database) {
  db = database;
  ensureIndexes();
}

async function ensureIndexes() {
  try {
    await db.collection('playtime').createIndex({ userId: 1, month: 1 }, { unique: true });
    await db.collection('playtime').createIndex({ month: 1 });
  } catch (e) {}
}

function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Add playtime minutes for a user
async function addMinutes(userId, minutes) {
  const month = currentMonth();
  await db.collection('playtime').updateOne(
    { userId, month },
    {
      $inc: { minutes: minutes },
      $set: { updatedAt: new Date() },
      $setOnInsert: { userId, month, createdAt: new Date() },
    },
    { upsert: true }
  );
}

// Get playtime for a user this month
async function getMonthly(userId) {
  const month = currentMonth();
  const doc = await db.collection('playtime').findOne({ userId, month });
  const minutes = doc ? doc.minutes : 0;
  return {
    userId,
    month,
    minutes,
    hours: Math.round(minutes / 60 * 10) / 10,
    freeHoursLeft: Math.max(0, FREE_HOURS - Math.floor(minutes / 60)),
    billable: minutes > FREE_HOURS * 60,
  };
}

// Get playtime leaderboard for current month
async function getLeaderboard(limit) {
  const month = currentMonth();
  return db.collection('playtime')
    .find({ month })
    .sort({ minutes: -1 })
    .limit(limit || 20)
    .toArray();
}

// Check if user has exceeded free hours
async function isBillable(userId) {
  const data = await getMonthly(userId);
  return data.billable;
}

module.exports = {
  init,
  addMinutes,
  getMonthly,
  getLeaderboard,
  isBillable,
  FREE_HOURS,
};
