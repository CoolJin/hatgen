// UI entry: DOM behaviour, 2D animation and interactions of the HATGEN page.
//
//   const ui = initUI();
//   ui.loader.setProgress(p)   // 0..1
//   await ui.loader.hide()     // exit animation; resolves when the page is revealed
//   ui.playIntro()             // hero entrance, returns a gsap timeline (idempotent)
//   ui.refresh()               // ScrollTrigger.refresh after layout changes
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { createLoader } from './loader.js';
import { createIntro } from './intro.js';
import { initHeader } from './header.js';
import { initReveals } from './reveal.js';
import { initStatement } from './statement.js';
import { initSteps } from './steps.js';
import { initScope } from './scope.js';
import { initKonstruktion } from './konstruktion.js';
import { initConfigurator } from './configurator.js';
import { initEinsatz } from './einsatz.js';
import { initMarquee } from './marquee.js';
import { initVideo } from './video.js';
import { initMagnetic } from './magnetic.js';
import { initCheckout } from '../checkout/index.js';
import { initFx } from '../fx/index.js';

let instance = null;

function safe(name, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[ui] ${name} failed`, err);
    return undefined;
  }
}

export function initUI() {
  if (instance) return instance;
  window.__hatUI = true;
  gsap.registerPlugin(ScrollTrigger, SplitText);

  const loader = createLoader();
  const intro = safe('intro', createIntro) || { play: () => gsap.timeline(), played: true };

  safe('header', initHeader);
  safe('configurator', initConfigurator);
  safe('einsatz', initEinsatz); // before reveals: switches the section into horizontal mode
  safe('statement', initStatement);
  safe('steps', initSteps);
  safe('scope', initScope);
  safe('konstruktion', initKonstruktion);
  safe('reveals', initReveals);
  safe('marquee', initMarquee);
  safe('video', initVideo);
  safe('magnetic', initMagnetic);
  safe('checkout', initCheckout);
  safe('fx', initFx);

  // If the loader is dismissed without anyone calling playIntro (error path, failsafe),
  // make sure the hero copy still appears.
  loader.onHidden(() => {
    setTimeout(() => {
      if (!intro.played) intro.play();
    }, 400);
  });

  instance = {
    loader,
    playIntro: () => intro.play(),
    refresh: () => ScrollTrigger.refresh(),
  };
  return instance;
}
