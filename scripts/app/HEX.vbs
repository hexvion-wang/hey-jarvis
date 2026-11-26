' HEX desktop app: starts scripts\hex-app.ps1 with no console window
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)) & "\hex-app.ps1"
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
