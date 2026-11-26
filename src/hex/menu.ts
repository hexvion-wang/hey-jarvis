/**
 * HEX 環狀選單：待機核心 → 展開動畫 → 程式節點環繞四周 → 收回。
 * 純 Canvas 繪製，時間單位都是 performance.now() 的毫秒。
 */
import { APPS, GROUPS, type AppDef, type GroupId } from './apps';

const CYAN = '0, 229, 255';
const GOLD = '255, 201, 64';
export const OPEN_MS = 2000;
export const CLOSE_MS = 650;

type State = 'standby' | 'opening' | 'open' | 'closing';

interface Node {
  app: AppDef;
  angle: number;
  x: number;
  y: number;
  /** 展開時開始飛出的時間（相對 open 開始） */
  delay: number;
  hover: number;
  flashT: number;
  available: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeOutBack = (x: number) => {
  const c = 1.6;
  const k = clamp01(x) - 1;
  return 1 + (c + 1) * k * k * k + c * k * k;
};

export class HexMenu {
  state: State = 'standby';
  private t0 = 0;
  private nodes: Node[];
  private W = 1;
  private H = 1;
  private cx = 0;
  private cy = 0;
  /** 程式環半徑 */
  private R = 100;
  /** 節點半徑 */
  private r = 40;
  /** 核心半徑 */
  coreR = 40;
  private grid: HTMLCanvasElement | null = null;

  constructor() {
    // 13 個程式 + 4 個分組間隔，平均分配一整圈
    const slots = APPS.length + GROUPS.length;
    const step = (Math.PI * 2) / slots;
    let slot = 0.5; // 從正上方附近開始，留半格間隔
    let order = 0;
    this.nodes = [];
    for (const g of GROUPS) {
      for (const app of APPS.filter((a) => a.group === g.id)) {
        this.nodes.push({
          app,
          angle: -Math.PI / 2 + (slot + 0.5) * step,
          x: 0,
          y: 0,
          delay: 650 + order * 60,
          hover: 0,
          flashT: -1e9,
          available: true,
        });
        slot++;
        order++;
      }
      slot++; // 分組間隔
    }
  }

  setAvailable(ids: Set<string> | null) {
    for (const n of this.nodes) n.available = !ids || ids.has(n.app.id);
  }

  layout(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.cx = W / 2;
    this.cy = H / 2;
    const m = Math.min(W, H);
    this.R = m * 0.34;
    this.r = Math.max(30, Math.min(54, m * 0.052));
    this.coreR = m * 0.075;
    for (const n of this.nodes) {
      n.x = this.cx + Math.cos(n.angle) * this.R;
      n.y = this.cy + Math.sin(n.angle) * this.R;
    }
    this.grid = null; // 重畫背景格線
  }

  open(t: number) {
    if (this.state === 'open' || this.state === 'opening') return;
    this.state = 'opening';
    this.t0 = t;
  }

  close(t: number) {
    if (this.state === 'standby' || this.state === 'closing') return;
    this.state = 'closing';
    this.t0 = t;
  }

  get isOpen() {
    return this.state === 'open' || this.state === 'opening';
  }

  hitCore(x: number, y: number) {
    return Math.hypot(x - this.cx, y - this.cy) <= this.coreR * 1.3;
  }

  /** 只有展開完成、節點已經就位時才能點 */
  hitNode(x: number, y: number, t: number): AppDef | null {
    if (!this.isOpen) return null;
    for (const n of this.nodes) {
      if (this.nodeProgress(n, t) < 0.9) continue;
      if (Math.hypot(x - n.x, y - n.y) <= this.r * 1.25) return n.app;
    }
    return null;
  }

  flash(id: string, t: number) {
    const n = this.nodes.find((n) => n.app.id === id);
    if (n) n.flashT = t;
  }

  /** 節點從中心飛到定位的進度 0~1 */
  private nodeProgress(n: Node, t: number) {
    const e = t - this.t0;
    if (this.state === 'standby') return 0;
    if (this.state === 'open') return 1;
    if (this.state === 'opening') return clamp01((e - n.delay) / 450);
    return 1 - clamp01(e / CLOSE_MS);
  }

  /** 整體展開程度 0~1（給圓環、格線用） */
  private openness(t: number) {
    const e = t - this.t0;
    if (this.state === 'standby') return 0;
    if (this.state === 'open') return 1;
    if (this.state === 'opening') return clamp01(e / 900);
    return 1 - clamp01(e / CLOSE_MS);
  }

  draw(ctx: CanvasRenderingContext2D, t: number, cursor: { x: number; y: number } | null, dt: number): AppDef | null {
    const e = t - this.t0;
    if (this.state === 'opening' && e > OPEN_MS) this.state = 'open';
    if (this.state === 'closing' && e > CLOSE_MS) this.state = 'standby';

    const open = this.openness(t);
    this.drawGrid(ctx, 0.25 + open * 0.75);
    this.drawRings(ctx, t, open);
    if (this.state === 'opening') this.drawShockwave(ctx, e);
    this.drawCore(ctx, t, open);

    const hovered = cursor ? this.hitNode(cursor.x, cursor.y, t) : null;
    for (const n of this.nodes) this.drawNode(ctx, n, t, dt, n.app === hovered);
    this.drawGroupLabels(ctx, t);
    return hovered;
  }

  // ---- 背景：六角形格線（HEX） ----
  private drawGrid(ctx: CanvasRenderingContext2D, alpha: number) {
    if (!this.grid) {
      const g = document.createElement('canvas');
      g.width = this.W;
      g.height = this.H;
      const c = g.getContext('2d')!;
      const s = 26;
      const h = s * Math.sqrt(3);
      c.strokeStyle = `rgba(${CYAN}, 0.07)`;
      c.lineWidth = 1;
      for (let row = -1; row * h * 0.5 < this.H + h; row++) {
        for (let col = -1; col * s * 3 < this.W + s * 3; col++) {
          const x = col * s * 3 + (row % 2 ? s * 1.5 : 0);
          const y = row * h * 0.5;
          c.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const px = x + Math.cos(a) * s;
            const py = y + Math.sin(a) * s;
            if (i) c.lineTo(px, py);
            else c.moveTo(px, py);
          }
          c.closePath();
          c.stroke();
        }
      }
      // 中心亮、四周暗
      const v = c.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, Math.max(this.W, this.H) * 0.6);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,4,10,0.9)');
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = v;
      c.fillRect(0, 0, this.W, this.H);
      this.grid = g;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.grid, 0, 0, this.W, this.H);
    ctx.restore();
  }

  // ---- 核心 ----
  private drawCore(ctx: CanvasRenderingContext2D, t: number, open: number) {
    const { cx, cy } = this;
    const R = this.coreR;
    const power = 0.3 + open * 0.7;
    ctx.save();
    ctx.shadowColor = `rgb(${CYAN})`;
    ctx.shadowBlur = 10 + open * 25;

    // 外圈三段旋轉弧
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(${CYAN}, ${0.35 + power * 0.5})`;
    for (let i = 0; i < 3; i++) {
      const a = t * (0.0004 + open * 0.0008) + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a, a + 1.4);
      ctx.stroke();
    }
    // 內圈反向
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = -t * 0.0007 + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.72, a, a + 0.6);
      ctx.stroke();
    }
    // 六角形核心
    const pulse = 0.5 + 0.5 * Math.sin(t / (open > 0.5 ? 260 : 900));
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const px = cx + Math.cos(a) * R * 0.45;
      const py = cy + Math.sin(a) * R * 0.45;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    g.addColorStop(0, `rgba(220, 255, 255, ${0.5 + pulse * 0.4 * power})`);
    g.addColorStop(1, `rgba(${CYAN}, ${0.15 + power * 0.25})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = `rgba(${CYAN}, 0.9)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 文字
    // 深色字壓在發亮的核心上比較清楚
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00303d';
    ctx.font = `800 ${Math.round(R * 0.26)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HEX', cx, cy + 1);
    ctx.restore();
  }

  // ---- 展開瞬間的衝擊波 ----
  private drawShockwave(ctx: CanvasRenderingContext2D, e: number) {
    ctx.save();
    ctx.shadowColor = `rgb(${CYAN})`;
    ctx.shadowBlur = 20;
    for (const [delay, dur, maxR, w] of [
      [0, 700, 1.35, 4],
      [150, 800, 1.1, 2],
      [300, 900, 0.8, 1.5],
    ] as const) {
      const k = clamp01((e - delay) / dur);
      if (k <= 0 || k >= 1) continue;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.coreR + easeOut(k) * this.R * maxR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${CYAN}, ${0.9 * (1 - k)})`;
      ctx.lineWidth = w;
      ctx.stroke();
    }
    // 中心白光
    const k = clamp01(e / 400);
    if (k < 1) {
      const g = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.coreR * 3);
      g.addColorStop(0, `rgba(230,255,255,${0.8 * (1 - k)})`);
      g.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(this.cx - this.coreR * 3, this.cy - this.coreR * 3, this.coreR * 6, this.coreR * 6);
    }
    ctx.restore();
  }

  // ---- 程式環與刻度 ----
  private drawRings(ctx: CanvasRenderingContext2D, t: number, open: number) {
    if (open <= 0) return;
    const { cx, cy, R } = this;
    ctx.save();
    ctx.shadowColor = `rgb(${CYAN})`;
    ctx.shadowBlur = 8;

    // 主環：從正上方開始畫一圈
    const sweep = easeOut(open) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.strokeStyle = `rgba(${CYAN}, 0.35)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 內側虛線環
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.62, t * 0.0002, t * 0.0002 + sweep);
    ctx.strokeStyle = `rgba(${CYAN}, ${0.3 * open})`;
    ctx.stroke();
    ctx.setLineDash([]);

    // 外側刻度：72 格逐漸點亮，慢慢旋轉
    const lit = Math.floor(easeOut(open) * 72);
    const rot = t * 0.00008;
    const r1 = R + this.r * 1.55;
    for (let i = 0; i < 72; i++) {
      const a = rot + (i / 72) * Math.PI * 2;
      const long = i % 6 === 0;
      const r2 = r1 + (long ? 12 : 6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.strokeStyle = i < lit ? (long ? `rgba(${GOLD}, 0.8)` : `rgba(${CYAN}, 0.55)`) : `rgba(${CYAN}, 0.08)`;
      ctx.lineWidth = long ? 2.5 : 1.2;
      ctx.stroke();
    }

    // 雷達掃描線
    if (this.state === 'open') {
      const a = t * 0.0012;
      const g = ctx.createConicGradient(a - 0.6, cx, cy);
      g.addColorStop(0, `rgba(${CYAN}, 0)`);
      g.addColorStop(0.095, `rgba(${CYAN}, 0.10)`);
      g.addColorStop(0.0955, `rgba(${CYAN}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- 程式節點 ----
  private drawNode(ctx: CanvasRenderingContext2D, n: Node, t: number, dt: number, hovered: boolean) {
    const p = this.nodeProgress(n, t);
    if (p <= 0) return;
    const fly = this.state === 'closing' ? easeOut(p) : easeOutBack(p);
    const x = this.cx + (n.x - this.cx) * fly;
    const y = this.cy + (n.y - this.cy) * fly;

    n.hover += ((hovered ? 1 : 0) - n.hover) * Math.min(1, dt / 90);
    const flash = clamp01(1 - (t - n.flashT) / 700);
    const r = this.r * (0.4 + 0.6 * Math.min(1, p * 1.4)) * (1 + n.hover * 0.15 + flash * 0.1);
    const rgb = n.hover > 0.5 || flash > 0 ? GOLD : CYAN;
    const dim = n.available ? 1 : 0.35;

    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 1.5) * dim;

    // 連到核心的光線
    const lx = this.cx + Math.cos(n.angle) * this.coreR * 1.15;
    const ly = this.cy + Math.sin(n.angle) * this.coreR * 1.15;
    const ex = x - Math.cos(n.angle) * r;
    const ey = y - Math.sin(n.angle) * r;
    const lg = ctx.createLinearGradient(lx, ly, ex, ey);
    lg.addColorStop(0, `rgba(${CYAN}, 0.05)`);
    lg.addColorStop(1, `rgba(${rgb}, ${0.35 + n.hover * 0.4})`);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1 + n.hover;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // 節點本體
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 12 + n.hover * 20 + flash * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${0.18 + n.hover * 0.25 + flash * 0.5})`);
    g.addColorStop(1, `rgba(${rgb}, 0.04)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
    ctx.lineWidth = 2 + n.hover;
    ctx.stroke();

    // hover：外圈旋轉弧
    if (n.hover > 0.05) {
      ctx.globalAlpha *= n.hover;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = t / 400 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(x, y, r + 9, a, a + 1.1);
        ctx.stroke();
      }
      ctx.globalAlpha = Math.min(1, p * 1.5) * dim;
    }

    // 開啟時的發射光環
    if (flash > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r + (1 - flash) * r * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${GOLD}, ${flash})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 縮寫與名稱
    ctx.shadowBlur = 6;
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = n.app.glyph;
    ctx.font = `700 ${Math.round(r * (glyph.length > 2 ? 0.42 : 0.55))}px ui-monospace, Consolas, monospace`;
    ctx.fillText(glyph, x, y + 1);
    if (p > 0.85) {
      ctx.font = `${Math.round(12 + n.hover * 4)}px 'Microsoft JhengHei', 'PingFang TC', system-ui, sans-serif`;
      ctx.globalAlpha *= 0.75 + n.hover * 0.25;
      // 名稱放在節點外側（沿著核心→節點的方向往外）
      const c = Math.cos(n.angle);
      const s = Math.sin(n.angle);
      const gap = r + 12;
      ctx.textAlign = c > 0.35 ? 'left' : c < -0.35 ? 'right' : 'center';
      ctx.textBaseline = s > 0.35 ? 'top' : s < -0.35 ? 'bottom' : 'middle';
      ctx.fillText(n.app.name, x + c * gap, y + s * gap);
    }
    ctx.restore();
  }

  // ---- 分組標籤（沿著外圈） ----
  private drawGroupLabels(ctx: CanvasRenderingContext2D, t: number) {
    let a = 0;
    if (this.state === 'opening') a = clamp01((t - this.t0 - 1300) / 500);
    else if (this.state === 'open') a = 1;
    else if (this.state === 'closing') a = 1 - clamp01((t - this.t0) / 300);
    if (a <= 0) return;

    ctx.save();
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = `rgb(${GOLD})`;
    ctx.font = `600 12px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 標籤放在環的內側（核心與節點之間），不會被外圈刻度擋到
    const labelR = this.R * 0.62 - 14;
    for (const g of GROUPS) {
      const ns = this.nodes.filter((n) => n.app.group === (g.id as GroupId));
      if (!ns.length) continue;
      const mid = (ns[0].angle + ns[ns.length - 1].angle) / 2;
      ctx.fillText(g.label, this.cx + Math.cos(mid) * labelR, this.cy + Math.sin(mid) * labelR);
    }
    ctx.restore();
  }
}
