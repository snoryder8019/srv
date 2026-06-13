/**
 * Make the ARCADE stats section multi-game (tabs) instead of euchre-only.
 * Card/tile games (euchre, hearts, dominoes, mahjong) use the wins/games model;
 * casino games settle in chips and are omitted from this leaderboard.
 * Replaces the static markup + loadArcadeStats() with a tabbed, game-driven version.
 */
import fs from 'fs';
const FILE = '/srv/games/public/landing.html';
let s = fs.readFileSync(FILE, 'utf8');

if (s.includes('id="arcadeStatsTabs"')) { console.log('already tabbed'); process.exit(0); }

// 1) Replace the static stats section markup.
const oldSection = `<section class="games-section active" id="arcadeStats" style="margin-top:8px">
  <div class="games-header">ARCADE · EUCHRE</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div style="background:#11161f;border-radius:10px;padding:12px">
      <div style="font-size:11px;letter-spacing:.14em;color:#7e8aa0;margin-bottom:8px">LEADERBOARD</div>
      <div id="euchreLb" style="font-size:13px;color:#cfd8e6">&hellip;</div>
    </div>
    <div style="background:#11161f;border-radius:10px;padding:12px">
      <div style="font-size:11px;letter-spacing:.14em;color:#7e8aa0;margin-bottom:8px">RECENT RESULTS</div>
      <div id="euchreRecent" style="font-size:13px;color:#cfd8e6">&hellip;</div>
    </div>
  </div>
  <div id="euchreMe" style="font-size:12.5px;color:#9fb0a6;margin-top:10px"></div>
</section>`;

const newSection = `<section class="games-section active" id="arcadeStats" style="margin-top:8px">
  <div class="games-header">ARCADE · STATS</div>
  <div id="arcadeStatsTabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div style="background:#11161f;border-radius:10px;padding:12px">
      <div style="font-size:11px;letter-spacing:.14em;color:#7e8aa0;margin-bottom:8px">LEADERBOARD</div>
      <div id="arcStatsLb" style="font-size:13px;color:#cfd8e6">&hellip;</div>
    </div>
    <div style="background:#11161f;border-radius:10px;padding:12px">
      <div style="font-size:11px;letter-spacing:.14em;color:#7e8aa0;margin-bottom:8px">RECENT RESULTS</div>
      <div id="arcStatsRecent" style="font-size:13px;color:#cfd8e6">&hellip;</div>
    </div>
  </div>
  <div id="arcStatsMe" style="font-size:12.5px;color:#9fb0a6;margin-top:10px"></div>
</section>`;

if (s.split(oldSection).length - 1 !== 1) throw new Error('stats section anchor not unique/found');
s = s.replace(oldSection, newSection);

// 2) Replace loadArcadeStats() with a tabbed version.
const oldFn = `  async function loadArcadeStats() {
    try {
      var lbR = await fetch('/api/webgame/leaderboard/euchre?limit=5').then(function(r){return r.json();});
      var lb = document.getElementById('euchreLb');
      if (lb) lb.innerHTML = (lbR.leaderboard && lbR.leaderboard.length)
        ? lbR.leaderboard.map(function(r,i){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>'+(i+1)+'. '+esc(r.displayName)+'</span><span><span style="color:#2fbf71">'+r.wins+'W</span> <span style="color:#7e8aa0">'+r.runs+'g</span></span></div>'; }).join('')
        : '<div style="color:#7e8aa0">No games yet \\u2014 be the first!</div>';
    } catch (e) {}
    try {
      var rcR = await fetch('/api/webgame/recent/euchre?limit=6').then(function(r){return r.json();});
      var rc = document.getElementById('euchreRecent');
      if (rc) rc.innerHTML = (rcR.results && rcR.results.length)
        ? rcR.results.map(function(r){ return '<div style="padding:2px 0">'+esc(r.displayName)+' <span style="color:'+(r.status==='won'?'#2fbf71':'#9fb0a6')+'">'+(r.status==='won'?'won':'lost')+' '+r.score+'\\u2013'+r.opponentScore+'</span></div>'; }).join('')
        : '<div style="color:#7e8aa0">No results yet</div>';
    } catch (e) {}
    try {
      var meR = await fetch('/api/webgame/me');
      if (meR.ok) {
        var me = await meR.json();
        var el = document.getElementById('euchreMe');
        if (me && me.ok && el) {
          var eu = (me.stats||[]).find(function(s){ return s.game==='euchre'; });
          el.textContent = eu ? ('Your Euchre: '+eu.wins+' wins / '+eu.runs+' games') : 'Your Euchre: no games yet';
        }
      }
    } catch (e) {}
  }
  loadArcadeStats();
  setInterval(loadArcadeStats, 30000);`;

const newFn = `  // Tabbed arcade stats — wins/games model fits the turn-based games.
  var STATS_GAMES = [
    { id: 'euchre', name: 'Euchre' }, { id: 'hearts', name: 'Hearts' },
    { id: 'dominoes', name: 'Dominoes' }, { id: 'mahjong', name: 'Mahjong' },
  ];
  var statsGame = STATS_GAMES[0].id;

  function renderStatsTabs() {
    var box = document.getElementById('arcadeStatsTabs'); if (!box) return;
    box.innerHTML = STATS_GAMES.map(function(g){
      var on = g.id === statsGame;
      return '<button data-g="'+g.id+'" style="cursor:pointer;border:none;border-radius:8px;padding:7px 12px;font-weight:700;font-size:12.5px;'+
        (on ? 'background:#2fbf71;color:#05230f' : 'background:#1d2733;color:#9fb0a6')+'">'+g.name+'</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function(b){
      b.onclick = function(){ statsGame = b.getAttribute('data-g'); renderStatsTabs(); loadArcadeStats(); };
    });
  }

  async function loadArcadeStats() {
    var g = statsGame;
    var gname = (STATS_GAMES.find(function(x){return x.id===g;})||{}).name || g;
    try {
      var lbR = await fetch('/api/webgame/leaderboard/'+g+'?limit=5').then(function(r){return r.json();});
      var lb = document.getElementById('arcStatsLb');
      if (lb) lb.innerHTML = (lbR.leaderboard && lbR.leaderboard.length)
        ? lbR.leaderboard.map(function(r,i){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>'+(i+1)+'. '+esc(r.displayName)+'</span><span><span style="color:#2fbf71">'+r.wins+'W</span> <span style="color:#7e8aa0">'+r.runs+'g</span></span></div>'; }).join('')
        : '<div style="color:#7e8aa0">No '+gname+' games yet \\u2014 be the first!</div>';
    } catch (e) {}
    try {
      var rcR = await fetch('/api/webgame/recent/'+g+'?limit=6').then(function(r){return r.json();});
      var rc = document.getElementById('arcStatsRecent');
      if (rc) rc.innerHTML = (rcR.results && rcR.results.length)
        ? rcR.results.map(function(r){ return '<div style="padding:2px 0">'+esc(r.displayName)+' <span style="color:'+(r.status==='won'?'#2fbf71':'#9fb0a6')+'">'+(r.status==='won'?'won':'lost')+' '+r.score+'\\u2013'+r.opponentScore+'</span></div>'; }).join('')
        : '<div style="color:#7e8aa0">No results yet</div>';
    } catch (e) {}
    try {
      var meR = await fetch('/api/webgame/me');
      if (meR.ok) {
        var me = await meR.json();
        var el = document.getElementById('arcStatsMe');
        if (me && me.ok && el) {
          var st = (me.stats||[]).find(function(s){ return s.game===g; });
          el.textContent = st ? ('Your '+gname+': '+st.wins+' wins / '+st.runs+' games') : ('Your '+gname+': no games yet');
        }
      }
    } catch (e) {}
  }
  renderStatsTabs();
  loadArcadeStats();
  setInterval(loadArcadeStats, 30000);`;

if (s.split(oldFn).length - 1 !== 1) throw new Error('loadArcadeStats anchor not unique/found');
s = s.replace(oldFn, newFn);

fs.writeFileSync(FILE, s);
console.log('arcade stats are now tabbed across euchre/hearts/dominoes/mahjong');
