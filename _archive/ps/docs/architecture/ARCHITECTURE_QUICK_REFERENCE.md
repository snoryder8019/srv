# Stringborn Universe - Architecture Quick Reference

**Last Updated:** 2025-10-29

---

## KEY FACTS AT A GLANCE

### Application Structure
- **Main App (PS):** Express.js monolith, 218MB, port 3399
- **Game State Service:** Lightweight microservice, 6.5MB, port 3500
- **9+ Secondary Services:** Running in parallel tmux sessions (ports 3000-3007)
- **Deployment:** Manual tmux-based (no PM2, no Docker, no orchestration)

### Database
- **Primary:** MongoDB Atlas (Cloud)
- **Database:** projectStringborne
- **Session Store:** MongoDB (connect-mongo)
- **Collections:** users, characters, zones, assets, sessions, activityTokens, etc.
- **Connection:** Singleton pattern (single connection per process)

### Real-Time
- **WebSocket:** Socket.io v4.8.1
- **Features:** Live player registry, chat, position updates
- **Limitation:** In-memory state, NOT shared across processes

### Process Management
- **Tool:** tmux (manual)
- **Startup:** `/srv/start-all-services.sh` or `/srv/auto-start-npm.sh`
- **No auto-restart:** Manual process management required
- **No clustering:** Each service runs single instance

### Background Jobs
- **Library:** node-cron (v4.2.1)
- **Frequency:** Every 15 minutes + daily at 3:00 AM
- **Jobs:** Documentation generation, patch notes, token cleanup
- **Issue:** Runs in-process, no distributed locking

### API Routes
```
/api/v1/characters      - Character management
/api/v1/zones          - Zone data
/api/v1/universe       - Universe state
/api/v1/assets         - Asset management
/api/v1/activity       - Activity tokens
/api/v1/inventory      - Items & equipment
/api/v1/state          - Game state
/api/v1/planet-generation - Procedural data
```

### Environment
- **Port:** 3399 (hardcoded in .env)
- **Node Env:** process.env.NODE_ENV (not set)
- **Trust Proxy:** Enabled
- **Credentials:** In .env file (security risk)

---

## CRITICAL GAPS FOR SCALING

| Gap | Impact | Priority |
|-----|--------|----------|
| No load balancer | Single point of failure | CRITICAL |
| No clustering | Can't use multiple CPU cores | CRITICAL |
| No Docker | Can't use Kubernetes or auto-scaling | CRITICAL |
| Session in MongoDB | Database contention | HIGH |
| Socket.io no Redis | Can't scale real-time features | HIGH |
| In-process cron | Duplicate jobs in multi-instance | MEDIUM |
| No caching | Database overload | MEDIUM |
| No rate limiting | Vulnerable to abuse | MEDIUM |

---

## QUICK MIGRATION PATH (Priority Order)

```
1. Containerize (Docker)
   ├── Create Dockerfile
   ├── Create docker-compose.yml
   └── Test locally

2. Add Load Balancer (nginx)
   ├── Reverse proxy config
   ├── SSL termination
   └── Static file serving

3. Enable Clustering
   ├── Node.js cluster module OR
   ├── PM2 cluster mode
   └── Sticky sessions

4. Add Redis
   ├── Session store migration
   ├── Socket.io adapter
   └── Cache layer

5. Database Optimization
   ├── Add connection pooling
   ├── Create indexes
   └── Migrate session store

6. Distributed Cron
   ├── Bull queue OR
   ├── Agenda job scheduling
   └── Distributed locking

7. Monitoring & Logging
   ├── Health checks
   ├── Log aggregation
   └── Metrics collection

8. Kubernetes/Orchestration
   ├── Helm charts
   ├── Auto-scaling config
   └── Service mesh
```

---

## FILE LOCATIONS (Critical)

**Application Files:**
- Entry point: `/srv/ps/bin/www`
- App config: `/srv/ps/app.js`
- API routes: `/srv/ps/api/v1/`
- Database: `/srv/ps/plugins/mongo/mongo.js`
- WebSocket: `/srv/ps/plugins/socket/index.js`
- Cron: `/srv/ps/plugins/cron/index.js`
- Session middleware: `/srv/ps/middlewares/characterSession.js`

**Configuration Files:**
- Environment: `/srv/ps/.env`
- Database config: `/srv/ps/config/database.js`
- DB config location: `/srv/ps/config/database.js`

**Startup Scripts:**
- Main: `/srv/start-all-services.sh`
- Alternative: `/srv/auto-start-npm.sh`
- Config: `/srv/auto-start-npm.json`

**Logs:**
- Application: `/srv/ps/ps.log` (32KB)
- Process: tmux sessions (no central logging)

---

## DEPENDENCY SUMMARY

**Core:** Express (4.21.1), Socket.io (4.8.1), Mongoose (8.7.1)
**DB:** MongoDB (6.9.0), connect-mongo (5.1.0)
**Auth:** Passport (0.7.0), bcrypt (5.1.1)
**Frontend:** EJS, Three.js (3D)
**Jobs:** node-cron (4.2.1)
**Utilities:** axios, multer, nodemailer, qrcode, morgan
**Storage:** AWS SDK (S3)

**Total:** 41 dependencies, 4913 lock file lines

---

## CURRENT RUNNING PROCESSES

```
- madladslab:3000     (npm start)
- ps:3399             (npm start) [MAIN]
- game-state:3500     (node index.js)
- acm:3001            (npm start)
- nocometalworkz:3002 (npm start)
- sfg:3003            (npm run dev)
- sna:3004            (npm start)
- twww:3005           (npm start)
- w2portal:3006       (npm run dev)
- madThree:3007       (npm run dev)
```

**Memory:** ~1-2GB per process
**CPU:** Minimal (idle), increases with connections
**Total Running:** 10+ Node processes on single server

---

## SOCKET.IO EVENTS (Real-time)

**Emitted:**
- `characterJoin` / `characterJoined`
- `characterDock` / `characterDocked`
- `characterUndock` / `characterUndocked`
- `characterNavigate` / `characterNavigating`
- `playerMove` / `playerMoved`
- `chatMessage`
- `onlineCount`
- `onlinePlayers`
- `characterLocationUpdate`
- `gridHandoff`

**Issue:** All tracked in `onlinePlayers` Map (in-process memory)

---

## CRON JOBS

| Job | Schedule | Runs | Issue |
|-----|----------|------|-------|
| Doc Tree Update | `0 3 * * *` | Daily 3:00 AM EST | No distributed lock |
| Patch Notes Update | `30 3 * * *` | Daily 3:30 AM EST | No distributed lock |
| Token Cleanup | `*/15 * * * *` | Every 15 minutes | No distributed lock |

**All run in-process** - Will duplicate in multi-instance setup

---

## SCALING CHECKLIST

- [ ] Create Dockerfile (multi-stage recommended)
- [ ] Create docker-compose.yml
- [ ] Add nginx reverse proxy config
- [ ] Enable Node.js clustering
- [ ] Add Redis for sessions
- [ ] Add Socket.io Redis adapter
- [ ] Create database indexes
- [ ] Implement distributed cron (Bull/Agenda)
- [ ] Add health check endpoints
- [ ] Implement graceful shutdown
- [ ] Set up log aggregation
- [ ] Add APM/monitoring
- [ ] Test with multiple instances
- [ ] Create Kubernetes manifests
- [ ] Set up auto-scaling rules

---

## NEXT STEPS

See `/srv/ps/ARCHITECTURE_ANALYSIS.md` for detailed analysis (642 lines) covering:
- Detailed architecture breakdown
- Bottleneck analysis
- Each scaling challenge explained
- Code examples and file references
- Estimated implementation time per recommendation
