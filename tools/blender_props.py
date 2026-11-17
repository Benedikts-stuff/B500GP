import bpy, bmesh, math, random
from mathutils import Vector, Matrix

# work in a separate scene so the open pass_test file stays untouched
for sc in [s for s in bpy.data.scenes if s.name == 'Props']: bpy.data.scenes.remove(sc)
for o in [o for o in bpy.data.objects if o.name.startswith(('Hut', 'Barn'))]: bpy.data.objects.remove(o)
scene = bpy.data.scenes.new('Props')
try: bpy.context.window.scene = scene
except Exception: pass
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.refresh_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception:
    pass
R = random.Random(4)

# ------------------------------------------------------------------ procedural materials (baked later)
def node_mat(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    col = build(nt, tc.outputs['Object'])
    nt.links.new(col, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = 0.85
    return m

def ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB'); e = r.color_ramp
    e.elements[0].position = stops[0][0]; e.elements[0].color = (*stops[0][1], 1)
    e.elements[1].position = stops[-1][0]; e.elements[1].color = (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        el = e.elements.new(p); el.color = (*c, 1)
    nt.links.new(fac, r.inputs[0]); return r.outputs[0]

def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def mix(nt, a, b, fac, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = blend
    if isinstance(fac, float): m.inputs['Factor'].default_value = fac
    else: nt.links.new(fac, m.inputs['Factor'])
    for sock, v in ((m.inputs[6], a), (m.inputs[7], b)):
        if isinstance(v, tuple): sock.default_value = (*v, 1)
        else: nt.links.new(v, sock)
    return m.outputs[2]

def noise(nt, vec, scale, detail=4, rough=0.6):
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    nt.links.new(vec, n.inputs['Vector']); return n.outputs['Fac']

def mapping(nt, vec, scale):
    m = nt.nodes.new('ShaderNodeMapping'); m.inputs['Scale'].default_value = scale; nt.links.new(vec, m.inputs['Vector']); return m.outputs[0]

def stone_mat(name, a, b, c, scale=2.2):
    def build(nt, v):
        vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = scale
        vec = mapping(nt, v, (1, 1, 1.8)); nt.links.new(vec, vo.inputs['Vector'])
        vo2 = nt.nodes.new('ShaderNodeTexVoronoi'); vo2.inputs['Scale'].default_value = scale; nt.links.new(vec, vo2.inputs['Vector'])
        tone = ramp(nt, vo2.outputs['Color'], [(0, lin(a)), (0.5, lin(b)), (1, lin(c))])
        tone = mix(nt, tone, noise(nt, v, 9), 0.25, 'MULTIPLY')
        joint = ramp(nt, vo.outputs['Distance'], [(0.0, (0.03, 0.028, 0.025)), (0.06, (1, 1, 1))])
        return mix(nt, tone, joint, 1.0, 'MULTIPLY')
    return node_mat(name, build)

def wood_mat(name, a, b, horizontal=True, plank=0.22):
    def build(nt, v):
        # plank index from the vertical (or horizontal) coordinate, plus grain streaks along the plank
        sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(v, sep.inputs[0])
        axis = sep.outputs['Z'] if horizontal else sep.outputs['X']
        div = nt.nodes.new('ShaderNodeMath'); div.operation = 'DIVIDE'; div.inputs[1].default_value = plank; nt.links.new(axis, div.inputs[0])
        fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'FRACT'; nt.links.new(div.outputs[0], fr.inputs[0])
        gap = ramp(nt, fr.outputs[0], [(0.0, (0.12, 0.1, 0.08)), (0.06, (1, 1, 1)), (0.94, (1, 1, 1)), (1.0, (0.35, 0.3, 0.26))])
        fl = nt.nodes.new('ShaderNodeMath'); fl.operation = 'FLOOR'; nt.links.new(div.outputs[0], fl.inputs[0])
        wn = nt.nodes.new('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '1D'; nt.links.new(fl.outputs[0], wn.inputs['W'])
        tone = ramp(nt, wn.outputs['Value'], [(0, lin(a)), (1, lin(b))])
        grain = noise(nt, mapping(nt, v, (0.4, 0.4, 14) if horizontal else (14, 0.4, 0.4)), 4, 6, 0.7)
        tone = mix(nt, tone, ramp(nt, grain, [(0.3, (0.72, 0.7, 0.68)), (0.7, (1.08, 1.06, 1.04))]), 1.0, 'MULTIPLY')
        return mix(nt, tone, gap, 1.0, 'MULTIPLY')
    return node_mat(name, build)

def flat_mat(name, hexc, nscale=6, amt=0.12):
    def build(nt, v):
        n = noise(nt, v, nscale)
        return mix(nt, lin(hexc), ramp(nt, n, [(0.3, (1 - amt, 1 - amt, 1 - amt)), (0.7, (1 + amt, 1 + amt, 1 + amt))]), 1.0, 'MULTIPLY')
    return node_mat(name, build)

def slate_mat(name):
    def build(nt, v):
        br = nt.nodes.new('ShaderNodeTexBrick'); br.inputs['Scale'].default_value = 1.0; br.inputs['Brick Width'].default_value = 0.42; br.inputs['Row Height'].default_value = 0.2
        br.inputs['Mortar Size'].default_value = 0.012; br.offset = 0.5
        br.inputs['Color1'].default_value = (*lin('4c4d52'), 1); br.inputs['Color2'].default_value = (*lin('64656a'), 1); br.inputs['Mortar'].default_value = (0.02, 0.02, 0.025, 1)
        nt.links.new(mapping(nt, v, (1, 1, 1)), br.inputs['Vector'])
        return mix(nt, br.outputs['Color'], ramp(nt, noise(nt, v, 3), [(0.3, (0.8, 0.8, 0.8)), (0.7, (1.1, 1.1, 1.08))]), 1.0, 'MULTIPLY')
    return node_mat(name, build)

def tin_mat(name):
    def build(nt, v):
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'X'; w.inputs['Scale'].default_value = 6
        nt.links.new(mapping(nt, v, (1, 1, 1)), w.inputs['Vector'])
        rib = ramp(nt, w.outputs['Fac'], [(0.0, (0.6, 0.6, 0.62)), (0.5, (1.1, 1.1, 1.1)), (1.0, (0.6, 0.6, 0.62))])
        rust = ramp(nt, noise(nt, v, 1.5, 6, 0.65), [(0.45, lin('7c7f84')), (0.62, lin('8a5a3a')), (0.75, lin('6b3e25'))])
        return mix(nt, rust, rib, 1.0, 'MULTIPLY')
    return node_mat(name, build)

M = {
    'stone': stone_mat('Stone', '77736c', '918b81', 'a89f90', 2.4),
    'wood': wood_mat('Wood', '7a4a26', '94603a', True, 0.2),
    'wooddk': wood_mat('WoodDark', '4a3322', '5e4130', False, 0.18),
    'slate': slate_mat('Slate'),
    'metal': flat_mat('Metal', '6f7378', 18, 0.1),
    'white': flat_mat('White', 'eeebe2', 8, 0.04),
    'glass': flat_mat('Glass', '1d2733', 3, 0.15),
    'red': flat_mat('Red', 'b8231f', 8, 0.06),
    'green': flat_mat('Green', '3d6b2d', 20, 0.25),
    'flower': flat_mat('Flower', 'd8282a', 30, 0.25),
    'plaster': flat_mat('Plaster', 'e8e1d0', 10, 0.06),
    'tin': tin_mat('Tin'),
}

# ------------------------------------------------------------------ geometry helpers (pure bmesh, no operators)
MATS = list(M.keys())
BM = None
def _add(tmp, mat):
    for f in tmp.faces: f.material_index = MATS.index(mat)
    me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free(); BM.from_mesh(me); bpy.data.meshes.remove(me)

def box(sx, sy, sz, loc, mat, bevel=0.025, rot=(0, 0, 0)):
    t = bmesh.new(); bmesh.ops.create_cube(t, size=1.0)
    bmesh.ops.scale(t, vec=(sx, sy, sz), verts=t.verts)
    if bevel: bmesh.ops.bevel(t, geom=list(t.edges), offset=min(bevel, sx / 2.2, sy / 2.2, sz / 2.2), segments=1, affect='EDGES', profile=0.5)
    rm = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[2], 4, 'Z')
    bmesh.ops.transform(t, matrix=Matrix.Translation(loc) @ rm, verts=t.verts)
    _add(t, mat)

def prism(length, width, height, loc, mat):
    """gable triangle extruded along X: base width along Y, apex height along Z"""
    t = bmesh.new(); L, W, H = length / 2, width / 2, height
    vs = [t.verts.new(Vector(v) + Vector(loc)) for v in [(-L, -W, 0), (-L, W, 0), (-L, 0, H), (L, -W, 0), (L, W, 0), (L, 0, H)]]
    for f in [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]: t.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(t, faces=t.faces)
    _add(t, mat)

def roof(length, width, pitch_deg, base_z, over, mat='slate', thick=0.22):
    p = math.radians(pitch_deg); half = width / 2 + over; slope = half / math.cos(p); rise = (width / 2) * math.tan(p)
    for s in (-1, 1):
        cy = s * half / 2; cz = base_z + rise - (half / 2) * math.tan(p)
        box(length + over * 2, slope, thick, (0, cy, cz + thick / 2), mat, 0.03, (-s * p, 0, 0))
    box(length + over * 2 + 0.05, 0.36, 0.16, (0, 0, base_z + rise + thick + 0.02), 'metal', 0.02)
    return rise

def window(x, y, z, face, w=0.9, h=1.05, shutter='red'):
    """face: +1/-1 normal along Y (long walls) or 'x+' for the gable end"""
    if face in (1, -1):
        box(w, 0.12, h, (x, y + face * 0.02, z), 'glass', 0.0)
        box(w + 0.16, 0.16, 0.09, (x, y + face * 0.05, z + h / 2 + 0.04), 'white', 0.01)
        box(w + 0.16, 0.16, 0.09, (x, y + face * 0.05, z - h / 2 - 0.04), 'white', 0.01)
        box(0.07, 0.15, h, (x, y + face * 0.05, z), 'white', 0.0)
        for s in (-1, 1): box(w * 0.5, 0.06, h, (x + s * (w * 0.75 + 0.08), y + face * 0.09, z), shutter, 0.01)
        box(w + 0.1, 0.28, 0.22, (x, y + face * 0.2, z - h / 2 - 0.2), 'wooddk', 0.02)
        for k in range(5): box(0.16, 0.16, 0.14, (x - w / 2 + 0.1 + k * (w - 0.2) / 4, y + face * 0.22, z - h / 2 - 0.04), 'flower' if k % 2 == 0 else 'green', 0.04)
    else:
        box(0.12, w, h, (x + 0.02, y, z), 'glass', 0.0)
        box(0.16, w + 0.16, 0.09, (x + 0.05, y, z + h / 2 + 0.04), 'white', 0.01)
        box(0.16, w + 0.16, 0.09, (x + 0.05, y, z - h / 2 - 0.04), 'white', 0.01)
        box(0.15, 0.07, h, (x + 0.05, y, z), 'white', 0.0)
        for s in (-1, 1): box(0.06, w * 0.5, h, (x + 0.09, y + s * (w * 0.75 + 0.08), z), shutter, 0.01)

# ------------------------------------------------------------------ alp hut / Berggasthaus
def chalet():
    Lx, Wy, base, up = 10.0, 8.0, 2.6, 2.5
    box(Lx, Wy, base, (0, 0, base / 2 - 0.3), 'stone', 0.06)
    box(Lx + 0.16, Wy + 0.16, up, (0, 0, base + up / 2 - 0.3), 'wood', 0.03)
    for sx in (-1, 1):                    # corner posts
        for sy in (-1, 1): box(0.26, 0.26, up, (sx * (Lx / 2 + 0.05), sy * (Wy / 2 + 0.05), base + up / 2 - 0.3), 'wooddk', 0.03)
    z0 = base + up - 0.3
    rise = 4.0 * math.tan(math.radians(24))
    prism(Lx + 0.16, Wy + 0.16, rise, (0, 0, z0), 'wood')
    roof(Lx + 0.16, Wy + 0.16, 24, z0, 1.1)
    box(0.7, 0.7, 2.0, (-2.2, 1.6, z0 + rise + 0.2), 'stone', 0.04)
    box(0.85, 0.85, 0.12, (-2.2, 1.6, z0 + rise + 1.22), 'slate', 0.02)
    # windows: long sides
    for face in (-1, 1):
        y = face * (Wy / 2 + 0.08)
        for x in (-3.2, 0, 3.2): window(x, y, base + up / 2 - 0.2, face)
        for x in (-2.6, 2.6): window(x, face * (Wy / 2 + 0.0), 1.15, face, 0.7, 0.8, 'green')
    # gable front (+X): door, windows, balcony
    gx = Lx / 2 + 0.08
    for y in (-2.0, 2.0): window(gx, y, base + up / 2 - 0.2, 'x', 0.9, 1.05)
    window(gx + 0.05, 0, z0 + 0.9, 'x', 0.6, 0.6)
    box(0.14, 1.2, 2.1, (Lx / 2 + 0.04, 0, 0.75), 'wooddk', 0.02)
    box(0.18, 1.45, 0.14, (Lx / 2 + 0.06, 0, 1.85), 'white', 0.01)
    by = Wy + 0.6; bz = base - 0.2
    box(1.3, by, 0.16, (Lx / 2 + 0.7, 0, bz), 'wooddk', 0.02)
    for y in (-by / 2 + 0.06, by / 2 - 0.06): box(1.3, 0.1, 1.0, (Lx / 2 + 0.7, y, bz + 0.55), 'wooddk', 0.01)
    box(0.12, by, 0.1, (Lx / 2 + 1.3, 0, bz + 1.05), 'wooddk', 0.01)
    box(0.1, by, 0.08, (Lx / 2 + 1.3, 0, bz + 0.15), 'wooddk', 0.01)
    n = 34
    for k in range(n):
        y = -by / 2 + 0.2 + k * (by - 0.4) / (n - 1)
        box(0.04, 0.12 if k % 2 else 0.1, 0.86, (Lx / 2 + 1.3, y, bz + 0.6), 'wood', 0.0)
    for y in (-by / 2 + 0.15, by / 2 - 0.15): box(0.16, 0.16, bz + 0.3, (Lx / 2 + 1.25, y, bz / 2 - 0.3), 'wooddk', 0.02)
    # bench by the door
    box(0.45, 1.8, 0.08, (Lx / 2 + 0.35, 2.3, 0.45), 'wood', 0.01)
    for y in (1.5, 3.1): box(0.4, 0.08, 0.45, (Lx / 2 + 0.35, y, 0.22), 'wooddk', 0.0)
    # Swiss flag pole
    box(0.08, 0.08, 6.5, (Lx / 2 + 3.5, -Wy / 2 - 1.0, 3.25 - 0.3), 'white', 0.0)
    box(0.02, 1.0, 1.0, (Lx / 2 + 3.5, -Wy / 2 - 0.45, 5.7), 'red', 0.0)
    box(0.03, 0.6, 0.18, (Lx / 2 + 3.5, -Wy / 2 - 0.45, 5.7), 'white', 0.0)
    box(0.036, 0.18, 0.6, (Lx / 2 + 3.5, -Wy / 2 - 0.45, 5.7), 'white', 0.0)
    # woodpile under the eaves
    for k in range(12):
        box(0.6, 0.18, 0.18, (-Lx / 2 - 0.45, -2.5 + (k % 6) * 0.2, 0.1 + (k // 6) * 0.19), 'wooddk', 0.03, (0, 0, 0))

# ------------------------------------------------------------------ hay barn (Heustall)
def barn():
    Lx, Wy = 6.0, 5.0
    box(Lx, Wy, 1.2, (0, 0, 0.3), 'stone', 0.05)
    box(Lx, Wy, 2.8, (0, 0, 2.3), 'wooddk', 0.02)
    rise = 2.5 * math.tan(math.radians(30))
    prism(Lx, Wy, rise, (0, 0, 3.7), 'wooddk')
    roof(Lx, Wy, 30, 3.7, 0.6, 'tin', 0.12)
    box(0.1, 2.0, 2.0, (Lx / 2 + 0.03, 0, 2.2), 'wood', 0.02)
    box(0.12, 0.12, 2.1, (Lx / 2 + 0.06, 0, 2.2), 'wooddk', 0.0)
    for y in (-1.6, 1.6): box(0.08, 0.5, 0.25, (Lx / 2 + 0.03, y, 3.2), 'glass', 0.0)
    for x in (-1.8, 0, 1.8):
        for f in (-1, 1): box(0.4, 0.08, 0.18, (x, f * (Wy / 2 + 0.03), 3.0), 'glass', 0.0)

def finish(name, fn, offset_x):
    global BM; BM = bmesh.new()
    fn()
    me = bpy.data.meshes.new(name); BM.to_mesh(me); BM.free()
    for m in M.values(): me.materials.append(m)
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); o.location.x = offset_x
    return o

hut = finish('Hut', chalet, 0)
barn_o = finish('Barn', barn, 16)
result = {'hut_tris': sum(len(p.vertices) - 2 for p in hut.data.polygons), 'barn_tris': sum(len(p.vertices) - 2 for p in barn_o.data.polygons), 'mats': len(hut.data.materials)}
