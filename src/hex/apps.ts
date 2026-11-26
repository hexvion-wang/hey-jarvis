/** HEX 選單上的程式（顯示用）；實際怎麼開由 jarvis.config.json 的 apps 決定 */

export type GroupId = 'work' | 'office' | 'play' | 'tools' | 'panel';

export interface AppDef {
  id: string;
  name: string;
  group: GroupId;
  /** 節點中間顯示的縮寫 */
  glyph: string;
  /** app：開電腦上的程式；panel：在 HUD 上開浮動面板 */
  kind?: 'app' | 'panel';
}

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'work', label: 'WORK · 工作' },
  { id: 'office', label: 'OFFICE · 文書' },
  { id: 'play', label: 'PLAY · 娛樂' },
  { id: 'tools', label: 'TOOLS · 工具' },
];

export const APPS: AppDef[] = [
  { id: 'obsidian', name: 'Obsidian', group: 'work', glyph: 'OB' },
  { id: 'chrome', name: 'Chrome', group: 'work', glyph: 'CR' },
  { id: 'claude', name: 'Claude', group: 'work', glyph: 'CL' },
  { id: 'chatgpt', name: 'ChatGPT', group: 'work', glyph: 'GPT' },
  { id: 'word', name: 'Word', group: 'office', glyph: 'W' },
  { id: 'excel', name: 'Excel', group: 'office', glyph: 'X' },
  { id: 'powerpoint', name: 'PowerPoint', group: 'office', glyph: 'P' },
  { id: 'discord', name: 'Discord', group: 'play', glyph: 'DC' },
  { id: 'steam', name: 'Steam', group: 'play', glyph: 'ST' },
  { id: 'lol', name: '英雄聯盟', group: 'play', glyph: 'LoL' },
  { id: 'wuwa', name: '鳴潮', group: 'play', glyph: 'WW' },
  { id: 'explorer', name: '檔案總管', group: 'tools', glyph: 'FX' },
  { id: 'terminal', name: '終端機', group: 'tools', glyph: '>_' },
];

/** Dock 左邊的面板按鈕（下一步做浮動面板） */
export const PANELS: AppDef[] = [
  { id: 'panel-daily', name: '今日日報', group: 'panel', glyph: '日', kind: 'panel' },
  { id: 'panel-sys', name: '系統狀態', group: 'panel', glyph: 'SYS', kind: 'panel' },
  { id: 'panel-chat', name: 'HEX 對話', group: 'panel', glyph: 'AI', kind: 'panel' },
];
