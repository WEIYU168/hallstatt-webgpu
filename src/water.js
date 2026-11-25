// 清澈湖水：依水深由翡翠綠漸變到深藍綠、淺處透明可見卵石湖底、
// 兩層流動法線貼圖、菲涅耳反射（TSL reflector）、太陽閃光與岸邊細白邊。
import * as THREE from 'three';
import {
  reflector, texture, uniform, vec2, vec3, float, sin, time, positionWorld, cameraPosition,
  normalize, dot, reflect, max, min, pow, mix, clamp, smoothstep, exp,
} from 'three/tsl';
import { getTextures } from './textures.js';

// 與 terrain.js 的 lakeProfile 相同（TSL 版）
const profile = (u) => max(min(max(u.mul(0.8).add(1), u.add(2).mul(0.25).sub(0.6)), u.add(17).mul(0.9).sub(4.35)), -45);

export function buildWater(scene) {
  const T = getTextures();
  const refl = reflector({ resolutionScale: 0.5 });
  refl.target.rotateX(-Math.PI / 2);
  scene.add(refl.target);

  const P = positionWorld, x = P.x, z = P.z;
  // 解析水深
  const shore = sin(z.mul(0.012)).mul(5).add(sin(z.mul(0.041).add(1.3)).mul(2.5));
  const east = sin(z.mul(0.0025).add(0.6)).mul(90).add(sin(z.mul(0.007)).mul(40)).add(720);
  const south = z.sub(1150).sub(sin(x.mul(0.004)).mul(60));
  const bed = max(max(profile(shore.sub(x)), profile(x.sub(east))), profile(south));
  const depth = max(bed.negate(), 0);

  // 波紋法線（兩層不同尺度、方向的流動）
  const uvA = P.xz.mul(0.05).add(vec2(time.mul(0.011), time.mul(0.007)));
  const uvB = P.xz.mul(0.13).add(vec2(time.mul(-0.009), time.mul(0.016)));
  const nA = texture(T.water, uvA).xyz.mul(2).sub(1);
  const nB = texture(T.water, uvB).xyz.mul(2).sub(1);
  const wave = uniform(0.34); // 實景照片中的湖面相當平靜、倒影清楚
  const nxy = nA.xy.add(nB.xy.mul(0.7)).mul(wave);
  const N = normalize(vec3(nxy.x, 1, nxy.y));
  const V = normalize(cameraPosition.sub(P));

  // 反射（依法線扭曲）＋ Schlick 菲涅耳
  refl.uvNode = refl.uvNode.add(nxy.mul(0.022));
  const NdV = clamp(dot(N, V), 0, 1);
  const fresnel = clamp(float(0.02).add(pow(float(1).sub(NdV), 5).mul(0.98)), 0, 1);

  // 水體顏色：淺處翡翠綠 → 深處深藍綠；透明度依水深（清澈度）
  const shallow = uniform(new THREE.Color('#4fc2b0'));
  const deep = uniform(new THREE.Color('#0d5266'));
  const clarity = uniform(0.3);
  const body = mix(shallow, deep, smoothstep(0.3, 14, depth));
  const bodyAlpha = float(1).sub(exp(depth.mul(clarity).negate()));

  // 太陽閃光
  const sunDir = uniform(new THREE.Vector3(0, 1, 0));
  const sunColor = uniform(new THREE.Color(1, 1, 1));
  const glint = uniform(1);
  const spec = pow(max(dot(reflect(sunDir.negate(), N), V), 0), 380).mul(glint);

  // 岸邊細白邊
  const foam = float(1).sub(smoothstep(0.0, 0.14, depth)).mul(0.3).mul(sin(time.mul(1.5).add(x.mul(0.8)).add(z.mul(0.6))).mul(0.3).add(0.7));

  const color = mix(body, refl.rgb, fresnel).add(sunColor.mul(spec)).add(vec3(foam));
  const alpha = clamp(max(bodyAlpha, fresnel).add(foam).add(spec), 0, 1);

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true });
  mat.colorNode = color;
  mat.opacityNode = alpha;

  const geo = new THREE.PlaneGeometry(9000, 9000);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(300, 0, 0);
  mesh.renderOrder = 1;
  scene.add(mesh);

  return {
    mesh,
    set({ shallowColor, deepColor, sun, sunCol, glintAmount, waves }) {
      shallow.value.set(shallowColor);
      deep.value.set(deepColor);
      sunDir.value.copy(sun);
      sunColor.value.set(sunCol);
      glint.value = glintAmount;
      if (waves !== undefined) wave.value = waves;
    },
  };
}
