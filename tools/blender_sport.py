"""APEX sport bikes - STRADA V4 (superbike, 90-degree V4) and CORSA 600 (supersport, inline four): one chassis design of our own in two
sizes, built frame-first in stages like the Duetto and the supermoto, so that every step can be checked on its own.
The reference models in assets/examples/sportsbikes were studied for what a race bike is made of (twin-spar frame, braced swingarm, radial
brakes, the layout of an engine bay); no make's bodywork, colours or lettering are copied.

  VARIANT  'strada' (wheelbase 1.45 m, V4, 200 rear tyre) or 'corsa' (1.38 m, inline four, 190 rear tyre)
  STAGES   list of stages to build: 'chassis' (frame, subframe, swingarm with linkage, shock, fork, cast wheels, brakes)
           -> 'engine' (engine, cooling, exhaust, final drive, wiring loom and lines) -> 'controls' (clip-ons, levers, dash, footrests)
           -> 'body' (fairing, tank, seat, tail, lights)
  SHOTS    list of preview views to render into blender/renders/<PREFIX>_<view>.png
  EXPORT   True: bake AO into vertex colours and export the game assemblies to blender/bike_<variant>_<assembly>.glb

Bought-in parts are real CAD parts from the assets folder, brought to size and thinned out for the game:
  brake discs  assets/examples/BreakDisk/Brake+disc+v15.stl (310 mm floating disc; the rear one is the same disc at 220 mm)
  clip-ons     assets/amaturen/Left_Clip_On_Assem1.stl (clamp, bar, master cylinder, lever, reservoir; mirrored for the right side)

Assemblies: body · swing (swingarm, pivots at PIV) · link (rocker, turns on the frame) · rod (dog bones) · front (steered: clamps, outer fork tubes,
  clip-ons, dash) · fork (steered + slides along the fork: stanchions, axle lugs, calipers, axle) · wheelF / wheelR · shockU · shockL · spring
Coordinates and material prefixes: see tools/blender_kit.py. All positions are written for the 1.45 m wheelbase; gx() moves them for the shorter bike."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

OUT = '/Users/benedikt/Desktop/Apex/blender/'; SRC = '/Users/benedikt/Desktop/Apex/assets/'
VARIANT = globals().get('VARIANT', 'strada'); STAGES = globals().get('STAGES', ['chassis']); SHOTS = globals().get('SHOTS', []); EXPORT = globals().get('EXPORT', False)
PREFIX = globals().get('PREFIX', 'sb'); V4 = VARIANT == 'strada'
SCENE, OBJPRE = 'Sport_' + VARIANT, 'sb%s_' % VARIANT[0]
KIT = globals().get('KIT', '/Users/benedikt/Desktop/Apex/tools/blender_kit.py')
exec(compile(open(KIT).read(), KIT, 'exec'), globals())
ASM.setdefault('link', []); ASM.setdefault('rod', []); res = {'variant': VARIANT, 'stages': STAGES}

# ------------------------------------------------------------------ geometry (metres)
WB = 1.45 if V4 else 1.38; HX = WB / 2      # wheelbase
RF, RR = 0.300, (0.325 if V4 else 0.317)     # tyre radii (120/70-17 and 200/55-17 or 190/50-17)
WF, WR = 0.060, (0.100 if V4 else 0.096)     # tyre half widths
RIM = 0.2159; HWF, HWR = 0.0445, (0.076 if V4 else 0.073)      # 17-inch bead seat radius, rim half widths (3.5 and 6.0 / 5.75 inch)
CHZ = -(WR + 0.026)                          # the chain line: just clear of the rear tyre
RAKE = math.radians(24.0); OFFSET = 0.030    # steering head angle, fork offset
F = (HX, RF); A = (-HX, RR)                  # axles
U = (-math.sin(RAKE), math.cos(RAKE))        # up along the fork
N = (math.cos(RAKE), math.sin(RAKE))         # forward, square to the fork
FZ = 0.105                                   # fork tubes: half spacing
DZ = 0.069                                   # front discs: half spacing
def gx(x):
    """x of a point drawn for the 1.45 m wheelbase on this bike: the front end moves with the front axle, the rear with the rear axle, the middle is shared out"""
    d = HX - 0.725
    if x >= 0.30: return x + d
    if x <= -0.135: return x - d
    return x + d * (2 * (x + 0.135) / 0.435 - 1)
def P(x, y, z=0.0): return (gx(x), y, z)
def P2(x, y): return (gx(x), y)
def fp(s, z=0.0, b=0.0): return (F[0] + U[0] * s + N[0] * b, F[1] + U[1] * s + N[1] * b, z)       # point on the fork tube line, s metres above the axle (b: ahead of it)
def sp(s, z=0.0, b=0.0): return fp(s, z, b - OFFSET)                                              # same on the steering axis
def pol(c, r, a, z=0.0): return (c[0] + r * math.cos(a), c[1] + r * math.sin(a), z)
def side(q, s): return (q[0], q[1], q[2] * s)
def mix(a, b, t): return tuple(a[k] + (b[k] - a[k]) * t for k in range(len(a)))
PIV = P2(-0.135, 0.43)                                   # swingarm pivot
S0, S1 = P(-0.180, 0.665), P(-0.243, 0.325)              # shock: top eye on the frame, bottom eye on the linkage rocker
LF, RK2, RK0 = P2(-0.165, 0.300), P2(-0.220, 0.255), P2(-0.360, 0.338)      # rocker pivot on the frame, dog-bone eye on the rocker, dog-bone eye on the swingarm
EC, SPR = P2(0.080 if V4 else 0.070, 0.400), P2(-0.050, 0.435)      # crankshaft, gearbox sprocket
SPR_R, SPW_R, SPW_T = 0.0407, 0.1037, 41                 # sprockets: 16 and 41 teeth, 525 chain
FW = 0.0 if V4 else 0.014                                # the inline four is wider across its head: the spars stand further apart there
HB = (0.250, 0.600) if V4 else (0.232, 0.612)            # where the frame's hangers bolt to the cylinder head

# ------------------------------------------------------------------ materials (names of their own where the colour is this bike's)
X_frame = mat('X_sbframe', 'b3b7bc'); X_swing = mat('X_sbswing', 'a9adb3'); X_alu = mat('X_sbalu', 'c2c5c9'); X_steel = mat('X_sbsteel', 'd6d8db'); X_cast = mat('X_sbcast', '7d8188')
X_dark = mat('X_sbdark', '2a2c31'); X_gold = mat('X_sbgold', 'c79a2e'); C_chrome = mat('C_sbchrome', 'f2f4f6'); M_dark = mat('M_sbdark', '1c1e22'); M_tyre = mat('M_sbtyre', '1a1a1c'); M_tyre.diffuse_color = (0.006, 0.006, 0.007, 1)
M_disc = mat('X_sbdisc', 'a9adb2'); X_carrier = mat('X_sbcarrier', '34363b'); G_rim = mat('G_sbrim_' + VARIANT, 'b08d3e' if V4 else '17181c'); M_cal = mat('X_sbcaliper', '55585f'); X_pad = mat('M_sbpad', '6a3f2a')
M_spring = mat('G_sbspring', 'e3b50f'); X_shock = mat('X_sbshock', 'c9a43c'); X_sprocket = mat('X_sbsprocket', '8a8d93'); X_chain = mat('X_sbchain', '6b6e74'); X_sub = mat('M_sbsubframe', '17181b')
X_ti = mat('X_sbtitan', '8f8a80'); X_blue = mat('X_sbblue', '2c57c9'); X_red = mat('X_sbred', 'c8161c'); M_rubber = mat('M_sbrubber', '101113')

def many(name, m, asm, build, smooth=50):
    """several small parts in one object: build(bm) adds them to a fresh mesh"""
    bm = bmesh.new(); build(bm); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return obj_from_bm(bm, name, m, asm, smooth)
def bm_tube(bm, a, b, r, seg=6, caps=True):
    A_, B_ = V(*a), V(*b); t = (B_ - A_).normalized(); up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)); e1 = t.cross(up).normalized(); e2 = t.cross(e1); rings = []
    for (c, rr) in ((A_, r[0] if isinstance(r, (list, tuple)) else r), (B_, r[1] if isinstance(r, (list, tuple)) else r)):
        rings.append([bm.verts.new(c + (e1 * math.cos(k / seg * 6.2832) + e2 * math.sin(k / seg * 6.2832)) * rr) for k in range(seg)])
    for k in range(seg): bm.faces.new([rings[0][k], rings[0][(k + 1) % seg], rings[1][(k + 1) % seg], rings[1][k]])
    if caps: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[1])
def bolts(name, pts, r, l, m, asm, axis=(0, 0, 1), seg=6):
    """a set of bolt heads: short bars of radius r and length l centred on the points, along `axis`"""
    ax = Vector(axis).normalized()
    return many(name, m, asm, lambda bm: [bm_tube(bm, tuple(Vector(p) - ax * l / 2), tuple(Vector(p) + ax * l / 2), r, seg) for p in pts], 40)

# ------------------------------------------------------------------ bought-in parts: read once from the CAD files, kept in the .blend as meshes
def part_mesh(key):
    """'disc': axle along Blender Y, centre at the origin, metres. 'clipon': the left clip-on standing on an upright fork tube: clamp centre at the origin,
    tube axis = Blender Z, forward = X, the bar runs out along +Y. Facts read off the part are kept as properties of the mesh."""
    me = bpy.data.meshes.get('apexpart2_' + key)
    if me and (key != 'clipon' or 'ring_r' in me.keys()): return me
    if me: bpy.data.meshes.remove(me)                      # read by tools/blender_parts.py, which keeps no facts with it: read it again
    before = set(bpy.data.objects)
    bpy.ops.wm.stl_import(filepath=SRC + {'disc': 'examples/BreakDisk/Brake+disc+v15.stl', 'clipon': 'amaturen/Left_Clip_On_Assem1.stl'}[key])
    ob = [o for o in bpy.data.objects if o not in before][0]; bm = bmesh.new(); bm.from_mesh(ob.data); props = {}
    if key == 'disc':
        co = [v.co.copy() for v in bm.verts]; c = [(min(p[k] for p in co) + max(p[k] for p in co)) / 2 for k in range(3)]
        for v in bm.verts: v.co = Vector((-(v.co.y - c[1]), v.co.x - c[0], v.co.z - c[2])) * 0.001
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts[:], edges=bm.edges[:])
        rad = sorted(math.hypot(v.co.x, v.co.z) for v in bm.verts); props = {'r_out': rad[-1], 'r_bore': rad[0], 'th': max(v.co.y for v in bm.verts) * 2}
        # the mounting holes: the small circles just outside the bore
        ring = [v.co for v in bm.verts if rad[0] + 0.003 < math.hypot(v.co.x, v.co.z) < rad[0] + 0.017 and abs(v.co.y) > 0.001]
        if ring:
            props['r_bolt'] = sum(math.hypot(p.x, p.z) for p in ring) / len(ring); ang = sorted(math.atan2(p.z, p.x) for p in ring); grp = [[ang[0]]]
            for a in ang[1:]:
                if a - grp[-1][-1] > 0.2: grp.append([a])
                else: grp[-1].append(a)
            if len(grp) > 1 and grp[0][0] + 6.2832 - grp[-1][-1] < 0.2: grp[0] = [a - 6.2832 for a in grp.pop()] + grp[0]
            props['bolt_a'] = [sum(g) / len(g) for g in grp]
    else:
        co = [v.co.copy() for v in bm.verts]; zmin = min(p.z for p in co); low = [p for p in co if p.z < zmin + 2.0]
        x0, x1 = min(p.x for p in low), max(p.x for p in low); y0, y1 = min(p.y for p in low), max(p.y for p in low); ro = (x1 - x0) / 2; c = ((x0 + x1) / 2, (y0 + y1) / 2, zmin + ro)
        near = sorted(math.hypot(p.x - c[0], p.z - c[2]) for p in co if y0 - 0.01 <= p.y <= y1 + 0.01 and math.hypot(p.x - c[0], p.z - c[2]) < ro)
        props = {'ring_r': near[len(near) // 50] * 0.01, 'ring_ro': ro * 0.01, 'ring_h': (y1 - y0) * 0.01}
        for v in bm.verts: v.co = Vector((v.co.z - c[2], v.co.x - c[0], v.co.y - c[1])) * 0.01
        bm.to_mesh(ob.data); bm.free(); md = ob.modifiers.new('d', 'DECIMATE'); md.ratio = 0.06
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())); bm = bmesh.new(); bm.from_mesh(me2); bpy.data.meshes.remove(me2)
        bar = [v.co for v in bm.verts if v.co.y > 0.20]; props['bar'] = [sum(p.x for p in bar) / len(bar), sum(p.z for p in bar) / len(bar)]; props['bar_len'] = max(v.co.y for v in bm.verts)
    me = bpy.data.meshes.new('apexpart2_' + key); bm.to_mesh(me); bm.free(); me.use_fake_user = True
    for k, v in props.items(): me[k] = v
    old = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(old); return me
def part(name, key, M, m, asm, mirror=False, smooth=32, split=None, regions=()):
    """a copy of a bought-in part, placed by the matrix M (Blender space); mirror: reflected in its own Y first (left part -> right part).
    regions: [(test of a face centre in the part's own frame, material, name suffix)] - the first test a face passes decides which object and material it goes to.
    split: (radius about the part's Y axis, material) - the faces inside that radius become an object of their own (disc carrier)."""
    bm = bmesh.new(); bm.from_mesh(part_mesh(key)); regions = list(regions)
    if split: regions.append((lambda c, rs=split[0]: math.hypot(c.x, c.z) < rs, split[1], '_in'))
    took = {}
    for f in bm.faces:
        c = f.calc_center_median()
        for k, (test, m2, suf) in enumerate(regions):
            if test(c): took.setdefault(k, []).append(f); break
    Mm = M @ Matrix.Diagonal((1, -1, 1, 1)) if mirror else M
    for k, sel in took.items():
        bm2 = bmesh.new(); vm = {}
        for f in sel:
            vs = [vm.get(v) or vm.setdefault(v, bm2.verts.new(v.co)) for v in f.verts]
            try: bm2.faces.new(list(reversed(vs)) if mirror else vs)
            except ValueError: pass
        bmesh.ops.transform(bm2, matrix=Mm, verts=bm2.verts); obj_from_bm(bm2, name + regions[k][2], regions[k][1], asm, smooth)
    bmesh.ops.delete(bm, geom=[f for sel in took.values() for f in sel], context='FACES')
    if mirror:
        for f in bm.faces: f.normal_flip()
    bmesh.ops.transform(bm, matrix=Mm, verts=bm.verts); return obj_from_bm(bm, name, m, asm, smooth)
def frame3(o, ex, ey, ez): return Matrix(((ex[0], ey[0], ez[0], o[0]), (ex[1], ey[1], ez[1], o[1]), (ex[2], ey[2], ez[2], o[2]), (0, 0, 0, 1)))
DISC = part_mesh('disc'); res['disc'] = {k: (list(DISC[k]) if hasattr(DISC[k], '__len__') else DISC[k]) for k in DISC.keys()}
CLIP = part_mesh('clipon'); res['clipon'] = {k: (list(CLIP[k]) if hasattr(CLIP[k], '__len__') else CLIP[k]) for k in CLIP.keys()}
FRU = max(0.0245, min(0.0285, CLIP['ring_r'] - 0.0002))      # the upper fork tubes are as thick as the clip-on clamps are wide

# ================================================================== STAGE 1: rolling chassis
if 'chassis' in STAGES:
    # ---- steering head: a cast aluminium block round the head tube, the two spars grow out of it
    rod('headtube', sp(0.522), sp(0.698), 0.034, X_frame, 'body', seg=24)
    for s0, s1 in ((0.512, 0.524), (0.696, 0.708)): rod('headcup%.2f' % s0, sp(s0), sp(s1), 0.037, X_steel, 'body', seg=24)
    hs = sp(0.61)
    plate('headstock', hull(circ(hs[0], hs[1], 0.058, 20) + circ(hs[0] - 0.085, hs[1] - 0.018, 0.05, 16) + circ(hs[0] - 0.05, hs[1] - 0.06, 0.035, 12)), 0.118, X_frame, 'body', bevel=0.014, seg=3)

    # ---- main frame: aluminium twin spar. Two deep box beams run from the head round the outside of the cylinder head, straight at the swingarm pivot;
    # behind the engine each one turns down into a forged upright that carries the pivot, the footrests and the linkage
    SP = [(0.405, 0.862, 0.052), (0.31, 0.815, 0.122 + FW * 0.6), (0.18, 0.748, 0.168 + FW), (0.04, 0.678, 0.176 + FW), (-0.06, 0.628, 0.168 + FW * 0.4), (-0.118, 0.585, 0.162)]
    for s in (-1, 1):
        sweep('spar%d' % s, [side(P(*q), s) for q in SP], [0.015, 0.0165, 0.0175, 0.0175, 0.0175, 0.0165], [0.05, 0.053, 0.052, 0.05, 0.05, 0.05], X_frame, 'body', e=5.5, ring=20, smooth=6, sa=50)
        UP = hull(circ(*P2(-0.092, 0.612), 0.062, 18) + circ(PIV[0], PIV[1], 0.052, 18) + circ(*P2(-0.175, 0.50), 0.03, 12) + circ(*P2(-0.150, 0.312), 0.038, 14) + circ(*P2(-0.085, 0.40), 0.03, 12))
        cutplate('upright%d' % s, UP, [circ(*P2(-0.118, 0.535), 0.022, 16), hull(circ(*P2(-0.122, 0.372), 0.013, 10) + circ(*P2(-0.135, 0.345), 0.011, 10))], 0.03, X_frame, 'body', off=s * 0.158)
        cyl('pivbossF%d' % s, 0.03, 0.014, (PIV[0], PIV[1], s * 0.178), X_frame, 'body', seg=22, bevel=0.003)
        cyl('pivnut%d' % s, 0.016, 0.012, (PIV[0], PIV[1], s * 0.19), X_steel, 'body', seg=6, bevel=0.002)
        # engine hangers: a forged leg down from each spar to the cylinder head
        plate('hanger%d' % s, hull(circ(*P2(0.255, 0.762), 0.03, 12) + circ(*P2(0.20, 0.735), 0.026, 12) + circ(*P2(*HB), 0.019, 12)), 0.014, X_frame, 'body', off=s * (0.158 + FW * 1.3), bevel=0.004)
        cyl('hangerbolt%d' % s, 0.009, 0.008, P(HB[0], HB[1], s * (0.168 + FW * 1.3)), X_steel, 'body', seg=6, bevel=0.0015)
        cyl('mountbolt%d' % s, 0.009, 0.008, P(-0.085, 0.40, s * 0.175), X_steel, 'body', seg=6, bevel=0.0015)
    cyl('pivaxle', 0.011, 0.37, (PIV[0], PIV[1], 0), X_steel, 'body', seg=12, bevel=0)
    # cross members: the shock hangs from the upper one, the linkage rocker turns on the lower one
    sweep('xshock', [(S0[0] + 0.004, S0[1] + 0.03, -0.148), (S0[0] + 0.004, S0[1] + 0.03, 0.148)], 0.02, 0.016, X_frame, 'body', e=4.0, ring=12)
    rod('xlower', (LF[0], LF[1], -0.142), (LF[0], LF[1], 0.142), 0.0135, X_frame, 'body', seg=12)
    for s in (-1, 1):
        plate('shk_lugT%d' % s, hull(circ(S0[0], S0[1], 0.019, 14) + circ(S0[0] + 0.004, S0[1] + 0.032, 0.015, 12)), 0.006, X_frame, 'body', off=s * 0.021, bevel=0.0015)
        plate('link_lugF%d' % s, hull(circ(LF[0], LF[1], 0.018, 12) + circ(LF[0] + 0.004, LF[1] + 0.014, 0.014, 12)), 0.006, X_frame, 'body', off=s * 0.034, bevel=0.0015)

    # ---- subframe: a light steel trellis bolted on behind the spars, carries seat and tail
    ST = [(-0.07, 0.668, 0.135), (-0.26, 0.742, 0.118), (-0.47, 0.826, 0.09), (-0.60, 0.886, 0.062)]
    SL = [(-0.135, 0.545, 0.150), (-0.31, 0.665, 0.125), (-0.47, 0.826, 0.09)]
    for s in (-1, 1):
        tube('sub_top%d' % s, [side(P(*q), s) for q in ST], 0.0105, X_sub, 'body', seg=12, smooth=5)
        tube('sub_low%d' % s, [side(P(*q), s) for q in SL], 0.0105, X_sub, 'body', seg=12, smooth=5)
        for k, (a, b) in enumerate((((-0.135, 0.545, 0.150), (-0.165, 0.705, 0.127)), ((-0.165, 0.705, 0.127), (-0.31, 0.665, 0.125)), ((-0.31, 0.665, 0.125), (-0.335, 0.772, 0.108)))):
            rod('sub_d%d_%d' % (s, k), side(P(*a), s), side(P(*b), s), 0.0085, X_sub, 'body', seg=10)
        for (bx, by, bz) in ((-0.07, 0.668, 0.135), (-0.135, 0.545, 0.150)): cyl('sub_bolt%d_%.2f' % (s, by), 0.0095, 0.012, P(bx, by, s * (bz + 0.012)), X_steel, 'body', seg=6, bevel=0.002)
    tube('sub_loop', [P(-0.60, 0.886, -0.062), P(-0.628, 0.891, -0.034), P(-0.636, 0.892, 0.0), P(-0.628, 0.891, 0.034), P(-0.60, 0.886, 0.062)], 0.0105, X_sub, 'body', seg=12, smooth=5)
    for (bx, by, bz) in ((-0.26, 0.742, 0.118), (-0.47, 0.826, 0.09)): rod('sub_x%.2f' % bx, P(bx, by, -bz), P(bx, by, bz), 0.0085, X_sub, 'body', seg=10)

    # ---- swingarm: aluminium, braced on top like a racing arm. Deep at the front, slim at the axle; a bridge ahead of the tyre; the left arm is
    # cranked a little so the chain runs clear
    ZA = WR + 0.052                                    # the arms' centre lines at the axle
    for s in (-1, 1):
        sweep('arm%d' % s, [(PIV[0] + 0.004, PIV[1], s * 0.112), (PIV[0] - 0.14, 0.412, s * (ZA - 0.012)), (A[0] + 0.24, 0.372, s * ZA), (A[0] + 0.07, 0.336, s * ZA), (A[0] - 0.062, 0.318, s * ZA)],
              [0.0185, 0.0185, 0.017, 0.016, 0.016], [0.036, 0.052, 0.05, 0.04, 0.031], X_swing, 'swing', e=6.5, ring=20, smooth=5)
        sweep('brace%d' % s, [(PIV[0] - 0.03, 0.458, s * 0.118), (PIV[0] - 0.13, 0.526, s * (ZA - 0.02)), (PIV[0] - 0.25, 0.512, s * (ZA - 0.006)), (A[0] + 0.19, 0.41, s * ZA)],
              0.0135, [0.02, 0.019, 0.017, 0.015], X_swing, 'swing', e=4.5, ring=14, smooth=5)
        rod('bracestrut%d' % s, (PIV[0] - 0.165, 0.445, s * (ZA - 0.012)), (PIV[0] - 0.165, 0.515, s * (ZA - 0.014)), 0.011, X_swing, 'swing', seg=10)
        cyl('pivboss%d' % s, 0.037, 0.05, (PIV[0], PIV[1], s * 0.112), X_swing, 'swing', seg=22, bevel=0.004)
        box('axleblock%d' % s, (0.07, 0.046, 0.009), (A[0] - 0.012, A[1], s * (ZA + 0.019)), X_cast, 'swing', bevel=0.003)
        cyl('axlenut%d' % s, 0.021, 0.014, (A[0], A[1], s * (ZA + 0.03)), X_steel, 'swing', seg=6, bevel=0.002)
        rod('adjbolt%d' % s, (A[0] - 0.085, A[1], s * ZA), (A[0] - 0.056, A[1], s * ZA), 0.0055, X_steel, 'swing', seg=6)
        rod('spool%d' % s, (A[0] + 0.075, A[1] - 0.012, s * (ZA + 0.016)), (A[0] + 0.075, A[1] - 0.012, s * (ZA + 0.046)), [0.0075, 0.0075, 0.014, 0.014, 0.009, 0.014, 0.014], X_red, 'swing', seg=12)
    sweep('armbridge', [(PIV[0] - 0.172, 0.43, -(ZA - 0.014)), (PIV[0] - 0.172, 0.43, ZA - 0.014)], 0.028, 0.05, X_swing, 'swing', e=4.6, ring=16)
    sweep('bracebridge', [(PIV[0] - 0.172, 0.521, -(ZA - 0.016)), (PIV[0] - 0.172, 0.521, ZA - 0.016)], 0.02, 0.016, X_swing, 'swing', e=3.6, ring=12)
    cyl('axleR', 0.0125, 2 * ZA + 0.07, (A[0], A[1], 0), X_steel, 'swing', seg=12, bevel=0)
    # rear caliper: two-piston, on a carrier under the right arm
    RD = 0.110; RZ = WR + 0.018                         # rear disc: radius, where it sits
    plate('rcarrier', hull(circ(A[0], A[1], 0.03) + circ(*pol(A, 0.098, math.radians(212))[:2], 0.02) + circ(*pol(A, 0.098, math.radians(238))[:2], 0.016)), 0.008, X_cast, 'swing', off=RZ + 0.021, bevel=0.002)
    plate('rcaliper', hull(circ(*pol(A, 0.095, math.radians(206))[:2], 0.026) + circ(*pol(A, 0.095, math.radians(236))[:2], 0.026)), 0.046, M_cal, 'swing', off=RZ, bevel=0.009)
    bolts('rcal_b', [pol(A, 0.095, math.radians(a), RZ + 0.024) for a in (206, 236)], 0.011, 0.006, X_alu, 'swing', seg=12)

    # ---- rear suspension: one shock on the centre line behind the pivot, worked through a linkage (rising rate). The rocker turns on the frame's lower cross
    # member (LF) and carries the shock's lower eye (S1); two dog bones tie its other eye (RK2) to the swingarm under the bridge (RK0).
    # Rocker and dog bones are assemblies of their own ('link', 'rod'): the game solves the four-bar every frame.
    for s in (-1, 1):
        plate('rocker%d' % s, hull(circ(LF[0], LF[1], 0.019, 14) + circ(S1[0], S1[1], 0.018, 14) + circ(RK2[0], RK2[1], 0.016, 14)), 0.007, X_cast, 'link', off=s * 0.021, bevel=0.002)
        rod('dogbone%d' % s, (RK2[0], RK2[1], s * 0.041), (RK0[0], RK0[1], s * 0.041), [0.011, 0.0085, 0.0085, 0.011], X_alu, 'rod', seg=10)
        plate('rk_lug%d' % s, hull(circ(RK0[0], RK0[1], 0.017, 12) + circ(RK0[0] + 0.03, RK0[1] + 0.05, 0.022, 12)), 0.006, X_swing, 'swing', off=s * 0.032, bevel=0.0015)
    sweep('rk_web', [(RK0[0] + 0.03, RK0[1] + 0.058, -0.06), (RK0[0] + 0.03, RK0[1] + 0.058, 0.06)], 0.02, 0.014, X_swing, 'swing', e=3.6, ring=10)
    for (c, r, w, asm) in ((LF, 0.009, 0.082, 'link'), (S1[:2], 0.009, 0.06, 'link'), (RK2, 0.008, 0.098, 'link'), (RK0, 0.008, 0.098, 'swing')): cyl('rk_pin%.3f' % c[0], r, w, (c[0], c[1], 0), X_steel, asm, seg=10, bevel=0.0015)
    sd = (S1[0] - S0[0], S1[1] - S0[1])
    def shp(f, z=0.0): return (S0[0] + sd[0] * f, S0[1] + sd[1] * f, z)
    cyl('shk_eyeT', 0.015, 0.036, S0, X_steel, 'body', seg=14, bevel=0.002); cyl('shk_eyeB', 0.014, 0.036, S1, X_steel, 'link', seg=14, bevel=0.002)
    rod('shk_body', shp(0.05), shp(0.52), [0.021, 0.0245, 0.0245, 0.0245], X_shock, 'shockU', seg=18)
    rod('shk_shaft', shp(0.3), shp(0.95), 0.008, C_chrome, 'shockL', seg=14)
    rod('shk_collarT', shp(0.13), shp(0.165), 0.039, X_dark, 'shockU', seg=22); rod('shk_collarB', shp(0.85), shp(0.885), 0.037, X_dark, 'shockL', seg=22)
    coil('shk_spring', shp(0.165), shp(0.85), 0.031, 0.0066, 7.5, M_spring, 'spring')
    # remote gas reservoir on the right of the subframe, a braided line to the shock's head (the V4's rear pipes pass either side of the shock)
    RV0, RV1 = P(-0.20, 0.655, 0.134), P(-0.285, 0.712, 0.126)
    rod('shk_res', RV0, RV1, 0.0185, X_shock, 'body', seg=16); rod('shk_rescap', RV1, mix(RV0, RV1, 1.1), [0.0165, 0.0165, 0.012], X_blue, 'body', seg=16)
    for f in (0.3, 0.7): rod('shk_resclamp%.1f' % f, mix(RV0, RV1, f - 0.04), mix(RV0, RV1, f + 0.04), 0.0205, X_dark, 'body', seg=16)
    hose('shk_resline', [shp(0.04, 0.02), (S0[0] - 0.01, S0[1] + 0.035, 0.07), (RV0[0] + 0.03, RV0[1] + 0.01, 0.125), mix(RV0, RV1, -0.04)], 0.005, mat('X_sbbraid', '9a9da2'), 'body', fit=X_blue)

    # ---- fork: upside-down racing fork. Gold outer tubes in two billet clamps, a good length of bright chrome stanchion showing below them, cast axle lugs with radial caliper mounts
    for s in (-1, 1):
        z = s * FZ
        tube('forkO%d' % s, [fp(0.30, z), fp(0.50, z), fp(0.54, z), fp(0.735, z)], [0.0288, 0.0288, FRU, FRU], X_gold, 'front', seg=24)
        rod('forkseal%d' % s, fp(0.287, z), fp(0.302, z), 0.0268, M_dark, 'front', seg=22)
        rod('forkcap%d' % s, fp(0.735, z), fp(0.746, z), [0.0235, 0.021], X_alu, 'front', seg=18)
        # the clickers on top of the caps: compression on one leg, rebound on the other
        rod('forkadj%d' % s, fp(0.746, z), fp(0.757, z), [0.0115, 0.0115, 0.0095], X_blue if s < 0 else X_gold, 'front', seg=10)
        rod('forkadjscrew%d' % s, fp(0.757, z), fp(0.760, z), 0.0045, X_steel, 'front', seg=8)
        rod('forkS%d' % s, fp(0.07, z), fp(0.50, z), 0.0215, C_chrome, 'fork', seg=28)
        tube('forkfoot%d' % s, [fp(-0.05, z), fp(-0.038, z), fp(0.03, z), fp(0.082, z), fp(0.10, z)], [0.021, 0.031, 0.032, 0.0295, 0.0245], X_cast, 'fork', seg=20)
        cyl('axleboss%d' % s, 0.033, 0.046, (F[0], F[1], z), X_cast, 'fork', seg=20, bevel=0.004)
        bolts('lugbolt%d' % s, [fp(sv, z, 0.034) for sv in (-0.02, 0.02)], 0.0052, 0.016, X_steel, 'fork', seg=8)
        # radial caliper mounts: two lugs grown out of the axle lug, behind the leg
        FCA = (150, 170, 190)
        plate('callug%d' % s, hull(circ(F[0], F[1], 0.03) + circ(*fp(0.07)[:2], 0.022) + circ(*pol(F, 0.112, math.radians(FCA[0]))[:2], 0.012) + circ(*pol(F, 0.112, math.radians(FCA[2]))[:2], 0.012)), 0.02, X_cast, 'fork', off=s * (DZ + 0.02), bevel=0.003)
        # four-piston monobloc caliper: the body straddles the disc, open on top where the pads show
        CO = hull([q for a in FCA for q in circ(*pol(F, 0.139, math.radians(a))[:2], 0.034, 14)])
        slot = [pol(F, r, math.radians(a))[:2] for (r, a) in ((0.151, 157), (0.151, 183), (0.127, 183), (0.127, 157))]
        for (dz, th) in ((0.019, 0.022), (-0.019, 0.022)): cutplate('caliper%d_%.3f' % (s, dz), CO, [slot], th, M_cal, 'fork', off=s * (DZ + dz))
        cutplate('calbridge%d' % s, CO, [hull([pol(F, r, math.radians(a))[:2] for (r, a) in ((0.168, 152), (0.168, 188), (0.112, 190), (0.112, 150))])], 0.018, M_cal, 'fork', off=s * DZ)
        plate('calpad%d' % s, hull([pol(F, r, math.radians(a))[:2] for (r, a) in ((0.153, 158), (0.153, 182), (0.125, 182), (0.125, 158))]), 0.022, X_pad, 'fork', off=s * DZ, bevel=0.001)
        bolts('calpist%d' % s, [pol(F, 0.139, math.radians(a), s * (DZ + 0.031)) for a in (160, 180)], 0.0135, 0.006, X_alu, 'fork', seg=14)
        many('calbolt%d' % s, X_ti, 'fork', lambda bm: [bm_tube(bm, pol(F, 0.106, math.radians(a), s * (DZ + 0.02)), pol(F, 0.162, math.radians(a), s * (DZ + 0.02)), 0.0048, 8) for a in (FCA[0], FCA[2])])
        rod('calbleed%d' % s, pol(F, 0.166, math.radians(176), s * (DZ + 0.016)), pol(F, 0.18, math.radians(176), s * (DZ + 0.016)), [0.004, 0.004, 0.0025], X_steel, 'fork', seg=6)
    cyl('axleF', 0.0125, 2 * FZ + 0.07, (F[0], F[1], 0), X_steel, 'fork', seg=12, bevel=0)
    cyl('axlenutF', 0.019, 0.012, (F[0], F[1], FZ + 0.03), X_steel, 'fork', seg=6, bevel=0.002)
    # triple clamps (machined from billet) and stem
    yoke = lambda rt, rs: hull(circ(0, 0, rs, 20) + circ(OFFSET, -FZ, rt, 20) + circ(OFFSET, FZ, rt, 20))
    plate('clampL', yoke(0.045, 0.042), 0.036, X_dark, 'front', origin=sp(0.50), ex=(N[0], N[1], 0), ey=(0, 0, 1), bevel=0.006)
    cutplate('clampU', yoke(0.041, 0.038), [hull(circ(OFFSET + 0.004, sg * 0.05, 0.011, 10) + circ(0.002, sg * 0.047, 0.006, 8) + circ(0.016, sg * 0.064, 0.006, 8)) for sg in (-1, 1)], 0.022, X_dark, 'front', origin=sp(0.714), ex=(N[0], N[1], 0), ey=(0, 0, 1))
    rod('stem', sp(0.48), sp(0.73), 0.015, X_steel, 'front', seg=12); rod('stemnut', sp(0.725), sp(0.738), [0.021, 0.021, 0.017], X_alu, 'front', seg=6)
    for s in (-1, 1):
        bolts('pinchL%d' % s, [fp(0.50 + dz, s * (FZ + 0.03), 0.04) for dz in (-0.009, 0.009)], 0.0055, 0.014, X_steel, 'front', axis=(N[0], N[1], 0), seg=8)
        bolts('pinchU%d' % s, [fp(0.714, s * (FZ + 0.028), 0.036)], 0.0055, 0.014, X_steel, 'front', axis=(N[0], N[1], 0), seg=8)

    # ---- wheels: forged, five Y-spokes; tyres with a light road tread; the bought-in floating discs
    M_groove = mat('M_sbgroove', '060607')
    def wheel(asm, R, W, hw, c2, hh, disc_z=(), disc_s=1.0, sprocket=None, phase=0.0, nsp=5, grooves=None):
        cx, cy = c2; c = (cx, cy, 0); rr = RIM; H = R - rr
        # supersport tyre: the bead sits inside the rim's lip, a short side wall, then one round sweep over the shoulder to the crown
        half = [(rr + 0.004, hw - 0.004), (rr + 0.016, hw + 0.004), (rr + 0.2 * H, W * 0.93), (rr + 0.36 * H, W * 0.99), (rr + 0.5 * H, W), (rr + 0.66 * H, W * 0.965), (rr + 0.8 * H, W * 0.86), (rr + 0.9 * H, W * 0.68),
                (rr + 0.965 * H, W * 0.44), (rr + 0.992 * H, W * 0.22), (R, 0.0)]
        lathe(asm + '_tyre', [(r, -z) for (r, z) in half[:-1]] + [(r, z) for (r, z) in reversed(half)], M_tyre, asm, 72, c, 80)
        if grooves:
            # a light tread like a supersport road tyre: long grooves sweeping from near the crown out to the shoulder, a short one between each pair, by turns left and right
            ng, dr = grooves; tread = [q for q in half if q[0] >= rr + 0.5 * H - 1e-9]; bmc = bmesh.new()
            def rz(z):                                   # radius of the tread at the lateral position z
                a = abs(z)
                for (r0, z0), (r1, z1) in zip(tread, tread[1:]):
                    if z1 - 1e-9 <= a <= z0 + 1e-9: return r0 + (r1 - r0) * (z0 - a) / max(z0 - z1, 1e-9)
                return tread[0][0]
            for path, ph in (([(0.0, 0.10), (0.11, 0.42), (0.25, 0.80)], 0.0), ([(0.0, 0.46), (0.09, 0.80)], 0.55)):      # (angle, share of the half width)
                for k in range(2 * ng):
                    sd = 1 if k % 2 else -1; th0 = (k + ph * 2) / (2 * ng) * 6.2832; pts = []
                    for (a0, z0), (a1, z1) in zip(path, path[1:]):
                        for j in range(7): pts.append((th0 + dr * (a0 + (a1 - a0) * j / 6), sd * W * (z0 + (z1 - z0) * j / 6)))
                    ring = []
                    for j, (th, z) in enumerate(pts):
                        th2, z2 = pts[min(j + 1, len(pts) - 1)]; th1, z1 = pts[max(j - 1, 0)]; r = rz(z)
                        du, dv = (th2 - th1) * r, z2 - z1; L = math.hypot(du, dv) or 1.0; nu, nv = -dv / L * 0.0023, du / L * 0.0023      # half the groove's width, across its run
                        row = []
                        for sg2 in (-1, 1):
                            zz = z + sg2 * nv; tt = th + sg2 * nu / r; rr2 = rz(zz) + 0.0006
                            row.append(bmc.verts.new(V(cx + rr2 * math.cos(tt), cy + rr2 * math.sin(tt), zz)))
                        ring.append(row)
                    for a2, b2 in zip(ring, ring[1:]):
                        f = bmc.faces.new([a2[0], a2[1], b2[1], b2[0]]); co = f.calc_center_median(); f.normal_update()
                        if f.normal.dot(co - V(cx, cy, co.y * -1.0)) < 0: f.normal_flip()
            obj_from_bm(bmc, asm + '_grooves', M_groove, asm, 60)
        # rim: the lips either side and the barrel between them that one sees through the spokes; closed on the tyre's side
        rim = [(rr + 0.019, hw + 0.002), (rr + 0.02, hw + 0.0075), (rr + 0.012, hw + 0.011), (rr - 0.002, hw + 0.0105), (rr - 0.011, hw * 0.94), (rr - 0.018, hw * 0.6), (rr - 0.023, hw * 0.26), (rr - 0.024, 0.0)]
        prof = [(r, -z) for (r, z) in rim[:-1]] + [(r, z) for (r, z) in reversed(rim)] + [(rr + 0.006, hw * 0.9), (rr - 0.012, 0.0), (rr + 0.006, -hw * 0.9), (rim[0][0], -rim[0][1])]
        lathe(asm + '_rim', prof, G_rim, asm, 72, c, 50)
        rod(asm + '_valve', pol(c2, rr - 0.022, phase + 0.63, hw * 0.3), pol(c2, rr - 0.05, phase + 0.63, hw * 0.3 + 0.012), [0.0042, 0.0042, 0.003], X_alu, asm, seg=6)
        # hub: a spool with a flange each side for discs and sprocket carrier
        hub = [(0.017, hh + 0.016), (0.03, hh + 0.014), (0.036, hh + 0.001), (0.066, hh), (0.066, hh - 0.007), (0.05, hh - 0.018), (0.046, hh * 0.45), (0.045, 0.0)]
        lathe(asm + '_hub', [(r, -z) for (r, z) in hub[:-1]] + [(r, z) for (r, z) in reversed(hub)], G_rim, asm, 40, c, 40)
        # spokes: a stem from the hub that forks into two slim arms out to the barrel
        r0, r1 = 0.04, rr - 0.021; rs = r0 + (r1 - r0) * 0.34; dth = 6.2832 / nsp * 0.265; wl = min(hw * 0.5, 0.03)
        for k in range(nsp):
            th = phase + k / nsp * 6.2832
            sweep('%s_sp%d' % (asm, k), [pol(c2, r0, th), pol(c2, rs + 0.012, th)], [wl, wl * 0.74], [0.0165, 0.0125], G_rim, asm, e=3.4, ring=12, caps=False, sa=60)
            for sg in (-1, 1):
                sweep('%s_sp%d_%d' % (asm, k, sg), [pol(c2, rs - 0.012, th + sg * dth * 0.1), pol(c2, rs + (r1 - rs) * 0.45, th + sg * dth * 0.62), pol(c2, r1 + 0.004, th + sg * dth)], [wl * 0.74, wl * 0.6, wl * 0.62], [0.0095, 0.0078, 0.0092],
                      G_rim, asm, e=3.4, ring=12, smooth=5, caps=False, sa=60)
        for z in disc_z:
            Rm = Matrix.Translation(V(cx, cy, z)) @ Matrix.Rotation(phase, 4, 'Y') @ Matrix.Diagonal((disc_s, 1.0, disc_s, 1.0))
            part('%s_disc%.3f' % (asm, z), 'disc', Rm, M_disc, asm, smooth=30, split=(0.117, X_carrier))
            rb = DISC['r_bolt'] * disc_s if 'r_bolt' in DISC.keys() else 0.054 * disc_s
            bolts('%s_discb%.3f' % (asm, z), [pol(c2, rb, -a - phase, z) for a in (DISC['bolt_a'] if 'bolt_a' in DISC.keys() else [k * 1.2566 for k in range(5)])], 0.0052 * max(disc_s, 0.85), 0.014, X_steel, asm, seg=6)
            if abs(z) > hh + 0.006:        # a spacer ring where the disc stands off the hub
                lathe('%s_dcone%.3f' % (asm, z), [(0.03, math.copysign(hh, z)), (0.062 * disc_s + 0.004, z - math.copysign(0.0025, z)), (0.03, z - math.copysign(0.0025, z))], G_rim, asm, 28, c, 40)
        if sprocket:
            z, nt, rp = sprocket; teeth = [pol(c2, rp + (0.0052 if k % 2 else -0.0035), k / (2 * nt) * 6.2832)[:2] for k in range(2 * nt)]
            cutplate(asm + '_sprocket', teeth, [circ(cx, cy, 0.052, 28)] + [hull(circ(*pol(c2, 0.074, (k + 0.5) / 5 * 6.2832 - 0.3)[:2], 0.009, 8) + circ(*pol(c2, 0.074, (k + 0.5) / 5 * 6.2832 + 0.3)[:2], 0.009, 8)) for k in range(5)],
                     0.007, X_sprocket, asm, off=z)
            lathe(asm + '_scone', [(0.03, math.copysign(hh + 0.004, z)), (0.064, z + math.copysign(0.005, -z)), (0.064, z + math.copysign(0.012, -z)), (0.03, math.copysign(hh - 0.002, z))], X_dark, asm, 28, c, 40)
            bolts(asm + '_spb', [pol(c2, 0.059, k / 5 * 6.2832, z) for k in range(5)], 0.0058, 0.016, X_steel, asm, seg=6)
    wheel('wheelF', RF, WF, HWF, F, DZ - 0.0025, disc_z=(-DZ, DZ), phase=0.2, grooves=(11, -1))
    wheel('wheelR', RR, WR, HWR, A, 0.072, disc_z=(RZ,), disc_s=RD / DISC['r_out'], sprocket=(CHZ, SPW_T, SPW_R), phase=0.5, grooves=(12, 1))

# ================================================================== STAGE 2: engine, cooling, exhaust, final drive, wiring loom and lines
if 'engine' in STAGES:
    X_eng = mat('X_sbengine', '474a50'); X_mag = mat('X_sbmag', '806e57'); M_plastic = mat('M_sbplastic', '17181b'); X_rad = mat('X_sbrad', 'a4a8ad'); M_core = mat('M_sbcore', '24262a')
    G_hose = mat('G_sbhose', '1f4fb8'); X_clamp = mat('X_sbclamp', 'c8cbd0'); M_wire = mat('M_sbwire', '0e0f11'); M_wred = mat('M_sbwirered', 'a3161b'); M_conn = mat('M_sbconn', '3a3c42'); M_carbon = mat('M_sbcarbon', '1b1c1f')
    X_pipe = mat('X_sbpipe', '9c958a'); X_heat = mat('X_sbpipeheat', '8a6f7c'); X_can = mat('X_sbcan', 'aba69c'); M_wyel = mat('M_sbwireyel', 'c9a21a'); X_braid = mat('X_sbbraid', '9a9da2'); M_cell = mat('M_sbcell', '20232a')
    def E(dx, dy, z=0.0): return (EC[0] + dx, EC[1] + dy, z)
    def bank(a):
        """points on a cylinder bank that leans a (rad) forward of upright: u along the bores from the crankshaft, v square to them (forward side positive), z across"""
        d = (math.sin(a), math.cos(a)); p = (math.cos(a), -math.sin(a))
        f = lambda u, v=0.0, z=0.0: (EC[0] + d[0] * u + p[0] * v, EC[1] + d[1] * u + p[1] * v, z)
        f.d = (d[0], d[1], 0.0); f.p = (p[0], p[1], 0.0); return f
    WC = 0.105 if V4 else 0.14                          # half width of the crankcase at the crankshaft
    CLX, CLZ, CLD = (-0.06, 0.104, 0.048) if V4 else (-0.03, 0.138, 0.04)      # clutch: how far behind the crankshaft, where its cover starts, how deep it is

    # ---- crankcase and gearbox (a stacked gearbox behind the crankshaft), sump, side covers
    plate('crankcase', hull(circ(EC[0], EC[1], 0.098, 24) + circ(*E(0.0, -0.09)[:2], 0.06, 16) + circ(*E(-0.07, -0.085)[:2], 0.05, 14)), 2 * WC, X_eng, 'body', bevel=0.012, seg=3)
    plate('gearbox', hull(circ(*E(-0.085, 0.045)[:2], 0.088, 22) + circ(SPR[0], SPR[1], 0.058, 16) + circ(*E(-0.06, -0.07)[:2], 0.055, 14)), 0.215, X_eng, 'body', bevel=0.012, seg=3)
    plate('sump', hull(circ(*E(0.02, -0.135)[:2], 0.04, 12) + circ(*E(-0.07, -0.13)[:2], 0.035, 12)), 0.15, X_eng, 'body', bevel=0.012, seg=2)
    bolts('sumpplug', [E(-0.03, -0.172)], 0.008, 0.012, X_steel, 'body', axis=(0, 1, 0))
    CL = E(CLX, 0.035)
    spin('clutchcover', (CL[0], CL[1], CLZ), (CL[0], CL[1], CLZ + CLD), [(0.0, 0.09), (0.45, 0.088), (0.8, 0.07), (1.0, 0.046), (1.0, 0.0)], X_mag, 'body', seg=36)
    bolts('clutchbolts', [pol(CL, 0.0815, (k + 0.5) / 8 * 6.2832, CLZ + CLD * 0.5) for k in range(8)], 0.0042, 0.01, X_steel, 'body')
    spin('clutchboss', (CL[0], CL[1], CLZ + CLD), (CL[0], CL[1], CLZ + CLD + 0.006), [(0.0, 0.03), (1.0, 0.026), (1.0, 0.0)], X_eng, 'body', seg=20)
    spin('altcover', E(0, 0, -WC + 0.004), E(0, 0, -WC - 0.045), [(0.0, 0.08), (0.5, 0.078), (0.85, 0.06), (1.0, 0.036), (1.0, 0.0)], X_mag, 'body', seg=32)
    bolts('altbolts', [pol(EC, 0.072, (k + 0.5) / 6 * 6.2832, -WC - 0.02) for k in range(6)], 0.0042, 0.01, X_steel, 'body')
    PUMP = E(0.07, -0.078)
    spin('waterpump', (PUMP[0], PUMP[1], -WC + 0.004), (PUMP[0], PUMP[1], -WC - 0.034), [(0.0, 0.037), (0.6, 0.035), (1.0, 0.02), (1.0, 0.0)], X_eng, 'body', seg=20)
    rod('oilfilter', E(0.088, -0.062, 0.05), E(0.158, -0.082, 0.05), [0.0335, 0.0335, 0.0335, 0.03], M_dark, 'body', seg=18)
    rod('sightglass', E(-0.02, -0.075, WC - 0.002), E(-0.02, -0.075, WC + 0.004), 0.011, X_gold, 'body', seg=12)
    # gearbox sprocket and its shaft
    teeth = [pol(SPR, SPR_R + (0.005 if k % 2 else -0.0035), k / 32 * 6.2832)[:2] for k in range(32)]
    cutplate('sprocketF', teeth, [circ(SPR[0], SPR[1], 0.011, 10)], 0.007, X_sprocket, 'body', off=CHZ)
    rod('outshaft', (SPR[0], SPR[1], -0.1), (SPR[0], SPR[1], CHZ - 0.012), [0.016, 0.016, 0.013, 0.013], X_steel, 'body', seg=12)
    cyl('sprocketnut', 0.019, 0.008, (SPR[0], SPR[1], CHZ - 0.008), X_steel, 'body', seg=6, bevel=0.002)

    # ---- cylinders. STRADA: 90-degree V4, the front bank well forward, the rear one leaning back between the spars; exhausts on the outsides of the V,
    # throttle bodies inside it. CORSA: four in a row leaning forward, exhausts in front, throttle bodies behind.
    if V4: BANKS = [('F', bank(math.radians(50)), 1, (-0.052, 0.052), 0.108), ('R', bank(math.radians(-40)), -1, (-0.052, 0.052), 0.108)]
    else: BANKS = [('I', bank(math.radians(30)), 1, (-0.12, -0.04, 0.04, 0.12), 0.158)]
    PORTS, INTAKES, COILS = [], [], []
    for nm, B, sg, ZC, hw in BANKS:
        sweep('cyl' + nm, [B(0.085), B(0.232)], hw, 0.064, X_eng, 'body', e=6.5, ring=20)
        sweep('head' + nm, [B(0.23), B(0.296)], hw + 0.007, 0.074, X_eng, 'body', e=6.5, ring=20)
        sweep('cam' + nm, [B(0.294), B(0.32), B(0.336)], [hw, hw - 0.004, hw - 0.02], [0.068, 0.062, 0.044], X_mag, 'body', e=4.2, ring=20)
        for k in range(4): sweep('fin%s%d' % (nm, k), [B(0.112 + k * 0.03), B(0.118 + k * 0.03)], hw + 0.004, 0.068, X_eng, 'body', e=6.5, ring=20)      # stiffening ribs round the block
        bolts('cambolt' + nm, [B(0.323, v, z) for v in (-0.05, 0.05) for z in ([-hw + 0.018, 0.0, hw - 0.018] if not V4 else [-hw + 0.018, hw - 0.018])], 0.005, 0.014, X_steel, 'body', axis=B.d)
        for z in ZC:
            COILS.append((B(0.35, 0.0, z), B)); PORTS.append((nm, B(0.264, sg * 0.074, z), B)); INTAKES.append((nm, B(0.268, -sg * 0.072, z), B))
        bolts('coil' + nm, [B(0.341, 0.0, z) for z in ZC], 0.0125, 0.03, M_plastic, 'body', axis=B.d, seg=10)
        bolts('port' + nm, [B(0.264, sg * 0.076, z) for z in ZC], 0.027, 0.016, X_eng, 'body', axis=B.p, seg=14)
        # engine mounts: a boss on each side of the head, bolted to the frame's hangers
        if nm != 'R':
            for s in (-1, 1): rod('mount%s%d' % (nm, s), P(HB[0], HB[1], s * (hw - 0.002)) if V4 else P(HB[0], HB[1], s * (hw + 0.004)), P(HB[0], HB[1], s * (0.151 + FW * 1.3)), 0.013, X_eng, 'body', seg=12)
    if not V4:
        rod('starter', E(-0.04, 0.128, -0.005), E(-0.04, 0.128, -0.13), [0.03, 0.03, 0.03, 0.026], X_dark, 'body', seg=16)
        sweep('camchain', [E(0.02, 0.06, 0.15), BANKS[0][1](0.294, 0.0, 0.156)], 0.012, 0.04, X_eng, 'body', e=5, ring=12)      # cam chain tunnel on the right

    # ---- intake: throttle bodies up into the airbox that sits between the spars, fuel rail and injectors; the airbox breathes through the steering head
    TB = []
    for k, (nm, q, B) in enumerate(INTAKES):
        top = E(0.115, 0.312, q[2]) if nm == 'F' else E(-0.08, 0.325, q[2]) if nm == 'R' else E(0.03, 0.335, q[2])
        tube('tbody%d' % k, [q, mix(q, top, 0.55)[:2] + (q[2],), top], [0.024, 0.0255, 0.0255], X_alu, 'body', seg=16, smooth=4); TB.append((nm, top, q))
        inj = mix(q, top, 0.5); out = (-B.p[0] * (1 if nm != 'R' else -1), 0.6); L = math.hypot(*out); out = (out[0] / L * (1 if nm == 'F' else 1), out[1] / L)
        a0 = (inj[0] - 0.026 * (1 if nm == 'R' else -1) * 0 + (0.03 if nm == 'R' else -0.03), inj[1] + 0.012, q[2]); a1 = (a0[0] + (0.022 if nm == 'R' else -0.022), a0[1] + 0.03, q[2])
        rod('inj%d' % k, a0, a1, [0.0075, 0.0075, 0.006], X_dark, 'body', seg=8); rod('injcap%d' % k, a1, mix(a0, a1, 1.35), 0.0085, X_blue, 'body', seg=8)
    for nm in sorted({t[0] for t in TB}):
        zs = [t[1][2] for t in TB if t[0] == nm]; t0 = [t for t in TB if t[0] == nm][0]; inj = mix(t0[2], t0[1], 0.5); rx = inj[0] + (0.058 if nm == 'R' else -0.058); ry = inj[1] + 0.052
        rod('fuelrail' + nm, (rx, ry, min(zs) - 0.03), (rx, ry, max(zs) + 0.03), 0.008, X_alu, 'body', seg=10)
        rod('tbshaft' + nm, (mix(t0[2], t0[1], 0.3)[0], mix(t0[2], t0[1], 0.3)[1], min(zs) - 0.04), (mix(t0[2], t0[1], 0.3)[0], mix(t0[2], t0[1], 0.3)[1], max(zs) + 0.04), 0.004, X_steel, 'body', seg=6)
    ABX = [dict(x=EC[0] + 0.25, y=0.802, w=0.055, ht=0.028, hb=0.034), dict(x=EC[0] + 0.17, y=0.782, w=0.116, ht=0.045, hb=0.062), dict(x=EC[0] + 0.02, y=0.768, w=0.128, ht=0.046, hb=0.06),
           dict(x=EC[0] - 0.11, y=0.752, w=0.116, ht=0.036, hb=0.046), dict(x=EC[0] - 0.155, y=0.746, w=0.08, ht=0.02, hb=0.03)]
    for sct in ABX: sct['e'] = 4.5
    loft('airbox', ABX, M_plastic, 'body', ring=20)
    sweep('airduct', [(EC[0] + 0.24, 0.80, 0.0), P(0.36, 0.83, 0.0)], 0.05, 0.026, M_plastic, 'body', e=4.0, ring=14)
    bolts('airboxscrews', [(EC[0] + dx, 0.768 + 0.046 * (0.985 if dx > 0 else 0.93) + (0.01 if dx > 0 else -0.004), z) for dx in (0.15, -0.08) for z in (-0.075, 0.075)], 0.005, 0.006, X_steel, 'body', axis=(0, 1, 0))

    # ---- cooling: a curved radiator in front of the engine, an oil cooler under it; silicone hoses to the pump and from the heads
    def radiator(name, yc, ht, hw, xc, lean, bow, th=0.026):
        """core: a slab bowed round the front wheel; an aluminium tank down each side"""
        def q(v, u): return P(xc + lean * (0.5 - v) + bow * u * u, yc + ht * (0.5 - v), u * hw)
        panel(name, [[q(i / 4, k / 8 * 2 - 1) for k in range(9)] for i in range(5)], th, M_core, 'body', subsurf=0)
        for s in (-1, 1): sweep('%s_tank%d' % (name, s), [q(i / 4, s * 1.06) for i in range(5)], 0.011, th / 2 + 0.006, X_rad, 'body', e=3.5, ring=12, smooth=3)
        for (v, nm2) in ((-0.012, 'T'), (1.012, 'B')): tube(name + '_rail' + nm2, [q(v, k / 8 * 2 - 1) for k in range(9)], 0.006, X_rad, 'body', seg=8)
        return q
    RQ = radiator('radiator', 0.588, 0.25, 0.185, 0.40, -0.03, 0.03)
    OQ = radiator('oilcooler', 0.405, 0.075, 0.125, 0.42, -0.008, 0.016, th=0.022)
    rod('radcap', RQ(0.0, 1.06)[:1] + (RQ(0.0, 1.06)[1] + 0.004, RQ(0.0, 1.06)[2]), RQ(0.0, 1.06)[:1] + (RQ(0.0, 1.06)[1] + 0.03, RQ(0.0, 1.06)[2]), [0.012, 0.012, 0.019, 0.019, 0.016], X_steel, 'body', seg=14)
    for s in (-1, 1): rod('radstay%d' % s, RQ(0.02, s * 0.75), P(0.335, 0.80, s * 0.11), 0.005, X_alu, 'body', seg=8)
    hose('hose_pump', [(PUMP[0] + 0.012, PUMP[1], -WC - 0.03), (PUMP[0] + 0.09, PUMP[1] + 0.02, -WC - 0.05), mix(RQ(1.0, -1.06), (PUMP[0] + 0.09, PUMP[1], -WC - 0.05), 0.35), tuple(Vector(RQ(0.93, -1.06)) + Vector((-0.024, 0, 0)))], 0.0155, G_hose, 'body', fit=X_clamp)
    THS = BANKS[0][1](0.27, -0.085, 0.07) if V4 else BANKS[0][1](0.265, -0.075, 0.14)                  # thermostat housing on the head
    hose('hose_head', [THS, (THS[0] + 0.03, THS[1] + 0.07, THS[2] + 0.05), mix(RQ(0.0, 1.06), THS, 0.3)[:1] + (RQ(0.0, 1.06)[1] - 0.02, 0.17 + FW), tuple(Vector(RQ(0.08, 1.06)) + Vector((-0.024, 0, 0)))], 0.0155, G_hose, 'body', fit=X_clamp)
    if V4:
        RB = BANKS[1][1]; hose('hose_bank', [RB(0.27, 0.085, 0.07), RB(0.3, 0.11, 0.085), mix(RB(0.3, 0.11, 0.085), THS, 0.6)[:2] + (0.1,), (THS[0] - 0.02, THS[1] + 0.01, THS[2] + 0.012)], 0.012, G_hose, 'body', fit=X_clamp)
    hose('hose_overflow', [tuple(Vector(RQ(0.0, 1.06)) + Vector((0, 0.02, 0))), RQ(0.3, 1.13), RQ(0.8, 1.1), P(0.33, 0.44, 0.15)], 0.0045, mat('M_sbclear', 'b9c0c4'), 'body')
    sweep('overflow', [P(0.33, 0.47, 0.142), P(0.318, 0.36, 0.14)], 0.016, 0.03, mat('M_sbbottle', '9aa1a6'), 'body', e=3.5, ring=12)
    for s in (-1, 1):
        hose('oilline%d' % s, [E(0.09, -0.04, s * 0.045), E(0.17, 0.0, s * 0.075), mix(OQ(0.5, s * 1.06), E(0.17, 0.0, s * 0.075), 0.35), tuple(Vector(OQ(0.5, s * 1.06)) + Vector((-0.02, 0, 0)))], 0.0065, X_braid, 'body', fit=X_blue)

    # ---- exhaust, titanium. STRADA: the front bank's two pipes run under the engine to a short megaphone low on the right; the rear bank's two climb
    # past the shock and end in a megaphone under the tail. CORSA: four into one under the engine, the same megaphone on the right.
    M_soot = mat('M_sbsoot', '0a0a0b')
    def megaphone(name, a, b, radii, tip):
        """a silencer one can look into: the can is an open tube, a carbon end ring with a rolled lip, and inside it a sooty bore that narrows to the pipe far up the can"""
        n = len(radii) - 1; tube(name, [mix(a, b, i / n) for i in range(n + 1)], list(radii), X_can, 'body', seg=24, closed_ends=False)
        end = mix(b, a, -tip); r = radii[-1]
        spin(name + '_tip', b, end, [(0.0, r + 0.0005), (0.25, r + 0.0015), (0.9, r - 0.003), (1.0, r - 0.006), (0.96, r - 0.009)], M_carbon, 'body', seg=24)
        spin(name + '_bore', end, mix(b, a, 0.8), [(0.03, r - 0.009), (0.3, r - 0.011), (0.75, radii[0] * 0.82), (1.0, radii[0] * 0.7), (1.0, 0.0)], M_soot, 'body', seg=24, flip=True)
    LOW = [q for q in PORTS if q[0] != 'R']; n = len(LOW); MEG0, MEG1 = P(-0.165, 0.226, 0.098), P(-0.335, 0.262, 0.112)
    for k, (nm, q, B) in enumerate(LOW):
        z = q[2]; zt = 0.03 + (k - (n - 1) / 2) * (0.038 if V4 else 0.024)
        pts = [q, tuple(Vector(q) + Vector(B.p) * 0.03 + Vector((0, -0.012, 0))), E(0.258 if V4 else 0.236, -0.03, z * (1.0 if V4 else 0.92)), E(0.215 if V4 else 0.2, -0.16, z * 0.8), E(0.1, -0.202, mix((z,), (zt,), 0.6)[0]), E(-0.03, -0.204, zt)]
        tube('header%d' % k, pts[:3], 0.019, X_heat, 'body', seg=14, smooth=6); tube('headerB%d' % k, pts[2:], 0.019, X_pipe, 'body', seg=14, smooth=6)
        rod('hflange%d' % k, q, tuple(Vector(q) + Vector(B.p) * 0.012), 0.027, X_steel, 'body', seg=14)
    sweep('collector', [E(-0.03, -0.204, 0.03), E(-0.1, -0.2, 0.04)], [0.02 + 0.019 * n * (0.55 if V4 else 0.5), 0.034], [0.021, 0.03], X_pipe, 'body', e=2.6, ring=16)
    tube('linkpipe', [E(-0.1, -0.2, 0.04), mix(E(-0.1, -0.2, 0.04), MEG0, 0.5)[:2] + (0.07,), MEG0], [0.03, 0.03, 0.033], X_pipe, 'body', seg=16, smooth=5)
    megaphone('megaphone', MEG0, MEG1, [0.033, 0.041, 0.044, 0.044, 0.044], 0.16)
    rod('megaband', mix(MEG0, MEG1, 0.42), mix(MEG0, MEG1, 0.5), 0.0455, X_steel, 'body', seg=22)
    rod('megastay', mix(MEG0, MEG1, 0.46)[:1] + (mix(MEG0, MEG1, 0.46)[1] + 0.04, 0.115), P(-0.128, 0.318, 0.15), 0.006, X_alu, 'body', seg=8)
    for k, (nm, q, B) in enumerate(LOW[:2 if V4 else 4:1 if V4 else 3]):              # lambda sensors
        o = E(0.1, -0.202, 0.0); rod('lambda%d' % k, (o[0], o[1] + 0.016, 0.03 + (k * 2 - 1) * 0.05), (o[0] + 0.01, o[1] + 0.05, 0.03 + (k * 2 - 1) * 0.062), [0.007, 0.007, 0.005], X_steel, 'body', seg=8)
    if V4:
        UP = [q for q in PORTS if q[0] == 'R']; U0, U1 = P(-0.43, 0.765, 0.0), P(-0.615, 0.795, 0.0)
        for k, (nm, q, B) in enumerate(UP):
            s = 1 if q[2] > 0 else -1
            pts = [q, tuple(Vector(q) - Vector(B.p) * 0.03 + Vector((0, 0, s * 0.012))), P(-0.172, 0.568, s * 0.074), P(-0.205, 0.605, s * 0.088), P(-0.255, 0.66, s * 0.088), P(-0.315, 0.714, s * 0.07), P(-0.38, 0.752, s * 0.04), P(-0.425, 0.764, s * 0.016)]
            tube('uheader%d' % k, pts[:5], 0.019, X_heat, 'body', seg=14, smooth=6); tube('uheaderB%d' % k, pts[4:], 0.019, X_pipe, 'body', seg=14, smooth=6)
            rod('uflange%d' % k, q, tuple(Vector(q) - Vector(B.p) * 0.012), 0.027, X_steel, 'body', seg=14)
        sweep('ucollector', [P(-0.405, 0.76, 0.0), U0], [0.046, 0.03], [0.021, 0.03], X_pipe, 'body', e=2.6, ring=16)
        megaphone('umegaphone', U0, U1, [0.03, 0.038, 0.042, 0.042, 0.042], 0.14)
        rod('umegaband', mix(U0, U1, 0.45), mix(U0, U1, 0.53), 0.0435, X_steel, 'body', seg=22)
        for s in (-1, 1): rod('umegastay%d' % s, mix(U0, U1, 0.49)[:1] + (mix(U0, U1, 0.49)[1] + 0.03, s * 0.03), P(-0.47, 0.826, s * 0.09), 0.005, X_alu, 'body', seg=8)

    # ---- final drive: chain round both sprockets (a stand-in here, the game draws it link by link), slider on the swingarm
    dx, dy = A[0] - SPR[0], A[1] - SPR[1]; Lc = math.hypot(dx, dy); base = math.atan2(dy, dx); dd = math.asin((SPW_R - SPR_R) / Lc); CH = []
    for k in range(13): CH.append(pol(SPR, SPR_R + 0.003, base + math.pi / 2 + dd + (math.pi - 2 * dd) * k / 12, CHZ))
    for k in range(17): CH.append(pol(A, SPW_R + 0.003, base - math.pi / 2 - dd + (math.pi + 2 * dd) * k / 16, CHZ))
    CH.append(CH[0]); ch = sweep('chain', CH, 0.0095, 0.0075, X_chain, 'swing', e=4.0, ring=8, caps=False); ch['noexport'] = True
    sweep('chainslider', [(PIV[0] + 0.03, PIV[1] + 0.03, CHZ), (PIV[0] - 0.02, PIV[1] + 0.046, CHZ), (PIV[0] - 0.16, 0.468, CHZ)], 0.014, 0.006, M_plastic, 'swing', e=3.0, ring=10, smooth=4)
    plate('chainguard', hull(circ(A[0] + 0.33, 0.44, 0.012, 8) + circ(A[0] + 0.12, 0.455, 0.012, 8) + circ(A[0] + 0.14, 0.48, 0.008, 8)), 0.028, M_carbon, 'swing', off=CHZ, bevel=0.003)

    # ---- electrics. The main loom leaves the steering head, runs back under the left spar and up to the tail, where control unit and battery sit;
    # branches go to coils, injectors, sensors and the charging system
    M0 = [P(0.39, 0.80, -0.075), P(0.33, 0.765, -0.115), P(0.25, 0.722, -0.15 - FW), P(0.12, 0.655, -0.168 - FW), P(0.0, 0.598, -0.168 - FW), P(-0.07, 0.585, -0.135), P(-0.12, 0.64, -0.118), P(-0.2, 0.708, -0.105),
          P(-0.3, 0.765, -0.085), P(-0.37, 0.80, -0.06), P(-0.41, 0.812, -0.04)]
    tube('loom', M0, [0.0085] * 6 + [0.008, 0.008, 0.0075, 0.007, 0.007], M_wire, 'body', seg=8, smooth=5)
    many('loomties', M_conn, 'body', lambda bm: [bm_tube(bm, mix(M0[i], M0[i + 1], 0.42), mix(M0[i], M0[i + 1], 0.5), 0.0105, 8) for i in (1, 2, 3, 4, 6, 7, 8)], 40)
    box('ecu', (0.115, 0.026, 0.09), P(-0.405, 0.818, 0.0), M_dark, 'body', rot=(0, 0, 0.22), bevel=0.004)
    box('ecuplug', (0.022, 0.018, 0.06), P(-0.34, 0.80, -0.008), M_conn, 'body', rot=(0, 0, 0.22), bevel=0.003)
    box('battery', (0.105, 0.052, 0.07), P(-0.535, 0.88, 0.0), M_cell, 'body', rot=(0, 0, -0.16), bevel=0.005)
    bolts('batposts', [P(-0.50, 0.914, s * 0.02) for s in (-1, 1)], 0.006, 0.008, X_gold, 'body', axis=(0, 1, 0), seg=8)
    tube('cable_pos', [P(-0.50, 0.917, 0.02), P(-0.44, 0.86, 0.07), P(-0.3, 0.77, 0.1), P(-0.17, 0.69, 0.115), P(-0.1, 0.6, 0.12), E(-0.07, 0.115, 0.112) if V4 else E(-0.04, 0.128, 0.0)], 0.0055, M_wred, 'body', seg=8, smooth=5)
    tube('cable_neg', [P(-0.50, 0.917, -0.02), P(-0.45, 0.855, -0.05), P(-0.34, 0.78, -0.075), P(-0.2, 0.69, -0.1), P(-0.12, 0.6, -0.11), E(-0.1, 0.12, -0.1)], 0.005, M_wire, 'body', seg=8, smooth=5)
    tube('loom_tail', [P(-0.41, 0.812, -0.04), P(-0.47, 0.842, -0.05), P(-0.56, 0.888, -0.045), P(-0.625, 0.897, -0.012)], 0.0045, M_wire, 'body', seg=6, smooth=5)
    # voltage regulator: a finned block on the left of the subframe, three yellow phases from the alternator
    RG = P(-0.215, 0.69, -0.134)
    box('regulator', (0.075, 0.05, 0.016), RG, X_alu, 'body', rot=(0, 0, 0.55), bevel=0.003)
    many('regfins', X_alu, 'body', lambda bm: [bm_tube(bm, (RG[0] - 0.03 + k * 0.012, RG[1] - 0.04 + k * 0.0074, RG[2] - 0.012), (RG[0] - 0.056 + k * 0.012, RG[1] + 0.002 + k * 0.0074, RG[2] - 0.012), 0.0035, 4) for k in range(7)], 40)
    tube('wire_phases', [E(-0.02, 0.07, -WC - 0.03), E(-0.09, 0.13, -WC - 0.02) if V4 else E(-0.1, 0.13, -0.125), P(-0.1, 0.56, -0.135), (RG[0] + 0.03, RG[1] - 0.03, RG[2] + 0.004)], 0.0048, M_wyel, 'body', seg=6, smooth=5)
    # coil leads: a sub-loom along each cam cover, a plug on every coil
    for nm, B, sg, ZC, hw in BANKS:
        z0 = min(ZC) - 0.03; bus = [B(0.356, -sg * 0.03, z0)] + [B(0.356, -sg * 0.03, z) for z in ZC]
        tube('coilbus' + nm, bus, 0.004, M_wire, 'body', seg=6)
        many('coilplug' + nm, M_conn, 'body', lambda bm: [bm_tube(bm, B(0.354, -0.012 * sg, z), B(0.364, 0.006 * sg, z), 0.0075, 6) for z in ZC], 40)
        many('coillead' + nm, M_wire, 'body', lambda bm: [bm_tube(bm, B(0.356, -sg * 0.03, z), B(0.36, -0.006 * sg, z), 0.003, 5) for z in ZC], 40)
        tap = M0[3] if nm != 'R' else M0[5]
        tube('coilfeed' + nm, [bus[0], B(0.338, -sg * 0.06, z0 - 0.02), mix(B(0.338, -sg * 0.06, z0 - 0.02), tap, 0.6), tap], 0.004, M_wire, 'body', seg=6, smooth=5)
    # injector loom: along the fuel rails, down to the main loom
    for nm in sorted({t[0] for t in TB}):
        zs = [t[1][2] for t in TB if t[0] == nm]; t0 = [t for t in TB if t[0] == nm][0]; inj = mix(t0[2], t0[1], 0.5); rx = inj[0] + (0.07 if nm == 'R' else -0.07); ry = inj[1] + 0.04
        tube('injbus' + nm, [(rx, ry, max(zs) + 0.02), (rx, ry, min(zs) - 0.035), (rx, ry - 0.02, -0.135), M0[4]], 0.0038, M_wire, 'body', seg=6, smooth=3)
    # sensors: crank pick-up on the alternator cover, gear position on the gearbox, oil pressure in front, the two lambda sensors
    tube('wire_crank', [E(0.05, 0.03, -WC - 0.04), E(0.03, 0.11, -WC - 0.03), mix(E(0.03, 0.11, -WC - 0.03), M0[4], 0.6), M0[4]], 0.0032, M_wire, 'body', seg=6, smooth=5)
    box('plug_crank', (0.02, 0.012, 0.012), E(0.05, 0.03, -WC - 0.04), M_conn, 'body', bevel=0.002)
    tube('wire_gear', [(SPR[0] + 0.03, SPR[1] - 0.06, -0.112), (SPR[0] - 0.01, SPR[1] + 0.07, -0.118), P(-0.09, 0.56, -0.13), M0[5]], 0.0032, M_wire, 'body', seg=6, smooth=5)
    tube('wire_oil', [E(0.1, -0.02, -0.06), E(0.13, 0.08, -WC - 0.012), mix(E(0.13, 0.08, -WC - 0.012), M0[3], 0.5), M0[3]], 0.003, M_wire, 'body', seg=6, smooth=5)
    for k in range(2 if V4 else 1):
        o = E(0.1, -0.202, 0.0); tube('wire_lambda%d' % k, [(o[0] + 0.01, o[1] + 0.05, 0.03 + (k * 2 - 1) * 0.062), E(0.14, -0.1, (k * 2 - 1) * (WC + 0.012)), E(0.12, 0.05, (k * 2 - 1) * (WC + 0.014)), E(0.06, 0.2, -0.13) if k == 0 else E(0.06, 0.2, 0.13)],
                                    0.003, M_wire, 'body', seg=6, smooth=5)
    # the loom's front end: a cluster of plugs on the steering head for dash and switches (their leads come with the controls)
    for k, (dy, dz) in enumerate(((0.0, -0.066), (0.03, -0.066), (-0.03, -0.066))): box('headplug%d' % k, (0.026, 0.016, 0.012), P(0.385, 0.815 + dy, dz), M_conn, 'body', rot=(0, 0, 0.5), bevel=0.002)
    # fuel line and breather
    hose('fuelline', [P(-0.02, 0.76, 0.05), P(0.03, 0.7, 0.14), TB[0][1][:1] + (TB[0][1][1] + 0.02, 0.12), (TB[0][1][0] - 0.05, TB[0][1][1] - 0.005, max(t[1][2] for t in TB) + 0.03)], 0.0055, X_braid, 'body', fit=X_red)
    BB = BANKS[-1][1]; hose('breather', [BB(0.336, 0.0, 0.0), BB(0.375, 0.01, 0.0), (EC[0] - 0.13 if V4 else EC[0] + 0.2, 0.72, 0.02), (EC[0] - 0.12 if V4 else EC[0] + 0.19, 0.74, 0.03)], 0.007, M_rubber, 'body')
# ================================================================== STAGE 3: controls - clip-ons, dash, steering damper, lines, footrests
if 'controls' in STAGES:
    X_clip = mat('X_sbclip', '2b2d32'); M_grip = mat('M_sbgrip', '131416'); X_lever = mat('X_sblever', '45474d'); M_resv = mat('M_sbresv', 'bdb9a4'); M_plastic = mat('M_sbplastic', '17181b'); M_carbon = mat('M_sbcarbon', '1b1c1f')
    X_braid = mat('X_sbbraid', '9a9da2'); M_wire = mat('M_sbwire', '0e0f11'); M_conn = mat('M_sbconn', '3a3c42'); G_glass = mat('G_sbdash', '06080b'); G_led = [mat('G_sbled%d' % k, c) for k, c in enumerate(('27d04a', 'e8c61a', 'e3261c', '2a7fe6'))]
    # ---- clip-ons: the bought-in assembly on each fork tube under the upper clamp, swept back; the right one is the mirror image.
    # In the part's own frame the fork tube stands upright through the clamp (z), the bar runs out sideways (y) 36 mm ahead of the tube - drooping 6 degrees: its axis is
    # 5 mm above the clamp's middle at its inner end and 23 mm below at the outer end (BZ). Grip, switch housing and bar end sit on that axis.
    CS, CA = 0.683, math.radians(31); BX = 0.036; BZ = lambda yo: 0.0047 - 0.1055 * (yo + 0.0275); GRIP = {}
    for s in (-1, 1):
        o = V(*fp(CS, s * FZ)); M = frame3(o, Vector((N[0], 0, N[1])), Vector((0, 1, 0)), Vector((U[0], 0, U[1]))) @ Matrix.Rotation(-s * CA, 4, 'Z')
        def Lg(x, yo, z, M=M, s=s):          # a point of the part's frame (x ahead, yo out along the bar, z up the tube) in game space
            w = M @ Vector((x, -s * yo, z)); return (w.x, w.z, -w.y)
        part('clipon%d' % s, 'clipon', M, X_clip, 'front', mirror=s > 0, smooth=38, regions=[
            (lambda c: c.z > 0.068, M_plastic, '_cap'), (lambda c: c.z > 0.047, M_resv, '_resv'),
            (lambda c: c.x > 0.058 and c.y > 0.045, X_lever, '_lever')])
        rod('grip%d' % s, Lg(BX, 0.116, BZ(0.116)), Lg(BX, 0.243, BZ(0.243)), [0.0195, 0.0165, 0.0165, 0.0165, 0.0165, 0.0165, 0.0165, 0.0165, 0.0165, 0.018], M_grip, 'front', seg=16)
        rod('barend%d' % s, Lg(BX, 0.243, BZ(0.243)), Lg(BX, 0.266, BZ(0.266)), [0.0165, 0.0165, 0.0165, 0.012], X_gold if V4 else X_blue, 'front', seg=16)
        # switch housing inboard of the grip (right: twist grip housing too), a few buttons on it
        rod('switch%d' % s, Lg(BX, 0.082, BZ(0.082)), Lg(BX, 0.114, BZ(0.114)), [0.019, 0.021, 0.021, 0.019], M_plastic, 'front', seg=14)
        bolts('button%dA' % s, [Lg(BX - 0.021, 0.098, BZ(0.098) + 0.004)], 0.0055, 0.006, G_led[2] if s > 0 else G_led[0], 'front', axis=Vector(Lg(BX - 0.03, 0.098, BZ(0.098))) - Vector(Lg(BX, 0.098, BZ(0.098))), seg=10)
        bolts('button%dB' % s, [Lg(BX - 0.017, 0.098, BZ(0.098) - 0.014)], 0.0045, 0.006, G_led[3] if s > 0 else G_led[1], 'front', axis=Vector(Lg(BX - 0.03, 0.098, BZ(0.098) - 0.02)) - Vector(Lg(BX, 0.098, BZ(0.098))), seg=10)
        tube('switchwire%d' % s, [Lg(BX - 0.01, 0.09, BZ(0.09) - 0.02), Lg(BX - 0.03, 0.04, BZ(0.04) - 0.05), sp(0.62, s * 0.05, 0.06), sp(0.60, s * 0.03, 0.045)], 0.003, M_wire, 'front', seg=6, smooth=5)
        GRIP[s] = Lg(BX, 0.18, BZ(0.18))
        if s > 0:
            # front brake: braided line out of the master cylinder's port (it looks along the bar, towards the fork tube) and down to a splitter under the lower clamp (from there to the calipers the game draws it; stand-ins here)
            tube('brakeline', [Lg(0.0639, -0.0033, -0.0093), Lg(0.0639, -0.0232, -0.0072), Lg(0.0639, -0.0431, -0.0051), Lg(0.08, -0.07, -0.05), fp(0.60, 0.05, 0.062), fp(0.52, 0.035, 0.06), fp(0.468, 0.02, 0.05)], 0.0042, X_braid, 'front', seg=8, smooth=5)
            box('brakesplit', (0.02, 0.014, 0.036), fp(0.466, 0.0, 0.05), X_blue, 'front', rot=(0, 0, -RAKE), bevel=0.003)
            # throttle cables: two, in a wide loop forward and back to the steering head
            for k in (0, 1):
                tube('throttle%d' % k, [Lg(BX + 0.012, 0.09, BZ(0.09) + (k * 2 - 1) * 0.008), Lg(BX + 0.07, 0.045, BZ(0.045) - 0.01 + k * 0.012), Lg(BX + 0.085, -0.04, BZ(-0.04) - 0.04 + k * 0.012), sp(0.64, 0.065, 0.085), sp(0.61, 0.05, 0.05)], 0.003, M_wire, 'front', seg=6, smooth=6)
        else:
            # clutch: hydraulic line from the left master cylinder to the steering head
            tube('clutchline', [Lg(0.0639, -0.0033, -0.0093), Lg(0.0639, -0.0232, -0.0072), Lg(0.0639, -0.0431, -0.0051), Lg(0.08, -0.07, -0.05), sp(0.63, -0.07, 0.06), sp(0.60, -0.055, 0.04)], 0.0042, X_braid, 'front', seg=8, smooth=5)
    for s in (-1, 1):
        ln = sweep('brakeline_low%d' % s, [fp(0.466, s * 0.02, 0.05), fp(0.42, s * 0.07, 0.03), fp(0.3, s * (FZ - 0.012), -0.045), fp(0.2, s * (DZ + 0.03), -0.06), pol(F, 0.182, math.radians(176), s * (DZ + 0.016))], 0.0042, 0.0042, X_braid, 'fork', e=2.0, ring=8, smooth=5)
        ln['noexport'] = True
    res['bar'] = list(GRIP[1])
    # the body ends of the lines that cross the steering head: clutch line to the slave cylinder on the left of the gearbox, throttle cables to the throttle bodies
    tube('clutchline_b', [P(0.40, 0.80, -0.055), P(0.34, 0.74, -0.12), P(0.2, 0.62, -0.15 - FW), (EC[0] + 0.04, EC[1] + 0.12, -0.13 - FW * 2), (SPR[0] + 0.03, SPR[1] - 0.005, -0.118)], 0.0042, X_braid, 'body', seg=8, smooth=5)
    rod('clutchslave', (SPR[0] + 0.03, SPR[1] - 0.005, -0.106), (SPR[0] + 0.03, SPR[1] - 0.005, -0.134), [0.015, 0.015, 0.012], X_clip, 'body', seg=12)
    for k in (0, 1): tube('throttle_b%d' % k, [P(0.40, 0.81 + k * 0.01, 0.05), P(0.33, 0.76, 0.11), (EC[0] + 0.19, 0.735, 0.132), (EC[0] + 0.1, 0.71, 0.135)], 0.003, M_wire, 'body', seg=6, smooth=5)

    # ---- steering damper: across the front of the steering head, low enough that the rider looks over it at the dash
    DA, DB = sp(0.64, -0.082, 0.09), sp(0.64, 0.09, 0.09)
    rod('damper', DA, mix(DA, DB, 0.62), [0.0105, 0.012, 0.012, 0.012, 0.012, 0.0105], X_gold, 'front', seg=14); rod('dampershaft', mix(DA, DB, 0.62), DB, 0.0042, C_chrome, 'front', seg=8)
    rod('damperknob', mix(DA, DB, -0.035), DA, 0.009, X_dark, 'front', seg=10)
    for f in (0.12, 0.5): rod('damperclamp%.2f' % f, mix(DA, DB, f - 0.03), mix(DA, DB, f + 0.03), 0.0145, X_dark, 'front', seg=14)
    rod('damperstay', mix(DA, DB, 0.31), sp(0.64, -0.03, 0.05), 0.007, X_dark, 'front', seg=8); rod('dampereye', DB, mix(DA, DB, 1.03), 0.008, X_steel, 'front', seg=8)

    # ---- dash: a race display on the fairing stay (an aluminium bracket bolted to the steering head, it will carry the nose fairing too), shift lights along its top
    DC = P(0.52, 0.985); DT = math.radians(52)                         # centre of the screen, how far it leans back
    dn = (-math.sin(DT), math.cos(DT)); du = (math.cos(DT), math.sin(DT))              # screen normal (towards the rider), up along the screen
    def dp(u, v, w=0.0): return (DC[0] + du[0] * u + dn[0] * w, DC[1] + du[1] * u + dn[1] * w, v)
    plate('dash', [(-0.074, -0.04), (0.074, -0.04), (0.08, -0.028), (0.08, 0.034), (0.066, 0.046), (-0.066, 0.046), (-0.08, 0.034), (-0.08, -0.028)], 0.02, M_plastic, 'body', origin=dp(0, 0, -0.011), ex=(0, 0, 1), ey=(du[0], du[1], 0), bevel=0.004)
    plate('dashglass', [(-0.066, -0.031), (0.066, -0.031), (0.066, 0.026), (-0.066, 0.026)], 0.002, G_glass, 'body', origin=dp(0, 0, 0.0), ex=(0, 0, 1), ey=(du[0], du[1], 0), bevel=0.0006)
    for k in range(9): bolts('shiftled%d' % k, [dp(0.0365, (k - 4) * 0.0125, 0.0)], 0.0036, 0.003, G_led[0 if k < 3 else 1 if k < 6 else 2], 'body', axis=(dn[0], dn[1], 0), seg=8)
    bolts('dashbtn', [dp(-0.036, s * 0.073, -0.006) for s in (-1, 1)], 0.005, 0.01, X_dark, 'body', axis=(dn[0], dn[1], 0), seg=8)
    res['dash'] = [DC[0], DC[1], math.degrees(DT)]
    for s in (-1, 1):
        tube('stay%d' % s, [P(0.455, 0.872, s * 0.03), P(0.52, 0.875, s * 0.045), P(0.575, 0.90, s * 0.07), P(0.60, 0.94, s * 0.105)], 0.0065, X_alu, 'body', seg=10, smooth=5)
        rod('staydash%d' % s, P(0.52, 0.875, s * 0.045), dp(-0.01, s * 0.05, -0.02), 0.0055, X_alu, 'body', seg=8)
        bolts('staybolt%d' % s, [P(0.455, 0.872, s * 0.036)], 0.007, 0.01, X_steel, 'body')
    rod('staycross', P(0.575, 0.90, -0.07), P(0.575, 0.90, 0.07), 0.0055, X_alu, 'body', seg=8)
    tube('dashloom', [dp(-0.02, -0.02, -0.022), P(0.49, 0.90, -0.04), P(0.44, 0.84, -0.066), P(0.385, 0.815, -0.07)], 0.005, M_wire, 'body', seg=6, smooth=5)
    box('dashplug', (0.03, 0.014, 0.022), dp(-0.02, -0.02, -0.025), M_conn, 'body', rot=(0, 0, DT - math.pi / 2), bevel=0.002)

    # ---- rearsets: a billet plate on each upright carries a fixed peg and a heel guard; brake pedal with its master cylinder on the right,
    # gear lever with shift rod and quickshifter on the left
    PEG = P2(-0.215, 0.455); ZU = 0.173
    for s in (-1, 1):
        plate('rearset%d' % s, hull(circ(*P2(-0.152, 0.40), 0.021, 12) + circ(*P2(-0.152, 0.335), 0.018, 12) + circ(PEG[0], PEG[1], 0.024, 14)), 0.01, X_clip, 'body', off=s * (ZU + 0.006), bevel=0.003)
        bolts('rearsetb%d' % s, [P(-0.152, 0.40, s * (ZU + 0.013)), P(-0.152, 0.335, s * (ZU + 0.013))], 0.0065, 0.008, X_steel, 'body')
        rod('peg%d' % s, (PEG[0], PEG[1], s * (ZU + 0.008)), (PEG[0], PEG[1], s * (ZU + 0.098)), [0.014, 0.0115, 0.0115, 0.0115, 0.0115, 0.0115, 0.0115, 0.013], X_alu, 'body', seg=10)
        plate('heelguard%d' % s, hull(circ(PEG[0] - 0.012, PEG[1] + 0.03, 0.022, 10) + circ(PEG[0] - 0.07, PEG[1] + 0.085, 0.02, 10) + circ(PEG[0] - 0.012, PEG[1] + 0.1, 0.018, 10)), 0.004, M_carbon, 'body', off=s * (ZU + 0.016), bevel=0.001)
        tip = (PEG[0] + 0.118, PEG[1] - 0.022)
        sweep('pedal%d' % s, [(PEG[0], PEG[1] - 0.014, s * (ZU + 0.03)), (PEG[0] + 0.06, PEG[1] - 0.03, s * (ZU + 0.03)), (tip[0], tip[1], s * (ZU + 0.03))], 0.005, 0.009, X_clip, 'body', e=3.0, ring=10, smooth=4)
        rod('pedaltip%d' % s, (tip[0], tip[1], s * (ZU + 0.026)), (tip[0], tip[1], s * (ZU + 0.07)), [0.0085, 0.0085, 0.0085, 0.0095], X_alu, 'body', seg=10)
        cyl('pedalpivot%d' % s, 0.012, 0.012, (PEG[0], PEG[1] - 0.014, s * (ZU + 0.03)), X_steel, 'body', seg=10, bevel=0.002)
    m0, m1 = (PEG[0] - 0.028, PEG[1] + 0.03, ZU - 0.012 + 0.03), (PEG[0] - 0.06, PEG[1] + 0.125, ZU - 0.012 + 0.03)
    rod('rmaster', m0, m1, [0.008, 0.0115, 0.0115, 0.0115, 0.0105], X_clip, 'body', seg=12); rod('rmasterrod', (PEG[0] - 0.02, PEG[1] - 0.012, m0[2]), m0, 0.004, X_steel, 'body', seg=6)
    rv = (PEG[0] - 0.085, PEG[1] + 0.2, ZU - 0.01)
    rod('rresv', rv, (rv[0], rv[1] + 0.034, rv[2]), [0.013, 0.014, 0.014, 0.014], M_resv, 'body', seg=12); rod('rresvcap', (rv[0], rv[1] + 0.034, rv[2]), (rv[0], rv[1] + 0.042, rv[2]), 0.015, M_plastic, 'body', seg=12)
    hose('rresvhose', [(rv[0], rv[1], rv[2]), (rv[0] + 0.005, rv[1] - 0.04, rv[2] + 0.012), m1], 0.004, M_rubber, 'body')
    tube('rbrakeline_b', [m1, (m1[0] + 0.03, m1[1] + 0.012, 0.15), (PIV[0] + 0.01, PIV[1] + 0.06, 0.128), (PIV[0], PIV[1] + 0.012, 0.118)], 0.004, X_braid, 'body', seg=8, smooth=5)
    cal = pol(A, 0.095, math.radians(206), RZ + 0.012) if 'chassis' in STAGES else (A[0] - 0.085, A[1] - 0.04, WR + 0.03)
    tube('rbrakeline_s', [(PIV[0], PIV[1] + 0.012, 0.118), (PIV[0] - 0.1, 0.37, WR + 0.03), (A[0] + 0.2, 0.325, WR + 0.03), cal], 0.004, X_braid, 'swing', seg=8, smooth=5)
    # gear shift: rod from the lever to the shift shaft, quickshifter sensor in the rod
    g0, g1 = (PEG[0] + 0.035, PEG[1] - 0.034, -(ZU + 0.022)), (SPR[0] + 0.045, SPR[1] - 0.085, -0.128)
    rod('shiftrod', g0, g1, 0.0038, X_steel, 'body', seg=8); rod('quickshifter', mix(g0, g1, 0.35), mix(g0, g1, 0.62), [0.006, 0.0085, 0.0085, 0.006], X_blue, 'body', seg=10)
    rod('shiftarm', g1, (SPR[0] + 0.035, SPR[1] - 0.045, -0.128), 0.006, X_clip, 'body', seg=8); cyl('shiftshaft', 0.008, 0.03, (SPR[0] + 0.035, SPR[1] - 0.045, -0.118), X_steel, 'body', seg=8, bevel=0.001)
    tube('wire_qs', [mix(g0, g1, 0.5), (SPR[0] + 0.0, SPR[1] + 0.06, -0.13), P(-0.085, 0.57, -0.135)], 0.0028, M_wire, 'body', seg=6, smooth=4)
    res['foot'] = [PEG[0], PEG[1], ZU + 0.06]
# ================================================================== STAGE 4: bodywork - fairing with screen, tank, seat and tail, fenders, lights, livery
def proj(view, c):
    """a Blender-space point as seen in a view: 'side' (x, y) · 'top' (x, z) · 'front' (z, y)"""
    return (c.x, c.z) if view == 'side' else (c.x, -c.y) if view == 'top' else (-c.y, c.z)
def carve(bm, view, poly):
    """cut a mesh along every edge of a polygon drawn in a view, so that the polygon's outline exists as edges of the mesh"""
    for k in range(len(poly)):
        a, b = poly[k], poly[(k + 1) % len(poly)]
        if view == 'side': co = V(a[0], a[1], 0); no = V(b[1] - a[1], -(b[0] - a[0]), 0)
        elif view == 'top': co = V(a[0], 0, a[1]); no = V(b[1] - a[1], 0, -(b[0] - a[0]))
        else: co = V(0, a[1], a[0]); no = V(0, -(b[0] - a[0]), b[1] - a[1])
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=co, plane_no=no, clear_inner=False, clear_outer=False)
def shell(name, rings, th, m, asm, subsurf=2, cuts=(), closed=True, smooth=40, creases=None):
    """a moulded skin: rings of control points (closed round the bike, or open rows) smoothed, cut out, then given thickness inwards.
    cuts: [(view, polygon)] - what lies inside a polygon in that view is cut away before the skin gets its thickness, so every opening has a proper edge.
    creases: {column of the control cage: 0..1} - the smoothing keeps a hard edge along that column (the character lines of the bodywork)"""
    bm = bmesh.new(); G = [[bm.verts.new(V(*q)) for q in ring] for ring in rings]; n = len(G[0])
    for i in range(len(G) - 1):
        for k in range(n if closed else n - 1): bm.faces.new([G[i][k], G[i][(k + 1) % n], G[i + 1][(k + 1) % n], G[i + 1][k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if creases:
        cl = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        for k, c in creases.items():
            for i in range(len(G) - 1):
                e = bm.edges.get((G[i][k % n], G[i + 1][k % n]))
                if e: e[cl] = c
    def through(bm, kind, **kw):
        me = bpy.data.meshes.new(OBJPRE + 'tmp'); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(OBJPRE + 'tmp', me); scene.collection.objects.link(o); md = o.modifiers.new('m', kind)
        for k, v in kw.items(): setattr(md, k, v)
        me2 = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get())); bpy.data.objects.remove(o); bpy.data.meshes.remove(me)
        b2 = bmesh.new(); b2.from_mesh(me2); bpy.data.meshes.remove(me2); return b2
    if subsurf: bm = through(bm, 'SUBSURF', levels=subsurf, render_levels=subsurf)
    for view, poly in cuts:
        carve(bm, view, poly); bmesh.ops.delete(bm, geom=[f for f in bm.faces if inpoly(proj(view, f.calc_center_median()), poly)], context='FACES')
    if th: bm = through(bm, 'SOLIDIFY', thickness=th, offset=-1.0)          # th = 0: a closed body, no inner skin
    return obj_from_bm(bm, name, m, asm, smooth)
def region(o, name, view, poly, m, asm, pred=None, smooth=60, also=()):
    """paint a finished surface: cut it along a polygon drawn in a view and hand what lies inside (and passes pred(centre, normal), both in game space) to another material;
    m = None cuts it away"""
    gm = lambda v: (v.x, v.z, -v.y)
    bm = bmesh.new(); bm.from_mesh(o.data); both = [(view, poly)] + list(also)          # also: further (view, outline) pairs - a face must lie inside every one
    for vw, pl in both: carve(bm, vw, pl)
    bm.faces.ensure_lookup_table(); bm.normal_update()
    sel = [f for f in bm.faces if all(inpoly(proj(vw, f.calc_center_median()), pl) for vw, pl in both) and (pred is None or pred(gm(f.calc_center_median()), gm(f.normal)))]
    bm2 = bmesh.new(); vm = {}
    for f in sel:
        nf = bm2.faces.new([vm.get(v) or vm.setdefault(v, bm2.verts.new(v.co)) for v in f.verts]); nf.smooth = True
    bmesh.ops.delete(bm, geom=sel, context='FACES'); bm.to_mesh(o.data); bm.free()
    if m is None or not sel: bm2.free(); return None
    return obj_from_bm(bm2, name, m, asm, smooth)
def label(name, text, target, c, h, sd, m, asm, tilt=0.0, shear=0.26, bold=0.012, lift=0.0016, track=1.02):
    """lettering as real geometry: the word is set in Blender's own typeface, slanted and emboldened, then every point of it is dropped onto `target`
    from the side `sd` (+1 right, -1 left) and lifted a hair. c = centre in the side view, h = letter height, tilt = angle of the base line."""
    cu = bpy.data.curves.new(OBJPRE + 'txt', 'FONT'); cu.body = text; cu.size = 1.0; cu.shear = shear; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 3; cu.offset = bold; cu.space_character = track
    ob = bpy.data.objects.new(OBJPRE + 'txt', cu); scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())); bpy.data.objects.remove(ob); bpy.data.curves.remove(cu)
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me); ct, st = math.cos(tilt), math.sin(tilt); bad = []; k = h / 0.72            # 0.72: cap height of the face at size 1
    for v in bm.verts:
        u, w = v.co.x * k * sd, v.co.y * k
        ok, loc, nrm, idx = target.ray_cast(V(c[0] + u * ct - w * st * sd, c[1] + u * st * sd + w * ct, sd * 0.8), Vector((0, sd, 0)))
        if ok: v.co = loc + nrm * lift
        else: bad.append(v)
    if bad: bmesh.ops.delete(bm, geom=bad, context='VERTS')
    out = V(0, 0, sd); bm.normal_update()
    for f in bm.faces:
        if f.normal.dot(out) < 0: f.normal_flip()
    return obj_from_bm(bm, name, m, asm, 80)

if 'body' in STAGES:
    # ---- colours: the livery is this model's own (gloss, G_), the same on every rider's bike
    LIV = dict(base='f1f2f4', band='c4161c', pin='101b3d', belly='121316', fender='c4161c', tail='c4161c', text='f4f5f7', text2='101b3d') if V4 else \
          dict(base='1d52d6', band='f3f4f6', pin='0c1428', belly='0c1428', fender='1d52d6', tail='f3f4f6', text='0c1428', text2='f3f4f6')
    P_body = mat('G_sbbody_' + VARIANT, LIV['base']); G_band = mat('G_sbband_' + VARIANT, LIV['band']); G_pin = mat('G_sbpin_' + VARIANT, LIV['pin']); G_belly = mat('G_sbbelly_' + VARIANT, LIV['belly'])
    G_fender = mat('G_sbfender_' + VARIANT, LIV['fender']); G_tail = mat('G_sbtail_' + VARIANT, LIV['tail']); G_text = mat('G_sbtext_' + VARIANT, LIV['text']); G_text2 = mat('G_sbtext2_' + VARIANT, LIV['text2'])
    S_screen = mat('S_sbscreen', 'dfe7ee'); S_screen.diffuse_color = (*lin('dfe7ee'), 0.16); M_seat = mat('M_sbseat', '17181b'); M_carbon = mat('M_sbcarbon', '1b1c1f'); M_plastic = mat('M_sbplastic', '17181b'); G_lens = mat('G_sblens', 'e9f1f8'); L_tail = mat('L_sbtail', 'e0261a'); M_duct = mat('M_sbduct', '08090a')
    def PP(pts): return [P2(*q) for q in pts]            # a side- or top-view outline, moved with the wheelbase
    def pinch(ring, dx, f=0.04):                         # a ring drawn together about its middle and moved dx along the bike: closes the end of a hollow body
        c = [sum(q[k] for q in ring) / len(ring) for k in range(3)]; return [(c[0] + dx, c[1] + (q[1] - c[1]) * f, c[2] + (q[2] - c[2]) * f) for q in ring]
    G_mask = mat('G_sbmask', '0b0c0f')

    # ---- fairing: one skin from the nose to the belly, drawn as rings round the bike (keel - bilge - lower side - beltline - shoulder - roof - top, then down the other
    # side), smoothed, and then cut: the front wheel's arch, the cockpit and everything behind the rear edge, an opening in the flank. Hard edges run along the
    # shoulder (from the tip of the nose up to the screen's rear corner), the beltline and the bilge. The nose's open tip is the ram-air intake.
    # The screen is part of the same surface, so it sits flush.
    RINGS = [  # x, keel y, (z, y) of bilge, lower side, beltline, shoulder, roof, top y
        (0.825, 0.775, (0.016, 0.776), (0.034, 0.780), (0.045, 0.790), (0.040, 0.800), (0.018, 0.806), 0.808),
        (0.785, 0.740, (0.048, 0.744), (0.086, 0.758), (0.104, 0.785), (0.098, 0.823), (0.046, 0.842), 0.850),
        (0.725, 0.705, (0.080, 0.710), (0.140, 0.735), (0.165, 0.790), (0.158, 0.862), (0.072, 0.905), 0.925),
        (0.645, 0.600, (0.110, 0.612), (0.185, 0.685), (0.215, 0.790), (0.206, 0.930), (0.100, 1.000), 1.035),
        (0.555, 0.400, (0.125, 0.420), (0.205, 0.575), (0.250, 0.770), (0.236, 1.000), (0.120, 1.090), 1.138),
        (0.460, 0.190, (0.118, 0.205), (0.200, 0.410), (0.258, 0.700), (0.246, 1.000), (0.130, 1.105), 1.165),
        (0.360, 0.145, (0.105, 0.160), (0.190, 0.360), (0.246, 0.640), (0.252, 0.860), (0.140, 1.020), 1.100),
        (0.220, 0.135, (0.100, 0.150), (0.182, 0.340), (0.232, 0.600), (0.225, 0.800), (0.160, 0.930), 1.000),
        (0.050, 0.135, (0.100, 0.150), (0.175, 0.330), (0.215, 0.530), (0.205, 0.740), (0.150, 0.860), 0.930),
        (-0.050, 0.145, (0.092, 0.158), (0.160, 0.310), (0.200, 0.500), (0.190, 0.680), (0.140, 0.800), 0.860),
        (-0.130, 0.160, (0.085, 0.170), (0.140, 0.295), (0.170, 0.450), (0.160, 0.600), (0.110, 0.720), 0.780)]
    rings = []
    for (x, ky, *mid, ty) in RINGS:
        rings.append([P(x, ky, 0.0)] + [P(x, y, z) for (z, y) in mid] + [P(x, ty, 0.0)] + [P(x, y, -z) for (z, y) in reversed(mid)])
    ARCH = PP([(0.395, 0.0), (0.395, 0.15), (0.408, 0.26), (0.425, 0.36), (0.45, 0.48), (0.50, 0.60), (0.62, 0.70), (0.76, 0.73), (1.0, 0.78), (1.0, 0.0)])
    # behind the screen's upright rear edge, in front of the grips, along the top of the flank and down its rear edge, which is cut in two points
    BACK = PP([(0.50, 1.4), (0.50, 0.85), (0.465, 0.80), (0.27, 0.80), (0.165, 0.715), (0.105, 0.60), (0.20, 0.555), (0.03, 0.50), (-0.01, 0.40), (0.065, 0.365), (-0.05, 0.28), (-0.30, 0.26), (-0.30, 1.4)])
    OPEN = PP([(0.36, 0.69), (0.20, 0.535), (0.325, 0.515)])                # a three-cornered opening behind the radiator: hot air out, the engine shows
    HAND = PP([(0.49, 0.83), (0.622, 0.836), (0.603, 0.928), (0.49, 0.948)])  # cut-outs in the cowl's flanks where grips and levers swing forward on full lock
    fair = shell('fairing', rings, 0.004, P_body, 'body', subsurf=3, cuts=[('side', ARCH), ('side', BACK), ('side', OPEN), ('side', HAND)], smooth=32, creases={4: 1.0, 8: 1.0, 3: 0.45, 9: 0.45, 1: 0.9, 11: 0.9})
    # the screen: clear, and only the upper half of the front - the cowl itself climbs steeply from the nose to the screen's rear corners
    region(fair, 'screen', 'side', PP([(0.80, 0.91), (0.49, 1.035), (0.49, 1.4), (0.80, 1.4)]), S_screen, 'body')
    # headlights: a slim lens each side of the intake, in a dark mask under the nose's edge
    for s in (-1, 1): region(fair, 'lens%d' % s, 'front', [(s * 0.05, 0.772), (s * 0.135, 0.795), (s * 0.142, 0.812), (s * 0.056, 0.789)][::s], G_lens, 'body', pred=lambda c, n: c[0] > gx(0.70))
    region(fair, 'f_mask', 'side', PP([(0.835, 0.788), (0.785, 0.814), (0.725, 0.852), (0.665, 0.884), (0.635, 0.80), (0.71, 0.748), (0.835, 0.762)]), G_mask, 'body')
    # the intake's duct: dark, from the mouth back into the steering head
    loft('intake', [dict(x=gx(0.81), y=0.79, w=0.04, ht=0.014, hb=0.014, e=3.0), dict(x=gx(0.70), y=0.80, w=0.05, ht=0.025, hb=0.025, e=3.0), dict(x=gx(0.52), y=0.83, w=0.05, ht=0.03, hb=0.03, e=3.0)], M_duct, 'body', ring=14, capA=False)
    # inner panels: close the cockpit between fairing and frame
    for s in (-1, 1):
        panel('inner%d' % s, [[P(0.50, 0.795, s * 0.262), P(0.50, 0.805, s * 0.20), P(0.495, 0.81, s * 0.16)], [P(0.38, 0.795, s * 0.256), P(0.38, 0.802, s * 0.2), P(0.38, 0.806, s * 0.165)], [P(0.27, 0.795, s * 0.235), P(0.27, 0.80, s * 0.2), P(0.27, 0.802, s * 0.172)]], 0.003, M_plastic, 'body', subsurf=1)

    # ---- livery on the fairing: a band from the nose down to the belly's rear, a pinstripe along its top, everything under it dark
    A1, A2 = (0.83, 0.80), (-0.231, 0.159); dl = math.hypot(A1[0] - A2[0], A1[1] - A2[1]); dn = ((A1[1] - A2[1]) / dl, -(A1[0] - A2[0]) / dl)        # dn: square to the band, downwards
    def off(q, d): return (q[0] + dn[0] * d, q[1] + dn[1] * d)
    BW = 0.105
    region(fair, 'f_belly', 'side', PP([off(A1, BW), off(A2, BW), (-0.3, 0.0), (1.0, 0.0), (1.0, 0.75)]), G_belly, 'body')
    bandF = region(fair, 'f_band', 'side', PP([A1, A2, off(A2, BW), off(A1, BW)]), G_band, 'body')
    region(fair, 'f_pin', 'side', PP([off(A1, -0.022), off(A2, -0.022), off(A2, -0.006), off(A1, -0.006)]), G_pin, 'body')
    tl = math.atan2(A1[1] - A2[1], A1[0] - A2[0])
    for s in (-1, 1):
        label('ad_apex%d' % s, 'APEX', bandF, P2(*off((0.245, A2[1] + (0.245 - A2[0]) * math.tan(tl)), BW * 0.5)), 0.058, s, G_text, 'body', tilt=tl * s)

    # ---- winglets (the superbike only): a carbon blade on each side of the nose
    if V4:
        for s in (-1, 1):
            sweep('wing%d' % s, [P(0.645, 0.75, s * 0.178), P(0.638, 0.742, s * 0.232), P(0.622, 0.728, s * 0.282)], [0.05, 0.042, 0.022], [0.0045, 0.004, 0.003], M_carbon, 'body', e=2.2, ring=12)

    # ---- tank cover, over the airbox and the spars: flat on top with a hard edge down each side, waisted where the knees go; a dry-break filler on top
    TANK = [  # x, bottom y, (z, y) of lower edge, widest, top edge, top shoulder, top y
        (0.360, 0.810, (0.070, 0.820), (0.092, 0.870), (0.086, 0.915), (0.050, 0.935), 0.940),
        (0.290, 0.790, (0.140, 0.800), (0.170, 0.870), (0.155, 0.935), (0.090, 0.960), 0.968),
        (0.160, 0.770, (0.170, 0.775), (0.205, 0.860), (0.185, 0.940), (0.110, 0.975), 0.985),
        (0.030, 0.760, (0.160, 0.765), (0.195, 0.840), (0.170, 0.915), (0.100, 0.950), 0.960),
        (-0.070, 0.750, (0.120, 0.755), (0.135, 0.820), (0.125, 0.875), (0.080, 0.900), 0.908),
        (-0.140, 0.750, (0.100, 0.755), (0.108, 0.800), (0.100, 0.840), (0.065, 0.858), 0.862),
        (-0.175, 0.760, (0.080, 0.765), (0.085, 0.795), (0.078, 0.820), (0.050, 0.830), 0.832)]
    tr = [[P(x, yb, 0.0)] + [P(x, y, z) for (z, y) in mid] + [P(x, yt, 0.0)] + [P(x, y, -z) for (z, y) in reversed(mid)] for (x, yb, *mid, yt) in TANK]
    tank = shell('tank', [pinch(tr[0], 0.012)] + tr + [pinch(tr[-1], -0.012)], 0.0, P_body, 'body', subsurf=3, smooth=32, creases={3: 1.0, 7: 1.0, 1: 0.6, 9: 0.6})
    rod('filler', P(0.17, 0.974, 0.0), P(0.17, 0.984, 0.0), [0.034, 0.034, 0.03], X_dark, 'body', seg=24); rod('fillercap', P(0.17, 0.984, 0.0), P(0.17, 0.989, 0.0), [0.024, 0.022], X_red, 'body', seg=20)
    region(tank, 't_stripe', 'top', PP([(0.40, -0.032), (0.40, 0.032), (-0.3, 0.032), (-0.3, -0.032)]), G_band, 'body', pred=lambda c, n: n[1] > 0.3)

    # ---- seat and tail: a long, sharp, upswept tail unit over the subframe (and, on the V4, the upper megaphone), hard-edged along its flanks;
    # a race seat pad and a stop pad on the hump
    TAIL = [  # x, bottom y, (z, y) of lower edge, upper edge, top shoulder, top y
        (-0.085, 0.720, (0.115, 0.735), (0.125, 0.800), (0.090, 0.825), 0.830),
        (-0.200, 0.715, (0.120, 0.730), (0.132, 0.790), (0.100, 0.805), 0.808),
        (-0.330, 0.750, (0.115, 0.765), (0.138, 0.825), (0.105, 0.840), 0.842),
        (-0.430, 0.790, (0.100, 0.800), (0.135, 0.875), (0.100, 0.925), 0.935),
        (-0.560, 0.840, (0.075, 0.850), (0.105, 0.905), (0.070, 0.945), 0.955),
        (-0.680, 0.868, (0.045, 0.880), (0.070, 0.930), (0.045, 0.962), 0.970),
        (-0.780, 0.935, (0.016, 0.940), (0.026, 0.958), (0.016, 0.976), 0.980)]
    TUP = lambda x: max(0.0, -0.36 - x) * math.tan(math.radians(5.0))          # behind the seat the tail points 5 degrees further up
    lr = [[P(x, yb + TUP(x), 0.0)] + [P(x, y + TUP(x), z) for (z, y) in mid] + [P(x, yt + TUP(x), 0.0)] + [P(x, y + TUP(x), -z) for (z, y) in reversed(mid)] for (x, yb, *mid, yt) in TAIL]
    tail = shell('tail', [pinch(lr[0], 0.012)] + lr + [pinch(lr[-1], -0.035, 0.02)], 0.0, P_body, 'body', subsurf=3, smooth=32, creases={1: 0.8, 7: 0.8, 2: 1.0, 6: 1.0})
    loft('seat', [dict(x=gx(-0.10), y=0.838, w=0.085, ht=0.014, hb=0.02, e=3.0), dict(x=gx(-0.2), y=0.818, w=0.108, ht=0.016, hb=0.016, e=3.0), dict(x=gx(-0.3), y=0.84, w=0.112, ht=0.016, hb=0.016, e=3.0),
                  dict(x=gx(-0.365), y=0.87, w=0.104, ht=0.014, hb=0.016, e=3.0)], M_seat, 'body', ring=18, subsurf=1)
    loft('seatstop', [dict(x=gx(-0.368), y=0.884, w=0.086, ht=0.016, hb=0.016, e=3.0), dict(x=gx(-0.40), y=0.921, w=0.082, ht=0.014, hb=0.02, e=3.0), dict(x=gx(-0.432), y=0.95, w=0.06, ht=0.006, hb=0.012, e=3.0)], M_seat, 'body', ring=14, subsurf=1)
    box('taillight', (0.03, 0.012, 0.07), P(-0.728, 0.9 + TUP(-0.728), 0.0), L_tail, 'body', rot=(0, 0, -0.59), bevel=0.003)          # a slim LED bar under the tip of the tail
    tb = region(tail, 'tail_band', 'side', PP([(-0.47, 0.70), (-0.40, 1.1), (-0.9, 1.1), (-0.9, 0.70)]), G_tail, 'body')
    region(tail, 'tail_pin', 'side', PP([(-0.44, 0.70), (-0.37, 1.1), (-0.385, 1.1), (-0.455, 0.70)]), G_pin, 'body')
    region(tail, 'tail_under', 'side', PP([(-0.05, 0.60), (-0.05, 0.742), (-0.33, 0.772), (-0.45, 0.805), (-0.45, 0.60)]), G_belly, 'body')
    for s in (-1, 1): label('ad_name%d' % s, 'STRADA V4' if V4 else 'CORSA 600', tb, P2(-0.575, 0.898 + TUP(-0.575)), 0.02, s, G_text, 'body', tilt=-0.29 * s)

    # ---- front fender: hugs the tyre from just ahead of its top back down behind the fork, carried by the fork's axle lugs (it moves with the wheel)
    FR = lambda a, t: RF + 0.02 - 0.05 * t * t - 0.012 * max(0.0, (a - 2.3) / 0.4) ** 2
    fen = [[pol(F, FR(a, t), a, t * 0.071) for t in (-1.0, -0.72, -0.36, 0.0, 0.36, 0.72, 1.0)] for a in [math.radians(70 + k * 11.0) for k in range(9)]]
    fender = shell('fender', fen, 0.003, G_fender, 'fork', subsurf=2, closed=False)
    for s in (-1, 1):
        plate('fenderstay%d' % s, hull(circ(*pol(F, 0.268, math.radians(97))[:2], 0.02, 10) + circ(*pol(F, 0.268, math.radians(131))[:2], 0.02, 10) + circ(*fp(0.055)[:2], 0.02, 10) + circ(*fp(0.092)[:2], 0.016, 10)), 0.004, M_carbon, 'fork', off=s * 0.0745, bevel=0.001)
        bolts('fenderbolt%d' % s, [fp(0.055, s * 0.078), fp(0.092, s * 0.078)], 0.005, 0.006, X_steel, 'fork')
    # ---- rear hugger: carbon, short, on the swingarm, over the front of the tyre
    HR = lambda t: RR + 0.014 - 0.05 * t * t
    hug = [[pol(A, HR(t), a, t * (WR + 0.012)) for t in (-1.0, -0.7, -0.35, 0.0, 0.35, 0.7, 1.0)] for a in [math.radians(30 + k * 5.5) for k in range(7)]]
    shell('hugger', hug, 0.003, M_carbon, 'swing', subsurf=2, closed=False)
    for s in (-1, 1): rod('huggerstay%d' % s, pol(A, RR + 0.0, math.radians(40), s * (WR + 0.012)), (A[0] + 0.3, 0.405, s * (WR + 0.04)), 0.005, M_carbon, 'swing', seg=6)
    res['tail'] = [gx(-0.815), 0.96 + TUP(-0.815)]; res['screen'] = [gx(0.50), 1.13]
if SHOTS:
    cam = bpy.data.objects.new(OBJPRE + 'cam', bpy.data.cameras.new(OBJPRE + 'cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.clip_end = 200
    scene.render.engine = 'BLENDER_WORKBENCH'; sh = scene.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.show_shadows = False
    sh.show_object_outline = True; sh.object_outline_color = (0.05, 0.05, 0.06); sh.show_specular_highlight = True; sh.show_backface_culling = True
    try: scene.display.render_aa = '16'
    except Exception: pass
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.get('smPrev') or bpy.data.worlds.new('smPrev'); scene.world.color = lin('d9dade')
    scene.render.resolution_x, scene.render.resolution_y = globals().get('RES', (1800, 1100)); scene.render.image_settings.file_format = 'PNG'
    C = V(0, 0.54, 0)
    DIRS = {'side': ((0, 0.0, 1), 0), 'sideL': ((0, 0.0, -1), 0), 'front': ((1, 0.03, 0), 0), 'rear': ((-1, 0.05, 0), 0), 'top': ((0.001, 1, 0), 0),
            'q1': ((0.8, 0.32, 1), 1), 'q2': ((0.8, 0.32, -1), 1), 'low': ((0.5, -0.12, 1), 1), 'q3': ((-0.85, 0.36, 1), 1), 'q4': ((-0.85, 0.36, -1), 1)}
    CLOSE = {'head': ((1.35, 1.3, 0.85), (0.4, 0.8, 0.0), 75), 'pivot': ((-0.5, 0.75, -1.5), (-0.2, 0.45, 0.0), 80), 'pivotR': ((-0.5, 0.75, 1.5), (-0.2, 0.45, 0.0), 80),
             'wheelF': ((1.75, 0.6, -1.0), (0.71, 0.32, 0.0), 85), 'wheelR': ((-1.8, 0.65, -1.0), (-0.7, 0.33, 0.0), 85), 'wheelRR': ((-1.8, 0.65, 1.0), (-0.7, 0.33, 0.0), 85), 'link': ((-0.9, 0.12, -1.0), (-0.22, 0.36, 0.0), 80),
             'bay': ((0.75, 0.7, 1.55), (0.08, 0.5, 0.0), 75), 'bayL': ((0.75, 0.7, -1.55), (0.08, 0.5, 0.0), 75), 'bayT': ((0.35, 1.9, 0.75), (0.05, 0.6, 0.0), 70), 'front34': ((1.6, 0.9, 0.9), (0.2, 0.6, 0.0), 60),
             'bars': ((1.3, 1.4, 0.75), (0.38, 0.92, 0.0), 75), 'cock': ((-0.45, 1.45, 0.22), (0.4, 0.9, 0.0), 50), 'pegR': ((-0.25, 0.62, 1.3), (-0.15, 0.42, 0.0), 80), 'pegL': ((-0.25, 0.62, -1.3), (-0.15, 0.42, 0.0), 80),
             'tail': ((-1.7, 1.2, 0.9), (-0.45, 0.75, 0.0), 75), 'nose': ((1.9, 0.95, 0.55), (0.55, 0.75, 0.0), 75)}
    CLOSE.update(globals().get('VIEWS', {}))                # more close-ups from outside: name -> (eye, target, lens), game space
    for v in SHOTS:
        d, persp = DIRS.get(v, ((1, 0.3, 1), 1)); dv = V(*d).normalized(); ortho = not persp
        cam.data.type = 'ORTHO' if ortho else 'PERSP'; cam.data.ortho_scale = 2.35; cam.data.lens = 200
        cam.location = C + dv * (20 if ortho else 15.5)
        cam.rotation_euler = (C - cam.location).to_track_quat('-Z', 'Y').to_euler()
        if v == 'top': cam.location = C + Vector((0, 0, 20)); cam.rotation_euler = (0, 0, 0)
        if v in ('front', 'rear'): cam.data.ortho_scale = 1.5
        if v in CLOSE: eye, tgt, lens = CLOSE[v]; cam.data.type = 'PERSP'; cam.data.lens = lens; cam.location = V(*eye); cam.rotation_euler = (V(*tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = OUT + 'renders/' + PREFIX + '_' + v + '.png'; bpy.ops.render.render(write_still=True, scene=scene.name)
    bpy.data.objects.remove(cam)
# ------------------------------------------------------------------ what the game's rig has to know about this model (js/models.js, SPRUNG)
if all(k in STAGES for k in ('chassis', 'engine', 'controls', 'body')):
    r4 = lambda v: [round(float(x), 4) for x in v]
    clen = 2 * Lc + math.pi * (SPR_R + SPW_R) + (SPW_R - SPR_R) ** 2 / Lc; dsc = RD / DISC['r_out']
    def exit_(a, b, tip):            # a megaphone's mouth, the way it points, the radius of the glow inside it, and where that glow sits (a little way up the bore)
        d = Vector(b) - Vector(a); L = d.length; d.normalize(); end = Vector(b) + d * (tip * L)
        return dict(end=r4(end), dir=r4(d), glow=r4(end - d * 0.032))
    low = exit_(MEG0, MEG1, 0.16); up = exit_(U0, U1, 0.14) if V4 else None; main = up or low
    res['sprung'] = dict(
        wb=WB, Rr=RR, Rf=RF, rake=24, head=r4(sp(0.61)[:2]), PIV=r4(PIV), S0=r4(S0[:2]), S1=r4(S1[:2]), SPR=r4(SPR), chain=[SPR_R, SPW_R, round(CHZ, 4), int(round(clen / 0.01634 / 2)) * 2],
        hose=[r4(q) for q in (fp(0.466, 0.02, 0.05), fp(0.42, 0.07, 0.03), fp(0.3, FZ - 0.012, -0.045), fp(0.2, DZ + 0.03, -0.06), pol(F, 0.182, math.radians(176), DZ + 0.016))], hoseSides=[-1, 1],
        forkMax=0.12, link=0.4, linkage=dict(F0=r4(LF), R0=r4(RK0), R2=r4(RK2)), tyre=dict(ar=round((RR - RIM) / 2, 4), br=WR, af=round((RF - RIM) / 2, 4), bf=WF),
        ex=[main['end'], main['dir'], 0.031], ex2=[low['end'], low['dir'], 0.033] if up else None,
        heat=dict(f=[0.119, 0.154, DZ], r=[round(0.119 * dsc, 4), round(0.154 * dsc, 4), round(RZ, 4)], glow=[[main['glow'], main['dir'], 0.03]] + ([[low['glow'], low['dir'], 0.031]] if up else [])),
        bar=r4(res['bar']), foot=r4(res['foot']), dash=r4(res['dash']), tail=r4(res['tail']), screen=r4(res['screen']), side=[round(gx(-0.44), 4), round(0.845 + TUP(-0.44), 4), 0.125, 0.07, -0.43])
    import json
    open(OUT + 'renders/sport_%s_export.json' % VARIANT, 'w').write(json.dumps(res['sprung'], indent=1))
# ------------------------------------------------------------------ bake AO into vertex colours and export the game assemblies
if EXPORT:
    # the hand levers are assemblies of their own (leverR: front brake, leverL: clutch): the game swings them about their pivot bolts (js/models.js, SPRUNG.leverPiv)
    for o in [o for o in ASM['front'] if o.name.endswith('_lever')]:
        a2 = 'leverL' if o.name.endswith('-1_lever') else 'leverR'; ASM['front'].remove(o); ASM.setdefault(a2, []).append(o); o['asm'] = a2
    EXP = {'strada': 'stradav4', 'corsa': 'corsa600'}[VARIANT]
    for k in ASM: ASM[k] = [o for o in ASM[k] if not o.get('noexport')]
    for o in [o for o in scene.objects if o.get('noexport')]: o.hide_render = True
    allobj = [o for k, L in ASM.items() for o in L]
    for o in allobj:
        me = o.data
        for a in list(me.color_attributes): me.color_attributes.remove(a)
        ca = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER'); me.color_attributes.active_color = ca
        for p in ca.data: p.color = (1, 1, 1, 1)
    gme = bpy.data.meshes.new(OBJPRE + 'ground'); gme.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    gnd = bpy.data.objects.new(OBJPRE + 'ground', gme); scene.collection.objects.link(gnd)
    scene.render.engine = 'CYCLES'
    try: scene.cycles.device = 'GPU'
    except Exception: pass
    scene.cycles.samples = 48
    if not scene.world: scene.world = bpy.data.worlds.new(OBJPRE + 'W')
    scene.world.light_settings.distance = 0.22
    scene.render.bake.target = 'VERTEX_COLORS'
    vl = bpy.context.view_layer
    for o in scene.objects: o.select_set(False)
    for o in allobj: o.select_set(True)
    vl.objects.active = allobj[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    for o in allobj:
        m = o.data.materials[0]; base = (1, 1, 1) if m.name.startswith('P_') or m.name.startswith('L_') else m['apex_col']
        flat = o.name.startswith(OBJPRE + 'ad_') or m.name.startswith('S_'); ca = o.data.color_attributes['Col']      # lettering lies flat on its panel, the screen is clear: neither takes shade
        for lp in o.data.loops:
            p = ca.data[lp.index]; a = 1.0 if flat else 0.35 + 0.65 * p.color[0]
            p.color = (base[0] * a, base[1] * a, base[2] * a, 1)
    bpy.data.objects.remove(gnd); sizes = {}
    for asm, L in ASM.items():
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
        fn = OUT + 'bike_%s_%s.glb' % (EXP, asm)
        bpy.ops.export_scene.gltf(filepath=fn, export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True,
                                  export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_texcoords=False, export_materials='EXPORT')
        for o in L: o.location = (0, 0, 0)
        import os
        sizes[asm] = [os.path.getsize(fn), sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in L)]
    res['exported'] = sizes
res['objects'] = len(scene.objects); res['tris'] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == 'MESH')
result = res
