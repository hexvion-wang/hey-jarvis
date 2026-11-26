import '../style.css';
import { HexMenu } from './menu';
import { APPS, type AppDef } from './apps';
import { BUILD_ID, ensureLatest } from '../version';
import { DeskLink } from '../shared/link';
import { OneEuro } from '../phone/gestures';

document.getElementById('ver')!.textContent = BUILD_ID;
ensureLatest();

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stateEl = $('state');
const agentEl = $('agent');
const toastEl = $('toast');

const IDLE_CLOSE_MS = 20000; // 展開後多久沒動作自動收回

const menu = new HexMenu();
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

// ---- 展開 / 收回 / 開啟程式 ----
let lastActivity = performance.now();

function setStateLabel() {
  stateEl.textContent = menu.isOpen ? 'ONLINE' : 'STANDBY';
  document.body.classList.toggle('awake', menu.isOpen);
}

export function openMenu() {
  lastActivity = performance.now();
  menu.open(performance.now());
  setStateLabel();
}

export function closeMenu() {
  menu.close(performance.now());
  setStateLabel();
}

async function launch(app: AppDef) {
  lastActivity = performance.now();
  menu.flash(app.id, performance.now());
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
  if (menu.hitCore(x, y)) return menu.isOpen ? closeMenu() : openMenu();
  let app = menu.hitNode(x, y, t);
  if (!app && fromGesture && lastHover && t - lastHover.t <= HOVER_GRACE_MS) app = lastHover.app;
  if (app) launch(app);
}

// ---- iPhone 手勢控制 ----
const GAIN = 1.5; // 手在鏡頭中間一小塊範圍移動，就能涵蓋整個螢幕
const fx = new OneEuro(1.2, 0.006);
const fy = new OneEuro(1.2, 0.006);
let handT = 0; // 最後一次收到手的位置
let handPinch = false;
const handHistory: { x: number; y: number; t: number }[] = [];
const linkStateEl = $('linkState');
const linkCodeEl = $('linkCode') as HTMLInputElement;

const link = new DeskLink({
  onState(state, detail) {
    linkStateEl.className = state;
    linkStateEl.textContent =
      state === 'connected' ? 'iPhone ✓' : state === 'connecting' ? '連線中…' : state === 'error' ? `✗ ${detail ?? ''}` : '未連線';
  },
  onMessage(msg) {
    const t = performance.now();
    if (msg.type === 'hand') {
      if (!msg.ok) {
        fx.reset();
        fy.reset();
        return;
      }
      const clamp = (v: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * GAIN));
      cursor = { x: fx.filter(clamp(msg.x) * W, t), y: fy.filter(clamp(msg.y) * H, t) };
      cursorFromHand = true;
      handT = t;
      lastActivity = t;
      handHistory.push({ ...cursor, t });
      while (handHistory.length && t - handHistory[0].t > 300) handHistory.shift();
    } else if (msg.type === 'pinch') {
      handPinch = msg.down;
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
  if ((e.target as HTMLElement).closest('#linkBox')) return;
  pressAt(e.clientX, e.clientY);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (menu.isOpen) closeMenu();
    else openMenu();
  } else if (e.code === 'Escape') {
    closeMenu();
  }
});

// ---- 繪圖迴圈 ----
let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const t = performance.now();
  const dt = t - last;
  last = t;

  if (menu.isOpen && t - lastActivity > IDLE_CLOSE_MS) closeMenu();

  ctx.clearRect(0, 0, W, H);
  // 手離開鏡頭超過 0.6 秒，手勢游標就隱藏
  if (cursorFromHand && t - handT > 600) {
    cursor = null;
    cursorFromHand = false;
  }
  const hovered = menu.draw(ctx, t, cursor, dt);
  if (hovered && !(cursorFromHand && handPinch)) lastHover = { app: hovered, t };
  if (cursor && cursorFromHand) drawHandCursor(cursor.x, cursor.y, t);
  canvas.style.cursor = hovered || (cursor && menu.hitCore(cursor.x, cursor.y)) ? 'pointer' : 'default';
  if (menu.state === 'standby' && stateEl.textContent !== 'STANDBY') setStateLabel();
}
requestAnimationFrame(loop);
