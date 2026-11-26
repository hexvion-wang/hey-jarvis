# 在桌面建立（或重建）HEX 捷徑：powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1
$Root = Split-Path -Parent $PSScriptRoot
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'HEX.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = "`"$Root\scripts\app\HEX.vbs`""
$s.WorkingDirectory = $Root
$s.IconLocation = "$Root\scripts\app\hex.ico,0"
$s.Description = 'H.E.X.'
$s.Save()
Write-Host "已建立 $lnk"
