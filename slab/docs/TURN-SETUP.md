# TURN relay setup (meetings) — coturn on the Linode VPS

WebRTC meetings need a TURN relay for participants on mobile/5G. Those networks
sit behind symmetric NAT / CGNAT where STUN alone can't hole-punch, so without a
relay a share of phone users never connect. The app is already wired for it — it
just needs a running TURN server.

## Where it runs

- Host: **the Linode VPS, `104.237.138.28`** — `turn.madladslab.com` already
  resolves there, and the wildcard `*.madladslab.com` TLS cert lives there
  (needed for `turns:5349`, the TLS transport that gets through locked-down
  mobile/corporate networks that block raw UDP).
- **Not** the WSL/Greeley app box — it's behind residential double-NAT and is a
  poor relay host.

## App side — already done

`.env` on the app host holds:

```
TURN_URL=turn:turn.madladslab.com:3478,turns:turn.madladslab.com:5349
TURN_SECRET=<64-hex shared secret>
```

The app mints an **ephemeral** credential per page-load using coturn's
`use-auth-secret` scheme (username = `<unix-expiry>:slab`, credential =
`base64(HMAC-SHA1(TURN_SECRET, username))`, 12h TTL). Nothing reusable is left
in page source. This was verified end-to-end against coturn 4.6.1 locally: the
app-generated credential authenticates and allocates a relay; a wrong credential
is rejected.

`TURN_SECRET` must be **identical** on the app host and in coturn's
`static-auth-secret` below. Copy the exact value from the app host's `.env`.

## coturn install + config (run on the Linode box)

```bash
sudo apt-get update && sudo apt-get install -y coturn

# Enable the daemon
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

Write `/etc/turnserver.conf` (replace `PASTE_TURN_SECRET_HERE` with the exact
`TURN_SECRET` from the app host's `.env`, and confirm the cert paths):

```ini
# Public-facing relay for meetings
listening-port=3478
tls-listening-port=5349

# The VPS's real public IP. If the box has a single public IP, external-ip=that.
external-ip=104.237.138.28

# Ephemeral (time-limited) credentials — MUST match the app's TURN_SECRET
use-auth-secret
static-auth-secret=PASTE_TURN_SECRET_HERE
realm=turn.madladslab.com

# TLS for turns:5349 — reuse the wildcard *.madladslab.com cert.
# Adjust paths to wherever the cert actually lives on this box
# (e.g. /etc/letsencrypt/live/madladslab.com/).
cert=/etc/letsencrypt/live/madladslab.com/fullchain.pem
pkey=/etc/letsencrypt/live/madladslab.com/privkey.pem

# Relay port range (open these in the firewall too)
min-port=49152
max-port=65535

# Hardening
no-cli
no-multicast-peers
# Don't relay to internal ranges — prevents the relay being used to reach
# private infrastructure.
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
```

Open the firewall and start it:

```bash
# UDP+TCP 3478 (STUN/TURN), TCP 5349 (TURN over TLS), and the relay UDP range
sudo ufw allow 3478/tcp && sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp

sudo systemctl enable --now coturn
sudo systemctl restart coturn
```

coturn needs read access to the cert/key — if it runs as the `turnserver` user,
either grant that user read on the letsencrypt live/archive dirs or copy the
cert into a coturn-readable location and point `cert=`/`pkey=` there. Add a
renewal `--deploy-hook` that restarts coturn so the cert stays current.

## Verify it's live (from any machine)

```bash
# Should print "Allocation granted" for both UDP and TLS
# (generate creds with the same secret; TTL 3600s):
#   expiry=$(( $(date +%s) + 3600 )); user="$expiry:slab"
#   pass=$(printf '%s' "$user" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)
turnutils_uclient -y -u "$user" -w "$pass" turn.madladslab.com          # UDP 3478
turnutils_uclient -y -T -u "$user" -w "$pass" -p 5349 turn.madladslab.com # TLS 5349
```

Or paste the ICE server block from a live meeting page's `data-ice-servers`
attribute into https://icetest.info / webrtc.github.io/samples/src/content/peerconnection/trickle-ice
and confirm a `relay` candidate appears.

## Rotating the secret

1. Generate a new one: `openssl rand -hex 32`.
2. Update `static-auth-secret` in `/etc/turnserver.conf` → `systemctl restart coturn`.
3. Update `TURN_SECRET` in the app host's `.env` → restart `srv-slab`.
   Do both together — a mismatch means no relay (calls fall back to STUN-only).
