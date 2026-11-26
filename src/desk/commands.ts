/**
 * 把一句話轉成指令（關鍵字規則）。
 * 例：「嘿海克斯，打開今天的日報」→ { kind: 'daily', offset: 0 }
 */

export type Command =
  | { kind: 'daily'; offset: number; label: string }
  | { kind: 'open'; query: string }
  | { kind: 'standby' };

const STANDBY_RE = /待命|沒事|没事|退下|休息|再見|掰掰|standby|dismiss/i;
const OPEN_RE = /(?:幫我)?(?:打開|開啟|開|找一下|找|調出|搜尋|叫出|顯示)(?:一下)?(.+)/;

/** 去掉喚醒詞與語助詞，留下真正的指令部分 */
function stripWake(text: string) {
  return text
    .replace(/\s+/g, '')
    .replace(/^.*?(?:海克斯|hex|jarvis|賈維斯|[黑嘿嗨]克斯)[，,。!！]*/i, '')
    .replace(/^(?:嘿|hey|hi|請|麻煩|那)+/i, '');
}

export function parseCommand(raw: string): Command | null {
  const text = stripWake(raw);
  if (!text) return null;
  if (STANDBY_RE.test(text)) return { kind: 'standby' };

  // 「日報」在句尾才算要開日報；「台美股日報看好清單」這種是找筆記
  if (/(?:日報|日报)[。！!？?吧呢啦]*$/.test(text)) {
    if (/前天/.test(text)) return { kind: 'daily', offset: -2, label: '前天' };
    if (/昨天|昨日/.test(text)) return { kind: 'daily', offset: -1, label: '昨天' };
    return { kind: 'daily', offset: 0, label: '今天' };
  }

  const m = text.match(OPEN_RE);
  if (m) {
    const query = m[1]
      .replace(/^(?:我的|那個|這個)/, '')
      .replace(/(?:的)?(?:筆記|檔案|文件|那篇|這篇)$/, '')
      .replace(/[。！？!?，,]+$/, '');
    if (query) return { kind: 'open', query };
  }
  return null;
}
