// Brushless alternator coupled coaxially to the engine along +X, with cage housing
// (copper windings visible through the slots), cast end bell, terminal box and AVR.
import * as THREE from 'three';
import { ALT_POS } from './dims.js';
import { PartBuilder, rigid, anchor, rbox, box, cyl, torus, tube, lathe, addBolt, addScrew, decalQuad } from './utils.js';

export function buildAlternator(ctx, parent) {
  const { mats, tex, D: Q } = ctx;
  const g = rigid('alternator', parent, ALT_POS);
  const shake = new THREE.Group();
  shake.name = 'altShake';
  g.add(shake);
  const b = new PartBuilder(mats);
  const part = 'alternator';
  const S = Q.seg + 8;
  const R = 0.116;

  // adapter ring toward the engine bell housing
  b.add(cyl(R - 0.002, 0.112, 0.022, S, 'x'), 'alu', { p: [0.011, 0, 0], part });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    addBolt(b, 'steel', [0.024, Math.cos(a) * 0.106, Math.sin(a) * 0.106], [0, Math.PI / 2, 0], 0.004, { part });
  }
  // front and rear housing rings
  b.add(cyl(R, R, 0.03, S, 'x'), 'tankPaint', { p: [0.037, 0, 0], part });
  b.add(cyl(R, R, 0.028, S, 'x'), 'tankPaint', { p: [0.186, 0, 0], part });
  b.add(torus(R, 0.003, 6, S, 'x'), 'tankPaint', { p: [0.052, 0, 0], part });
  b.add(torus(R, 0.003, 6, S, 'x'), 'tankPaint', { p: [0.172, 0, 0], part });
  // cage bars with slots
  const bars = 14;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    b.add(rbox(0.122, 0.008, 0.03, 0.0025, 1), 'tankPaint', { p: [0.112, Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004)], r: [a, 0, 0], part });
  }
  // stator + copper windings inside
  b.add(cyl(0.101, 0.101, 0.118, S, 'x'), 'copper', { p: [0.112, 0, 0], uv: 'keep', part });
  b.add(torus(0.086, 0.013, 8, S, 'x'), 'copper', { p: [0.056, 0, 0], uv: 'keep', part });
  b.add(torus(0.086, 0.013, 8, S, 'x'), 'copper', { p: [0.168, 0, 0], uv: 'keep', part });
  b.add(cyl(0.107, 0.107, 0.1, S, 'x', true), 'aluDark', { p: [0.112, 0, 0], part, noEdges: true });
  // cast end bell with vent slots and bearing cap
  const bell = lathe([[0.03, 0.05], [0.07, 0.046], [0.1, 0.034], [0.113, 0.016], [R, 0]].reverse(), S);
  bell.rotateZ(-Math.PI / 2);
  b.add(bell, 'alu', { p: [0.2, 0, 0], part });
  b.add(cyl(0.032, 0.036, 0.014, S, 'x'), 'alu', { p: [0.252, 0, 0], part });
  b.add(cyl(0.02, 0.02, 0.006, S, 'x'), 'steel', { p: [0.261, 0, 0], part });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(rbox(0.02, 0.0022, 0.014, 0.001, 1), 'rubber', { p: [0.236, Math.cos(a) * 0.0945, Math.sin(a) * 0.0945], r: [a, 0, -0.5], part, noEdges: true });
  }
  // feet onto the rubber mounts
  for (const z of [-0.1, 0.1]) {
    b.add(rbox(0.04, 0.012, 0.04, 0.003, 1), 'aluDark', { p: [0.18, -0.104, z], part });
    b.add(rbox(0.014, 0.06, 0.03, 0.003, 1), 'aluDark', { p: [0.18, -0.07, z * 0.85], r: [z > 0 ? -0.5 : 0.5, 0, 0], part });
  }
  // terminal box on top + silver plate on its front
  b.add(rbox(0.1, 0.036, 0.09, 0.005, 2), 'tankPaint', { p: [0.112, R + 0.012, 0], part });
  {
    const rc = tex.rects.altPlate;
    const w = 0.066;
    b.add(decalQuad(w, (w * rc.h) / rc.w, rc.uv), 'decal', { p: [0.112, R + 0.012, 0.0452], uv: 'keep', cast: false, noEdges: true, part });
  }
  b.build(shake);

  // ---- AVR (rises out of the alternator in the exploded view)
  const avr = rigid('avr', shake, [0.112, R + 0.03, 0]);
  const ab = new PartBuilder(mats);
  const ap = 'avr';
  ab.add(rbox(0.086, 0.026, 0.066, 0.004, 2), 'plasticBlack', { p: [0, 0.013, 0], part: ap });
  for (let i = 0; i < 7; i++) ab.add(rbox(0.078, 0.012, 0.0024, 0.0008, 1), 'alu', { p: [0, 0.032, -0.027 + i * 0.009], part: ap });
  ab.add(rbox(0.08, 0.004, 0.062, 0.001, 1), 'alu', { p: [0, 0.0265, 0], part: ap });
  ab.add(cyl(0.0045, 0.0045, 0.006, 12, 'z'), 'plasticWhite', { p: [0.03, 0.012, 0.035], part: ap });
  ab.add(box(0.0012, 0.005, 0.001), 'rubber', { p: [0.03, 0.012, 0.0382], part: ap, noEdges: true });
  addScrew(ab, 'steel', [-0.036, 0.022, 0.033], [0, 0, 0], 0.0022, { part: ap });
  addScrew(ab, 'steel', [0.036, 0.022, 0.033], [0, 0, 0], 0.0022, { part: ap });
  {
    const rc = tex.rects.avr;
    const w = 0.05;
    ab.add(decalQuad(w, (w * rc.h) / rc.w, rc.uv), 'decal', { p: [-0.008, 0.012, 0.0331], uv: 'keep', cast: false, noEdges: true, part: ap });
  }
  // wires from the AVR down into the terminal box
  for (const [m, x] of [['wireRed', -0.03], ['wireBlue', -0.018], ['rubber', -0.006]]) {
    ab.add(tube([[x, 0.004, -0.028], [x - 0.004, -0.004, -0.04], [x - 0.004, -0.018, -0.042], [x, -0.03, -0.035]], 0.0022, 16, 6), m, { part: ap });
  }
  ab.build(avr);

  const anchors = {
    alternator: anchor('alternator', shake, [0.13, 0.06, 0.1]),
    avr: anchor('avr', avr, [0, 0.02, 0.034]),
  };
  return { group: g, shake, avr, anchors };
}
