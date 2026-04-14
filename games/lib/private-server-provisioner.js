'use strict';

/**
 * lib/private-server-provisioner.js
 *
 * Model: g6-standard-2 (4GB RAM, 2 vCPU, $24/mo)
 *   - 4 slots per Linode — each slot gets a dedicated game process
 *   - Games: rust, valheim, l4d2, 7dtd, se, palworld, minecraft
 *   - Each slot is isolated: its own port, process, data dir, systemd service
 *   - Linode destroyed when all 4 slots cancelled
 *
 * Port scheme per slot (base + slot index):
 *   minecraft: 25565–25568
 *   rust:      28015, 28115, 28215, 28315  (each needs 4 ports)
 *   valheim:   2456, 2466, 2476, 2486
 *   l4d2:      27015, 27115, 27215, 27315
 *   7dtd:      26900, 27000, 27100, 27200
 *   se:        27016, 27116, 27216, 27316
 *   palworld:  8211, 8311, 8411, 8511
 */

const LINODE_API  = 'https://api.linode.com/v4';
const TOKEN       = () => process.env.LINODE_API_TOKEN;
const LINODE_TYPE = 'g6-standard-2';
const LINODE_REGION = 'us-central';
const LINODE_IMAGE  = 'linode/ubuntu24.04';
const SLOTS_PER_NODE = 4;

const SSH_PUBKEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBUNbE2jk0mWX4pr3Gc6SX4TsXcA4K3G3B/GonZ5rOuL linode-ollama';

// Steam App IDs for SteamCMD games
const STEAM_APPS = {
  rust:     258550,
  valheim:  896660,
  l4d2:     222860,
  '7dtd':   294420,
  se:       298740,
  palworld: 2394010,
};

// Base port per game (slot offset applied per slot index)
const GAME_PORTS = {
  minecraft: (slot) => ({ main: 25565 + slot, rcon: 25575 + slot }),
  rust:      (slot) => ({ main: 28015 + slot * 100, rcon: 28016 + slot * 100, query: 28017 + slot * 100 }),
  valheim:   (slot) => ({ main: 2456 + slot * 10,  query: 2457 + slot * 10 }),
  l4d2:      (slot) => ({ main: 27015 + slot * 100 }),
  '7dtd':    (slot) => ({ main: 26900 + slot * 100, web: 8080 + slot }),
  se:        (slot) => ({ main: 27016 + slot * 100 }),
  palworld:  (slot) => ({ main: 8211 + slot * 100 }),
};

// Firewall rules per game slot
const GAME_FW = {
  minecraft: (slot) => `ufw allow ${25565 + slot}/tcp\nufw allow ${25565 + slot}/udp`,
  rust:      (slot) => `ufw allow ${28015 + slot * 100}:${28018 + slot * 100}/tcp\nufw allow ${28015 + slot * 100}:${28018 + slot * 100}/udp`,
  valheim:   (slot) => `ufw allow ${2456 + slot * 10}/tcp\nufw allow ${2456 + slot * 10}:${2457 + slot * 10}/udp`,
  l4d2:      (slot) => `ufw allow ${27015 + slot * 100}/tcp\nufw allow ${27015 + slot * 100}/udp`,
  '7dtd':    (slot) => `ufw allow ${26900 + slot * 100}/tcp\nufw allow ${26900 + slot * 100}/udp`,
  se:        (slot) => `ufw allow ${27016 + slot * 100}/tcp\nufw allow ${27016 + slot * 100}/udp`,
  palworld:  (slot) => `ufw allow ${8211 + slot * 100}/tcp\nufw allow ${8211 + slot * 100}/udp`,
};

const PAPER_URL = 'https://api.papermc.io/v2/projects/paper/versions/1.21.4/builds/192/downloads/paper-1.21.4-192.jar';

let db = null;

function init(database) {
  db = database;
  _ensureIndexes();
}

async function _ensureIndexes() {
  try {
    await db.collection('private_servers').createIndex({ userId: 1 });
    await db.collection('private_servers').createIndex({ linodeId: 1, slotIndex: 1 });
    await db.collection('private_servers').createIndex({ stripeSubId: 1 }, { unique: true, sparse: true });
    await db.collection('private_linodes').createIndex({ linodeId: 1 }, { unique: true });
    await db.collection('private_linodes').createIndex({ status: 1 });
  } catch (e) {}
}

function _headers() {
  return { 'Authorization': 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' };
}

function _genPassword(len = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const bytes = require('crypto').randomBytes(len);
  let pw = '';
  for (let i = 0; i < bytes.length; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

// ── Per-game systemd service installer ───────────────────────────────────
function _gameInstallScript(game, slot) {
  const dir = `/srv/slots/${game}_${slot}`;
  const ports = GAME_PORTS[game] ? GAME_PORTS[game](slot) : { main: 25565 + slot };
  const mainPort = ports.main;
  const appId = STEAM_APPS[game];

  // Minecraft — direct download, no SteamCMD
  if (game === 'minecraft') {
    const heap = slot < 3 ? '1024M' : '768M';
    const rconPort = ports.rcon;
    return `
mkdir -p ${dir}
curl -sSL "${PAPER_URL}" -o ${dir}/paper.jar
echo "eula=true" > ${dir}/eula.txt
cat > ${dir}/server.properties <<PROPS
server-port=${mainPort}
server-ip=0.0.0.0
online-mode=true
max-players=20
difficulty=normal
gamemode=survival
view-distance=10
simulation-distance=8
enable-rcon=true
rcon.port=${rconPort}
rcon.password=madlads_rcon_${slot}
PROPS
cat > /etc/systemd/system/slot-${slot}.service <<UNIT
[Unit]
Description=MadLadsLab Slot ${slot} — Minecraft
After=network.target
[Service]
User=slotuser
WorkingDirectory=${dir}
ExecStart=/usr/bin/java -Xms512M -Xmx${heap} -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -jar paper.jar nogui
Restart=on-failure
RestartSec=15
[Install]
WantedBy=multi-user.target
UNIT`;
  }

  // SteamCMD games
  const steamInstall = appId ? `/srv/steamcmd/steamcmd.sh +force_install_dir ${dir} +login anonymous +app_update ${appId} validate +quit` : 'echo "No Steam app for this game"';

  let execStart = '';
  let extraSetup = '';

  if (game === 'rust') {
    const rconPort = mainPort + 1;
    execStart = `${dir}/RustDedicated -batchmode -nographics +server.hostname "MadLadsLab Private" +server.maxplayers 50 +server.port ${mainPort} +rcon.port ${rconPort} +rcon.password madlads_rcon_${slot} +rcon.web 1 +server.identity slot${slot}`;
    extraSetup = `# Install Carbon
mkdir -p ${dir}/carbon/plugins ${dir}/carbon/disabled
curl -sSL https://github.com/CarbonCommunity/Carbon/releases/latest/download/Carbon.Linux.Release.tar.gz | tar xz -C ${dir} 2>/dev/null || true`;
  } else if (game === 'valheim') {
    execStart = `${dir}/valheim_server.x86_64 -name "MadLadsLab Slot ${slot}" -port ${mainPort} -world "Slot${slot}" -password "madlads${slot}" -nographics -batchmode`;
    extraSetup = `# BepInEx
if [ ! -d ${dir}/BepInEx ]; then
  curl -sSL https://github.com/BepInEx/BepInEx/releases/download/v5.4.23.2/BepInEx_unix_5.4.23.2.zip -o /tmp/bepinex.zip 2>/dev/null && unzip -q /tmp/bepinex.zip -d ${dir} && rm /tmp/bepinex.zip || true
fi`;
  } else if (game === 'l4d2') {
    execStart = `${dir}/srcds_run -game left4dead2 -port ${mainPort} +map c1m1_hotel +maxplayers 8 -nohltv`;
    extraSetup = `# MetaMod + SourceMod (basic install)
mkdir -p ${dir}/left4dead2/addons/sourcemod/plugins/disabled`;
  } else if (game === '7dtd') {
    execStart = `${dir}/startserver.sh -configfile=${dir}/serverconfig.xml`;
    extraSetup = `mkdir -p ${dir}/Mods
# Patch port in serverconfig
sed -i "s/<ServerPort>.*</<ServerPort>${mainPort}</" ${dir}/serverconfig.xml 2>/dev/null || true`;
  } else if (game === 'se') {
    execStart = `${dir}/DedicatedServer/SpaceEngineersDedicated -path ${dir}/Instance -console`;
    extraSetup = `mkdir -p ${dir}/Instance ${dir}/mods`;
  } else if (game === 'palworld') {
    execStart = `${dir}/PalServer.sh -port=${mainPort} -players=16 EpicApp=PalServer`;
    extraSetup = `# Palworld config
mkdir -p ${dir}/Pal/Saved/Config/LinuxServer
cat > ${dir}/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini <<PALCFG
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(ServerPlayerMaxNum=16,ServerName="MadLadsLab Slot ${slot}",ServerPassword="",PublicPort=${mainPort},bIsMultiplay=True,ExpRate=2.0,PalCaptureRate=1.5)
PALCFG`;
  }

  return `
mkdir -p ${dir}
${steamInstall}
${extraSetup}
cat > /etc/systemd/system/slot-${slot}.service <<UNIT
[Unit]
Description=MadLadsLab Slot ${slot} — ${game}
After=network.target
[Service]
User=slotuser
WorkingDirectory=${dir}
ExecStart=${execStart}
Restart=on-failure
RestartSec=20
[Install]
WantedBy=multi-user.target
UNIT`;
}

// ── Full Linode bootstrap — installs SteamCMD + all 4 slot services ──────
function _buildBootstrap(games) {
  // games = array of 4 game names (one per slot, may be mixed or same)
  // For a fresh Linode we install all common tools + SteamCMD + per-slot setup

  // Collect all firewall rules needed
  const fwRules = games.map((g, i) => {
    const fn = GAME_FW[g];
    return fn ? fn(i) : '';
  }).filter(Boolean).join('\n');

  // Per-slot install scripts
  const slotInstalls = games.map((g, i) => _gameInstallScript(g, i)).join('\n\n');

  return `#!/bin/bash
set -e
exec > /var/log/madlads-bootstrap.log 2>&1
echo "[madlads] Bootstrap start $(date -Iseconds)"

# SSH key
mkdir -p /root/.ssh
echo "${SSH_PUBKEY}" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# System packages
apt-get update -qq
apt-get install -y -qq ufw curl wget lib32gcc-s1 lib32stdc++6 tmux openjdk-21-jre-headless unzip

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
${fwRules}
ufw --force enable

# Slot user
useradd -r -m -d /srv/slots slotuser 2>/dev/null || true
mkdir -p /srv/slots

# SteamCMD (needed for non-Minecraft games)
if ! [ -f /srv/steamcmd/steamcmd.sh ]; then
  mkdir -p /srv/steamcmd
  cd /srv/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar xz
fi

# Per-slot installs
${slotInstalls}

# Slot control helper
cat > /usr/local/bin/madlads-slot <<'SLOTSCRIPT'
#!/bin/bash
CMD=$1; SLOT=$2; shift 2
case $CMD in
  start)   systemctl start   slot-$SLOT ;;
  stop)    systemctl stop    slot-$SLOT ;;
  restart) systemctl restart slot-$SLOT ;;
  status)  systemctl is-active slot-$SLOT ;;
  log)     journalctl -u slot-$SLOT -n 80 --no-pager ;;
esac
SLOTSCRIPT
chmod +x /usr/local/bin/madlads-slot

# Reload systemd — services start individually when subscribers pay
systemctl daemon-reload
chown -R slotuser:slotuser /srv/slots 2>/dev/null || true

echo "READY"    > /srv/.provisioned
date -Iseconds  > /srv/.created
echo "[madlads] Bootstrap complete $(date -Iseconds)"
`;
}

// ── Find or create a Linode ───────────────────────────────────────────────
async function _getOrCreateLinode(game) {
  // For now each Linode is game-homogeneous — find one with the same game and a free slot
  const linodes = await db.collection('private_linodes')
    .find({ status: { $in: ['provisioning', 'running'] }, games: game })
    .sort({ createdAt: 1 })
    .toArray();

  for (const l of linodes) {
    const used = await db.collection('private_servers')
      .countDocuments({ linodeId: l.linodeId, status: { $in: ['active', 'provisioning'] } });
    if (used < SLOTS_PER_NODE) return { linode: l, isNew: false };
  }

  // Create a new Linode pre-configured for this game (all 4 slots same game)
  const linode = await _createLinode(game);
  return { linode, isNew: true };
}

async function _createLinode(game) {
  if (!TOKEN()) throw new Error('LINODE_API_TOKEN not configured');

  const label    = `madlads-${game}-` + Date.now().toString(36);
  const rootPass = _genPassword();
  // All 4 slots run the same game on this node
  const games    = [game, game, game, game];
  const bootstrap = _buildBootstrap(games);

  const res = await fetch(LINODE_API + '/linode/instances', {
    method: 'POST',
    headers: _headers(),
    body: JSON.stringify({
      type:    LINODE_TYPE,
      region:  LINODE_REGION,
      image:   LINODE_IMAGE,
      root_pass: rootPass,
      authorized_keys: [SSH_PUBKEY],
      label,
      tags: ['madladslab', 'private', game],
      metadata: { user_data: Buffer.from(bootstrap).toString('base64') },
      booted: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error('Linode API: ' + JSON.stringify(err.errors || err));
  }

  const linode = await res.json();
  const record = {
    linodeId: linode.id,
    label: linode.label,
    ip: linode.ipv4?.[0] || null,
    type: LINODE_TYPE,
    game,
    games,
    status: 'provisioning',
    rootPass,
    monthlyCost: 24,
    createdAt: new Date(),
  };
  await db.collection('private_linodes').insertOne(record);
  console.log('[private-provisioner] New Linode', linode.id, label, linode.ipv4?.[0], 'game:', game);
  return record;
}

async function _nextFreeSlot(linodeId) {
  const taken = await db.collection('private_servers')
    .find({ linodeId, status: { $in: ['active', 'provisioning'] } }, { projection: { slotIndex: 1 } })
    .toArray();
  const takenSet = new Set(taken.map(s => s.slotIndex));
  for (let i = 0; i < SLOTS_PER_NODE; i++) {
    if (!takenSet.has(i)) return i;
  }
  return null;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────

async function createPrivateServer({ userId, userName, userEmail, game, stripeSubId, stripeCustomerId }) {
  const safeGame = game && GAME_PORTS[game] ? game : 'minecraft';
  const { linode } = await _getOrCreateLinode(safeGame);
  const slotIndex  = await _nextFreeSlot(linode.linodeId);
  if (slotIndex === null) throw new Error('No free slots available');

  const ports = GAME_PORTS[safeGame](slotIndex);
  const mainPort = ports.main;

  const record = {
    userId,
    userName: userName || userEmail,
    userEmail,
    game: safeGame,
    linodeId: linode.linodeId,
    ip: linode.ip,
    slotIndex,
    port: mainPort,
    ports,
    connectString: linode.ip ? `${linode.ip}:${mainPort}` : null,
    stripeSubId:      stripeSubId      || null,
    stripeCustomerId: stripeCustomerId || null,
    status: 'provisioning',
    serverName: `${(userName || userEmail.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '_')}_${safeGame}`,
    createdAt: new Date(),
    billingCycleStart: new Date(),
  };

  await db.collection('private_servers').insertOne(record);
  console.log('[private-provisioner] Slot', slotIndex, safeGame, 'on Linode', linode.linodeId, '→', userEmail, `port ${mainPort}`);
  return record;
}

async function activateSlot(stripeSubId) {
  const server = await db.collection('private_servers').findOne({ stripeSubId });
  if (!server) return null;

  const linode = await db.collection('private_linodes').findOne({ linodeId: server.linodeId });
  if (linode && linode.status === 'provisioning') {
    const ld = await getLinodeStatus(server.linodeId);
    if (ld?.status === 'running') {
      await db.collection('private_linodes').updateOne({ linodeId: server.linodeId }, { $set: { status: 'running' } });
    }
  }

  await db.collection('private_servers').updateOne({ stripeSubId }, { $set: { status: 'active', activatedAt: new Date() } });
  return server;
}

async function cancelPrivateServer(stripeSubId) {
  const server = await db.collection('private_servers').findOne({ stripeSubId });
  if (!server) return null;

  await db.collection('private_servers').updateOne({ stripeSubId }, { $set: { status: 'cancelled', cancelledAt: new Date() } });

  const remaining = await db.collection('private_servers')
    .countDocuments({ linodeId: server.linodeId, status: { $in: ['active', 'provisioning'] } });

  if (remaining === 0) {
    console.log('[private-provisioner] Linode', server.linodeId, 'empty — destroying');
    try {
      const res = await fetch(`${LINODE_API}/linode/instances/${server.linodeId}`, { method: 'DELETE', headers: _headers() });
      if (res.ok || res.status === 404) {
        await db.collection('private_linodes').updateOne({ linodeId: server.linodeId }, { $set: { status: 'destroyed', destroyedAt: new Date() } });
      }
    } catch (e) { console.error('[private-provisioner] Destroy failed:', e.message); }
  }
  return server;
}

async function getUserServers(userId) {
  return db.collection('private_servers')
    .find({ userId, status: { $in: ['provisioning', 'active'] } })
    .sort({ createdAt: -1 }).toArray();
}

async function getLinodeStatus(linodeId) {
  try {
    const res = await fetch(`${LINODE_API}/linode/instances/${linodeId}`, { headers: _headers() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function listAll() {
  const [linodes, servers] = await Promise.all([
    db.collection('private_linodes').find().sort({ createdAt: -1 }).toArray(),
    db.collection('private_servers').find().sort({ createdAt: -1 }).toArray(),
  ]);
  return { linodes, servers };
}

async function slotStats() {
  const total   = await db.collection('private_servers').countDocuments({ status: { $in: ['active', 'provisioning'] } });
  const linodes = await db.collection('private_linodes').countDocuments({ status: { $in: ['provisioning', 'running'] } });
  const capacity = linodes * SLOTS_PER_NODE;
  return { total, capacity, available: Math.max(0, capacity - total), linodes };
}

module.exports = {
  init,
  createPrivateServer,
  activateSlot,
  cancelPrivateServer,
  getUserServers,
  getLinodeStatus,
  listAll,
  slotStats,
  SLOTS_PER_NODE,
  GAME_PORTS,
};
