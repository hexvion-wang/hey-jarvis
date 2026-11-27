import { drawReactor } from './reactor';
/**
 * HEX 主控台（第二段）：大核心＋左側系統儀表（下方留給常駐對話欄）＋右側天氣卡＋下方聲波，
 * 面板之間用電路折線連到核心。純 Canvas 繪製。
 */


import { hexColor } from './theme';
const GOLD = '255, 201, 64';
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

/** 天氣（agent /api/weather，資料來源 Open-Meteo） */
export interface WeatherInfo {
  city: string;
  current: { temp: number; feels: number; humidity: number; wind: number; code: number; isDay: boolean };
  hourly: { time: string; temp: number; code: number; pop: number; isDay: boolean }[];
}

/** 聲波的狀態：等待、聽你說話、辨識中、HEX 說話中 */
export type VoiceMode = 'idle' | 'listening' | 'thinking' | 'speaking';

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
  /** 常駐對話欄的位置（左下，系統狀態下面） */
  chatRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** AR 鏡頭小視窗的位置（右下，天氣卡下面） */
  arRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  weather: WeatherInfo | null = null;
  weatherError = false;
  private voiceMode: VoiceMode = 'idle';
  /** 平滑後的聲音大小 */
  voiceLevel = 0;

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
    // 左邊：系統狀態縮短放上面，下面留給常駐對話欄（底部要避開全息模式的 Dock）
    const top = Math.max(70, H * 0.08);
    const bottom = H - 230;
    const lh = Math.min(400, (bottom - top) * 0.5);
    this.left = { x: W * 0.035, y: top, w: pw, h: lh };
    this.chatRect = { x: W * 0.035, y: top + lh + 14, w: pw, h: Math.max(160, bottom - (top + lh + 14)) };
    // 右邊：天氣卡放在右上按鈕列下面，下面留給 AR 鏡頭小視窗（底部避開 iPhone 配對欄）
    const rTop = Math.max(top, 112); // 右上角那排按鈕的下面
    const rh = Math.min(ph, (H - 100 - rTop) * 0.62);
    this.right = { x: W - W * 0.035 - pw, y: rTop, w: pw, h: rh };
    const arTop = rTop + rh + 16;
    this.arRect = { x: this.right.x, y: arTop, w: pw, h: Math.max(140, H - 100 - arTop) };
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

  /** 每幀把聲音狀態交進來（聽你說話時是麥克風音量，HEX 說話時是它的聲音） */
  setVoice(mode: VoiceMode, level: number) {
    this.voiceMode = mode;
    // 上升快、下降慢，看起來比較像聲波
    const k = level > this.voiceLevel ? 0.5 : 0.12;
    this.voiceLevel += (level - this.voiceLevel) * k;
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

    drawReactor(ctx, cx, cy, R, t);
    if (k > 0.8) {
      ctx.globalAlpha = (k - 0.8) / 0.2;
      ctx.fillStyle = `rgb(${GOLD})`;
      ctx.shadowColor = `rgb(${GOLD})`;
      ctx.shadowBlur = 8;
      ctx.font = `600 ${Math.round(R * 0.075)}px ${MONO}`;
      ctx.textAlign = 'center';
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
  // ---- 右邊：天氣卡（像聲音參考裡 Jarvis 的 WEATHER 面板） ----
  private drawRight(ctx: CanvasRenderingContext2D, t: number, k: number) {
    const r = this.right;
    const w = this.weather;
    this.frame(ctx, r, k, `WEATHER · ${w?.city ?? '天氣'}`);
    const now = new Date();
    const x = r.x + 18;
    const iw = r.w - 36;

    // 右上角：小時鐘與日期
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = `rgb(${hexColor.rgb})`;
    ctx.fillText(now.toLocaleTimeString('zh-TW', { hour12: false }), r.x + r.w - 18, r.y + 27);
    ctx.font = `12px ${SANS}`;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.7)`;
    ctx.fillText(now.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' }), r.x + r.w - 18, r.y + 62);
    ctx.textAlign = 'left';

    if (!w) {
      ctx.font = `14px ${SANS}`;
      ctx.fillStyle = `rgba(${hexColor.rgb}, 0.7)`;
      ctx.fillText(this.weatherError ? '天氣暫時無法取得（需要網路）' : '讀取天氣中…', x, r.y + 100);
      ctx.restore();
      return;
    }
    const c = w.current;
    // 大圖示＋溫度
    let y = r.y + 70;
    const icon = Math.min(92, r.h * 0.18);
    drawWeatherIcon(ctx, c.code, c.isDay, x + icon / 2, y + icon / 2, icon, t);
    ctx.shadowColor = `rgb(${hexColor.rgb})`;
    ctx.shadowBlur = 14;
    ctx.fillStyle = `rgb(${hexColor.rgb})`;
    ctx.font = `700 ${Math.round(icon * 0.78)}px ${MONO}`;
    const tx = x + icon + 16;
    ctx.fillText(`${Math.round(c.temp)}°`, tx, y + icon * 0.72);
    ctx.shadowBlur = 0;
    ctx.font = `700 15px ${SANS}`;
    ctx.fillStyle = 'rgba(235, 250, 255, 0.92)';
    ctx.fillText(weatherText(c.code), tx, y + icon * 0.72 + 24);

    // 細節：體感、濕度、風速、降雨機率
    y += icon + 40;
    const pop = w.hourly[0]?.pop ?? 0;
    const cells: [string, string][] = [
      ['體感', `${Math.round(c.feels)}°C`],
      ['濕度', `${Math.round(c.humidity)}%`],
      ['風速', `${Math.round(c.wind)} km/h`],
      ['降雨機率', `${Math.round(pop)}%`],
    ];
    const cw = iw / 2;
    cells.forEach(([label, val], i) => {
      const cx = x + (i % 2) * cw;
      const cy = y + Math.floor(i / 2) * 40;
      ctx.font = `12px ${SANS}`;
      ctx.fillStyle = `rgba(${hexColor.rgb}, 0.7)`;
      ctx.fillText(label, cx, cy);
      ctx.font = `700 17px ${MONO}`;
      ctx.fillStyle = 'rgba(235, 250, 255, 0.92)';
      ctx.fillText(val, cx, cy + 20);
    });

    // 未來 8 小時（今晚）：溫度曲線＋每小時小圖示
    y += 96;
    ctx.fillStyle = `rgba(${hexColor.rgb}, 0.25)`;
    ctx.fillRect(x, y - 22, iw, 1);
    ctx.font = `700 12px ${MONO}`;
    ctx.fillStyle = `rgb(${GOLD})`;
    ctx.fillText('NEXT 8 HOURS · 未來 8 小時', x, y);
    const hrs = w.hourly.slice(1, 9);
    const bottom = r.y + r.h - 16;
    const top = y + 18;
    if (hrs.length > 1 && bottom - top > 90) {
      const temps = hrs.map((h) => h.temp);
      const lo = Math.min(...temps) - 1;
      const hi = Math.max(...temps) + 1;
      const step = iw / hrs.length;
      const graphTop = top + 22;
      const graphH = Math.max(30, bottom - graphTop - 62);
      const px = (i: number) => x + step * (i + 0.5);
      const py = (v: number) => graphTop + graphH * (1 - (v - lo) / (hi - lo));
      // 曲線
      ctx.strokeStyle = `rgba(${hexColor.rgb}, 0.9)`;
      ctx.lineWidth = 2;
      ctx.shadowColor = `rgb(${hexColor.rgb})`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      hrs.forEach((h, i) => (i ? ctx.lineTo(px(i), py(h.temp)) : ctx.moveTo(px(i), py(h.temp))));
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      hrs.forEach((h, i) => {
        ctx.fillStyle = `rgb(${hexColor.rgb})`;
        ctx.beginPath();
        ctx.arc(px(i), py(h.temp), 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `700 12px ${MONO}`;
        ctx.fillStyle = 'rgba(235, 250, 255, 0.9)';
        ctx.fillText(`${Math.round(h.temp)}°`, px(i), py(h.temp) - 9);
        drawWeatherIcon(ctx, h.code, h.isDay, px(i), bottom - 40, Math.min(26, step * 0.7), t);
        ctx.font = `11px ${MONO}`;
        ctx.fillStyle = `rgba(${hexColor.rgb}, 0.75)`;
        ctx.fillText(h.time, px(i), bottom - 14);
        if (h.pop >= 20) {
          ctx.fillStyle = 'rgba(120, 190, 255, 0.85)';
          ctx.fillText(`${h.pop}%`, px(i), bottom);
        }
      });
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  private drawWave(ctx: CanvasRenderingContext2D, t: number, k: number) {
    drawVoiceWave(ctx, this.wave, t, this.voiceMode, this.voiceLevel, k);
  }
}

/**
 * 聲波條：平常是緩慢的波；聽你說話時跟著你的音量起伏（金色）；
 * 辨識中是快速的小漣漪；HEX 說話時跟著它的聲音起伏。主控台底部和全息模式共用。
 */
export function drawVoiceWave(ctx: CanvasRenderingContext2D, r: Rect, t: number, mode: VoiceMode, level: number, k: number) {
  const rgb = mode === 'listening' ? GOLD : hexColor.rgb;
  ctx.save();
  ctx.globalAlpha = k;
  ctx.fillStyle = 'rgba(0, 10, 18, 0.55)';
  ctx.strokeStyle = `rgba(${rgb}, ${mode === 'idle' ? 0.35 : 0.7})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fill();
  ctx.stroke();
  const mid = r.y + r.h / 2;
  // 波的高度：等待時緩慢呼吸；有聲音時跟著音量
  const idleAmp = 0.6 + 0.4 * Math.sin(t * 0.002);
  const amp = mode === 'idle' ? idleAmp : mode === 'thinking' ? 0.35 : 0.15 + Math.min(1.25, level * 1.6);
  const speed = mode === 'idle' ? 1 : mode === 'thinking' ? 4 : 2.2;
  ctx.shadowColor = `rgb(${rgb})`;
  ctx.shadowBlur = mode === 'idle' ? 10 : 16;
  for (const [a, sp, al, freq] of [
    [0.32, 0.004, 0.95, 0.25],
    [0.2, -0.006, 0.5, 0.33],
    [0.12, 0.009, mode === 'idle' ? 0 : 0.45, 0.5],
  ] as const) {
    if (!al) continue;
    ctx.strokeStyle = `rgba(${rgb}, ${al})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const px = r.x + r.h / 2 + ((r.w - r.h) * i) / 120;
      const env = Math.sin((i / 120) * Math.PI);
      // 有聲音時加一點不規則的抖動，比較像真的聲音
      const jitter = mode === 'idle' ? 0 : Math.sin(i * 1.7 + t * 0.03) * 0.25 + Math.sin(i * 0.9 - t * 0.021) * 0.2;
      const py = mid + (Math.sin(i * freq + t * sp * speed) + jitter) * r.h * a * env * amp;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${rgb}, 0.9)`;
  ctx.font = `600 11px ${MONO}`;
  ctx.textAlign = 'center';
  const label =
    mode === 'listening'
      ? 'LISTENING · 聆聽中（說完停一下）'
      : mode === 'thinking'
        ? 'PROCESSING · 辨識中'
        : mode === 'speaking'
          ? 'HEX SPEAKING · 回覆中'
          : 'STANDBY FOR COMMAND · 等待指令（按 Enter 說話）';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h + 18);
  ctx.restore();
}

/** 天氣代碼（WMO）→ 中文描述 */
function weatherText(code: number) {
  if (code === 0) return '晴朗';
  if (code <= 2) return '晴時多雲';
  if (code === 3) return '陰天';
  if (code <= 48) return '霧';
  if (code <= 57) return '毛毛雨';
  if (code <= 67) return '下雨';
  if (code <= 77) return '下雪';
  if (code <= 82) return '陣雨';
  return '雷雨';
}

/** 畫天氣小圖示：太陽／月亮、雲、雨滴、閃電、霧 */
function drawWeatherIcon(ctx: CanvasRenderingContext2D, code: number, isDay: boolean, x: number, y: number, size: number, t: number) {
  const s = size / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = `rgb(${hexColor.rgb})`;
  ctx.shadowBlur = 8;
  const cloudy = code >= 2;
  // 太陽或月亮（多雲時縮小放在左上）
  if (code <= 3) {
    const sx = cloudy ? x - s * 0.35 : x;
    const sy = cloudy ? y - s * 0.3 : y;
    const sr = s * (cloudy ? 0.42 : 0.55);
    if (isDay) {
      ctx.fillStyle = `rgb(${GOLD})`;
      ctx.strokeStyle = `rgb(${GOLD})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.08);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 0.0004;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * sr * 0.85, sy + Math.sin(a) * sr * 0.85);
        ctx.lineTo(sx + Math.cos(a) * sr * 1.15, sy + Math.sin(a) * sr * 1.15);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(225, 235, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(sx + sr * 0.4, sy - sr * 0.25, sr * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // 雲
  if (cloudy) {
    ctx.fillStyle = code === 3 || code >= 45 ? 'rgba(190, 205, 220, 0.95)' : 'rgba(225, 235, 245, 0.95)';
    ctx.beginPath();
    ctx.arc(x - s * 0.3, y + s * 0.05, s * 0.32, 0, Math.PI * 2);
    ctx.arc(x + s * 0.05, y - s * 0.12, s * 0.42, 0, Math.PI * 2);
    ctx.arc(x + s * 0.42, y + s * 0.08, s * 0.3, 0, Math.PI * 2);
    ctx.rect(x - s * 0.3, y + s * 0.05, s * 0.72, s * 0.33);
    ctx.fill();
  }
  // 雨／雪
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) {
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.95)';
    ctx.lineWidth = Math.max(1, s * 0.09);
    for (let i = 0; i < 3; i++) {
      const dx = x - s * 0.3 + i * s * 0.3;
      const off = ((t * 0.002 + i * 0.33) % 1) * s * 0.15;
      ctx.beginPath();
      ctx.moveTo(dx, y + s * 0.5 + off);
      ctx.lineTo(dx - s * 0.08, y + s * 0.75 + off);
      ctx.stroke();
    }
  } else if (code >= 71 && code <= 77) {
    ctx.fillStyle = 'rgba(235, 245, 255, 0.95)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x - s * 0.3 + i * s * 0.3, y + s * 0.62, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 閃電
  if (code >= 95) {
    ctx.fillStyle = `rgb(${GOLD})`;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.05, y + s * 0.3);
    ctx.lineTo(x - s * 0.15, y + s * 0.65);
    ctx.lineTo(x + s * 0.02, y + s * 0.62);
    ctx.lineTo(x - s * 0.08, y + s * 0.95);
    ctx.lineTo(x + s * 0.22, y + s * 0.52);
    ctx.lineTo(x + s * 0.05, y + s * 0.55);
    ctx.closePath();
    ctx.fill();
  }
  // 霧
  if (code >= 45 && code <= 48) {
    ctx.strokeStyle = 'rgba(200, 215, 230, 0.8)';
    ctx.lineWidth = Math.max(1, s * 0.08);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y + s * (0.5 + i * 0.2));
      ctx.lineTo(x + s * 0.5, y + s * (0.5 + i * 0.2));
      ctx.stroke();
    }
  }
  ctx.restore();
}
