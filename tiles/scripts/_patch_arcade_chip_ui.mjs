/**
 * Arcade chip economy UI on the games landing page:
 *  (A) a CHIPS pill in the nav (shown when signed in) reading /api/wallet/me
 *  (B) a "CHIP LEADERBOARDS" section (Most Chips + Biggest Bet Won) reading
 *      /api/wallet/leaderboard?kind=chips|bet
 * Same-origin fetches (this IS games), so credentials work. Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/public/landing.html';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes('id="chipPill"')) { console.log('already added'); process.exit(0); }

// (A) chip pill in nav-right (before the login/server-cam buttons)
s = s.replace(
  `  <div class="nav-right" id="navRight">
    <a href="/server-cam" class="nav-btn" style="border-color:#4caf82;color:#4caf82">SERVER CAM</a>`,
  `  <div class="nav-right" id="navRight">
    <span id="chipPill" style="display:none;align-items:center;gap:6px;background:#1a1206;border:1px solid #e3c567;border-radius:20px;padding:5px 12px;font-weight:800;font-size:0.72rem;color:#ffe9a8">🪙 <span id="chipPillN">0</span></span>
    <a href="/server-cam" class="nav-btn" style="border-color:#4caf82;color:#4caf82">SERVER CAM</a>`
);

// (B) chip leaderboards section — insert right after the arcade stats section closes.
const afterStats = `  <div id="arcStatsMe" style="font-size:12.5px;color:#9fb0a6;margin-top:10px"></div>
</section>`;
const chipSection = afterStats + `

<!-- CHIP LEADERBOARDS — site-wide economy -->
<section class="games-section active" id="chipBoards" style="margin-top:8px">
  <div class="games-header">CHIP LEADERBOARDS</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div style="background:#11161f;border-radius:10px;padding:12px">
      <div style="font-size:11px;letter-spacing:.14em;color:#7e8aa0;margin-bottom:8px">🪙 MOST CHIPS</div>
      <div id="chipLbRich" style="font-size:13px;color:#cfd8e6">&hellip;</div>
    </div>
    <div style="background:#11161f;border-radius:10px;padding:12px">
      <div style="font-size:11px;letter-spacing:.14em;color:#7e8aa0;margin-bottom:8px">🎯 BIGGEST BET WON</div>
      <div id="chipLbBet" style="font-size:13px;color:#cfd8e6">&hellip;</div>
    </div>
  </div>
  <div style="font-size:11.5px;color:#7e9388;margin-top:10px">Earn chips across the site — play the arcade, hop on the servers. Spend them at the craps &amp; roulette tables.</div>
</section>`;
if (s.split(afterStats).length - 1 !== 1) throw new Error('arcade stats close anchor not unique');
s = s.replace(afterStats, chipSection);

// (C) the JS: load the pill + both boards, refresh periodically.
const script = `
<script>
  // ── Chip economy UI (same-origin reads) ──
  (function () {
    function esc3(x){var d=document.createElement('div');d.textContent=x==null?'':String(x);return d.innerHTML;}
    function rows(list, kind) {
      if (!list || !list.length) return '<div style="color:#7e8aa0">No chips yet — be the first!</div>';
      return list.map(function (r) {
        var right = kind === 'bet'
          ? '<span style="color:#e3c567">'+ (r.biggestBetWon||0) +'</span><span style="color:#7e8aa0;font-size:11px"> ('+ esc3(r.biggestBetGame||'—') +')</span>'
          : '<span style="color:#e3c567">'+ (r.chips||0) +'</span>';
        return '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>'+ r.rank +'. '+ esc3(r.displayName) +'</span>'+ right +'</div>';
      }).join('');
    }
    async function loadChipBoards() {
      try {
        var a = await fetch('/api/wallet/leaderboard?kind=chips&limit=8').then(function(r){return r.json();});
        var el = document.getElementById('chipLbRich'); if (el) el.innerHTML = rows(a.leaderboard, 'chips');
      } catch (e) {}
      try {
        var b = await fetch('/api/wallet/leaderboard?kind=bet&limit=8').then(function(r){return r.json();});
        var el2 = document.getElementById('chipLbBet'); if (el2) el2.innerHTML = rows(b.leaderboard, 'bet');
      } catch (e) {}
    }
    async function loadChipPill() {
      try {
        var r = await fetch('/api/wallet/me', { credentials: 'include' });
        if (!r.ok) return;
        var d = await r.json();
        if (d && d.ok) {
          var pill = document.getElementById('chipPill');
          var n = document.getElementById('chipPillN');
          if (pill && n) { n.textContent = d.chips; pill.style.display = 'inline-flex'; }
        }
      } catch (e) {}
    }
    loadChipBoards(); loadChipPill();
    setInterval(loadChipBoards, 30000);
    setInterval(loadChipPill, 30000);
  })();
</script>
</body>`;
if (!s.includes('</body>')) throw new Error('no body close');
s = s.replace('</body>', script);

fs.writeFileSync(FILE, s);
console.log('arcade chip pill + leaderboards added');
