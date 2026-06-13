/**
 * Add the three missing arcade cards (mahjong, craps, roulette) to the
 * hard-coded ARCADE grid in landing.html, right after the dominoes card.
 * Idempotent; exact-match anchor.
 */
import fs from 'fs';
const FILE = '/srv/games/public/landing.html';
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('game-card-mahjong')) { console.log('already added'); process.exit(0); }

const anchor = `    <a href="/arcade/dominoes/play" style="text-decoration:none;color:inherit">
      <div class="game-card" id="game-card-dominoes">
        <img class="game-card-img" src="/static/img/dominoes.svg" alt="Dominoes">
        <div class="game-card-info">
          <div class="game-card-name">DOMINOES</div>
          <div class="game-card-status online">PLAY NOW · PREVIEW</div>
        </div>
      </div>
    </a>`;

const addition = anchor + `
    <a href="/arcade/mahjong/play" style="text-decoration:none;color:inherit">
      <div class="game-card" id="game-card-mahjong">
        <img class="game-card-img" src="/static/img/mahjong.svg" alt="Mahjong">
        <div class="game-card-info">
          <div class="game-card-name">MAHJONG</div>
          <div class="game-card-status online">PLAY NOW · PREVIEW</div>
        </div>
      </div>
    </a>
    <a href="/arcade/craps/play" style="text-decoration:none;color:inherit">
      <div class="game-card" id="game-card-craps">
        <img class="game-card-img" src="/static/img/craps.svg" alt="Craps">
        <div class="game-card-info">
          <div class="game-card-name">CRAPS</div>
          <div class="game-card-status online">PLAY NOW · PREVIEW</div>
        </div>
      </div>
    </a>
    <a href="/arcade/roulette/play" style="text-decoration:none;color:inherit">
      <div class="game-card" id="game-card-roulette">
        <img class="game-card-img" src="/static/img/roulette.svg" alt="Roulette">
        <div class="game-card-info">
          <div class="game-card-name">ROULETTE</div>
          <div class="game-card-status online">PLAY NOW · PREVIEW</div>
        </div>
      </div>
    </a>`;

const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error('anchor count ' + n + ' (expected 1)');
src = src.replace(anchor, addition);
fs.writeFileSync(FILE, src);
console.log('added mahjong, craps, roulette cards to arcade grid');
