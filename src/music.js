// 背景音樂：循環播放（跳過頭尾的靜音）、淡入淡出、可靜音，開啟明信片時自動調小聲。
// 瀏覽器規定要等使用者點擊或按鍵後才能播放聲音，所以第一次互動時才開始。
const PREF_KEY = 'hallstatt.music';

export function createMusic(url, { volume = 0.35, loopStart = 0.4, loopEnd = 176.5 } = {}) {
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0;

  let enabled = true;
  try { enabled = localStorage.getItem(PREF_KEY) !== 'off'; } catch { /* 無法存取儲存空間時預設開啟 */ }
  let started = false, ducked = false, fadeTimer = 0;
  const target = () => (ducked ? volume * 0.4 : volume);

  // 用計時器淡入淡出（視窗在背景時 requestAnimationFrame 會停）
  function fadeTo(v, ms, done) {
    clearInterval(fadeTimer);
    const from = audio.volume, t0 = performance.now();
    fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (v - from) * k));
      if (k >= 1) { clearInterval(fadeTimer); if (done) done(); }
    }, 40);
  }

  // 結尾的淡出與靜音結束前跳回開頭，循環時不會有長長的空白
  audio.addEventListener('timeupdate', () => {
    if (audio.currentTime >= loopEnd) audio.currentTime = loopStart;
  });

  function start() {
    if (started || !enabled) return;
    started = true;
    if (audio.currentTime < loopStart) audio.currentTime = loopStart;
    audio.play().then(() => fadeTo(target(), 3000)).catch(() => { started = false; }); // 還沒互動時會被擋，下一次互動再試
  }

  return {
    start,
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off'); } catch { /* 忽略 */ }
      if (enabled) {
        if (!started) start();
        else audio.play().then(() => fadeTo(target(), 800)).catch(() => {});
      } else {
        fadeTo(0, 600, () => audio.pause());
      }
      return enabled;
    },
    duck(on) {
      ducked = on;
      if (enabled && started) fadeTo(target(), 700);
    },
  };
}
