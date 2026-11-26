/**
 * 很小的 Markdown 轉 HTML（給日報面板用）：標題、條列、表格、引用、分隔線、
 * 粗體、Obsidian 螢光筆 ==…==、行內程式碼、連結（只顯示文字，不可點）。
 * 一律先跳脫 HTML，不會執行筆記裡的任何 HTML。
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/==🟡?([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '<span class="md-link">$2</span>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="md-link">$1</span>');
}

const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    // 表格：| a | b | 下一行是 |---|---|
    if (t.startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      closeList();
      const head = splitRow(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      i--;
      out.push(
        '<div class="md-table"><table><thead><tr>' +
          head.map((h) => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>',
      );
      continue;
    }

    const h = t.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      closeList();
      out.push('<hr>');
      continue;
    }
    if (t.startsWith('>')) {
      closeList();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quote.push(lines[i++].trim().replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${quote.map((q) => inline(q.replace(/^[-*]\s+/, '• '))).join('<br>')}</blockquote>`);
      continue;
    }
    const ul = t.match(/^[-*]\s+(.*)/);
    const ol = t.match(/^\d+\.\s+(.*)/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }
    closeList();
    if (t) out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join('\n');
}
