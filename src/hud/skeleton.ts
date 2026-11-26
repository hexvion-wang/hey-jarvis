import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { HAND_CONNECTIONS } from '../phone/tracker';
import { toScreen, type Viewport } from '../phone/coords';

const FINGER_TIPS = new Set([4, 8, 12, 16, 20]);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 畫一隻手的 21 個關節點與骨架線；粗細跟著手在畫面上的大小縮放 */
export function drawHand(ctx: CanvasRenderingContext2D, vp: Viewport, hand: NormalizedLandmark[]) {
  const pts = hand.map((p) => toScreen(vp, p.x, p.y));

  // 掌寬：手腕(0) 到中指根(9) 的螢幕距離
  const palm = Math.hypot(pts[9].x - pts[0].x, pts[9].y - pts[0].y);
  const line = clamp(palm * 0.05, 3, 10);
  const joint = clamp(palm * 0.055, 4, 12);
  const tip = clamp(palm * 0.09, 7, 20);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 14;

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.75)';
  ctx.lineWidth = line;
  ctx.beginPath();
  for (const { start, end } of HAND_CONNECTIONS) {
    ctx.moveTo(pts[start].x, pts[start].y);
    ctx.lineTo(pts[end].x, pts[end].y);
  }
  ctx.stroke();

  pts.forEach((p, i) => {
    const isTip = FINGER_TIPS.has(i);
    const color = isTip ? '#ffc940' : '#00e5ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, isTip ? tip : joint, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.fill();
    if (isTip) {
      // 指尖外圈光環
      ctx.beginPath();
      ctx.arc(p.x, p.y, tip * 1.7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 201, 64, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  ctx.restore();
}
