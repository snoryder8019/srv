#!/usr/bin/env bash
# Split routes/admin/assets.js -> routes/admin/assets/* (extract-and-shim).
# Helpers are scattered through the file, so ALL helpers go to shared.js and
# route slices go to feature modules. Reconstruct-and-diff guards byte fidelity.
# SAFE: does NOT modify assets.js.
set -euo pipefail
cd /srv/slab/routes/admin
O=assets.js
DIR=assets
ts=$(date +%s)
cp "$O" "$O.prerefactor-$ts"; echo "backup: $O.prerefactor-$ts"
mkdir -p "$DIR/_tmp"

# Ordered top-level starts of the body region (22..1929). 22 = preamble+assetMem.
starts=(22 33 54 70 81 94 110 121 131 138 143 156 157 159 185 194 216 283 327 341 348 451 625 636 669 683 752 797 808 831 869 935 943 953 971 994 1011 1049 1054 1064 1080 1111 1124 1146 1160 1187 1199 1223 1249 1307 1350 1354 1360 1368 1382 1384 1390 1446 1467 1568 1601 1647 1683 1746 1773 1789 1808 1832 1843 1861 1890 1906)
sentinel=1930

# Route-start -> module map. Any start NOT listed here is a HELPER (-> shared).
declare -A MOD=(
  [138]=library [143]=library [636]=library [1307]=library [1446]=library
  [1467]=library [1568]=library [1601]=library [1647]=library [1683]=library
  [1746]=library [1773]=library [1789]=library
  [185]=packs [194]=packs [216]=packs
  [283]=generate [327]=generate [451]=generate
  [669]=brandkit [683]=brandkit [752]=brandkit
  [797]=folders [808]=folders [831]=folders [869]=folders
  [935]=campaigns [943]=campaigns [953]=campaigns [971]=campaigns [994]=campaigns
  [1049]=resources [1054]=resources [1080]=resources [1111]=resources [1124]=resources
  [1146]=presets [1160]=presets [1187]=presets [1199]=presets [1223]=presets [1249]=presets
  [1368]=optimize [1390]=optimize
  [1832]=describe [1843]=describe [1906]=describe
)

modules="library packs generate brandkit folders campaigns resources presets optimize describe"
: > "$DIR/_tmp/all_ordered.txt"; : > "$DIR/_tmp/shared.body"
for m in $modules; do : > "$DIR/_tmp/mod.$m.body"; done

n=${#starts[@]}
for ((i=0;i<n;i++)); do
  s=${starts[i]}
  next=${starts[i+1]:-$sentinel}
  e=$(( next - 1 ))
  sed -n "${s},${e}p" "$O" >> "$DIR/_tmp/all_ordered.txt"
  m=${MOD[$s]:-__H__}
  if [ "$m" = "__H__" ]; then
    sed -n "${s},${e}p" "$O" >> "$DIR/_tmp/shared.body"
  else
    sed -n "${s},${e}p" "$O" >> "$DIR/_tmp/mod.$m.body"
  fi
done

# FIDELITY: reconstructed body must equal original 22..1929 exactly.
if ! diff <(sed -n '22,1929p' "$O") "$DIR/_tmp/all_ordered.txt" > "$DIR/_tmp/body.diff" 2>&1; then
  echo "FATAL: body reconstruction differs:"; head -40 "$DIR/_tmp/body.diff"; exit 1
fi
echo "fidelity body-region: IDENTICAL"

# Universal module header: original imports (depth ../../../) + shared helpers + router.
read -r -d '' HEADER <<'EOF' || true
import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { createCanvas, loadImage } from 'canvas';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../../plugins/s3.js';
import { config } from '../../../config/config.js';
import { callLLM, callVisionLLM, webSearch, tryParseAgentResponse, runTool, generateSdImage, recordTrainingCandidate, buildBrandedSdPrompt } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { buildAssetReferenceIndex, annotateAssets } from '../../../plugins/usageMap.js';
import { wouldExceedQuota, getQuotaLabel } from '../../../plugins/storage.js';
import { PACKS, getPack, fileUrl, listingUrl } from '../../../data/asset-packs.js';
import { generateThumbnail, deriveThumbKey } from '../../../plugins/thumbnails.js';
import { generateWebVariant, deriveWebKey } from '../../../plugins/webVariant.js';
import {
  PLATFORM_LIST, unpackCredentials, isAccountConfigured,
  resourceSlotsFor, findResourceSlot, slotSupportsPush, pushResource,
} from '../../../plugins/socialPublish.js';
import {
  assetMem, uploadToLinode, uploadThumbnail, tryThumb, deleteThumb,
  uploadWebVariant, tryWebVariant, deleteWebVariant, streamToBuffer,
  fetchPackIndex, SIZE_PRESETS, renderLayersToPng, normaliseFolders,
  buildResourceView, tryPushResource, NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE,
  NEEDS_OPTIMIZE, wantsThumb, wantsWeb, describeAssetDoc, visionDescribeAsset,
  loadAssetImageBuffer,
} from './shared.js';

const router = express.Router();
EOF

for m in $modules; do
  { printf '%s\n\n' "$HEADER"; cat "$DIR/_tmp/mod.$m.body"; printf '\nexport default router;\n'; } > "$DIR/$m.js"
done

# shared.js: full original imports (depth ../../../) + helper slices + export block.
{
  cat <<'EOF'
// Shared helpers, upload/thumbnail/web-variant utilities, canvas layer renderer,
// resource-view builders, and asset-description helpers for the /admin/assets
// route modules. Extracted verbatim from the original single-file assets.js.
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { createCanvas, loadImage } from 'canvas';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '../../../plugins/mongo.js';
import { s3Client, BUCKET, bucketUrl } from '../../../plugins/s3.js';
import { config } from '../../../config/config.js';
import { callLLM, callVisionLLM, webSearch, tryParseAgentResponse, runTool, generateSdImage, recordTrainingCandidate, buildBrandedSdPrompt } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { buildAssetReferenceIndex, annotateAssets } from '../../../plugins/usageMap.js';
import { wouldExceedQuota, getQuotaLabel } from '../../../plugins/storage.js';
import { PACKS, getPack, fileUrl, listingUrl } from '../../../data/asset-packs.js';
import { generateThumbnail, deriveThumbKey } from '../../../plugins/thumbnails.js';
import { generateWebVariant, deriveWebKey } from '../../../plugins/webVariant.js';
import {
  PLATFORM_LIST, unpackCredentials, isAccountConfigured,
  resourceSlotsFor, findResourceSlot, slotSupportsPush, pushResource,
} from '../../../plugins/socialPublish.js';

EOF
  cat "$DIR/_tmp/shared.body"
  cat <<'EOF'

export {
  assetMem, uploadToLinode, uploadThumbnail, tryThumb, deleteThumb,
  uploadWebVariant, tryWebVariant, deleteWebVariant, streamToBuffer,
  _packIndexCache, PACK_CACHE_TTL_MS, fetchPackIndex,
  SIZE_PRESETS, renderLayersToPng, normaliseFolders,
  buildResourceView, tryPushResource,
  NEEDS_THUMB_CLAUSE, NEEDS_WEB_CLAUSE, NEEDS_OPTIMIZE, wantsThumb, wantsWeb,
  describeAssetDoc, visionDescribeAsset, loadAssetImageBuffer,
};
EOF
} > "$DIR/shared.js"

# index.js composer.
cat > "$DIR/index.js" <<'EOF'
// /admin/assets — composed router. Split from a 1,930-line single file into a
// shared helper module + focused feature routers (extract-and-shim). Routes are
// mutually non-overlapping, so mount order does not affect match precedence.
import express from 'express';
import library from './library.js';
import packs from './packs.js';
import generate from './generate.js';
import brandkit from './brandkit.js';
import folders from './folders.js';
import campaigns from './campaigns.js';
import resources from './resources.js';
import presets from './presets.js';
import optimize from './optimize.js';
import describe from './describe.js';

const router = express.Router();
router.use(library);
router.use(packs);
router.use(generate);
router.use(brandkit);
router.use(folders);
router.use(campaigns);
router.use(resources);
router.use(presets);
router.use(optimize);
router.use(describe);

export default router;
EOF

echo "=== node --check ==="
for f in "$DIR"/shared.js "$DIR"/index.js $(for m in $modules; do echo "$DIR/$m.js"; done); do
  node --check "$f" && echo "ok: $f"
done

rm -rf "$DIR/_tmp"
echo "BUILD_DONE (assets.js untouched)"
