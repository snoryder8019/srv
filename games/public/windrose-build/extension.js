// Windrose Admin Build overlay.
// 🤝 Agent-to-agent channel: ../windrose-build/AGENT-CHAT.md — coordinate there before doc rewrites.
// Contract: window.windroseBuildExt.boot(ctx) — called by index.html after HTML injection.
// ctx.panel  — the .wrbe-admin wrapper element
// ctx.status — JSON from GET /mcp/windrose/status (pre-loaded)
// ctx.api(method, path, body) — fetch helper for /mcp/windrose/*

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function fmt(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  window.windroseBuildExt = {
    boot: function (ctx) {
      var panel  = ctx.panel;
      var status = ctx.status;
      var api    = ctx.api;
      if (!panel) return;

      var lastPollTime = 0;
      var ageTimer     = null;

      // ---- status section ----
      function renderStatus(s) {
        var el = document.getElementById('wrbe_status');
        if (!el) return;
        if (!s) { el.innerHTML = '<span class="wrbe-muted">No status data</span>'; return; }
        var online = s.online !== false;
        var name   = esc(s.server_name || s.name || 'Windrose');
        var ver    = s.plus_version || s.version || '';
        el.innerHTML =
          '<span class="wrbe-dot ' + (online ? 'wrbe-dot-green' : 'wrbe-dot-red') + '"></span>' +
          '<span class="wrbe-status-name">' + name + '</span>' +
          (ver ? '<span class="wrbe-muted">WindrosePlus ' + esc(ver) + '</span>' : '');
      }

      // ---- player section ----
      function renderPlayers(lm) {
        lastPollTime = Date.now();
        var ps   = (lm && lm.players) || [];
        var valid = ps.filter(function(p) { return p.x || p.y; });

        var countEl = document.getElementById('wrbe_player_count');
        if (countEl) countEl.textContent = ps.length + ' / 8';

        var el = document.getElementById('wrbe_players');
        if (!el) return;
        if (!valid.length) {
          el.innerHTML = '<span class="wrbe-muted">No players with position data</span>';
          return;
        }
        el.innerHTML = valid.map(function(p) {
          return '<div class="wrbe-player-row">' +
            '<span class="wrbe-dot ' + (p.alive ? 'wrbe-dot-green' : 'wrbe-dot-red') + '"></span>' +
            '<span class="wrbe-player-name">' + esc(p.name) + '</span>' +
            '<span class="wrbe-muted wrbe-coords">' +
              fmt(p.x) + ' / ' + fmt(p.y) + '  z' + fmt(p.z || 0) +
            '</span>' +
          '</div>';
        }).join('');
      }

      // Age ticker — runs every second, updates the "Xs ago" label
      function startAgeTicker() {
        if (ageTimer) clearInterval(ageTimer);
        ageTimer = setInterval(function() {
          var el = document.getElementById('wrbe_poll_age');
          if (!el || !lastPollTime) return;
          var age = Math.floor((Date.now() - lastPollTime) / 1000);
          el.textContent = age < 2 ? 'live' : age + 's ago';
          el.style.color = age < 5 ? '#4caf50' : age < 12 ? '#f5c842' : '#ef5350';
        }, 1000);
      }

      // ---- event section ----
      function renderEvents(evs) {
        var el = document.getElementById('wrbe_events');
        if (!el) return;
        if (!evs || !evs.length) {
          el.innerHTML = '<span class="wrbe-muted">No recent events</span>';
          return;
        }
        el.innerHTML = evs.slice().reverse().map(function(ev) {
          var ts = ev.timestamp ? new Date(ev.timestamp * 1000) : null;
          var time = ts
            ? pad2(ts.getHours()) + ':' + pad2(ts.getMinutes()) + ':' + pad2(ts.getSeconds())
            : '';
          var type   = esc(ev.type || ev.event || '?');
          var detail = ev.player
            ? esc(ev.player)
            : (ev.data && typeof ev.data === 'object'
                ? esc(JSON.stringify(ev.data).slice(0, 60))
                : '');
          return '<div class="wrbe-event-row">' +
            (time ? '<span class="wrbe-event-time">' + time + '</span>' : '') +
            '<span class="wrbe-event-type">' + type + '</span>' +
            (detail ? '<span class="wrbe-muted">' + detail + '</span>' : '') +
          '</div>';
        }).join('');
      }

      // ---- mod section ----
      function renderMods(ms) {
        var el = document.getElementById('wrbe_mods');
        if (!el) return;
        if (!ms || !ms.length) {
          el.innerHTML = '<span class="wrbe-muted">No mod data</span>';
          return;
        }
        el.innerHTML = ms.map(function(m) {
          var name    = esc(typeof m === 'string' ? m : (m.name || '?'));
          var enabled = typeof m === 'string' ? true : m.enabled !== false;
          return '<div class="wrbe-mod-row">' +
            '<span class="wrbe-dot ' + (enabled ? 'wrbe-dot-green' : 'wrbe-dot-gray') + '"></span>' +
            '<span class="wrbe-mod-name">' + name + '</span>' +
          '</div>';
        }).join('');
      }

      // ---- fetch helpers ----
      function fetchPlayers() {
        api('GET', '/state').then(function(raw) {
          var d  = typeof raw === 'string' ? JSON.parse(raw) : raw;
          var lm = d && d.livemap ? d.livemap : d;
          renderPlayers(lm);
        }).catch(function() {
          var el = document.getElementById('wrbe_players');
          if (el) el.innerHTML = '<span class="wrbe-err">Poll failed</span>';
        });
      }

      function fetchEvents() {
        api('GET', '/events?limit=15').then(function(raw) {
          var d   = typeof raw === 'string' ? JSON.parse(raw) : raw;
          var evs = Array.isArray(d) ? d : (d && d.events) || [];
          renderEvents(evs);
        }).catch(function() {
          var el = document.getElementById('wrbe_events');
          if (el) el.innerHTML = '<span class="wrbe-muted">Event stream unavailable</span>';
        });
      }

      function fetchMods() {
        api('GET', '/mods').then(function(raw) {
          var d  = typeof raw === 'string' ? JSON.parse(raw) : raw;
          var ms = Array.isArray(d) ? d : (d && d.mods) || [];
          renderMods(ms);
        }).catch(function() {
          var el = document.getElementById('wrbe_mods');
          if (el) el.innerHTML = '<span class="wrbe-muted">Mod list unavailable</span>';
        });
      }

      // ---- boot sequence ----
      renderStatus(status);
      fetchPlayers();
      fetchEvents();
      fetchMods();
      startAgeTicker();

      setInterval(fetchPlayers, 5000);
      setInterval(fetchEvents, 15000);
    }
  };
})();
