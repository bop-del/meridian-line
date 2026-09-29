// Tumbling debris chunks: one InstancedMesh, CPU integrated (a few hundred chunks), zero allocation per frame.
import * as THREE from 'three';

const MAX = 256;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpAxis = new THREE.Vector3(), tmpC = new THREE.Color();
const tmpE = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function chunkGeometry() {
  // irregular shard: a squashed icosahedron with jittered vertices, flat shaded
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [0.75 + Math.random() * 0.5, 0.6 + Math.random() * 0.6, 0.75 + Math.random() * 0.5]);
    const j = seen.get(key);
    p.setXYZ(i, p.getX(i) * j[0], p.getY(i) * j[1] * 0.6, p.getZ(i) * j[2]);
  }
  g.computeVertexNormals();
  return g;
}

export class DebrisPool {
  constructor(scene, onEmber) {
    this.onEmber = onEmber;
    this.geo = chunkGeometry();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.45, flatShading: true, emissive: 0x220a00, emissiveIntensity: 1 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fxDebris';
    for (let i = 0; i < MAX; i++) { this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, tmpC.set(0x888888)); }
    scene.add(this.mesh);
    this.pos = new Float32Array(MAX * 3); this.vel = new Float32Array(MAX * 3);
    this.axis = new Float32Array(MAX * 3); this.spin = new Float32Array(MAX);
    this.quat = new Float32Array(MAX * 4); this.size = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); this.age = new Float32Array(MAX); this.ember = new Float32Array(MAX);
    this.cursor = 0; this.active = 0; this.colorDirty = false;
  }

  spawn(x, y, z, vx, vy, vz, size, color, life) {
    const i = this.cursor; this.cursor = (i + 1) % MAX;
    if (this.life[i] <= 0) this.active++;
    const a = i * 3;
    this.pos[a] = x; this.pos[a + 1] = y; this.pos[a + 2] = z;
    this.vel[a] = vx; this.vel[a + 1] = vy; this.vel[a + 2] = vz;
    tmpAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.axis[a] = tmpAxis.x; this.axis[a + 1] = tmpAxis.y; this.axis[a + 2] = tmpAxis.z;
    this.spin[i] = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 9);
    tmpE.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28); tmpQ.setFromEuler(tmpE);
    this.quat[i * 4] = tmpQ.x; this.quat[i * 4 + 1] = tmpQ.y; this.quat[i * 4 + 2] = tmpQ.z; this.quat[i * 4 + 3] = tmpQ.w;
    this.size[a] = size * (0.6 + Math.random() * 0.9); this.size[a + 1] = size * (0.5 + Math.random() * 0.8); this.size[a + 2] = size * (0.6 + Math.random() * 0.9);
    this.life[i] = life; this.age[i] = 0; this.ember[i] = Math.random() * 0.08;
    tmpC.setHex(color); tmpC.multiplyScalar(0.55 + Math.random() * 0.6);
    this.mesh.setColorAt(i, tmpC);
    this.colorDirty = true;
  }

  update(dt) {
    if (this.active <= 0 && !this.colorDirty) return;
    const drag = Math.exp(-0.6 * dt);
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const a = i * 3;
      const rem = this.life[i] - this.age[i];
      if (rem <= 0) { this.life[i] = 0; this.mesh.setMatrixAt(i, ZERO); continue; }
      alive++;
      this.vel[a] *= drag; this.vel[a + 1] = this.vel[a + 1] * drag - 3.5 * dt; this.vel[a + 2] *= drag;
      this.pos[a] += this.vel[a] * dt; this.pos[a + 1] += this.vel[a + 1] * dt; this.pos[a + 2] += this.vel[a + 2] * dt;
      tmpQ.set(this.quat[i * 4], this.quat[i * 4 + 1], this.quat[i * 4 + 2], this.quat[i * 4 + 3]);
      tmpAxis.set(this.axis[a], this.axis[a + 1], this.axis[a + 2]);
      tmpQ2.setFromAxisAngle(tmpAxis, this.spin[i] * dt);
      tmpQ.premultiply(tmpQ2);
      this.quat[i * 4] = tmpQ.x; this.quat[i * 4 + 1] = tmpQ.y; this.quat[i * 4 + 2] = tmpQ.z; this.quat[i * 4 + 3] = tmpQ.w;
      const shrink = rem < 0.4 ? rem / 0.4 : 1;
      tmpS.set(this.size[a] * shrink, this.size[a + 1] * shrink, this.size[a + 2] * shrink);
      tmpP.set(this.pos[a], this.pos[a + 1], this.pos[a + 2]);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
      this.ember[i] -= dt;
      if (this.ember[i] <= 0 && this.age[i] < this.life[i] * 0.7) {
        this.ember[i] = 0.05 + Math.random() * 0.05;
        this.onEmber?.(this.pos[a], this.pos[a + 1], this.pos[a + 2], this.vel[a] * 0.2, this.vel[a + 1] * 0.2, this.vel[a + 2] * 0.2);
      }
    }
    this.active = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.mesh.instanceColor) { this.mesh.instanceColor.needsUpdate = true; this.colorDirty = false; }
  }

  clear() {
    for (let i = 0; i < MAX; i++) { this.life[i] = 0; this.mesh.setMatrixAt(i, ZERO); }
    this.active = 0; this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose?.(); this.mesh.parent?.remove(this.mesh); }
}
