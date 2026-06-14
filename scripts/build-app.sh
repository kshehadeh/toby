#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/apps/toby-app"
DIST="$ROOT/dist"
APP="$DIST/Toby.app"
ARCH="${SWIFT_ARCH:-$(uname -m)}"
ICON_MASTER="$ROOT/images/512x512.png"
ICON_SRC="$ROOT/images/app-icon.png"

prepare_app_icon_source() {
	if [[ -f "${ICON_SRC}" ]]; then
		return
	fi
	if [[ ! -f "${ICON_MASTER}" ]]; then
		echo "Missing icon source: ${ICON_MASTER}" >&2
		exit 1
	fi
	if ! command -v magick >/dev/null 2>&1; then
		echo "ImageMagick (magick) is required to generate ${ICON_SRC}." >&2
		exit 1
	fi
	echo "Generating app icon from ${ICON_MASTER}…"
	# Flatten the speech-bubble portrait onto a white square canvas.
	magick "${ICON_MASTER}" \
		-trim +repage \
		-background white -alpha remove -alpha off \
		-resize 820x820 \
		-background white -gravity center -extent 1024x1024 \
		"${ICON_SRC}"
}

build_app_icon() {
	prepare_app_icon_source
	local iconset icns
	iconset="$(mktemp -d)/AppIcon.iconset"
	icns="$(mktemp -t toby-app-icon).icns"
	mkdir -p "${iconset}"

	sips -z 16 16 "${ICON_SRC}" --out "${iconset}/icon_16x16.png" >/dev/null
	sips -z 32 32 "${ICON_SRC}" --out "${iconset}/icon_16x16@2x.png" >/dev/null
	sips -z 32 32 "${ICON_SRC}" --out "${iconset}/icon_32x32.png" >/dev/null
	sips -z 64 64 "${ICON_SRC}" --out "${iconset}/icon_32x32@2x.png" >/dev/null
	sips -z 128 128 "${ICON_SRC}" --out "${iconset}/icon_128x128.png" >/dev/null
	sips -z 256 256 "${ICON_SRC}" --out "${iconset}/icon_128x128@2x.png" >/dev/null
	sips -z 256 256 "${ICON_SRC}" --out "${iconset}/icon_256x256.png" >/dev/null
	sips -z 512 512 "${ICON_SRC}" --out "${iconset}/icon_256x256@2x.png" >/dev/null
	sips -z 512 512 "${ICON_SRC}" --out "${iconset}/icon_512x512.png" >/dev/null
	sips -z 1024 1024 "${ICON_SRC}" --out "${iconset}/icon_512x512@2x.png" >/dev/null

	iconutil -c icns "${iconset}" -o "${icns}"
	cp "${icns}" "${APP}/Contents/Resources/AppIcon.icns"
	rm -f "${icns}"
}

if [[ ! -f "${ICON_SRC}" && ! -f "${ICON_MASTER}" ]]; then
	echo "Missing app icon source: ${ICON_SRC} or ${ICON_MASTER}" >&2
	exit 1
fi

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
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
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
build_app_icon
codesign -s - --force --deep "${APP}" >/dev/null 2>&1 || true

echo "Built ${APP}"
