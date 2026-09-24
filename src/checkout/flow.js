// Checkout steps (DOM): model + quantity, delivery, contact data, payment + review, success.
// Pure in-memory state: nothing is sent, nothing is stored.
import gsap from 'gsap';
import { MODELS, DEFAULT_MODEL, COMMON, fmtPrice } from '../content/models.js';
import { reducedMotion, coarsePointer as coarse } from '../core/env.js';

export const STEP_NAMES = ['Modell & Menge', 'Lieferung', 'Ihre Daten', 'Zahlung & Prüfen', 'Vielen Dank'];
const LAST_FORM_STEP = 3;
const MAX_QTY = 5;
const VAT = 0.19;
const NB = ' ';
const PAY_LABEL = {
  transfer: 'Überweisung / Vorkasse',
  paypal: 'PayPal',
  cash: 'Barzahlung bei Abholung',
};
const FIELDS = ['firstName', 'lastName', 'company', 'email', 'phone', 'street', 'zip', 'city', 'note'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const round2 = (v) => Math.round(v * 100) / 100;
const wordmark = '<span class="hatgen">HATGEN</span>';

// Inline validation rules (German messages). st: flow state.
const RULES = {
  firstName: (v) => (!v ? 'Bitte geben Sie Ihren Vornamen ein.' : ''),
  lastName: (v) => (!v ? 'Bitte geben Sie Ihren Nachnamen ein.' : ''),
  email: (v) => {
    if (!v) return 'Bitte geben Sie Ihre E-Mail-Adresse ein.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v)) return 'Bitte prüfen Sie die E-Mail-Adresse, zum Beispiel name@firma.de.';
    return '';
  },
  phone: (v) => {
    if (!v) return 'Bitte geben Sie eine Telefonnummer für Rückfragen ein.';
    if (!/^[+0-9 ()/.-]+$/.test(v)) return 'Bitte nur Ziffern, Leerzeichen, Punkte, Bindestriche und + ( ) / verwenden.';
    if (v.replace(/\D/g, '').length < 6) return 'Die Telefonnummer ist zu kurz.';
    return '';
  },
  street: (v, st) => {
    if (!v) return st.delivery === 'versand' ? 'Bitte geben Sie Straße und Hausnummer ein.' : '';
    if (!/\d/.test(v)) return 'Bitte ergänzen Sie die Hausnummer.';
    return '';
  },
  zip: (v, st) => {
    if (!v) return st.delivery === 'versand' ? 'Bitte geben Sie die Postleitzahl ein.' : '';
    if (!/^\d{5}$/.test(v)) return 'Die Postleitzahl besteht aus fünf Ziffern.';
    return '';
  },
  city: (v, st) => (!v && st.delivery === 'versand' ? 'Bitte geben Sie den Ort ein.' : ''),
};

export function totals(st) {
  const m = MODELS[st.model] || MODELS[DEFAULT_MODEL];
  const sub = m.price * st.qty;
  const ship = st.delivery === 'versand' ? COMMON.shipping * st.qty : 0;
  const total = round2(sub + ship);
  const vat = round2((total * VAT) / (1 + VAT));
  return { model: m, sub, ship, total, vat };
}

export function createFlow(root, hooks = {}) {
  const form = root.querySelector('.co-form');
  const body = root.querySelector('.co-body');
  const steps = [...root.querySelectorAll('.co-step')];
  const stepItems = [...root.querySelectorAll('.co-steps__item')];
  const bar = root.querySelector('.co-bar i');
  const back = root.querySelector('.co-back');
  const next = root.querySelector('.co-next');
  const nextLabel = next.querySelector('.btn__label');
  const panel = root.querySelector('.co-panel');
  const navRow = root.querySelector('.co-foot__nav');
  const doneRow = root.querySelector('.co-foot__done');
  const privacyField = root.querySelector('.co-field[data-field="privacy"]');
  const shopLine = root.querySelector('.co-shopline');
  const demo = root.querySelector('#co-demo');
  const live = root.querySelector('[data-co-live]');
  const badge = root.querySelector('.co-total');
  const badgeVal = root.querySelector('.co-total__val');
  const badgeLabel = root.querySelector('.co-total__label');
  const qtyVal = root.querySelector('.co-stepper__val');
  const qtyBtns = [...root.querySelectorAll('[data-qty]')];
  const hudK = root.querySelector('.co-hud__k');
  const hudV = root.querySelector('.co-hud__v');

  const state = {
    step: 0,
    model: DEFAULT_MODEL,
    qty: 1,
    delivery: 'versand',
    payment: 'transfer',
    privacy: false,
    data: Object.fromEntries(FIELDS.map((f) => [f, ''])),
    orderNo: '',
    done: false,
  };
  const touched = new Set();
  const badgeNum = { v: 0 };
  let badgeTween = null;
  let stepTl = null;
  let busy = false;

  // prices from the product data (single source)
  root.querySelectorAll('[data-price]').forEach((el) => {
    const m = MODELS[el.dataset.price];
    if (m) el.textContent = fmtPrice(m.price);
  });
  root.querySelectorAll('[data-ship-price], [data-ship-unit]').forEach((el) => {
    el.textContent = fmtPrice(COMMON.shipping);
  });

  // ---------------------------------------------------------------- rendering helpers
  function setWhen() {
    root.querySelectorAll('[data-when]').forEach((el) => {
      el.hidden = el.dataset.when !== state.delivery;
    });
    // cash only for pickup
    if (state.delivery !== 'abholung' && state.payment === 'cash') {
      state.payment = 'transfer';
      const r = form.elements.payment;
      if (r) r.value = 'transfer';
    }
  }

  function badgeTo(value, label) {
    if (badgeLabel.textContent !== label) badgeLabel.textContent = label;
    if (Math.abs(badgeNum.v - value) < 0.005) {
      badgeVal.textContent = fmtPrice(value);
      return;
    }
    badgeTween?.kill();
    if (reducedMotion || !badgeNum.v) {
      badgeNum.v = value;
      badgeVal.textContent = fmtPrice(value);
    } else {
      badgeTween = gsap.to(badgeNum, {
        v: value,
        duration: 0.85,
        ease: 'power3.out',
        onUpdate: () => {
          badgeVal.textContent = fmtPrice(Math.round(badgeNum.v * 100) / 100);
        },
        onComplete: () => {
          badgeVal.textContent = fmtPrice(value);
        },
      });
      badge.classList.remove('is-bump');
      void badge.offsetWidth; // restart the CSS pulse
      badge.classList.add('is-bump');
    }
  }

  function renderPrice() {
    const t = totals(state);
    if (state.step === 0) badgeTo(t.sub, 'Zwischensumme');
    else badgeTo(t.total, 'Gesamt');
    return t;
  }

  function renderQty() {
    qtyVal.textContent = String(state.qty);
    qtyVal.setAttribute('aria-valuenow', String(state.qty));
    qtyVal.setAttribute('aria-valuetext', `${state.qty} ${state.qty > 1 ? 'Geräte' : 'Gerät'}`);
    qtyBtns[0].disabled = state.qty <= 1;
    qtyBtns[1].disabled = state.qty >= MAX_QTY;
  }

  function hud() {
    const t = totals(state);
    const set = (k, v) => {
      hudK.textContent = k;
      hudV.innerHTML = v;
    };
    if (state.step === 0) set(root.classList.contains('has-3d') ? `360° · ${coarse ? 'Wischen' : 'Ziehen'} zum Drehen` : 'Ihre Auswahl', `${wordmark} ${esc(t.model.name)} · ${esc(t.model.kw)}${NB}kW`);
    else if (state.step === 1)
      state.delivery === 'versand'
        ? set('Versand · Spedition', `${state.qty > 1 ? `${state.qty}${NB}Paletten · je 2 Spanngurte` : 'Palette · 2 Spanngurte'} · ca. ${COMMON.shippingDays}${NB}Werktage`)
        : set('Abholung', `73577${NB}Ruppertshofen · Vorführung unter Last`);
    else if (state.step === 2) set('Ihre Daten', 'bleiben in Ihrem Browser');
    else if (state.step === 3) set('Prüfen', `Gesamt ${esc(fmtPrice(t.total))}`);
    else set('Bestellnummer (Demo)', esc(state.orderNo));
  }

  function line(label, sub, value) {
    return `<div class="co-line"><dt>${label}${sub ? `<small>${sub}</small>` : ''}</dt><dd>${value}</dd></div>`;
  }

  function renderSummary() {
    const t = totals(state);
    const d = state.data;
    const lines = root.querySelector('[data-summary-lines]');
    const unit = fmtPrice(t.model.price);
    lines.innerHTML =
      line(`${wordmark} ${esc(t.model.name)}`, `${state.qty}${NB}× ${unit}`, fmtPrice(t.sub)) +
      (state.delivery === 'versand'
        ? line('Versand per Spedition', `${state.qty}${NB}× ${fmtPrice(COMMON.shipping)}`, fmtPrice(t.ship))
        : line('Abholung in Ruppertshofen', 'ab Lager', 'kostenlos'));
    root.querySelector('[data-sum-total]').textContent = fmtPrice(t.total);
    root.querySelector('[data-sum-vat]').textContent = `darin enthalten 19${NB}% MwSt.: ${fmtPrice(t.vat)}`;

    const name = [d.firstName, d.lastName].filter(Boolean).join(' ');
    const addr = [esc(name), esc(d.company), esc(d.street), esc([d.zip, d.city].filter(Boolean).join(' '))].filter(Boolean).join('<br>');
    const where =
      state.delivery === 'versand'
        ? `<p>${addr}</p><p class="co-recap__sub">per Spedition · ca. ${COMMON.shippingDays}${NB}Werktage</p>`
        : `<p>Heinze Automatisierungstechnik<br>Utzstetter Str. 7/2<br>73577 Ruppertshofen</p><p class="co-recap__sub">Abholung ab Lager · Vorführung möglich</p>`;
    const contact = `<p>${esc(name)}<br>${esc(d.email)}<br>${esc(d.phone)}</p>`;
    root.querySelector('[data-summary-recap]').innerHTML =
      `<div class="co-recap__item"><span class="co-recap__k">${state.delivery === 'versand' ? 'Lieferung an' : 'Abholung bei'}</span>${where}<button class="co-edit" type="button" data-go="${state.delivery === 'versand' ? 2 : 1}">Ändern</button></div>` +
      `<div class="co-recap__item"><span class="co-recap__k">Kontakt</span>${contact}<button class="co-edit" type="button" data-go="2">Ändern</button></div>` +
      (d.note ? `<div class="co-recap__item co-recap__item--wide"><span class="co-recap__k">Anmerkung</span><p>${esc(d.note)}</p></div>` : '');
  }

  function renderDone() {
    const t = totals(state);
    root.querySelector('[data-order-no]').textContent = state.orderNo;
    root.querySelector('[data-done-sum]').innerHTML =
      line(`${wordmark} ${esc(t.model.name)}`, '', `${state.qty}${NB}Stück`) +
      line(state.delivery === 'versand' ? 'Versand per Spedition' : 'Abholung in Ruppertshofen', '', state.delivery === 'versand' ? `ca. ${COMMON.shippingDays}${NB}Werktage` : 'ab sofort') +
      line('Zahlungsart', '', esc(PAY_LABEL[state.payment])) +
      line('Gesamtsumme', '', fmtPrice(t.total));
  }

  function renderChrome() {
    const s = state.step;
    stepItems.forEach((li, i) => {
      li.classList.toggle('is-active', i === s);
      li.classList.toggle('is-done', i < s);
      const b = li.querySelector('button');
      b.disabled = !(i < s) || s === 4;
      if (i === s) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.setAttribute('aria-label', `Schritt ${i + 1}: ${STEP_NAMES[i]}${i < s ? ' (erledigt, zurückspringen)' : ''}`);
    });
    bar.style.transform = `scaleX(${Math.min(1, (s + (s < 4 ? 0.5 : 0)) / 4).toFixed(3)})`;
    back.hidden = s === 0 || s === 4;
    foot.hidden = s === 4;
    demo.hidden = s !== LAST_FORM_STEP;
    nextLabel.textContent = s === LAST_FORM_STEP ? 'Zahlungspflichtig bestellen' : 'Weiter';
    next.classList.toggle('co-next--order', s === LAST_FORM_STEP);
    root.dataset.step = String(s);
    root.dataset.delivery = state.delivery;
    renderPrice();
    hud();
  }

  // ---------------------------------------------------------------- validation
  function fieldEl(name) {
    return root.querySelector(`.co-field[data-field="${name}"]`);
  }

  function showError(name, msg) {
    const wrap = fieldEl(name);
    if (!wrap) return;
    const input = wrap.querySelector('input, textarea');
    const err = wrap.querySelector('.co-err');
    wrap.classList.toggle('is-invalid', !!msg);
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err && err.textContent !== msg) {
      err.textContent = msg;
      if (msg && !reducedMotion) gsap.fromTo(err, { autoAlpha: 0, y: -4 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    }
  }

  function validateField(name) {
    const rule = RULES[name];
    if (!rule) return '';
    const msg = rule((state.data[name] || '').trim(), state);
    showError(name, msg);
    return msg;
  }

  function validateStep(s) {
    if (s === 2) {
      let first = null;
      for (const f of Object.keys(RULES)) {
        touched.add(f);
        if (validateField(f) && !first) first = f;
      }
      if (first) {
        const input = fieldEl(first)?.querySelector('input, textarea');
        input?.focus();
        announce('Bitte prüfen Sie die markierten Felder.');
        shake();
        return false;
      }
    }
    if (s === 3) {
      if (!state.privacy) {
        showError('privacy', 'Bitte bestätigen Sie, dass Sie die Datenschutzerklärung gelesen haben.');
        root.querySelector('#co-privacy')?.focus();
        shake();
        return false;
      }
      showError('privacy', '');
    }
    return true;
  }

  function shake() {
    if (reducedMotion) return;
    gsap.fromTo(next, { x: 0 }, { x: 0, duration: 0.5, ease: 'none', keyframes: { x: [0, -7, 6, -4, 3, 0] } });
  }

  function announce(msg) {
    live.textContent = '';
    setTimeout(() => {
      live.textContent = msg;
    }, 60);
  }

  // ---------------------------------------------------------------- navigation
  function go(n, { focus = true, instant = false } = {}) {
    n = Math.max(0, Math.min(4, n));
    const from = state.step;
    if (n === from && !instant) return;
    const dir = n >= from ? 1 : -1;
    state.step = n;
    if (n === 3) renderSummary();
    if (n === 4) renderDone();
    renderChrome();
    hooks.onStep?.(n, from);

    const a = steps[from];
    const b = steps[n];
    stepTl?.progress(1).kill();
    const swap = () => {
      steps.forEach((el, i) => {
        el.hidden = i !== n;
      });
      body.scrollTop = 0;
      if (focus) b.querySelector('.co-h, .co-done__h')?.focus({ preventScroll: true });
    };
    announce(n === 4 ? `Vielen Dank! Bestellnummer (Demo) ${state.orderNo}. Es wurde nichts übermittelt.` : `Schritt ${n + 1} von 4: ${STEP_NAMES[n]}`);
    if (instant || reducedMotion || a === b) {
      swap();
      if (!instant && reducedMotion) gsap.fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, clearProps: 'opacity,visibility' });
      return;
    }
    const outEls = [...a.children];
    stepTl = gsap
      .timeline()
      .to(outEls, { autoAlpha: 0, x: -22 * dir, duration: 0.22, ease: 'power2.in', stagger: 0.015 })
      .add(() => {
        gsap.set(outEls, { clearProps: 'opacity,visibility,transform' });
        swap();
      })
      .fromTo(
        [...b.children],
        { autoAlpha: 0, x: 26 * dir },
        { autoAlpha: 1, x: 0, duration: 0.6, ease: 'expo.out', stagger: 0.045, clearProps: 'opacity,visibility,transform' }
      );
  }

  function submit() {
    if (busy) return;
    const s = state.step;
    if (!validateStep(s)) return;
    if (s < LAST_FORM_STEP) {
      go(s + 1);
      return;
    }
    if (s === LAST_FORM_STEP) {
      // nothing leaves the page: a short "processing" beat, then the finale
      busy = true;
      next.classList.add('is-busy');
      nextLabel.textContent = 'Wird verpackt …';
      const year = new Date().getFullYear();
      state.orderNo = `HAT-${year}-${String(1000 + Math.floor(Math.random() * 9000))}`;
      setTimeout(
        () => {
          busy = false;
          next.classList.remove('is-busy');
          state.done = true;
          go(4);
          hooks.onOrder?.({ ...state, data: { ...state.data } });
        },
        reducedMotion ? 150 : 900
      );
    }
  }

  // ---------------------------------------------------------------- events
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  back.addEventListener('click', () => go(state.step - 1));
  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g && !g.disabled && root.contains(g)) {
      const n = +g.dataset.go;
      if (n < state.step && state.step < 4) go(n);
    }
  });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'model') {
      setModel(t.value, true);
    } else if (t.name === 'delivery') {
      state.delivery = t.value === 'abholung' ? 'abholung' : 'versand';
      setWhen();
      renderChrome();
      // re-check the address rules that depend on the delivery mode
      for (const f of ['street', 'zip', 'city']) if (touched.has(f)) validateField(f);
      hooks.onDelivery?.(state.delivery);
    } else if (t.name === 'payment') {
      state.payment = t.value;
    } else if (t.name === 'privacy') {
      state.privacy = t.checked;
      if (t.checked) showError('privacy', '');
    }
  });

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (!FIELDS.includes(t.name)) return;
    if (t.name === 'zip') {
      const digits = t.value.replace(/\D/g, '').slice(0, 5);
      if (digits !== t.value) t.value = digits;
    }
    state.data[t.name] = t.value;
    // live re-validation once a field has been visited
    if (touched.has(t.name) && fieldEl(t.name)?.classList.contains('is-invalid')) validateField(t.name);
  });
  form.addEventListener(
    'blur',
    (e) => {
      const t = e.target;
      if (!RULES[t.name]) return;
      if (!t.value.trim() && !touched.has(t.name)) return; // do not nag on tab-through
      touched.add(t.name);
      validateField(t.name);
    },
    true
  );

  // quantity stepper
  function setQty(q) {
    const nq = Math.max(1, Math.min(MAX_QTY, q));
    if (nq === state.qty) return;
    const up = nq > state.qty;
    state.qty = nq;
    renderQty();
    renderPrice();
    if (!reducedMotion) gsap.fromTo(qtyVal, { y: up ? 7 : -7, autoAlpha: 0.2 }, { y: 0, autoAlpha: 1, duration: 0.35, ease: 'power3.out' });
    hooks.onQty?.(nq);
  }
  qtyBtns.forEach((b) => b.addEventListener('click', () => setQty(state.qty + +b.dataset.qty)));
  qtyVal.addEventListener('keydown', (e) => {
    const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 1, PageDown: -1 };
    if (e.key in map) {
      e.preventDefault();
      setQty(state.qty + map[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setQty(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      setQty(MAX_QTY);
    }
  });

  function setModel(id, fromUser = false) {
    const m = MODELS[id] ? id : DEFAULT_MODEL;
    const radio = form.querySelector(`input[name="model"][value="${m}"]`);
    if (radio && !radio.checked) radio.checked = true;
    if (m === state.model) return;
    state.model = m;
    renderPrice();
    hud();
    hooks.onModel?.(m, fromUser);
  }

  // Fresh flow (after a finished demo order: all entered data is dropped).
  function reset({ clearData = false, model } = {}) {
    stepTl?.progress(1).kill();
    if (clearData) {
      form.reset();
      for (const f of FIELDS) state.data[f] = '';
      touched.clear();
      FIELDS.forEach((f) => showError(f, ''));
      showError('privacy', '');
      Object.assign(state, { qty: 1, delivery: 'versand', payment: 'transfer', privacy: false, orderNo: '', done: false });
      form.elements.delivery.value = 'versand';
      form.elements.payment.value = 'transfer';
    }
    if (model) {
      state.model = MODELS[model] ? model : DEFAULT_MODEL;
      const radio = form.querySelector(`input[name="model"][value="${state.model}"]`);
      if (radio) radio.checked = true;
    }
    state.step = 0;
    steps.forEach((el, i) => {
      el.hidden = i !== 0;
    });
    setWhen();
    renderQty();
    badgeNum.v = 0;
    renderChrome();
  }

  setWhen();
  renderQty();
  renderChrome();

  return {
    state,
    go,
    reset,
    setModel,
    totals: () => totals(state),
    get step() {
      return state.step;
    },
    get done() {
      return state.done;
    },
    // elements animated by the shell on open
    staggerTargets() {
      const cur = steps[state.step];
      return [...root.querySelectorAll('.co-head__top > *, .co-head__row > *, .co-steps, .co-bar'), ...cur.children, foot].filter((el) => !el.hidden);
    },
  };
}
