// Jarvis 本機 agent：只在這台電腦上跑（綁 127.0.0.1），提供電腦版頁面與 Obsidian 指令
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { findDaily, searchNote, openInObsidian, summarizeDaily, readDaily, type VaultConfig } from './obsidian.ts';
import { getSysInfo } from './sysinfo.ts';
import { getWeather, DEFAULT_PLACE, type WeatherPlace } from './weather.ts';
import { quickOpen, appPrompt, extractOpen, appName, wantsOpen } from './appIntent.ts';

const PORT = Number(process.env.JARVIS_PORT) || 4000;
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const CONFIG_PATH = join(ROOT, 'jarvis.config.json');
const STARTUP_LNK = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'HEX.lnk');

if (!existsSync(CONFIG_PATH)) {
  console.error('找不到 jarvis.config.json，請複製 jarvis.config.example.json 並填入 Obsidian vault 路徑');
  process.exit(1);
}
const cfg: VaultConfig & { apps?: Record<string, string>; weather?: WeatherPlace } = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const apps: Record<string, string> = cfg.apps ?? {};
if (!existsSync(cfg.vault)) {
  console.error(`vault 路徑不存在：${cfg.vault}`);
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, max = 10_000): Promise<Record<string, unknown>> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > max) throw new Error('request too large');
  }
  return data ? JSON.parse(data) : {};
}

/**
 * 只接受從本機頁面來的請求：
 * - 必須帶自訂標頭 X-Jarvis（其他網站的跨站請求會被瀏覽器的 CORS 預檢擋下，我們不回應預檢）
 * - Origin 若存在，必須是本機這個 port
 */
function allowed(req: IncomingMessage) {
  if (req.headers['x-jarvis'] !== '1') return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path === '/api/health') return send(res, 200, { ok: true });
  if (!allowed(req)) return send(res, 403, { ok: false, error: 'forbidden' });

  // 設定檔裡有哪些程式可以開（只回傳 id，不回傳路徑）
  if (path === '/api/apps' && req.method === 'GET') return send(res, 200, { ok: true, ids: Object.keys(apps) });
  if (path === '/api/weather' && req.method === 'GET') {
    try {
      return send(res, 200, { ok: true, ...((await getWeather(cfg.weather ?? DEFAULT_PLACE)) as object) });
    } catch (e) {
      return send(res, 200, { ok: false, error: String(e) });
    }
  }
  if (path === '/api/sys' && req.method === 'GET') return send(res, 200, { ok: true, ...(await getSysInfo()) });
  if (path === '/api/daily-full' && req.method === 'GET') {
    const d = await readDaily(cfg);
    return send(res, 200, d ? { ok: true, ...d } : { ok: false, error: 'not-found' });
  }
  if (path === '/api/daily-summary' && req.method === 'GET') {
    const s = await summarizeDaily(cfg);
    return send(res, 200, s ? { ok: true, ...s } : { ok: false, error: 'not-found' });
  }

  // 開機自動啟動：Windows「啟動」資料夾裡有沒有 HEX 捷徑
  if (path === '/api/autostart' && req.method === 'GET') return send(res, 200, { ok: true, on: existsSync(STARTUP_LNK) });
  if (path === '/api/autostart' && req.method === 'POST') {
    const on = (await readJson(req)).on === true;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'make-shortcut.ps1'), '-Startup'];
    if (!on) args.push('-Remove');
    spawnSync('powershell.exe', args, { windowsHide: true, timeout: 15000 });
    const now = existsSync(STARTUP_LNK);
    console.log(`開機啟動：${now ? '開' : '關'}`);
    return send(res, 200, { ok: now === on, on: now });
  }

  if (path === '/api/stt-status' && req.method === 'GET') {
    const r = await fetch(`${STT}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => null);
    return send(res, 200, { ok: !!r?.ready, device: r?.device ?? '', loading: !!r && !r.ready });
  }
  // HEX 說話：文字 → 本機 Kokoro 語音（WAV）
  if (path === '/api/speak' && req.method === 'POST') {
    const body = await readJson(req, 5000);
    const text = String(body.text ?? '').slice(0, 400);
    if (!text.trim()) return send(res, 400, { ok: false, error: 'empty' });
    try {
      const r = await fetch(`${STT}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HEX': '1' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return send(res, 200, { ok: false, error: `tts ${r.status}` });
      const wav = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
      return res.end(wav);
    } catch {
      return send(res, 200, { ok: false, error: 'offline' });
    }
  }
  if (path === '/api/stt' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 10 * 1024 * 1024) return send(res, 413, { ok: false, error: 'too large' });
      chunks.push(c);
    }
    try {
      const r = await fetch(`${STT}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': String(req.headers['content-type'] ?? 'audio/webm'), 'X-HEX': '1' },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(30_000),
      });
      const j: any = await r.json();
      if (!r.ok) return send(res, 200, { ok: false, error: j?.error === 'loading' ? 'loading' : String(j?.error ?? r.status) });
      console.log(`語音：${j.ms}ms「${j.text}」`);
      return send(res, 200, { ok: true, text: j.text, ms: j.ms });
    } catch {
      return send(res, 200, { ok: false, error: 'offline' });
    }
  }

  if (path === '/api/chat-status' && req.method === 'GET') {
    const ok = await fetch(`${OPENJARVIS}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    // 打開對話面板時先把模型載進顯卡（第一次載入要一段時間），並保留 30 分鐘
    if (ok) {
      fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: CHAT_MODEL, keep_alive: '30m' }),
      }).catch(() => {});
    }
    return send(res, 200, { ok });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
  const body = await readJson(req, path === '/api/chat' ? 40_000 : 10_000);

  if (path === '/api/chat') return chat(res, body);

  // 開啟程式：只能開設定檔 apps 裡列出的程式（用開始功能表的 AppID）
  if (path === '/api/launch') {
    const id = String(body.id ?? '');
    if (!launchApp(id)) return send(res, 404, { ok: false, error: 'unknown app' });
    return send(res, 200, { ok: true, id });
  }

  if (path === '/api/daily') {
    const offset = Math.max(-7, Math.min(0, Number(body.offset) || 0));
    const r = await findDaily(cfg, offset);
    if (!r.file) return send(res, 200, { ok: false, error: 'not-found', date: r.date });
    openInObsidian(cfg, r.file);
    console.log(`開啟日報：${r.file.rel}${r.fallback ? `（${r.wanted} 還沒有，改開最新的）` : ''}`);
    return send(res, 200, { ok: true, rel: r.file.rel, date: r.date, wanted: r.wanted, fallback: r.fallback });
  }

  if (path === '/api/open') {
    const query = String(body.query ?? '').slice(0, 50);
    const f = await searchNote(cfg, query);
    if (!f) return send(res, 200, { ok: false, error: 'not-found', query });
    openInObsidian(cfg, f);
    console.log(`開啟筆記：${f.rel}（搜尋「${query}」）`);
    return send(res, 200, { ok: true, rel: f.rel, query });
  }

  send(res, 404, { ok: false, error: 'unknown api' });
}

/** 開啟程式：只能開設定檔 apps 裡列出的程式（用開始功能表的 AppID） */
function launchApp(id: string) {
  const appId = Object.hasOwn(apps, id) ? apps[id] : undefined;
  if (!appId) return false;
  spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, stdio: 'ignore' }).unref();
  console.log(`開啟程式：${id}`);
  return true;
}

// ---- HEX 對話：轉給本機的 OpenJarvis（只在 127.0.0.1） ----
const OPENJARVIS = process.env.OPENJARVIS_URL || 'http://127.0.0.1:8000';
const CHAT_MODEL = process.env.HEX_MODEL || 'qwen3:8b';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const STT = process.env.HEX_STT_URL || 'http://127.0.0.1:8001';
/** 問到這些字時，把今天的日報一起交給 AI 參考 */
const DAILY_WORDS = /日報|今天|今日|重點|待辦|進度|工作|做了什麼|摘要|總結/;

async function chat(res: ServerResponse, body: Record<string, unknown>) {
  const raw = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
  const messages = raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role as string, content: String(m.content).slice(0, 2000) }));
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return send(res, 400, { ok: false, error: 'empty' });

  // 明確的「打開 X」→ 不用等 AI，馬上開
  const known = Object.keys(apps);
  const quick = quickOpen(lastUser.content, known);
  if (quick.length) {
    const opened = quick.filter((id) => launchApp(id));
    console.log(`HEX 對話：直接開啟 ${opened.join(', ')}`);
    return send(res, 200, { ok: true, text: `好的，已經幫你打開 ${opened.map(appName).join('、')}。`, opened });
  }

  let system =
    '你是 HEX，使用者電腦上的 AI 助理（鋼鐵人 Jarvis 風格，冷靜、俐落、友善）。' +
    '一律使用繁體中文（台灣用語），不要用簡體字。回答要簡短口語，通常 2～5 句；要列重點時用短條列。';
  let usedDaily = '';
  if (DAILY_WORDS.test(lastUser.content)) {
    const d = await readDaily(cfg).catch(() => null);
    if (d) {
      usedDaily = d.rel;
      system += `\n\n以下是使用者的日報（${d.date}${d.fallback ? '，今天的還沒產生，這是最新一份' : ''}），回答時可以參考：\n${d.markdown.slice(0, 6000)}`;
    }
  }

  system += appPrompt(known);

  const t0 = Date.now();
  try {
    const r = await fetch(`${OPENJARVIS}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        // qwen3 預設會先「思考」很久，/no_think 讓它直接回答
        messages: [{ role: 'system', content: system + ' /no_think' }, ...messages],
        temperature: 0.6,
        max_tokens: 800,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return send(res, 200, { ok: false, error: `OpenJarvis 回應 ${r.status}` });
    const j: any = await r.json();
    const text = String(j?.choices?.[0]?.message?.content ?? '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    // AI 判斷要開程式時，會在回答裡寫 [[OPEN:id]]
    const ex = extractOpen(text, known);
    // 防呆：使用者沒有要開東西（例如只是問日報），AI 加的開程式標記就不理
    const opened = wantsOpen(lastUser.content) ? ex.ids.filter((id) => launchApp(id)) : [];
    if (ex.ids.length && !opened.length) console.log(`HEX 對話：AI 想開 ${ex.ids.join(', ')}，但使用者沒有要開，略過`);
    console.log(`HEX 對話：${(Date.now() - t0) / 1000}s${usedDaily ? `（參考 ${usedDaily}）` : ''}${opened.length ? `，開啟 ${opened.join(', ')}` : ''}`);
    return send(res, 200, { ok: true, text: ex.text || '（沒有回應）', daily: usedDaily || undefined, opened: opened.length ? opened : undefined });
  } catch (e) {
    const down = String(e).includes('ECONNREFUSED') || String((e as any)?.cause).includes('ECONNREFUSED');
    return send(res, 200, { ok: false, error: down ? 'offline' : String(e) });
  }
}

async function handleStatic(res: ServerResponse, path: string) {
  const file = resolve(DIST, '.' + (path === '/' ? '/hex.html' : decodeURIComponent(path)));
  const rel = relative(DIST, file);
  if (rel.startsWith('..') || !existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(file));
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  try {
    if (path.startsWith('/api/')) await handleApi(req, res, path);
    else await handleStatic(res, path);
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: String(e) });
  }
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  port ${PORT} 已經被佔用：agent 可能已經在另一個視窗執行中了。`);
    console.error(`  直接用 Chrome 打開 http://localhost:${PORT} 就可以，或先關掉另一個視窗再重開。\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  J.A.R.V.I.S. agent 已啟動');
  console.log(`  用 Chrome 打開：http://localhost:${PORT}`);
  console.log(`  Obsidian vault：${cfg.vault}\n`);
});
