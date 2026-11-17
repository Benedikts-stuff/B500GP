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
    const stoneMat = new THREE.MeshStandardMaterial({ map: ptex('granite', 'a', an), normalMap: ptex('granite', 'n', an), normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, roughness: 0.88 });
    const capMat = new THREE.MeshStandardMaterial({ map: ptex('granite', 'a', an), normalMap: ptex('granite', 'n', an), color: lin(0xc9c4ba), roughness: 0.9, side: THREE.DoubleSide });
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
            const pr = st.p * (0.8 + rnd2 * 0.45), bu = st.b, tone = 0.84 + rnd * 0.3, warm = (H(si * 17 + tx * 3 + r) - 0.5) * 0.08;
            const col = [s2l(st.col[0] * tone * (1 + warm)), s2l(st.col[1] * tone), s2l(st.col[2] * tone * (1 - warm))];
            const m = st.o.length, base = Pp.length / 3;
            const put = (u, v, d, ao) => {
              const U = Math.min(U1, Math.max(U0, tx * TW + u)), V = r * TH + v; P(U, V, d, tmp);
              Pp.push(tmp[0], tmp[1], tmp[2]); C.push(col[0] * ao, col[1] * ao, col[2] * ao); UV.push(U * 0.7, V * 0.7);
            };
            for (let k = 0; k < m; k++) put(st.o[k][0], st.o[k][1], -0.01, 0.42);
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

  AX.World.prototype._buildPass = function () {
    const t = this.track, sc = this.scene, th = this.theme, N = t.n, w = t.hw, an = this.aniso, rng = AX.RNG(t.def.seed || 9);
    const q = this.q === 'low' ? 0.4 : this.q === 'medium' ? 0.7 : 1;
    // sky drawn behind everything (the mountains reach past the sky sphere)
    this.sky.material.depthTest = false; this.sky.renderOrder = -10; this.sky.scale.setScalar(0.5);
    sc.fog = new THREE.Fog(lin(th.fog), 380, 5200);
    const b = t.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const yMin = Math.min(...t.py), yMax = Math.max(...t.py);
    const tree = yMax + 160;                                           // treeline
    const nz2 = (x, z) => W.fbm(x * 0.01 + 31, z * 0.01 + 17, 0, 3);

    /* ---- terrain: fine grid around the road, coarse grid out to the mountains */
    const mat = (x, z, y, ny) => {
      const steep = smoothstep(0.8, 0.6, ny + (nz2(x * 3, z * 3) - 0.5) * 0.22);
      const snow = smoothstep(tree + 160, tree + 260, y + (nz2(x, z) - 0.5) * 80) * smoothstep(0.55, 0.75, ny);
      const alp = smoothstep(tree - 40, tree + 80, y);
      return [Math.max(steep, alp * smoothstep(0.92, 0.8, ny)), snow, Math.max(alp * 0.6, smoothstep(0.45, 0.75, nz2(x * 2.2, z * 2.2)) * 0.25)];
    };
    const tint = (x, z, y) => { const k = 0.82 + nz2(x * 1.7, z * 1.7) * 0.35, d = smoothstep(yMax - 20, tree + 40, y) * 0.25; return [k * (1 + d * 0.3), k * (1 - d * 0.1), k * (1 - d * 0.4)]; };
    const M0 = 110, gx0 = b.minX - M0, gz0 = b.minZ - M0, gx1 = b.maxX + M0, gz1 = b.maxZ + M0;
    const fineStep = this.q === 'low' ? 3 : 2.2;
    const self = this, roadSide = (x, z) => { const i = t.nearest(x, z, -1); return [i, t.lateral(i, x, z)]; };
    // terrain right behind a retaining wall sits on the wall top, in front of it at shoulder height
    const hFine = (x, z) => { const h = t.terrainH(x, z); return t.lastRoadD < 8.6 ? h - 5 : h; };
    const tm = PK ? terrainMaterial(ptex('meadow', 'a', an), ptex('rock', 'a', an), ptex('scree', 'a', an), { grass: ptex('meadow', 'n', an), rock: ptex('rock', 'n', an), scree: ptex('scree', 'n', an) })
      : terrainMaterial(meadowTex(an), rockTex(an), gravelTex2(an)); this.terrainMat = tm;
    const fine = gridMesh(gx0, gz0, gx1, gz1, fineStep, hFine, mat, tint);
    const fm = new THREE.Mesh(fine, tm); fm.receiveShadow = true; sc.add(fm); this.terrainFine = fine.userData;
    // skirt so the coarse ring never shows through the seam
    const R1 = 1700, coarse = gridMesh(cx - R1, cz - R1, cx + R1, cz + R1, 28, (x, z) => t.terrainH(x, z), mat, tint,
      (x, z) => (x > gx0 + 3 && x < gx1 - 3 && z > gz0 + 3 && z < gz1 - 3 ? -8 : 0));
    const cm = new THREE.Mesh(coarse, tm); cm.receiveShadow = true; sc.add(cm);
    /* ---- corridor strip: high-resolution terrain along both sides of the road, joined to wall tops / road shoulders */
    {
      const P = [], UV = [], MAT = [], C = [], idx = []; const lats = [0, 0.6, 1.6, 3, 4.8, 7, 9.5, 12.5];
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
            P.push(x, y, z); UV.push(x / 7, z / 7);
            const m = mat(x, z, y, 0.9), tn = tint(x, z, y); MAT.push(k === 0 && !wall ? 0.0 : m[0], m[1], k <= 1 && !wall ? 0.5 : m[2]); C.push(tn[0], tn[1], tn[2]);
          }
          if (i > 0) for (let k = 0; k < cols - 1; k++) {
            const a = base0 + (i - 1) * cols + k, b2 = base0 + i * cols + k;
            if (s) idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); else idx.push(a, a + 1, b2, a + 1, b2 + 1, b2);
          }
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.setAttribute('aMat', new THREE.Float32BufferAttribute(MAT, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(idx); g.computeVertexNormals();
      // steep bits of the strip (embankments, cuttings) get scree / rock from their real normals
      const Nn = g.attributes.normal.array, Ma = g.attributes.aMat.array;
      for (let k = 0; k < Nn.length / 3; k++) { const ny = Nn[k * 3 + 1]; Ma[k * 3] = Math.max(Ma[k * 3], smoothstep(0.74, 0.55, ny)); Ma[k * 3 + 2] = Math.max(Ma[k * 3 + 2], smoothstep(0.88, 0.7, ny) * 0.6); }
      const cm2 = new THREE.Mesh(g, tm); cm2.receiveShadow = true; sc.add(cm2); this.corridor = g;
    }
    this.heightAt = (x, z) => {
      const u = this.terrainFine; const fx = (x - u.x0) / u.step, fz = (z - u.z0) / u.step;
      if (fx < 0 || fz < 0 || fx >= u.nx - 1 || fz >= u.nz - 1) return t.terrainH(x, z);
      const hh = t.terrainH(x, z); if (t.lastRoadD < 14) return hh;
      const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, c = fz - j, H = u.H, k = j * u.nx + i;
      return (H[k] * (1 - a) + H[k + 1] * a) * (1 - c) + (H[k + u.nx] * (1 - a) + H[k + u.nx + 1] * a) * c;
    };

    /* ---- far peaks */
    {
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

    /* ---- road */
    const roadMat = PK ? new THREE.MeshStandardMaterial({ map: ptex('asphalt', 'a', an), normalMap: ptex('asphalt', 'n', an), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.86 })
      : new THREE.MeshStandardMaterial({ map: W.asphaltTex(th.asphalt, an), roughness: 0.9 });
    sc.add(Object.assign(new THREE.Mesh(rib(t, () => -w, () => w, { yA: () => 0.02, vLen: w * 2 }), roadMat), { receiveShadow: true }));
    const shoulder = PK ? new THREE.MeshStandardMaterial({ map: ptex('gravel', 'a', an), normalMap: ptex('gravel', 'n', an), roughness: 1 })
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

    /* ---- forest (nature-kit pines near the road, cheap cones further out), boulders, grass tufts */
    const kit = this.kits, pines = [1, 2, 3, 4, 5].map((k) => 'nature/Pine_' + k);
    const tintPine = (mat) => { if (/^Lea/.test(mat.name)) { mat.color = lin(th.pine); mat.roughness = 1; mat.emissive = lin(th.pine).multiplyScalar(0.28); mat.emissiveMap = mat.map;
      mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;', '')); }; mat.customProgramCacheKey = () => 'apex-foliage'; } };
    const hsl = (h, s, l) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
    let nTrees = 0;
    if (kit) {
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
      const gb = new GeoBuilder(); const dk = lin(0x24492a), lt = lin(0x2f5c32);
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
