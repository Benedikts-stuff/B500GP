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
        fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb; float l=max(c.r,max(c.g,c.b)); gl_FragColor=vec4(c*smoothstep(0.80,1.0,l),1.0); }' });
      this.mBlur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb*0.227; c+=(texture2D(t,vUv+d*1.385).rgb+texture2D(t,vUv-d*1.385).rgb)*0.316; c+=(texture2D(t,vUv+d*3.231).rgb+texture2D(t,vUv-d*3.231).rgb)*0.070; gl_FragColor=vec4(c,1.0); }' });
      this.mFinal = new THREE.ShaderMaterial({
        uniforms: { t: { value: null }, b: { value: null }, px: { value: new THREE.Vector2() }, uTilt: { value: 1 }, uFocus: { value: 0.5 }, uBloom: { value: 0.5 }, uVig: { value: 0.32 }, uSat: { value: 1.12 } },
        vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: `uniform sampler2D t; uniform sampler2D b; uniform vec2 px; uniform float uTilt; uniform float uFocus; uniform float uBloom; uniform float uVig; uniform float uSat; varying vec2 vUv;
          void main(){
            float r = uTilt * smoothstep(0.24, 0.6, abs(vUv.y - uFocus)) * 1.7;
            vec3 c = texture2D(t, vUv).rgb;
            if (r > 0.05) {
              c *= 0.2; vec2 o = px * r;
              c += texture2D(t, vUv + o * vec2( 1.0,  0.35)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-1.0, -0.35)).rgb * 0.1;
              c += texture2D(t, vUv + o * vec2( 0.35, -1.0)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-0.35,  1.0)).rgb * 0.1;
              c += texture2D(t, vUv + o * vec2( 1.9,  -1.3)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-1.9,   1.3)).rgb * 0.1;
              c += texture2D(t, vUv + o * vec2( 1.3,   1.9)).rgb * 0.1; c += texture2D(t, vUv + o * vec2(-1.3,  -1.9)).rgb * 0.1;
            }
            c += texture2D(b, vUv).rgb * uBloom;
            float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
            c = (c - 0.5) * 1.04 + 0.5;
            vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.95, dot(q, q) * 2.0);
            gl_FragColor = vec4(c, 1.0);
          }` });
      this.setSize(1, 1, 1);
    }
    setSize(w, h, samples) {
      const r = this.r; if (this.rt) { this.rt.dispose(); this.a.dispose(); this.bb.dispose(); }
      const opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding, depthBuffer: true, stencilBuffer: false };
      if (r.capabilities.isWebGL2 && samples > 1 && THREE.WebGLMultisampleRenderTarget) { this.rt = new THREE.WebGLMultisampleRenderTarget(w, h, opt); this.rt.samples = Math.min(samples, r.capabilities.maxSamples || 4); }
      else this.rt = new THREE.WebGLRenderTarget(w, h, opt);
      const o2 = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
      const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2); this.a = new THREE.WebGLRenderTarget(bw, bh, o2); this.bb = new THREE.WebGLRenderTarget(bw, bh, o2);
      this.w = w; this.h = h; this.bw = bw; this.bh = bh; this.mFinal.uniforms.px.value.set(1 / w, 1 / h);
    }
    pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
    render(scene, camera) {
      const r = this.r;
      if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
      r.setRenderTarget(this.rt); r.render(scene, camera);
      const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
      this.mBright.uniforms.t.value = this.rt.texture; this.pass(this.mBright, this.a);
      for (let k = 0; k < 2; k++) {
        this.mBlur.uniforms.t.value = this.a.texture; this.mBlur.uniforms.d.value.set((1 + k) / this.bw, 0); this.pass(this.mBlur, this.bb);
        this.mBlur.uniforms.t.value = this.bb.texture; this.mBlur.uniforms.d.value.set(0, (1 + k) / this.bh); this.pass(this.mBlur, this.a);
      }
      const u = this.mFinal.uniforms; u.t.value = this.rt.texture; u.b.value = this.a.texture; u.uTilt.value = this.tilt; u.uFocus.value = this.focusY;
      this.pass(this.mFinal, null); r.shadowMap.autoUpdate = sh;
    }
  }

  AX.SkidMarks = SkidMarks; AX.Particles = Particles; AX.PostFX = PostFX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
