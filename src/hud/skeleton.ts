import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { HAND_CONNECTIONS } from '../phone/tracker';
import { toScreen, type Viewport } from '../phone/coords';

const FINGER_TIPS = new Set([4, 8, 12, 16, 20]);

/** 畫一隻手的 21 個關節點與骨架線 */
export function drawHand(ctx: CanvasRenderingContext2D, vp: Viewport, hand: NormalizedLandmark[]) {
  const pts = hand.map((p) => toScreen(vp, p.x, p.y));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 10;

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const { start, end } of HAND_CONNECTIONS) {
    ctx.moveTo(pts[start].x, pts[start].y);
    ctx.lineTo(pts[end].x, pts[end].y);
  }
  ctx.stroke();

  pts.forEach((p, i) => {
    const tip = FINGER_TIPS.has(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, tip ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = tip ? '#ffc940' : '#00e5ff';
    ctx.shadowColor = tip ? '#ffc940' : '#00e5ff';
    ctx.fill();
  });
  ctx.restore();
}
