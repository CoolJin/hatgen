// Touch and scroll feel effects (see SPEC2, "FX agent").
//   finger.js      electric finger FX on a fixed overlay canvas (touch and pen)
//   swipe.js       horizontal swipe turns the generator (overrides.rotY), inertia, gentle return
//   scrollfeel.js  scroll velocity -> camera warp / tilt / glow-up + red edge "speed glow"
//   haptics.js     short vibration ticks on scene steps and model changes (Android)
//   hint.js        one-time "Wischen zum Drehen" hint in the hero on phones
// All of them share one requestAnimationFrame loop that sleeps while nothing moves, all input
// listeners are passive, and the 3D is only touched through director.overrides once the bus
// has delivered the scene ('scene' is never set without WebGL: then only the 2D parts run).
import { on, get } from '../core/bus.js';
import { coarsePointer } from '../core/env.js';
import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { createFinger } from './finger.js';
import { createSwipe, rimDimFor } from './swipe.js';
import { createScrollFeel } from './scrollfeel.js';
import { createHaptics } from './haptics.js';
import { createHint } from './hint.js';

let instance = null;

export function initFx() {
  if (instance) return instance;
  const params = new URLSearchParams(location.search);
  if (params.has('capture')) return null; // static image capture: no overlays

  const html = document.documentElement;
  const loop = createLoop();

  let scene = get('scene', null);
  const getScene = () => scene;

  // Input profile: touch until a mouse / wheel shows up (and back on the next touch).
  let touchMode = coarsePointer;
  const isTouch = () => touchMode;

  // Another mode drives the product (the checkout's takeover): hands off the 3D overrides.
  let checkoutOpen = false;
  let closingUntil = 0;
  const takenOver = () => {
    if (checkoutOpen) return true;
    const director = scene?.director;
    if (!director) return false;
    if ((director.takeoverMix || 0) > 0.001) return true;
    // after closing, the checkout still drives the product until it removes its takeover
    return !!director.overrides.takeover && performance.now() < closingUntil;
  };
  // Something covers the page (checkout, mobile menu): no finger FX, no new swipes.
  const modal = () => takenOver() || html.classList.contains('menu-open');

  // Fingers on the glass, and when the last one lifted (a fling keeps scrolling after that).
  const down = new Set();
  let lastUp = -1e9;
  const FLING_MS = 2000;
  const fingerScroll = () => down.size > 0 || performance.now() - lastUp < FLING_MS;

  const finger = createFinger({ loop, enabled: () => !modal() });
  const hint = createHint({ getScene, suspended: modal });
  const swipe = createSwipe({
    loop,
    getScene,
    blocked: modal,
    onFirstUse: () => hint.used(),
    // the drag turns the product from here on: the full touch show at the finger
    onLock: (id, x, y) => finger?.lock(id, x, y),
  });
  const feel = createScrollFeel({ loop, getScene, suspended: takenOver, isTouch });
  const haptics = createHaptics({
    getScene,
    isTouch,
    fingerScroll,
    speed: () => (feel ? Math.abs(feel.v) / (window.innerHeight || 1) : 0), // viewport heights / s
  });

  // overrides.rimBoost has two writers: the scroll feel's glow-up and the swipe's rim dim (a
  // turned face would mirror the red rims). Summed and written once per frame; only removed
  // while it still holds our own value (hand-over safe).
  let taken = false;
  let rimWritten = null;
  function applyRim() {
    const o = scene?.director?.overrides;
    if (!o) return;
    const v = taken ? 0 : (feel?.rim || 0) + swipe.rim;
    if (Math.abs(v) < 1e-4) {
      if (rimWritten !== null && o.rimBoost === rimWritten) delete o.rimBoost;
      rimWritten = null;
      return;
    }
    const r = Math.round(Math.max(-0.9, v) * 10000) / 10000;
    o.rimBoost = r;
    rimWritten = r;
  }

  function syncTakeover() {
    const now = takenOver();
    if (now && !taken) {
      taken = true;
      swipe.handOver();
      applyRim();
    } else if (!now && taken) {
      taken = false;
      feel?.resync();
      swipe.resume();
    }
    return taken;
  }

  createInput({
    start(id, x, y, target, kind, count, time) {
      touchMode = true;
      if (count === 1) down.clear(); // a lost touchend never keeps a finger down
      down.add(id);
      syncTakeover();
      const sy = window.scrollY;
      finger?.start(id, x, y, kind, time, sy);
      swipe.start(id, x, y, target, kind, count, time);
    },
    move(id, x, y, time) {
      const sy = window.scrollY;
      finger?.move(id, x, y, time, sy);
      swipe.move(id, x, y, time, sy);
    },
    end(id, x, y, cancelled, time) {
      if (down.delete(id)) lastUp = performance.now();
      finger?.end(id, x, y, cancelled, time);
      swipe.end(id, x, y, cancelled, time);
    },
    nativeGesture() {
      swipe.nativeGesture();
      finger?.native();
    },
    mouse() {
      touchMode = false;
    },
  });

  // Loop tasks. Each returns true while it needs another frame.
  loop.add(() => {
    haptics.watch(); // piggybacks on frames the other tasks request (scrolling)
    // keep polling while a takeover fades out after the checkout has closed
    return syncTakeover() && !checkoutOpen;
  });
  if (finger) loop.add(finger.update);
  loop.add(swipe.update);
  if (feel) loop.add(feel.update);
  loop.add(() => {
    applyRim(); // after the swipe and the scroll feel have updated their shares
    return false;
  });

  on('model', () => haptics.tick());
  on('checkout:open', () => {
    checkoutOpen = true;
    syncTakeover();
    finger?.reset();
  });
  on('checkout:close', () => {
    checkoutOpen = false;
    closingUntil = performance.now() + 5000;
    loop.wake();
  });
  // The 3D is up: horizontal drags on the page may turn the product from now on.
  const onScene = (s) => {
    scene = s;
    html.classList.add('fx-swipe');
    hint.arm();
  };
  if (scene) onScene(scene);
  else on('scene', onScene);

  if (params.has('debug') || params.has('fxdebug')) {
    window.__fx = {
      state: () => {
        const o = scene?.director?.overrides || {};
        const r = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);
        return {
          touch: touchMode,
          loop: loop.running,
          swipe: { phase: swipe.phase, angle: r(swipe.angle), close: swipe.close },
          turning: html.classList.contains('fx-turning'),
          feel: feel?.state,
          hint: hint.state,
          o: { rotY: r(o.rotY), fovAdd: r(o.fovAdd), distAdd: r(o.distAdd), elAdd: r(o.elAdd), rimBoost: r(o.rimBoost), bloomBoost: r(o.bloomBoost) },
          canvas: !!finger?.canvas.classList.contains('is-on'),
        };
      },
      // rim dim the swipe would apply at this absolute rotation (harness sweeps)
      rimDim: (rot) => {
        const off = Math.abs(rot - Math.round(rot / (Math.PI * 2)) * Math.PI * 2);
        return -rimDimFor(off, rot, scene?.director?.state?.az);
      },
    };
  }

  instance = { loop, finger, swipe, feel, haptics, hint };
  return instance;
}
