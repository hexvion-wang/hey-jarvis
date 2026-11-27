/**
 * 參考圖的外框與背景層（參考使用者 Pinterest 上的藍色 HUD 介面）：
 * - 金屬斜角外框＋內緣藍色光線、左右兩側的發光條
 * - 很淡的方格與十字記號、上下的刻度尺
 * - 會動的小東西：右側橘色警示條、左側一欄慢慢打字的資料、閃爍的小方塊、往下掃的掃描線
 *
 * 不會動的部分先畫在一張快取圖上（換顏色或改視窗大小才重畫），每幀只畫少量會動的東西，避免吃效能。
 */
import { ACCENT, hexColor } from './theme';

const MONO = "'Consolas', 'Courier New', monospace";
/** 外框厚度、斜角大小 */
const BEZEL = 9;
const CHAMFER = 30;

function chamferPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number) {
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.lineTo(x + w, y + k);
  c.lineTo(x + w, y + h - k);
  c.lineTo(x + w - k, y + h);
  c.lineTo(x + k, y + h);
  c.lineTo(x, y + h - k);
  c.lineTo(x, y + k);
  c.closePath();
}

const HEXCHARS = '0123456789ABCDEF';
const WORDS = ['SYS', 'CORE', 'NET', 'MEM', 'GPU', 'LINK', 'AUDIO', 'VOICE', 'SCAN', 'GRID', 'PWR', 'SYNC'];
const STATES = ['OK', 'OK', 'OK', 'READY', 'SYNC', 'IDLE', '98%', 'ON'];
function randLine() {
  const hex = Array.from({ length: 4 }, () => HEXCHARS[(Math.random() * 16) | 0]).join('');
  const w = WORDS[(Math.random() * WORDS.length) | 0];
  const s = STATES[(Math.random() * STATES.length) | 0];
  const n = (Math.random() * 100).toFixed(2).padStart(6, '0');
  return `0x${hex}  ${w.padEnd(6)} ${n}  ${s}`;
}

export class HudFrame {
  /** 左側資料欄要不要顯示（主控台有對話欄擋在那裡時關掉） */
  dataVisible = true;
  private dataK = 1;
  private cache: HTMLCanvasElement | null = null;
  private key = '';
  private lines = Array.from({ length: 14 }, () => ({ text: randLine(), born: -Math.random() * 4000 }));
  private blocks = Array.from({ length: 5 }, (_, i) => ({ fx: [0.08, 0.9, 0.86, 0.12, 0.5][i], fy: [0.2, 0.3, 0.78, 0.86, 0.9][i], period: 700 + i * 260 }));

  draw(ctx: CanvasRenderingContext2D, t: number, W: number, H: number) {
    const rgb = hexColor.rgb;
    const key = `${W}x${H}:${rgb}`;
    if (key !== this.key) {
      this.cache = this.build(W, H, rgb);
      this.key = key;
    }
    // 待機暗一點，喚醒後亮起來
    const lv = 0.55 + 0.45 * hexColor.level;
    ctx.save();
    ctx.globalAlpha = lv;
    ctx.drawImage(this.cache!, 0, 0, W, H);
    ctx.restore();
    this.drawLive(ctx, t, W, H, rgb, lv);
  }

  /** 不會動的部分 */
  private build(W: number, H: number, rgb: string) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d')!;
    const col = (a: number) => `rgba(${rgb}, ${a})`;

    // 很淡的方格＋每 4 格一個十字
    const step = 48;
    c.strokeStyle = col(0.035);
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < W; x += step) {
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, H);
    }
    for (let y = 0; y < H; y += step) {
      c.moveTo(0, y + 0.5);
      c.lineTo(W, y + 0.5);
    }
    c.stroke();
    c.strokeStyle = col(0.16);
    c.beginPath();
    for (let x = step * 2; x < W; x += step * 4) {
      for (let y = step * 2; y < H; y += step * 4) {
        c.moveTo(x - 4, y + 0.5);
        c.lineTo(x + 5, y + 0.5);
        c.moveTo(x + 0.5, y - 4);
        c.lineTo(x + 0.5, y + 5);
      }
    }
    c.stroke();

    // 上下中間的刻度尺
    for (const [y, dir] of [[BEZEL + 34, 1], [H - BEZEL - 34, -1]] as const) {
      const w = Math.min(520, W * 0.34);
      const x0 = W / 2 - w / 2;
      c.strokeStyle = col(0.3);
      c.beginPath();
      c.moveTo(x0, y + 0.5);
      c.lineTo(x0 + w, y + 0.5);
      for (let i = 0; i <= 40; i++) {
        const x = Math.round(x0 + (w * i) / 40) + 0.5;
        c.moveTo(x, y);
        c.lineTo(x, y + dir * (i % 10 === 0 ? 9 : i % 5 === 0 ? 6 : 3));
      }
      c.stroke();
    }

    // 金屬斜角外框：外緣到內緣之間塗金屬漸層
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H);
    chamferPath(c, BEZEL, BEZEL, W - BEZEL * 2, H - BEZEL * 2, CHAMFER);
    const metal = c.createLinearGradient(0, 0, W, H);
    metal.addColorStop(0, '#2c3744');
    metal.addColorStop(0.3, '#121820');
    metal.addColorStop(0.55, '#36414d');
    metal.addColorStop(0.8, '#10151c');
    metal.addColorStop(1, '#2a3440');
    c.fillStyle = metal;
    c.fill('evenodd');
    c.restore();
    // 內緣的藍色光線
    c.save();
    c.shadowColor = `rgb(${rgb})`;
    c.shadowBlur = 10;
    c.strokeStyle = col(0.85);
    c.lineWidth = 1.5;
    c.beginPath();
    chamferPath(c, BEZEL + 0.5, BEZEL + 0.5, W - BEZEL * 2 - 1, H - BEZEL * 2 - 1, CHAMFER);
    c.stroke();
    c.restore();
    // 外緣一條細亮邊（金屬反光）
    c.strokeStyle = 'rgba(190, 210, 230, 0.18)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, W - 1, H - 1);

    // 左右兩側的發光條
    for (const x of [2, W - 2 - 6]) {
      const h = H * 0.24;
      const y = H / 2 - h / 2;
      c.save();
      c.shadowColor = `rgb(${rgb})`;
      c.shadowBlur = 16;
      const g = c.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, col(0));
      g.addColorStop(0.2, col(0.9));
      g.addColorStop(0.8, col(0.9));
      g.addColorStop(1, col(0));
      c.fillStyle = g;
      c.fillRect(x, y, 6, h);
      c.restore();
    }
    return cv;
  }

  /** 會動的部分（每幀） */
  private drawLive(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, rgb: string, lv: number) {
    const col = (a: number) => `rgba(${rgb}, ${a * lv})`;
    ctx.save();

    // 右側橘色警示條（斜紋慢慢往上捲）
    const sx = W - BEZEL - 22;
    const sy = H * 0.38;
    const sh = H * 0.2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, 7, sh);
    ctx.clip();
    ctx.fillStyle = `rgba(${ACCENT}, ${0.85 * lv})`;
    const off = (t * 0.02) % 14;
    for (let y = sy - 14 - off; y < sy + sh + 14; y += 14) {
      ctx.beginPath();
      ctx.moveTo(sx, y + 7);
      ctx.lineTo(sx + 7, y);
      ctx.lineTo(sx + 7, y + 6);
      ctx.lineTo(sx, y + 13);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = `rgba(${ACCENT}, ${0.5 * lv})`;
    ctx.strokeRect(sx - 2.5, sy - 2.5, 12, sh + 5);

    // 左側一欄資料：每行慢慢打出來，過一陣子換新的（淡入淡出）
    this.dataK += ((this.dataVisible ? 1 : 0) - this.dataK) * 0.08;
    ctx.font = `11px ${MONO}`;
    ctx.textBaseline = 'top';
    const x0 = BEZEL + 26;
    const y0 = H * 0.36;
    for (let i = 0; i < this.lines.length; i++) {
      const L = this.lines[i];
      const age = t - L.born;
      if (age > 9000 + i * 300) {
        L.text = randLine();
        L.born = t + Math.random() * 1500;
        continue;
      }
      if (age < 0) continue;
      const n = Math.min(L.text.length, Math.floor(age / 28));
      if (this.dataK < 0.02) continue;
      ctx.fillStyle = col((i % 5 === 0 ? 0.42 : 0.24) * this.dataK);
      ctx.fillText(L.text.slice(0, n), x0, y0 + i * 15);
    }

    // 閃爍的小方塊
    for (const b of this.blocks) {
      const on = Math.floor((t + b.period * 0.37) / b.period) % 3 !== 0;
      if (!on) continue;
      ctx.fillStyle = col(0.3);
      ctx.fillRect(Math.round(W * b.fx), Math.round(H * b.fy), 14, 6);
    }

    // 掃描線：6 秒從上掃到下
    const y = BEZEL + ((t / 6000) % 1) * (H - BEZEL * 2);
    const g = ctx.createLinearGradient(0, y - 40, 0, y);
    g.addColorStop(0, col(0));
    g.addColorStop(1, col(0.06));
    ctx.fillStyle = g;
    ctx.fillRect(BEZEL, y - 40, W - BEZEL * 2, 40);
    ctx.restore();
  }
}
