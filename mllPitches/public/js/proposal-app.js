(function () {
  const cfg = window.__PITCH_APP__ || {};
  if (!cfg.slug) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const connPill = $('[data-conn-pill]');
  const rolePill = $('[data-role-pill]');
  const roleSelect = $('[data-role-select]');
  const emailList = $('[data-email-list]');
  const assignForm = $('[data-assign-form]');
  const assignTask = $('[data-assign-task]');
  const assignPerson = $('[data-assign-person]');
  const meterScope = $('[data-meter-scope]');

  // Populate task dropdown from workflow nodes
  if (assignTask) {
    cfg.workflow.nodes.forEach((n) => {
      const og = document.createElement('optgroup');
      og.label = n.name;
      n.tasks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.label}`;
        og.appendChild(opt);
      });
      assignTask.appendChild(og);
    });
  }

  // --- Lookups
  function findRole(id) { return (cfg.roles || []).find((r) => r.id === id); }
  function findControl(id) { return (cfg.controlTypes || []).find((c) => c.id === id); }
  function findNode(id) { return (cfg.workflow?.nodes || []).find((n) => n.id === id); }
  function findTask(nodeId, taskId) {
    const n = findNode(nodeId);
    if (!n) return null;
    return n.tasks.find((t) => t.id === taskId) || null;
  }
  function findParticipant(id) {
    return (cfg.participants || []).find((p) => p.id === id)
      || (cfg.people || []).find((p) => p.id === id)
      || null;
  }
  // Backwards compat for older callers
  function findPerson(id) { return findParticipant(id); }

  // --- Permission registry (mirrors the checkbox matrix; survives switches)
  const permState = {};
  (cfg.permissions || []).forEach((p) => {
    permState[p.id] = new Set(p.granted || []);
  });

  function roleHasPerm(roleId, permId) {
    const set = permState[permId];
    return !!(set && set.has(roleId));
  }

  // Disable / hide DOM affordances that require a perm the current role lacks
  function enforceRolePermissions(roleId) {
    if (!roleId) return;
    document.querySelectorAll('[data-requires-perm]').forEach((el) => {
      const required = (el.dataset.requiresPerm || '').split(/[ ,]+/).filter(Boolean);
      const allowed = required.every((p) => roleHasPerm(roleId, p));
      el.classList.toggle('is-perm-blocked', !allowed);
      // Disable form controls inside the gated container
      el.querySelectorAll('input, select, textarea, button').forEach((c) => {
        if (allowed) {
          if (c.dataset.permOriginallyDisabled === 'true') return;
          c.disabled = false;
        } else {
          if (!c.disabled) c.dataset.permOriginallyDisabled = 'false';
          c.disabled = true;
        }
      });
      // For the BL email list — hide content with a curtain when blocked
      if (el.matches('[data-requires-perm~="read_inbound_emails"]')) {
        el.querySelectorAll('.mll-email').forEach((li) => {
          li.classList.toggle('is-perm-hidden', !allowed);
        });
      }
    });
    // Also gate the permission matrix itself
    const permTable = document.querySelector('[data-perm-table]');
    if (permTable) {
      const canEdit = roleHasPerm(roleId, 'edit_permissions');
      permTable.classList.toggle('is-perm-blocked', !canEdit);
      permTable.querySelectorAll('input[type="checkbox"][data-perm-toggle]').forEach((cb) => {
        cb.disabled = !canEdit;
      });
    }
  }

  let lastRoleId = null;
  function setRolePill(roleId) {
    const r = findRole(roleId);
    if (!r || !rolePill) return;
    rolePill.textContent = r.label;
    rolePill.style.background = r.color;
    document.body.dataset.role = r.id;
    document.body.dataset.scope = r.scope;
    applyScopeMasking(r);
    updateMeterScope(r);
    enforceRolePermissions(r.id);
    if (lastRoleId && lastRoleId !== r.id) {
      resetReviewerForPersona(r);
    }
    lastRoleId = r.id;
  }

  function updateMeterScope(role) {
    if (!meterScope || !role) return;
    const ctrl = findControl(role.defaultControl);
    if (!ctrl) {
      meterScope.textContent = `Acting as ${role.label}.`;
      return;
    }
    meterScope.textContent =
      `Acting as ${role.label} — default control ${ctrl.label} (${ctrl.description}).`;
  }

  function applyScopeMasking(role) {
    const scope = role?.scope || 'all';
    document.querySelectorAll('[data-task-toggle], [data-perm-toggle], [data-perm-control], [data-assign-task], [data-assign-person]')
      .forEach((el) => {
        el.disabled = scope === 'readonly';
      });
    // Visual cue for scope
    $$('.mll-node').forEach((node) => {
      node.classList.remove('is-scope-out');
      if (scope === 'seller' && /buyer|gate/i.test(node.querySelector('strong')?.textContent || '')) {
        node.classList.add('is-scope-out');
      } else if (scope === 'buyer' && /seller/i.test(node.querySelector('strong')?.textContent || '')) {
        node.classList.add('is-scope-out');
      }
    });
  }

  function renderEmail(e) {
    if (!emailList) return;
    const existing = emailList.querySelector(`[data-email-id="${CSS.escape(e.id)}"]`);
    if (existing) existing.remove();
    const li = document.createElement('li');
    const isOutbound = e.direction === 'outbound' || e.tag === 'outbound';
    // New cards default to collapsed, expand on click (accordion)
    li.className = 'mll-email mll-email--new is-collapsed' + (isOutbound ? ' mll-email--outbound' : '');
    li.dataset.emailId = e.id;
    li.dataset.taskId = e.taskId || '';
    li.dataset.tag = e.tag || (isOutbound ? 'outbound' : 'unmatched');
    li.dataset.direction = isOutbound ? 'outbound' : 'inbound';
    const time = (e.receivedAt || '').slice(11, 16) || '';
    li.innerHTML = `
      <button type="button" class="mll-email__toggle" data-email-toggle aria-expanded="false">
        <span class="mll-email__from"></span>
        <span class="mll-email__subj"></span>
        <span class="mll-email__when"></span>
        <span class="mll-email__chev" aria-hidden="true">▸</span>
      </button>
      <div class="mll-email__body">
        <div class="mll-email__hd-actions">
          <button type="button" class="mll-email__cog" data-email-reset aria-label="Reset card" title="Reset card">⚙</button>
        </div>
        <div class="mll-email__snip"></div>
        <div class="mll-email__tag"></div>
        <div class="mll-email__actions">
          <button type="button" class="mll-email__act mll-email__act--reply" data-email-reply>↩ Reply</button>
          <button type="button" class="mll-email__act mll-email__act--del" data-email-delete>🗑 Delete</button>
        </div>
        <form class="mll-email__reply" data-email-reply-form hidden>
          <textarea data-email-reply-text placeholder="Type a reply (simulated — nothing sent)…" rows="2"></textarea>
          <div class="mll-email__reply-actions">
            <button type="submit" class="mll-email__act mll-email__act--send">Send (sim)</button>
            <button type="button" class="mll-email__act mll-email__act--cancel" data-email-reply-cancel>Cancel</button>
          </div>
        </form>
      </div>
    `;
    // Cache the canonical text for reset
    const fromText = isOutbound ? `↗ to ${e.to || 'chris'}` : (e.from || '');
    li.dataset.origFrom = fromText;
    li.dataset.origSubject = e.subject || '';
    li.dataset.origSnippet = e.snippet || '';
    li.querySelector('.mll-email__from').textContent = fromText;
    li.querySelector('.mll-email__when').textContent = time;
    li.querySelector('.mll-email__subj').textContent = e.subject || '';
    li.querySelector('.mll-email__snip').textContent = e.snippet || '';
    const tagEl = li.querySelector('.mll-email__tag');
    const setTag = (html, isHtml) => {
      if (isHtml) tagEl.innerHTML = html;
      else tagEl.textContent = html;
    };
    if (isOutbound) {
      setTag('↗ simulated · demo preview, not delivered');
    } else if (e.taskId) {
      tagEl.innerHTML = '↪ auto-tagged → <code></code>';
      tagEl.querySelector('code').textContent = e.taskId;
      flashTask(e.taskId);
    } else {
      setTag('(no task match)');
    }
    li.dataset.origTagHtml = tagEl.innerHTML;

    wireEmailCard(li);
    emailList.prepend(li);
    setTimeout(() => li.classList.remove('mll-email--new'), 1200);
  }

  // Wire accordion + reply/delete/reset on any email card (JS-rendered or seeded EJS).
  // Idempotent: marks the card so we don't double-bind.
  function wireEmailCard(li) {
    if (li.dataset.wired === '1') return;
    li.dataset.wired = '1';

    // Capture original text for the reset cog (only if not already captured)
    const fromEl = li.querySelector('.mll-email__from');
    const subjEl = li.querySelector('.mll-email__subj');
    const snipEl = li.querySelector('.mll-email__snip');
    const tagEl  = li.querySelector('.mll-email__tag');
    if (!li.dataset.origFrom    && fromEl) li.dataset.origFrom = fromEl.textContent || '';
    if (!li.dataset.origSubject && subjEl) li.dataset.origSubject = subjEl.textContent || '';
    if (!li.dataset.origSnippet && snipEl) li.dataset.origSnippet = snipEl.textContent || '';
    if (!li.dataset.origTagHtml && tagEl)  li.dataset.origTagHtml = tagEl.innerHTML || '';

    const toggle    = li.querySelector('[data-email-toggle]');
    const replyBtn  = li.querySelector('[data-email-reply]');
    const delBtn    = li.querySelector('[data-email-delete]');
    const resetBtn  = li.querySelector('[data-email-reset]');
    const replyForm = li.querySelector('[data-email-reply-form]');
    const replyText = li.querySelector('[data-email-reply-text]');
    const replyCancel = li.querySelector('[data-email-reply-cancel]');

    if (toggle) {
      toggle.addEventListener('click', () => {
        if (emailList) {
          emailList.querySelectorAll('.mll-email:not(.is-collapsed)').forEach((other) => {
            if (other !== li) {
              other.classList.add('is-collapsed');
              const t = other.querySelector('[data-email-toggle]');
              if (t) t.setAttribute('aria-expanded', 'false');
            }
          });
        }
        const wasCollapsed = li.classList.contains('is-collapsed');
        li.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', wasCollapsed ? 'true' : 'false');
      });
    }

    function openReply() {
      if (!replyForm) return;
      replyForm.hidden = false;
      li.classList.add('is-replying');
      setTimeout(() => replyText && replyText.focus(), 0);
    }
    function closeReply() {
      if (!replyForm) return;
      replyForm.hidden = true;
      li.classList.remove('is-replying');
    }
    function resetCard() {
      closeReply();
      if (replyText) replyText.value = '';
      li.classList.remove('is-deleted', 'is-replied');
      if (fromEl) fromEl.textContent = li.dataset.origFrom || '';
      if (subjEl) subjEl.textContent = li.dataset.origSubject || '';
      if (snipEl) snipEl.textContent = li.dataset.origSnippet || '';
      if (tagEl)  tagEl.innerHTML    = li.dataset.origTagHtml || '';
    }

    if (replyBtn) replyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (li.classList.contains('is-replying')) closeReply();
      else openReply();
    });
    if (replyCancel) replyCancel.addEventListener('click', (ev) => { ev.stopPropagation(); closeReply(); });
    if (replyForm) replyForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const txt = ((replyText && replyText.value) || '').trim();
      if (!txt) return;
      li.classList.add('is-replied');
      closeReply();
      if (tagEl) tagEl.textContent = `↩ replied (simulated) · "${txt.slice(0, 60)}${txt.length > 60 ? '…' : ''}"`;
    });
    if (delBtn) delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      li.classList.add('is-deleting');
      setTimeout(() => {
        li.classList.remove('is-deleting');
        li.classList.add('is-deleted');
      }, 250);
    });
    if (resetBtn) resetBtn.addEventListener('click', (ev) => { ev.stopPropagation(); resetCard(); });
  }

  // Wire any cards seeded by EJS on first load
  $$('.mll-email').forEach((li) => wireEmailCard(li));

  function flashTask(taskId) {
    const t = document.querySelector(`.mll-task[data-task-id="${CSS.escape(taskId)}"]`);
    if (t) {
      t.classList.add('mll-task--flash');
      setTimeout(() => t.classList.remove('mll-task--flash'), 1500);
    }
    // Also flash in popover if open
    const pt = document.querySelector(`[data-popover-task="${CSS.escape(taskId)}"]`);
    if (pt) {
      pt.classList.add('mll-task--flash');
      setTimeout(() => pt.classList.remove('mll-task--flash'), 1500);
    }
  }

  // --- Task patch logic
  // Track local task done-state by taskId, so checkboxes that live inside the
  // ephemeral popover don't lose their state when the popover is rebuilt.
  const taskState = {};
  (cfg.workflow?.nodes || []).forEach((n) => {
    n.tasks.forEach((t) => { taskState[t.id] = !!t.done; });
  });

  function nodeOfTask(taskId) {
    const nodes = cfg.workflow?.nodes || [];
    for (const n of nodes) {
      if (n.tasks.some((t) => t.id === taskId)) return n;
    }
    return null;
  }

  function applyTaskPatch(patch) {
    if (!patch || !patch.taskId) return;
    if (typeof patch.done === 'boolean') taskState[patch.taskId] = patch.done;
    const t = document.querySelector(`.mll-task[data-task-id="${CSS.escape(patch.taskId)}"]`);
    if (t) {
      if (typeof patch.done === 'boolean') {
        const cb = t.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = patch.done;
      }
      if (patch.assignee) {
        const a = t.querySelector('[data-task-assignee]');
        const person = findParticipant(patch.assignee);
        if (a) a.textContent = person ? person.name : patch.assignee;
      }
    }
    // Sync popover checkbox if it's currently open
    const pcb = document.querySelector(`[data-popover-task="${CSS.escape(patch.taskId)}"] input[type="checkbox"]`);
    if (pcb && typeof patch.done === 'boolean') pcb.checked = patch.done;
    flashTask(patch.taskId);
    const node = nodeOfTask(patch.taskId);
    if (node) recomputeMeter(node.id);
  }

  function applyPermissionPatch(change) {
    if (!change || !change.perm || !change.role) return;
    // Checkbox shape — sync registry + DOM + re-enforce gating
    if (typeof change.value === 'boolean') {
      if (permState[change.perm]) {
        if (change.value) permState[change.perm].add(change.role);
        else permState[change.perm].delete(change.role);
      }
      const cb = document.querySelector(
        `input[data-perm-toggle][data-perm="${CSS.escape(change.perm)}"][data-role="${CSS.escape(change.role)}"]`,
      );
      if (cb) cb.checked = !!change.value;
      enforceRolePermissions(roleSelect?.value);
      return;
    }
    // Legacy control-type shape (older clients) — no-op on registry
    if (typeof change.control === 'string') {
      const sel = document.querySelector(
        `select[data-perm-control][data-perm="${CSS.escape(change.perm)}"][data-role="${CSS.escape(change.role)}"]`,
      );
      if (sel) sel.value = change.control;
    }
  }

  // --- Meter recompute
  function recomputeMeter(nodeId) {
    const node = findNode(nodeId);
    if (!node) return;
    const total = node.tasks.length || 1;
    let done = 0;
    node.tasks.forEach((t) => { if (taskState[t.id]) done += 1; });
    const pct = Math.round((done / total) * 100);
    const btn = document.querySelector(`[data-meter] [data-node-id="${CSS.escape(nodeId)}"]`)
      || document.querySelector(`[data-meter-row] [data-node-id="${CSS.escape(nodeId)}"]`)
      || document.querySelector(`.meter-node[data-node-id="${CSS.escape(nodeId)}"]`);
    if (btn) {
      btn.dataset.pct = String(pct);
      btn.style.setProperty('--pct', pct + '%');
      const fill = btn.querySelector('.meter-fill');
      if (fill) fill.style.width = pct + '%';
      const label = btn.querySelector('.mll-meter__pct');
      if (label) label.textContent = pct + '%';
    }
    return pct;
  }

  // --- Connect socket
  const socket = window.io ? window.io({ path: '/socket.io' }) : null;
  if (!socket) {
    if (connPill) { connPill.textContent = 'socket.io not loaded'; connPill.classList.add('is-bad'); }
    return;
  }

  socket.on('connect', () => {
    if (connPill) { connPill.textContent = 'live'; connPill.classList.add('is-ok'); }
    socket.emit('pitch:join', { slug: cfg.slug });
  });
  socket.on('disconnect', () => {
    if (connPill) { connPill.textContent = 'offline'; connPill.classList.remove('is-ok'); connPill.classList.add('is-bad'); }
  });

  socket.on('pitch:state', (state) => {
    if (state?.role) {
      roleSelect.value = state.role;
      setRolePill(state.role);
    }
  });
  socket.on('pitch:role', ({ role }) => {
    if (roleSelect.value !== role) roleSelect.value = role;
    setRolePill(role);
  });
  socket.on('pitch:workflow', (patch) => applyTaskPatch(patch));
  socket.on('pitch:permission', (change) => applyPermissionPatch(change));
  socket.on('pitch:assign', (patch) => applyTaskPatch(patch));
  socket.on('pitch:email', (email) => renderEmail(email));
  socket.on('pitch:node-complete', ({ nodeId, ts }) => {
    synthesizeOutboundEmail(nodeId, ts);
  });

  // --- Wire UI
  setRolePill(roleSelect.value);
  // First-paint meter sync
  (cfg.workflow?.nodes || []).forEach((n) => recomputeMeter(n.id));

  roleSelect.addEventListener('change', () => {
    setRolePill(roleSelect.value);
    socket.emit('pitch:role', { slug: cfg.slug, role: roleSelect.value });
  });

  // Legacy task checkboxes (still in DOM in TL pane, if any)
  $$('[data-task-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const patch = { taskId: cb.dataset.taskId, done: cb.checked };
      taskState[patch.taskId] = patch.done;
      socket.emit('pitch:workflow', { slug: cfg.slug, patch });
      flashTask(patch.taskId);
      const node = nodeOfTask(patch.taskId);
      if (node) {
        recomputeMeter(node.id);
        checkNodeCompletion(node.id, patch.taskId);
      }
    });
  });

  // NEW: control-type permission selects
  $$('[data-perm-control]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const change = {
        perm: sel.dataset.perm,
        role: sel.dataset.role,
        control: sel.value,
      };
      socket.emit('pitch:permission', { slug: cfg.slug, change });
    });
  });

  // Permission matrix checkboxes — update registry + emit + re-enforce gating
  $$('[data-perm-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const perm = cb.dataset.perm;
      const role = cb.dataset.role;
      const value = cb.checked;
      if (permState[perm]) {
        if (value) permState[perm].add(role);
        else permState[perm].delete(role);
      }
      socket.emit('pitch:permission', { slug: cfg.slug, change: { perm, role, value } });
      // Re-evaluate gating for the role currently acting
      enforceRolePermissions(roleSelect?.value);
    });
  });

  if (assignForm) {
    assignForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const taskId = assignTask.value;
      const personId = assignPerson.value;
      const patch = { taskId, assignee: personId };
      socket.emit('pitch:assign', { slug: cfg.slug, assignment: patch });
      applyTaskPatch(patch);
    });
  }

  // === Horizontal meter modal (click to open, X to close) ===
  let popover = document.querySelector('[data-meter-popover]');
  if (!popover) {
    popover = document.createElement('div');
    popover.setAttribute('data-meter-popover', '');
    popover.className = 'mll-meter-popover';
    popover.hidden = true;
    document.body.appendChild(popover);
  } else if (popover.parentElement !== document.body) {
    // Re-parent to <body> — guarantees position:fixed is viewport-relative
    // regardless of any ancestor's containing-block influence (overflow/transform).
    document.body.appendChild(popover);
  }
  popover.classList.add('mll-meter-modal');

  // Backdrop element (sibling of modal — click anywhere outside the panel closes)
  let backdrop = document.querySelector('[data-meter-backdrop]');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.setAttribute('data-meter-backdrop', '');
    backdrop.className = 'mll-meter-backdrop';
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
  }
  let popoverNodeId = null;
  let lastTrigger = null;

  function hidePopover() {
    if (popover.hidden) return;
    popover.hidden = true;
    backdrop.hidden = true;
    popoverNodeId = null;
    document.body.classList.remove('mll-meter-modal-open');
    if (lastTrigger) { try { lastTrigger.focus({ preventScroll: true }); } catch (_) {} }
    lastTrigger = null;
  }

  function viewerControlRank() {
    const r = findRole(roleSelect?.value);
    const id = r?.defaultControl || 'C1';
    return parseInt(id.replace(/^C/, ''), 10) || 1;
  }
  function controlRank(id) { return parseInt(String(id || 'C1').replace(/^C/, ''), 10) || 1; }

  function fmtDeadline(iso) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
    } catch (_) { return iso; }
  }

  function buildPopoverContent(node) {
    const owner = findParticipant(node.owner);
    const ownerName = owner ? owner.name : (node.owner || '—');
    const viewerRank = viewerControlRank();

    const tasksHtml = node.tasks.map((t) => {
      const assignee = findParticipant(t.assignee);
      const aName = assignee ? assignee.name : (t.assignee || '—');
      const ctrl = findControl(t.controlRequired);
      const ctrlColor = ctrl?.color || '#94a3b8';
      const ctrlId = ctrl?.id || (t.controlRequired || 'C1');
      const requiredRank = controlRank(ctrlId);
      const canToggle = viewerRank >= requiredRank;
      const checked = taskState[t.id] ? 'checked' : '';
      const disabled = canToggle ? '' : 'disabled';
      return `
        <li class="mll-meter-popover__task" data-popover-task="${t.id}">
          <label>
            <input type="checkbox" data-popover-task-cb data-task-id="${t.id}" data-node-id="${node.id}" ${checked} ${disabled} />
            <span class="mll-meter-popover__label">${escapeHtml(t.label)}</span>
          </label>
          <span class="mll-meter-popover__assignee">${escapeHtml(aName)}</span>
          <span class="mll-meter-popover__deadline">${fmtDeadline(t.deadline)}</span>
          <span class="mll-meter-popover__ctrl" style="background:${ctrlColor};color:#fff" title="${escapeHtml(ctrl?.label || '')}">${ctrlId}</span>
        </li>
      `;
    }).join('');

    popover.innerHTML = `
      <button type="button" class="mll-meter-popover__close" data-popover-close aria-label="Close">×</button>
      <div class="mll-meter-popover__hd">
        <strong class="mll-meter-popover__name">${escapeHtml(node.name)}</strong>
        ${node.isGate ? '<span class="mll-meter-popover__gate">GATE</span>' : ''}
      </div>
      <div class="mll-meter-popover__meta">
        <span>Owner: ${escapeHtml(ownerName)}</span>
        <span>Deadline: ${fmtDeadline(node.deadline)}</span>
      </div>
      <ul class="mll-meter-popover__tasks">${tasksHtml}</ul>
    `;
    // Wire X close
    const closeBtn = popover.querySelector('[data-popover-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => hidePopover());

    // Wire each task checkbox
    popover.querySelectorAll('[data-popover-task-cb]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const taskId = cb.dataset.taskId;
        const nodeId = cb.dataset.nodeId;
        const done = cb.checked;
        taskState[taskId] = done;
        // Mirror to any legacy DOM task
        const legacy = document.querySelector(`.mll-task[data-task-id="${CSS.escape(taskId)}"] input[type="checkbox"]`);
        if (legacy) legacy.checked = done;
        socket.emit('pitch:workflow', { slug: cfg.slug, patch: { taskId, done } });
        flashTask(taskId);
        recomputeMeter(nodeId);
        checkNodeCompletion(nodeId, taskId);
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showPopoverForNode(btn) {
    const nodeId = btn.dataset.nodeId;
    const node = findNode(nodeId);
    if (!node) return;
    lastTrigger = btn;
    popoverNodeId = nodeId;
    buildPopoverContent(node);
    // Center via CSS — no inline positioning (modal style)
    popover.style.position = '';
    popover.style.left = '';
    popover.style.top = '';
    popover.style.visibility = '';
    backdrop.hidden = false;
    popover.hidden = false;
    document.body.classList.add('mll-meter-modal-open');
    // Focus the close button for keyboard users
    const closeBtn = popover.querySelector('[data-popover-close]');
    if (closeBtn) { setTimeout(() => closeBtn.focus({ preventScroll: true }), 0); }
  }

  function wireMeterNode(btn) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      showPopoverForNode(btn);
    });
  }

  $$('[data-meter] [data-node-id], [data-meter-row] [data-node-id], .meter-node[data-node-id]')
    .forEach((btn) => wireMeterNode(btn));

  // Backdrop is purely visual now — only the X button or Escape closes.
  // (Clicking off-modal shouldn't dismiss; users need a deliberate close.)
  // Stop clicks from inside the modal bubbling to anything below.
  popover.addEventListener('click', (e) => e.stopPropagation());

  // Escape closes
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !popover.hidden) hidePopover();
  });

  // === Reviewer agent (Ollama via /api/agent/:slug) ===
  const reviewer = $('[data-reviewer]');
  const reviewerMsgs = $('[data-reviewer-msgs]');
  const reviewerForm = $('[data-reviewer-form]');
  const reviewerInput = $('[data-reviewer-input]');
  const reviewerToggle = $('[data-reviewer-toggle]');
  let lastReviewAt = 0;
  let reviewInflight = false;
  const nodeCompleteFiredAt = {}; // nodeId -> timestamp
  let taskToggleDebounceTimer = null;

  function readWorkflowState() {
    return {
      nodes: cfg.workflow.nodes.map((n) => ({
        ...n,
        tasks: n.tasks.map((t) => {
          const el = document.querySelector(`.mll-task[data-task-id="${CSS.escape(t.id)}"]`);
          const cb = el?.querySelector('input[type="checkbox"]');
          const a = el?.querySelector('[data-task-assignee]');
          return {
            ...t,
            done: typeof taskState[t.id] === 'boolean'
              ? taskState[t.id]
              : (cb ? cb.checked : t.done),
            assignee: a ? a.textContent.trim() : t.assignee,
          };
        }),
      })),
    };
  }

  function readRecentEmails() {
    return Array.from(document.querySelectorAll('.mll-email')).slice(0, 5).map((li) => ({
      from: li.querySelector('.mll-email__from')?.textContent || '',
      subject: li.querySelector('.mll-email__subj')?.textContent || '',
      taskId: li.dataset.taskId || null,
    }));
  }

  function appendReviewerMsg(text, who) {
    if (!reviewerMsgs) return;
    const d = document.createElement('div');
    d.className = `mll-reviewer__msg mll-reviewer__msg--${who}`;
    d.textContent = text;
    reviewerMsgs.appendChild(d);
    reviewerMsgs.scrollTop = reviewerMsgs.scrollHeight;
  }

  async function askReviewer(question, { isAuto } = {}, extra) {
    if (reviewInflight) return;
    reviewInflight = true;
    const role = roleSelect?.value || 'meridian-superadmin';
    const payload = {
      question,
      role,
      currentDealId: cfg.currentDealId || (dealSelect && dealSelect.value) || null,
      workflow: readWorkflowState(),
      recentEmails: readRecentEmails(),
    };
    if (extra && typeof extra === 'object' && extra.trigger) {
      payload.trigger = extra.trigger;
    }
    if (!isAuto) appendReviewerMsg(question, 'user');
    const thinking = document.createElement('div');
    thinking.className = 'mll-reviewer__msg mll-reviewer__msg--agent mll-reviewer__msg--thinking';
    thinking.textContent = 'thinking…';
    if (reviewerMsgs) {
      reviewerMsgs.appendChild(thinking);
      reviewerMsgs.scrollTop = reviewerMsgs.scrollHeight;
    }
    try {
      const r = await fetch(`/api/agent/${cfg.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      thinking.remove();
      if (!r.ok) {
        appendReviewerMsg(`(agent error · ${j.error || r.status})`, 'agent');
      } else {
        appendReviewerMsg(j.reply || '(no reply)', 'agent');
      }
    } catch (err) {
      thinking.remove();
      appendReviewerMsg(`(network: ${err.message})`, 'agent');
    } finally {
      reviewInflight = false;
    }
  }

  function maybeAutoReview(reason) {
    const now = Date.now();
    if (now - lastReviewAt < 8000) return;
    lastReviewAt = now;
    askReviewer(`State changed (${reason}). Give me the next call — 2 sentences max.`, { isAuto: true });
  }

  // Clear reviewer chat + post fresh "new simulation started as <Role>. Go ahead." notice
  function resetReviewerForPersona(role) {
    if (!reviewerMsgs) return;
    reviewerMsgs.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'mll-reviewer__msg mll-reviewer__msg--system';
    d.textContent = `— New simulation · acting as ${role.label}. Reviewer thread cleared. Go ahead.`;
    reviewerMsgs.appendChild(d);
    reviewerMsgs.scrollTop = reviewerMsgs.scrollHeight;
    // Allow the next auto-review to fire immediately (don't honor the 8s window across persona switches)
    lastReviewAt = 0;
    // Cancel any pending task-toggle debounce so it doesn't leak into the new persona
    if (taskToggleDebounceTimer) { clearTimeout(taskToggleDebounceTimer); taskToggleDebounceTimer = null; }
  }

  // Render a SIMULATED INBOUND "what's next" email when a node completes.
  // Pure demo — no SMTP, no IMAP, nothing leaves the browser.
  const inboundSimSent = new Set();
  function synthesizeInboundNextStep(nodeId, ts) {
    const node = findNode(nodeId);
    if (!node) return;
    const ksig = `next-${nodeId}@${ts || ''}`;
    if (inboundSimSent.has(ksig)) return;
    inboundSimSent.add(ksig);
    const nodes = cfg.workflow?.nodes || [];
    const idx = nodes.findIndex((n) => n.id === nodeId);
    const nextNode = idx >= 0 ? nodes[idx + 1] : null;
    let subject, snippet, taskId, fromAddr;
    if (nextNode) {
      const firstTask = (nextNode.tasks || [])[0];
      const assignee = firstTask ? findParticipant(firstTask.assignee) : null;
      const aName = assignee ? assignee.name : (firstTask?.assignee || nextNode.owner || 'team');
      const due = firstTask?.deadline ? fmtDeadline(firstTask.deadline) : (nextNode.deadline ? fmtDeadline(nextNode.deadline) : 'TBD');
      subject = `Next up · ${nextNode.name}`;
      snippet = `${node.name} closed. First task in ${nextNode.name}: "${firstTask?.label || nextNode.name}" — owner ${aName}, due ${due}.`;
      taskId = firstTask?.id || null;
      fromAddr = 'pipeline@demo.local';
    } else {
      subject = `Deal closed · ${node.name} was the last stage`;
      snippet = `All pipeline stages complete. Ready to package the IC memo and final deliverables.`;
      taskId = null;
      fromAddr = 'pipeline@demo.local';
    }
    renderEmail({
      id: `sim-next-${nodeId}-${ts || 'local'}`,
      direction: 'inbound',
      from: fromAddr,
      subject: `[sim] ${subject}`,
      snippet,
      receivedAt: ts || new Date().toISOString(),
      taskId,
      tag: taskId ? 'matched' : 'unmatched',
    });
  }
  // Back-compat alias for any older callsite
  const synthesizeOutboundEmail = synthesizeInboundNextStep;

  // Node-complete + task-toggle agent triggers
  function checkNodeCompletion(nodeId, toggledTaskId) {
    const node = findNode(nodeId);
    if (!node) return;
    const total = node.tasks.length || 0;
    if (!total) return;
    let done = 0;
    node.tasks.forEach((t) => { if (taskState[t.id]) done += 1; });
    const now = Date.now();
    if (done === total) {
      const last = nodeCompleteFiredAt[nodeId] || 0;
      if (now - last < 8000) return;
      nodeCompleteFiredAt[nodeId] = now;
      // Tell the server about node membership so it can broadcast pitch:node-complete
      const taskIds = node.tasks.map((t) => t.id);
      socket.emit('pitch:workflow', {
        slug: cfg.slug,
        patch: { taskId: toggledTaskId, done: true, nodeId, nodeCompletedTaskIds: taskIds },
      });
      // Also synthesize the outbound email locally so the trigger sees it immediately
      synthesizeOutboundEmail(nodeId, new Date().toISOString());
      const q = `Node ${node.name} is now 100% complete. Confirm closure and announce the next node + its first blocking task. 2 sentences max.`;
      askReviewer(q, { isAuto: true }, { trigger: 'node-complete' });
      return;
    }
    // Not complete — debounced task-toggle ping
    if (toggledTaskId) {
      const task = findTask(nodeId, toggledTaskId);
      if (!task) return;
      if (taskToggleDebounceTimer) clearTimeout(taskToggleDebounceTimer);
      taskToggleDebounceTimer = setTimeout(() => {
        const q = `Task ${task.label} completed in ${node.name}. What's the next blocking task in this node? 1 sentence.`;
        askReviewer(q, { isAuto: true }, { trigger: 'task-toggle' });
      }, 4000);
    }
  }

  if (reviewerForm) {
    reviewerForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = reviewerInput.value.trim();
      if (!q) return;
      reviewerInput.value = '';
      askReviewer(q);
    });
  }
  if (reviewerToggle) {
    reviewerToggle.addEventListener('click', () => reviewer.classList.toggle('is-collapsed'));
  }

  // Auto-review hooks
  roleSelect.addEventListener('change', () => maybeAutoReview('role switch'));
  document.querySelectorAll('[data-task-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => maybeAutoReview('task toggle'));
  });
  socket.on('pitch:email', () => maybeAutoReview('new email'));

  // First review on connect
  socket.on('connect', () => {
    setTimeout(() => maybeAutoReview('initial join'), 1500);
  });

  // === Multi-deal dropdown — repopulates the entire dashboard ===
  const dealSelect = $('[data-deal-select]');
  const dealPill = $('[data-deal-pill]');
  const fmtMoney = (n) => '$' + (n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'K');

  function renderMeter(workflow) {
    const meter = $('[data-meter]');
    if (!meter) return;
    meter.innerHTML = '';
    workflow.nodes.forEach((n, i) => {
      const totalT = n.tasks.length;
      const doneT = n.tasks.filter((t) => taskState[t.id]).length;
      const pct = totalT ? Math.round(100 * doneT / totalT) : 0;
      const near = pct >= 70 && pct < 100;
      if (i > 0) {
        const joint = document.createElement('span');
        joint.className = 'mll-meter__joint';
        joint.setAttribute('aria-hidden', 'true');
        meter.appendChild(joint);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = ['mll-meter__node', n.isGate ? 'is-gate' : '', pct === 100 ? 'is-complete' : '', near ? 'is-near' : '']
        .filter(Boolean).join(' ');
      btn.dataset.nodeId = n.id;
      btn.dataset.status = n.status || '';
      btn.dataset.pct = String(pct);
      btn.style.setProperty('--pct', pct + '%');
      const ownerName = (findParticipant(n.owner) || {}).name || n.owner || '';
      btn.innerHTML = `
        <span class="mll-meter__idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="mll-meter__name">${escapeHtml(n.name)}${n.isGate ? ' <em>GATE</em>' : ''}</span>
        <span class="mll-meter__bar"><span class="mll-meter__fill"></span></span>
        <span class="mll-meter__foot">
          <span class="mll-meter__owner">${escapeHtml(ownerName)}</span>
          <span class="mll-meter__deadline">${(n.deadline || '').slice(0, 10)}</span>
          <span class="mll-meter__pct">${pct}%</span>
        </span>
      `;
      meter.appendChild(btn);
      wireMeterNode(btn);
    });
  }

  function renderPeople(peopleList) {
    const list = $('.mll-people-list');
    if (!list) return;
    const max = peopleList.reduce((m, x) => Math.max(m, x.total), 1);
    list.innerHTML = peopleList.map((p) => {
      const name = p.person ? p.person.name : p.id;
      const title = p.person ? p.person.title : '';
      const side = p.person ? p.person.side : '';
      const wPct = Math.max(6, Math.round(100 * p.total / max));
      const dPct = wPct * (p.total ? p.done / p.total : 0);
      return `
        <li class="mll-people-row" data-side="${side || ''}">
          <div class="mll-people-row__hd">
            <span class="mll-people-row__name">${escapeHtml(name)}</span>
            <span class="mll-people-row__count">${p.done}/${p.total}</span>
          </div>
          <div class="mll-people-row__title">${escapeHtml(title || '')}${side ? ' · ' + side + '-side' : ''}</div>
          <div class="mll-people-row__bar">
            <span class="mll-people-row__bar-total" style="width: ${wPct}%"></span>
            <span class="mll-people-row__bar-done" style="width: ${dPct}%"></span>
          </div>
        </li>
      `;
    }).join('');
  }

  function renderWaterfall(value) {
    const wf = $('.mll-waterfall');
    if (!wf) return;
    const max = Math.max(...value.map((s) => s.value));
    wf.innerHTML = value.map((s) => {
      const h = Math.round(100 * s.value / max);
      const cls = s.delta < 0 ? 'is-down' : (s.delta > 0 ? 'is-up' : 'is-flat');
      const deltaStr = s.delta === 0
        ? '—'
        : (s.delta < 0 ? '−' : '+') + '$' + Math.abs(s.delta / 1000000).toFixed(1) + 'M';
      return `
        <div class="mll-waterfall__col ${cls}" title="${escapeHtml(s.label)}">
          <div class="mll-waterfall__num">$${(s.value / 1000000).toFixed(1)}M</div>
          <div class="mll-waterfall__bar" style="--h: ${h}%"></div>
          <div class="mll-waterfall__delta">${deltaStr}</div>
          <div class="mll-waterfall__lbl">${escapeHtml(s.label)}</div>
        </div>
      `;
    }).join('');
    const headNum = $('.mll-dash__cell--value .mll-dash__head-num');
    if (headNum && value.length) headNum.textContent = '$' + (value[value.length - 1].value / 1000000).toFixed(1) + 'M';
  }

  function renderKpis(risk) {
    const map = {
      open: '.mll-kpi--accent strong',
      blocked: '.mll-kpi--danger strong',
      gates: '.mll-kpi--warn strong',
      signoffs: '.mll-kpi--ok strong',
    };
    Object.entries(map).forEach(([k, sel]) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = String(risk[k] != null ? risk[k] : 0);
    });
  }

  function rebuildAssignTaskDropdown(workflow) {
    if (!assignTask) return;
    assignTask.innerHTML = '';
    workflow.nodes.forEach((n) => {
      const og = document.createElement('optgroup');
      og.label = n.name;
      n.tasks.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        og.appendChild(opt);
      });
      assignTask.appendChild(og);
    });
  }

  function renderEmailList(emails) {
    if (!emailList) return;
    emailList.innerHTML = '';
    if (typeof inboundSimSent !== 'undefined') inboundSimSent.clear();
    (emails || []).forEach((e) => renderEmail(e));
  }

  function applyDeal(dealId, opts = {}) {
    const d = (cfg.dealData || {})[dealId];
    if (!d) return;
    cfg.workflow = d.workflow;
    cfg.currentDealId = dealId;
    // Re-seed task state from this deal's workflow
    Object.keys(taskState).forEach((k) => delete taskState[k]);
    d.workflow.nodes.forEach((n) => n.tasks.forEach((t) => { taskState[t.id] = !!t.done; }));
    // Re-render every widget that depends on deal data
    renderMeter(d.workflow);
    renderPeople(d.people);
    renderWaterfall(d.value);
    renderKpis(d.risk);
    renderEmailList(d.emails);
    rebuildAssignTaskDropdown(d.workflow);
    // Reset node-complete debounces so the new deal can fire fresh
    Object.keys(nodeCompleteFiredAt).forEach((k) => delete nodeCompleteFiredAt[k]);
    // Close any open modal (the node IDs may have changed under it)
    hidePopover();
    // Update the meter-scope sentence
    const role = findRole(roleSelect?.value);
    if (role) updateMeterScope(role);
    // Update top-strip pill
    if (dealPill && d.meta) {
      dealPill.style.borderLeftColor = d.meta.color || '#4338CA';
      const b = $('[data-deal-pill-buyer]', dealPill);
      const s = $('[data-deal-pill-seller]', dealPill);
      const v = $('[data-deal-pill-value]', dealPill);
      if (b) b.textContent = d.meta.buyer || '';
      if (s) s.textContent = d.meta.seller || '';
      if (v) v.textContent = fmtMoney(d.meta.value || 0);
    }
    if (!opts.silent && reviewerMsgs && d.meta) {
      reviewerMsgs.innerHTML = '';
      const m = document.createElement('div');
      m.className = 'mll-reviewer__msg mll-reviewer__msg--system';
      m.textContent = `— Switched deal · now viewing ${d.meta.buyer} ↔ ${d.meta.seller} (${d.meta.stage}, ${fmtMoney(d.meta.value)}). Dashboard repopulated.`;
      reviewerMsgs.appendChild(m);
      lastReviewAt = 0;
    }
  }

  if (dealSelect) {
    dealSelect.addEventListener('change', () => {
      applyDeal(dealSelect.value);
      socket.emit('pitch:role', { slug: cfg.slug, role: roleSelect?.value, deal: dealSelect.value });
    });
  }

  // === Excel upload → LLM summary widget ===
  const xlsxForm = $('[data-xlsx-form]');
  if (xlsxForm) {
    const xlsxInput = $('[data-xlsx-input]', xlsxForm);
    const xlsxDrop = $('[data-xlsx-drop]', xlsxForm);
    const xlsxName = $('[data-xlsx-name]', xlsxForm);
    const xlsxSubmit = $('[data-xlsx-submit]', xlsxForm);
    const xlsxResult = $('[data-xlsx-result]');
    let currentFile = null;

    function setFile(f) {
      currentFile = f || null;
      if (currentFile) {
        xlsxName.textContent = `${currentFile.name} · ${(currentFile.size / 1024).toFixed(0)} KB`;
        xlsxSubmit.disabled = false;
        xlsxDrop.classList.add('has-file');
      } else {
        xlsxName.textContent = 'Drop XLSX/CSV here or click';
        xlsxSubmit.disabled = true;
        xlsxDrop.classList.remove('has-file');
      }
    }

    xlsxInput.addEventListener('change', () => setFile(xlsxInput.files?.[0]));
    ['dragenter', 'dragover'].forEach((ev) => {
      xlsxDrop.addEventListener(ev, (e) => { e.preventDefault(); xlsxDrop.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      xlsxDrop.addEventListener(ev, (e) => { e.preventDefault(); xlsxDrop.classList.remove('is-drag'); });
    });
    xlsxDrop.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        xlsxInput.files = e.dataTransfer.files;
        setFile(f);
      }
    });

    xlsxForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!currentFile) return;
      xlsxSubmit.disabled = true;
      xlsxResult.hidden = false;
      xlsxResult.innerHTML = '<div class="mll-xlsx__loading">Parsing + summarizing… <span></span></div>';
      try {
        const fd = new FormData();
        fd.append('file', currentFile);
        const r = await fetch(`/api/excel/${cfg.slug}`, { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) {
          xlsxResult.innerHTML = `<div class="mll-xlsx__err">${j.error || 'error'}${j.detail ? ' · ' + j.detail : ''}</div>`;
        } else {
          const sheets = Array.isArray(j.sheets) ? j.sheets.join(', ') : '';
          xlsxResult.innerHTML = `
            <div class="mll-xlsx__meta">${currentFile.name} · ${j.totalRows ?? '?'} rows · sheets: ${sheets}</div>
            <div class="mll-xlsx__reply"></div>
          `;
          xlsxResult.querySelector('.mll-xlsx__reply').textContent = j.reply || '(no reply)';
        }
      } catch (err) {
        xlsxResult.innerHTML = `<div class="mll-xlsx__err">network: ${err.message}</div>`;
      } finally {
        xlsxSubmit.disabled = !currentFile;
      }
    });
  }
})();
