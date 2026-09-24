// Studio floor: physically lit (receives the key light pool + shadow), with the baked
// contact shadow, a faint red under-glow, an anti-aliased technical grid and a radial
// alpha falloff so it melts into the background without a horizon line.
import { Color, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderChunk, Vector2 } from 'three';
import { toneMappedBase } from './color.js';
import { PAGE_BG } from './background.js';

export function createFloor({
  contactTexture,
  contactWideTexture = null,
  contactSize,
  reflectionTexture = null,
  reflectionMatrix = new Matrix4(),
  rimForward = new Vector2(0, 1),
  toneMapping = 'neutral',
}) {
  const uniforms = {
    uFade: { value: new Vector2(2.6, 8.0) },
    // Horizon fade by viewing angle (sin of the angle under the horizon).
    uHorizon: { value: new Vector2(0.045, 0.2) },
    // Pre-compensated for the tone mapper (see color.js), same as the background.
    uBase: { value: toneMappedBase(PAGE_BG, toneMapping) },
    uFloor: { value: 1 },
    uGrid: { value: 0 },
    uBlueprint: { value: 0 },
    uContactMap: { value: contactTexture },
    // Wide, very soft layer of the same bake: ambient falloff around the base.
    uContactWide: { value: contactWideTexture ?? contactTexture },
    uContactWideAmount: { value: contactWideTexture ? 0.55 : 0 },
    uContactSize: { value: contactSize },
    uContactStrength: { value: 0.92 },
    uGlowColor: { value: new Color('#150202') },
    uGridColor: { value: new Color('#ff3b36') },
    // Strength of the faint always-on 0.5 m grid and of the red under-glow.
    uGridBase: { value: 0.008 },
    uGlowAmount: { value: 1 },
    // How much of the red rim spots reaches the floor (front / behind the unit).
    uRimOnFloor: { value: new Vector2(0.025, 0.4) },
    // Direction (x, z) toward the viewer side of the rim rig (the rims turn with the camera).
    uRimFwd: { value: rimForward },
    // Planar reflection of the product (0 disables the lookup's contribution).
    uReflMap: { value: reflectionTexture },
    uReflMatrix: { value: reflectionMatrix },
    uRefl: { value: 0 },
  };

  const material = new MeshStandardMaterial({
    // Graphite, not taupe: a warm key on a warm-grey floor read as a brown pool.
    color: new Color('#111113'),
    roughness: 0.62,
    metalness: 0,
    transparent: true,
    // No depth writes: technical overlays at floor height (dimension lines, labels)
    // must not be clipped by the floor. Grounding comes from the contact bake.
    depthWrite: false,
  });
  material.name = 'stage:floor';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vFloorWorld;
uniform vec2 uFade;
uniform vec2 uHorizon;
uniform vec3 uBase;
uniform float uFloor;
uniform float uGrid;
uniform float uBlueprint;
uniform sampler2D uContactMap;
uniform sampler2D uContactWide;
uniform float uContactWideAmount;
uniform float uContactSize;
uniform float uContactStrength;
uniform vec3 uGlowColor;
uniform vec3 uGridColor;
uniform float uGridBase;
uniform float uGlowAmount;
uniform vec2 uRimOnFloor;
uniform vec2 uRimFwd;
uniform sampler2D uReflMap;
uniform mat4 uReflMatrix;
uniform float uRefl;

float stageGrid(vec2 p, float spacing, float thickness) {
  vec2 c = p / spacing;
  vec2 w = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, vec2(1e-5));
  float line = 1.0 - min(min(g.x, g.y) / thickness, 1.0);
  // Fade out when the cells approach pixel size (no moire at grazing angles).
  float lod = 1.0 - smoothstep(0.06, 0.3, max(w.x, w.y));
  return line * lod;
}
`
      )
      // No image based lighting on the floor: scene.environment overrides per-material
      // envMapIntensity in three r186, and IBL at grazing angles tints the floor red.
      .replace('#include <lights_fragment_maps>', '')
      // Red rim spots (identified by colour, independent of light order) only leave a
      // soft backlight glow behind the unit instead of pools in front of it.
      .replace(
        '#include <lights_fragment_begin>',
        ShaderChunk.lights_fragment_begin.replace(
          'getSpotLightInfo( spotLight, geometryPosition, directLight );',
          `getSpotLightInfo( spotLight, geometryPosition, directLight );
		directLight.color *= ( spotLight.color.g < 0.4 * spotLight.color.r ) ? mix( uRimOnFloor.x, uRimOnFloor.y, smoothstep( 0.1, -0.9, dot( vFloorWorld.xz, uRimFwd ) ) ) : 1.0;`
        )
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `#include <opaque_fragment>
  {
    float r = length(vFloorWorld.xz);
    // Opaque under and in front of the camera, dissolving toward the horizon and far away.
    float viewSin = cameraPosition.y / max(length(cameraPosition - vFloorWorld), 1e-3);
    float fade = smoothstep(uHorizon.x, uHorizon.y, viewSin) * (1.0 - smoothstep(uFade.x, uFade.y + uBlueprint * 2.0, r));

    vec2 cuv = vFloorWorld.xz / uContactSize + 0.5;
    vec2 inside = step(vec2(0.0), cuv) * step(cuv, vec2(1.0));
    vec2 ccuv = clamp(cuv, 0.0, 1.0);
    float tight = texture2D(uContactMap, ccuv).a;
    float wide = texture2D(uContactWide, ccuv).a * uContactWideAmount;
    float contact = max(tight, wide) * inside.x * inside.y;
    contact = clamp(contact * uContactStrength, 0.0, 0.97);

    // Unlit floor settles on the page background colour, never below it.
    vec3 col = max(gl_FragColor.rgb, uBase * 0.92) * (1.0 - contact);

    // Glossy reflection of the product: Fresnel weighted, fading away from the unit.
    if (uRefl > 0.0) {
      vec4 rp = uReflMatrix * vec4(vFloorWorld, 1.0);
      if (rp.w > 0.0) {
        vec3 refl = texture2DProj(uReflMap, rp).rgb;
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(viewSin, 0.0, 1.0), 5.0);
        float reach = 1.0 - smoothstep(0.35, 1.9, r);
        col += refl * uRefl * fres * reach * (1.0 - uBlueprint);
      }
    }

    // Warm-red bounce around the unit (the backlight spilling onto the floor).
    float glow = exp(-r * r / 2.2);
    col += uGlowColor * glow * uGlowAmount * (1.0 - contact) * (1.0 - uBlueprint * 0.6);

    // Blueprint: floor lighting sinks to near black.
    col = mix(col, col * 0.08 + vec3(0.0022, 0.0005, 0.0004), uBlueprint);

    // Grid: a whisper of a 0.5 m grid normally, a crisp red technical grid on demand.
    float major = stageGrid(vFloorWorld.xz, 0.5, 1.15);
    float minor = stageGrid(vFloorWorld.xz, 0.1, 0.9);
    float axes = 1.0 - min(min(abs(vFloorWorld.x), abs(vFloorWorld.z)) / max(fwidth(vFloorWorld.x) * 1.4, 1e-4), 1.0);
    float nearFade = 1.0 - smoothstep(0.3, 2.2, r);
    // The technical grid pools around the unit and dissolves toward camera and horizon.
    float farFade = 1.0 - smoothstep(0.6, 3.8, r);
    float emph = clamp(uGrid, 0.0, 1.0);
    float gridLight = major * uGridBase * nearFade
      + emph * farFade * (major * 0.05 + minor * 0.014 + axes * 0.05);
    col += uGridColor * gridLight * (1.0 - contact * 0.85);

    float alpha = fade * uFloor;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
  }`
      );
  };

  const geometry = new PlaneGeometry(16, 16, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'stage:floor';
  mesh.receiveShadow = true;
  mesh.renderOrder = -10;
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    uniforms,
    material,
    setContactTextures(tight, wide = null) {
      uniforms.uContactMap.value = tight;
      uniforms.uContactWide.value = wide ?? tight;
      uniforms.uContactWideAmount.value = wide ? 0.55 : 0;
    },
    setToneMapping(mode) {
      toneMappedBase(PAGE_BG, mode, uniforms.uBase.value);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
