// ─────────────────────────────────────────────────────────────────────────────
// /admin/assets — Asset Library (re-export shim)
//
// This 1,930-line single file was split into a shared helper module + focused
// feature routers under ./assets/ (library, packs, generate, brandkit, folders,
// campaigns, resources, presets, optimize, describe) via an extract-and-shim
// refactor. This shim preserves the original import path (`./admin/assets.js`)
// so nothing upstream had to change.
//
// Verified at split time: body region byte-identical, route table 47/47 match.
// The pre-split original is preserved alongside as assets.js.prerefactor-* and
// in git history.
// ─────────────────────────────────────────────────────────────────────────────
export { default } from './assets/index.js';
