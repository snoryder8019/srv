#!/usr/bin/env bash
# Arcade shared-toolkit sync.  Canonical source of truth: /srv/games/_shared/js
#
# Distribution:
#  1) ES MODULE consumers (`import` in slot.js / *3d.js) load directly, stampless,
#     from https://games.madladslab.com/shared/js/<file>. The games portal serves
#     /shared with `Cache-Control: max-age=60, must-revalidate`, so edits go live
#     within ~1 minute everywhere with NO consumer edits.
#  2) PLAIN <script> consumers (can't cross-origin cleanly) get a local COPY.
#
# Workflow: edit a file in /srv/games/_shared/js, then run this script. Module consumers
# need nothing; plain-script consumers are re-copied here.
set -euo pipefail
JS=/srv/games/_shared/js
# LOCAL-COPY consumers: same-origin copies in each app's public/js. parlor3d is
# copied (not cross-origin imported) because parlor3d -> avatar3d -> `import 'three'`
# only resolves the page import-map reliably when the module is served same-origin.
PLAIN_TARGETS=(
  "cards-render.js:/srv/games/arcade/cards/public/js"
  "cards-render.js:/srv/games/arcade/tiles/public/js"
  "parlor3d.js:/srv/games/arcade/tiles/public/js"
  "parlor3d.js:/srv/games/arcade/reels/public/js"
  "avatar3d.js:/srv/games/arcade/tiles/public/js"
  "avatar3d.js:/srv/games/arcade/reels/public/js"
  "confetti3d.js:/srv/games/arcade/tiles/public/js"
  "confetti3d.js:/srv/games/arcade/reels/public/js"
)
for entry in "${PLAIN_TARGETS[@]}"; do
  file="${entry%%:*}"; dest="${entry##*:}"
  if [ -d "$dest" ]; then cp -f "$JS/$file" "$dest/$file"; echo "copied $file -> $dest"; else echo "skip (no dir): $dest"; fi
done
echo "sync complete. (module consumers auto-update via /shared revalidation)"
