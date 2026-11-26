import { theme } from './theme';

export interface HudButton {
  id: string;
  label: string;
  sub: string;
  /** 相對畫面中心的位置（以寬、高的比例表示） */
  ox: number;
  oy: number;
  active?: boolean;
  onPress: (t: number) => void;
  // 執行期計算
  x: number;
  y: number;
  r: number;
  hover: number;
  pressT: number;
}

export function makeButton(
  id: string,
  label: string,
  sub: string,
  ox: number,
  oy: number,
  onPress: (t: number) => void,
): HudButton {
  return { id, label, sub, ox, oy, onPress, x: 0, y: 0, r: 50, hover: 0, pressT: -1e9 };
}

export function layoutButtons(buttons: HudButton[], w: number, h: number) {
  const r = Math.max(38, Math.min(70, Math.min(w, h) * 0.13));
  for (const b of buttons) {
    b.x = w / 2 + b.ox * w;
    b.y = h / 2 + b.oy * h;
    b.r = r;
  }
}

/** 點擊判定半徑放大 15%，手勢比手指不精準 */
export function hitTest(buttons: HudButton[], x: number, y: number): HudButton | null {
  for (const b of buttons) {
    if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) return b;
  }
  return null;
}

export function drawButtons(
  ctx: CanvasRenderingContext2D,
  buttons: HudButton[],
  cursor: { x: number; y: number } | null,
  dtMs: number,
  t: number,
) {
  const hovered = cursor ? hitTest(buttons, cursor.x, cursor.y) : null;

  for (const b of buttons) {
    // hover 程度平滑漸變
    const target = b === hovered ? 1 : 0;
    b.hover += (target - b.hover) * Math.min(1, dtMs / 90);

    const press = Math.max(0, 1 - (t - b.pressT) / 300);
    const scale = 1 + b.hover * 0.08 - press * 0.1;
    const r = b.r * scale;
    const color = b.active ? theme.gold : theme.main;
    const rgb = b.active ? '255, 201, 64' : theme.mainRgb;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 + b.hover * 25 + press * 30;

    // 底色
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    g.addColorStop(0, `rgba(${rgb}, ${0.12 + b.hover * 0.25 + press * 0.3})`);
    g.addColorStop(1, `rgba(${rgb}, 0.03)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 外框
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + b.hover * 1.5;
    ctx.stroke();

    // hover 時外圈旋轉刻度
    if (b.hover > 0.05) {
      ctx.globalAlpha = b.hover;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = t / 500 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 8, a, a + 0.8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 文字
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(r * 0.3)}px ui-monospace, 'SF Mono', Menlo, monospace`;
    ctx.fillText(b.label, b.x, b.y - r * 0.08);
    ctx.font = `${Math.round(r * 0.2)}px 'PingFang TC', system-ui, sans-serif`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(b.sub, b.x, b.y + r * 0.3);
    ctx.restore();
  }
  return hovered;
}
