/**
 * 把 MediaPipe 的正規化座標（0~1，對應原始鏡頭影像）換成螢幕像素座標。
 * 處理兩件事：
 *  1. video 用 object-fit: cover，直式螢幕上影像左右會被裁掉
 *  2. 畫面左右鏡像（transform: scaleX(-1)）
 */
export interface Viewport {
  screenW: number;
  screenH: number;
  videoW: number;
  videoH: number;
}

export function toScreen(vp: Viewport, nx: number, ny: number): { x: number; y: number } {
  const scale = Math.max(vp.screenW / vp.videoW, vp.screenH / vp.videoH);
  const dispW = vp.videoW * scale;
  const dispH = vp.videoH * scale;
  const offX = (vp.screenW - dispW) / 2;
  const offY = (vp.screenH - dispH) / 2;
  return {
    x: offX + (1 - nx) * dispW, // 鏡像
    y: offY + ny * dispH,
  };
}
