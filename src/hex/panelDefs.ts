/** HEX 的三個浮動面板：今日日報、系統狀態、HEX 對話（預留） */
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
}

/** Dock 按鈕 id → 面板 id */
export const PANEL_OF: Record<string, string> = {
  'panel-daily': 'daily',
  'panel-sys': 'sys',
  'panel-chat': 'chat',
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

  // ---- HEX 對話（本機 agent → OpenJarvis → Ollama qwen3:8b） ----
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let busy = false;
  const QUICK: [string, string][] = [
    ['q1', '今天日報的重點是什麼？'],
    ['q2', '我今天還有哪些待辦？'],
    ['q3', '你是誰？能幫我做什麼？'],
    ['q4', '幫我開 Obsidian'],
  ];
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  function addMsg(log: HTMLElement, who: 'hex' | 'me' | 'sys', html: string) {
    const div = document.createElement('div');
    div.className = `chat-msg ${who}`;
    div.innerHTML = html;
    log.appendChild(div);
    log.parentElement!.scrollTop = log.parentElement!.scrollHeight;
    return div;
  }

  async function ask(body: HTMLElement, text: string) {
    text = text.trim();
    if (!text || busy) return;
    const log = body.querySelector('.chat-log') as HTMLElement;
    if (!d.agentOk()) {
      addMsg(log, 'sys', '需要本機 agent（雙擊 啟動Jarvis.cmd）。');
      return;
    }
    busy = true;
    body.classList.add('busy');
    addMsg(log, 'me', esc(text));
    history.push({ role: 'user', content: text });
    const wait = addMsg(log, 'hex', '<span class="chat-dots"><i></i><i></i><i></i></span>');
    const t0 = performance.now();
    try {
      const r = await d.api('/api/chat', { messages: history.slice(-10) });
      if (r.ok) {
        history.push({ role: 'assistant', content: r.text });
        const opened: string[] = r.opened ?? [];
        wait.innerHTML =
          renderMarkdown(r.text) +
          (opened.length ? `<div class="chat-opened">${opened.map((id) => `<span>▶ ${esc(id)}</span>`).join('')}</div>` : '') +
          `<div class="chat-meta">${((performance.now() - t0) / 1000).toFixed(1)} 秒${r.daily ? '　·　參考了日報' : ''}</div>`;
        if (opened.length) d.onOpened?.(opened);
      } else {
        history.pop();
        wait.className = 'chat-msg sys';
        wait.textContent =
          r.error === 'offline'
            ? 'OpenJarvis 還沒啟動：雙擊「啟動OpenJarvis.cmd」，等視窗出現 Uvicorn running 再問一次。'
            : `出錯了：${r.error}`;
      }
    } catch {
      history.pop();
      wait.className = 'chat-msg sys';
      wait.textContent = '本機 agent 沒有回應。';
    }
    log.parentElement!.scrollTop = log.parentElement!.scrollHeight;
    busy = false;
    body.classList.remove('busy');
  }

  panels.define({
    id: 'chat',
    title: 'HEX · 對話',
    width: 480,
    height: 560,
    at: { x: 0.5, y: 0.4 },
    tools: [['clear', '清除']],
    build(body) {
      body.classList.add('chat-body');
      body.innerHTML = `
        <div class="chat-log">
          <div class="chat-msg hex">你好，我是 HEX。可以打字問我，或點下面的快速問題（手勢捏一下也可以）。</div>
        </div>
        <div class="chat-quick">${QUICK.map(([a, q]) => `<button class="hp-btn" data-action="${a}">${q}</button>`).join('')}</div>
        <form class="chat-form"><input class="chat-in" placeholder="輸入問題，按 Enter 送出" maxlength="500" autocomplete="off"><button class="hp-btn" type="submit">送出</button></form>`;
      const form = body.querySelector('.chat-form') as HTMLFormElement;
      const input = body.querySelector('.chat-in') as HTMLInputElement;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        ask(body, v);
      });
      // 打字時不要觸發 HEX 的快捷鍵（空白鍵、Esc、V）
      input.addEventListener('keydown', (e) => e.stopPropagation());
    },
    async onOpen(body) {
      const log = body.querySelector('.chat-log') as HTMLElement;
      for (const m of history) addMsg(log, m.role === 'user' ? 'me' : 'hex', m.role === 'user' ? esc(m.content) : renderMarkdown(m.content));
      const st = await d.api('/api/chat-status').catch(() => null);
      if (st && !st.ok) addMsg(log, 'sys', 'OpenJarvis 還沒啟動：雙擊「啟動OpenJarvis.cmd」。');
      setTimeout(() => (body.querySelector('.chat-in') as HTMLInputElement | null)?.focus(), 400);
    },
    onAction(action, body) {
      if (action === 'clear') {
        history.length = 0;
        body.querySelector('.chat-log')!.innerHTML = '<div class="chat-msg hex">對話已清除。</div>';
        return;
      }
      const q = QUICK.find(([a]) => a === action);
      if (q) ask(body, q[1]);
    },
  });

  return {
    /** 語音指令：打開對話面板（如果還沒開）並送出這句話 */
    say(text: string, from: { x: number; y: number }) {
      if (!panels.isOpen('chat')) panels.show('chat', from);
      const body = document.querySelector('.hpanel[data-panel="chat"] .hp-body') as HTMLElement | null;
      if (body) ask(body, text);
      // 用說的就不要把游標停在輸入框（下次按 Enter 才會是「說話」而不是送出空白）
      setTimeout(() => (document.activeElement as HTMLElement | null)?.blur(), 500);
    },
  };
}
