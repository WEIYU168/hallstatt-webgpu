// Marble 高斯世界版：Spark 渲染 .spz，碰撞網格（.glb）用 BVH 光線檢測做地面與牆壁
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Player } from './player.js';

window.__appStarted = true; // 讓 splat.html 的載入監看知道程式已開始執行
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const params = new URLSearchParams(location.search);

const DEFAULTS = {
  splat: 'marble/hallstatt.spz',
  collider: 'marble/hallstatt-collider.glb',
  splatFlip: true,      // Spark 文件：OpenCV → OpenGL 座標要繞 X 轉 180°
  colliderFlip: false,  // glTF 本來就是 Y 朝上
  scale: 1,
  spawn: [0, 0, 0],
  yaw: 0,
};

async function loadConfig() {
  let cfg = { ...DEFAULTS };
  try {
    const r = await fetch('marble/world.json', { cache: 'no-store' });
    if (r.ok) cfg = { ...cfg, ...(await r.json()) };
  } catch { /* 沒有設定檔就用預設值 */ }
  if (params.has('src')) { cfg.splat = params.get('src'); cfg.collider = null; }
  return cfg;
}

const exists = async (url) => {
  if (!url) return false;
  if (/^https?:/i.test(url)) return true;
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
};

const FLIP = new THREE.Quaternion(1, 0, 0, 0);

// 與 world.js 介面相同，讓 Player 可以直接沿用
class ColliderWorld {
  constructor(mesh) {
    this.mesh = mesh;
    this.box = new THREE.Box3().setFromObject(mesh);
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  _cast(o, d, far) {
    this.ray.set(o, d); this.ray.far = far;
    return this.ray.intersectObject(this.mesh, false)[0] || null;
  }
  groundAt(x, z, feetY = Infinity) {
    const top = feetY < 900 ? feetY + 0.6 : this.box.max.y + 1;
    const h = this._cast(this._o.set(x, top, z), this._d.set(0, -1, 0), top - this.box.min.y + 1);
    return h ? h.point.y : -Infinity;
  }
  resolve(px, pz) { return [px, pz]; }
  insideAny() { return false; }
  walkable(fx, fz, tx, tz, feetY) {
    const dx = tx - fx, dz = tz - fz, d = Math.hypot(dx, dz);
    if (d > 1e-5) {
      this._d.set(dx / d, 0, dz / d);
      for (const h of [0.7, 1.4]) if (this._cast(this._o.set(fx, feetY + h, fz), this._d, d + 0.35)) return false;
    }
    const g = this.groundAt(tx, tz, feetY);
    return g > -Infinity && g - feetY <= 0.6;
  }
}

async function loadCollider(url, cfg) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  if (cfg.colliderFlip) root.quaternion.copy(FLIP);
  root.scale.setScalar(cfg.scale);
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  const geo = mergeGeometries(parts, false);
  geo.computeBoundsTree();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, transparent: true, opacity: 0.25 }));
  mesh.visible = false;
  return mesh;
}

async function main() {
  const cfg = await loadConfig();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.setSize(innerWidth, innerHeight);
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fb6cc');
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2000);
  scene.add(new SparkRenderer({ renderer }));

  if (!(await exists(cfg.splat))) {
    statusEl.innerHTML = `找不到高斯檔 <code>${cfg.splat}</code>。<br>請依 marble/README.md 的步驟，從 Marble 匯出 .spz 放進 marble/ 資料夾。`;
    $('start').textContent = '尚未有高斯世界';
    return;
  }

  statusEl.textContent = '正在下載並解析高斯潑濺…（檔案大時需要一點時間）';
  const splat = new SplatMesh({ url: cfg.splat });
  if (cfg.splatFlip) splat.quaternion.copy(FLIP);
  splat.scale.setScalar(cfg.scale);
  scene.add(splat);
  await splat.initialized;

  let world = null, collider = null;
  if (await exists(cfg.collider)) {
    statusEl.textContent = '正在載入碰撞網格…';
    collider = await loadCollider(cfg.collider, cfg);
    scene.add(collider);
    world = new ColliderWorld(collider);
  }
  let fly = !world || params.has('fly');

  const player = new Player(camera, renderer.domElement, world || { groundAt: () => -Infinity, resolve: (x, z) => [x, z], walkable: () => true });
  const [sx, sy, sz] = cfg.spawn;
  const spawn = () => {
    player.teleport(sx, sz, cfg.yaw, 0);
    const g = world ? world.groundAt(sx, sz, sy + 1) : -Infinity;
    player.pos.y = g > -Infinity ? g : sy - player.eye;
    player.syncCamera();
  };
  spawn();

  const ui = {
    _t: 0,
    toast(title, text) {
      const el = $('toast');
      el.querySelector('h3').textContent = title; el.querySelector('p').textContent = text;
      el.classList.add('show'); clearTimeout(this._t); this._t = setTimeout(() => el.classList.remove('show'), 4000);
    },
  };
  const mode = () => { $('count').textContent = fly ? '模式：飛行（穿牆）' : '模式：步行（碰撞網格）'; };
  mode();
  $('nearest').textContent = world ? '' : '未找到碰撞網格，只能飛行瀏覽';

  addEventListener('keydown', (e) => {
    if (!player.enabled) return;
    if (e.code === 'KeyG' && world) { fly = !fly; player.vel.set(0, 0, 0); if (!fly) spawn(); mode(); }
    if (e.code === 'KeyF') { splat.quaternion.premultiply(FLIP); ui.toast('翻轉高斯', '如果世界上下顛倒，按 F 切換；確定後可寫進 marble/world.json 的 splatFlip。'); }
    if (e.code === 'KeyC' && collider) collider.visible = !collider.visible;
  });

  // 飛行模式（沒有碰撞網格時）
  const _f = new THREE.Vector3(), _r = new THREE.Vector3();
  function flyUpdate(dt) {
    const k = player.keys;
    if (k.ArrowLeft) player.look(-1.8 * dt, 0);
    if (k.ArrowRight) player.look(1.8 * dt, 0);
    if (k.ArrowUp) player.look(0, -1.2 * dt);
    if (k.ArrowDown) player.look(0, 1.2 * dt);
    if (!player.enabled) return;
    camera.getWorldDirection(_f);
    _r.crossVectors(_f, camera.up).normalize();
    const v = (k.ShiftLeft || k.ShiftRight ? 6 : 1.6) * dt;
    if (k.KeyW) camera.position.addScaledVector(_f, v);
    if (k.KeyS) camera.position.addScaledVector(_f, -v);
    if (k.KeyD) camera.position.addScaledVector(_r, v);
    if (k.KeyA) camera.position.addScaledVector(_r, -v);
    if (k.Space) camera.position.y += v;
    if (k.ControlLeft || k.ControlRight) camera.position.y -= v;
    player.pos.set(camera.position.x, camera.position.y - player.eye, camera.position.z);
  }

  const overlay = $('overlay'), startBtn = $('start');
  const showHud = (on) => ['hud', 'crosshair', 'info', 'help'].forEach((id) => $(id).classList.toggle('hidden', !on));
  startBtn.disabled = false; startBtn.textContent = '進入高斯世界';
  statusEl.textContent = world ? '高斯世界與碰撞網格已載入' : '高斯世界已載入（無碰撞網格，飛行模式）';
  const begin = () => { overlay.classList.add('hidden'); player.enabled = true; showHud(true); };
  startBtn.addEventListener('click', () => { begin(); try { player.controls.lock(); } catch { /* 拖曳後備 */ } });
  if (params.has('autostart')) begin();
  player.controls.addEventListener('unlock', () => {
    overlay.classList.remove('hidden'); overlay.classList.add('paused'); startBtn.textContent = '繼續'; player.enabled = false;
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });

  let last = performance.now(), frames = 0, fpsT = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (fly) flyUpdate(dt);
    else {
      player.update(dt);
      if (world && player.pos.y < world.box.min.y - 20) spawn(); // 掉出世界就回到出生點
    }
    renderer.render(scene, camera);
    frames++; fpsT += dt;
    if (fpsT > 0.5) { $('fps').textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
  });

  window.game = { THREE, scene, camera, renderer, player, splat, world };
}

main().catch((e) => { console.error(e); statusEl.textContent = `載入失敗：${e.message}`; });
