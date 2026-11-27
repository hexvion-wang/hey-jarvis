/**
 * HEX 浮動玻璃面板（DOM）。滑鼠與 iPhone 手勢共用同一套操作：
 * - 游標停在面板上 → 金色邊框（hover）
 * - 按住滑鼠 / 捏住「標題列」→ 綠色邊框（grab），拖曳移動面板
 * - 按住滑鼠 / 捏住「內容區」→ 上下拖曳捲動內容（像手機滑動）
 * - 手勢拖曳會減速＋平滑，並有一小段防誤觸距離
 * - 抓著標題列往左右甩出去（或拖到畫面邊緣放開）→ 面板飛出畫面、關閉
 * - 面板裡有 data-action 的按鈕 → 點擊（例如 ✕ 關閉、捲動、在 Obsidian 開啟）
 */

import { sfx } from './sfx';

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

/** 手勢拖曳：手移動距離 × 這個倍率（游標本身已放大過，拖曳時收斂一點） */
const GESTURE_MOVE_GAIN = 0.6;
const GESTURE_SCROLL_GAIN = 1.4;
/** 捏下後要移動超過這個距離才開始拖曳／捲動（像素） */
const DEAD_ZONE = 14;
/** 甩出去關閉：放開前 0.15 秒內的水平速度超過這個值（像素/秒）。手勢移動已經乘過 GESTURE_MOVE_GAIN，門檻低一點 */
const THROW_SPEED = { mouse: 1500, gesture: 850 };
/** 拖到畫面左右邊緣放開也算丟掉：面板中心在畫面寬度的這個比例以外 */
const THROW_EDGE = 0.08;

interface Drag {
  o: Open;
  mode: 'move' | 'scroll';
  gesture: boolean;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startScroll: number;
  active: boolean;
  /** 目標位置（手勢時由 tick() 平滑靠近） */
  left: number;
  top: number;
  scroll: number;
  /** 最近的位置紀錄（算甩出去的速度） */
  trail: { x: number; y: number; t: number }[];
}

export class Panels {
  private defs = new Map<string, PanelDef>();
  private open = new Map<string, Open>();
  private z = 10;
  private drag: Drag | null = null;
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
    sfx.open();
    def.onOpen?.(body);

    // 滑鼠操作
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (btn) return this.action(o, btn.dataset.action!);
      if ((e.target as HTMLElement).closest('input, textarea, form button')) return;
      // 捲軸本身留給瀏覽器
      if ((e.target as HTMLElement).closest('.hp-body') && e.offsetX > (e.target as HTMLElement).clientWidth) return;
      this.grab(e.clientX, e.clientY, o, e.target as HTMLElement, false);
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => this.drag && !this.drag.gesture && this.moveTo(e.clientX, e.clientY));
    el.addEventListener('pointerup', () => this.release());
  }

  close(id: string) {
    const o = this.open.get(id);
    if (!o) return;
    this.open.delete(id);
    sfx.close();
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
    else this.grab(x, y, f.o, f.el, true);
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

  /** 開始拖曳：抓在內容區就是捲動，其他地方（標題列、邊框）就是移動 */
  private grab(x: number, y: number, o: Open, target: HTMLElement, gesture: boolean) {
    const r = o.el.getBoundingClientRect();
    const mode = target.closest('.hp-body') ? 'scroll' : 'move';
    this.drag = {
      o,
      mode,
      gesture,
      startX: x,
      startY: y,
      startLeft: r.left,
      startTop: r.top,
      startScroll: o.body.scrollTop,
      active: !gesture, // 滑鼠立刻開始；手勢要先超過防誤觸距離
      left: r.left,
      top: r.top,
      scroll: o.body.scrollTop,
      trail: [],
    };
    o.el.style.zIndex = String(++this.z);
    o.el.classList.add('grabbed');
    o.el.classList.toggle('scrolling', mode === 'scroll');
  }

  moveTo(x: number, y: number) {
    const d = this.drag;
    if (!d) return;
    let dx = x - d.startX;
    let dy = y - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DEAD_ZONE) return;
      // 超過防誤觸距離後，從這裡重新起算，避免一開始跳一下
      d.active = true;
      d.startX = x;
      d.startY = y;
      dx = 0;
      dy = 0;
    }
    if (d.mode === 'scroll') {
      d.scroll = d.startScroll - dy * (d.gesture ? GESTURE_SCROLL_GAIN : 1);
      if (!d.gesture) d.o.body.scrollTop = d.scroll;
      return;
    }
    const k = d.gesture ? GESTURE_MOVE_GAIN : 1;
    const r = d.o.el.getBoundingClientRect();
    d.left = Math.min(window.innerWidth - 60, Math.max(60 - r.width, d.startLeft + dx * k));
    d.top = Math.min(window.innerHeight - 40, Math.max(0, d.startTop + dy * k));
    const now = performance.now();
    d.trail.push({ x: d.left, y: d.top, t: now });
    while (d.trail.length > 2 && now - d.trail[0].t > 200) d.trail.shift();
    // 拖到邊緣：邊框變紅，提示放開就會丟掉
    d.o.el.classList.toggle('will-throw', this.edgeSide(d.o, d.left) !== 0);
    if (!d.gesture) this.apply(d.o, d.left, d.top);
  }

  private apply(o: Open, left: number, top: number) {
    o.el.style.left = `${left}px`;
    o.el.style.top = `${top}px`;
  }

  /** 每一幀呼叫：手勢拖曳時讓面板／捲動平滑地靠近目標 */
  tick() {
    const d = this.drag;
    if (!d || !d.gesture || !d.active) return;
    if (d.mode === 'scroll') {
      d.o.body.scrollTop += (d.scroll - d.o.body.scrollTop) * 0.35;
      return;
    }
    const r = d.o.el.getBoundingClientRect();
    this.apply(d.o, r.left + (d.left - r.left) * 0.3, r.top + (d.top - r.top) * 0.3);
  }

  /** 面板中心在畫面左右邊緣以外：-1 左、1 右、0 不在邊緣 */
  private edgeSide(o: Open, left: number) {
    const c = (left + o.el.offsetWidth / 2) / window.innerWidth;
    return c < THROW_EDGE ? -1 : c > 1 - THROW_EDGE ? 1 : 0;
  }

  /** 放開時要不要丟掉：往左右甩得夠快，或拖到邊緣。回傳方向（-1 / 1），0 = 不丟 */
  private throwSide(d: Drag) {
    if (d.mode !== 'move' || !d.active) return 0;
    const now = performance.now();
    const recent = d.trail.filter((p) => now - p.t < 150);
    if (recent.length >= 2) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = Math.max(16, b.t - a.t) / 1000;
      const vx = (b.x - a.x) / dt;
      const vy = (b.y - a.y) / dt;
      if (Math.abs(vx) > THROW_SPEED[d.gesture ? 'gesture' : 'mouse'] && Math.abs(vx) > Math.abs(vy) * 1.3) return Math.sign(vx);
    }
    return this.edgeSide(d.o, d.left);
  }

  /** 丟掉：面板往那一側飛出畫面、淡出，然後關閉 */
  private throwAway(o: Open, side: number) {
    this.open.delete(o.def.id);
    sfx.close();
    o.el.classList.remove('grabbed', 'scrolling', 'will-throw', 'shown');
    o.el.classList.add('thrown');
    o.el.style.transform = `translate(${side * window.innerWidth * 0.8}px, -40px) rotate(${side * 14}deg) scale(0.9)`;
    o.el.style.opacity = '0';
    setTimeout(() => o.el.remove(), 500);
  }

  release() {
    const d = this.drag;
    if (!d) return;
    const side = this.throwSide(d);
    if (side) {
      this.drag = null;
      return this.throwAway(d.o, side);
    }
    // 手勢放開時直接停在目標位置
    if (d.gesture && d.active) {
      if (d.mode === 'move') this.apply(d.o, d.left, d.top);
      else d.o.body.scrollTop = d.scroll;
    }
    d.o.el.classList.remove('grabbed', 'scrolling', 'will-throw');
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
