'use strict';

/**
 * World Backup — saves game world files to Linode Object Storage,
 * metadata to MongoDB. Restores to new VMs on spin-up.
 *
 * Bucket: game-saves/<userId>/<game>/<timestamp>.tar.gz
 * DB:     world_backups { userId, game, s3Key, fileSize, createdAt }
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const BACKUP_DIR = '/srv/games/backups';
const S3_PREFIX = 'game-saves';

// S3 client for Linode Object Storage
let s3 = null;
function getS3() {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.LINODE_S3_REGION || 'us-ord-1',
      endpoint: process.env.LINODE_S3_ENDPOINT || 'https://us-ord-1.linodeobjects.com',
      credentials: {
        accessKeyId: process.env.LINODE_ACCESS,
        secretAccessKey: process.env.LINODE_SECRET,
      },
      forcePathStyle: true,
    });
  }
  return s3;
}

const BUCKET = process.env.LINODE_BUCKET || 'madladslab';

// Save paths per game — remote Linode paths under /srv/game/
const SAVE_PATHS = {
  rust: {
    dirs: ['server/community'],
    patterns: ['*.sav*', '*.map', '*.dat', 'player.*.db*', 'sv.files.*.db*', 'relationship.*.db*', 'cfg/'],
    extras: ['carbon/configs/', 'carbon/data/'],
  },
  valheim: {
    dirs: ['worlds'],
    patterns: ['*.db', '*.db.old', '*.fwl', '*.fwl.old', 'adminlist.txt', 'bannedlist.txt', 'permittedlist.txt'],
  },
  l4d2: {
    dirs: ['left4dead2/cfg', 'addons/sourcemod/configs'],
    patterns: ['*'],
  },
  '7dtd': {
    dirs: ['UserDataFolder/Saves'],
    patterns: ['*'],
    extras: ['serverconfig.xml'],
  },
  se: {
    dirs: ['Instance/Saves'],
    patterns: ['*'],
    extras: ['Instance/SpaceEngineers-Dedicated.cfg'],
  },
  palworld: {
    dirs: ['Pal/Saved/SaveGames'],
    patterns: ['*'],
    extras: ['Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'],
  },
  windrose: {
    dirs: ['R5/Saved/SaveProfiles'],
    patterns: ['*'],
    extras: ['R5/ServerDescription.json'],
  },
};

// Local server save paths (on this box)
const LOCAL_PATHS = {
  rust: '/srv/games/rust/server/madlads',
  valheim: '/srv/games/valheim/worlds',
  l4d2: '/srv/games/l4d2/left4dead2/cfg',
  '7dtd': '/srv/games/7dtd/UserDataFolder/Saves',
  se: '/srv/games/se/Instance/Saves',
  palworld: '/srv/games/palworld/Pal/Saved/SaveGames',
  windrose: '/srv/games/windrose/R5/Saved/SaveProfiles',
};

let db = null;

function init(database) {
  db = database;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  ensureIndexes();
}

async function ensureIndexes() {
  try {
    await db.collection('world_backups').createIndex({ userId: 1, game: 1, createdAt: -1 });
    await db.collection('world_backups').createIndex({ createdAt: -1 });
  } catch (e) {}
}

/**
 * Backup from a provisioned Linode → tar → upload to bucket → record in DB.
 */
async function backupFromLinode(ip, game, userId) {
  const saves = SAVE_PATHS[game];
  if (!saves) throw new Error('No save paths for ' + game);

  const timestamp = Date.now();
  const tarName = game + '-' + timestamp + '.tar.gz';
  const tmpDir = path.join(BACKUP_DIR, 'tmp-' + timestamp);
  const tarPath = path.join(BACKUP_DIR, tarName);

  fs.mkdirSync(tmpDir, { recursive: true });

  // SCP save directories from Linode
  let filesFound = 0;
  for (const dir of saves.dirs) {
    try {
      execSync(`scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -r root@${ip}:/srv/game/${dir} ${tmpDir}/ 2>/dev/null`, { timeout: 60000 });
      filesFound++;
    } catch (e) {}
  }
  if (saves.extras) {
    for (const extra of saves.extras) {
      try {
        execSync(`scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -r root@${ip}:/srv/game/${extra} ${tmpDir}/ 2>/dev/null`, { timeout: 30000 });
        filesFound++;
      } catch (e) {}
    }
  }

  if (filesFound === 0) {
    execSync(`rm -rf ${tmpDir}`);
    return { ok: false, message: 'No save files found' };
  }

  // Tar it
  execSync(`tar czf ${tarPath} -C ${tmpDir} .`);
  const fileSize = fs.statSync(tarPath).size;
  execSync(`rm -rf ${tmpDir}`);

  // Upload to Linode Object Storage
  const s3Key = `${S3_PREFIX}/${userId}/${game}/${tarName}`;
  await getS3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: fs.readFileSync(tarPath),
    ContentType: 'application/gzip',
  }));

  // Clean up local tar
  fs.unlinkSync(tarPath);

  // Record in DB
  const record = {
    userId, game, s3Key, fileSize,
    source: 'linode', sourceIp: ip,
    createdAt: new Date(),
  };
  await db.collection('world_backups').insertOne(record);
  console.log('[backup] Uploaded', s3Key, '(' + Math.round(fileSize / 1024) + 'KB)');

  return { ok: true, record };
}

/**
 * Backup local server to bucket.
 */
async function backupLocal(game, userId) {
  const localPath = LOCAL_PATHS[game];
  if (!localPath || !fs.existsSync(localPath)) {
    return { ok: false, message: 'No local saves for ' + game };
  }

  const timestamp = Date.now();
  const tarName = game + '-' + timestamp + '-local.tar.gz';
  const tarPath = path.join(BACKUP_DIR, tarName);

  execSync(`tar czf ${tarPath} -C ${path.dirname(localPath)} ${path.basename(localPath)}`);
  const fileSize = fs.statSync(tarPath).size;

  const s3Key = `${S3_PREFIX}/${userId}/${game}/${tarName}`;
  await getS3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: fs.readFileSync(tarPath),
    ContentType: 'application/gzip',
  }));

  fs.unlinkSync(tarPath);

  const record = {
    userId, game, s3Key, fileSize,
    source: 'local',
    createdAt: new Date(),
  };
  await db.collection('world_backups').insertOne(record);
  console.log('[backup] Local backup uploaded', s3Key, '(' + Math.round(fileSize / 1024) + 'KB)');

  return { ok: true, record };
}

/**
 * Restore: download from bucket → SCP to new Linode → extract.
 */
/**
 * Restore a specific backup (by ID) to a provisioned Linode.
 * Falls back to latest if no backupId given.
 */
async function restoreToLinode(ip, game, userId, backupId) {
  let backup;
  if (backupId) {
    const { ObjectId } = require('mongodb');
    backup = await db.collection('world_backups').findOne({ _id: new ObjectId(backupId) });
  } else {
    backup = await db.collection('world_backups')
      .findOne({ userId, game }, { sort: { createdAt: -1 } });
  }
  if (!backup) return { ok: false, message: 'No backup found' };

  const tarPath = path.join(BACKUP_DIR, 'restore-' + Date.now() + '.tar.gz');

  // Download from bucket
  const response = await getS3().send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: backup.s3Key,
  }));

  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  fs.writeFileSync(tarPath, Buffer.concat(chunks));

  try {
    // Upload to Linode + extract
    execSync(`scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes ${tarPath} root@${ip}:/tmp/world-restore.tar.gz`, { timeout: 60000 });
    execSync(`ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes root@${ip} "mkdir -p /srv/game && cd /srv/game && tar xzf /tmp/world-restore.tar.gz && rm /tmp/world-restore.tar.gz"`, { timeout: 30000 });
    console.log('[backup] Restored', backup.s3Key, 'to', ip);
    return { ok: true, restored: backup.s3Key };
  } catch (e) {
    return { ok: false, message: 'Restore failed: ' + e.message };
  } finally {
    fs.unlinkSync(tarPath);
  }
}

async function listBackups(userId, game) {
  const query = { userId };
  if (game) query.game = game;
  return db.collection('world_backups').find(query).sort({ createdAt: -1 }).limit(20).toArray();
}

async function listAllBackups(limit) {
  return db.collection('world_backups').find().sort({ createdAt: -1 }).limit(limit || 50).toArray();
}

/**
 * Restore a specific backup to the local server.
 */
async function restoreLocal(game, backupId) {
  const { ObjectId } = require('mongodb');
  const backup = await db.collection('world_backups').findOne({ _id: new ObjectId(backupId) });
  if (!backup) return { ok: false, message: 'No backup found' };

  const localPath = LOCAL_PATHS[game];
  if (!localPath) return { ok: false, message: 'No local path configured for ' + game };

  const tarPath = path.join(BACKUP_DIR, 'restore-local-' + Date.now() + '.tar.gz');

  // Download from bucket
  const response = await getS3().send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: backup.s3Key,
  }));

  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  fs.writeFileSync(tarPath, Buffer.concat(chunks));

  try {
    // Ensure target directory exists and extract
    const targetDir = path.dirname(localPath);
    fs.mkdirSync(targetDir, { recursive: true });
    execSync(`tar xzf ${tarPath} -C ${targetDir}`);
    console.log('[backup] Restored local', backup.s3Key, 'to', targetDir);
    return { ok: true, restored: backup.s3Key, target: targetDir };
  } catch (e) {
    return { ok: false, message: 'Local restore failed: ' + e.message };
  } finally {
    try { fs.unlinkSync(tarPath); } catch (e) {}
  }
}

/**
 * Get a single backup by ID.
 */
async function getBackup(backupId) {
  const { ObjectId } = require('mongodb');
  return db.collection('world_backups').findOne({ _id: new ObjectId(backupId) });
}

/**
 * Delete a backup from S3 and DB.
 */
async function deleteBackup(backupId) {
  const { ObjectId } = require('mongodb');
  const backup = await db.collection('world_backups').findOne({ _id: new ObjectId(backupId) });
  if (!backup) return { ok: false, message: 'Backup not found' };

  // Delete from S3
  try {
    await getS3().send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: backup.s3Key,
    }));
  } catch (e) {
    console.error('[backup] S3 delete failed:', e.message);
  }

  // Delete from DB
  await db.collection('world_backups').deleteOne({ _id: new ObjectId(backupId) });
  console.log('[backup] Deleted', backup.s3Key);
  return { ok: true, deleted: backup.s3Key };
}

module.exports = {
  init, backupFromLinode, backupLocal, restoreToLinode, restoreLocal,
  listBackups, listAllBackups, getBackup, deleteBackup,
};
