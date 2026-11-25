// 第一人稱控制：Pointer Lock 滑鼠視角（不支援時改用拖曳）、WASD、奔跑、跳躍、碰撞
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera; this.world = world;
    this.controls = new PointerLockControls(camera, dom);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.onGround = true;
    this.enabled = false;
    this.radius = 0.35; this.eye = 1.7;
    this.keys = Object.create(null);

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (this.enabled && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = Object.create(null); });

    // 拖曳轉視角（Pointer Lock 不可用時的後備）
    let drag = false, lx = 0, ly = 0;
    dom.addEventListener('pointerdown', (e) => { if (!this.controls.isLocked) { drag = true; lx = e.clientX; ly = e.clientY; } });
    addEventListener('pointerup', () => { drag = false; });
    addEventListener('pointermove', (e) => {
      if (!drag || this.controls.isLocked) return;
      this.look((e.clientX - lx) * 0.004, (e.clientY - ly) * 0.004);
      lx = e.clientX; ly = e.clientY;
    });
  }

  look(dyaw, dpitch) {
    _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    _e.y -= dyaw;
    _e.x = THREE.MathUtils.clamp(_e.x - dpitch, -1.45, 1.45);
    _e.z = 0;
    this.camera.quaternion.setFromEuler(_e);
  }

  teleport(x, z, yaw = 0, pitch = 0) {
    this.pos.set(x, this.world.groundAt(x, z, 999), z);
    this.vel.set(0, 0, 0);
    _e.set(pitch, yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_e);
    this.syncCamera();
  }

  syncCamera() { this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }

  _tryMove(tx, tz) {
    const W = this.world, p = this.pos;
    const [rx, rz] = W.resolve(tx, tz, this.radius);
    if (!W.walkable(p.x, p.z, rx, rz, p.y)) return false;
    p.x = rx; p.z = rz;
    return true;
  }

  lookKeys(dt) {
    const k = this.keys;
    if (!this.enabled) return;
    if (k.ArrowLeft) this.look(-1.8 * dt, 0);
    if (k.ArrowRight) this.look(1.8 * dt, 0);
    if (k.ArrowUp) this.look(0, -1.2 * dt);
    if (k.ArrowDown) this.look(0, 1.2 * dt);
  }

  update(dt) {
    const k = this.keys;
    this.lookKeys(dt);
    let fwd = 0, side = 0;
    if (this.enabled) {
      if (k.KeyW) fwd += 1;
      if (k.KeyS) fwd -= 1;
      if (k.KeyD) side += 1;
      if (k.KeyA) side -= 1;
    }
    this.camera.getWorldDirection(_f);
    _f.y = 0; _f.normalize();
    _r.set(-_f.z, 0, _f.x);
    const speed = k.ShiftLeft || k.ShiftRight ? 11 : 4.6;
    let wx = _f.x * fwd + _r.x * side, wz = _f.z * fwd + _r.z * side;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    const a = 1 - Math.exp(-(this.onGround ? 10 : 2.5) * dt);
    this.vel.x += (wx * speed - this.vel.x) * a;
    this.vel.z += (wz * speed - this.vel.z) * a;

    const p = this.pos;
    const tx = p.x + this.vel.x * dt, tz = p.z + this.vel.z * dt;
    if (!this._tryMove(tx, tz)) {
      if (this._tryMove(tx, p.z)) this.vel.z *= 0.5;
      else if (this._tryMove(p.x, tz)) this.vel.x *= 0.5;
      else { this.vel.x = 0; this.vel.z = 0; }
    }

    if (this.enabled && k.Space && this.onGround) { this.vel.y = 6.5; this.onGround = false; }
    this.vel.y -= 22 * dt;
    p.y += this.vel.y * dt;
    const g = this.world.groundAt(p.x, p.z, p.y);
    if (p.y <= g) { p.y = g; this.vel.y = 0; this.onGround = true; }
    else if (this.onGround && p.y - g < 0.5 && this.vel.y <= 0) { p.y = g; this.vel.y = 0; }
    else this.onGround = false;
    this.syncCamera();
  }
}
