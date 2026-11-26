import '../style.css';
import { VoiceListener, voiceSupported, type MicState } from './voice';
import { speak, voiceName } from '../shared/speak';
import { drawBackdrop } from '../hud/renderer';
import { drawBoot, BOOT_MS } from '../hud/boot';
import { BUILD_ID, ensureLatest } from '../version';
import { getCustom, setCustom, phraseFromTraining } from './wake';

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
  if (m === 'standby' && !training) {
    headlineEl.textContent = '待命中';
    subEl.textContent = '說「嘿，海克斯」或「Hey Hex」叫醒我　·　空白鍵模擬喚醒　·　Esc 回到待命';
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
  if (mode !== 'standby') subEl.textContent = '請說…（說「待命」或按 Esc 回到待命）';
}

/** 回到待命：立刻停掉講到一半的話 */
const STANDBY_RE = /待命|沒事|没事|退下|休息|再見|掰掰|standby|dismiss/i;
function goStandby(reply = false) {
  if (mode === 'standby') return;
  speechSynthesis.cancel();
  listener?.setMuted(false);
  setMode('standby');
  if (reply) {
    listener?.setMuted(true);
    speak('好的。').then(() => listener?.setMuted(false));
  }
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

// ---- 最近聽到的句子 ----
const historyEl = $('history');
function addHistory(text: string, woke: boolean) {
  if (!text) return;
  const li = document.createElement('li');
  li.textContent = `${woke ? '✓' : '·'} ${text}`;
  li.classList.toggle('woke', woke);
  historyEl.prepend(li);
  while (historyEl.children.length > 8) historyEl.lastElementChild!.remove();
}

// ---- 訓練模式：記住你的喚醒詞被辨識成什麼字 ----
const TRAIN_COUNT = 5;
const trainBtn = $('trainBtn') as HTMLButtonElement;
const clearBtn = $('clearBtn') as HTMLButtonElement;
const learnedEl = $('learned');
let training: string[] | null = null;

function renderLearned() {
  const list = getCustom();
  learnedEl.textContent = list.length ? list.join('、') : '（還沒有）';
}
renderLearned();

function startTraining() {
  if (!listener) return;
  goStandby();
  training = [];
  listener.training = true;
  trainBtn.disabled = true;
  headlineEl.textContent = `訓練中：請說你的喚醒詞（例如「嘿，海克斯」）（1/${TRAIN_COUNT}）`;
  subEl.textContent = '每說完一次停一下，等下面出現文字再說下一次';
}

function onTrainFinal(text: string) {
  if (!training || !listener) return;
  const p = phraseFromTraining(text);
  if (!p) return;
  training.push(p);
  if (training.length < TRAIN_COUNT) {
    headlineEl.textContent = `訓練中：請說你的喚醒詞（例如「嘿，海克斯」）（${training.length + 1}/${TRAIN_COUNT}）`;
    subEl.textContent = `剛剛聽到：「${text}」`;
    return;
  }
  finishTraining('訓練完成！現在叫我試試看');
}

/** 結束訓練（完成或取消）；已經錄到的幾次都會保留 */
function finishTraining(message: string) {
  if (!training) return;
  if (training.length) setCustom([...getCustom(), ...training]);
  renderLearned();
  training = null;
  if (listener) listener.training = false;
  trainBtn.disabled = false;
  setMode('standby');
  subEl.textContent = message;
}

/** Esc / 回到待命按鈕：訓練中就取消訓練，醒著就回到待命 */
function escape() {
  if (training) {
    const n = training.length;
    finishTraining(n ? `已取消訓練，保留了剛剛的 ${n} 次` : '已取消訓練');
  } else {
    goStandby();
  }
}

trainBtn.addEventListener('click', startTraining);
clearBtn.addEventListener('click', () => {
  setCustom([]);
  renderLearned();
});

$('standbyBtn').addEventListener('click', () => escape());

// 空白鍵：模擬喚醒（不用講話也能測動畫和語音）；Esc：回到待命
window.addEventListener('keydown', (e) => {
  if (!startScreen.classList.contains('hidden')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    wake('');
  } else if (e.code === 'Escape') {
    escape();
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
    onFinal(text, woke) {
      if (training) return onTrainFinal(text);
      addHistory(text, woke);
      // 醒著的時候說「待命 / 沒事了 / 退下」就回到待命
      if (!woke && mode !== 'standby' && STANDBY_RE.test(text)) goStandby(true);
    },
    onState: onMicState,
  });
  listener.start();
  startScreen.classList.add('hidden');
  setMode('standby');
});

// 語音清單可能晚一點才載入
speechSynthesis.addEventListener('voiceschanged', () => (voiceEl.textContent = `VOICE ${voiceName()}`));
