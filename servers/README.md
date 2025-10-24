# Servers Dashboard - JWT Authenticated Monitoring

A dedicated server monitoring dashboard at **servers.madladslab.com** with JWT authentication for secure access.

## Features

- **JWT Authentication**: Secure login with JWT tokens
- **Real-time Monitoring**: Live system stats and service health
- **Service Management**: Start, stop, and restart services
- **Log Viewing**: View service logs in real-time
- **System Metrics**:
  - CPU usage and core count
  - Memory usage (used/total)
  - Disk usage
  - System uptime
  - Load average (1m, 5m, 15m)
- **Service Monitoring**: Monitors 9 services
  - madladslab (port 3000)
  - acm (port 3002)
  - sfg (port 3003)
  - ps - Project Stringborne (port 3399)
  - game-state (port 3500)
  - sna (port 3004)
  - twww (port 3005)
  - madThree (port 3001)
  - w2MongoClient (port 3006)

## Architecture

- **Backend**: Node.js + Express
- **Authentication**: JWT (JSON Web Tokens)
- **Frontend**: Vanilla JavaScript SPA
- **Proxy**: Apache with SSL (Let's Encrypt)
- **Port**: 3600 (internal), 443 (external via Apache)

## Access

### URL
https://servers.madladslab.com

### Default Credentials
- **Username**: `admin`
- **Password**: `admin123`

⚠️ **IMPORTANT**: Change these credentials in production!

## Configuration

### Environment Variables (.env)
```env
PORT=3600
JWT_SECRET=your_secure_jwt_secret_change_this_in_production_2025
NODE_ENV=development
ALLOWED_ADMINS=admin@madladslab.com
```

### Apache Configuration
- Config file: `/etc/apache2/sites-available/servers.madladslab.com.conf`
- SSL Certificate: Managed by Let's Encrypt/certbot
- Auto-renews before expiration

## Service Management

### Start the Service
```bash
cd /srv/servers
node server.js
# or via tmux
tmux new-session -d -s servers_session -c /srv/servers "node server.js"
```

### Check Status
```bash
tmux capture-pane -t servers_session -p | tail -20
```

### Stop the Service
```bash
tmux kill-session -t servers_session
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login and get JWT token
  ```json
  {
    "username": "admin",
    "password": "admin123"
  }
  ```
  Returns: `{ "success": true, "token": "jwt_token", "user": {...} }`

- `GET /api/auth/verify` - Verify JWT token
  - Headers: `Authorization: Bearer <token>`

### System Monitoring
- `GET /api/system` - Get system stats (CPU, memory, disk, uptime)
  - Requires: JWT token

- `GET /api/services` - Get all services status
  - Requires: JWT token

### Service Management
- `POST /api/services/:serviceId/start` - Start a service
- `POST /api/services/:serviceId/stop` - Stop a service
- `POST /api/services/:serviceId/restart` - Restart a service
- `GET /api/services/:serviceId/logs?lines=100` - Get service logs
- All require: JWT token

## Security Features

- JWT token-based authentication
- 24-hour token expiration
- HTTPS-only (HTTP redirects to HTTPS)
- Security headers:
  - X-Frame-Options: SAMEORIGIN
  - X-Content-Type-Options: nosniff
  - X-XSS-Protection: 1; mode=block
  - Referrer-Policy: strict-origin-when-cross-origin
- Token stored in localStorage (client-side)
- CORS enabled

## Integration with MadLabs Lab Auth

### Future Enhancement
To integrate with madladslab.com authentication:

1. Import madladslab database connection
2. Verify user exists and `isAdmin === true`
3. Update login endpoint in `server.js`:

```javascript
import { getDb } from '../madladslab/plugins/mongo/mongo.js';

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  const db = getDb();
  const user = await db.collection('users').findOne({ username });

  if (user && user.isAdmin && bcrypt.compareSync(password, user.password)) {
    const token = jwt.sign(
      { username: user.username, isAdmin: true },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({ success: true, token, user });
  }

  res.status(401).json({ error: 'Invalid credentials' });
});
```

## Dashboard Features

### System Overview
- Hostname and platform
- CPU usage with percentage
- Memory usage with MB used/total
- Disk usage percentage
- System uptime in days/hours
- Load average (1m, 5m, 15m intervals)

### Service Cards
Each service shows:
- Status indicator (green=healthy, yellow=degraded, red=down)
- Service name
- Port number
- HTTP status code
- Tmux session status
- Action buttons (Start/Stop/Restart/Logs)

### Log Viewer
- Modal popup with service logs
- Shows last 100 lines
- Monospaced font for readability
- Auto-scrolling

## Auto-refresh

- Dashboard refreshes every 5 seconds
- Real-time service status updates
- Automatic reconnection on token expiration

## Files Structure

```
/srv/servers/
├── server.js           # Express server with JWT auth
├── .env                # Environment configuration
├── package.json        # Dependencies
├── public/
│   ├── index.html      # Dashboard UI
│   └── app.js          # Frontend JavaScript
└── README.md           # This file
```

## SSL Certificate Renewal

Certbot automatically renews the SSL certificate. To manually renew:

```bash
sudo certbot renew
sudo systemctl reload apache2
```

## Monitoring the Monitor

To check if the servers dashboard itself is running:

```bash
curl -I https://servers.madladslab.com
# or
lsof -i :3600
```

## Troubleshooting

### Service Won't Start
```bash
cd /srv/servers
node server.js
# Check for errors
```

### Can't Access Dashboard
1. Check Apache is running: `sudo systemctl status apache2`
2. Check service is running: `lsof -i :3600`
3. Check SSL certificate: `sudo certbot certificates`
4. Check Apache config: `sudo apachectl configtest`

### JWT Token Expired
- Tokens expire after 24 hours
- Simply log in again to get a new token

### Service Control Not Working
- Ensure tmux sessions match service definitions in `server.js`
- Check tmux session names: `tmux ls`

## Future Enhancements

- [ ] Database-backed user authentication
- [ ] Multiple admin users
- [ ] Role-based access control
- [ ] Email alerts for service failures
- [ ] Historical metrics and charts
- [ ] Service dependency mapping
- [ ] Automated service recovery
- [ ] Webhook notifications
- [ ] Custom service definitions via config file
- [ ] Docker container support

## Contributing

This is an internal tool for MadLabs Lab infrastructure management.

## License

Internal use only - MadLabs Lab 2025
