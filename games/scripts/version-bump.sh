#!/bin/bash
# version-bump.sh — Simple additive version bump for games-portal
# Usage: version-bump.sh [patch|minor]
# Default: patch (+0.0.1)
# Minor:   minor (+0.1.0)
# No rollover — 0.0.9 + 0.0.2 = 0.0.11 (simple integer addition)
# Also generates TLDR patch notes from git commits since last bump

PKG="/srv/games/package.json"
NOTES="/srv/games/patch-notes.json"
BUMP="${1:-patch}"

# Read current version
CURRENT=$(node -e "console.log(require('$PKG').version)")
MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)

if [ "$BUMP" = "minor" ]; then
  MINOR=$((MINOR + 1))
  PATCH=0
else
  PATCH=$((PATCH + 1))
fi

NEW="${MAJOR}.${MINOR}.${PATCH}"

# Gather git commits since last bump (look for last patch-notes entry timestamp, or 24h ago)
SINCE="24 hours ago"
if [ -f "$NOTES" ]; then
  LAST_DATE=$(node -e "
    var n = JSON.parse(require('fs').readFileSync('$NOTES','utf8'));
    if (n.length) console.log(n[n.length-1].date);
  " 2>/dev/null)
  if [ -n "$LAST_DATE" ]; then
    SINCE="$LAST_DATE"
  fi
fi

# Get commit summaries touching games/ since last bump
COMMITS=$(cd /srv && git log --oneline --since="$SINCE" -- games/ 2>/dev/null | head -20)

# Build the TLDR from commit messages
if [ -n "$COMMITS" ]; then
  TLDR=$(echo "$COMMITS" | sed 's/^[a-f0-9]* //' | while read -r line; do echo "- $line"; done)
else
  TLDR="- Maintenance & stability updates"
fi

# Update package.json and append to patch-notes.json
node -e "
  var fs = require('fs');

  // Bump version
  var pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
  pkg.version = '$NEW';
  fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');

  // Append patch note
  var notes = [];
  try { notes = JSON.parse(fs.readFileSync('$NOTES', 'utf8')); } catch(e) {}
  var tldr = $(echo "$TLDR" | node -e "
    var lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
    console.log(JSON.stringify(lines));
  ");
  notes.push({
    version: '$NEW',
    prev: '$CURRENT',
    bump: '$BUMP',
    date: new Date().toISOString(),
    tldr: tldr
  });
  // Keep last 100 entries
  if (notes.length > 100) notes = notes.slice(-100);
  fs.writeFileSync('$NOTES', JSON.stringify(notes, null, 2) + '\n');
"

echo "[version-bump] $CURRENT -> $NEW ($BUMP)"
echo "[patch-notes] $(echo "$TLDR" | wc -l) items logged"
