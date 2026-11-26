import { defineConfig } from 'vite';

export default defineConfig({
  // 相對路徑：不論 GitHub repo 叫什麼名字，Pages 都能正確載入資源
  base: './',
  server: {
    // 允許 cloudflared tunnel 的網址連進來
    allowedHosts: ['.trycloudflare.com'],
  },
});
