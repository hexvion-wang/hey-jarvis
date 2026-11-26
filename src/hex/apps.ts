/** HEX 選單上的程式（顯示用）；實際怎麼開由 jarvis.config.json 的 apps 決定 */

export type GroupId = 'work' | 'office' | 'play' | 'tools';

export interface AppDef {
  id: string;
  name: string;
  group: GroupId;
  /** 節點中間顯示的縮寫 */
  glyph: string;
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
