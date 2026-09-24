// Light rig:
//   key    warm-white spot, top front left, the only shadow caster (reads the front face)
//   top    neutral overhead spot, floor pool + lid highlight; the visible beam follows it.
//          No shadow map: the baked contact shadow grounds the unit (a hard overhead
//          shadow read as a black rug under the wheels).
//   rimL   brand red, behind left, below the lid top: a sheen that fades toward the front
//   rimR   brand red, behind right
//   fill   cool-neutral dim directional from front right
// The two rims turn with the camera azimuth (x 0.8), so they always sit behind the
// subject as seen by the viewer (rear views and turntable included). While the camera
// sees an end panel, the rim on that side is also pulled inside the panel's plane (see
// setView). They cast no shadows, so moving them is free. The floor shader masks the red
// rims so they leave only a backlight glow behind the unit (no red pools in front of it).
import { Color, DirectionalLight, Group, MathUtils, SpotLight, Vector2, Vector3 } from 'three';

// Designed intensities (physical units: candela for spots, lux-ish for the fill).
export const LIGHT_BASE = {
  key: 95,
  top: 80,
  rimL: 22,
  rimR: 24,
  fill: 0.6,
};

export const TOP_POSITION = new Vector3(0.1, 5.6, -0.25);
export const TOP_TARGET = new Vector3(0, 0, 0);
export const TOP_ANGLE = 0.27;

// How much of the camera azimuth the rim rig follows.
const RIM_FOLLOW = 0.8;
// End panels of the unit (x = ±END_X, centre height END_Y). A rim on the camera side of
// a visible end panel lights the whole panel at a grazing angle, and the flat powder
// coat mirrors it straight at the viewer: a saturated red slab (camera azimuth about 10
// to 22°). While the camera sees an end panel, the rim on that side is therefore kept
// inside the panel's plane (|x| <= RIM_INSIDE_X): it then only draws the thin line on
// the rear vertical bevel, which is the silhouette from that side.
const END_X = 0.47;
const END_Y = 0.45;
const RIM_INSIDE_X = 0.3;
// Sine of the angle the camera sees the end panel at, over which the pull ramps in.
const END_FACING = 0.08;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function spot({ name, color, intensity, angle, penumbra, position, target }) {
  const l = new SpotLight(new Color(color), intensity, 0, angle, penumbra, 2);
  l.name = name;
  l.position.copy(position);
  l.target.position.copy(target);
  return l;
}

function shadow(light, { size, near, far, focus, bias = -0.0002, normalBias = 0.015, radius = 3 }) {
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.camera.near = near;
  light.shadow.camera.far = far;
  light.shadow.focus = focus;
  light.shadow.bias = bias;
  light.shadow.normalBias = normalBias;
  light.shadow.radius = radius;
  // The stage decides when shadow maps are refreshed (only when the product moves).
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
}

export function createLights() {
  const group = new Group();
  group.name = 'stage:lights';

  const key = spot({
    name: 'stage:key',
    color: '#fffaf6',
    intensity: LIGHT_BASE.key,
    angle: 0.36,
    penumbra: 0.85,
    position: new Vector3(-2.4, 3.3, 3.1),
    target: new Vector3(0, 0.35, 0),
  });
  shadow(key, { size: 2048, near: 2.5, far: 9, focus: 0.75, radius: 3 });

  const top = spot({
    name: 'stage:top',
    color: '#f7f5f3',
    intensity: LIGHT_BASE.top,
    angle: TOP_ANGLE,
    penumbra: 0.85,
    position: TOP_POSITION,
    target: TOP_TARGET,
  });
  top.castShadow = false;

  // Rims: behind the unit, low (well below the lid top at 0.8 m, so the lid never
  // flares and the tilted vent louvres do not mirror them toward the camera), narrow
  // soft cones aimed at the rear vertical edges: the bevels draw a thin red line.
  // Positions below are for a front view (azimuth 0); setView() places them in world space.
  const rimGroup = new Group();
  rimGroup.name = 'stage:rims';
  const rimColor = '#ff2419';
  const rimL = spot({
    name: 'stage:rimL',
    color: rimColor,
    intensity: LIGHT_BASE.rimL,
    angle: 0.14,
    penumbra: 1,
    position: new Vector3(-1.3, 0.55, -3.3),
    target: new Vector3(-0.47, 0.45, -0.27),
  });
  const rimR = spot({
    name: 'stage:rimR',
    color: rimColor,
    intensity: LIGHT_BASE.rimR,
    angle: 0.14,
    penumbra: 1,
    position: new Vector3(1.5, 0.55, -3.2),
    target: new Vector3(0.47, 0.45, -0.27),
  });
  rimGroup.add(rimL, rimL.target, rimR, rimR.target);
  const rims = [rimL, rimR].map((light, i) => ({
    light,
    side: i === 0 ? -1 : 1,
    position: light.position.clone(),
    target: light.target.position.clone(),
  }));

  group.add(key, key.target, top, top.target, rimGroup);

  const fill = new DirectionalLight(new Color('#dfe3ee'), LIGHT_BASE.fill);
  fill.name = 'stage:fill';
  fill.position.set(3.2, 1.4, 3.4);
  fill.target.position.set(0, 0.4, 0);
  group.add(fill, fill.target);

  const casters = [key];
  // Unit vector (x, z) pointing from the unit toward the viewer side of the rim rig.
  const rimForward = new Vector2(0, 1);

  return {
    group,
    key,
    top,
    rimL,
    rimR,
    rimGroup,
    fill,
    casters,
    rimForward,
    // False while a caster has no shadow map yet (start, resolution change, context restore).
    get shadowsReady() {
      for (const l of casters) if (!l.shadow.map) return false;
      return true;
    },
    // Mark every shadow map for re-render on the next frame.
    invalidateShadows() {
      for (const l of casters) l.shadow.needsUpdate = true;
    },
    // After a WebGL context restore: the old maps belong to the dead context. Drop them
    // (no dispose, that would delete foreign GL objects) so three allocates fresh ones.
    dropShadowMaps() {
      for (const l of casters) {
        l.shadow.map = null;
        l.shadow.needsUpdate = true;
      }
    },
    setShadowQuality({ shadowMapSize, shadowRadius }) {
      for (const l of casters) {
        if (l.shadow.mapSize.x !== shadowMapSize) {
          l.shadow.mapSize.set(shadowMapSize, shadowMapSize);
          if (l.shadow.map) {
            l.shadow.map.dispose();
            l.shadow.map = null;
          }
        }
        l.shadow.needsUpdate = true;
      }
      key.shadow.radius = shadowRadius;
    },
    // Camera azimuth in degrees (0 = front) and world position. The rims turn by 80 % of
    // the azimuth; a rim facing a visible end panel is pulled inside the panel's plane.
    setView(deg, cameraPosition = null) {
      const a = MathUtils.degToRad(deg) * RIM_FOLLOW;
      const c = Math.cos(a);
      const s = Math.sin(a);
      rimForward.set(s, c);
      for (const r of rims) {
        const p = r.light.position;
        const t = r.light.target.position;
        p.set(r.position.x * c + r.position.z * s, r.position.y, r.position.z * c - r.position.x * s);
        t.set(r.target.x * c + r.target.z * s, r.target.y, r.target.z * c - r.target.x * s);
        const out = r.side * p.x - RIM_INSIDE_X;
        const dx = cameraPosition ? r.side * cameraPosition.x - END_X : 0;
        if (out > 0 && dx > 0) {
          const facing = dx / Math.hypot(dx, cameraPosition.y - END_Y, cameraPosition.z);
          p.x -= r.side * out * smoothstep(0, END_FACING, facing);
        }
      }
    },
    // Multipliers: 1 = designed look. In blueprint mode the rims are gone before the
    // bloom threshold drops (no red bloom blob on the lid halfway through).
    apply({ key: k = 1, rim = 1, fill: f = 1, blueprint = 0 }) {
      const dim = 1 - 0.82 * smoothstep(0, 0.7, blueprint);
      const rimDim = 1 - smoothstep(0, 0.5, blueprint);
      key.intensity = LIGHT_BASE.key * k * dim;
      top.intensity = LIGHT_BASE.top * k * dim;
      rimL.intensity = LIGHT_BASE.rimL * rim * rimDim;
      rimR.intensity = LIGHT_BASE.rimR * rim * rimDim;
      // (Lights stay visible at intensity 0: toggling visibility changes the light
      // count and would recompile every material.)
      fill.intensity = LIGHT_BASE.fill * f * dim;
    },
  };
}
