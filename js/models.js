/* APEX — procedural bike + rider models.
   Bike space: +X forward, +Y up, +Z rider's right. Everything is built from smooth lofted
   surfaces, lathes and rounded solids and merged into a handful of meshes per bike. */
(function (root) {
  'use strict';
  const AX = root.AX, THREE = root.THREE;
  const { clamp, lerp, damp, smoothstep } = AX;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  /* ---------------------------------------------------------------- geometry helpers */
  class GeoBuilder {
    constructor() { this.pos = []; this.nor = []; this.col = []; }
    add(geo, mat4, color) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (mat4) g.applyMatrix4(mat4);
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      const c = color instanceof THREE.Color ? color : lin(color == null ? 0xffffff : color);
      for (let i = 0; i < p.length; i += 3) {
        this.pos.push(p[i], p[i + 1], p[i + 2]); this.nor.push(n[i], n[i + 1], n[i + 2]); this.col.push(c.r, c.g, c.b);
      }
      g.dispose(); return this;
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.computeBoundingSphere(); return g;
    }
    get empty() { return this.pos.length === 0; }
  }
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function M(px, py, pz, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(px || 0, py || 0, pz || 0);
    _s.set(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz);
    return new THREE.Matrix4().compose(_p, _q, _s);
  }
  const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

  /* lofted body along X. sections: {x, y, w, ht, hb, e} (centre height, half width, half heights, squareness) */
  function loft(secs, Mseg, close0, close1) {
    Mseg = Mseg || 22; const n = secs.length; const P = [], idx = [];
    for (let i = 0; i < n; i++) {
      const s = secs[i], e = 2 / (s.e || 2.3), hb = s.hb == null ? s.ht : s.hb, wb = s.wb == null ? s.w : s.wb;
      for (let j = 0; j <= Mseg; j++) {
        const a = j / Mseg * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        P.push(s.x, s.y + (sn >= 0 ? s.ht : hb) * spow(sn, e), (sn >= 0 ? s.w : wb) * spow(c, e));
      }
    }
    const W = Mseg + 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < Mseg; j++) {
      const a = i * W + j, b = a + W, c = a + 1, d = b + 1; idx.push(a, b, c, c, b, d);
    }
    const cap = (i, flip) => {
      const s = secs[i]; const ci = P.length / 3; P.push(s.x, s.y + (s.ht - (s.hb == null ? s.ht : s.hb)) * 0.25, 0);
      for (let j = 0; j < Mseg; j++) { const a = i * W + j, b = a + 1; if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
    };
    if (close0 !== false) cap(0, true);
    if (close1 !== false) cap(n - 1, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals();
    const N = g.attributes.normal.array;   // weld the seam
    for (let i = 0; i < n; i++) {
      const a = (i * W) * 3, b = (i * W + Mseg) * 3;
      for (let k = 0; k < 3; k++) { const v = N[a + k] + N[b + k]; N[a + k] = v; N[b + k] = v; }
      const l = Math.hypot(N[a], N[a + 1], N[a + 2]) || 1;
      for (let k = 0; k < 3; k++) { N[a + k] /= l; N[b + k] /= l; }
    }
    return g;
  }
  function roundedBox(w, h, d, r, seg) {
    seg = seg || 5; r = Math.min(r, w / 2, h / 2, d / 2);
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg); const p = g.attributes.position.array, n = g.attributes.normal.array;
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.length; i += 3) {
      const ix = clamp(p[i], -hx, hx), iy = clamp(p[i + 1], -hy, hy), iz = clamp(p[i + 2], -hz, hz);
      let dx = p[i] - ix, dy = p[i + 1] - iy, dz = p[i + 2] - iz; const l = Math.hypot(dx, dy, dz);
      if (l > 1e-6) { dx /= l; dy /= l; dz /= l; p[i] = ix + dx * r; p[i + 1] = iy + dy * r; p[i + 2] = iz + dz * r; n[i] = dx; n[i + 1] = dy; n[i + 2] = dz; }
    }
    return g;
  }
  /* capsule along +Y from 0..len */
  function capsule(r0, r1, len, seg) {
    const pts = []; const k = 7;
    for (let i = 0; i <= k; i++) { const a = -Math.PI / 2 + (i / k) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
    for (let i = 0; i <= k; i++) { const a = (i / k) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r1, len + Math.sin(a) * r1)); }
    return new THREE.LatheGeometry(pts, seg || 14);
  }
  function tubeBetween(a, b, r0, r1, seg) {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r1 == null ? r0 : r1, r0, len, seg || 10, 1, false);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a, q, V3(1, 1, 1))); return g;
  }
  /* curved shell (mudguard) around the Z axis at radius R */
  function arcShell(R, halfW, crown, a0, a1, segA, segW) {
    segA = segA || 18; segW = segW || 6; const P = [], idx = [];
    for (let i = 0; i <= segA; i++) {
      const a = lerp(a0, a1, i / segA), taper = Math.sin(Math.PI * clamp(i / segA, 0.04, 0.96));
      for (let j = 0; j <= segW; j++) {
        const t = j / segW * 2 - 1, r = R + crown * (1 - t * t) - 0.012 * (1 - taper);
        P.push(Math.cos(a) * r, Math.sin(a) * r, t * halfW * (0.72 + 0.28 * taper));
      }
    }
    const W = segW + 1;
    for (let i = 0; i < segA; i++) for (let j = 0; j < segW; j++) { const a = i * W + j, b = a + W; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }

  /* ---------------------------------------------------------------- materials */
  const LIVERY_GLSL = `
    uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uPat;
    varying vec3 vLivP; varying vec3 vLivN;
    vec3 liveryColor() {
      vec3 p = vLivP; vec3 col = uC1;
      float side = 1.0 - smoothstep(0.45, 0.75, abs(vLivN.y));
      if (uPat < 0.5) {            // rising swoosh + dark belly
        float d = p.y - 0.60 - 0.42 * (p.x - 0.05);
        col = mix(col, uC2, smoothstep(0.075, 0.062, abs(d)));
        col = mix(col, uC3, smoothstep(0.012, 0.0, abs(d + 0.10) - 0.022) );
        col = mix(col, uC3, smoothstep(0.37, 0.33, p.y - 0.10 * p.x) * side);
        col = mix(col, uC2, smoothstep(-0.50, -0.54, p.x));
      } else if (uPat < 1.5) {     // two-tone split with pinstripe
        float d = p.y - 0.70 + 0.30 * p.x;
        col = mix(uC2, uC1, smoothstep(-0.006, 0.006, d));
        col = mix(col, uC3, smoothstep(0.016, 0.010, abs(d)));
        col = mix(col, uC3, smoothstep(0.34, 0.30, p.y) * side);
        col = mix(col, uC1, smoothstep(-0.56, -0.60, p.x));
      } else if (uPat < 2.5) {     // blocks
        float b = step(0.0, sin((p.x + p.y * 0.55) * 11.0));
        float zone = smoothstep(0.02, 0.06, p.x) * smoothstep(0.62, 0.56, p.x);
        col = mix(col, uC2, b * zone * 0.0 + smoothstep(0.008, 0.0, abs(p.y - 0.56 - 0.2 * p.x) - 0.05));
        col = mix(col, uC3, smoothstep(0.40, 0.36, p.y) * side);
        col = mix(col, uC2, smoothstep(-0.30, -0.34, p.x) * smoothstep(-0.62, -0.58, p.x));
      } else {                     // nose + tail accents
        col = mix(col, uC2, smoothstep(0.52, 0.58, p.x));
        col = mix(col, uC3, smoothstep(0.010, 0.004, abs(p.x - 0.52)));
        col = mix(col, uC2, smoothstep(-0.44, -0.50, p.x));
        col = mix(col, uC3, smoothstep(0.38, 0.34, p.y - 0.06 * p.x) * side);
      }
      // centre stripe over tank and tail, seen from above
      float top = smoothstep(0.55, 0.8, vLivN.y);
      col = mix(col, uC3, top * smoothstep(0.034, 0.028, abs(p.z)) * 0.9);
      col = mix(col, uC2, top * smoothstep(0.014, 0.010, abs(abs(p.z) - 0.05)));
      return col;
    }`;
  function paintMaterial(c1, c2, c3, pat, env) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.08, side: THREE.DoubleSide, envMap: env || null, envMapIntensity: 0.9 });
    const u = { uC1: { value: lin(c1) }, uC2: { value: lin(c2) }, uC3: { value: lin(c3) }, uPat: { value: pat } };
    m.userData.livery = u;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLivP; varying vec3 vLivN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLivP = position; vLivN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + LIVERY_GLSL)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = liveryColor();\n#ifdef USE_COLOR\ndiffuseColor.rgb *= vColor;\n#endif');
    };
    m.customProgramCacheKey = () => 'apex-livery';
    return m;
  }
  const SHARED = {};
  function sharedMats(env) {
    if (SHARED.env === env && SHARED.matte) return SHARED;
    SHARED.env = env;
    SHARED.matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, envMap: env, envMapIntensity: 0.35 });
    SHARED.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85, envMap: env, envMapIntensity: 1.0 });
    SHARED.chrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 1.0, envMap: env, envMapIntensity: 2.1 });   // fork stanchions, shock shaft: polished, mirror the sky and the road
    SHARED.chrome.userData.psTame = SHARED.chrome.userData.lookBike = true;      // the look passes flatten the bike's metal - not this
    SHARED.gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1, envMap: env, envMapIntensity: 0.9 });
    SHARED.suit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, envMap: env, envMapIntensity: 0.3 });
    SHARED.screen = new THREE.MeshStandardMaterial({ color: lin(0x10151c), roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.62, envMap: env, envMapIntensity: 1.4, side: THREE.DoubleSide });
    SHARED.clear = new THREE.MeshStandardMaterial({ color: lin(0xe6eef4), roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.14, depthWrite: false, envMap: env, envMapIntensity: 1.6, side: THREE.DoubleSide });   // a clear race screen: one looks through it, the sky glints on it
    SHARED.visor = new THREE.MeshStandardMaterial({ color: lin(0x0b0d12), roughness: 0.06, metalness: 0.7, envMap: env, envMapIntensity: 1.6 });
    return SHARED;
  }
  const numTexCache = {};
  let _heatTex = null;
  function heatTexture() {   // soft round glow: hottest in the middle
    if (_heatTex) return _heatTex;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#9a9a9a'); gr.addColorStop(1, '#161616'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    _heatTex = new THREE.CanvasTexture(c); return _heatTex;
  }
  function numberTexture(num, bg, fg) {
    const key = num + bg + fg; if (numTexCache[key]) return numTexCache[key];
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d'); g.scale(4, 4);      // 4x the layout size: crisp on the number plate in close-ups
    g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.fillStyle = fg; g.font = 'italic 900 ' + (String(num).length > 1 ? 78 : 96) + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 60, 70);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; numTexCache[key] = t; return t;
  }

  // the APEX wordmark, drawn rather than typed so it looks the same on every machine: slanted block letters, an A without its bar, an E of three bars
  const wordTexCache = {};
  function wordTexture(color) {
    if (wordTexCache[color]) return wordTexCache[color];
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    const H = 86, W = 80, gap = 30, wt = 22, yb = 107, sk = 0.2;
    g.setTransform(1, 0, -sk, 1, sk * yb, 0);
    g.beginPath(); g.rect(-60, yb - H, 700, H); g.clip();      // everything is cut square at base line and cap height
    g.strokeStyle = color; g.lineWidth = wt; g.lineJoin = 'miter'; g.miterLimit = 8; g.lineCap = 'butt';
    const L = (pts) => { g.beginPath(); pts.forEach((q, k) => (k ? g.lineTo(q[0], yb - q[1]) : g.moveTo(q[0], yb - q[1]))); g.stroke(); };
    let x = 40;
    L([[x + 6, -22], [x + W / 2, H + 9], [x + W - 6, -22]]); x += W + gap;                                   // A
    const ym = H * 0.41, r = (H - wt / 2 - ym) / 2, cx = x + W - wt / 2 - r;                                  // P
    L([[x + wt / 2, -10], [x + wt / 2, H + 10]]);
    g.beginPath(); g.moveTo(x + wt / 2, yb - (H - wt / 2)); g.lineTo(cx, yb - (H - wt / 2)); g.arc(cx, yb - (ym + r), r, -Math.PI / 2, Math.PI / 2); g.lineTo(x + wt / 2, yb - ym); g.stroke(); x += W + gap - 4;
    for (const [y, f] of [[wt / 2, 1], [H / 2, 0.78], [H - wt / 2, 1]]) L([[x, y], [x + W * 0.9 * f, y]]); x += W * 0.9 + gap;   // E
    L([[x + 2, -16], [x + W - 2, H + 16]]); L([[x + 2, H + 16], [x + W - 2, -16]]);                           // X
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; wordTexCache[color] = t; return t;
  }
  // what stands on the tank side panels: the start number on one side, the name on the other (3:1, dark on bare metal)
  const panelTexCache = {};
  function panelTexture(num) {
    const key = num == null ? 'word' : 'n' + num; if (panelTexCache[key]) return panelTexCache[key];
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d'); g.scale(1024 / 384, 4);      // sharper lettering on the side panel
    if (num == null) g.drawImage(wordTexture('#101113').image, 16, 20, 352, 88);
    else { g.fillStyle = '#101113'; g.font = 'italic 900 118px "Arial Black", "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 186, 70); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; panelTexCache[key] = t; return t;
  }
  // one chain link, lying along +x from its pin (origin) to the next: two side plates, the roller and the rivet. `wide` = outer link
  const linkCache = {};
  function linkGeometry(wide, pitch) {
    if (linkCache[wide]) return linkCache[wide];
    const gb = new GeoBuilder(), R = 0.0068, c = 0.0032, h = 0.0064, zp = wide ? 0.0079 : 0.0061, t = 0.0015, sh = new THREE.Shape();
    [[-c, -h], [pitch * 0.5, -h * 0.74], [pitch + c, -h], [pitch + R, -h * 0.45], [pitch + R, h * 0.45], [pitch + c, h], [pitch * 0.5, h * 0.74], [-c, h], [-R, h * 0.45], [-R, -h * 0.45]].forEach((q, k) => (k ? sh.lineTo(q[0], q[1]) : sh.moveTo(q[0], q[1])));
    const plate = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 1 }), col = wide ? 0xa98432 : 0x74787f;
    for (const z of [-zp - t / 2, zp - t / 2]) gb.add(plate, M(0, 0, z), col);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    if (!wide) gb.add(new THREE.CylinderGeometry(0.0051, 0.0051, 0.0112, 8, 1, true), rot, 0x8b8f96);     // roller, between the inner plates
    else for (const x of [0, pitch]) gb.add(new THREE.CylinderGeometry(0.0023, 0.0023, 0.0196, 6), M(x, 0, 0).multiply(rot), 0xb9bcc2);   // rivet heads
    plate.dispose(); return (linkCache[wide] = gb.build());
  }
  // a flexible hose: a tube through moving points, rebuilt in place
  function hoseMesh(mat, color, n, sides) {
    const cnt = (n + 1) * sides, P = new Float32Array(cnt * 3), Nn = new Float32Array(cnt * 3), C = new Float32Array(cnt * 3), I = [], c = lin(color);
    for (let k = 0; k < cnt; k++) { C[k * 3] = c.r; C[k * 3 + 1] = c.g; C[k * 3 + 2] = c.b; }
    for (let i = 0; i < n; i++) for (let j = 0; j < sides; j++) { const a = i * sides + j, b = i * sides + (j + 1) % sides, d = a + sides, e = b + sides; I.push(a, d, b, b, d, e); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.setIndex(I);
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.userData.hose = { n, sides, c: new Float32Array((n + 1) * 3) }; return m;
  }
  function hoseUpdate(mesh, pts, r) {     // pts: array of Vector3 (>= 3), Catmull-Rom through all of them
    const { n, sides, c } = mesh.userData.hose, P = mesh.geometry.attributes.position.array, Nn = mesh.geometry.attributes.normal.array, m = pts.length - 1;
    for (let i = 0; i <= n; i++) {
      const u = i / n * m, j = Math.min(m - 1, Math.floor(u)), t = u - j, p0 = pts[Math.max(0, j - 1)], p1 = pts[j], p2 = pts[j + 1], p3 = pts[Math.min(m, j + 2)], t2 = t * t, t3 = t2 * t;
      for (const [k, ax] of [[0, 'x'], [1, 'y'], [2, 'z']]) c[i * 3 + k] = 0.5 * (2 * p1[ax] + (p2[ax] - p0[ax]) * t + (2 * p0[ax] - 5 * p1[ax] + 4 * p2[ax] - p3[ax]) * t2 + (3 * p1[ax] - p0[ax] - 3 * p2[ax] + p3[ax]) * t3);
    }
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(n, i + 1) * 3; let tx = c[b] - c[a], ty = c[b + 1] - c[a + 1], tz = c[b + 2] - c[a + 2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let nx = ty, ny = -tx, nz = 0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;                      // n = t x z
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let s2 = 0; s2 < sides; s2++) { const an = s2 / sides * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an), o = (i * sides + s2) * 3, vx = nx * cs + bx * sn, vy = ny * cs + by * sn, vz = nz * cs + bz * sn;
        Nn[o] = vx; Nn[o + 1] = vy; Nn[o + 2] = vz; P[o] = c[i * 3] + vx * r; P[o + 1] = c[i * 3 + 1] + vy * r; P[o + 2] = c[i * 3 + 2] + vz * r; }
    }
    mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.normal.needsUpdate = true;
  }
  // a strip of lettering laid onto a curved surface: every vertex is dropped onto the mesh along `dir` (mesh-local), then lifted a hair
  const _ray = new THREE.Raycaster();
  function conformStrip(mesh, centre, right, up, w, h, nx, lift) {
    const nrm = new THREE.Vector3().crossVectors(right, up).normalize(), P = [], U = [], I = [], hit = [], o = new THREE.Vector3(), d = nrm.clone().negate();
    mesh.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert(), dw = d.clone().transformDirection(mesh.matrixWorld);
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / 2; o.copy(centre).addScaledVector(right, (u - 0.5) * w).addScaledVector(up, (v - 0.5) * h);
      const base = o.clone(); o.addScaledVector(nrm, 0.5); _ray.set(o.clone().applyMatrix4(mesh.matrixWorld), dw); hit.length = 0; mesh.raycast(_ray, hit); hit.sort((q, k) => q.distance - k.distance);
      const q = hit.length ? hit[0].point.clone().applyMatrix4(inv) : base; q.addScaledVector(nrm, lift); P.push(q.x, q.y, q.z); U.push(u, v);
    }
    for (let j = 0; j < 2; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b2 = a + 1, c2 = a + nx + 1, d2 = c2 + 1; I.push(a, b2, c2, b2, d2, c2); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.setIndex(I); geo.computeVertexNormals(); return geo;
  }
  /* afterfire: a short tongue of flame out of the pipe when the engine pops. A thin shell of light that is brightest where you look through
     the middle of it and fades to nothing at its outline - no hard edge, no blobs. Blue-white at the mouth, orange, then a dull red tip. */
  let _flameGeo = null;
  function flameGeometry() {
    if (_flameGeo) return _flameGeo;
    const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector2(Math.max(0.0005, (0.86 + 0.5 * t) * Math.pow(1 - t, 0.75) * (0.55 + 0.45 * Math.min(1, t * 9))), t)); }
    return (_flameGeo = new THREE.LatheGeometry(pts, 16));
  }
  function flameMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uLen: { value: 0.2 }, uRad: { value: 0.035 }, uT: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
      vertexShader: `uniform float uLen; uniform float uRad; uniform float uT; varying vec3 vN; varying vec3 vV; varying float vS;
        void main(){ vS = position.y; float w = sin(position.y * 9.0 - uT * 55.0) * 0.07 * position.y;      // the tip licks about
          vec3 p = vec3(position.x * uRad + w * uRad * 3.0, position.y * uLen, position.z * uRad);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * vec3(normal.x, normal.y * uRad / uLen, normal.z)); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uI; varying vec3 vN; varying vec3 vV; varying float vS;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV))), core = pow(f, 2.2);
          vec3 c = mix(vec3(0.5, 0.72, 1.5), vec3(1.5, 0.6, 0.13), smoothstep(0.02, 0.4, vS)); c = mix(c, vec3(0.85, 0.13, 0.02), smoothstep(0.45, 1.0, vS));
          float a = core * (1.0 - smoothstep(0.6, 1.0, vS)) * uI * 0.75;
          gl_FragColor = vec4(c * a, 1.0); }` });
  }

  /* tyres that show how they have been used: fresh rubber is a dull grey, the band that has worked is clean and black,
     and where the tyre has been slid the rubber rolls up into a rough, lighter grain that cleans off again over the next corners */
  const TYRE_FRAG = `
        float tyR = length(vTy.xy), tyU = clamp(vTy.z / uTy.y, -1.0, 1.0), tyM = smoothstep(uTy.x - 0.004, uTy.x + 0.008, tyR);
        vec4 tyW = texture2D(uWear, vec2(tyU * 0.4844 + 0.5, 0.5));
        // grain: fine torn ripples lying at a slant across the tread; seen from far off, or on a spinning wheel, they melt into a dull band
        vec2 tyP = vec2(atan(vTy.y, vTy.x) * uTy.x * 230.0 + vTy.z * 320.0, vTy.z * 760.0 - atan(vTy.y, vTy.x) * uTy.x * 60.0);
        float tyF = clamp(1.3 - max(fwidth(tyP.x), fwidth(tyP.y)) * 1.1, 0.0, 1.0) * (1.0 - uTy.z);
        float tyN = tyNoise(tyP) * 0.6 + tyNoise(tyP * 2.7 + 7.1) * 0.4;
        float tyUse = tyW.r * tyM, tyG = tyW.g * tyM * mix(0.5, 0.18 + 0.82 * smoothstep(0.3, 0.68, tyN), tyF);
        diffuseColor.rgb *= mix(1.5, 0.66, tyUse);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.05, 0.056), tyG * 0.8);`;
  function tyreSkin(wheel, base, Rc, W) {
    const N = 32, data = new Uint8Array(N * 4), tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.LinearFilter;
    const use = new Float32Array(N), grain = new Float32Array(N), mat = base.clone(), u = { uWear: { value: tex }, uTy: { value: new THREE.Vector3(Rc, W, 0) } };
    for (let k = 0; k < N; k++) { const x = ((k + 0.5) / N - 0.5) / 0.4844; use[k] = 0.8 * (1 - smoothstep(0.34, 0.6, Math.abs(x))); data[k * 4] = use[k] * 255; data[k * 4 + 3] = 255; }   // run in down the middle, untouched on the shoulders
    tex.needsUpdate = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWear = u.uWear; sh.uniforms.uTy = u.uTy;
      sh.vertexShader = 'varying vec3 vTy;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTy = position;');
      sh.fragmentShader = 'uniform sampler2D uWear; uniform vec3 uTy; varying vec3 vTy;\nfloat tyHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat tyNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(tyHash(i), tyHash(i + vec2(1.0, 0.0)), f.x), mix(tyHash(i + vec2(0.0, 1.0)), tyHash(i + vec2(1.0, 1.0)), f.x), f.y); }\n'
        + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>' + TYRE_FRAG).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor * mix(1.0, 0.82, tyUse), 1.0, tyG);');
    };
    mat.customProgramCacheKey = () => 'apexTyre'; mat.extensions = { derivatives: true };
    for (const c of wheel.children) if (c.isMesh && c.material === base) c.material = mat;
    return { N, data, tex, use, grain, mat, u, acc: 0 };
  }
  function tyreWork(Wr, uc, ds, slide) {     // uc: where across the tread the tyre stands on the road (-1..1), ds: metres rolled
    const N = Wr.N, x = (uc * 0.4844 + 0.5) * N - 0.5, k0 = Math.max(0, Math.floor(x - 5)), k1 = Math.min(N - 1, Math.ceil(x + 5)), sc = 1 - Math.exp(-ds / 90);
    for (let k = k0; k <= k1; k++) {
      const d = (k - x) / 2.1, w = Math.exp(-d * d);
      Wr.use[k] += (1 - Wr.use[k]) * sc * w;
      Wr.grain[k] = clamp(Wr.grain[k] + (slide > 0.05 ? (1 - Wr.grain[k]) * slide * ds / 16 : -Wr.grain[k] * ds / 240) * w, 0, 1);
    }
    Wr.acc += ds; if (Wr.acc < 2.5) return; Wr.acc = 0;
    for (let k = 0; k < N; k++) { Wr.data[k * 4] = Wr.use[k] * 255; Wr.data[k * 4 + 1] = Wr.grain[k] * 255; }
    Wr.tex.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- wheel */
  const TYRE = 0x15171a, RIMS = { corsa: 0x1b1d21, strada: 0xc9a227, duetto: 0xd8d8d6 };
  function wheelGeometry(R, halfW, rimColor, isRear) {
    const gb = new GeoBuilder();
    // tyre: lathe around Y then laid on its side (axle along Z)
    const prof = []; const tr = halfW * 1.08; const k = 14;
    for (let i = 0; i <= k; i++) { const a = lerp(-2.1, 2.1, i / k); prof.push(new THREE.Vector2(R - tr * 0.86 + Math.cos(a) * tr * 0.86, Math.sin(a) * halfW)); }
    const lay = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    gb.add(new THREE.LatheGeometry(prof, 40), lay, TYRE);
    const rr = R - tr * 1.28;
    const rim = [new THREE.Vector2(rr + 0.012, -halfW * 0.8), new THREE.Vector2(rr - 0.012, -halfW * 0.55), new THREE.Vector2(rr - 0.02, 0), new THREE.Vector2(rr - 0.012, halfW * 0.55), new THREE.Vector2(rr + 0.012, halfW * 0.8)];
    gb.add(new THREE.LatheGeometry(rim, 40), lay, rimColor);
    // 5 twin spokes + hub
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      for (const off of [-0.16, 0.16]) {
        const a0 = a + off * 0.4, a1 = a + off;
        gb.add(tubeBetween(V3(Math.cos(a0) * 0.05, Math.sin(a0) * 0.05, 0), V3(Math.cos(a1) * (rr - 0.012), Math.sin(a1) * (rr - 0.012), 0), 0.016, 0.012, 6), null, rimColor);
      }
    }
    gb.add(new THREE.CylinderGeometry(0.062, 0.062, halfW * 1.5, 16), lay, rimColor);
    // brake discs
    const disc = new THREE.RingGeometry(R * 0.36, R * 0.62, 28, 1);
    if (isRear) gb.add(disc, M(0, 0, halfW * 0.72, 0, 0, 0, 0.74), 0x8f949a);
    else { gb.add(disc, M(0, 0, halfW + 0.022), 0x9a9fa5); gb.add(disc, M(0, 0, -halfW - 0.022, 0, Math.PI, 0), 0x9a9fa5); }
    if (isRear) gb.add(new THREE.CylinderGeometry(0.105, 0.105, 0.012, 24), M(0, 0, -halfW * 0.8, Math.PI / 2, 0, 0), 0x2b2d31); // sprocket
    return gb.build();
  }

  /* ---------------------------------------------------------------- bike */
  /* Bikes modelled with working suspension: everything the rig has to know about each model. All positions are the model's own, in metres
     (tools/blender_duetto.py, tools/blender_supermoto.py).
     head/rake: a point on the steering axis and its angle · PIV: swingarm pivot · S0/S1: shock eyes on frame and swingarm · SPR: gearbox sprocket
     travel: how much further than the Duetto it dives and squats (long-travel suspension) · forkMax: the most the fork may close up
     linkage: the shock is worked through a linkage - a rocker turning on the frame (F0) that carries the shock's lower eye (S1), and dog bones
     from the rocker (R2) to the swingarm (R0); both are parts of their own and the four-bar is solved every frame. link: the share of the wheel's
     travel the shock's eye moves if those parts are missing (0: the eye sits on the swingarm itself)
     chain: [gearbox sprocket radius, wheel sprocket radius, z, number of links] · hose: front brake line, top to caliper, and the sides that have one
     tyre: half axes of the tyres' cross-sections (rear a/b, front a/b) · plate: number on the front plate [x, y, size] · side: number on the side panels
     ex: where the pipe ends, which way it points, how wide it is · bar: the grips [x, y, z] · grip: the middle of the right grip and the way its tube points [x, y, z, ax, ay, az], lever: where the lever passes under index
     and middle finger, seen from the grip's axis [ahead, up], leverPiv: the right lever's pivot bolt and the way it points [x, y, z, ax, ay, az] (the hand
     levers are assemblies of their own, leverR / leverL, and swing about it), leverMax: how far [rad] · fit: where the rider sits (hips, shoulders upright and tucked, boots)
     and, optionally, how he rides: style 'motard' = he stays upright on top of the bike and pushes it down into the corner, elbows up, inside leg
     out in front. No bike uses it at present: the supermoto's rider hangs off like the others, knee and elbow down;
     leanVis: the furthest the bike is ever drawn leaned over [rad] (its bars and guards stay clear of the road);
     pov / chest: where the helmet and chest cameras sit and how far they look down, when the usual place would leave the bars out of shot;
     povMove (on the model): how far the helmet camera's eye point goes with the rider [sideways at full hang-off, down and forward at full tuck] - without it the eye stays on the
     centre line (Duetto, Motard). steerMax: the furthest the bars are drawn turned [rad]. gripFollow: the hands stay on the grips as the bars turn.
     fit.chestLegs false: thighs, knees and upper arms are left out of the chest camera's picture (on a sport bike they sit right beside it) */
  const SPRUNG = {
    duetto: { grip: [0.3047, 1.0561, 0.3265, -0.2698, 0.0156, 0.9628], lever: [0.052, -0.020], leverPiv: [0.3884, 1.0664, 0.2478, -0.0633, 0.9878, -0.1422], wb: 1.42, Rr: 0.325, Rf: 0.315, rake: 24, head: [0.398, 0.932], PIV: [-0.15, 0.43], S0: [-0.20, 0.716], S1: [-0.325, 0.458], SPR: [-0.075, 0.445], chain: [0.0385, 0.1095, -0.118, 108],
      hose: [[0.53485, 0.77615, 0.014], [0.54931, 0.72509, 0.058], [0.53069, 0.62923, 0.084], [0.58663, 0.4790, 0.092], [0.54505, 0.35613, 0.09]], hoseSides: [-1, 1],
      tyre: { ar: 0.0525, br: 0.1034, af: 0.0475, bf: 0.061 }, plate: [0.5395, 0.8957, 0.2], heat: true, gripFollow: true, ex: [[-0.795, 0.532, 0.232], [-0.866, 0.483, 0.129], 0.036] },
    supermoto: { wb: 1.47, Rr: 0.315, Rf: 0.30, rake: 26.5, head: [0.387, 0.953], PIV: [-0.145, 0.445], S0: [-0.05, 0.795], S1: [-0.165, 0.375], SPR: [-0.055, 0.425], chain: [0.0365, 0.121, -0.097, 114],
      hose: [[0.5206, 0.8468, 0.055], [0.5477, 0.7206, 0.06], [0.5386, 0.6044, 0.084], [0.5993, 0.4558, 0.092], [0.5588, 0.3712, 0.09]], hoseSides: [-1],
      travel: 1.6, forkMax: 0.17, link: 0.36, gripFollow: true, linkage: { F0: [-0.09, 0.31], R0: [-0.34, 0.36], R2: [-0.144, 0.265] }, tyre: { ar: 0.040, br: 0.0885, af: 0.0365, bf: 0.0632 }, plate: [0.5026, 0.9993, 0.125], side: [-0.275, 0.818, 0.1295, 0.082], ex: [[-0.757, 0.8175, 0.188], [-0.886, 0.464, 0.022], 0.0215],
      bar: [0.286, 1.174, 0.367], grip: [0.2853, 1.1939, 0.367, -0.1582, 0.01, 0.9874], lever: [0.050, -0.013], leverPiv: [0.3553, 1.2086, 0.2776, -0.1689, 0.9661, -0.1954], fit: { hip: [-0.15, 0.985], sh: [0.045, 1.467, 0.185, 1.385], foot: [-0.20, 0.40, 0.172], leanVis: 1.14, pov: [-0.15, 1.66, 0.36], chest: [0.125, 0.55, 0.42] } },
    /* the two sport bikes (tools/blender_sport.py): faired, clip-ons, a clear screen, a dash of their own (dash: centre of its glass and how far it leans back from upright, in degrees),
       two megaphones on the V4 (ex: under the tail, ex2: low on the right). clear: the screen is clear glass. heat: where the brake discs' friction rings are
       (f / r: inner radius, outer radius, z) and where the glow sits in each pipe ([place, direction, radius]). side: number on the tail's flanks [x, y, z, size, tilt] */
    stradav4: { wb: 1.45, Rr: 0.325, Rf: 0.30, rake: 24, head: [0.4495, 0.8451], PIV: [-0.135, 0.43], S0: [-0.18, 0.665], S1: [-0.243, 0.325], SPR: [-0.05, 0.435], chain: [0.0407, 0.1037, -0.126, 112],
      hose: [[0.5811, 0.746, 0.02], [0.5816, 0.6959, 0.07], [0.5619, 0.5558, 0.093], [0.5888, 0.4583, 0.099], [0.5434, 0.3127, 0.085]], hoseSides: [-1, 1],
      forkMax: 0.12, link: 0.4, linkage: { F0: [-0.165, 0.3], R0: [-0.36, 0.338], R2: [-0.22, 0.255] }, tyre: { ar: 0.0546, br: 0.1, af: 0.042, bf: 0.06 }, clear: true,
      ex: [[-0.6409, 0.7992, 0], [-0.9871, 0.1601, 0], 0.031], ex2: [[-0.3622, 0.2678, 0.1142], [-0.9751, 0.2065, 0.0803], 0.033],
      heat: { f: [0.119, 0.154, 0.069], r: [0.0844, 0.1093, 0.118], glow: [[[-0.6093, 0.7941, 0], [-0.9871, 0.1601, 0], 0.03], [[-0.331, 0.2612, 0.1117], [-0.9751, 0.2065, 0.0803], 0.031]] },
      bar: [0.3977, 0.8831, 0.2778], grip: [0.3979, 0.8832, 0.2774, -0.4252, -0.3042, 0.8524], lever: [0.066, 0.009], leverPiv: [0.4881, 0.9422, 0.2173, -0.4067, 0.9135, 0], dash: [0.52, 0.985, 52], povMove: [0.2, 0.13, 0.2], steerMax: 0.4, gripFollow: true, side: [-0.44, 0.852, 0.125, 0.07, -0.43],
      fit: { hip: [-0.25, 0.87], sh: [0.17, 1.16, 0.26, 1.07], foot: [-0.225, 0.475, 0.215], pov: [-0.04, 1.37, 0.36], chest: [-0.03, 0.47, 0.36], chestLegs: false } },
    corsa600: { wb: 1.38, Rr: 0.317, Rf: 0.30, rake: 24, head: [0.4145, 0.8451], PIV: [-0.1, 0.43], S0: [-0.145, 0.665], S1: [-0.208, 0.325], SPR: [-0.0287, 0.435], chain: [0.0407, 0.1037, -0.122, 110],
      hose: [[0.5461, 0.746, 0.02], [0.5466, 0.6959, 0.07], [0.5269, 0.5558, 0.093], [0.5538, 0.4583, 0.099], [0.5084, 0.3127, 0.085]], hoseSides: [-1, 1],
      forkMax: 0.12, link: 0.4, linkage: { F0: [-0.13, 0.3], R0: [-0.325, 0.338], R2: [-0.185, 0.255] }, tyre: { ar: 0.0505, br: 0.096, af: 0.042, bf: 0.06 }, clear: true,
      ex: [[-0.3272, 0.2678, 0.1142], [-0.9751, 0.2065, 0.0803], 0.031],
      heat: { f: [0.119, 0.154, 0.069], r: [0.0844, 0.1093, 0.114], glow: [[[-0.296, 0.2612, 0.1117], [-0.9751, 0.2065, 0.0803], 0.03]] },
      bar: [0.3627, 0.8831, 0.2778], grip: [0.3629, 0.8832, 0.2774, -0.4252, -0.3042, 0.8524], lever: [0.066, 0.009], leverPiv: [0.4531, 0.9422, 0.2173, -0.4067, 0.9135, 0], dash: [0.485, 0.985, 52], povMove: [0.2, 0.13, 0.2], steerMax: 0.4, gripFollow: true, side: [-0.405, 0.852, 0.125, 0.07, -0.43],
      fit: { hip: [-0.215, 0.87], sh: [0.156, 1.16, 0.246, 1.07], foot: [-0.19, 0.475, 0.215], pov: [-0.075, 1.37, 0.36], chest: [-0.03, 0.47, 0.36], chestLegs: false } }
  };
  function buildBike(spec, rider, opts) {
    opts = opts || {}; const env = opts.env || null; const st = spec.style; const naked = st.fairing === 'naked', mdl = st.model || (naked ? 'duetto' : null), MD = mdl ? SPRUNG[mdl] : null;
    const mats = sharedMats(env);
    const pat = opts.pattern != null ? opts.pattern : (rider.num % 4);
    const liv = spec.livery && rider.num === AX.RIDERS[0].num ? spec.livery : [rider.c1, rider.c2, rider.c3];
    const paint = paintMaterial(liv[0], liv[1], liv[2], pat, env);
    const wb = spec.wheelbase, hx = wb / 2, Rr = MD ? MD.Rr : 0.325, Rf = MD ? MD.Rf : 0.315, wR = 0.115, wF = 0.078;

    const rootG = new THREE.Group(), leanG = new THREE.Group(), pitchG = new THREE.Group(), bodyG = new THREE.Group(), susG = new THREE.Group();
    rootG.add(leanG); leanG.add(pitchG); pitchG.add(bodyG); bodyG.add(susG);
    const P = new GeoBuilder(), Mt = new GeoBuilder(), Me = new GeoBuilder(), Gl = new GeoBuilder();
    // the sprung bikes are modelled round a real steering head (the Duetto: 24 degrees, 34 mm offset)
    const rake = (MD ? MD.rake : 24) * Math.PI / 180;
    const steerHead = MD ? V3(hx - MD.wb / 2 + MD.head[0], MD.head[1], 0) : V3(hx - 0.27, 0.93, 0), forkDir = MD ? V3(Math.sin(rake), -Math.cos(rake), 0) : V3(hx, Rf, 0).sub(steerHead).normalize();

    // ---- frame, engine, swingarm
    const frameCol = naked ? rider.c1 : 0x2c2f35;
    for (const z of [-0.115, 0.115]) {
      if (naked) {       // trellis
        const a = V3(steerHead.x - 0.03, 0.9, z * 0.7), b = V3(-0.2, 0.5, z * 1.25), c = V3(0.12, 0.84, z * 1.2), d = V3(0.2, 0.52, z * 1.3), e2 = V3(-0.1, 0.8, z * 1.15);
        for (const [p, q] of [[a, c], [c, e2], [e2, b], [a, d], [d, b], [c, d], [d, e2]]) Gl.add(tubeBetween(p, q, 0.017, 0.017, 7), null, frameCol);
      } else {
        Me.add(tubeBetween(V3(steerHead.x - 0.02, 0.88, z * 0.6), V3(-0.18, 0.5, z * 1.2), 0.04, 0.05, 8), M(0, 0, 0, 0, 0, 0, 1, 1, 0.6), 0x9da2a8);
      }
      Me.add(tubeBetween(V3(-0.2, 0.47, z * 1.1), V3(-hx, Rr, z * 1.25), 0.042, 0.03, 8), null, naked ? 0x25272b : 0xb5b9be);
      // subframe
      Mt.add(tubeBetween(V3(-0.16, 0.74, z * 0.9), V3(-0.62, 0.86, z * 0.55), 0.016, 0.014, 6), null, 0x1c1e22);
    }
    // engine
    Mt.add(roundedBox(0.4, 0.3, 0.3, 0.07), M(0.06, 0.4, 0), 0x2a2c30);
    Mt.add(roundedBox(0.26, 0.26, 0.26, 0.06), M(0.14, 0.6, 0, 0, 0, 0.35), 0x34373c);
    if (naked) {
      for (let i = 0; i < 5; i++) Me.add(roundedBox(0.2, 0.012, 0.3, 0.005, 1), M(0.16 - i * 0.012, 0.52 + i * 0.045, 0, 0, 0, 0.35), 0x7d8288);
      Mt.add(roundedBox(0.03, 0.26, 0.3, 0.012, 2), M(0.38, 0.52, 0, 0, 0, -0.25), 0x16181b); // radiator
      Me.add(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 20), M(-0.02, 0.36, 0, Math.PI / 2, 0, 0), 0x55595f);
    }
    // shock + chain
    Me.add(tubeBetween(V3(-0.2, 0.72, 0), V3(-0.3, 0.42, 0), 0.03, 0.03, 10), null, naked ? 0xd8b21a : 0xd23a2a);
    Mt.add(roundedBox(0.52, 0.02, 0.015, 0.006, 1), M(-0.44, 0.37, -0.13, 0, 0, -0.1), 0x3a3c40);

    // ---- bodywork
    const tankTop = naked ? 0.98 : 0.97;
    P.add(loft([
      { x: 0.44, y: 0.82, w: 0.05, ht: 0.05, hb: 0.05 }, { x: 0.40, y: 0.84, w: 0.12, ht: 0.10, hb: 0.10 },
      { x: 0.30, y: 0.84, w: 0.165, ht: tankTop - 0.84, hb: 0.14, e: 2.6 }, { x: 0.12, y: 0.84, w: 0.175, ht: tankTop - 0.845, hb: 0.16, e: 2.8 },
      { x: -0.04, y: 0.82, w: 0.15, ht: 0.10, hb: 0.14, e: 2.6 }, { x: -0.14, y: 0.80, w: 0.12, ht: 0.045, hb: 0.10 }, { x: -0.17, y: 0.79, w: 0.06, ht: 0.02, hb: 0.05 }
    ], 24));
    // seat
    Mt.add(loft([{ x: -0.13, y: 0.80, w: 0.05, ht: 0.02 }, { x: -0.18, y: 0.795, w: 0.13, ht: 0.035, hb: 0.03 }, { x: -0.36, y: 0.80, w: 0.135, ht: 0.035, hb: 0.03 }, { x: -0.44, y: 0.82, w: 0.10, ht: 0.03 }], 16), null, 0x17181b);
    // tail
    const tH = st.tail === 'tall' ? 0.045 : 0.0;
    P.add(loft([
      { x: -0.12, y: 0.74, w: 0.12, ht: 0.03, hb: 0.05 }, { x: -0.30, y: 0.75, w: 0.14, ht: 0.03, hb: 0.06 },
      { x: -0.44, y: 0.83 + tH * 0.5, w: 0.125, ht: 0.055 + tH, hb: 0.07, e: 2.6 }, { x: -0.60, y: 0.89 + tH, w: 0.095, ht: 0.05 + tH * 0.6, hb: 0.055, e: 2.6 },
      { x: -0.74, y: 0.93 + tH, w: 0.055, ht: 0.03, hb: 0.03 }, { x: -0.79, y: 0.945 + tH, w: 0.02, ht: 0.012 }
    ], 20));
    if (!naked) {
      // side fairing + belly pan (one continuous body around the engine)
      P.add(loft([
        { x: 0.70, y: 0.62, w: 0.05, ht: 0.10, hb: 0.10 }, { x: 0.62, y: 0.58, w: 0.14, wb: 0.11, ht: 0.20, hb: 0.20, e: 2.6 },
        { x: 0.46, y: 0.53, w: 0.20, wb: 0.12, ht: 0.26, hb: 0.28, e: 2.8 }, { x: 0.24, y: 0.50, w: 0.215, wb: 0.12, ht: 0.23, hb: 0.29, e: 2.8 },
        { x: 0.0, y: 0.46, w: 0.20, wb: 0.11, ht: 0.17, hb: 0.26, e: 2.7 }, { x: -0.2, y: 0.39, w: 0.15, wb: 0.08, ht: 0.08, hb: 0.17, e: 2.5 },
        { x: -0.34, y: 0.33, w: 0.08, wb: 0.05, ht: 0.05, hb: 0.10 }, { x: -0.4, y: 0.30, w: 0.03, ht: 0.02, hb: 0.04 }
      ], 26));
      // nose / upper fairing
      P.add(loft([
        { x: 0.93, y: 0.80, w: 0.02, ht: 0.02 }, { x: 0.89, y: 0.80, w: 0.09, ht: 0.055, hb: 0.07 },
        { x: 0.78, y: 0.82, w: 0.165, ht: 0.10, hb: 0.13, e: 2.6 }, { x: 0.64, y: 0.86, w: 0.205, ht: 0.13, hb: 0.17, e: 2.8 },
        { x: 0.50, y: 0.88, w: 0.20, ht: 0.11, hb: 0.14, e: 2.8 }, { x: 0.42, y: 0.87, w: 0.14, ht: 0.06, hb: 0.08 }
      ], 24, true, true));
      // screen
      const scr = loft([
        { x: 0.80, y: 0.925, w: 0.06, ht: 0.012, hb: 0.0 }, { x: 0.70, y: 0.975, w: 0.115, ht: 0.05, hb: 0.0, e: 2.2 },
        { x: 0.58, y: 0.995, w: 0.13, ht: 0.085, hb: 0.0, e: 2.2 }, { x: 0.50, y: 1.0, w: 0.12, ht: 0.09, hb: 0.0, e: 2.2 }
      ], 16, false, false);
      const sm = new THREE.Mesh(scr, mats.screen); susG.add(sm);
      // headlights + intake
      Gl.add(roundedBox(0.03, 0.035, 0.085, 0.012, 2), M(0.895, 0.80, 0.055, 0, -0.5, 0), 0xf6f9ff);
      Gl.add(roundedBox(0.03, 0.035, 0.085, 0.012, 2), M(0.895, 0.80, -0.055, 0, 0.5, 0), 0xf6f9ff);
      Mt.add(roundedBox(0.03, 0.04, 0.05, 0.012, 2), M(0.925, 0.78, 0), 0x0c0d0f);
      if (st.winglets) for (const z of [-1, 1]) Mt.add(roundedBox(0.13, 0.014, 0.09, 0.006, 2), M(0.66, 0.74, z * 0.235, z * -0.25, z * 0.12, 0), 0x121315);
    } else {
      // round headlight, small fly screen, radiator shrouds
      Mt.add(new THREE.SphereGeometry(0.095, 20, 14), M(0.62, 0.88, 0, 0, 0, 0, 0.75, 1, 1), 0x15161a);
      Gl.add(new THREE.SphereGeometry(0.08, 20, 12), M(0.655, 0.88, 0, 0, 0, 0, 0.5, 1, 1), 0xf6f9ff);
      P.add(loft([{ x: 0.62, y: 0.99, w: 0.03, ht: 0.01 }, { x: 0.57, y: 1.0, w: 0.1, ht: 0.05, hb: 0.01 }, { x: 0.5, y: 0.985, w: 0.11, ht: 0.03, hb: 0.01 }], 12));
      for (const z of [-1, 1]) P.add(loft([{ x: 0.44, y: 0.72, w: 0.012, ht: 0.03 }, { x: 0.36, y: 0.68, w: 0.022, ht: 0.11, e: 3 }, { x: 0.22, y: 0.7, w: 0.022, ht: 0.09, e: 3 }, { x: 0.14, y: 0.74, w: 0.012, ht: 0.03 }], 10), M(0, 0, z * 0.185));
    }
    // rear hugger + tail light + plate holder
    P.add(arcShell(Rr + 0.03, wR + 0.02, 0.012, 0.9, 2.2, 14, 5), M(-hx, Rr, 0));
    Gl.add(roundedBox(0.02, 0.022, 0.07, 0.008, 2), M(-0.795, 0.94 + tH, 0), 0xff2a1a);
    // exhaust
    if (st.exhaust === 'under') {
      for (const z of [-0.055, 0.055]) Me.add(capsule(0.036, 0.04, 0.2, 12), M(-0.52, 0.8, z, 0, 0, Math.PI / 2 + 0.22), 0x6f7378);
      Me.add(tubeBetween(V3(0.18, 0.28, 0.1), V3(-0.3, 0.32, 0.06), 0.03, 0.03, 8), null, 0x8a6a3a);
    } else {
      Me.add(tubeBetween(V3(0.2, 0.32, 0.1), V3(-0.18, 0.44, 0.15), 0.032, 0.036, 10), null, 0x8a6a3a);
      Me.add(capsule(0.056, 0.062, 0.34, 16), M(-0.18, 0.45, 0.16, 0, 0, Math.PI / 2 + 0.42), naked ? 0x2a2c30 : 0xa8adb3);
      if (naked) Me.add(capsule(0.046, 0.05, 0.28, 14), M(-0.2, 0.55, 0.15, 0, 0, Math.PI / 2 + 0.42), 0x2a2c30);
    }
    // footpegs
    for (const z of [-1, 1]) { Me.add(tubeBetween(V3(-0.2, 0.52, z * 0.14), V3(-0.24, 0.46, z * 0.17), 0.012, 0.012, 6), null, 0x9da2a8); Me.add(tubeBetween(V3(-0.24, 0.46, z * 0.15), V3(-0.24, 0.46, z * 0.22), 0.014, 0.014, 6), null, 0x1a1b1e); }

    const paintMesh = new THREE.Mesh(P.build(), paint);
    susG.add(paintMesh, new THREE.Mesh(Mt.build(), mats.matte), new THREE.Mesh(Me.build(), mats.metal), new THREE.Mesh(Gl.build(), mats.gloss));

    // ---- brake light (separate so it can glow)
    const brakeMat = new THREE.MeshBasicMaterial({ color: 0x551008 });
    const brakeLight = new THREE.Mesh(roundedBox(0.012, 0.03, 0.09, 0.006, 1), brakeMat); brakeLight.position.set(-0.805, 0.94 + tH, 0); susG.add(brakeLight);

    // ---- front end (steers)
    const steerPivot = new THREE.Group(); steerPivot.position.copy(steerHead);
    // align pivot's -Y with the fork direction
    steerPivot.quaternion.setFromUnitVectors(V3(0, -1, 0), forkDir);
    const steerG = new THREE.Group(); steerPivot.add(steerG); susG.add(steerPivot); let handLevers = null;
    const inv = new THREE.Matrix4().compose(steerHead, steerPivot.quaternion, V3(1, 1, 1)).invert();
    const F1 = new GeoBuilder(), F2 = new GeoBuilder(), FP = new GeoBuilder();
    for (const z of [-0.105, 0.105]) {
      const top = steerHead.clone().add(V3(-0.03, 0.03, z)), mid = top.clone().lerp(V3(hx, Rf, z), 0.5), bot = V3(hx, Rf, z);
      F2.add(tubeBetween(top, mid, 0.03, 0.03, 10), inv, spec.id === 'corsa' ? 0x1d1f23 : 0xcfa41d);
      F2.add(tubeBetween(mid, bot, 0.024, 0.024, 10), inv, 0xc9ccd0);
      F1.add(roundedBox(0.1, 0.06, 0.04, 0.014, 2), M(hx - 0.13, Rf + 0.06, z * 1.0, 0, 0, 1.1).premultiply(inv), 0xb8911a); // calipers
    }
    F1.add(roundedBox(0.07, 0.03, 0.27, 0.012, 2), M(steerHead.x - 0.02, steerHead.y + 0.03, 0).premultiply(inv), 0x1b1c20);
    const barY = MD && MD.bar ? MD.bar[1] : st.bars === 'wide' ? 1.036 : 0.905, barX = MD && MD.bar ? hx - MD.wb / 2 + MD.bar[0] : st.bars === 'wide' ? hx - 0.405 : hx - 0.27, barZ = MD && MD.bar ? MD.bar[2] : st.bars === 'wide' ? 0.325 : 0.265;
    if (st.bars === 'wide') {
      F1.add(tubeBetween(V3(barX + 0.06, 0.97, -0.1), V3(barX + 0.06, 0.97, 0.1), 0.014, 0.014, 6), inv, 0x1a1b1e);
      for (const z of [-1, 1]) { F1.add(tubeBetween(V3(barX + 0.06, 0.97, z * 0.1), V3(barX + 0.02, barY, z * 0.2), 0.014, 0.014, 6), inv, 0x1a1b1e); F1.add(tubeBetween(V3(barX + 0.02, barY, z * 0.2), V3(barX, barY, z * (barZ + 0.05)), 0.016, 0.016, 6), inv, 0x1a1b1e); }
    } else for (const z of [-1, 1]) F1.add(tubeBetween(V3(steerHead.x - 0.03, barY + 0.01, z * 0.1), V3(barX - 0.02, barY - 0.02, z * (barZ + 0.05)), 0.015, 0.015, 6), inv, 0x1a1b1e);
    FP.add(arcShell(Rf + 0.028, wF + 0.022, 0.012, 0.35, 2.3, 16, 5), M(hx, Rf, 0).premultiply(inv));
    steerG.add(new THREE.Mesh(F1.build(), mats.matte), new THREE.Mesh(F2.build(), mats.metal), new THREE.Mesh(FP.build(), paint));
    const wheelF = new THREE.Mesh(wheelGeometry(Rf, wF, RIMS[spec.id] || 0x222, false), mats.gloss);
    const wfHolder = new THREE.Group(); wfHolder.applyMatrix4(M(hx, Rf, 0).premultiply(inv)); wfHolder.add(wheelF); steerG.add(wfHolder);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(wb + 0.9, 0.62), contactShadowMat()); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.034; shadow.renderOrder = 3; rootG.add(shadow);
    const wheelR = new THREE.Mesh(wheelGeometry(Rr, wR, RIMS[spec.id] || 0x222, true), mats.gloss); wheelR.position.set(-hx, Rr, 0); bodyG.add(wheelR);

    // ---- Blender superbike (faired bikes): swap the procedural parts for the modelled ones, keep the rig
    const NEWM = { strada: 'super', corsa: 'corsa' }[spec.id], SUPV = !MD && NEWM && AX.Assets && AX.Assets.has('bike/' + NEWM + '_body') ? NEWM : null, SUP = !!SUPV, CORSA = SUPV === 'corsa';   // the supersports use their own models
    let susp = null;
    const BV = MD ? mdl : SUP ? SUPV : 'strada', BWB = MD ? MD.wb : SUP ? 1.42 : 1.45, BMOD = !!(AX.Assets && AX.Assets.has('bike/' + BV + '_body'));
    if (BMOD) {
      const sx = wb / BWB, Sx = new THREE.Matrix4().makeScale(sx, 1, 1);
      paint.vertexColors = true;
      const catMat = (n) => /^P_/.test(n) ? paint : /^X_/.test(n) ? mats.metal : /^C_/.test(n) ? mats.chrome : /^G_/.test(n) ? mats.gloss : /^S_/.test(n) ? (MD && MD.clear ? mats.clear : mats.screen) : /^L_/.test(n) ? brakeMat : mats.matte;
      const merged = (name, pre) => {
        const groups = new Map();
        for (const p of AX.Assets.get(name).parts) { const k = (p.material.name || 'M_').slice(0, 2); (groups.get(k) || groups.set(k, []).get(k)).push(p.geometry); }
        const out = [];
        groups.forEach((list, k) => {
          let n = 0, ni = 0; list.forEach((g) => { n += g.attributes.position.count; ni += g.index.count; });
          const Pp = new Float32Array(n * 3), Nn = new Float32Array(n * 3), Cc = new Float32Array(n * 3).fill(1), I = new Uint32Array(ni); let o = 0, oi = 0;
          for (const g of list) { Pp.set(g.attributes.position.array, o * 3); Nn.set(g.attributes.normal.array, o * 3); if (g.attributes.color) Cc.set(g.attributes.color.array, o * 3); const ix = g.index.array; for (let q = 0; q < ix.length; q++) I[oi + q] = ix[q] + o; o += g.attributes.position.count; oi += ix.length; }
          const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3)); geo.setIndex(new THREE.BufferAttribute(I, 1));
          if (pre) geo.applyMatrix4(pre); geo.computeBoundingSphere();
          out.push(new THREE.Mesh(geo, catMat(k + '_')));
        });
        return out;
      };
      for (const c of susG.children.slice()) if (c.isMesh && c !== brakeLight) susG.remove(c);
      for (const c of steerG.children.slice()) if (c.isMesh) steerG.remove(c);
      merged('bike/' + BV + '_body', Sx).forEach((m) => susG.add(m));
      merged('bike/' + BV + '_front', new THREE.Matrix4().multiplyMatrices(inv, Sx)).forEach((m) => steerG.add(m));
      if (MD && MD.leverPiv && AX.Assets.has('bike/' + BV + '_leverR')) {
        /* hand levers as parts of their own (leverR: front brake, leverL: clutch): each swings about its pivot bolt, towards the grip.
           s: 0 left, 1 right (as the rider's arms) · sgn: which way round the pivot brings the lever in */
        const pre = new THREE.Matrix4().multiplyMatrices(inv, Sx), Lp = MD.leverPiv; handLevers = [];
        for (const sg of [-1, 1]) {
          const pv = V3(Lp[0], Lp[1], sg * Lp[2]).applyMatrix4(pre), ax = V3(Lp[3], Lp[4], sg * Lp[5]).transformDirection(pre), g = new THREE.Group(); g.position.copy(pv); steerG.add(g);
          merged('bike/' + BV + (sg > 0 ? '_leverR' : '_leverL'), new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z).multiply(pre)).forEach((m) => g.add(m));
          handLevers.push({ g, ax, s: sg > 0 ? 1 : 0, sgn: sg, max: MD.leverMax || 0.17 });
        }
      }
      for (const [w, nm] of [[wheelF, 'bike/' + BV + '_wheelF'], [wheelR, 'bike/' + BV + '_wheelR']]) { w.geometry = new THREE.BufferGeometry(); merged(nm).forEach((m) => w.add(m)); }
      if (CORSA) { brakeLight.position.set(-0.882 * sx, 0.985, 0); brakeLight.scale.set(1, 0.9, 1.05); }
      else if (SUP) { brakeLight.position.set(-0.857 * sx, 0.962, 0); brakeLight.rotation.z = -0.35; brakeLight.scale.set(1, 0.45, 0.95); }
      else if (MD) { brakeLight.position.set(-0.7445 * sx, 0.863, 0); brakeLight.scale.set(1, 0.55, 1.24); brakeLight.visible = !AX.Assets.has('bike/' + BV + '_swing'); }      // the Duetto's light is a band let into the tail (material L_)
      if (MD && AX.Assets.has('bike/' + BV + '_swing')) {
        /* working suspension: the fork lowers slide in the outer tubes, the swingarm turns about its pivot, the shock is squeezed between them.
           All positions are the model's own (SPRUNG). */
        const PIV = V3(MD.PIV[0], MD.PIV[1], 0), S0 = V3(MD.S0[0], MD.S0[1], 0), S1 = V3(MD.S1[0], MD.S1[1], 0), SPR = V3(MD.SPR[0], MD.SPR[1], 0), Tm = (v) => new THREE.Matrix4().makeTranslation(-v.x, -v.y, 0), nm = 'bike/' + BV + '_';
        const forkG = new THREE.Group(); steerG.add(forkG); merged(nm + 'fork', new THREE.Matrix4().multiplyMatrices(inv, Sx)).forEach((m) => forkG.add(m)); forkG.add(wfHolder);
        const swingG = new THREE.Group(); swingG.position.copy(PIV); susG.add(swingG); merged(nm + 'swing', Tm(PIV)).forEach((m) => swingG.add(m));
        const sv = S1.clone().sub(S0), sl = sv.length(), Rm = new THREE.Matrix4().makeRotationZ(-Math.atan2(sv.y, sv.x));      // shock parts lie along local +x, turning about the top eye
        const shU = new THREE.Group(); shU.position.copy(S0); susG.add(shU); merged(nm + 'shockU', Rm.clone().multiply(Tm(S0))).forEach((m) => shU.add(m));
        const spring = merged(nm + 'spring', Rm.clone().multiply(Tm(S0))); spring.forEach((m) => shU.add(m));
        const shL = new THREE.Group(); susG.add(shL); merged(nm + 'shockL', Rm.clone().multiply(Tm(S1))).forEach((m) => shL.add(m));
        // shock linkage: the rocker turns about its pivot on the frame, the dog bones about their eye on the swingarm
        let lk = null;
        if (MD.linkage && AX.Assets.has(nm + 'link') && AX.Assets.has(nm + 'rod')) {
          const q = MD.linkage, F0 = V3(q.F0[0], q.F0[1], 0), R0 = V3(q.R0[0], q.R0[1], 0), R2 = V3(q.R2[0], q.R2[1], 0);
          const linkG = new THREE.Group(); linkG.position.copy(F0); susG.add(linkG); merged(nm + 'link', Tm(F0)).forEach((m) => linkG.add(m));
          const rodG = new THREE.Group(); rodG.position.copy(R0); susG.add(rodG); merged(nm + 'rod', Tm(R0)).forEach((m) => rodG.add(m));
          const a = R2.distanceTo(F0), b = R2.distanceTo(R0), dx = R0.x - F0.x, dy = R0.y - F0.y;
          lk = { linkG, rodG, F0, r0: R0.clone().sub(PIV), s1: S1.clone().sub(F0), a, b, a0: Math.atan2(R2.y - F0.y, R2.x - F0.x), b0: Math.atan2(R2.y - R0.y, R2.x - R0.x),
            sg: (R2.x - F0.x) * -dy + (R2.y - F0.y) * dx > 0 ? 1 : -1 };      // sg: which side of the line pivot - swingarm eye the rocker's eye lies on (it stays there)
        }
        // chain: outer and inner links by turns, laid round the two sprockets every frame
        const NL = MD.chain[3], pitch = 0.01634, chain = [0, 1].map((k) => { const im = new THREE.InstancedMesh(linkGeometry(!k, pitch), mats.metal, NL / 2); im.frustumCulled = false; susG.add(im); return im; });
        // brake hoses from the splitter on the lower clamp down to the calipers: the top is clamped, the bottom rides with the fork
        const HP = MD.hose, hoses = MD.hoseSides.map((sd) => {
          const m = hoseMesh(mats.metal, 0x3c3e43, 22, 6); m.userData.pts = HP.map((q) => V3(q[0] * sx, q[1], q[2] * sd).applyMatrix4(inv)); m.userData.cur = m.userData.pts.map((q) => q.clone()); steerG.add(m); return m; });
        susp = { forkG, swingG, shU, shL, spring, chain, hoses, PIV, S0, SPR, k: MD.travel || 1, dmax: MD.forkMax || 0.13, link: MD.link || 0, lk, r1: MD.chain[0], r2: MD.chain[1], cz: MD.chain[2], s1r: S1.clone().sub(PIV), sl, L: Math.hypot(-hx - PIV.x, Rr - PIV.y), psi0: Math.atan2(Rr - PIV.y, -hx - PIV.x), axle0: wfHolder.position.clone(), NL, pitch, d: 1, th: 0, ph: 0, top: 0 };
        // number and name on the tank side panels
        for (const [dn, tex] of [['decalR', panelTexture(rider.num)], ['decalL', panelTexture(null)]]) {
          if (!AX.Assets.has(nm + dn)) continue;
          const g = AX.Assets.get(nm + dn).parts[0].geometry.clone(), uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k)); g.applyMatrix4(Sx);
          const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.userData.decal = true; susG.add(m);
        }
      }
      else { brakeLight.position.set(-0.812 * sx, 0.995, 0); brakeLight.scale.set(1, 0.8, 0.85); }
    }

    // number roundels on the tail sides
    const numTex = numberTexture(rider.num, rider.c3 === '#ffffff' ? '#ffffff' : '#f4f4f0', '#111111');
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, toneMapped: true });
    if (MD && BMOD) {   // the sprung bikes carry their number on the plate in front of the fork (steers with it), if they have one
      if (MD.plate) {
      const sn = Math.sin(rake), cs = Math.cos(rake), m = new THREE.Mesh(new THREE.PlaneGeometry(MD.plate[2], MD.plate[2]), numMat);
      const mb = new THREE.Matrix4().makeBasis(V3(0, 0, -1), V3(-sn, cs, 0), V3(cs, sn, 0)).setPosition(hx - MD.wb / 2 + MD.plate[0], MD.plate[1], 0);
      m.applyMatrix4(mb.premultiply(inv)); steerG.add(m); }
      if (MD.side) for (const z of [-1, 1]) {   // and on the white fields of the side panels
        const n2 = new THREE.Mesh(new THREE.PlaneGeometry(MD.side[3], MD.side[3]), numMat); n2.position.set(MD.side[0] * wb / BWB, MD.side[1], z * MD.side[2]); n2.rotation.y = z > 0 ? 0 : Math.PI; if (MD.side[4]) n2.rotation.x = z * MD.side[4]; n2.userData.decal = true; susG.add(n2); }
    } else
    for (const z of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), numMat); if (SUP) m.position.set(-0.56 * wb / BWB, CORSA ? 0.875 : 0.89, z * (CORSA ? 0.124 : 0.117)); else m.position.set(BMOD ? -0.5 * wb / BWB : -0.5, BMOD ? (naked ? 0.85 : 0.875) : 0.86 + tH * 0.5, z * (BMOD ? (naked ? 0.108 : 0.137) : 0.128)); m.rotation.y = z > 0 ? 0 : Math.PI; m.rotation.x = z * -0.25; susG.add(m); }

    // ---- rider
    const riderRig = buildRider(spec, rider, mats, numTex, { barX, barY, barZ });
    susG.add(riderRig.group);
    if (MD && MD.gripFollow) {      // the hands go with the bars
      const pivM = new THREE.Matrix4().compose(steerHead, steerPivot.quaternion, V3(1, 1, 1));
      riderRig.gripAt = (out, sg) => { steerG.updateMatrix(); return out.set(barX, barY + 0.02, sg * barZ).applyMatrix4(inv).applyMatrix4(steerG.matrix).applyMatrix4(pivM); };
    }
    if (MD && MD.grip && riderRig.hands) {      // modelled hands: the middle of the grip and the way its tube points, turned with the bars; where the lever lies from there
      const G = MD.grip, gx = hx - MD.wb / 2 + G[0], pivM = MD.gripFollow ? new THREE.Matrix4().compose(steerHead, steerPivot.quaternion, V3(1, 1, 1)) : null, _g = V3();
      const turn = (v) => pivM ? v.applyMatrix4(inv).applyMatrix4(steerG.matrix).applyMatrix4(pivM) : v;
      riderRig.gripFrame = (pos, axis, sg) => { if (pivM) steerG.updateMatrix(); turn(pos.set(gx, G[1], sg * G[2])); turn(axis.set(gx + sg * G[3], G[1] + sg * G[4], sg * G[2] + G[5])).sub(pos).normalize(); };
      if (MD.lever) riderRig.lever = MD.lever;
      if (handLevers && MD.lever) {
        // the lever under index and middle finger, swung in about its pivot: where it lies then, seen from the grip's axis like MD.lever (the fingers follow it there)
        const a = V3(G[3], G[4], G[5]).normalize(), ex = V3(1, 0, 0).addScaledVector(a, -a.x).normalize(), ey = V3().crossVectors(a, ex), gc = V3(G[0], G[1], G[2]), Lp = MD.leverPiv;
        const l0 = gc.clone().addScaledVector(ex, MD.lever[0]).addScaledVector(ey, MD.lever[1]).addScaledVector(a, -0.02), P = V3(Lp[0], Lp[1], Lp[2]), d = V3(Lp[3], Lp[4], Lp[5]).normalize(), mx = handLevers[1].max;
        const at = (th) => l0.clone().sub(P).applyAxisAngle(d, th).add(P).sub(gc), p1 = at(mx), p2 = at(-mx), sgn = p1.dot(ex) < p2.dot(ex) ? 1 : -1, pp = sgn > 0 ? p1 : p2;
        riderRig.leverTo = [pp.dot(ex), pp.dot(ey)]; handLevers[1].sgn = sgn; handLevers[0].sgn = -sgn;      // (the left lever is the mirror image: it turns the other way round)
      }
    }

    rootG.traverse((o) => { if (o.isMesh && o !== shadow) { o.castShadow = !o.userData.decal && !o.isInstancedMesh; o.receiveShadow = false; } });
    // signs of heat: a dull glow deep in the exhaust, brake discs that begin to glow after a few hard stops (looks only). heat: true = the Duetto's own places
    let heat = null;
    if (MD && BMOD && MD.heat) {
      const HT = MD.heat === true ? { f: [0.123, 0.159, 0.072], r: [0.092, 0.121, 0.088], glow: [[[-0.72, 0.4905, 0.2216], [-0.866, 0.483, 0.129], 0.041]] } : MD.heat;
      const gm = (map) => new THREE.MeshBasicMaterial({ color: 0x000000, map: map || null, transparent: true, opacity: map ? 1 : 0, blending: map ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });   // exhaust: light added in the dark bore; discs: the metal itself turns colour
      const put = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.renderOrder = 3; parent.add(m); return m; };
      const mF = gm(), mR = gm(), mE = gm(heatTexture()), ringF = new THREE.RingGeometry(HT.f[0], HT.f[1], 40), ringR = new THREE.RingGeometry(HT.r[0], HT.r[1], 32);
      for (const zc of [-HT.f[2], HT.f[2]]) for (const dz of [-0.0036, 0.0036]) put(ringF, mF, wheelF, 0, 0, zc + dz);
      for (const dz of [-0.0036, 0.0036]) put(ringR, mR, wheelR, 0, 0, HT.r[2] + dz);
      for (const q of HT.glow) { const ex = put(new THREE.CircleGeometry(q[2], 20), mE, susG, q[0][0] * wb / BWB, q[0][1], q[0][2]); ex.quaternion.setFromUnitVectors(V3(0, 0, 1), V3(q[1][0], q[1][1], q[1][2]).normalize()); }
      heat = { mF, mR, mE, tf: 0, tr: 0, te: 0, flash: 0 };
    }
    const wear = MD && BMOD ? [tyreSkin(wheelF, mats.matte, Rf - MD.tyre.af, MD.tyre.bf + 0.001), tyreSkin(wheelR, mats.matte, Rr - MD.tyre.ar, MD.tyre.br + 0.0016)] : null;
    // where the pipe ends, which way it points and how wide it is (in the sprung body's own frame)
    const EX = MD && BMOD ? [V3(MD.ex[0][0] * wb / BWB, MD.ex[0][1], MD.ex[0][2]), V3(MD.ex[1][0], MD.ex[1][1], MD.ex[1][2]), MD.ex[2]] : CORSA ? [V3(-0.87 * wb / 1.42, 0.876, 0), V3(-1, 0.12, 0), 0.028] : SUP ? [V3(-0.73 * wb / 1.42, 0.55, 0.205), V3(-0.9, 0.42, 0.04), 0.034] : st.exhaust === 'under' ? [V3(-0.78, 0.82, 0), V3(-1, 0.12, 0), 0.028]
      : [V3(-0.5, 0.6, 0.16), V3(-0.9, 0.4, 0), 0.04];
    const flame = { mat: flameMaterial(), meshes: [], I: 0, len: 0.2 }; flame.mat.uniforms.uRad.value = EX[2]; EX[1].normalize();
    const tongues = MD && BMOD && MD.ex2 ? [[EX[0], EX[1]], [V3(MD.ex2[0][0] * wb / BWB, MD.ex2[0][1], MD.ex2[0][2]), V3(MD.ex2[1][0], MD.ex2[1][1], MD.ex2[1][2]).normalize()]]      // two pipes that end in different places
      : (!MD && (CORSA || (!BMOD && st.exhaust === 'under')) ? [-0.055, 0.055] : [0]).map((z) => [V3(EX[0].x, EX[0].y, EX[0].z + z), EX[1]]);      // twin pipes under the seat: one tongue each
    for (const [ep, ed] of tongues) {
      const m = new THREE.Mesh(flameGeometry(), flame.mat); m.position.copy(ep).addScaledVector(ed, -0.012); m.quaternion.setFromUnitVectors(V3(0, 1, 0), ed);
      m.visible = false; m.castShadow = false; m.frustumCulled = false; m.renderOrder = 4; susG.add(m); flame.meshes.push(m);
    }
    const batched = opts.batch !== false;
    const sc = (st.scale || 1) * AX.BIKE_SCALE; rootG.scale.setScalar(sc);

    const bike = {
      root: rootG, leanG, pitchG, bodyG, susG, steerG, wheelF, wheelR, handLevers, rider: riderRig, paint, brakeMat, spec, scale: sc,
      Rr, Rf, hx, wfHolder, shadow, rT: 0.105, heat, wear, susp, flame, tyre: MD && BMOD ? MD.tyre : null, povMove: MD && MD.povMove ? MD.povMove : null, steerMax: MD && MD.steerMax ? MD.steerMax : 0, dashAt: MD && BMOD && MD.dash ? [MD.dash[0] * wb / BWB, MD.dash[1], (90 - MD.dash[2]) * Math.PI / 180] : null, dive: 0, diveV: 0, steerVis: 0, shake: 0, crashedVis: false, riderHolder: null,
      /* contact patches in world space (for skid marks / smoke) */
      rearContact(out) { return out.set(-hx, 0.02, 0).applyMatrix4(leanG.matrixWorld); },
      frontContact(out) { return out.set(hx, 0.02, 0).applyMatrix4(leanG.matrixWorld); },
      pop(k) { if (flame.meshes[0].parent) { flame.I = Math.max(flame.I, k); flame.len = (0.13 + 0.12 * Math.random()) * (0.7 + 0.5 * k); } },      // afterfire: k = how hard (0..1)
      exhaustPos(out) { return (MD && BMOD ? out.set(EX[0].x, EX[0].y, EX[0].z) : CORSA ? out.set(-0.87 * wb / 1.42, 0.876, 0) : SUP ? out.set(-0.73 * wb / 1.42, 0.55, 0.205) : st.exhaust === 'under' ? out.set(-0.78, 0.82, 0) : out.set(-0.5, 0.6, 0.16)).applyMatrix4(susG.matrixWorld); }
    };
    if (batched) riderRig.group.traverse((o) => { if (o.isMesh && o.userData.rb) RB.add(o, bike); });
    else riderRig.group.traverse((o) => {   // stand-alone rider (ghost): give each limb its own coloured geometry back
      if (!o.isMesh || !o.userData.rb) return; const d = o.userData.rb, g = o.geometry.clone(); if (d.scale) g.applyMatrix4(d.scale);
      const c = d.col.isColor ? d.col : lin(d.col), col = g.attributes.color.array; for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; } o.geometry = g; });
    return bike;
  }
  AX.BIKE_SCALE = 1.28;
  let _csMat = null;
  function contactShadowMat() {
    if (_csMat) return _csMat;
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 32, 2, 64, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.setTransform(2, 0, 0, 1, -64, 0); g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
    _csMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    return _csMat;
  }

  /* ---------------------------------------------------------------- rider */
  /* ---------------------------------------------------------------- rider batching */
  function withWhite(g) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); return g; }
  function cylGeo(r0, r1) { const g = new THREE.CylinderGeometry(r1, r0, 1, 12, 1, true); g.translate(0, 0.5, 0); return withWhite(g); }
  function sphGeo() { return withWhite(new THREE.SphereGeometry(1, 14, 10)); }
  const _bm = new THREE.Matrix4();
  const RB = AX.RiderBatch = {
    geos: {}, ims: {}, entries: [], scene: null, cap: 32, mat: null,
    geo(key, make) { return this.geos[key] || (this.geos[key] = make()); },
    add(mesh, owner) { mesh.visible = false; this.entries.push({ mesh, owner, key: mesh.userData.rb.key, col: mesh.userData.rb.col.isColor ? mesh.userData.rb.col.clone() : lin(mesh.userData.rb.col), scale: mesh.userData.rb.scale || null }); },
    remove(owner) { this.entries = this.entries.filter((e) => e.owner !== owner); },
    /* a camera that sits behind the rider's arms looks into their open ends: with both faces drawn it sees the inside of the sleeve instead of the road through it */
    setTwoSided(on) { this.twoSided = !!on; const sd = on ? THREE.DoubleSide : THREE.FrontSide; if (this.mat && this.mat.side !== sd) { this.mat.side = sd; this.mat.needsUpdate = true; } },
    im(key) {
      let im = this.ims[key]; if (im) return im;
      if (!this.mat) this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, envMap: SHARED.env || null, envMapIntensity: 0.3, side: this.twoSided ? THREE.DoubleSide : THREE.FrontSide });
      im = new THREE.InstancedMesh(this.geos[key], this.mat, this.cap * 4); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4 * 3), 3); im.count = 0; im.castShadow = true; im.frustumCulled = false;
      return (this.ims[key] = im);
    },
    /* call once per frame, after the scene's world matrices are current */
    flush(scene) {
      if (scene !== this.scene) { for (const k in this.ims) { if (this.ims[k].parent) this.ims[k].parent.remove(this.ims[k]); } this.scene = scene; for (const k in this.ims) scene.add(this.ims[k]); }
      for (const k in this.ims) this.ims[k].count = 0;
      for (const e of this.entries) {
        if (!e.owner.root.visible || !e.owner.rider.group.visible) continue;
        const pv = e.owner.rider.pov; if (pv && (pv === 'chest' ? e.mesh.userData.chestHide : e.mesh.userData.povHide)) continue;   // cockpit cam: gloves only; chest cam: arms and legs stay in shot
        const im = this.im(e.key); if (!im.parent) scene.add(im);
        if (im.count >= im.instanceMatrix.count) continue;
        if (e.scale) _bm.multiplyMatrices(e.mesh.matrixWorld, e.scale); else _bm.copy(e.mesh.matrixWorld);
        im.setMatrixAt(im.count, _bm); im.setColorAt(im.count, e.col); im.count++;
      }
      for (const k in this.ims) { this.ims[k].instanceMatrix.needsUpdate = true; this.ims[k].instanceColor.needsUpdate = true; }
    }
  };

  /* merge an asset's parts into one BufferGeometry; colour(name) -> THREE.Color multiplies the baked vertex colours */
  function mergeAsset(name, colour, filter) {
    const md = AX.Assets && AX.Assets.get(name); if (!md) return null;
    const list = md.parts.filter((p) => !filter || filter(p.material.name || ''));
    let n = 0, ni = 0; list.forEach((p) => { n += p.geometry.attributes.position.count; ni += p.geometry.index.count; });
    if (!n) return null;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), I = new Uint32Array(ni); let o = 0, oi = 0;
    for (const p of list) {
      const g = p.geometry, c = g.attributes.position.count, cc = colour ? colour(p.material.name || '') : null, gc = g.attributes.color;
      P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3);
      for (let k = 0; k < c; k++) { const a = gc ? [gc.getX(k), gc.getY(k), gc.getZ(k)] : [1, 1, 1]; C[(o + k) * 3] = a[0] * (cc ? cc.r : 1); C[(o + k) * 3 + 1] = a[1] * (cc ? cc.g : 1); C[(o + k) * 3 + 2] = a[2] * (cc ? cc.b : 1); }
      const ix = g.index.array; for (let k = 0; k < ix.length; k++) I[oi + k] = ix[k] + o; o += c; oi += ix.length;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere(); return geo;
  }

  function buildRider(spec, rider, mats, numTex, bars) {
    const g = new THREE.Group(); const naked = spec.style.fairing === 'naked', fit = SPRUNG[spec.style.model] ? SPRUNG[spec.style.model].fit || null : null;
    const suit = lin(rider.suit), dark = lin(0x16171a), accent = lin(rider.c2), helmetC = lin(rider.helmet);
    // torso (built along +Y, hips at origin)
    const tb = new GeoBuilder(); const L = 0.5;
    const tors = loft([{ x: -0.04, y: 0, w: 0.10, ht: 0.07 }, { x: 0.0, y: 0, w: 0.165, ht: 0.105, e: 2.4 }, { x: 0.16, y: 0.005, w: 0.15, ht: 0.10, e: 2.4 },
      { x: 0.33, y: 0.01, w: 0.185, ht: 0.11, e: 2.6 }, { x: 0.45, y: 0.012, w: 0.19, ht: 0.10, e: 2.6 }, { x: 0.52, y: 0.01, w: 0.12, ht: 0.07 }, { x: 0.55, y: 0.01, w: 0.05, ht: 0.03 }], 18);
    tors.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));   // +X -> +Y, section "up" (+y) -> -X (rider's back faces -X... fixed below)
    tb.add(tors, null, suit);
    // aero hump on the back (back = local -X after the torso is pitched forward)
    tb.add(loft([{ x: 0.2, y: 0, w: 0.03, ht: 0.02 }, { x: 0.3, y: 0, w: 0.085, ht: 0.06, e: 2.2 }, { x: 0.44, y: 0, w: 0.075, ht: 0.07, e: 2.2 }, { x: 0.53, y: 0, w: 0.03, ht: 0.03 }], 12), M(-0.085, 0, 0, 0, 0, Math.PI / 2), accent);
    tb.add(roundedBox(0.03, 0.2, 0.3, 0.012, 2), M(-0.06, 0.02, 0), dark);
    const RM = AX.Assets && AX.Assets.has('rider/torso');      // Blender-made rider parts
    const pick = (n) => /accent/.test(n) ? accent : /dark/.test(n) ? dark : /shell/.test(n) ? helmetC : suit;
    const torso = new THREE.Mesh(RM ? mergeAsset('rider/torso', pick) : tb.build(), mats.suit); g.add(torso);
    // lettering across the back, laid onto the leathers
    const backWord = new THREE.Mesh(conformStrip(torso, V3(-0.118, 0.275, 0), V3(0, 0, 1), V3(0, 1, 0), 0.27, 0.27 / 4, 16, 0.0022),
      new THREE.MeshStandardMaterial({ map: wordTexture('#f3f3f0'), transparent: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    backWord.castShadow = false; torso.add(backWord);
    // helmet
    const hb = new GeoBuilder();
    hb.add(new THREE.SphereGeometry(0.162, 26, 20), M(0, 0, 0, 0, 0, 0, 1.12, 0.98, 0.94), helmetC);
    hb.add(loft([{ x: -0.2, y: 0.03, w: 0.02, ht: 0.01 }, { x: -0.12, y: 0.05, w: 0.07, ht: 0.03 }, { x: 0.0, y: 0.06, w: 0.08, ht: 0.03 }], 10), null, accent);  // spoiler
    hb.add(roundedBox(0.1, 0.07, 0.2, 0.03, 3), M(0.1, -0.075, 0), dark);  // chin bar
    const helmet = new THREE.Group();
    if (RM) {
      helmet.add(new THREE.Mesh(mergeAsset('rider/helmet', pick, (n) => !/visor/.test(n)), mats.gloss));
      helmet.add(new THREE.Mesh(mergeAsset('rider/helmet', null, (n) => /visor/.test(n)), mats.visor));
    } else {
      helmet.add(new THREE.Mesh(hb.build(), mats.gloss));
      const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1645, 22, 12, -0.95, 1.9, 1.12, 0.6), mats.visor); visor.rotation.y = Math.PI; visor.scale.set(1.12, 0.98, 0.94); helmet.add(visor);
    }
    g.add(helmet);
    // limbs: tapered cylinders (unit length along +Y) + joint spheres
    // limbs + joints are drawn through AX.RiderBatch (a few InstancedMeshes shared by every rider); these meshes only carry the pose
    const LIMB = { '0.074:0.062': 'uparm', '0.062:0.05': 'foarm', '0.104:0.08': 'thigh', '0.078:0.06': 'shin' };
    const limb = (r0, r1, col) => {
      const lm = RM && LIMB[r0 + ':' + r1], key = lm ? 'rider:' + lm : 'cyl:' + r0 + ':' + r1;
      const m = new THREE.Mesh(RB.geo(key, () => lm ? mergeAsset('rider/' + lm, null, (n) => !/dark|accent/.test(n)) : cylGeo(r0, r1)), mats.suit); m.userData.rb = { key, col }; g.add(m);
      // panels in the suit's second colour (shoulders, knees, cuffs): their own instances too
      if (lm && AX.Assets.get('rider/' + lm).parts.some((q) => /accent/.test(q.material.name || ''))) { const ak = 'rider:' + lm + ':accent', c = new THREE.Mesh(RB.geo(ak, () => mergeAsset('rider/' + lm, null, (n) => /accent/.test(n))), mats.suit); c.userData.rb = { key: ak, col: accent }; m.add(c); }
      // boots and gloves: their own instances (always dark), riding along as children of the limb
      if (lm && (lm === 'shin' || lm === 'foarm')) { const dk = 'rider:' + lm + ':dark', c = new THREE.Mesh(RB.geo(dk, () => mergeAsset('rider/' + lm, null, (n) => /dark/.test(n))), mats.suit); c.userData.rb = { key: dk, col: lm === 'shin' ? 0x1b1c20 : 0x222327 }; m.add(c); }
      return m; };
    // gloves and boots: modelled, sitting in bike axes on the hand / ankle point
    // main part in `col`; protectors ride along as children: panels in the rider's second colour (knuckles, heel cup), hard sliders in grey (sole, knee puck)
    const SLIDER = 0x3d3f45;
    const part = (name, col, fb) => {
      if (!(RM && AX.Assets.has('rider/' + name))) return fb();
      const names = AX.Assets.get('rider/' + name).parts.map((q) => q.material.name || ''), has = (re) => names.some((n) => re.test(n)), plain = (n) => !/accent|slider/.test(n);
      const key = 'rider:' + name, m = has({ test: plain }) ? new THREE.Mesh(RB.geo(key, () => mergeAsset('rider/' + name, null, plain)), mats.suit) : new THREE.Group(); if (m.isMesh) m.userData.rb = { key, col }; g.add(m);
      for (const [re, tag, c2] of [[/accent/, ':accent', accent], [/slider/, ':slider', SLIDER]]) if (has(re)) { const c = new THREE.Mesh(RB.geo(key + tag, () => mergeAsset('rider/' + name, null, (n) => re.test(n))), mats.suit); c.userData.rb = { key: key + tag, col: c2 }; m.add(c); }
      return m; };
    const ball = (r, col, sx, sy, sz) => { const m = new THREE.Mesh(RB.geo('sph', sphGeo), mats.suit); m.userData.rb = { key: 'sph', col, scale: new THREE.Matrix4().makeScale(r * (sx || 1), r * (sy || 1), r * (sz || 1)) }; g.add(m); return m; };
    const parts = { arms: [], legs: [] }, HANDS = RM && AX.Assets.has('rider/gloveR') && AX.Assets.has('rider/fingersR') && AX.Assets.has('rider/tipsR');
    for (let s = 0; s < 2; s++) {
      // hands: a glove closed round the grip (right and left are mirror images); index and middle finger are a piece of their own, hinged on the knuckle line
      const hn = s ? 'R' : 'L', hand = part('glove' + hn, 0x1b1c20, () => part('glove', 0x1b1c20, () => ball(0.06, dark, 1.3, 0.85, 1)));
      const fingers = HANDS ? part('fingers' + hn, 0x1b1c20, () => null) : null, tips = HANDS ? part('tips' + hn, 0x1b1c20, () => null) : null;
      if (fingers) { hand.add(fingers); fingers.position.set(HAND.kn[0], HAND.kn[1], 0); fingers.add(tips); tips.position.set(HAND.l1, 0, 0); }
      parts.arms.push({ up: limb(0.074, 0.062, suit), lo: limb(0.062, 0.05, suit), sh: ball(HANDS ? 0.070 : RM ? 0.074 : 0.084, accent), el: ball(HANDS ? 0.052 : RM ? 0.058 : 0.064, suit), hand, fingers, tips });
      parts.legs.push({ up: limb(0.104, 0.08, suit), lo: limb(0.078, 0.06, suit), hip: ball(0.104, suit), kn: ball(RM ? 0.076 : 0.084, accent), puck: part('kneepuck', SLIDER, () => null), foot: part('boot', 0x1b1c20, () => ball(0.064, dark, 2.0, 0.85, 1)) });
    }
    // in the helmet cam the forearms and gloves stay visible
    const hideIn = (o) => { o.userData.povHide = true; o.children.forEach(hideIn); };
    for (const L of parts.legs) (fit && fit.pov ? [L.hip] : [L.up, L.lo, L.hip, L.kn, L.foot, L.puck]).forEach((o) => o && hideIn(o));   // (a camera set back sees the legs: the boot coming off the peg is part of the picture)
    for (const A of parts.arms) [A.up, A.sh].forEach(hideIn);   // the forearms stay in view, whole, from the elbow to the glove; upper arms and shoulders sit beside the camera
    for (const A of parts.arms) A.sh.userData.chestHide = true; for (const L of parts.legs) L.hip.userData.chestHide = true;   // right beside / behind the chest cam
    const hideChest = (o) => { o.userData.chestHide = true; o.children.forEach(hideChest); };
    if (fit && fit.chestLegs === false) { for (const L of parts.legs) [L.up, L.kn, L.puck].forEach((o) => o && hideChest(o)); for (const A of parts.arms) hideChest(A.up); }   // sport bike: knees and upper arms are right beside the camera - the forearms and gloves stay in shot
    const rig = {
      group: g, torso, helmet, parts, naked, bars, fit, hands: HANDS, roll: [0, 0], pull: [0, 0], twist: 0, lever: [0.051, -0.016], leverTo: null, pov: false,
      hang: 0, tuck: 0, sit: 0, kneeOut: 0, headYaw: 0, kneeDown: [false, false], elbowDown: [false, false], footDown: [false, false], dangle: 0,
      J: { H: V3(), S: V3(), head: V3(), a: V3(), b: V3(), c: V3(), pole: V3() }
    };
    poseRider(rig, { lean: 0, tuck: 0, sit: 0, steer: 0 }, 1);
    return rig;
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m4 = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  /* keep a joint above the asphalt once the bike is leaned: y·cosφ − z·sinφ ≥ margin (knee slider just touches) */
  function clearGround(p, phi, margin, reach) {
    if (Math.abs(phi) < 0.05) return false; const c = Math.cos(phi), s = Math.sin(phi);
    const h = p.y * c - p.z * s;
    // reach: the rider puts the knee (or elbow) down, so pull the joint out until it just touches
    if (reach && h > margin) { const z = (p.y * c - margin) / s; if (Math.abs(z) <= reach) { p.z = z; return true; } return false; }
    if (h >= margin + 0.012) return false;
    if (h < margin) p.z = (p.y * c - margin) / s;
    return true;                          // the slider / elbow is on the asphalt
  }
  // the knee slider sits on the outside of the knee: +x the way the kneecap points (away from the bend), y along the leg, z out
  const _kf = new THREE.Vector3(), _ku = new THREE.Vector3(), _ko = new THREE.Vector3(), _km = new THREE.Matrix4();
  function setKnee(Lg, hip, knee, foot, sg) {
    if (!Lg.puck) return;
    _kf.subVectors(hip, knee).normalize(); _ko.subVectors(foot, knee).normalize(); _ku.subVectors(_kf, _ko).normalize();      // towards the hip
    _kf.add(_ko).negate(); if (_kf.lengthSq() < 1e-6) _kf.set(1, 0, 0); _kf.normalize();
    if (sg < 0) _ku.negate();                                              // left leg: the same puck turned over, so its outside is the rider's left
    _ko.crossVectors(_kf, _ku).normalize(); _kf.crossVectors(_ku, _ko).normalize();
    _km.makeBasis(_kf, _ku, _ko); Lg.puck.quaternion.setFromRotationMatrix(_km); Lg.puck.position.copy(knee);
  }
  function setLimb(mesh, a, b) {
    _d.subVectors(b, a); const len = _d.length() || 1e-4; mesh.position.copy(a); mesh.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len)); mesh.scale.set(1, len, 1);
  }
  function ik(a, b, l1, l2, pole, out) {
    _d.subVectors(b, a); let dist = _d.length(); const dn = _d.multiplyScalar(1 / (dist || 1));
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.005);
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    _c.copy(pole).addScaledVector(dn, -pole.dot(dn)); if (_c.lengthSq() < 1e-8) _c.set(0, 1, 0); _c.normalize();
    return out.copy(a).addScaledVector(dn, x).addScaledVector(_c, h);
  }
  /* st: {lean [-1..1 normalised hang-off], tuck 0..1, sit 0..1 (upright under braking), steer} ; k = smoothing blend 0..1 */
  /* the modelled hand (tools/blender_rider.py): where its knuckle line and its wrist lie relative to the grip's axis, the angle at which the wrist leaves it,
     the two joints of the lever fingers (l1, and l2 / ca: how far and in which direction the crook of the finger lies from the middle joint), how far a
     pulled lever comes towards the grip under the fingers, where the crook lies when the fingers are closed round the grip instead, and the length of
     the forearm from elbow to wrist (the hand is a piece of its own now, so the forearm is shorter than the one that used to reach the grip) */
  const HAND = { kn: [0.01537, 0.02459], wrist: [-0.088, 0.043], wa: Math.atan2(0.043, -0.088), l1: 0.045, l2: Math.hypot(0.0072, 0.0274), ca: Math.atan2(-0.0274, 0.0072), travel: 0.022, wrap: [0.0149, -0.0134], fore: 0.215 }, _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _hw = new THREE.Vector3();
  function poseRider(rig, st, k) {
    rig.twist = lerp(rig.twist, st.throttle || 0, Math.min(1, k * 1.6)); rig.pull[1] = lerp(rig.pull[1], st.brake || 0, Math.min(1, k * 2)); rig.pull[0] = lerp(rig.pull[0], st.clutch || 0, Math.min(1, k * 2.4));
    rig.hang = lerp(rig.hang, st.lean, k); rig.tuck = lerp(rig.tuck, st.tuck, k); rig.sit = lerp(rig.sit, st.sit, k); rig.dangle = lerp(rig.dangle || 0, st.dangle || 0, k * 0.6);
    if (rig.dangle * rig.hang < 0 && Math.abs(rig.hang) > 0.15) rig.dangle *= 0.7;      // his weight has gone to the other side: the loose leg is pulled in at once, before it ends up across the bike
    const h = rig.hang, ah = Math.abs(h), tk = rig.tuck, si = rig.sit, J = rig.J, nk = rig.naked, bars = rig.bars, F = rig.fit, mt = !!F && F.style === 'motard';
    // hips slide to the inside, torso follows further, head leads into the corner
    if (mt) J.H.set(F.hip[0] + ah * 0.03, F.hip[1] - ah * 0.01, -h * 0.055);      // supermoto: he slides to the outer edge of the seat instead of hanging off
    else J.H.set(F ? F.hip[0] : -0.3, (F ? F.hip[1] : 0.86) - ah * 0.02, h * 0.17);
    const sx = F ? lerp(F.sh[0], F.sh[2], tk) - si * 0.04 : nk ? lerp(-0.03, 0.07, tk) - si * 0.04 : lerp(0.14, 0.24, tk) - si * 0.1;      // hips to shoulders is 0.52 m, as on a real rider
    const sy = F ? lerp(F.sh[1], F.sh[3], tk) + si * 0.03 : nk ? lerp(1.30, 1.21, tk) + si * 0.03 : lerp(1.15, 1.04, tk) + si * 0.1 - ah * 0.03;
    if (mt) J.S.set(sx + ah * 0.03, sy - ah * 0.015, -h * 0.2); else J.S.set(sx + ah * 0.02, sy - ah * 0.04, h * 0.27);
    // torso basis: Y along spine, Z to rider's right (rolled a little into the corner)
    _y.subVectors(J.S, J.H).normalize(); _z.set(0, mt ? h * 0.1 : -h * 0.25, 1).normalize(); _x.crossVectors(_y, _z).normalize(); _z.crossVectors(_x, _y).normalize();
    _m4.makeBasis(_x, _y, _z); rig.torso.quaternion.setFromRotationMatrix(_m4); rig.torso.position.copy(J.H);
    rig.torso.scale.set(1, J.S.distanceTo(J.H) / 0.52, 1);
    // the helmet sits on the neck: its socket (a point inside the bottom opening, a little behind the middle) is put on the top of the neck,
    // whichever way the head is turned - so the neck always runs up into the helmet and never stands beside it
    rig.helmet.rotation.set(-h * (mt ? 0.28 : 0.45), -h * 0.3, lerp(nk ? -0.13 : -0.2, -0.42, tk) + si * 0.15, 'YXZ');
    J.head.set(-0.022, -0.092, 0).applyQuaternion(rig.helmet.quaternion).negate().add(J.H).addScaledVector(_x, 0.048).addScaledVector(_y, 0.615 * J.S.distanceTo(J.H) / 0.52);
    J.head.z += h * 0.03; rig.helmet.position.copy(J.head);
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? -1 : 1, inside = sg * h > 0 ? Math.abs(h) : 0, outside = sg * h < 0 ? Math.abs(h) : 0;
      // arm
      const A = rig.parts.arms[s];
      _a.copy(J.S).addScaledVector(_z, sg * 0.192).addScaledVector(_y, -0.045);
      if (rig.gripAt) rig.gripAt(_b, sg); else _b.set(bars.barX, bars.barY + 0.02, sg * bars.barZ);      // gripAt: the grips where the turned bars have taken them
      rig.poleTmp = _d; const pole = mt ? J.pole.set(-0.3, -0.18 - inside * 0.25, sg * (1.1 + inside * 0.2))      // supermoto: elbows high and wide
        : nk ? J.pole.set(-0.42, -0.72 - inside * 0.3, sg * (0.82 + tk * 0.1 + inside * 0.3))      // wide bars: elbows out and up, ready to push
        : J.pole.set(-0.5, -1.0 - inside * 0.3 + outside * 1.4, sg * (0.42 + tk * 0.1 + inside * 0.3 + outside * 0.6));      // sport bike: hanging off, the outside arm reaches across the tank - its elbow comes up and out, over the tank instead of through it
      const ph = rig.bikeLean || 0, inLean = ph * sg > 0 ? Math.abs(ph) : 0;
      if (rig.hands) {
        // the hand is closed round the grip: z along the grip's axis, x ahead, y up, rolled about the grip so that its wrist lines up with the forearm
        // (the right hand rolls further with the throttle). The arm reaches for the wrist, not for the grip.
        if (rig.gripFrame) rig.gripFrame(_b, _hz, sg); else _hz.set(0, 0, 1);
        _hx.set(1, 0, 0).addScaledVector(_hz, -_hz.x).normalize(); _hy.crossVectors(_hz, _hx);
        const r = rig.roll[s] + (s === 1 ? rig.twist * 0.42 : 0), cr = Math.cos(r), sr = Math.sin(r);
        _hw.copy(_b).addScaledVector(_hx, HAND.wrist[0] * cr - HAND.wrist[1] * sr).addScaledVector(_hy, HAND.wrist[0] * sr + HAND.wrist[1] * cr);
        ik(_a, _hw, 0.285, HAND.fore, pole, J.c); rig.elbowDown[s] = clearGround(J.c, ph, 0.07, inside > 0.8 && inLean > 1.0 ? 0.62 : 0) && inside > 0.5;
        _d.subVectors(J.c, _hw); const want = clamp(AX.wrapAngle(Math.atan2(_d.dot(_hy), _d.dot(_hx)) - HAND.wa) * 0.7, -0.8, 1.2);      // (the wrist takes up the rest) rig.roll[s] = lerp(rig.roll[s], want, Math.min(1, k * 1.5));
        setLimb(A.up, _a, J.c); setLimb(A.lo, J.c, _hw); A.sh.position.copy(_a); A.el.position.copy(J.c); A.hand.position.copy(_b);
        _x.copy(_hx).multiplyScalar(cr).addScaledVector(_hy, sr); _d.copy(_hy).multiplyScalar(cr).addScaledVector(_hx, -sr); _m4.makeBasis(_x, _d, _hz); A.hand.quaternion.setFromRotationMatrix(_m4);
        if (A.fingers) {
          // index and middle finger lie on the lever: two joints, bent so that the crook of the finger stays on the lever wherever the hand has rolled
          // and however far the lever is pulled (rig.pull: 0..1, the lever comes that much of its way to the grip)
          const L = rig.lever, T = rig.leverTo, pl = rig.pull[s], kx = HAND.kn[0] * cr - HAND.kn[1] * sr, ky = HAND.kn[0] * sr + HAND.kn[1] * cr;
          let lx = T ? L[0] + (T[0] - L[0]) * pl : L[0] - pl * HAND.travel, ly = T ? L[1] + (T[1] - L[1]) * pl : L[1] + pl * 0.004;
          // a hand rolled so far round the grip that the lever is out of reach closes its fingers round the grip like the other two
          const far = smoothstep(0.074, 0.082, Math.hypot(lx - kx, ly - ky)); if (far > 0) { lx += (HAND.wrap[0] * cr - HAND.wrap[1] * sr - lx) * far; ly += (HAND.wrap[0] * sr + HAND.wrap[1] * cr - ly) * far; }
          let dx = lx - kx, dy = ly - ky, dd = Math.hypot(dx, dy); const dc = clamp(dd, 0.024, HAND.l1 + HAND.l2 - 0.002);
          const t1 = Math.atan2(dy, dx) + Math.acos(clamp((HAND.l1 * HAND.l1 + dc * dc - HAND.l2 * HAND.l2) / (2 * HAND.l1 * dc), -1, 1));
          const px = kx + HAND.l1 * Math.cos(t1), py = ky + HAND.l1 * Math.sin(t1), t2 = Math.atan2(ky + dy * dc / dd - py, kx + dx * dc / dd - px) - HAND.ca;
          A.fingers.rotation.z = t1 - r; A.tips.rotation.z = t2 - t1;
        }
        _x.crossVectors(_y, _z).normalize();      // (the torso's forward axis, borrowed above, back for the legs)
      } else {
        ik(_a, _b, 0.285, 0.275, pole, J.c);
        rig.elbowDown[s] = clearGround(J.c, ph, 0.07, inside > 0.8 && inLean > 1.0 ? 0.62 : 0) && inside > 0.5;
        setLimb(A.up, _a, J.c); setLimb(A.lo, J.c, _b); A.sh.position.copy(_a); A.el.position.copy(J.c); A.hand.position.copy(_b);
      }
      // leg
      const Lg = rig.parts.legs[s];
      _a.copy(J.H).addScaledVector(_z, sg * 0.105); _a.y -= 0.03;
      const fx = F ? F.foot[0] : -0.25, fy = F ? F.foot[1] : 0.48, fz = F ? F.foot[2] : 0.18;
      _b.set(fx, fy, sg * fz);
      let dg = sg * rig.dangle > 0 ? Math.abs(rig.dangle) : 0;           // MotoGP leg dangle on the brakes
      const out = mt && st.legs ? st.legs[s] : 0; if (out > dg) dg = out;      // supermoto: the inside boot comes off the peg for the whole corner (syncBike decides when, so it cannot flap)
      rig.footDown[s] = false;
      if (dg > 0.01) {
        // the boot leaves the peg, swings forward and out beside the front of the engine, toe down, hovering just off the
        // tarmac; the knee points out and up. A loose leg flaps a little in the wind and over the bumps.
        const w = Math.min(1, dg), deep = Math.max(0, dg - 1), tt = (rig.dgClock = (rig.dgClock || 0) + 0.016);
        _b.set(lerp(fx, mt ? 0.27 : 0.14, w) + Math.sin(tt * 6.3) * (mt ? 0.008 : 0.03) * w, lerp(fy, (mt ? 0.2 : 0.16) - deep * 0.08, w) + Math.sin(tt * 9.1) * (mt ? 0.004 : 0.012) * w,
          sg * (lerp(fz, mt ? 0.3 : 0.5, w) + deep * 0.06 + Math.sin(tt * 4.7 + s) * 0.025 * w));
        // leaned (or sliding) to that side, the boot reaches the asphalt and drags along it
        rig.footDown[s] = clearGround(_b, ph, 0.03, !mt && w > 0.7 && sg * ph > 0 ? 0.62 : 0) && w > 0.5;      // (only towards its own side: leaned the other way, the road here is out of reach; in the motard style the boot is never reached out)
      }
      J.pole.set(0.9 - dg * 0.5, 0.5 - inside * 0.5 + dg * 0.5, sg * (0.25 + inside * 1.6 + dg * 1.1));
      ik(_a, _b, 0.44, 0.44, J.pole, J.c); rig.kneeDown[s] = clearGround(J.c, ph, Lg.puck ? 0.084 : 0.075, dg < 0.15 && inside > 0.5 && inLean > 0.7 ? 0.7 : 0) && inside > 0.3;      // the slider, not the knee, is what touches
      setLimb(Lg.up, _a, J.c); setLimb(Lg.lo, J.c, _b); setKnee(Lg, _a, J.c, _b, sg); Lg.hip.position.copy(_a); Lg.kn.position.copy(J.c); Lg.foot.position.set(_b.x + 0.03, _b.y - 0.01, _b.z);
      Lg.foot.rotation.set(0, 0, (mt ? 0.1 : -0.75) * Math.min(1, dg));     // toe down when the leg is out (supermoto: the sole skims the road, toe up)
    }
  }
  /* rag-doll-ish pose for a rider sliding after a crash (rider group is detached and laid flat by the caller) */
  function poseCrash(rig, t) {
    const J = rig.J; const w = Math.sin(t * 9) * 0.12;
    J.H.set(-0.3, 0.86, 0); J.S.set(0.17, 0.9, 0);
    _y.subVectors(J.S, J.H).normalize(); _z.set(0, 0, 1); _x.crossVectors(_y, _z).normalize();
    _m4.makeBasis(_x, _y, _z); rig.torso.quaternion.setFromRotationMatrix(_m4); rig.torso.position.copy(J.H); rig.torso.scale.set(1, 1, 1);
    rig.helmet.position.set(0.36, 0.9, 0); rig.helmet.rotation.set(0, 0, -1.2);
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? -1 : 1; const A = rig.parts.arms[s], Lg = rig.parts.legs[s];
      _a.set(0.14, 0.9, sg * 0.2); _b.set(0.3 + w * sg, 0.86, sg * (0.62 + w)); J.pole.set(0.2, 0.3, sg);
      ik(_a, _b, 0.31, 0.3, J.pole, J.c); setLimb(A.up, _a, J.c); setLimb(A.lo, J.c, _b); A.sh.position.copy(_a); A.el.position.copy(J.c); A.hand.position.copy(_b);
      _a.set(-0.3, 0.84, sg * 0.1); _b.set(-1.02, 0.86, sg * (0.34 - w * sg)); J.pole.set(0, 1, sg * 0.3);
      ik(_a, _b, 0.44, 0.44, J.pole, J.c); setLimb(Lg.up, _a, J.c); setLimb(Lg.lo, J.c, _b); setKnee(Lg, _a, J.c, _b, sg); Lg.hip.position.copy(_a); Lg.kn.position.copy(J.c); Lg.foot.position.copy(_b);
    }
  }

  /* ---------------------------------------------------------------- per-frame sync from physics */
  const _mw = new THREE.Matrix4(), _fw = new THREE.Vector3();
  const _pin = new Float32Array(220), _m1 = new THREE.Matrix4();
  function syncBike(vis, p, dt, time) {
    const spec = vis.spec, maxLean = spec.maxLean * Math.PI / 180;
    // each wheel stands on the road where it actually is: height and pitch come from the surface under the two contact patches
    let gy = p.y || 0, gs = Math.atan(p.slope || 0); const trk = p.track;
    if (trk && trk.py && trk.roadY && !p.crashed) {
      const hw = vis.hx * vis.scale, cx = Math.cos(p.yaw) * hw, cz = Math.sin(p.yaw) * hw, yF = trk.roadY(p.x + cx, p.z + cz, p.idx), yR = trk.roadY(p.x - cx, p.z - cz, p.idx);
      gy = (yF + yR) / 2; gs = Math.atan2(yF - yR, 2 * hw);
    }
    vis.root.position.set(p.x, gy + (p.surf === AX.SURF.KERB ? 0.075 : p.surf === AX.SURF.GRAVEL ? 0.012 : 0.02), p.z);   // sit on the surface, not in it
    vis.root.rotation.set(0, -p.yaw, gs, 'YZX');   // yaw, then the road's slope
    // kerb rattle / off-road shake
    const rough = p.surf === AX.SURF.KERB ? 0.022 : (p.surf === AX.SURF.GRASS || p.surf === AX.SURF.GRAVEL) ? 0.03 : 0;
    const sh = rough * clamp(p.speed / 20, 0, 1) * (p.crashed ? 0 : 1);
    vis.shake = damp(vis.shake, sh, 12, dt);
    const jit = vis.shake ? Math.sin(time * 61.3 + p.x) * vis.shake : 0;
    const hangIn = p.crashed ? 0 : Math.max(0, p.hangIn || 0);
    const mfit = vis.rider.fit, lv = mfit && mfit.leanVis ? mfit.leanVis : 9;
    const phi = clamp(p.lean * (1 + (mfit && mfit.style === 'motard' ? 0.06 : -0.13) * hangIn), -lv, lv) + jit * 0.6;     // hanging off lets the bike itself stay more upright; pushed down supermoto-style it leans a little further than its rider - but never so far that the bars reach the road
    vis.leanG.rotation.x = phi;
    let dFront = 0;
    if (vis.tyre) {   // modelled tyres: roll on the real (elliptical) section of the rear tyre, and let the narrower front one down onto the road too
      const T = vis.tyre, c = Math.cos(phi), s = Math.sin(phi), q = Math.sqrt(T.ar * T.ar * c * c + T.br * T.br * s * s), qf = Math.sqrt(T.af * T.af * c * c + T.bf * T.bf * s * s);
      vis.leanG.position.set(0, q - T.ar * c, -((T.br * T.br - T.ar * T.ar) * s * c / q + T.ar * s));
      dFront = ((q - T.ar * c) - (qf - T.af * c)) / Math.max(c, 0.45);
    } else vis.leanG.position.set(0, vis.rT * (1 - Math.cos(phi)), -vis.rT * Math.sin(phi));   // roll on the tyre's round profile
    if (vis.wear && !p.crashed && p.speed > 0.5) {
      const T = vis.tyre, c = Math.cos(phi), s = Math.sin(phi), ds = p.speed * dt, blur = smoothstep(3, 14, p.speed);
      tyreWork(vis.wear[1], T.br * s / Math.sqrt(T.ar * T.ar * c * c + T.br * T.br * s * s), ds, Math.max(clamp(Math.abs(p.slipAngle || 0) * 4.5 - 0.22, 0, 1), clamp((p.spin || 0) * 1.3 - 0.1, 0, 1)));
      tyreWork(vis.wear[0], T.bf * s / Math.sqrt(T.af * T.af * c * c + T.bf * T.bf * s * s), ds, p.fx ? clamp((p.fx.frontSkid || 0) * 1.4, 0, 1) : 0);
      vis.wear[0].u.uTy.value.z = vis.wear[1].u.uTy.value.z = blur;      // a spinning tyre shows the band, not the single grains
    }
    vis.rider.bikeLean = phi;
    vis.shadow.position.z = Math.sin(phi) * 0.3; vis.shadow.scale.y = 1 + Math.abs(Math.sin(phi)) * 0.6; vis.shadow.visible = !p.crashed;
    // pitch about the wheel that stays on the ground
    const hx = vis.hx;
    if (p.pitch >= 0) { vis.pitchG.position.set(-hx, 0, 0); vis.bodyG.position.set(hx, 0, 0); }
    else { vis.pitchG.position.set(hx, 0, 0); vis.bodyG.position.set(-hx, 0, 0); }
    const S = vis.susp;
    vis.pitchG.rotation.z = p.pitch - (S && p.pitch >= 0 ? dFront / (2 * hx) : 0);   // the narrower front tyre lets the nose down a touch when leaned over
    // sprung body: dive under braking, squat under power
    const target = p.crashed ? 0 : S ? clamp(-p.aLong * 0.0054 * S.k, -0.05 * S.k, 0.076 * S.k) : clamp(-p.aLong * 0.0042, -0.05, 0.055);
    vis.diveV += ((target - vis.dive) * 190 - vis.diveV * 17) * dt; vis.dive += vis.diveV * dt;
    const sa = -vis.dive + jit * 0.5, sy = -Math.abs(vis.dive) * 0.25 + Math.abs(jit) * 0.4;
    vis.susG.rotation.z = sa; vis.susG.position.y = sy;
    const roll = p.speed * dt / (vis.Rr * vis.scale), rollR = roll * (1 + p.spin * 0.45);
    if (S) {
      // rear: the wheel stays on the road where the physics has it; the swingarm turns about its pivot to reach the axle, and the body takes up what is left
      const ca = Math.cos(sa), sn = Math.sin(sa), px = S.PIV.x * ca - S.PIV.y * sn, py = S.PIV.x * sn + S.PIV.y * ca;
      const sp = clamp((vis.Rr - sy - py) / S.L, -0.5, 0.3), psi = Math.atan2(sp, -Math.sqrt(1 - sp * sp)), th = AX.wrapAngle(psi - sa - S.psi0);
      vis.susG.position.x = -hx - px - S.L * Math.cos(psi); S.swingG.rotation.z = th; S.th = th;
      // shock: top eye on the frame, bottom eye on the swingarm; the spring is squeezed between its two collars
      const ct = Math.cos(th), st2 = Math.sin(th); let s1x = S.PIV.x + S.s1r.x * ct - S.s1r.y * st2, s1y = S.PIV.y + S.s1r.x * st2 + S.s1r.y * ct;
      if (S.lk) {
        // the linkage: the swingarm carries the dog bones' rear eye round its pivot; the rocker's eye is where the dog bones (length b) and the
        // rocker's arm (length a, about its pivot on the frame) meet; the rocker's turn carries the shock's lower eye with it
        const K = S.lk, tq = clamp(th, -0.24, 0.11), c2 = Math.cos(tq), s2 = Math.sin(tq), rx = S.PIV.x + K.r0.x * c2 - K.r0.y * s2, ry = S.PIV.y + K.r0.x * s2 + K.r0.y * c2;
        const dx = rx - K.F0.x, dy = ry - K.F0.y, d = Math.hypot(dx, dy), x = (K.a * K.a - K.b * K.b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, K.a * K.a - x * x));
        const qx = K.F0.x + dx / d * x - dy / d * h * K.sg, qy = K.F0.y + dy / d * x + dx / d * h * K.sg, dl = AX.wrapAngle(Math.atan2(qy - K.F0.y, qx - K.F0.x) - K.a0), cd = Math.cos(dl), sd = Math.sin(dl);
        K.linkG.rotation.z = dl; K.rodG.position.set(rx, ry, 0); K.rodG.rotation.z = AX.wrapAngle(Math.atan2(qy - ry, qx - rx) - K.b0);
        s1x = K.F0.x + K.s1.x * cd - K.s1.y * sd; s1y = K.F0.y + K.s1.x * sd + K.s1.y * cd;
      } else if (S.link) {   // a linkage whose parts are not there: the lower eye is pushed up the shock's own line by its share of the wheel's travel
        const c = clamp(-th * S.L * S.link, -0.03, 0.065), ux = S.S0.x - s1x, uy = S.S0.y - s1y, ul = Math.hypot(ux, uy); s1x += ux / ul * c; s1y += uy / ul * c; }
      const vx = s1x - S.S0.x, vy = s1y - S.S0.y, ls = Math.hypot(vx, vy), ph = Math.atan2(vy, vx);
      S.shU.rotation.z = ph; S.shL.rotation.z = ph; S.shL.position.set(s1x, s1y, 0);
      const ks = (ls - 0.3 * S.sl) / (0.7 * S.sl); for (const m of S.spring) { m.scale.x = ks; m.position.x = 0.15 * S.sl * (1 - ks); }
      // chain: round the rear sprocket, along the top run to the gearbox sprocket, round it and back along the bottom
      const r1 = S.r1, r2 = S.r2, c2x = S.PIV.x + S.L * Math.cos(psi - sa), c2y = S.PIV.y + S.L * Math.sin(psi - sa), dx = S.SPR.x - c2x, dy = S.SPR.y - c2y, Dc = Math.hypot(dx, dy), cph = Math.atan2(dy, dx), al = Math.acos((r2 - r1) / Dc);
      const Lr = r2 * (2 * Math.PI - 2 * al), Lf = r1 * 2 * al, Ls = Math.sqrt(Dc * Dc - (r2 - r1) * (r2 - r1)), Lt = Lr + Lf + 2 * Ls, pt = Lt / S.NL, adv = rollR * r2 / (2 * pt);
      S.ph = ((S.ph - (Math.abs(adv) > 0.37 ? Math.sign(adv) * 0.37 : adv)) % 1 + 1) % 1;      // faster than the eye (and the frame rate) can follow: keep it running forwards instead of flickering
      const a0x = c2x + r2 * Math.cos(cph - al), a0y = c2y + r2 * Math.sin(cph - al), b0x = S.SPR.x + r1 * Math.cos(cph - al), b0y = S.SPR.y + r1 * Math.sin(cph - al);
      const a1x = c2x + r2 * Math.cos(cph + al), a1y = c2y + r2 * Math.sin(cph + al), b1x = S.SPR.x + r1 * Math.cos(cph + al), b1y = S.SPR.y + r1 * Math.sin(cph + al);
      const pin = (k, o) => {
        let q = (S.ph * 2 + k) * pt % Lt;
        if (q < Lr) { const an = cph + al + q / r2; _pin[o] = c2x + r2 * Math.cos(an); _pin[o + 1] = c2y + r2 * Math.sin(an); return; } q -= Lr;
        if (q < Ls) { const f = q / Ls; _pin[o] = a0x + (b0x - a0x) * f; _pin[o + 1] = a0y + (b0y - a0y) * f; return; } q -= Ls;
        if (q < Lf) { const an = cph - al + q / r1; _pin[o] = S.SPR.x + r1 * Math.cos(an); _pin[o + 1] = S.SPR.y + r1 * Math.sin(an); return; } q -= Lf;
        const f = q / Ls; _pin[o] = b1x + (a1x - b1x) * f; _pin[o + 1] = b1y + (a1y - b1y) * f;
      };
      for (let k = 0; k <= S.NL; k++) pin(k, k * 2);
      for (let k = 0; k < S.NL; k++) {
        const ax = _pin[k * 2], ay = _pin[k * 2 + 1], ex = _pin[k * 2 + 2] - ax, ey = _pin[k * 2 + 3] - ay, el = Math.hypot(ex, ey) || 1, sc2 = el / S.pitch, e = S.chain[k & 1].instanceMatrix.array, o = (k >> 1) * 16;
        e[o] = ex / el * sc2; e[o + 1] = ey / el * sc2; e[o + 2] = 0; e[o + 3] = 0; e[o + 4] = -ey / el; e[o + 5] = ex / el; e[o + 6] = 0; e[o + 7] = 0; e[o + 8] = 0; e[o + 9] = 0; e[o + 10] = 1; e[o + 11] = 0; e[o + 12] = ax; e[o + 13] = ay; e[o + 14] = S.cz; e[o + 15] = 1;
      }
      S.chain[0].instanceMatrix.needsUpdate = true; S.chain[1].instanceMatrix.needsUpdate = true;
    }
    vis.wheelR.rotation.z -= rollR; vis.wheelF.rotation.z -= p.pitch > 0.06 ? roll * 0.6 : roll;
    // steering: counter-steers into a slide, turns in at walking pace
    const pvw = vis.rider.pov ? 0.6 : 1.1, pvm = Math.min(vis.rider.pov ? 0.32 : 0.55, vis.steerMax || 9);   // seen from the saddle, the bars need far less opposite lock to read as a slide
    const st = p.crashed ? 0.5 * (p.crashSide || 1) : clamp(-p.slipAngle * pvw + p.steer * lerp(0.42, 0.03, smoothstep(2, 14, p.speed)), -pvm, pvm);
    vis.steerVis = damp(vis.steerVis, st, 16, dt); vis.steerG.rotation.y = -vis.steerVis + (p.headShake ? Math.sin(time * 38) * 0.14 * p.headShake : 0);   // tank-slapper after a fast landing
    // front wheel
    vis.root.updateMatrixWorld(true);
    if (S) {
      // the lowers slide along the fork until the tyre stands on the road; with the wheel in the air the fork tops out
      _m1.copy(vis.bodyG.matrixWorld).invert().multiply(vis.steerG.matrixWorld); const e = _m1.elements, a0 = S.axle0;
      S.top = damp(S.top, p.pitch > 0.015 && !p.crashed ? 1 : 0, 10, dt);
      const d = clamp((vis.Rf - (e[1] * a0.x + e[5] * a0.y + e[9] * a0.z + e[13])) / e[5] - 0.034 * S.top, -0.04 * S.k, S.dmax);
      if (Math.abs(d - S.d) > 2e-4) {
        S.d = d; S.forkG.position.y = d;
        for (const h of S.hoses) { const P = h.userData.pts, C = h.userData.cur; C[3].copy(P[3]); C[3].y += d * 0.55; C[4].copy(P[4]); C[4].y += d; hoseUpdate(h, C, 0.0045); }
      }
    } else { _fw.set(hx, vis.Rf - dFront, 0).applyMatrix4(vis.bodyG.matrixWorld); vis.wfHolder.parent.worldToLocal(_fw); vis.wfHolder.position.copy(_fw); }   // unsprung: keep the axle where the body says it is
    // brake light
    const br = (p.brake + (p.rearBrake || 0)) > 0.08 && !p.crashed;
    const bl = br ? (p.brake > 0.8 && p.speed > 12 && Math.sin(time * 37.7) < 0 ? 0.3 : 1) : 0;      // hard on the brakes: it flashes, six times a second
    vis.brakeMat.color.setRGB(br ? 0.5 + 2.7 * bl : 0.3, br ? 0.04 + 0.18 * bl : 0.03, br ? 0.02 + 0.1 * bl : 0.02);
    if (vis.flame) {
      const F = vis.flame; F.I *= Math.exp(-15 * dt); const on = F.I > 0.03 && !p.crashed; for (const m of F.meshes) m.visible = on;
      if (on) { const u = F.mat.uniforms; u.uI.value = Math.min(1, F.I * 1.4); u.uLen.value = F.len * (0.45 + 0.55 * Math.min(1, F.I * 1.6)); u.uT.value = time; }
    }
    if (vis.heat && p.spec) {
      const H = vis.heat, sp = p.speed || 0, bk = p.crashed ? 0 : p.brake || 0, rb = p.crashed ? 0 : p.rearBrake || 0, air = 0.07 + sp * 0.004, work = clamp(sp / 40, 0, 1.2);
      H.tf = clamp(H.tf + (bk * work * 0.34 - H.tf * air) * dt, 0, 1.25); H.tr = clamp(H.tr + ((rb + bk * 0.25) * work * 0.2 - H.tr * air) * dt, 0, 1.25);
      const gf = smoothstep(0.42, 1.1, H.tf), gr = smoothstep(0.42, 1.1, H.tr);
      H.mF.opacity = Math.sqrt(gf) * 0.9; H.mF.color.setRGB(0.55 + 0.45 * gf, 0.02 + 0.15 * gf * gf, 0.004); H.mR.opacity = Math.sqrt(gr) * 0.9; H.mR.color.setRGB(0.55 + 0.45 * gr, 0.02 + 0.15 * gr * gr, 0.004);   // deep red first, a full orange when really hot - never washed out to white
      // exhaust: warms with revs and load, cools slowly; a pop on the overrun lights it up for an instant
      const load = clamp((p.rpm - p.spec.idle) / (p.spec.redline - p.spec.idle), 0, 1) * (0.35 + 0.65 * (p.throttle || 0));
      H.te += (load - H.te) * (load > H.te ? 0.45 : 0.1) * dt; if (p.fx && p.fx.backfire > 0) H.flash = Math.max(H.flash, 0.5 * p.fx.backfire); H.flash *= Math.exp(-9 * dt);
      const ge = p.crashed ? 0 : 0.05 + 0.4 * H.te * H.te + H.flash;
      H.mE.color.setRGB(ge * 1.1, ge * 0.14, ge * 0.015);
    }
    // rider
    const rg = vis.rider.group;
    if (!p.crashed) {
      if (vis.crashedVis) { vis.crashedVis = false; vis.susG.add(rg); rg.position.set(0, 0, 0); rg.rotation.set(0, 0, 0); rg.scale.setScalar(1); vis.rider.hang = 0; }
      const hang = p.hang != null ? p.hang : clamp(p.lean / maxLean, -1, 1) * smoothstep(4, 14, p.speed);
      const fwd = p.fb || 0;
      const tuck = clamp(Math.max(0, fwd) * (1 - Math.abs(hang) * 0.5) + smoothstep(40, 60, p.speed) * 0.25 * (1 - Math.abs(hang)), 0, 1);
      const sit = clamp(Math.max(0, -fwd) * 1.0 + p.brake * 0.3 * smoothstep(6, 20, p.speed), 0, 1) - clamp(p.pitch * 1.2, 0, 0.5);
      // hard on the brakes at speed, turning in (or about to): sometimes the inside leg comes off the peg - more likely and
      // further out the harder the stop and when the rear steps out; it folds back in as the bike goes deep into the lean
      const dSide = Math.abs(p.steer) > 0.08 ? Math.sign(p.steer) : Math.abs(p.lean) > 0.05 ? Math.sign(p.lean) : (Math.abs(hang) > 0.2 ? Math.sign(hang) : 0);   // always the inside leg
      const decel = clamp(-(p.aLong || 0) / 9, 0, 1), slideA = smoothstep(0.06, 0.3, Math.abs(p.slipAngle || 0));
      if (p.brake > 0.45 && p.speed > 15 && !vis.dgRolled) { vis.dgRolled = true; vis.dgOn = Math.random() < 0.25 + 0.45 * decel + 0.4 * slideA; vis.dgAmt = 0.7 + 0.4 * decel * Math.random(); }
      if (!vis.dgOn && slideA > 0.6 && p.brake > 0.3 && p.speed > 9) { vis.dgOn = true; vis.dgAmt = 0.9; }      // backing it in: leg out
      if (p.brake < 0.25 && (p.rearBrake || 0) < 0.25) { vis.dgRolled = false; vis.dgOn = false; }
      // flicked over to the other side while the leg is out: it comes back to the peg (it would otherwise be left hanging across the bike)
      if (vis.dgOn && vis.dgSide && ((Math.abs(p.lean) > 0.1 && Math.sign(p.lean) !== vis.dgSide) || (Math.abs(hang) > 0.18 && Math.sign(hang) !== vis.dgSide))) vis.dgOn = false;
      if (vis.dgOn && !vis.dgSide && dSide) vis.dgSide = dSide; if (!vis.dgOn) vis.dgSide = 0;
      const dangle = vis.dgOn ? (vis.dgSide || dSide) * vis.dgAmt * (1 + 0.35 * slideA) * smoothstep(7, 14, p.speed) * (1 - smoothstep(0.5, 0.8, Math.abs(p.lean))) : 0;
      let legs = null;
      if (mfit && mfit.style === 'motard') {
        // supermoto: the inside leg goes out as the bike is laid into a corner and stays out until it is nearly upright again -
        // one decision per corner (with a wide gap between "out" and "back"), eased in and out, so it never flaps with the steering
        const L = vis.leg || (vis.leg = [0, 0, 0]), al = Math.abs(p.lean), sd = Math.sign(p.lean);
        if (!L[2] && al > 0.22 && p.speed > 5) L[2] = sd; else if (L[2] && (al < 0.07 || sd !== L[2] || p.speed < 3)) L[2] = 0;
        L[0] = damp(L[0], L[2] < 0 ? 1 : 0, L[2] < 0 ? 5 : 3.5, dt); L[1] = damp(L[1], L[2] > 0 ? 1 : 0, L[2] > 0 ? 5 : 3.5, dt); legs = L;
      }
      // the clutch hand: a quick pull at every gear change (a full one going down the box, a dab going up), and the lever held in while the bike stands
      if (vis.gearSeen !== undefined && p.gear !== undefined && p.gear !== vis.gearSeen) { vis.clT = 0.2; vis.clA = p.gear < vis.gearSeen ? 1 : 0.55; } vis.gearSeen = p.gear;
      if (vis.clT > 0) vis.clT -= dt; const clutch = Math.max(vis.clT > 0 ? vis.clA * Math.sin(Math.PI * clamp(1 - vis.clT / 0.2, 0, 1)) : 0, 1 - smoothstep(0.4, 3.5, Math.abs(p.speed || 0)));
      poseRider(vis.rider, { lean: hang, tuck, sit, steer: p.steer, dangle, legs, throttle: p.throttle || 0, brake: p.brake || 0, clutch }, 1 - Math.exp(-9 * dt));
      if (vis.handLevers) for (const h of vis.handLevers) h.g.quaternion.setFromAxisAngle(h.ax, h.sgn * h.max * vis.rider.pull[h.s]);      // the levers go with the fingers
    } else {
      if (!vis.crashedVis) { vis.crashedVis = true; vis.root.parent.add(rg); rg.scale.setScalar(vis.scale); }
      poseCrash(vis.rider, p.crashT);
      rg.position.set(p.rd.x, 0.16 + p.rd.h, p.rd.z);
      rg.rotation.set(0, 0, 0); rg.rotateY(-p.yaw + p.rd.rot); rg.rotateZ(-Math.PI / 2 * 0.0); rg.rotateX(Math.PI / 2 * (p.crashSide || 1) * 0.0);
      // lay on the back: rotate so the torso axis is horizontal (it already is nearly along +X in the crash pose)
      rg.position.y = (p.rd.y != null ? p.rd.y : (p.y || 0)) + p.rd.h + 0.16 - 0.86 * vis.scale + 0.3;
    }
  }

  function disposeBike(vis) {
    RB.remove(vis);
    const rg = vis.rider.group; if (rg.parent) rg.parent.remove(rg);
    if (vis.root.parent) vis.root.parent.remove(vis.root);
    const kill = (o) => { if (o.isMesh && !o.userData.rb) { o.geometry.dispose(); } };
    vis.root.traverse(kill); rg.traverse(kill); vis.paint.dispose();
  }
  /* translucent ghost copy used in time trial */
  function ghostify(vis, color) {
    const m = new THREE.MeshBasicMaterial({ color: color || 0x66ccff, transparent: true, opacity: 0.32, depthWrite: false });
    const f = (o) => { if (o.isMesh) { o.material = m; o.castShadow = false; } };
    if (vis.heat) { const H = vis.heat, kill = []; vis.root.traverse((o) => { if (o.isMesh && (o.material === H.mF || o.material === H.mR || o.material === H.mE)) kill.push(o); }); for (const o of kill) o.parent.remove(o); vis.heat = null; }   // a ghost has no engine to glow
    vis.wear = null; if (vis.flame) { for (const m of vis.flame.meshes) if (m.parent) m.parent.remove(m); vis.flame = null; }
    vis.root.traverse(f); vis.rider.group.traverse(f); vis.brakeMat = new THREE.MeshBasicMaterial(); return vis;
  }

  AX.Models = { buildBike, syncBike, disposeBike, ghostify, GeoBuilder, loft, roundedBox, capsule, tubeBetween, arcShell, M, lin, numberTexture };
})(typeof globalThis !== 'undefined' ? globalThis : window);
