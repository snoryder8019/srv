import fs from 'fs';
const log = [];
const edit = (file, a, b, name, all) => {
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(a)) { log.push('MISS ' + name); return; }
  s = all ? s.split(a).join(b) : s.replace(a, b);
  fs.writeFileSync(file, s);
  log.push('ok ' + name);
};

// 1) hand cards carry bgUrl
edit('/srv/td/services/cards/actions.js',
  '    rarity: def.rarity,',
  "    rarity: def.rarity,\n    bgUrl: def.bgUrl || '',",
  'actions.toHandCard bgUrl');

// 2) loadout collection cards carry bgUrl
edit('/srv/td/api/v1/routes/loadout.js',
  'slug: c.slug, name: c.name, icon: c.icon, rarity: c.rarity,',
  'slug: c.slug, name: c.name, icon: c.icon, rarity: c.rarity, bgUrl: c.bgUrl || \'\',',
  'loadout bgUrl');

// 3) render the background on both action-hand cards and loadout cards
edit('/srv/td/public/javascripts/game/ui.js',
  'style="--rar:\' + col + \'">\'',
  'style="--rar:\' + col + (c.bgUrl ? \';background-image:linear-gradient(rgba(10,12,22,.5),rgba(10,12,22,.82)),url(\' + c.bgUrl + \');background-size:cover;background-position:center\' : \'\') + \'">\'',
  'ui.js card backgrounds', true);

console.log(log.join('\n'));
