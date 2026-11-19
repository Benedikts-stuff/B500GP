"""APEX superbike (STRADA V4), built in Blender for the game.
Game coordinates: x forward, y up, z lateral (right = +z). Blender: X = x, Y = -z, Z = y.
Assemblies (exported separately so the game can animate them):
  body  - frame, engine, bodywork, swingarm, exhaust, seat (bike coordinates)
  front - fork, triple clamp, clip-ons, calipers, fender (bike coordinates; steered around the steering head)
  wheelF / wheelR - centred on their axle, axle along z
Material name prefixes tell the game which shader to use: P_ livery paint, M_ matte, X_ metal, G_ gloss, S_ screen.
Ambient occlusion is baked into the vertex colours (multiplied with the base colour, except for P_ which keeps AO only)."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

OUT = '/Users/benedikt/Desktop/Apex/blender/'
VARIANT = globals().get('VARIANT', 'strada')          # 'strada' (faired superbike), 'duetto' (naked twin), 'super' (modern supersport, own design)
NAKED = VARIANT == 'duetto'; CORSA = VARIANT == 'corsa'; SUPER = VARIANT in ('super', 'corsa')   # corsa: the 600 supersport, built on the same layout
WB = 1.42 if (NAKED or SUPER) else 1.45; HX = WB / 2; RR, RF = 0.325, 0.315; WR, WF = 0.115, 0.078
STEER = (HX - 0.27, 0.93)
BARX, BARY, BARZ = (HX - 0.36, 1.04, 0.36) if NAKED else (HX - 0.27, 0.905, 0.265)

for sc in [s for s in bpy.data.scenes if s.name == 'Bike']: bpy.data.scenes.remove(sc)
for o in [o for o in bpy.data.objects if o.name.startswith('bk_')]: bpy.data.objects.remove(o)
scene = bpy.data.scenes.new('Bike')
try: bpy.context.window.scene = scene
except Exception: pass

def V(x, y, z=0.0): return Vector((x, -z, y))
def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

MATS = {}
def mat(name, hexc):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
    c = lin(hexc); b.inputs['Base Color'].default_value = (*c, 1); m['apex_col'] = c
    MATS[name] = m; return m

ASM = {'body': [], 'front': [], 'wheelF': [], 'wheelR': []}
def obj_from_bm(bm, name, m, asm, smooth_angle=38, subsurf=0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('bk_' + name, me); scene.collection.objects.link(o); me.materials.append(m)
    if subsurf:
        mod = o.modifiers.new('s', 'SUBSURF'); mod.levels = subsurf; mod.render_levels = subsurf
        dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me2
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(smooth_angle): e.smooth = False
    bm.to_mesh(me); bm.free()
    ASM[asm].append(o); return o

# ------------------------------------------------------------------ primitives
def loft(name, secs, m, asm, ring=16, capA=True, capB=True, subsurf=0, xform=None):
    """sections: dict(x, y, w, ht, hb, wb, e) -> superellipse ring in the y/z plane at x"""
    bm = bmesh.new(); rings = []
    for s in secs:
        e = s.get('e', 2.0); eb = s.get('eb', e); w = s['w']; wb = s.get('wb', w); ht = s.get('ht', 0.05); hb = s.get('hb', ht); r = []
        for k in range(ring):
            a = k / ring * math.pi * 2; c, sn = math.cos(a), math.sin(a); ee = e if sn >= 0 else eb
            zz = (w if sn >= 0 else wb) * math.copysign(abs(c) ** (2 / ee), c)
            yy = (ht if sn >= 0 else -hb) * abs(sn) ** (2 / ee)
            p = V(s['x'], s['y'] + yy, zz)
            if xform: p = xform @ p
            r.append(bm.verts.new(p))
        rings.append(r)
    for i in range(len(rings) - 1):
        for k in range(ring): bm.faces.new([rings[i][k], rings[i][(k + 1) % ring], rings[i + 1][(k + 1) % ring], rings[i + 1][k]])
    if capA: bm.faces.new(list(reversed(rings[0])))
    if capB: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, 33, subsurf)

def box(name, size, loc, m, asm, rot=(0, 0, 0), bevel=0.01, seg=2):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) / 2.2), segments=seg, affect='EDGES', profile=0.5)
    R = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Z') @ Matrix.Rotation(-rot[2], 4, 'Y')  # game rx, ry (about up), rz (about lateral)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(V(*loc)) @ R, verts=bm.verts)
    return obj_from_bm(bm, name, m, asm, 40)

def tube(name, pts, r, m, asm, seg=12, closed_ends=True):
    """swept circle along a polyline of game-space points"""
    bm = bmesh.new(); P = [V(*p) for p in pts]; rings = []
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)); a = t.cross(up).normalized(); b = t.cross(a)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        rings.append([bm.verts.new(p + (a * math.cos(k / seg * 6.2832) + b * math.sin(k / seg * 6.2832)) * rr) for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg): bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    if closed_ends: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, 50)

def lathe(name, prof, m, asm, seg=40, center=(0, 0, 0), smooth=50):
    """profile [(radius, z_lateral)] revolved around the game z axis (wheel axle)"""
    bm = bmesh.new(); rings = []
    for (r, zz) in prof:
        rings.append([bm.verts.new(V(center[0] + r * math.cos(k / seg * 6.2832), center[1] + r * math.sin(k / seg * 6.2832), center[2] + zz)) for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg): bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, smooth)

def cyl(name, r, length, loc, m, asm, axis='z', seg=24, bevel=0.004):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=length)
    if bevel: bmesh.ops.bevel(bm, geom=[e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 1.0], offset=bevel, segments=1, affect='EDGES')
    rot = {'z': Matrix.Rotation(math.pi / 2, 4, 'X'), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'y': Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(V(*loc)) @ rot, verts=bm.verts)
    return obj_from_bm(bm, name, m, asm, 40)

# ------------------------------------------------------------------ materials
P_body = mat('P_body', 'ffffff')
M_dark = mat('M_dark', '1c1e22'); M_seat = mat('M_seat', '18191c'); M_engine = mat('M_engine', '2e3136'); M_tyre = mat('M_tyre', '1a1a1c')
M_carbon = mat('M_carbon', '23252a'); M_red = mat('M_red', 'c8281e'); M_gold = mat('M_gold', 'c79a2a'); M_disc = mat('M_disc', 'a9adb2')
X_alu = mat('X_alu', 'b9bdc2'); X_steel = mat('X_steel', 'd6d8db'); X_ti = mat('X_ti', '8f8676'); X_rim = mat('X_rim', '25272b')
X_wheel = mat('X_wheel', 'c4c8cd'); G_rim = mat('X_rimgrey', '7c8187'); X_frame = mat('X_frame', '41454c'); X_header = mat('X_header', '8a6c48'); G_tft = mat('G_tft', '0e1822'); G_light = mat('G_light', 'f4f8ff'); G_tail = mat('G_tail', 'ff2a1a'); S_screen = mat('S_screen', '10151c')



STRADA_FACE = """
# a long LED swoosh along each upper flank, from the tip up and back; a dark keel intake under the tip
for s in (-1, 1):
    pts = []
    for k in range(18):
        x = 0.805 - 0.17 * k / 17; a = 0.32 + 0.5 * k / 17
        p = on_fair(x, a if s > 0 else math.pi - a, 1.012); pts.append(p)
    tube('swoosh%d' % s, pts, [0.003 + 0.0035 * min(1, k / 5) * (1 - max(0, (k - 13) / 4)) for k in range(18)], G_light, 'body', seg=8)
    bay = [on_fair(0.805 - 0.17 * k / 17, (0.32 + 0.5 * k / 17) if s > 0 else math.pi - (0.32 + 0.5 * k / 17), 0.965) for k in range(18)]
    tube('swbay%d' % s, bay, 0.0095, M_dark, 'body', seg=8)
keel = [on_fair(x, -math.pi / 2, 0.97) for x in (0.80, 0.77, 0.73, 0.69)]
tube('keel', keel, [0.006, 0.014, 0.018, 0.012], M_dark, 'body', seg=10)
"""
CORSA_FACE = """
# two short stacked LED slits on each flank and a square ram-air mouth in the tip
for s in (-1, 1):
    for (a0, a1, r) in ((0.62, 0.70, 0.0055), (0.30, 0.38, 0.005)):
        pts = []
        for k in range(10):
            x = 0.765 - 0.075 * k / 9; a = a0 + (a1 - a0) * k / 9
            pts.append(on_fair(x, a if s > 0 else math.pi - a, 1.012))
        tube('slit%d_%.2f' % (s, a0), pts, r, G_light, 'body', seg=8)
        tube('slitbay%d_%.2f' % (s, a0), [on_fair(0.765 - 0.075 * k / 9, (a0 + (a1 - a0) * k / 9) if s > 0 else math.pi - (a0 + (a1 - a0) * k / 9), 0.965) for k in range(10)], 0.0095, M_dark, 'body', seg=8)
box('rammouth', (0.03, 0.03, 0.045), (0.793, 0.693, 0), M_dark, 'body', rot=(0, 0, 0.3), bevel=0.01)
"""
SUPER_BODY = """
# ---- tank: broad and sculpted, sloping down into the seat
loft('tank', [dict(x=0.36, y=0.86, w=0.07, ht=0.04, hb=0.05), dict(x=0.30, y=0.875, w=0.15, ht=0.075, hb=0.10, e=2.8),
              dict(x=0.16, y=0.875, w=0.185, ht=0.095, hb=0.14, e=3.2), dict(x=0.0, y=0.865, w=0.19, ht=0.10, hb=0.16, e=3.4),
              dict(x=-0.12, y=0.845, w=0.165, ht=0.075, hb=0.15, e=3.0), dict(x=-0.20, y=0.82, w=0.12, ht=0.035, hb=0.10, e=2.6),
              dict(x=-0.23, y=0.81, w=0.06, ht=0.015, hb=0.05)], P_body, 'body', ring=24, subsurf=1)
cyl('fuelcap', 0.045, 0.012, (0.06, 0.963, 0), X_alu, 'body', axis='y', seg=24)
loft('seat', [dict(x=-0.19, y=0.80, w=0.08, ht=0.02, hb=0.02), dict(x=-0.24, y=0.80, w=0.13, ht=0.035, hb=0.03, e=3),
              dict(x=-0.40, y=0.815, w=0.13, ht=0.035, hb=0.03, e=3), dict(x=-0.48, y=0.84, w=0.10, ht=0.03, hb=0.03)], M_seat, 'body', subsurf=1)
# ---- long, high tail: painted top, dark underside, LED strip under the tip
if CORSA:
    loft('tail', [dict(x=-0.14, y=0.75, w=0.13, ht=0.03, hb=0.05), dict(x=-0.32, y=0.78, w=0.14, ht=0.045, hb=0.08, e=3),
                  dict(x=-0.48, y=0.86, w=0.125, ht=0.07, hb=0.10, e=3.4), dict(x=-0.64, y=0.92, w=0.11, ht=0.065, hb=0.10, e=3.6),
                  dict(x=-0.80, y=0.955, w=0.09, ht=0.05, hb=0.085, e=3.6), dict(x=-0.87, y=0.965, w=0.07, ht=0.04, hb=0.07, e=3.2)], P_body, 'body', ring=20, subsurf=1)
else:
    loft('tail', [dict(x=-0.14, y=0.75, w=0.13, ht=0.03, hb=0.05), dict(x=-0.32, y=0.775, w=0.145, ht=0.04, hb=0.07, e=3),
              dict(x=-0.48, y=0.86, w=0.125, ht=0.065, hb=0.075, e=3.2), dict(x=-0.64, y=0.925, w=0.095, ht=0.06, hb=0.055, e=3.0),
              dict(x=-0.80, y=0.975, w=0.055, ht=0.035, hb=0.03, e=2.6), dict(x=-0.90, y=1.0, w=0.02, ht=0.012, hb=0.012)], P_body, 'body', ring=20, subsurf=1)
if not CORSA: loft('undertail', [dict(x=-0.40, y=0.79, w=0.10, ht=0.03, hb=0.03), dict(x=-0.60, y=0.86, w=0.08, ht=0.03, hb=0.035, e=2.6),
                   dict(x=-0.78, y=0.93, w=0.045, ht=0.02, hb=0.02), dict(x=-0.85, y=0.955, w=0.02, ht=0.01, hb=0.01)], M_dark, 'body', ring=16, subsurf=1)
if CORSA: box('taillight', (0.016, 0.03, 0.10), (-0.878, 0.985, 0), G_tail, 'body', bevel=0.006)
else: box('taillight', (0.05, 0.014, 0.09), (-0.855, 0.968, 0), G_tail, 'body', rot=(0, 0, -0.35), bevel=0.005)
# ---- nose: low and pointed, ahead of the front axle; its own light signature (two slanted LED blades) and a chin intake
# nose: narrow and sharp, rounded-triangle sections with a V underside; the 600's is a little shorter and blunter
FRONT = ([dict(x=0.825, y=0.69, w=0.012, ht=0.008, hb=0.01, e=2.2, eb=1.6), dict(x=0.79, y=0.705, w=0.05, ht=0.03, hb=0.045, e=2.4, eb=1.6),
          dict(x=0.74, y=0.727, w=0.085, ht=0.055, hb=0.085, e=2.6, eb=1.7), dict(x=0.68, y=0.757, w=0.115, ht=0.085, hb=0.14, e=2.8, eb=1.9)] if not CORSA else
         [dict(x=0.80, y=0.70, w=0.03, ht=0.02, hb=0.025, e=2.4, eb=1.8), dict(x=0.775, y=0.712, w=0.07, ht=0.045, hb=0.06, e=2.8, eb=1.8),
          dict(x=0.73, y=0.733, w=0.10, ht=0.07, hb=0.10, e=3.0, eb=1.9), dict(x=0.68, y=0.757, w=0.125, ht=0.09, hb=0.145, e=3.0, eb=2.0)])
FAIR = FRONT + [dict(x=0.60, y=0.785, w=0.15, wb=0.14, ht=0.11, hb=0.21, e=3.2, eb=2.2), dict(x=0.50, y=0.79, w=0.185, wb=0.15, ht=0.12, hb=0.25, e=3.6, eb=2.6),
                 dict(x=0.40, y=0.75, w=0.205, wb=0.15, ht=0.12, hb=0.32, e=3.8), dict(x=0.28, y=0.70, w=0.215, wb=0.15, ht=0.10, hb=0.32, e=3.8),
                 dict(x=0.15, y=0.665, w=0.21, wb=0.145, ht=0.075, hb=0.29, e=3.6), dict(x=0.04, y=0.645, w=0.19, wb=0.13, ht=0.05, hb=0.22, e=3.2),
                 dict(x=-0.04, y=0.63, w=0.15, wb=0.10, ht=0.03, hb=0.12, e=2.8), dict(x=-0.07, y=0.62, w=0.08, ht=0.015, hb=0.05)]
loft('fairing', FAIR, P_body, 'body', ring=24, subsurf=1)
def on_fair(x, a, out=1.0):
    # a point on the fairing surface (cage) at length x and section angle a (0 = right side, pi/2 = top), pushed out a little
    for k in range(len(FAIR) - 1):
        A, B = FAIR[k], FAIR[k + 1]
        if B['x'] <= x <= A['x']: break
    t = (A['x'] - x) / (A['x'] - B['x']); L = lambda n, d=None: (A.get(n, A.get(d)) if d else A[n]) * (1 - t) + (B.get(n, B.get(d)) if d else B[n]) * t
    e = L('e') if 'e' in A and 'e' in B else 2.0; eb = A.get('eb', A.get('e', 2.0)) * (1 - t) + B.get('eb', B.get('e', 2.0)) * t
    c, sn = math.cos(a), math.sin(a); ee = e if sn >= 0 else eb
    w = L('w') if sn >= 0 else A.get('wb', A['w']) * (1 - t) + B.get('wb', B['w']) * t
    h = L('ht') if sn >= 0 else A.get('hb', A['ht']) * (1 - t) + B.get('hb', B['ht']) * t
    return (x, L('y') + math.copysign(h * abs(sn) ** (2 / ee), sn) * out, w * math.copysign(abs(c) ** (2 / ee), c) * out)
if CORSA: exec(CORSA_FACE)
else: exec(STRADA_FACE)
loft('screen', [dict(x=0.69, y=0.80, w=0.08, ht=0.014, hb=0.002), dict(x=0.62, y=0.865, w=0.13, ht=0.075, hb=0.002, e=2.4),
                dict(x=0.54, y=0.915, w=0.155, ht=0.145, hb=0.002, e=2.4), dict(x=0.46, y=0.94, w=0.145, ht=0.19, hb=0.002, e=2.4)], S_screen, 'body', ring=16, subsurf=1)
# ---- side panels (around the radiator) and a separate deep belly; the engine shows between them
loft('belly', [dict(x=0.33, y=0.30, w=0.08, ht=0.11, hb=0.10), dict(x=0.28, y=0.285, w=0.16, wb=0.11, ht=0.16, hb=0.15, e=3.0),
               dict(x=0.12, y=0.27, w=0.17, wb=0.12, ht=0.13, hb=0.13, e=3.2), dict(x=-0.02, y=0.27, w=0.16, wb=0.11, ht=0.08, hb=0.10, e=3.0),
               dict(x=-0.14, y=0.28, w=0.11, wb=0.08, ht=0.04, hb=0.06), dict(x=-0.18, y=0.29, w=0.05, ht=0.02, hb=0.03)], P_body, 'body', ring=20, subsurf=1)
for s in ():   # (side ducts removed: they stood off the panel)
    for k in range(3):
        box('duct%d%d' % (s, k), (0.16 - k * 0.03, 0.011, 0.018), (0.36 - k * 0.035, 0.62 - k * 0.04, s * (0.208 - k * 0.003)), M_dark, 'body', rot=(0, 0, -0.42), bevel=0.004)
# ---- mirrors on stalks, TFT dash
for s in (-1, 1):
    tube('mstalk%d' % s, [(0.60, 0.87, s * 0.17), (0.585, 0.92, s * 0.25)], 0.008, M_dark, 'body', seg=8)
    loft('mirror%d' % s, [dict(x=0.62, y=0.94, w=0.06, ht=0.022, hb=0.022, e=2.6), dict(x=0.585, y=0.945, w=0.075, ht=0.028, hb=0.026, e=3.0),
                          dict(x=0.55, y=0.945, w=0.07, ht=0.026, hb=0.024, e=3.0)], M_dark, 'body', ring=14, xform=Matrix.Translation(V(0, 0, s * 0.31)))
    box('mglass%d' % s, (0.006, 0.042, 0.11), (0.548, 0.945, s * 0.31), G_tft, 'body', bevel=0.003)
box('tft', (0.02, 0.075, 0.13), (0.515, 0.958, 0), G_tft, 'body', rot=(0, 0, 0.75), bevel=0.006)
box('tftframe', (0.03, 0.09, 0.15), (0.522, 0.952, 0), M_dark, 'body', rot=(0, 0, 0.75), bevel=0.01)
# ---- frame: dark twin spars, subframe
for s in (-1, 1):
    loft('spar%d' % s, [dict(x=0.42, y=0.86, w=0.022, ht=0.03, hb=0.03, e=3), dict(x=0.30, y=0.79, w=0.024, ht=0.055, hb=0.05, e=3.4), dict(x=0.10, y=0.71, w=0.024, ht=0.06, hb=0.055, e=3.4),
                         dict(x=-0.08, y=0.64, w=0.024, ht=0.07, hb=0.07, e=3.4), dict(x=-0.17, y=0.53, w=0.022, ht=0.07, hb=0.06, e=3)], X_alu if CORSA else X_frame, 'body', ring=16, subsurf=1,
         xform=Matrix.Translation(V(0, 0, s * 0.125)))
    tube('sub%d' % s, [(-0.15, 0.74, s * 0.08), (-0.45, 0.80, s * 0.07), (-0.70, 0.90, s * 0.05)], 0.013, M_dark, 'body', seg=8)
# ---- engine: inline four, crankcase with round covers, block behind the radiator
loft('crank', [dict(x=0.24, y=0.40, w=0.10, ht=0.10, hb=0.10, e=2.6), dict(x=0.18, y=0.40, w=0.135, ht=0.13, hb=0.13, e=3.2), dict(x=-0.10, y=0.40, w=0.14, ht=0.13, hb=0.12, e=3.2),
                dict(x=-0.17, y=0.42, w=0.12, ht=0.09, hb=0.08, e=2.8)], M_engine, 'body', ring=20, subsurf=1)
box('block', (0.24, 0.24, 0.27), (0.17, 0.60, 0), M_engine, 'body', rot=(0, 0, 0.45), bevel=0.04)
box('valvecover', (0.20, 0.07, 0.25), (0.25, 0.72, 0), M_dark, 'body', rot=(0, 0, 0.45), bevel=0.025)
cyl('clutch', 0.075, 0.026, (0.0, 0.40, 0.142), M_dark, 'body', seg=28)
for k in range(6):
    a = k / 6 * math.pi * 2
    cyl('cbolt%d' % k, 0.007, 0.03, (math.cos(a) * 0.06, 0.40 + math.sin(a) * 0.06, 0.143), X_alu, 'body', seg=8, bevel=0)
cyl('alternator', 0.08, 0.03, (0.06, 0.43, -0.145), M_dark, 'body', seg=28)
cyl('sprocketcover', 0.05, 0.028, (-0.07, 0.38, -0.145), X_alu, 'body', seg=20)
box('radiator', (0.04, 0.30, 0.26), (0.40, 0.56, 0), M_dark, 'body', rot=(0, 0, -0.3), bevel=0.01)
# ---- exhaust: four bronze headers into a collector under the engine, then a short steep silencer beside the rear wheel
for k in range(4):
    z = -0.075 + k * 0.05
    tube('hdr%d' % k, [(0.33, 0.56, z), (0.38, 0.40, z * 1.1), (0.32, 0.22, z * 0.6), (0.18, 0.18, z * 0.3)], 0.019, X_header, 'body', seg=10)
if not CORSA:
    box('collector', (0.50, 0.09, 0.19), (-0.06, 0.185, 0.02), X_steel, 'body', bevel=0.03, seg=3)
    tube('link', [(-0.26, 0.19, 0.06), (-0.31, 0.21, 0.14), (-0.33, 0.24, 0.19)], 0.032, X_steel, 'body', seg=12)
    loft('can', [dict(x=-0.31, y=0.235, w=0.045, ht=0.05), dict(x=-0.36, y=0.272, w=0.068, ht=0.082, e=3.2), dict(x=-0.66, y=0.50, w=0.064, ht=0.078, e=3.2),
                 dict(x=-0.70, y=0.53, w=0.05, ht=0.058, e=3.0)], X_steel, 'body', ring=18, subsurf=1, xform=Matrix.Translation(V(0, 0, 0.205)))
    loft('canend', [dict(x=-0.695, y=0.527, w=0.052, ht=0.06, e=3), dict(x=-0.725, y=0.55, w=0.044, ht=0.05, e=3)], M_carbon, 'body', ring=18, xform=Matrix.Translation(V(0, 0, 0.205)))
else:
    box('collector', (0.30, 0.08, 0.16), (0.02, 0.19, 0.0), X_steel, 'body', bevel=0.03, seg=3)
    tube('riser', [(-0.12, 0.20, 0.0), (-0.22, 0.24, 0.0), (-0.28, 0.38, 0.0), (-0.35, 0.60, 0.0), (-0.44, 0.75, 0.0)], 0.026, X_frame, 'body', seg=14)
    for z in (-0.052, 0.052):
        loft('ucan%d' % (z > 0), [dict(x=-0.44, y=0.79, w=0.03, ht=0.03), dict(x=-0.48, y=0.80, w=0.046, ht=0.04, e=2.6), dict(x=-0.80, y=0.865, w=0.046, ht=0.04, e=2.6),
                                  dict(x=-0.86, y=0.875, w=0.042, ht=0.036, e=2.4)], X_ti, 'body', ring=18, subsurf=1, xform=Matrix.Translation(V(0, 0, z)))
        cyl('outlet%d' % (z > 0), 0.03, 0.02, (-0.865, 0.876, z), M_dark, 'body', axis='x', seg=20)
        cyl('outletring%d' % (z > 0), 0.038, 0.012, (-0.858, 0.876, z), X_steel, 'body', axis='x', seg=20)
# ---- box-section swingarm
for s in (-1, 1):
    loft('swing%d' % s, [dict(x=-0.19, y=0.47, w=0.03, ht=0.065, hb=0.065, e=3.2), dict(x=-0.40, y=0.43, w=0.028, ht=0.07, hb=0.06, e=3.2),
                         dict(x=-0.62, y=0.355, w=0.024, ht=0.048, hb=0.04, e=3.0), dict(x=-0.73, y=0.325, w=0.022, ht=0.036, hb=0.036, e=2.6)], X_alu if CORSA else M_dark, 'body', ring=16, subsurf=1,
         xform=Matrix.Translation(V(0, 0, s * 0.128)))
box('swingbrace', (0.08, 0.06, 0.26), (-0.24, 0.47, 0), M_dark, 'body', bevel=0.02)
"""

NAKED_BODY = """
# the tank: a smooth bison hump, high and broad at the front, flowing down into the seat
loft('tank', [dict(x=0.45, y=0.86, w=0.06, ht=0.04, hb=0.05), dict(x=0.40, y=0.88, w=0.14, ht=0.09, hb=0.10, e=2.8),
              dict(x=0.28, y=0.885, w=0.185, ht=0.115, hb=0.14, e=3.2), dict(x=0.10, y=0.87, w=0.19, ht=0.11, hb=0.16, e=3.4),
              dict(x=-0.05, y=0.84, w=0.16, ht=0.08, hb=0.14, e=3.0), dict(x=-0.14, y=0.81, w=0.11, ht=0.035, hb=0.08, e=2.6),
              dict(x=-0.17, y=0.80, w=0.05, ht=0.015, hb=0.04)], P_body, 'body', ring=24, subsurf=1)
cyl('fuelcap', 0.04, 0.012, (0.20, 0.997, 0), X_alu, 'body', axis='y', seg=24)
loft('seat', [dict(x=-0.12, y=0.79, w=0.06, ht=0.015, hb=0.02), dict(x=-0.17, y=0.795, w=0.13, ht=0.035, hb=0.03, e=3),
              dict(x=-0.36, y=0.81, w=0.135, ht=0.035, hb=0.03, e=3), dict(x=-0.45, y=0.835, w=0.10, ht=0.03, hb=0.03)], M_seat, 'body', subsurf=1)
# slim tail
loft('tail', [dict(x=-0.10, y=0.74, w=0.12, ht=0.03, hb=0.05), dict(x=-0.30, y=0.76, w=0.13, ht=0.035, hb=0.06, e=3),
              dict(x=-0.48, y=0.84, w=0.10, ht=0.05, hb=0.05, e=3.0), dict(x=-0.66, y=0.90, w=0.06, ht=0.035, hb=0.035, e=2.6), dict(x=-0.72, y=0.915, w=0.02, ht=0.012, hb=0.012)], P_body, 'body', ring=20, subsurf=1)
box('taillight', (0.02, 0.025, 0.07), (-0.715, 0.912, 0), G_tail, 'body', bevel=0.006)
# radiator shrouds flanking the tank
for s in (-1, 1):
    loft('shroud%d' % s, [dict(x=0.47, y=0.74, w=0.01, ht=0.03, hb=0.03), dict(x=0.41, y=0.715, w=0.017, ht=0.085, hb=0.075, e=3),
                          dict(x=0.27, y=0.72, w=0.017, ht=0.07, hb=0.06, e=3), dict(x=0.19, y=0.75, w=0.01, ht=0.025, hb=0.025)], P_body, 'body', ring=14, subsurf=1,
         xform=Matrix.Translation(V(0, 0, s * 0.165)))
box('radiator', (0.04, 0.26, 0.30), (0.38, 0.56, 0), M_dark, 'body', rot=(0, 0, -0.25), bevel=0.01)
# trellis frame (red tubes)
M_trel = mat('M_trellis', 'c22a24')
for s in (-1, 1):
    a = (STEER[0] - 0.03, 0.9, s * 0.07); b = (-0.2, 0.5, s * 0.125); c = (0.12, 0.84, s * 0.12); d = (0.2, 0.52, s * 0.13); e2 = (-0.1, 0.8, s * 0.115)
    for p, q in ((a, c), (c, e2), (e2, b), (a, d), (d, b), (c, d), (d, e2)):
        tube('trellis%d_%.2f_%.2f' % (s, p[0], q[0]), [p, q], 0.017, M_trel, 'body', seg=8)
    tube('sub%d' % s, [(-0.15, 0.76, s * 0.08), (-0.45, 0.82, s * 0.065), (-0.62, 0.86, s * 0.05)], 0.013, M_trel, 'body', seg=8)
# V-twin: crankcase, two finned cylinders, alternator and clutch covers
loft('crank', [dict(x=0.23, y=0.37, w=0.10, ht=0.09, hb=0.09, e=2.6), dict(x=0.17, y=0.36, w=0.13, ht=0.115, hb=0.11, e=3.2), dict(x=-0.08, y=0.36, w=0.13, ht=0.115, hb=0.105, e=3.2),
               dict(x=-0.15, y=0.38, w=0.11, ht=0.08, hb=0.07, e=2.8)], M_engine, 'body', ring=20, subsurf=1)
for (cx, cy, ang) in ((0.18, 0.56, -0.75), (-0.06, 0.6, 0.15)):
    box('cyl%.2f' % cx, (0.12, 0.2, 0.13), (cx, cy, 0), M_engine, 'body', rot=(0, 0, ang), bevel=0.02)
    for k in range(5):
        dy = -0.06 + k * 0.03
        box('fin%.2f_%d' % (cx, k), (0.16, 0.008, 0.17), (cx - math.sin(-ang) * dy, cy + math.cos(-ang) * dy, 0), M_engine, 'body', rot=(0, 0, ang), bevel=0.003)
    box('head%.2f' % cx, (0.14, 0.06, 0.15), (cx - math.sin(-ang) * 0.12, cy + math.cos(-ang) * 0.12, 0), X_alu, 'body', rot=(0, 0, ang), bevel=0.015)
cyl('altcover', 0.075, 0.03, (0.06, 0.36, -0.14), M_dark, 'body', seg=28)
cyl('altring', 0.06, 0.034, (0.06, 0.36, -0.141), X_alu, 'body', seg=28)
cyl('clutchcover', 0.08, 0.03, (0.0, 0.37, 0.14), M_dark, 'body', seg=28)
cyl('clutchring', 0.064, 0.034, (0.0, 0.37, 0.141), X_alu, 'body', seg=28)
for k in range(6):
    a = k / 6 * math.pi * 2
    cyl('ccbolt%d' % k, 0.006, 0.036, (math.cos(a) * 0.05, 0.37 + math.sin(a) * 0.05, 0.142), M_dark, 'body', seg=8, bevel=0)
# exhaust: headers into a stacked twin silencer on the right
tube('header1', [(0.24, 0.48, 0.05), (0.32, 0.36, 0.08), (0.2, 0.24, 0.1), (-0.05, 0.25, 0.15), (-0.2, 0.38, 0.18)], 0.026, X_steel, 'body', seg=10)
tube('header2', [(-0.12, 0.52, 0.08), (-0.18, 0.44, 0.16), (-0.22, 0.42, 0.18)], 0.026, X_steel, 'body', seg=10)
for k, (dy, rr) in enumerate(((0.0, 0.05), (0.075, 0.045))):
    loft('can%d' % k, [dict(x=-0.2, y=0.4 + dy, w=0.03, ht=0.03), dict(x=-0.24, y=0.42 + dy, w=rr, ht=rr, e=2.2), dict(x=-0.5, y=0.52 + dy, w=rr, ht=rr, e=2.2), dict(x=-0.52, y=0.53 + dy, w=rr * 0.7, ht=rr * 0.7, e=2.2)],
         X_steel, 'body', ring=16, xform=Matrix.Translation(V(0, 0, 0.2)))
    cyl('cancap%d' % k, rr * 0.75, 0.015, (-0.525, 0.532 + dy, 0.2), M_carbon, 'body', axis='x', seg=16)
"""

# ------------------------------------------------------------------ BODY
if not SUPER and not NAKED:
    # tank
    loft('tank', [
        dict(x=0.44, y=0.83, w=0.06, ht=0.04, hb=0.05), dict(x=0.40, y=0.85, w=0.13, ht=0.09 + (0.02 if NAKED else 0), hb=0.10, e=2.6),
        dict(x=0.28, y=0.85, w=0.17, ht=0.125 + (0.015 if NAKED else 0), hb=0.14, e=3.0), dict(x=0.10, y=0.84, w=0.18, ht=0.12, hb=0.16, e=3.2),
        dict(x=-0.05, y=0.82, w=0.155, ht=0.095, hb=0.14, e=3.0), dict(x=-0.15, y=0.795, w=0.11, ht=0.04, hb=0.09, e=2.4)], P_body, 'body')
    # seat
    loft('seat', [dict(x=-0.12, y=0.79, w=0.06, ht=0.015, hb=0.02), dict(x=-0.17, y=0.795, w=0.13, ht=0.035, hb=0.03, e=3),
                  dict(x=-0.36, y=0.81, w=0.135, ht=0.035, hb=0.03, e=3), dict(x=-0.45, y=0.835, w=0.10, ht=0.03, hb=0.03)], M_seat, 'body')

if SUPER:
    exec(SUPER_BODY)
elif not NAKED:
    # tall tail unit with a sharp upswept tip
    loft('tail', [
        dict(x=-0.10, y=0.74, w=0.12, ht=0.03, hb=0.05), dict(x=-0.30, y=0.76, w=0.145, ht=0.035, hb=0.07, e=3),
        dict(x=-0.46, y=0.85, w=0.13, ht=0.08, hb=0.08, e=3.2), dict(x=-0.62, y=0.93, w=0.095, ht=0.075, hb=0.06, e=3.0),
        dict(x=-0.76, y=0.985, w=0.05, ht=0.04, hb=0.035, e=2.5), dict(x=-0.81, y=1.0, w=0.02, ht=0.015, hb=0.015)], P_body, 'body')
    box('taillight', (0.02, 0.025, 0.08), (-0.80, 0.995, 0), G_tail, 'body', bevel=0.006)
    # main fairing: one continuous side/belly shell around the engine
    loft('fairing', [
        dict(x=0.72, y=0.63, w=0.06, ht=0.10, hb=0.10), dict(x=0.64, y=0.59, w=0.15, wb=0.11, ht=0.21, hb=0.20, e=3.0),
        dict(x=0.47, y=0.54, w=0.21, wb=0.12, ht=0.27, hb=0.28, e=3.4), dict(x=0.25, y=0.50, w=0.225, wb=0.125, ht=0.24, hb=0.29, e=3.4),
        dict(x=0.02, y=0.46, w=0.205, wb=0.11, ht=0.17, hb=0.26, e=3.2), dict(x=-0.18, y=0.39, w=0.15, wb=0.08, ht=0.08, hb=0.17, e=2.8),
        dict(x=-0.32, y=0.33, w=0.08, wb=0.05, ht=0.05, hb=0.10), dict(x=-0.38, y=0.30, w=0.03, ht=0.02, hb=0.04)], P_body, 'body', ring=20)
    # nose with the two headlight "eyes" and a central ram-air intake
    loft('nose', [
        dict(x=0.96, y=0.775, w=0.025, ht=0.02, hb=0.03, e=2.2), dict(x=0.92, y=0.785, w=0.09, ht=0.045, hb=0.07, e=2.6),
        dict(x=0.84, y=0.80, w=0.15, ht=0.075, hb=0.11, e=2.8), dict(x=0.74, y=0.825, w=0.19, ht=0.10, hb=0.15, e=3.0),
        dict(x=0.62, y=0.85, w=0.205, ht=0.11, hb=0.16, e=3.2), dict(x=0.50, y=0.865, w=0.19, ht=0.095, hb=0.13, e=3.0),
        dict(x=0.43, y=0.86, w=0.13, ht=0.05, hb=0.07, e=2.6)], P_body, 'body', ring=18)
    for s in (-1, 1):
        box('eye%d' % s, (0.12, 0.04, 0.09), (0.855, 0.80, s * 0.105), M_dark, 'body', rot=(0, s * 0.55, 0.18), bevel=0.012)
        box('lens%d' % s, (0.09, 0.024, 0.07), (0.866, 0.803, s * 0.112), G_light, 'body', rot=(0, s * 0.55, 0.18), bevel=0.008)
        # winglets
        box('wing%d' % s, (0.15, 0.012, 0.10), (0.66, 0.74, s * 0.235), M_carbon, 'body', rot=(s * -0.25, s * 0.12, 0), bevel=0.004)
        # side vents (dark inserts proud of the fairing)
        for k in range(3):
            box('vent%d%d' % (s, k), (0.12 - k * 0.02, 0.012, 0.02), (0.42 - k * 0.03, 0.62 - k * 0.04, s * (0.222 - k * 0.003)), M_dark, 'body', rot=(0, 0, -0.35), bevel=0.004)
    box('intake', (0.05, 0.035, 0.05), (0.94, 0.77, 0), M_dark, 'body', bevel=0.012)
    # windscreen
    loft('screen', [dict(x=0.80, y=0.925, w=0.07, ht=0.012, hb=0.002), dict(x=0.70, y=0.975, w=0.12, ht=0.05, hb=0.002, e=2.4),
                    dict(x=0.58, y=0.995, w=0.135, ht=0.085, hb=0.002, e=2.4), dict(x=0.50, y=1.0, w=0.125, ht=0.09, hb=0.002, e=2.4)], S_screen, 'body', ring=16, subsurf=1)
    # frame: twin aluminium spars from the steering head to the swingarm pivot
    for s in (-1, 1):
        tube('spar%d' % s, [(STEER[0] - 0.02, 0.88, s * 0.07), (0.30, 0.78, s * 0.13), (0.05, 0.72, s * 0.135), (-0.10, 0.64, s * 0.13), (-0.17, 0.52, s * 0.115)], 0.034, X_alu, 'body', seg=10)
        tube('sub%d' % s, [(-0.15, 0.74, s * 0.08), (-0.45, 0.81, s * 0.07), (-0.66, 0.89, s * 0.05)], 0.014, M_dark, 'body', seg=8)
    # engine block, cylinder heads, sump, radiator
    box('crank', (0.40, 0.24, 0.30), (0.05, 0.36, 0), M_engine, 'body', bevel=0.04)
    box('heads', (0.24, 0.26, 0.26), (0.18, 0.57, 0), M_engine, 'body', rot=(0, 0, 0.45), bevel=0.04)
    box('radiator', (0.04, 0.30, 0.34), (0.40, 0.55, 0), M_dark, 'body', rot=(0, 0, -0.3), bevel=0.01)
else:
    exec(NAKED_BODY)
# swingarm (banana arm on the right, straight on the left), chain and sprockets
for s in ((-1, 1) if not SUPER else ()):
    pts = [(-0.18, 0.46, s * 0.11), (-0.45, 0.41, s * 0.13), (-HX, RR, s * 0.125)] if s < 0 else [(-0.18, 0.46, s * 0.11), (-0.40, 0.49, s * 0.135), (-HX, RR, s * 0.125)]
    tube('arm%d' % s, pts, [0.05, 0.042, 0.03], X_alu, 'body', seg=10)
cyl('sprocketF', 0.05, 0.012, (-0.02, 0.36, -0.13), X_steel, 'body', seg=18)
cyl('sprocketR', 0.11, 0.008, (-HX, RR, -0.13), X_steel, 'body', seg=28)
for y0, y1 in ((0.41, RR + 0.11), (0.31, RR - 0.11)):
    tube('chain%.2f' % y0, [(-0.02, y0, -0.13), (-HX, y1, -0.13)], 0.009, M_dark, 'body', seg=6)
box('chainguard', (0.30, 0.012, 0.04), (-0.42, 0.47, -0.15), M_carbon, 'body', rot=(0, 0, -0.18), bevel=0.004)
# rear shock with a coil spring
tube('shock', [(-0.20, 0.72, 0), (-0.30, 0.42, 0)], 0.022, X_steel, 'body', seg=10)
coil = []
A = Vector((-0.21, 0.68)); B = Vector((-0.285, 0.46)); ax = (B - A); nrm = Vector((-ax.y, ax.x)).normalized()
for k in range(90):
    a = k / 90 * math.pi * 2 * 7; t = k / 89; p = A + ax * t
    coil.append((p.x + nrm.x * math.cos(a) * 0.036, p.y + nrm.y * math.cos(a) * 0.036, math.sin(a) * 0.036))
tube('spring', coil, 0.007, M_gold, 'body', seg=6, closed_ends=False)
if not NAKED and not SUPER:
    # exhaust: header sweeping to a side-mounted titanium silencer (right side)
    tube('header', [(0.30, 0.30, 0.05), (0.12, 0.24, 0.11), (-0.06, 0.28, 0.17), (-0.17, 0.36, 0.19)], 0.03, X_ti, 'body', seg=12)
    loft('silencer', [dict(x=-0.15, y=0.35, w=0.04, ht=0.04), dict(x=-0.20, y=0.375, w=0.055, ht=0.065, e=3),
                      dict(x=-0.50, y=0.49, w=0.055, ht=0.065, e=3), dict(x=-0.53, y=0.503, w=0.046, ht=0.05, e=3)], X_ti, 'body', ring=16, subsurf=1,
         xform=Matrix.Translation(V(0, 0, 0.19)))
    cyl('silcap', 0.046, 0.02, (-0.535, 0.505, 0.19), M_carbon, 'body', axis='x', seg=18)
# footpegs + rearsets
for s in (-1, 1):
    tube('hanger%d' % s, [(-0.18, 0.54, s * 0.14), (-0.24, 0.46, s * 0.17)], 0.012, X_alu, 'body', seg=8)
    tube('peg%d' % s, [(-0.24, 0.46, s * 0.15), (-0.24, 0.46, s * 0.22)], 0.013, M_dark, 'body', seg=8)
# rear hugger (the supersport has none: its tail and swingarm frame the wheel)
if not SUPER: loft('hugger', [dict(x=-HX + 0.05, y=RR + 0.36, w=0.08, ht=0.01, hb=0.01), dict(x=-HX + 0.2, y=RR + 0.33, w=0.085, ht=0.012, hb=0.012),
                dict(x=-HX + 0.32, y=RR + 0.24, w=0.08, ht=0.012, hb=0.012)], M_carbon, 'body', ring=12, subsurf=1)

# ------------------------------------------------------------------ FRONT (steered)
fx, fy = HX, RF
sx, sy = STEER
d = Vector((fx - sx, fy - sy)).normalized()
for s in (-1, 1):
    z = s * 0.105
    top = (sx - 0.03, sy + 0.03, z); mid = (sx + d.x * 0.34, sy + d.y * 0.34, z); bot = (fx, fy + 0.02, z)
    tube('forkU%d' % s, [top, mid], 0.032, X_frame if NAKED else M_gold, 'front', seg=16)
    tube('forkL%d' % s, [mid, bot], 0.026, X_steel, 'front', seg=16)
    cyl('axleclamp%d' % s, 0.03, 0.04, (fx, fy, s * 0.105), X_steel, 'front', seg=14)
    box('caliper%d' % s, (0.09, 0.05, 0.035), (fx - 0.10, fy + 0.10, s * 0.083), M_red, 'front', rot=(0, 0, 1.1), bevel=0.012)
    if NAKED:   # tubular handlebar on risers
        tube('riser%d' % s, [(sx - 0.02, sy + 0.05, s * 0.06), (BARX + 0.06, 0.975, s * 0.07)], 0.016, M_dark, 'front', seg=8)
        tube('bar%d' % s, [(BARX + 0.06, 0.985, 0), (BARX + 0.06, 0.985, s * 0.1), (BARX + 0.02, BARY, s * 0.2), (BARX, BARY, s * (BARZ - 0.05))], 0.0125, M_dark, 'front', seg=8)
        tube('grip%d' % s, [(BARX, BARY, s * (BARZ - 0.06)), (BARX, BARY, s * (BARZ + 0.05))], 0.019, M_tyre, 'front', seg=10)
        box('lever%d' % s, (0.15, 0.008, 0.016), (BARX + 0.07, BARY + 0.005, s * (BARZ - 0.03)), X_alu, 'front', rot=(0, s * 0.3, 0), bevel=0.003)
    else:
        box('lever%d' % s, (0.14, 0.008, 0.016), (BARX + 0.06, BARY + 0.005, s * (BARZ - 0.02)), X_alu, 'front', rot=(0, s * 0.35, 0), bevel=0.003)
        tube('clipon%d' % s, [(sx - 0.03, BARY + 0.01, s * 0.1), (BARX - 0.02, BARY - 0.02, s * (BARZ + 0.02))], 0.014, M_dark, 'front', seg=8)
        tube('grip%d' % s, [(BARX - 0.015, BARY - 0.017, s * (BARZ - 0.04)), (BARX - 0.025, BARY - 0.025, s * (BARZ + 0.06))], 0.019, M_tyre, 'front', seg=10)
box('clamp', (0.08, 0.03, 0.28), (sx - 0.02, sy + 0.035, 0), X_frame if SUPER else X_alu, 'front', bevel=0.01)
if SUPER:
    for s in (-1, 1): cyl('forkcap%d' % s, 0.02, 0.014, (sx - 0.035, sy + 0.048, s * 0.105), M_gold, 'front', axis='y', seg=18)
    cyl('reservoir', 0.02, 0.045, (BARX + 0.02, BARY + 0.05, 0.18), X_alu, 'front', axis='y', seg=16)
    cyl('resercap', 0.022, 0.01, (BARX + 0.02, BARY + 0.077, 0.18), M_dark, 'front', axis='y', seg=16)
if not NAKED: box('damper', (0.16, 0.022, 0.022), (sx - 0.05, sy + 0.06, 0.06), M_gold, 'front', rot=(0, 0.3, 0), bevel=0.008)
loft('fender', [dict(x=fx + 0.20, y=fy + 0.24, w=0.07, ht=0.008, hb=0.008), dict(x=fx + 0.05, y=fy + 0.34, w=0.085, ht=0.012, hb=0.012),
                dict(x=fx - 0.10, y=fy + 0.33, w=0.085, ht=0.012, hb=0.012), dict(x=fx - 0.22, y=fy + 0.22, w=0.07, ht=0.008, hb=0.008)], M_carbon if (SUPER or NAKED) else P_body, 'front', ring=12, subsurf=1)

if NAKED:
    # round headlight in a dark bucket, small fly screen above it, both turning with the bars
    loft('hlbucket', [dict(x=0.53, y=0.88, w=0.05, ht=0.05), dict(x=0.58, y=0.88, w=0.095, ht=0.095, e=2.0), dict(x=0.65, y=0.88, w=0.1, ht=0.1, e=2.0)], M_dark, 'front', ring=28, subsurf=1)
    loft('hlglass', [dict(x=0.649, y=0.88, w=0.09, ht=0.09, e=2.0), dict(x=0.668, y=0.88, w=0.072, ht=0.072, e=2.0), dict(x=0.676, y=0.88, w=0.03, ht=0.03, e=2.0)], G_tft, 'front', ring=28, capA=False, subsurf=1)
    tube('hlring', [(0.664, 0.88 + 0.071 * math.sin(k / 36 * 6.2832), 0.071 * math.cos(k / 36 * 6.2832)) for k in range(37)], 0.0065, G_light, 'front', seg=8, closed_ends=False)
    loft('hlproj', [dict(x=0.668, y=0.88, w=0.03, ht=0.03, e=2.0), dict(x=0.682, y=0.88, w=0.024, ht=0.024, e=2.0), dict(x=0.686, y=0.88, w=0.012, ht=0.012, e=2.0)], G_light, 'front', ring=20, capA=False)
    tube('hldrl', [(0.672, 0.845, -0.05), (0.676, 0.84, 0.0), (0.672, 0.845, 0.05)], 0.004, G_light, 'front', seg=8)
    loft('flyscreen', [dict(x=0.62, y=0.985, w=0.02, ht=0.006, hb=0.004), dict(x=0.6, y=1.0, w=0.1, ht=0.05, hb=0.006, e=2.6), dict(x=0.53, y=0.99, w=0.11, ht=0.03, hb=0.006, e=2.6)], P_body, 'front', ring=16)
    for s in (-1, 1): box('hlbracket%d' % s, (0.12, 0.02, 0.012), (0.56, 0.86, s * 0.1), M_dark, 'front', bevel=0.004)

# ------------------------------------------------------------------ WHEELS
def wheel(asm, R, W, cx, cy, discs, nsp=5, rimM=None, split=False):
    rimM = rimM or X_wheel
    c = (cx, cy, 0); H = 0.095 if R < 0.32 else 0.105            # tyre height (sidewall)
    Rc = R - H / 2; rr = R - H                                    # tyre cross-section centre, rim bead radius
    # round tyre: elliptical cross-section wrapped onto the rim
    # tyre: round crown, sidewalls running down into the rim so the bead sits between the rim flanges
    prof = [(rr + 0.003, -W * 0.80), (rr + 0.016, -W * 0.86)]
    for k in range(15):
        t = math.radians(-100 + 200 * k / 14)
        prof.append((Rc + (H / 2) * math.cos(t), W * 0.97 * math.sin(t)))
    prof += [(rr + 0.016, W * 0.86), (rr + 0.003, W * 0.80)]
    lathe(asm + '_tyre', prof, M_tyre, asm, 72, c, 80)
    # rim as a solid ring: flanges holding the tyre, a visible side face and the inner barrel (rim bed) between the spokes
    rim = [(rr + 0.014, -W * 0.93), (rr + 0.014, -W * 0.82), (rr - 0.002, -W * 0.79), (rr - 0.002, W * 0.79), (rr + 0.014, W * 0.82), (rr + 0.014, W * 0.93),
           (rr - 0.018, W * 0.90), (rr - 0.036, W * 0.72), (rr - 0.036, -W * 0.72), (rr - 0.018, -W * 0.90), (rr + 0.014, -W * 0.93)]
    lathe(asm + '_rim', rim, rimM, asm, 72, c, 35)
    # hub
    lathe(asm + '_hub', [(0.0, -W * 0.75), (0.038, -W * 0.75), (0.05, -W * 0.6), (0.058, -W * 0.3), (0.058, W * 0.3), (0.05, W * 0.6), (0.038, W * 0.75), (0.0, W * 0.75)], rimM, asm, 24, c, 45)
    # five broad, slightly tapered spokes
    r0, r1 = 0.052, rr - 0.032
    for k in range(nsp):
        a = k / nsp * math.pi * 2 + 0.3; L = r1 - r0; m = (r0 + r1) / 2
        p = (cx + math.cos(a) * m, cy + math.sin(a) * m, 0)
        if split:
            for o2 in (-0.11, 0.11):
                a2 = a + o2 * (1 - 0.5); p2 = (cx + math.cos(a + o2 * 0.55) * m, cy + math.sin(a + o2 * 0.55) * m, 0)
                box('%s_sp%d_%d' % (asm, k, int(o2 * 100)), (L + 0.02, 0.019, W * 0.42), p2, rimM, asm, rot=(0, 0, a + o2 * 0.55), bevel=0.006)
        else:
            box('%s_sp%d' % (asm, k), (L + 0.02, 0.034, W * 0.5), p, X_wheel, asm, rot=(0, 0, a), bevel=0.008)
    # brake discs on aluminium carriers
    for z in discs:
        d0, d1 = (0.105, 0.16) if len(discs) > 1 else (0.075, 0.115)
        lathe(asm + '_disc%.2f' % z, [(d0, z - 0.0035), (d1, z - 0.0035), (d1, z + 0.0035), (d0, z + 0.0035), (d0, z - 0.0035)], M_disc, asm, 48, c, 30)
        lathe(asm + '_carrier%.2f' % z, [(0.05, z - 0.004), (d0 + 0.006, z - 0.004), (d0 + 0.006, z + 0.004), (0.05, z + 0.004), (0.05, z - 0.004)], M_dark if (rimM is not X_wheel or NAKED) else M_gold, asm, 24, c, 30)
        for k in range(6):
            a = k / 6 * math.pi * 2
            cyl('%s_bolt%.2f_%d' % (asm, z, k), 0.007, 0.012, (cx + math.cos(a) * (d0 + 0.0), cy + math.sin(a) * (d0 + 0.0), z), X_steel, asm, seg=8, bevel=0)
RIMM = mat('X_rimgold', 'b08a3a') if CORSA else G_rim if SUPER else None
wheel('wheelF', RF, WF, HX, RF, [-0.083, 0.083], 5, RIMM, SUPER)
wheel('wheelR', RR, WR, -HX, RR, [0.09], 5, RIMM, SUPER)

# ------------------------------------------------------------------ bake AO into vertex colours, then base colour * AO
allobj = [o for L in ASM.values() for o in L]
for o in allobj:
    me = o.data
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER'); me.color_attributes.active_color = ca
    for p in ca.data: p.color = (1, 1, 1, 1)
# ground plane so the underside gets occluded
gme = bpy.data.meshes.new('bk_ground'); gme.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
gnd = bpy.data.objects.new('bk_ground', gme); scene.collection.objects.link(gnd)
scene.render.engine = 'CYCLES'
try: scene.cycles.device = 'GPU'
except Exception: pass
scene.cycles.samples = 96
if not scene.world: scene.world = bpy.data.worlds.new('bkW')
scene.world.light_settings.distance = 0.22
scene.render.bake.target = 'VERTEX_COLORS'
vl = bpy.context.view_layer
for o in scene.objects: o.select_set(False)
for o in allobj: o.select_set(True)
vl.objects.active = allobj[0]
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
for o in allobj:
    m = o.data.materials[0]; base = m['apex_col'] if not m.name.startswith('P_') else (1, 1, 1)
    ca = o.data.color_attributes['Col']
    for p in ca.data:
        a = p.color[0]; a = 0.35 + 0.65 * a
        p.color = (base[0] * a if not m.name.startswith('P_') else a, base[1] * a if not m.name.startswith('P_') else a, base[2] * a if not m.name.startswith('P_') else a, 1)
bpy.data.objects.remove(gnd)

# ------------------------------------------------------------------ export each assembly (wheels recentred on their axle)
res = {}
for asm, L in ASM.items():
    shift = Vector((0, 0, 0))
    if asm == 'wheelF': shift = -V(HX, RF, 0)
    if asm == 'wheelR': shift = -V(-HX, RR, 0)
    for o in L: o.location = shift
    for sc2 in bpy.data.scenes:
        for vl2 in sc2.view_layers:
            for o in sc2.objects:
                try: o.select_set(False, view_layer=vl2)
                except Exception: pass
    for o in L: o.select_set(True)
    vl.objects.active = L[0]
    bpy.ops.export_scene.gltf(filepath=OUT + 'bike_' + VARIANT + '_' + asm + '.glb', export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT')
    for o in L: o.location = (0, 0, 0)
    res[asm] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in L)
result = res
