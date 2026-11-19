param([int]$ProcId)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Vis32 {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@

$p = Get-Process -Id $ProcId -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq 0) { Write-Output "NO_HANDLE"; exit 0 }

$ws = New-Object -ComObject WScript.Shell
$before = [Vis32]::IsWindowVisible($h)
$ws.SendKeys('^+b')   # Ctrl+Shift+B
Start-Sleep -Seconds 2
$hidden = [Vis32]::IsWindowVisible($h)
$ws.SendKeys('^+b')
Start-Sleep -Seconds 2
$shown = [Vis32]::IsWindowVisible($h)
Write-Output "before=$before afterHide=$hidden afterShow=$shown"
