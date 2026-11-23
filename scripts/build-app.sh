#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/apps/toby-app"
DIST="$ROOT/dist"
ARCH="${SWIFT_ARCH:-$(uname -m)}"
APP_VARIANT="${TOBY_APP_VARIANT:-development}"
ENTITLEMENTS="$PKG/TobyApp.entitlements"
APP_VERSION="${TOBY_APP_VERSION:-$(tr -d '[:space:]' < "$ROOT/VERSION")}"
APP_BUILD_NUMBER="${TOBY_APP_BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"

case "${APP_VARIANT}" in
	development)
		APP_DISPLAY_NAME="Toby (Dev)"
		APP_BUNDLE_ID="${TOBY_APP_BUNDLE_ID:-dev.karim.toby.app.dev}"
		SPARKLE_FEED_URL="${TOBY_SPARKLE_FEED_URL:-}"
		SPARKLE_PUBLIC_KEY="${TOBY_SPARKLE_PUBLIC_KEY:-}"
		;;
	production)
		APP_DISPLAY_NAME="Toby"
		APP_BUNDLE_ID="${TOBY_APP_BUNDLE_ID:-dev.karim.toby.app}"
		SPARKLE_FEED_URL="${TOBY_SPARKLE_FEED_URL:-https://www.tobyai.app/appcast.xml}"
		SPARKLE_PUBLIC_KEY="${TOBY_SPARKLE_PUBLIC_KEY:-}"
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

if [[ ! -f "${ROOT}/images/app-icon.png" ]]; then
	echo "Missing app icon source: ${ROOT}/images/app-icon.png" >&2
	exit 1
fi

# The Mach-O __info_plist section is linked from Sources/TobyApp/Info.plist
# (see Package.swift sectcreate). That section must match the outer app
# bundle's CFBundleIdentifier/CFBundleName so TCC (Accessibility, mic, etc.)
# binds to the same identity System Settings shows for this variant.
SOURCE_INFO_PLIST="${PKG}/Sources/TobyApp/Info.plist"
INFO_PLIST_BACKUP="$(mktemp)"
cp "${SOURCE_INFO_PLIST}" "${INFO_PLIST_BACKUP}"
restore_info_plist() {
	if [[ -n "${INFO_PLIST_BACKUP:-}" && -f "${INFO_PLIST_BACKUP}" ]]; then
		cp "${INFO_PLIST_BACKUP}" "${SOURCE_INFO_PLIST}"
		rm -f "${INFO_PLIST_BACKUP}"
		INFO_PLIST_BACKUP=""
	fi
}
trap restore_info_plist EXIT

/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${APP_BUNDLE_ID}" "${SOURCE_INFO_PLIST}" >/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_DISPLAY_NAME}" "${SOURCE_INFO_PLIST}" >/dev/null
echo "Embedding bundle identity ${APP_BUNDLE_ID} (${APP_DISPLAY_NAME}) into binary…"

# SwiftPM's own downloader fails the build when GitHub returns 500 for the
# Sparkle binary zip. Seed the artifact cache before the first swift invocation.
"${ROOT}/scripts/prefetch-sparkle-spm-artifact.sh"

# SPM does not track the sectcreate Info.plist as an input, so remove the
# prior binary to force a re-link with the variant identity above.
BUILD_DIR="$(
	swift build --show-bin-path -c release --arch "${ARCH}" --package-path "${PKG}"
)"
rm -f "${BUILD_DIR}/toby-app"

echo "Building toby-app (swift ${ARCH})..."
swift build -c release --arch "${ARCH}" --package-path "${PKG}"
# Restore the tracked Info.plist immediately after link so the working tree
# stays clean even if later packaging steps fail.
restore_info_plist
trap - EXIT

BIN="${BUILD_DIR}/toby-app"
RESOURCE_BUNDLE="${BUILD_DIR}/TobyApp_TobyApp.bundle"

rm -rf "$DIST"/*.app
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources" "${APP}/Contents/Frameworks"

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
	<string>__TOBY_APP_VERSION__</string>
	<key>CFBundleVersion</key>
	<string>__TOBY_APP_BUILD_NUMBER__</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>SUEnableAutomaticChecks</key>
	<true/>
	<key>SUEnableInstallerLauncherService</key>
	<true/>
	<key>SUFeedURL</key>
	<string>__TOBY_SPARKLE_FEED_URL__</string>
	<key>SUPublicEDKey</key>
	<string>__TOBY_SPARKLE_PUBLIC_KEY__</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSDownloadsFolderUsageDescription</key>
	<string>Toby lists files in Downloads when you ask it to find local files.</string>
	<key>NSDesktopFolderUsageDescription</key>
	<string>Toby lists files on your Desktop when you ask it to find local files.</string>
	<key>NSDocumentsFolderUsageDescription</key>
	<string>Toby lists files in Documents when you ask it to find local files.</string>
	<key>NSContactsUsageDescription</key>
	<string>Toby reads your contacts when you use Apple Contacts integration.</string>
	<key>NSBluetoothAlwaysUsageDescription</key>
	<string>Toby uses Bluetooth to check paired devices and change Bluetooth power when you ask.</string>
	<key>NSCalendarsUsageDescription</key>
	<string>Toby reads and manages your calendars when you use Apple Calendar integration.</string>
	<key>NSCalendarsFullAccessUsageDescription</key>
	<string>Toby needs full calendar access to search, create, update, and delete events.</string>
	<key>NSRemindersUsageDescription</key>
	<string>Toby reads and manages your reminders when you use Apple Reminders integration.</string>
	<key>NSRemindersFullAccessUsageDescription</key>
	<string>Toby needs full reminders access to search, create, update, complete, and delete reminders.</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>Toby records microphone audio when you use Record Audio.</string>
	<key>NSScreenCaptureUsageDescription</key>
	<string>Toby captures system audio for recordings when you use Record Audio.</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
		<key>NSExceptionDomains</key>
		<dict>
			<key>127.0.0.1</key>
			<dict>
				<key>NSExceptionAllowsInsecureHTTPLoads</key>
				<true/>
			</dict>
		</dict>
	</dict>
</dict>
</plist>
PLIST
python3 - "$APP/Contents/Info.plist" "$APP_BUNDLE_ID" "$APP_DISPLAY_NAME" "$APP_VERSION" "$APP_BUILD_NUMBER" "$SPARKLE_FEED_URL" "$SPARKLE_PUBLIC_KEY" <<'PY'
import pathlib
import sys
from xml.sax.saxutils import escape

path = pathlib.Path(sys.argv[1])
bundle_id = sys.argv[2]
display_name = sys.argv[3]
app_version = sys.argv[4]
app_build_number = sys.argv[5]
sparkle_feed_url = sys.argv[6]
sparkle_public_key = sys.argv[7]
path.write_text(
	path.read_text()
	.replace("__TOBY_APP_BUNDLE_ID__", escape(bundle_id))
	.replace("__TOBY_APP_DISPLAY_NAME__", escape(display_name))
	.replace("__TOBY_APP_VERSION__", escape(app_version))
	.replace("__TOBY_APP_BUILD_NUMBER__", escape(app_build_number))
	.replace("__TOBY_SPARKLE_FEED_URL__", escape(sparkle_feed_url))
	.replace("__TOBY_SPARKLE_PUBLIC_KEY__", escape(sparkle_public_key)),
	encoding="utf-8",
)
PY

cp "${BIN}" "${APP}/Contents/MacOS/toby-app"
chmod +x "${APP}/Contents/MacOS/toby-app"
if [[ -d "${RESOURCE_BUNDLE}" ]]; then
	cp -R "${RESOURCE_BUNDLE}" "${APP}/Contents/Resources/"
else
	echo "Warning: SPM resource bundle not found at ${RESOURCE_BUNDLE}" >&2
fi
# Module resource bundles (e.g. TobyApp_TobyCore.bundle: persona portraits,
# built-in instructions and skills) sit next to the app's own bundle.
for module_bundle in "${BUILD_DIR}"/TobyApp_*.bundle; do
	[[ -d "${module_bundle}" && "${module_bundle}" != "${RESOURCE_BUNDLE}" ]] || continue
	cp -R "${module_bundle}" "${APP}/Contents/Resources/"
done

copy_sparkle_framework() {
	local framework
	framework="$(find "${PKG}/.build/artifacts" -path "*/Sparkle.framework" -type d 2>/dev/null | head -1 || true)"
	if [[ -z "${framework}" ]]; then
		framework="$(find "${PKG}/.build" -path "*/Sparkle.framework" -type d 2>/dev/null | head -1 || true)"
	fi
	if [[ -z "${framework}" ]]; then
		echo "Error: Sparkle.framework was not found in SwiftPM build artifacts." >&2
		exit 1
	fi

	rm -rf "${APP}/Contents/Frameworks/Sparkle.framework"
	ditto "${framework}" "${APP}/Contents/Frameworks/Sparkle.framework"
}

copy_sparkle_framework

bash "${ROOT}/scripts/build-app-icon.sh" "${APP}/Contents/Resources/AppIcon.icns"

# For production builds, skip code signing here. The release workflow signs
# the executable and frameworks and
# then signs the app bundle. Signing here with ad-hoc identity would leave
# stale signatures that --deep cannot overwrite in non-standard code locations.
if [[ "${APP_VARIANT}" != "production" ]]; then
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
else
	echo "Skipping code sign for production build (release workflow handles signing)"
fi

echo "Built ${APP} as ${APP_DISPLAY_NAME} (${APP_VARIANT})"
