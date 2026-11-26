import { theme } from './theme';

/**
 * 背景裝飾：畫面中央的旋轉圓環（類似方舟反應爐）
 * @param power 0~1，待機時暗、喚醒後亮
 * @param size  圓環基準半徑相對短邊的比例
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  power = 1,
  size = 0.1,
) {
  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) * size;
  const speedMul = 0.4 + power * 0.6;

  ctx.save();
  ctx.strokeStyle = `rgba(${theme.mainRgb}, ${0.15 + power * 0.35})`;
  ctx.shadowColor = theme.main;
  ctx.shadowBlur = 4 + power * 10;

  const arcs: [number, number, number, number][] = [
    // 半徑倍率、轉速、弧段數、線寬
    [1.0, 0.0006, 3, 2],
    [1.35, -0.0004, 5, 1.5],
    [1.7, 0.00025, 2, 3],
  ];
  for (const [rMul, speed, segs, lw] of arcs) {
    const r = base * rMul;
    ctx.lineWidth = lw;
    for (let i = 0; i < segs; i++) {
      const a0 = t * speed * speedMul + (i * Math.PI * 2) / segs;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + ((Math.PI * 2) / segs) * 0.6);
      ctx.stroke();
    }
  }

  // 中心脈動
  const pulse = 0.5 + 0.5 * Math.sin(t / (power > 0.5 ? 300 : 900));
  ctx.beginPath();
  ctx.arc(cx, cy, base * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${theme.mainRgb}, ${(0.08 + pulse * 0.12) * (0.4 + power)})`;
  ctx.fill();
  ctx.restore();
}
