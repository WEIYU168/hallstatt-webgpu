// 湖上與天空的生命：停泊的木船（可乘坐）、纜繩、疣鼻天鵝、綠頭鴨、飛鳥、水面漣漪
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shoreX } from './terrain.js';
import { createBoat, bob, poseOars } from './boat.js';
import { loft, ringsAlong, solid, spline } from './loft.js';
import { getTextures } from './textures.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const sat = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// 疣鼻天鵝（Cygnus olor）：船形身體、微微拱起的雙翼（busking 姿態）、上翹的尾羽、S 形長頸、
// 下傾的頭、橘紅色喙與黑色的喙基肉瘤和眼先。羽毛用程式產生的羽片法線貼圖。
let SWAN = null;
function swanAssets() {
  if (SWAN) return SWAN;
  const T = getTextures();
  const white = new THREE.Color('#e2dfd6'), tmp = new THREE.Color();
  const ORANGE = new THREE.Color('#dc5a26'), BLACK = new THREE.Color('#151311');
  const body = loft(spline([ // x, 半寬, 頂, 底
    [-0.56, 0.016, 0.215, 0.188], [-0.5, 0.06, 0.235, 0.12], [-0.42, 0.115, 0.255, 0.04], [-0.3, 0.172, 0.28, -0.04],
    [-0.15, 0.205, 0.296, -0.085], [0, 0.215, 0.302, -0.1], [0.14, 0.205, 0.292, -0.1], [0.26, 0.17, 0.272, -0.085],
    [0.35, 0.122, 0.254, -0.05], [0.41, 0.072, 0.238, 0],
  ], 3).map(([x, w, yt, yb]) => ({ c: V3(x, (yt + yb) / 2, 0), y: V3(1, 0, 0), x: V3(0, 0, 1), w, dF: (yt - yb) / 2, dB: (yt - yb) / 2, n: 2.15, t: x })), {
    seg: 30, capStart: 0.012, capEnd: 0.035, uv: { u: 12, v: 14 },
    color: ({ p }) => tmp.copy(white).multiplyScalar((0.66 + 0.34 * smooth(-0.06, 0.17, p.y)) * (1 - 0.18 * smooth(0.12, 0.26, p.y) * smooth(0.2, 0.05, Math.abs(p.z)))),
  });
  const wingRows = spline([ // x, 中心高, 側向, 寬, 上厚, 下厚
    [0.24, 0.272, 0.1, 0.06, 0.03, 0.018], [0.15, 0.3, 0.115, 0.095, 0.045, 0.024], [0, 0.326, 0.12, 0.11, 0.055, 0.028],
    [-0.15, 0.332, 0.115, 0.105, 0.05, 0.026], [-0.3, 0.322, 0.1, 0.085, 0.04, 0.02], [-0.42, 0.307, 0.075, 0.055, 0.025, 0.014],
    [-0.53, 0.294, 0.05, 0.022, 0.011, 0.007],
  ], 3);
  const wings = [1, -1].map((s) => {
    const xh = V3(0, -0.4, s).normalize();
    return loft(wingRows.map(([x, cy, cz, w, up, dn]) => ({ c: V3(x, cy, s * cz), y: V3(-1, 0, 0), x: xh, w, dF: s > 0 ? dn : up, dB: s > 0 ? up : dn, n: 2.3, t: x })), {
      seg: 22, capStart: 0.02, capEnd: 0.03, uv: { u: 4, v: 7 },
      color: ({ p }) => tmp.copy(white).multiplyScalar(0.74 + 0.26 * smooth(0.26, 0.35, p.y)),
    });
  });
  // 翅膀末端層層交疊的飛羽（往尾端延伸、微微上翹），讓翅膀與身體銜接得更自然
  const quills = [];
  for (const s of [1, -1]) for (let i = 0; i < 6; i++) {
    const q = new THREE.SphereGeometry(1, 10, 6);
    q.scale(0.13 - i * 0.008, 0.007, 0.032);
    solid(q, (p) => tmp.copy(white).multiplyScalar(0.8 + 0.2 * smooth(-0.003, 0.006, p.y)).clone(), 0.75, null, true);
    q.rotateY(s * (0.1 + i * 0.07));
    q.rotateZ(0.14 + i * 0.02);
    q.rotateX(-s * 0.35);
    q.translate(-0.4 - i * 0.025, 0.315 - i * 0.01, s * (0.105 - i * 0.012));
    quills.push(q);
  }
  const neckCurve = new THREE.CatmullRomCurve3([V3(0.29, 0.2, 0), V3(0.395, 0.4, 0), V3(0.39, 0.6, 0), V3(0.335, 0.775, 0), V3(0.37, 0.915, 0), V3(0.435, 0.975, 0)]);
  const nr = (t) => 0.04 + 0.045 * Math.pow(1 - smooth(0, 0.35, t), 1.5) + 0.004 * smooth(0.85, 1, t);
  const neck = loft(ringsAlong(neckCurve, 30, V3(0, 0, 1), (t) => ({ w: nr(t), dF: nr(t), dB: nr(t), n: 2 })), {
    seg: 18, capStart: 0.02, capEnd: 0.02, uv: { u: 6, v: 24 }, color: ({ t }) => tmp.copy(white).multiplyScalar(0.84 + 0.16 * smooth(0, 0.3, t)),
  });
  // 頭與喙：沿往前下方傾斜的軸放樣
  const hd = V3(0.85, -0.53, 0).normalize(), O = V3(0.415, 0.99, 0), hup = V3(0.53, 0.85, 0);
  const head = loft(spline([
    [0, 0.02, 0.02, 0.02], [0.018, 0.034, 0.036, 0.03], [0.045, 0.037, 0.04, 0.034], [0.075, 0.033, 0.036, 0.032], [0.095, 0.027, 0.031, 0.027],
    [0.112, 0.022, 0.034, 0.022], [0.128, 0.0195, 0.024, 0.018], [0.155, 0.017, 0.016, 0.012], [0.18, 0.014, 0.011, 0.009], [0.196, 0.009, 0.007, 0.006],
  ], 3).map(([h, w, top, bot]) => ({ c: O.clone().addScaledVector(hd, h), y: hd, x: V3(0, 0, 1), w, dF: top, dB: bot, n: 2.1, t: h })), {
    seg: 20, capStart: 0.012, capEnd: 0.005, uv: { u: 1, v: 1 },
    color: ({ t, sa }) => {
      if (t > 0.188) return BLACK;                                       // 喙尖
      if (t > 0.124) return tmp.copy(ORANGE).multiplyScalar(sa < -0.3 ? 0.78 : 1);
      if (t > 0.098) return BLACK;                                       // 喙基肉瘤
      if (t > 0.082 && sa < 0.35) return BLACK;                          // 眼先
      return white;
    },
    rough: ({ t }) => (t > 0.098 ? 0.35 : 0.7),
  });
  const eyes = [1, -1].map((s) => {
    const e = new THREE.SphereGeometry(0.0062, 10, 8);
    solid(e, BLACK, 0.15, null, true);
    const p = O.clone().addScaledVector(hd, 0.083).addScaledVector(hup, 0.008).add(V3(0, 0, s * 0.03));
    return e.translate(p.x, p.y, p.z);
  });
  const featherMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: T.feather.map, normalMap: T.feather.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.72 });
  const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  SWAN = { bodyGeo: mergeGeometries([body, ...wings, ...quills]), neckGeo: neck, headGeo: mergeGeometries([head, ...eyes]), featherMat, headMat, pivot: V3(0.29, 0.2, 0) };
  return SWAN;
}

function makeSwan() {
  const A = swanAssets();
  const g = new THREE.Group();
  const body = new THREE.Mesh(A.bodyGeo, A.featherMat);
  const neckGroup = new THREE.Group();
  neckGroup.position.copy(A.pivot);
  const neck = new THREE.Mesh(A.neckGeo, A.featherMat), head = new THREE.Mesh(A.headGeo, A.headMat);
  for (const m of [neck, head]) { m.position.copy(A.pivot).negate(); neckGroup.add(m); }
  g.add(body, neckGroup);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(1.15);
  g.userData.neck = neckGroup;
  return g;
}

// 水面漣漪：從天鵝、鴨子身邊擴散開的細圓環
function createRipples(scene) {
  const T = getTextures();
  const N = 90;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: T.ripple, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  const items = Array.from({ length: N }, () => ({ age: 1, life: 0 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) { mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); mesh.setColorAt(i, c.setRGB(0, 0, 0)); }
  scene.add(mesh);
  let next = 0;
  return {
    spawn(x, z, r0, r1, life, k) { Object.assign(items[next], { x, z, r0, r1, life, k, age: 0 }); next = (next + 1) % N; },
    update(dt) {
      for (let i = 0; i < N; i++) {
        const it = items[i];
        if (it.age >= it.life) { mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
        it.age += dt;
        const u = it.age / it.life, r = it.r0 + (it.r1 - it.r0) * (1 - (1 - u) * (1 - u));
        mesh.setMatrixAt(i, m.compose(p.set(it.x, 0.03, it.z), q, s.set(r * 2, 1, r * 2)));
        const a = it.k * Math.sin(Math.PI * Math.min(1, u * 4)) * (1 - u);
        mesh.setColorAt(i, c.setRGB(a, a, a));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

function makeDuck(male) {
  const g = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ color: male ? 0x8a7a66 : 0x7a5a3a, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), bodyM);
  body.scale.set(1.3, 0.6, 0.75); body.position.y = 0.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), new THREE.MeshStandardMaterial({ color: male ? 0x1f5a34 : 0x6a4a2a, roughness: 0.4 }));
  head.position.set(0.2, 0.25, 0);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9b42a }));
  beak.position.set(0.29, 0.23, 0);
  g.add(body, head, beak);
  return g;
}

function makeBird() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x2a2e33, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.25, 0, 0.9, 0.3, 0, 0.45], 3));
  wingGeo.computeVertexNormals();
  const wings = [1, -1].map((s) => {
    const w = new THREE.Mesh(wingGeo, mat);
    w.scale.z = s;
    g.add(w);
    return w;
  });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 5), mat);
  body.rotation.z = -Math.PI / 2;
  g.add(body);
  g.scale.setScalar(1.6);
  return { g, wings };
}

export function buildProps(scene, rng, piers) {
  const boats = [];
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xcdb78f, roughness: 0.95 });

  const moor = (kind, p, lx, side) => {
    const c = Math.cos(p.rot), s = Math.sin(p.rot), lz = side * 2.75;
    const x = p.x + lx * c + lz * s, z = p.z - lx * s + lz * c;
    const heading = p.rot + (rng() - 0.5) * 0.1;
    const b = createBoat(kind, rng);
    b.home = { x, z };
    Object.assign(b.state, { x, z, heading });
    scene.add(b.group);
    boats.push(b);
    // 纜繩：船首 → 碼頭木樁（自然下垂）
    const bx = x + Math.cos(heading) * b.L * 0.44, bz = z - Math.sin(heading) * b.L * 0.44;
    const plx = lx + b.L * 0.44;
    const post = new THREE.Vector3(p.x + plx * c + side * 1.4 * s, 1.05, p.z - plx * s + side * 1.4 * c);
    const bow = new THREE.Vector3(bx, 0.62, bz);
    const mid = bow.clone().lerp(post, 0.5); mid.y -= 0.35;
    b.rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(bow, mid, post), 14, 0.016, 4), ropeMat);
    scene.add(b.rope);
  };
  // 每側只停一艘，船首朝湖，出航路線不會被擋住
  piers.forEach((p, i) => {
    moor('row', p, p.len / 2 - 3.4, 1);
    moor(i === 1 ? 'electric' : 'row', p, p.len / 2 - 3.6, -1);
  });
  for (let i = 0; i < 3; i++) {
    const z = -40 + i * 90 + rng() * 20;
    const b = createBoat('row', rng);
    Object.assign(b.state, { x: shoreX(z) + 35 + rng() * 40, z, heading: rng() * Math.PI * 2 });
    scene.add(b.group);
    boats.push(b);
  }
  for (const b of boats) poseOars(b);

  const swans = [];
  for (const [z, u, r] of [[150, 22, 9], [165, 35, 6], [40, 26, 12], [-40, 30, 8], [-120, 24, 10], [200, 40, 14]]) {
    const s = makeSwan();
    scene.add(s);
    swans.push({ s, cx: shoreX(z) + u, cz: z, r, speed: 0.35 + rng() * 0.25, phase: rng() * 6.28, dir: rng() < 0.5 ? 1 : -1, ripT: rng() * 1.2, wakeT: 0 });
  }
  const ripples = createRipples(scene);
  const ducks = [];
  for (let i = 0; i < 7; i++) {
    const d = makeDuck(i % 2 === 0);
    scene.add(d);
    const z = (i < 4 ? -70 : 110) + i * 2;
    ducks.push({ d, cx: shoreX(z) + 7 + (i % 4) * 1.5, cz: z, r: 4 + (i % 3), speed: 0.3 + rng() * 0.2, phase: i * 0.9 });
  }
  const birds = [];
  for (let i = 0; i < 9; i++) {
    const b = makeBird();
    scene.add(b.g);
    birds.push({ ...b, cx: 120 + rng() * 300, cz: -200 + rng() * 400, r: 60 + rng() * 90, h: 70 + rng() * 90, speed: 7 + rng() * 4, phase: rng() * 6.28, flap: rng() * 6.28 });
  }

  const swim = (o, t, obj, y) => {
    const a = o.phase + (t * o.speed * (o.dir || 1)) / o.r;
    obj.position.set(o.cx + o.r * Math.cos(a), y, o.cz + o.r * Math.sin(a));
    const vx = -Math.sin(a) * (o.dir || 1), vz = Math.cos(a) * (o.dir || 1);
    obj.rotation.y = Math.atan2(-vz, vx);
  };

  return {
    boats,
    setGlow(v) { if (boats[0]) boats[0].lantern.material.emissiveIntensity = v; },
    update(t, dt) {
      for (const b of boats) {
        if (b.active) continue;
        bob(b, t);
        if (b.rope) b.rope.visible = !!b.home && Math.hypot(b.state.x - b.home.x, b.state.z - b.home.z) < 0.6;
      }
      for (const w of swans) {
        swim(w, t, w.s, 0.015 + Math.sin(t * 2 + w.phase) * 0.012);
        // 划水時身體輕微前後擺動；頸部緩慢轉頭、偶爾低頭
        w.s.rotation.z = Math.sin(t * 2 + w.phase) * 0.025;
        const n = w.s.userData.neck;
        n.rotation.y = Math.sin(t * 0.37 + w.phase) * 0.28 + Math.sin(t * 0.11 + w.phase * 2) * 0.15;
        n.rotation.z = Math.sin(t * 0.23 + w.phase) * 0.06 - 0.12 * Math.max(0, Math.sin(t * 0.09 + w.phase * 3)) ** 6;
        // 漣漪：身邊擴散的圓環，加上尾端的細小尾跡
        w.ripT -= dt; w.wakeT -= dt;
        if (w.ripT <= 0) { w.ripT = 1.1 + Math.random() * 0.5; ripples.spawn(w.s.position.x, w.s.position.z, 0.45, 2.6, 4.2, 0.16); }
        if (w.wakeT <= 0) {
          w.wakeT = 0.35;
          const a = w.s.rotation.y, bx = w.s.position.x - Math.cos(a) * 0.62, bz = w.s.position.z + Math.sin(a) * 0.62;
          ripples.spawn(bx, bz, 0.12, 0.9, 2.2, 0.1);
        }
      }
      for (const d of ducks) {
        swim(d, t, d.d, 0.01 + Math.sin(t * 3 + d.phase) * 0.01);
        if (Math.random() < dt * 0.6) ripples.spawn(d.d.position.x, d.d.position.z, 0.15, 1.1, 2.6, 0.12);
      }
      ripples.update(dt);
      for (const b of birds) {
        const a = b.phase + (t * b.speed) / b.r;
        b.g.position.set(b.cx + b.r * Math.cos(a), b.h + Math.sin(t * 0.5 + b.phase) * 6, b.cz + b.r * Math.sin(a));
        b.g.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
        const f = Math.sin(t * 7 + b.flap) * 0.6;
        b.wings[0].rotation.x = f; b.wings[1].rotation.x = -f;
      }
    },
  };
}
