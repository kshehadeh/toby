#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/apps/toby-app"
DIST="$ROOT/dist"
ARCH="${SWIFT_ARCH:-$(uname -m)}"
APP_VARIANT="${TOBY_APP_VARIANT:-development}"
ICON_MASTER="$ROOT/images/512x512.png"
ICON_SRC="$ROOT/images/app-icon.png"
ENTITLEMENTS="$PKG/TobyApp.entitlements"

case "${APP_VARIANT}" in
	development)
		APP_DISPLAY_NAME="Toby (Dev)"
		APP_BUNDLE_ID="${TOBY_APP_BUNDLE_ID:-dev.karim.toby.app.dev}"
		;;
	production)
		APP_DISPLAY_NAME="Toby"
		APP_BUNDLE_ID="${TOBY_APP_BUNDLE_ID:-dev.karim.toby.app}"
		;;
	*)
		echo "Invalid TOBY_APP_VARIANT '${APP_VARIANT}'; expected development or production." >&2
		exit 1
		;;
esac

APP="$DIST/${APP_DISPLAY_NAME}.app"

resolve_code_sign_identity() {
	# If an explicit identity was provided, use it verbatim.
	if [[ -n "${TOBY_CODESIGN_IDENTITY:-}" ]]; then
		echo "${TOBY_CODESIGN_IDENTITY}"
		return
	fi

	# Production artifacts are re-signed by the release workflow, so ad-hoc is fine here.
	if [[ "${APP_VARIANT}" == "production" ]]; then
		echo "-"
		return
	fi

	# Development builds need a stable identity so macOS TCC permissions persist across rebuilds.
	if [[ "${TOBY_ALLOW_ADHOC_DEV_SIGNING:-0}" == "1" ]]; then
		echo "-"
		return
	fi

	local identity
	identity="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Apple Development/ { print $2; exit }')"
	if [[ -n "${identity}" ]]; then
		echo "${identity}"
		return
	fi

	identity="$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Developer ID Application/ { print $2; exit }')"
	if [[ -n "${identity}" ]]; then
		echo "${identity}"
		return
	fi

	# No stable identity found; signal the caller to fail the build.
	echo ""
}

CODE_SIGN_IDENTITY="$(resolve_code_sign_identity)"
if [[ -z "${CODE_SIGN_IDENTITY}" ]]; then
	echo "Development builds require a valid Apple Development code signing identity so macOS permissions persist across rebuilds." >&2
	echo "" >&2

	matching_identities="$(security find-identity -p codesigning 2>/dev/null | awk -F '"' '/Apple Development|Developer ID Application|Mac Developer/ { print $2 }' | sort -u)"
	if [[ -n "${matching_identities}" ]]; then
		echo "Found these matching certificates, but none are valid identities:" >&2
		while IFS= read -r line; do
			echo "  - $line" >&2
		done <<< "${matching_identities}"
		echo "" >&2
		echo "A certificate is only a valid signing identity when:" >&2
		echo "  1. its private key is present in the same keychain, and" >&2
		echo "  2. its trust chain (Apple Worldwide Developer Relations -> Apple Root CA) is valid." >&2
		echo "" >&2
		echo "If the private key is missing, the certificate was likely downloaded from the Apple Developer" >&2
		echo "portal but the private key was created on a different Mac. Generate a new CSR on this Mac and" >&2
		echo "request a new Apple Development certificate." >&2
		echo "" >&2
		echo "If the private key is present but the identity is still invalid, the Apple intermediate certificate" >&2
		echo "chain may be stale. Download the latest Apple Worldwide Developer Relations certificate from:" >&2
		echo "  https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer" >&2
		echo "and install it in Keychain Access (login keychain)." >&2
	else
		echo "No Apple Development or Developer ID Application certificates were found in your keychain." >&2
		echo "Create one at: https://developer.apple.com/account/resources/certificates/list" >&2
	fi

	echo "" >&2
	echo "Options:" >&2
	echo "  - Set TOBY_CODESIGN_IDENTITY to a valid Apple Development or Developer ID Application identity." >&2
	echo "  - Set TOBY_ALLOW_ADHOC_DEV_SIGNING=1 to build ad-hoc anyway (permissions will reset each rebuild)." >&2
	exit 1
fi

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

rm -rf "$DIST"/*.app
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
	<string>__TOBY_APP_BUNDLE_ID__</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleDisplayName</key>
	<string>__TOBY_APP_DISPLAY_NAME__</string>
	<key>CFBundleName</key>
	<string>__TOBY_APP_DISPLAY_NAME__</string>
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
	<key>NSCalendarsUsageDescription</key>
	<string>Toby reads and manages your calendars when you use Apple Calendar integration.</string>
	<key>NSCalendarsFullAccessUsageDescription</key>
	<string>Toby needs full calendar access to search, create, update, and delete events.</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>Toby records microphone audio when you use Record Audio.</string>
	<key>NSScreenCaptureUsageDescription</key>
	<string>Toby captures system audio for recordings when you use Record Audio.</string>
</dict>
</plist>
PLIST
python3 - "$APP/Contents/Info.plist" "$APP_BUNDLE_ID" "$APP_DISPLAY_NAME" <<'PY'
import pathlib
import sys
from xml.sax.saxutils import escape

path = pathlib.Path(sys.argv[1])
bundle_id = sys.argv[2]
display_name = sys.argv[3]
path.write_text(
	path.read_text()
	.replace("__TOBY_APP_BUNDLE_ID__", escape(bundle_id))
	.replace("__TOBY_APP_DISPLAY_NAME__", escape(display_name)),
	encoding="utf-8",
)
PY

cp "${BIN}" "${APP}/Contents/MacOS/toby-app"
chmod +x "${APP}/Contents/MacOS/toby-app"
build_app_icon
if [[ "${CODE_SIGN_IDENTITY}" == "-" ]]; then
	if codesign -s "${CODE_SIGN_IDENTITY}" --force --deep --entitlements "${ENTITLEMENTS}" "${APP}" >/dev/null 2>&1; then
		echo "Signed ${APP} with ad-hoc identity"
	else
		echo "Warning: ad-hoc codesign failed for ${APP}." >&2
		echo "The app was built, but macOS may ask for permissions again after rebuilds." >&2
	fi
else
	if codesign -s "${CODE_SIGN_IDENTITY}" --force --deep --entitlements "${ENTITLEMENTS}" "${APP}" >/dev/null 2>&1; then
		echo "Signed ${APP} with ${CODE_SIGN_IDENTITY}"
	else
		echo "Error: codesign failed for identity '${CODE_SIGN_IDENTITY}'." >&2
		echo "The app was built unsigned." >&2
		exit 1
	fi
fi

echo "Built ${APP} as ${APP_DISPLAY_NAME} (${APP_VARIANT})"
