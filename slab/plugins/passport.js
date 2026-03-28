import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import { getSlabDb, getTenantDb } from './mongo.js';
import { ObjectId } from 'mongodb';
import { config } from '../config/config.js';

/** Resolve the correct user DB — tenant DB from session, lookup by domain, or slab registry */
async function getUserDb(req) {
  // 1. Session has tenant DB name
  const tenantDbName = req?.session?.tenantDbName;
  if (tenantDbName) return getTenantDb(tenantDbName);

  // 2. Tenant middleware resolved it
  if (req?.db) return req.db;

  // 3. Look up tenant by returnDomain stored in session
  const returnDomain = req?.session?.returnDomain;
  if (returnDomain && returnDomain !== 'slab.madladslab.com' && returnDomain !== 'localhost') {
    try {
      const slab = getSlabDb();
      const tenant = await slab.collection('tenants').findOne({ domain: returnDomain });
      if (tenant?.db) {
        // Cache it in session for subsequent calls
        if (req?.session) req.session.tenantDbName = tenant.db;
        return getTenantDb(tenant.db);
      }
    } catch {}
  }

  // 4. Fallback — slab registry
  return getSlabDb();
}

passport.use(
  new GoogleStrategy(
    {
      clientID: config.GGLCID,
      clientSecret: config.GGLSEC,
      callbackURL: `${config.DOMAIN}/auth/google/callback`,
      proxy: true,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const db = await getUserDb(req);
        const users = db.collection('users');
        let user = await users.findOne({ email: profile.emails[0].value });

        if (!user) {
          const result = await users.insertOne({
            providerID: profile.id,
            provider: 'google',
            email: profile.emails[0].value,
            displayName: profile.displayName,
            firstName: profile.name.givenName,
            lastName: profile.name.familyName,
            password: '',
            isAdmin: false,
            tutorials: {
              seen: {},
              dismissed: {},
              autoPlay: true,
              lastReset: null,
            },
          });
          user = await users.findOne({ _id: result.insertedId });
        }

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user._id));

passport.deserializeUser(async (id, done) => {
  try {
    // Deserialize only needs to find the user — check slab registry
    // (session-based lookup; JWT auth is used for actual route protection)
    const db = getSlabDb();
    const users = db.collection('users');
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

export default passport;
