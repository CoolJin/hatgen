// Planar floor reflection of the product (high tier). A virtual camera mirrored at
// y = 0 renders only the product into a half-resolution target, which is softened by
// a separable blur. The floor shader samples it projectively (uReflMatrix), so it stays
// correct with setViewOffset and any camera pose.
import {
  Color,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const blurFragment = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tMap, vUv) * 0.2270270270;
  c += texture2D(tMap, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tMap, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tMap, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture2D(tMap, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}
`;
const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Camera pose / projection compare with a tolerance: the director's exponential
// smoothing and the pointer parallax converge forever, bit-exact equality never holds.
function nearlyEqual(a, b, eps) {
  const ea = a.elements;
  const eb = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(ea[i] - eb[i]) > eps) return false;
  return true;
}

export function createReflection(renderer, { scale = 0.5 } = {}) {
  const opts = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true };
  let rtA = new WebGLRenderTarget(2, 2, opts);
  let rtB = new WebGLRenderTarget(2, 2, { ...opts, depthBuffer: false });
  rtA.texture.name = 'stage:reflection';
  let resScale = scale;
  let w = 2;
  let h = 2;

  const virtualCamera = new PerspectiveCamera();
  virtualCamera.matrixAutoUpdate = true;
  const textureMatrix = new Matrix4();
  const normal = new Vector3(0, 1, 0);
  const camPos = new Vector3();
  const lookAt = new Vector3();
  const target = new Vector3();
  const rot = new Matrix4();
  const clearColor = new Color();
  const lastView = new Matrix4();
  const lastProj = new Matrix4();
  let lastSig = NaN;
  let valid = false;

  const blurMaterial = new ShaderMaterial({
    uniforms: { tMap: { value: null }, uDir: { value: new Vector2() } },
    vertexShader: quadVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(blurMaterial);

  function blur(amount) {
    blurMaterial.uniforms.tMap.value = rtA.texture;
    blurMaterial.uniforms.uDir.value.set(amount / w, 0);
    renderer.setRenderTarget(rtB);
    quad.render(renderer);
    blurMaterial.uniforms.tMap.value = rtB.texture;
    blurMaterial.uniforms.uDir.value.set(0, amount / h);
    renderer.setRenderTarget(rtA);
    quad.render(renderer);
  }

  // True when there is no reflection yet or the camera / product changed since it was
  // rendered (camera.matrixWorld must be current).
  function isStale(camera, productSig) {
    return (
      !valid ||
      productSig !== lastSig ||
      !nearlyEqual(lastView, camera.matrixWorld, 2e-5) ||
      !nearlyEqual(lastProj, camera.projectionMatrix, 2e-5)
    );
  }

  return {
    get texture() {
      return rtA.texture;
    },
    textureMatrix,
    get valid() {
      return valid;
    },
    setSize(drawingW, drawingH) {
      w = Math.max(2, Math.round(drawingW * resScale));
      h = Math.max(2, Math.round(drawingH * resScale));
      rtA.setSize(w, h);
      rtB.setSize(w, h);
      valid = false;
    },
    setScale(s) {
      resScale = s;
    },
    invalidate() {
      valid = false;
    },
    // After a WebGL context restore: drop the dead targets (no dispose) and start fresh.
    recreate() {
      rtA = new WebGLRenderTarget(w, h, opts);
      rtB = new WebGLRenderTarget(w, h, { ...opts, depthBuffer: false });
      rtA.texture.name = 'stage:reflection';
      valid = false;
    },
    isStale,
    // Renders the reflection if the camera or the product changed since last time.
    // allowStale: the caller throttles updates while things keep moving. A stale
    // reflection stays geometrically correct (it is sampled projectively with the
    // matrix it was rendered with), it only lags a frame. Returns true if rendered.
    update(scene, camera, hideGroups, productSig, allowStale = false) {
      camera.updateMatrixWorld();
      if (valid && (allowStale || !isStale(camera, productSig))) return false;
      lastSig = productSig;
      lastView.copy(camera.matrixWorld);
      lastProj.copy(camera.projectionMatrix);

      camPos.setFromMatrixPosition(camera.matrixWorld);
      if (camPos.y <= 0.001) {
        valid = false;
        return false;
      }
      // Mirror the camera at the floor plane (y = 0), same approach as three's Reflector.
      rot.extractRotation(camera.matrixWorld);
      lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      target.copy(lookAt).negate().reflect(normal).negate();
      virtualCamera.position.copy(camPos).negate().reflect(normal).negate();
      virtualCamera.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      virtualCamera.lookAt(target);
      virtualCamera.near = camera.near;
      virtualCamera.far = camera.far;
      virtualCamera.updateMatrixWorld();
      virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
      virtualCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

      textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      textureMatrix.multiply(virtualCamera.projectionMatrix);
      textureMatrix.multiply(virtualCamera.matrixWorldInverse);

      const vis = hideGroups.map((g) => g.visible);
      hideGroups.forEach((g) => (g.visible = false));
      const prevTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const prevAlpha = renderer.getClearAlpha();

      // Shadow maps are view independent: if they are due, rendering them here is
      // fine (and required: lit materials must never sample a missing shadow map).
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(rtA);
      renderer.clear();
      renderer.render(scene, virtualCamera);
      blur(2.2);
      blur(1.1);

      renderer.setClearColor(clearColor, prevAlpha);
      renderer.setRenderTarget(prevTarget);
      hideGroups.forEach((g, i) => (g.visible = vis[i]));
      valid = true;
      return true;
    },
    dispose() {
      rtA.dispose();
      rtB.dispose();
      blurMaterial.dispose();
      quad.dispose();
    },
  };
}
