// 程式產生的無縫材質（不需要外部圖檔）：石板路、石牆、木板、屋瓦、灰泥、窗戶、草地細節、水波法線、雲……
// 像素運算在 texgen.js；這裡負責把工作分給幾個 Web Worker 平行產生，再轉成 three.js 材質。
import * as THREE from 'three';
import { RECIPES, COST } from './texgen.js';

/** 每張材質產生所花的毫秒數（診斷載入速度用） */
export const textureTimes = {};
let cache = null, pending = null;

function toTexture(t) {
  if (t.fmt === 'canvas') {
    const c = document.createElement('canvas');
    c.width = t.w; c.height = t.h;
    c.getContext('2d').putImageData(new ImageData(t.data, t.w, t.h), 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (t.wrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  const tex = new THREE.DataTexture(t.data, t.w, t.h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16; // 斜看地面、屋頂時仍保持清晰
  tex.colorSpace = t.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (t.repeat) tex.repeat.set(t.repeat, t.repeat);
  tex.needsUpdate = true;
  return tex;
}

function build(res) {
  if (res.set) return Object.fromEntries(Object.entries(res.set).map(([k, t]) => [k, toTexture(t)]));
  if (res.list) return res.list.map(toTexture);
  return toTexture(res);
}

/**
 * 在背景執行緒平行產生所有材質（建議在載入一開始就呼叫，和 WebGPU 初始化同時進行）。
 * 不支援 Worker 或發生錯誤時，自動退回主執行緒產生。
 */
export function prepareTextures() {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  const names = Object.keys(RECIPES);
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  let workers = [];
  try {
    for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./texture-worker.js', import.meta.url), { type: 'module' }));
  } catch (e) {
    workers.forEach((w) => w.terminate());
    workers = [];
  }
  if (!workers.length) return Promise.resolve(getTextures());

  pending = new Promise((resolve) => {
    // 依成本由大到小，每次指派給目前負擔最輕的執行緒
    const lists = workers.map(() => []), load = workers.map(() => 0);
    for (const name of [...names].sort((a, b) => (COST[b] || 1) - (COST[a] || 1))) {
      let k = 0;
      for (let i = 1; i < load.length; i++) if (load[i] < load[k]) k = i;
      lists[k].push(name);
      load[k] += COST[name] || 1;
    }
    const result = {};
    let left = names.length, finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      workers.forEach((w) => w.terminate());
      pending = null;
      resolve(value);
    };
    const fail = (err) => {
      console.warn('材質背景產生失敗，改在主執行緒產生', err);
      finish(getTextures());
    };
    workers.forEach((w, i) => {
      w.onmessage = (e) => {
        if (finished) return;
        const { name, res, ms } = e.data;
        result[name] = build(res);
        textureTimes[name] = ms;
        if (--left === 0) { if (!cache) cache = result; finish(cache); }
      };
      w.onerror = fail;
      w.onmessageerror = fail;
      w.postMessage({ names: lists[i] });
    });
  });
  return pending;
}

/** 取得材質（同步）。若還沒準備好，就直接在主執行緒產生。 */
export function getTextures() {
  if (cache) return cache;
  const result = {};
  for (const [name, make] of Object.entries(RECIPES)) {
    const t0 = performance.now();
    result[name] = build(make());
    textureTimes[name] = Math.round(performance.now() - t0);
  }
  cache = result;
  return cache;
}
