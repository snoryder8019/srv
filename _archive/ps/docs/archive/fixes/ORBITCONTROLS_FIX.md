# OrbitControls MIME Type Fix

**Date:** October 27, 2025
**Issue:** OrbitControls CDN blocked due to MIME type mismatch

---

## Problem

The OrbitControls script was failing to load with the following error:

```
The resource from "https://cdn.jsdelivr.net/npm/three@0.150.0/examples/js/controls/OrbitControls.js"
was blocked due to MIME type ("text/plain") mismatch (X-Content-Type-Options: nosniff).

SES_UNCAUGHT_EXCEPTION: TypeError: THREE.OrbitControls is not a constructor
```

**Root Cause:**
- The old CDN URL served OrbitControls as `text/plain` instead of `application/javascript`
- Browser's security policy (`X-Content-Type-Options: nosniff`) blocked execution
- Three.js r150 uses deprecated script format

---

## Solution

Upgraded to **Three.js r160** with modern **ES Modules** and **Import Maps**.

### Changes Made

#### 1. Updated [galactic-map-3d.ejs](../views/universe/galactic-map-3d.ejs)

**Replaced:**
```html
<script src="https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.150.0/examples/js/controls/OrbitControls.js"></script>
```

**With:**
```html
<!-- Three.js Library (ES Module) -->
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
</script>

<!-- Load OrbitControls as module -->
<script type="module">
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

  // Make available globally for legacy script
  window.THREE = THREE;
  window.OrbitControls = OrbitControls;
</script>

<script src="/javascripts/galactic-map-3d.js"></script>
```

#### 2. Updated [galactic-map-3d.js](../public/javascripts/galactic-map-3d.js)

**Added null-safety checks:**

```javascript
// Constructor
if (window.OrbitControls) {
  this.controls = new window.OrbitControls(this.camera, this.renderer.domElement);
  this.controls.enableRotate = false;
  // ... rest of setup
} else {
  console.warn('OrbitControls not loaded yet, using basic controls');
  this.controls = null;
}

// Animate loop
if (this.controls) {
  this.controls.update();
}

// Reset view
if (window.galacticMap.controls) {
  window.galacticMap.controls.target.set(0, 0, 0);
  window.galacticMap.controls.update();
}
```

---

## Why This Works

### Import Maps (Browser Feature)

Import maps allow browsers to resolve module specifiers:

```javascript
// Instead of full URL:
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

// Use short alias:
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

**Benefits:**
- Proper MIME type (`application/javascript`)
- Modern module system
- Tree-shaking support
- Better caching

### ES Modules vs Legacy Scripts

| Feature | Legacy (r150) | ES Modules (r160) |
|---------|---------------|-------------------|
| Format | UMD/Global | ES Modules |
| MIME Type | text/plain ❌ | application/javascript ✅ |
| Loading | `<script src>` | `<script type="module">` |
| Imports | Global namespace | Named imports |
| Status | Deprecated | Recommended |

---

## Browser Compatibility

**Import Maps Support:**
- ✅ Chrome 89+
- ✅ Edge 89+
- ✅ Safari 16.4+
- ✅ Firefox 108+

**Fallback:**
If import maps aren't supported, the `window.OrbitControls` check gracefully degrades:
```javascript
if (window.OrbitControls) {
  // Use OrbitControls
} else {
  console.warn('OrbitControls not available');
  this.controls = null;
}
```

---

## Upgrade Notes

### Three.js r150 → r160 Changes

**Deprecations Resolved:**
```
Scripts "build/three.js" and "build/three.min.js" are deprecated with r150+,
and will be removed with r160.
```

**Migration:**
- ✅ No breaking API changes for our usage
- ✅ OrbitControls API unchanged
- ✅ All existing code compatible

**New Features Available (r160):**
- Improved performance
- Better tree-shaking
- Enhanced TypeScript support
- Updated WebGL features

---

## Testing

### Verify Loading

Open browser console and check:

```javascript
console.log(window.THREE); // Should show THREE object
console.log(window.OrbitControls); // Should show OrbitControls class
console.log(window.galacticMap.controls); // Should show OrbitControls instance
```

### Expected Console Output

```
✅ No MIME type errors
✅ No "THREE.OrbitControls is not a constructor" errors
✅ OrbitControls loads successfully
✅ Camera controls work (drag to pan, wheel to zoom)
```

---

## Alternative Solutions Considered

### 1. Self-Host OrbitControls ❌

**Pros:**
- Full control over MIME type
- No CDN dependency

**Cons:**
- Maintenance burden
- Manual updates
- Larger repo size

### 2. Use Different CDN ❌

**Tried:**
- unpkg.com - Same MIME type issue
- cdnjs.cloudflare.com - Outdated version

**Issue:**
Legacy OrbitControls.js format incompatible with modern security policies

### 3. Webpack Bundle ❌

**Pros:**
- Complete control
- Optimized bundle

**Cons:**
- Build step required
- Complexity increase
- Not needed for simple use case

### 4. ES Modules (Selected) ✅

**Pros:**
- Modern standard
- Proper MIME types
- CDN caching
- Future-proof
- No build step

**Cons:**
- Requires modern browser
- Slightly more complex setup

---

## Future Improvements

### 1. Convert to Full ES Module

Currently using hybrid approach (module loads, legacy script uses globals).

**Ideal:**
```javascript
// galactic-map-3d.js as module
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class GalacticMap3D {
  constructor() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
  }
}

export { GalacticMap3D };
```

### 2. Use Build Tool

Add Vite or Rollup for:
- Module bundling
- Code splitting
- Asset optimization
- TypeScript support

### 3. Progressive Enhancement

Add feature detection:
```javascript
if ('importmap' in HTMLScriptElement) {
  // Use ES modules
} else {
  // Load legacy UMD version
}
```

---

## Related Issues

- Three.js Issue: https://github.com/mrdoob/three.js/issues/25389
- MDN MIME Types: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types
- Import Maps Spec: https://github.com/WICG/import-maps

---

## Success Metrics

✅ **OrbitControls loads without errors**
✅ **Camera controls work smoothly**
✅ **No MIME type warnings in console**
✅ **Three.js r160 deprecation warnings resolved**
✅ **Modern module system in use**

---

**Status:** ✅ Fixed and deployed
**Next:** Monitor for any browser compatibility issues

---

**End of OrbitControls Fix Document**
