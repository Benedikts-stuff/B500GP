"""APEX supermoto (working title MOTARD 450) - a 450 cc single-cylinder supermoto of our own design, built frame-first in stages
like the Duetto, so that every step can be checked on its own. No real make's bodywork, colours or lettering are copied.

  STAGES   list of stages to build: 'chassis' (frame, subframe, swingarm with linkage, shock, fork, wire wheels, brakes)
           -> 'engine' (engine, cooling, exhaust, final drive) -> 'body' (tank, airbox, seat, plastics) -> 'controls'   ('controls' is still to come)
  SHOTS    list of preview views to render into blender/renders/<PREFIX>_<view>.png
  EXPORT   not yet: the game assemblies are exported once the bike is complete

Assemblies (the same set the game already animates on the Duetto): body (frame, subframe) · swing (swingarm, linkage, pivots at PIV)
  front (steered: clamps, outer fork tubes) · fork (steered + slides along the fork: stanchions, axle lugs, caliper, axle)
  wheelF / wheelR · shockU (damper body, turns about its top eye S0) · shockL (shaft, lower collar) · spring
Coordinates and material prefixes: see tools/blender_kit.py."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

OUT = '/Users/benedikt/Desktop/Apex/blender/'
STAGES = globals().get('STAGES', ['chassis']); SHOTS = globals().get('SHOTS', []); EXPORT = globals().get('EXPORT', False); PREFIX = globals().get('PREFIX', 'sm')
SCENE, OBJPRE = 'Supermoto', 'sm_'
KIT = globals().get('KIT', '/Users/benedikt/Desktop/Apex/tools/blender_kit.py')
exec(compile(open(KIT).read(), KIT, 'exec'), globals())

# ------------------------------------------------------------------ geometry (metres): a long, tall, narrow bike on 17-inch wheels
WB = 1.47; HX = WB / 2                       # wheelbase
RF, RR = 0.300, 0.315                        # tyre radii (125/75-16.5 and 165/55-17 slicks)
WF, WR = 0.0625, 0.0825                      # tyre half widths
RIMF, RIMR = 0.2095, 0.2160                  # bead seat radii (16.5 and 17 inch)
RAKE = math.radians(26.5); OFFSET = 0.020    # steering head angle, fork offset
F = (HX, RF); A = (-HX, RR)                  # axles
U = (-math.sin(RAKE), math.cos(RAKE))        # up along the fork
N = (math.cos(RAKE), math.sin(RAKE))         # forward, square to the fork
FZ = 0.098                                   # fork tubes: half spacing
PIV = (-0.145, 0.445)                        # swingarm pivot
S0, S1 = (-0.05, 0.795, 0.0), (-0.165, 0.375, 0.0)      # shock: top eye on the frame, bottom eye on the linkage rocker
def fp(s, z=0.0): return (F[0] + U[0] * s, F[1] + U[1] * s, z)                                    # point on the fork tube line, s metres above the axle
def sp(s, z=0.0): return (F[0] - N[0] * OFFSET + U[0] * s, F[1] - N[1] * OFFSET + U[1] * s, z)    # same on the steering axis
def pol(c, r, a, z=0.0): return (c[0] + r * math.cos(a), c[1] + r * math.sin(a), z)
def side(q, s): return (q[0], q[1], q[2] * s)

# ------------------------------------------------------------------ materials (names of their own where the colour is this bike's)
FRAME = mat('G_smframe', '15161a'); X_alu = mat('X_alu', 'b9bdc2'); X_steel = mat('X_steel', 'd6d8db'); X_cast = mat('X_cast', '7d8188'); X_dark = mat('X_smdark', '2a2c31')
X_swing = mat('X_smswing', 'c3c6ca'); C_chrome = mat('C_chrome', 'e4e7ea'); M_dark = mat('M_dark', '1c1e22'); M_tyre = mat('M_tyre', '1a1a1c'); M_tyre.diffuse_color = (0.006, 0.006, 0.007, 1); M_disc = mat('M_disc', 'a9adb2')
G_rim = mat('G_smrim', '1b1d22'); M_hub = mat('X_smhub', 'b8161b'); X_gold = mat('X_smgold', 'c99b32'); X_spoke = mat('X_smspoke', 'c9ccd0'); M_cal = mat('M_smcaliper', '25272b'); M_spring = mat('M_smspring', 'e9eaec')
X_shock = mat('X_smshock', '8e9299'); X_sprocket = mat('X_smsprocket', '3b3e44'); X_chain = mat('X_chain', '55585e')

def label(name, text, target, c, h, sd, m, asm, tilt=0.0, shear=0.26, bold=0.012, lift=0.0016, track=1.02):
    """sponsor lettering as real geometry: the word is set in Blender's own typeface, slanted and emboldened, then every point of it is dropped
    onto `target` from the side `sd` (+1 right, -1 left) and lifted a hair. c = centre in the side view, h = letter height, tilt = angle of the base line."""
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

def tight(G, f=0.16):
    """repeat a control grid's outer rows and columns a little way in: after smoothing, the panel's edges and corners stay crisp instead of going round"""
    def mix(a, b, t): return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))
    G = [[row[0], mix(row[0], row[1], f)] + list(row[1:-1]) + [mix(row[-1], row[-2], f), row[-1]] for row in G]
    return [G[0], [mix(a, b, f) for a, b in zip(G[0], G[1])]] + G[1:-1] + [[mix(a, b, f) for a, b in zip(G[-1], G[-2])], G[-1]]

def coons(top, bot, left, right, bulge=0.0):
    """control grid of a panel from its four edges (top and bot run the same way, left and right too; they share the corners), bellied outwards by `bulge`"""
    n, m = len(top), len(left); G = []
    for i in range(m):
        v = i / (m - 1); row = []
        for k in range(n):
            u = k / (n - 1)
            q = [(1 - v) * top[k][c] + v * bot[k][c] + (1 - u) * left[i][c] + u * right[i][c]
                 - ((1 - u) * (1 - v) * top[0][c] + u * (1 - v) * top[-1][c] + (1 - u) * v * bot[0][c] + u * v * bot[-1][c]) for c in range(3)]
            q[2] += bulge * math.sin(math.pi * u) * math.sin(math.pi * v); row.append(tuple(q))
        G.append(row)
    return G

def many(name, m, asm, build, smooth=50):
    """several small parts in one object: build(bm) adds them to a fresh mesh"""
    bm = bmesh.new(); build(bm); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return obj_from_bm(bm, name, m, asm, smooth)
def bm_tube(bm, a, b, r, seg=6, caps=True):
    A_, B_ = V(*a), V(*b); t = (B_ - A_).normalized(); up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)); e1 = t.cross(up).normalized(); e2 = t.cross(e1); rings = []
    for (c, rr) in ((A_, r[0] if isinstance(r, (list, tuple)) else r), (B_, r[1] if isinstance(r, (list, tuple)) else r)):
        rings.append([bm.verts.new(c + (e1 * math.cos(k / seg * 6.2832) + e2 * math.sin(k / seg * 6.2832)) * rr) for k in range(seg)])
    for k in range(seg): bm.faces.new([rings[0][k], rings[0][(k + 1) % seg], rings[1][(k + 1) % seg], rings[1][k]])
    if caps: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[1])

# ================================================================== STAGE 1: rolling chassis
if 'chassis' in STAGES:
    # ---- steering head
    rod('headtube', sp(0.64), sp(0.835), 0.031, FRAME, 'body', seg=24)
    for s0, s1 in ((0.628, 0.642), (0.833, 0.847)): rod('headcup%.2f' % s0, sp(s0), sp(s1), 0.035, X_steel, 'body', seg=24)

    # ---- main frame: chrome-moly steel, gloss black. Two oval spars run back from the head, spread round where the cylinder head will sit and drop
    # behind the engine to the swingarm pivot. One down tube leaves the head, runs down in front of the engine and splits into two cradle rails under it.
    SPAR = [(0.335, 0.992, 0.022), (0.20, 0.932, 0.074), (0.06, 0.868, 0.10), (-0.05, 0.795, 0.102), (-0.118, 0.69, 0.096), (-0.142, 0.56, 0.092), (-0.146, 0.468, 0.092)]
    for s in (-1, 1):
        sweep('spar%d' % s, [side(q, s) for q in SPAR], 0.0145, [0.024, 0.023, 0.022, 0.021, 0.02, 0.02, 0.02], FRAME, 'body', e=2.6, ring=16, smooth=6, sa=60)
    DT = [(0.394, 0.873, 0.0), (0.366, 0.72, 0.0), (0.338, 0.57, 0.0), (0.322, 0.485, 0.0)]
    tube('downtube', DT, [0.0215, 0.0215, 0.021, 0.02], FRAME, 'body', seg=18, smooth=5)
    CR = [(0.322, 0.487, 0.016), (0.305, 0.385, 0.066), (0.225, 0.296, 0.097), (0.03, 0.272, 0.105), (-0.085, 0.298, 0.105), (-0.135, 0.365, 0.098), (-0.146, 0.43, 0.092)]
    for s in (-1, 1): tube('cradle%d' % s, [side(q, s) for q in CR], 0.0145, FRAME, 'body', seg=14, smooth=6)
    # the junction where the down tube becomes the two rails: a small forged yoke
    plate('dt_yoke', hull(circ(0.322, 0.49, 0.026, 12) + circ(0.31, 0.415, 0.02, 12)), 0.085, FRAME, 'body', bevel=0.01)
    # head gussets: a web each side between spar and down tube, lightened
    GUS = [(0.402, 0.905), (0.352, 1.0), (0.235, 0.948), (0.215, 0.925), (0.355, 0.735), (0.385, 0.745)]
    for s in (-1, 1): cutplate('gusset%d' % s, GUS, [circ(0.335, 0.905, 0.034, 20), circ(0.298, 0.845, 0.017, 14)], 0.004, FRAME, 'body', off=s * 0.02)
    # pivot plates: forged, the spars and the cradle rails run into them; the pivot axle passes through
    for s in (-1, 1):
        cutplate('pivplate%d' % s, hull(circ(PIV[0], PIV[1], 0.04) + circ(-0.142, 0.565, 0.024) + circ(-0.132, 0.362, 0.022) + circ(-0.19, 0.50, 0.02)), [circ(-0.172, 0.515, 0.012, 12)],
                 0.012, FRAME, 'body', off=s * 0.092)
        cyl('pivbossF%d' % s, 0.027, 0.02, (PIV[0], PIV[1], s * 0.092), FRAME, 'body', seg=20, bevel=0.003)
    cyl('pivaxle', 0.0105, 0.34, (PIV[0], PIV[1], 0), X_steel, 'body', seg=12, bevel=0)
    for s in (-1, 1): cyl('pivnut%d' % s, 0.017, 0.012, (PIV[0], PIV[1], s * 0.166), X_steel, 'body', seg=6, bevel=0.002)
    # cross members: the shock hangs from the upper one, the linkage pulls on the lower one
    rod('xshock', (S0[0], S0[1], -0.102), (S0[0], S0[1], 0.102), 0.015, FRAME, 'body', seg=14)
    rod('xlower', (-0.085, 0.298, -0.105), (-0.085, 0.298, 0.105), 0.0135, FRAME, 'body', seg=12)
    rod('xcradle', (0.225, 0.296, -0.097), (0.225, 0.296, 0.097), 0.011, FRAME, 'body', seg=10)
    for s in (-1, 1):
        plate('shk_lugT%d' % s, hull(circ(S0[0], S0[1], 0.02, 14) + circ(S0[0] - 0.012, S0[1] - 0.032, 0.014, 12)), 0.006, FRAME, 'body', off=s * 0.021, bevel=0.0015)
        plate('link_lugF%d' % s, hull(circ(-0.085, 0.298, 0.018, 12) + circ(-0.108, 0.292, 0.013, 12)), 0.006, FRAME, 'body', off=s * 0.034, bevel=0.0015)

    # ---- subframe: bolted on behind the spars, carries seat, tail and silencer
    for s in (-1, 1):
        tube('sub_top%d' % s, [(-0.03, 0.805, s * 0.10), (-0.25, 0.832, s * 0.10), (-0.50, 0.857, s * 0.086), (-0.705, 0.872, s * 0.06)], 0.0115, FRAME, 'body', seg=12, smooth=5)
        tube('sub_strut%d' % s, [(-0.142, 0.59, s * 0.097), (-0.33, 0.72, s * 0.10), (-0.50, 0.855, s * 0.086)], 0.0115, FRAME, 'body', seg=12, smooth=5)
        for (bx, by) in ((-0.03, 0.805), (-0.142, 0.59)): cyl('sub_bolt%d_%.2f' % (s, by), 0.0105, 0.01, (bx, by, s * 0.113), X_steel, 'body', seg=6, bevel=0.002)
    tube('sub_loop', [(-0.705, 0.872, -0.06), (-0.738, 0.874, -0.032), (-0.745, 0.875, 0.0), (-0.738, 0.874, 0.032), (-0.705, 0.872, 0.06)], 0.0115, FRAME, 'body', seg=12, smooth=5)
    rod('sub_x', (-0.33, 0.842, -0.096), (-0.33, 0.842, 0.096), 0.009, FRAME, 'body', seg=10)

    # ---- swingarm: cast aluminium, left raw. Deep in the middle, slim at the axle; a bridge ahead of the tyre
    ARM = {}
    for s in (-1, 1):
        ARM[s] = sweep('arm%d' % s, [(PIV[0] + 0.006, PIV[1], s * 0.128), (-0.30, 0.428, s * 0.131), (-0.52, 0.378, s * 0.137), (-0.70, 0.328, s * 0.137), (-0.782, 0.312, s * 0.137)],
              [0.019, 0.0185, 0.0165, 0.015, 0.015], [0.04, 0.054, 0.049, 0.037, 0.03], X_swing, 'swing', e=6.5, ring=20, smooth=5)
        cyl('pivboss%d' % s, 0.036, 0.046, (PIV[0], PIV[1], s * 0.128), X_swing, 'swing', seg=22, bevel=0.004)
        box('axleblock%d' % s, (0.062, 0.044, 0.008), (A[0] - 0.006, A[1], s * 0.156), X_cast, 'swing', bevel=0.003)
        cyl('axlenut%d' % s, 0.02, 0.014, (A[0], A[1], s * 0.166), X_steel, 'swing', seg=6, bevel=0.002)
        rod('adjbolt%d' % s, (A[0] - 0.07, A[1], s * 0.137), (A[0] - 0.044, A[1], s * 0.137), 0.005, X_steel, 'swing', seg=6)
    sweep('armbridge', [(-0.352, 0.416, -0.132), (-0.352, 0.416, 0.132)], 0.03, 0.044, X_swing, 'swing', e=4.6, ring=16)
    sweep('armbridge_web', [(-0.352, 0.365, -0.07), (-0.352, 0.365, 0.07)], 0.02, 0.018, X_swing, 'swing', e=4.0, ring=12)
    cyl('axleR', 0.0115, 0.345, (A[0], A[1], 0), X_steel, 'swing', seg=12, bevel=0)
    # rear caliper on its carrier, hung under the right arm
    plate('rcarrier', hull(circ(A[0], A[1], 0.03) + circ(*pol(A, 0.095, math.radians(205))[:2], 0.02)), 0.008, X_cast, 'swing', off=0.109, bevel=0.002)
    plate('rcaliper', hull(circ(*pol(A, 0.104, math.radians(190))[:2], 0.026) + circ(*pol(A, 0.104, math.radians(218))[:2], 0.026)), 0.044, M_cal, 'swing', off=0.093, bevel=0.008)

    # ---- rear suspension: one shock on the centre line, driven through a rocker and two pull rods (rising rate)
    RK0, RK2, LF = (-0.33, 0.372), (-0.245, 0.316), (-0.108, 0.292)            # rocker pivot under the bridge, pull-rod eye on the rocker, pull-rod eye on the frame
    for s in (-1, 1):
        plate('rocker%d' % s, hull(circ(RK0[0], RK0[1], 0.019, 14) + circ(S1[0], S1[1], 0.018, 14) + circ(RK2[0], RK2[1], 0.016, 14)), 0.007, X_cast, 'swing', off=s * 0.021, bevel=0.002)
        rod('pullrod%d' % s, (RK2[0], RK2[1], s * 0.034), (LF[0], LF[1], s * 0.034), [0.011, 0.0085, 0.0085, 0.011], X_alu, 'swing', seg=10)
        plate('rk_lug%d' % s, hull(circ(RK0[0], RK0[1], 0.017, 12) + circ(-0.345, 0.40, 0.02, 12)), 0.006, X_swing, 'swing', off=s * 0.032, bevel=0.0015)
    for (c, r, w) in ((RK0, 0.009, 0.08), (S1[:2], 0.009, 0.06), (RK2, 0.008, 0.085)): cyl('rk_pin%.2f' % c[0], r, w, (c[0], c[1], 0), X_steel, 'swing', seg=10, bevel=0.0015)
    sd = (S1[0] - S0[0], S1[1] - S0[1]); sl = math.hypot(*sd)
    def shp(f): return (S0[0] + sd[0] * f, S0[1] + sd[1] * f, 0.0)
    cyl('shk_eyeT', 0.015, 0.036, S0, X_steel, 'body', seg=14, bevel=0.002); cyl('shk_eyeB', 0.014, 0.036, S1, X_steel, 'swing', seg=14, bevel=0.002)
    rod('shk_body', shp(0.05), shp(0.5), [0.023, 0.0265, 0.0265, 0.0265], X_shock, 'shockU', seg=18)
    rod('shk_shaft', shp(0.26), shp(0.95), 0.0085, C_chrome, 'shockL', seg=14)
    rod('shk_collarT', shp(0.118), shp(0.15), 0.041, X_dark, 'shockU', seg=22); rod('shk_collarB', shp(0.855), shp(0.89), 0.039, X_dark, 'shockL', seg=22)
    coil('shk_spring', shp(0.15), shp(0.855), 0.033, 0.0068, 8.5, M_spring, 'spring')
    rod('shk_res', (S0[0] - 0.055, S0[1] + 0.004, 0.05), (S0[0] - 0.108, S0[1] - 0.118, 0.05), 0.02, X_shock, 'shockU', seg=16)
    rod('shk_resneck', (S0[0] - 0.01, S0[1] - 0.012, 0.012), (S0[0] - 0.06, S0[1] - 0.012, 0.05), 0.01, X_shock, 'shockU', seg=10)

    # ---- fork: long-travel upside-down. Gold-anodised outer tubes in two machined clamps, chrome stanchions, cast axle lugs
    FORKO = {}
    for s in (-1, 1):
        z = s * FZ
        FORKO[s] = tube('forkO%d' % s, [fp(0.30, z), fp(0.535, z), fp(0.575, z), fp(0.905, z)], [0.0335, 0.0335, 0.0298, 0.0298], X_gold, 'front', seg=22)
        rod('forkseal%d' % s, fp(0.288, z), fp(0.302, z), 0.031, M_dark, 'front', seg=22)
        rod('forkcap%d' % s, fp(0.905, z), fp(0.916, z), [0.026, 0.023], X_alu, 'front', seg=18); rod('forkadj%d' % s, fp(0.916, z), fp(0.925, z), 0.008, X_steel, 'front', seg=8)
        rod('forkS%d' % s, fp(0.10, z), fp(0.72, z), 0.024, C_chrome, 'fork', seg=28)
        tube('forkfoot%d' % s, [fp(-0.046, z), fp(-0.034, z), fp(0.03, z), fp(0.115, z), fp(0.128, z)], [0.022, 0.033, 0.034, 0.03, 0.026], X_cast, 'fork', seg=20)
        cyl('axleboss%d' % s, 0.034, 0.05, (F[0], F[1], z), X_cast, 'fork', seg=20, bevel=0.004)
        for k, sv in enumerate((-0.022, 0.022)): cyl('lugbolt%d_%d' % (s, k), 0.0055, 0.016, (fp(sv)[0] + N[0] * 0.036, fp(sv)[1] + N[1] * 0.036, z), X_steel, 'fork', axis='z', seg=8, bevel=0)
    cyl('axleF', 0.0125, 0.27, (F[0], F[1], 0), X_steel, 'fork', seg=12, bevel=0)
    cyl('axlenutF', 0.019, 0.012, (F[0], F[1], 0.135), X_steel, 'fork', seg=6, bevel=0.002)
    # radial four-piston caliper behind the left leg, on two lugs of the axle lug
    FCA = (148, 166, 184)
    plate('callug', hull(circ(F[0], F[1], 0.03) + circ(*pol(F, 0.118, math.radians(150))[:2], 0.013) + circ(*pol(F, 0.118, math.radians(196))[:2], 0.013)), 0.02, X_cast, 'fork', off=-0.096, bevel=0.003)
    plate('caliperF', hull([q for a in FCA for q in circ(*pol(F, 0.15, math.radians(a))[:2], 0.036)]), 0.058, M_cal, 'fork', off=-0.07, bevel=0.01)
    for a in FCA[::2]: cyl('calpist%d' % a, 0.014, 0.008, pol(F, 0.15, math.radians(a), -0.1), X_alu, 'fork', seg=12, bevel=0.002)
    # triple clamps (machined from billet) and stem
    yoke = lambda rt, rs: hull(circ(0, 0, rs) + circ(OFFSET, -FZ, rt) + circ(OFFSET, FZ, rt))
    plate('clampL', yoke(0.045, 0.04), 0.034, X_dark, 'front', origin=sp(0.61), ex=(N[0], N[1], 0), ey=(0, 0, 1), bevel=0.006)
    plate('clampU', yoke(0.043, 0.036), 0.024, X_dark, 'front', origin=sp(0.862), ex=(N[0], N[1], 0), ey=(0, 0, 1), bevel=0.005)
    rod('stem', sp(0.59), sp(0.878), 0.015, X_steel, 'front', seg=12); rod('stemnut', sp(0.874), sp(0.888), 0.021, X_steel, 'front', seg=6)
    for s in (-1, 1):
        for k, sv in enumerate((0.61, 0.862)):
            for dz in ((-0.008, 0.008) if k == 0 else (0.0,)):
                cyl('pinch%d_%d_%.3f' % (s, k, dz), 0.006, 0.02, (fp(sv + dz)[0] + N[0] * 0.047, fp(sv + dz)[1] + N[1] * 0.047, s * FZ), X_steel, 'front', axis='z', seg=8, bevel=0)

    # ---- wire wheels: black rims, 36 steel spokes laced three-cross, slick tyres
    def wheel(asm, R, W, rr, hw, c2, hh, fr, disc=None, sprocket=None):
        cx, cy = c2; c = (cx, cy, 0); H = R - rr
        # slick: the bead sits inside the rim's lip, a fairly upright side wall, a square shoulder and a gently rounded tread
        half = [(rr + 0.004, hw - 0.004), (rr + 0.016, hw + 0.004), (rr + 0.22 * H, W * 0.95), (rr + 0.46 * H, W), (rr + 0.68 * H, W * 0.975), (rr + 0.84 * H, W * 0.86), (rr + 0.935 * H, W * 0.64), (rr + 0.985 * H, W * 0.33), (R, 0.0)]
        lathe(asm + '_tyre', [(r, -z) for (r, z) in half[:-1]] + [(r, z) for (r, z) in reversed(half)], M_tyre, asm, 72, c, 80)
        # rim: the lips either side, and the well between them that one sees through the spokes
        rim = [(rr + 0.019, hw + 0.002), (rr + 0.02, hw + 0.0075), (rr + 0.012, hw + 0.011), (rr - 0.002, hw + 0.0105), (rr - 0.011, hw * 0.94), (rr - 0.017, hw * 0.55), (rr - 0.0215, hw * 0.22), (rr - 0.022, 0.0)]
        lathe(asm + '_rim', [(r, -z) for (r, z) in rim[:-1]] + [(r, z) for (r, z) in reversed(rim)], G_rim, asm, 72, c, 50)
        # hub: a spool with a flange each side for the spokes
        hub = [(0.017, hh + 0.016), (0.026, hh + 0.014), (0.03, hh + 0.006), (fr, hh + 0.004), (fr, hh - 0.003), (0.033, hh - 0.012), (0.028, hh * 0.5), (0.027, 0.0)]
        lathe(asm + '_hub', [(r, -z) for (r, z) in hub[:-1]] + [(r, z) for (r, z) in reversed(hub)], M_hub, asm, 36, c, 40)
        # spokes: 18 from each flange, alternately leading and trailing, to rim holes 10 degrees apart; a nipple at each
        rs = rr - 0.02
        def lace(bm, nip):
            for sgn in (-1, 1):
                for j in range(18):
                    th = math.radians(20 * j + (10 if sgn > 0 else 0)); lead = 1 if j % 2 == 0 else -1; tr = th + lead * math.radians(60)
                    a = (cx + (fr - 0.004) * math.cos(th), cy + (fr - 0.004) * math.sin(th), sgn * (hh + (0.004 if lead > 0 else -0.003)))
                    b = (cx + rs * math.cos(tr), cy + rs * math.sin(tr), sgn * hw * 0.16)
                    d = Vector(b) - Vector(a); L = d.length; d.normalize(); m = tuple(Vector(b) - d * 0.016)
                    if nip: bm_tube(bm, m, tuple(Vector(b) + d * 0.004), [0.0042, 0.0036], 6)
                    else: bm_tube(bm, a, m, 0.0021, 5, caps=False)
        many(asm + '_spokes', X_spoke, asm, lambda bm: lace(bm, False), 80); many(asm + '_nipples', X_alu, asm, lambda bm: lace(bm, True), 60)
        if disc:
            ro, ri, z, nb = disc
            holes = [circ(*pol(c2, ri + (ro - ri) * f, (k + (0.5 if f > 0.5 else 0.0) + f * 0.6) / n * 6.2832)[:2], 0.0045, 7) for (f, n) in ((0.3, 28), (0.7, 28)) for k in range(n)]
            cutplate(asm + '_disc', circ(cx, cy, ro, 64), [circ(cx, cy, ri, 48)] + holes, 0.0048, M_disc, asm, off=z)
            # carrier: a star with one arm per button, cut away between the arms
            rc0, rc1 = fr + 0.012, ri + 0.004; star = []
            for k in range(nb):
                a0 = k / nb * 6.2832
                star += [pol(c2, rc1, a0 - 0.085)[:2], pol(c2, rc1, a0 + 0.085)[:2], pol(c2, rc0 + 0.02, a0 + 0.5 / nb * 6.2832 - 0.16)[:2], pol(c2, rc0 + 0.02, a0 + 0.5 / nb * 6.2832 + 0.16)[:2]]
            cutplate(asm + '_carrier', star, [circ(cx, cy, rc0 - 0.01, 28)], 0.0055, X_dark, asm, off=z + math.copysign(0.0045, -z))
            many(asm + '_buttons', X_alu, asm, lambda bm: [bm_tube(bm, pol(c2, ri + 0.002, k / nb * 6.2832, z - 0.005), pol(c2, ri + 0.002, k / nb * 6.2832, z + 0.005), 0.0062, 8) for k in range(nb)], 50)
            lathe(asm + '_dcone', [(0.03, math.copysign(hh + 0.004, z)), (rc0 - 0.008, z + math.copysign(0.004, -z)), (rc0 - 0.008, z + math.copysign(0.009, -z)), (0.03, math.copysign(hh - 0.002, z))], X_dark, asm, 28, c, 40)
        if sprocket:
            z, nt, rp = sprocket; teeth = [pol(c2, rp + (0.0052 if k % 2 else -0.0035), k / (2 * nt) * 6.2832)[:2] for k in range(2 * nt)]
            cutplate(asm + '_sprocket', teeth, [circ(cx, cy, 0.058, 28)] + [circ(*pol(c2, 0.088, (k + 0.5) / 8 * 6.2832)[:2], 0.011, 10) for k in range(8)], 0.007, X_sprocket, asm, off=z)
            lathe(asm + '_scone', [(0.03, math.copysign(hh + 0.004, z)), (0.066, z + math.copysign(0.005, -z)), (0.066, z + math.copysign(0.01, -z)), (0.03, math.copysign(hh - 0.002, z))], X_dark, asm, 28, c, 40)
            many(asm + '_spb', X_steel, asm, lambda bm: [bm_tube(bm, pol(c2, 0.063, k / 6 * 6.2832, z - 0.006), pol(c2, 0.063, k / 6 * 6.2832, z + 0.006), 0.0055, 6) for k in range(6)], 40)
    wheel('wheelF', RF, WF, RIMF, 0.046, F, 0.034, 0.041, disc=(0.155, 0.122, -0.07, 6))
    wheel('wheelR', RR, WR, RIMR, 0.066, A, 0.05, 0.047, disc=(0.11, 0.084, 0.085, 4), sprocket=(-0.092, 48, 0.121))

# ================================================================== STAGE 2: engine, cooling, exhaust, final drive
if 'engine' in STAGES:
    X_case = mat('X_smcase', '9a9ea5'); G_cover = mat('G_smcover', '16171a'); X_cyl = mat('X_smcyl', 'aeb2b8'); X_pipe = mat('X_smpipe', 'a89f90'); X_can = mat('X_smcan', '1d55c8')
    X_case2 = mat('X_smcase2', '82868d'); M_seam = mat('M_smseam', '0c0c0d')
    M_rubber = mat('M_smrubber', '121214'); M_core = mat('M_smcore', '101113'); M_bore = mat('M_bore', '050506'); M_plug = mat('M_smplug', 'd0381f')
    # liquid-cooled four-stroke single, cylinder leaning 8 degrees forward. Crank ahead, gearbox behind it, output shaft just in front of the swingarm pivot.
    EC = (0.105, 0.42); TILT = math.radians(8); ED = (math.sin(TILT), math.cos(TILT)); EP = (math.cos(TILT), -math.sin(TILT))      # crank centre, cylinder axis, forward normal
    def ept(u, v=0.0, z=0.0): return (EC[0] + ED[0] * u + EP[0] * v, EC[1] + ED[1] * u + EP[1] * v, z)
    SPR = (-0.055, 0.425); CL = (0.015, 0.412); WP = (0.172, 0.372)                                                                 # output sprocket, clutch centre, water pump
    # crankcase: one casting, narrow enough to sit between the cradle rails
    plate('crankcase', hull(circ(EC[0], EC[1], 0.104) + circ(-0.045, 0.43, 0.086) + circ(0.0, 0.338, 0.052) + circ(0.165, 0.34, 0.046)), 0.168, X_case, 'body', bevel=0.012, seg=3)
    plate('sump', hull(circ(0.02, 0.325, 0.03, 12) + circ(0.14, 0.325, 0.03, 12)), 0.12, X_case, 'body', bevel=0.008)
    # the two case halves meet on the centre line: a seam all the way round. Each side carries a bolted cover with its own joint to the case
    plate('caseseam', hull(circ(EC[0], EC[1], 0.1052) + circ(-0.045, 0.43, 0.0872) + circ(0.0, 0.338, 0.0532) + circ(0.165, 0.34, 0.0472)), 0.0028, M_seam, 'body', bevel=0)
    plate('coverR', hull(circ(CL[0], CL[1], 0.107) + circ(WP[0], WP[1], 0.052) + circ(0.105, 0.33, 0.04)), 0.013, X_case2, 'body', off=0.0885, bevel=0.004)
    plate('coverR_seam', hull(circ(CL[0], CL[1], 0.1082) + circ(WP[0], WP[1], 0.0532) + circ(0.105, 0.33, 0.0412)), 0.002, M_seam, 'body', off=0.083, bevel=0)
    plate('coverL', hull(circ(EC[0], EC[1], 0.093) + circ(0.03, 0.352, 0.042)), 0.013, X_case2, 'body', off=-0.0885, bevel=0.004)
    plate('coverL_seam', hull(circ(EC[0], EC[1], 0.0942) + circ(0.03, 0.352, 0.0432)), 0.002, M_seam, 'body', off=-0.083, bevel=0)
    many('coverbolts', X_steel, 'body', lambda bm: [bm_tube(bm, (x, y, sg * 0.093), (x, y, sg * 0.099), 0.0048, 6) for (sg, pts) in
          ((1, [pol(CL, 0.1, math.radians(a))[:2] for a in (95, 140, 185, 230, 275)] + [pol(WP, 0.046, math.radians(a))[:2] for a in (-60, 10, 70)] + [(0.105, 0.297), (0.07, 0.31)]),
           (-1, [pol(EC, 0.0865, math.radians(a))[:2] for a in (10, 60, 110, 160, 215)] + [(0.01, 0.32), (0.06, 0.318)])) for (x, y) in pts], 40)
    # right side: clutch under a big round cover with a machined rim, water pump ahead of it, oil filter cap below
    lathe('clutchcover', [(0.09, 0.093), (0.09, 0.103), (0.083, 0.107), (0.076, 0.123), (0.047, 0.131), (0.0, 0.132)], G_cover, 'body', 36, (CL[0], CL[1], 0), 40)
    lathe('clutchrim', [(0.094, 0.093), (0.094, 0.0995), (0.09, 0.103)], X_alu, 'body', 36, (CL[0], CL[1], 0), 40)
    many('clutchbolts', X_steel, 'body', lambda bm: [bm_tube(bm, pol(CL, 0.085, (k + 0.5) / 7 * 6.2832, 0.103), pol(CL, 0.085, (k + 0.5) / 7 * 6.2832, 0.111), 0.0046, 6) for k in range(7)], 40)
    lathe('clutchboss', [(0.028, 0.13), (0.028, 0.137), (0.021, 0.14), (0.0, 0.14)], X_alu, 'body', 20, (CL[0], CL[1], 0), 40)
    lathe('waterpump', [(0.041, 0.093), (0.041, 0.112), (0.033, 0.12), (0.0, 0.121)], X_case, 'body', 24, (WP[0], WP[1], 0), 40)
    many('pumpbolts', X_steel, 'body', lambda bm: [bm_tube(bm, pol(WP, 0.034, (k + 0.3) / 4 * 6.2832, 0.112), pol(WP, 0.034, (k + 0.3) / 4 * 6.2832, 0.119), 0.0045, 6) for k in range(4)], 40)
    lathe('oilfilter', [(0.026, 0.093), (0.026, 0.104), (0.02, 0.108), (0.0, 0.108)], X_alu, 'body', 18, (0.105, 0.326, 0), 40)
    # left side: generator cover on the crank, the output sprocket behind it under a guard
    lathe('gencover', [(0.076, -0.093), (0.076, -0.104), (0.065, -0.12), (0.032, -0.127), (0.0, -0.127)], G_cover, 'body', 32, (EC[0], EC[1], 0), 40)
    lathe('genrim', [(0.08, -0.093), (0.08, -0.0995), (0.076, -0.103)], X_alu, 'body', 32, (EC[0], EC[1], 0), 40)
    many('genbolts', X_steel, 'body', lambda bm: [bm_tube(bm, pol(EC, 0.07, k / 5 * 6.2832, -0.103), pol(EC, 0.07, k / 5 * 6.2832, -0.111), 0.0045, 6) for k in range(5)], 40)
    lathe('sprocketF', [(0.012, -0.0975), (0.0335, -0.0965), (0.0335, -0.0885), (0.012, -0.0875)], X_steel, 'body', 20, (SPR[0], SPR[1], 0), 30)
    plate('sprocketguard', hull(circ(SPR[0], SPR[1], 0.056) + circ(SPR[0] + 0.045, SPR[1] + 0.03, 0.03)), 0.01, M_dark, 'body', off=-0.111, bevel=0.004)
    # cylinder, head and cam cover, stacked up the cylinder axis; the cam chain runs up a tunnel on the left
    sweep('cylinder', [ept(0.085), ept(0.20)], 0.064, 0.063, X_cyl, 'body', e=4.5, ring=20)
    # joint lines: base gasket, head gasket, cam cover seal - thin dark lines standing a hair proud of the castings
    for (u, w, h) in ((0.0925, 0.0738, 0.0718), (0.2, 0.0672, 0.0672), (0.297, 0.0705, 0.0745)): sweep('joint%.3f' % u, [ept(u - 0.0014), ept(u + 0.0014)], w, h, M_seam, 'body', e=4.6, ring=20)
    sweep('cylbase', [ept(0.078), ept(0.092)], 0.073, 0.071, X_case, 'body', e=5.0, ring=20)
    sweep('head', [ept(0.20), ept(0.214), ept(0.285), ept(0.297)], [0.066, 0.074, 0.074, 0.068], [0.066, 0.079, 0.079, 0.072], X_cyl, 'body', e=4.5, ring=20)
    sweep('camcover', [ept(0.297), ept(0.305), ept(0.332), ept(0.342)], [0.064, 0.066, 0.063, 0.05], [0.07, 0.073, 0.068, 0.05], G_cover, 'body', e=4.0, ring=20)
    sweep('camtunnel', [ept(0.06, 0.0, -0.072), ept(0.29, 0.0, -0.079)], 0.012, 0.03, X_cyl, 'body', e=5.0, ring=12)
    many('headbolts', X_steel, 'body', lambda bm: [bm_tube(bm, ept(0.297, v, z), ept(0.306, v, z), 0.006, 6) for v in (-0.062, 0.062) for z in (-0.05, 0.05)], 40)
    # spark plug cap and lead on top, into the frame
    rod('plugcap', ept(0.335, 0.0, 0.0), ept(0.372, 0.0, 0.0), [0.013, 0.012, 0.01], M_plug, 'body', seg=10)
    tube('pluglead', [ept(0.372, 0.0, 0.0), ept(0.40, -0.03, 0.01), ept(0.39, -0.10, 0.04), (-0.02, 0.80, 0.07)], 0.0042, M_rubber, 'body', seg=6, smooth=5)
    # starter motor across the top of the gearbox
    cyl('starter', 0.031, 0.105, (-0.012, 0.536, -0.012), X_alu, 'body', axis='z', seg=18, bevel=0.004); cyl('starter_end', 0.027, 0.02, (-0.012, 0.536, -0.07), G_cover, 'body', axis='z', seg=18, bevel=0.004)
    # intake: throttle body out of the back of the head, a rubber boot on towards the airbox
    rod('throttlebody', ept(0.262, -0.072), ept(0.305, -0.16), [0.03, 0.028, 0.028, 0.03], X_alu, 'body', seg=18)
    rod('intakeboot', ept(0.305, -0.16), ept(0.34, -0.235), [0.033, 0.035, 0.037, 0.04], M_rubber, 'body', seg=18)
    box('injector', (0.022, 0.05, 0.022), ept(0.325, -0.125), X_dark, 'body', rot=(0, 0, -0.6), bevel=0.005)
    rod('exhport', ept(0.25, 0.066), ept(0.256, 0.09), 0.03, X_cyl, 'body', seg=16)
    # the engine is hung in the frame: head stays to the spars, a mount on the down tube, two on the cradle (the swingarm pivot passes through the back of the case)
    for sg in (-1, 1):
        cutplate('headstay%d' % sg, hull(circ(*ept(0.30, -0.058)[:2], 0.016, 12) + circ(0.062, 0.86, 0.016, 12) + circ(-0.01, 0.815, 0.014, 12)), [circ(0.045, 0.80, 0.012, 10)], 0.006, FRAME, 'body', off=sg * 0.081)
        plate('mountF%d' % sg, hull(circ(0.338, 0.545, 0.016, 12) + circ(0.215, 0.455, 0.015, 12)), 0.006, FRAME, 'body', off=sg * 0.03, bevel=0.0015)
        plate('mountB%d' % sg, hull(circ(0.03, 0.272, 0.014, 12) + circ(0.03, 0.305, 0.013, 12)), 0.006, FRAME, 'body', off=sg * 0.09, bevel=0.0015)
    for (x, y, w) in ((0.215, 0.455, 0.075), (0.03, 0.305, 0.192), (ept(0.30, -0.058)[0], ept(0.30, -0.058)[1], 0.175)): cyl('mountpin%.2f' % x, 0.0065, w, (x, y, 0), X_steel, 'body', seg=8, bevel=0)

    # ---- cooling: a radiator either side of the down tube, hoses from the pump and to the head
    RZ = math.radians(-11); crz, srz = math.cos(RZ), math.sin(RZ)
    def rpt(o, lx, ly, dz=0.0): return (o[0] + lx * crz - ly * srz, o[1] + lx * srz + ly * crz, o[2] + dz)      # a point in a radiator's own (tilted) frame
    for sg in (-1, 1):
        o = (0.318, 0.75, sg * 0.108)
        box('rad_core%d' % sg, (0.026, 0.215, 0.1), o, M_core, 'body', rot=(0, 0, RZ), bevel=0.002)
        for k, ly in enumerate((0.117, -0.117)): box('rad_tank%d_%d' % (sg, k), (0.034, 0.024, 0.108), rpt(o, 0, ly), X_alu, 'body', rot=(0, 0, RZ), bevel=0.006)
        many('rad_fins%d' % sg, X_alu, 'body', lambda bm: [bm_tube(bm, rpt(o, fx, -0.095 + 0.0173 * k, -0.048), rpt(o, fx, -0.095 + 0.0173 * k, 0.048), 0.0016, 4) for fx in (0.0145, -0.0145) for k in range(12)], 80)
    cyl('rad_cap', 0.016, 0.018, rpt((0.318, 0.75, 0.108), 0.0, 0.14), X_alu, 'body', axis='y', seg=14, bevel=0.003)
    tube('hose_pump', [(WP[0] + 0.02, WP[1] + 0.03, 0.108), (0.25, 0.47, 0.12), (0.292, 0.56, 0.13), (0.296, 0.63, 0.125)], 0.0125, M_rubber, 'body', seg=10, smooth=6)
    tube('hose_head', [ept(0.275, 0.03, -0.074), (0.22, 0.75, -0.09), (0.275, 0.83, -0.105), (0.30, 0.86, -0.108)], 0.0125, M_rubber, 'body', seg=10, smooth=6)
    tube('hose_cross', [(0.30, 0.64, -0.10), (0.325, 0.61, -0.05), (0.33, 0.605, 0.0), (0.325, 0.61, 0.05), (0.30, 0.64, 0.10)], 0.011, M_rubber, 'body', seg=10, smooth=6)

    # ---- exhaust: the header leaves the front of the head, swings round the right of the cylinder and climbs past the frame to a silencer under the seat
    E0 = ept(0.256, 0.09)
    HDR = [E0, (0.277, 0.652, 0.014), (0.302, 0.59, 0.052), (0.282, 0.525, 0.1), (0.20, 0.494, 0.13), (0.07, 0.505, 0.142), (-0.06, 0.535, 0.148), (-0.19, 0.563, 0.156), (-0.28, 0.577, 0.166), (-0.345, 0.602, 0.176)]
    tube('header', HDR, [0.0205, 0.0205, 0.0205, 0.021, 0.0215, 0.022, 0.0225, 0.0235, 0.0245, 0.0245], X_pipe, 'body', seg=18, smooth=8)
    rod('hdr_flange', E0, (E0[0] + EP[0] * 0.012, E0[1] + EP[1] * 0.012, 0), 0.03, X_steel, 'body', seg=16)
    C0, C1 = (-0.355, 0.607, 0.178), (-0.752, 0.815, 0.188); cd = Vector(C1) - Vector(C0); cl = cd.length; cd.normalize()
    def cpt(f): return tuple(Vector(C0) + cd * (cl * f))
    rod('can_joint', (-0.318, 0.590, 0.172), cpt(0.05), [0.0255, 0.027, 0.03], X_steel, 'body', seg=18)
    sweep('can_cone', [cpt(0.02), cpt(0.1)], [0.03, 0.048], [0.032, 0.07], X_can, 'body', e=[2.0, 3.2], ring=24)
    CAN = sweep('can', [cpt(0.1), cpt(0.9)], 0.048, 0.07, X_can, 'body', e=3.2, ring=24)
    sweep('can_band0', [cpt(0.105), cpt(0.135)], 0.0495, 0.0715, X_steel, 'body', e=3.2, ring=24); sweep('can_band1', [cpt(0.84), cpt(0.87)], 0.0495, 0.0715, X_steel, 'body', e=3.2, ring=24)
    sweep('can_end', [cpt(0.9), cpt(0.955), cpt(1.0)], [0.049, 0.046, 0.035], [0.071, 0.066, 0.048], G_cover, 'body', e=[3.2, 3.0, 2.4], ring=24, caps=False)
    spin('can_outlet', cpt(0.93), cpt(1.012), [(0.0, 0.0), (0.0, 0.021), (1.0, 0.021), (1.0, 0.0245), (0.86, 0.0245)], M_bore, 'body', seg=18, flip=False)
    spin('can_tip', cpt(0.985), cpt(1.015), [(0.0, 0.03), (1.0, 0.027), (1.0, 0.0215), (0.0, 0.0215)], X_steel, 'body', seg=18)
    plate('can_bracket', hull(circ(-0.50, 0.855, 0.014, 10) + circ(*cpt(0.5)[:2], 0.014, 10)), 0.005, FRAME, 'body', off=0.104, bevel=0.0015)
    rod('can_stud', (cpt(0.5)[0], cpt(0.5)[1], 0.1), (cpt(0.5)[0], cpt(0.5)[1], 0.142), 0.007, X_steel, 'body', seg=8)
    rod('can_stay', (-0.50, 0.855, 0.09), (-0.50, 0.855, 0.112), 0.007, X_steel, 'body', seg=8)

    # ---- final drive: chain round both sprockets (a stand-in here, the game draws it link by link), slider and guide on the swingarm
    r1, r2 = 0.0365, 0.121; dx, dy = SPR[0] - A[0], SPR[1] - A[1]; Dc = math.hypot(dx, dy); phi = math.atan2(dy, dx); al = math.acos((r2 - r1) / Dc); loop = []
    for k in range(21): loop.append(pol(A, r2, phi + al + (2 * math.pi - 2 * al) * k / 20, -0.092))
    for k in range(13): loop.append(pol(SPR, r1, phi - al + 2 * al * k / 12, -0.092))
    loop.append(loop[0])
    sweep('chain', loop, 0.0085, 0.0062, X_chain, 'swing', e=4.0, ring=8, caps=False)['noexport'] = 1
    sweep('chainslider', [(-0.165, 0.49, -0.128), (-0.25, 0.488, -0.13), (-0.34, 0.468, -0.132)], 0.014, 0.007, M_dark, 'swing', e=3.0, ring=10, smooth=3)
    plate('chainguide', [(-0.60, 0.292), (-0.545, 0.292), (-0.535, 0.252), (-0.605, 0.238)], 0.03, M_dark, 'swing', off=-0.095, bevel=0.005)
    plate('guidemount', [(-0.585, 0.345), (-0.555, 0.345), (-0.552, 0.288), (-0.59, 0.288)], 0.006, X_swing, 'swing', off=-0.118, bevel=0.0015)

# ================================================================== STAGE 3: bodywork
# Colours: black and red with white accents (the fork is gold, the silencer blue). Sponsor lettering all over, as on any race bike -
# every name on it is made up.
if 'body' in STAGES:
    G_red = mat('G_smred', 'c2141a'); G_black = mat('G_smplastic', '15161a'); G_white = mat('G_smwhite', 'f1f1ec'); M_seat = mat('M_smseat', '141518'); M_dark = mat('M_dark', '1c1e22')
    T_white = mat('G_smtxtwhite', 'f4f4f0'); T_black = mat('G_smtxtblack', '101114'); T_red = mat('G_smtxtred', 'c2141a')
    # tank: sits between the spars under the front of the seat, black; its hump and the filler show above the shrouds
    loft('tank', [dict(x=0.305, y=0.90, w=0.045, ht=0.05, hb=0.06, e=2.6), dict(x=0.24, y=0.90, w=0.086, ht=0.064, hb=0.09, e=2.8), dict(x=0.12, y=0.89, w=0.1, ht=0.068, hb=0.1, e=2.9),
                  dict(x=0.0, y=0.875, w=0.096, ht=0.052, hb=0.09, e=2.8), dict(x=-0.075, y=0.862, w=0.07, ht=0.038, hb=0.07, e=2.6)], G_black, 'body', ring=20, subsurf=2)
    cyl('fuelcap', 0.03, 0.016, (0.222, 0.968, 0), M_dark, 'body', axis='y', seg=20, bevel=0.004); cyl('fuelcap_top', 0.02, 0.006, (0.222, 0.978, 0), X_alu, 'body', axis='y', seg=16, bevel=0.002)
    # airbox under the seat, between the subframe rails; the intake boot runs into its front
    loft('airbox', [dict(x=-0.06, y=0.77, w=0.07, ht=0.06, hb=0.07, e=3.4), dict(x=-0.16, y=0.765, w=0.086, ht=0.066, hb=0.09, e=3.6), dict(x=-0.30, y=0.772, w=0.088, ht=0.058, hb=0.075, e=3.6),
                    dict(x=-0.37, y=0.785, w=0.07, ht=0.045, hb=0.05, e=3.2)], M_dark, 'body', ring=16, subsurf=1)
    # seat: long, flat and narrow, so the rider can slide all the way forward onto the tank
    SEAT = loft('seat', [dict(x=0.165, y=0.948, w=0.05, ht=0.02, hb=0.022, e=2.6), dict(x=0.05, y=0.93, w=0.076, ht=0.03, hb=0.032, e=3.0), dict(x=-0.1, y=0.899, w=0.093, ht=0.034, hb=0.04, e=3.2),
                  dict(x=-0.28, y=0.872, w=0.1, ht=0.034, hb=0.04, e=3.2), dict(x=-0.45, y=0.877, w=0.096, ht=0.034, hb=0.036, e=3.2), dict(x=-0.6, y=0.901, w=0.08, ht=0.03, hb=0.03, e=3.0),
                  dict(x=-0.675, y=0.908, w=0.054, ht=0.02, hb=0.02, e=2.6)], M_seat, 'body', ring=18, subsurf=2)
    # gripper cover: raised ribs across the seat, each one laid onto the seat's own surface
    def seatribs(bm):
        for k in range(27):
            x = 0.135 - 0.03 * k; pts = []
            for j in range(17):
                z = -0.112 + 0.014 * j; ok, loc, nrm, idx = SEAT.ray_cast(V(x, 1.3, z), Vector((0, 0, -1)))
                if ok and nrm.z > 0.3: pts.append((loc.x - nrm.x * 0.0008, loc.z - nrm.z * 0.0008, -loc.y + nrm.y * 0.0008))
            for a2, b2 in zip(pts, pts[1:]): bm_tube(bm, a2, b2, 0.0034, 5)
    many('seatribs', mat('M_smseatrib', '2b2d33'), 'body', seatribs, 50)
    # The bodywork follows the layout every bike of this class has. One long line runs from the tail along the seat to a wing beside the fork; under it
    # hang two triangles: the radiator shroud, with a blade reaching down in front of the engine, and the side panel, pointing down at the swingarm
    # pivot. They run into each other in one arch above the cylinder head. Sharp at the tips, flowing in between.
    def off(a, b, d):                                      # the line a-b moved d to its left (in the side view)
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); return (a[0] - dy / L * d, a[1] + dx / L * d), (b[0] - dy / L * d, b[1] + dx / L * d)
    SA, SB = (0.10, 0.615), (0.45, 0.72)                   # the slash across the shroud: black below it
    PA, PB = (-0.40, 0.60), (0.0, 0.72)                    # the slash across the side panel: red below it
    for sg in (-1, 1):
        k = 1.0 if sg < 0 else 0.97                        # the right-hand side panel sits a little closer in: the silencer runs outside it
        # ---- radiator shroud: red, the word mark in white, the blade black under a white pinstripe
        top = [(-0.10, 0.885, 0.104), (0.05, 0.915, 0.118), (0.20, 0.93, 0.138), (0.36, 0.93, 0.162), (0.49, 0.902, 0.178)]
        bot = [(-0.08, 0.715, 0.126), (0.07, 0.708, 0.15), (0.18, 0.675, 0.16), (0.265, 0.61, 0.163), (0.33, 0.515, 0.16)]
        lft = [(-0.10, 0.885, 0.104), (-0.097, 0.842, 0.114), (-0.092, 0.80, 0.121), (-0.086, 0.757, 0.125), (-0.08, 0.715, 0.126)]
        rgt = [(0.49, 0.902, 0.178), (0.425, 0.81, 0.178), (0.385, 0.71, 0.175), (0.355, 0.61, 0.169), (0.33, 0.515, 0.16)]
        shr = panel('shroud%d' % sg, tight([[side(q, sg) for q in row] for row in coons(top, bot, lft, rgt, 0.014)], 0.12), 0.006, G_red, 'body')
        # (lettering first, while the panel is still whole; tilt is the slope of the base line in the bike's side view)
        label('ad_apex%d' % sg, 'APEX', shr, (0.19, 0.83), 0.062, sg, T_white, 'body', tilt=0.05 * sg)
        label('ad_korvex%d' % sg, 'KORVEX', shr, (0.385, 0.862), 0.018, sg, T_white, 'body', tilt=0.0)
        label('ad_oktan%d' % sg, 'OKTAN 98', shr, (0.33, 0.752), 0.014, sg, T_white, 'body', tilt=0.05 * sg)
        band([shr], 'shroud_edge%d' % sg, *off(SA, SB, -0.1), 0.1, 0.9, G_black, 'body')
        band([shr], 'shroud_pin%d' % sg, *off(SA, SB, 0.009), 0.0045, 0.9, G_white, 'body')
        # ---- side panel: black, a white field for the start number (the game prints it), the tip red under a white pinstripe, the tail red
        top = [(0.03, 0.878, 0.114), (-0.15, 0.868, 0.116), (-0.33, 0.85, 0.114), (-0.50, 0.866, 0.106), (-0.68, 0.905, 0.078)]
        bot = [(0.03, 0.712, 0.12), (-0.03, 0.70, 0.121), (-0.10, 0.67, 0.122), (-0.165, 0.615, 0.122), (-0.22, 0.54, 0.12)]
        lft = [(0.03, 0.878 - 0.0415 * q, 0.114 + 0.0015 * q) for q in range(5)]
        rgt = [(-0.68, 0.905, 0.078), (-0.57, 0.828, 0.112), (-0.46, 0.745, 0.12), (-0.345, 0.648, 0.123), (-0.22, 0.54, 0.12)]
        sp_ = panel('sidepanel%d' % sg, tight([[(q[0], q[1], q[2] * sg * k) for q in row] for row in coons(top, bot, lft, rgt, 0.006)], 0.12), 0.006, G_black, 'body')
        label('ad_zynto%d' % sg, 'ZYNTO', sp_, (-0.19, 0.722), 0.02, sg, T_white, 'body', tilt=0.0)
        band([sp_], 'sidepanel_tip%d' % sg, *off(PA, PB, -0.1), 0.1, 0.9, G_red, 'body')
        band([sp_], 'sidepanel_pin%d' % sg, *off(PA, PB, 0.008), 0.004, 0.9, G_white, 'body')
        fld = band([sp_], 'sidepanel_field%d' % sg, (-0.7, 0.84), (0.0, 0.84), 0.065, -0.14, G_white, 'body', slant=-0.6)
        band([fld], 'sidepanel_tail%d' % sg, (-0.7, 0.84), (0.0, 0.84), 0.2, -0.50, G_red, 'body', slant=0.6)
        label('ad_grip%d' % sg, 'GRIPWERK', ARM[sg], (-0.5, 0.381), 0.03, sg, T_black, 'swing', tilt=0.208 * sg)
        label('ad_vyro_f%d' % sg, 'VYRO', FORKO[sg], fp(0.43)[:2], 0.024, sg, T_black, 'front', tilt=math.pi / 2 + RAKE * sg)
    # rear fender: red, runs out from under the seat, kicked up over the wheel
    FR = [(-0.50, 0.873, 0.086, 0.012), (-0.66, 0.90, 0.076, 0.015), (-0.82, 0.93, 0.062, 0.013), (-0.955, 0.955, 0.044, 0.008)]
    panel('fender_rear', tight([[(x, y - 0.03 * w / 0.086, -w), (x, y, -w * 0.9), (x, y + c, 0.0), (x, y, w * 0.9), (x, y - 0.03 * w / 0.086, w)] for (x, y, w, c) in FR], 0.2), 0.006, G_red, 'body')
    # heat shield where the rider's leg passes the pipe
    sweep('heatshield', [(-0.07, 0.56, 0.176), (-0.17, 0.584, 0.182), (-0.27, 0.606, 0.191)], 0.004, 0.03, G_black, 'body', e=3.0, ring=10, smooth=4)
    if 'engine' in STAGES: label('ad_can', 'DRIFTWERK', CAN, cpt(0.5)[:2], 0.034, 1, mat('G_smtxtyellow', 'ffd21a'), 'body', tilt=math.atan2(C0[1] - C1[1], C0[0] - C1[0]))
    # front fender: a red beak under the lower fork clamp, steering with the fork
    FF = [(0.315, 0.757, 0.044, 0.012), (0.44, 0.792, 0.07, 0.022), (0.60, 0.796, 0.078, 0.024), (0.76, 0.778, 0.066, 0.02), (0.90, 0.75, 0.04, 0.012)]
    panel('fender_front', tight([[(x, y, -w), (x, y + c, 0.0), (x, y, w)] for (x, y, w, c) in FF], 0.2), 0.006, G_red, 'front')
    for sg in (-1, 1): rod('fender_stay%d' % sg, (0.455, 0.812, sg * 0.05), (sp(0.61)[0] + N[0] * 0.03, sp(0.61)[1] + N[1] * 0.03 - 0.016, sg * 0.05), 0.007, M_dark, 'front', seg=8)
    # start-number plate in front of the clamps: red, with a white field for the number
    NPC = (fp(0.74)[0] + N[0] * 0.064, fp(0.74)[1] + N[1] * 0.064, 0.0)
    def npp(h, z, b): return (NPC[0] + U[0] * h + N[0] * b, NPC[1] + U[1] * h + N[1] * b, z)
    def nprows(f, b): return [[npp(0.106 * f, -0.082 * f, b), npp(0.114 * f, 0.0, 0.016 + b), npp(0.106 * f, 0.082 * f, b)], [npp(0.02 * f, -0.102 * f, b), npp(0.02 * f, 0.0, 0.026 + b), npp(0.02 * f, 0.102 * f, b)],
                              [npp(-0.075 * f, -0.084 * f, b), npp(-0.075 * f, 0.0, 0.022 + b), npp(-0.075 * f, 0.084 * f, b)], [npp(-0.136 * f, -0.048 * f, b - 0.004), npp(-0.142 * f, 0.0, 0.008 + b), npp(-0.136 * f, 0.048 * f, b - 0.004)]]
    panel('numberplate', tight(nprows(1.0, 0.0), 0.2), 0.006, G_red, 'front')
    panel('numberfield', tight(nprows(0.74, 0.0085), 0.2), 0.003, G_white, 'front')
    for sg in (-1, 1): rod('plate_stay%d' % sg, npp(0.0, sg * 0.07, 0.004), fp(0.74, sg * FZ * 0.92), 0.006, M_dark, 'front', seg=8)
    # fork guards: red shells wrapped round the front and the outside of the stanchions, moving with the wheel
    for sg in (-1, 1):
        rows = []
        for (s2, r) in ((0.03, 0.039), (0.12, 0.044), (0.25, 0.044), (0.375, 0.04)):
            c = fp(s2, sg * FZ); rows.append([(c[0] + N[0] * math.cos(a) * r, c[1] + N[1] * math.cos(a) * r, c[2] + sg * math.sin(a) * r) for a in (math.radians(d) for d in (-35, -5, 25, 58, 90, 120))])
        fg = panel('forkguard%d' % sg, tight(rows, 0.2), 0.004, G_red, 'fork')
        label('ad_oktan_g%d' % sg, 'OKTAN', fg, fp(0.205)[:2], 0.028, sg, T_white, 'fork', tilt=math.pi / 2 + RAKE * sg)

# ================================================================== STAGE 4: controls, lines and footrests
# No instruments: a supermoto of this kind carries none.
if 'controls' in STAGES:
    G_red = mat('G_smred', 'c2141a'); M_grip = mat('M_smgrip', '3a3d44'); M_dark = mat('M_dark', '1c1e22'); M_line = mat('M_smline', '121316'); HOSES = []
    def fwd(q, d, z=None): return (q[0] + N[0] * d, q[1] + N[1] * d, q[2] if z is None else z)
    # ---- handlebar: wide tapered bar on two risers, a pad over the clamps
    BC = fwd(sp(0.932), 0.012)
    HB = [(0.0, 0.0, 0.0), (0.0, 0.0, 0.065), (-0.006, 0.035, 0.14), (-0.018, 0.058, 0.21), (-0.045, 0.064, 0.30), (-0.08, 0.064, 0.40)]      # one half of the bar, relative to its centre
    def bar(z, dx=0.0, dy=0.0):                            # point on the bar at lateral position z (either side)
        a = min(abs(z), HB[-1][2])
        for k in range(len(HB) - 1):
            if HB[k][2] <= a <= HB[k + 1][2] + 1e-9:
                f = (a - HB[k][2]) / (HB[k + 1][2] - HB[k][2]); return (BC[0] + HB[k][0] + (HB[k + 1][0] - HB[k][0]) * f + dx, BC[1] + HB[k][1] + (HB[k + 1][1] - HB[k][1]) * f + dy, z)
    half = [(BC[0] + q[0], BC[1] + q[1], q[2]) for q in HB]
    tube('handlebar', [(q[0], q[1], -q[2]) for q in reversed(half[1:])] + half, [0.011, 0.011, 0.0115, 0.013, 0.0143, 0.0143, 0.0143, 0.013, 0.0115, 0.011, 0.011], X_dark, 'front', seg=12, smooth=5)
    for s in (-1, 1):
        rod('riser%d' % s, fwd(sp(0.872, s * 0.045), 0.012), (BC[0], BC[1] - 0.006, s * 0.045), [0.0175, 0.0155, 0.0165], X_dark, 'front', seg=14)
        cyl('barclamp%d' % s, 0.0245, 0.036, (BC[0], BC[1], s * 0.045), X_dark, 'front', seg=20, bevel=0.004)
    sweep('barpad', [(BC[0] - 0.002, BC[1] + 0.016, -0.072), (BC[0] - 0.002, BC[1] + 0.016, 0.072)], 0.034, 0.03, G_red, 'front', e=4.0, ring=16)
    for s in (-1, 1):
        # grip, flange and end
        tube('grip%d' % s, [bar(s * 0.288), bar(s * 0.40)], 0.0168, M_grip, 'front', seg=14)
        tube('gripflange%d' % s, [bar(s * 0.281), bar(s * 0.288)], 0.0215, M_grip, 'front', seg=14)
        tube('barend%d' % s, [bar(s * 0.40), (bar(s * 0.40)[0] - 0.003, bar(s * 0.40)[1], s * 0.408)], 0.0155, M_dark, 'front', seg=12)
        # lever perch with its pivot and a short lever that follows the sweep of the bar
        g = bar(s * 0.245)
        tube('perch%d' % s, [bar(s * 0.232), bar(s * 0.257)], 0.0185, X_cast, 'front', seg=12)
        rod('perchbody%d' % s, (g[0] + 0.012, g[1] - 0.004, s * 0.245), (g[0] + 0.072, g[1] - 0.014, s * 0.242), [0.0125, 0.0115, 0.0105], X_cast, 'front', seg=12)
        piv = (g[0] + 0.058, g[1] - 0.012, s * 0.247)
        cyl('leverpivot%d' % s, 0.0075, 0.022, piv, X_steel, 'front', axis='y', seg=10, bevel=0.001)
        LV = [(bar(s * z)[0] + f, bar(s * z)[1] - 0.013, s * z) for (z, f) in ((0.234, 0.05), (0.262, 0.068), (0.315, 0.063), (0.362, 0.052), (0.388, 0.043))]
        sweep('lever%d' % s, LV, [0.006, 0.0055, 0.0045, 0.004, 0.0045], [0.0085, 0.0075, 0.006, 0.0052, 0.0065], X_alu, 'front', e=3.0, ring=8, smooth=4)
        cyl('leverball%d' % s, 0.007, 0.012, LV[-1], X_alu, 'front', axis='y', seg=10, bevel=0.003)
        # hand guard: a red shield in front of lever and hand, on an arm clamped to the bar
        rows = [[(bar(s * z)[0] + f + b * t, bar(s * z)[1] - 0.006 + dy * t, s * z) for (z, f, t) in ((0.212, 0.07, 0.8), (0.27, 0.09, 1.0), (0.345, 0.088, 0.95), (0.412, 0.056, 0.6))] for (dy, b) in ((0.04, -0.03), (0.026, -0.004), (0.0, 0.006), (-0.028, -0.004), (-0.044, -0.03))]
        panel('handguard%d' % s, tight(rows, 0.2), 0.004, G_red, 'front')
        tube('guardarm%d' % s, [bar(s * 0.185), (bar(s * 0.19)[0] + 0.04, bar(s * 0.19)[1] - 0.004, s * 0.192), (bar(s * 0.215)[0] + 0.076, bar(s * 0.215)[1] - 0.004, s * 0.215)], 0.0065, M_dark, 'front', seg=8, smooth=4)
        tube('guardclamp%d' % s, [bar(s * 0.176), bar(s * 0.194)], 0.0165, M_dark, 'front', seg=12)
    mr, ml = bar(0.245), bar(-0.245)
    # right: front brake master cylinder with its fluid reservoir, throttle housing. Left: cable clutch with its adjuster, kill switch.
    box('brakeresv', (0.044, 0.028, 0.036), (mr[0] + 0.038, mr[1] + 0.02, 0.243), X_cast, 'front', bevel=0.005)
    box('brakeresv_cap', (0.047, 0.007, 0.039), (mr[0] + 0.038, mr[1] + 0.037, 0.243), M_dark, 'front', bevel=0.002)
    tube('throttle', [bar(0.262), bar(0.281)], 0.021, M_dark, 'front', seg=12)
    rod('throttle_out', (bar(0.27)[0] + 0.012, bar(0.27)[1] - 0.016, 0.27), (bar(0.27)[0] + 0.042, bar(0.27)[1] - 0.03, 0.262), 0.0065, M_dark, 'front', seg=8)
    tube('killswitch', [bar(-0.262), bar(-0.277)], 0.019, M_dark, 'front', seg=12)
    cyl('killbutton', 0.006, 0.008, (bar(-0.27)[0] - 0.012, bar(-0.27)[1] + 0.017, -0.27), G_red, 'front', axis='y', seg=10, bevel=0.002)
    rod('clutchadj', (ml[0] + 0.058, ml[1] - 0.013, -0.228), (ml[0] + 0.074, ml[1] - 0.017, -0.196), [0.0085, 0.0085, 0.005], X_steel, 'front', seg=10)
    # ---- lines on the bars. Brake: braided line from the master cylinder down behind the number plate to a guide on the lower clamp, then down the
    # back of the left leg to the caliper (that last piece has to flex with the fork: a stand-in here, the game draws it).
    G0 = fwd(fp(0.585), 0.052, -0.055)
    hose('brakeline', [(mr[0] + 0.074, mr[1] - 0.016, 0.24), (BC[0] + 0.125, BC[1] - 0.03, 0.14), fwd(fp(0.80), 0.036, 0.03), fwd(fp(0.68), 0.04, -0.04), G0], 0.0046, X_chain, 'front', fit=X_alu)
    box('brakeguide', (0.014, 0.022, 0.018), G0, M_dark, 'front', rot=(0, 0, RAKE), bevel=0.003)
    HP = [G0, fwd(fp(0.46), 0.02, -0.06), fwd(fp(0.36), -0.04, -0.084), fwd(fp(0.2), -0.052, -0.092), pol(F, 0.19, math.radians(158), -0.09)]
    tube('brakeleg', HP, 0.0045, X_chain, 'front', seg=8, smooth=6)['noexport'] = 1
    d = Vector(HP[-2]) - Vector(HP[-1]); d.normalize(); rod('brakeleg_fit', tuple(Vector(HP[-1]) - d * 0.004), tuple(Vector(HP[-1]) + d * 0.018), 0.0078, X_alu, 'fork', seg=8)
    HOSES.append([list(q) for q in HP])
    # clutch cable and throttle cable: in a bow over the clamps, behind the number plate and past the steering head into the frame
    JL, JR = fwd(sp(0.70), 0.046, -0.03), fwd(sp(0.70), 0.046, 0.032)
    hose('clutchcable_a', [(ml[0] + 0.074, ml[1] - 0.017, -0.196), (BC[0] + 0.13, BC[1] - 0.02, -0.11), fwd(fp(0.82), 0.04, -0.045), JL], 0.0038, M_line, 'front')
    hose('throttlecable_a', [(bar(0.27)[0] + 0.042, bar(0.27)[1] - 0.03, 0.262), (BC[0] + 0.12, BC[1] - 0.045, 0.15), fwd(fp(0.80), 0.04, 0.06), JR], 0.0036, M_line, 'front')
    # ---- lines round the engine
    if 'engine' in STAGES:
        # clutch cable down the right of the frame to the release arm on top of the clutch cover; throttle cable to the throttle body
        hose('clutchcable_b', [(0.405, 0.905, 0.04), (0.33, 0.83, 0.07), (0.22, 0.70, 0.088), (0.11, 0.585, 0.096), (0.045, 0.535, 0.1)], 0.0038, M_line, 'body')
        rod('clutcharm', (0.03, 0.522, 0.1), (0.052, 0.54, 0.1), 0.006, X_steel, 'body', seg=8); cyl('clutcharm_boss', 0.011, 0.014, (0.03, 0.522, 0.098), X_cast, 'body', seg=10, bevel=0.002)
        tb = ept(0.285, -0.12, 0.034)
        hose('throttlecable_b', [(0.40, 0.915, 0.035), (0.30, 0.88, 0.06), (0.15, 0.83, 0.06), (tb[0] + 0.02, tb[1] + 0.03, 0.045), tb], 0.0036, M_line, 'body')
        cyl('throttlepulley', 0.017, 0.012, tb, X_dark, 'body', seg=14, bevel=0.002)
        # ignition coil on the left spar, the wiring loom along the spar and down to the generator cover
        box('coil', (0.05, 0.03, 0.026), (-0.02, 0.80, 0.07), M_dark, 'body', rot=(0, 0, 0.55), bevel=0.006)
        tube('loom', [(0.30, 0.955, -0.05), (0.19, 0.905, -0.085), (0.06, 0.845, -0.108), (-0.04, 0.775, -0.108), (-0.10, 0.70, -0.102)], 0.0065, M_line, 'body', seg=8, smooth=5)
        tube('loom_gen', [(-0.04, 0.775, -0.108), (-0.03, 0.66, -0.098), (0.0, 0.56, -0.094), (0.05, 0.49, -0.1)], 0.005, M_line, 'body', seg=8, smooth=5)
        for k, q in enumerate(((0.19, 0.905, -0.085), (0.06, 0.845, -0.108), (-0.04, 0.775, -0.108))): cyl('loomtie%d' % k, 0.0085, 0.005, q, X_steel, 'body', axis='x', seg=8, bevel=0)
        # breather from the cam cover, dropping behind the cylinder to under the engine; fuel line from the tank to the injector
        tube('breather', [ept(0.33, -0.045, 0.035), ept(0.35, -0.085, 0.05), ept(0.26, -0.125, 0.075), ept(0.08, -0.13, 0.085), ept(-0.06, -0.10, 0.08)], 0.006, M_rubber, 'body', seg=8, smooth=6)
        inj = ept(0.345, -0.137)
        hose('fuelline', [(0.03, 0.795, 0.02), (0.0, 0.775, 0.03), (inj[0] - 0.012, inj[1] + 0.03, 0.02), inj], 0.0052, M_line, 'body', fit=X_alu)
        # radiator overflow from the filler neck down the front of the down tube
        rc = rpt((0.318, 0.75, 0.108), 0.0, 0.14)
        tube('overflow', [(rc[0] + 0.012, rc[1] - 0.004, rc[2]), (rc[0] + 0.03, rc[1] - 0.05, rc[2] - 0.01), (0.37, 0.62, 0.06), (0.345, 0.46, 0.04), (0.31, 0.33, 0.035)], 0.0042, M_rubber, 'body', seg=6, smooth=5)
    # tank breather: the short hose from the filler cap, tucked into the steering stem
    tube('tankvent', [(0.222, 0.98, 0.0), (0.235, 1.01, 0.0), (0.275, 1.04, 0.004), (0.315, 1.055, 0.004)], 0.0038, M_rubber if 'engine' in STAGES else M_line, 'body', seg=6, smooth=5)
    # ---- footrests: a bracket under each pivot plate carries a toothed peg; brake pedal with its master cylinder on the right, gear lever on the left
    PEG = (-0.205, 0.325)
    for s in (-1, 1):
        plate('pegbracket%d' % s, hull(circ(-0.14, 0.372, 0.02, 12) + circ(PEG[0], PEG[1] + 0.004, 0.017, 12)), 0.008, FRAME, 'body', off=s * 0.106, bevel=0.002)
        box('peg%d' % s, (0.052, 0.014, 0.078), (PEG[0], PEG[1], s * 0.158), X_steel, 'body', bevel=0.003)
        many('pegteeth%d' % s, X_steel, 'body', lambda bm: [bm_tube(bm, (PEG[0] + dx, PEG[1] + 0.006, s * 0.122), (PEG[0] + dx, PEG[1] + 0.006, s * 0.196), 0.0038, 5) for dx in (-0.021, -0.007, 0.007, 0.021)], 40)
        cyl('pegpin%d' % s, 0.006, 0.03, (PEG[0], PEG[1] - 0.002, s * 0.115), X_steel, 'body', seg=8, bevel=0)
    # brake pedal: pivots under the peg, runs forward along the clutch cover to a toe piece
    sweep('brakepedal', [(PEG[0] + 0.012, PEG[1] - 0.024, 0.118), (-0.13, 0.305, 0.124), (-0.075, 0.322, 0.14), (-0.06, 0.33, 0.15)], 0.0045, [0.011, 0.009, 0.008, 0.008], X_alu, 'body', e=3.0, ring=8, smooth=4)
    box('braketoe', (0.028, 0.012, 0.036), (-0.058, 0.333, 0.166), X_steel, 'body', bevel=0.003)
    rod('rmaster', (-0.205, 0.395, 0.118), (-0.212, 0.468, 0.118), [0.0115, 0.011, 0.0095], X_cast, 'body', seg=12)
    rod('rmaster_rod', (PEG[0] + 0.004, PEG[1] - 0.012, 0.118), (-0.205, 0.395, 0.118), 0.004, X_steel, 'body', seg=6)
    cyl('rresv', 0.014, 0.03, (-0.2135, 0.486, 0.118), mat('M_smresv', 'd9d6c8'), 'body', axis='y', seg=14, bevel=0.003); cyl('rresv_cap', 0.0155, 0.008, (-0.2135, 0.505, 0.118), M_dark, 'body', axis='y', seg=14, bevel=0.002)
    # rear brake line: from the master cylinder along the top of the right arm to the caliper (it starts next to the pivot, so it can ride on the arm)
    rcal = pol(A, 0.104, math.radians(200), 0.093)
    hose('rbrakeline', [(-0.222, 0.455, 0.118), (-0.255, 0.47, 0.124), (-0.38, 0.452, 0.128), (-0.56, 0.41, 0.124), (-0.72, 0.372, 0.108), (rcal[0] + 0.012, rcal[1] + 0.04, 0.1), (rcal[0], rcal[1] + 0.022, 0.097)], 0.0042, X_chain, 'swing', fit=X_alu)
    for k, q in enumerate(((-0.38, 0.452, 0.128), (-0.56, 0.41, 0.124))): box('rbrakeclip%d' % k, (0.014, 0.012, 0.014), q, M_dark, 'swing', bevel=0.003)
    # gear lever: from the shaft on the left of the gearbox back to a folding tip ahead of the peg
    sweep('gearlever', [(0.03, 0.352, -0.108), (-0.015, 0.344, -0.122), (-0.062, 0.338, -0.132)], 0.0045, [0.011, 0.008, 0.007], X_alu, 'body', e=3.0, ring=8, smooth=4)
    cyl('gearshaft', 0.011, 0.016, (0.03, 0.352, -0.106), X_steel, 'body', seg=10, bevel=0.002)
    rod('geartip', (-0.062, 0.338, -0.13), (-0.062, 0.338, -0.172), 0.0085, M_grip, 'body', seg=10)

res = {k: sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in L) for k, L in ASM.items() if L}

# ------------------------------------------------------------------ preview shots (workbench: quick, clean, shows the form)
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
    C = V(0, 0.56, 0)
    DIRS = {'side': ((0, 0.0, 1), 0), 'sideL': ((0, 0.0, -1), 0), 'front': ((1, 0.03, 0), 0), 'rear': ((-1, 0.05, 0), 0), 'top': ((0.001, 1, 0), 0),
            'q1': ((0.8, 0.32, 1), 1), 'q2': ((0.8, 0.32, -1), 1), 'low': ((0.5, -0.12, 1), 1), 'q3': ((-0.85, 0.36, 1), 1), 'q4': ((-0.85, 0.36, -1), 1)}
    CLOSE = {'head': ((1.35, 1.3, 0.85), (0.36, 0.9, 0.0), 75), 'pivot': ((-0.5, 0.75, -1.5), (-0.2, 0.47, 0.0), 80), 'pivotR': ((-0.5, 0.75, 1.5), (-0.2, 0.47, 0.0), 80),
             'wheelF': ((1.75, 0.6, -1.0), (0.73, 0.32, 0.0), 85), 'wheelR': ((-1.8, 0.65, -1.0), (-0.72, 0.33, 0.0), 85), 'link': ((-0.9, 0.12, -1.0), (-0.22, 0.38, 0.0), 80), 'bay': ((0.75, 0.75, 1.55), (0.1, 0.52, 0.0), 75), 'bayL': ((0.75, 0.75, -1.55), (0.1, 0.52, 0.0), 75), 'pipe': ((-1.7, 1.1, 1.3), (-0.4, 0.72, 0.1), 75), 'front34': ((1.6, 0.9, 0.9), (0.2, 0.6, 0.0), 60),
             'bars': ((1.25, 1.55, 0.75), (0.3, 1.12, 0.0), 70), 'cock': ((-0.55, 1.6, 0.25), (0.3, 1.1, 0.0), 50), 'pegR': ((-0.25, 0.62, 1.3), (-0.15, 0.42, 0.0), 80), 'pegL': ((-0.25, 0.62, -1.3), (-0.15, 0.42, 0.0), 80)}
    for v in SHOTS:
        d, persp = DIRS.get(v, ((1, 0.3, 1), 1)); dv = V(*d).normalized(); ortho = not persp
        cam.data.type = 'ORTHO' if ortho else 'PERSP'; cam.data.ortho_scale = 2.5; cam.data.lens = 200
        cam.location = C + dv * (20 if ortho else 15.5)
        cam.rotation_euler = (C - cam.location).to_track_quat('-Z', 'Y').to_euler()
        if v == 'top': cam.location = C + Vector((0, 0, 20)); cam.rotation_euler = (0, 0, 0)
        if v in ('front', 'rear'): cam.data.ortho_scale = 1.6
        if v in CLOSE: eye, tgt, lens = CLOSE[v]; cam.data.type = 'PERSP'; cam.data.lens = lens; cam.location = V(*eye); cam.rotation_euler = (V(*tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = OUT + 'renders/' + PREFIX + '_' + v + '.png'; bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
result = res
