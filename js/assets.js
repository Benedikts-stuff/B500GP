/* APEX — asset loader. Reads the models packed into assets/pack_*.js by tools/build_assets.py
   (glTF JSON + binary, or whole GLB files) and turns each into a few merged meshes, one per material,
   with node transforms baked in. That keeps instancing and shadows cheap. */
(function (root) {
  'use strict';
  const AX = root.AX, THREE = root.THREE;
  const PACK = () => root.APEX_PACK || { tex: {}, models: {} };

  function b64ToBuf(b64) {
    const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function parseGLB(buf) {
    const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
    let off = 12, json = null, bin = null;
    while (off < buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
      else if (type === 0x004E4942) bin = buf.slice(off + 8, off + 8 + len);
      off += 8 + len;
    }
    return { json, bin };
  }
  const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function readAccessor(j, bin, idx) {
    const a = j.accessors[idx], bv = j.bufferViews[a.bufferView], T = COMP[a.componentType], nc = NCOMP[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 0, es = T.BYTES_PER_ELEMENT;
    const out = new Float32Array(a.count * nc);
    if (!stride || stride === nc * es) {
      const src = new T(bin, off, a.count * nc);
      for (let i = 0; i < out.length; i++) out[i] = src[i];
    } else {
      const dv = new DataView(bin);
      const get = { 5126: (o) => dv.getFloat32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o), 5125: (o) => dv.getUint32(o, true), 5122: (o) => dv.getInt16(o, true), 5120: (o) => dv.getInt8(o) }[a.componentType];
      for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) out[i * nc + k] = get(off + i * stride + k * es);
    }
    if (a.normalized) { const d = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] || 1; for (let i = 0; i < out.length; i++) out[i] /= d; }
    return out;
  }
  function loadImage(src) {
    return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }

  const texCache = {};
  async function makeTexture(j, bin, texIndex, srgb) {
    const t = j.textures[texIndex], im = j.images[t.source]; let src;
    if (im.uri && im.uri.startsWith('tex:')) src = PACK().tex[im.uri.slice(4)];
    else if (im.uri) src = im.uri;
    else if (im.bufferView != null) { const bv = j.bufferViews[im.bufferView]; src = URL.createObjectURL(new Blob([new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength)], { type: im.mimeType || 'image/png' })); }
    const key = im.uri && im.uri.startsWith('tex:') ? im.uri : null;
    if (key && texCache[key]) return texCache[key];
    const img = await loadImage(src); if (!img) return null;
    const tex = new THREE.Texture(img); tex.flipY = false; tex.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; tex.needsUpdate = true;
    if (key) texCache[key] = tex; return tex;
  }
  async function makeMaterial(j, bin, mi) {
    const m = j.materials ? j.materials[mi] : null; const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    if (!m) return mat;
    const pbr = m.pbrMetallicRoughness || {}, unlit = m.extensions && m.extensions.KHR_materials_unlit;
    if (pbr.baseColorFactor) mat.color.setRGB(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2]);   // glTF factors are already linear
    if (pbr.baseColorTexture) mat.map = await makeTexture(j, bin, pbr.baseColorTexture.index, true);
    mat.metalness = unlit ? 0 : (pbr.metallicFactor != null ? pbr.metallicFactor : 1);
    mat.roughness = unlit ? 0.8 : (pbr.roughnessFactor != null ? pbr.roughnessFactor : 1);
    if (m.alphaMode === 'MASK') { mat.alphaTest = m.alphaCutoff != null ? m.alphaCutoff : 0.5; }
    else if (m.alphaMode === 'BLEND') { mat.transparent = true; mat.depthWrite = false; }
    if (m.doubleSided) mat.side = THREE.DoubleSide;
    mat.name = m.name || ''; return mat;
  }

  /* one merged BufferGeometry per material */
  async function build(name, entry) {
    let j, bin;
    if (entry.glb) ({ json: j, bin } = parseGLB(b64ToBuf(entry.glb)));
    else { j = entry.json; bin = b64ToBuf(entry.bin); }
    const groups = new Map(); const mtx = new THREE.Matrix4(), nm = new THREE.Matrix3();
    const visit = (ni, parent) => {
      const n = j.nodes[ni], local = new THREE.Matrix4();
      if (n.matrix) local.fromArray(n.matrix);
      else local.compose(new THREE.Vector3().fromArray(n.translation || [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale || [1, 1, 1]));
      const world = parent.clone().multiply(local);
      if (n.mesh != null) for (const p of j.meshes[n.mesh].primitives) {
        if (p.mode != null && p.mode !== 4) continue;
        const pos = readAccessor(j, bin, p.attributes.POSITION), nor = p.attributes.NORMAL != null ? readAccessor(j, bin, p.attributes.NORMAL) : null;
        const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(j, bin, p.attributes.TEXCOORD_0) : null, idx = p.indices != null ? readAccessor(j, bin, p.indices) : null;
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        if (nor) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx ? Array.from(idx) : Array.from({ length: pos.length / 3 }, (_, k) => k));
        g.applyMatrix4(world); if (!nor) g.computeVertexNormals();
        const key = p.material != null ? p.material : -1; (groups.get(key) || groups.set(key, []).get(key)).push(g);
      }
      (n.children || []).forEach((c) => visit(c, world));
    };
    const scene = j.scenes ? j.scenes[j.scene || 0] : { nodes: j.nodes.map((_, i) => i) };
    scene.nodes.forEach((ni) => visit(ni, mtx));
    const parts = []; const box = new THREE.Box3();
    for (const [mi, list] of groups) {
      let n = 0, ni = 0; list.forEach((g) => { n += g.attributes.position.count; ni += g.index.count; });
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), I = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni); let o = 0, oi = 0;
      for (const g of list) {
        const c = g.attributes.position.count, ix = g.index.array; P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
        for (let k = 0; k < ix.length; k++) I[oi + k] = ix[k] + o; o += c; oi += ix.length; g.dispose();
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2)); geo.setIndex(new THREE.BufferAttribute(I, 1));
      geo.computeBoundingBox(); geo.computeBoundingSphere(); box.union(geo.boundingBox);
      parts.push({ geometry: geo, material: await makeMaterial(j, bin, mi) });
    }
    return { name, parts, box, verts: parts.reduce((s, p) => s + p.geometry.attributes.position.count, 0), tris: parts.reduce((s, p) => s + p.geometry.index.count / 3, 0) };
  }

  const models = {};
  AX.Assets = {
    models,
    has: (name) => !!models[name],
    get: (name) => models[name] || null,
    names: (prefix) => Object.keys(models).filter((k) => !prefix || k.startsWith(prefix)),
    /* a plain Group of meshes (for one-off placement) */
    instance(name, opts) {
      const m = models[name]; if (!m) return null; opts = opts || {}; const g = new THREE.Group();
      for (const p of m.parts) { const mesh = new THREE.Mesh(p.geometry, opts.material ? opts.material(p.material) : p.material); mesh.castShadow = opts.cast !== false; mesh.receiveShadow = opts.receive !== false; g.add(mesh); }
      return g;
    },
    async loadAll(onProgress) {
      const P = PACK(), keys = Object.keys(P.models); let n = 0;
      for (const k of keys) {
        if (models[k]) { n++; continue; }
        try { models[k] = await build(k, P.models[k]); } catch (e) { console.warn('[assets] failed', k, e); }
        n++; if (onProgress) onProgress(n / keys.length);
      }
      return keys.length;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
