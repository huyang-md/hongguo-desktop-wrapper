# 生成应用图标:红色圆角方块 + 白色播放三角
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $y, 2*$r, 2*$r, 180, 90)
  $path.AddArc($x+$w-2*$r, $y, 2*$r, 2*$r, 270, 90)
  $path.AddArc($x+$w-2*$r, $y+$h-2*$r, 2*$r, 2*$r, 0, 90)
  $path.AddArc($x, $y+$h-2*$r, 2*$r, 2*$r, 90, 90)
  $path.CloseFigure()
  return $path
}

$red = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 66, 66))
$path = New-RoundRectPath 0 0 256 256 56
$g.FillPath($red, $path)
$path.Dispose()

$white = [System.Drawing.Brushes]::White
$pts = @(
  (New-Object System.Drawing.Point(100, 76)),
  (New-Object System.Drawing.Point(192, 128)),
  (New-Object System.Drawing.Point(100, 180))
)
$g.FillPolygon($white, $pts)

$g.Dispose()
$out = Join-Path $PSScriptRoot '..\assets\icon.png'
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "icon saved: $out"
