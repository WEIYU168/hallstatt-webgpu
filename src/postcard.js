// 景點明信片：從遊戲場景擷取構圖 → 在 Web Worker 裡轉成「寫實手繪水彩＋墨線」→ 放進藝術明信片模板。
// 另有明信片冊（P 鍵）可以重看收集過的卡片。

// ---------- 水彩化（在 Worker 執行，不卡畫面） ----------
const WORKER_SRC = `
const sat = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const sm = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vn(x, y, s) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s); return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; }
function fbm(x, y, s) { return vn(x, y, s) * 0.55 + vn(x * 2.1, y * 2.1, s + 1) * 0.3 + vn(x * 4.3, y * 4.3, s + 2) * 0.15; }
function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) { const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc * k; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc * k; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
const gauss = (s, w, h, r) => blur(blur(s, w, h, r), w, h, r);
self.onmessage = (e) => {
  const { w, h, buf, seed, id } = e.data, px = new Uint8ClampedArray(buf), N = w * h;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), L = new Float32Array(N), L2 = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = px[i * 4] / 255; G[i] = px[i * 4 + 1] / 255; B[i] = px[i * 4 + 2] / 255; L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]; L2[i] = L[i] * L[i]; }
  // 1) Kuwahara 濾鏡（積分圖加速）：把細節收斂成一塊塊顏料
  const W1 = w + 1;
  const S = (a) => { const s = new Float64Array(W1 * (h + 1)); for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += a[y * w + x]; s[(y + 1) * W1 + x + 1] = s[y * W1 + x + 1] + row; } } return s; };
  const sR = S(R), sG = S(G), sB = S(B), sL = S(L), sL2 = S(L2);
  const rect = (s, x0, y0, x1, y1) => s[(y1 + 1) * W1 + x1 + 1] - s[y0 * W1 + x1 + 1] - s[(y1 + 1) * W1 + x0] + s[y0 * W1 + x0];
  const KR = new Float32Array(N), KG = new Float32Array(N), KB = new Float32Array(N), KL = new Float32Array(N);
  const r = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = 1e9, br = 0, bg = 0, bb = 0;
    for (let q = 0; q < 4; q++) {
      const x0 = q & 1 ? x : Math.max(0, x - r), x1 = q & 1 ? Math.min(w - 1, x + r) : x;
      const y0 = q & 2 ? y : Math.max(0, y - r), y1 = q & 2 ? Math.min(h - 1, y + r) : y;
      const n = (x1 - x0 + 1) * (y1 - y0 + 1), m = rect(sL, x0, y0, x1, y1) / n, v = rect(sL2, x0, y0, x1, y1) / n - m * m;
      if (v < best) { best = v; br = rect(sR, x0, y0, x1, y1) / n; bg = rect(sG, x0, y0, x1, y1) / n; bb = rect(sB, x0, y0, x1, y1) / n; }
    }
    const i = y * w + x; KR[i] = br; KG[i] = bg; KB[i] = bb; KL[i] = 0.299 * br + 0.587 * bg + 0.114 * bb;
  }
  // 2) 顏料邊緣（水彩乾掉時邊緣較深）
  const E = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x;
    const gx = -KL[i - w - 1] - 2 * KL[i - 1] - KL[i + w - 1] + KL[i - w + 1] + 2 * KL[i + 1] + KL[i + w + 1];
    const gy = -KL[i - w - 1] - 2 * KL[i - w] - KL[i - w + 1] + KL[i + w - 1] + 2 * KL[i + w] + KL[i + w + 1];
    E[i] = Math.min(1, Math.hypot(gx, gy) * 2.0); }
  // 3) 墨線：高斯差（DoG）
  const g1 = gauss(KL, w, h, 1), g2 = gauss(KL, w, h, 2);
  const out = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = x / w, v = y / h;
    // 紙張纖維與顆粒
    const fib = fbm(x * 0.5, y * 0.04, seed + 3) * 0.5 + fbm(x * 0.04, y * 0.5, seed + 4) * 0.5, grain = vn(x * 0.9, y * 0.9, seed + 5);
    const pr = 0.968 - 0.045 * fib - 0.025 * grain, pg = 0.94 - 0.05 * fib - 0.025 * grain, pb = 0.865 - 0.055 * fib - 0.025 * grain;
    // 透明水彩：略降飽和、提亮暗部，像顏料疊在紙上
    let cr = KR[i], cg = KG[i], cb = KB[i]; const cl = KL[i];
    cr = cl + (cr - cl) * 1.12; cg = cl + (cg - cl) * 1.12; cb = cl + (cb - cl) * 1.12;
    cr = cr * 0.9 + 0.09; cg = cg * 0.9 + 0.085; cb = cb * 0.9 + 0.07;
    const gran = 0.9 + 0.14 * fbm(x * 0.07, y * 0.07, seed + 7) + 0.07 * (grain - 0.5);
    const edge = 1 - 0.3 * E[i];
    let fr = pr * cr * gran * edge * 1.07, fg = pg * cg * gran * edge * 1.07, fb = pb * cb * gran * edge * 1.07;
    // 暗部的鉛筆斜線
    const shadow = 1 - sm(0.1, 0.4, cl);
    if (shadow > 0 && Math.sin((x - y) * 0.8 + fbm(x * 0.05, y * 0.05, seed) * 5) > 0.55) { const k = 1 - 0.18 * shadow; fr *= k; fg *= k; fb *= k; }
    // 手繪抖動的墨線（深褐）
    const ox = Math.round((vn(x * 0.035, y * 0.035, seed + 9) - 0.5) * 3), oy = Math.round((vn(x * 0.035, y * 0.035, seed + 11) - 0.5) * 3);
    const j = Math.min(h - 1, Math.max(0, y + oy)) * w + Math.min(w - 1, Math.max(0, x + ox));
    const d = g1[j] - 0.985 * g2[j];
    const ink = sat((-d - 0.005) * 60) * (0.7 + 0.3 * vn(x * 0.2, y * 0.2, seed + 13));
    fr = fr * (1 - ink) + 0.22 * ink; fg = fg * (1 - ink) + 0.16 * ink; fb = fb * (1 - ink) + 0.12 * ink;
    // 不規則的筆刷邊界：越靠紙邊越淡，邊緣顏料堆積
    const bd = Math.min(u, v * 1.5, 1 - u, (1 - v) * 1.5);
    const m = sm(0.01, 0.065, bd + (fbm(x * 0.022, y * 0.022, seed + 15) - 0.5) * 0.07);
    const rim = m * (1 - m) * 4 * 0.1;
    fr = pr + (fr - pr) * m - rim * 0.45; fg = pg + (fg - pg) * m - rim * 0.5; fb = pb + (fb - pb) * m - rim * 0.55;
    out[i * 4] = sat(fr) * 255; out[i * 4 + 1] = sat(fg) * 255; out[i * 4 + 2] = sat(fb) * 255; out[i * 4 + 3] = 255;
  }
  self.postMessage({ w, h, buf: out.buffer, id }, [out.buffer]);
};
`;

const W = 900, H = 600;

const ICON_CORNER = `<svg viewBox="0 0 60 60"><path d="M4 56 C4 26 26 4 56 4" fill="none" stroke="currentColor" stroke-width="1.4"/>
<path d="M10 56 C12 34 34 12 56 10" fill="none" stroke="currentColor" stroke-width="0.8"/>
<path d="M16 40 c6 -2 10 -8 9 -15 c-6 2 -10 8 -9 15z M30 22 c5 -3 7 -8 6 -13 c-5 3 -7 8 -6 13z" fill="currentColor" opacity=".55"/>
<circle cx="8" cy="52" r="2.2" fill="currentColor"/></svg>`;
const DIVIDER = `<svg viewBox="0 0 300 18" preserveAspectRatio="none"><path d="M0 9 H125 M175 9 H300" stroke="currentColor" stroke-width="0.9"/>
<path d="M150 2 c4 4 4 10 0 14 c-4 -4 -4 -10 0 -14z M136 9 c5 -4 9 -4 12 0 c-3 4 -7 4 -12 0z M164 9 c-5 -4 -9 -4 -12 0 c3 4 7 4 12 0z" fill="currentColor"/></svg>`;

function postmarkSVG(date) {
  return `<svg viewBox="0 0 200 120"><g fill="none" stroke="currentColor">
  <circle cx="60" cy="60" r="44" stroke-width="2.2"/><circle cx="60" cy="60" r="34" stroke-width="1"/>
  <path d="M108 40 q15 -8 30 0 t30 0 t30 0 M108 54 q15 -8 30 0 t30 0 t30 0 M108 68 q15 -8 30 0 t30 0 t30 0 M108 82 q15 -8 30 0 t30 0 t30 0" stroke-width="2"/></g>
  <defs><path id="pmc" d="M60 60 m-39 0 a39 39 0 1 1 78 0 a39 39 0 1 1 -78 0"/></defs>
  <text font-size="10.5" letter-spacing="2.2" fill="currentColor" font-family="Cormorant Garamond, Georgia, serif"><textPath href="#pmc">HALLSTATT · SALZKAMMERGUT ·</textPath></text>
  <text x="60" y="57" text-anchor="middle" font-size="13" fill="currentColor" font-family="Cormorant Garamond, Georgia, serif" font-weight="600">${date}</text>
  <text x="60" y="72" text-anchor="middle" font-size="9" fill="currentColor" font-family="Cormorant Garamond, Georgia, serif">4830 ÖSTERREICH</text></svg>`;
}

export class Postcards {
  /**
   * renderView(pose) 由主程式提供：用指定相機渲染一張畫面到 canvas。
   * onOpen / onClose：暫停與恢復遊戲。
   */
  constructor({ renderer, renderView, spots, onOpen, onClose }) {
    Object.assign(this, { renderer, renderView, spots, onOpen, onClose });
    this.pending = null;
    this.paintings = new Map(); // spot index → canvas
    this.open = false;
    this.worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    this.worker.onmessage = (e) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(e.data.buf), W, H), 0, 0);
      this.paintings.set(e.data.id, c);
      if (this.open && this.current === e.data.id) this._paint(c);
    };
    this._buildDOM();
    addEventListener('keydown', (e) => {
      if (this.open && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyE')) { e.preventDefault(); this.close(); }
      else if (this.albumOpen && (e.code === 'Escape' || e.code === 'KeyP')) { e.preventDefault(); this.closeAlbum(); }
    });
  }

  _buildDOM() {
    const root = document.createElement('div');
    root.id = 'postcard';
    root.innerHTML = `
      <div class="pc-card">
        <span class="pc-corner tl">${ICON_CORNER}</span><span class="pc-corner tr">${ICON_CORNER}</span>
        <span class="pc-corner bl">${ICON_CORNER}</span><span class="pc-corner br">${ICON_CORNER}</span>
        <div class="pc-art">
          <span class="pc-tape t1"></span><span class="pc-tape t2"></span>
          <div class="pc-frame"><canvas class="pc-canvas" width="${W}" height="${H}"></canvas>
            <div class="pc-painting"><span class="pc-brush">✎</span><span>畫家正在寫生<i>.</i><i>.</i><i>.</i></span></div></div>
          <div class="pc-caption">aquarelle · Hallstatt</div>
        </div>
        <div class="pc-text">
          <div class="pc-stamp"><div class="pc-stamp-in"><canvas class="pc-stamp-art" width="150" height="180"></canvas>
            <span class="pc-stamp-c">ÖSTERREICH</span><span class="pc-stamp-v">1,20</span></div></div>
          <div class="pc-postmark"></div>
          <div class="pc-no"></div>
          <h2 class="pc-title"></h2>
          <div class="pc-sub"></div>
          <div class="pc-divider">${DIVIDER}</div>
          <div class="pc-body"></div>
          <div class="pc-fact"></div>
          <div class="pc-meta"><span class="pc-coord"></span><span class="pc-alt"></span></div>
          <div class="pc-foot"><span class="pc-hint">點擊或按 Enter 收進明信片冊</span><span class="pc-sign">Grüße aus Hallstatt</span></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', () => { if (this.open) this.close(); });
    this.root = root;
    this.$ = (s) => root.querySelector(s);

    const album = document.createElement('div');
    album.id = 'album';
    album.innerHTML = `<div class="al-book"><h2>Hallstatt <span>明信片冊</span></h2><p class="al-sub">走遍小鎮、搭船遊湖，收集每一張手繪明信片</p>
      <div class="al-grid"></div><div class="al-hint">點擊卡片重新觀看 · 按 P 或 Esc 關閉</div></div>`;
    document.body.appendChild(album);
    album.addEventListener('click', (e) => { if (e.target === album) this.closeAlbum(); });
    this.album = album;
  }

  /** 收集到景點：排程擷取畫面並打開卡片 */
  collect(spot, got, total) {
    this.pending = { spot, got, total };
    this._show(spot, got, total, null);
  }

  /** 主迴圈每幀呼叫：有待擷取的景點就渲染構圖並送去水彩化 */
  capture() {
    if (!this.pending) return;
    const { spot } = this.pending;
    this.pending = null;
    const src = this.renderView(spot.art, W, H);
    const img = src.getContext('2d').getImageData(0, 0, W, H);
    // 先顯示模糊的原始構圖當作「打底稿」
    const ctx = this.$('.pc-canvas').getContext('2d');
    ctx.filter = 'blur(6px) saturate(0.35) brightness(1.15)';
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
    this.worker.postMessage({ w: W, h: H, buf: img.data.buffer, seed: 7 + spot.i * 13, id: spot.i }, [img.data.buffer]);
  }

  _paint(c) {
    const art = this.$('.pc-art');
    art.classList.remove('reveal');
    void art.offsetWidth;
    this.$('.pc-canvas').getContext('2d').drawImage(c, 0, 0);
    const st = this.$('.pc-stamp-art').getContext('2d');
    st.drawImage(c, W * 0.32, H * 0.12, W * 0.36, H * 0.72, 0, 0, 150, 180);
    art.classList.add('reveal', 'done');
  }

  _show(spot, got, total, painting) {
    this.current = spot.i;
    const $ = this.$;
    $('.pc-no').textContent = `HALLSTATT · No. ${String(spot.i + 1).padStart(2, '0')} / ${String(this.spots.length).padStart(2, '0')}`;
    $('.pc-title').textContent = spot.title;
    $('.pc-sub').textContent = spot.de;
    $('.pc-body').innerHTML = spot.body.map((p) => `<p>${p}</p>`).join('');
    $('.pc-fact').innerHTML = `<b>小知識</b>${spot.fact}`;
    $('.pc-coord').textContent = spot.coord;
    $('.pc-alt').textContent = spot.alt;
    const d = new Date();
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][d.getMonth()];
    $('.pc-postmark').innerHTML = postmarkSVG(`${d.getDate()} · ${roman} · ${d.getFullYear()}`);
    $('.pc-hint').textContent = got != null ? `第 ${got} / ${total} 張 · 點擊或按 Enter 收進明信片冊` : '點擊或按 Enter 關閉';
    const art = $('.pc-art');
    art.classList.remove('reveal', 'done');
    const ctx = $('.pc-canvas').getContext('2d');
    ctx.fillStyle = '#f3ead8'; ctx.fillRect(0, 0, W, H);
    $('.pc-stamp-art').getContext('2d').clearRect(0, 0, 150, 180);
    this.root.classList.add('show');
    this.open = true;
    this.onOpen();
    if (painting) this._paint(painting);
  }

  close() {
    this.root.classList.remove('show');
    this.open = false;
    this.onClose();
  }

  openAlbum() {
    const grid = this.album.querySelector('.al-grid');
    grid.innerHTML = '';
    this.spots.forEach((s) => {
      const cell = document.createElement('div');
      const has = this.paintings.has(s.i);
      cell.className = 'al-card' + (has ? '' : ' empty');
      cell.innerHTML = `<div class="al-thumb"></div><div class="al-title">${has ? s.title : '？？？'}</div><div class="al-no">No. ${String(s.i + 1).padStart(2, '0')}</div>`;
      if (has) {
        const c = document.createElement('canvas');
        c.width = 300; c.height = 200;
        c.getContext('2d').drawImage(this.paintings.get(s.i), 0, 0, 300, 200);
        cell.querySelector('.al-thumb').appendChild(c);
        cell.addEventListener('click', (e) => { e.stopPropagation(); this.closeAlbum(true); this._show(s, null, null, this.paintings.get(s.i)); });
      } else {
        cell.querySelector('.al-thumb').textContent = s.water ? '要搭船才找得到' : '尚未找到';
      }
      grid.appendChild(cell);
    });
    this.album.classList.add('show');
    this.albumOpen = true;
    this.onOpen();
  }

  closeAlbum(keepPaused) {
    this.album.classList.remove('show');
    this.albumOpen = false;
    if (!keepPaused) this.onClose();
  }
}
