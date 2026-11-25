// 背景執行緒：依主執行緒指派的名單產生材質像素，完成一張就回傳一張（像素陣列直接轉移，不複製）
import { RECIPES } from './texgen.js';

function buffersOf(res, out = []) {
  if (res.set) Object.values(res.set).forEach((t) => buffersOf(t, out));
  else if (res.list) res.list.forEach((t) => buffersOf(t, out));
  else if (res.data && !out.includes(res.data.buffer)) out.push(res.data.buffer);
  return out;
}

self.onmessage = (e) => {
  for (const name of e.data.names) {
    const t0 = performance.now();
    const res = RECIPES[name]();
    self.postMessage({ name, res, ms: Math.round(performance.now() - t0) }, buffersOf(res));
  }
};
