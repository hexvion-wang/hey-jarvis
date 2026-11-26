// Obsidian vault 存取：找日報、用檔名搜尋筆記、用 Obsidian 開檔
import { readdir, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, sep, basename } from 'node:path';
import { spawn } from 'node:child_process';

export interface VaultConfig {
  vault: string;
  dailyReport: { folder: string; format: string };
}

/** 確認路徑在 vault 裡面，避免讀到 vault 以外的檔案 */
function inside(vault: string, p: string) {
  const rel = relative(resolve(vault), resolve(p));
  return !!rel && !rel.startsWith('..') && !rel.includes(':');
}

function formatDate(d: Date, fmt: string) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return fmt
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()));
}

export interface FoundFile {
  path: string; // 絕對路徑
  rel: string; // vault 內的相對路徑
}

function toFound(cfg: VaultConfig, p: string): FoundFile {
  return { path: p, rel: relative(cfg.vault, p).split(sep).join('/') };
}

/**
 * 找日報。offset：0 今天、-1 昨天、-2 前天。
 * 找不到那天的就退回「那天以前最新的一份」，並標記 fallback。
 */
export async function findDaily(cfg: VaultConfig, offset: number) {
  const dir = join(cfg.vault, cfg.dailyReport.folder);
  const target = new Date();
  target.setDate(target.getDate() + offset);
  const wanted = formatDate(target, cfg.dailyReport.format);

  const exact = join(dir, `${wanted}.md`);
  if (existsSync(exact)) return { file: toFound(cfg, exact), date: wanted, wanted, fallback: false };

  const files = existsSync(dir) ? await readdir(dir) : [];
  const dated = files
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.md$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[1])
    .filter((d) => d <= wanted)
    .sort()
    .reverse();
  if (!dated.length) return { file: null, date: wanted, wanted, fallback: true };
  return { file: toFound(cfg, join(dir, `${dated[0]}.md`)), date: dated[0], wanted, fallback: true };
}

// ---- 日報摘要（給 HEX 主控台的卡片） ----
const stripMd = (s: string) =>
  s
    .replace(/==🟡?|==/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .trim();

export async function summarizeDaily(cfg: VaultConfig) {
  const r = await findDaily(cfg, 0);
  if (!r.file) return null;
  const text = await readFile(r.file.path, 'utf8');
  const body = text.replace(/^---[\s\S]*?\n---\s*/, '');
  const lines = body.split(/\r?\n/);

  const h1 = lines.find((l) => l.startsWith('# '));
  const title = h1 ? stripMd(h1.slice(2)) : r.date;
  const verdict = title.split('｜')[1] ?? '';

  // 結論段落的前幾個重點；找不到就用全文前幾個條列
  let start = lines.findIndex((l) => /^#{2,3} .*結論/.test(l));
  if (start < 0) start = 0;
  const bullets: string[] = [];
  for (let i = start + 1; i < lines.length && bullets.length < 4; i++) {
    if (start > 0 && /^#{1,2} /.test(lines[i])) break;
    const m = lines[i].match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (m) bullets.push(stripMd(m[1]));
  }
  const sections = lines.filter((l) => /^## /.test(l)).map((l) => stripMd(l.slice(3)));
  return { date: r.date, fallback: r.fallback, rel: r.file.rel, title, verdict, bullets, sections };
}

// ---- 用檔名搜尋 ----
const SKIP_DIRS = new Set(['node_modules', 'exports']);
interface Note { path: string; name: string; mtime: number }
let cache: { at: number; files: Note[] } | null = null;

async function listNotes(vault: string): Promise<Note[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.files;
  const out: Note[] = [];
  async function walk(dir: string) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.name.endsWith('.md')) {
        out.push({ path: p, name: basename(ent.name, '.md'), mtime: (await stat(p)).mtimeMs });
      }
    }
  }
  await walk(vault);
  cache = { at: Date.now(), files: out };
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_，。、！？,.!?'"「」()（）]/g, '');

/** 依檔名找最符合的筆記：完整包含 > 字元依序出現；同分選比較新的 */
export async function searchNote(cfg: VaultConfig, query: string): Promise<FoundFile | null> {
  const q = norm(query);
  if (!q) return null;
  const files = await listNotes(cfg.vault);
  let best: { f: Note; score: number } | null = null;
  for (const f of files) {
    const n = norm(f.name);
    let score = 0;
    if (n === q) score = 100;
    else if (n.includes(q)) score = 60 - Math.min(20, n.length - q.length);
    else {
      // 字元依序出現（容忍語音辨識多字或少字）
      let i = 0;
      for (const ch of n) if (ch === q[i]) i++;
      if (i === q.length) score = 30 - Math.min(20, n.length - q.length);
    }
    if (!score) continue;
    if (!best || score > best.score || (score === best.score && f.mtime > best.f.mtime)) best = { f, score };
  }
  return best ? toFound(cfg, best.f.path) : null;
}

/** 用 Obsidian 打開檔案（透過 obsidian:// 網址） */
export function openInObsidian(cfg: VaultConfig, file: FoundFile) {
  if (!inside(cfg.vault, file.path)) throw new Error('路徑不在 vault 裡');
  const uri = `obsidian://open?path=${encodeURIComponent(file.path)}`;
  // 用 Windows 的網址處理程式開 obsidian://，會直接交給 Obsidian（不經過檔案總管）
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', uri], { detached: true, stdio: 'ignore' }).unref();
}
