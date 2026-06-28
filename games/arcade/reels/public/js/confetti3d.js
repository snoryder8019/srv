/**
 * confetti3d.js — a tiny, dependency-free confetti burst for big wins.
 *
 * One shared full-screen canvas overlay; fireConfetti() showers paper bits that
 * fall + fade. Also published as window.__mllConfetti so any surface (card games,
 * the from-afar parlor pop, etc.) can trigger it without importing.
 */
let _cv = null, _ctx = null, _raf = 0;
const _parts = [];
const COLORS = ['#e3c567', '#46e0c0', '#ff5a3c', '#5aa9ff', '#c79bff', '#ffd34d', '#ff6a9a', '#7ef9da'];

function ensure() {
  if (_cv) return;
  _cv = document.createElement('canvas');
  _cv.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none';
  document.body.appendChild(_cv);
  _ctx = _cv.getContext('2d');
  resize(); window.addEventListener('resize', resize);
}
function resize() { if (_cv) { _cv.width = window.innerWidth; _cv.height = window.innerHeight; } }

export function fireConfetti(opts = {}) {
  ensure();
  const n = opts.count || 150;
  const cx = window.innerWidth * (opts.x != null ? opts.x : 0.5);
  const cy = window.innerHeight * (opts.y != null ? opts.y : 0.32);
  for (let i = 0; i < n; i++) {
    _parts.push({
      x: cx + (Math.random() - 0.5) * window.innerWidth * 0.5, y: cy + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 10, vy: -(5 + Math.random() * 10),
      g: 0.26 + Math.random() * 0.14, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.45,
      w: 6 + Math.random() * 7, h: 9 + Math.random() * 10, c: COLORS[i % COLORS.length],
      life: 0, max: 90 + Math.random() * 70,
    });
  }
  if (!_raf) loop();
}

function loop() {
  _raf = requestAnimationFrame(loop);
  _ctx.clearRect(0, 0, _cv.width, _cv.height);
  for (let i = _parts.length - 1; i >= 0; i--) {
    const p = _parts[i];
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr; p.life++;
    const a = p.life < 10 ? p.life / 10 : Math.max(0, 1 - (p.life - 10) / (p.max - 10));
    _ctx.save(); _ctx.globalAlpha = a; _ctx.translate(p.x, p.y); _ctx.rotate(p.rot);
    _ctx.fillStyle = p.c; _ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); _ctx.restore();
    if (p.life >= p.max || p.y > _cv.height + 40) _parts.splice(i, 1);
  }
  if (!_parts.length) { cancelAnimationFrame(_raf); _raf = 0; }
}

if (typeof window !== 'undefined') window.__mllConfetti = fireConfetti;
export default { fireConfetti };
