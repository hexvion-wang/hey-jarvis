import '../style.css';
import { startCamera, CameraError } from './camera';
import { createTracker, type Tracker } from './tracker';
import type { Viewport } from './coords';
import { drawHand } from '../hud/skeleton';

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

function loop() {
  requestAnimationFrame(loop);

  // 鏡頭沒有新畫面就不重新偵測
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = tracker.detect(video, now);

  ctx.clearRect(0, 0, vp.screenW, vp.screenH);
  for (const hand of result.landmarks) drawHand(ctx, vp, hand);
  handsEl.textContent = `HANDS ${result.landmarks.length}`;

  frames++;
  if (now - fpsWindowStart >= 1000) {
    const fps = Math.round((frames * 1000) / (now - fpsWindowStart));
    fpsEl.textContent = `FPS ${fps}`;
    fpsEl.classList.toggle('low', fps < 20);
    frames = 0;
    fpsWindowStart = now;
  }
}

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
