#!/usr/bin/env bash
# Preserve the face silhouette and white outline in a transparent macOS icon.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${ROOT}/images/app-icon.png"
OUTPUT="${1:?Usage: build-app-icon.sh <output.icns>}"

if [[ ! -f "${SOURCE}" ]]; then
	echo "Missing app icon source: ${SOURCE}" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
ICONSET="${WORK}/AppIcon.iconset"
mkdir -p "${ICONSET}" "$(dirname "${OUTPUT}")"

for size in 16 32 128 256 512; do
	sips -z "${size}" "${size}" "${SOURCE}" \
		--out "${ICONSET}/icon_${size}x${size}.png" >/dev/null
	retina=$((size * 2))
	sips -z "${retina}" "${retina}" "${SOURCE}" \
		--out "${ICONSET}/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "${ICONSET}" -o "${OUTPUT}"
echo "Built transparent app icon: ${OUTPUT}"
