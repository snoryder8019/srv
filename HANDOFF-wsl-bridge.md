# Handoff — WSL2-as-server bridge: headless survival test (Greeley box)

> ✅ **COMPLETED (2026-07).** The bridge passed and the real `/srv` lift-and-shift (§9) was carried out:
> all services now run as systemd units (`srv-<name>`) on this WSL2 / Greeley box. Retained as the migration
> record; the "canary only / do NOT migrate /srv" scope note below is historical.

**Goal:** prove WSL2 can run an **always-on Linux service that survives user-switch,
logoff of every human user, and a full reboot — with nobody logged in.** This is the
de-risk step before lifting `/srv` (Apache + node apps + cron) off the Linode VPS onto
a WSL2 Ubuntu instance on the Greeley GPU box.

**Why this test first:** the one genuinely finicky part of WSL2-as-a-server is running it
**headless under a non-interactive service account.** WSL2 instances are *per-Windows-user*
and die when that user logs off. We validate the boot-service pattern with a throwaway
**canary** HTTP service before committing the real migration. If the canary survives all
4 checks → green-light the `/srv` lift-and-shift. If not → fall back to NSSM (see §7).

**Owner identity:** the WSL distro + boot task run as **`snory` S4U** — the same service
account your `OllamaMongo` / `OllamaClusterTunnel` tasks already use. Neither of the two
human users owns it, so either can log in/out freely.

**Scope:** canary only. Do NOT migrate `/srv` in this handoff. A follow-up handoff covers
the real lift-and-shift once this passes.

---

## 0. Prereqs — capture environment first

Run in an **elevated PowerShell** and record the output (needed for the go/no-go call):

```powershell
[System.Environment]::OSVersion.Version      # build — mirrored networking needs Win11 22H2+ (build >= 22621)
wsl --version                                # WSL + kernel version (want WSL 2.x)
wsl --status
```

- **Build >= 22621 (Win11 22H2+):** mirrored networking is available — use it (§3).
- **Win10 / older:** skip `networkingMode=mirrored`; default NAT + localhost-forwarding
  still serves `localhost:<port>` from any session, just less clean. Note it and continue.

If WSL isn't installed yet:
```powershell
wsl --install -d Ubuntu      # installs WSL2 + Ubuntu, reboots may be required
wsl --update                 # if already installed, get the latest kernel
```

---

## 1. Register the distro UNDER the service account (key gotcha)

WSL distros are per-user. The boot task runs as `snory`, so the **Ubuntu distro must be
registered to `snory`**. Do the install/init **while interactively logged in as `snory` once**:

1. Log in to Windows **as `snory`**.
2. `wsl --install -d Ubuntu` (or launch "Ubuntu" from Start), create the default UNIX user
   when prompted (e.g. `srv`).
3. Confirm: `wsl -l -v` → `Ubuntu  Running  2` (VERSION must be **2**).

After this one-time interactive init, the distro belongs to `snory` and the boot task can
launch it with no interactive login.

---

## 2. Inside Ubuntu — enable systemd + a canary service

Open Ubuntu (as `snory`) and run:

```bash
# 2a. systemd on (so services auto-start on WSL boot)
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true

[user]
default=srv
EOF

# 2b. canary HTTP service as a systemd unit (throwaway — proves always-on)
sudo tee /etc/systemd/system/canary.service >/dev/null <<'EOF'
[Unit]
Description=WSL canary (survival test)
After=network.target

[Service]
ExecStart=/usr/bin/python3 -m http.server 8099 --bind 0.0.0.0
Restart=always

[Install]
WantedBy=multi-user.target
EOF
```

Apply systemd (full VM restart required for wsl.conf to take effect):

```powershell
wsl --shutdown
```
Then reopen Ubuntu and enable the canary:
```bash
systemctl is-system-running          # should be 'running' or 'degraded' (not 'offline') => systemd is live
sudo systemctl enable --now canary
systemctl is-active canary           # 'active'
curl -s localhost:8099 | head -1     # directory listing => serving
```

From **Windows** PowerShell (proves host can reach WSL):
```powershell
(Invoke-WebRequest http://localhost:8099 -UseBasicParsing).StatusCode   # 200
```

---

## 3. RAM cap + networking — `.wslconfig`

Create **`C:\Users\snory\.wslconfig`** (caps WSL so it can't starve the GPU box):

```ini
[wsl2]
memory=32GB
processors=4
networkingMode=mirrored
```

- `memory=32GB` — you have 64 GB; this leaves headroom for inference/SD/Mongo/MinIO.
- `networkingMode=mirrored` — **Win11 22H2+ only.** Makes WSL ports behave like real
  localhost (the tunnel will need this to reach Apache inside WSL). **Delete this line on Win10.**

Apply: `wsl --shutdown`, reopen, re-confirm `curl localhost:8099`.

---

## 4. Boot service — `install-wsl-task.ps1`

This is the keepalive: at Windows boot it launches the WSL VM (which boots systemd → canary)
and holds it up with a foreground `tail`. Mirrors your `install-tunnel-task.ps1`. Save as
`C:\OllamaCluster\install-wsl-task.ps1` and run **once as Administrator while logged in as snory**
(or with snory's credentials available):

```powershell
# install-wsl-task.ps1 — registers WslServer: boots WSL Ubuntu headless at startup, holds the VM up.
$TaskName = "WslServer"
$Distro   = "Ubuntu"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Keepalive: launch the distro and hold a foreground process so the VM never idle-shuts.
# systemd=true means systemd + the canary come up the moment the VM starts.
$Action = New-ScheduledTaskAction `
    -Execute "C:\Windows\System32\wsl.exe" `
    -Argument "-d $Distro -u root --exec /usr/bin/tail -f /dev/null"

$Trigger = New-ScheduledTaskTrigger -AtStartup
$Trigger.Delay = "PT20S"

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

# snory S4U — runs whether or not snory (or anyone) is interactively logged in.
$Principal = New-ScheduledTaskPrincipal `
    -UserId "snory" `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
    -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Task '$TaskName' registered. Starting now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 12
Write-Host "State: $((Get-ScheduledTask -TaskName $TaskName).State)"
wsl -l -v
```

---

## 5. THE TEST — 4 scenarios (the whole point)

Verification command (run from **any** Windows user's PowerShell):

```powershell
function Test-Canary { try { "Canary: HTTP " + (Invoke-WebRequest http://localhost:8099 -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "Canary: DOWN — $($_.Exception.Message)" } }
Test-Canary ; wsl -l -v
```

Run each scenario and record PASS/FAIL:

| # | Scenario | How | PASS = |
|---|----------|-----|--------|
| 1 | **Baseline** | After §4 (or a reboot) | `Test-Canary` → HTTP 200, Ubuntu `Running` |
| 2 | **Switch user** | Start menu → Switch user → log in as the *other* human → run `Test-Canary` | still 200 |
| 3 | **Logoff each human** ⭐ | Log **off** human-A (Start → Sign out), reconnect as anyone → `Test-Canary`. Repeat logging off human-B. **Do NOT log off `snory` via its own session unless snory is only running headless.** | still 200 after *each* logoff |
| 4 | **Full reboot** | `Restart-Computer`. After boot, **wait ~90s, log in as a HUMAN user (not snory)** → `Test-Canary` | 200 with no snory interactive login |

⭐ **Scenario 3 is the decisive one** — it's what kills naive per-user WSL. If the canary
stays up through both human logoffs and the reboot, the S4U boot-service pattern is proven
and WSL2 is trustworthy as the `/srv` bridge.

---

## 6. What to report back

Paste these so we make the go/no-go call:
- `[System.Environment]::OSVersion.Version` + `wsl --version` (from §0)
- The PASS/FAIL of all 4 scenarios
- `Get-ScheduledTask WslServer | Select-Object State` after the reboot test
- Inside WSL after reboot: `wsl -d Ubuntu -u root -e systemctl is-active canary`

---

## 7. Fallback if scenario 3 or 4 FAILS (S4U won't hold WSL headless)

Use **NSSM** (a real Windows service is more robust than a scheduled task for headless WSL):

```powershell
# download nssm.exe to C:\OllamaCluster\bin first
C:\OllamaCluster\bin\nssm.exe install WslServer "C:\Windows\System32\wsl.exe" "-d Ubuntu -u root --exec /usr/bin/tail -f /dev/null"
C:\OllamaCluster\bin\nssm.exe set WslServer ObjectName ".\snory" "<snory-password>"   # service runs as snory
C:\OllamaCluster\bin\nssm.exe set WslServer Start SERVICE_AUTO_START
C:\OllamaCluster\bin\nssm.exe set WslServer AppExit Default Restart
Start-Service WslServer
```
Then re-run §5. A Windows *service* (not scheduled task) runs fully independent of any
session — this is the known-good headless WSL pattern if S4U proves flaky.

---

## 8. Teardown (if you want to undo the canary after testing)

```powershell
Stop-ScheduledTask -TaskName WslServer; Unregister-ScheduledTask WslServer -Confirm:$false
# (or) Stop-Service WslServer; C:\OllamaCluster\bin\nssm.exe remove WslServer confirm
```
```bash
sudo systemctl disable --now canary; sudo rm /etc/systemd/system/canary.service
```
Leave `wsl.conf` (systemd) and `.wslconfig` in place — the real `/srv` migration reuses them.

---

## 9. Next (only after a clean PASS) — the real lift-and-shift (separate handoff)
- `/srv` Apache vhosts + node apps become systemd units inside WSL; cron → cron/systemd timers.
- One Apache/nginx reverse proxy inside WSL on a single port.
- Invert the tunnel: VPS Apache becomes a thin forwarder → that one WSL port (collapses 60
  vhosts to one tunnel forward). VPS demoted from app-host to dumb ingress.
- Extend `watchdog.ps1` with a `Test-DataService 'WslServer' 8080 'WSL /srv'`-style check
  (same port-is-liveness logic we just fixed) so the bridge self-heals like Mongo/MinIO.

---
*Pairs with: `HANDOFF-s3-cutover.md` (object storage), `HANDOFF-tenant-db-migration.md` (DB).
Cloud-freedom endgame after this: only a thin ingress proxy + DNS remain on Linode, until
the WireGuard mesh + edge nodes retire them.*
