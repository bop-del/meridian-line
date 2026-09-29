// Procedural image based lighting: a small studio/space scene baked to a PMREM cube so that
// metal and clearcoat materials (the Vanta) have something to reflect. No external assets.
import * as THREE from 'three';

export function makeEnvironment(renderer) {
  const s = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 top = vec3(0.55, 0.68, 0.95);
          vec3 hor = vec3(0.30, 0.34, 0.46);
          vec3 bot = vec3(0.04, 0.05, 0.10);
          vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, bot, pow(-h, 0.5));
          gl_FragColor = vec4(c * 0.9, 1.0);
        }`,
    }),
  );
  s.add(dome);
  const box = (w, h, col, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  box(30, 14, 0xfff2e0, -18, 34, 12, 7);   // key softbox, warm sun-ish
  box(20, 10, 0x9cc4ff, 26, 16, -18, 4);   // cool fill
  box(40, 5, 0xffffff, 0, 8, -40, 3);      // long strip in front
  box(18, 8, 0xff9a60, 0, -14, 34, 2.2);   // warm bounce from below/back
  box(10, 30, 0x88aaff, -40, 0, -6, 2.5);  // side rim
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.035);
  pm.dispose();
  dome.geometry.dispose(); dome.material.dispose();
  s.traverse((o) => { if (o.isMesh && o !== dome) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}
