/**
 * Opponent view-box strip.
 *
 * Renders one tile per player into a container with id="oppStrip", excluding
 * the local player's index when one is provided. Tiles update in real time
 * from `player-analysis` and `analysis-result` socket events so each tile
 * shows the most recent analyzed dartboard frame plus its 3 dart badges.
 *
 * Public API:
 *   window._ttOppStrip.init({ players, selfIndex })   // build/replace tiles
 *   window._ttOppStrip.update({ players, selfIndex }) // alias for init
 *
 * `players` is the same shape as game.players; only `name` is read.
 * `selfIndex` is optional — pass -1 (or omit) to render every player.
 *
 * Loading the script is a no-op until init() is called with a populated
 * #oppStrip element on the page.
 */
(function () {
  function fmtDart(d) {
    if (!d) return '-';
    if (d.ring === 'miss') return 'X';
    var pfx = d.ring === 'double' ? 'D' : d.ring === 'triple' ? 'T' : '';
    return pfx + d.segment;
  }

  function makeTile(playerIndex) {
    var tile = document.createElement('div');
    tile.className = 'opp-tile';
    tile.id = 'oppTile_' + playerIndex;
    tile.dataset.pi = String(playerIndex);

    var wrap = document.createElement('div');
    wrap.className = 'opp-frame-wrap';
    var img = document.createElement('img');
    img.className = 'opp-frame';
    img.id = 'oppFrame_' + playerIndex;
    img.alt = '';
    var empty = document.createElement('div');
    empty.className = 'opp-frame-empty';
    empty.id = 'oppEmpty_' + playerIndex;
    empty.textContent = '📷';
    wrap.appendChild(img);
    wrap.appendChild(empty);

    var darts = document.createElement('div');
    darts.className = 'opp-darts';
    darts.id = 'oppDarts_' + playerIndex;
    for (var i = 0; i < 3; i++) {
      var s = document.createElement('span');
      s.className = 'opp-dart empty';
      s.textContent = '-';
      darts.appendChild(s);
    }

    tile.appendChild(wrap);
    tile.appendChild(darts);
    return tile;
  }

  function init(opts) {
    var container = document.getElementById('oppStrip');
    if (!container) return;
    var players  = (opts && opts.players)  || [];
    var selfIdx  = (opts && typeof opts.selfIndex === 'number') ? opts.selfIndex : -1;
    // Solo (or AI-feedback) case: when there's no opponent, render the self
    // tile so the strip serves as a per-frame AI prediction preview. With
    // moondream still hallucinating, seeing the tile next to the tap-pad
    // makes "AI said X vs I threw Y" obvious for learning-mode review.
    if (players.length <= 1) selfIdx = -1;
    container.innerHTML = '';
    for (var i = 0; i < players.length; i++) {
      if (i === selfIdx) continue;
      container.appendChild(makeTile(i));
    }
  }

  function confClass(analysis) {
    if (!analysis) return '';
    if (analysis.available === false) return 'conf-unavailable';
    var c = String(analysis.confidence || '').toLowerCase();
    if (c === 'high')   return 'conf-high';
    if (c === 'medium') return 'conf-medium';   // ← yellow boxing
    if (c === 'low')    return 'conf-low';
    if (c === 'manual') return 'conf-manual';
    if (c === 'unavailable' || c === 'error') return 'conf-unavailable';
    return '';
  }

  function applyTile(playerIndex, frame, analysis) {
    var tile = document.getElementById('oppTile_' + playerIndex);
    if (!tile) return; // self-tile or strip not initialized
    if (frame) {
      var img   = document.getElementById('oppFrame_'  + playerIndex);
      var empty = document.getElementById('oppEmpty_' + playerIndex);
      if (img) {
        img.src = 'data:image/jpeg;base64,' + frame;
        img.classList.add('has');
      }
      if (empty) empty.style.display = 'none';
    }
    // Confidence ring: yellow=medium, red=low, grey=unavailable, green=high
    tile.classList.remove('conf-high','conf-medium','conf-low','conf-manual','conf-unavailable');
    var cc = confClass(analysis);
    if (cc) tile.classList.add(cc);

    var darts = (analysis && Array.isArray(analysis.darts)) ? analysis.darts : null;
    if (darts) {
      var dc = document.getElementById('oppDarts_' + playerIndex);
      if (!dc) return;
      dc.innerHTML = '';
      for (var i = 0; i < 3; i++) {
        var s = document.createElement('span');
        if (darts[i]) {
          s.className = 'opp-dart';
          s.textContent = fmtDart(darts[i]);
        } else {
          s.className = 'opp-dart empty';
          s.textContent = '-';
        }
        dc.appendChild(s);
      }
    }
  }

  function bindSocket() {
    var sock = window._ttSocket;
    if (!sock) { setTimeout(bindSocket, 250); return; }
    if (sock.__oppStripBound) return;
    sock.__oppStripBound = true;

    sock.on('player-analysis', function (msg) {
      if (!msg) return;
      applyTile(msg.playerIndex, msg.frame, msg.analysis);
    });
    sock.on('analysis-result', function (msg) {
      if (!msg) return;
      var pi = (msg.forPlayerIndex !== undefined && msg.forPlayerIndex !== null)
        ? msg.forPlayerIndex
        : null;
      if (pi === null) return;
      applyTile(pi, msg.frame, msg.analysis);
    });
  }

  window._ttOppStrip = { init: init, update: init };
  bindSocket();
})();
