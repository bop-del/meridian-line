// Controlled HDR bloom: UnrealBloomPass with its own bright pass (soft knee threshold plus a luminance cap on what may enter the
// glow, NaN safe) and no final blend: the grade pass samples bloom.texture and adds it, which saves a full screen pass and keeps the
// bloom strength next to the tone curve.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const BrightShader = {
  uniforms: { tDiffuse: { value: null }, luminosityThreshold: { value: 1.0 }, smoothWidth: { value: 0.5 }, uKnee: { value: 0.5 }, uCap: { value: 4.0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold, uKnee, uCap;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      c = clamp(c, vec3(0.0), vec3(64.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float k = max(uKnee, 1e-3);
      float soft = clamp(l - luminosityThreshold + k, 0.0, 2.0 * k);
      soft = soft * soft / (4.0 * k);
      float w = max(soft, l - luminosityThreshold) / max(l, 1e-4);
      c *= w;
      float l2 = l * w;
      c *= min(1.0, uCap / max(l2, 1e-4));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class MeridianBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold) {
    super(resolution, strength, radius, threshold);
    this.materialHighPassFilter.dispose();
    this.highPassUniforms = THREE.UniformsUtils.clone(BrightShader.uniforms);
    this.materialHighPassFilter = new THREE.ShaderMaterial({ uniforms: this.highPassUniforms, vertexShader: BrightShader.vertexShader, fragmentShader: BrightShader.fragmentShader });
    this.needsSwap = false;
    this.knee = 0.5; this.cap = 4;
  }

  /** the composited glow of the last render (HDR, already scaled by strength) */
  get texture() { return this.renderTargetsHorizontal[0].texture; }

  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    const hp = this.highPassUniforms;
    hp.tDiffuse.value = readBuffer.texture;
    hp.luminosityThreshold.value = this.threshold;
    hp.uKnee.value = this.knee; hp.uCap.value = this.cap;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright); renderer.clear(); this.fsQuad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this.fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]); renderer.clear(); this.fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]); renderer.clear(); this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    this.fsQuad.material = this.compositeMaterial;
    const cu = this.compositeMaterial.uniforms;
    cu.bloomStrength.value = this.strength; cu.bloomRadius.value = this.radius; cu.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]); renderer.clear(); this.fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}
