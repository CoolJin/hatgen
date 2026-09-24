// Device / preference detection shared across modules.
const mq = (q) => typeof window !== 'undefined' && window.matchMedia && window.matchMedia(q).matches;

export const reducedMotion = mq('(prefers-reduced-motion: reduce)');
export const coarsePointer = mq('(pointer: coarse)');
export const isMobile = () => window.innerWidth < 768;
export const isNarrow = () => window.innerWidth < 1024;

// Rough initial quality guess; the stage refines it with an FPS probe.
export function guessQuality() {
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (coarsePointer || window.innerWidth < 768 || mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

// WebGL 2 probe (three.js r163+ needs it). Also reports the GPU tier hint, so the stage can
// be created at the right quality straight away. The probe context is released at once.
export function probeWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { ok: false, tier: null };
    const tier = gpuTier(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, tier };
  } catch {
    return { ok: false, tier: null };
  }
}
export const webglAvailable = () => probeWebGL().ok;

// Lower of two quality tiers.
const TIER_ORDER = ['low', 'medium', 'high'];
export const minTier = (a, b) => (!b ? a : !a ? b : TIER_ORDER[Math.min(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))]);

// Stacked layout (product above the text): phones and portrait tablets. Same query as the UI.
export const STACKED_MQ = '(max-width: 767px), (max-width: 1180px) and (max-aspect-ratio: 4/5)';
const stackedMql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(STACKED_MQ) : null;
export const isStacked = () => !!stackedMql?.matches;

// Refines the first quality guess with the actual GPU (only ever lowers it). Firefox masks
// the renderer string, so this returns null there and the FPS probe stays the safety net.
export function gpuTier(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(r)) return 'low';
    if (/intel|uhd|iris|hd graphics|mali|powervr|adreno.*\b[1-6]\d\d\b/i.test(r)) return 'medium';
  } catch {
    /* no GL info */
  }
  return null;
}
