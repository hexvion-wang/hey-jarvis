// Jarvis 本機 agent：只在這台電腦上跑（綁 127.0.0.1），提供電腦版頁面與 Obsidian 指令
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { findDaily, searchNote, openInObsidian, type VaultConfig } from './obsidian.ts';

const PORT = 4000;
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const CONFIG_PATH = join(ROOT, 'jarvis.config.json');

if (!existsSync(CONFIG_PATH)) {
  console.error('找不到 jarvis.config.json，請複製 jarvis.config.example.json 並填入 Obsidian vault 路徑');
  process.exit(1);
}
const cfg: VaultConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error('request too large');
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
  if (req.method !== 'POST' || !allowed(req)) return send(res, 403, { ok: false, error: 'forbidden' });

  const body = await readJson(req);

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

async function handleStatic(res: ServerResponse, path: string) {
  const file = resolve(DIST, '.' + (path === '/' ? '/desk.html' : decodeURIComponent(path)));
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
