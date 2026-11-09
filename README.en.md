# Skazitel (Сказитель) · v0.9.4

> **[English](./README.en.md)** | **[Русский](./README.md)**

An atmospheric tabletop roleplaying AI Dungeon Master application for macOS (Apple Silicon) and Windows 10/11. Designed for genuine tabletop sessions, combining cinematic narration, physical dice rolling, local computer vision on the Apple Neural Engine, low-latency streaming TTS, tactile battle maps, and a zero-install LAN companion for smartphones.

---

## 🌟 Key Capabilities

### 1. 👁️ Local Table Vision (100% Private, 0 Tokens, Apple Neural Engine / MediaPipe)
* **Real-time table observation:** Detects player count, active speakers, engagement, laughter, yawns, and smartphone distraction.
* **Micro-expression recognition:** Action-unit tracking for eye aspect ratio (EAR), inner-lip aperture (speaking vs silence), genuine smiles (zygomaticus lift), brow furrowing (suspense before rolls), and raised eyebrows (shock / surprise).
* **Zero network latency & total privacy:** Runs 100% locally on device hardware (Apple Neural Engine on macOS, MediaPipe/OpenCV on Windows) in ~18 ms with 0% CPU overhead. Video frames never leave your local machine.

### 2. 🎭 Living DM & Dynamic Session Zero
* **Authentic Master Personalities:** Choose between *Fair Realist with a Dreamer's Spark* (Rule of Cool with firm boundaries), *Dry Tabletop Veteran*, *Grimdark Realist*, *Epic Chronicler*, or customize your own DM traits.
* **Firm Boundaries & Tactile Agency:** The Master can say a firm "No" to mechanical abuse, rewards creative improvisation, and makes behind-the-screen quips.
* **Dynamic Session Zero:** Deep reasoning (`reasoning_effort: high`) during world-building, tailoring adventures and NPC arcs to player desires.

### 3. 🎙️ Cinematic Multi-Voice TTS (OpenAI TTS Engine)
* **Flagship Neural Voice Pipeline:** Powered by OpenAI TTS (`tts-1`) with dynamic character acting and multi-voice dialogue routing:
  * Dungeon Master narration: deep velvet baritone (**`Onyx`**) or classic storyteller (**`Fable`**);
  * Female NPCs and witches: expressive (**`Nova`**) and soft (**`Shimmer`**);
  * Young rogues and bards: agile (**`Echo`**).
* **Instant Streaming Narration:** First audio bytes play within 250–350 ms via streamed SSE tickets.
* **Smart Diction & Intonation:** Strip technical prefixes (`[Hero]: ` is never read aloud), normalize dice formulas (`1d20+4` → *"one d twenty plus four"*), auto-stress accents, and natural pause punctuation.
* **Alternative Engines:** ElevenLabs (`Eleven Flash v2.5`), local offline Silero TTS, or system voices.

### 4. 🗺️ Tactical Display & Fog of War
* **Draggable Tactical HUD:** Resizable floating window with grid coordinates, marker tokens, line-of-sight fog of war, and ambient soundtrack player (camp, tavern, battle, dungeon, forest, rain, mystery).
* **Physical Dice Resolving:** You roll real physical dice on your table; the DM validates modifiers, DC checks, and critical rolls atomically.

### 5. 📱 Zero-Install Mobile LAN Companion
* Players on the same Wi-Fi network scan a QR code to access their mobile character sheet:
  * Live HP tracking, physical roll submission, character inventory, and push-to-talk microphone.
  * **Strict Security Isolation:** Mobile players cannot access API keys, server settings, or private notes.

---

## 🚀 Quickstart

### 🍏 macOS (Apple Silicon M1/M2/M3/M4)
1. **Desktop App:** Double-click `Skazitel.app` (or the `Сказитель` desktop shortcut).
2. **Terminal:**
   ```bash
   ./Start-browser.command
   ```
   Opens your browser at `http://localhost:47831`.

### 🪟 Windows (10 / 11)
1. **One-Click Batch File:**
   Double-click `Start-Windows.bat`.
   * Requires [Node.js 20+](https://nodejs.org/).
   * Opens automatically at `http://127.0.0.1:47831`.
2. **Optional Computer Vision on Windows:**
   ```cmd
   pip install mediapipe opencv-python
   ```

---

## 🛡️ Security & Privacy Architecture

* **100% Local Storage:** All campaign journals, character sheets, and maps are stored in local SQLite databases in `./Saves/`.
* **Zero Telemetry / Zero Tracking:** No third-party analytics, no tracking pixels, no telemetry beacons.
* **Token-Guarded API:** Administrative endpoints (`/api/settings`, `/api/keys`, `/api/export`) require a cryptographically generated 256-bit session token accessible only on `localhost`.
* **Private Mobile Bridge:** Player companion tokens are scoped strictly to player actions; they cannot mutate server settings or inspect credentials.
* **Safe for Redistribution:** The repository contains zero hardcoded absolute paths, zero private keys, and zero device identifiers.

---

## ⚙️ Supported AI Providers

| Provider | Supported Models | Key Features |
| :--- | :--- | :--- |
| **OpenAI** | `gpt-4o`, `o1`, `o3-mini`, `gpt-4o-mini` | Prompt caching (~87% hit rate), Responses API, structured JSON |
| **Google Gemini** | `gemini-1.5-pro`, `gemini-2.0-flash` | Ultra-long context, multimodal visual cues |
| **Groq** | `llama-3.3-70b-versatile`, `whisper-large-v3-turbo` | Ultra-fast text generation & instantaneous voice transcription |
| **OpenRouter / Local** | Gemma, Mistral, Qwen, DeepSeek, Ollama, LM Studio | Full OpenAI-compatible base URL support |

---

## 📜 License & Acknowledgments

* Game mechanics conform to D&D 5th Edition System Reference Document (SRD 5.1 & SRD 5.2.1).
* Built with native Web Components, Apple Vision framework, and Node.js.
