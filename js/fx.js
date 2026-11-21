/* APEX — effects: tyre marks, particles, post-processing. */
(function (root) {
  'use strict';
  const AX = root.AX, THREE = root.THREE;
  const { clamp } = AX;

  /* ---------------------------------------------------------------- tyre marks (ring buffer of quads) */
  class SkidMarks {
    constructor(scene, maxQuads) {
      const Q = this.Q = maxQuads || 9000; this.cur = 0; this.ch = {};
      this.pos = new Float32Array(Q * 12); this.alpha = new Float32Array(Q * 4); const uv = new Float32Array(Q * 8), idx = new Uint32Array(Q * 6);
      for (let q = 0; q < Q; q++) { uv.set([0, 0, 1, 0, 0, 1, 1, 1], q * 8); const v = q * 4; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6); }
      const g = this.geo = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
      const tex = AX.worldTex.canvasTex(32, 4, (c, W, H) => { const gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.22, 'rgba(255,255,255,1)'); gr.addColorStop(0.78, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); });
      this.mesh = new THREE.Mesh(g, AX.decalMaterial(tex, new THREE.Color(0x060607), -3)); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
      this.dirty = false;
    }
    /* id: channel (one per wheel). Call every frame; a = 0 lifts the "pen". */
    mark(id, x, z, width, a, y) {
      let c = this.ch[id]; if (!c) c = this.ch[id] = { on: false, x: 0, z: 0, lx: 0, lz: 0, rx: 0, rz: 0, a: 0 };
      if (a <= 0.02) { c.on = false; return; }
      if (!c.on) { c.on = true; c.x = x; c.z = z; c.has = false; c.a = a; c.y = null; return; }
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz); if (d < 0.22) return; if (d > 6) { c.x = x; c.z = z; c.has = false; return; }
      const nx = -dz / d * width * 0.5, nz = dx / d * width * 0.5; const yy = y || 0.031, py = c.y != null ? c.y : yy;
      const lx = x + nx, lz = z + nz, rx = x - nx, rz = z - nz;
      if (c.has) {
        const q = this.cur; this.cur = (this.cur + 1) % this.Q; const p = this.pos, o = q * 12;
        p[o] = c.lx; p[o + 1] = py; p[o + 2] = c.lz; p[o + 3] = c.rx; p[o + 4] = py; p[o + 5] = c.rz; p[o + 6] = lx; p[o + 7] = yy; p[o + 8] = lz; p[o + 9] = rx; p[o + 10] = yy; p[o + 11] = rz;
        const al = this.alpha, k = q * 4; al[k] = c.a; al[k + 1] = c.a; al[k + 2] = a; al[k + 3] = a; this.dirty = true;
      }
      c.lx = lx; c.lz = lz; c.rx = rx; c.rz = rz; c.x = x; c.z = z; c.a = a; c.y = yy; c.has = true;
    }
    flush() { if (this.dirty) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true; this.dirty = false; } }
    clear() { this.alpha.fill(0); this.ch = {}; this.dirty = true; }
  }

  /* ---------------------------------------------------------------- particles */
  class Particles {
    constructor(scene, max, additive) {
      const N = this.N = max || 1400; this.cur = 0;
      this.p = new Float32Array(N * 3); this.c = new Float32Array(N * 4); this.s = new Float32Array(N);
      this.v = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.grow = new Float32Array(N); this.drag = new Float32Array(N); this.grav = new Float32Array(N); this.a0 = new Float32Array(N);
      const g = this.geo = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(this.c, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1));
      this.mat = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: 'attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC; void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'varying vec4 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard; float a=' + (additive ? '(1.0-r)' : 'smoothstep(1.0,0.25,r)') + '; gl_FragColor=vec4(vC.rgb, vC.a*a); }'
      });
      this.mesh = new THREE.Points(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; scene.add(this.mesh); this.live = 0;
    }
    spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, grow, drag, grav) {
      const i = this.cur; this.cur = (this.cur + 1) % this.N; const o = i * 3, k = i * 4;
      this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z; this.v[o] = vx; this.v[o + 1] = vy; this.v[o + 2] = vz;
      this.life[i] = life; this.max[i] = life; this.s[i] = size; this.c[k] = r; this.c[k + 1] = g; this.c[k + 2] = b; this.c[k + 3] = a; this.a0[i] = a;
      this.grow[i] = grow == null ? 1 : grow; this.drag[i] = drag == null ? 1.5 : drag; this.grav[i] = grav || 0;
    }
    update(dt, scale) {
      this.mat.uniforms.uScale.value = scale; let live = 0;
      for (let i = 0; i < this.N; i++) {
        if (this.life[i] <= 0) continue; this.life[i] -= dt; const o = i * 3;
        if (this.life[i] <= 0) { this.c[i * 4 + 3] = 0; this.s[i] = 0; continue; } live++;
        const dr = Math.exp(-this.drag[i] * dt); this.v[o] *= dr; this.v[o + 2] *= dr; this.v[o + 1] = this.v[o + 1] * dr - this.grav[i] * dt;
        this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
        if (this.p[o + 1] < 0.03) { this.p[o + 1] = 0.03; this.v[o + 1] *= -0.35; }
        this.s[i] += this.grow[i] * dt; const f = this.life[i] / this.max[i]; this.c[i * 4 + 3] = this.a0[i] * Math.min(1, f * 1.6);
      }
      this.live = live; const a = this.geo.attributes; a.position.needsUpdate = true; a.aColor.needsUpdate = true; a.aSize.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.c.fill(0); this.s.fill(0); }
  }

  /* ---------------------------------------------------------------- post: MSAA target, soft bloom, tilt-shift, grade */
  class PostFX {
    constructor(renderer) {
      this.r = renderer; this.enabled = true; this.tilt = 1; this.focusY = 0.5;
      this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); this.scene = new THREE.Scene();
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); this.scene.add(this.quad);
      const vs = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';
      this.mBright = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb; float l=max(c.r,max(c.g,c.b)); if(!(l==l)||l>65000.0){ c=vec3(0.0); l=0.0; } gl_FragColor=vec4(c*smoothstep(0.80,1.0,l),1.0); }' });
      this.mBlur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb*0.227; c+=(texture2D(t,vUv+d*1.385).rgb+texture2D(t,vUv-d*1.385).rgb)*0.316; c+=(texture2D(t,vUv+d*3.231).rgb+texture2D(t,vUv-d*3.231).rgb)*0.070; gl_FragColor=vec4(c,1.0); }' });
      this.mFinal = new THREE.ShaderMaterial({
        uniforms: { t: { value: null }, b: { value: null }, ao: { value: null }, uAO: { value: 0 }, px: { value: new THREE.Vector2() }, uTilt: { value: 1 }, uFocus: { value: 0.5 }, uBloom: { value: 0.5 }, uVig: { value: 0.32 }, uSat: { value: 1.12 }, uHz: { value: new THREE.Vector4() }, uHzR: { value: new THREE.Vector4(0.02, 0.05, 0, 1.6) }, uHzA: { value: 0 } },
        vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: `uniform sampler2D t; uniform sampler2D b; uniform sampler2D ao; uniform float uAO; uniform vec2 px; uniform float uTilt; uniform float uFocus; uniform float uBloom; uniform float uVig; uniform float uSat; uniform vec4 uHz; uniform vec4 uHzR; uniform float uHzA; varying vec2 vUv;
          void main(){
            float r = uTilt * smoothstep(0.24, 0.6, abs(vUv.y - uFocus)) * 1.7;
            // heat haze: the air behind a hot exhaust bends the picture. uHz = plume start/end on screen, uHzR = radius at start/end, time, aspect; uHzA = how far it bends
            vec2 hz = vec2(0.0);
            if (uHzA > 0.0) {
              vec2 ha = vec2((vUv.x - uHz.x) * uHzR.w, vUv.y - uHz.y), hd = vec2((uHz.z - uHz.x) * uHzR.w, uHz.w - uHz.y);
              float hh = clamp(dot(ha, hd) / max(dot(hd, hd), 1e-7), 0.0, 1.0), hm = 1.0 - length(ha - hd * hh) / mix(uHzR.x, uHzR.y, hh);
              if (hm > 0.0) {
                hm = hm * hm * (3.0 - 2.0 * hm) * (1.0 - 0.7 * hh) * smoothstep(0.0, 0.12, hh);
                vec2 hs = ha / uHzR.x * 2.6; float ht = uHzR.z;
                hz = vec2(sin(hs.y * 3.3 - ht * 13.0 + sin(hs.x * 2.6 + ht * 7.0) * 1.8) / uHzR.w, sin(hs.x * 3.9 + ht * 10.0 + sin(hs.y * 2.9 - ht * 9.0) * 1.6)) * uHzA * hm;
              }
            }
            vec3 c = texture2D(t, vUv + hz).rgb;
            if (r > 0.05) {
              c *= 0.2; vec2 o = px * r;
              c += texture2D(t, vUv + o * vec2( 1.0,  0.35)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-1.0, -0.35)).rgb * 0.1;
              c += texture2D(t, vUv + o * vec2( 0.35, -1.0)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-0.35,  1.0)).rgb * 0.1;
              c += texture2D(t, vUv + o * vec2( 1.9,  -1.3)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-1.9,   1.3)).rgb * 0.1;
              c += texture2D(t, vUv + o * vec2( 1.3,   1.9)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-1.3,  -1.9)).rgb * 0.1;
            }
            if (uAO > 0.0) c *= mix(1.0, texture2D(ao, vUv).r, uAO);
            c += texture2D(b, vUv).rgb * uBloom;
            float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
            // split toning: cool shadows, warm highlights (filmic, a little like late afternoon)
            float lt = clamp(l, 0.0, 1.0);
            c *= mix(vec3(0.93, 0.98, 1.07), vec3(1.0), smoothstep(0.0, 0.45, lt));
            c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.45, 1.0, lt));
            c = (c - 0.5) * 1.04 + 0.5;
            vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.95, dot(q, q) * 2.0);
            gl_FragColor = vec4(c, 1.0);
          }` });
      /* screen-space ambient occlusion: depth pre-pass (near field only) at half resolution, SAO-style sampling, small blur */
      this.aoOn = false; this.aoFar = 220; this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      this.mAO = new THREE.ShaderMaterial({ uniforms: { d: { value: null }, invP: { value: new THREE.Matrix4() }, P: { value: new THREE.Matrix4() }, near: { value: 0.3 }, far: { value: 220 }, rad: { value: 1.1 }, px: { value: new THREE.Vector2() } },
        vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: `#include <packing>
          uniform sampler2D d; uniform mat4 invP; uniform mat4 P; uniform float near; uniform float far; uniform float rad; uniform vec2 px; varying vec2 vUv;
          float depthAt(vec2 uv){ return unpackRGBAToDepth(texture2D(d, uv)); }
          vec3 viewPos(vec2 uv, float dz){ vec4 c = vec4(uv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0); vec4 v = invP * c; return v.xyz / v.w; }
          void main(){
            float dz = depthAt(vUv); if (dz >= 0.9999) { gl_FragColor = vec4(1.0); return; }
            vec3 p = viewPos(vUv, dz);
            vec3 pr = viewPos(vUv + vec2(px.x, 0.0), depthAt(vUv + vec2(px.x, 0.0))), pu = viewPos(vUv + vec2(0.0, px.y), depthAt(vUv + vec2(0.0, px.y)));
            vec3 n = normalize(cross(pr - p, pu - p));
            // projected sampling radius (pixels shrink with distance)
            float sr = rad * P[0][0] / max(0.5, -p.z) * 0.5;
            float occ = 0.0; float ang = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
            for (int i = 0; i < 10; i++) {
              float fi = (float(i) + 0.5) / 10.0; float a = ang + fi * 6.2832 * 3.0; vec2 o = vec2(cos(a), sin(a)) * sr * fi;
              vec2 su = vUv + o; float sd = depthAt(su); if (sd >= 0.9999) continue;
              vec3 q = viewPos(su, sd) - p; float l2 = dot(q, q);
              occ += max(0.0, dot(n, q) / sqrt(l2 + 1e-4) - 0.06) * max(0.0, 1.0 - l2 / (rad * rad * 4.0));
            }
            float a = clamp(1.0 - occ / 10.0 * 2.2, 0.0, 1.0);
            gl_FragColor = vec4(vec3(a), 1.0);
          }` });
      this.mAOBlur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ float c = texture2D(t, vUv).r * 0.4; c += (texture2D(t, vUv + d).r + texture2D(t, vUv - d).r) * 0.2; c += (texture2D(t, vUv + d * 2.0).r + texture2D(t, vUv - d * 2.0).r) * 0.1; gl_FragColor = vec4(vec3(c), 1.0); }' });
      this.setSize(1, 1, 1);
    }
    setSize(w, h, samples) {
      const r = this.r; if (this.rt) { this.rt.dispose(); this.a.dispose(); this.bb.dispose(); }
      const opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding, depthBuffer: true, stencilBuffer: false };
      if (r.capabilities.isWebGL2 && samples > 1 && THREE.WebGLMultisampleRenderTarget) { this.rt = new THREE.WebGLMultisampleRenderTarget(w, h, opt); this.rt.samples = Math.min(samples, r.capabilities.maxSamples || 4); }
      else this.rt = new THREE.WebGLRenderTarget(w, h, opt);
      const o2 = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
      const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2); this.a = new THREE.WebGLRenderTarget(bw, bh, o2); this.bb = new THREE.WebGLRenderTarget(bw, bh, o2);
      if (this.dRT) { this.dRT.dispose(); this.aoA.dispose(); this.aoB.dispose(); }
      const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
      this.dRT = new THREE.WebGLRenderTarget(hw, hh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
      this.aoA = new THREE.WebGLRenderTarget(hw, hh, o2); this.aoB = new THREE.WebGLRenderTarget(hw, hh, o2); this.hw = hw; this.hh = hh;
      this.w = w; this.h = h; this.bw = bw; this.bh = bh; this.mFinal.uniforms.px.value.set(1 / w, 1 / h);
    }
    pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
    render(scene, camera) {
      const r = this.r;
      if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
      r.setRenderTarget(this.rt); r.render(scene, camera);
      const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
      if (this.aoOn) {
        // near-field depth only: a short far plane culls the distant world from this extra pass
        const far0 = camera.far, fog = scene.fog, bg = scene.background; camera.far = this.aoFar; camera.updateProjectionMatrix();
        scene.overrideMaterial = this.depthMat; scene.fog = null; const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(); r.setClearColor(0xffffff, 1);
        const vis = []; scene.traverse((o) => { if ((o.isPoints || o.isSprite || (o.material && o.material.transparent && !o.isInstancedMesh)) && o.visible) { vis.push(o); o.visible = false; } });
        r.setRenderTarget(this.dRT); r.clear(); r.render(scene, camera);
        vis.forEach((o) => { o.visible = true; }); r.setClearColor(cc, ca);
        scene.overrideMaterial = null; scene.fog = fog;
        const u = this.mAO.uniforms; u.d.value = this.dRT.texture; u.P.value.copy(camera.projectionMatrix); u.invP.value.copy(camera.projectionMatrixInverse); u.near.value = camera.near; u.far.value = camera.far; u.px.value.set(1 / this.hw, 1 / this.hh);
        camera.far = far0; camera.updateProjectionMatrix();
        this.pass(this.mAO, this.aoA);
        this.mAOBlur.uniforms.t.value = this.aoA.texture; this.mAOBlur.uniforms.d.value.set(1.2 / this.hw, 0); this.pass(this.mAOBlur, this.aoB);
        this.mAOBlur.uniforms.t.value = this.aoB.texture; this.mAOBlur.uniforms.d.value.set(0, 1.2 / this.hh); this.pass(this.mAOBlur, this.aoA);
      }
      this.mBright.uniforms.t.value = this.rt.texture; this.pass(this.mBright, this.a);
      for (let k = 0; k < 2; k++) {
        this.mBlur.uniforms.t.value = this.a.texture; this.mBlur.uniforms.d.value.set((1 + k) / this.bw, 0); this.pass(this.mBlur, this.bb);
        this.mBlur.uniforms.t.value = this.bb.texture; this.mBlur.uniforms.d.value.set(0, (1 + k) / this.bh); this.pass(this.mBlur, this.a);
      }
      const u = this.mFinal.uniforms; u.t.value = this.rt.texture; u.b.value = this.a.texture; u.ao.value = this.aoA.texture; u.uAO.value = this.aoOn ? 0.85 : 0; u.uTilt.value = this.tilt; u.uFocus.value = this.focusY;
      this.pass(this.mFinal, null); r.shadowMap.autoUpdate = sh;
    }
  }

  AX.SkidMarks = SkidMarks; AX.Particles = Particles; AX.PostFX = PostFX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
