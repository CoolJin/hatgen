// Checkout 3D choreography. Drives the scroll director's takeover
// (director.overrides.takeover = { mix, values, highlight }): the mix tweens in on open and
// out on close, `values` holds one shot per step. The product turns on a turntable
// (overrides.rotY), rises onto a pallet and gets strapped for shipping, or stands on a
// marker ring and runs for a pickup; the order finale packs it into a crate.
// Works without WebGL too: every call is a no-op until the 3D scene exists.
import gsap from 'gsap';
import { get, on, set } from '../core/bus.js';
import { isStacked, reducedMotion } from '../core/env.js';
import { MODELS } from '../content/models.js';

const TAU = Math.PI * 2;
const SPIN_SPEED = TAU / 26; // rad/s turntable
const PALLET_H = 0.144;
const BASE_T = 0.018;
const HOVER = 0.3;

// Full studio look: every key of the director state, so nothing leaks in from the
// scroll position (an opened / exploded / blueprint unit closes up during the blend).
const LOOK = {
  az: 24, el: 9, dist: 3.3, tx: 0, ty: 0.42, tz: 0, fov: 30, ox: 0.22, oy: 0,
  open: 0, explode: 0, blueprint: 0, dimensions: 0, power: 0, running: 0, sway: 0,
  key: 1.05, rim: 1.05, fill: 1, exposure: 1, bloom: 1, floor: 1, grid: 0,
  backdrop: 0.5, dust: 0.5, beam: 0.75, tint: 1, stageBlueprint: 0,
};
const CAMERA = ['az', 'el', 'dist', 'tx', 'ty', 'tz', 'fov', 'ox', 'oy'];

export function createScene3D() {
  let scene = get('scene') || null;
  let props = null;
  let propsPromise = null;
  let open = false;
  let unsubFrame = null;
  let closing = null;

  // What the director reads (composed every frame from shot + fx).
  const values = { ...LOOK };
  const takeover = { mix: 0, values, highlight: null };
  // Tweened step shot.
  const shot = { ...LOOK };
  // Additive effects on top of the shot.
  const fx = { power: 0, running: 0, orbit: 0, flash: 0, kick: 0, lift: 0, bright: 0 };
  // Product / prop animation state.
  const A = { lift: 0, spin: 0, spinAmt: 0 };
  // Drag to rotate (pointer on the free 3D area): extra rotation on top of the turntable,
  // with inertia after release and a spring back to the front after a short pause.
  const drag = { user: 0, vel: 0, active: false, idle: 0, home: null };
  let mixTween = null;
  let shotTween = null;
  let propTl = null;
  let ringTween = null;
  let runTl = null;
  let pulseTl = null;
  let finaleTl = null;
  let spinTween = null;
  let current = { step: 0, delivery: 'versand', model: 's5500' };
  let deliveryShown = 'none'; // what the props currently show: 'none' | 'versand' | 'abholung'
  let finaleShown = false;

  on('scene', (s) => {
    scene = s;
  });

  const available = () => !!scene;

  // ---------------------------------------------------------------- layout
  function frameFor() {
    if (isStacked()) {
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      return { stacked: true, ox: 0, oy: -0.3, distMul: Math.min(2.2, Math.max(1.35, 1.12 / Math.max(0.3, aspect))) };
    }
    const panel = document.querySelector('.checkout .co-panel');
    const vw = window.innerWidth;
    // layout box (the entry animation transforms the panel)
    const right = panel && panel.offsetWidth ? panel.offsetLeft + panel.offsetWidth : vw * 0.4;
    const ox = Math.min(0.3, Math.max(0.18, (right / vw) * 0.5 + 0.03));
    // narrow landscape windows: pull back so the unit fits the free area
    const free = (vw - right) / vw;
    const distMul = 1 + Math.max(0, 0.6 - free) * 1.3;
    return { stacked: false, ox, oy: 0, distMul };
  }

  // Shot per step (desktop numbers; the stacked layout re-frames them).
  function shotFor({ step, delivery }) {
    const f = frameFor();
    const lifted = delivery === 'versand' && step >= 1;
    let s;
    if (step === 0) s = { az: 24, el: 9, dist: 3.45, ty: 0.42, sway: 0 };
    else if (step === 1) s = lifted ? { az: 30, el: 13, dist: 3.95, ty: 0.5, sway: 0.25 } : { az: 16, el: 17, dist: 4.0, ty: 0.34, sway: 0.2, beam: 0.9, key: 1.1 };
    else if (step === 2) s = { az: 36, el: 18, dist: 4.7, ty: lifted ? 0.52 : 0.4, sway: 0.3, key: 0.85, beam: 0.45, dust: 0.3, backdrop: 0.32, exposure: 0.94, rim: 0.95 };
    else if (step === 3) s = { az: -22, el: 11, dist: 4.05, ty: lifted ? 0.54 : 0.42, sway: 0.2, backdrop: 0.45 };
    else if (lifted) s = { az: 30, el: 14, dist: 4.4, ty: 0.6, sway: 0, key: 1.15, rim: 1.15, backdrop: 0.6, beam: 0.9 };
    else s = { az: 18, el: 9, dist: 4.0, ty: 0.4, sway: 0.15, power: 1, running: 1, key: 1.3, rim: 1.35, exposure: 1.1, beam: 1.2, bloom: 1.35, tint: 1.3, backdrop: 0.8, dust: 0.9 };
    const out = { ...LOOK, ...s, ox: f.ox, oy: f.oy };
    out.dist *= f.distMul;
    if (f.stacked) {
      out.el += 3;
      out.ty += 0.02;
    }
    return out;
  }

  // ---------------------------------------------------------------- frame loop
  function frame(dt, elapsed) {
    if (!scene) return;
    const o = scene.director.overrides;
    // compose the director values
    for (const k in shot) values[k] = shot[k];
    values.power = Math.max(shot.power, fx.power);
    values.running = Math.max(shot.running, fx.running);
    values.az = shot.az + fx.orbit;
    values.dist = shot.dist - fx.kick * 0.07;
    values.el = shot.el + fx.kick * 0.25;
    values.exposure = shot.exposure * (1 + fx.flash * 0.28 + fx.bright * 0.1);
    values.bloom = shot.bloom + fx.flash * 1.4;
    values.rim = shot.rim * (1 + fx.flash * 0.8);
    values.key = shot.key * (1 + fx.bright * 0.25);

    // turntable
    if (A.spinAmt > 0 && !reducedMotion) A.spin += dt * SPIN_SPEED * A.spinAmt;
    if (!drag.active && !drag.home) {
      if (Math.abs(drag.vel) > 0.01) {
        drag.user += drag.vel * dt;
        drag.vel *= Math.exp(-dt * 3.2);
      } else drag.vel = 0;
      // spring home once the user has let it rest for a moment (wall clock, not frames)
      if (drag.user !== 0 && Math.abs(drag.vel) < 0.15) {
        if (!drag.idle) drag.idle = performance.now();
        else if (performance.now() - drag.idle > 1600) springHome();
      } else drag.idle = 0;
    }
    o.rotY = A.spin + drag.user;
    // keep smooth scrolling parked while the dialog is open
    if (open && scene.lenis && !scene.lenis.isStopped) scene.lenis.stop();

    const gen = scene.gen;
    gen.object.position.y = A.lift;
    if (props) {
      props.state.spin = gen.object.rotation.y;
      props.update(dt, elapsed);
    }
  }

  function ensureLoop() {
    if (unsubFrame || !scene) return;
    unsubFrame = scene.stage.onFrame(frame);
  }

  async function loadProps() {
    if (props || !scene) return props;
    if (!propsPromise) {
      propsPromise = import('./props.js')
        .then(({ createProps }) => {
          props = createProps({ stage: scene.stage, quality: scene.stage.quality });
          scene.stage.add(props.root);
          props.warm?.();
          return props;
        })
        .catch((err) => {
          console.warn('[checkout] props failed', err);
          return null;
        });
    }
    return propsPromise;
  }

  // ---------------------------------------------------------------- open / close
  function openScene(state) {
    if (!scene) return;
    current = { ...current, ...state };
    const o = scene.director.overrides;
    closing?.kill();
    closing = null;
    open = true;
    finaleShown = false;
    // start the blend from the current scroll framing (no jump at mix 0)
    if (!o.takeover || o.takeover !== takeover) {
      Object.assign(shot, shotFor(current));
      takeover.mix = 0;
      A.spin = o.rotY || 0;
      A.lift = scene.gen.object.position.y || 0;
      o.takeover = takeover;
    }
    ensureLoop();
    mixTween?.kill();
    mixTween = gsap.to(takeover, { mix: 1, duration: reducedMotion ? 0.3 : 1.5, ease: 'power3.inOut' });
    loadProps().then(() => {
      if (!open || !props) return;
      props.setFrontStencil(MODELS[current.model] || MODELS.s5500);
      applyStep(current, { initial: true });
    });
    applyShot(current, true);
    setSpin(current.step === 0);
  }

  function closeScene() {
    if (!scene) return Promise.resolve();
    open = false;
    const o = scene.director.overrides;
    [shotTween, propTl, ringTween, runTl, pulseTl, finaleTl, spinTween].forEach((t) => t?.kill());
    mixTween?.kill();
    const dur = reducedMotion ? 0.3 : 1.15;
    return new Promise((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          if (o.takeover === takeover) delete o.takeover;
          o.rotY = 0;
          A.spin = 0;
          A.lift = 0;
          scene.gen.object.position.y = 0;
          Object.assign(fx, { power: 0, running: 0, orbit: 0, flash: 0, kick: 0, bright: 0 });
          props?.reset();
          deliveryShown = 'none';
          finaleShown = false;
          unsubFrame?.();
          unsubFrame = null;
          closing = null;
          resolve();
        },
      });
      closing = tl;
      tl.to(takeover, { mix: 0, duration: dur, ease: 'power3.inOut' }, 0);
      // turntable home: nearest full turn
      A.spinAmt = 0;
      // fold the user's drag into the turntable angle, then turn home the short way
      drag.home?.kill();
      drag.home = null;
      A.spin += drag.user;
      drag.user = 0;
      drag.vel = 0;
      drag.active = false;
      const home = Math.round(A.spin / TAU) * TAU;
      tl.to(A, { spin: home, duration: dur * 0.9, ease: 'power2.inOut' }, 0);
      // the orbit may stand anywhere (a full turn = 360): take the short way home
      fx.orbit = ((((fx.orbit + 180) % 360) + 360) % 360) - 180;
      tl.to(fx, { power: 0, running: 0, flash: 0, kick: 0, bright: 0, duration: 0.4 }, 0);
      tl.to(fx, { orbit: 0, duration: dur, ease: 'power3.inOut' }, 0);
      if (props && reducedMotion) {
        // no motion: props gone at once, unit back on the floor
        props.reset();
        A.lift = 0;
      } else if (props) {
        const s = props.state;
        // crate panels fly off, straps come off, pallet sinks, unit back on the floor
        const panelsOut = { front: 0, back: 0, left: 0, right: 0, lid: 0, base: 0, label: 0 };
        tl.to(s, { ...panelsOut, duration: reducedMotion ? 0.01 : 0.55, ease: 'power2.in', stagger: 0 }, 0);
        tl.to(s, { straps: 0, ring: 0, ringPulse: 0, duration: 0.35, ease: 'power1.in' }, 0);
        tl.to(s, { pallet: -0.17, duration: 0.6, ease: 'power2.in' }, 0.15);
      }
      tl.to(A, { lift: 0, duration: 0.6, ease: 'power2.inOut' }, 0.15);
    });
  }

  // ---------------------------------------------------------------- steps
  function applyShot(state, immediate = false) {
    const target = shotFor(state);
    shotTween?.kill();
    if (immediate || reducedMotion) {
      Object.assign(shot, target);
      return;
    }
    // camera keys glide, look keys follow a little slower
    shotTween = gsap.to(shot, { ...target, duration: 1.6, ease: 'power3.inOut', overwrite: false });
  }

  function setSpin(onOff) {
    spinTween?.kill();
    if (onOff && !reducedMotion) {
      spinTween = gsap.to(A, { spinAmt: 1, duration: 1.2, ease: 'power1.in' });
    } else {
      A.spinAmt = 0;
      // carry on to the next full turn so the front faces the camera again
      const next = Math.ceil((A.spin - 0.05) / TAU) * TAU;
      const d = next - A.spin;
      if (Math.abs(d) > 0.001) spinTween = gsap.to(A, { spin: next, duration: reducedMotion ? 0.01 : Math.min(2.2, 0.9 + d * 0.35), ease: 'power2.inOut' });
    }
  }

  // Props for a delivery mode: 'versand' (pallet + straps), 'abholung' (ring), 'none'.
  function showDelivery(mode, { initial = false } = {}) {
    if (!props) return;
    const s = props.state;
    if (mode === deliveryShown && !initial) return;
    const prev = deliveryShown;
    deliveryShown = mode;
    propTl?.kill();
    ringTween?.kill();
    const fast = reducedMotion;
    const tl = gsap.timeline();
    propTl = tl;
    ringTween = gsap.to(s, { ring: mode === 'abholung' ? 1 : 0, ringPulse: 0, duration: fast ? 0.01 : 0.9, ease: 'power2.out', delay: mode === 'abholung' && prev === 'versand' && !fast ? 0.9 : 0 });
    if (mode === 'versand') {
      s.strapFloor = PALLET_H;
      if (fast) {
        Object.assign(s, { pallet: 0, straps: 1, clipGlow: 0 });
        A.lift = PALLET_H;
        return;
      }
      const onPallet = s.pallet > -0.001 && Math.abs(A.lift - PALLET_H) < 0.002;
      let t = 0;
      if (!onPallet) {
        tl.to(A, { lift: HOVER, duration: 0.6, ease: 'power2.out' }, 0);
        tl.to(s, { pallet: 0, duration: 0.85, ease: 'power3.out' }, 0.15);
        tl.to(s, { clipGlow: 1, duration: 0.15 }, 0.15).to(s, { clipGlow: 0, duration: 0.6 }, 0.7);
        tl.to(A, { lift: PALLET_H, duration: 0.42, ease: 'power2.in' }, 0.85);
        tl.add(thunk, 1.27);
        tl.to(A, { lift: PALLET_H + 0.006, duration: 0.09, ease: 'power1.out' }, 1.27).to(A, { lift: PALLET_H, duration: 0.16, ease: 'power2.in' });
        t = 1.35;
      }
      tl.to(s, { straps: 1, duration: 1.15, ease: 'power2.inOut' }, t);
    } else {
      if (fast) {
        Object.assign(s, { pallet: -0.17, straps: 0, clipGlow: 0 });
        A.lift = 0;
      } else {
        let t = 0;
        if (s.straps > 0.001) {
          tl.to(s, { straps: 0, duration: 0.25 + s.straps * 0.3, ease: 'power2.in' }, 0);
          t = 0.45;
        }
        if (s.pallet > -0.16 || A.lift > 0.001) {
          tl.to(A, { lift: HOVER, duration: 0.5, ease: 'power2.out' }, t);
          tl.to(s, { pallet: -0.17, duration: 0.7, ease: 'power2.in' }, t + 0.12);
          tl.to(s, { clipGlow: 1, duration: 0.15 }, t + 0.12).to(s, { clipGlow: 0, duration: 0.5 }, t + 0.72);
          tl.to(A, { lift: 0, duration: 0.5, ease: 'power2.in' }, t + 0.7);
          tl.add(thunk, t + 1.2);
        }
      }
    }
  }

  // Short camera kick when something lands.
  function thunk(strength = 1) {
    if (reducedMotion) return;
    gsap.fromTo(fx, { kick: 0.6 * strength }, { kick: 0, duration: 0.5, ease: 'power3.out', overwrite: 'auto' });
  }

  // Demo run for the pickup ("Vorführung unter Last").
  function demoRun() {
    runTl?.kill();
    if (reducedMotion) return;
    runTl = gsap
      .timeline({ delay: 1.3 })
      .to(fx, { power: 1, duration: 0.25 })
      .to(fx, { running: 1, duration: 0.5, ease: 'power2.in' }, 0.7)
      .to(props?.state || {}, { ringPulse: 0.8, duration: 0.6 }, 0.7)
      .to(fx, { running: 0, duration: 0.8, ease: 'power2.out' }, 3.6)
      .to(props?.state || {}, { ringPulse: 0, duration: 1 }, 3.6)
      .to(fx, { power: 0, duration: 0.4 }, 4.6);
  }

  function applyStep(state, { initial = false } = {}) {
    const prev = current;
    current = { ...current, ...state };
    if (!scene || !open) return;
    applyShot(current, false);
    setSpin(current.step === 0);
    if (!props) return;
    if (current.step === 4) return; // the finale drives the props itself
    const mode = current.step === 0 ? 'none' : current.delivery;
    showDelivery(mode, { initial });
    if (mode === 'abholung' && (initial || prev.delivery !== 'abholung' || prev.step === 0) && current.step === 1) demoRun();
  }

  // Model switch: decal follows via the bus; pulse the display and bring the front round.
  function modelChanged(id) {
    current.model = id;
    if (!scene || !open) return;
    props?.setFrontStencil(MODELS[id] || MODELS.s5500);
    pulseTl?.kill();
    if (!reducedMotion) {
      pulseTl = gsap.timeline().to(fx, { power: 1, duration: 0.15 }).to(fx, { power: 0, duration: 0.4 }, 1.6);
      if (current.step === 0) {
        spinTween?.kill();
        A.spinAmt = 0;
        springHome(0.8);
        const next = Math.ceil((A.spin + 0.35) / TAU) * TAU;
        spinTween = gsap
          .timeline()
          .to(A, { spin: next, duration: Math.min(2, 0.7 + (next - A.spin) * 0.25), ease: 'power3.inOut' })
          .to(A, { spinAmt: 1, duration: 1.4, ease: 'power1.in' }, '+=1.6');
      }
    }
  }

  // ---------------------------------------------------------------- finale
  function finale({ delivery, orderNo, name, city, model, qty }) {
    current = { ...current, step: 4, delivery, model };
    if (!scene || !open) return;
    finaleShown = true;
    applyShot(current, false);
    setSpin(false);
    const go = () => {
      if (!props || !open) return;
      finaleTl?.kill();
      propTl?.kill();
      const m = MODELS[model] || MODELS.s5500;
      if (delivery === 'versand') crateFinale({ orderNo, name, city, m, qty });
      else pickupFinale();
    };
    if (props) go();
    else loadProps().then(go);
  }

  function crateFinale({ orderNo, name, city, m, qty }) {
    const s = props.state;
    props.setFrontStencil(m);
    props.setLabel({ orderNo, name, city, modelName: m.name, qty });
    ringTween?.kill();
    s.ring = 0;
    if (reducedMotion) {
      Object.assign(s, { pallet: 0, base: 1, front: 1, back: 1, left: 1, right: 1, lid: 1, label: 1, straps: 1, strapFloor: PALLET_H + BASE_T });
      A.lift = PALLET_H + BASE_T;
      return;
    }
    const tl = gsap.timeline();
    finaleTl = tl;
    // make sure it stands strapped on the pallet first
    if (s.pallet < -0.001 || Math.abs(A.lift - PALLET_H) > 0.003) {
      tl.to(A, { lift: HOVER + 0.02, duration: 0.45, ease: 'power2.out' }, 0);
      tl.to(s, { pallet: 0, duration: 0.6, ease: 'power3.out' }, 0.05);
    }
    // straps off, lift, crate floor slides in, set down, straps on again
    tl.to(s, { straps: 0, duration: 0.35, ease: 'power2.in' }, 0);
    tl.to(A, { lift: PALLET_H + 0.12, duration: 0.45, ease: 'power2.out' }, 0.3);
    tl.to(s, { base: 1, duration: 0.55, ease: 'power3.out' }, 0.55);
    tl.to(A, { lift: PALLET_H + BASE_T, duration: 0.32, ease: 'power2.in' }, 1.05);
    tl.add(() => thunk(0.8), 1.37);
    tl.set(s, { strapFloor: PALLET_H + BASE_T }, 1.2);
    tl.to(s, { straps: 1, duration: 0.6, ease: 'power2.inOut' }, 1.35);
    // walls fly in and lock
    const walls = [
      ['left', 1.75],
      ['right', 1.87],
      ['back', 1.99],
      ['front', 2.11],
    ];
    for (const [k, at] of walls) {
      tl.to(s, { [k]: 1, duration: 0.7, ease: 'power4.out' }, at);
      tl.add(() => thunk(0.35), at + 0.42);
    }
    tl.to(s, { lid: 1, duration: 0.62, ease: 'power3.in' }, 2.75);
    tl.add(() => thunk(1), 3.37);
    tl.fromTo(s, { crateKick: 1 }, { crateKick: 0, duration: 0.45, ease: 'elastic.out(1, 0.45)' }, 3.37);
    // label slap + sparks + light burst
    tl.to(s, { label: 1, duration: 0.26, ease: 'power4.in' }, 3.75);
    tl.to(s, { label: 1.3, duration: 0.07, ease: 'power1.out' }, 4.01).to(s, { label: 1, duration: 0.22, ease: 'power2.out' });
    tl.add(() => {
      props.burst();
      thunk(1.2);
    }, 4.01);
    tl.fromTo(s, { flash: 1 }, { flash: 0, duration: 0.7, ease: 'power2.out' }, 4.01);
    tl.fromTo(fx, { flash: 1 }, { flash: 0, duration: 1.1, ease: 'power2.out' }, 4.01);
    // one full orbit around the packed crate, then a slow idle sway
    tl.fromTo(fx, { orbit: 0 }, { orbit: 360, duration: 7.5, ease: 'power2.inOut' }, 4.35);
    tl.set(fx, { orbit: 0 });
    tl.to(fx, { orbit: 12, duration: 3, ease: 'sine.out' });
    tl.to(fx, { orbit: -12, duration: 6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }

  function pickupFinale() {
    const s = props.state;
    showDelivery('abholung');
    if (reducedMotion) {
      Object.assign(fx, { power: 1, running: 0, bright: 1 });
      s.ringPulse = 1;
      return;
    }
    const tl = gsap.timeline();
    finaleTl = tl;
    runTl?.kill();
    tl.to(fx, { power: 1, duration: 0.3 }, 0.2);
    tl.to(fx, { running: 1, duration: 0.6, ease: 'power2.in' }, 1.0);
    tl.to(fx, { bright: 1, duration: 1.4, ease: 'power2.out' }, 1.0);
    tl.to(s, { ringPulse: 1.2, duration: 0.8, ease: 'power2.out' }, 1.0);
    tl.fromTo(fx, { flash: 0.6 }, { flash: 0, duration: 1.2, ease: 'power2.out' }, 1.2);
    tl.add(() => thunk(0.5), 1.1);
    // slow orbit around the running unit
    tl.fromTo(fx, { orbit: 0 }, { orbit: -40, duration: 9, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 1.4);
  }

  // back to the nearest front-facing angle
  function springHome(duration = 1.1) {
    drag.home?.kill();
    drag.vel = 0;
    drag.idle = 0;
    const target = Math.round(drag.user / TAU) * TAU;
    if (Math.abs(target - drag.user) < 0.001) {
      A.spin += drag.user;
      drag.user = 0;
      return;
    }
    drag.home = gsap.to(drag, {
      user: target,
      duration: reducedMotion ? 0.01 : duration,
      ease: 'power3.inOut',
      onComplete: () => {
        A.spin += drag.user;
        drag.user = 0;
        drag.home = null;
      },
    });
  }

  function dragStart() {
    if (!scene || !open) return false;
    drag.home?.kill();
    drag.home = null;
    drag.active = true;
    drag.vel = 0;
    drag.idle = 0;
    return true;
  }
  // dx in CSS px since the last move
  function dragMove(dx) {
    if (!drag.active) return;
    drag.user += dx * (Math.PI / Math.max(360, window.innerWidth * 0.6));
  }
  // v in CSS px per second at release
  function dragEnd(v = 0) {
    if (!drag.active) return;
    drag.active = false;
    drag.idle = 0;
    drag.vel = reducedMotion ? 0 : Math.max(-9, Math.min(9, v * (Math.PI / Math.max(360, window.innerWidth * 0.6))));
  }

  function relayout() {
    if (!open || !scene) return;
    applyShot(current, reducedMotion);
  }

  return {
    available,
    open: openScene,
    close: closeScene,
    step: applyStep,
    modelChanged,
    finale,
    relayout,
    dragStart,
    dragMove,
    dragEnd,
    preload: loadProps,
    get finaleShown() {
      return finaleShown;
    },
    // debugging (?debug): live values
    debug: () => ({ values: { ...values }, fx: { ...fx }, A: { ...A }, drag: { user: drag.user, vel: drag.vel, active: drag.active }, rotY: scene?.director.overrides.rotY, mix: takeover.mix, props: props ? { ...props.state, drawCalls: props.drawCalls } : null }),
    setModel: (id) => set('model', id),
  };
}
