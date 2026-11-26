import { defineConfig, type Plugin } from 'vite';

// 每次 build 產生一個版本號：日期時間，例如 1126-2105
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const BUILD_ID = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

/** 輸出 version.json，讓頁面打開時檢查自己是不是最新版 */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  // 相對路徑：不論 GitHub repo 叫什麼名字，Pages 都能正確載入資源
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile()],
  server: {
    // 允許 cloudflared tunnel 的網址連進來
    allowedHosts: ['.trycloudflare.com'],
  },
});
