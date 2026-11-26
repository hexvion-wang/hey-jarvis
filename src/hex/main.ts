import '../style.css';
import { HexMenu } from './menu';
import { HexConsole } from './console';
import { Panels } from './panels';
import { definePanels, PANEL_OF } from './panelDefs';
import { APPS, type AppDef } from './apps';
import { BUILD_ID, ensureLatest } from '../version';
import { DeskLink } from '../shared/link';
import { OneEuro } from '../phone/gestures';
import { ClapDetector } from './clap';

document.getElementById('ver')!.textContent = BUILD_ID;
ensureLatest();

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stateEl = $('state');
const agentEl = $('agent');
const toastEl = $('toast');

const IDLE_CLOSE_MS = 30000; // 全息模式多久沒動作回到主控台
const IDLE_CONSOLE_MS = 90000; // 主控台多久沒動作回到待機

const menu = new HexMenu();
const hexConsole = new HexConsole();
const panels = new Panels(document.body);
let W = 1;
let H = 1;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  menu.layout(W, H);
  hexConsole.layout(W, H);
}
window.addEventListener('resize', resize);
resize();

setInterval(() => ($('clock').textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false })), 1000);

// ---- 跟本機 agent 溝通 ----
let agentOk = false;

async function api(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

async function checkAgent() {
  try {
    const r = await api('/api/apps');
    agentOk = !!r.ok;
    const ids = new Set<string>(r.ids);
    menu.setAvailable(ids);
    const n = APPS.filter((a) => ids.has(a.id)).length;
    $('appsCount').textContent = `APPS ${n}/${APPS.length}`;
  } catch {
    agentOk = false;
    menu.setAvailable(null);
    $('appsCount').textContent = `APPS ${APPS.length} · DEMO`;
  }
  agentEl.textContent = agentOk ? 'AGENT ONLINE' : 'AGENT OFFLINE';
  agentEl.classList.toggle('ok', agentOk);
}
checkAgent();

// ---- 訊息 ----
let toastTimer = 0;
function toast(text: string, ms = 2500) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---- 三段流程：待機 → 主控台 → 全息 ----
type Stage = 'standby' | 'console' | 'holo';
const STAGES: Stage[] = ['standby', 'console', 'holo'];
let stage: Stage = 'standby';
/** 等目前的收合動畫跑完，才打開下一段 */
let pending: Stage | null = null;
let lastActivity = performance.now();

function setStateLabel() {
  stateEl.textContent = { standby: 'STANDBY', console: 'CONSOLE', holo: 'HOLO' }[stage];
  document.body.classList.toggle('awake', stage !== 'standby');
}

export function goStage(next: Stage) {
  if (next === stage) return;
  const t = performance.now();
  lastActivity = t;
  if (stage === 'console') hexConsole.close(t);
  if (stage === 'holo') {
    menu.close(t);
    panels.closeAll();
  }
  stage = next;
  pending = next === 'standby' ? null : next;
  if (next === 'console') refreshDaily();
  setStateLabel();
}

/** 往前 / 往後一段 */
export function stepStage(dir: 1 | -1) {
  const i = STAGES.indexOf(stage) + dir;
  if (i >= 0 && i < STAGES.length) goStage(STAGES[i]);
}

// ---- 主控台資料 ----
async function refreshSys() {
  if (!hexConsole.visible && pending !== 'console' && !panels.isOpen('sys')) return;
  if (agentOk) {
    try {
      const r = await api('/api/sys');
      if (r.ok) hexConsole.sys = r;
      hexConsole.demo = false;
      return;
    } catch {
      /* 改用示範數據 */
    }
  }
  // 沒有 agent（例如 GitHub Pages）時用會動的示範數據
  const s = performance.now() / 1000;
  hexConsole.demo = true;
  hexConsole.sys = {
    cpu: { percent: Math.round(25 + 15 * Math.sin(s / 3)), cores: 20, model: 'DEMO CPU' },
    mem: { percent: 46, usedGB: 15.7, totalGB: 34.1 },
    gpu: { name: 'DEMO GPU', util: Math.round(30 + 25 * Math.sin(s / 4)), temp: 48, memUsed: 3600, memTotal: 12282 },
    uptimeH: 1.5,
  };
}
setInterval(refreshSys, 2000);

definePanels(panels, {
  api,
  agentOk: () => agentOk,
  getSys: () => hexConsole.sys,
  toast,
  onOpened(ids) {
    const t = performance.now();
    lastActivity = t;
    for (const id of ids) menu.flash(id, t);
    const names = ids.map((id) => APPS.find((a) => a.id === id)?.name ?? id).join('、');
    toast(`啟動 ${names}…`);
    link.send({ type: 'status', headline: `啟動 ${names}` });
  },
});

async function refreshDaily() {
  refreshSys();
  if (!agentOk) return;
  try {
    const r = await api('/api/daily-summary');
    hexConsole.daily = r.ok ? r : null;
  } catch {
    hexConsole.daily = null;
  }
}

async function launch(app: AppDef) {
  lastActivity = performance.now();
  menu.flash(app.id, performance.now());
  if (app.kind === 'panel') return panels.toggle(PANEL_OF[app.id], menu.dockPos(app.id));
  link.send({ type: 'status', headline: `啟動 ${app.name}` });
  if (!agentOk) return toast(`${app.name}：要從本機 agent 開啟（雙擊 啟動Jarvis.cmd）`, 4000);
  toast(`啟動 ${app.name}…`);
  try {
    const r = await api('/api/launch', { id: app.id });
    if (!r.ok) toast(`${app.name} 沒有設定開啟方式（jarvis.config.json）`, 4000);
  } catch {
    toast('本機 agent 沒有回應', 4000);
  }
}

// 最近一次游標停在哪個程式上（手勢點擊用：捏的動作會讓游標飄走）
let lastHover: { app: AppDef; t: number } | null = null;
const HOVER_GRACE_MS = 400;

/** 在 (x, y) 點一下：核心切換展開/收回，節點開啟程式 */
export function pressAt(x: number, y: number, fromGesture = false) {
  const t = performance.now();
  lastActivity = t;
  // 手勢點到面板：按鈕就執行，其他地方開始拖曳（滑鼠由面板自己處理）
  if (fromGesture && panels.pressAt(x, y)) return;
  // 手勢點到畫面上的按鈕（例如 AR 鏡頭開關）
  if (fromGesture) {
    const btn = document.elementFromPoint(x, y)?.closest('[data-hex-action]') as HTMLElement | null;
    if (btn) return btn.click();
  }
  // 點核心：待機 → 主控台 → 全息；全息時點核心回到主控台
  if (stage === 'standby' && menu.hitCore(x, y)) return goStage('console');
  if (stage === 'console' && hexConsole.hitCore(x, y)) return goStage('holo');
  if (stage === 'holo' && menu.hitCore(x, y)) return goStage('console');
  let app = menu.hitNode(x, y, t);
  if (!app && fromGesture && lastHover && t - lastHover.t <= HOVER_GRACE_MS) app = lastHover.app;
  if (app) launch(app);
}

// ---- iPhone 手勢控制 ----
const GAIN = 1.5; // 手在鏡頭中間一小塊範圍移動，就能涵蓋整個螢幕

/** 一般模式：以畫面中心放大，手不用伸太遠 */
function gainMap(x: number, y: number) {
  const c = (v: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * GAIN));
  return { x: c(x) * W, y: c(y) * H };
}

// ---- AR 鏡頭背景 ----
const bgVideo = $('bg') as HTMLVideoElement;
let arOn = false;
const arLive = () => document.body.classList.contains('ar-live') && bgVideo.videoWidth > 0;

/** AR 模式：游標對準背景畫面裡的手（背景是 object-fit: cover，要扣掉被裁掉的部分） */
function arMap(x: number, y: number) {
  const vw = bgVideo.videoWidth;
  const vh = bgVideo.videoHeight;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s;
  const dh = vh * s;
  return { x: (W - dw) / 2 + x * dw, y: (H - dh) / 2 + y * dh };
}

function toggleAR() {
  if (!link.connected) return toast('先在右下角連上 iPhone，才能開 AR 鏡頭', 3500);
  arOn = !arOn;
  link.send({ type: 'video', on: arOn });
  $('arBtn').classList.toggle('on', arOn);
  if (!arOn) {
    bgVideo.srcObject = null;
    document.body.classList.remove('ar-live');
    menu.gridScale = 1;
  }
  toast(arOn ? 'AR 鏡頭開啟中…' : 'AR 鏡頭已關閉');
}
$('arBtn').addEventListener('click', toggleAR);

// ---- 張開手掌停 1 秒：待機時喚醒，其他時候退回上一段 ----
const PALM_HOLD_MS = 1000;
let palmSince = 0; // 手掌張開開始的時間（0 = 沒張開）
let palmArmed = true; // 觸發後要先放下手才能再觸發

function updatePalm(open: boolean, t: number) {
  if (!open) {
    palmSince = 0;
    palmArmed = true;
    return;
  }
  if (!palmArmed) return;
  if (!palmSince) palmSince = t;
  if (t - palmSince >= PALM_HOLD_MS) {
    palmArmed = false;
    palmSince = 0;
    if (stage === 'standby') goStage('console');
    else stepStage(-1);
    toast(stage === 'console' ? '✋ HEX 主控台' : stage === 'holo' ? '✋ 全息模式' : '✋ 待機');
  }
}

/** 張開手掌時，游標外圈的進度環（1 秒填滿） */
function drawPalmRing(x: number, y: number, t: number) {
  if (!palmSince) return;
  const k = Math.min(1, (t - palmSince) / PALM_HOLD_MS);
  ctx.save();
  ctx.strokeStyle = '#7dffb0';
  ctx.shadowColor = '#7dffb0';
  ctx.shadowBlur = 14;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#7dffb0';
  ctx.font = "600 13px 'Microsoft JhengHei', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText(stage === 'standby' ? '✋ 喚醒' : '✋ 返回', x, y + 56);
  ctx.restore();
}

// ---- 拍手兩下：前進一段（電腦麥克風） ----
const micBtn = $('micBtn');
const micLevel = $('micLevel');
const clap = new ClapDetector(
  () => {
    if (stage === 'holo') return;
    stepStage(1);
    toast(stage === 'console' ? '👏 HEX 主控台' : '👏 全息模式');
  },
  () => {
    micBtn.classList.add('clap');
    setTimeout(() => micBtn.classList.remove('clap'), 150);
  },
);

async function toggleMic() {
  if (clap.running) {
    clap.stop();
    localStorage.removeItem('hex-mic');
    micBtn.classList.remove('on');
    return toast('拍手偵測已關閉');
  }
  try {
    await clap.start();
    localStorage.setItem('hex-mic', '1');
    micBtn.classList.add('on');
    toast('拍手偵測開啟：拍兩下「啪、啪」前進一段');
  } catch {
    toast('麥克風權限被拒絕：點網址列左邊的圖示，把麥克風改成「允許」', 5000);
  }
}
micBtn.addEventListener('click', toggleMic);
// 之前開過就自動開（瀏覽器記得麥克風權限時不會再問）
if (localStorage.getItem('hex-mic')) toggleMic();
setInterval(() => (micLevel.style.width = `${Math.round(clap.level * 100)}%`), 50);
const fx = new OneEuro(1.2, 0.006);
const fy = new OneEuro(1.2, 0.006);
let handT = 0; // 最後一次收到手的位置
let handPinch = false;
const handHistory: { x: number; y: number; t: number }[] = [];
const linkStateEl = $('linkState');
const linkCodeEl = $('linkCode') as HTMLInputElement;

const link = new DeskLink({
  onStream(stream) {
    bgVideo.srcObject = stream;
    document.body.classList.toggle('ar-live', !!stream);
    menu.gridScale = stream ? 0.25 : 1;
    if (stream) bgVideo.play().catch(() => {});
  },
  onState(state, detail) {
    // 重新連上時，如果 AR 是開著的，再請手機傳一次畫面
    if (state === 'connected' && arOn) link.send({ type: 'video', on: true });
    linkStateEl.className = state;
    linkStateEl.textContent =
      state === 'connected' ? 'iPhone ✓' : state === 'connecting' ? '連線中…' : state === 'error' ? `✗ ${detail ?? ''}` : '未連線';
  },
  onMessage(msg) {
    const t = performance.now();
    if (msg.type === 'hand') {
      updatePalm(msg.ok && !!msg.open && !handPinch && !panels.dragging, t);
      if (!msg.ok) {
        fx.reset();
        fy.reset();
        return;
      }
      const p = arLive() ? arMap(msg.x, msg.y) : gainMap(msg.x, msg.y);
      cursor = { x: fx.filter(p.x, t), y: fy.filter(p.y, t) };
      cursorFromHand = true;
      handT = t;
      lastActivity = t;
      handHistory.push({ ...cursor, t });
      if (panels.dragging) panels.moveTo(cursor.x, cursor.y);
      while (handHistory.length && t - handHistory[0].t > 300) handHistory.shift();
    } else if (msg.type === 'pinch') {
      handPinch = msg.down;
      if (!msg.down) panels.release();
      if (msg.down) {
        // 用捏下前約 0.1 秒的位置當點擊點
        const past = handHistory.find((h) => t - h.t <= 120) ?? cursor;
        if (past) pressAt(past.x, past.y, true);
      }
    }
  },
});
linkCodeEl.value = DeskLink.savedCode();
if (linkCodeEl.value) link.connect(linkCodeEl.value);
$('linkBtn').addEventListener('click', () => link.connect(linkCodeEl.value));
linkCodeEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') link.connect(linkCodeEl.value);
});

/** 手勢游標：青藍準星，捏住時變金色縮小 */
function drawHandCursor(x: number, y: number, t: number) {
  const pinch = handPinch;
  const color = pinch ? '#ffc940' : '#00e5ff';
  const r = pinch ? 12 : 20;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + t / 600;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
    ctx.lineTo(x + Math.cos(a) * (r + 11), y + Math.sin(a) * (r + 11));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, pinch ? 6 : 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- 輸入（目前用滑鼠；步驟 2 會改成 iPhone 手勢） ----
let cursor: { x: number; y: number } | null = null;
let cursorFromHand = false;
window.addEventListener('pointermove', (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  cursorFromHand = false;
  lastActivity = performance.now();
});
window.addEventListener('pointerleave', () => {
  if (!cursorFromHand) cursor = null;
});
window.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('#linkBox, .hpanel, [data-hex-action]')) return;
  pressAt(e.clientX, e.clientY);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    stepStage(1);
  } else if (e.code === 'KeyV') {
    toggleAR();
  } else if (e.code === 'Escape') {
    stepStage(-1);
  }
});

// ---- 繪圖迴圈 ----
let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const t = performance.now();
  const dt = t - last;
  last = t;

  // 閒置：全息 → 主控台 → 待機
  if (stage === 'holo' && t - lastActivity > IDLE_CLOSE_MS) goStage('console');
  if (stage === 'console' && t - lastActivity > IDLE_CONSOLE_MS) goStage('standby');

  // 上一段收合完成後才展開下一段
  if (pending && hexConsole.state !== 'closing' && menu.state !== 'closing') {
    if (pending === 'console') hexConsole.open(t);
    if (pending === 'holo') menu.open(t);
    pending = null;
  }

  ctx.clearRect(0, 0, W, H);
  // 手離開鏡頭超過 0.6 秒，手勢游標就隱藏
  if (cursorFromHand && t - handT > 600) {
    cursor = null;
    cursorFromHand = false;
  }
  const hovered = menu.draw(ctx, t, cursor, dt, { core: !hexConsole.visible });
  hexConsole.draw(ctx, t, dt, menu.coreR);
  if (hovered && !(cursorFromHand && handPinch)) lastHover = { app: hovered, t };
  panels.hoverAt(cursorFromHand ? cursor : null);
  panels.tick();
  if (panels.dragging) lastActivity = t;
  if (cursor && cursorFromHand) drawHandCursor(cursor.x, cursor.y, t);
  if (cursor && cursorFromHand) drawPalmRing(cursor.x, cursor.y, t);
  const overCore = cursor && (stage === 'console' ? hexConsole.hitCore(cursor.x, cursor.y) : menu.hitCore(cursor.x, cursor.y));
  canvas.style.cursor = hovered || overCore ? 'pointer' : 'default';
}
requestAnimationFrame(loop);
