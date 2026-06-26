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

echo "Building toby-plugin-sample (${bun_target})..."
bun build ./apps/plugin-sample/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-sample

echo "Building toby-plugin-azuread (${bun_target})..."
bun build ./apps/plugin-azuread/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-azuread

echo "Building toby-plugin-gmail (${bun_target})..."
bun build ./apps/plugin-gmail/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-gmail

echo "Building toby-plugin-todoist (${bun_target})..."
bun build ./apps/plugin-todoist/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-todoist

echo "Building toby-plugin-slack (${bun_target})..."
bun build ./apps/plugin-slack/src/cli.ts --compile --target="${bun_target}" --outfile dist/toby-plugin-slack

echo "Building toby-plugin-jira (bun-package)..."
rm -rf dist/toby-plugin-jira
cp -R apps/plugin-jira dist/toby-plugin-jira
rm -rf dist/toby-plugin-jira/node_modules dist/toby-plugin-jira/.turbo dist/toby-plugin-jira/.build

echo "Building toby-plugin-websearch (swift ${swift_arch})..."
swift build -c release --arch "${swift_arch}" --package-path apps/plugin-websearch
websearch_bin="$(
	swift build --show-bin-path -c release --arch "${swift_arch}" --package-path apps/plugin-websearch
)/toby-plugin-websearch"
cp "${websearch_bin}" dist/toby-plugin-websearch

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

echo "Building toby-plugin-whisper with embedded whisper.cpp (${swift_arch})..."
chmod +x scripts/build-plugin-whisper.sh
SWIFT_ARCH="${swift_arch}" ./scripts/build-plugin-whisper.sh

chmod +x dist/toby dist/toby-plugin-sample dist/toby-plugin-azuread dist/toby-plugin-gmail dist/toby-plugin-todoist dist/toby-plugin-slack dist/toby-plugin-websearch dist/toby-plugin-applecalendar dist/toby-plugin-macos dist/toby-plugin-whisper

# Create a legacy toby-listener placeholder so releases remain compatible with
# v0.49.0 and earlier self-upgraders, which validate that the archive contains
# the helper before installing. Toby.app now handles audio capture; the helper
# itself is deprecated and will be removed after the upgrade.
echo "Creating legacy toby-listener placeholder..."
cat > dist/toby-listener <<'EOF'
#!/bin/sh
echo "toby-listener is deprecated; audio capture now uses Toby.app." >&2
exit 1
EOF
chmod +x dist/toby-listener

echo "Building web UI..."
bun run --cwd apps/web build
cp -R apps/web/dist dist/web

echo "Building native Toby.app..."
chmod +x scripts/build-app.sh
SWIFT_ARCH="${swift_arch}" TOBY_APP_VARIANT=production ./scripts/build-app.sh

node scripts/verify-release-artifacts.mjs dist
echo "Release artifacts ready in dist/"
