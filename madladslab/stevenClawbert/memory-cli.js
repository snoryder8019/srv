#!/usr/bin/env node
/**
 * Steven Clawbert Memory CLI
 * Usage:
 *   node memory-cli.js get <key>
 *   node memory-cli.js set <key> <category> <content> [tags...]
 *   node memory-cli.js search <query> [--category=x] [--limit=n]
 *   node memory-cli.js list [category]
 *   node memory-cli.js categories
 *   node memory-cli.js stats
 *   node memory-cli.js pin <key>
 *   node memory-cli.js unpin <key>
 *   node memory-cli.js archive <key>
 *   node memory-cli.js delete <key>
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

// Load DB_URL from .env
const envPath = '/srv/madladslab/.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DB_URL='))?.split('=').slice(1).join('=');
if (!dbUrl) { console.error('DB_URL not found in .env'); process.exit(1); }

const DB_NAME = dbUrl.match(/\/([^/?]+)(\?|$)/)?.[1] || 'madladslab';
const COLLECTION = 'stevenClawbert_memory';

let client, col;

async function connect() {
  client = new MongoClient(dbUrl);
  await client.connect();
  col = client.db(DB_NAME).collection(COLLECTION);
}

async function disconnect() {
  if (client) await client.close();
}

function pp(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

const [,, cmd, ...args] = process.argv;

async function main() {
  await connect();

  switch (cmd) {
    case 'get': {
      const doc = await col.findOne({ key: args[0], archived: { $ne: true } });
      pp(doc || { error: 'not found' });
      break;
    }
    case 'set': {
      const [key, category, content, ...tags] = args;
      if (!key || !content) { console.error('Usage: set <key> <category> <content> [tags...]'); break; }
      const now = new Date();
      await col.updateOne(
        { key },
        { $set: { key, category: category || 'general', content, tags, metadata: {}, updatedAt: now, pinned: false, archived: false }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      console.log(`✓ saved: ${key}`);
      break;
    }
    case 'search': {
      const query = args[0];
      const limitFlag = args.find(a => a.startsWith('--limit='));
      const catFlag = args.find(a => a.startsWith('--category='));
      const limit = limitFlag ? parseInt(limitFlag.split('=')[1]) : 20;
      const filter = { archived: { $ne: true } };
      if (query) filter.$text = { $search: query };
      if (catFlag) filter.category = catFlag.split('=')[1];
      const proj = query ? { score: { $meta: 'textScore' } } : {};
      const sort = query ? { score: { $meta: 'textScore' } } : { updatedAt: -1 };
      const results = await col.find(filter).project(proj).sort(sort).limit(limit).toArray();
      pp(results);
      break;
    }
    case 'list': {
      const category = args[0];
      const filter = { archived: { $ne: true } };
      if (category) filter.category = category;
      const docs = await col.find(filter).sort({ pinned: -1, updatedAt: -1 }).limit(50).toArray();
      pp(docs);
      break;
    }
    case 'categories': {
      const cats = await col.aggregate([
        { $match: { archived: { $ne: true } } },
        { $group: { _id: '$category', count: { $sum: 1 }, lastUpdated: { $max: '$updatedAt' } } },
        { $sort: { lastUpdated: -1 } }
      ]).toArray();
      pp(cats);
      break;
    }
    case 'stats': {
      const [total, archived, pinned] = await Promise.all([
        col.countDocuments({ archived: { $ne: true } }),
        col.countDocuments({ archived: true }),
        col.countDocuments({ pinned: true, archived: { $ne: true } })
      ]);
      pp({ total, archived, pinned });
      break;
    }
    case 'pin': {
      await col.updateOne({ key: args[0] }, { $set: { pinned: true, updatedAt: new Date() } });
      console.log(`✓ pinned: ${args[0]}`);
      break;
    }
    case 'unpin': {
      await col.updateOne({ key: args[0] }, { $set: { pinned: false, updatedAt: new Date() } });
      console.log(`✓ unpinned: ${args[0]}`);
      break;
    }
    case 'archive': {
      await col.updateOne({ key: args[0] }, { $set: { archived: true, updatedAt: new Date() } });
      console.log(`✓ archived: ${args[0]}`);
      break;
    }
    case 'delete': {
      await col.deleteOne({ key: args[0] });
      console.log(`✓ deleted: ${args[0]}`);
      break;
    }
    default:
      console.log('Commands: get, set, search, list, categories, stats, pin, unpin, archive, delete');
  }

  await disconnect();
}

main().catch(err => { console.error(err.message); process.exit(1); });
