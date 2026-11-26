declare const __BUILD_ID__: string;
export const BUILD_ID = __BUILD_ID__;

/**
 * GitHub Pages 會讓瀏覽器快取 10 分鐘，主畫面 App 常常停在舊版。
 * 打開時用 no-store 抓 version.json，跟自己的版本不同就重新載入（最多一次，避免無限重整）。
 */
export async function ensureLatest() {
  if (import.meta.env.DEV) return;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { build } = await res.json();
    const key = 'jarvis-reloaded-for';
    if (build && build !== BUILD_ID && sessionStorage.getItem(key) !== build) {
      sessionStorage.setItem(key, build);
      const url = new URL(location.href);
      url.searchParams.set('v', build);
      location.replace(url.toString());
    }
  } catch {
    /* 離線或抓不到就照用目前版本 */
  }
}
