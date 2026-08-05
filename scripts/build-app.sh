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
APP_VERSION="${TOBY_APP_VERSION:-$(bun -e "console.log(JSON.parse(await Bun.file('./package.json').text()).version)")}"
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
		SPARKLE_FEED_URL="${TOBY_SPARKLE_FEED_URL:-https://kshehadeh.github.io/toby/appcast.xml}"
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
	<key>NSContactsUsageDescription</key>
	<string>Toby reads your contacts when you use Apple Contacts integration.</string>
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

# For production builds, bundle all release artifacts (CLI, Bun runtime, web UI,
# icons, plugins) into Contents/Resources/ so Toby.app is self-contained.
bundle_production_resources() {
	local res_dir="${APP}/Contents/Resources"

	if [[ -f "${DIST}/toby" ]]; then
		cp "${DIST}/toby" "${res_dir}/toby"
		chmod +x "${res_dir}/toby"
	else
		echo "Warning: dist/toby not found; Toby.app will not be self-contained." >&2
		return 1
	fi

	if [[ -f "${DIST}/bun" ]]; then
		cp "${DIST}/bun" "${res_dir}/bun"
		chmod +x "${res_dir}/bun"
	fi

	if [[ -d "${DIST}/web" ]]; then
		rm -rf "${res_dir}/web"
		cp -R "${DIST}/web" "${res_dir}/web"
	fi

	if [[ -d "${DIST}/icons" ]]; then
		rm -rf "${res_dir}/icons"
		cp -R "${DIST}/icons" "${res_dir}/icons"
	fi

	# Copy all plugin artifacts (binaries and bun-package directories)
	# For bun-package plugins, strip node_modules and re-install fresh
	# inside the app bundle. The dist copy's node_modules may contain
	# symlinks (from Bun's workspace install) that break when copied
	# into the app bundle, causing codesign to fail with "No such file
	# or directory" when it scans the bundle to create CodeResources.
	local entry
	for entry in "${DIST}"/toby-plugin-*; do
		[[ -e "${entry}" ]] || continue
		local name
		name="$(basename "${entry}")"
		rm -rf "${res_dir}/${name}"
		if [[ -f "${entry}" ]]; then
			# Legacy binary plugin
			cp "${entry}" "${res_dir}/${name}"
			chmod +x "${res_dir}/${name}"
		elif [[ -f "${entry}/manifest.json" ]]; then
			# Bun-package plugin: copy without node_modules, then install fresh
			cp -R "${entry}" "${res_dir}/${name}"
			rm -rf "${res_dir}/${name}/node_modules"
			if [[ -f "${res_dir}/${name}/package.json" ]]; then
				echo "  Installing dependencies for ${name} in app bundle..."
				bun install --production --cwd "${res_dir}/${name}" || \
					echo "  Warning: bun install failed for ${name}; plugin may not work" >&2
			fi
		else
			# Unknown format, copy as-is
			cp -R "${entry}" "${res_dir}/${name}"
		fi
	done

	# Legacy placeholder for backward-compatible self-upgraders
	if [[ -f "${DIST}/toby-listener" ]]; then
		cp "${DIST}/toby-listener" "${res_dir}/toby-listener"
		chmod +x "${res_dir}/toby-listener"
	fi

	echo "Bundled production resources into ${res_dir}"
}

if [[ "${APP_VARIANT}" == "production" ]]; then
	bundle_production_resources
fi

build_app_icon

# For production builds, skip code signing here. The release workflow signs
# all executables individually (including those in Contents/Resources/) and
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
