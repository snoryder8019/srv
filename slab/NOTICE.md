# Third-Party Notices — Slab platform

This proprietary software depends on open-source components. License summary
from a full transitive audit (license-checker, July 7, 2026 — 567 packages):

- MIT: 342 · Apache-2.0: 124 · ISC: 56 · BSD-2/3-Clause: 30 · other permissive: 12

## Items of note

- **@imgly/background-removal 1.7.0 — AGPL-3.0.** ⚠ OPEN ITEM. Used client-side
  by the asset/social design tool (served from /vendor/imgly). AGPL network
  copyleft applies to SaaS distribution. Remediation decided: replace with
  self-hosted rembg (MIT) + U2Net (Apache-2.0) on the GPU inference node, or
  purchase an img.ly commercial license. Do not ship new features on this
  dependency until resolved.
- **sharp / @img/sharp-libvips — LGPL-3.0 (libvips).** OK: dynamically linked
  prebuilt system library; standard commercial use; no copyleft obligation on
  application code.
- **mongodb (Node driver) — Apache-2.0.** OK. MongoDB *server* is SSPL; used
  internally to run our own service (self-hosted + Atlas), not resold as a
  database service — permitted use. Position documented here intentionally.
- **Model weights:** Qwen2.5-7B — Apache-2.0 (OK). Stable Diffusion checkpoints —
  CreativeML OpenRAIL-M; verify the exact checkpoint license before commercial
  image-generation launch. ⚠ VERIFY.

Full machine-readable inventory: run `npx license-checker --json` at repo root.
