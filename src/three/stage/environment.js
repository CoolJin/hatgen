// Image based lighting. Default is a custom "studio" built from emissive light
// formers (big top softbox, warm key softbox, cool fill card, brand-red strip lights
// behind) so black powder coat and clearcoat pick up clean product-shot reflections.
// mode 'room' falls back to three's RoomEnvironment.
import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  DoubleSide,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function buildStudioScene() {
  const scene = new Scene();
  const disposables = [];
  const mat = (hex, intensity) => {
    const m = new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(intensity), side: DoubleSide });
    disposables.push(m);
    return m;
  };
  const plane = new PlaneGeometry(1, 1);
  disposables.push(plane);

  // Dark room shell with a faint warm cast so reflections are not dead black (kept low
  // in saturation: a red shell turned the black lid maroon in top views).
  const shellGeo = new SphereGeometry(20, 32, 16);
  disposables.push(shellGeo);
  const shell = new Mesh(shellGeo, new MeshBasicMaterial({ color: new Color('#0b0606'), side: BackSide }));
  disposables.push(shell.material);
  scene.add(shell);

  const former = (hex, intensity, w, h, x, y, z) => {
    const m = new Mesh(plane, mat(hex, intensity));
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    m.lookAt(0, 0.4, 0);
    scene.add(m);
    return m;
  };

  // Big overhead softbox (slightly front), gives the lid a long soft highlight.
  former('#fff4ec', 1.5, 7, 3.2, -0.6, 7, 1.2);
  // Warm-white key softbox front left (matches the key spot direction; kept close to
  // neutral so the black powder coat does not read brown).
  former('#fff3ea', 3.2, 3.2, 4.2, -5.2, 3.6, 5.6);
  // Cool-neutral fill card front right, low intensity (a blue card turned black paint navy).
  former('#dfe3ee', 0.6, 3.5, 3, 6.5, 2.2, 5.5);
  // Brand-red strip lights behind left and right: red edge reflections on the sides.
  // Low and short, so they read in the vertical edges and end panels at grazing angles
  // but do not wash upward-facing surfaces (the lid read maroon in top views).
  former('#ff2a1c', 4.5, 0.9, 3.2, -6.5, 1.3, -5.5);
  former('#ff2a1c', 4.5, 0.9, 3.2, 6.8, 1.3, -5);
  // Horizontal red strip high behind for the lid/top edge.
  former('#ff3322', 1.3, 9, 0.8, 0, 5.5, -7.5);
  // Faint warm floor bounce.
  const floor = new Mesh(new BoxGeometry(14, 0.1, 14), mat('#1c1616', 0.35));
  disposables.push(floor.geometry);
  floor.position.y = -2.2;
  scene.add(floor);

  return { scene, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export function createEnvironmentTexture(renderer, mode = 'studio') {
  const pmrem = new PMREMGenerator(renderer);
  let rt;
  if (mode === 'room') {
    const room = new RoomEnvironment();
    rt = pmrem.fromScene(room, 0.04);
    room.dispose?.();
  } else {
    const { scene, dispose } = buildStudioScene();
    rt = pmrem.fromScene(scene, 0.035);
    dispose();
  }
  pmrem.dispose();
  rt.texture.name = `stage:env:${mode}`;
  return rt;
}
