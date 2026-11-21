"""APEX rider parts, built in Blender. Game coordinates: x forward, y up, z right; Blender X = x, Y = -z, Z = y.
Pieces (each its own GLB, placed by the game's rider rig):
  torso  - hips at the origin, shoulders 0.52 m up the +y axis, chest faces +x, back -x; the spine between them is a gentle curve (BEND degrees), not a plank
  helmet - centred at the origin, face towards +x
  limbs  - unit length along +y (0 = joint at the body side), real radii; rotationally symmetric so the rig can roll them freely
  gloveR / gloveL - a hand closed round the grip: the grip's axis is the z axis through the origin, +x ahead, +y up, the wrist behind and above. Thumb, ring and little
            finger are part of it; index and middle finger are two more pieces (fingersR / fingersL: first joint, origin on the knuckle line;
            tipsR / tipsL: the rest, origin on the middle joint), so they can lie on the lever
            and pull it. The left ones are the right ones mirrored.
  boot - in bike axes on the ankle point; kneepuck - knee joint at the origin, +x the way the kneecap points, y along the leg, +z the outside of the knee
Material prefixes: T_suit / T_accent / T_dark / H_shell / H_accent / H_dark / H_visor, L_suit / L_accent / L_dark / L_slider (hard protectors: soles, knee pucks).
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
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*rgb, 1); m.diffuse_color = (*rgb, 1); MATS[name] = m; return m

PIECES = {}
def finish(bm, name, m, piece, angle=40, subsurf=0):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('rd_' + name, me); scene.collection.objects.link(o); me.materials.append(m)
    if subsurf:
        mod = o.modifiers.new('s', 'SUBSURF'); mod.levels = subsurf; mod.render_levels = subsurf
        dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me2; me = me2
    bm = bmesh.new(); bm.from_mesh(me)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle): e.smooth = False
    bm.to_mesh(me); bm.free()
    PIECES.setdefault(piece, []).append(o); return o

def loft_y(name, secs, m, piece, ring=20, xform=None, capA=True, capB=True, angle=40, subsurf=0):
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
    return finish(bm, name, m, piece, angle, subsurf)

def loft_x(name, secs, m, piece, ring=16, angle=45, subsurf=0):
    """sections along x: dict(x, y (centre), w (half width z), ht (up), hb (down), e)"""
    bm = bmesh.new(); rings = []
    for s in secs:
        e = s.get('e', 2.6); r = []
        for k in range(ring):
            a = k / ring * math.pi * 2; c, sn = math.cos(a), math.sin(a)
            r.append(bm.verts.new(V(s['x'], s['y'] + (s['ht'] if sn >= 0 else s['hb']) * math.copysign(abs(sn) ** (2 / e), sn), s['w'] * math.copysign(abs(c) ** (2 / e), c))))
        rings.append(r)
    for i in range(len(rings) - 1):
        for k in range(ring): bm.faces.new([rings[i][k], rings[i][(k + 1) % ring], rings[i + 1][(k + 1) % ring], rings[i + 1][k]])
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    return finish(bm, name, m, piece, angle, subsurf)

def repaint(o, planes, test, name, m, piece):
    """panels of another colour: cut the finished surface along the planes [(point, normal)] (game axes) and hand the faces whose centre
    passes test(x, y, z) to another material"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    for co, no in planes:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=V(*co), plane_no=V(*no).normalized(), clear_inner=False, clear_outer=False)
    bm.normal_update(); bm.faces.ensure_lookup_table(); sel = []
    for f in bm.faces:
        c = f.calc_center_median()
        if test(c.x, c.z, -c.y): sel.append(f)
    bm2 = bmesh.new(); vm = {}
    for f in sel:
        vs = []
        for v in f.verts:
            if v not in vm: vm[v] = bm2.verts.new(v.co)
            vs.append(vm[v])
        nf = bm2.faces.new(vs); nf.smooth = True
    bmesh.ops.delete(bm, geom=sel, context='FACES'); bm.to_mesh(o.data); bm.free()
    me = bpy.data.meshes.new(name); bm2.to_mesh(me); bm2.free()
    o2 = bpy.data.objects.new('rd_' + name, me); scene.collection.objects.link(o2); me.materials.append(m); PIECES.setdefault(piece, []).append(o2); return o2

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

T_suit, T_accent, T_dark = mat('T_suit', (0.03, 0.03, 0.035)), mat('T_accent', (0.9, 0.9, 0.88)), mat('T_dark', (0.02, 0.02, 0.02))
H_shell, H_accent, H_dark, H_visor = mat('H_shell', (0.9, 0.9, 0.88)), mat('H_accent', (0.9, 0.9, 0.88)), mat('H_dark', (0.02, 0.02, 0.02)), mat('H_visor', (0.01, 0.01, 0.012))
L_suit, L_accent, L_dark = mat('L_suit', (0.03, 0.03, 0.035)), mat('L_accent', (0.9, 0.9, 0.88)), mat('L_dark', (0.015, 0.015, 0.015))

# ------------------------------------------------------------------ torso: one smooth leather shell at true size, the shoulder yoke in the second colour
# hips at y = 0, shoulder line at y = TL. Broad across the shoulders, drawn in at the waist, seat and small of the back behind the hips.
TL = 0.52
torso = loft_y('torso', [
    dict(y=-0.075, x=0.0, w=0.095, df=0.072, db=0.085, e=2.2), dict(y=-0.01, x=-0.004, w=0.166, df=0.10, db=0.116, e=2.5),
    dict(y=0.13, x=0.0, w=0.137, df=0.092, db=0.097, e=2.4), dict(y=0.26, x=0.004, w=0.153, df=0.104, db=0.10, e=2.5),
    dict(y=0.385, x=0.012, w=0.186, df=0.122, db=0.104, e=2.6), dict(y=0.475, x=0.012, w=0.204, df=0.108, db=0.102, e=2.7),
    dict(y=0.54, x=0.012, w=0.15, df=0.084, db=0.09, e=2.4), dict(y=0.585, x=0.014, w=0.076, df=0.06, db=0.064, e=2.2),
    dict(y=0.63, x=0.016, w=0.055, df=0.048, db=0.05, e=2.0)], T_suit, 'torso', ring=24, subsurf=2)
YOKE = 0.415
repaint(torso, [((0, YOKE, 0), (0.0, 1, 0))], lambda x, y, z: y > YOKE, 'yoke', T_accent, 'torso')
# speed hump: grows out of the back, same leather
hump = loft_y('hump', [dict(y=0.215, x=-0.084, w=0.012, df=0.008, db=0.008), dict(y=0.31, x=-0.088, w=0.05, df=0.02, db=0.03, e=2.3), dict(y=0.43, x=-0.088, w=0.07, df=0.02, db=0.05, e=2.3),
                       dict(y=0.52, x=-0.082, w=0.062, df=0.02, db=0.044, e=2.3), dict(y=0.575, x=-0.07, w=0.03, df=0.012, db=0.016)], T_suit, 'torso', ring=16, subsurf=2)
repaint(hump, [((0, YOKE, 0), (0.0, 1, 0))], lambda x, y, z: y > YOKE, 'hump_yoke', T_accent, 'torso')
# the neck: runs on well up into the helmet, so that there is always a body under it from wherever one looks
loft_y('collar', [dict(y=0.575, x=0.014, w=0.07, df=0.058, db=0.06), dict(y=0.64, x=0.017, w=0.058, df=0.051, db=0.052), dict(y=0.705, x=0.02, w=0.052, df=0.047, db=0.048)], T_suit, 'torso', ring=20, subsurf=1)

# ------------------------------------------------------------------ helmet: a race full-face at true size - 26 cm wide, 28 high, 35 long - so it is longer than it is
# wide, with the chin bar reaching forward. The visor is part of the same surface, tapering back to its pivots.
shell = loft_y('shell', [
    dict(y=-0.136, x=0.004, w=0.084, df=0.118, db=0.098, e=2.3), dict(y=-0.102, x=0.008, w=0.114, df=0.164, db=0.134, e=2.5),
    dict(y=-0.05, x=0.006, w=0.128, df=0.176, db=0.156, e=2.5), dict(y=-0.022, x=0.003, w=0.131, df=0.173, db=0.166, e=2.5),
    # the back of the shell runs out into a ducktail at the height of the eyes: the top flows down into it, underneath it is cut back hard
    dict(y=-0.004, x=0.0, w=0.132, df=0.169, db=0.19, e=2.5), dict(y=0.014, x=-0.002, w=0.1315, df=0.165, db=0.205, e=2.5),
    dict(y=0.04, x=-0.005, w=0.129, df=0.156, db=0.195, e=2.4), dict(y=0.07, x=-0.009, w=0.121, df=0.139, db=0.174, e=2.3),
    dict(y=0.098, x=-0.014, w=0.106, df=0.116, db=0.152, e=2.2),
    dict(y=0.13, x=-0.02, w=0.07, df=0.074, db=0.104, e=2.1), dict(y=0.143, x=-0.02, w=0.018, df=0.018, db=0.026, e=2.0)], H_shell, 'helmet', ring=32, angle=55, subsurf=2)
repaint(shell, [((0, 0.02, 0), (-0.25, 1, 0)), ((0, -0.02, 0), (0.2, 1, 0)), ((-0.03, 0, 0), (1, 0, 0))],
        lambda x, y, z: y - 0.25 * x < 0.02 and y + 0.2 * x > -0.02 and x > -0.03, 'visor', H_visor, 'helmet')
# two stripes over the crown, front to back
ZS = (0.012, 0.043)
repaint(shell, [((0, 0, zc), (0, 0, 1)) for zc in (ZS[0], ZS[1], -ZS[0], -ZS[1])], lambda x, y, z: ZS[0] < abs(z) < ZS[1] and (y > 0.028 or x < -0.035), 'stripes', H_dark, 'helmet')
# vents: one in the chin bar, two above the visor (flush, dark)
repaint(shell, [((0, -0.09, 0), (0, 1, 0)), ((0, -0.068, 0), (0, 1, 0)), ((0, 0, 0.034), (0, 0, 1)), ((0, 0, -0.034), (0, 0, 1))], lambda x, y, z: x > 0.1 and -0.09 < y < -0.068 and abs(z) < 0.034, 'vent_chin', H_dark, 'helmet')
repaint(shell, [((0, 0.086, 0), (0.45, 1, 0)), ((0, 0.099, 0), (0.45, 1, 0))] + [((0, 0, zc), (0, 0, 1)) for zc in (0.054, 0.092, -0.054, -0.092)],
        lambda x, y, z: x > 0.03 and 0.086 < y + 0.45 * x < 0.099 and 0.054 < abs(z) < 0.092, 'vent_brow', H_dark, 'helmet')
# visor pivots
def disc_z(name, c, r, t, m, piece, seg=16, bev=0.003):
    bm = bmesh.new(); rings = []
    for (dz, rr) in ((0.0, r), (t - bev, r), (t, r - bev)):
        for sgn in (1,):
            rings.append([bm.verts.new(V(c[0] + rr * math.cos(k / seg * 6.2832), c[1] + rr * math.sin(k / seg * 6.2832), c[2] + dz * (1 if c[2] >= 0 else -1))) for k in range(seg)])
    for i in range(len(rings) - 1):
        for k in range(seg): bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    bm.faces.new(rings[-1]); bm.faces.new(list(reversed(rings[0])))
    return finish(bm, name, m, piece, 50)
for sgn in (-1, 1): disc_z('pivot%d' % sgn, (-0.024, 0.002, sgn * 0.124), 0.0145, 0.0075, H_dark, 'helmet', bev=0.002)
# no neck roll: the shell closes round the neck, and the neck (the suit's collar) runs up into it

# ------------------------------------------------------------------ limbs (unit length along +y; the rig stretches them to arm / leg length and rolls them freely)
# Each has the shape of the limb it is - a shoulder cap, a forearm that swells below the elbow, a thigh, a calf - and ends at exactly the radius of the
# ball that sits in the joint (shoulder 0.070, elbow 0.052, hip 0.104, knee 0.076), so a bent joint is one smooth form. The forearm ends at the wrist
# (the hand is a piece of its own): a slim cuff in the second colour, then the glove's gauntlet.
SEG = 24
# every piece is closed at both ends: whichever of them a camera shows on its own, there is nothing to look into
lathe_y('uparm_w', [(0.0, 0.0), (0.0, 0.070), (0.1, 0.0745), (0.22, 0.074), (0.36, 0.068), (0.36, 0.0)], L_accent, 'uparm', SEG)
lathe_y('uparm', [(0.36, 0.0), (0.36, 0.068), (0.55, 0.062), (0.8, 0.055), (1.0, 0.052), (1.0, 0.0)], L_suit, 'uparm', SEG)
lathe_y('foarm', [(0.0, 0.0), (0.0, 0.052), (0.12, 0.0555), (0.26, 0.056), (0.45, 0.049), (0.64, 0.039), (0.64, 0.0)], L_suit, 'foarm', SEG)
lathe_y('foarm_w', [(0.64, 0.0), (0.64, 0.039), (0.72, 0.0365), (0.72, 0.0)], L_accent, 'foarm', SEG)
lathe_y('foarm_glove', [(0.72, 0.0), (0.72, 0.0365), (0.725, 0.0408), (0.78, 0.0415), (0.9, 0.037), (0.97, 0.032), (1.0, 0.029), (1.04, 0.0)], L_dark, 'foarm', SEG)
lathe_y('thigh', [(0.0, 0.0), (0.0, 0.104), (0.1, 0.111), (0.25, 0.11), (0.55, 0.097), (0.86, 0.082), (0.86, 0.0)], L_suit, 'thigh', SEG)
lathe_y('thigh_w', [(0.86, 0.0), (0.86, 0.082), (1.0, 0.076), (1.0, 0.0)], L_accent, 'thigh', SEG)
lathe_y('shin_w', [(0.0, 0.0), (0.0, 0.076), (0.1, 0.0795), (0.1, 0.0)], L_accent, 'shin', SEG)
lathe_y('shin', [(0.1, 0.0), (0.1, 0.0795), (0.2, 0.0825), (0.32, 0.079), (0.5, 0.064), (0.5, 0.0)], L_suit, 'shin', SEG)
lathe_y('shin_boot', [(0.5, 0.0), (0.5, 0.064), (0.505, 0.072), (0.56, 0.074), (0.8, 0.065), (1.0, 0.059), (1.03, 0.0)], L_dark, 'shin', SEG)

# ------------------------------------------------------------------ hands: a glove closed round the grip, with real fingers
# The grip's axis is the z axis through the origin (radius RG). The palm lies over the top of the grip towards the back, the knuckles sit above its
# front, the wrist is behind and above. Thumb, ring and little finger are wrapped round the grip and belong to the hand; index and middle finger are
# two pieces of their own, hinged on the knuckle line KN and on the middle joint: they lie on the lever (two-finger braking) and curl as they pull it.
RG = 0.0175
K_glove, K_accent = mat('K_glove', (0.02, 0.02, 0.022)), mat('K_accent', (0.9, 0.9, 0.88))      # K_: like the limbs' leather, but these keep their baked shading
def sausage(name, pts, radii, m, piece, seg=10):
    """a finger: a round tube through pts (game axes) with the given radii, closed by a rounded tip at each end"""
    bm = bmesh.new(); P = [V(*q) for q in pts]; n = len(P); rings = []; tans = []
    for i2 in range(n):
        t = (P[min(i2 + 1, n - 1)] - P[max(i2 - 1, 0)]).normalized(); ref = Vector((0, 1, 0)) if abs(t.y) < 0.8 else Vector((0, 0, 1)); a = t.cross(ref).normalized(); b = t.cross(a); tans.append(t)
        rings.append([bm.verts.new(P[i2] + (a * math.cos(k / seg * 6.2832) + b * math.sin(k / seg * 6.2832)) * radii[i2]) for k in range(seg)])
    def cap(ring, c, t, r):      # a rounded end: one smaller ring, then the tip
        r2 = [bm.verts.new(c + t * r * 0.55 + (v.co - c) * 0.72) for v in ring]; tip = bm.verts.new(c + t * r * 0.92)
        for k in range(seg): bm.faces.new([ring[k], ring[(k + 1) % seg], r2[(k + 1) % seg], r2[k]]); bm.faces.new([r2[k], r2[(k + 1) % seg], tip])
    for i2 in range(n - 1):
        for k in range(seg): bm.faces.new([rings[i2][k], rings[i2 + 1][k], rings[i2 + 1][(k + 1) % seg], rings[i2][(k + 1) % seg]])
    cap(rings[0], P[0], -tans[0], radii[0]); cap(rings[-1], P[-1], tans[-1], radii[-1])
    return finish(bm, name, m, piece, 60)
def arc(a0, a1, r, z, n=7): return [(r * math.cos(math.radians(a0 + (a1 - a0) * k / (n - 1))), r * math.sin(math.radians(a0 + (a1 - a0) * k / (n - 1))), z) for k in range(n)]
FR = RG + 0.0115                          # the fingers' centre line runs this far from the grip's axis
KN = (FR * math.cos(math.radians(58)), FR * math.sin(math.radians(58)))      # the knuckle line (x, y)
# back of the hand and palm: from the wrist, over the grip, to the knuckles
loft_x('hand', [dict(x=-0.096, y=0.046, w=0.029, ht=0.026, hb=0.026, e=2.2), dict(x=-0.076, y=0.039, w=0.031, ht=0.021, hb=0.022, e=2.4), dict(x=-0.05, y=0.033, w=0.038, ht=0.018, hb=0.021, e=2.8), dict(x=-0.022, y=0.029, w=0.0455, ht=0.02, hb=0.016, e=3.0),
                dict(x=0.004, y=0.03, w=0.048, ht=0.019, hb=0.012, e=3.0), dict(x=0.022, y=0.029, w=0.0475, ht=0.014, hb=0.012, e=3.0), dict(x=0.032, y=0.024, w=0.045, ht=0.007, hb=0.009, e=2.8)],
       K_glove, 'gloveR', ring=16, subsurf=1)
# ring and little finger, wrapped round the grip (+z is the outside of the right hand), and the thumb underneath, on the inside
FZ = (-0.0345, -0.0115, 0.0115, 0.0345)      # index, middle, ring, little finger along the grip
sausage('ring', arc(58, -150, FR, FZ[2]), [0.0108, 0.0108, 0.0106, 0.0103, 0.0099, 0.0094, 0.0087], K_glove, 'gloveR')
sausage('little', arc(56, -128, FR - 0.001, FZ[3]), [0.0098, 0.0098, 0.0096, 0.0093, 0.009, 0.0085, 0.0078], K_glove, 'gloveR')
sausage('thumb', [(-0.036, 0.012, -0.037), (-0.016, -0.008, -0.048), (0.006, -0.022, -0.05), (0.024, -0.027, -0.045), (0.037, -0.024, -0.038)], [0.013, 0.0127, 0.012, 0.011, 0.0098], K_glove, 'gloveR')
# knuckle guard (second colour): a low hard shell over the four knuckles - it is what makes the glove read as race kit
loft_x('knuckle', [dict(x=-0.002, y=0.0485, w=0.031, ht=0.0028, hb=0.005, e=2.8), dict(x=0.007, y=0.0487, w=0.0405, ht=0.005, hb=0.006, e=3.4), dict(x=0.02, y=0.0432, w=0.041, ht=0.0054, hb=0.007, e=3.4),
                   dict(x=0.0295, y=0.0345, w=0.037, ht=0.0032, hb=0.005, e=2.8)], K_accent, 'gloveR', ring=14, subsurf=1)
# index and middle finger in two pieces: fingersR is the first joint (origin on the knuckle line, FL1 long, pointing +x), tipsR the rest of the finger
# (origin on the middle joint), curled so that the lever lies in its crook at FCROOK. The game bends both so the crook stays on the lever.
FL1, FCROOK = 0.045, (0.0072, -0.0274)
for nm2, z, ln, r0 in (('index', FZ[0], 0.93, 0.0104), ('middle', FZ[1], 1.0, 0.0108)):
    sausage(nm2, [(0.0, 0.0, z), (FL1 * 0.5, 0.0, z), (FL1, 0.0, z)], [r0, r0 * 0.99, r0 * 0.97], K_glove, 'fingersR')
    sausage(nm2 + '_tip', [(0.0, 0.0, z), (0.012 * ln, -0.006 * ln, z), (0.0215 * ln, -0.019 * ln, z), (0.025 * ln, -0.030 * ln, z), (0.0255 * ln, -0.038 * ln, z)], [r0 * 0.97, r0 * 0.95, r0 * 0.91, r0 * 0.86, r0 * 0.8], K_glove, 'tipsR')
# the left hand: the right one, mirrored
for src, dst in (('gloveR', 'gloveL'), ('fingersR', 'fingersL'), ('tipsR', 'tipsL')):
    for o in list(PIECES[src]):
        me = o.data.copy(); bm = bmesh.new(); bm.from_mesh(me)
        for v in bm.verts: v.co.y = -v.co.y
        bmesh.ops.reverse_faces(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
        o2 = bpy.data.objects.new(o.name + '_L', me); scene.collection.objects.link(o2); PIECES.setdefault(dst, []).append(o2)
loft_x('boot', [dict(x=-0.115, y=0.02, w=0.028, ht=0.03, hb=0.03), dict(x=-0.09, y=0.022, w=0.044, ht=0.05, hb=0.042, e=3.0), dict(x=-0.02, y=0.025, w=0.048, ht=0.052, hb=0.045, e=3.0),
                dict(x=0.05, y=0.012, w=0.049, ht=0.036, hb=0.032, e=3.0), dict(x=0.11, y=0.003, w=0.045, ht=0.024, hb=0.023, e=3.0), dict(x=0.15, y=0.0, w=0.03, ht=0.014, hb=0.018)],
       L_dark, 'boot', ring=14, subsurf=1)

# heel counter and sole on the boot (hard grey): the things that make boots read as race kit
L_slider = mat('L_slider', (0.2, 0.2, 0.22))
loft_x('boot_heel', [dict(x=-0.122, y=0.006, w=0.03, ht=0.018, hb=0.02), dict(x=-0.098, y=0.006, w=0.0475, ht=0.03, hb=0.024, e=3.2), dict(x=-0.066, y=0.006, w=0.0505, ht=0.026, hb=0.024, e=3.2),
                     dict(x=-0.05, y=0.004, w=0.044, ht=0.014, hb=0.016, e=3.0)], L_slider, 'boot', ring=14, subsurf=1)
loft_x('boot_sole', [dict(x=-0.118, y=-0.022, w=0.03, ht=0.005, hb=0.007, e=3.0), dict(x=-0.09, y=-0.022, w=0.0465, ht=0.006, hb=0.008, e=3.4), dict(x=-0.02, y=-0.022, w=0.05, ht=0.006, hb=0.008, e=3.4),
                     dict(x=0.06, y=-0.022, w=0.0505, ht=0.006, hb=0.008, e=3.4), dict(x=0.115, y=-0.021, w=0.0465, ht=0.006, hb=0.007, e=3.4), dict(x=0.153, y=-0.019, w=0.03, ht=0.005, hb=0.006, e=3.0)],
       L_slider, 'boot', ring=14, subsurf=1)
# knee slider: an oval puck on the outside of the knee, standing a centimetre proud of it - the part that touches the road
def puck(name, c, n, u, a, b2, layers, m, piece, seg=20, e=2.6):
    n = Vector(n).normalized(); u = Vector(u).normalized(); v = n.cross(u); c = Vector(c); bm = bmesh.new(); rings = []
    for (d, sc) in layers:
        r = []
        for k in range(seg):
            an = k / seg * math.pi * 2; cs, sn = math.cos(an), math.sin(an)
            q = c + n * d + u * (a * sc * math.copysign(abs(cs) ** (2 / e), cs)) + v * (b2 * sc * math.copysign(abs(sn) ** (2 / e), sn)); r.append(bm.verts.new(V(q.x, q.y, q.z)))
        rings.append(r)
    for i in range(len(rings) - 1):
        for k in range(seg): bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    bm.faces.new(rings[-1]); bm.faces.new(list(reversed(rings[0])))
    return finish(bm, name, m, piece, 45)
puck('kneepuck', (0, 0, 0), (0.44, 0, 0.9), (0, 1, 0), 0.046, 0.03, [(0.05, 0.9), (0.079, 1.0), (0.085, 0.94), (0.088, 0.78)], L_slider, 'kneepuck')

# ------------------------------------------------------------------ a rider's back is not a plank: bow the whole torso into one even curve
# The spine bends forward by BEND degrees between the hips and just above the shoulder line; the result is turned back so the
# shoulders still stand straight above the hips at y = TL, which is what the game's rig expects. Seen against that line the small of the
# back sits further back and more upright, the upper back and neck lean forward.
BEND = math.radians(globals().get('BEND', 34.0)); BY0, BY1 = 0.02, TL + 0.03
if BEND > 1e-4:
    Rb = (BY1 - BY0) / BEND
    def bow(x, y):
        s = min(max(y - BY0, 0.0), BY1 - BY0); th = s / Rb
        cx, cy = Rb * (1 - math.cos(th)), BY0 + Rb * math.sin(th)
        if y < BY0: cy += y - BY0
        if y > BY1: cx += (y - BY1) * math.sin(th); cy += (y - BY1) * math.cos(th)
        return cx + x * math.cos(th), cy - x * math.sin(th)
    sxp, syp = bow(0.0, TL); ph = math.atan2(sxp, syp); k = TL / math.hypot(sxp, syp); cp, sp = math.cos(ph), math.sin(ph)
    for o in PIECES['torso']:
        for v in o.data.vertices:
            bx, by = bow(v.co.x, v.co.z); v.co.x, v.co.z = (bx * cp - by * sp) * k, (bx * sp + by * cp) * k
        o.data.update()

# lay the pieces apart for the AO bake
offs = {'torso': (0, 0, 0), 'helmet': (1.0, 0, 0), 'uparm': (2, 0, 0), 'foarm': (2.5, 0, 0), 'thigh': (3, 0, 0), 'shin': (3.5, 0, 0), 'gloveR': (4, 0, 0), 'gloveL': (4, 0, 0.5), 'fingersR': (5.5, 0, 0), 'fingersL': (5.5, 0, 0.5), 'tipsR': (6, 0, 0), 'tipsL': (6, 0, 0.5), 'boot': (4.5, 0, 0), 'kneepuck': (5, 0, 0)}
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
scene.cycles.samples = 64
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
