// 植被細節：會隨風擺動的草叢、野花（花瓣＋花心）、湖岸蘆葦、巨石
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, time, sin, hash, instanceIndex, positionLocal, vec3, uniform } from 'three/tsl';
import { heightAt, shoreX, roadU, gradientAt, fbm, mulberry32 } from './terrain.js';
import { getTextures } from './textures.js';

export const wind = uniform(1.0);

// 依頂點屬性 sway（0 = 根部、1 = 尖端）擺動，相位依 instance 隨機
function swayMaterial(opts, amp) {
  const m = new THREE.MeshStandardNodeMaterial(opts);
  const s = attribute('sway', 'float');
  const ph = hash(instanceIndex).mul(6.283);
  const w = sin(time.mul(1.7).add(ph)).add(sin(time.mul(0.63).add(ph.mul(2.0))).mul(0.5)).mul(s.mul(s)).mul(amp).mul(wind);
  m.positionNode = positionLocal.add(vec3(w, 0, w.mul(0.6)));
  return m;
}

function bladeGeometry(rng, blades, hMin, hMax, base, tip, headColor) {
  const pos = [], col = [], nrm = [], sway = [], idx = [];
  const mid = base.clone().lerp(tip, 0.45);
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2, lean = 0.06 + rng() * 0.16, h = hMin + rng() * (hMax - hMin), w = 0.022 + rng() * 0.014;
    const cx = Math.cos(a) * 0.06 * rng(), cz = Math.sin(a) * 0.06 * rng();
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w, dx = Math.cos(a), dz = Math.sin(a);
    const o = pos.length / 3;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz,
      cx - px * 0.7 + dx * lean * 0.3, h * 0.55, cz - pz * 0.7 + dz * lean * 0.3,
      cx + px * 0.7 + dx * lean * 0.3, h * 0.55, cz + pz * 0.7 + dz * lean * 0.3,
      cx + dx * lean, h, cz + dz * lean);
    const tipC = tip.clone().offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.08);
    for (const c of [base, base, mid, mid, tipC]) col.push(c.r, c.g, c.b);
    sway.push(0, 0, 0.35, 0.35, 1);
    for (let k = 0; k < 5; k++) nrm.push(0, 1, 0);
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
    if (headColor && rng() < 0.5) { // 香蒲穗
      const hy = h * 0.82, ho = pos.length / 3;
      const hx = cx + dx * lean * 0.8, hz = cz + dz * lean * 0.8;
      pos.push(hx - 0.03, hy - 0.12, hz, hx + 0.03, hy - 0.12, hz, hx + 0.03, hy + 0.08, hz, hx - 0.03, hy + 0.08, hz);
      for (let k = 0; k < 4; k++) { col.push(headColor.r, headColor.g, headColor.b); sway.push(0.85); nrm.push(0, 1, 0); }
      idx.push(ho, ho + 1, ho + 2, ho, ho + 2, ho + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  return g;
}

// 五瓣小花：星形花瓣（instance 著色）＋ 黃色花心
function petalGeometry() {
  const pos = [0, 0.012, 0], idx = [], n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, r = i % 2 ? 0.5 : 1;
    pos.push(Math.cos(a) * r, 0.25 * (1 - r), Math.sin(a) * r);
    if (i > 0) idx.push(0, i + 1, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const c = new Float32Array((pos.length / 3) * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1));
  g.scale(0.055, 0.055, 0.055);
  return g;
}
function centerGeometry() {
  const g = new THREE.IcosahedronGeometry(0.02, 0);
  g.translate(0, 0.012, 0);
  g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return g;
}

const SQUARE = (z, u) => (z > 2 && z < 36 && u > 17 && u < 37.5) || (z > 26 && z < 43 && u > 30 && u < 36.5) || (z > 38 && z < 86 && u > 32.5 && u < 63);

export function buildGrass(scene, world, rng) {
  const geoRng = mulberry32(5);
  const grassGeo = bladeGeometry(geoRng, 8, 0.25, 0.5, new THREE.Color('#1d3a12'), new THREE.Color('#8fb04a'));
  const gmat = swayMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }, 0.05);
  const MAXG = 15000, MAXF = 4500;
  const grass = new THREE.InstancedMesh(grassGeo, gmat, MAXG);
  const petals = new THREE.InstancedMesh(petalGeometry(), swayMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }, 0.03), MAXF);
  const centers = new THREE.InstancedMesh(centerGeometry(), swayMaterial({ color: 0xf2c230, roughness: 0.6 }, 0.03), MAXF);
  const FCOL = ['#ffffff', '#ffffff', '#ffe066', '#b48cff', '#ff7aa8', '#5d8df0', '#f7f2ff'].map((h) => new THREE.Color(h));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  let ng = 0, nf = 0;
  for (let a = 0; a < 160000 && (ng < MAXG || nf < MAXF); a++) {
    const z = -300 + rng() * 545, u = -0.5 + rng() * 68;
    if (Math.abs(u - roadU(z)) < 2.35 || SQUARE(z, u)) continue;
    const x = shoreX(z) - u, h = heightAt(x, z);
    if (h < 1.15) continue;
    const clump = fbm(x * 0.12, z * 0.12, 2);
    if (rng() > 0.35 + clump) continue;
    if (gradientAt(x, z, 0.5) > 0.8 || world.insideAny(x, z, 0.25)) continue;
    if (nf < MAXF && rng() < 0.2) {
      e.set((rng() - 0.5) * 0.5, rng() * 6.28, (rng() - 0.5) * 0.5);
      q.setFromEuler(e);
      p.set(x, h + 0.2 + rng() * 0.16, z);
      s.setScalar(0.7 + rng() * 0.7);
      m.compose(p, q, s);
      petals.setMatrixAt(nf, m); centers.setMatrixAt(nf, m);
      petals.setColorAt(nf, FCOL[Math.floor(rng() * FCOL.length)]);
      nf++;
    } else if (ng < MAXG) {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * 6.28);
      p.set(x, h - 0.02, z);
      const sc = 0.75 + rng() * 0.8;
      s.set(sc, sc * (0.8 + rng() * 0.5), sc);
      grass.setMatrixAt(ng, m.compose(p, q, s));
      col.setRGB(0.8 + rng() * 0.35, 0.85 + rng() * 0.25, 0.7 + rng() * 0.2);
      grass.setColorAt(ng, col);
      ng++;
    }
  }
  grass.count = ng; petals.count = nf; centers.count = nf;
  for (const im of [grass, petals, centers]) { im.receiveShadow = true; scene.add(im); }
  buildReeds(scene, world, rng);
  buildBoulders(scene, world, rng);
  return { grass, petals, centers };
}

// 湖岸蘆葦：村莊以外的淺水岸邊
function buildReeds(scene, world, rng) {
  const geo = bladeGeometry(mulberry32(9), 9, 1.1, 1.9, new THREE.Color('#2f4a22'), new THREE.Color('#a4a65c'), new THREE.Color('#5a3a22'));
  const mesh = new THREE.InstancedMesh(geo, swayMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, 0.12), 1400);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  for (let a = 0; a < 30000 && n < 1400; a++) {
    const z = (rng() < 0.5 ? -1 : 1) * (240 + rng() * 900), u = -6 + rng() * 6.5;
    const x = shoreX(z) - u, h = heightAt(x, z);
    if (h > 0.6 || h < -0.9 || fbm(x * 0.05, z * 0.05, 2) < 0.05) continue;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * 6.28);
    const sc = 0.8 + rng() * 0.6;
    p.set(x, h - 0.05, z);
    s.set(sc, sc * (0.8 + rng() * 0.4), sc);
    mesh.setMatrixAt(n++, m.compose(p, q, s));
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// 巨石與卵石：湖岸、草坡
function buildBoulders(scene, world, rng) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const k = 1 + 0.22 * Math.sin(x * 3.1 + 1.3) * Math.cos(z * 2.7) + 0.12 * Math.sin(y * 5.3 + x * 2.1);
    P.setXYZ(i, x * k, y * k * 0.7, z * k);
  }
  g.computeVertexNormals();
  const T = getTextures();
  const mat = new THREE.MeshStandardMaterial({ map: T.rock.map, normalMap: T.rock.normalMap, color: 0xb8bcb4, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(g, mat, 260);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  let n = 0;
  for (let a = 0; a < 20000 && n < 260; a++) {
    const shore = rng() < 0.6;
    const z = shore ? (rng() < 0.5 ? -1 : 1) * (235 + rng() * 700) : -280 + rng() * 520;
    const u = shore ? -3 + rng() * 5 : 8 + rng() * 60;
    const x = shoreX(z) - u, h = heightAt(x, z);
    if (!shore && (h < 1.3 || world.insideAny(x, z, 2) || Math.abs(u - roadU(z)) < 3.5 || SQUARE(z, u))) continue;
    if (shore && (h > 2 || h < -1.6)) continue;
    const sc = shore ? 0.35 + rng() * 1.3 : 0.3 + rng() * 0.7;
    e.set(rng() * 0.6, rng() * 6.28, rng() * 0.6);
    p.set(x, h + sc * 0.15, z);
    s.set(sc * (0.8 + rng() * 0.5), sc, sc * (0.8 + rng() * 0.5));
    mesh.setMatrixAt(n, m.compose(p, q.setFromEuler(e), s));
    col.setRGB(0.85 + rng() * 0.2, 0.88 + rng() * 0.18, 0.86 + rng() * 0.2);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
}
