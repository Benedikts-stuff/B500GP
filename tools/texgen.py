"""APEX pass texture set: tileable albedo + normal maps and the dry-stone wall tile.
Everything is periodic so textures tile without seams.  Writes previews to tex/ and assets/pack_pass.js."""
import numpy as np, json, base64, io, os, sys
from scipy import ndimage
from scipy.spatial import cKDTree, Voronoi
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tex'); os.makedirs(OUT, exist_ok=True)
R = np.random.default_rng


# ------------------------------------------------------------------ periodic primitives
def vnoise(N, f, seed, M=None):
    """periodic value noise, f cells across, bicubic"""
    M = M or N
    g = R(seed).random((f if M == N else max(1, round(f * M / N)), f))
    z = ndimage.zoom(g, (M / g.shape[0], N / g.shape[1]), order=3, mode='grid-wrap', grid_mode=True)
    return z[:M, :N]

def fbm(N, f0, octaves, seed, gain=0.5, M=None):
    acc = 0; amp = 1; tot = 0
    for o in range(octaves):
        acc = acc + vnoise(N, f0 * 2 ** o, seed + o * 17, M) * amp; tot += amp; amp *= gain
    return acc / tot

def norm01(a, lo=1, hi=99):
    p0, p1 = np.percentile(a, [lo, hi]); return np.clip((a - p0) / (p1 - p0 + 1e-9), 0, 1)

def voronoi(N, pts, M=None, aspect=1.0):
    """periodic Voronoi on [0,1)^2 -> F1, F2 (in units of the x-axis), cell id.  aspect = height/width of the tile."""
    M = M or N
    off = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    P = np.concatenate([pts + np.array(o) for o in off]); ids = np.tile(np.arange(len(pts)), 9)
    P2 = P.copy(); P2[:, 1] *= aspect
    tree = cKDTree(P2)
    yy, xx = np.mgrid[0:M, 0:N]; q = np.stack([(xx + 0.5) / N, (yy + 0.5) / M * aspect], -1).reshape(-1, 2)
    d, k = tree.query(q, k=2)
    return d[:, 0].reshape(M, N), d[:, 1].reshape(M, N), ids[k[:, 0]].reshape(M, N)

def warp(a, dx, dy):
    M, N = a.shape; yy, xx = np.mgrid[0:M, 0:N].astype(np.float32)
    return ndimage.map_coordinates(a, [yy + dy, xx + dx], order=1, mode='grid-wrap')

def blur(a, s): return ndimage.gaussian_filter(a, s, mode='wrap')

def normal_map(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)          # OpenGL convention (green = +v, image rows go down)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5)

def cavity(h, s, k):
    """ambient-occlusion-ish term from height: dark where the surface sits below its neighbourhood"""
    return np.clip(1 - np.maximum(blur(h, s) - h, 0) * k, 0, 1)

def to_img(a):
    a = np.clip(a, 0, 1); a = (a * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(a)

def save(name, alb, nrm):
    to_img(alb).save(f'{OUT}/{name}_a.png'); to_img(nrm).save(f'{OUT}/{name}_n.png')

def srgb(c): return np.array(c, np.float32) / 255.0

def lerp(a, b, t): t = t[..., None] if np.ndim(t) == 2 and np.ndim(a) == 3 or (np.ndim(t) == 2 and np.ndim(b) >= 1 and np.shape(b)[-1:] == (3,)) else t; return a + (b - a) * t

def L3(t): return t[..., None]


# ------------------------------------------------------------------ rock: faceted, layered alpine rock
def rock(N=1024, seed=3):
    """stratified limestone: horizontal beds of varying thickness, cut by vertical joints into blocks.
    texture v = world up on cliff faces (triplanar side projections)."""
    rng = R(seed)
    yy, xx = np.mgrid[0:N, 0:N] / N
    wx = (fbm(N, 3, 5, seed + 1) - 0.5) * 0.10; wy = (fbm(N, 3, 5, seed + 2) - 0.5) * 0.06
    u = (xx + wx) % 1; v = (yy + wy + (fbm(N, 2, 3, seed + 8) - 0.5) * 0.08) % 1
    nb = 9; th = rng.uniform(0.5, 1.6, nb); th /= th.sum(); edges = np.concatenate([[0], np.cumsum(th)])
    row = np.clip(np.searchsorted(edges, v, side='right') - 1, 0, nb - 1)
    f = (v - edges[row]) / th[row]                         # 0 at the bottom of a bed, 1 at the top
    # vertical joints per bed
    joints = [np.sort(rng.random(rng.integers(2, 6))) for _ in range(nb)]
    jd = np.full((N, N), 1.0); seg = np.zeros((N, N), int)
    for r in range(nb):
        m = row == r; J = joints[r]; uu = u[m]
        d = np.abs(((uu[:, None] - J[None, :]) + 0.5) % 1 - 0.5); jd[m] = d.min(1)
        seg[m] = np.searchsorted(J, uu) % len(J) + r * 8
    bid = seg
    nbk = bid.max() + 1; A = rng.normal(0, 1, nbk); B = rng.normal(0, 1, nbk); C = rng.random(nbk); T = rng.random(nbk)
    plane = C[bid] * 0.4 + A[bid] * (u - 0.5) * 0.25 + B[bid] * (f - 0.5) * 0.35
    ledge = np.clip(f * 6, 0, 1) * 0.6 + f * 0.25          # each bed sticks out a bit at the bottom shadow line
    jw = 0.006 + 0.01 * norm01(fbm(N, 6, 3, seed + 3))
    joint = np.clip(jd / jw, 0, 1) ** 0.7
    jfade = np.clip((norm01(fbm(N, 5, 3, seed + 4)) - 0.2) * 3, 0, 1)
    joint = 1 - (1 - joint) * jfade
    det = fbm(N, 14, 5, seed + 9); det2 = fbm(N, 48, 3, seed + 10)
    h = plane + ledge * 0.6 + det * 0.45 + det2 * 0.15
    h = h - (1 - joint) * 0.5
    ao = cavity(h, 6, 2.2) * (0.6 + 0.4 * joint)
    base = srgb([118, 115, 110]); warm = srgb([138, 124, 104]); cool = srgb([94, 98, 104])
    tone = T[bid]
    col = base + (warm - base) * L3(np.clip(tone - 0.6, 0, 1) * 2.5) + (cool - base) * L3(np.clip(0.4 - tone, 0, 1) * 2.5)
    rowtone = rng.random(nb)[row]
    col = col * L3(0.9 + rowtone * 0.16) * L3(0.84 + det * 0.3)
    top = np.clip((f - 0.86) * 9, 0, 1); col = col + (srgb([206, 202, 192]) - col) * L3(top * 0.5)   # sunlit bed tops
    col = col * L3(1 - np.clip((0.1 - f) * 8, 0, 1) * 0.35)                                       # shadow under the ledge
    streak = norm01(vnoise(N, 40, seed + 12, None) * 0.5 + fbm(N, 3, 2, seed + 13) * 0.5)
    stk = np.clip((ndimage.zoom(R(seed + 14).random((1, 64)), (N, N / 64), order=1, mode='grid-wrap') - 0.7) * 3, 0, 1) * np.clip(1 - f, 0, 1)
    col = col * L3(1 - stk * 0.25)                                                               # rain streaks
    li = norm01(fbm(N, 8, 4, seed + 31)); lm = np.clip((li - 0.8) * 7, 0, 1) * joint
    col = col + (srgb([150, 156, 96]) - col) * L3(lm * 0.55)
    sp = (R(seed + 40).random((N, N)) > 0.9988).astype(np.float32); sp = np.clip(blur(sp, 0.9) * 8, 0, 1)
    col = col + (srgb([214, 150, 70]) - col) * L3(sp * 0.6)
    col = col * L3(ao)
    nrm = normal_map(h, 30)
    return col, nrm


# ------------------------------------------------------------------ meadow: tufty alpine grass
def meadow(N=1024, seed=11):
    rng = R(seed)
    big = norm01(fbm(N, 3, 3, seed)); mid = norm01(fbm(N, 10, 3, seed + 1)); fine = fbm(N, 64, 3, seed + 2, 0.6)
    pts = rng.random((2200, 2)); F1, F2, ID = voronoi(N, pts)
    tuft = np.clip(1 - F1 / 0.016, 0, 1) ** 0.8          # domes of grass clumps
    blade = norm01(vnoise(N, 300, seed + 3) * 0.6 + vnoise(N, 150, seed + 4) * 0.4)
    h = tuft * 0.6 + blade * 0.45 + mid * 0.3
    ao = cavity(h, 2.5, 2.4)
    tone = rng.random(len(pts))[ID]
    c_dark = srgb([44, 82, 38]); c_mid = srgb([70, 114, 50]); c_lt = srgb([104, 138, 60]); c_dry = srgb([132, 136, 82])
    col = c_mid + (c_dark - c_mid) * L3(np.clip(0.5 - big, 0, 1) * 1.4) + (c_lt - c_mid) * L3(np.clip(big - 0.55, 0, 1) * 1.6)
    col = col + (c_dry - col) * L3(np.clip(mid - 0.72, 0, 1) * 2.0)
    col = col * L3(0.86 + tone * 0.18) * L3(0.8 + blade * 0.32) * L3(0.75 + tuft * 0.3)
    col = col * L3(ao)
    # tiny flowers: white, yellow, violet
    fl = rng.random((N, N))
    for thr, cc in ((0.99955, [244, 242, 230]), (0.99965, [246, 206, 64]), (0.99985, [170, 130, 220])):
        m = (fl > thr).astype(np.float32); fl = np.where(fl > thr, 0, fl)
        m = np.clip(blur(m, 0.8) * 6, 0, 1)
        col = col + (srgb(cc) - col) * L3(m)
        h = h + m * 0.4
    nrm = normal_map(h, 10)
    return col, nrm


# ------------------------------------------------------------------ pebbles (scree / shoulder gravel)
def pebbles(N, n, seed, pal, gap=0.6, dust=None, strength=14, grassy=0.0):
    rng = R(seed); pts = rng.random((n, 2)); F1, F2, ID = voronoi(N, pts)
    cell = 1 / np.sqrt(n)
    e = np.clip((F2 - F1) / (cell * 0.35), 0, 1)
    dome = np.sqrt(e) * (0.5 + 0.5 * rng.random(n)[ID])
    h = dome + fbm(N, 32, 3, seed + 5) * 0.25
    tone = rng.random(n)[ID]; pick = (rng.random(n) * len(pal)).astype(int)[ID]
    P = np.array([srgb(p) for p in pal]); col = P[pick] * L3(0.82 + tone * 0.3)
    col = col * L3(0.8 + fbm(N, 24, 3, seed + 7) * 0.35)
    gapc = srgb(dust or [70, 66, 60])
    col = col + (gapc - col) * L3(np.clip(1 - e / gap, 0, 1))
    if grassy:
        gm = np.clip((norm01(fbm(N, 6, 4, seed + 9)) - (1 - grassy)) * 5, 0, 1) * np.clip(1 - e * 1.5, 0, 1)
        col = col + (srgb([80, 112, 48]) - col) * L3(gm)
    col = col * L3(cavity(h, 3, 2.0))
    return col, normal_map(h, strength)


# ------------------------------------------------------------------ asphalt
def asphalt(N=1024, seed=21):
    rng = R(seed)
    base = srgb([74, 74, 77])
    big = fbm(N, 4, 4, seed); mid = fbm(N, 24, 3, seed + 1)
    sp = rng.random((N, N)); agg = blur((sp > 0.82).astype(np.float32), 0.7)
    stones = rng.random((N, N)); light = np.clip(blur((stones > 0.9935).astype(np.float32), 1.0) * 5, 0, 1)
    h = agg * 0.6 + light * 0.8 + mid * 0.3
    col = base * L3(0.84 + big * 0.28) * L3(0.9 + mid * 0.18)
    col = col * L3(0.86 + agg * 0.22)
    col = col + (srgb([150, 146, 140]) - col) * L3(light * 0.55)
    # faint sealed cracks
    pts = rng.random((26, 2)); F1, F2, _ = voronoi(N, pts)
    wx = (fbm(N, 8, 3, seed + 3) - 0.5) * 40; e = warp(F2 - F1, wx, wx * 0.7)
    cr = np.clip(1 - e / 0.0022, 0, 1) * (norm01(fbm(N, 5, 3, seed + 4)) > 0.55)
    col = col + (srgb([38, 38, 40]) - col) * L3(cr * 0.7)
    h = h - cr * 0.4
    col = col * L3(cavity(h, 1.5, 1.2))
    return col, normal_map(h, 6)


# ------------------------------------------------------------------ granite for the 3D wall stones
def granite(N=512, seed=31):
    rng = R(seed)
    n1 = fbm(N, 6, 5, seed); n2 = fbm(N, 40, 3, seed + 1)
    sp = rng.random((N, N)); dk = blur((sp > 0.94).astype(np.float32), 0.6); lt = blur((sp < 0.05).astype(np.float32), 0.6)
    v = 0.8 + (n1 - 0.5) * 0.18 + (n2 - 0.5) * 0.12 - dk * 0.3 + lt * 0.2
    col = np.stack([v, v * 0.985, v * 0.96], -1)
    li = norm01(fbm(N, 7, 4, seed + 5)); lm = np.clip((li - 0.8) * 6, 0, 1)
    col = col + (srgb([176, 182, 120]) - col) * L3(lm * 0.5)
    h = n1 * 0.6 + n2 * 0.4 - dk * 0.2
    return col, normal_map(h, 10)


# ------------------------------------------------------------------ dry-stone wall tile (geometry + texture)
TW, TH = 3.2, 1.6   # metres per tile

def clip_halfplane(poly, p, n, d):
    """keep points x with dot(x - p, n) >= d"""
    out = []
    for i in range(len(poly)):
        a = poly[i]; b = poly[(i + 1) % len(poly)]
        da = np.dot(a - p, n) - d; db = np.dot(b - p, n) - d
        if da >= 0: out.append(a)
        if (da >= 0) != (db >= 0): out.append(a + (b - a) * (da / (da - db)))
    return out

def inset(poly, g):
    poly = [np.array(v, float) for v in poly]
    cen = np.mean(poly, 0); res = poly
    for i in range(len(poly)):
        a = poly[i]; b = poly[(i + 1) % len(poly)]; e = b - a; n = np.array([-e[1], e[0]]); n /= np.linalg.norm(n) + 1e-12
        if np.dot(cen - a, n) < 0: n = -n
        res = clip_halfplane(res, a, n, g)
        if len(res) < 3: return None
    return res

def simplify(poly, minlen):
    poly = [np.array(v) for v in poly]
    changed = True
    while changed and len(poly) > 4:
        changed = False
        for i in range(len(poly)):
            a = poly[i]; b = poly[(i + 1) % len(poly)]
            if np.linalg.norm(b - a) < minlen:
                poly[i] = (a + b) / 2; del poly[(i + 1) % len(poly)]; changed = True; break
    return poly

def wall_tile(seed=7):
    rng = R(seed)
    # courses of stones: jittered rows -> anisotropic, wider-than-tall cells, mixed sizes like a real dry-stone wall
    pts = []
    rows = 5; y = 0
    hs = rng.uniform(0.6, 1.4, rows); hs = hs / hs.sum() * TH
    for r in range(rows):
        yc = y + hs[r] / 2; x = rng.random() * 0.3
        while x < TW - 0.05:
            wdt = rng.uniform(0.3, 0.85) * (hs[r] / (TH / rows)) ** 0.5
            if rng.random() < 0.15: wdt *= 0.55                 # small filler stones
            pts.append([(x + wdt / 2) % TW, yc + rng.normal(0, hs[r] * 0.12)])
            x += wdt
        y += hs[r]
    pts = np.array(pts); n = len(pts)
    # periodic Voronoi in metric space
    offs = [(i * TW, j * TH) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    P = np.concatenate([pts + np.array(o) for o in offs])
    vor = Voronoi(P)
    stones = []
    for k in range(n):
        reg = vor.regions[vor.point_region[4 * n + k]]   # (0,0) copy is index 4
        if -1 in reg or len(reg) < 3: continue
        poly = [vor.vertices[v] for v in reg]
        poly = simplify(poly, 0.06)
        outer = inset(poly, 0.016)
        if outer is None: continue
        outer = simplify(outer, 0.03)
        ar = sum(outer[i][0] * outer[(i + 1) % len(outer)][1] - outer[(i + 1) % len(outer)][0] * outer[i][1] for i in range(len(outer)))
        if ar < 0: outer = outer[::-1]                       # counter-clockwise in (U, V)
        inner = inset(outer, 0.045)
        if inner is None or len(inner) < 3: continue
        # keep inner ring with same vertex count as outer: project each outer vertex towards centroid instead
        c = np.mean(outer, 0)
        inner = [c + (v - c) * max(0.2, 1 - 0.045 / max(np.linalg.norm(v - c), 1e-3)) for v in outer]
        area = 0.5 * abs(sum(outer[i][0] * outer[(i + 1) % len(outer)][1] - outer[(i + 1) % len(outer)][0] * outer[i][1] for i in range(len(outer))))
        protr = rng.uniform(0.05, 0.11); bulge = rng.uniform(0.015, 0.04) * min(1.5, area / 0.12)
        tone = rng.random(); kind = rng.choice(4, p=[0.45, 0.25, 0.18, 0.12])
        cols = [[150, 148, 144], [160, 152, 138], [118, 118, 118], [172, 168, 160]]
        col = np.array(cols[kind]) * (0.86 + tone * 0.24)
        stones.append(dict(o=[list(map(float, v)) for v in outer], i=[list(map(float, v)) for v in inner], c=[float(x) for x in c], p=float(protr), b=float(bulge), col=[int(x) for x in np.clip(col, 0, 255)]))
    return stones

def wall_texture(stones, NX=1024, NY=512, flat=False):
    from PIL import ImageDraw
    big = Image.new('I', (NX * 3, NY * 3), -1); dr = ImageDraw.Draw(big)
    sx, sy = NX / TW, NY / TH
    for k, s in enumerate(stones):
        for ox in (0, 1, 2):
            for oy in (0, 1, 2):
                pts = [((x + (ox - 0) * TW) * sx, (TH * 3 - (y + oy * TH)) * sy) for x, y in s['o']]
                # tile offsets: place at the centre copy (ox=1, oy=1) and its neighbours
                pts = [((x + (ox) * TW) * sx, ((3 - oy) * TH - y) * sy) for x, y in s['o']]
                dr.polygon(pts, fill=k)
    ids = np.array(big, np.int32)
    inside = ids >= 0
    dist = ndimage.distance_transform_edt(inside) / sx    # metres to the nearest joint
    ids = ids[NY:2 * NY, NX:2 * NX]; dist = dist[NY:2 * NY, NX:2 * NX]; inside = inside[NY:2 * NY, NX:2 * NX]
    P = np.array([s['p'] for s in stones]); B = np.array([s['b'] for s in stones]); C = np.array([s['col'] for s in stones]) / 255.0
    idc = np.maximum(ids, 0)
    h = np.where(inside, np.minimum(dist / 0.045, 1) * P[idc] + np.minimum(dist / 0.2, 1) ** 1.5 * B[idc], -0.03)
    g, _ = granite(NX, 33)
    gr = np.asarray(Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8)).resize((NX, NY)), np.float32) / 255
    if flat: gr = np.full_like(gr, 0.78)
    col = np.where(inside[..., None], C[idc] * gr / 0.78, srgb([58, 54, 48]))
    hh = blur(h, 0.7)
    ao = np.clip(1 - np.maximum(blur(hh, 8) - hh, 0) * 9, 0.35, 1)
    col = col * L3(ao)
    nrm = normal_map(hh * NX / TW, 2.2)
    return col, nrm


def enc(a, fmt='JPEG', q=90):
    im = to_img(a); b = io.BytesIO(); im.save(b, fmt, quality=q) if fmt == 'JPEG' else im.save(b, fmt, optimize=True)
    return f'data:image/{fmt.lower()};base64,' + base64.b64encode(b.getvalue()).decode()

if __name__ == '__main__':
    which = sys.argv[1:] or ['rock', 'meadow', 'scree', 'gravel', 'asphalt', 'granite', 'wall']
    res = {}
    if 'rock' in which: res['rock'] = rock()
    if 'meadow' in which: res['meadow'] = meadow()
    if 'scree' in which: res['scree'] = pebbles(512, 900, 51, [[126, 122, 116], [142, 136, 126], [102, 100, 98], [150, 142, 126]], strength=12)
    if 'gravel' in which: res['gravel'] = pebbles(512, 2600, 61, [[150, 144, 132], [128, 124, 116], [166, 158, 142]], dust=[112, 104, 90], strength=8, grassy=0.25)
    if 'asphalt' in which: res['asphalt'] = asphalt()
    if 'granite' in which: res['granite'] = granite()
    stones = None
    if 'wall' in which:
        stones = wall_tile(); res['wall'] = wall_texture(stones, flat=True)
        json.dump(stones, open(f'{OUT}/wall.json', 'w'))
        print('stones', len(stones), 'avg verts', np.mean([len(s['o']) for s in stones]))
    for k, (a, n) in res.items(): save(k, a, n)
    if len(which) == 7:
        pack = {'tex': {k: {'a': enc(a, 'JPEG', 88), 'n': enc(n, 'JPEG', 92)} for k, (a, n) in res.items()},
                'wall': {'w': TW, 'h': TH, 'stones': [{'o': [[round(x, 4) for x in v] for v in s['o']], 'i': [[round(x, 4) for x in v] for v in s['i']], 'c': [round(x, 4) for x in s['c']], 'p': round(s['p'], 4), 'b': round(s['b'], 4), 'col': s['col']} for s in stones]}}
        js = '/* generated by tools/texgen.py */\nwindow.APEX_PASS=' + json.dumps(pack, separators=(',', ':')) + ';\n'
        open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'pack_pass.js'), 'w').write(js)
        print('pack bytes', len(js))
