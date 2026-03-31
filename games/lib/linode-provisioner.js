'use strict';

/**
 * Linode Provisioner — spin up/down game server instances on demand.
 *
 * Flow:
 * 1. Community requests a game server
 * 2. When 3+ servers are live → auto-provision a new Linode
 * 3. Bootstrap via StackScript (SteamCMD + game server + firewall)
 * 4. 1hr inactivity → destroy the Linode
 */

const LINODE_API = 'https://api.linode.com/v4';
const TOKEN = process.env.LINODE_API_TOKEN;

// Default provisioning config
const DEFAULTS = {
  type: 'g6-standard-2',   // 4GB RAM, 2 vCPU — $24/mo ($0.036/hr)
  region: 'us-central',     // same as main server
  image: 'linode/ubuntu24.04',
  root_pass_length: 32,
};

// Game server port mappings
const GAME_PORTS = {
  rust:    [28015, 28016, 28017, 28082],
  valheim: [2456, 2457],
  l4d2:    [27015],
  '7dtd':  [26900, 26901, 26902],
};

// Track active provisioned instances
// { linodeId: { id, ip, game, label, createdAt, requestedBy, status } }
let db = null;

function init(database) {
  db = database;
  ensureCollection();
}

async function ensureCollection() {
  try {
    await db.collection('provisioned_servers').createIndex({ linodeId: 1 }, { unique: true });
    await db.collection('provisioned_servers').createIndex({ status: 1 });
    await db.collection('provisioned_servers').createIndex({ game: 1 });
  } catch (e) {}
}

function headers() {
  return {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'application/json',
  };
}

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let pw = '';
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(DEFAULTS.root_pass_length);
  for (let i = 0; i < bytes.length; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

// SSH public key for access
const SSH_PUBKEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBUNbE2jk0mWX4pr3Gc6SX4TsXcA4K3G3B/GonZ5rOuL linode-ollama';

// Steam App IDs
const STEAM_APPS = {
  rust: 258550,
  valheim: 896660,
  l4d2: 222860,
  '7dtd': 294420,
};

// Game start commands
const GAME_START = {
  rust: `cd /srv/game && ./RustDedicated -batchmode -nographics \\
+server.hostname "MadLadsLab Community" +server.maxplayers 50 \\
+server.worldsize 2000 +server.port 28015 +rcon.port 28016 \\
+rcon.password madlads_rcon +rcon.web 1 +server.identity community`,
  valheim: `cd /srv/game && ./valheim_server.x86_64 -name "MadLadsLab Community" -port 2456 -world "Community" -password "madlads"`,
  l4d2: `cd /srv/game && ./srcds_run -game left4dead2 +map c1m1_hotel -port 27015 +maxplayers 8`,
  '7dtd': `cd /srv/game && ./startserver.sh -configfile=serverconfig.xml`,
};

function buildBootstrapScript(game) {
  const ports = GAME_PORTS[game] || [];
  const firewallRules = ports.map(p => `ufw allow ${p}/tcp\nufw allow ${p}/udp`).join('\n');
  const appId = STEAM_APPS[game] || 0;
  const startCmd = GAME_START[game] || 'echo "No start command for ' + game + '"';

  return `#!/bin/bash
set -e
exec > /var/log/bootstrap.log 2>&1

# SSH key
mkdir -p /root/.ssh
echo "${SSH_PUBKEY}" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Firewall
apt-get update -qq
apt-get install -y -qq ufw lib32gcc-s1 lib32stdc++6 tmux
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
${firewallRules}
ufw --force enable

# SteamCMD
mkdir -p /srv/steamcmd /srv/game
cd /srv/steamcmd
curl -sqL "https://steamcdn-a.akamlihd.net/client/installer/steamcmd_linux.tar.gz" | tar xz

# Install game server
./steamcmd.sh +force_install_dir /srv/game +login anonymous +app_update ${appId} validate +quit

# Start game in tmux
tmux new-session -d -s game '${startCmd.replace(/'/g, "'\\''")}'

# Signal ready with connect info
echo "READY" > /srv/game/.provisioned
echo "${game}" > /srv/game/.game
date -Iseconds > /srv/game/.created
echo "RUNNING" > /srv/game/.status
`;
}

// ── Provision a new Linode ──
async function provisionServer(game, requestedBy) {
  if (!TOKEN) throw new Error('LINODE_API_TOKEN not configured');

  const label = 'madlads-' + game + '-' + Date.now().toString(36);
  const rootPass = generatePassword();

  const body = {
    type: DEFAULTS.type,
    region: DEFAULTS.region,
    image: DEFAULTS.image,
    root_pass: rootPass,
    authorized_keys: [SSH_PUBKEY],
    label: label,
    tags: ['madladslab', 'game-server', game],
    metadata: {
      user_data: Buffer.from(buildBootstrapScript(game)).toString('base64'),
    },
    booted: true,
  };

  const res = await fetch(LINODE_API + '/linode/instances', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error('Linode API error: ' + JSON.stringify(err.errors || err));
  }

  const linode = await res.json();

  // Store in DB
  const record = {
    linodeId: linode.id,
    label: linode.label,
    ip: linode.ipv4 && linode.ipv4[0],
    game,
    type: DEFAULTS.type,
    region: DEFAULTS.region,
    status: 'provisioning',
    rootPass, // stored encrypted in prod, plain for now
    requestedBy: requestedBy || null,
    createdAt: new Date(),
    lastActivity: new Date(),
    hourlyRate: 0.036,
  };

  await db.collection('provisioned_servers').insertOne(record);
  console.log('[provisioner] Created Linode', linode.id, label, 'for', game);

  return record;
}

// ── Get Linode status ──
async function getLinodeStatus(linodeId) {
  const res = await fetch(LINODE_API + '/linode/instances/' + linodeId, {
    headers: headers(),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Destroy a Linode ──
async function destroyServer(linodeId) {
  if (!TOKEN) throw new Error('LINODE_API_TOKEN not configured');

  const res = await fetch(LINODE_API + '/linode/instances/' + linodeId, {
    method: 'DELETE',
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error('Linode API error: ' + JSON.stringify(err.errors || err));
  }

  await db.collection('provisioned_servers').updateOne(
    { linodeId },
    { $set: { status: 'destroyed', destroyedAt: new Date() } }
  );

  console.log('[provisioner] Destroyed Linode', linodeId);
  return { ok: true };
}

// ── List active provisioned servers ──
async function listActive() {
  return db.collection('provisioned_servers')
    .find({ status: { $in: ['provisioning', 'running'] } })
    .sort({ createdAt: -1 })
    .toArray();
}

// ── List all provisioned servers (including destroyed) ──
async function listAll(limit) {
  return db.collection('provisioned_servers')
    .find()
    .sort({ createdAt: -1 })
    .limit(limit || 50)
    .toArray();
}

// ── Update activity timestamp (called when players are active) ──
async function touchActivity(linodeId) {
  await db.collection('provisioned_servers').updateOne(
    { linodeId },
    { $set: { lastActivity: new Date(), status: 'running' } }
  );
}

// ── Inactivity check — destroy servers idle for 1 hour ──
async function checkInactivity() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
  const stale = await db.collection('provisioned_servers')
    .find({ status: 'running', lastActivity: { $lt: cutoff } })
    .toArray();

  for (const server of stale) {
    console.log('[provisioner] Inactivity shutdown:', server.label, '(' + server.game + ')');
    try {
      await destroyServer(server.linodeId);
    } catch (e) {
      console.error('[provisioner] Failed to destroy', server.linodeId, e.message);
    }
  }

  return stale.length;
}

// ── Count active servers (for auto-provision trigger) ──
async function countActive() {
  return db.collection('provisioned_servers')
    .countDocuments({ status: { $in: ['provisioning', 'running'] } });
}

module.exports = {
  init,
  provisionServer,
  destroyServer,
  getLinodeStatus,
  listActive,
  listAll,
  touchActivity,
  checkInactivity,
  countActive,
};
