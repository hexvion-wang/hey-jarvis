/**
 * HEX 對話欄：常駐在畫面左下角（主控台、全息模式都在），可以縮成一顆小按鈕。
 * 打字、快速問題、語音指令都從這裡問 HEX（本機 agent → OpenJarvis → Ollama qwen3:8b）。
 * 快速問題與按鈕都有 data-hex-action，手勢捏一下也能按。
 */
import { renderMarkdown } from './markdown';

interface Deps {
  api(path: string, body?: unknown): Promise<any>;
  agentOk(): boolean;
  /** 對話裡開了程式：讓 Dock 上對應的按鈕閃一下 */
  onOpened?(ids: string[]): void;
  /** HEX 回答了（唸出來用） */
  onReply?(text: string): void;
}

const QUICK: [string, string][] = [
  ['q1', '今天日報的重點是什麼？'],
  ['q2', '我今天還有哪些待辦？'],
  ['q3', '幫我開 Obsidian'],
];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class ChatDock {
  readonly el: HTMLElement;
  private log: HTMLElement;
  private scroller: HTMLElement;
  private input: HTMLInputElement;
  private history: { role: 'user' | 'assistant'; content: string }[] = [];
  private busy = false;
  private checked = false;

  constructor(private d: Deps) {
    const el = document.createElement('section');
    el.id = 'chatDock';
    el.innerHTML = `
      <header class="cd-head">
        <span class="cd-title">HEX · 對話</span>
        <span class="cd-tools">
          <button class="cd-btn" data-hex-action="chat-clear" title="清除對話">清除</button>
          <button class="cd-btn" data-hex-action="chat-fold" title="縮小 / 展開">—</button>
        </span>
      </header>
      <div class="cd-scroll"><div class="cd-log">
        <div class="chat-msg hex">你好，我是 HEX。按 Enter 或「🎙 說話」直接跟我說，也可以在下面打字。</div>
      </div></div>
      <div class="chat-quick">${QUICK.map(([a, q]) => `<button class="cd-btn" data-hex-action="chat-${a}">${q}</button>`).join('')}</div>
      <form class="chat-form"><input class="chat-in" placeholder="輸入問題，按 Enter 送出" maxlength="500" autocomplete="off"><button class="cd-btn" type="submit">送出</button></form>
      <button class="cd-pill" data-hex-action="chat-fold">💬 HEX 對話</button>`;
    document.body.appendChild(el);
    this.el = el;
    this.log = el.querySelector('.cd-log')!;
    this.scroller = el.querySelector('.cd-scroll')!;
    this.input = el.querySelector('.chat-in')!;
    if (localStorage.getItem('hex-chat-fold')) el.classList.add('folded');

    el.querySelector('.chat-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = this.input.value;
      this.input.value = '';
      this.ask(v);
    });
    // 打字時不要觸發 HEX 的快捷鍵（空白鍵、Esc、V、Enter 說話）
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-hex-action]')?.getAttribute('data-hex-action');
      if (!a) return;
      if (a === 'chat-fold') return this.toggleFold();
      if (a === 'chat-clear') {
        this.history.length = 0;
        this.log.innerHTML = '<div class="chat-msg hex">對話已清除。</div>';
        return;
      }
      const q = QUICK.find(([id]) => a === `chat-${id}`);
      if (q) this.ask(q[1]);
    });
    // 滑鼠在對話欄上捲動，不要讓背後的 HEX 收到
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** 主控台／全息模式顯示，待機時藏起來 */
  show(on: boolean) {
    this.el.classList.toggle('shown', on);
    if (on && !this.checked) this.checkBrain();
  }

  /** 放在畫面上的位置（由主控台的版面決定） */
  place(r: { x: number; y: number; w: number; h: number }) {
    Object.assign(this.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  toggleFold(force?: boolean) {
    const fold = force ?? !this.el.classList.contains('folded');
    this.el.classList.toggle('folded', fold);
    if (fold) localStorage.setItem('hex-chat-fold', '1');
    else localStorage.removeItem('hex-chat-fold');
  }

  /** 語音指令：把這句話送出（縮起來的話自動展開） */
  say(text: string) {
    this.toggleFold(false);
    this.ask(text);
  }

  private async checkBrain() {
    this.checked = true;
    const st = await this.d.api('/api/chat-status').catch(() => null);
    if (st && !st.ok) this.add('sys', 'OpenJarvis 還沒啟動：關掉 HEX 再從桌面圖示重開。');
  }

  private add(who: 'hex' | 'me' | 'sys', html: string) {
    const div = document.createElement('div');
    div.className = `chat-msg ${who}`;
    div.innerHTML = html;
    this.log.appendChild(div);
    this.scroller.scrollTop = this.scroller.scrollHeight;
    return div;
  }

  async ask(text: string) {
    text = text.trim();
    if (!text || this.busy) return;
    if (!this.d.agentOk()) {
      this.add('sys', '需要本機 agent（從桌面的 HEX 圖示開啟）。');
      return;
    }
    this.busy = true;
    this.el.classList.add('busy');
    this.add('me', esc(text));
    this.history.push({ role: 'user', content: text });
    const wait = this.add('hex', '<span class="chat-dots"><i></i><i></i><i></i></span>');
    const t0 = performance.now();
    try {
      const r = await this.d.api('/api/chat', { messages: this.history.slice(-10) });
      if (r.ok) {
        this.history.push({ role: 'assistant', content: r.text });
        const opened: string[] = r.opened ?? [];
        wait.innerHTML =
          renderMarkdown(r.text) +
          (opened.length ? `<div class="chat-opened">${opened.map((id) => `<span>▶ ${esc(id)}</span>`).join('')}</div>` : '') +
          `<div class="chat-meta">${((performance.now() - t0) / 1000).toFixed(1)} 秒${r.daily ? '　·　參考了日報' : ''}</div>`;
        if (opened.length) this.d.onOpened?.(opened);
        this.d.onReply?.(r.text);
      } else {
        this.history.pop();
        wait.className = 'chat-msg sys';
        wait.textContent = r.error === 'offline' ? 'OpenJarvis 還沒啟動：關掉 HEX 再從桌面圖示重開。' : `出錯了：${r.error}`;
      }
    } catch {
      this.history.pop();
      wait.className = 'chat-msg sys';
      wait.textContent = '本機 agent 沒有回應。';
    }
    this.scroller.scrollTop = this.scroller.scrollHeight;
    this.busy = false;
    this.el.classList.remove('busy');
  }
}
