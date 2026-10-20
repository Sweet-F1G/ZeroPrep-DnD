#!/bin/zsh
set -eu
TASK_SRC="$(cd "$(dirname "$0")" && pwd)"
TASK_OUT="$(dirname "$TASK_SRC")"
TASK_STAGE="$(mktemp -d /private/tmp/skazitel-build.XXXXXX)"
TASK_APP="$TASK_STAGE/Skazitel.app"
TASK_CACHE="${SKAZITEL_BUILD_CACHE:-/private/tmp/skazitel-swift-cache}"
mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources/src" "$TASK_CACHE"
cat "$TASK_SRC/Keychain.swift" "$TASK_SRC/MacApp.swift" > "$TASK_STAGE/main.swift"
swiftc -O -module-cache-path "$TASK_CACHE" "$TASK_STAGE/main.swift" -o "$TASK_APP/Contents/MacOS/Skazitel" -framework Cocoa -framework WebKit -framework AVFoundation -framework CFNetwork -framework Security
NODE_BIN="${SKAZITEL_NODE:-$(command -v node 2>/dev/null || echo "$TASK_OUT/Skazitel.app/Contents/Resources/node")}"
cp -X "$NODE_BIN" "$TASK_APP/Contents/Resources/node"
install_name_tool -add_rpath /opt/homebrew/lib "$TASK_APP/Contents/Resources/node" 2>/dev/null || true
install_name_tool -add_rpath /usr/local/lib "$TASK_APP/Contents/Resources/node" 2>/dev/null || true
for TASK_FILE in server.mjs audio-stream.mjs response-stream.mjs maps.mjs openai-context.mjs cost.mjs progression.mjs dm-state.mjs illustrations.mjs rules.mjs memory.mjs inventory.mjs actions.mjs prompts.mjs campaign-store.mjs engine.mjs session-zero.mjs providers.mjs credentials.mjs usage.mjs context.mjs delivery.mjs local-voice.mjs edge-voice.mjs edge-worker.py silero-worker.py voice_text.py package.json; do
  cp -X "$TASK_SRC/$TASK_FILE" "$TASK_APP/Contents/Resources/src/$TASK_FILE"
done
cp -RX "$TASK_SRC/public" "$TASK_APP/Contents/Resources/src/"
cp -RX "$TASK_SRC/seed" "$TASK_APP/Contents/Resources/src/"
cp -X "$TASK_SRC/assets/Skazitel.icns" "$TASK_APP/Contents/Resources/Skazitel.icns"
# Keep the credential reader's signed identity stable when UI/resources change.
if [[ -d "$TASK_OUT/Skazitel.app/Contents/Resources/KeyStore.app" ]]; then
  ditto --norsrc --noextattr "$TASK_OUT/Skazitel.app/Contents/Resources/KeyStore.app" "$TASK_APP/Contents/Resources/KeyStore.app"
else
  TASK_KEYSTORE="$TASK_APP/Contents/Resources/KeyStore.app"
  mkdir -p "$TASK_KEYSTORE/Contents/MacOS"
  cat "$TASK_SRC/Keychain.swift" > "$TASK_STAGE/key-store-main.swift"
  echo 'if !handleCredentialCommand() { exit(1) }' >> "$TASK_STAGE/key-store-main.swift"
  mkdir -p "$TASK_STAGE/key-store-build"
  cp -X "$TASK_STAGE/key-store-main.swift" "$TASK_STAGE/key-store-build/main.swift"
  swiftc -O -module-cache-path "$TASK_CACHE" "$TASK_STAGE/key-store-build/main.swift" -o "$TASK_KEYSTORE/Contents/MacOS/Skazitel" -framework Security
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
<key>CFBundleVersion</key><string>11</string>
<key>CFBundleShortVersionString</key><string>0.6.3</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSMicrophoneUsageDescription</key><string>Распознавать игровые реплики: по кнопке или при включённом постоянном прослушивании.</string>
<key>NSDocumentsFolderUsageDescription</key><string>Сказителю нужен доступ к папке сохранений и локальным моделям голоса.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
chmod -R u+w "$TASK_APP"
chmod +x "$TASK_APP/Contents/MacOS/Skazitel" "$TASK_APP/Contents/Resources/node"
xattr -cr "$TASK_APP" 2>/dev/null || true
codesign --force --sign - "$TASK_APP/Contents/Resources/node"
codesign --force --sign - "$TASK_APP"
codesign --verify --deep --strict "$TASK_APP"
rm -rf "$TASK_OUT/Skazitel.app"
ditto --norsrc --noextattr "$TASK_APP" "$TASK_OUT/Skazitel.app"
xattr -cr "$TASK_OUT/Skazitel.app" 2>/dev/null || true
codesign --force --sign - "$TASK_OUT/Skazitel.app/Contents/Resources/node"
codesign --force --sign - "$TASK_OUT/Skazitel.app"
echo "Готово: $TASK_OUT/Skazitel.app"
