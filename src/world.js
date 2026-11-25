// 碰撞世界：地形高度 + 建築物方盒（OBB）+ 可站立平台（碼頭）
import { heightAt, gradientAt } from './terrain.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class World {
  constructor() {
    this.colliders = [];
    this.platforms = [];
    this.bounds = { x0: -400, x1: 200, z0: -470, z1: 330 };
  }
  _box(x, z, hx, hz, rot) {
    return { x, z, hx, hz, c: Math.cos(rot), s: Math.sin(rot), r: Math.hypot(hx, hz) };
  }
  addBox(x, z, hx, hz, rot) { this.colliders.push(this._box(x, z, hx, hz, rot)); }
  addPlatform(x, z, hx, hz, rot, top) { this.platforms.push({ ...this._box(x, z, hx, hz, rot), top }); }

  _inside(b, px, pz, m = 0) {
    const dx = px - b.x, dz = pz - b.z;
    if (Math.abs(dx) > b.r + m || Math.abs(dz) > b.r + m) return false;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    return Math.abs(lx) <= b.hx + m && Math.abs(lz) <= b.hz + m;
  }
  insideAny(px, pz, m = 0) { return this.colliders.some((b) => this._inside(b, px, pz, m)); }

  platformAt(x, z, feetY) {
    let top = -Infinity;
    for (const p of this.platforms) if (this._inside(p, x, z) && feetY >= p.top - 0.7) top = Math.max(top, p.top);
    return top;
  }
  groundAt(x, z, feetY = Infinity) { return Math.max(heightAt(x, z), this.platformAt(x, z, feetY)); }

  /** 把半徑 R 的圓推出所有方盒 */
  resolve(px, pz, R) {
    for (const b of this.colliders) {
      const dx = px - b.x, dz = pz - b.z;
      if (Math.abs(dx) > b.r + R || Math.abs(dz) > b.r + R) continue;
      let lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
      const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        lx = qx + (ex / d) * R; lz = qz + (ez / d) * R;
      } else if (b.hx - Math.abs(lx) < b.hz - Math.abs(lz)) {
        lx = Math.sign(lx || 1) * (b.hx + R);
      } else {
        lz = Math.sign(lz || 1) * (b.hz + R);
      }
      px = b.x + lx * b.c + lz * b.s;
      pz = b.z - lx * b.s + lz * b.c;
    }
    return [px, pz];
  }

  /** 船隻不能穿過的地方：房屋、船屋、碼頭 */
  boatBlocked(x, z) {
    if (this.insideAny(x, z, 0.15)) return true;
    return this.platforms.some((p) => this._inside(p, x, z, 0.2));
  }

  walkable(fx, fz, tx, tz, feetY) {
    const B = this.bounds;
    if (tx < B.x0 || tx > B.x1 || tz < B.z0 || tz > B.z1) return false;
    if (this.platformAt(tx, tz, feetY) > -Infinity) return true;
    const h = heightAt(tx, tz);
    if (h < 0.2) return false;                                   // 湖水
    if (gradientAt(tx, tz) > 0.9 && h > heightAt(fx, fz)) return false; // 太陡爬不上去
    return true;
  }
}
