"""APEX supermoto (working title MOTARD 450) - a 450 cc single-cylinder supermoto of our own design, built frame-first in stages
like the Duetto, so that every step can be checked on its own. No real make's bodywork, colours or lettering are copied.

  STAGES   list of stages to build: 'chassis' (frame, subframe, swingarm with linkage, shock, fork, wire wheels, brakes)
           -> 'engine' -> 'body' -> 'controls'   (only 'chassis' exists so far)
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
G_rim = mat('G_smrim', '1b1d22'); M_hub = mat('M_smhub', '17181b'); X_spoke = mat('X_smspoke', 'c9ccd0'); M_cal = mat('M_smcaliper', '25272b'); M_spring = mat('M_smspring', 'e9eaec')
X_shock = mat('X_smshock', '8e9299'); X_sprocket = mat('X_smsprocket', '3b3e44'); X_chain = mat('X_chain', '55585e')

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
        tube('sub_top%d' % s, [(-0.03, 0.805, s * 0.10), (-0.25, 0.852, s * 0.10), (-0.50, 0.902, s * 0.086), (-0.705, 0.937, s * 0.06)], 0.0115, FRAME, 'body', seg=12, smooth=5)
        tube('sub_strut%d' % s, [(-0.142, 0.59, s * 0.097), (-0.33, 0.745, s * 0.10), (-0.50, 0.90, s * 0.086)], 0.0115, FRAME, 'body', seg=12, smooth=5)
        for (bx, by) in ((-0.03, 0.805), (-0.142, 0.59)): cyl('sub_bolt%d_%.2f' % (s, by), 0.0105, 0.01, (bx, by, s * 0.113), X_steel, 'body', seg=6, bevel=0.002)
    tube('sub_loop', [(-0.705, 0.937, -0.06), (-0.738, 0.942, -0.032), (-0.745, 0.943, 0.0), (-0.738, 0.942, 0.032), (-0.705, 0.937, 0.06)], 0.0115, FRAME, 'body', seg=12, smooth=5)
    rod('sub_x', (-0.33, 0.87, -0.096), (-0.33, 0.87, 0.096), 0.009, FRAME, 'body', seg=10)

    # ---- swingarm: cast aluminium, left raw. Deep in the middle, slim at the axle; a bridge ahead of the tyre
    for s in (-1, 1):
        sweep('arm%d' % s, [(PIV[0] + 0.006, PIV[1], s * 0.128), (-0.30, 0.428, s * 0.131), (-0.52, 0.378, s * 0.137), (-0.70, 0.328, s * 0.137), (-0.782, 0.312, s * 0.137)],
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

    # ---- fork: long-travel upside-down. Black outer tubes in two machined clamps, chrome stanchions, cast axle lugs
    for s in (-1, 1):
        z = s * FZ
        tube('forkO%d' % s, [fp(0.50, z), fp(0.535, z), fp(0.575, z), fp(0.905, z)], [0.0335, 0.0335, 0.0298, 0.0298], X_dark, 'front', seg=22)
        rod('forkseal%d' % s, fp(0.49, z), fp(0.502, z), 0.031, M_dark, 'front', seg=22)
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
            cutplate(asm + '_carrier', star, [circ(cx, cy, rc0 - 0.01, 28)], 0.0055, M_hub, asm, off=z + math.copysign(0.0045, -z))
            many(asm + '_buttons', X_alu, asm, lambda bm: [bm_tube(bm, pol(c2, ri + 0.002, k / nb * 6.2832, z - 0.005), pol(c2, ri + 0.002, k / nb * 6.2832, z + 0.005), 0.0062, 8) for k in range(nb)], 50)
            lathe(asm + '_dcone', [(0.03, math.copysign(hh + 0.004, z)), (rc0 - 0.008, z + math.copysign(0.004, -z)), (rc0 - 0.008, z + math.copysign(0.009, -z)), (0.03, math.copysign(hh - 0.002, z))], M_hub, asm, 28, c, 40)
        if sprocket:
            z, nt, rp = sprocket; teeth = [pol(c2, rp + (0.0052 if k % 2 else -0.0035), k / (2 * nt) * 6.2832)[:2] for k in range(2 * nt)]
            cutplate(asm + '_sprocket', teeth, [circ(cx, cy, 0.058, 28)] + [circ(*pol(c2, 0.088, (k + 0.5) / 8 * 6.2832)[:2], 0.011, 10) for k in range(8)], 0.007, X_sprocket, asm, off=z)
            lathe(asm + '_scone', [(0.03, math.copysign(hh + 0.004, z)), (0.066, z + math.copysign(0.005, -z)), (0.066, z + math.copysign(0.01, -z)), (0.03, math.copysign(hh - 0.002, z))], M_hub, asm, 28, c, 40)
            many(asm + '_spb', X_steel, asm, lambda bm: [bm_tube(bm, pol(c2, 0.063, k / 6 * 6.2832, z - 0.006), pol(c2, 0.063, k / 6 * 6.2832, z + 0.006), 0.0055, 6) for k in range(6)], 40)
    wheel('wheelF', RF, WF, RIMF, 0.046, F, 0.034, 0.041, disc=(0.155, 0.122, -0.07, 6))
    wheel('wheelR', RR, WR, RIMR, 0.066, A, 0.05, 0.047, disc=(0.11, 0.084, 0.085, 4), sprocket=(-0.092, 48, 0.121))

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
             'wheelF': ((1.75, 0.6, -1.0), (0.73, 0.32, 0.0), 85), 'wheelR': ((-1.8, 0.65, -1.0), (-0.72, 0.33, 0.0), 85), 'link': ((-0.9, 0.12, -1.0), (-0.22, 0.38, 0.0), 80)}
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
