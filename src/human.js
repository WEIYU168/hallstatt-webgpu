// 划船的人：程式建模（沿骨骼鏈放樣出身體、衣物、雙手、臉部、奧地利氈帽）＋骨架綁定（SkinnedMesh 線性混合蒙皮）。
// 骨骼由程式驅動：划船時以雙骨 IK 讓雙手握住槳柄、雙腳踩在船底，身體隨槳的節奏前傾後仰、偶爾回頭看航向；
// 開電動船時右手握舵柄、左手放在大腿上。
// 角色座標：原點在座板表面（臀部正下方），+Z 為面向、+Y 向上、+X 為角色的左手邊。
import * as THREE from 'three';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, ringsAlong, solid, spline } from './loft.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (h) => new THREE.Color(h);
const sat = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (x) => Math.exp(-x * x);

const COL = {
  skin: C('#cf9473'), skinRed: C('#c27360'), lip: C('#a15d57'),
  shirt: C('#ddd7ca'), shirtShade: C('#c8c0b0'), vest: C('#2d4935'),
  pants: C('#5a3a24'), pantsDark: C('#46301f'), belt: C('#2a1c13'), sock: C('#77786a'), shoe: C('#2f2219'), sole: C('#1b1410'),
  hair: C('#47321f'), beard: C('#5a4130'), hat: C('#33462f'), band: C('#1c1b19'), feather: C('#56704a'), featherTip: C('#d9d4c4'),
  eyeW: C('#e9e3d8'), iris: C('#4b6176'), pupil: C('#0d0d0d'),
};
const ROUGH = { skin: 0.52, cloth: 0.93, leather: 0.6, hair: 0.85, eye: 0.15, hat: 0.9 };

export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const I = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  uArmL: 'chest', fArmL: 'uArmL', handL: 'fArmL', uArmR: 'chest', fArmR: 'uArmR', handR: 'fArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

// 坐姿綁定時的關節位置
function joints() {
  const j = { hips: V(0, 0.09, 0), spine: V(0, 0.2, -0.005), chest: V(0, 0.36, 0), neck: V(0, 0.565, -0.005), head: V(0, 0.655, 0.012), headTop: V(0, 0.88, 0.02) };
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    j['shoulder' + k] = V(0.175 * s, 0.49, -0.005);
    j['elbow' + k] = V(0.22 * s, 0.225, 0.1);
    j['wrist' + k] = V(0.15 * s, 0.3, 0.33);
    j['hip' + k] = V(0.095 * s, 0.09, 0.02);
    j['knee' + k] = V(0.11 * s, 0.17, 0.465);
    j['ankle' + k] = V(0.12 * s, -0.25, 0.53);
    j['toe' + k] = V(0.13 * s, -0.31, 0.75);
  }
  return j;
}

const _m4 = new THREE.Matrix4();
const quatFrom = (x, y) => new THREE.Quaternion().setFromRotationMatrix(_m4.makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
const ortho = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
// 雙骨鏈的鉸鏈軸 X = 彎曲方向 × (根→末端)；綁定與執行時用同一個公式，扭轉才會一致
function hingeX(A, M, T) {
  const dir = T.clone().sub(A).normalize();
  const bend = ortho(M.clone().sub(A), dir);
  return new THREE.Vector3().crossVectors(bend, dir).normalize();
}

function bindFrames(j) {
  const F = {}, X = V(1, 0, 0);
  const axial = (n, a, b) => { const y = b.clone().sub(a).normalize(); F[n] = { p: a.clone(), q: quatFrom(ortho(X, y), y) }; };
  axial('hips', j.hips, j.spine); axial('spine', j.spine, j.chest); axial('chest', j.chest, j.neck);
  axial('neck', j.neck, j.head); axial('head', j.head, j.headTop);
  for (const k of ['L', 'R']) {
    const S = j['shoulder' + k], E = j['elbow' + k], W = j['wrist' + k];
    const hx = hingeX(S, E, W), yf = W.clone().sub(E).normalize();
    F['uArm' + k] = { p: S.clone(), q: quatFrom(hx, E.clone().sub(S).normalize()) };
    F['fArm' + k] = { p: E.clone(), q: quatFrom(hx, yf) };
    F['hand' + k] = { p: W.clone(), q: quatFrom(X.clone(), ortho(yf, X)) }; // X＝握柄方向（角色左方）、Y＝沿前臂、Z＝掌心朝下
    const H = j['hip' + k], K = j['knee' + k], A = j['ankle' + k];
    const lx = hingeX(H, K, A);
    F['thigh' + k] = { p: H.clone(), q: quatFrom(lx, K.clone().sub(H).normalize()) };
    F['shin' + k] = { p: K.clone(), q: quatFrom(lx, A.clone().sub(K).normalize()) };
    const fy = j['toe' + k].clone().sub(A).normalize();
    F['foot' + k] = { p: A.clone(), q: quatFrom(ortho(X, fy), fy) };
  }
  return F;
}

const one = (b) => () => [[b, 1]];

// ---------- 身體各部位 ----------
function torso() {
  const T = spline([ // y, 半寬, 前, 後, z 偏移, 超橢圓指數
    [0.0, 0.125, 0.1, 0.11, -0.025, 2.2], [0.04, 0.162, 0.118, 0.128, -0.022, 2.3], [0.1, 0.174, 0.12, 0.124, -0.012, 2.4],
    [0.17, 0.164, 0.116, 0.108, 0, 2.4], [0.24, 0.15, 0.112, 0.094, 0.006, 2.4], [0.31, 0.156, 0.116, 0.095, 0.002, 2.4],
    [0.38, 0.168, 0.121, 0.1, 0, 2.5], [0.44, 0.178, 0.12, 0.104, 0, 2.6], [0.49, 0.188, 0.104, 0.1, -0.006, 2.8],
    [0.53, 0.176, 0.085, 0.09, -0.01, 2.8], [0.555, 0.128, 0.066, 0.072, -0.01, 2.4], [0.575, 0.064, 0.052, 0.056, -0.004, 2.0],
  ], 5);
  const rings = T.map(([y, w, dF, dB, zc, n]) => ({ c: V(0, y, zc), y: V(0, 1, 0), x: V(1, 0, 0), w, dF, dB, n, t: y }));
  const tmp = new THREE.Color();
  return loft(rings, {
    seg: 56, capStart: 0.012, capRings: 3,
    color: ({ p }) => {
      const y = p.y, ax = Math.abs(p.x);
      if (y < 0.135) return COL.pants;
      if (y < 0.158) return COL.belt;
      // 背心：V 領、肩膀與袖孔露出襯衫（邊界柔化，避免鋸齒）
      const vneck = smooth(-0.008, 0.008, (y - 0.31) * 0.5 - ax) * smooth(0.0, 0.04, p.z);
      const arm = smooth(0.135, 0.16, ax) * smooth(0.41, 0.45, y), shoulder = smooth(0.5, 0.525, y);
      return tmp.copy(COL.vest).lerp(COL.shirt, Math.max(vneck, arm, shoulder));
    },
    rough: ({ p }) => (p.y < 0.158 ? ROUGH.leather : ROUGH.cloth),
    skin: ({ p }) => {
      const y = p.y, ax = Math.abs(p.x);
      const arm = smooth(0.12, 0.19, ax) * smooth(0.42, 0.5, y) * 0.45, nk = smooth(0.55, 0.585, y) * 0.5;
      const h = 1 - smooth(0.12, 0.26, y), sp = smooth(0.12, 0.26, y) * (1 - smooth(0.27, 0.4, y)), ch = smooth(0.27, 0.4, y) * (1 - arm) * (1 - nk);
      return [[I.hips, h], [I.spine, sp], [I.chest, ch], [p.x > 0 ? I.uArmL : I.uArmR, arm * (1 - nk)], [I.neck, nk]];
    },
  });
}

function neckPart(j) {
  const a = j.neck.clone().add(V(0, -0.015, 0)), b = j.head.clone().add(V(0, 0.04, 0.01));
  const ax = b.clone().sub(a).normalize();
  const R = spline([[0, 0.064, 0.062], [0.3, 0.058, 0.056], [0.45, 0.049, 0.05], [0.75, 0.046, 0.05], [1, 0.046, 0.05]], 2);
  return loft(R.map(([t, w, d]) => ({ c: a.clone().lerp(b, t), y: ax, x: V(1, 0, 0), w, dF: d, dB: d, n: 2, t })), {
    seg: 24, capStart: 0.01, capEnd: 0.01,
    color: ({ t }) => (t < 0.36 ? COL.shirt : COL.skin),
    rough: ({ t }) => (t < 0.36 ? ROUGH.cloth : ROUGH.skin),
    skin: ({ t }) => [[I.chest, 0.6 * (1 - smooth(0, 0.4, t))], [I.neck, 1], [I.head, 0.7 * smooth(0.6, 1, t)]],
  });
}

// 頭：在橢球上雕出下顎、顴骨、眼窩、眉骨、鼻子、嘴唇、下巴；頂點色畫出膚色、紅潤、嘴唇、眉毛、短鬍、頭髮
const HEAD_C = V(0, 0.765, 0.03), HR = { x: 0.074, y: 0.112, zF: 0.098, zB: 0.104 };
function sculpt(x, y, z) {
  const fw = smooth(-0.01, 0.035, z);
  const jaw = smooth(-0.005, -0.095, y);
  x *= 1 - 0.3 * jaw;
  if (z > 0) z *= 1 - 0.1 * jaw;
  if (z < 0) z *= 1 - 0.28 * smooth(-0.02, -0.1, y);
  x *= 1 + fw * (0.05 * gauss((y + 0.005) / 0.028) - 0.045 * gauss((y - 0.045) / 0.028));
  const ax = Math.abs(x);
  z -= fw * 0.009 * gauss(Math.hypot((ax - 0.031) / 0.017, (y - 0.012) / 0.012));                 // 眼窩
  z += fw * 0.005 * gauss((y - 0.03) / 0.009) * gauss((ax - 0.027) / 0.026);                        // 眉骨
  const np = y > 0.024 ? 0 : y > -0.03 ? 0.004 + 0.018 * smooth(0.024, -0.028, y) : 0.022 * (1 - smooth(-0.03, -0.046, y));
  z += fw * np * gauss(x / (0.006 + 0.0095 * smooth(0.014, -0.034, y)));                           // 鼻樑到鼻頭
  z += fw * 0.005 * gauss((ax - 0.0135) / 0.006) * gauss((y + 0.036) / 0.0065);                     // 鼻翼
  const lip = Math.exp(-Math.pow(x / 0.023, 4));
  z += fw * lip * (0.0042 * gauss((y + 0.057) / 0.0042) + 0.005 * gauss((y + 0.069) / 0.005) - 0.0028 * gauss((y + 0.0632) / 0.0016));
  z += fw * 0.009 * gauss((y + 0.09) / 0.016) * gauss(x / 0.028);                                  // 下巴
  return [x, y, z];
}
function headColor(x, y, z, out) {
  const ax = Math.abs(x), front = z > 0.035;
  out.copy(COL.skin);
  if (front) out.lerp(COL.skinRed, Math.min(1, 0.55 * gauss(Math.hypot((ax - 0.042) / 0.016, (y + 0.018) / 0.016)) + 0.6 * gauss(Math.hypot(x / 0.011, (y + 0.03) / 0.011))));
  const beard = (y < -0.036 && (ax > 0.024 || y < -0.076)) || (y < -0.012 && ax > 0.05 && z > -0.025) || (y > -0.056 && y < -0.046 && ax < 0.027);
  const lips = front && ax < 0.0235 && y < -0.053 && y > -0.075;
  if (lips) out.copy(COL.lip);
  else if (beard && z > -0.03) out.lerp(COL.beard, 0.88);
  const browY = 0.032 + 0.004 * gauss((ax - 0.028) / 0.012);
  if (front && ax > 0.011 && ax < 0.047 && Math.abs(y - browY) < 0.0045) out.copy(COL.hair);
  if ((z < 0.012 && y > -0.075) || (ax > 0.064 && y > -0.028 && z < 0.045)) out.copy(COL.hair);
  return out;
}
function headPart() {
  const NU = 64, NV = 48, pos = [], col = [], rough = [], idx = [], c = new THREE.Color();
  for (let jv = 0; jv <= NV; jv++) {
    const phi = -Math.PI / 2 + (Math.PI * jv) / NV;
    for (let iu = 0; iu <= NU; iu++) {
      const th = (2 * Math.PI * iu) / NU;
      const sx = Math.cos(phi) * Math.sin(th), sy = Math.sin(phi), sz = Math.cos(phi) * Math.cos(th);
      const [x, y, z] = sculpt(sx * HR.x, sy * HR.y, sz * (sz > 0 ? HR.zF : HR.zB));
      pos.push(HEAD_C.x + x, HEAD_C.y + y, HEAD_C.z + z);
      headColor(x, y, z, c);
      col.push(c.r, c.g, c.b);
      rough.push(c.equals(COL.hair) ? ROUGH.hair : ROUGH.skin);
    }
  }
  for (let jv = 0; jv < NV; jv++) for (let iu = 0; iu < NU; iu++) {
    const a = jv * (NU + 1) + iu, b = a + 1, d = a + NU + 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  solid(g, (p, i) => c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]), (p, i) => rough[i], I.head);
  const parts = [g];
  // 眼睛（眼白、虹膜、瞳孔，上下眼瞼蓋住一部分）
  for (const s of [1, -1]) {
    const ex = 0.031 * s, ey = 0.012;
    const sz = Math.sqrt(1 - (ex / HR.x) ** 2 - (ey / HR.y) ** 2) * HR.zF;
    const [, , zs] = sculpt(ex, ey, sz);
    const eye = new THREE.SphereGeometry(0.0105, 18, 14);
    solid(eye, (p) => {
      const n = p.clone().normalize();
      if (n.y > 0.42 || n.y < -0.62) return COL.skin;
      return n.z > 0.965 ? COL.pupil : n.z > 0.83 ? COL.iris : COL.eyeW;
    }, ROUGH.eye, I.head);
    eye.translate(HEAD_C.x + ex, HEAD_C.y + ey, HEAD_C.z + zs - 0.0062);
    parts.push(eye);
    // 耳朵
    const ear = new THREE.SphereGeometry(1, 14, 10);
    ear.scale(0.011, 0.03, 0.019); ear.rotateY(-0.25 * s); ear.rotateZ(0.12 * s);
    solid(ear, (p) => c.copy(COL.skin).lerp(COL.skinRed, 0.35 + 0.3 * smooth(-0.01, 0.02, p.y)).clone(), ROUGH.skin, I.head);
    ear.translate(HEAD_C.x + 0.071 * s, HEAD_C.y - 0.003, HEAD_C.z - 0.008);
    parts.push(ear);
  }
  return parts;
}

// 提洛爾氈帽：帽冠（帽帶）＋上翹的帽簷＋羽毛
function hatParts() {
  const y0 = 0.828, cz = 0.028, up = V(0, 1, 0), X = V(1, 0, 0);
  const rows = spline([[-0.006, 0.084, 0.101], [0.012, 0.0835, 0.1], [0.024, 0.083, 0.099], [0.05, 0.078, 0.093], [0.08, 0.068, 0.082], [0.095, 0.054, 0.068], [0.103, 0.03, 0.042]], 2);
  const crown = loft(rows.map(([dy, w, d]) => ({ c: V(0, y0 + dy, cz), y: up, x: X, w, dF: d, dB: d * 1.02, n: 2.3, t: dy })), {
    seg: 32, capStart: 0.004, capEnd: 0.006, capRings: 3,
    color: ({ t, cap }) => (cap === 0 && t > 0.002 && t < 0.024 ? COL.band : COL.hat),
    rough: () => ROUGH.hat, skin: one(I.head),
  });
  const brim = [];
  for (let i = 0; i < 48; i++) {
    const ph = (i / 48) * Math.PI * 2, s = Math.sin(ph), co = Math.cos(ph), Rx = 0.116, Rz = 0.132;
    const lift = 0.014 * s * s + 0.01 * smooth(0, -1, co) - 0.004 * smooth(0, 1, co);
    brim.push({ c: V(Rx * s, y0 - 0.004 + lift, cz + Rz * co), y: V(Rx * co, 0, -Rz * s), x: V(s / Rx, 0, co / Rz), w: 0.03, dF: 0.0035, dB: 0.0035, n: 2.2, t: ph });
  }
  const brimG = loft(brim, { seg: 8, closed: true, color: () => COL.hat, rough: () => ROUGH.hat, skin: one(I.head) });
  const feather = new THREE.SphereGeometry(1, 10, 8);
  feather.scale(0.004, 0.012, 0.046);
  solid(feather, (p) => (p.z < -0.03 ? COL.featherTip : COL.feather), ROUGH.hat, I.head);
  feather.rotateX(-0.55);
  feather.translate(0.084, y0 + 0.036, cz - 0.03);
  return [crown, brimG, feather];
}

function armParts(j, F, k) {
  const S = j['shoulder' + k], E = j['elbow' + k], W = j['wrist' + k];
  const hx = V(1, 0, 0).applyQuaternion(F['uArm' + k].q);
  const U = I['uArm' + k], Fo = I['fArm' + k], Ha = I['hand' + k];
  const upper = spline([[0, 0.056, 0.056], [0.12, 0.054, 0.054], [0.35, 0.047, 0.05], [0.6, 0.044, 0.046], [0.8, 0.047, 0.048], [0.9, 0.047, 0.048], [1, 0.041, 0.041]], 2);
  const ua = loft(upper.map(([t, w, d]) => ({ c: S.clone().lerp(E, t), y: E.clone().sub(S), x: hx, w, dF: d, dB: d, n: 2, t })), {
    seg: 20, capStart: 0.045, capEnd: 0.03,
    color: ({ t, cap }) => (cap > 0 || t > 0.95 ? COL.skin : t > 0.8 ? COL.shirtShade : COL.shirt),
    rough: ({ t, cap }) => (cap > 0 || t > 0.95 ? ROUGH.skin : ROUGH.cloth),
    skin: ({ t, cap }) => [[I.chest, cap < 0 ? 0.4 : 0.4 * (1 - smooth(0, 0.15, t))], [U, 1], [Fo, cap > 0 ? 0.5 : 0.5 * smooth(0.72, 1, t)]],
  });
  const fore = spline([[0, 0.04, 0.04], [0.12, 0.042, 0.04], [0.32, 0.04, 0.036], [0.62, 0.034, 0.029], [0.86, 0.029, 0.023], [1, 0.0275, 0.02]], 2);
  const fa = loft(fore.map(([t, w, d]) => ({ c: E.clone().lerp(W, t), y: W.clone().sub(E), x: hx, w, dF: d, dB: d, n: 2, t })), {
    seg: 18, capStart: 0.02, capEnd: 0.012,
    color: () => COL.skin, rough: () => ROUGH.skin,
    skin: ({ t, cap }) => [[U, cap < 0 ? 0.5 : 0.5 * (1 - smooth(0, 0.2, t))], [Fo, 1], [Ha, cap > 0 ? 0.35 : 0.35 * smooth(0.85, 1, t)]],
  });
  return [ua, fa, ...handParts(F['hand' + k], k === 'L' ? -1 : 1, Ha)];
}

// 握拳的手（在手骨座標中建模）：掌心 +Z、手指 +Y；四指包住沿 X 軸、位於 (y=0.058, z=0.028) 的握柄
export const GRIP = V(0, 0.058, 0.028);
function handParts(frame, s, bone) {
  const parts = [], sk = one(bone), col = () => COL.skin, rg = () => ROUGH.skin;
  const palm = spline([[0, 0.026, 0.017, 0.016, 0], [0.02, 0.034, 0.02, 0.016, 0], [0.05, 0.041, 0.021, 0.015, 0.002], [0.075, 0.043, 0.018, 0.014, 0], [0.088, 0.042, 0.014, 0.013, -0.002]], 2);
  parts.push(loft(palm.map(([y, w, dF, dB, zc]) => ({ c: V(0, y, zc), y: V(0, 1, 0), x: V(1, 0, 0), w, dF, dB, n: 2.6, t: y })), { seg: 16, capStart: 0.006, capEnd: 0.008, color: col, rough: rg, skin: sk }));
  const R = 0.028, phi0 = Math.atan2(0.002 - GRIP.z, 0.086 - GRIP.y), r0 = Math.hypot(0.002 - GRIP.z, 0.086 - GRIP.y);
  for (const [xo, rad, len] of [[0.03, 0.0088, 0.92], [0.01, 0.0095, 1], [-0.01, 0.009, 0.96], [-0.029, 0.0081, 0.82]]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, ph = phi0 + THREE.MathUtils.degToRad(215) * len * t, r = R + (r0 - R) * (1 - smooth(0, 0.35, t));
      pts.push(V(s * xo, GRIP.y + r * Math.cos(ph), GRIP.z + r * Math.sin(ph)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    parts.push(loft(ringsAlong(curve, 12, V(1, 0, 0), (t) => { const r = rad * (1 - 0.22 * t); return { w: r, dF: r, dB: r * 0.95, n: 2 }; }), { seg: 10, capStart: 0.004, capEnd: rad * 0.8, color: col, rough: rg, skin: sk }));
  }
  const thumb = new THREE.CatmullRomCurve3([V(s * 0.022, 0.02, 0.008), V(s * 0.04, 0.042, 0.022), V(s * 0.036, 0.062, 0.046), V(s * 0.018, 0.074, 0.058), V(s * 0.004, 0.078, 0.06)]);
  parts.push(loft(ringsAlong(thumb, 10, V(0, 0, 1), (t) => { const r = 0.0118 - 0.0026 * t; return { w: r, dF: r, dB: r, n: 2 }; }), { seg: 10, capStart: 0.006, capEnd: 0.009, color: col, rough: rg, skin: sk }));
  const thenar = new THREE.SphereGeometry(1, 12, 10);
  thenar.scale(0.016, 0.022, 0.012);
  solid(thenar, COL.skin, ROUGH.skin, bone);
  thenar.translate(s * 0.022, 0.03, 0.014);
  parts.push(thenar);
  const m = new THREE.Matrix4().compose(frame.p, frame.q, V(1, 1, 1));
  for (const g of parts) g.applyMatrix4(m);
  return parts;
}

function legParts(j, F, k) {
  const H = j['hip' + k], K = j['knee' + k], A = j['ankle' + k];
  const lx = V(1, 0, 0).applyQuaternion(F['thigh' + k].q);
  const Th = I['thigh' + k], Sh = I['shin' + k], Ft = I['foot' + k];
  // 大腿：+z 側為下方（被座板壓平）
  const th = spline([[0, 0.085, 0.07, 0.08], [0.2, 0.082, 0.066, 0.078], [0.5, 0.072, 0.058, 0.068], [0.78, 0.06, 0.05, 0.055], [0.94, 0.056, 0.048, 0.05], [1, 0.054, 0.048, 0.05]], 2);
  const thigh = loft(th.map(([t, w, dF, dB]) => ({ c: H.clone().lerp(K, t), y: K.clone().sub(H), x: lx, w, dF, dB, n: 2.1, t })), {
    seg: 20, capStart: 0.05, capEnd: 0.04,
    color: ({ t }) => (t > 0.9 ? COL.pantsDark : COL.pants), rough: () => ROUGH.leather,
    skin: ({ t, cap }) => [[I.hips, cap < 0 ? 0.5 : 0.5 * (1 - smooth(0, 0.25, t))], [Th, 1], [Sh, cap > 0 ? 0.5 : 0.5 * smooth(0.8, 1, t)]],
  });
  // 小腿：+z 側為後方（小腿肚）
  const sh = spline([[0, 0.052, 0.05, 0.05], [0.08, 0.05, 0.05, 0.047], [0.3, 0.05, 0.062, 0.04], [0.55, 0.043, 0.05, 0.036], [0.85, 0.035, 0.036, 0.032], [1, 0.033, 0.032, 0.031]], 2);
  const shin = loft(sh.map(([t, w, dF, dB]) => ({ c: K.clone().lerp(A, t), y: A.clone().sub(K), x: lx, w, dF, dB, n: 2, t })), {
    seg: 18, capStart: 0.02, capEnd: 0.02,
    color: ({ t, cap }) => (cap < 0 || t < 0.07 ? COL.pantsDark : t < 0.16 ? COL.skin : COL.sock),
    rough: ({ t }) => (t < 0.07 ? ROUGH.leather : t < 0.16 ? ROUGH.skin : ROUGH.cloth),
    skin: ({ t, cap }) => [[Th, cap < 0 ? 0.5 : 0.5 * (1 - smooth(0, 0.2, t))], [Sh, 1], [Ft, cap > 0 ? 0.35 : 0.35 * smooth(0.85, 1, t)]],
  });
  // 皮鞋：沿 +Z 放樣，+z 側（斷面座標）朝下
  const shoeRows = spline([[-0.075, 0.032, -0.29, 0.038], [-0.05, 0.04, -0.28, 0.05], [0, 0.042, -0.275, 0.058], [0.06, 0.045, -0.295, 0.035], [0.12, 0.048, -0.305, 0.026], [0.18, 0.045, -0.31, 0.02], [0.215, 0.036, -0.312, 0.017]], 2);
  const shoe = loft(shoeRows.map(([dz, w, yc, hh]) => ({ c: V(A.x + Math.sign(A.x) * 0.004, yc, A.z + dz), y: V(0, 0, 1), x: V(1, 0, 0), w, dF: hh, dB: hh, n: 3, t: dz })), {
    seg: 20, capStart: 0.012, capEnd: 0.022,
    color: ({ p }) => (p.y < -0.323 ? COL.sole : COL.shoe), rough: () => ROUGH.leather, skin: one(Ft),
  });
  return [thigh, shin, shoe];
}

// ---------- 執行時的姿態 ----------
const _A = V(), _d = V(), _dir = V(), _bend = V(), _x = V(), _y = V(), _y2 = V(), _z = V(), _M = V(), _T = V();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qm = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _g = V(), _ax = V(), _w = V(), _yh = V(), _zh = V(), _xh = V(), _sh = V(), _pole = V(), _tgt = V();

export class Human {
  constructor() {
    const j = joints(), F = bindFrames(j);
    const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
    BONES.forEach((n, i) => {
      const f = F[n], par = PARENT[n];
      if (!par) { bones[i].position.copy(f.p); bones[i].quaternion.copy(f.q); return; }
      const pf = F[par], inv = pf.q.clone().invert();
      bones[i].position.copy(f.p).sub(pf.p).applyQuaternion(inv);
      bones[i].quaternion.copy(inv).multiply(f.q);
      bones[I[par]].add(bones[i]);
    });
    const parts = [torso(), neckPart(j), ...headPart(), ...hatParts()];
    for (const k of ['L', 'R']) parts.push(...armParts(j, F, k), ...legParts(j, F, k));
    const geo = mergeGeometries(parts);
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    mat.roughnessNode = attribute('rough', 'float');
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group = new THREE.Group();
    this.group.add(mesh);
    this.b = Object.fromEntries(BONES.map((n, i) => [n, bones[i]]));
    this.rest = Object.fromEntries(BONES.map((n, i) => [n, bones[i].quaternion.clone()]));
    this.hipsRest = bones[0].position.clone();
    this.len = { uArm: j.shoulderL.distanceTo(j.elbowL), fArm: j.elbowL.distanceTo(j.wristL), thigh: j.hipL.distanceTo(j.kneeL), shin: j.kneeL.distanceTo(j.ankleL) };
    this.footQ = { L: F.footL.q.clone(), R: F.footR.q.clone() };
    this.ankle = { L: j.ankleL.clone(), R: j.ankleR.clone() };
    this.look = 0; this.lookTarget = 0; this.lookT = 5;
  }

  /** 坐在船上：x＝座位（船的局部座標）、seatY＝座板表面高度、facing＝+1 面向船首／-1 面向船尾、floorY＝船底板高度 */
  seat(boatGroup, x, seatY, facing, floorY) {
    boatGroup.add(this.group);
    this.group.position.set(x, seatY, 0);
    this.group.rotation.set(0, facing > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    const ay = floorY + 0.08 - seatY;
    for (const k of ['L', 'R']) this.ankle[k].y = ay;
  }
  leave() { if (this.group.parent) this.group.parent.remove(this.group); }

  _setWorld(bone, x, y) {
    _z.crossVectors(x, y);
    _q.setFromRotationMatrix(_m.makeBasis(x, y, _z));
    bone.parent.getWorldQuaternion(_qp);
    bone.quaternion.copy(_qp.invert()).multiply(_q);
    bone.updateMatrixWorld(true);
  }

  // 雙骨 IK（世界座標）：讓 lower 的末端到達 target，中間關節朝 pole 方向彎曲；回傳下段骨骼方向
  _ik(upper, lower, target, pole, l1, l2) {
    upper.getWorldPosition(_A);
    _d.subVectors(target, _A);
    const raw = _d.length() || 1e-4;
    _dir.copy(_d).divideScalar(raw);
    const dist = THREE.MathUtils.clamp(raw, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.998);
    const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    _bend.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
    if (_bend.lengthSq() < 1e-8) _bend.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    _bend.normalize();
    _x.crossVectors(_bend, _dir).normalize();
    _y.copy(_dir).multiplyScalar(cosA).addScaledVector(_bend, sinA).normalize();
    this._setWorld(upper, _x, _y);
    _M.copy(_A).addScaledVector(_y, l1);
    _T.copy(_A).addScaledVector(_dir, dist);
    _y2.subVectors(_T, _M).normalize();
    this._setWorld(lower, _x, _y2);
    return _y2;
  }

  _charDir(x, y, z, out) { this.mesh.getWorldQuaternion(_qm); return out.set(x, y, z).applyQuaternion(_qm); }

  // 手臂：grip＝握柄中心（世界座標）、axis＝握柄方向（大致朝角色左方）
  _arm(k, grip, axis) {
    const B = this.b, L = this.len, s = k === 'L' ? 1 : -1;
    this._charDir(0.9 * s, -0.55, -0.45, _pole);
    _xh.copy(axis).normalize();
    B['uArm' + k].getWorldPosition(_sh);
    _yh.subVectors(grip, _sh).normalize();
    for (let it = 0; it < 2; it++) {
      _yh.addScaledVector(_xh, -_yh.dot(_xh)).normalize();
      _zh.crossVectors(_xh, _yh);
      _w.copy(grip).addScaledVector(_yh, -GRIP.y).addScaledVector(_zh, -GRIP.z);
      _yh.copy(this._ik(B['uArm' + k], B['fArm' + k], _w, _pole, L.uArm, L.fArm));
    }
    _yh.addScaledVector(_xh, -_yh.dot(_xh)).normalize();
    this._setWorld(B['hand' + k], _xh, _yh);
  }

  _legs() {
    const B = this.b, L = this.len;
    this.mesh.getWorldQuaternion(_qm);
    for (const k of ['L', 'R']) {
      const s = k === 'L' ? 1 : -1;
      _tgt.copy(this.ankle[k]);
      this.mesh.localToWorld(_tgt);
      this._charDir(0.15 * s, 0.6, 1, _pole);
      this._ik(B['thigh' + k], B['shin' + k], _tgt, _pole, L.thigh, L.shin);
      const foot = B['foot' + k];
      foot.parent.getWorldQuaternion(_qp);
      foot.quaternion.copy(_qp.invert()).multiply(_qa.copy(_qm).multiply(this.footQ[k]));
      foot.updateMatrixWorld(true);
    }
  }

  _torso(lean, twist, side, bob = 0) {
    const B = this.b, R = this.rest;
    B.hips.position.copy(this.hipsRest).y += bob;
    B.hips.quaternion.copy(R.hips).multiply(_qa.setFromEuler(_e.set(lean * 0.22, 0, 0)));
    B.spine.quaternion.copy(R.spine).multiply(_qa.setFromEuler(_e.set(lean * 0.45, twist * 0.5, side * 0.5)));
    B.chest.quaternion.copy(R.chest).multiply(_qa.setFromEuler(_e.set(lean * 0.33, twist * 0.5, side * 0.5)));
  }

  _head(pitch, yaw, roll = 0) {
    const B = this.b, R = this.rest;
    B.neck.quaternion.copy(R.neck).multiply(_qa.setFromEuler(_e.set(pitch * 0.45, yaw * 0.4, roll * 0.5)));
    B.head.quaternion.copy(R.head).multiply(_qa.setFromEuler(_e.set(pitch * 0.55, yaw * 0.6, roll * 0.5)));
  }

  // 偶爾轉頭回望航向（划船的人背對前進方向）
  _glance(dt, every, amount) {
    this.lookT -= dt;
    if (this.lookT < 0) {
      if (this.lookTarget === 0) { this.lookTarget = (Math.random() < 0.5 ? 1 : -1) * amount; this.lookT = 1.3 + Math.random() * 0.6; }
      else { this.lookTarget = 0; this.lookT = every * (0.6 + Math.random() * 0.8); }
    }
    this.look += (this.lookTarget - this.look) * Math.min(1, dt * 3.2);
    return this.look;
  }

  /** 划船：雙手握槳柄（b.oars）、身體隨槳前傾後仰 */
  row(dt, t, b) {
    const sweep = b.sweep ?? 0;
    const lean = (sweep < 0 ? -sweep * 1.12 : -sweep * 0.72) + Math.sin(t * 0.7) * 0.015;
    this.group.updateMatrixWorld(true);
    this._torso(lean, 0, 0, -Math.max(0, lean) * 0.012);
    this._head(-lean * 0.8 + 0.06, this._glance(dt, 7, 1.15));
    this.b.hips.updateMatrixWorld(true);
    for (const { pivot, side } of b.oars) {
      pivot.localToWorld(_g.set(0, 0, -0.58));
      _ax.set(0, 0, side).transformDirection(pivot.matrixWorld);
      this._arm(side > 0 ? 'L' : 'R', _g, _ax);
    }
    this._legs();
  }

  /** 開電動船：右手握舵柄、左手放在大腿上、轉彎時身體微傾 */
  drive(dt, t, b) {
    const st = b.state;
    const side = -st.steer * Math.min(1, Math.abs(st.v) / 3) * 0.12;
    this.group.updateMatrixWorld(true);
    this._torso(0.05 + Math.sin(t * 1.3) * 0.01, st.steer * 0.12, side);
    this._head(-0.04, st.steer * 0.35 + this._glance(dt, 9, 0.7), -side * 0.5);
    this.b.hips.updateMatrixWorld(true);
    b.tiller.grip.getWorldPosition(_g);
    this._charDir(0, 0, 1, _ax);
    this._arm('R', _g, _ax);
    this.mesh.localToWorld(_g.set(0.1, 0.25, 0.33));
    this._charDir(1, 0, 0, _ax);
    this._arm('L', _g, _ax);
    this._legs();
  }
}
