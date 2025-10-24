# MadLabs Lab Services Directory

This directory contains all MadLabs Lab web services and applications.

## Quick Reference

See **[.claude-context.json](./.claude-context.json)** for comprehensive module documentation and cross-references.

## Active Services

| Service | Port | Domain | Description |
|---------|------|--------|-------------|
| **madladslab** | 3000 | madladslab.com | Main platform with auth, monitoring daemon |
| **servers** | 3600 | servers.madladslab.com | Admin dashboard for monitoring/managing services |
| **ps** | 3399 | ps.madladslab.com | Project Stringborne MMO with Three.js |
| **game-state** | 3500 | svc.madladslab.com | Game state service for PS |
| **acm** | 3002 | acmcreativeconcepts.com | Creative agency website |
| **sfg** | 3003 | sfg.madladslab.com | SFG project |
| **sna** | 3010 | somenewsarticle.com | News aggregation platform |
| **twww** | 3008 | theworldwidewallet.com | Payment services directory |
| **madThree** | 3001 | three.madladslab.com | Three.js experiments |
| **w2MongoClient** | 3006 | localhost | MongoDB client |

## Shared Infrastructure

### Database
- **MongoDB Atlas**: `madLadsLab` database
- **Shared by**: madladslab, servers, ps

### Authentication
- **Google OAuth**: Shared across madladslab, servers, ps
- **Passport.js**: Configured in `/srv/madladslab/plugins/passport/`

### Monitoring
Three monitoring systems:
1. **Service Monitor Daemon** (madladslab): Email alerts, DB logging
2. **Servers Dashboard** (servers.madladslab.com): Real-time control panel
3. **PS Status Bar** (ps): Embedded admin monitoring

## Service Management

### Check All Services
```bash
tmux ls
```

### Start a Service
```bash
cd /srv/<service-name>
tmux new-session -d -s <service>_session "npm run dev"
```

### Stop a Service
```bash
tmux kill-session -t <service>_session
```

### View Service Logs
```bash
tmux capture-pane -t <service>_session -p | tail -50
```

### Restart All Services
```bash
/srv/start-all-services.sh
```

## Admin Access

### Monitoring Dashboard
https://servers.madladslab.com
- Google OAuth authentication
- Only accessible to users with `isAdmin: true`
- Start/stop/restart any service
- View real-time logs
- System metrics

### Service Monitoring
madladslab.com/admin/monitor
- View service status history
- Downtime statistics
- Email alert configuration

### PS Status Bar
Bottom of any ps.madladslab.com page (admins only)
- CPU/Memory at a glance
- Service health indicators
- Debug mode toggle

## Documentation

Each service has its own documentation:
- `/srv/madladslab/SERVICE_MONITORING.md`
- `/srv/madladslab/QRS_DESIGN.md`
- `/srv/madladslab/CLAUDETALK_UPDATES.md`
- `/srv/servers/README.md`
- `/srv/servers/DEPLOYMENT_SUMMARY.md`
- `/srv/ps/README.md`
- `/srv/ps/STATUS_BAR_README.md`
- `/srv/sna/zMDREADME.md` - News aggregation platform docs
- `/srv/sna/NEWS_API_SETUP.md`
- `/srv/sna/COMMENT_SYSTEM_README.md`
- `/srv/twww/zMDREADME.md` - Payment services directory docs

## Development

### Context Configuration
When working across multiple modules, reference:
**`.claude-context.json`** - Comprehensive context about all services

This file includes:
- Service descriptions and features
- Technology stacks
- Database schemas
- Authentication flows
- Cross-module integrations
- Recent changes
- Key file locations

### Adding a New Service

1. Create service directory: `/srv/new-service/`
2. Configure port and tmux session name
3. Update `.claude-context.json`
4. Add to monitoring systems:
   - `/srv/madladslab/lib/systemMonitor.js`
   - `/srv/servers/server.js` (SERVICES array)
5. Add Apache virtual host if needed
6. Update this README

## Recent Additions (2025-10-22)

### Servers Dashboard
- **URL**: https://servers.madladslab.com
- **Auth**: Google OAuth (admin only)
- **Features**: Real-time monitoring, service control, logs
- **Files**: `/srv/servers/`

### PS Status Bar
- **Location**: Bottom of ps.madladslab.com pages (admins only)
- **Features**: CPU/Memory/Services monitoring, debug mode
- **Files**: `/srv/ps/views/partials/status-bar.ejs`

### Footer Integration
- Added "🖥️ servers" link to madladslab.com footer for admins
- **File**: `/srv/madladslab/views/mainContent/footer.ejs:18`

## Infrastructure

- **Server**: Linode (Linux 6.14.3)
- **Web Server**: Apache 2.4.58 with SSL
- **SSL**: Let's Encrypt (auto-renewing)
- **Process Manager**: tmux
- **Monitoring**: Multiple systems (daemon, dashboard, status bar)

## Contact

For issues or questions:
- **Email**: scott@madladslab.com
- **Dashboard**: https://servers.madladslab.com
- **Monitoring**: madladslab.com/admin/monitor

## License

Internal use only - MadLabs Lab 2025
