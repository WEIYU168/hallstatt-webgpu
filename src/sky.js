// 天空：兩層程式雲（TSL 著色器）——
//   層積雲：以雜訊貼圖做域扭曲、沿風向拉長成柔軟的雲絲與雲團，往太陽方向再取樣計算受光，
//           薄處透出藍天、厚處偏灰藍、靠近太陽的雲邊有銀邊；
//   卷雲：更高、更細長的羽絲。
// 另有山腰低垂的雲霧帶與湖面晨霧。雲會倒映在湖面上（反射相機也會畫天空穹頂）。
import * as THREE from 'three';
import { uniform, positionWorld, cameraPosition, vec2, float, time, texture, normalize, dot, mix, smoothstep, max, clamp, pow } from 'three/tsl';
import { getTextures } from './textures.js';
import { shoreX } from './terrain.js';

export function buildSky(scene, rng) {
  const T = getTextures();
  const tex = T.cloudNoise;
  const U = {
    sun: uniform(new THREE.Vector3(0, 1, 0)), sunCol: uniform(new THREE.Color(1, 1, 1)),
    lit: uniform(new THREE.Color('#ffffff')), shade: uniform(new THREE.Color('#9fb0c2')), horizon: uniform(new THREE.Color('#c8d8e4')),
    cov: uniform(0.5), cov2: uniform(0.55), opacity: uniform(0.95), cirrus: uniform(0.5),
  };
  const dir = normalize(positionWorld.sub(cameraPosition));
  const up = dir.y;
  const proj = dir.xz.div(max(up, 0).add(0.09)); // 投影到雲層：地平線附近壓縮，像弧形的天穹
  const t = time.mul(0.004);

  // 層積雲：輕微沿風向拉長，兩層域扭曲讓雲團邊緣捲曲、破碎成羽狀
  const wind = vec2(0.83, 0.56), side = vec2(-0.56, 0.83);
  const P = proj.mul(0.85).add(cameraPosition.xz.mul(0.00033)).add(wind.mul(t));
  const toQ = (p) => vec2(dot(p, wind).mul(0.62), dot(p, side).mul(1.0));
  const Q = toQ(P);
  const warpA = texture(tex, Q.mul(0.37).add(vec2(0.13, 0.71))).rg.sub(0.5);
  const warpB = texture(tex, Q.mul(1.3).add(warpA).add(vec2(0.57, 0.29))).ba.sub(0.5);
  const Qw = Q.add(warpA.mul(0.1)).add(warpB.mul(0.035)); // 扭曲量要小於雲團尺度，否則會折成大理石紋
  const density = (q) => texture(tex, q).r.mul(0.55).add(texture(tex, q.mul(2.1).add(vec2(0.31, 0.17))).g.mul(0.45));
  const fine = texture(tex, Qw.mul(6.1).add(vec2(t.mul(2.5), 0.5))).a;
  const d0 = density(Qw);
  const erode = fine.mul(0.2).mul(float(1).sub(smoothstep(U.cov, U.cov.add(0.3), d0))); // 只侵蝕雲的邊緣
  const d = d0.sub(erode);
  const dens = smoothstep(U.cov, U.cov.add(0.26), d);
  const thick = smoothstep(U.cov.add(0.05), U.cov.add(0.4), d);
  // 受光：沿太陽方向偏移再取樣，太陽那側較密 → 這裡被遮蔽
  const dSun = density(Qw.add(toQ(U.sun.xz).mul(0.035))).sub(erode);
  const shadow = clamp(dSun.sub(d).mul(3.0).add(thick.mul(0.55)), 0, 1);
  const mu = max(dot(dir, U.sun), 0);
  const silver = pow(mu, 8).mul(float(1).sub(thick)).mul(0.9);
  const col1 = mix(U.lit, U.shade, shadow.mul(0.8)).add(U.sunCol.mul(silver));
  const a1 = dens.mul(float(0.5).add(thick.mul(0.5))).mul(U.opacity);

  // 卷雲：較短的羽絲，只出現在一塊塊區域裡
  const w2 = vec2(0.6, 0.8), s2 = vec2(-0.8, 0.6);
  const P2 = proj.mul(0.5).add(cameraPosition.xz.mul(0.00014)).add(vec2(t.mul(1.6), t.mul(0.4)));
  const Q2 = vec2(dot(P2, w2).mul(0.38), dot(P2, s2).mul(1.4));
  const warp2 = texture(tex, Q2.mul(0.5).add(vec2(0.37, 0.37))).br.sub(0.5);
  const c2 = texture(tex, Q2.add(warp2.mul(0.12))).b;
  const fib = texture(tex, Q2.mul(vec2(1.0, 3.2)).add(warp2)).a;
  const patch = smoothstep(0.42, 0.68, texture(tex, P2.mul(0.16).add(vec2(0.71, 0.23))).r);
  const a2 = smoothstep(U.cov2, U.cov2.add(0.25), c2.mul(0.7).add(fib.mul(0.3))).mul(patch).mul(U.cirrus).mul(0.42);
  const col2 = mix(U.lit, U.shade, 0.25).add(U.sunCol.mul(pow(mu, 6).mul(0.5)));

  // 疊加：卷雲在後、層積雲在前；靠近地平線淡出並染上地平線的霧色
  const fade = smoothstep(0.0, 0.14, up);
  const A1 = a1.mul(fade), A2 = a2.mul(fade);
  const alpha = A1.add(A2.mul(float(1).sub(A1)));
  const rgb = col1.mul(A1).add(col2.mul(A2).mul(float(1).sub(A1))).div(max(alpha, 0.0001));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide });
  mat.fog = false;
  mat.colorNode = mix(rgb, U.horizon, float(1).sub(smoothstep(0.0, 0.35, up)).mul(0.6));
  mat.opacityNode = clamp(alpha, 0, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.53), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  // 山腰的雲霧帶：沿著兩岸山壁、低低掛在半山腰
  const banks = new THREE.Group();
  const spots = [];
  for (let i = 0; i < 9; i++) spots.push([-180 - rng() * 420, -700 + i * 190 + rng() * 80, 230 + rng() * 420]); // 西岸（村後）
  for (let i = 0; i < 8; i++) spots.push([760 + rng() * 260, -900 + i * 260 + rng() * 120, 180 + rng() * 380]); // 東岸
  for (let i = 0; i < 4; i++) spots.push([-100 + i * 260 + rng() * 80, 1250 + rng() * 200, 300 + rng() * 500]); // 南方
  for (const [x, z, y] of spots) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.banks[Math.floor(rng() * T.banks.length)], transparent: true, depthWrite: false, opacity: 0.4 }));
    const w = 420 + rng() * 520;
    sp.position.set(x, y, z);
    sp.scale.set(w, w * (0.2 + rng() * 0.12), 1);
    sp.userData = { base: x, ph: rng() * 6.28, k: 0.7 + rng() * 0.3 };
    banks.add(sp);
  }
  scene.add(banks);

  // 湖面晨霧：貼著水面的低矮霧帶
  const mist = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const z = -650 + rng() * 1300;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.mist, transparent: true, depthWrite: false, opacity: 0 }));
    sp.position.set(shoreX(z) + 40 + rng() * 520, 5 + rng() * 10, z);
    const w = 220 + rng() * 260;
    sp.scale.set(w, w * 0.16, 1);
    sp.userData = { base: sp.position.x, speed: 2 + rng() * 3, ph: rng() * 6.28 };
    mist.add(sp);
  }
  scene.add(mist);

  let mistLevel = 0, bankLevel = 0.4;
  return {
    setTime(tm, sunDir) {
      U.lit.value.set(tm.cloudLit); U.shade.value.set(tm.cloudShade); U.horizon.value.set(tm.fog);
      U.sunCol.value.set(tm.sun);
      if (sunDir) U.sun.value.copy(sunDir);
      U.cov.value = tm.cloudCov; U.cov2.value = tm.cirrusCov; U.opacity.value = tm.cloudAlpha; U.cirrus.value = tm.cirrus;
      banks.children.forEach((c) => c.material.color.set(tm.cloudLit));
      bankLevel = tm.bank;
      mistLevel = tm.mist;
    },
    update(time) {
      for (const s of banks.children) {
        const u = s.userData;
        s.position.x = u.base + Math.sin(time * 0.01 + u.ph) * 40;
        s.material.opacity = bankLevel * u.k * (0.8 + 0.2 * Math.sin(time * 0.05 + u.ph));
      }
      for (const s of mist.children) {
        const u = s.userData;
        s.position.x = u.base + Math.sin(time * 0.03 + u.ph) * 40;
        s.material.opacity = mistLevel * (0.55 + 0.45 * Math.sin(time * 0.2 + u.ph));
      }
    },
  };
}
