import fs from 'fs';
const F = '/srv/td/public/stylesheets/main.css';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('PORTRAIT LEFT PANEL')) { console.log('already'); process.exit(0); }

// Replace the bottom-dock block (dock + horizon + tray) with a layout that, in
// PORTRAIT, becomes a vertical LEFT panel (controls column hugging the left edge,
// horizon button vertical) so the board gets the full width/height. Landscape
// keeps the wide bottom dock (there's room there).
const startMarker = `  /* bottom control dock: small round buttons + the wide horizon button */
  .mg-dock {`;
const endMarker = `  /* on phones, drop the desktop right-rail tower picker into the tray */
  .td-game .wave-forecast { top: 40px; }   /* clear the status strip */
}`;
const sIdx = s.indexOf(startMarker);
const eIdx = s.indexOf(endMarker);
if (sIdx === -1 || eIdx === -1) { console.log('markers not found'); process.exit(1); }

const block = `  /* control dock — default (landscape phones / small tablets): wide bottom bar */
  .mg-dock {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 35;
    display: flex; align-items: flex-end; gap: 8px;
    padding: 8px 10px calc(22px + var(--safe-bottom));
    pointer-events: none;
  }
  .mg-dock > * { pointer-events: auto; }
  .mg-btn {
    width: 48px; height: 48px; border-radius: 14px;
    background: rgba(13,18,28,.9); border: 1px solid var(--border);
    color: var(--accent); font-size: 20px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    box-shadow: 0 4px 14px rgba(0,0,0,.45);
  }
  .mg-btn:active { transform: scale(.94); }
  .mg-btn.on { border-color: var(--accent); color: var(--accent); background: rgba(102,224,255,.16); }

  /* the wide "horizon" primary button — a low, wide curved bar */
  .mg-horizon {
    flex: 1; height: 52px; position: relative;
    border: none; cursor: pointer; touch-action: manipulation;
    border-radius: 26px / 40px;                  /* elliptical = horizon curve */
    background: linear-gradient(180deg, #123047, #0a1622);
    border: 1px solid var(--accent);
    color: var(--accent); font-weight: 800; letter-spacing: .08em; font-size: 13px;
    text-transform: uppercase;
    box-shadow: 0 -2px 18px rgba(102,224,255,.25), inset 0 1px 0 rgba(102,224,255,.4);
    overflow: hidden;
  }
  .mg-horizon::before {                          /* glowing horizon line */
    content: ''; position: absolute; left: 12%; right: 12%; top: 50%;
    height: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent);
    box-shadow: 0 0 12px var(--accent); transform: translateY(-50%);
  }
  .mg-horizon:active { transform: translateY(1px); }

  /* tower tray — default: slim horizontal strip above the bottom dock */
  .mg-tray {
    position: absolute; left: 0; right: 0; bottom: 84px; z-index: 34;
    display: none; gap: 8px; overflow-x: auto; padding: 8px 10px;
    background: linear-gradient(0deg, rgba(5,7,14,.85), transparent);
    scrollbar-width: none;
  }
  .mg-tray.open { display: flex; }
  .mg-tray::-webkit-scrollbar { display: none; }

  /* ─── PORTRAIT LEFT PANEL ───────────────────────────────────────────────
     In portrait the controls move to a vertical rail on the LEFT edge so the
     board keeps full width and the bottom stays clear for the field view. ── */
  @media (orientation: portrait) {
    .mg-dock {
      flex-direction: column-reverse; align-items: flex-start;
      left: 0; right: auto; top: 0; bottom: 0;
      justify-content: flex-end;
      padding: 0 0 calc(14px + var(--safe-bottom)) calc(6px + var(--safe-left, 0px));
      gap: 10px;
    }
    /* horizon becomes a TALL vertical button on the left edge */
    .mg-horizon {
      flex: 0 0 auto; width: 52px; height: 168px; writing-mode: vertical-rl;
      border-radius: 40px / 26px;                /* vertical horizon curve */
      box-shadow: 2px 0 18px rgba(102,224,255,.25), inset 1px 0 0 rgba(102,224,255,.4);
    }
    .mg-horizon::before {                         /* horizon line runs vertically */
      left: 50%; right: auto; top: 12%; bottom: 12%; height: auto; width: 2px;
      background: linear-gradient(180deg, transparent, var(--accent), transparent);
      transform: translateX(-50%);
    }
    /* small buttons stack in the column above the horizon */
    .mg-btn { box-shadow: 2px 4px 14px rgba(0,0,0,.45); }

    /* tray slides out to the RIGHT of the left rail as a vertical list */
    .mg-tray {
      left: 64px; right: auto; bottom: calc(14px + var(--safe-bottom)); top: auto;
      width: min(60vw, 230px); max-height: 52vh;
      flex-direction: column; overflow-x: hidden; overflow-y: auto;
      background: linear-gradient(90deg, rgba(5,7,14,.9), rgba(5,7,14,.7));
      border-radius: 12px; padding: 8px;
    }
    /* status pills hug the top-right so they don't sit over the left rail */
    .mg-status { justify-content: flex-end; right: 6px; left: 64px; }
    .td-game .wave-forecast { top: 40px; left: 64px; }  /* clear status + left rail */
  }

  /* on phones, drop the desktop right-rail tower picker into the tray */
  .td-game .wave-forecast { top: 40px; }   /* clear the status strip */
}`;

s = s.slice(0, sIdx) + block + s.slice(eIdx + endMarker.length);
fs.writeFileSync(F, s);
console.log('main.css: portrait moves controls to a left panel; landscape keeps bottom dock');
