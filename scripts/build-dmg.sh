#!/usr/bin/env bash
# Build a drag-and-drop DMG containing Toby.app and an /Applications symlink.
#
# Usage:
#   ./scripts/build-dmg.sh [arch]
#
# Requires: dist/Toby.app already built (run scripts/build-release-artifacts.sh first).
# Produces: dist/Toby-<arch>.dmg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
ARCH="${1:-$(uname -m)}"
APP="${DIST}/Toby.app"
DMG="${DIST}/Toby-${ARCH}.dmg"

if [[ ! -d "${APP}" ]]; then
	echo "Error: ${APP} not found. Run scripts/build-release-artifacts.sh first." >&2
	exit 1
fi

echo "Building DMG: ${DMG}"

# Clean up any previous DMG
rm -f "${DMG}"

# Create a temporary staging directory for the DMG contents
STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT

# Copy the app and create /Applications symlink
cp -R "${APP}" "${STAGING}/Toby.app"
ln -s /Applications "${STAGING}/Applications"

# Calculate size needed (app size + ~10MB overhead)
SIZE_BYTES=$(du -sk "${STAGING}" | awk '{print $1 * 1024}')
SIZE_BYTES=$((SIZE_BYTES + 10 * 1024 * 1024))

# Create the DMG
hdiutil create \
	-volname "Toby" \
	-srcfolder "${STAGING}" \
	-ov \
	-format UDZO \
	-size "${SIZE_BYTES}"b \
	"${DMG}"

echo "Built ${DMG}"
