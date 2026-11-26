# HEX 桌面程式：背景安靜地啟動服務，用獨立視窗打開 HEX；關掉 HEX 視窗就停止服務。
# 由桌面捷徑（scripts\app\HEX.vbs）呼叫，不會出現黑色視窗。
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $PSScriptRoot 'app'
$LogDir = Join-Path $Root 'logs'
$OpenJarvisDir = 'D:\Claude\OpenJarvis'
$OllamaApp = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
$Api = 'http://127.0.0.1:4000'
$HexProfile = Join-Path $env:LOCALAPPDATA 'HEX\browser' # HEX 視窗專用的瀏覽器設定（麥克風權限記在這裡）
Set-Location $Root
New-Item -ItemType Directory -Force $LogDir, $HexProfile | Out-Null

function Test-Up([string]$u) {
  try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
function Log([string]$t) { Add-Content -Path (Join-Path $LogDir 'hex-app.log') -Value "$(Get-Date -Format 'MM-dd HH:mm:ss') $t" -Encoding UTF8 }

# 找瀏覽器：Chrome 優先，沒有就用 Edge
$Browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# 路徑有空白和中文：轉成編碼過的網址；參數整串自己加引號（Start-Process 不會幫忙）
$loading = ([Uri](Join-Path $AppDir 'loading.html')).AbsoluteUri
$browserArgs = "--app=`"$loading`" --user-data-dir=`"$HexProfile`" --start-maximized --no-first-run --no-default-browser-check"

# 已經開著（agent 在跑）→ 只再開一個 HEX 視窗
if (Test-Up "$Api/api/health") {
  Log '已在執行，只開視窗'
  Start-Process $Browser -ArgumentList $browserArgs
  exit
}

Log '---- 啟動 ----'
# 先開視窗（顯示啟動畫面），服務在背後準備
$win = Start-Process $Browser -ArgumentList $browserArgs -PassThru

$started = @()
# 1. Ollama
if (-not (Test-Up 'http://127.0.0.1:11434/api/version') -and (Test-Path $OllamaApp)) {
  Start-Process $OllamaApp -WindowStyle Hidden
  Log 'Ollama 啟動'
}
# 2. OpenJarvis（隱藏視窗）
if (-not (Test-Up 'http://127.0.0.1:8000/health') -and (Test-Path $OpenJarvisDir)) {
  $env:PYTHONIOENCODING = 'utf-8'
  $oj = Start-Process uv -WorkingDirectory $OpenJarvisDir -WindowStyle Hidden -PassThru `
    -ArgumentList 'run', 'jarvis', 'serve', '--host', '127.0.0.1', '--port', '8000', '--engine', 'ollama', '--model', 'qwen3:8b', '--agent', 'simple' `
    -RedirectStandardOutput (Join-Path $LogDir 'openjarvis.log') -RedirectStandardError (Join-Path $LogDir 'openjarvis.err.log')
  $started += $oj
  Log "OpenJarvis 啟動 pid=$($oj.Id)"
}
# 2b. 語音辨識（本機 Whisper，隱藏視窗）
if (-not (Test-Up 'http://127.0.0.1:8001/health') -and (Test-Path (Join-Path $Root 'stt\.venv'))) {
  $env:PYTHONIOENCODING = 'utf-8'; $env:HF_HUB_DISABLE_TELEMETRY = '1'
  $stt = Start-Process uv -WorkingDirectory (Join-Path $Root 'stt') -WindowStyle Hidden -PassThru `
    -ArgumentList 'run', 'python', 'server.py' `
    -RedirectStandardOutput (Join-Path $LogDir 'stt.log') -RedirectStandardError (Join-Path $LogDir 'stt.err.log')
  $started += $stt
  Log "語音辨識啟動 pid=$($stt.Id)"
}
# 3. 本機 agent：程式碼有改過才重新建置
$dist = Join-Path $Root 'dist\hex.html'
$newest = Get-ChildItem (Join-Path $Root 'src'), (Join-Path $Root '*.html') -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $dist) -or $newest.LastWriteTime -gt (Get-Item $dist).LastWriteTime) {
  Log '重新建置網頁'
  & npm.cmd run build *> (Join-Path $LogDir 'build.log')
}
$agent = Start-Process node -ArgumentList 'agent/server.ts' -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $LogDir 'agent.log') -RedirectStandardError (Join-Path $LogDir 'agent.err.log')
$started += $agent
Log "agent 啟動 pid=$($agent.Id)"

# 等 HEX 視窗關掉
try { $win.WaitForExit() } catch {}
# 保險：同一個設定資料夾的瀏覽器都關了才算關掉
while (Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$HexProfile*" }) { Start-Sleep 2 }

Log '視窗已關閉，停止服務'
foreach ($p in $started) { if ($p -and -not $p.HasExited) { taskkill /PID $p.Id /T /F | Out-Null } }
