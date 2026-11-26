import '../style.css';
import { VoiceListener, voiceSupported, type MicState } from './voice';
import { speak, voiceName } from '../shared/speak';
import { drawBackdrop } from '../hud/renderer';
import { drawBoot, BOOT_MS } from '../hud/boot';
import { BUILD_ID, ensureLatest } from '../version';
import { getCustom, setCustom, phraseFromTraining } from './wake';
import { parseCommand, type Command } from './commands';
import { DeskLink } from '../shared/link';

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

// ---- 跟 iPhone 連線 ----
const linkCodeEl = $('linkCode') as HTMLInputElement;
const linkStateEl = $('linkState');
const link = new DeskLink({
  onState(state, detail) {
    linkStateEl.className = state;
    linkStateEl.textContent =
      state === 'connected' ? '✓ 已連上 iPhone' : state === 'connecting' ? detail ?? '連線中…' : state === 'error' ? `✗ ${detail}` : '未連線';
  },
  onMessage(msg) {
    // 手機上捏了中間的核心 → 叫醒
    if (msg.type === 'core' && !training) {
      wakeVisual('（iPhone 呼叫）');
      greet();
    }
  },
});
linkCodeEl.value = DeskLink.savedCode();
$('linkBtn').addEventListener('click', () => link.connect(linkCodeEl.value));
linkCodeEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') link.connect(linkCodeEl.value);
});

// ---- 狀態 ----
type Mode = 'standby' | 'booting' | 'awake';
let mode: Mode = 'standby';
let bootStart = -1;
let awakeUntil = 0;
let power = 0.2;
let listener: VoiceListener | null = null;

function setMode(m: Mode) {
  if (m === 'standby' && mode !== 'standby') link.send({ type: 'standby' });
  mode = m;
  stateEl.textContent = m.toUpperCase();
  document.body.classList.toggle('awake', m !== 'standby');
  if (m === 'standby' && !training) {
    headlineEl.textContent = '待命中';
    subEl.textContent = '說「嘿，海克斯」或「Hey Hex」叫醒我　·　空白鍵模擬喚醒　·　Esc 回到待命';
  }
}

/** 講話（講話時暫停聆聽，避免聽到自己的聲音） */
async function say(text: string) {
  // 同步畫面上的訊息到手機
  link.send({ type: 'status', headline: headlineEl.textContent ?? '', sub: subEl.textContent ?? '' });
  listener?.setMuted(true);
  await speak(text);
  listener?.setMuted(false);
  awakeUntil = performance.now() + AWAKE_MS;
}

/** 喚醒的畫面部分：開機動畫（還不講話，等這句話說完看看有沒有指令） */
function wakeVisual(text: string) {
  const now = performance.now();
  if (mode === 'standby') {
    bootStart = now;
    setMode('booting');
    link.send({ type: 'wake', text });
  }
  awakeUntil = now + AWAKE_MS;
  headlineEl.textContent = '我在聽…';
  subEl.textContent = text ? `聽到：「${text}」` : '（模擬喚醒）';
}

let greetTimer = 0;
async function greet() {
  clearTimeout(greetTimer);
  headlineEl.textContent = GREETING;
  await say(GREETING);
  if (mode !== 'standby') subEl.textContent = '例如：「打開今天的日報」「打開看好清單」　·　說「待命」或按 Esc 回到待命';
}

// ---- 指令 ----
const viaAgent = location.port === '4000';

async function api(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis': '1' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const md = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${m} 月 ${day} 日`;
};

async function runCommand(cmd: Command) {
  clearTimeout(greetTimer);
  speechSynthesis.cancel();
  if (cmd.kind === 'standby') return goStandby(true);

  if (!viaAgent) {
    headlineEl.textContent = '這個功能要從本機 agent 開啟';
    subEl.textContent = '在專案資料夾執行 npm run agent，然後打開 http://localhost:4000';
    return say('開檔案要先啟動本機程式喔。');
  }

  try {
    if (cmd.kind === 'daily') {
      headlineEl.textContent = `正在打開${cmd.label}的日報…`;
      const r = await api('/api/daily', { offset: cmd.offset });
      if (!r.ok) {
        headlineEl.textContent = '找不到日報';
        return say(`找不到${cmd.label}以前的日報。`);
      }
      headlineEl.textContent = `已開啟：${r.rel}`;
      subEl.textContent = 'Obsidian 已經打開這份日報';
      return say(r.fallback ? `${cmd.label}的日報還沒有，幫你打開最新的 ${md(r.date)}。` : `好的，打開 ${md(r.date)} 的日報。`);
    }
    if (cmd.kind === 'open') {
      headlineEl.textContent = `正在搜尋「${cmd.query}」…`;
      const r = await api('/api/open', { query: cmd.query });
      if (!r.ok) {
        headlineEl.textContent = `找不到「${cmd.query}」`;
        return say(`我找不到${cmd.query}。`);
      }
      headlineEl.textContent = `已開啟：${r.rel}`;
      subEl.textContent = `搜尋「${cmd.query}」`;
      const name = r.rel.split('/').pop().replace(/\.md$/, '');
      return say(`好的，打開${name}。`);
    }
  } catch (e) {
    headlineEl.textContent = '本機 agent 沒有回應';
    subEl.textContent = String(e);
    return say('本機程式好像沒有在跑。');
  }
}

/** 回到待命：立刻停掉講到一半的話 */
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

// 打字下指令（語音不準時的備案）
const typeCmd = $('typeCmd') as HTMLInputElement;
typeCmd.addEventListener('keydown', (e) => {
  e.stopPropagation(); // 打字時空白鍵不要觸發模擬喚醒
  if (e.key === 'Escape') return typeCmd.blur();
  if (e.key !== 'Enter' || !typeCmd.value.trim()) return;
  const text = typeCmd.value.trim();
  typeCmd.value = '';
  addHistory(`⌨ ${text}`, false);
  const cmd = parseCommand(text);
  if (mode === 'standby') wakeVisual(text);
  if (cmd) runCommand(cmd);
  else {
    headlineEl.textContent = `聽不懂：「${text}」`;
    subEl.textContent = '例如：「打開今天的日報」「昨天的日報」「打開看好清單」';
  }
});

// 空白鍵：模擬喚醒（不用講話也能測動畫和語音）；Esc：回到待命
window.addEventListener('keydown', (e) => {
  if (!startScreen.classList.contains('hidden')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    wakeVisual('');
    greet();
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
    onWake(text) {
      wakeVisual(text);
      // 正常會在這句話說完（onFinal）時決定要執行指令還是打招呼；保險起見 3 秒後還沒結果就先打招呼
      clearTimeout(greetTimer);
      greetTimer = window.setTimeout(greet, 3000);
    },
    onFinal(text, woke) {
      if (training) return onTrainFinal(text);
      addHistory(text, woke);
      if (mode === 'standby' && !woke) return;
      // 同一句話裡有指令（例如「嘿海克斯，打開今天的日報」）就直接執行，否則打招呼
      const cmd = parseCommand(text);
      if (cmd) runCommand(cmd);
      else if (woke) greet();
    },
    onState: onMicState,
  });
  listener.start();
  // 之前配對過就自動連線
  if (linkCodeEl.value) link.connect(linkCodeEl.value);
  startScreen.classList.add('hidden');
  setMode('standby');
});

// 語音清單可能晚一點才載入
speechSynthesis.addEventListener('voiceschanged', () => (voiceEl.textContent = `VOICE ${voiceName()}`));
