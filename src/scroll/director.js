// Scroll director: maps the page scroll position to one continuous 3D state
// (camera shot, generator state, stage look) using keyframes anchored to sections.
import { isStacked, reducedMotion } from '../core/env.js';
import { buildShots } from './shots.js';

export const DEFAULTS = {
  // camera
  az: 28, el: 9, dist: 3.1, tx: 0, ty: 0.4, tz: 0, fov: 30, ox: 0.2, oy: 0,
  // generator
  open: 0, explode: 0, blueprint: 0, dimensions: 0, power: 0, running: 0, sway: 0,
  // stage
  key: 1, rim: 1, fill: 1, exposure: 1, bloom: 1, floor: 1, grid: 0,
  backdrop: 1, dust: 0.6, beam: 0.6, tint: 1, stageBlueprint: 0,
};
const KEYS = Object.keys(DEFAULTS);
const CAMERA_KEYS = ['az', 'el', 'dist', 'tx', 'ty', 'tz', 'fov', 'ox', 'oy'];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const EASES = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export function createDirector({ stage, gen, snap = false }) {
  const sections = new Map(); // id -> { el, top, height, pinned, len, steps }
  let keys = []; // resolved keyframes sorted by y
  let vh = window.innerHeight;
  const target = { ...DEFAULTS };
  const current = { ...DEFAULTS };
  const overrides = {}; // e.g. intro multipliers, demo run
  const tmpA = [0, 0, 0];
  const tmpB = [0, 0, 0];
  let first = true;
  let pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let highlight = null;
  let info = { scene: null, p: 0, step: -1, stepCount: 0, solid: false, pinned: false };

  function measure() {
    vh = window.innerHeight;
    sections.clear();
    document.querySelectorAll('main [data-scene]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY;
      const height = el.offsetHeight;
      const pinned = el.classList.contains('scene--pinned');
      const len = pinned ? Math.max(1, height - vh) : Math.max(1, height);
      const steps = el.querySelectorAll('.step').length;
      sections.set(el.id || el.dataset.scene, {
        el, id: el.id || el.dataset.scene, top, height, pinned, len, steps,
        solid: el.classList.contains('solid'),
      });
    });
  }

  function resolve() {
    const aspect = window.innerWidth / Math.max(1, vh);
    // Stacked layout (text below the product): phones and portrait tablets.
    const mobile = isStacked();
    const raw = buildShots({ mobile, aspect });
    const resolved = [];
    let carry = { ...DEFAULTS };
    for (const k of raw) {
      const s = sections.get(k.s);
      if (!s) continue;
      const y = s.top + (k.p ?? 0) * s.len + (k.vh ?? 0) * vh;
      const state = { ...carry };
      for (const key of KEYS) if (k[key] !== undefined) state[key] = k[key];
      if (mobile && k.m) for (const key of KEYS) if (k.m[key] !== undefined) state[key] = k.m[key];
      carry = { ...state };
      resolved.push({
        y, state, ease: EASES[k.ease] || EASES.inOut,
        look: k.look || null, lookMix: k.lookMix ?? 1, highlight: k.highlight ?? null,
      });
    }
    resolved.sort((a, b) => a.y - b.y);
    keys = resolved;
  }

  function rebuild() {
    measure();
    resolve();
  }

  // World-space target for a keyframe (anchors follow the parts, so resolve every frame).
  const v3 = { x: 0, y: 0, z: 0 };
  function anchorPos(names) {
    const list = Array.isArray(names) ? names : [names];
    let n = 0;
    v3.x = 0; v3.y = 0; v3.z = 0;
    for (const name of list) {
      const a = gen?.anchors?.[name];
      if (!a) continue;
      a.updateWorldMatrix(true, false);
      const e = a.matrixWorld.elements;
      v3.x += e[12]; v3.y += e[13]; v3.z += e[14];
      n++;
    }
    if (!n) return false;
    v3.x /= n; v3.y /= n; v3.z /= n;
    return true;
  }
  function keyTarget(k, out) {
    out[0] = k.state.tx; out[1] = k.state.ty; out[2] = k.state.tz;
    if (k.look && anchorPos(k.look)) {
      out[0] = lerp(out[0], v3.x, k.lookMix);
      out[1] = lerp(out[1], v3.y, k.lookMix);
      out[2] = lerp(out[2], v3.z, k.lookMix);
    }
    return out;
  }

  function sample(y) {
    if (!keys.length) return;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].y <= y) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, keys.length - 1)];
    let t = 0;
    if (b !== a && b.y > a.y) t = a.ease(clamp01((y - a.y) / (b.y - a.y)));
    if (y <= keys[0].y) t = 0;
    for (const key of KEYS) target[key] = lerp(a.state[key], b.state[key], t);
    keyTarget(a, tmpA);
    keyTarget(b, tmpB);
    target.tx = lerp(tmpA[0], tmpB[0], t);
    target.ty = lerp(tmpA[1], tmpB[1], t);
    target.tz = lerp(tmpA[2], tmpB[2], t);
    highlight = t < 0.5 ? a.highlight : b.highlight;
  }

  function sceneInfo(y) {
    let found = null;
    const mid = y + vh * 0.5;
    for (const s of sections.values()) {
      if (s.pinned) {
        if (y >= s.top - vh * 0.5 && y <= s.top + s.len + vh * 0.5) { found = s; break; }
      } else if (mid >= s.top && mid < s.top + s.height) {
        found = s;
      }
    }
    if (!found) return { scene: null, p: 0, step: -1, stepCount: 0, solid: false, pinned: false };
    const p = found.pinned ? clamp01((y - found.top) / found.len) : clamp01((mid - found.top) / found.height);
    const step = found.steps ? Math.min(found.steps - 1, Math.floor(p * found.steps)) : -1;
    // pinned: the sticky box is actually stuck (not entering or leaving the viewport)
    const pinned = found.pinned && y >= found.top - 1 && y <= found.top + found.len + 1;
    return { scene: found.id, p, step, stepCount: found.steps, solid: found.solid, pinned };
  }

  // Is any transparent scene section overlapping the viewport? If not, the canvas is covered.
  function canvasVisible(y) {
    for (const s of sections.values()) {
      if (s.solid) continue;
      if (s.top < y + vh && s.top + s.height > y) return true;
    }
    return false;
  }

  function onPointer(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (!reducedMotion && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', onPointer, { passive: true });
  }

  // Blended output state: the scroll state, optionally taken over by another mode
  // (overrides.takeover = { mix: 0..1, values: { az, el, dist, ..., key, rim, ... },
  // highlight }), e.g. the checkout. Keys missing in values keep their scroll value.
  const eff = { ...DEFAULTS };

  function update(dt, elapsed) {
    const y = window.scrollY;
    sample(y);
    info = sceneInfo(y);

    // Apply overrides (intro multipliers, demo engine run).
    const o = overrides;
    const d = Math.min(dt, 0.1);
    // snap (test param): no damping, so screenshots show the exact keyframe state.
    const k = first || reducedMotion || snap ? 1 : 1 - Math.exp(-d * 7);
    const kSlow = first || reducedMotion || snap ? 1 : 1 - Math.exp(-d * 4);
    for (const key of KEYS) {
      const smooth = CAMERA_KEYS.includes(key) ? k : kSlow;
      current[key] = lerp(current[key], target[key], smooth);
    }
    first = false;

    const tk = o.takeover;
    const tm = tk ? clamp01(tk.mix ?? 0) : 0;
    for (const key of KEYS) {
      const tv = tm > 0 ? tk.values?.[key] : undefined;
      eff[key] = tv === undefined ? current[key] : lerp(current[key], tv, tm);
    }

    // Subtle pointer parallax on the camera.
    pointer.sx = lerp(pointer.sx, pointer.x, 1 - Math.exp(-d * 3));
    pointer.sy = lerp(pointer.sy, pointer.y, 1 - Math.exp(-d * 3));

    const intro = o.intro ?? 1;
    const introLights = o.introLights ?? 1;
    // azAdd / elAdd / distAdd / fovAdd: extra camera offsets from interactions (touch swipe,
    // scroll velocity). ox / oy: absolute framing overrides (capture mode).
    const shot = {
      azimuth: eff.az + pointer.sx * 2.2 + (o.azAdd || 0),
      elevation: eff.el - pointer.sy * 1.2 + (o.elAdd || 0),
      distance: eff.dist + (1 - intro) * 1.4 + (o.distAdd || 0),
      target: [eff.tx, eff.ty, eff.tz],
      fov: eff.fov + (o.fovAdd || 0),
      offsetX: o.ox ?? eff.ox,
      offsetY: o.oy ?? eff.oy,
    };
    stage.setShot(shot);

    const running = Math.max(eff.running, o.running || 0);
    stage.set({
      key: eff.key * (o.introKey ?? introLights),
      rim: eff.rim * (o.introRim ?? introLights) * (1 + (o.rimBoost || 0)),
      fill: eff.fill * introLights,
      exposure: eff.exposure,
      bloom: eff.bloom * (1 + (o.bloomBoost || 0)),
      floor: eff.floor * introLights,
      grid: eff.grid,
      backdrop: eff.backdrop * (o.introBackdrop ?? 1),
      dust: reducedMotion ? 0 : eff.dust * introLights,
      beam: eff.beam * (o.introBeam ?? introLights),
      tint: eff.tint * (o.introTint ?? 1),
      blueprint: eff.stageBlueprint,
    });

    if (gen) {
      const takeoverHighlight = tm > 0.5 && tk.highlight !== undefined ? tk.highlight : undefined;
      gen.set({
        open: eff.open,
        explode: eff.explode,
        blueprint: eff.blueprint,
        dimensions: eff.dimensions,
        power: Math.max(eff.power, o.power || 0),
        running,
        highlight: takeoverHighlight !== undefined ? takeoverHighlight : o.highlight !== undefined ? o.highlight : highlight,
      });
      // Gentle turntable sway (reversible, no accumulated rotation) plus an optional
      // absolute extra rotation (overrides.rotY, radians) for interactive spins.
      const sway = reducedMotion ? 0 : eff.sway * Math.sin(elapsed * 0.35) * 0.45;
      gen.object.rotation.y = sway + (o.rotY || 0);
    }

    stage.setRendering(canvasVisible(y) || tm > 0.001);
  }

  rebuild();

  return {
    update,
    rebuild,
    get info() { return info; },
    get state() { return current; },
    get target() { return target; },
    get takeoverMix() { return overrides.takeover ? clamp01(overrides.takeover.mix ?? 0) : 0; },
    get sections() { return sections; },
    overrides,
    canvasVisible: () => canvasVisible(window.scrollY),
  };
}
