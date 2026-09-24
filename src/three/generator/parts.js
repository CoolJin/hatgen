// Fuel tank (+ blue filler cap and gauge), starter battery, muffler, exhaust vapor.
import * as THREE from 'three';
import { TANK, CAP, BATTERY, MUFFLER, OUTLET, LID, BODY } from './dims.js';
import { PartBuilder, rigid, anchor, rbox, cyl, torus, tube, lathe, addBolt, decalQuad } from './utils.js';

export function buildTank(ctx, parent) {
  const { mats, tex, D: Q } = ctx;
  const cx = (TANK.x0 + TANK.x1) / 2;
  const cy = (TANK.y0 + TANK.y1) / 2;
  const cz = (TANK.z0 + TANK.z1) / 2;
  const w = TANK.x1 - TANK.x0;
  const h = TANK.y1 - TANK.y0;
  const d = TANK.z1 - TANK.z0;
  const g = rigid('tank', parent, [cx, cy, cz]);
  const b = new PartBuilder(mats);
  const part = 'tank';
  const S = Q.segS + 8;
  b.add(rbox(w, h, d, 0.022, 3), 'tankPaint', { part });
  // rolled seam around the middle
  b.add(rbox(w + 0.008, 0.005, d + 0.008, 0.0025, 1), 'tankPaint', { p: [0, -0.004, 0], part });
  // straps
  for (const x of [-w * 0.3, w * 0.3]) {
    b.add(rbox(0.022, 0.0028, d + 0.006, 0.001, 1), 'darkSteel', { p: [x, h / 2 + 0.0014, 0], part });
    b.add(rbox(0.022, h * 0.8, 0.0028, 0.001, 1), 'darkSteel', { p: [x, 0, d / 2 + 0.0014], part });
    b.add(rbox(0.022, h * 0.8, 0.0028, 0.001, 1), 'darkSteel', { p: [x, 0, -d / 2 - 0.0014], part });
    addBolt(b, 'steel', [x, -h * 0.25, d / 2 + 0.003], [0, 0, 0], 0.004, { part });
  }
  // filler neck up through the lid
  const nx = CAP.x - cx;
  const nz = CAP.z - cz;
  const neckTop = LID.y1 - cy;
  b.add(cyl(0.03, 0.034, 0.012, S, 'y'), 'darkSteel', { p: [nx, h / 2 + 0.005, nz], part });
  b.add(cyl(0.025, 0.025, neckTop - h / 2, S, 'y'), 'steel', { p: [nx, (neckTop + h / 2) / 2, nz], part });
  // mechanical level gauge on top
  const gx = 0.14;
  const gz = 0.07;
  b.add(cyl(0.027, 0.028, 0.008, S, 'y'), 'chrome', { p: [gx, h / 2 + 0.004, gz], part });
  {
    const rc = tex.rects.gauge;
    const q = decalQuad(0.044, 0.044, rc.uv);
    b.add(q, 'decal', { p: [gx, h / 2 + 0.0082, gz], r: [-Math.PI / 2, 0, 0], uv: 'keep', cast: false, noEdges: true, part });
  }
  // fuel outlet + hose stub at the bottom front
  b.add(cyl(0.008, 0.008, 0.02, 12, 'y'), 'brass', { p: [-0.15, -h / 2 - 0.008, 0.1], part });
  b.add(tube([[-0.15, -h / 2 - 0.016, 0.1], [-0.15, -h / 2 - 0.05, 0.11], [-0.12, -h / 2 - 0.08, 0.13]], 0.0055, 16, 8), 'rubber', { part });
  b.build(g);

  // blue filler cap (own group so it can be highlighted and anchored)
  const capG = new THREE.Group();
  capG.name = 'fuelCap';
  capG.position.set(nx, neckTop, nz);
  g.add(capG);
  const cb = new PartBuilder(mats);
  const cpart = 'fuelCap';
  const prof = lathe([[0.039, 0], [0.04, 0.004], [0.04, 0.014], [0.038, 0.019], [0.03, 0.023], [0.012, 0.025], [0, 0.0252]], Q.seg + 16);
  cb.add(prof, 'capBlue', { part: cpart });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    cb.add(rbox(0.004, 0.012, 0.004, 0.0015, 1), 'capBlue', { p: [Math.cos(a) * 0.0398, 0.009, Math.sin(a) * 0.0398], r: [0, -a, 0], part: cpart, noEdges: true });
  }
  cb.add(cyl(0.012, 0.013, 0.004, 16, 'y'), 'capBlue', { p: [0, 0.027, 0], part: cpart });
  cb.build(capG);

  const anchors = {
    // top face, rear right end: seen from the front right the callout then points away from
    // the filler neck (left of it) instead of covering it
    tank: anchor('tank', g, [w / 2 - 0.05, h / 2 + 0.002, -d / 2 + 0.08]),
    fuelCap: anchor('fuelCap', capG, [0, 0.028, 0]),
  };
  return { group: g, cap: capG, anchors };
}

export function buildBattery(ctx, parent) {
  const { mats, tex } = ctx;
  const { w, h, d } = BATTERY;
  const g = rigid('battery', parent, [BATTERY.x, 0.137 + h / 2, BATTERY.z]);
  const b = new PartBuilder(mats);
  const part = 'battery';
  b.add(rbox(w, h - 0.016, d, 0.006, 2), 'plasticBlack', { p: [0, -0.008, 0], part });
  b.add(rbox(w + 0.003, 0.018, d + 0.003, 0.004, 2), 'plasticGray', { p: [0, h / 2 - 0.009, 0], part });
  // terminals: + with red boot, - bare lead
  b.add(cyl(0.0085, 0.0095, 0.014, 16, 'y'), 'aluDark', { p: [0.03, h / 2 + 0.007, d / 2 - 0.028], part });
  b.add(rbox(0.03, 0.022, 0.034, 0.008, 2), 'ceeRed', { p: [-0.03, h / 2 + 0.01, d / 2 - 0.03], part });
  b.add(cyl(0.004, 0.004, 0.01, 8, 'x'), 'brass', { p: [0.043, h / 2 + 0.01, d / 2 - 0.028], part });
  // vent caps row
  for (let i = 0; i < 6; i++) b.add(cyl(0.006, 0.006, 0.003, 12, 'y'), 'plasticBlack', { p: [-0.045 + i * 0.018, h / 2 + 0.0015, -0.04], part, noEdges: true });
  // hold-down strap
  b.add(rbox(w + 0.012, 0.004, 0.022, 0.0015, 1), 'darkSteel', { p: [0, h / 2 + 0.002, -0.02], part });
  for (const s of [-1, 1]) b.add(rbox(0.004, h * 0.9, 0.022, 0.0015, 1), 'darkSteel', { p: [s * (w / 2 + 0.006), -h * 0.05, -0.02], part });
  // label on the front (narrow side facing +Z)
  const rc = tex.rects.battery;
  const lw = w - 0.012;
  b.add(decalQuad(lw, (lw * rc.h) / rc.w, rc.uv), 'decal', { p: [0, -0.012, d / 2 + 0.0004], uv: 'keep', cast: false, noEdges: true, part });
  b.build(g);
  return { group: g, anchors: { battery: anchor('battery', g, [0, h / 2 + 0.002, d / 2 - 0.01]) } };
}

export function buildMuffler(ctx, parent) {
  const { mats, D: Q } = ctx;
  const cx = (MUFFLER.x0 + MUFFLER.x1) / 2;
  const len = MUFFLER.x1 - MUFFLER.x0;
  const R = MUFFLER.r;
  const g = rigid('muffler', parent, [cx, MUFFLER.y, MUFFLER.z]);
  const b = new PartBuilder(mats);
  const part = 'muffler';
  const S = Q.seg + 8;
  b.add(cyl(R, R, len - 0.02, S, 'x'), 'muffler', { uv: 'keep', part });
  for (const s of [-1, 1]) {
    const cap = lathe([[R, 0], [R - 0.004, 0.006], [R - 0.02, 0.011], [0.02, 0.014], [0, 0.0145]], S);
    cap.rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2);
    b.add(cap, 'heatSteel', { p: [s * (len / 2 - 0.01), 0, 0], part });
    b.add(torus(R, 0.0035, 6, S, 'x'), 'heatSteel', { p: [s * (len / 2 - 0.012), 0, 0], part });
  }
  // inlet stub (left) and outlet pipe to the back panel outlet (right)
  b.add(cyl(0.0155, 0.0155, 0.03, 16, 'x'), 'heatSteel', { p: [-len / 2 - 0.008, 0, 0], part });
  const o = [OUTLET.x - cx, OUTLET.y - MUFFLER.y, -BODY.z + 0.018 - MUFFLER.z];
  b.add(tube([[len / 2 + 0.005, 0, 0], [len / 2 + 0.05, 0, 0], [o[0] - 0.005, o[1], -0.04], [o[0], o[1], o[2] + 0.02], [o[0], o[1], o[2]]], 0.0155, 32, 12), 'heatSteel', { part });
  // mounting bands + brackets
  for (const x of [-len * 0.28, len * 0.28]) {
    b.add(torus(R + 0.003, 0.0038, 6, S, 'x'), 'darkSteel', { p: [x, 0, 0], part });
    b.add(rbox(0.018, 0.05, 0.004, 0.0015, 1), 'darkSteel', { p: [x, -R - 0.02, -0.03], r: [0.35, 0, 0], part });
    addBolt(b, 'steel', [x, R + 0.004, 0], [-Math.PI / 2, 0, 0], 0.004, { part });
  }
  // perforated heat shield strip on the front (visible from the front-right camera)
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + i * 0.25;
    b.add(rbox(len * 0.62, 0.0022, 0.022, 0.001, 1), 'brushed', { p: [0, Math.sin(a) * (R + 0.012), Math.cos(a) * (R + 0.012)], r: [-a + Math.PI / 2, 0, 0], part });
  }
  b.build(g);
  return { group: g, anchors: { muffler: anchor('muffler', g, [0.02, 0.03, R + 0.02]) } };
}

// Faint exhaust vapor at the outlet (cheap sprites, only visible while running). The plume
// rises well above the lid and drifts a little forward, so the running state also reads
// from the front camera.
export function buildVapor(ctx, parent) {
  const { tex } = ctx;
  const g = new THREE.Group();
  g.name = 'vapor';
  g.position.set(OUTLET.x, OUTLET.y, -BODY.z - 0.055);
  parent.add(g);
  const puffs = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const m = new THREE.SpriteMaterial({ map: tex.puff, color: 0xd9d2cf, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.userData.phase = i / N;
    s.userData.seed = Math.random();
    s.renderOrder = 2;
    s.userData.noContactShadow = true;
    g.add(s);
    puffs.push(s);
  }
  g.visible = false;
  const update = (t, amount) => {
    g.visible = amount > 0.01;
    if (!g.visible) return;
    for (const s of puffs) {
      const k = (t * 0.42 + s.userData.phase) % 1;
      const sd = s.userData.seed;
      const rise = 1 - (1 - k) * (1 - k); // fast out of the pipe, then slows down
      s.position.set(Math.sin(k * 5 + sd * 6) * 0.035 * k - 0.04 * k, rise * 0.62, -0.02 + 0.1 * k * k);
      const sc = 0.05 + k * 0.36;
      s.scale.set(sc, sc, sc);
      s.material.opacity = amount * 0.24 * Math.sin(Math.PI * Math.min(1, k * 1.1)) * (1 - k * 0.35);
    }
  };
  const dispose = () => puffs.forEach((s) => s.material.dispose());
  return { group: g, update, dispose };
}
