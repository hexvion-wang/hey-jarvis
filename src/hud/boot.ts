import { theme } from './theme';

export const BOOT_MS = 2200;
const TITLE = 'J.A.R.V.I.S.';

/** 開機動畫：圓環由中心擴散、刻度旋轉、標題逐字出現。回傳 0~1 的進度。 */
export function drawBoot(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, start: number): number {
  const k = Math.min(1, (t - start) / BOOT_MS);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.26;
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  ctx.save();
  ctx.shadowColor = theme.main;
  ctx.shadowBlur = 18;

  // 三道擴散環
  for (let i = 0; i < 3; i++) {
    const kk = ease(k * 1.6 - i * 0.18);
    if (kk <= 0) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.3 + kk * (0.7 + i * 0.12)), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${theme.mainRgb}, ${0.8 * (1 - kk * 0.6)})`;
    ctx.lineWidth = 3 - i;
    ctx.stroke();
  }

  // 外圈刻度（60 格，逐漸點亮）
  const lit = Math.floor(ease(k * 1.3) * 60);
  const rot = t / 1500;
  for (let i = 0; i < 60; i++) {
    const a = rot + (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    const r1 = R * 1.08;
    const r2 = R * (long ? 1.18 : 1.13);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.strokeStyle = i < lit ? (long ? theme.gold : theme.main) : `rgba(${theme.mainRgb}, 0.12)`;
    ctx.lineWidth = long ? 3 : 1.5;
    ctx.stroke();
  }

  // 標題逐字出現
  const chars = Math.floor(ease((k - 0.25) / 0.5) * TITLE.length);
  ctx.fillStyle = theme.main;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(R * 0.22)}px ui-monospace, 'SF Mono', Consolas, monospace`;
  ctx.fillText(TITLE.slice(0, chars), cx, cy);

  if (k > 0.75) {
    ctx.globalAlpha = ease((k - 0.75) / 0.25);
    ctx.fillStyle = theme.gold;
    ctx.shadowColor = theme.gold;
    ctx.font = `${Math.round(R * 0.09)}px ui-monospace, 'SF Mono', Consolas, monospace`;
    ctx.fillText('SYSTEMS ONLINE', cx, cy + R * 0.25);
  }
  ctx.restore();
  return k;
}
