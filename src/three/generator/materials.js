// Material library.
//
// To keep draw calls low, most surfaces share a few "family" materials (paint, plastic,
// cast metal, polished metal) and get their color, roughness, metalness and clearcoat per
// vertex. Every vertex also carries a packed id (aExtra.x = part + 32 * ghostGroup):
//  * part: a single uniform array drives the per-part highlight without splitting meshes
//  * ghostGroup: 0 = solid, 1 = enclosure sheet metal, 2 = acoustic foam. The exploded view
//    dissolves groups 1 and 2 into a faint edge-line cage (uGhost[group], see index.js).
//
// All materials are patched once with:
//  * blueprint: final color lerps to a flat dark occluder color (one shared uniform)
//  * highlight: uHi[part] draws attention to a part, in the style HI_MODE picks for it
//  * ghost: noise + top-down dissolve with a glowing red burn edge
import * as THREE from 'three';

export const HIGHLIGHT_PARTS = [
  'display', 'cee', 'schuko1', 'schuko2', 'dc12', 'keySwitch', 'breaker',
  'engine', 'alternator', 'avr', 'tank', 'battery', 'muffler', 'insulation', 'fuelCap',
  'panel', 'door', 'label', 'lid', 'frame', 'wheels', 'vents', 'exhaust',
];
export const PART_INDEX = Object.fromEntries(HIGHLIGHT_PARTS.map((p, i) => [p, i + 1]));
const PART_SLOTS = HIGHLIGHT_PARTS.length + 1;
// Highlight style per part. 0 glow: small panel parts seen head-on in close-ups glow in their
// own color plus a red rim. 1 rim: big assemblies only get a thin red fresnel rim and a
// slight lift, so their real materials (aluminium, copper, steel) stay readable. 2 soft:
// the acoustic foam just brightens a little (a rim on its egg-crate normals reads as a red
// checkerboard).
const HI_MODE = {
  display: 0, cee: 0, schuko1: 0, schuko2: 0, dc12: 0, keySwitch: 0, breaker: 0, fuelCap: 0,
  insulation: 2,
};
export const GHOST_STRIDE = 32; // aExtra.x = part + GHOST_STRIDE * ghostGroup
export const GHOST_GROUPS = 3;

// key -> [family, color, roughness, metalness, clearcoat multiplier]
const KEYS = {
  // paint family (powder coat etc.)
  powder: ['paint', 0x131313, 0.6, 0, 1],
  powderSoft: ['paint', 0x151515, 0.72, 0, 0.4],
  red: ['paint', 0xb01f1b, 0.48, 0, 1.4],
  tankPaint: ['paint', 0x1b1c1f, 0.4, 0.15, 2],
  frame: ['paint', 0x1c1d1f, 0.55, 0.35, 0.5],
  panelPlate: ['paint', 0x101010, 0.46, 0.2, 0.8],
  // plastic / rubber family
  plasticBlack: ['plastic', 0x0e0e0f, 0.4, 0, 1],
  plasticGray: ['plastic', 0x2a2b2d, 0.5, 0, 0.5],
  plasticWhite: ['plastic', 0xe4e2dc, 0.42, 0, 0.8],
  blue: ['plastic', 0x1d4ea6, 0.45, 0, 0.4],
  capBlue: ['plastic', 0x1985e0, 0.3, 0, 1.2],
  ceeRed: ['plastic', 0xc5161c, 0.42, 0, 0.8],
  yellow: ['plastic', 0xe2a900, 0.38, 0, 1],
  wireRed: ['plastic', 0x9e110e, 0.45, 0, 0.5],
  wireBlue: ['plastic', 0x1c4c9e, 0.45, 0, 0.5],
  rubber: ['plastic', 0x111111, 0.86, 0, 0],
  soot: ['plastic', 0x040404, 0.95, 0, 0],
  // cast / dark metal family (coarse cast grain as roughness + bump)
  darkSteel: ['metal', 0x2a2b2e, 0.42, 0.85, 1],
  alu: ['metal', 0x8e9194, 0.62, 0.85, 1],
  aluDark: ['metal', 0x62656a, 0.62, 0.8, 1],
  heatSteel: ['metal', 0x86735f, 0.42, 1, 1],
  // polished metal family (fine brushed streaks as roughness, no bump)
  steel: ['polished', 0xd4d7da, 0.3, 1, 1],
  chrome: ['polished', 0xeceef0, 0.14, 1, 1],
  brushed: ['polished', 0xc2c6c9, 0.34, 1, 1],
  brass: ['polished', 0xc8a04a, 0.32, 1, 1],
};
// keys that are their own material (textures / emissive / transparency)
const SPECIAL = new Set(['copper', 'foam', 'muffler', 'display', 'ledGreen', 'ledAmber', 'decal', 'legend', 'label']);
// materials that already carry a negative polygon offset (decals) keep it
const OFFSET_EXEMPT = new Set(['decal', 'legend', 'label']);

// Cheap 3D value noise for the dissolve (GLSL).
const NOISE_GLSL = /* glsl */ `
float hgHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float hgNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( hgHash( i ), hgHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( hgHash( i + vec3( 0, 1, 0 ) ), hgHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( hgHash( i + vec3( 0, 0, 1 ) ), hgHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( hgHash( i + vec3( 0, 1, 1 ) ), hgHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
`;

// Dissolve test: a top-down scan wipe with a gently wavy edge. Sets hgBurn (0..1 glow near
// the edge) or discards the fragment.
const GHOST_FRAGMENT = /* glsl */ `
  float hgBurn = 0.0;
  int hgPacked = int( vExtra.x + 0.5 );
  int hgGroup = hgPacked / ${GHOST_STRIDE};
  int hgPart = hgPacked - hgGroup * ${GHOST_STRIDE};
  {
    float g = hgGroup == 1 ? uGhost[ 1 ] : ( hgGroup == 2 ? uGhost[ 2 ] : 0.0 );
    if ( g > 0.0001 ) {
      float n = hgNoise( vGhostP * 7.0 ) * 0.7 + hgNoise( vGhostP * 23.0 ) * 0.3;
      float h = clamp( ( 1.25 - ( vGhostY - uGhostY0 ) ) / 1.25, 0.0, 1.0 );
      float d = h * 0.95 + n * 0.05;
      const float w = 0.012;
      float cut = g * ( 1.0 + 2.0 * w ) - w;
      if ( d < cut ) discard;
      hgBurn = 1.0 - smoothstep( 0.0, w, d - cut );
    }
  }
`;

export function createMaterials({ tex, quality = 'high' }) {
  // Clearcoat adds a second specular pass per light on the largest surfaces. Below high,
  // only the small glossy parts (display window, LEDs) keep it.
  const coat = quality === 'high';
  const U = {
    blueprint: { value: 0 },
    bpColor: { value: new THREE.Color(0x070202) },
    hiColor: { value: new THREE.Color(0xff2a22) },
    hi: { value: new Array(PART_SLOTS).fill(0) },
    // extra flat red wash per part, for small dark / neutral parts seen head-on (key switch,
    // display bezel, 12 V posts) where neither the own-color glow nor the rim shows
    hiWash: { value: new Array(PART_SLOTS).fill(0) },
    hiMode: { value: [0, ...HIGHLIGHT_PARTS.map((p) => HI_MODE[p] ?? 1)] },
    ghost: { value: new Array(GHOST_GROUPS).fill(0) },
    ghostY0: { value: 0 },
  };

  const VERT_PARS = `#include <common>
attribute vec4 aExtra;
varying vec4 vExtra;
varying vec3 vGhostP;
varying float vGhostY;`;
  const VERT_MAIN = `#include <begin_vertex>
vExtra = aExtra;
vGhostP = transformed;
vGhostY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;`;
  const FRAG_PARS = `#include <common>
uniform float uGhost[ ${GHOST_GROUPS} ];
uniform float uGhostY0;
varying vec4 vExtra;
varying vec3 vGhostP;
varying float vGhostY;
${NOISE_GLSL}`;

  function bindGhost(shader) {
    shader.uniforms.uGhost = U.ghost;
    shader.uniforms.uGhostY0 = U.ghostY0;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_PARS).replace('#include <begin_vertex>', VERT_MAIN);
  }

  function patch(mat, variant = '', extra = null) {
    mat.onBeforeCompile = (shader) => {
      bindGhost(shader);
      shader.uniforms.uBlueprint = U.blueprint;
      shader.uniforms.uBpColor = U.bpColor;
      shader.uniforms.uHi = U.hi;
      shader.uniforms.uHiWash = U.hiWash;
      shader.uniforms.uHiMode = U.hiMode;
      shader.uniforms.uHiColor = U.hiColor;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `${FRAG_PARS}
          uniform float uBlueprint;
          uniform vec3 uBpColor;
          uniform float uHi[${PART_SLOTS}];
          uniform float uHiWash[${PART_SLOTS}];
          uniform float uHiMode[${PART_SLOTS}];
          uniform vec3 uHiColor;`,
        )
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${GHOST_FRAGMENT}`)
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          roughnessFactor = clamp( roughnessFactor * vExtra.y, 0.03, 1.0 );
          metalnessFactor *= vExtra.z;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float hl = uHi[ hgPart ];
            if ( hl > 0.0001 ) {
              vec3 dc = diffuseColor.rgb;
              float mode = uHiMode[ hgPart ];
              if ( mode < 0.5 ) {
                // Glow in the part's own color (saturated parts: blue sockets stay blue, the
                // red CEE glows red) plus a brand-red fresnel rim that carries neutral parts.
                float fr = 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 );
                float mx = max( max( dc.r, dc.g ), dc.b );
                float sat = ( mx - min( min( dc.r, dc.g ), dc.b ) ) / max( mx, 1e-4 );
                vec3 selfGlow = dc * ( 0.3 + 1.05 * sat );
                vec3 rim = uHiColor * ( 0.05 + 1.3 * pow( fr, 2.6 ) ) * ( 1.0 - 0.75 * sat );
                float lum = dot( dc, vec3( 0.2126, 0.7152, 0.0722 ) );
                vec3 wash = uHiColor * uHiWash[ hgPart ] * ( 1.0 - sat ) * ( 1.0 - min( lum * 2.5, 1.0 ) );
                totalEmissiveRadiance += hl * ( selfGlow + rim + wash );
              } else if ( mode < 1.5 ) {
                // Thin silhouette rim from the geometric normal (bump maps would speckle it)
                // and a slight lift in the part's own color.
                float fr = 1.0 - clamp( abs( dot( nonPerturbedNormal, normalize( vViewPosition ) ) ), 0.0, 1.0 );
                float rim = smoothstep( 0.55, 1.0, fr );
                totalEmissiveRadiance += hl * ( dc * 0.16 + uHiColor * ( 1.8 * rim * rim ) );
              } else {
                totalEmissiveRadiance += hl * ( dc * 0.55 + uHiColor * 0.01 );
              }
            }
            totalEmissiveRadiance += uHiColor * ( hgBurn * hgBurn * 1.8 );
          }`,
        )
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = mix( gl_FragColor.rgb, uBpColor, uBlueprint );');
      if (mat.isMeshPhysicalMaterial) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_physical_fragment>',
          '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n material.clearcoat *= vExtra.w;\n#endif',
        );
      }
      if (extra) extra(shader);
    };
    mat.customProgramCacheKey = () => `hatgen2-${variant}`;
    return mat;
  }

  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const decalBase = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

  const defs = {
    paint: () => (coat ? P : S)({ vertexColors: true, roughness: 1, metalness: 1, ...(coat && { clearcoat: 0.16, clearcoatRoughness: 0.38 }), roughnessMap: tex.powder, bumpMap: tex.powder, bumpScale: 0.045 }),
    plastic: () => (coat ? P : S)({ vertexColors: true, roughness: 1, metalness: 0, ...(coat && { clearcoat: 0.22, clearcoatRoughness: 0.22 }) }),
    metal: () => S({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: tex.cast, bumpMap: tex.cast, bumpScale: 0.07 }),
    // brushed texture G averages ~0.6: scale so the per-key roughness stays the mean
    polished: () => S({ vertexColors: true, roughness: 1.65, metalness: 1, roughnessMap: tex.brushed }),
    copper: () => S({ color: 0xc8743e, roughness: 0.3, metalness: 1.0, bumpMap: tex.winding, bumpScale: 1.2 }),
    foam: () => S({ color: 0x4d4d53, map: tex.foamColor, roughness: 1.0, metalness: 0.0, normalMap: tex.foamNormal, normalScale: new THREE.Vector2(0.75, 0.75) }),
    muffler: () => S({ color: 0xffffff, map: tex.heat, roughness: 0.34, metalness: 1.0 }),
    display: () => P({ color: 0x1a1a1a, map: tex.display.texture, emissive: 0xffffff, emissiveMap: tex.display.texture, emissiveIntensity: 0, roughness: 0.1, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.04 }),
    ledGreen: () => P({ color: 0x0c2a12, emissive: 0x2dff5a, emissiveIntensity: 0, roughness: 0.2, clearcoat: 1 }),
    ledAmber: () => P({ color: 0x2a1a06, emissive: 0xffa11a, emissiveIntensity: 0, roughness: 0.2, clearcoat: 1 }),
    decal: () => S({ map: tex.atlas, roughness: 0.5, metalness: 0.0, ...decalBase }),
    legend: () => S({ map: tex.panel, roughness: 0.5, metalness: 0.0, ...decalBase }),
    label: () => {
      const m = (coat ? P : S)({ map: tex.label.s5500, roughness: 0.3, metalness: 0.0, ...(coat && { clearcoat: 0.6, clearcoatRoughness: 0.18 }), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      m.userData.mix = { value: 0 };
      m.userData.map2 = { value: tex.label.s6500 };
      return m;
    },
  };

  const labelExtra = (mat) => (shader) => {
    shader.uniforms.uMix = mat.userData.mix;
    shader.uniforms.uMap2 = mat.userData.map2;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D uMap2;\nuniform float uMix;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 texA = texture2D( map, vMapUv );
          vec4 texB = texture2D( uMap2, vMapUv );
          diffuseColor *= mix( texA, texB, uMix );
        #endif`,
      );
  };

  const cache = new Map();
  function get(family) {
    let m = cache.get(family);
    if (m) return m;
    const make = defs[family];
    if (!make) throw new Error(`[generator] unknown material "${family}"`);
    m = make();
    m.name = `hatgen:${family}`;
    patch(m, family === 'label' ? 'label' : '', family === 'label' ? labelExtra(m) : null);
    cache.set(family, m);
    return m;
  }

  // Shadow-pass materials for dissolving (ghosted) enclosure meshes: same discard, so the
  // shadows dissolve with the panels. One variant with and one without a color map (three
  // copies the mesh material's map onto the depth material).
  const depthCache = new Map();
  function ghostDepth(withMap) {
    const k = withMap ? 'map' : 'plain';
    let m = depthCache.get(k);
    if (m) return m;
    m = new THREE.MeshDepthMaterial();
    m.name = `hatgen:ghostDepth:${k}`;
    m.onBeforeCompile = (shader) => {
      bindGhost(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', FRAG_PARS)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${GHOST_FRAGMENT}`);
    };
    m.customProgramCacheKey = () => `hatgen2-ghostdepth-${k}`;
    depthCache.set(k, m);
    return m;
  }

  // Resolve a legacy key ('powder', 'plasticBlack', ...) to family + per-vertex values.
  const _c = new THREE.Color();
  function resolve(key) {
    if (SPECIAL.has(key)) return { family: key, color: [1, 1, 1], rough: 1, metal: 1, coat: 1 };
    const d = KEYS[key];
    if (!d) throw new Error(`[generator] unknown material key "${key}"`);
    _c.setHex(d[1]);
    return { family: d[0], color: [_c.r, _c.g, _c.b], rough: d[2], metal: d[3], coat: d[4] };
  }

  const byFamily = (family) => (cache.has(family) ? [cache.get(family)] : []);

  // While edge lines are drawn (blueprint or ghost cage), push the faces back a little so
  // coplanar edges win the depth test. Pure GL state, no shader recompile.
  let offsetOn = false;
  function setEdgeOffset(on) {
    on = !!on;
    if (on === offsetOn) return;
    offsetOn = on;
    for (const [family, m] of cache) {
      if (OFFSET_EXEMPT.has(family)) continue;
      m.polygonOffset = on;
      m.polygonOffsetFactor = on ? 1 : 0;
      m.polygonOffsetUnits = on ? 2 : 0;
    }
  }

  function dispose() {
    for (const m of cache.values()) m.dispose();
    for (const m of depthCache.values()) m.dispose();
    cache.clear();
    depthCache.clear();
  }

  return { get, resolve, byFamily, ghostDepth, setEdgeOffset, U, dispose, all: () => [...cache.values()] };
}
