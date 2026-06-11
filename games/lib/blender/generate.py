"""
generate.py  —  Blender bpy generator for the shared model scope.

Driven by the games model store (lib/models3d.js) when a Blender host is
available. Same conventions as td/scripts/blender-gen-mechs.py:
  - Blender is Z-up; base sits on z=0  -> exports to y=0 (renderer reseats).
  - FRONT faces -Y in Blender  -> exports to -Z in three.js.
  - export_apply=True bakes modifiers; export_yup=True for three.js.

RUN
  headless:   blender --background --python generate.py -- --out /path/x.glb \
                --kind ship --prompt "viking longship with sails" --color 0.45,0.27,0.14
  or via a BlenderMCP execute_code relay that forwards the same argv contract.

KINDS
  ship -> full viking longship (hull, dragon prow, mast, billowed sail, shields)
  mech | crystal | tower | prop -> simple primitive stand-ins (so the Blender
  path can serve any prompt, not only ships). Extend the REGISTRY to add more.
"""

import bpy, bmesh, os, sys, math, argparse


# ----------------------------------------------------------------- args ------
def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--kind", default="prop")
    p.add_argument("--prompt", default="")
    p.add_argument("--color", default="0.6,0.6,0.64")  # hull/base RGB 0..1
    p.add_argument("--seed", type=int, default=0)
    return p.parse_args(argv)


# --------------------------------------------------------------- helpers -----
def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def mat(name, color, emission=0.0, metallic=0.3, rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    r, g, b = color
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    elif "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = (r, g, b, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return m


def last():
    return bpy.context.active_object


def setmat(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return obj


def cube(sx, sy, sz, loc, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = last(); o.scale = (sx, sy, sz); return setmat(o, m)


def cyl(r, h, loc, m, verts=16, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, vertices=verts)
    o = last(); o.rotation_euler = rot; return setmat(o, m)


def cone(r, h, loc, m, verts=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0, depth=h, location=loc, vertices=verts)
    o = last(); o.rotation_euler = rot; return setmat(o, m)


def sphere(r, loc, m, seg=16, ring=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=ring)
    return setmat(last(), m)


def add_modifier_round(obj, bevel=0.08, subsurf=1):
    bw = obj.modifiers.new("bev", "BEVEL"); bw.width = bevel; bw.segments = 2
    if subsurf:
        ss = obj.modifiers.new("ss", "SUBSURF"); ss.levels = subsurf; ss.render_levels = subsurf


# --------------------------------------------------------------- builders ----
def build_ship(color, prompt):
    """Viking longship: hull + dragon prow + mast + billowed sail + shields."""
    wood = mat("m_hull", color, metallic=0.05, rough=0.85)
    dark = mat("m_keel", (color[0] * 0.6, color[1] * 0.6, color[2] * 0.6), rough=0.9)
    sailc = mat("m_sail", (0.72, 0.16, 0.14) if "blue" not in prompt else (0.16, 0.3, 0.62), rough=0.8)
    band = mat("m_band", (0.93, 0.9, 0.82), rough=0.8)
    gold = mat("m_gold", (0.82, 0.66, 0.28), metallic=0.9, rough=0.3)
    sh_a = mat("m_sh_a", (0.85, 0.7, 0.25), rough=0.6)
    sh_b = mat("m_sh_b", (0.6, 0.18, 0.16), rough=0.6)
    parts = []

    # hull — rounded, long along Y (front = -Y)
    hull = cube(0.55, 1.7, 0.42, (0, 0, 0.42), wood)
    add_modifier_round(hull, bevel=0.14, subsurf=1)
    parts.append(hull)
    parts.append(cube(0.12, 3.0, 0.12, (0, 0, 0.12), dark))   # keel
    parts.append(cube(1.05, 0.16, 0.16, (0, 0, 0.66), dark))  # gunwale trim (fore)

    # upswept prow (-Y) and stern (+Y)
    prow = cone(0.16, 1.1, (0, -1.7, 0.95), wood, verts=10, rot=(math.radians(125), 0, 0))
    parts.append(prow)
    stern = cone(0.14, 0.9, (0, 1.65, 0.9), wood, verts=10, rot=(math.radians(-125), 0, 0))
    parts.append(stern)
    # dragon head at the prow tip
    parts.append(sphere(0.16, (0, -2.05, 1.25), gold, seg=12, ring=8))
    parts.append(cone(0.09, 0.3, (0, -2.25, 1.28), gold, verts=8, rot=(math.radians(90), 0, 0)))  # snout
    parts.append(cone(0.05, 0.18, (-0.08, -1.98, 1.42), gold, verts=6))  # horn L
    parts.append(cone(0.05, 0.18, (0.08, -1.98, 1.42), gold, verts=6))   # horn R

    # mast + yard
    parts.append(cyl(0.06, 2.2, (0, 0, 1.7), dark, verts=10))
    parts.append(cyl(0.04, 1.7, (0, 0, 2.55), dark, verts=8, rot=(0, math.radians(90), 0)))  # yard

    # billowed sail — subdivided grid in X-Z plane, sine displacement along Y
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=12, y_subdivisions=8, size=1,
                                    location=(0, 0, 1.95))
    sail = last()
    sail.scale = (0.8, 1.0, 0.62)
    sail.rotation_euler = (math.radians(90), 0, 0)  # stand it up, face -Y
    me = sail.data
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        # billow: push along local normal (post-rotation that's ±Y); use x,z phase
        billow = math.sin((v.co.x + 0.5) * math.pi) * math.cos(v.co.y * 1.2) * 0.18
        v.co.y += billow
    bm.to_mesh(me); bm.free()
    setmat(sail, sailc)
    parts.append(sail)
    parts.append(cube(1.62, 0.02, 0.12, (0, -0.02, 1.95), band))  # cream stripe across sail

    # round shields along both gunwales, alternating colors
    ys = [-1.1, -0.55, 0.0, 0.55, 1.1]
    for i, y in enumerate(ys):
        m = sh_a if i % 2 == 0 else sh_b
        parts.append(cyl(0.17, 0.05, (-0.56, y, 0.62), m, verts=12, rot=(0, math.radians(90), 0)))
        parts.append(cyl(0.17, 0.05, (0.56, y, 0.62), (sh_b if i % 2 == 0 else sh_a), verts=12, rot=(0, math.radians(90), 0)))
    return parts


def build_mech(color, prompt):
    steel = mat("m_steel", color, metallic=0.7, rough=0.4)
    parts = [
        cube(0.4, 0.35, 0.8, (-0.3, 0, 0.4), steel),
        cube(0.4, 0.35, 0.8, (0.3, 0, 0.4), steel),
        cube(1.0, 0.6, 0.8, (0, 0, 1.15), steel),
        cube(0.4, 0.4, 0.4, (0, -0.05, 1.75), steel),
        cube(0.25, 0.25, 0.7, (-0.7, 0, 1.15), steel),
        cube(0.25, 0.25, 0.7, (0.7, 0, 1.15), steel),
    ]
    for p in parts:
        add_modifier_round(p, bevel=0.04, subsurf=0)
    return parts


def build_crystal(color, prompt):
    glow = mat("m_crystal", color, emission=2.0, metallic=0.1, rough=0.15)
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.8, subdivisions=1, location=(0, 0, 0.9))
    o = last(); o.scale = (0.7, 0.7, 1.4)
    return [setmat(o, glow)]


def build_tower(color, prompt):
    stone = mat("m_stone", color, rough=0.9)
    parts = [cube(0.7, 0.7, 1.8, (0, 0, 0.9), stone), cube(0.95, 0.95, 0.4, (0, 0, 2.0), stone)]
    for p in parts:
        add_modifier_round(p, bevel=0.05, subsurf=0)
    return parts


def build_prop(color, prompt):
    c = mat("m_prop", color, rough=0.7)
    o = cube(1, 1, 1, (0, 0, 0.5), c)
    add_modifier_round(o, bevel=0.06, subsurf=1)
    return [o]


REGISTRY = {
    "ship": build_ship, "mech": build_mech, "crystal": build_crystal,
    "tower": build_tower, "prop": build_prop,
}


# --------------------------------------------------------------- export ------
def export_glb(out, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB",
        use_selection=True, export_apply=True, export_yup=True,
    )
    print("exported", out)


def main():
    a = parse_args()
    try:
        color = tuple(float(x) for x in a.color.split(","))[:3]
        if len(color) != 3:
            color = (0.6, 0.6, 0.64)
    except Exception:
        color = (0.6, 0.6, 0.64)
    builder = REGISTRY.get(a.kind, build_prop)
    reset_scene()
    parts = builder(color, (a.prompt or "").lower())
    export_glb(a.out, parts)
    print("OK", a.kind, "->", a.out)


if __name__ == "__main__":
    main()
