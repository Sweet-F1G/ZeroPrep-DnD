#!/bin/zsh
set -eu
TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_NODE="$TASK_DIR/Skazitel.app/Contents/Resources/node"
if [[ ! -x "$TASK_NODE" ]]; then TASK_NODE="$(command -v node)"; fi
export SKAZITEL_DATA="$TASK_DIR/Saves"
export SKAZITEL_VOICE_DIR="$TASK_DIR/LocalVoice"
export PORT=47831
echo "Откройте http://127.0.0.1:47831 в Chrome. Закройте это окно, чтобы остановить сервер."
exec "$TASK_NODE" "$TASK_DIR/src/server.mjs"
