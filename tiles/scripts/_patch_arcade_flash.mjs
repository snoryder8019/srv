/**
 * One-time arcade-chips welcome FLASH on the games landing page. A dismissable
 * modal shown ONCE per browser (localStorage key tied to the flash id, so a new
 * flash can re-trigger later). Separate from the persistent announcement strip —
 * this is the "flash to all users, one time" piece. Idempotent.
 */
import fs from 'fs';
const FILE = '/srv/games/public/landing.html';
let s = fs.readFileSync(FILE, 'utf8');
if (s.includes('id="arcadeFlash"')) { console.log('already added'); process.exit(0); }

const flash = `
<!-- ONE-TIME ARCADE CHIPS FLASH (shown once per browser) -->
<div id="arcadeFlash" style="display:none;position:fixed;inset:0;z-index:10000;align-items:center;justify-content:center;background:rgba(4,7,5,.82);padding:18px">
  <div style="width:100%;max-width:440px;background:linear-gradient(160deg,#11231a,#0c1a13);border:1px solid #e3c567;border-radius:18px;padding:26px 24px;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.6)">
    <div style="font-size:44px;line-height:1;margin-bottom:8px">🪙</div>
    <div style="font-size:12px;letter-spacing:.2em;color:#9fb0a6;text-transform:uppercase">Welcome to the Arcade</div>
    <h2 style="margin:6px 0 10px;font-size:26px;color:#ffe9a8">Chips are live!</h2>
    <p style="color:#cfe7d8;font-size:14px;line-height:1.55;margin:0 0 8px">
      Earn chips across the whole site — play the arcade, hop on the servers — then spend them at the
      <b style="color:#e3c567">craps &amp; roulette</b> tables. Climb the <b style="color:#e3c567">Most Chips</b>
      and <b style="color:#e3c567">Biggest Bet Won</b> leaderboards.
    </p>
    <p style="color:#9fb0a6;font-size:12px;margin:0 0 18px">🚧 Work in progress — new games &amp; rewards landing regularly.</p>
    <button id="arcadeFlashOk" style="width:100%;border:none;border-radius:11px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;background:#e3c567;color:#241d05">Let's go →</button>
  </div>
</div>
<script>
  (function () {
    // Bump FLASH_ID to re-show a new flash to everyone, one time each.
    var FLASH_ID = 'arcade-chips-v1';
    var KEY = 'mll_flash_' + FLASH_ID;
    try { if (localStorage.getItem(KEY) === '1') return; } catch (e) { return; }
    var el = document.getElementById('arcadeFlash');
    if (!el) return;
    function close() { el.style.display = 'none'; try { localStorage.setItem(KEY, '1'); } catch (e) {} }
    // small delay so it doesn't fight first paint
    setTimeout(function () { el.style.display = 'flex'; }, 700);
    document.getElementById('arcadeFlashOk').onclick = close;
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
  })();
</script>
</body>`;

if (!s.includes('</body>')) throw new Error('no body close');
s = s.replace('</body>', flash);
fs.writeFileSync(FILE, s);
console.log('one-time arcade chips flash added');
