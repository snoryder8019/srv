// One-off: repair the madladslab Facebook connection.
// Exchanges for a long-lived token, derives the correct Page token, stores
// the correct Page ID + Page token. Prints only IDs/names/scopes (never tokens).
import './../config/config.js';
import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { encrypt, decrypt } from '../plugins/crypto.js';

const G = 'https://graph.facebook.com/v21.0';
const WANT_NAME = 'madladslab';

await connectDB();
const slab = getSlabDb();

// Locate the tenant holding the facebook connection
const tenants = await slab.collection('tenants').find({}).project({ db: 1, domain: 1 }).toArray();
const seen = new Set();
let acct = null, tdb = null;
for (const t of tenants) {
  if (!t.db || seen.has(t.db)) continue; seen.add(t.db);
  try {
    const a = await getTenantDb(t.db).collection('social_accounts').findOne({ platform: 'facebook' });
    if (a) { acct = a; tdb = t.db; break; }
  } catch {}
}
if (!acct) { console.log('No facebook connection found'); process.exit(0); }
console.log('Tenant db:', tdb, '| stored Page ID:', acct.credentials?.pageId);

const userToken = decrypt(acct.secrets.pageAccessToken);
const appId = acct.credentials?.appId;
const appSecret = acct.secrets?.appSecret ? decrypt(acct.secrets.appSecret) : null;
console.log('App ID present:', !!appId, '| App Secret present:', !!appSecret);

const J = async (url) => { const r = await fetch(url); return { s: r.status, b: await r.json().catch(() => ({})) }; };

// Token type + scopes
const dbg = (await J(`${G}/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(userToken)}`)).b;
const scopes = dbg?.data?.scopes || [];
console.log('Token type:', dbg?.data?.type, '| scopes:', scopes.join(',') || '(none)');
const hasPost = scopes.includes('pages_manage_posts');
console.log('Has pages_manage_posts:', hasPost);

// Exchange for long-lived (only meaningful for a USER token + app creds)
let llToken = userToken;
if (appId && appSecret) {
  const ex = await J(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(userToken)}`);
  if (ex.b?.access_token) { llToken = ex.b.access_token; console.log('Long-lived exchange: OK'); }
  else console.log('Long-lived exchange skipped/failed:', JSON.stringify(ex.b?.error || ex.b).slice(0, 160));
}

// Find the page + its page token
const accts = await J(`${G}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(llToken)}`);
const pages = Array.isArray(accts.b?.data) ? accts.b.data : [];
console.log('Pages found:', pages.map(p => `${p.name}(${p.id})`).join(', ') || '(none)');
const page = pages.find(p => p.name?.toLowerCase() === WANT_NAME) || pages[0];
if (!page) { console.log('No manageable page returned — re-grant page permissions for this app.'); process.exit(0); }

// Verify the page token can read the page
const v = await J(`${G}/${page.id}?fields=id,name&access_token=${encodeURIComponent(page.access_token)}`);
console.log(`Verify GET /${page.id}: status ${v.s} →`, JSON.stringify(v.b));
if (v.s !== 200) { console.log('Page token did not verify — not storing.'); process.exit(0); }

// Store the corrected Page ID + Page token
await getTenantDb(tdb).collection('social_accounts').updateOne(
  { platform: 'facebook' },
  { $set: {
      'credentials.pageId': page.id,
      'secrets.pageAccessToken': encrypt(page.access_token),
      lastTestOk: true, lastTestAt: new Date(),
      profile: { name: page.name, url: `https://facebook.com/${page.id}` },
      updatedAt: new Date(),
  } },
);
console.log(`\n✅ Stored Page ID ${page.id} ("${page.name}") + page token.`);
console.log(hasPost ? '✅ Token has pages_manage_posts — posting should work.'
                    : '⚠️  Token is MISSING pages_manage_posts — reading works but posting will fail. Re-grant that scope.');
process.exit(0);
