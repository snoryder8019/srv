/**
 * Slab — Platform calendar board interactions
 * ─────────────────────────────────────────────────────────────────────────────
 * The calendar is server-rendered: views, ranges and filters are all URL state,
 * so this file owns only what the server cannot — the in-place action menus on
 * event chips, day-cell quick-add seeding, and keyboard navigation.
 *
 * Deliberately dependency-free and idempotent: the same script backs the full
 * /admin/calendar surface and the dashboard marquee.
 */
(function () {
  'use strict';
  if (window.CalBoard) return;

  // ── Action menus ───────────────────────────────────────────────────────────
  // Menus are rendered inline per chip (so they work with JS disabled as plain
  // links once opened by the server); this just handles open/close + focus.
  function closeAll(except) {
    document.querySelectorAll('[data-cal-ev].open').forEach(function (el) {
      if (el !== except) el.classList.remove('open');
    });
  }

  // The menu is position:fixed so no ancestor's overflow can clip it (the month
  // grid clips for its rounded corners). That means WE own its coordinates:
  // anchor to the chip, then keep it inside the viewport on both axes.
  var GAP = 3, EDGE = 8;
  function positionMenu(ev) {
    var menu = ev.querySelector('.cal-menu');
    var face = ev.querySelector('.cal-ev-face');
    if (!menu || !face) return;

    var a = face.getBoundingClientRect();
    // Measure at the anchor's left/top first, then correct — the menu is already
    // display:block by this point, so the rect is real.
    menu.style.left = a.left + 'px';
    menu.style.top = (a.bottom + GAP) + 'px';
    var m = menu.getBoundingClientRect();

    var left = a.left;
    if (left + m.width > window.innerWidth - EDGE) left = window.innerWidth - m.width - EDGE;
    if (left < EDGE) left = EDGE;

    var top = a.bottom + GAP;
    if (top + m.height > window.innerHeight - EDGE) {
      var above = a.top - m.height - GAP;
      top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - m.height - EDGE);
    }

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  // A fixed menu doesn't travel with its chip, so close on scroll/resize rather
  // than leaving it stranded mid-page.
  window.addEventListener('scroll', function () { closeAll(null); }, true);
  window.addEventListener('resize', function () { closeAll(null); });

  function toggle(ev) {
    var isOpen = ev.classList.contains('open');
    closeAll(ev);
    if (isOpen) { ev.classList.remove('open'); return; }
    ev.classList.add('open');
    positionMenu(ev);
  }

  document.addEventListener('click', function (e) {
    var face = e.target.closest ? e.target.closest('.cal-ev-face') : null;
    if (face) {
      e.preventDefault();
      var ev = face.closest('[data-cal-ev]');
      if (ev) toggle(ev);
      return;
    }
    // A click inside an open menu is a real action — let it through untouched.
    if (e.target.closest && e.target.closest('.cal-menu')) return;
    closeAll(null);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeAll(null); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      var face = document.activeElement;
      if (face && face.classList && face.classList.contains('cal-ev-face')) {
        e.preventDefault();
        toggle(face.closest('[data-cal-ev]'));
      }
    }
  });

  // ── Day-cell quick add ─────────────────────────────────────────────────────
  // "+" on a day cell drops that date into the task form and focuses it, so
  // planning a day never means retyping the date.
  function seedTask(dayKey) {
    var due = document.getElementById('taskDue');
    var title = document.getElementById('taskTitle');
    if (due && dayKey) due.value = dayKey;
    var card = document.getElementById('calTask');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (title) setTimeout(function () { title.focus(); }, 220);
  }

  // ── Keyboard range navigation ──────────────────────────────────────────────
  // ← / → walk the range, t jumps to today, d/w/m/y switch views. Ignored while
  // typing in a field.
  var VIEW_KEYS = { d: 'day', w: 'week', m: 'month', y: 'year' };
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    var nav = document.querySelector('.cal-nav');
    if (!nav) return;
    var links = nav.querySelectorAll('.cal-btn');
    if (e.key === 'ArrowLeft' && links[0]) { window.location.href = links[0].href; }
    else if (e.key === 'ArrowRight' && links[2]) { window.location.href = links[2].href; }
    else if (e.key === 't' && links[1]) { window.location.href = links[1].href; }
    else if (VIEW_KEYS[e.key]) {
      var a = document.querySelector('.cal-views a[href*="view=' + VIEW_KEYS[e.key] + '"]');
      if (a) window.location.href = a.href;
    }
  });

  // ── Task edit modal ────────────────────────────────────────────────────────
  // The chip carries its own edit payload (data-cal-edit), so opening the editor
  // is instant and works for a chip anywhere in any view — no fetch, no page
  // change, no losing your place in the month you were reading.
  function pad(n) { return String(n).padStart(2, '0'); }
  function dPart(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function tPart(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }

  function spanHint() {
    var hint = document.getElementById('edSpanHint');
    var a = document.getElementById('edStart'), b = document.getElementById('edDue');
    if (!hint || !a || !b) return;
    if (!a.value || !b.value) { hint.textContent = ''; return; }
    var days = Math.round((new Date(b.value) - new Date(a.value)) / 86400000);
    if (days < 0) hint.textContent = 'The end is before the start — it will be clamped to the start day.';
    else if (days === 0) hint.textContent = 'Single day — shows as a chip.';
    else hint.textContent = 'Spans ' + (days + 1) + ' days — shows as a bar across the calendar.';
  }

  function openEditor(data) {
    var wrap = document.getElementById('calEditWrap');
    var form = document.getElementById('calEditForm');
    if (!wrap || !form || !data) return;
    form.action = '/admin/calendar/tasks/' + data.id;
    setVal('edTitle', data.title);
    setVal('edStart', dPart(data.startAt));
    setVal('edDue', dPart(data.dueAt));
    // An all-day task has no meaningful clock time — leave the time inputs empty
    // rather than showing a 00:00 the user never chose.
    setVal('edStartT', data.allDay ? '' : tPart(data.startAt));
    setVal('edDueT', data.allDay ? '' : tPart(data.dueAt));
    setVal('edClient', data.clientId || '');
    setVal('edProject', data.projectId || '');
    setVal('edWho', data.assignee);
    setVal('edStatus', data.status === 'done' ? 'done' : 'open');
    setVal('edNotes', data.notes);
    spanHint();
    closeAll(null);
    wrap.hidden = false;
    var t = document.getElementById('edTitle');
    if (t) t.focus();
  }

  function closeEditor() {
    var wrap = document.getElementById('calEditWrap');
    if (wrap) wrap.hidden = true;
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-cal-edit]') : null;
    if (btn) {
      e.preventDefault();
      try { openEditor(JSON.parse(btn.getAttribute('data-cal-edit'))); }
      catch (err) { /* malformed payload — leave the menu open rather than break */ }
      return;
    }
    if (e.target.id === 'calEditClose' || e.target.id === 'calEditCancel') { closeEditor(); return; }
    if (e.target.id === 'calEditWrap') closeEditor();   // click the backdrop
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var wrap = document.getElementById('calEditWrap');
    if (wrap && !wrap.hidden) closeEditor();
  });

  document.addEventListener('change', function (e) {
    if (e.target && (e.target.id === 'edStart' || e.target.id === 'edDue')) spanHint();
    // Same project→client inheritance the create form and the server both apply.
    if (e.target && e.target.id === 'edProject') {
      var opt = e.target.options[e.target.selectedIndex];
      var owner = opt && opt.getAttribute('data-client');
      if (owner) setVal('edClient', owner);
    }
  });

  window.CalBoard = { seedTask: seedTask, closeAll: closeAll, openEditor: openEditor };
})();
