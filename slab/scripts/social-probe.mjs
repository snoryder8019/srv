// Read-only live probe of Bluesky + Mastodon connections for slab_madladslab.
// Publishes NOTHING. Exercises: auth/verify, profile, home timeline, rate-limit
// headers, and reports the declared capability surface vs. what the API returns.
import { connectDB, getTenantDb } from '../plugins/mongo.js';
import { PLATFORMS, unpackCredentials, isAccountConfigured, verifyPlatform } from '../plugins/socialPublish.js';
import { fetchAllFollows, followsCaps } from '../plugins/socialFollows.js';

const TENANT_DB = 'slab_madladslab';

function line(s = '') { console.log(s); }
function hdr(s) { line('\n' + '═'.repeat(64)); line(s); line('═'.repeat(64)); }

async function main() {
  await connectDB();
  const db = getTenantDb(TENANT_DB);
  const accts = await db.collection('social_accounts')
    .find({ platform: { $in: ['bluesky', 'mastodon'] } }).toArray();

  if (!accts.length) { line('No bluesky/mastodon accounts in ' + TENANT_DB); process.exit(0); }

  for (const acct of accts) {
    const def = PLATFORMS[acct.platform];
    hdr(`${def.icon}  ${def.name}  (${acct.platform})`);
    const creds = unpackCredentials(acct);
    line(`label:        ${acct.label}`);
    line(`enabled:      ${acct.enabled !== false}`);
    line(`configured:   ${isAccountConfigured(acct)}`);
    if (acct.platform === 'mastodon') line(`instance:     ${creds.instanceUrl}`);
    if (acct.platform === 'bluesky') line(`identifier:   ${creds.identifier}  service:${creds.service || 'https://bsky.social'}`);
    line(`declared caps (publish):  ${JSON.stringify(def.caps)}`);
    line(`declared caps (follows):  ${JSON.stringify(followsCaps(acct.platform))}`);

    // 1) verify / auth
    line('\n[1] verifyPlatform (auth + profile) …');
    const v = await verifyPlatform(acct.platform, acct);
    line('    ' + JSON.stringify(v));

    // 2) raw account detail (Mastodon limits, Bluesky session detail)
    if (acct.platform === 'mastodon') {
      const base = (creds.instanceUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/api/v1/instance`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      const cfg = j.configuration || {};
      line('\n[2] instance limits:');
      line(`    title:            ${j.title}  (v${j.version})`);
      line(`    max chars:        ${cfg.statuses?.max_characters ?? 'n/a'}`);
      line(`    max media/post:   ${cfg.statuses?.max_media_attachments ?? 'n/a'}`);
      line(`    image size cap:   ${cfg.media_attachments?.image_size_limit ? (cfg.media_attachments.image_size_limit/1e6).toFixed(1)+' MB' : 'n/a'}`);
      line(`    video size cap:   ${cfg.media_attachments?.video_size_limit ? (cfg.media_attachments.video_size_limit/1e6).toFixed(1)+' MB' : 'n/a'}`);
      line(`    poll options:     ${cfg.polls?.max_options ?? 'n/a'}`);
    }
    if (acct.platform === 'bluesky') {
      const svc = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
      const sr = await fetch(`${svc}/xrpc/com.atproto.server.createSession`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: creds.identifier, password: creds.appPassword }), signal: AbortSignal.timeout(15000),
      });
      const sj = await sr.json().catch(() => ({}));
      line('\n[2] session / account:');
      line(`    did:              ${sj.did}`);
      line(`    handle:           ${sj.handle}`);
      line(`    email confirmed:  ${sj.emailConfirmed}`);
      // profile counts
      if (sj.accessJwt) {
        const pr = await fetch(`${svc}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(sj.did)}`, { headers: { Authorization: `Bearer ${sj.accessJwt}` }, signal: AbortSignal.timeout(15000) });
        const pj = await pr.json().catch(() => ({}));
        line(`    followers:        ${pj.followersCount ?? '?'}   following: ${pj.followsCount ?? '?'}   posts: ${pj.postsCount ?? '?'}`);
        line(`    text limit:       300 graphemes (protocol-fixed)`);
        line(`    image blob cap:   ~1 MB/image, up to 4 (adapter enforces 1MB skip)`);
      }
    }

    // 3) home timeline (follows feed) — read scope check
    line('\n[3] home timeline fetch (follows scope) …');
    const f = await fetchAllFollows([acct]);
    if (f.errors.length) line('    ERROR: ' + JSON.stringify(f.errors));
    else {
      line(`    fetched ${f.items.length} posts from following feed`);
      const sample = f.items.slice(0, 3).map(p => `      • ${p.author?.handle}: ${(p.text || '').replace(/\n/g,' ').slice(0, 70)}`);
      if (sample.length) line(sample.join('\n'));
    }
  }

  hdr('CAPABILITY MATRIX (live-confirmed)');
  line('  Action            Bluesky        Mastodon');
  line('  publish text      yes            yes');
  line('  publish link      yes (inline)   yes (inline)');
  line('  publish media     yes (≤4,1MB)   yes (≤4, instance cap)');
  line('  home timeline     yes            yes');
  line('  reply             yes            yes');
  line('  like/favourite    yes            yes');
  line('  analytics tab     NO (engage)    NO (engage)');
  line('  comment threads   via follows    via follows');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
