// Baked, blurred contact shadow (renders the product from below into a small
// target, then blurs it). Two layers: a tight one (crisp grounding right under the
// wheels and plinth) and a wide, very soft one (about 10 cm of ambient falloff around
// the base, like a big overhead softbox). The floor shader combines
// max(tight, wide * 0.55) and samples the alpha as darkness.
import {
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  ShaderMaterial,
  DoubleSide,
  Vector2,
  Color,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const depthVertex = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
varying float vHeight;
void main() {
  #include <batching_vertex>
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_BATCHING
    wp = batchingMatrix * wp;
  #endif
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vHeight = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const depthFragment = /* glsl */ `
uniform float uMaxHeight;
uniform float uDarkness;
varying float vHeight;
void main() {
  float h = clamp(vHeight / uMaxHeight, 0.0, 1.0);
  float a = pow(1.0 - h, 2.6) * uDarkness;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

const blurFragment = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  // 9-tap gaussian, weights for sigma ~2 texels (scaled by uDir length).
  float a = texture2D(tMap, vUv).a * 0.2270270270;
  a += texture2D(tMap, vUv + uDir * 1.3846153846).a * 0.3162162162;
  a += texture2D(tMap, vUv - uDir * 1.3846153846).a * 0.3162162162;
  a += texture2D(tMap, vUv + uDir * 3.2307692308).a * 0.0702702703;
  a += texture2D(tMap, vUv - uDir * 3.2307692308).a * 0.0702702703;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function createContactShadow(renderer, { size = 2.6, maxHeight = 0.9, res = 512, darkness = 1 } = {}) {
  const makeTarget = (r) =>
    new WebGLRenderTarget(r, r, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
  let resolution = res;
  let rtA = makeTarget(resolution);
  let rtB = makeTarget(resolution);
  let rtW = makeTarget(resolution);
  rtA.texture.name = 'stage:contactShadow';
  rtW.texture.name = 'stage:contactShadowWide';

  const half = size / 2;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.0, maxHeight + 0.02);
  // Looking straight up from just under the floor. up = +Z so that texture u = +X, v = +Z.
  camera.position.set(0, -0.01, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();

  const depthMaterial = new ShaderMaterial({
    uniforms: { uMaxHeight: { value: maxHeight }, uDarkness: { value: darkness } },
    vertexShader: depthVertex,
    fragmentShader: depthFragment,
    side: DoubleSide,
  });

  const blurMaterial = new ShaderMaterial({
    uniforms: { tMap: { value: null }, uDir: { value: new Vector2() } },
    vertexShader: quadVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(blurMaterial);

  const hidden = [];
  const clearColor = new Color();

  // Separable blur src -> rtB (horizontal) -> dst (vertical). src may equal dst.
  function blurPass(src, dst, amount) {
    const texel = amount / resolution;
    blurMaterial.uniforms.tMap.value = src.texture;
    blurMaterial.uniforms.uDir.value.set(texel, 0);
    renderer.setRenderTarget(rtB);
    quad.render(renderer);
    blurMaterial.uniforms.tMap.value = rtB.texture;
    blurMaterial.uniforms.uDir.value.set(0, texel);
    renderer.setRenderTarget(dst);
    quad.render(renderer);
  }

  return {
    get texture() {
      return rtA.texture;
    },
    get wideTexture() {
      return rtW.texture;
    },
    size,
    maxHeight,
    camera,
    setResolution(r) {
      if (r === resolution) return;
      resolution = r;
      rtA.setSize(r, r);
      rtB.setSize(r, r);
      rtW.setSize(r, r);
    },
    // After a WebGL context restore: the old targets belong to the dead context. Drop
    // them without dispose() (that would delete foreign GL objects) and start fresh.
    recreate() {
      rtA = makeTarget(resolution);
      rtB = makeTarget(resolution);
      rtW = makeTarget(resolution);
      rtA.texture.name = 'stage:contactShadow';
      rtW.texture.name = 'stage:contactShadowWide';
    },
    // scene: the full scene, product: the group whose children cast the shadow,
    // hideGroups: stage decoration to hide while rendering.
    update(scene, product, hideGroups) {
      // Hide lines/points/sprites and nearly invisible transparent meshes inside the product.
      hidden.length = 0;
      product.traverseVisible((o) => {
        if (o.isLine || o.isPoints || o.isSprite || o.userData.noContactShadow) {
          hidden.push(o);
          return;
        }
        const m = o.material;
        if (m && !Array.isArray(m) && ((m.transparent && m.opacity < 0.35) || m.visible === false || m.colorWrite === false)) hidden.push(o);
      });
      for (const o of hidden) o.visible = false;
      const decorVisibility = hideGroups.map((g) => g.visible);
      for (const g of hideGroups) g.visible = false;

      const prevOverride = scene.overrideMaterial;
      const prevBackground = scene.background;
      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      const prevShadowAuto = renderer.shadowMap.autoUpdate;
      const prevShadowNeeds = renderer.shadowMap.needsUpdate;
      renderer.getClearColor(clearColor);
      const prevAlpha = renderer.getClearAlpha();

      scene.overrideMaterial = depthMaterial;
      scene.background = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(rtA);
      renderer.clear();
      renderer.render(scene, camera);

      // Tight layer.
      blurPass(rtA, rtA, 2.2);
      blurPass(rtA, rtA, 1.0);
      // Wide layer: progressively larger kernels (no ripple from sparse taps).
      blurPass(rtA, rtW, 3.0);
      blurPass(rtW, rtW, 5.0);
      blurPass(rtW, rtW, 7.0);

      scene.overrideMaterial = prevOverride;
      scene.background = prevBackground;
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      renderer.shadowMap.needsUpdate = prevShadowNeeds;
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(clearColor, prevAlpha);
      renderer.setRenderTarget(prevTarget);

      hideGroups.forEach((g, i) => (g.visible = decorVisibility[i]));
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
    },
    dispose() {
      rtA.dispose();
      rtB.dispose();
      rtW.dispose();
      depthMaterial.dispose();
      blurMaterial.dispose();
      quad.dispose();
    },
  };
}
