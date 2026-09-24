// Camera rig: spherical shot around a target plus a perspective-preserving screen offset.
import { MathUtils, Vector3 } from 'three';

export const DEFAULT_SHOT = {
  azimuth: 25,
  elevation: 10,
  distance: 3.2,
  target: [0, 0.42, 0],
  fov: 35,
  offsetX: 0,
  offsetY: 0,
};

export function createShotRig(camera) {
  const shot = { ...DEFAULT_SHOT, target: [...DEFAULT_SHOT.target] };
  const tgt = new Vector3();
  let vw = 1;
  let vh = 1;
  // Height of the frame box the shot is composed in (<= vh). The canvas may be taller than
  // the layout's viewport box (mobile: canvas 100lvh, pinned layout 100svh); fov and
  // offsets then refer to the top vw x fh box and the canvas extends below it.
  let fh = 1;
  // Last applied projection inputs, so per-frame setShot calls only touch the
  // projection matrix when something actually changed.
  let appliedFov = NaN;
  let appliedAspect = NaN;
  let appliedOX = NaN;
  let appliedOY = NaN;

  function applyProjection(force = false) {
    const aspect = vw / fh;
    const ox = shot.offsetX || 0;
    const oy = shot.offsetY || 0;
    if (!force && shot.fov === appliedFov && aspect === appliedAspect && ox === appliedOX && oy === appliedOY) return;
    camera.fov = shot.fov;
    camera.aspect = aspect;
    if (ox !== 0 || oy !== 0 || fh !== vh) {
      // Off-axis projection: move the view window opposite to the desired subject shift.
      // offsetX > 0 moves the subject right, offsetY > 0 moves it down (CSS convention).
      // The full view is the frame box; the rendered window is the whole canvas.
      camera.setViewOffset(vw, fh, -ox * vw, -oy * fh, vw, vh);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    appliedFov = shot.fov;
    appliedAspect = aspect;
    appliedOX = ox;
    appliedOY = oy;
  }

  function applyPose() {
    const t = shot.target;
    tgt.set(t[0], t[1], t[2]);
    const az = MathUtils.degToRad(shot.azimuth);
    const el = MathUtils.degToRad(MathUtils.clamp(shot.elevation, -89, 89));
    const d = Math.max(0.05, shot.distance);
    const ce = Math.cos(el);
    camera.position.set(tgt.x + d * Math.sin(az) * ce, tgt.y + d * Math.sin(el), tgt.z + d * Math.cos(az) * ce);
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  }

  return {
    shot,
    targetVector: tgt,
    set(next = {}) {
      for (const k in next) {
        const v = next[k];
        if (v === undefined || v === null) continue;
        if (k === 'target') {
          if (Array.isArray(v)) {
            shot.target[0] = v[0];
            shot.target[1] = v[1];
            shot.target[2] = v[2];
          } else if (v.isVector3) {
            shot.target[0] = v.x;
            shot.target[1] = v.y;
            shot.target[2] = v.z;
          }
        } else if (k in shot) {
          shot[k] = v;
        }
      }
      applyPose();
      applyProjection();
    },
    // w, h: canvas CSS size; frameH: height of the frame box at the top (default h).
    setViewport(w, h, frameH = h) {
      vw = Math.max(1, w);
      vh = Math.max(1, h);
      fh = Math.min(vh, Math.max(1, frameH));
      applyProjection(true);
    },
  };
}
