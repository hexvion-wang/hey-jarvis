# HEX 一鍵啟動：Ollama → OpenJarvis → 本機 agent → 打開 HEX 網頁
# 已經在跑的就跳過，所以重複雙擊也沒關係。全部只綁本機 127.0.0.1。
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$OpenJarvisDir = 'D:\Claude\OpenJarvis'
$OllamaApp = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
$Url = 'http://localhost:4000'
$Api = 'http://127.0.0.1:4000' # 健康檢查用 IPv4（localhost 會先試 IPv6 而逾時）
Set-Location $Root
$Host.UI.RawUI.WindowTitle = 'HEX'

function Test-Up([string]$u) {
  try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
function Wait-Up([string]$u, [int]$sec) {
  for ($i = 0; $i -lt $sec; $i++) { if (Test-Up $u) { return $true }; Start-Sleep 1 }
  return $false
}
function Step([string]$t) { Write-Host "`n▸ $t" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "  ✓ $t" -ForegroundColor Green }
function Warn([string]$t) { Write-Host "  ! $t" -ForegroundColor Yellow }

Write-Host '  H . E . X .   一鍵啟動' -ForegroundColor Cyan

# 1. Ollama（AI 模型引擎）
Step 'Ollama'
if (Test-Up 'http://127.0.0.1:11434/api/version') { Ok '已經在執行' }
elseif (Test-Path $OllamaApp) {
  Start-Process $OllamaApp
  if (Wait-Up 'http://127.0.0.1:11434/api/version' 30) { Ok '已啟動' } else { Warn 'Ollama 沒有回應，HEX 對話可能不能用' }
}
else { Warn '找不到 Ollama，HEX 對話不能用（其他功能照常）' }

# 2. OpenJarvis（AI 大腦），開在另一個縮小的視窗
Step 'OpenJarvis'
if (Test-Up 'http://127.0.0.1:8000/health') { Ok '已經在執行' }
elseif (Test-Path $OpenJarvisDir) {
  Start-Process cmd.exe -ArgumentList '/c', "`"$Root\啟動OpenJarvis.cmd`"" -WindowStyle Minimized
  Ok '啟動中（另一個縮小的視窗，第一次要 10～30 秒）'
}
else { Warn "找不到 $OpenJarvisDir，HEX 對話不能用" }

# 2b. 語音辨識（本機 Whisper），開在另一個縮小的視窗
Step '語音辨識'
if (Test-Up 'http://127.0.0.1:8001/health') { Ok '已經在執行' }
elseif (Test-Path (Join-Path $Root 'stt\.venv')) {
  Start-Process cmd.exe -ArgumentList '/c', "title HEX STT & cd /d `"$Root\stt`" & set PYTHONIOENCODING=utf-8& set HF_HUB_DISABLE_TELEMETRY=1& uv run python server.py & pause" -WindowStyle Minimized
  Ok '啟動中（另一個縮小的視窗，約 10 秒）'
}
else { Warn '還沒安裝語音辨識（stt），語音功能不能用' }

# 3. 本機 agent（HEX 網頁與開程式、日報）
Step '本機 agent'
if (Test-Up "$Api/api/health") {
  Ok '已經在執行，直接打開 HEX'
  Start-Process $Url
  Start-Sleep 2
  exit
}
if (-not (Test-Path node_modules)) {
  Warn '第一次執行，安裝套件中…'
  npm.cmd install
  if ($LASTEXITCODE) { Read-Host '安裝失敗，按 Enter 關閉'; exit 1 }
}
Write-Host '  建置網頁中…'
npm.cmd run build *> $null
if ($LASTEXITCODE) { Warn '建置失敗，改用上一次建好的版本' }

# agent 準備好後自動開網頁（用 Chrome，沒有就用預設瀏覽器）
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', @"
for (`$i = 0; `$i -lt 30; `$i++) {
  try { Invoke-WebRequest '$Api/api/health' -UseBasicParsing -TimeoutSec 1 | Out-Null; break } catch { Start-Sleep 1 }
}
try { Start-Process chrome '$Url' -ErrorAction Stop } catch { Start-Process '$Url' }
"@

Write-Host ''
Write-Host '  這個視窗就是 HEX 的 agent，用的時候不要關。' -ForegroundColor Yellow
Write-Host '  要全部停止：關掉這個視窗，和縮小的 OpenJarvis 視窗。' -ForegroundColor Yellow
Write-Host ''
node agent/server.ts
Write-Host ''
Read-Host 'agent 已停止，按 Enter 關閉'
