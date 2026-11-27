/** HEX 的浮動面板：今日日報、系統狀態（HEX 對話改成常駐的對話欄，見 chatDock.ts） */
import type { Panels } from './panels';
import type { SysInfo } from './console';
import { renderMarkdown } from './markdown';

interface Deps {
  api(path: string, body?: unknown): Promise<any>;
  agentOk(): boolean;
  getSys(): SysInfo | null;
  toast(text: string, ms?: number): void;
  /** 對話裡開了程式：讓 Dock 上對應的按鈕閃一下 */
  onOpened?(ids: string[]): void;
  /** HEX 回答了（唸出來用） */
  onReply?(text: string): void;
}

/** Dock 按鈕 id → 面板 id */
export const PANEL_OF: Record<string, string> = {
  'panel-daily': 'daily',
  'panel-sys': 'sys',
};

export function definePanels(panels: Panels, d: Deps) {
  // ---- 今日日報 ----
  let dailyRel = '';
  panels.define({
    id: 'daily',
    title: 'DAILY REPORT · 今日日報',
    width: 640,
    height: 620,
    at: { x: 0.3, y: 0.42 },
    tools: [
      ['up', '▲'],
      ['down', '▼'],
      ['obsidian', '在 Obsidian 開啟'],
    ],
    build(body) {
      body.innerHTML = '<p class="hp-dim">讀取中…</p>';
    },
    async onOpen(body) {
      if (!d.agentOk()) {
        body.innerHTML = '<p class="hp-dim">需要本機 agent 才能讀取日報（雙擊 啟動Jarvis.cmd，再打開 http://localhost:4000）。</p>';
        return;
      }
      try {
        const r = await d.api('/api/daily-full');
        if (!r.ok) {
          body.innerHTML = '<p class="hp-dim">找不到日報。</p>';
          return;
        }
        dailyRel = r.rel;
        body.innerHTML =
          `<div class="hp-meta">${r.date}${r.fallback ? '　·　今天的還沒產生，顯示最新一份' : ''}　·　${r.rel}</div>` +
          `<article class="md">${renderMarkdown(r.markdown)}</article>`;
      } catch {
        body.innerHTML = '<p class="hp-dim">讀取失敗：本機 agent 沒有回應。</p>';
      }
    },
    async onAction(action) {
      if (action !== 'obsidian') return;
      if (!d.agentOk()) return d.toast('需要本機 agent');
      // 用既有的「開日報」API（會自動找今天或最新一份）
      const r = await d.api('/api/daily', { offset: 0 }).catch(() => null);
      d.toast(r?.ok ? `已在 Obsidian 開啟 ${r.rel ?? dailyRel}` : '開啟失敗');
    },
  });

  // ---- 系統狀態 ----
  const ROWS: [key: string, label: string][] = [
    ['cpu', 'CPU'],
    ['mem', 'RAM'],
    ['gpu', 'GPU'],
    ['vram', 'VRAM'],
    ['temp', 'GPU TEMP'],
  ];
  panels.define({
    id: 'sys',
    title: 'SYSTEM · 系統狀態',
    width: 380,
    at: { x: 0.74, y: 0.36 },
    build(body) {
      body.innerHTML =
        ROWS.map(
          ([k, l]) => `
        <div class="sys-row" data-k="${k}">
          <div class="sys-top"><span>${l}</span><b>--</b></div>
          <div class="sys-bar"><i></i></div>
        </div>`,
        ).join('') + '<div class="hp-meta sys-foot"></div>';
    },
    onOpen(body) {
      const paint = () => {
        const s = d.getSys();
        if (!s) return;
        const vals: Record<string, [number, string]> = {
          cpu: [s.cpu.percent, `${s.cpu.percent}%`],
          mem: [s.mem.percent, `${s.mem.usedGB} / ${s.mem.totalGB} GB`],
          gpu: [s.gpu?.util ?? 0, s.gpu ? `${s.gpu.util}%` : '—'],
          vram: s.gpu ? [(s.gpu.memUsed / s.gpu.memTotal) * 100, `${(s.gpu.memUsed / 1024).toFixed(1)} / ${(s.gpu.memTotal / 1024).toFixed(1)} GB`] : [0, '—'],
          temp: [s.gpu?.temp ?? 0, s.gpu ? `${s.gpu.temp}°C` : '—'],
        };
        for (const [k] of ROWS) {
          const row = body.querySelector(`[data-k="${k}"]`) as HTMLElement;
          const [v, text] = vals[k];
          const hot = k === 'temp' ? v >= 75 : v >= 85;
          const warm = v >= 60;
          row.querySelector('b')!.textContent = text;
          const bar = row.querySelector('i') as HTMLElement;
          bar.style.width = `${Math.min(100, Math.max(2, v))}%`;
          row.dataset.level = hot ? 'hot' : warm ? 'warm' : '';
        }
        body.querySelector('.sys-foot')!.textContent = `${s.cpu.model.replace(/\(R\)|\(TM\)|CPU/g, '').replace(/\s+/g, ' ').trim()} · 開機 ${s.uptimeH} 小時`;
      };
      paint();
      const timer = setInterval(() => (body.isConnected ? paint() : clearInterval(timer)), 1000);
    },
  });
}
