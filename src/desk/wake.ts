/**
 * 喚醒詞比對。
 * - 強規則：明確像 Jarvis 的字，單獨出現就算
 * - 弱規則：常見誤聽（價位是、家裡是…），前面要有「嘿 / hey / hi」才算，避免一般對話誤觸發
 * - 自訂：訓練模式記下來的、你的聲音實際被辨識成的字
 */

const STRONG = [
  /jarvis|jervis|javis|jarvas|jarvi|travis|charvis|davis/i,
  /[賈加嘉家佳甲假價夾架][維唯為威偉惟微][斯絲思司]/,
];
const WEAK = /[賈加嘉家佳甲假價夾架嫁][維唯為威偉位圍衛味惟微][斯絲思司是師詩式事市世時士實四西]/;
const HEY = /(hey|hi|hay|hei|嘿|黑|嗨|欸|誒|ㄟ)/;

const STORE_KEY = 'jarvis-wake-phrases';

export function normalize(text: string) {
  return text.toLowerCase().replace(/[\s，。、！？,.!?'"「」]/g, '');
}

export function loadCustom(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveCustom(list: string[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify([...new Set(list)].slice(-30)));
}

let custom = loadCustom();
export function setCustom(list: string[]) {
  custom = list;
  saveCustom(list);
}
export function getCustom() {
  return custom;
}

export function isWakeWord(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (STRONG.some((re) => re.test(n))) return true;
  const weak = n.match(WEAK);
  if (weak && HEY.test(n.slice(0, weak.index ?? 0))) return true;
  return custom.some((p) => p.length >= 2 && n.includes(p));
}

/** 訓練時把一句話轉成要記住的片段：去掉後面多講的部分，最多取前 6 個字 */
export function phraseFromTraining(text: string): string | null {
  const n = normalize(text);
  if (n.length < 2) return null;
  return n.slice(0, 6);
}
