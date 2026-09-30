// Scene pass: draws the scene into its own HDR target with a depth texture (RenderPass semantics, but the depth is kept for the
// post chain: height fog, far blur, shaft occlusion and sun visibility). The composer ping pong buffers carry no depth texture, so
// no later pass ever samples a depth texture that is attached to the framebuffer it draws into (a WebGL feedback loop).
// The next pass (sanitise and fog) reads scenePass.target.texture directly, so this pass does not swap.
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

export class ScenePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = false;
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    depth.minFilter = THREE.NearestFilter; depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, depthTexture: depth, samples: 0 });
    this.target.texture.name = 'ScenePass.color';
  }

  get depthTexture() { return this.target.depthTexture; }

  setSize(w, h) { this.target.setSize(Math.max(1, w), Math.max(1, h)); }

  render(renderer /* , writeBuffer, readBuffer */) {
    const old = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = old;
  }

  dispose() { this.target.depthTexture?.dispose(); this.target.dispose(); }
}
