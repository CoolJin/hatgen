// HATGEN S5500-5DS / S6500-5DS procedural generator model.
//
//   const gen = createGenerator({ renderer, quality: 'high' | 'medium' | 'low' });
//   // or, without one long main-thread task (a frame between the build stages):
//   const gen = await createGeneratorAsync({ renderer, quality, onProgress: (f) => {} });
//   scene.add(gen.object);
//   gen.set({ open, explode, blueprint, dimensions, power, running, highlight, model });
//   gen.update(dt, elapsed);   // every frame
//
// Units: meters, origin at floor center, front faces +Z. See SPEC.md (MODEL agent).
import * as THREE from 'three';
import { DETAIL } from './dims.js';
import { textureSteps, loadTextFonts, WAIT_FONTS } from './textures.js';
import { createMaterials, HIGHLIGHT_PARTS, PART_INDEX } from './materials.js';
import { enclosureSteps } from './enclosure.js';
import { buildPanel } from './panel.js';
import { buildEngine } from './engine.js';
import { buildAlternator } from './alternator.js';
import { buildTank, buildBattery, buildMuffler, buildVapor } from './parts.js';
import { createBlueprint } from './blueprint.js';
import { createDimensions } from './dimensions.js';
import { seg, easeInOut, smooth, deg, clamp01, runSteps } from './utils.js';

export const ANCHOR_NAMES = [
  'panel', 'display', 'breaker', 'keySwitch', 'schuko1', 'schuko2', 'cee', 'dc12', 'fuelCap', 'door', 'label',
  'lid', 'engine', 'alternator', 'avr', 'tank', 'battery', 'muffler', 'exhaust', 'insulation', 'frame', 'wheels', 'vents',
  'doorInner',
];

const MODES = ['V', 'Hz', 'A', 'kW'];
// small parts get a deeper highlight pulse (they are seen head-on in close-ups)
const SMALL_PARTS = new Set(['display', 'cee', 'schuko1', 'schuko2', 'dc12', 'keySwitch', 'breaker', 'fuelCap']);

export function createGenerator(opts = {}) {
  return runSteps(buildGenerator(opts));
}

// Same build, spread over several frames so a loader keeps animating. onProgress(0..1) is
// called after each stage. The text textures wait (up to 2.5 s) for the web fonts, so they
// are drawn once, in the right face.
export async function createGeneratorAsync({ onProgress, ...opts } = {}) {
  const fonts = loadTextFonts();
  const it = buildGenerator(opts);
  let r = it.next();
  while (!r.done) {
    if (r.value === WAIT_FONTS) await fonts;
    else {
      if (typeof r.value === 'number') onProgress?.(r.value);
      // a hidden tab paints nothing (and throttles timers): just carry on
      if (typeof document === 'undefined' || !document.hidden) await nextFrame();
    }
    r = it.next();
  }
  onProgress?.(1);
  return r.value;
}

// A rendered frame, or 100 ms in a background tab (no requestAnimationFrame there).
function nextFrame() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 100);
    requestAnimationFrame(() => setTimeout(() => {
      clearTimeout(t);
      resolve();
    }, 0));
  });
}

// The whole build as a generator: yields a progress fraction between stages (and the
// texture build's own yields), returns the public API.
function* buildGenerator({ renderer, quality = 'high' } = {}) {
  const Q = DETAIL[quality] || DETAIL.high;
  const T0 = performance.now();
  const lap = (label) => {
    if (globalThis.__HATGEN_DEBUG) console.log(`[generator] ${label}: ${(performance.now() - T0).toFixed(0)} ms`);
  };
  const tex = yield* textureSteps({ renderer, quality });
  lap('textures');
  yield 0.35;
  const mats = createMaterials({ tex, quality });
  const ctx = { mats, tex, D: Q, quality };

  const object = new THREE.Group();
  object.name = 'HATGEN';
  const rig = new THREE.Group();
  rig.name = 'rig';
  object.add(rig);

  const enc = yield* enclosureSteps(ctx, rig);
  lap('enclosure');
  yield 0.6;
  const G = enc.groups;
  const panel = buildPanel(ctx, rig);
  lap('panel');
  yield 0.7;
  const engine = buildEngine(ctx, rig);
  lap('engine');
  yield 0.8;
  const alt = buildAlternator(ctx, rig);
  const tank = buildTank(ctx, rig);
  const battery = buildBattery(ctx, rig);
  const muffler = buildMuffler(ctx, rig);
  lap('parts');
  yield 0.9;

  // Bounds of the assembled (closed) unit, from meshes only.
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  rig.traverse((o) => {
    if (o.isMesh) bounds.expandByObject(o);
  });

  const vapor = buildVapor(ctx, G.back);
  const dims = createDimensions(ctx, object, bounds);
  const blueprint = createBlueprint(rig, mats);

  const anchors = {
    ...enc.anchors,
    ...panel.anchors,
    ...engine.anchors,
    ...alt.anchors,
    ...tank.anchors,
    ...battery.anchors,
    ...muffler.anchors,
  };

  const movers = [G.lid, G.door, G.frontL, G.frontR, G.sideL, G.sideR, G.foamL, G.foamR, G.back, G.foamB, engine.group, alt.group, alt.avr, tank.group, battery.group, muffler.group, panel.group];
  const rest = new Map(movers.map((g) => [g, g.position.clone()]));
  const R = (g) => rest.get(g);

  const displayMats = mats.byFamily('display');
  const ledGreen = mats.byFamily('ledGreen');
  const ledAmber = mats.byFamily('ledAmber');
  const labelMats = mats.byFamily('label');
  const hiU = mats.U.hi.value;
  for (const p of ['display', 'keySwitch', 'dc12', 'breaker']) mats.U.hiWash.value[PART_INDEX[p]] = 0.32;

  const state = { open: 0, explode: 0, blueprint: 0, dimensions: 0, power: 0, running: 0, highlight: null, model: 's5500' };
  const hiLevel = Object.fromEntries(HIGHLIGHT_PARTS.map((p) => [p, 0]));
  let labelMix = 0;
  let lastRunning = 0;
  let peakRunning = 0;
  let startPulse = 0;
  let stopPulse = 0;
  let displayClock = 0;
  let displayTick = 0;

  // ------------------------------------------------------------------ ghosted enclosure
  // In the exploded view the sheet metal shell (and the foam liners) dissolve into a faint
  // warm grey edge cage, so the internals read cleanly. The foam comes back while
  // 'insulation' is highlighted. Shadows dissolve with the panels (custom depth material,
  // same discard).
  const ghostMeshes = [];
  rig.traverse((o) => {
    if (!o.isMesh || !(o.userData.ghost > 0)) return;
    ghostMeshes.push(o);
    if (o.castShadow) o.customDepthMaterial = mats.ghostDepth(!!o.material.map);
  });
  const ghost = { shell: 0, foam: 0, shellLine: 0, foamLine: 0 };
  const ghostU = mats.U.ghost.value;
  function applyGhost() {
    const e = state.explode * smooth(seg(state.open, 0.5, 0.95));
    const gs = smooth(seg(e, 0.06, 0.5));
    const gf = gs * (1 - hiLevel.insulation);
    ghost.shell = gs;
    ghost.foam = gf;
    ghost.shellLine = smooth(seg(gs, 0.2, 0.9));
    ghost.foamLine = smooth(seg(gf, 0.2, 0.9));
    ghostU[1] = gs;
    ghostU[2] = gf;
    for (const m of ghostMeshes) m.visible = (m.userData.ghost === 2 ? gf : gs) < 0.999;
    mats.U.ghostY0.value = object.matrixWorld.elements[13];
    blueprint.set(state.blueprint, ghost.shellLine, ghost.foamLine);
  }

  // ------------------------------------------------------------------ pose (open / explode)
  function applyPose() {
    const o = state.open;
    const e = state.explode * smooth(seg(o, 0.5, 0.95));

    // lid lifts first, tilts slightly; only a touch more when exploding (stays in frame)
    const tl = easeInOut(seg(o, 0, 0.48));
    const tle = easeInOut(seg(e, 0, 0.5));
    const lr = R(G.lid);
    G.lid.position.set(lr.x - 0.015 * tl, lr.y + 0.33 * tl + 0.03 * tle, lr.z - 0.04 * tl - 0.04 * tle);
    // tilt the top away from the front cameras, so it does not mirror the red strip light above
    G.lid.rotation.set(-0.035 * tl, 0, 0.025 * tl);

    // front door swings ~100° around its left hinge
    G.door.rotation.y = -deg(100) * easeInOut(seg(o, 0.12, 0.64));

    // side and back panels slide outwards, liners go along; exploding pulls the panels further
    const ts = easeInOut(seg(o, 0.3, 0.92));
    const tb = easeInOut(seg(o, 0.38, 1));
    const tp = easeInOut(seg(e, 0.12, 0.7));
    G.sideL.position.x = R(G.sideL).x - 0.3 * ts - 0.15 * tp;
    G.sideR.position.x = R(G.sideR).x + 0.3 * ts + 0.15 * tp;
    // the split front bezel clears the view onto engine and alternator when exploding
    G.frontL.position.set(R(G.frontL).x - 0.3 * ts - 0.3 * tp, R(G.frontL).y, R(G.frontL).z + 0.04 * tp);
    G.frontR.position.set(R(G.frontR).x + 0.3 * ts + 0.2 * tp, R(G.frontR).y, R(G.frontR).z + 0.04 * tp);
    G.foamL.position.x = R(G.foamL).x - 0.3 * ts - 0.03 * tp;
    G.foamR.position.x = R(G.foamR).x + 0.3 * ts + 0.03 * tp;
    G.back.position.z = R(G.back).z - 0.3 * tb - 0.15 * tp;
    G.foamB.position.z = R(G.foamB).z - 0.3 * tb - 0.03 * tp;

    // internals
    const tT = easeInOut(seg(e, 0.02, 0.55));
    tank.group.position.set(R(tank.group).x - 0.06 * tT, R(tank.group).y + 0.22 * tT, R(tank.group).z);
    const tE = easeInOut(seg(e, 0.1, 0.62));
    engine.group.position.set(R(engine.group).x - 0.2 * tE, R(engine.group).y + 0.05 * tE, R(engine.group).z);
    const tA = easeInOut(seg(e, 0.16, 0.68));
    alt.group.position.set(R(alt.group).x + 0.2 * tA, R(alt.group).y, R(alt.group).z);
    const tV = easeInOut(seg(e, 0.32, 0.84));
    alt.avr.position.y = R(alt.avr).y + 0.19 * tV;
    const tBx = easeInOut(seg(e, 0.22, 0.58));
    const tBz = easeInOut(seg(e, 0.46, 0.9));
    battery.group.position.set(R(battery.group).x + 0.2 * tBx, R(battery.group).y + 0.02 * tBx, R(battery.group).z + 0.3 * tBz);
    const tM = easeInOut(seg(e, 0.36, 0.95));
    muffler.group.position.set(R(muffler.group).x, R(muffler.group).y + 0.16 * tM, R(muffler.group).z - 0.28 * tM);
    // the control panel module floats up and a little forward, clear of the alternator
    const tP = easeInOut(seg(e, 0.28, 0.8));
    panel.group.position.set(R(panel.group).x + 0.02 * tP, R(panel.group).y + 0.3 * tP, R(panel.group).z + 0.1 * tP);
  }

  // ------------------------------------------------------------------ state
  let poseDirty = true;
  function set(p) {
    if (!p) return;
    for (const k in p) {
      if (!(k in state)) continue;
      let v = p[k];
      if (k === 'highlight') v = v && hiLevel[v] !== undefined ? v : null;
      else if (k === 'model') v = v === 's6500' ? 's6500' : 's5500';
      else {
        v = +v;
        if (!Number.isFinite(v)) continue;
        v = clamp01(v);
      }
      if (state[k] === v) continue;
      state[k] = v;
      if (k === 'open' || k === 'explode') poseDirty = true;
    }
    if (poseDirty) {
      poseDirty = false;
      applyPose();
    }
    applyGhost();
    dims.set(state.dimensions);
  }

  // ------------------------------------------------------------------ per-frame
  function jitter(t, f1, f2, f3) {
    return Math.sin(t * f1) * 0.6 + Math.sin(t * f2 + 1.3) * 0.3 + Math.sin(t * f3 + 2.1) * 0.1;
  }

  let displayOn = null;
  function updateDisplay(dt) {
    const on = state.power > 0.5;
    displayClock += dt;
    displayTick -= dt;
    if (on !== displayOn) {
      displayOn = on;
      displayTick = 0;
      if (on) displayClock = 0;
    }
    if (displayTick > 0) return;
    displayTick = state.running > 0.5 ? 0.22 : 0.4;
    if (!on) {
      tex.display.draw('', '', '', false);
      return;
    }
    const run = state.running > 0.5;
    const mode = MODES[Math.floor(displayClock / 2.6) % MODES.length];
    const r = (a) => (Math.random() - 0.5) * a;
    let top = '';
    if (mode === 'V') top = String(Math.round(400 + (run ? r(4) : 0)));
    else if (mode === 'Hz') top = (50 + (run ? r(0.2) : 0)).toFixed(1);
    else if (mode === 'A') top = run ? (7.2 + r(0.4)).toFixed(1) : '0.0';
    else top = run ? (4.8 + r(0.2)).toFixed(2) : '0.00';
    tex.display.draw(top, '00013', mode, true);
  }

  function update(dt = 0.016, elapsed = 0) {
    dt = Math.min(Math.max(dt, 0), 0.1);

    // running: ~1 mm vibration of the whole unit (slow envelope + a low 28 Hz component so
    // it does not just alias into sub-pixel noise), more on the engine internals, plus a
    // short rocking shudder when the engine catches and when it stops.
    const run = state.running;
    if (run > 0.05 && lastRunning <= 0.05) startPulse = 1;
    peakRunning = Math.max(peakRunning * (run > 0.05 ? 1 : 0), run);
    if (run < 0.25 && lastRunning >= 0.25 && peakRunning > 0.5) stopPulse = 1;
    lastRunning = run;
    startPulse = Math.max(0, startPulse - dt * 1.6);
    stopPulse = Math.max(0, stopPulse - dt * 1.4);
    if (run > 0.001 || startPulse > 0 || stopPulse > 0) {
      const t = elapsed;
      const env = 1 + 0.5 * Math.sin(t * 2.3 * Math.PI * 2);
      const low = Math.sin(t * Math.PI * 2 * 28);
      const a = 0.0011 * run * env;
      rig.position.set((jitter(t, 311, 457, 733) * 0.7 + low * 0.3) * a, (jitter(t, 389, 521, 811) * 0.7 + low * 0.3) * a * 0.6, jitter(t, 347, 499, 677) * a * 0.8);
      const rs = startPulse * startPulse;
      const rp = stopPulse * stopPulse;
      rig.rotation.z = 0.005 * rs * Math.sin(t * 40) + 0.0035 * rp * Math.sin(t * 23) + 0.0004 * run * low;
      rig.rotation.x = 0.0025 * rs * Math.sin(t * 40 + 1.2) + 0.0018 * rp * Math.sin(t * 23 + 0.8);
      const ea = 0.0012 * run * (0.35 + 0.65 * state.open);
      engine.shake.position.set(jitter(t, 293, 431, 617) * ea, jitter(t, 337, 479, 701) * ea, jitter(t, 359, 443, 659) * ea * 0.6);
      alt.shake.position.set(jitter(t, 281, 419, 631) * ea * 0.5, jitter(t, 353, 467, 719) * ea * 0.5, 0);
    } else if (rig.position.lengthSq() > 0 || rig.rotation.z !== 0 || rig.rotation.x !== 0) {
      rig.position.set(0, 0, 0);
      rig.rotation.set(0, 0, 0);
      engine.shake.position.set(0, 0, 0);
      alt.shake.position.set(0, 0, 0);
    }
    vapor.update(elapsed, run * (1 - state.blueprint) * (1 - state.open * 0.7));

    // key switch: OFF (60° left) -> ON; short twist to START when the engine starts
    const startTwist = Math.sin(Math.min(1, (1 - startPulse) * 1.0) * Math.PI) * (startPulse > 0 ? 1 : 0);
    panel.keyGroup.rotation.z = deg(60) * (1 - state.power) - deg(55) * startTwist;

    // display + LEDs
    const p = state.power;
    for (const m of displayMats) m.emissiveIntensity = p * 2.4;
    for (const m of ledGreen) m.emissiveIntensity = p * (run > 0.5 ? 3.2 : 1.8 * (0.75 + 0.25 * Math.sin(elapsed * 4)));
    for (const m of ledAmber) m.emissiveIntensity = p * startPulse * 3;
    updateDisplay(dt);

    // highlight pulse
    const wave = 0.5 + 0.5 * Math.sin(elapsed * 3.2);
    const k = Math.min(1, dt * 7);
    for (const part in hiLevel) {
      const target = state.highlight === part ? 1 : 0;
      let l = hiLevel[part];
      if (l === target && l === 0) continue;
      l += (target - l) * k;
      if (Math.abs(l - target) < 0.002) l = target;
      hiLevel[part] = l;
      const pulse = SMALL_PARTS.has(part) ? 0.3 + 0.7 * wave : 0.5 + 0.5 * wave;
      hiU[PART_INDEX[part]] = l * pulse * (1 - state.blueprint);
    }
    applyGhost();

    // model label crossfade
    const mt = state.model === 's6500' ? 1 : 0;
    if (labelMix !== mt) {
      labelMix += (mt - labelMix) * Math.min(1, dt * 7);
      if (Math.abs(labelMix - mt) < 0.003) labelMix = mt;
      for (const m of labelMats) m.userData.mix.value = labelMix;
    }
  }

  // Edge lines (blueprint + exploded-view cage) are built in idle time right away on every
  // tier, in small slices. prepare() returns a promise that resolves once they are all
  // built; it never blocks (the first blueprint / explode state builds whatever is still
  // missing synchronously anyway).
  function prepare() {
    return blueprint.prebuild();
  }
  if (typeof window !== 'undefined') blueprint.prebuild();

  function dispose() {
    object.removeFromParent();
    blueprint.dispose();
    dims.dispose();
    vapor.dispose();
    object.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    mats.dispose();
    tex.dispose();
  }

  function stats() {
    let meshes = 0;
    let triangles = 0;
    object.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        const gg = o.geometry;
        triangles += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
      }
    });
    return { meshes, triangles: Math.round(triangles), materials: mats.all().length };
  }

  set({});
  applyPose();
  update(0, 0);

  return {
    object,
    anchors,
    bounds,
    set,
    update,
    dispose,
    prepare,
    stats,
    get state() {
      return { ...state };
    },
    parts: { ...G, panel: panel.group, engine: engine.group, alternator: alt.group, avr: alt.avr, tank: tank.group, battery: battery.group, muffler: muffler.group },
  };
}

export default createGenerator;
