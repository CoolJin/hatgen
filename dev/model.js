// Model harness: renders the procedural generator with a simple studio light setup.
// URL params (all optional):
//   az, el, dist, tx, ty, tz, fov              camera (deg / m), az 0 = front, + = toward +X
//   open, explode, blueprint, dimensions, power, running (0..1), highlight=<anchor>, model=s5500|s6500
//   quality=high|medium|low, tm=aces|agx, exposure, env, floor=0|1, hud=1, anchors=1, async=1
//   anim=open|explode|turn   simple looping animation for eyeballing motion
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createGenerator, createGeneratorAsync, ANCHOR_NAMES } from '../src/three/generator/index.js';

const P = new URLSearchParams(location.search);
const num = (k, d) => (P.has(k) ? parseFloat(P.get(k)) : d);

const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = P.get('tm') === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0202);
scene.fog = new THREE.Fog(0x0a0202, 6, 16);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = num('env', 0.5);

// key light: warm, top-front-left, soft shadows
const key = new THREE.DirectionalLight(0xfff0e4, 2.4);
key.position.set(-1.7, 3.0, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 1.4, bottom: -0.6, near: 0.5, far: 8 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.012;
key.shadow.radius = 4;
scene.add(key);
// two red rim lights from behind
for (const sx of [-1, 1]) {
  const rim = new THREE.SpotLight(0xff2a1c, 9, 7, 0.5, 0.9, 1.4);
  rim.position.set(sx * 1.9, 1.5, -2.0);
  rim.target.position.set(0, 0.4, 0);
  scene.add(rim, rim.target);
}
// cool dim fill
const fill = new THREE.DirectionalLight(0xa8b8ff, 0.35);
fill.position.set(2.5, 1.2, 2.0);
scene.add(fill);

if (num('floor', 1)) {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0x120707, roughness: 0.92, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.03, 60);
const view = { az: 35, el: 20, dist: 2.6, tx: 0, ty: 0.45, tz: 0, fov: 35 };
function applyView(v) {
  Object.assign(view, v);
  const az = THREE.MathUtils.degToRad(view.az);
  const el = THREE.MathUtils.degToRad(view.el);
  const t = new THREE.Vector3(view.tx, view.ty, view.tz);
  camera.fov = view.fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.position.set(t.x + view.dist * Math.cos(el) * Math.sin(az), t.y + view.dist * Math.sin(el), t.z + view.dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(t);
  camera.updateProjectionMatrix();
}
applyView(Object.fromEntries(['az', 'el', 'dist', 'tx', 'ty', 'tz', 'fov'].filter((k) => P.has(k)).map((k) => [k, num(k)])));

globalThis.__HATGEN_DEBUG = true;
const t0 = performance.now();
// async=1: build with createGeneratorAsync (a frame between stages, progress in the log)
const genOpts = { renderer, quality: P.get('quality') || 'high' };
const gen = P.get('async') === '1'
  ? await createGeneratorAsync({ ...genOpts, onProgress: (f) => console.log(`[harness] progress ${f.toFixed(2)} at ${(performance.now() - t0).toFixed(0)} ms`) })
  : createGenerator(genOpts);
const buildMs = performance.now() - t0;
scene.add(gen.object);

const state = {
  open: num('open', 0),
  explode: num('explode', 0),
  blueprint: num('blueprint', 0),
  dimensions: num('dimensions', 0),
  power: num('power', 0),
  running: num('running', 0),
  highlight: P.get('highlight') || null,
  model: P.get('model') || 's5500',
};
gen.set(state);
if (state.blueprint > 0) {
  scene.background = new THREE.Color(0x070202);
  scene.environmentIntensity *= 1 - state.blueprint * 0.8;
}

// optional anchor markers
const markers = [];
if (P.get('anchors') === '1') {
  for (const name of ANCHOR_NAMES) {
    const a = gen.anchors[name];
    if (!a) continue;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0x33ff88, depthTest: false }));
    m.renderOrder = 10;
    scene.add(m);
    markers.push([a, m]);
  }
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  applyView({});
});

const anim = P.get('anim');
const timer = new THREE.Timer();
timer.connect?.(document);
let frames = 0;
const tmp = new THREE.Vector3();
function frame() {
  timer.update();
  const dt = timer.getDelta();
  const t = timer.getElapsed();
  if (anim === 'open') gen.set({ open: 0.5 - 0.5 * Math.cos(t * 0.8) });
  if (anim === 'explode') gen.set({ open: 1, explode: 0.5 - 0.5 * Math.cos(t * 0.8) });
  if (anim === 'turn') applyView({ az: view.az + dt * 20 });
  gen.update(dt, t);
  for (const [a, m] of markers) m.position.copy(a.getWorldPosition(tmp));
  renderer.render(scene, camera);
  frames++;
  if (frames === 3) {
    const info = renderer.info.render;
    const s = gen.stats();
    const msg = `build ${buildMs.toFixed(0)} ms · calls ${info.calls} · tris ${info.triangles} · meshes ${s.meshes} · geoTris ${s.triangles} · mats ${s.materials}`;
    console.log('[harness] ' + msg);
    if (P.get('hud') === '1') hud.textContent = msg;
    window.__ready = true;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__gen = gen;
window.__apply = (v = {}) => {
  const { az, el, dist, tx, ty, tz, fov, ...rest } = v;
  applyView(Object.fromEntries(Object.entries({ az, el, dist, tx, ty, tz, fov }).filter(([, x]) => x !== undefined)));
  gen.set(rest);
  const bp = gen.state.blueprint;
  scene.background = new THREE.Color(bp > 0 ? 0x070202 : 0x0a0202);
  scene.environmentIntensity = num('env', 0.5) * (1 - bp * 0.8);
};
