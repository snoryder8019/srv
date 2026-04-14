// ── Security Dashboard route — add before `export default router;` ──────────
// Paste this block into /srv/slab/routes/superadmin.js just before the final export

router.get('/security', async (req, res) => {
  const slab = getSlabDb();

  const [recentEvents, latestSnapshot, latestStats] = await Promise.all([
    slab.collection('security_events')
      .find().sort({ timestamp: -1 }).limit(200).toArray(),
    slab.collection('security_snapshots')
      .findOne({}, { sort: { createdAt: -1 } }),
    slab.collection('security_system_stats')
      .findOne({}, { sort: { recordedAt: -1 } }),
  ]);

  // Summary tallies
  const bans   = recentEvents.filter(e => e.action === 'ban');
  const unbans = recentEvents.filter(e => e.action === 'unban');
  const found  = recentEvents.filter(e => e.action === 'found');

  // Top attacking IPs
  const ipCount = {};
  for (const ev of found.concat(bans)) {
    if (ev.ip) ipCount[ev.ip] = (ipCount[ev.ip] || 0) + 1;
  }
  const topIPs = Object.entries(ipCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  res.render('superadmin/security', {
    user: req.superAdmin,
    recentEvents,
    latestSnapshot,
    latestStats,
    summary: { bans: bans.length, unbans: unbans.length, found: found.length },
    topIPs,
    currentJails: latestSnapshot?.bans || [],
  });
});

// Security API — live refresh for polling
router.get('/api/security/summary', async (req, res) => {
  const slab = getSlabDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [events, snapshot, stats] = await Promise.all([
    slab.collection('security_events').find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).toArray(),
    slab.collection('security_snapshots').findOne({}, { sort: { createdAt: -1 } }),
    slab.collection('security_system_stats').findOne({}, { sort: { recordedAt: -1 } }),
  ]);

  res.json({
    ok: true,
    events: events.slice(0, 50),
    jails: snapshot?.bans || [],
    stats,
    summary: {
      bans:   events.filter(e => e.action === 'ban').length,
      unbans: events.filter(e => e.action === 'unban').length,
      found:  events.filter(e => e.action === 'found').length,
    },
  });
});
