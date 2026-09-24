// Post-processing pipeline (pmndrs/postprocessing v6).
//   RenderPass → [N8AO, high only] → EffectPass A (Bloom → Exposure → ToneMapping)
//              → EffectPass B (SMAA → Vignette, dithered, sRGB out)
// SMAA runs after tone mapping so dark silhouettes get detected; its edge detector
// is patched to judge luma in a perceptual (sqrt) space since buffers are linear.
// No NoiseEffect: the page's CSS film grain already covers the canvas.
import { BufferAttribute, BufferGeometry, Color, HalfFloatType, Mesh, Scene, Uniform, Vector2 } from 'three';
import {
  BlendFunction,
  BloomEffect,
  EdgeDetectionMode,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
// N8AO (~83 KB gzip incl. its blue-noise texture) is only needed on the high tier, so it
// is loaded on demand: createStage awaits loadAO() before compiling when the tier uses AO.
let N8AOPostPass = null;
let aoLoading = null;
export function loadAO() {
  if (N8AOPostPass) return Promise.resolve(true);
  aoLoading ??= import('n8ao')
    .then((m) => {
      N8AOPostPass = m.N8AOPostPass;
      return true;
    })
    .catch((e) => {
      console.warn('[stage] AO module failed to load, continuing without AO', e);
      aoLoading = null;
      return false;
    });
  return aoLoading;
}
export const aoReady = () => !!N8AOPostPass;

class ExposureEffect extends Effect {
  constructor() {
    super(
      'ExposureEffect',
      /* glsl */ `
uniform float exposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
}`,
      { uniforms: new Map([['exposure', new Uniform(1)]]) }
    );
  }
  set exposure(v) {
    this.uniforms.get('exposure').value = v;
  }
}

export const TONE_MAPPING_MODES = {
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  neutral: ToneMappingMode.NEUTRAL,
};

const BLOOM_BASE = 0.9;
// Brightness threshold (linear, see patchBloomBrightness). Only emissive LEDs / the
// display, the highlight glow and hot red rim glints pass; lit white decals ("50 Hz",
// "CAUTION", the warning strip on the lid) stay below it. In blueprint mode it drops so the red
// edge lines glow, but only late in the transition (smoothstep 0.55..1).
const BLOOM_THRESHOLD = 1.5;
const BLOOM_SMOOTHING = 0.3;
const BLOOM_THRESHOLD_BP = 0.16;
const VIGNETTE_BASE = 0.42;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Bloom selects by a saturation-weighted brightness instead of luminance:
//   l = max(r, g, b) * (0.45 + 0.55 * saturation)
// Rec.709 luminance rates saturated red at ~0.21 of its value, so a red LED at 2.4
// (luminance ~0.55) fell below any threshold that also rejects lit white decals. With
// this measure coloured emitters (LED display, status LEDs, red highlight / rim glints,
// blueprint lines) count fully, while neutral lit surfaces count at 45 %: a white
// sticker straight under the top light stays below the threshold.
function patchBloomBrightness(bloom) {
  const mat = bloom?.luminancePass?.fullscreenMaterial;
  if (!mat || typeof mat.fragmentShader !== 'string') return;
  const patched = mat.fragmentShader.replace(
    'float l=luminance(texel.rgb);',
    'float mx=max(texel.r,max(texel.g,texel.b));float mn=min(texel.r,min(texel.g,texel.b));' +
      'float l=mx*(0.45+0.55*((mx-mn)/max(mx,1e-4)));'
  );
  if (patched !== mat.fragmentShader) {
    mat.fragmentShader = patched;
    mat.needsUpdate = true;
  }
}

function patchSmaaEdgeDetection(smaa) {
  const mat = smaa.edgeDetectionMaterial;
  if (!mat || typeof mat.fragmentShader !== 'string') return;
  const patched = mat.fragmentShader.replace(
    /texture2D\(inputBuffer,(vUv\d?)\)\.rgb/g,
    'sqrt(max(texture2D(inputBuffer,$1).rgb,vec3(0.0)))'
  );
  if (patched !== mat.fragmentShader) {
    mat.fragmentShader = patched;
    mat.needsUpdate = true;
  }
}

export function createPipeline({ renderer, scene, camera, tier, toneMapping = 'neutral' }) {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    multisampling: 0,
  });

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const buffer = renderer.getDrawingBufferSize(new Vector2());

  let ao = null;
  if (tier.ao && N8AOPostPass) {
    ao = new N8AOPostPass(scene, camera, Math.max(1, buffer.x), Math.max(1, buffer.y));
    // Transparent stage layers (floor, beam, dust, backdrop) must not trigger the
    // double-render transparency path; none of them write depth, so AO ignores them.
    ao.autoDetectTransparency = false;
    if (ao.configuration.transparencyAware) ao.configuration.transparencyAware = false;
    ao.configuration.gammaCorrection = false;
    ao.configuration.aoRadius = 0.28;
    ao.configuration.distanceFalloff = 0.9;
    ao.configuration.intensity = 2.4;
    ao.configuration.color = new Color(0, 0, 0);
    ao.configuration.halfRes = !!tier.aoHalfRes;
    ao.setQualityMode(tier.aoQuality || 'Medium');
    composer.addPass(ao);
  }

  const bloom = tier.bloom
    ? new BloomEffect({
        blendFunction: BlendFunction.ADD,
        mipmapBlur: true,
        luminanceThreshold: BLOOM_THRESHOLD,
        luminanceSmoothing: BLOOM_SMOOTHING,
        intensity: BLOOM_BASE,
        radius: 0.74,
        levels: tier.bloomLevels,
      })
    : null;
  patchBloomBrightness(bloom);
  const exposure = new ExposureEffect();
  const tone = new ToneMappingEffect({ mode: TONE_MAPPING_MODES[toneMapping] ?? ToneMappingMode.NEUTRAL });
  const passA = new EffectPass(camera, ...[bloom, exposure, tone].filter(Boolean));
  composer.addPass(passA);

  const smaa = new SMAAEffect({ preset: tier.smaa, edgeDetectionMode: EdgeDetectionMode.LUMA });
  patchSmaaEdgeDetection(smaa);
  if (smaa.edgeDetectionMaterial) smaa.edgeDetectionMaterial.edgeDetectionThreshold = 0.06;
  const vignette = new VignetteEffect({ offset: 0.3, darkness: VIGNETTE_BASE });
  const passB = new EffectPass(camera, smaa, vignette);
  passB.dithering = true;
  composer.addPass(passB);

  return {
    composer,
    ao,
    bloom,
    smaa,
    setSize(w, h) {
      composer.setSize(w, h, false);
    },
    setToneMapping(name) {
      tone.mode = TONE_MAPPING_MODES[name] ?? ToneMappingMode.NEUTRAL;
    },
    apply({ exposure: ex = 1, bloom: b = 1, vignette: v = 1, blueprint = 0 }) {
      exposure.exposure = ex;
      if (bloom) {
        const k = smoothstep(0.55, 1.0, blueprint);
        bloom.intensity = BLOOM_BASE * b * (1 + 0.55 * k);
        bloom.luminanceMaterial.threshold = BLOOM_THRESHOLD + (BLOOM_THRESHOLD_BP - BLOOM_THRESHOLD) * k;
      }
      vignette.darkness = VIGNETTE_BASE * v;
      vignette.blendMode.opacity.value = v > 0 ? 1 : 0;
    },
    render(dt) {
      composer.render(dt);
    },
    // Pre-compiles every post material (KHR_parallel_shader_compile via compileAsync)
    // so a quality switch can swap to this chain without a compile hitch.
    warm() {
      return warmPasses(renderer, camera, composer);
    },
    dispose() {
      composer.dispose();
    },
  };
}

// Collects the materials of all passes (and of the effects / helper passes they own)
// and compiles them asynchronously: materials of the pass that renders to the canvas
// against the default framebuffer, everything else against the composer buffer (the
// program key depends on the output colour space of the bound target).
function collectMaterials(root, out, seen, depth = 0) {
  if (!root || typeof root !== 'object' || seen.has(root) || depth > 3) return;
  seen.add(root);
  if (root.isMaterial) {
    out.add(root);
    return;
  }
  if (root.isTexture || root.isWebGLRenderTarget || root.isBufferGeometry || root.isCamera || root.isScene || root.isWebGLRenderer) return;
  for (const key of Object.keys(root)) {
    if (key === 'renderer' || key === 'scene' || key === 'camera' || key === 'mainScene' || key === 'mainCamera') continue;
    const v = root[key];
    if (Array.isArray(v)) v.forEach((x) => collectMaterials(x, out, seen, depth + 1));
    else if (v instanceof Map) v.forEach((x) => collectMaterials(x, out, seen, depth + 1));
    else if (v && typeof v === 'object') collectMaterials(v, out, seen, depth + 1);
  }
}

async function warmPasses(renderer, camera, composer) {
  if (!renderer.compileAsync) return;
  const screen = new Set();
  const offscreen = new Set();
  const seen = new WeakSet();
  for (const pass of composer.passes) {
    const set = pass.renderToScreen ? screen : offscreen;
    if (pass.fullscreenMaterial) set.add(pass.fullscreenMaterial);
    collectMaterials(pass, offscreen, seen);
  }
  for (const m of screen) offscreen.delete(m);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const compileSet = (materials, target) => {
    if (!materials.size) return Promise.resolve();
    const scene = new Scene();
    for (const m of materials) {
      const mesh = new Mesh(geometry, m);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    let p;
    try {
      p = renderer.compileAsync(scene, camera);
    } finally {
      renderer.setRenderTarget(prev);
    }
    return p;
  };
  try {
    await Promise.all([compileSet(offscreen, composer.inputBuffer), compileSet(screen, null)]);
  } finally {
    geometry.dispose();
  }
}
