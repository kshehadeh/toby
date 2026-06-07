#!/usr/bin/env bash
# Build macOS release binaries into dist/ (same layout as .github/workflows/release.yml).
#
# Usage:
#   BUN_TARGET=bun-darwin-arm64 SWIFT_ARCH=arm64 ./scripts/build-release-artifacts.sh
#   BUN_TARGET=bun-darwin-x64 SWIFT_ARCH=x86_64 ./scripts/build-release-artifacts.sh
#
# Requires: bun install (workspace), Swift toolchain, macOS.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

bun_target="${BUN_TARGET:?Set BUN_TARGET (e.g. bun-darwin-arm64)}"
swift_arch="${SWIFT_ARCH:?Set SWIFT_ARCH (e.g. arm64)}"

mkdir -p dist

echo "Building toby (${bun_target})..."
(
	cd apps/cli
	bun build ./src/cli.ts --compile --target="${bun_target}" --outfile ../../dist/toby
)

echo "Building toby-listener (swift ${swift_arch})..."
swift build -c release --arch "${swift_arch}" --package-path apps/audio-helper
listener_bin="$(
	swift build --show-bin-path -c release --arch "${swift_arch}" --package-path apps/audio-helper
)/toby-audio-helper"
cp "${listener_bin}" dist/toby-listener

echo "Building toby-plugin-sample (${bun_target})..."
bun build ./apps/plugin-sample/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-sample

echo "Building toby-plugin-azuread (${bun_target})..."
bun build ./apps/plugin-azuread/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-azuread

echo "Building toby-plugin-gmail (${bun_target})..."
bun build ./apps/plugin-gmail/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-gmail

echo "Building toby-plugin-todoist (${bun_target})..."
bun build ./apps/plugin-todoist/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-todoist

echo "Building toby-plugin-applemail (swift ${swift_arch})..."
swift build -c release --arch "${swift_arch}" --package-path apps/plugin-applemail
applemail_bin="$(
	swift build --show-bin-path -c release --arch "${swift_arch}" --package-path apps/plugin-applemail
)/toby-plugin-applemail"
cp "${applemail_bin}" dist/toby-plugin-applemail

echo "Building toby-plugin-applecalendar (swift ${swift_arch})..."
swift build -c release --arch "${swift_arch}" --package-path apps/plugin-applecalendar
applecalendar_bin="$(
	swift build --show-bin-path -c release --arch "${swift_arch}" --package-path apps/plugin-applecalendar
)/toby-plugin-applecalendar"
cp "${applecalendar_bin}" dist/toby-plugin-applecalendar

echo "Building toby-plugin-macos (swift ${swift_arch})..."
bash ./scripts/build-bundled-shortcuts.sh
swift build -c release --arch "${swift_arch}" --package-path apps/plugin-macos
macos_build_dir="$(
	swift build --show-bin-path -c release --arch "${swift_arch}" --package-path apps/plugin-macos
)"
cp "${macos_build_dir}/toby-plugin-macos" dist/toby-plugin-macos
cp -R "${macos_build_dir}/TobyPluginMacOS_TobyPluginMacOSLib.bundle" dist/

echo "Building whisper-cli (${swift_arch})..."
chmod +x scripts/build-whisper-cli.sh
SWIFT_ARCH="${swift_arch}" ./scripts/build-whisper-cli.sh dist/whisper-cli

chmod +x dist/toby dist/toby-listener dist/toby-plugin-sample dist/toby-plugin-azuread dist/toby-plugin-gmail dist/toby-plugin-todoist dist/toby-plugin-applemail dist/toby-plugin-applecalendar dist/toby-plugin-macos dist/whisper-cli

echo "Building web UI..."
bun run --cwd apps/web build
cp -R apps/web/dist dist/web

node scripts/verify-release-artifacts.mjs dist
echo "Release artifacts ready in dist/"
