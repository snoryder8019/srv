# Shared 3D Model Scope

Canonical, cross-app home for volumetric (L3/L4) assets per BLENDER_SD_PROTOCOL.md.
Served read-only to every first-party app at:  /shared/assets/models/<category>/<file>.glb

Managed by the admin Blender tool at: games.madladslab.com/blender
  - tree browser + GLB viewer
  - CRUD models from a text prompt
Metadata (prompt, tags, source) lives in Mongo collection `models3d`.

Categories: ships/ mechs/ props/ npcs/ _generated/
Fit contract: base on y=0, front faces -Z, roughly square footprint.
Source tags: blender (bpy host) | procedural (dependency-free fallback) | upload
