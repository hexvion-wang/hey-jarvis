const STANDBY = [79, 174, 255];
const ACTIVE = [48, 239, 201];
const STANDBY_DARK = [8, 30, 55];
const ACTIVE_DARK = [3, 52, 55];
const FADE_MS = 600;

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
