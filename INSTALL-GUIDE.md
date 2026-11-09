# Руководство по установке и запуску / Installation & User Guide

<div align="center">

[🇷🇺 Русский](#-русский) | [🇬🇧 English](#-english)

</div>

---

## 🇷🇺 Русский

### 1. Системные требования

#### 🍏 macOS:
- Компьютер Mac на базе **Apple Silicon** (M1, M2, M3, M4 или новее);
- Версия операционной системы: **macOS 14 (Sonoma)** или **macOS 15 (Sequoia)**;
- Установка дополнительных программ или Node.js **не требуется** — исполняемый рантайм уже встроен внутрь `Skazitel.app`.

#### 🪟 Windows:
- Операционная система: **Windows 10** или **Windows 11** (64-bit);
- Установленный **Node.js 20 LTS** или новее ([скачать с официального сайта nodejs.org](https://nodejs.org/)).

---

### 2. Запуск приложения

#### 🍏 На macOS:
1. Распакуйте архив `Skazitel-v0.9.4-macOS-AppleSilicon.zip` в любую удобную папку (например, `Программы` или рабочий стол).
2. **Основной способ (Нативное приложение):**
   - Откройте **`Skazitel.app`** двойным щелчком мыши.
   - *Примечание при первом запуске:* Если macOS покажет предупреждение о неподтверждённом разработчике, откройте *Системные настройки → Конфиденциальность и безопасность* и нажмите *«Подтвердить вход»* (или кликните правой кнопкой мыши по `Skazitel.app` и выберите *«Открыть»*).
3. **Альтернативный способ (через браузер):**
   - Запустите файл **`Start-browser.command`** — сервер поднимется локально и откроет интерфейс в вашем браузере по адресу `http://localhost:47831`.

#### 🪟 На Windows:
1. Распакуйте архив `Skazitel-v0.9.4-Windows.zip`.
2. Убедитесь, что у вас установлен Node.js (проверить в командной строке: `node -v`).
3. **Основной способ:**
   - Запустите файл **`Start-Windows.bat`** двойным щелчком мыши.
   - Скрипт проверит окружение, запустит локальный сервер и автоматически откроет браузер по адресу `http://127.0.0.1:47831`.
4. **Запуск через PowerShell:**
   - Откройте PowerShell в папке проекта и выполните:
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\Start-Windows.ps1
     ```

---

### 3. Первый запуск и настройка

1. **Выбор языка:**
   - Нажмите кнопку **`🌐 RU / EN`** в верхней панели для мгновенного переключения всего интерфейса и промптов Мастера на русский или английский язык.
2. **Создание первой игры:**
   - Нажмите **«Создать кампанию ↗»** или **«＋ Новая игра»** в боковой панели;
   - Задайте название, редакцию правил (D&D 2024 или 2014) и атмосферу;
   - Либо нажмите **«Продолжить историю Теона и Альвари»** для быстрого ознакомительного старта с готовыми героями.
3. **Подключение моделей и голоса:**
   - Внизу слева нажмите **`⚙ Модели и голос`**;
   - **Ведущий:** выберите провайдера модели (OpenAI `gpt-4o`, `gpt-4o-mini`, Google Gemini или любой совместимый OpenAI-сервер);
   - **Распознавание речи (STT):** выберите Groq (`whisper-large-v3-turbo`) или OpenAI Whisper;
   - **Озвучивание (TTS):** 
     - *OpenAI TTS* — кинематографичный баритон Мастера `onyx` и выразительные женские голоса `nova`;
     - *Silero TTS* — полностью автономный синтез, работающий локально без интернета и без API-ключей.
4. **Безопасность API-ключей:**
   - На macOS API-ключи сохраняются в системной Связке ключей (`KeyStore.app`) и никогда не попадают в сохранения кампаний или логи.

---

### 4. Игра за столом и мобильный компаньон

1. **Голосовой ввод:**
   - Удерживайте клавишу **`Пробел`** (вне текстовых полей) или кнопку микрофона 🎙️, произнесите действие своего героя и отпустите.
   - При бросках кубиков бросайте настоящие физические кости и назовите число вслух (например: *«на кубике 15»*).
2. **Тактическая карта:**
   - Нажмите клавишу **`M`** (или русскую `ь`) для открытия плавающего тактического окна Apple HIG. Окно можно свободно перетаскивать, менять размер, сворачивать в пилюлю 🟡 или встраивать в стол кнопкой `◧ Встроить`.
3. **Подключение игроков со смартфонов (LAN Companion):**
   - Нажмите кнопку **`📱 Игроки (LAN)`** в верхней панели;
   - Игроки за столом сканируют QR-код камерой телефона и подключаются к партии без установки приложений.

---

<br>

---

## 🇬🇧 English

### 1. System Requirements

#### 🍏 macOS:
- Mac computer with **Apple Silicon** (M1, M2, M3, M4 or newer);
- Operating System: **macOS 14 (Sonoma)** or **macOS 15 (Sequoia)**;
- No extra dependencies or Node.js required — the complete runtime is embedded inside `Skazitel.app`.

#### 🪟 Windows:
- Operating System: **Windows 10** or **Windows 11** (64-bit);
- **Node.js 20 LTS** or newer installed ([download from nodejs.org](https://nodejs.org/)).

---

### 2. How to Launch

#### 🍏 On macOS:
1. Extract `Skazitel-v0.9.4-macOS-AppleSilicon.zip` to your preferred folder (e.g., `Applications` or Desktop).
2. **Primary Method (Native Desktop App):**
   - Double-click **`Skazitel.app`**.
   - *First run note:* If macOS displays a gatekeeper warning about an unverified developer, go to *System Settings → Privacy & Security* and click *Open Anyway* (or right-click `Skazitel.app` and choose *Open*).
3. **Browser Method:**
   - Double-click **`Start-browser.command`** — this boots the local server and opens your browser at `http://localhost:47831`.

#### 🪟 On Windows:
1. Extract `Skazitel-v0.9.4-Windows.zip`.
2. Ensure Node.js is installed (`node -v` in terminal).
3. **Primary Method:**
   - Double-click **`Start-Windows.bat`**.
   - The launcher will verify the runtime, launch the local server, and open your default browser at `http://127.0.0.1:47831`.
4. **PowerShell Method:**
   - Open PowerShell in the project directory and run:
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\Start-Windows.ps1
     ```

---

### 3. Setup & Configuration

1. **Language Selection:**
   - Click the **`🌐 RU / EN`** button in the header bar to instantly toggle the entire UI, prompts, and DM personality between English and Russian.
2. **Starting an Adventure:**
   - Click **`Create Campaign ↗`** or **`＋ New Game`** in the sidebar.
   - Enter your campaign title, ruleset edition (D&D 2024 or 2014), and atmospheric setting description.
   - Or click **`Continue the Story of Theon and Alvari`** for a quick instant-start demo with pre-generated characters.
3. **Connecting AI Models & Audio:**
   - In the bottom-left sidebar, open **`⚙ Models & Voice`**;
   - **Game Master (DM):** choose your model provider (OpenAI `gpt-4o`, `gpt-4o-mini`, Google Gemini, or any OpenAI-compatible API);
   - **Speech-to-Text (STT):** select Groq (`whisper-large-v3-turbo`) or OpenAI Whisper;
   - **Audio Narration (TTS):** 
     - *OpenAI TTS* — rich barytone narrator voice `onyx` and expressive NPC voices `nova` / `echo`;
     - *Silero TTS* — 100% offline local neural voice (requires no API keys and no internet).
4. **API Key Security:**
   - On macOS, keys are stored securely in the system Keychain (`KeyStore.app`) and are never written to campaign save files or logs.

---

### 4. Gameplay & Tabletop Companion

1. **Voice Input (Push-to-Talk):**
   - Hold the **`Spacebar`** (outside text input fields) or click the microphone 🎙️ button, speak your hero's action, and release.
   - Roll real physical dice at your table and speak the result (e.g. *"natural 18"* or *"15 on the die"*).
2. **Tactical Map Window:**
   - Press the **`M`** key to toggle the Apple HIG floating tactical map. Drag the window by its glass header, resize with the corner grip, minimize to a pill badge 🟡, or dock it into the table with `◧ Dock`.
3. **Mobile LAN Companion for Players:**
   - Click the **`📱 Players (LAN)`** button in the top navigation bar;
   - Players at the table scan the QR code with their smartphones to open their personal character sheets, track HP, and manage inventory in real time without installing any apps.

---

### 5. Data Privacy & Local Saves

- All campaign chronicles, character sheets, AI-generated portraits, and diary entries are saved **strictly locally** inside the `Saves/` folder (`campaigns.sqlite` database).
- No game content or private data is ever sent to external cloud storage.
