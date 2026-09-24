// One-time "Wischen zum Drehen" hint on phones, placed in the hero right under the product.
// Appears once per page view after the intro, fades after the first swipe, after SHOW_MS, or
// as soon as the visitor scrolls away. Nothing is stored on the device.
import { isStacked, reducedMotion } from '../core/env.js';

const DELAY_MS = 1900; // after the page is revealed (lets the hero entrance play first)
const SHOW_MS = 5000;

const ICON = `<svg class="fx-hint__icon" viewBox="0 0 48 32" aria-hidden="true" focusable="false">
  <path class="fx-hint__arrow" d="M6 9h36M10 5 6 9l4 4M38 5l4 4-4 4"/>
  <g class="fx-hint__hand">
    <path d="M21 30v-4.2l-4.6-5.3a2 2 0 0 1 2.9-2.7l2.7 2.6V9.6a2 2 0 0 1 4 0v6.2l6.7 1.1a2.6 2.6 0 0 1 2.2 2.9L34 30"/>
    <circle class="fx-hint__tap" cx="23" cy="9.6" r="4.2"/>
  </g>
</svg>`;

export function createHint({ getScene, suspended }) {
  const phone = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  let state = phone ? 'waiting' : 'done'; // waiting | shown | done
  let el = null;
  let timer = 0;
  let removeTimer = 0;

  function onScroll() {
    if (window.scrollY > window.innerHeight * 0.12) hide();
  }

  function place(hero, scene) {
    // just under the product: its floor point projected to the screen
    const heroTop = hero.getBoundingClientRect().top;
    let top = hero.offsetHeight * 0.46;
    try {
      // lowest of the four bottom corners of the housing (the front wheels reach furthest down)
      let low = -Infinity;
      for (const x of [-0.475, 0.475]) {
        for (const z of [-0.275, 0.275]) {
          const p = scene.stage.project([x, 0, z]);
          if (p && Number.isFinite(p.y) && !p.behind) low = Math.max(low, p.y);
        }
      }
      if (low > 0) top = low - heroTop - 6; // over the wheel bottoms, on the floor
    } catch {
      /* keep the fallback */
    }
    // never on the hero copy
    const content = hero.querySelector('.hero__content');
    if (content) {
      const limit = content.getBoundingClientRect().top - heroTop - el.offsetHeight - 12;
      if (limit > 80) top = Math.min(top, limit);
    }
    el.style.top = `${Math.round(top)}px`;
  }

  function show() {
    if (state !== 'waiting') return;
    const scene = getScene();
    const hero = document.getElementById('hero');
    if (!scene || !hero || !isStacked() || suspended() || window.scrollY > window.innerHeight * 0.08) {
      state = 'done';
      return;
    }
    state = 'shown';
    el = document.createElement('div');
    el.className = 'fx-hint';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `${ICON}<span class="fx-hint__label">Wischen zum Drehen</span>`;
    hero.appendChild(el);
    place(hero, scene);
    // next frame: fade in
    requestAnimationFrame(() => requestAnimationFrame(() => el?.classList.add('is-in')));
    timer = setTimeout(hide, SHOW_MS);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function hide() {
    if (state === 'waiting') {
      state = 'done';
      return;
    }
    if (state !== 'shown') return;
    state = 'done';
    clearTimeout(timer);
    window.removeEventListener('scroll', onScroll);
    const node = el;
    el = null;
    node.classList.remove('is-in');
    node.classList.add('is-out');
    removeTimer = setTimeout(() => node.remove(), reducedMotion ? 50 : 700);
  }

  // Start once the 3D is up and the loader has revealed the page.
  function arm() {
    if (state !== 'waiting') return;
    const html = document.documentElement;
    const go = () => setTimeout(show, DELAY_MS);
    if (html.classList.contains('is-loaded')) {
      go();
      return;
    }
    const mo = new MutationObserver(() => {
      if (html.classList.contains('is-loaded')) {
        mo.disconnect();
        go();
      }
    });
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
  }

  return {
    arm,
    used: hide,
    dispose() {
      clearTimeout(timer);
      clearTimeout(removeTimer);
    },
    get state() {
      return state;
    },
  };
}
