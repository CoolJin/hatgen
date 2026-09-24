// Giant backdrop word in 3D space behind the product (canvas texture, additive).
// Channel packing: R = gradient fill, G = outline stroke. The shader colours both.
//
// Framing (frame(), every frame, cheap): the plane stays 4 m behind the origin facing
// +Z, but it is centred on the ray camera -> subject and sized so the whole word spans
// a fixed share of the viewport width (landscape: letters stand on the floor and rise
// above the lid, only the last letter may bleed off; portrait: smaller and lifted
// above the lid so the full word reads). The auto framing eases with a lag, so camera
// moves still parallax against the word before it settles.
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
  LinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';

const FONT_STACK = '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", "Helvetica Neue", Arial, sans-serif';
const CANVAS_W = 2048;
const CANVAS_H = 512;
const PLANE_W = 8.4;
const PLANE_H = PLANE_W * (CANVAS_H / CANVAS_W);
const PLANE_Z = -4.0;
// Fixed placement (backdropFit = 0): letters standing on the floor, a bit left of centre.
const FIXED_X = -0.45;
// World height the letter bottoms stand on (slightly above the floor, they fade into it).
const STAND_Y = 0.05;
// Portrait: the letter bottoms project just above this height at the subject (the lid).
const LIFT_ABOVE = 0.9;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFill;
uniform vec3 uStroke;
uniform float uOpacity;
uniform float uTime;
uniform float uLift;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float fill = t.r;
  float stroke = t.g;
  // Seen from the front only; fade when the camera orbits to grazing angles.
  vec3 toCam = normalize(cameraPosition - vWorld);
  float facing = smoothstep(0.3, 0.75, toCam.z);
  // Standing: sink into the floor. Lifted (portrait): no sinking, a gentle gradient.
  float vfade = mix(smoothstep(0.02, 0.42, vUv.y), 0.55 + 0.45 * smoothstep(0.1, 0.6, vUv.y), uLift);
  // Only a whisper of edge softening: the outer letters must stay readable.
  float hfade = smoothstep(0.0, 0.03, vUv.x) * (1.0 - smoothstep(0.97, 1.0, vUv.x));
  // Slow light sweep travelling along the outline.
  float sweepPos = fract(uTime * 0.035) * 1.8 - 0.4;
  float sweep = exp(-pow((vUv.x - sweepPos - (vUv.y - 0.5) * 0.25) * 5.0, 2.0));
  vec3 col = uFill * fill * (0.35 + 0.65 * vUv.y) + uStroke * stroke * (0.55 + 1.6 * sweep);
  // Lifted (portrait) the word is small: a little more presence so it still reads.
  gl_FragColor = vec4(col * uOpacity * facing * vfade * hfade * (1.0 + 0.45 * uLift), 1.0);
}
`;

// Wordmark slant (about 11°), matching the HATGEN decal on the door.
const SLANT = 0.2;

function drawWord(canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Fit the word to ~96 % of the canvas width.
  let size = 460;
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(-size * 0.02)}px`;
  const w = ctx.measureText(text).width || 1;
  // HATGEN is set in a slanted wordmark (like the door decal): leave room for the slant.
  size = Math.min(size * ((CANVAS_W * 0.9) / w), CANVAS_H * 0.98);
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(-size * 0.02)}px`;
  const m = ctx.measureText(text);
  const capH = m.actualBoundingBoxAscent || size * 0.72;
  const baseline = CANVAS_H * 0.5 + capH * 0.5;
  const wordW = Math.min(CANVAS_W, m.width || CANVAS_W * 0.96);

  // R channel: vertical gradient fill.
  const grad = ctx.createLinearGradient(0, baseline - capH, 0, baseline);
  grad.addColorStop(0, 'rgb(255,0,0)');
  grad.addColorStop(1, 'rgb(40,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  // Slant around the baseline: x' = x + SLANT * (baseline - y).
  ctx.setTransform(1, 0, -SLANT, 1, SLANT * baseline, 0);
  ctx.fillStyle = grad;
  ctx.fillText(text, CANVAS_W / 2, baseline);
  // G channel: outline.
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.012);
  ctx.strokeStyle = 'rgb(0,255,0)';
  ctx.strokeText(text, CANVAS_W / 2, baseline);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  // Letter box in uv units (v up): used by the framing.
  return { bottomV: 1 - baseline / CANVAS_H, topV: 1 - (baseline - capH) / CANVAS_H, widthU: wordW / CANVAS_W };
}

export function createBackdrop({ renderer, text = 'HATGEN' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;

  const uniforms = {
    uMap: { value: texture },
    uFill: { value: new Color('#2c0504') },
    uStroke: { value: new Color('#3a0806') },
    uOpacity: { value: 1 },
    uTime: { value: 0 },
    uLift: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const geometry = new PlaneGeometry(PLANE_W, PLANE_H);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'stage:backdrop';
  mesh.renderOrder = -20;
  mesh.matrixAutoUpdate = false;

  let current = null;
  let box = { bottomV: 0.16, topV: 0.84, widthU: 0.96 };
  function setText(next) {
    const t = String(next ?? '').trim() || 'HATGEN';
    if (t === current) return;
    current = t;
    box = drawWord(canvas, t);
    texture.needsUpdate = true;
  }
  setText(text);

  // Plane centre y for letters whose bottom sits at world height `bottomY`.
  const centerYFor = (bottomY, s) => bottomY + (0.5 - box.bottomV) * PLANE_H * s;

  const placed = { x: FIXED_X, y: centerYFor(STAND_Y, 1), s: 1, lift: 0 };
  let primed = false;
  const cam = new Vector3();
  const pl = new Vector3();
  const pr = new Vector3();
  const pc = new Vector3();

  function place(x, y, s, lift) {
    mesh.position.set(x, y, PLANE_Z);
    mesh.scale.set(s, s, 1);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    uniforms.uLift.value = lift;
  }
  place(placed.x, placed.y, placed.s, 0);

  // camera: the stage camera (matrices current), target: shot target (Vector3),
  // aspect: viewport w / h, opts: { fit, x, y, scale } (stage params), dt: seconds.
  function frame(camera, target, aspect, { fit = 1, x = 0, y = 0, scale = 1 } = {}, dt = 0) {
    let ax = FIXED_X;
    let as = 1;
    let ay = centerYFor(STAND_Y, 1);
    let lift = 0;
    const f = Math.min(1, Math.max(0, fit));
    cam.setFromMatrixPosition(camera.matrixWorld);
    const dz = target.z - cam.z;
    if (f > 0 && dz < -0.05 && cam.z > PLANE_Z + 0.5) {
      // Where the ray camera -> subject meets the backdrop plane.
      const t = (PLANE_Z - cam.z) / dz;
      const hx = cam.x + (target.x - cam.x) * t;
      // Screen width share of the word at scale 1 (ends at mid-letter height).
      const midY = centerYFor(STAND_Y, 1);
      const halfW = box.widthU * PLANE_W * 0.5;
      pl.set(hx - halfW, midY, PLANE_Z).project(camera);
      pr.set(hx + halfW, midY, PLANE_Z).project(camera);
      const share1 = (pr.x - pl.x) * 0.5;
      if (share1 > 1e-3 && pl.z < 1 && pr.z < 1) {
        lift = 1 - smoothstep(0.8, 1.05, aspect);
        const want = mix(0.78, 0.76, lift);
        as = Math.min(1.3, Math.max(0.15, want / share1));
        // Seen at an angle, the nearer half of the plane looks larger: shift so the
        // word's on-screen centre sits on the subject's on-screen position.
        pl.set(hx - halfW * as, midY, PLANE_Z).project(camera);
        pr.set(hx + halfW * as, midY, PLANE_Z).project(camera);
        const ndcPerM = (pr.x - pl.x) / (2 * halfW * as);
        const subject = pc.copy(target).project(camera).x;
        ax = ndcPerM > 1e-4 ? hx + (subject - (pl.x + pr.x) * 0.5) / ndcPerM : hx;
        // Standing letters, or lifted so the letter bottoms clear the lid on screen.
        const standY = centerYFor(STAND_Y, as);
        const hitY = cam.y + (LIFT_ABOVE - cam.y) * ((PLANE_Z - cam.z) / (target.z - cam.z));
        const liftY = centerYFor(hitY, as);
        ay = mix(standY, liftY, lift);
      }
      ax = mix(FIXED_X, ax, f);
      as = mix(1, as, f);
      ay = mix(centerYFor(STAND_Y, 1), ay, f);
      lift *= f;
    }
    // Ease toward the framing (parallax lag); snap on the first frame.
    const k = primed ? 1 - Math.exp(-Math.max(0, dt) * 2.2) : 1;
    primed = true;
    placed.x += (ax - placed.x) * k;
    placed.y += (ay - placed.y) * k;
    placed.s += (as - placed.s) * k;
    placed.lift += (lift - placed.lift) * k;
    const s = placed.s * Math.max(0.05, scale);
    place(placed.x + x, placed.y + (s - placed.s) * (0.5 - box.bottomV) * PLANE_H + y, s, placed.lift);
  }

  // Redraw once the display face is available (self-hosted @fontsource CSS).
  if (typeof document !== 'undefined' && document.fonts?.load) {
    document.fonts
      .load(`700 200px "Space Grotesk Variable"`)
      .then((faces) => {
        if (faces && faces.length) {
          const t = current;
          current = null;
          setText(t);
        }
      })
      .catch(() => {});
  }

  return {
    mesh,
    uniforms,
    setText,
    frame,
    // Next frame() snaps to the framing instead of easing (after being hidden).
    snap() {
      primed = false;
    },
    get text() {
      return current;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
