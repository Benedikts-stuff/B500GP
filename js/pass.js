/* APEX — the mountain pass world: terrain, road with elevation, stone retaining walls, W-beam guardrails,
   snow poles, hairpin chevrons, conifer forest, boulders and a ring of snow-capped peaks. */
(function (root) {
  'use strict';
  const AX = root.AX, THREE = root.THREE;
  const { clamp, lerp, smoothstep, mod } = AX;
  const { GeoBuilder, roundedBox, M, lin, tubeBetween } = AX.Models;
  const W = AX.worldTex;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const PK = root.APEX_PASS || null;                    // baked texture set + wall stone tile (tools/texgen.py)
  const texCache = {};
  function ptex(key, kind, aniso, rep) {
    if (!PK || !PK.tex[key]) return null; const id = key + kind + (rep || '');
    if (texCache[id]) return texCache[id];
    const img = new Image(), tx = new THREE.Texture(img); img.onload = () => { tx.needsUpdate = true; }; img.src = PK.tex[key][kind];
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = aniso || 8; if (kind === 'a') tx.encoding = THREE.sRGBEncoding;
    if (rep) tx.repeat.set(rep[0], rep[1]);
    return (texCache[id] = tx);
  }

  /* ---------------------------------------------------------------- textures */
  // tileable Voronoi stones with dark joints: the dry-stone walls you find on every alpine pass road
  function stoneTex(aniso) {
    const S = 512, CX = 7, CY = 5, pts = [];
    for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) pts.push([(i + 0.15 + W.hash2(i, j + 40) * 0.7) / CX, (j + 0.15 + W.hash2(i + 9, j) * 0.7) / CY, W.hash2(i + 3, j + 7)]);
    return W.pixelTex(S, (u, v, x, y) => {
      let d1 = 9, d2 = 9, id = 0;
      for (const p of pts) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const dx = (u - p[0] - ox) * CX * 0.8, dy = (v - p[1] - oy) * CY, d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; id = p[2]; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1), joint = smoothstep(0.03, 0.12, edge);
      const n = (W.fbm(u * 18, v * 18, 18, 3) - 0.5) * 34 + (W.hash2(x, y) - 0.5) * 14;
      const base = 118 + id * 46, warm = id * 10;
      const r = lerp(52, base + 8 + warm + n, joint), g = lerp(48, base + 4 + warm * 0.6 + n, joint), b = lerp(42, base - 6 + n, joint);
      const shade = 0.82 + 0.18 * smoothstep(0.0, 0.45, edge);   // stones bulge a little
      return [r * shade, g * shade, b * shade];
    }, null, aniso);
  }
  function rockTex(aniso) {
    return W.pixelTex(256, (u, v, x, y) => {
      const strata = Math.sin((v * 9 + W.fbm(u * 4, v * 4, 4, 3) * 2.2) * Math.PI * 2) * 10;
      const crack = smoothstep(0.03, 0.0, Math.abs(W.fbm(u * 6 + 3, v * 3, 6, 3) - 0.5)) * 45;
      const n = (W.fbm(u * 8, v * 8, 8, 4) - 0.5) * 70 + (W.hash2(x, y) - 0.5) * 16 + strata - crack;
      const lich = W.fbm(u * 5 + 9, v * 5 + 2, 5, 3) > 0.62 ? 1 : 0;
      return lich ? [92 + n * 0.6, 104 + n * 0.6, 70 + n * 0.5] : [104 + n, 100 + n, 94 + n];
    }, null, aniso);
  }
  function meadowTex(aniso) {
    return W.pixelTex(512, (u, v, x, y) => {
      const n = (W.fbm(u * 10, v * 10, 10, 4) - 0.5) * 34 + (W.hash2(x, y) - 0.5) * 22 + (W.hash2(x >> 1, y >> 1) - 0.5) * 10;
      const fl = W.hash2(x * 7 + 1, y * 3 + 2) > 0.9975 ? 1 : 0;   // tiny flowers
      return fl ? [240, 236, 215] : [86 + n * 0.8, 140 + n, 62 + n * 0.5];
    }, null, aniso);
  }
  function gravelTex2(aniso) {
    return W.pixelTex(256, (u, v, x, y) => { const k = (W.hash2(x, y) - 0.5) * 50 + (W.hash2(x >> 1, y >> 1) - 0.5) * 30 + (W.fbm(u * 6, v * 6, 6, 3) - 0.5) * 24; return [150 + k, 146 + k, 136 + k]; }, null, aniso);
  }
  function dashTex() {
    const t = W.canvasTex(16, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#f2f1ea'; g.fillRect(0, 0, w, h * 0.45); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function chevronTex() {
    return W.canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#d4202a';
      for (let k = -1; k < 4; k++) { const x = k * 72 + 20; g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 34, 10); g.lineTo(x + 70, h / 2); g.lineTo(x + 34, h - 10); g.lineTo(x, h - 10); g.lineTo(x + 36, h / 2); g.closePath(); g.fill(); }
      g.strokeStyle = '#d4202a'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    });
  }
  function signTex(lines) {
    return W.canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#1f4f9a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 60px "Helvetica Neue", Arial, sans-serif'; g.fillText(lines[0], w / 2, h * 0.38);
      g.font = '500 48px "Helvetica Neue", Arial, sans-serif'; g.fillText(lines[1], w / 2, h * 0.68);
    });
  }

  /* ---------------------------------------------------------------- road-following meshes */
  // ribbon between two lateral offsets, following the road height. o.y(i) adds a height offset per side.
  function rib(t, offA, offB, o) {
    o = o || {}; const N = t.n, step = o.step || 1, P = [], UV = [], NR = [], A = [];
    const yA = o.yA || (() => 0), yB = o.yB || yA, vLen = o.vLen || 8, uRep = o.uRep || 1;
    let s0 = 0;
    for (let i = 0; i < N - step; i += step) {
      const j = Math.min(i + step, N - 1); if (o.cond && !(o.cond(i) && o.cond(j))) continue;
      const a0 = offA(i), b0 = offB(i), a1 = offA(j), b1 = offB(j), h0 = t.py[i], h1 = t.py[j];
      const P0 = [t.px[i] + t.nx[i] * a0, h0 + yA(i), t.pz[i] + t.nz[i] * a0], Q0 = [t.px[i] + t.nx[i] * b0, h0 + yB(i), t.pz[i] + t.nz[i] * b0];
      const P1 = [t.px[j] + t.nx[j] * a1, h1 + yA(j), t.pz[j] + t.nz[j] * a1], Q1 = [t.px[j] + t.nx[j] * b1, h1 + yB(j), t.pz[j] + t.nz[j] * b1];
      if (b0 >= a0) P.push(...P0, ...Q0, ...P1, ...Q0, ...Q1, ...P1); else P.push(...P0, ...P1, ...Q0, ...Q0, ...P1, ...Q1);
      const v0 = i * t.ds / vLen, v1 = j * t.ds / vLen; if (b0 >= a0) UV.push(0, v0, uRep, v0, 0, v1, uRep, v0, uRep, v1, 0, v1); else UV.push(0, v0, 0, v1, uRep, v0, uRep, v0, 0, v1, uRep, v1);
      if (o.alpha) { const al0 = o.alpha(i), al1 = o.alpha(j); if (b0 >= a0) A.push(al0, al0, al1, al0, al1, al1); else A.push(al0, al1, al0, al0, al1, al1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    if (A.length) g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(A, 1));
    g.computeVertexNormals(); return g;
  }
  // a cross-section profile [[lateral, height], ...] swept along one side of the road where cond(i)
  function sweep(t, side, prof, cond, uLen) {
    const N = t.n, sg = side ? 1 : -1, P = [], UV = [], idx = []; let rows = 0, prev = false, s = 0;
    const flip = side === 0;
    for (let i = 0; i < N; i++) {
      const on = cond(i); if (!on) { prev = false; continue; }
      const base = P.length / 3;
      for (let k = 0; k < prof.length; k++) {
        const lat = prof[k][0](i), h = prof[k][1](i);
        P.push(t.px[i] + t.nx[i] * sg * lat, t.py[i] + h, t.pz[i] + t.nz[i] * sg * lat); UV.push(i * t.ds / (uLen || 2), prof[k][2] != null ? prof[k][2](i) : k / (prof.length - 1));
      }
      if (prev) for (let k = 0; k < prof.length - 1; k++) {
        const a = base - prof.length + k, b = base + k;
        if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      prev = true; rows++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }

  /* ---------------------------------------------------------------- terrain */
  function terrainMaterial(grass, rock, scree, nm) {
    const m = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.97 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rockMap = { value: rock }; sh.uniforms.screeMap = { value: scree };
      if (nm) { sh.uniforms.grassN = { value: nm.grass }; sh.uniforms.rockN = { value: nm.rock }; sh.uniforms.screeN = { value: nm.scree }; }
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aMat; varying vec3 vMat; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D rockMap; uniform sampler2D screeMap;' + (nm ? ' uniform sampler2D grassN; uniform sampler2D rockN; uniform sampler2D screeN;' : '') + ' varying vec3 vMat; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 wn = normalize(vWN);
          vec3 bw = pow(abs(wn), vec3(6.0)); bw /= (bw.x + bw.y + bw.z);
          vec2 uvX = vWP.zy * 0.1, uvY = vWP.xz * 0.075, uvZ = vWP.xy * 0.1;
          vec3 rk = texture2D(rockMap, uvX).rgb * bw.x + texture2D(rockMap, uvY).rgb * bw.y + texture2D(rockMap, uvZ).rgb * bw.z;
          vec3 sc = texture2D(screeMap, vUv * 1.6).rgb;
          rk = pow(rk, vec3(2.2)); sc = pow(sc, vec3(2.2));   // custom samplers bypass three's sRGB decode
          // break up the tiling of the meadow with a second, much larger sample
          float macro = dot(texture2D(map, vUv * 0.137 + 0.31).rgb, vec3(0.33));
          diffuseColor.rgb *= 0.78 + macro * 0.9;
          diffuseColor.rgb = mix(diffuseColor.rgb, sc, vMat.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, rk, vMat.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), vMat.y);`);
      if (nm) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // whiteout-blended triplanar normal mapping in world space
            vec3 tX = texture2D(rockN, uvX).xyz * 2.0 - 1.0, tY = texture2D(rockN, uvY).xyz * 2.0 - 1.0, tZ = texture2D(rockN, uvZ).xyz * 2.0 - 1.0;
            vec3 sg = sign(wn);
            vec3 nX = vec3(wn.x, tX.y + wn.y, tX.x * sg.x + wn.z);
            vec3 nY = vec3(tY.x + wn.x, wn.y, tY.y + wn.z);
            vec3 nZ = vec3(tZ.x * sg.z + wn.x, tZ.y + wn.y, wn.z);
            vec3 nRock = normalize(nX * bw.x + nY * bw.y + nZ * bw.z);
            vec3 tg = texture2D(grassN, vUv).xyz * 2.0 - 1.0, ts = texture2D(screeN, vUv * 1.6).xyz * 2.0 - 1.0;
            vec3 tFlat = normalize(mix(tg * vec3(0.8, 0.8, 1.0), ts, vMat.z));
            vec3 nFlat = normalize(vec3(tFlat.x + wn.x, wn.y, tFlat.y + wn.z));
            vec3 nW = normalize(mix(mix(nFlat, nRock, vMat.x), wn, vMat.y * 0.7));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`);
    };
    m.customProgramCacheKey = () => 'apex-terrain' + (nm ? 'N' : ''); return m;
  }
  /* Art-of-Rally style ground: clean colour fields from the vertex colours, flat rock bands, scree and snow,
     no high-frequency textures (they shimmer at grazing angles and read as noise) */
  function rallyTerrainMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aMat; varying vec3 vMat; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMat; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <common>', '#include <common>\nfloat hh2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh2(i), hh2(i + vec2(1, 0)), f.x), mix(hh2(i + vec2(0, 1)), hh2(i + vec2(1, 1)), f.x), f.y); }')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float gv = vn2(vWP.xz * 0.28) * 0.6 + vn2(vWP.xz * 0.9 + 17.0) * 0.4;
          diffuseColor.rgb *= 0.86 + gv * 0.26;
          // rock: soft large-scale tone changes and faint vertical weathering streaks, no hard bands
          float rv = vn2(vWP.xz * 0.018 + 3.0) * 0.6 + vn2(vWP.xz * 0.06) * 0.4;
          float streak = vn2(vec2((vWP.x + vWP.z) * 0.22, vWP.y * 0.012));
          vec3 wn = normalize(vWN);
          // cool blue-grey limestone with warm patches, rusty iron streaks running down, lighter weathered tops
          vec3 rock = mix(vec3(0.235, 0.245, 0.265), vec3(0.385, 0.345, 0.285), rv) * (0.88 + streak * 0.2);
          // vertical joints / cracks give the faces structure even from far away
          float joint = smoothstep(0.035, 0.0, abs(fract((vWP.x * 0.7 + vWP.z * 0.7) * 0.11 + vn2(vec2(vWP.y * 0.05, (vWP.x + vWP.z) * 0.02)) * 1.5) - 0.5) - 0.46);
          rock *= 1.0 - joint * 0.35;
          float iron = smoothstep(0.62, 0.8, vn2(vec2((vWP.x + vWP.z) * 0.09, vWP.y * 0.025 + 7.0))) * smoothstep(0.3, 0.6, vn2(vWP.xz * 0.05 + 11.0));
          rock = mix(rock, vec3(0.330, 0.190, 0.105), iron * 0.55);
          rock *= 0.85 + 0.35 * smoothstep(0.2, 0.75, wn.y);
          vec3 grassC = diffuseColor.rgb;
          vec3 scree = vec3(0.385, 0.355, 0.300);
          diffuseColor.rgb = mix(diffuseColor.rgb, scree, vMat.z);
          // grass keeps a hold on ledges and gentler parts of the rock faces
          float ledge = smoothstep(0.55, 0.75, wn.y) * smoothstep(0.35, 0.65, vn2(vWP.xz * 0.12 + 5.0));
          rock = mix(rock, grassC * 0.85, ledge);
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, smoothstep(0.25, 0.75, vMat.x));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94), vMat.y);`)
        // rock faces shade faceted (low-poly cliff look), meadows stay smooth
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec3 fn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))); normal = normalize(mix(normal, fn, smoothstep(0.35, 0.8, vMat.x))); }`);
    };
    m.customProgramCacheKey = () => 'apex-rally-terrain'; return m;
  }
  const s2l = (c) => Math.pow(c / 255, 2.2);
  const C3 = (r, g, b) => [s2l(r), s2l(g), s2l(b)];
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // builds a regular grid; h(x, z) -> height, mat(x, z, h, slope) -> [rock, snow, scree], tint(x, z) -> colour mult
  function gridMesh(x0, z0, x1, z1, step, h, mat, tint, lower) {
    const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
    const P = new Float32Array(nx * nz * 3), UV = new Float32Array(nx * nz * 2), H = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step, k = j * nx + i; let y = h(x, z); if (lower) y += lower(x, z);
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; UV[k * 2] = x / 7; UV[k * 2 + 1] = z / 7; H[k] = y;
    }
    const idx = []; for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const Nn = g.attributes.normal.array, MAT = new Float32Array(nx * nz * 3), C = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) {
      const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2], m = mat(x, z, y, Nn[k * 3 + 1]); MAT[k * 3] = m[0]; MAT[k * 3 + 1] = m[1]; MAT[k * 3 + 2] = m[2];
      const c = tint(x, z, y); C[k * 3] = c[0]; C[k * 3 + 1] = c[1]; C[k * 3 + 2] = c[2];
    }
    g.setAttribute('aMat', new THREE.BufferAttribute(MAT, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.userData = { nx, nz, x0, z0, step, H }; return g;
  }



  /* chunky faceted boulders: displaced icosphere, a couple of flat fracture planes, box-projected rock texture */
  function boulderGeo(seed) {
    const H = (n) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, key = (x, y, z) => Math.round(x * 97) + ',' + Math.round(y * 97) + ',' + Math.round(z * 97);
    const map = new Map(); let h = 0;
    const planes = []; for (let k = 0; k < 3; k++) { const a = H(k * 3 + 1) * Math.PI * 2, e = (H(k * 3 + 2) - 0.3) * 1.2; planes.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e), 0.62 + H(k * 3 + 3) * 0.2]); }
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const k = key(v.x, v.y, v.z); let d = map.get(k); if (d === undefined) map.set(k, d = 0.8 + H(++h + 7) * 0.35);
      v.multiplyScalar(d);
      for (const pl of planes) { const t = v.x * pl[0] + v.y * pl[1] + v.z * pl[2] - pl[3]; if (t > 0) { v.x -= pl[0] * t; v.y -= pl[1] * t; v.z -= pl[2] * t; } }
      v.y = Math.max(v.y * 0.72, -0.32); v.x *= 1.15;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
    const P = ng.attributes.position, Nn = ng.attributes.normal, uv = new Float32Array(P.count * 2);
    for (let f = 0; f < P.count; f += 3) {
      const nx = Math.abs(Nn.getX(f)), ny = Math.abs(Nn.getY(f)), nz = Math.abs(Nn.getZ(f));
      for (let j = f; j < f + 3; j++) { const x = P.getX(j), y = P.getY(j), z = P.getZ(j);
        if (ny >= nx && ny >= nz) { uv[j * 2] = x * 0.35; uv[j * 2 + 1] = z * 0.35; } else if (nx >= nz) { uv[j * 2] = z * 0.35; uv[j * 2 + 1] = y * 0.35; } else { uv[j * 2] = x * 0.35; uv[j * 2 + 1] = y * 0.35; } }
    }
    ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); ng.computeBoundingSphere(); return ng;
  }

  /* ---------------------------------------------------------------- 3D dry-stone walls
     Every stone is real geometry: a bevelled, slightly domed polygon from the periodic stone tile in the pack.
     The flat wall face behind the stones carries a texture rendered from the very same tile, so far away
     (stones hidden by the LOD) the wall looks identical, and up close the joints between the stones are dark. */
  AX.World.prototype._passWalls = function () {
    const t = this.track, sc = this.scene, an = this.aniso, N = t.n;
    const WT = PK.wall, TW = WT.w, TH = WT.h, ST = WT.stones, B = 0.45;      // B: wall foundation below road level
    const q = this.q === 'low' ? 0 : this.q === 'medium' ? 1 : 2;
    const faceMat = new THREE.MeshStandardMaterial({ map: ptex('wall', 'a', an), normalMap: ptex('wall', 'n', an), roughness: 0.95, side: THREE.DoubleSide });
    if (AX.Assets && AX.Assets.has('kaykit/Tree_4_A')) faceMat.color = new THREE.Color(0.72, 0.72, 0.72);
    const flat = AX.Assets && AX.Assets.has('kaykit/Tree_4_A');
    const stoneMat = flat ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
      : new THREE.MeshStandardMaterial({ map: ptex('granite', 'a', an), normalMap: ptex('granite', 'n', an), normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, roughness: 0.88 });
    const capMat = flat ? new THREE.MeshStandardMaterial({ color: lin(0xcdc8be), roughness: 0.95, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ map: ptex('granite', 'a', an), normalMap: ptex('granite', 'n', an), color: lin(0xc9c4ba), roughness: 0.9, side: THREE.DoubleSide });
    if (flat) { faceMat.normalMap = null; }
    const s2l = (c) => Math.pow(c / 255, 2.2);
    const H = (h) => ((h * 2654435761) >>> 0) / 4294967296;
    this.passLod = this.passLod || [];
    const lodR = [0, 95, 150][q];
    let nStones = 0;
    for (const s of [0, 1]) {
      const sg = s ? 1 : -1;
      // contiguous wall runs
      const runs = []; let a0 = -1;
      for (let i = 0; i <= N; i++) { const on = i < N && t.barType[s][i] === 2; if (on && a0 < 0) a0 = i; if (!on && a0 >= 0) { if (i - a0 > 2) runs.push([a0, i - 1]); a0 = -1; } }
      for (const [ra, rb] of runs) {
        // arc length measured along the wall foot, so stones keep their size on the inside of bends
        const n = rb - ra + 1, sw = new Float64Array(n);
        for (let k = 1; k < n; k++) {
          const i = ra + k, j = i - 1;
          const xi = t.px[i] + t.nx[i] * sg * t.bar[s][i], zi = t.pz[i] + t.nz[i] * sg * t.bar[s][i], xj = t.px[j] + t.nx[j] * sg * t.bar[s][j], zj = t.pz[j] + t.nz[j] * sg * t.bar[s][j];
          sw[k] = sw[k - 1] + Math.max(0.05, Math.hypot(xi - xj, zi - zj, t.py[i] - t.py[j]));
        }
        const U0 = sw[0], U1 = sw[n - 1];
        const at = (U) => { // fractional run index for an arc length
          let lo = 0, hi = n - 1; if (U <= sw[0]) return 0; if (U >= sw[n - 1]) return n - 1;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sw[m] <= U) lo = m; else hi = m; }
          return lo + (U - sw[lo]) / (sw[hi] - sw[lo]);
        };
        const L = (arr, f) => { const k = Math.floor(f), u = f - k, k1 = Math.min(k + 1, n - 1); return arr[ra + k] * (1 - u) + arr[ra + k1] * u; };
        const wallH = t.wallH[s], bar = t.bar[s];
        const P = (U, V, depth, out) => {
          const f = at(U), h = L(wallH, f), top = h + B; V = Math.min(V, top);
          const lat = L(bar, f) + 0.06 * h * (V / top) - depth;
          out[0] = L(t.px, f) + L(t.nx, f) * sg * lat; out[1] = L(t.py, f) + V - B; out[2] = L(t.pz, f) + L(t.nz, f) * sg * lat; return h;
        };
        // chunks of ~32 m
        const nCh = Math.max(1, Math.round((U1 - U0) / 32));
        for (let c = 0; c < nCh; c++) {
          const cu0 = U0 + (U1 - U0) * c / nCh, cu1 = U0 + (U1 - U0) * (c + 1) / nCh;
          /* face (always visible, casts the shadow) */
          {
            const Pp = [], UV = [], idx = []; const tmp = [0, 0, 0];
            const k0 = Math.floor(at(cu0)), k1 = Math.min(n - 1, Math.ceil(at(cu1)));
            for (let k = k0; k <= k1; k++) {
              const i = ra + k, h = wallH[i];
              for (const V of [0, h + B]) {
                const lat = bar[i] + 0.06 * h * (V / (h + B));
                Pp.push(t.px[i] + t.nx[i] * sg * lat, t.py[i] + V - B, t.pz[i] + t.nz[i] * sg * lat); UV.push(sw[k] / TW, V / TH);
              }
              if (k > k0) { const p = (k - k0) * 2, o = p - 2; if (s) idx.push(o, p, o + 1, o + 1, p, p + 1); else idx.push(o, o + 1, p, o + 1, p + 1, p); }
            }
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(idx); g.computeVertexNormals();
            sc.add(Object.assign(new THREE.Mesh(g, faceMat), { castShadow: true, receiveShadow: true }));
            /* coping: bevelled granite slabs overhanging the face */
            const Cp = [], CU = [], ci = []; const prof = [[-0.19, -0.07], [-0.19, 0.06], [-0.14, 0.12], [0.45, 0.12], [0.6, 0.02]];
            for (let k = k0; k <= k1; k++) {
              const i = ra + k, h = wallH[i], face = bar[i] + 0.06 * h;
              for (let m = 0; m < prof.length; m++) { const lat = face + prof[m][0]; Cp.push(t.px[i] + t.nx[i] * sg * lat, t.py[i] + h + prof[m][1], t.pz[i] + t.nz[i] * sg * lat); CU.push(sw[k] / 1.3, m * 0.18); }
              if (k > k0) for (let m = 0; m < prof.length - 1; m++) { const a = (k - k0 - 1) * prof.length + m, b2 = (k - k0) * prof.length + m; if (s) ci.push(a, b2, a + 1, a + 1, b2, b2 + 1); else ci.push(a, a + 1, b2, a + 1, b2 + 1, b2); }
            }
            const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(Cp, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(CU, 2)); cg.setIndex(ci); cg.computeVertexNormals();
            sc.add(Object.assign(new THREE.Mesh(cg, capMat), { castShadow: true, receiveShadow: true }));
          }
          if (!q) continue;
          /* stones */
          const Pp = [], C = [], UV = [], idx = []; const tmp = [0, 0, 0];
          let hMax = 0; for (let k = Math.floor(at(cu0)); k <= Math.min(n - 1, Math.ceil(at(cu1))); k++) hMax = Math.max(hMax, wallH[ra + k]);
          const rows = Math.ceil((hMax + B) / TH);
          for (let tx = Math.floor(cu0 / TW) - 1; tx <= Math.floor(cu1 / TW) + 1; tx++) for (let r = 0; r < rows; r++) for (let si = 0; si < ST.length; si++) {
            const st = ST[si], cU = tx * TW + st.c[0], cV = r * TH + st.c[1];
            if (cU < cu0 || cU >= cu1 || cU < U0 + 0.1 || cU > U1 - 0.1) continue;
            const hh = L(wallH, at(cU)); if (cV > hh + B - 0.04) continue;
            const rnd = H(tx * 7919 + r * 104729 + si * 31337 + s * 7 + ra), rnd2 = H(tx * 31 + r * 7 + si * 131 + ra * 3);
            const pr = st.p * (0.8 + rnd2 * 0.45), bu = st.b, tone = 0.9 + rnd * 0.2, warm = (H(si * 17 + tx * 3 + r) - 0.5) * 0.08;
            const dim = flat ? 0.82 : 1, col = [s2l(st.col[0] * tone * dim * (1 + warm)), s2l(st.col[1] * tone * dim), s2l(st.col[2] * tone * dim * (1 - warm))];
            const m = st.o.length, base = Pp.length / 3;
            const put = (u, v, d, ao) => {
              const U = Math.min(U1, Math.max(U0, tx * TW + u)), V = r * TH + v; P(U, V, d, tmp);
              Pp.push(tmp[0], tmp[1], tmp[2]); C.push(col[0] * ao, col[1] * ao, col[2] * ao); UV.push(U * 0.7, V * 0.7);
            };
            for (let k = 0; k < m; k++) put(st.o[k][0], st.o[k][1], -0.025, 0.42);
            for (let k = 0; k < m; k++) put(st.i[k][0], st.i[k][1], pr, 0.92);
            put(st.c[0], st.c[1], pr + bu, 1.05);
            // winding: the polygon is CCW in (U, V); on side 1 the wall faces -n, which mirrors it
            const ctr = base + 2 * m;
            for (let k = 0; k < m; k++) {
              const o0 = base + k, o1 = base + (k + 1) % m, i0 = base + m + k, i1 = base + m + (k + 1) % m;
              idx.push(o0, o1, i1, o0, i1, i0, i0, i1, ctr);
            }
            nStones++;
          }
          if (!Pp.length) continue;
          { // make the stones face the road: test the first fan triangle and flip the whole chunk if needed
            const a = idx[6] * 3, b2 = idx[7] * 3, c2 = idx[8] * 3;
            const e1 = [Pp[b2] - Pp[a], Pp[b2 + 1] - Pp[a + 1], Pp[b2 + 2] - Pp[a + 2]], e2 = [Pp[c2] - Pp[a], Pp[c2 + 1] - Pp[a + 1], Pp[c2 + 2] - Pp[a + 2]];
            const nx = e1[1] * e2[2] - e1[2] * e2[1], nz = e1[0] * e2[1] - e1[1] * e2[0];
            const k = ra + Math.round(at((cu0 + cu1) / 2)), dot = -(nx * t.nx[k] + nz * t.nz[k]) * sg;
            if (dot < 0) for (let j = 0; j < idx.length; j += 3) { const tmpI = idx[j + 1]; idx[j + 1] = idx[j + 2]; idx[j + 2] = tmpI; }
          }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
          g.setIndex(Pp.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
          const mesh = new THREE.Mesh(g, stoneMat); mesh.receiveShadow = true; mesh.castShadow = q > 1; sc.add(mesh);
          this.passLod.push({ obj: mesh, p: g.boundingSphere.center.clone(), r: lodR + g.boundingSphere.radius });
        }
      }
    }
    this.wallStones = nStones;
  };


  /* flag textures */
  function flagTex(kind) {
    return W.canvasTex(192, 128, (g, w, h) => {
      if (kind === 'ch') { g.fillStyle = '#d52b1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; const c = h * 0.6, b = c / 3.2; g.fillRect(w / 2 - b / 2, h / 2 - c / 2, b, c); g.fillRect(w / 2 - c / 2, h / 2 - b / 2, c, b); }
      else if (kind === 'gr') { g.fillStyle = '#d52b1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, h * 0.5, w, h * 0.5); }        // red/white halves (canton style)
      else if (kind === 'ur') { g.fillStyle = '#f4d21a'; g.fillRect(0, 0, w, h); g.fillStyle = '#16171a'; g.beginPath(); g.arc(w / 2, h / 2, h * 0.28, 0, 6.3); g.fill(); }
      else if (kind === 'blue') { g.fillStyle = '#1f5fbf'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, h * 0.42, w, h * 0.16); }
      else { for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) { g.fillStyle = (x + y) % 2 ? '#f4f4f0' : '#141518'; g.fillRect(x * w / 12, y * h / 8, w / 12 + 1, h / 8 + 1); } }
    });
  }
  AX.World.prototype._passEvent = function (blds, roadClear, rng, q) {
    const t = this.track, sc = this.scene, N = t.n, th = this.theme;
    const lin2 = (h) => new THREE.Color(h).convertSRGBToLinear();
    /* spectators: tinted shirt + untinted legs/head/hair, two instanced batches with identical transforms (person faces +x) */
    const body = new GeoBuilder(), rest = new GeoBuilder();
    body.add(roundedBox(0.26, 0.5, 0.42, 0.08, 2), M(0, 1.16, 0), 0xffffff);
    for (const z of [-0.25, 0.25]) body.add(roundedBox(0.12, 0.46, 0.12, 0.05, 2), M(0.02, 1.13, z), 0xffffff);
    for (const z of [-0.1, 0.1]) rest.add(roundedBox(0.16, 0.86, 0.16, 0.05, 2), M(0, 0.45, z), 0x2a3346);
    rest.add(roundedBox(0.2, 0.22, 0.2, 0.08, 3), M(0.0, 1.55, 0), 0xe6b996);
    rest.add(roundedBox(0.21, 0.08, 0.21, 0.04, 2), M(-0.01, 1.66, 0), 0x3a2a1e);
    const bodyS = new W.Scatter(body.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 1e6);
    const restS = new W.Scatter(rest.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 1e6);
    const shirts = ['#d52b1e', '#d52b1e', '#ffffff', '#1f5fbf', '#f4a21a', '#22252b', '#19b36b', '#f0d21a', '#7b3fe0', '#e8e4dc'];
    let nSpec = 0;
    const crowd = (i0, i1, density) => {
      for (let i = Math.max(5, i0); i < Math.min(N - 5, i1); i++) for (const s of [0, 1]) {
        if (rng() > density) continue;
        const sg = s ? 1 : -1, wall = t.barType[s][i] === 2;
        const lat = wall ? t.bar[s][i] + 0.06 * t.wallH[s][i] + rng.range(0.7, 2.2) : t.bar[s][i] + rng.range(0.9, 3.2);
        const x = t.px[i] + t.nx[i] * sg * lat + rng.range(-0.4, 0.4), z = t.pz[i] + t.nz[i] * sg * lat + rng.range(-0.4, 0.4);
        if (!roadClear(x, z, t.hw + 0.8)) continue;
        const y = this.heightAt(x, z); if (Math.abs(y - (wall ? t.py[i] + t.wallH[s][i] : t.py[i])) > 3.5) continue;
        const ry = Math.atan2(-(t.pz[i] - z), t.px[i] - x) + rng.range(-0.5, 0.5), h = rng.range(0.92, 1.08);
        bodyS.add(x, y - 0.03, z, ry, h, h, h, rng.pick(shirts)); restS.add(x, y - 0.03, z, ry, h, h, h); nSpec++;
        if (nSpec % 4 === 0) blds.push([x, z, 1.2]);
        if (nSpec % 3 === 0) { (this.crowdPts = this.crowdPts || []).push(x, z); }
      }
    };
    const sI = t.startIdx, fI = t.finishIdx;
    crowd(sI - 30, sI + 70, 0.32 * q + 0.1);
    crowd(fI - 160, fI + 25, 0.28 * q + 0.08);
    // a few small groups on the hairpins (the classic spectator spots)
    t.corners.forEach((c) => { if (c.radius < 30 && rng() < 0.7) crowd(c.apex - 8, c.apex + 8, 0.35 * q + 0.1); });
    bodyS.build(sc, true, true); restS.build(sc, true, true); this.spectators = nSpec;

    /* flags on poles: Swiss flags and canton colours at the start and the summit */
    const pole = new THREE.MeshStandardMaterial({ color: lin2(0xe2e4e8), roughness: 0.4, metalness: 0.6 }), poleG = new THREE.CylinderGeometry(0.045, 0.06, 6.5, 8);
    const fmat = {}; ['ch', 'gr', 'ur', 'blue', 'chk'].forEach((k) => { fmat[k] = new THREE.MeshStandardMaterial({ map: flagTex(k), side: THREE.DoubleSide, roughness: 0.85 }); });
    const flagAt = (i, s, d, kind) => {
      const sg = s ? 1 : -1, x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, t.hw + 0.6)) return;
      const y = this.heightAt(x, z), g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = -t.yaw[i] + rng.range(-0.3, 0.3);
      const p = new THREE.Mesh(poleG, pole); p.position.y = 3.25; p.castShadow = true; g.add(p);
      const fg = new THREE.PlaneGeometry(1.8, 1.2, 8, 2); fg.translate(0.9, 0, 0);
      const f = new THREE.Mesh(fg, fmat[kind]); f.position.set(0.05, 5.85, 0); f.castShadow = true; g.add(f); this.flags.push(f);
      sc.add(g); blds.push([x, z, 1]);
    };
    const kinds = ['ch', 'gr', 'ch', 'ur', 'ch', 'blue'];
    for (let k = 0; k < 6; k++) flagAt(sI - 14 + k * 9, k % 2, t.bar[k % 2][sI] + 2.2 + (t.barType[k % 2][sI] === 2 ? 0.6 + 0.06 * t.wallH[k % 2][sI] : 0), kinds[k]);
    for (let k = 0; k < 10; k++) { const i = fI - 60 + k * 9, s = k % 2; flagAt(i, s, t.bar[s][i] + 2.0 + (t.barType[s][i] === 2 ? 0.6 + 0.06 * t.wallH[s][i] : 0), k === 4 || k === 5 ? 'chk' : kinds[k % 6]); }

    /* tents (Kenney racing kit) beside the start and the summit */
    if (this.kenney) {
      const tent = (i, s, d, name, rot) => {
        const sg = s ? 1 : -1, x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, t.hw + 3)) return false;
        let lo = 1e9, hi = -1e9; for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const y = this.heightAt(x + ox, z + oz); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        if (hi - lo > 1.2) return false;
        this.kitPlace(name, x, lo, z, -t.yaw[i] + (rot || 0), 6.5, { tint: (m) => { if (m.name === 'red') m.color = lin2(0xd52b1e); m.roughness = 0.85; } }); blds.push([x, z, 4]); return true;
      };
      let nt = 0; for (let k = 0; k < 40 && nt < 3; k++) if (tent(sI - 20 + rng.int(0, 60), rng.int(0, 1), t.hw + rng.range(7, 14), rng.pick(['kenney/tentRoof', 'kenney/tentRoofDouble', 'kenney/tent']), Math.PI / 2)) nt++;
      nt = 0; for (let k = 0; k < 40 && nt < 3; k++) if (tent(fI + rng.int(-40, 30), rng.int(0, 1), t.hw + rng.range(7, 16), rng.pick(['kenney/tentRoof', 'kenney/tentRoofDouble', 'kenney/tent']), Math.PI / 2)) nt++;
    }

    /* cows on the alpine meadows (brown Swiss / spotted), small herds facing every which way, each with a bell */
    {
      const brown = new GeoBuilder(), white = new GeoBuilder();
      brown.add(roundedBox(1.55, 0.72, 0.62, 0.18, 2), M(0, 0.95, 0), 0xffffff);                 // body (tinted per cow)
      brown.add(roundedBox(0.46, 0.4, 0.34, 0.1, 2), M(0.98, 1.08, 0, 0, 0, -0.35), 0xffffff);      // head
      for (const [lx, lz] of [[0.55, 0.2], [0.55, -0.2], [-0.55, 0.2], [-0.55, -0.2]]) brown.add(roundedBox(0.17, 0.62, 0.17, 0.05, 1), M(lx, 0.32, lz), 0xffffff);
      white.add(roundedBox(0.2, 0.18, 0.3, 0.06, 1), M(1.2, 0.98, 0, 0, 0, -0.35), 0xe9e2d6);        // muzzle
      white.add(roundedBox(0.7, 0.4, 0.64, 0.12, 1), M(-0.2, 1.08, 0), 0xf2ede4);                  // white patch (spotted cows: visible, brown cows: tinted)
      for (const z of [-1, 1]) white.add(roundedBox(0.06, 0.16, 0.06, 0.02, 1), M(0.92, 1.33, z * 0.15, z * 0.5, 0, 0), 0xe8e2cf);   // horns
      white.add(roundedBox(0.12, 0.16, 0.12, 0.03, 1), M(0.86, 0.78, 0), 0xc9a43a);                 // bell
      for (const [lx, lz] of [[0.55, 0.2], [0.55, -0.2], [-0.55, 0.2], [-0.55, -0.2]]) white.add(roundedBox(0.19, 0.08, 0.19, 0.03, 1), M(lx, 0.04, lz), 0x2a2420);  // hooves
      white.add(roundedBox(0.06, 0.5, 0.06, 0.02, 1), M(-0.8, 0.85, 0, 0, 0, 0.25), 0x6b4a32);       // tail
      const bs = new W.Scatter(brown.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 1e6);
      const ws = new W.Scatter(white.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 1e6);
      const coats = ['#7a5236', '#8a5f3e', '#6b4630', '#a07850', '#4a3a30'];
      let nCow = 0;
      for (let herd = 0; herd < 60 && nCow < 70 * q + 10; herd++) {
        const i = rng.int(60, N - 60), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rng.range(14, 90);
        const hx = t.px[i] + t.nx[i] * sg * d, hz = t.pz[i] + t.nz[i] * sg * d;
        if (!roadClear(hx, hz, t.hw + 10)) continue; const hy = this.heightAt(hx, hz);
        if (Math.abs(this.heightAt(hx + 4, hz) - hy) + Math.abs(this.heightAt(hx, hz + 4) - hy) > 2.2) continue;
        if (blds.some((b) => (b[0] - hx) ** 2 + (b[1] - hz) ** 2 < (b[2] + 6) ** 2)) continue;
        const n = rng.int(2, 6); if (!this.cowPos) this.cowPos = [hx, hz];
        for (let k = 0; k < n; k++) {
          const x = hx + rng.range(-9, 9), z = hz + rng.range(-9, 9); if (!roadClear(x, z, t.hw + 8)) continue;
          const y = Math.min(this.heightAt(x + 0.8, z), this.heightAt(x - 0.8, z)), ry = rng() * 6.28, sc5 = rng.range(0.92, 1.08);
          bs.add(x, y - 0.05, z, ry, sc5, sc5, sc5, rng.pick(coats)); ws.add(x, y - 0.05, z, ry, sc5, sc5, sc5); nCow++;
          blds.push([x, z, 1.5]);
        }
      }
      bs.build(sc, true, true); ws.build(sc, true, true); this.cows = nCow;
    }

    /* numbered hairpin plaques (Swiss pass roads count their Kehren) */
    {
      let kn = 0; const tex = {};
      t.corners.forEach((c) => {
        if (c.radius > 30) return; kn++;
        const outS = c.dir > 0 ? 0 : 1, sg = outS ? 1 : -1, i = t.wr(c.apex - 22), d = t.bar[outS][i] + 0.7;
        const tx = W.canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1f4f9a'; g.lineWidth = 10; g.strokeRect(6, 6, w - 12, h - 12);
          g.fillStyle = '#1f4f9a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 64px "Helvetica Neue", Arial, sans-serif'; g.fillText(String(kn), w / 2, h / 2 + 4); });
        const gr = new THREE.Group(); gr.position.set(t.px[i] + t.nx[i] * sg * d, t.py[i], t.pz[i] + t.nz[i] * sg * d); gr.rotation.y = -t.yaw[i] + (outS ? 0 : Math.PI);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.5, side: THREE.DoubleSide })); pl.position.y = 1.6; pl.rotation.y = -Math.PI / 2; pl.castShadow = true; gr.add(pl);
        const po = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8), new THREE.MeshStandardMaterial({ color: lin2(0x9aa0a6), roughness: 0.5, metalness: 0.6 })); po.position.y = 0.8; gr.add(po);
        sc.add(gr);
      });
    }

    /* summit: the pass hotel (a big alp hut) beside the finish, and a summit cross on the highest rock nearby */
    if (AX.Assets.has('pass/hut')) {
      let placed = false;
      for (let k = 0; k < 400 && !placed; k++) {
        const i = fI + rng.int(-10, 40), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rng.range(14, 26);
        const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, t.hw + 12)) continue;
        let lo = 1e9, hi = -1e9; for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const y = this.heightAt(x + ox * 11, z + oz * 11); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        if (hi - lo > 4) continue;
        const ry = Math.atan2(-(t.pz[i] - z), t.px[i] - x);
        this.ms('pass/hut', { cell: 1e6 }).add(x, lo - 0.2, z, ry, 1.5); blds.push([x, z, 13]); placed = true;
      }
    }
    {
      // highest terrain point within ~120 m of the summit, off the road
      let best = null;
      for (let k = 0; k < 600; k++) {
        const a = rng() * 6.283, r = 25 + rng() * 100, x = t.px[fI] + Math.cos(a) * r, z = t.pz[fI] + Math.sin(a) * r;
        if (!roadClear(x, z, t.hw + 10)) continue; const y = this.heightAt(x, z); if (!best || y > best[2]) best = [x, z, y];
      }
      if (best) {
        const [x, z, y] = best, g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rng() * 6.28;
        const wood = new THREE.MeshStandardMaterial({ color: lin2(0x6e4a2e), roughness: 0.9 }), metal = new THREE.MeshStandardMaterial({ color: lin2(0xd8c27a), roughness: 0.35, metalness: 0.8 });
        const cross = new GeoBuilder(); cross.add(roundedBox(0.3, 5.2, 0.3, 0.05, 2), M(0, 2.6 + 1.2, 0), 0xffffff); cross.add(roundedBox(0.3, 0.3, 2.4, 0.05, 2), M(0, 4.3 + 1.2, 0), 0xffffff);
        const cm = new THREE.Mesh(cross.build(), wood); cm.castShadow = true; g.add(cm);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.2), metal); box.position.set(0.2, 2.8, 0); g.add(box);   // summit book box
        sc.add(g);
        if (AX.Assets.has('kaykit/Rock_3_M')) this.ms('kaykit/Rock_3_M', { tint: (m) => { m.roughness = 1; } }).add(x, y - 1.4, z, rng() * 6.28, 1.0, 0.9, '#d8d4cc');
        blds.push([x, z, 4]);
      }
    }
  };

  AX.World.prototype._buildPass = function () {
    const t = this.track, sc = this.scene, th = this.theme, N = t.n, w = t.hw, an = this.aniso, rng = AX.RNG(t.def.seed || 9);
    const q = this.q === 'low' ? 0.4 : this.q === 'medium' ? 0.7 : 1;
    // sky drawn behind everything (the mountains reach past the sky sphere)
    this.sky.material.depthTest = false; this.sky.renderOrder = -10; this.sky.scale.setScalar(0.5);
    sc.fog = new THREE.Fog(lin(th.fog), 260, 3600);
    const b = t.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const yMin = Math.min(...t.py), yMax = Math.max(...t.py);
    const KKpre = !!(AX.Assets && AX.Assets.has('kaykit/Tree_4_A'));
    const tree = KKpre ? yMax - 20 : yMax + 160;                       // treeline: the last stretch to the summit is open alpine meadow
    const nz2 = (x, z) => W.fbm(x * 0.01 + 31, z * 0.01 + 17, 0, 3);

    /* ---- terrain: fine grid around the road, coarse grid out to the mountains */
    const mat = (x, z, y, ny) => {
      const steep = smoothstep(0.8, 0.6, ny + (nz2(x * 3, z * 3) - 0.5) * 0.22);
      const snow = smoothstep(tree + 160, tree + 260, y + (nz2(x, z) - 0.5) * 80) * smoothstep(0.55, 0.75, ny);
      const alp = smoothstep(tree - 40, tree + 80, y);
      return [Math.max(steep, alp * smoothstep(0.92, 0.8, ny)), snow, Math.max(alp * 0.6, smoothstep(0.45, 0.75, nz2(x * 2.2, z * 2.2)) * 0.25)];
    };
    const KK = !!(AX.Assets && AX.Assets.has('kaykit/Tree_4_A'));          // KayKit vegetation present -> Art-of-Rally look
    const G_MID = C3(84, 126, 60), G_LT = C3(112, 148, 70), G_DRY = C3(146, 148, 86), G_FOR = C3(56, 92, 46), G_ALP = C3(112, 138, 72);
    const tint = KK ? (x, z, y) => {
      const n1 = nz2(x * 0.55 + 7, z * 0.55 + 3), n2 = nz2(x * 2.5, z * 2.5), n3 = nz2(x * 1.3 + 40, z * 1.3 - 11);
      let c = mix3(G_MID, G_LT, smoothstep(0.42, 0.72, n1));
      c = mix3(c, G_DRY, smoothstep(0.62, 0.8, n3) * 0.6);
      c = mix3(c, G_FOR, smoothstep(0.36, 0.5, n2) * 0.75);                 // darker floor where the forest stands
      return mix3(c, G_ALP, smoothstep(tree - 40, tree + 60, y) * 0.7);
    } : (x, z, y) => { const k = 0.82 + nz2(x * 1.7, z * 1.7) * 0.35, d = smoothstep(yMax - 20, tree + 40, y) * 0.25; return [k * (1 + d * 0.3), k * (1 - d * 0.1), k * (1 - d * 0.4)]; };
    const M0 = 110, gx0 = b.minX - M0, gz0 = b.minZ - M0, gx1 = b.maxX + M0, gz1 = b.maxZ + M0;
    const fineStep = this.q === 'low' ? 3 : 2.2;
    const self = this, roadSide = (x, z) => { const i = t.nearest(x, z, -1); return [i, t.lateral(i, x, z)]; };
    // terrain right behind a retaining wall sits on the wall top, in front of it at shoulder height
    const hFine = (x, z) => { const h = t.terrainH(x, z); return t.lastRoadD < 8.6 ? h - 5 : h; };
    const tm = KK ? rallyTerrainMaterial() : PK ? terrainMaterial(ptex('meadow', 'a', an), ptex('rock', 'a', an), ptex('scree', 'a', an), { grass: ptex('meadow', 'n', an), rock: ptex('rock', 'n', an), scree: ptex('scree', 'n', an) })
      : terrainMaterial(meadowTex(an), rockTex(an), gravelTex2(an)); this.terrainMat = tm;
    const fine = gridMesh(gx0, gz0, gx1, gz1, fineStep, hFine, mat, tint);
    // baked ambient occlusion: how much of the sky each terrain vertex can see (valleys, gullies and the foot of slopes get darker)
    const aoStep = 4.4, ax0 = gx0 - 40, az0 = gz0 - 40, anx = Math.ceil((gx1 - gx0 + 80) / aoStep) + 1, anz = Math.ceil((gz1 - gz0 + 80) / aoStep) + 1, AH = new Float32Array(anx * anz);
    for (let j = 0; j < anz; j++) for (let i = 0; i < anx; i++) AH[j * anx + i] = t.terrainH(ax0 + i * aoStep, az0 + j * aoStep);
    const ah = (x, z) => { const fx = clamp((x - ax0) / aoStep, 0, anx - 1.001), fz = clamp((z - az0) / aoStep, 0, anz - 1.001), i = Math.floor(fx), j = Math.floor(fz), a = fx - i, c = fz - j, k = j * anx + i;
      return (AH[k] * (1 - a) + AH[k + 1] * a) * (1 - c) + (AH[k + anx] * (1 - a) + AH[k + anx + 1] * a) * c; };
    const DIRS = [...Array(8)].map((_, k) => [Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]);
    const bakeAO = (g) => {
      const P = g.attributes.position.array, C = g.attributes.color.array;
      for (let v = 0; v < P.length / 3; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; let occ = 0;
        for (const [dx, dz] of DIRS) { let m = 0; for (const r of [6, 14, 30]) m = Math.max(m, (ah(x + dx * r, z + dz * r) - y) / r); occ += clamp(m, 0, 1.2); }
        const ao = 1 - 0.42 * clamp(occ / 8 * 1.4, 0, 1);
        C[v * 3] *= ao; C[v * 3 + 1] *= ao; C[v * 3 + 2] *= ao * 1.02;
      }
      g.attributes.color.needsUpdate = true;
    };
    if (KK) bakeAO(fine);
    const fm = new THREE.Mesh(fine, tm); fm.receiveShadow = true; sc.add(fm); this.terrainFine = fine.userData;
    // skirt so the coarse ring never shows through the seam
    const R1 = 1700, coarse = gridMesh(cx - R1, cz - R1, cx + R1, cz + R1, 28, (x, z) => t.terrainH(x, z), mat, tint,
      (x, z) => (x > gx0 + 3 && x < gx1 - 3 && z > gz0 + 3 && z < gz1 - 3 ? -8 : 0));
    const tmC = tm.clone(); tmC.onBeforeCompile = tm.onBeforeCompile; tmC.customProgramCacheKey = tm.customProgramCacheKey; tmC.polygonOffset = true; tmC.polygonOffsetFactor = 2; tmC.polygonOffsetUnits = 4;
    const cm = new THREE.Mesh(coarse, tmC); cm.receiveShadow = true; sc.add(cm);
    /* ---- corridor strip: high-resolution terrain along both sides of the road, joined to wall tops / road shoulders */
    {
      const P = [], UV = [], MAT = [], C = [], idx = []; const lats = [0, 0.6, 1.6, 3, 4.8, 7, 9.5, 12.5];
      const NC = lats.length; this.strip = [0, 1].map(() => ({ lat: new Float32Array(N * NC), y: new Float32Array(N * NC), nc: NC }));
      for (const s of [0, 1]) {
        const sg = s ? 1 : -1, cols = lats.length, base0 = P.length / 3;
        for (let i = 0; i < N; i++) {
          const wall = t.barType[s][i] === 2, wh = t.wallH[s][i], bar = t.bar[s][i];
          const start = wall ? bar + 0.06 * wh + 0.55 : bar + 0.05, h0 = wall ? t.py[i] + wh + 0.06 : t.py[i] - 0.06;
          // limit the strip on the inside of tight bends and where another part of the road is close
          const tight = Math.abs(t.lk[i]) > 1e-4 && (t.lk[i] > 0) === (s === 1) ? 0.8 / Math.abs(t.lk[i]) : 99;
          const other = t._otherDist(t.px[i] + t.nx[i] * sg * (bar + 6), t.pz[i] + t.nz[i] * sg * (bar + 6), i, 60);
          const span = clamp(Math.min(12.5, tight - start, other * 0.5 + 2), 9.6 - start, 12.5);
          for (let k = 0; k < cols; k++) {
            const lat = start + lats[k] / 12.5 * span, x = t.px[i] + t.nx[i] * sg * lat, z = t.pz[i] + t.nz[i] * sg * lat;
            const nat = t.terrainH(x, z), f = smoothstep(0, 0.55, lats[k] / 12.5);
            let y = k === 0 ? h0 : lerp(h0, nat, f);
            if (wall && k > 0) y = Math.max(y, h0 + (nat - h0) * f);
            if (!wall && k === 1) y = Math.min(y, h0 - 0.15);
            P.push(x, y, z); UV.push(x / 7, z / 7); this.strip[s].lat[i * cols + k] = lat; this.strip[s].y[i * cols + k] = y;
            const m = mat(x, z, y, 0.9), tn = tint(x, z, y); MAT.push(k === 0 && !wall ? 0.0 : m[0], m[1], k <= 1 && !wall ? 0.5 : m[2]); C.push(tn[0], tn[1], tn[2]);
          }
          if (i > 0) for (let k = 0; k < cols - 1; k++) {
            const a = base0 + (i - 1) * cols + k, b2 = base0 + i * cols + k;
            if (s) idx.push(a, a + 1, b2, a + 1, b2 + 1, b2); else idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
          }
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.setAttribute('aMat', new THREE.Float32BufferAttribute(MAT, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(idx); g.computeVertexNormals();
      // steep bits of the strip (embankments, cuttings) get scree / rock from their real normals
      const Nn = g.attributes.normal.array, Ma = g.attributes.aMat.array;
      for (let k = 0; k < Nn.length / 3; k++) { const ny = Nn[k * 3 + 1]; Ma[k * 3] = Math.max(Ma[k * 3], smoothstep(0.74, 0.55, ny)); Ma[k * 3 + 2] = Math.max(Ma[k * 3 + 2], smoothstep(0.88, 0.7, ny) * 0.6); }
      // drawn slightly in front of the regular terrain: where both lie at the same height the strip wins instead of flickering
      const tmS = tm.clone(); tmS.onBeforeCompile = tm.onBeforeCompile; tmS.customProgramCacheKey = tm.customProgramCacheKey; tmS.polygonOffset = true; tmS.polygonOffsetFactor = -1; tmS.polygonOffsetUnits = -2;
      if (KK) bakeAO(g);
      const cm2 = new THREE.Mesh(g, tmS); cm2.receiveShadow = true; sc.add(cm2); this.corridor = g; this.corridorMesh = cm2;
    }
    // ground height as rendered: corridor strip next to the road, fine grid further out (props must sit on what you see)
    const stripAt = (i, x, z) => {
      const lat = t.lateral(i, x, z), sd = lat >= 0 ? 1 : 0, a = Math.abs(lat), S = this.strip[sd], nc = S.nc, o = i * nc;
      if (a < S.lat[o] || a > S.lat[o + nc - 1]) return null;
      for (let k = 0; k < nc - 1; k++) if (a <= S.lat[o + k + 1]) { const f = (a - S.lat[o + k]) / Math.max(1e-4, S.lat[o + k + 1] - S.lat[o + k]); return S.y[o + k] + (S.y[o + k + 1] - S.y[o + k]) * f; }
      return null;
    };
    const gridAt = (x, z) => {
      const u = this.terrainFine; const fx = (x - u.x0) / u.step, fz = (z - u.z0) / u.step;
      if (fx < 0 || fz < 0 || fx >= u.nx - 1 || fz >= u.nz - 1) return t.terrainH(x, z);
      const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, c = fz - j, H = u.H, k = j * u.nx + i;
      return (H[k] * (1 - a) + H[k + 1] * a) * (1 - c) + (H[k + u.nx] * (1 - a) + H[k + u.nx + 1] * a) * c;
    };
    this.heightAt = (x, z) => {
      const hh = t.terrainH(x, z), d = t.lastRoadD;
      if (d < 22) {
        const i = t.nearest(x, z, -1);
        // blend the two strip rows around the point
        const j = Math.min(N - 1, Math.max(0, i + (((x - t.px[i]) * (t.px[Math.min(N - 1, i + 1)] - t.px[i]) + (z - t.pz[i]) * (t.pz[Math.min(N - 1, i + 1)] - t.pz[i])) >= 0 ? 1 : -1)));
        const yi = stripAt(i, x, z);
        if (yi != null) {
          const yj = stripAt(j, x, z); if (yj == null) return yi;
          const dx = t.px[j] - t.px[i], dz = t.pz[j] - t.pz[i], L2 = dx * dx + dz * dz || 1, f = clamp(((x - t.px[i]) * dx + (z - t.pz[i]) * dz) / L2, 0, 1);
          return yi + (yj - yi) * f;
        }
        if (d < 8.6) return hh;
      }
      return gridAt(x, z);
    };

    /* ---- far peaks */
    if (KK) {
      // Art-of-Rally style backdrop: faceted ridged peaks, forest at the foot, snow fields on the gentler high faces, baked blue haze
      const NA = 440, NR = 34, P = [], idx = [], base = t.planeH(cx, cz) + 40, rr = [];
      for (let r = 0; r < NR; r++) {
        const rad = 1500 + Math.pow(r / (NR - 1), 1.25) * 4200; rr.push(rad);
        for (let a = 0; a < NA; a++) {
          const ang = a / NA * Math.PI * 2, x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
          const r1 = AX.trackUtil.ridge(x * 0.0007, z * 0.0007), r2 = AX.trackUtil.ridge(x * 0.0022 + 5, z * 0.0022 + 9);
          const amp = smoothstep(1650, 2900, rad) * (900 + 700 * smoothstep(2500, 5000, rad));
          const hh = base + (Math.pow(r1, 2.1) * 0.78 + Math.pow(r2, 2.0) * 0.22) * amp + (t.terrainH(x, z) - base) * (1 - smoothstep(1500, 2050, rad));
          // inside the square of the coarse terrain the backdrop sinks away, so the two never lie in the same plane (no flicker)
          const inside = Math.max(Math.abs(x - cx), Math.abs(z - cz)) < 1712;
          P.push(x, inside ? hh - 40 : hh, z);
        }
      }
      for (let r = 0; r < NR - 1; r++) for (let a = 0; a < NA; a++) { const p = r * NA + a, q2 = r * NA + (a + 1) % NA; idx.push(p, q2, p + NA, q2, q2 + NA, p + NA); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals();
      const Nn = g.attributes.normal.array, C = new Float32Array(P.length);
      const forest = lin(0x35553a), meadow = lin(0x6f8f4c), rock = lin(0x8d8f93), rockD = lin(0x6b6e75), snow = lin(0xf2f5fa), haze = lin(th.fog), col = new THREE.Color();
      for (let k = 0; k < P.length / 3; k++) {
        const r = Math.floor(k / NA), a = k % NA, y = P[k * 3 + 1] - base, ny = Nn[k * 3 + 1], j = W.hash2(a, r);
        if (y > 620 + j * 260 && ny > 0.55) col.copy(snow);
        else if (y > 260 + j * 120) col.copy(rock).lerp(rockD, smoothstep(0.75, 0.45, ny));
        else if (y > 120 + j * 80) col.copy(meadow).lerp(rock, 0.3);
        else col.copy(forest);
        col.lerp(haze, smoothstep(1700, 5800, rr[r]) * 0.72);
        C[k * 3] = col.r; C[k * 3 + 1] = col.g; C[k * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: false })); sc.add(m);
    } else {
      const P = [], C = [], idx = [], NA = 200, NR = 22; const rock = lin(0x7c7a76), snow = lin(0xf3f5f9), green = lin(0x4d7a3c);
      for (let r = 0; r < NR; r++) {
        const rad = 1550 + Math.pow(r / (NR - 1), 1.3) * 3600;
        for (let a = 0; a < NA; a++) {
          const ang = a / NA * Math.PI * 2, x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
          const rid = AX.trackUtil.ridge(x * 0.0009, z * 0.0009), base = t.planeH(cx, cz) + 40;
          const hh = base + Math.pow(rid, 1.8) * rad * 0.32 * smoothstep(1700, 2600, rad) + (t.terrainH(x, z) - base) * (1 - smoothstep(1550, 2100, rad));
          P.push(x, hh, z);
          const rel = hh - base, c = rel > 900 + (W.hash2(a, r) - 0.5) * 200 ? snow : rel > 300 ? rock : green; C.push(c.r, c.g, c.b);
        }
      }
      for (let r = 0; r < NR - 1; r++) for (let a = 0; a < NA; a++) { const p = r * NA + a, q2 = r * NA + (a + 1) % NA; idx.push(p, q2, p + NA, q2, q2 + NA, p + NA); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); sc.add(m);
    }

    /* ---- clouds: low-poly puffs drifting around the peaks and over the valley */
    if (KK) {
      const puff = new THREE.IcosahedronGeometry(1, 1), cg = new GeoBuilder();
      const cloud = (n, rng2) => { const gb = new GeoBuilder(); for (let k = 0; k < n; k++) { const r = 0.55 + rng2() * 0.7; gb.add(puff, M((k - n / 2) * 0.9 + rng2() * 0.5, rng2() * 0.35 * r, (rng2() - 0.5) * 1.2, 0, rng2() * 3, 0, r * 1.3, r * 0.9, r), 0xffffff); } return gb.build(); };
      const cmat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: lin(0x9fb3c8), emissiveIntensity: 0.35, fog: false });
      const shapes = [cloud(5, rng), cloud(7, rng), cloud(4, rng)];
      // darker undersides
      for (const g of shapes) { const P = g.attributes.position.array, C = g.attributes.color.array; for (let v = 0; v < P.length / 3; v++) { const k = 0.78 + 0.22 * clamp(P[v * 3 + 1] + 0.4, 0, 1); C[v * 3] *= k; C[v * 3 + 1] *= k; C[v * 3 + 2] *= k * 1.03; } }
      this.clouds = new THREE.Group(); this.clouds.position.set(cx, 0, cz); sc.add(this.clouds);
      for (let k = 0; k < 34; k++) {
        const a = rng() * 6.283, rad = 1700 + rng() * 2800, sz = 45 + rng() * 80;
        const m = new THREE.Mesh(shapes[k % 3], cmat); m.position.set(Math.cos(a) * rad, yMax + 520 + rng() * 650, Math.sin(a) * rad); m.scale.set(sz, sz * 0.75, sz); m.rotation.y = rng() * 6.28;
        this.clouds.add(m);
      }
    }

    /* ---- road */
    const roadMat = KK ? new THREE.MeshStandardMaterial({ map: W.pixelTex(256, (u, v) => { const k = (W.fbm(u * 3, v * 3, 3, 3) - 0.5) * 9; return [86 + k, 88 + k, 94 + k]; }, null, an), roughness: 0.82 })
      : PK ? new THREE.MeshStandardMaterial({ map: ptex('asphalt', 'a', an), normalMap: ptex('asphalt', 'n', an), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.86 })
      : new THREE.MeshStandardMaterial({ map: W.asphaltTex(th.asphalt, an), roughness: 0.9 });
    sc.add(Object.assign(new THREE.Mesh(rib(t, () => -w, () => w, { yA: () => 0.02, vLen: w * 2 }), roadMat), { receiveShadow: true }));
    const shoulder = KK ? new THREE.MeshStandardMaterial({ map: W.pixelTex(128, (u, v) => { const k = (W.fbm(u * 4, v * 4, 4, 3) - 0.5) * 18; return [176 + k, 164 + k, 138 + k]; }, null, an), roughness: 1 })
      : PK ? new THREE.MeshStandardMaterial({ map: ptex('gravel', 'a', an), normalMap: ptex('gravel', 'n', an), roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: gravelTex2(an), roughness: 1 });
    for (const sg of [-1, 1]) {
      const s = sg > 0 ? 1 : 0;
      sc.add(Object.assign(new THREE.Mesh(rib(t, (i) => sg * w, (i) => sg * (t.bar[s][i] + 0.05), { yA: () => 0.0, yB: () => -0.05, vLen: 3, uRep: 0.4 }), shoulder), { receiveShadow: true }));
    }
    const paint = new THREE.MeshStandardMaterial({ color: lin(0xf0efe8), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const sg of [-1, 1]) sc.add(Object.assign(new THREE.Mesh(rib(t, () => sg * (w - 0.38), () => sg * (w - 0.2), { yA: () => 0.026 }), paint), { receiveShadow: true }));
    const dm = new THREE.MeshStandardMaterial({ map: dashTex(), transparent: true, alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    sc.add(Object.assign(new THREE.Mesh(rib(t, () => -0.07, () => 0.07, { yA: () => 0.026, vLen: 9 }), dm), { receiveShadow: true }));
    // rubbered line + darker patches in the hairpins
    const lineA = (i) => 0.18 + 0.32 * clamp(Math.abs(t.lk[i]) * 40, 0, 1);
    const rub = new THREE.Mesh(rib(t, (i) => clamp(t.ld[i] - 1.6, -w + 0.4, w - 0.4), (i) => clamp(t.ld[i] + 1.6, -w + 0.4, w - 0.4), { yA: () => 0.024, alpha: lineA }), W.decalMaterial(W.canvasTex(64, 8, (g, cw, ch) => { const gr = g.createLinearGradient(0, 0, cw, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, cw, ch); }), new THREE.Color(0x101012), -1));
    rub.renderOrder = 1; sc.add(rub);

    /* ---- dry-stone retaining walls on the hill side */
    if (PK) this._passWalls(); else {
      const stone = new THREE.MeshStandardMaterial({ map: stoneTex(an), color: lin(0xd2cdc3), roughness: 0.93, side: THREE.DoubleSide });
      const cap = new THREE.MeshStandardMaterial({ map: W.concreteTex(), color: lin(0xb9b4a9), roughness: 0.9, side: THREE.DoubleSide });
      for (const s of [0, 1]) {
        const isW = (i) => t.barType[s][i] === 2;
        const wallFace = sweep(t, s, [[(i) => t.bar[s][i], () => -0.45, () => 0], [(i) => t.bar[s][i] + 0.06 * t.wallH[s][i], (i) => t.wallH[s][i], (i) => (t.wallH[s][i] + 0.45) / 1.6]], isW, 1.6);
        sc.add(Object.assign(new THREE.Mesh(wallFace, stone), { castShadow: true, receiveShadow: true }));
        const top = sweep(t, s, [[(i) => t.bar[s][i] + 0.06 * t.wallH[s][i] - 0.05, (i) => t.wallH[s][i] + 0.02], [(i) => t.bar[s][i] + 0.06 * t.wallH[s][i] + 0.55, (i) => t.wallH[s][i] + 0.06]], isW, 2);
        sc.add(Object.assign(new THREE.Mesh(top, cap), { castShadow: true, receiveShadow: true }));
      }
    }

    /* ---- W-beam guardrails + posts on the valley side */
    const galv = new THREE.MeshStandardMaterial({ color: lin(0xb5bac0), roughness: 0.35, metalness: 0.75, envMap: this.env, envMapIntensity: 0.9, side: THREE.DoubleSide });
    const postGeo = (() => { const gb = new GeoBuilder(); gb.add(new THREE.BoxGeometry(0.1, 1.15, 0.14), M(0, 0.2, 0), 0xa9aeb4); gb.add(new THREE.BoxGeometry(0.04, 0.32, 0.18), M(0.07, 0.62, 0), 0x8f949a); const g = gb.build(); g.computeBoundingSphere(); return g; })();
    const posts = new W.Scatter(postGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }), 1e6);
    const profile = [[0.0, 0.52], [0.07, 0.56], [0.03, 0.645], [0.08, 0.71], [0.03, 0.775], [0.07, 0.86], [0.0, 0.9]];
    for (const s of [0, 1]) {
      const isR = (i) => t.barType[s][i] !== 2 && i > 6 && i < N - 6;
      const prof = profile.map(([dl, h]) => [(i) => t.bar[s][i] - 0.1 - dl, () => h]);
      sc.add(Object.assign(new THREE.Mesh(sweep(t, s, prof, isR, 4), galv), { castShadow: true, receiveShadow: true }));
      const sg = s ? 1 : -1;
      for (let i = 8; i < N - 8; i += 4) if (isR(i)) posts.add(t.px[i] + t.nx[i] * sg * (t.bar[s][i] + 0.02), t.py[i] - 0.45, t.pz[i] + t.nz[i] * sg * (t.bar[s][i] + 0.02), -t.yaw[i] + (s ? 0 : Math.PI));
    }
    posts.build(sc, true, true);

    /* ---- snow poles (orange/black) along the valley side, chevrons in the hairpins */
    const poleGeo = (() => { const gb = new GeoBuilder(); for (let k = 0; k < 6; k++) gb.add(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6), M(0, 0.16 + k * 0.32, 0), k % 2 ? 0x17181b : 0xf2701e); const g = gb.build(); g.computeBoundingSphere(); return g; })();
    const poles = new W.Scatter(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 1e6);
    for (let i = 12; i < N - 12; i += 24) for (const s of [0, 1]) {
      if (t.barType[s][i] === 2) continue; const sg = s ? 1 : -1, d = t.bar[s][i] + 0.7;
      poles.add(t.px[i] + t.nx[i] * sg * d, t.py[i] - 0.3, t.pz[i] + t.nz[i] * sg * d, 0);
    }
    poles.build(sc, true, false);
    const chev = new THREE.MeshStandardMaterial({ map: chevronTex(), roughness: 0.5, side: THREE.DoubleSide });
    const signPost = new THREE.MeshStandardMaterial({ color: lin(0x9aa0a6), roughness: 0.5, metalness: 0.6 });
    t.corners.forEach((c) => {
      if (c.radius > 30) return; const outS = c.dir > 0 ? 0 : 1, sg = outS ? 1 : -1;
      for (const o of [-10, 0, 10]) {
        const i = t.wr(c.apex + o), d = t.bar[outS][i] + 0.6, g = new THREE.Group();
        g.position.set(t.px[i] + t.nx[i] * sg * d, t.py[i], t.pz[i] + t.nz[i] * sg * d); g.rotation.y = -t.yaw[i] + (outS ? 0 : Math.PI);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), chev); pl.position.y = 1.35; pl.scale.x = c.dir > 0 ? 1 : -1; pl.castShadow = true; g.add(pl);
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.2, 0.07), signPost); p.position.y = 0.6; p.castShadow = true; g.add(p); sc.add(g);
      }
    });

    /* ---- start gantry with lights, finish arch, summit sign */
    const gate = (i, isStart) => {
      const f = new THREE.Group(); f.position.set(t.px[i], t.py[i], t.pz[i]); f.rotation.y = -t.yaw[i]; const gb = new GeoBuilder(), span = w + 1.6;
      for (const z of [-span, span]) gb.add(roundedBox(0.4, 5.6, 0.4, 0.06, 2), M(0, 2.8, z), 0x2a2d33);
      gb.add(roundedBox(0.5, 1.1, span * 2 + 0.4, 0.08, 2), M(0, 5.4, 0), 0x22252a);
      const m = new THREE.Mesh(gb.build(), this.vcol(0.6, 0.2)); m.castShadow = true; f.add(m);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 0.6, 0.9), new THREE.MeshBasicMaterial({ map: W.textTex(isStart ? 'START' : 'ZIEL · FINISH', isStart ? '#d4202a' : '#141518', '#ffffff', 1024, 128), side: THREE.DoubleSide }));
      banner.position.set(-0.27, 5.4, 0); banner.rotation.y = -Math.PI / 2; f.add(banner);
      if (isStart) for (let k = 0; k < 5; k++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0x220806 })); l.position.set(-0.3, 4.55, (k - 2) * 0.8); f.add(l); this.startLights.push(l); }
      sc.add(f);
      const chk = W.canvasTex(256, 32, (g) => { for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#f4f4f0' : '#141518'; g.fillRect(x * 8, y * 8, 8, 8); } });
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.2), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      line.rotation.x = -Math.PI / 2; const lg = new THREE.Group(); lg.position.set(t.px[i], t.py[i] + 0.03, t.pz[i]); lg.rotation.y = -t.yaw[i] + Math.PI / 2; lg.add(line); line.receiveShadow = true; sc.add(lg);
    };
    gate(t.startIdx, true); gate(t.finishIdx, false);
    {
      const i = t.finishIdx + 40, s = t.barType[1][i] === 2 ? 0 : 1, sg = s ? 1 : -1, d = t.bar[s][i] + 1.2, g = new THREE.Group();
      g.position.set(t.px[i] + t.nx[i] * sg * d, t.py[i], t.pz[i] + t.nz[i] * sg * d); g.rotation.y = -t.yaw[i] + Math.PI / 2;
      const alt = Math.round(1800 + (t.py[t.finishIdx] - t.py[0]) * 3.6);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ map: signTex(['Schwarzhornpass', alt + ' m ü. M.']), roughness: 0.5, side: THREE.DoubleSide }));
      sign.position.y = 2.4; sign.castShadow = true; g.add(sign);
      for (const x of [-1.0, 1.0]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), signPost); p.position.set(x, 1.2, -0.03); g.add(p); }
      sc.add(g);
    }

    const roadClear = (x, z, m) => { t.terrainH(x, z); return t.lastRoadD > m; };
    /* ---- alp huts and hay barns (modelled + texture-baked in Blender, tools/blender_props.py) */
    const blds = []; this.buildings = blds;
    const nearBld = (x, z, r) => blds.some((b) => (b[0] - x) * (b[0] - x) + (b[1] - z) * (b[1] - z) < (b[2] + r) * (b[2] + r));
    if (AX.Assets && AX.Assets.has('pass/hut')) {
      const want = { 'pass/hut': Math.round(7 * Math.max(q, 0.6)), 'pass/barn': Math.round(16 * Math.max(q, 0.6)) }, rad = { 'pass/hut': 8, 'pass/barn': 4.6 };
      for (const name of ['pass/hut', 'pass/barn']) {
        let placed = 0;
        for (let n = 0; n < 4000 && placed < want[name]; n++) {
          const i = rng.int(30, N - 30), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rad[name] + rng.range(4, name === 'pass/hut' ? 26 : 60);
          const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d;
          if (!roadClear(x, z, w + rad[name] + 3)) continue; if (nearBld(x, z, rad[name] + 6)) continue;
          // flat enough footprint, below the tree line
          let lo = 1e9, hi = -1e9; for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const y = this.heightAt(x + ox * rad[name], z + oz * rad[name]); lo = Math.min(lo, y); hi = Math.max(hi, y); if (t.lastRoadD < w + 3) hi = 1e9; }
          if (hi - lo > (name === 'pass/hut' ? 2.6 : 1.8) || lo > tree - 20) continue;
          // face the road
          const ry = Math.atan2(-(t.pz[i] - z), t.px[i] - x) + rng.range(-0.25, 0.25);
          this.ms(name, { cell: 1e6 }).add(x, lo - 0.15, z, ry, name === 'pass/hut' ? 1 : rng.range(0.9, 1.1));
          blds.push([x, z, rad[name]]); placed++;
        }
      }
    }

    /* ---- race day: spectators along the barriers at the start and the last stretch, flags, tents, summit hotel and summit cross */
    if (KK) this._passEvent(blds, roadClear, rng, q);

    /* ---- forest (nature-kit pines near the road, cheap cones further out), boulders, grass tufts */
    const kit = this.kits, pines = [1, 2, 3, 4, 5].map((k) => 'nature/Pine_' + k);
    const tintPine = (mat) => { if (/^Lea/.test(mat.name)) { mat.color = lin(th.pine); mat.roughness = 1; mat.emissive = lin(th.pine).multiplyScalar(0.28); mat.emissiveMap = mat.map;
      mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;', '')); }; mat.customProgramCacheKey = () => 'apex-foliage'; } };
    const hsl = (h, s, l) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
    let nTrees = 0;
    if (KK) {
      /* ---- KayKit vegetation (Art-of-Rally look): firs in clumps, boulders, rock outcrops on the steep bits, grass clumps along the verges */
      const kt = (mat) => { mat.roughness = 1; mat.metalness = 0; };
      // shorten the bare trunk below the lowest branches (the KayKit firs stand on tall stilts otherwise)
      for (const nm of ['kaykit/Tree_4_A', 'kaykit/Tree_4_B', 'kaykit/Tree_4_C']) {
        const md = AX.Assets.get(nm); if (!md || md._squashed) continue; md._squashed = true;
        for (const p of md.parts) {
          const P = p.geometry.attributes.position, U = p.geometry.attributes.uv; if (!U) continue;
          let c0 = 1e9; for (let k = 0; k < P.count; k++) if (U.getY(k) < 0.25) c0 = Math.min(c0, P.getY(k));
          const lift = c0 * 0.55;
          for (let k = 0; k < P.count; k++) { const y = P.getY(k); P.setY(k, y < c0 ? y * 0.45 : y - lift); }
          P.needsUpdate = true; p.geometry.computeBoundingBox(); p.geometry.computeBoundingSphere();
        }
        md.box.max.y -= 0; // footprint unchanged
      }
      const firs = ['kaykit/Tree_4_A', 'kaykit/Tree_4_B', 'kaykit/Tree_4_B', 'kaykit/Tree_4_C', 'kaykit/Tree_4_C'];
      const firTint = () => hsl(0.33 + rng.range(-0.04, 0.03), rng.range(0.12, 0.35), rng.range(0.62, 0.86));
      for (let n = 0; n < 16000 * q && nTrees < 1300 * q; n++) {
        const i0 = rng.int(0, N - 1), s0 = rng.int(0, 1), sg0 = s0 ? 1 : -1, d0 = t.bar[s0][i0] + 1.5 + Math.pow(rng(), 1.3) * 48;
        const x = t.px[i0] + t.nx[i0] * sg0 * d0, z = t.pz[i0] + t.nz[i0] * sg0 * d0; const y = this.heightAt(x, z); const d = t.lastRoadD;
        if (!(d > w + 3.2)) continue; if (y > tree) continue; if (nearBld(x, z, 3)) continue;
        if (nz2(x * 2.5, z * 2.5) < 0.38 + smoothstep(tree - 120, tree, y) * 0.3) continue;
        const ny = Math.abs(this.heightAt(x + 1.5, z) - y) + Math.abs(this.heightAt(x, z + 1.5) - y); if (ny > 1.8) continue;
        const nm = firs[rng.int(0, firs.length - 1)], big = /Tree_4/.test(nm) ? rng.range(1.25, 2.1) : rng.range(1.3, 1.9);
        const ym = Math.min(y, this.heightAt(x + 0.7, z), this.heightAt(x - 0.7, z), this.heightAt(x, z + 0.7), this.heightAt(x, z - 0.7));
        this.ms(nm, { tint: kt, cell: 220 }).add(x, ym - 0.15, z, rng() * 6.28, big, big * rng.range(0.95, 1.15), firTint());
        nTrees++;
      }
      // above the tree line: dwarf firs, juniper-like bushes, grass clumps and loose rocks so the alpine meadow is not bare
      {
        const dw = ['kaykit/Tree_4_A', 'kaykit/Tree_4_B'], bu2 = ['kaykit/Bush_4_B', 'kaykit/Bush_4_C', 'kaykit/Bush_1_C'], gr2 = ['kaykit/Grass_1_B', 'kaykit/Grass_2_B', 'kaykit/Grass_1_C'], rk2 = ['kaykit/Rock_3_E', 'kaykit/Rock_3_G', 'kaykit/Rock_1_G', 'kaykit/Rock_3_J'];
        for (let n = 0; n < 4500 * q; n++) {
          const i = rng.int(10, N - 10), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + 1.5 + Math.pow(rng(), 1.5) * 70;
          const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; const y = this.heightAt(x, z);
          if (y < tree - 60 || !roadClear(x, z, t.hw + 2.0) || nearBld(x, z, 1.5)) continue;
          const r = rng(), ym = Math.min(y, this.heightAt(x + 0.6, z), this.heightAt(x - 0.6, z), this.heightAt(x, z + 0.6), this.heightAt(x, z - 0.6));
          if (r < 0.05 && y < tree + 30) { const sc4 = rng.range(0.55, 0.95); this.ms(dw[rng.int(0, 1)], { tint: kt, cell: 220 }).add(x, ym - 0.1, z, rng() * 6.28, sc4, sc4 * rng.range(0.8, 1), firTint()); }
          else if (r < 0.22) this.ms(bu2[rng.int(0, 2)], { tint: kt }).add(x, ym - 0.1, z, rng() * 6.28, rng.range(0.6, 1.2), null, hsl(0.28, rng.range(0.2, 0.4), rng.range(0.55, 0.75)));
          else if (r < 0.35) this.ms(rk2[rng.int(0, 3)], { tint: kt }).add(x, ym - 0.2, z, rng() * 6.28, rng.range(0.4, 1.0), null, hsl(0.09, 0.05, rng.range(0.8, 0.95)));
          else this.ms(gr2[rng.int(0, 2)], { tint: kt, cast: false }).add(x, ym - 0.05, z, rng() * 6.28, rng.range(0.8, 1.4), null, hsl(0.2 + rng.range(-0.03, 0.04), rng.range(0.3, 0.5), rng.range(0.75, 0.92)));
        }
      }
      // a few dead snags near the tree line
      for (let n = 0; n < 20 * q; n++) {
        const i = rng.int(20, N - 20), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rng.range(4, 30);
        const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, w + 3) || nearBld(x, z, 3)) continue;
        const y = this.heightAt(x, z); if (y < tree - 150) continue;
        this.ms(rng() < 0.5 ? 'kaykit/Tree_Bare_2_B' : 'kaykit/Tree_Bare_2_C', { tint: kt }).add(x, y - 0.2, z, rng() * 6.28, rng.range(1.2, 1.8), null, hsl(0.07, 0.15, 0.75));
      }
      // boulders scattered along the road
      const bould = ['kaykit/Rock_1_G', 'kaykit/Rock_1_H', 'kaykit/Rock_1_J', 'kaykit/Rock_1_K', 'kaykit/Rock_3_E', 'kaykit/Rock_3_G', 'kaykit/Rock_3_J', 'kaykit/Rock_3_K'];
      for (let n = 0; n < 1600 * q; n++) {
        const i = rng.int(20, N - 20), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rng.range(1.5, 18);
        const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; const y = this.heightAt(x, z);
        if (!roadClear(x, z, w + 2.4) || nearBld(x, z, 2)) continue;
        const steep = Math.abs(this.heightAt(x + 2, z) - y) + Math.abs(this.heightAt(x, z + 2) - y);
        if (t.barType[s][i] === 2 ? rng() > 0.3 : (steep < 1.0 || rng() > 0.35)) continue;
        const sc2 = rng.range(0.5, 1.2), lo = Math.min(y, this.heightAt(x + 1.2 * sc2, z), this.heightAt(x - 1.2 * sc2, z), this.heightAt(x, z + 1.2 * sc2), this.heightAt(x, z - 1.2 * sc2)); this.ms(bould[rng.int(0, bould.length - 1)], { tint: kt }).add(x, lo - 0.3 * sc2, z, rng() * 6.28, sc2, null, hsl(0.09, rng.range(0.02, 0.08), rng.range(0.8, 1)));
      }
      // rock outcrops: big blocky pieces sunk into the steep slopes, so cliffs read as rock instead of grey paint
      const crag = ['kaykit/Rock_2_E', 'kaykit/Rock_2_F', 'kaykit/Rock_2_G', 'kaykit/Rock_2_H', 'kaykit/Rock_3_M', 'kaykit/Rock_3_Q', 'kaykit/Rock_3_R'];
      let nCrag = 0;
      for (let n = 0; n < 16000 && nCrag < 900 * q; n++) {
        const i = rng.int(10, N - 10), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rng.range(3, 110);
        const sc3 = rng.range(1.3, 2.7), x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, w + 3 + 2.2 * sc3) || nearBld(x, z, 5)) continue;
        const y = this.heightAt(x, z), gx = this.heightAt(x + 2, z) - this.heightAt(x - 2, z), gz = this.heightAt(x, z + 2) - this.heightAt(x, z - 2);
        const slope = Math.hypot(gx, gz) / 4; if (slope < 0.75) continue;
        this.ms(crag[rng.int(0, crag.length - 1)], { tint: kt }).add(x, y - 1.1 * sc3, z, Math.atan2(gz, gx) + rng.range(-0.6, 0.6), sc3, sc3 * rng.range(0.8, 1.3), hsl(0.08, rng.range(0.02, 0.07), rng.range(0.78, 0.95)));
        nCrag++;
      }
      // rock facades: the big steep faces get covered in large blocky crags so they read as real cliffs, not grey walls
      {
        const fu = this.terrainFine, st = 7;
        for (let z = fu.z0 + 4; z < fu.z0 + (fu.nz - 1) * fu.step - 4 && nCrag < 1500 * q; z += st) for (let x = fu.x0 + 4; x < fu.x0 + (fu.nx - 1) * fu.step - 4 && nCrag < 1500 * q; x += st) {
          const jx = x + rng.range(-2.5, 2.5), jz = z + rng.range(-2.5, 2.5);
          const gx = this.heightAt(jx + 2.5, jz) - this.heightAt(jx - 2.5, jz), gz = this.heightAt(jx, jz + 2.5) - this.heightAt(jx, jz - 2.5), slope = Math.hypot(gx, gz) / 5;
          if (slope < 0.95 || rng() > 0.8) continue;
          t.terrainH(jx, jz); if (t.lastRoadD < t.hw + 7 || t.lastRoadD > 170) continue;
          const y = this.heightAt(jx, jz), sc3 = rng.range(2.4, 4.6);
          this.ms(crag[rng.int(0, crag.length - 1)], { tint: kt }).add(jx, y - 1.0 * sc3, jz, Math.atan2(gz, gx) + rng.range(-0.5, 0.5), sc3, sc3 * rng.range(0.9, 1.5), hsl(0.07, rng.range(0.04, 0.12), rng.range(0.7, 0.9)));
          nCrag++;
        }
      }
      this.cragCount = nCrag;
      // grass clumps and bushes on the verges and meadows
      const gr = ['kaykit/Grass_1_A', 'kaykit/Grass_2_A', 'kaykit/Grass_1_A', 'kaykit/Grass_1_B', 'kaykit/Grass_2_B'], bu = ['kaykit/Bush_4_B', 'kaykit/Bush_4_C', 'kaykit/Bush_1_C', 'kaykit/Bush_4_D'];
      for (let n = 0; n < 5200 * q; n++) {
        const i = rng.int(10, N - 10), s = rng.int(0, 1), sg = s ? 1 : -1;
        const d = t.barType[s][i] === 2 ? t.bar[s][i] + rng.range(1.0, 12) : t.bar[s][i] + rng.range(0.3, 4 + Math.pow(rng(), 2) * 14);
        const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, w + 1.2)) continue;
        const y = this.heightAt(x, z), r = rng();
        if (r < 0.88) this.ms(gr[Math.min(4, Math.floor(rng() * 5))], { tint: kt, cast: false }).add(x, y - 0.05, z, rng() * 6.28, rng.range(0.8, 1.5), null, hsl(0.25 + rng.range(-0.03, 0.04), rng.range(0.25, 0.5), rng.range(0.78, 0.95)));
        else this.ms(bu[rng.int(0, 3)], { tint: kt }).add(x, Math.min(y, this.heightAt(x + 0.8, z), this.heightAt(x - 0.8, z), this.heightAt(x, z + 0.8), this.heightAt(x, z - 0.8)) - 0.1, z, rng() * 6.28, rng.range(0.7, 1.3), null, hsl(0.3, rng.range(0.15, 0.35), rng.range(0.6, 0.8)));
      }
    } else if (kit) {
      for (let n = 0; n < 14000 * q && nTrees < 1050 * q; n++) {
        const i0 = rng.int(0, N - 1), s0 = rng.int(0, 1), sg0 = s0 ? 1 : -1, d0 = t.bar[s0][i0] + 1.5 + Math.pow(rng(), 1.3) * 42;
        const x = t.px[i0] + t.nx[i0] * sg0 * d0, z = t.pz[i0] + t.nz[i0] * sg0 * d0; const y = this.heightAt(x, z); const d = t.lastRoadD;
        if (!(d > w + 3.2)) continue; if (y > tree) continue; if (nearBld(x, z, 3)) continue;
        if (nz2(x * 2.5, z * 2.5) < 0.38 + smoothstep(tree - 120, tree, y) * 0.3) continue;
        const ny = Math.abs(this.heightAt(x + 1.5, z) - y) + Math.abs(this.heightAt(x, z + 1.5) - y); if (ny > 1.6) continue;
        this.ms(pines[rng.int(0, 4)], { tint: tintPine, cell: 220 })
          .add(x, y - 0.2, z, rng() * 6.28, rng.range(1.0, 1.9), null, hsl(0.3 + rng.range(-0.03, 0.04), rng.range(0.2, 0.45), rng.range(0.75, 1.0)));
        nTrees++;
      }
      const rocks = PK ? [0, 1, 2, 3].map((k) => new W.Scatter(boulderGeo(k + 1), new THREE.MeshStandardMaterial({ map: ptex('rock', 'a', this.aniso), normalMap: ptex('rock', 'n', this.aniso), roughness: 0.92 }), 1e6)) : null;
      for (let n = 0; n < 1400 * q; n++) {
        const i = rng.int(20, N - 20), s = rng.int(0, 1), sg = s ? 1 : -1, d = t.bar[s][i] + rng.range(1.5, 14);
        const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; const y = this.heightAt(x, z);
        if (!roadClear(x, z, w + 2.6) || nearBld(x, z, 2)) continue;
        const steep = Math.abs(this.heightAt(x + 2, z) - y) + Math.abs(this.heightAt(x, z + 2) - y);
        if (t.barType[s][i] === 2 ? rng() > 0.25 : (steep < 1.2 || rng() > 0.3)) continue;
        const sc2 = rng.range(0.6, 1.9);
        if (rocks) rocks[rng.int(0, 3)].add(x, y - 0.12 * sc2, z, rng() * 6.28, sc2, sc2 * rng.range(0.75, 1.15), sc2 * rng.range(0.8, 1.2), hsl(0.09, rng.range(0.03, 0.1), rng.range(0.68, 0.88)));
        else this.ms('nature/Rock_Medium_' + rng.int(1, 3), { cell: 1e6 }).add(x, y - 0.35 * sc2, z, rng() * 6.28, sc2, sc2 * rng.range(0.7, 1.1), hsl(0.1, 0.04, rng.range(0.85, 1)));
      }
      if (rocks) rocks.forEach((r) => r.build(sc, true, true));
      const tufts = ['nature/Grass_Common_Tall', 'nature/Grass_Wispy_Tall', 'nature/Grass_Common_Short', 'nature/Fern_1', 'nature/Flower_3_Group'];
      const leafTint = (mat) => { if (mat.name === 'Grass') mat.color = lin(0x9fd06a); if (/^Lea/.test(mat.name)) mat.color = lin(th.leaf); };
      for (let n = 0; n < 900 * q; n++) {
        const i = rng.int(10, N - 10), s = rng.int(0, 1), sg = s ? 1 : -1;
        const d = t.barType[s][i] === 2 ? t.bar[s][i] + rng.range(1.0, 7) : t.bar[s][i] + rng.range(0.4, 6);
        const x = t.px[i] + t.nx[i] * sg * d, z = t.pz[i] + t.nz[i] * sg * d; if (!roadClear(x, z, w + 1.4)) continue;
        const r = rng(); const name = r < 0.8 ? tufts[r < 0.55 ? 2 : rng.int(0, 1)] : r < 0.93 ? tufts[3] : tufts[4];
        this.ms(name, { tint: leafTint, cast: false, cell: 1e6 }).add(x, this.heightAt(x, z) - 0.05, z, rng() * 6.28, rng.range(0.7, 1.3));
      }
    }
    // cheap distant forest on the coarse terrain
    {
      const gb = new GeoBuilder(); const dk = KK ? lin(0x274d33) : lin(0x24492a), lt = KK ? lin(0x33613d) : lin(0x2f5c32);
      gb.add(new THREE.CylinderGeometry(0.25, 0.35, 2, 4, 1, true), M(0, 1, 0), 0x4a3524); gb.add(new THREE.ConeGeometry(2.4, 5, 6, 1, true), M(0, 4, 0), dk); gb.add(new THREE.ConeGeometry(1.7, 4, 6, 1, true), M(0, 6.6, 0), lt);
      const g = gb.build(); g.computeBoundingSphere(); const far = new W.Scatter(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 1e6);
      let nf = 0;
      for (let n = 0; n < 40000 * q && nf < 7000 * q; n++) {
        const a = rng() * Math.PI * 2, r = 20 + Math.pow(rng(), 0.8) * 1000; const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const y = t.terrainH(x, z); if (y > tree - 30 || t.lastRoadD < 60) continue;
        if (nz2(x * 1.2, z * 1.2) < 0.42) continue; far.add(x, y - 0.5, z, rng() * 6.28, rng.range(1.4, 2.6), null, null, null); nf++;
      }
      far.build(sc, false, true); this.farTrees = nf;
    }
    this.treeCount = nTrees; this.pineCount = nTrees;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
