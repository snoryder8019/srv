// ─────────────────────────────────────────────────────────────────────────────
// /admin/social — Social Media Portal (re-export shim)
//
// This 1,739-line single file was split into focused modules under ./social/
// (dashboard, live, engage, connections, compose, suggestions, voice, studio,
// oauth) via an extract-and-shim refactor. This shim preserves the original
// import path (`./admin/social.js`) so nothing upstream had to change.
//
// Verified at split time: route region byte-identical, route table 55/55 match.
// The pre-split original is preserved alongside as social.js.prerefactor-* and
// in git history.
// ─────────────────────────────────────────────────────────────────────────────
export { default } from './social/index.js';
