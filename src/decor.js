// 場景點綴：村後山壁的 Mühlbach 瀑布（流動水紋 + 水霧 + 水潭）、煙囪炊煙
import * as THREE from 'three';
import { uv, time, vec3, float, mix, smoothstep, mx_fractal_noise_float, uniform, clamp } from 'three/tsl';
import { heightAt, shoreX, lerp, WATERFALL_Z } from './terrain.js';
import { getTextures } from './textures.js';

export function buildWaterfall(scene) {
  const T = getTextures();
  const N = 70, width = 6.5, pos = [], uvs = [], idx = [];
  let len = 0, prev = null;
  for (let k = 0; k <= N; k++) {
    const u = lerp(170, 63, k / N), z = WATERFALL_Z + Math.sin(k * 0.21) * 2.2;
    const x = shoreX(z) - u, y = heightAt(x, z) + 0.35;
    if (prev) len += Math.hypot(x - prev[0], y - prev[1], z - prev[2]);
    prev = [x, y, z];
    const w = width * (0.7 + 0.3 * Math.sin(k * 0.37) ** 2);
    pos.push(x, y, z - w / 2, x, y, z + w / 2);
    uvs.push(0, len, 1, len);
    if (k < N) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const U = uv().x, V = uv().y;
  const flow = mx_fractal_noise_float(vec3(U.mul(5), V.mul(0.28).sub(time.mul(1.8)), 0.5), 3, 2.0, 0.5, 1.0);
  const streak = smoothstep(-0.15, 0.55, flow);
  const edge = smoothstep(0.0, 0.25, U).mul(float(1).sub(smoothstep(0.75, 1.0, U)));
  const tint = uniform(new THREE.Color(1, 1, 1));
  mat.colorNode = mix(vec3(0.62, 0.78, 0.8), vec3(1, 1, 1), streak).mul(tint);
  mat.opacityNode = clamp(streak.mul(0.8).add(0.12).mul(edge), 0, 1);
  const fall = new THREE.Mesh(g, mat);
  fall.renderOrder = 2;
  scene.add(fall);

  // 水潭與水霧
  const bx = prev[0], by = prev[1], bz = prev[2];
  const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshStandardMaterial({ color: 0x2f6f73, roughness: 0.08, metalness: 0.1 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(bx - 1.5, by - 0.2, bz);
  scene.add(pool);
  const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, transparent: true, depthWrite: false, opacity: 0.45 }));
  mist.position.set(bx, by + 2, bz);
  mist.scale.set(12, 7, 1);
  scene.add(mist);
  return { setTint(c) { tint.value.set(c); mist.material.color.set(c); } };
}

export function buildSmoke(scene, chimneys, rng) {
  const T = getTextures();
  const picks = chimneys.filter(() => rng() < 0.18).slice(0, 12);
  const puffs = [];
  for (const c of picks) {
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, transparent: true, depthWrite: false, opacity: 0 }));
      sp.position.copy(c);
      scene.add(sp);
      puffs.push({ sp, c, t0: (i / 9) * 6, life: 6, drift: 0.4 + rng() * 0.3 });
    }
  }
  let color = new THREE.Color('#e8e8e8'), strength = 0.3;
  return {
    setTime(t) { color = new THREE.Color(t.smoke); strength = t.smokeAlpha; },
    update(time) {
      for (const p of puffs) {
        const a = ((time + p.t0) % p.life) / p.life;
        p.sp.position.set(p.c.x + a * 5 * p.drift + Math.sin(time * 0.6 + p.t0) * 0.3, p.c.y + a * 9, p.c.z + a * 2 * p.drift);
        const s = 0.8 + a * 4.5;
        p.sp.scale.set(s, s, 1);
        p.sp.material.opacity = Math.sin(Math.PI * a) * strength * (1 - a * 0.4);
        p.sp.material.color.copy(color);
      }
    },
  };
}
