// Stage harness: renders the stage with a stand-in product (or the real generator
// with ?gen=1) and exposes every shot + stage param as a URL parameter, e.g.
// ?az=25&el=10&dist=3.2&ty=0.42&offsetX=0.18&key=1&rim=1&backdrop=1&dust=1&beam=1&blueprint=0&quality=high
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import {
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createStage, STAGE_PRESETS } from '../src/three/stage/index.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && q.get(k) !== '' && !Number.isNaN(+q.get(k)) ? +q.get(k) : d);
const str = (k, d) => (q.has(k) ? q.get(k) : d);

const canvas = document.getElementById('webgl');
const stage = createStage({
  canvas,
  quality: str('quality', 'high'),
  // ?adaptive=1 (auto probe), ?adaptive=manual (probe starts via stage.startQualityProbe())
  adaptive: str('adaptive', '0') === 'manual' ? 'manual' : str('adaptive', '0') === '1',
  toneMapping: str('tm', 'neutral'),
  environment: str('envmode', 'studio'),
});
window.__stage = stage;

// ------------------------------------------------------------------ shot + params
const shot = {
  azimuth: num('az', 25),
  elevation: num('el', 10),
  distance: num('dist', 3.2),
  target: [num('tx', 0), num('ty', 0.42), num('tz', 0)],
  fov: num('fov', 35),
  offsetX: num('offsetX', num('ox', 0)),
  offsetY: num('offsetY', num('oy', 0)),
};
stage.setShot(shot);

// ?preset=inside applies a scene preset first; explicit params override it.
const stageParams = { ...(STAGE_PRESETS[q.get('preset')] || {}) };
for (const k of ['key', 'rim', 'fill', 'exposure', 'bloom', 'vignette', 'floor', 'grid', 'backdrop', 'dust', 'beam', 'tint', 'blueprint', 'env', 'reflection', 'backdropFit', 'backdropX', 'backdropY', 'backdropScale']) {
  if (q.has(k)) stageParams[k] = num(k, undefined);
}
if (q.has('text')) stageParams.backdropText = q.get('text');
stage.set(stageParams);

// ------------------------------------------------------------------ product
const genState = {
  open: num('open', 0),
  explode: num('explode', 0),
  blueprint: num('blueprint', 0),
  dimensions: num('dimensions', 0),
  power: num('power', 1),
  running: num('running', 0),
  highlight: q.get('highlight') || null,
  model: str('model', 's5500'),
};

let product = null;
if (q.get('gen') === '1') {
  try {
    const path = '../src/three/generator/index.js';
    const mod = await import(/* @vite-ignore */ path);
    const gen = mod.createGenerator({ renderer: stage.renderer, quality: stage.quality });
    stage.add(gen.object);
    gen.set(genState);
    stage.onFrame((dt, t) => gen.update(dt, t));
    product = { kind: 'generator', gen, anchors: gen.anchors };
  } catch (e) {
    console.warn('[harness] generator not available, using stand-in:', e.message);
  }
}
if (!product) {
  const standIn = buildStandIn();
  stage.add(standIn.object);
  standIn.setBlueprint(genState.blueprint);
  product = { kind: 'stand-in', anchors: standIn.anchors, standIn };
}
window.__product = product;

// ------------------------------------------------------------------ optional motion
if (q.get('orbit') === '1') {
  const base = shot.azimuth;
  stage.onFrame((dt, t) => stage.setShot({ azimuth: base + Math.sin(t * 0.25) * 30 }));
}
if (q.get('intro') === '1') {
  stage.set({ key: 0, rim: 0, fill: 0, env: 0 });
  const t0 = performance.now();
  stage.onFrame(() => {
    const p = Math.min(1, (performance.now() - t0) / 3500);
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    stage.set({ rim: ease(p * 2), key: ease(p * 2 - 0.6), fill: ease(p * 2 - 1), env: ease(p * 1.6 - 0.4) });
  });
}

// Projection marker: ?marker=display draws a ring where stage.project() puts the anchor.
const markerName = q.get('marker');
if (markerName && product.anchors?.[markerName]) {
  const el = document.getElementById('marker');
  el.hidden = false;
  const out = {};
  stage.onFrame(() => {
    stage.project(product.anchors[markerName], out);
    el.style.transform = `translate3d(${out.x}px, ${out.y}px, 0)`;
    el.style.opacity = out.visible ? 1 : 0.25;
  });
}

// HUD
if (q.get('hud') === '1') {
  const hud = document.getElementById('hud');
  hud.hidden = false;
  let acc = 0;
  let frames = 0;
  let fps = 0;
  stage.onFrame((dt) => {
    acc += dt;
    frames++;
    if (acc > 0.5) {
      fps = frames / acc;
      acc = 0;
      frames = 0;
      const info = stage.renderer.info;
      const st = stage.stats;
      hud.textContent = `${product.kind} · ${stage.quality} · dpr ${stage.size.dpr.toFixed(2)} · probe ${stage.qualityProbe}\n${fps.toFixed(0)} fps · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris\nbakes: shadow ${st.shadowBakes} · contact ${st.contactBakes} · refl ${st.reflectionRenders}`;
    }
  });
}
stage.onQualityChange((qname, reason) => console.info(`[harness] quality -> ${qname} (${reason})`));

await stage.compile();
stage.start();
// Signal for automated screenshots.
requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));

// ------------------------------------------------------------------ stand-in product
function buildStandIn() {
  const root = new Group();
  root.name = 'standIn';
  const anchors = {};

  const powder = new MeshPhysicalMaterial({
    color: new Color('#131313'),
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.32,
  });
  const panelMat = new MeshStandardMaterial({ color: new Color('#1b1b1c'), roughness: 0.5 });
  const steel = new MeshStandardMaterial({ color: new Color('#d8d8d8'), metalness: 1, roughness: 0.3 });
  const rubber = new MeshStandardMaterial({ color: new Color('#0c0c0c'), roughness: 0.9 });
  const blue = new MeshPhysicalMaterial({ color: new Color('#1f6fd6'), roughness: 0.35, clearcoat: 0.6 });
  const red = new MeshPhysicalMaterial({ color: new Color('#c8211a'), roughness: 0.45, clearcoat: 0.3 });
  const display = new MeshStandardMaterial({
    color: new Color('#050505'),
    emissive: new Color('#ff2a1a'),
    emissiveIntensity: 3.2,
    toneMapped: false,
  });

  const add = (geo, mat, x, y, z, { cast = true, receive = true } = {}) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    root.add(m);
    return m;
  };

  // Body 0.95 x 0.60 x 0.55 on a plinth, lid band on top, total height 0.80 incl. wheels.
  add(new RoundedBoxGeometry(0.95, 0.6, 0.55, 3, 0.012), powder, 0, 0.405, 0);
  const lid = add(new RoundedBoxGeometry(0.97, 0.095, 0.57, 3, 0.01), powder, 0, 0.7525, 0);
  add(new RoundedBoxGeometry(0.86, 0.05, 0.46, 2, 0.006), powder, 0, 0.105, 0);
  // Door (left ~62 %) and inset control panel (right ~38 %).
  add(new RoundedBoxGeometry(0.55, 0.5, 0.012, 2, 0.004), powder, -0.17, 0.41, 0.278);
  const panel = add(new RoundedBoxGeometry(0.3, 0.5, 0.01, 2, 0.003), panelMat, 0.29, 0.41, 0.272);
  const disp = add(new PlaneGeometry(0.075, 0.042), display, 0.245, 0.5, 0.2785, { cast: false });
  const cee = add(new RoundedBoxGeometry(0.075, 0.1, 0.06, 2, 0.01), red, 0.38, 0.25, 0.3);
  const s1 = add(new RoundedBoxGeometry(0.06, 0.06, 0.03, 2, 0.008), blue, 0.39, 0.53, 0.29);
  add(new RoundedBoxGeometry(0.06, 0.06, 0.03, 2, 0.008), blue, 0.39, 0.44, 0.29);
  // Fuel cap + handle bars on top.
  const cap = add(new CylinderGeometry(0.045, 0.045, 0.022, 32), blue, -0.25, 0.811, 0.12);
  const bar = new CylinderGeometry(0.011, 0.011, 0.82, 16);
  bar.rotateZ(Math.PI / 2);
  add(bar, steel, 0, 0.815, 0.25);
  add(bar, steel, 0, 0.815, -0.25);
  // Bolts.
  const bolt = new SphereGeometry(0.008, 12, 8);
  for (const [x, y] of [[-0.44, 0.67], [0.44, 0.67], [-0.44, 0.15], [0.44, 0.15], [-0.2, 0.67], [0.2, 0.67]]) {
    add(bolt, steel, x, y, 0.279, { cast: false });
  }
  // Wheels.
  const wheel = new CylinderGeometry(0.05, 0.05, 0.035, 24);
  wheel.rotateX(Math.PI / 2);
  for (const [x, z] of [[-0.38, 0.2], [0.38, 0.2], [-0.38, -0.2], [0.38, -0.2]]) add(wheel, rubber, x, 0.05, z);

  anchors.display = disp;
  anchors.cee = cee;
  anchors.schuko1 = s1;
  anchors.panel = panel;
  anchors.fuelCap = cap;
  anchors.lid = lid;

  // Blueprint emulation: dark occluders + red edge lines.
  const lineMat = new LineBasicMaterial({ color: new Color('#ff3b36'), transparent: true, opacity: 0, toneMapped: false });
  const lines = new Group();
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  for (const m of meshes) {
    const l = new LineSegments(new EdgesGeometry(m.geometry, 12), lineMat);
    l.position.copy(m.position);
    l.quaternion.copy(m.quaternion);
    l.scale.copy(m.scale);
    lines.add(l);
  }
  root.add(lines);
  const mats = [powder, panelMat, steel, rubber, blue, red];
  const orig = mats.map((m) => ({ c: m.color.clone(), r: m.roughness, e: m.envMapIntensity }));
  const dark = new Color('#070202');

  return {
    object: root,
    anchors,
    setBlueprint(bp) {
      mats.forEach((m, i) => {
        m.color.copy(orig[i].c).lerp(dark, bp);
        m.roughness = orig[i].r + (1 - orig[i].r) * bp;
        // Push occluders back a hair so the coincident edge lines win the depth test.
        m.polygonOffset = bp > 0.001;
        m.polygonOffsetFactor = 1;
        m.polygonOffsetUnits = 1;
      });
      display.emissiveIntensity = 3.2 * (1 - bp);
      lineMat.opacity = bp;
      lines.visible = bp > 0.001;
    },
  };
}
