# Веб-камера Windows → канал 1 эмулятора регистратора (docker/camera-sim/README.md).
#
# Кодирует камеру сразу в два потока, как кодировщик IP-камеры: основной 720p (H.264 или
# H.265) и второй 360p H.264, — и публикует их во вход стенда на 127.0.0.1. WSL2 по
# умолчанию пробрасывает свои порты на localhost Windows, поэтому адрес тот же.
#
# Запуск из PowerShell в каталоге docker\camera-sim:
#   powershell -ExecutionPolicy Bypass -File .\webcam.ps1
#   powershell -ExecutionPolicy Bypass -File .\webcam.ps1 -MainCodec h265
#   powershell -ExecutionPolicy Bypass -File .\webcam.ps1 -Camera "HD Webcam" -Size 640x480
# Остановить — Ctrl+C: канал 1 на регистраторе станет «офлайн», как отключённая камера.

param(
  # Имя камеры как в Windows. Не задано — берётся первая найденная.
  [string]$Camera,
  [ValidateSet('h264', 'h265')]
  [string]$MainCodec = 'h264',
  # Режим, который камера умеет отдавать. Не умеет 1280x720 — ffmpeg скажет
  # «Could not set video options»: укажите -Size 640x480.
  [string]$Size = '1280x720',
  [int]$Fps = 25,
  [string]$Password = $(if ($env:WEBCAM_PUBLISH_PASSWORD) { $env:WEBCAM_PUBLISH_PASSWORD } else { 'webcam-dev' }),
  [int]$Port = $(if ($env:WEBCAM_PUBLISH_PORT) { [int]$env:WEBCAM_PUBLISH_PORT } else { 18554 }),
  # Адрес входа стенда. По умолчанию WSL2 пробрасывает порты на localhost Windows.
  [string]$Address = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Error 'ffmpeg не найден. Установите его: winget install Gyan.FFmpeg — и откройте новое окно PowerShell.'
}

if (-not $Camera) {
  $listing = & ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Out-String
  $found = [regex]::Matches($listing, '"([^"]+)" \(video\)') | ForEach-Object { $_.Groups[1].Value }
  if (-not $found) {
    Write-Error 'Камера не найдена. Проверьте, что она подключена и не занята другой программой.'
  }
  $Camera = @($found)[0]
  Write-Host "Камеры: $(@($found) -join ', ')"
}
Write-Host "Публикую «$Camera» → канал 1 (основной $MainCodec, второй h264). Ctrl+C — остановить."

if ($MainCodec -eq 'h265') {
  $mainEncoder = @('-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-x265-params', 'keyint=50:log-level=error')
} else {
  $mainEncoder = @('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-g', '50')
}
$target = "rtsp://webcam:$Password@${Address}:$Port/webcam"

& ffmpeg -hide_banner -loglevel warning `
  -f dshow -rtbufsize 100M -video_size $Size -framerate $Fps -i "video=$Camera" `
  -filter_complex '[0:v]format=yuv420p,split=2[m][s];[s]scale=640:-2,fps=15[sub]' `
  -map '[m]' @mainEncoder -b:v 2M -f rtsp -rtsp_transport tcp "$target/main" `
  -map '[sub]' -c:v libx264 -preset veryfast -tune zerolatency -g 30 -b:v 512k `
  -f rtsp -rtsp_transport tcp "$target/sub"
