// Geometry helpers and the PartBuilder, which merges many small primitives into
// one mesh per (material, highlight-part) bucket to keep draw calls low.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PART_INDEX, GHOST_STRIDE } from './materials.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export const deg = (d) => (d * Math.PI) / 180;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const seg = (v, a, b) => clamp01((v - a) / (b - a));
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuint = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);
export const smooth = (t) => t * t * (3 - 2 * t);

// Build a matrix from position / euler rotation (radians) / scale.
export function mat4(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], order = 'XYZ') {
  _e.set(r[0], r[1], r[2], order);
  _q.setFromEuler(_e);
  _p.set(p[0], p[1], p[2]);
  _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function rbox(w, h, d, r = 0.004, segs = 2) {
  const rr = Math.max(0.0001, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5));
  return new RoundedBoxGeometry(w, h, d, segs, rr);
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Cylinder along an axis ('x' | 'y' | 'z'), centered.
export function cyl(rTop, rBot, h, segs = 24, axis = 'y', open = false, hs = 1) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, hs, open);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

export function torus(r, tube, rs = 8, ts = 24, axis = 'z') {
  const g = new THREE.TorusGeometry(r, tube, rs, ts);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  else if (axis === 'y') g.rotateX(Math.PI / 2);
  return g;
}

// Rounded rectangle path, centered at (cx, cy).
export function rrPath(w, h, r, cx = 0, cy = 0, PathClass = THREE.Shape) {
  const p = new PathClass();
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) {
    p.moveTo(x, y);
    p.lineTo(x + w, y);
    p.lineTo(x + w, y + h);
    p.lineTo(x, y + h);
    p.lineTo(x, y);
    return p;
  }
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

export const rrHole = (w, h, r, cx, cy) => rrPath(w, h, r, cx, cy, THREE.Path);

// Extruded plate from a shape (in its XY plane), thickness t along Z, centered on z = 0,
// with a small chamfer so the outline dimensions stay exact.
export function plate(shape, t, bevel = 0.0018, curveSegments = 6, bevelSegments = 2) {
  const b = Math.min(bevel, t * 0.45);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0002, t - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, -(t - 2 * b) / 2);
  return g;
}

// Planar box-projected UVs in meters (after transformation), so procedural tiling textures
// keep one consistent physical scale on every surface.
export function boxUV(g) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (nx >= ny && nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else if (ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function flipWinding(g) {
  const pos = g.attributes.position;
  const arrs = [pos, g.attributes.normal, g.attributes.uv].filter(Boolean);
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of arrs) {
      const n = a.itemSize;
      for (let k = 0; k < n; k++) {
        const t = a.array[(i + 1) * n + k];
        a.array[(i + 1) * n + k] = a.array[(i + 2) * n + k];
        a.array[(i + 2) * n + k] = t;
      }
    }
  }
}

// Normalize a geometry for merging: non-indexed, only position/normal/uv, transformed.
export function prepGeometry(geo, matrix, uvMode = 'box') {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (matrix) {
    g.applyMatrix4(matrix);
    if (matrix.determinant() < 0) flipWinding(g);
  }
  if (uvMode === 'box' || !g.attributes.uv) boxUV(g);
  g.clearGroups();
  return g;
}

/**
 * Collects primitives and merges them per material family bucket. Color, roughness,
 * metalness, clearcoat, highlight part and ghost group are written per vertex (see
 * materials.js).
 *   new PartBuilder(mats, { ghost })   ghost: default ghost group (0 solid, 1 enclosure
 *                                      sheet metal; 'foam' parts then default to 2)
 *   b.add(geometry, 'powder', { p, r, s, part, uv: 'box' | 'keep', cast, noEdges, ghost })
 *   b.build(group) -> meshes added to group
 */
export class PartBuilder {
  constructor(mats, { ghost = 0 } = {}) {
    this.mats = mats;
    this.ghost = ghost;
    this.buckets = new Map();
  }

  add(geo, key, o = {}) {
    const m = o.matrix || mat4(o.p, o.r, o.s, o.order);
    const g = prepGeometry(geo, m, o.uv || 'box');
    const def = this.mats.resolve(key);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const ex = new Float32Array(n * 4);
    const gg = o.ghost ?? (this.ghost && key === 'foam' ? 2 : this.ghost);
    const pi = (o.part ? PART_INDEX[o.part] || 0 : 0) + GHOST_STRIDE * gg;
    for (let i = 0; i < n; i++) {
      col[i * 3] = def.color[0];
      col[i * 3 + 1] = def.color[1];
      col[i * 3 + 2] = def.color[2];
      ex[i * 4] = pi;
      ex[i * 4 + 1] = def.rough;
      ex[i * 4 + 2] = def.metal;
      ex[i * 4 + 3] = def.coat;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aExtra', new THREE.BufferAttribute(ex, 4));
    const cast = o.cast !== false;
    const receive = o.receive !== false;
    const bk = `${def.family}|${cast ? 1 : 0}|${o.noEdges ? 1 : 0}|${receive ? 1 : 0}|${gg}`;
    let b = this.buckets.get(bk);
    if (!b) {
      b = { family: def.family, cast, receive, noEdges: !!o.noEdges, ghost: gg, geos: [] };
      this.buckets.set(bk, b);
    }
    b.geos.push(g);
    return this;
  }

  build(group) {
    const out = [];
    for (const b of this.buckets.values()) {
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (b.geos.length > 1) b.geos.forEach((g) => g.dispose());
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats.get(b.family));
      mesh.name = `${group.name || 'part'}:${b.family}`;
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.userData.noEdges = b.noEdges;
      mesh.userData.ghost = b.ghost;
      group.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

// A rigid (independently moving) group. Blueprint edges are merged per rigid group.
export function rigid(name, parent, p = [0, 0, 0]) {
  const g = new THREE.Group();
  g.name = name;
  g.userData.rigid = true;
  g.position.set(p[0], p[1], p[2]);
  if (parent) parent.add(g);
  return g;
}

// Runs a build generator (one that yields between chunks of work) to completion.
export function runSteps(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

export function anchor(name, parent, p) {
  const o = new THREE.Object3D();
  o.name = `anchor:${name}`;
  o.position.set(p[0], p[1], p[2]);
  parent.add(o);
  return o;
}

// Hex bolt head with washer, facing +Z at origin (head sits on z = 0 plane).
export function addBolt(b, key, p, r = [0, 0, 0], size = 0.0065, o = {}) {
  const washer = cyl(size * 1.45, size * 1.45, size * 0.28, 16, 'z');
  washer.translate(0, 0, size * 0.14);
  const head = cyl(size, size, size * 0.62, 6, 'z');
  head.rotateZ(Math.PI / 6);
  head.translate(0, 0, size * 0.28 + size * 0.31);
  const cap = cyl(size * 0.72, size * 0.98, size * 0.14, 6, 'z');
  cap.rotateZ(Math.PI / 6);
  cap.translate(0, 0, size * 0.28 + size * 0.62 + size * 0.07);
  const m = mat4(p, r);
  b.add(washer, key, { matrix: m, ...o });
  b.add(head, key, { matrix: m, ...o });
  b.add(cap, key, { matrix: m, ...o });
}

// Dome-head screw (button head), facing +Z.
export function addScrew(b, key, p, r = [0, 0, 0], size = 0.004, o = {}) {
  const g = new THREE.SphereGeometry(size, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 0.55);
  b.add(g, key, { matrix: mat4(p, r), ...o });
}

// A flat decal quad facing +Z that maps an atlas rectangle (uv in 0..1 of the atlas).
export function decalQuad(w, h, rect) {
  const g = new THREE.PlaneGeometry(w, h);
  if (rect) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, rect[0] + uv.getX(i) * rect[2], rect[1] + uv.getY(i) * rect[3]);
    }
  }
  return g;
}

export function tube(points, r, tubular = 32, radial = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'catmullrom', 0.2);
  return new THREE.TubeGeometry(curve, tubular, r, radial, closed);
}

// Lathe around Y from [radius, y] pairs.
export function lathe(pts, segs = 32) {
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}
