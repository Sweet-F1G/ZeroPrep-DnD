# ZeroPrep-DnD · v0.9.4

> **[English](./README.md)** | **[Русский](./README.ru.md)**

A privacy-first, self-hosted AI Dungeon Master for genuine tabletop D&D 2024 & 5e. Cross-platform application for macOS (Apple Silicon) and Windows 10/11, combining cinematic AI narration, physical dice rolling, local computer vision on the Apple Neural Engine, low-latency multi-voice streaming TTS, tactile battle maps, and a zero-install LAN companion for players' smartphones.

**Flagship Release v0.9.4 (Local Table Vision · Apple Neural Engine):** 100% private and free computer vision via Apple's native Vision framework. Detects player count, smiles, laughter, suspense, and smartphone distraction right on the Mac chip with zero API tokens; hybrid action & background monitoring; compact 👁️ "Table Vision" HUD preview, and dynamic system prompt adaptation. [Read Release Notes](RELEASE-0.9.4.md).

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
1. **Desktop App:** Double-click `Skazitel.app` (or the desktop shortcut).
2. **Alternative Launcher:**
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

## ⚙️ Supported AI Providers & Models

| Provider | Primary & Recommended Models | Key Features |
| :--- | :--- | :--- |
| **OpenAI** | **`gpt-6-luna`** *(default)*, `gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`<br>• Classic: `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `o1`<br>• Voice & Vision: `tts-1` (`onyx`, `fable`, `nova`, `echo`), `gpt-4o-mini-transcribe`, `gpt-live-1`, `gpt-image-2` | Responses API, 3-tier prompt caching (~87% hit rate, \$0.01/1M cache read), structured JSON game protocol, dynamic `reasoning_effort` boost during Session Zero |
| **Groq** | **`openai/gpt-oss-120b`**, **`whisper-large-v3-turbo`** | Ultra-fast text generation & sub-second voice transcription with Free & Paid billing tiers |
| **Google Gemini** | **`gemini-2.0-flash`**, `gemini-1.5-pro` | Ultra-low latency, multimodal comprehension, large context window |
| **OpenRouter & Local** | **`google/gemma-4-31b-it:free`** *(zero-cost fallback)*<br>• Local: Ollama, LM Studio, vLLM, DeepSeek, Mistral, Qwen | Automatic failover to free reserve models on quota limits; full OpenAI-compatible endpoint support |

---

## 📚 Guides & Documentation

- **[Installation & User Guide](INSTALL-GUIDE.md)** — Step-by-step setup, model connection, physical dice rules, and gameplay instructions.
- **[Release Notes (v0.9.4)](RELEASE-0.9.4.md)** — Highlights of the flagship release (Table Vision, Living DM, Multi-Voice TTS).
- **[Russian Guide / Инструкция на русском](README.ru.md)** — Полное руководство на русском языке.

---

## 📜 License & Acknowledgments

* Licensed under the [MIT License](LICENSE).
* Game mechanics conform to D&D 5th Edition System Reference Document (SRD 5.1 & SRD 5.2.1).
* Built with native Web Components, Apple Vision framework, and Node.js.
