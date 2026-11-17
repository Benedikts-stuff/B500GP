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
WB = 1.45; HX = WB / 2; RR, RF = 0.325, 0.315; WR, WF = 0.115, 0.078
STEER = (HX - 0.27, 0.93)
BARX, BARY, BARZ = HX - 0.27, 0.905, 0.265

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
        e = s.get('e', 2.0); w = s['w']; wb = s.get('wb', w); ht = s.get('ht', 0.05); hb = s.get('hb', ht); r = []
        for k in range(ring):
            a = k / ring * math.pi * 2; c, sn = math.cos(a), math.sin(a)
            zz = (w if sn >= 0 else wb) * math.copysign(abs(c) ** (2 / e), c)
            yy = (ht if sn >= 0 else -hb) * abs(sn) ** (2 / e)
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
X_wheel = mat('X_wheel', 'c4c8cd'); G_light = mat('G_light', 'f4f8ff'); G_tail = mat('G_tail', 'ff2a1a'); S_screen = mat('S_screen', '10151c')

# ------------------------------------------------------------------ BODY
# tank
loft('tank', [
    dict(x=0.44, y=0.83, w=0.06, ht=0.04, hb=0.05), dict(x=0.40, y=0.85, w=0.13, ht=0.09, hb=0.10, e=2.6),
    dict(x=0.28, y=0.85, w=0.17, ht=0.125, hb=0.14, e=3.0), dict(x=0.10, y=0.84, w=0.18, ht=0.12, hb=0.16, e=3.2),
    dict(x=-0.05, y=0.82, w=0.155, ht=0.095, hb=0.14, e=3.0), dict(x=-0.15, y=0.795, w=0.11, ht=0.04, hb=0.09, e=2.4)], P_body, 'body')
# seat
loft('seat', [dict(x=-0.12, y=0.79, w=0.06, ht=0.015, hb=0.02), dict(x=-0.17, y=0.795, w=0.13, ht=0.035, hb=0.03, e=3),
              dict(x=-0.36, y=0.81, w=0.135, ht=0.035, hb=0.03, e=3), dict(x=-0.45, y=0.835, w=0.10, ht=0.03, hb=0.03)], M_seat, 'body')
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
# swingarm (banana arm on the right, straight on the left), chain and sprockets
for s in (-1, 1):
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
# rear hugger
loft('hugger', [dict(x=-HX + 0.05, y=RR + 0.36, w=0.08, ht=0.01, hb=0.01), dict(x=-HX + 0.2, y=RR + 0.33, w=0.085, ht=0.012, hb=0.012),
                dict(x=-HX + 0.32, y=RR + 0.24, w=0.08, ht=0.012, hb=0.012)], M_carbon, 'body', ring=12, subsurf=1)

# ------------------------------------------------------------------ FRONT (steered)
fx, fy = HX, RF
sx, sy = STEER
d = Vector((fx - sx, fy - sy)).normalized()
for s in (-1, 1):
    z = s * 0.105
    top = (sx - 0.03, sy + 0.03, z); mid = (sx + d.x * 0.34, sy + d.y * 0.34, z); bot = (fx, fy + 0.02, z)
    tube('forkU%d' % s, [top, mid], 0.032, M_gold, 'front', seg=16)
    tube('forkL%d' % s, [mid, bot], 0.026, X_steel, 'front', seg=16)
    cyl('axleclamp%d' % s, 0.03, 0.04, (fx, fy, s * 0.105), X_steel, 'front', seg=14)
    box('caliper%d' % s, (0.09, 0.05, 0.035), (fx - 0.10, fy + 0.10, s * 0.083), M_red, 'front', rot=(0, 0, 1.1), bevel=0.012)
    box('lever%d' % s, (0.14, 0.008, 0.016), (BARX + 0.06, BARY + 0.005, s * (BARZ - 0.02)), X_alu, 'front', rot=(0, s * 0.35, 0), bevel=0.003)
    tube('clipon%d' % s, [(sx - 0.03, BARY + 0.01, s * 0.1), (BARX - 0.02, BARY - 0.02, s * (BARZ + 0.02))], 0.014, M_dark, 'front', seg=8)
    tube('grip%d' % s, [(BARX - 0.015, BARY - 0.017, s * (BARZ - 0.04)), (BARX - 0.025, BARY - 0.025, s * (BARZ + 0.06))], 0.019, M_tyre, 'front', seg=10)
box('clamp', (0.08, 0.03, 0.28), (sx - 0.02, sy + 0.035, 0), X_alu, 'front', bevel=0.01)
box('damper', (0.16, 0.022, 0.022), (sx - 0.05, sy + 0.06, 0.06), M_gold, 'front', rot=(0, 0.3, 0), bevel=0.008)
loft('fender', [dict(x=fx + 0.20, y=fy + 0.24, w=0.07, ht=0.008, hb=0.008), dict(x=fx + 0.05, y=fy + 0.34, w=0.085, ht=0.012, hb=0.012),
                dict(x=fx - 0.10, y=fy + 0.33, w=0.085, ht=0.012, hb=0.012), dict(x=fx - 0.22, y=fy + 0.22, w=0.07, ht=0.008, hb=0.008)], P_body, 'front', ring=12, subsurf=1)

# ------------------------------------------------------------------ WHEELS
def wheel(asm, R, W, cx, cy, discs, nsp=5):
    c = (cx, cy, 0); H = 0.095 if R < 0.32 else 0.105            # tyre height (sidewall)
    Rc = R - H / 2; rr = R - H                                    # tyre cross-section centre, rim bead radius
    # round tyre: elliptical cross-section wrapped onto the rim
    prof = []
    for k in range(17):
        t = math.radians(-112 + 224 * k / 16)
        prof.append((Rc + (H / 2) * math.cos(t), W * 0.97 * math.sin(t)))
    lathe(asm + '_tyre', prof, M_tyre, asm, 72, c, 80)
    # rim: flanges, barrel and a bright lip so the wheel reads from the chase camera
    rim = [(rr - 0.004, -W * 0.92), (rr + 0.012, -W * 0.9), (rr + 0.012, -W * 0.78), (rr - 0.006, -W * 0.72), (rr - 0.022, -W * 0.55),
           (rr - 0.026, 0.0), (rr - 0.022, W * 0.55), (rr - 0.006, W * 0.72), (rr + 0.012, W * 0.78), (rr + 0.012, W * 0.9), (rr - 0.004, W * 0.92)]
    lathe(asm + '_rim', rim, X_wheel, asm, 72, c, 45)
    lathe(asm + '_rimin', [(rr - 0.026, -W * 0.5), (rr - 0.034, -W * 0.35), (rr - 0.034, W * 0.35), (rr - 0.026, W * 0.5)], X_wheel, asm, 72, c, 45)
    # hub
    lathe(asm + '_hub', [(0.0, -W * 0.75), (0.038, -W * 0.75), (0.05, -W * 0.6), (0.058, -W * 0.3), (0.058, W * 0.3), (0.05, W * 0.6), (0.038, W * 0.75), (0.0, W * 0.75)], X_wheel, asm, 24, c, 45)
    # five broad, slightly tapered spokes
    r0, r1 = 0.052, rr - 0.03
    for k in range(nsp):
        a = k / nsp * math.pi * 2 + 0.3; L = r1 - r0; m = (r0 + r1) / 2
        p = (cx + math.cos(a) * m, cy + math.sin(a) * m, 0)
        box('%s_sp%d' % (asm, k), (L + 0.02, 0.034, W * 0.5), p, X_wheel, asm, rot=(0, 0, a), bevel=0.008)
    # brake discs on aluminium carriers
    for z in discs:
        d0, d1 = (0.105, 0.16) if len(discs) > 1 else (0.075, 0.115)
        lathe(asm + '_disc%.2f' % z, [(d0, z - 0.0035), (d1, z - 0.0035), (d1, z + 0.0035), (d0, z + 0.0035), (d0, z - 0.0035)], M_disc, asm, 48, c, 30)
        lathe(asm + '_carrier%.2f' % z, [(0.05, z - 0.004), (d0 + 0.006, z - 0.004), (d0 + 0.006, z + 0.004), (0.05, z + 0.004), (0.05, z - 0.004)], M_gold, asm, 24, c, 30)
        for k in range(6):
            a = k / 6 * math.pi * 2
            cyl('%s_bolt%.2f_%d' % (asm, z, k), 0.007, 0.012, (cx + math.cos(a) * (d0 + 0.0), cy + math.sin(a) * (d0 + 0.0), z), X_steel, asm, seg=8, bevel=0)
wheel('wheelF', RF, WF, HX, RF, [-0.083, 0.083], 5)
wheel('wheelR', RR, WR, -HX, RR, [0.09], 5)

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
    for o in scene.objects: o.select_set(False)
    for o in L: o.select_set(True)
    vl.objects.active = L[0]
    bpy.ops.export_scene.gltf(filepath=OUT + 'bike_strada_' + asm + '.glb', export_format='GLB', use_selection=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT')
    for o in L: o.location = (0, 0, 0)
    res[asm] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in L)
result = res
