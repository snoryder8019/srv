"""
blender-gen-mechs.py  -  Native-shape mech generator for Towers (TD)

Builds the four system mechs from Blender primitives and exports each as a
self-contained (embedded) glTF 2.0 into the Towers system asset dir, replacing
the procedural placeholders. Same slugs / paths the seed already points at, so
NOTHING downstream changes: re-run, hard-refresh the game, done.

RUN VIA BLENDER MCP
  Paste/execute this through the BlenderMCP `execute_code` tool, or headless:
    blender --background --python blender-gen-mechs.py

OUTPUT PATH
  Defaults to the live server dir. If your Blender is NOT on the games box,
  set MECH_OUT to a local folder and copy the .gltf files to:
    /srv/td/public/assets/gltf/system/
  Override with an env var:  MECH_OUT=/some/local/dir blender --background ...

CONTRACT (matches entities/tower.js fitTowerModel + aim group)
  - base sits on z=0 (Blender Z-up -> exports to y=0; renderer reseats anyway)
  - footprint roughly square (X ~= Y in Blender) so auto-fit won't squash it
  - FRONT faces -Y in Blender  ->  exports to -Z in three.js  == barrel forward
  If a model imports facing the wrong way, nudge FORWARD_FIX below by pi/2.
"""

import bpy, os, math

OUT_DIR = os.environ.get("MECH_OUT", "/srv/td/public/assets/gltf/system")
FORWARD_FIX = 0.0          # radians; add math.pi/2 increments if facing is off

# ---------------------------------------------------------------- helpers ----

def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for b in list(block):
            if b.users == 0:
                block.remove(b)

def mat(name, color, emission=0.0, metallic=0.3, rough=0.55):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    r, g, b = color
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    # Emission socket name differs across Blender versions; set whichever exists.
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    elif "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = (r, g, b, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return m

def last():                       # the object just created by an op
    return bpy.context.active_object

def setmat(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return obj

def cube(sx, sy, sz, loc, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = last(); o.scale = (sx, sy, sz); return setmat(o, m)

def cyl(r, h, loc, m, verts=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, vertices=verts)
    return setmat(last(), m)

def cone(r, h, loc, m, verts=8):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0, depth=h, location=loc, vertices=verts)
    return setmat(last(), m)

def sphere(r, loc, m, seg=16, ring=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring)
    return setmat(last(), m)

def ico(r, loc, m, subd=1):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=loc, subdivisions=subd)
    return setmat(last(), m)

def torus(rmaj, rmin, loc, m):
    bpy.ops.mesh.primitive_torus_add(major_radius=rmaj, minor_radius=rmin, location=loc,
                                     major_segments=16, minor_segments=8)
    return setmat(last(), m)

def export(slug, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if FORWARD_FIX:
        for p in parts:
            p.rotation_euler[2] += FORWARD_FIX
    os.makedirs(OUT_DIR, exist_ok=True)
    fp = os.path.join(OUT_DIR, slug + ".gltf")
    bpy.ops.export_scene.gltf(
        filepath=fp, export_format="GLTF_EMBEDDED",
        use_selection=True, export_apply=True, export_yup=True,
    )
    print("  exported", fp)

# ----------------------------------------------------------------- mechs -----

def build_bastion():
    """Kinetic - crenellated stone keep, stubby cannon."""
    stone = mat("m_stone", (0.42, 0.40, 0.38), metallic=0.1, rough=0.9)
    iron  = mat("m_iron",  (0.30, 0.32, 0.36), metallic=0.7, rough=0.4)
    parts = []
    parts.append(cyl(0.55, 0.9, (0, 0, 0.45), stone, verts=10))        # keep body
    parts.append(cyl(0.6, 0.18, (0, 0, 0.95), stone, verts=10))        # rim
    for i in range(8):                                                 # crenellations
        a = (i / 8) * math.tau
        parts.append(cube(0.16, 0.16, 0.22, (math.cos(a)*0.5, math.sin(a)*0.5, 1.12), stone))
    barrel = cyl(0.12, 0.7, (0, -0.45, 0.85), iron, verts=10)          # cannon, -Y = front
    barrel.rotation_euler[0] = math.pi/2
    parts.append(barrel)
    return parts

def build_arc_coil():
    """Energy - tesla emitter, stacked coils, glowing top."""
    base  = mat("m_coilbase", (0.18, 0.20, 0.24), metallic=0.6, rough=0.4)
    cu    = mat("m_copper",   (0.72, 0.45, 0.20), metallic=0.9, rough=0.3)
    glow  = mat("m_arc",      (0.20, 0.85, 1.0),  emission=6.0, metallic=0.0, rough=0.2)
    parts = []
    parts.append(cyl(0.5, 0.22, (0, 0, 0.11), base, verts=12))         # plinth
    parts.append(cyl(0.1, 1.0, (0, 0, 0.7), base, verts=10))           # core rod
    for i, z in enumerate((0.45, 0.7, 0.95)):                          # copper rings
        parts.append(torus(0.26 - i*0.05, 0.05, (0, 0, z), cu))
    parts.append(ico(0.22, (0, 0, 1.28), glow, subd=1))               # discharge node
    return parts

def build_spire():
    """Special - crystal lance, tall faceted, devastating single shots."""
    base   = mat("m_spirebase", (0.16, 0.14, 0.22), metallic=0.5, rough=0.5)
    cryst  = mat("m_crystal",   (0.65, 0.35, 0.95), emission=3.5, metallic=0.1, rough=0.15)
    parts = []
    parts.append(cone(0.5, 0.3, (0, 0, 0.15), base, verts=6))          # footing
    parts.append(cone(0.28, 1.6, (0, 0, 1.0), cryst, verts=6))         # main lance
    parts.append(ico(0.16, (0, 0, 0.55), cryst, subd=1))              # floating shard
    parts.append(ico(0.12, (0.22, 0.0, 0.4), cryst, subd=1))
    return parts

def build_bunker():
    """Support - low dug-in dome turret, cheap and reliable."""
    armor = mat("m_armor", (0.30, 0.33, 0.22), metallic=0.4, rough=0.7)  # olive
    steel = mat("m_steel", (0.22, 0.24, 0.26), metallic=0.8, rough=0.35)
    parts = []
    dome = sphere(0.6, (0, 0, 0.1), armor, seg=16, ring=6)             # dome (low)
    dome.scale = (1.0, 1.0, 0.6)
    parts.append(dome)
    parts.append(cyl(0.62, 0.15, (0, 0, 0.07), steel, verts=12))       # skirt
    barrel = cyl(0.07, 0.6, (0, -0.4, 0.32), steel, verts=8)           # barrel, -Y front
    barrel.rotation_euler[0] = math.pi/2
    parts.append(barrel)
    return parts

MECHS = {
    "bastion":  build_bastion,
    "arc-coil": build_arc_coil,
    "spire":    build_spire,
    "bunker":   build_bunker,
}

def main():
    print("Generating", len(MECHS), "mechs ->", OUT_DIR)
    for slug, builder in MECHS.items():
        reset_scene()
        parts = builder()
        export(slug, parts)
    print("Done. Hard-refresh the game; towers now load your meshes.")

if __name__ == "__main__":
    main()
