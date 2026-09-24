// Fake volumetric light shaft along the key light. Additive open cone with
// view-dependent soft edges; it dissolves before reaching the product so the
// haze never washes out the unit itself.
import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Mesh, Quaternion, ShaderMaterial, Vector2, Vector3 } from 'three';

const vertexShader = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWorld;
varying float vLen;
void main() {
  vLen = 1.0 - uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform vec2 uHeightFade;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWorld;
varying float vLen;
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float body = pow(facing, 2.4);
  float along = smoothstep(0.0, 0.22, vLen);
  float heightFade = smoothstep(uHeightFade.x, uHeightFade.y, vWorld.y);
  float n = sin(vWorld.x * 2.7 + uTime * 0.21) * sin(vWorld.y * 1.9 - uTime * 0.16) * sin(vWorld.z * 2.3 + uTime * 0.12);
  float haze = 0.82 + 0.18 * n;
  gl_FragColor = vec4(uColor * body * along * heightFade * haze * uIntensity, 1.0);
}
`;

export function createBeam({ apex, target, angle, segments = 64 }) {
  const axis = new Vector3().subVectors(target, apex).normalize();
  const length = (apex.y / -axis.y) * 1.02;
  const radiusBottom = length * Math.tan(angle * 0.6);
  const geometry = new CylinderGeometry(0.05, radiusBottom, length, segments, 1, true);
  geometry.translate(0, -length / 2, 0);

  const uniforms = {
    // Cool-neutral and faint: a warm shaft over the red glow turned the top of the frame brown.
    uColor: { value: new Color('#f2f0ff').multiplyScalar(0.055) },
    uIntensity: { value: 1 },
    uTime: { value: 0 },
    uHeightFade: { value: new Vector2(1.3, 2.6) },
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'stage:beam';
  mesh.position.copy(apex);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), axis));
  mesh.renderOrder = 10;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
