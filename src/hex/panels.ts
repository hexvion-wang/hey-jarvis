/**
 * HEX 浮動玻璃面板（DOM）。滑鼠與 iPhone 手勢共用同一套操作：
 * - 游標停在面板上 → 金色邊框（hover）
 * - 按住滑鼠 / 捏住 → 綠色邊框（grab），可以拖曳
 * - 面板裡有 data-action 的按鈕 → 點擊（例如 ✕ 關閉、捲動、在 Obsidian 開啟）
 */

export interface PanelDef {
  id: string;
  title: string;
  width: number;
  height?: number;
  /** 預設位置：相對畫面寬高的比例（面板中心） */
  at: { x: number; y: number };
  /** 標題列額外按鈕，例如 [['up','▲'],['down','▼']] */
  tools?: [action: string, label: string][];
  build(body: HTMLElement, panel: HTMLElement): void;
  onOpen?(body: HTMLElement): void;
  onAction?(action: string, body: HTMLElement): void;
}

interface Open {
  def: PanelDef;
  el: HTMLElement;
  body: HTMLElement;
}

export class Panels {
  private defs = new Map<string, PanelDef>();
  private open = new Map<string, Open>();
  private z = 10;
  private drag: { o: Open; dx: number; dy: number } | null = null;
  private hoverEl: HTMLElement | null = null;

  constructor(private root: HTMLElement) {}

  define(def: PanelDef) {
    this.defs.set(def.id, def);
  }

  isOpen(id: string) {
    return this.open.has(id);
  }

  get anyOpen() {
    return this.open.size > 0;
  }

  toggle(id: string, from: { x: number; y: number }) {
    if (this.open.has(id)) this.close(id);
    else this.show(id, from);
  }

  /** 從 Dock 按鈕的位置放大飛出來 */
  show(id: string, from: { x: number; y: number }) {
    const def = this.defs.get(id);
    if (!def || this.open.has(id)) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = Math.min(def.width, W - 40);
    const h = Math.min(def.height ?? 0, H - 290) || undefined;

    const el = document.createElement('section');
    el.className = 'hpanel';
    el.dataset.panel = id;
    el.style.width = `${w}px`;
    if (h) el.style.height = `${h}px`;
    el.innerHTML = `
      <header class="hp-head">
        <span class="hp-title">${def.title}</span>
        <span class="hp-tools">
          ${(def.tools ?? []).map(([a, l]) => `<button class="hp-btn" data-action="${a}">${l}</button>`).join('')}
          <button class="hp-btn hp-close" data-action="close" title="關閉">✕</button>
        </span>
      </header>
      <div class="hp-body"></div>
      <i class="hp-corner tl"></i><i class="hp-corner tr"></i><i class="hp-corner bl"></i><i class="hp-corner br"></i>`;
    const body = el.querySelector('.hp-body') as HTMLElement;
    def.build(body, el);
    this.root.appendChild(el);

    // 定位：中心在 def.at，不超出畫面
    const rect = el.getBoundingClientRect();
    const left = Math.min(W - rect.width - 16, Math.max(16, def.at.x * W - rect.width / 2));
    // 底部留給 Dock（約 230px），面板不要蓋住它
    const top = Math.min(H - rect.height - 230, Math.max(60, def.at.y * H - rect.height / 2));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.zIndex = String(++this.z);

    // 從按鈕位置縮放飛出
    const dx = from.x - (left + rect.width / 2);
    const dy = from.y - (top + rect.height / 2);
    el.style.transform = `translate(${dx}px, ${dy}px) scale(0.05)`;
    el.style.opacity = '0';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.classList.add('shown');
        el.style.transform = '';
        el.style.opacity = '';
      }),
    );

    const o: Open = { def, el, body };
    this.open.set(id, o);
    def.onOpen?.(body);

    // 滑鼠操作
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (btn) return this.action(o, btn.dataset.action!);
      // 捲軸區域留給瀏覽器捲動
      if ((e.target as HTMLElement).closest('.hp-body') && e.offsetX > (e.target as HTMLElement).clientWidth) return;
      this.grab(e.clientX, e.clientY, o);
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => this.drag && this.moveTo(e.clientX, e.clientY));
    el.addEventListener('pointerup', () => this.release());
  }

  close(id: string) {
    const o = this.open.get(id);
    if (!o) return;
    this.open.delete(id);
    if (this.drag?.o === o) this.drag = null;
    o.el.classList.remove('shown');
    o.el.classList.add('closing');
    setTimeout(() => o.el.remove(), 350);
  }

  closeAll() {
    for (const id of [...this.open.keys()]) this.close(id);
  }

  private find(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const panelEl = el?.closest('.hpanel') as HTMLElement | null;
    if (!panelEl) return null;
    const o = this.open.get(panelEl.dataset.panel!);
    return o ? { o, el: el! } : null;
  }

  /** 這個點是否在面板上（手勢點擊時先問面板要不要處理） */
  hit(x: number, y: number) {
    return !!this.find(x, y);
  }

  /** 手勢捏下：按鈕就執行，其他地方就開始拖曳 */
  pressAt(x: number, y: number) {
    const f = this.find(x, y);
    if (!f) return false;
    const btn = f.el.closest('[data-action]') as HTMLElement | null;
    if (btn) this.action(f.o, btn.dataset.action!);
    else this.grab(x, y, f.o);
    return true;
  }

  private action(o: Open, action: string) {
    if (action === 'close') return this.close(o.def.id);
    if (action === 'up' || action === 'down') {
      o.body.scrollBy({ top: (action === 'up' ? -1 : 1) * o.body.clientHeight * 0.7, behavior: 'smooth' });
      return;
    }
    o.def.onAction?.(action, o.body);
  }

  private grab(x: number, y: number, o: Open) {
    const r = o.el.getBoundingClientRect();
    this.drag = { o, dx: x - r.left, dy: y - r.top };
    o.el.style.zIndex = String(++this.z);
    o.el.classList.add('grabbed');
  }

  moveTo(x: number, y: number) {
    if (!this.drag) return;
    const { o, dx, dy } = this.drag;
    const r = o.el.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 60, Math.max(60 - r.width, x - dx));
    const top = Math.min(window.innerHeight - 40, Math.max(0, y - dy));
    o.el.style.left = `${left}px`;
    o.el.style.top = `${top}px`;
  }

  release() {
    if (!this.drag) return;
    this.drag.o.el.classList.remove('grabbed');
    this.drag = null;
  }

  get dragging() {
    return !!this.drag;
  }

  /** 手勢游標停留：面板與按鈕加上 hover 樣式 */
  hoverAt(p: { x: number; y: number } | null) {
    const f = p ? this.find(p.x, p.y) : null;
    const target = f ? ((f.el.closest('[data-action]') as HTMLElement | null) ?? f.o.el) : null;
    if (target === this.hoverEl) return;
    this.hoverEl?.classList.remove('hand-hover');
    this.hoverEl?.closest('.hpanel')?.classList.remove('hand-hover');
    this.hoverEl = target;
    target?.classList.add('hand-hover');
    target?.closest('.hpanel')?.classList.add('hand-hover');
  }
}
