// Pinned step scenes (#anschluesse, #innen): exactly one step active, derived from the
// section progress p (step i active for p in [i/n, (i+1)/n)), mirrored on the section as
// data-step. Also the segmented progress bar and the "Probestart" demo button.
// The step list reserves the height of its tallest state, so the panel (which is centered
// in the sticky viewport) never shifts vertically when another step expands.
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { on, emit } from '../core/bus.js';
import { $, $$, clamp01, docTop, scrollToTarget, isCollapsed } from './util.js';

export function initSteps() {
  $$('.steps-scene').forEach(setupScene);
  initStartButton();
}

function setupScene(section) {
  const steps = $$('.step', section);
  const n = steps.length;
  if (!n) return;
  const segs = $$('.stepbar__seg i', section);
  const count = $('.stepbar__count b', section);
  const list = $('.steps', section);
  // an intro step (no body, index 00) has no segment of its own in the progress bar
  const segOffset = steps[0].classList.contains('step--intro') ? 1 : 0;
  let active = -1;

  // Desktop: collapsed rows + the tallest expanded body. Stacked layout and short landscape
  // screens: CSS grid stacking of all steps in one cell does the same job, no reservation.
  function reserve() {
    if (!list) return;
    if (isCollapsed()) {
      list.style.removeProperty('--steps-min');
      return;
    }
    let rows = 1; // top border of the list
    let body = 0;
    steps.forEach((s) => {
      rows += ($('.step__h', s)?.offsetHeight || 0) + 1; // + bottom border
      const inner = $('.step__inner', s);
      if (inner && inner.offsetParent !== null) {
        const last = inner.lastElementChild;
        const mb = last ? parseFloat(getComputedStyle(last).marginBottom) || 0 : 0;
        body = Math.max(body, inner.scrollHeight + mb);
      }
    });
    list.style.setProperty('--steps-min', `${Math.ceil(rows + body)}px`);
  }

  // Each title is a disclosure button: it scrolls to its step, which expands the step's body.
  const heads = steps.map((s, k) => {
    const head = $('.step__head', s);
    const body = $('.step__body', s);
    if (head && body && $('.step__inner', body)?.childElementCount) {
      body.id ||= `${section.id}-step-${k}`;
      head.setAttribute('aria-controls', body.id);
    }
    return head;
  });

  function setActive(i) {
    if (i === active) return;
    active = i;
    steps.forEach((s, k) => {
      const on = k === i;
      s.classList.toggle('is-active', on);
      const body = $('.step__body', s);
      if (body) body.inert = !on;
      if (heads[k]?.hasAttribute('aria-controls')) heads[k].setAttribute('aria-expanded', String(on));
      if (on) s.setAttribute('aria-current', 'step');
      else s.removeAttribute('aria-current');
    });
    section.dataset.step = String(i);
    if (count) count.textContent = $('.step__idx', steps[i])?.textContent || String(i + 1).padStart(2, '0');
  }

  function update(p) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(p * n)));
    setActive(i);
    for (let k = 0; k < segs.length; k++) {
      segs[k].style.setProperty('--f', clamp01(p * n - k - segOffset).toFixed(3));
    }
  }

  setActive(0);
  update(0);
  reserve();
  document.fonts?.ready.then(reserve);
  ScrollTrigger.addEventListener('refreshInit', reserve);
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => update(self.progress),
    onRefresh: (self) => update(self.progress),
  });

  // Clicking a step title scrolls to the middle of that step's range.
  heads.forEach((head, k) => {
    head?.addEventListener('click', () => {
      const len = Math.max(1, section.offsetHeight - window.innerHeight);
      scrollToTarget(docTop(section) + ((k + 0.5) / n) * len);
    });
  });
}

function initStartButton() {
  const btn = $('.btn-start');
  if (!btn) return;
  const state = $('.btn-start__state', btn);
  const label = $('.btn-start__label', btn);
  const timers = [];
  const clear = () => timers.splice(0).forEach(clearTimeout);

  function reset() {
    clear();
    btn.classList.remove('is-preheat', 'is-running');
    btn.removeAttribute('aria-disabled');
    if (state) state.textContent = '';
    if (label) label.hidden = false;
  }

  function start() {
    clear();
    btn.classList.add('is-preheat');
    btn.classList.remove('is-running');
    btn.setAttribute('aria-disabled', 'true');
    if (label) label.hidden = true;
    if (state) state.textContent = 'Vorglühen …';
    timers.push(
      setTimeout(() => {
        btn.classList.remove('is-preheat');
        btn.classList.add('is-running');
        if (state) state.textContent = 'Läuft …';
      }, 1100),
    );
    timers.push(setTimeout(reset, 6200));
  }

  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-running') || btn.classList.contains('is-preheat')) return;
    emit('engine:start');
  });
  on('engine:start', start);
  on('engine:stop', reset);
}
