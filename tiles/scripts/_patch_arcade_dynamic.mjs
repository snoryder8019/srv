/**
 * Make the ARCADE grid render dynamically from the /arcade registry API instead
 * of hard-coded cards, so adding a game to webgames.json is enough (no HTML edit,
 * no drift). Keeps the existing card markup/classes; respects the admin
 * hidden-games toggle. Towers keeps its .jpg; others use the registry image.
 * Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/public/landing.html';
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('id="arcadeGrid"')) { console.log('already dynamic'); process.exit(0); }

// 1) Replace the hard-coded arcade grid (header + grid + all cards) with an empty
//    container the script fills. Anchor from the ARCADE header through the grid close.
const startMark = `<section class="games-section active" id="arcadeSection">
  <div class="games-header">ARCADE</div>
  <div class="games-grid">`;
const endMark = `  </div>
</section>

<!-- ARCADE STATS`;

const sIdx = src.indexOf(startMark);
const eIdx = src.indexOf(endMark);
if (sIdx === -1 || eIdx === -1) throw new Error('arcade section anchors not found (s=' + sIdx + ' e=' + eIdx + ')');

const replacement = `<section class="games-section active" id="arcadeSection">
  <div class="games-header">ARCADE</div>
  <div class="games-grid" id="arcadeGrid">
    <div class="game-card-status" style="grid-column:1/-1;color:#7e8aa0">Loading games…</div>
  </div>
</section>

<!-- ARCADE STATS`;

src = src.slice(0, sIdx) + replacement + src.slice(eIdx + endMark.length);

// 2) Inject the render script just before the closing </body> (after the portal
//    modal loader is fine; it only needs the DOM container).
const renderScript = `
<script>
  // ── ARCADE grid (dynamic) ──────────────────────────────────────────────
  // Single source of truth is the /arcade registry (webgames.json). Adding a
  // game there makes it appear here automatically. Admin "hide from public"
  // still applies. Towers uses its photo; others use the registry image.
  (function () {
    var IMG_OVERRIDE = { towers: '/static/img/towers.jpg' };
    var grid = document.getElementById('arcadeGrid');
    if (!grid) return;

    function cardHTML(g) {
      var img = IMG_OVERRIDE[g.slug] || g.image || ('/static/img/' + g.slug + '.svg');
      var status = (g.status && g.status !== 'live')
        ? 'PLAY NOW · ' + String(g.status).toUpperCase()
        : 'PLAY NOW';
      return '<a href="/arcade/' + g.slug + '/play" style="text-decoration:none;color:inherit">' +
        '<div class="game-card" id="game-card-' + g.slug + '">' +
        '<img class="game-card-img" src="' + img + '" alt="' + (g.name || g.slug) + '" ' +
        'onerror="this.src=\\'/static/img/towers.jpg\\'">' +
        '<div class="game-card-info">' +
        '<div class="game-card-name">' + (g.name || g.slug).toUpperCase() + '</div>' +
        '<div class="game-card-status online">' + status + '</div>' +
        '</div></div></a>';
    }

    Promise.all([
      fetch('/arcade').then(function (r) { return r.json(); }).catch(function () { return { games: [] }; }),
      fetch('/admin/api/hidden-games').then(function (r) { return r.json(); }).catch(function () { return { hidden: [] }; })
    ]).then(function (res) {
      var games = (res[0] && res[0].games) || [];
      var hidden = {};
      ((res[1] && res[1].hidden) || []).forEach(function (h) { hidden[h] = true; });
      games = games.filter(function (g) { return g.status !== 'disabled' && !hidden[g.slug]; });
      if (!games.length) { grid.innerHTML = '<div class="game-card-status" style="grid-column:1/-1;color:#7e8aa0">No games available.</div>'; return; }
      grid.innerHTML = games.map(cardHTML).join('');
    });
  })();
</script>
</body>`;

if (!src.includes('</body>')) throw new Error('no </body> found');
src = src.replace('</body>', renderScript);

fs.writeFileSync(FILE, src);
console.log('arcade grid is now dynamic (renders from /arcade)');
