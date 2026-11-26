import { theme } from './theme';

interface Ripple { x: number; y: number; t: number; hit: boolean }
const ripples: Ripple[] = [];
const RIPPLE_MS = 650;

let scanStart = -1;
const SCAN_MS = 1400;

export function addRipple(x: number, y: number, t: number, hit: boolean) {
  ripples.push({ x, y, t, hit });
}

export function startScan(t: number) {
  scanStart = t;
}

export function drawEffects(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // 點擊漣漪：命中是金色雙圈，沒點到是暗紅單圈
  while (ripples.length && t - ripples[0].t > RIPPLE_MS) ripples.shift();
  for (const r of ripples) {
    const k = (t - r.t) / RIPPLE_MS;
    const ease = 1 - Math.pow(1 - k, 3);
    ctx.save();
    ctx.shadowBlur = 16;
    if (r.hit) {
      ctx.shadowColor = theme.gold;
      for (const [delay, size] of [[0, 70], [0.15, 45]] as const) {
        const kk = Math.max(0, (k - delay) / (1 - delay));
        const e = 1 - Math.pow(1 - kk, 3);
        ctx.beginPath();
        ctx.arc(r.x, r.y, 12 + e * size, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 201, 64, ${1 - kk})`;
        ctx.lineWidth = 4 * (1 - kk) + 1;
        ctx.stroke();
      }
    } else {
      ctx.shadowColor = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + ease * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 59, 59, ${0.8 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 掃描線：由上往下掃過整個畫面
  if (scanStart >= 0) {
    const k = (t - scanStart) / SCAN_MS;
    if (k > 1) {
      scanStart = -1;
    } else {
      const y = k * h;
      const grad = ctx.createLinearGradient(0, y - 80, 0, y);
      grad.addColorStop(0, `rgba(${theme.mainRgb}, 0)`);
      grad.addColorStop(1, `rgba(${theme.mainRgb}, 0.35)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 80, w, 80);
      ctx.save();
      ctx.shadowColor = theme.main;
      ctx.shadowBlur = 20;
      ctx.fillStyle = theme.main;
      ctx.fillRect(0, y - 2, w, 3);
      ctx.restore();
    }
  }
}
