// Positions the DOM callouts (#callouts .callout) on projected 3D anchor points.
// Labels pick the diagonal direction that keeps them on screen, off the scene's text
// panel and off other labels.
import { isStacked } from '../core/env.js';

const DIRS = ['ne', 'nw', 'se', 'sw'];
// Door decal (HATGEN / model name) half size in metres; callouts avoid covering it.
const DECAL_HALF = [0.141, 0.058];
const MARGIN = 12;
const SQRT1_2 = Math.SQRT1_2;

export function createCallouts({ stage, gen, director }) {
  const root = document.getElementById('callouts');
  if (!root || !gen) return { update() {} };

  const items = [...root.querySelectorAll('.callout')].map((el) => ({
    el,
    label: el.querySelector('.callout__label'),
    anchor: el.dataset.anchor,
    scene: el.dataset.scene,
    step: Number(el.dataset.step),
    visible: false,
    active: false,
    dir: '',
    len: 0,
    x: -1,
    y: -1,
    w: 0,
    h: 0,
    pr: { x: 0, y: 0, visible: false, behind: false },
  }));
  const centerOut = { x: 0, y: 0, visible: false, behind: false };
  const centerObj = gen.anchors?.frame || gen.object;
  const placed = [];
  const corner = { x: 0, y: 0, visible: false, behind: false };
  const cornerPos = [0, 0, 0];
  let headerH = 72;
  let measured = false;

  // Label sizes only change with fonts, viewport and CSS breakpoints.
  function measure() {
    headerH = document.getElementById('header')?.offsetHeight || 72;
    for (const it of items) {
      if (!it.label) continue;
      it.w = it.label.offsetWidth;
      it.h = it.label.offsetHeight;
    }
    measured = true;
  }
  window.addEventListener('resize', () => (measured = false), { passive: true });
  document.fonts?.ready.then(() => (measured = false));

  function setVisible(it, v) {
    if (it.visible === v) return;
    it.visible = v;
    it.el.classList.toggle('is-visible', v);
  }

  // Label box for a dot at (x, y) in direction dir (mirrors the CSS in callouts.css).
  function box(it, x, y, dir, len) {
    const dx = dir[1] === 'e' ? 1 : -1;
    const dy = dir[0] === 's' ? 1 : -1;
    const cx = x + dx * len * SQRT1_2;
    const cy = y + dy * len * SQRT1_2;
    const l = dx > 0 ? cx : cx - it.w;
    const t = dy > 0 ? cy : cy - it.h;
    return { l, t, r: l + it.w, b: t + it.h };
  }

  const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

  function penalty(bx, w, h, panel, decal) {
    const area = (bx.r - bx.l) * (bx.b - bx.t);
    const vis = { l: MARGIN, t: headerH + 8, r: w - MARGIN, b: h - MARGIN };
    let p = (area - overlap(bx, vis)) * 4; // off-screen part weighs most
    if (panel) p += overlap(bx, panel) * 2;
    if (decal) p += overlap(bx, decal) * 2;
    for (const o of placed) p += overlap(bx, o) * 3;
    return p;
  }

  function panelRect(sceneId) {
    const el = sceneId && document.getElementById(sceneId)?.querySelector('.scene__panel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return null;
    return { l: r.left - 16, t: r.top, r: r.right + 24, b: r.bottom };
  }

  // Screen rectangle of the door decal (closed door, front facing +Z).
  function decalRect() {
    const a = gen.anchors?.label;
    if (!a) return null;
    a.updateWorldMatrix(true, false);
    const e = a.matrixWorld.elements;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        cornerPos[0] = e[12] + sx * DECAL_HALF[0];
        cornerPos[1] = e[13] + sy * DECAL_HALF[1];
        cornerPos[2] = e[14];
        const pr = stage.project(cornerPos, corner);
        if (pr.behind) return null;
        l = Math.min(l, pr.x); r = Math.max(r, pr.x); t = Math.min(t, pr.y); b = Math.max(b, pr.y);
      }
    }
    return { l, t, r, b };
  }

  function update() {
    if (!measured) measure();
    const info = director.info;
    const target = director.target;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const stacked = isStacked();
    // hidden while another mode (checkout) has taken over the scene
    const canvasShown = director.canvasVisible() && director.takeoverMix < 0.05;

    const c = stage.project(centerObj, centerOut);
    const panel = !stacked && info.pinned ? panelRect(info.scene) : null;
    const decal = info.pinned && info.scene === 'anschluesse' ? decalRect() : null;
    placed.length = 0;

    for (const it of items) {
      const own = it.step === info.step;
      let show = false;
      if (canvasShown && info.pinned && info.scene === it.scene && own) {
        // One label per step: the part the step text talks about. In the exploded view it
        // hides as soon as the unit starts to reassemble.
        if (it.scene === 'innen') show = info.step >= 1 && target.explode > 0.6 && director.state.explode > 0.6;
        else if (it.scene === 'anschluesse') show = true;
      }
      const anchor = gen.anchors?.[it.anchor];
      if (show && anchor) {
        const pr = stage.project(anchor, it.pr);
        if (!pr.visible || pr.behind || pr.x < MARGIN || pr.x > w - MARGIN || pr.y < headerH || pr.y > h - MARGIN) {
          show = false;
        } else {
          if (Math.abs(pr.x - it.x) > 0.2 || Math.abs(pr.y - it.y) > 0.2) {
            it.x = pr.x;
            it.y = pr.y;
            it.el.style.setProperty('--x', `${pr.x.toFixed(1)}px`);
            it.el.style.setProperty('--y', `${pr.y.toFixed(1)}px`);
          }
          // Close-ups: a longer leader moves the pill off the component it labels.
          const len = it.scene === 'anschluesse' ? (stacked ? 64 : 104) : stacked ? 40 : 56;
          if (len !== it.len) {
            it.len = len;
            it.el.style.setProperty('--len', `${len}px`);
          }
          // Preferred: pointing away from the product centre; otherwise the least bad fit.
          const pref = (pr.y < c.y - 10 ? 'n' : 's') + (pr.x < c.x ? 'w' : 'e');
          let best = pref;
          let bestP = Infinity;
          for (const d of [pref, ...DIRS.filter((x) => x !== pref)]) {
            // keep the current direction unless another one is clearly better (no flicker)
            const p = penalty(box(it, pr.x, pr.y, d, len), w, h, panel, decal) - (d === it.dir ? 40 : 0);
            if (p < bestP) {
              bestP = p;
              best = d;
            }
          }
          if (best !== it.dir) {
            it.dir = best;
            it.el.dataset.dir = best;
          }
          placed.push(box(it, pr.x, pr.y, best, len));
        }
      }
      setVisible(it, show);
      if (show !== it.active) {
        it.active = show;
        it.el.classList.toggle('is-active', show);
      }
    }
  }

  return { update };
}
