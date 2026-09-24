// Floating dust motes, visible only inside the overhead light shaft (above the unit).
// Additive soft points with slow drift. Motes never show outside the shaft, below the
// lid height or close to the lens (no "starfield" specks, no smudges on close-ups).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

const vertexShader = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uScale;      // drawing-buffer px per world unit at distance 1
uniform float uSize;
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uTanAngle;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
varying float vAlpha;

void main() {
  float t = uTime * (0.6 + aSeed.w * 0.6);
  vec3 p = position;
  // Slow rising drift with wrap, plus lazy lateral sway.
  float h = uBoxSize.y;
  float y = mod(p.y - uBoxMin.y + t * 0.035 * (0.4 + aSeed.x), h);
  float edge = smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(h - 0.35, h, y));
  p.y = uBoxMin.y + y;
  p.x += sin(t * 0.21 + aSeed.y * 6.2831) * 0.12 + sin(t * 0.47 + aSeed.z * 12.0) * 0.04;
  p.z += cos(t * 0.17 + aSeed.z * 6.2831) * 0.12 + cos(t * 0.39 + aSeed.x * 9.0) * 0.04;

  // How far inside the light cone is this mote?
  vec3 rel = p - uApex;
  float along = dot(rel, uAxis);
  float radial = length(rel - uAxis * along);
  float coneR = max(along, 0.001) * uTanAngle;
  float inBeam = 1.0 - smoothstep(0.45, 0.95, radial / coneR);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  // Slightly larger and dimmer toward the camera (soft defocus), never lens-sized.
  float defocus = 1.0 - smoothstep(1.8, 3.2, dist);
  float px = uSize * (0.55 + aSeed.x * 0.9) * (1.0 + defocus * 1.2) * uScale / max(dist, 0.05);
  float size = clamp(px, 1.6, 14.0);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;

  // Keep the energy of motes that were enlarged to the minimum size (no hard specks).
  float energy = clamp((px * px) / (size * size), 0.2, 1.0);
  float twinkle = 0.75 + 0.25 * sin(uTime * (1.3 + aSeed.y * 2.0) + aSeed.z * 20.0);
  // Same height fade as the beam: motes live in the shaft above the unit.
  float height = smoothstep(1.0, 1.8, p.y);
  // Nothing close to the lens.
  float nearFade = smoothstep(1.2, 1.8, dist);
  vAlpha = inBeam * edge * twinkle * energy * height * nearFade / (1.0 + defocus * 2.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(uColor * a * vAlpha * uIntensity, 1.0);
}
`;

// coneScale matches the visible beam cone (beam.js draws the shaft at angle * 0.6).
export function createDust({ max = 320, apex, target, angle, coneScale = 0.62 }) {
  // Only the visible part of the shaft: above the lid, around the light axis.
  const boxMin = new Vector3(-1.3, 1.0, -1.4);
  const boxSize = new Vector3(2.6, 2.6, 2.6);
  const axis = new Vector3().subVectors(target, apex).normalize();
  const tanA = Math.tan(angle * coneScale);

  const positions = new Float32Array(max * 3);
  const seeds = new Float32Array(max * 4);
  // Deterministic PRNG so every load looks identical.
  let s = 1337;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const tmp = new Vector3();
  for (let i = 0; i < max; i++) {
    // Sampled inside the cone (motes outside it are invisible anyway).
    let tries = 0;
    do {
      tmp.set(boxMin.x + rand() * boxSize.x, boxMin.y + rand() * boxSize.y, boxMin.z + rand() * boxSize.z);
      const rel = tmp.clone().sub(apex);
      const along = rel.dot(axis);
      const radial = rel.sub(axis.clone().multiplyScalar(along)).length();
      if (along > 0 && radial < along * tanA * 0.9) break;
    } while (++tries < 40);
    positions.set([tmp.x, tmp.y, tmp.z], i * 3);
    seeds.set([rand(), rand(), rand(), rand()], i * 4);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  geometry.setDrawRange(0, max);

  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 800 },
    uSize: { value: 0.0055 },
    uApex: { value: apex.clone() },
    uAxis: { value: axis },
    uTanAngle: { value: tanA },
    uBoxMin: { value: boxMin },
    uBoxSize: { value: boxSize },
    uColor: { value: new Color('#fff1e8').multiplyScalar(0.6) },
    uIntensity: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.name = 'stage:dust';
  points.frustumCulled = false;
  points.renderOrder = 20;
  points.matrixAutoUpdate = false;

  return {
    points,
    uniforms,
    setCount(n) {
      geometry.setDrawRange(0, Math.min(max, Math.max(0, n | 0)));
    },
    // Projection scale in drawing-buffer pixels: h / (2 tan(fov/2)).
    setViewport(drawingBufferHeight, fovDeg) {
      uniforms.uScale.value = drawingBufferHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
