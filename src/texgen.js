// 程式產生材質的「純運算」部分：不依賴 three.js，可以在 Web Worker 裡平行執行。
// 每個配方回傳描述資料（像素陣列＋格式），由 textures.js 在主執行緒轉成 three.js 材質。
//
// 描述格式：
//   單張：{ fmt: 'data' | 'canvas', w, h, data, srgb, repeat?, wrap? }
//   一組：{ set: { map: 單張, normalMap: 單張, ... } }
//   清單：{ list: [單張, ...] }

const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (a, n) => ((a % n) + n) % n;

function phash(ix, iy, seed = 0) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// 週期性 value noise：x 方向週期 px、y 方向週期 py（格數）
function pnoise(x, y, px, py, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = mod(ix, px), x1 = mod(ix + 1, px), y0 = mod(iy, py), y1 = mod(iy + 1, py);
  const a = phash(x0, y0, seed), b = phash(x1, y0, seed), c = phash(x0, y1, seed), d = phash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
// u,v ∈ [0,1) 的無縫 fbm，回傳 0..1
function pfbm(u, v, px, py, oct, seed = 0) {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * pnoise(u * px * f, v * py * f, px * f, py * f, seed + i * 31);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}
// 無縫 Voronoi：回傳 [最近距離, 次近距離, 格子 id]
function voronoi(u, v, nx, ny, seed, jitter = 0.85) {
  const x = u * nx, y = v * ny, ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = mod(cx, nx), wy = mod(cy, ny);
    const px = cx + 0.5 + (phash(wx, wy, seed) - 0.5) * jitter;
    const py = cy + 0.5 + (phash(wx, wy, seed + 7) - 0.5) * jitter;
    const dd = Math.hypot(x - px, y - py);
    if (dd < d1) { d2 = d1; d1 = dd; id = wx * 131 + wy; } else if (dd < d2) d2 = dd;
  }
  return [d1, d2, id];
}

const tex = (data, w, h, srgb, repeat) => ({ fmt: 'data', w, h, data, srgb, repeat });
const canvasTex = (data, w, h, wrap = false) => ({ fmt: 'canvas', w, h, data, srgb: true, wrap });

function normalFromHeight(h, size, k) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = (h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)]) * k;
    const dy = (h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x]) * k;
    const l = Math.hypot(dx, dy, 1);
    d[i * 4] = (-dx / l * 0.5 + 0.5) * 255;
    d[i * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255;
    d[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
    d[i * 4 + 3] = 255;
  }
  return d;
}

/** fn(u, v, out) 寫入 out.r/g/b（0..1）與 out.h（高度）；normalK > 0 時一併產生法線貼圖 */
function generate(size, fn, normalK = 0, repeat = 1) {
  const col = new Uint8Array(size * size * 4), hgt = new Float32Array(size * size);
  const o = { r: 0, g: 0, b: 0, h: 0 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, o);
    const i = y * size + x;
    col[i * 4] = sat(o.r) * 255; col[i * 4 + 1] = sat(o.g) * 255; col[i * 4 + 2] = sat(o.b) * 255; col[i * 4 + 3] = 255;
    hgt[i] = o.h;
  }
  const set = { map: tex(col, size, size, true, repeat) };
  if (normalK) set.normalMap = tex(normalFromHeight(hgt, size, normalK), size, size, false, repeat);
  return { set };
}

// ---------- 各種材質 ----------

// 石板路（Kopfsteinpflaster）：tileMeters 公尺一格，n 顆石頭
function cobble(n, tileMeters, seed, palette) {
  return generate(512, (u, v, o) => {
    const [d1, d2, id] = voronoi(u, v, n, n, seed);
    const e = d2 - d1;
    const r = phash(id, 3, seed), r2 = phash(id, 9, seed);
    const grain = pfbm(u, v, 32, 32, 3, seed + 5);
    const dome = smooth(0.0, 0.42, e) * (0.75 + 0.25 * (1 - d1));
    const mortar = 1 - smooth(0.035, 0.09, e);
    const lum = palette.lo + (palette.hi - palette.lo) * r;
    const sr = lum * (1 + palette.warm * (r2 - 0.5)), sg = lum, sb = lum * (1 - palette.warm * 0.6 * (r2 - 0.3));
    const sh = (0.78 + 0.22 * dome) * (0.88 + 0.24 * grain);
    o.r = (sr * sh) * (1 - mortar) + 0.30 * mortar;
    o.g = (sg * sh) * (1 - mortar) + 0.28 * mortar;
    o.b = (sb * sh) * (1 - mortar) + 0.24 * mortar;
    o.h = dome * 1.0 + grain * 0.08 - mortar * 0.25;
  }, 6, 1 / tileMeters);
}

// 石塊牆：6 排、每排 4 塊（錯縫）
function stoneBlocks() {
  const rows = 6, k = 4, tile = 2.4;
  return generate(512, (u, v, o) => {
    const ry = v * rows, r = Math.floor(ry), fy = ry - r;
    const shift = phash(mod(r, rows), 3, 11);
    const bx = u * k + shift, b = Math.floor(bx), fx = bx - b;
    const ex = Math.min(fx, 1 - fx) * (tile / k), ey = Math.min(fy, 1 - fy) * (tile / rows);
    const e = Math.min(ex, ey);
    const id = mod(b, k) * 17 + mod(r, rows);
    const rnd = phash(id, 5, 11), rnd2 = phash(id, 8, 11);
    const grain = pfbm(u, v, 24, 24, 4, 13);
    const mortar = 1 - smooth(0.012, 0.03, e);
    const bevel = smooth(0.012, 0.07, e);
    const lum = (0.62 + 0.3 * rnd) * (0.8 + 0.35 * grain) * (0.85 + 0.15 * bevel);
    o.r = lum * (1.02 + 0.06 * rnd2) * (1 - mortar) + 0.52 * mortar;
    o.g = lum * (1 - mortar) + 0.5 * mortar;
    o.b = lum * (0.95 - 0.05 * rnd2) * (1 - mortar) + 0.46 * mortar;
    o.h = bevel + grain * 0.35 - mortar * 0.3;
  }, 5, 1 / tile);
}

// 直向木板牆
function woodPlanks() {
  const boards = 8, tile = 1.6;
  return generate(512, (u, v, o) => {
    const bx = u * boards, b = Math.floor(bx), fx = bx - b;
    const id = mod(b, boards);
    const tint = phash(id, 2, 21);
    const grain = pfbm(u + tint * 0.37, v, 64, 3, 4, 23 + id);
    const streak = 0.5 + 0.5 * Math.sin((u * boards * 9 + grain * 6) * Math.PI * 2);
    const gap = 1 - smooth(0.02, 0.07, Math.min(fx, 1 - fx));
    const knot = smooth(0.9, 0.97, pfbm(u, v, 8, 8, 2, 29 + id));
    const weather = pfbm(u, v, 24, 2, 3, 31 + id); // 日曬雨淋的深色直條紋
    const lum = (0.6 + 0.32 * tint) * (0.74 + 0.26 * streak) * (0.84 + 0.32 * grain) * (1 - 0.45 * knot) * (0.82 + 0.3 * weather);
    o.r = lum * (1 - gap * 0.8); o.g = lum * 0.92 * (1 - gap * 0.8); o.b = lum * 0.83 * (1 - gap * 0.8);
    o.h = (1 - gap) * 0.6 + streak * 0.08 + grain * 0.05;
  }, 4, 1 / tile);
}

// 木瓦屋頂：v 往下坡方向增加，每排下緣較厚、上緣被上一排遮住較暗
function shingles() {
  const rows = 9, per = 9, tile = 1.2;
  return generate(512, (u, v, o) => {
    const ry = v * rows, r = Math.floor(ry), fy = ry - r;
    const off = (mod(r, 2) * 0.5) + phash(mod(r, rows), 1, 41) * 0.2;
    const bx = u * per + off, b = Math.floor(bx), fx = bx - b;
    const id = mod(b, per) * 13 + mod(r, rows);
    const rnd = phash(id, 4, 41);
    const grain = pfbm(u, v, 96, 6, 3, 43);
    const gap = 1 - smooth(0.02, 0.06, Math.min(fx, 1 - fx));
    const lum = (0.62 + 0.32 * rnd) * (0.55 + 0.45 * fy) * (0.85 + 0.25 * grain) * (1 - 0.6 * gap);
    o.r = lum; o.g = lum * 0.995; o.b = lum * 0.99; // 中性灰（石板／水泥瓦），色調由頂點色決定
    o.h = fy * 0.9 - gap * 0.3 + grain * 0.05;
  }, 5, 1 / tile);
}

// 灰泥牆：幾乎白色，只帶細微斑駁
function plaster() {
  return generate(512, (u, v, o) => {
    const big = pfbm(u, v, 4, 4, 4, 51), fine = pfbm(u, v, 48, 48, 2, 53), streak = pfbm(u, v, 20, 2, 3, 55);
    const lum = 0.87 + 0.08 * big + 0.05 * fine - 0.05 * smooth(0.45, 0.8, streak);
    o.r = lum; o.g = lum * 0.99; o.b = lum * 0.97;
    o.h = fine * 0.7 + big * 0.3;
  }, 1.4, 1 / 2.5);
}

// 窗戶：白色窗框、左右兩扇各三格的格子窗與上方氣窗；深色玻璃反射天空，內側有蕾絲窗簾；
// emissive 版本是點燈時透出窗簾的暖光
function windows() {
  const size = 256;
  const mk = (lit) => generate(size, (u, v, o) => {
    const frame = u < 0.07 || u > 0.93 || v < 0.06 || v > 0.94;
    const sash = Math.abs(u - 0.5) < 0.032 || Math.abs(v - 0.7) < 0.026;           // 中梃與橫檔
    const bars = (Math.abs(v - 0.27) < 0.012 || Math.abs(v - 0.485) < 0.012) && v < 0.7; // 窗格條
    const lace = (1 - smooth(0.2, 0.3, Math.min(u, 1 - u))) * (0.55 + 0.45 * Math.sin(u * 95) ** 2)
      + (v < 0.36 ? 0.45 * (0.6 + 0.4 * Math.sin(u * 160 + v * 40) ** 2) : 0);
    if (frame || sash || bars) {
      const c = lit ? 0 : 0.95 - (frame && v < 0.06 ? 0.08 : 0);
      o.r = c; o.g = c * 0.985; o.b = c * 0.96;
    } else if (lit) {
      const g = (0.72 + 0.28 * v) * (0.75 + 0.25 * sat(lace));
      o.r = 1.0 * g; o.g = 0.74 * g; o.b = 0.4 * g;
    } else {
      const t = Math.pow(v, 1.3);
      const streak = smooth(0.0, 0.08, 0.08 - Math.abs(((u * 0.7 + v * 0.55) % 0.6) - 0.3)) * 0.1;
      const l = sat(lace) * 0.32;
      o.r = 0.07 + 0.34 * t + streak + l; o.g = 0.09 + 0.4 * t + streak + l; o.b = 0.12 + 0.45 * t + streak + l * 0.95;
    }
    o.h = 0;
  });
  return { set: { map: mk(false).set.map, emissive: mk(true).set.map } };
}

// 草地／地面細節（乘上地形頂點色）
function groundDetail() {
  return generate(512, (u, v, o) => {
    const n = pfbm(u, v, 8, 8, 4, 61), f = pfbm(u, v, 64, 64, 2, 63);
    const speck = phash(Math.floor(u * 512), Math.floor(v * 512), 65);
    const lum = 0.8 + 0.18 * n + 0.1 * f + (speck > 0.93 ? 0.12 : speck < 0.06 ? -0.12 : 0);
    o.r = lum * (0.98 + 0.06 * (f - 0.5)); o.g = lum; o.b = lum * 0.94;
    o.h = 0;
  }, 0, 1 / 3);
}

// 水波法線：整數波向量的正弦波疊加（自然無縫），解析求導
function waterNormal() {
  const size = 256, waves = [];
  const seed = 71;
  for (let i = 0; i < 34; i++) {
    const kx = Math.round((phash(i, 1, seed) - 0.5) * 30), ky = Math.round((phash(i, 2, seed) - 0.5) * 30);
    const k = Math.hypot(kx, ky);
    if (k < 2) continue;
    waves.push({ kx, ky, a: 1 / Math.pow(k, 1.35), ph: phash(i, 3, seed) * Math.PI * 2 });
  }
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let gx = 0, gy = 0;
    for (const w of waves) {
      const c = Math.cos(2 * Math.PI * (w.kx * u + w.ky * v) + w.ph) * w.a * 2 * Math.PI;
      gx += c * w.kx; gy += c * w.ky;
    }
    gx *= 0.045; gy *= 0.045;
    const l = Math.hypot(gx, gy, 1), i = (y * size + x) * 4;
    d[i] = (-gx / l * 0.5 + 0.5) * 255; d[i + 1] = (-gy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return tex(d, size, size, false);
}

// 岩石（卵石、巨石）
function rock() {
  return generate(512, (u, v, o) => {
    const n = pfbm(u, v, 6, 6, 5, 91), c = pfbm(u, v, 24, 24, 3, 93);
    const crack = smooth(0.0, 0.035, Math.abs(pfbm(u, v, 5, 5, 3, 95) - 0.5));
    const lum = (0.55 + 0.35 * n) * (0.85 + 0.2 * c) * (0.62 + 0.38 * crack);
    o.r = lum; o.g = lum * 1.0; o.b = lum * 0.95;
    o.h = n * 0.8 + c * 0.2 - (1 - crack) * 0.35;
  }, 4, 1);
}

// 柴堆端面：一圈圈年輪與樹皮
function logEnds() {
  return generate(512, (u, v, o) => {
    const [d1, d2, id] = voronoi(u, v, 7, 7, 101, 0.35);
    const r = phash(id, 1, 101);
    const ring = 0.5 + 0.5 * Math.sin(d1 * (55 + r * 20) + r * 6);
    const bark = smooth(0.36, 0.44, d1);
    const gap = 1 - smooth(0.0, 0.06, d2 - d1);
    const lw = (0.7 + 0.18 * r) * (0.85 + 0.15 * ring) * (1 - 0.25 * smooth(0, 0.35, d1));
    let R = lw * 0.98, G = lw * 0.78, B = lw * 0.52;
    R = R * (1 - bark) + 0.26 * bark; G = G * (1 - bark) + 0.18 * bark; B = B * (1 - bark) + 0.11 * bark;
    const k = 1 - gap * 0.85;
    o.r = R * k; o.g = G * k; o.b = B * k;
    o.h = (1 - gap) * 0.6 - bark * 0.25 + ring * 0.05;
  }, 3, 1);
}

// 加法混合用的柔光圖（黑＝透明）
function glowTex(size, fn) {
  return generate(size, (u, v, o) => { const l = fn(u, v); o.r = l; o.g = l; o.b = l; o.h = 0; }).set.map;
}

// 柔和霧帶／煙（含透明度）
function softPuff(w, h, seed, stretch) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, dx = (u - 0.5) * 2, dy = (v - 0.5) * 2 * stretch;
    const r = Math.hypot(dx, dy), n = pfbm(u, v, 6, 6, 4, seed);
    const a = sat((1 - r) * 1.4) * (0.45 + 0.75 * n);
    const i = (y * w + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = sat(a) * 255;
  }
  return canvasTex(d, w, h);
}

// 遮陽棚條紋布
function stripes(a = '#c0392b', b = '#f4efe4', horizontal = false) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const A = rgb(a), Bc = rgb(b), d = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const band = Math.floor((horizontal ? y : x) / 8), c = band % 2 ? Bc : A, i = (y * 64 + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return canvasTex(d, 64, 64, true);
}

// 天鵝羽片：一排排交錯重疊的圓弧羽片（羽軸、羽枝細紋）
function feathers() {
  const rows = 8, per = 6;
  return generate(256, (u, v, o) => {
    const ry = v * rows, r = Math.floor(ry), fy = ry - r;
    const bx = u * per + mod(r, 2) * 0.5, b = Math.floor(bx), fx = bx - b;
    const jit = phash(mod(b, per), mod(r, rows), 151);
    const shape = 1 - Math.hypot((fx - 0.5) * 1.7, Math.max(0, fy - 0.3) * 1.45);
    const edge = smooth(0.0, 0.22, shape);
    const shaft = 1 - smooth(0.0, 0.04, Math.abs(fx - 0.5));
    const barbs = 0.5 + 0.5 * Math.sin((fx - 0.5) * 70 + fy * 22 + jit * 6);
    const fluff = pfbm(u, v, 16, 16, 3, 157);
    const lum = 0.9 + 0.05 * edge + 0.015 * barbs - 0.015 * shaft + 0.02 * jit + 0.03 * (fluff - 0.5);
    o.r = lum; o.g = lum; o.b = lum * 0.988;
    o.h = edge * 0.45 + fy * 0.3 + barbs * 0.02 + fluff * 0.25;
  }, 1.3, 1);
}

// 雲的雜訊（無縫）：R 大尺度 fbm、G 蓬鬆的反 Worley、B 中尺度 fbm、A 細碎羽絲
function cloudNoise() {
  const size = 512, d = new Uint8Array(size * size * 4);
  const stretch = (x, k) => sat((x - 0.5) * k + 0.5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const [a1] = voronoi(u, v, 6, 6, 207, 0.9), [a2] = voronoi(u, v, 12, 12, 211, 0.9);
    d[i] = stretch(pfbm(u, v, 4, 4, 6, 201), 1.9) * 255;
    d[i + 1] = sat(1 - (a1 * 0.65 + a2 * 0.35) * 1.45) * 255;
    d[i + 2] = stretch(pfbm(u, v, 12, 12, 5, 217), 1.8) * 255;
    d[i + 3] = stretch(pfbm(u, v, 32, 32, 4, 223), 1.7) * 255;
  }
  return tex(d, size, size, false);
}

// 立邊咬合金屬屋頂（哈修塔特常見的灰色鐵皮屋頂）：每 0.45 公尺一道立邊，面板深淺略有差異
function roofMetal() {
  const panels = 4, tile = 1.8;
  return generate(512, (u, v, o) => {
    const bx = u * panels, b = Math.floor(bx), fx = bx - b;
    const id = mod(b, panels), tint = phash(id, 3, 171);
    const seam = Math.exp(-(((fx - 0.5) / 0.035) ** 2));
    const seamShadow = Math.exp(-(((fx - 0.56) / 0.05) ** 2));
    const streak = pfbm(u * 0.5, v, 2, 6, 3, 173 + id), grime = pfbm(u, v, 8, 8, 3, 177);
    const lum = (0.76 + 0.1 * tint + 0.06 * streak - 0.08 * grime) * (1 + 0.12 * seam - 0.1 * seamShadow);
    o.r = lum; o.g = lum * 1.01; o.b = lum * 1.03;
    o.h = seam * 0.9 - seamShadow * 0.1 + streak * 0.03;
  }, 4, 1 / tile);
}

// 山腰雲霧帶：邊緣被雜訊侵蝕的柔軟長條（含透明度，上緣受光較亮）
function mistBank(seed) {
  const W = 256, H = 96, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const n = pfbm(u, v, 6, 3, 5, seed), n2 = pfbm(u, v, 16, 6, 3, seed + 9);
    const env = smooth(0, 0.28, u) * smooth(1, 0.72, u) * smooth(0, 0.42, v) * smooth(1, 0.62, v);
    const a = sat((n * 0.8 + n2 * 0.35 - 0.4) * 2.4) * env;
    const shade = 0.86 + 0.14 * (1 - v), i = (y * W + x) * 4;
    d[i] = 255 * shade; d[i + 1] = 255 * shade; d[i + 2] = 255 * Math.min(1, shade + 0.03); d[i + 3] = a * 255;
  }
  return canvasTex(d, W, H);
}

// 水面漣漪的細圓環（加法混合，黑＝透明）
function rippleTex() {
  return glowTex(128, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.exp(-(((r - 0.8) / 0.05) ** 2)) * 0.9 + Math.exp(-(((r - 0.68) / 0.035) ** 2)) * 0.35;
  });
}

/** 所有材質配方（名稱 → 產生函式） */
export const RECIPES = {
  rock: () => rock(),
  logs: () => logEnds(),
  foam: () => glowTex(128, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return sat(1 - r) ** 1.5 * (0.45 + 0.75 * pfbm(u, v, 8, 8, 3, 111));
  }),
  ring: () => glowTex(128, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.exp(-(((r - 0.78) / 0.07) ** 2)) + 0.35 * Math.exp(-((r / 0.5) ** 2));
  }),
  beam: () => glowTex(64, (u, v) => (1 - v) ** 2.2),
  mist: () => softPuff(256, 64, 121, 1),
  puff: () => softPuff(64, 64, 131, 1),
  stripes: () => stripes(),
  awning: () => stripes('#d4572a', '#f3e9d6'),
  awningH: () => stripes('#d4572a', '#f3e9d6', true),
  feather: () => feathers(),
  ripple: () => rippleTex(),
  cloudNoise: () => cloudNoise(),
  banks: () => ({ list: [mistBank(301), mistBank(307), mistBank(311)] }),
  roofMetal: () => roofMetal(),
  cobble: () => cobble(14, 1.5, 81, { lo: 0.46, hi: 0.72, warm: 0.22 }),
  paving: () => cobble(6, 2.2, 83, { lo: 0.6, hi: 0.82, warm: 0.08 }),
  stone: () => stoneBlocks(),
  wood: () => woodPlanks(),
  roof: () => shingles(),
  plaster: () => plaster(),
  window: () => windows(),
  ground: () => groundDetail(),
  water: () => waterNormal(),
};

/** 大約的產生成本（毫秒，實測值），用來把工作平均分給幾個背景執行緒 */
export const COST = {
  cloudNoise: 670, rock: 380, logs: 360, cobble: 300, paving: 290, wood: 220, plaster: 200, water: 190, roofMetal: 170,
  stone: 130, roof: 100, ground: 100, banks: 80, window: 64, feather: 37, foam: 11, mist: 10, ring: 8, ripple: 6,
};
