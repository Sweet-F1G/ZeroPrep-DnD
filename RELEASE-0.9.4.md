# ZeroPrep-DnD v0.9.4 — Local Neural Vision & Flagship Bilingual Release

November 2026 update. The core milestone of this landmark release is granting the AI Dungeon Master real-time visual perception of the physical table—100% locally on Apple Neural Engine without external cloud services or token costs.

---

## 👁️ 1. Local Table Vision via Apple Vision Framework
- **Apple Neural Engine:** Video stream from your webcam is analyzed entirely on-device on Apple Silicon using native `Vision.framework` (`VisionHelper`).
- **What the DM Perceives:**
  - **Player Headcount:** Automatic detection and tracking of players at the table.
  - **Gaze Direction & Attention:** Recognizes whether players are looking at the table/screen or staring down at phones (`pitch < -0.20`).
  - **Facial Micro-Expressions:** Detects smiles, laughter, speech mouth aperture, and suspense/tension from facial landmark geometry.
- **100% Private & $0 Cost:** Processed in RAM on-device; video frames never touch the network. Zero tokens, zero API cost.

---

## ⏱️ 2. Hybrid DM Perception (Actions + Background Monitoring)
1. **Snapshots on Player Action:** Whenever a player holds Push-to-Talk or submits a turn, the app captures current table emotions so the DM knows who spoke and their emotional tone.
2. **Background Table Monitoring (Every 25s):** If a silence lingers or someone gets distracted by their phone, the DM weaves it naturally into the narrative (*"As the wizard stares blankly into space, a branch snaps ominously right behind him..."*).

---

## 🎙️ 3. Flagship OpenAI TTS Multi-Voice Narration
- **Cinematic Voice Acting:** Powered by OpenAI `tts-1` (`onyx`, `fable`, `nova`, `echo`).
- **Dynamic Character Routing:** Deep narrator baritone for the DM, expressive female voices for witches and priestesses, nimble voices for young rogues.
- **Natural Speech Polish:** Strips technical prefixes (`[Hero]: ` is never read aloud), normalizes dice formulas (`1d20+4` → *"one d twenty plus four"*), auto-stress accents, and natural pause punctuation.

---

## 🎛️ 4. Compact UI & Dynamic System Prompts
- **👁️ Table Vision Indicator:** Placed in the composer bar. Clicking it opens a live preview HUD with attention badges and manual snap trigger.
- **Dynamic Prompt Adaptation:** When Vision is toggled off, visual observation instructions are stripped from the model prompt completely, preventing hallucinations.

---

## 🇷🇺 Русская версия (Russian)

### 👁️ 1. Локальное зрение на базе Apple Vision Framework
- **Apple Neural Engine:** Анализ видеопотока веб-камеры выполняется нативно прямо на чипе Mac (Apple Silicon) через системный фреймворк `Vision.framework` (`VisionHelper`).
- **Что видит Мастер:** количество игроков, направление взгляда, залипание в телефоны, улыбки, смех, открытость рта и напряжение.
- **100% приватность:** Кадры видео обрабатываются локально и никуда не передаются. Стоимость обработки — $0.

### ⏱️ 2. Гибридный режим наблюдения (Действия + Фоновый мониторинг)
1. **Снимок при заявке:** фиксация эмоций говорящего игрока.
2. **Фоновый мониторинг (каждые 25 секунд):** реакция на заминки и отвлечения за столом.

### 🎙️ 3. Озвучка OpenAI TTS
- Ролевая многоголосица `onyx`, `nova`, `echo` с автоматической расстановкой ударений, вырезанием префиксов и разворотом формул кубиков.
