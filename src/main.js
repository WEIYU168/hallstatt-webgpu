import * as THREE from 'three';
import { pass, screenUV, screenSize, float, vec2, vec4, min, max, clamp, uniform, saturation } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { buildTerrain, buildForest, mulberry32, shoreX, roadU, heightAt, causticStrength, causticColor, bakeContactShadows } from './terrain.js';
import { buildVillage } from './village.js';
import { buildGrass, wind } from './vegetation.js';
import { buildWater } from './water.js';
import { buildProps } from './props.js';
import { buildSky } from './sky.js';
import { buildWaterfall, buildSmoke } from './decor.js';
import { BoatRide } from './boat.js';
import { prepareTextures } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Quest } from './quest.js';
import { Postcards } from './postcard.js';
import { SPOT_DATA } from './spots.js';
import { createMusic } from './music.js';

window.__appStarted = true; // 讓 index.html 的載入監看知道程式已開始執行
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
// 讓出主執行緒，讓進度文字有機會畫出來。視窗被遮住或縮小時 requestAnimationFrame 會停住，
// 所以同時設一個短計時器當保險，兩者先到先走，載入不會卡死。
const tick = () => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(fin, 0));
  setTimeout(fin, 30);
});
// 記錄每個載入階段花的時間（主控台 console.table 可看）
let stageName = '初始化 WebGPU', stageStart = performance.now();
const loadTimes = [{ 階段: '開啟頁面到程式開始執行（下載、編譯程式庫）', 秒: +(stageStart / 1000).toFixed(2) }];
const markStage = (next) => {
  const now = performance.now();
  loadTimes.push({ 階段: stageName, 秒: +((now - stageStart) / 1000).toFixed(2) });
  stageName = next; stageStart = now;
};
const setStatus = async (msg) => { markStage(msg); statusEl.textContent = msg; await tick(); };

// 時段設定：光線、霧（帶青綠的空氣感）、湖色、雲、霧帶、炊煙、水波光紋……
// cloudCov／cirrusCov：雲量門檻（越小雲越多）、cirrus：卷雲濃度、bank：山腰雲霧帶濃度
const TIMES = [
  { name: '清晨', elev: 13, az: 105, sun: '#ffd3a1', si: 3.0, sky: '#a9c4e8', ground: '#5d6a4a', hi: 0.8, env: 0.7, fog: '#bcd3d7', dens: 0.00021, exp: 0.6,
    glow: 0, turb: 2.6, ray: 1.6, mie: 0.003, shallow: '#56c4b4', deep: '#0e5266', glint: 1.3, bloom: 0.03,
    cloudLit: '#fff3e4', cloudShade: '#a3b0c2', cloudCov: 0.35, cirrusCov: 0.5, cirrus: 0.7, cloudAlpha: 0.92, bank: 0.38,
    mist: 0.18, smoke: '#e9e6e2', smokeAlpha: 0.35, caustic: 0.35, wind: 0.7, fall: '#e8f0f0' },
  { name: '正午', elev: 50, az: 165, sun: '#fff3e2', si: 3.3, sky: '#b4cdee', ground: '#65724e', hi: 0.85, env: 0.8, fog: '#b6cdd9', dens: 0.00017, exp: 0.55,
    glow: 0, turb: 2.0, ray: 1.25, mie: 0.0025, shallow: '#4ccbb8', deep: '#0b566c', glint: 1.6, bloom: 0.02,
    cloudLit: '#ffffff', cloudShade: '#9cafc5', cloudCov: 0.37, cirrusCov: 0.52, cirrus: 0.75, cloudAlpha: 0.95, bank: 0.14,
    mist: 0, smoke: '#f0f0f0', smokeAlpha: 0.18, caustic: 0.7, wind: 1.0, fall: '#ffffff' },
  { name: '黃昏', elev: 4, az: 250, sun: '#ff9c5a', si: 2.1, sky: '#8f9fc8', ground: '#5a4a40', hi: 0.6, env: 0.6, fog: '#d6ae95', dens: 0.00026, exp: 0.65,
    glow: 1.0, turb: 6, ray: 2.6, mie: 0.005, shallow: '#6aa59a', deep: '#183f4e', glint: 1.5, bloom: 0.14,
    cloudLit: '#ffc49a', cloudShade: '#8a7f96', cloudCov: 0.35, cirrusCov: 0.48, cirrus: 0.85, cloudAlpha: 0.95, bank: 0.26,
    mist: 0.15, smoke: '#d9c6b8', smokeAlpha: 0.3, caustic: 0.25, wind: 0.8, fall: '#ffd9bf' },
  { name: '夜晚', elev: -12, az: 250, moon: { elev: 38, az: 200 }, sun: '#a9bfff', si: 0.6, sky: '#30457a', ground: '#10141c', hi: 0.55, env: 0.0, fog: '#0d172a', dens: 0.0003, exp: 1.0,
    glow: 3.2, turb: 2, ray: 0.5, shallow: '#123438', deep: '#03121a', glint: 0.5, bloom: 0.55,
    cloudLit: '#3a465e', cloudShade: '#1a2232', cloudCov: 0.4, cirrusCov: 0.58, cirrus: 0.4, cloudAlpha: 0.6, bank: 0.18,
    mist: 0.25, smoke: '#5a6070', smokeAlpha: 0.25, caustic: 0.0, wind: 0.6, fall: '#56627a' },
];
const dirFrom = (elev, az, out = new THREE.Vector3()) => {
  const e = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
};

const ui = {
  count: (n, t) => { $('count').textContent = `明信片 ${n} / ${t}`; },
  nearest: (s) => { $('nearest').textContent = s; },
  _timer: 0,
  toast(title, text) {
    const el = $('toast');
    el.querySelector('h3').textContent = title;
    el.querySelector('p').textContent = text;
    el.classList.add('show');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => el.classList.remove('show'), 6500);
  },
};

async function main() {
  const texturesReady = prepareTextures(); // 一開始就在背景執行緒產生材質，和 WebGPU 初始化同時進行
  if (!navigator.gpu) await setStatus('此瀏覽器不支援 WebGPU，改用 WebGL 2 後備模式…');
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  // 以螢幕原生像素比渲染（Windows 縮放 125% 時就是 1.25），畫面才不會被放大而變糊
  const DPR = Math.min(devicePixelRatio || 1, 2);
  let pixelRatio = DPR;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('app').appendChild(renderer.domElement);
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2（後備）';
  $('backend').textContent = backend;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbcd3d7, 0.0003);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 40000);

  await setStatus('正在產生材質…');
  await texturesReady;

  // 天空、環境光、太陽
  const sky = new SkyMesh();
  sky.scale.setScalar(20000);
  sky.material.fog = false;
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xbcd4f0, 0x556240, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  let pmrem = null, envRT = null;
  const envScene = new THREE.Scene(), envSky = new SkyMesh();
  envSky.scale.setScalar(50);
  envScene.add(envSky);
  try { pmrem = new THREE.PMREMGenerator(renderer); } catch (e) { console.warn('PMREM 不可用', e); }

  const rng = mulberry32(20261124);
  const world = new World();

  await setStatus('正在生成青綠色的山巒與湖岸…');
  const terrain = buildTerrain();
  scene.add(terrain);
  await setStatus('正在種植雲杉林…');
  scene.add(buildForest(rng));
  await setStatus('正在搭建木屋、教堂、石板路與花箱…');
  const village = buildVillage(scene, world, rng);
  bakeContactShadows(terrain, world.colliders);
  await setStatus('正在長出草地、野花、蘆葦與卵石…');
  buildGrass(scene, world, rng);
  await setStatus('正在注入清澈的湖水、放下小船…');
  const water = buildWater(scene);
  const props = buildProps(scene, rng, village.piers);
  await setStatus('正在佈置雲朵、晨霧、瀑布與炊煙…');
  const skyFx = buildSky(scene, mulberry32(7));
  const waterfall = buildWaterfall(scene);
  const smoke = buildSmoke(scene, village.chimneys, mulberry32(3));

  // 景點：明信片位置與構圖鏡頭
  const at = (z, u, dy) => { const x = shoreX(z) - u; return new THREE.Vector3(x, Math.max(heightAt(x, z), 0) + dy, z); };
  const spots = SPOT_DATA.map((s, i) => ({
    ...s, i, x: shoreX(s.z) - s.u,
    art: { from: at(...s.art.from), to: at(...s.art.to), fov: s.art.fov },
  }));

  const player = new Player(camera, renderer.domElement, world);
  const startZ = -300;
  player.teleport(shoreX(startZ) - roadU(startZ), startZ, Math.PI - 0.12, -0.04);
  const ride = new BoatRide({ scene, camera, player, world, boats: props.boats, ui });

  // 後製與畫質：保持原生解析度，用 MSAA 或 SMAA 抗鋸齒，再做局部銳化讓材質細節更清楚。
  // 效能不足時依序降級：MSAA → SMAA → 解析度 0.9 → 0.8（最低 0.85 倍 CSS 像素），不再把畫面降到一半而變糊。
  const PP = THREE.PostProcessing || THREE.RenderPipeline;
  const sharpness = uniform(0.35);
  const bloomNodes = [];
  let currentBloom = 0.03;
  function buildPipeline(aa) {
    const pp = new PP(renderer);
    const scenePass = pass(scene, camera, { samples: aa === 'msaa' ? 4 : 0 });
    const tex = scenePass.getTextureNode('output');
    // 局部銳化（unsharp mask，夾在鄰近像素的最小／最大值之間，不會產生白邊）
    const texel = vec2(1).div(screenSize);
    const c = tex.sample(screenUV);
    const n = tex.sample(screenUV.add(vec2(0, texel.y))), so = tex.sample(screenUV.sub(vec2(0, texel.y)));
    const e = tex.sample(screenUV.add(vec2(texel.x, 0))), w = tex.sample(screenUV.sub(vec2(texel.x, 0)));
    const lo = min(c, min(min(n, so), min(e, w))), hi = max(c, max(max(n, so), max(e, w)));
    const sharp = clamp(c.add(c.sub(n.add(so).add(e).add(w).mul(0.25)).mul(sharpness)), lo, hi);
    const bl = bloom(tex, currentBloom, 0.3, 1.0);
    bloomNodes.push(bl);
    const vignette = float(1).sub(screenUV.sub(0.5).length().pow(2).mul(0.6));
    // 輕微提高飽和度，讓灰泥牆的鵝黃、鮭魚橘、薄荷綠與花箱更接近實景照片
    const graded = vec4(saturation(sharp.add(bl).rgb, 1.12).mul(vignette), 1);
    pp.outputNode = aa === 'msaa' ? graded : smaa(graded);
    return pp;
  }
  const pipelines = {};
  const LEVELS = [
    { name: '極致', aa: 'msaa', scale: 1.0, sharp: 0.3 },
    { name: '高', aa: 'smaa', scale: 1.0, sharp: 0.35 },
    { name: '中', aa: 'smaa', scale: 0.9, sharp: 0.5 },
    { name: '省電', aa: 'smaa', scale: 0.8, sharp: 0.6 },
  ];
  let level = 1, autoQuality = true, post = null;
  function applyLevel(i) {
    level = Math.max(0, Math.min(LEVELS.length - 1, i));
    const L = LEVELS[level];
    try { post = pipelines[L.aa] || (pipelines[L.aa] = buildPipeline(L.aa)); } catch (err) { console.warn('後製不可用，改用直接渲染', err); post = null; }
    pixelRatio = Math.max(0.85, DPR * L.scale);
    renderer.setPixelRatio(pixelRatio);
    sharpness.value = L.sharp;
    $('quality').textContent = `${L.name}${autoQuality ? '（自動）' : ''}`;
  }
  const renderFrame = () => { if (post) post.render(); else renderer.render(scene, camera); };

  // 時段切換
  let timeIdx = 0;
  const sunDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
  function applyTime(i) {
    timeIdx = (i + TIMES.length) % TIMES.length;
    const t = TIMES[timeIdx];
    dirFrom(t.elev, t.az, sunDir);
    if (t.moon) dirFrom(t.moon.elev, t.moon.az, lightDir); else lightDir.copy(sunDir);
    for (const s of [sky, envSky]) {
      s.sunPosition.value.copy(sunDir);
      s.turbidity.value = t.turb;
      s.rayleigh.value = t.ray;
      s.mieCoefficient.value = t.mie ?? 0.005;
    }
    sky.visible = !t.moon;
    scene.background = t.moon ? new THREE.Color('#070d1a') : null;
    sun.color.set(t.sun); sun.intensity = t.si;
    hemi.color.set(t.sky); hemi.groundColor.set(t.ground); hemi.intensity = t.hi;
    scene.fog.color.set(t.fog); scene.fog.density = t.dens;
    renderer.toneMappingExposure = t.exp;
    village.winLitMat.emissiveIntensity = t.glow;
    props.setGlow(t.glow * 1.2);
    water.set({ shallowColor: t.shallow, deepColor: t.deep, sun: lightDir, sunCol: t.sun, glintAmount: t.glint });
    skyFx.setTime(t, lightDir);
    smoke.setTime(t);
    waterfall.setTint(t.fall);
    causticStrength.value = t.caustic;
    causticColor.value.set(t.sun);
    wind.value = t.wind;
    currentBloom = t.bloom;
    for (const b of bloomNodes) b.strength.value = t.bloom;
    if (pmrem) {
      try {
        if (envRT) envRT.dispose();
        envRT = t.env > 0 ? pmrem.fromScene(envScene, 0.04, 0.1, 100) : null;
        scene.environment = envRT ? envRT.texture : null;
        scene.environmentIntensity = t.env;
      } catch (e) { console.warn('環境光產生失敗', e); pmrem = null; }
    }
    $('tod').textContent = t.name;
  }
  applyTime(0);
  applyLevel(1); // 後製管線要在場景光線與環境光設定好之後才建立，否則第一條管線的亮度會不一致

  // 明信片：以指定構圖渲染一張畫面（夜晚改用黃昏光線，讓水彩有色彩）
  const quest = new Quest(scene, world, spots, (spot, got, total) => postcards.collect(spot, got, total));
  function renderView(pose, w, h) {
    const keepTime = timeIdx, night = !!TIMES[timeIdx].moon;
    if (night) applyTime(2);
    const keepPR = renderer.getPixelRatio();
    if (keepPR < 1) renderer.setPixelRatio(1);
    const p0 = camera.position.clone(), q0 = camera.quaternion.clone(), fov0 = camera.fov;
    const st0 = sun.target.position.clone();
    quest.setVisible(false);
    camera.position.copy(pose.from); camera.lookAt(pose.to); camera.fov = pose.fov; camera.updateProjectionMatrix();
    sun.target.position.copy(pose.to); sun.position.copy(pose.to).addScaledVector(lightDir, 500); sun.target.updateMatrixWorld();
    renderFrame();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cw = renderer.domElement.width, ch = renderer.domElement.height, ar = w / h;
    let sw = cw, sh = cw / ar;
    if (sh > ch) { sh = ch; sw = ch * ar; }
    c.getContext('2d').drawImage(renderer.domElement, (cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 0, w, h);
    camera.position.copy(p0); camera.quaternion.copy(q0); camera.fov = fov0; camera.updateProjectionMatrix();
    sun.target.position.copy(st0);
    quest.setVisible(true);
    if (keepPR < 1) renderer.setPixelRatio(keepPR);
    if (night) applyTime(keepTime);
    return c;
  }

  let uiOpen = false, started = false;
  // 背景音樂（第一次點擊或按鍵後開始播放；M 鍵開關）
  const music = createMusic('assets/audio/above-the-treeline.mp3');
  const showMusic = () => { $('music').textContent = music.enabled ? '♪ 音樂開' : '♪ 音樂關'; };
  showMusic();
  addEventListener('pointerdown', () => music.start());
  addEventListener('keydown', () => music.start());
  const lockPointer = () => {
    try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* 不支援時用拖曳轉視角 */ }
  };
  const postcards = new Postcards({
    renderer, renderView, spots,
    onOpen() {
      uiOpen = true;
      music.duck(true);
      for (const k in player.keys) player.keys[k] = false;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    onClose() {
      uiOpen = false;
      music.duck(false);
      lockPointer();
      if (quest.got === quest.total && !postcards.albumOpen) {
        ui.toast('🎉 七張明信片全部收集完成！', '你走遍了湖畔、廣場、教堂，也划船到了湖心。按 P 翻閱明信片冊，或按 T 切換到夜晚看看點燈的小鎮。');
      }
    },
  });

  // 鍵盤
  addEventListener('keydown', (e) => {
    if (!started || uiOpen) return;
    if (e.code === 'KeyT') applyTime(timeIdx + 1);
    if (e.code === 'KeyQ') {
      const modes = [[true, 1], [false, 0], [false, 1], [false, 3]];
      const cur = modes.findIndex(([a, l]) => a === autoQuality && (a || l === level));
      const [a, l] = modes[(cur + 1) % modes.length];
      autoQuality = a;
      trial = null; autoFloor = LEVELS.length - 1;
      applyLevel(l);
      ui.toast('畫質：' + $('quality').textContent, autoQuality
        ? '依效能自動調整：先降抗鋸齒，最後才降解析度（最低 0.85 倍）'
        : (l === 0 ? '固定最高畫質：原生解析度＋4 倍多重取樣抗鋸齒' : l === 1 ? '固定高畫質：原生解析度＋SMAA 抗鋸齒' : '固定省電：解析度 0.8 倍＋銳化'));
    }
    if (e.code === 'KeyP') postcards.openAlbum();
    if (e.code === 'KeyM') {
      const on = music.toggle();
      showMusic();
      ui.toast(on ? '♪ 背景音樂：開' : '♪ 背景音樂：關', '《Above the Treeline》 · 按 M 可以隨時開關');
    }
    if (e.code === 'KeyE') {
      if (ride.active) ride.disembark();
      else {
        const b = ride.nearestBoat(player.pos);
        if (b && player.pos.y > 0.4) ride.board(b);
      }
    }
    if (e.code === 'KeyV' && ride.active) ride.toggleView();
  });

  // 開始／暫停
  const overlay = $('overlay'), startBtn = $('start');
  const showHud = (on) => ['hud', 'crosshair', 'info', 'help'].forEach((id) => $(id).classList.toggle('hidden', !on));
  startBtn.disabled = false;
  startBtn.textContent = '進入哈修塔特';
  markStage('完成');
  const loadSec = (performance.now() / 1000).toFixed(1);
  console.table(loadTimes);
  window.__loadTimes = loadTimes;
  statusEl.textContent = `渲染後端：${backend} · ${village.houses} 棟房屋 · ${village.planters} 個花箱 · 載入 ${loadSec} 秒`;
  const begin = () => { started = true; overlay.classList.add('hidden'); player.enabled = true; showHud(true); };
  startBtn.addEventListener('click', () => { begin(); lockPointer(); music.start(); });
  if (new URLSearchParams(location.search).has('autostart')) begin();
  player.controls.addEventListener('unlock', () => {
    if (uiOpen) return;
    overlay.classList.remove('hidden');
    overlay.classList.add('paused');
    startBtn.textContent = '繼續';
    player.enabled = false;
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // 主迴圈
  let last = performance.now(), frames = 0, fpsT = 0, adaptT = 0, adaptN = 0, lastAdapt = last, lastPrompt = null, goodWindows = 0, trial = null, autoFloor = LEVELS.length - 1;
  const t0 = last;
  const promptEl = $('prompt');
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    const active = started && !uiOpen && player.enabled;
    if (!ride.active && active) player.update(dt);
    ride.update(dt, t, active);
    props.update(t, dt);
    skyFx.update(t);
    smoke.update(t);
    quest.update(player.pos, t, active, ui);

    // 操作提示
    let prompt = '';
    if (active) {
      if (ride.active) prompt = 'W／S 划行 · A／D 轉向 · Shift 加速 · V 切換視角 · 靠岸按 E 下船';
      else {
        const b = ride.nearestBoat(player.pos);
        if (b && player.pos.y > 0.4) prompt = `按 E 搭乘${b.kind === 'electric' ? '遮陽棚電動船' : '划槳木船'}遊湖`;
      }
    }
    if (prompt !== lastPrompt) { promptEl.textContent = prompt; promptEl.classList.toggle('hidden', !prompt); lastPrompt = prompt; }

    // 明信片擷取（在一般畫面之前渲染構圖）
    postcards.capture();

    sun.target.position.set(Math.round(player.pos.x / 4) * 4, player.pos.y, Math.round(player.pos.z / 4) * 4);
    sun.position.copy(sun.target.position).addScaledVector(lightDir, 500);
    renderFrame();

    frames++; fpsT += dt; adaptT += dt; adaptN++;
    if (fpsT > 0.5) { $('fps').textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
    // 依效能自動調整畫質：幀率低時試著降一級，但降級後幀率沒有明顯變好（< 12%）就退回，
    // 而且之後不再往下降——瓶頸不在解析度時，降解析度只會讓畫面變糊。連續兩次很順時升一級。
    if (now - lastAdapt > 3000) {
      const fps = adaptN / adaptT;
      // 視窗在背景時幀率不準（瀏覽器會暫停繪製），這段期間不調整畫質
      if (autoQuality && started && !uiOpen && !document.hidden && adaptN > 20) {
        if (trial) {
          if (fps < trial.fps * 1.12) { autoFloor = trial.level; applyLevel(trial.level); }
          trial = null; goodWindows = 0;
        } else if (fps < 22 && level < autoFloor) {
          trial = { level, fps };
          applyLevel(level + 1);
          goodWindows = 0;
        } else if (fps > 42) {
          if (++goodWindows >= 2 && level > 0) { applyLevel(level - 1); goodWindows = 0; }
        } else goodWindows = 0;
      }
      adaptT = 0; adaptN = 0; lastAdapt = now;
    }
  });

  window.game = { THREE, scene, camera, renderer, player, world, quest, applyTime, spots, ride, props, postcards, renderView, quality: { pipelines, applyLevel, LEVELS } };
}

main().catch((e) => {
  console.error(e);
  statusEl.textContent = `載入失敗：${e.message}`;
});
