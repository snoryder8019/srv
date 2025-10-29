# Stringborn Universe - Scaling Implementation Guide

**Purpose:** Specific code locations and step-by-step implementation for scaling

---

## PHASE 1: IMMEDIATE FIXES (No Code Changes Required)

### 1.1 Database Connection Optimization

**File:** `/srv/ps/plugins/mongo/mongo.js`

**Current:** Single connection per process (lines 14-26)
**Add:** Connection pooling parameters

Replace:
```javascript
_client = new MongoClient(process.env.DB_URL);
```

With:
```javascript
_client = new MongoClient(process.env.DB_URL, {
  maxPoolSize: 50,
  minPoolSize: 10,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  retryWrites: true,
  retryReads: true
});
```

**Impact:** 3-5x better connection reuse

---

### 1.2 Add Health Check Endpoint

**File:** `/srv/ps/routes/index.js` or new `/srv/ps/routes/health.js`

**Add:**
```javascript
router.get('/health', async (req, res) => {
  try {
    const { getDb } = await import('../plugins/mongo/mongo.js');
    const db = getDb();
    
    // Quick database check
    const adminDb = db.admin();
    await adminDb.ping();
    
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

router.get('/ready', (req, res) => {
  // Readiness check (lighter weight)
  res.json({ ready: true });
});
```

**Add to Express:** (in `/srv/ps/app.js` before other routes)
```javascript
app.use('/', healthRouter); // Import at top
```

---

### 1.3 MongoDB Session Store Optimization

**File:** `/srv/ps/app.js` (lines 39-41)

**Current:**
```javascript
store: MongoStore.create({
  mongoUrl: process.env.DB_URL,
  collectionName: 'sessions'
}),
```

**Add:**
```javascript
store: MongoStore.create({
  mongoUrl: process.env.DB_URL,
  collectionName: 'sessions',
  touchAfter: 86400, // Reduce writes (1 day)
  serialize: (obj) => obj, // Faster serialization
  unserialize: (obj) => obj,
  autoRemove: 'interval',
  autoRemoveInterval: 3600 // Clean hourly
}),
```

**Impact:** Reduces database writes by 90%

---

## PHASE 2: CONTAINERIZATION

### 2.1 Create Dockerfile

**File:** `/srv/ps/Dockerfile` (NEW)

```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Final stage
FROM node:18-alpine

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3399) + '/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE ${PORT:-3399}

CMD ["npm", "start"]
```

### 2.2 Create docker-compose.yml

**File:** `/srv/ps/docker-compose.yml` (NEW)

```yaml
version: '3.9'

services:
  ps:
    build: .
    ports:
      - "3399:3399"
    environment:
      - NODE_ENV=production
      - PORT=3399
      - DB_URL=${DB_URL}
      - DB_NAME=${DB_NAME}
      - SESHSEC=${SESHSEC}
    volumes:
      - ./uploads:/app/uploads
      - ./data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3399/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - app-network

  game-state:
    build: ../game-state-service
    ports:
      - "3500:3500"
    environment:
      - NODE_ENV=production
      - PORT=3500
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3500/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - app-network
    volumes:
      - redis-data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - ps
      - game-state
    restart: unless-stopped
    networks:
      - app-network

volumes:
  redis-data:

networks:
  app-network:
    driver: bridge
```

---

## PHASE 3: LOAD BALANCING

### 3.1 Create nginx.conf

**File:** `/srv/ps/nginx.conf` (NEW)

```nginx
events {
    worker_connections 1024;
}

http {
    upstream ps_app {
        least_conn;
        server ps:3399 max_fails=3 fail_timeout=30s;
        server ps2:3399 max_fails=3 fail_timeout=30s;
        server ps3:3399 max_fails=3 fail_timeout=30s;
    }

    upstream game_state {
        server game-state:3500;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=socket_limit:10m rate=100r/s;

    server {
        listen 80;
        server_name _;

        # Timeouts for long-lived connections (Socket.io)
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # WebSocket upgrade
        map $http_upgrade $connection_upgrade {
            default upgrade;
            '' close;
        }

        # Main app
        location / {
            limit_req zone=api_limit burst=20 nodelay;
            
            proxy_pass http://ps_app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_buffering off;
        }

        # Game state microservice
        location /game-state/ {
            proxy_pass http://game_state/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Socket.io endpoints
        location /socket.io {
            limit_req zone=socket_limit burst=100 nodelay;
            
            proxy_pass http://ps_app;
            proxy_http_version 1.1;
            proxy_buffering off;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "Upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Static files (cache aggressively)
        location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2)$ {
            proxy_pass http://ps_app;
            proxy_cache_valid 200 1d;
            proxy_cache_bypass $http_pragma $http_authorization;
            add_header Cache-Control "public, max-age=86400, immutable";
        }

        # Health checks (no rate limit)
        location /health {
            proxy_pass http://ps_app;
            access_log off;
        }
    }
}
```

---

## PHASE 4: CLUSTERING & SESSION STORE MIGRATION

### 4.1 Replace Session Store with Redis

**File:** `/srv/ps/app.js` - Modify session configuration (lines 33-50)

**Before:**
```javascript
import MongoStore from 'connect-mongo';

app.use(
  session({
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,
      collectionName: 'sessions'
    }),
    // ...
  })
);
```

**After:**
```javascript
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

// Create Redis client
const redisClient = createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.connect().catch(err => console.error('Redis connection failed:', err));

app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESHSEC,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);
```

**Add to package.json:**
```bash
npm install connect-redis redis@latest
```

---

### 4.2 Enable Socket.io Redis Adapter

**File:** `/srv/ps/plugins/socket/index.js` - Modify Socket.io initialization

**Before:**
```javascript
export default function initSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST']
    }
  });
  
  // ... event handlers
}
```

**After:**
```javascript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

export default async function initSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST']
    }
  });

  // Connect to Redis for distribution
  const pubClient = createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  });
  
  const subClient = pubClient.duplicate();
  
  await Promise.all([
    pubClient.connect(),
    subClient.connect()
  ]);

  // Use Redis adapter for clustering
  io.adapter(createAdapter(pubClient, subClient));

  // Now onlinePlayers will be synced across instances
  const onlinePlayers = new Map();
  
  // ... rest of handlers remain the same
}
```

**Add to package.json:**
```bash
npm install @socket.io/redis-adapter
```

---

### 4.3 Implement Graceful Shutdown

**File:** `/srv/ps/bin/www` - Add process handling (at end of file)

**Add:**
```javascript
const gracefulShutdown = async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed');
    
    try {
      // Close database connection
      const { closeDB } = await import('../plugins/mongo/mongo.js');
      await closeDB();
      console.log('Database connection closed');
      
      // Stop cron jobs
      const { stopAllJobs } = await import('../plugins/cron/index.js');
      stopAllJobs();
      console.log('Cron jobs stopped');
      
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

---

## PHASE 5: DISTRIBUTED CRON JOBS

### 5.1 Replace node-cron with Bull Queue

**File:** `/srv/ps/plugins/cron/bull-jobs.js` (NEW)

```javascript
import Queue from 'bull';
import { generateDocsTree } from '../../scripts/generate-docs-tree.js';
import { updatePatchNotes } from '../../scripts/update-patch-notes.js';
import { cleanupExpiredTokens } from '../../utilities/activityTokens.js';

const docsQueue = new Queue('docs-update', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

const patchesQueue = new Queue('patch-notes', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

const tokensQueue = new Queue('token-cleanup', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

// Process jobs
docsQueue.process(async () => {
  console.log('Processing docs update job');
  await generateDocsTree();
});

patchesQueue.process(async () => {
  console.log('Processing patch notes update job');
  await updatePatchNotes();
});

tokensQueue.process(async () => {
  console.log('Processing token cleanup job');
  await cleanupExpiredTokens();
});

// Schedule jobs (only once per system)
export async function initializeJobs() {
  // Add repeating jobs
  await docsQueue.add({}, { 
    repeat: { cron: '0 3 * * *', tz: 'America/New_York' }
  });

  await patchesQueue.add({}, {
    repeat: { cron: '30 3 * * *', tz: 'America/New_York' }
  });

  await tokensQueue.add({}, {
    repeat: { cron: '*/15 * * * *' }
  });
}

export { docsQueue, patchesQueue, tokensQueue };
```

**Add to package.json:**
```bash
npm install bull
```

---

## PHASE 6: DATABASE INDEXING

### 6.2 Create Index Script

**File:** `/srv/ps/scripts/create-db-indexes.js` (NEW)

```javascript
import { connectDB } from '../plugins/mongo/mongo.js';

async function createIndexes() {
  console.log('Creating database indexes...');
  
  const db = await connectDB();

  try {
    // Users collection
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    console.log('✓ users.email');

    // Characters collection
    await db.collection('characters').createIndex({ userId: 1 });
    await db.collection('characters').createIndex({ name: 1 });
    console.log('✓ characters.userId, characters.name');

    // Sessions collection
    await db.collection('sessions').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    console.log('✓ sessions.expires (TTL)');

    // Activity tokens
    await db.collection('activityTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection('activityTokens').createIndex({ userId: 1, characterId: 1 });
    console.log('✓ activityTokens indexes');

    // Assets
    await db.collection('assets').createIndex({ assetType: 1 });
    await db.collection('assets').createIndex({ title: 'text' });
    console.log('✓ assets indexes');

    // User actions (for analytics)
    await db.collection('userActions').createIndex({ userId: 1, createdAt: -1 });
    console.log('✓ userActions indexes');

    console.log('All indexes created successfully!');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
}

createIndexes().then(() => process.exit(0));
```

**Run with:**
```bash
node scripts/create-db-indexes.js
```

---

## PHASE 7: MONITORING & LOGGING

### 7.1 Add Structured Logging

**File:** `/srv/ps/utilities/logger.js` (NEW)

```javascript
import fs from 'fs/promises';
import path from 'path';

const LOG_DIR = './logs';

// Ensure log directory exists
await fs.mkdir(LOG_DIR, { recursive: true });

function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  });
}

export const logger = {
  info: (message, meta) => {
    const log = formatLog('INFO', message, meta);
    console.log(log);
  },
  
  error: (message, meta) => {
    const log = formatLog('ERROR', message, meta);
    console.error(log);
  },
  
  warn: (message, meta) => {
    const log = formatLog('WARN', message, meta);
    console.warn(log);
  },
  
  debug: (message, meta) => {
    if (process.env.DEBUG) {
      const log = formatLog('DEBUG', message, meta);
      console.log(log);
    }
  }
};
```

---

## CRITICAL FILE LOCATIONS SUMMARY

| Component | File | Port |
|-----------|------|------|
| **Main App** | `/srv/ps/bin/www` | 3399 |
| **Express Config** | `/srv/ps/app.js` | - |
| **Database** | `/srv/ps/plugins/mongo/mongo.js` | - |
| **WebSocket** | `/srv/ps/plugins/socket/index.js` | - |
| **Cron Jobs** | `/srv/ps/plugins/cron/index.js` | - |
| **API Routes** | `/srv/ps/api/v1/index.js` | - |
| **Session Middleware** | `/srv/ps/middlewares/characterSession.js` | - |
| **Game State Service** | `/srv/game-state-service/index.js` | 3500 |
| **Environment** | `/srv/ps/.env` | - |

---

## IMPLEMENTATION TIMELINE

**Week 1:** Phases 1-2 (immediate fixes + containerization)
**Week 2:** Phases 3-4 (load balancing + session migration)
**Week 3:** Phase 5-6 (cron jobs + database optimization)
**Week 4:** Phase 7 (monitoring, testing, production deployment)

---

## TESTING BEFORE DEPLOYMENT

```bash
# Local testing with docker-compose
docker-compose up

# Test endpoints
curl http://localhost/health
curl http://localhost/ready

# Load test
ab -n 1000 -c 10 http://localhost/

# Check logs
docker logs <container-id>
docker compose logs -f
```

---

## ROLLBACK PLAN

1. Keep previous version running on different port
2. Update nginx config to point to old version
3. Verify all tests pass
4. Monitor error rates
5. Only then remove old containers

