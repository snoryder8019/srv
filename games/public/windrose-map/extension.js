
(function () {
  // World bounds from POI scan (433 POIs, 37 islands, 2026-05-21)
  var W = { minX: -810000, maxX: 830000, minY: -660000, maxY: 770000 };
  var WW = W.maxX - W.minX, WH = W.maxY - W.minY;
  var POLL_MS       = 2000;
  var LERP_ALPHA    = 0.08;
  var MOB_HIT_R     = 8;
  var PLAYER_HIT_R  = 14;
  var ISLAND_PAD    = 20000; // fallback: world units of padding around POI hull

  var PLAYER_COLORS  = ['#f5c842','#4caf50','#42a5f5','#ef5350','#ab47bc','#ff7043','#26c6da','#ec407a'];
  var ISLAND_PALETTE = ['#4fc3f7','#81c784','#ffb74d','#f06292','#ba68c8','#4db6ac','#fff176','#ff8a65','#e57373','#64b5f6'];

  var playerColors = {}, colorIdx = 0;
  function pc(name) {
    if (!playerColors[name]) playerColors[name] = PLAYER_COLORS[colorIdx++ % PLAYER_COLORS.length];
    return playerColors[name];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // ---- convex hull (Andrew's monotone chain) ----
  function cross(O, A, B) {
    return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  }
  function convexHull(pts) {
    if (pts.length < 2) return pts.slice();
    var p = pts.slice().sort(function(a, b) { return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]; });
    var lo = [], hi = [], i;
    for (i = 0; i < p.length; i++) {
      while (lo.length >= 2 && cross(lo[lo.length-2], lo[lo.length-1], p[i]) <= 0) lo.pop();
      lo.push(p[i]);
    }
    for (i = p.length - 1; i >= 0; i--) {
      while (hi.length >= 2 && cross(hi[hi.length-2], hi[hi.length-1], p[i]) <= 0) hi.pop();
      hi.push(p[i]);
    }
    lo.pop(); hi.pop();
    return lo.concat(hi);
  }
  // Chaikin corner-cutting: each iteration replaces every edge with two new points
  // at 1/4 and 3/4 along it, producing progressively smoother curves.
  function chaikin(pts, iters) {
    var p = pts, n, i, a, b, next;
    for (var iter = 0; iter < iters; iter++) {
      n = p.length; next = [];
      for (i = 0; i < n; i++) {
        a = p[i]; b = p[(i + 1) % n];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = next;
    }
    return p;
  }
  function buildIslandShape(pts, amt) {
    var i, cx = 0, cy = 0;
    for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; }
    cx /= pts.length; cy /= pts.length;
    var hull = pts.length >= 3 ? convexHull(pts) : null;
    if (!hull || hull.length < 3) {
      var circle = [];
      for (i = 0; i < 12; i++) {
        var a = i / 12 * 6.2832;
        circle.push([cx + Math.cos(a) * amt, cy + Math.sin(a) * amt]);
      }
      return chaikin(circle, 2);
    }
    var expanded = hull.map(function(p) {
      var dx = p[0] - cx, dy = p[1] - cy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      return [p[0] + dx / len * amt, p[1] + dy / len * amt];
    });
    return chaikin(expanded, 3);
  }

  window.windroseMapExt = {
    boot: function (ctx) {
      var state = ctx.state, api = ctx.api;
      var canvas = document.getElementById('wrme_canvas');
      if (!canvas) return;
      requestAnimationFrame(function () {
        canvas.width  = canvas.offsetWidth  || 600;
        canvas.height = canvas.offsetHeight || 500;
        init(canvas, state, api);
      });
    }
  };

  function init(canvas, state, api) {
    var g = canvas.getContext('2d');
    var W_MID_X = (W.minX + W.maxX) / 2;
    var W_MID_Y = (W.minY + W.maxY) / 2;

    var vx    = W_MID_X;
    var vy    = W_MID_Y;
    var scale = Math.min(canvas.width / WW, canvas.height / WH) * 0.88;

    function w2c(wx, wy) {
      return [(wx - vx) * scale + canvas.width  / 2,
              (vy - wy) * scale + canvas.height / 2];
    }
    function c2w(cx, cy) {
      return [(cx - canvas.width  / 2) / scale + vx,
              (cy - canvas.height / 2) / (-scale) + vy];
    }

    var pois     = [];
    var islands  = [];
    var players  = [];
    var mobs     = [];
    var showMobs = true;
    var showPois = true;
    var didZoom  = false;

    var targetPos  = {};
    var displayPos = {};

    var mouseX = -9999, mouseY = -9999;
    var hoverMob      = null;
    var inspectedName = null;
    var lastPollTime  = Date.now();

    function draw() {
      var W2 = canvas.width, H2 = canvas.height;

      g.fillStyle = '#0d2137';
      g.fillRect(0, 0, W2, H2);

      var tl = w2c(W.minX, W.maxY), br = w2c(W.maxX, W.minY);
      g.strokeStyle = '#1c3a5a'; g.lineWidth = 1;
      g.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);

      g.shadowColor = 'rgba(13, 90, 150, 0.45)';
      g.shadowBlur  = 10;
      for (var ii = 0; ii < islands.length; ii++) {
        var shape = islands[ii].shape;
        if (!shape || !shape.length) continue;
        var sp0 = w2c(shape[0][0], shape[0][1]);
        g.beginPath();
        g.moveTo(sp0[0], sp0[1]);
        for (var si = 1; si < shape.length; si++) {
          var sp = w2c(shape[si][0], shape[si][1]);
          g.lineTo(sp[0], sp[1]);
        }
        g.closePath();
        g.fillStyle   = '#1e3d10';
        g.strokeStyle = islands[ii].terrain ? '#4a8c30' : '#2f6320';
        g.lineWidth   = islands[ii].terrain ? 1 : 1.5;
        g.fill();
        g.stroke();
      }
      g.shadowBlur = 0;

      if (showPois) {
        g.globalAlpha = 0.5;
        for (var i = 0; i < pois.length; i++) {
          var p = pois[i], pt = w2c(p.x, p.y);
          if (pt[0] < -4 || pt[0] > W2 + 4 || pt[1] < -4 || pt[1] > H2 + 4) continue;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(pt[0], pt[1], 2.5, 0, 6.283); g.fill();
        }
        g.globalAlpha = 1;
      }

      var hovPt = null;
      if (showMobs) {
        g.fillStyle = '#ef5350'; g.globalAlpha = 0.8;
        for (var j = 0; j < mobs.length; j++) {
          var m = mobs[j];
          if (!m.x && !m.y) continue;
          var mt = w2c(m.x, m.y);
          g.beginPath(); g.arc(mt[0], mt[1], 3.5, 0, 6.283); g.fill();
          if (hoverMob === m) hovPt = mt;
        }
        g.globalAlpha = 1;
      }

      if (hoverMob && hovPt) {
        var label = hoverMob.name || 'Unknown';
        g.font = 'bold 11px sans-serif';
        var tw  = g.measureText(label).width;
        var pad = 6, th = 20;
        var ttx = hovPt[0] + 12, tty = hovPt[1];
        if (ttx + tw + pad > W2) ttx = hovPt[0] - tw - pad - 6;
        if (tty - th / 2 < 2)   tty = th / 2 + 2;
        if (tty + th / 2 > H2)  tty = H2 - th / 2 - 2;
        g.fillStyle   = 'rgba(10,25,41,0.92)';
        g.strokeStyle = '#ef5350'; g.lineWidth = 1;
        g.beginPath();
        g.roundRect(ttx - pad, tty - th / 2, tw + pad * 2, th, 3);
        g.fill(); g.stroke();
        g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.shadowBlur = 0;
        g.fillText(label, ttx, tty);
      }

      for (var k = 0; k < players.length; k++) {
        var pl = players[k];
        var dp = displayPos[pl.name];
        if (!dp || (!dp.x && !dp.y)) continue;
        var pp = w2c(dp.x, dp.y), col = pc(pl.name);
        if (pl.name === inspectedName) {
          g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.globalAlpha = 0.35;
          g.beginPath(); g.arc(pp[0], pp[1], 13, 0, 6.283); g.stroke();
          g.globalAlpha = 1;
        }
        g.fillStyle = col; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
        g.beginPath(); g.arc(pp[0], pp[1], 8, 0, 6.283); g.fill(); g.stroke();
        g.font = 'bold 11px sans-serif'; g.fillStyle = '#e6edf3';
        g.textAlign = 'center'; g.textBaseline = 'bottom';
        g.shadowColor = '#000'; g.shadowBlur = 8;
        g.fillText(pl.name, pp[0], pp[1] - 12);
        g.shadowBlur = 0;
      }

      if (inspectedName) {
        var ipData = null;
        for (var n = 0; n < players.length; n++) {
          if (players[n].name === inspectedName) { ipData = players[n]; break; }
        }
        if (!ipData) {
          inspectedName = null;
        } else {
          var idp = displayPos[ipData.name];
          if (idp && (idp.x || idp.y)) {
            var ipt = w2c(idp.x, idp.y), icol = pc(ipData.name);
            var lines = [
              { text: ipData.name,                          color: icol },
              { text: ipData.alive ? '● Alive' : '○ Dead', color: ipData.alive ? '#4caf50' : '#ef5350' },
              { text: 'X  ' + fmt(ipData.x),               color: '#8b949e' },
              { text: 'Y  ' + fmt(ipData.y),               color: '#8b949e' },
              { text: 'Z  ' + fmt(ipData.z || 0),          color: '#8b949e' }
            ];
            g.font = 'bold 12px sans-serif';
            var maxTW = 0;
            for (var li = 0; li < lines.length; li++) {
              var lw = g.measureText(lines[li].text).width;
              if (lw > maxTW) maxTW = lw;
            }
            var cpad = 10, lineH = 18;
            var cardW = maxTW + cpad * 2, cardH = lines.length * lineH + cpad * 2;
            var cardX = ipt[0] + 18, cardY = ipt[1] - cardH / 2;
            if (cardX + cardW > W2 - 4) cardX = ipt[0] - cardW - 18;
            if (cardY < 4)               cardY = 4;
            if (cardY + cardH > H2 - 4)  cardY = H2 - cardH - 4;
            g.fillStyle = 'rgba(10,25,41,0.95)'; g.strokeStyle = icol;
            g.lineWidth = 1.5; g.shadowBlur = 0;
            g.beginPath(); g.roundRect(cardX, cardY, cardW, cardH, 4); g.fill(); g.stroke();
            g.textAlign = 'left'; g.textBaseline = 'middle';
            for (var li2 = 0; li2 < lines.length; li2++) {
              g.fillStyle = lines[li2].color;
              g.fillText(lines[li2].text, cardX + cpad, cardY + cpad + li2 * lineH + lineH / 2);
            }
          }
        }
      }

      var age = Math.floor((Date.now() - lastPollTime) / 1000);
      g.font = '10px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.shadowBlur = 0;
      g.fillStyle  = age < 4 ? '#4caf50' : age < 10 ? '#f5c842' : '#ef5350';
      g.fillText(age < 1 ? '● live' : '● ' + age + 's ago', W2 - 8, H2 - 8);
    }

    function tick() {
      for (var name in targetPos) {
        var t = targetPos[name];
        if (!displayPos[name]) { displayPos[name] = { x: t.x, y: t.y }; }
        else { var d = displayPos[name]; d.x = lerp(d.x, t.x, LERP_ALPHA); d.y = lerp(d.y, t.y, LERP_ALPHA); }
      }
      draw();
      requestAnimationFrame(tick);
    }

    function updateStats() {
      var el = document.getElementById('wrme_stats');
      if (!el) return;
      var ap = players.filter(function(p) { return p.x || p.y; });
      var am = mobs.filter(function(m)    { return m.x || m.y; });
      var pList = ap.length
        ? ap.map(function(p) { return '<span style="color:' + pc(p.name) + '">' + esc(p.name) + '</span>'; }).join(', ')
        : '<span style="color:#8b949e">nobody</span>';
      el.innerHTML =
        '<div class="wrme-stat"><span class="wrme-k">Players</span>' + ap.length + ' / 8</div>' +
        '<div class="wrme-stat"><span class="wrme-k">Online</span>'  + pList + '</div>' +
        '<div class="wrme-stat"><span class="wrme-k">Creatures</span>' + am.length + '</div>';
    }

    function applyLive(lm) {
      lastPollTime = Date.now();
      players = lm.players || [];
      mobs    = lm.mobs    || [];
      updateStats();
      for (var i = 0; i < players.length; i++) {
        var pl = players[i];
        if (!pl.x && !pl.y) continue;
        targetPos[pl.name] = { x: pl.x, y: pl.y };
        if (!displayPos[pl.name]) displayPos[pl.name] = { x: pl.x, y: pl.y };
      }
      if (!didZoom) {
        var active = players.filter(function(p) { return p.x || p.y; });
        if (active.length) { vx = active[0].x; vy = active[0].y; scale = 0.025; didZoom = true; }
      }
    }

    requestAnimationFrame(tick);
    if (state && state.livemap) applyLive(state.livemap);

    // ---- terrain-driven island shapes ----
    // Honest bounding rectangle per landscape (no smoothing). Every island in
    // this dataset is a full square grid of 2x2/3x3/5x5/7x7 components, so the
    // landscape footprint *is* a rectangle — drawing it as one tells the truth
    // about what we know (the GPU heightmap is unreadable, the bbox is not).
    function applyTerrain(data) {
      if (!data || !data.components || !data.components.length) return;
      var byL = {};
      for (var i = 0; i < data.components.length; i++) {
        var c = data.components[i];
        var lid = String(c.l);
        if (!byL[lid]) byL[lid] = [];
        byL[lid].push(c);
      }
      var newIslands = [];
      for (var lid2 in byL) {
        var comps = byL[lid2];
        var uniqueWx = [], uniqueWy = [], seenX = {}, seenY = {};
        for (var k = 0; k < comps.length; k++) {
          var cx0 = comps[k].wx, cy0 = comps[k].wy;
          if (!seenX[cx0]) { seenX[cx0] = 1; uniqueWx.push(cx0); }
          if (!seenY[cy0]) { seenY[cy0] = 1; uniqueWy.push(cy0); }
        }
        uniqueWx.sort(function(a,b){return a-b;});
        uniqueWy.sort(function(a,b){return a-b;});
        var tileW = uniqueWx.length > 1 ? uniqueWx[1] - uniqueWx[0] : 25500;
        var tileH = uniqueWy.length > 1 ? uniqueWy[1] - uniqueWy[0] : 25500;
        var minX = uniqueWx[0], maxX = uniqueWx[uniqueWx.length - 1] + tileW;
        var minY = uniqueWy[0], maxY = uniqueWy[uniqueWy.length - 1] + tileH;
        newIslands.push({
          shape: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]],
          terrain: true,
        });
      }
      if (newIslands.length) islands = newIslands;
    }

    // ---- POI + island load ----
    function applyPois(arr) {
      if (!arr || !arr.length) return;
      var islandColors = {}, islandPts = {}, iIdx = 0;
      for (var pi = 0; pi < arr.length; pi++) {
        var poi = arr[pi];
        if (!poi.x && !poi.y) continue;
        var iid = poi.islandId != null ? String(poi.islandId) : '__none__';
        if (!islandColors[iid]) islandColors[iid] = ISLAND_PALETTE[iIdx++ % ISLAND_PALETTE.length];
        if (!islandPts[iid])    islandPts[iid]    = [];
        islandPts[iid].push([poi.x, poi.y]);
        pois.push({ x: poi.x, y: poi.y, color: islandColors[iid] });
      }
      // Only build POI-hull island shapes if terrain data hasn't loaded
      if (!islands.length) {
        for (var iid2 in islandPts) {
          if (iid2 === '__none__') continue;
          islands.push({ shape: buildIslandShape(islandPts[iid2], ISLAND_PAD) });
        }
      }
    }

    function showPoiStatus(msg, isErr) {
      var el = document.getElementById('wrme_stats');
      if (!el) return;
      var d = document.createElement('div');
      d.style.cssText = 'font-size:10px;margin-top:4px;color:' + (isErr ? '#ef5350' : '#8b949e');
      d.textContent = msg;
      el.appendChild(d);
    }

    // 1. Try ctx.state.pois (pre-fetched by host, costs nothing)
    var sp = state && state.pois;
    if (sp) {
      var spArr = Array.isArray(sp) ? sp : (sp.pois && Array.isArray(sp.pois) ? sp.pois : null);
      if (spArr && spArr.length) { applyPois(spArr); sp = null; }
    }

    // 2. If not in state, try a direct fetch (reveals the real HTTP error)
    if (!islands.length) {
      fetch('/windrose-map/api/pois', { credentials: 'include' })
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          applyPois(data.pois || data);
        })
        .catch(function(err) {
          var msg = err && err.message ? err.message : String(err);
          // 3. Fall back to api() helper
          api('GET', '/pois')
            .then(function(raw) {
              var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
              applyPois(data.pois || data);
            })
            .catch(function() {
              showPoiStatus('POI load failed: ' + msg, true);
            });
        });
    }

    // 4. Terrain-based island shapes — overwrites POI hulls when endpoint is live.
    // Silently skips if 404 (games-app not yet restarted); POI hulls remain.
    fetch('/windrose-map/api/terrain', { credentials: 'include' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        applyTerrain(data);
      })
      .catch(function() {});

    function hitTestPlayer(cx, cy) {
      var best = null, bestD2 = PLAYER_HIT_R * PLAYER_HIT_R;
      for (var i = 0; i < players.length; i++) {
        var pl = players[i], dp = displayPos[pl.name];
        if (!dp || (!dp.x && !dp.y)) continue;
        var pt = w2c(dp.x, dp.y);
        var dx = pt[0] - cx, dy = pt[1] - cy, d2 = dx*dx + dy*dy;
        if (d2 < bestD2) { bestD2 = d2; best = pl; }
      }
      return best;
    }
    function toggleInspect(pl) {
      if (!pl)                            inspectedName = null;
      else if (pl.name === inspectedName) inspectedName = null;
      else                                inspectedName = pl.name;
    }

    var dragging = false, dsx, dsy, dvx, dvy;
    canvas.addEventListener('mousedown', function(e) {
      dragging = true; dsx = e.clientX; dsy = e.clientY; dvx = vx; dvy = vy;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', function() { dragging = false; canvas.style.cursor = 'crosshair'; });
    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
      if (dragging) { vx = dvx - (e.clientX - dsx) / scale; vy = dvy + (e.clientY - dsy) / scale; hoverMob = null; return; }
      var best = null, bestD2 = MOB_HIT_R * MOB_HIT_R;
      if (showMobs) {
        for (var i = 0; i < mobs.length; i++) {
          var m = mobs[i]; if (!m.x && !m.y) continue;
          var mt = w2c(m.x, m.y), dx = mt[0] - mouseX, dy = mt[1] - mouseY, d2 = dx*dx + dy*dy;
          if (d2 < bestD2) { bestD2 = d2; best = m; }
        }
      }
      hoverMob = best;
      canvas.style.cursor = best ? 'default' : 'crosshair';
    });
    canvas.addEventListener('mouseleave', function() { hoverMob = null; });
    canvas.addEventListener('click', function(e) {
      if (dragging) return;
      var rect = canvas.getBoundingClientRect();
      toggleInspect(hitTestPlayer(e.clientX - rect.left, e.clientY - rect.top));
    });
    canvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      var wPre = c2w(cx, cy);
      scale *= (e.deltaY < 0) ? 1.25 : 0.8;
      var wPost = c2w(cx, cy);
      vx -= wPost[0] - wPre[0]; vy -= wPost[1] - wPre[1];
    }, { passive: false });

    var touchStartVx, touchStartVy, touchStartX, touchStartY, touchStartScale, touchStartDist, touchMoved = false;
    canvas.addEventListener('touchstart', function(e) {
      e.preventDefault(); hoverMob = null;
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
        touchStartVx = vx; touchStartVy = vy; touchStartDist = null; touchMoved = false;
      } else if (e.touches.length === 2) {
        var t1 = e.touches[0], t2 = e.touches[1];
        var dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
        touchStartDist = Math.sqrt(dx*dx + dy*dy); touchStartScale = scale; touchMoved = true;
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', function(e) {
      e.preventDefault();
      if (e.touches.length === 1 && touchStartDist === null) {
        var t = e.touches[0];
        if (Math.abs(t.clientX - touchStartX) + Math.abs(t.clientY - touchStartY) > 6) touchMoved = true;
        vx = touchStartVx - (t.clientX - touchStartX) / scale;
        vy = touchStartVy + (t.clientY - touchStartY) / scale;
      } else if (e.touches.length === 2 && touchStartDist !== null) {
        var t1 = e.touches[0], t2 = e.touches[1];
        var dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
        var dist = Math.sqrt(dx*dx + dy*dy);
        var rect = canvas.getBoundingClientRect();
        var mx = ((t1.clientX + t2.clientX) / 2) - rect.left;
        var my = ((t1.clientY + t2.clientY) / 2) - rect.top;
        var wPre = c2w(mx, my);
        scale = touchStartScale * (dist / touchStartDist);
        var wPost = c2w(mx, my);
        vx -= wPost[0] - wPre[0]; vy -= wPost[1] - wPre[1];
      }
    }, { passive: false });
    canvas.addEventListener('touchend', function(e) {
      if (e.touches.length === 0) {
        if (!touchMoved && touchStartDist === null) {
          var rect = canvas.getBoundingClientRect();
          toggleInspect(hitTestPlayer(touchStartX - rect.left, touchStartY - rect.top));
        }
        touchStartDist = null;
      } else if (e.touches.length === 1) {
        touchStartDist = null; touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
        touchStartVx = vx; touchStartVy = vy; touchMoved = true;
      }
    }, { passive: false });

    function zoomAround(cx, cy, f) {
      var wPre = c2w(cx, cy); scale *= f; var wPost = c2w(cx, cy);
      vx -= wPost[0] - wPre[0]; vy -= wPost[1] - wPre[1];
    }
    var zinBtn = document.getElementById('wrme_zin'), zoutBtn = document.getElementById('wrme_zout');
    if (zinBtn)  zinBtn.addEventListener('click',  function() { zoomAround(canvas.width/2, canvas.height/2, 1.5); });
    if (zoutBtn) zoutBtn.addEventListener('click', function() { zoomAround(canvas.width/2, canvas.height/2, 1/1.5); });

    var hdr = document.getElementById('wrme_hdr');
    if (hdr) hdr.addEventListener('click', function() {
      var body = document.getElementById('wrme_body'), arrow = document.getElementById('wrme_arrow');
      if (!body) return;
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
    });

    var togM = document.getElementById('wrme_tog_mobs'), togP = document.getElementById('wrme_tog_pois');
    if (togM) togM.addEventListener('change', function(e) { showMobs = e.target.checked; if (!showMobs) hoverMob = null; });
    if (togP) togP.addEventListener('change', function(e) { showPois = e.target.checked; });

    setInterval(function() {
      api('GET', '/state').then(function(raw) {
        var d = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        if (d && d.livemap) applyLive(d.livemap);
      }).catch(function() {});
    }, POLL_MS);
  }
})();
