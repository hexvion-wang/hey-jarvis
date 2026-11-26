import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { toScreen, type Viewport } from './coords';

/** One Euro Filter：慢動作時強力平滑、快動作時降低延遲 */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff = 1.2, private beta = 0.008, private dCutoff = 1) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

export interface GestureConfig {
  /** 捏合比例 < 這個值 → 進入「捏」 */
  pinchEnter: number;
  /** 捏合比例 > 這個值 → 放開 */
  pinchExit: number;
  /** 進入捏需要連續幾幀，避免單幀雜訊 */
  enterFrames: number;
  /** 游標以螢幕中心放大的倍率，讓手不用伸到鏡頭邊緣 */
  gain: number;
}

export const DEFAULT_CONFIG: GestureConfig = {
  pinchEnter: 0.28,
  pinchExit: 0.42,
  enterFrames: 2,
  gain: 1.3,
};

export interface GestureState {
  hasHand: boolean;
  /** 平滑後的游標螢幕座標 */
  cursor: { x: number; y: number };
  pinching: boolean;
  /** 這一幀剛捏下（點擊事件） */
  pinchStart: boolean;
  /** 這一幀剛放開 */
  pinchEnd: boolean;
  /** 點擊位置：捏下前約 80ms 的游標位置（避免捏的動作讓游標跑掉） */
  clickPos: { x: number; y: number } | null;
  /** 拇指-食指距離 / 掌寬，除錯用 */
  ratio: number;
}

export class GestureTracker {
  private fx = new OneEuro();
  private fy = new OneEuro();
  private history: { x: number; y: number; t: number }[] = [];
  private pinching = false;
  private closeFrames = 0;

  readonly state: GestureState = {
    hasHand: false,
    cursor: { x: 0, y: 0 },
    pinching: false,
    pinchStart: false,
    pinchEnd: false,
    clickPos: null,
    ratio: 1,
  };

  constructor(public config: GestureConfig = DEFAULT_CONFIG) {}

  update(vp: Viewport, hand: NormalizedLandmark[] | undefined, tMs: number): GestureState {
    const s = this.state;
    s.pinchStart = false;
    s.pinchEnd = false;
    s.clickPos = null;

    if (!hand) {
      if (this.pinching) s.pinchEnd = true;
      this.pinching = false;
      this.closeFrames = 0;
      this.fx.reset();
      this.fy.reset();
      this.history = [];
      s.hasHand = false;
      s.pinching = false;
      return s;
    }
    s.hasHand = true;

    // ---- 捏合比例（用鏡頭像素座標算，避免長寬比失真）----
    const px = (i: number) => ({ x: hand[i].x * vp.videoW, y: hand[i].y * vp.videoH });
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const palm = dist(px(0), px(9)) || 1;
    s.ratio = dist(px(4), px(8)) / palm;

    // ---- 游標：拇指尖與食指尖的中點 ----
    const mid = toScreen(vp, (hand[4].x + hand[8].x) / 2, (hand[4].y + hand[8].y) / 2);
    const cx = vp.screenW / 2;
    const cy = vp.screenH / 2;
    const gx = cx + (mid.x - cx) * this.config.gain;
    const gy = cy + (mid.y - cy) * this.config.gain;
    s.cursor.x = Math.min(vp.screenW, Math.max(0, this.fx.filter(gx, tMs)));
    s.cursor.y = Math.min(vp.screenH, Math.max(0, this.fy.filter(gy, tMs)));

    this.history.push({ x: s.cursor.x, y: s.cursor.y, t: tMs });
    while (this.history.length && tMs - this.history[0].t > 250) this.history.shift();

    // ---- 遲滯判斷 ----
    if (!this.pinching) {
      this.closeFrames = s.ratio < this.config.pinchEnter ? this.closeFrames + 1 : 0;
      if (this.closeFrames >= this.config.enterFrames) {
        this.pinching = true;
        s.pinchStart = true;
        const past = this.history.find((h) => tMs - h.t <= 120) ?? this.history[0];
        s.clickPos = { x: past.x, y: past.y };
      }
    } else if (s.ratio > this.config.pinchExit) {
      this.pinching = false;
      this.closeFrames = 0;
      s.pinchEnd = true;
    }
    s.pinching = this.pinching;
    return s;
  }
}
