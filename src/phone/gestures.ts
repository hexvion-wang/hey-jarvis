import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { toScreen, type Viewport } from './coords';

/** One Euro Filter：慢動作時強力平滑、快動作時降低延遲 */
export class OneEuro {
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
  /** 未平滑的游標位置（0~1，已鏡像，以鏡頭畫面為準），給遠端控制用 */
  raw: { x: number; y: number };
  /** 五指張開（手掌攤開） */
  open: boolean;
  /** 手型（穩定 3 幀以上才會改變）：給萬劍歸宗用 */
  pose: HandPose;
}

/** open 張開手掌、fist 握拳、sword 劍指（食指＋中指）、rock 🤟（拇指＋食指＋小指）、point 只伸食指 */
export type HandPose = 'none' | 'open' | 'fist' | 'sword' | 'rock' | 'point' | 'other';

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
    raw: { x: 0.5, y: 0.5 },
    open: false,
    pose: 'none',
  };
  private poseRaw: HandPose = 'none';
  private poseFrames = 0;

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
      s.pose = 'none';
      this.poseFrames = 0;
      return s;
    }
    s.hasHand = true;

    // ---- 捏合比例（用鏡頭像素座標算，避免長寬比失真）----
    const px = (i: number) => ({ x: hand[i].x * vp.videoW, y: hand[i].y * vp.videoH });
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const palm = dist(px(0), px(9)) || 1;
    s.ratio = dist(px(4), px(8)) / palm;

    s.raw = { x: 1 - (hand[4].x + hand[8].x) / 2, y: (hand[4].y + hand[8].y) / 2 };

    // ---- 五指張開：四指指尖離手腕比第二指節遠很多，拇指也張開，而且不是在捏 ----
    const w = px(0);
    const extended = (tip: number, pip: number) => dist(px(tip), w) > dist(px(pip), w) * 1.25;
    const fingers = extended(8, 6) && extended(12, 10) && extended(16, 14) && extended(20, 18);
    const thumbOut = dist(px(4), px(5)) / palm > 0.4;
    s.open = fingers && thumbOut && s.ratio > 0.7;

    // ---- 手型：每根手指是伸直還是彎起來 ----
    const curled = (tip: number, pip: number) => dist(px(tip), w) < dist(px(pip), w) * 1.05;
    const [iE, mE, pE] = [extended(8, 6), extended(12, 10), extended(20, 18)];
    const [iC, mC, rC, pC] = [curled(8, 6), curled(12, 10), curled(16, 14), curled(20, 18)];
    let pose: HandPose = 'other';
    if (s.open) pose = 'open';
    else if (iC && mC && rC && pC) pose = 'fist';
    else if (iE && mE && rC && pC) pose = 'sword';
    else if (iE && pE && mC && rC) pose = 'rock';
    else if (iE && mC && rC && pC) pose = 'point';
    // 連續 3 幀一樣才算數，避免手轉動時一直跳
    if (pose === this.poseRaw) this.poseFrames++;
    else {
      this.poseRaw = pose;
      this.poseFrames = 1;
    }
    if (this.poseFrames >= 3) s.pose = pose;

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

/**
 * 雙手合十（手指交扣、兩手掌貼在一起），持續約 0.5 秒 → 觸發一次；分開後才能再觸發。
 * 兩手交扣時常常會被認成「一隻手」，所以兩種情況都算：
 * - 認到兩隻手，而且兩個手掌中心很近
 * - 剛剛才看到兩隻手靠在一起，接著變成一隻手，而且這隻手就在剛才兩手中間（兩手合成一團）
 */
export class ClaspDetector {
  private since = 0;
  private lastSeen = 0;
  private armed = true;
  /** 最近一次「兩隻手靠近」的時間、位置與手掌大小 */
  private pairT = -1e9;
  private pairMid = { x: 0, y: 0 };
  private palm = 1;
  /** 0~1：合十維持的進度（畫面提示用） */
  progress = 0;

  constructor(private holdMs = 500) {}

  update(vp: Viewport, hands: NormalizedLandmark[][], t: number): boolean {
    const px = (h: NormalizedLandmark[], i: number) => ({ x: h[i].x * vp.videoW, y: h[i].y * vp.videoH });
    const center = (h: NormalizedLandmark[]) => {
      const p = [0, 5, 9, 13, 17].map((i) => px(h, i));
      return { x: p.reduce((s, v) => s + v.x, 0) / 5, y: p.reduce((s, v) => s + v.y, 0) / 5 };
    };
    const size = (h: NormalizedLandmark[]) => Math.hypot(px(h, 0).x - px(h, 9).x, px(h, 0).y - px(h, 9).y) || 1;

    let close = false;
    if (hands.length >= 2) {
      const a = center(hands[0]);
      const b = center(hands[1]);
      const palm = (size(hands[0]) + size(hands[1])) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y) / palm;
      if (d < 1.4) {
        this.pairT = t;
        this.pairMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.palm = palm;
      }
      close = d < 1.1;
      if (d > 1.8) this.armed = true; // 分得夠開才重新啟用
    } else if (hands.length === 1) {
      // 兩手合成一團：剛剛（0.9 秒內）兩手還靠在一起，或已經在合十中，而且這隻「手」就在兩手中間
      const c = center(hands[0]);
      const near = Math.hypot(c.x - this.pairMid.x, c.y - this.pairMid.y) / this.palm < 1.2;
      if (near && (t - this.pairT < 900 || this.since)) {
        close = true;
        // 跟著那一團移動一點點
        this.pairMid = { x: this.pairMid.x * 0.8 + c.x * 0.2, y: this.pairMid.y * 0.8 + c.y * 0.2 };
      }
      if (!near) this.armed = true;
    } else if (t - this.lastSeen > 600) {
      this.armed = true; // 手都放下了
    }

    if (close) {
      this.lastSeen = t;
      // 觸發過、還沒分開之前不重新計時（不然一分開就會又觸發一次）
      if (!this.since && this.armed) this.since = t;
    } else if (t - this.lastSeen > 200) {
      this.since = 0; // 偶爾一兩幀沒抓到不算放開
    }
    this.progress = this.since && this.armed ? Math.min(1, (t - this.since) / this.holdMs) : 0;
    if (this.armed && this.since && t - this.since >= this.holdMs) {
      this.armed = false;
      this.since = 0;
      this.progress = 0;
      return true;
    }
    return false;
  }
}
