// 村莊：彩色木屋、新教教堂、天主教堂、市集廣場、石板路、碼頭、船屋、路燈與樹木。
// 零件依材質（灰泥／木板／石材／屋瓦／裝飾／玻璃／石板路／植物）合併成少數網格，UV 以公尺為單位。
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, shoreX, shoreSlope, roadU, lerp } from './terrain.js';
import { getTextures } from './textures.js';

const FH = 2.7; // 樓層高
const UNIT = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const C = (hex) => new THREE.Color(hex);

// 色彩參考實景照片：白／奶油色灰泥底層、日曬變深的落葉松木造上層、灰色鐵皮與石板屋頂，
// 廣場周邊是飽和的鵝黃、鮭魚橘、薄荷綠、淡藍；陽台與窗台開滿紅色、桃紅色的天竺葵。
const WHITE = C('#f3f0e8'), STONE = C('#aaa398'), STONE_LIGHT = C('#d8d1c2'), DOOR = C('#5a3a24');
const IRON = C('#2b2d30'), GOLD = C('#d9b45a'), LEAF = C('#3d6a2c'), TRIM_WOOD = C('#4a3222');
const WALLS = ['#f3f0e8', '#f1e9d6', '#eee0c0', '#f2c650', '#f0d27e', '#ea9f77', '#f2b49c', '#a8d3c5', '#a3c5db', '#e9e2d4', '#f5f2eb', '#dbe6ca'].map(C);
const WALLS_SQUARE = ['#f2c14e', '#e8956a', '#9fd0c0', '#f4f1ea', '#f0b07a', '#a9c8de', '#efcd68', '#f4f1ea'].map(C);
const RED_WALL = C('#c2463a');
const WOODS = ['#5c3e29', '#4c3322', '#6b4a30', '#3f2c20', '#735237', '#58493f'].map(C);
const ROOFS = ['#6c6f73', '#606367', '#77797c', '#56595d', '#79756f', '#83868a'].map(C);
const FLOWERS = ['#d8243a', '#e83e8c', '#d22c6e', '#ff5fa2', '#ff6a4d', '#c81d3a'].map(C);
const SHUTTERS = ['#3e6b3c', '#2f5a3e', '#6a4428', '#3d5d74', '#a8453a'].map(C);

class Builder {
  constructor() { this.parts = []; }
  // 方盒：UV 依面方向以公尺展開；ao = 底部變暗，under = 底面變暗
  box(F, sx, sy, sz, lx, ly, lz, color, o = {}) {
    const g = UNIT.clone();
    const P = g.attributes.position.array, N = g.attributes.normal.array, n = P.length / 3;
    const col = new Float32Array(n * 3);
    let uv = g.attributes.uv.array;
    if (!o.unitUV) {
      uv = new Float32Array(n * 2);
      const off = o.uvOff ?? 0;
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        let u, v;
        if (Math.abs(N[i * 3]) > 0.5) { u = z * sz; v = y * sy; }
        else if (Math.abs(N[i * 3 + 1]) > 0.5) { u = x * sx; v = z * sz; }
        else { u = x * sx; v = y * sy; }
        uv[i * 2] = u + off; uv[i * 2 + 1] = v + (o.vOff ?? 0);
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    for (let i = 0; i < n; i++) {
      let s = 1;
      if (o.ao && P[i * 3 + 1] < 0) s -= o.ao;
      if (o.under && N[i * 3 + 1] < -0.5) s *= o.under;
      col[i * 3] = color.r * s; col[i * 3 + 1] = color.g * s; col[i * 3 + 2] = color.b * s;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e);
    _m.compose(_p.set(lx, ly, lz), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(F, _m));
    this.parts.push(g);
  }
  // 任意幾何：UV 以主要法線方向投影；unitUV 時正規化到 0..1
  geom(F, src, lx, ly, lz, color, o = {}) {
    const g = src.index !== null ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e);
    const sc = o.sc ?? 1;
    _m.compose(_p.set(lx, ly, lz), _q, typeof sc === 'number' ? _s.set(sc, sc, sc) : _s.copy(sc));
    g.applyMatrix4(_m);
    const P = g.attributes.position.array, N = g.attributes.normal.array, n = P.length / 3;
    const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const ax = Math.abs(N[i * 3]), ay = Math.abs(N[i * 3 + 1]), az = Math.abs(N[i * 3 + 2]);
      if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
      else if (ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
      else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
      const s = o.shade ? o.shade(x - lx, y - ly, z - lz) : 1;
      col[i * 3] = color.r * s; col[i * 3 + 1] = color.g * s; col[i * 3 + 2] = color.b * s;
    }
    if (o.unitUV) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < n; i++) { u0 = Math.min(u0, uv[i * 2]); u1 = Math.max(u1, uv[i * 2]); v0 = Math.min(v0, uv[i * 2 + 1]); v1 = Math.max(v1, uv[i * 2 + 1]); }
      for (let i = 0; i < n; i++) { uv[i * 2] = (uv[i * 2] - u0) / (u1 - u0 || 1); uv[i * 2 + 1] = (uv[i * 2 + 1] - v0) / (v1 - v0 || 1); }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.applyMatrix4(F);
    this.parts.push(g);
  }
  // 已帶 uv 的世界座標幾何
  raw(src, color) {
    const g = src.index !== null ? src.toNonIndexed() : src;
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }
  build(material, cast = true) {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    this.parts = [];
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    return mesh;
  }
}

const frame = (x, z, rot, y = 0) => new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
const sub = (F, lx, ly, lz, ry) => new THREE.Matrix4().multiplyMatrices(F, new THREE.Matrix4().makeRotationY(ry).setPosition(lx, ly, lz));
const toWorld = (x, z, rot, lx, lz) => [x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot)];
const shoreRot = (z) => Math.atan(shoreSlope(z));
const CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function footprintMin(x, z, rot, hx, hz) {
  let m = heightAt(x, z);
  for (const [a, b] of CORNERS) { const [wx, wz] = toWorld(x, z, rot, a * hx, b * hz); m = Math.min(m, heightAt(wx, wz)); }
  return m;
}

// ---------- 共用幾何 ----------
function gableGeom(w, rh, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, rh); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(d / 2, 0, 0);
  return g;
}
// 哥德式尖拱窗（XY 平面，沿 Z 擠出）
const archCache = new Map();
function pointedArch(w, h, depth = 0.08) {
  const key = `${w}_${h}_${depth}`;
  if (archCache.has(key)) return archCache.get(key);
  const hs = h - w * 0.75, s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, hs);
  s.quadraticCurveTo(w * 0.47, hs + w * 0.55, 0, hs + w * 0.75);
  s.quadraticCurveTo(-w * 0.47, hs + w * 0.55, -w / 2, hs);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  archCache.set(key, g);
  return g;
}
const BLOOM = new THREE.IcosahedronGeometry(0.11, 0);
// 不規則樹冠（頂點擾動的二十面體）
const BLOBS = [0, 1, 2, 3].map((seed) => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.16 * Math.sin(x * 4.1 + seed * 2.3) * Math.cos(z * 3.7 - seed) + 0.1 * Math.sin(y * 5.3 + seed * 1.7);
    p.setXYZ(i, x * k, y * k * 0.92, z * k);
  }
  g.computeVertexNormals();
  return g;
});

// ---------- 屋頂 ----------
function roofOn(B, F, ww, dd, top, pitch, roofColor, gableB, gableColor, o = {}) {
  const oh = o.oh ?? 0.75, eave = o.eave ?? 0.7, t = 0.2, trim = o.trim ?? TRIM_WOOD;
  const rh = (ww / 2) * Math.tan(pitch);
  gableB.geom(F, gableGeom(ww, rh, dd), 0, top, 0, gableColor);
  const hw = ww / 2 + eave, L = hw / Math.cos(pitch), yTop = top + rh + 0.04;
  const ca = Math.cos(pitch), sa = Math.sin(pitch), ta = Math.tan(pitch);
  const RB = o.metal ? B.metal : B.roof; // 立邊鐵皮或石板瓦
  for (const s of [1, -1]) {
    const cz = s * (hw / 2 + (t / 2) * sa), cy = yTop - (hw / 2) * ta + (t / 2) * ca;
    const rot = { rx: s > 0 ? pitch : -pitch, ry: s > 0 ? 0 : Math.PI };
    RB.box(F, dd + 2 * oh, t, L, 0, cy, cz, roofColor, { ...rot, under: 0.5, uvOff: o.uvOff });
    if (o.detail === false) continue;
    for (const e of [1, -1]) B.wood.box(F, 0.06, 0.3, L + 0.05, e * (dd / 2 + oh + 0.02), cy - 0.06, cz, trim, rot); // 山牆封簷板
    const ye = yTop - hw * ta;
    B.wood.box(F, dd + 2 * oh, 0.26, 0.06, 0, ye - 0.06, s * (hw + 0.02), trim); // 簷口封板
    const n = Math.max(2, Math.floor((dd + 2 * oh) / 0.85));
    const zc = ww / 2 + eave / 2 - 0.05, yl = yTop - zc * ta;
    for (let i = 0; i <= n; i++) { // 外露椽頭
      const lx = -dd / 2 - oh + 0.15 + (i * (dd + 2 * oh - 0.3)) / n;
      B.wood.box(F, 0.11, 0.14, eave + 0.35, lx, yl - 0.08 * ca, s * (zc - 0.08 * sa), trim, rot);
    }
  }
  RB.box(F, dd + 2 * oh + 0.1, 0.18, 0.42, 0, yTop + 0.14, 0, roofColor.clone().multiplyScalar(0.7));
  return { rh, yTop };
}

// ---------- 窗、門、花箱 ----------
// 花箱的木箱合併進木材網格；天竺葵與垂吊花草用 instancing（見 buildPlanters）
let PLANTERS = [];
let CHIMNEYS = [];
const UP = new THREE.Vector3(0, 1, 0);
function addFlowerBox(B, F, px, py, pz, nx, nz, len, flower, rng) {
  const alongX = nz !== 0;
  const [a, b, c] = alongX ? [len, 0.2, 0.24] : [0.24, 0.2, len];
  const bx = px + nx * 0.16, bz = pz + nz * 0.16;
  B.wood.box(F, a, b, c, bx, py, bz, C('#6b4429'));
  const ry = nx > 0 ? Math.PI / 2 : nx < 0 ? -Math.PI / 2 : nz > 0 ? 0 : Math.PI;
  const local = new THREE.Matrix4().compose(new THREE.Vector3(bx, py + 0.1, bz), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(len, 1, 1));
  PLANTERS.push({ m: new THREE.Matrix4().multiplyMatrices(F, local), color: flower, variant: Math.floor(rng() * 3) });
}

// 一個 1 公尺長花箱上的植物：葉叢 + 垂吊枝條（葉）與天竺葵花團（花，白色頂點由 instance 著色）
function planterFoliage(seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const leaves = [], blooms = [];
  const LEAVES = ['#2c5a22', '#3b7a2c', '#4b8c35', '#5f9a3c'].map(C);
  const ico = new THREE.IcosahedronGeometry(1, 0), oct = new THREE.OctahedronGeometry(1, 0);
  const part = (arr, src, x, y, z, sx, sy, sz, color, jit) => {
    const g = src.clone();
    g.deleteAttribute('uv');
    const P = g.attributes.position, N = new Float32Array(P.count * 3), c = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const vx = P.getX(i), vy = P.getY(i), vz = P.getZ(i), l = Math.hypot(vx, vy, vz) || 1;
      N[i * 3] = vx / l; N[i * 3 + 1] = vy / l; N[i * 3 + 2] = vz / l; // 圓滑法線
      const k = 1 - jit * ((Math.sin(vx * 12.9 + vy * 78.2 + vz * 37.7 + x * 9) * 43758.5) % 1 + 1) % 1;
      c[i * 3] = color.r * k; c[i * 3 + 1] = color.g * k; c[i * 3 + 2] = color.b * k;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.scale(sx, sy, sz); g.translate(x, y, z);
    arr.push(g);
  };
  // 茂密葉叢：大小不一、互相重疊
  for (let i = 0; i < 11; i++) {
    const sx = 0.08 + rnd() * 0.07;
    part(leaves, ico, -0.46 + rnd() * 0.92, 0.04 + rnd() * 0.05, (rnd() - 0.5) * 0.1, sx, sx * (0.6 + rnd() * 0.3), sx * 0.9, LEAVES[i % 4], 0.3);
  }
  // 垂吊的矮牽牛／常春藤：左右交錯的葉片
  const strands = [];
  for (let k = 0; k < 6; k++) {
    const x0 = -0.42 + k * 0.17 + (rnd() - 0.5) * 0.06, len = 3 + Math.floor(rnd() * 4), pts = [];
    for (let j = 0; j < len; j++) {
      const side = j % 2 ? 0.028 : -0.028;
      const p = [x0 + side + Math.sin(j * 1.1 + k) * 0.02, 0.02 - j * 0.07, 0.14 + j * 0.014];
      pts.push(p);
      const s = 0.058 - j * 0.004;
      part(leaves, ico, p[0], p[1], p[2], s, s * 0.75, s * 0.8, LEAVES[(k + j) % 4], 0.3);
    }
    strands.push(pts);
  }
  // 天竺葵：花梗上方圓球狀的花團
  const WHITE_C = new THREE.Color(1, 1, 1);
  for (let i = 0; i < 8; i++) {
    const cx = -0.42 + i * 0.12 + (rnd() - 0.5) * 0.05, cy = 0.17 + rnd() * 0.08, cz = (rnd() - 0.5) * 0.09;
    part(leaves, ico, cx, cy - 0.06, cz, 0.012, 0.06, 0.012, LEAVES[1], 0.1); // 花梗
    for (let k = 0; k < 8; k++) {
      const a = rnd() * Math.PI * 2, b = rnd() * Math.PI * 0.55, r = 0.04 + rnd() * 0.015;
      part(blooms, oct, cx + Math.cos(a) * Math.sin(b) * r, cy + Math.cos(b) * r * 0.8, cz + Math.sin(a) * Math.sin(b) * r, 0.027, 0.022, 0.027, WHITE_C, 0.25);
    }
  }
  for (const pts of strands) for (let j = 1; j < pts.length; j++) {
    if (rnd() < 0.5) { const p = pts[j]; part(blooms, oct, p[0] + 0.02, p[1] - 0.01, p[2] + 0.03, 0.03, 0.03, 0.03, WHITE_C, 0.2); }
  }
  return { leaves: mergeVertices(mergeGeometries(leaves)), blooms: mergeVertices(mergeGeometries(blooms)) };
}

function buildPlanters(scene, rng) {
  const variants = [11, 23, 37].map(planterFoliage);
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const bloomMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const tint = new THREE.Color();
  variants.forEach((geo, v) => {
    const list = PLANTERS.filter((p) => p.variant === v);
    if (!list.length) return;
    const L = new THREE.InstancedMesh(geo.leaves, leafMat, list.length);
    const Bm = new THREE.InstancedMesh(geo.blooms, bloomMat, list.length);
    list.forEach((p, i) => {
      L.setMatrixAt(i, p.m); Bm.setMatrixAt(i, p.m);
      tint.setRGB(0.8 + rng() * 0.35, 0.85 + rng() * 0.3, 0.8 + rng() * 0.3);
      L.setColorAt(i, tint);
      Bm.setColorAt(i, p.color);
    });
    for (const im of [L, Bm]) { im.receiveShadow = true; scene.add(im); }
  });
  return PLANTERS.length;
}

function addWindow(B, F, px, py, pz, nx, nz, o, rng, flowers, tall = 1, wdt = 1) {
  const alongX = nz !== 0;
  const dims = (th, h, w) => (alongX ? [w, h, th] : [th, h, w]);
  const at = (d) => [px + nx * d, pz + nz * d];
  let [a, b, c] = dims(0.05, 1.5 * tall, 1.14 * wdt);
  let [x, z] = at(0.02);
  B.trim.box(F, a, b, c, x, py, z, o.frame || WHITE);                 // 窗框飾帶
  [a, b, c] = dims(0.06, 1.14 * tall, 0.8 * wdt); [x, z] = at(0.045);
  (rng() < 0.55 ? B.glassLit : B.glass).box(F, a, b, c, x, py, z, WHITE, { unitUV: true }); // 十字窗玻璃
  [a, b, c] = dims(0.2, 0.07, 1.2 * wdt); [x, z] = at(0.09);
  B.stone.box(F, a, b, c, x, py - 0.6 * tall - 0.03, z, STONE_LIGHT);  // 窗台
  if (o.shutters) {
    [a, b, c] = dims(0.05, 1.3 * tall, 0.44 * wdt);
    const tx = alongX ? 0.74 * wdt : 0, tz = alongX ? 0 : 0.74 * wdt;
    [x, z] = at(0.05);
    for (const s of [1, -1]) B.wood.box(F, a, b, c, x + s * tx, py, z + s * tz, o.shutterColor, { uvOff: s });
  }
  if (flowers) addFlowerBox(B, F, px, py - 0.75 * tall, pz, nx, nz, 1.0 * wdt, o.flower, rng);
}

function addDoor(B, F, fx, y0, wz, nx) {
  B.stone.box(F, 0.1, 2.55, 1.5, fx + nx * 0.03, y0 + 1.2, wz, STONE_LIGHT);
  B.wood.box(F, 0.12, 2.1, 1.08, fx + nx * 0.07, y0 + 1.05, wz, DOOR);
  B.glass.box(F, 0.06, 0.32, 0.9, fx + nx * 0.07, y0 + 2.32, wz, WHITE, { unitUV: true });
  B.stone.box(F, 0.55, 0.2, 1.6, fx + nx * 0.28, y0 + 0.02, wz, STONE);
  B.trim.box(F, 0.08, 0.08, 0.08, fx + nx * 0.14, y0 + 1.05, wz + 0.4, GOLD); // 門把
}

function addBalconyRail(B, F, cx, y, len, wood, flower, rng, flowers) {
  B.wood.box(F, 0.12, 0.08, len, cx, y + 1.0, 0, wood);
  B.wood.box(F, 0.1, 0.07, len, cx, y + 0.18, 0, wood);
  const n = Math.max(3, Math.floor(len / 0.17));
  for (let i = 0; i <= n; i++) B.wood.box(F, 0.04, 0.8, 0.1, cx, y + 0.6, -len / 2 + (i * len) / n, wood);
  if (flowers) {
    const m = Math.max(1, Math.floor(len / 1.3));
    for (let i = 0; i < m; i++) {
      const z = -len / 2 + ((i + 0.5) * len) / m;
      addFlowerBox(B, sub(F, cx, 0, z, 0), -0.16, y + 1.14, 0, 1, 0, 0.9, flower, rng);
    }
  }
}

// ---------- 房屋 ----------
function addHouse(B, world, rng, o) {
  const { x, z, rot, w, d, floors } = o;
  const F = frame(x, z, rot);
  const base = heightAt(x, z);
  const minH = footprintMin(x, z, rot, d / 2, w / 2);
  const y0 = o.y0 ?? Math.max(base, 1.25);
  const yb = o.yb ?? (minH < 0.4 ? -2.6 : minH - 0.6);
  const H = floors * FH;
  const woodTop = o.woodTop && !o.fullWood;
  const plasterTop = y0 + (woodTop ? (floors - 1) * FH : H);
  const uvOff = rng() * 20;
  const wallB = o.fullWood ? B.wood : B.plaster;
  wallB.box(F, d, plasterTop - yb, w, 0, (plasterTop + yb) / 2, 0, o.fullWood ? o.wood : o.wall, { ao: 0.2, uvOff });
  B.stone.box(F, d + 0.14, y0 + 0.55 - yb, w + 0.14, 0, (y0 + 0.55 + yb) / 2, 0, STONE, { uvOff, ao: 0.15 });
  if (!o.fullWood) {
    const qTop = plasterTop, qBot = y0 + 0.55;
    for (const [a, b] of CORNERS) B.trim.box(F, 0.44, qTop - qBot, 0.44, a * (d / 2 - 0.2), (qTop + qBot) / 2, b * (w / 2 - 0.2), o.quoin, { ao: 0.12 });
    if (o.bands) {
      const pf = woodTop ? floors - 1 : floors;
      for (let f = 1; f < pf; f++) B.trim.box(F, d + 0.07, 0.14, w + 0.07, 0, y0 + f * FH, 0, o.quoin);
    }
  } else {
    for (const [a, b] of CORNERS) B.wood.box(F, 0.18, H + 0.2, 0.18, a * (d / 2 + 0.02), y0 + H / 2, b * (w / 2 + 0.02), o.wood.clone().multiplyScalar(0.7));
  }
  const ext = woodTop ? 0.3 : 0;
  if (woodTop) {
    B.wood.box(F, d + ext, FH, w + ext, 0, plasterTop + FH / 2, 0, o.wood, { uvOff, ao: 0.08 });
    B.wood.box(F, d + ext + 0.14, 0.24, w + ext + 0.14, 0, plasterTop + 0.04, 0, o.wood.clone().multiplyScalar(0.65));
  }
  const ww = w + ext, dd = d + ext, top = y0 + H;
  const gableB = o.gable === o.wall ? B.plaster : B.wood;
  const { rh, yTop } = roofOn(B, F, ww, dd, top, o.pitch, o.roof, gableB, o.gable, { uvOff, trim: o.wood.clone().multiplyScalar(0.6), detail: !o.boathouse, metal: o.metalRoof });

  // 煙囪
  const chz = ww * 0.22 * (rng() < 0.5 ? 1 : -1), chx = -dd * 0.18;
  const chY = yTop - Math.abs(chz) * Math.tan(o.pitch);
  B.plaster.box(F, 0.62, 1.8, 0.62, chx, chY + 0.5, chz, WHITE, { ao: 0.2 });
  B.trim.box(F, 0.8, 0.1, 0.8, chx, chY + 1.42, chz, C('#55504a'));
  B.trim.box(F, 0.5, 0.25, 0.5, chx, chY + 1.6, chz, C('#55504a'));
  if (!o.boathouse) { const [cxw, czw] = toWorld(x, z, rot, chx, chz); CHIMNEYS.push(new THREE.Vector3(cxw, chY + 1.75, czw)); }

  // 側牆的柴堆（奧地利山區常見），上方加一塊擋雨板
  if (!o.boathouse && rng() < 0.3) {
    const s = rng() < 0.5 ? 1 : -1, lx = (rng() - 0.5) * d * 0.35, lz = s * (w / 2 + 0.36);
    const [fx, fz] = toWorld(x, z, rot, lx, lz);
    const gh = heightAt(fx, fz);
    B.logs.box(F, 2.4, 1.5, 0.62, lx, gh + 0.72, lz, C('#ffffff'), { uvOff: rng() * 3 });
    B.wood.box(F, 2.7, 0.06, 0.85, lx, gh + 1.52, lz + s * 0.06, o.wood.clone().multiplyScalar(0.7));
    world.addBox(fx, fz, 1.25, 0.36, rot);
  }
  // 鍛鐵吊牌（廣場一帶的旅館、商店）
  if (o.sign && !o.boathouse && floors >= 3) {
    const sz = w * 0.3, sy = y0 + 3.45;
    B.trim.box(F, 1.0, 0.05, 0.05, d / 2 + 0.5, sy, sz, IRON);
    B.trim.geom(F, new THREE.TorusGeometry(0.16, 0.02, 4, 12, Math.PI), d / 2 + 0.35, sy - 0.02, sz, IRON, { rx: Math.PI });
    for (const k of [0.2, 0.8]) B.trim.box(F, 0.02, 0.2, 0.02, d / 2 + 0.25 + k * 0.7, sy - 0.12, sz, IRON);
    B.wood.box(F, 0.8, 0.55, 0.05, d / 2 + 0.6, sy - 0.5, sz, C('#7a4c2e'));
    B.trim.box(F, 0.84, 0.59, 0.03, d / 2 + 0.6, sy - 0.5, sz, GOLD);
  }

  // 老虎窗
  if (o.dormer && ww > 7.8 && !o.boathouse) {
    const s = rng() < 0.5 ? 1 : -1, zf = ww / 2 - 0.6, zc = zf - 1.2, yf = yTop - zf * Math.tan(o.pitch);
    const DF = sub(F, (rng() - 0.5) * dd * 0.3, 0, s * zc, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    gableB.box(DF, 2.4, 2.0, 1.5, 0, yf + 0.7, 0, o.gable, { uvOff });
    roofOn(B, DF, 1.5, 2.4, yf + 1.7, Math.PI / 4, o.roof, gableB, o.gable, { oh: 0.2, eave: 0.25, detail: false, metal: o.metalRoof });
    addWindow(B, DF, 1.2, yf + 0.85, 0, 1, 0, o, rng, false, 0.75, 0.75);
  }

  if (o.boathouse) {
    B.trim.box(F, 0.1, 2.3, w * 0.72, d / 2 + 0.04, y0 + 0.9, 0, C('#15181b'));
    B.wood.box(F, 0.14, 0.3, w * 0.8, d / 2 + 0.06, y0 + 2.15, 0, o.wood.clone().multiplyScalar(0.7));
  } else {
    const n = Math.max(2, Math.floor(w / 2.4));
    const ns = Math.max(1, Math.floor(d / 3.2));
    for (let f = 0; f < floors; f++) {
      const isTop = woodTop && f === floors - 1;
      const fx = d / 2 + (isTop ? ext / 2 : 0), sz = w / 2 + (isTop ? ext / 2 : 0);
      const wy = y0 + f * FH + 1.5;
      for (let i = 0; i < n; i++) {
        const wz = -w / 2 + ((i + 0.5) * w) / n;
        const door = f === 0 && i === (n >> 1);
        if (door && !o.lakeside) { addDoor(B, F, fx, y0, wz, 1); continue; }
        addWindow(B, F, fx, wy, wz, 1, 0, o, rng, o.flowers && f >= 1 && !(isTop && o.balcony));
        if (o.lakeside) {
          if (door) addDoor(B, F, -fx, y0, wz, -1);
          else addWindow(B, F, -fx, wy, wz, -1, 0, o, rng, o.flowers && f >= 1);
        }
      }
      for (const s of [1, -1]) for (let i = 0; i < ns; i++) {
        addWindow(B, F, -d / 2 + ((i + 0.5) * d) / ns, wy, s * sz, 0, s, o, rng, false);
      }
    }
    // 山牆：小陽台（Söller）或小窗
    if (o.gableBalcony && rh > 2.6) {
      B.wood.box(F, 0.8, 0.12, ww * 0.5, dd / 2 + 0.4, top + 0.08, 0, o.wood);
      addBalconyRail(B, sub(F, 0, 0, 0, 0), dd / 2 + 0.78, top + 0.08, ww * 0.5, o.wood, o.flower, rng, o.flowers);
      B.trim.box(F, 0.12, 2.0, 0.95, dd / 2 + 0.03, top + 1.05, 0, DOOR);
    } else {
      addWindow(B, F, dd / 2, top + rh * 0.32 + 0.3, 0, 1, 0, o, rng, false, 0.9, 0.9);
    }
    if (o.awning) { // 臨街那一面（湖畔第一排的街道在 -X 側）
      const sx = o.lakeside ? -1 : 1;
      addAwning(B, F, sx * (d / 2), y0 + 2.45, 0, w * 0.82, sx);
    }
    if (woodTop && o.balcony) { // 木造陽台：欄杆、斜撐、花箱
      const bl = ww * 0.84, bx = dd / 2 + 0.47;
      B.wood.box(F, 0.95, 0.12, bl, bx, plasterTop + 0.06, 0, o.wood);
      for (const t of [-0.42, 0, 0.42]) B.wood.box(F, 0.85, 0.11, 0.11, dd / 2 + 0.38, plasterTop - 0.3, t * bl, o.wood, { rz: 0.62 });
      addBalconyRail(B, F, dd / 2 + 0.9, plasterTop + 0.06, bl, o.wood, o.flower, rng, o.flowers);
    }
  }
  world.addBox(x, z, dd / 2 + 0.2, ww / 2 + 0.2, rot);
  return { top: yTop };
}

function houseStyle(rng, base) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const zc = base.z ?? 999, nearSquare = zc > -45 && zc < 85;
  const fullWood = rng() < 0.2;
  const woodTop = !fullWood && rng() < 0.55;
  const wood = pick(WOODS);
  const wall = nearSquare && rng() < 0.7 ? pick(WALLS_SQUARE) : rng() < 0.05 ? RED_WALL : pick(WALLS);
  const quoin = rng() < 0.5 ? WHITE : wall.clone().multiplyScalar(0.84);
  return {
    ...base, fullWood, woodTop, wood, wall, quoin,
    roof: pick(ROOFS), metalRoof: rng() < 0.6,
    gable: fullWood || woodTop || rng() < 0.3 ? wood : wall,
    pitch: THREE.MathUtils.degToRad(40 + rng() * 10),
    shutters: rng() < 0.55, shutterColor: pick(SHUTTERS),
    flowers: rng() < 0.78, flower: pick(FLOWERS),
    balcony: rng() < 0.75, bands: rng() < 0.5, dormer: rng() < 0.35, gableBalcony: rng() < 0.3,
    sign: Math.abs(zc) < 90 && rng() < 0.3,
    awning: (base.floors ?? 0) >= 2 && rng() < (nearSquare ? 0.45 : 0.07),
    frame: fullWood && rng() < 0.5 ? C('#e9e1cf') : WHITE,
  };
}

// 一樓的條紋遮陽棚（餐廳、咖啡館）：斜面＋前緣垂邊＋鐵支架
function addAwning(B, F, fx, y, z, len, nx) {
  B.awning.box(F, 1.3, 0.035, len, fx + nx * 0.6, y - 0.2, z, WHITE, { rz: -0.32 * nx });
  B.awningV.box(F, 0.03, 0.26, len + 0.02, fx + nx * 1.22, y - 0.53, z, WHITE);
  for (const s of [-0.48, 0.48]) B.trim.box(F, 1.25, 0.03, 0.03, fx + nx * 0.6, y - 0.24, z + s * len, IRON, { rz: -0.32 * nx });
}

// 建築物不能放的區域（z 範圍、離岸 u 範圍）
const RESERVED = [
  { z0: -64, z1: -28, u0: -5, u1: 14 },
  { z0: 0, z1: 44, u0: 17, u1: 50 },
  { z0: 36, z1: 88, u0: 29.5, u1: 68 },
  { z0: 12, z1: 26, u0: -5, u1: 13 },
  { z0: -105, z1: -95, u0: -5, u1: 13 },
  { z0: 130, z1: 140, u0: -5, u1: 13 },
];
const reserved = (zc, w, ua, ub) => RESERVED.some((r) => zc - w / 2 < r.z1 && zc + w / 2 > r.z0 && ua < r.u1 && ub > r.u0);

const ROWS = [
  { u0: -0.3, jitter: 2.4, uMax: 13, z0: -182, z1: 235, floors: [3, 4], lakeside: true },
  { u0: 18.5, jitter: 1.4, uMax: 31, z0: -138, z1: 232, floors: [2, 4] },
  { u0: 34.5, jitter: 1.4, uMax: 47, z0: -132, z1: 215, floors: [2, 3] },
  { u0: 50.5, jitter: 1.2, uMax: 62, z0: -120, z1: 190, floors: [2, 3], skip: 0.3 },
];

function placeRows(B, world, rng) {
  let count = 0;
  for (const row of ROWS) {
    let z = row.z0;
    while (z < row.z1) {
      const w = 7.2 + rng() * 4.2;
      const front = row.u0 + rng() * row.jitter;
      const d = Math.min(8 + rng() * 4, row.uMax - front);
      const zc = z + w / 2;
      if (d < 6.5 || reserved(zc, w, front, front + d) || (row.skip && rng() < row.skip)) { z += 5 + rng() * 4; continue; }
      const u = front + d / 2;
      const floors = row.floors[0] + Math.floor(rng() * (row.floors[1] - row.floors[0] + 1));
      addHouse(B, world, rng, houseStyle(rng, {
        x: shoreX(zc) - u, z: zc, rot: shoreRot(zc) + (rng() - 0.5) * 0.1, w, d, floors, lakeside: !!row.lakeside,
      }));
      count++;
      z += w + 1.3 + rng() * 2.5;
      if (rng() < 0.15) z += 3.5;
    }
  }
  return count;
}

// ---------- 教堂 ----------
function addTower(B, F, lx, lz, s, yb, y0, H, sp) {
  (sp.stone ? B.stone : B.plaster).box(F, s, y0 + H - yb, s, lx, (y0 + H + yb) / 2, lz, sp.wall, { ao: 0.18 });
  for (const [a, b] of CORNERS) B.trim.box(F, 0.55, H, 0.55, lx + a * (s / 2 - 0.24), y0 + H / 2, lz + b * (s / 2 - 0.24), STONE_LIGHT);
  B.stone.box(F, s + 0.4, 0.5, s + 0.4, lx, y0 + H - 0.22, lz, STONE_LIGHT);
  B.stone.box(F, s + 0.3, y0 + 1.2 - yb, s + 0.3, lx, (y0 + 1.2 + yb) / 2, lz, STONE);
  B.stone.box(F, s + 0.15, 0.25, s + 0.15, lx, y0 + H * 0.55, lz, STONE_LIGHT);
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ry = nx !== 0 ? Math.PI / 2 : 0;
    const off = s / 2 + 0.02;
    // 尖拱鐘樓開口（黑）＋石框
    B.stone.geom(F, pointedArch(1.5, 3.0, 0.08), lx + nx * off, y0 + H - 3.8, lz + nz * off, STONE_LIGHT, { ry });
    B.trim.geom(F, pointedArch(1.1, 2.6, 0.1), lx + nx * (off + 0.02), y0 + H - 3.6, lz + nz * (off + 0.02), C('#121417'), { ry });
    // 鐘面
    const clock = new THREE.CylinderGeometry(0.9, 0.9, 0.1, 28);
    clock.rotateZ(Math.PI / 2); if (nz !== 0) clock.rotateY(Math.PI / 2);
    B.trim.geom(F, clock, lx + nx * (off + 0.04), y0 + H - 5.6, lz + nz * (off + 0.04), C('#262a2e'));
    const ring = new THREE.TorusGeometry(0.82, 0.07, 6, 28); if (nx !== 0) ring.rotateY(Math.PI / 2);
    B.trim.geom(F, ring, lx + nx * (off + 0.1), y0 + H - 5.6, lz + nz * (off + 0.1), GOLD);
    for (const [hx, hy] of [[0, 0.5], [0.35, 0]]) {
      const hand = nx !== 0 ? [0.04, 0.06 + hy, 0.06 + hx] : [0.06 + hx, 0.06 + hy, 0.04];
      B.trim.box(F, ...hand, lx + nx * (off + 0.12) + (nx === 0 ? hx / 2 : 0), y0 + H - 5.6 + hy / 2, lz + nz * (off + 0.12) + (nz === 0 ? hx / 2 : 0), GOLD);
    }
  }
  let y = y0 + H;
  if (sp.skirt) {
    const sk = new THREE.ConeGeometry(s * 0.707 * 1.14, sp.skirt, 4, 1); sk.rotateY(Math.PI / 4);
    B.roof.geom(F, sk, lx, y + sp.skirt / 2, lz, sp.color);
    y += sp.skirt * 0.55;
    // 尖塔基座四面小山牆
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ry = nx !== 0 ? 0 : Math.PI / 2;
      B.roof.geom(F, gableGeom(1.4, 1.3, 0.6), lx + nx * s * 0.28, y - 0.2, lz + nz * s * 0.28, sp.color, { ry });
    }
  }
  const cone = new THREE.ConeGeometry(s * 0.707 * sp.r, sp.h, 4, 1); cone.rotateY(Math.PI / 4);
  B.roof.geom(F, cone, lx, y + sp.h / 2, lz, sp.color);
  B.trim.geom(F, new THREE.SphereGeometry(0.3, 12, 8), lx, y + sp.h + 0.1, lz, GOLD);
  B.trim.box(F, 0.09, 1.5, 0.09, lx, y + sp.h + 0.95, lz, GOLD);
  B.trim.box(F, 0.09, 0.09, 0.75, lx, y + sp.h + 1.2, lz, GOLD);
}

function addHall(B, world, o) {
  const { x, z, rot, w, d, H } = o;
  const F = frame(x, z, rot);
  const minH = footprintMin(x, z, rot, d / 2, w / 2);
  const y0 = o.y0 ?? heightAt(x, z);
  const yb = Math.min(minH, y0) - 0.8;
  const WB = o.stone ? B.stone : B.plaster; // 新教教堂是石砌牆面
  WB.box(F, d, y0 + H - yb, w, 0, (y0 + H + yb) / 2, 0, o.wall, { ao: 0.18 });
  B.stone.box(F, d + 0.25, y0 + 0.8 - yb, w + 0.25, 0, (y0 + 0.8 + yb) / 2, 0, STONE);
  B.trim.box(F, d + 0.12, 0.3, w + 0.12, 0, y0 + H - 0.15, 0, STONE_LIGHT);
  roofOn(B, F, w, d, y0 + H, o.pitch, o.roof, WB, o.wall, { oh: 0.5, eave: 0.6, detail: false });
  const n = Math.max(2, Math.floor(d / 4));
  for (const s of [1, -1]) for (let i = 0; i < n; i++) {
    const lx = -d / 2 + ((i + 0.5) * d) / n;
    const wy = y0 + H * 0.22;
    B.stone.geom(F, pointedArch(1.55, H * 0.62, 0.08), lx, wy - 0.15, s * (w / 2 + 0.02), STONE_LIGHT);
    B.glass.geom(F, pointedArch(1.15, H * 0.58, 0.1), lx, wy, s * (w / 2 + 0.03), WHITE, { unitUV: true });
    if (o.buttress && i < n) { // 扶壁
      const bx = -d / 2 + (i * d) / n;
      if (i > 0) {
        B.stone.box(F, 0.7, H * 0.75, 0.9, bx, y0 + H * 0.375, s * (w / 2 + 0.45), STONE_LIGHT, { ao: 0.15 });
        B.stone.box(F, 0.7, 0.9, 0.6, bx, y0 + H * 0.78, s * (w / 2 + 0.3), STONE_LIGHT, { rx: s * 0.6 });
      }
    }
  }
  // 正面玫瑰窗（+X 端）
  if (o.rose) {
    const rose = new THREE.CylinderGeometry(1.0, 1.0, 0.1, 20); rose.rotateZ(Math.PI / 2);
    B.stone.geom(F, new THREE.TorusGeometry(1.05, 0.12, 6, 24).rotateY(Math.PI / 2), d / 2 + 0.05, y0 + H * 0.7, 0, STONE_LIGHT);
    B.glass.geom(F, rose, d / 2 + 0.04, y0 + H * 0.7, 0, WHITE, { unitUV: true });
    addDoor(B, F, d / 2, y0, 0, 1);
  }
  world.addBox(x, z, d / 2 + 0.25, w / 2 + 0.25, rot);
  return { F, y0, yb };
}

function addProtestantChurch(B, world) {
  const zc = -44, u = 8.5;
  const rot = shoreRot(zc) + Math.PI / 2;
  const x = shoreX(zc) - u;
  const { F } = addHall(B, world, { x, z: zc, rot, w: 10, d: 20, H: 9, wall: C('#d9d2c3'), stone: true, roof: C('#4c4f53'), pitch: THREE.MathUtils.degToRad(48), rose: true });
  const [tx, tz] = toWorld(x, zc, rot, 12.5, 2.5);
  const ty0 = Math.max(heightAt(tx, tz), 1.3);
  // 石砌鐘樓上的深色石板細長尖塔（照片中湖畔最醒目的地標）
  addTower(B, F, 12.5, 2.5, 5, ty0 - 2.5, ty0, 22, { wall: C('#ddd6c8'), stone: true, color: C('#3a3e43'), r: 0.52, h: 29, skirt: 2.2 });
  world.addBox(tx, tz, 2.8, 2.8, rot);
}

function addCatholicChurch(B, world) {
  const zc = 61, u = 47.5, y0 = 15.5;
  const rot = shoreRot(zc);
  const x = shoreX(zc) - u;
  const { F } = addHall(B, world, { x, z: zc, rot, w: 11, d: 20, H: 11, y0, wall: C('#eeebe4'), roof: C('#4a4c50'), pitch: THREE.MathUtils.degToRad(56), buttress: true, rose: true });
  const [tx, tz] = toWorld(x, zc, rot, -13, 0);
  addTower(B, F, -13, 0, 6, y0 - 3, y0, 24, { wall: C('#ebe7de'), color: C('#43464a'), r: 0.98, h: 17 });
  world.addBox(tx, tz, 3.3, 3.3, rot);
  const bz = 77, bu = 42; // 人骨室
  addHall(B, world, { x: shoreX(bz) - bu, z: bz, rot: shoreRot(bz), w: 5, d: 6, H: 4.5, y0, wall: C('#f1ede4'), roof: C('#4a4c50'), pitch: THREE.MathUtils.degToRad(50) });
  // 擋土牆（石塊）＋女兒牆
  const wz = 62.25, wu = 33;
  const WF = frame(shoreX(wz) - wu, wz, shoreRot(wz));
  B.stone.box(WF, 1.2, 15.9 - 6, 43.5, 0, (15.9 + 6) / 2, 0, C('#c4bcae'));
  B.stone.box(WF, 1.4, 0.25, 43.7, 0, 16.0, 0, STONE_LIGHT);
  world.addBox(shoreX(wz) - wu, wz, 0.7, 21.75, shoreRot(wz));
  // 墓園：鐵十字與花草
  for (let i = 0; i < 24; i++) {
    const cz = 42 + (i % 6) * 2.0, cu = 38 + Math.floor(i / 6) * 3.2;
    const CF = frame(shoreX(cz) - cu, cz, shoreRot(cz));
    B.trim.box(CF, 0.07, 1.15, 0.07, 0, y0 + 0.58, 0, IRON);
    B.trim.box(CF, 0.07, 0.07, 0.55, 0, y0 + 0.85, 0, IRON);
    B.trim.box(CF, 0.06, 0.06, 0.06, 0, y0 + 1.2, 0, GOLD);
    B.stone.box(CF, 1.0, 0.18, 0.6, 0.25, y0 + 0.08, 0, STONE_LIGHT);
    for (let k = 0; k < 4; k++) B.foliage.geom(CF, BLOOM, 0.05 + k * 0.17, y0 + 0.24, (k % 2 - 0.5) * 0.25, k % 2 ? LEAF : FLOWERS[i % FLOWERS.length], { sc: 1.1 });
  }
}

// ---------- 鋪面 ----------
function conformStrip(Bp, zA, zB, nz, nt, ufn, color, lift = 0.08) {
  const row = nt + 1, pos = [], uvs = [];
  for (let j = 0; j <= nz; j++) {
    const z = lerp(zA, zB, j / nz);
    for (let i = 0; i <= nt; i++) {
      const u = ufn(z, i / nt), x = shoreX(z) - u;
      pos.push(x, heightAt(x, z) + lift, z);
      uvs.push(u, z);
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nt; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.reverse()); g.computeVertexNormals(); }
  Bp.raw(g, color);
}

function addStreets(B) {
  conformStrip(B.cobble, -470, 330, 420, 4, (z, t) => roadU(z) + (t - 0.5) * 4, C('#ffffff'), 0.12);
  // 路緣石（廣場處斷開）
  for (const [za, zb] of [[-470, 3], [35, 330]]) for (const s of [-1, 1]) {
    conformStrip(B.paving, za, zb, Math.round((zb - za) / 2), 1, (z, t) => roadU(z) + s * (1.95 + t * 0.3), C('#cfc8bb'), 0.2);
  }
  conformStrip(B.paving, 4, 34, 36, 22, (z, t) => lerp(18.5, 36, t), C('#f4efe6'), 0.07);
  conformStrip(B.paving, 28, 41, 16, 4, (z, t) => lerp(31.5, 35.1, t), C('#e6dfd2'), 0.1);
  conformStrip(B.paving, 40.5, 84, 36, 14, (z, t) => lerp(34.2, 61.5, t), C('#d8d0c2'), 0.05);
}

function addMarketSquare(B, world, rng) {
  const cz = 19, cu = 27, x = shoreX(cz) - cu, y = heightAt(x, cz);
  const F = frame(x, cz, shoreRot(cz));
  // 聖三一紀念柱
  B.stone.box(F, 2.6, 0.5, 2.6, 0, y + 0.25, 0, STONE);
  B.stone.box(F, 2.2, 1.0, 2.2, 0, y + 0.95, 0, STONE_LIGHT);
  // 照片中紀念柱是風化的灰色石材
  B.stone.box(F, 1.7, 0.8, 1.7, 0, y + 1.85, 0, C('#b3ada2'));
  B.trim.geom(F, new THREE.CylinderGeometry(0.28, 0.38, 6.2, 14), 0, y + 5.35, 0, C('#a39d92'));
  for (let i = 0; i < 5; i++) B.trim.geom(F, BLOBS[i % 4], Math.sin(i * 1.3) * 0.45, y + 8.4 + i * 0.25, Math.cos(i * 1.3) * 0.45, C('#9f998d'), { sc: 0.55 });
  B.trim.geom(F, new THREE.SphereGeometry(0.35, 14, 10), 0, y + 9.8, 0, GOLD);
  for (const [a, b] of CORNERS) B.trim.geom(F, new THREE.SphereGeometry(0.22, 10, 8), a * 1.1, y + 1.6, b * 1.1, C('#a8a296'));
  world.addBox(x, cz, 1.5, 1.5, shoreRot(cz));
  // 噴泉
  const fz = 9, fu = 24, fx = shoreX(fz) - fu, fy = heightAt(fx, fz);
  const FF = frame(fx, fz, 0);
  B.stone.geom(FF, new THREE.CylinderGeometry(1.9, 2.0, 0.75, 8), 0, fy + 0.35, 0, STONE_LIGHT);
  B.glass.geom(FF, new THREE.CylinderGeometry(1.65, 1.65, 0.1, 8), 0, fy + 0.66, 0, C('#6aa7b0'));
  B.stone.geom(FF, new THREE.CylinderGeometry(0.22, 0.32, 1.7, 8), 0, fy + 1.2, 0, STONE_LIGHT);
  B.stone.geom(FF, new THREE.CylinderGeometry(0.6, 0.3, 0.25, 8), 0, fy + 2.1, 0, STONE_LIGHT);
  world.addBox(fx, fz, 2.0, 2.0, 0);
  // 咖啡座陽傘與長椅
  for (const [z, u, colr] of [[8, 31, '#c8423b'], [14, 32.5, '#f1ead6'], [27, 32, '#c8423b'], [31, 23, '#f1ead6']]) {
    const px = shoreX(z) - u, py = heightAt(px, z), PF = frame(px, z, 0);
    B.trim.geom(PF, new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), 0, py + 1.15, 0, IRON);
    B.trim.geom(PF, new THREE.ConeGeometry(1.6, 0.6, 10, 1, true), 0, py + 2.35, 0, C(colr));
    B.trim.geom(PF, new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12), 0, py + 0.75, 0, WHITE);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + rng();
      B.wood.box(PF, 0.42, 0.06, 0.42, Math.cos(a) * 0.95, py + 0.45, Math.sin(a) * 0.95, C('#7a4c2e'));
      B.wood.box(PF, 0.06, 0.45, 0.42, Math.cos(a) * 1.15, py + 0.7, Math.sin(a) * 1.15, C('#7a4c2e'), { ry: -a });
    }
    world.addBox(px, z, 0.6, 0.6, 0);
  }
}

function addBench(B, world, x, z, rot) {
  const y = heightAt(x, z), F = frame(x, z, rot);
  B.wood.box(F, 0.45, 0.06, 1.8, 0, y + 0.45, 0, C('#8a5a36'));
  B.wood.box(F, 0.06, 0.4, 1.8, -0.22, y + 0.72, 0, C('#8a5a36'));
  for (const s of [-0.75, 0.75]) B.trim.box(F, 0.45, 0.45, 0.06, 0, y + 0.22, s, IRON);
  world.addBox(x, z, 0.3, 0.95, rot);
}

function addLamp(B, world, x, z, rot) {
  const y = heightAt(x, z), F = frame(x, z, rot);
  B.trim.geom(F, new THREE.CylinderGeometry(0.06, 0.09, 3.4, 8), 0, y + 1.7, 0, IRON);
  B.trim.box(F, 0.7, 0.05, 0.05, 0.3, y + 3.3, 0, IRON);
  B.glassLit.box(F, 0.3, 0.42, 0.3, 0.62, y + 3.0, 0, WHITE, { unitUV: true });
  const cap = new THREE.ConeGeometry(0.28, 0.25, 4, 1); cap.rotateY(Math.PI / 4);
  B.trim.geom(F, cap, 0.62, y + 3.33, 0, IRON);
  // 吊掛花籃
  B.trim.box(F, 0.5, 0.04, 0.04, -0.2, y + 2.55, 0, IRON);
  B.trim.box(F, 0.02, 0.3, 0.02, -0.42, y + 2.4, 0, IRON);
  B.wood.geom(F, new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), -0.42, y + 2.25, 0, C('#6b4429'));
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7, r = i < 6 ? 0.17 : 0.08;
    const hang = i >= 6 ? 0 : (i % 2) * 0.12;
    B.foliage.geom(F, BLOOM, -0.42 + Math.cos(a) * r, y + 2.3 - hang, Math.sin(a) * r, i % 3 === 0 ? LEAF : FLOWERS[i % FLOWERS.length], { sc: 0.95 });
  }
  world.addBox(x, z, 0.15, 0.15, 0);
}

function addPier(B, world, z, len = 16) {
  const rot = shoreRot(z), cu = 1 - len / 2, x = shoreX(z) - cu, top = 1.15;
  const F = frame(x, z, rot);
  B.wood.box(F, len, 0.22, 3, 0, top - 0.11, 0, C('#9a7656'));
  for (let i = 0; i <= len / 3; i++) {
    const lx = -len / 2 + i * 3 + 0.2;
    for (const s of [1, -1]) B.wood.box(F, 0.28, 5, 0.28, lx, top - 2.6, s * 1.4, C('#5a4636'));
    B.wood.box(F, 0.2, 0.2, 3.0, lx, top - 0.35, 0, C('#5a4636'));
  }
  for (const s of [1, -1]) B.wood.box(F, 0.35, 0.55, 0.35, len / 2 - 0.4, top + 0.27, s * 1.2, C('#4a3828'));
  world.addPlatform(x, z, len / 2, 1.5, rot, top);
  return { x, z, rot, len };
}

function addBoathouse(B, world, rng, z) {
  const d = 8.5, w = 6, cu = -6.25;
  return addHouse(B, world, rng, {
    ...houseStyle(rng, {}), x: shoreX(z) - cu, z, rot: shoreRot(z), w, d, floors: 1,
    fullWood: true, woodTop: false, boathouse: true, y0: 0.5, yb: -2.2, dormer: false,
  });
}

// 闊葉樹：彎曲樹幹 + 多團不規則樹冠
function addLeafyTree(B, x, z, h, s, rng) {
  const F = frame(x, z, rng() * 6.28);
  const bark = C('#4b3626');
  B.trim.geom(F, new THREE.CylinderGeometry(0.12 * s / 3, 0.24 * s / 3, s * 1.3, 7), 0, h + s * 0.62, 0, bark, { rz: (rng() - 0.5) * 0.12 });
  for (let k = 0; k < 2; k++) B.trim.geom(F, new THREE.CylinderGeometry(0.05, 0.09, s * 0.7, 5), (k - 0.5) * s * 0.35, h + s * 1.15, 0, bark, { rz: (k - 0.5) * 1.1 });
  const hue = 0.22 + rng() * 0.07;
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rng(), r = i === 0 ? 0 : s * (0.35 + rng() * 0.3);
    const by = h + s * (1.55 + (i === 0 ? 0.25 : (rng() - 0.3) * 0.5));
    const col = new THREE.Color().setHSL(hue + (rng() - 0.5) * 0.04, 0.45 + rng() * 0.15, 0.24 + rng() * 0.1, THREE.SRGBColorSpace);
    B.foliage.geom(F, BLOBS[i % 4], Math.cos(a) * r, by, Math.sin(a) * r, col, {
      sc: s * (0.5 + rng() * 0.25), shade: (lx, ly) => 0.75 + 0.35 * THREE.MathUtils.clamp(ly / s + 0.5, 0, 1),
    });
  }
}

function addVillageTrees(B, world, rng) {
  let n = 0;
  for (let a = 0; a < 700 && n < 55; a++) {
    const z = -125 + rng() * 350, u = rng() * 64;
    if (Math.abs(u - roadU(z)) < 3.8) continue;
    if (z > 2 && z < 44 && u > 16 && u < 40) continue;
    const x = shoreX(z) - u, h = heightAt(x, z);
    if (h < 1.3 || world.insideAny(x, z, 3.0)) continue;
    addLeafyTree(B, x, z, h, 2.6 + rng() * 2.2, rng);
    world.addBox(x, z, 0.4, 0.4, 0);
    n++;
  }
  // 屋前灌木
  for (let a = 0; a < 900 && n < 200; a++) {
    const z = -180 + rng() * 410, u = rng() * 62;
    if (Math.abs(u - roadU(z)) < 2.6) continue;
    const x = shoreX(z) - u, h = heightAt(x, z);
    if (h < 1.3 || world.insideAny(x, z, 0.5) || !world.insideAny(x, z, 2.2)) continue;
    const F = frame(x, z, rng() * 6);
    const col = new THREE.Color().setHSL(0.25 + rng() * 0.06, 0.4, 0.22 + rng() * 0.08, THREE.SRGBColorSpace);
    B.foliage.geom(F, BLOBS[n % 4], 0, h + 0.35, 0, col, { sc: new THREE.Vector3(0.6 + rng() * 0.4, 0.45 + rng() * 0.2, 0.6 + rng() * 0.4) });
    if (rng() < 0.4) B.foliage.geom(F, BLOOM, 0.2, h + 0.75, 0, FLOWERS[n % FLOWERS.length], { sc: 1.4 });
    n++;
  }
}

export function buildVillage(scene, world, rng) {
  const T = getTextures();
  PLANTERS = []; CHIMNEYS = [];
  const B = {};
  for (const k of ['plaster', 'wood', 'stone', 'roof', 'metal', 'trim', 'glass', 'glassLit', 'cobble', 'paving', 'foliage', 'logs', 'awning', 'awningV']) B[k] = new Builder();
  addProtestantChurch(B, world);
  addCatholicChurch(B, world);
  addMarketSquare(B, world, rng);
  const piers = [-100, 19, 135].map((z) => addPier(B, world, z));
  for (const z of [-160, -140, -86, 100, 120, 180]) addBoathouse(B, world, rng, z);
  const houses = placeRows(B, world, rng);
  addStreets(B);
  for (const [z, u, r] of [[6, 20, 0], [32, 20, 0], [45, 36, Math.PI / 2], [70, 36, Math.PI / 2], [-70, 12.6, 0], [150, 12.4, 0]]) {
    addBench(B, world, shoreX(z) - u, z, shoreRot(z) + r);
  }
  for (let z = -200; z < 235; z += 30) {
    if (z > 0 && z < 40) continue;
    const u = roadU(z) + 2.7, x = shoreX(z) - u;
    if (!world.insideAny(x, z, 0.8)) addLamp(B, world, x, z, shoreRot(z));
  }
  addVillageTrees(B, world, rng);

  const std = (opts) => new THREE.MeshStandardMaterial({ vertexColors: true, ...opts });
  const tex = (set, ns = 1) => ({ map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(ns, ns) });
  const winLitMat = std({ vertexColors: false, map: T.window.map, emissiveMap: T.window.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.15 });
  const meshes = [
    B.plaster.build(std({ ...tex(T.plaster, 0.6), roughness: 0.93 })),
    B.wood.build(std({ ...tex(T.wood, 0.9), roughness: 0.82 })),
    B.stone.build(std({ ...tex(T.stone, 1.0), roughness: 0.9 })),
    B.roof.build(std({ ...tex(T.roof, 1.1), roughness: 0.74 })),
    B.metal.build(std({ ...tex(T.roofMetal, 0.8), roughness: 0.5, metalness: 0.15 })),
    B.trim.build(std({ roughness: 0.65 })),
    B.awning.build(std({ vertexColors: false, map: T.awningH, roughness: 0.85, side: THREE.DoubleSide })),
    B.awningV.build(std({ vertexColors: false, map: T.awning, roughness: 0.85, side: THREE.DoubleSide })),
    B.glass.build(std({ vertexColors: false, map: T.window.map, roughness: 0.06, metalness: 0.1 }), false),
    B.glassLit.build(winLitMat, false),
    B.cobble.build(std({ ...tex(T.cobble, 1.2), roughness: 0.82 }), false),
    B.paving.build(std({ ...tex(T.paving, 1.0), roughness: 0.85 }), false),
    B.foliage.build(std({ roughness: 0.9, flatShading: true })),
    B.logs.build(std({ ...tex(T.logs, 1.0), roughness: 0.9 })),
  ].filter(Boolean);
  for (const m of meshes) scene.add(m);
  const planters = buildPlanters(scene, rng);
  return { houses, piers, winLitMat, chimneys: CHIMNEYS, planters };
}
