#!/usr/bin/env bash
# Split routes/superadmin.js -> routes/superadmin/* (extract-and-shim).
# SECURITY-CRITICAL: preserves the requireSuperAdmin gate ordering (public before,
# protected + scottsGateway mount after). All helpers -> shared.js.
# SAFE: does NOT modify superadmin.js. Reconstruct-and-diff guards byte fidelity.
set -euo pipefail
cd /srv/slab/routes
O=superadmin.js
DIR=superadmin
ts=$(date +%s)
cp "$O" "$O.prerefactor-$ts"; echo "backup: $O.prerefactor-$ts"
mkdir -p "$DIR/_tmp"

# Ordered cut points across body region [35,2826]. 170 = DROP (gate+mount block,
# regenerated in index.js). Excludes 2811-2814 (false positives inside a template
# literal). 173 (mount) falls inside the dropped [170,178] slice.
starts=(35 36 48 57 110 115 119 127 131 150 155 156 157 158 160 161 162 163 164 165 166 167 168 170 179 215 243 280 322 341 357 379 405 427 473 550 556 565 570 594 599 641 647 671 679 683 688 693 705 711 724 730 739 745 750 756 772 779 786 792 798 810 821 845 881 882 884 909 929 936 949 958 965 968 969 976 982 1038 1170 1179 1233 1252 1282 1299 1306 1307 1309 1313 1337 1355 1361 1373 1384 1393 1437 1454 1477 1493 1517 1535 1556 1578 1596 1625 1637 1656 1669 1686 1698 1713 1726 1743 1758 1809 1852 1867 1880 1911 2063 2085 2105 2132 2156 2181 2219 2236 2253 2300 2317 2348 2373 2395 2404 2440 2451 2457 2482 2497 2508 2534 2544 2551 2553 2554 2556 2562 2567 2582 2610 2619 2628 2640 2648 2665 2689 2705 2744 2757 2776)
sentinel=2827

# Route-start -> module. 170 -> __DROP__. Anything else not listed -> __H__ (shared).
declare -A MOD=(
  [170]=__DROP__
  [110]=pub [115]=pub [119]=pub [127]=pub [131]=pub [155]=pub [156]=pub [157]=pub [158]=pub
  [160]=pub [161]=pub [162]=pub [163]=pub [164]=pub [165]=pub [166]=pub [167]=pub [168]=pub
  [179]=dashboard [473]=dashboard [550]=dashboard [556]=dashboard [565]=dashboard
  [215]=tenants [243]=tenants [280]=tenants [322]=tenants [341]=tenants [357]=tenants [379]=tenants
  [405]=tenants [427]=tenants [570]=tenants [1437]=tenants
  [599]=ollama [679]=ollama [683]=ollama [688]=ollama [693]=ollama [705]=ollama [711]=ollama
  [730]=ollama [739]=ollama [745]=ollama [750]=ollama [756]=ollama [772]=ollama [779]=ollama
  [786]=ollama [792]=ollama [798]=ollama [810]=ollama [821]=ollama [845]=ollama
  [958]=ops [1038]=ops [1170]=ops [1179]=ops [1252]=ops [1282]=ops [1299]=ops
  [1355]=ops [1361]=ops [1373]=ops [1384]=ops [1393]=ops
  [1454]=tickets [1477]=tickets [1493]=tickets [1517]=tickets [1535]=tickets [1556]=tickets
  [1578]=tickets [1758]=tickets [1809]=tickets [1852]=tickets [1867]=tickets [1880]=tickets
  [1911]=users [2063]=users [2085]=users [2105]=users [2132]=users [2156]=users
  [2181]=users [2219]=users [2236]=users [2253]=users [2300]=users [2317]=users [2348]=users
  [1596]=crossapp [1625]=crossapp [1637]=crossapp [1656]=crossapp [1669]=crossapp [1686]=crossapp
  [1698]=crossapp [1713]=crossapp [1726]=crossapp [1743]=crossapp [2457]=crossapp [2482]=crossapp
  [2373]=announcements [2395]=announcements [2404]=announcements [2497]=announcements
  [2508]=announcements [2534]=announcements [2544]=announcements
  [2567]=gftv [2582]=gftv [2610]=gftv [2619]=gftv [2628]=gftv [2640]=gftv [2648]=gftv
  [2665]=monitoring [2689]=monitoring [2705]=monitoring [2744]=monitoring [2757]=monitoring [2776]=monitoring
)

modules="pub dashboard tenants ollama ops tickets users crossapp announcements gftv monitoring"
: > "$DIR/_tmp/all_ordered.txt"; : > "$DIR/_tmp/shared.body"
for m in $modules; do : > "$DIR/_tmp/mod.$m.body"; done

n=${#starts[@]}
for ((i=0;i<n;i++)); do
  s=${starts[i]}; next=${starts[i+1]:-$sentinel}; e=$(( next - 1 ))
  m=${MOD[$s]:-__H__}
  if [ "$m" = "__DROP__" ]; then continue; fi          # gate/mount block regenerated in index.js
  sed -n "${s},${e}p" "$O" >> "$DIR/_tmp/all_ordered.txt"
  if [ "$m" = "__H__" ]; then sed -n "${s},${e}p" "$O" >> "$DIR/_tmp/shared.body";
  else sed -n "${s},${e}p" "$O" >> "$DIR/_tmp/mod.$m.body"; fi
done

# FIDELITY: kept slices must equal original body minus the dropped [170,178] block.
if ! diff <(sed -n '35,169p;179,2826p' "$O") "$DIR/_tmp/all_ordered.txt" > "$DIR/_tmp/body.diff" 2>&1; then
  echo "FATAL: body reconstruction differs:"; head -50 "$DIR/_tmp/body.diff"; exit 1
fi
echo "fidelity body-region (minus regenerated gate/mount): IDENTICAL"

read -r -d '' HEADER <<'EOF' || true
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../../middleware/superadmin.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { config } from '../../config/config.js';
import nodemailer from 'nodemailer';
import { logActivity, getActivityLogs, getSignupFunnel } from '../../plugins/activityLog.js';
import { scanSrv, scanSrvSummary } from '../../plugins/srvScan.js';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getServices, getServicesByCategory, getService, getInfraServices, PRODUCTS } from '../../plugins/serviceRegistry.js';
import { FEATURES, STAGES, STAGE_LABELS, resolveStage, defaultStage } from '../../plugins/featureRegistry.js';
import { s3Client, BUCKET } from '../../plugins/s3.js';
import { ListObjectsV2Command, HeadBucketCommand } from '@aws-sdk/client-s3';
import scottsGatewayRouter, { redeemTvPair, tvOrSuper, missionControlHandler, publicPairRequest, publicPairPoll } from './scottsGateway.js';
import {
  TENANT_TAGS, PLAN_LABELS, sendSubscriptionEmail, noStore, safeExec,
  ollamaBase, ollamaFetch, ollamaHealth, OLLAMA_SERVICE_NAMES,
  infraCache, INFRA_TTL_MS, pingMongo, pingBucket, pingOllamaAll, refreshInfra, getInfraCached,
  pulseCache, ERR_RE, countErrorLines, tmuxTail, sysSnapshot, peerLabel,
  DEPR_ROOT, DEPR_STAGES, readJsonFile, getDeprecationPipeline, getDeprecatableSrvProjects,
  GATEWAY_APPS, generateGatewayToken, GFTV_DATA, PLAN_PRICES_GFTV, gftvRead, gftvWrite,
} from './shared.js';

const router = express.Router();
EOF

for m in $modules; do
  { printf '%s\n\n' "$HEADER"; cat "$DIR/_tmp/mod.$m.body"; printf '\nexport default router;\n'; } > "$DIR/$m.js"
done

# shared.js: full original imports (depth ../../) minus scottsGateway + helper slices + export block.
{
  cat <<'EOF'
// Shared helpers, monitoring/ops utilities, ollama proxy, deprecation pipeline,
// gateway tokens, and graffiti-tv JSON store for the /superadmin route modules.
// Extracted verbatim from the original single-file superadmin.js.
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from '../../plugins/mongo.js';
import { requireSuperAdmin, isSuperAdminEmail } from '../../middleware/superadmin.js';
import { bustTenantCache } from '../../middleware/tenant.js';
import { createLoginToken } from '../../middleware/jwtAuth.js';
import { config } from '../../config/config.js';
import nodemailer from 'nodemailer';
import { logActivity, getActivityLogs, getSignupFunnel } from '../../plugins/activityLog.js';
import { scanSrv, scanSrvSummary } from '../../plugins/srvScan.js';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getServices, getServicesByCategory, getService, getInfraServices, PRODUCTS } from '../../plugins/serviceRegistry.js';
import { FEATURES, STAGES, STAGE_LABELS, resolveStage, defaultStage } from '../../plugins/featureRegistry.js';
import { s3Client, BUCKET } from '../../plugins/s3.js';
import { ListObjectsV2Command, HeadBucketCommand } from '@aws-sdk/client-s3';

EOF
  cat "$DIR/_tmp/shared.body"
  cat <<'EOF'

export {
  TENANT_TAGS, PLAN_LABELS, sendSubscriptionEmail, noStore, safeExec,
  ollamaBase, ollamaFetch, ollamaHealth, OLLAMA_SERVICE_NAMES,
  infraCache, INFRA_TTL_MS, pingMongo, pingBucket, pingOllamaAll, refreshInfra, getInfraCached,
  pulseCache, ERR_RE, countErrorLines, tmuxTail, sysSnapshot, peerLabel,
  DEPR_ROOT, DEPR_STAGES, readJsonFile, getDeprecationPipeline, getDeprecatableSrvProjects,
  GATEWAY_APPS, generateGatewayToken, GFTV_DATA, PLAN_PRICES_GFTV, gftvRead, gftvWrite,
};
EOF
} > "$DIR/shared.js"

# index.js — preserves the requireSuperAdmin gate ordering EXACTLY.
cat > "$DIR/index.js" <<'EOF'
// /superadmin — composed router. Split from a 2,827-line single file into a
// shared helper module + focused feature routers (extract-and-shim).
//
// SECURITY: the requireSuperAdmin gate ordering is preserved verbatim — public
// routes mount BEFORE the gate; every protected router (and the scottsGateway
// mount) mounts AFTER it. Do not reorder these three blocks.
import express from 'express';
import scottsGatewayRouter from './scottsGateway.js';
import { requireSuperAdmin } from '../../middleware/superadmin.js';
import publicRoutes from './pub.js';
import dashboard from './dashboard.js';
import tenants from './tenants.js';
import ollama from './ollama.js';
import ops from './ops.js';
import tickets from './tickets.js';
import users from './users.js';
import crossapp from './crossapp.js';
import announcements from './announcements.js';
import gftv from './gftv.js';
import monitoring from './monitoring.js';

const router = express.Router();

// ── Pre-auth (login, subscribe, scottsGateway public TV-pair + proxy) ──
router.use(publicRoutes);

// ── All routes below require superadmin ──
router.use(requireSuperAdmin);

// Private family-ops cockpit — only Scott + spouse (additional allowlist inside).
router.use('/scottsGateway', scottsGatewayRouter);

router.use(dashboard);
router.use(tenants);
router.use(ollama);
router.use(ops);
router.use(tickets);
router.use(users);
router.use(crossapp);
router.use(announcements);
router.use(gftv);
router.use(monitoring);

export default router;
EOF

echo "=== node --check ==="
for f in "$DIR"/shared.js "$DIR"/index.js $(for m in $modules; do echo "$DIR/$m.js"; done); do
  node --check "$f" && echo "ok: $f"
done

rm -rf "$DIR/_tmp"
echo "BUILD_DONE (superadmin.js untouched)"
