// Two-click YouTube embed: nothing is loaded from YouTube before the user clicks play.
import { VIDEO_ID } from '../content/models.js';
import { $ } from './util.js';

export function initVideo() {
  const wrap = $('.video');
  const facade = wrap && $('.video__facade', wrap);
  if (!facade) return;
  facade.addEventListener('click', () => {
    const frame = document.createElement('div');
    frame.className = 'video__frame';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(VIDEO_ID)}?autoplay=1&rel=0`;
    iframe.title = 'HATGEN Praxistest';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.setAttribute('allowfullscreen', '');
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.appendChild(iframe);
    facade.replaceWith(frame);
    iframe.focus();
  }, { once: true });
}
