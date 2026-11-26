import type { GestureState } from '../phone/gestures';

interface Mark { x: number; y: number; t: number }
const marks: Mark[] = [];
const MARK_MS = 500;

export function addClickMark(x: number, y: number, t: number) {
  marks.push({ x, y, t });
}

/** 畫游標準星：一般狀態青藍空心，捏住時金色縮小實心 */
export function drawCursor(ctx: CanvasRenderingContext2D, g: GestureState, t: number) {
  // 點擊標記（步驟 4 會換成正式的漣漪動畫）
  while (marks.length && t - marks[0].t > MARK_MS) marks.shift();
  for (const m of marks) {
    const k = (t - m.t) / MARK_MS;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 10 + k * 30, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 201, 64, ${1 - k})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  if (!g.hasHand) return;
  const { x, y } = g.cursor;
  const color = g.pinching ? '#ffc940' : '#00e5ff';
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

  // 四個刻度
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
