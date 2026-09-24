// Edge lines for the technical hidden-line look (blueprint) and the ghosted enclosure
// cage of the exploded view.
//
// Meshes lerp to a flat dark occluder color (shared uniform, see materials.js) while red
// feature edges fade in. Edges are merged per container group (the direct parent of the
// merged part meshes), so they follow every open / explode move. Each line vertex carries
// the ghost group of its source face, so the cage lines of the dissolved enclosure (group
// 1 = sheet metal, 2 = foam) can fade in on their own while the internals stay solid.
//
// Edge extraction is custom (instead of THREE.EdgesGeometry): vertices are welded, face
// normals are computed in float64 and sliver triangles (the long thin fans the earcut
// triangulation of plates with holes produces) borrow the normal their neighbors agree on.
// Without that, their unstable normals turn into long diagonal "crease" lines across flat
// panels.
//
// Edge geometry is built in idle time right after creation (prebuild), or synchronously
// for whatever is still missing the first time lines are needed.
import * as THREE from 'three';
import { GHOST_STRIDE, GHOST_GROUPS } from './materials.js';

const Q = 1e4; // weld precision: 0.1 mm
const QOFF = 32768; // +-3.2 m range for the packed weld key
const SLIVER = 1e-3; // 2 * area / maxEdge^2 below this: normal is not trustworthy

// Extract feature edges of one geometry. Appends transformed segment endpoints to `pos`
// and the ghost group per endpoint to `grp`.
export function extractEdges(geo, matrix, cosT, pos, grp) {
  const P = geo.attributes.position.array;
  const X = geo.attributes.aExtra ? geo.attributes.aExtra.array : null;
  const index = geo.index ? geo.index.array : null;
  const nIdx = index ? index.length : P.length / 3;
  const nTri = (nIdx / 3) | 0;
  if (!nTri) return;

  // --- weld
  const vid = new Int32Array(nTri * 3);
  const weld = new Map();
  const rep = [];
  for (let k = 0; k < nTri * 3; k++) {
    const i = index ? index[k] : k;
    const x = Math.round(P[i * 3] * Q) + QOFF;
    const y = Math.round(P[i * 3 + 1] * Q) + QOFF;
    const z = Math.round(P[i * 3 + 2] * Q) + QOFF;
    const key = (x * 65536 + y) * 65536 + z;
    let id = weld.get(key);
    if (id === undefined) {
      id = rep.length;
      rep.push(i);
      weld.set(key, id);
    }
    vid[k] = id;
  }
  const nv = rep.length;

  // --- face normals (float64); state 0 ok, 1 sliver (unresolved), 2 dead, 3 sliver (resolved)
  const N = new Float64Array(nTri * 3);
  const state = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const a = vid[t * 3];
    const b = vid[t * 3 + 1];
    const c = vid[t * 3 + 2];
    if (a === b || b === c || a === c) {
      state[t] = 2;
      continue;
    }
    const ia = (index ? index[t * 3] : t * 3) * 3;
    const ib = (index ? index[t * 3 + 1] : t * 3 + 1) * 3;
    const ic = (index ? index[t * 3 + 2] : t * 3 + 2) * 3;
    const e1x = P[ib] - P[ia];
    const e1y = P[ib + 1] - P[ia + 1];
    const e1z = P[ib + 2] - P[ia + 2];
    const e2x = P[ic] - P[ia];
    const e2y = P[ic + 1] - P[ia + 1];
    const e2z = P[ic + 2] - P[ia + 2];
    const e3x = P[ic] - P[ib];
    const e3y = P[ic + 1] - P[ib + 1];
    const e3z = P[ic + 2] - P[ib + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const m2 = Math.max(e1x * e1x + e1y * e1y + e1z * e1z, e2x * e2x + e2y * e2y + e2z * e2z, e3x * e3x + e3y * e3y + e3z * e3z);
    if (!(len > SLIVER * m2)) {
      state[t] = 1;
      continue;
    }
    N[t * 3] = nx / len;
    N[t * 3 + 1] = ny / len;
    N[t * 3 + 2] = nz / len;
  }

  // --- edge adjacency
  const emap = new Map();
  const eV = new Int32Array(nTri * 6);
  const eF = new Int32Array(nTri * 6).fill(-1);
  const fE = new Int32Array(nTri * 3).fill(-1);
  let ne = 0;
  for (let t = 0; t < nTri; t++) {
    if (state[t] === 2) continue;
    for (let j = 0; j < 3; j++) {
      const a = vid[t * 3 + j];
      const b = vid[t * 3 + ((j + 1) % 3)];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * nv + hi;
      let e = emap.get(key);
      if (e === undefined) {
        e = ne++;
        emap.set(key, e);
        eV[e * 2] = lo;
        eV[e * 2 + 1] = hi;
        eF[e * 2] = t;
      } else if (eF[e * 2 + 1] === -1 && eF[e * 2] !== t) {
        eF[e * 2 + 1] = t;
      }
      fE[t * 3 + j] = e;
    }
  }

  const other = (e, t) => (eF[e * 2] === t ? eF[e * 2 + 1] : eF[e * 2]);
  const known = (f) => f >= 0 && (state[f] === 0 || state[f] === 3);
  const dot = (f, g) => N[f * 3] * N[g * 3] + N[f * 3 + 1] * N[g * 3 + 1] + N[f * 3 + 2] * N[g * 3 + 2];
  const edgeLen2 = (e) => {
    const a = rep[eV[e * 2]] * 3;
    const b = rep[eV[e * 2 + 1]] * 3;
    const dx = P[a] - P[b];
    const dy = P[a + 1] - P[b + 1];
    const dz = P[a + 2] - P[b + 2];
    return dx * dx + dy * dy + dz * dz;
  };

  // --- slivers take the normal most of their neighbors agree on (ties: longest edge)
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (let t = 0; t < nTri; t++) {
      if (state[t] !== 1) continue;
      let best = -1;
      let bestScore = -1;
      for (let j = 0; j < 3; j++) {
        const e = fE[t * 3 + j];
        const o = other(e, t);
        if (!known(o)) continue;
        let score = edgeLen2(e) * 1e-6;
        for (let k = 0; k < 3; k++) {
          const o2 = other(fE[t * 3 + k], t);
          if (known(o2) && dot(o, o2) > cosT) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
      if (best >= 0) {
        N[t * 3] = N[best * 3];
        N[t * 3 + 1] = N[best * 3 + 1];
        N[t * 3 + 2] = N[best * 3 + 2];
        state[t] = 3;
        changed++;
      }
    }
    if (!changed) break;
  }

  // --- T-junctions: the triangulation can leave a long edge on one side and a chain of
  // shorter collinear edges on the other. All of them look like open boundaries; pair them
  // up and drop the ones that are really coplanar interior edges.
  const skip = new Uint8Array(ne);
  {
    const byV = new Map();
    const bnd = [];
    for (let e = 0; e < ne; e++) {
      if (eF[e * 2 + 1] >= 0) continue;
      bnd.push(e);
      for (const v of [eV[e * 2], eV[e * 2 + 1]]) {
        let l = byV.get(v);
        if (!l) byV.set(v, (l = []));
        l.push(e);
      }
    }
    const vx = (v) => rep[v] * 3;
    for (const e of bnd) {
      if (skip[e]) continue;
      const u = eV[e * 2];
      const v = eV[e * 2 + 1];
      const pu = vx(u);
      const pv = vx(v);
      const dx = P[pv] - P[pu];
      const dy = P[pv + 1] - P[pu + 1];
      const dz = P[pv + 2] - P[pu + 2];
      const L2 = dx * dx + dy * dy + dz * dz;
      if (L2 < 1e-10) continue;
      const chain = [];
      let cur = u;
      let tc = 0;
      let ok = false;
      for (let step = 0; step < 24; step++) {
        let bestE = -1;
        let bestW = -1;
        let bestT = tc;
        for (const e2 of byV.get(cur) || []) {
          if (e2 === e || skip[e2]) continue;
          const w = eV[e2 * 2] === cur ? eV[e2 * 2 + 1] : eV[e2 * 2];
          const pw = vx(w);
          const wx = P[pw] - P[pu];
          const wy = P[pw + 1] - P[pu + 1];
          const wz = P[pw + 2] - P[pu + 2];
          const t = (wx * dx + wy * dy + wz * dz) / L2;
          if (t <= tc + 1e-6 || t > 1 + 1e-6) continue;
          const ox = wx - t * dx;
          const oy = wy - t * dy;
          const oz = wz - t * dz;
          if (ox * ox + oy * oy + oz * oz > 1e-9) continue;
          if (t > bestT) {
            bestT = t;
            bestE = e2;
            bestW = w;
          }
        }
        if (bestE < 0) break;
        chain.push(bestE);
        cur = bestW;
        tc = bestT;
        if (cur === v) {
          ok = true;
          break;
        }
      }
      if (!ok || chain.length < 2) continue;
      const f = eF[e * 2];
      let flat = true;
      for (const e2 of chain) {
        const g = eF[e2 * 2];
        if (known(f) && known(g) && dot(f, g) <= cosT) flat = false;
      }
      if (!flat) continue;
      skip[e] = 1;
      for (const e2 of chain) skip[e2] = 1;
    }

    // Near-twins: bevels with a tiny corner radius leave cap and bevel vertices a fraction
    // of a millimeter apart, so the same edge exists twice with slightly different ends.
    // Pair those up too, and drop sub-millimeter boundary slivers.
    const rest = bnd.filter((e) => !skip[e]);
    const TW = 6e-4 * 6e-4;
    const d2 = (a, b) => {
      const pa = vx(a);
      const pb = vx(b);
      const x = P[pa] - P[pb];
      const y = P[pa + 1] - P[pb + 1];
      const z = P[pa + 2] - P[pb + 2];
      return x * x + y * y + z * z;
    };
    for (const e of rest) if (d2(eV[e * 2], eV[e * 2 + 1]) < TW) skip[e] = 1;
    const live = rest.filter((e) => !skip[e]);
    if (live.length < 4000) {
      for (let i = 0; i < live.length; i++) {
        const e = live[i];
        if (skip[e]) continue;
        const a = eV[e * 2];
        const b = eV[e * 2 + 1];
        for (let j = i + 1; j < live.length; j++) {
          const e2 = live[j];
          if (skip[e2]) continue;
          const c = eV[e2 * 2];
          const d = eV[e2 * 2 + 1];
          const twin = (d2(a, c) < TW && d2(b, d) < TW) || (d2(a, d) < TW && d2(b, c) < TW);
          if (!twin) continue;
          const f = eF[e * 2];
          const g = eF[e2 * 2];
          skip[e2] = 1;
          if (!known(f) || !known(g) || dot(f, g) > cosT) skip[e] = 1;
          break;
        }
      }
    }
  }

  // --- emit: boundary edges + creases between trustworthy normals
  const m = matrix ? matrix.elements : null;
  const push = (i) => {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    if (m) pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    else pos.push(x, y, z);
  };
  for (let e = 0; e < ne; e++) {
    if (skip[e]) continue;
    const f1 = eF[e * 2];
    const f2 = eF[e * 2 + 1];
    if (f2 >= 0) {
      if (state[f1] === 1 || state[f2] === 1) continue;
      if (dot(f1, f2) > cosT) continue;
    }
    push(rep[eV[e * 2]]);
    push(rep[eV[e * 2 + 1]]);
    let g = 0;
    if (X) {
      const vi = index ? index[f1 * 3] : f1 * 3;
      g = Math.floor((X[vi * 4] + 0.5) / GHOST_STRIDE);
    }
    grp.push(g, g);
  }
}

// The exploded view's cage is drawn in a dim warm grey, so bright red stays reserved for the
// highlighted part; the blueprint drawing turns every line red.
const CAGE_COLOR = new THREE.Color(1, 0.88, 0.86); // ~ rgb(255, 225, 220)
const CAGE_ALPHA = 0.18;

export function createBlueprint(root, mats, { threshold = 24 } = {}) {
  const cosT = Math.cos((threshold * Math.PI) / 180);
  // Per ghost group [solid, sheet metal, foam]: line alpha, and how red the line is
  // (1 = blueprint red, 0 = cage grey).
  const uLineA = { value: new Array(GHOST_GROUPS).fill(0) };
  const uLineRed = { value: new Array(GHOST_GROUPS).fill(1) };
  const uCage = { value: CAGE_COLOR };
  const material = new THREE.LineBasicMaterial({
    color: 0xff3b36,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLineA = uLineA;
    shader.uniforms.uLineRed = uLineRed;
    shader.uniforms.uCage = uCage;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aGhost;\nuniform float uLineA[ ${GHOST_GROUPS} ];\nuniform float uLineRed[ ${GHOST_GROUPS} ];\nvarying float vLineA;\nvarying float vLineRed;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nint lineGroup = int( aGhost + 0.5 );\nvLineA = uLineA[ lineGroup ];\nvLineRed = uLineRed[ lineGroup ];');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCage;\nvarying float vLineA;\nvarying float vLineRed;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( uCage, diffuseColor.rgb, vLineRed );\ndiffuseColor.a *= vLineA;');
  };
  material.customProgramCacheKey = () => 'hatgen2-edges';

  const lines = [];
  let queue = null;
  let idleHandle = null;
  let disposed = false;
  const alpha = [0, 0, 0]; // current line alpha per ghost group

  // A zero-length, invisible segment that is drawn for the first few frames so the line
  // program gets compiled during loading (stage.compile) instead of mid-scroll.
  const warmGeo = new THREE.BufferGeometry();
  warmGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.4, 0, 0, 0.4, 0], 3));
  warmGeo.setAttribute('aGhost', new THREE.Float32BufferAttribute([0, 0], 1));
  const warm = new THREE.LineSegments(warmGeo, material);
  warm.name = 'edges:warmup';
  warm.frustumCulled = false;
  warm.raycast = () => {};
  let warmFrames = 0;
  warm.onAfterRender = () => {
    if (++warmFrames > 6) warm.visible = false;
  };
  root.add(warm);

  function collect() {
    if (queue) return;
    const byParent = new Map();
    root.traverse((o) => {
      if (!o.isMesh || o.userData.noEdges || !o.parent) return;
      if (!byParent.has(o.parent)) byParent.set(o.parent, []);
      byParent.get(o.parent).push(o);
    });
    // enclosure groups first: the exploded view needs their cage lines earlier than the
    // blueprint scene needs the rest
    queue = [...byParent].sort((a, b) => ghostOf(b[1]) - ghostOf(a[1]));
  }
  const ghostOf = (meshes) => (meshes.some((m) => m.userData.ghost > 0) ? 1 : 0);

  function applyVisibility(ls) {
    const g = ls.userData.groups;
    ls.visible = (g[0] && alpha[0] > 0.001) || (g[1] && alpha[1] > 0.001) || (g[2] && alpha[2] > 0.001);
  }

  function processOne() {
    const [parent, meshes] = queue.shift();
    const pos = [];
    const grp = [];
    for (const m of meshes) {
      m.updateMatrix();
      extractEdges(m.geometry, m.matrix, cosT, pos, grp);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aGhost', new THREE.Float32BufferAttribute(grp, 1));
    geo.computeBoundingSphere();
    const ls = new THREE.LineSegments(geo, material);
    ls.name = `${parent.name}:edges`;
    ls.renderOrder = 1;
    ls.raycast = () => {};
    const groups = [false, false, false];
    for (const g of grp) groups[g] = true;
    ls.userData.groups = groups;
    applyVisibility(ls);
    parent.add(ls);
    lines.push(ls);
  }

  const isBuilt = () => !!queue && queue.length === 0;

  // Synchronous build (used when lines are needed before the prebuild finished).
  function build() {
    if (disposed) return;
    collect();
    while (queue.length) processOne();
  }

  // Time-sliced build in idle time. Returns a promise that resolves once everything is
  // built (also when a synchronous build() finished the queue in between).
  let prebuilt = null;
  function prebuild() {
    if (prebuilt) return prebuilt;
    if (disposed || isBuilt()) return Promise.resolve();
    collect();
    const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 60);
    prebuilt = new Promise((resolve) => {
      const step = (deadline) => {
        idleHandle = null;
        if (disposed) return resolve();
        let n = 0;
        while (queue.length && (n++ === 0 || deadline.timeRemaining() > 4)) processOne();
        if (queue.length) idleHandle = ric(step, { timeout: 1500 });
        else resolve();
      };
      idleHandle = ric(step, { timeout: 3000 });
    });
    return prebuilt;
  }

  // blueprint: 0..1, ghostShell / ghostFoam: 0..1 visibility of the dissolved enclosure's
  // cage lines (sheet metal / foam).
  function set(blueprint, ghostShell = 0, ghostFoam = 0) {
    const bp = Math.min(1, blueprint * 1.15);
    const g1 = ghostShell * CAGE_ALPHA;
    const g2 = ghostFoam * CAGE_ALPHA;
    const a0 = bp;
    const a1 = Math.max(bp, g1);
    const a2 = Math.max(bp, g2);
    mats.U.blueprint.value = blueprint;
    if (a0 === alpha[0] && a1 === alpha[1] && a2 === alpha[2]) return;
    alpha[0] = a0;
    alpha[1] = a1;
    alpha[2] = a2;
    uLineA.value[0] = a0;
    uLineA.value[1] = a1;
    uLineA.value[2] = a2;
    // a cage line turns red as the blueprint takes over
    uLineRed.value[1] = a1 > 0 ? bp / a1 : 1;
    uLineRed.value[2] = a2 > 0 ? bp / a2 : 1;
    const any = a0 > 0.001 || a1 > 0.001 || a2 > 0.001;
    if (any && !isBuilt()) {
      // blueprint needs everything; the ghost cage only needs the enclosure groups
      if (a0 > 0.001) build();
      else {
        collect();
        while (queue.length && ghostOf(queue[0][1])) processOne();
      }
    }
    mats.setEdgeOffset(any);
    for (const l of lines) applyVisibility(l);
  }

  function dispose() {
    disposed = true;
    for (const l of lines) {
      l.geometry.dispose();
      l.parent?.remove(l);
    }
    lines.length = 0;
    warm.removeFromParent();
    warmGeo.dispose();
    material.dispose();
  }

  return { set, build, prebuild, dispose, material, get built() { return isBuilt(); } };
}
