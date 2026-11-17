/* =========================================================
   APEX & PASS — Circuit Superstars Diorama World (Zero-Flicker Curbs & Smooth Road)
   ========================================================= */
'use strict';

const THEMES = {
  golden: {
    label: 'Sunny Afternoon',
    fog: 0x52962c, fogNear: 210, fogFar: 620,
    skyTop: 0x3b76b8, skyHorizon: 0x9fd0e8, sunColor: 0xfff0cc,
    sunDir: new THREE.Vector3(-0.52, 0.46, 0.68).normalize(),
    sunIntensity: 1.70,
    hemiSky: 0x7898e0,
    hemiGround: 0x3d5c24, hemiIntensity: 0.74,
    exposure: 1.06
  },
  noon: {
    label: 'High Noon',
    fog: 0x5aa032, fogNear: 220, fogFar: 640,
    skyTop: 0x4484c4, skyHorizon: 0xbae0f2, sunColor: 0xffffff,
    sunDir: new THREE.Vector3(-0.38, 0.78, -0.48).normalize(),
    sunIntensity: 1.7,
    hemiSky: 0x8aa8e8, hemiGround: 0x446828, hemiIntensity: 0.75,
    exposure: 1.04
  },
  dusk: {
    label: 'Sunset Glow',
    fog: 0x487628, fogNear: 180, fogFar: 540,
    skyTop: 0x324878, skyHorizon: 0xf09c68, sunColor: 0xffb478,
    sunDir: new THREE.Vector3(-0.74, 0.42, -0.52).normalize(),
    sunIntensity: 1.55,
    hemiSky: 0x6a68b8, hemiGround: 0x384224, hemiIntensity: 0.65,
    exposure: 1.08
  }
};

const TRACK_DEFS = {
  gp: {
    id: 'gp',
    name: 'SUPERSTARS GP',
    sub: 'Flüssiger GP-Kurs · Teich-Kurve · Stadion-Bogen',
    halfWidth: 5.5,
    type: 'circuit',
    desc: 'Flüssiger Motorsport-Rundkurs im Circuit-Superstars-Stil mit sauberen Radien ohne eckige Knicke.'
  },
  pass: {
    id: 'pass',
    name: 'ALPINE CLUB RING',
    sub: 'Schnelle Bögen · Wald-Sektion · Doppel-Scheitel',
    halfWidth: 5.2,
    type: 'mountain',
    desc: 'Schnelle Wechselkurven durch dichte Baumgruppen, Felsen und klassische blau-rote Leitplanken.'
  }
};

class Track {
  constructor(id) {
    this.id = id;
    this.def = TRACK_DEFS[id] || TRACK_DEFS.gp;
    this.halfWidth = this.def.halfWidth;
    this.isMountain = (id === 'pass');

    // Wide, smooth corner radii (minimum radius > 24m) so the road ribbon NEVER folds or glitches in corners!
    const controlPts = id === 'gp' ? [
      new THREE.Vector3(-95, 0, -62),
      new THREE.Vector3(-15, 0, -68),
      new THREE.Vector3(65, 0, -64),
      new THREE.Vector3(118, 0, -32),
      new THREE.Vector3(122, 0, 24),
      new THREE.Vector3(78, 0, 62),
      new THREE.Vector3(18, 0, 42),
      new THREE.Vector3(-32, 0, 66),
      new THREE.Vector3(-96, 0, 58),
      new THREE.Vector3(-132, 0, 14),
      new THREE.Vector3(-126, 0, -34)
    ] : [
      new THREE.Vector3(-90, 0, -55),
      new THREE.Vector3(0, 0, -68),
      new THREE.Vector3(90, 0, -48),
      new THREE.Vector3(115, 0, 10),
      new THREE.Vector3(68, 0, 58),
      new THREE.Vector3(0, 0, 68),
      new THREE.Vector3(-68, 0, 52),
      new THREE.Vector3(-115, 0, 4)
    ];

    this.curve = new THREE.CatmullRomCurve3(controlPts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();

    const step = 1.2;
    const n = Math.max(520, Math.floor(this.length / step));
    const raw = this.curve.getSpacedPoints(n);
    if (raw.length > n && raw[raw.length - 1].distanceTo(raw[0]) < 0.01) raw.pop();

    this.samples = raw.map((p, i) => {
      const prev = raw[mod(i - 1, raw.length)];
      const next = raw[mod(i + 1, raw.length)];
      const t = new THREE.Vector3().subVectors(next, prev).normalize();
      const r = new THREE.Vector3(-t.z, 0, t.x).normalize();
      const prev2 = raw[mod(i - 5, raw.length)];
      const next2 = raw[mod(i + 5, raw.length)];
      const t1 = new THREE.Vector3().subVectors(p, prev2).normalize();
      const t2 = new THREE.Vector3().subVectors(next2, p).normalize();
      const curv = (t1.x * t2.z - t1.z * t2.x);
      return { p, t, r, curv };
    });

    this.count = this.samples.length;
    this.ds = this.length / this.count;
    this.startIndex = 18;
    this.cornerCount = id === 'gp' ? 7 : 6;
    this.climb = 0;
  }

  sampleAt(i) { return this.samples[mod(Math.round(i), this.count)]; }

  yawAtIndex(i) {
    const t = this.samples[mod(Math.round(i), this.count)].t;
    return Math.atan2(-t.x, -t.z);
  }

  poseAtIndex(i, lateral = 0) {
    const s = this.samples[mod(Math.round(i), this.count)];
    const pos = s.p.clone().addScaledVector(s.r, lateral);
    return { pos, yaw: Math.atan2(-s.t.x, -s.t.z) };
  }

  nearestIndex(pos, hint = 0) {
    const n = this.count;
    const base = mod(hint, n);
    let best = base;
    let bestD = Infinity;
    const window = 85;
    for (let k = -window; k <= window; k++) {
      const i = mod(base + k, n);
      const p = this.samples[i].p;
      const dx = pos.x - p.x, dz = pos.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  fullNearest(pos) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const p = this.samples[i].p;
      const dx = pos.x - p.x, dz = pos.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  lateralAt(pos, i) {
    const s = this.samples[i];
    return (pos.x - s.p.x) * s.r.x + (pos.z - s.p.z) * s.r.z;
  }

  groundYAt() {
    return 0;
  }
}

/* ---------------- Clean, Natural Textures ---------------- */

function createAsphaltTextures() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const bc = makeCanvas(512, 512);
  const bctx = bc.getContext('2d');

  // Clean slate-violet asphalt without ugly dark stripes
  ctx.fillStyle = '#5e596e';
  ctx.fillRect(0, 0, 512, 512);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 512, 512);

  // Very subtle natural shading across the road width
  const grd = ctx.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0.0, 'rgba(38,34,48,0.14)');
  grd.addColorStop(0.25, 'rgba(95,90,112,0.0)');
  grd.addColorStop(0.50, 'rgba(38,34,48,0.10)');
  grd.addColorStop(0.75, 'rgba(95,90,112,0.0)');
  grd.addColorStop(1.0, 'rgba(38,34,48,0.14)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 512, 512);

  // Fine mineral aggregate pebbles
  const rng = new RNG(1042);
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const s = rng.range(1.0, 2.4);
    const bright = rng.next() > 0.48;
    ctx.fillStyle = bright
      ? `rgba(215,210,230,${rng.range(0.02, 0.07)})`
      : `rgba(22,20,32,${rng.range(0.03, 0.08)})`;
    ctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 6000; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const v = Math.floor(rng.range(105, 155));
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(x, y, 2, 2);
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  map.encoding = THREE.sRGBEncoding;

  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 4;

  return { map, bump };
}

function createGrassTexture() {
  const c = makeCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const rng = new RNG(8821);

  ctx.fillStyle = '#5da432';
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.save();
  ctx.translate(512, 512);
  ctx.rotate(Math.PI / 6);
  for (let y = -1024; y < 1024; y += 128) {
    ctx.fillStyle = 'rgba(138,208,64,0.12)';
    ctx.fillRect(-1024, y, 2048, 64);
    ctx.fillStyle = 'rgba(42,96,22,0.06)';
    ctx.fillRect(-1024, y + 64, 2048, 64);
  }
  ctx.restore();

  for (let i = 0; i < 12000; i++) {
    const x = rng.next() * 1024;
    const y = rng.next() * 1024;
    ctx.fillStyle = rng.next() > 0.45
      ? `rgba(148,218,74,${rng.range(0.06, 0.16)})`
      : `rgba(38,88,20,${rng.range(0.06, 0.16)})`;
    ctx.fillRect(x, y, rng.range(1.5, 2.8), rng.range(2.0, 4.5));
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  tex.anisotropy = 8;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function createFoliageTexture() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const rng = new RNG(4419);

  ctx.fillStyle = '#388428';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 1600; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const rx = rng.range(4, 14);
    const ry = rng.range(3, 10);
    const v = rng.next();
    ctx.fillStyle = v > 0.65 ? '#5cb43c' : v > 0.30 ? '#3e912c' : '#245e1a';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function createRockTexture() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const rng = new RNG(9012);

  ctx.fillStyle = '#9e9689';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 450; i++) {
    const x = rng.next() * 512;
    const y = rng.next() * 512;
    const r = rng.range(6, 36);
    const v = rng.next();
    ctx.fillStyle = v > 0.86 ? 'rgba(92,138,58,0.22)' : v > 0.45 ? 'rgba(220,212,198,0.18)' : 'rgba(68,62,56,0.20)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function createApronTexture() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = new RNG(3112);
  ctx.fillStyle = '#d6886a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = rng.next() > 0.5 ? 'rgba(245,195,165,0.14)' : 'rgba(135,72,52,0.14)';
    const s = rng.range(1.2, 2.8);
    ctx.fillRect(rng.next() * 256, rng.next() * 256, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 40);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function checkerTexture() {
  const c = makeCanvas(256, 64);
  const ctx = c.getContext('2d');
  const s = 16;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#1e1d26' : '#f4efe6';
    ctx.fillRect(x * s, y * s, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function makeBillboardTexture(title, bgHex, accentHex, textHex) {
  const c = makeCanvas(512, 220);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 220);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 512, 34);
  ctx.fillRect(0, 186, 512, 34);
  ctx.strokeStyle = textHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, 484, 192);
  ctx.fillStyle = textHex;
  ctx.font = 'italic 900 76px Impact, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 114);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function ribbonGeometry(track, offset, width, yOff = 0) {
  const verts = [];
  const uvs = [];
  const n = track.count;
  const push = (s, o, u, v) => {
    verts.push(s.p.x + s.r.x * o, s.p.y + yOff, s.p.z + s.r.z * o);
    uvs.push(u, v);
  };
  for (let i = 0; i < n; i++) {
    const s0 = track.samples[i];
    const s1 = track.samples[(i + 1) % n];
    const a = i * track.ds;
    push(s0, offset - width / 2, 0, a / 4);
    push(s0, offset + width / 2, 1, a / 4);
    push(s1, offset - width / 2, 0, (a + track.ds) / 4);
    push(s1, offset + width / 2, 1, (a + track.ds) / 4);
  }
  const positions = new Float32Array(verts);
  const uvArr = new Float32Array(uvs);
  const idx = [];
  const rows = positions.length / 6;
  for (let i = 0; i < rows - 2; i += 2) {
    const a = i, b = i + 1, c = i + 2, d = i + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------- World Builder ---------------- */

class World {
  constructor(scene, track, themeId) {
    this.scene = scene;
    this.track = track;
    this.theme = THEMES[themeId] || THEMES.golden;
    this.themeId = themeId;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];
    this._build();
  }

  _build() {
    const scene = this.scene;
    const theme = this.theme;
    const g = this.group;

    scene.fog = new THREE.Fog(srgb(0x88b8d8), theme.fogNear, theme.fogFar);
    scene.background = srgb(0x78aed4);

    // Sky gradient dome for Chase & POV views
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) },
        horizon: { value: new THREE.Color(theme.skyHorizon) }
      },
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vW; void main(){ float h = clamp(normalize(vW).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 0.45, h)), 1.0); }`
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    g.add(sky);
    this.disposables.push(sky);

    const hemi = new THREE.HemisphereLight(srgb(theme.hemiSky), srgb(theme.hemiGround), theme.hemiIntensity);
    g.add(hemi);

    const sun = new THREE.DirectionalLight(srgb(theme.sunColor), theme.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -68;
    sun.shadow.camera.right = 68;
    sun.shadow.camera.top = 68;
    sun.shadow.camera.bottom = -68;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    g.add(sun);
    g.add(sun.target);
    this.sun = sun;

    const amb = new THREE.AmbientLight(0x6878b8, 0.22);
    g.add(amb);

    this._buildGround();
    this._buildRoadAndCurbs();
    this._buildBlueGuardrails();
    this._buildDioramaDetails();
    this._buildLushTrees();
    this._buildFinishLine();

    linearizeGroup(this.group);
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(1200, 1200);
    geo.rotateX(-Math.PI / 2);
    const gtex = createGrassTexture();
    this.disposables.push(gtex);
    const mat = new THREE.MeshStandardMaterial({ map: gtex, color: 0xffffff, roughness: 0.92, metalness: 0.0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  _buildRoadAndCurbs() {
    const track = this.track;
    const hw = track.halfWidth;
    const n = track.count;

    // 1) Textured terracotta shoulder apron (well below road height so zero Z-fighting)
    const apronTex = createApronTexture();
    this.disposables.push(apronTex);
    const apronMat = new THREE.MeshStandardMaterial({ map: apronTex, color: 0xffffff, roughness: 0.88 });
    const apronGeo = ribbonGeometry(track, 0, (hw + 1.25) * 2, 0.006);
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.receiveShadow = true;
    this.group.add(apron);

    // 2) Main slate-violet road mesh at y = 0.025
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const s = track.samples[i % n];
      const a = i * track.ds;
      pos.push(s.p.x - s.r.x * hw, 0.025, s.p.z - s.r.z * hw);
      uv.push(0, a / 10);
      pos.push(s.p.x + s.r.x * hw, 0.025, s.p.z + s.r.z * hw);
      uv.push(1, a / 10);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const { map, bump } = createAsphaltTextures();
    this.disposables.push(map, bump);
    const roadMat = new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 0.012,
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.04,
      side: THREE.DoubleSide
    });
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true;
    this.group.add(road);

    // 3) Crisp continuous white track edge lines at y = 0.036
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xeeeaf2, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    [-1, 1].forEach(side => {
      const lg = ribbonGeometry(track, side * (hw - 0.22), 0.16, 0.036);
      const lm = new THREE.Mesh(lg, lineMat);
      this.group.add(lm);
    });

    // 4) ZERO-FLICKER CONTINUOUS CURB STRIPS (Non-overlapping stitched triangles -> 0% Z-fighting!)
    const curbPos = [];
    const curbCol = [];
    const curbIdx = [];
    const palette = [
      new THREE.Color(0xd93829), // Red
      new THREE.Color(0xf2c830), // Yellow
      new THREE.Color(0xf5f0e6)  // White
    ];
    let quadCount = 0;

    const addCurbSegment = (s0, s1, side, color) => {
      const innerOff = side * (hw - 0.04);
      const outerOff = side * (hw + 0.64);
      const y = 0.042;
      const p00 = new THREE.Vector3(s0.p.x + s0.r.x * innerOff, y, s0.p.z + s0.r.z * innerOff);
      const p01 = new THREE.Vector3(s0.p.x + s0.r.x * outerOff, y, s0.p.z + s0.r.z * outerOff);
      const p10 = new THREE.Vector3(s1.p.x + s1.r.x * innerOff, y, s1.p.z + s1.r.z * innerOff);
      const p11 = new THREE.Vector3(s1.p.x + s1.r.x * outerOff, y, s1.p.z + s1.r.z * outerOff);

      const base = quadCount * 4;
      [p00, p01, p10, p11].forEach(p => {
        curbPos.push(p.x, p.y, p.z);
        curbCol.push(color.r, color.g, color.b);
      });
      curbIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      quadCount++;
    };

    for (let i = 0; i < n; i++) {
      const s0 = track.samples[i];
      const s1 = track.samples[(i + 1) % n];
      if (Math.abs(s0.curv) < 0.025) continue;
      const insideSide = s0.curv > 0 ? 1 : -1;
      const col = palette[Math.floor(i / 2) % 3];
      addCurbSegment(s0, s1, insideSide, col);
      if (Math.abs(s0.curv) > 0.045) {
        const colOut = palette[(Math.floor(i / 2) + 1) % 3];
        addCurbSegment(s0, s1, -insideSide, colOut);
      }
    }

    if (quadCount > 0) {
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(curbCol, 3));
      cg.setIndex(curbIdx);
      cg.computeVertexNormals();
      const cm = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      });
      const curbMesh = new THREE.Mesh(cg, cm);
      curbMesh.receiveShadow = true;
      this.group.add(curbMesh);
    }
  }

  _buildBlueGuardrails() {
    const track = this.track;
    const hw = track.halfWidth;
    const n = track.count;
    const postGeo = new THREE.BoxGeometry(0.18, 0.88, 0.18);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xc83728, roughness: 0.5 });
    const railGeo = new THREE.BoxGeometry(0.10, 0.22, 3.65);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2b76c9, roughness: 0.38, metalness: 0.28 });

    const posts = [];
    const rails = [];
    for (let i = 0; i < n; i += 3) {
      const s = track.samples[i];
      const yaw = Math.atan2(-s.t.x, -s.t.z);
      [-1, 1].forEach(side => {
        const dist = hw + 2.35;
        const base = new THREE.Vector3(s.p.x + s.r.x * side * dist, 0, s.p.z + s.r.z * side * dist);
        posts.push({ pos: base.clone().setY(0.44), yaw });
        rails.push({ pos: base.clone().setY(0.68), yaw });
        rails.push({ pos: base.clone().setY(0.34), yaw });
      });
    }

    const addInst = (geo, mat, list) => {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
      list.forEach((it, i) => {
        q.setFromEuler(new THREE.Euler(0, it.yaw, 0));
        m.compose(it.pos, q, sc);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      this.group.add(inst);
    };
    addInst(postGeo, postMat, posts);
    addInst(railGeo, railMat, rails);
  }

  _buildDioramaDetails() {
    const track = this.track;
    const hw = track.halfWidth;
    const g = this.group;
    const rng = new RNG(7712);

    const boards = [
      { idx: Math.floor(track.count * 0.16), side: -1, title: 'GOOD DAYS', bg: '#f5f1e6', acc: '#2b5ca8', txt: '#1d4487' },
      { idx: Math.floor(track.count * 0.21), side: -1, title: 'HORNET',    bg: '#f5f1e6', acc: '#d13428', txt: '#1a1c24' },
      { idx: Math.floor(track.count * 0.26), side: -1, title: 'THUNDER',   bg: '#f5f1e6', acc: '#c92e24', txt: '#222530' },
      { idx: Math.floor(track.count * 0.52), side: -1, title: 'APEX & PASS', bg: '#1e2229', acc: '#d9532f', txt: '#f5f1e6' },
      { idx: Math.floor(track.count * 0.58), side: -1, title: 'CORSA 600', bg: '#f5f1e6', acc: '#2b76c9', txt: '#1a2639' },
      { idx: Math.floor(track.count * 0.78), side: -1, title: 'STRADA V4', bg: '#c83224', acc: '#f5f1e6', txt: '#ffffff' }
    ];

    const legMat = new THREE.MeshStandardMaterial({ color: 0x383540, roughness: 0.7 });
    boards.forEach(b => {
      const s = track.samples[b.idx % track.count];
      const yaw = Math.atan2(-s.t.x, -s.t.z);
      const dist = hw + 3.8;
      const pos = new THREE.Vector3(s.p.x + s.r.x * b.side * dist, 0, s.p.z + s.r.z * b.side * dist);
      const tex = makeBillboardTexture(b.title, b.bg, b.acc, b.txt);
      this.disposables.push(tex);

      const bGroup = new THREE.Group();
      bGroup.position.copy(pos);
      bGroup.rotation.y = yaw + Math.PI / 2;

      const boardMesh = new THREE.Mesh(
        new THREE.BoxGeometry(8.5, 3.6, 0.22),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })
      );
      boardMesh.position.y = 3.2;
      boardMesh.castShadow = true;
      boardMesh.receiveShadow = true;
      bGroup.add(boardMesh);

      [-2.8, 2.8].forEach(lx => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.2, 0.24), legMat);
        leg.position.set(lx, 1.6, -0.05);
        leg.castShadow = true;
        bGroup.add(leg);
      });
      g.add(bGroup);
    });

    // Clubhouse / Pit Building
    const sClub = track.samples[Math.floor(track.count * 0.22)];
    const clubPos = new THREE.Vector3(sClub.p.x + sClub.r.x * (hw + 12.0), 0, sClub.p.z + sClub.r.z * (hw + 12.0));
    const clubYaw = Math.atan2(-sClub.t.x, -sClub.t.z);
    const club = new THREE.Group();
    club.position.copy(clubPos);
    club.rotation.y = clubYaw;

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xede6d8, roughness: 0.82 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3b6e52, roughness: 0.48, metalness: 0.18 });
    const woodCanvas = makeCanvas(256, 256);
    const wctx = woodCanvas.getContext('2d');
    wctx.fillStyle = '#9c5a3c';
    wctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      wctx.fillStyle = y % 64 === 0 ? 'rgba(60,28,16,0.16)' : 'rgba(235,180,140,0.08)';
      wctx.fillRect(0, y, 256, 30);
      wctx.fillStyle = 'rgba(40,18,10,0.35)';
      wctx.fillRect(0, y + 30, 256, 2);
    }
    const woodTex = new THREE.CanvasTexture(woodCanvas);
    woodTex.wrapS = THREE.RepeatWrapping;
    woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(3, 3);
    woodTex.encoding = THREE.sRGBEncoding;
    this.disposables.push(woodTex);
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xffffff, roughness: 0.72 });

    const mainWall = new THREE.Mesh(new THREE.BoxGeometry(9.5, 3.8, 16.0), wallMat);
    mainWall.position.y = 1.9;
    mainWall.castShadow = true;
    mainWall.receiveShadow = true;
    club.add(mainWall);

    const roofGeo = new THREE.CylinderGeometry(0.1, 6.2, 17.2, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.rotateX(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.scale.set(1.15, 0.55, 1.0);
    roof.position.y = 4.9;
    roof.castShadow = true;
    roof.receiveShadow = true;
    club.add(roof);

    [-3.5, 3.5].forEach(dz => {
      const dormer = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 3.2), roofMat);
      dormer.position.set(-2.4, 4.7, dz);
      dormer.castShadow = true;
      club.add(dormer);
    });

    const terrace = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 15.6), woodMat);
    terrace.position.set(-5.8, 0.15, 0);
    club.add(terrace);

    const specColors = [0xe84838, 0xf2c830, 0x3888e0, 0xf5f0e6, 0xeb7a34];
    for (let k = 0; k < 22; k++) {
      const person = new THREE.Group();
      const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.72, 12), new THREE.MeshStandardMaterial({ color: rng.pick(specColors), roughness: 0.6 }));
      shirt.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf2d2b6, roughness: 0.5 }));
      head.position.y = 1.08;
      person.add(shirt, head);
      person.position.set(-5.4 + rng.range(-1.2, 0.6), 0.2, rng.range(-6.8, 6.8));
      person.traverse(o => { if (o.isMesh) o.castShadow = true; });
      club.add(person);
    }
    g.add(club);

    // Scenic Pond with Smooth Textured Boulders
    const sPond = track.samples[Math.floor(track.count * 0.21)];
    const pondCenter = new THREE.Vector3(sPond.p.x - sPond.r.x * (hw + 14.5), 0.03, sPond.p.z - sPond.r.z * (hw + 14.5));
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(8.5, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e4e78, roughness: 0.14, metalness: 0.42 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.copy(pondCenter);
    g.add(water);

    const rockTex = createRockTexture();
    this.disposables.push(rockTex);
    const rockGeo = new THREE.DodecahedronGeometry(1.0, 2);
    const rockMat = new THREE.MeshStandardMaterial({
      map: rockTex,
      bumpMap: rockTex,
      bumpScale: 0.04,
      color: 0xffffff,
      roughness: 0.82,
      flatShading: false
    });
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      const rad = 8.2 + rng.range(-0.6, 1.2);
      const rk = new THREE.Mesh(rockGeo, rockMat);
      const sc = rng.range(0.7, 1.6);
      rk.scale.set(sc * 1.25, sc * 0.72, sc * 1.05);
      rk.position.set(pondCenter.x + Math.cos(ang) * rad, sc * 0.28, pondCenter.z + Math.sin(ang) * rad);
      rk.rotation.set(rng.range(-0.2, 0.2), rng.range(0, 6), rng.range(-0.2, 0.2));
      rk.castShadow = true;
      rk.receiveShadow = true;
      g.add(rk);
    }

    // Stacked Golden Haybales
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xd99b38, roughness: 0.85, flatShading: false });
    const hayGeo = new THREE.CylinderGeometry(0.65, 0.65, 1.1, 16);
    hayGeo.rotateZ(Math.PI / 2);
    [0.14, 0.38, 0.64, 0.86].forEach(frac => {
      const sh = track.samples[Math.floor(track.count * frac)];
      const base = new THREE.Vector3(sh.p.x - sh.r.x * (hw + 4.2), 0, sh.p.z - sh.r.z * (hw + 4.2));
      for (let b = 0; b < 4; b++) {
        const bale = new THREE.Mesh(hayGeo, hayMat);
        bale.position.set(base.x + (b % 2) * 1.2, b > 1 ? 1.15 : 0.58, base.z + Math.floor(b / 2) * 1.1);
        bale.rotation.y = rng.range(-0.3, 0.3);
        bale.castShadow = true;
        bale.receiveShadow = true;
        g.add(bale);
      }
    });

    // Wooden Grandstands
    [0.04, 0.12, 0.68].forEach(frac => {
      const sg = track.samples[Math.floor(track.count * frac)];
      const yaw = Math.atan2(-sg.t.x, -sg.t.z);
      const stand = new THREE.Group();
      stand.position.set(sg.p.x - sg.r.x * (hw + 8.5), 0, sg.p.z - sg.r.z * (hw + 8.5));
      stand.rotation.y = yaw;

      for (let step = 0; step < 4; step++) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55 + step * 0.55, 11.0), woodMat);
        bench.position.set(-step * 1.1, (0.55 + step * 0.55) / 2, 0);
        bench.castShadow = true;
        bench.receiveShadow = true;
        stand.add(bench);

        for (let p = -4.5; p <= 4.5; p += 1.15) {
          if (rng.next() < 0.2) continue;
          const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.68, 10), new THREE.MeshStandardMaterial({ color: rng.pick(specColors), roughness: 0.6 }));
          sp.position.set(-step * 1.1, 0.55 + step * 0.55 + 0.34, p + rng.range(-0.15, 0.15));
          sp.castShadow = true;
          stand.add(sp);
        }
      }
      g.add(stand);
    });
  }

  _buildLushTrees() {
    const track = this.track;
    const hw = track.halfWidth;
    const rng = new RNG(3031);
    const count = 210;

    const foliageTex = createFoliageTexture();
    this.disposables.push(foliageTex);

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.36, 2.2, 12);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4028, roughness: 0.88, flatShading: false });
    const foliageGeo = new THREE.SphereGeometry(1.82, 16, 14);
    const foliageMat = new THREE.MeshStandardMaterial({
      map: foliageTex,
      bumpMap: foliageTex,
      bumpScale: 0.05,
      color: 0xffffff,
      roughness: 0.82,
      flatShading: false
    });

    const trunks = [];
    const crowns = [];
    const greens = [0xd8f0d0, 0xe8f8dc, 0xc8e6c0, 0xb8dca8];

    for (let i = 0; i < count * 3 && trunks.length < count; i++) {
      const idx = Math.floor(rng.next() * track.count);
      const s = track.samples[idx];
      const side = rng.next() > 0.42 ? -1 : 1;
      const off = hw + rng.range(4.8, 38.0);
      const x = s.p.x + s.r.x * side * off;
      const z = s.p.z + s.r.z * side * off;

      const nearIdx = track.fullNearest({ x, z });
      const nearS = track.samples[nearIdx];
      const distToRoad = Math.hypot(x - nearS.p.x, z - nearS.p.z);
      if (distToRoad < hw + 4.8) continue;

      const scale = rng.range(0.85, 1.45);
      trunks.push({ pos: new THREE.Vector3(x, 1.1 * scale, z), scale });

      const baseTint = rng.pick(greens);
      crowns.push({ pos: new THREE.Vector3(x, 2.8 * scale, z), scale: scale * 1.15, color: baseTint });
      crowns.push({ pos: new THREE.Vector3(x + 0.5 * scale, 3.8 * scale, z - 0.3 * scale), scale: scale * 0.92, color: baseTint });
      crowns.push({ pos: new THREE.Vector3(x - 0.4 * scale, 4.5 * scale, z + 0.3 * scale), scale: scale * 0.74, color: baseTint });
    }

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length);
    const crownInst = new THREE.InstancedMesh(foliageGeo, foliageMat, crowns.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();

    trunks.forEach((t, i) => {
      q.setFromEuler(new THREE.Euler(0, i * 1.1, 0));
      sc.set(t.scale, t.scale, t.scale);
      m.compose(t.pos, q, sc);
      trunkInst.setMatrixAt(i, m);
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    trunkInst.castShadow = true;
    trunkInst.receiveShadow = true;
    this.group.add(trunkInst);

    const c = new THREE.Color();
    crowns.forEach((cr, i) => {
      q.setFromEuler(new THREE.Euler(i * 0.4, i * 1.3, 0));
      sc.set(cr.scale, cr.scale * 0.88, cr.scale);
      m.compose(cr.pos, q, sc);
      crownInst.setMatrixAt(i, m);
      c.setHex(cr.color);
      crownInst.setColorAt(i, c);
    });
    crownInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
    crownInst.castShadow = true;
    crownInst.receiveShadow = true;
    this.group.add(crownInst);
  }

  _buildFinishLine() {
    const track = this.track;
    const s = track.samples[0];
    const hw = track.halfWidth;
    const geo = new THREE.PlaneGeometry(hw * 2, 1.8);
    const tex = checkerTexture();
    this.disposables.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    geo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(geo, mat);
    line.rotation.y = Math.atan2(-s.t.x, -s.t.z);
    line.position.set(s.p.x, 0.038, s.p.z);
    this.group.add(line);

    // Painted Starting Grid Slots (P1 / P2 staggered Diorama grid markings)
    const gc = makeCanvas(128, 128);
    const gctx = gc.getContext('2d');
    gctx.strokeStyle = 'rgba(245, 240, 232, 0.85)';
    gctx.lineWidth = 10;
    gctx.beginPath();
    gctx.moveTo(22, 68);
    gctx.lineTo(22, 22);
    gctx.lineTo(106, 22);
    gctx.lineTo(106, 68);
    gctx.stroke();
    const gridTex = new THREE.CanvasTexture(gc);
    gridTex.encoding = THREE.sRGBEncoding;
    this.disposables.push(gridTex);
    const gridMat = new THREE.MeshBasicMaterial({
      map: gridTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    [
      { idx: track.startIndex, lat: -1.85 },
      { idx: track.startIndex - 3, lat: 1.85 }
    ].forEach(slot => {
      const sp = track.poseAtIndex(slot.idx, slot.lat);
      const box = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), gridMat);
      box.rotation.order = 'YXZ';
      box.rotation.y = sp.yaw;
      box.rotation.x = -Math.PI / 2;
      box.position.set(sp.pos.x, 0.036, sp.pos.z);
      this.group.add(box);
    });

    // Crisp 100 / 50m Braking Marker Boards before sharp corners
    const n = track.count;
    for (let i = 0; i < n; i++) {
      const cPrev = Math.abs(track.samples[mod(i - 6, n)].curv);
      const cNow = Math.abs(track.samples[i].curv);
      if (cPrev < 0.042 && cNow >= 0.042) {
        const apexCurv = track.samples[mod(i + 4, n)].curv;
        const outsideSide = apexCurv > 0 ? -1 : 1;
        [{ back: 28, num: '100' }, { back: 14, num: '50' }].forEach(mk => {
          const sm = track.samples[mod(i - mk.back, n)];
          const mc = makeCanvas(96, 96);
          const mctx = mc.getContext('2d');
          mctx.fillStyle = '#f4efe6';
          mctx.fillRect(0, 0, 96, 96);
          mctx.fillStyle = '#c82e24';
          mctx.fillRect(0, 0, 96, 20);
          mctx.fillStyle = '#181a20';
          mctx.font = 'bold 40px Helvetica, Arial, sans-serif';
          mctx.textAlign = 'center';
          mctx.textBaseline = 'middle';
          mctx.fillText(mk.num, 48, 58);
          const mtex = new THREE.CanvasTexture(mc);
          mtex.encoding = THREE.sRGBEncoding;
          this.disposables.push(mtex);
          const sign = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 1.1, 0.14),
            new THREE.MeshStandardMaterial({ map: mtex, roughness: 0.45 })
          );
          const dist = hw + 3.0;
          sign.position.set(sm.p.x + sm.r.x * outsideSide * dist, 0.95, sm.p.z + sm.r.z * outsideSide * dist);
          sign.rotation.y = Math.atan2(-sm.t.x, -sm.t.z);
          sign.castShadow = true;
          this.group.add(sign);
        });
        i += 26;
      }
    }
  }

  update(bikePos) {
    if (!this.sun) return;
    const d = this.theme.sunDir;
    this.sun.position.set(bikePos.x + d.x * 85, bikePos.y + d.y * 85 + 20, bikePos.z + d.z * 85);
    this.sun.target.position.copy(bikePos);
    this.sun.target.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          if (m.bumpMap) m.bumpMap.dispose();
          m.dispose();
        });
      }
    });
    this.scene.fog = null;
  }
}
