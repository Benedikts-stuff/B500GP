#!/usr/bin/env python3
"""APEX asset packer.

Takes glTF / GLB models from asset kits, shrinks their textures for the web and writes
them into assets/pack_*.js so the game can load them even when index.html is opened
straight from disk (browsers block loading model files from file:// pages).

Usage (from the Apex folder):   python3 tools/build_assets.py
Needs Python 3 with Pillow (pip install pillow).
"""
import base64, io, json, os, struct, sys
import numpy as np

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow missing: pip3 install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'src')
OUT = os.path.join(ROOT, 'assets')

NATURE = os.path.join(SRC, 'nature', 'glTF')
KENNEY = os.path.join(SRC, 'kenney', 'Models', 'GLTF format')

NATURE_MODELS = (
    ['Pine_%d' % i for i in range(1, 6)] +
    ['Bush_Common', 'Bush_Common_Flowers', 'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
     'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall',
     'Flower_3_Group', 'Flower_4_Group', 'Fern_1', 'Plant_1', 'Plant_7', 'Clover_1',
     'Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_2', 'Mushroom_Common'])
KENNEY_MODELS = ['grandStand', 'grandStandCovered', 'grandStandAwning', 'grandStandRound', 'grandStandCoveredRound',
                 'tent', 'tentLong', 'tentClosed', 'tentClosedLong', 'tentRoof', 'tentRoofDouble',
                 'pitsGarage', 'pitsGarageClosed', 'pitsGarageCorner', 'pitsOffice', 'pitsOfficeCorner', 'pitsOfficeRoof',
                 'flagRed', 'flagGreen', 'flagCheckers', 'flagTankco', 'billboard', 'billboardLow', 'billboardLower',
                 'bannerTowerRed', 'bannerTowerGreen', 'lightPostModern', 'lightPostLarge', 'overheadLights',
                 'barrierRed', 'barrierWhite', 'barrierWall', 'pylon', 'radarEquipment', 'lightColored', 'lightRed']

# max texture size per image name prefix (smaller = faster loading, less memory)
def tex_limit(name):
    if name.startswith('Bark'): return 256
    if name.startswith('Leaves') or name.startswith('Leaf'): return 512
    return 512


def tintable(im):
    """'_C' textures are colour masks meant to be tinted in-engine: turn them into neutral grey
    (alpha kept) so the game can colour the foliage to match each circuit."""
    im = im.convert('RGBA'); r, g, b, a = im.split()
    lum = Image.merge('RGB', (r, g, b)).convert('L')
    vals = [v for v, al in zip(lum.getdata(), a.getdata()) if al > 128] or [128]
    mean = sum(vals) / len(vals); k = 175.0 / max(mean, 1)
    lum = lum.point(lambda v: max(0, min(255, int(v * k))))
    return Image.merge('RGBA', (lum, lum, lum, a))


def shrink(path, limit, grey=False):
    im = Image.open(path)
    im.load()
    if grey: im = tintable(im)
    has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    im = im.convert('RGBA' if has_alpha else 'RGB')
    if max(im.size) > limit:
        s = limit / max(im.size)
        im = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS)
    buf = io.BytesIO()
    if has_alpha and im.getextrema()[3][0] < 255:
        im.save(buf, 'PNG', optimize=True); mime = 'image/png'
    else:
        im.convert('RGB').save(buf, 'JPEG', quality=86); mime = 'image/jpeg'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(buf.getvalue()).decode())


# ------------------------------------------------------------------ mesh simplification
# The camera looks down from 50-70 m, so the kit's full-detail trees are far more than needed.
#  - bark (trunks/branches, mostly hidden under the canopy): vertex clustering on a grid
#  - leaf cards: keep a share of the cards and enlarge them so the canopy keeps its volume
SIMPLIFY = {   # model prefix -> (bark grid size in m, share of leaf cards kept, leaf card scale)
    'CommonTree': (0.32, 0.55, 1.3), 'Pine': (0.4, 0.55, 1.25), 'Bush': (None, 0.6, 1.25),
    'Flower_4': (None, 0.6, 1.2), 'Grass_Wispy': (None, 0.6, 1.2),
}
COMP_T = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def read_acc(j, binb, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = NC[a['type']]; t = COMP_T[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0); size = np.dtype(t).itemsize * n
    if stride and stride != size:
        raw = np.frombuffer(binb, np.uint8, count=stride * (a['count'] - 1) + size, offset=off)
        return np.stack([np.frombuffer(raw[k * stride:k * stride + size].tobytes(), t) for k in range(a['count'])])
    return np.frombuffer(binb, t, count=a['count'] * n, offset=off).reshape(a['count'], n) if n > 1 else np.frombuffer(binb, t, count=a['count'], offset=off).copy()

def cluster(pos, nor, uv, idx, cell):
    key = np.floor(pos / cell).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1); tri = inv[idx.reshape(-1, 3)]
    keep = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
    tri = tri[keep]
    return pos[first], nor[first], uv[first], tri.reshape(-1)

def thin_cards(pos, nor, uv, idx, share, scale, seed=1):
    n = len(pos); parent = np.arange(n)
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    tri = idx.reshape(-1, 3)
    for a, b, c in tri:
        ra, rb, rc = find(a), find(b), find(c); parent[rb] = ra; parent[find(rc)] = ra
    roots = np.array([find(i) for i in range(n)])
    comps = np.unique(roots); rng = np.random.default_rng(seed)
    keep_c = set(comps[rng.random(len(comps)) < share].tolist())
    vkeep = np.array([r in keep_c for r in roots])
    pos = pos.copy()
    for r in keep_c:   # enlarge each kept card around its own centre
        m = roots == r; c = pos[m].mean(axis=0); pos[m] = c + (pos[m] - c) * scale
    remap = -np.ones(n, np.int64); remap[vkeep] = np.arange(vkeep.sum())
    t2 = remap[tri]; t2 = t2[(t2 >= 0).all(axis=1)]
    return pos[vkeep], nor[vkeep], uv[vkeep], t2.reshape(-1)

def simplify_model(name, j, binb):
    rule = next((v for k, v in SIMPLIFY.items() if name.startswith(k)), None)
    out = bytearray(); views = []; accs = []
    def push(arr, target):
        nonlocal out
        while len(out) % 4: out += b'\0'
        data = np.ascontiguousarray(arr).tobytes(); views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data), 'target': target}); out += data
        return len(views) - 1
    def acc(arr, kind):
        if kind == 'idx':
            big = arr.max() > 65535; a = arr.astype(np.uint32 if big else np.uint16)
            accs.append({'bufferView': push(a, 34963), 'componentType': 5125 if big else 5123, 'count': int(a.size), 'type': 'SCALAR'})
        else:
            a = arr.astype(np.float32); d = {'bufferView': push(a, 34962), 'componentType': 5126, 'count': int(a.shape[0]), 'type': 'VEC%d' % a.shape[1]}
            if kind == 'pos': d['min'] = a.min(axis=0).tolist(); d['max'] = a.max(axis=0).tolist()
            accs.append(d)
        return len(accs) - 1
    before = after = 0
    for mesh in j['meshes']:
        for p in mesh['primitives']:
            at = p['attributes']; pos = read_acc(j, binb, at['POSITION']).astype(np.float32)
            nor = read_acc(j, binb, at['NORMAL']).astype(np.float32) if 'NORMAL' in at else np.zeros_like(pos)
            uv = read_acc(j, binb, at['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in at else np.zeros((len(pos), 2), np.float32)
            idx = read_acc(j, binb, p['indices']).astype(np.int64).reshape(-1) if 'indices' in p else np.arange(len(pos))
            before += idx.size // 3
            mname = j['materials'][p['material']]['name'] if 'material' in p else ''
            if rule:
                if mname.startswith('Bark') and rule[0]: pos, nor, uv, idx = cluster(pos, nor, uv, idx, rule[0])
                elif (mname.startswith('Lea') or mname in ('Grass', 'Flowers')) and rule[1] < 1: pos, nor, uv, idx = thin_cards(pos, nor, uv, idx, rule[1], rule[2])
            after += idx.size // 3
            p['attributes'] = {'POSITION': acc(pos, 'pos'), 'NORMAL': acc(nor, 'v'), 'TEXCOORD_0': acc(uv, 'v')}
            p['indices'] = acc(idx, 'idx')
    j['accessors'] = accs; j['bufferViews'] = views; j['buffers'] = [{'byteLength': len(out), 'uri': 'bin'}]
    return bytes(out), before, after

def pack_nature():
    entries, textures = {}, {}
    for name in NATURE_MODELS:
        f = os.path.join(NATURE, name + '.gltf')
        if not os.path.exists(f):
            print('  skip (missing)', name); continue
        j = json.load(open(f))
        binf = os.path.join(NATURE, j['buffers'][0]['uri'])
        binb, before, after = simplify_model(name, j, open(binf, 'rb').read())
        if after < before: print('  %-22s %6d -> %5d triangles' % (name, before, after))
        bin_b64 = base64.b64encode(binb).decode()
        # drop normal maps: at this camera distance they cost more than they add
        for m in j.get('materials', []):
            m.pop('normalTexture', None)
        for im in j.get('images', []):
            key = im['name']
            if key not in textures:
                p = os.path.join(NATURE, im['uri'])
                if not os.path.exists(p): p = os.path.join(SRC, 'nature', 'Textures', im['uri'])
                textures[key] = shrink(p, tex_limit(key), grey=key.endswith('_C'))
            im['uri'] = 'tex:' + key
            im.pop('mimeType', None)
        entries['nature/' + name] = {'json': j, 'bin': bin_b64}
    return entries, textures


def pack_kenney():
    entries = {}
    for name in KENNEY_MODELS:
        f = os.path.join(KENNEY, name + '.glb')
        if not os.path.exists(f):
            print('  skip (missing)', name); continue
        entries['kenney/' + name] = {'glb': base64.b64encode(open(f, 'rb').read()).decode()}
    return entries


def write_pack(fname, entries, textures):
    path = os.path.join(OUT, fname)
    with open(path, 'w') as o:
        o.write('/* generated by tools/build_assets.py - do not edit */\n(function(P){\n')
        for k, v in textures.items():
            o.write('P.tex[%s]=%s;\n' % (json.dumps(k), json.dumps(v)))
        for k, v in entries.items():
            o.write('P.models[%s]=%s;\n' % (json.dumps(k), json.dumps(v, separators=(',', ':'))))
        o.write('})(window.APEX_PACK=window.APEX_PACK||{tex:{},models:{}});\n')
    print('  wrote %s  (%d models, %d textures, %.1f MB)' % (fname, len(entries), len(textures), os.path.getsize(path) / 1e6))


if __name__ == '__main__':
    if os.path.isdir(NATURE):
        print('Stylized Nature MegaKit'); e, t = pack_nature(); write_pack('pack_nature.js', e, t)
    if os.path.isdir(KENNEY):
        print('Kenney Racing Kit'); write_pack('pack_kenney.js', pack_kenney(), {})
