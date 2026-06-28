// app.js — miSpy controller
import { db, uid } from './db.js';
import { Tracker } from './tracker.js';
import { renderRoute, computeStats } from './route.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  rate: 0.70,
  durationMin: 240,
  startMode: 'now',
  tracker: null,
  trip: null,
  tick: null,
  startTimer: null,
  routePoints: null
};

// ---------- formatting ----------
const pad = (n) => String(n).padStart(2, '0');
function fmtHMS(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const money = (n) => '$' + (Number(n) || 0).toFixed(2);
const miFmt = (n) => (Number(n) || 0).toFixed(2);
const dateStr = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// ---------- tabs ----------
function showTab(name) {
  $$('.screen').forEach(s => s.classList.toggle('hidden', s.dataset.screen !== name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  if (name === 'trips') renderTrips();
  if (name === 'expenses') renderExpenses();
}
$$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---------- single-select chip groups ----------
function chipGroup(containerId, onPick) {
  const c = $('#' + containerId);
  c.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    c.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    chip.classList.add('active');
    onPick(chip);
  });
}
chipGroup('durationChips', (chip) => {
  const v = chip.dataset.min;
  const custom = v === 'custom';
  $('#customWrap').classList.toggle('hidden', !custom);
  if (!custom) state.durationMin = Number(v);
});
chipGroup('startChips', (chip) => {
  state.startMode = chip.dataset.start;
  $('#pinWrap').classList.toggle('hidden', state.startMode !== 'pin');
});

// ---------- tracking ----------
function resolveDuration() {
  const customChip = $('#durationChips .chip.active')?.dataset.min === 'custom';
  if (customChip) {
    const m = Number($('#customMin').value);
    return m > 0 ? m : null;
  }
  return state.durationMin;
}

$('#startBtn').addEventListener('click', async () => {
  const durationMin = resolveDuration();
  if (!durationMin) { alert('Enter a valid duration in minutes.'); return; }

  let startAt = Date.now();
  if (state.startMode === 'pin') {
    const v = $('#pinTime').value;
    if (!v) { alert('Pick a start time.'); return; }
    startAt = new Date(v).getTime();
  }

  const trip = {
    id: uid(),
    label: $('#tripLabel').value.trim() || 'Trip',
    plannedDurationMin: durationMin,
    rate: state.rate,
    createdAt: Date.now(),
    startTime: null,
    endTime: null,
    miles: 0,
    points: [],
    status: 'scheduled'
  };
  state.trip = trip;
  await db.put('trips', trip);

  $('#setupPanel').classList.add('hidden');
  $('#activePanel').classList.remove('hidden');

  const delay = startAt - Date.now();
  if (delay > 1500) {
    setStatus(`Scheduled — starts in ${fmtHMS(delay)}`, false);
    state.startTimer = setInterval(() => {
      const left = startAt - Date.now();
      if (left <= 0) { clearInterval(state.startTimer); beginTracking(); }
      else setStatus(`Scheduled — starts in ${fmtHMS(left)}`, false);
    }, 1000);
  } else {
    beginTracking();
  }
});

async function beginTracking() {
  const trip = state.trip;
  trip.startTime = Date.now();
  trip.status = 'tracking';
  await db.put('trips', trip);

  state.tracker = new Tracker({
    onUpdate: ({ miles, mph }) => {
      $('#liveMiles').textContent = miFmt(miles);
      $('#liveSpeed').textContent = mph.toFixed(1);
    },
    onError: (err) => setStatus('GPS error: ' + (err.message || err.code || err), false)
  });
  await state.tracker.start();
  setStatus('Tracking…', true);

  const endAt = trip.startTime + trip.plannedDurationMin * 60000;
  state.tick = setInterval(async () => {
    const now = Date.now();
    $('#liveElapsed').textContent = fmtHMS(now - trip.startTime);
    $('#liveRemaining').textContent = fmtHMS(endAt - now);
    // persist progress so a crash doesn't lose the trip
    trip.miles = state.tracker.miles;
    trip.points = state.tracker.points;
    await db.put('trips', trip);
    if (now >= endAt) stopTracking(true);
  }, 1000);
}

$('#stopBtn').addEventListener('click', () => stopTracking(false));

async function stopTracking(auto) {
  if (state.startTimer) { clearInterval(state.startTimer); state.startTimer = null; }
  if (state.tick) { clearInterval(state.tick); state.tick = null; }
  const trip = state.trip;
  if (state.tracker) {
    const res = await state.tracker.stop();
    if (trip) { trip.miles = res.miles; trip.points = res.points; }
  }
  if (trip) {
    trip.endTime = Date.now();
    trip.status = trip.startTime ? 'done' : 'cancelled';
    await db.put('trips', trip);
  }
  state.tracker = null; state.trip = null;
  // reset UI
  $('#liveMiles').textContent = '0.00';
  $('#liveElapsed').textContent = '00:00:00';
  $('#liveRemaining').textContent = '--:--:--';
  $('#liveSpeed').textContent = '0.0';
  setStatus(auto ? 'Done — duration reached, trip saved' : 'Stopped — trip saved', false);
  $('#activePanel').classList.add('hidden');
  $('#setupPanel').classList.remove('hidden');
}

function setStatus(text, on) {
  const el = $('#liveStatus');
  el.textContent = text;
  el.classList.toggle('on', !!on);
}

// ---------- trips ----------
async function renderTrips() {
  const trips = (await db.all('trips'))
    .filter(t => t.status === 'done' || t.status === 'tracking')
    .sort((a, b) => (b.startTime || b.createdAt) - (a.startTime || a.createdAt));
  const totalMiles = trips.reduce((s, t) => s + (t.miles || 0), 0);
  const value = trips.reduce((s, t) => s + (t.miles || 0) * (t.rate || state.rate), 0);

  $('#tripsSummary').innerHTML = `
    <div class="stat"><b>${miFmt(totalMiles)}</b><small>total miles</small></div>
    <div class="stat"><b>${money(value)}</b><small>mileage value</small></div>
    <div class="stat"><b>${trips.length}</b><small>trips</small></div>`;

  $('#tripsList').innerHTML = trips.length ? trips.map(t => {
    const dur = t.endTime && t.startTime ? fmtHMS(t.endTime - t.startTime) : 'in progress';
    return `<div class="item" data-trip-open="${t.id}">
      <div class="meta">
        <div class="title">${esc(t.label)}</div>
        <div class="sub">${dateStr(t.startTime || t.createdAt)} · ${dur} · tap to view route</div>
      </div>
      <div class="amt">${miFmt(t.miles)} mi</div>
      <button class="del" data-trip="${t.id}">×</button>
    </div>`;
  }).join('') : '<div class="empty">No trips yet.</div>';

  $$('#tripsList .item').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('.del')) return;
    openRoute(el.dataset.tripOpen);
  }));
  $$('#tripsList .del').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    await db.delete('trips', b.dataset.trip); renderTrips();
  }));
}

// ---------- route overlay ----------
async function openRoute(id) {
  const trip = await db.get('trips', id);
  if (!trip) return;
  state.routePoints = trip.points || [];
  $('#routeTitle').textContent = trip.label || 'Route';
  $('#routeOverlay').classList.remove('hidden');

  const s = computeStats(trip);
  $('#routeStats').innerHTML = `
    <div class="stat"><b>${miFmt(s.miles)}</b><small>miles</small></div>
    <div class="stat"><b>${fmtHMS(s.durMs)}</b><small>duration</small></div>
    <div class="stat"><b>${s.avgMph.toFixed(1)}</b><small>avg mph</small></div>
    <div class="stat"><b>${s.maxMph.toFixed(1)}</b><small>max mph</small></div>`;

  // Draw after layout settles so the canvas has real dimensions.
  requestAnimationFrame(() => renderRoute($('#routeCanvas'), state.routePoints));
}

$('#routeClose').addEventListener('click', () => {
  $('#routeOverlay').classList.add('hidden');
  state.routePoints = null;
});

window.addEventListener('resize', () => {
  if (state.routePoints && !$('#routeOverlay').classList.contains('hidden')) {
    renderRoute($('#routeCanvas'), state.routePoints);
  }
});

// ---------- expenses ----------
$('#addExpBtn').addEventListener('click', async () => {
  const amount = Number($('#expAmount').value);
  if (!(amount > 0)) { alert('Enter an amount.'); return; }
  const exp = {
    id: uid(),
    amount,
    category: $('#expCategory').value,
    note: $('#expNote').value.trim(),
    date: $('#expDate').value || new Date().toISOString().slice(0, 10),
    createdAt: Date.now()
  };
  await db.put('expenses', exp);
  $('#expAmount').value = ''; $('#expNote').value = '';
  renderExpenses();
});

async function renderExpenses() {
  const exps = (await db.all('expenses')).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const expTotal = exps.reduce((s, e) => s + e.amount, 0);
  const trips = await db.all('trips');
  const mileageValue = trips.reduce((s, t) => s + (t.miles || 0) * (t.rate || state.rate), 0);

  $('#expSummary').innerHTML = `
    <div class="stat"><b>${money(expTotal)}</b><small>expenses</small></div>
    <div class="stat"><b>${money(mileageValue)}</b><small>mileage</small></div>
    <div class="stat"><b>${money(expTotal + mileageValue)}</b><small>combined</small></div>`;

  $('#expList').innerHTML = exps.length ? exps.map(e => `
    <div class="item">
      <div class="meta">
        <div class="title">${esc(e.category)}${e.note ? ' · ' + esc(e.note) : ''}</div>
        <div class="sub">${dateStr(e.date)}</div>
      </div>
      <div class="amt">${money(e.amount)}</div>
      <button class="del" data-exp="${e.id}">×</button>
    </div>`).join('') : '<div class="empty">No expenses yet.</div>';

  $$('#expList .del').forEach(b => b.addEventListener('click', async () => {
    await db.delete('expenses', b.dataset.exp); renderExpenses();
  }));
}

// ---------- settings ----------
$('#saveRateBtn').addEventListener('click', async () => {
  const r = Number($('#rateInput').value);
  if (!(r >= 0)) { alert('Enter a valid rate.'); return; }
  state.rate = r;
  await db.setting('rate', r);
  setStatus('Rate saved', false);
});

$('#exportBtn').addEventListener('click', async () => {
  const data = {
    exportedAt: new Date().toISOString(),
    trips: await db.all('trips'),
    expenses: await db.all('expenses'),
    rate: state.rate
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mispy-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- util ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- init ----------
(async function init() {
  const r = await db.setting('rate');
  state.rate = (r === undefined ? 0.70 : r);
  $('#rateInput').value = state.rate;
  $('#expDate').value = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  soon.setSeconds(0, 0);
  $('#pinTime').value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  renderTrips();
})();
