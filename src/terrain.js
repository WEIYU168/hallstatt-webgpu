// 地形：哈修塔特位於湖的西岸，背後是陡峭山壁，對岸與南方是 Dachstein 群山。
// 座標：+X = 東（湖）、-X = 西（山）、+Z = 南、-Z = 北，單位為公尺，湖面 y = 0。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTextures } from './textures.js';
import { positionWorld, time, vec2, float, sin, cos, length, pow, abs, mod, smoothstep, uniform, texture, triplanarTexture, vec4 } from 'three/tsl';

// ---------- 小工具 ----------
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const softplus = (x, k) => (x / k > 20 ? x : k * Math.log1p(Math.exp(x / k)));

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
export function fbm(x, z, oct = 5) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f + i * 17.3, z * f - i * 9.1); norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;
}
function ridge(x, z, oct = 5) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { let n = 1 - Math.abs(vnoise(x * f + i * 5.7, z * f + i * 3.3)); s += amp * n * n; norm += amp; amp *= 0.5; f *= 2.1; }
  return s / norm; // 0..1
}

// ---------- 湖岸線 ----------
export function shoreX(z) { return 5 * Math.sin(z * 0.012) + 2.5 * Math.sin(z * 0.041 + 1.3); }
export function shoreSlope(z) { return 0.06 * Math.cos(z * 0.012) + 0.1025 * Math.cos(z * 0.041 + 1.3); }
// 村莊外的湖岸平台被壓縮，山壁直接落入湖中
export function shelf(z) { return 1 + 2.2 * smooth(240, 420, Math.abs(z)); }
function eastShore(z) { return 720 + 90 * Math.sin(z * 0.0025 + 0.6) + 40 * Math.sin(z * 0.007); }
/** 由「沿岸位置 z、離岸距離 u」換算世界座標 x（村莊範圍內） */
export const xAt = (z, u) => shoreX(z) - u;
/** 村莊後方山壁上的瀑布（Mühlbach）位置 */
export const WATERFALL_Z = 95;
/** 沿湖道路中心的離岸距離：北端爬上山腰，形成俯瞰小鎮的經典取景點 */
export const roadU = (z) => (15.8 + 17.2 * smooth(-140, -215, z)) / shelf(z);

// 整平區（以 z 與離岸距離 u 表示）：市集廣場、天主教堂平台、通往平台的坡道
const FLATS = [
  { z0: 4, z1: 34, u0: 18.5, u1: 36, F: 4, h: 6.8 },                       // 市集廣場
  { z0: 40, z1: 84, u0: 34, u1: 62, F: 2, h: 15.5 },                        // 天主教堂平台
  { z0: 28, z1: 41, u0: 31.3, u1: 35.3, F: 1.5, h0: 6.8, h1: 15.5 },        // 坡道
];
function flatMask(z, u, f) {
  const F = f.F;
  return smooth(f.z0 - F, f.z0, z) * (1 - smooth(f.z1, f.z1 + F, z)) *
         smooth(f.u0 - F, f.u0, u) * (1 - smooth(f.u1, f.u1 + F, u));
}

const mountain = (u, peak, k) => peak * (1 - Math.exp(-u * k / peak));
// 湖底剖面（u < 0 為湖中）：岸邊石堤 → 緩坡淺灘（清澈可見湖底）→ 陡降到深湖。water.js 用同一公式算水深
export const lakeProfile = (u) => Math.max(Math.min(Math.max(1 + 0.8 * u, -0.6 + 0.25 * (u + 2)), -4.35 + 0.9 * (u + 17)), -45);

export function heightAt(x, z) {
  // 西岸（村莊與背後山壁）
  const u0 = shoreX(z) - x;
  const u = u0 > 0 ? u0 * shelf(z) : u0;
  let hw;
  if (u < 0) hw = lakeProfile(u);
  else {
    hw = 1 + 0.2 * u + 0.3 * softplus(u - 30, 5);
    const m = softplus(u - 65, 8);
    if (m > 0.01) {
      const peak = 900 + 650 * ridge(x * 0.0016 + 3.1, z * 0.0016 - 1.7);
      hw += mountain(m, peak, 1.25) * (0.8 + 0.4 * fbm(x * 0.006, z * 0.006, 3));
    }
    hw += 0.7 * fbm(x * 0.04, z * 0.04, 3) * smooth(4, 20, u);
    if (Math.abs(z) < 120) {
      for (const f of FLATS) {
        const k = flatMask(z, u0, f);
        if (k > 0) {
          const target = f.h ?? lerp(f.h0, f.h1, clamp((z - f.z0) / (f.z1 - f.z0), 0, 1));
          hw = lerp(hw, target, k);
        }
      }
    }
  }
  // 東岸群山
  const v = x - eastShore(z);
  let he;
  if (v < 0) he = lakeProfile(v);
  else {
    const peak = 1000 + 700 * ridge(x * 0.0014 - 7.3, z * 0.0014 + 2.2);
    he = 1 + mountain(v, peak, 1.1) * (0.8 + 0.4 * fbm(x * 0.005 + 11, z * 0.005, 3));
  }
  // 南端（Dachstein 方向）
  const s = z - 1150 - 60 * Math.sin(x * 0.004);
  let hs;
  if (s < 0) hs = lakeProfile(s);
  else {
    const peak = 1500 + 900 * ridge(x * 0.0011 + 5, z * 0.0011 - 3);
    hs = 1 + mountain(s, peak, 0.9) * (0.85 + 0.3 * fbm(x * 0.004, z * 0.004 + 7, 3));
  }
  return Math.max(hw, he, hs);
}

export function gradientAt(x, z, e = 0.6) {
  const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

// ---------- 地形網格 ----------
// 參考實景：山坡覆滿濃綠的針闊葉混合林，只有最陡的岩壁與高處露出灰色石灰岩
const COL = {
  sand: new THREE.Color('#7d7564'), stone: new THREE.Color('#8a857b'),
  meadow: new THREE.Color('#4f8a3a'), meadow2: new THREE.Color('#86ad55'),
  forest: new THREE.Color('#1d4529'), forest2: new THREE.Color('#2e6035'),
  rock: new THREE.Color('#9b9a92'), rock2: new THREE.Color('#6e6d66'), ledge: new THREE.Color('#3c6431'),
  snow: new THREE.Color('#eef4f6'),
  pebble: new THREE.Color('#b9ad92'), pebble2: new THREE.Color('#9d9480'), lakebed: new THREE.Color('#4a5a44'),
};
const _tmp = new THREE.Color();

function terrainColor(x, z, h, ny, out) {
  // 雜訊也隨高度變化，陡峭山壁上的色塊才不會被拉成直條紋
  const n = fbm(x * 0.02 + h * 0.013, z * 0.02 - h * 0.009, 2) * 0.5 + 0.5;
  const n2 = vnoise(x * 0.15 + h * 0.11, z * 0.15 - h * 0.07) * 0.5 + 0.5;
  const u0 = shoreX(z) - x;
  const inVillage = u0 > -5 && u0 < 72 && Math.abs(z) < 300;
  out.copy(COL.forest).lerp(COL.forest2, n);
  const meadowW = inVillage ? smooth(0.72, 0.9, ny) : smooth(0.93, 0.985, ny) * (1 - smooth(700, 1000, h));
  out.lerp(_tmp.copy(COL.meadow).lerp(COL.meadow2, n2), meadowW);
  const rockW = Math.max(1 - smooth(0.34, 0.54, ny + (n2 - 0.5) * 0.12), smooth(1150, 1400, h + n * 120));
  if (rockW > 0.01) {
    // 石灰岩壁：雨水流下的深色直條紋（與高度無關）＋岩架上的小片綠色植被
    const streak = smooth(0.15, 0.6, vnoise(x * 0.09 + z * 0.06, z * 0.011 - x * 0.007) * 0.5 + 0.5);
    _tmp.copy(COL.rock).lerp(COL.rock2, Math.min(1, n2 * 0.6 + streak * 0.55));
    const veg = smooth(0.58, 0.8, fbm(x * 0.035 + h * 0.03, z * 0.035 - h * 0.025, 2) * 0.5 + 0.5) * (1 - smooth(900, 1150, h));
    _tmp.lerp(COL.ledge, veg * 0.75);
    out.lerp(_tmp, rockW);
  }
  const snowW = smooth(1450, 1650, h + n * 220) * smooth(0.3, 0.55, ny);
  out.lerp(COL.snow, snowW);
  out.lerp(COL.stone, 1 - smooth(0.4, 1.4, h));
  if (h < 0.4) { // 湖底：淺處米色卵石，越深越偏綠灰
    _tmp.copy(COL.pebble).lerp(COL.pebble2, n2).lerp(COL.lakebed, smooth(-0.8, -9, h));
    out.lerp(_tmp, 1 - smooth(0.0, 0.4, h));
  }
  return out;
}

export function buildTerrain(N = 560) {
  const cx = -25, cz = 10;
  const ext = { xn: 2700, xp: 3300, zn: 3300, zp: 3200 };
  // 非均勻網格：村莊附近密、遠處疏
  const map = (s, c, n, p) => c + (s < 0 ? n : p) * (0.04 * s + 0.96 * s * Math.abs(s));
  const row = N + 1, count = row * row;
  const pos = new Float32Array(count * 3);
  for (let j = 0; j <= N; j++) {
    const z = map((j / N) * 2 - 1, cz, ext.zn, ext.zp);
    for (let i = 0; i <= N; i++) {
      const x = map((i / N) * 2 - 1, cx, ext.xn, ext.xp);
      const k = (j * row + i) * 3;
      pos[k] = x; pos[k + 1] = heightAt(x, z); pos[k + 2] = z;
    }
  }
  const index = new Uint32Array(N * N * 6);
  let t = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    index[t++] = a; index[t++] = c; index[t++] = b;
    index[t++] = b; index[t++] = c; index[t++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let v = 0; v < count; v++) {
    terrainColor(pos[v * 3], pos[v * 3 + 2], pos[v * 3 + 1], nrm[v * 3 + 1], c);
    colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uv = new Float32Array(count * 2); // 以公尺為單位，細節貼圖每 3 公尺重複
  for (let v = 0; v < count; v++) { uv[v * 2] = pos[v * 3]; uv[v * 2 + 1] = pos[v * 3 + 2]; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // 細節貼圖用三平面投影：陡峭山壁不再出現被拉長的條紋
  mat.colorNode = vec4(triplanarTexture(texture(getTextures().ground.map), null, null, float(1 / 3), positionWorld).rgb, 1);
  // 淺水湖底的水波光紋（caustics）
  const P = positionWorld;
  const under = float(1).sub(smoothstep(-0.25, 0.15, P.y)).mul(float(1).sub(smoothstep(1.0, 9.0, P.y.negate())));
  mat.emissiveNode = causticNode(P).mul(under).mul(causticColor).mul(causticStrength);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export const causticStrength = uniform(0.5);
export const causticColor = uniform(new THREE.Color(1, 0.98, 0.9));
// 經典的可平鋪水波光紋公式（3 次迭代）
function causticNode(P) {
  const t = time.mul(0.45).add(23);
  const p = mod(P.xz.mul(0.3), 6.28318).sub(250);
  let i = p, c = float(1);
  const inten = 0.005;
  for (let n = 0; n < 3; n++) {
    const tt = t.mul(1 - 3.5 / (n + 1));
    i = p.add(vec2(cos(tt.sub(i.x)).add(sin(tt.add(i.y))), sin(tt.sub(i.y)).add(cos(tt.add(i.x)))));
    c = c.add(float(1).div(length(vec2(p.x.div(sin(i.x.add(tt)).div(inten)), p.y.div(cos(i.y.add(tt)).div(inten))))));
  }
  c = float(1.17).sub(pow(c.div(3), 1.4));
  return pow(abs(c), 8);
}

/** 房屋、樹木、長椅四周的地面變暗（接觸陰影），讓建築「落地」 */
export function bakeContactShadows(mesh, boxes) {
  const pos = mesh.geometry.attributes.position.array, col = mesh.geometry.attributes.color;
  for (let v = 0; v < col.count; v++) {
    const x = pos[v * 3], z = pos[v * 3 + 2];
    if (x < -120 || x > 40 || z < -270 || z > 270) continue;
    let d = Infinity;
    for (const b of boxes) {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx) > b.r + 2.6 || Math.abs(dz) > b.r + 2.6) continue;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      d = Math.min(d, Math.hypot(Math.max(Math.abs(lx) - b.hx, 0), Math.max(Math.abs(lz) - b.hz, 0)));
    }
    if (d < 2.6) {
      const k = 0.5 + 0.5 * smooth(0, 2.6, d);
      col.setXYZ(v, col.getX(v) * k, col.getY(v) * k, col.getZ(v) * k);
    }
  }
  col.needsUpdate = true;
}

// ---------- 針葉林 ----------
const BARK = new THREE.Color('#4a3626');
function colorize(geo, fn) {
  const P = geo.attributes.position, c = new Float32Array(P.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    fn(P.getX(i), P.getY(i), P.getZ(i), tmp);
    c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// 雲杉／冷杉：多層下垂、邊緣不規則的枝層，底部暗、頂端受光（索引幾何，頂點數少）
function spruceGeometry(seed, tiers, seg, width) {
  const rng = mulberry32(seed);
  const parts = [colorize(new THREE.CylinderGeometry(0.02, 0.045, 0.32, 5).translate(0, 0.16, 0), (x, y, z, c) => c.copy(BARK))];
  const dark = new THREE.Color('#10291a'), light = new THREE.Color('#3f7445');
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = lerp(0.42, 0.1, t) * width, h = lerp(0.34, 0.24, t), y0 = lerp(0.12, 0.8, t);
    const cone = new THREE.ConeGeometry(r, h, seg, 1);
    const P = cone.attributes.position, ph = rng() * 6.28;
    for (let k = 0; k < P.count; k++) {
      const py = P.getY(k);
      if (py < -h / 2 + 1e-4) {
        const x = P.getX(k), z = P.getZ(k), a = Math.atan2(z, x);
        const f = 1 + 0.2 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 7 + ph * 2);
        P.setXYZ(k, x * f, py - 0.05 * f, z * f);
      }
    }
    cone.translate(0, y0 + h / 2, 0);
    cone.computeVertexNormals();
    parts.push(colorize(cone, (x, y, z, c) => c.copy(dark).lerp(light, clamp((y - y0) / h, 0, 1) * (0.55 + 0.45 * t))));
  }
  return mergeGeometries(parts);
}

function simpleConifer() {
  const top = new THREE.Color('#356a3c');
  return colorize(mergeGeometries([
    new THREE.ConeGeometry(0.4, 0.62, 6).translate(0, 0.45, 0),
    new THREE.ConeGeometry(0.29, 0.5, 6).translate(0, 0.74, 0),
  ]), (x, y, z, c) => c.set('#15361e').lerp(top, clamp(y, 0, 1)));
}

export function buildForest(rng) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  // 村莊周圍用細緻的兩種雲杉（投射陰影），遠山用簡化版本
  const kinds = [
    { geo: spruceGeometry(11, 6, 8, 0.85), max: 2600, shadow: true },
    { geo: spruceGeometry(23, 5, 9, 1.15), max: 1800, shadow: true },
    { geo: simpleConifer(), max: 7000, shadow: false },
  ];
  const meshes = kinds.map((k) => {
    const im = new THREE.InstancedMesh(k.geo, mat, k.max);
    im.castShadow = k.shadow; im.receiveShadow = true;
    return im;
  });
  const counts = [0, 0, 0];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (let a = 0; a < 90000; a++) {
    const x = -1800 + rng() * 3900, z = -2300 + rng() * 3900;
    const h = heightAt(x, z);
    if (h < 3 || h > 1300) continue;
    const u0 = shoreX(z) - x;
    if (u0 > -5 && u0 < 66 && Math.abs(z) < 250) continue; // 村莊內另外種樹
    if (u0 > -5 && u0 * shelf(z) < 48 && Math.abs(z) < 520) continue; // 道路與湖景視線保持淨空
    if (Math.abs(z - WATERFALL_Z) < 10 && u0 > 55 && u0 < 180) continue; // 瀑布沿線
    const dist = Math.hypot(x + 20, z);
    if (rng() > clamp(1.3 - dist / 2200, 0.12, 1)) continue;
    if (gradientAt(x, z, 2) > 2.4) continue; // 陡坡上也長滿樹（照片中村後山壁一片濃綠）
    const near = x > -700 && x < 450 && z > -900 && z < 700;
    const k = near ? (rng() < 0.6 ? 0 : 1) : 2;
    if (counts[k] >= kinds[k].max) continue;
    const ht = (9 + rng() * 14) * (h > 1000 ? 0.6 : 1);
    p.set(x, h - 0.6, z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    s.set(ht * 0.82, ht, ht * 0.82);
    meshes[k].setMatrixAt(counts[k], m.compose(p, q, s));
    const kindT = rng();
    if (kindT < 0.07) col.setRGB(1.4, 1.28, 0.6);                                        // 轉黃的落葉松
    else if (kindT < 0.28) col.setRGB(1.0 + rng() * 0.2, 1.12 + rng() * 0.15, 0.7 + rng() * 0.1); // 偏黃綠的闊葉樹
    else col.setRGB(0.76 + rng() * 0.3, 0.86 + rng() * 0.26, 0.74 + rng() * 0.26);
    meshes[k].setColorAt(counts[k], col);
    counts[k]++;
  }
  const group = new THREE.Group();
  meshes.forEach((im, i) => { im.count = counts[i]; group.add(im); });
  return group;
}
