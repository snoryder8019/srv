#!/usr/bin/env bash
# Arcade shared-toolkit sync.  Canonical source of truth: /srv/_shared/js
#
# Distribution:
#  1) ES MODULE consumers (`import` in slot.js / *3d.js) load directly, stampless,
#     from https://games.madladslab.com/shared/js/<file>. The games portal serves
#     /shared with `Cache-Control: max-age=60, must-revalidate`, so edits go live
#     within ~1 minute everywhere with NO consumer edits.
#  2) PLAIN <script> consumers (can't cross-origin cleanly) get a local COPY.
#
# Workflow: edit a file in /srv/_shared/js, then run this script. Module consumers
# need nothing; plain-script consumers are re-copied here.
set -euo pipefail
JS=/srv/_shared/js
PLAIN_TARGETS=(
  "cards-render.js:/srv/cards/public/js"
  "cards-render.js:/srv/tiles/public/js"
)
for entry in "${PLAIN_TARGETS[@]}"; do
  file="${entry%%:*}"; dest="${entry##*:}"
  if [ -d "$dest" ]; then cp -f "$JS/$file" "$dest/$file"; echo "copied $file -> $dest"; else echo "skip (no dir): $dest"; fi
done
echo "sync complete. (module consumers auto-update via /shared revalidation)"
