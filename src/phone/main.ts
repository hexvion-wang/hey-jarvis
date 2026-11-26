import '../style.css';
import { startCamera, CameraError } from './camera';
import { createTracker, type Tracker } from './tracker';
import type { Viewport } from './coords';
import { GestureTracker } from './gestures';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { drawHand } from '../hud/skeleton';
import { drawCursor } from '../hud/cursor';
import { drawBackdrop } from '../hud/renderer';
import { addRipple, drawEffects, startScan } from '../hud/effects';
import { makeButton, layoutButtons, hitTest, drawButtons, type HudButton } from '../hud/buttons';
import { theme } from '../hud/theme';
import { BUILD_ID, ensureLatest } from '../version';

document.getElementById('ver')!.textContent = BUILD_ID;
ensureLatest();

const $ = (id: string) => document.getElementById(id)!;
const video = $('cam') as HTMLVideoElement;
const canvas = $('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const startScreen = $('start');
const startBtn = $('startBtn') as HTMLButtonElement;
const errorEl = $('error');
const clockEl = $('clock');
const fpsEl = $('fps');
const handsEl = $('hands');
const stateEl = $('state');
const gestureEl = $('gesture');
const clicksEl = $('clicks');

const vp: Viewport = { screenW: 1, screenH: 1, videoW: 640, videoH: 480 };

// ---- HUD 按鈕 ----
let showSkeleton = true;
const buttons: HudButton[] = [
  makeButton('scan', 'SCAN', '掃描', -0.24, -0.2, (t) => startScan(t)),
  makeButton('skel', 'SKEL', '骨架', 0.24, -0.2, () => {
    showSkeleton = !showSkeleton;
    buttons[1].active = !showSkeleton;
  }),
  makeButton('alert', 'ALERT', '警戒', -0.24, 0.2, () => {
    theme.alert = !theme.alert;
    buttons[2].active = theme.alert;
    document.body.classList.toggle('alert', theme.alert);
  }),
  makeButton('reset', 'RESET', '重設計數', 0.24, 0.2, () => {
    hits = 0;
    attempts = -1; // 這次點擊本身不算
  }),
];

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  vp.screenW = window.innerWidth;
  vp.screenH = window.innerHeight;
  canvas.width = Math.round(vp.screenW * dpr);
  canvas.height = Math.round(vp.screenH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutButtons(buttons, vp.screenW, vp.screenH);
}
window.addEventListener('resize', resize);
resize();

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

// ---- 點擊與命中率 ----
let hits = 0;
let attempts = 0;

function updateScore() {
  clicksEl.textContent = `HIT ${hits}/${attempts}`;
}

function press(x: number, y: number, t: number) {
  attempts++;
  const b = hitTest(buttons, x, y);
  if (b) {
    hits++;
    b.pressT = t;
    b.onPress(t);
  }
  addRipple(x, y, t, !!b);
  updateScore();
}

// ---- 主迴圈 ----
let tracker: Tracker | null = null;
let lastVideoTime = -1;
let frames = 0;
let fpsWindowStart = performance.now();
let lastDraw = performance.now();
let result: HandLandmarkerResult | null = null;
const gestures = new GestureTracker();

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = now - lastDraw;
  lastDraw = now;

  // 鏡頭有新畫面才重新偵測；繪圖則每一幀都做（讓動畫順暢）
  if (tracker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    result = tracker.detect(video, now);
    handsEl.textContent = `HANDS ${result.landmarks.length}`;

    const g = gestures.update(vp, result.landmarks[0], now);
    if (g.pinchStart && g.clickPos) press(g.clickPos.x, g.clickPos.y, now);
    gestureEl.textContent = g.hasHand ? `${g.pinching ? 'PINCH' : 'POINT'} ${g.ratio.toFixed(2)}` : 'NO HAND';
    gestureEl.classList.toggle('pinch', g.pinching);

    frames++;
    if (now - fpsWindowStart >= 1000) {
      const fps = Math.round((frames * 1000) / (now - fpsWindowStart));
      fpsEl.textContent = `FPS ${fps}`;
      fpsEl.classList.toggle('low', fps < 20);
      frames = 0;
      fpsWindowStart = now;
    }
  }

  const g = gestures.state;
  ctx.clearRect(0, 0, vp.screenW, vp.screenH);
  drawBackdrop(ctx, vp.screenW, vp.screenH, now);
  drawButtons(ctx, buttons, g.hasHand ? g.cursor : null, dt, now);
  if (showSkeleton && result) for (const hand of result.landmarks) drawHand(ctx, vp, hand);
  drawEffects(ctx, vp.screenW, vp.screenH, now);
  drawCursor(ctx, g, now);
}

function goOnline() {
  startScreen.classList.add('hidden');
  document.body.classList.add('online');
  updateScore();
  requestAnimationFrame(loop);
}

// 直接用手指點按鈕也有效（方便比較、或在電腦上測試）
window.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('online')) return;
  if ((e.target as HTMLElement).closest('#gestureBar, #status')) return;
  press(e.clientX, e.clientY, performance.now());
});

// 點一下下方手勢列把命中率歸零
$('gestureBar').addEventListener('click', () => {
  hits = 0;
  attempts = 0;
  updateScore();
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  errorEl.textContent = '';
  stateEl.textContent = 'BOOTING';

  // ?demo：不開鏡頭，只看 HUD（電腦上預覽用）
  if (new URLSearchParams(location.search).has('demo')) {
    stateEl.textContent = 'DEMO';
    goOnline();
    return;
  }

  try {
    // 模型下載與開鏡頭同時進行
    const trackerP = createTracker();
    const { width, height } = await startCamera(video);
    vp.videoW = width;
    vp.videoH = height;
    goOnline();

    stateEl.textContent = 'LOADING';
    tracker = await trackerP;
    stateEl.textContent = `ONLINE·${tracker.delegate}`;
  } catch (e) {
    startScreen.classList.remove('hidden');
    document.body.classList.remove('online');
    errorEl.textContent = e instanceof CameraError ? e.message : `手部模型載入失敗：${String(e)}`;
    stateEl.textContent = 'ERROR';
    startBtn.disabled = false;
  }
});
