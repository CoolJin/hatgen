// Single cylinder, air-cooled 4-stroke diesel (192F class): crankcase, tilted finned
// cylinder and head, red fan shroud, air filter, injection pump, starter, oil filler.
import * as THREE from 'three';
import { ENGINE_POS, MUFFLER } from './dims.js';
import { PartBuilder, rigid, anchor, mat4, rbox, box, cyl, torus, tube, lathe, plate, rrPath, addBolt, decalQuad, deg } from './utils.js';

const TILT = deg(15);
const CYL_X = -0.02;

export function buildEngine(ctx, parent) {
  const { mats, tex, D: Q } = ctx;
  const g = rigid('engine', parent, ENGINE_POS);
  const shake = new THREE.Group();
  shake.name = 'engineShake';
  g.add(shake);
  const b = new PartBuilder(mats);
  const part = 'engine';
  const S = Q.segS + 8;

  const T = new THREE.Matrix4().makeRotationX(TILT).setPosition(CYL_X, 0, 0);
  const cm = (p, r = [0, 0, 0]) => T.clone().multiply(mat4(p, r));
  const cp = (p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(T);

  // ---- crankcase: cast block with a bolted split flange and vertical casting ribs
  b.add(rbox(0.25, 0.2, 0.23, 0.022, 3), 'alu', { p: [0.005, -0.01, 0], part });
  b.add(rbox(0.212, 0.026, 0.2, 0.008, 2), 'aluDark', { p: [0.005, -0.1, 0], part });
  b.add(rbox(0.262, 0.008, 0.242, 0.003, 1), 'alu', { p: [0.005, -0.02, 0], part });
  for (const x of [-0.105, 0.012, 0.105]) for (const z of [-0.1185, 0.1185]) addBolt(b, 'steel', [x, -0.016, z], [-Math.PI / 2, 0, 0], 0.0036, { part });
  for (const x of [-0.075, -0.052, -0.029, 0.052, 0.075]) b.add(rbox(0.007, 0.13, 0.009, 0.003, 1), 'alu', { p: [x, -0.03, 0.117], part });
  for (const x of [-0.06, 0.0, 0.06]) b.add(rbox(0.007, 0.13, 0.009, 0.003, 1), 'alu', { p: [x, -0.03, -0.117], part });
  // dipstick (yellow ring) on the crankcase top
  b.add(cyl(0.0045, 0.0045, 0.03, 10, 'y'), 'aluDark', { p: [0.075, 0.1, 0.075], part });
  b.add(torus(0.0075, 0.0022, 6, 16, 'x'), 'yellow', { p: [0.075, 0.122, 0.075], part });
  for (const x of [-0.09, 0.09]) for (const z of [-0.1, 0.1]) b.add(rbox(0.052, 0.014, 0.038, 0.003, 1), 'aluDark', { p: [x, -0.103, z], part });
  for (const x of [-0.09, 0.09]) for (const z of [-0.1, 0.1]) addBolt(b, 'steel', [x, -0.096, z], [-Math.PI / 2, 0, 0], 0.005, { part });
  // PTO boss and bell housing toward the alternator
  b.add(cyl(0.07, 0.07, 0.02, S, 'x'), 'alu', { p: [0.14, 0, 0], part });
  // bell housing: open cast shell (outer cone, rim, inner cone, floor) with the
  // flexible coupling disc visible inside
  const bellSegs = S + 8;
  const shell = [
    [[0.08, 0], [0.112, 0.08]],
    [[0.112, 0.08], [0.103, 0.08]],
    [[0.103, 0.08], [0.074, 0.012]],
    [[0.074, 0.012], [0, 0.012]],
  ];
  for (const pts of shell) {
    const g = lathe(pts, bellSegs);
    g.rotateZ(-Math.PI / 2);
    b.add(g, 'aluDark', { p: [0.15, 0, 0], part });
  }
  b.add(torus(0.1075, 0.0045, 6, bellSegs, 'x'), 'aluDark', { p: [0.2295, 0, 0], part });
  b.add(cyl(0.062, 0.062, 0.006, bellSegs, 'x'), 'steel', { p: [0.2, 0, 0], part });
  b.add(cyl(0.024, 0.028, 0.02, 20, 'x'), 'darkSteel', { p: [0.208, 0, 0], part });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addBolt(b, 'steel', [0.203, Math.cos(a) * 0.046, Math.sin(a) * 0.046], [0, Math.PI / 2, 0], 0.0042, { part });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(box(0.03, 0.004, 0.012), 'rubber', { p: [0.19, Math.cos(a) * 0.0965, Math.sin(a) * 0.0965], r: [a, 0, 0.36], part, noEdges: true });
  }
  // lightening windows in the cast bell housing (reads as a casting, not a cone)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.add(rbox(0.032, 0.0024, 0.024, 0.001, 1), 'soot', { p: [0.19, Math.cos(a) * 0.0985, Math.sin(a) * 0.0985], r: [a, 0, 0.38], part, noEdges: true });
  }

  // ---- fan / flywheel shroud (brand red) with intake grille
  b.add(rbox(0.075, 0.26, 0.262, 0.03, 3), 'red', { p: [-0.158, 0.005, 0], part });
  b.add(rbox(0.082, 0.19, 0.19, 0.022, 3), 'red', { matrix: cm([-0.068, 0.185, 0.0]), part });
  for (const r of [0.03, 0.056, 0.082, 0.104]) b.add(torus(r, 0.0042, 6, S + 8, 'x'), 'plasticBlack', { p: [-0.1965, 0.005, 0], part });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(box(0.006, 0.09, 0.005), 'plasticBlack', { p: [-0.1965, 0.005 + Math.cos(a) * 0.065, Math.sin(a) * 0.065], r: [a, 0, 0], part });
  }
  b.add(cyl(0.022, 0.024, 0.014, S, 'x'), 'steel', { p: [-0.201, 0.005, 0], part });
  for (const [y, z] of [[0.12, 0.12], [-0.11, 0.12], [0.12, -0.12], [-0.11, -0.12]]) addBolt(b, 'steel', [-0.1955, y, z], [0, -Math.PI / 2, 0], 0.0045, { part });
  // decal on the cowl front
  {
    const rc = tex.rects.shroud;
    const w = 0.074;
    b.add(decalQuad(w, (w * rc.h) / rc.w, rc.uv), 'decal', { matrix: cm([-0.068, 0.19, 0.0952]), uv: 'keep', cast: false, noEdges: true, part });
  }

  // ---- cylinder barrel with cooling fins
  b.add(cyl(0.052, 0.054, 0.12, S, 'y'), 'aluDark', { matrix: cm([0, 0.145, 0]), part });
  const nCyl = Q.finsCyl || 12;
  const pCyl = (11 * 0.0092) / Math.max(1, nCyl - 1);
  for (let i = 0; i < nCyl; i++) {
    const s = 0.132 + Math.min(i * (11 / Math.max(1, nCyl - 1)), 5) * 0.004;
    b.add(plate(rrPath(s, s, 0.024), 0.0026, 0.0006, 3, 1), 'alu', { matrix: cm([0, 0.095 + i * pCyl, 0], [Math.PI / 2, 0, 0]), part });
  }
  // cylinder head, fins, rocker cover
  b.add(rbox(0.12, 0.09, 0.118, 0.01, 2), 'aluDark', { matrix: cm([0, 0.245, 0]), part });
  const nHead = Q.finsHead || 7;
  const pHead = (6 * 0.0092) / Math.max(1, nHead - 1);
  for (let i = 0; i < nHead; i++) {
    b.add(plate(rrPath(0.168, 0.142, 0.02), 0.0026, 0.0006, 3, 1), 'alu', { matrix: cm([0, 0.208 + i * pHead, 0], [Math.PI / 2, 0, 0]), part });
  }
  b.add(rbox(0.134, 0.036, 0.122, 0.013, 3), 'tankPaint', { matrix: cm([0, 0.3, 0]), part });
  b.add(rbox(0.1, 0.006, 0.09, 0.004, 1), 'tankPaint', { matrix: cm([0, 0.32, 0]), part });
  for (const [x, z] of [[-0.05, -0.043], [0.05, -0.043], [-0.05, 0.043], [0.05, 0.043]]) addBolt(b, 'steel', [0, 0, 0], [0, 0, 0], 0.0045, { matrix: cm([x, 0.318, z], [-Math.PI / 2, 0, 0]), part });
  b.add(cyl(0.009, 0.01, 0.012, 12, 'y'), 'plasticBlack', { matrix: cm([0.03, 0.327, 0]), part });
  // injector + glow plug on the head front
  b.add(cyl(0.0075, 0.0075, 0.03, 12, 'z'), 'steel', { matrix: cm([0.03, 0.258, 0.072]), part });
  b.add(cyl(0.009, 0.009, 0.008, 6, 'z'), 'steel', { matrix: cm([0.03, 0.258, 0.064]), part });
  b.add(cyl(0.0055, 0.0055, 0.01, 6, 'z'), 'steel', { matrix: cm([-0.028, 0.232, 0.066]), part });
  b.add(cyl(0.0022, 0.0022, 0.012, 8, 'z'), 'brass', { matrix: cm([-0.028, 0.232, 0.076]), part });
  // exhaust flange (back) and intake port (right)
  b.add(rbox(0.05, 0.036, 0.01, 0.003, 1), 'aluDark', { matrix: cm([0, 0.245, -0.063]), part });
  b.add(rbox(0.01, 0.036, 0.046, 0.003, 1), 'aluDark', { matrix: cm([0.064, 0.245, 0]), part });

  // ---- air filter canister
  const af = [0.118, 0.19, 0.035];
  b.add(cyl(0.056, 0.056, 0.072, S + 8, 'y'), 'plasticBlack', { p: af, part });
  b.add(torus(0.056, 0.0035, 6, S + 8, 'y'), 'plasticBlack', { p: [af[0], af[1] + 0.02, af[2]], part });
  const lid = lathe([[0.058, 0], [0.058, 0.004], [0.05, 0.012], [0.02, 0.016], [0, 0.017]], S + 8);
  b.add(lid, 'plasticBlack', { p: [af[0], af[1] + 0.036, af[2]], part });
  b.add(cyl(0.006, 0.006, 0.014, 8, 'y'), 'steel', { p: [af[0], af[1] + 0.058, af[2]], part });
  b.add(rbox(0.03, 0.009, 0.004, 0.002, 1), 'steel', { p: [af[0], af[1] + 0.062, af[2]], part });
  b.add(cyl(0.05, 0.05, 0.01, S + 8, 'y'), 'aluDark', { p: [af[0], af[1] - 0.04, af[2]], part });
  // intake hose from filter to head
  const ip = cp([0.07, 0.245, 0]);
  b.add(tube([[af[0] - 0.035, af[1] - 0.02, af[2] - 0.02], [af[0] - 0.05, af[1] + 0.005, af[2] - 0.03], [ip.x + 0.015, ip.y, ip.z - 0.01], [ip.x + 0.002, ip.y, ip.z]], 0.014, 24, 10), 'rubber', { part });

  // ---- fuel injection pump + fuel line to the injector, governor linkage, fuel filter
  b.add(rbox(0.036, 0.052, 0.03, 0.004, 1), 'aluDark', { p: [0.045, 0.03, 0.128], part });
  b.add(tube([[0.063, 0.045, 0.13], [0.09, 0.07, 0.135], [0.1, 0.1, 0.12], [0.098, 0.13, 0.1]], 0.0015, 16, 5), 'steel', { part });
  b.add(cyl(0.0035, 0.0035, 0.01, 8, 'z'), 'steel', { p: [0.098, 0.13, 0.095], part });
  b.add(cyl(0.013, 0.013, 0.03, 16, 'y'), 'plasticBlack', { p: [0.1, 0.02, 0.14], part });
  b.add(cyl(0.011, 0.012, 0.012, 16, 'y'), 'aluDark', { p: [0.1, -0.001, 0.14], part });
  b.add(cyl(0.004, 0.004, 0.012, 8, 'y'), 'brass', { p: [0.1, 0.04, 0.14], part });
  b.add(cyl(0.006, 0.006, 0.012, 6, 'y'), 'steel', { p: [0.045, 0.061, 0.128], part });
  const inj = cp([0.03, 0.258, 0.09]);
  b.add(tube([[0.045, 0.066, 0.128], [0.05, 0.12, 0.14], [inj.x + 0.01, inj.y + 0.01, inj.z + 0.02], [inj.x, inj.y, inj.z]], 0.0022, 32, 6), 'steel', { part });
  // engine sticker
  {
    const rc = tex.rects.engineWarn;
    const w = 0.05;
    b.add(decalQuad(w, (w * rc.h) / rc.w, rc.uv), 'decal', { p: [-0.005, 0.068, 0.1155], uv: 'keep', cast: false, noEdges: true, part });
  }

  // ---- oil filler (yellow cap) + drain plug
  b.add(cyl(0.011, 0.012, 0.016, 12, 'z'), 'alu', { p: [0.085, -0.07, 0.122], part });
  b.add(cyl(0.015, 0.015, 0.014, 16, 'z'), 'yellow', { p: [0.085, -0.07, 0.135], part });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(box(0.003, 0.004, 0.012), 'yellow', { p: [0.085 + Math.cos(a) * 0.0152, -0.07 + Math.sin(a) * 0.0152, 0.135], r: [0, 0, a], part, noEdges: true });
  }
  b.add(cyl(0.008, 0.008, 0.006, 6, 'z'), 'steel', { p: [0.04, -0.098, 0.118], part });

  // ---- electric starter + solenoid, glow plug wire
  b.add(cyl(0.034, 0.034, 0.1, S, 'x'), 'tankPaint', { p: [-0.06, -0.046, 0.15], part });
  b.add(cyl(0.028, 0.034, 0.012, S, 'x'), 'alu', { p: [-0.004, -0.046, 0.15], part });
  b.add(cyl(0.016, 0.016, 0.066, S, 'x'), 'tankPaint', { p: [-0.056, 0.004, 0.158], part });
  b.add(cyl(0.004, 0.004, 0.012, 8, 'z'), 'brass', { p: [-0.024, 0.004, 0.176], part });
  const gp = cp([-0.028, 0.232, 0.082]);
  b.add(tube([[gp.x, gp.y, gp.z], [gp.x - 0.01, gp.y - 0.03, gp.z + 0.03], [-0.03, 0.03, 0.17], [-0.024, 0.006, 0.182]], 0.0025, 32, 6), 'wireRed', { part });

  // ---- exhaust manifold pipe from head to muffler inlet
  const ex = cp([0, 0.245, -0.068]);
  const mi = [MUFFLER.x0 - 0.028 - ENGINE_POS[0], MUFFLER.y - ENGINE_POS[1], MUFFLER.z - ENGINE_POS[2]];
  b.add(tube([[ex.x, ex.y, ex.z + 0.004], [ex.x, ex.y - 0.004, ex.z - 0.03], [ex.x + 0.03, ex.y - 0.02, ex.z - 0.1], [mi[0] - 0.035, mi[1], mi[2] + 0.01], [mi[0], mi[1], mi[2]]], 0.0145, 48, 12), 'heatSteel', { part });
  b.add(cyl(0.021, 0.021, 0.008, S, 'z'), 'heatSteel', { matrix: cm([0, 0.245, -0.071], [0, 0, 0]), part });

  b.build(shake);
  const a = cp([0.0, 0.228, 0.09]);
  const anc = anchor('engine', shake, [a.x, a.y, a.z]);
  return { group: g, shake, anchors: { engine: anc } };
}
