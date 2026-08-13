/**
 * Field live location — client controller for /admin/field/jobs/:id.
 *
 * Reads window.FIELD_LIVE = { jobId, canBroadcast, labels:{...} }.
 * Connects to the '/field' Socket.IO namespace (auth via the slab_token cookie,
 * verified server-side). Everyone on the page watches the job as a "viewer";
 * a staffer can tap "Share my location" to broadcast their device GPS as a
 * "tech", which the server persists to the job and fans out to all viewers.
 *
 * Uses Leaflet (loaded lazily from CDN) for the live map. Degrades gracefully to
 * a coordinate readout if the map library can't load.
 */
(function () {
  var CFG = window.FIELD_LIVE || {};
  if (!CFG.jobId || typeof io === 'undefined') return;
  var L_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var L_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

  var socket = io('/field');
  var map = null, marker = null, accCircle = null, leafletReady = false;
  var watchId = null, broadcasting = false;

  var elReadout = document.getElementById('fieldReadout');
  var elUpdated = document.getElementById('fieldUpdated');
  var elMapLink = document.getElementById('fieldMapLink');
  var elBtn = document.getElementById('fieldBroadcastBtn');
  var elStatus = document.getElementById('fieldBcStatus');
  var elMapDiv = document.getElementById('fieldMap');

  function join(role) { socket.emit('field:join', { jobId: CFG.jobId, role: role }); }

  socket.on('connect', function () { join(broadcasting ? 'tech' : 'viewer'); });

  socket.on('field:loc', function (d) {
    if (!d || d.jobId !== CFG.jobId) return;
    render(d);
  });

  function render(d) {
    if (typeof d.lat !== 'number' || typeof d.lng !== 'number') return;
    window.__fieldLastPos = { lat: d.lat, lng: d.lng };
    var acc = (typeof d.accuracy === 'number') ? Math.round(d.accuracy) : null;
    if (elReadout) elReadout.textContent = d.lat.toFixed(6) + ', ' + d.lng.toFixed(6) + (acc != null ? ' (±' + acc + 'm)' : '');
    if (elUpdated && d.at) elUpdated.textContent = new Date(d.at).toLocaleTimeString();
    if (elMapLink) { elMapLink.href = 'https://www.openstreetmap.org/?mlat=' + d.lat + '&mlon=' + d.lng + '#map=17/' + d.lat + '/' + d.lng; elMapLink.style.display = ''; }
    updateMap(d.lat, d.lng, d.accuracy);
  }

  // ── Leaflet map (lazy) ──────────────────────────────────────────────────────
  function loadLeaflet(cb) {
    if (window.L) { cb(); return; }
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = L_CSS; document.head.appendChild(css);
    var s = document.createElement('script'); s.src = L_JS; s.onload = cb; s.onerror = function () { if (elMapDiv) elMapDiv.style.display = 'none'; }; document.head.appendChild(s);
  }
  function updateMap(lat, lng, accuracy) {
    if (!elMapDiv) return;
    if (!leafletReady) {
      loadLeaflet(function () {
        if (!window.L) return;
        leafletReady = true;
        map = L.map(elMapDiv).setView([lat, lng], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap',
        }).addTo(map);
        marker = L.marker([lat, lng]).addTo(map);
        if (typeof accuracy === 'number') accCircle = L.circle([lat, lng], { radius: accuracy, color: '#c9a848', weight: 1, fillOpacity: 0.08 }).addTo(map);
      });
      return;
    }
    if (!map) return;
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], map.getZoom());
    if (accCircle && typeof accuracy === 'number') accCircle.setLatLng([lat, lng]).setRadius(accuracy);
  }

  // ── Broadcast (staff only) ──────────────────────────────────────────────────
  function startBroadcast() {
    if (!navigator.geolocation) { alert(CFG.labels && CFG.labels.noGeo || 'Geolocation is not available on this device.'); return; }
    broadcasting = true;
    join('tech');
    if (elBtn) elBtn.textContent = CFG.labels ? CFG.labels.stop : 'Stop sharing';
    if (elBtn) elBtn.classList.add('live');
    if (elStatus) elStatus.textContent = CFG.labels ? CFG.labels.live : 'Sharing live location…';
    watchId = navigator.geolocation.watchPosition(function (pos) {
      socket.emit('field:loc', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    }, function (err) {
      if (elStatus) elStatus.textContent = (CFG.labels ? CFG.labels.geoErr : 'Location error') + ': ' + err.message;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopBroadcast() {
    broadcasting = false;
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    join('viewer');
    if (elBtn) elBtn.textContent = CFG.labels ? CFG.labels.share : 'Share my location';
    if (elBtn) elBtn.classList.remove('live');
    if (elStatus) elStatus.textContent = '';
  }
  if (elBtn && CFG.canBroadcast) {
    elBtn.addEventListener('click', function () { broadcasting ? stopBroadcast() : startBroadcast(); });
  }

  // Resolve a current position for the geo-pin / ETA forms: prefer the live feed,
  // else ask the device once.
  window.fieldGetCurrentPos = function (cb) {
    if (window.__fieldLastPos) return cb(window.__fieldLastPos);
    if (!navigator.geolocation) return cb(null);
    navigator.geolocation.getCurrentPosition(
      function (p) { cb({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      function () { cb(null); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
})();
