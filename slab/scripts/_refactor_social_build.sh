#!/usr/bin/env bash
# One-off: split routes/admin/social.js into routes/admin/social/* (extract-and-shim).
# SAFE: does NOT modify social.js. Builds the new dir + verifies byte-fidelity.
set -euo pipefail
cd /srv/slab/routes/admin
O=social.js
DIR=social
ts=$(date +%s)

# 0. Backup (git also has history; this is belt-and-suspenders)
cp "$O" "$O.prerefactor-$ts"
echo "backup: $O.prerefactor-$ts"

mkdir -p "$DIR/_tmp"

# 1. Slice contiguous route tiles (each = one module body), verbatim.
#    name:start:end  (tiles cover 156..1738 with no gaps/overlaps)
tiles="dashboard:156:315 live:316:405 engage:406:433 connections:434:676 compose:677:895 suggestions:896:1099 voice:1100:1142 studio:1143:1357 oauth:1358:1738"
for spec in $tiles; do
  name=${spec%%:*}; rest=${spec#*:}; a=${rest%%:*}; b=${rest#*:}
  sed -n "${a},${b}p" "$O" > "$DIR/_tmp/$name.body"
done

# 2. FIDELITY CHECK #1 — reconstruct route region from tiles, must equal original 156..1738
cat "$DIR/_tmp/dashboard.body" "$DIR/_tmp/live.body" "$DIR/_tmp/engage.body" \
    "$DIR/_tmp/connections.body" "$DIR/_tmp/compose.body" "$DIR/_tmp/suggestions.body" \
    "$DIR/_tmp/voice.body" "$DIR/_tmp/studio.body" "$DIR/_tmp/oauth.body" > "$DIR/_tmp/route_recon.txt"
if ! diff <(sed -n '156,1738p' "$O") "$DIR/_tmp/route_recon.txt" > "$DIR/_tmp/route.diff" 2>&1; then
  echo "FATAL: route region reconstruction differs from original:"; cat "$DIR/_tmp/route.diff"; exit 1
fi
echo "fidelity#1 route-region: IDENTICAL"

# 3. Universal module header (imports resolve every symbol any handler references).
read -r -d '' HEADER <<'EOF' || true
import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { logActivity } from '../../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform, discoverInstagramFromPage,
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { suggestSlots } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();
EOF

# 4. Assemble each module: header + body + export footer.
for spec in $tiles; do
  name=${spec%%:*}
  { printf '%s\n\n' "$HEADER"; cat "$DIR/_tmp/$name.body"; printf '\nexport default router;\n'; } > "$DIR/$name.js"
done

# 5. shared.js: own imports + helper slice (drop line 89 `const router`) + export block.
{
  cat <<'EOF'
// Shared helpers + upload instances for the /admin/social route modules.
// Extracted verbatim from the original single-file social.js (extract-and-shim).
import multer from 'multer';
import { decrypt } from '../../../plugins/crypto.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { PLATFORMS, packCredentials, unpackCredentials, discoverInstagramFromPage, publishPost } from '../../../plugins/socialPublish.js';
import { logActivity } from '../../../plugins/activityLog.js';

EOF
  sed -n '35,88p;90,155p' "$O"
  cat <<'EOF'

export {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, MEDIA_MIME_RE, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
};
EOF
} > "$DIR/shared.js"

# 6. index.js composer — mounts sub-routers in ORIGINAL order (identical match precedence).
cat > "$DIR/index.js" <<'EOF'
// /admin/social — composed router. Split from a 1,739-line single file into
// focused modules (extract-and-shim). Sub-routers mount in the original order so
// route-match precedence is byte-for-byte identical to the pre-split file.
import express from 'express';
import dashboard from './dashboard.js';
import live from './live.js';
import engage from './engage.js';
import connections from './connections.js';
import compose from './compose.js';
import suggestions from './suggestions.js';
import voice from './voice.js';
import studio from './studio.js';
import oauth from './oauth.js';

const router = express.Router();
router.use(dashboard);
router.use(live);
router.use(engage);
router.use(connections);
router.use(compose);
router.use(suggestions);
router.use(voice);
router.use(studio);
router.use(oauth);

export default router;
EOF

# 7. Syntax gate — every new file must parse.
echo "=== node --check ==="
for f in "$DIR"/shared.js "$DIR"/index.js "$DIR"/dashboard.js "$DIR"/live.js "$DIR"/engage.js "$DIR"/connections.js "$DIR"/compose.js "$DIR"/suggestions.js "$DIR"/voice.js "$DIR"/studio.js "$DIR"/oauth.js; do
  node --check "$f" && echo "ok: $f"
done

rm -rf "$DIR/_tmp"
echo "BUILD_DONE (social.js untouched)"
