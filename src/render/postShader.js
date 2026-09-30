// Grade pass (PostShader): the last HDR pass before OutputPass (which then only encodes sRGB, the tone curve lives here).
// Order: radial speed blur and chromatic fringe, + bloom, + light shafts and lens flare (sun pass), level tint, white-out guard, ACES tone curve with exposure,
// parametric grade (lift, gamma, gain, contrast, saturation, shadow and highlight tint, LUT style in a perceptual space), vignette,
// damage pulse, full screen flash, film grain. Every input is clamped and every pow gets a positive base (NaN safe).
export const PostShader = {
  name: 'MeridianPost',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null }, tShafts: { value: null }, tVis: { value: null },
    uBloomOn: { value: 0 }, uShaftsOn: { value: 0 },
    uExposure: { value: 1 }, uGradeOn: { value: 1 }, uGuard: { value: 0 },
    uLift: { value: 0 }, uGamma: { value: 1 }, uGain: { value: 1 }, uContrast: { value: 1 }, uSat: { value: 1 },
    uShadowTint: { value: [1, 1, 1] }, uHighTint: { value: [1, 1, 1] },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uChroma: { value: 0.001 },
    uGrain: { value: 0.035 },
    uBlur: { value: 0 },
    uBlurReach: { value: 0.075 },
    uBlurClear: { value: 0.22 },
    uTaps: { value: 6 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: [1, 1, 1] },
    uTint: { value: [1, 1, 1] },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tBloom, tShafts, tVis;
    uniform float uBloomOn, uShaftsOn, uExposure, uGradeOn, uGuard;
    uniform float uLift, uGamma, uGain, uContrast, uSat;
    uniform vec3 uShadowTint, uHighTint;
    uniform float uTime, uVignette, uChroma, uGrain, uBlur, uBlurReach, uBlurClear, uTaps, uDamage, uFlash;
    uniform vec3 uFlashColor, uTint;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color, float exposure) {
      const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= exposure / 0.6;
      color = ACESInputMat * color;
      color = RRTAndODTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 ca = c * uChroma * (0.35 + r2 * 5.0);
      vec3 col;
      float d0 = length(c) * 1.4142;
      float bm = uBlur * uBlurReach * smoothstep(uBlurClear, 1.0, d0);
      if (bm > 0.0004) {
        // velocity aware radial blur: sharp centre, smear growing toward the edges, per pixel jitter hides the tap steps
        float jit = hash(vUv * 913.1 + fract(uTime) * 17.0) * 0.5;
        vec3 acc = vec3(0.0);
        float ws = 0.0;
        for (int i = 0; i < 6; i++) {
          if (float(i) >= uTaps) break;
          float f = (float(i) + jit) / uTaps;
          float w = 1.0 - f * 0.65;
          acc += w * texture2D(tDiffuse, vUv - c * f * bm).rgb;
          ws += w;
        }
        col = acc / ws;
        if (uChroma > 0.00005) {
          // fringe: red and blue shifted at the middle of the smear (two extra fetches plus the reference)
          vec2 mid = vUv - c * 0.45 * bm;
          col.r += texture2D(tDiffuse, mid + ca).r - texture2D(tDiffuse, mid).r;
          col.b += texture2D(tDiffuse, mid - ca).b - texture2D(tDiffuse, mid).b;
        }
      } else {
        col = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
      }
      if (uBloomOn > 0.5) col += texture2D(tBloom, vUv).rgb;
      // light shafts and lens flare, drawn at low resolution by the sun pass and already scaled
      if (uShaftsOn > 0.5) col += texture2D(tShafts, vUv).rgb;
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      col = clamp(col * uTint, 0.0, 64.0);
      // white-out guard: when the mean frame luminance (after exposure) climbs past uGuard, exposure eases down so a flood of
      // light never turns the whole frame white (the mean is held at the limit)
      float expo = uExposure;
      if (uGuard > 0.001) {
        float m = texture2D(tVis, vec2(0.625, 0.5)).r * uExposure;
        if (m == m && m > uGuard) expo *= uGuard / m;
      }
      col = aces(col, expo);
      if (uGradeOn > 0.5) {
        // grade in a perceptual space (square root of display linear), then back
        vec3 p = sqrt(col);
        p = uGain * (p + uLift * (1.0 - p));
        p = pow(max(p, vec3(1e-5)), vec3(1.0 / max(uGamma, 0.05)));
        p = (p - 0.5) * uContrast + 0.5;
        float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
        p = max(mix(vec3(l), p, uSat), 0.0);
        l = clamp(dot(p, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        p *= mix(uShadowTint, uHighTint, smoothstep(0.08, 0.85, l));
        p = clamp(p, 0.0, 1.0);
        col = p * p;
      }
      float vig = 1.0 - uVignette * smoothstep(0.3, 1.05, d0);
      col *= vig;
      if (uDamage > 0.001) {
        float edge = smoothstep(0.15, 1.0, d0);
        col = mix(col, vec3(0.75, 0.02, 0.015) * (0.45 + 0.55 * edge), uDamage * (0.04 + 0.42 * edge * edge));
      }
      float g = hash(vUv * 1531.7 + fract(uTime) * 91.3) - 0.5;
      // grain in the perceptual space, so it stays even from shadows to highlights instead of lifting the blacks
      vec3 pg = sqrt(clamp(col, 0.0, 1.0));
      pg += g * uGrain * (0.5 + 0.5 * (1.0 - clamp(dot(pg, vec3(0.333)), 0.0, 1.0)));
      // the screen flash is mixed in the perceptual space: mixing in linear light made a 0.2 flash read as half of the frame
      if (uFlash > 0.001) pg = mix(pg, sqrt(clamp(uFlashColor, 0.0, 1.0)), min(uFlash * 0.85, 0.8));
      pg = clamp(pg, 0.0, 1.0);
      gl_FragColor = vec4(pg * pg, 1.0);
    }`,
};

// Original sanitise shader, kept for tools and comparison. The live chain uses SanitizeFogShader (src/render/passes/fogPass.js),
// which does the same NaN, Inf and ceiling clamp and adds the height fog in the same pass.
export const SanitizeShader = {
  name: 'Sanitize',
  uniforms: { tDiffuse: { value: null }, uMax: { value: 24.0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 rgb = c.rgb;
      if (any(isnan(rgb)) || any(isinf(rgb))) rgb = vec3(0.0);
      rgb = clamp(rgb, vec3(0.0), vec3(uMax));
      gl_FragColor = vec4(rgb, 1.0);
    }`,
};
