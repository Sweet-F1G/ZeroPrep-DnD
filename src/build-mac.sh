#!/bin/zsh
set -eu
TASK_SRC="$(cd "$(dirname "$0")" && pwd)"
TASK_OUT="$(dirname "$TASK_SRC")"
TASK_STAGE="$(mktemp -d /private/tmp/skazitel-build.XXXXXX)"
TASK_APP="$TASK_STAGE/Skazitel.app"
TASK_CACHE="${SKAZITEL_BUILD_CACHE:-/private/tmp/skazitel-swift-cache}"
mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources/src" "$TASK_CACHE"
cat "$TASK_SRC/Keychain.swift" "$TASK_SRC/MacApp.swift" > "$TASK_STAGE/main.swift"
swiftc -O -target arm64-apple-macos14.0 -module-cache-path "$TASK_CACHE" "$TASK_STAGE/main.swift" -o "$TASK_APP/Contents/MacOS/Skazitel" -framework Cocoa -framework WebKit -framework AVFoundation -framework CFNetwork -framework Security
NODE_BIN="${SKAZITEL_NODE:-$(command -v node 2>/dev/null || echo "$TASK_OUT/Skazitel.app/Contents/Resources/node")}"
if [[ ! -x "$NODE_BIN" ]] || (( $("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])') < 24 )); then
  echo 'Требуется автономный Node.js 24+ для macOS ARM64; укажите путь через SKAZITEL_NODE.' >&2
  exit 1
fi
if otool -L "$NODE_BIN" | tail -n +2 | grep -Eq '@rpath/|/opt/homebrew/|/usr/local/'; then
  echo 'Node.js зависит от внешних библиотек. Укажите официальный автономный бинарник через SKAZITEL_NODE.' >&2
  exit 1
fi
cp -X "$NODE_BIN" "$TASK_APP/Contents/Resources/node"
install_name_tool -add_rpath /opt/homebrew/lib "$TASK_APP/Contents/Resources/node" 2>/dev/null || true
install_name_tool -add_rpath /usr/local/lib "$TASK_APP/Contents/Resources/node" 2>/dev/null || true
for TASK_FILE in server.mjs audio-stream.mjs response-stream.mjs maps.mjs openai-context.mjs cost.mjs progression.mjs dm-state.mjs illustrations.mjs rules.mjs memory.mjs inventory.mjs actions.mjs prompts.mjs scenarios.mjs campaign-store.mjs engine.mjs session-zero.mjs providers.mjs credentials.mjs usage.mjs context.mjs delivery.mjs local-voice.mjs edge-voice.mjs edge-worker.py silero-worker.py voice_text.py package.json; do
  cp -X "$TASK_SRC/$TASK_FILE" "$TASK_APP/Contents/Resources/src/$TASK_FILE"
done
cp -RX "$TASK_SRC/public" "$TASK_APP/Contents/Resources/src/"
cp -RX "$TASK_SRC/seed" "$TASK_APP/Contents/Resources/src/"
cp -X "$TASK_SRC/assets/Skazitel.icns" "$TASK_APP/Contents/Resources/Skazitel.icns"
swiftc -O -target arm64-apple-macos14.0 -module-cache-path "$TASK_CACHE" "$TASK_SRC/VisionHelper.swift" -o "$TASK_APP/Contents/Resources/VisionHelper" -framework Vision -framework AppKit
cp -X "$TASK_APP/Contents/Resources/VisionHelper" "$TASK_SRC/VisionHelper"
# Keep the credential reader's signed identity stable unless Keychain.swift changes.
if [[ -d "$TASK_OUT/Skazitel.app/Contents/Resources/KeyStore.app" && "$TASK_OUT/Skazitel.app/Contents/Resources/KeyStore.app/Contents/MacOS/Skazitel" -nt "$TASK_SRC/Keychain.swift" ]]; then
  ditto --norsrc --noextattr "$TASK_OUT/Skazitel.app/Contents/Resources/KeyStore.app" "$TASK_APP/Contents/Resources/KeyStore.app"
else
  TASK_KEYSTORE="$TASK_APP/Contents/Resources/KeyStore.app"
  mkdir -p "$TASK_KEYSTORE/Contents/MacOS"
  cat "$TASK_SRC/Keychain.swift" > "$TASK_STAGE/key-store-main.swift"
  echo 'if !handleCredentialCommand() { exit(1) }' >> "$TASK_STAGE/key-store-main.swift"
  mkdir -p "$TASK_STAGE/key-store-build"
  cp -X "$TASK_STAGE/key-store-main.swift" "$TASK_STAGE/key-store-build/main.swift"
  swiftc -O -target arm64-apple-macos14.0 -module-cache-path "$TASK_CACHE" "$TASK_STAGE/key-store-build/main.swift" -o "$TASK_KEYSTORE/Contents/MacOS/Skazitel" -framework Security
  cat > "$TASK_KEYSTORE/Contents/Info.plist" <<'KEYSTORE'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Skazitel</string><key>CFBundleIdentifier</key><string>local.skazitel.key-store</string><key>CFBundleName</key><string>Сказитель — ключи</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>
KEYSTORE
  codesign --force --sign - "$TASK_KEYSTORE"
fi
cat > "$TASK_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Skazitel</string>
<key>CFBundleIdentifier</key><string>local.skazitel.demo</string>
<key>CFBundleName</key><string>Сказитель</string>
<key>CFBundleDisplayName</key><string>Сказитель</string>
<key>CFBundleIconFile</key><string>Skazitel.icns</string>
<key>CFBundleVersion</key><string>25</string>
<key>CFBundleShortVersionString</key><string>0.9.5</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSCameraUsageDescription</key><string>Мастер наблюдает за эмоциями, взглядами и вовлечённостью игроков за столом.</string>
<key>NSMicrophoneUsageDescription</key><string>Распознавать игровые реплики: по кнопке или при включённом постоянном прослушивании.</string>
<key>NSDocumentsFolderUsageDescription</key><string>Сказителю нужен доступ к папке сохранений и локальным моделям голоса.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
chmod -R u+w "$TASK_APP"
chmod +x "$TASK_APP/Contents/MacOS/Skazitel" "$TASK_APP/Contents/Resources/node" "$TASK_APP/Contents/Resources/VisionHelper"
dot_clean "$TASK_APP" 2>/dev/null || true
xattr -cr "$TASK_APP" 2>/dev/null || true
xattr -dr com.apple.FinderInfo "$TASK_APP" 2>/dev/null || true
codesign --force --sign - "$TASK_APP/Contents/Resources/node"
codesign --force --sign - "$TASK_APP/Contents/Resources/VisionHelper"
codesign --force --sign - "$TASK_APP"
codesign --verify --deep --strict "$TASK_APP"
rm -rf "$TASK_OUT/Skazitel.app"
ditto --norsrc --noextattr "$TASK_APP" "$TASK_OUT/Skazitel.app"
dot_clean "$TASK_OUT/Skazitel.app" 2>/dev/null || true
xattr -cr "$TASK_OUT/Skazitel.app" 2>/dev/null || true
xattr -d com.apple.FinderInfo "$TASK_OUT/Skazitel.app/Contents/Resources/KeyStore.app" 2>/dev/null || true
xattr -d com.apple.FinderInfo "$TASK_OUT/Skazitel.app" 2>/dev/null || true
if ! codesign --verify --deep --strict "$TASK_OUT/Skazitel.app" 2>/dev/null; then
  echo 'Примечание: облачная папка добавила служебные атрибуты Finder. Для переносимого архива запустите src/package-release.py; он проверит подпись в локальной временной папке.' >&2
fi
echo "Готово: $TASK_OUT/Skazitel.app"
