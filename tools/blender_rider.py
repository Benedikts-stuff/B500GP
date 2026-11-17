"""APEX rider parts, built in Blender. Game coordinates: x forward, y up, z right; Blender X = x, Y = -z, Z = y.
Pieces (each its own GLB, placed by the game's rider rig):
  torso  - hips at the origin, spine along +y (~0.5 m), chest faces +x, back -x
  helmet - centred at the origin, face towards +x
  limbs  - unit length along +y (0 = joint at the body side), real radii; rotationally symmetric so the rig can roll them freely
Material prefixes: T_suit / T_accent / T_dark / H_shell / H_accent / H_dark / H_visor, L_suit / L_dark.
The game recolours by prefix; the vertex colours carry baked ambient occlusion (limbs: 1 for suit, dark parts pre-darkened)."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

OUT = '/Users/benedikt/Desktop/Apex/blender/'
for sc in [s for s in bpy.data.scenes if s.name == 'Rider']: bpy.data.scenes.remove(sc)
for o in [o for o in bpy.data.objects if o.name.startswith('rd_')]: bpy.data.objects.remove(o)
scene = bpy.data.scenes.new('Rider')
try: bpy.context.window.scene = scene
except Exception: pass

def V(x, y, z=0.0): return Vector((x, -z, y))
MATS = {}
def mat(name, rgb=(0.8, 0.8, 0.8)):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*rgb, 1); MATS[name] = m; return m

PIECES = {}
def finish(bm, name, m, piece, angle=40):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('rd_' + name, me); scene.collection.objects.link(o); me.materials.append(m)
    bm = bmesh.new(); bm.from_mesh(me)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle): e.smooth = False
    bm.to_mesh(me); bm.free()
    PIECES.setdefault(piece, []).append(o); return o

def loft_y(name, secs, m, piece, ring=20, xform=None, capA=True, capB=True, angle=40):
    """sections along y: dict(y, x (centre fwd), w (half width z), df (half depth to +x), db (to -x), e)"""
    bm = bmesh.new(); rings = []
    for s in secs:
        e = s.get('e', 2.4); r = []
        for k in range(ring):
            a = k / ring * math.pi * 2; c, sn = math.cos(a), math.sin(a)
            xx = (s['df'] if c >= 0 else s['db']) * math.copysign(abs(c) ** (2 / e), c)
            zz = s['w'] * math.copysign(abs(sn) ** (2 / e), sn)
            p = V(s.get('x', 0) + xx, s['y'], zz)
            if xform: p = xform @ p
            r.append(bm.verts.new(p))
        rings.append(r)
    for i in range(len(rings) - 1):
        for k in range(ring): bm.faces.new([rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % ring], rings[i][(k + 1) % ring]])
    if capA: bm.faces.new(rings[0])
    if capB: bm.faces.new(list(reversed(rings[-1])))
    return finish(bm, name, m, piece, angle)

def lathe_y(name, prof, m, piece, seg=16, angle=60):
    """profile [(y, r)] revolved around the game y axis"""
    bm = bmesh.new(); rings = []
    for (y, r) in prof:
        rings.append([bm.verts.new(V(r * math.cos(k / seg * 6.2832), y, r * math.sin(k / seg * 6.2832))) for k in range(seg)] if r > 1e-5 else [bm.verts.new(V(0, y, 0))])
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        if len(A) == 1: [bm.faces.new([A[0], B[(k + 1) % seg], B[k]]) for k in range(seg)]
        elif len(B) == 1: [bm.faces.new([A[k], A[(k + 1) % seg], B[0]]) for k in range(seg)]
        else: [bm.faces.new([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]]) for k in range(seg)]
    return finish(bm, name, m, piece, angle)

def box(name, size, loc, m, piece, rot=(0, 0, 0), bevel=0.01):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) / 2.2), segments=2, affect='EDGES', profile=0.5)
    R = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Z') @ Matrix.Rotation(-rot[2], 4, 'Y')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(V(*loc)) @ R, verts=bm.verts)
    return finish(bm, name, m, piece, 35)

T_suit, T_accent, T_dark = mat('T_suit'), mat('T_accent'), mat('T_dark', (0.1, 0.1, 0.1))
H_shell, H_accent, H_dark, H_visor = mat('H_shell'), mat('H_accent'), mat('H_dark', (0.1, 0.1, 0.1)), mat('H_visor', (0.05, 0.05, 0.06))
L_suit, L_dark = mat('L_suit'), mat('L_dark', (0.1, 0.1, 0.1))

# ------------------------------------------------------------------ torso
loft_y('torso', [
    dict(y=-0.05, x=0.0, w=0.10, df=0.06, db=0.07), dict(y=0.0, x=0.0, w=0.16, df=0.10, db=0.10, e=2.6),
    dict(y=0.12, x=0.0, w=0.145, df=0.095, db=0.10, e=2.6), dict(y=0.26, x=0.005, w=0.17, df=0.11, db=0.105, e=2.8),
    dict(y=0.38, x=0.01, w=0.19, df=0.115, db=0.10, e=3.0), dict(y=0.47, x=0.01, w=0.185, df=0.10, db=0.095, e=3.0),
    dict(y=0.52, x=0.012, w=0.12, df=0.07, db=0.075, e=2.6), dict(y=0.555, x=0.015, w=0.055, df=0.045, db=0.045)], T_suit, 'torso', ring=22)
# aero hump on the back
loft_y('hump', [dict(y=0.20, x=-0.07, w=0.03, df=0.01, db=0.02), dict(y=0.30, x=-0.085, w=0.085, df=0.02, db=0.06, e=2.4),
                dict(y=0.44, x=-0.085, w=0.075, df=0.02, db=0.07, e=2.4), dict(y=0.535, x=-0.07, w=0.03, df=0.01, db=0.03)], T_accent, 'torso', ring=16)
# side stripes, shoulder armour, collar, belt and zip
for s in (-1, 1):
    loft_y('stripe%d' % s, [dict(y=0.02, x=0.0, w=0.006, df=0.035, db=0.035), dict(y=0.24, x=0.0, w=0.006, df=0.045, db=0.045), dict(y=0.42, x=0.0, w=0.006, df=0.05, db=0.05)],
           T_accent, 'torso', ring=8, xform=Matrix.Translation(V(0, 0, s * 0.172)))
    loft_y('shoulder%d' % s, [dict(y=0.40, x=0.0, w=0.045, df=0.06, db=0.06), dict(y=0.46, x=0.0, w=0.06, df=0.075, db=0.075, e=2.2), dict(y=0.51, x=0.0, w=0.04, df=0.05, db=0.05)],
           T_accent, 'torso', ring=14, xform=Matrix.Translation(V(0.0, 0, s * 0.17)))
loft_y('collar', [dict(y=0.52, x=0.012, w=0.075, df=0.06, db=0.06), dict(y=0.56, x=0.015, w=0.06, df=0.05, db=0.05)], T_dark, 'torso', ring=16, capA=False)
loft_y('belt', [dict(y=0.04, x=0.0, w=0.162, df=0.102, db=0.102, e=2.6), dict(y=0.08, x=0.0, w=0.156, df=0.099, db=0.101, e=2.6)], T_dark, 'torso', ring=22)
box('zip', (0.012, 0.36, 0.014), (0.112, 0.28, 0), T_dark, 'torso', bevel=0.004)

# ------------------------------------------------------------------ helmet (shell ~0.18 x 0.16 x 0.15 half extents)
loft_y('shell', [
    dict(y=-0.135, x=-0.01, w=0.085, df=0.095, db=0.1, e=2.2), dict(y=-0.10, x=-0.005, w=0.135, df=0.15, db=0.16, e=2.4),
    dict(y=-0.03, x=0.0, w=0.152, df=0.175, db=0.18, e=2.4), dict(y=0.05, x=-0.005, w=0.148, df=0.165, db=0.18, e=2.3),
    dict(y=0.11, x=-0.015, w=0.12, df=0.13, db=0.15, e=2.2), dict(y=0.15, x=-0.02, w=0.07, df=0.08, db=0.095, e=2.0), dict(y=0.165, x=-0.02, w=0.01, df=0.012, db=0.015)],
    H_shell, 'helmet', ring=28, angle=50)
# visor: a curved dark band over the face opening, proud of the shell
loft_y('visor', [dict(y=-0.035, x=0.03, w=0.128, df=0.152, db=0.0, e=2.6), dict(y=0.0, x=0.03, w=0.136, df=0.158, db=0.0, e=2.6),
                 dict(y=0.045, x=0.025, w=0.13, df=0.148, db=0.0, e=2.6)], H_visor, 'helmet', ring=28, capA=False, capB=False, angle=60)
box('chinbar', (0.07, 0.05, 0.17), (0.155, -0.085, 0), H_dark, 'helmet', rot=(0, 0, -0.25), bevel=0.02)
loft_y('spoiler', [dict(y=0.04, x=-0.16, w=0.015, df=0.01, db=0.02), dict(y=0.075, x=-0.175, w=0.08, df=0.02, db=0.045, e=2.2), dict(y=0.105, x=-0.16, w=0.06, df=0.02, db=0.03)],
       H_accent, 'helmet', ring=12)
for s in (-1, 1):
    box('vent%d' % s, (0.05, 0.016, 0.025), (0.08, 0.128, s * 0.045), H_dark, 'helmet', rot=(0, 0, -0.5), bevel=0.006)
    box('pivot%d' % s, (0.04, 0.04, 0.02), (0.085, 0.0, s * 0.146), H_accent, 'helmet', bevel=0.008)
loft_y('stripeH', [dict(y=0.11, x=-0.015, w=0.03, df=0.132, db=0.152, e=2.2), dict(y=0.135, x=-0.018, w=0.03, df=0.1, db=0.12, e=2.2)], H_accent, 'helmet', ring=24, capA=False, capB=False)

# ------------------------------------------------------------------ limbs (unit length along +y)
lathe_y('uparm', [(0.0, 0.0), (0.0, 0.07), (0.25, 0.076), (0.6, 0.068), (0.9, 0.062), (1.0, 0.058), (1.0, 0.0)], L_suit, 'uparm', 18)
lathe_y('foarm', [(0.0, 0.0), (0.0, 0.06), (0.3, 0.062), (0.72, 0.052), (0.74, 0.06), (1.0, 0.056), (1.0, 0.0)], L_suit, 'foarm', 18)
lathe_y('foarm_glove', [(0.72, 0.0605), (0.74, 0.061), (1.0, 0.057), (1.02, 0.0)], L_dark, 'foarm', 18)
lathe_y('thigh', [(0.0, 0.0), (0.0, 0.10), (0.2, 0.108), (0.55, 0.098), (0.85, 0.084), (1.0, 0.078), (1.0, 0.0)], L_suit, 'thigh', 20)
lathe_y('shin', [(0.0, 0.0), (0.0, 0.077), (0.25, 0.08), (0.5, 0.068), (0.52, 0.0)], L_suit, 'shin', 20)
lathe_y('shin_boot', [(0.48, 0.0), (0.48, 0.074), (0.52, 0.076), (0.8, 0.066), (1.0, 0.062), (1.02, 0.0)], L_dark, 'shin', 20)
lathe_y('shin_toe', [(0.62, 0.0), (0.62, 0.078), (0.66, 0.079), (0.7, 0.0)], L_suit, 'shin', 20)    # coloured boot cuff

# lay the pieces apart for the AO bake
offs = {'torso': (0, 0, 0), 'helmet': (1.0, 0, 0), 'uparm': (2, 0, 0), 'foarm': (2.5, 0, 0), 'thigh': (3, 0, 0), 'shin': (3.5, 0, 0)}
allo = [o for L in PIECES.values() for o in L]
for p, L in PIECES.items():
    for o in L: o.location = V(*offs[p])
for o in allo:
    me = o.data
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER'); me.color_attributes.active_color = ca
scene.render.engine = 'CYCLES'
try: scene.cycles.device = 'GPU'
except Exception: pass
scene.cycles.samples = 96
if not scene.world: scene.world = bpy.data.worlds.new('rdW')
scene.world.light_settings.distance = 0.08
vl = bpy.context.view_layer
for o in scene.objects: o.select_set(False)
for o in allo: o.select_set(True)
vl.objects.active = allo[0]
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
for o in allo:
    m = o.data.materials[0].name; dark = m.endswith('_dark')
    for p in o.data.color_attributes['Col'].data:
        a = 0.45 + 0.55 * p.color[0]
        if m.startswith('L_'): a = 1.0                               # limbs: the instance colour carries the colour
        p.color = (a, a, a, 1)
res = {}
for p, L in PIECES.items():
    for o in L: o.location = (0, 0, 0)
    for sc2 in bpy.data.scenes:
        for vl2 in sc2.view_layers:
            for o in sc2.objects:
                try: o.select_set(False, view_layer=vl2)
                except Exception: pass
    for o in L: o.select_set(True)
    vl.objects.active = L[0]
    bpy.ops.export_scene.gltf(filepath=OUT + 'rider_' + p + '.glb', export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT')
    res[p] = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in L)
result = res
