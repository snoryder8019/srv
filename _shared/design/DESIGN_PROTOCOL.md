# MadLadsLab — Design Unification Protocol

Living spec for the shared token system. Source of truth: `/srv/_shared/design/tokens.css`.
Last updated: 2026-06-15.

## 1. Scope — what unifies, what doesn't

| App | Status | Notes |
|---|---|---|
| opsTrain | ✅ retrofit complete | reference impl; dev mode (no restart) |
| graffiti-tv | ✅ chrome retrofit complete | 4 chrome views; 16 themes excluded; prod (restart needed) |
| greealitytv | ⏳ blocked | vhost needs update + domain provisioning into slab first |
| games | ⏳ pending | CHROME only — arcade skins stay local |
| servers | ⛔ not running | port 3600 taken by cards arcade; revisit if revived |
| slab | ⛔ excluded | deliberate own design system |

**Chrome vs. skin.** Unify *application chrome* (nav, buttons, forms, tables, dashboards, admin).
Leave *skins* alone: slab, game arcade skins, and graffiti-tv's theme files. The boundary can
run *inside* one app (graffiti-tv: admin views unified, theme files not).

## 2. Canonical vocabulary

Defined once in `tokens.css`. Role-based names, not appearance-based.
- Brand: `--brand` (gold `#e3c567`), `--brand-strong`, `--brand-soft`, `--on-brand`, `--ring`
- Surfaces (dark ladder): `--bg` → `--surface` → `--surface-2` → `--surface-3`; `--border`, `--border-strong`
- Text: `--text`, `--text-muted`, `--text-faint`
- Semantic: `--success`, `--warning`, `--danger`, `--info`
- Scale: `--radius*`, `--space-1..6`, `--shadow*`, `--font-*`, type sizes, `--tap`

**`--brand` is the single override point.** Change it once; buttons, gradients (`--brand-strong`),
tints (`--brand-soft`/`color-mix`), focus rings, and chart series all move together.

## 3. The retrofit recipe

1. **Sync** `cp /srv/_shared/design/tokens.css <app>/public/css/tokens.css`
2. **Link it first** — before the app's own CSS, in the layout head (or each chrome view if no shared head).
3. **Alias the app's `:root`** to canonical names instead of redefining colors:
   `--primary: var(--brand)`, `--card: var(--surface-2)`, `--muted: var(--text-muted)`, etc.
   Same-named tokens (`--bg`, `--text`, `--border`) just inherit — don't redeclare (avoids `--bg: var(--bg)` cycles).
   This flips all existing `var(--…)` call sites with no edits to them.
4. **Tokenize page-level inline styles** that aliasing can't reach (standalone CTAs, landing pages):
   swap hardcoded hex to `var(--…)`. Status backgrounds → `color-mix(in srgb, var(--success) 16%, var(--surface))`.
5. **Charts** (canvas, unreachable by CSS): read tokens at runtime —
   `getComputedStyle(document.documentElement).getPropertyValue('--brand')` → feed `Chart.defaults` + series.
6. **Restart if production** (see §6), then **verify via the REAL domain** (see §5).

### Structural variants
- *Has a stylesheet* (opsTrain): alias the one `style.css :root`. Cleanest.
- *All-inline, no shared head* (graffiti-tv): add link + alias `:root` per chrome view.

## 4. Three binding mechanisms
1. **CSS cascade** — class-styled chrome flows through the `:root` aliases automatically (the bulk).
2. **Direct tokenization** — inline page `<style>` blocks: swap hex → `var()`.
3. **Runtime JS read** — canvas/charts: read the token value and inject into the chart config.

## 5. Domains come from Apache, NOT the registry
`.claude-context.json` and `master_index.md` are STALE. Confirmed wrong domains so far:
- opsTrain → real: `ops-train.madladslab.com` (registry said `opstrain…`)
- greealitytv → real: `greealitytv.com` (registry said `…madladslab.com`)
- graffiti-tv → real: `graffititv.madladslab.com` (registry said `graffiti…`)

Always resolve the live domain + backend port from `/etc/apache2/sites-enabled/*` (`ServerName` + `ProxyPass`).

## 6. Ops rules
- **dev vs prod:** dev (`NODE_ENV=development`) reflects EJS edits instantly. prod caches views → must restart.
- **Restart safely:** services whose tmux pane runs the start command *directly* die on `Ctrl-C`.
  Run them in a **persistent shell** session instead:
  `tmux new-session -d -s <session> -c <dir>` then `tmux send-keys -t <session> "npm start" Enter`.
- **Back up before edits:** `cp file file.bak.$(date +%s)` (matches existing `.bak` convention).

## 7. Known residue & open decisions
- **Intentional residue:** pure whites (`#fff`), brand-locked third-party UI (Google button `#333`/`#f0f0f0`).
- **Open decision — categorical palette:** chart-series + role-badge hues (purples/pinks) are neither brand
  nor semantic. Either add a `--c-1..n` set to `tokens.css` or accept them as app-local. Currently app-local.
- **Per-tenant/per-app brand override:** route the dynamic color through `--brand`
  (e.g. graffiti-tv tenant-admin: `--brand: <%- tenant.branding.color || '#e3c567' %>`).

## 8. Measuring progress
Re-run `node /srv/scripts/design-audit.cjs` → `design-audit.json`. Track per-file hardcoded-hex count
down and `var(--token)` references up. Note: app-dir hex *rises* slightly when `tokens.css` lands
(its palette definitions are counted) — measure the app's own stylesheet/views, not the dir total.
