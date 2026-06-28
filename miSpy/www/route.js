// route.js — offline route rendering on a plain canvas (no map tiles, no network).
// Draws the GPS track auto-scaled to fit, color-graded by speed, with start/end markers.

const M_PER_MILE = 1609.344;

function haversine(a, b) {
  const R = 6371000, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function computeStats(trip) {
  const pts = trip.points || [];
  let maxMph = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]);
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (dt > 0) {
      const mph = (d / dt) * 2.23694;
      if (mph > maxMph && mph < 200) maxMph = mph; // ignore GPS glitches
    }
  }
  const durMs = (trip.endTime && trip.startTime) ? trip.endTime - trip.startTime : 0;
  const miles = trip.miles || 0;
  const hrs = durMs / 3600000;
  return { miles, durMs, avgMph: hrs > 0 ? miles / hrs : 0, maxMph, pointCount: pts.length };
}

function lerpColor(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function marker(ctx, x, y, fill) {
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
}

export function renderRoute(canvas, points) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const h = canvas.clientHeight || 300;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0e1620'; ctx.fillRect(0, 0, w, h);

  const pts = (points || []).filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
  if (pts.length < 2) {
    ctx.fillStyle = '#8aa0b4'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('No route data for this trip', w / 2, h / 2);
    return;
  }

  // Equirectangular projection (fine for a single trip's span).
  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const k = Math.cos(meanLat * Math.PI / 180) || 1;
  const proj = pts.map(p => ({ x: p.lng * k, y: p.lat }));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  proj.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });

  const pad = 30;
  const spanX = (maxX - minX) || 1e-6, spanY = (maxY - minY) || 1e-6;
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offX = (w - spanX * scale) / 2, offY = (h - spanY * scale) / 2;
  const X = p => offX + (p.x - minX) * scale;
  const Y = p => h - (offY + (p.y - minY) * scale); // flip Y so north is up

  // Per-segment speed for color grading.
  const speeds = [];
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]);
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    speeds.push(dt > 0 ? d / dt : 0);
  }
  const sMax = Math.max(...speeds, 0.001);

  ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i = 1; i < proj.length; i++) {
    const t = Math.min(speeds[i - 1] / sMax, 1);
    ctx.strokeStyle = lerpColor([40, 200, 160], [239, 90, 111], t); // slow=green → fast=red
    ctx.beginPath();
    ctx.moveTo(X(proj[i - 1]), Y(proj[i - 1]));
    ctx.lineTo(X(proj[i]), Y(proj[i]));
    ctx.stroke();
  }

  marker(ctx, X(proj[0]), Y(proj[0]), '#28c8a0');                       // start
  marker(ctx, X(proj[proj.length - 1]), Y(proj[proj.length - 1]), '#ef5a6f'); // end
}
