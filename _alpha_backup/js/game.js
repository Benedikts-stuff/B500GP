/* =========================================================
   APEX & PASS — 2.5D Isometric 1v1 Game Loop, Camera, Ragdoll & Lobby
   ========================================================= */
'use strict';

const SETUP = { ...DEFAULT_SETUP };

const APP = {
  renderer: null, scene: null, camera: null,
  track: null, world: null, bikeMesh: null, physics: null,
  oppMesh: null, oppShadow: null, oppPhysics: null,
  net: new NetLobby(),
  state: 'menu',
  opts: { bike: 'v4', track: 'gp', mode: 'time', theme: 'golden' },
  camMode: 'iso', // 'iso' (2.5D Top-Down) | 'chase' | 'pov'
  isoZoom: 1.0,
  time: 0,
  lastSafeIndex: 8,
  best: null, bestTrace: null, currentTrace: [],
  lapStart: 0, lapDistance: 0, lapCount: 1, prevIndex: 0,
  oppLapCount: 1, oppLapDistance: 0, oppPrevIndex: 0,
  bestProgT: 0, bestProgIdx: 0,
  ghost: null, ghostIdx: 0,
  crashVisual: false, crashMsgShown: false,
  shake: 0,
  pausedAt: 0,
  hintTimer: 0,
  audio: new SoundEngine()
};

const AU = APP.audio;

/* ---------------- renderer / scene ---------------- */
function initRenderer() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  APP.renderer = renderer;

  const scene = new THREE.Scene();
  APP.scene = scene;

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.12, 5200);
  APP.camera = camera;

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  window.addEventListener('wheel', (e) => {
    if (APP.state === 'racing' && APP.camMode === 'iso') {
      APP.isoZoom = clamp(APP.isoZoom + (e.deltaY > 0 ? 0.08 : -0.08), 0.62, 1.55);
    }
  }, { passive: true });
}

/* ---------------- world / bike lifecycle ---------------- */
function rebuildTrack(resetBike = true) {
  if (APP.fx) { APP.fx.dispose(); APP.fx = null; }
  if (APP.world) APP.world.dispose();
  APP.track = new Track(APP.opts.track);
  APP.world = new World(APP.scene, APP.track, APP.opts.theme);
  if (APP.world.sun) {
    APP.world.sun.shadow.camera.left = -95;
    APP.world.sun.shadow.camera.right = 95;
    APP.world.sun.shadow.camera.top = 95;
    APP.world.sun.shadow.camera.bottom = -95;
    APP.world.sun.shadow.camera.updateProjectionMatrix();
  }
  APP.renderer.toneMappingExposure = APP.world.theme.exposure;
  APP.fx = new FX(APP.scene);

  if (!APP.physics) APP.physics = new BikePhysics(APP.opts.bike);
  APP.physics.trackIndex = APP.track.fullNearest(APP.physics.pos);
  if (resetBike) placeBikeAtStart();
  loadBest();
  buildMinimapCache();
  updateTrackLabels();
  applyGhostFromBest();
}

function rebuildWorld() {
  if (APP.world) APP.world.dispose();
  APP.world = new World(APP.scene, APP.track, APP.opts.theme);
  APP.renderer.toneMappingExposure = APP.world.theme.exposure;
}

function disposeBike(mesh) {
  if (!mesh) return;
  APP.scene.remove(mesh);
  mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => m.dispose());
    }
  });
}

function rebuildBike() {
  disposeBike(APP.bikeMesh);
  APP.bikeMesh = createBikeMesh(APP.opts.bike);
  APP.scene.add(APP.bikeMesh);
  placeBikeAtStart();
  loadBest();
  applyGhostFromBest();
}

function rebuildOpponentBike(bikeId = 'i4') {
  disposeBike(APP.oppMesh);
  APP.oppMesh = createBikeMesh(bikeId, 0x2980b9);
  APP.oppMesh.visible = false;
  APP.scene.add(APP.oppMesh);
  if (!APP.oppShadow) APP.oppShadow = createShadowBlob();
  APP.oppShadow.group.visible = false;
}

function getMyGridSlot() {
  if (!APP.net.connected) return 0;
  return APP.net.role === 'guest' ? 1.85 : -1.85;
}

function getOppGridSlot() {
  return APP.net.role === 'guest' ? -1.85 : 1.85;
}

function placeBikeAtStart() {
  const lat = getMyGridSlot();
  const pose = APP.track.poseAtIndex(APP.track.startIndex, lat);
  APP.physics.pos.copy(pose.pos);
  APP.physics.pos.y += 0.035;
  APP.physics.yaw = pose.yaw;
  APP.physics.trackIndex = APP.track.startIndex;
  APP.lastSafeIndex = APP.track.startIndex;
  if (APP.bikeMesh) {
    APP.bikeMesh.position.copy(APP.physics.pos);
    APP.bikeMesh.rotation.set(0, pose.yaw, 0);
  }
  syncBikeVisual(0);
}

/* ---------------- HUD ---------------- */
const HUD = {
  tach: null, gear: null, speed: null, rpm: null, lap: null, lapBadge: null,
  delta: null, best: null, rightLabel: null,
  tempF: null, tempR: null, zonesF: null, zonesR: null, weightDot: null,
  barThrottle: null, barFront: null, barRear: null, barClutch: null,
  shiftLights: null, leanNeedle: null, leanDeg: null, stuntBadge: null,
  camBtn: null, muteBtn: null, setupBtn: null,
  toast: null, countdown: null, crashMsg: null, crashType: null,
  hint: null, minimap: null, oppTag: null
};

function initHUD() {
  HUD.tach = document.getElementById('tach');
  HUD.tach.innerHTML = '';
  for (let i = 0; i < 28; i++) {
    const el = document.createElement('i');
    HUD.tach.appendChild(el);
  }
  HUD.gear = document.getElementById('gear');
  HUD.speed = document.getElementById('speed');
  HUD.rpm = document.getElementById('hudRpm');
  HUD.lap = document.getElementById('hudLap');
  HUD.lapBadge = document.getElementById('hudLapBadge');
  HUD.delta = document.getElementById('hudDelta');
  HUD.best = document.getElementById('hudBest');
  HUD.rightLabel = document.getElementById('hudRightLabel');
  HUD.tempF = document.getElementById('tempF');
  HUD.tempR = document.getElementById('tempR');
  HUD.zonesF = document.getElementById('zonesF').children;
  HUD.zonesR = document.getElementById('zonesR').children;
  HUD.weightDot = document.getElementById('weightDot');
  HUD.barThrottle = document.getElementById('barThrottle');
  HUD.barFront = document.getElementById('barFront');
  HUD.barRear = document.getElementById('barRear');
  HUD.barClutch = document.getElementById('barClutch');
  HUD.shiftLights = document.getElementById('shiftLights').children;
  HUD.leanNeedle = document.getElementById('leanNeedle');
  HUD.leanDeg = document.getElementById('leanDeg');
  HUD.stuntBadge = document.getElementById('stuntBadge');
  HUD.camBtn = document.getElementById('hudCamBtn');
  HUD.muteBtn = document.getElementById('hudMuteBtn');
  HUD.setupBtn = document.getElementById('hudSetupBtn');
  HUD.toast = document.getElementById('toast');
  HUD.countdown = document.getElementById('countdown');
  HUD.crashMsg = document.getElementById('crashMsg');
  HUD.crashType = HUD.crashMsg.querySelector('.crash-type');
  HUD.hint = document.getElementById('hudHint');
  HUD.minimap = document.getElementById('minimap');
  HUD.oppTag = document.getElementById('oppTag');

  if (HUD.camBtn) HUD.camBtn.addEventListener('click', () => toggleCamera());
  if (HUD.muteBtn) HUD.muteBtn.addEventListener('click', () => {
    AU.init();
    AU.setMuted(!AU.muted);
    syncHudButtons();
    toast(AU.muted ? 'TON AUS' : 'TON AN', 1200);
  });
  if (HUD.setupBtn) HUD.setupBtn.addEventListener('click', () => togglePause());
}

function syncHudButtons() {
  if (HUD.camBtn) {
    const short = { iso: 'CAM · 2.5D', chase: 'CAM · CHASE', pov: 'CAM · POV' };
    HUD.camBtn.textContent = short[APP.camMode] || 'CAM';
  }
  if (HUD.muteBtn) {
    HUD.muteBtn.textContent = AU.muted ? 'TON AUS' : 'TON AN';
    HUD.muteBtn.classList.toggle('muted', AU.muted);
  }
}

let toastTimer = null;
function toast(text, ms = 2200) {
  HUD.toast.textContent = text;
  HUD.toast.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { HUD.toast.style.opacity = 0; }, ms);
}

function tempColor(t) {
  let h;
  if (t < 90) h = lerp(208, 98, clamp((t - 26) / 64, 0, 1));
  else h = lerp(98, 6, clamp((t - 90) / 56, 0, 1));
  return `hsl(${h.toFixed(0)}, 48%, ${t > 128 ? 46 : 40}%)`;
}

function updateTireWidget(zones, temps, elTemp) {
  for (let i = 0; i < 3; i++) {
    zones[i].style.background = tempColor(temps[i]);
  }
  elTemp.textContent = Math.round((temps[0] + temps[1] + temps[2]) / 3) + '°';
}

function updateHUD(now) {
  const p = APP.physics;
  const spec = p.spec;
  HUD.speed.textContent = Math.round(p.speedKmh);
  HUD.gear.textContent = p.gear;
  if (HUD.rpm) HUD.rpm.textContent = Math.round(p.rpm).toLocaleString('de-DE') + ' RPM';
  if (HUD.lapBadge) HUD.lapBadge.textContent = 'RUNDE ' + (APP.lapCount || 1);

  const leanDegrees = Math.round((p.lean || 0) * 180 / Math.PI);
  if (HUD.leanNeedle) HUD.leanNeedle.style.transform = `rotate(${clamp(leanDegrees, -58, 58)}deg)`;
  if (HUD.leanDeg) {
    const absDeg = Math.abs(leanDegrees);
    HUD.leanDeg.textContent = absDeg < 2 ? '0°' : absDeg + '° ' + (leanDegrees > 0 ? 'R' : 'L');
  }
  if (HUD.stuntBadge) {
    if (p.pitch > 0.14) {
      HUD.stuntBadge.textContent = 'WHEELIE ' + Math.round(p.pitch * 180 / Math.PI) + '°';
      HUD.stuntBadge.className = 'stunt-badge';
    } else if (p.pitch < -0.14) {
      HUD.stuntBadge.textContent = 'STOPPIE';
      HUD.stuntBadge.className = 'stunt-badge stoppie';
    } else if (Math.abs(p.slipAngle || 0) > 0.12 && p.speed > 7) {
      const sDeg = Math.round(Math.abs(p.slipAngle) * 180 / Math.PI);
      HUD.stuntBadge.textContent = (p.brakeSlide > 0.18 ? 'BACK-IT-IN ' : 'SLIDE ') + sDeg + '°';
      HUD.stuntBadge.className = 'stunt-badge slide';
    } else {
      HUD.stuntBadge.className = 'stunt-badge hidden';
    }
  }

  const frac = clamp(p.rpm / spec.redline, 0, 1);
  const segs = HUD.tach.children;
  const onCount = Math.round(frac * segs.length);
  for (let i = 0; i < segs.length; i++) {
    let cls = '';
    if (i < onCount) cls = i >= 24 ? 'red' : i >= 20 ? 'hot' : 'on';
    segs[i].className = cls;
  }
  const shift = frac > 0.93;
  for (let i = 0; i < HUD.shiftLights.length; i++) {
    HUD.shiftLights[i].className = shift && i < Math.round((frac - 0.9) * 40) ? 'on' : '';
  }

  updateTireWidget(HUD.zonesF, p.tempF, HUD.tempF);
  updateTireWidget(HUD.zonesR, p.tempR, HUD.tempR);

  HUD.weightDot.style.left = (50 + p.weightX * 38) + '%';
  HUD.weightDot.style.top = (50 - p.weightY * 38) + '%';
  HUD.barThrottle.style.setProperty('--h', (p.throttle * 100) + '%');
  HUD.barFront.style.setProperty('--h', (p.frontBrake * 100) + '%');
  HUD.barRear.style.setProperty('--h', (p.rearBrake * 100) + '%');
  HUD.barClutch.style.setProperty('--h', (p.clutch * 100) + '%');

  const lapT = APP.state === 'countdown' ? 0 : Math.max(0, (now - APP.lapStart) / 1000);
  HUD.lap.textContent = formatTime(lapT);

  if (APP.net.connected) {
    const myTotal = (APP.lapCount - 1) * APP.track.length + APP.lapDistance;
    let oppTotal = 0;
    if (APP.net.role === 'bot' && APP.oppPhysics) {
      oppTotal = (APP.oppLapCount - 1) * APP.track.length + APP.oppLapDistance;
    } else if (APP.net.remoteState) {
      oppTotal = ((APP.net.remoteState.lap || 1) - 1) * APP.track.length + (APP.net.remoteState.dist || 0);
    }
    const diffMeters = myTotal - oppTotal;
    const ahead = diffMeters >= 0;
    const gapSec = Math.abs(diffMeters) / Math.max(18, p.speed);
    HUD.rightLabel.textContent = `1v1 POSITION · RUNDE ${APP.lapCount}`;
    HUD.best.textContent = ahead ? 'P1 / 2' : 'P2 / 2';
    HUD.delta.textContent = (ahead ? 'VORSPRUNG −' : 'RÜCKSTAND +') + gapSec.toFixed(2) + 's';
    HUD.delta.className = ahead ? 'faster' : 'slower';
  } else {
    HUD.rightLabel.textContent = 'BESTE RUNDE';
    if (APP.best && APP.bestTrace && APP.bestTrace.length > 2) {
      const bestAt = bestTimeAtProgress(APP.lapDistance);
      if (bestAt == null) {
        HUD.delta.textContent = '—';
        HUD.delta.className = '';
      } else {
        const d = lapT - bestAt;
        HUD.delta.textContent = formatDelta(d);
        HUD.delta.className = Math.abs(d) < 0.01 ? '' : (d < 0 ? 'faster' : 'slower');
      }
    } else {
      HUD.delta.textContent = 'SOLO / TIME ATTACK';
      HUD.delta.className = '';
    }
    HUD.best.textContent = APP.best ? formatTime(APP.best) : '—';
  }
}

/* ---------------- timing / ghost ---------------- */
function bestKey() { return `apex_best_v2_${APP.opts.track}_${APP.opts.bike}`; }

function loadBest() {
  APP.best = null;
  APP.bestTrace = null;
  try {
    const raw = localStorage.getItem(bestKey());
    if (raw) {
      const d = JSON.parse(raw);
      if (d && isFinite(d.time)) {
        APP.best = d.time;
        APP.bestTrace = d.trace || null;
      }
    }
  } catch (e) {}
  APP.bestProgIdx = 0;
  APP.ghostIdx = 0;
}

function saveBest() {
  try {
    localStorage.setItem(bestKey(), JSON.stringify({ time: APP.best, trace: APP.bestTrace }));
  } catch (e) {}
}

function bestTimeAtProgress(dist) {
  const tr = APP.bestTrace;
  if (!tr || tr.length < 2) return null;
  while (APP.bestProgIdx < tr.length - 2 && tr[APP.bestProgIdx + 1][1] < dist) APP.bestProgIdx++;
  const a = tr[APP.bestProgIdx], b = tr[APP.bestProgIdx + 1];
  if (!b) return a[0];
  if (dist < a[1]) return a[0];
  const f = clamp((dist - a[1]) / Math.max(0.001, b[1] - a[1]), 0, 1);
  return lerp(a[0], b[0], f);
}

function applyGhostFromBest() {
  if (APP.ghost) {
    APP.scene.remove(APP.ghost);
    APP.ghost = null;
  }
  if (APP.net.connected) return; // In 1v1 mode we race live opponent instead of ghost
  if (!APP.bestTrace || APP.bestTrace.length < 2) return;
  APP.ghost = cloneAsGhost(createBikeMesh(APP.opts.bike));
  APP.ghost.visible = false;
  APP.scene.add(APP.ghost);
  APP.ghostIdx = 0;
}

function updateGhost(now) {
  if (APP.net.connected || !APP.ghost || !APP.bestTrace) return;
  const t = (now - APP.lapStart) / 1000;
  if (t < 0 || t > APP.bestTrace[APP.bestTrace.length - 1][0] + 1.5) { APP.ghost.visible = false; return; }
  const tr = APP.bestTrace;
  if (APP.ghostIdx > 0 && tr[APP.ghostIdx][0] > t) APP.ghostIdx = 0;
  while (APP.ghostIdx < tr.length - 2 && tr[APP.ghostIdx + 1][0] < t) APP.ghostIdx++;
  const a = tr[APP.ghostIdx], b = tr[Math.min(APP.ghostIdx + 1, tr.length - 1)];
  const f = clamp((t - a[0]) / Math.max(0.001, b[0] - a[0]), 0, 1);
  APP.ghost.visible = true;
  APP.ghost.position.set(lerp(a[2], b[2], f), lerp(a[3], b[3], f), lerp(a[4], b[4], f));
  let dy = b[5] - a[5];
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  APP.ghost.rotation.y = a[5] + dy * f;
  const lean = lerp(a[6], b[6], f);
  const pitch = lerp(a[7], b[7], f);
  if (APP.ghost.children[0]) {
    APP.ghost.children[0].rotation.z = -lean;
    if (APP.ghost.children[0].children[0]) APP.ghost.children[0].children[0].rotation.x = pitch;
  }
}

function recordTrace(now) {
  const t = (now - APP.lapStart) / 1000;
  const p = APP.physics;
  APP.currentTrace.push([t, APP.lapDistance, p.pos.x, p.pos.y, p.pos.z, p.yaw, p.lean, p.pitch]);
}

function completeLap(now) {
  const t = (now - APP.lapStart) / 1000;
  APP.lapCount++;
  if (t > 10) {
    if (!APP.best || t < APP.best - 0.0005) {
      APP.best = t;
      APP.bestTrace = APP.currentTrace.slice();
      saveBest();
      applyGhostFromBest();
      toast('NEUE BESTE RUNDE · ' + formatTime(t), 3200);
    } else {
      toast('RUNDE ' + (APP.lapCount - 1) + ' · ' + formatTime(t), 2000);
    }
  }
  APP.lapStart = now;
  APP.lapDistance = 0;
  APP.currentTrace = [];
  APP.prevIndex = APP.physics.trackIndex;
  APP.bestProgIdx = 0;
}

/* ---------------- minimap ---------------- */
let mapCache = null;
let mapBounds = null;

function buildMinimapCache() {
  const track = APP.track;
  const size = 220;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  track.samples.forEach(s => {
    minX = Math.min(minX, s.p.x); maxX = Math.max(maxX, s.p.x);
    minZ = Math.min(minZ, s.p.z); maxZ = Math.max(maxZ, s.p.z);
  });
  const pad = 26;
  const scale = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxZ - minZ));
  const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const oz = (size - (maxZ - minZ) * scale) / 2 - minZ * scale;
  mapBounds = { scale, ox, oz };

  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  track.samples.forEach((s, i) => {
    const x = s.p.x * scale + ox;
    const y = s.p.z * scale + oz;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(244,234,216,.24)';
  ctx.lineWidth = 7.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(244,234,216,.88)';
  ctx.lineWidth = 2.0;
  ctx.stroke();

  const s0 = track.samples[0];
  ctx.beginPath();
  ctx.arc(s0.p.x * scale + ox, s0.p.z * scale + oz, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#f08151';
  ctx.fill();
  mapCache = c;
}

function drawMinimap() {
  const cv = HUD.minimap;
  const ctx = cv.getContext('2d');
  const size = cv.width;
  ctx.clearRect(0, 0, size, size);
  if (mapCache) ctx.drawImage(mapCache, 0, 0);
  if (!mapBounds) return;
  const p = APP.physics;
  const x = p.pos.x * mapBounds.scale + mapBounds.ox;
  const y = p.pos.z * mapBounds.scale + mapBounds.oz;

  if (APP.oppMesh && APP.oppMesh.visible) {
    const ox = APP.oppMesh.position.x * mapBounds.scale + mapBounds.ox;
    const oy = APP.oppMesh.position.z * mapBounds.scale + mapBounds.oz;
    ctx.beginPath();
    ctx.arc(ox, oy, 4.0, 0, Math.PI * 2);
    ctx.fillStyle = '#4fc3f7';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x, y, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = '#f2e7d4';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 7.2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(242,231,212,.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ---------------- FX: Textured Rubber Skidmarks (Darkies), Smoke, Sparks ---------------- */
function createSkidMarkTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  // Soft feathered rubber contact patch profile across width (X: 0..128)
  const grd = ctx.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0.00, 'rgba(12,11,16,0.0)');
  grd.addColorStop(0.14, 'rgba(12,11,16,0.88)');
  grd.addColorStop(0.32, 'rgba(16,15,22,0.96)');
  grd.addColorStop(0.50, 'rgba(22,20,28,0.76)');
  grd.addColorStop(0.68, 'rgba(16,15,22,0.96)');
  grd.addColorStop(0.86, 'rgba(12,11,16,0.88)');
  grd.addColorStop(1.00, 'rgba(12,11,16,0.0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);

  // Subtle rubber grain streaks
  for (let i = 0; i < 650; i++) {
    const x = 14 + Math.random() * 100;
    const y = Math.random() * 128;
    ctx.fillStyle = Math.random() > 0.4 ? 'rgba(6,5,10,0.35)' : 'rgba(90,85,105,0.18)';
    ctx.fillRect(x, y, 2, 10 + Math.random() * 18);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

class SkidSystem {
  constructor(scene, maxQuads = 2400) {
    this.max = maxQuads;
    this.head = 0;
    this.count = 0;
    this.scene = scene;
    this.pos = new Float32Array(maxQuads * 6 * 3);
    this.uv = new Float32Array(maxQuads * 6 * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.tex = createSkidMarkTexture();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, opacity: 0.30, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide
    }));
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = null;
  }

  reset() { this.last = null; }

  add(prev, cur, width) {
    if (this.head >= this.max) { this.head = 0; }
    const dir = new THREE.Vector3().subVectors(cur, prev);
    dir.y = 0;
    if (dir.lengthSq() < 0.00001) return;
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    const l0 = prev.clone().add(side), r0 = prev.clone().sub(side);
    const l1 = cur.clone().add(side), r1 = cur.clone().sub(side);
    const verts = [l0, r0, l1, r0, r1, l1];
    const uvs = [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]];
    const o = this.head * 18;
    const uo = this.head * 12;
    for (let i = 0; i < 6; i++) {
      this.pos[o + i * 3] = verts[i].x;
      this.pos[o + i * 3 + 1] = verts[i].y;
      this.pos[o + i * 3 + 2] = verts[i].z;
      this.uv[uo + i * 2] = uvs[i][0];
      this.uv[uo + i * 2 + 1] = uvs[i][1];
    }
    this.head++;
    this.count = Math.min(this.max, this.count + 1);
    this.geo.setDrawRange(0, this.count * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
  }
}

class ParticleSystem {
  constructor(scene, color, additive = false, max = 360) {
    this.scene = scene;
    this.max = max;
    this.parts = [];
    this.color = color;
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        attribute float size; attribute float alpha; varying float vA;
        void main(){
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (320.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.06, d) * vA;
          gl_FragColor = vec4(uColor, a);
        }`
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, life, size, grow = 1.4) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push({ p: p.clone(), v: v.clone(), life, max: life, size, grow });
  }

  update(dt) {
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.life -= dt;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      q.v.y -= 1.0 * dt;
      q.v.multiplyScalar(1 - dt * 0.6);
      q.p.addScaledVector(q.v, dt);
      q.size += q.grow * dt;
    }
    const n = Math.min(parts.length, this.max);
    for (let i = 0; i < n; i++) {
      const q = parts[i];
      this.pos[i * 3] = q.p.x;
      this.pos[i * 3 + 1] = q.p.y;
      this.pos[i * 3 + 2] = q.p.z;
      this.size[i] = q.size;
      this.alpha[i] = clamp(q.life / q.max, 0, 1) * 0.6;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

class FX {
  constructor(scene) {
    this.scene = scene;
    this.skid = new SkidSystem(scene, 2400);
    this.smoke = new ParticleSystem(scene, 0xe0dace, false, 320);
    this.dust = new ParticleSystem(scene, 0xa89a7c, false, 180);
    this.sparks = new ParticleSystem(scene, 0xffb85c, true, 220);
    this.smokeAcc = 0;
    this.dustAcc = 0;
    this.burnAcc = 0;
    this.lastRear = null;
    this.lastOppRear = null;
  }

  rearContactFor(p) {
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const rear = p.pos.clone().addScaledVector(fwd, -p.spec.wheelbase * 0.47);
    rear.y = p.pos.y + 0.015;
    return rear;
  }

  frontContactFor(p) {
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const front = p.pos.clone().addScaledVector(fwd, p.spec.wheelbase * 0.53);
    front.y = p.pos.y + 0.015;
    return front;
  }

  update(dt) {
    const p = APP.physics;
    if (!p) return;
    const speed = p.speed;
    const avgTempR = (p.tempR[0] + p.tempR[1] + p.tempR[2]) / 3;
    const tempFactor = clamp((avgTempR - 42) / 38, 0.25, 1.0);
    const slip = Math.max(p.spin * 0.75, p.drift * 1.45, (p.brakeSlide || 0) * 1.35, p.burnout ? 1.4 : 0);

    if (p.crashed) {
      this.lastRear = null;
      if (p.speed > 2.5 && Math.random() < 0.45) {
        this.sparkBurst(p.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), 4);
      }
      this.smoke.update(dt);
      this.sparks.update(dt);
      this.dust.update(dt);
      return;
    }

    // Paint subtle, thin Darkies (schwarze Striche) only when genuinely sliding or spinning hard at deep lean!
    const rear = this.rearContactFor(p);
    const front = this.frontContactFor(p);
    const shouldPaintDarkie = (slip > 0.26 || (Math.abs(p.lean) > 0.62 && p.throttle > 0.82 && avgTempR > 65)) && !p.offroad && p.pitch > -0.08;

    if (shouldPaintDarkie && speed > 1.5) {
      if (this.lastRear) {
        const dist = rear.distanceTo(this.lastRear);
        if (dist > 0.10 && dist < 3.5) {
          const width = 0.085 + clamp(slip, 0, 1.0) * 0.045;
          this.skid.add(this.lastRear, rear, width);
          this.lastRear = rear.clone();
        } else if (dist >= 3.5) {
          this.lastRear = rear.clone();
        }
      } else {
        this.lastRear = rear.clone();
      }
    } else {
      this.lastRear = null;
    }

    // Opponent subtle skidmarks only on real slides
    if (APP.oppPhysics && !APP.oppPhysics.crashed && !APP.oppPhysics.offroad) {
      const op = APP.oppPhysics;
      const oSlip = Math.max(op.spin * 0.75, op.drift * 1.45, (op.brakeSlide || 0) * 1.35);
      if (oSlip > 0.28 && op.speed > 4) {
        const oRear = this.rearContactFor(op);
        if (this.lastOppRear && oRear.distanceTo(this.lastOppRear) > 0.10 && oRear.distanceTo(this.lastOppRear) < 3.5) {
          this.skid.add(this.lastOppRear, oRear, 0.095);
          this.lastOppRear = oRear.clone();
        } else if (!this.lastOppRear || oRear.distanceTo(this.lastOppRear) >= 3.5) {
          this.lastOppRear = oRear.clone();
        }
      } else {
        this.lastOppRear = null;
      }
    }

    // Knee slider sparks at extreme lean angle (> 49 deg)
    if (Math.abs(p.lean) > 0.85 && speed > 14 && !p.offroad && Math.random() < 0.35) {
      const side = Math.sign(p.lean);
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      const kneeGround = p.pos.clone().addScaledVector(right, side * 0.65).add(new THREE.Vector3(0, 0.05, 0));
      this.sparkBurst(kneeGround, 2);
    }

    if (!p.offroad && p.frontLock > 0.22 && speed > 2 && p.pitch < 0.04) {
      this.skid.add(front.clone().add(new THREE.Vector3(0.01, 0, 0)), front, 0.14, 0.05);
    }
    if (p.burnout && !p.offroad) {
      this.burnAcc += dt;
      if (this.burnAcc > 0.04) {
        this.burnAcc = 0;
        const a = rear.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.28, 0.004, (Math.random() - 0.5) * 0.28));
        const b = rear.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.28, 0.004, (Math.random() - 0.5) * 0.28));
        this.skid.add(a, b, 0.36, 0.02);
      }
    } else this.burnAcc = 0;

    // Tire smoke
    let rate = 0;
    if (p.burnout) rate = 42;
    else if (p.spin > 0.28) rate = 22 * clamp(p.spin, 0.3, 1.5);
    else if (p.drift > 0.20 || (p.brakeSlide || 0) > 0.18) rate = 16;
    this.smokeAcc += dt * rate;
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1;
      const pos = rear.clone();
      pos.x += (Math.random() - 0.5) * 0.35;
      pos.z += (Math.random() - 0.5) * 0.35;
      this.smoke.spawn(
        pos,
        new THREE.Vector3((Math.random() - 0.5) * 1.3, 0.5 + Math.random() * 1.1, (Math.random() - 0.5) * 1.3),
        1.2 + Math.random() * 1.1, 0.75 + Math.random() * 0.45, 2.5
      );
    }
    this.smoke.update(dt);

    if (p.offroad && speed > 2) {
      this.dustAcc += dt * Math.min(26, speed * 0.7);
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        const pos = p.pos.clone();
        pos.y += 0.15;
        this.dust.spawn(
          pos,
          new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2),
          1.1 + Math.random(), 0.7, 2.2
        );
      }
    }
    this.dust.update(dt);
    this.sparks.update(dt);
  }

  sparkBurst(pos, n = 45) {
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(
        pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.1 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4)),
        new THREE.Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 4, (Math.random() - 0.5) * 5),
        0.35 + Math.random() * 0.45, 0.13, 0.1
      );
    }
  }

  exhaustPop(bikeMesh, physics, strength = 0.8) {
    if (!bikeMesh || !bikeMesh.userData || !bikeMesh.userData.exhaustTip) return;
    bikeMesh.updateMatrixWorld(true);
    const tip = new THREE.Vector3();
    bikeMesh.userData.exhaustTip.getWorldPosition(tip);
    const back = new THREE.Vector3(Math.sin(physics.yaw), 0.15, Math.cos(physics.yaw));
    const count = strength > 0.72 ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const vel = back.clone().multiplyScalar(5.5 + Math.random() * 3.5);
      vel.x += (Math.random() - 0.5) * 1.4;
      vel.z += (Math.random() - 0.5) * 1.4;
      this.sparks.spawn(tip.clone(), vel, 0.08 + Math.random() * 0.07, 0.16 + strength * 0.12, 0.12);
    }
  }

  dispose() {
    const kill = (mesh) => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    };
    kill(this.skid.mesh);
    kill(this.smoke.points);
    kill(this.dust.points);
    kill(this.sparks.points);
  }
}

/* ---------------- input: WASD Driving + Manual Arrow-Key Rider Lean (Smooth & Progressive) ---------------- */
const Keys = {};
let gpPrev = {};

function initInput() {
  const unlockAudio = () => {
    if (AU && AU.ctx && AU.ctx.state === 'suspended') {
      AU.ctx.resume();
    }
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', (e) => {
    unlockAudio();
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    Keys[e.code] = true;
    if (e.code === 'Escape') togglePause();
    if (e.code === 'KeyC') toggleCamera();
    if (e.code === 'KeyR') resetBike();
    if (e.code === 'KeyM') { AU.init(); AU.setMuted(!AU.muted); syncHudButtons(); toast(AU.muted ? 'TON AUS' : 'TON AN', 1200); }
    if (e.code === 'KeyH') showHint();
    if (e.code === 'Enter' && APP.state === 'menu') triggerStartButton();
    if (APP.state === 'racing') {
      if (e.code === 'KeyE') { if (APP.physics.shiftUp()) AU.shift(); }
      if (e.code === 'KeyQ') { if (APP.physics.shiftDown()) AU.shift(); }
    }
  });
  window.addEventListener('keyup', (e) => { Keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in Keys) Keys[k] = false; });
}

function readInput() {
  const p = APP.physics;
  let throttle = Keys['KeyW'] ? 1 : 0;
  let frontBrake = Keys['KeyS'] ? 1 : 0;
  let rearBrake = Keys['KeyX'] ? 1 : 0;
  let clutch = Keys['Space'] ? 1 : 0;

  let steer = (Keys['KeyD'] ? 1 : 0) - (Keys['KeyA'] ? 1 : 0);
  // Manual Rider Leaning with Arrow Keys (Skill Gap: Hang-Off / Aero Tuck / Wheelie / Stoppie)
  let weightX = (Keys['ArrowRight'] ? 1 : 0) - (Keys['ArrowLeft'] ? 1 : 0);
  let weightY = (Keys['ArrowUp'] ? 1 : 0) - (Keys['ArrowDown'] ? 1 : 0);

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && pads[0];
  if (gp) {
    const ax = gp.axes;
    const dz = (v) => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
    if (dz(ax[0] || 0)) steer = dz(ax[0]);
    weightX = dz(ax[2] || 0) || weightX;
    weightY = -dz(ax[3] || 0) || weightY;
    const t = gp.buttons[7] ? gp.buttons[7].value : 0;
    const b = gp.buttons[6] ? gp.buttons[6].value : 0;
    if (t > 0.02) throttle = t;
    if (b > 0.02) frontBrake = b;
    if (gp.buttons[1] && gp.buttons[1].value > 0.1) rearBrake = gp.buttons[1].value;
    if (gp.buttons[0] && gp.buttons[0].value > 0.1) clutch = gp.buttons[0].value;
    if (gp.buttons[5] && gp.buttons[5].pressed && !gpPrev[5]) { if (p.shiftUp()) AU.shift(); }
    if (gp.buttons[4] && gp.buttons[4].pressed && !gpPrev[4]) { if (p.shiftDown()) AU.shift(); }
    if (gp.buttons[9] && gp.buttons[9].pressed && !gpPrev[9]) togglePause();
    if (gp.buttons[3] && gp.buttons[3].pressed && !gpPrev[3]) toggleCamera();
    if (gp.buttons[8] && gp.buttons[8].pressed && !gpPrev[8]) resetBike();
    gpPrev = {};
    for (let i = 0; i < gp.buttons.length; i++) gpPrev[i] = gp.buttons[i].pressed;
  }

  if (APP.state === 'countdown' || APP.state === 'paused') {
    throttle = 0; frontBrake = 0; rearBrake = 0; clutch = 1; steer = 0; weightX = 0; weightY = 0;
  }
  return { throttle, frontBrake, rearBrake, clutch, steer, weightX, weightY };
}

/* ---------------- visuals & articulated rider sync ---------------- */
function syncSingleBikeMesh(mesh, shadowBlob, p, dt, hideHeadForPov = false) {
  if (!mesh || !p) return;
  const u = mesh.userData;
  mesh.position.set(p.pos.x, 0.016, p.pos.z); // Firmly presses tire contact patch into the y=0.025 road surface!
  mesh.rotation.y = p.yaw;
  const s = (APP.camMode === 'iso' && APP.state !== 'menu') ? 1.32 : 1.0;
  mesh.scale.set(s, s, s);

  const lean = p.lean || 0;
  u.lean.rotation.z = -lean;
  u.lean.position.y = 0; // Never lift bike into the air when leaning!

  if (p.crashed) {
    u.lean.rotation.z = -lean + (p.crashRoll || 0);
    u.pitch.rotation.x = (p.pitch || 0) + (p.crashPitch || 0);
    u.pitch.position.y = 0;
  } else {
    u.pitch.rotation.x = (p.pitch || 0) - (p.forkDive || 0) * 0.30;
    const lift = p.pitch < 0 ? -Math.sin(p.pitch) * p.spec.wheelbase * 0.92 : 0;
    u.pitch.position.y = lift;
  }
  u.pitch.position.z = u.rearZ;

  u.frontSteer.rotation.y = -(p.steerVis || 0);
  u.rearWheel.rotation.x -= (p.rearWheelOmega || 0) * dt;
  u.frontWheel.rotation.x -= (p.frontWheelOmega || 0) * dt;

  if (!p.crashed) {
    // In POV mode, hide rider mesh so camera never clips inside helmet/shoulders, while keeping 3D cockpit visible
    u.rider.visible = !hideHeadForPov;
    updateRiderIK(mesh, p, dt);
  }

  if (u.glow) {
    u.glow.intensity = 0.25 + (APP.opts.theme === 'dusk' ? 0.9 : 0.25);
  }
  if (shadowBlob) {
    // Lock crisp tire contact AO shadow directly under the front & rear tire contact patches!
    shadowBlob.group.position.set(p.pos.x, 0.029, p.pos.z);
    shadowBlob.group.rotation.y = p.yaw;
    shadowBlob.group.scale.set(s, 1, s);
    shadowBlob.mat.opacity = p.offroad ? 0.45 : 0.82;
  }
}

function syncBikeVisual(dt) {
  const isPov = APP.camMode === 'pov' && (APP.state === 'racing' || APP.state === 'countdown');
  syncSingleBikeMesh(APP.bikeMesh, APP.shadowBlob, APP.physics, dt, isPov);
}

/* ---------------- 2.5D Isometric, Chase & POV Camera ---------------- */
let camInit = false;
let camShakeSeed = 0;

function createShadowBlob() {
  const c = makeCanvas(128, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 256);

  // Soft chassis ambient occlusion shadow in the middle
  const chassisGrd = ctx.createRadialGradient(64, 128, 6, 64, 128, 56);
  chassisGrd.addColorStop(0, 'rgba(8,7,14,0.68)');
  chassisGrd.addColorStop(0.55, 'rgba(8,7,14,0.32)');
  chassisGrd.addColorStop(1, 'rgba(8,7,14,0)');
  ctx.fillStyle = chassisGrd;
  ctx.save();
  ctx.scale(0.65, 1.85);
  ctx.beginPath();
  ctx.arc(64 / 0.65, 128 / 1.85, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Sharp, dark tire contact patch AO right under Front Wheel (y=46) and Rear Wheel (y=210)
  [46, 210].forEach(cy => {
    const tireGrd = ctx.createRadialGradient(64, cy, 2, 64, cy, 28);
    tireGrd.addColorStop(0, 'rgba(4,4,8,0.95)');
    tireGrd.addColorStop(0.45, 'rgba(6,6,12,0.72)');
    tireGrd.addColorStop(1, 'rgba(6,6,12,0)');
    ctx.fillStyle = tireGrd;
    ctx.save();
    ctx.scale(0.55, 1.25);
    ctx.beginPath();
    ctx.arc(64 / 0.55, cy / 1.25, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(1.15, 2.25);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.82, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  });
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.add(mesh);
  group.renderOrder = 1;
  APP.scene.add(group);
  return { group, mat };
}

function updateCamera(dt) {
  const p = APP.physics;
  const cam = APP.camera;
  const bike = APP.bikeMesh;
  if (!p || !bike) return;

  if (APP.state === 'menu') {
    const t = APP.time;
    const yaw = bike.rotation.y;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const drift = Math.sin(t * 0.15) * 0.8;
    const desired = bike.position.clone()
      .addScaledVector(fwd, -7.2)
      .addScaledVector(right, -3.6 + drift * 0.5)
      .add(new THREE.Vector3(0, 2.95 + Math.sin(t * 0.2) * 0.08, 0));
    cam.position.lerp(desired, camInit ? 1 - Math.exp(-2.5 * dt) : 1);
    const look = bike.position.clone().addScaledVector(fwd, 9.2).add(new THREE.Vector3(0, 2.15, 0));
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    cam.fov = lerp(cam.fov, 48, 1 - Math.exp(-3 * dt));
    cam.updateProjectionMatrix();
    camInit = true;
    return;
  }

  const speed = p.speed;
  const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

  // 1) CIRCUIT SUPERSTARS FIXED-COMPASS ISOMETRIC CAMERA (Never spins with bike yaw -> 100% road connection!)
  if (APP.camMode === 'iso') {
    const z = APP.isoZoom;
    // Lead the camera slightly ahead in the direction of travel so upcoming corners are always in view
    const leadDist = clamp(speed * 0.18, 0, 5.5);
    const focus = p.pos.clone().addScaledVector(fwd, leadDist);

    // Fixed world-space isometric offset (Tilt-Shift Telephoto Diorama angle!)
    const isoOffset = new THREE.Vector3(-28.5 * z, 33.0 * z, 28.5 * z);
    const desired = focus.clone().add(isoOffset);

    if (!camInit) {
      cam.position.copy(desired);
      APP._camFocus = focus.clone();
    } else {
      cam.position.lerp(desired, 1 - Math.exp(-9.0 * dt));
      if (!APP._camFocus) APP._camFocus = focus.clone();
      APP._camFocus.lerp(focus, 1 - Math.exp(-9.0 * dt));
    }

    cam.up.set(0, 1, 0);
    cam.lookAt(APP._camFocus);
    cam.fov = lerp(cam.fov, 27, 1 - Math.exp(-6 * dt));
    cam.updateProjectionMatrix();
    camInit = true;
    return;
  }

  // 2) RIDER POV (Locked to `u.povCamAnchor` on chassis -> Leans with bike & NEVER clips into tank during Wheelies!)
  if (APP.camMode === 'pov' && !p.crashed) {
    const u = bike.userData;
    const hangShift = clamp((p.weightX || 0) * 0.14 - Math.sin(p.lean) * 0.16, -0.22, 0.22);
    if (u.povCamAnchor && u.povLookTarget) {
      u.povCamAnchor.position.set(hangShift, 1.15 - Math.abs(hangShift) * 0.06, -0.06);
      u.povLookTarget.position.set(hangShift * 1.5 - p.lean * 1.4, 0.65, -8.5);
      bike.updateMatrixWorld(true);

      const worldEye = new THREE.Vector3();
      const worldLook = new THREE.Vector3();
      u.povCamAnchor.getWorldPosition(worldEye);
      u.povLookTarget.getWorldPosition(worldLook);

      cam.position.copy(worldEye);
      // Tilt camera up-vector by 78% of bike lean angle so the POV camera genuinely leans into corners with the bike!
      const rollAngle = p.lean * 0.78;
      const localUp = new THREE.Vector3(Math.sin(rollAngle), Math.cos(rollAngle), 0);
      localUp.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      cam.up.copy(localUp);
      cam.lookAt(worldLook);
    }
    cam.fov = lerp(cam.fov, 68 + clamp(speed / 80, 0, 1) * 7, 1 - Math.exp(-4 * dt));
    cam.updateProjectionMatrix();
    camInit = true;
    return;
  }

  // 3) CLOSE CHASE CAMERA (Raised higher for a commanding 3rd-person overview over rider & corners!)
  const desired = p.pos.clone()
    .addScaledVector(fwd, -5.6 - clamp(speed * 0.012, 0, 0.85))
    .addScaledVector(right, p.lean * 0.65)
    .add(new THREE.Vector3(0, 2.55 + Math.max(0, p.pitch) * 0.35, 0));
  if (p.crashed) {
    desired.copy(p.pos).addScaledVector(fwd, -6.8).add(new THREE.Vector3(0, 3.4, 0));
  }

  const idx = APP.track.nearestIndex(desired, p.trackIndex);
  const groundY = APP.track.groundYAt(desired, idx);
  desired.y = Math.max(desired.y, groundY + 1.4);

  APP.shake = Math.max(0, APP.shake - dt * 1.7);
  const sh = APP.shake * 0.45 + (p.offroad ? clamp(speed / 50, 0, 1) * 0.06 : 0);
  camShakeSeed += dt * 18;
  desired.x += Math.sin(camShakeSeed * 1.7) * sh;
  desired.y += Math.sin(camShakeSeed * 2.3) * sh * 0.7;

  if (!camInit) cam.position.copy(desired);
  else cam.position.lerp(desired, 1 - Math.exp(-8.0 * dt));

  const look = p.pos.clone()
    .addScaledVector(fwd, 9.5)
    .addScaledVector(right, p.lean * 1.0)
    .add(new THREE.Vector3(0, 0.82 + p.pitch * 0.8, 0));
  cam.up.set(0, 1, 0);
  cam.lookAt(look);
  cam.rotateZ(-p.lean * 0.14);
  cam.fov = lerp(cam.fov, 54 + clamp(speed / 85, 0, 1) * 10, 1 - Math.exp(-4 * dt));
  cam.updateProjectionMatrix();
  camInit = true;
}

/* ---------------- Multi-Limb Articulated Ragdoll Crash ---------------- */
const CRASH_LABELS = {
  lowsider: 'LOWSIDER', highsider: 'HIGHSIDER', loop: 'WHEELIE-LOOP',
  endo: 'STOPPIE-FLIP', barrier: 'STRECKENBEGRENZUNG'
};

let ragdollActive = false;
let ragdollState = null;

function beginCrashVisual() {
  if (APP.crashVisual) return;
  APP.crashVisual = true;
  APP.shake = 1.0;
  AU.crash();
  APP.scene.updateMatrixWorld(true);

  const rider = APP.bikeMesh.userData.rider;
  const ru = rider.userData;
  APP.scene.attach(rider);
  ragdollActive = true;

  const fwd = new THREE.Vector3(-Math.sin(APP.physics.yaw), 0, -Math.cos(APP.physics.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const baseVel = APP.physics.crashSlide.clone().addScaledVector(fwd, APP.physics.speed * 0.36);

  ragdollState = {
    vel: baseVel,
    angVel: new THREE.Vector3(
      (Math.random() - 0.5) * 8 + (APP.physics.crashType === 'highsider' ? 5 : 2),
      (Math.random() - 0.5) * 6,
      -Math.sign(APP.physics.lean || 1) * (5 + Math.random() * 4)
    ),
    phase: 0,
    right
  };

  if (APP.fx) APP.fx.sparkBurst(APP.physics.pos.clone().add(new THREE.Vector3(0, 0.35, 0)), 55);

  HUD.crashType.textContent = CRASH_LABELS[APP.physics.crashType] || 'STURZ';
  HUD.crashMsg.classList.remove('hidden');
  APP.crashMsgShown = true;
}

function updateCrashRider(dt) {
  if (!ragdollActive || !ragdollState) return;
  const rider = APP.bikeMesh.userData.rider;
  const ru = rider.userData;
  const st = ragdollState;
  st.phase += dt * 11;

  st.vel.y -= G * dt;
  rider.position.addScaledVector(st.vel, dt);
  rider.rotation.x += st.angVel.x * dt;
  rider.rotation.y += st.angVel.y * dt;
  rider.rotation.z += st.angVel.z * dt;

  // Articulated limb flailing & tumbling around joints during ragdoll roll!
  const speedMag = clamp(st.vel.length() / 12, 0, 1.4);
  if (ru && ru.arms && ru.legs) {
    const bodyPos = ru.body.position;
    ru.arms.forEach((arm, idx) => {
      const s = arm.side;
      const sh = new THREE.Vector3(s * 0.20, ru.shoulderY, ru.shoulderZ).add(bodyPos);
      const flailA = st.phase * (1.2 + idx * 0.3) + s;
      const elbow = sh.clone().add(new THREE.Vector3(
        s * (0.22 + Math.sin(flailA) * 0.14 * speedMag),
        Math.cos(flailA) * 0.22 * speedMag - 0.08,
        Math.sin(flailA * 0.7) * 0.18 * speedMag
      ));
      const hand = elbow.clone().add(new THREE.Vector3(
        s * (0.18 + Math.cos(flailA * 1.3) * 0.16 * speedMag),
        Math.sin(flailA * 1.3) * 0.20 * speedMag - 0.10,
        Math.cos(flailA) * 0.18 * speedMag
      ));
      orientLimbMesh(arm.upper, sh, elbow);
      orientLimbMesh(arm.lower, elbow, hand);
      arm.elbow.position.copy(elbow);
      arm.hand.position.copy(hand);
    });

    ru.legs.forEach((leg, idx) => {
      const s = leg.side;
      const hip = new THREE.Vector3(s * 0.13, -0.02, 0.02).add(bodyPos);
      const flailL = st.phase * (1.0 + idx * 0.25) - s;
      const knee = hip.clone().add(new THREE.Vector3(
        s * (0.16 + Math.sin(flailL) * 0.12 * speedMag),
        -0.26 + Math.cos(flailL) * 0.16 * speedMag,
        -0.18 + Math.sin(flailL) * 0.18 * speedMag
      ));
      const foot = knee.clone().add(new THREE.Vector3(
        s * 0.12,
        -0.28 + Math.sin(flailL * 1.2) * 0.14 * speedMag,
        0.14 + Math.cos(flailL) * 0.16 * speedMag
      ));
      orientLimbMesh(leg.thigh, hip, knee);
      orientLimbMesh(leg.shin, knee, foot);
      leg.knee.position.copy(knee);
      leg.boot.position.copy(foot);
    });
  }

  const idx = APP.track.nearestIndex(rider.position, APP.physics.trackIndex);
  const gy = APP.track.groundYAt(rider.position, idx) + 0.36;
  if (rider.position.y < gy) {
    rider.position.y = gy;
    st.vel.y = Math.abs(st.vel.y) * 0.34;
    st.vel.x *= 0.76;
    st.vel.z *= 0.76;
    st.angVel.multiplyScalar(0.75);
  }
  st.angVel.multiplyScalar(1 - dt * 0.35);
}

function restoreRiderToBike() {
  if (!ragdollActive) return;
  const rider = APP.bikeMesh.userData.rider;
  APP.bikeMesh.userData.chassis.add(rider);
  rider.position.set(0, 0, 0);
  rider.rotation.set(0, 0, 0);
  ragdollActive = false;
  ragdollState = null;
  updateRiderIK(APP.bikeMesh, APP.physics, 0.1);
}

function resetBike() {
  if (APP.state !== 'racing' && APP.state !== 'paused') return;
  const resume = APP.state === 'paused';
  APP.physics.reset(APP.track, APP.lastSafeIndex || APP.track.startIndex, 0);
  APP.crashVisual = false;
  APP.crashMsgShown = false;
  HUD.crashMsg.classList.add('hidden');
  APP.shake = 0;
  restoreRiderToBike();
  APP.prevIndex = APP.physics.trackIndex;
  APP.bestProgIdx = 0;
  APP.ghostIdx = 0;
  camInit = false;
  if (resume) togglePause();
  toast('MOTORRAD AUFGESTELLT', 1000);
}

/* ---------------- 1v1 Opponent (Online & Rival Bot) ---------------- */
function initOpponentForRace() {
  if (!APP.net.connected) {
    if (APP.oppMesh) APP.oppMesh.visible = false;
    if (APP.oppShadow) APP.oppShadow.group.visible = false;
    HUD.oppTag.classList.add('hidden');
    return;
  }
  const oppBikeId = APP.net.remoteBikeId || 'i4';
  rebuildOpponentBike(oppBikeId);
  APP.oppMesh.visible = true;
  APP.oppShadow.group.visible = true;

  if (APP.net.role === 'bot') {
    APP.oppPhysics = new BikePhysics(oppBikeId);
    APP.oppPhysics.reset(APP.track, APP.track.startIndex, getOppGridSlot());
    APP.oppLapCount = 1;
    APP.oppLapDistance = 0;
    APP.oppPrevIndex = APP.oppPhysics.trackIndex;
    syncSingleBikeMesh(APP.oppMesh, APP.oppShadow, APP.oppPhysics, 0.016, false);
  } else {
    const pose = APP.track.poseAtIndex(APP.track.startIndex, getOppGridSlot());
    APP.oppMesh.position.copy(pose.pos);
    APP.oppMesh.rotation.set(0, pose.yaw, 0);
  }
}

function updateBotPhysics(dt) {
  const bp = APP.oppPhysics;
  if (!bp || APP.state !== 'racing') return;
  if (bp.crashed && bp.crashTimer > 2.5) {
    bp.reset(APP.track, bp.trackIndex, 0);
  }
  const t = APP.track;
  const idx = bp.trackIndex;
  const lookIdx = (idx + 14) % t.count;
  const farIdx = (idx + 32) % t.count;
  const sCur = t.samples[idx];
  const sLook = t.samples[lookIdx];
  const sFar = t.samples[farIdx];

  // Curvature ahead determines target speed (scaled for compact Circuit Superstars track)
  const curveNear = Math.acos(clamp(sCur.t.dot(sLook.t), -1, 1));
  const curveFar = Math.acos(clamp(sCur.t.dot(sFar.t), -1, 1));
  const maxCurve = Math.max(curveNear * 1.3, curveFar);
  const targetSpeed = clamp(39 - maxCurve * 48, 15, 38);

  // Target point slightly inside the apex
  const targetPos = sLook.p.clone();
  const dx = targetPos.x - bp.pos.x;
  const dz = targetPos.z - bp.pos.z;
  const desiredYaw = Math.atan2(-dx, -dz);
  let yawErr = desiredYaw - bp.yaw;
  while (yawErr > Math.PI) yawErr -= Math.PI * 2;
  while (yawErr < -Math.PI) yawErr += Math.PI * 2;

  const steer = clamp(-yawErr * 2.2, -0.92, 0.92);
  const throttle = bp.speed < targetSpeed ? clamp((targetSpeed - bp.speed) * 0.25, 0.25, 0.95) : 0.05;
  const frontBrake = bp.speed > targetSpeed + 2.5 ? clamp((bp.speed - targetSpeed) * 0.14, 0, 0.82) : 0;
  const rearBrake = frontBrake > 0.45 && Math.abs(steer) > 0.3 ? 0.35 : 0;

  const botInput = {
    throttle, frontBrake, rearBrake, clutch: 0,
    steer, weightX: steer * 0.85, weightY: frontBrake > 0.3 ? 0.5 : -0.3
  };

  const prevIdx = bp.trackIndex;
  const sub = 1 / 120;
  let rem = dt;
  while (rem > 0) {
    const d = Math.min(sub, rem);
    bp.update(d, botInput, t);
    rem -= d;
  }

  let ds = bp.trackIndex - prevIdx;
  if (ds < -t.count / 2) ds += t.count;
  if (ds > t.count / 2) ds -= t.count;
  APP.oppLapDistance += ds * t.ds;
  if (prevIdx > t.count * 0.78 && bp.trackIndex < t.count * 0.22 && APP.oppLapDistance > t.length * 0.55) {
    APP.oppLapCount++;
    APP.oppLapDistance = 0;
  }

  syncSingleBikeMesh(APP.oppMesh, APP.oppShadow, bp, dt, false);
}

function updateOpponentVisuals(dt) {
  if (!APP.net.connected || !APP.oppMesh) {
    HUD.oppTag.classList.add('hidden');
    return;
  }

  if (APP.net.role === 'bot') {
    updateBotPhysics(dt);
  } else if (APP.net.remoteState) {
    const rs = APP.net.remoteState;
    if (rs.bike && BIKES[rs.bike] && APP.oppMesh.userData.spec.id !== rs.bike) {
      rebuildOpponentBike(rs.bike);
      APP.oppMesh.visible = true;
      APP.oppShadow.group.visible = true;
    }
    const fakeP = {
      pos: APP.oppMesh.position.lerp(new THREE.Vector3(rs.x, rs.y, rs.z), 1 - Math.exp(-16 * dt)),
      yaw: rs.yaw,
      lean: rs.lean,
      pitch: rs.pitch,
      steer: -rs.lean * 0.7,
      steerVis: rs.steerVis || 0,
      weightX: rs.weightX || 0,
      weightY: rs.weightY || 0,
      throttle: rs.throttle || 0,
      frontBrake: rs.frontBrake || 0,
      rearWheelOmega: (rs.speed || 0) / 0.3,
      frontWheelOmega: (rs.speed || 0) / 0.3,
      crashed: !!rs.crashed,
      crashRoll: rs.crashed ? 1.1 : 0,
      crashPitch: 0,
      spec: APP.oppMesh.userData.spec
    };
    syncSingleBikeMesh(APP.oppMesh, APP.oppShadow, fakeP, dt, false);
  }

  // Project 3D position to 2D screen for the floating P2 badge
  const tagWorld = APP.oppMesh.position.clone().add(new THREE.Vector3(0, 2.05, 0));
  tagWorld.project(APP.camera);
  if (tagWorld.z > -1 && tagWorld.z < 1) {
    const sx = (tagWorld.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-tagWorld.y * 0.5 + 0.5) * window.innerHeight;
    HUD.oppTag.style.left = sx + 'px';
    HUD.oppTag.style.top = sy + 'px';
    HUD.oppTag.textContent = APP.net.role === 'bot' ? 'P2 · RIVAL BOT' : 'P2 · KOLLEGE';
    HUD.oppTag.classList.remove('hidden');
  } else {
    HUD.oppTag.classList.add('hidden');
  }
}

/* ---------------- game states ---------------- */
let countdownTimer = 0;
let lastCount = -1;

function triggerStartButton() {
  if (APP.net.connected && APP.net.role !== 'bot') {
    APP.net.send({
      type: 'start',
      bike: APP.opts.bike,
      track: APP.opts.track,
      theme: APP.opts.theme
    });
  }
  startGame(false);
}

function startGame(nocountdown = false) {
  AU.init();
  AU.setBike(BIKES[APP.opts.bike]);
  AU.setMuted(AU.muted);
  if (APP.menuFill) APP.menuFill.intensity = 0;

  if (APP.opts.track !== APP.track.id) rebuildTrack(true);
  if (APP.bikeMesh && APP.bikeMesh.userData.spec.id !== APP.opts.bike) rebuildBike();

  restoreRiderToBike();
  if (APP.bikeMesh) APP.bikeMesh.userData.rider.visible = true;

  APP.physics = new BikePhysics(APP.opts.bike);
  APP.physics.setup = SETUP;
  APP.physics.reset(APP.track, APP.track.startIndex, getMyGridSlot());
  APP.lastSafeIndex = APP.track.startIndex;
  APP.prevIndex = APP.physics.trackIndex;
  APP.lapStart = performance.now();
  APP.lapDistance = 0;
  APP.lapCount = 1;
  APP.currentTrace = [];
  APP.crashVisual = false;
  APP.crashMsgShown = false;
  APP.bestProgIdx = 0;
  APP.ghostIdx = 0;
  HUD.crashMsg.classList.add('hidden');
  loadBest();
  applyGhostFromBest();
  initOpponentForRace();

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('pause').classList.add('hidden');
  HUD.hint.style.opacity = 1;
  APP.hintTimer = 10;
  camInit = false;
  updateTrackLabels();
  syncHudButtons();
  showCountdown(nocountdown ? 0.4 : 3.2);
}

function showCountdown(sec) {
  APP.state = 'countdown';
  countdownTimer = sec;
  lastCount = -1;
  HUD.countdown.classList.remove('hidden');
}

function togglePause() {
  if (APP.state === 'menu') return;
  if (APP.state === 'paused') {
    APP.lapStart += performance.now() - APP.pausedAt;
    APP.state = 'racing';
    document.getElementById('pause').classList.add('hidden');
    camInit = false;
  } else if (APP.state === 'racing' || APP.state === 'countdown') {
    APP.pausedAt = performance.now();
    APP.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    updateSetupUI();
  }
}

function toggleCamera() {
  const order = ['iso', 'chase', 'pov'];
  const next = order[(order.indexOf(APP.camMode) + 1) % order.length];
  APP.camMode = next;
  camInit = false;
  updateMenuSelection();
  updateSetupUI();
  syncHudButtons();
  const labels = { iso: '2.5D ISOMETRISCH (TOP-DOWN)', chase: 'CHASE CAM', pov: 'HELM-POV' };
  toast(labels[APP.camMode], 1400);
}

function quitToMenu() {
  APP.state = 'menu';
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  HUD.crashMsg.classList.add('hidden');
  HUD.oppTag.classList.add('hidden');
  APP.crashVisual = false;
  restoreRiderToBike();
  if (APP.oppMesh) APP.oppMesh.visible = false;
  if (APP.oppShadow) APP.oppShadow.group.visible = false;
  placeBikeAtStart();
  camInit = false;
  APP.physics.reset(APP.track, APP.track.startIndex, 0);
  updateMenuSelection();
}

function showHint() {
  HUD.hint.style.opacity = 1;
  APP.hintTimer = 8;
}

/* ---------------- menu & 1v1 lobby bindings ---------------- */
function buildMenu() {
  const cards = document.getElementById('bikeCards');
  cards.innerHTML = '';
  Object.values(BIKES).forEach((bike, i) => {
    const btn = document.createElement('button');
    btn.className = 'bike-card' + (bike.id === APP.opts.bike ? ' active' : '');
    btn.dataset.id = bike.id;
    const swatchHex = '#' + bike.color.toString(16).padStart(6, '0');
    btn.innerHTML = `
      <div class="bike-index-col">
        <div class="bike-index">0${i + 1}</div>
        <span class="bike-swatch" style="background:${swatchHex}"></span>
      </div>
      <div>
        <div class="bike-name-row">
          <div class="bike-name">${bike.name}</div>
          <span class="bike-badge">${bike.mass} KG</span>
        </div>
        <div class="bike-sub">${bike.cls} · ${bike.engineLabel} · ${bike.power} kW · ${bike.torque} Nm</div>
      </div>
      <div class="bike-stats">
        ${['PWR', 'AGI', 'STB'].map((label, k) => `
          <div class="stat"><span>${label}</span><i><b style="width:${bike.stats[k]}%"></b></i></div>
        `).join('')}
      </div>`;
    btn.addEventListener('click', () => {
      if (APP.opts.bike === bike.id) return;
      APP.opts.bike = bike.id;
      rebuildBike();
      updateMenuSelection();
      loadBest();
      if (APP.net.connected) APP.net.send({ type: 'hello', bike: APP.opts.bike });
    });
    cards.appendChild(btn);
  });

  const tp = document.getElementById('trackPills');
  tp.innerHTML = '';
  Object.values(TRACK_DEFS).forEach(t => {
    const b = document.createElement('button');
    b.dataset.track = t.id;
    b.textContent = t.name;
    b.className = t.id === APP.opts.track ? 'active' : '';
    b.addEventListener('click', () => {
      if (APP.opts.track === t.id) return;
      APP.opts.track = t.id;
      rebuildTrack(true);
      updateMenuSelection();
    });
    tp.appendChild(b);
  });

  document.querySelectorAll('#menuCamPills button').forEach(b => {
    b.classList.toggle('active', b.dataset.cam === APP.camMode);
    b.addEventListener('click', () => {
      APP.camMode = b.dataset.cam;
      camInit = false;
      updateMenuSelection();
      updateSetupUI();
    });
  });

  document.querySelectorAll('#timePills button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === APP.opts.theme);
    b.addEventListener('click', () => {
      APP.opts.theme = b.dataset.theme;
      rebuildWorld();
      updateMenuSelection();
    });
  });

  // 1v1 Online Lobby bindings
  const statusEl = document.getElementById('lobbyStatus');
  const badgeEl = document.getElementById('lobbyBadge');
  const startLabelEl = document.getElementById('startBtnLabel');
  const codeInput = document.getElementById('joinCodeInput');

  APP.net.onStatusChange = (text, isConnected, role, code) => {
    if (statusEl) statusEl.textContent = text;
    if (badgeEl) {
      badgeEl.textContent = isConnected ? (role === 'bot' ? '1v1 VS. BOT' : `1v1 BEREIT · ${code}`) : (code ? `WARTE · ${code}` : 'SOLO / OFFLINE');
      badgeEl.classList.toggle('ready', isConnected);
    }
    if (startLabelEl) {
      startLabelEl.textContent = isConnected ? '1v1 DUELL STARTEN' : 'SOLO FAHREN';
    }
  };

  APP.net.onRemoteStart = (msg) => {
    if (msg.track && TRACK_DEFS[msg.track] && APP.opts.track !== msg.track) {
      APP.opts.track = msg.track;
      rebuildTrack(true);
    }
    startGame(false);
  };

  document.getElementById('hostLobbyBtn').addEventListener('click', () => {
    const code = APP.net.hostLobby(APP.opts.bike, APP.opts.track, APP.opts.theme);
    if (codeInput) codeInput.value = code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
  });

  document.getElementById('joinLobbyBtn').addEventListener('click', () => {
    APP.net.joinLobby(codeInput.value, APP.opts.bike);
  });

  document.getElementById('botLobbyBtn').addEventListener('click', () => {
    const botBike = APP.opts.bike === 'v4' ? 'i4' : 'v4';
    APP.net.enableBotOpponent(botBike);
  });

  document.getElementById('startBtn').addEventListener('click', () => triggerStartButton());
  updateMenuSelection();
}

function updateMenuSelection() {
  document.querySelectorAll('.bike-card').forEach(c => c.classList.toggle('active', c.dataset.id === APP.opts.bike));
  document.querySelectorAll('#trackPills button').forEach(b => b.classList.toggle('active', b.dataset.track === APP.opts.track));
  document.querySelectorAll('#menuCamPills button').forEach(b => b.classList.toggle('active', b.dataset.cam === APP.camMode));
  document.querySelectorAll('#timePills button').forEach(b => b.classList.toggle('active', b.dataset.theme === APP.opts.theme));
  const bike = BIKES[APP.opts.bike];
  document.getElementById('bikeNote').textContent = `${bike.cls} · ${bike.engineLabel}`;
  updateTrackLabels();
}

function updateTrackLabels() {
  if (!APP.track) return;
  const t = APP.track;
  const el = document.getElementById('trackDesc');
  if (el) el.textContent = `${t.def.name} · ${(t.length / 1000).toFixed(2)} km · ${t.cornerCount} Kurven · ${Math.round(t.climb)} hm`;
  const hudTrack = document.getElementById('hudTrack');
  if (hudTrack) hudTrack.textContent = t.def.name;
  const hudMode = document.getElementById('hudMode');
  if (hudMode) hudMode.textContent = APP.net.connected ? '1v1 DUELL' : 'TIME ATTACK / SOLO';
}

/* ---------------- setup UI ---------------- */
function bindSetupUI() {
  const bindRange = (id, key, fmt) => {
    const el = document.getElementById(id);
    const label = document.getElementById(id + 'Val');
    const apply = () => {
      SETUP[key] = parseFloat(el.value);
      if (label) label.textContent = fmt(SETUP[key]);
      if (APP.physics) APP.physics.setup = SETUP;
    };
    el.addEventListener('input', apply);
    el.value = SETUP[key];
    apply();
  };
  bindRange('pressureF', 'pressureF', v => v.toFixed(2) + ' bar');
  bindRange('pressureR', 'pressureR', v => v.toFixed(2) + ' bar');
  bindRange('springF', 'springF', v => v.toFixed(2));
  bindRange('springR', 'springR', v => v.toFixed(2));
  bindRange('damping', 'damping', v => v.toFixed(2));
  bindRange('gearing', 'gearing', v => v.toFixed(2));

  document.querySelectorAll('#compoundPills button').forEach(b => {
    b.addEventListener('click', () => {
      SETUP.compound = b.dataset.compound;
      updateSetupUI();
    });
  });

  const bindAssist = (id, key) => {
    document.querySelectorAll(`#${id} button`).forEach(b => {
      b.addEventListener('click', () => {
        SETUP[key] = parseInt(b.dataset.val, 10);
        updateSetupUI();
        if (APP.physics) APP.physics.setup = SETUP;
      });
    });
  };
  bindAssist('tcPills', 'tc');
  bindAssist('absPills', 'abs');
  bindAssist('awPills', 'aw');

  document.querySelectorAll('#camPills button').forEach(b => {
    b.addEventListener('click', () => {
      APP.camMode = b.dataset.cam;
      camInit = false;
      updateMenuSelection();
      updateSetupUI();
    });
  });

  document.getElementById('resumeBtn').addEventListener('click', togglePause);
  document.getElementById('restartBtn').addEventListener('click', () => {
    document.getElementById('pause').classList.add('hidden');
    startGame(false);
  });
  document.getElementById('quitBtn').addEventListener('click', quitToMenu);
  updateSetupUI();
}

function segActive(container, value) {
  container.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', String(b.dataset.val) === String(value));
  });
}

function updateSetupUI() {
  document.querySelectorAll('#compoundPills button').forEach(b => {
    b.classList.toggle('active', b.dataset.compound === SETUP.compound);
  });
  segActive(document.getElementById('tcPills'), SETUP.tc);
  segActive(document.getElementById('absPills'), SETUP.abs);
  segActive(document.getElementById('awPills'), SETUP.aw);
  document.querySelectorAll('#camPills button').forEach(b => b.classList.toggle('active', b.dataset.cam === APP.camMode));
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('pressureF', SETUP.pressureF);
  set('pressureR', SETUP.pressureR);
  set('springF', SETUP.springF);
  set('springR', SETUP.springR);
  set('damping', SETUP.damping);
  set('gearing', SETUP.gearing);
}

/* ---------------- main loop ---------------- */
let lastFrame = 0;

function update(dt, now) {
  APP.time += dt;
  const p0 = APP.physics;
  AU.setMenuQuiet(APP.state === 'menu' || APP.state === 'paused');

  if (APP.state === 'menu') {
    syncBikeVisual(dt);
    if (APP.menuFill) {
      const yaw = APP.physics.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      APP.menuFill.position.copy(APP.physics.pos).addScaledVector(fwd, 2.2).addScaledVector(right, -2.4).add(new THREE.Vector3(0, 2.4, 0));
      APP.menuFill.intensity = 1.15;
    }
    if (APP.world) APP.world.update(APP.bikeMesh.position);
    if (APP.fx) APP.fx.update(dt);
    AU.update({ rpm: p0.spec.idle, throttle: 0, overrun: 0, speed: 0, slip: 0, limiter: false, dt });
    updateCamera(dt);
    return;
  }

  if (APP.state === 'paused') {
    AU.update({ rpm: p0.rpm, throttle: 0, overrun: 0, speed: 0, slip: 0, limiter: false, dt });
    if (APP.world) APP.world.update(p0.pos);
    updateCamera(dt * 0.2);
    return;
  }

  if (APP.state === 'countdown') {
    countdownTimer -= dt;
    const c = Math.ceil(Math.min(3, Math.max(0, countdownTimer)));
    if (c !== lastCount && c >= 1) {
      lastCount = c;
      HUD.countdown.textContent = c;
      AU.beep(440, 0.09, 0.1);
    }
    if (countdownTimer <= 0) {
      APP.state = 'racing';
      APP.lapStart = performance.now();
      APP.lapDistance = 0;
      APP.lapCount = 1;
      APP.currentTrace = [];
      APP.prevIndex = APP.physics.trackIndex;
      APP.bestProgIdx = 0;
      APP.ghostIdx = 0;
      HUD.countdown.textContent = 'GO!';
      AU.beep(880, 0.18, 0.14);
      setTimeout(() => HUD.countdown.classList.add('hidden'), 450);
    }
    syncBikeVisual(dt);
    if (APP.fx) APP.fx.update(dt);
    if (APP.world) APP.world.update(p0.pos);
    AU.update({ rpm: p0.rpm, throttle: 0, speed: 0, slip: 0, limiter: false, dt });
    updateCamera(dt);
    updateHUD(now);
    drawMinimap();
    return;
  }

  if (APP.state === 'racing') {
    if (APP.menuFill) APP.menuFill.intensity = 0;
    const input = readInput();
    const prevIdx = APP.physics.trackIndex;
    let remaining = dt;
    const step = 1 / 240;
    let guard = 0;
    while (remaining > 0 && guard < 30) {
      const d = Math.min(step, remaining);
      APP.physics.update(d, input, APP.track);
      remaining -= d;
      guard++;
    }

    const p = APP.physics;
    if (!p.crashed && !p.offroad && p.speed > 3) {
      APP.lastSafeIndex = p.trackIndex;
    }

    // Lap progress
    const n = APP.track.count;
    let ds = p.trackIndex - prevIdx;
    if (ds < -n / 2) ds += n;
    if (ds > n / 2) ds -= n;
    APP.lapDistance += ds * APP.track.ds;

    if (prevIdx > n * 0.78 && p.trackIndex < n * 0.22 && APP.lapDistance > APP.track.length * 0.55) {
      completeLap(now);
    }

    if (p.crashed && !APP.crashVisual) beginCrashVisual();
    if (p.crashed) {
      updateCrashRider(dt);
      if (p.crashTimer > 4.5) resetBike();
    }

    if (!p.crashed) {
      while (APP.currentTrace.length && now - APP.lapStart > APP.currentTrace[APP.currentTrace.length - 1][0] * 1000 + 95) {
        recordTrace(now);
      }
      if (!APP.currentTrace.length) recordTrace(now);
    }

    syncBikeVisual(dt);
    updateOpponentVisuals(dt);
    APP.net.broadcastMyState(p, APP.lapCount, APP.lapDistance, dt);

    if (APP.fx) APP.fx.update(dt);
    updateGhost(now);
    APP.world.update(p.pos);

    if (p.shiftEvent > 0) {
      AU.shift();
      p.shiftEvent = 0;
    }
    if (p.backfireEvent > 0) {
      AU.backfirePop(p.backfireEvent);
      if (p.backfireEvent > 0.52 && APP.fx) APP.fx.exhaustPop(APP.bikeMesh, p, p.backfireEvent);
      p.backfireEvent = 0;
    }

    AU.update({
      rpm: p.rpm, throttle: p.throttle, overrun: p.overrun || 0, speed: p.speed,
      slip: Math.max(p.spin * 0.65, p.drift * 1.25, (p.brakeSlide || 0) * 1.25, p.frontLock * 0.85),
      limiter: !!p.limiter || p.rpm >= p.spec.redline - 180, dt
    });

    if (APP.hintTimer > 0) {
      APP.hintTimer -= dt;
      if (APP.hintTimer <= 0) HUD.hint.style.opacity = 0;
    }

    updateCamera(dt);
    updateHUD(now);
    drawMinimap();
  }
}

function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  const dt = lastFrame ? clamp((now - lastFrame) / 1000, 0, 0.05) : 0.016;
  lastFrame = now;
  update(dt, now);
  APP.renderer.render(APP.scene, APP.camera);
}

/* ---------------- boot ---------------- */
function boot() {
  const params = new URLSearchParams(location.search);
  initRenderer();
  if (params.get('noshadow') === '1') APP.renderer.shadowMap.enabled = false;
  if (params.get('cam') && ['iso', 'chase', 'pov'].includes(params.get('cam'))) APP.camMode = params.get('cam');
  initHUD();
  initInput();
  buildMenu();
  bindSetupUI();

  APP.track = new Track(APP.opts.track);
  APP.world = new World(APP.scene, APP.track, APP.opts.theme);
  APP.renderer.toneMappingExposure = APP.world.theme.exposure;
  APP.physics = new BikePhysics(APP.opts.bike);
  APP.bikeMesh = createBikeMesh(APP.opts.bike);
  APP.scene.add(APP.bikeMesh);
  placeBikeAtStart();
  APP.fx = new FX(APP.scene);
  APP.shadowBlob = createShadowBlob();
  APP.menuFill = new THREE.PointLight(0xffd9b0, 0, 26, 2);
  APP.scene.add(APP.menuFill);
  loadBest();
  buildMinimapCache();
  updateTrackLabels();
  applyGhostFromBest();

  if (params.get('theme') && THEMES[params.get('theme')]) APP.opts.theme = params.get('theme');
  if (params.get('track') && TRACK_DEFS[params.get('track')]) APP.opts.track = params.get('track');
  if (params.get('bike') && BIKES[params.get('bike')]) APP.opts.bike = params.get('bike');
  if (params.get('bot') === '1') APP.net.enableBotOpponent('i4');

  const finishBoot = () => {
    document.getElementById('loading').classList.add('hidden');
    if (params.get('autostart') === '1') {
      if (params.get('track') || params.get('bike') || params.get('theme')) {
        rebuildTrack(true);
        rebuildBike();
      }
      startGame(params.get('nocountdown') === '1');
      if (params.get('nocountdown') === '1') {
        APP.state = 'racing';
        HUD.countdown.classList.add('hidden');
      }
      if (params.get('demoslide') === '1') {
        const startIdx = Math.floor(APP.track.count * 0.15);
        APP.physics.reset(APP.track, startIdx, -1.2);
        APP.physics.velX = -Math.sin(APP.physics.yaw) * 27;
        APP.physics.velZ = -Math.cos(APP.physics.yaw) * 27;
        APP.physics.vLong = 27;
        APP.physics.speed = 27;
        APP.physics.gear = 2;
        APP.physics.tempR = [92, 96, 92];
        if (APP.oppPhysics) {
          APP.oppPhysics.reset(APP.track, startIdx + 5, 1.4);
          APP.oppPhysics.velX = -Math.sin(APP.oppPhysics.yaw) * 25;
          APP.oppPhysics.velZ = -Math.cos(APP.oppPhysics.yaw) * 25;
          APP.oppPhysics.vLong = 25;
          APP.oppPhysics.speed = 25;
          APP.oppPhysics.gear = 3;
        }
        for (let i = 0; i < 42; i++) {
          const st = 0.92;
          APP.physics.setup.tc = 0;
          APP.physics.gear = 2;
          const rb = i >= 18 ? 0.92 : 0;
          APP.physics.update(1 / 60, { throttle: rb > 0 ? 0.15 : 1.0, frontBrake: 0, rearBrake: rb, clutch: 0, steer: st, weightX: st * 0.95, weightY: 0 }, APP.track);
          syncBikeVisual(1 / 60);
          updateOpponentVisuals(1 / 60);
          if (APP.fx) APP.fx.update(1 / 60);
        }
        camInit = false;
        updateCamera(1);
        updateHUD(performance.now());
        drawMinimap();
      }
      if (params.get('demowheelie') === '1') {
        APP.physics.pitch = 0.48;
        APP.physics.lean = 0.35;
        syncBikeVisual(1 / 60);
        camInit = false;
        updateCamera(1);
      }
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(finishBoot));

  window.__APEX = {
    get state() { return APP.state; },
    get physics() { return APP.physics; },
    get opts() { return APP.opts; },
    get best() { return APP.best; },
    startGame, resetBike, togglePause, toggleCamera,
    APP
  };

  requestAnimationFrame(renderLoop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
