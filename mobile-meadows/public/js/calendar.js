// Calendar view logic
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let currentDate = new Date();
let currentMonth = currentDate.getMonth();
let currentYear = currentDate.getFullYear();
let activeFilter = 'all';
let slotsData = [];

const grid = document.getElementById('calendar-grid');
const monthLabel = document.getElementById('cal-month-label');
const slotPanel = document.getElementById('slot-panel');
const slotDateLabel = document.getElementById('slot-date-label');
const slotList = document.getElementById('slot-list');

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.service;
    renderCalendar();
  });
});

// Check URL params for service filter
const params = new URLSearchParams(window.location.search);
if (params.get('service')) {
  activeFilter = params.get('service');
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.service === activeFilter);
  });
}

// Nav
document.getElementById('cal-prev').addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  loadSlots();
});
document.getElementById('cal-next').addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  loadSlots();
});

async function loadSlots() {
  const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const serviceParam = activeFilter !== 'all' ? `&serviceType=${activeFilter}` : '';
  try {
    const res = await fetch(`/api/slots?month=${monthStr}${serviceParam}`);
    const data = await res.json();
    slotsData = data.success ? data.slots : [];
  } catch (e) {
    slotsData = [];
  }
  renderCalendar();
}

function renderCalendar() {
  grid.innerHTML = '';
  monthLabel.textContent = `${MONTHS[currentMonth]} ${currentYear}`;

  // Day headers
  DAYS.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement('div');
    el.className = 'cal-day';

    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const daySlots = slotsData.filter(s => {
      const sd = new Date(s.date).toISOString().split('T')[0];
      return sd === dateStr;
    });

    el.innerHTML = `<span class="day-num">${d}</span>`;

    if (daySlots.length > 0) {
      el.classList.add('has-slots');
      const dots = daySlots.map(s =>
        `<span class="slot-dot ${s.serviceType === 'mobile-repair' ? 'mobile' : 'roof'}"></span>`
      ).join('');
      el.innerHTML += `<div>${dots}</div>`;
      el.addEventListener('click', () => showSlots(dateStr, daySlots));
    }

    grid.appendChild(el);
  }
}

function showSlots(dateStr, slots) {
  slotPanel.style.display = 'block';
  const d = new Date(dateStr + 'T12:00:00');
  slotDateLabel.textContent = d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  slotList.innerHTML = slots.map(s => `
    <div class="slot-item">
      <div class="slot-info">
        <span class="slot-type">${s.serviceType === 'mobile-repair' ? 'Mobile RV Repair' : 'RV Roof Repair'}</span>
        <span class="slot-time">${s.startTime} - ${s.endTime}</span>
        ${s.location && s.location.label ? `<span class="slot-location">${s.location.label}${s.location.address ? ' — ' + s.location.address : ''}</span>` : ''}
      </div>
      <a href="/booking/${s._id}" class="btn btn-primary btn-sm">Book Now</a>
    </div>
  `).join('');
}

// Initial load
loadSlots();
