"""Bought-in CAD parts for the APEX bikes built in Blender: the lever assembly of assets/amaturen/Left_Clip_On_Assem1.stl (master cylinder with its
bar clamp, lever, fluid reservoir) for bikes with a one-piece handlebar. exec this file from a bike script after its own primitives - it uses that
script's V() and obj_from_bm(). (tools/blender_sport.py carries its own copy of the reader, with the brake disc as well.)"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
PARTS_SRC = '/Users/benedikt/Desktop/Apex/assets/'

def clipon_mesh():
    """the left clip-on, thinned out, standing on an upright fork tube: clamp centre at the origin, tube axis = Z, forward = X, the bar runs out along +Y
    (drooping a few degrees). Read once, then kept in the .blend."""
    me = bpy.data.meshes.get('apexpart2_clipon')
    if me: return me
    before = set(bpy.data.objects); bpy.ops.wm.stl_import(filepath=PARTS_SRC + 'amaturen/Left_Clip_On_Assem1.stl')
    ob = [o for o in bpy.data.objects if o not in before][0]; bm = bmesh.new(); bm.from_mesh(ob.data)
    co = [v.co.copy() for v in bm.verts]; zmin = min(p.z for p in co); low = [p for p in co if p.z < zmin + 2.0]
    x0, x1 = min(p.x for p in low), max(p.x for p in low); y0, y1 = min(p.y for p in low), max(p.y for p in low); ro = (x1 - x0) / 2; c = ((x0 + x1) / 2, (y0 + y1) / 2, zmin + ro)
    for v in bm.verts: v.co = Vector((v.co.z - c[2], v.co.x - c[0], v.co.y - c[1])) * 0.01
    bm.to_mesh(ob.data); bm.free(); md = ob.modifiers.new('d', 'DECIMATE'); md.ratio = 0.06
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())); me.name = 'apexpart2_clipon'; me.use_fake_user = True
    old = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(old); return me

def _islands(bm):
    """the separate pieces of the assembly: [(verts, (x0, x1, y0, y1, z0, z1))]"""
    seen = set(); out = []
    for v in bm.verts:
        if v in seen: continue
        st = [v]; seen.add(v); vs = []
        while st:
            a = st.pop(); vs.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b not in seen: seen.add(b); st.append(b)
        out.append((vs, tuple(f(a.co[i] for a in vs) for i in range(3) for f in (min, max))))
    return out

LEVER_CLAMP_Y = 0.054                      # where along the part's bar the master cylinder's clamp sits
LEVER_PIVOT = (0.0962, 0.0732)             # the lever's pivot bolt in the part (it stands upright there)
LEVER_PORT = [(0.0279, -0.0665, -0.0114), (0.0279, -0.0865, -0.0114), (0.0279, -0.1065, -0.0114)]      # the hydraulic line: out of the middle of the master cylinder's port, which looks along the bar towards the middle of the bike - (ahead, out along the bar, up) from the clamp. Three points in line, so the line runs straight through its fitting, which sits against the port's end (at -0.0625)

def lever_set(name, s, at, out, mats, asm, yaw=0.0, roll=0.0, smooth=38, resv=True, reach=0.14):
    """master cylinder, lever and reservoir of the clip-on part, clamped on a one-piece handlebar. The part's fork clamp and its own bar stub are left out,
    and the master cylinder's clamp is put round the handlebar, on its axis and in its direction - so the bar has to run straight where the clamp sits.
    s: -1 left (the part as bought), +1 right (mirrored) · at: the point on the bar's axis (game space) the clamp goes round - the lever's pivot is 30 mm
    further out, its tip 170 mm · out: the way the bar runs outwards there · mats: (body, lever, reservoir, cap)
    yaw: the lever turned in towards the grip [rad] · roll: turned about the bar, lever down [rad] · resv: False leaves out the remote reservoir on its
    bracket (for a master cylinder with its reservoir on top, or a cable lever) · reach: the lever alone swung in about its pivot [rad] - in the part
    it stands pushed out, its tip 9 cm ahead of the grip
    Returns a function that says where a point given relative to the clamp (ahead, out along the bar, up) has come to lie - for the lines that start here."""
    bm = bmesh.new(); bm.from_mesh(clipon_mesh()); isl = _islands(bm)
    stub = max(isl, key=lambda t: t[1][3])                                          # the part's own bar: the piece that reaches furthest out
    r = (stub[1][1] - stub[1][0]) / 2; cx = (stub[1][0] + stub[1][1]) / 2          # its axis, from the ring of vertices at its inner end and from its lowest point, at the outer end (it droops 6 degrees)
    inn = [a.co for a in stub[0] if a.co.y < 0.0]; low = min((a.co for a in stub[0]), key=lambda c: c.z)
    A = Vector((cx, sum(c.y for c in inn) / len(inn), (min(c.z for c in inn) + max(c.z for c in inn)) / 2)); u = (Vector((cx, low.y, low.z + r)) - A).normalized()
    C = A + u * ((LEVER_CLAMP_Y - A.y) / u.y)
    px = (Vector((1, 0, 0)) - u * u.x).normalized(); pz = px.cross(u)             # the part's own frame at its clamp: ahead, along the bar, up
    P = Matrix(((px.x, px.y, px.z, -px.dot(C)), (u.x, u.y, u.z, -u.dot(C)), (pz.x, pz.y, pz.z, -pz.dot(C)), (0, 0, 0, 1)))
    d = Vector((out[0], -out[2], out[1])).normalized(); ey = d if s < 0 else -d    # on the bike: the part's Y runs along the bar towards the left
    ex = ey.cross(Vector((0, 0, 1))).normalized(); ez = ex.cross(ey).normalized(); o = V(*at)
    F = Matrix(((ex[0], ey[0], ez[0], o[0]), (ex[1], ey[1], ez[1], o[1]), (ex[2], ey[2], ez[2], o[2]), (0, 0, 0, 1)))
    L = F @ (Matrix.Diagonal((1, -1, 1, 1)) if s > 0 else Matrix.Identity(4)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(roll, 4, 'Y'); M = L @ P
    groups = {}
    for vs, (x0, x1, y0, y1, z0, z1) in isl:
        if vs is stub[0] or x0 < 0.012 or (not resv and z0 > 0.012): continue      # the bar stub, the fork clamp and its pinch bolt; the reservoir with its fittings
        k = 3 if z0 > 0.055 else 2 if z1 > 0.07 else 1 if x0 > 0.07 and z1 < -0.01 else 0
        groups.setdefault(k, set()).update(f for a in vs for f in a.link_faces if resv or max(q.co.z for q in f.verts) < 0.02)      # without reservoir: without its bracket, too
    for k, faces in sorted(groups.items()):
        b2 = bmesh.new(); vm = {}
        for f in faces:
            vs = [vm.get(v) or vm.setdefault(v, b2.verts.new(v.co)) for v in f.verts]
            try: b2.faces.new(list(reversed(vs)) if s > 0 else vs)
            except ValueError: pass
        if k == 1: bmesh.ops.transform(b2, matrix=Matrix.Translation((LEVER_PIVOT[0], LEVER_PIVOT[1], 0)) @ Matrix.Rotation(reach, 4, 'Z') @ Matrix.Translation((-LEVER_PIVOT[0], -LEVER_PIVOT[1], 0)), verts=b2.verts)
        bmesh.ops.transform(b2, matrix=M, verts=b2.verts); obj_from_bm(b2, name + ('', '_lever', '_resv', '_cap')[k], mats[k], asm, smooth)
    bm.free(); return lambda x, yo, z: (lambda w: (w.x, w.z, -w.y))(L @ Vector((x, yo, z)))
