/* APEX — "golden hour" look: low warm sun, coloured haze, soft violet shadows, flat colours instead of painted
   textures, real grass blades with flower speckles, leaf-cloud larches and dark jagged pines (Art-of-Rally style).
   Look-dev stage: AX.Look.apply(world, renderer, post, camera, focus, radius) turns the area around `focus` over. */
(function (root) {
  'use strict';
  const AX = root.AX, THREE = root.THREE;
  const { clamp, lerp, smoothstep } = AX;
  const C = (h) => new THREE.Color(h).convertSRGBToLinear();

  const PAL = {
    sunCol: '#ffc283', sunI: 2.7, hemiSky: '#c7c4ec', hemiGround: '#a8825c', hemiI: 1.15,
    fog: '#f3b98e', fogNear: 15, fogFar: 270, haze: [0.96, 0.76, 0.62],
    skyTop: '#7f9fd4', skyHor: '#ffcf9e', skyGlow: '#fff0c8',
    grassLo: '#56763f', grassMid: '#82a04c', grassHi: '#d8cc6c', grassDry: '#c9ab5e',
    pine: ['#36553f', '#3d5c44', '#30503c', '#456649'], trunk: '#4a3528',
    larch: ['#f2b232', '#f7c94a', '#e98f2a', '#ffd86a', '#d9761f'],
    flowers: ['#fff6e8', '#fff3b0', '#ffd34d', '#f4a6c9', '#c9a6ff'],
    road: '#5b5560', rock: '#c2a78c', wall: '#9c8a78'
  };

  /* --- small value noise for colour patches and density */
  function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  const fbm = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.3 + 17, z * 2.3 - 9) * 0.3 + vnoise(x * 5.1, z * 5.1) * 0.1;

  /* --- sky: warm horizon, soft zenith, a big glow round the low sun */
  function skyMaterial(sunDir) {
    return new THREE.ShaderMaterial({
      uniforms: { uTop: { value: C(PAL.skyTop) }, uHor: { value: C(PAL.skyHor) }, uGlow: { value: C(PAL.skyGlow) }, uSun: { value: sunDir.clone() } },
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uSun; varying vec3 vP;
        void main(){ vec3 d = normalize(vP); float h = clamp(d.y, -0.2, 1.0);
          vec3 c = mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.45));
          float s = max(dot(d, normalize(uSun)), 0.0);
          c += uGlow * (pow(s, 5.0) * 0.35 + pow(s, 40.0) * 0.45 + pow(s, 600.0) * 1.2);
          c = mix(c, uHor * 0.9, clamp(-h * 5.0, 0.0, 1.0));
          gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0); }`
    });
  }

  /* --- every painted texture becomes its own average colour; everything matte */
  function avgColor(tex) {
    const img = tex.image; if (!img) return null;
    try {
      if (img.data && img.width) { const d = img.data, st = d.length / (img.width * img.height); let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += st * 13) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear(); }
      const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4;
      return new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
    } catch (e) { return null; }
  }
  // warm the palette: greens toward olive-sage, greys toward warm stone, a little less saturation overall
  function warmColor(col) {
    const hsl = {}; col.getHSL(hsl); let h = hsl.h * 360, s = hsl.s, l = hsl.l;
    const green = clamp(1 - Math.abs(h - 110) / 60, 0, 1);
    h = h + (88 - h) * green * 0.45; s *= 0.85 - 0.1 * green;
    if (s < 0.12) { h = 30; s = s + 0.1; }
    col.setHSL(((h / 360) % 1 + 1) % 1, clamp(s, 0, 1), l);
  }
  // the pass terrain: no textures, just colour by material weight (meadow from the vertex tint, rock, scree, snow)
  // with big soft patches so the slopes are not one flat colour
  function lookTerrain(m) {
    m.map = null; m.roughness = 1; m.metalness = 0; m.color.setRGB(1, 1, 1);
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aMat; varying vec3 vMat; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMat; varying vec3 vWP;\nfloat lkN(vec2 p){ return sin(p.x) * sin(p.y * 1.3 + 1.7) * 0.5 + sin(p.x * 2.1 + p.y * 1.7) * 0.25; }')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float pn = lkN(vWP.xz * 0.035) + lkN(vWP.xz * 0.11 + 3.0) * 0.4;
          vec3 meadow = mix(${v3([0.20, 0.30, 0.11])}, ${v3([0.42, 0.42, 0.16])}, clamp(0.5 + pn * 0.6, 0.0, 1.0));
          diffuseColor.rgb = mix(meadow, diffuseColor.rgb * meadow * 2.2, 0.35);
          vec3 rock = mix(${v3([0.36, 0.33, 0.35])}, ${v3([0.48, 0.42, 0.38])}, clamp(0.5 + pn, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, ${v3([0.52, 0.47, 0.42])}, vMat.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, vMat.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, ${v3([0.92, 0.92, 0.96])}, vMat.y);`);
    };
    m.customProgramCacheKey = () => 'look-terrain'; m.needsUpdate = true;
  }
  function flattenMaterials(scene) {
    let n = 0;
    scene.traverse((o) => {
      if (!o.material || o.userData.lookNew) return;
      for (const m of [].concat(o.material)) {
        if (!m.isMeshStandardMaterial || m.userData.lookDone) continue; m.userData.lookDone = true;
        if (/^passTerrain/.test(m.name || '')) { lookTerrain(m); n++; continue; }
        if (m.map && !/^kk_/.test(m.name || '')) { const a = avgColor(m.map); if (a) { m.color.multiply(a); m.map = null; n++; } }
        m.normalMap = null; m.roughnessMap = null; m.bumpMap = null;
        m.roughness = 1; m.metalness = Math.min(m.metalness, 0.15); m.envMapIntensity = 0.35;
        warmColor(m.color); m.needsUpdate = true;
      }
    });
    return n;
  }

  /* --- grass: one blade, instanced a few hundred thousand times. Normals point up, so a blade is lit like the meadow
     it stands in (soft, no glitter); colour runs dark at the root to sunlit tips, and big patches drift in hue */
  function bladeGeometry() {
    const g = new THREE.BufferGeometry(), seg = 3, pos = [], nor = [], tt = [], idx = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, w = 0.5 * (1 - t) * (1 - t * 0.15), bend = t * t * 0.35;
      if (k < seg) { pos.push(-w * 0.06, t, bend * 0.25, w * 0.06, t, bend * 0.25); nor.push(0, 1, 0, 0, 1, 0); tt.push(t, t); }
      else { pos.push(0, t, bend * 0.25); nor.push(0, 1, 0); tt.push(t); }
    }
    for (let k = 0; k < seg - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = (seg - 1) * 2; idx.push(a, a + 1, a + 2);
    g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    return g;
  }
  function grassMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.userData.lookDone = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWindT = AX.windT || (AX.windT = { value: 0 });
      sh.vertexShader = 'attribute float aT; varying float vT; uniform float uWindT;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vT = aT;
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float w = sin(uWindT * 1.7 + ip.x * 0.21 + ip.z * 0.17) * 0.5 + sin(uWindT * 3.1 + ip.x * 0.7) * 0.2;
            transformed.x += w * aT * aT * 0.18; transformed.z += w * aT * aT * 0.10;
          #endif`);
      sh.fragmentShader = 'varying float vT;\n' + sh.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity ); diffuseColor.rgb *= mix(0.62, 1.2, smoothstep(0.0, 1.0, vT));');
    };
    return m;
  }

  /* --- dark jagged pine: stacked tiers with a ragged, drooping rim */
  function pineGeometry(rng, h, r0) {
    const pos = [], col = [], tiers = 6 + Math.floor(rng() * 3), base = new THREE.Color(), dark = C(PAL.trunk);
    const tc = C(PAL.pine[Math.floor(rng() * PAL.pine.length)]);
    const quad = (a, b, c, cl) => { pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b); };
    // trunk
    const tr = h * 0.022 + 0.08, seg = 5;
    for (let s = 0; s < seg; s++) { const a0 = (s / seg) * 6.283, a1 = ((s + 1) / seg) * 6.283; const p0 = [Math.cos(a0) * tr, 0, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, 0, Math.sin(a1) * tr], q0 = [Math.cos(a0) * tr * 0.5, h * 0.4, Math.sin(a0) * tr * 0.5], q1 = [Math.cos(a1) * tr * 0.5, h * 0.4, Math.sin(a1) * tr * 0.5]; quad(p0, q0, p1, dark); quad(p1, q0, q1, dark); }
    for (let k = 0; k < tiers; k++) {
      const f = k / tiers, y0 = h * (0.16 + f * 0.74), y1 = y0 + h * (0.26 - f * 0.08), rr = r0 * (1 - f * 0.82) * (0.9 + rng() * 0.2), n = 11;
      base.copy(tc).multiplyScalar(0.82 + f * 0.35);
      const rim = []; for (let s = 0; s < n * 2; s++) { const a = (s / (n * 2)) * 6.283 + k * 0.4, jag = s % 2 ? 0.62 : 1, rj = rr * jag * (0.85 + rng() * 0.3); rim.push([Math.cos(a) * rj, y0 - (s % 2 ? -0.1 : 0.25) * rr * 0.4, Math.sin(a) * rj]); }
      for (let s = 0; s < rim.length; s++) { const p = rim[s], q = rim[(s + 1) % rim.length]; quad(p, [0, y1, 0], q, base); quad(q, [0, y0 + 0.1, 0], p, base.clone().multiplyScalar(0.55)); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }

  /* --- leaf-cloud larch: a few bare branches, thousands of small leaves in round clusters. Leaf normals come from the
     cluster centre, so the whole cloud shades like a soft ball while every leaf keeps its own sparkle of colour */
  function larchGeometry(rng, h) {
    const pos = [], nor = [], col = [], trunk = C(PAL.trunk);
    const tri = (a, b, c, n, cl) => { pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n); for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b); };
    // trunk + branches as thin prisms
    const limb = (a, b, r) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(), u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const s1 = new THREE.Vector3().crossVectors(d, u).normalize(), s2 = new THREE.Vector3().crossVectors(d, s1).normalize();
      for (let k = 0; k < 4; k++) { const a0 = (k / 4) * 6.283, a1 = ((k + 1) / 4) * 6.283; const o0 = s1.clone().multiplyScalar(Math.cos(a0) * r).add(s2.clone().multiplyScalar(Math.sin(a0) * r)), o1 = s1.clone().multiplyScalar(Math.cos(a1) * r).add(s2.clone().multiplyScalar(Math.sin(a1) * r)); const n = o0.clone().add(o1).normalize().toArray();
        tri([a[0] + o0.x, a[1] + o0.y, a[2] + o0.z], [b[0] + o0.x * 0.4, b[1] + o0.y * 0.4, b[2] + o0.z * 0.4], [a[0] + o1.x, a[1] + o1.y, a[2] + o1.z], n, trunk);
        tri([a[0] + o1.x, a[1] + o1.y, a[2] + o1.z], [b[0] + o0.x * 0.4, b[1] + o0.y * 0.4, b[2] + o0.z * 0.4], [b[0] + o1.x * 0.4, b[1] + o1.y * 0.4, b[2] + o1.z * 0.4], n, trunk); }
    };
    const top = [rng() * 0.6 - 0.3, h, rng() * 0.6 - 0.3]; limb([0, 0, 0], top, h * 0.025 + 0.06);
    const clusters = [];
    const nb = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < nb; k++) {
      const y = h * (0.38 + 0.5 * rng()), a = rng() * 6.283, L = h * (0.18 + 0.16 * rng()) * (1.15 - y / h * 0.6);
      const p0 = [top[0] * y / h, y, top[2] * y / h], p1 = [p0[0] + Math.cos(a) * L, y + L * 0.45, p0[2] + Math.sin(a) * L];
      limb(p0, p1, h * 0.009 + 0.03); clusters.push({ c: p1, r: h * (0.13 + 0.07 * rng()) });
    }
    clusters.push({ c: [top[0], h * 0.93, top[2]], r: h * 0.17 }); clusters.push({ c: [top[0] * 0.6, h * 0.72, top[2] * 0.6], r: h * 0.22 });
    const pal = PAL.larch.map(C), tmp = new THREE.Color(), sz = 0.1 + h * 0.004;
    for (const cl of clusters) {
      const n = Math.floor(cl.r * cl.r * 150);
      for (let k = 0; k < n; k++) {
        // points mostly near the surface of the ball, a few inside
        const u = rng() * 2 - 1, th = rng() * 6.283, rr = cl.r * (0.55 + 0.45 * Math.cbrt(rng())), sq = Math.sqrt(1 - u * u);
        const dx = sq * Math.cos(th), dy = u * 0.8, dz = sq * Math.sin(th);
        const cx = cl.c[0] + dx * rr, cy = cl.c[1] + dy * rr, cz = cl.c[2] + dz * rr;
        const nn = new THREE.Vector3(dx, dy + 0.25, dz).normalize().toArray();
        tmp.copy(pal[Math.floor(rng() * pal.length)]).multiplyScalar(0.55 + 0.6 * (rr / cl.r) * (0.75 + 0.25 * (dy + 1) / 2));
        const ax = rng() * 6.283, ay = rng() * 6.283, s = sz * (0.7 + rng() * 0.6);
        const e1 = [Math.cos(ax) * s, Math.sin(ay) * s * 0.6, Math.sin(ax) * s], e2 = [-Math.sin(ax) * s * 0.7, Math.cos(ay) * s * 0.7, Math.cos(ax) * s * 0.7];
        tri([cx + e1[0], cy + e1[1], cz + e1[2]], [cx + e2[0], cy + e2[1], cz + e2[2]], [cx - e1[0], cy - e1[1], cz - e1[2]], nn, tmp);
        tri([cx - e1[0], cy - e1[1], cz - e1[2]], [cx - e2[0], cy - e2[1], cz - e2[2]], [cx + e1[0], cy + e1[1], cz + e1[2]], nn, tmp);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  function mergeAt(list) {     // [{geo, x, y, z, ry, s}] -> one geometry
    let n = 0; for (const it of list) n += it.geo.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3); let o = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (const it of list) {
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry), new THREE.Vector3(it.s, it.s, it.s)); nm.getNormalMatrix(m);
      const pa = it.geo.attributes.position, na = it.geo.attributes.normal, ca = it.geo.attributes.color;
      for (let k = 0; k < pa.count; k++, o++) {
        v.fromBufferAttribute(pa, k).applyMatrix4(m); P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
        v.fromBufferAttribute(na, k).applyMatrix3(nm).normalize(); N[o * 3] = v.x; N[o * 3 + 1] = v.y; N[o * 3 + 2] = v.z;
        Cc[o * 3] = ca.getX(k); Cc[o * 3 + 1] = ca.getY(k); Cc[o * 3 + 2] = ca.getZ(k);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    g.computeBoundingSphere(); return g;
  }

  /* --- old foliage out of the way inside the radius; returns where the trees stood */
  function clearOld(scene, cx, cz, R) {
    const spots = [], seen = new Set(), m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    scene.traverse((o) => {
      if (!o.isInstancedMesh || o.userData.lookNew) return;
      const nm = (o.material && o.material.name) || '';
      if (!/kk_tree|kk_bush|kk_grass|Lea|Leaf|Bark|Wood|Trunk|tree|conifer|pine|grass|bush/i.test(nm)) return;
      const tree = /kk_tree|Lea|Leaf|Bark|Wood|Trunk|tree|conifer|pine/i.test(nm);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m); const d = Math.hypot(p.x - cx, p.z - cz);
        if (d < R) { o.setMatrixAt(i, zero); if (tree) { const k = Math.round(p.x) + ',' + Math.round(p.z); if (!seen.has(k)) { seen.add(k); spots.push([p.x, p.y, p.z]); } } }
      }
      o.instanceMatrix.needsUpdate = true;
    });
    return spots;
  }

  /* ================================================================== whole-track version */
  const SUN = new THREE.Vector3(-0.55, 0.23, 0.70).normalize();
  const WARM = [1.0, 0.77, 0.56], COOL = [0.80, 0.74, 0.86];
  const v3 = (a) => 'vec3(' + a.map((x) => x.toFixed(3)).join(', ') + ')';
  // fog and haze take their colour from where you look: golden toward the sun, lavender away from it
  function patchFog() {
    const ch = THREE.ShaderChunk; if (ch._lookFog) return; ch._lookFog = true;
    ch.fog_fragment = `#ifdef USE_FOG
      vec3 lkVd = normalize(vFogWP - cameraPosition);
      float lkSd = dot(lkVd, ${v3(SUN.toArray())}) * 0.5 + 0.5;
      vec3 lkFc = mix(${v3(COOL)}, ${v3(WARM)}, pow(lkSd, 1.6));
      float lkF = (1.0 - exp(-max(fogDepth - fogNear, 0.0) / fogFar * 2.6)) * 0.97;
      float lkH = smoothstep(${AX.passFog ? AX.passFog.h0.toFixed(1) : '55.0'}, ${AX.passFog ? AX.passFog.h1.toFixed(1) : '150.0'}, vFogWP.y) * smoothstep(30.0, 400.0, fogDepth) * 0.55;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, lkFc, clamp(max(lkF, lkH), 0.0, 1.0));
    #endif`;
  }
  function skyMaterial2() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){ vec3 d = normalize(vP); vec3 S = ${v3(SUN.toArray())};
          float sd = dot(d, S) * 0.5 + 0.5, h = clamp(d.y, 0.0, 1.0);
          vec3 hor = mix(${v3(COOL)}, ${v3(WARM)}, pow(sd, 1.6));
          vec3 top = mix(vec3(0.42, 0.52, 0.76), vec3(0.62, 0.62, 0.84), pow(sd, 3.0));
          vec3 c = mix(hor, top, pow(h, 0.5));
          float s = max(dot(d, S), 0.0); c += vec3(1.0, 0.86, 0.62) * (pow(s, 8.0) * 0.35 + pow(s, 80.0) * 0.5 + pow(s, 1200.0) * 2.0);
          c = mix(c, hor, clamp(-d.y * 6.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0); }`
    });
  }

  // grass blades: wider in the distance (they get thinned out there), faded in at the edge of the grass range
  function grassMaterial2() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide }); m.userData.lookDone = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWindT = AX.windT || (AX.windT = { value: 0 });
      sh.vertexShader = 'attribute float aT; varying float vT; uniform float uWindT;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vT = aT;
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float cd = distance(ip, cameraPosition);
            transformed.x *= 1.0 + cd / 16.0;
            transformed.y *= 1.0 - smoothstep(170.0, 230.0, cd);
            float w = sin(uWindT * 1.7 + ip.x * 0.21 + ip.z * 0.17) * 0.5 + sin(uWindT * 3.1 + ip.x * 0.7) * 0.2;
            transformed.x += w * aT * aT * 0.16; transformed.z += w * aT * aT * 0.09;
          #endif`);
      sh.fragmentShader = 'varying float vT;\n' + sh.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity ); diffuseColor.rgb *= mix(0.6, 1.2, smoothstep(0.0, 1.0, vT));');
    };
    m.customProgramCacheKey = () => 'look-grass';
    return m;
  }

  function applyWorld(world, renderer, post) {
    const sc = world.scene, t = world.track, rng = AX.RNG(777), t0 = performance.now();
    patchFog();
    // ---- light
    world.sunDir.copy(SUN);
    const sun = world.sun; sun.color.copy(C(PAL.sunCol)); sun.intensity = PAL.sunI;
    sun.shadow.mapSize.set(4096, 4096); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    renderer.shadowMap.type = THREE.VSMShadowMap; renderer.toneMappingExposure = 1.12;
    sc.traverse((o) => { if (o.isHemisphereLight) { o.color.copy(C(PAL.hemiSky)); o.groundColor.copy(C(PAL.hemiGround)); o.intensity = PAL.hemiI; } });
    world.sky.material = skyMaterial2(); world.skyFog = null; if (world.backdrop) world.backdrop.visible = true;
    sc.fog.color.copy(C(PAL.fog)); sc.fog.near = 12; sc.fog.far = 340;
    const flat = flattenMaterials(sc);
    // big vertex-coloured ground meshes (terrain, corridor strip): bright greens pulled to the meadow's olive
    const olive = C('#5f7d3e'), tmpC = new THREE.Color(), hs = {};
    sc.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.lookNew || !o.geometry || !o.geometry.attributes.color) return;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere.radius < 6 || g.userData.lookGround) return; g.userData.lookGround = true;
      const ca = g.attributes.color, avg = new THREE.Color(); for (let k = 0; k < ca.count; k++) { avg.r += ca.getX(k); avg.g += ca.getY(k); avg.b += ca.getZ(k); } avg.multiplyScalar(1 / Math.max(1, ca.count));
      for (let k = 0; k < ca.count; k++) {
        tmpC.setRGB(ca.getX(k), ca.getY(k), ca.getZ(k)); tmpC.getHSL(hs);
        const green = clamp(1 - Math.abs(hs.h * 360 - 105) / 50, 0, 1) * clamp(hs.s * 2, 0, 1);
        // greens to the meadow olive; everything else (stone walls, rock) loses some of its contrast
        tmpC.lerp(olive, green * 0.7).lerp(avg, (1 - green) * 0.4); ca.setXYZ(k, tmpC.r, tmpC.g, tmpC.b);
      }
      ca.needsUpdate = true;
    });
    // plain green surfaces (lawns, verges) to the meadow olive; instanced stones (the dry-stone walls) lose some contrast
    sc.traverse((o) => {
      if (!o.isMesh || o.userData.lookNew || !o.material) return;
      for (const m of [].concat(o.material)) { if (!m.color || m.userData.lookGreen) continue; m.color.getHSL(hs); const gr = clamp(1 - Math.abs(hs.h * 360 - 105) / 45, 0, 1) * clamp((hs.s - 0.15) * 3, 0, 1); if (gr > 0) { m.userData.lookGreen = true; m.color.lerp(olive, gr * 0.8); } }
      if (o.isInstancedMesh && o.instanceColor && !/kk_|^Lea/i.test(o.material.name || '')) {
        const ic = o.instanceColor, av = [0, 0, 0]; for (let k = 0; k < o.count; k++) { av[0] += ic.getX(k); av[1] += ic.getY(k); av[2] += ic.getZ(k); }
        for (let j = 0; j < 3; j++) av[j] /= Math.max(1, o.count);
        for (let k = 0; k < o.count; k++) ic.setXYZ(k, lerp(ic.getX(k), av[0], 0.45), lerp(ic.getY(k), av[1], 0.45), lerp(ic.getZ(k), av[2], 0.45));
        ic.needsUpdate = true;
      }
    });
    // ---- old foliage out: remember where the firs stood, drop bushes and grass tufts
    const spots = [], m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
    const seen = new Set(), dead = [];
    sc.traverse((o) => {
      if (!o.isInstancedMesh || o.userData.lookNew) return; const nm = (o.material && o.material.name) || '';
      if (/kk_rock/.test(nm)) { if (!o.material.userData.lookRock) { o.material.userData.lookRock = true; o.material.color.multiply(new THREE.Color(0.78, 0.8, 0.86)); } return; }
      if (!/kk_tree|kk_bush|kk_grass|^Lea|Leaf|Wood|Bark|Trunk/i.test(nm)) return;
      if (/kk_tree|^Lea/.test(nm)) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); m4.decompose(p, q, sv); const k = Math.round(p.x * 2) + ',' + Math.round(p.z * 2); if (!seen.has(k)) { seen.add(k); spots.push([p.x, p.y, p.z, sv.y]); } }
      dead.push(o);
    });
    dead.forEach((o) => { o.visible = false; });
    // ---- tree variants, instanced
    const near = (x, z) => { t.terrainH(x, z); return t.lastRoadD - t.hw; };
    const vcMat = (flatShade, key) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: !!flatShade, side: THREE.DoubleSide }); m.userData.lookDone = true; return m; };
    const PV = 8, LV = 6, pineGeo = [], larchGeo = [];
    for (let k = 0; k < PV; k++) pineGeo.push(pineGeometry(rng, 13 + k * 0.9, 2.6 + (k % 3) * 0.35));
    for (let k = 0; k < LV; k++) larchGeo.push(larchGeometry(rng, 8.5 + k * 0.7));
    const pineSet = pineGeo.map(() => []), larchSet = larchGeo.map(() => []);
    for (const [x, y, z, s] of spots) {
      const d = near(x, z); if (d < 4.5) continue;
      const gold = rng() < (d < 30 ? 0.22 : 0.07) && y < 140;
      const ry = rng() * 6.283, sc2 = clamp(s / 1.7, 0.35, 1.35) * (0.9 + rng() * 0.2);
      if (gold) larchSet[Math.floor(rng() * LV)].push([x, y - 0.2, z, ry, sc2 * 0.95]); else pineSet[Math.floor(rng() * PV)].push([x, y - 0.3, z, ry, sc2]);
    }
    const tint = new THREE.Color(), add = (geo, mat, list, cast, tintFn) => {
      if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); im.userData.lookNew = true; im.castShadow = cast; im.receiveShadow = true;
      list.forEach(([x, y, z, ry, s2], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); sv.set(s2, s2, s2); p.set(x, y, z); m4.compose(p, q, sv); im.setMatrixAt(i, m4); if (tintFn) im.setColorAt(i, tintFn()); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere(); im.frustumCulled = false; sc.add(im);
    };
    const pm = vcMat(true), lm = vcMat(false);
    pineGeo.forEach((g, k) => add(g, pm, pineSet[k], true, () => tint.setHSL(0, 0, 0.82 + rng() * 0.3)));
    larchGeo.forEach((g, k) => add(g, lm, larchSet[k], true, () => tint.setHSL(0, 0, 0.85 + rng() * 0.25)));
    // ---- grass along the road in chunks; each chunk thins out with distance from the camera (see update)
    const blade = bladeGeometry(), gm = grassMaterial2(), chunks = [];
    const lo = C(PAL.grassLo), mid = C(PAL.grassMid), hi = C(PAL.grassHi), dry = C(PAL.grassDry), col = new THREE.Color(), e = new THREE.Euler();
    const fl = PAL.flowers.map(C), flGeo = new THREE.PlaneGeometry(0.07, 0.07), flMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, emissive: new THREE.Color(0x261c12) }); flMat.userData.lookDone = true;
    const CH = 28, N = t.n, ds = t.length / N;
    let total = 0;
    for (let c0 = 0; c0 < N; c0 += CH) {
      const c1 = Math.min(N, c0 + CH), len = (c1 - c0) * ds, cap = Math.round(len * 2 * 330), mats = [], cols = [], fmats = [], fcols = [];
      let cx = 0, cz = 0; for (let i = c0; i < c1; i++) { cx += t.px[i]; cz += t.pz[i]; } cx /= (c1 - c0); cz /= (c1 - c0);
      for (let k = 0; k < cap; k++) {
        const i = c0 + Math.floor(rng() * (c1 - c0)), s = rng() < 0.5 ? 0 : 1, sg = s ? 1 : -1, wall = t.barType[s][i] === 2;
        const dd = rng() < 0.62 ? Math.min(45, -9 * Math.log(1 - rng() * 0.993)) : rng() * 45;
        const edge = t.bar[s][i] + (wall ? 0.7 + 0.06 * t.wallH[s][i] : 0.25), lat = edge + dd, f = rng() - 0.5;
        const x = t.px[i] + t.nx[i] * sg * lat + Math.cos(t.yaw[i]) * f * ds, z = t.pz[i] + t.nz[i] * sg * lat + Math.sin(t.yaw[i]) * f * ds;
        t.terrainH(x, z); if (!(t.lastRoadD > t.hw + 0.35)) continue; const y = world.heightAt(x, z); if (!isFinite(y)) continue;
        const patch = fbm(x * 0.045, z * 0.045), fine = fbm(x * 0.35, z * 0.35), alp = smoothstep(90, 160, y);
        const tall = (0.3 + 0.42 * patch + 0.2 * rng()) * (1 - 0.45 * alp) * smoothstep(0.0, 1.6, dd + 0.3);
        e.set((rng() - 0.5) * 0.5, rng() * 6.283, (rng() - 0.5) * 0.5); q.setFromEuler(e); sv.set(0.9 + rng() * 0.6, tall, 1); p.set(x, y - 0.03, z); m4.compose(p, q, sv);
        mats.push(m4.clone());
        col.copy(lo).lerp(mid, clamp(patch * 1.3, 0, 1)).lerp(hi, clamp((fine - 0.45) * 1.4, 0, 0.75)).lerp(dry, clamp((patch - 0.62) * 2.2 + alp * 0.4, 0, 0.7)).multiplyScalar(0.9 + rng() * 0.2);
        cols.push(col.clone());
        const drift = fbm(x * 0.08 + 40, z * 0.08 - 13);
        if (rng() < Math.pow(clamp((drift - 0.5) * 3, 0, 1), 2) * 0.05) {
          e.set(-Math.PI / 2 + (rng() - 0.5) * 0.6, rng() * 6.283, 0); q.setFromEuler(e); const fs = 0.9 + rng() * 0.8; sv.set(fs, fs, fs); p.set(x, y + 0.15 + tall * 0.6, z); m4.compose(p, q, sv);
          fmats.push(m4.clone()); fcols.push(fl[Math.floor(Math.pow(rng(), 1.6) * fl.length)]);
        }
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(blade, gm, mats.length); im.userData.lookNew = true; im.receiveShadow = true; im.castShadow = false; im.frustumCulled = false;
      mats.forEach((mm, k) => { im.setMatrixAt(k, mm); im.setColorAt(k, cols[k]); }); im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; sc.add(im);
      let fim = null;
      if (fmats.length) { fim = new THREE.InstancedMesh(flGeo, flMat, fmats.length); fim.userData.lookNew = true; fim.frustumCulled = false; fmats.forEach((mm, k) => { fim.setMatrixAt(k, mm); fim.setColorAt(k, fcols[k]); }); fim.instanceMatrix.needsUpdate = true; fim.instanceColor.needsUpdate = true; sc.add(fim); }
      chunks.push({ x: cx, z: cz, r: len * 0.5 + 50, im, cap: mats.length, fim, fcap: fmats.length });
      total += mats.length;
    }
    world.look = { chunks };
    sc.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    post.mFinal.uniforms.uBloom.value = 0.5; post.mFinal.uniforms.uVig.value = 0.26; post.mFinal.uniforms.uSat.value = 1.04;
    return { flat, spots: spots.length, pines: pineSet.reduce((a, l) => a + l.length, 0), larches: larchSet.reduce((a, l) => a + l.length, 0), grass: total, chunks: chunks.length, ms: Math.round(performance.now() - t0) };
  }

  // per frame: near chunks draw every blade, further ones only the first part of their (shuffled) list
  function update(world, cam) {
    const L = world.look; if (!L) return;
    const rb = AX.RiderBatch && AX.RiderBatch.mat; if (rb && !rb.userData.lookBike) { rb.userData.lookBike = true; rb.roughness = 0.9; rb.envMapIntensity = 0.1; rb.needsUpdate = true; }
    for (const c of L.chunks) {
      const d = Math.max(0, Math.hypot(c.x - cam.x, c.z - cam.z) - c.r * 0.6);
      const f = d > 240 ? 0 : clamp((32 / Math.max(32, d)) ** 2, 0.025, 1);
      c.im.visible = f > 0; c.im.count = Math.max(1, Math.round(c.cap * f));
      if (c.fim) { c.fim.visible = d < 120; c.fim.count = Math.max(1, Math.round(c.fcap * Math.min(1, f * 1.5))); }
    }
  }

  function tameBike(root) {
    root.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) { if (!m.isMeshStandardMaterial || m.userData.lookBike) continue; m.userData.lookBike = true; m.envMapIntensity = (m.envMapIntensity || 1) * 0.3; if (!m.transparent && m.roughness > 0.1) m.roughness = Math.max(m.roughness, 0.82); m.metalness *= 0.5; if (m.emissive) m.emissiveIntensity *= 0.5; m.needsUpdate = true; } });
  }
  AX.Look = { applyWorld, update, tameBike, PAL, SUN };
})(window);
