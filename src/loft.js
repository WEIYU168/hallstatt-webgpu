// 放樣（loft）工具：沿一串斷面環（中心點＋軸向＋超橢圓半徑）產生平滑網格，兩端可加圓頭端蓋。
// 每個頂點的顏色、粗糙度、蒙皮權重由回呼決定。人物（human.js）與天鵝（props.js）共用。
import * as THREE from 'three';

const _x = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3();

/**
 * rings：[{ c: 中心, y: 軸向（單位向量）, x: 側向提示, w: 側向半徑, dF: +z 側半徑, dB: -z 側半徑, n: 超橢圓指數, t: 參數 }]
 *   斷面座標系：x = 側向（與軸正交化），z = x × y。
 * opts：{ seg, capStart, capEnd（端蓋長度）, capRings, closed（首尾相接的環狀路徑）,
 *         color(info) → THREE.Color, rough(info) → number, skin(info) → [[骨骼, 權重], …], uv: { u, v } 比例 }
 * info：{ t, a（角度 0..2π）, ca, sa, p（頂點位置）, cap（-1／0／1）, ring（環索引） }
 */
export function loft(rings, opts = {}) {
  const N = opts.seg ?? 16, M = opts.capRings ?? 4;
  const list = [];
  const frame = (r) => {
    const y = r.y.clone().normalize();
    _x.copy(r.x).addScaledVector(y, -r.x.dot(y));
    if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(y, -y.x);
    const x = _x.clone().normalize();
    return { ...r, y, x, z: new THREE.Vector3().crossVectors(x, y) };
  };
  const R = rings.map(frame);
  // 圓頭端蓋：沿軸向外延伸、半徑以餘弦收攏
  const capRings = (r, len, dir, cap) => {
    const out = [];
    for (let i = 1; i < M; i++) {
      const th = (i / M) * Math.PI / 2, k = Math.cos(th);
      out.push({ ...r, c: r.c.clone().addScaledVector(r.y, dir * len * Math.sin(th)), w: r.w * k, dF: r.dF * k, dB: r.dB * k, cap });
    }
    return out;
  };
  const closed = !!opts.closed;
  const cs = !closed && opts.capStart ? opts.capStart : 0, ce = !closed && opts.capEnd ? opts.capEnd : 0;
  if (cs) list.push(...capRings(R[0], cs, -1, -1).reverse());
  list.push(...R.map((r) => ({ ...r, cap: 0 })));
  if (ce) list.push(...capRings(R[R.length - 1], ce, 1, 1));

  const pos = [], col = [], rough = [], si = [], sw = [], uvs = [], idx = [];
  const skin = opts.skin, useUV = !!opts.uv, W = N + 1;
  let vlen = 0;
  const push = (p, info) => {
    pos.push(p.x, p.y, p.z);
    const c = opts.color ? opts.color(info) : null;
    if (c) col.push(c.r, c.g, c.b); else col.push(1, 1, 1);
    rough.push(opts.rough ? opts.rough(info) : 0.8);
    if (skin) {
      const ws = skin(info).filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ws.reduce((s, e) => s + e[1], 0) || 1;
      for (let k = 0; k < 4; k++) { si.push(ws[k] ? ws[k][0] : 0); sw.push(ws[k] ? ws[k][1] / tot : 0); }
    }
    if (useUV) uvs.push(info.u * opts.uv.u, vlen * opts.uv.v);
  };
  list.forEach((r, ri) => {
    if (ri > 0) vlen += r.c.distanceTo(list[ri - 1].c);
    const e = 2 / (r.n || 2);
    for (let k = 0; k <= N; k++) {
      const a = ((k % N) / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const px = Math.sign(ca) * Math.pow(Math.abs(ca), e) * r.w;
      const pz = Math.sign(sa) * Math.pow(Math.abs(sa), e) * (sa > 0 ? r.dF : r.dB);
      _p.copy(r.c).addScaledVector(r.x, px).addScaledVector(r.z, pz);
      push(_p, { t: r.t ?? 0, a, ca, sa, p: _p, cap: r.cap, ring: ri, u: k / N, r });
    }
  });
  const nr = list.length;
  const band = (i, j) => {
    for (let k = 0; k < N; k++) {
      const a = i * W + k, b = a + 1, c = j * W + k, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  for (let i = 0; i < nr - 1; i++) band(i, i + 1);
  if (closed) band(nr - 1, 0);
  // 端點（圓頭的尖端）
  const tip = (r, len, dir, cap, ring) => {
    const p = r.c.clone().addScaledVector(r.y, dir * len);
    const v = pos.length / 3;
    push(p, { t: r.t ?? 0, a: 0, ca: 0, sa: 0, p, cap, ring: -1, u: 0.5, r });
    for (let k = 0; k < N; k++) {
      const a = ring * W + k, b = a + 1;
      if (dir < 0) idx.push(v, a, b); else idx.push(v, b, a);
    }
  };
  if (!closed) {
    tip(R[0], cs, -1, -1, 0);
    tip(R[R.length - 1], ce, 1, 1, nr - 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('rough', new THREE.Float32BufferAttribute(rough, 1));
  if (skin) {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  if (useUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 接縫（第 0 與第 N 個頂點位置相同）法線取平均，避免出現亮線
  const n = g.attributes.normal;
  for (let i = 0; i < nr; i++) {
    const a = i * W, b = a + N;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b), l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

/** Catmull-Rom 內插關鍵斷面（每列為數值陣列），讓輪廓平滑、頂點色有足夠解析度 */
export function spline(rows, sub) {
  const out = [], n = rows.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(n - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(rows[n - 1].slice());
  return out;
}

/** 沿曲線取樣出斷面環：radius(t) → { w, dF, dB, n }，xHint 為側向提示 */
export function ringsAlong(curve, count, xHint, radius) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push({ c: curve.getPointAt(t), y: curve.getTangentAt(t), x: xHint, t, ...radius(t) });
  }
  return out;
}

/**
 * 把一般幾何（Sphere 等）轉成與 loft 相同的屬性格式。
 * color／rough 可為常數或 (局部位置, 索引) → 值；bone 不為 null 時加上蒙皮屬性；keepUV 保留 uv。
 */
export function solid(geo, color, rough, bone = null, keepUV = false) {
  const g = geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv')) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), rg = new Float32Array(n);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(g.attributes.position, i);
    const c = typeof color === 'function' ? color(p, i) : color;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    rg[i] = typeof rough === 'function' ? rough(p, i) : rough;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('rough', new THREE.BufferAttribute(rg, 1));
  if (bone !== null) {
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  if (!g.index) {
    const id = new Array(n); for (let i = 0; i < n; i++) id[i] = i;
    g.setIndex(id);
  }
  return g;
}
