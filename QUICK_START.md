# MadLabs Lab - Quick Start Guide

## 🎯 Context Files

When working on MadLabs Lab services, **always reference these files first**:

### 1. **`.claude-context.json`** - Master Context
The single source of truth for all services, integrations, and documentation.

**Use when:**
- Starting work on any module
- Understanding service dependencies
- Finding file locations
- Checking recent changes
- Understanding cross-module features

### 2. **`README.md`** - Service Directory Overview
Quick reference table of all services and basic commands.

**Use when:**
- Need service port numbers
- Need domain names
- Want to see all services at once
- Need basic tmux commands

### 3. **`.claude-module-template.md`** - Update Guide
Template for updating context and adding new modules.

**Use when:**
- Adding a new service
- Adding features to existing service
- Documenting cross-module integrations
- Following documentation standards

## 📋 Typical Workflow

### Working on Existing Service

1. **Check Context**
   ```bash
   cat /srv/.claude-context.json | jq '.services.serviceName'
   ```

2. **Read Service Docs**
   ```bash
   cat /srv/serviceName/README.md
   ```

3. **Check Service Status**
   ```bash
   tmux capture-pane -t serviceName_session -p | tail -20
   ```

4. **Make Changes**
   - Edit files
   - Test locally

5. **Update Documentation**
   - Update service README if needed
   - Update `.claude-context.json` with new features
   - Add to `recentChanges`

6. **Restart Service**
   ```bash
   tmux kill-session -t serviceName_session
   tmux new-session -d -s serviceName_session -c /srv/serviceName "npm run dev"
   ```

### Adding New Service

1. **Create Service**
   ```bash
   mkdir /srv/new-service
   cd /srv/new-service
   npm init -y
   # ... setup service
   ```

2. **Update Context**
   - Follow `.claude-module-template.md`
   - Add full service entry to `.claude-context.json`

3. **Create Documentation**
   ```bash
   # Create README.md in service directory
   # Follow template in .claude-module-template.md
   ```

4. **Add to Monitoring**
   - Edit `/srv/madladslab/lib/systemMonitor.js`
   - Edit `/srv/servers/server.js`

5. **Configure Apache** (if public)
   ```bash
   sudo nano /etc/apache2/sites-available/domain.conf
   sudo a2ensite domain.conf
   sudo certbot --apache -d domain.com
   ```

6. **Update Service List**
   - Add row to table in `/srv/README.md`

7. **Test**
   ```bash
   tmux new-session -d -s new_service_session "npm start"
   curl http://localhost:PORT
   ```

## 🔍 Finding Information

### "Where is the authentication configured?"
```bash
cat /srv/.claude-context.json | jq '.sharedResources.authentication'
```

### "What services use MongoDB?"
```bash
cat /srv/.claude-context.json | jq '.sharedResources.database.sharedBy'
```

### "What monitoring systems exist?"
```bash
cat /srv/.claude-context.json | jq '.crossModuleFeatures.serviceMonitoring'
```

### "What changed recently?"
```bash
cat /srv/.claude-context.json | jq '.developmentNotes.recentChanges'
```

### "How do I access the servers dashboard?"
```bash
cat /srv/.claude-context.json | jq '.services.servers'
```

## 🚀 Common Tasks

### Check All Running Services
```bash
tmux ls
```

### Restart All Services
```bash
/srv/start-all-services.sh
```

### Check Service Health
Visit: https://servers.madladslab.com (admin only)

### View Service Logs
```bash
tmux capture-pane -t serviceName_session -p -S -100
```

### Kill All Services
```bash
for session in $(tmux ls | cut -d: -f1); do
  tmux kill-session -t $session
done
```

### Update SSL Certificate
```bash
sudo certbot renew
sudo systemctl reload apache2
```

## 📚 Documentation Locations

### Main Documentation
- `/srv/README.md` - Service directory overview
- `/srv/.claude-context.json` - Comprehensive context
- `/srv/.claude-module-template.md` - Update guide

### Service-Specific Docs
- `/srv/madladslab/SERVICE_MONITORING.md`
- `/srv/madladslab/QRS_DESIGN.md`
- `/srv/madladslab/CLAUDETALK_UPDATES.md`
- `/srv/servers/README.md`
- `/srv/servers/DEPLOYMENT_SUMMARY.md`
- `/srv/ps/README.md`
- `/srv/ps/STATUS_BAR_README.md`

### Find All Documentation
```bash
find /srv -maxdepth 2 -name "*.md" | grep -v node_modules
```

## 🔐 Admin Access

### Monitoring Dashboard
**URL**: https://servers.madladslab.com
- Google OAuth (admin only)
- Monitor all services
- Start/stop/restart
- View logs

### Service Monitoring
**URL**: https://madladslab.com/admin/monitor
- Service status history
- Email alert configuration

### PS Status Bar
**Location**: Bottom of ps.madladslab.com (admin only)
- CPU/Memory monitoring
- Debug mode toggle

## 💡 Tips

1. **Always check context first** - `.claude-context.json` has all the answers
2. **Update as you go** - Don't wait to document changes
3. **Use jq for JSON** - Makes reading context file easier
4. **Reference line numbers** - When documenting file changes, include line numbers
5. **Cross-reference** - Note when features span multiple modules
6. **Test after changes** - Always verify service restarts correctly

## 🆘 Troubleshooting

### Service Won't Start
1. Check logs: `tmux capture-pane -t service_session -p`
2. Check port: `lsof -i :PORT`
3. Check .env file exists
4. Check MongoDB connection

### Can't Access Service
1. Check tmux session: `tmux ls | grep service`
2. Check Apache: `sudo systemctl status apache2`
3. Check SSL: `sudo certbot certificates`
4. Check firewall: `sudo ufw status`

### Authentication Issues
1. Check Google OAuth credentials in .env
2. Verify database connection
3. Check user has isAdmin=true
4. Clear browser cookies

### Need Help?
- Check service README
- Check `.claude-context.json` for related modules
- Check logs in monitoring dashboard
- Email: scott@madladslab.com

## 📝 Quick Commands

```bash
# View context for a service
jq '.services.serviceName' /srv/.claude-context.json

# Check all service ports
jq '.services | to_entries | .[] | "\(.key): \(.value.port)"' /srv/.claude-context.json

# See recent changes
jq '.developmentNotes.recentChanges' /srv/.claude-context.json

# Find all documentation
jq '.services[].documentation[]' /srv/.claude-context.json

# Check monitoring systems
jq '.crossModuleFeatures.serviceMonitoring.implementations' /srv/.claude-context.json
```

---

**Last Updated**: 2025-10-22
**Version**: 1.0.0

For more details, see the full context in `.claude-context.json`
