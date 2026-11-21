"""Builder kit for APEX bikes made in Blender: scene set-up, materials and the modelling primitives (tubes, lofts, plates with real
cut-outs, lathes, swept box sections, springs, strips let into finished surfaces, decal patches).

Used by tools/blender_supermoto.py. The primitives are the ones the Duetto was built with (tools/blender_duetto.py keeps its own copy,
so that bike can never be disturbed from here).

Set before exec'ing this file:  SCENE (name of the Blender scene to build in), OBJPRE (prefix of every object made, e.g. 'sm_').
Everything already carrying that prefix is removed first, so a script can be run again and again.

Game coordinates: x forward, y up, z lateral (right = +z), origin on the ground at mid wheelbase. Blender: X = x, Y = -z, Z = y.
Material prefixes tell the game which shader to use: P_ livery paint, M_ matte, X_ metal, C_ polished chrome, G_ gloss, S_ screen,
L_ brake light (glows), D_ decal."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

SCENE = globals().get('SCENE', 'Supermoto'); OBJPRE = globals().get('OBJPRE', 'sm_')
for sc in [s for s in bpy.data.scenes if s.name == SCENE]: bpy.data.scenes.remove(sc)
for o in [o for o in bpy.data.objects if o.name.startswith(OBJPRE)]: bpy.data.objects.remove(o)
scene = bpy.data.scenes.new(SCENE)
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
    m.diffuse_color = (*c, 1); m.metallic = 0.55 if name[0] == 'C' else 0.85 if name[0] == 'X' else 0.0; m.roughness = {'X': 0.38, 'C': 0.2, 'G': 0.15, 'P': 0.3}.get(name[0], 0.62)   # viewport / preview look
    MATS[name] = m; return m

ASM = {'body': [], 'swing': [], 'front': [], 'fork': [], 'wheelF': [], 'wheelR': [], 'shockU': [], 'shockL': [], 'spring': [], 'decalR': [], 'decalL': []}
def obj_from_bm(bm, name, m, asm, smooth_angle=38, subsurf=0, solid=0.0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(OBJPRE + name, me); scene.collection.objects.link(o); me.materials.append(m)
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

def band(objs, name, a, b, hh, xe, m, asm, slant=0.0):
    """a strip let into finished surfaces: cut along two planes parallel to the line a-b (side view) and hand what lies between them, behind xe, to another material"""
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); dx, dy = dx / L, dy / L; nx, ny = -dy, dx
    ex, ey = 1.0, slant; el = math.hypot(ex, ey); ex, ey = ex / el, ey / el; E = (xe, a[1] + (xe - a[0]) * dy / dx)
    bm2 = bmesh.new()
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        for (co, no) in ((V(a[0] + nx * hh, a[1] + ny * hh), V(nx, ny)), (V(a[0] - nx * hh, a[1] - ny * hh), V(nx, ny)), (V(E[0], E[1]), V(ex, ey))):
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=co, plane_no=no, clear_inner=False, clear_outer=False)
        bm.faces.ensure_lookup_table(); sel = []
        for f in bm.faces:
            c = f.calc_center_median(); x, y = c.x, c.z
            if abs((x - a[0]) * nx + (y - a[1]) * ny) < hh and (x - E[0]) * ex + (y - E[1]) * ey < 0: sel.append(f)
        vm = {}
        for f in sel:
            vs = []
            for v in f.verts:
                if v not in vm: vm[v] = bm2.verts.new(v.co)
                vs.append(vm[v])
            bm2.faces.new(vs)
        bmesh.ops.delete(bm, geom=sel, context='FACES'); bm.to_mesh(o.data); bm.free()
    bmesh.ops.remove_doubles(bm2, verts=bm2.verts[:], dist=1e-5)
    return obj_from_bm(bm2, name, m, asm, 60)

def give(src, dst, pred):
    """hand the faces of `src` whose centre (side view x, y) satisfies pred over to `dst` and weld them in"""
    bm = bmesh.new(); bm.from_mesh(src.data); bd = bmesh.new(); bd.from_mesh(dst.data); vm = {}; sel = []
    for f in bm.faces:
        c = f.calc_center_median()
        if pred(c.x, c.z): sel.append(f)
    for f in sel:
        vs = []
        for v in f.verts:
            if v not in vm: vm[v] = bd.verts.new(v.co)
            vs.append(vm[v])
        nf = bd.faces.new(vs); nf.smooth = True
    bmesh.ops.delete(bm, geom=sel, context='FACES'); bm.to_mesh(src.data); bm.free()
    bmesh.ops.remove_doubles(bd, verts=bd.verts[:], dist=1e-5); bd.normal_update(); bd.to_mesh(dst.data); bd.free()

def decal(name, target, c, w, h, s, m, asm, nx=16, ny=6, lift=0.0012, tilt=0.0):
    """a patch lying on a curved panel: a grid dropped onto `target` from the side, a hair proud of it. UVs run the way one reads it from that side."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); grid = []; ct, st = math.cos(tilt), math.sin(tilt)
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / ny; lx, ly = (u - 0.5) * w * s, (v - 0.5) * h          # reading direction: +x seen from the right, -x from the left
            x, y = c[0] + lx * ct - ly * st * s, c[1] + lx * st * s + ly * ct
            ok, loc, nrm, idx = target.ray_cast(V(x, y, s * 0.6), Vector((0, s, 0)))
            assert ok, (name, x, y)
            vt = bm.verts.new(loc + nrm * lift); row.append((vt, (u, v)))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            f = bm.faces.new([e[0] for e in q])
            for lp, e in zip(f.loops, q): lp[uvl].uv = e[1]
    bm.normal_update()
    return obj_from_bm(bm, name, m, asm, 80)

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
