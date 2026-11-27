/**
 * HEX 介面主色：待機是藍色，萬劍歸宗化為 HEX 之後整個介面變紅色。
 * - Canvas 畫的部分讀 hexColor.rgb（例如 `rgba(${hexColor.rgb}, 0.5)`）
 * - CSS 讀 --hex-rgb 變數（body.hex-red 時換成紅色）
 * 換色時 Canvas 會在 0.6 秒內漸變。
 */

const BLUE = [0, 229, 255];
const RED = [255, 46, 70];
const BLUE_DARK = [0, 48, 61];
const RED_DARK = [61, 0, 10];
const FADE_MS = 600;

let red = false;
let changedAt = -1e9;

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(', ');

function k() {
  const p = Math.min(1, (performance.now() - changedAt) / FADE_MS);
  return red ? p : 1 - p;
}

export const hexColor = {
  /** 主色 "r, g, b" */
  get rgb() {
    return mix(BLUE, RED, k());
  },
  /** 深色底（核心內部） */
  get dark() {
    return `rgb(${mix(BLUE_DARK, RED_DARK, k())})`;
  },
  get isRed() {
    return red;
  },
  set(toRed: boolean) {
    if (toRed === red) return;
    // 漸變中途又換回來：從目前的顏色接著變
    const now = performance.now();
    const p = Math.min(1, (now - changedAt) / FADE_MS);
    changedAt = now - (1 - p) * FADE_MS;
    red = toRed;
    document.body.classList.toggle('hex-red', red);
  },
};
