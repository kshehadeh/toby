#!/usr/bin/env bash
# Build whisper.cpp CLI for the current or requested macOS architecture.
#
# Usage:
#   SWIFT_ARCH=arm64 ./scripts/build-whisper-cli.sh [output-path]
#   SWIFT_ARCH=x86_64 ./scripts/build-whisper-cli.sh dist/whisper-cli
#
# Requires: git, cmake, a C++ toolchain (Xcode CLT).

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
swift_arch="${SWIFT_ARCH:-$(uname -m)}"
output_path="${1:-${repo_root}/dist/whisper-cli}"
whisper_ref="${WHISPER_CPP_REF:-v1.7.5}"
build_root="${repo_root}/.build/whisper.cpp-${swift_arch}"

case "$swift_arch" in
arm64 | aarch64) cmake_arch="arm64" ;;
x86_64) cmake_arch="x86_64" ;;
*)
	echo "Unsupported SWIFT_ARCH for whisper.cpp: ${swift_arch}" >&2
	exit 1
	;;
esac

mkdir -p "$(dirname "$output_path")"

if [[ ! -d "${build_root}/.git" ]]; then
	rm -rf "${build_root}"
	git clone --depth 1 --branch "${whisper_ref}" \
		https://github.com/ggerganov/whisper.cpp.git "${build_root}"
fi

cmake_args=(
	-B "${build_root}/build"
	-DCMAKE_BUILD_TYPE=Release
	"-DCMAKE_OSX_ARCHITECTURES=${cmake_arch}"
	-DWHISPER_BUILD_TESTS=OFF
	-DWHISPER_BUILD_EXAMPLES=ON
	# Release/CI builds often run on Apple Silicon hosts cross-compiling one arch.
	# Disable host CPU tuning so ggml does not pass arm flags (e.g. apple-m3) to
	# the wrong target. https://github.com/ggml-org/whisper.cpp/issues/3427
	-DGGML_NATIVE=OFF
)

if [[ "$cmake_arch" == "arm64" ]]; then
	# macos-latest can mis-detect i8mm: ggml enables vmmlaq_s32 intrinsics but
	# some translation units compile without +i8mm. Pin a baseline march.
	cmake_args+=(
		-DWHISPER_METAL=ON
		"-DCMAKE_C_FLAGS=-march=armv8.5-a+dotprod"
		"-DCMAKE_CXX_FLAGS=-march=armv8.5-a+dotprod"
	)
elif [[ "$cmake_arch" == "x86_64" ]]; then
	cmake_args+=(
		"-DCMAKE_C_FLAGS=-march=x86-64"
		"-DCMAKE_CXX_FLAGS=-march=x86-64"
	)
fi

cmake "${cmake_args[@]}" "${build_root}"
cmake --build "${build_root}/build" --config Release -j "$(sysctl -n hw.ncpu)"

cli_bin="${build_root}/build/bin/whisper-cli"
if [[ ! -x "$cli_bin" ]]; then
	echo "whisper-cli binary not found at ${cli_bin}" >&2
	exit 1
fi

cp "$cli_bin" "$output_path"
chmod +x "$output_path"
echo "Built whisper-cli (${cmake_arch}) -> ${output_path}"
