import '../style.css';
import { startCamera, CameraError } from './camera';
import { createTracker, type Tracker } from './tracker';
import type { Viewport } from './coords';
import { drawHand } from '../hud/skeleton';
import { drawCursor, addClickMark } from '../hud/cursor';
import { GestureTracker } from './gestures';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { BUILD_ID, ensureLatest } from '../version';

document.getElementById('ver')!.textContent = BUILD_ID;
ensureLatest();

const video = document.getElementById('cam') as HTMLVideoElement;
const canvas = document.getElementById('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const startScreen = document.getElementById('start')!;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const errorEl = document.getElementById('error')!;
const clockEl = document.getElementById('clock')!;
const fpsEl = document.getElementById('fps')!;
const handsEl = document.getElementById('hands')!;
const stateEl = document.getElementById('state')!;
const gestureEl = document.getElementById('gesture')!;
const clicksEl = document.getElementById('clicks')!;

const vp: Viewport = { screenW: 1, screenH: 1, videoW: 640, videoH: 480 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  vp.screenW = window.innerWidth;
  vp.screenH = window.innerHeight;
  canvas.width = Math.round(vp.screenW * dpr);
  canvas.height = Math.round(vp.screenH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

// ---- 主迴圈 ----
let tracker: Tracker;
let lastVideoTime = -1;
let frames = 0;
let fpsWindowStart = performance.now();
let result: HandLandmarkerResult | null = null;
let clicks = 0;
const gestures = new GestureTracker();

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();

  // 鏡頭有新畫面才重新偵測；繪圖則每一幀都做（讓動畫順暢）
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    result = tracker.detect(video, now);
    handsEl.textContent = `HANDS ${result.landmarks.length}`;

    // 用第一隻偵測到的手當游標手
    const g = gestures.update(vp, result.landmarks[0], now);
    if (g.pinchStart && g.clickPos) {
      clicks++;
      clicksEl.textContent = `CLICK ${clicks}`;
      addClickMark(g.clickPos.x, g.clickPos.y, now);
    }
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

  ctx.clearRect(0, 0, vp.screenW, vp.screenH);
  if (result) for (const hand of result.landmarks) drawHand(ctx, vp, hand);
  drawCursor(ctx, gestures.state, now);
}

// 點一下下方手勢列可以把點擊計數歸零，方便做 10 次測試
document.getElementById('gestureBar')!.addEventListener('click', () => {
  clicks = 0;
  clicksEl.textContent = 'CLICK 0';
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  errorEl.textContent = '';
  stateEl.textContent = 'BOOTING';
  try {
    // 模型下載與開鏡頭同時進行
    const trackerP = createTracker();
    const { width, height } = await startCamera(video);
    vp.videoW = width;
    vp.videoH = height;
    startScreen.classList.add('hidden');
    document.body.classList.add('online');

    stateEl.textContent = 'LOADING';
    tracker = await trackerP;
    stateEl.textContent = `ONLINE·${tracker.delegate}`;
    requestAnimationFrame(loop);
  } catch (e) {
    startScreen.classList.remove('hidden');
    errorEl.textContent = e instanceof CameraError ? e.message : `手部模型載入失敗：${String(e)}`;
    stateEl.textContent = 'ERROR';
    startBtn.disabled = false;
  }
});
