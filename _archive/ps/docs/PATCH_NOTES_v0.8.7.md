# Patch Notes v0.8.7 - Critical Zone Template Fix

**Release Date:** November 5, 2025
**Commit:** f6ec015

---

## Critical Bug Fixes

### Zone Template EJS Syntax Error (HIGH PRIORITY)

**Issue:** Zone interior pages at `/universe/zone/:zoneId` were failing to load with the error:
- Browser console: `SyntaxError: expected property name, got '&'`
- Zone renderer: `❌ No zone data found`

**Root Cause:**
Line 166 in `views/universe/zone.ejs` used `<%= %>` (HTML-escaped) instead of `<%- %>` (raw output) for JSON serialization. This caused ampersands in JSON to be converted to `&amp;`, breaking JavaScript parsing.

**Before (BROKEN):**
```ejs
window.characterData = <%= character ? JSON.stringify(character) : 'null' %>;
```

**After (FIXED):**
```ejs
window.characterData = <%- character ? JSON.stringify(character) : 'null' %>;
```

**Impact:** All zone interior pages now load correctly. Players can properly enter starship colonies, stations, and anomaly interiors.

---

## Additional Improvements

### Socket.IO Integration
- Added Socket.IO client library to zone template head
- Enables real-time multiplayer functionality in zone interiors
- Supports player position synchronization

### Script Loading Optimization
- Implemented `defer` attribute for zone-renderer.js
- Ensures proper initialization order: data → libraries → renderer
- Prevents race conditions during page load

---

## Technical Details

### EJS Template Syntax
- `<%= expression %>` - HTML-escapes output (breaks JSON)
- `<%- expression %>` - Outputs raw content (required for JSON)

### Files Changed
- `views/universe/zone.ejs` (critical fix on line 166)
- Added Socket.IO client integration
- Enhanced zone rendering initialization

---

## Testing

**Tested Routes:**
- `/universe/zone/690a8ea829c03e47b2000138` - Loads successfully
- Zone data properly initialized in browser
- Character data correctly parsed
- Socket.IO client connects properly

**Browser Console:**
- No more JSON syntax errors
- `🌐 Zone data loaded into window` appears correctly
- `👤 Character data loaded` shows character name

---

## Developer Notes

**Key Lesson:** When embedding JSON in EJS templates, ALWAYS use `<%-` (unescaped) not `<%=` (HTML-escaped). HTML escaping converts special characters which breaks JSON parsing.

**Common Characters Affected:**
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`

All of these transformations will cause `JSON.parse()` or direct JavaScript evaluation to fail.

---

## Related Systems

This fix affects:
- Zone interior rendering system
- Multiplayer zone interactions
- Character-to-zone handoff
- Starship colony interiors
- Anomaly exploration
- Station interiors

---

## Contributors

- Scott (snoryder8019)
- Claude Code Assistant

---

**Previous Version:** [v0.8.6](PATCH_NOTES_v0.8.6.md)
**Next Version:** TBD
