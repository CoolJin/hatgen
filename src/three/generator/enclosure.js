// Enclosure: base (plinth, floor, frame, casters), front bezel + door, lid, side panels,
// back panel and the acoustic foam liners. Returns rigid groups for the pose logic.
import * as THREE from 'three';
import { BODY, LID, PLINTH, WHEEL, DOOR, PANEL, VENT, SHEET, FOAM, CAP, OUTLET } from './dims.js';
import { PartBuilder, rigid, anchor, plate, rrPath, rrHole, rbox, box, cyl, torus, tube, lathe, addBolt, addScrew, decalQuad, deg, runSteps } from './utils.js';

const HALF_PI = Math.PI / 2;
const R_ZY = [0, -HALF_PI, 0]; // plate in ZY plane (shape x = world z)
const R_XZ = [HALF_PI, 0, 0]; // plate in XZ plane (shape y = world z)

function decal(b, rects, key, w, p, r = [0, 0, 0], mat = 'decal', part) {
  const rc = rects[key];
  const h = (w * rc.h) / rc.w;
  b.add(decalQuad(w, h, rc.uv), mat, { p, r, uv: 'keep', cast: false, receive: true, noEdges: true, part });
}

// Horizontal louvre slats inside a vent opening.
// axis: 'x' for side panels (slats run along z), 'z' for back panel (slats run along x).
function louvres(b, { cx, cy, cz, len, y0, y1, n, axis, sign, part }) {
  const pitch = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const y = y0 + (i + 0.5) * pitch;
    if (axis === 'x') {
      b.add(rbox(0.0028, pitch * 1.12, len, 0.0012, 1), 'powder', { p: [cx, y, cz], r: [0, 0, deg(36) * sign], part });
    } else {
      b.add(rbox(len, pitch * 1.12, 0.0028, 0.0012, 1), 'powder', { p: [cx, y, cz], r: [deg(36) * sign, 0, 0], part });
    }
  }
}

function caster(b, x, z, swivel, segs) {
  const { r, w } = WHEEL;
  const part = 'wheels';
  // mounting plate under the body
  b.add(rbox(0.07, 0.006, 0.062, 0.002, 1), 'darkSteel', { p: [x, 0.102, z], part });
  if (swivel) {
    b.add(cyl(0.021, 0.024, 0.012, segs, 'y'), 'steel', { p: [x, 0.093, z], part });
    b.add(cyl(0.006, 0.006, 0.008, 10, 'y'), 'steel', { p: [x, 0.103, z], part });
  }
  const top = swivel ? 0.087 : 0.099;
  // fork
  b.add(rbox(0.05, 0.005, 0.044, 0.0015, 1), 'darkSteel', { p: [x, top - 0.0025, z], part });
  for (const s of [-1, 1]) {
    const g = new THREE.Shape();
    g.moveTo(-0.022, top);
    g.lineTo(0.022, top);
    g.lineTo(0.012, r - 0.006);
    g.quadraticCurveTo(0, r - 0.016, -0.012, r - 0.006);
    g.lineTo(-0.022, top);
    b.add(plate(g, 0.0035, 0.0008, 3, 1), 'darkSteel', { p: [x, 0, z + s * (w / 2 + 0.004)], part });
  }
  // wheel: tyre + hub + axle
  const tyre = lathe([[0.03, -w / 2], [0.043, -w / 2], [0.0485, -w / 2 + 0.004], [r, 0], [0.0485, w / 2 - 0.004], [0.043, w / 2], [0.03, w / 2]], segs);
  tyre.rotateX(HALF_PI);
  b.add(tyre, 'rubber', { p: [x, r, z], part });
  b.add(cyl(0.031, 0.031, w * 0.92, segs, 'z'), 'plasticGray', { p: [x, r, z], part });
  b.add(cyl(0.012, 0.012, w + 0.006, 12, 'z'), 'steel', { p: [x, r, z], part });
  b.add(cyl(0.0055, 0.0055, w + 0.018, 6, 'z'), 'steel', { p: [x, r, z], part });
  if (swivel) {
    // brake pedal
    b.add(rbox(0.012, 0.004, 0.012, 0.0015, 1), 'darkSteel', { p: [x + Math.sign(x) * 0.028, top - 0.003, z], part });
    b.add(rbox(0.026, 0.006, 0.022, 0.002, 1), 'plasticGray', { p: [x + Math.sign(x) * 0.052, top - 0.006, z], r: [0, 0, deg(-14) * Math.sign(x)], part });
  }
}

export function buildEnclosure(ctx, parent) {
  return runSteps(enclosureSteps(ctx, parent));
}

// The build as a generator that yields between the sub-assemblies (see createGeneratorAsync).
export function* enclosureSteps(ctx, parent) {
  const { mats, tex, D: Q } = ctx;
  const rects = tex.rects;
  const anchors = {};
  const out = {};

  // ------------------------------------------------------------------ base (static)
  {
    const g = rigid('base', parent);
    const b = new PartBuilder(mats);
    const { x, z, notch: n } = PLINTH;
    const s = new THREE.Shape();
    s.moveTo(-x + n, -z);
    s.lineTo(x - n, -z);
    s.lineTo(x - n, -z + n);
    s.lineTo(x, -z + n);
    s.lineTo(x, z - n);
    s.lineTo(x - n, z - n);
    s.lineTo(x - n, z);
    s.lineTo(-x + n, z);
    s.lineTo(-x + n, z - n);
    s.lineTo(-x, z - n);
    s.lineTo(-x, -z + n);
    s.lineTo(-x + n, -z + n);
    s.lineTo(-x + n, -z);
    const ph = PLINTH.y1 - PLINTH.y0;
    b.add(plate(s, ph, 0.002, 4, 2), 'powder', { p: [0, PLINTH.y0 + ph / 2, 0], r: R_XZ });
    // floor pan
    b.add(box(BODY.x * 2 - 0.024, 0.004, BODY.z * 2 - 0.024), 'powderSoft', { p: [0, BODY.y0 + 0.002, 0], cast: false });
    // base frame: rails, cross members
    for (const zz of [-0.1, 0.1]) {
      b.add(rbox(0.86, 0.022, 0.036, 0.003, 1), 'frame', { p: [0, 0.12, zz], part: 'frame' });
      b.add(box(0.86, 0.004, 0.004), 'frame', { p: [0, 0.1325, zz + Math.sign(zz) * 0.017], part: 'frame' });
    }
    for (const xx of [-0.41, -0.02, 0.41]) b.add(rbox(0.03, 0.02, 0.24, 0.003, 1), 'frame', { p: [xx, 0.119, 0], part: 'frame' });
    // rubber anti-vibration mounts: engine feet (4) and alternator feet (2)
    const mounts = [[-0.305, -0.135], [-0.125, -0.135], [-0.305, 0.065], [-0.125, 0.065], [0.2, -0.135], [0.2, 0.065]];
    for (const [mx, mz] of mounts) {
      b.add(cyl(0.017, 0.019, 0.009, Q.segS, 'y'), 'rubber', { p: [mx, 0.1365, mz], part: 'frame' });
      b.add(cyl(0.02, 0.02, 0.002, Q.segS, 'y'), 'steel', { p: [mx, 0.1315, mz], part: 'frame' });
    }
    // battery tray
    b.add(rbox(0.145, 0.006, 0.21, 0.002, 1), 'frame', { p: [0.355, 0.134, 0.075], part: 'frame' });
    // casters: +X side swivel with brake, -X side fixed
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(b, sx * WHEEL.x, sz * WHEEL.z, sx > 0, Q.segS + 4);
    b.build(g);
    anchors.wheels = anchor('wheels', g, [WHEEL.x, WHEEL.r, WHEEL.z + WHEEL.w / 2 + 0.006]);
    anchors.frame = anchor('frame', g, [-0.02, 0.131, 0.118]);
    out.base = g;
  }
  yield;

  // ------------------------------------------------------------------ front bezel
  // Split in two at the post between door and control panel: the left part (with the
  // hinged door) travels with the left side panel, the right part with the right one,
  // while the control panel module itself stays put (see panel.js).
  const fz = BODY.z;
  const fy0 = BODY.y0;
  const fy1 = BODY.y1;
  {
    const g = rigid('frontL', parent);
    const b = new PartBuilder(mats, { ghost: 1 });
    const x0 = -BODY.x;
    const x1 = SPLIT_X;
    const s = rrPath(x1 - x0, fy1 - fy0, 0.003, (x0 + x1) / 2, (fy0 + fy1) / 2);
    s.holes.push(rrHole(DOOR.x1 - DOOR.x0, DOOR.y1 - DOOR.y0, 0.004, (DOOR.x0 + DOOR.x1) / 2, (DOOR.y0 + DOOR.y1) / 2));
    b.add(plate(s, SHEET, 0.0018, Q.curve, 2), 'powder', { p: [0, 0, fz - SHEET / 2] });
    // door opening flange (dark, gives the opening depth when the door is open)
    const fd = 0.026;
    const dw = DOOR.x1 - DOOR.x0;
    const dh = DOOR.y1 - DOOR.y0;
    const dcx = (DOOR.x0 + DOOR.x1) / 2;
    const dcy = (DOOR.y0 + DOOR.y1) / 2;
    const zc = fz - SHEET - fd / 2 + 0.006;
    // (kept 0.15 mm inside the opening so they never share a plane with the hole walls)
    const fo = 0.0009;
    b.add(box(0.0015, dh - 0.004, fd), 'soot', { p: [DOOR.x0 + fo, dcy, zc], cast: false });
    b.add(box(0.0015, dh - 0.004, fd), 'soot', { p: [DOOR.x1 - fo, dcy, zc], cast: false });
    b.add(box(dw - 0.004, 0.0015, fd), 'soot', { p: [dcx, DOOR.y0 + fo, zc], cast: false });
    b.add(box(dw - 0.004, 0.0015, fd), 'soot', { p: [dcx, DOOR.y1 - fo, zc], cast: false });
    for (const bx of [-0.446, -0.284]) {
      addBolt(b, 'steel', [bx, 0.702, fz], [0, 0, 0], 0.0058);
      addBolt(b, 'steel', [bx, 0.126, fz], [0, 0, 0], 0.0058);
    }
    addBolt(b, 'steel', [0.1, 0.126, fz], [0, 0, 0], 0.0058);
    // hinges: static leaf + knuckle + 2 bolts on the bezel side
    for (const hy of DOOR_HINGES) {
      b.add(rbox(0.026, 0.05, 0.0022, 0.001, 1), 'powder', { p: [DOOR.x0 - 0.013, hy, fz + 0.0011] });
      b.add(cyl(0.0048, 0.0048, 0.052, 12, 'y'), 'darkSteel', { p: [DOOR.x0, hy, fz + 0.004] });
      b.add(cyl(0.0032, 0.0032, 0.06, 8, 'y'), 'steel', { p: [DOOR.x0, hy, fz + 0.004] });
      addBolt(b, 'steel', [DOOR.x0 - 0.017, hy + 0.013, fz + 0.0022], [0, 0, 0], 0.0045);
      addBolt(b, 'steel', [DOOR.x0 - 0.017, hy - 0.013, fz + 0.0022], [0, 0, 0], 0.0045);
    }
    b.build(g);
    out.frontL = g;
  }
  {
    const g = rigid('frontR', parent);
    const b = new PartBuilder(mats, { ghost: 1 });
    const x0 = SPLIT_X;
    const x1 = BODY.x;
    const s = rrPath(x1 - x0, fy1 - fy0, 0.003, (x0 + x1) / 2, (fy0 + fy1) / 2);
    s.holes.push(rrHole(PANEL.x1 - PANEL.x0, PANEL.y1 - PANEL.y0, 0.003, (PANEL.x0 + PANEL.x1) / 2, (PANEL.y0 + PANEL.y1) / 2));
    b.add(plate(s, SHEET, 0.0018, Q.curve, 2), 'powder', { p: [0, 0, fz - SHEET / 2] });
    for (const bx of [0.232, 0.446]) {
      addBolt(b, 'steel', [bx, 0.702, fz], [0, 0, 0], 0.0058);
      addBolt(b, 'steel', [bx, 0.126, fz], [0, 0, 0], 0.0058);
    }
    addBolt(b, 'steel', [PANEL.x1 + 0.0275, (PANEL.y0 + PANEL.y1) / 2, fz], [0, 0, 0], 0.0052);
    // (the 50 Hz / caution / low oil / SILENT stickers sit inside the recess: panel legend)
    b.build(g);
    out.frontR = g;
  }

  // ------------------------------------------------------------------ door (hinged, child of front)
  {
    const hingeZ = BODY.z + 0.004;
    const g = rigid('door', out.frontL, [DOOR.x0, 0, hingeZ]);
    const b = new PartBuilder(mats, { ghost: 1 });
    const w = DOOR.x1 - DOOR.x0 - 2 * DOOR.gap;
    const h = DOOR.y1 - DOOR.y0 - 2 * DOOR.gap;
    const cx = DOOR.gap + w / 2;
    const cy = (DOOR.y0 + DOOR.y1) / 2;
    const fz = -0.004; // front face (local)
    b.add(plate(rrPath(w, h, 0.003, cx, cy), SHEET, 0.0018, Q.curve, 2), 'powder', { p: [0, 0, fz - SHEET / 2], part: 'door' });
    // inner stiffening lip
    const lz = fz - SHEET - 0.009;
    b.add(box(0.0016, h - 0.012, 0.018), 'powderSoft', { p: [DOOR.gap + 0.006, cy, lz], part: 'door' });
    b.add(box(0.0016, h - 0.012, 0.018), 'powderSoft', { p: [DOOR.gap + w - 0.006, cy, lz], part: 'door' });
    b.add(box(w - 0.012, 0.0016, 0.018), 'powderSoft', { p: [cx, cy - h / 2 + 0.006, lz], part: 'door' });
    b.add(box(w - 0.012, 0.0016, 0.018), 'powderSoft', { p: [cx, cy + h / 2 - 0.006, lz], part: 'door' });
    // foam on the inside
    b.add(plate(rrPath(w - 0.022, h - 0.022, 0.006, cx, cy), FOAM, 0.004, 4, 2), 'foam', { p: [0, 0, fz - SHEET - FOAM / 2], part: 'insulation', cast: false });
    // hinge leaves + bolts (door side)
    for (const hy of DOOR_HINGES) {
      b.add(rbox(0.026, 0.05, 0.0022, 0.001, 1), 'powder', { p: [0.013, hy, fz + 0.0011], part: 'door' });
      addBolt(b, 'steel', [0.018, hy + 0.013, fz + 0.0022], [0, 0, 0], 0.0048);
      addBolt(b, 'steel', [0.018, hy - 0.013, fz + 0.0022], [0, 0, 0], 0.0048);
    }
    // recessed latch handle (right-middle of the door)
    const lx = 0.372;
    const ly = 0.405;
    b.add(rbox(0.094, 0.046, 0.005, 0.006, 2), 'plasticBlack', { p: [lx, ly, fz + 0.0025], part: 'door' });
    b.add(rbox(0.08, 0.032, 0.002, 0.004, 1), 'rubber', { p: [lx, ly, fz + 0.0052], part: 'door' });
    b.add(rbox(0.066, 0.015, 0.007, 0.004, 2), 'plasticBlack', { p: [lx - 0.004, ly - 0.001, fz + 0.0075], part: 'door' });
    b.add(cyl(0.0058, 0.0058, 0.005, 16, 'z'), 'chrome', { p: [lx + 0.034, ly, fz + 0.0072], part: 'door' });
    b.add(box(0.0012, 0.005, 0.001), 'rubber', { p: [lx + 0.034, ly, fz + 0.0098], part: 'door' });
    // label decal (door label crossfades between the two models)
    const labelW = 0.282;
    const labelH = labelW * (840 / 2048);
    const labelX = -0.017 - DOOR.x0;
    const labelY = 0.55;
    b.add(new THREE.PlaneGeometry(labelW, labelH), 'label', { p: [labelX, labelY, fz + 0.0005], uv: 'keep', cast: false, noEdges: true, part: 'label' });
    decal(b, rects, 'doorPlate', 0.072, [-0.125 - DOOR.x0, 0.205, fz + 0.0004]);
    decal(b, rects, 'doorText', 0.086, [0.093 - DOOR.x0, 0.308, fz + 0.0004]);
    b.build(g);
    anchors.door = anchor('door', g, [0.23, 0.42, fz + 0.001]);
    // inside face of the door (faces the viewer once the door has swung open)
    anchors.doorInner = anchor('doorInner', g, [0.23, 0.42, fz - SHEET - FOAM - 0.002]);
    anchors.label = anchor('label', g, [labelX, labelY, fz + 0.001]);
    out.door = g;
  }
  yield;

  // ------------------------------------------------------------------ lid
  {
    const g = rigid('lid', parent, [0, LID.y0, 0]);
    const b = new PartBuilder(mats, { ghost: 1 });
    const { x, z, notchX: nx, bandZ: bz } = LID;
    const lh = LID.y1 - LID.y0;
    const s = new THREE.Shape();
    s.moveTo(-x, bz);
    s.lineTo(-x, z);
    s.lineTo(x, z);
    s.lineTo(x, bz);
    s.lineTo(nx + 0.006, bz);
    s.quadraticCurveTo(nx, bz, nx, bz - 0.006);
    s.lineTo(nx, -z);
    s.lineTo(-nx, -z);
    s.lineTo(-nx, bz - 0.006);
    s.quadraticCurveTo(-nx, bz, -nx - 0.006, bz);
    s.lineTo(-x, bz);
    const hole = new THREE.Path();
    hole.absarc(CAP.x, CAP.z, 0.033, 0, Math.PI * 2, true);
    s.holes.push(hole);
    b.add(plate(s, lh, 0.0032, Q.curve * 2, 3), 'powder', { p: [0, lh / 2, 0], r: R_XZ, part: 'lid' });
    // channel floors at both ends
    const chH = LID.chanY - LID.y0;
    const chLen = bz + BODY.z;
    for (const sx of [-1, 1]) {
      b.add(rbox(BODY.x - nx, chH, chLen, 0.0015, 1), 'powder', { p: [sx * (nx + (BODY.x - nx) / 2), chH / 2, bz - chLen / 2], part: 'lid' });
      // tubular carry handle
      const hx = sx * 0.4405;
      b.add(tube([[hx, chH, -0.232], [hx, chH + 0.02, -0.232], [hx, chH + 0.033, -0.222], [hx, chH + 0.035, -0.2], [hx, chH + 0.035, 0.08], [hx, chH + 0.033, 0.098], [hx, chH + 0.02, 0.107], [hx, chH, 0.107]], 0.0105, 64, Q.segS), 'darkSteel', { part: 'lid' });
      for (const hz of [-0.232, 0.107]) b.add(cyl(0.017, 0.018, 0.004, Q.segS, 'y'), 'darkSteel', { p: [hx, chH + 0.002, hz], part: 'lid' });
    }
    // top: hatch plate with 4 screws
    const top = lh;
    b.add(rbox(0.16, 0.003, 0.1, 0.0014, 1), 'brushed', { p: [0.14, top + 0.0015, -0.078], part: 'lid' });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addScrew(b, 'steel', [0.14 + sx * 0.068, top + 0.003, -0.078 + sz * 0.038], [-HALF_PI, 0, 0], 0.0042, { part: 'lid' });
    // fuel cap grommet + small gauge window
    b.add(torus(0.033, 0.0038, 8, Q.segS * 2, 'y'), 'rubber', { p: [CAP.x, top + 0.0005, CAP.z], part: 'lid' });
    b.add(rbox(0.03, 0.003, 0.02, 0.0015, 1), 'plasticBlack', { p: [-0.228, top + 0.0012, -0.036], part: 'lid' });
    // bolts on top (facing up)
    for (const [bx, bzz] of [[-0.448, 0.237], [0.448, 0.237], [-0.382, 0.118], [0.382, 0.118], [-0.382, -0.248], [0.382, -0.248], [-0.12, -0.252], [0.12, -0.252]]) {
      addBolt(b, 'steel', [bx, top, bzz], [-HALF_PI, 0, 0], 0.0062, { part: 'lid' });
    }
    // decals on top and on the band front face
    decal(b, rects, 'topPlate', 0.075, [-0.3, top + 0.0003, -0.034], [-HALF_PI, 0, 0], 'decal', 'lid');
    decal(b, rects, 'warnStrip', 0.24, [0.0, top + 0.0003, 0.207], [-HALF_PI, 0, 0], 'decal', 'lid');
    decal(b, rects, 'outdoor', 0.15, [-0.37, 0.046, z + 0.0004], [0, 0, 0], 'decal', 'lid');
    decal(b, rects, 'iso', 0.15, [0.372, 0.044, z + 0.0004], [0, 0, 0], 'decal', 'lid');
    // rubber seal under the lid lip (front band, sides of the band, back)
    {
      const sh = 0.0024;
      const sy = -sh / 2 + 0.0004;
      b.add(box(2 * x - 0.008, sh, 0.012), 'soot', { p: [0, sy, z - 0.0085], cast: false, part: 'lid' });
      b.add(box(2 * nx - 0.004, sh, 0.012), 'soot', { p: [0, sy, -z + 0.0085], cast: false, part: 'lid' });
      for (const sx of [-1, 1]) b.add(box(0.012, sh, z - bz - 0.004), 'soot', { p: [sx * (x - 0.0085), sy, (z + bz) / 2], cast: false, part: 'lid' });
    }
    // acoustic foam under the lid
    const fs = rrPath(0.84, 0.46, 0.01, 0, 0);
    const fh = new THREE.Path();
    fh.absarc(CAP.x, -CAP.z, 0.04, 0, Math.PI * 2, true);
    fs.holes.push(fh);
    b.add(plate(fs, 0.014, 0.003, 4, 2), 'foam', { p: [0, -0.007, 0], r: [-HALF_PI, 0, 0], part: 'insulation', cast: false });
    b.build(g);
    anchors.lid = anchor('lid', g, [0.02, top, 0.06]);
    out.lid = g;
  }
  yield;

  // ------------------------------------------------------------------ side panels (left / right) + vents
  const sideLen = BODY.z * 2 - 2 * SHEET;
  const sideH = BODY.y1 - BODY.y0;
  const sideCy = (BODY.y0 + BODY.y1) / 2;
  const vW = VENT.z1 - VENT.z0;
  const vH = VENT.y1 - VENT.y0;
  const vCy = (VENT.y0 + VENT.y1) / 2;
  for (const sx of [-1, 1]) {
    const g = rigid(sx < 0 ? 'sideL' : 'sideR', parent);
    const b = new PartBuilder(mats, { ghost: 1 });
    const s = rrPath(sideLen, sideH, 0.0035, 0, sideCy);
    s.holes.push(rrHole(vW, vH, 0.008, 0, vCy));
    const px = sx * (BODY.x - SHEET / 2);
    b.add(plate(s, SHEET, 0.0018, Q.curve, 2), 'powder', { p: [px, 0, 0], r: R_ZY });
    // raised vent frame
    const fr = rrPath(vW + 0.022, vH + 0.022, 0.013, 0, vCy);
    fr.holes.push(rrHole(vW, vH, 0.008, 0, vCy));
    b.add(plate(fr, 0.004, 0.0012, Q.curve, 1), 'powder', { p: [sx * (BODY.x + 0.002), 0, 0], r: R_ZY, part: 'vents' });
    louvres(b, { cx: px, cy: 0, cz: 0, len: vW - 0.002, y0: VENT.y0, y1: VENT.y1, n: VENT.slats, axis: 'x', sign: sx, part: 'vents' });
    // dark wire mesh backing behind the louvres
    b.add(box(0.001, vH, vW), 'rubber', { p: [sx * (BODY.x - SHEET - 0.001), vCy, 0], cast: false });
    // bolts
    const bRot = [0, sx * HALF_PI, 0];
    for (const bz of [-0.232, 0, 0.232]) {
      addBolt(b, 'steel', [sx * BODY.x, 0.128, bz], bRot, 0.0058);
      addBolt(b, 'steel', [sx * BODY.x, 0.698, bz], bRot, 0.0058);
    }
    b.build(g);
    if (sx > 0) anchors.vents = anchor('vents', g, [BODY.x + 0.004, vCy, 0]);
    out[sx < 0 ? 'sideL' : 'sideR'] = g;

    // foam liner (moves with the panel when opening, stays behind when exploding)
    const fg = rigid(sx < 0 ? 'foamL' : 'foamR', parent);
    const fb = new PartBuilder(mats, { ghost: 2 });
    const fsh = rrPath(sideLen - 0.03, sideH - 0.03, 0.008, 0, sideCy);
    fsh.holes.push(rrHole(vW + 0.01, vH + 0.01, 0.01, 0, vCy));
    fb.add(plate(fsh, FOAM, 0.004, 4, 2), 'foam', { p: [sx * (BODY.x - SHEET - FOAM / 2 - 0.0005), 0, 0], r: R_ZY, part: 'insulation', cast: false });
    fb.build(fg);
    if (sx < 0) anchors.insulation = anchor('insulation', fg, [-(BODY.x - SHEET - FOAM - 0.001), 0.56, 0.13]);
    out[sx < 0 ? 'foamL' : 'foamR'] = fg;
  }
  yield;

  // ------------------------------------------------------------------ back panel + exhaust outlet + back vent
  {
    const g = rigid('back', parent);
    const b = new PartBuilder(mats, { ghost: 1 });
    const bz = -BODY.z;
    const s = rrPath(BODY.x * 2, sideH, 0.003, 0, sideCy);
    const eh = new THREE.Path();
    eh.absarc(OUTLET.x, OUTLET.y, 0.024, 0, Math.PI * 2, true);
    s.holes.push(eh);
    const bv = { x: -0.25, w: 0.3, y0: 0.3, y1: 0.6 };
    s.holes.push(rrHole(bv.w, bv.y1 - bv.y0, 0.008, bv.x, (bv.y0 + bv.y1) / 2));
    b.add(plate(s, SHEET, 0.0018, Q.curve, 2), 'powder', { p: [0, 0, bz + SHEET / 2] });
    const fr = rrPath(bv.w + 0.022, bv.y1 - bv.y0 + 0.022, 0.013, bv.x, (bv.y0 + bv.y1) / 2);
    fr.holes.push(rrHole(bv.w, bv.y1 - bv.y0, 0.008, bv.x, (bv.y0 + bv.y1) / 2));
    b.add(plate(fr, 0.004, 0.0012, Q.curve, 1), 'powder', { p: [0, 0, bz - 0.002], part: 'vents' });
    louvres(b, { cx: bv.x, cy: 0, cz: bz + SHEET / 2, len: bv.w - 0.002, y0: bv.y0, y1: bv.y1, n: 10, axis: 'z', sign: 1, part: 'vents' });
    b.add(box(bv.w, bv.y1 - bv.y0, 0.001), 'rubber', { p: [bv.x, (bv.y0 + bv.y1) / 2, bz + SHEET + 0.001], cast: false });
    // exhaust outlet stub
    b.add(cyl(0.042, 0.042, 0.004, Q.seg, 'z'), 'heatSteel', { p: [OUTLET.x, OUTLET.y, bz - 0.002], part: 'exhaust' });
    b.add(cyl(0.022, 0.022, 0.05, Q.seg, 'z'), 'heatSteel', { p: [OUTLET.x, OUTLET.y, bz - 0.025], part: 'exhaust' });
    b.add(torus(0.0205, 0.0022, 6, Q.seg, 'z'), 'heatSteel', { p: [OUTLET.x, OUTLET.y, bz - 0.05], part: 'exhaust' });
    b.add(cyl(0.019, 0.019, 0.002, Q.seg, 'z'), 'soot', { p: [OUTLET.x, OUTLET.y, bz - 0.0492], part: 'exhaust' });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      addBolt(b, 'steel', [OUTLET.x + Math.cos(a) * 0.033, OUTLET.y + Math.sin(a) * 0.033, bz - 0.004], [0, Math.PI, 0], 0.0038);
    }
    decal(b, rects, 'exhaustHot', 0.07, [OUTLET.x, OUTLET.y + 0.075, bz - 0.0004], [0, Math.PI, 0]);
    for (const bx of [-0.446, 0, 0.446]) {
      addBolt(b, 'steel', [bx, 0.126, bz], [0, Math.PI, 0], 0.0062);
      addBolt(b, 'steel', [bx, 0.702, bz], [0, Math.PI, 0], 0.0062);
    }
    b.build(g);
    anchors.exhaust = anchor('exhaust', g, [OUTLET.x, OUTLET.y, bz - 0.05]);
    out.back = g;

    const fg = rigid('foamB', parent);
    const fb = new PartBuilder(mats, { ghost: 2 });
    const fsh = rrPath(BODY.x * 2 - 2 * SHEET - 0.03, sideH - 0.03, 0.008, 0, sideCy);
    const feh = new THREE.Path();
    feh.absarc(OUTLET.x, OUTLET.y, 0.04, 0, Math.PI * 2, true);
    fsh.holes.push(feh);
    fsh.holes.push(rrHole(bv.w + 0.01, bv.y1 - bv.y0 + 0.01, 0.01, bv.x, (bv.y0 + bv.y1) / 2));
    fb.add(plate(fsh, FOAM, 0.004, 4, 2), 'foam', { p: [0, 0, bz + SHEET + FOAM / 2 + 0.0005], part: 'insulation', cast: false });
    fb.build(fg);
    out.foamB = fg;
  }

  return { groups: out, anchors };
}

export const DOOR_HINGES = [0.6, 0.235];
export const SPLIT_X = 0.2;
