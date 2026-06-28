# Master Index for /srv

## Subdirectories
- acm
- archive
- bih
- game-state-service
- graffiti-tv
- greealitytv
- madThree
- madladslab
- mcp
- nocometalworkz
- ps
- roamingNPCs
- servers
- sfg
- sna
- twww
- w2MongoClient

## Miscellaneous Files
- auto-start-npm.json
- auto-start-npm.log
- auto-start-npm.sh
- monitor-services.log
- monitor-services.sh
- QUICK_START.md
- README.md
- SERVICE_MONITOR_README.md
- TMUX_CHEATSHEET.md
- service-control.sh
- start-all-services.sh
## reels — Slot machines (arcade web game)
- Dir: /srv/reels · Port: 3740 · tmux: reels · Domain: reels.madladslab.com
- Skinnable slot protocol: machines are JSON configs (strips/paylines/paytable/bonuses) — see /srv/reels/REELS_PROTOCOL.md
- First skin: classic-diamond (3-reel classic, 93.11% RTP, diamond free-spin bonus)
- Platform plug-in per WEBGAMES_PROTOCOL.md: SSO bridge auth, chips via /internal/wallet debit→settle, big wins → webgame score ingest
