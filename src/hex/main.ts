import '../style.css';
import { HexMenu } from './menu';
import { APPS, type AppDef } from './apps';
import { BUILD_ID, ensureLatest } from '../version';

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
  if (!agentOk) return toast(`${app.name}：要從本機 agent 開啟（雙擊 啟動Jarvis.cmd）`, 4000);
  toast(`啟動 ${app.name}…`);
  try {
    const r = await api('/api/launch', { id: app.id });
    if (!r.ok) toast(`${app.name} 沒有設定開啟方式（jarvis.config.json）`, 4000);
  } catch {
    toast('本機 agent 沒有回應', 4000);
  }
}

/** 在 (x, y) 點一下：核心切換展開/收回，節點開啟程式 */
export function pressAt(x: number, y: number) {
  const t = performance.now();
  lastActivity = t;
  if (menu.hitCore(x, y)) return menu.isOpen ? closeMenu() : openMenu();
  const app = menu.hitNode(x, y, t);
  if (app) launch(app);
}

// ---- 輸入（目前用滑鼠；步驟 2 會改成 iPhone 手勢） ----
let cursor: { x: number; y: number } | null = null;
window.addEventListener('pointermove', (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  lastActivity = performance.now();
});
window.addEventListener('pointerleave', () => (cursor = null));
window.addEventListener('pointerdown', (e) => pressAt(e.clientX, e.clientY));
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
  const hovered = menu.draw(ctx, t, cursor, dt);
  canvas.style.cursor = hovered || (cursor && menu.hitCore(cursor.x, cursor.y)) ? 'pointer' : 'default';
  if (menu.state === 'standby' && stateEl.textContent !== 'STANDBY') setStateLabel();
}
requestAnimationFrame(loop);
