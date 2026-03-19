# Candace Wallace — Marketing Strategy Website

Express app for the official Candace Wallace Marketing Strategist website.

## Stack
- **Runtime:** Node.js 18+ (ESM)
- **Framework:** Express 4.x + EJS
- **Database:** MongoDB (shared madLadsLab cluster)
- **Auth:** Google OAuth 2.0 → JWT (httpOnly cookie)
- **Session:** express-session + connect-mongo (for OAuth state only)
- **Dev:** nodemon

## Port
`3600` — configure Apache `.conf` to proxy this when domain is live.

## Tmux Session
```bash
tmux attach -t candaceWallace
npx nodemon bin/www.js
```

## Directory Structure
```
candaceWallace/
├── app.js                  # Express app
├── bin/www.js              # Entry point
├── config/config.js        # Env config
├── plugins/
│   ├── mongo.js            # MongoDB connection (shared madLadsLab DB)
│   └── passport.js         # Google OAuth strategy
├── middleware/
│   └── jwtAuth.js          # JWT cookie verification + issuance
├── routes/
│   ├── index.js            # Public site (GET /)
│   ├── auth.js             # Google OAuth (/auth/google, /auth/google/callback, /auth/logout)
│   └── admin.js            # Admin dashboard (/admin, /admin/login)
├── views/
│   ├── index.ejs           # Public marketing site (political theme)
│   └── admin/
│       ├── login.ejs       # Admin login page
│       └── dashboard.ejs   # Admin dashboard
└── public/                 # Static assets
```

## Auth Flow
1. User visits `/admin` → redirected to `/admin/login` (no JWT cookie)
2. User clicks "Sign in with Google" → `/auth/google` → Google OAuth
3. Google callback → `/auth/google/callback`
   - Looks up user in madLadsLab `users` collection by email
   - Checks `user.isCandaceAdmin === true`
   - If authorized: issues JWT in httpOnly cookie `cw_token` (8h), redirects to `/admin`
   - If unauthorized: redirects to `/admin/login?error=unauthorized`
4. All `/admin` routes check `cw_token` via `requireAdmin` middleware

## Granting Admin Access
To give a user admin access, set `isCandaceAdmin: true` in the madLadsLab MongoDB `users` collection:
```js
// In MongoDB shell or Compass:
db.users.updateOne(
  { email: "user@example.com" },
  { $set: { isCandaceAdmin: true } }
)
```

## Environment Variables (.env)
| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3600) |
| `NODE_ENV` | `production` or `development` |
| `DOMAIN` | Full domain URL for OAuth callback (e.g. `https://candacewallace.com`) |
| `DB_URL` | MongoDB connection string (shared with madLadsLab) |
| `DB_NAME` | Database name (`madLadsLab`) |
| `GGLCID` | Google OAuth client ID |
| `GGLSEC` | Google OAuth client secret |
| `JWT_SECRET` | Secret for signing/verifying JWT tokens |
| `SESHSEC` | Express session secret |

## Google Console Setup (when domain is live)
Add the following to **Authorized redirect URIs** in Google Cloud Console:
```
https://candacewallace.com/auth/google/callback
```

## Apache VirtualHost
When the domain is ready, add a `.conf` file proxying to port 3600:
```apache
<VirtualHost *:443>
    ServerName candacewallace.com
    ProxyPass / http://localhost:3600/
    ProxyPassReverse / http://localhost:3600/
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # ... SSL config
</VirtualHost>
```
