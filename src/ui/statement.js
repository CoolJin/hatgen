// Statement scene: words light up from 18 % to 100 % opacity while scrolling.
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { reducedMotion } from '../core/env.js';

export function initStatement() {
  const section = document.getElementById('statement');
  const text = section?.querySelector('.statement__text');
  if (!text || reducedMotion) return;

  // aria 'none': the words stay plain inline spans, so the paragraph keeps its text for
  // assistive tech (an aria-label on a <p> is not exposed, the default would empty it)
  const split = SplitText.create(text, { type: 'words', wordsClass: 'word', tag: 'span', aria: 'none' });
  // Punctuation right after the highlight span ("Drehstrom</span>,") becomes its own word
  // and could wrap to the next line: glue it to the previous word instead.
  const words = split.words.filter((w, i, all) => {
    if (i === 0 || !/^[,.;:!?]+$/.test(w.textContent.trim())) return true;
    const mark = document.createElement('span');
    mark.className = 'punct';
    mark.textContent = w.textContent.trim();
    all[i - 1].appendChild(mark);
    w.remove();
    return false;
  });
  const hl = words.filter((w) => w.closest('.hl'));
  const hlIdx = hl.map((w) => words.indexOf(w));
  const n = words.length;

  gsap.set(words, { opacity: 0.18 });
  gsap.to(words, {
    opacity: 1,
    ease: 'none',
    stagger: 0.14,
    duration: 0.5,
    scrollTrigger: {
      trigger: section,
      start: 'top 35%',
      // from the moment the copy arrives until ~75 % of the pinned range
      end: () => `+=${window.innerHeight * 0.35 + Math.max(1, section.offsetHeight - window.innerHeight) * 0.75}`,
      scrub: 0.5,
      invalidateOnRefresh: true,
      onUpdate(self) {
        const p = self.progress;
        hl.forEach((w, i) => w.classList.toggle('is-lit', p > (hlIdx[i] + 1.5) / n));
      },
    },
  });
}
