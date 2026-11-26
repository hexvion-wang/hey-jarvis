/**
 * HEX 全息選單：待機核心 → 螺旋展開成環 → 收成底部 Dock → 收回。
 * 純 Canvas 繪製，時間單位都是 performance.now() 的毫秒。
 */
import { APPS, GROUPS, PANELS, type AppDef, type GroupId } from './apps';

const CYAN = '0, 229, 255';
const GOLD = '255, 201, 64';
export const OPEN_MS = 5200;
export const CLOSE_MS = 1000;
/** 節點從中心飛出的時間 */
const FLY_MS = 1500;
/** 節點飛出時繞的角度（約 0.6 圈） */
const SPIN = Math.PI * 1.25;
/** 環狀展開完成後，停多久開始收成 Dock */
const DOCK_DELAY = 500;
/** 收成 Dock 的轉場時間 */
const DOCK_MS = 1400;

type State = 'standby' | 'opening' | 'open' | 'closing';

interface Node {
  app: AppDef;
  /** 面板按鈕只出現在 Dock，不參加環狀展開 */
  panel: boolean;
  angle: number;
  /** 環上的位置 */
  x: number;
  y: number;
  /** Dock 上的位置 */
  dx: number;
  dy: number;
  /** 展開時開始飛出的時間（相對 open 開始） */
  delay: number;
  /** 收成 Dock 時的出發順序 0~1 */
  dockOrder: number;
  hover: number;
  flashT: number;
  available: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

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
  /** 環上節點半徑 */
  private r = 40;
  /** 待機核心半徑 */
  coreR = 40;
  private grid: HTMLCanvasElement | null = null;
  /** Dock 上節點半徑、核心在 Dock 的位置、Dock 弧線參數 */
  private rd = 26;
  private dockCore = { x: 0, y: 0 };
  private dockSag = 40;
  private dockSpan = 100;
  /** 核心目前的位置與大小（會從中間移到 Dock） */
  private core = { x: 0, y: 0, r: 40 };
  /** 收回時的 Dock 程度（從 Dock 收回走不同路線） */
  private closeFromDock = 0;
  /** 背景格線濃度倍率（AR 鏡頭背景時調淡） */
  gridScale = 1;

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
          panel: false,
          angle: -Math.PI / 2 + (slot + 0.5) * step,
          x: 0,
          y: 0,
          dx: 0,
          dy: 0,
          delay: 1300 + order * 160,
          dockOrder: order / (APPS.length - 1),
          hover: 0,
          flashT: -1e9,
          available: true,
        });
        slot++;
        order++;
      }
      slot++; // 分組間隔
    }
    for (const app of PANELS) {
      this.nodes.push({
        app,
        panel: true,
        angle: 0,
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
        delay: 0,
        dockOrder: 1,
        hover: 0,
        flashT: -1e9,
        available: true,
      });
    }
  }

  setAvailable(ids: Set<string> | null) {
    for (const n of this.nodes) n.available = n.panel || !ids || ids.has(n.app.id);
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
    this.layoutDock();
    this.core = { x: this.cx, y: this.cy, r: this.coreR };
    this.grid = null; // 重畫背景格線
  }

  /**
   * Dock：螢幕底部一條微彎的弧（中間低、兩側高），HEX 核心在正中間，左右各 8 個。
   * 左：面板按鈕｜工作｜檔案總管　　右：文書｜終端機｜娛樂
   */
  private layoutDock() {
    const by = (...ids: string[]) => ids.map((id) => this.nodes.find((n) => n.app.id === id)!).filter(Boolean);
    const order: (Node | 'core')[] = [
      ...this.nodes.filter((n) => n.panel),
      ...by('obsidian', 'chrome', 'claude', 'chatgpt', 'explorer'),
      'core',
      ...by('word', 'excel', 'powerpoint', 'terminal', 'discord', 'steam', 'lol', 'wuwa'),
    ];
    this.dockSpan = Math.min(this.W * 0.9, order.length * 110);
    this.rd = Math.max(20, Math.min(36, (this.dockSpan / order.length) * 0.36));
    this.dockSag = Math.min(60, this.H * 0.06);
    // 底部留給角落文字與 iPhone 配對欄
    const baseY = this.H - this.rd - 112;
    order.forEach((item, i) => {
      const u = (i / (order.length - 1)) * 2 - 1;
      const x = this.cx + (u * this.dockSpan) / 2;
      const y = baseY - this.dockSag * u * u;
      if (item === 'core') this.dockCore = { x, y };
      else {
        item.dx = x;
        item.dy = y;
      }
    });
  }

  open(t: number) {
    if (this.state === 'open' || this.state === 'opening') return;
    this.state = 'opening';
    this.t0 = t;
  }

  close(t: number) {
    if (this.state === 'standby' || this.state === 'closing') return;
    this.closeFromDock = this.dockAmount(t);
    this.state = 'closing';
    this.t0 = t;
  }

  get isOpen() {
    return this.state === 'open' || this.state === 'opening';
  }

  /** 0~1：從環狀收成 Dock 的進度（收回中則是收回開始時的值） */
  dockAmount(t: number) {
    if (this.state === 'closing') return this.closeFromDock;
    if (!this.isOpen) return 0;
    return clamp01((t - this.t0 - OPEN_MS - DOCK_DELAY) / DOCK_MS);
  }

  hitCore(x: number, y: number) {
    return Math.hypot(x - this.core.x, y - this.core.y) <= this.core.r * 1.3;
  }

  /** 只有節點已經就位時才能點（環狀或 Dock 都可以，轉場中不行） */
  hitNode(x: number, y: number, t: number): AppDef | null {
    if (!this.isOpen) return null;
    const d = this.dockAmount(t);
    if (d > 0 && d < 1) return null;
    for (const n of this.nodes) {
      if (d >= 1) {
        if (Math.hypot(x - n.dx, y - n.dy) <= this.rd * 1.3) return n.app;
      } else if (!n.panel && this.nodeProgress(n, t) >= 0.9) {
        if (Math.hypot(x - n.x, y - n.y) <= this.r * 1.25) return n.app;
      }
    }
    return null;
  }

  /** 節點在 Dock 上的位置（面板從這裡飛出來） */
  dockPos(id: string) {
    const n = this.nodes.find((n) => n.app.id === id);
    return n ? { x: n.dx, y: n.dy } : { x: this.cx, y: this.H };
  }

  flash(id: string, t: number) {
    const n = this.nodes.find((n) => n.app.id === id);
    if (n) n.flashT = t;
  }

  /** 節點從中心飛到定位的進度 0~1（收回時從 1 降到 0） */
  private nodeProgress(n: Node, t: number) {
    const e = t - this.t0;
    if (this.state === 'standby') return 0;
    if (this.state === 'open') return 1;
    if (this.state === 'opening') return clamp01((e - n.delay) / FLY_MS);
    return 1 - clamp01(e / CLOSE_MS);
  }

  /** 整體展開程度 0~1（給圓環、格線用） */
  private openness(t: number) {
    const e = t - this.t0;
    if (this.state === 'standby') return 0;
    if (this.state === 'open') return 1;
    if (this.state === 'opening') return clamp01(e / 2400);
    return 1 - clamp01(e / CLOSE_MS);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    t: number,
    cursor: { x: number; y: number } | null,
    dt: number,
    opts: { core?: boolean } = {},
  ): AppDef | null {
    const e = t - this.t0;
    if (this.state === 'opening' && e > OPEN_MS) this.state = 'open';
    if (this.state === 'closing' && e > CLOSE_MS) this.state = 'standby';

    const open = this.openness(t);
    const dockRaw = this.dockAmount(t);
    const dock = easeInOut(dockRaw);
    // 收回時：Dock 程度隨收回進度一起降到 0（核心回到中間）
    const coreDock = this.state === 'closing' ? dock * open : dock;

    this.drawGrid(ctx, 0.25 + open * 0.75);
    this.drawRings(ctx, t, open * (1 - dock));
    if (this.state === 'opening') this.drawShockwave(ctx, e);
    if (dock > 0) this.drawDockBase(ctx, this.state === 'closing' ? dock * open : dock);

    this.core = {
      x: lerp(this.cx, this.dockCore.x, coreDock),
      y: lerp(this.cy, this.dockCore.y, coreDock),
      r: lerp(this.coreR, this.rd * 1.2, coreDock),
    };
    if (opts.core !== false) this.drawCore(ctx, t, open);

    const hovered = cursor ? this.hitNode(cursor.x, cursor.y, t) : null;
    for (const n of this.nodes) this.drawNode(ctx, n, t, dt, n.app === hovered, dockRaw, open);
    this.drawGroupLabels(ctx, t, dock);
    if (hovered && dockRaw >= 1) this.drawDockLabel(ctx, hovered);
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
    ctx.globalAlpha = alpha * this.gridScale;
    ctx.drawImage(this.grid, 0, 0, this.W, this.H);
    ctx.restore();
  }

  // ---- 核心（位置與大小跟著 this.core 走） ----
  private drawCore(ctx: CanvasRenderingContext2D, t: number, open: number) {
    const { x: cx, y: cy, r: R } = this.core;
    const power = 0.3 + open * 0.7;
    ctx.save();
    ctx.shadowColor = `rgb(${CYAN})`;
    ctx.shadowBlur = 10 + open * 25;

    // 外圈三段旋轉弧
    ctx.lineWidth = Math.max(2, R * 0.07);
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

    // 深色字壓在發亮的核心上比較清楚
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00303d';
    ctx.font = `800 ${Math.max(9, Math.round(R * 0.26))}px ui-monospace, Consolas, monospace`;
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
      [0, 1500, 1.35, 4],
      [350, 1700, 1.1, 2],
      [700, 1900, 0.8, 1.5],
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
    const k = clamp01(e / 900);
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
    if (open <= 0.01) return;
    const { cx, cy, R } = this;
    ctx.save();
    ctx.globalAlpha = Math.min(1, open * 1.5);
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

  // ---- Dock 底座：一條從中間往兩側畫出去的發光弧線 ----
  private drawDockBase(ctx: CanvasRenderingContext2D, k: number) {
    if (k <= 0) return;
    const half = this.dockSpan / 2 + this.rd * 1.6;
    const reach = half * easeOut(k);
    const baseY = this.dockCore.y + this.rd + 16;
    const yAt = (x: number) => {
      const u = (x - this.cx) / (this.dockSpan / 2);
      return baseY - this.dockSag * u * u;
    };
    ctx.save();
    ctx.globalAlpha = easeOut(k);
    ctx.shadowColor = `rgb(${CYAN})`;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `rgba(${CYAN}, 0.5)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = this.cx - reach + (reach * 2 * i) / 80;
      if (i) ctx.lineTo(x, yAt(x));
      else ctx.moveTo(x, yAt(x));
    }
    ctx.stroke();
    // 兩端與中央的小方塊
    ctx.fillStyle = `rgb(${GOLD})`;
    for (const x of [this.cx - reach, this.cx + reach]) ctx.fillRect(x - 3, yAt(x) - 3, 6, 6);
    ctx.restore();
  }

  // ---- 程式節點 ----
  private drawNode(
    ctx: CanvasRenderingContext2D,
    n: Node,
    t: number,
    dt: number,
    hovered: boolean,
    dockRaw: number,
    open: number,
  ) {
    const closingDock = this.state === 'closing' && dockRaw > 0;
    // 每個節點收成 Dock 的進度，依順序稍微錯開出發
    const k = n.panel ? easeOut(dockRaw) : easeInOut((dockRaw - n.dockOrder * 0.3) / 0.7);
    const p = closingDock ? open : n.panel ? dockRaw : this.nodeProgress(n, t);
    if (p <= 0) return;

    let x: number;
    let y: number;
    let ang = n.angle;
    let baseR: number;
    let moving = false;
    if (closingDock) {
      // 從 Dock 收回：所有節點往核心縮回去
      const kk = easeOut(p);
      x = lerp(this.core.x, n.dx, kk);
      y = lerp(this.core.y, n.dy, kk);
      baseR = this.rd * (0.4 + 0.6 * p);
    } else if (n.panel) {
      // 面板按鈕：在 Dock 位置由下往上浮出
      x = n.dx;
      y = n.dy + (1 - k) * 50;
      baseR = this.rd;
    } else {
      // 螺旋飛行：一邊往外飛、一邊旋轉，越接近定位轉得越慢
      const dist = this.R * easeOut(p);
      ang = n.angle - (1 - easeInOut(p)) * SPIN;
      const rx = this.cx + Math.cos(ang) * dist;
      const ry = this.cy + Math.sin(ang) * dist;
      // 收成 Dock：從環上滑到 Dock 位置
      x = lerp(rx, n.dx, k);
      y = lerp(ry, n.dy, k);
      const ringR = this.r * (0.4 + 0.6 * Math.min(1, p * 1.4));
      baseR = lerp(ringR, this.rd, k);
      moving = p < 1 && dockRaw === 0;
    }

    n.hover += ((hovered ? 1 : 0) - n.hover) * Math.min(1, dt / 90);
    const flash = clamp01(1 - (t - n.flashT) / 700);
    const r = baseR * (1 + n.hover * 0.18 + flash * 0.1);
    const idle = n.panel ? GOLD : CYAN;
    const rgb = n.hover > 0.5 || flash > 0 ? (n.panel ? CYAN : GOLD) : idle;
    const dim = n.available ? 1 : 0.35;
    const alpha = Math.min(1, p * 1.5) * dim;
    const lineA = closingDock || n.panel ? 0 : 1 - Math.min(1, dockRaw * 3);

    ctx.save();
    ctx.globalAlpha = alpha;

    // 飛行中的軌跡尾巴（沿著目前半徑的一小段弧）
    const dist = Math.hypot(x - this.cx, y - this.cy);
    if (moving && dist > this.coreR) {
      const tail = 0.5 * (1 - p) + 0.1;
      const tg = ctx.createConicGradient(ang - tail, this.cx, this.cy);
      tg.addColorStop(0, `rgba(${CYAN}, 0)`);
      tg.addColorStop(tail / (Math.PI * 2), `rgba(${CYAN}, ${0.7 * (1 - p)})`);
      tg.addColorStop(Math.min(1, tail / (Math.PI * 2) + 0.001), `rgba(${CYAN}, 0)`);
      ctx.strokeStyle = tg;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, dist, ang - tail, ang);
      ctx.stroke();
    }

    // 連到核心的光線（收成 Dock 時淡出）
    if (lineA > 0.02) {
      ctx.globalAlpha = alpha * lineA;
      const lx = this.cx + Math.cos(ang) * this.coreR * 1.15;
      const ly = this.cy + Math.sin(ang) * this.coreR * 1.15;
      const ex = x - Math.cos(ang) * r;
      const ey = y - Math.sin(ang) * r;
      const lg = ctx.createLinearGradient(lx, ly, ex, ey);
      lg.addColorStop(0, `rgba(${CYAN}, 0.05)`);
      lg.addColorStop(1, `rgba(${rgb}, ${0.35 + n.hover * 0.4})`);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1 + n.hover;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

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
      ctx.globalAlpha = alpha * n.hover;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = t / 400 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(x, y, r + 7, a, a + 1.1);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
    }

    // 開啟時的發射光環
    if (flash > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r + (1 - flash) * r * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${GOLD}, ${flash})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 縮寫
    ctx.shadowBlur = 6;
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = n.app.glyph;
    const cjk = /[^\x00-\x7f]/.test(glyph);
    ctx.font = `700 ${Math.round(r * (cjk ? 0.6 : glyph.length > 2 ? 0.42 : 0.55))}px ${cjk ? "'Microsoft JhengHei', sans-serif" : 'ui-monospace, Consolas, monospace'}`;
    ctx.fillText(glyph, x, y + 1);

    // 環狀時名稱放在節點外側；Dock 時改由 drawDockLabel 只顯示游標所在的那個
    const ringLabel = 1 - Math.min(1, dockRaw * 2.5);
    if (!n.panel && !closingDock && p > 0.85 && ringLabel > 0) {
      ctx.font = `${Math.round(12 + n.hover * 4)}px 'Microsoft JhengHei', 'PingFang TC', system-ui, sans-serif`;
      ctx.globalAlpha = alpha * (0.75 + n.hover * 0.25) * ringLabel;
      const c = Math.cos(n.angle);
      const s = Math.sin(n.angle);
      const gap = r + 12;
      ctx.textAlign = c > 0.35 ? 'left' : c < -0.35 ? 'right' : 'center';
      ctx.textBaseline = s > 0.35 ? 'top' : s < -0.35 ? 'bottom' : 'middle';
      ctx.fillText(n.app.name, x + c * gap, y + s * gap);
    }
    ctx.restore();
  }

  /** Dock 上游標停留的那個：名稱標籤顯示在圖示上方 */
  private drawDockLabel(ctx: CanvasRenderingContext2D, app: AppDef) {
    const n = this.nodes.find((n) => n.app === app);
    if (!n) return;
    const text = app.kind === 'panel' ? `${app.name}（面板）` : app.name;
    ctx.save();
    ctx.font = `600 14px 'Microsoft JhengHei', 'PingFang TC', system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 20;
    // 靠近螢幕邊緣時往內縮，不要被切掉
    const x = Math.min(this.W - w / 2 - 8, Math.max(w / 2 + 8, n.dx));
    const y = n.dy - this.rd * 1.2 - 26;
    ctx.fillStyle = 'rgba(0, 18, 30, 0.85)';
    ctx.strokeStyle = `rgba(${GOLD}, 0.8)`;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 13, w, 26, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgb(${GOLD})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  // ---- 分組標籤（環的內側） ----
  private drawGroupLabels(ctx: CanvasRenderingContext2D, t: number, dock: number) {
    let a = 0;
    if (this.state === 'opening') a = clamp01((t - this.t0 - 4400) / 800);
    else if (this.state === 'open') a = 1;
    else if (this.state === 'closing') a = 1 - clamp01((t - this.t0) / 300);
    a *= 1 - Math.min(1, dock * 2);
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
      const ns = this.nodes.filter((n) => !n.panel && n.app.group === (g.id as GroupId));
      if (!ns.length) continue;
      const mid = (ns[0].angle + ns[ns.length - 1].angle) / 2;
      ctx.fillText(g.label, this.cx + Math.cos(mid) * labelR, this.cy + Math.sin(mid) * labelR);
    }
    ctx.restore();
  }
}
