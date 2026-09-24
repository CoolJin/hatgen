// App bootstrap: UI, smooth scroll, 3D stage + generator, scroll director, intro.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { initUI } from './ui/index.js';
import { reducedMotion, probeWebGL, guessQuality, minTier } from './core/env.js';
import { on, emit, get, set } from './core/bus.js';
import { DEFAULT_MODEL } from './content/models.js';

gsap.registerPlugin(ScrollTrigger);

const html = document.documentElement;
html.classList.remove('no-js');
html.classList.add('js');

const params = new URLSearchParams(location.search);
const capture = params.get('capture'); // 'poster' | 'og': render only the 3D hero for static images
const debug = params.has('debug');
const forcedQuality = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : null;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// Start downloading the 3D modules (the largest part of the page) right away, in parallel
// with the UI setup, instead of after it.
const modules3d = Promise.all([
  import('./three/stage/index.js'),
  import('./three/generator/index.js'),
  import('./scroll/director.js'),
  import('./scroll/callouts.js'),
]);
modules3d.catch(() => {}); // handled in boot(); avoids an unhandled rejection on the no-WebGL path

const ui = initUI();

// Smooth scrolling (native scroll position, so sticky + ScrollTrigger keep working).
let lenis = null;
if (!reducedMotion && !capture) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95, touchMultiplier: 1.4 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis;
  lenis.stop();
}

// Keep ScrollTrigger (and the director, via its refresh listener) in sync with layout changes.
let refreshTimer = 0;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 150);
}
if ('ResizeObserver' in window) {
  let lastH = 0;
  new ResizeObserver(() => {
    const h = document.body.scrollHeight;
    if (Math.abs(h - lastH) > 2) {
      lastH = h;
      scheduleRefresh();
    }
  }).observe(document.body);
}

// A rendered frame, or 100 ms in a background tab (browsers pause requestAnimationFrame
// there, which would otherwise stall the boot until the tab is shown).
const nextFrame = () =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(t);
      resolve();
    });
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Deep link target. getElementById, not querySelector: hashes like #1 are no valid selectors.
function hashTarget() {
  const id = location.hash.slice(1);
  if (!id) return null;
  try {
    return document.getElementById(decodeURIComponent(id));
  } catch {
    return null;
  }
}

function jumpToHash() {
  const target = hashTarget();
  if (!target) return;
  if (lenis) lenis.scrollTo(target, { immediate: true, force: true });
  else target.scrollIntoView();
}

async function finishLoading(director, stage) {
  // The loader's failsafe may already have revealed the page while the 3D was still booting.
  const revealedEarly = ui.loader.done;
  ui.loader.setProgress(1);
  if (!revealedEarly) await wait(250);
  const hidden = ui.loader.hide();
  if (director) {
    if (reducedMotion) Object.assign(director.overrides, { intro: 1, introLights: 1 });
    // Lights come on as the curtain starts to lift (hide() resolves while it is still moving).
    else setTimeout(() => playIntro(director), revealedEarly ? 0 : 650);
  }
  await hidden;
  ui.playIntro?.();
  lenis?.start();
  // Do not yank a visitor who already started scrolling after an early reveal.
  if (!revealedEarly || window.scrollY < 2) jumpToHash();
  ScrollTrigger.refresh();
  // Measure real frame rates only once the intro has settled (adaptive: 'manual').
  if (stage) setTimeout(() => stage.startQualityProbe?.(), reducedMotion ? 500 : 3200);
}

// Dark, pulled-back starting point of the intro. Applied before the first rendered frame,
// so the curtain never reveals a lit product that then snaps dark.
const INTRO_START = { intro: 0, introLights: 0, introKey: 0, introRim: 0, introBackdrop: 0, introBeam: 0 };

// Pinned scenes are sized in vh, so after a rotation or a big window resize the same scrollY
// would land in another section. Remember section + progress before ScrollTrigger re-measures
// and return there afterwards. Small height changes (mobile URL bar) are ignored.
function keepReadingPosition(director) {
  let size = [window.innerWidth, window.innerHeight];
  let anchor = null;
  ScrollTrigger.addEventListener('refreshInit', () => {
    anchor = null;
    const [w, h] = size;
    if (window.innerWidth === w && Math.abs(window.innerHeight - h) < 150) return;
    const y = window.scrollY;
    if (y < 2) return;
    // director.sections still holds the measurements from before the resize
    for (const sec of director.sections.values()) {
      if (y >= sec.top && y < sec.top + sec.height) {
        anchor = { el: sec.el, f: (y - sec.top) / sec.height };
        break;
      }
    }
  });
  ScrollTrigger.addEventListener('refresh', () => {
    size = [window.innerWidth, window.innerHeight];
    if (anchor) {
      const { el, f } = anchor;
      anchor = null;
      const y = el.getBoundingClientRect().top + window.scrollY + f * el.offsetHeight;
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else window.scrollTo(0, y);
    }
    director.rebuild();
  });
}

// "Studio lights switch on" intro for the 3D scene.
function playIntro(director) {
  const o = director.overrides;
  Object.assign(o, INTRO_START);
  const tl = gsap.timeline({
    onComplete: () => {
      for (const k of ['introKey', 'introRim', 'introBackdrop', 'introBeam']) delete o[k];
      o.intro = 1;
      o.introLights = 1;
    },
  });
  tl.to(o, { intro: 1, duration: 2.6, ease: 'expo.out' }, 0)
    .to(o, { introRim: 1, duration: 0.06 }, 0.15)
    .to(o, { introRim: 0.15, duration: 0.06 }, 0.24)
    .to(o, { introRim: 1, duration: 0.5, ease: 'power2.out' }, 0.34)
    .to(o, { introKey: 1, duration: 1.4, ease: 'power2.out' }, 0.5)
    .to(o, { introBeam: 1, duration: 1.6, ease: 'power2.inOut' }, 0.6)
    .to(o, { introLights: 1, duration: 1.6, ease: 'power2.out' }, 0.5)
    .to(o, { introBackdrop: 1, duration: 1.8, ease: 'power2.out' }, 0.9);
  return tl;
}

// Demo run triggered by the "Probestart" button: preheat, crank, run, stop.
function setupEngineDemo(director) {
  const o = director.overrides;
  o.power = 0;
  o.running = 0;
  let tl = null;
  on('engine:start', () => {
    tl?.kill();
    tl = gsap.timeline({ onComplete: () => emit('engine:stop') });
    tl.to(o, { power: 1, duration: 0.25, ease: 'power1.out' })
      .to(o, { running: 1, duration: 0.5, ease: 'power2.in' }, 1.1)
      .to(o, { running: 0, duration: 0.9, ease: 'power2.out' }, 6.2)
      .to(o, { power: 0, duration: 0.4 }, 7.0);
  });
}

function setupDebug(director, stage) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,.7);padding:6px 8px;border-radius:6px;pointer-events:none;margin:0';
  document.body.appendChild(el);
  let frames = 0;
  let last = performance.now();
  let fps = 0;
  stage.onFrame(() => {
    frames++;
    const now = performance.now();
    if (now - last > 500) {
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
      const i = director.info;
      const s = director.state;
      el.textContent = `fps ${fps} q ${stage.quality}\nscene ${i.scene} p ${i.p.toFixed(3)} step ${i.step}\naz ${s.az.toFixed(1)} el ${s.el.toFixed(1)} d ${s.dist.toFixed(2)} open ${s.open.toFixed(2)} expl ${s.explode.toFixed(2)} bp ${s.blueprint.toFixed(2)}\ny ${Math.round(window.scrollY)}`;
    }
  });
}

const booted = { stage: null, started: false };

async function boot() {
  ui.loader.setProgress(0.04);
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();

  const gl = probeWebGL();
  if (!gl.ok) {
    html.classList.add('no-webgl');
    await fontsReady;
    await finishLoading(null);
    return;
  }

  const [{ createStage }, { createGeneratorAsync }, { createDirector }, { createCallouts }] = await modules3d;
  ui.loader.setProgress(0.3);
  await nextFrame();

  const canvas = document.getElementById('webgl');
  let stage;
  try {
    stage = createStage({
      canvas,
      // integrated / mobile GPUs start one tier lower instead of waiting for the FPS probe
      quality: forcedQuality || (capture ? 'high' : minTier(guessQuality(), gl.tier)),
      adaptive: forcedQuality || capture ? false : 'manual',
    });
  } catch (err) {
    console.warn('WebGL stage failed, using fallback.', err);
    html.classList.add('no-webgl');
    await finishLoading(null);
    return;
  }
  // Callout glass blur and other costly CSS only on the high tier.
  booted.stage = stage;
  const setTierClass = (q) => html.classList.toggle('q-high', q === 'high');
  setTierClass(stage.quality);
  stage.onQualityChange(setTierClass);
  ui.loader.setProgress(0.45);
  await nextFrame();

  // Built in frame-sized steps so the loader keeps animating.
  const gen = await createGeneratorAsync({
    renderer: stage.renderer,
    quality: stage.quality,
    onProgress: (f) => ui.loader.setProgress(0.45 + 0.17 * f),
  });
  stage.add(gen.object);
  gen.set({ model: get('model', DEFAULT_MODEL) });
  on('model', (id) => gen.set({ model: id }));
  ui.loader.setProgress(0.62);
  await nextFrame();

  await fontsReady;
  ui.refresh?.();
  const director = createDirector({ stage, gen, snap: params.has('snap') });
  keepReadingPosition(director);
  const callouts = capture ? { update() {} } : createCallouts({ stage, gen, director });
  setupEngineDemo(director);
  // Other modules (checkout, touch effects) reach the 3D scene through the bus.
  set('scene', { stage, gen, director, lenis });

  if (capture) {
    html.classList.add('capture');
    const style = document.createElement('style');
    style.textContent = 'html.capture body > *:not(#webgl){display:none!important} html.capture #webgl{opacity:1!important;visibility:visible!important}';
    document.head.appendChild(style);
    Object.assign(director.overrides, { intro: 1, introLights: 1 });
    if (capture === 'og') Object.assign(director.overrides, { azAdd: -8, ox: 0, oy: -0.02 });
  }

  if (!capture && !reducedMotion) Object.assign(director.overrides, INTRO_START);

  stage.onFrame((dt, elapsed) => {
    director.update(dt, elapsed);
    gen.update(dt, elapsed);
    callouts.update();
  });
  if (debug) setupDebug(director, stage);

  ui.loader.setProgress(0.75);
  director.update(0, 0);
  gen.prepare?.(); // builds the blueprint edge lines in idle slices (non-blocking)
  try {
    await stage.compile();
  } catch (err) {
    console.warn('Shader precompile failed', err);
  }
  ui.loader.setProgress(0.92);
  stage.start();
  booted.started = true;
  await nextFrame();
  await nextFrame();

  if (capture) {
    ui.loader.hide?.();
    html.classList.add('capture-ready');
    return;
  }
  await finishLoading(director, stage);
}

boot().catch((err) => {
  console.error(err);
  // Only fall back to the poster when the 3D never came up; a late error (e.g. in the
  // reveal) must not hide a working canvas.
  if (!booted.started) {
    booted.stage?.stop();
    html.classList.add('no-webgl');
  }
  ui.loader.hide?.();
  lenis?.start();
});
