// Scroll feel: the page reacts to scroll speed. The smoothed scroll velocity (window.scrollY
// deltas per frame) drives a slight camera warp (fovAdd), a tiny pull back (distAdd), a tilt
// in the scroll direction (elAdd) and a glow-up of the product (rimBoost / bloomBoost), plus a
// red "speed glow" at the screen edges. Stronger with touch input, subtle with mouse / wheel.
// Everything eases back to zero when the scrolling stops, and the loop then sleeps.
import { reducedMotion } from '../core/env.js';

const TELEPORT_VH = 0.8; // a jump larger than this in one frame ...
const TELEPORT_SPEED = 16; // ... and faster than this (viewport heights per second) is a teleport
const ATTACK = 0.06; // s, velocity smoothing while speeding up
const RELEASE = 0.3; // s, and while slowing down
const OUT_TAU = 0.1; // s, extra smoothing of the output intensity
const VREF = { touch: 2.1, desk: 3.2 }; // viewport heights per second for ~63 % intensity

// Maximum effect per input profile.
export const PROFILES = {
  touch: { fov: 3, dist: 0.035, el: 1.5, rim: 0.5, bloom: 0.5, glow: 0.7 },
  desk: { fov: 1.3, dist: 0.015, el: 0.6, rim: 0.22, bloom: 0.2, glow: 0.3 },
};
const KEYS = ['fovAdd', 'distAdd', 'elAdd', 'rimBoost', 'bloomBoost'];

export function createScrollFeel({ loop, getScene, suspended, isTouch }) {
  if (reducedMotion) return null;

  const root = document.createElement('div');
  root.className = 'fx-speed';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<i class="fx-speed__edge"></i><i class="fx-speed__lead fx-speed__lead--top"></i><i class="fx-speed__lead fx-speed__lead--bottom"></i>';
  document.body.appendChild(root);
  const [edge, top, bottom] = root.children;

  let y = window.scrollY;
  let lastY = y;
  let lastEvent = 0;
  let v = 0; // smoothed velocity, px/s (signed, + = scrolling down)
  let s = 0; // output intensity 0..1
  let dir = 0; // smoothed direction -1..1
  let glowOn = false;
  let skipUntil = 0;
  let lastNow = 0;
  const written = {}; // values this module last wrote into the overrides
  const shown = { e: -1, t: -1, b: -1, st: -1, sb: -1 };

  window.addEventListener(
    'scroll',
    () => {
      y = window.scrollY;
      lastEvent = performance.now();
      loop.wake();
    },
    { passive: true },
  );

  function setOpacity(node, k, v2) {
    if (Math.abs(shown[k] - v2) < 0.003) return;
    shown[k] = v2;
    node.style.opacity = v2.toFixed(3);
  }

  function setScale(node, k, v2) {
    if (Math.abs(shown[k] - v2) < 0.005) return;
    shown[k] = v2;
    node.style.transform = `scaleY(${v2.toFixed(3)})`;
  }

  function paintGlow(profile) {
    const on = s > 0.004;
    if (on !== glowOn) {
      glowOn = on;
      root.classList.toggle('is-on', on);
    }
    if (!on) return;
    const g = s * profile.glow;
    setOpacity(edge, 'e', g);
    setOpacity(top, 't', g * Math.max(0, -dir));
    setOpacity(bottom, 'b', g * Math.max(0, dir));
    const stretch = 0.55 + 0.75 * s;
    setScale(top, 'st', stretch);
    setScale(bottom, 'sb', stretch);
  }

  // Remove our offsets, but only where nobody else has written since (hand-over safe).
  function release(o) {
    if (!o) return;
    for (const k of KEYS) {
      if (k in written) {
        if (o[k] === written[k]) delete o[k];
        delete written[k];
      }
    }
  }

  function write(o, k, val) {
    const r = Math.round(val * 10000) / 10000;
    o[k] = r;
    written[k] = r;
  }

  // After a takeover (checkout) the page may be put back to its old position in one go.
  function resync() {
    y = lastY = window.scrollY;
    v = 0;
    skipUntil = performance.now() + 250;
  }

  function update(frameDt, now) {
    const scene = getScene();
    const director = scene?.director;
    const vh = window.innerHeight || 1;
    // Real frame time for the velocity (the loop's dt is capped for simulations, which would
    // overstate the speed on slow frames); smoothing uses it capped at 100 ms.
    const realDt = lastNow && now > lastNow ? Math.min((now - lastNow) / 1000, 0.5) : frameDt;
    lastNow = now;
    const dt = Math.min(Math.max(realDt, 1 / 240), 0.1);
    let dy = y - lastY;
    lastY = y;
    const off = suspended();
    const teleport = Math.abs(dy) > vh * TELEPORT_VH && Math.abs(dy) / Math.max(realDt, 1 / 240) > vh * TELEPORT_SPEED;
    if (teleport || now < skipUntil || off) dy = 0;
    const raw = dy / Math.max(realDt, 1 / 240);
    const tau = Math.abs(raw) > Math.abs(v) ? ATTACK : RELEASE;
    v += (raw - v) * (1 - Math.exp(-dt / tau));
    const touch = isTouch();
    const intensity = 1 - Math.exp(-Math.abs(v) / (vh * (touch ? VREF.touch : VREF.desk)));
    s += (intensity - s) * (1 - Math.exp(-dt / OUT_TAU));
    const d = Math.abs(v) > 30 ? Math.sign(v) : dir;
    dir += (d - dir) * (1 - Math.exp(-dt / 0.18));
    const profile = touch ? PROFILES.touch : PROFILES.desk;

    const settled = now - lastEvent > 150 && s < 0.006; // below anything visible
    if (settled || off) {
      v = 0;
      s = 0;
    }
    paintGlow(profile);

    if (director) {
      const o = director.overrides;
      if (off || settled) {
        release(o);
      } else {
        write(o, 'fovAdd', s * profile.fov);
        write(o, 'distAdd', s * profile.dist * (director.state?.dist || 3));
        write(o, 'elAdd', s * profile.el * dir);
        write(o, 'rimBoost', s * profile.rim);
        write(o, 'bloomBoost', s * profile.bloom);
      }
    }
    const busy = !settled && !off;
    if (!busy) lastNow = 0; // the next wake starts with a fresh frame time
    return busy;
  }

  return {
    update,
    resync,
    get state() {
      return { v: Math.round(v), s: +s.toFixed(3), dir: +dir.toFixed(2) };
    },
  };
}
