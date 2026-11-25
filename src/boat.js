// 木船：以斷面放樣的曲面船身（船首翹起、平底、木板條紋、彩繪舷緣）、肋骨、座板、船槳（握把、皮套、槳架）、船燈；
// 船身內部有一片只寫深度的「擋水蓋」，湖面不會再從船底透出來。
// 乘船遊湖：划槳木船上有綁骨架的船夫（human.js）面向船尾划槳、槳葉入水時立槳並濺起水花；
// 電動船由船尾的駕駛握舵柄操控。V 切換第三人稱／乘客座位視角。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTextures } from './textures.js';
import { heightAt, gradientAt } from './terrain.js';
import { Human } from './human.js';

const sat = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function hullShape(o) {
  const { L, W, D, bowRise, sternRise } = o;
  const half = (s) => (s < 0.45 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (s / 0.45)) : Math.pow(Math.max(0, 1 - Math.pow((s - 0.45) / 0.55, 2.2)), 0.62));
  return {
    L, W,
    x: (s) => (s - 0.5) * L,
    b: (s) => (W / 2) * half(s),
    top: (s) => 0.3 + bowRise * Math.pow(smooth(0.55, 1, s), 1.7) + sternRise * (1 - smooth(0, 0.28, s)),
    bot: (s) => 0.3 - D * (1 - 0.7 * smooth(0.62, 1, s)) * (0.85 + 0.15 * smooth(0, 0.3, s)),
  };
}
// 斷面上的點：g = 0（左舷緣）→ 0.5（龍骨）→ 1（右舷緣）
function sectionPoint(H, s, g, inset = 0) {
  const phi = (g - 0.5) * Math.PI, sp = Math.sin(phi), cp = Math.abs(Math.cos(phi));
  const b = Math.max(0, H.b(s) - inset), top = H.top(s), bot = H.bot(s) + inset;
  return new THREE.Vector3(H.x(s), bot + (top - bot) * (1 - Math.pow(cp, 2.2)), b * Math.sign(sp) * Math.pow(Math.abs(sp), 0.72));
}

function hullGeometry(H, paint, wood) {
  const ns = 28, ng = 14, pos = [], uv = [], col = [], idx = [];
  const P = new THREE.Color(paint), Wd = new THREE.Color(wood), K = new THREE.Color('#2b2724');
  for (let i = 0; i <= ns; i++) {
    const s = i / ns;
    let girth = 0, prev = null;
    for (let j = 0; j <= ng; j++) {
      const g = j / ng, p = sectionPoint(H, s, g);
      if (prev) girth += Math.hypot(p.y - prev.y, p.z - prev.z);
      prev = p;
      pos.push(p.x, p.y, p.z); uv.push(girth, p.x);
      const c = g < 0.1 || g > 0.9 ? P : Math.abs(g - 0.5) < 0.15 ? K : Wd;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < ns; i++) for (let j = 0; j < ng; j++) {
    const a = i * (ng + 1) + j, b = a + 1, c = a + ng + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 船尾板
  const shape = new THREE.Shape();
  for (let j = 0; j <= ng; j++) { const p = sectionPoint(H, 0, j / ng); if (j) shape.lineTo(p.z, p.y); else shape.moveTo(p.z, p.y); }
  shape.closePath();
  const tr = new THREE.ShapeGeometry(shape);
  tr.rotateY(-Math.PI / 2);
  tr.translate(H.x(0), 0, 0);
  const n = tr.attributes.position.count, tc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { tc[i * 3] = Wd.r * 0.8; tc[i * 3 + 1] = Wd.g * 0.8; tc[i * 3 + 2] = Wd.b * 0.8; }
  tr.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  return mergeGeometries([g, tr]);
}

// 擋水蓋：連接左右舷緣的曲面，只寫入深度、不畫顏色，並在湖水之前繪製 → 船內看不到水面
function waterMaskGeometry(H) {
  const ns = 32, pos = [], idx = [];
  for (let i = 0; i <= ns; i++) {
    const s = i / ns, a = sectionPoint(H, s, 0), b = sectionPoint(H, s, 1);
    pos.push(a.x, a.y - 0.012, a.z * 0.985, b.x, b.y - 0.012, b.z * 0.985);
    if (i < ns) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const T = getTextures();
  MATS = {
    hull: new THREE.MeshStandardMaterial({ vertexColors: true, map: T.wood.map, normalMap: T.wood.normalMap, roughness: 0.5, side: THREE.DoubleSide }),
    rail: new THREE.MeshStandardMaterial({ color: 0x5a3a22, map: T.wood.map, roughness: 0.45 }),
    inner: new THREE.MeshStandardMaterial({ color: 0x9a6a42, map: T.wood.map, roughness: 0.7 }),
    grip: new THREE.MeshStandardMaterial({ color: 0xc9a274, roughness: 0.55 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3a281c, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.35, metalness: 0.8 }),
    canopy: new THREE.MeshStandardMaterial({ map: T.stripes, roughness: 0.8, side: THREE.DoubleSide }),
    lantern: new THREE.MeshStandardMaterial({ color: 0x332a1e, emissive: 0xffb35c, emissiveIntensity: 0, roughness: 0.3 }),
    rope: new THREE.MeshStandardMaterial({ color: 0xcdb78f, roughness: 0.95 }),
    mask: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide }),
  };
  return MATS;
}

// 船槳：細握把（-0.66～-0.36）、槳身、槳架處的皮套、槳葉（槳的局部 +Z 朝舷外）
function makeOar(M) {
  const g = new THREE.Group();
  const add = (geo, mat, z) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.z = z; m.castShadow = true; g.add(m); };
  add(new THREE.CylinderGeometry(0.017, 0.017, 0.3, 8), M.grip, -0.51);
  add(new THREE.CylinderGeometry(0.022, 0.026, 1.95, 8), M.rail, 0.6);
  add(new THREE.CylinderGeometry(0.031, 0.031, 0.3, 8), M.leather, 0.06);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.018, 0.55), M.inner);
  blade.position.z = 1.85; blade.castShadow = true;
  g.add(blade);
  return g;
}

const PALETTES = [['#2f5d4a', '#a8743f'], ['#f2eee4', '#9a6a3f'], ['#2c4a6b', '#b07a46'], ['#8e2f2a', '#a26f3e'], ['#1f3b33', '#c08a52']];

/** kind: 'row'（划槳木船）或 'electric'（遮陽棚電動船） */
export function createBoat(kind, rng) {
  const M = mats();
  const electric = kind === 'electric';
  const [paint, wood] = PALETTES[Math.floor(rng() * PALETTES.length)];
  const H = hullShape(electric
    ? { L: 5.6, W: 1.75, D: 0.62, bowRise: 0.28, sternRise: 0.12 }
    : { L: 5.0, W: 1.4, D: 0.58, bowRise: 0.42, sternRise: 0.16 });
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  const hull = new THREE.Mesh(hullGeometry(H, paint, wood), M.hull);
  hull.castShadow = true; hull.receiveShadow = true;
  group.add(hull);
  const mask = new THREE.Mesh(waterMaskGeometry(H), M.mask);
  mask.renderOrder = 0.5;
  group.add(mask);
  // 舷緣扶手
  for (const g of [0, 1]) {
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push(sectionPoint(H, i / 20, g).add(new THREE.Vector3(0, 0.015, 0)));
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 5), M.rail);
    rail.castShadow = true;
    group.add(rail);
  }
  // 船內肋骨
  for (let s = 0.18; s < 0.85; s += 0.11) {
    const pts = [];
    for (let j = 1; j < 12; j++) pts.push(sectionPoint(H, s, j / 12, 0.025));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.016, 4), M.inner));
  }
  // 座板（划槳船：船尾乘客座、划槳座、船首座；電動船：船尾駕駛座、兩排乘客座）與底板
  const seats = electric ? [0.12, 0.42, 0.68] : [0.24, 0.616, 0.84];
  const seatTop = (s) => H.top(s) - 0.15 + 0.0225;
  for (const s of seats) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, H.b(s) * 2 - 0.05), M.inner);
    seat.position.set(H.x(s), H.top(s) - 0.15, 0);
    seat.castShadow = true; seat.receiveShadow = true;
    group.add(seat);
  }
  const floorTop = H.bot(0.5) + 0.11 + 0.015;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(H.L * 0.62, 0.03, H.b(0.5) * 0.9), M.inner);
  floor.position.set(H.x(0.48), H.bot(0.5) + 0.11, 0);
  floor.receiveShadow = true;
  group.add(floor);
  // 船首燈
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5), M.metal);
  const lx = H.x(0.9);
  post.position.set(lx, H.top(0.9) + 0.18, 0);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), M.lantern);
  lantern.position.set(lx, H.top(0.9) + 0.42, 0);
  group.add(post, lantern);

  let oars = null, tiller = null, crew, passenger;
  if (electric) {
    // 遮陽棚、舷外馬達與舵柄
    for (const [s, z] of [[0.28, 1], [0.28, -1], [0.7, 1], [0.7, -1]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.25, 5), M.metal);
      p.position.set(H.x(s), H.top(s) + 0.6, z * (H.b(s) - 0.08));
      group.add(p);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.04, 1.75), M.canopy);
    roof.position.set(H.x(0.49), H.top(0.49) + 1.24, 0);
    roof.castShadow = true;
    const valance = new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.16, 1.77), M.canopy);
    valance.position.copy(roof.position).add(new THREE.Vector3(0, -0.08, 0));
    group.add(roof, valance);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.22), M.metal);
    motor.position.set(H.x(0) - 0.12, H.top(0) + 0.05, 0);
    group.add(motor);
    const pivot = new THREE.Group();
    pivot.position.set(H.x(0) - 0.12, H.top(0) + 0.2, 0);
    const arm = new THREE.Group();
    arm.rotation.z = -0.075;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.9, 8), M.metal);
    bar.rotation.z = -Math.PI / 2; bar.position.x = 0.45; bar.castShadow = true;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10), M.leather);
    grip.rotation.z = -Math.PI / 2; grip.position.x = 0.96; grip.castShadow = true;
    const gripPoint = new THREE.Object3D();
    gripPoint.position.x = 0.97;
    arm.add(bar, grip, gripPoint);
    pivot.add(arm);
    group.add(pivot);
    tiller = { pivot, grip: gripPoint, base: -0.27 };
    pivot.rotation.y = tiller.base;
    crew = { x: H.x(0.12) + 0.06, y: seatTop(0.12), facing: 1, floor: floorTop };
    passenger = { x: H.x(0.42), y: seatTop(0.42) };
  } else {
    oars = [];
    const s = 0.52, ox = H.x(s), oy = H.top(s) + 0.04;
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(ox, oy, side * (H.b(s) + 0.02));
      pivot.rotation.order = 'YXZ';
      pivot.add(makeOar(M));
      group.add(pivot);
      oars.push({ pivot, side });
      // 黃銅槳架
      const lock = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.007, 6, 12, Math.PI), M.brass);
      lock.position.set(ox, oy - 0.005, side * (H.b(s) + 0.02));
      lock.rotation.y = Math.PI / 2;
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 6), M.brass);
      pin.position.set(ox, oy - 0.07, side * (H.b(s) + 0.02));
      group.add(lock, pin);
    }
    crew = { x: H.x(0.616) - 0.06, y: seatTop(0.616), facing: -1, floor: floorTop };
    passenger = { x: H.x(0.24), y: seatTop(0.24) };
  }
  return {
    kind, group, H, L: H.L, W: H.W, oars, tiller, lantern, crew, passenger,
    state: { x: 0, z: 0, heading: 0, v: 0, phase: 0, row: 0, steer: 0 },
    home: null, rope: null, active: false, sweep: 0,
  };
}

/** 船槳姿勢：row = 0（收槳）～ 1（划行）。有人划時：入水時立槳、回槳時平槳；無人時槳收在船舷 */
export function poseOars(b) {
  if (!b.oars) return;
  const st = b.state, manned = b.active;
  const s = Math.sin(st.phase), c = Math.cos(st.phase);
  const rest = manned ? 0.12 : 1.05;
  const back = s * 0.45 * st.row + rest * (1 - st.row);
  const tilt = (0.16 + c * 0.12) * st.row + 0.2 * (1 - st.row);
  const feather = manned ? (Math.PI / 2) * smooth(-0.35, 0.15, c) * st.row : 0;
  for (const { pivot, side } of b.oars) {
    // 槳的本地 +Z 朝舷外；back > 0 時槳葉往船尾擺（划水），< 0 往船首（入水點）
    pivot.rotation.y = side > 0 ? -back : Math.PI + back;
    pivot.rotation.x = tilt;
    pivot.rotation.z = feather;
  }
  b.sweep = back;
}

/** 停泊時隨波起伏 */
export function bob(b, t) {
  const st = b.state, ph = st.x * 0.13 + st.z * 0.07;
  b.group.position.set(st.x, 0.06 + Math.sin(t * 1.3 + ph) * 0.035, st.z);
  b.group.rotation.y = st.heading;
  b.group.rotation.x = Math.sin(t * 0.9 + ph) * 0.025;
  b.group.rotation.z = Math.sin(t * 1.1 + ph * 2) * 0.015;
}

// 航跡浪花
function createWake(scene) {
  const T = getTextures();
  const N = 140;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: T.foam, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  const items = Array.from({ length: N }, () => ({ life: 0, age: 1, x: 0, z: 0, size: 1, rot: 0, vx: 0, vz: 0, k: 0.5 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let next = 0;
  for (let i = 0; i < N; i++) { mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); mesh.setColorAt(i, c.setRGB(0, 0, 0)); }
  scene.add(mesh);
  return {
    spawn(x, z, size, vx, vz, strength = 0.5, life = 2.6) {
      const it = items[next]; next = (next + 1) % N;
      Object.assign(it, { life: life + Math.random(), age: 0, x, z, size, rot: Math.random() * 6.28, vx, vz, k: strength });
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        const it = items[i];
        if (it.age >= it.life) { mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
        it.age += dt; it.x += it.vx * dt; it.z += it.vz * dt;
        const k = it.age / it.life, sc = it.size * (1 + k * 2.2);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.rot + k);
        mesh.setMatrixAt(i, m.compose(p.set(it.x, 0.05, it.z), q, s.set(sc, 1, sc)));
        const a = (1 - k) * (1 - k) * it.k;
        mesh.setColorAt(i, c.setRGB(a, a, a));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

const _dir = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();

export class BoatRide {
  constructor({ scene, camera, player, world, boats, ui }) {
    Object.assign(this, { scene, camera, player, world, boats, ui });
    this.active = null;
    this.mode = 'third';
    this.wake = createWake(scene);
    this.spawnT = 0;
    this.bump = 0;
    this.human = null;
    this.prevC = 0;
  }

  nearestBoat(pos, maxDist = 4.2) {
    let best = null, bd = maxDist;
    for (const b of this.boats) {
      const d = Math.hypot(b.state.x - pos.x, b.state.z - pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  board(b) {
    this.active = b; b.active = true;
    b.state.v = 0;
    if (b.rope) b.rope.visible = false;
    if (!this.human) this.human = new Human();
    this.human.seat(b.group, b.crew.x, b.crew.y, b.crew.facing, b.crew.floor);
    poseOars(b);
    _e.set(-0.2, b.state.heading - Math.PI / 2, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_e);
    this.ui.toast(b.kind === 'electric' ? '⛵ 電動船' : '🚣 划槳木船',
      'W／S 前進後退 · A／D 轉向 · Shift 加速 · V 切換第三人稱／乘客座位視角 · 靠近碼頭或岸邊按 E 下船');
  }

  // 尋找船邊可以站上去的地面或碼頭
  _landingSpot() {
    const st = this.active.state, W = this.world;
    let best = null, bd = Infinity;
    for (const r of [1.8, 2.6, 3.4, 4.2]) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r;
      const onPier = W.platformAt(x, z, 999) > -Infinity;
      const ok = onPier || (heightAt(x, z) > 0.35 && gradientAt(x, z) < 0.8 && !W.insideAny(x, z, 0.4));
      if (ok && r < bd) { bd = r; best = { x, z }; }
    }
    return best;
  }

  disembark() {
    const spot = this._landingSpot();
    if (!spot) { this.ui.toast('還不能下船', '把船靠近碼頭或岸邊（2～4 公尺內）再按 E。'); return false; }
    const b = this.active;
    b.state.v = 0; b.state.row = 0; b.active = false;
    poseOars(b);
    if (b.tiller) b.tiller.pivot.rotation.y = b.tiller.base;
    if (this.human) this.human.leave();
    this.active = null;
    _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.player.teleport(spot.x, spot.z, _e.y, 0);
    return true;
  }

  // 船身四周是否有足夠水深、沒有撞到碼頭／房屋
  _free(x, z, h, b) {
    const c = Math.cos(h), s = Math.sin(h), hl = b.L * 0.46, hw = b.W * 0.48;
    for (const [lx, lz] of [[hl, 0], [-hl, 0], [0, hw], [0, -hw], [hl * 0.6, hw * 0.7], [hl * 0.6, -hw * 0.7]]) {
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      if (heightAt(px, pz) > -0.32) return false;
      if (this.world.boatBlocked(px, pz)) return false;
      if (Math.abs(pz) > 2600 || px > 1500) return false;
    }
    for (const o of this.boats) {
      if (o === b) continue;
      if (Math.hypot(o.state.x - x, o.state.z - z) < (o.L + b.L) * 0.32) return false;
    }
    return true;
  }

  toggleView() { this.mode = this.mode === 'third' ? 'first' : 'third'; }

  update(dt, t, enabled) {
    this.wake.update(dt);
    const b = this.active;
    if (!b) return;
    const st = b.state, k = this.player.keys;
    this.player.lookKeys(dt);
    const thr = enabled ? (k.KeyW ? 1 : 0) - (k.KeyS ? 0.6 : 0) : 0;
    const steer = enabled ? (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0) : 0;
    const boost = enabled && (k.ShiftLeft || k.ShiftRight) ? 1.75 : 1;
    const accel = thr * (b.kind === 'electric' ? 2.2 : 1.9) * boost;
    st.v += (accel - st.v * 0.5 - Math.sign(st.v) * st.v * st.v * 0.06) * dt;
    st.steer += (steer - st.steer) * Math.min(1, dt * 4);
    const turn = 0.85 * (0.3 + 0.7 * Math.min(1, Math.abs(st.v) / 2.4));
    const nh = st.heading + st.steer * turn * dt * (st.v < -0.05 ? -1 : 1);
    const nx = st.x + Math.cos(nh) * st.v * dt, nz = st.z - Math.sin(nh) * st.v * dt;
    if (this._free(nx, nz, nh, b)) { st.x = nx; st.z = nz; st.heading = nh; }
    else if (this._free(st.x, st.z, nh, b)) { st.heading = nh; st.v *= -0.3; this.bump = 0.25; }
    else { st.v *= -0.3; this.bump = 0.25; }
    this.bump = Math.max(0, this.bump - dt);

    // 划槳節奏（電動船則轉動舵柄：往右推舵柄船往左轉）
    st.row += ((Math.abs(thr) > 0 ? 1 : 0) - st.row) * Math.min(1, dt * 3);
    st.phase += dt * (2.2 + Math.abs(st.v) * 0.9) * (thr < 0 ? -1 : 1) * st.row;
    poseOars(b);
    if (b.tiller) b.tiller.pivot.rotation.y = b.tiller.base - st.steer * 0.28;

    // 姿態：隨波起伏、轉彎傾斜、加速抬頭
    const ph = t * 1.3;
    b.group.position.set(st.x, 0.06 + Math.sin(ph) * 0.03 + Math.sin(this.bump * 40) * this.bump * 0.1, st.z);
    b.group.rotation.y = st.heading;
    b.group.rotation.x = Math.sin(t * 0.9) * 0.02 - st.steer * st.v * 0.012;
    b.group.rotation.z = Math.sin(t * 1.1) * 0.012 + accel * 0.006;
    b.group.updateMatrixWorld(true);

    // 船上的人
    if (this.human) {
      if (b.oars) this.human.row(dt, t, b); else this.human.drive(dt, t, b);
    }

    // 槳葉入水（立槳的瞬間）與出水時濺起水花
    if (b.oars) {
      const c = Math.cos(st.phase);
      const catchNow = st.row > 0.5 && ((this.prevC <= 0 && c > 0) || (this.prevC >= 0 && c < 0));
      this.prevC = c;
      for (const { pivot } of b.oars) {
        pivot.localToWorld(_v.set(0, 0, 1.85));
        if (catchNow) for (let i = 0; i < 3; i++) this.wake.spawn(_v.x + (Math.random() - 0.5) * 0.3, _v.z + (Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.2, 0, 0, 0.75, 1.6);
        else if (st.row > 0.5 && c > 0.3 && Math.random() < dt * 9) this.wake.spawn(_v.x, _v.z, 0.18, 0, 0, 0.35, 1.2);
      }
    }

    // 航跡
    this.spawnT -= dt;
    if (Math.abs(st.v) > 0.5 && this.spawnT <= 0) {
      this.spawnT = 0.07;
      const c = Math.cos(st.heading), s = Math.sin(st.heading), back = -b.L * 0.5 * Math.sign(st.v);
      const side = (Math.random() - 0.5) * b.W * 0.8;
      this.wake.spawn(st.x + back * c + side * s, st.z - back * s + side * c, 0.5 + Math.abs(st.v) * 0.25, s * side * 0.3, c * side * 0.3);
      if (Math.random() < 0.5) { // 船首浪
        const fx = st.x + b.L * 0.45 * c, fz = st.z - b.L * 0.45 * s, sd = (Math.random() < 0.5 ? 1 : -1);
        this.wake.spawn(fx + sd * s * 0.6, fz + sd * c * 0.6, 0.35, sd * s * 0.9, sd * c * 0.9);
      }
    }

    // 鏡頭：第三人稱繞著船；或坐在乘客座位上（划槳船看著船夫面對你划槳）
    const cam = this.camera;
    if (this.mode === 'third') {
      cam.getWorldDirection(_dir);
      cam.position.set(st.x, 1.6, st.z).addScaledVector(_dir, b.kind === 'electric' ? -8.5 : -7);
      cam.position.y = Math.max(cam.position.y, 0.75, heightAt(cam.position.x, cam.position.z) + 0.8);
    } else {
      cam.position.copy(b.group.localToWorld(_v.set(b.passenger.x, b.passenger.y + 0.78, 0)));
    }
    this.player.pos.set(st.x, 0.3, st.z); // 讓任務與陰影跟著船走
  }
}
