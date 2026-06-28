#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# restart-service.sh — cleanly restart ONE srv tmux service (or list them all).
#
#   /srv/restart-service.sh slab            # clean restart slab
#   /srv/restart-service.sh mcp-streamable  # works for special services too
#   /srv/restart-service.sh --list          # show restartable service names
#   /srv/restart-service.sh --all           # clean restart every service
#
# "Clean" = kill every plausible session for the service AND free its port, then
# start one fresh canonical session. Restart logic lives in /srv/lib-restart.sh.
# ─────────────────────────────────────────────────────────────────────────────

LIB="/srv/lib-restart.sh"
if [ ! -f "$LIB" ]; then echo "ERROR: $LIB not found!"; exit 1; fi
# shellcheck source=/srv/lib-restart.sh
source "$LIB"

usage() {
  echo "Usage: $0 <service-name> | --all | --list"
  echo ""
  echo "Restartable services:"
  restart_all_names | sed 's/^/  /'
}

case "${1:-}" in
  ""|-h|--help)
    usage; exit 1 ;;
  --list|-l)
    restart_all_names; exit 0 ;;
  --all|-a)
    rc=0
    while read -r name; do
      restart_service "$name" || rc=1
    done < <(restart_all_names)
    exit $rc ;;
  *)
    restart_service "$1"; exit $? ;;
esac
