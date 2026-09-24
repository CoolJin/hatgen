// Product data (source: heinze-at.de product page, HATGEN S5500-5DS / S6500-5DS).
export const SHOP_URL = 'https://heinze-at.de/de/products/75c289f5-a991-4a45-85c5-a8548c928f65';
export const VIDEO_ID = 'rHV2uhiizPk';

export const MODELS = {
  s5500: {
    id: 's5500',
    name: 'S5500-5DS',
    kw: '5,5',
    maxWatt: 5500,
    threePhase: { cont: 5000, max: 5500 },
    singlePhase: { cont: 3300, max: 3600 },
    price: 1039,
  },
  s6500: {
    id: 's6500',
    name: 'S6500-5DS',
    kw: '6,5',
    maxWatt: 6500,
    threePhase: { cont: 6000, max: 6500 },
    singlePhase: { cont: 3200, max: 3700 },
    price: 1288,
  },
};

export const DEFAULT_MODEL = 's5500';

export const COMMON = {
  engine: '4-Takt-Diesel, luftgekühlt',
  cylinders: 1,
  displacement: 498, // cm³
  tank: 15, // Liter
  dims: { l: 950, w: 550, h: 800 }, // mm
  weight: { net: 160, gross: 175 }, // kg
  lwa: 97, // dB(A) Schallleistungspegel
  frequency: 50, // Hz
  overload: 25, // % kurzzeitig, 3-phasig
  battery: { volt: 12, ah: 30 },
  dcOut: { volt: 12, amp: 8.3 },
  warrantyYears: 2,
  shipping: 118, // €
  shippingDays: 2,
};

export const CONTACT = {
  company: 'Heinze Automatisierungstechnik',
  street: 'Utzstetter Str. 7/2',
  zip: '73577',
  city: 'Ruppertshofen',
  phone: '07176 / 452100',
  phoneHref: 'tel:+497176452100',
  fax: '07176 / 452101',
  mobile: '0178 / 2099567',
  mobileHref: 'tel:+491782099567',
  mail: 'info@heinze-at.de',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Utzstetter+Str.+7%2F2%2C+73577+Ruppertshofen',
  site: 'https://heinze-at.de/de',
  imprint: 'https://heinze-at.de/de/imprint',
  privacy: 'https://heinze-at.de/de/privacy',
  services: 'https://heinze-at.de/de/services',
};

const nf = new Intl.NumberFormat('de-DE');
const cf = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const fmtNumber = (n) => nf.format(n);
export const fmtPrice = (n) => cf.format(n);
