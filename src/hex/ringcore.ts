/**
 * HEX 核心：細線、多層、各自旋轉的同心圓環（參考使用者 Pinterest 上的藍色 HUD 介面）。
 * 中心是一個小六角形＋「HEX」字樣當標誌。
 *
 * power 0~1：圓環由外往內一層一層亮起來（主控台展開、喚醒時用）；1 = 全部亮。
 * 為了效能，發光（shadowBlur）只用在少數幾筆上。
 */
import { ACCENT, hexColor } from './theme';

const TAU = Math.PI * 2;
const MONO = "'Consolas', 'Courier New', monospace";

/** 每一層什麼時候開始亮（power 的比例） */
const LAYER_AT = [0, 0.12, 0.24, 0.36, 0.5, 0.64, 0.78];

function layerAlpha(power: number, i: number) {
  return Math.max(0, Math.min(1, (power - LAYER_AT[i]) / 0.14));
}

export function drawRingCore(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, power = 1) {
  const rgb = hexColor.rgb;
  const col = (a: number) => `rgba(${rgb}, ${a})`;
  ctx.save();
  ctx.lineCap = 'butt';

  // 0. 底光
  const glowA = 0.35 * layerAlpha(power, 0);
  if (glowA > 0) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.15);
    g.addColorStop(0, col(glowA * 0.55));
    g.addColorStop(0.45, col(glowA * 0.18));
    g.addColorStop(1, col(0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.15, 0, TAU);
    ctx.fill();
  }

  // 1. 最外圈：細圓＋刻度（慢慢轉），上面一小段橘色記號
  let a = layerAlpha(power, 0);
  if (a > 0) {
    const rot = t * 0.00004;
    ctx.strokeStyle = col(0.55 * a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 120; i++) {
      const ang = rot + (i / 120) * TAU;
      const long = i % 10 === 0;
      const r1 = R * (long ? 0.95 : 0.975);
      ctx.strokeStyle = col((long ? 0.8 : 0.35) * a);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${ACCENT}, ${0.9 * a})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.03, rot + 0.3, rot + 0.42);
    ctx.stroke();
  }

  // 2. 分段弧（反方向轉，6 段）
  a = layerAlpha(power, 1);
  if (a > 0) {
    const rot = -t * 0.00018;
    ctx.strokeStyle = col(0.75 * a);
    ctx.lineWidth = R * 0.035;
    for (let i = 0; i < 6; i++) {
      const s = rot + (i / 6) * TAU;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.87, s, s + TAU / 6 - 0.16);
      ctx.stroke();
    }
  }

  // 3. 虛線細圓
  a = layerAlpha(power, 2);
  if (a > 0) {
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.lineDashOffset = -t * 0.01;
    ctx.strokeStyle = col(0.6 * a);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.77, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // 4. 發光的粗弧（3 段，順時針轉）
  a = layerAlpha(power, 3);
  if (a > 0) {
    const rot = t * 0.0005;
    ctx.save();
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = col(0.95 * a);
    ctx.lineWidth = R * 0.06;
    for (let i = 0; i < 3; i++) {
      const s = rot + (i / 3) * TAU;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.66, s, s + 1.4);
      ctx.stroke();
    }
    ctx.restore();
    // 粗弧兩側的細線
    ctx.strokeStyle = col(0.35 * a);
    ctx.lineWidth = 1;
    for (const m of [0.615, 0.705]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * m, 0, TAU);
      ctx.stroke();
    }
  }

  // 5. 內圈細刻度（反方向）
  a = layerAlpha(power, 4);
  if (a > 0) {
    const rot = -t * 0.0003;
    ctx.strokeStyle = col(0.7 * a);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 48; i++) {
      const ang = rot + (i / 48) * TAU;
      const r1 = R * (i % 4 === 0 ? 0.43 : 0.47);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * R * 0.52, cy + Math.sin(ang) * R * 0.52);
      ctx.stroke();
    }
  }

  // 6. 中心光：亮白藍的圓，呼吸
  a = layerAlpha(power, 5);
  if (a > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 420);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.4);
    g.addColorStop(0, `rgba(235, 248, 255, ${(0.75 + 0.2 * pulse) * a})`);
    g.addColorStop(0.35, col(0.55 * a));
    g.addColorStop(1, col(0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col(0.9 * a);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.34, 0, TAU);
    ctx.stroke();
  }

  // 7. 標誌：小六角形＋HEX
  a = layerAlpha(power, 6);
  if (a > 0) {
    const r = R * 0.24;
    ctx.save();
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 10;
    ctx.fillStyle = hexColor.dark;
    ctx.strokeStyle = `rgba(225, 245, 255, ${0.95 * a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i + Math.PI / 6;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = a;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(235, 248, 255, 0.95)';
    ctx.font = `800 ${Math.max(9, Math.round(R * 0.13))}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HEX', cx, cy + R * 0.005);
    ctx.restore();
  }
  ctx.restore();
}
