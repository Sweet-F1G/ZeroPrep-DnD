@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title Сказитель - D^&D Игровой Стол

echo ===================================================
echo     СКАЗИТЕЛЬ · ВАШ МАСТЕР ЗА СТОЛОМ (WINDOWS)
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ОШИБКА] Node.js не найден в системе.
    echo Пожалуйста, установите Node.js версии 20 или новее с https://nodejs.org/
    echo и перезапустите этот скрипт.
    echo.
    pause
    exit /b 1
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [+] Python обнаружен: локальное зрение Мастера поддерживается (MediaPipe / OpenCV).
) else (
    echo [i] Python не найден: Сказитель работает в режиме текста, живого голоса и тактических карт.
)

set "TASK_DIR=%~dp0"
set "SKAZITEL_DATA=%TASK_DIR%Saves"
set "SKAZITEL_VOICE_DIR=%TASK_DIR%LocalVoice"
set "PORT=47831"

if not exist "%SKAZITEL_DATA%" mkdir "%SKAZITEL_DATA%"

echo [*] Запуск локального сервера Сказителя на порту %PORT%...
echo [*] Открытие браузера: http://127.0.0.1:%PORT%
echo [*] Закройте это окно для остановки сервера.
echo.

start "" "http://127.0.0.1:%PORT%"

node "%TASK_DIR%src\server.mjs"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Сервер остановлен с кодом ошибки %ERRORLEVEL%.
    pause
)
