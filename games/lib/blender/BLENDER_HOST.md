# Blender host activation — model scope generator

The admin tool at `games.madladslab.com/blender` generates 3D models from a
prompt. It runs in one of three modes, chosen automatically per request and
shown as a badge in the tool header:

| Mode | When | Output |
|---|---|---|
| `blender-local` | env `BLENDER_BIN` set | real bpy art via headless Blender |
| `blender-remote` | env `BLENDER_MCP_URL` set | real bpy art via a relay |
| `procedural` | neither set (default today) | dependency-free parametric GLB |

All three write the same `.glb` to `/srv/_shared/assets/models/<category>/` and
record the same metadata; only the `source` field differs.

## Option A — local headless Blender (preferred, same filesystem)
1. Install Blender on the games box (headless is fine), e.g. a portable build.
2. Add to `/srv/games/.env`:
       BLENDER_BIN=/opt/blender/blender
3. Restart games. The tool badge flips to **Blender (local)**.

The store invokes:
    blender --background --python /srv/games/lib/blender/generate.py -- \
      --out <abs.glb> --kind <ship|mech|crystal|tower|prop> \
      --prompt "<text>" --color r,g,b
If a run fails or times out (180s), it falls back to procedural for that
request, so the tool never blocks.

## Option B — remote relay (Blender lives elsewhere)
Set `BLENDER_MCP_URL` to an HTTP endpoint that accepts
`POST {kind, prompt, color, out, script}` and returns either raw GLB bytes
(`Content-Type: model/gltf-binary`) or JSON `{ "glb_base64": "..." }`.
The relay can wrap a desktop Blender + BlenderMCP socket, or a cloud worker.

## The generator
`/srv/games/lib/blender/generate.py` — same conventions as
`td/scripts/blender-gen-mechs.py` (Z-up, front faces -Y, `export_apply=True`,
`export_yup=True`). `kind=ship` builds the full viking longship (rounded hull,
upswept dragon-head prow, mast, billowed sail with cream band, alternating
round shields). Extend `REGISTRY` to add kinds. Node↔Python agree on kind/color
via `_classify()` in `models3d.js`.
