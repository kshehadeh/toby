#!/usr/bin/env bash
# Build toby-plugin-whisper with statically linked whisper.cpp.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
swift_arch="${SWIFT_ARCH:-$(uname -m)}"

chmod +x "${repo_root}/scripts/build-whisper-static-libs.sh"
SWIFT_ARCH="${swift_arch}" "${repo_root}/scripts/build-whisper-static-libs.sh"

export TOBY_REPO_ROOT="${repo_root}"
export WHISPER_STATIC_PREFIX="${repo_root}/.build/whisper-static-${swift_arch}"
export SWIFT_ARCH="${swift_arch}"

swift build -c release --arch "${swift_arch}" --package-path "${repo_root}/apps/plugin-whisper"

mkdir -p "${repo_root}/dist"
cp "$(
	swift build --show-bin-path -c release --arch "${swift_arch}" --package-path "${repo_root}/apps/plugin-whisper"
)/toby-plugin-whisper" "${repo_root}/dist/toby-plugin-whisper"
chmod +x "${repo_root}/dist/toby-plugin-whisper"
echo "Built toby-plugin-whisper (${swift_arch}) -> ${repo_root}/dist/toby-plugin-whisper"
