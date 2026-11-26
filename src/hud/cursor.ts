import type { GestureState } from '../phone/gestures';
import { theme } from './theme';

/** 畫游標準星：一般狀態主色空心，捏住時金色縮小實心 */
export function drawCursor(ctx: CanvasRenderingContext2D, g: GestureState, t: number) {
  if (!g.hasHand) return;
  const { x, y } = g.cursor;
  const color = g.pinching ? theme.gold : theme.main;
  const r = g.pinching ? 14 : 22;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + t / 600;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
    ctx.lineTo(x + Math.cos(a) * (r + 12), y + Math.sin(a) * (r + 12));
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, g.pinching ? 8 : 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
