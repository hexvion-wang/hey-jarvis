# 建立 HEX 捷徑：
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1            → 桌面
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1 -Startup   → 開機自動啟動
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1 -Startup -Remove → 取消開機啟動
param([switch]$Startup, [switch]$Remove)
$Root = Split-Path -Parent $PSScriptRoot
$dir = if ($Startup) { [Environment]::GetFolderPath('Startup') } else { [Environment]::GetFolderPath('Desktop') }
$lnk = Join-Path $dir 'HEX.lnk'
if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk }
  Write-Host "已移除 $lnk"
  exit
}
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = "`"$Root\scripts\app\HEX.vbs`""
$s.WorkingDirectory = $Root
$s.IconLocation = "$Root\scripts\app\hex.ico,0"
$s.Description = 'H.E.X.'
$s.Save()
Write-Host "已建立 $lnk"
