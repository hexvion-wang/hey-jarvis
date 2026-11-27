/**
 * 萬劍歸宗：HEX 的喚醒動畫（紅色粒子飛劍）。
 *
 * 喚醒（gather）：
 *   1. 萬劍來朝：飛劍分成幾股劍流，從畫面四周拖著光尾飛進來
 *   2. 劍陣：在中間繞成旋轉的圓環漩渦
 *   3. 歸宗：漩渦往內壓縮成一顆發亮的劍球
 *   4. 化為 HEX：劍球一閃變成核心，少數飛劍在外圈繞一下後淡出
 * 回待機（scatter）：核心炸開成萬劍，往四周飛走。
 *
 * 全部用 Canvas 2D 畫：預先畫好幾張「劍」的小圖，每把劍只做一次 drawImage（加色混合發光）。
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeIn = (k: number) => k * k * k;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

/** 各段時間（毫秒） */
const T_FLY = 2100; // 萬劍來朝（含每把劍最多約 1000ms 的出發延遲）
const T_RING = 1000; // 劍陣旋轉
const T_PRESS = 800; // 歸宗壓縮
const T_FORM = 1100; // 化為 HEX（閃光、外圈淡出）
const GATHER_MS = T_FLY + T_RING + T_PRESS + T_FORM;
const SCATTER_MS = 1900;

/** 核心出現的時間點（喚醒動畫開始後幾毫秒） */
export const SWORDS_CORE_AT = T_FLY + T_RING + T_PRESS;

interface Sword {
  // 起點（畫面外）與劍流的彎曲控制點（相對值，實際座標在播放時依畫面大小計算）
  sx: number;
  sy: number;
  bend: number;
  delay: number;
  // 在劍陣中的位置
  theta: number;
  band: number; // 圓環厚度方向的偏移（-1..1）
  // 劍球上的位置（球面座標）
  phi: number;
  // 散開時的方向與速度
  dir: number;
  speed: number;
  spin: number;
  /** 0..1：越大越靠內、越亮 */
  heat: number;
  /** 喚醒完成後留在外圈繞的劍 */
  orbiter: boolean;
  // 上一幀位置（算方向用）
  px: number;
  py: number;
}

type Mode = 'idle' | 'gather' | 'scatter';

export class Swords {
  private swords: Sword[] = [];
  private sprites: HTMLCanvasElement[] = [];
  private mode: Mode = 'idle';
  private t0 = 0;
  private skipAt = 0;

  constructor(count = 1800) {
    // 幾股劍流：每股從畫面外某個方向飛進來
    // 同一股的劍從幾乎同一點、一把接一把出發，排成一條長長的劍流，
    // 落在劍陣上「自己那一段」，依序鋪滿圓環
    const streams = 6;
    const sector = TAU / streams;
    for (let i = 0; i < count; i++) {
      const s = i % streams;
      const base = (s / streams) * TAU + 0.35;
      const frac = Math.random(); // 在這股劍流裡的先後（0 = 帶頭）
      const a = base + (Math.random() - 0.5) * 0.08;
      this.swords.push({
        sx: Math.cos(a) * (1.08 + Math.random() * 0.06),
        sy: Math.sin(a) * (1.08 + Math.random() * 0.06),
        bend: (s % 2 ? 1 : -1) * (0.45 + Math.random() * 0.08),
        delay: (s / streams) * 350 + frac * 650,
        theta: base + Math.PI / 2 + frac * sector * 1.15,
        band: (Math.random() + Math.random() - 1) * 1,
        phi: Math.acos(2 * Math.random() - 1),
        dir: Math.random() * TAU,
        speed: 0.6 + Math.random() * 0.9,
        spin: (Math.random() - 0.5) * 2,
        heat: Math.random(),
        orbiter: Math.random() < 0.12,
        px: NaN,
        py: NaN,
      });
    }
    this.sprites = [makeSprite('#7a0010', '#d4142a'), makeSprite('#c0102a', '#ff3a4e'), makeSprite('#ff4a5e', '#ffe0e6')];
  }

  get busy() {
    return this.mode !== 'idle';
  }

  /** 喚醒動畫播到哪：核心該不該顯示 */
  coreVisible(t: number) {
    if (this.mode !== 'gather') return true;
    return this.elapsed(t) >= SWORDS_CORE_AT;
  }

  /** 核心這時候的透明度（化為 HEX 時淡入） */
  coreAlpha(t: number) {
    if (this.mode !== 'gather') return 1;
    return clamp01((this.elapsed(t) - SWORDS_CORE_AT) / 300);
  }

  /** 喚醒是不是已經到「可以展開主控台」的時間 */
  ready(t: number) {
    return this.mode !== 'gather' || this.elapsed(t) >= SWORDS_CORE_AT + 250;
  }

  gather(t: number) {
    this.mode = 'gather';
    this.t0 = t;
    this.skipAt = 0;
    for (const s of this.swords) s.px = NaN;
  }

  scatter(t: number) {
    this.mode = 'scatter';
    this.t0 = t;
    this.skipAt = 0;
    for (const s of this.swords) s.px = NaN;
  }

  /** 點一下跳過：直接跳到「化為 HEX」 */
  skip(t: number) {
    if (this.mode === 'gather' && this.elapsed(t) < SWORDS_CORE_AT) this.skipAt = t;
    else if (this.mode === 'scatter') this.mode = 'idle';
  }

  private elapsed(t: number) {
    const e = t - this.t0;
    // 跳過：從按下的那一刻起，0.25 秒內追到核心出現的時間點
    if (this.skipAt) return Math.max(e, SWORDS_CORE_AT - 250 + (t - this.skipAt));
    return e;
  }

  draw(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, coreR: number) {
    if (this.mode === 'idle') return;
    const e = this.elapsed(t);
    const total = this.mode === 'gather' ? GATHER_MS : SCATTER_MS;
    if (e >= total) {
      this.mode = 'idle';
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const m = Math.min(W, H);
    const ringR = m * 0.3;
    const dpr = ctx.getTransform().a || 1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (this.mode === 'gather') this.drawGather(ctx, e, cx, cy, W, H, ringR, coreR, dpr);
    else this.drawScatter(ctx, e, cx, cy, W, H, coreR, dpr);
    ctx.restore();
  }

  /** 劍陣圓環上的位置（會旋轉，帶一點呼吸起伏） */
  private ringPos(s: Sword, e: number, cx: number, cy: number, R: number, spinK: number) {
    const ang = s.theta + spinK;
    const r = R * (1 + s.band * 0.13 + 0.03 * Math.sin(ang * 3 + e / 300));
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.92 };
  }

  /** 劍球上的位置（3D 球面投影，球會轉） */
  private ballPos(s: Sword, cx: number, cy: number, r: number, rot: number) {
    const th = s.theta + rot;
    const x = Math.sin(s.phi) * Math.cos(th);
    const y = Math.cos(s.phi);
    const z = Math.sin(s.phi) * Math.sin(th);
    const tilt = 0.45;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return { x: cx + x * r, y: cy + y2 * r, z: z2 };
  }

  private drawGather(
    ctx: CanvasRenderingContext2D,
    e: number,
    cx: number,
    cy: number,
    W: number,
    H: number,
    ringR: number,
    coreR: number,
    dpr: number,
  ) {
    // 劍陣的旋轉角度：轉速先慢後快（越壓縮越快）
    const ringStart = T_FLY - 500;
    const spinAt = (ms: number) => {
      const a = Math.max(0, ms - ringStart) / 1000;
      const press = Math.max(0, ms - T_FLY - T_RING) / 1000;
      return a * 1.6 + press * press * 9;
    };
    const spin = spinAt(e);
    const pressK = easeIn(clamp01((e - T_FLY - T_RING) / T_PRESS));
    const formE = e - SWORDS_CORE_AT;
    const ballR = coreR * 1.25;

    for (const s of this.swords) {
      let x: number;
      let y: number;
      let alpha = 1;
      let heat = s.heat * 0.6;
      let len = 1;

      if (e < T_FLY) {
        // 萬劍來朝：沿著彎曲路徑從畫面外飛到劍陣上的位置
        const k = clamp01((e - s.delay) / (T_FLY - 1000));
        if (k <= 0) continue;
        // 一進畫面就很快，接近劍陣時慢下來（劍流在畫面上停留比較久）
        const q = 1 - (1 - k) * (1 - k);
        const end = this.ringPos(s, e, cx, cy, ringR, spin);
        const sx = cx + s.sx * W * 0.55;
        const sy = cy + s.sy * H * 0.55;
        // 控制點：往側邊彎，形成弧形劍流
        const mx = (sx + end.x) / 2 - (end.y - sy) * s.bend;
        const my = (sy + end.y) / 2 + (end.x - sx) * s.bend;
        x = (1 - q) * (1 - q) * sx + 2 * (1 - q) * q * mx + q * q * end.x;
        y = (1 - q) * (1 - q) * sy + 2 * (1 - q) * q * my + q * q * end.y;
        alpha = clamp01(k * 6);
        len = 2.2 - q * 1.2;
      } else if (formE < 0) {
        // 劍陣 → 歸宗：圓環壓縮成劍球
        const ring = this.ringPos(s, e, cx, cy, ringR, spin);
        const ball = this.ballPos(s, cx, cy, ballR, spin);
        x = lerp(ring.x, ball.x, pressK);
        y = lerp(ring.y, ball.y, pressK);
        // 劍球：只有朝向你的那一面最亮，背面暗一點（不然會整顆過曝成白色）
        const front = (ball.z + 1) / 2;
        heat = lerp(s.heat * 0.6, 0.15 + 0.75 * front, pressK);
        alpha = lerp(1, 0.35 + 0.5 * front, pressK);
        len = 1 + pressK * 0.4;
      } else {
        // 化為 HEX：大部分飛劍收進核心消失，外圈留一些繞著淡出
        const k = clamp01(formE / T_FORM);
        if (s.orbiter) {
          const ang = s.theta + spin + k * 2.2;
          const r = lerp(ballR, coreR * (2.2 + s.band * 0.5), easeOut(k));
          x = cx + Math.cos(ang) * r;
          y = cy + Math.sin(ang) * r * 0.92;
          alpha = 1 - easeIn(k);
          heat = 0.5;
        } else {
          const ball = this.ballPos(s, cx, cy, ballR * (1 - easeOut(clamp01(k * 3)) * 0.7), spin);
          x = ball.x;
          y = ball.y;
          alpha = (1 - clamp01(k * 3)) * 0.6;
          heat = 0.7;
        }
        if (alpha <= 0.01) {
          s.px = NaN;
          continue;
        }
      }
      this.drawSword(ctx, s, x, y, alpha, heat, len, dpr);
    }

    // 歸宗的瞬間：中心一道閃光
    if (formE > -150 && formE < 700) {
      const k = formE < 0 ? (formE + 150) / 150 : 1 - formE / 700;
      const r = coreR * (2 + (formE > 0 ? formE / 120 : 0));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
      g.addColorStop(0, `rgba(255, 235, 240, ${0.85 * k})`);
      g.addColorStop(0.25, `rgba(255, 70, 90, ${0.5 * k})`);
      g.addColorStop(1, 'rgba(120, 0, 20, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
      // 擴散的衝擊波圈
      if (formE > 0) {
        ctx.strokeStyle = `rgba(255, 80, 100, ${0.6 * k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * (1.2 + formE / 90), 0, TAU);
        ctx.stroke();
      }
    }
  }

  private drawScatter(
    ctx: CanvasRenderingContext2D,
    e: number,
    cx: number,
    cy: number,
    W: number,
    H: number,
    coreR: number,
    dpr: number,
  ) {
    const k = e / SCATTER_MS;
    const far = Math.hypot(W, H) * 0.7;
    for (const s of this.swords) {
      // 先在核心周圍轉一下，再往外射出
      const burst = easeIn(clamp01((k - 0.1 - s.heat * 0.12) / 0.8));
      const ang = s.dir + s.spin * k * 1.5;
      // 一開始在核心外圍散成一圈（不要全部疊在一點，會變成一顆白球）
      const r = coreR * (1 + s.band * 0.25 + Math.min(k, 0.12) * 6) + burst * far * s.speed;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      const alpha = (0.45 + 0.55 * burst) * (1 - easeIn(clamp01((k - 0.55) / 0.45)));
      this.drawSword(ctx, s, x, y, alpha, 0.3 + s.heat * 0.5 - burst * 0.3, 1 + burst, dpr);
    }
  }

  /** 畫一把劍：方向跟著移動方向，速度越快光尾越長 */
  private drawSword(
    ctx: CanvasRenderingContext2D,
    s: Sword,
    x: number,
    y: number,
    alpha: number,
    heat: number,
    len: number,
    dpr: number,
  ) {
    let dx = x - s.px;
    let dy = y - s.py;
    s.px = x;
    s.py = y;
    if (!Number.isFinite(dx) || (dx === 0 && dy === 0)) {
      dx = Math.cos(s.dir);
      dy = Math.sin(s.dir);
    }
    const d = Math.hypot(dx, dy);
    const cos = dx / d;
    const sin = dy / d;
    const stretch = Math.min(2.6, len * (0.8 + d * 0.06));
    const img = this.sprites[heat > 0.8 ? 2 : heat > 0.4 ? 1 : 0];
    ctx.globalAlpha = alpha;
    // 劍圖是「劍尖朝右」：旋轉到移動方向，往後拉長當光尾
    ctx.setTransform(dpr * cos * stretch, dpr * sin * stretch, -dpr * sin, dpr * cos, dpr * x, dpr * y);
    ctx.drawImage(img, -img.width + 4, -img.height / 2);
  }
}

/** 預先畫一把「劍」：劍尖朝右，後面接一段漸淡的光尾 */
function makeSprite(dark: string, bright: string) {
  const c = document.createElement('canvas');
  c.width = 30;
  c.height = 7;
  const g = c.getContext('2d')!;
  const cy = c.height / 2;
  // 光尾
  const trail = g.createLinearGradient(0, 0, 18, 0);
  trail.addColorStop(0, 'rgba(0,0,0,0)');
  trail.addColorStop(1, dark);
  g.fillStyle = trail;
  g.fillRect(0, cy - 0.75, 18, 1.5);
  // 劍柄與護手
  g.fillStyle = dark;
  g.fillRect(16, cy - 0.8, 4, 1.6);
  g.fillRect(19.5, cy - 2.6, 1.3, 5.2);
  // 劍身（越到劍尖越亮）
  const blade = g.createLinearGradient(21, 0, 30, 0);
  blade.addColorStop(0, bright);
  blade.addColorStop(1, '#fff4f6');
  g.fillStyle = blade;
  g.beginPath();
  g.moveTo(21, cy - 1.1);
  g.lineTo(27.5, cy - 0.8);
  g.lineTo(30, cy);
  g.lineTo(27.5, cy + 0.8);
  g.lineTo(21, cy + 1.1);
  g.closePath();
  g.fill();
  return c;
}
