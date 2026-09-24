// Screen-space studio background: near-black brand red with a soft glow that sits
// behind the product (its centre follows the projected product position).
import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { toneMappedBase } from './color.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uGlow;
uniform vec3 uCore;
uniform vec3 uBlueprintGlow;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uRadius;
uniform float uTint;
uniform float uBlueprint;
varying vec2 vUv;

void main() {
  // Work in "viewport height" units so the glow keeps its shape on any aspect.
  vec2 p = vUv - uCenter;
  p.x *= uAspect;
  // Slightly taller than wide, like the red haze on the client's hero.
  vec2 q = p * vec2(0.92, 0.78);
  float r2 = dot(q, q);
  float halo = exp(-r2 / (uRadius * uRadius));
  float core = exp(-r2 / (uRadius * uRadius * 0.18));
  // A very wide, faint wash so the edges are never dead flat.
  float wash = exp(-r2 / (uRadius * uRadius * 4.0));

  vec3 glow = uGlow * halo + uCore * core * 0.55 + uGlow * wash * 0.18;
  vec3 bpGlow = uBlueprintGlow * (halo * 0.7 + wash * 0.25);
  vec3 col = uBase + mix(glow, bpGlow, uBlueprint) * uTint;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const PAGE_BG = '#0a0202';

export function createBackground({ toneMapping = 'neutral' } = {}) {
  const uniforms = {
    // Pre-compensated so the tone-mapped canvas lands exactly on the page #0a0202.
    uBase: { value: toneMappedBase(PAGE_BG, toneMapping) },
    // A touch of green/blue keeps the glow a warm ember instead of pure LED red.
    uGlow: { value: new Color('#3c0b09') },
    uCore: { value: new Color('#6e120e') },
    uBlueprintGlow: { value: new Color('#220404') },
    uCenter: { value: new Vector2(0.6, 0.55) },
    uAspect: { value: 1 },
    uRadius: { value: 0.36 },
    uTint: { value: 1 },
    uBlueprint: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.name = 'stage:background';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = false;

  const target = new Vector2(0.6, 0.55);
  let primed = false;

  return {
    mesh,
    uniforms,
    // uv of the projected glow anchor (0..1, y up). Eased so fast camera cuts do not pop.
    setCenter(u, v, dt = 1) {
      target.set(Math.min(1.35, Math.max(-0.35, u)), Math.min(1.35, Math.max(-0.35, v)));
      if (!primed) {
        uniforms.uCenter.value.copy(target);
        primed = true;
      } else {
        const k = 1 - Math.exp(-dt * 10);
        uniforms.uCenter.value.lerp(target, k);
      }
    },
    setAspect(a) {
      uniforms.uAspect.value = a;
    },
    setToneMapping(mode) {
      toneMappedBase(PAGE_BG, mode, uniforms.uBase.value);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
