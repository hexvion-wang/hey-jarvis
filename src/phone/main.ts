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
import { drawBoot, BOOT_MS } from '../hud/boot';
import { PhoneLink } from '../shared/link';

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
    resetPending = true; // 在 press() 結束時歸零，這次點擊本身不算
  }),
];
let resetPending = false;

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

// 最近一次游標停在哪個按鈕上（按鈕發亮）
let lastHover: { b: HudButton; t: number } | null = null;
const HOVER_GRACE_MS = 400;

/**
 * 點擊判定。手勢點擊時（fromGesture）捏的動作會讓游標往下飄，
 * 所以只要捏下前 0.4 秒內游標停過某個按鈕，就算點到它。
 */
function press(x: number, y: number, t: number, fromGesture = false) {
  attempts++;
  let b = hitTest(buttons, x, y);
  if (!b && fromGesture && lastHover && t - lastHover.t <= HOVER_GRACE_MS) b = lastHover.b;

  // 中間的核心圓環：叫醒電腦上的 Jarvis
  const coreR = Math.min(vp.screenW, vp.screenH) * 0.17;
  if (!b && Math.hypot(x - vp.screenW / 2, y - vp.screenH / 2) <= coreR) {
    hits++;
    addRipple(vp.screenW / 2, vp.screenH / 2, t, true);
    if (link.connected) {
      link.send({ type: 'core' });
      showBanner('已呼叫電腦上的 Jarvis');
    } else {
      showBanner('還沒連上電腦：在電腦輸入配對碼 ' + link.display);
    }
  } else if (b) {
    hits++;
    b.pressT = t;
    b.onPress(t);
    addRipple(b.x, b.y, t, true);
  } else {
    addRipple(x, y, t, false);
  }
  if (resetPending) {
    resetPending = false;
    hits = 0;
    attempts = 0;
  }
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
    if (controller()) {
      // 控制器模式：手的位置和捏的動作傳給電腦，手機自己不處理點擊
      link.send({ type: 'hand', ok: g.hasHand, x: g.raw.x, y: g.raw.y, open: g.open, pose: g.pose });
      if (g.pinchStart) link.send({ type: 'pinch', down: true });
      if (g.pinchEnd) link.send({ type: 'pinch', down: false });
    } else if (g.pinchStart && g.clickPos) {
      press(g.clickPos.x, g.clickPos.y, now, true);
    }
    gestureEl.textContent = g.hasHand ? `${g.pinching ? 'PINCH' : g.pose.toUpperCase()} ${g.ratio.toFixed(2)}` : 'NO HAND';
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
  document.body.classList.toggle('controller', controller());
  if (controller()) {
    // 控制器模式：只畫手的骨架，畫面保持乾淨
    if (result) for (const hand of result.landmarks) drawHand(ctx, vp, hand);
    drawEffects(ctx, vp.screenW, vp.screenH, now);
    return;
  }
  drawBackdrop(ctx, vp.screenW, vp.screenH, now);
  const hovered = drawButtons(ctx, buttons, g.hasHand ? g.cursor : null, dt, now);
  // 只記錄「還沒捏」時停留的按鈕，捏住後游標飄走不影響判定
  if (hovered && !g.pinching) lastHover = { b: hovered, t: now };
  if (showSkeleton && result) for (const hand of result.landmarks) drawHand(ctx, vp, hand);
  drawEffects(ctx, vp.screenW, vp.screenH, now);
  // 電腦被叫醒時，手機也播一次開機動畫
  if (bootStart >= 0 && now - bootStart < BOOT_MS + 800) drawBoot(ctx, vp.screenW, vp.screenH, now, bootStart);
  drawCursor(ctx, g, now);
}

// ---- 跟電腦連線 ----
let bootStart = -1;
/** 連上電腦時，手機變成手勢控制器 */
const controller = () => link.connected;
const linkEl = $('link');
const bannerEl = $('banner');
let bannerTimer = 0;

function showBanner(text: string, ms = 4000) {
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), ms);
}

const link = new PhoneLink({
  onState(state, detail) {
    linkEl.classList.toggle('on', state === 'connected');
    linkEl.textContent =
      state === 'connected'
        ? `LINK ✓ 已連上電腦`
        : state === 'error'
          ? `LINK ✗ ${detail ?? ''}`
          : `配對碼 ${link.display} · 在電腦輸入`;
    if (state === 'connected') showBanner('已連上電腦 · 控制器模式');
  },
  onMessage(msg) {
    if (msg.type === 'wake') {
      bootStart = performance.now();
      showBanner(msg.text ? `電腦聽到：「${msg.text}」` : 'J.A.R.V.I.S. ONLINE');
    } else if (msg.type === 'standby') {
      showBanner('STANDBY · 回到待命', 2500);
    } else if (msg.type === 'video') {
      // 電腦開啟 AR 背景：把鏡頭畫面傳過去（同一路鏡頭，手勢辨識照常進行）
      const stream = video.srcObject as MediaStream | null;
      if (msg.on && stream) {
        link.startVideo(stream);
        showBanner('AR 鏡頭畫面傳送中', 2500);
      } else {
        link.stopVideo();
        if (!msg.on) showBanner('AR 鏡頭已關閉', 2000);
      }
    } else if (msg.type === 'status') {
      showBanner(msg.sub ? `${msg.headline}\n${msg.sub}` : msg.headline, 6000);
    }
  },
});

function goOnline() {
  startScreen.classList.add('hidden');
  document.body.classList.add('online');
  updateScore();
  link.start();
  requestAnimationFrame(loop);
}

// 直接用手指點按鈕也有效（方便比較、或在電腦上測試）
window.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('online') || controller()) return;
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
