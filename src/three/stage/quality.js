// Quality tiers and the adaptive FPS probe.
import { SMAAPreset } from 'postprocessing';

export const TIERS = ['low', 'medium', 'high'];

// Everything that differs per tier lives here so the rest of the stage stays declarative.
// No WebGL film grain on any tier: the page already has an animated CSS grain overlay,
// a second one on the canvas doubled it ("boiling" grain). Dithering stays on.
// maxPixels: drawing-buffer budget (device pixels). Large windows on high-DPI screens
// lower the pixel ratio to fit it (never below MIN_DPR) instead of growing every
// full-resolution target without limit (2560 x 1440 at DPR 1.75 would be 11 Mpx).
export const MIN_DPR = 0.75;
export const TIER_CONFIG = {
  high: {
    dprMax: 1.75,
    maxPixels: 3.7e6,
    ao: true,
    aoQuality: 'Medium',
    aoHalfRes: true,
    bloom: true,
    bloomLevels: 7,
    smaa: SMAAPreset.HIGH,
    noise: false,
    shadowMapSize: 2048,
    shadowRadius: 3.2,
    shadowEvery: 1,
    contactRes: 512,
    contactEvery: 1,
    // Cadence while the product keeps moving (open / explode / turntable).
    shadowEveryMoving: 2,
    contactEveryMoving: 2,
    reflectionEveryMoving: 2,
    dust: 320,
    reflection: 0.38, // render-target scale, 0 = off (blurred anyway)
  },
  medium: {
    dprMax: 1.5,
    maxPixels: 2.4e6,
    ao: false,
    bloom: true,
    bloomLevels: 5,
    smaa: SMAAPreset.MEDIUM,
    noise: false,
    shadowMapSize: 1024,
    shadowRadius: 2.4,
    shadowEvery: 1,
    contactRes: 256,
    contactEvery: 2,
    shadowEveryMoving: 2,
    contactEveryMoving: 3,
    reflectionEveryMoving: 2,
    dust: 180,
    reflection: 0,
  },
  low: {
    dprMax: 1,
    maxPixels: 2.1e6, // full HD stays at 1:1
    ao: false,
    bloom: false,
    bloomLevels: 4,
    smaa: SMAAPreset.LOW,
    noise: false,
    shadowMapSize: 512,
    shadowRadius: 1.6,
    shadowEvery: 2,
    contactRes: 128,
    contactEvery: 3,
    shadowEveryMoving: 3,
    contactEveryMoving: 4,
    reflectionEveryMoving: 2,
    dust: 80,
    reflection: 0,
  },
};

export const normalizeTier = (q) => (TIER_CONFIG[q] ? q : 'high');

// Pixel ratio for a w x h CSS-pixel canvas: device ratio capped by the tier's dprMax and
// its pixel budget. The budget cap is rounded down to 0.05 steps, so a window just over
// budget renders at an exact 1:1 instead of a blurry 1.002.
export function tierPixelRatio(cfg, w, h, deviceRatio) {
  const budget = Math.floor(Math.sqrt(cfg.maxPixels / Math.max(1, w * h)) * 20) / 20;
  return Math.max(Math.min(MIN_DPR, deviceRatio), Math.min(deviceRatio, cfg.dprMax, budget));
}

export function lowerTier(q) {
  const i = TIERS.indexOf(q);
  return i > 0 ? TIERS[i - 1] : null;
}

// Samples frame times of *active rendering* only (the stage feeds it only frames it
// actually rendered, so time behind solid page sections does not count).
//
//   1. Start: in 'auto' mode after `startDelay` s of rendering (skips the loader exit
//      and the hero intro, whose main-thread work is not the GPU's fault); in 'manual'
//      mode only after start() (the app calls it once its intro has finished).
//   2. Initial evaluation: one window; below `threshold` -> drop a tier, then exactly
//      one re-evaluation of the new tier (may drop once more). This is the spec rule.
//   3. Rolling watch: afterwards windows keep running, so the heavy scenes (explode,
//      running engine, turntable) are covered too. Only a sustained slump (two windows
//      in a row below `rollingThreshold`) may drop, and at most `maxRollingDrops` times.
//
// Never goes up. Window averages are trimmed means (slowest 10 % ignored), so a single
// shader-compile hitch cannot trigger a downgrade while a uniformly slow device does.
// onResult(avgFps, info) must return true when it lowered the tier.
export function createFpsProbe({
  threshold = 45,
  rollingThreshold = 40,
  warmup = 0.75,
  startDelay = 4.5,
  windowSec = 2.5,
  rollingWindowSec = 3,
  maxInitialEvaluations = 2,
  maxRollingDrops = 1,
  mode = 'auto', // 'auto' | 'manual'
  onResult,
}) {
  let phase = mode === 'manual' ? 'idle' : 'warmup';
  let clock = 0;
  let currentWarmup = Math.max(warmup, startDelay);
  let initialEvaluations = 0;
  let rollingDrops = 0;
  let rollingLow = 0;
  const samples = [];

  function startWarmup(duration) {
    phase = 'warmup';
    clock = 0;
    currentWarmup = duration;
    samples.length = 0;
  }

  function trimmedFps() {
    const sorted = samples.slice().sort((a, b) => a - b);
    const keep = Math.max(1, Math.floor(sorted.length * 0.9));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += sorted[i];
    return keep / sum;
  }

  const rolling = () => initialEvaluations >= maxInitialEvaluations;

  function evaluate() {
    const fps = trimmedFps();
    samples.length = 0;
    clock = 0;
    if (!rolling()) {
      initialEvaluations++;
      const dropped = !!onResult?.(fps, { kind: 'initial', evaluation: initialEvaluations, threshold });
      if (!rolling()) {
        // Only a drop earns the re-evaluation; a pass on the first window moves on.
        if (dropped) startWarmup(1.0);
        else initialEvaluations = maxInitialEvaluations;
      }
      if (rolling()) {
        phase = maxRollingDrops > 0 ? 'warmup' : 'done';
        currentWarmup = 1.0;
        rollingLow = 0;
      }
      return;
    }
    // Rolling watch.
    rollingLow = fps < rollingThreshold ? rollingLow + 1 : 0;
    if (rollingLow >= 2) {
      rollingLow = 0;
      const dropped = !!onResult?.(fps, { kind: 'rolling', threshold: rollingThreshold, forced: true });
      if (dropped) rollingDrops++;
      if (rollingDrops >= maxRollingDrops) {
        phase = 'done';
        return;
      }
      startWarmup(1.0);
      return;
    }
    onResult?.(fps, { kind: 'rolling', threshold: rollingThreshold, forced: false });
  }

  return {
    get done() {
      return phase === 'done';
    },
    get phase() {
      return phase;
    },
    threshold,
    // Manual mode: begin measuring now (e.g. after the hero intro has played).
    start() {
      if (phase === 'idle') startWarmup(warmup);
    },
    // Call after a pipeline change (quality switch, context restore, rendering resumed)
    // to discard hitchy frames. The current window restarts.
    restartWarmup() {
      if (phase === 'done' || phase === 'idle') return;
      startWarmup(Math.max(1.0, phase === 'warmup' ? currentWarmup - clock : 0));
    },
    // Ask for a fresh measuring window soon (e.g. when entering a heavy scene).
    requestEvaluation() {
      if (phase === 'done' || phase === 'idle') return;
      if (phase === 'measure') {
        clock = 0;
        samples.length = 0;
      } else startWarmup(0.5);
    },
    sample(dt) {
      if (phase === 'done' || phase === 'idle') return;
      // Real stalls (debugger, tab switch, context loss) invalidate the current window.
      if (!(dt > 0) || dt > 1.0) {
        if (phase === 'measure') {
          clock = 0;
          samples.length = 0;
        }
        return;
      }
      clock += dt;
      if (phase === 'warmup') {
        if (clock >= currentWarmup) {
          phase = 'measure';
          clock = 0;
          samples.length = 0;
        }
        return;
      }
      // measure
      if (samples.length < 1000) samples.push(dt);
      const win = rolling() ? rollingWindowSec : windowSec;
      if ((clock >= win && samples.length >= 10) || clock >= win * 3) evaluate();
    },
    stop() {
      phase = 'done';
    },
  };
}
