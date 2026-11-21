# 从 assets/icon.png 生成托盘多尺度图标 icon-16/32/48.png
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("$PSScriptRoot\..\assets\icon.png")
foreach ($s in @(16, 32, 48)) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $out = "$PSScriptRoot\..\assets\icon-$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "saved $out"
}
$src.Dispose()
