#!/usr/bin/env bash
# Build the branded drag-and-drop DMG without opening or automating Finder.
#
# Usage:
#   ./scripts/build-dmg.sh [arch]
#
# Requires: macOS 26+, Python 3.11+, and dist/Toby.app already built.
# Produces: dist/Toby-<arch>.dmg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
ARCH="${1:-$(uname -m)}"
APP="${DIST}/Toby.app"
DMG="${DIST}/Toby-${ARCH}.dmg"
TOOLS="${DIST}/.dmg-tools"
REQUIREMENTS="${ROOT}/scripts/dmg-requirements.txt"

if [[ ! -d "${APP}" ]]; then
	echo "Error: ${APP} not found. Run scripts/build-release-artifacts.sh first." >&2
	exit 1
fi

python3 -c 'import sys; sys.exit("DMG packaging requires Python 3.11 or later." if sys.version_info < (3, 11) else 0)'

# Keep build-only Python dependencies isolated from the app and system Python.
# The fingerprint avoids contacting PyPI again on unchanged subsequent builds.
fingerprint="$(shasum -a 256 "${REQUIREMENTS}" | awk '{print $1}')"
installed=""
if [[ -f "${TOOLS}/requirements.sha256" ]]; then
	installed="$(<"${TOOLS}/requirements.sha256")"
fi
if [[ ! -x "${TOOLS}/bin/dmgbuild" || "${installed}" != "${fingerprint}" ]]; then
	echo "Preparing isolated DMG packaging tools…"
	python3 -m venv "${TOOLS}"
	"${TOOLS}/bin/python" -m pip install --disable-pip-version-check \
		--only-binary=:all: --requirement "${REQUIREMENTS}"
	printf '%s\n' "${fingerprint}" >"${TOOLS}/requirements.sha256"
fi

echo "Building DMG: ${DMG}"
# Replace the previous artifact only after a complete build succeeds.
WORK="$(mktemp -d "${DIST}/.dmg-build.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
"${TOOLS}/bin/dmgbuild" \
	--settings "${ROOT}/scripts/dmg-settings.py" \
	-D "root=${ROOT}" \
	"Toby" "${WORK}/Toby.dmg"
mv -f "${WORK}/Toby.dmg" "${DMG}"

echo "Built ${DMG}"
