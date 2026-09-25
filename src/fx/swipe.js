// Swipe to rotate (touch and pen): a horizontal drag turns the generator with the finger
// (director.overrides.rotY) and keeps turning with a heavy inertia after release. A flick that
// would come to rest near a front view glides onto it (a cubic ease-out that starts at the
// release speed, so it never stops and starts again). Anywhere else the product stays where
// it came to rest and, after a pause, turns back the short way (never more than 180°) with a
// slow ease-in-out, at most RETURN_SPEED fast. The direction is decided after LOCK_PX of
// travel: vertical drags are left to the native scroll (main has touch-action: pan-y), and a
// drag is handed over to the scroll when the page scrolls clearly more than the finger moves
// sideways (iOS, where main stays touch-action: auto, see fx.css).
// Only where the product is actually on screen and near the finger. In close-up shots (the
// product fills more than the screen) the turn is a short rubber band without inertia, so the
// part the section talks about stays in frame. While the product is turned away from its
// front view the 3D callouts fade out (html.fx-turning). While a flat face of the unit turns
// into the mirror direction of a red rim light (the rims follow the camera, not the product),
// rimDim() reports how much to dim the rims (index.js writes overrides.rimBoost).
import { reducedMotion } from '../core/env.js';

const TAU = Math.PI * 2;
const LOCK_PX = 8; // travel before the drag direction is decided
const H_BIAS = 1.0; // |dx| > |dy|: same rail decision as the browser's pan-y
const TURN_PER_WIDTH = 3.6; // rad for a drag across the full viewport width (~206°)
const FOLLOW_TAU = 0.04; // s, light smoothing of sparse touchmove events
const FRICTION = 3.2; // 1/s, inertia decay after release (a heavy machine, not a fidget spinner)
const MAX_SPIN = 6; // rad/s, soft limit of the release velocity (tanh curve)
const LAND_RANGE = 1.22; // rad (70°): a flick coming to rest this close to a front view lands on it
const LAND_T = [0.35, 3]; // s, allowed duration of that glide (else a plain coast)
const RETURN_AFTER = 1500; // ms after the release before the product turns back on its own ...
const REST_MIN = 700; // ... and at least this long after it came to rest
const RETURN_SPEED = 1.6; // rad/s, peak speed of the automatic return (a 180° return: ~3 s)
const RETURN_T = [1.1, 3.2]; // s, duration range of the return
const ABORT_MIN = 28; // px of page scroll under a drag that always hand it over to the scroll ...
const ABORT_RATIO = 0.6; // ... or more than this share of the sideways travel
const CLOSE_LIMIT = 0.6; // rad, rubber band limit in close-up shots
const TURNING = 0.2; // rad away from the front view: callouts hide
const NEAR_VH = 0.25; // a swipe may start this far (viewport heights) above / below the product

// Anything the finger may want to operate instead of turning the product.
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'video', 'iframe',
  '[role="button"]', '[role="radio"]', '[role="radiogroup"]', '[role="slider"]', '[role="switch"]',
  '[role="checkbox"]', '[role="tab"]', '[role="dialog"]', '[aria-modal="true"]', '[contenteditable]',
  '[data-lenis-prevent]', '[data-no-swipe]', '#menu', '#header', '.sidenav',
].join(',');

const nearestRest = (a) => Math.round(a / TAU) * TAU;

// Screen box of the product (the closed housing's bounds, in its current pose) in CSS px.
const tmp = {};
function productBox(scene) {
  const b = scene.gen?.bounds;
  const m = scene.gen?.object?.matrixWorld?.elements;
  if (!b || !m || !scene.stage?.project) return null;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, behind: false };
  for (const x of [b.min.x, b.max.x]) {
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) {
        const p = scene.stage.project(
          [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]],
          tmp,
        );
        if (p.behind || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          box.behind = true;
          continue;
        }
        if (p.x < box.x0) box.x0 = p.x;
        if (p.x > box.x1) box.x1 = p.x;
        if (p.y < box.y0) box.y0 = p.y;
        if (p.y > box.y1) box.y1 = p.y;
      }
    }
  }
  return box;
}

// Rim glare. The two red rim spots stand behind the unit and turn with 80 % of the camera
// azimuth. A flat face whose normal points halfway between a rim and the camera mirrors that
// rim at the viewer: the black powder coat turns into a red slab. Half vectors (azimuth
// angles, radians): rimR at 77.5° + 0.9 az, rimL at -79.25° + 0.9 az (from lights.js); the
// front view itself is handled there (it pulls the camera side rim in), so the dim fades in
// over the first four degrees of a turn, where that no longer holds.
const DEG = Math.PI / 180;
const RIM_DIM = 0.92; // rimBoost at full glare (rims at 8 %)
const RIMS = [
  { h: 77.5 * DEG, w: 1 },
  { h: -79.25 * DEG, w: 0.75 }, // rimL: a little weaker
];
const wrapPi = (a) => a - TAU * Math.round(a / TAU);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// rot: the product's absolute rotation, az: camera azimuth (degrees). 0 (no glare) .. 1.
// The mirror angle lies at a grazing view (~75°), so every face the camera still sees counts.
export function rimGlare(rot, az) {
  const cam = az * DEG;
  let m = 0;
  for (const r of RIMS) {
    const h = r.h + 0.9 * cam;
    for (let k = 0; k < 4; k++) {
      const n = rot + (k * Math.PI) / 2; // front, right end, back, left end
      const lobe = 1 - smoothstep(8 * DEG, 26 * DEG, Math.abs(wrapPi(n - h)));
      if (lobe <= 0) continue;
      const seen = smoothstep(0.02, 0.2, Math.cos(n - cam));
      m = Math.max(m, lobe * seen * r.w);
    }
  }
  return m;
}

// rimBoost contribution for a turn `off` rad away from the nearest front view.
export function rimDimFor(off, rot, az) {
  return -RIM_DIM * smoothstep(0.005, 0.07, off) * rimGlare(rot, Number.isFinite(az) ? az : 0);
}

export function createSwipe({ loop, getScene, blocked, onFirstUse, onLock }) {
  const html = document.documentElement;
  let angle = 0; // current extra rotation (rad)
  let target = 0; // where the finger (or the coast) wants the product
  let vel = 0; // rad/s
  // idle | drag | coast | land | wait | return | hold (reduced motion)
  let phase = 'idle';
  let lastInteract = 0; // last touch / release (ms)
  let restedAt = 0; // when the product came to rest after a coast (ms)
  let writing = false; // this module currently owns overrides.rotY
  let close = false; // the current interaction is a close-up rubber band
  let turning = false;
  let holdY = 0;
  let rim = 0; // rimBoost contribution (<= 0): dims the rims while a face mirrors them
  // a timed move (land: cubic ease-out from the release speed; return: ease-in-out)
  const tw = { from: 0, to: 0, t0: 0, T: 1 };
  const g = { id: null, state: 'none', x0: 0, y0: 0, base: 0, rest: 0, sy: 0, close: false, samples: [] };

  function setTurning(on) {
    if (on === turning) return;
    turning = on;
    html.classList.toggle('fx-turning', on);
  }

  // May a drag starting here turn the product? Sets g.close for the drag.
  function canStart(el, y) {
    const scene = getScene();
    if (!scene?.director || blocked()) return false;
    if (!scene.director.canvasVisible()) return false;
    if (el?.closest?.(INTERACTIVE)) return false;
    g.close = false;
    let box = null;
    try {
      box = productBox(scene);
    } catch {
      box = null;
    }
    if (!box) return true; // no geometry info: the section check above has to do
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (box.behind) {
      // the camera is inside the bounds' reach: a close-up
      g.close = true;
      return true;
    }
    // at least a tenth of the screen shows the product ...
    if (box.x1 < w * 0.1 || box.x0 > w * 0.9 || box.y1 < h * 0.1 || box.y0 > h * 0.9) return false;
    // ... and the finger is near it (strokes over text far below keep scrolling)
    if (y < box.y0 - h * NEAR_VH || y > box.y1 + h * NEAR_VH) return false;
    g.close = box.x1 - box.x0 > w * 1.25 || box.y1 - box.y0 > h * 1.15;
    return true;
  }

  // The product stops where it is (a finger caught it, or it came to rest).
  function rest(time) {
    vel = 0;
    target = angle;
    phase = 'wait';
    restedAt = time;
    holdY = window.scrollY;
    loop.wake();
  }

  function start(id, x, y, el, kind, count, time = performance.now()) {
    if (count > 1) {
      // second finger (pinch): drop the drag, the browser zooms
      if (g.state === 'drag') release(false, time);
      g.state = 'none';
      g.id = null;
      return;
    }
    if (!canStart(el, y)) {
      g.state = 'none';
      g.id = null;
      return;
    }
    g.id = id;
    g.state = 'pending';
    g.x0 = x;
    g.y0 = y;
    g.sy = window.scrollY;
    g.samples.length = 0;
    // a finger on the glass catches a product that turns on its own
    if (phase === 'coast' || phase === 'land' || phase === 'return') {
      lastInteract = time;
      rest(time);
    }
  }

  function move(id, x, y, time, sy = window.scrollY) {
    if (id !== g.id) return;
    if (g.state === 'pending') {
      const dx = x - g.x0;
      const dy = y - g.y0;
      if (Math.hypot(dx, dy) < LOCK_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * H_BIAS && Math.abs(sy - g.sy) < 2) {
        g.state = 'drag';
        // start from where the product is now; the drag maps from the lock point on
        g.x0 = x;
        g.base = angle;
        g.rest = nearestRest(angle);
        g.sy = sy;
        close = g.close;
        phase = 'drag';
        target = angle;
        vel = 0;
        writing = true;
        onLock?.(id, x, y);
        onFirstUse?.();
      } else {
        g.state = 'none'; // vertical: native scroll
        return;
      }
    }
    if (g.state !== 'drag') return;
    // the page scrolls under the drag clearly more than the finger turns: hand it over
    const scrolled = Math.abs(sy - g.sy);
    if (scrolled > Math.max(ABORT_MIN, ABORT_RATIO * Math.abs(x - g.x0)) || blocked()) {
      release(false, time);
      return;
    }
    const raw = g.base + ((x - g.x0) / Math.max(320, window.innerWidth)) * TURN_PER_WIDTH;
    target = close ? g.rest + CLOSE_LIMIT * Math.tanh((raw - g.rest) / CLOSE_LIMIT) : raw;
    g.samples.push(time, raw);
    // keep ~120 ms of samples for the release velocity
    while (g.samples.length > 4 && time - g.samples[0] > 120) g.samples.splice(0, 2);
    lastInteract = time;
    loop.wake();
  }

  function release(withInertia, time = performance.now()) {
    const s = g.samples;
    let v = 0;
    if (withInertia && !close && !reducedMotion && s.length >= 4 && time - s[s.length - 2] < 80) {
      const dt = (s[s.length - 2] - s[0]) / 1000;
      if (dt > 0.01) {
        const raw = (s[s.length - 1] - s[1]) / dt;
        v = MAX_SPIN * Math.tanh(raw / MAX_SPIN); // speed still varies, but softly limited
      }
    }
    g.state = 'none';
    g.id = null;
    lastInteract = time;
    // no jump: the product keeps its current (smoothed) angle, the finger lag drains below
    if (Math.abs(v) <= 0.05) {
      rest(time);
      return;
    }
    vel = v;
    phase = 'coast';
    // Where would a plain coast come to rest? Near a front view: glide exactly onto it.
    const natural = target + v / FRICTION;
    const front = nearestRest(natural);
    const dist = front - angle;
    if (Math.abs(natural - front) < LAND_RANGE && Math.sign(dist) === Math.sign(v)) {
      const T = (3 * Math.abs(dist)) / Math.abs(v); // ease-out cubic: starts at the release speed
      if (T >= LAND_T[0] && T <= LAND_T[1]) {
        phase = 'land';
        tw.from = angle;
        tw.to = front;
        tw.t0 = time;
        tw.T = T;
      }
    }
    loop.wake();
  }

  function end(id, x, y, cancelled, time) {
    if (id !== g.id) return;
    if (g.state === 'drag') release(!cancelled, time);
    else {
      g.state = 'none';
      g.id = null;
    }
  }

  function nativeGesture() {
    if (g.state === 'pending') g.state = 'none';
  }

  function stop() {
    angle = target = vel = 0;
    phase = 'idle';
    writing = false;
    rim = 0;
    setTurning(false);
  }

  // Another mode (checkout) takes the product over: stop at once and leave rotY to it.
  function handOver() {
    if (g.state === 'drag') g.state = 'none';
    g.id = null;
    stop();
  }

  // Back from the takeover: if a rotation was left behind (ours or the other mode's), take it
  // over and turn it home, so the product never stays turned with nobody driving it.
  function resume() {
    const o = getScene()?.director?.overrides;
    if (!o || phase !== 'idle') return;
    const r = o.rotY || 0;
    if (Math.abs(r) < 0.001) {
      if ('rotY' in o) delete o.rotY;
      return;
    }
    angle = target = r;
    vel = 0;
    close = false;
    writing = true;
    beginReturn(performance.now());
    loop.wake();
  }

  // Back to the nearest front view, the short way (close-ups: where the drag started).
  function beginReturn(time) {
    vel = 0;
    if (reducedMotion) {
      // no automatic rotation: keep the pose until the page is scrolled (then it resets at once)
      phase = 'hold';
      return;
    }
    const to = close ? g.rest : nearestRest(angle);
    const d = Math.abs(to - angle);
    phase = 'return';
    tw.from = angle;
    tw.to = to;
    tw.t0 = time;
    // cosine ease-in-out: peak speed = pi / 2 * d / T
    tw.T = Math.min(RETURN_T[1], Math.max(RETURN_T[0], (Math.PI / 2) * (d / RETURN_SPEED)));
  }

  function finish(director) {
    angle = target = 0;
    vel = 0;
    phase = 'idle';
    writing = false;
    rim = 0;
    setTurning(false);
    if (director) delete director.overrides.rotY;
  }

  if (reducedMotion) {
    window.addEventListener(
      'scroll',
      () => {
        if ((phase === 'hold' || (phase === 'wait' && g.state !== 'drag')) && Math.abs(window.scrollY - holdY) > 40) {
          finish(getScene()?.director);
          loop.wake(); // lets index.js drop the rim dim too
        }
      },
      { passive: true },
    );
  }

  function write(scene) {
    const director = scene.director;
    if (!director || !writing) return;
    const prev = director.overrides.rotY || 0;
    director.overrides.rotY = angle;
    const off = Math.abs(angle - nearestRest(angle));
    setTurning(off > TURNING);
    // the director turns the product by sway + rotY: the real pose (sway from the last frame)
    const obj = scene.gen?.object;
    const rot = obj ? obj.rotation.y - prev + angle : angle;
    rim = rimDimFor(off, rot, director.state?.az);
  }

  function update(dt, time) {
    if (phase === 'idle' || !writing) return false;
    const scene = getScene();
    if (!scene?.director) return false;
    const follow = 1 - Math.exp(-dt / FOLLOW_TAU);
    if (phase === 'drag') {
      angle += (target - angle) * follow;
    } else if (phase === 'coast') {
      target += vel * dt;
      vel *= Math.exp(-dt * FRICTION);
      angle += (target - angle) * follow;
      if (Math.abs(vel) < 0.08) {
        vel = 0;
        phase = 'wait';
        restedAt = time;
      }
    } else if (phase === 'land' || phase === 'return') {
      const u = Math.min(1, (time - tw.t0) / 1000 / tw.T);
      const e = phase === 'land' ? 1 - (1 - u) * (1 - u) * (1 - u) : 0.5 - 0.5 * Math.cos(Math.PI * u);
      angle = target = tw.from + (tw.to - tw.from) * e;
      if (u >= 1) {
        finish(scene.director);
        return false;
      }
    } else if (phase === 'wait') {
      const due = Math.max(lastInteract + RETURN_AFTER, restedAt + REST_MIN);
      if (g.state === 'drag' || g.state === 'pending') {
        // a finger rests on the product: keep still
        if (Math.abs(target - angle) > 0.0005) angle += (target - angle) * follow;
      } else if (time >= due) {
        beginReturn(time);
      } else if (Math.abs(target - angle) > 0.0005) {
        angle += (target - angle) * follow; // drain the finger lag, no snap
      } else {
        angle = target;
        if (Math.abs(angle - nearestRest(angle)) < 0.0015) {
          finish(scene.director); // came to rest on a front view: nothing to return
          return false;
        }
        write(scene);
        loop.wakeAt(due + 5);
        return false; // sleep until the return is due
      }
    }
    if (phase === 'hold') {
      write(scene);
      return false; // sleeps until the next scroll (listener above) or touch
    }
    write(scene);
    return true;
  }

  return {
    start, move, end, nativeGesture, handOver, resume, update,
    get angle() { return angle; },
    get phase() { return phase; },
    get close() { return close; },
    get rim() { return rim; },
  };
}
