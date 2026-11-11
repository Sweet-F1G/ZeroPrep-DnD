# Installation & User Guide / Руководство по установке

<div align="center">

[🇬🇧 English](#-english) | [🇷🇺 Русский](#-русский)

</div>

---

## 🇬🇧 English

### 1. System Requirements

#### 🍏 macOS:
- Mac computer with **Apple Silicon** (M1, M2, M3, M4 or newer);
- Operating System: **macOS 14 (Sonoma)** or **macOS 15 (Sequoia)**;
- No extra dependencies or Node.js required — the complete runtime is embedded inside `Skazitel.app`.

#### 🪟 Windows:
- Operating System: **Windows 10** or **Windows 11** (64-bit);
- **Node.js 24 LTS** or newer installed ([download from nodejs.org](https://nodejs.org/)).

---

### 2. How to Launch

#### 📦 Method A: From Release Binary (.zip)
- **macOS:** Download `ZeroPrep-DnD-v0.9.5-macOS-AppleSilicon.zip` from [GitHub Releases](https://github.com/Sweet-F1G/ZeroPrep-DnD/releases), unzip, and launch `Skazitel.app` (or run `./Start-browser.command`).
- **Windows:** Download `ZeroPrep-DnD-v0.9.5-Windows.zip` from [GitHub Releases](https://github.com/Sweet-F1G/ZeroPrep-DnD/releases), unzip, and double-click `Start-Windows.bat` (requires [Node.js 24+](https://nodejs.org/)).

#### 💻 Method B: Directly from Cloned Repository (`git clone`)
1. Clone the repository:
   ```bash
   git clone https://github.com/Sweet-F1G/ZeroPrep-DnD.git
   cd ZeroPrep-DnD
   ```
2. Launch the application:
   - **macOS:** Double-click `Start-browser.command` or run `node src/server.mjs`.
   - **Windows:** Double-click `Start-Windows.bat` or run `powershell -ExecutionPolicy Bypass -File .\Start-Windows.ps1`.
3. Open your browser at **`http://127.0.0.1:47831`**.

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
   - **Game Master (DM):** choose your model provider (OpenAI `gpt-6-luna` default, `gpt-6.1-terra`, `gpt-4o`, Groq `openai/gpt-oss-120b`, Google Gemini `gemini-2.0-flash`, or any OpenAI-compatible API);
   - **Speech-to-Text (STT):** select Groq (`whisper-large-v3-turbo`) or OpenAI Whisper;
   - **Audio Narration (TTS):** 
     - *OpenAI TTS* — rich baritone narrator voice `onyx` and expressive NPC voices `nova` / `echo`;
     - *Silero TTS* — 100% offline local neural voice (requires no API keys and no internet).
4. **API Key Security:**
   - On macOS, keys are stored securely in the system Keychain (`KeyStore.app`) and are never written to campaign save files or logs.

---

### 4. Gameplay & Tabletop Companion

1. **Voice Input (Push-to-Talk):**
   - Hold the **`Spacebar`** (outside text input fields) or click the microphone 🎙️ button, speak your hero's action, and release.
   - Roll real physical dice at your table and speak the result (e.g. *"natural 18"* or *"15 on the die"*).
2. **👁️ Table Vision (Apple Neural Engine):**
   - On macOS, click the eye icon 👁️ in the composer bar to open the Vision HUD preview. The DM automatically perceives player headcount, attention, laughter, and smartphone distraction locally with zero cloud tokens.
3. **Tactical Map Window:**
   - Press the **`M`** key to toggle the Apple HIG floating tactical map. Drag the window by its glass header, resize with the corner grip, minimize to a pill badge 🟡, or dock it into the table with `◧ Dock`.
4. **Mobile LAN Companion for Players:**
   - Click the **`📱 Players (LAN)`** button in the top navigation bar;
   - Players at the table scan the QR code with their smartphones to open their personal character sheets, track HP, and manage inventory in real time without installing any apps.

---

### 5. Data Privacy & Local Saves

- All campaign chronicles, character sheets, AI-generated portraits, and diary entries are saved **strictly locally** inside the `Saves/` folder (`campaigns.sqlite` database).
- No game content or private data is ever sent to external cloud storage.

---

<br>

---

## 🇷🇺 Русский

### 1. Системные требования

#### 🍏 macOS:
- Компьютер Mac на базе **Apple Silicon** (M1, M2, M3, M4 или новее);
- Версия операционной системы: **macOS 14 (Sonoma)** или **macOS 15 (Sequoia)**;
- Установка дополнительных программ или Node.js **не требуется** — исполняемый рантайм уже встроен внутрь `Skazitel.app`.

#### 🪟 Windows:
- Операционная система: **Windows 10** или **Windows 11** (64-bit);
- Установленный **Node.js 24 LTS** или новее ([скачать с официального сайта nodejs.org](https://nodejs.org/)).

---

### 2. Запуск приложения

#### 📦 Способ А: Из архива релиза (.zip)
- **macOS:** Скачайте `ZeroPrep-DnD-v0.9.5-macOS-AppleSilicon.zip` со страницы [GitHub Releases](https://github.com/Sweet-F1G/ZeroPrep-DnD/releases), распакуйте и запустите `Skazitel.app` (или скрипт `./Start-browser.command`).
- **Windows:** Скачайте `ZeroPrep-DnD-v0.9.5-Windows.zip` со страницы [GitHub Releases](https://github.com/Sweet-F1G/ZeroPrep-DnD/releases), распакуйте и запустите `Start-Windows.bat` (требуется [Node.js 24+](https://nodejs.org/)).

#### 💻 Способ Б: Напрямую из клонированного репозитория (`git clone`)
1. Склонируйте репозиторий:
   ```bash
   git clone https://github.com/Sweet-F1G/ZeroPrep-DnD.git
   cd ZeroPrep-DnD
   ```
2. Запустите сервер:
   - **macOS:** Запустите `./Start-browser.command` или выполните команду `node src/server.mjs`.
   - **Windows:** Запустите `Start-Windows.bat` или выполните в PowerShell: `powershell -ExecutionPolicy Bypass -File .\Start-Windows.ps1`.
3. Откройте браузер по адресу **`http://127.0.0.1:47831`**.

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
   - **Ведущий:** выберите провайдера модели (OpenAI `gpt-6-luna` по умолчанию, `gpt-6.1-terra`, `gpt-4o`, Groq `openai/gpt-oss-120b`, Google Gemini `gemini-2.0-flash` или любой совместимый OpenAI-сервер);
   - **Распознавание речи (STT):** выберите Groq (`whisper-large-v3-turbo`) или OpenAI Whisper;
   - **Озвучивание (TTS):** 
     - *OpenAI TTS* — кинематографичный баритон Мастера `onyx` и выразительные голоса NPC `nova` / `echo`;
     - *Silero TTS* — полностью автономный синтез, работающий локально без интернета и без API-ключей.
4. **Безопасность API-ключей:**
   - На macOS API-ключи сохраняются в системной Связке ключей (`KeyStore.app`) и никогда не попадают в сохранения кампаний или логи.

---

### 4. Игра за столом и мобильный компаньон

1. **Голосовой ввод:**
   - Удерживайте клавишу **`Пробел`** (вне текстовых полей) или кнопку микрофона 🎙️, произнесите действие своего героя и отпустите.
   - При бросках кубиков бросайте настоящие физические кости и назовите число вслух (например: *«на кубике 15»*).
2. **👁️ Зрение стола (Apple Neural Engine):**
   - Нажмите на индикатор 👁️ в строке ввода, чтобы открыть HUD предварительного просмотра. Мастер отслеживает количество игроков, эмоции, внимание и залипание в телефоны локально на чипе Mac без расхода токенов.
3. **Тактическая карта:**
   - Нажмите клавишу **`M`** (или русскую `ь`) для открытия плавающего тактического окна Apple HIG. Окно можно свободно перетаскивать, менять размер, сворачивать в пилюлю 🟡 или встраивать в стол кнопкой `◧ Встроить`.
4. **Подключение игроков со смартфонов (LAN Companion):**
   - Нажмите кнопку **`📱 Игроки (LAN)`** в верхней панели;
   - Игроки за столом сканируют QR-код камерой телефона и подключаются к партии без установки приложений.
