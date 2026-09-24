// 3D dimension lines (length along the front bottom edge, depth along the side bottom edge,
// height diagonally off the rear side corner, i.e. on the silhouette for the usual 3/4
// front views, clear of the vents) with architectural ticks and mono labels.
//
// Labels are sprites with a constant on-screen size (font ~13 px on phones, ~16 px on
// desktop), independent of camera distance and viewport height. The whole set mirrors to
// the other side when the camera looks from the left, so the depth line stays visible.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { L, W, H, LID } from './dims.js';
import { seg, easeOut, easeInOut } from './utils.js';

const RED = 0xff3b36;
const _size = new THREE.Vector2();
const _inv = new THREE.Matrix4();
const _cam = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _lp = new THREE.Vector3();

function lineMat(width, opacity) {
  // DoubleSide: the set is mirrored (negative scale) when the camera is on the left, which
  // flips the winding of the screen-space line quads
  const m = new LineMaterial({ color: RED, linewidth: width, transparent: true, opacity, depthWrite: false, worldUnits: false, side: THREE.DoubleSide });
  m.toneMapped = false;
  return m;
}

export function createDimensions(ctx, parent, bounds) {
  const { tex } = ctx;
  const group = new THREE.Group();
  group.name = 'dimensions';
  group.visible = false;
  parent.add(group);

  const off = 0.09; // distance of the dimension line from the unit
  const ext = 0.022; // extension line overshoot
  const tick = 0.013;
  const y0 = 0.003;
  const hx = L / 2;
  const hz = W / 2;
  const s2 = Math.SQRT1_2 * tick;
  const dg = off * 0.7; // diagonal offset of the height line (x and z)
  const dn = Math.SQRT1_2; // outward diagonal normal (x, z)

  const defs = [
    {
      key: 'length',
      a: new THREE.Vector3(-hx, y0, hz + off),
      b: new THREE.Vector3(hx, y0, hz + off),
      ext: [[-hx, y0, hz + 0.012, -hx, y0, hz + off + ext], [hx, y0, hz + 0.012, hx, y0, hz + off + ext]],
      tickDir: [s2, 0, s2],
      label: [0, y0, hz + off + 0.052],
    },
    {
      key: 'depth',
      a: new THREE.Vector3(hx + off, y0, hz),
      b: new THREE.Vector3(hx + off, y0, -hz),
      ext: [[hx + 0.012, y0, hz, hx + off + ext, y0, hz], [hx + 0.012, y0, -hz, hx + off + ext, y0, -hz]],
      tickDir: [s2, 0, s2],
      label: [hx + off + 0.06, y0, 0],
    },
    {
      key: 'height',
      a: new THREE.Vector3(hx + dg, 0, -hz - dg),
      b: new THREE.Vector3(hx + dg, H, -hz - dg),
      ext: [
        [LID.notchX + 0.01, H, -hz - 0.006, hx + dg + ext * dn, H, -hz - dg - ext * dn],
        [hx + 0.008, y0, -hz - 0.008, hx + dg + ext * dn, y0, -hz - dg - ext * dn],
      ],
      tickDir: [tick * 0.5, tick * dn, -tick * 0.5],
      label: [hx + dg + 0.06 * dn, H * 0.62, -hz - dg - 0.06 * dn],
    },
  ];

  // Mirror the set to the camera side (object space).
  let side = 1;
  function syncSide(camera) {
    _inv.copy(parent.matrixWorld).invert();
    _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
    const want = _cam.x < -0.05 ? -1 : _cam.x > 0.05 ? 1 : side;
    if (want !== side) {
      side = want;
      group.scale.x = side;
      group.updateMatrixWorld(true);
    }
  }

  function lineObj(positions, mat) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);
    const obj = new LineSegments2(geo, mat);
    obj.onBeforeRender = (renderer, scene, camera) => {
      syncSide(camera);
      renderer.getSize(_size);
      mat.resolution.copy(_size);
    };
    obj.renderOrder = 3;
    obj.frustumCulled = false;
    return obj;
  }

  _box.copy(bounds).expandByScalar(-0.03);
  const dims = defs.map((d, i) => {
    const mid = d.a.clone().add(d.b).multiplyScalar(0.5);
    const dir = d.b.clone().sub(d.a);
    const len = dir.length();
    dir.normalize();
    const mMain = lineMat(1.5, 1);
    const mDetail = lineMat(1.0, 0.7);
    // main line: unit segment along local X, scaled to grow from its center
    const main = lineObj([-0.5, 0, 0, 0.5, 0, 0], mMain);
    main.position.copy(mid);
    main.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    main.scale.set(0.0001, 1, 1);
    group.add(main);
    // extension lines + 45° ticks at both ends
    const pts = [];
    for (const e of d.ext) pts.push(...e);
    for (const p of [d.a, d.b]) {
      const [tx, ty, tz] = d.tickDir;
      pts.push(p.x - tx, p.y - ty, p.z - tz, p.x + tx, p.y + ty, p.z + tz);
    }
    const detail = lineObj(pts, mDetail);
    group.add(detail);
    // label sprite (constant pixel size, see onBeforeRender)
    const lt = tex.dims[d.key];
    const sm = new THREE.SpriteMaterial({ map: lt.texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 });
    sm.toneMapped = false;
    const label = new THREE.Sprite(sm);
    label.position.set(...d.label);
    label.renderOrder = 4;
    label.scale.set(0.001 * lt.aspect, 0.001, 1);
    group.add(label);
    const dim = { i, len, main, detail, label, mMain, mDetail, sm, lp: 0, vis: 1, aspect: lt.aspect };
    // Labels ignore the depth buffer (never clipped by the floor), but fade out when the
    // unit itself stands between camera and label.
    label.onBeforeRender = (renderer, scene, camera) => {
      syncSide(camera);
      // constant on-screen size: font px = clamp(3.4 % of the short viewport side, 12, 16);
      // the label canvas is twice as tall as its font
      renderer.getSize(_size);
      const vpH = Math.max(1, _size.y);
      const fontPx = Math.min(16, Math.max(12, 0.034 * Math.min(_size.x, _size.y)));
      const grow = 0.9 + 0.1 * dim.lp;
      let h = ((2 * fontPx) / vpH) * grow;
      if (camera.isPerspectiveCamera) h *= 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(0.01, camera.zoom);
      label.scale.set(h * dim.aspect, h, 1);
      label.updateMatrix();
      label.matrixWorld.multiplyMatrices(group.matrixWorld, label.matrix);
      label.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, label.matrixWorld);
      // occlusion by the unit (object space)
      _inv.copy(parent.matrixWorld).invert();
      _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
      _lp.setFromMatrixPosition(label.matrixWorld).applyMatrix4(_inv);
      _dir.copy(_lp).sub(_cam);
      const dist = _dir.length();
      _ray.set(_cam, _dir.normalize());
      const hit = _ray.intersectBox(_box, _hit);
      const target = hit && _cam.distanceTo(hit) < dist - 0.02 ? 0 : 1;
      dim.vis += (target - dim.vis) * 0.25;
      sm.opacity = dim.lp * dim.vis;
    };
    return dim;
  });

  let current = -1;
  function set(v) {
    if (v === current) return;
    current = v;
    group.visible = v > 0.001;
    if (!group.visible) return;
    for (const d of dims) {
      const p = seg(v, d.i * 0.16, d.i * 0.16 + 0.62);
      const grow = easeInOut(seg(p, 0, 0.7));
      d.main.scale.x = Math.max(0.0001, d.len * grow);
      d.main.visible = grow > 0.001;
      d.mMain.opacity = Math.min(1, grow * 3);
      d.mDetail.opacity = 0.75 * seg(p, 0.05, 0.45);
      d.detail.visible = d.mDetail.opacity > 0.001;
      const lp = easeOut(seg(p, 0.6, 1));
      d.lp = lp;
      d.sm.opacity = lp * d.vis;
      d.label.visible = lp > 0.001;
    }
  }

  function dispose() {
    for (const d of dims) {
      d.main.geometry.dispose();
      d.detail.geometry.dispose();
      d.mMain.dispose();
      d.mDetail.dispose();
      d.sm.dispose();
    }
    parent.remove(group);
  }

  return { group, set, dispose };
}
