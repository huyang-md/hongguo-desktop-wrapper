param([int]$ProcId, [string]$OutPath, [int]$MaxWidth = 900, [int]$ResizeW = 0, [int]$ResizeH = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Shot32B {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

[Shot32B]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Id $ProcId -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq 0) { Write-Output "NO_HANDLE"; exit 1 }

Write-Output ("visible=" + [Shot32B]::IsWindowVisible($h) + " iconic=" + [Shot32B]::IsIconic($h))
if ([Shot32B]::IsIconic($h)) { [Shot32B]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 800 }  # SW_RESTORE

if ($ResizeW -gt 0) {
  [Shot32B]::MoveWindow($h, 80, 80, $ResizeW, $ResizeH, $true) | Out-Null
  Start-Sleep -Milliseconds 1800
}

$r = New-Object Shot32B+RECT
[Shot32B]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
if ($w -le 0 -or $ht -le 0) { Write-Output "BAD_RECT"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT(0x2):让 DWM 把窗口完整内容(含 GPU 合成)渲染进位图
# 调两次:第一次触发热渲染,第二次才是有效帧
[Shot32B]::PrintWindow($h, $hdc, 2) | Out-Null
Start-Sleep -Milliseconds 300
[Shot32B]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$g.Dispose()

if ($w -gt $MaxWidth) {
  $nw = $MaxWidth; $nh = [int]($ht * $MaxWidth / $w)
  $small = New-Object System.Drawing.Bitmap($nw, $nh)
  $g2 = [System.Drawing.Graphics]::FromImage($small)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $nw, $nh)
  $g2.Dispose()
  $small.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $small.Dispose()
} else {
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
$bmp.Dispose()
Write-Output "SHOT_OK $OutPath"
