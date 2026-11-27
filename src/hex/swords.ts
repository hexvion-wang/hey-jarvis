/**
 * 萬劍歸宗：HEX 的喚醒動畫（紅色粒子飛劍），可以用 iPhone 手勢操控。
 *
 * 叫醒後萬劍從畫面四周飛進來，在中間盤旋等你：
 *   ✌ 劍指（食指＋中指）→ 劍流跟著手飛
 *   ✋ 張開手掌           → 聚成旋轉劍環
 *   ✊ 握拳               → 壓成劍球，握住約 1 秒 → 化為 HEX（喚醒完成）
 *   🤟                    → 萬劍齊發，朝四周射出去，再飛回來
 * 沒有手（沒連 iPhone 或手不在鏡頭裡）就照「盤旋 → 劍環 → 劍球 → 化為 HEX」慢慢自動播（約 9 秒）。
 * 回待機：核心炸開成萬劍，往四周飛走。
 *
 * 做法：每把劍有自己的位置和速度，像彈簧一樣追著「目前陣形」給它的目標點，
 * 所以換手勢時劍群會自然地轉向、重新排隊。用 Canvas 2D 畫預先做好的劍圖（加色混合發光）。
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeIn = (k: number) => k * k * k;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

export type SwordPose = 'none' | 'open' | 'fist' | 'sword' | 'rock' | 'point' | 'other';
export interface SwordInput {
  pose: SwordPose;
  x: number;
  y: number;
}

/** 陣形：enter 飛入、hover 盤旋等待、stream 跟手、ring 劍環、ball 劍球、burst 萬劍齊發、form 化為 HEX */
type Formation = 'enter' | 'hover' | 'stream' | 'ring' | 'ball' | 'burst' | 'form';

const ENTER_MS = 4800; // 飛入（含出發延遲）
const FORM_MS = 2000; // 化為 HEX
const BALL_HOLD_MS = 1100; // 握拳多久才歸宗
const BURST_MS = 1300; // 萬劍齊發後飛回
const SCATTER_MS = 1900;
/** 自動播放（沒有手）時各段長度 */
const AUTO = { hover: 6000, ring: 5600, ball: 2600 };
/** 有手但一直沒握拳：最多等這麼久就自動歸宗 */
const MAX_WAIT_MS = 40000;

interface Sword {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 彈簧強度、阻尼（每把不同，劍群看起來比較自然） */
  k: number;
  damp: number;
  // 飛入
  sx: number;
  sy: number;
  delay: number;
  // 陣形中的位置
  theta: number;
  band: number;
  phi: number;
  frac: number;
  // 散開
  dir: number;
  speed: number;
  spin: number;
  heat: number;
  orbiter: boolean;
  depth: number;
  alpha: number;
}

export class Swords {
  private swords: Sword[] = [];
  private sprites: HTMLCanvasElement[] = [];
  private mode: 'idle' | 'wake' | 'scatter' = 'idle';
  private formation: Formation = 'enter';
  private t0 = 0;
  private fT = 0; // 目前陣形開始的時間
  private last = 0;
  private spin = 0; // 劍環／劍球的旋轉角度
  private fistSince = 0;
  private handT = -1e9; // 最近一次看到手
  private autoT = 0; // 自動播放已經播了多久（有手時暫停）
  private trail: { x: number; y: number }[] = [];
  private cursor = { x: 0, y: 0 };
  private W = 1;
  private H = 1;
  private coreR = 40;
  /** 化為 HEX 的瞬間（換成紅色介面用） */
  onFormed: () => void = () => {};

  constructor(count = 864) {
    const streams = 6;
    const sector = TAU / streams;
    for (let i = 0; i < count; i++) {
      const s = i % streams;
      const base = (s / streams) * TAU + 0.35;
      const rank = Math.floor(i / streams);
      const frac = (rank + 0.5) / Math.ceil(count / streams);
      const a = base + (Math.random() - 0.5) * 0.08;
      this.swords.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        k: 0.018 + Math.random() * 0.03,
        damp: 0.86 + Math.random() * 0.05,
        sx: Math.cos(a) * (1.08 + Math.random() * 0.06),
        sy: Math.sin(a) * (1.08 + Math.random() * 0.06),
        delay: (s / streams) * 900 + frac * 2300,
        theta: base + Math.PI / 2 + frac * sector * 1.15,
        band: Math.random() * 2 - 1,
        phi: Math.acos(1 - 2 * (i + 0.5) / count),
        frac,
        dir: Math.random() * TAU,
        speed: 0.6 + Math.random() * 0.9,
        spin: (Math.random() - 0.5) * 2,
        heat: Math.random(),
        orbiter: rank % 6 === 0,
        depth: 0.5,
        alpha: 0,
      });
    }
    this.sprites = [makeSprite('#173967', '#65aaff'), makeSprite('#107e92', '#30efc9'), makeSprite('#50cbbf', '#ddfff9')];
  }

  get busy() {
    return this.mode !== 'idle';
  }

  /** 正在等手勢歸宗（這段時間 HEX 不處理捏、張手退回等手勢） */
  get capturing() {
    return this.mode === 'wake' && this.formation !== 'form';
  }

  /** 核心要不要畫：喚醒中要等「化為 HEX」才出現 */
  coreVisible() {
    return this.mode !== 'wake' || this.formation === 'form';
  }

  /** 可以展開主控台了嗎 */
  ready(t: number) {
    return this.mode !== 'wake' || (this.formation === 'form' && t - this.fT > 250);
  }

  gather(t: number) {
    this.mode = 'wake';
    this.t0 = t;
    this.last = t;
    this.autoT = 0;
    this.fistSince = 0;
    this.handT = -1e9;
    this.trail = [];
    this.formation = 'enter';
    this.fT = t;
    for (const s of this.swords) {
      s.alpha = 0;
      s.vx = s.vy = 0;
    }
  }

  scatter(t: number) {
    this.mode = 'scatter';
    this.t0 = t;
  }

  /** 點一下：直接歸宗 */
  skip(t: number) {
    if (this.mode === 'wake' && this.formation !== 'form') this.setFormation('form', t);
    else if (this.mode === 'scatter') this.mode = 'idle';
  }

  /** 每幀把手勢交進來（null = 沒有手） */
  control(input: SwordInput | null, t: number) {
    if (!input || input.pose === 'none') return;
    this.handT = t;
    this.cursor = { x: input.x, y: input.y };
    if (this.mode !== 'wake' || this.formation === 'form' || this.formation === 'enter') return;
    if (this.formation === 'burst' && t - this.fT < BURST_MS) return;
    switch (input.pose) {
      case 'sword':
      case 'point':
        this.setFormation('stream', t);
        break;
      case 'open':
        this.setFormation('ring', t);
        break;
      case 'fist':
        this.setFormation('ball', t);
        break;
      case 'rock':
        this.setFormation('burst', t);
        break;
      default:
        if (this.formation === 'burst') this.setFormation('hover', t);
    }
  }

  private setFormation(f: Formation, t: number) {
    if (f === this.formation) return;
    if (f === 'ball') this.fistSince = t;
    this.formation = f;
    this.fT = t;
    if (f === 'form') this.onFormed();
    if (f === 'burst') {
      // 萬劍齊發：給每把劍一個往外的初速
      const cx = this.W / 2;
      const cy = this.H / 2;
      for (const s of this.swords) {
        const a = Math.atan2(s.y - cy, s.x - cx) + (Math.random() - 0.5) * 0.6;
        const v = (0.3 + s.heat) * Math.min(this.W, this.H) * 0.012;
        s.vx = Math.cos(a) * v;
        s.vy = Math.sin(a) * v;
      }
    }
  }

  /** 沒有手時的自動劇本，以及握拳歸宗、等太久的處理 */
  private autopilot(t: number, dt: number) {
    const handVisible = t - this.handT < 1200;
    if (this.formation === 'enter' && t - this.t0 > ENTER_MS) this.setFormation('hover', t);
    if (this.formation === 'enter' || this.formation === 'form') return;
    if (this.formation === 'ball' && t - this.fistSince > (handVisible ? BALL_HOLD_MS : AUTO.ball)) return this.setFormation('form', t);
    if (handVisible) {
      if (t - this.t0 > MAX_WAIT_MS && this.formation !== 'ball') this.setFormation('ball', t);
      return;
    }
    // 手不見了：劍流變回盤旋，接著自動播
    if (this.formation === 'stream' || this.formation === 'burst') this.setFormation('hover', t);
    this.autoT += dt;
    const a = this.autoT;
    if (a > AUTO.hover + AUTO.ring) this.setFormation('ball', t);
    else if (a > AUTO.hover) this.setFormation('ring', t);
  }

  draw(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, coreR: number) {
    if (this.mode === 'idle') return;
    this.W = W;
    this.H = H;
    this.coreR = coreR;
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const dpr = ctx.getTransform().a || 1;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    if (this.mode === 'wake') {
      this.autopilot(t, dt);
      this.stepWake(ctx, t, dt, dpr);
    } else {
      this.drawScatter(ctx, t - this.t0, W / 2, H / 2, W, H, coreR, dpr);
    }
    ctx.restore();
  }

  /** 劍球上的位置（3D 球面投影，球會轉） */
  private ballPos(s: Sword, cx: number, cy: number, r: number, rot: number) {
    const th = s.frac * 131 + s.theta + rot;
    const x = Math.sin(s.phi) * Math.cos(th);
    const y = Math.cos(s.phi);
    const z = Math.sin(s.phi) * Math.sin(th);
    const tilt = 0.45;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return { x: cx + x * r, y: cy + y2 * r, z: z2 };
  }

  private stepWake(ctx: CanvasRenderingContext2D, t: number, dt: number, dpr: number) {
    const { W, H, coreR } = this;
    const cx = W / 2;
    const cy = H / 2;
    const m = Math.min(W, H);
    const ringR = m * 0.3;
    const f = this.formation;
    const fe = t - this.fT;
    const step = dt / 16.7;

    // 旋轉速度：盤旋慢、劍環快、劍球更快
    const spinSpeed = f === 'ring' ? 0.34 : f === 'ball' ? 0.85 : f === 'form' ? 1.2 : 0.2;
    this.spin += (spinSpeed * dt) / 1000;

    // 跟手的劍流：記錄手走過的路線
    if (f === 'stream') {
      this.trail.unshift({ ...this.cursor });
      if (this.trail.length > 70) this.trail.length = 70;
    }

    const formK = f === 'form' ? clamp01(fe / FORM_MS) : 0;
    const ballR = coreR * 1.3;
    const tracking = t - this.handT < 600;
    const handX = tracking ? this.cursor.x : cx;
    const handY = tracking ? this.cursor.y : cy;

    for (const s of this.swords) {
      let tx: number;
      let ty: number;
      let heat = 0.25 + s.heat * 0.4;
      let targetAlpha = 1;
      let kMul = 1;

      if (f === 'enter') {
        // 飛入：照順序從畫面外出發，追向盤旋陣形
        const e = t - this.t0 - s.delay;
        if (e < 0) {
          s.x = cx + s.sx * W * 0.55;
          s.y = cy + s.sy * H * 0.55;
          s.vx = s.vy = 0;
          s.alpha = 0;
          continue;
        }
        const p = this.hoverPos(s, t, cx, cy, ringR);
        tx = p.x;
        ty = p.y;
        const arrival = easeOut(clamp01(e / 1650));
        tx = lerp(cx + s.sx * W * 0.7, tx, arrival);
        ty = lerp(cy + s.sy * H * 0.7, ty, arrival);
        if (s.alpha === 0) { s.x = tx; s.y = ty; }
      } else if (f === 'hover') {
        const p = this.hoverPos(s, t, cx, cy, ringR);
        tx = p.x;
        ty = p.y;
      } else if (f === 'stream') {
        // 沿著手走過的路線排成一條劍流；手停住時在手旁邊繞
        const tr = this.trail;
        const i = Math.min(tr.length - 1, Math.floor(s.frac * tr.length));
        const p = tr[Math.max(0, i)] ?? this.cursor;
        const phase = s.theta + s.frac * 13 - t / 540;
        const width = m * (0.018 + 0.07 * s.frac) * (0.7 + s.band * 0.3);
        tx = p.x + Math.sin(phase) * width;
        ty = p.y + Math.cos(phase) * width + s.frac * m * 0.08;
        s.depth = 0.5 + 0.5 * Math.cos(phase);
        kMul = 1.35;
        heat = 0.25 + s.depth * 0.65;
      } else if (f === 'ring') {
        // Spiral meridians projected onto a breathing shell around the palm.
        const radius = ringR * (0.92 + 0.05 * Math.sin(fe / 850));
        const shell = this.ballPos(s, handX, handY, radius, this.spin + s.phi * 1.7);
        s.depth = (shell.z + 1) / 2;
        const perspective = 0.84 + 0.28 * s.depth;
        tx = handX + (shell.x - handX) * perspective;
        ty = handY + (shell.y - handY) * perspective;
        heat = 0.12 + s.depth * 0.85;
        kMul = 1.1;
      } else if (f === 'ball' || f === 'burst') {
        if (f === 'burst' && fe < BURST_MS * 0.8) {
          // Staggered blades fall towards the viewer in a widening curtain.
          const fall = fe / BURST_MS - s.frac * 0.35;
          const launch = Math.max(0, fall);
          s.vx *= Math.pow(0.96, step);
          s.vy += launch * 3.4 * step;
          s.x += s.vx * step;
          s.y += s.vy * step;
          s.depth = clamp01(s.heat * 0.5 + launch);
          this.drawSword(ctx, s, 0.65 + s.depth * 0.35, 1 + launch, dpr);
          continue;
        }
        if (f === 'burst') {
          const p = this.hoverPos(s, t, cx, cy, ringR);
          tx = p.x;
          ty = p.y;
        } else {
          // 劍球：握得越久壓得越緊
          const squeeze = 1 - 0.25 * clamp01(fe / BALL_HOLD_MS);
          const p = this.ballPos(s, cx, cy, lerp(ringR * 0.85, ballR * squeeze, easeOut(clamp01(fe / BALL_HOLD_MS))), this.spin);
          tx = p.x;
          ty = p.y;
          const front = (p.z + 1) / 2;
          s.depth = front;
          heat = 0.35 + 0.65 * front;
          targetAlpha = 0.35 + 0.5 * front;
          kMul = 1.6;
        }
      } else {
        // 化為 HEX：大部分收進核心消失，外圈留一些繞著淡出
        if (s.orbiter) {
          const ang = s.theta + this.spin * 0.4;
          const r = lerp(ballR, coreR * (2.2 + s.band * 0.5), easeOut(formK));
          tx = cx + Math.cos(ang) * r;
          const tilt = s.orbiter ? -0.48 : 0.28;
        ty = cy + r * (Math.sin(ang) * 0.54 + Math.cos(ang) * tilt);
          targetAlpha = 1 - easeIn(formK);
          heat = 0.5;
        } else {
          const p = this.ballPos(s, cx, cy, ballR * (1 - easeOut(clamp01(formK * 3)) * 0.7), this.spin);
          tx = p.x;
          ty = p.y;
          targetAlpha = (1 - clamp01(formK * 3)) * 0.6;
          heat = 0.7;
          kMul = 2.5;
        }
      }

      // 彈簧追目標
      const k = s.k * kMul;
      s.vx = (s.vx + (tx - s.x) * k * step) * Math.pow(s.damp, step);
      s.vy = (s.vy + (ty - s.y) * k * step) * Math.pow(s.damp, step);
      s.x += s.vx * step;
      s.y += s.vy * step;
      s.alpha += (targetAlpha - s.alpha) * Math.min(1, 0.12 * step);
      if (s.alpha < 0.01) continue;
      this.drawSword(ctx, s, heat, 1, dpr);
    }

    if (f === 'form') this.drawFlash(ctx, fe, cx, cy, coreR, dpr);
    if (f === 'form' && fe > FORM_MS) this.mode = 'idle';
  }

  /** 盤旋陣形：中間一大圈鬆散、慢慢轉的劍群 */
  private hoverPos(s: Sword, t: number, cx: number, cy: number, ringR: number) {
    const along = (s.frac + t / 15000) % 1;
    const angle = along * TAU + this.spin;
    const twist = angle * 3 + s.theta + t / 1700;
    const width = ringR * (0.10 + 0.14 * (0.5 + 0.5 * Math.sin(angle)));
    s.depth = clamp01(0.5 + 0.34 * Math.sin(angle) + 0.16 * Math.cos(twist));
    return {
      x: cx + ringR * 1.75 * Math.cos(angle) + width * Math.cos(twist),
      y: cy + ringR * (0.51 * Math.sin(angle * 2 + this.spin) - 0.26 * Math.cos(angle))
        + width * (Math.sin(twist) + s.band * 0.55),
    };
  }

  /** 歸宗的瞬間：中心閃光＋擴散的衝擊波 */
  private drawFlash(ctx: CanvasRenderingContext2D, fe: number, cx: number, cy: number, coreR: number, dpr: number) {
    if (fe > 800) return;
    const k = 1 - fe / 800;
    const r = coreR * (2 + fe / 120);
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
    g.addColorStop(0, `rgba(223, 255, 250, ${0.85 * k})`);
    g.addColorStop(0.25, `rgba(48, 239, 201, ${0.5 * k})`);
    g.addColorStop(1, 'rgba(7, 38, 65, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    ctx.strokeStyle = `rgba(92, 205, 255, ${0.6 * k})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * (1.2 + fe / 90), 0, TAU);
    ctx.stroke();
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
    if (e >= SCATTER_MS) {
      this.mode = 'idle';
      return;
    }
    const k = e / SCATTER_MS;
    const far = Math.hypot(W, H) * 0.7;
    for (const s of this.swords) {
      const burst = easeIn(clamp01((k - 0.1 - s.heat * 0.12) / 0.8));
      const ang = s.dir + s.spin * k * 1.5;
      // 一開始在核心外圍散成一圈（不要全部疊在一點，會變成一顆白球）
      const r = coreR * (1 + s.band * 0.25 + Math.min(k, 0.12) * 6) + burst * far * s.speed;
      const nx = cx + Math.cos(ang) * r;
      const ny = cy + Math.sin(ang) * r;
      s.vx = nx - s.x;
      s.vy = ny - s.y;
      s.x = nx;
      s.y = ny;
      s.alpha = (0.45 + 0.55 * burst) * (1 - easeIn(clamp01((k - 0.55) / 0.45)));
      this.drawSword(ctx, s, 0.3 + s.heat * 0.5 - burst * 0.3, 1 + burst, dpr);
    }
  }

  /** 畫一把劍：方向跟著速度，速度越快光尾越長 */
  private drawSword(ctx: CanvasRenderingContext2D, s: Sword, heat: number, len: number, dpr: number) {
    let dx = s.vx;
    let dy = s.vy;
    let d = Math.hypot(dx, dy);
    if (d < 0.05) {
      dx = Math.cos(s.dir);
      dy = Math.sin(s.dir);
      d = 1;
    }
    const cos = dx / d;
    const sin = dy / d;
    const stretch = Math.min(1.35, len);
    const img = this.sprites[heat + s.heat * 0.18 > 0.78 ? 2 : heat > 0.4 ? 1 : 0];
    ctx.globalAlpha = Math.max(0, Math.min(1, s.alpha * (0.17 + s.depth * 0.83)));
    ctx.setTransform(dpr * cos * stretch, dpr * sin * stretch, -dpr * sin, dpr * cos, dpr * s.x, dpr * s.y);
    const scale = (0.24 + 0.90 * s.depth ** 2) * Math.max(0.46, Math.min(1, Math.min(this.W, this.H) / 950)) * (0.68 + 0.32 * s.heat);
    ctx.drawImage(img, -44 * scale, -13 * scale, 68 * scale, 26 * scale);
  }
}

/** 預先畫一把「劍」：劍尖朝右，後面接一段漸淡的光尾 */
function makeSprite(dark: string, bright: string) {
  const c = document.createElement('canvas');
  c.width = 136;
  c.height = 52;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  const bloom = g.createRadialGradient(36, 13, 0, 36, 13, 29);
  bloom.addColorStop(0, bright + '72');
  bloom.addColorStop(0.45, dark + '50');
  bloom.addColorStop(1, dark + '00');
  g.fillStyle = bloom;
  g.fillRect(0, 0, 68, 26);
  const wake = g.createLinearGradient(0, 0, 30, 0);
  wake.addColorStop(0, dark + '00');
  wake.addColorStop(1, bright + 'aa');
  g.fillStyle = wake;
  g.beginPath(); g.moveTo(0, 13); g.lineTo(29, 11); g.lineTo(29, 15); g.fill();
  g.translate(19, 6);
  const facet = (color: string, points: number[][]) => {
    g.fillStyle = color;
    g.beginPath();
    points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath();
    g.fill();
  };
  facet(bright, [[14,7],[17,3.8],[38,5],[48,7]]);
  facet(dark, [[14,7],[48,7],[38,9],[17,10.2]]);
  g.fillStyle = dark;
  g.fillRect(3, 5.6, 10, 2.8);
  g.fillStyle = bright;
  g.fillRect(1, 5, 3.5, 4);
  facet('#a0cbd5', [[10,0.5],[15,3.2],[16,7],[15,10.8],[10,13.5],[12,8],[12,6]]);
  return c;
}
