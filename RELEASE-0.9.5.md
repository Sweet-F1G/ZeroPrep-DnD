# ZeroPrep-DnD v0.9.5 — Scenario Starters, Hardened LAN Security & Initiative Overhaul

November 2026 update. This milestone focuses on campaign integrity, mobile companion security, tactile combat initiative, and rich story premises for Session Zero.

---

## 🌟 What's New in v0.9.5

### 1. 🗺️ Four Modular Adventure Starters
- Jump directly into rich, atmospheric adventures during Session Zero without preparation:
  - **Border Settlement:** A frontier refuge facing mysterious wilderness incursions;
  - **City Investigation:** High-stakes urban political conspiracy and hidden cults;
  - **Lighthouse Mystery:** Coastal enigma, storm-lashed ruins, and ancient maritime legends;
  - **Frontier Expedition:** Dangerous trek into forgotten, uncharted territory.
- Starters are fully customizable modular frameworks tailored by players during character creation.

### 2. 🎭 Refined Living DM Directives
- **Player Agency First:** Strict enforcement of player boundaries and narrative autonomy—the DM never overrides player decisions, thoughts, or emotions.
- **Fair Roll Stakes:** Clear explanation of difficulty and consequences *before* calling for a check; single failed checks never dead-end an investigation.
- **DM Secrets Protection:** World lore secrets, monster vulnerabilities, and GM notes are strictly preserved until discovered organically in play.

### 3. ⚔️ Tactile Initiative & Combat Overhaul
- **Physical Dice Support:** Players roll real d20s at the table and submit values verbally or via the companion.
- **Automated Combat Locking:** Prevents accidental double-triggering of active encounters and stops phantom adversary duplication.

### 4. 🛡️ Hardened LAN Companion Security & Privacy
- **Localhost Admin Gate:** Administrative server endpoints (`/api/settings`, `/api/export`, etc.) are strictly locked to `localhost`.
- **Server-Side Fog of War:** Hidden markers and fog tokens are sanitized before reaching mobile player devices.
- **Private Whispers:** Secret player-to-DM communications are delivered strictly to the sender and stripped from the shared table journal.
- **State Integrity:** Hardened concurrency handling to protect campaign save files from parallel write collisions.

### 5. 💚 Temporary HP & Responsive Hero Cards
- **Temporary HP Logic:** Accurately absorbs incoming damage before affecting base hit points, with full undo capability.
- **Adaptive Hero Grid:** Redesigned responsive layout with larger portraits, unified character sheet access, inventory, and progression tabs.

### 6. ⚡ Modern Node.js 24 LTS Architecture
- Tested and verified against Node.js 24+ LTS.

---

## 🇷🇺 Русская версия (Russian)

### 🌟 Что нового в версии 0.9.5

- **4 авторские стартовые заготовки:** Приграничное поселение, Городское расследование, Тайна маяка и Экспедиция. Готовые отправные точки для Session Zero, которые игроки могут свободно адаптировать.
- **Обновлённые директивы Мастера:** Приоритет свободы воли игроков, понятные ставки проверок кубиков, недопущение тупиков при провалах бросков и бережное сохранение тайн сюжета.
- **Улучшенная боевая инициатива:** Ввод реальных физических бросков d20 игроков или автобросок; защита от повторного старта боя и устранение ложного появления противников.
- **Усиленная безопасность LAN-компаньона:** Доступ к администрированию ограничен локальным хостом; туман войны фильтруется на сервере; шёпот игрока скрыт из общей хроники и виден только отправителю.
- **Временные HP и адаптивная сетка героев:** Временные очки здоровья корректно поглощают урон перед обычными HP; переработана сетка карточек персонажей с крупными портретами.
- **Поддержка Node.js 24 LTS:** Полная совместимость с актуальной веткой Node.js 24+.
