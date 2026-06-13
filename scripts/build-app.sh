#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/apps/toby-app"
DIST="$ROOT/dist"
APP="$DIST/Toby.app"
ARCH="${SWIFT_ARCH:-$(uname -m)}"

echo "Building toby-app (swift ${ARCH})..."
swift build -c release --arch "${ARCH}" --package-path "${PKG}"
BIN="$(
	swift build --show-bin-path -c release --arch "${ARCH}" --package-path "${PKG}"
)/toby-app"

rm -rf "${APP}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"

cat >"${APP}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>toby-app</string>
	<key>CFBundleIdentifier</key>
	<string>com.toby.app</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Toby</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

cp "${BIN}" "${APP}/Contents/MacOS/toby-app"
chmod +x "${APP}/Contents/MacOS/toby-app"
codesign -s - --force --deep "${APP}" >/dev/null 2>&1 || true

echo "Built ${APP}"
