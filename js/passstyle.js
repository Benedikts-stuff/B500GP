/* APEX — the Schwarzhornpass rebuilt in the golden-hour style of the look demo (lookdev.html).
   One ground for everything: the terrain mesh, the grass, the trees and the rocks all read the same 2 m grid,
   so nothing floats or sinks. The road, walls and rails come straight from the track data the physics uses. */
(function () {
  'use strict';
  const AX = window.AX, THREE = window.THREE;
  const { clamp, lerp, smoothstep } = AX;
  const { GeoBuilder, roundedBox, M } = AX.Models;
  const W = AX.worldTex;
  const C = (h) => new THREE.Color(h).convertSRGBToLinear();
  const v3 = (c) => 'vec3(' + [c.r, c.g, c.b].map((x) => x.toFixed(4)).join(',') + ')';
  const v3a = (a) => 'vec3(' + a.map((x) => x.toFixed(4)).join(',') + ')';

  /* ------------------------------------------------------------------ palette (as in the demo) */
  const SUN = new THREE.Vector3(-0.62, 0.22, -0.75).normalize();
  /* Sky and haze colours are written the way they should look on screen. The picture goes through the renderer's filmic
     curve, so toScene() runs that curve backwards: it returns the scene colour that comes out as the given screen colour.
     Sky, haze and the far ridges all use it, which is why the horizon and the mist on the mountains meet in one tone. */
  const EXPOSURE = 1.15;
  const toScene = (hex) => {
    const t = new THREE.Color(hex).convertSRGBToLinear();
    // inverse of ACESFilmicToneMapping (three r128): output matrix, the fitted curve, input matrix, exposure / 0.6
    const y = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602], inv3 = (m, v) => {
      const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
      return [(A * v[0] - (b * i - c * h) * v[1] + (b * f - c * e) * v[2]) / det, (B * v[0] + (a * i - c * g) * v[1] - (a * f - c * d) * v[2]) / det, (Cc * v[0] - (a * h - b * g) * v[1] + (a * e - b * d) * v[2]) / det];
    };
    const q = inv3(y, [t.r, t.g, t.b]).map((v) => { const A = v * 0.983729 - 1, B = v * 0.4329510 - 0.0245786, Cq = v * 0.238081 + 0.000090537; return Math.max(0, (-B - Math.sqrt(Math.max(0, B * B - 4 * A * Cq))) / (2 * A)); });
    const r = inv3([0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777], q).map((v) => Math.max(0, v) * 0.6 / EXPOSURE);
    return new THREE.Color(r[0], r[1], r[2]);
  };
  /* Two skies over the same pass (setting "sky"). Each brings its own light, haze and ridge colours, so everything stays in
     one mood. flag: the fog's near distance tells the shared haze code which sky is up (see below). */
  const SKIES = {
    violet: {   // deep violet dusk, golden light from low in the west: the look the pass was drawn in
      flag: 44.5, sun: C('#ffd2a2'), sunI: 3.2, hemiSky: C('#c9caf2'), hemiGround: C('#a88a62'), hemiI: 1.0,
      top: toScene('#4a5cae'), topSun: toScene('#7b6cb8'), grad: 0.55, hazeWarm: toScene('#f0bf9c'), hazeCool: toScene('#b3a3c8'), fogFar: 460,
      sunDisc: new THREE.Color(9.0, 5.6, 2.9), cloudLit: toScene('#ffc7a0'), cloudShade: toScene('#8573ad'),
      ring: [toScene('#56607c'), toScene('#7c769e'), toScene('#a596bd')]
    },
    blue: {     // late afternoon: clear blue above, pale peach haze, lighter and airier
      flag: 44.6, sun: C('#ffe1bc'), sunI: 3.2, hemiSky: C('#c2d2f6'), hemiGround: C('#a8946e'), hemiI: 1.05,
      top: toScene('#4f8fe0'), topSun: toScene('#86aee6'), grad: 0.4, hazeWarm: toScene('#ecd6bf'), hazeCool: toScene('#c2cde6'), fogFar: 620,
      sunDisc: new THREE.Color(10.0, 8.2, 5.6), cloudLit: toScene('#fff3e0'), cloudShade: toScene('#9fb0d6'),
      ring: [toScene('#5d7189'), toScene('#8597b4'), toScene('#aebcd6')]
    }
  };
  const skyOf = (id) => SKIES[id] || SKIES.violet;
  const P = {
    sun: SKIES.violet.sun, sunI: SKIES.violet.sunI, hemiSky: SKIES.violet.hemiSky, hemiGround: SKIES.violet.hemiGround, hemiI: SKIES.violet.hemiI,
    gDeep: C('#3d6a2c'), gWarm: C('#93a33a'), gDry: C('#c9a64e'), earth: C('#7a6450'), forestFloor: C('#34502a'),
    road: C('#6c6b6a'), roadLine: C('#f2eee6'), shoulder: C('#8d8a85'),
    rock: C('#716b69'), rockLight: C('#867f7a'),
    stoneA: C('#8a8279'), stoneB: C('#a1978a'), cap: C('#b9b0a2'),
    rail: C('#7b8087'), water: C('#4f8fa0'),
    pine: [C('#2f4f3c'), C('#35563f'), C('#2a4738'), C('#3c5c44')], trunk: C('#4a3426'),
    gold: ['#f2b232', '#f7c94a', '#e98f2a', '#ffd86a', '#d9761f'].map(C), maple: ['#ff8a2a', '#ff6d1f', '#ffa640', '#f25a1c', '#ffbf55'].map(C),
    flowers: ['#fffaf0', '#fff6e0', '#fff1a8', '#ffd84d', '#f6b0cf'].map(C),
    ring: [C('#4e6a50'), C('#7e7f9c'), C('#a9a3c4')]
  };
  const SUNV = v3a(SUN.toArray());

  /* ------------------------------------------------------------------ noise shared by JS and GLSL */
  const nA = (x, z) => Math.sin(x + Math.sin(z * 0.73) * 1.7) * Math.cos(z * 0.87 - Math.sin(x * 0.55) * 1.3);
  const GLSL_NOISE = 'float nA(vec2 p){ return sin(p.x + sin(p.y * 0.73) * 1.7) * cos(p.y * 0.87 - sin(p.x * 0.55) * 1.3); }';
  const patchJS = (x, z) => nA(x * 0.021, z * 0.021) * 0.65 + nA(x * 0.057 + 3.1, z * 0.057 - 1.7) * 0.35;
  const dryJS = (x, z) => nA(x * 0.043 - 7.0, z * 0.043 + 2.0);
  const forestJS = (x, z) => nA(x * 0.016 + 11, z * 0.016 - 4) * 0.7 + nA(x * 0.05, z * 0.05) * 0.3;
  const GLSL_GROUND = `${GLSL_NOISE}
    vec3 groundCol(vec2 w){
      float pt = nA(w * 0.021) * 0.65 + nA(w * 0.057 + vec2(3.1, -1.7)) * 0.35;
      float dr = nA(w * 0.043 + vec2(-7.0, 2.0));
      vec3 c = mix(${v3(P.gDeep)}, ${v3(P.gWarm)}, smoothstep(-0.55, 0.75, pt));
      c = mix(c, ${v3(P.gDry)}, smoothstep(0.45, 0.95, dr) * 0.55);
      return c;
    }
    float forestM(vec2 w){ return nA(w * 0.016 + vec2(11.0, -4.0)) * 0.7 + nA(w * 0.05) * 0.3; }`;

  /* ------------------------------------------------------------------ haze: golden toward the sun, lavender away from it.
     Switched on by the style's fog (near = 44.5); every other world keeps its own fog. */
  {
    const ch = THREE.ShaderChunk, orig = ch.fog_fragment, A = SKIES.violet, B = SKIES.blue;
    // one smooth curve by distance and height: mist lies in the valley and thins toward the ridges; never a hard switch.
    // The far slopes keep a little of their own light and shade (cap below 1), so the mountains read as layers
    ch.fog_fragment = `#ifdef USE_FOG
      if (fogNear > 44.4 && fogNear < 44.7) {
        float hzV = step(44.55, fogNear);
        vec3 hzD = normalize(vFogWP - cameraPosition);
        float hzS = clamp(dot(hzD, ${SUNV}) * 0.5 + 0.5, 0.0, 1.0);
        vec3 hzC = mix(mix(${v3(A.hazeCool)}, ${v3(B.hazeCool)}, hzV), mix(${v3(A.hazeWarm)}, ${v3(B.hazeWarm)}, hzV), pow(hzS, 1.7));
        float hzF = 1.0 - exp(-max(fogDepth - 44.5, 0.0) / fogFar);
        hzF *= 1.0 - 0.5 * smoothstep(70.0, 400.0, vFogWP.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hzC, clamp(hzF, 0.0, 0.86));
      } else {
    #endif
    ${orig}
    #ifdef USE_FOG
      }
    #endif`;
  }
  AX.windT = AX.windT || { value: 0 };
  /* ------------------------------------------------------------------ shadows that stand still.
     Two shadow maps, both of the same sun:
       far  - the whole modelled valley in one map, drawn once when the world is built. It never moves, so a shadow out there
              never shifts, appears or changes, however you ride.
       near - a sharper map round the camera for the detail close by. It moves in whole texels of its own grid (see placeNear),
              so every shadow edge stays exactly where it was drawn.
     Between the two lies a wide, soft cross-fade. Both show the same trees and walls, so nothing pops; the edge only gets finer.
     Switched on wherever a scene has exactly two shadow-casting directional lights (only the styled pass does). */
  {
    const ch = THREE.ShaderChunk, line = 'directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
    if (ch.lights_fragment_begin.indexOf(line) < 0) console.warn('passstyle: shadow line not found, shadows stay single-map');
    ch.lights_fragment_begin = ch.lights_fragment_begin.replace(line, `#if NUM_DIR_LIGHT_SHADOWS == 2
			#if UNROLLED_LOOP_INDEX == 0
			if ( directLight.visible && receiveShadow ) {
				vec3 psC = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
				float psE = max( abs( psC.x - 0.5 ), abs( psC.y - 0.5 ) ) * 2.0;
				float psW = ( psC.z < 0.0 || psC.z > 1.0 ) ? 1.0 : smoothstep( 0.55, 0.95, psE );
				float psN = 1.0, psF = 1.0;
				if ( psW < 1.0 ) psN = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
				if ( psW > 0.0 ) psF = getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
				directLight.color *= mix( psN, psF, psW );
			}
			#endif
		#else
		${line}
		#endif`);
  }

  // matt surfaces (meadow, grass, rock): no mirror glare. Looking into the low sun, the standard material would lay a pale sheen
  // over everything that faces up; grass and ground keep their colour instead
  const MATTE = (fs) => fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);');
  /* ------------------------------------------------------------------ materials */
  function terrainMat(box) {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = AX.windT; sh.uniforms.uBox = { value: box };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN; attribute float aRoad; varying float vRoad;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal); vRoad = aRoad;');
      sh.fragmentShader = MATTE(sh.fragmentShader).replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN; varying float vRoad; uniform float uT; uniform vec4 uBox;\n' + GLSL_GROUND)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 g = groundCol(vW.xz);
          // the floor under the forest is darker; the high slopes turn to dry autumn grass
          g = mix(g, ${v3(P.forestFloor)}, smoothstep(0.22, 0.5, forestM(vW.xz)) * smoothstep(8.0, 16.0, vRoad) * 0.55);
          g = mix(g, ${v3(P.gDry)} * 0.95, smoothstep(230.0, 360.0, vW.y + nA(vW.xz * 0.01) * 40.0) * 0.55);
          float steep = smoothstep(0.5, 0.82, 1.0 - vWN.y);
          float rk = nA(vW.xz * 0.09);
          g = mix(g, mix(${v3(P.rock)}, ${v3(P.rockLight)}, 0.5 + 0.5 * rk), steep);
          g = mix(g, ${v3(P.earth)}, smoothstep(0.5, 0.0, vRoad) * 0.45);
          // cloud shadows wander over the mountain sides beyond the valley floor: big soft patches, a few metres a second.
          // Where they lie depends on the place alone (outside the finely modelled ground around the road)
          vec2 cb = max(uBox.xy - vW.xz, 0.0) + max(vW.xz - uBox.zw, 0.0);
          vec2 cw = vW.xz + vec2(uT * 4.2, uT * 2.4);
          float cl = smoothstep(0.05, 0.6, nA(cw * 0.0034) * 0.65 + nA(cw * 0.0012 + vec2(7.0, 3.0)) * 0.35);
          g *= 1.0 - 0.2 * cl * smoothstep(30.0, 240.0, length(cb));
          diffuseColor.rgb = g;`);
    };
    m.customProgramCacheKey = () => 'ps-terrain3';
    return m;
  }
  function roadMat(hw) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRd; varying vec2 vR;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = aRd;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;\n' + GLSL_NOISE)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float l = vR.x, al = abs(l), aa = fwidth(l) * 1.2;
          vec3 c = ${v3(P.road)};
          // two softly polished wheel tracks per lane, a few calm repair patches
          c *= 1.0 - 0.06 * (smoothstep(0.55, 0.0, abs(al - 0.95)) + smoothstep(0.55, 0.0, abs(al - 2.4)));
          c *= 1.0 - 0.05 * smoothstep(0.55, 0.9, nA(vec2(vR.y * 0.11, l * 0.35)));
          float edge = smoothstep(${(hw - 0.34).toFixed(2)} - aa, ${(hw - 0.34).toFixed(2)} + aa, al) * (1.0 - smoothstep(${(hw - 0.18).toFixed(2)} - aa, ${(hw - 0.18).toFixed(2)} + aa, al));
          float dash = step(0.5, fract(vR.y / 9.0)) * (1.0 - smoothstep(0.07 - aa, 0.07 + aa, al));
          c = mix(c, ${v3(P.roadLine)}, max(edge, dash) * 0.88);
          vec3 sh2 = ${v3(P.shoulder)} * (0.94 + 0.08 * nA(vec2(vR.y * 0.4, l * 1.3)));
          c = mix(c, sh2, smoothstep(${hw.toFixed(2)} - aa, ${hw.toFixed(2)} + aa, al));
          diffuseColor.rgb = c;`);
    };
    m.customProgramCacheKey = () => 'ps-road';
    return m;
  }
  // dry-stone wall: flat stones laid in courses that rise and dip a little along the wall; every stone its own length and tone,
  // narrow soft joints, a light upper and a darker lower edge. The pattern is painted once into a real texture (12.8 m x 3.2 m,
  // 320 px per metre, repeating without a seam) and the graphics card filters it like any texture: full detail up close, and
  // with distance it settles evenly, sharp along the courses even at a flat angle. Nothing is switched or faded by hand
  let STONE_TEX = null;
  function stoneTexture(renderer) {
    if (STONE_TEX) return STONE_TEX;
    const W = 4096, H = 1024, PPM = 320, LEN = W / PPM, RH = 0.2, ROWS = Math.round(H / PPM / RH), data = new Uint8Array(W * H * 4);
    const hsh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }, mod = (a, n) => ((a % n) + n) % n;
    const sr = (v) => { v = clamp(v, 0, 1); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255); };
    const kU = 2 * Math.PI / LEN, kV = 2 * Math.PI / (H / PPM), A = P.stoneA, B = P.stoneB;
    // per course: stone count, a shift, and where each stone ends (so courses close exactly after 12.8 m)
    const rows = []; for (let r = 0; r < ROWS; r++) { const n = Math.round(LEN / (0.34 + 0.2 * hsh(r, 3.7))), e = []; for (let i = 0; i <= n; i++) e.push(i + (hsh(mod(i, n), r + 0.37) - 0.5) * 0.64); rows.push({ n, L: LEN / n, off: hsh(r, 9.1), e }); }
    // per stone: its tone
    const tone = rows.map((R, r) => { const t = []; for (let i = 0; i < R.n; i++) { const h1 = hsh(i + 0.3, r * 1.7 + 0.3), h2 = (h1 * 17.13) % 1, h3 = (h1 * 91.7) % 1, k = 0.93 + 0.14 * h2; let cr = (A.r + (B.r - A.r) * h1) * k, cg = (A.g + (B.g - A.g) * h1) * k, cb = (A.b + (B.b - A.b) * h1) * k; if (h3 > 0.8) { cr *= 1.056; cg *= 0.992; cb *= 0.92; } else if (h3 < 0.16) { cr *= 0.944; cg *= 0.968; cb *= 1.024; } t.push([cr, cg, cb]); } return t; });
    const ss = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / PPM, vb = (v + 0.034 * Math.sin(v * kV * 5 + 0.6)) / RH;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / PPM, vw = vb + 0.13 * Math.sin(u * kU * 2) + 0.06 * Math.sin(u * kU * 5 + 1.3), rw = Math.floor(vw), fy = vw - rw, r = mod(rw, ROWS), R = rows[r];
        const xx = u / R.L + R.off; let i = Math.floor(xx); const f = xx - i; i = mod(i, R.n);
        let e0 = R.e[i] - i, e1 = R.e[i + 1] - i;
        if (f < e0) { i = mod(i - 1, R.n); e1 = e0; e0 = R.e[i] - i - 1; } else if (f > e1) { i = mod(i + 1, R.n); e0 = e1; e1 = R.e[i + 1] - i + 1; }
        const dEnd = Math.min(f - e0, e1 - f) * R.L, dEdge = Math.min(dEnd, Math.min(fy, 1 - fy) * RH), joint = 1 - ss(0.0055, 0.0095, dEdge), t = tone[r][i];
        const up = ss(0.78, 1, fy) * (1 - joint), low = 1 - ss(0, 0.3, fy), k = (1 + 0.07 * up - 0.06 * low - 0.05 * (1 - ss(0, 0.03, dEnd))) * (1 - 0.3 * joint), o = (y * W + x) * 4;
        data[o] = sr(t[0] * k); data[o + 1] = sr(t[1] * k); data[o + 2] = sr(t[2] * k); data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); tex.encoding = THREE.sRGBEncoding; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8; tex.needsUpdate = true; tex.metres = [LEN, H / PPM];
    return (STONE_TEX = tex);
  }
  function stoneMat(renderer) {
    const tex = stoneTexture(renderer), m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      // the wall's own coordinates (metres along, metres up) address the texture; the foot of the wall is a little darker
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSt; varying float vFoot;')
        .replace('#include <uv_vertex>', `vUv = aSt / vec2(${tex.metres[0].toFixed(3)}, ${tex.metres[1].toFixed(3)}); vFoot = aSt.y;`);
      sh.fragmentShader = MATTE(sh.fragmentShader).replace('#include <common>', '#include <common>\nvarying float vFoot;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.5, vFoot));');
    };
    m.customProgramCacheKey = () => 'ps-stone4';
    return m;
  }
  function grassMat() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = AX.windT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; attribute vec3 aGN; attribute float aRk; varying float vT; varying vec3 vGW; uniform float uT;')
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * aGN;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vT = aT;
          vec3 ip = instanceMatrix[3].xyz; vGW = ip;
          float cd = distance(ip, cameraPosition);
          transformed.y *= 1.0 - smoothstep(130.0, 220.0, cd);
          // far meadows carry fewer tufts (see update). A tuft does not pop in when its turn comes: it grows out of the ground
          // over the last stretch, each one at its own distance (aRk is its place in the queue)
          float gf = clamp(pow(45.0 / max(45.0, cd), 1.6), 0.1, 1.0);
          transformed.y *= smoothstep(aRk - 0.08, aRk + 0.02, gf);
          transformed.xz *= 1.0 + cd / 22.0;
          float w = sin(uT * 1.6 + ip.x * 0.19 + ip.z * 0.13) * 0.6 + sin(uT * 2.9 + ip.x * 0.6) * 0.25;
          transformed.x += w * aT * aT * 0.11; transformed.z += w * aT * aT * 0.06;`);
      sh.fragmentShader = MATTE(sh.fragmentShader).replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal = normal \* faceDirection;/g, ''))
        .replace('#include <common>', '#include <common>\nvarying float vT; varying vec3 vGW;\n' + GLSL_GROUND)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 g = groundCol(vGW.xz) * diffuseColor.rgb;
          diffuseColor.rgb = g * mix(0.94, 1.24, vT * vT) + vec3(0.012, 0.01, 0.0) * vT;`);
    };
    m.customProgramCacheKey = () => 'ps-grass3';
    return m;
  }

  /* ------------------------------------------------------------------ geometry */
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
  function pineGeometry(rng, h, r0, tiers, n) {
    const pos = [], col = [], dark = P.trunk, tc = P.pine[Math.floor(rng() * P.pine.length)], base = new THREE.Color();
    const tri = (a, b, c, cl) => { pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b); };
    const tr = h * 0.02 + 0.08;
    for (let s = 0; s < 5; s++) { const a0 = (s / 5) * 6.283, a1 = ((s + 1) / 5) * 6.283; const p0 = [Math.cos(a0) * tr, -0.8, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, -0.8, Math.sin(a1) * tr], q0 = [Math.cos(a0) * tr * 0.5, h * 0.45, Math.sin(a0) * tr * 0.5], q1 = [Math.cos(a1) * tr * 0.5, h * 0.45, Math.sin(a1) * tr * 0.5]; tri(p0, q0, p1, dark); tri(p1, q0, q1, dark); }
    for (let k = 0; k < tiers; k++) {
      const f = k / tiers, y0 = h * (0.18 + f * 0.72), y1 = y0 + h * (0.24 - f * 0.07) * (7 / tiers) ** 0.5, rr = r0 * (1 - f * 0.8) * (0.85 + rng() * 0.3);
      base.copy(tc).multiplyScalar(0.78 + f * 0.4);
      const rim = [], jag = []; for (let s = 0; s < n; s++) { const a = (s / n) * 6.283 + k * 0.5 + rng() * 0.3, r2 = rr * (0.8 + rng() * 0.35); rim.push([Math.cos(a) * r2, y0 - r2 * 0.18 - rng() * 0.15, Math.sin(a) * r2]); jag.push(0); }
      const tip = [(rng() - 0.5) * 0.15, y1, (rng() - 0.5) * 0.15];
      for (let s = 0; s < n; s++) { const p = rim[s], q = rim[(s + 1) % n]; tri(p, tip, q, base); tri(q, [0, y0 + 0.2, 0], p, base.clone().multiplyScalar(0.55)); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }
  // deciduous tree as Art of Rally draws them: a slim trunk and a crown of soft, rounded clumps
  function leafTreeGeometry(rng, h, pal) {
    const parts = [], tmp = new THREE.Color();
    const trunk = new THREE.CylinderGeometry(h * 0.018 + 0.04, h * 0.03 + 0.08, h * 0.72 + 0.8, 6, 1); trunk.translate(0, (h * 0.72 + 0.8) / 2 - 0.8, 0);
    const tc = new Float32Array(trunk.attributes.position.count * 3); for (let k = 0; k < tc.length; k += 3) { tc[k] = P.trunk.r; tc[k + 1] = P.trunk.g; tc[k + 2] = P.trunk.b; }
    trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3)); parts.push(trunk.index ? trunk.toNonIndexed() : trunk);
    const R0 = h * 0.3, cy = h * 0.66, base = pal[Math.floor(rng() * pal.length)], blobs = [[0, cy, 0, R0]];
    const nb = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < nb; k++) { const a = (k / nb) * 6.283 + rng() * 0.6, rr = R0 * (0.55 + rng() * 0.3), d = R0 * (0.55 + rng() * 0.35); blobs.push([Math.cos(a) * d, cy + (rng() - 0.35) * R0 * 0.9, Math.sin(a) * d, rr]); }
    blobs.push([(rng() - 0.5) * R0 * 0.4, cy + R0 * 0.75, (rng() - 0.5) * R0 * 0.4, R0 * 0.6]);
    blobs.forEach(([bx, by, bz, r], bi) => {
      const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, o = rng() * 50;
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), f = 1 + 0.16 * nA(x * 2.3 + o, z * 2.3 + y * 1.7); p.setXYZ(k, bx + x * r * f, by + y * r * f * 0.86, bz + z * r * f); }
      g.computeVertexNormals();
      const ng = g.index ? g.toNonIndexed() : g, q = ng.attributes.position, c = new Float32Array(q.count * 3), bc = tmp.copy(pal[Math.floor(rng() * pal.length)]).lerp(base, 0.5).clone();
      for (let k = 0; k < q.count; k++) {
        const ly = (q.getY(k) - (cy - R0)) / (R0 * 2.2), out = Math.hypot(q.getX(k), q.getZ(k)) / (R0 * 1.4), sh = clamp(0.62 + 0.42 * ly + 0.12 * out, 0.5, 1.12) * (0.95 + 0.1 * rng());
        c[k * 3] = bc.r * sh; c[k * 3 + 1] = bc.g * sh; c[k * 3 + 2] = bc.b * sh;
      }
      ng.setAttribute('color', new THREE.BufferAttribute(c, 3)); if (ng.attributes.uv) ng.deleteAttribute('uv'); parts.push(ng);
    });
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function rockGeometry(rng) {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, o = rng() * 100;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k), s = 1 + 0.22 * nA(x * 2.1 + o, z * 2.1 - o) + 0.12 * nA(y * 3.3 + o, x * 2.7);
      p.setXYZ(k, x * s * 1.25, y * s * 0.72, z * s);
    }
    g.computeVertexNormals(); return g;
  }
  // one leaf: a small kite folded along its rib, about 17 cm long
  function leafGeometry() {
    const g = new THREE.BufferGeometry(), L = 0.17;
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5 * L, 0.3 * L, 0.07 * L, 0, 0, 0, -0.5 * L, -0.3 * L, 0.07 * L, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }
  const LEAF_FRAG = (fs) => MATTE(fs).replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal = normal \* faceDirection;/g, ''));
  // leaves in the air. Each one belongs to a tree for good: it lets go in the crown, flutters down with the wind, lies for a moment
  // and shrinks away; then the same leaf starts again. All of it runs on the clock in the vertex shader (no per-frame work),
  // and nothing about it depends on how far away the camera is
  function fallingLeafMat() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = AX.windT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aA; attribute vec3 aB; attribute vec4 aP; attribute vec3 aC; uniform float uT; varying vec3 vLC;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `float lt = fract(uT / aP.y + aP.x), fall = smoothstep(0.0, 0.86, lt), air = 1.0 - smoothstep(0.8, 0.86, lt);
          vec3 lc = mix(aA, aB, fall);
          lc.x += sin(lt * 21.0 + aP.w * 6.3) * aP.z * air; lc.z += cos(lt * 16.0 + aP.w * 4.1) * aP.z * air; lc.y += sin(lt * 34.0 + aP.w * 9.0) * 0.07 * air;
          float a1 = (lt * 31.0 * (0.5 + aP.w) + aP.w * 20.0) * air, a2 = lt * 19.0 * air + aP.w * 40.0;
          vec3 lq = position * (2.3 * smoothstep(0.0, 0.04, lt) * (1.0 - smoothstep(0.93, 1.0, lt)));      // drawn large, like everything small in this style; one size at every distance
          lq = vec3(lq.x, lq.y * cos(a1) - lq.z * sin(a1), lq.y * sin(a1) + lq.z * cos(a1));
          lq = vec3(lq.x * cos(a2) + lq.z * sin(a2), lq.y, -lq.x * sin(a2) + lq.z * cos(a2));
          vec3 transformed = lc + lq; vLC = aC;`);
      sh.fragmentShader = LEAF_FRAG(sh.fragmentShader).replace('#include <common>', '#include <common>\nvarying vec3 vLC;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vLC;');
    };
    m.customProgramCacheKey = () => 'ps-leaf-fall';
    return m;
  }
  // leaves on the ground and leaves whirled up by a bike: plain instances, one fixed size at every distance
  function lyingLeafMat() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });      // a leaf lies on the road, never half in it
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      sh.fragmentShader = LEAF_FRAG(sh.fragmentShader);
    };
    m.customProgramCacheKey = () => 'ps-leaf-lie';
    return m;
  }
  // a geometry that shares another's buffers but carries its own bounds (for frustum-culled instanced chunks)
  function shareGeo(geo, cx, cy, cz, r) {
    const g = new THREE.BufferGeometry(); for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]); if (geo.index) g.setIndex(geo.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r); return g;
  }

  /* ================================================================== the world */
  AX.World.prototype._buildStyled = function () {
    const t = this.track, sc = this.scene, N = t.n, hw = t.hw, rng = AX.RNG(20261119), T0 = performance.now(), self = this;
    this.styled = true; this.startLights = this.startLights || [];

    /* ---- sky, haze, light */
    const K = skyOf(this.skyId); this.skyK = K;
    // the sky runs through the same filmic curve as everything else, and its horizon is the haze colour itself:
    // far slopes fade into exactly the tone that stands behind them
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uTop: { value: K.top }, uTopSun: { value: K.topSun }, uWarm: { value: K.hazeWarm }, uCool: { value: K.hazeCool }, uDisc: { value: K.sunDisc }, uGrad: { value: K.grad } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uTopSun; uniform vec3 uWarm; uniform vec3 uCool; uniform vec3 uDisc; uniform float uGrad; varying vec3 vP;
        void main(){ vec3 d = normalize(vP); vec3 S = ${SUNV};
        float sd = clamp(dot(d, S) * 0.5 + 0.5, 0.0, 1.0), h = clamp(d.y, 0.0, 1.0);
        vec3 hor = mix(uCool, uWarm, pow(sd, 1.7));
        vec3 top = mix(uTop, uTopSun, pow(sd, 3.0));
        vec3 c = mix(hor, top, pow(h, uGrad));
        // the sun: a clean disc with a wide soft glow round it
        float s = max(dot(d, S), 0.0), aa = fwidth(s) * 1.5;
        c += uDisc * (pow(s, 12.0) * 0.022 + pow(s, 120.0) * 0.05 + pow(s, 1400.0) * 0.22);
        c = mix(c, uDisc, smoothstep(0.99955 - aa, 0.99955 + aa, s));
        c = mix(c, hor, clamp(-d.y * 8.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        }`
    }));
    this.sky.material.extensions = { derivatives: true };
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; sc.add(this.sky);
    sc.fog = new THREE.Fog(0xffffff, K.flag, K.fogFar);
    this.hemi = new THREE.HemisphereLight(K.hemiSky, K.hemiGround, K.hemiI); sc.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(K.sun, K.sunI); this.sunDir = SUN.clone();
    const QL = this.q === 'low' ? 0 : this.q === 'medium' ? 1 : 2;       // the graphics level: shadow map and grass density here, resolution in game.js
    // near shadow map: 170 m square round a point ahead of the camera, PCF-soft (edges about two texels wide, so shadows read as shapes)
    const SM = QL === 0 ? 2048 : 4096, NR = 85;
    sun.castShadow = true; sun.shadow.mapSize.set(SM, SM); this.shadowR = NR;
    Object.assign(sun.shadow.camera, { left: -NR, right: NR, top: NR, bottom: -NR, near: 40, far: 540 });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.045; sc.add(sun); sc.add(sun.target);
    {   // the map's own axes: right and up as the shadow camera sees them. The map is only ever moved by whole texels along them,
        // and not at all along the light (that changes depths, never where an edge falls)
      const z = SUN.clone(), r = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize(), u = new THREE.Vector3().crossVectors(z, r), tx = NR * 2 / SM;
      const c = new THREE.Vector3();
      this.placeNear = (x, y, zz) => {
        c.set(x, y, zz); const a = Math.round(c.dot(r) / tx) * tx, b = Math.round(c.dot(u) / tx) * tx, d = c.dot(z);
        sun.target.position.set(r.x * a + u.x * b + z.x * d, r.y * a + u.y * b + z.y * d, r.z * a + u.z * b + z.z * d);
        sun.position.copy(sun.target.position).addScaledVector(z, 320); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
      };
      this._focus = new THREE.Vector3(); this.placeSun = (focus) => { this._focus.set(focus.x, focus.y || 0, focus.z); };
      this.placeNear(t.px[0], t.py[0], t.pz[0]);
    }
    {   // a soft environment for the bike's paint and visor, in the sky's colours
      const pm = new THREE.PMREMGenerator(this.renderer), es = new THREE.Scene();
      const hor = K.hazeCool.clone().lerp(K.hazeWarm, 0.5), envTop = K.top.clone().lerp(K.topSun, 0.35);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 10), new THREE.ShaderMaterial({
        uniforms: { uTop: { value: envTop }, uHor: { value: hor }, uG: { value: P.gDeep } }, side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uG; varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 up=mix(uHor,uTop,pow(max(h,0.0),0.5)); vec3 dn=mix(uHor,uG*0.6,clamp(-h*4.0,0.0,1.0)); vec3 c=mix(dn,up,step(0.0,h)); gl_FragColor=vec4(c,1.0);\n#include <encodings_fragment>\n}'
      })); es.add(dome);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.6, 3.2) })); blob.position.copy(SUN).multiplyScalar(42); es.add(blob);
      this.env = pm.fromScene(es, 0.03).texture; pm.dispose(); dome.geometry.dispose(); blob.geometry.dispose();
    }

    /* ---- the natural ground: the track's terrain, rising to mountain walls around the valley */
    const b = t.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const DF = 20, dfx0 = b.minX - 900, dfz0 = b.minZ - 900, dfnx = Math.ceil((b.maxX - b.minX + 1800) / DF) + 1, dfnz = Math.ceil((b.maxZ - b.minZ + 1800) / DF) + 1, DR = new Float32Array(dfnx * dfnz);
    for (let j = 0; j < dfnz; j++) for (let i = 0; i < dfnx; i++) {
      const x = dfx0 + i * DF, z = dfz0 + j * DF; let m = 1e18;
      for (let k = 0; k < N; k += 3) { const dx = t.px[k] - x, dz = t.pz[k] - z, d = dx * dx + dz * dz; if (d < m) m = d; }
      DR[j * dfnx + i] = Math.sqrt(m);
    }
    const dRoad = (x, z) => {
      const fx = (x - dfx0) / DF, fz = (z - dfz0) / DF;
      if (fx < 0 || fz < 0 || fx >= dfnx - 1 || fz >= dfnz - 1) return 900 + Math.max(0, Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)) - 900);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * dfnx + i;
      return (DR[k] * (1 - u) + DR[k + 1] * u) * (1 - v) + (DR[k + dfnx] * (1 - u) + DR[k + dfnx + 1] * u) * v;
    };
    const rise = (x, z) => {
      const d = dRoad(x, z), r = smoothstep(150, 760, d);
      return Math.pow(r, 1.4) * (300 + 70 * nA(x * 0.004, z * 0.004)) + smoothstep(320, 900, d) * (nA(x * 0.011 + 3, z * 0.011) * 45 + nA(x * 0.031, z * 0.031 + 7) * 12);
    };
    let carved = false;
    const ridge = AX.trackUtil.ridge;
    const natAt = (x, z) => {
      let h = t.terrainH(x, z); carved = t.lastCarve;
      const rg = ridge(x * 0.003, z * 0.003) * 70 - 20, dOld = t.lastRoadD;
      h += rg * (smoothstep(60, 500, dRoad(x, z)) - smoothstep(60, 500, dOld));
      return h + rise(x, z);
    };

    /* ---- the fine ground: 2 m grid; road bed cut and filled in smoothly, blended between neighbouring legs */
    const GSTEP = 2, M0 = 170;
    const gx0 = Math.floor((b.minX - M0) / GSTEP) * GSTEP, gz0 = Math.floor((b.minZ - M0) / GSTEP) * GSTEP;
    const gnx = Math.ceil((b.maxX + M0 - gx0) / GSTEP) + 1, gnz = Math.ceil((b.maxZ + M0 - gz0) / GSTEP) + 1, NV = gnx * gnz;
    const gx1 = gx0 + (gnx - 1) * GSTEP, gz1 = gz0 + (gnz - 1) * GSTEP;
    const NAT = new Float32Array(NV), CARVE = new Uint8Array(NV);
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) { const v = j * gnx + i; NAT[v] = natAt(gx0 + i * GSTEP, gz0 + j * GSTEP); CARVE[v] = carved ? 1 : 0; }
    const SW = new Float64Array(NV), SF = new Float64Array(NV), BD = new Float32Array(NV).fill(1e9), GE = new Float32Array(NV).fill(99), GW = new Uint8Array(NV);
    const R = 22, sIdx = t.stream ? t.stream.idx : -999;
    for (let i = 0; i < N; i++) {
      const px = t.px[i], pz = t.pz[i], nx = t.nx[i], nz = t.nz[i], y = t.py[i], nearStream = Math.abs(i - sIdx) < 30;
      const ix0 = Math.max(0, Math.floor((px - R - gx0) / GSTEP)), ix1 = Math.min(gnx - 1, Math.ceil((px + R - gx0) / GSTEP));
      const iz0 = Math.max(0, Math.floor((pz - R - gz0) / GSTEP)), iz1 = Math.min(gnz - 1, Math.ceil((pz + R - gz0) / GSTEP));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const dx = gx0 + ix * GSTEP - px, dz = gz0 + iz * GSTEP - pz, d2 = dx * dx + dz * dz; if (d2 > R * R) continue;
        const d = Math.sqrt(d2), lat = dx * nx + dz * nz, s = lat >= 0 ? 1 : 0, e = Math.abs(lat), bar = t.bar[s][i], wall = t.barType[s][i] === 2, v = iz * gnx + ix, nat = NAT[v];
        let F;
        if (nearStream && CARVE[v]) F = nat;
        else if (e < bar + 0.3) F = y - 0.12;
        else if (wall) F = e < bar + 3 ? y - 0.12 : lerp(y + t.wallH[s][i] + 0.06, nat, smoothstep(bar + 3, bar + 14, e));
        else F = lerp(y - 0.1, nat, smoothstep(bar + 0.5, bar + 14, e));
        const q = 1 / (d + 0.5), q2 = q * q, w = q2 * q2 * q2; SW[v] += w; SF[v] += w * F;
        if (d < BD[v]) { BD[v] = d; GE[v] = e - bar; GW[v] = wall ? 1 : 0; }
      }
    }
    const GH = new Float32Array(NV); for (let v = 0; v < NV; v++) GH[v] = SW[v] > 0 ? SF[v] / SW[v] : NAT[v];
    // every query interpolates exactly like the mesh triangles: what is placed with surf() sits on what you see
    const surfE = { y: 0, e: 0, w: 0 };
    const surf = (x, z) => {
      const fx = (x - gx0) / GSTEP, fz = (z - gz0) / GSTEP;
      if (fx < 0 || fz < 0 || fx > gnx - 1 || fz > gnz - 1) { surfE.y = natAt(x, z); surfE.e = 99; surfE.w = 0; return surfE; }
      const ix = Math.min(gnx - 2, Math.floor(fx)), iz = Math.min(gnz - 2, Math.floor(fz)), u = fx - ix, v = fz - iz;
      const a = iz * gnx + ix, bb = (iz + 1) * gnx + ix, c = bb + 1, d = a + 1;
      if (u + v <= 1) { surfE.y = GH[a] + (GH[d] - GH[a]) * u + (GH[bb] - GH[a]) * v; surfE.e = GE[a] + (GE[d] - GE[a]) * u + (GE[bb] - GE[a]) * v; }
      else { surfE.y = GH[c] + (GH[bb] - GH[c]) * (1 - u) + (GH[d] - GH[c]) * (1 - v); surfE.e = GE[c] + (GE[bb] - GE[c]) * (1 - u) + (GE[d] - GE[c]) * (1 - v); }
      surfE.w = GW[(v < 0.5 ? iz : iz + 1) * gnx + (u < 0.5 ? ix : ix + 1)];
      return surfE;
    };
    this.surf = surf; this.heightAt = (x, z) => surf(x, z).y;
    const tm = terrainMat(new THREE.Vector4(gx0, gz0, gx1, gz1)); this.terrainMat = tm;
    {   // one set of normals for the whole grid, then tiles of 64 x 64 cells (culled one by one, no seams in the shading)
      const pos = new Float32Array(NV * 3), idx = new Uint32Array((gnx - 1) * (gnz - 1) * 6); let k = 0;
      for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) { const v = j * gnx + i; pos[v * 3] = gx0 + i * GSTEP; pos[v * 3 + 1] = GH[v]; pos[v * 3 + 2] = gz0 + j * GSTEP; }
      for (let j = 0; j < gnz - 1; j++) for (let i = 0; i < gnx - 1; i++) { const a = j * gnx + i, bb = a + gnx, c = bb + 1, d = a + 1; idx[k++] = a; idx[k++] = bb; idx[k++] = d; idx[k++] = bb; idx[k++] = c; idx[k++] = d; }
      const big = new THREE.BufferGeometry(); big.setAttribute('position', new THREE.BufferAttribute(pos, 3)); big.setIndex(new THREE.BufferAttribute(idx, 1)); big.computeVertexNormals();
      const NOR = big.attributes.normal.array; big.dispose();
      const TS = 64;
      for (let tj = 0; tj < gnz - 1; tj += TS) for (let ti = 0; ti < gnx - 1; ti += TS) {
        const nx = Math.min(TS, gnx - 1 - ti) + 1, nz = Math.min(TS, gnz - 1 - tj) + 1, p2 = new Float32Array(nx * nz * 3), n2 = new Float32Array(nx * nz * 3), r2 = new Float32Array(nx * nz), i2 = [];
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = (tj + j) * gnx + ti + i, o = j * nx + i; p2[o * 3] = pos[v * 3]; p2[o * 3 + 1] = pos[v * 3 + 1]; p2[o * 3 + 2] = pos[v * 3 + 2]; n2[o * 3] = NOR[v * 3]; n2[o * 3 + 1] = NOR[v * 3 + 1]; n2[o * 3 + 2] = NOR[v * 3 + 2]; r2[o] = GE[v]; }
        for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, bb = a + nx, c = bb + 1, d = a + 1; i2.push(a, bb, d, bb, c, d); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p2, 3)); g.setAttribute('normal', new THREE.BufferAttribute(n2, 3)); g.setAttribute('aRoad', new THREE.BufferAttribute(r2, 1)); g.setIndex(i2); g.computeBoundingSphere();
        const m = new THREE.Mesh(g, tm); m.receiveShadow = true; m.name = 'psFine'; sc.add(m);
      }
    }
    // outer ground out to the mountain walls, sunk a little wherever the fine grid lies over it
    {
      const S = 1500, st = 20, n = Math.round(S * 2 / st), g = new THREE.PlaneGeometry(S * 2, S * 2, n, n); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
      const p = g.attributes.position, rd = new Float32Array(p.count).fill(99);
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k), inside = x > gx0 + 4 && x < gx1 - 4 && z > gz0 + 4 && z < gz1 - 4; p.setY(k, natAt(x, z) - (inside ? 8 : 0)); }
      g.setAttribute('aRoad', new THREE.BufferAttribute(rd, 1)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, tm); m.receiveShadow = true; m.name = 'psCoarse'; sc.add(m);
    }
    // hazy silhouettes beyond: three rings of ridges. Each takes the sky's own horizon tone for its direction (warm toward the
    // sun, cool away from it) and keeps a share of its own colour: the nearest ring the most, the farthest the least.
    // That gives three clear steps of depth; mist gathers at the foot of every ridge
    {
      const y0 = t.planeH(cx, cz);
      const ring = (R2, hMin, hMax, col, seed, keep) => {
        const n = 720, pos = [], idx = [];
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * 6.283, ca = Math.cos(a), sa = Math.sin(a);
          const pk = (f, o) => 1 - Math.abs(nA(ca * f + o + seed, sa * f - o));
          const rid = hMin + (hMax - hMin) * clamp(Math.pow(pk(4.0, 0.3), 1.6) * 0.55 + Math.pow(pk(11.0, 2.1), 2.0) * 0.32 + pk(29.0, 5.7) * 0.13, 0, 1);
          pos.push(cx + Math.cos(a) * R2, y0 - 100, cz + Math.sin(a) * R2, cx + Math.cos(a) * R2 * 0.97, y0 + rid, cz + Math.sin(a) * R2 * 0.97);
          if (k < n) { const bb = k * 2; idx.push(bb, bb + 1, bb + 2, bb + 1, bb + 3, bb + 2); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
          side: THREE.DoubleSide, fog: false,
          uniforms: { uCol: { value: col }, uWarm: { value: K.hazeWarm }, uCool: { value: K.hazeCool }, uKeep: { value: keep }, uY: { value: new THREE.Vector2(y0, y0 + hMax) } },
          vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: `uniform vec3 uCol; uniform vec3 uWarm; uniform vec3 uCool; uniform float uKeep; uniform vec2 uY; varying vec3 vW;
            void main(){ vec3 d = normalize(vW - cameraPosition); float sd = clamp(dot(d, ${SUNV}) * 0.5 + 0.5, 0.0, 1.0);
              vec3 hor = mix(uCool, uWarm, pow(sd, 1.7));
              float k = uKeep * mix(0.35, 1.0, smoothstep(uY.x, uY.y * 0.75, vW.y));
              gl_FragColor = vec4(mix(hor, uCol, k), 1.0);
              #include <tonemapping_fragment>
              #include <encodings_fragment>
            }`
        })); m.renderOrder = -5; m.name = 'psRing'; sc.add(m);
      };
      ring(4700, 350, 1350, K.ring[2], 9.1, 0.3); ring(3600, 300, 950, K.ring[1], 4.7, 0.48); ring(2300, 300, 700, K.ring[0], 1.3, 0.66);
    }

    /* ---- the far shadow map: the whole finely modelled ground in one map, drawn once (see the note on shadows at the top).
       A second sun of no brightness carries it; the shader reads it as the sun's shadow beyond the near map */
    {
      const z = SUN.clone(), r = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize(), u = new THREE.Vector3().crossVectors(z, r), v = new THREE.Vector3();
      let yLo = 1e9, yHi = -1e9; for (let k = 0; k < NV; k++) { if (GH[k] < yLo) yLo = GH[k]; if (GH[k] > yHi) yHi = GH[k]; }
      let r0 = 1e9, r1 = -1e9, u0 = 1e9, u1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const x of [gx0, gx1]) for (const zz of [gz0, gz1]) for (const y of [yLo - 4, yHi + 34]) { v.set(x, y, zz); const a = v.dot(r), b = v.dot(u), d = v.dot(z); r0 = Math.min(r0, a); r1 = Math.max(r1, a); u0 = Math.min(u0, b); u1 = Math.max(u1, b); z0 = Math.min(z0, d); z1 = Math.max(z1, d); }
      const maxT = this.renderer.capabilities.maxTextureSize || 4096, fw = Math.min(maxT, QL === 2 ? 8192 : 4096), fh = fw / 2;
      const far = new THREE.DirectionalLight(0xffffff, 0); far.castShadow = true; far.shadow.mapSize.set(fw, fh);
      const hw2 = (r1 - r0) / 2, hh2 = (u1 - u0) / 2, cr = (r0 + r1) / 2, cu = (u0 + u1) / 2;
      Object.assign(far.shadow.camera, { left: -hw2, right: hw2, top: hh2, bottom: -hh2, near: 20, far: z1 - z0 + 60 });
      far.target.position.set(r.x * cr + u.x * cu + z.x * z0, r.y * cr + u.y * cu + z.y * z0, r.z * cr + u.z * cu + z.z * z0);
      far.position.copy(far.target.position).addScaledVector(z, z1 - z0 + 40);
      // a texel of this map is long on the ground (the sun stands low): lift what is tested a little off the surface, so flat ground never shadows itself
      far.shadow.bias = -0.5 / (z1 - z0 + 40); far.shadow.normalBias = 2.2 * Math.max(2 * hw2 / fw, 2 * hh2 / fh);
      far.shadow.autoUpdate = false; far.shadow.needsUpdate = true;
      sc.add(far); sc.add(far.target); far.target.updateMatrixWorld(); far.updateMatrixWorld(); this.farShadow = far;
      this.shadowInfo = { near: [SM, +(NR * 2 / SM).toFixed(3)], far: [fw, fh, +(2 * hw2 / fw).toFixed(3), +(2 * hh2 / fh).toFixed(3)], box: [Math.round(2 * hw2), Math.round(2 * hh2), Math.round(z1 - z0)] };
    }

    /* ---- clouds: a few low-poly banks far out above the ridges, flat underneath, lit from the sun's side.
       They are real shapes standing in the distance (the ridges cover them properly) and drift very slowly round the valley */
    {
      const crng = AX.RNG(4711), grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.name = 'psClouds';
      const y0 = t.planeH(cx, cz), pos = [], nor = [];
      const blob = (bx, by, bz, rx, ry, rz) => {
        const g = new THREE.IcosahedronGeometry(1, 1), q = g.index ? g.toNonIndexed() : g, a = q.attributes.position, o = crng() * 40;
        for (let k = 0; k < a.count; k++) {
          let x = a.getX(k), y = a.getY(k), z = a.getZ(k); const f = 1 + 0.14 * nA(x * 2.1 + o, z * 2.1 + y * 1.3);
          x *= rx * f; z *= rz * f; y = Math.max(y * f, -0.28) * ry;                 // cut flat below
          pos.push(bx + x, by + y, bz + z);
        }
        if (q !== g) q.dispose(); g.dispose();
      };
      const N_CLOUD = 13;
      for (let c = 0; c < N_CLOUD; c++) {
        const az = (c / N_CLOUD) * 6.283 + (crng() - 0.5) * 0.4, R = 3100 + crng() * 1500, alt = y0 + 1050 + crng() * 750, W = 420 + crng() * 480, H = W * (0.2 + crng() * 0.09);
        const ox = Math.cos(az) * R, oz = Math.sin(az) * R, tx = -Math.sin(az), tz = Math.cos(az), n = 4 + Math.floor(crng() * 4);
        for (let k = 0; k < n; k++) {
          const u = n > 1 ? k / (n - 1) - 0.5 : 0, mid = 1 - Math.abs(u) * 1.5, r = W * (0.2 + 0.16 * crng()) * (0.6 + 0.6 * mid);
          blob(ox + tx * u * W * 1.5 + Math.cos(az) * (crng() - 0.5) * 120, alt, oz + tz * u * W * 1.5 + Math.sin(az) * (crng() - 0.5) * 120, r * 1.25, H * (0.55 + 0.75 * mid) * (0.8 + crng() * 0.4), r);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        fog: false, uniforms: { uLit: { value: K.cloudLit }, uShade: { value: K.cloudShade }, uWarm: { value: K.hazeWarm }, uCool: { value: K.hazeCool } },
        vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uWarm; uniform vec3 uCool; varying vec3 vN; varying vec3 vW;
          void main(){ vec3 n = normalize(vN), d = normalize(vW - cameraPosition);
            float l = dot(n, ${SUNV}) * 0.75 + n.y * 0.45;
            vec3 c = mix(uShade, uLit, smoothstep(-0.15, 0.55, l));
            float sd = clamp(dot(d, ${SUNV}) * 0.5 + 0.5, 0.0, 1.0);
            c = mix(c, mix(uCool, uWarm, pow(sd, 1.7)), 0.3 + 0.35 * (1.0 - smoothstep(0.1, 0.4, d.y)));      // lower in the sky: deeper in the haze
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <encodings_fragment>
          }`
      }));
      m.renderOrder = -7; m.frustumCulled = false; grp.add(m); sc.add(grp); this.cloudBanks = grp;
    }

    /* ---- road: one ribbon from barrier to barrier, asphalt, lines and shoulders drawn in the shader */
    const yaw = (i) => t.yaw[i];
    {
      const pos = [], rdA = [], nor = [], idx = []; let s = 0;
      for (let i = 0; i < N; i++) {
        const L0 = t.bar[0][i] + (t.barType[0][i] === 2 ? 0.05 : 0.3), L1 = t.bar[1][i] + (t.barType[1][i] === 2 ? 0.05 : 0.3), nx = t.nx[i], nz = t.nz[i], y = t.py[i] + 0.02;
        if (i) s += Math.hypot(t.px[i] - t.px[i - 1], t.pz[i] - t.pz[i - 1]);
        pos.push(t.px[i] - nx * L0, y, t.pz[i] - nz * L0, t.px[i] + nx * L1, y, t.pz[i] + nz * L1); rdA.push(-L0, s, L1, s); nor.push(0, 1, 0, 0, 1, 0);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }      // wound to face up: the road takes the sun and the shadows that fall on it
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aRd', new THREE.Float32BufferAttribute(rdA, 2)); g.setIndex(idx);
      const m = new THREE.Mesh(g, roadMat(hw)); m.receiveShadow = true; sc.add(m);
      // an earth skirt below the shoulder on the open side, so you never look under the road edge
      const sp = [], sr = [], si = []; let rows = 0;
      for (const sd of [0, 1]) {
        const sg = sd ? 1 : -1; let prev = false;
        for (let i = 0; i < N; i++) {
          const on = t.barType[sd][i] !== 2 && !(Math.abs(i - sIdx) < 13);
          if (on) {
            const L = t.bar[sd][i] + 0.3, nx = t.nx[i] * sg, nz = t.nz[i] * sg, y = t.py[i];
            sp.push(t.px[i] + nx * L, y + 0.0, t.pz[i] + nz * L, t.px[i] + nx * (L + 0.7), y - 1.2, t.pz[i] + nz * (L + 0.7)); sr.push(1.5, 1.5);
            if (prev) { const a = (rows - 1) * 2; if (sd) si.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            rows++;
          }
          prev = on;
        }
      }
      const sg2 = new THREE.BufferGeometry(); sg2.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg2.setAttribute('aRoad', new THREE.Float32BufferAttribute(sr, 1)); sg2.setIndex(si); sg2.computeVertexNormals();
      const sm = new THREE.Mesh(sg2, tm); sm.receiveShadow = true; sc.add(sm);
    }

    /* ---- dry-stone retaining walls on the hill side, with the ground carried over their top */
    const stripGrass = [], stripCov = new Set(), ckey = (x, z) => Math.floor(x) + ',' + Math.floor(z);
    const covered = (x, z) => stripCov.has(ckey(x, z));
    {
      const face = { p: [], st: [], i: [] }, cap = { p: [], i: [] }, strip = { p: [], r: [], i: [] }, back = { p: [], i: [] };
      const capM = new THREE.MeshStandardMaterial({ color: P.cap, roughness: 0.95, side: THREE.DoubleSide });
      const quadRow = (o, a, bq, flip) => { if (flip) o.push(a, a + 1, bq, a + 1, bq + 1, bq); else o.push(a, bq, a + 1, a + 1, bq, bq + 1); };
      const NC = 6;
      for (const sd of [0, 1]) {
        const sg = sd ? 1 : -1; let run = [];
        const flush = () => {
          if (run.length < 3) { run = []; return; }
          let along = 0;
          const f0 = face.p.length / 3, c0 = cap.p.length / 3, s0 = strip.p.length / 3, b0 = back.p.length / 3;
          run.forEach((i, r) => {
            if (r) along += Math.hypot(t.px[i] - t.px[run[r - 1]], t.pz[i] - t.pz[run[r - 1]]);
            const nx = t.nx[i] * sg, nz = t.nz[i] * sg, y = t.py[i], wh = t.wallH[sd][i], bar = t.bar[sd][i], top = y + wh, lean = 0.06 * wh;
            const P2 = (L, h) => [t.px[i] + nx * L, h, t.pz[i] + nz * L];
            face.p.push(...P2(bar, y - 0.45), ...P2(bar + lean, top)); face.st.push(along, 0, along, wh + 0.45);
            for (const d of [0.5, 2.2]) back.p.push(...P2(bar + d, y - 0.8), ...P2(bar + lean + d, top + 0.04));      // the wall's body, for shadows only (see below)
            const cb = bar + lean + 0.55;
            cap.p.push(...P2(bar + lean - 0.06, top - 0.04), ...P2(bar + lean - 0.06, top + 0.12), ...P2(cb, top + 0.12), ...P2(cb, top - 0.1));
            // ground over the wall top: from the cap back to 6 m behind the wall, joining the grid exactly at its far edge
            const inside = (t.lk[i] > 0) === (sd === 1) && Math.abs(t.lk[i]) > 1e-4, Lmax = Math.max(cb + 1.5, Math.min(bar + 6, inside ? 0.85 / Math.abs(t.lk[i]) : 99));
            for (let k = 0; k < NC; k++) {
              const f = k / (NC - 1), L = cb - 0.05 + (Lmax - cb + 0.05) * f, q = P2(L, 0), g = surf(q[0], q[2]).y;
              const want = lerp(top + 0.06, Math.max(g, top + 0.06 + (natAt(q[0], q[2]) - top) * smoothstep(bar + 3, bar + 14, L)), smoothstep(0.15, 1, f));
              q[1] = k === NC - 1 ? g + 0.02 : Math.max(want, k ? g + 0.03 : top + 0.06);
              strip.p.push(...q); strip.r.push(k ? 6 : 2);
            }
            if (r) {
              const a = f0 + (r - 1) * 2; quadRow(face.i, a, a + 2, sd === 1);
              const bA = b0 + (r - 1) * 4; quadRow(back.i, bA, bA + 4, sd === 1); quadRow(back.i, bA + 2, bA + 6, sd === 1);
              const cA = c0 + (r - 1) * 4; for (let k = 0; k < 3; k++) quadRow(cap.i, cA + k, cA + 4 + k, sd === 1);
              const sA = s0 + (r - 1) * NC; for (let k = 0; k < NC - 1; k++) quadRow(strip.i, sA + k, sA + NC + k, sd === 1);
            }
          });
          // a pier closes each end of a wall: a stone block a little wider and higher than the wall, with its own cap stone.
          // It covers the open end of the face and of the cap, so no wall can be looked into
          for (const [r, dir, u0] of [[0, -1, 0], [run.length - 1, 1, along]]) {
            const i = run[r], nx = t.nx[i] * sg, nz = t.nz[i] * sg, ex = Math.cos(t.yaw[i]) * dir, ez = Math.sin(t.yaw[i]) * dir, y = t.py[i], wh = t.wallH[sd][i], bar = t.bar[sd][i], lean = 0.06 * wh;
            const L0 = bar - 0.06, L1 = bar + lean + 0.62, a0 = -0.22, a1 = 0.55, y0 = y - 0.45, y1 = y + wh + 0.1;
            const Cn = (L, a, h) => [t.px[i] + nx * L + ex * a, h, t.pz[i] + nz * L + ez * a];
            const box = (o, Ls, Le, as, ae, hb, ht, st) => {
              const ring = [[Ls, as], [Ls, ae], [Le, ae], [Le, as]]; let u = u0;
              for (let k = 0; k < 4; k++) {
                const [La, aa] = ring[k], [Lb, ab] = ring[(k + 1) % 4], len = Math.hypot(Lb - La, ab - aa), b = o.p.length / 3;
                o.p.push(...Cn(La, aa, hb), ...Cn(La, aa, ht), ...Cn(Lb, ab, hb), ...Cn(Lb, ab, ht)); o.i.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
                if (st) st.push(u, 0, u, ht - hb, u + len, 0, u + len, ht - hb); u += len;
              }
              for (const h of [hb, ht]) { const b = o.p.length / 3; o.p.push(...Cn(Ls, as, h), ...Cn(Ls, ae, h), ...Cn(Le, as, h), ...Cn(Le, ae, h)); o.i.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); if (st) st.push(u0, 0, u0, 0.6, u0 + 0.7, 0, u0 + 0.7, 0.6); }
            };
            box(face, L0, L1, a0, a1, y0, y1, face.st);
            box(cap, L0 - 0.07, L1 + 0.07, a0 - 0.07, a1 + 0.07, y1, y1 + 0.14, null);
          }
          // grass on the wall-top ground (sampled on the strip itself, so it sits on it)
          for (let r = 1; r < run.length; r++) for (let k = 0; k < NC - 1; k++) {
            const A = s0 + (r - 1) * NC + k, B = A + 1, Cc = A + NC, D = Cc + 1, sp = strip.p;
            const area = Math.hypot(sp[Cc * 3] - sp[A * 3], sp[Cc * 3 + 2] - sp[A * 3 + 2]) * Math.hypot(sp[B * 3] - sp[A * 3], sp[B * 3 + 2] - sp[A * 3 + 2]);
            const cnt = Math.round(area * 9 * (k === 0 ? 0.5 : 1));
            for (let c = 0; c < cnt; c++) {
              const u = rng(), v = rng(), lp = (o) => (sp[A * 3 + o] * (1 - u) + sp[B * 3 + o] * u) * (1 - v) + (sp[Cc * 3 + o] * (1 - u) + sp[D * 3 + o] * u) * v;
              const x = lp(0), y = lp(1), z = lp(2); if (surf(x, z).y > y + 0.06) continue;   // the hill is above the strip here: the hill's own grass covers it
              stripGrass.push([x, y - 0.04, z]);
            }
            for (let u = 0.05; u < 1; u += 0.15) for (let v = 0.05; v < 1; v += 0.15) { const lp = (o) => (sp[A * 3 + o] * (1 - u) + sp[B * 3 + o] * u) * (1 - v) + (sp[Cc * 3 + o] * (1 - u) + sp[D * 3 + o] * u) * v; stripCov.add(ckey(lp(0), lp(2))); }
          }
          // end walls: the cut slope shows as a little rock face where a wall run starts and ends
          for (const [r, dir] of [[0, -1], [run.length - 1, 1]]) {
            const i = run[r], base = strip.p.length / 3, y = t.py[i];
            const ex = Math.cos(t.yaw[i]) * dir, ez = Math.sin(t.yaw[i]) * dir;
            const eb = [];
            for (let k = 0; k < NC; k++) {
              const o = (s0 + r * NC + k) * 3, sy = strip.p[o + 1], hgt = Math.max(0, sy - y), bx = strip.p[o] + ex * (hgt * 2.2 + 0.3), bz = strip.p[o + 2] + ez * (hgt * 2.2 + 0.3);
              const by = Math.min(sy - 0.05, surf(bx, bz).y - 0.25);
              strip.p.push(strip.p[o], sy, strip.p[o + 2], bx, by, bz); strip.r.push(6, 6); eb.push([strip.p[o], sy, strip.p[o + 2], bx, by, bz]);
            }
            for (let k = 0; k < NC - 1; k++) {   // grass on the bank, wherever it stands above the hill
              const [ax, ay, az, bx, by, bz] = eb[k], [cx2, cy2, cz2, dx, dy, dz] = eb[k + 1];
              const area = Math.hypot(bx - ax, bz - az) * Math.hypot(cx2 - ax, cz2 - az), cnt = Math.round(area * 9);
              for (let c = 0; c < cnt; c++) {
                const u = rng(), v = rng(), x = lerp(lerp(ax, bx, v), lerp(cx2, dx, v), u), yy = lerp(lerp(ay, by, v), lerp(cy2, dy, v), u), z = lerp(lerp(az, bz, v), lerp(cz2, dz, v), u);
                if (yy > surf(x, z).y + 0.02) { stripGrass.push([x, yy - 0.04, z]); stripCov.add(ckey(x, z)); }
              }
            }
            for (let k = 0; k < NC - 1; k++) { const a = base + k * 2; if ((dir > 0) !== (sd === 1)) strip.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else strip.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
          }
          run = [];
        };
        for (let i = 0; i < N; i++) { if (t.barType[sd][i] === 2 && Math.abs(i - sIdx) >= 11) run.push(i); else flush(); }
        flush();
      }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(face.p, 3)); fg.setAttribute('aSt', new THREE.Float32BufferAttribute(face.st, 2)); fg.setIndex(face.i); fg.computeVertexNormals();
      sc.add(Object.assign(new THREE.Mesh(fg, stoneMat(this.renderer)), { castShadow: true, receiveShadow: true }));
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cap.p, 3)); cg.setIndex(cap.i); cg.computeVertexNormals();
      sc.add(Object.assign(new THREE.Mesh(cg, capM), { castShadow: true, receiveShadow: true }));
      {   // the wall face is a thin sheet with the hill behind it, and the hill throws no shadow. Two unseen sheets inside the hill
          // stand in for the wall's body, so no sliver of sunlight slips in along the foot of the wall
        const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(back.p, 3)); bg.setIndex(back.i);
        sc.add(Object.assign(new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide })), { castShadow: true, receiveShadow: false, name: 'psWallBody' }));
      }
      const sgm = new THREE.BufferGeometry(); sgm.setAttribute('position', new THREE.Float32BufferAttribute(strip.p, 3)); sgm.setAttribute('aRoad', new THREE.Float32BufferAttribute(strip.r, 1)); sgm.setIndex(strip.i); sgm.computeVertexNormals();
      const stm = tm.clone(); stm.onBeforeCompile = tm.onBeforeCompile; stm.customProgramCacheKey = tm.customProgramCacheKey; stm.polygonOffset = true; stm.polygonOffsetFactor = -1; stm.polygonOffsetUnits = -2; stm.side = THREE.DoubleSide;
      sc.add(Object.assign(new THREE.Mesh(sgm, stm), { receiveShadow: true, castShadow: true }));
    }

    /* ---- W-beam guardrails on the open side, matt so they never glow */
    {
      const profile = [[0.0, 0.52], [0.07, 0.56], [0.03, 0.645], [0.08, 0.71], [0.03, 0.775], [0.07, 0.86], [0.0, 0.9]];
      const pos = [], idx = [], NPf = profile.length;
      const postGB = new GeoBuilder(); postGB.add(new THREE.BoxGeometry(0.1, 1.35, 0.14), M(0.07, 0.25, 0), 0x9a9da2); postGB.add(new THREE.BoxGeometry(0.15, 0.32, 0.12), M(-0.045, 0.71, 0), 0x86898e);
      const postGeo = postGB.build(), posts = [];
      for (const sd of [0, 1]) {
        const sg = sd ? 1 : -1; let prev = false;
        for (let i = 0; i < N; i++) {
          let near = false; for (let o = -3; o <= 3 && !near; o++) { const j = i + o; if (j >= 0 && j < N && t.barType[sd][j] !== 2) near = true; }
          const on = near && i > 6 && i < N - 6 && Math.abs(i - sIdx) > 10, inWall = t.barType[sd][i] === 2;
          if (on) {
            const base = pos.length / 3;
            for (const [dl, h] of profile) { const L = t.bar[sd][i] - (inWall ? 0.14 : 0.1) - dl; pos.push(t.px[i] + t.nx[i] * sg * L, t.py[i] + h, t.pz[i] + t.nz[i] * sg * L); }
            if (prev) for (let k = 0; k < NPf - 1; k++) { const a = base - NPf + k, bb = base + k; if (sd) idx.push(a, a + 1, bb, a + 1, bb + 1, bb); else idx.push(a, bb, a + 1, a + 1, bb, bb + 1); }
            if (i % 4 === 0 && !inWall) posts.push([t.px[i] + t.nx[i] * sg * t.bar[sd][i], t.py[i], t.pz[i] + t.nz[i] * sg * t.bar[sd][i], -yaw(i) + Math.PI / 2 + (sd ? Math.PI : 0)]);
          }
          prev = on;
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      sc.add(Object.assign(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: P.rail, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide })), { castShadow: true, receiveShadow: true }));
      const pm = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), posts.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
      posts.forEach(([x, y, z, ry], k) => { q.setFromAxisAngle(up, ry); m4.compose(pv.set(x, y, z), q, one); pm.setMatrixAt(k, m4); });
      pm.castShadow = true; pm.receiveShadow = true; pm.frustumCulled = false; sc.add(pm);
    }

    /* ---- start gantry with its lights, finish arch, both plain and dark */
    const gate = (i, isStart) => {
      const f = new THREE.Group(); f.position.set(t.px[i], t.py[i], t.pz[i]); f.rotation.y = -t.yaw[i]; const gb = new GeoBuilder(), span = hw + 1.6;
      for (const z of [-span, span]) gb.add(roundedBox(0.4, 5.6, 0.4, 0.06, 2), M(0, 2.8, z), 0x34363b);
      gb.add(roundedBox(0.5, 1.1, span * 2 + 0.4, 0.08, 2), M(0, 5.4, 0), 0x2c2e33);
      const m = new THREE.Mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })); m.castShadow = true; f.add(m);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 0.6, 0.9), new THREE.MeshStandardMaterial({ map: W.textTex(isStart ? 'START' : 'ZIEL · FINISH', isStart ? '#b8322c' : '#26282c', '#f4efe6', 1024, 128), roughness: 0.8, side: THREE.DoubleSide }));
      banner.position.set(-0.27, 5.4, 0); banner.rotation.y = -Math.PI / 2; f.add(banner);
      if (isStart) for (let k = 0; k < 5; k++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0x220806 })); l.position.set(-0.3, 4.55, (k - 2) * 0.8); f.add(l); this.startLights.push(l); }
      sc.add(f);
    };
    gate(t.startIdx, true); gate(t.finishIdx, false);

    /* ---- the stone bridge over the stream, and the water */
    if (t.stream) {
      const S = t.stream, i = S.idx, Tv = new THREE.Vector3(Math.cos(t.yaw[i]), 0, Math.sin(t.yaw[i])), Nn = new THREE.Vector3(t.nx[i], 0, t.nz[i]), UP = new THREE.Vector3(0, 1, 0);
      const O = new THREE.Vector3(t.px[i], t.py[i], t.pz[i]);
      const sm = stoneMat(this.renderer), capM = new THREE.MeshStandardMaterial({ color: P.cap, roughness: 0.95 });
      const Rr = 3.3, base = -5.6, spring = -4.3;
      const withSt = (g, sx, sy) => { const p = g.attributes.position, st = new Float32Array(p.count * 2); for (let k = 0; k < p.count; k++) { st[k * 2] = p.getX(k) * sx; st[k * 2 + 1] = p.getY(k) * sy + 6; } g.setAttribute('aSt', new THREE.BufferAttribute(st, 2)); return g; };
      for (const sd of [0, 1]) {
        const sg = sd ? 1 : -1, lat = t.bar[sd][i] + 0.2;
        const sh = new THREE.Shape(); sh.moveTo(-12, base); sh.lineTo(12, base); sh.lineTo(12, 0.02); sh.lineTo(-12, 0.02); sh.lineTo(-12, base);
        const hole = new THREE.Path(); hole.moveTo(-Rr, base + 0.3); hole.lineTo(-Rr, spring); hole.absarc(0, spring, Rr, Math.PI, 0, true); hole.lineTo(Rr, base + 0.3); hole.lineTo(-Rr, base + 0.3); sh.holes.push(hole);
        const g = withSt(new THREE.ExtrudeGeometry(sh, { depth: 0.55, bevelEnabled: false, curveSegments: 20 }), 1, 1);
        const Z = Nn.clone().multiplyScalar(sg), Mx = new THREE.Matrix4().makeBasis(Tv, UP, Z).setPosition(O.clone().addScaledVector(Z, lat));
        g.applyMatrix4(Mx); g.computeVertexNormals();
        sc.add(Object.assign(new THREE.Mesh(g, sm), { castShadow: true, receiveShadow: true }));
        // on one side the placement mirrors the box: turn its triangles back round, or parapet and cap show their insides and are lit from the wrong side
        const unMirror = (bg) => { if (Mx.determinant() < 0) { const ix = bg.index; for (let k = 0; k < ix.count; k += 3) { const a = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, a); } } return bg; };
        const pg = withSt(new THREE.BoxGeometry(24, 1.0, 0.45), 1, 1); pg.translate(0, 0.5, 0.22); pg.applyMatrix4(Mx); unMirror(pg);
        sc.add(Object.assign(new THREE.Mesh(pg, sm), { castShadow: true, receiveShadow: true }));
        const cg = new THREE.BoxGeometry(24.2, 0.12, 0.6); cg.translate(0, 1.06, 0.22); cg.applyMatrix4(Mx); unMirror(cg); sc.add(Object.assign(new THREE.Mesh(cg, capM), { castShadow: true }));
      }
      {
        const L0 = -(t.bar[0][i] + 0.2), L1 = t.bar[1][i] + 0.2, Pp = [], idx = [], seg = 20;
        for (let k = 0; k <= seg; k++) {
          const a = Math.PI * k / seg, u = Math.cos(a) * Rr, v = spring + Math.sin(a) * Rr;
          for (const L of [L0, L1]) { const p = O.clone().addScaledVector(Tv, u).addScaledVector(UP, v).addScaledVector(Nn, L); Pp.push(p.x, p.y, p.z); }
          if (k) { const a0 = (k - 1) * 2, a1 = k * 2; idx.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); g.setIndex(idx); g.computeVertexNormals();
        sc.add(Object.assign(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C('#6f675e'), roughness: 1, side: THREE.DoubleSide })), { receiveShadow: true }));
      }
      this.streamPts = S;
    }

    /* ---- vegetation and rocks, all standing on surf() */
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color(), eu = new THREE.Euler();
    const instChunks = (geo, mat, list, cell, cast, hMax, tintOn, receive) => {
      const groups = new Map();
      for (const it of list) { const k = Math.floor(it[0] / cell) + ',' + Math.floor(it[2] / cell); (groups.get(k) || groups.set(k, []).get(k)).push(it); }
      let n = 0;
      for (const [, L] of groups) {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const [x, y, z] of L) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const r = Math.hypot(x1 - x0, y1 - y0 + hMax, z1 - z0) / 2 + hMax * 0.6;
        const im = new THREE.InstancedMesh(shareGeo(geo, (x0 + x1) / 2, (y0 + y1) / 2 + hMax * 0.4, (z0 + z1) / 2, r), mat, L.length);
        L.forEach(([x, y, z, ry, s], k) => { qq.setFromAxisAngle(up, ry); sv.set(s, s, s); pv.set(x, y, z); m4.compose(pv, qq, sv); im.setMatrixAt(k, m4); if (tintOn) im.setColorAt(k, tint.setHSL(0, 0, 0.86 + rng() * 0.26)); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = cast; im.receiveShadow = receive !== false; im.frustumCulled = true; sc.add(im); n += L.length;
      }
      return n;
    };
    // where something may stand: clear of the road and the barriers by its radius; never on the wall-top ground (that is its own mesh)
    const clearAt = (x, z, rad) => { if (fenceAt.has(Math.floor(x / 3) + ',' + Math.floor(z / 3))) return null; const g = surf(x, z); if (g.e < rad + 0.6) return null; if (covered(x, z) || covered(x + rad, z) || covered(x - rad, z) || covered(x, z + rad) || covered(x, z - rad)) return null; if (Math.abs(x - t.px[t.startIdx]) < 9 && Math.abs(z - t.pz[t.startIdx]) < 9) return null; if (Math.abs(x - t.px[t.finishIdx]) < 9 && Math.abs(z - t.pz[t.finishIdx]) < 9) return null; return g; };
    const nearStream = (x, z) => t.stream && t.streamDist(x, z) < t.stream.W + 2.5;
    // wooden fences along a few open meadows: round, slightly leaning posts, two rails per span, weathered wood
    const fenceAt = new Set(), fkey = (x, z) => Math.floor(x / 3) + ',' + Math.floor(z / 3);
    {
      const pos = [], col = [], wood = [C('#6c5541'), C('#7a604a'), C('#5e4a39'), C('#846a52')], tmpC = new THREE.Color();
      const addCyl = (a, b, r0, r1, c) => {
        const g = new THREE.CylinderGeometry(r1, r0, 1, 6, 1, false); const d = new THREE.Vector3().subVectors(b, a), L = d.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, L, 1)));
        const ng = g.toNonIndexed(), pp = ng.attributes.position.array;
        for (let k = 0; k < pp.length; k += 3) { pos.push(pp[k], pp[k + 1], pp[k + 2]); const sh = 0.92 + 0.12 * Math.sin(pp[k] * 3.1 + pp[k + 2] * 2.3); col.push(c.r * sh, c.g * sh, c.b * sh); }
        g.dispose(); ng.dispose();
      };
      let runs = 0;
      for (let tries = 0; tries < 400 && runs < 9; tries++) {
        const i0 = 120 + Math.floor(rng() * (N - 360)), sd = rng() < 0.5 ? 0 : 1, sg = sd ? 1 : -1, off = t.bar[sd][i0] + 7 + rng() * 6;
        const pts = [];
        for (let i = i0; i < Math.min(N - 100, i0 + 140); i += 3) {
          const x = t.px[i] + t.nx[i] * sg * off, z = t.pz[i] + t.nz[i] * sg * off, g = surf(x, z), gy = g.y;
          if (g.e < 5 || covered(x, z) || nearStream(x, z) || forestJS(x, z) > 0.3) break;
          const sl = Math.hypot(surf(x + 1, z).y - gy, surf(x, z + 1).y - gy); if (sl > 0.45) break;
          if (pts.length && Math.hypot(x - pts[pts.length - 1][0], z - pts[pts.length - 1][2]) < 1.8) continue;
          pts.push([x, gy, z]);
        }
        if (pts.length < 10) continue;
        if (pts.some(([x, , z]) => fenceAt.has(fkey(x, z)))) continue;
        runs++; (this.fenceSpots || (this.fenceSpots = [])).push([i0, sd, pts.length, +off.toFixed(2)]);
        const top = [];
        pts.forEach(([x, y, z], k) => {
          const c = tmpC.copy(wood[Math.floor(rng() * wood.length)]).clone(), h = 1.12 + rng() * 0.16, lx = (rng() - 0.5) * 0.08, lz = (rng() - 0.5) * 0.08;
          const a = new THREE.Vector3(x, y - 0.35, z), b = new THREE.Vector3(x + lx, y + h, z + lz); addCyl(a, b, 0.07, 0.055, c); top.push(b); (this.fencePosts || (this.fencePosts = [])).push([x, y, z]);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) fenceAt.add(fkey(x + dx * 2.5, z + dz * 2.5));
          if (k) for (const hh of [0.5, 0.92]) {
            const p0 = top[k - 1], p1 = b, y0 = pts[k - 1][1], y1 = y;
            const A = new THREE.Vector3(p0.x, y0 + hh + (rng() - 0.5) * 0.05, p0.z), B = new THREE.Vector3(p1.x, y1 + hh + (rng() - 0.5) * 0.05, p1.z);
            const dir = new THREE.Vector3().subVectors(B, A).normalize(); A.addScaledVector(dir, -0.12); B.addScaledVector(dir, 0.12);
            addCyl(A, B, 0.04, 0.04, tmpC.copy(wood[Math.floor(rng() * wood.length)]).multiplyScalar(0.95).clone());
          }
        });
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
        sc.add(Object.assign(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })), { castShadow: true, receiveShadow: true, name: 'psFence' }));
      }
      this.fenceRuns = runs;
    }
    // trees: forest by noise, meadows open along much of the road, a few golden larches and maples nearer the road
    const pineG = [0, 1, 2, 3, 4].map((k) => pineGeometry(rng, 12 + k * 1.9, 2.6 + (k % 3) * 0.3, 7, 9));
    const leafG = [0, 1, 2, 3].map((k) => leafTreeGeometry(rng, 7.5 + k * 1.3, k % 2 ? P.maple : P.gold));
    const pines = pineG.map(() => []), leafs = leafG.map(() => []);
    for (let x = gx0 + 6; x < gx1 - 6; x += 5.2) for (let z = gz0 + 6; z < gz1 - 6; z += 5.2) {
      const px = x + (rng() - 0.5) * 4.4, pz = z + (rng() - 0.5) * 4.4, f = forestJS(px, pz), s = 0.78 + rng() * 0.5;
      const g = clearAt(px, pz, 2.4 * s + 1.2); if (!g || nearStream(px, pz)) continue;
      const e = g.e, y = g.y, lone = rng() < 0.05 && e < 45;
      // denser further from the road, so the view closes in; open meadow right along it in places
      const thr = 0.3 - 0.25 * smoothstep(30, 120, e) + 0.18 * (1 - smoothstep(6, 22, e));
      if (f < thr && !lone) continue;
      const gx = surf(px + 1.5, pz).y - y, gz = surf(px, pz + 1.5).y - y; if (Math.hypot(gx, gz) / 1.5 > 1.3) continue;
      const leaf = lone || rng() < (e < 30 ? 0.25 : e < 70 ? 0.1 : 0.03);
      if (leaf && e < 110) leafs[Math.floor(rng() * leafs.length)].push([px, y - 0.15, pz, rng() * 6.283, s * 0.95]);
      else pines[Math.floor(rng() * pines.length)].push([px, y - 0.2, pz, rng() * 6.283, s]);
    }
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    let nP = 0, nL = 0;
    // trees throw shadows but take none: a crown is lit by the sun on its own facets alone. Shadow-map shadows on such small, angled
    // faces came out as jagged patches that changed with every step of the map; this way a tree looks the same from any distance
    pineG.forEach((g, k) => { nP += instChunks(g, pm, pines[k], 130, true, 24, true, false); });
    leafG.forEach((g, k) => { nL += instChunks(g, lm, leafs[k], 130, true, 14, true, false); });
    /* ---- leaves of the golden trees near the road: falling, lying underneath, whirled up by passing bikes.
       Medium has fewer, Low none. Counts are fixed per level; the camera's distance plays no part */
    this.leafFx = null;
    if (QL > 0) {
      const lr = AX.RNG(9091), LG = leafGeometry(), dens = QL === 2 ? 1 : 0.55, WIND = [0.83, 0.55];
      const trees = [];
      leafs.forEach((L, k) => { const h = 7.5 + k * 1.3, pal = k % 2 ? P.maple : P.gold; for (const [x, y, z, , sc2] of L) { const e = surf(x, z).e; if (e < 55) trees.push({ x, y, z, cy: y + h * 0.66 * sc2, r: h * 0.3 * sc2, pal, e }); } });
      // where a leaf comes to rest: on the road ribbon inside the barriers, on the ground outside; null where it must not lie
      const rest = (x, z) => {
        if (covered(x, z) || nearStream(x, z)) return null; const g = surf(x, z);
        if (g.e < 0.3) { const i = t.nearest(x, z, -1), lat = Math.abs(t.lateral(i, x, z)); return { y: t.py[i] + 0.05, i, road: true, lane: lat < hw - 0.15 }; }
        return { y: g.y + 0.3, i: -1, road: false, lane: false };      // in the meadow a leaf rests on top of the grass
      };
      const tone = new THREE.Color(), pick = (pal, dull) => tone.copy(pal[Math.floor(lr() * pal.length)]).lerp(P.trunk, dull).multiplyScalar(0.82 + lr() * 0.3);
      // falling
      const A = [], B = [], Pp = [], Cc = [];
      for (const tr of trees) {
        const n = Math.round((tr.e < 25 ? 10 : 5) * dens);
        for (let k = 0; k < n; k++) for (let tries = 0; tries < 4; tries++) {
          const a = lr() * 6.283, rr = tr.r * (0.3 + 0.7 * Math.sqrt(lr())), ax = tr.x + Math.cos(a) * rr, az = tr.z + Math.sin(a) * rr, dr = 1.2 + lr() * 3.2;
          const bx = ax + WIND[0] * dr + (lr() - 0.5) * 1.6, bz = az + WIND[1] * dr + (lr() - 0.5) * 1.6, g = rest(bx, bz);
          if (!g || g.lane) continue;           // never down onto the riding line: nothing drops through the helmet camera's view
          A.push(ax, tr.cy + (lr() - 0.35) * tr.r * 0.8, az); B.push(bx, g.y, bz); Pp.push(lr(), 7 + lr() * 7, 0.22 + lr() * 0.3, lr());
          pick(tr.pal, 0.05); Cc.push(tone.r, tone.g, tone.b); break;
        }
      }
      if (A.length) {
        const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', LG.attributes.position); g.setAttribute('normal', LG.attributes.normal); g.setIndex(LG.index);
        g.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(A), 3)); g.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(B), 3));
        g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(Pp), 4)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(Cc), 3));
        g.instanceCount = A.length / 3;
        const m = new THREE.Mesh(g, fallingLeafMat()); m.frustumCulled = false; m.receiveShadow = true; m.name = 'psLeavesFalling'; sc.add(m);
      }
      // lying: thick under the crown and a little downwind, thinner on the riding line
      const zone = new Float32Array(N), lie = new Map(), lm2 = lyingLeafMat(), CL = 130;
      for (const tr of trees) {
        if (tr.e > 34) continue;
        const n = Math.round((tr.e < 22 ? 150 : 60) * (tr.r / 3) * dens);
        for (let k = 0; k < n; k++) {
          const a = lr() * 6.283, rr = tr.r * 1.75 * Math.sqrt(lr()), x = tr.x + Math.cos(a) * rr + WIND[0] * tr.r * 0.5, z = tr.z + Math.sin(a) * rr + WIND[1] * tr.r * 0.5, g = rest(x, z);
          if (!g || (g.lane && lr() > 0.3)) continue;
          if (g.road) zone[g.i] += g.lane ? 1 : 0.5;
          const key = Math.floor(x / CL) + ',' + Math.floor(z / CL); (lie.get(key) || lie.set(key, []).get(key)).push([x, g.y, z, g.road ? 0.12 : 0.5, pick(tr.pal, 0.22).clone()]);
        }
      }
      // and blown out onto the road next to trees that stand close: along the shoulder and into the near lane
      for (const tr of trees) {
        if (tr.e > 18) continue;
        const i0 = t.nearest(tr.x, tr.z, -1), dx = t.px[i0] - tr.x, dz = t.pz[i0] - tr.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl, n = Math.round(110 * dens * (1 - tr.e / 30));
        for (let k = 0; k < n; k++) {
          const d = tr.e + 0.4 + Math.pow(lr(), 1.4) * (hw * 1.5 + 1.5), sp = (lr() - 0.5) * (7 + tr.r), x = tr.x + ux * d - uz * sp, z = tr.z + uz * d + ux * sp, g = rest(x, z);
          if (!g || !g.road || (g.lane && lr() > 0.45)) continue;
          zone[g.i] += g.lane ? 1 : 0.5;
          const key = Math.floor(x / CL) + ',' + Math.floor(z / CL); (lie.get(key) || lie.set(key, []).get(key)).push([x, g.y, z, 0.12, pick(tr.pal, 0.22).clone()]);
        }
      }
      let nLie = 0;
      for (const [, L] of lie) {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const [x, y, z] of L) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const im = new THREE.InstancedMesh(shareGeo(LG, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 3), lm2, L.length);
        L.forEach(([x, y, z, tilt, c], k) => { eu.set((lr() - 0.5) * tilt, lr() * 6.283, (lr() - 0.5) * tilt); qq.setFromEuler(eu); const s2 = 1.5 + lr() * 0.8; sv.set(s2, s2, s2); pv.set(x, y, z); m4.compose(pv, qq, sv); im.setMatrixAt(k, m4); im.setColorAt(k, c); });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.receiveShadow = true; im.name = 'psLeavesLying'; sc.add(im); nLie += L.length;
      }
      // whirled up: a small pool of leaves that a bike throws up where leaves lie on the road. They start behind the rear wheel only
      const NW = 160, wm = new THREE.InstancedMesh(LG, lm2, NW), W8 = new Float32Array(NW * 12), wcol = new THREE.Color(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let k = 0; k < NW; k++) { wm.setMatrixAt(k, zero); wm.setColorAt(k, wcol.setRGB(1, 1, 1)); }
      wm.frustumCulled = false; wm.receiveShadow = true; wm.name = 'psLeavesWake'; sc.add(wm);
      const zs = new Float32Array(N); for (let i = 0; i < N; i++) { let v = 0; for (let o = -3; o <= 3; o++) v += zone[clamp(i + o, 0, N - 1)]; zs[i] = v; }
      const both = P.gold.concat(P.maple); let wc = 0, live = 0;
      this.leafFx = {
        falling: A.length / 3, lying: nLie, trees: trees.length, zone: zs,
        // b: bike, (rx, rz): its rear contact point, y: road height there. Called once per physics step
        ride(b, rx, rz, y) {
          const d = zs[clamp(b.idx | 0, 0, N - 1)]; if (d < 1 || b.speed < 6 || b.crashed) return;
          if (Math.random() > clamp(d / 14, 0.15, 1) * clamp(b.speed / 32, 0.25, 1) * 0.42) return;
          const k = wc; wc = (wc + 1) % NW; const o = k * 12, c = Math.cos(b.yaw), sn = Math.sin(b.yaw), side = (Math.random() - 0.5) * 2, sp = 1.6 + b.speed * 0.07;
          W8[o] = rx - sn * side * 0.45; W8[o + 1] = y + 0.06; W8[o + 2] = rz + c * side * 0.45;
          W8[o + 3] = c * b.speed * 0.2 - sn * side * sp; W8[o + 4] = 1.1 + Math.random() * 2.4; W8[o + 5] = sn * b.speed * 0.2 + c * side * sp;
          W8[o + 6] = W8[o + 7] = 2.0 + Math.random() * 1.4; W8[o + 8] = Math.random() * 6.283; W8[o + 9] = (Math.random() - 0.5) * 22; W8[o + 10] = y + 0.04; W8[o + 11] = Math.random() * 6.283;
          wm.setColorAt(k, wcol.copy(both[Math.floor(Math.random() * both.length)]).lerp(P.trunk, 0.15));
          wm.instanceColor.needsUpdate = true;
        },
        update(dt) {
          live = 0; const dr = Math.exp(-1.7 * dt);
          for (let k = 0; k < NW; k++) {
            const o = k * 12; if (W8[o + 6] <= 0) continue; W8[o + 6] -= dt;
            if (W8[o + 6] <= 0) { wm.setMatrixAt(k, zero); continue; } live++;
            const down = W8[o + 1] <= W8[o + 10] + 0.001 && W8[o + 4] <= 0;
            if (!down) {
              W8[o + 3] *= dr; W8[o + 5] *= dr; W8[o + 4] = Math.max(W8[o + 4] - 4.6 * dt, -1.5);
              W8[o] += (W8[o + 3] + Math.sin(W8[o + 6] * 7 + W8[o + 11]) * 0.7) * dt; W8[o + 1] += W8[o + 4] * dt; W8[o + 2] += (W8[o + 5] + Math.cos(W8[o + 6] * 6 + W8[o + 11]) * 0.7) * dt;
              W8[o + 8] += W8[o + 9] * dt;
              if (W8[o + 1] <= W8[o + 10]) { W8[o + 1] = W8[o + 10]; W8[o + 4] = 0; W8[o + 6] = Math.min(W8[o + 6], 0.9); }
            }
            const f = Math.min(1, W8[o + 6] / 0.45, (W8[o + 7] - W8[o + 6]) / 0.06) * 1.9;
            eu.set(down ? 0.1 : W8[o + 8], W8[o + 11], down ? 0 : W8[o + 8] * 0.7); qq.setFromEuler(eu); sv.set(f, f, f); pv.set(W8[o], W8[o + 1], W8[o + 2]); m4.compose(pv, qq, sv); wm.setMatrixAt(k, m4);
          }
          wm.instanceMatrix.needsUpdate = true;
        }
      };
    }
    // far forest on the slopes of the outer ground: simple firs, no shadows
    const farG = [0, 1, 2].map((k) => pineGeometry(rng, 14 + k * 2, 3.2, 3, 6)), far = farG.map(() => []);
    for (let x = cx - 1400; x < cx + 1400; x += 9) for (let z = cz - 1400; z < cz + 1400; z += 9) {
      if (x > gx0 + 10 && x < gx1 - 10 && z > gz0 + 10 && z < gz1 - 10) continue;
      const px = x + (rng() - 0.5) * 8, pz = z + (rng() - 0.5) * 8, d = dRoad(px, pz); if (d > 1100) continue;
      const f = forestJS(px, pz), y = natAt(px, pz); if (f < 0.05 + 0.4 * smoothstep(500, 1100, d)) continue;
      const gy = natAt(px + 6, pz) - y, gz = natAt(px, pz + 6) - y; if (Math.hypot(gy, gz) / 6 > 0.9) continue;
      far[Math.floor(rng() * far.length)].push([px, y - 0.6, pz, rng() * 6.283, 0.85 + rng() * 0.5]);
    }
    let nF = 0; farG.forEach((g, k) => { nF += instChunks(g, pm, far[k], 320, false, 26, true, false); });
    // rocks: groups in the meadows, half sunk into the ground; bigger ones on the steep bits
    const rockG = [0, 1, 2, 3].map(() => rockGeometry(rng)), rocks = rockG.map(() => []);
    for (let k = 0; k < 260; k++) {
      const i = Math.floor(rng() * N), sd = rng() < 0.5 ? 1 : -1, d = 6 + rng() * 70, cx2 = t.px[i] + t.nx[i] * sd * d, cz2 = t.pz[i] + t.nz[i] * sd * d, ng = 1 + Math.floor(rng() * 4);
      for (let j = 0; j < ng; j++) {
        const x = cx2 + (rng() - 0.5) * 8, z = cz2 + (rng() - 0.5) * 8, s = 0.45 + rng() * (j ? 0.9 : 1.9), g = clearAt(x, z, s * 1.4 + 0.3); if (!g || nearStream(x, z)) continue;
        rocks[k % 4].push([x, g.y - s * 0.3, z, rng() * 6.283, s]);
      }
    }
    const rm = new THREE.MeshStandardMaterial({ color: P.rock, roughness: 1 });
    let nR = 0; rockG.forEach((g, k) => { nR += instChunks(g, rm, rocks[k], 200, true, 3, true); });

    // grass in 24 m cells near the road, each cell thinned with distance at run time (see update)
    const tuft = tuftGeometry(), gm = grassMat(), CELL = 24, chunks = [], grng = AX.RNG(555);
    const flGeo = new THREE.PlaneGeometry(0.06, 0.06), flMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, emissive: new THREE.Color(0x2a2016) });
    // a flower is a few centimetres across: far away it would be a single bright pixel that twinkles as you move. Like the grass it is
    // drawn wider with distance, and it shrinks to nothing between 70 and 105 m, so flowers neither sparkle nor pop in
    flMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat fcd = distance(instanceMatrix[3].xyz, cameraPosition); transformed *= (1.0 + fcd / 45.0) * (1.0 - smoothstep(70.0, 105.0, fcd));'); };
    flMat.customProgramCacheKey = () => 'ps-flower';
    const cellOf = new Map(); for (const g of stripGrass) { const k = Math.floor((g[0] - gx0) / CELL) + ',' + Math.floor((g[2] - gz0) / CELL); (cellOf.get(k) || cellOf.set(k, []).get(k)).push(g); }
    let total = 0;
    for (let x0 = gx0; x0 < gx1; x0 += CELL) for (let z0 = gz0; z0 < gz1; z0 += CELL) {
      const mid = surf(x0 + CELL / 2, z0 + CELL / 2), sg = cellOf.get(Math.round((x0 - gx0) / CELL) + ',' + Math.round((z0 - gz0) / CELL));
      if (mid.e > 130 + CELL && !sg) continue;
      const mats = [], fl = [], fc = [], gn = []; let y0 = 1e9, y1 = -1e9;
      const cnt = Math.round(CELL * CELL * 9 * (QL === 0 ? 0.5 : QL === 1 ? 0.75 : 1));   // a fixed share per graphics level, the same at every distance
      const put = (x, y, z, hgt, nx, ny, nz) => {
        gn.push(nx, ny, nz);
        eu.set((rng() - 0.5) * 0.2, rng() * 6.283, (rng() - 0.5) * 0.2); qq.setFromEuler(eu); const wd = 0.9 + rng() * 0.35; sv.set(wd, hgt, wd); pv.set(x, y, z); m4.compose(pv, qq, sv); mats.push(m4.clone());
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if (rng() < Math.pow(clamp((nA(x * 0.07 + 40, z * 0.07 - 13) - 0.2) * 1.6, 0, 1), 2) * 0.12) {
          eu.set(-Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * 6.283, 0); qq.setFromEuler(eu); const fs = 0.8 + rng() * 0.7; sv.set(fs, fs, fs); pv.set(x, y + hgt * 0.75 + 0.05, z); m4.compose(pv, qq, sv);
          fl.push(m4.clone()); fc.push(P.flowers[Math.floor(Math.pow(rng(), 1.5) * P.flowers.length)]);
        }
      };
      const tall = (x, z) => (0.45 + 0.35 * (0.5 + 0.5 * patchJS(x, z)) + 0.2 * rng()) * (1 - 0.35 * smoothstep(0.5, 1, dryJS(x, z)));
      for (let k = 0; k < cnt; k++) {
        const x = x0 + rng() * CELL, z = z0 + rng() * CELL, g = surf(x, z), e = g.e;
        if (e < 0.32 || covered(x, z)) continue;
        // denser along the road, thinning into the forest; nothing deep in the woods or on bare rock
        const keep = e < 20 ? 1 : e < 45 ? 0.55 : e < 80 ? 0.3 : e < 130 ? 0.16 : 0; if (rng() > keep * (1 - 0.6 * smoothstep(0.3, 0.6, forestJS(x, z)) * smoothstep(10, 25, e))) continue;
        if (nearStream(x, z) && g.y < natAt(x, z) - 0.2) continue;
        const y = g.y, gx = surf(x + 0.8, z).y - y, gz = surf(x, z + 0.8).y - y; if (Math.hypot(gx, gz) / 0.8 > 1.5) continue;
        const l = Math.hypot(gx / 0.8, 1, gz / 0.8); put(x, y - 0.02, z, tall(x, z) * (0.45 + 0.55 * smoothstep(0.32, 1.2, e)), -gx / 0.8 / l, 1 / l, -gz / 0.8 / l);
      }
      if (sg) for (const [x, y, z] of sg) put(x, y, z, tall(x, z) * 0.9, 0, 1, 0);
      if (!mats.length) continue;
      const cxm = x0 + CELL / 2, czm = z0 + CELL / 2, rr = Math.hypot(CELL / 2, CELL / 2, (y1 - y0) / 2) + 2;
      {   // shuffle the tufts of the cell (the wall-top ones came last and so always appeared last), then number them: the queue for growing in
        const n = mats.length, ord = Array.from({ length: n }, (_, k) => k); for (let k = n - 1; k > 0; k--) { const j = Math.floor(grng() * (k + 1)), q = ord[k]; ord[k] = ord[j]; ord[j] = q; }
        const m2 = ord.map((k) => mats[k]), g2 = new Float32Array(n * 3); ord.forEach((k, o) => { g2[o * 3] = gn[k * 3]; g2[o * 3 + 1] = gn[k * 3 + 1]; g2[o * 3 + 2] = gn[k * 3 + 2]; });
        mats.length = 0; for (const mm of m2) mats.push(mm); gn.length = 0; for (let k = 0; k < g2.length; k++) gn.push(g2[k]);
      }
      const tg = shareGeo(tuft, cxm, (y0 + y1) / 2, czm, rr); tg.setAttribute('aGN', new THREE.InstancedBufferAttribute(new Float32Array(gn), 3));
      { const n = mats.length, rk = new Float32Array(n); for (let k = 0; k < n; k++) rk[k] = (k + 0.5) / n; tg.setAttribute('aRk', new THREE.InstancedBufferAttribute(rk, 1)); }
      const im = new THREE.InstancedMesh(tg, gm, mats.length); im.receiveShadow = true; im.frustumCulled = true;
      mats.forEach((mm, k) => im.setMatrixAt(k, mm)); im.instanceMatrix.needsUpdate = true; sc.add(im);
      let fim = null; if (fl.length) { fim = new THREE.InstancedMesh(shareGeo(flGeo, cxm, (y0 + y1) / 2, czm, rr), flMat, fl.length); fim.frustumCulled = true; fl.forEach((mm, k) => { fim.setMatrixAt(k, mm); fim.setColorAt(k, fc[k]); }); fim.instanceMatrix.needsUpdate = true; fim.instanceColor.needsUpdate = true; sc.add(fim); }
      chunks.push({ x: cxm, z: czm, im, cap: mats.length, fim, fcap: fl.length }); total += mats.length;
    }
    this.styleChunks = chunks;
    this.styleInfo = { ms: Math.round(performance.now() - T0), grid: [gnx, gnz], grass: total, chunks: chunks.length, pines: nP, leafs: nL, far: nF, rocks: nR, shadows: this.shadowInfo, leaves: this.leafFx ? [this.leafFx.trees, this.leafFx.falling, this.leafFx.lying] : 0 };
    {   // draw the far shadow map now, while only the landscape is in the scene: no bike's shadow gets fixed into it
      const rd = this.renderer, rt = new THREE.WebGLRenderTarget(4, 4), c0 = new THREE.PerspectiveCamera(10, 1, 0.1, 1), prev = rd.getRenderTarget();
      c0.position.set(cx, -9000, cz); c0.updateMatrixWorld(); rd.shadowMap.type = THREE.PCFSoftShadowMap;
      rd.setRenderTarget(rt); rd.render(sc, c0); rd.setRenderTarget(prev); rt.dispose();
    }
  };

  /* ------------------------------------------------------------------ renderer settings, per-frame work, the bike */
  let brightOrig = null;
  function applyRenderer(renderer, post, on) {
    const mb = post.mBright; if (brightOrig == null) brightOrig = mb.fragmentShader;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (on) {
      renderer.toneMappingExposure = EXPOSURE;
      // glow comes from light only (the sun, white highlights, brake light and flame), never from a sunlit matt colour:
      // a golden tree must not start to shine as it fills more of the screen
      mb.fragmentShader = brightOrig.replace('gl_FragColor=vec4(c*smoothstep(0.80,1.0,l),1.0);', 'float lm=dot(c,vec3(0.2126,0.7152,0.0722)); float em=c.r*(1.0-smoothstep(0.3,0.55,c.g)); gl_FragColor=vec4(c*smoothstep(0.93,1.0,max(lm,em)),1.0);');
      if (mb.fragmentShader === brightOrig) console.warn('passstyle: glow pass not adjusted');
      post.mFinal.uniforms.uBloom.value = 0.55; post.mFinal.uniforms.uVig.value = 0.24; post.mFinal.uniforms.uSat.value = 1.0;
    } else {
      renderer.toneMappingExposure = 1.0; mb.fragmentShader = brightOrig;
    }
    mb.needsUpdate = true;
  }
  function update(world, cam) {
    const now = AX.windT.value, dt = clamp(now - (world._psT == null ? now : world._psT), 0, 0.05); world._psT = now;
    if (world.leafFx) world.leafFx.update(dt);
    if (world.cloudBanks) world.cloudBanks.rotation.y = AX.windT.value * 0.0011;      // about four metres a second out there: you only notice over a minute
    if (world.placeNear) {      // the near shadow map sits ahead of the camera: most of it covers what you are riding toward
      const f = world._focus, dx = f.x - cam.x, dz = f.z - cam.z, l = Math.hypot(dx, dz), k = l > 0.5 ? Math.min(1, l / 4) * 38 / l : 0;
      world.placeNear(f.x + dx * k, f.y, f.z + dz * k);
    }
    const rb = AX.RiderBatch && AX.RiderBatch.mat; if (rb && !rb.userData.psTame) { rb.userData.psTame = true; rb.roughness = 0.92; rb.envMapIntensity = 0.1; rimLight(rb); rb.needsUpdate = true; }
    const L = world.styleChunks; if (!L) return;
    for (let k = 0; k < L.length; k++) {
      const c = L[k], d = Math.max(0, Math.hypot(c.x - cam.x, c.z - cam.z) - 17);
      const f = d > 235 ? 0 : clamp((45 / Math.max(45, d)) ** 1.6, 0.1, 1);
      c.im.visible = f > 0; c.im.count = Math.max(1, Math.min(c.cap, Math.ceil(c.cap * (f + 0.09))));      // a few more than are up: the shader lets each one grow in
      if (c.fim) c.fim.visible = d < 125;      // all of a cell's flowers or none; the shader has shrunk them away long before
    }
  }
  // edge light on bike and rider: where a surface turns away from the camera on the sun's side, it catches a rim of the sun's
  // colour. That lifts the dark leathers and tyres off the road. It depends only on the viewing angle, never on distance
  function rimLight(m) {
    if (m.userData.psRim || m.transparent) return; m.userData.psRim = true;
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', `#if NUM_DIR_LIGHTS > 0
        { float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          float rimL = smoothstep(-0.3, 0.55, dot(normal, directionalLights[0].direction));
          gl_FragColor.rgb += directionalLights[0].color * (rimF * rimL * 0.15); }
        #endif
        #include <tonemapping_fragment>`);
    };
    m.customProgramCacheKey = () => key + '|ps-rim'; m.needsUpdate = true;
  }
  function tameBike(root) {
    root.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) { if (!m.isMeshStandardMaterial || m.userData.psTame) continue; m.userData.psTame = true; m.envMapIntensity = 0.25; if (!m.transparent && m.roughness > 0.1) m.roughness = Math.max(m.roughness, 0.6); m.metalness *= 0.5; rimLight(m); } });
  }
  AX.PassStyle = { applyRenderer, update, tameBike, SUN, P, SKIES };
})();
