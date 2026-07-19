// ── Unified client notes ────────────────────────────────────────────────────
// A client's notes live in two places, and every surface that shows them (the
// client Notes tab, the engagement editor, a meeting detail) renders both
// without ever double-listing:
//   1. Engine notes — docs in the `notes` collection bound to this client via
//      clientId. Authored from a client-scoped Notes surface, or tagged to the
//      client in the main Notes tool. These carry the full pipe (classify /
//      TL;DR / tags / distribute to blog·email·campaign·web·ticket).
//   2. Pushed notes — entries in the embedded client.notes[] array, dropped in
//      by the Notes tool's "Client Note" distribute target. Each keeps a
//      `noteId` backlink to its source engine note.
// Engine notes are the source of truth; we fold in only those pushed entries
// whose source note isn't already bound here, and collapse duplicate pushes of
// the same note — so the log stays stable and non-repeating everywhere.
export async function buildClientNotes(db, client) {
  if (!client) return [];
  const engineNotes = await db.collection('notes')
    .find({ clientId: client._id })
    .sort({ createdAt: -1 })
    .toArray();
  const engineIds = new Set(engineNotes.map(n => n._id.toString()));

  // Legacy tolerance: some client docs still store `notes` as a plain string.
  const embedded = Array.isArray(client.notes)
    ? client.notes
    : (typeof client.notes === 'string' && client.notes.trim()
        ? [{ id: null, content: client.notes.trim(), source: 'legacy', createdAt: client.createdAt || null }]
        : []);

  const list = [];
  for (const n of engineNotes) {
    list.push({
      engineId:  n._id.toString(),  // note's own id — Delete removes it from the engine
      entryId:   null,              // authored notes have no embedded copy
      title:     n.title || 'Untitled Note',
      content:   n.tldr || n.body || '',
      tags:      Array.isArray(n.tags) ? n.tags : [],
      source:    'authored',
      createdBy: n.createdBy || '',
      createdAt: n.createdAt || null,
    });
  }
  const seenPush = new Set();
  for (const e of embedded) {
    const nid = e.noteId ? e.noteId.toString() : null;
    // Skip pushed entries whose source engine note is already listed above.
    if (nid && engineIds.has(nid)) continue;
    // Collapse duplicate pushes of the SAME note into a single row.
    if (nid) { if (seenPush.has(nid)) continue; seenPush.add(nid); }
    list.push({
      engineId:  nid,                              // source note — Open links to it
      entryId:   e.id ? e.id.toString() : null,    // embedded copy — Remove detaches it
      title:     e.title || (e.source === 'legacy' ? 'Legacy note' : 'Pushed note'),
      content:   e.content || '',
      tags:      [],
      source:    e.source === 'legacy' ? 'legacy' : 'pushed',
      createdBy: e.createdBy || '',
      createdAt: e.createdAt || null,
    });
  }
  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return list;
}
