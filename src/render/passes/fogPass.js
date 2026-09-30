// Sanitise plus far blur plus height fog, one full screen pass that reads the scene colour and depth from ScenePass.
//
// SanitizeFogShader: replaces NaN and Inf with black and clamps HDR to uMax (the round 1 sanitise semantics, it must stay the first
// pass after the scene so bloom never sees a bad value), then, when the fog tier flag is on, adds height fog that is densest at the
// water or floor (analytic integral of density * exp(-height / falloff) along the view ray) plus a thin distance haze, with sun
// coloured in scatter toward each sun. Fog starts uStart units from the camera, so the ship and near enemies are never fogged.
//
// Far blur (the uDof* uniforms): very subtle depth of field on far pixels only (tier 0). The blur radius grows from uStart over uRange; each tap is
// weighted by its own blur amount, so a near, sharp silhouette never bleeds into the blurred background around it.
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const SanitizeFogShader = {
  name: 'SanitizeFog',
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uMax: { value: 24.0 },
    uFogOn: { value: 0 }, uInvProj: { value: null }, uCamWorld: { value: null },
    uFogColor: { value: [0.5, 0.6, 0.7] }, uFloorY: { value: -26 }, uHDensity: { value: 0 }, uHFalloff: { value: 20 }, uDist: { value: 0 },
    uStart: { value: 40 }, uFogMax: { value: 0.85 }, uSkyAmt: { value: 0.3 }, uSkyDist: { value: 1500 },
    uSunDir0: { value: [0, 0, -1] }, uSunCol0: { value: [0, 0, 0] }, uSunDir1: { value: [0, 0, -1] }, uSunCol1: { value: [0, 0, 0] }, uSunFog: { value: 0 },
    uNear: { value: 0.1 }, uFar: { value: 4000 }, uDofAmt: { value: 0 }, uDofStart: { value: 90 }, uDofRange: { value: 500 }, uDofRadius: { value: [0.001, 0.0018] },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform float uMax, uFogOn, uFloorY, uHDensity, uHFalloff, uDist, uStart, uFogMax, uSkyAmt, uSkyDist, uSunFog;
    uniform mat4 uInvProj, uCamWorld;
    uniform vec3 uFogColor, uSunDir0, uSunCol0, uSunDir1, uSunCol1;
    uniform float uNear, uFar, uDofAmt, uDofStart, uDofRange;
    uniform vec2 uDofRadius;
    varying vec2 vUv;
    vec3 fetch(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      return clamp(c, vec3(0.0), vec3(uMax));
    }
    float coc(float d) {
      if (d > 0.9999995) return uDofAmt;
      float z = uNear * uFar / max(uFar - d * (uFar - uNear), 1e-4);
      return uDofAmt * clamp((z - uDofStart) / max(uDofRange, 1.0), 0.0, 1.0);
    }
    void main() {
      vec3 c = fetch(vUv);
      float d = texture2D(tDepth, vUv).x;
      // far only depth of field (tier 0): 6 tap Vogel disc, each tap weighted by its own blur amount so near silhouettes never bleed
      if (uDofAmt > 0.001) {
        // open sky is smooth, blurring it costs taps and changes nothing, so only far geometry is blurred
        float c0 = d > 0.9999995 ? 0.0 : coc(d);
        if (c0 > 0.02) {
          vec3 acc = c; float ws = 1.0;
          for (int i = 0; i < 6; i++) {
            float fi = float(i) + 0.5;
            float a = fi * 2.39996;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(fi / 6.0) * uDofRadius * c0;
            float w = clamp(coc(texture2D(tDepth, uv).x) / c0, 0.0, 1.0);
            acc += fetch(uv) * w; ws += w;
          }
          c = acc / ws;
        }
      }
      if (uFogOn > 0.5) {
        bool sky = d > 0.9999995;
        vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, (sky ? 0.5 : d) * 2.0 - 1.0, 1.0);
        vec3 v = vp.xyz / (abs(vp.w) < 1e-6 ? 1e-6 : vp.w);
        float L = sky ? uSkyDist : length(v);
        vec3 dir = normalize(mat3(uCamWorld) * (v / max(length(v), 1e-4)));
        float s0 = min(uStart, L);
        float Ls = max(L - uStart, 0.0);
        float H = max(uHFalloff, 0.5);
        float hA = uCamWorld[3].y + dir.y * s0 - uFloorY;
        float hB = hA + dir.y * Ls;
        float eA = exp(-clamp(hA / H, -8.0, 40.0));
        float eB = exp(-clamp(hB / H, -8.0, 40.0));
        float hi = abs(dir.y) > 1e-3 ? uHDensity * H * (eA - eB) / dir.y : uHDensity * Ls * eA;
        float tau = max(hi, 0.0) + uDist * Ls;
        float f = min(1.0 - exp(-min(tau, 30.0)), uFogMax);
        if (sky) f *= uSkyAmt;
        float g0 = max(dot(dir, uSunDir0), 0.0), g1 = max(dot(dir, uSunDir1), 0.0);
        g0 *= g0; g0 *= g0; g0 *= g0; g1 *= g1; g1 *= g1; g1 *= g1;
        vec3 fc = uFogColor + (uSunCol0 * g0 + uSunCol1 * g1) * uSunFog;
        c = mix(c, fc, f);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};
