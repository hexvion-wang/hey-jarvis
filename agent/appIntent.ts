// 從一句話判斷「要開哪些程式」。只會回傳 jarvis.config.json 裡有設定的程式 id。

/** 程式 id → 顯示名稱與各種叫法（全部小寫比對） */
export const APP_NAMES: Record<string, { name: string; alias: string[] }> = {
  obsidian: { name: 'Obsidian', alias: ['obsidian', '黑曜石'] },
  chrome: { name: 'Chrome', alias: ['chrome', '瀏覽器', '谷歌', 'google'] },
  claude: { name: 'Claude', alias: ['claude', '克勞德'] },
  chatgpt: { name: 'ChatGPT', alias: ['chatgpt', 'chat gpt', 'gpt'] },
  word: { name: 'Word', alias: ['word', '文書'] },
  excel: { name: 'Excel', alias: ['excel', '試算表', '表格'] },
  powerpoint: { name: 'PowerPoint', alias: ['powerpoint', 'ppt', '簡報'] },
  discord: { name: 'Discord', alias: ['discord', 'dc'] },
  steam: { name: 'Steam', alias: ['steam'] },
  lol: { name: '英雄聯盟', alias: ['英雄聯盟', '英雄連盟', 'lol', '聯盟', 'league of legends'] },
  // 語音辨識常把「鳴潮」聽成同音的「明朝」等，一起列進來
  wuwa: { name: '鳴潮', alias: ['鳴潮', '明朝', '明潮', '鳴朝', '名潮', '銘潮', '冥潮', 'wuwa', 'wuthering'] },
  explorer: { name: '檔案總管', alias: ['檔案總管', '檔案管理', '資料夾', 'explorer'] },
  terminal: { name: '終端機', alias: ['終端機', '終端', 'terminal', '命令列', 'cmd', 'powershell'] },
};

const OPEN_WORDS = /(打開|開啟|開一下|幫我開|啟動|執行|叫出|open|launch|start|^開|[，, ]開)/i;
const NEGATIVE = /(不要|別|不用|關掉|關閉|關一下|怎麼開|如何開|為什麼|是什麼)/;

/**
 * 明確的「打開 X」指令 → 直接回傳 id（不用等 AI，馬上開）。
 * 有否定、疑問的句子，或找不到程式名稱 → 回傳空陣列，交給 AI 判斷。
 */
export function quickOpen(text: string, known: string[]): string[] {
  const t = text.toLowerCase().trim();
  if (t.length > 40 || !OPEN_WORDS.test(t) || NEGATIVE.test(t)) return [];
  const hits: { id: string; at: number }[] = [];
  for (const id of known) {
    const info = APP_NAMES[id];
    const words = info ? info.alias : [id];
    let at = -1;
    for (const w of words) {
      // 英文短字（dc、gpt、lol、cmd）要是完整的字，避免誤判
      const re = /^[a-z ]{1,4}$/.test(w) ? new RegExp(`(^|[^a-z])${w}([^a-z]|$)`) : null;
      const i = re ? t.search(re) : t.indexOf(w);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at >= 0) hits.push({ id, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

/** 給 AI 的程式清單說明（讓它用 [[OPEN:id]] 標記要開的程式） */
export function appPrompt(known: string[]) {
  const list = known.map((id) => `${id}（${APP_NAMES[id]?.name ?? id}）`).join('、');
  return (
    `\n\n你可以幫使用者在電腦上開啟程式，可開的程式：${list}。` +
    '只有在使用者明確要你打開／啟動某個程式時，才在回答最後另起一行寫 [[OPEN:程式id]]（可以多個），並用一句話說你已經幫他打開；' +
    '使用者只是聊到、詢問或說不要開時，不要寫這個標記。清單外的程式請說目前還不能開。' +
    '使用者常用語音輸入，程式名稱可能被聽成同音字（例如「明朝」其實是「鳴潮」），請依發音判斷是哪個程式。'
  );
}

/** 從 AI 回答中取出 [[OPEN:id]]，並把標記從文字拿掉 */
export function extractOpen(text: string, known: string[]) {
  const ids: string[] = [];
  const clean = text.replace(/\[\[\s*OPEN\s*:\s*([\w-]+)\s*\]\]/gi, (_, id: string) => {
    id = id.toLowerCase();
    if (known.includes(id) && !ids.includes(id)) ids.push(id);
    return '';
  });
  return { ids, text: clean.trim() };
}

export const appName = (id: string) => APP_NAMES[id]?.name ?? id;
