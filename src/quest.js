// 明信片任務：每個景點有一張漂浮的小明信片（地上光環＋柔和光柱），收集後交給明信片系統
import * as THREE from 'three';
import { getTextures } from './textures.js';

function postcardFace(no, back) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 170;
  const g = c.getContext('2d');
  g.fillStyle = '#f6efdf'; g.fillRect(0, 0, 256, 170);
  // 航空郵件斜紋邊框
  for (let i = -20; i < 300; i += 22) {
    g.fillStyle = (i / 22) % 2 ? '#c0392b' : '#2c4a7c';
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 11, 0); g.lineTo(i - 1, 10); g.lineTo(i - 12, 10); g.fill();
    g.beginPath(); g.moveTo(i, 160); g.lineTo(i + 11, 160); g.lineTo(i - 1, 170); g.lineTo(i - 12, 170); g.fill();
  }
  g.strokeStyle = '#8b6a44'; g.lineWidth = 2; g.strokeRect(14, 18, 228, 134);
  if (back) {
    g.fillStyle = '#3b2a1a'; g.font = 'italic 26px Georgia, serif'; g.fillText('Grüße aus', 28, 64);
    g.font = 'bold 34px Georgia, serif'; g.fillText('Hallstatt', 28, 104);
    g.strokeStyle = '#b89a72'; g.lineWidth = 1;
    for (let y = 120; y < 148; y += 12) { g.beginPath(); g.moveTo(28, y); g.lineTo(150, y); g.stroke(); }
  } else {
    // 小水彩：山、湖、尖塔
    const grd = g.createLinearGradient(0, 24, 0, 146);
    grd.addColorStop(0, '#bcd8e6'); grd.addColorStop(0.55, '#e9f1ec'); grd.addColorStop(0.56, '#5aa79c'); grd.addColorStop(1, '#2f6f73');
    g.fillStyle = grd; g.fillRect(20, 24, 216, 122);
    g.fillStyle = '#3f7a64';
    g.beginPath(); g.moveTo(20, 92); g.lineTo(70, 40); g.lineTo(110, 78); g.lineTo(150, 34); g.lineTo(236, 90); g.lineTo(236, 92); g.fill();
    g.fillStyle = '#f2ece0'; g.fillRect(150, 70, 6, 22);
    g.beginPath(); g.moveTo(148, 70); g.lineTo(153, 46); g.lineTo(158, 70); g.fill();
    for (let i = 0; i < 6; i++) { g.fillStyle = ['#f3d98f', '#eab39a', '#f2efe6', '#bfd0dc'][i % 4]; g.fillRect(40 + i * 17, 80, 14, 12); }
  }
  // 郵票
  g.fillStyle = '#fbf7ee'; g.fillRect(196, 26, 40, 48);
  g.fillStyle = '#2f6f73'; g.fillRect(200, 30, 32, 40);
  g.fillStyle = '#fff'; g.font = 'bold 18px Georgia, serif'; g.textAlign = 'center'; g.fillText(String(no), 216, 58);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Quest {
  constructor(scene, world, spots, onCollect) {
    this.onCollect = onCollect;
    const T = getTextures();
    const edge = new THREE.MeshBasicMaterial({ color: 0xf6efdf });
    const ringMat = new THREE.MeshBasicMaterial({ map: T.ring, color: 0xffd98a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xffd98a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.3 });
    const ringGeo = new THREE.PlaneGeometry(2.6, 2.6); ringGeo.rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.22, 0.3, 12, 16, 1, true); beamGeo.translate(0, 6, 0);
    this.items = spots.map((s, i) => {
      const g = new THREE.Group();
      const ground = s.water ? 0 : world.groundAt(s.x, s.z, 999);
      g.position.set(s.x, ground, s.z);
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.47, 0.012), [edge, edge, edge, edge,
        new THREE.MeshBasicMaterial({ map: postcardFace(i + 1, false) }), new THREE.MeshBasicMaterial({ map: postcardFace(i + 1, true) })]);
      card.position.y = 1.55;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.06;
      ring.renderOrder = 3;
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.renderOrder = 3;
      g.add(card, ring, beam);
      if (s.water) { // 紅白浮標
        const buoy = new THREE.Group();
        const red = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }), white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 });
        const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 14), red);
        const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.35, 14), white); b2.position.y = 0.42;
        const b3 = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 14), red); b3.position.y = 0.79;
        buoy.add(b1, b2, b3);
        buoy.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        g.add(buoy);
        g.userData.buoy = buoy;
        card.position.y = 2.1;
      }
      scene.add(g);
      return { ...s, i, g, card, ring, got: false };
    });
    this.total = this.items.length;
    this.got = 0;
  }

  setVisible(v) { for (const it of this.items) it.g.visible = v && !it.got; }

  update(p, t, enabled, ui) {
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      if (it.got) continue;
      it.card.rotation.y = t * 1.2 + it.i;
      it.card.position.y = (it.water ? 2.1 : 1.55) + Math.sin(t * 2 + it.i) * 0.12;
      const pulse = 1 + 0.12 * Math.sin(t * 3 + it.i);
      it.ring.scale.set(pulse, 1, pulse);
      if (it.g.userData.buoy) { it.g.userData.buoy.position.y = Math.sin(t * 1.4) * 0.06 - 0.15; it.g.userData.buoy.rotation.z = Math.sin(t) * 0.05; }
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      const reach = it.water ? 4.5 : 3;
      if (enabled && d < reach && Math.abs(p.y - it.g.position.y) < 4) {
        it.got = true; it.g.visible = false; this.got++;
        this.onCollect(it, this.got, this.total);
        continue;
      }
      if (d < bestD) { bestD = d; best = it; }
    }
    ui.count(this.got, this.total);
    ui.nearest(best ? `最近的明信片：${best.title} · ${Math.round(bestD)} m${best.water ? '（要搭船）' : ''}` : '全部收集完成！按 P 翻閱明信片冊');
  }
}
