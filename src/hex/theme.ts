// 2026-11-28 使用者選參考圖的「電藍色＋橘色點綴」：待機暗一點的電藍、喚醒後亮電藍（不再變藍綠）
const STANDBY = [46, 122, 228];
const ACTIVE = [72, 178, 255];
const STANDBY_DARK = [5, 18, 44];
const ACTIVE_DARK = [6, 28, 62];
const FADE_MS = 600;

/** 橘色點綴（警示條、重點刻度、hover） */
export const ACCENT = '255, 138, 42';

let active = false;
let changedAt = -1e9;

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(', ');

function k() {
  const p = Math.min(1, (performance.now() - changedAt) / FADE_MS);
  return active ? p : 1 - p;
}

export const hexColor = {
  /** 主色 "r, g, b" */
  get rgb() {
    return mix(STANDBY, ACTIVE, k());
  },
  /** 深色底（核心內部） */
  get dark() {
    return `rgb(${mix(STANDBY_DARK, ACTIVE_DARK, k())})`;
  },
  /** 0（待機）~ 1（喚醒）：介面亮度 */
  get level() {
    return k();
  },
  get isActive() {
    return active;
  },
  set(toActive: boolean) {
    if (toActive === active) return;
    // 漸變中途又換回來：從目前的顏色接著變
    const now = performance.now();
    const p = Math.min(1, (now - changedAt) / FADE_MS);
    changedAt = now - (1 - p) * FADE_MS;
    active = toActive;
    document.body.classList.toggle('hex-active', active);
  },
};
