// Recessed control panel: breaker, 2x Schuko, 7-seg display, key switch, 12 V terminals,
// LEDs, CEE 32 A socket, legends and the wiring box behind it.
import * as THREE from 'three';
import { BODY, PANEL } from './dims.js';
import { PANEL_LAYOUT as LY, PLATE_W, PLATE_H } from './textures.js';
import { PartBuilder, rigid, anchor, rbox, box, cyl, torus, tube, lathe, plate, rrPath, addScrew, decalQuad, deg } from './utils.js';

export function buildPanel(ctx, parent) {
  const { mats, tex, D: Q } = ctx;
  const anchors = {};
  const pcx = (PANEL.x0 + PANEL.x1) / 2;
  const pcy = (PANEL.y0 + PANEL.y1) / 2;
  const g = rigid('panel', parent, [pcx, pcy, BODY.z - PANEL.recess]);
  const b = new PartBuilder(mats);
  const S = Q.segS + 8;

  // recess tray: silver side trims (catch the light like on the real unit), dark top/bottom
  const rd = PANEL.recess;
  b.add(box(0.0016, PLATE_H, rd), 'brushed', { p: [-PLATE_W / 2 + 0.0008, 0, rd / 2], part: 'panel' });
  b.add(box(0.0016, PLATE_H, rd), 'brushed', { p: [PLATE_W / 2 - 0.0008, 0, rd / 2], part: 'panel' });
  b.add(box(PLATE_W, 0.0016, rd), 'powderSoft', { p: [0, PLATE_H / 2 - 0.0008, rd / 2], part: 'panel' });
  b.add(box(PLATE_W, 0.0016, rd), 'powderSoft', { p: [0, -PLATE_H / 2 + 0.0008, rd / 2], part: 'panel' });
  b.add(box(PLATE_W - 0.004, PLATE_H - 0.004, 0.0015), 'powderSoft', { p: [0, 0, -0.0045], part: 'panel' });

  // plate + legends
  b.add(rbox(PLATE_W - 0.002, PLATE_H - 0.002, 0.004, 0.0015, 1), 'panelPlate', { p: [0, 0, -0.002], part: 'panel' });
  b.add(new THREE.PlaneGeometry(PLATE_W - 0.002, PLATE_H - 0.002), 'legend', { p: [0, 0, 0.0004], uv: 'keep', cast: false, noEdges: true });
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addScrew(b, 'steel', [sx * (PLATE_W / 2 - 0.007), sy * (PLATE_H / 2 - 0.007), 0], [0, 0, 0], 0.0032, { part: 'panel' });

  // ---- circuit breaker (2-pole, white body, twin toggles, red band)
  {
    const { u, v, w, h } = LY.breaker;
    const part = 'breaker';
    b.add(rbox(w, h, 0.02, 0.003, 2), 'plasticWhite', { p: [u, v, 0.01], part });
    b.add(rbox(w * 0.84, 0.019, 0.004, 0.0015, 1), 'plasticGray', { p: [u, v + 0.004, 0.0205], part });
    b.add(rbox(w * 0.86, 0.0055, 0.0012, 0.0006, 1), 'ceeRed', { p: [u, v - 0.0135, 0.0203], part });
    for (const s of [-1, 1]) {
      b.add(rbox(0.0125, 0.017, 0.012, 0.0025, 2), 'plasticWhite', { p: [u + s * 0.0095, v + 0.009, 0.026], r: [deg(-24), 0, 0], part });
      b.add(rbox(0.0125, 0.0045, 0.0125, 0.0015, 1), 'ceeRed', { p: [u + s * 0.0095, v + 0.016, 0.0292], r: [deg(-24), 0, 0], part });
      // terminal screw windows
      b.add(box(0.008, 0.004, 0.001), 'rubber', { p: [u + s * 0.0125, v + h / 2 - 0.004, 0.0203], part });
      b.add(box(0.008, 0.004, 0.001), 'rubber', { p: [u + s * 0.0125, v - h / 2 + 0.004, 0.0203], part });
    }
    anchors.breaker = anchor('breaker', g, [u, v, 0.03]);
  }

  // ---- Schuko sockets with hinged flip lids (blue, IP44 style): flat mounting flange,
  // housing, a flat lid with a low 2 mm crown, spring hinge barrel on top, latch nose below
  for (const key of ['schuko1', 'schuko2']) {
    const { u, v, s } = LY[key];
    const part = key;
    b.add(rbox(s, s, 0.005, 0.005, 2), 'blue', { p: [u, v, 0.0025], part });
    for (const [sx, sy] of [[-1, -1], [1, 1]]) addScrew(b, 'steel', [u + sx * (s / 2 - 0.0055), v + sy * (s / 2 - 0.0055), 0.005], [0, 0, 0], 0.0021, { part });
    b.add(rbox(s - 0.012, s - 0.014, 0.011, 0.005, 2), 'blue', { p: [u, v - 0.001, 0.0105], part });
    // lid: flat plate + 1 mm lip, low crown with a flat 30 mm top face
    const lz = 0.0175;
    b.add(rbox(s - 0.008, s - 0.012, 0.0036, 0.006, 2), 'blue', { p: [u, v - 0.0015, lz], part });
    b.add(rbox(s - 0.01, s - 0.014, 0.0012, 0.005, 1), 'blue', { p: [u, v - 0.0015, lz + 0.0022], part });
    const crown = lathe([[0.0195, 0], [0.018, 0.0012], [0.0155, 0.0019], [0.015, 0.002], [0, 0.002]], S);
    crown.rotateX(Math.PI / 2);
    b.add(crown, 'blue', { p: [u, v - 0.002, lz + 0.0028], part });
    // spring hinge barrel across the top + two knuckles on the flange
    const hy = v + s / 2 - 0.0062;
    b.add(cyl(0.0022, 0.0022, s - 0.02, 12, 'x'), 'blue', { p: [u, hy, lz + 0.001], part });
    b.add(cyl(0.0008, 0.0008, s - 0.016, 6, 'x'), 'steel', { p: [u, hy, lz + 0.001], part, noEdges: true });
    for (const sx of [-1, 1]) b.add(rbox(0.006, 0.006, 0.012, 0.0015, 1), 'blue', { p: [u + sx * (s / 2 - 0.013), hy + 0.0005, 0.0105], part });
    // latch nose at the bottom edge of the lid
    b.add(rbox(0.014, 0.0045, 0.006, 0.0015, 1), 'blue', { p: [u, v - s / 2 + 0.0045, lz + 0.0015], part });
    anchors[key] = anchor(key, g, [u, v - 0.002, lz + 0.005]);
  }

  // ---- multifunction display (bezel + emissive 7-seg window)
  {
    const { u, v, w, h, ww, wh } = LY.display;
    b.add(rbox(w, h, 0.008, 0.002, 2), 'plasticBlack', { p: [u, v, 0.004], part: 'display' });
    b.add(new THREE.PlaneGeometry(ww, wh), 'display', { p: [u, v, 0.0082], uv: 'keep', cast: false, noEdges: true, part: 'display' });
    anchors.display = anchor('display', g, [u, v, 0.009]);
  }

  // ---- key switch (chrome ring, black body, key in a rotating sub group)
  let keyGroup;
  {
    const { u, v, r } = LY.keySwitch;
    const part = 'keySwitch';
    b.add(cyl(r, r, 0.004, S, 'z'), 'chrome', { p: [u, v, 0.002], part });
    b.add(torus(r - 0.0012, 0.0014, 6, S, 'z'), 'chrome', { p: [u, v, 0.004], part });
    b.add(cyl(r - 0.004, r - 0.0035, 0.009, S, 'z'), 'plasticBlack', { p: [u, v, 0.0085], part });
    keyGroup = new THREE.Group();
    keyGroup.name = 'key';
    keyGroup.position.set(u, v, 0.013);
    g.add(keyGroup);
    const kb = new PartBuilder(mats);
    kb.add(box(0.0022, 0.009, 0.008), 'steel', { p: [0, 0, 0.004], part });
    kb.add(plate(rrPath(0.019, 0.025, 0.0075, 0, 0.0065), 0.0055, 0.0014, 6, 2), 'plasticBlack', { p: [0, 0, 0.0105], part });
    kb.add(cyl(0.0022, 0.0022, 0.006, 10, 'z'), 'rubber', { p: [0, 0.0135, 0.0105], part });
    kb.build(keyGroup);
    anchors.keySwitch = anchor('keySwitch', g, [u, v, 0.014]);
  }

  // ---- indicator LEDs
  const leds = [];
  for (const [key, mat] of [['ledRun', 'ledGreen'], ['ledOil', 'ledAmber']]) {
    const { u, v } = LY[key];
    b.add(cyl(0.0042, 0.0042, 0.002, 14, 'z'), 'chrome', { p: [u, v, 0.001], part: 'panel' });
    const dome = new THREE.SphereGeometry(0.0028, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2);
    b.add(dome, mat, { p: [u, v, 0.002], part: 'panel', noEdges: true });
    leds.push(mat);
  }

  // ---- 12 V DC binding posts + reset button
  {
    const part = 'dc12';
    for (const [key, mat] of [['dcPlus', 'ceeRed'], ['dcMinus', 'plasticBlack']]) {
      const { u, v } = LY[key];
      b.add(cyl(0.0068, 0.0068, 0.003, 6, 'z'), 'steel', { p: [u, v, 0.0015], part });
      b.add(cyl(0.0058, 0.006, 0.011, S, 'z'), mat, { p: [u, v, 0.0085], part });
      b.add(cyl(0.0052, 0.0058, 0.0016, S, 'z'), mat, { p: [u, v, 0.0148], part });
      b.add(cyl(0.0018, 0.0018, 0.001, 8, 'z'), 'brass', { p: [u, v, 0.0161], part });
    }
    const { u, v } = LY.dcReset;
    b.add(cyl(0.0065, 0.0065, 0.004, 6, 'z'), 'chrome', { p: [u, v, 0.002], part });
    b.add(cyl(0.0042, 0.0042, 0.006, S, 'z'), 'plasticBlack', { p: [u, v, 0.006], part });
    anchors.dc12 = anchor('dc12', g, [(LY.dcPlus.u + LY.dcMinus.u) / 2, LY.dcPlus.v, 0.016]);
  }

  // ---- CEE 32 A 5-pin socket (3P+N+PE, 400 V, 6 h), red, angled down: square flange,
  // short housing, flat hinged lid with a raised rim, hinge barrel on top, latch lever below
  {
    const { u, v, w, h } = LY.cee;
    const part = 'cee';
    b.add(rbox(w, h, 0.006, 0.006, 2), 'ceeRed', { p: [u, v, 0.003], part });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addScrew(b, 'steel', [u + sx * (w / 2 - 0.0065), v + sy * (h / 2 - 0.0065), 0.006], [0, 0, 0], 0.0026, { part });
    const a = deg(22);
    const tilt = [a, 0, 0];
    const axis = new THREE.Vector3(0, -Math.sin(a), Math.cos(a));
    const up = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const c0 = new THREE.Vector3(u, v - 0.004, 0.006);
    const at = (d, o = 0) => c0.clone().addScaledVector(axis, d).addScaledVector(up, o).toArray();
    // housing (short, slightly tapered) + collar
    b.add(cyl(0.0285, 0.031, 0.022, S, 'z'), 'ceeRed', { p: at(0.011), r: tilt, part });
    b.add(torus(0.0295, 0.0018, 6, S, 'z'), 'ceeRed', { p: at(0.021), r: tilt, part });
    // lid: flat disc, raised 1.5 mm rim, recessed print field
    const lz = 0.0255;
    b.add(cyl(0.0325, 0.0325, 0.005, S, 'z'), 'ceeRed', { p: at(lz), r: tilt, part });
    b.add(torus(0.0305, 0.0015, 6, S, 'z'), 'ceeRed', { p: at(lz + 0.0026), r: tilt, part });
    b.add(cyl(0.0245, 0.0245, 0.0006, S, 'z'), 'ceeRed', { p: at(lz + 0.0026), r: tilt, part, noEdges: true });
    {
      const rc = tex.rects.ceeLid;
      b.add(decalQuad(0.04, 0.04, rc.uv), 'decal', { p: at(lz + 0.0031), r: tilt, uv: 'keep', cast: false, noEdges: true, part });
    }
    // hinge: barrel across the top of the lid, bracket down to the flange
    b.add(cyl(0.0038, 0.0038, 0.03, 12, 'x'), 'ceeRed', { p: at(lz - 0.001, 0.0345), part });
    b.add(cyl(0.0012, 0.0012, 0.034, 6, 'x'), 'steel', { p: at(lz - 0.001, 0.0345), part, noEdges: true });
    b.add(rbox(0.022, 0.009, 0.02, 0.002, 1), 'ceeRed', { p: [u, v + 0.036, 0.013], part });
    // latch lever under the lid, 45 degrees
    b.add(rbox(0.016, 0.0055, 0.014, 0.002, 1), 'ceeRed', { p: at(lz - 0.004, -0.034), r: [a + deg(45), 0, 0], part });
    b.add(rbox(0.012, 0.004, 0.008, 0.0015, 1), 'ceeRed', { p: [u, v - 0.04, 0.01], part });
    anchors.cee = anchor('cee', g, at(lz + 0.004));
  }

  // ---- electronics box + wiring behind the plate (visible when the unit is open)
  {
    const hb = PLATE_H / 2;
    b.add(rbox(0.15, 0.26, 0.045, 0.004, 1), 'plasticGray', { p: [0, 0.07, -0.035], part: 'panel' });
    b.add(rbox(0.06, 0.035, 0.02, 0.003, 1), 'plasticBlack', { p: [-0.03, -0.1, -0.03], part: 'panel' });
    b.add(rbox(0.05, 0.03, 0.02, 0.003, 1), 'plasticBlack', { p: [0.035, -0.1, -0.03], part: 'panel' });
    const wires = [
      ['rubber', [[-0.05, -0.06, -0.058], [-0.05, -0.12, -0.075], [-0.02, -hb + 0.02, -0.09], [0.02, -hb - 0.01, -0.1]]],
      ['wireRed', [[-0.03, -0.07, -0.058], [-0.035, -0.13, -0.08], [-0.01, -hb + 0.01, -0.1], [0.03, -hb - 0.02, -0.105]]],
      ['wireBlue', [[0.03, -0.07, -0.058], [0.035, -0.13, -0.078], [0.04, -hb + 0.015, -0.094], [0.05, -hb - 0.015, -0.1]]],
      ['rubber', [[0.05, 0.19, -0.058], [0.06, hb - 0.02, -0.08], [0.05, hb + 0.01, -0.1], [0.03, hb + 0.03, -0.12]]],
    ];
    for (const [m, pts] of wires) b.add(tube(pts, 0.0035, 24, 6), m, { part: 'panel' });
  }

  b.build(g);
  anchors.panel = anchor('panel', g, [0, 0, 0.006]);
  return { group: g, anchors, keyGroup, leds };
}
