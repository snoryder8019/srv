/**
 * Merge duplicate active chat threads that share the same {kind, module, refId}
 * scope — the artifacts of the pre-fix /agent-chat/resolve race (the ✦ launcher
 * fired find-or-create from every page, and concurrent opens minted duplicates).
 *
 * For each dup group: the OLDEST thread is canonical; every other thread's
 * messages are re-pointed to it, members are merged, and the duplicate thread is
 * ARCHIVED (status:'archived', mergedInto set) — not deleted, so it's
 * recoverable. Canonical lastMessageAt/preview are recomputed.
 *
 * Run from /srv/slab:
 *   node scripts/dedup-chat-threads.mjs                 # DRY RUN, all tenants
 *   node scripts/dedup-chat-threads.mjs --commit        # apply, all tenants
 *   node scripts/dedup-chat-threads.mjs slab_madladslab --commit   # one tenant
 */
import 'dotenv/config';
import { connectDB, getSlabDb, getTenantDb, tenantClusterReady } from '../plugins/mongo.js';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const onlyDb = argv.find((a) => !a.startsWith('--'));

await connectDB();
if (!tenantClusterReady()) await new Promise((r) => setTimeout(r, 1500));

const slab = getSlabDb();
const tenants = (await slab.collection('tenants').find({}, { projection: { db: 1 } }).toArray())
  .map((t) => t.db).filter(Boolean).filter((db) => !onlyDb || db === onlyDb);

console.log(`\n${COMMIT ? '*** COMMIT ***' : '--- DRY RUN ---'}  scanning ${tenants.length} tenant(s)\n`);

let groups = 0, archived = 0, movedMsgs = 0;

for (const dbName of tenants) {
  let db;
  try { db = getTenantDb(dbName); } catch { continue; }
  const threads = db.collection('chat_threads');
  const messages = db.collection('chat_messages');

  let dupGroups;
  try {
    dupGroups = await threads.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: { kind: '$kind', module: '$context.module', refId: '$context.refId' },
                  n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } },
    ]).toArray();
  } catch { continue; }
  if (!dupGroups.length) continue;

  for (const g of dupGroups) {
    // Oldest = canonical.
    const docs = await threads.find({ _id: { $in: g.ids } }).sort({ createdAt: 1 }).toArray();
    const canonical = docs[0];
    const dups = docs.slice(1);
    groups++;

    const dupIds = dups.map((d) => d._id);
    const msgCount = await messages.countDocuments({ threadId: { $in: dupIds } });
    console.log(`${dbName}  ${JSON.stringify(g._id)}  keep ${canonical._id} (${new Date(canonical.createdAt).toISOString().slice(0,10)}), merge ${dups.length} thread(s), move ${msgCount} msg(s)`);

    if (!COMMIT) { archived += dups.length; movedMsgs += msgCount; continue; }

    // 1) Re-point messages to the canonical thread.
    if (msgCount) await messages.updateMany({ threadId: { $in: dupIds } }, { $set: { threadId: canonical._id } });

    // 2) Merge members (union by userId).
    const seen = new Set((canonical.members || []).map((m) => String(m.userId)));
    const extra = [];
    for (const d of dups) for (const m of (d.members || [])) {
      const k = String(m.userId);
      if (!seen.has(k)) { seen.add(k); extra.push(m); }
    }
    if (extra.length) await threads.updateOne({ _id: canonical._id }, { $push: { members: { $each: extra } } });

    // 3) Recompute canonical lastMessage from the merged set.
    const last = await messages.find({ threadId: canonical._id }).sort({ createdAt: -1 }).limit(1).toArray();
    if (last[0]) {
      await threads.updateOne({ _id: canonical._id }, { $set: {
        lastMessageAt: last[0].createdAt,
        lastMessagePreview: String(last[0].body || '').slice(0, 140),
        updatedAt: new Date(),
      } });
    }

    // 4) Archive the duplicates (recoverable).
    await threads.updateMany({ _id: { $in: dupIds } },
      { $set: { status: 'archived', archivedAt: new Date(), mergedInto: canonical._id } });

    archived += dups.length; movedMsgs += msgCount;
  }
}

console.log(`\n${COMMIT ? 'merged' : 'would merge'}: ${groups} group(s), ${archived} duplicate thread(s) archived, ${movedMsgs} message(s) re-pointed.`);
if (!COMMIT) console.log('DRY RUN — nothing written. Add --commit to apply.');
process.exit(0);
