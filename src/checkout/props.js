// Procedural 3D props of the checkout: wooden pallet, tension straps with ratchets, the
// six-panel plywood crate with stencilled markings and shipping label, the pickup marker
// ring on the floor, a spark burst and a light flash. Lazily imported on the first
// checkout opening (three.js is already loaded by then), built once and reused.
//
// All animation state lives in plain numbers on `props.state`; the checkout scene
// controller tweens them and props.update() applies them every frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { woodTexture, strapTexture, stencilTexture, labelTexture, ringTextTexture, rng } from './textures.js';

// Pallet (x = length, z = depth), metres.
export const PALLET = { l: 1.14, d: 0.78, h: 0.144 };
// Crate: outer size of the plywood walls (battens stick out 22 mm more), wall height above
// the pallet deck, sheet thickness.
export const CRATE = { x: 0.55, z: 0.37, h: 0.92, t: 0.018, bw: 0.075, bt: 0.022 };
// The generator stands this much higher once the crate floor is under it.
export const BASE_T = CRATE.t;
// Where the generator hovers while the pallet rises or sinks below it.
export const HOVER = 0.3;
// Strap positions along x and the anchor points on the deck (z).
const STRAP_X = [-0.36, 0.2];
const STRAP_W = 0.036;
const ANCHOR_Z = 0.33;
const GEN_H = 0.8;
const GEN_Z = 0.276;

const TAU = Math.PI * 2;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

// ------------------------------------------------------------------ geometry helpers
// A rounded board, built with its length along x so the projected UVs run the grain along
// the board, then rotated / moved into place. Carries a per-board tint (vertex colour).
function board(w, h, d, { pos = [0, 0, 0], rot = [0, 0, 0], tint, r = 0.003, seg = 2, rand }) {
  const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new RoundedBoxGeometry(w, h, d, seg, rr);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  const ou = rand();
  const ov = rand();
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv.setXY(i, u / 0.95 + ou, v / 0.475 + ov);
  }
  const col = new Float32Array(p.count * 3);
  const k = 0.9 + rand() * 0.16;
  for (let i = 0; i < p.count; i++) {
    col[i * 3] = tint.r * k;
    col[i * 3 + 1] = tint.g * k;
    col[i * 3 + 2] = tint.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tmpE.set(rot[0], rot[1], rot[2]);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpV.set(pos[0], pos[1], pos[2]), tmpQ, ONE);
  g.applyMatrix4(tmpM);
  return g;
}

// Polyline through the corners with round fillets (radius r) at the inner corners.
function filleted(pts, r, steps = 5) {
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const d1 = tmpV.subVectors(a, b).normalize().clone();
    const d2 = new THREE.Vector3().subVectors(c, b).normalize();
    const p1 = b.clone().addScaledVector(d1, r);
    const p2 = b.clone().addScaledVector(d2, r);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratic bezier p1 -> b -> p2
      const q = new THREE.Vector3()
        .copy(p1)
        .multiplyScalar((1 - t) * (1 - t))
        .addScaledVector(b, 2 * (1 - t) * t)
        .addScaledVector(p2, t * t);
      out.push(q);
    }
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

// Flat ribbon along a path in the y/z plane at x, width along x. aAlong: 0..1 along the
// whole strap (for the draw-on), uv.v in strap widths (texture repeat).
function ribbon(path, x, width, total, startLen) {
  const n = path.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const along = new Float32Array(n * 2);
  const idx = [];
  let len = startLen;
  const T = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i > 0) len += path[i].distanceTo(path[i - 1]);
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    // outward normal = X × T
    const ny = -T.z;
    const nz = T.y;
    for (let s = 0; s < 2; s++) {
      const j = i * 2 + s;
      pos[j * 3] = x + (s ? width / 2 : -width / 2);
      pos[j * 3 + 1] = path[i].y;
      pos[j * 3 + 2] = path[i].z;
      nor[j * 3] = 0;
      nor[j * 3 + 1] = ny;
      nor[j * 3 + 2] = nz;
      uv[j * 2] = s;
      uv[j * 2 + 1] = len / width;
      along[j] = len / total;
    }
    if (i < n - 1) {
      const a0 = i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.setIndex(idx);
  return g;
}

function pathLength(path) {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += path[i].distanceTo(path[i - 1]);
  return l;
}

// ------------------------------------------------------------------ materials
function woodMaterial(tex, U) {
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    bumpMap: tex,
    bumpScale: 0.9,
    roughness: 0.8,
    metalness: 0,
    vertexColors: true,
  });
  m.name = 'checkout:wood';
  // Clipped at the floor (the pallet rises out of / sinks into it) with a thin red glowing
  // seam at the cut while it moves.
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uClipGlow = U.clipGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCoY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vCoY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCoY;\nuniform float uClipGlow;')
      .replace('void main() {', 'void main() {\n  if (vCoY < -0.0004) discard;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.16, 0.12) * 4.0 * uClipGlow * (1.0 - smoothstep(0.0, 0.01, vCoY));'
      );
  };
  m.customProgramCacheKey = () => 'checkout-wood';
  return m;
}

function strapMaterial(tex, U) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d6361f'),
    map: tex,
    roughness: 0.66,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  m.name = 'checkout:strap';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uProgress = U.strap;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlong;\nvarying float vAlong;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlong = aAlong;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;\nuniform float uProgress;')
      .replace('void main() {', 'void main() {\n  if (vAlong > uProgress) discard;')
      .replace(
        '#include <emissivemap_fragment>',
        // a hot leading edge while the strap is being pulled on
        '#include <emissivemap_fragment>\n  float coEdge = (1.0 - smoothstep(0.0, 0.035, uProgress - vAlong)) * step(uProgress, 0.999);\n  totalEmissiveRadiance += vec3(1.0, 0.35, 0.2) * 3.0 * coEdge;'
      );
  };
  m.customProgramCacheKey = () => 'checkout-strap';
  return m;
}

// Floor marker ring (additive, drawn above the floor).
const ringVertex = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ringFragment = /* glsl */ `
uniform float uAmount;
uniform float uPulse;
uniform float uTime;
uniform sampler2D uText;
varying vec2 vP;
#define TAU 6.28318530718
float line(float d, float w) {
  float aa = fwidth(d) * 1.2;
  return 1.0 - smoothstep(w, w + aa, abs(d));
}
void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float u = a / TAU + 0.5;
  const float R0 = 0.74;
  const float R1 = 0.9;
  float c = 0.0;
  c += line(r - R0, 0.0035) * 1.5;
  // ticks every 5 degrees, longer every 45
  float tk = fract(u * 72.0 + uTime * 0.004);
  float tick = line((tk - 0.5) / 72.0 * TAU * r, 0.0022) * step(R0 + 0.012, r) * step(r, R0 + (fract(u * 8.0 + uTime * 0.004 + 0.0625 / 9.0) < 0.12 ? 0.05 : 0.026));
  c += tick * 0.9;
  // text band
  float tv = (r - 0.80) / 0.05;
  if (tv > 0.0 && tv < 1.0) c += texture2D(uText, vec2(u * 3.0 - uTime * 0.012, 1.0 - tv)).r * 1.1;
  // dashed outer ring
  c += line(r - R1, 0.0022) * step(0.45, fract(u * 160.0 - uTime * 0.05)) * 0.8;
  // soft inner glow and expanding pulse waves
  c += smoothstep(0.35, R0, r) * step(r, R0) * 0.12;
  float w1 = fract(uTime * 0.42);
  float w2 = fract(uTime * 0.42 + 0.5);
  float rr1 = mix(0.5, 1.25, w1);
  float rr2 = mix(0.5, 1.25, w2);
  c += (exp(-pow((r - rr1) * 28.0, 2.0)) * (1.0 - w1) + exp(-pow((r - rr2) * 28.0, 2.0)) * (1.0 - w2)) * (0.35 + uPulse * 1.4);
  float fade = 1.0 - smoothstep(1.05, 1.3, r);
  vec3 col = vec3(1.0, 0.13, 0.1) * c * fade * uAmount * (0.72 + uPulse * 0.9);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Spark burst: velocity per point, integrated in the vertex shader.
const sparkVertex = /* glsl */ `
attribute vec4 aSeed; // life, size, delay, heat
uniform float uT;
uniform float uPx;
varying float vA;
varying float vHeat;
void main() {
  float t = max(0.0, uT - aSeed.z);
  float life = aSeed.x;
  float k = clamp(t / life, 0.0, 1.0);
  vec3 v = position;
  vec3 p = v * t * (1.0 - 0.35 * k) + vec3(0.0, -4.2, 0.0) * 0.5 * t * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = (uT > aSeed.z && k < 1.0) ? (1.0 - k) : 0.0;
  vHeat = aSeed.w * (1.0 - k);
  gl_PointSize = aSeed.y * uPx / max(0.2, -mv.z) * (0.5 + 0.5 * (1.0 - k));
}
`;
const sparkFragment = /* glsl */ `
varying float vA;
varying float vHeat;
void main() {
  if (vA <= 0.0) discard;
  vec2 d = gl_PointCoord - 0.5;
  float f = exp(-dot(d, d) * 18.0);
  vec3 hot = vec3(1.0, 0.85, 0.6);
  vec3 red = vec3(1.0, 0.12, 0.06);
  vec3 col = mix(red, hot, clamp(vHeat, 0.0, 1.0)) * 5.0;
  gl_FragColor = vec4(col * f * vA, 1.0);
}
`;

const flashVertex = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;
const flashFragment = /* glsl */ `
uniform float uAmount;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * r * 2.2) * 0.35;
  float streak = exp(-abs(d.y) * 60.0) * exp(-abs(d.x) * 3.0) * 0.6;
  vec3 col = vec3(1.0, 0.3, 0.22) * (core * 2.5 + halo + streak) * uAmount;
  gl_FragColor = vec4(col, 1.0);
}
`;

function additive(m) {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
}

function noShadowBake(o) {
  o.castShadow = false;
  o.receiveShadow = false;
  o.userData.noContactShadow = true;
  return o;
}

// ------------------------------------------------------------------ build
export function createProps({ stage, quality = 'high' }) {
  const renderer = stage.renderer;
  const seg = quality === 'low' ? 1 : 2;
  const U = {
    clipGlow: { value: 0 },
    strap: { value: 0 },
  };
  const rand = rng(42);

  const root = new THREE.Group();
  root.name = 'checkout:props';

  const woodTex = woodTexture(renderer, quality === 'low' ? 512 : 1024);
  const wood = woodMaterial(woodTex, U);
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9bdc2'), metalness: 1, roughness: 0.32 });
  steel.name = 'checkout:steel';

  // tints multiply the neutral grain texture (the warm key light adds the rest)
  const pine = new THREE.Color('#efe0c4');
  const pineDark = new THREE.Color('#d9c29c');
  const ply = new THREE.Color('#f4eadb');
  const plyEdge = new THREE.Color('#e4d0ad');

  // ---------------------------------------------------------------- pallet
  const palletGroup = new THREE.Group();
  palletGroup.name = 'checkout:pallet';
  {
    const P = PALLET;
    const parts = [];
    const topZ = [[-0.33, 0.12], [-0.165, 0.1], [0, 0.145], [0.165, 0.1], [0.33, 0.12]];
    for (const [z, w] of topZ) parts.push(board(P.l, 0.022, w, { pos: [0, P.h - 0.011, z], tint: pine, seg, rand }));
    for (const x of [-0.52, 0, 0.52]) {
      parts.push(board(P.d, 0.022, 0.1, { pos: [x, 0.111, 0], rot: [0, Math.PI / 2, 0], tint: pine, seg, rand }));
      for (const [z, w] of [[-0.33, 0.12], [0, 0.145], [0.33, 0.12]]) {
        parts.push(board(w, 0.078, 0.1, { pos: [x, 0.061, z], rot: [0, Math.PI / 2, 0], tint: pineDark, seg, rand, r: 0.004 }));
      }
    }
    for (const [z, w] of [[-0.33, 0.12], [0, 0.145], [0.33, 0.12]]) parts.push(board(P.l, 0.022, w, { pos: [0, 0.011, z], tint: pine, seg, rand }));
    const geo = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geo, wood);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    palletGroup.add(mesh);
  }
  root.add(palletGroup);

  // ---------------------------------------------------------------- straps
  const strapTex = strapTexture(renderer);
  const strapMat = strapMaterial(strapTex, U);
  const straps = new THREE.Mesh(new THREE.BufferGeometry(), strapMat);
  noShadowBake(straps);
  straps.name = 'checkout:straps';
  const hardware = new THREE.Mesh(new THREE.BufferGeometry(), steel);
  noShadowBake(hardware);
  let buckleAlong = 0.15;
  let strapFloor = -1;

  // floor: height of the surface the generator stands on (pallet deck or crate floor).
  function buildStraps(floor) {
    if (Math.abs(floor - strapFloor) < 1e-5) return;
    strapFloor = floor;
    const top = floor + GEN_H + 0.007;
    const zf = GEN_Z + 0.006;
    const corners = [
      new THREE.Vector3(0, PALLET.h + 0.0015, ANCHOR_Z),
      new THREE.Vector3(0, top, zf),
      new THREE.Vector3(0, top, -zf),
      new THREE.Vector3(0, PALLET.h + 0.0015, -ANCHOR_Z),
    ];
    const path = filleted(corners, 0.018, 5);
    const total = pathLength(path);
    const geos = STRAP_X.map((x) => ribbon(path, x, STRAP_W, total, 0));
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    straps.geometry.dispose();
    straps.geometry = merged;

    // ratchets on the front run (about a third up), anchor plates at both ends
    const a = corners[0];
    const b = corners[1];
    const segLen = a.distanceTo(b);
    const at = 0.3;
    buckleAlong = (segLen * at) / total;
    const pos = new THREE.Vector3().lerpVectors(a, b, at);
    const tilt = Math.atan2(b.z - a.z, b.y - a.y); // lean of the front run
    const hw = [];
    const add = (g, p, rot) => {
      tmpE.set(rot[0], rot[1], rot[2]);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(p[0], p[1], p[2]), tmpQ, ONE);
      g.applyMatrix4(tmpM);
      hw.push(g);
    };
    for (const x of STRAP_X) {
      // ratchet: base plate, handle, spool
      add(new RoundedBoxGeometry(0.052, 0.095, 0.012, 1, 0.003), [x, pos.y, pos.z + 0.008], [-tilt, 0, 0]);
      add(new RoundedBoxGeometry(0.046, 0.07, 0.01, 1, 0.003), [x, pos.y + 0.012, pos.z + 0.022], [-tilt - 0.25, 0, 0]);
      const spool = new THREE.CylinderGeometry(0.011, 0.011, 0.056, 12, 1);
      spool.rotateZ(Math.PI / 2);
      add(spool, [x, pos.y - 0.02, pos.z + 0.016], [0, 0, 0]);
      for (const sz of [1, -1]) add(new RoundedBoxGeometry(0.05, 0.004, 0.03, 1, 0.0015), [x, PALLET.h + 0.002, sz * ANCHOR_Z], [0, 0, 0]);
    }
    const hg = mergeGeometries(hw.map((g) => (g.index ? g.toNonIndexed() : g)));
    hw.forEach((g) => g.dispose());
    hardware.geometry.dispose();
    hardware.geometry = hg;
  }
  buildStraps(PALLET.h);
  root.add(straps, hardware);

  // ---------------------------------------------------------------- crate
  const C = CRATE;
  const crate = new THREE.Group();
  crate.name = 'checkout:crate';
  crate.position.y = PALLET.h;
  root.add(crate);

  const decalMats = [];
  function decalMaterial(tex) {
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.85,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    decalMats.push(m);
    return m;
  }

  // A wall in canonical orientation (XY plane, outer face +z) with perimeter battens.
  function wall(w, h, { cross = false } = {}) {
    const parts = [board(w, h, C.t, { tint: ply, seg, rand, r: 0.002 })];
    const z = C.t / 2 + C.bt / 2;
    parts.push(board(w, C.bw, C.bt, { pos: [0, h / 2 - C.bw / 2, z], tint: plyEdge, seg, rand }));
    parts.push(board(w, C.bw, C.bt, { pos: [0, -h / 2 + C.bw / 2, z], tint: plyEdge, seg, rand }));
    const vh = h - 2 * C.bw;
    for (const sx of [-1, 1]) parts.push(board(vh, C.bw, C.bt, { pos: [sx * (w / 2 - C.bw / 2), 0, z], rot: [0, 0, Math.PI / 2], tint: plyEdge, seg, rand }));
    if (cross) parts.push(board(vh, C.bw, C.bt, { pos: [0, 0, z], rot: [0, 0, Math.PI / 2], tint: plyEdge, seg, rand }));
    const geo = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geo, wood);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function addDecal(group, w, h, tex, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMaterial(tex));
    m.position.z = z;
    m.renderOrder = 1;
    noShadowBake(m);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  // panels: locked pose + where they fly in from
  const panels = [];
  function panel(name, mesh, locked, away) {
    const g = new THREE.Group();
    g.name = `checkout:crate-${name}`;
    g.add(mesh);
    crate.add(g);
    const p = { name, group: g, t: 0, locked, away };
    panels.push(p);
    return p;
  }
  const iw = C.x * 2 - 2 * C.bw; // decal area on front / back
  const ih = C.h - 2 * C.bw;
  const sw = C.z * 2 - 2 * C.t; // side wall width
  const decalZ = C.t / 2 + 0.0008;

  const front = panel('front', wall(C.x * 2, C.h), { p: [0, C.h / 2, C.z - C.t / 2], r: [0, 0, 0] }, { p: [0.1, 0.55, 1.5], r: [-0.9, 0.25, 0.1] });
  const frontDecalSize = [iw, ih];
  let frontDecal = null;
  const back = panel('back', wall(C.x * 2, C.h), { p: [0, C.h / 2, -(C.z - C.t / 2)], r: [0, Math.PI, 0] }, { p: [-0.1, 0.6, -1.6], r: [0.9, -0.3, 0] });
  addDecal(back.group, iw, ih, stencilTexture(renderer, 'back', iw, ih), decalZ);
  const right = panel('right', wall(sw, C.h, { cross: true }), { p: [C.x - C.t / 2, C.h / 2, 0], r: [0, Math.PI / 2, 0] }, { p: [1.6, 0.5, 0.2], r: [0, 0.2, -0.8] });
  const left = panel('left', wall(sw, C.h, { cross: true }), { p: [-(C.x - C.t / 2), C.h / 2, 0], r: [0, -Math.PI / 2, 0] }, { p: [-1.6, 0.5, -0.1], r: [0, -0.2, 0.8] });
  const sideW = (sw - 2 * C.bw - C.bw) / 2; // between the frame and the middle batten
  for (const p of [right, left]) {
    const tex = stencilTexture(renderer, 'side', sideW, ih);
    const d = addDecal(p.group, sideW, ih, tex, decalZ);
    d.position.x = -(C.bw / 2 + sideW / 2);
  }
  const lid = panel('lid', wall(C.x * 2, C.z * 2, { cross: true }), { p: [0, C.h + C.t / 2, 0], r: [-Math.PI / 2, 0, 0] }, { p: [0, 1.35, 0.1], r: [0.25, 0.5, 0.1] });
  {
    const lw = (C.x * 2 - 3 * C.bw) / 2;
    const lh = C.z * 2 - 2 * C.bw;
    const d = addDecal(lid.group, lw, lh, stencilTexture(renderer, 'lid', lw, lh), decalZ);
    d.position.x = -(C.bw / 2 + lw / 2);
  }
  // crate floor (under the generator, inside the walls)
  const baseMesh = (() => {
    const g = board(C.x * 2 - 2 * C.t - 0.002, C.t, C.z * 2 - 2 * C.t - 0.002, { pos: [0, 0, 0], tint: ply, seg, rand, r: 0.002 });
    const m = new THREE.Mesh(g, wood);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  })();
  const base = panel('base', baseMesh, { p: [0, C.t / 2, 0], r: [0, 0, 0] }, { p: [0, 0.02, 1.5], r: [0, 0, 0] });

  // shipping label on the front wall (right half, between the frame battens)
  const labelMat = new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  });
  const LABEL = { w: 0.3, h: 0.208, x: 0.3, y: -0.04 };
  const label = new THREE.Mesh(new THREE.PlaneGeometry(LABEL.w, LABEL.h), labelMat);
  label.position.set(LABEL.x, LABEL.y, decalZ + 0.0006);
  label.renderOrder = 2;
  noShadowBake(label);
  label.receiveShadow = true;
  label.visible = false;
  front.group.add(label);

  function setFrontStencil(model) {
    const key = `${model.name}`;
    if (frontDecal?.userData.key === key) return;
    const tex = stencilTexture(renderer, 'front', frontDecalSize[0], frontDecalSize[1], { modelName: model.name, kw: model.kw });
    if (frontDecal) {
      frontDecal.material.map?.dispose();
      frontDecal.material.map = tex;
      frontDecal.material.needsUpdate = true;
    } else {
      frontDecal = addDecal(front.group, frontDecalSize[0], frontDecalSize[1], tex, decalZ);
    }
    frontDecal.userData.key = key;
  }

  function setLabel(info) {
    labelMat.map?.dispose();
    labelMat.map = labelTexture(renderer, info);
    labelMat.needsUpdate = true;
  }

  // ---------------------------------------------------------------- marker ring
  const ringTex = ringTextTexture(renderer);
  const ringU = { uAmount: { value: 0 }, uPulse: { value: 0 }, uTime: { value: 0 }, uText: { value: ringTex } };
  const ringMat = additive(new THREE.ShaderMaterial({ uniforms: ringU, vertexShader: ringVertex, fragmentShader: ringFragment }));
  const ring = new THREE.Mesh(new THREE.CircleGeometry(1.32, quality === 'low' ? 64 : 128), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  ring.renderOrder = 3;
  ring.frustumCulled = false;
  noShadowBake(ring);
  ring.visible = false;
  root.add(ring);

  // ---------------------------------------------------------------- sparks + flash
  const SPARKS = quality === 'low' ? 110 : 220;
  const sparkGeo = new THREE.BufferGeometry();
  {
    const v = new Float32Array(SPARKS * 3);
    const s = new Float32Array(SPARKS * 4);
    const r = rng(99);
    for (let i = 0; i < SPARKS; i++) {
      // mostly toward the viewer side (+z) and up, a few sideways
      const th = (r() - 0.5) * Math.PI * 1.5;
      const ph = r() * Math.PI * 0.55 + 0.1;
      const sp = 1.1 + r() * r() * 3.2;
      v[i * 3] = Math.sin(th) * Math.cos(ph) * sp;
      v[i * 3 + 1] = Math.sin(ph) * sp * 0.9 + 0.4;
      v[i * 3 + 2] = Math.abs(Math.cos(th)) * Math.cos(ph) * sp * 0.9 + 0.2;
      s[i * 4] = 0.5 + r() * 0.9;
      s[i * 4 + 1] = 0.012 + r() * 0.03;
      s[i * 4 + 2] = r() * r() * 0.18;
      s[i * 4 + 3] = r();
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
    sparkGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
  }
  const sparkU = { uT: { value: 99 }, uPx: { value: 600 } };
  const sparks = new THREE.Points(sparkGeo, additive(new THREE.ShaderMaterial({ uniforms: sparkU, vertexShader: sparkVertex, fragmentShader: sparkFragment })));
  sparks.visible = false;
  sparks.frustumCulled = false;
  sparks.renderOrder = 5;
  sparks.userData.stageIgnoreMotion = true;
  root.add(sparks);

  const flashU = { uAmount: { value: 0 }, uSize: { value: 0.6 } };
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(new THREE.ShaderMaterial({ uniforms: flashU, vertexShader: flashVertex, fragmentShader: flashFragment })));
  noShadowBake(flash);
  flash.visible = false;
  flash.frustumCulled = false;
  flash.renderOrder = 6;
  root.add(flash);

  // ---------------------------------------------------------------- state + update
  const state = {
    pallet: -0.17, // y offset of the pallet (0 = on the floor, below ~-0.16 = sunk away)
    clipGlow: 0,
    straps: 0, // 0..1 draw-on
    strapFloor: PALLET.h,
    ring: 0,
    ringPulse: 0,
    base: 0,
    front: 0,
    back: 0,
    left: 0,
    right: 0,
    lid: 0,
    crateKick: 0, // 0..1 short squash when the lid locks
    label: 0, // 0 = off, 0..1 slap in
    flash: 0,
    sparkT: 99,
    spin: 0, // rotation of the whole prop group (follows the generator)
  };

  const labelWorld = new THREE.Vector3();
  function update(dt, elapsed) {
    root.rotation.y = state.spin;

    const py = state.pallet;
    palletGroup.position.y = py;
    palletGroup.visible = py > -0.16;
    U.clipGlow.value = state.clipGlow;

    buildStraps(state.strapFloor);
    U.strap.value = state.straps;
    straps.visible = state.straps > 0.001;
    hardware.visible = state.straps > buckleAlong;

    let anyPanel = false;
    for (const p of panels) {
      const t = state[p.name];
      const vis = t > 0.001;
      p.group.visible = vis;
      if (!vis) continue;
      anyPanel = true;
      const k = 1 - t;
      p.group.position.set(p.locked.p[0] + p.away.p[0] * k, p.locked.p[1] + p.away.p[1] * k, p.locked.p[2] + p.away.p[2] * k);
      p.group.rotation.set(p.locked.r[0] + p.away.r[0] * k, p.locked.r[1] + p.away.r[1] * k, p.locked.r[2] + p.away.r[2] * k);
    }
    crate.visible = anyPanel;
    const kick = state.crateKick;
    crate.scale.set(1 + kick * 0.012, 1 - kick * 0.018, 1 + kick * 0.012);

    // label: slaps onto the front wall from the viewer side
    const l = state.label;
    label.visible = l > 0.001 && state.front > 0.001;
    if (label.visible) {
      const k = 1 - Math.min(1, l);
      label.position.set(LABEL.x + k * 0.05, LABEL.y + k * 0.12, decalZ + 0.0006 + k * 0.45);
      label.rotation.set(-k * 0.5, k * 0.2, -0.035 + k * 0.45);
      const sq = l > 1 ? 1 + (l - 1) * 0.12 : 1 + k * 0.7;
      label.scale.set(sq, l > 1 ? 1 - (l - 1) * 0.2 : sq, 1);
    }

    // ring
    ringU.uAmount.value = state.ring;
    ringU.uPulse.value = state.ringPulse;
    ringU.uTime.value = elapsed;
    ring.visible = state.ring > 0.002;

    // sparks + flash at the label
    if (state.sparkT < 3 || state.flash > 0.001) {
      front.group.updateWorldMatrix(true, false);
      labelWorld.set(LABEL.x, LABEL.y, decalZ + 0.02).applyMatrix4(front.group.matrixWorld);
      root.worldToLocal(labelWorld);
    }
    if (state.sparkT < 3) {
      state.sparkT += dt;
      sparkU.uT.value = state.sparkT;
      sparks.position.copy(labelWorld);
      sparks.visible = true;
      const cam = stage.camera;
      const size = stage.size;
      sparkU.uPx.value = ((size.frameHeight || size.height) * (size.dpr || 1)) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    } else sparks.visible = false;
    flash.visible = state.flash > 0.001;
    if (flash.visible) {
      flash.position.copy(labelWorld);
      flashU.uAmount.value = state.flash;
      flashU.uSize.value = 0.35 + (1 - state.flash) * 0.9;
    }
  }

  function burst() {
    state.sparkT = 0;
  }

  // Everything hidden, back at rest (the crate panels, label and pallet are reused).
  function reset() {
    Object.assign(state, {
      pallet: -0.17, clipGlow: 0, straps: 0, strapFloor: PALLET.h, ring: 0, ringPulse: 0,
      base: 0, front: 0, back: 0, left: 0, right: 0, lid: 0, crateKick: 0, label: 0, flash: 0, sparkT: 99, spin: 0,
    });
    update(0, 0);
  }

  // Compile the programs up front, so the first appearance does not hitch.
  // The stage renders into a linear half-float composer buffer, so the programs are
  // compiled with such a target bound (same program keys as the real frames).
  function warm() {
    const vis = [];
    root.traverse((o) => {
      vis.push([o, o.visible]);
      o.visible = true;
    });
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const prev = renderer.getRenderTarget();
    let pending = null;
    try {
      renderer.setRenderTarget(rt);
      pending = renderer.compileAsync ? renderer.compileAsync(root, stage.camera, stage.scene) : renderer.compile(root, stage.camera, stage.scene);
    } catch {
      /* compiled lazily on first use instead */
    }
    renderer.setRenderTarget(prev);
    for (const [o, v] of vis) o.visible = v;
    Promise.resolve(pending)
      .catch(() => {})
      .finally(() => rt.dispose());
    return pending;
  }

  function dispose() {
    root.removeFromParent();
    root.traverse((o) => {
      o.geometry?.dispose();
    });
    [wood, steel, strapMat, labelMat, ringMat, ...decalMats].forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    woodTex.dispose();
    strapTex.dispose();
    ringTex.dispose();
  }

  reset();

  return {
    root,
    state,
    update,
    burst,
    reset,
    warm,
    dispose,
    setFrontStencil,
    setLabel,
    PALLET,
    CRATE,
    get drawCalls() {
      let n = 0;
      root.traverse((o) => {
        if (o.isMesh || o.isPoints) n++;
      });
      return n;
    },
    TAU,
  };
}
