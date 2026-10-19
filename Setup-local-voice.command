#!/bin/zsh
set -eu
TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_PYTHON="${SKAZITEL_PYTHON:-}"
if [[ -z "$TASK_PYTHON" ]]; then
  for TASK_CANDIDATE in python3.12 python3.13 python3.11 python3; do
    if command -v "$TASK_CANDIDATE" >/dev/null 2>&1; then TASK_PYTHON="$(command -v "$TASK_CANDIDATE")"; break; fi
  done
fi
if [[ -z "$TASK_PYTHON" ]]; then echo "Нужен Python 3.11–3.13. Укажите SKAZITEL_PYTHON=/путь/к/python3."; exit 1; fi
mkdir -p "$TASK_DIR/LocalVoice/models"
"$TASK_PYTHON" -m venv "$TASK_DIR/LocalVoice/venv"
"$TASK_DIR/LocalVoice/venv/bin/python" -m pip install 'torch==2.14.1' 'num2words==0.5.14' 'numpy==2.5.4'
if [[ ! -f "$TASK_DIR/LocalVoice/models/silero-ru.pt" ]]; then
  curl --fail --location --retry 2 https://models.silero.ai/models/tts/ru/v5_6_ru.pt --output "$TASK_DIR/LocalVoice/models/silero-ru.pt.part"
  mv "$TASK_DIR/LocalVoice/models/silero-ru.pt.part" "$TASK_DIR/LocalVoice/models/silero-ru.pt"
fi
curl --fail --location --silent --show-error https://raw.githubusercontent.com/snakers4/silero-models/master/LICENSE --output "$TASK_DIR/LocalVoice/Silero-LICENSE.txt"
echo "Готово. Перезапустите Сказитель и выберите озвучивание Silero."
