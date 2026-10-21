# Сказитель - Windows PowerShell Launcher
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Сказитель · D&D Игровой Стол"

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "    СКАЗИТЕЛЬ · ВАШ МАСТЕР ЗА СТОЛОМ (WINDOWS)     " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$nodePath = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath) {
    Write-Host "[ОШИБКА] Node.js не найден в системе." -ForegroundColor Red
    Write-Host "Пожалуйста, установите Node.js 22+ с официального сайта https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "После установки перезапустите этот скрипт."
    Read-Host "Нажмите Enter для выхода..."
    exit 1
}

$taskDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:SKAZITEL_DATA = Join-Path $taskDir "Saves"
$env:SKAZITEL_VOICE_DIR = Join-Path $taskDir "LocalVoice"
$env:PORT = "47831"

if (-not (Test-Path $env:SKAZITEL_DATA)) {
    New-Item -ItemType Directory -Path $env:SKAZITEL_DATA -Force | Out-Null
}

Write-Host "[*] Локальный сервер запущен: http://127.0.0.1:$($env:PORT)" -ForegroundColor Green
Write-Host "[*] Открываем браузер..." -ForegroundColor Green
Write-Host "[*] Закройте это окно PowerShell, чтобы остановить сервер." -ForegroundColor Gray
Write-Host ""

Start-Process "http://127.0.0.1:$($env:PORT)"

$serverScript = Join-Path $taskDir "src\server.mjs"
& node $serverScript
