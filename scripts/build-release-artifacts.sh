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

echo "Bundling bun runtime for bun-package plugins (${bun_target})..."
bun_version="$(bun --version)"
# BUN_TARGET uses "arm64" but Bun release assets use "aarch64"
bun_asset="$(echo "${bun_target}" | sed 's/darwin-arm64/darwin-aarch64/')"
curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${bun_version}/${bun_asset}.zip" -o dist/.bun-runtime.zip
unzip -o -q dist/.bun-runtime.zip -d dist/.bun-runtime-tmp
bun_bin="$(find dist/.bun-runtime-tmp -name bun -type f | head -1)"
cp "${bun_bin}" dist/bun
rm -rf dist/.bun-runtime.zip dist/.bun-runtime-tmp
chmod +x dist/bun

echo "Building toby-plugin-sample-ts (bun-package)..."
rm -rf dist/toby-plugin-sample-ts
cp -R apps/plugin-sample-ts dist/toby-plugin-sample-ts
rm -rf dist/toby-plugin-sample-ts/.turbo dist/toby-plugin-sample-ts/.build

echo "Building toby-plugin-azuread (bun-package)..."
rm -rf dist/toby-plugin-azuread
cp -R apps/plugin-azuread dist/toby-plugin-azuread
rm -rf dist/toby-plugin-azuread/.turbo dist/toby-plugin-azuread/.build

echo "Building toby-plugin-gmail (bun-package)..."
rm -rf dist/toby-plugin-gmail
cp -R apps/plugin-gmail dist/toby-plugin-gmail
rm -rf dist/toby-plugin-gmail/.turbo dist/toby-plugin-gmail/.build

echo "Building toby-plugin-todoist (bun-package)..."
rm -rf dist/toby-plugin-todoist
cp -R apps/plugin-todoist dist/toby-plugin-todoist
rm -rf dist/toby-plugin-todoist/.turbo dist/toby-plugin-todoist/.build

echo "Building toby-plugin-slack (bun-package)..."
rm -rf dist/toby-plugin-slack
cp -R apps/plugin-slack dist/toby-plugin-slack
rm -rf dist/toby-plugin-slack/.turbo dist/toby-plugin-slack/.build

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

chmod +x dist/toby dist/bun dist/toby-plugin-websearch dist/toby-plugin-applecalendar dist/toby-plugin-macos dist/toby-plugin-whisper

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
