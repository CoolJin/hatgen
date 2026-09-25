// 3D checkout (demo): every order CTA opens an on-page checkout instead of leaving for
// the shop. Nothing is sent anywhere and nothing is stored: the flow lives in memory and
// ends with a clearly marked demo confirmation. The CTAs keep their shop href as the
// no-JS fallback (and for modifier clicks / middle clicks).
//
// Structure: this shell (dialog, focus, scroll lock, deep link #bestellen), flow.js (DOM
// steps, validation, prices), scene3d.js (director takeover + props choreography; three.js
// props are lazy-loaded from props.js on the first opening).
import gsap from 'gsap';
import { on, get, set, emit } from '../core/bus.js';
import { isStacked, reducedMotion } from '../core/env.js';
import { DEFAULT_MODEL } from '../content/models.js';
import { createFlow } from './flow.js';
import { createScene3D } from './scene3d.js';

const HASH = '#bestellen';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initCheckout() {
  const root = document.getElementById('checkout');
  if (!root) return null;
  const html = document.documentElement;
  const panel = root.querySelector('.co-panel');
  const scrim = root.querySelector('.co-scrim');
  const hudEl = root.querySelector('.co-hud');
  const visual = root.querySelector('.co-visual');

  const s3d = createScene3D();
  let isOpen = false;
  let animating = null;
  let lastFocus = null;
  let savedY = 0;
  let restoreY = null; // scroll position to keep while history.back() settles
  let pushed = false;
  let inerted = [];
  let pageFade = null;

  const flow = createFlow(root, {
    onStep: (n) => s3d.step({ step: n, delivery: flow.state.delivery, model: flow.state.model }),
    onDelivery: (d) => s3d.step({ step: flow.state.step, delivery: d }),
    onModel: (id, fromUser) => {
      if (fromUser && get('model') !== id) set('model', id);
      s3d.modelChanged(id);
    },
    onOrder: (st) =>
      s3d.finale({
        delivery: st.delivery,
        orderNo: st.orderNo,
        name: [st.data.firstName, st.data.lastName].filter(Boolean).join(' ') + (st.data.company ? `, ${st.data.company}` : ''),
        city: [st.data.zip, st.data.city].filter(Boolean).join(' '),
        model: st.model,
        qty: st.qty,
      }),
  });

  // page model toggles keep the checkout in sync (and the other way round via set())
  on('model', (id) => flow.setModel(id));

  // ---------------------------------------------------------------- CTAs
  const ctas = [...document.querySelectorAll('[data-checkout]')];
  ctas.forEach((a) => {
    a.setAttribute('aria-haspopup', 'dialog');
    a.setAttribute('aria-controls', 'checkout');
    // with JS the link opens the on-page checkout, not a new tab
    a.querySelector('.sr-only')?.remove();
    a.querySelector('use[href="#i-ext"]')?.setAttribute('href', '#i-arrow');
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-checkout]');
    if (!a || e.defaultPrevented) return;
    // modifier / middle clicks still open the shop in a new tab
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open({ trigger: a });
  });

  // ---------------------------------------------------------------- page behind
  const pageEls = () =>
    [
      document.querySelector('.skip-link'),
      document.getElementById('header'),
      document.getElementById('menu'),
      document.querySelector('.sidenav'),
      document.querySelector('.scroll-progress'),
      document.getElementById('main'),
      document.getElementById('footer'),
      document.getElementById('callouts'),
    ].filter(Boolean);

  function hidePage() {
    const els = pageEls();
    inerted = [];
    for (const el of els) {
      if (!el.inert) {
        el.inert = true;
        inerted.push(el);
      }
    }
    pageFade?.kill();
    const fadeEls = els.filter((el) => el.id !== 'menu' && !el.classList.contains('skip-link'));
    pageFade = gsap.to(fadeEls, { autoAlpha: 0, duration: reducedMotion ? 0.2 : 0.55, ease: 'power2.out', overwrite: 'auto' });
  }

  function showPage() {
    inerted.forEach((el) => {
      el.inert = false;
    });
    inerted = [];
    pageFade?.kill();
    const fadeEls = pageEls().filter((el) => el.id !== 'menu' && !el.classList.contains('skip-link'));
    // visible (focusable) right away, so focus can return to the trigger; opacity fades in
    gsap.set(fadeEls, { visibility: 'inherit' });
    pageFade = gsap.to(fadeEls, {
      opacity: 1,
      duration: reducedMotion ? 0.2 : 0.6,
      ease: 'power2.out',
      overwrite: 'auto',
      clearProps: 'opacity,visibility',
    });
  }

  function lockScroll() {
    savedY = window.scrollY;
    // classic scrollbar: its gutter stays reserved while locked (see .has-gutter)
    root.classList.toggle('has-gutter', window.innerWidth - html.clientWidth > 0);
    const lenis = window.__lenis || get('scene')?.lenis;
    lenis?.stop();
    html.classList.add('checkout-lock');
  }

  function unlockScroll() {
    html.classList.remove('checkout-lock');
    const lenis = window.__lenis || get('scene')?.lenis;
    if (Math.abs(window.scrollY - savedY) > 1) {
      if (lenis) lenis.scrollTo(savedY, { immediate: true, force: true });
      else window.scrollTo(0, savedY);
    }
    if (!html.classList.contains('menu-open')) lenis?.start();
  }

  // ---------------------------------------------------------------- 3D / fallback visual
  function syncVisual() {
    const has3d = s3d.available() && !html.classList.contains('no-webgl');
    root.classList.toggle('has-3d', has3d);
    root.classList.toggle('no-3d', !has3d);
    if (!has3d) visual.querySelector('img')?.setAttribute('loading', 'eager');
  }
  on('scene', () => {
    syncVisual();
    if (isOpen) s3d.open({ step: flow.step, delivery: flow.state.delivery, model: flow.state.model });
  });

  // ---------------------------------------------------------------- open / close
  function open({ trigger = null, fromHash = false } = {}) {
    if (isOpen) return;
    isOpen = true;
    animating?.kill();
    lastFocus = trigger || document.activeElement;
    const model = get('model', DEFAULT_MODEL);
    if (flow.done) flow.reset({ clearData: true, model });
    else flow.reset({ model });

    if (!fromHash && location.hash !== HASH) {
      try {
        history.pushState({ checkout: true }, '', HASH);
        pushed = true;
      } catch {
        pushed = false;
      }
    }

    root.hidden = false;
    html.classList.add('checkout-open');
    syncVisual();
    lockScroll();
    hidePage();
    emit('checkout:open');
    s3d.open({ step: 0, delivery: flow.state.delivery, model: flow.state.model });

    const stacked = isStacked();
    const targets = flow.staggerTargets();
    const tl = gsap.timeline({
      onComplete: () => {
        animating = null;
      },
    });
    animating = tl;
    // Only opacity / transforms on anything that holds focus: `visibility: hidden` (autoAlpha)
    // would make the focus() below fail silently on fast machines.
    if (reducedMotion) {
      tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25, clearProps: 'opacity' });
    } else {
      tl.fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: 'power2.out' }, 0);
      if (stacked) tl.fromTo(panel, { yPercent: 104 }, { yPercent: 0, duration: 0.95, ease: 'expo.out' }, 0.1);
      else
        tl.fromTo(
          panel,
          { clipPath: 'inset(0% 100% 0% 0% round 26px)', x: -40 },
          { clipPath: 'inset(0% 0% 0% 0% round 26px)', x: 0, duration: 1.05, ease: 'expo.inOut' },
          0.05
        );
      tl.fromTo(targets, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', stagger: 0.045, clearProps: 'opacity,transform' }, stacked ? 0.35 : 0.5);
      tl.fromTo(hudEl, { autoAlpha: 0, x: 16 }, { autoAlpha: 1, x: 0, duration: 0.9, ease: 'expo.out', clearProps: 'opacity,visibility,transform' }, 1.0);
      tl.set(panel, { clearProps: 'clipPath,transform' });
    }
    // focus into the dialog right away (and once more after the first frame, in case a
    // late layout change dropped it)
    const h0 = root.querySelector('#co-h0');
    h0?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (isOpen && !root.contains(document.activeElement)) h0?.focus({ preventScroll: true });
    });
  }

  function close({ fromPop = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    animating?.kill();
    emit('checkout:close');
    s3d.close();
    const stacked = isStacked();
    const done = () => {
      root.hidden = true;
      root.classList.remove('is-typing');
      html.classList.remove('checkout-open');
      gsap.set([root, panel, scrim, hudEl], { clearProps: 'all' });
      animating = null;
      if (flow.done) flow.reset({ clearData: true, model: get('model', DEFAULT_MODEL) });
    };
    const tl = gsap.timeline({ onComplete: done });
    animating = tl;
    if (reducedMotion) tl.to(root, { opacity: 0, duration: 0.2 });
    else {
      if (stacked) tl.to(panel, { yPercent: 104, duration: 0.6, ease: 'expo.in' }, 0);
      else tl.to(panel, { clipPath: 'inset(0% 100% 0% 0% round 26px)', x: -30, duration: 0.7, ease: 'expo.inOut' }, 0);
      tl.to([scrim, hudEl], { autoAlpha: 0, duration: 0.6, ease: 'power2.inOut' }, 0.1);
    }
    showPage();
    unlockScroll();

    // hash: undo our history entry, or just clear a deep-linked hash
    if (!fromPop) {
      if (pushed && history.state?.checkout) {
        pushed = false;
        // Going back lands on the previous entry; if that one has a fragment (e.g. #daten
        // from a menu link), the browser jumps to that anchor. Keep the reading position.
        restoreY = savedY;
        history.back();
      } else if (location.hash === HASH) {
        history.replaceState(history.state, '', location.pathname + location.search);
      }
    }
    pushed = false;

    // focus back to the trigger (or something sensible when it is gone, e.g. the menu CTA)
    const usable = (el) => el && el !== document.body && el.isConnected && isVisible(el);
    const burger = document.querySelector('.burger');
    const target = usable(lastFocus) ? lastFocus : usable(burger) ? burger : document.getElementById('main');
    if (target) {
      if (target.id === 'main' && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    lastFocus = null;
  }

  function isVisible(el) {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility();
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // ---------------------------------------------------------------- keyboard
  // On the document, not the dialog: Escape and the Tab trap must work even when focus
  // has dropped to <body> (e.g. the focused control was hidden by a step change).
  document.addEventListener('keydown', (e) => {
    if (!isOpen || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && isVisible(el));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const inside = panel.contains(document.activeElement) && document.activeElement !== panel;
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  });
  // A mouse press on the free 3D area would move focus to <body> (no focusin fires for
  // that): keep it on the current control. Pointer events (drag to turn) still arrive.
  root.addEventListener('mousedown', (e) => {
    if (isOpen && !panel.contains(e.target)) e.preventDefault();
  });
  // focus must not escape (e.g. a click on the transparent 3D area)
  document.addEventListener('focusin', (e) => {
    if (isOpen && !root.contains(e.target)) root.querySelector('.co-close')?.focus({ preventScroll: true });
  });

  root.querySelector('.co-close').addEventListener('click', () => close());
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-co-close]')) close();
  });

  // ---------------------------------------------------------------- deep link + history
  function keepPosition() {
    if (restoreY === null) return;
    const y = restoreY;
    const put = () => {
      if (isOpen || Math.abs(window.scrollY - y) <= 1) return;
      const lenis = window.__lenis || get('scene')?.lenis;
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else window.scrollTo(0, y);
    };
    put();
    requestAnimationFrame(put);
    setTimeout(() => {
      put();
      restoreY = null;
    }, 120);
  }
  window.addEventListener('popstate', () => {
    keepPosition();
    if (isOpen && location.hash !== HASH) close({ fromPop: true });
    else if (!isOpen && location.hash === HASH) whenReady(() => open({ fromHash: true }));
  });
  window.addEventListener('hashchange', () => {
    keepPosition();
    if (!isOpen && location.hash === HASH) whenReady(() => open({ fromHash: true }));
  });

  // Open only once the page is revealed (loader gone): the deep link lands in the checkout.
  function whenReady(fn) {
    if (html.classList.contains('is-loaded')) {
      fn();
      return;
    }
    const mo = new MutationObserver(() => {
      if (html.classList.contains('is-loaded')) {
        mo.disconnect();
        // after the loader's own clean-up (it restarts smooth scrolling)
        setTimeout(fn, 50);
      }
    });
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
  }
  if (location.hash === HASH) whenReady(() => open({ fromHash: true }));

  // ---------------------------------------------------------------- touch / pointer
  // Drag on the free 3D area turns the product (mouse, pen or finger), with inertia.
  let rot = null;
  root.addEventListener('pointerdown', (e) => {
    if (!isOpen || rot || panel.contains(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!s3d.dragStart()) return;
    rot = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0 };
    root.classList.add('is-turning');
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!rot || e.pointerId !== rot.id) return;
    const dx = e.clientX - rot.x;
    const dt = Math.max(1, e.timeStamp - rot.t);
    rot.v = rot.v * 0.6 + ((dx / dt) * 1000) * 0.4; // px/s, smoothed
    rot.x = e.clientX;
    rot.t = e.timeStamp;
    s3d.dragMove(dx);
  });
  const endRot = (e) => {
    if (!rot || e.pointerId !== rot.id) return;
    // a pause before letting go means no fling
    const v = e.timeStamp - rot.t > 90 ? 0 : rot.v;
    s3d.dragEnd(v);
    rot = null;
    root.classList.remove('is-turning');
  };
  root.addEventListener('pointerup', endRot);
  root.addEventListener('pointercancel', endRot);

  // Stacked layout: pull the sheet down by its header to close it.
  const head = root.querySelector('.co-head');
  const grip = root.querySelector('.co-grip');
  let pull = null;
  const onPullStart = (e) => {
    if (!isOpen || !isStacked() || animating || e.target.closest('button, a, input, label')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pull = { id: e.pointerId, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* optional */
    }
  };
  const onPullMove = (e) => {
    if (!pull || e.pointerId !== pull.id) return;
    const dt = Math.max(1, e.timeStamp - pull.t);
    pull.v = pull.v * 0.6 + (((e.clientY - pull.y) / dt) * 1000) * 0.4;
    pull.y = e.clientY;
    pull.t = e.timeStamp;
    const dy = Math.max(0, pull.y - pull.y0);
    // rubber band upwards, 1:1 downwards
    gsap.set(panel, { y: dy > 0 ? dy : 0 });
  };
  const onPullEnd = (e) => {
    if (!pull || e.pointerId !== pull.id) return;
    const dy = Math.max(0, pull.y - pull.y0);
    const fling = pull.v > 700 && e.timeStamp - pull.t < 90;
    pull = null;
    if (dy > Math.min(160, panel.offsetHeight * 0.28) || (fling && dy > 24)) close();
    else gsap.to(panel, { y: 0, duration: 0.5, ease: 'expo.out', clearProps: 'transform' });
  };
  for (const el of [head, grip]) {
    el.addEventListener('pointerdown', onPullStart);
    el.addEventListener('pointermove', onPullMove);
    el.addEventListener('pointerup', onPullEnd);
    el.addEventListener('pointercancel', onPullEnd);
  }

  // ---------------------------------------------------------------- typing on phones
  // The on-screen keyboard overlays the page (iOS, Chrome for Android): while a text field
  // has focus, the sheet grows to the visible viewport (visualViewport) and the focused
  // field is centred in the scroll body, so the field and the Weiter button stay visible.
  const body = root.querySelector('.co-body');
  const vv = window.visualViewport;
  let typingTimer = 0;
  let centerTimer = 0;
  const isTextField = (el) =>
    !!el && body.contains(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(radio|checkbox)$/.test(el.type)));

  function syncViewport() {
    if (!vv) return;
    // visible viewport height, and how much of the layout viewport the keyboard covers
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--kb', `${Math.max(0, Math.round(root.clientHeight - vv.height - vv.offsetTop))}px`);
  }
  function setTyping(on) {
    if (on) syncViewport();
    if (root.classList.contains('is-typing') === on) return;
    root.classList.toggle('is-typing', on);
  }
  function centerSoon(el) {
    clearTimeout(centerTimer);
    const run = () => flow.reveal(el);
    requestAnimationFrame(run);
    // once more after the sheet has grown / the keyboard has settled
    centerTimer = setTimeout(run, 420);
  }
  root.addEventListener('focusin', (e) => {
    if (!isOpen || !isStacked() || !isTextField(e.target)) return;
    clearTimeout(typingTimer);
    setTyping(true);
    centerSoon(e.target);
  });
  root.addEventListener('focusout', () => {
    clearTimeout(typingTimer);
    // a short grace period: moving between fields must not collapse the sheet, and a tap
    // on Weiter must hit the button before the layout changes under the finger
    typingTimer = setTimeout(() => {
      if (!isTextField(document.activeElement)) setTyping(false);
    }, 220);
  });
  const onViewport = () => {
    if (!isOpen || !root.classList.contains('is-typing')) return;
    syncViewport();
    if (isTextField(document.activeElement)) centerSoon(document.activeElement);
  };
  vv?.addEventListener('resize', onViewport, { passive: true });
  vv?.addEventListener('scroll', onViewport, { passive: true });

  // ---------------------------------------------------------------- layout
  let resizeTimer = 0;
  window.addEventListener(
    'resize',
    () => {
      if (!isOpen) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => s3d.relayout(), 120);
    },
    { passive: true }
  );

  // Preload the prop module when the browser is idle after the first order CTA hover.
  const warm = () => {
    if (s3d.available()) s3d.preload();
  };
  ctas.forEach((a) => a.addEventListener('pointerenter', warm, { once: true, passive: true }));

  syncVisual();
  const api = { open, close, get isOpen() { return isOpen; } };
  if (new URLSearchParams(location.search).has('debug')) window.__checkout = { api, flow, s3d, gsap };
  return api;
}
