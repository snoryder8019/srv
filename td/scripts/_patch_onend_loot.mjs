import fs from 'fs';
const F = '/srv/td/services/game/instance.js';
let s = fs.readFileSync(F, 'utf8');
const old = `        towersBuilt: this.towersBuilt,
      })).catch(err => console.error("[engine] onEnd hook failed:", err));`;
const neu = `        towersBuilt: this.towersBuilt,
        loot: this.loot,
        ammoLeft: this.ammo,
        deployableLeft: Object.fromEntries(this.deployable),
      })).catch(err => console.error("[engine] onEnd hook failed:", err));`;
if (s.includes('ammoLeft: this.ammo')) { console.log('already'); process.exit(0); }
if (!s.includes(old)) { console.log('onEnd block not found'); process.exit(1); }
s = s.replace(old, neu);
fs.writeFileSync(F, s);
console.log('instance.js: onEnd now passes loot + ammoLeft + deployableLeft');
