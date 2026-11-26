import '../style.css';
import { VoiceListener, voiceSupported, type MicState } from './voice';
import { speak, voiceName } from '../shared/speak';
import { drawBackdrop } from '../hud/renderer';
import { drawBoot, BOOT_MS } from '../hud/boot';
import { BUILD_ID, ensureLatest } from '../version';

document.getElementById('ver')!.textContent = BUILD_ID;
ensureLatest();

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const startScreen = $('start');
const startBtn = $('startBtn') as HTMLButtonElement;
const errorEl = $('error');
const micEl = $('mic');
const voiceEl = $('voice');
const stateEl = $('state');
const headlineEl = $('headline');
const subEl = $('sub');
const transcriptEl = $('transcript');

const GREETING = '嘿，我在，有什麼需要幫忙的嗎？';
const AWAKE_MS = 15000; // 喚醒後沒動作多久回到待命

let W = 1;
let H = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

setInterval(() => ($('clock').textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false })), 1000);

// ---- 狀態 ----
type Mode = 'standby' | 'booting' | 'awake';
let mode: Mode = 'standby';
let bootStart = -1;
let awakeUntil = 0;
let power = 0.2;
let listener: VoiceListener | null = null;

function setMode(m: Mode) {
  mode = m;
  stateEl.textContent = m.toUpperCase();
  document.body.classList.toggle('awake', m !== 'standby');
  if (m === 'standby') {
    headlineEl.textContent = '待命中';
    subEl.textContent = '說「Hey Jarvis」叫醒我　·　按空白鍵可以模擬喚醒';
  }
}

async function wake(text: string) {
  const now = performance.now();
  if (mode === 'standby') {
    bootStart = now;
    setMode('booting');
  }
  awakeUntil = now + AWAKE_MS;
  headlineEl.textContent = GREETING;
  subEl.textContent = text ? `聽到：「${text}」` : '（模擬喚醒）';

  listener?.setMuted(true); // 自己講話時不要聽
  await speak(GREETING);
  listener?.setMuted(false);
  awakeUntil = performance.now() + AWAKE_MS;
  if (mode !== 'standby') subEl.textContent = '請說…（步驟 6 會加上指令）';
}

// ---- 繪圖迴圈 ----
function loop() {
  requestAnimationFrame(loop);
  const t = performance.now();

  if (mode === 'booting' && t - bootStart > BOOT_MS) setMode('awake');
  if (mode === 'awake' && t > awakeUntil) setMode('standby');

  const target = mode === 'standby' ? 0.2 : 1;
  power += (target - power) * 0.05;

  ctx.clearRect(0, 0, W, H);
  drawBackdrop(ctx, W, H, t, power, 0.17);
  if (mode === 'booting' || mode === 'awake') drawBoot(ctx, W, H, t, bootStart);
}
requestAnimationFrame(loop);

// ---- 麥克風狀態顯示 ----
function onMicState(s: MicState, detail?: string) {
  micEl.classList.toggle('on', s === 'listening');
  micEl.classList.toggle('err', s === 'error');
  micEl.textContent = s === 'listening' ? 'MIC ON' : s === 'error' ? 'MIC ERR' : 'MIC OFF';
  if (detail) transcriptEl.textContent = `⚠ ${detail}`;
}

// 空白鍵：模擬喚醒（不用講話也能測動畫和語音）
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && startScreen.classList.contains('hidden')) {
    e.preventDefault();
    wake('');
  }
});

startBtn.addEventListener('click', () => {
  errorEl.textContent = '';
  // 第一次使用者點擊時先講一句空話，解鎖瀏覽器的語音播放
  speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  voiceEl.textContent = `VOICE ${voiceName()}`;

  if (!voiceSupported()) {
    errorEl.textContent = '這個瀏覽器不支援語音辨識，請用電腦版 Chrome 開啟';
    return;
  }
  listener = new VoiceListener({
    onTranscript(text, isFinal) {
      transcriptEl.textContent = text;
      transcriptEl.classList.toggle('final', isFinal);
      if (mode !== 'standby') awakeUntil = performance.now() + AWAKE_MS;
    },
    onWake: (text) => wake(text),
    onState: onMicState,
  });
  listener.start();
  startScreen.classList.add('hidden');
  setMode('standby');
});

// 語音清單可能晚一點才載入
speechSynthesis.addEventListener('voiceschanged', () => (voiceEl.textContent = `VOICE ${voiceName()}`));
