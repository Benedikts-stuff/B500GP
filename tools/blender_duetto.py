"""APEX DUETTO 900 - naked V-twin, built frame-first in stages so every step can be checked on its own.

  STAGES   list of stages to build: 'chassis' (frame, fork, swingarm, shock, wheels) -> 'engine' -> 'body' -> 'controls'
  SHOTS    list of preview views to render into blender/renders/<PREFIX>_<view>.png (side, sideL, q1..q4, front, rear, top)
  EXPORT   True: bake AO into vertex colours and export the game assemblies (only once the bike is complete)

Game coordinates: x forward, y up, z lateral (right = +z), origin on the ground at mid wheelbase. Blender: X = x, Y = -z, Z = y.
Assemblies: body (frame, engine, bodywork) · swing (swingarm, pivots at PIV) · front (steered: clamps, outer fork tubes, bars)
            fork (steered + slides along the fork: stanchions, feet, calipers, axle) · wheelF / wheelR (centred on their axle on export)
Material prefixes tell the game which shader to use: P_ livery paint, M_ matte, X_ metal, G_ gloss, S_ screen."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

OUT = '/Users/benedikt/Desktop/Apex/blender/'
STAGES = globals().get('STAGES', ['chassis']); SHOTS = globals().get('SHOTS', []); EXPORT = globals().get('EXPORT', False); PREFIX = globals().get('PREFIX', 'duetto')

# ------------------------------------------------------------------ geometry of the real thing (metres)
WB = 1.42; HX = WB / 2                       # wheelbase
RF, RR = 0.315, 0.325                        # tyre radii (120/70-17, 180/55-17, a touch generous)
WF, WR = 0.062, 0.095                        # tyre half widths
RAKE = math.radians(24.0); OFFSET = 0.034    # steering head angle, fork offset -> ~103 mm trail
F = (HX, RF); A = (-HX, RR)                  # axles
U = (-math.sin(RAKE), math.cos(RAKE))        # up along the fork
N = (math.cos(RAKE), math.sin(RAKE))         # forward, square to the fork
FZ = 0.105                                   # fork tubes: half spacing
PIV = (-0.15, 0.43)                          # swingarm pivot
def fp(s, z=0.0): return (F[0] + U[0] * s, F[1] + U[1] * s, z)                                    # point on the fork tube line, s metres above the axle
def sp(s, z=0.0): return (F[0] - N[0] * OFFSET + U[0] * s, F[1] - N[1] * OFFSET + U[1] * s, z)    # same on the steering axis
def pol(c, r, a, z=0.0): return (c[0] + r * math.cos(a), c[1] + r * math.sin(a), z)

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
    m.diffuse_color = (*c, 1); m.metallic = 0.85 if name[0] == 'X' else 0.0; m.roughness = {'X': 0.38, 'G': 0.15, 'P': 0.3}.get(name[0], 0.62)   # viewport / preview look
    MATS[name] = m; return m

ASM = {'body': [], 'swing': [], 'front': [], 'fork': [], 'wheelF': [], 'wheelR': []}
def obj_from_bm(bm, name, m, asm, smooth_angle=38, subsurf=0, solid=0.0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('bk_' + name, me); scene.collection.objects.link(o); me.materials.append(m)
    if subsurf or solid:
        if solid: md = o.modifiers.new('t', 'SOLIDIFY'); md.thickness = solid; md.offset = 0.0
        if subsurf: mod = o.modifiers.new('s', 'SUBSURF'); mod.levels = subsurf; mod.render_levels = subsurf
        dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me2
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(smooth_angle): e.smooth = False
    bm.to_mesh(me); bm.free()
    o['asm'] = asm; ASM[asm].append(o); return o

# ------------------------------------------------------------------ primitives
def loft(name, secs, m, asm, ring=16, capA=True, capB=True, subsurf=0, xform=None):
    """sections: dict(x, y, w, ht, hb, wb, e, eb) -> superellipse ring in the y/z plane at x"""
    bm = bmesh.new(); rings = []
    for s in secs:
        e = s.get('e', 2.0); eb = s.get('eb', e); w = s['w']; wb = s.get('wb', w); ht = s.get('ht', 0.05); hb = s.get('hb', ht); r = []
        for k in range(ring):
            a = k / ring * math.pi * 2; c, sn = math.cos(a), math.sin(a); ee = e if sn >= 0 else eb
            zz = (w if sn >= 0 else wb) * math.copysign(abs(c) ** (2 / ee), c)
            yy = (ht if sn >= 0 else -hb) * abs(sn) ** (2 / ee)
            p = V(s['x'], s['y'] + yy, zz + s.get('z', 0.0))
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

def catmull(P, n):
    if n <= 1 or len(P) < 3: return P, [float(i) for i in range(len(P))]
    out, par = [], []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3)); par.append(i + t)
    out.append(P[-1]); par.append(len(P) - 1.0); return out, par
def at(v, u):
    if not isinstance(v, (list, tuple)): return v
    i = max(0, min(int(u), len(v) - 2)); f = u - i; return v[i] * (1 - f) + v[i + 1] * f

def tube(name, pts, r, m, asm, seg=12, closed_ends=True, smooth=1):
    """round tube along a polyline of game-space points (r: one radius or one per point); smooth > 1 bends it through the points"""
    bm = bmesh.new(); P = [V(*p) for p in pts]; rings = []; a = None
    if smooth > 1: P, par = catmull(P, smooth); r = [at(r, u) for u in par]
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        if a is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)); a = t.cross(up).normalized()
        else: a = (a - t * a.dot(t)).normalized()                       # carry the frame along: no twisting
        b = t.cross(a)
        rr = r[i] if isinstance(r, (list, tuple)) else r
        rings.append([bm.verts.new(p + (a * math.cos(k / seg * 6.2832) + b * math.sin(k / seg * 6.2832)) * rr) for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg): bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    if closed_ends: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, 50)

def rod(name, a, b, r, m, asm, seg=16):
    """straight round bar from a to b; r may be a list of radii spread evenly along it"""
    if isinstance(r, (list, tuple)):
        n = len(r) - 1; pts = [tuple(a[k] + (b[k] - a[k]) * i / n for k in range(3)) for i in range(n + 1)]
        return tube(name, pts, list(r), m, asm, seg)
    return tube(name, [a, b], r, m, asm, seg)

def sweep(name, pts, w, h, m, asm, e=5.0, ring=16, smooth=1, caps=True, sa=40):
    """box / oval section swept along a path: w = half width (sideways), h = half height (upwards), e = corner sharpness (2 round .. 8 square).
    w, h, e may be lists with one value per path point; smooth > 1 rounds the path."""
    P, par = catmull([V(*p) for p in pts], smooth); bm = bmesh.new(); rings = []; a = None
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        if a is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.92 else Vector((1, 0, 0)); a = t.cross(up).normalized()
        else: a = (a - t * a.dot(t)).normalized()
        b = a.cross(t).normalized(); ww, hh, ee = at(w, par[i]), at(h, par[i]), at(e, par[i]); r = []
        for k in range(ring):
            an = (k + 0.5) / ring * math.pi * 2; c, s = math.cos(an), math.sin(an)
            r.append(bm.verts.new(p + a * ww * math.copysign(abs(c) ** (2 / ee), c) + b * hh * math.copysign(abs(s) ** (2 / ee), s)))
        rings.append(r)
    for i in range(len(rings) - 1):
        for k in range(ring): bm.faces.new([rings[i][k], rings[i][(k + 1) % ring], rings[i + 1][(k + 1) % ring], rings[i + 1][k]])
    if caps: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, sa)

def hull(pts):
    pts = sorted(set((round(x, 5), round(y, 5)) for x, y in pts))
    def cr(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def circ(cx, cy, r, n=28): return [(cx + r * math.cos(k / n * 6.2832), cy + r * math.sin(k / n * 6.2832)) for k in range(n)]
def sector(c, r0, r1, a0, a1, n=10):
    return [(c[0] + r1 * math.cos(a0 + (a1 - a0) * k / n), c[1] + r1 * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)] + \
           [(c[0] + r0 * math.cos(a1 - (a1 - a0) * k / n), c[1] + r0 * math.sin(a1 - (a1 - a0) * k / n)) for k in range(n + 1)]

def plate(name, outline, th, m, asm, origin=(0, 0, 0), ex=(1, 0, 0), ey=(0, 1, 0), off=0.0, bevel=0.003, seg=2):
    """flat part: a 2D outline in the plane (ex, ey) through origin, th thick; with the default axes the plate stands upright along the bike and off = its z"""
    O, EX, EY = V(*origin), V(*ex), V(*ey); NZ = EX.cross(EY).normalized(); bm = bmesh.new()
    top = [bm.verts.new(O + EX * u + EY * v + NZ * (off + th / 2)) for u, v in outline]
    bot = [bm.verts.new(O + EX * u + EY * v + NZ * (off - th / 2)) for u, v in outline]; n = len(outline)
    ft = bm.faces.new(top); fb = bm.faces.new(list(reversed(bot)))
    for k in range(n): bm.faces.new([top[k], bot[k], bot[(k + 1) % n], top[(k + 1) % n]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel: bmesh.ops.bevel(bm, geom=list(set(list(ft.edges) + list(fb.edges))), offset=bevel, segments=seg, affect='EDGES', profile=0.5)
    return obj_from_bm(bm, name, m, asm, 35)

def inpoly(p, poly):
    x, y = p; c = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def cutplate(name, outer, holes, th, m, asm, origin=(0, 0, 0), ex=(1, 0, 0), ey=(0, 1, 0), off=0.0):
    """flat part with real cut-outs: outline and hole outlines in the plane (ex, ey), th thick"""
    from mathutils.geometry import delaunay_2d_cdt
    vin, ein = [], []
    for lp in [outer] + list(holes):
        b = len(vin); vin += [Vector((q[0], q[1])) for q in lp]; ein += [(b + i, b + (i + 1) % len(lp)) for i in range(len(lp))]
    vc, ed, fc, ov, oe, of = delaunay_2d_cdt(vin, ein, [], 0, 1e-7); imap = {}
    for oi, src in enumerate(ov):
        for si in src: imap[si] = oi
    O, EX, EY = V(*origin), V(*ex), V(*ey); NZ = EX.cross(EY).normalized(); bm = bmesh.new()
    top = [bm.verts.new(O + EX * v.x + EY * v.y + NZ * (off + th / 2)) for v in vc]; bot = [bm.verts.new(O + EX * v.x + EY * v.y + NZ * (off - th / 2)) for v in vc]
    for f in fc:
        c = (sum(vc[i].x for i in f) / len(f), sum(vc[i].y for i in f) / len(f))
        if not inpoly(c, outer) or any(inpoly(c, h) for h in holes): continue
        try: bm.faces.new([top[i] for i in f]); bm.faces.new([bot[i] for i in reversed(f)])
        except ValueError: pass
    for a, b in ein:
        a2, b2 = imap.get(a), imap.get(b)
        if a2 is None or b2 is None or a2 == b2: continue
        try: bm.faces.new([top[a2], bot[a2], bot[b2], top[b2]])
        except ValueError: pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, 35)

def panel(name, rows, th, m, asm, subsurf=2):
    """moulded panel: a grid of game-space points (rows of equal length) given thickness and rounded edges"""
    bm = bmesh.new(); G = [[bm.verts.new(V(*q)) for q in row] for row in rows]
    for i in range(len(G) - 1):
        for k in range(len(G[i]) - 1): bm.faces.new([G[i][k], G[i][k + 1], G[i + 1][k + 1], G[i + 1][k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m, asm, 40, subsurf, th)

def spin(name, a, b, prof, m, asm, seg=24, smooth=45, flip=False):
    """profile [(t, radius)] revolved round the axis a -> b (t = 0 at a, 1 at b). The profile may double back, e.g. to form a real bore; flip turns the faces inwards."""
    A, Bv = V(*a), V(*b); ax = Bv - A; t = ax.normalized(); up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)); e1 = t.cross(up).normalized(); e2 = t.cross(e1)
    bm = bmesh.new(); rings = [[bm.verts.new(A + ax * tt + (e1 * math.cos(k / seg * 6.2832) + e2 * math.sin(k / seg * 6.2832)) * r) for k in range(seg)] for (tt, r) in prof]
    for i in range(len(rings) - 1):
        for k in range(seg): bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if flip:
        for f in bm.faces: f.normal_flip()
    return obj_from_bm(bm, name, m, asm, smooth)

def hose(name, pts, r, m, asm, fit=None, smooth=6):
    """flexible line through the points, with a metal fitting on each end"""
    tube(name, pts, r, m, asm, seg=8, smooth=smooth)
    if fit:
        for k, (a, b) in enumerate(((pts[0], pts[1]), (pts[-1], pts[-2]))):
            d = Vector(b) - Vector(a); d.normalize(); rod('%s_fit%d' % (name, k), tuple(Vector(a) - d * 0.004), tuple(Vector(a) + d * 0.016), r * 1.7, fit, asm, seg=8)

def stripe(o, name, m, asm, bands=((0.0125, 0.06), (-0.06, -0.0125)), under=-0.3):
    """paint stripes: cut the finished surface along the stripe edges and hand the strips in between (everything but the underside) to another paint"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    for zc in sorted({z for b in bands for z in b}):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=V(0, 0, zc), plane_no=Vector((0, -1, 0)), clear_inner=False, clear_outer=False)
    bm.normal_update(); bm.faces.ensure_lookup_table()
    sel = [f for f in bm.faces if f.normal.z > under and any(lo < -f.calc_center_median().y < hi for lo, hi in bands)]
    bm2 = bmesh.new(); vm = {}
    for f in sel:
        vs = []
        for v in f.verts:
            if v not in vm: vm[v] = bm2.verts.new(v.co)
            vs.append(vm[v])
        bm2.faces.new(vs)
    bmesh.ops.delete(bm, geom=sel, context='FACES'); bm.to_mesh(o.data); bm.free()
    return obj_from_bm(bm2, name, m, asm, 60)

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

def coil(name, a, b, R, wire, turns, m, asm, n=14):
    """coil spring from a to b (points in the bike's centre plane)"""
    ax = (b[0] - a[0], b[1] - a[1]); L = math.hypot(*ax); e1 = (-ax[1] / L, ax[0] / L); pts = []
    for k in range(int(turns * n) + 1):
        f = k / (turns * n); an = f * turns * 6.2832
        pts.append((a[0] + ax[0] * f + e1[0] * math.cos(an) * R, a[1] + ax[1] * f + e1[1] * math.cos(an) * R, a[2] + math.sin(an) * R))
    return tube(name, pts, wire, m, asm, seg=6)

# ------------------------------------------------------------------ materials
P_body = mat('P_body', 'ffffff')
M_dark = mat('M_dark', '1c1e22'); M_tyre = mat('M_tyre', '1a1a1c'); M_red = mat('M_red', 'c8281e'); M_disc = mat('M_disc', 'a9adb2'); M_cal = mat('M_caliper', 'b28a2c')
M_spring = mat('M_spring', 'd8d9dc'); M_seat = mat('M_seat', '18191c'); M_groove = mat('M_groove', '070708'); M_resv = mat('M_resv', 'c9c6b4'); G_tail = mat('G_tail', 'ff2a1a')
X_header = mat('X_header', '8a6c48'); X_ti = mat('X_ti', '9a958c'); X_chain = mat('X_chain', '55585e'); M_engine = mat('M_engine', '2e3136')
X_brushed = mat('X_brushed', '9ea3aa'); FRAME = mat('G_frame', '141518'); G_stripe = mat('G_stripe', '0c0d0f'); M_bore = mat('M_bore', '050506'); M_lead = mat('M_lead', 'b3261c')
X_alu = mat('X_alu', 'b9bdc2'); X_steel = mat('X_steel', 'd6d8db'); X_frame = mat('X_frame', '41454c'); X_rim = mat('X_rimdark', '34373d'); X_cast = mat('X_cast', '7d8188')

# ================================================================== STAGE 1: rolling chassis
if 'chassis' in STAGES:
    # ---- steering head: the tube the whole frame hangs off
    rod('headstock', sp(0.523), sp(0.689), 0.033, FRAME, 'body', seg=20)
    rod('hs_cup0', sp(0.519), sp(0.533), 0.0365, X_steel, 'body', seg=20); rod('hs_cup1', sp(0.679), sp(0.693), 0.0365, X_steel, 'body', seg=20)

    # ---- trellis frame. Two rails per side run back from the head and fan out round the engine; short diagonals triangulate them.
    T = [(0.381, 0.8965, 0.032), (0.22, 0.855, 0.11), (0.00, 0.80, 0.132), (-0.21, 0.742, 0.115)]       # top rail: narrow enough for tank and seat to sit on it
    B = [(0.430, 0.787, 0.032), (0.275, 0.665, 0.108), (0.065, 0.575, 0.150), (-0.125, 0.537, 0.148)]   # bottom rail: drops away from the top rail, so the truss is deep in the middle
    L2 = (-0.215, 0.585, 0.142)                                                                          # rear lug on the pivot plate
    R1, R2 = (-0.44, 0.775, 0.112), (-0.645, 0.815, 0.082)                                               # seat rail
    ST = [L2, (-0.36, 0.69, 0.128), (-0.52, 0.7906, 0.1)]                                              # stay from the plate up to the seat rail
    def side(p, s): return (p[0], p[1], p[2] * s)
    for s in (-1, 1):
        tube('fr_top%d' % s, [side(p, s) for p in T], 0.014, FRAME, 'body', seg=12)
        tube('fr_bot%d' % s, [side(p, s) for p in B], 0.014, FRAME, 'body', seg=12)
        for k, (a, b) in enumerate(((B[0], T[1]), (T[1], B[1]), (B[1], T[2]), (T[2], B[2]), (B[2], T[3]), (T[3], B[3]), (T[3], L2))):
            rod('fr_d%d_%d' % (k, s), side(a, s), side(b, s), 0.0115, FRAME, 'body', seg=10)
        tube('sub_rail%d' % s, [side(p, s) for p in (T[3], R1, R2)], 0.0115, FRAME, 'body', seg=10)
        tube('sub_stay%d' % s, [side(p, s) for p in ST], 0.0105, FRAME, 'body', seg=10)
        rod('sub_brace%d' % s, side(ST[1], s), side((-0.33, 0.759, 0.1135), s), 0.009, FRAME, 'body', seg=8)
        # cast plate carrying the swingarm pivot, bolted to the ends of the rails
        plate('pivplate%d' % s, hull(circ(B[3][0], B[3][1] - 0.008, 0.027) + circ(L2[0], L2[1], 0.027) + circ(PIV[0], PIV[1], 0.047) + circ(-0.14, 0.345, 0.023)),
              0.016, X_frame, 'body', off=s * 0.142, bevel=0.004)
        cyl('pivcap%d' % s, 0.021, 0.008, (PIV[0], PIV[1], s * 0.153), X_steel, 'body', seg=18, bevel=0.002)
        for (bx, by) in ((B[3][0], B[3][1] - 0.008), (L2[0], L2[1]), (-0.14, 0.345)): cyl('pivbolt%d_%.2f' % (s, by), 0.008, 0.006, (bx, by, s * 0.152), X_steel, 'body', seg=10, bevel=0)
    for k, (x, y, z) in enumerate((T[1], T[3], R1, R2)):                                                 # cross tubes tying the two sides together
        rod('fr_x%d' % k, (x, y, -z), (x, y, z), 0.0115 if k < 2 else 0.0095, FRAME, 'body', seg=10)
    # gusset between the rails at the head
    plate('gusset', hull([sp(0.55)[:2], sp(0.66)[:2], (T[0][0] - 0.07, T[0][1] - 0.022), (B[0][0] - 0.06, B[0][1] - 0.03)]), 0.05, FRAME, 'body', bevel=0.004)

    # ---- swingarm: two aluminium box beams from the pivot out to the axle, a bridge in front of the tyre
    for s in (-1, 1):
        sweep('arm%d' % s, [(PIV[0] + 0.01, PIV[1], s * 0.105), (-0.34, 0.405, s * 0.122), (-0.56, 0.355, s * 0.152), (-0.765, 0.322, s * 0.156)],
              [0.019, 0.018, 0.016, 0.016], [0.043, 0.04, 0.033, 0.027], X_alu, 'swing', e=5.5, ring=16, smooth=5)
        box('adjuster%d' % s, (0.07, 0.04, 0.008), (A[0] - 0.012, A[1], s * 0.175), X_cast, 'swing', bevel=0.003)
        cyl('axlenut%d' % s, 0.019, 0.014, (A[0], A[1], s * 0.184), X_steel, 'swing', seg=6, bevel=0.002)
    for s in (-1, 1): cyl('pivboss%d' % s, 0.032, 0.04, (PIV[0], PIV[1], s * 0.105), X_alu, 'swing', seg=20, bevel=0.003)
    cyl('pivaxle', 0.011, 0.31, (PIV[0], PIV[1], 0), X_steel, 'body', seg=12, bevel=0)
    sweep('armbridge', [(-0.305, 0.412, -0.125), (-0.305, 0.412, 0.125)], 0.024, 0.036, X_alu, 'swing', e=5.5, ring=16)
    cyl('axleR', 0.011, 0.36, (A[0], A[1], 0), X_steel, 'swing', seg=12, bevel=0)
    # rear caliper under the right arm, on its carrier
    plate('rcarrier', hull(circ(A[0], A[1], 0.03) + circ(*pol(A, 0.085, math.radians(262))[:2], 0.02)), 0.008, X_cast, 'swing', off=0.118, bevel=0.002)
    plate('rcaliper', hull(circ(*pol(A, 0.104, math.radians(248))[:2], 0.03) + circ(*pol(A, 0.104, math.radians(274))[:2], 0.03)), 0.046, M_cal, 'swing', off=0.088, bevel=0.008)

    # ---- rear shock: damper body, piggyback reservoir and a coil spring between the frame cross tube and the bridge
    S0, S1 = (-0.20, 0.716, 0.0), (-0.325, 0.458, 0.0); sd = (S1[0] - S0[0], S1[1] - S0[1]); sl = math.hypot(*sd)
    def shp(f): return (S0[0] + sd[0] * f, S0[1] + sd[1] * f, 0.0)
    for s in (-1, 1):
        plate('shk_lugT%d' % s, hull(circ(S0[0], S0[1], 0.016) + circ(T[3][0], T[3][1], 0.014)), 0.006, FRAME, 'body', off=s * 0.02, bevel=0.0015)
        plate('shk_lugB%d' % s, hull(circ(S1[0], S1[1], 0.015) + circ(-0.305, 0.43, 0.02)), 0.006, X_alu, 'swing', off=s * 0.02, bevel=0.0015)
    cyl('shk_eyeT', 0.014, 0.034, S0, X_steel, 'body', seg=14, bevel=0.002); cyl('shk_eyeB', 0.013, 0.034, S1, X_steel, 'swing', seg=14, bevel=0.002)
    rod('shk_body', shp(0.06), shp(0.52), [0.021, 0.024, 0.024, 0.024], X_frame, 'body', seg=16)
    rod('shk_shaft', shp(0.5), shp(0.94), 0.0075, X_steel, 'body', seg=10)
    rod('shk_collarT', shp(0.115), shp(0.15), 0.039, X_alu, 'body', seg=20); rod('shk_collarB', shp(0.85), shp(0.885), 0.037, X_alu, 'body', seg=20)
    coil('shk_spring', shp(0.15), shp(0.85), 0.031, 0.0068, 7.5, M_spring, 'body')
    rod('shk_res', (S0[0] - 0.05, S0[1] - 0.015, 0.046), (S0[0] - 0.105, S0[1] - 0.125, 0.046), 0.019, X_alu, 'body', seg=14)

    # ---- fork: upside-down. Dark outer tubes held by the two clamps, chrome stanchions sliding in them, cast feet carrying axle and calipers
    for s in (-1, 1):
        z = s * FZ
        tube('forkO%d' % s, [fp(0.275, z), fp(0.30, z), fp(0.335, z), fp(0.728, z)], [0.0315, 0.0315, 0.0285, 0.0285], X_frame, 'front', seg=20)
        rod('forkseal%d' % s, fp(0.268, z), fp(0.277, z), 0.0295, M_dark, 'front', seg=20)
        rod('forkcap%d' % s, fp(0.728, z), fp(0.739, z), [0.024, 0.021], X_alu, 'front', seg=18); rod('forkadj%d' % s, fp(0.739, z), fp(0.748, z), 0.008, X_steel, 'front', seg=8)
        rod('forkS%d' % s, fp(0.07, z), fp(0.30, z), 0.0215, X_steel, 'fork', seg=20)
        tube('forkfoot%d' % s, [fp(-0.034, z), fp(-0.024, z), fp(0.03, z), fp(0.085, z), fp(0.095, z)], [0.02, 0.029, 0.03, 0.027, 0.0235], X_cast, 'fork', seg=18)
        cyl('axleboss%d' % s, 0.03, 0.05, (F[0], F[1], z), X_cast, 'fork', seg=18, bevel=0.004)
        # radial caliper behind the leg, on two lugs
        plate('callug%d' % s, hull(circ(F[0], F[1], 0.028) + circ(*pol(F, 0.105, math.radians(150))[:2], 0.013) + circ(*pol(F, 0.105, math.radians(196))[:2], 0.013)),
              0.02, X_cast, 'fork', off=s * 0.1, bevel=0.003)
        plate('caliperF%d' % s, hull([q for a in (156, 173, 190) for q in circ(*pol(F, 0.136, math.radians(a))[:2], 0.037)]), 0.056, M_cal, 'fork', off=s * 0.072, bevel=0.01)
        for a in (158, 173, 188): cyl('calpist%d_%d' % (s, a), 0.013, 0.008, pol(F, 0.136, math.radians(a), s * 0.101), M_dark, 'fork', seg=12, bevel=0.002)
    cyl('axleF', 0.0125, 0.26, (F[0], F[1], 0), X_steel, 'fork', seg=12, bevel=0)
    # triple clamps and stem
    yoke = lambda rt, rs: hull(circ(0, 0, rs) + circ(OFFSET, -FZ, rt) + circ(OFFSET, FZ, rt))
    plate('clampL', yoke(0.041, 0.037), 0.036, X_frame, 'front', origin=sp(0.498), ex=(N[0], N[1], 0), ey=(0, 0, 1), bevel=0.006)
    plate('clampU', yoke(0.039, 0.034), 0.022, X_frame, 'front', origin=sp(0.708), ex=(N[0], N[1], 0), ey=(0, 0, 1), bevel=0.005)
    rod('stem', sp(0.47), sp(0.722), 0.015, X_steel, 'front', seg=12); rod('stemnut', sp(0.72), sp(0.733), 0.021, X_steel, 'front', seg=6)
    for s in (-1, 1):
        for k, sv in enumerate((0.498, 0.708)): cyl('pinch%d_%d' % (s, k), 0.006, 0.02, (fp(sv)[0] + N[0] * 0.042, fp(sv)[1] + N[1] * 0.042, s * FZ), X_steel, 'front', axis='z', seg=8, bevel=0)

    # ---- wheels
    def wheel(asm, R, W, H, c2, discs, hubw, sprocket=None, ngroove=13, gdir=1):
        cx, cy = c2; c = (cx, cy, 0); Rc = R - H / 2; rr = R - H                 # tyre section centre, bead radius
        prof = [(rr + 0.003, -W * 0.80), (rr + 0.016, -W * 0.88)]
        for k in range(17):
            t = math.radians(-102 + 204 * k / 16); prof.append((Rc + (H / 2) * math.cos(t), W * 0.985 * math.sin(t)))
        prof += [(rr + 0.016, W * 0.88), (rr + 0.003, W * 0.80)]
        lathe(asm + '_tyre', prof, M_tyre, asm, 72, c, 80)
        # tread of a road-legal supersport tyre: long grooves sweeping from near the centre out to the shoulder, a short one between each pair
        ea, eb2 = H / 2, W * 0.985; bm = bmesh.new(); ctr = V(cx, cy, 0)
        def tp(t, th, lift=0.0007):
            ct, st = math.cos(t), math.sin(t); nr, nz = ct / ea, st / eb2; nl = math.hypot(nr, nz); rad = Rc + ea * ct + nr / nl * lift
            return V(cx + rad * math.cos(th), cy + rad * math.sin(th), eb2 * st + nz / nl * lift)
        for sg in (-1, 1):
            for k in range(ngroove):
                for (t0, t1, sw, w0, w1, ph) in ((0.17, 1.24, 0.32, 0.009, 0.004, 0.0), (0.66, 1.18, 0.15, 0.007, 0.0036, 0.56)):
                    prev = None
                    for i in range(9):
                        f = i / 8; t = sg * (t0 + (t1 - t0) * f); th = (k + ph + (0.5 if sg > 0 else 0)) / ngroove * 6.2832 + gdir * sw * f ** 1.25; dth = (w0 + (w1 - w0) * f) / 2 / R
                        cur = (bm.verts.new(tp(t, th - dth)), bm.verts.new(tp(t, th + dth)))
                        if prev:
                            fc = bm.faces.new([prev[0], prev[1], cur[1], cur[0]]); fc.normal_update(); o3 = fc.calc_center_median() - ctr; o3.y *= 0.3
                            if fc.normal.dot(o3) < 0: fc.normal_flip()
                        prev = cur
        obj_from_bm(bm, asm + '_tread', M_groove, asm, 80)
        rim = [(rr + 0.014, -W * 0.94), (rr + 0.014, -W * 0.83), (rr - 0.002, -W * 0.80), (rr - 0.002, W * 0.80), (rr + 0.014, W * 0.83), (rr + 0.014, W * 0.94),
               (rr - 0.012, W * 0.91), (rr - 0.024, W * 0.72), (rr - 0.024, -W * 0.72), (rr - 0.012, -W * 0.91), (rr + 0.014, -W * 0.94)]
        lathe(asm + '_rim', rim, X_rim, asm, 72, c, 35)
        for sg in (-1, 1):   # pinstripe on the rim flange
            zz = sg * (W * 0.936 + 0.0008); lathe('%s_stripe%d' % (asm, sg), [(rr + 0.0105, zz), (rr + 0.003, zz - sg * 0.0006), (rr + 0.003, zz - sg * 0.002), (rr + 0.0105, zz - sg * 0.002), (rr + 0.0105, zz)], M_red, asm, 72, c, 30)
        lathe(asm + '_hub', [(0.0, -hubw), (0.03, -hubw), (0.046, -hubw * 0.82), (0.05, -hubw * 0.35), (0.05, hubw * 0.35), (0.046, hubw * 0.82), (0.03, hubw), (0.0, hubw)], X_rim, asm, 28, c, 45)
        # five Y spokes: each leaves the hub as one and forks out to the rim
        r1 = rr - 0.022
        for k in range(5):
            a = k / 5 * math.pi * 2 + 0.3
            for sg in (-1, 1):
                sweep('%s_sp%d_%d' % (asm, k, sg), [pol(c2, 0.044, a + sg * 0.05), pol(c2, 0.115, a + sg * 0.10), pol(c2, r1 + 0.012, a + sg * 0.24)],
                      [min(hubw * 0.5, 0.03), 0.021, W * 0.32], [0.018, 0.013, 0.0115], X_rim, asm, e=3.2, ring=10, smooth=4)
        for z in discs:
            # drilled brake disc: steel friction ring, floating on an aluminium carrier with cut-out windows (front) / one-piece (rear)
            front = len(discs) > 1; d0, d1 = (0.121, 0.16) if front else (0.09, 0.1225); rows = (d0 + 0.0075, (d0 + d1) / 2, d1 - 0.0075) if front else (d0 + 0.008, d1 - 0.008); nh = 18 if front else 14
            drill = [circ(*pol(c2, rw, (k + j / len(rows)) / nh * 6.2832)[:2], 0.0033, 6) for j, rw in enumerate(rows) for k in range(nh)]
            cutplate(asm + '_disc%.2f' % z, circ(cx, cy, d1, 64), [circ(cx, cy, d0, 48)] + drill, 0.005, M_disc, asm, off=z)
            nb = 10 if front else 5; lobe = lambda a: (d0 - 0.022) + 0.027 * (0.5 + 0.5 * math.cos(nb * a)) ** 1.6
            star = [pol(c2, lobe(k / 90 * 6.2832) if front else d0 + 0.004, k / 90 * 6.2832)[:2] for k in range(90)]
            wins = [sector(c2, 0.058, d0 - 0.036 if front else d0 - 0.014, (k + 0.5) / 5 * 6.2832 - 0.36, (k + 0.5) / 5 * 6.2832 + 0.36, 4) for k in range(5)]
            bolts = [circ(*pol(c2, 0.045, k / 5 * 6.2832)[:2], 0.004, 6) for k in range(5)]
            cutplate(asm + '_carrier%.2f' % z, star, [circ(cx, cy, 0.031, 24)] + wins + bolts, 0.007, X_frame if front else M_disc, asm, off=z)
            if front:
                for k in range(nb): cyl('%s_bob%.2f_%d' % (asm, z, k), 0.0072, 0.0095, pol(c2, d0 + 0.0005, k / nb * 6.2832, z), X_steel, asm, seg=8, bevel=0)
        if sprocket:
            z = sprocket
            lathe(asm + '_cush', [(0.046, z + 0.008), (0.078, z + 0.008), (0.078, z + 0.04), (0.05, z + 0.045)], X_rim, asm, 28, c, 30)
            teeth = [pol(c2, 0.111 if k % 2 else 0.1045, k / 84 * 6.2832)[:2] for k in range(84)]
            cutplate(asm + '_sprocket', teeth, [circ(cx, cy, 0.062, 28)] + [circ(*pol(c2, 0.089, (k + 0.5) / 6 * 6.2832)[:2], 0.0105, 10) for k in range(6)], 0.006, X_steel, asm, off=z)
            for k in range(6): cyl('%s_spb%d' % (asm, k), 0.006, 0.012, pol(c2, 0.082, k / 6 * 6.2832, z), M_dark, asm, seg=8, bevel=0)
    wheel('wheelF', RF, WF, 0.095, F, [-0.072, 0.072], 0.069, ngroove=12, gdir=-1)
    wheel('wheelR', RR, WR, 0.105, A, [0.088], 0.085, sprocket=-0.118)


# ================================================================== STAGE 2: engine, exhaust, final drive, plumbing
if 'engine' in STAGES:
    # air-cooled 90-degree twin, tipped forward 15 degrees: one cylinder reaches for the front wheel, the other stands up under the tank
    EC = (0.0, 0.425); TILT = math.radians(15); D1 = (math.cos(TILT), math.sin(TILT)); D2 = (-math.sin(TILT), math.cos(TILT))
    def ept(d, r, q=0.0, z=0.0): return (EC[0] + d[0] * r - d[1] * q, EC[1] + d[1] * r + d[0] * q, z)    # r along the cylinder, q square to it
    def eo(x, y, z=0.0): return (EC[0] + x, EC[1] + y, z)                                               # relative to the crank
    def sq(hx, hz, e, n=28):
        return [(hx * math.copysign(abs(math.cos(a)) ** (2 / e), math.cos(a)), hz * math.copysign(abs(math.sin(a)) ** (2 / e), math.sin(a))) for a in [(k + 0.5) / n * 6.2832 for k in range(n)]]
    # crankcase: narrow enough to sit between the swingarm bosses - the pivot axle runs straight through its rear
    plate('crankcase', hull(circ(EC[0], EC[1], 0.128) + circ(*eo(-0.1, 0.025)[:2], 0.096) + circ(*eo(0.065, -0.065)[:2], 0.078) + circ(*eo(-0.09, -0.07)[:2], 0.068) + circ(*eo(0.05, 0.105)[:2], 0.032)),
          0.17, X_cast, 'body', bevel=0.014, seg=3)
    for tag, d in (('cylF', D1), ('cylR', D2)):
        nx = (-d[1], d[0], 0)
        rod(tag + '_barrel', ept(d, 0.09), ept(d, 0.24), 0.056, M_dark, 'body', seg=20)
        for k in range(8): plate('%s_fin%d' % (tag, k), sq(0.082, 0.088, 4.0), 0.0042, X_cast, 'body', origin=ept(d, 0.128 + k * 0.0145), ex=nx, ey=(0, 0, 1), bevel=0)
        plate(tag + '_head', sq(0.078, 0.084, 5.0), 0.075, X_cast, 'body', origin=ept(d, 0.277), ex=nx, ey=(0, 0, 1), bevel=0.008)
        for k in range(3): plate('%s_hfin%d' % (tag, k), sq(0.085, 0.091, 4.5), 0.0042, X_cast, 'body', origin=ept(d, 0.256 + k * 0.021), ex=nx, ey=(0, 0, 1), bevel=0)
        plate(tag + '_cover', sq(0.058, 0.068, 3.0), 0.03, X_alu, 'body', origin=ept(d, 0.328), ex=nx, ey=(0, 0, 1), bevel=0.011, seg=3)
        # spark plug cap and its lead, on the left of the head
        cap = ept(d, 0.287, 0.0, -0.088); rod(tag + '_plug', cap, (cap[0], cap[1] + 0.004, -0.118), 0.011, M_dark, 'body', seg=10)
    hose('leadF', [ept(D1, 0.287, 0.0, -0.116), ept(D1, 0.27, 0.07, -0.128), (0.215, 0.665, -0.118), (0.175, 0.745, -0.093)], 0.0042, M_lead, 'body')
    hose('leadR', [ept(D2, 0.287, 0.0, -0.116), ept(D2, 0.31, -0.05, -0.122), (-0.01, 0.775, -0.105), (0.06, 0.785, -0.09)], 0.0042, M_lead, 'body')
    # right side: belt covers from the layshaft in the V up to each cam, and the clutch
    LAY = eo(0.03, 0.09)
    for tag, d in (('beltF', D1), ('beltR', D2)):
        cam = ept(d, 0.285)
        plate(tag, hull(circ(LAY[0], LAY[1], 0.036) + circ(cam[0], cam[1], 0.033)), 0.028, M_dark, 'body', off=0.105, bevel=0.007)
        cyl(tag + '_cap', 0.019, 0.006, (cam[0], cam[1], 0.122), X_alu, 'body', seg=16, bevel=0.002)
    cyl('belt_capL', 0.017, 0.006, (LAY[0], LAY[1], 0.122), X_alu, 'body', seg=16, bevel=0.002)
    CL = eo(-0.045, 0.01)
    cyl('clutch', 0.07, 0.026, (CL[0], CL[1], 0.098), M_dark, 'body', seg=32, bevel=0.003)
    cutplate('clutchcover', circ(CL[0], CL[1], 0.071, 36), [sector(CL, 0.03, 0.054, k / 6 * 6.2832 - 0.3, k / 6 * 6.2832 + 0.3, 4) for k in range(6)], 0.006, X_alu, 'body', off=0.114)
    cyl('clutchhub', 0.021, 0.008, (CL[0], CL[1], 0.118), X_steel, 'body', seg=16, bevel=0.002)
    for k in range(6): cyl('clutchbolt%d' % k, 0.0045, 0.004, pol(CL, 0.063, (k + 0.5) / 6 * 6.2832, 0.118), X_steel, 'body', seg=6, bevel=0)
    # left side: alternator cover on the crank, sprocket cover behind it
    cyl('altcover', 0.088, 0.034, (EC[0], EC[1], -0.102), X_alu, 'body', seg=36, bevel=0.009)
    cyl('altcap', 0.03, 0.006, (EC[0], EC[1], -0.121), M_dark, 'body', seg=20, bevel=0.002)
    for k in range(6): cyl('altbolt%d' % k, 0.0045, 0.004, pol(EC, 0.075, k / 6 * 6.2832, -0.12), X_steel, 'body', seg=6, bevel=0)
    SPR = (-0.075, 0.445)
    plate('sprocketcover', hull(circ(SPR[0], SPR[1], 0.05) + circ(-0.025, 0.50, 0.034)), 0.018, M_dark, 'body', off=-0.137, bevel=0.005)
    rod('clutchslave', (-0.025, 0.50, -0.143), (-0.025, 0.50, -0.166), [0.017, 0.015], X_alu, 'body', seg=12)
    cyl('oilfilter', 0.03, 0.065, eo(0.168, -0.08, -0.035), M_dark, 'body', axis='x', seg=18, bevel=0.006)
    # the engine is a stressed member: bolted into the frame in the V (lugs hanging off the lower rails) and at the pivot plates
    MNT = eo(0.05, 0.11)
    for s in (-1, 1):
        plate('mnt_lug%d' % s, hull(circ(B[2][0], B[2][1], 0.016) + circ(MNT[0], MNT[1], 0.017)), 0.008, FRAME, 'body', off=s * 0.146, bevel=0.002)
        cyl('mnt_spacer%d' % s, 0.012, 0.057, (MNT[0], MNT[1], s * 0.1135), X_steel, 'body', seg=12, bevel=0)
        cyl('mnt_head%d' % s, 0.0095, 0.006, (MNT[0], MNT[1], s * 0.153), X_steel, 'body', seg=6, bevel=0)
        cyl('mnt_spacerR%d' % s, 0.012, 0.049, (-0.14, 0.345, s * 0.1095), X_steel, 'body', seg=12, bevel=0)
    # final drive: front sprocket on the gearbox, chain round to the rear sprocket
    lathe('sprocketF', [(0.012, -0.123), (0.04, -0.121), (0.04, -0.115), (0.012, -0.113)], X_steel, 'body', 20, (SPR[0], SPR[1], 0), 30)
    r1, r2 = 0.044, 0.113; dx, dy = SPR[0] - A[0], SPR[1] - A[1]; Dc = math.hypot(dx, dy); phi = math.atan2(dy, dx); al = math.acos((r2 - r1) / Dc); loop = []
    for k in range(21): loop.append(pol(A, r2, phi + al + (2 * math.pi - 2 * al) * k / 20, -0.118))
    for k in range(13): loop.append(pol(SPR, r1, phi - al + 2 * al * k / 12, -0.118))
    loop.append(loop[0])
    sweep('chain', loop, 0.0085, 0.0062, X_chain, 'swing', e=4.0, ring=8, caps=False)

    # ---- exhaust: two bronze headers into a collector under the engine, then a short upswept race megaphone on the right
    HR, RR2 = 0.0225, 0.021; YU = 0.252                    # YU: height of the pipes under the engine
    pf = ept(D1, 0.275, -0.078)
    tube('headerF', [pf, (pf[0] + 0.012, pf[1] - 0.055, 0.0), (0.275, YU + 0.05, 0.03), (0.205, YU + 0.012, 0.06), (0.08, YU, 0.08), (-0.08, YU, 0.085), (-0.175, YU + 0.004, 0.086)], HR, X_header, 'body', seg=14, smooth=5)
    pr = ept(D2, 0.275, 0.078)
    tube('headerR', [pr, (pr[0] - 0.03, pr[1] - 0.008, 0.04), (-0.208, 0.622, 0.07), (-0.222, 0.54, 0.068), (-0.222, 0.38, 0.066), (-0.224, YU + 0.062, 0.07), (-0.245, YU + 0.026, 0.086), (-0.278, YU + 0.01, 0.094)],
         RR2, X_header, 'body', seg=14, smooth=5)
    for tag, q, d in (('F', pf, (D1[1], -D1[0])), ('R', pr, (-D2[1], D2[0]))):      # port flanges
        rod('flange' + tag, (q[0] - d[0] * 0.004, q[1] - d[1] * 0.004, 0), (q[0] + d[0] * 0.008, q[1] + d[1] * 0.008, 0), 0.033, X_steel, 'body', seg=14)
    E0, E1 = (-0.44, 0.335, 0.18), (-0.79, 0.53, 0.232)
    tube('collector', [(-0.165, YU + 0.004, 0.086), (-0.20, YU + 0.005, 0.088), (-0.275, YU + 0.008, 0.094), (-0.33, YU + 0.02, 0.117), (-0.385, YU + 0.048, 0.148), E0], [0.026, 0.03, 0.03, 0.027, 0.026, 0.026], X_header, 'body', seg=16, smooth=4)
    def ecan(t): return tuple(E0[k] + (E1[k] - E0[k]) * t for k in range(3))
    spin('can', E0, E1, [(0.0, 0.027), (0.11, 0.045), (0.14, 0.047), (0.90, 0.058), (0.925, 0.0585)], X_ti, 'body')
    spin('can_cap', E0, E1, [(0.925, 0.0592), (0.985, 0.0588), (1.0, 0.0555), (1.0, 0.0475)], M_dark, 'body')
    # a real outlet: bright lip, then the bore runs well back into the can
    spin('can_lip', E0, E1, [(1.0, 0.0475), (1.008, 0.047), (1.008, 0.0435), (0.985, 0.043)], X_steel, 'body')
    spin('can_bore', E0, E1, [(0.985, 0.043), (0.80, 0.042), (0.62, 0.036), (0.56, 0.0015)], M_bore, 'body', flip=True)
    rod('can_band', ecan(0.38), ecan(0.43), [0.0525, 0.0533], M_dark, 'body', seg=24)
    hb = ecan(0.405)
    plate('can_hanger', hull(circ(hb[0], hb[1] + 0.03, 0.016) + circ(-0.45, 0.745, 0.011)), 0.005, M_dark, 'body', off=0.152, bevel=0.0015)
    cyl('can_hbolt', 0.008, 0.042, (-0.45, 0.745, 0.133), X_steel, 'body', seg=8, bevel=0)

    # ---- intake: both heads breathe from the airbox between the frame rails
    loft('airbox', [dict(x=0.315, y=0.745, w=0.05, ht=0.04, hb=0.05, e=3), dict(x=0.26, y=0.745, w=0.085, ht=0.06, hb=0.07, e=4), dict(x=0.06, y=0.745, w=0.09, ht=0.06, hb=0.065, e=4),
                    dict(x=0.012, y=0.752, w=0.07, ht=0.04, hb=0.04, e=3)], M_dark, 'body', ring=16, subsurf=1)
    qi = ept(D1, 0.275, 0.076); rod('intakeF', qi, (0.20, 0.69, 0.0), [0.03, 0.027, 0.03], M_dark, 'body', seg=14)
    rod('intakeF_tb', (qi[0] * 0.5 + 0.10, qi[1] * 0.5 + 0.345 - 0.012, 0), (qi[0] * 0.5 + 0.10, qi[1] * 0.5 + 0.345 + 0.012, 0), 0.034, X_alu, 'body', seg=14)
    qi = ept(D2, 0.275, -0.076); rod('intakeR', qi, (0.05, 0.725, 0.0), [0.03, 0.027, 0.03], M_dark, 'body', seg=14)

    # ---- everything that makes an engine bay look lived in: oil cooler and its lines, breather, wiring, battery tray
    OC = (0.348, 0.648)
    plate('oilcooler', sq(0.036, 0.098, 6.0, 20), 0.024, M_dark, 'body', origin=(OC[0], OC[1], 0), ex=(U[0], U[1], 0), ey=(0, 0, 1), bevel=0.003)
    for k in range(6): rod('oilcooler_fin%d' % k, (OC[0] + U[0] * (-0.027 + k * 0.0108) + N[0] * 0.0125, OC[1] + U[1] * (-0.027 + k * 0.0108) + N[1] * 0.0125, -0.09), (OC[0] + U[0] * (-0.027 + k * 0.0108) + N[0] * 0.0125, OC[1] + U[1] * (-0.027 + k * 0.0108) + N[1] * 0.0125, 0.09), 0.0028, X_alu, 'body', seg=5)
    for s in (-1, 1):
        rod('oilcooler_tank%d' % s, (OC[0] - U[0] * 0.038, OC[1] - U[1] * 0.038, s * 0.105), (OC[0] + U[0] * 0.038, OC[1] + U[1] * 0.038, s * 0.105), 0.0135, X_alu, 'body', seg=10)
        rod('oilcooler_stay%d' % s, (OC[0] - 0.008, OC[1] + 0.02, s * 0.108), side(B[1], s), 0.005, FRAME, 'body', seg=6)
    hose('oilline0', [(OC[0] - U[0] * 0.04, OC[1] - U[1] * 0.04, -0.105), (0.315, 0.565, -0.118), (0.19, 0.525, -0.112), (0.105, 0.50, -0.104), eo(0.085, 0.045, -0.088)], 0.0058, X_chain, 'body', fit=X_alu)
    hose('oilline1', [(OC[0] - U[0] * 0.04, OC[1] - U[1] * 0.04, 0.105), (0.33, 0.56, 0.128), (0.30, 0.44, 0.128), (0.21, 0.36, 0.112), eo(0.13, -0.075, 0.088)], 0.0058, X_chain, 'body', fit=X_alu)
    hose('breather', [eo(-0.035, 0.135, 0.045), (-0.02, 0.62, 0.095), (0.02, 0.70, 0.098), (0.06, 0.73, 0.088)], 0.0075, M_dark, 'body')
    hose('loom', [(0.35, 0.862, -0.045), (0.22, 0.83, -0.092), (0.0, 0.776, -0.116), (-0.2, 0.722, -0.1), (-0.3, 0.728, -0.07)], 0.0068, M_dark, 'body')
    box('battery', (0.15, 0.06, 0.15), (-0.37, 0.735, 0), M_dark, 'body', bevel=0.012)
    for s in (-1, 1): cyl('batterypole%d' % s, 0.008, 0.01, (-0.33, 0.768, s * 0.045), X_steel if s > 0 else M_lead, 'body', axis='y', seg=8, bevel=0.001)

# ================================================================== STAGE 3: bodywork
if 'body' in STAGES:
    def rail(x, k2=1):                                     # height (k2=1) / half width (k2=2) of the top rail at x
        for k in range(len(T) - 1):
            if T[k + 1][0] <= x <= T[k][0]: f = (x - T[k][0]) / (T[k + 1][0] - T[k][0]); return T[k][k2] + (T[k + 1][k2] - T[k][k2]) * f
        return T[0][k2] if x > T[0][0] else T[-1][k2]
    # tank: sits on the top rails, tall and broad at the front, pulled in between the knees
    TK = [(0.335, 0.995, 0.115, 0.105, 0.008, 3.2), (0.31, 1.03, 0.160, 0.150, 0.008, 3.4), (0.25, 1.054, 0.192, 0.176, 0.010, 3.4), (0.15, 1.066, 0.198, 0.178, 0.014, 3.2),
          (0.04, 1.05, 0.185, 0.160, 0.016, 3.0), (-0.06, 1.008, 0.156, 0.140, 0.022, 2.7), (-0.16, 0.948, 0.126, 0.118, 0.022, 2.5), (-0.245, 0.885, 0.09, 0.082, 0.03, 2.4), (-0.27, 0.86, 0.03, 0.028, 0.045, 2.2)]
    secs = []                                              # x, top, half width, half width low, gap above the rail, shoulder squareness
    for (x, top, w, wb, gap, e) in TK:
        bot = rail(x) + gap; yc = bot + (top - bot) * 0.44
        secs.append(dict(x=x, y=yc, w=w, wb=wb, ht=top - yc, hb=yc - bot, e=e, eb=3.6))
    stripe(loft('tank', secs, X_brushed, 'body', ring=20, subsurf=2), 'tank_stripes', G_stripe, 'body')
    cyl('fuelcap', 0.036, 0.012, (0.16, 1.058, 0), X_alu, 'body', axis='y', seg=24, bevel=0.003)
    cyl('fuelcap_lid', 0.024, 0.004, (0.16, 1.066, 0), M_dark, 'body', axis='y', seg=20, bevel=0.0015)
    # tank side panels: hang from under the tank's front edge down over the airbox, bolted to stand-offs on the frame rails
    for s in (-1, 1):
        rows = [[(0.338, 0.915, 0.112), (0.26, 0.893, 0.166), (0.15, 0.868, 0.168), (0.045, 0.842, 0.152)],
                [(0.348, 0.835, 0.122), (0.272, 0.805, 0.162), (0.165, 0.782, 0.163), (0.07, 0.785, 0.148)],
                [(0.342, 0.75, 0.116), (0.278, 0.716, 0.146), (0.185, 0.712, 0.15), (0.10, 0.742, 0.142)]]
        panel('shroud%d' % s, [[side(q, s) for q in row] for row in rows], 0.009, X_brushed, 'body')
        for (bx, by, z0, z1) in ((0.235, 0.848, 0.104, 0.166), (0.262, 0.728, 0.108, 0.152)):
            cyl('shroud_post%d_%.2f' % (s, by), 0.006, z1 - z0, (bx, by, s * (z0 + z1) / 2), FRAME, 'body', seg=8, bevel=0)
            cyl('shroud_bolt%d_%.2f' % (s, by), 0.0085, 0.005, (bx, by, s * (z1 + 0.004)), X_steel, 'body', seg=6, bevel=0)
    # seat: the rider's pad on the seat rails, running up onto the tank at the front
    loft('seat', [dict(x=-0.175, y=0.815, w=0.085, ht=0.03, hb=0.028, e=2.6), dict(x=-0.25, y=0.798, w=0.128, ht=0.03, hb=0.03, e=2.8), dict(x=-0.34, y=0.79, w=0.158, ht=0.03, hb=0.03, e=3.0),
                  dict(x=-0.43, y=0.80, w=0.152, ht=0.036, hb=0.03, e=3.0), dict(x=-0.485, y=0.822, w=0.132, ht=0.042, hb=0.034, e=2.8)], M_seat, 'body', ring=18, subsurf=2)
    # tail: painted single-seat cowl over the end of the subframe, dark tray underneath; two racing stripes run over tank and cowl
    stripe(loft('tail', [dict(x=-0.40, y=0.772, w=0.136, ht=0.02, hb=0.034, e=3.0), dict(x=-0.47, y=0.80, w=0.142, ht=0.052, hb=0.044, e=3.0), dict(x=-0.55, y=0.826, w=0.132, ht=0.064, hb=0.044, e=3.0),
                         dict(x=-0.64, y=0.848, w=0.11, ht=0.05, hb=0.038, e=3.0), dict(x=-0.715, y=0.862, w=0.088, ht=0.032, hb=0.03, e=3.2), dict(x=-0.738, y=0.864, w=0.076, ht=0.024, hb=0.024, e=3.4)],
                X_brushed, 'body', ring=18, subsurf=2), 'tail_stripes', G_stripe, 'body')
    loft('undertray', [dict(x=-0.44, y=0.758, w=0.105, ht=0.012, hb=0.02, e=3.0), dict(x=-0.60, y=0.80, w=0.092, ht=0.012, hb=0.024, e=3.0), dict(x=-0.72, y=0.836, w=0.066, ht=0.01, hb=0.016, e=3.0)],
         M_dark, 'body', ring=12, subsurf=1)
    # tail light: an LED bar set into the end of the tail
    box('taillight_bezel', (0.012, 0.03, 0.128), (-0.741, 0.863, 0), M_dark, 'body', bevel=0.005)
    box('taillight', (0.012, 0.016, 0.112), (-0.7445, 0.863, 0), G_tail, 'body', bevel=0.004)['noexport'] = 1      # the game puts its own glowing brake light here

# ================================================================== STAGE 4: controls
if 'controls' in STAGES:
    BC = sp(0.776)                                         # centre of the handlebar, above the top clamp
    HB = [(0.0, 0.0, 0.0), (0.0, 0.0, 0.09), (-0.006, 0.02, 0.16), (-0.04, 0.045, 0.26), (-0.075, 0.047, 0.385)]      # one half of the bar, relative to its centre
    def bar(z, dx=0.0, dy=0.0):                            # point on the bar at lateral position z (either side)
        a = abs(z); sg = 1 if z >= 0 else -1
        for k in range(len(HB) - 1):
            if HB[k][2] <= a <= HB[k + 1][2] + 1e-9:
                f = (a - HB[k][2]) / (HB[k + 1][2] - HB[k][2]); return (BC[0] + HB[k][0] + (HB[k + 1][0] - HB[k][0]) * f + dx, BC[1] + HB[k][1] + (HB[k + 1][1] - HB[k][1]) * f + dy, z)
        d = (HB[-1][0] - HB[-2][0]) / (HB[-1][2] - HB[-2][2]); return (BC[0] + HB[-1][0] + d * (a - HB[-1][2]) + dx, BC[1] + HB[-1][1] + dy, z)
    half = [(BC[0] + q[0], BC[1] + q[1], q[2]) for q in HB]
    tube('handlebar', [(q[0], q[1], -q[2]) for q in reversed(half[1:])] + half, [0.011, 0.011, 0.0125, 0.0143, 0.0143, 0.0143, 0.0125, 0.011, 0.011], M_dark, 'front', seg=12, smooth=5)
    for s in (-1, 1):
        # riser clamp on the top fork clamp
        rod('riser%d' % s, sp(0.716, s * 0.052), sp(0.768, s * 0.052), [0.0165, 0.0145, 0.0155], X_frame, 'front', seg=14)
        cyl('barclamp%d' % s, 0.0235, 0.034, (BC[0], BC[1], s * 0.052), X_frame, 'front', seg=20, bevel=0.004)
        for dz in (-0.011, 0.011): rod('barbolt%d_%d' % (s, dz > 0), (BC[0] + U[0] * 0.02 + N[0] * 0.012, BC[1] + U[1] * 0.02 + N[1] * 0.012, s * 0.052 + dz), (BC[0] + U[0] * 0.027 + N[0] * 0.012, BC[1] + U[1] * 0.027 + N[1] * 0.012, s * 0.052 + dz), 0.0045, X_steel, 'front', seg=6)
        # grip, flange, bar-end weight
        tube('grip%d' % s, [bar(s * 0.268), bar(s * 0.385)], 0.0168, M_tyre, 'front', seg=14)
        tube('gripflange%d' % s, [bar(s * 0.262), bar(s * 0.268)], 0.0205, M_tyre, 'front', seg=14)
        tube('barend%d' % s, [bar(s * 0.385), bar(s * 0.405)], [0.0155, 0.0135], X_alu, 'front', seg=12)
        # switch housing, lever perch with its master cylinder, fluid reservoir, lever
        g0 = bar(s * 0.238); px, py = g0[0], g0[1]
        tube('switch%d' % s, [bar(s * 0.212), bar(s * 0.256)], 0.021, M_dark, 'front', seg=10)
        rod('master%d' % s, (px + 0.012, py - 0.004, s * 0.206), (px + 0.082, py - 0.016, s * 0.2), [0.0125, 0.0115, 0.0105], X_frame, 'front', seg=12)
        tube('perch%d' % s, [bar(s * 0.196), bar(s * 0.21)], 0.0185, X_frame, 'front', seg=12)
        piv = (px + 0.062, py - 0.014, s * 0.207)
        cyl('leverpivot%d' % s, 0.0075, 0.02, piv, X_steel, 'front', axis='y', seg=10, bevel=0.001)
        sweep('lever%d' % s, [(piv[0] - 0.012, piv[1] - 0.001, s * 0.198), (piv[0] + 0.006, piv[1] - 0.002, s * 0.225), (piv[0] + 0.002, piv[1] - 0.004, s * 0.30), (piv[0] - 0.022, piv[1] - 0.004, s * 0.375), (piv[0] - 0.034, piv[1] - 0.004, s * 0.398)],
              [0.006, 0.0055, 0.0045, 0.004, 0.0045], [0.0085, 0.0075, 0.006, 0.0052, 0.0065], X_alu, 'front', e=3.0, ring=8, smooth=4)
        rr = 0.0195 if s > 0 else 0.016; rc = (px + 0.052, py + 0.03, s * 0.185)                 # brake reservoir right, the smaller clutch one left
        cyl('resv%d' % s, rr, 0.03, rc, M_resv, 'front', axis='y', seg=18, bevel=0.003)
        cyl('resvcap%d' % s, rr + 0.002, 0.009, (rc[0], rc[1] + 0.019, rc[2]), M_dark, 'front', axis='y', seg=18, bevel=0.002)
        rod('resvarm%d' % s, (px + 0.045, py - 0.006, s * 0.202), (rc[0], rc[1] - 0.014, rc[2]), 0.0042, X_steel, 'front', seg=6)
    # hydraulics and cables: brake line to a splitter on the lower clamp and down the back of each leg to its caliper; clutch line and throttle cable into the frame
    mr, ml = bar(0.238), bar(-0.238); SPL = (sp(0.498)[0] + N[0] * 0.064, sp(0.498)[1] + N[1] * 0.064, 0.0)
    box('brakesplit', (0.02, 0.02, 0.04), SPL, X_alu, 'front', rot=(0, 0, RAKE), bevel=0.004)
    hose('brakeline', [(mr[0] + 0.082, mr[1] - 0.016, 0.2), (0.47, 0.955, 0.168), (0.515, 0.868, 0.088), (SPL[0] + 0.004, SPL[1] + 0.014, 0.012)], 0.0048, X_chain, 'front', fit=X_alu)
    for s in (-1, 1):
        q1, q2 = fp(0.44), fp(0.2)
        hose('brakeleg%d' % s, [(SPL[0], SPL[1] - 0.006, s * 0.014), (q1[0] + N[0] * 0.02, q1[1] + N[1] * 0.02, s * 0.058), (fp(0.36)[0] - N[0] * 0.036, fp(0.36)[1] - N[1] * 0.036, s * 0.084),
                                (q2[0] - N[0] * 0.046, q2[1] - N[1] * 0.046, s * 0.092), pol(F, 0.17, math.radians(166), s * 0.09)], 0.0045, X_chain, 'front', fit=X_alu)
    J = (sp(0.60)[0] - N[0] * 0.05, sp(0.60)[1] - N[1] * 0.05)                 # just behind the steering head: lines pass from the bars into the frame here
    hose('clutchline_a', [(ml[0] + 0.082, ml[1] - 0.016, -0.2), (0.46, 0.95, -0.15), (0.43, 0.875, -0.07), (J[0], J[1], -0.036)], 0.0045, X_chain, 'front', fit=X_alu)
    hose('throttle_a', [(mr[0] + 0.025, mr[1] - 0.02, 0.222), (0.455, 0.965, 0.13), (0.43, 0.885, 0.07), (J[0], J[1], 0.036)], 0.0036, M_dark, 'front')
    # race number plate where the headlight would be: carried on four stays clamped to the fork tubes, painted in the rider's colour
    NP = (fp(0.60)[0] + N[0] * 0.076, fp(0.60)[1] + N[1] * 0.076, 0.0)
    plate('numplate', [(u, v) for (u, v) in [(q[1], q[0]) for q in [(0.105 * math.copysign(abs(math.cos(a)) ** (2 / 3.6), math.cos(a)), 0.125 * math.copysign(abs(math.sin(a)) ** (2 / 3.6), math.sin(a))) for a in [(k + 0.5) / 36 * 6.2832 for k in range(36)]]]],
          0.006, P_body, 'front', origin=NP, ex=(0, 0, 1), ey=(U[0], U[1], 0), bevel=0.002)
    for s in (-1, 1):
        for sv in (0.555, 0.655):
            rod('np_clamp%d_%.2f' % (s, sv), fp(sv - 0.009, s * FZ), fp(sv + 0.009, s * FZ), 0.0335, X_frame, 'front', seg=16)
            q = fp(sv, s * FZ); rod('np_stay%d_%.2f' % (s, sv), (q[0] + N[0] * 0.03, q[1] + N[1] * 0.03, q[2]), (q[0] + N[0] * 0.074, q[1] + N[1] * 0.074, q[2]), 0.006, M_dark, 'front', seg=8)
    # rearsets: a plate bolted to the frame carries the footpeg; brake pedal on the right, gear lever with its rod on the left
    PEG = (-0.25, 0.45)
    for s in (-1, 1):
        plate('rs_plate%d' % s, hull(circ(-0.215, 0.585, 0.016) + circ(-0.14, 0.345, 0.014) + circ(PEG[0], PEG[1], 0.022) + circ(-0.285, 0.49, 0.016)), 0.007, X_frame, 'body', off=s * 0.155, bevel=0.002)
        rod('rs_peg%d' % s, (PEG[0], PEG[1], s * 0.158), (PEG[0], PEG[1], s * 0.238), [0.0125, 0.0115, 0.0115, 0.0125], X_alu, 'body', seg=10)
        cyl('rs_pegbolt%d' % s, 0.011, 0.006, (PEG[0], PEG[1], s * 0.152), X_steel, 'body', seg=6, bevel=0)
        plate('rs_heel%d' % s, hull(circ(PEG[0] - 0.02, PEG[1] + 0.03, 0.02) + circ(-0.31, 0.535, 0.028) + circ(-0.30, 0.47, 0.018)), 0.004, M_dark, 'body', off=s * 0.161, bevel=0.0012)
        tip = (-0.125, 0.432, s * 0.2)
        sweep('rs_lever%d' % s, [(PEG[0] + 0.005, PEG[1] - 0.012, s * 0.166), (-0.19, 0.428, s * 0.168), (tip[0], tip[1], s * 0.172)], [0.004, 0.004, 0.004], [0.009, 0.0075, 0.007], X_alu, 'body', e=3.0, ring=8)
        rod('rs_toe%d' % s, (tip[0], tip[1], s * 0.17), (tip[0], tip[1], s * 0.215), 0.0075, X_alu if s > 0 else M_tyre, 'body', seg=8)
    rod('rs_shiftrod', (-0.21, 0.41, -0.168), (-0.085, 0.385, -0.15), 0.004, X_steel, 'body', seg=6)
    rod('rs_master', (-0.262, 0.50, 0.166), (-0.275, 0.575, 0.166), [0.011, 0.0105, 0.009], X_frame, 'body', seg=10)
    if 'engine' in STAGES:
        hose('clutchline_b', [(J[0], J[1], -0.036), (0.33, 0.795, -0.078), (0.24, 0.685, -0.128), (0.08, 0.585, -0.162), (-0.01, 0.525, -0.17), (-0.025, 0.50, -0.166)], 0.0045, X_chain, 'body')
        hose('throttle_b', [(J[0], J[1], 0.036), (0.33, 0.80, 0.05), (0.26, 0.70, 0.04), (0.215, 0.655, 0.03)], 0.0036, M_dark, 'body')

res = {k: sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in L) for k, L in ASM.items()}

# ------------------------------------------------------------------ preview shots (workbench: quick, clean, shows the form)
if SHOTS:
    cam = bpy.data.objects.new('bk_cam', bpy.data.cameras.new('bk_cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.clip_end = 200
    scene.render.engine = 'BLENDER_WORKBENCH'; sh = scene.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.show_shadows = False
    sh.show_object_outline = True; sh.object_outline_color = (0.05, 0.05, 0.06); sh.show_specular_highlight = True; sh.show_backface_culling = True
    try: scene.display.render_aa = '16'
    except Exception: pass
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.get('bkPrev') or bpy.data.worlds.new('bkPrev'); scene.world.color = lin('d9dade')
    scene.render.resolution_x, scene.render.resolution_y = globals().get('RES', (1800, 1100)); scene.render.image_settings.file_format = 'PNG'
    C = V(0, 0.52, 0)
    DIRS = {'side': ((0, 0.0, 1), 0), 'sideL': ((0, 0.0, -1), 0), 'front': ((1, 0.03, 0), 0), 'rear': ((-1, 0.05, 0), 0), 'top': ((0.001, 1, 0), 0),
            'q1': ((0.8, 0.32, 1), 1), 'q2': ((0.8, 0.32, -1), 1), 'low': ((0.5, -0.12, 1), 1), 'q3': ((-0.85, 0.36, 1), 1), 'q4': ((-0.85, 0.36, -1), 1)}
    CLOSE = {'cock': ((-0.42, 1.42, 0.0), (0.45, 0.93, 0.0), 30), 'bars': ((1.25, 1.45, 0.75), (0.33, 1.0, 0.0), 70), 'tail': ((-1.75, 1.2, 0.8), (-0.5, 0.78, 0.0), 70), 'tyre': ((1.55, 0.55, 0.55), (0.71, 0.33, 0.0), 80), 'pipe': ((-1.9, 0.75, 0.62), (-0.7, 0.5, 0.21), 110), 'bay': ((0.55, 0.75, -1.5), (0.1, 0.56, 0.0), 75), 'bayR': ((0.55, 0.75, 1.5), (0.1, 0.56, 0.0), 75)}
    for v in SHOTS:
        d, persp = DIRS.get(v, ((1, 0.3, 1), 1)); dv = V(*d).normalized(); ortho = not persp
        cam.data.type = 'ORTHO' if ortho else 'PERSP'; cam.data.ortho_scale = 2.35; cam.data.lens = 200
        cam.location = C + dv * (20 if ortho else 14.5)
        cam.rotation_euler = (C - cam.location).to_track_quat('-Z', 'Y').to_euler()
        if v == 'top': cam.location = C + Vector((0, 0, 20)); cam.rotation_euler = (0, 0, 0)
        if v in ('front', 'rear'): cam.data.ortho_scale = 1.5
        if v in CLOSE: eye, tgt, lens = CLOSE[v]; cam.data.type = 'PERSP'; cam.data.lens = lens; cam.location = V(*eye); cam.rotation_euler = (V(*tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = OUT + 'renders/' + PREFIX + '_' + v + '.png'; bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)

# ------------------------------------------------------------------ bake AO into vertex colours and export the game assemblies
if EXPORT:
    GAME = {'body': ['body', 'swing'], 'front': ['front', 'fork'], 'wheelF': ['wheelF'], 'wheelR': ['wheelR']}     # until the game animates the suspension
    for k in ASM: ASM[k] = [o for o in ASM[k] if not o.get('noexport')]
    for o in [o for o in scene.objects if o.get('noexport')]: o.hide_render = True
    allobj = [o for L in ASM.values() for o in L]
    for o in allobj:
        me = o.data
        for a in list(me.color_attributes): me.color_attributes.remove(a)
        ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER'); me.color_attributes.active_color = ca
        for p in ca.data: p.color = (1, 1, 1, 1)
    gme = bpy.data.meshes.new('bk_ground'); gme.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    gnd = bpy.data.objects.new('bk_ground', gme); scene.collection.objects.link(gnd)
    scene.render.engine = 'CYCLES'
    try: scene.cycles.device = 'GPU'
    except Exception: pass
    scene.cycles.samples = 64
    if not scene.world: scene.world = bpy.data.worlds.new('bkW')
    scene.world.light_settings.distance = 0.22
    scene.render.bake.target = 'VERTEX_COLORS'
    vl = bpy.context.view_layer
    for o in scene.objects: o.select_set(False)
    for o in allobj: o.select_set(True)
    vl.objects.active = allobj[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    for o in allobj:
        m = o.data.materials[0]; paint = m.name.startswith('P_'); base = (1, 1, 1) if paint else m['apex_col']
        brushed = m.name == 'X_brushed'; me = o.data; ca = me.color_attributes['Col']
        for lp in me.loops:
            p = ca.data[lp.index]; a = 0.35 + 0.65 * p.color[0]
            if brushed:                                    # hand-brushed aluminium: faint streaks running the length of the part
                co = me.vertices[lp.vertex_index].co; nr = me.vertices[lp.vertex_index].normal; u = co.y * 190 if abs(nr.z) > abs(nr.y) else co.z * 190 + 37
                a *= 0.88 + 0.12 * (0.5 + 0.25 * math.sin(u) + 0.15 * math.sin(u * 2.7 + 1.3) + 0.1 * math.sin(u * 6.1 + 0.4))
            p.color = (base[0] * a, base[1] * a, base[2] * a, 1)
    bpy.data.objects.remove(gnd)
    for asm, parts in GAME.items():
        L = [o for k in parts for o in ASM[k]]
        if not L: continue
        shift = -V(F[0], F[1], 0) if asm == 'wheelF' else -V(A[0], A[1], 0) if asm == 'wheelR' else Vector((0, 0, 0))
        for o in L: o.location = shift
        for sc2 in bpy.data.scenes:
            for vl2 in sc2.view_layers:
                for o in sc2.objects:
                    try: o.select_set(False, view_layer=vl2)
                    except Exception: pass
        for o in L: o.select_set(True)
        vl.objects.active = L[0]
        bpy.ops.export_scene.gltf(filepath=OUT + 'bike_duetto_' + asm + '.glb', export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                                  export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT')
        for o in L: o.location = (0, 0, 0)
result = res
