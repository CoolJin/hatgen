// Recommended stage looks per scene. Every preset is a complete numeric param set,
// so the director can blend between two of them with mixParams() while scrolling:
//
//   stage.set(mixParams(STAGE_PRESETS.hero, STAGE_PRESETS.panel, t, scratch));
//
// backdropText is not part of the presets (set it separately when needed).

export const BASE_PARAMS = Object.freeze({
  key: 1,
  rim: 1,
  fill: 1,
  env: 1,
  exposure: 1,
  bloom: 1,
  vignette: 1,
  floor: 1,
  grid: 0,
  backdrop: 1,
  dust: 1,
  beam: 1,
  tint: 1,
  blueprint: 0,
  reflection: 1,
  // Backdrop word framing. backdropFit 1 = automatic (centred behind the subject and
  // sized to the viewport, lifted above the unit on portrait screens), 0 = fixed world
  // placement. backdropX / backdropY (m) and backdropScale are applied on top.
  backdropFit: 1,
  backdropX: 0,
  backdropY: 0,
  backdropScale: 1,
});

const preset = (o) => Object.freeze({ ...BASE_PARAMS, ...o });

export const STAGE_PRESETS = Object.freeze({
  // Before the intro: studio dark, only a faint red haze. Animate toward `hero`
  // (rim first, then key, then fill) for the "lights switch on" moment.
  off: preset({ key: 0, rim: 0, fill: 0, env: 0.1, beam: 0, dust: 0, backdrop: 0, tint: 0.35, bloom: 0.6 }),
  // Designed look: overhead shaft, red rims, giant word behind.
  hero: preset({}),
  // Big statement typography over the scene: calmer, the word steps back.
  statement: preset({ key: 0.85, rim: 1.1, fill: 0.8, backdrop: 0.55, tint: 1.1 }),
  // Close on the control panel: more fill so labels read, less haze.
  panel: preset({ key: 1.05, rim: 0.75, fill: 1.4, beam: 0.3, dust: 0, backdrop: 0.45, tint: 0.85 }),
  // Open / exploded unit: parts keep their own colours, rims only accent.
  inside: preset({ key: 1.1, rim: 0.42, fill: 1.3, beam: 0.5, dust: 0.3, backdrop: 0.45, tint: 0.8 }),
  // Product smaller on the right, oscilloscope on the left.
  avr: preset({ rim: 1, fill: 1, beam: 0.8, backdrop: 0.8, tint: 0.9 }),
  // Technical drawing: the stage handles dimming, grid and hiding the atmosphere.
  blueprint: preset({ blueprint: 1, grid: 1, backdrop: 0, beam: 0, dust: 0, tint: 0.7 }),
  // Slow turntable in the model picker.
  models: preset({ fill: 1.1 }),
  // Finale with the engine running: a touch hotter.
  finale: preset({ rim: 1.2, fill: 0.9, dust: 1.2, tint: 1.15, bloom: 1.1 }),
});

const KEYS = Object.keys(BASE_PARAMS);

// Linear blend of two param sets (numeric keys only). Writes into `out` if given.
export function mixParams(a, b, t, out = {}) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  for (const key of KEYS) {
    const va = a[key] ?? BASE_PARAMS[key];
    const vb = b[key] ?? BASE_PARAMS[key];
    out[key] = va + (vb - va) * k;
  }
  return out;
}
