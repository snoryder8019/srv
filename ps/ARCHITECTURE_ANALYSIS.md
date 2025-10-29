# Stringborn Universe - Architecture Analysis for Auto-Scaling

**Date:** 2025-10-29
**Analysis Focus:** Current deployment architecture, scaling capabilities, and recommendations

---

## EXECUTIVE SUMMARY

The Stringborn Universe is a **monolithic Express.js application** with a **separate microservice** for game state management. Current deployment uses **manual tmux session management** on a single server with **no containerization, load balancing, or clustering mechanisms**. The architecture is suitable for small-scale operations but requires significant restructuring for production auto-scaling.

**Key Findings:**
- Single-server monolithic architecture with tmux-based process management
- MongoDB Atlas cloud database with session storage in MongoDB
- Real-time Socket.io implementation without clustering support
- No reverse proxy, load balancer, or container orchestration
- Cron-based background jobs using node-cron
- Manual service management with shell scripts

---

## 1. CURRENT SERVICES & DEPLOYMENT

### 1.1 Main Application: Stringborn Universe (PS)

**Location:** `/srv/ps/`
**Entry Point:** `/srv/ps/bin/www` (Node HTTP server)
**Size:** 218 MB (including node_modules)

**Configuration:**
```
Port:          3399 (set in /srv/ps/.env)
Process Mgmt:  tmux sessions (manual)
Startup:       npm start (production) or npm run dev (development)
Environment:   Dotenv-based configuration
```

**Package.json Scripts:**
```json
{
  "start": "node ./bin/www",
  "dev": "nodemon ./bin/www"
}
```

**Startup Script Reference:**
- `/srv/start-all-services.sh` - Starts all services in tmux sessions
- `/srv/auto-start-npm.sh` - Alternative with JSON-based configuration
- `/srv/auto-start-npm.json` - Service configuration mapping

### 1.2 Game State Microservice

**Location:** `/srv/game-state-service/`
**Entry Point:** `/srv/game-state-service/index.js`
**Size:** 6.5 MB (including node_modules)
**Port:** 3500 (default, configurable via `process.env.PORT`)

**Purpose:** Real-time game state simulation with SSE streaming and REST API endpoints
```
GET  /health                  - Health check
GET  /api/state               - Complete game state snapshot
GET  /api/state/galactic      - Galactic state only
GET  /api/stream/state        - SSE real-time state updates
```

**Configuration:**
- Lightweight with minimal dependencies: Express, CORS, dotenv
- Pure simulation service (no database dependencies)
- Designed as independent microservice

### 1.3 Other Services (Secondary)

Running in parallel tmux sessions:
- **madladslab** (port 3000) - npm start
- **acm** (port 3001) - npm start
- **nocometalworkz** (port 3002) - npm start
- **sfg** (port 3003) - npm run dev
- **sna** (port 3004) - npm start
- **twww** (port 3005) - npm start
- **w2MongoClient/w2portal** (port 3006) - npm run dev
- **madThree** (port 3007) - npm run dev

**Note:** This analysis focuses on PS and game-state-service. Other services follow similar patterns.

---

## 2. DATABASE ARCHITECTURE

### 2.1 MongoDB Configuration

**Provider:** MongoDB Atlas (Cloud-hosted)
**Connection String:** `mongodb+srv://snoryder8019:***@cluster0.tpmae.mongodb.net`
**Database Name:** `projectStringborne`

**Connection Details:**
- Location: `/srv/ps/plugins/mongo/mongo.js`
- Library: native MongoDB driver (v6.9.0)
- Also uses: Mongoose ODM (v8.7.1) for some models
- Session Store: `connect-mongo` (v5.1.0) with collection name `sessions`

### 2.2 Collections

**Defined Collections** (from `/srv/ps/config/database.js`):
```javascript
{
  users: 'users',
  characters: 'characters',
  zones: 'zones',
  species: 'species',
  talentTrees: 'talentTrees',
  galacticState: 'galacticState',
  planetaryState: 'planetaryState',
  sessions: 'sessions',           // Express session storage
  assets: 'assets',
  userActions: 'userActions',
  activityTokens: 'activityTokens' // Activity token system
}
```

### 2.3 Connection Management

**Single Connection Pattern:**
```javascript
// /srv/ps/plugins/mongo/mongo.js
let _db;      // Singleton database instance
let _client;  // Singleton MongoClient instance

export const connectDB = async () => {
  if (!_db) {
    _client = new MongoClient(process.env.DB_URL);
    await _client.connect();
    _db = _client.db(process.env.DB_NAME);
  }
  return _db;
};
```

**Issues for Scaling:**
- Single connection per process (no connection pooling configuration)
- No replica set awareness
- Default timeouts (may not be optimized for high latency)
- Session storage in same database (no separate session backend)

### 2.4 Session Management

**Location:** `/srv/ps/app.js` (lines 33-50)
```javascript
app.use(session({
  secret: process.env.SESHSEC,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.DB_URL,
    collectionName: 'sessions'
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7  // 7 days
  }
}));
```

**Current Issues:**
- Session store in MongoDB (adds database load)
- No cache layer (Redis)
- MongoStore will create contention at scale

---

## 3. WEB SERVER & NETWORK SETUP

### 3.1 Express.js Configuration

**Framework:** Express.js v4.21.1
**Port:** 3399 (hardcoded in /srv/ps/.env)
**Trust Proxy:** Enabled (`app.set('trust proxy', 1)`)
**View Engine:** EJS

**Middleware Stack** (from `/srv/ps/app.js`):
1. Cookie Parser
2. Express Session (with MongoDB store)
3. Passport Authentication
4. Morgan HTTP logging
5. JSON/URL-encoded body parsers
6. Static file serving (`/public` and `/uploads`)
7. Router middleware

### 3.2 Socket.io Configuration

**Location:** `/srv/ps/plugins/socket/index.js`
**Transport:** WebSocket + polling fallback
**CORS:** Enabled with wildcard origin (`*`)

**Current Socket.io Setup:**
```javascript
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});
```

**Events Handled:**
- Character join/leave universe
- Docking/undocking at assets
- Navigation/movement updates
- Chat messages
- Real-time position updates
- Player ping/latency measurement
- Grid handoff for planetary zones

**Scaling Issues:**
- **No clustering support:** Socket.io doesn't share state across processes
- **In-memory registry:** `onlinePlayers` Map stored in process memory
- **No sticky sessions:** Requires Redis adapter for multi-process

### 3.3 No Reverse Proxy / Load Balancer

**Current Status:** NONE
- No nginx, Apache, or HAProxy
- Direct port exposure: port 3399
- No SSL termination
- No request distribution
- Single point of failure

---

## 4. CURRENT DEPLOYMENT STRUCTURE

### 4.1 Deployment Method: Tmux Sessions

**Scripts:**
1. `/srv/start-all-services.sh` - Creates tmux sessions for each service
2. `/srv/auto-start-npm.sh` - Alternative using JSON config
3. `/srv/auto-start-npm.json` - Service configuration

**Example from `/srv/start-all-services.sh`:**
```bash
SERVICES=(
  "madladslab:3000:/srv/madladslab:npm start"
  "ps:3399:/srv/ps:npm start"
  "game-state:3500:/srv/game-state-service:node index.js"
  "acm:3001:/srv/acm:npm start"
  # ... more services
)

for service_config in "${SERVICES[@]}"; do
  IFS=':' read -r name port dir cmd <<< "$service_config"
  tmux new-session -d -s "$name" -c "$dir" "PORT=$port $cmd"
done
```

**Problems:**
- ❌ No process monitoring or auto-restart
- ❌ Manual startup/shutdown
- ❌ No graceful reload
- ❌ Logs scattered across tmux sessions
- ❌ No CPU/memory limits
- ❌ No health checks
- ❌ Cannot scale dynamically

### 4.2 Process Management Status

**Currently Running:**
```
root    614652  0.6  1.7 21976792 138592  node ./bin/www  (madladslab, port 3000)
root    614691  1.3  1.6 21969300 133804  node ./bin/www  (ps, port 3399)
root    614708  0.0  0.9 11105612 75268   node index.js   (game-state, port 3500)
root    614768  0.0  0.8  618704   72132   node ./bin/www  (another service)
# ... 9+ more Node processes
```

**Memory Usage:** 1-2 GB per process (high baseline)
**CPU Usage:** Minimal (idle state), increases with concurrent connections

---

## 5. NO CONTAINERIZATION

### 5.1 Docker Status

**Result:** No Docker files found
```bash
find /srv -name "Dockerfile" 2>/dev/null  # Returns only node_modules/bcrypt/Dockerfile
find /srv -name "docker-compose.yml"      # Returns only node_modules examples
```

**Implications:**
- ❌ No container isolation
- ❌ No consistent environments across deployments
- ❌ Dependency on host Node.js version
- ❌ Cannot use container orchestration (Kubernetes)
- ❌ Manual environment setup
- ❌ Difficult to scale horizontally

---

## 6. BACKGROUND JOBS & CRON SYSTEM

### 6.1 Cron Job Implementation

**Location:** `/srv/ps/plugins/cron/index.js`
**Library:** `node-cron` (v4.2.1)

**Currently Scheduled Jobs:**

| Job | Schedule | Purpose | Frequency |
|-----|----------|---------|-----------|
| Documentation Tree Update | `0 3 * * *` | Generate docs index | Daily 3:00 AM EST |
| Patch Notes Update | `30 3 * * *` | Update patch notes | Daily 3:30 AM EST |
| Activity Token Cleanup | `*/15 * * * *` | Clean expired tokens | Every 15 minutes |

**Code:**
```javascript
export function initializeCronJobs() {
  const docsUpdateJob = cron.schedule('0 3 * * *', async () => {
    await generateDocsTree();
  }, { scheduled: true, timezone: "America/New_York" });
  
  // More jobs...
}
```

**Issues for Scaling:**
- ❌ In-process only: runs in main application process
- ❌ No distributed locking: multiple instances would run concurrently
- ❌ Timezone-aware but single-server aware
- ❌ No failure notifications
- ❌ No job persistence across restarts

### 6.2 Background Job Types

**Activity Token Cleanup:**
```javascript
// Runs every 15 minutes
cleanupExpiredTokens()  // From /srv/ps/utilities/activityTokens.js
createActivityTokenIndexes()
```

**Documentation Generation:**
```javascript
generateDocsTree()      // Scans /srv/ps/zMDREADME/
updatePatchNotes()      // Updates changelog
```

---

## 7. API STRUCTURE & SERVICE SEPARATION

### 7.1 Main API Routes

**Base Path:** `/api/v1/` (mounted in `/srv/ps/api/v1/index.js`)

**Endpoints:**
```
/api/v1/characters    - Character CRUD, stats, progression
/api/v1/zones        - Zone data and management
/api/v1/universe     - Universe state and hierarchy
/api/v1/assets       - Asset management and voting
/api/v1/tickets      - Support system
/api/v1/planet-generation - Procedural planet data
/api/v1/sprite-atlases    - Game asset atlases
/api/v1/state        - Game state manager
/api/v1/activity     - Activity token management
/api/v1/inventory    - Item and inventory management
/api/v1/inventory/:characterId/ship - Ship data
```

### 7.2 Activity Token System

**Location:** `/srv/ps/utilities/activityTokens.js` and `/srv/ps/api/v1/activity/index.js`

**Endpoints:**
```
POST /api/v1/activity/token/create         - Create new token
POST /api/v1/activity/token/validate       - Validate token
POST /api/v1/activity/token/renew          - Renew token
POST /api/v1/activity/token/invalidate     - Revoke token
GET  /api/v1/activity/character/:id/active - Get active token
```

**Token Details:**
- Default duration: 20 minutes
- Stored in: `activityTokens` MongoDB collection
- Includes: userId, characterId, expiresAt, createdAt
- Cleanup: Every 15 minutes via cron

### 7.3 Regular Routes (Server-Rendered)

**Main Routes** (from `/srv/ps/routes/index.js`):
```
GET  /                         - Home/menu
GET  /zones                    - Zone browser
GET  /universe                 - Universe map viewer
GET  /assets                   - Asset management
GET  /characters               - Character list/creation
GET  /admin                    - Admin dashboard
GET  /help/documentation       - Documentation viewer
GET  /help/patch-notes         - Patch notes
GET  /profile                  - User profile
```

### 7.4 Service Separation Analysis

**Current State:**
- Main application: Monolithic (routes + API + websockets)
- Game state: Separate microservice (read-only simulation)
- Physics: Bundled in main app (`/api/v1/physics/physics3d.js`)
- Authentication: Integrated (Passport.js)

**Not Separated:**
- ❌ Database operations (mixed in models and routes)
- ❌ Business logic (scattered across routes and middlewares)
- ❌ Real-time updates (Socket.io in main process)
- ❌ Asset management (direct uploads, no CDN)
- ❌ Search/indexing (direct MongoDB queries)

---

## 8. ENVIRONMENT CONFIGURATION

### 8.1 Environment Variables

**File:** `/srv/ps/.env`

```ini
# API Keys
GGLAPI=your_google_api_key_here
GGLSEC=your_google_oauth_secret_here
GGLCID=your_google_client_id_here.apps.googleusercontent.com

# Sessions & Security
SESHSEC=your_session_secret_here

# Database
DB_URL=your_mongodb_connection_string_here
DB_NAME=projectStringborne

# Server
PORT=3399

# Storage Credentials
MON_USER=snoryder8019
MON_PASS=51DUBsqu%40red51
GMAIL_USER=w2marketing.scott@gmail.com
GMAIL_PASS=jbkb kvqr yger pkzf
S3_LOCATION=us-ord-1
LINODE_BUCKET=madladslab
LINODE_ACCESS=7EN659Z5SGKYIOQ2NDGA
LINODE_SECRET=cPYde9sKSzZ4SBD03CmaYvGWPN3AbVSxbLsfy7Sc
```

**Security Issues:**
- ⚠️ Credentials in .env file (version controlled?)
- ⚠️ No environment separation (dev/staging/production)
- ⚠️ Single environment configuration
- ⚠️ Gmail app password exposed

### 8.2 Configuration Files

**Config Directory:** `/srv/ps/config/`
- `constants.js` - Game constants
- `database.js` - DB configuration
- `starting-locations.js` - Game starting points
- `spaceHubs.js` - Hub locations

---

## 9. DEPENDENCIES & TECH STACK

### 9.1 Key Dependencies

**Framework & Server:**
- `express` (4.21.1) - Web framework
- `socket.io` (4.8.1) - Real-time communication
- `passport` (0.7.0) - Authentication
  - `passport-google-oauth20`
  - `passport-facebook`
  - `passport-local`

**Database:**
- `mongodb` (6.9.0) - Native driver
- `mongoose` (8.7.1) - ODM
- `connect-mongo` (5.1.0) - Session store

**Frontend & Rendering:**
- `ejs` (3.1.10) - Template engine
- `three` (0.160.0) - 3D rendering

**Utilities:**
- `node-cron` (4.2.1) - Scheduled jobs
- `axios` (1.7.9) - HTTP client
- `bcrypt` (5.1.1) - Password hashing
- `nodemailer` (7.0.9) - Email
- `multer` (2.0.2) - File uploads
- `cors` (2.8.5) - CORS handling
- `qrcode` (1.5.4) - QR generation
- `morgan` (1.10.1) - HTTP logging

**AWS Integration:**
- `@aws-sdk/client-s3` (3.917.0)
- `@aws-sdk/s3-request-presigner` (3.917.0)
- `aws-sdk` (2.1692.0)

**Total Dependencies:** 41 (per package.json)
**Lock file size:** 4913 lines

### 9.2 Development Dependencies

- `nodemon` (3.1.7) - Auto-reload
- `debug` (2.6.9) - Debugging

---

## 10. SCALING CHALLENGES & CURRENT BOTTLENECKS

### 10.1 Critical Scaling Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| No load balancing | CRITICAL | Single point of failure |
| No clustering | CRITICAL | Cannot use multiple CPU cores |
| Session storage in MongoDB | HIGH | Database contention |
| Socket.io without Redis adapter | HIGH | Real-time features won't scale |
| No container orchestration | HIGH | Manual infrastructure management |
| In-process cron jobs | MEDIUM | Duplicate jobs in multi-instance setup |
| No API rate limiting | MEDIUM | Vulnerable to abuse |
| No caching layer | MEDIUM | Database overload under load |
| Static file serving from app | LOW | Should use CDN |

### 10.2 Database Bottlenecks

**Single Connection Model:**
- No connection pooling configuration
- Default pool size: likely 5-10 connections
- Under load: connection exhaustion
- Session queries add additional load

**MongoDB Atlas Limitations:**
- Network latency (cloud connection)
- Shared cluster performance (if basic tier)
- No local caching

**Collections Without Indexes:**
- No query optimization
- Activity token cleanup scans entire collection
- Character/asset lookups not optimized

### 10.3 Real-Time Bottlenecks

**Socket.io Issues:**
- In-memory player registry per process
- Cannot broadcast across processes
- No persistence of online state
- Will lose connections on process restart

**Examples (from `/srv/ps/plugins/socket/index.js`):**
```javascript
const onlinePlayers = new Map();  // In-process, not shared
socket.broadcast.emit('...')       // Only broadcasts to this process
io.emit('onlineCount', ...)        // Only reaches connected clients of this instance
```

---

## 11. EXISTING SCALING CONFIGURATIONS

### 11.1 What Already Exists

**Positive:**
- ✅ Separate game-state microservice (read-only)
- ✅ Cloud MongoDB (Atlas)
- ✅ Environment variable configuration
- ✅ CORS enabled for API
- ✅ Trust proxy configured
- ✅ Modular API structure

**Negative (Major Gaps):**
- ❌ No clustering mechanism (Node.js `cluster` module not used)
- ❌ No load balancing configuration
- ❌ No caching strategy
- ❌ No API rate limiting
- ❌ No health checks
- ❌ No graceful shutdown
- ❌ No monitoring/observability
- ❌ No database query optimization
- ❌ No static asset CDN

### 11.2 Infrastructure Status

**Current Setup (from ps.log):**
```
Running on: Single server
Node processes: 10+ (tmux sessions)
Total memory: ~20+ GB (rough estimate from processes)
Uptime management: Manual restart
Log aggregation: None (scattered across tmux)
Monitoring: None (no metrics collection)
Backups: Unknown (MongoDB Atlas assumed)
```

---

## SUMMARY TABLE: ARCHITECTURE COMPONENTS

| Component | Type | Status | Scalability |
|-----------|------|--------|-------------|
| **Application Framework** | Express.js | Monolithic | POOR |
| **Process Management** | Tmux | Manual | POOR |
| **Load Balancing** | None | Missing | CRITICAL |
| **Clustering** | None | Missing | CRITICAL |
| **Database** | MongoDB Atlas | Connected | FAIR |
| **Session Store** | MongoDB | Integrated | POOR |
| **Caching** | None | Missing | POOR |
| **Real-time** | Socket.io | In-process | POOR |
| **Containerization** | Docker | None | CRITICAL |
| **API Gateway** | None | Missing | POOR |
| **Monitoring** | None | Missing | POOR |
| **Cron Jobs** | node-cron | In-process | POOR |
| **Static Files** | Express.static | Local | POOR |
| **Authentication** | Passport.js | Integrated | FAIR |

---

## RECOMMENDATIONS FOR AUTO-SCALING (Priority Order)

1. **Containerize with Docker** - Package application consistently
2. **Add Load Balancer (nginx/HAProxy)** - Distribute traffic
3. **Implement Node.js Clustering** - Use multiple CPU cores
4. **Add Redis** - Session store + Socket.io adapter
5. **Database optimization** - Add indexes, connection pooling
6. **API Gateway (Kong/Express Gateway)** - Rate limiting, auth
7. **Logging aggregation** - ELK Stack or Datadog
8. **Health checks** - Readiness/liveness probes
9. **Graceful shutdown** - SIGTERM handling
10. **Kubernetes deployment** - Auto-scaling infrastructure

**Estimated implementation time:** 2-4 weeks (with team of 2-3 developers)

