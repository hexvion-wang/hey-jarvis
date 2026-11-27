/**
 * HEX 主控台（第二段）：大核心＋左側系統儀表＋右側時鐘與日報卡＋下方聲波，
 * 面板之間用電路折線連到核心。純 Canvas 繪製。
 */


import { hexColor } from './theme';
const GOLD = '255, 201, 64';
const GREEN = '125, 255, 176';
const RED = '255, 90, 90';
export const CONSOLE_OPEN_MS = 2200;
export const CONSOLE_CLOSE_MS = 800;

export interface SysInfo {
  cpu: { percent: number; cores: number; model: string };
  mem: { percent: number; usedGB: number; totalGB: number };
  gpu: { name: string; util: number; temp: number; memUsed: number; memTotal: number } | null;
  uptimeH: number;
}

export interface DailySummary {
  date: string;
  fallback: boolean;
  title: string;
  verdict: string;
  bullets: string[];
}

type State = 'hidden' | 'opening' | 'open' | 'closing';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const MONO = 'ui-monospace, Consolas, monospace';
const SANS = "'Microsoft JhengHei', 'PingFang TC', system-ui, sans-serif";

interface Rect { x: number; y: number; w: number; h: number }

export class HexConsole {
  state: State = 'hidden';
  private t0 = 0;
  private cx = 0;
  private cy = 0;
  private coreR = 100;
  private left: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private right: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private wave: Rect = { x: 0, y: 0, w: 0, h: 0 };

  sys: SysInfo | null = null;
  daily: DailySummary | null = null;
  demo = false;
  /** 儀表顯示值（平滑往目標值靠近） */
  private shown = { cpu: 0, mem: 0, gpu: 0, temp: 0 };

  layout(W: number, H: number) {
    this.cx = W / 2;
    this.cy = H * 0.47;
    const m = Math.min(W, H);
    this.coreR = m * 0.17;
    const pw = Math.min(380, W * 0.26);
    const ph = Math.min(H * 0.62, 520);
    this.left = { x: W * 0.035, y: this.cy - ph / 2, w: pw, h: ph };
    this.right = { x: W - W * 0.035 - pw, y: this.cy - ph / 2, w: pw, h: ph };
    const ww = Math.min(520, W * 0.36);
    this.wave = { x: this.cx - ww / 2, y: H * 0.84, w: ww, h: Math.min(70, H * 0.08) };
  }

  open(t: number) {
    if (this.state === 'open' || this.state === 'opening') return;
    this.state = 'opening';
    this.t0 = t;
  }

  close(t: number) {
    if (this.state === 'hidden' || this.state === 'closing') return;
    this.state = 'closing';
    this.t0 = t;
  }

  get visible() {
    return this.state !== 'hidden';
  }

  hitCore(x: number, y: number) {
    return this.state === 'open' && Math.hypot(x - this.cx, y - this.cy) <= this.coreR * 0.6;
  }

  /** 0~1：整體展開程度 */
  private amount(t: number) {
    const e = t - this.t0;
    if (this.state === 'open') return 1;
    if (this.state === 'opening') return clamp01(e / CONSOLE_OPEN_MS);
    if (this.state === 'closing') return 1 - clamp01(e / CONSOLE_CLOSE_MS);
    return 0;
  }

  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, standbyCoreR: number) {
    const e = t - this.t0;
    if (this.state === 'opening' && e > CONSOLE_OPEN_MS) this.state = 'open';
    if (this.state === 'closing' && e > CONSOLE_CLOSE_MS) this.state = 'hidden';
    if (this.state === 'hidden') return;

    const a = this.amount(t);
    // 開啟順序：核心放大 → 電路線延伸 → 面板展開
    const coreK = easeOut(a / 0.35);
    const lineK = clamp01((a - 0.25) / 0.35);
    const panelK = easeOut((a - 0.45) / 0.55);

    this.ease(dt);
    this.drawCircuits(ctx, t, lineK);
    this.drawCore(ctx, t, standbyCoreR + (this.coreR - standbyCoreR) * coreK, coreK);
    if (panelK > 0) {
      this.drawLeft(ctx, t, panelK);
      this.drawRight(ctx, t, panelK);
      this.drawWave(ctx, t, panelK);
    }
  }

  private ease(dt: number) {
    const k = Math.min(1, dt / 250);
    const s = this.sys;
    const tgt = { cpu: s?.cpu.percent ?? 0, mem: s?.mem.percent ?? 0, gpu: s?.gpu?.util ?? 0, temp: s?.gpu?.temp ?? 0 };
    for (const key of Object.keys(tgt) as (keyof typeof tgt)[]) this.shown[key] += (tgt[key] - this.shown[key]) * k;
  }

  // ---- 大核心 ----
  private drawCore(ctx: CanvasRenderingContext2D, t: number, R: number, k: number) {
    const { cx, cy } = this;
    ctx.save();
    ctx.shadowColor = `rgb(${hexColor.rgb})`;
    ctx.shadowBlur = 18;

    // 外圈刻度
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 90; i++) {
      const ang = (i / 90) * Math.PI * 2 + t * 0.00005;
      const long = i % 15 === 0;
      const r1 = R * 1.08;
      const r2 = R * (long ? 1.17 : 1.12);
      ctx.strokeStyle = long ? `rgba(${GOLD}, ${0.8 * k})` : `rgba(${hexColor.rgb}, ${0.4 * k})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }

    // 多層反向旋轉的弧
    const rings: [number, number, number, number, number][] = [
      // 半徑倍率、轉速、段數、每段長度、線寬
      [1.0, 0.0005, 4, 1.1, 3],
      [0.86, -0.0008, 6, 0.7, 2],
      [0.72, 0.0012, 3, 1.6, 4],
      [0.58, -0.0016, 8, 0.4, 1.5],
    ];
    for (const [m, sp, n, len, w] of rings) {
      ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(${hexColor.rgb}, ${0.35 + 0.5 * k})`;
      for (let i = 0; i < n; i++) {
        const s = t * sp + (i * Math.PI * 2) / n;
        ctx.beginPath();
        ctx.arc(cx, cy, R * m, s, s + len);
        ctx.stroke();
      }
    }

    // 中心六角＋光暈
    const pulse = 0.5 + 0.5 * Math.sin(t / 300);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    g.addColorStop(0, `rgba(230, 255, 255, ${0.6 + 0.3 * pulse})`);
    g.addColorStop(0.5, `rgba(${hexColor.rgb}, 0.35)`);
    g.addColorStop(1, `rgba(${hexColor.rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i + Math.PI / 6 + t * 0.0003;
      const px = cx + Math.cos(ang) * R * 0.3;
      const py = cy + Math.sin(ang) * R * 0.3;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.95)`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = hexColor.dark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(R * 0.16)}px ${MONO}`;
    ctx.fillText('HEX', cx, cy - R * 0.02);
    if (k > 0.8) {
      ctx.globalAlpha = (k - 0.8) / 0.2;
      ctx.fillStyle = `rgb(${GOLD})`;
      ctx.shadowColor = `rgb(${GOLD})`;
      ctx.shadowBlur = 8;
      ctx.font = `600 ${Math.round(R * 0.075)}px ${MONO}`;
      ctx.fillText('S Y S T E M S   O N L I N E', cx, cy + R * 1.32);
    }
    ctx.restore();
  }

  // ---- 電路折線：核心 → 各面板，上面有光點在跑 ----
  private circuitPaths(): [number, number][][] {
    const { cx, cy, coreR: R, left: L, right: Rt, wave: Wv } = this;
    const lx = L.x + L.w;
    const rx = Rt.x;
    return [
      [[cx - R * 1.2, cy - R * 0.3], [cx - R * 1.6, cy - R * 0.3], [cx - R * 1.9, L.y + L.h * 0.22], [lx, L.y + L.h * 0.22]],
      [[cx - R * 1.2, cy + R * 0.3], [cx - R * 1.7, cy + R * 0.3], [cx - R * 2.0, L.y + L.h * 0.75], [lx, L.y + L.h * 0.75]],
      [[cx + R * 1.2, cy - R * 0.3], [cx + R * 1.6, cy - R * 0.3], [cx + R * 1.9, Rt.y + Rt.h * 0.12], [rx, Rt.y + Rt.h * 0.12]],
      [[cx + R * 1.2, cy + R * 0.3], [cx + R * 1.7, cy + R * 0.3], [cx + R * 2.0, Rt.y + Rt.h * 0.6], [rx, Rt.y + Rt.h * 0.6]],
      [[cx, cy + R * 1.2], [cx, Wv.y - 6]],
    ];
  }

  private drawCircuits(ctx: CanvasRenderingContext2D, t: number, k: number) {
    if (k <= 0) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.shadowColor = `rgb(${hexColor.rgb})`;
    ctx.shadowBlur = 6;
    for (const [pi, path] of this.circuitPaths().entries()) {
      // 依進度畫出部分路徑
      const segs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
      const total = segs.reduce((s, v) => s + v, 0);
      let remain = total * k;
      ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.45)`;
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 0; i < segs.length && remain > 0; i++) {
        const f = Math.min(1, remain / segs[i]);
        ctx.lineTo(path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f);
        remain -= segs[i];
      }
      ctx.stroke();
      // 轉折點的小方塊
      ctx.fillStyle = `rgba(${hexColor.rgb}, ${0.8 * k})`;
      for (const p of path.slice(1, -1)) ctx.fillRect(p[0] - 2.5, p[1] - 2.5, 5, 5);

      // 沿線跑的光點
      if (k >= 1) {
        let d = ((t * 0.12 + pi * 97) % total + total) % total;
        for (let i = 0; i < segs.length; i++) {
          if (d <= segs[i]) {
            const f = d / segs[i];
            const x = path[i][0] + (path[i + 1][0] - path[i][0]) * f;
            const y = path[i][1] + (path[i + 1][1] - path[i][1]) * f;
            ctx.fillStyle = `rgb(${GOLD})`;
            ctx.shadowColor = `rgb(${GOLD})`;
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowColor = `rgb(${hexColor.rgb})`;
            break;
          }
          d -= segs[i];
        }
      }
    }
    ctx.restore();
  }

  // ---- 面板外框 ----
  private frame(ctx: CanvasRenderingContext2D, r: Rect, k: number, title: string) {
    // 由上往下展開
    const h = r.h * k;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(0, 18, 30, 0.6)';
    ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, h, 8);
    ctx.fill();
    ctx.stroke();
    // 四角加粗
    ctx.strokeStyle = `rgb(${hexColor.rgb})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = `rgb(${hexColor.rgb})`;
    ctx.shadowBlur = 8;
    const c = 16;
    for (const [x, y, sx, sy] of [
      [r.x, r.y, 1, 1],
      [r.x + r.w, r.y, -1, 1],
      [r.x, r.y + h, 1, -1],
      [r.x + r.w, r.y + h, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * c);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * c, y);
      ctx.stroke();
    }
    // 標題列
    ctx.shadowBlur = 6;
    ctx.fillStyle = `rgb(${hexColor.rgb})`;
    ctx.font = `700 13px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(title, r.x + 16, r.y + 20);
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.25)`;
    ctx.fillRect(r.x + 16, r.y + 34, r.w - 32, 1);
    ctx.restore();
    // 之後的內容只畫在已展開的範圍內
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, h);
    ctx.clip();
    ctx.globalAlpha = clamp01((k - 0.5) / 0.5);
  }

  // ---- 左：系統狀態 ----
  private drawLeft(ctx: CanvasRenderingContext2D, t: number, k: number) {
    const r = this.left;
    this.frame(ctx, r, k, this.demo ? 'SYSTEM · 系統狀態（DEMO）' : 'SYSTEM · 系統狀態');
    const s = this.sys;
    const gw = (r.w - 32) / 2;
    const gr = Math.min(gw * 0.36, (r.h - 120) * 0.17);
    const row1 = r.y + 60 + gr + 10;
    const row2 = row1 + gr * 2 + 46;
    this.gauge(ctx, r.x + 16 + gw / 2, row1, gr, this.shown.cpu, 'CPU', `${Math.round(this.shown.cpu)}%`, t);
    this.gauge(ctx, r.x + 16 + gw * 1.5, row1, gr, this.shown.mem, 'RAM', `${Math.round(this.shown.mem)}%`, t);
    this.gauge(ctx, r.x + 16 + gw / 2, row2, gr, this.shown.gpu, 'GPU', `${Math.round(this.shown.gpu)}%`, t);
    this.gauge(ctx, r.x + 16 + gw * 1.5, row2, gr, this.shown.temp, 'GPU TEMP', `${Math.round(this.shown.temp)}°C`, t, true);

    // 下方細節
    ctx.font = `12px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.75)`;
    const lines = s
      ? [
          `${s.cpu.model.replace(/\(R\)|\(TM\)|CPU/g, '').replace(/\s+/g, ' ').trim()} · ${s.cpu.cores} 執行緒`,
          `記憶體 ${s.mem.usedGB} / ${s.mem.totalGB} GB`,
          s.gpu ? `${s.gpu.name.replace('NVIDIA GeForce ', '')} · VRAM ${(s.gpu.memUsed / 1024).toFixed(1)} / ${(s.gpu.memTotal / 1024).toFixed(1)} GB` : '顯示卡資訊無法取得',
          `開機時間 ${s.uptimeH} 小時`,
        ]
      : ['等待系統資料…'];
    let y = row2 + gr + 44;
    for (const l of lines) {
      if (y > r.y + r.h - 10) break;
      ctx.fillText(l, r.x + 18, y);
      y += 19;
    }
    ctx.restore();
  }

  private gauge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    value: number,
    label: string,
    text: string,
    t: number,
    isTemp = false,
  ) {
    const pct = clamp01(value / 100);
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const hot = isTemp ? value >= 75 : value >= 85;
    const rgb = hot ? RED : value >= (isTemp ? 60 : 60) ? GOLD : hexColor.rgb;
    ctx.save();
    ctx.lineCap = 'round';
    // 底軌
    ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.15)`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x, y, r, start, start + sweep);
    ctx.stroke();
    // 數值弧
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, start, start + sweep * pct);
    ctx.stroke();
    // 內圈旋轉虛線
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.35)`;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, t * 0.001, t * 0.001 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // 文字
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(r * 0.42)}px ${MONO}`;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.8)`;
    ctx.font = `600 11px ${MONO}`;
    ctx.fillText(label, x, y + r + 16);
    ctx.restore();
  }

  // ---- 右：時鐘＋日報 ----
  private drawRight(ctx: CanvasRenderingContext2D, _t: number, k: number) {
    const r = this.right;
    this.frame(ctx, r, k, 'BRIEFING · 今日簡報');
    const now = new Date();
    const x = r.x + 18;
    let y = r.y + 78;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgb(${hexColor.rgb})`;
    ctx.shadowColor = `rgb(${hexColor.rgb})`;
    ctx.shadowBlur = 10;
    ctx.font = `700 40px ${MONO}`;
    ctx.fillText(now.toLocaleTimeString('zh-TW', { hour12: false }), x, y);
    ctx.shadowBlur = 0;
    y += 24;
    ctx.font = `14px ${SANS}`;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.8)`;
    ctx.fillText(now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }), x, y);

    y += 22;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.25)`;
    ctx.fillRect(x, y, r.w - 36, 1);
    y += 26;

    const d = this.daily;
    ctx.font = `700 13px ${MONO}`;
    ctx.fillStyle = `rgb(${GOLD})`;
    ctx.fillText('DAILY REPORT · 台美股日報', x, y);
    y += 22;
    if (!d) {
      ctx.font = `13px ${SANS}`;
      ctx.fillStyle = `rgba(${hexColor.rgb}, 0.7)`;
      ctx.fillText(this.demo ? '需要本機 agent 才能讀取日報' : '讀取中…', x, y);
      ctx.restore();
      return;
    }
    // 判斷標籤
    const vRgb = /空/.test(d.verdict) ? RED : /多/.test(d.verdict) ? GREEN : GOLD;
    ctx.font = `700 15px ${SANS}`;
    const vText = d.verdict || '—';
    const vw = ctx.measureText(vText).width + 20;
    ctx.fillStyle = `rgba(${vRgb}, 0.15)`;
    ctx.strokeStyle = `rgb(${vRgb})`;
    ctx.beginPath();
    ctx.roundRect(x, y - 16, vw, 24, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgb(${vRgb})`;
    ctx.fillText(vText, x + 10, y + 1);
    ctx.font = `13px ${SANS}`;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.75)`;
    ctx.fillText(`${d.date}${d.fallback ? '（今天的還沒產生，顯示最新一份）' : ''}`, x + vw + 10, y + 1);
    y += 28;

    ctx.font = `13px ${SANS}`;
    const maxW = r.w - 50;
    for (const b of d.bullets) {
      const lines = wrap(ctx, b, maxW);
      if (y + lines.length * 19 > r.y + r.h - 12) break;
      ctx.fillStyle = `rgb(${GOLD})`;
      ctx.fillText('›', x, y);
      ctx.fillStyle = 'rgba(215, 248, 255, 0.9)';
      for (const l of lines) {
        ctx.fillText(l, x + 14, y);
        y += 19;
      }
      y += 6;
    }
    ctx.restore();
  }

  // ---- 下：聲波 ----
  private drawWave(ctx: CanvasRenderingContext2D, t: number, k: number) {
    const r = this.wave;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    ctx.stroke();
    const mid = r.y + r.h / 2;
    ctx.shadowColor = `rgb(${hexColor.rgb})`;
    ctx.shadowBlur = 10;
    for (const [amp, sp, al] of [
      [0.32, 0.004, 0.9],
      [0.2, -0.006, 0.5],
    ] as const) {
      ctx.strokeStyle = `rgba(${hexColor.rgb}, ${al})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const px = r.x + r.h / 2 + ((r.w - r.h) * i) / 100;
        const env = Math.sin((i / 100) * Math.PI);
        const py = mid + Math.sin(i * 0.25 + t * sp) * r.h * amp * env * (0.6 + 0.4 * Math.sin(t * 0.002));
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.8)`;
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('STANDBY FOR COMMAND · 等待指令', this.cx, r.y + r.h + 18);
    ctx.restore();
  }
}

/** 中文逐字換行 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}
