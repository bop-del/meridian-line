// Custom final grading pass: vignette, chromatic aberration, film grain, radial speed blur,
// damage pulse, full screen flash and a level tint. Operates on linear HDR (before OutputPass).
export const PostShader = {
  name: 'MeridianPost',
  uniforms: {
    tDiffuse: { value: null },
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
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uChroma, uGrain, uBlur, uBlurReach, uBlurClear, uTaps, uDamage, uFlash;
    uniform vec3 uFlashColor, uTint;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
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
      col *= uTint;
      float d = d0;
      float vig = 1.0 - uVignette * smoothstep(0.3, 1.05, d);
      col *= vig;
      if (uDamage > 0.001) {
        float edge = smoothstep(0.15, 1.0, d);
        col = mix(col, vec3(0.9, 0.03, 0.02) * (0.4 + 0.7 * edge), uDamage * (0.04 + 0.42 * edge * edge));
      }
      if (uFlash > 0.001) col = mix(col, uFlashColor * 1.25, uFlash);
      float g = hash(vUv * 1531.7 + fract(uTime) * 91.3) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * (1.0 - clamp(dot(col, vec3(0.333)), 0.0, 1.0)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// Replaces NaN and Inf with black and clamps HDR to a safe ceiling before the bloom pass.
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
