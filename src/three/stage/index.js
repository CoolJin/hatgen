// HATGEN rendering stage: renderer, camera rig, studio lighting, environment,
// floor + contact shadow, atmosphere (backdrop word, beam, dust), post-processing,
// adaptive quality and the render loop.
//
//   const stage = createStage({ canvas, quality: 'high' });
//   stage.add(generator.object);
//   stage.setShot({ azimuth: 25, elevation: 10, distance: 3.2, target: [0, 0.42, 0], fov: 35, offsetX: 0.18 });
//   stage.set({ key: 1, rim: 1, blueprint: 0 });
//   stage.onFrame((dt, t) => generator.update(dt, t));
//   await stage.compile(); stage.start();
//
// Adaptive quality: createStage({ adaptive: true }) starts measuring by itself after
// ~4.5 s of rendering; createStage({ adaptive: 'manual' }) waits for
// stage.startQualityProbe() (call it once the hero intro has finished). Afterwards a
// rolling watch covers the heavy scenes; stage.evaluateQuality() asks for a fresh
// window (e.g. when entering a heavy scene).
import {
  Group,
  Matrix4,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Pass } from 'postprocessing';
import { createShotRig, DEFAULT_SHOT } from './shot.js';
import { createBackground } from './background.js';
import { createLights, TOP_ANGLE, TOP_POSITION, TOP_TARGET } from './lights.js';
import { createContactShadow } from './contactShadow.js';
import { createFloor } from './floor.js';
import { createBackdrop } from './backdrop.js';
import { createBeam } from './beam.js';
import { createDust } from './dust.js';
import { createEnvironmentTexture } from './environment.js';
import { createPipeline, loadAO, aoReady } from './pipeline.js';
import { createReflection } from './reflection.js';
import { TIER_CONFIG, TIERS, createFpsProbe, lowerTier, normalizeTier, tierPixelRatio } from './quality.js';
import { STAGE_PRESETS, mixParams } from './presets.js';

export { TIERS, TIER_CONFIG, DEFAULT_SHOT, STAGE_PRESETS, mixParams };

export const DEFAULT_PARAMS = Object.freeze({
  // (see presets.js BASE_PARAMS for the meaning of the backdrop framing params)
  key: 1,
  rim: 1,
  fill: 1,
  exposure: 1,
  bloom: 1,
  vignette: 1,
  floor: 1,
  grid: 0,
  backdrop: 1,
  backdropText: 'HATGEN',
  dust: 1,
  beam: 1,
  tint: 1,
  blueprint: 0,
  env: 1,
  reflection: 1,
  backdropFit: 1,
  backdropX: 0,
  backdropY: 0,
  backdropScale: 1,
});

// Product motion below these deltas (per mesh, since the last shadow bake) does not
// refresh shadow maps / contact bake / reflection: the running engine's sub-millimetre
// vibration never crosses them, real part motion (open, explode, turntable) does.
const MOTION_POS = 0.004; // m
const MOTION_ROT = 0.01; // ~rad (rotation matrix element delta)
// Frames after the last detected motion during which the "moving" cadence applies.
const MOVING_HOLD = 20;

// Idle throttle: once camera, stage params and product pose have not changed for
// IDLE_AFTER s, display frames closer than IDLE_INTERVAL to the previous one are skipped,
// so 120 Hz+ displays render the still scene (only ambient dust / beam / engine motion)
// at about 60 fps. Anything moving renders at the full display rate.
const IDLE_AFTER = 0.5; // s
const IDLE_INTERVAL = 1 / 80; // s (60 Hz frames, 16.7 ms, never fall below it)
const CAMERA_EPS = 1e-5;

// Glossy floor reflection strength at reflection = 1 (Fresnel weighted in the shader).
const REFLECTION_BASE = 1.25;

const ENV_BASE = 0.85;
// World point the background glow is centred on (a little behind and above the unit).
const GLOW_ANCHOR = new Vector3(0, 0.6, -0.45);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createStage({
  canvas,
  quality = 'high',
  adaptive = true,
  toneMapping = 'neutral',
  environment = 'studio',
  pixelRatio = null,
} = {}) {
  if (!canvas) throw new Error('createStage: canvas is required');
  ensureCanvasSized(canvas);

  // ---------------------------------------------------------------- renderer
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // tone mapping happens in the post chain
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap; // soft via shadow.radius (vogel disk)
  renderer.setClearColor(0x0a0202, 1);
  // The composer renders several times per frame; count the whole frame instead.
  renderer.info.autoReset = false;

  const scene = new Scene();
  scene.name = 'stage';
  // Several passes render the scene per frame (main, reflection, contact bake); world
  // matrices are updated once per frame in renderFrame() instead of in every pass.
  scene.matrixWorldAutoUpdate = false;
  const camera = new PerspectiveCamera(DEFAULT_SHOT.fov, 1, 0.05, 80);
  const rig = createShotRig(camera);

  // Product content lives in its own group (it casts the contact shadow).
  const content = new Group();
  content.name = 'stage:content';
  scene.add(content);

  // Stage decoration (hidden while baking the contact shadow).
  const decor = new Group();
  decor.name = 'stage:decor';
  scene.add(decor);

  const background = createBackground({ toneMapping });
  decor.add(background.mesh);

  const lights = createLights();
  scene.add(lights.group);

  let tierName = normalizeTier(quality);
  let cfg = TIER_CONFIG[tierName];

  const contact = createContactShadow(renderer, { size: 2.6, maxHeight: 0.9, res: cfg.contactRes });
  const reflection = createReflection(renderer, { scale: cfg.reflection || 0.38 });
  const floor = createFloor({
    contactTexture: contact.texture,
    contactWideTexture: contact.wideTexture,
    contactSize: contact.size,
    reflectionTexture: reflection.texture,
    reflectionMatrix: reflection.textureMatrix,
    rimForward: lights.rimForward,
    toneMapping,
  });
  decor.add(floor.mesh);

  const backdrop = createBackdrop({ renderer, text: DEFAULT_PARAMS.backdropText });
  decor.add(backdrop.mesh);

  const beam = createBeam({ apex: TOP_POSITION, target: TOP_TARGET, angle: TOP_ANGLE });
  decor.add(beam.mesh);

  const dust = createDust({ max: TIER_CONFIG.high.dust, apex: TOP_POSITION, target: TOP_TARGET, angle: TOP_ANGLE });
  decor.add(dust.points);

  let envMode = environment;
  let envRT = createEnvironmentTexture(renderer, envMode);
  scene.environment = envRT.texture;
  scene.environmentIntensity = ENV_BASE;

  // ---------------------------------------------------------------- state
  const params = { ...DEFAULT_PARAMS };
  let pipeline = null;
  let toneMappingMode = toneMapping;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let rendering = true;
  let running = false;
  let contextLost = false;
  let rafId = 0;
  let last = 0;
  let elapsed = 0;
  let frame = 0;
  let contactDirty = true;
  let shadowDirty = true;
  let productVersion = 0;
  let lastMotionFrame = -1e9;
  let lastFps = null;
  let bufW = 0;
  let bufH = 0;
  let frameH = 1;
  // Bake scheduling (see renderFrame): frame of each bake's last refresh.
  const bakeLast = { shadow: -1e9, contact: -1e9, reflection: -1e9 };
  let contactValid = false;
  // Idle throttle state (loop clock, s).
  let lastActive = 0;
  let throttled = false;
  const lastCamWorld = new Matrix4();
  const lastCamProj = new Matrix4();
  const markActive = () => {
    lastActive = performance.now() * 0.001;
  };
  let pendingPipeline = null;
  let swapToken = 0;
  // Cumulative counters (debugging / perf checks): frames rendered and bake refreshes.
  const stats = { frames: 0, shadowBakes: 0, contactBakes: 0, reflectionRenders: 0 };
  const frameFns = new Set();
  const qualityFns = new Set();
  const erroredFns = new WeakSet();
  const tmp = new Vector3();

  // ---------------------------------------------------------------- sizing
  // Shots are composed in the small viewport box (100svh, the height of the page's pinned
  // scenes and hero). On mobile the canvas is taller (100lvh, so URL-bar show / hide does
  // not resize it); fov and offsets then refer to the top 100svh of the canvas, and the
  // product stays where the layout expects it with the bars shown or hidden.
  const svhProbe = createSvhProbe();
  function measure() {
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width) || window.innerWidth || 1;
    const h = Math.round(r.height) || window.innerHeight || 1;
    const svh = svhProbe ? Math.round(svhProbe.getBoundingClientRect().height) : 0;
    return [w, h, svh > 0 ? Math.min(h, svh) : h];
  }

  // Cheap part of a resize: camera aspect / view offset and projection size follow the
  // CSS box immediately. Rendering with the new aspect into the old-size buffer (which
  // CSS stretches to the new box) keeps proportions right until the buffers follow.
  function updateViewport(w, h, fh = h) {
    if (w === width && h === height && fh === frameH) return;
    width = w;
    height = h;
    frameH = fh;
    rig.setViewport(w, h, fh);
    background.setAspect(w / h);
    markActive();
  }

  function resize(force = false) {
    const [w, h, fh] = measure();
    const deviceRatio = window.devicePixelRatio || 1;
    const nextDpr = pixelRatio ?? tierPixelRatio(cfg, w, h, deviceRatio);
    // Mobile URL-bar show / hide fires resize events without changing the canvas box.
    if (!force && pipeline && w === bufW && h === bufH && nextDpr === dpr) {
      updateViewport(w, h, fh);
      return;
    }
    updateViewport(w, h, fh);
    bufW = w;
    bufH = h;
    dpr = nextDpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    pipeline?.setSize(w, h);
    reflection.setSize(w * dpr, h * dpr);
    dust.setViewport(fh * dpr, camera.fov);
  }

  let resizeTimer = 0;
  const scheduleResize = () => {
    const [w, h, fh] = measure();
    updateViewport(w, h, fh);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resize(), 60);
  };
  window.addEventListener('resize', scheduleResize, { passive: true });
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    let first = true;
    ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      scheduleResize();
    });
    ro.observe(canvas);
  }
  // Device pixel ratio changes (moving the window between screens, browser zoom).
  let dprQuery = null;
  const onDprChange = () => {
    scheduleResize();
    watchDpr();
  };
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDprChange);
    if (!window.matchMedia) return;
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener?.('change', onDprChange);
  }
  watchDpr();

  // ---------------------------------------------------------------- quality
  // prebuilt: a pipeline already created (and warmed) for cfg. disposeOld = false after
  // a context loss: the old chain's GL objects belong to the dead context.
  function buildPipeline({ prebuilt = null, disposeOld = true } = {}) {
    if (disposeOld) pipeline?.dispose();
    pipeline = null;
    resize(true);
    pipeline = prebuilt ?? createPipeline({ renderer, scene, camera, tier: cfg, toneMapping: toneMappingMode });
    pipeline.setSize(width, height);
    lights.setShadowQuality(cfg);
    contact.setResolution(cfg.contactRes);
    if (cfg.reflection) {
      reflection.setScale(cfg.reflection);
      reflection.setSize(width * dpr, height * dpr);
    }
    dust.setCount(cfg.dust);
    applyParams();
    contactDirty = true;
    contactValid = false;
    shadowDirty = true;
    markActive();
  }

  function notifyQuality(q, reason) {
    qualityFns.forEach((fn) => {
      try {
        fn(q, reason);
      } catch (e) {
        console.error('[stage] onQualityChange listener failed', e);
      }
    });
  }

  // Manual switches apply immediately. Automatic drops (mid-scroll) first build and
  // pre-compile the new post chain in the background while the old one keeps
  // rendering, then swap, so the switch does not hitch. The scene materials keep
  // their programs across tiers (same lights, same shadow type).
  function setQuality(next, reason = 'manual', { warm = reason === 'auto' } = {}) {
    const q = normalizeTier(next);
    if (q === tierName && pipeline && !pendingPipeline) return tierName;
    const token = ++swapToken;
    pendingPipeline?.dispose();
    pendingPipeline = null;
    tierName = q;
    const nextCfg = TIER_CONFIG[q];
    const finish = (prebuilt) => {
      cfg = nextCfg;
      buildPipeline({ prebuilt });
      probe?.restartWarmup();
      if (!lowerTier(q)) probe?.stop();
      notifyQuality(q, reason);
    };
    if (!warm || !pipeline || contextLost) {
      finish(null);
      return tierName;
    }
    const candidate = createPipeline({ renderer, scene, camera, tier: nextCfg, toneMapping: toneMappingMode });
    pendingPipeline = candidate;
    const timeout = new Promise((r) => setTimeout(r, 2500));
    Promise.race([candidate.warm().catch(() => {}), timeout]).then(() => {
      if (token !== swapToken || pendingPipeline !== candidate) return; // superseded
      pendingPipeline = null;
      if (contextLost) {
        finish(null);
        return;
      }
      finish(candidate);
    });
    return tierName;
  }

  const probe = adaptive
    ? createFpsProbe({
        mode: adaptive === 'manual' ? 'manual' : 'auto',
        threshold: 45,
        rollingThreshold: 40,
        onResult(fps, info) {
          lastFps = fps;
          if (pendingPipeline) return false;
          if (info.kind === 'rolling' && !info.forced) return false;
          if (info.kind === 'initial' && fps >= info.threshold) return false;
          const lower = lowerTier(tierName);
          if (!lower) return false;
          setQuality(lower, 'auto');
          return true;
        },
      })
    : null;

  // ---------------------------------------------------------------- params
  function applyParams() {
    const bp = clamp01(params.blueprint);
    lights.apply({ key: params.key, rim: params.rim, fill: params.fill, blueprint: bp });
    scene.environmentIntensity = ENV_BASE * params.env * (1 - 0.95 * bp);

    const fu = floor.uniforms;
    fu.uFloor.value = clamp01(params.floor);
    fu.uGrid.value = Math.max(clamp01(params.grid), bp);
    fu.uBlueprint.value = bp;
    // The whisper grid is only visible where the studio is lit; the under-glow follows the haze.
    fu.uGridBase.value = 0.008 * (0.2 + 0.8 * clamp01(params.key));
    fu.uGlowAmount.value = Math.max(0, params.tint);
    floor.mesh.visible = params.floor > 0.001;

    backdrop.setText(params.backdropText);
    const bd = clamp01(params.backdrop) * (1 - bp);
    backdrop.uniforms.uOpacity.value = bd;
    backdrop.mesh.visible = bd > 0.001;

    // Motes and the shaft only exist where the overhead light is on.
    const lightOn = clamp01(params.key);
    const du = Math.max(0, params.dust) * (1 - bp) * lightOn;
    dust.uniforms.uIntensity.value = du;
    dust.points.visible = du > 0.001;

    const be = Math.max(0, params.beam) * (1 - bp) * lightOn;
    beam.uniforms.uIntensity.value = be;
    beam.mesh.visible = be > 0.001;

    background.uniforms.uTint.value = Math.max(0, params.tint);
    background.uniforms.uBlueprint.value = bp;

    pipeline?.apply({ exposure: params.exposure, bloom: params.bloom, vignette: params.vignette, blueprint: bp });
  }

  function set(next = {}) {
    let changed = false;
    for (const k in next) {
      if (!(k in params)) continue;
      const v = next[k];
      if (v === undefined || v === null) continue;
      const nv = k === 'backdropText' ? String(v) : +v;
      if (k === 'backdropText' ? nv !== params[k] : !(Math.abs(nv - params[k]) <= 1e-5)) changed = true;
      params[k] = nv;
    }
    if (changed) markActive();
    applyParams();
  }

  // ---------------------------------------------------------------- frame
  const backdropFrame = { fit: 1, x: 0, y: 0, scale: 1 };
  let backdropShown = false;
  function updateAtmosphere(dt) {
    dust.uniforms.uTime.value = elapsed;
    beam.uniforms.uTime.value = elapsed;
    backdrop.uniforms.uTime.value = elapsed;
    dust.setViewport(frameH * dpr, camera.fov);
    if (backdrop.mesh.visible !== backdropShown) {
      backdropShown = backdrop.mesh.visible;
      if (backdropShown) backdrop.snap(); // no slide-in from a stale framing
    }
    if (backdropShown) {
      backdropFrame.fit = params.backdropFit;
      backdropFrame.x = params.backdropX;
      backdropFrame.y = params.backdropY;
      backdropFrame.scale = params.backdropScale;
      backdrop.frame(camera, rig.targetVector, width / Math.max(1, frameH), backdropFrame, dt);
    }

    // Keep the red glow behind the product (projected anchor, eased).
    tmp.copy(GLOW_ANCHOR).applyMatrix4(camera.matrixWorldInverse);
    if (tmp.z < -camera.near) {
      tmp.applyMatrix4(camera.projectionMatrix);
      background.setCenter(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5, dt);
    }
  }

  // Change detector for the product pose. Shadow maps, the contact bake and the
  // reflection's product content are view independent, so they are refreshed only
  // when some shadow-casting mesh has moved more than MOTION_POS / MOTION_ROT since the
  // last refresh (thresholds against a snapshot, not rounding: rounding flickers at
  // bin edges and turned the running engine's vibration into a rebake every frame).
  // Also watched: numeric uniforms of custom depth materials (dissolve effects).
  // Opt-outs: userData.stageIgnoreMotion on a node skips its subtree (particles,
  // vapour); userData.dynamicShadow = false skips one mesh.
  let snap = new Float32Array(0);
  let snapCount = -1;
  let depthHash = NaN;
  const depthMats = new Set();
  let motionIndex = 0;
  let motionMoved = false;
  let motionFill = false;
  // Hidden while baking the contact shadow and rendering the reflection: the stage
  // decoration plus the product's lines, points and sprites (blueprint / cage edges,
  // particles), which cast no ground shadow and vanish in the blurred reflection anyway.
  // Collected by the per-frame motion walk.
  const bakeHide = [decor];

  function visitMesh(o) {
    const e = o.matrixWorld.elements;
    const i = motionIndex * 12;
    motionIndex++;
    if (o.customDepthMaterial) depthMats.add(o.customDepthMaterial);
    if (motionFill) return;
    if (i + 12 > snap.length) {
      motionMoved = true;
      return;
    }
    if (
      Math.abs(e[12] - snap[i]) > MOTION_POS ||
      Math.abs(e[13] - snap[i + 1]) > MOTION_POS ||
      Math.abs(e[14] - snap[i + 2]) > MOTION_POS ||
      Math.abs(e[0] - snap[i + 3]) > MOTION_ROT ||
      Math.abs(e[1] - snap[i + 4]) > MOTION_ROT ||
      Math.abs(e[2] - snap[i + 5]) > MOTION_ROT ||
      Math.abs(e[4] - snap[i + 6]) > MOTION_ROT ||
      Math.abs(e[5] - snap[i + 7]) > MOTION_ROT ||
      Math.abs(e[6] - snap[i + 8]) > MOTION_ROT ||
      Math.abs(e[8] - snap[i + 9]) > MOTION_ROT ||
      Math.abs(e[9] - snap[i + 10]) > MOTION_ROT ||
      Math.abs(e[10] - snap[i + 11]) > MOTION_ROT
    ) {
      motionMoved = true;
    }
  }
  function walkMotion(o, track) {
    if (!o.visible) return;
    if (o.isLine || o.isPoints || o.isSprite || o.isLineSegments2) bakeHide.push(o);
    const t = track && !o.userData.stageIgnoreMotion;
    if (t && o.isMesh && o.castShadow && o.userData.dynamicShadow !== false) visitMesh(o);
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) walkMotion(ch[i], t);
  }
  function takeSnapshot(count) {
    if (snap.length < count * 12) snap = new Float32Array(Math.ceil(count * 1.25) * 12);
    let i = 0;
    const write = (o) => {
      if (!o.visible || o.userData.stageIgnoreMotion) return;
      if (o.isMesh && o.castShadow && o.userData.dynamicShadow !== false) {
        const e = o.matrixWorld.elements;
        snap[i] = e[12];
        snap[i + 1] = e[13];
        snap[i + 2] = e[14];
        snap[i + 3] = e[0];
        snap[i + 4] = e[1];
        snap[i + 5] = e[2];
        snap[i + 6] = e[4];
        snap[i + 7] = e[5];
        snap[i + 8] = e[6];
        snap[i + 9] = e[8];
        snap[i + 10] = e[9];
        snap[i + 11] = e[10];
        i += 12;
      }
      const ch = o.children;
      for (let k = 0; k < ch.length; k++) write(ch[k]);
    };
    write(content);
    snapCount = count;
  }
  function hashDepthUniforms() {
    let h = 0;
    let n = 1;
    for (const m of depthMats) {
      const u = renderer.properties.get(m)?.uniforms;
      if (!u) continue;
      for (const k in u) {
        const v = u[k]?.value;
        if (typeof v === 'number') h += v * (n += 1.37);
        else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
          for (let j = 0; j < v.length && j < 32; j++) if (typeof v[j] === 'number') h += v[j] * (n += 1.37);
        }
      }
    }
    return Math.round(h * 500);
  }
  // Returns true when the product moved enough to refresh shadows / bakes.
  function detectMotion() {
    motionIndex = 0;
    motionMoved = false;
    motionFill = false;
    depthMats.clear();
    bakeHide.length = 1;
    walkMotion(content, true);
    const count = motionIndex;
    let moved = motionMoved || count !== snapCount;
    const dh = depthMats.size ? hashDepthUniforms() : 0;
    if (dh !== depthHash) {
      depthHash = dh;
      moved = true;
    }
    if (moved) takeSnapshot(count);
    return moved;
  }

  // Bakes: shadow map, contact shadow and floor reflection. Each refreshes only when
  // needed (product moved / camera moved) and no more often than its tier cadence, and at
  // most ONE of them runs per frame (the one waiting longest), so frames cost about the
  // same instead of alternating between "all three" and "none". A bake whose result does
  // not exist yet (start, tier switch, context restore) runs right away; allBakes (compile)
  // runs every due bake in this frame.
  function renderFrame(dt, allBakes = false) {
    if (!pipeline || contextLost) return;
    frame++;
    renderer.info.reset();
    scene.updateMatrixWorld();
    updateAtmosphere(dt);

    if (detectMotion()) {
      productVersion++;
      lastMotionFrame = frame;
      shadowDirty = true;
      contactDirty = true;
      markActive();
    }
    if (!nearlyEqual(lastCamWorld, camera.matrixWorld) || !nearlyEqual(lastCamProj, camera.projectionMatrix)) {
      lastCamWorld.copy(camera.matrixWorld);
      lastCamProj.copy(camera.projectionMatrix);
      markActive();
    }
    // While the product keeps moving, refresh the bakes at a lower cadence.
    const moving = frame - lastMotionFrame < MOVING_HOLD;
    const floorOn = params.floor > 0.001;
    const refl = cfg.reflection ? REFLECTION_BASE * Math.max(0, params.reflection) * (1 - clamp01(params.blueprint)) : 0;
    const reflOn = refl > 0.001 && floorOn;
    stats.frames++;

    const shadowDue = shadowDirty && frame - bakeLast.shadow >= (moving ? cfg.shadowEveryMoving : cfg.shadowEvery);
    const contactDue = floorOn && contactDirty && frame - bakeLast.contact >= (moving ? cfg.contactEveryMoving : cfg.contactEvery);
    // Camera or product changes re-render the reflection at most every n-th frame.
    const reflDue = reflOn && frame - bakeLast.reflection >= cfg.reflectionEveryMoving && reflection.isStale(camera, productVersion);
    // Round robin: the due bake that ran longest ago gets this frame.
    let next = '';
    if (shadowDue) next = 'shadow';
    if (contactDue && (!next || bakeLast.contact < bakeLast[next])) next = 'contact';
    if (reflDue && (!next || bakeLast.reflection < bakeLast[next])) next = 'reflection';

    if ((shadowDirty && !lights.shadowsReady) || (allBakes ? shadowDue : next === 'shadow')) {
      lights.invalidateShadows();
      shadowDirty = false;
      bakeLast.shadow = frame;
      stats.shadowBakes++;
    }
    if ((floorOn && contactDirty && !contactValid) || (allBakes ? contactDue : next === 'contact')) {
      contact.update(scene, content, bakeHide);
      contactDirty = false;
      contactValid = true;
      bakeLast.contact = frame;
      stats.contactBakes++;
    }
    floor.uniforms.uRefl.value = 0;
    if (reflOn) {
      if (!reflection.valid || (allBakes ? reflDue : next === 'reflection')) {
        bakeLast.reflection = frame;
        if (reflection.update(scene, camera, bakeHide, productVersion)) stats.reflectionRenders++;
      }
      if (reflection.valid) floor.uniforms.uRefl.value = refl;
    }
    pipeline.render(dt);
  }

  function runFrameCallbacks(dt) {
    for (const fn of frameFns) {
      try {
        fn(dt, elapsed);
      } catch (e) {
        if (!erroredFns.has(fn)) {
          erroredFns.add(fn);
          console.error('[stage] onFrame callback failed', e);
        }
      }
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const t = now * 0.001;
    const raw = last ? t - last : 1 / 60;
    if (last && raw < IDLE_INTERVAL && t - lastActive > IDLE_AFTER && !document.hidden) {
      throttled = true; // idle: skip this display frame (callbacks see the summed dt)
      return;
    }
    last = t;
    if (document.hidden || contextLost) return;
    const dt = Math.min(Math.max(raw, 0), 1 / 15);
    elapsed += dt;
    runFrameCallbacks(dt);
    if (!rendering) return;
    renderFrame(dt);
    // A frame interval stretched by the idle throttle says nothing about the GPU.
    if (!throttled) probe?.sample(raw);
    throttled = false;
  }

  const onVisibility = () => {
    last = 0; // no giant dt after returning to the tab
    markActive();
    if (!document.hidden) probe?.restartWarmup();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ---------------------------------------------------------------- context loss
  const onContextLost = (e) => {
    e.preventDefault();
    contextLost = true;
  };
  const onContextRestored = () => {
    contextLost = false;
    // three re-initialises its GL state and re-uploads textures / geometry lazily.
    // Everything that owns render targets created before the loss (PMREM environment,
    // shadow maps, contact bake, reflection, the whole post chain) is dropped and
    // rebuilt WITHOUT dispose(): disposing would delete GL objects of the dead context
    // ("object does not belong to this context" warnings on the next quality switch).
    forgetStaleDisposeListeners(scene);
    envRT = createEnvironmentTexture(renderer, envMode);
    scene.environment = envRT.texture;
    lights.dropShadowMaps();
    contact.recreate();
    reflection.recreate();
    floor.setContactTextures(contact.texture, contact.wideTexture);
    floor.uniforms.uReflMap.value = reflection.texture;
    swapToken++;
    pendingPipeline = null;
    buildPipeline({ disposeOld: false });
    contactDirty = true;
    contactValid = false;
    shadowDirty = true;
    last = 0;
    probe?.restartWarmup();
  };
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  // ---------------------------------------------------------------- init
  rig.set({});
  lights.setView(rig.shot.azimuth, camera.position);
  buildPipeline();
  if (cfg.ao) loadAO(); // start the download now; compile() waits for it

  // ---------------------------------------------------------------- API
  const stage = {
    renderer,
    scene,
    camera,
    content,
    lights,
    get quality() {
      return tierName;
    },
    get params() {
      return params;
    },
    get shot() {
      return rig.shot;
    },
    // frameHeight: height of the box shots are composed in (<= height, see measure()).
    get size() {
      return { width, height, frameHeight: frameH, dpr };
    },
    get fps() {
      return lastFps;
    },
    get rendering() {
      return rendering;
    },
    stats,
    add(obj) {
      content.add(obj);
      contactDirty = true;
      shadowDirty = true;
      markActive();
      return obj;
    },
    remove(obj) {
      content.remove(obj);
      contactDirty = true;
      shadowDirty = true;
      markActive();
    },
    // Force shadow maps + contact shadow to refresh (e.g. after swapping geometry in place).
    invalidateShadows() {
      contactDirty = true;
      shadowDirty = true;
    },
    setShot(next) {
      rig.set(next);
      lights.setView(rig.shot.azimuth, camera.position);
    },
    set,
    onFrame(fn) {
      frameFns.add(fn);
      return () => frameFns.delete(fn);
    },
    onQualityChange(fn) {
      qualityFns.add(fn);
      return () => qualityFns.delete(fn);
    },
    setQuality,
    setToneMapping(name) {
      toneMappingMode = name;
      pipeline?.setToneMapping(name);
      background.setToneMapping(name);
      floor.setToneMapping(name);
    },
    // adaptive: 'manual' -> begin the FPS probe now (after the intro has played).
    startQualityProbe() {
      probe?.start();
    },
    // Ask the probe for a fresh measuring window (e.g. entering a heavy scene).
    evaluateQuality() {
      probe?.requestEvaluation();
    },
    get qualityProbe() {
      return probe ? probe.phase : 'off';
    },
    // World point / Object3D -> CSS pixels relative to the viewport (view offset included).
    project(target, out = {}) {
      if (target?.isObject3D) target.getWorldPosition(tmp);
      else if (Array.isArray(target)) tmp.set(target[0], target[1], target[2]);
      else tmp.copy(target);
      tmp.applyMatrix4(camera.matrixWorldInverse);
      const behind = tmp.z > -camera.near;
      tmp.applyMatrix4(camera.projectionMatrix);
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (0.5 - tmp.y * 0.5) * height;
      out.x = x;
      out.y = y;
      out.behind = behind;
      out.visible = !behind && x >= 0 && x <= width && y >= 0 && y <= height;
      return out;
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      markActive();
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    setRendering(on) {
      const next = !!on;
      if (next && !rendering) {
        contactDirty = true;
        markActive();
        probe?.restartWarmup();
      }
      rendering = next;
    },
    resize,
    // Render one frame immediately (e.g. while the loop is stopped).
    render() {
      renderFrame(0);
    },
    async compile() {
      // The high tier's AO pass is loaded lazily; make sure it is part of the pipeline
      // before the programs are compiled and the warm-up frame runs.
      if (cfg.ao && !aoReady() && (await loadAO())) buildPipeline();
      // Make every stage layer visible so its program is compiled too.
      const layers = [floor.mesh, backdrop.mesh, beam.mesh, dust.points];
      const vis = layers.map((o) => o.visible);
      layers.forEach((o) => (o.visible = true));
      try {
        // Programs depend on the output target (linear composer buffer, not the sRGB
        // canvas): bind it while three builds the program list (synchronous part).
        const prevTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(pipeline?.composer.inputBuffer ?? null);
        const pending = renderer.compileAsync ? renderer.compileAsync(scene, camera) : renderer.compile(scene, camera);
        renderer.setRenderTarget(prevTarget);
        await pending;
      } catch (e) {
        console.warn('[stage] compileAsync failed, continuing', e);
      }
      // One full frame warms up the shadow maps, contact bake and all post passes.
      contactDirty = true;
      shadowDirty = true;
      renderFrame(0, true);
      layers.forEach((o, i) => (o.visible = vis[i]));
      applyParams();
    },
    dispose() {
      stage.stop();
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', scheduleResize);
      document.removeEventListener('visibilitychange', onVisibility);
      dprQuery?.removeEventListener?.('change', onDprChange);
      ro?.disconnect();
      svhProbe?.remove();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      probe?.stop();
      frameFns.clear();
      qualityFns.clear();
      swapToken++;
      pendingPipeline?.dispose();
      pendingPipeline = null;
      pipeline?.dispose();
      contact.dispose();
      reflection.dispose();
      floor.dispose();
      backdrop.dispose();
      beam.dispose();
      dust.dispose();
      background.dispose();
      envRT.dispose();
      renderer.dispose();
    },
  };
  return stage;
}

// After a context restore, every geometry / material / texture that was used before the
// loss still carries the 'dispose' listener of three's *old* GL bookkeeping; disposing
// it later deletes GL objects of the dead context (WebGL "object does not belong to
// this context" warnings). three's restore handler runs before ours and nothing has
// been re-rendered yet, so the only 'dispose' listeners present are stale: drop them.
// three re-attaches fresh ones the next time each object is used. Also covers the
// fullscreen triangle shared by all postprocessing passes (disposed by every
// EffectComposer.dispose()).
function forgetStaleDisposeListeners(root) {
  const forget = (o) => {
    const l = o?._listeners;
    if (l && l.dispose) l.dispose.length = 0;
  };
  const forgetMaterial = (m) => {
    if (!m) return;
    forget(m);
    for (const k in m) {
      const v = m[k];
      if (v && v.isTexture) forget(v);
    }
    if (m.uniforms) {
      for (const k in m.uniforms) {
        const v = m.uniforms[k]?.value;
        if (v && v.isTexture) forget(v);
      }
    }
  };
  root.traverse((o) => {
    forget(o.geometry);
    if (Array.isArray(o.material)) o.material.forEach(forgetMaterial);
    else forgetMaterial(o.material);
    forgetMaterial(o.customDepthMaterial);
    forgetMaterial(o.customDistanceMaterial);
  });
  forget(root.environment);
  forget(root.background);
  try {
    forget(Pass.fullscreenGeometry);
  } catch {
    /* older postprocessing */
  }
}

// Camera matrices compare with a tolerance: the director's smoothing converges forever.
function nearlyEqual(a, b) {
  const ea = a.elements;
  const eb = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(ea[i] - eb[i]) > CAMERA_EPS) return false;
  return true;
}

// Invisible fixed element measuring the small viewport height (100svh); null where the
// unit is unsupported (the frame box then equals the canvas).
function createSvhProbe() {
  try {
    if (!window.CSS?.supports?.('height', '100svh') || !document.body) return null;
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100svh;visibility:hidden;pointer-events:none;';
    document.body.appendChild(el);
    return el;
  } catch {
    return null;
  }
}

// A canvas without any CSS size would grow on every resize (its CSS size follows its
// drawing buffer). Give an unstyled canvas a full-viewport fixed box.
function ensureCanvasSized(canvas) {
  try {
    const cs = getComputedStyle(canvas);
    const unstyled = !canvas.style.width && cs.width === `${canvas.width}px` && cs.height === `${canvas.height}px` && cs.position === 'static';
    if (unstyled) {
      Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block' });
    }
  } catch {
    /* not in a browser layout context */
  }
}
