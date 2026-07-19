// ─────────────────────────────────────────────────────────────────────────────
// socialSchedule.js — calendar-aware auto-slotting. Looks at what's already
// scheduled and proposes the next open, well-spaced posting slot(s) at sensible
// hours — so the agent can "auto-slot" a draft (or a whole batch) onto the
// Calendar without the admin hand-picking each time.
// ─────────────────────────────────────────────────────────────────────────────

// Good local posting hours per day, well-spaced: morning, midday, evening.
// A day is FILLED across these before the schedule advances to the next day.
const POST_HOURS = [9, 13, 18];

function dayKey(dt) { return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`; }

// Stagger a multi-platform post across the calendar: one scheduled doc per
// network, each at its own pre-computed slot — so all the networks don't fire
// at the same single time. One platform → one doc. `base` carries the shared
// fields (body, mediaUrls, format …). Slots run short? later networks reuse the
// last slot rather than dropping the post.
export function staggerByPlatform(base, platforms, slots) {
  const list = (platforms && platforms.length) ? platforms : [null];
  const times = slots && slots.length ? slots : [null];
  return list.map((p, i) => ({
    ...base,
    platforms: p ? [p] : [],
    status: 'scheduled',
    scheduledAt: times[i] || times[times.length - 1] || null,
  }));
}

// Suggest `count` future slots. Packs each day's posting hours (with spacing)
// before moving to the next day — so a batch fills morning/midday/evening rather
// than trickling one-per-day down the calendar. Skips hours already scheduled.
export async function suggestSlots(db, count = 1, opts = {}) {
  const hours = Array.isArray(opts.hours) && opts.hours.length ? opts.hours : POST_HOURS;
  const maxPerDay = Math.max(1, opts.maxPerDay || hours.length);   // default: all daily slots
  const now = new Date();
  const startToday = !!opts.startToday;

  let existing = [];
  try {
    existing = await db.collection('social_posts')
      .find({ status: 'scheduled', archived: { $ne: true }, scheduledAt: { $gte: now } })
      .project({ scheduledAt: 1 }).toArray();
  } catch { /* empty calendar */ }

  // day -> hours already taken (so we don't double-book a slot)
  const dayMap = {};
  for (const p of existing) {
    const dt = new Date(p.scheduledAt);
    (dayMap[dayKey(dt)] = dayMap[dayKey(dt)] || []).push(dt.getHours());
  }

  const slots = [];
  const cursor = new Date(now);
  cursor.setDate(cursor.getDate() + (startToday ? 0 : 1));
  cursor.setHours(0, 0, 0, 0);

  let guard = 0;
  while (slots.length < count && guard++ < 800) {
    const key = dayKey(cursor);
    const used = dayMap[key] || [];
    // Fill every free hour this day (up to maxPerDay) before advancing.
    for (const h of hours) {
      if (slots.length >= count || used.length >= maxPerDay) break;
      if (used.includes(h)) continue;
      const slot = new Date(cursor);
      slot.setHours(h, 0, 0, 0);
      if (slot > now) { slots.push(slot); used.push(h); }
    }
    dayMap[key] = used;
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots.slice(0, count);
}
