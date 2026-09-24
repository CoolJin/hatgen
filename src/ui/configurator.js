// Model switch (S5500-5DS / S6500-5DS): accessible radiogroups in #modelle and #daten,
// synced through the bus ('model'). Values tween, bars resize, spec rows cross-fade.
import gsap from 'gsap';
import { on, set, get } from '../core/bus.js';
import { MODELS, DEFAULT_MODEL, fmtNumber, fmtPrice } from '../content/models.js';
import { reducedMotion } from '../core/env.js';
import { $$ } from './util.js';

const SCALE_W = 7000; // bar scale (W)
const NB = ' ';

const pick = (model, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), model);
const specText = (p) => `${fmtNumber(p.cont)}${NB}W Dauer · max. ${fmtNumber(p.max)}${NB}W`;

export function initConfigurator() {
  const groups = $$('.model-toggle[role="radiogroup"]');
  const vals = $$('[data-val]').map((el) => ({ el, key: el.dataset.val, v: null }));
  const bars = $$('[data-bar]');
  const specs = $$('[data-spec]');
  const names = $$('[data-model-name]');
  const status = document.getElementById('model-status');
  const ids = Object.keys(MODELS);
  let current = null;

  function format(key, v) {
    return key === 'price' ? fmtPrice(v) : fmtNumber(Math.round(v));
  }

  function apply(id, animate) {
    const model = MODELS[id] || MODELS[DEFAULT_MODEL];
    if (model.id === current) return;
    current = model.id;

    groups.forEach((g) => {
      $$('[role="radio"]', g).forEach((opt, i) => {
        const checked = opt.dataset.model === model.id;
        opt.setAttribute('aria-checked', String(checked));
        opt.tabIndex = checked ? 0 : -1;
        if (checked) g.dataset.active = String(i);
      });
    });

    vals.forEach((it) => {
      const to = pick(model, it.key);
      if (typeof to !== 'number') return;
      if (!animate || reducedMotion || it.v === null) {
        it.v = to;
        it.el.textContent = format(it.key, to);
        return;
      }
      const o = { v: it.v };
      it.tween?.kill();
      it.tween = gsap.to(o, {
        v: to,
        duration: 0.9,
        ease: 'power3.out',
        onUpdate: () => {
          it.v = o.v;
          it.el.textContent = format(it.key, o.v);
        },
        onComplete: () => {
          it.v = to;
          it.el.textContent = format(it.key, to);
        },
      });
    });

    bars.forEach((el) => {
      const p = model[el.dataset.bar];
      if (!p) return;
      el.style.setProperty('--cont', (p.cont / SCALE_W).toFixed(4));
      el.style.setProperty('--max', (p.max / SCALE_W).toFixed(4));
    });

    specs.forEach((el) => {
      const p = model[el.dataset.spec];
      if (!p) return;
      const text = specText(p);
      if (!animate || reducedMotion) {
        el.textContent = text;
        return;
      }
      gsap
        .timeline()
        .to(el, { autoAlpha: 0, y: -4, duration: 0.18, ease: 'power1.in' })
        .call(() => {
          el.textContent = text;
        })
        .fromTo(el, { y: 5 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    });

    names.forEach((el) => {
      el.textContent = model.name;
    });

    // one concise announcement per switch (the tweening numbers are not live regions)
    if (status && animate) {
      const p3 = model.threePhase;
      status.textContent = `${model.name}: ${fmtNumber(p3.cont)}${NB}W Dauerleistung dreiphasig, ${fmtNumber(p3.max)}${NB}W maximal, ${fmtPrice(model.price)}`;
    }
  }

  groups.forEach((g) => {
    g.addEventListener('click', (e) => {
      const opt = e.target.closest('[role="radio"]');
      if (opt && opt.dataset.model !== current) set('model', opt.dataset.model);
    });
    g.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const i = Math.max(0, ids.indexOf(current));
      const k = keys[e.key];
      const next = k === 'first' ? 0 : k === 'last' ? ids.length - 1 : (i + k + ids.length) % ids.length;
      set('model', ids[next]);
      g.querySelector(`[data-model="${ids[next]}"]`)?.focus();
    });
  });

  on('model', (id) => apply(id, true));
  apply(get('model', DEFAULT_MODEL), false);
}
