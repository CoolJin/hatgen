// Swipe to rotate (touch and pen): a horizontal drag turns the generator with the finger
// (director.overrides.rotY), keeps spinning with inertia after release and springs gently
// back to the front view after a pause. The direction is decided after LOCK_PX of travel:
// vertical drags are left to the native scroll (main has touch-action: pan-y), and a drag
// is dropped as soon as the page starts scrolling under it.
import { reducedMotion } from '../core/env.js';

const LOCK_PX = 8; // travel before the drag direction is decided
const H_BIAS = 1.15; // |dx| must exceed |dy| by this factor to count as horizontal
const TURN_PER_WIDTH = 3.6; // rad for a drag across the full viewport width (~206°)
const FOLLOW_TAU = 0.04; // s, light smoothing of sparse touchmove events
const FRICTION = 2.3; // 1/s, inertia decay after release
const MAX_SPIN = 11; // rad/s
const RETURN_AFTER = 1500; // ms without interaction before the spring back starts
const SPRING_W = 3.4; // rad/s natural frequency of the (critically damped) return spring
const SCROLL_ABORT = 10; // px of page scroll under a drag that hand it over to the scroll

// Anything the finger may want to operate instead of turning the product.
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'video', 'iframe',
  '[role="button"]', '[role="radio"]', '[role="radiogroup"]', '[role="slider"]', '[role="switch"]',
  '[role="checkbox"]', '[role="tab"]', '[role="dialog"]', '[aria-modal="true"]', '[contenteditable]',
  '[data-lenis-prevent]', '[data-no-swipe]', '#menu', '#header', '.sidenav',
].join(',');

export function createSwipe({ loop, getScene, blocked, onFirstUse }) {
  let angle = 0; // current extra rotation (rad)
  let target = 0; // finger target while dragging
  let vel = 0; // rad/s
  let phase = 'idle'; // idle | drag | coast | wait | spring
  let lastInteract = 0;
  let writing = false; // this module currently owns overrides.rotY
  const g = { id: null, state: 'none', x0: 0, y0: 0, base: 0, sy: 0, samples: [] };

  function canStart(target) {
    const scene = getScene();
    if (!scene?.director || blocked()) return false;
    if (!scene.director.canvasVisible()) return false;
    if (target?.closest?.(INTERACTIVE)) return false;
    return true;
  }

  function start(id, x, y, el, kind, count) {
    if (count > 1) {
      // second finger (pinch): drop the drag, the browser zooms
      if (g.state === 'drag') release(false);
      g.state = 'none';
      g.id = null;
      return;
    }
    if (!canStart(el)) {
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
    // a finger on the glass catches a spinning product
    if (phase === 'coast') {
      vel = 0;
      target = angle;
      phase = 'wait';
      lastInteract = performance.now();
      loop.wake();
    }
  }

  function move(id, x, y, time) {
    if (id !== g.id) return;
    if (g.state === 'pending') {
      const dx = x - g.x0;
      const dy = y - g.y0;
      if (Math.hypot(dx, dy) < LOCK_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * H_BIAS && Math.abs(window.scrollY - g.sy) < 2) {
        g.state = 'drag';
        g.base = angle;
        g.sy = window.scrollY;
        phase = 'drag';
        target = angle;
        vel = 0;
        writing = true;
        onFirstUse?.();
      } else {
        g.state = 'none'; // vertical: native scroll
        return;
      }
    }
    if (g.state !== 'drag') return;
    // the browser started scrolling under the drag after all: hand the gesture over
    if (Math.abs(window.scrollY - g.sy) > SCROLL_ABORT || blocked()) {
      release(false);
      return;
    }
    target = g.base + ((x - g.x0) / Math.max(320, window.innerWidth)) * TURN_PER_WIDTH;
    g.samples.push(time, target);
    // keep ~120 ms of samples for the release velocity
    while (g.samples.length > 4 && time - g.samples[0] > 120) g.samples.splice(0, 2);
    lastInteract = time;
    loop.wake();
  }

  function release(withInertia) {
    const s = g.samples;
    vel = 0;
    const now = performance.now();
    if (withInertia && !reducedMotion && s.length >= 4 && now - s[s.length - 2] < 80) {
      const dt = (s[s.length - 2] - s[0]) / 1000;
      if (dt > 0.01) vel = (s[s.length - 1] - s[1]) / dt;
      vel = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, vel));
    }
    angle = target;
    g.state = 'none';
    g.id = null;
    phase = Math.abs(vel) > 0.05 ? 'coast' : 'wait';
    lastInteract = now;
    loop.wake();
  }

  function end(id) {
    if (id !== g.id) return;
    if (g.state === 'drag') release(true);
    else {
      g.state = 'none';
      g.id = null;
    }
  }

  function nativeGesture() {
    if (g.state === 'pending') g.state = 'none';
  }

  // Another mode (checkout) takes the product over: stop at once and leave rotY to it.
  function handOver() {
    if (g.state === 'drag') g.state = 'none';
    g.id = null;
    angle = target = vel = 0;
    phase = 'idle';
    writing = false;
  }

  // Back from the takeover: if a rotation was left behind (ours or the other mode's), take it
  // over and spring it home, so the product never stays turned with nobody driving it.
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
    writing = true;
    phase = 'spring';
    loop.wake();
  }

  function write(director) {
    if (!director) return;
    if (writing) director.overrides.rotY = angle;
  }

  function update(dt, time) {
    if (phase === 'idle' || !writing) return false;
    const scene = getScene();
    if (!scene?.director) return false;
    if (phase === 'drag') {
      angle += (target - angle) * (1 - Math.exp(-dt / FOLLOW_TAU));
    } else if (phase === 'coast') {
      angle += vel * dt;
      vel *= Math.exp(-dt * FRICTION);
      if (Math.abs(vel) < 0.08) {
        vel = 0;
        phase = 'wait';
      }
      if (time - lastInteract > RETURN_AFTER) phase = 'spring';
    } else if (phase === 'wait') {
      if (time - lastInteract > RETURN_AFTER) {
        phase = 'spring';
      } else {
        write(scene.director);
        loop.wakeAt(lastInteract + RETURN_AFTER + 5);
        return false; // sleep until the spring is due
      }
    }
    if (phase === 'spring') {
      // back to the nearest front view (a whole turn is the same view)
      const rest = Math.round(angle / (Math.PI * 2)) * Math.PI * 2;
      const x = angle - rest;
      const w = SPRING_W;
      vel += (-w * w * x - 2 * w * vel) * dt;
      angle += vel * dt;
      if (Math.abs(angle - rest) < 0.0015 && Math.abs(vel) < 0.01) {
        angle = 0;
        vel = 0;
        phase = 'idle';
        write(scene.director);
        delete scene.director.overrides.rotY;
        writing = false;
        return false;
      }
    }
    write(scene.director);
    return true;
  }

  return {
    start, move, end, nativeGesture, handOver, resume, update,
    get angle() { return angle; },
    get phase() { return phase; },
  };
}
