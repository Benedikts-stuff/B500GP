/* APEX — look demo: a small valley built from scratch in the golden-hour style. Everything here is generated
   from the same few functions, so grass, trees and rocks always sit exactly on the ground they belong to. */
(function () {
  'use strict';
  const AX = window.AX, THREE = window.THREE;
  const { clamp, lerp, smoothstep } = AX;
  const C = (h) => new THREE.Color(h).convertSRGBToLinear();
  const v3 = (c) => 'vec3(' + [c.r, c.g, c.b].map((x) => x.toFixed(4)).join(',') + ')';

  /* ------------------------------------------------------------------ palette */
  const SUN = new THREE.Vector3(-0.62, 0.22, -0.75).normalize();
  const P = {
    sun: C('#ffc890'), sunI: 2.25, hemiSky: C('#cfc8f0'), hemiGround: C('#a88a62'), hemiI: 1.45,
    hazeWarm: C('#ffb98a'), hazeCool: C('#c8aed0'),
    skyTop: C('#8fa3d8'), skyTopSun: C('#b8acdc'),
    gDeep: C('#3d6a2c'), gWarm: C('#93a33a'), gDry: C('#c9a64e'), earth: C('#7a6450'),
    road: C('#8b88a3'), roadLine: C('#f2eee6'), shoulder: C('#9d927f'),
    rock: C('#86807f'), rockLight: C('#aaa29c'),
    pine: [C('#2f4f3c'), C('#35563f'), C('#2a4738'), C('#3c5c44')], trunk: C('#4a3426'),
    gold: ['#f2b232', '#f7c94a', '#e98f2a', '#ffd86a', '#d9761f'].map(C), maple: ['#ff8a2a', '#ff6d1f', '#ffa640', '#f25a1c', '#ffbf55'].map(C),
    flowers: ['#fffaf0', '#fff6e0', '#fff1a8', '#ffd84d', '#f6b0cf'].map(C),
    ring: [C('#4e6a50'), C('#7e7f9c'), C('#a9a3c4')]
  };

  /* ------------------------------------------------------------------ noise: the same smooth functions in JS and GLSL */
  const nA = (x, z) => Math.sin(x + Math.sin(z * 0.73) * 1.7) * Math.cos(z * 0.87 - Math.sin(x * 0.55) * 1.3);
  const GLSL_NOISE = 'float nA(vec2 p){ return sin(p.x + sin(p.y * 0.73) * 1.7) * cos(p.y * 0.87 - sin(p.x * 0.55) * 1.3); }';
  const patchJS = (x, z) => nA(x * 0.021, z * 0.021) * 0.65 + nA(x * 0.057 + 3.1, z * 0.057 - 1.7) * 0.35;
  const dryJS = (x, z) => nA(x * 0.043 - 7.0, z * 0.043 + 2.0);
  // ground colour shared by the terrain and the grass blades (the blades take exactly the colour of the ground they stand on)
  const GLSL_GROUND = `${GLSL_NOISE}
    vec3 groundCol(vec2 w){
      float pt = nA(w * 0.021) * 0.65 + nA(w * 0.057 + vec2(3.1, -1.7)) * 0.35;
      float dr = nA(w * 0.043 + vec2(-7.0, 2.0));
      vec3 c = mix(${v3(P.gDeep)}, ${v3(P.gWarm)}, smoothstep(-0.55, 0.75, pt));
      c = mix(c, ${v3(P.gDry)}, smoothstep(0.45, 0.95, dr) * 0.55);
      return c;
    }`;

  /* ------------------------------------------------------------------ the road: a closed loop through the valley */
  const CTRL = [[-185, -55], [-70, -150], [80, -175], [205, -95], [190, 30], [95, 55], [40, 135], [-60, 185], [-185, 120], [-140, 35], [-235, -15]];
  function catmull(pts, n) {
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const p0 = pts[(k - 1 + pts.length) % pts.length], p1 = pts[k], p2 = pts[(k + 1) % pts.length], p3 = pts[(k + 2) % pts.length];
      for (let s = 0; s < n; s++) {
        const t = s / n, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    return out;
  }
  // base hills before the road is cut in: a bowl with soft rolling ground, steeper toward the rim
  const H0 = (x, z) => {
    const r = Math.hypot(x, z);
    return nA(x * 0.0065, z * 0.0065) * 16 + nA(x * 0.019 + 2, z * 0.019 - 5) * 5 + nA(x * 0.05, z * 0.05) * 1.2 + smoothstep(170, 460, r) * 70 + nA(x * 0.004, z * 0.004) * 30 * smoothstep(300, 700, r);
  };
  const HW = 3.4;                                                   // road half width
  const road = (() => {
    const raw = catmull(CTRL, 60), pts = [];
    // resample to ~1 m
    let acc = 0; pts.push(raw[0]);
    for (let i = 1; i <= raw.length; i++) {
      const a = raw[i - 1], b = raw[i % raw.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let d = 1 - acc; while (d <= L) { const t = d / L; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); d += 1; }
      acc = L - (d - 1);
    }
    pts.pop(); const n = pts.length, x = new Float32Array(n), z = new Float32Array(n), y = new Float32Array(n), yaw = new Float32Array(n), k = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = pts[i][0]; z[i] = pts[i][1]; }
    const raw2 = new Float32Array(n); for (let i = 0; i < n; i++) raw2[i] = H0(x[i], z[i]);
    for (let i = 0; i < n; i++) { let s = 0, w = 0; for (let o = -45; o <= 45; o++) { const ww = 1 - Math.abs(o) / 46; s += raw2[(i + o + n) % n] * ww; w += ww; } y[i] = s / w; }
    for (let i = 0; i < n; i++) { const a = (i - 1 + n) % n, b = (i + 1) % n; yaw[i] = Math.atan2(z[b] - z[a], x[b] - x[a]); }
    for (let i = 0; i < n; i++) { const a = (i - 3 + n) % n, b = (i + 3) % n; k[i] = AX.wrapAngle(yaw[b] - yaw[a]) / 6; }
    // spatial hash for "nearest road point"
    const cell = 8, grid = new Map(); const key = (cx, cz) => cx * 100003 + cz;
    for (let i = 0; i < n; i++) { const kk = key(Math.floor(x[i] / cell), Math.floor(z[i] / cell)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); }
    const near = (px, pz) => {
      const cx = Math.floor(px / cell), cz = Math.floor(pz / cell); let best = -1, bd = 1e18;
      for (let r = 0; r <= 3; r++) {
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue; const L = grid.get(key(cx + a, cz + b)); if (!L) continue;
          for (const i of L) { const dd = (x[i] - px) * (x[i] - px) + (z[i] - pz) * (z[i] - pz); if (dd < bd) { bd = dd; best = i; } }
        }
        if (best >= 0 && r >= 1) break;
      }
      return best < 0 ? { i: -1, d: 1e9 } : { i: best, d: Math.sqrt(bd) };
    };
    return { n, x, y, z, yaw, k, near };
  })();
  // the final ground: hills, with the road bed cut and filled in smoothly
  function ground(x, z) {
    const h0 = H0(x, z), r = road.near(x, z); if (r.i < 0) return { y: h0, d: 1e9, i: -1 };
    const w = 1 - smoothstep(HW + 0.6, HW + 11, r.d);
    return { y: lerp(h0, road.y[r.i] - 0.03, w), d: r.d, i: r.i };
  }
  /* the inner ground as a 2 m grid, built once; every query below interpolates exactly like the mesh triangles,
     so anything placed with surf() sits precisely on the visible surface */
  const GS = 640, GSTEP = 2, GN = GS / GSTEP + 1, GH = new Float32Array(GN * GN), GD = new Float32Array(GN * GN);
  for (let iz = 0; iz < GN; iz++) for (let ix = 0; ix < GN; ix++) { const g = ground(-GS / 2 + ix * GSTEP, -GS / 2 + iz * GSTEP); GH[iz * GN + ix] = g.y; GD[iz * GN + ix] = g.d; }
  function surf(x, z) {
    const fx = (x + GS / 2) / GSTEP, fz = (z + GS / 2) / GSTEP, ix = Math.min(GN - 2, Math.max(0, Math.floor(fx))), iz = Math.min(GN - 2, Math.max(0, Math.floor(fz))), u = fx - ix, v = fz - iz;
    const a = iz * GN + ix, b = (iz + 1) * GN + ix, c = (iz + 1) * GN + ix + 1, d = iz * GN + ix + 1;
    let y, dd;
    if (u + v <= 1) { y = GH[a] + (GH[d] - GH[a]) * u + (GH[b] - GH[a]) * v; dd = GD[a] + (GD[d] - GD[a]) * u + (GD[b] - GD[a]) * v; }
    else { y = GH[c] + (GH[b] - GH[c]) * (1 - u) + (GH[d] - GH[c]) * (1 - v); dd = GD[c] + (GD[b] - GD[c]) * (1 - u) + (GD[d] - GD[c]) * (1 - v); }
    return { y, d: dd };
  }

  /* ------------------------------------------------------------------ renderer, scene, light */
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 6000);
  const post = new AX.PostFX(renderer); post.aoOn = false;
  // bloom only for what is really bright (the sun, a glint), not for every white surface
  post.mBright.fragmentShader = post.mBright.fragmentShader.replace('smoothstep(0.80,1.0,l)', 'smoothstep(0.93,1.0,l)'); post.mBright.needsUpdate = true;
  post.mFinal.uniforms.uBloom.value = 0.55; post.mFinal.uniforms.uVig.value = 0.24; post.mFinal.uniforms.uSat.value = 1.0;

  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiI); scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.sun, P.sunI); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  const SR = 70; Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 10, far: 600 });
  sun.shadow.radius = 4; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; scene.add(sun); scene.add(sun.target);

  // haze: colour from where you look (golden toward the sun, rose-lavender away), thickening with distance
  {
    const ch = THREE.ShaderChunk;
    ch.fog_pars_vertex += '\n#ifdef USE_FOG\nvarying vec3 vFogW;\n#endif';
    ch.fog_vertex += '\n#ifdef USE_FOG\nvFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\nvFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif\n#endif';
    ch.fog_pars_fragment += '\n#ifdef USE_FOG\nvarying vec3 vFogW;\n#endif';
    ch.fog_fragment = `#ifdef USE_FOG
      vec3 fd = normalize(vFogW - cameraPosition);
      float sd = clamp(dot(fd, ${'vec3(' + SUN.toArray().map((v) => v.toFixed(4)).join(',') + ')'}) * 0.5 + 0.5, 0.0, 1.0);
      vec3 fc = mix(${v3(P.hazeCool)}, ${v3(P.hazeWarm)}, pow(sd, 1.7));
      float f = 1.0 - exp(-max(fogDepth - fogNear, 0.0) / fogFar);
      f *= 1.0 - 0.35 * smoothstep(20.0, 160.0, vFogW.y);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(f, 0.0, 0.96));
    #endif`;
  }
  scene.fog = new THREE.Fog(0xffffff, 45, 420);

  // sky: the haze colours at the horizon, a soft lilac-blue overhead, a glow round the low sun
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); vec3 S = ${'vec3(' + SUN.toArray().map((v) => v.toFixed(4)).join(',') + ')'};
      float sd = clamp(dot(d, S) * 0.5 + 0.5, 0.0, 1.0), h = clamp(d.y, 0.0, 1.0);
      vec3 hor = mix(${v3(P.hazeCool)}, ${v3(P.hazeWarm)}, pow(sd, 1.7));
      vec3 top = mix(${v3(P.skyTop)}, ${v3(P.skyTopSun)}, pow(sd, 3.0));
      vec3 c = mix(hor, top, pow(h, 0.55));
      float s = max(dot(d, S), 0.0); c += vec3(1.0, 0.82, 0.6) * (pow(s, 10.0) * 0.28 + pow(s, 90.0) * 0.45 + pow(s, 2000.0) * 1.6);
      c = mix(c, hor, clamp(-d.y * 8.0, 0.0, 1.0));
      gl_FragColor = vec4(c, 1.0); }`
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  /* ------------------------------------------------------------------ terrain */
  function terrainMat() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN; attribute float aRoad;\nvarying float vRoad;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal); vRoad = aRoad;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN; varying float vRoad;\n' + GLSL_GROUND)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 g = groundCol(vW.xz);
          float steep = smoothstep(0.55, 0.85, 1.0 - vWN.y);
          float rk = nA(vW.xz * 0.09);
          g = mix(g, mix(${v3(P.rock)}, ${v3(P.rockLight)}, 0.5 + 0.5 * rk), steep);
          g = mix(g, ${v3(P.earth)}, smoothstep(${(HW + 1.2).toFixed(2)}, ${(HW + 0.3).toFixed(2)}, vRoad) * 0.5);
          diffuseColor.rgb = g;`);
    };
    return m;
  }
  function terrainMesh(size, step, holeR, sink) {
    const n = Math.round(size / step), g = new THREE.PlaneGeometry(size, size, n, n); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, rd = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k); let y;
      if (holeR) { y = H0(x, z) - (Math.max(Math.abs(x), Math.abs(z)) < holeR ? sink : 0); rd[k] = 1e3; }
      else { const gr = surf(x, z); y = gr.y; rd[k] = gr.d; }
      pos.setY(k, y);
    }
    g.setAttribute('aRoad', new THREE.BufferAttribute(rd, 1)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, terrainMat()); m.receiveShadow = true; scene.add(m); return m;
  }

  /* ------------------------------------------------------------------ road ribbon (asphalt, edge lines, worn tracks: all in the shader) */
  function roadMesh() {
    const P3 = [], UV = [], idx = [], n = road.n, W = HW + 0.2;
    for (let i = 0; i <= n; i++) {
      const j = i % n, nx = -Math.sin(road.yaw[j]), nz = Math.cos(road.yaw[j]);
      P3.push(road.x[j] - nx * W, road.y[j] + 0.02, road.z[j] - nz * W, road.x[j] + nx * W, road.y[j] + 0.02, road.z[j] + nz * W);
      UV.push(-W, i, W, i);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); g.setAttribute('aRd', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(idx); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(P3.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRd; varying vec2 vR;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = aRd;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float l = vR.x, al = abs(l), aa = fwidth(l) * 1.2;
          vec3 c = ${v3(P.road)};
          // two softly polished wheel tracks per lane, a lighter crown line
          c *= 1.0 - 0.07 * (smoothstep(0.55, 0.0, abs(al - 1.0)) + smoothstep(0.55, 0.0, abs(al - 2.3)));
          float edge = smoothstep(${(HW - 0.32).toFixed(2)} - aa, ${(HW - 0.32).toFixed(2)} + aa, al) * (1.0 - smoothstep(${(HW - 0.14).toFixed(2)} - aa, ${(HW - 0.14).toFixed(2)} + aa, al));
          float dash = step(0.5, fract(vR.y / 9.0)) * (1.0 - smoothstep(0.07 - aa, 0.07 + aa, al));
          c = mix(c, ${v3(P.roadLine)}, max(edge, dash) * 0.9);
          c = mix(c, ${v3(P.shoulder)}, smoothstep(${HW.toFixed(2)} - aa, ${HW.toFixed(2)} + aa, al));
          diffuseColor.rgb = c;`);
    };
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; scene.add(mesh); return mesh;
  }

  /* ------------------------------------------------------------------ grass: tufts in the ground colour, thinned with distance */
  function tuftGeometry() {
    const pos = [], nor = [], tt = [], idx = []; let base = 0;
    const blades = [[0, 0, 1.0, 0], [0.06, 0.03, 0.82, 2.1], [-0.05, 0.05, 0.9, 4.0], [0.02, -0.06, 0.72, 5.3], [-0.03, -0.02, 0.6, 1.1]];
    for (const [ox, oz, hh, rot] of blades) {
      const c = Math.cos(rot), sn = Math.sin(rot), seg = 3;
      for (let k = 0; k <= seg; k++) {
        const t = k / seg, w = (1 - t) * 0.04 + 0.004, lean = t * t * 0.32 * hh, y = t * hh;
        const at = (x) => [ox + x * c + lean * Math.cos(rot + 1.3), y, oz + x * sn + lean * Math.sin(rot + 1.3)];
        if (k < seg) { pos.push(...at(-w), ...at(w)); nor.push(0, 1, 0, 0, 1, 0); tt.push(t, t); } else { pos.push(...at(0)); nor.push(0, 1, 0); tt.push(t); }
      }
      for (let k = 0; k < seg - 1; k++) { const a = base + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const a = base + (seg - 1) * 2; idx.push(a, a + 1, a + 2); base += seg * 2 + 1;
    }
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    return g;
  }
  const windT = { value: 0 };
  function grassMat() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = windT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; varying float vT; varying vec3 vGW; uniform float uT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vT = aT;
          vec3 ip = instanceMatrix[3].xyz; vGW = ip;
          float cd = distance(ip, cameraPosition);
          // shorter and wider as they get further away, gone (= ground) at the edge of the grass range
          transformed.y *= 1.0 - smoothstep(40.0, 80.0, cd);
          transformed.xz *= 1.0 + cd / 22.0;
          float w = sin(uT * 1.6 + ip.x * 0.19 + ip.z * 0.13) * 0.6 + sin(uT * 2.9 + ip.x * 0.6) * 0.25;
          transformed.x += w * aT * aT * 0.11; transformed.z += w * aT * aT * 0.06;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vT; varying vec3 vGW;\n' + GLSL_GROUND)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // same colour as the ground at the root, a little lighter and warmer toward the tip (no dark roots, no grain)
          vec3 g = groundCol(vGW.xz) * diffuseColor.rgb;
          diffuseColor.rgb = g * mix(0.92, 1.28, vT * vT) + vec3(0.02, 0.016, 0.0) * vT;`);
    };
    return m;
  }

  /* ------------------------------------------------------------------ trees */
  function pineGeometry(rng, h, r0) {
    const pos = [], col = [], tiers = 7, dark = P.trunk, tc = P.pine[Math.floor(rng() * P.pine.length)], base = new THREE.Color();
    const tri = (a, b, c, cl) => { pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b); };
    const tr = h * 0.02 + 0.08;
    for (let s = 0; s < 5; s++) { const a0 = (s / 5) * 6.283, a1 = ((s + 1) / 5) * 6.283; const p0 = [Math.cos(a0) * tr, -0.6, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, -0.6, Math.sin(a1) * tr], q0 = [Math.cos(a0) * tr * 0.5, h * 0.45, Math.sin(a0) * tr * 0.5], q1 = [Math.cos(a1) * tr * 0.5, h * 0.45, Math.sin(a1) * tr * 0.5]; tri(p0, q0, p1, dark); tri(p1, q0, q1, dark); }
    for (let k = 0; k < tiers; k++) {
      const f = k / tiers, y0 = h * (0.18 + f * 0.72), y1 = y0 + h * (0.24 - f * 0.07), rr = r0 * (1 - f * 0.8) * (0.92 + rng() * 0.16), n = 9;
      base.copy(tc).multiplyScalar(0.78 + f * 0.4);
      const rim = []; for (let s = 0; s < n; s++) { const a = (s / n) * 6.283 + k * 0.5; rim.push([Math.cos(a) * rr, y0 - rr * 0.16, Math.sin(a) * rr]); }
      for (let s = 0; s < n; s++) { const p = rim[s], q = rim[(s + 1) % n]; tri(p, [0, y1, 0], q, base); tri(q, [0, y0 + 0.2, 0], p, base.clone().multiplyScalar(0.55)); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }
  function leafTreeGeometry(rng, h, pal) {
    const pos = [], nor = [], col = [], trunk = P.trunk;
    const tri = (a, b, c, n, cl) => { pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n); for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b); };
    const limb = (a, b, r) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(), u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const s1 = new THREE.Vector3().crossVectors(d, u).normalize(), s2 = new THREE.Vector3().crossVectors(d, s1).normalize();
      for (let k = 0; k < 5; k++) { const a0 = (k / 5) * 6.283, a1 = ((k + 1) / 5) * 6.283; const o0 = s1.clone().multiplyScalar(Math.cos(a0) * r).add(s2.clone().multiplyScalar(Math.sin(a0) * r)), o1 = s1.clone().multiplyScalar(Math.cos(a1) * r).add(s2.clone().multiplyScalar(Math.sin(a1) * r)); const nn = o0.clone().add(o1).normalize().toArray();
        tri([a[0] + o0.x, a[1] + o0.y, a[2] + o0.z], [b[0] + o0.x * 0.4, b[1] + o0.y * 0.4, b[2] + o0.z * 0.4], [a[0] + o1.x, a[1] + o1.y, a[2] + o1.z], nn, trunk);
        tri([a[0] + o1.x, a[1] + o1.y, a[2] + o1.z], [b[0] + o0.x * 0.4, b[1] + o0.y * 0.4, b[2] + o0.z * 0.4], [b[0] + o1.x * 0.4, b[1] + o1.y * 0.4, b[2] + o1.z * 0.4], nn, trunk); }
    };
    const top = [rng() * 0.5 - 0.25, h, rng() * 0.5 - 0.25]; limb([0, -0.6, 0], top, h * 0.028 + 0.07);
    const clusters = [{ c: [top[0], h * 0.9, top[2]], r: h * 0.2 }, { c: [top[0] * 0.6, h * 0.7, top[2] * 0.6], r: h * 0.25 }];
    const nb = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < nb; k++) {
      const y = h * (0.42 + 0.42 * rng()), a = rng() * 6.283, L = h * (0.2 + 0.14 * rng()) * (1.15 - y / h * 0.6);
      const p0 = [top[0] * y / h, y, top[2] * y / h], p1 = [p0[0] + Math.cos(a) * L, y + L * 0.5, p0[2] + Math.sin(a) * L];
      limb(p0, p1, h * 0.01 + 0.03); clusters.push({ c: p1, r: h * (0.15 + 0.07 * rng()) });
    }
    const tmp = new THREE.Color(), sz = 0.07 + h * 0.003;
    for (const cl of clusters) {
      const n = Math.floor(cl.r * cl.r * 320);
      for (let k = 0; k < n; k++) {
        const u = rng() * 2 - 1, th = rng() * 6.283, rr = cl.r * (0.6 + 0.4 * Math.cbrt(rng())), sq = Math.sqrt(1 - u * u);
        const dx = sq * Math.cos(th), dy = u * 0.8, dz = sq * Math.sin(th);
        const cx = cl.c[0] + dx * rr, cy = cl.c[1] + dy * rr, cz = cl.c[2] + dz * rr;
        const nn = new THREE.Vector3(dx, dy + 0.3, dz).normalize().toArray();
        tmp.copy(pal[Math.floor(rng() * pal.length)]).multiplyScalar(0.6 + 0.5 * (rr / cl.r) * (0.75 + 0.25 * (dy + 1) / 2));
        const ax = rng() * 6.283, ay = rng() * 6.283, s = sz * (0.7 + rng() * 0.6);
        const e1 = [Math.cos(ax) * s, Math.sin(ay) * s * 0.6, Math.sin(ax) * s], e2 = [-Math.sin(ax) * s * 0.7, Math.cos(ay) * s * 0.7, Math.cos(ax) * s * 0.7];
        tri([cx + e1[0], cy + e1[1], cz + e1[2]], [cx + e2[0], cy + e2[1], cz + e2[2]], [cx - e1[0], cy - e1[1], cz - e1[2]], nn, tmp);
        tri([cx - e1[0], cy - e1[1], cz - e1[2]], [cx - e2[0], cy - e2[1], cz - e2[2]], [cx + e1[0], cy + e1[1], cz + e1[2]], nn, tmp);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  // rounded rock: a subdivided ball pushed about by smooth noise, flattened and half buried
  function rockGeometry(rng) {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, o = rng() * 100;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k), s = 1 + 0.22 * nA(x * 2.1 + o, z * 2.1 - o) + 0.12 * nA(y * 3.3 + o, x * 2.7);
      p.setXYZ(k, x * s * 1.25, y * s * 0.72, z * s);
    }
    g.computeVertexNormals(); return g;
  }

  /* ------------------------------------------------------------------ distant mountains: three hazy silhouette rings */
  function ring(R, hMin, hMax, col, seed) {
    const n = 220, pos = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * 6.283, ridge = hMin + (hMax - hMin) * (0.5 + 0.5 * (nA(Math.cos(a) * 3.1 + seed, Math.sin(a) * 3.1) * 0.6 + nA(Math.cos(a) * 9.0 - seed, Math.sin(a) * 9.0) * 0.3 + nA(Math.cos(a) * 23.0, Math.sin(a) * 23.0 + seed) * 0.1));
      pos.push(Math.cos(a) * R, -60, Math.sin(a) * R, Math.cos(a) * R * 0.97, ridge, Math.sin(a) * R * 0.97);
      if (k < n) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // pre-hazed colours: the further ring, the closer to the sky at the horizon
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(g, m); scene.add(mesh); return mesh;
  }

  /* ------------------------------------------------------------------ build */
  let rider = null, bikeVis = null, bikeState = null;
  const chunks = [];
  function build() {
    const t0 = performance.now(), rng = AX.RNG(20261118);
    terrainMesh(640, 2, 0, 0);
    terrainMesh(5200, 40, 330, 6);
    roadMesh();
    const hz = P.hazeCool.clone().lerp(P.hazeWarm, 0.45);
    ring(2500, 300, 660, P.ring[2].clone().lerp(hz, 0.72), 9.1); ring(1500, 140, 360, P.ring[1].clone().lerp(hz, 0.58), 4.7); ring(900, 40, 160, P.ring[0].clone().lerp(hz, 0.45), 1.3);
    // trees: forest patches by noise, clear of the road by their crown, sitting on the final ground
    const pines = [[], [], [], [], [], []], leafs = [[], [], [], []];
    const pineG = pines.map((_, k) => pineGeometry(rng, 12 + k * 1.4, 2.6 + (k % 3) * 0.3));
    const leafG = leafs.map((_, k) => leafTreeGeometry(rng, 8 + k * 1.1, k % 2 ? P.maple : P.gold));
    for (let x = -300; x <= 300; x += 5.5) for (let z = -300; z <= 300; z += 5.5) {
      const px = x + (rng() - 0.5) * 4.5, pz = z + (rng() - 0.5) * 4.5, f = nA(px * 0.016 + 11, pz * 0.016 - 4) * 0.7 + nA(px * 0.05, pz * 0.05) * 0.3;
      const gr = surf(px, pz), s = 0.8 + rng() * 0.45;
      if (gr.d < HW + 2.5 + 3.2 * s) continue;
      const lone = rng() < 0.012 && gr.d < 40;
      if (f < 0.32 && !lone) continue;
      const leaf = lone || rng() < (gr.d < 30 ? 0.3 : 0.1);
      if (leaf) leafs[Math.floor(rng() * leafs.length)].push([px, gr.y, pz, rng() * 6.283, s * 0.95]);
      else pines[Math.floor(rng() * pines.length)].push([px, gr.y, pz, rng() * 6.283, s]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    const inst = (geo, mat, list, cast) => {
      if (!list.length) return null; const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = cast; im.receiveShadow = true;
      list.forEach(([x, y, z, ry, s], i) => { q.setFromAxisAngle(up, ry); sv.set(s, s, s); pv.set(x, y, z); m4.compose(pv, q, sv); im.setMatrixAt(i, m4); im.setColorAt(i, tint.setHSL(0, 0, 0.88 + rng() * 0.24)); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; scene.add(im); return im;
    };
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    pineG.forEach((g, k) => inst(g, pm, pines[k], true)); leafG.forEach((g, k) => inst(g, lm, leafs[k], true));
    // rocks: a few groups in the meadows, half sunk into the ground
    const rockG = [0, 1, 2, 3].map(() => rockGeometry(rng)), rocks = [[], [], [], []];
    for (let k = 0; k < 40; k++) {
      const cx = (rng() - 0.5) * 520, cz = (rng() - 0.5) * 520, ng = 1 + Math.floor(rng() * 4);
      for (let j = 0; j < ng; j++) {
        const x = cx + (rng() - 0.5) * 9, z = cz + (rng() - 0.5) * 9, s = 0.5 + rng() * (j ? 1.1 : 2.2), gr = surf(x, z);
        if (gr.d < HW + 2 + s * 1.3) continue; rocks[k % 4].push([x, gr.y - s * 0.28, z, rng() * 6.283, s]);
      }
    }
    const rm = new THREE.MeshStandardMaterial({ color: P.rock, roughness: 1 });
    rockG.forEach((g, k) => inst(g, rm, rocks[k], true));
    // grass in 24 m cells: dense along the road, lighter in the open meadow; each cell is thinned with distance at run time
    const tuft = tuftGeometry(), gm = grassMat(), CELL = 24, e = new THREE.Euler();
    const flGeo = new THREE.PlaneGeometry(0.06, 0.06), flMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, emissive: new THREE.Color(0x2a2016) });
    let total = 0;
    for (let cx = -300; cx < 300; cx += CELL) for (let cz = -300; cz < 300; cz += CELL) {
      const mats = [], fl = [], fc = [];
      const mid = surf(cx + CELL / 2, cz + CELL / 2), dens = mid.d < 40 ? 13 : mid.d < 110 ? 6 : 2.2, cnt = Math.round(CELL * CELL * dens);
      for (let k = 0; k < cnt; k++) {
        const x = cx + rng() * CELL, z = cz + rng() * CELL, gr = surf(x, z);
        if (gr.d < HW + 0.9) continue;
        // steep banks (rock) stay bare; a soft grass edge along the shoulder
        const gx = surf(x + 0.8, z).y - gr.y, gz = surf(x, z + 0.8).y - gr.y; if (Math.hypot(gx, gz) / 0.8 > 0.95) continue;
        const pt = patchJS(x, z), hgt = (0.45 + 0.35 * (0.5 + 0.5 * pt) + 0.2 * rng()) * smoothstep(HW + 0.9, HW + 2.2, gr.d) * (1 - 0.35 * smoothstep(0.5, 1, dryJS(x, z)));
        e.set((rng() - 0.5) * 0.2, rng() * 6.283, (rng() - 0.5) * 0.2); q.setFromEuler(e); const wd = 0.9 + rng() * 0.35; sv.set(wd, hgt, wd); pv.set(x, gr.y - 0.02, z); m4.compose(pv, q, sv);
        mats.push(m4.clone());
        if (gr.d < 70 && rng() < Math.pow(clamp((nA(x * 0.07 + 40, z * 0.07 - 13) - 0.2) * 1.6, 0, 1), 2) * 0.12) {
          e.set(-Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * 6.283, 0); q.setFromEuler(e); const fs = 0.8 + rng() * 0.7; sv.set(fs, fs, fs); pv.set(x, gr.y + hgt * 0.75 + 0.05, z); m4.compose(pv, q, sv);
          fl.push(m4.clone()); fc.push(P.flowers[Math.floor(Math.pow(rng(), 1.5) * P.flowers.length)]);
        }
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(tuft, gm, mats.length); im.receiveShadow = true; im.frustumCulled = false;
      mats.forEach((mm, k) => im.setMatrixAt(k, mm)); im.instanceMatrix.needsUpdate = true; scene.add(im);
      let fim = null; if (fl.length) { fim = new THREE.InstancedMesh(flGeo, flMat, fl.length); fim.frustumCulled = false; fl.forEach((mm, k) => { fim.setMatrixAt(k, mm); fim.setColorAt(k, fc[k]); }); fim.instanceMatrix.needsUpdate = true; fim.instanceColor.needsUpdate = true; scene.add(fim); }
      chunks.push({ x: cx + CELL / 2, z: cz + CELL / 2, im, cap: mats.length, fim, fcap: fl.length }); total += mats.length;
    }
    // the bike, with its rider
    const spec = AX.BIKES.strada; rider = Object.assign({}, AX.RIDERS[0]);
    bikeVis = AX.Models.buildBike(spec, rider, { env: null }); scene.add(bikeVis.root);
    bikeVis.root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) { if (m.isMeshStandardMaterial) { m.envMapIntensity = 0.2; if (!m.transparent && m.roughness > 0.1) m.roughness = Math.max(m.roughness, 0.7); m.metalness *= 0.5; } } });
    bikeState = { x: 0, y: 0, z: 0, yaw: 0, lean: 0, pitch: 0, speed: 20, steer: 0, slope: 0, slipAngle: 0, spin: 0, surf: 0, aLong: 0, brake: 0, rearBrake: 0, throttle: 0.6, fb: 0, hang: 0, hangIn: 0, headShake: 0, crashed: false, crashT: 0, crashSide: 1, rd: 0 };
    console.log('demo built', JSON.stringify({ grass: total, chunks: chunks.length, trees: pines.reduce((a, l) => a + l.length, 0) + leafs.reduce((a, l) => a + l.length, 0), ms: Math.round(performance.now() - t0) }));
  }

  /* ------------------------------------------------------------------ run */
  const S = { s: 120, speed: 19, paused: false, view: 'chase', orbit: { a: 0.6, e: 0.32, r: 14 }, cine: 0, time: 0 };
  const lerpA = (a, b, t) => a + AX.wrapAngle(b - a) * t;
  function roadAt(s) {
    const n = road.n, f = ((s % n) + n) % n, i = Math.floor(f), j = (i + 1) % n, u = f - i;
    return { x: lerp(road.x[i], road.x[j], u), y: lerp(road.y[i], road.y[j], u), z: lerp(road.z[i], road.z[j], u), yaw: lerpA(road.yaw[i], road.yaw[j], u), k: lerp(road.k[i], road.k[j], u) };
  }
  let leanS = 0;
  function placeBike(dt) {
    const a = roadAt(S.s), ahead = roadAt(S.s + 8), lat = clamp(-ahead.k * 60, -1.6, 1.6) + 0.9;   // a little toward the inside of bends
    const nx = -Math.sin(a.yaw), nz = Math.cos(a.yaw);
    const leanT = Math.atan(S.speed * S.speed * a.k / 9.81); leanS = lerp(leanS, leanT, 1 - Math.exp(-4 * dt));
    Object.assign(bikeState, { x: a.x + nx * lat, z: a.z + nz * lat, y: a.y + 0.03, yaw: a.yaw, lean: leanS, speed: S.speed, steer: clamp(a.k * 12, -1, 1), hang: clamp(leanS * 1.6, -1, 1), hangIn: Math.abs(leanS) > 0.25 ? 1 : 0 });
    AX.Models.syncBike(bikeVis, bikeState, dt, S.time);
  }
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const CINE = [[0.28, 0.12, 9], [2.6, 0.06, 6.5], [1.75, 0.75, 48], [-1.4, 0.16, 9]];
  function placeCamera(dt, snap) {
    const b = bikeState, fx = Math.cos(b.yaw), fz = Math.sin(b.yaw); let pos, look;
    if (S.view === 'chase') { pos = new THREE.Vector3(b.x - fx * 6.4, b.y + 2.25, b.z - fz * 6.4); look = new THREE.Vector3(b.x + fx * 4, b.y + 0.9, b.z + fz * 4); camera.fov = 52; }
    else {
      const o = S.view === 'orbit' ? S.orbit : { a: CINE[S.cine][0], e: CINE[S.cine][1], r: CINE[S.cine][2] }; const a = b.yaw + o.a;
      pos = new THREE.Vector3(b.x + Math.cos(a) * Math.cos(o.e) * o.r, b.y + 0.8 + Math.sin(o.e) * o.r, b.z + Math.sin(a) * Math.cos(o.e) * o.r); look = new THREE.Vector3(b.x, b.y + 0.8, b.z); camera.fov = S.view === 'orbit' ? 40 : 32;
    }
    const g = surf(pos.x, pos.z).y + 0.6; if (pos.y < g) pos.y = g;
    const k = snap ? 1 : 1 - Math.exp(-6 * dt); camPos.lerp(pos, k); camLook.lerp(look, k);
    camera.position.copy(camPos); camera.lookAt(camLook); camera.updateProjectionMatrix();
    post.tilt = S.view === 'chase' ? 0.9 : 1.0; post.focusY = 0.5;
  }
  function updateGrass() {
    const cx = camera.position.x, cz = camera.position.z;
    for (const c of chunks) {
      const d = Math.max(0, Math.hypot(c.x - cx, c.z - cz) - 17);
      const f = d > 110 ? 0 : clamp((26 / Math.max(26, d)) ** 2, 0.06, 1);
      c.im.visible = f > 0; c.im.count = Math.max(1, Math.round(c.cap * f));
      if (c.fim) { c.fim.visible = d < 80; c.fim.count = Math.max(1, Math.round(c.fcap * Math.min(1, f * 1.4))); }
    }
  }
  function placeSun() {
    const b = bikeState; sun.target.position.set(b.x, b.y, b.z); sun.position.set(b.x + SUN.x * 300, b.y + SUN.y * 300, b.z + SUN.z * 300); sun.target.updateMatrixWorld();
    sky.position.copy(camera.position);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight, pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    post.setSize(Math.round(w * pr), Math.round(h * pr), 4);
  }
  function step(dt) {
    if (!S.paused) S.s += S.speed * dt; S.time += dt; windT.value = S.time;
    placeBike(dt); placeCamera(dt, false); placeSun(); updateGrass();
    scene.updateMatrixWorld(); AX.RiderBatch.flush(scene); tameRider();
  }
  function tameRider() { const m = AX.RiderBatch.mat; if (m && !m.userData.tame) { m.userData.tame = true; m.roughness = 0.92; m.envMapIntensity = 0; m.needsUpdate = true; } }
  let last = performance.now(), manual = false;
  function frame(now) { if (!manual) requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); post.render(scene, camera); }

  // input: views and an orbit you can drag
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Digit1') S.view = 'chase';
    if (e.code === 'Digit2') S.view = 'orbit';
    if (e.code === 'Digit3') { if (S.view === 'cine') S.cine = (S.cine + 1) % CINE.length; S.view = 'cine'; }
    if (e.code === 'Space') { S.paused = !S.paused; e.preventDefault(); }
  });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; if (S.view === 'chase') S.view = 'orbit'; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', (e) => { if (!drag) return; S.orbit.a += (e.clientX - drag[0]) * 0.006; S.orbit.e = clamp(S.orbit.e + (e.clientY - drag[1]) * 0.004, 0.02, 1.2); drag = [e.clientX, e.clientY]; });
  window.addEventListener('wheel', (e) => { S.orbit.r = clamp(S.orbit.r * (e.deltaY > 0 ? 1.1 : 0.9), 4, 120); }, { passive: true });
  window.addEventListener('resize', resize);

  // for headless shots: jump to a road position and a view, settle, render once
  window.DEMO = {
    S, renderer, camera, scene,
    shot(s, view, cine, orbit) {
      manual = true; S.s = s; S.view = view || 'chase'; if (cine != null) S.cine = cine; if (orbit) Object.assign(S.orbit, orbit);
      leanS = Math.atan(S.speed * S.speed * roadAt(S.s).k / 9.81);
      placeBike(0.016); placeCamera(0.016, true); placeSun(); updateGrass(); windT.value = 3.3;
      scene.updateMatrixWorld(); AX.RiderBatch.flush(scene); tameRider(); post.render(scene, camera); return renderer.domElement.toDataURL('image/png');
    }
  };

  (async () => {
    try { await AX.Assets.loadAll(() => {}); } catch (e) { console.warn('assets', e); }
    resize(); build(); placeBike(0.016); placeCamera(0.016, true);
    document.getElementById('demoLoad').style.display = 'none'; window.DEMO.ready = true;
    requestAnimationFrame(frame);
  })();
})();
