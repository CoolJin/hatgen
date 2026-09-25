// Full-screen "Vorglühen" loader: HAT mark fills up with the load progress,
// then wipes out and the overlay lifts away (clip-path) revealing the page.
import gsap from 'gsap';
import { reducedMotion } from '../core/env.js';
import { clamp01 } from './util.js';

const FAILSAFE_MS = 25000;
// The mark's wipe-out clip leaves room around the logo, so its glow is never cut off.
const MARKS_CLIP_IN = 'inset(-60% -25% -60% -25%)';
const MARKS_CLIP_OUT = 'inset(-60% -25% -60% 125%)';

export function createLoader() {
  const el = document.getElementById('loader');
  const pctEl = el?.querySelector('.loader__pct');
  const state = { p: 0 };
  const hiddenFns = [];
  let target = 0;
  let tween = null;
  let hidePromise = null;
  let done = false;

  function render() {
    if (!el) return;
    el.style.setProperty('--p', state.p.toFixed(4));
    if (pctEl) pctEl.textContent = String(Math.round(state.p * 100)).padStart(3, '0');
  }

  function setProgress(p) {
    p = clamp01(+p || 0);
    if (p <= target || hidePromise) return;
    target = p;
    tween?.kill();
    tween = gsap.to(state, {
      p,
      duration: reducedMotion ? 0.01 : 0.8 + (p - state.p) * 0.6,
      ease: 'power2.out',
      onUpdate: render,
    });
  }

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(failsafe);
    if (el) {
      el.classList.add('is-done');
      el.hidden = true;
      el.setAttribute('aria-busy', 'false');
    }
    document.documentElement.classList.remove('is-loading');
    document.documentElement.classList.add('is-loaded');
    // The page is visible now: make sure smooth scrolling is running, even when the loader
    // was dismissed by its failsafe while the 3D boot is still busy (the app stops Lenis
    // during loading and would otherwise only start it after the boot has finished).
    if (!document.documentElement.classList.contains('menu-open')) window.__lenis?.start();
    hiddenFns.splice(0).forEach((fn) => fn());
  }

  function hide() {
    if (hidePromise) return hidePromise;
    hidePromise = new Promise((resolve) => {
      if (!el || getComputedStyle(el).display === 'none') {
        finish();
        resolve();
        return;
      }
      tween?.kill();
      const marks = el.querySelector('.loader__marks');
      const bar = el.querySelector('.loader__bar');
      const meta = el.querySelector('.loader__meta');
      const tl = gsap.timeline({ onComplete: finish });
      tl.to(state, { p: 1, duration: 0.25 + (1 - state.p) * 0.5, ease: 'power2.out', onUpdate: render });

      if (reducedMotion) {
        tl.to(el, { autoAlpha: 0, duration: 0.45, ease: 'power1.out' });
        tl.call(resolve);
        return;
      }

      tl.to(marks, { scale: 1.04, duration: 0.35, ease: 'power2.out' }, '+=0.05')
        .to(marks, { clipPath: MARKS_CLIP_OUT, duration: 0.7, ease: 'expo.inOut' }, '>-0.1')
        .to(bar, { clipPath: 'inset(0% 0% 0% 100%)', duration: 0.7, ease: 'expo.inOut' }, '<0.06')
        .to(meta, { autoAlpha: 0, y: -6, duration: 0.4, ease: 'power2.in' }, '<')
        .set(el.querySelector('.loader__edge'), { opacity: 1 }, '>-0.25')
        .to(el, { '--cut': '0%', duration: 1.15, ease: 'expo.inOut' }, '<')
        // hand over to the hero intro while the curtain is still lifting
        .call(resolve, null, '>-0.55');
    });
    return hidePromise;
  }

  // Never block the page forever, even if the 3D boot hangs. Only visible time counts: a
  // page opened in a background tab keeps its curtain until the boot can actually run.
  let failsafe = 0;
  let failsafeLeft = FAILSAFE_MS;
  let failsafeStart = 0;
  const armFailsafe = () => {
    clearTimeout(failsafe);
    if (done || document.hidden) return;
    failsafeStart = performance.now();
    failsafe = setTimeout(() => hide(), failsafeLeft);
  };
  const onVisibility = () => {
    if (done) return document.removeEventListener('visibilitychange', onVisibility);
    if (document.hidden) {
      clearTimeout(failsafe);
      failsafeLeft = Math.max(0, failsafeLeft - (performance.now() - failsafeStart));
    } else armFailsafe();
  };
  document.addEventListener('visibilitychange', onVisibility);
  armFailsafe();
  if (el) {
    el.setAttribute('aria-busy', 'true');
    gsap.set(el.querySelector('.loader__marks'), { clipPath: MARKS_CLIP_IN });
    gsap.set(el.querySelector('.loader__bar'), { clipPath: 'inset(0% 0% 0% 0%)' });
    document.documentElement.classList.add('is-loading');
  }
  render();

  return {
    setProgress,
    hide,
    onHidden(fn) {
      if (done) fn();
      else hiddenFns.push(fn);
    },
    get done() {
      return done;
    },
  };
}
