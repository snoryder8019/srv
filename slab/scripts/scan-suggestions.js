#!/usr/bin/env node
/**
 * scan-suggestions.js
 *
 * Reads the latest scan results from all tenants, analyzes each finding,
 * and prints actionable fix suggestions formatted for copy-paste into
 * VS Code / Claude Code.
 *
 * Usage: node scripts/scan-suggestions.js [--tenant <name>] [--severity critical,high]
 */

import { connectDB, getSlabDb, getTenantDb } from '../plugins/mongo.js';

// ── Fix suggestion database ─────────────────────────────────────────────────
// Maps finding title patterns to actionable fix suggestions with file paths

const FIX_MAP = [
  // Security: Auth bypass
  {
    match: /AUTH BYPASS.*unauthed/i,
    fix: (f) => `## AUTH BYPASS — ${f.url}
**Priority:** CRITICAL — unauthenticated access to protected route

**Fix:** Ensure \`requireAdmin\` middleware covers this route in \`routes/admin.js\`.
Check that the route is mounted AFTER the auth middleware block (line ~38).

\`\`\`
File: routes/admin.js
Action: Verify requireAdmin middleware is applied before this route mounts
\`\`\`

If it's a new route, confirm it's mounted inside the admin router (not app.js directly).`,
  },

  {
    match: /PRIVILEGE ESCALATION/i,
    fix: (f) => `## PRIVILEGE ESCALATION — ${f.url}
**Priority:** CRITICAL — regular admin accessing superadmin routes

**Fix:** Add \`checkSuperAdmin\` + guard to the route handler:
\`\`\`js
// In the route handler, add at the top:
if (!req.isSuperAdmin) return res.status(403).send('Access denied');
\`\`\`

\`\`\`
Files to check:
  routes/admin/super.js — ensure all handlers check req.isSuperAdmin
  routes/superadmin.js — ensure requireSuperAdmin middleware is applied
\`\`\``,
  },

  {
    match: /API auth bypass/i,
    fix: (f) => `## API AUTH BYPASS — ${f.url}
**Priority:** CRITICAL — API endpoint accessible without authentication

**Fix:** Add auth check at the top of the route handler:
\`\`\`js
const admin = tryDecodeAdmin(req);
if (!admin) return res.status(401).json({ error: 'Authentication required' });
\`\`\`

\`\`\`
File: Find the route handler for ${f.detail?.match(/(\S+)/)?.[1] || 'this endpoint'}
\`\`\``,
  },

  // Security: Exposed files
  {
    match: /EXPOSED FILE/i,
    fix: (f) => `## EXPOSED FILE — ${f.url}
**Priority:** CRITICAL — sensitive file served publicly

**Fix:** Block this path in Apache config or Express static middleware.

**Option A — Apache (recommended for prod):**
\`\`\`apache
# In /etc/apache2/sites-enabled/slab*.conf
<LocationMatch "^/(\.env|\.git|config|plugins|middleware|node_modules)">
    Require all denied
</LocationMatch>
\`\`\`

**Option B — Express (defense in depth):**
\`\`\`js
// In app.js, BEFORE express.static():
app.use((req, res, next) => {
  if (/^\\/(\\.|config|plugins|middleware|node_modules)/.test(req.path)) {
    return res.status(404).send('Not found');
  }
  next();
});
\`\`\`

\`\`\`
Files: /etc/apache2/sites-enabled/slab*.conf, app.js
\`\`\``,
  },

  // Security: Rate limiting
  {
    match: /No rate limiting on login/i,
    fix: () => `## NO RATE LIMITING ON LOGIN
**Priority:** HIGH — brute force attacks possible

**Fix:** Add express-rate-limit to login/register routes:
\`\`\`bash
cd /srv/slab && npm install express-rate-limit
\`\`\`
\`\`\`js
// In routes/admin.js, before login route:
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts per window
  message: 'Too many login attempts. Try again in 15 minutes.',
  standardHeaders: true,
});

router.post('/login', loginLimiter, async (req, res) => { ... });
router.post('/register', loginLimiter, async (req, res) => { ... });
\`\`\`

\`\`\`
File: routes/admin.js (lines ~100-175)
\`\`\``,
  },

  {
    match: /No rate limiting on registration/i,
    fix: () => `## NO RATE LIMITING ON REGISTRATION
**Priority:** MEDIUM — spam account creation possible

**Fix:** Same as login rate limiting — apply \`loginLimiter\` to POST /register.
See the login rate limiting fix above.

\`\`\`
File: routes/admin.js
\`\`\``,
  },

  // Security: Headers
  {
    match: /Missing security headers/i,
    fix: (f) => `## MISSING SECURITY HEADERS
**Priority:** MEDIUM

**Fix:** Add security headers middleware in app.js:
\`\`\`js
// In app.js, after express() but before routes:
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
\`\`\`

Missing: ${f.detail}

\`\`\`
File: app.js (add after line ~34, before routes)
\`\`\``,
  },

  // Security: Cookies
  {
    match: /Cookie missing/i,
    fix: (f) => `## COOKIE SECURITY — ${f.title}
**Priority:** ${f.severity.toUpperCase()}

**Fix:** Update cookie options in the JWT issuer and session config:

For session cookies (app.js):
\`\`\`js
cookie: {
  secure: true,        // ← ensure this is true in production
  httpOnly: true,
  sameSite: 'lax',
  domain: '.madladslab.com',
}
\`\`\`

For JWT cookies (middleware/jwtAuth.js):
\`\`\`js
res.cookie('slab_token', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: ...,
});
\`\`\`

\`\`\`
Files: app.js (session config ~line 37), middleware/jwtAuth.js (issueAdminJWT)
\`\`\``,
  },

  // Contrast
  {
    match: /Low contrast/i,
    fix: (f) => `## LOW CONTRAST — ${f.detail?.match(/selector: (.+)/)?.[1] || ''}
**Priority:** ${f.severity.toUpperCase()} — WCAG AA violation

${f.detail}

**Fix:** Adjust the color pairing in the tenant's design settings or CSS:
- If it's a brand color: update in /admin/design → Color palette
- If it's hardcoded CSS: find the selector \`${f.detail?.match(/selector: (.+)/)?.[1] || ''}\` in the EJS/CSS
- Use plugins/colorContrast.js \`readableTextColor(bgHex)\` for auto-computed text colors

\`\`\`
Files: plugins/colorContrast.js, views/ (search for the selector)
\`\`\``,
  },

  // Modals
  {
    match: /Modal target missing/i,
    fix: (f) => `## MISSING MODAL TARGET — ${f.detail}
**Priority:** CRITICAL — button/link triggers a modal that doesn't exist

**Fix:** Either add the missing modal HTML or fix the data-bs-target attribute:
\`\`\`
Search views/ for: ${f.detail?.match(/Target: (.+)/)?.[1] || 'the target ID'}
\`\`\``,
  },

  {
    match: /Modal has no close/i,
    fix: (f) => `## MODAL MISSING CLOSE BUTTON — ${f.detail}
**Priority:** HIGH — user can get trapped in modal

**Fix:** Add a close button to the modal header:
\`\`\`html
<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
\`\`\``,
  },

  // Route health
  {
    match: /Route unhealthy/i,
    fix: (f) => `## ROUTE UNHEALTHY — ${f.url}
**Priority:** ${f.severity.toUpperCase()}

${f.detail}

**Fix:** Check the route handler for errors. Run locally:
\`\`\`bash
curl -s -o /dev/null -w "%{http_code}" ${f.url}
\`\`\`
Then check tmux slab logs for the error stack trace.`,
  },

  {
    match: /Route unreachable/i,
    fix: (f) => `## ROUTE UNREACHABLE — ${f.url}
**Priority:** CRITICAL — route not responding at all

${f.detail}

**Fix:** Check if the service is running:
\`\`\`bash
tmux attach -t slab   # check for crashes
fuser 3602/tcp        # verify port is listening
\`\`\``,
  },

  {
    match: /Ollama/i,
    fix: (f) => `## OLLAMA ISSUE — ${f.title}
${f.detail}

**Fix:** Check Ollama infra:
\`\`\`bash
curl -s https://ollama.madladslab.com/health | jq .
\`\`\`
If GPUs are down, the remote machine may need a restart.`,
  },

  {
    match: /MCP endpoint/i,
    fix: (f) => `## MCP ENDPOINT — ${f.title}
${f.detail}

**Fix:** Verify master agent route loads:
\`\`\`bash
curl -s -X POST http://localhost:3602/admin/master-agent/mcp \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}' | jq .
\`\`\`
\`\`\`
File: routes/admin/masterAgent.js, plugins/agentMcp.js
\`\`\``,
  },

  // Redundancy
  {
    match: /Duplicate ID/i,
    fix: (f) => `## DUPLICATE ID — ${f.detail}
**Priority:** HIGH — duplicate IDs break JS selectors and accessibility

**Fix:** Search views for the duplicated ID:
\`\`\`bash
grep -rn '${f.detail?.match(/#(\w+)/)?.[1] || 'the-id'}' views/
\`\`\`
Rename one of the duplicates.`,
  },

  {
    match: /Broken anchor/i,
    fix: (f) => `## BROKEN ANCHOR — ${f.detail}
**Fix:** Either add the missing anchor target or update the href.`,
  },

  // JS errors
  {
    match: /JS console error/i,
    fix: (f) => `## JS ERROR on ${f.url}
\`\`\`
${f.detail}
\`\`\`
**Fix:** Open the page in a browser, check DevTools console, trace the error.`,
  },

  // Broken images
  {
    match: /Broken image/i,
    fix: (f) => `## BROKEN IMAGE — ${f.detail}
**Fix:** Check if the image URL is valid. Verify S3 bucket access and file exists.`,
  },

  // Stable Diffusion
  {
    match: /Stable Diffusion/i,
    fix: (f) => `## STABLE DIFFUSION DOWN
${f.detail}
**Fix:** SD runs on the Ollama GPU box. Check if the SD service is started.`,
  },
];

// ── Match finding to suggestion ─────────────────────────────────────────────
function getSuggestion(finding) {
  for (const rule of FIX_MAP) {
    if (rule.match.test(finding.title)) {
      return rule.fix(finding);
    }
  }
  // Fallback
  return `## ${finding.title}
**Severity:** ${finding.severity}
**URL:** ${finding.url}
**Detail:** ${finding.detail}

No specific fix mapped — investigate manually.`;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const tenantFilter = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
  const sevFilter = args.includes('--severity')
    ? args[args.indexOf('--severity') + 1]?.split(',')
    : ['critical', 'high'];

  await connectDB();
  const slab = getSlabDb();

  const query = { status: { $in: ['active', 'preview'] } };
  if (tenantFilter) query['brand.name'] = new RegExp(tenantFilter, 'i');

  const tenants = await slab.collection('tenants').find(query).toArray();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SLAB SCANNER — ACTIONABLE FIX SUGGESTIONS');
  console.log('  Copy-paste these into Claude Code / VS Code');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Severity filter: ${sevFilter.join(', ')}`);
  console.log(`  Tenants: ${tenants.map(t => t.brand?.name || t.domain).join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════');

  let totalFindings = 0;

  for (const tenant of tenants) {
    const label = tenant.brand?.name || tenant.domain;
    const db = getTenantDb(tenant.db);

    const latest = await db.collection('scan_results')
      .find({})
      .sort({ 'summary.scannedAt': -1 })
      .limit(1)
      .toArray();

    if (!latest.length) {
      console.log(`\n⏭  ${label} — no scan results found`);
      continue;
    }

    const scan = latest[0];
    const findings = (scan.findings || []).filter(f => sevFilter.includes(f.severity));

    if (!findings.length) {
      console.log(`\n✅ ${label} — no ${sevFilter.join('/')} findings`);
      continue;
    }

    console.log(`\n\n${'━'.repeat(65)}`);
    console.log(`  ${label.toUpperCase()} — ${findings.length} finding(s)`);
    console.log(`  Scanned: ${new Date(scan.summary?.scannedAt).toLocaleString()}`);
    console.log(`${'━'.repeat(65)}`);

    // Dedupe by title
    const seen = new Set();
    for (const f of findings) {
      const key = f.title + f.url;
      if (seen.has(key)) continue;
      seen.add(key);

      console.log('\n' + '─'.repeat(65));
      console.log(getSuggestion(f));
      totalFindings++;
    }
  }

  console.log('\n\n' + '═'.repeat(65));
  console.log(`  TOTAL: ${totalFindings} actionable suggestion(s)`);
  console.log('═'.repeat(65));
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
