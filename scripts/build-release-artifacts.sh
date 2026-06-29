#!/usr/bin/env bash
# Build macOS release binaries into dist/ (same layout as .github/workflows/release.yml).
#
# Usage:
#   ./scripts/build-release-artifacts.sh
#   BUN_TARGET=bun-darwin-arm64 SWIFT_ARCH=arm64 ./scripts/build-release-artifacts.sh
#
# Requires: bun install (workspace), Swift toolchain, macOS (Apple Silicon).

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

bun_target="${BUN_TARGET:-bun-darwin-arm64}"
swift_arch="${SWIFT_ARCH:-arm64}"

mkdir -p dist

# Remove deprecated plugin binaries that are no longer built but may linger
# from previous builds. The upgrade code also removes these from installed
# plugins directories (see REMOVED_PLUGIN_BINARIES in upgrade/index.ts).
rm -f dist/toby-plugin-applemail dist/toby-plugin-sample

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

echo "Building bun-package plugins (sample-ts, todoist, slack, jira, email, macos, applecalendar)..."
for plugin in sample-ts todoist slack jira email macos applecalendar; do
	echo "  -> toby-plugin-${plugin}"
	(cd "apps/plugin-${plugin}" && bash ../../scripts/copy-bun-plugin-to-dist.sh)
done

chmod +x dist/toby dist/bun

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

echo "Bundling icon assets..."
rm -rf dist/icons
cp -R packages/core/assets/icons dist/icons

echo "Building native Toby.app..."
chmod +x scripts/build-app.sh
SWIFT_ARCH="${swift_arch}" TOBY_APP_VARIANT=production ./scripts/build-app.sh

node scripts/verify-release-artifacts.mjs dist
echo "Release artifacts ready in dist/"
