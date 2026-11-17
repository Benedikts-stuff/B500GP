/* =========================================================
   APEX & PASS — Blueprint-Accurate Motorcycles, Connected Forks, 3D TFT Cockpit & Proportional Rider
   ========================================================= */
'use strict';

function paintMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.20,
    metalness: 0.18,
    flatShading: false,
    ...opts
  });
}

function bmat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.36,
    metalness: 0.28,
    flatShading: false,
    ...opts
  });
}

const BIKE_TEXTURES = {};

function getTireTreadTexture() {
  if (BIKE_TEXTURES.tire) return BIKE_TEXTURES.tire;
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#18191c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#0c0d0f';
  ctx.lineWidth = 4;
  for (let y = 0; y < 256; y += 24) {
    ctx.beginPath();
    ctx.moveTo(35, y);
    ctx.lineTo(105, y + 14);
    ctx.moveTo(221, y);
    ctx.lineTo(151, y + 14);
    ctx.stroke();
  }
  const grd = ctx.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, '#101113');
  grd.addColorStop(0.25, '#24262b');
  grd.addColorStop(0.5, '#17181b');
  grd.addColorStop(0.75, '#24262b');
  grd.addColorStop(1, '#101113');
  ctx.fillStyle = grd;
  ctx.globalAlpha = 0.65;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.encoding = THREE.sRGBEncoding;
  BIKE_TEXTURES.tire = tex;
  return tex;
}

function getCarbonTexture() {
  if (BIKE_TEXTURES.carbon) return BIKE_TEXTURES.carbon;
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1d20';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 === 0 ? '#282b30' : '#141618';
      ctx.fillRect(x, y, 4, 4);
      ctx.fillRect(x + 4, y + 4, 4, 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.encoding = THREE.sRGBEncoding;
  BIKE_TEXTURES.carbon = tex;
  return tex;
}

function createDashTexture() {
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return { c, ctx, tex };
}

function updateDashTexture(dashObj, p) {
  if (!dashObj || !p) return;
  const { ctx, tex } = dashObj;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 120);

  // RPM Bar across top
  const frac = clamp(p.rpm / p.spec.redline, 0, 1);
  const bars = 20;
  for (let i = 0; i < bars; i++) {
    const active = i / bars <= frac;
    ctx.fillStyle = !active ? '#1a202c' : i > 16 ? '#ef4444' : i > 13 ? '#f59e0b' : '#22c55e';
    ctx.fillRect(14 + i * 11.4, 14, 8.5, 20);
  }

  // Gear indicator (Left)
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 54px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(p.gear || 1), 46, 78);

  // Speed KM/H (Right)
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 52px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.round(p.speedKmh || 0)), 208, 78);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 14px Helvetica, Arial, sans-serif';
  ctx.fillText('KM/H', 240, 92);

  tex.needsUpdate = true;
}

function getBrakeDiscTexture() {
  if (BIKE_TEXTURES.disc) return BIKE_TEXTURES.disc;
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#aeb6bf';
  ctx.fillRect(0, 0, 256, 256);
  for (let r = 68; r < 120; r += 8) {
    ctx.strokeStyle = r % 16 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(30,36,44,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#20262e';
  for (let a = 0; a < 18; a++) {
    const ang = (a / 18) * Math.PI * 2;
    for (let r = 74; r <= 112; r += 13) {
      const a2 = ang + (r - 74) * 0.008;
      ctx.beginPath();
      ctx.arc(128 + Math.cos(a2) * r, 128 + Math.sin(a2) * r, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  BIKE_TEXTURES.disc = tex;
  return tex;
}

function getLiveryTexture(specId, customColor) {
  const key = specId + '_' + (customColor || 'default');
  if (BIKE_TEXTURES[key]) return BIKE_TEXTURES[key];
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');

  if (customColor) {
    ctx.fillStyle = '#1e78c8';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#f5f2eb';
    ctx.fillRect(0, 195, 512, 120);
    ctx.fillStyle = '#ff6b2b';
    ctx.fillRect(0, 175, 512, 20);
    ctx.fillRect(0, 315, 512, 20);
  } else if (specId === 'v4') {
    ctx.fillStyle = '#c8241b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#f7f4ec';
    ctx.fillRect(0, 205, 512, 102);
    ctx.fillStyle = '#1f8a3b';
    ctx.fillRect(0, 184, 512, 21);
    ctx.fillStyle = '#15171a';
    ctx.fillRect(0, 307, 512, 18);
  } else if (specId === 'i4') {
    ctx.fillStyle = '#f2eee4';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#1d468a';
    ctx.fillRect(0, 0, 512, 170);
    ctx.fillRect(0, 340, 512, 172);
    ctx.fillStyle = '#d42c22';
    ctx.fillRect(0, 165, 512, 24);
    ctx.fillRect(0, 320, 512, 24);
  } else {
    ctx.fillStyle = '#e8e5dc';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#22559c';
    ctx.fillRect(0, 165, 512, 65);
    ctx.fillStyle = '#c92a22';
    ctx.fillRect(0, 230, 512, 42);
  }

  // Subtle racing pinstripe & brushed clearcoat micro-speckle
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 400; i++) {
    ctx.fillRect((i * 73) % 512, (i * 137) % 512, 2, 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.encoding = THREE.sRGBEncoding;
  BIKE_TEXTURES[key] = tex;
  return tex;
}

function cylBetween(a, b, r1, r2, material, seg = 16) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  const geo = new THREE.CylinderGeometry(r2, r1, len, seg);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return mesh;
}

function orientLimbMesh(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.scale.set(1, len, 1);
}

function makeUnitLimb(r1, r2, material, seg = 16) {
  const geo = new THREE.CylinderGeometry(r2, r1, 1.0, seg);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function solveTwoBoneIK(root, target, l1, l2, bendDir) {
  const diff = new THREE.Vector3().subVectors(target, root);
  const d = clamp(diff.length(), 0.02, (l1 + l2) * 0.992);
  const dir = diff.clone().normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = Math.acos(cosA);
  let perp = bendDir.clone().addScaledVector(dir, -bendDir.dot(dir));
  if (perp.lengthSq() < 1e-5) perp.set(0, 1, 0);
  perp.normalize();
  return root.clone()
    .addScaledVector(dir, Math.cos(ang) * l1)
    .addScaledVector(perp, Math.sin(ang) * l1);
}

function makeRoundedBox(w, h, d, radius = 0.025, material) {
  const r = Math.min(radius, w * 0.4, h * 0.4, d * 0.4);
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  shape.moveTo(-hw, -hh - r);
  shape.lineTo(hw, -hh - r);
  shape.quadraticCurveTo(hw + r, -hh - r, hw + r, -hh);
  shape.lineTo(hw + r, hh);
  shape.quadraticCurveTo(hw + r, hh + r, hw, hh + r);
  shape.lineTo(-hw, hh + r);
  shape.quadraticCurveTo(-hw - r, hh + r, -hw - r, hh);
  shape.lineTo(-hw - r, -hh);
  shape.quadraticCurveTo(-hw - r, -hh - r, -hw, -hh - r);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.005, d - r * 2),
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: r,
    bevelThickness: r
  });
  geo.center();
  return new THREE.Mesh(geo, material);
}

function makeFenderArc(innerR, outerR, width, startAng, endAng, material) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, startAng, endAng, false);
  shape.absarc(0, 0, innerR, endAng, startAng, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    curveSegments: 18,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.006,
    bevelThickness: 0.008
  });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(Math.PI / 2); // XY arc -> YZ wheel plane, centered on X
  return new THREE.Mesh(geo, material);
}

function buildWheel(radius, rimColor, stripeColor, widthScale = 1.0, isRear = false) {
  const g = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({
    map: getTireTreadTexture(),
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.04,
    flatShading: false
  });
  const rimMat = bmat(rimColor, { roughness: 0.20, metalness: 0.88 });
  const darkMat = bmat(0x202226, { roughness: 0.38, metalness: 0.72 });
  const goldBrakeMat = bmat(0xd4a034, { roughness: 0.24, metalness: 0.88 });
  const silverMat = bmat(0xdce2e8, { roughness: 0.18, metalness: 0.92 });

  // Exact outer radius = `radius`: majorR + tube == radius!
  const tube = radius * 0.26;
  const majorR = radius - tube;
  const tire = new THREE.Mesh(new THREE.TorusGeometry(majorR, tube, 22, 40), tireMat);
  tire.rotation.y = Math.PI / 2;
  tire.scale.z = widthScale * 0.78;
  tire.castShadow = true;
  g.add(tire);

  const rimR = majorR - tube * 0.14;
  // Machined outer lip + recessed inner wheel barrel
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, 0.098 * widthScale, 28, 1, true), rimMat);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.94, rimR * 0.94, 0.088 * widthScale, 24), rimMat);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);

  const hubR = radius * 0.185;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 0.185 * widthScale, 18), darkMat);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const axleNut = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.068, radius * 0.068, 0.21 * widthScale, 6), silverMat);
  axleNut.rotation.z = Math.PI / 2;
  g.add(axleNut);

  // Forged 5-pair Y-spokes radiating cleanly from hub to outer rim barrel
  for (let i = 0; i < 5; i++) {
    const baseA = (i / 5) * Math.PI * 2;
    const stemR = hubR * 1.45;
    const pHub = new THREE.Vector3(0, Math.cos(baseA) * hubR * 0.85, Math.sin(baseA) * hubR * 0.85);
    const pMid = new THREE.Vector3(0, Math.cos(baseA) * stemR, Math.sin(baseA) * stemR);
    g.add(cylBetween(pHub, pMid, 0.015, 0.013, rimMat, 8));
    [-0.25, 0.25].forEach(spread => {
      const a2 = baseA + spread;
      const pRim = new THREE.Vector3(0, Math.cos(a2) * rimR * 0.95, Math.sin(a2) * rimR * 0.95);
      g.add(cylBetween(pMid, pRim, 0.011, 0.008, rimMat, 8));
    });
  }

  // Drilled Brake Rotors + Anodized Carriers + Floating Bobbins
  const discTex = getBrakeDiscTexture();
  const rotorSides = isRear ? [1] : [-1, 1];
  rotorSides.forEach(s => {
    const xOff = s * 0.084 * widthScale;
    const rotorScale = isRear ? 0.68 : 0.85;
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(rimR * rotorScale, rimR * rotorScale, 0.013, 28),
      bmat(0xd4dae2, { map: discTex, metalness: 0.92, roughness: 0.22 })
    );
    disc.rotation.z = Math.PI / 2;
    disc.position.x = xOff;
    g.add(disc);

    const carR = rimR * rotorScale * 0.58;
    const carrier = new THREE.Mesh(new THREE.CylinderGeometry(carR, carR, 0.016, 16), goldBrakeMat);
    carrier.rotation.z = Math.PI / 2;
    carrier.position.x = xOff;
    g.add(carrier);

    // Floating rotor bobbins
    for (let b = 0; b < 6; b++) {
      const ba = (b / 6) * Math.PI * 2;
      const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.020, 8), silverMat);
      bob.rotation.z = Math.PI / 2;
      bob.position.set(xOff, Math.cos(ba) * carR * 0.98, Math.sin(ba) * carR * 0.98);
      g.add(bob);
    }
  });

  // Rear CNC sprocket on left side (x = -0.095 * widthScale)
  if (isRear) {
    const sprocket = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, 0.014, 24),
      bmat(0x3a3e46, { metalness: 0.86, roughness: 0.28 })
    );
    sprocket.rotation.z = Math.PI / 2;
    sprocket.position.x = -0.095 * widthScale;
    g.add(sprocket);
  }

  if (stripeColor) {
    [-1, 1].forEach(s => {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.97, 0.009, 8, 36), paintMat(stripeColor, { emissive: stripeColor, emissiveIntensity: 0.18 }));
      stripe.rotation.y = Math.PI / 2;
      stripe.position.x = s * 0.052 * widthScale;
      g.add(stripe);
    });
  }
  return g;
}

function buildRider(spec, barPos, seatPos, sporty, customAccent = null) {
  const rider = new THREE.Group();
  const accentHex = customAccent || (spec.id === 'i4' ? 0x2264c8 : spec.id === 'v4' ? 0xd4281e : 0xd9a426);
  const suitDark = paintMat(0x1b1e24, { roughness: 0.36, metalness: 0.08 });
  const suitWhite = paintMat(0xf2eee6, { roughness: 0.30, metalness: 0.05 });
  const suitAccent = paintMat(accentHex, { roughness: 0.28, metalness: 0.10 });
  const gloveMat = paintMat(0x15171c, { roughness: 0.45 });
  const bootMat = paintMat(0x16181d, { roughness: 0.35 });
  const helmetMat = paintMat(0xf7f3ea, { roughness: 0.14, metalness: 0.18 });
  const visorMat = paintMat(0x0d1218, { roughness: 0.06, metalness: 0.85 });

  // Rider sits cleanly ON the saddle (`seatPos`) BEHIND the fuel tank, leaning OVER the tank!
  const hipsBase = new THREE.Vector3(0, seatPos.y + 0.05, seatPos.z);
  const shoulderY = sporty ? 0.29 : 0.33;
  const shoulderZ = sporty ? -0.32 : -0.24;

  const body = new THREE.Group();
  body.position.copy(hipsBase);
  rider.add(body);

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 14), suitDark);
  pelvis.scale.set(1.02, 0.82, 0.96);
  body.add(pelvis);

  const torso = cylBetween(
    new THREE.Vector3(0, 0.01, 0),
    new THREE.Vector3(0, shoulderY, shoulderZ),
    0.108, 0.138, suitDark, 20
  );
  body.add(torso);

  const chestStripe = cylBetween(
    new THREE.Vector3(0, shoulderY * 0.18, shoulderZ * 0.18 - 0.01),
    new THREE.Vector3(0, shoulderY * 0.88, shoulderZ * 0.88 - 0.01),
    0.082, 0.110, suitAccent, 18
  );
  chestStripe.scale.set(1.04, 1.0, 0.72);
  body.add(chestStripe);

  const shoulderSphere = new THREE.Mesh(new THREE.SphereGeometry(0.140, 18, 14), suitWhite);
  shoulderSphere.position.set(0, shoulderY, shoulderZ);
  shoulderSphere.scale.set(1.14, 0.76, 0.88);
  body.add(shoulderSphere);

  [-1, 1].forEach(s => {
    const puck = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), suitAccent);
    puck.position.set(s * 0.150, shoulderY + 0.01, shoulderZ);
    puck.scale.set(0.7, 0.85, 1.15);
    body.add(puck);
  });

  const hump = makeRoundedBox(0.11, 0.19, 0.08, 0.025, suitWhite);
  hump.position.set(0, shoulderY * 0.58, shoulderZ * 0.44 + 0.085);
  hump.rotation.x = sporty ? 0.68 : 0.45;
  body.add(hump);

  const head = new THREE.Group();
  head.position.set(0, shoulderY + 0.135, shoulderZ - 0.06);
  body.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 20), helmetMat);
  helmet.scale.set(0.92, 0.96, 1.12);
  helmet.castShadow = true;
  head.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.128, 20, 14, Math.PI * 0.58, Math.PI * 0.84, Math.PI * 0.30, Math.PI * 0.34),
    visorMat
  );
  visor.rotation.y = Math.PI;
  head.add(visor);

  const helmetStripe = new THREE.Mesh(new THREE.SphereGeometry(0.127, 18, 14), suitAccent);
  helmetStripe.scale.set(0.32, 1.01, 1.13);
  head.add(helmetStripe);

  const spoiler = makeRoundedBox(0.11, 0.032, 0.07, 0.01, suitAccent);
  spoiler.position.set(0, 0.03, 0.11);
  spoiler.rotation.x = -0.25;
  head.add(spoiler);

  const limbsGroup = new THREE.Group();
  rider.add(limbsGroup);

  const arms = [-1, 1].map(side => {
    const upper = makeUnitLimb(0.046, 0.038, suitAccent, 16);
    const lower = makeUnitLimb(0.038, 0.032, suitWhite, 16);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), suitDark);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.040, 14, 12), gloveMat);
    limbsGroup.add(upper, lower, elbow, hand);
    return { side, upper, lower, elbow, hand };
  });

  const legs = [-1, 1].map(side => {
    const thigh = makeUnitLimb(0.065, 0.052, suitDark, 16);
    const shin = makeUnitLimb(0.052, 0.040, suitWhite, 16);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), suitAccent);
    const slider = makeRoundedBox(0.032, 0.052, 0.070, 0.01, suitWhite);
    knee.add(slider);
    slider.position.set(side * 0.040, -0.01, 0.01);
    const boot = makeRoundedBox(0.080, 0.090, 0.20, 0.02, bootMat);
    limbsGroup.add(thigh, shin, knee, boot);
    return { side, thigh, shin, knee, boot };
  });

  rider.userData = {
    body, head, hipsBase, shoulderY, shoulderZ, sporty,
    barPos: barPos.clone(), seatPos: seatPos.clone(),
    arms, legs, limbsGroup,
    ragdollParts: null
  };
  return rider;
}

function updateRiderIK(bikeMesh, p, dt) {
  const u = bikeMesh.userData;
  const rider = u.rider;
  if (!rider || !rider.userData) return;
  const ru = rider.userData;

  const weightX = p.weightX || 0;
  const weightY = p.weightY || 0;
  const lean = p.lean || 0;

  // Manual Arrow-Key Hang-Off & Pitch Weight Pose
  const effectiveHang = clamp(weightX * 0.92 + Math.sin(lean) * 0.14, -1.15, 1.15);
  const tuck = clamp(p.throttle * 0.22 - p.frontBrake * 0.24 + weightY * 0.45, -0.60, 0.60);

  const hipShiftX = effectiveHang * 0.17;
  const hipShiftY = -Math.abs(effectiveHang) * 0.042;
  const hipShiftZ = clamp(-weightY * 0.065, -0.065, 0.065);

  const targetHips = ru.hipsBase.clone().add(new THREE.Vector3(hipShiftX, hipShiftY, hipShiftZ));
  ru.body.position.lerp(targetHips, 1 - Math.exp(-12 * (dt || 0.016)));
  ru.body.rotation.z = damp(ru.body.rotation.z, -effectiveHang * 0.34, 10, dt || 0.016);
  ru.body.rotation.x = damp(ru.body.rotation.x, -tuck * 0.28, 9, dt || 0.016);

  if (ru.head) {
    ru.head.rotation.y = damp(ru.head.rotation.y, -p.steer * 0.42 + lean * 0.22, 9, dt || 0.016);
    ru.head.rotation.z = damp(ru.head.rotation.z, effectiveHang * 0.18 + lean * 0.35, 9, dt || 0.016);
    ru.head.rotation.x = damp(ru.head.rotation.x, tuck * 0.22 - p.pitch * 0.35, 9, dt || 0.016);
  }

  const bodyPos = ru.body.position;
  const bodyQuat = ru.body.quaternion;
  const barYaw = -p.steerVis;
  const gripSpread = u.spec.id === 'i4' ? 0.27 : 0.33;

  ru.arms.forEach(arm => {
    const side = arm.side;
    const shLocal = new THREE.Vector3(side * 0.138, ru.shoulderY - 0.015, ru.shoulderZ);
    shLocal.applyQuaternion(bodyQuat).add(bodyPos);

    const gripOffset = new THREE.Vector3(side * gripSpread, 0, 0.02);
    gripOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), barYaw);
    const gripPos = ru.barPos.clone().add(gripOffset);

    const bendDir = new THREE.Vector3(side * 0.85, -0.55, 0.35).normalize();
    const elbowPos = solveTwoBoneIK(shLocal, gripPos, 0.24, 0.23, bendDir);

    orientLimbMesh(arm.upper, shLocal, elbowPos);
    orientLimbMesh(arm.lower, elbowPos, gripPos);
    arm.elbow.position.copy(elbowPos);
    arm.hand.position.copy(gripPos);
  });

  ru.legs.forEach(leg => {
    const side = leg.side;
    const hipPos = new THREE.Vector3(side * 0.095, -0.01, 0.0).applyQuaternion(bodyQuat).add(bodyPos);
    const pegPos = new THREE.Vector3(side * 0.185, 0.43, 0.16);

    const insideAmount = clamp(side * (lean * 0.62 + effectiveHang * 0.72), 0, 1.15);
    const bendDir = new THREE.Vector3(
      side * (0.32 + insideAmount * 0.88),
      0.14 - insideAmount * 0.34,
      -0.85
    ).normalize();

    const kneePos = solveTwoBoneIK(hipPos, pegPos, 0.28, 0.28, bendDir);

    orientLimbMesh(leg.thigh, hipPos, kneePos);
    orientLimbMesh(leg.shin, kneePos, pegPos);
    leg.knee.position.copy(kneePos);
    leg.knee.rotation.y = side * insideAmount * 0.55;
    leg.boot.position.copy(pegPos).add(new THREE.Vector3(0, -0.02, -0.03));
    leg.boot.rotation.x = -0.18;
  });

  if (u.dashObj) {
    updateDashTexture(u.dashObj, p);
  }
  if (u.tailLightMat) {
    const braking = (p.frontBrake > 0.08 || p.rearBrake > 0.08);
    u.tailLightMat.emissiveIntensity = braking ? 2.4 : 0.35;
  }
}

function createBikeMesh(specId, customColor = null) {
  const spec = BIKES[specId];
  const root = new THREE.Group();
  const lean = new THREE.Group();
  const pitch = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(lean);
  lean.add(pitch);
  pitch.add(chassis);

  const mainHex = customColor || spec.color;
  const liveryTex = getLiveryTexture(specId, customColor);
  const carbonTex = getCarbonTexture();

  const paint = paintMat(mainHex);
  const liveryMat = paintMat(0xffffff, { map: liveryTex });
  const carbonMat = bmat(0xffffff, { map: carbonTex, roughness: 0.32, metalness: 0.35 });
  const metal = bmat(0xc0c6cc, { roughness: 0.22, metalness: 0.90 });
  const goldFork = bmat(0xdba632, { roughness: 0.22, metalness: 0.86 });
  const bronzeMat = bmat(0x9c7a54, { roughness: 0.32, metalness: 0.78 });
  const dark = bmat(0x181a1e, { roughness: 0.48, metalness: 0.35 });
  const frameMat = bmat(spec.id === 'v4' ? 0xb8281e : 0x32363b, { roughness: 0.35, metalness: 0.65 });

  // True 1:1 Motorcycle Blueprint Coordinates:
  const wb = 1.46;          // 1460mm Wheelbase
  const r = 0.315;          // 315mm Outer Tire Radius (630mm tall 17-inch wheel)
  const rearZ = wb * 0.50;  // +0.73m Rear Axle
  const frontZ = -wb * 0.50;// -0.73m Front Axle

  pitch.position.set(0, 0, rearZ);
  chassis.position.set(0, 0, -rearZ);

  const stripeHex = customColor || (spec.id === 'v4' ? 0xe0281e : spec.id === 'i4' ? 0x2264c8 : 0xd9a426);
  const rimHex = spec.id === 'i4' && !customColor ? 0xc89a2b : 0x1e2024;

  // 1) Rear Wheel (at z = +0.73) + CNC Sprocket & Rear Brake Rotor
  const rearWheel = buildWheel(r, rimHex, stripeHex, spec.id === 'v4' ? 1.28 : spec.id === 'i4' ? 1.22 : 1.14, true);
  rearWheel.position.set(0, r, rearZ);
  chassis.add(rearWheel);

  // 2) Front Steering Assembly (at z = -0.73, y = 0.315)
  const frontSteer = new THREE.Group();
  frontSteer.position.set(0, r, frontZ);
  chassis.add(frontSteer);
  const frontWheel = buildWheel(r, rimHex, stripeHex, 0.92, false);
  frontSteer.add(frontWheel);

  // Connected USD Forks + Billet Axle Lugs + Lower & Upper Triple Clamps + Steering Stem + Clip-On Handlebars!
  const forkTopY = 0.61;
  const forkTopZ = 0.27;
  const axleBlockMat = bmat(0x22262c, { roughness: 0.28, metalness: 0.78 });
  [-1, 1].forEach(side => {
    const top = new THREE.Vector3(side * 0.108, forkTopY, forkTopZ);
    const mid = new THREE.Vector3(side * 0.108, forkTopY * 0.42, forkTopZ * 0.42);
    const bottom = new THREE.Vector3(side * 0.108, 0.0, 0.0);
    // Gold anodized upper USD outer fork tube
    frontSteer.add(cylBetween(top, mid, 0.044, 0.042, goldFork, 16));
    // Chrome inner lower slider tube + CNC radial axle pinch lug
    frontSteer.add(cylBetween(mid, bottom, 0.032, 0.032, metal, 16));
    const lug = makeRoundedBox(0.042, 0.068, 0.072, 0.012, axleBlockMat);
    lug.position.set(side * 0.108, 0.01, 0.008);
    frontSteer.add(lug);
    // Gold fork top preload cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.02, 16), goldFork);
    cap.position.copy(top).add(new THREE.Vector3(0, 0.01, 0));
    cap.rotation.x = -0.40;
    frontSteer.add(cap);
    // Radial Brembo caliper + braided brake line
    const caliper = makeRoundedBox(0.044, 0.095, 0.075, 0.014, bmat(0x25282d, { roughness: 0.25, metalness: 0.80 }));
    caliper.position.set(side * 0.102, 0.048, 0.108);
    frontSteer.add(caliper);
    const calAccent = makeRoundedBox(0.046, 0.024, 0.050, 0.006, paintMat(0xd4221a));
    calAccent.position.set(side * 0.103, 0.048, 0.112);
    frontSteer.add(calAccent);
  });

  // Lower Triple Clamp (Untere Gabelbrücke) & Upper Triple Clamp (Obere Gabelbrücke) + Steering Head Tube!
  const lowerClamp = makeRoundedBox(0.28, 0.045, 0.12, 0.015, metal);
  lowerClamp.position.set(0, forkTopY * 0.68, forkTopZ * 0.68);
  lowerClamp.rotation.x = -0.40;
  frontSteer.add(lowerClamp);

  const upperClamp = makeRoundedBox(0.28, 0.038, 0.13, 0.014, metal);
  upperClamp.position.set(0, forkTopY * 0.96, forkTopZ * 0.96);
  upperClamp.rotation.x = -0.40;
  frontSteer.add(upperClamp);

  // Steering Stem Tube connecting Lower & Upper Triple Clamp
  frontSteer.add(cylBetween(
    new THREE.Vector3(0, forkTopY * 0.66, forkTopZ * 0.66),
    new THREE.Vector3(0, forkTopY * 1.0, forkTopZ * 1.0),
    0.035, 0.035, dark, 14
  ));

  // handlebars / clip-ons directly mounted to Upper Triple Clamp / Fork Tops + Grips + Brake Lever + Reservoir!
  const isSport = spec.id === 'i4';
  const isAdv = spec.id === 'boxer';
  const barLocalY = isSport ? forkTopY * 0.94 : forkTopY * 1.08;
  const barLocalZ = forkTopZ * 0.96;
  const gripSpread = isSport ? 0.27 : 0.33;

  [-1, 1].forEach(side => {
    const innerBar = new THREE.Vector3(side * 0.108, barLocalY, barLocalZ);
    const outerBar = new THREE.Vector3(side * gripSpread, barLocalY - (isSport ? 0.02 : -0.02), barLocalZ + 0.04);
    frontSteer.add(cylBetween(innerBar, outerBar, 0.016, 0.016, metal, 12));
    // Black rubber grip
    const gripStart = new THREE.Vector3().lerpVectors(innerBar, outerBar, 0.45);
    frontSteer.add(cylBetween(gripStart, outerBar, 0.021, 0.021, dark, 12));
    // Switchgear cube
    const sw = makeRoundedBox(0.045, 0.048, 0.045, 0.01, dark);
    sw.position.copy(gripStart);
    frontSteer.add(sw);
    // Brake / Clutch Lever in front of grip
    const leverStart = gripStart.clone().add(new THREE.Vector3(0, 0, -0.028));
    const leverEnd = outerBar.clone().add(new THREE.Vector3(0, -0.01, -0.055));
    frontSteer.add(cylBetween(leverStart, leverEnd, 0.008, 0.006, metal, 8));
  });

  // Front brake fluid reservoir on right handlebar (visible in POV!)
  const reservoir = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.042, 12), bmat(0xeae6dc));
  reservoir.position.set(0.16, barLocalY + 0.045, barLocalZ - 0.02);
  frontSteer.add(reservoir);

  // Curved Wrap Front Fender hugging front tire cleanly
  const fender = makeFenderArc(r + 0.016, r + 0.036, 0.165, Math.PI * 0.18, Math.PI * 0.78, paint);
  fender.position.set(0, 0, 0);
  frontSteer.add(fender);
  [-1, 1].forEach(side => {
    const fenderBrace = makeRoundedBox(0.012, 0.095, 0.055, 0.004, carbonMat);
    fenderBrace.position.set(side * 0.092, r * 0.78, 0.04);
    frontSteer.add(fenderBrace);
  });

  // 3) Frame Headstock & Twin-Spar Frame Beams solidly connected to the Forks at (0, r + forkTopY*0.82, frontZ + forkTopZ*0.82)!
  const headStockPos = new THREE.Vector3(0, r + forkTopY * 0.82, frontZ + forkTopZ * 0.82);
  const headStock = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.22, 16), frameMat);
  headStock.position.copy(headStockPos);
  headStock.rotation.x = -0.40;
  chassis.add(headStock);

  [-1, 1].forEach(side => {
    // Upper main frame beam from Steering Headstock back to Swingarm Pivot
    chassis.add(cylBetween(
      new THREE.Vector3(side * 0.09, headStockPos.y + 0.04, headStockPos.z),
      new THREE.Vector3(side * 0.15, 0.56, 0.16),
      0.042, 0.036, frameMat, 14
    ));
    // Lower frame spar from Steering Headstock to Engine cradle
    chassis.add(cylBetween(
      new THREE.Vector3(side * 0.09, headStockPos.y - 0.06, headStockPos.z),
      new THREE.Vector3(side * 0.14, 0.44, -0.05),
      0.032, 0.030, frameMat, 12
    ));
    // Rear subframe struts supporting the seat & tail
    chassis.add(cylBetween(
      new THREE.Vector3(side * 0.13, 0.58, 0.14),
      new THREE.Vector3(side * 0.11, 0.86, 0.58),
      0.026, 0.022, frameMat, 12
    ));
  });

  // 4) Braced Cast Swingarm, Roller Drive Chain, Carbon Rear Hugger & Monoshock
  const tiMat = bmat(0xb29876, { roughness: 0.28, metalness: 0.84 });
  const chainMat = bmat(0x282c32, { roughness: 0.35, metalness: 0.82 });
  [-1, 1].forEach(side => {
    chassis.add(cylBetween(
      new THREE.Vector3(side * 0.105, 0.44, 0.12),
      new THREE.Vector3(side * 0.115, r, rearZ),
      0.048, 0.032, metal, 14
    ));
    // Lower swingarm truss brace & anodized paddock bobbin
    chassis.add(cylBetween(
      new THREE.Vector3(side * 0.105, 0.38, 0.22),
      new THREE.Vector3(side * 0.115, r - 0.02, rearZ - 0.05),
      0.018, 0.014, metal, 8
    ));
    const bobbin = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.026, 10), goldFork);
    bobbin.rotation.z = Math.PI / 2;
    bobbin.position.set(side * 0.132, r - 0.04, rearZ - 0.08);
    chassis.add(bobbin);
  });
  // Upper & lower roller drive chain linking countershaft sprocket to rear CNC sprocket (x = -0.105)
  chassis.add(cylBetween(new THREE.Vector3(-0.105, 0.48, 0.04), new THREE.Vector3(-0.105, r + 0.095, rearZ), 0.008, 0.008, chainMat, 8));
  chassis.add(cylBetween(new THREE.Vector3(-0.105, 0.38, 0.04), new THREE.Vector3(-0.105, r - 0.095, rearZ), 0.008, 0.008, chainMat, 8));
  // Curved Carbon Rear Tire Hugger covering forward-top quadrant in front of shock
  const rearHugger = makeFenderArc(r + 0.018, r + 0.036, 0.185, Math.PI * 0.08, Math.PI * 0.56, carbonMat);
  rearHugger.position.set(0, r, rearZ);
  chassis.add(rearHugger);
  // Ohlins-style Monoshock spring + piggyback reservoir
  chassis.add(cylBetween(new THREE.Vector3(0, 0.76, 0.16), new THREE.Vector3(0, 0.44, 0.28), 0.048, 0.048, goldFork, 14));

  // 5) Detailed Engine Block, Swept Titanium Header Pipes & Curved Radiator
  const engine = makeRoundedBox(0.32, 0.38, 0.40, 0.04, dark);
  engine.position.set(0, 0.50, -0.04);
  engine.rotation.x = 0.06;
  chassis.add(engine);

  // Swept titanium exhaust header downpipes curving from front head into belly collector
  [-0.085, 0.085].forEach((hx, hi) => {
    const hCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(hx, 0.61, -0.22),
      new THREE.Vector3(hx * 1.15, 0.45, -0.28),
      new THREE.Vector3(hx * 0.85, 0.26, -0.14),
      new THREE.Vector3(hx * 0.4, 0.25, 0.12)
    ]);
    chassis.add(new THREE.Mesh(new THREE.TubeGeometry(hCurve, 18, 0.020, 10, false), tiMat));
  });
  const collectorBox = makeRoundedBox(0.18, 0.08, 0.16, 0.02, dark);
  collectorBox.position.set(0, 0.27, 0.14);
  chassis.add(collectorBox);

  [-1, 1].forEach(side => {
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.042, 20), bronzeMat);
    cover.rotation.z = Math.PI / 2;
    cover.position.set(side * 0.165, 0.45, 0.02);
    chassis.add(cover);
    const sightGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.046, 14), dark);
    sightGlass.rotation.z = Math.PI / 2;
    sightGlass.position.set(side * 0.168, 0.45, 0.02);
    chassis.add(sightGlass);
  });

  const rad = makeRoundedBox(0.34, 0.26, 0.05, 0.015, bmat(0x282c30, { metalness: 0.78, roughness: 0.34 }));
  rad.position.set(0, 0.58, -0.32);
  rad.rotation.x = 0.22;
  chassis.add(rad);
  // Aluminum radiator side end-tanks
  [-1, 1].forEach(side => {
    const radTank = makeRoundedBox(0.026, 0.26, 0.06, 0.008, metal);
    radTank.position.set(side * 0.17, 0.58, -0.32);
    radTank.rotation.x = 0.22;
    chassis.add(radTank);
  });

  // CNC Rearsets + Footpegs + Heel Guards
  [-1, 1].forEach(side => {
    chassis.add(cylBetween(
      new THREE.Vector3(side * 0.14, 0.43, 0.16),
      new THREE.Vector3(side * 0.25, 0.43, 0.16),
      0.015, 0.015, metal, 10
    ));
    const heelGuard = makeRoundedBox(0.014, 0.075, 0.09, 0.006, carbonMat);
    heelGuard.position.set(side * 0.165, 0.47, 0.20);
    heelGuard.rotation.x = -0.35;
    chassis.add(heelGuard);
  });

  // 6) 3D TFT Digital Cockpit Dashboard (Mounted in front of the Triple Clamp for POV view!)
  const dashObj = createDashTexture();
  const dashCase = makeRoundedBox(0.19, 0.10, 0.03, 0.01, dark);
  dashCase.position.set(0, r + forkTopY + 0.04, frontZ + forkTopZ - 0.08);
  dashCase.rotation.x = -0.55;
  chassis.add(dashCase);

  const dashScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.165, 0.082),
    new THREE.MeshBasicMaterial({ map: dashObj.tex })
  );
  dashScreen.position.set(0, 0, 0.017);
  dashCase.add(dashScreen);

  // 7) Sculpted Two-Piece Fuel Tank + Rubber Knee Grips + CNC Monza Cap + Stepped Alcantara Saddle
  const seatPos = new THREE.Vector3(0, 0.80, 0.31);
  const barPos = new THREE.Vector3(0, r + barLocalY, frontZ + barLocalZ);

  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.215, 26, 18), liveryMat);
  tank.scale.set(1.08, 0.72, 1.38);
  tank.position.set(0, 0.84, -0.11);
  chassis.add(tank);

  // Sculpted dark carbon center tank spine + CNC brushed fuel filler cap + Stompgrip knee pads
  const tankSpine = makeRoundedBox(0.085, 0.04, 0.36, 0.014, carbonMat);
  tankSpine.position.set(0, 0.96, -0.14);
  tankSpine.rotation.x = -0.14;
  chassis.add(tankSpine);
  const fillerRing = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.048, 0.016, 18), metal);
  fillerRing.position.set(0, 0.985, -0.18);
  fillerRing.rotation.x = -0.14;
  chassis.add(fillerRing);
  const fillerInner = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.018, 16), dark);
  fillerInner.position.set(0, 0.987, -0.18);
  fillerInner.rotation.x = -0.14;
  chassis.add(fillerInner);
  [-1, 1].forEach(side => {
    const kneePad = makeRoundedBox(0.018, 0.12, 0.22, 0.008, dark);
    kneePad.position.set(side * 0.205, 0.81, -0.02);
    kneePad.rotation.set(-0.08, -side * 0.22, side * 0.12);
    chassis.add(kneePad);
  });

  const seat = makeRoundedBox(0.25, 0.068, 0.32, 0.025, carbonMat);
  seat.position.set(0, 0.79, 0.30);
  chassis.add(seat);
  // Rider seat bolster backing
  const seatBolster = makeRoundedBox(0.22, 0.06, 0.10, 0.02, dark);
  seatBolster.position.set(0, 0.82, 0.43);
  seatBolster.rotation.x = 0.28;
  chassis.add(seatBolster);

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.155, 22, 16), liveryMat);
  tail.scale.set(0.90, 0.54, 1.78);
  tail.position.set(0, 0.90, 0.62);
  tail.rotation.x = 0.22;
  chassis.add(tail);

  // Under-tail fender eliminator + plate hanger + glowing LED brake light bar
  const plateBracket = makeRoundedBox(0.032, 0.14, 0.016, 0.004, dark);
  plateBracket.position.set(0, 0.78, 0.88);
  plateBracket.rotation.x = -0.58;
  chassis.add(plateBracket);
  const plate = makeRoundedBox(0.12, 0.08, 0.008, 0.003, bmat(0xebedf0, { roughness: 0.4 }));
  plate.position.set(0, 0.74, 0.92);
  plate.rotation.x = -0.58;
  chassis.add(plate);

  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xff2218, emissive: 0xff1e10, emissiveIntensity: 0.35, roughness: 0.15
  });
  const tailLight = makeRoundedBox(0.145, 0.034, 0.04, 0.01, tailLightMat);
  tailLight.position.set(0, 0.91, 0.86);
  tailLight.rotation.x = 0.22;
  chassis.add(tailLight);

  // Shared Headlight DRL Optics Material
  const drlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeef6ff, emissiveIntensity: 1.65, roughness: 0.1 });
  const headlightRimMat = bmat(0x101318, { roughness: 0.22, metalness: 0.65 });

  // Sculpted Hexagonal Muffler Builder (aligns exhaustTip cleanly with hollow dark bore)
  const addMuffler = (pStart, pEnd, bodyMat, r1 = 0.044, r2 = 0.062) => {
    const dir = new THREE.Vector3().subVectors(pEnd, pStart);
    const len = dir.length();
    const uDir = dir.clone().normalize();
    const bodyEnd = pEnd.clone().addScaledVector(uDir, -0.055);
    chassis.add(cylBetween(pStart, bodyEnd, r1, r2, bodyMat, 6));
    chassis.add(cylBetween(bodyEnd, pEnd, r2 * 0.98, r2 * 0.66, carbonMat, 6));
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(r2 * 0.46, r2 * 0.46, 0.025, 12), bmat(0x060708, { roughness: 0.9 }));
    bore.position.copy(pEnd).addScaledVector(uDir, -0.006);
    bore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), uDir);
    chassis.add(bore);
  };

  const exhaustTip = new THREE.Object3D();
  exhaustTip.position.set(spec.id === 'boxer' ? 0.22 : 0.21, spec.id === 'v4' ? 0.36 : 0.56, spec.id === 'boxer' ? 0.72 : 0.62);
  chassis.add(exhaustTip);

  if (isSport) {
    // CORSA 600 — Layered Supersport Fairings, Ram-Air Duct, Twin LED Projectors & Vent Gills
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.225, 24, 18), liveryMat);
    nose.scale.set(0.90, 0.74, 1.48);
    nose.position.set(0, 0.78, frontZ + 0.20);
    nose.rotation.x = 0.18;
    chassis.add(nose);

    // Central Ram-Air Intake Scoop & Twin Slanted LED DRL Eyes
    const ramAir = makeRoundedBox(0.11, 0.052, 0.08, 0.012, headlightRimMat);
    ramAir.position.set(0, 0.76, frontZ - 0.12);
    chassis.add(ramAir);
    [-1, 1].forEach(side => {
      const eye = makeRoundedBox(0.085, 0.026, 0.03, 0.008, drlMat);
      eye.position.set(side * 0.105, 0.80, frontZ - 0.07);
      eye.rotation.set(0.12, -side * 0.28, -side * 0.24);
      chassis.add(eye);
    });

    [-1, 1].forEach(side => {
      const sideFairing = makeRoundedBox(0.085, 0.33, 0.52, 0.03, liveryMat);
      sideFairing.position.set(side * 0.17, 0.62, -0.22);
      sideFairing.rotation.set(0.08, -side * 0.08, side * 0.12);
      chassis.add(sideFairing);
      // Carbon side heat-extraction vent trim
      const vent = makeRoundedBox(0.022, 0.13, 0.16, 0.006, carbonMat);
      vent.position.set(side * 0.208, 0.60, -0.14);
      vent.rotation.set(0.12, -side * 0.15, side * 0.10);
      chassis.add(vent);
      // Rearview mirrors with amber indicator strip
      const mirrorArm = cylBetween(
        new THREE.Vector3(side * 0.15, 0.92, frontZ + 0.16),
        new THREE.Vector3(side * 0.29, 0.99, frontZ + 0.20),
        0.010, 0.010, dark, 8
      );
      chassis.add(mirrorArm);
      const mirrorHead = makeRoundedBox(0.09, 0.044, 0.03, 0.01, dark);
      mirrorHead.position.set(side * 0.31, 0.99, frontZ + 0.20);
      chassis.add(mirrorHead);
    });

    const belly = makeRoundedBox(0.28, 0.13, 0.54, 0.03, carbonMat);
    belly.position.set(0, 0.36, -0.06);
    chassis.add(belly);

    // Clear Curved Racing Windscreen framing the POV cockpit view
    const screen = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.3 })
    );
    screen.scale.set(0.84, 0.90, 1.38);
    screen.position.set(0, 0.96, frontZ + 0.20);
    screen.rotation.x = -0.52;
    chassis.add(screen);

    addMuffler(new THREE.Vector3(0.16, 0.36, 0.12), new THREE.Vector3(0.21, 0.56, 0.62), tiMat, 0.038, 0.062);
  } else if (isAdv) {
    // NOMAD 1300 — Finned Boxer Heads, Crash Cage, Skid Plate, Rally Lights & High Exhaust
    [-1, 1].forEach(side => {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.105, 0.21, 18), metal);
      head.rotation.z = Math.PI / 2;
      head.position.set(side * 0.29, 0.50, -0.06);
      chassis.add(head);
      // Individual aluminum cooling fins on each horizontal cylinder barrel
      for (let f = 0; f < 4; f++) {
        const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.008, 18), metal);
        fin.rotation.z = Math.PI / 2;
        fin.position.set(side * (0.21 + f * 0.042), 0.50, -0.06);
        chassis.add(fin);
      }
      const cover = makeRoundedBox(0.048, 0.18, 0.20, 0.018, carbonMat);
      cover.position.set(side * 0.395, 0.50, -0.06);
      chassis.add(cover);
      // Stainless tubular engine crash protection bar
      const crashCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.16, 0.62, -0.24),
        new THREE.Vector3(side * 0.44, 0.58, -0.18),
        new THREE.Vector3(side * 0.45, 0.42, -0.06),
        new THREE.Vector3(side * 0.18, 0.34, 0.08)
      ]);
      chassis.add(new THREE.Mesh(new THREE.TubeGeometry(crashCurve, 14, 0.013, 8, false), metal));
      // Knuckle Handguards attached onto front steer
      const hGuard = makeRoundedBox(0.11, 0.055, 0.042, 0.012, dark);
      hGuard.position.set(side * 0.28, barLocalY - 0.008, barLocalZ - 0.042);
      hGuard.rotation.y = side * 0.28;
      frontSteer.add(hGuard);
      // Auxiliary LED rally pod lights
      const fogPod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.055, 12), headlightRimMat);
      fogPod.rotation.x = Math.PI / 2;
      fogPod.position.set(side * 0.25, 0.72, frontZ + 0.12);
      chassis.add(fogPod);
      const fogLens = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 12), drlMat);
      fogLens.rotation.x = Math.PI / 2;
      fogLens.position.set(side * 0.25, 0.72, frontZ + 0.09);
      chassis.add(fogLens);
    });

    // Aluminum Underbody Bash / Skid Plate
    const skid = makeRoundedBox(0.28, 0.03, 0.44, 0.01, metal);
    skid.position.set(0, 0.26, -0.08);
    skid.rotation.x = -0.15;
    chassis.add(skid);

    const beak = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14), paint);
    beak.scale.set(0.82, 0.30, 1.72);
    beak.position.set(0, r + 0.26, frontZ + 0.04);
    beak.rotation.x = 0.16;
    chassis.add(beak);
    // Asymmetric LED Rally Headlight Mask
    const advHead = makeRoundedBox(0.22, 0.10, 0.08, 0.02, headlightRimMat);
    advHead.position.set(0, 0.88, frontZ + 0.12);
    chassis.add(advHead);
    const advDrl = makeRoundedBox(0.18, 0.045, 0.02, 0.01, drlMat);
    advDrl.position.set(0, 0.88, frontZ + 0.075);
    chassis.add(advDrl);

    const screen = makeRoundedBox(0.32, 0.30, 0.02, 0.01, new THREE.MeshStandardMaterial({ color: 0xb8d0dc, transparent: true, opacity: 0.32, roughness: 0.08 }));
    screen.position.set(0, 1.08, frontZ + 0.18);
    screen.rotation.x = -0.35;
    chassis.add(screen);

    addMuffler(new THREE.Vector3(0.17, 0.40, 0.18), new THREE.Vector3(0.22, 0.56, 0.72), metal, 0.042, 0.070);
  } else {
    // STRADA V4 — Hyper-Naked Aero Shrouds, Bi-Plane Winglets, DRL Streetfighter Mask & Twin MotoGP Shorty Pipes
    [-1, 1].forEach(side => {
      const shroud = makeRoundedBox(0.088, 0.23, 0.35, 0.025, paint);
      shroud.position.set(side * 0.18, 0.74, -0.22);
      shroud.rotation.z = side * 0.14;
      chassis.add(shroud);

      const wingU = makeRoundedBox(0.175, 0.018, 0.125, 0.006, carbonMat);
      wingU.position.set(side * 0.25, 0.79, -0.27);
      wingU.rotation.set(0.12, 0, -side * 0.08);
      chassis.add(wingU);
      const wingL = makeRoundedBox(0.145, 0.016, 0.10, 0.005, carbonMat);
      wingL.position.set(side * 0.23, 0.72, -0.26);
      wingL.rotation.set(0.14, 0, -side * 0.06);
      chassis.add(wingL);
      const endplate = makeRoundedBox(0.012, 0.095, 0.12, 0.004, carbonMat);
      endplate.position.set(side * 0.33, 0.755, -0.27);
      chassis.add(endplate);
    });

    const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 14), paint);
    cowl.scale.set(1.02, 0.82, 0.96);
    cowl.position.set(0, 0.84, frontZ + 0.14);
    chassis.add(cowl);
    // Aggressive V-Shaped Streetfighter LED DRL Headlight
    const mask = makeRoundedBox(0.19, 0.11, 0.06, 0.018, headlightRimMat);
    mask.position.set(0, 0.82, frontZ + 0.03);
    mask.rotation.x = 0.25;
    chassis.add(mask);
    [-1, 1].forEach(side => {
      const vLed = makeRoundedBox(0.075, 0.018, 0.02, 0.005, drlMat);
      vLed.position.set(side * 0.055, 0.825, frontZ);
      vLed.rotation.set(0.22, -side * 0.26, -side * 0.32);
      chassis.add(vLed);
    });

    const spoiler = makeRoundedBox(0.30, 0.12, 0.36, 0.03, carbonMat);
    spoiler.position.set(0, 0.35, -0.08);
    chassis.add(spoiler);

    // Compact underslung twin titanium MotoGP slash-cut cans
    addMuffler(new THREE.Vector3(0.15, 0.28, 0.18), new THREE.Vector3(0.21, 0.36, 0.56), tiMat, 0.036, 0.048);
    addMuffler(new THREE.Vector3(0.13, 0.32, 0.22), new THREE.Vector3(0.19, 0.42, 0.52), tiMat, 0.032, 0.042);
  }

  const rider = buildRider(spec, barPos, seatPos, isSport, customColor);
  chassis.add(rider);

  const glow = new THREE.PointLight(0xffddaa, 0.35, 12, 2);
  glow.position.set(0, 1.0, frontZ - 0.8);
  chassis.add(glow);

  // POV Camera Anchor & Look Target attached directly to `chassis`
  // so the POV camera ALWAYS leans with the bike and NEVER clips into the tank during Wheelies or Stoppies!
  const povCamAnchor = new THREE.Object3D();
  povCamAnchor.position.set(0, 1.16, -0.08);
  chassis.add(povCamAnchor);

  const povLookTarget = new THREE.Object3D();
  povLookTarget.position.set(0, 0.72, -8.5);
  chassis.add(povLookTarget);

  root.userData = {
    spec, pitch, lean, chassis, frontSteer, frontWheel, rearWheel, rider,
    barPos, seatPos, wheelR: r, rearZ, frontZ, glow, dashObj,
    tailLightMat, exhaustTip, povCamAnchor, povLookTarget
  };
  root.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  linearizeGroup(root);
  updateRiderIK(root, { weightX: 0, weightY: 0, lean: 0, throttle: 0, frontBrake: 0, steer: 0, steerVis: 0, pitch: 0, rpm: spec.idle, gear: 1, speedKmh: 0, spec }, 0.1);
  return root;
}

function cloneAsGhost(bikeRoot) {
  const ghost = bikeRoot.clone(true);
  const mat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.24, depthWrite: false });
  ghost.traverse(o => {
    if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; }
    if (o.isPointLight) o.visible = false;
  });
  return ghost;
}
