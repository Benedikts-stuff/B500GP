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
    SHARED.gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1, envMap: env, envMapIntensity: 0.9 });
    SHARED.suit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, envMap: env, envMapIntensity: 0.3 });
    SHARED.screen = new THREE.MeshStandardMaterial({ color: lin(0x10151c), roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.62, envMap: env, envMapIntensity: 1.4, side: THREE.DoubleSide });
    SHARED.visor = new THREE.MeshStandardMaterial({ color: lin(0x0b0d12), roughness: 0.06, metalness: 0.7, envMap: env, envMapIntensity: 1.6 });
    return SHARED;
  }
  const numTexCache = {};
  function numberTexture(num, bg, fg) {
    const key = num + bg + fg; if (numTexCache[key]) return numTexCache[key];
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.fillStyle = fg; g.font = 'italic 900 ' + (String(num).length > 1 ? 78 : 96) + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 60, 70);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; numTexCache[key] = t; return t;
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
  function buildBike(spec, rider, opts) {
    opts = opts || {}; const env = opts.env || null; const st = spec.style; const naked = st.fairing === 'naked';
    const mats = sharedMats(env);
    const pat = opts.pattern != null ? opts.pattern : (rider.num % 4);
    const paint = paintMaterial(rider.c1, rider.c2, rider.c3, pat, env);
    const wb = spec.wheelbase, hx = wb / 2, Rr = 0.325, Rf = 0.315, wR = 0.115, wF = 0.078;

    const rootG = new THREE.Group(), leanG = new THREE.Group(), pitchG = new THREE.Group(), bodyG = new THREE.Group(), susG = new THREE.Group();
    rootG.add(leanG); leanG.add(pitchG); pitchG.add(bodyG); bodyG.add(susG);
    const P = new GeoBuilder(), Mt = new GeoBuilder(), Me = new GeoBuilder(), Gl = new GeoBuilder();
    const steerHead = V3(hx - 0.27, 0.93, 0), forkDir = V3(hx, Rf, 0).sub(steerHead).normalize();

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
    const steerG = new THREE.Group(); steerPivot.add(steerG); susG.add(steerPivot);
    const inv = new THREE.Matrix4().compose(steerHead, steerPivot.quaternion, V3(1, 1, 1)).invert();
    const F1 = new GeoBuilder(), F2 = new GeoBuilder(), FP = new GeoBuilder();
    for (const z of [-0.105, 0.105]) {
      const top = steerHead.clone().add(V3(-0.03, 0.03, z)), mid = top.clone().lerp(V3(hx, Rf, z), 0.5), bot = V3(hx, Rf, z);
      F2.add(tubeBetween(top, mid, 0.03, 0.03, 10), inv, spec.id === 'corsa' ? 0x1d1f23 : 0xcfa41d);
      F2.add(tubeBetween(mid, bot, 0.024, 0.024, 10), inv, 0xc9ccd0);
      F1.add(roundedBox(0.1, 0.06, 0.04, 0.014, 2), M(hx - 0.13, Rf + 0.06, z * 1.0, 0, 0, 1.1).premultiply(inv), 0xb8911a); // calipers
    }
    F1.add(roundedBox(0.07, 0.03, 0.27, 0.012, 2), M(steerHead.x - 0.02, steerHead.y + 0.03, 0).premultiply(inv), 0x1b1c20);
    const barY = st.bars === 'wide' ? 1.04 : 0.905, barX = st.bars === 'wide' ? hx - 0.36 : hx - 0.27, barZ = st.bars === 'wide' ? 0.36 : 0.265;
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
    const BV = naked ? 'duetto' : 'strada', BWB = naked ? 1.42 : 1.45, BMOD = !!(AX.Assets && AX.Assets.has('bike/' + BV + '_body'));
    if (BMOD) {
      const sx = wb / BWB, Sx = new THREE.Matrix4().makeScale(sx, 1, 1);
      paint.vertexColors = true;
      const catMat = (n) => /^P_/.test(n) ? paint : /^X_/.test(n) ? mats.metal : /^G_/.test(n) ? mats.gloss : /^S_/.test(n) ? mats.screen : mats.matte;
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
      for (const [w, nm] of [[wheelF, 'bike/' + BV + '_wheelF'], [wheelR, 'bike/' + BV + '_wheelR']]) { w.geometry = new THREE.BufferGeometry(); merged(nm).forEach((m) => w.add(m)); }
      brakeLight.position.set((naked ? -0.727 : -0.812) * sx, naked ? 0.912 : 0.995, 0); brakeLight.scale.set(1, 0.8, 0.85);
    }

    // number roundels on the tail sides
    const numTex = numberTexture(rider.num, rider.c3 === '#ffffff' ? '#ffffff' : '#f4f4f0', '#111111');
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, toneMapped: true });
    for (const z of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), numMat); m.position.set(BMOD ? -0.5 * wb / BWB : -0.5, BMOD ? (naked ? 0.85 : 0.875) : 0.86 + tH * 0.5, z * (BMOD ? (naked ? 0.108 : 0.137) : 0.128)); m.rotation.y = z > 0 ? 0 : Math.PI; m.rotation.x = z * -0.25; susG.add(m); }

    // ---- rider
    const riderRig = buildRider(spec, rider, mats, numTex, { barX, barY, barZ });
    susG.add(riderRig.group);

    rootG.traverse((o) => { if (o.isMesh && o !== shadow) { o.castShadow = true; o.receiveShadow = false; } });
    const batched = opts.batch !== false;
    const sc = (st.scale || 1) * AX.BIKE_SCALE; rootG.scale.setScalar(sc);

    const bike = {
      root: rootG, leanG, pitchG, bodyG, susG, steerG, wheelF, wheelR, rider: riderRig, paint, brakeMat, spec, scale: sc,
      Rr, Rf, hx, wfHolder, shadow, rT: 0.105, dive: 0, diveV: 0, steerVis: 0, shake: 0, crashedVis: false, riderHolder: null,
      /* contact patches in world space (for skid marks / smoke) */
      rearContact(out) { return out.set(-hx, 0.02, 0).applyMatrix4(leanG.matrixWorld); },
      frontContact(out) { return out.set(hx, 0.02, 0).applyMatrix4(leanG.matrixWorld); },
      exhaustPos(out) { return (st.exhaust === 'under' ? out.set(-0.78, 0.82, 0) : out.set(-0.5, 0.6, 0.16)).applyMatrix4(susG.matrixWorld); }
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
    im(key) {
      let im = this.ims[key]; if (im) return im;
      if (!this.mat) this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, envMap: SHARED.env || null, envMapIntensity: 0.3 });
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
    const g = new THREE.Group(); const naked = spec.style.fairing === 'naked';
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
    const backNum = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
    backNum.position.set(-0.118, 0.2, 0); backNum.rotation.set(0, -Math.PI / 2, 0); backNum.rotation.z = Math.PI / 2; torso.add(backNum);
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
      const m = new THREE.Mesh(RB.geo(key, () => lm ? mergeAsset('rider/' + lm, null, (n) => !/dark/.test(n)) : cylGeo(r0, r1)), mats.suit); m.userData.rb = { key, col }; g.add(m);
      // boots and gloves: their own instances (always dark), riding along as children of the limb
      if (lm && (lm === 'shin' || lm === 'foarm')) { const dk = 'rider:' + lm + ':dark', c = new THREE.Mesh(RB.geo(dk, () => mergeAsset('rider/' + lm, null, (n) => /dark/.test(n))), mats.suit); c.userData.rb = { key: dk, col: lm === 'shin' ? 0x1b1c20 : 0x222327 }; m.add(c); }
      return m; };
    const ball = (r, col, sx, sy, sz) => { const m = new THREE.Mesh(RB.geo('sph', sphGeo), mats.suit); m.userData.rb = { key: 'sph', col, scale: new THREE.Matrix4().makeScale(r * (sx || 1), r * (sy || 1), r * (sz || 1)) }; g.add(m); return m; };
    const parts = { arms: [], legs: [] };
    for (let s = 0; s < 2; s++) {
      parts.arms.push({ up: limb(0.074, 0.062, suit), lo: limb(0.062, 0.05, suit), sh: ball(RM ? 0.08 : 0.084, RM ? suit : accent), el: ball(0.064, suit), hand: ball(0.06, dark, 1.3, 0.85, 1) });
      parts.legs.push({ up: limb(0.104, 0.08, suit), lo: limb(0.078, 0.06, suit), hip: ball(0.105, suit), kn: ball(RM ? 0.08 : 0.084, RM ? suit : accent), foot: ball(0.064, dark, 2.0, 0.85, 1) });
    }
    const rig = {
      group: g, torso, helmet, parts, naked, bars,
      hang: 0, tuck: 0, sit: 0, kneeOut: 0, headYaw: 0,
      J: { H: V3(), S: V3(), head: V3(), a: V3(), b: V3(), c: V3(), pole: V3() }
    };
    poseRider(rig, { lean: 0, tuck: 0, sit: 0, steer: 0 }, 1);
    return rig;
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m4 = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  /* keep a joint above the asphalt once the bike is leaned: y·cosφ − z·sinφ ≥ margin (knee slider just touches) */
  function clearGround(p, phi, margin) {
    if (Math.abs(phi) < 0.05) return; const c = Math.cos(phi), s = Math.sin(phi);
    const h = p.y * c - p.z * s; if (h >= margin) return;
    p.z = (p.y * c - margin) / s;
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
  function poseRider(rig, st, k) {
    rig.hang = lerp(rig.hang, st.lean, k); rig.tuck = lerp(rig.tuck, st.tuck, k); rig.sit = lerp(rig.sit, st.sit, k);
    const h = rig.hang, ah = Math.abs(h), tk = rig.tuck, si = rig.sit, J = rig.J, nk = rig.naked, bars = rig.bars;
    // hips slide to the inside, torso follows further, head leads into the corner
    J.H.set(-0.3, 0.86 - ah * 0.02, h * 0.17);
    const sx = nk ? lerp(0.02, 0.1, tk) - si * 0.04 : lerp(0.14, 0.24, tk) - si * 0.1;
    const sy = nk ? lerp(1.34, 1.24, tk) + si * 0.03 : lerp(1.15, 1.04, tk) + si * 0.1 - ah * 0.03;
    J.S.set(sx + ah * 0.02, sy - ah * 0.04, h * 0.27);
    // torso basis: Y along spine, Z to rider's right (rolled a little into the corner)
    _y.subVectors(J.S, J.H).normalize(); _z.set(0, -h * 0.25, 1).normalize(); _x.crossVectors(_y, _z).normalize(); _z.crossVectors(_x, _y).normalize();
    _m4.makeBasis(_x, _y, _z); rig.torso.quaternion.setFromRotationMatrix(_m4); rig.torso.position.copy(J.H);
    rig.torso.scale.set(1, J.S.distanceTo(J.H) / 0.47, 1);
    J.head.copy(J.S).addScaledVector(_y, 0.16).addScaledVector(_x, 0.05); J.head.z += h * 0.07; J.head.y += lerp(0.02, -0.02, tk);
    rig.helmet.position.copy(J.head); rig.helmet.rotation.set(-h * 0.45, -h * 0.3, lerp(nk ? -0.05 : -0.2, -0.42, tk) + si * 0.15, 'YXZ');
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? -1 : 1, inside = sg * h > 0 ? Math.abs(h) : 0;
      // arm
      const A = rig.parts.arms[s];
      _a.copy(J.S).addScaledVector(_z, sg * 0.2).addScaledVector(_y, -0.05);
      _b.set(bars.barX, bars.barY + 0.02, sg * bars.barZ);
      rig.poleTmp = _d; const pole = J.pole.set(-0.5, -1.0 - inside * 0.3, sg * (0.42 + tk * 0.1 + inside * 0.3));
      ik(_a, _b, 0.285, 0.275, pole, J.c); clearGround(J.c, rig.bikeLean || 0, 0.07);
      setLimb(A.up, _a, J.c); setLimb(A.lo, J.c, _b); A.sh.position.copy(_a); A.el.position.copy(J.c); A.hand.position.copy(_b);
      // leg
      const Lg = rig.parts.legs[s];
      _a.copy(J.H).addScaledVector(_z, sg * 0.105); _a.y -= 0.03;
      _b.set(-0.25, 0.48, sg * 0.18);
      J.pole.set(0.9, 0.5 - inside * 0.5, sg * (0.25 + inside * 1.6));
      ik(_a, _b, 0.44, 0.44, J.pole, J.c); clearGround(J.c, rig.bikeLean || 0, 0.075);
      setLimb(Lg.up, _a, J.c); setLimb(Lg.lo, J.c, _b); Lg.hip.position.copy(_a); Lg.kn.position.copy(J.c); Lg.foot.position.set(_b.x + 0.03, _b.y - 0.01, _b.z);
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
      ik(_a, _b, 0.44, 0.44, J.pole, J.c); setLimb(Lg.up, _a, J.c); setLimb(Lg.lo, J.c, _b); Lg.hip.position.copy(_a); Lg.kn.position.copy(J.c); Lg.foot.position.copy(_b);
    }
  }

  /* ---------------------------------------------------------------- per-frame sync from physics */
  const _mw = new THREE.Matrix4(), _fw = new THREE.Vector3();
  function syncBike(vis, p, dt, time) {
    const spec = vis.spec, maxLean = spec.maxLean * Math.PI / 180;
    vis.root.position.set(p.x, (p.y || 0) + (p.surf === AX.SURF.KERB ? 0.075 : p.surf === AX.SURF.GRAVEL ? 0.012 : 0.02), p.z);   // sit on the surface, not in it
    vis.root.rotation.set(0, -p.yaw, Math.atan(p.slope || 0), 'YZX');   // yaw, then the road's slope
    // kerb rattle / off-road shake
    const rough = p.surf === AX.SURF.KERB ? 0.022 : (p.surf === AX.SURF.GRASS || p.surf === AX.SURF.GRAVEL) ? 0.03 : 0;
    const sh = rough * clamp(p.speed / 20, 0, 1) * (p.crashed ? 0 : 1);
    vis.shake = damp(vis.shake, sh, 12, dt);
    const jit = vis.shake ? Math.sin(time * 61.3 + p.x) * vis.shake : 0;
    const hangIn = p.crashed ? 0 : Math.max(0, p.hangIn || 0);
    const phi = p.lean * (1 - 0.13 * hangIn) + jit * 0.6;     // hanging off lets the bike itself stay more upright
    vis.leanG.rotation.x = phi;
    vis.leanG.position.set(0, vis.rT * (1 - Math.cos(phi)), -vis.rT * Math.sin(phi));   // roll on the tyre's round profile
    vis.rider.bikeLean = phi;
    vis.shadow.position.z = Math.sin(phi) * 0.3; vis.shadow.scale.y = 1 + Math.abs(Math.sin(phi)) * 0.6; vis.shadow.visible = !p.crashed;
    // pitch about the wheel that stays on the ground
    const hx = vis.hx;
    if (p.pitch >= 0) { vis.pitchG.position.set(-hx, 0, 0); vis.bodyG.position.set(hx, 0, 0); }
    else { vis.pitchG.position.set(hx, 0, 0); vis.bodyG.position.set(-hx, 0, 0); }
    vis.pitchG.rotation.z = p.pitch;
    // sprung body: dive under braking, squat under power
    const target = p.crashed ? 0 : clamp(-p.aLong * 0.0042, -0.05, 0.055);
    vis.diveV += ((target - vis.dive) * 190 - vis.diveV * 17) * dt; vis.dive += vis.diveV * dt;
    vis.susG.rotation.z = -vis.dive + jit * 0.5; vis.susG.position.y = -Math.abs(vis.dive) * 0.25 + Math.abs(jit) * 0.4;
    // wheels
    // the front wheel is unsprung: keep its axle where the body says it is, whatever the suspension does
    vis.root.updateMatrixWorld(true); _fw.set(hx, vis.Rf, 0).applyMatrix4(vis.bodyG.matrixWorld); vis.wfHolder.parent.worldToLocal(_fw); vis.wfHolder.position.copy(_fw);
    const roll = p.speed * dt / (vis.Rr * vis.scale);
    vis.wheelR.rotation.z -= roll * (1 + p.spin * 0.45); vis.wheelF.rotation.z -= p.pitch > 0.06 ? roll * 0.6 : roll;
    // steering: counter-steers into a slide, turns in at walking pace
    const st = p.crashed ? 0.5 * (p.crashSide || 1) : clamp(-p.slipAngle * 1.1 + p.steer * lerp(0.42, 0.03, smoothstep(2, 14, p.speed)), -0.55, 0.55);
    vis.steerVis = damp(vis.steerVis, st, 16, dt); vis.steerG.rotation.y = -vis.steerVis;
    // brake light
    const br = p.brake > 0.08 && !p.crashed;
    vis.brakeMat.color.setRGB(br ? 3.2 : 0.3, br ? 0.22 : 0.03, br ? 0.12 : 0.02);
    // rider
    const rg = vis.rider.group;
    if (!p.crashed) {
      if (vis.crashedVis) { vis.crashedVis = false; vis.susG.add(rg); rg.position.set(0, 0, 0); rg.rotation.set(0, 0, 0); rg.scale.setScalar(1); vis.rider.hang = 0; }
      const hang = p.hang != null ? p.hang : clamp(p.lean / maxLean, -1, 1) * smoothstep(4, 14, p.speed);
      const fwd = p.fb || 0;
      const tuck = clamp(Math.max(0, fwd) * (1 - Math.abs(hang) * 0.5) + smoothstep(40, 60, p.speed) * 0.25 * (1 - Math.abs(hang)), 0, 1);
      const sit = clamp(Math.max(0, -fwd) * 0.9 + p.brake * 0.35 * smoothstep(6, 20, p.speed), 0, 1) - clamp(p.pitch * 1.2, 0, 0.5);
      poseRider(vis.rider, { lean: hang, tuck, sit, steer: p.steer }, 1 - Math.exp(-9 * dt));
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
    vis.root.traverse(f); vis.rider.group.traverse(f); vis.brakeMat = new THREE.MeshBasicMaterial(); return vis;
  }

  AX.Models = { buildBike, syncBike, disposeBike, ghostify, GeoBuilder, loft, roundedBox, capsule, tubeBetween, arcShell, M, lin, numberTexture };
})(typeof globalThis !== 'undefined' ? globalThis : window);
