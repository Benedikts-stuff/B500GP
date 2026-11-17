/* APEX — world: lighting, ground, track surfaces, barriers and trackside scenery.
   Everything is generated at load time from the Track data (no external assets). */
(function (root) {
  'use strict';
  const AX = root.AX, THREE = root.THREE;
  const { clamp, lerp, mod, smoothstep } = AX;
  const { GeoBuilder, roundedBox, M, lin, tubeBetween } = AX.Models;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  AX.THEMES = {
    pass: { sky: [0x4f8fd8, 0xe2ecf2], fog: 0xc8d9e6, sun: 0xffe4bc, sunI: 1.75, hemi: [0xc6dcff, 0x6a7046, 0.72], sunDir: [-0.55, 0.45, 0.70],
      grass: ['#5b9441', '#538a3b'], verge: '#8d8a80', gravel: '#bdb8aa', asphalt: '#5b5a60', tree: [0x3f7f3a, 0x35733a, 0x4f8a40], leaf: '#5e9e3c', pine: '#3b7a3a', conifer: 1, density: 1 },
    forest: { sky: [0x7fb2ea, 0xcfe4f6], fog: 0xcfdde6, sun: 0xfff0d6, sunI: 1.32, hemi: [0xcfe2ff, 0x6c7d4c, 0.62], sunDir: [-0.5, 0.78, -0.38],
      grass: ['#5e9e3f', '#57953a'], verge: '#b8744a', gravel: '#dcc99a', asphalt: '#625d70', tree: [0x4f9a3c, 0x3f8433, 0x77b04a], leaf: '#6fae3a', pine: '#3f7f3a', conifer: 0.35, density: 1.0 },
    coast: { sky: [0x58a8ee, 0xd8ecf8], fog: 0xd6e6ee, sun: 0xfff6e4, sunI: 1.42, hemi: [0xd6ecff, 0x8a8468, 0.66], sunDir: [-0.35, 0.86, -0.36],
      grass: ['#76a84a', '#6da044'], verge: '#c08250', gravel: '#e6d6a8', asphalt: '#665f72', tree: [0x5aa544, 0x4a9038, 0x86b858], leaf: '#86bd48', pine: '#4f8a40', conifer: 0.05, density: 0.42 },
    alpine: { sky: [0x6aa6e6, 0xd9e8f4], fog: 0xd4e0ea, sun: 0xfff4e0, sunI: 1.36, hemi: [0xd2e4ff, 0x66784e, 0.62], sunDir: [-0.55, 0.74, -0.4],
      grass: ['#5a9744', '#528d3e'], verge: '#a9714c', gravel: '#d6cbab', asphalt: '#5f5b6d', tree: [0x3f8a3a, 0x347a33, 0x5f9f45], leaf: '#5e9e3c', pine: '#3a7538', conifer: 0.85, density: 0.8 }
  };

  /* ------------------------------------------------------------------ textures */
  function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, per) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const w = (a) => per ? mod(a, per) : a;
    const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi)), c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, per, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < (oct || 4); i++) { s += a * vnoise(x * f, y * f, per ? per * f : 0); a *= 0.5; f *= 2; } return s; }
  function hexRGB(h) { const c = new THREE.Color(h); return [c.r * 255, c.g * 255, c.b * 255]; }
  function pixelTex(size, fn, repeat, aniso) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const im = g.createImageData(size, size); const d = im.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const o = (y * size + x) * 4; const r = fn(x / size, y / size, x, y); d[o] = r[0]; d[o + 1] = r[1]; d[o + 2] = r[2]; d[o + 3] = r.length > 3 ? r[3] : 255; }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso || 8; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
  }
  function canvasTex(w, h, draw, aniso) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso || 8; return t;
  }
  function asphaltTex(hex, aniso) {
    const b = hexRGB(hex);
    return pixelTex(512, (u, v, x, y) => {
      const grain = (hash2(x, y) - 0.5) * 26 + (hash2(x * 3 + 7, y * 3 + 1) - 0.5) * 10;
      const cloud = (fbm(u * 6, v * 6, 6, 4) - 0.5) * 15;
      const seam = Math.abs(u - 0.5) < 0.004 ? -10 : 0;
      const k = grain + cloud + seam; return [b[0] + k, b[1] + k, b[2] + k * 1.05];
    }, null, aniso);
  }
  function grassTex(c1, c2, aniso) {
    const a = hexRGB(c1), b = hexRGB(c2);
    return pixelTex(512, (u, v, x, y) => {
      const stripe = smoothstep(0.47, 0.53, Math.abs(((u * 2) % 1) - 0.5) * 2);
      const n = (fbm(u * 24, v * 24, 24, 3) - 0.5) * 30 + (hash2(x, y) - 0.5) * 16;
      return [lerp(a[0], b[0], stripe) + n * 0.7, lerp(a[1], b[1], stripe) + n, lerp(a[2], b[2], stripe) + n * 0.5];
    }, null, aniso);
  }
  function gravelTex(hex, aniso) {
    const b = hexRGB(hex);
    return pixelTex(256, (u, v, x, y) => {
      const p = hash2(x, y), q = hash2(x >> 1, y >> 1); const rake = Math.sin(v * Math.PI * 2 * 10) * 7;
      const k = (p - 0.5) * 46 + (q - 0.5) * 30 + rake + (fbm(u * 5, v * 5, 5, 3) - 0.5) * 20; return [b[0] + k, b[1] + k, b[2] + k * 0.9];
    }, null, aniso);
  }
  function dirtTex(hex, aniso) {
    const b = hexRGB(hex);
    return pixelTex(256, (u, v, x, y) => { const k = (hash2(x, y) - 0.5) * 14 + (fbm(u * 8, v * 8, 8, 3) - 0.5) * 26; return [b[0] + k, b[1] + k * 0.8, b[2] + k * 0.6]; }, null, aniso);
  }
  function concreteTex() {
    return pixelTex(256, (u, v, x, y) => { const k = (hash2(x, y) - 0.5) * 16 + (fbm(u * 6, v * 6, 6, 3) - 0.5) * 30; return [205 + k, 205 + k, 200 + k]; });
  }
  function fenceTex() {
    const t = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(210,216,222,0.95)'; g.lineWidth = 3;
      for (let i = -w; i < w * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
    }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const BRANDS = [['VOLTARA', '#f4c20d', '#17191c'], ['NORDFJELL', '#1d4ed8', '#ffffff'], ['PYKO TYRES', '#111315', '#ffd23c'], ['ZENTRA OIL', '#d6243a', '#ffffff'],
    ['RAPIDA', '#ffffff', '#d6243a'], ['APEX', '#e8372c', '#ffffff'], ['MOTO KOLLEKTIV', '#0f766e', '#eafff8'], ['KURVENWERK', '#f8f8f4', '#17191c'], ['ALTAVISTA 24', '#7b3fe0', '#ffffff'], ['SPITZKEHRE', '#f97316', '#1a1206']];
  function brandTex(i) {
    const b = BRANDS[i % BRANDS.length];
    return canvasTex(512, 96, (g, w, h) => {
      g.fillStyle = b[1]; g.fillRect(0, 0, w, h); g.fillStyle = b[2];
      g.font = 'italic 900 62px "Arial Black", "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 62; while (g.measureText(b[0]).width > w - 50 && fs > 20) { fs -= 4; g.font = 'italic 900 ' + fs + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif'; }
      g.fillText(b[0], w / 2, h / 2 + 4); g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
    });
  }
  function textTex(text, bg, fg, w, h) {
    return canvasTex(w || 256, h || 128, (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.font = '900 ' + Math.round(H * 0.7) + 'px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + H * 0.04); });
  }

  /* ------------------------------------------------------------------ decal material (per-vertex alpha) */
  /* transparent ground decal (tyre marks, rubbered line) with a per-vertex alpha attribute 'aAlpha',
     built on MeshBasicMaterial so it goes through three.js' normal output pipeline */
  function decalMaterial(map, color, polyOff) {
    const m = new THREE.MeshBasicMaterial({ color: color || new THREE.Color(0x000000), map: map || null, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: polyOff || -2, polygonOffsetUnits: polyOff || -2, fog: false });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vDecalA;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDecalA = aAlpha;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDecalA;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalA;');
    };
    m.customProgramCacheKey = () => 'apex-decal';
    return m;
  }
  AX.decalMaterial = decalMaterial;

  /* ------------------------------------------------------------------ ribbons along the track */
  function ribbon(t, offA, offB, o) {
    o = o || {}; const N = t.n, step = o.step || 1; const P = [], UV = [], NR = [], C = [], A = [];
    let yA = o.yA == null ? (o.y || 0) : o.yA, yB = o.yB == null ? (o.y || 0) : o.yB, flip = false; const vLen = o.vLen || 10, uRep = o.uRep || 1;
    const vert = !!o.vertical;
    for (let i = 0; i < N; i += step) {
      const j = (i + step) % N; if (o.cond && !(o.cond(i) && o.cond(j % N))) continue;
      let a0 = offA(i), b0 = offB(i), a1 = offA(j), b1 = offB(j);
      if (!vert && b0 < a0) { let q = a0; a0 = b0; b0 = q; q = a1; a1 = b1; b1 = q; if (!flip) { flip = true; const y = yA; yA = yB; yB = y; } }
      const ax0 = t.px[i] + t.nx[i] * a0, az0 = t.pz[i] + t.nz[i] * a0, bx0 = t.px[i] + t.nx[i] * b0, bz0 = t.pz[i] + t.nz[i] * b0;
      const ax1 = t.px[j] + t.nx[j] * a1, az1 = t.pz[j] + t.nz[j] * a1, bx1 = t.px[j] + t.nx[j] * b1, bz1 = t.pz[j] + t.nz[j] * b1;
      const v0 = i * t.ds / vLen, v1 = (i + step) * t.ds / vLen;
      P.push(ax0, yA, az0, bx0, yB, bz0, ax1, yA, az1, bx0, yB, bz0, bx1, yB, bz1, ax1, yA, az1);
      UV.push(0, v0, uRep, v0, 0, v1, uRep, v0, uRep, v1, 0, v1);
      let nx = 0, ny = 1, nz = 0;
      if (vert) { const sg = o.face || 1; nx = -t.nx[i] * sg; ny = 0; nz = -t.nz[i] * sg; }
      else if (yA !== yB) { const w = Math.abs(b0 - a0) || 1, sl = (yB - yA) / w, sg = b0 > a0 ? 1 : -1; const l = Math.hypot(sl, 1); nx = -t.nx[i] * sl * sg / l; nz = -t.nz[i] * sl * sg / l; ny = 1 / l; }
      for (let k = 0; k < 6; k++) NR.push(nx, ny, nz);
      if (o.color) { const c = o.color(i); for (let k = 0; k < 6; k++) C.push(c.r, c.g, c.b); }
      if (o.alpha) { const al0 = o.alpha(i), al1 = o.alpha(j); const e = o.alphaEdge == null ? 1 : o.alphaEdge; A.push(al0 * e, al0 * e, al1 * e, al0 * e, al1 * e, al1 * e); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(NR, 3));
    if (C.length) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    if (A.length) g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(A, 1));
    return g;
  }

  /* foliage normals: point outwards from the middle of the canopy (and a bit up), so a crown is lit like one soft
     blob instead of hundreds of flat cards, whose back faces would otherwise go dark */
  function canopyNormals(geo) {
    geo.computeBoundingBox(); const b = geo.boundingBox, c = new THREE.Vector3(); b.getCenter(c);
    const ext = new THREE.Vector3(); b.getSize(ext); const p = geo.attributes.position.array, n = geo.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      let x = (p[i] - c.x) / (ext.x || 1), y = (p[i + 1] - c.y) / (ext.y || 1) + 0.35, z = (p[i + 2] - c.z) / (ext.z || 1);
      const l = Math.hypot(x, y, z) || 1; n[i] = x / l; n[i + 1] = y / l; n[i + 2] = z / l;
    }
    geo.attributes.normal.needsUpdate = true;
  }

  /* instanced props, bucketed into cells so frustum culling works */
  class Scatter {
    constructor(geo, mat, cell) {
      this.geo = geo; this.mat = mat; this.cell = cell || 150; this.b = new Map(); this.count = 0;
      // r128 only applies per-instance colours when the material uses vertex colours
      if (!geo.attributes.color) { const n = geo.attributes.position.count, c = new Float32Array(n * 3).fill(1); geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      mat.vertexColors = true;
    }
    add(x, y, z, ry, sx, sy, sz, color) {
      const k = this.cell >= 1e5 ? '0' : Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell); let a = this.b.get(k); if (!a) this.b.set(k, a = []);
      a.push([x, y, z, ry || 0, sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz, color]); this.count++;
    }
    build(parent, cast, receive) {
      const d = new THREE.Object3D(), col = new THREE.Color(); const r = this.geo.boundingSphere ? this.geo.boundingSphere.radius : 2;
      this.b.forEach((list) => {
        const g = this.geo.clone(); const im = new THREE.InstancedMesh(g, this.mat, list.length);
        let cx = 0, cy = 0, cz = 0, ms = 1;
        for (let i = 0; i < list.length; i++) {
          const e = list[i]; d.position.set(e[0], e[1], e[2]); d.rotation.set(0, e[3], 0); d.scale.set(e[4], e[5], e[6]); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
          if (e[7] != null) { col.set(e[7]).convertSRGBToLinear(); im.setColorAt(i, col); }
          cx += e[0]; cy += e[1]; cz += e[2]; ms = Math.max(ms, e[4], e[5], e[6]);
        }
        cx /= list.length; cy /= list.length; cz /= list.length; let rad = 0;
        for (let i = 0; i < list.length; i++) rad = Math.max(rad, Math.hypot(list[i][0] - cx, list[i][1] - cy, list[i][2] - cz));
        g.boundingSphere = new THREE.Sphere(V3(cx, cy, cz), rad + r * ms + 1);
        im.castShadow = !!cast; im.receiveShadow = !!receive; im.instanceMatrix.needsUpdate = true; parent.add(im);
      });
    }
  }

  /* ------------------------------------------------------------------ the world */
  class World {
    constructor(renderer, track, opts) {
      opts = opts || {}; this.renderer = renderer; this.track = track; this.q = opts.quality || 'high';
      this.theme = AX.THEMES[track.def.theme] || AX.THEMES.forest; this.rng = AX.RNG(track.def.seed || 5);
      this.scene = new THREE.Scene(); this.aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
      this.startLights = []; this.flags = []; this.disposables = [];
      this.kits = !!(AX.Assets && AX.Assets.has('nature/Pine_1')); this.kenney = !!(AX.Assets && AX.Assets.has('kenney/grandStandCovered'));
      if (track.open) { this._sky(); this._buildPass(); }
      else { this._sky(); this._ground(); this._surfaces(); this._barriers(); this._startArea(); this._stands(); this._props(); if (this.kits) this._nature(); this._trees(); this._backdrop(); }
      for (const k in this._ms) this._ms[k].build();
    }
    std(color, rough, metal, extra) { return new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: rough == null ? 0.85 : rough, metalness: metal || 0 }, extra || {})); }
    vcol(rough, metal, extra) { return new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: rough == null ? 0.85 : rough, metalness: metal || 0 }, extra || {})); }
    add(mesh, cast, receive) { mesh.castShadow = !!cast; mesh.receiveShadow = receive !== false; this.scene.add(mesh); return mesh; }

    _sky() {
      const th = this.theme, sc = this.scene;
      const top = lin(th.sky[0]), hor = lin(th.sky[1]);
      const skyMat = new THREE.ShaderMaterial({
        uniforms: { uTop: { value: top }, uHor: { value: hor } }, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uTop; uniform vec3 uHor; varying vec3 vP; void main(){ float h=clamp(normalize(vP).y,0.0,1.0); vec3 c=mix(uHor,uTop,pow(h,0.55)); gl_FragColor=vec4(pow(c,vec3(1.0/2.2)),1.0); }'
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 24, 12), skyMat); this.sky.frustumCulled = false; sc.add(this.sky);
      sc.fog = new THREE.Fog(lin(th.fog), 420, 2300);
      this.hemi = new THREE.HemisphereLight(lin(th.hemi[0]), lin(th.hemi[1]), th.hemi[2]); sc.add(this.hemi);
      const sun = this.sun = new THREE.DirectionalLight(lin(th.sun), th.sunI); this.sunDir = V3(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
      sun.castShadow = true; const ms = this.q === 'low' ? 1024 : this.q === 'high' ? 4096 : 2048; sun.shadow.mapSize.set(ms, ms);
      this.shadowR = this.q === 'low' ? 55 : 75; const c = sun.shadow.camera; c.left = -this.shadowR; c.right = this.shadowR; c.top = this.shadowR; c.bottom = -this.shadowR; c.near = 20; c.far = 520;
      sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06; sc.add(sun); sc.add(sun.target);
      // environment map for glossy paint and visors
      const pm = new THREE.PMREMGenerator(this.renderer); const es = new THREE.Scene();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 10), new THREE.ShaderMaterial({
        uniforms: { uTop: { value: top }, uHor: { value: hor }, uG: { value: lin(th.grass[0]) } }, side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uG; varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 up=mix(uHor*1.15,uTop,pow(max(h,0.0),0.5)); vec3 dn=mix(uHor,uG*0.6,clamp(-h*4.0,0.0,1.0)); vec3 c=mix(dn,up,step(0.0,h)); gl_FragColor=vec4(c,1.0);\n#include <encodings_fragment>\n}'
      })); es.add(dome);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.4) })); blob.position.copy(this.sunDir).multiplyScalar(42); es.add(blob);
      this.env = pm.fromScene(es, 0.03).texture; pm.dispose(); dome.geometry.dispose(); blob.geometry.dispose();
    }

    _ground() {
      const th = this.theme, b = this.track.bounds;
      const tex = grassTex(th.grass[0], th.grass[1], this.aniso); const size = 4200; tex.repeat.set(size / 22, size / 22);
      const g = new THREE.PlaneGeometry(size, size, 96, 96); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position.array, col = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) { const k = 0.82 + fbm(p[i] / 180 + 9, p[i + 2] / 180 + 3, 0, 4) * 0.36; col[i] = k * 1.02; col[i + 1] = k; col[i + 2] = k * 0.96; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95 }));
      m.position.set((b.minX + b.maxX) / 2, -0.02, (b.minZ + b.maxZ) / 2); this.add(m, false, true);
    }

    _surfaces() {
      const t = this.track, th = this.theme, w = t.hw, kw = t.kerbW, N = t.n;
      // trimmed verge all the way round
      this.add(new THREE.Mesh(ribbon(t, () => -(w + kw + 2.6), () => w + kw + 2.6, { y: 0.0, vLen: 12, uRep: 2, step: 2 }), new THREE.MeshStandardMaterial({ map: dirtTex(th.verge, this.aniso), roughness: 1 })), false, true);
      // gravel
      const gt = gravelTex(th.gravel, this.aniso);
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1;
        this.add(new THREE.Mesh(ribbon(t, (i) => sg * t.g0[s][i], (i) => sg * t.g1[s][i], { y: 0.012, vLen: 6, uRep: 4, cond: (i) => t.g0[s][i] > 0, step: 2 }),
          new THREE.MeshStandardMaterial({ map: gt, roughness: 1, side: THREE.DoubleSide })), false, true);
      }
      // asphalt
      const at = asphaltTex(th.asphalt, this.aniso);
      this.add(new THREE.Mesh(ribbon(t, () => -w, () => w, { y: 0.02, vLen: w * 2, uRep: 1 }), new THREE.MeshStandardMaterial({ map: at, roughness: 0.88, metalness: 0.0 })), false, true);
      // rubbered-in racing line (darker where the bikes brake and turn)
      const lineAlpha = (i) => 0.24 + 0.3 * clamp(Math.abs(t.lk[i]) * 55, 0, 1) + 0.12 * clamp(Math.abs(t.lk[mod(i + 40, N)]) * 55, 0, 1);
      const rubTex = canvasTex(64, 8, (g, W, H) => { const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
      const rub = new THREE.Mesh(ribbon(t, (i) => clamp(t.ld[i] - 2.6, -w + 0.3, w - 0.3), (i) => clamp(t.ld[i] + 2.6, -w + 0.3, w - 0.3), { y: 0.024, alpha: lineAlpha }), decalMaterial(rubTex, new THREE.Color(0x0b0b0d), -1));
      rub.renderOrder = 1; this.scene.add(rub);
      // edge lines
      const lm = new THREE.MeshStandardMaterial({ color: lin(0xeeeeea), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      for (const sg of [-1, 1]) this.add(new THREE.Mesh(ribbon(t, () => sg * (w - 0.42), () => sg * (w - 0.18), { y: 0.026 }), lm), false, true);
      // kerbs: red / white teeth with a raised outer edge
      const red = lin(0xd8322a), white = lin(0xf2f2ee), km = this.vcol(0.75, 0, { side: THREE.DoubleSide });
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1; const cond = (i) => t.kerb[s][i] === 1; const colr = (i) => (Math.floor(i * t.ds / 2.2) % 2 ? red : white);
        this.add(new THREE.Mesh(ribbon(t, () => sg * w, () => sg * (w + kw), { yA: 0.022, yB: 0.085, cond, color: colr }), km), false, true);
        this.add(new THREE.Mesh(ribbon(t, () => sg * (w + kw), () => sg * (w + kw + 0.22), { yA: 0.085, yB: 0.0, cond, color: colr }), km), false, true);
        // dark green astro strip behind the kerbs
      }
      // start / finish
      const chk = canvasTex(256, 32, (g, W, H) => { for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#f4f4f0' : '#141518'; g.fillRect(x * 8, y * 8, 8, 8); } });
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.6), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      fl.rotation.x = -Math.PI / 2; const fg = new THREE.Group(); fg.position.set(t.px[0], 0.028, t.pz[0]); fg.rotation.y = -t.yaw[0] + Math.PI / 2; fg.add(fl); fl.receiveShadow = true; this.scene.add(fg);
      // grid boxes
      const gb = new GeoBuilder();
      for (let n = 0; n < 12; n++) {
        const s = t.gridSlot(n), yaw = s[2];
        const fx = Math.cos(yaw), fz = Math.sin(yaw);
        const bar = (lx, lz, len, wid, rot) => gb.add(new THREE.BoxGeometry(len, 0.004, wid), M(s[0] + fx * lx - fz * lz, 0.028, s[1] + fz * lx + fx * lz, 0, -yaw + (rot || 0), 0), 0xf0f0ec);
        bar(1.5, 0, 0.14, 2.4, 0); bar(0.9, -1.2, 1.2, 0.14, 0); bar(0.9, 1.2, 1.2, 0.14, 0);
      }
      const gm = new THREE.Mesh(gb.build(), this.vcol(0.7, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); gm.receiveShadow = true; this.scene.add(gm);
    }

    _barriers() {
      const t = this.track, N = t.n, sc = this.scene;
      const tyreGeo = (() => { const pts = []; for (let k = 0; k < 3; k++) { const y0 = k * 0.36; pts.push(new THREE.Vector2(0.24, y0), new THREE.Vector2(0.44, y0 + 0.18)); } pts.push(new THREE.Vector2(0.24, 1.08)); const g = new THREE.LatheGeometry(pts, 8); g.computeBoundingSphere(); return g; })();
      const tyres = new Scatter(tyreGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), 300);
      const postGeo = new THREE.BoxGeometry(0.12, 0.95, 0.16); postGeo.translate(0, 0.475, 0); postGeo.computeBoundingSphere();
      const posts = new Scatter(postGeo, this.std(0x8c9298, 0.6, 0.5), 300);
      const fpostGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6); fpostGeo.translate(0, 1.8, 0); fpostGeo.computeBoundingSphere();
      const fposts = new Scatter(fpostGeo, this.std(0x9aa0a6, 0.5, 0.6), 300);
      const railMat = this.std(0xb9bec4, 0.42, 0.7, { side: THREE.DoubleSide }), wallMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9, side: THREE.DoubleSide });
      const fenceMat = new THREE.MeshBasicMaterial({ map: fenceTex(), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      const stripeMat = this.vcol(0.8, 0, { side: THREE.DoubleSide });
      const tyreCols = [0xd8322a, 0xf2f2ee, 0x1f6fe0, 0xf2f2ee, 0x202225, 0x202225];
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1, bar = t.bar[s], type = t.barType[s]; const off = (d) => (i) => sg * (bar[i] + d);
        const isT = (k) => (i) => type[i] === k;
        // armco: two rails on posts
        for (const y of [0.34, 0.68]) this.add(new THREE.Mesh(ribbon(t, off(0.02), off(0.02), { yA: y, yB: y + 0.26, vertical: true, face: sg, cond: isT(0), step: 2 }), railMat), true, true);
        // tyre walls with a low backing wall
        this.add(new THREE.Mesh(ribbon(t, off(0.95), off(0.95), { yA: 0, yB: 1.2, vertical: true, face: sg, cond: isT(1), step: 2, vLen: 3 }), wallMat), true, true);
        // concrete pit / grandstand wall + painted base stripe + debris fence
        this.add(new THREE.Mesh(ribbon(t, off(0.0), off(0.0), { yA: 0, yB: 1.05, vertical: true, face: sg, cond: isT(2), step: 2, vLen: 3 }), wallMat), true, true);
        this.add(new THREE.Mesh(ribbon(t, off(0.0), off(0.35), { y: 1.05, cond: isT(2), step: 2, vLen: 3 }), wallMat), true, true);
        this.add(new THREE.Mesh(ribbon(t, off(0.35), off(0.35), { yA: 0, yB: 1.05, vertical: true, face: sg, cond: isT(2), step: 2, vLen: 3 }), wallMat), false, true);
        const sr = lin(0xd8322a), sw = lin(0xf2f2ee);
        this.add(new THREE.Mesh(ribbon(t, off(-0.015), off(-0.015), { yA: 0.02, yB: 0.36, vertical: true, face: sg, cond: isT(2), step: 2, color: (i) => (Math.floor(i / 6) % 2 ? sr : sw) }), stripeMat), false, false);
        if (s === 0) { const fm = new THREE.Mesh(ribbon(t, off(0.18), off(0.18), { yA: 1.05, yB: 3.6, vertical: true, face: sg, cond: isT(2), step: 2, vLen: 1.6, uRep: 1.6 }), fenceMat); fm.renderOrder = 2; sc.add(fm); }
        let acc = 0, accP = 0, accF = 0, n = 0;
        for (let i = 0; i < N; i++) {
          const x = t.px[i] + t.nx[i] * sg * bar[i], z = t.pz[i] + t.nz[i] * sg * bar[i];
          const j = (i + 1) % N; const segLen = Math.hypot(t.px[j] + t.nx[j] * sg * bar[j] - x, t.pz[j] + t.nz[j] * sg * bar[j] - z);
          if (type[i] === 1) { acc += segLen; while (acc > 0.86) { acc -= 0.86; tyres.add(x + t.nx[i] * sg * 0.45, 0, z + t.nz[i] * sg * 0.45, n * 0.7, 1, 1, 1, tyreCols[Math.floor(n / 5) % tyreCols.length]); n++; } }
          else if (type[i] === 0) { accP += segLen; if (accP > 3.2) { accP = 0; posts.add(x + t.nx[i] * sg * 0.1, 0, z + t.nz[i] * sg * 0.1, -t.yaw[i]); } }
          else if (s === 0) { accF += segLen; if (accF > 4.5) { accF = 0; fposts.add(x + t.nx[i] * sg * 0.18, 0, z + t.nz[i] * sg * 0.18, 0); } }
        }
      }
      tyres.build(sc, true, true); posts.build(sc, true, false); fposts.build(sc, true, false);
    }

    /* local frame helper at track sample i: returns a Group placed at lateral offset d, facing along the track */
    frame(i, d, y) { const t = this.track; i = mod(i, t.n); const g = new THREE.Group(); g.position.set(t.px[i] + t.nx[i] * d, y || 0, t.pz[i] + t.nz[i] * d); g.rotation.y = -t.yaw[i]; return g; }

    _startArea() {
      const t = this.track, w = t.hw, sc = this.scene;
      // ---- start gantry with five light pods
      const g = this.frame(6, 0), gb = new GeoBuilder(); const span = w + 2.2;
      for (const z of [-span, span]) { gb.add(roundedBox(0.5, 7.4, 0.5, 0.08, 2), M(0, 3.7, z), 0x2a2d33); gb.add(roundedBox(1.2, 0.5, 1.2, 0.08, 2), M(0, 0.25, z), 0x9aa0a6); }
      gb.add(roundedBox(0.7, 1.5, span * 2 + 0.6, 0.1, 2), M(0, 7.2, 0), 0x22252a);
      gb.add(roundedBox(0.5, 0.9, 6.2, 0.1, 2), M(-0.4, 6.0, 0), 0x15171a);
      const gm = new THREE.Mesh(gb.build(), this.vcol(0.6, 0.2)); gm.castShadow = true; g.add(gm);
      for (let k = 0; k < 5; k++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshBasicMaterial({ color: 0x220806 })); m.position.set(-0.68, 6.0, (k - 2) * 1.15); g.add(m); this.startLights.push(m);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 1, 1.1), new THREE.MeshBasicMaterial({ map: brandTex(5) })); sign.position.set(-0.37, 7.2, 0); sign.rotation.y = -Math.PI / 2; g.add(sign);
      const sign2 = sign.clone(); sign2.position.x = 0.37; sign2.rotation.y = Math.PI / 2; g.add(sign2);
      sc.add(g);
      // ---- pit building on the infield side of the straight
      const bLen = 132, depth = 13, hgt = 7.5; const base = t.bar[1][0] + 9.5;
      const pit = this.frame(-34, base + depth / 2), pb = new GeoBuilder();
      pb.add(roundedBox(bLen, hgt, depth, 0.25, 2), M(0, hgt / 2, 0), 0xe9e6de);
      pb.add(roundedBox(bLen + 2, 0.5, depth + 3.5, 0.15, 2), M(0, hgt + 0.25, -1), 0xa9adb3);
      for (let k = 0; k < 9; k++) { const x = bLen * 0.06 + k * (bLen * 0.42 / 9); pb.add(roundedBox(3.2, 0.9, 2.4, 0.12, 1), M(x, hgt + 0.95, 2.5), k % 3 ? 0xd9dce0 : 0x7c8187); pb.add(roundedBox(4.5, 0.25, 1.6, 0.05, 1), M(x, hgt + 0.6, -3.5), 0x3d6f9a); }
      pb.add(roundedBox(bLen - 6, 2.2, 0.3, 0.05, 1), M(0, 5.6, -depth / 2 - 0.05), 0x3d6f9a);                 // glazing band
      pb.add(roundedBox(bLen * 0.42, 3.4, depth * 0.7, 0.2, 2), M(-bLen * 0.2, hgt + 2.2, 1), 0xf3f1ea);      // race control
      pb.add(roundedBox(bLen * 0.42 - 2, 1.6, 0.3, 0.05, 1), M(-bLen * 0.2, hgt + 2.4, 1 - depth * 0.35 - 0.05), 0x2c5b86);
      pb.add(roundedBox(bLen * 0.44, 0.35, depth * 0.76, 0.1, 1), M(-bLen * 0.2, hgt + 4.05, 1), 0xc9ccd1);
      const teamCols = AX.RIDERS.map((r) => r.c1); const nG = 12, gw = (bLen - 8) / nG;
      for (let k = 0; k < nG; k++) {
        const x = -bLen / 2 + 4 + gw * (k + 0.5);
        pb.add(roundedBox(gw - 1.4, 3.6, 0.5, 0.05, 1), M(x, 1.8, -depth / 2 + 0.1), 0x1b1d21);     // garage opening
        pb.add(roundedBox(gw - 0.8, 0.8, 0.3, 0.05, 1), M(x, 4.2, -depth / 2 - 0.1), teamCols[k % teamCols.length]);
      }
      if (this.kenney) {
        // garages along the pit lane, offices at both ends; the old block only keeps its race-control tower
        pb.pos.length = 0; pb.nor.length = 0; pb.col.length = 0;
        pb.add(roundedBox(26, 4.5, depth * 0.7, 0.3, 2), M(-bLen * 0.15, hgt + 2.4, 1.5), 0xf3f1ea); pb.add(roundedBox(25, 1.6, 0.3, 0.05, 1), M(-bLen * 0.15, hgt + 2.9, 1.5 - depth * 0.35 - 0.05), 0x2c5b86);
        pb.add(roundedBox(28, 0.35, depth * 0.8, 0.1, 1), M(-bLen * 0.15, hgt + 4.8, 1.5), 0xa9adb3);
        pit.updateMatrixWorld(true); const S = 11, ry = pit.rotation.y + Math.PI, n = Math.floor((bLen - 2 * S) / S), v = V3();
        const kT = (mat) => { if (mat.name === 'red') mat.color = lin(0xd9483c); mat.roughness = 0.8; };
        for (let k = -1; k <= n; k++) {
          const name = k === -1 || k === n ? 'kenney/pitsOffice' : (k % 4 === 3 ? 'kenney/pitsGarageClosed' : 'kenney/pitsGarage');
          v.set(-bLen / 2 + S * (k + 1.5), 0, 0).applyMatrix4(pit.matrixWorld); this.kitPlace(name, v.x, 0, v.z, ry, S, { tint: kT });
        }
      }
      const pm = new THREE.Mesh(pb.build(), this.vcol(0.8)); pm.castShadow = true; pm.receiveShadow = true; pit.add(pm);
      // pit apron (asphalt) in front of the garages
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(bLen + 30, 9), this.std(0x676a72, 0.9)); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.015, -depth / 2 - 4.7); apron.receiveShadow = true; pit.add(apron);
      const pline = new THREE.Mesh(new THREE.PlaneGeometry(bLen + 30, 0.2), this.std(0xf0d21a, 0.7)); pline.rotation.x = -Math.PI / 2; pline.position.set(0, 0.03, -depth / 2 - 8.2); pit.add(pline);
      // flags on the roof
      for (let k = 0; k < 7; k++) {
        const fx = -bLen / 2 + 8 + k * (bLen - 16) / 6; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 6), this.std(0xd8dade, 0.4, 0.6)); pole.position.set(fx, hgt + 3, depth / 2 - 1.5); pit.add(pole);
        const fg = new THREE.PlaneGeometry(2.4, 1.3, 6, 2); fg.translate(1.2, 0, 0);
        const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: lin(teamCols[(k * 3) % teamCols.length]), side: THREE.DoubleSide, roughness: 0.8 })); flag.position.set(fx, hgt + 4.7, depth / 2 - 1.5); pit.add(flag); this.flags.push(flag);
      }
      // paddock: trucks and tents behind the building
      const truckCols = [0xe8372c, 0x1f6fe0, 0xf2f2ee, 0x22252b, 0xf4a21a, 0x19b36b];
      const tb = new GeoBuilder();
      for (let k = 0; k < 7; k++) {
        const x = -bLen / 2 + 12 + k * 17, z = depth / 2 + 9 + (k % 2) * 2, c = truckCols[k % truckCols.length];
        tb.add(roundedBox(3, 3.4, 12, 0.25, 2), M(x, 2.3, z + 2), c); tb.add(roundedBox(2.9, 2.8, 2.6, 0.4, 3), M(x, 1.9, z - 6), 0xf0f0ec); tb.add(roundedBox(2.5, 0.9, 0.2, 0.05, 1), M(x, 2.5, z - 7.3), 0x1c2a3a);
        for (const wz of [-6, 0, 5, 6.4]) for (const wx of [-1.35, 1.35]) tb.add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10), M(x + wx, 0.5, z + wz, 0, 0, Math.PI / 2), 0x16171a);
        // awning tent next to the truck
        if (this.kenney) { pit.updateMatrixWorld(true); const v = V3(x + 5.4, 0, z + 2).applyMatrix4(pit.matrixWorld); this.kitPlace(k % 2 ? 'kenney/tentLong' : 'kenney/tentClosedLong', v.x, 0, v.z, pit.rotation.y + Math.PI / 2, 6.5); }
        else { tb.add(roundedBox(6, 0.25, 9, 0.1, 1), M(x + 5.2, 3.0, z + 2), 0xf6f6f2); for (const a of [-2.7, 2.7]) for (const b2 of [-4.2, 4.2]) tb.add(new THREE.CylinderGeometry(0.06, 0.06, 3, 5), M(x + 5.2 + a, 1.5, z + 2 + b2), 0xb0b4b8); }
      }
      const tm = new THREE.Mesh(tb.build(), this.vcol(0.7)); tm.castShadow = true; tm.receiveShadow = true; pit.add(tm);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(bLen + 20, 34), this.std(0x74777e, 0.92)); pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.012, depth / 2 + 15); pad.receiveShadow = true; pit.add(pad);
      sc.add(pit); this.reserve(pit.position.x, pit.position.z, bLen / 2 + 22);
      // lap-distance boards before the heavier braking zones
      for (const c of t.corners) {
        if (c.radius > 60) continue; const side = c.dir > 0 ? 0 : 1, sg = side ? 1 : -1;
        [['150', 150], ['100', 100], ['50', 50]].forEach(([txt, dist]) => {
          const i = mod(c.from - dist + 10, t.n); if (t.barType[side][i] === 2) return;
          const f = this.frame(i, sg * (t.bar[side][i] - 1.0));
          const b = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshBasicMaterial({ map: textTex(txt, '#f4f4f0', '#141518'), side: THREE.DoubleSide })); b.position.y = 1.55; b.rotation.y = -Math.PI / 2; f.add(b);
          const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), this.std(0x777b80)); p.position.y = 0.6; p.castShadow = true; f.add(p); sc.add(f);
        });
      }
    }

    standGeometry(len, rows, roof) {
      const gb = new GeoBuilder(), rd = 0.95, rh = 0.55; const seatCols = [0x2f6fd0, 0xd8322a, 0xf0c21a, 0xe8e8e4];
      for (let r = 0; r < rows; r++) {
        gb.add(new THREE.BoxGeometry(len, rh * (r + 1) + 0.8, rd), M(0, (rh * (r + 1) + 0.8) / 2, r * rd), 0xc9ccd0);
        gb.add(new THREE.BoxGeometry(len - 0.6, 0.16, rd * 0.55), M(0, rh * (r + 1) + 0.88, r * rd - 0.1), seatCols[Math.floor(r / 2) % 4]);
      }
      const back = rows * rd, top = rh * rows + 0.8;
      gb.add(new THREE.BoxGeometry(len, top + 2.4, 0.3), M(0, (top + 2.4) / 2, back), 0xaeb3b9);
      for (const x of [-len / 2, len / 2]) gb.add(new THREE.BoxGeometry(0.3, top + 1.2, back), M(x, (top + 1.2) / 2, back / 2 - rd / 2), 0xb8bcc2);
      if (roof) {
        gb.add(roundedBox(len + 2, 0.3, back + 3.5, 0.1, 1), M(0, top + 4.4, back / 2 - 1.2, 0.09, 0, 0), 0xeef0f2);
        for (let k = 0; k <= Math.round(len / 6); k++) gb.add(new THREE.BoxGeometry(0.25, 0.12, back + 3.5), M(-len / 2 - 1 + k * (len + 2) / Math.round(len / 6), top + 4.6, back / 2 - 1.2, 0.09, 0, 0), 0xc3c7cc);
        const nP = Math.max(2, Math.round(len / 9)); for (let k = 0; k <= nP; k++) gb.add(new THREE.CylinderGeometry(0.14, 0.14, top + 4.3, 6), M(-len / 2 + k * len / nP, (top + 4.3) / 2, back - 0.3), 0x8c9298);
      }
      return gb.build();
    }
    _stands() {
      const t = this.track, sc = this.scene, rng = this.rng; const mat = this.vcol(0.85);
      const pg = new GeoBuilder(); pg.add(new THREE.BoxGeometry(0.42, 0.6, 0.3), M(0, 0.3, 0), 0xffffff); pg.add(new THREE.SphereGeometry(0.17, 5, 4), M(0, 0.76, 0), 0xe8c8a8);
      const pgeo = pg.build(); const crowd = new Scatter(pgeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 260);
      const shirts = [0xe8372c, 0x1f6fe0, 0xf4f4f0, 0xf4a21a, 0x19b36b, 0x22252b, 0xff5fa2, 0x7b3fe0, 0xf0d21a, 0x11b9c9];
      const kTint = (mat) => { if (mat.name === 'red') mat.color = lin(0xd9483c); if (mat.name === 'grey') mat.color = lin(0xe9e8e4); mat.roughness = 0.85; };
      const placeKit = (i, side, len, roof) => {
        const name = roof ? 'kenney/grandStandCovered' : 'kenney/grandStand', S = 8.5, m = AX.Assets.get(name), depth = (m.box.max.z - m.box.min.z) * S;
        const sg = side ? 1 : -1; const f = this.frame(i, sg * (t.bar[side][mod(i, t.n)] + 2.5 + depth / 2)); if (sg < 0) f.rotation.y += Math.PI; f.updateMatrixWorld(true);
        const n = Math.max(2, Math.round(len / S)), seats = this.seats(name), v = V3(), ry = f.rotation.y + Math.PI;   // Kenney fronts face +z, ours face the track (-z)
        for (let k = 0; k < n; k++) {
          v.set((k - (n - 1) / 2) * S * 0.995, 0, 0).applyMatrix4(f.matrixWorld);
          const W = this.kitPlace(name, v.x, 0, v.z, ry, S, { tint: kTint });
          for (const p of seats.pts) { if (rng() > 0.82) continue; const q = p.clone().applyMatrix4(W); crowd.add(q.x, q.y, q.z, ry, 1, rng.range(0.9, 1.12), 1, rng.pick(shirts)); }
        }
        this.reserve(f.position.x, f.position.z, len / 2 + 4);
      };
      const place = (i, side, len, rows, roof) => {
        if (this.kenney) return placeKit(i, side, len, roof);
        const sg = side ? 1 : -1; const f = this.frame(i, sg * (t.bar[side][mod(i, t.n)] + 3.6)); if (sg < 0) f.rotation.y += Math.PI;
        const m = new THREE.Mesh(this.standGeometry(len, rows, roof), mat); m.castShadow = true; m.receiveShadow = true; f.add(m); sc.add(f); f.updateMatrixWorld(true);
        const v = V3();
        for (let r = 0; r < rows; r++) for (let x = -len / 2 + 0.6; x < len / 2 - 0.5; x += 0.62) {
          if (rng() > 0.78) continue; v.set(x + rng.range(-0.1, 0.1), 0.55 * (r + 1) + 0.96, r * 0.95 - 0.1).applyMatrix4(f.matrixWorld);
          crowd.add(v.x, v.y, v.z, f.rotation.y + Math.PI, 1, rng.range(0.9, 1.12), 1, rng.pick(shirts));
        }
      };
      // main grandstands opposite the pits
      place(-96, 0, 58, 9, true); place(-28, 0, 62, 11, true); place(44, 0, 58, 9, true);
      // spectator banks on the outside of the slow corners
      let n = 0;
      for (const c of t.corners) {
        if (c.radius > 62 || n >= 4) continue; const side = c.dir > 0 ? 0 : 1; const i = mod(c.apex + 6, t.n);
        if (t.barType[side][i] === 2) continue;
        const sg = side ? 1 : -1, x = t.px[i] + t.nx[i] * sg * (t.bar[side][i] + 16), z = t.pz[i] + t.nz[i] * sg * (t.bar[side][i] + 16);
        if (t._otherDist(x, z, i, 80) < 30) continue;
        place(c.apex + 6, side, 34, 6, n % 2 === 0); n++;
      }
      crowd.build(sc, false, true); this.crowdCount = crowd.count;
    }

    _props() {
      const t = this.track, sc = this.scene, rng = this.rng, N = t.n;
      // ---- advertising boards behind the tyre walls and along the armco
      const nB = BRANDS.length, bp = [], bu = []; for (let k = 0; k < nB; k++) { bp.push([]); bu.push([]); } let bi = 0;
      const frameB = new GeoBuilder(), v = V3(); const quad = [[-3, 0], [3, 0], [3, 1.15], [-3, 0], [3, 1.15], [-3, 1.15]];
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1;
        for (let i = 0; i < N; i += 7) {
          const ty = t.barType[s][i]; if (ty === 2) continue;
          const block = Math.floor(i / 70) % 3; if (ty === 0 && block !== 0) continue; if (ty === 1 && block === 2) continue;
          const d = sg * (t.bar[s][i] + (ty === 1 ? 1.35 : 0.5)); const f = this.frame(i, d); f.updateMatrixWorld(true);
          const y0 = ty === 1 ? 1.3 : 1.05, b = (bi + Math.floor(i / 28)) % nB;
          for (const qd of quad) { v.set(qd[0], y0 + qd[1], 0).applyMatrix4(f.matrixWorld); bp[b].push(v.x, v.y, v.z); bu[b].push(sg > 0 ? 1 - (qd[0] + 3) / 6 : (qd[0] + 3) / 6, qd[1] / 1.15); }
          for (const x of [-2.9, 2.9]) frameB.add(new THREE.BoxGeometry(0.1, 2.4, 0.1), M(x, 1.2, 0.08 * sg).premultiply(f.matrixWorld), 0x6f747a);
        }
        bi += 3;
      }
      for (let k = 0; k < nB; k++) {
        if (!bp[k].length) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(bp[k], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(bu[k], 2));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: brandTex(k), side: THREE.DoubleSide })); m.castShadow = true; sc.add(m);
      }
      const fm = new THREE.Mesh(frameB.build(), this.vcol(0.7)); fm.castShadow = true; sc.add(fm);
      // ---- banner bridges over the track
      const picks = []; for (let k = 1; k <= 3; k++) { let i = Math.round(N * k / 4 + 30); let tries = 0; while (tries++ < 60 && (Math.abs(t.k[mod(i, N)]) > 1 / 300 || t.barType[0][mod(i, N)] === 2)) i += 7; if (tries < 60) picks.push(mod(i, N)); }
      picks.forEach((i, n) => {
        const span = Math.max(t.bar[0][i], t.bar[1][i]) + 1.2; const f = this.frame(i, 0), gb = new GeoBuilder(); const col = [0xf4c20d, 0x1d4ed8, 0xd6243a][n % 3];
        const segs = 14, R = span, H = 7.2;
        for (let k = 0; k < segs; k++) {
          const a0 = Math.PI * k / segs, a1 = Math.PI * (k + 1) / segs;
          gb.add(tubeBetween(V3(0, Math.sin(a0) * H, Math.cos(a0) * R), V3(0, Math.sin(a1) * H, Math.cos(a1) * R), 0.55, 0.55, 8), M(0, 0, 0, 0, 0, 0, 2.2, 1, 1), col);
        }
        const m = new THREE.Mesh(gb.build(), this.vcol(0.6)); m.castShadow = true; f.add(m);
        const sgn = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.1, 1.5), new THREE.MeshBasicMaterial({ map: brandTex(n * 3 + 1), side: THREE.DoubleSide })); sgn.position.set(-1.3, H - 1.6, 0); sgn.rotation.y = -Math.PI / 2; f.add(sgn);
        sc.add(f);
      });
      // ---- marshal posts at every corner + floodlight masts on the main straight
      const mb = new GeoBuilder();
      t.corners.forEach((c, n) => {
        const side = c.dir > 0 ? 0 : 1, sg = side ? 1 : -1, i = mod(c.from + 4, N); if (t.barType[side][i] === 2) return;
        const mt = M(0, 0, 0); const f = this.frame(i, sg * (t.bar[side][i] + 2.6)); f.updateMatrixWorld(true); const W = f.matrixWorld;
        mb.add(roundedBox(2.4, 0.3, 2.4, 0.05, 1), M(0, 1.0, 0).premultiply(W), 0x9aa0a6);
        for (const a of [-1, 1]) for (const b of [-1, 1]) mb.add(new THREE.BoxGeometry(0.12, 3.2, 0.12), M(a * 1.05, 1.6, b * 1.05).premultiply(W), 0x7c8187);
        mb.add(roundedBox(2.9, 0.22, 2.9, 0.08, 1), M(0, 3.3, 0).premultiply(W), 0xf27a1a);
        mb.add(roundedBox(0.42, 0.75, 0.3, 0.12, 2), M(0.3, 1.55, 0).premultiply(W), 0xf27a1a); mb.add(new THREE.SphereGeometry(0.18, 8, 6), M(0.3, 2.1, 0).premultiply(W), 0xf2f2ee);
        mb.add(new THREE.BoxGeometry(0.05, 1.0, 0.05), M(0.3, 2.2, -sg * 0.5, 0.5 * sg, 0, 0).premultiply(W), 0x55585c); mb.add(new THREE.BoxGeometry(0.03, 0.5, 0.7), M(0.3, 2.55, -sg * 1.0).premultiply(W), 0xf0d21a);
      });
      for (let k = 0; k < 6; k++) {
        const i = mod(-120 + k * 52, N); const f = this.frame(i, -(t.bar[0][i] + 15.5)); f.updateMatrixWorld(true); const W = f.matrixWorld;
        mb.add(new THREE.CylinderGeometry(0.22, 0.34, 26, 8), M(0, 13, 0).premultiply(W), 0xb4b8bd); mb.add(roundedBox(0.5, 2.2, 5, 0.1, 1), M(0, 26, 0, 0, 0, 0.25).premultiply(W), 0x34383e);
      }
      const mm = new THREE.Mesh(mb.build(), this.vcol(0.7)); mm.castShadow = true; mm.receiveShadow = true; sc.add(mm);
      if (this.kenney) this._kitProps();
      // ---- theme dressing
      if (t.def.theme === 'coast') this._harbour(); else if (t.def.theme === 'forest') this._lake();
    }

    _kitProps() {
      const t = this.track, N = t.n, rng = AX.RNG((t.def.seed || 5) + 99), w = t.hw;
      const at = (i, s, lat) => { i = mod(i, N); const sg = s ? 1 : -1; return [t.px[i] + t.nx[i] * sg * lat, t.pz[i] + t.nz[i] * sg * lat, -t.yaw[i] + (s ? 0 : Math.PI)]; };
      // floodlights along the pit straight, flags behind the grandstand wall
      for (let k = -5; k <= 5; k++) { const i = mod(k * 24, N); const [x, z, r] = at(i, 1, t.bar[1][i] + 1.2); this.kitPlace('kenney/lightPostModern', x, 0, z, r, 11); }
      ['kenney/flagRed', 'kenney/flagCheckers', 'kenney/flagGreen', 'kenney/flagTankco'].forEach((f, k) => { for (const o of [-1, 1]) { const i = mod(o * (14 + k * 7), N); const [x, z, r] = at(i, 0, t.bar[0][i] + 0.9); this.kitPlace(f, x, 1.05, z, r, 4.2); } });
      // marker cones on the inside of the slow corners, banner towers on the outside of the quick ones
      t.corners.forEach((c, n) => {
        const inS = c.dir > 0 ? 1 : 0, outS = 1 - inS;
        if (c.radius < 55) for (const o of [-6, 0, 6]) { const i = mod(c.apex + o, N); const [x, z, r] = at(i, inS, w + t.kerbW + 1.0); if (this.clear(x, z, -t.hw - 6)) this.kitPlace('kenney/pylon', x, 0, z, r + rng() * 6, 7.5, { tint: (m) => { m.color = lin(0xf26a1f); m.roughness = 0.6; } }); }
        const i = mod(c.from - 20, N); if (t.barType[outS][i] === 2) return; const [x, z, r] = at(i, outS, t.bar[outS][i] + 4.5);
        if (this.clear(x, z, 3) && this.free(x, z, 3)) { this.kitPlace(n % 2 ? 'kenney/bannerTowerRed' : 'kenney/bannerTowerGreen', x, 0, z, r + Math.PI / 2, 7); this.reserve(x, z, 4); }
      });
      // a few event tents and food stalls behind the corner grandstands
      for (let n = 0; n < 18; n++) {
        const i = rng.int(0, N - 1), s = rng.int(0, 1), [x, z, r] = at(i, s, t.bar[s][i] + rng.range(14, 26));
        if (!this.clear(x, z, 10) || !this.free(x, z, 6)) continue; this.kitPlace(rng.pick(['kenney/tent', 'kenney/tentClosed', 'kenney/tentRoof', 'kenney/tentRoofDouble']), x, 0, z, r + (rng() < 0.5 ? 0 : Math.PI / 2), 6.5); this.reserve(x, z, 6);
      }
    }

    /* is (x,z) clear of the circuit by at least `margin` metres beyond the barriers? */
    clear(x, z, margin) {
      const t = this.track; const i = t.nearest(x, z, -1); const d = t.lateral(i, x, z); const s = d < 0 ? 0 : 1;
      const dist = Math.hypot(x - t.px[i], z - t.pz[i]);
      return dist > t.bar[s][i] + margin;
    }
    reserve(x, z, r) { (this.reserved || (this.reserved = [])).push([x, z, r]); }
    free(x, z, pad) { if (!this.reserved) return true; for (const r of this.reserved) if (Math.hypot(x - r[0], z - r[1]) < r[2] + (pad || 0)) return false; return true; }

    _harbour() {
      const t = this.track, b = t.bounds, sc = this.scene, rng = this.rng;
      // the sea to the south, a quay edge, container stacks and two gantry cranes
      const seaZ = b.maxZ + 70;
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 2400), new THREE.MeshStandardMaterial({ color: lin(0x2f86c0), roughness: 0.25, metalness: 0.2, envMap: this.env, envMapIntensity: 0.9 }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.05, seaZ + 1200); sea.receiveShadow = true; sc.add(sea);
      const quay = new THREE.Mesh(new THREE.BoxGeometry(5000, 1.6, 34), this.std(0xb9b6ad, 0.95)); quay.position.set(0, -0.6, seaZ - 17); quay.receiveShadow = true; sc.add(quay);
      this.reserve(0, seaZ + 1200, 1205);
      const cgeo = roundedBox(12, 2.6, 2.5, 0.06, 1); cgeo.computeBoundingSphere();
      const cont = new Scatter(cgeo, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), 160);
      const cols = [0xc2452d, 0x2e6fb7, 0xe0a321, 0x3f8f5a, 0x8a8f96, 0x7a3fb0, 0xd9d9d4, 0x1f3a5f];
      for (let n = 0; n < 46; n++) {
        const x = rng.range(b.minX - 150, b.maxX + 150), z = seaZ - rng.range(3, 28), rot = rng() < 0.8 ? 0 : Math.PI / 2;
        if (!this.clear(x, z, 9)) continue; const h = rng.int(1, 4), len = rng.int(1, 3);
        for (let l = 0; l < len; l++) for (let k = 0; k < h; k++) cont.add(x + (rot ? 0 : l * 0), 1.3 + k * 2.62, z + l * 2.6, rot, 1, 1, 1, rng.pick(cols));
        this.reserve(x, z, 10);
      }
      // stacks on open ground inside and around the lap
      for (let n = 0; n < 260; n++) {
        const x = rng.range(b.minX - 120, b.maxX + 120), z = rng.range(b.minZ - 90, seaZ - 40);
        if (!this.clear(x, z, 12) || !this.free(x, z, 9)) continue; const rot = rng() < 0.5 ? 0 : Math.PI / 2, h = rng.int(1, 3), len = rng.int(1, 4);
        for (let l = 0; l < len; l++) for (let k = 0; k < h - (l === len - 1 && h > 1 ? rng.int(0, 1) : 0); k++) cont.add(x + (rot ? l * 2.6 : 0), 1.3 + k * 2.62, z + (rot ? 0 : l * 2.6), rot, 1, 1, 1, rng.pick(cols));
        this.reserve(x, z, 11);
      }
      cont.build(sc, true, true);
      const cb = new GeoBuilder();
      for (const cx of [b.minX + 120, b.maxX - 160]) {
        const z = seaZ - 12; for (const a of [-9, 9]) for (const c2 of [-7, 7]) cb.add(new THREE.BoxGeometry(1.2, 34, 1.2), M(cx + a, 17, z + c2), 0xe8372c);
        cb.add(new THREE.BoxGeometry(22, 2, 16), M(cx, 34, z), 0xe8372c); cb.add(new THREE.BoxGeometry(3, 2.4, 78), M(cx, 37, z + 18), 0xd8322a);
        cb.add(new THREE.BoxGeometry(5, 4, 6), M(cx, 34.6, z + 30), 0xf2f2ee); cb.add(new THREE.BoxGeometry(1, 16, 1), M(cx, 46, z - 4), 0xd8322a);
        this.reserve(cx, z, 26);
      }
      // a moored ship
      cb.add(roundedBox(150, 14, 26, 3, 3), M(b.minX + 330, 4, seaZ + 26), 0x1f3a5f); cb.add(roundedBox(150, 2, 26.4, 0.5, 2), M(b.minX + 330, 0.6, seaZ + 26), 0xb23a2a);
      cb.add(roundedBox(22, 20, 22, 1, 2), M(b.minX + 270, 21, seaZ + 26), 0xf2f2ee); cb.add(new THREE.CylinderGeometry(3, 3.4, 9, 12), M(b.minX + 270, 35, seaZ + 26), 0xe8372c);
      const cm = new THREE.Mesh(cb.build(), this.vcol(0.6, 0.2)); cm.castShadow = true; cm.receiveShadow = true; sc.add(cm);
    }
    _lake() {
      const t = this.track, b = t.bounds, rng = this.rng;
      for (let tries = 0; tries < 200; tries++) {
        const x = rng.range(b.minX + 40, b.maxX - 40), z = rng.range(b.minZ + 40, b.maxZ - 40), r = rng.range(26, 40);
        let ok = true; for (let a = 0; a < 8 && ok; a++) ok = this.clear(x + Math.cos(a * 0.785) * r * 1.25, z + Math.sin(a * 0.785) * r * 1.25, 6);
        if (!ok) continue;
        const sh = new THREE.Shape(); for (let a = 0; a <= 40; a++) { const an = a / 40 * Math.PI * 2, rr = r * (0.8 + 0.25 * Math.sin(an * 3 + 1) + 0.12 * Math.sin(an * 5)); a ? sh.lineTo(Math.cos(an) * rr, Math.sin(an) * rr * 0.75) : sh.moveTo(Math.cos(an) * rr, Math.sin(an) * rr * 0.75); }
        const lake = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24), new THREE.MeshStandardMaterial({ color: lin(0x3f8fc0), roughness: 0.15, metalness: 0.3, envMap: this.env, envMapIntensity: 1.1 }));
        lake.rotation.x = -Math.PI / 2; lake.position.set(x, 0.03, z); lake.receiveShadow = true; this.scene.add(lake);
        const shore = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24), this.std(0xcdbb8a, 1)); shore.rotation.x = -Math.PI / 2; shore.scale.setScalar(1.09); shore.position.set(x, 0.015, z); shore.receiveShadow = true; this.scene.add(shore);
        this.reserve(x, z, r * 1.15); break;
      }
    }

    /* instanced placement of a packed model (one InstancedMesh per material per cell) */
    ms(name, opts) {
      this._ms = this._ms || {}; const key = name + (opts && opts.key ? '#' + opts.key : '');
      if (this._ms[key]) return this._ms[key];
      const m = AX.Assets.get(name); if (!m) return null; opts = opts || {};
      const parts = m.parts.map((p) => {
        const mat = p.material.clone(); if (opts.tint) opts.tint(mat);
        const geo = p.geometry.clone(), leafy = /^Lea/.test(mat.name);
        if (leafy) canopyNormals(geo);
        const sc = new Scatter(geo, mat, opts.cell || 1e6); sc.leafy = leafy; return sc;
      });
      const cx = (m.box.min.x + m.box.max.x) / 2, cz = (m.box.min.z + m.box.max.z) / 2, y0 = opts.keepY ? 0 : m.box.min.y;
      const sc = this.scene, cast = opts.cast !== false;
      const o = this._ms[key] = {
        model: m, count: 0,
        add(x, y, z, ry, s, sy, color) {
          s = s || 1; sy = sy || s; const c = Math.cos(ry || 0), sn = Math.sin(ry || 0);
          const ox = -(cx * c + cz * sn) * s, oz = -(-cx * sn + cz * c) * s;   // keep the footprint centred on (x, z)
          for (const p of parts) p.add(x + ox, y - y0 * sy, z + oz, ry || 0, s, sy, s, color);
          o.count++;
        },
        build() { if (o.count) for (const p of parts) p.build(sc, cast, !p.leafy); }   // foliage casts shadows but does not darken itself
      };
      return o;
    }

    /* seat positions on a Kenney grandstand: raycast down onto its red seat rows (model units) */
    seats(name) {
      this._seatCache = this._seatCache || {}; if (this._seatCache[name]) return this._seatCache[name];
      const m = AX.Assets.get(name), g = AX.Assets.instance(name, { cast: false }); g.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(), out = [], b = m.box, step = 0.062;
      for (let x = b.min.x + 0.03; x < b.max.x - 0.03; x += step) for (let z = b.min.z + 0.02; z < b.max.z; z += step * 0.6) {
        rc.set(V3(x, b.max.y - 0.02, z), V3(0, -1, 0));
        const hits = rc.intersectObject(g, true);
        for (const h of hits) { if (h.face.normal.y < 0.7) continue; if (/red/i.test(h.object.material.name)) { out.push(V3(x, h.point.y, z)); } break; }
      }
      // keep one spectator per seat row step (points closer than a seat apart collapse)
      const keep = []; for (const p of out) if (!keep.some((k) => Math.abs(k.x - p.x) < step * 0.8 && Math.abs(k.z - p.z) < step * 0.9)) keep.push(p);
      return (this._seatCache[name] = { pts: keep, box: b });
    }
    /* place a kit model with a full world matrix, returns that matrix (model units -> world) */
    kitPlace(name, x, y, z, ry, s, opts) {
      const o = this.ms(name, opts); if (!o) return null; o.add(x, y, z, ry, s, null, opts && opts.color);
      const m = o.model, cx = (m.box.min.x + m.box.max.x) / 2, cz = (m.box.min.z + m.box.max.z) / 2;
      return new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-cx, -m.box.min.y, -cz));
    }

    _nature() {
      const t = this.track, th = this.theme, rng = AX.RNG((t.def.seed || 5) * 7 + 3), N = t.n, w = t.hw;
      const leaf = (hex) => (mat) => { if (/^Lea/.test(mat.name)) { mat.color = lin(hex); mat.roughness = 1; mat.emissive = lin(hex).multiplyScalar(0.32); mat.emissiveMap = mat.map;
        // keep the canopy normals on both sides of a leaf card (three.js would flip them on back faces)
        mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;', '')); };
        mat.customProgramCacheKey = () => 'apex-foliage'; } else if (mat.name === 'Grass') { mat.color = lin(th.grass[0]).multiplyScalar(1.25); } };
      const pines = [1, 2, 3, 4, 5].map((k) => 'nature/Pine_' + k);
      const treeTint = (mat) => leaf(/Pine/.test(mat.name) ? th.pine : th.leaf)(mat);
      const pick = (arr) => arr[Math.floor(rng() * arr.length)];
      const hsl = (h, s, l) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
      const leafVar = () => hsl(0.27 + rng.range(-0.04, 0.05), rng.range(0.25, 0.5), rng.range(0.82, 0.98));
      // position at track sample i, lateral distance d beyond the barrier on side s
      const at = (i, s, d) => { const sg = s ? 1 : -1, off = t.bar[s][i] + d; return [t.px[i] + t.nx[i] * sg * off, t.pz[i] + t.nz[i] * sg * off]; };
      const ok = (x, z, m, pad) => this.clear(x, z, m) && this.free(x, z, pad || 0);
      const q = this.q === 'low' ? 0.35 : this.q === 'medium' ? 0.65 : 1;
      // ---- trees in clumps, thinning out with distance
      let trees = 0;
      // conifer forest: dense clumps close to the circuit, thinning out further away
      const pineVar = () => hsl(0.3 + rng.range(-0.03, 0.04), rng.range(0.2, 0.45), rng.range(0.78, 1.0));
      for (let n = 0; n < 2900 * q + 400; n++) {
        const i = rng.int(0, N - 1), s = rng.int(0, 1), d = 4 + Math.pow(rng(), 2.3) * 70; const [x, z] = at(i, s, d);
        if (fbm(x / 60 + 13, z / 60 + 7, 0, 3) < (d < 30 ? 0.27 : 0.34) + d * 0.0016) continue;
        if (!ok(x, z, 4.5, 1.6)) continue;
        const name = pick(pines);   // only trees close to the circuit throw shadows the camera can see
        this.ms(name, d < 28 ? { tint: treeTint, cell: 1e6 } : { tint: treeTint, cell: 1e6, cast: false, key: 'far' }).add(x, 0, z, rng() * 6.28, rng.range(0.95, 1.75), null, pineVar()); this.reserve(x, z, 1.5); trees++;
      }
      // ---- bushes and ferns hugging the tree lines and the barriers
      for (let n = 0; n < 1100 * q; n++) {
        const i = rng.int(0, N - 1), s = rng.int(0, 1), d = 1.8 + Math.pow(rng(), 1.8) * 45; const [x, z] = at(i, s, d);
        if (fbm(x / 50 + 3, z / 50 + 1, 0, 3) < 0.42) continue; if (!ok(x, z, 1.6, 1.2)) continue;
        const r = rng(); const name = r < 0.45 ? 'nature/Bush_Common' : r < 0.6 ? 'nature/Bush_Common_Flowers' : r < 0.8 ? 'nature/Fern_1' : 'nature/Plant_1';
        this.ms(name, { tint: leaf(th.leaf), cell: 1e6 }).add(x, 0, z, rng() * 6.28, rng.range(0.9, 1.6), null, leafVar()); this.reserve(x, z, 1.1);
      }
      // ---- boulder groups (outside of slow corners and on the infield)
      const rocks = ['nature/Rock_Medium_1', 'nature/Rock_Medium_2', 'nature/Rock_Medium_3'];
      const rockGroup = (x, z) => {
        const k = rng.int(2, 4);
        for (let r = 0; r < k; r++) {
          const a = rng() * 6.28, rr = r ? rng.range(2.5, 4.5) : 0, X = x + Math.cos(a) * rr, Z = z + Math.sin(a) * rr; if (!ok(X, Z, 3, 1)) continue;
          const sc = r ? rng.range(0.7, 1.4) : rng.range(1.3, 2.2); this.ms(pick(rocks), { cell: 1e6 }).add(X, -0.15 * sc, Z, rng() * 6.28, sc, sc * rng.range(0.8, 1.15), hsl(0.1, 0.05, rng.range(0.85, 1))); this.reserve(X, Z, 1.6 * sc);
          for (let p = 0; p < 4; p++) { const b = rng() * 6.28, d = rng.range(2, 4) * sc, PX = X + Math.cos(b) * d, PZ = Z + Math.sin(b) * d; if (ok(PX, PZ, 1.5)) this.ms(pick(['nature/Pebble_Round_1', 'nature/Pebble_Round_3', 'nature/Pebble_Square_2']), { cell: 1e6, cast: false }).add(PX, 0, PZ, rng() * 6.28, rng.range(1.5, 3)); }
        }
      };
      t.corners.forEach((c) => { const s = c.dir > 0 ? 0 : 1; for (const off of [-20, 25]) { const i = mod(c.apex + off, N); const [x, z] = at(i, s, rng.range(6, 16)); if (ok(x, z, 4, 4)) rockGroup(x, z); } });
      for (let n = 0; n < 40 * q; n++) { const i = rng.int(0, N - 1), s = rng.int(0, 1); const [x, z] = at(i, s, rng.range(8, 60)); if (ok(x, z, 6, 6)) rockGroup(x, z); }
      // ---- grass tufts and flowers on the run-off and verges (not on gravel or tarmac)
      const grass = ['nature/Grass_Common_Short', 'nature/Grass_Common_Short', 'nature/Grass_Wispy_Short', 'nature/Grass_Common_Tall'];
      for (let n = 0; n < 4500 * q; n++) {
        const i = rng.int(0, N - 1), s = rng.int(0, 1), sg = s ? 1 : -1; const lat = rng() < 0.4 ? t.bar[s][i] + rng.range(-2.2, 3) : rng.range(w + t.kerbW + 3.0, t.bar[s][i] + 30);
        if (lat > t.bar[s][i] - 0.8 && lat < t.bar[s][i] + 1.6) continue;
        if (t.g0[s][i] > 0 && lat > t.g0[s][i] - 0.5 && lat < t.g1[s][i] + 0.5) continue;
        const x = t.px[i] + t.nx[i] * sg * lat, z = t.pz[i] + t.nz[i] * sg * lat;
        if (t._otherDist(x, z, i, 60) < w + t.kerbW + 3) continue; if (!this.free(x, z, 0.3)) continue;
        if (fbm(x / 18 + 5, z / 18 + 9, 0, 2) < 0.4) continue;
        const r = rng(); const name = r < 0.9 ? pick(grass) : r < 0.95 ? 'nature/Flower_3_Group' : r < 0.98 ? 'nature/Flower_4_Group' : 'nature/Clover_1';
        this.ms(name, { tint: leaf(th.leaf), cast: false, cell: 240 }).add(x, 0, z, rng() * 6.28, rng.range(0.8, 1.3), null, leafVar());
      }
      this.pineCount = trees;
    }

    _trees() {
      const t = this.track, th = this.theme, rng = this.rng, b = t.bounds;
      // broadleaf: trunk + clustered canopy; conifer: stacked cones. Vertex colours shade bottom to top.
      const shade = (geo, c0, c1, y0, y1) => { const p = geo.attributes.position.array, col = new Float32Array(p.length); for (let i = 0; i < p.length; i += 3) { const k = clamp((p[i + 1] - y0) / (y1 - y0), 0, 1); col[i] = lerp(c0.r, c1.r, k); col[i + 1] = lerp(c0.g, c1.g, k); col[i + 2] = lerp(c0.b, c1.b, k); } geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo; };
      const merge = (list) => { const gb = new GeoBuilder(); for (const g of list) { const ng = g.index ? g.toNonIndexed() : g; const p = ng.attributes.position.array, n = ng.attributes.normal.array, c = ng.attributes.color.array; for (let i = 0; i < p.length; i++) { gb.pos.push(p[i]); gb.nor.push(n[i]); gb.col.push(c[i]); } } const o = gb.build(); o.computeBoundingSphere(); return o; };
      const dark = new THREE.Color(0.34, 0.42, 0.3), light = new THREE.Color(1.0, 1.0, 1.0), brown0 = lin(0x4a3524), brown1 = lin(0x6b4f35);
      const leaf = (() => {
        const parts = [shade(new THREE.CylinderGeometry(0.22, 0.34, 2.6, 5).translate(0, 1.3, 0), brown0, brown1, 0, 2.6)];
        const blobs = [[0, 4.5, 0, 2.4], [1.4, 3.6, 0.5, 1.7], [-1.2, 3.7, -0.8, 1.8], [0.1, 3.5, 1.4, 1.6]];
        for (const q of blobs) parts.push(shade(new THREE.SphereGeometry(q[3], 7, 5).translate(q[0], q[1], q[2]), dark, light, 2.4, 7));
        return merge(parts);
      })();
      const pine = (() => {
        const parts = [shade(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5).translate(0, 1.1, 0), brown0, brown1, 0, 2.2)];
        for (let k = 0; k < 4; k++) parts.push(shade(new THREE.ConeGeometry(2.0 - k * 0.4, 3.0, 7).translate(0, 2.6 + k * 1.7, 0), dark, light, 1.5, 10));
        return merge(parts);
      })();
      const bush = (() => merge([shade(new THREE.SphereGeometry(1, 6, 4).scale(1.3, 0.8, 1.2).translate(0, 0.6, 0), dark, light, 0, 1.5), shade(new THREE.SphereGeometry(0.7, 5, 4).translate(0.9, 0.5, 0.3), dark, light, 0, 1.5)]))();
      const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
      const leaves = new Scatter(leaf, lm, 300), pines = new Scatter(pine, lm, 300), bushes = new Scatter(bush, lm, 300);
      const tc = th.tree.map((h) => '#' + new THREE.Color(h).getHexString());
      const pad = 230, area = (b.maxX - b.minX + pad * 2) * (b.maxZ - b.minZ + pad * 2);
      const count = Math.round(area / 185 * th.density * (this.q === 'low' ? 0.5 : 1) * (this.kits ? 0.45 : 1));
      for (let n = 0; n < count; n++) {
        const x = rng.range(b.minX - pad, b.maxX + pad), z = rng.range(b.minZ - pad, b.maxZ + pad);
        const f = fbm(x / 130 + 40, z / 130 + 17, 0, 3); if (f < 0.44) continue;                 // clearings
        if (!this.clear(x, z, this.kits ? 105 : 5.5) || !this.free(x, z, 3)) continue;
        const sc = rng.range(0.95, 1.75), tint = rng.pick(tc), ry = rng() * 6.28;
        if (rng() < th.conifer) pines.add(x, 0, z, ry, sc * 0.95, sc * rng.range(1.0, 1.35), sc * 0.95, tint);
        else leaves.add(x, 0, z, ry, sc, sc * rng.range(0.9, 1.15), sc, tint);
      }
      for (let n = 0; n < (this.kits ? 0 : count * 0.22); n++) {
        const x = rng.range(b.minX - 200, b.maxX + 200), z = rng.range(b.minZ - 200, b.maxZ + 200);
        if (!this.clear(x, z, 3.5) || !this.free(x, z, 2)) continue; bushes.add(x, 0, z, rng() * 6.28, rng.range(0.7, 1.5), rng.range(0.7, 1.3), rng.range(0.7, 1.5), rng.pick(tc));
      }
      leaves.build(this.scene, true, true); pines.build(this.scene, true, true); bushes.build(this.scene, true, true);
      this.treeCount = leaves.count + pines.count + bushes.count;
    }

    _backdrop() {
      // far hills / mountains so a low camera never looks into the void
      const t = this.track, b = t.bounds, rng = this.rng, alpine = t.def.theme === 'alpine'; const gb = new GeoBuilder();
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2; const n = alpine ? 22 : 16;
      const grass = lin(alpine ? 0x5d8a52 : 0x6c9a55), rock = lin(0x8d9299), snow = lin(0xf4f6fa);
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + rng.range(-0.1, 0.1); if (t.def.theme === 'coast' && Math.sin(a) > 0.25) continue;
        const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 260;          // keep every mountain foot well clear of the circuit
        const R = rng.range(1050, 1500), h0 = alpine ? rng.range(260, 520) : rng.range(70, 150), r = Math.min(h0 * rng.range(1.5, 2.3) + 160, R - ext), h = Math.min(h0, r * 0.75);
        const g = new THREE.ConeGeometry(r, h, 9, 5); const p = g.attributes.position.array, col = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 3) {
          const y = (p[i + 1] + h / 2) / h; const j = (hash2(Math.round(p[i]), Math.round(p[i + 2])) - 0.5) * r * 0.22 * (1 - y); p[i] += j; p[i + 2] += j * 0.7;
          const c = alpine ? (y > 0.62 ? snow : y > 0.3 ? rock : grass) : grass; const kk = 0.85 + y * 0.25; col[i] = c.r * kk; col[i + 1] = c.g * kk; col[i + 2] = c.b * kk;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
        const ng = g.toNonIndexed(); ng.translate(cx + Math.cos(a) * R, h / 2 - 6, cz + Math.sin(a) * R);
        const pp = ng.attributes.position.array, nn = ng.attributes.normal.array, cc = ng.attributes.color.array; for (let i = 0; i < pp.length; i++) { gb.pos.push(pp[i]); gb.nor.push(nn[i]); gb.col.push(cc[i]); }
      }
      const m = new THREE.Mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false })); this.scene.add(m);
    }

    /* 0..5 red lights on; go=true switches everything off */
    setStartLights(n) { for (let k = 0; k < 5; k++) this.startLights[k].material.color.setRGB(k < n ? 4.5 : 0.13, k < n ? 0.25 : 0.03, k < n ? 0.15 : 0.02); }

    update(focus, time) {
      const s = this.sun, R = this.shadowR, texel = (R * 2) / s.shadow.mapSize.x;
      // snap the shadow frustum to texels so shadows do not shimmer while the camera travels
      const fx = Math.round(focus.x / texel / 8) * texel * 8, fz = Math.round(focus.z / texel / 8) * texel * 8;
      const fy = focus.y || 0; s.target.position.set(fx, fy, fz); s.position.set(fx + this.sunDir.x * 260, fy + this.sunDir.y * 260, fz + this.sunDir.z * 260); s.target.updateMatrixWorld();
      this.sky.position.set(focus.x, focus.y || 0, focus.z);
      if (this.clouds) this.clouds.rotation.y = time * 0.0025;
      if (this.passLod) for (let k = 0; k < this.passLod.length; k++) { const l = this.passLod[k]; const dx = l.p.x - focus.x, dy = l.p.y - (focus.y || 0), dz = l.p.z - focus.z; l.obj.visible = dx * dx + dy * dy + dz * dz < l.r * l.r; }
      for (let k = 0; k < this.flags.length; k++) {
        const g = this.flags[k].geometry, p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 2.4 - time * 6 + k) * 0.16 * x); }
        p.needsUpdate = true;
      }
    }
    dispose() {
      this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { for (const k in m) { const v = m[k]; if (v && v.isTexture && v !== this.env) v.dispose(); } m.dispose(); }); } });
      if (this.env) this.env.dispose();
    }
  }
  AX.World = World; AX.worldTex = { canvasTex, pixelTex, fbm, hash2, hexRGB, Scatter, asphaltTex, grassTex, dirtTex, textTex, brandTex, concreteTex, decalMaterial };
})(typeof globalThis !== 'undefined' ? globalThis : window);
