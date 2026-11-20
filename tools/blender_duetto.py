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
M_spring = mat('M_spring', 'd8d9dc')
X_header = mat('X_header', '8a6c48'); X_ti = mat('X_ti', '9a958c'); X_chain = mat('X_chain', '55585e'); M_engine = mat('M_engine', '2e3136')
X_alu = mat('X_alu', 'b9bdc2'); X_steel = mat('X_steel', 'd6d8db'); X_frame = mat('X_frame', '41454c'); X_rim = mat('X_rimdark', '34373d'); X_cast = mat('X_cast', '7d8188')

# ================================================================== STAGE 1: rolling chassis
if 'chassis' in STAGES:
    # ---- steering head: the tube the whole frame hangs off
    rod('headstock', sp(0.523), sp(0.689), 0.033, M_red, 'body', seg=20)
    rod('hs_cup0', sp(0.519), sp(0.533), 0.0365, X_steel, 'body', seg=20); rod('hs_cup1', sp(0.679), sp(0.693), 0.0365, X_steel, 'body', seg=20)

    # ---- trellis frame. Two rails per side run back from the head and fan out round the engine; short diagonals triangulate them.
    T = [(0.381, 0.8965, 0.032), (0.22, 0.855, 0.115), (0.00, 0.80, 0.150), (-0.21, 0.742, 0.142)]      # top rail
    B = [(0.430, 0.787, 0.032), (0.275, 0.665, 0.108), (0.065, 0.575, 0.150), (-0.125, 0.537, 0.148)]   # bottom rail: drops away from the top rail, so the truss is deep in the middle
    L2 = (-0.215, 0.585, 0.142)                                                                          # rear lug on the pivot plate
    R1, R2 = (-0.44, 0.775, 0.125), (-0.645, 0.815, 0.085)                                               # seat rail
    ST = [L2, (-0.36, 0.69, 0.132), (-0.52, 0.7906, 0.109)]                                              # stay from the plate up to the seat rail
    def side(p, s): return (p[0], p[1], p[2] * s)
    for s in (-1, 1):
        tube('fr_top%d' % s, [side(p, s) for p in T], 0.014, M_red, 'body', seg=12)
        tube('fr_bot%d' % s, [side(p, s) for p in B], 0.014, M_red, 'body', seg=12)
        for k, (a, b) in enumerate(((B[0], T[1]), (T[1], B[1]), (B[1], T[2]), (T[2], B[2]), (B[2], T[3]), (T[3], B[3]), (T[3], L2))):
            rod('fr_d%d_%d' % (k, s), side(a, s), side(b, s), 0.0115, M_red, 'body', seg=10)
        tube('sub_rail%d' % s, [side(p, s) for p in (T[3], R1, R2)], 0.0115, M_red, 'body', seg=10)
        tube('sub_stay%d' % s, [side(p, s) for p in ST], 0.0105, M_red, 'body', seg=10)
        rod('sub_brace%d' % s, side(ST[1], s), side((-0.33, 0.758, 0.134), s), 0.009, M_red, 'body', seg=8)
        # cast plate carrying the swingarm pivot, bolted to the ends of the rails
        plate('pivplate%d' % s, hull(circ(B[3][0], B[3][1] - 0.008, 0.027) + circ(L2[0], L2[1], 0.027) + circ(PIV[0], PIV[1], 0.047) + circ(-0.14, 0.345, 0.023)),
              0.016, X_frame, 'body', off=s * 0.142, bevel=0.004)
        cyl('pivcap%d' % s, 0.021, 0.008, (PIV[0], PIV[1], s * 0.153), X_steel, 'body', seg=18, bevel=0.002)
        for (bx, by) in ((B[3][0], B[3][1] - 0.008), (L2[0], L2[1]), (-0.14, 0.345)): cyl('pivbolt%d_%.2f' % (s, by), 0.008, 0.006, (bx, by, s * 0.152), X_steel, 'body', seg=10, bevel=0)
    for k, (x, y, z) in enumerate((T[1], T[3], R1, R2)):                                                 # cross tubes tying the two sides together
        rod('fr_x%d' % k, (x, y, -z), (x, y, z), 0.0115 if k < 2 else 0.0095, M_red, 'body', seg=10)
    # gusset between the rails at the head
    plate('gusset', hull([sp(0.55)[:2], sp(0.66)[:2], (T[0][0] - 0.07, T[0][1] - 0.022), (B[0][0] - 0.06, B[0][1] - 0.03)]), 0.05, M_red, 'body', bevel=0.004)

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
        plate('shk_lugT%d' % s, hull(circ(S0[0], S0[1], 0.016) + circ(T[3][0], T[3][1], 0.014)), 0.006, M_red, 'body', off=s * 0.02, bevel=0.0015)
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
    def wheel(asm, R, W, H, c2, discs, hubw, sprocket=None):
        cx, cy = c2; c = (cx, cy, 0); Rc = R - H / 2; rr = R - H                 # tyre section centre, bead radius
        prof = [(rr + 0.003, -W * 0.80), (rr + 0.016, -W * 0.88)]
        for k in range(17):
            t = math.radians(-102 + 204 * k / 16); prof.append((Rc + (H / 2) * math.cos(t), W * 0.985 * math.sin(t)))
        prof += [(rr + 0.016, W * 0.88), (rr + 0.003, W * 0.80)]
        lathe(asm + '_tyre', prof, M_tyre, asm, 72, c, 80)
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
    wheel('wheelF', RF, WF, 0.095, F, [-0.072, 0.072], 0.069)
    wheel('wheelR', RR, WR, 0.105, A, [0.088], 0.085, sprocket=-0.118)


# ================================================================== STAGE 2: engine, exhaust, final drive
if 'engine' in STAGES:
    # air-cooled 90-degree twin, tipped forward 15 degrees: one cylinder reaches for the front wheel, the other stands up under the tank
    EC = (0.0, 0.395); TILT = math.radians(15); D1 = (math.cos(TILT), math.sin(TILT)); D2 = (-math.sin(TILT), math.cos(TILT))
    def ept(d, r, q=0.0, z=0.0): return (EC[0] + d[0] * r - d[1] * q, EC[1] + d[1] * r + d[0] * q, z)    # r along the cylinder, q square to it
    def sq(hx, hz, e, n=28):
        return [(hx * math.copysign(abs(math.cos(a)) ** (2 / e), math.cos(a)), hz * math.copysign(abs(math.sin(a)) ** (2 / e), math.sin(a))) for a in [(k + 0.5) / n * 6.2832 for k in range(n)]]
    # crankcase: narrow enough to sit between the swingarm bosses - the pivot axle runs straight through its rear
    plate('crankcase', hull(circ(EC[0], EC[1], 0.122) + circ(-0.1, 0.42, 0.094) + circ(0.065, 0.33, 0.076) + circ(-0.09, 0.325, 0.066) + circ(0.05, 0.50, 0.032)), 0.17, X_cast, 'body', bevel=0.014, seg=3)
    for tag, d in (('cylF', D1), ('cylR', D2)):
        nx = (-d[1], d[0], 0)
        rod(tag + '_barrel', ept(d, 0.09), ept(d, 0.24), 0.05, M_dark, 'body', seg=20)
        for k in range(8): plate('%s_fin%d' % (tag, k), sq(0.072, 0.078, 4.0), 0.0042, X_cast, 'body', origin=ept(d, 0.126 + k * 0.0145), ex=nx, ey=(0, 0, 1), bevel=0)
        plate(tag + '_head', sq(0.068, 0.074, 5.0), 0.075, X_cast, 'body', origin=ept(d, 0.277), ex=nx, ey=(0, 0, 1), bevel=0.008)
        for k in range(3): plate('%s_hfin%d' % (tag, k), sq(0.075, 0.081, 4.5), 0.0042, X_cast, 'body', origin=ept(d, 0.256 + k * 0.021), ex=nx, ey=(0, 0, 1), bevel=0)
        plate(tag + '_cover', sq(0.05, 0.06, 3.0), 0.03, X_alu, 'body', origin=ept(d, 0.328), ex=nx, ey=(0, 0, 1), bevel=0.011, seg=3)
    # right side: belt covers from the layshaft in the V up to each cam, and the clutch
    LAY = (0.03, 0.485)
    for tag, d in (('beltF', D1), ('beltR', D2)):
        cam = ept(d, 0.285)
        plate(tag, hull(circ(LAY[0], LAY[1], 0.036) + circ(cam[0], cam[1], 0.033)), 0.028, M_dark, 'body', off=0.102, bevel=0.007)
        cyl(tag + '_cap', 0.019, 0.006, (cam[0], cam[1], 0.12), X_alu, 'body', seg=16, bevel=0.002)
    cyl('belt_capL', 0.017, 0.006, (LAY[0], LAY[1], 0.12), X_alu, 'body', seg=16, bevel=0.002)
    CL = (-0.045, 0.405)
    cyl('clutch', 0.07, 0.026, (CL[0], CL[1], 0.098), M_dark, 'body', seg=32, bevel=0.003)
    cutplate('clutchcover', circ(CL[0], CL[1], 0.071, 36), [sector(CL, 0.03, 0.054, k / 6 * 6.2832 - 0.3, k / 6 * 6.2832 + 0.3, 4) for k in range(6)], 0.006, X_alu, 'body', off=0.114)
    cyl('clutchhub', 0.021, 0.008, (CL[0], CL[1], 0.118), X_steel, 'body', seg=16, bevel=0.002)
    for k in range(6): cyl('clutchbolt%d' % k, 0.0045, 0.004, pol(CL, 0.063, (k + 0.5) / 6 * 6.2832, 0.118), X_steel, 'body', seg=6, bevel=0)
    # left side: alternator cover on the crank, sprocket cover behind it
    cyl('altcover', 0.085, 0.034, (EC[0], EC[1], -0.102), X_alu, 'body', seg=36, bevel=0.009)
    cyl('altcap', 0.03, 0.006, (EC[0], EC[1], -0.121), M_dark, 'body', seg=20, bevel=0.002)
    for k in range(6): cyl('altbolt%d' % k, 0.0045, 0.004, pol(EC, 0.072, k / 6 * 6.2832, -0.12), X_steel, 'body', seg=6, bevel=0)
    SPR = (-0.075, 0.44)
    plate('sprocketcover', hull(circ(SPR[0], SPR[1], 0.05) + circ(-0.025, 0.47, 0.034)), 0.018, M_dark, 'body', off=-0.137, bevel=0.005)
    cyl('oilfilter', 0.03, 0.065, (0.165, 0.315, -0.035), M_dark, 'body', axis='x', seg=18, bevel=0.006)
    # the engine is a stressed member: bolted into the frame in the V (lugs hanging off the lower rails) and at the pivot plates
    MNT = (0.05, 0.505)
    for s in (-1, 1):
        plate('mnt_lug%d' % s, hull(circ(B[2][0], B[2][1], 0.016) + circ(MNT[0], MNT[1], 0.017)), 0.008, M_red, 'body', off=s * 0.146, bevel=0.002)
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
    HR, RR2 = 0.0225, 0.021
    pf = ept(D1, 0.275, -0.07)
    tube('headerF', [pf, (pf[0] + 0.012, pf[1] - 0.055, 0.0), (0.275, 0.275, 0.03), (0.205, 0.234, 0.06), (0.08, 0.222, 0.08), (-0.08, 0.222, 0.085), (-0.175, 0.226, 0.086)], HR, X_header, 'body', seg=14, smooth=5)
    pr = ept(D2, 0.275, 0.07)
    tube('headerR', [pr, (-0.178, 0.632, 0.03), (-0.208, 0.595, 0.066), (-0.222, 0.52, 0.068), (-0.222, 0.37, 0.066), (-0.224, 0.30, 0.07), (-0.245, 0.252, 0.086), (-0.278, 0.234, 0.094)], RR2, X_header, 'body', seg=14, smooth=5)
    for tag, q, d in (('F', pf, (D1[1], -D1[0])), ('R', pr, (-D2[1], D2[0]))):      # port flanges
        rod('flange' + tag, (q[0] - d[0] * 0.004, q[1] - d[1] * 0.004, 0), (q[0] + d[0] * 0.008, q[1] + d[1] * 0.008, 0), 0.033, X_steel, 'body', seg=14)
    tube('collector', [(-0.165, 0.228, 0.086), (-0.20, 0.229, 0.088), (-0.275, 0.234, 0.094), (-0.33, 0.25, 0.117), (-0.385, 0.29, 0.148), (-0.44, 0.335, 0.18)], [0.026, 0.03, 0.03, 0.027, 0.026, 0.026], X_header, 'body', seg=16, smooth=4)
    E0, E1 = (-0.44, 0.335, 0.18), (-0.79, 0.53, 0.232)
    def ecan(t): return tuple(E0[k] + (E1[k] - E0[k]) * t for k in range(3))
    tube('can', [ecan(0.0), ecan(0.11), ecan(0.14), ecan(0.90), ecan(0.925)], [0.027, 0.045, 0.047, 0.058, 0.0585], X_ti, 'body', seg=24)
    tube('can_cap', [ecan(0.925), ecan(0.99), ecan(1.0)], [0.0592, 0.0585, 0.055], M_dark, 'body', seg=24)
    rod('can_out', ecan(0.99), ecan(1.012), 0.041, X_steel, 'body', seg=20); rod('can_bore', ecan(1.0), ecan(1.014), 0.035, M_dark, 'body', seg=20)
    rod('can_band', ecan(0.38), ecan(0.43), [0.0525, 0.0533], M_dark, 'body', seg=24)
    hb = ecan(0.405)
    plate('can_hanger', hull(circ(hb[0], hb[1] + 0.03, 0.016) + circ(-0.45, 0.745, 0.011)), 0.005, M_dark, 'body', off=0.152, bevel=0.0015)
    cyl('can_hbolt', 0.008, 0.03, (-0.45, 0.745, 0.136), X_steel, 'body', seg=8, bevel=0)

    # ---- intake: both heads breathe from the airbox between the frame rails
    loft('airbox', [dict(x=0.315, y=0.745, w=0.05, ht=0.04, hb=0.05, e=3), dict(x=0.26, y=0.745, w=0.085, ht=0.06, hb=0.07, e=4), dict(x=0.06, y=0.745, w=0.09, ht=0.06, hb=0.065, e=4),
                    dict(x=0.012, y=0.745, w=0.07, ht=0.045, hb=0.05, e=3)], M_dark, 'body', ring=16, subsurf=1)
    qi = ept(D1, 0.275, 0.068); rod('intakeF', qi, (0.20, 0.685, 0.0), [0.03, 0.027, 0.03], M_dark, 'body', seg=14); rod('intakeF_tb', (qi[0] * 0.55 + 0.20 * 0.45, qi[1] * 0.55 + 0.685 * 0.45 - 0.012, 0), (qi[0] * 0.55 + 0.20 * 0.45, qi[1] * 0.55 + 0.685 * 0.45 + 0.012, 0), 0.034, X_alu, 'body', seg=14)
    qi = ept(D2, 0.275, -0.068); rod('intakeR', qi, (0.045, 0.705, 0.0), [0.03, 0.027, 0.03], M_dark, 'body', seg=14)

# ================================================================== STAGE 3: bodywork
if 'body' in STAGES:
    # tank: sits on the top rails, tall and broad at the front, pulled in between the knees
    def rail(x):                                           # height of the top rail at x
        for k in range(len(T) - 1):
            if T[k + 1][0] <= x <= T[k][0]: f = (x - T[k][0]) / (T[k + 1][0] - T[k][0]); return T[k][1] + (T[k + 1][1] - T[k][1]) * f
        return T[0][1] if x > T[0][0] else T[-1][1]
    TK = [(0.352, 1.000, 0.115, 0.105, 0.008, 3.2), (0.325, 1.032, 0.160, 0.150, 0.008, 3.4), (0.26, 1.052, 0.192, 0.178, 0.010, 3.4), (0.16, 1.062, 0.198, 0.180, 0.014, 3.2),
          (0.05, 1.048, 0.185, 0.160, 0.016, 3.0), (-0.06, 1.008, 0.150, 0.118, 0.026, 2.7), (-0.16, 0.948, 0.115, 0.092, 0.024, 2.5), (-0.245, 0.885, 0.082, 0.072, 0.03, 2.4)]
    secs = []                                              # x, top, half width, half width low, gap above the rail, shoulder squareness
    for (x, top, w, wb, gap, e) in TK:
        bot = rail(x) + gap; yc = bot + (top - bot) * 0.44
        secs.append(dict(x=x, y=yc, w=w, wb=wb, ht=top - yc, hb=yc - bot, e=e, eb=3.6))
    loft('tank', secs, P_body, 'body', ring=20, subsurf=2)
    cyl('fuelcap', 0.036, 0.012, (0.17, 1.054, 0), X_alu, 'body', axis='y', seg=24, bevel=0.003)
    cyl('fuelcap_lid', 0.024, 0.004, (0.17, 1.062, 0), M_dark, 'body', axis='y', seg=20, bevel=0.0015)

res = {k: sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in L) for k, L in ASM.items()}

# ------------------------------------------------------------------ preview shots (workbench: quick, clean, shows the form)
if SHOTS:
    cam = bpy.data.objects.new('bk_cam', bpy.data.cameras.new('bk_cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.clip_end = 200
    scene.render.engine = 'BLENDER_WORKBENCH'; sh = scene.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.show_shadows = False
    sh.show_object_outline = True; sh.object_outline_color = (0.05, 0.05, 0.06); sh.show_specular_highlight = True
    try: scene.display.render_aa = '16'
    except Exception: pass
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.get('bkPrev') or bpy.data.worlds.new('bkPrev'); scene.world.color = lin('d9dade')
    scene.render.resolution_x, scene.render.resolution_y = globals().get('RES', (1800, 1100)); scene.render.image_settings.file_format = 'PNG'
    C = V(0, 0.52, 0)
    DIRS = {'side': ((0, 0.0, 1), 0), 'sideL': ((0, 0.0, -1), 0), 'front': ((1, 0.03, 0), 0), 'rear': ((-1, 0.05, 0), 0), 'top': ((0.001, 1, 0), 0),
            'q1': ((0.8, 0.32, 1), 1), 'q2': ((0.8, 0.32, -1), 1), 'low': ((0.5, -0.12, 1), 1), 'q3': ((-0.85, 0.36, 1), 1), 'q4': ((-0.85, 0.36, -1), 1)}
    for v in SHOTS:
        d, persp = DIRS[v]; dv = V(*d).normalized(); ortho = not persp
        cam.data.type = 'ORTHO' if ortho else 'PERSP'; cam.data.ortho_scale = 2.35; cam.data.lens = 200
        cam.location = C + dv * (20 if ortho else 14.5)
        cam.rotation_euler = (C - cam.location).to_track_quat('-Z', 'Y').to_euler()
        if v == 'top': cam.location = C + Vector((0, 0, 20)); cam.rotation_euler = (0, 0, 0)
        if v in ('front', 'rear'): cam.data.ortho_scale = 1.5
        scene.render.filepath = OUT + 'renders/' + PREFIX + '_' + v + '.png'; bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)

# ------------------------------------------------------------------ bake AO into vertex colours and export the game assemblies
if EXPORT:
    GAME = {'body': ['body', 'swing'], 'front': ['front', 'fork'], 'wheelF': ['wheelF'], 'wheelR': ['wheelR']}     # until the game animates the suspension
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
        m = o.data.materials[0]; paint = m.name.startswith('P_'); base = (1, 1, 1) if paint else m['apex_col']
        for p in o.data.color_attributes['Col'].data:
            a = 0.35 + 0.65 * p.color[0]; p.color = (base[0] * a, base[1] * a, base[2] * a, 1)
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
