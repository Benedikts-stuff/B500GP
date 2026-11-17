import bpy, numpy as np
sc = bpy.data.scenes['Props']; bpy.context.window.scene = sc
sc.render.engine = 'CYCLES'; sc.cycles.device = 'GPU'
OUT = '/Users/benedikt/Desktop/Apex/blender/'
def bake(obj, size, ao_samples=64):
    vl = bpy.context.view_layer
    for o in sc.objects: o.select_set(False)
    obj.select_set(True); vl.objects.active = obj
    me = obj.data
    while len(me.uv_layers): me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='bake')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    imgs = {}
    for kind in ('col', 'ao'):
        im = bpy.data.images.get(obj.name + '_' + kind)
        if im: bpy.data.images.remove(im)
        imgs[kind] = bpy.data.images.new(obj.name + '_' + kind, size, size, alpha=False, float_buffer=False)
    def target(img):
        for m in me.materials:
            nt = m.node_tree
            n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'; n.image = img
            nt.nodes.active = n
    target(imgs['col']); sc.cycles.samples = 4
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=6, use_clear=True)
    target(imgs['ao']); sc.cycles.samples = ao_samples
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    c = np.array(imgs['col'].pixels[:]).reshape(-1, 4); a = np.array(imgs['ao'].pixels[:]).reshape(-1, 4)
    out = c.copy(); out[:, :3] = c[:, :3] * (0.42 + 0.58 * a[:, :1])
    fin = bpy.data.images.get(obj.name + '_baked') 
    if fin: bpy.data.images.remove(fin)
    fin = bpy.data.images.new(obj.name + '_baked', size, size, alpha=False)
    fin.pixels[:] = out.ravel().tolist()
    fin.filepath_raw = OUT + obj.name + '_baked.png'; fin.file_format = 'PNG'; fin.save()
    # single baked material for export
    bm = bpy.data.materials.get(obj.name + 'Baked') or bpy.data.materials.new(obj.name + 'Baked'); bm.use_nodes = True
    nt = bm.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.85
    tx = nt.nodes.get('IMG') or nt.nodes.new('ShaderNodeTexImage'); tx.name = 'IMG'; tx.image = fin
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    return bm
res = {}
for name, size in (('Hut', 2048), ('Barn', 1024)):
    obj = sc.objects[name]
    bm = bake(obj, size)
    # export a copy with the baked material
    cp = obj.copy(); cp.data = obj.data.copy(); sc.collection.objects.link(cp); cp.location = (0, 0, 0)
    cp.data.materials.clear(); cp.data.materials.append(bm)
    for o in sc.objects: o.select_set(False)
    cp.select_set(True); bpy.context.view_layer.objects.active = cp
    bpy.ops.export_scene.gltf(filepath=OUT + 'prop_' + name.lower() + '.glb', export_format='GLB', use_selection=True, export_apply=True,
                              export_image_format='JPEG', export_jpeg_quality=88, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_yup=True)
    bpy.data.objects.remove(cp)
    res[name] = 'ok'
result = res
