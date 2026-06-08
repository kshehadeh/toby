#!/usr/bin/env bash
# Build static whisper.cpp libraries for linking into toby-plugin-whisper.
#
# Usage:
#   SWIFT_ARCH=arm64 ./scripts/build-whisper-static-libs.sh
#
# Output prefix: .build/whisper-static-${SWIFT_ARCH}/
#   include/whisper.h
#   lib/libwhisper.a libggml*.a

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
swift_arch="${SWIFT_ARCH:-$(uname -m)}"
whisper_ref="${WHISPER_CPP_REF:-v1.7.5}"
build_root="${repo_root}/.build/whisper.cpp-${swift_arch}"
install_prefix="${repo_root}/.build/whisper-static-${swift_arch}"

case "$swift_arch" in
arm64 | aarch64) cmake_arch="arm64" ;;
x86_64) cmake_arch="x86_64" ;;
*)
	echo "Unsupported SWIFT_ARCH for whisper.cpp: ${swift_arch}" >&2
	exit 1
	;;
esac

if [[ ! -d "${build_root}/.git" ]]; then
	rm -rf "${build_root}"
	git clone --depth 1 --branch "${whisper_ref}" \
		https://github.com/ggerganov/whisper.cpp.git "${build_root}"
fi

cmake_args=(
	-B "${build_root}/build"
	-DCMAKE_BUILD_TYPE=Release
	-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0
	"-DCMAKE_OSX_ARCHITECTURES=${cmake_arch}"
	-DWHISPER_BUILD_TESTS=OFF
	-DWHISPER_BUILD_EXAMPLES=OFF
	-DBUILD_SHARED_LIBS=OFF
	-DGGML_NATIVE=OFF
)

if [[ "$cmake_arch" == "arm64" ]]; then
	cmake_args+=(
		-DWHISPER_METAL=ON
		-DGGML_METAL_EMBED_LIBRARY=ON
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

mkdir -p "${install_prefix}/include" "${install_prefix}/lib"
cp "${build_root}/include/whisper.h" "${install_prefix}/include/"
cp "${build_root}/ggml/include/"*.h "${install_prefix}/include/" 2>/dev/null || true

plugin_third_party="${repo_root}/apps/plugin-whisper/ThirdParty/whisper-${swift_arch}"
mkdir -p "${plugin_third_party}/include" "${plugin_third_party}/lib"
cp "${build_root}/include/whisper.h" "${plugin_third_party}/include/"
cp "${build_root}/ggml/include/"*.h "${plugin_third_party}/include/" 2>/dev/null || true

shopt -s nullglob
for lib in \
	"${build_root}/build/src/libwhisper.a" \
	"${build_root}/build/ggml/src/"libggml*.a \
	"${build_root}/build/ggml/src/ggml-blas/"libggml*.a \
	"${build_root}/build/ggml/src/ggml-metal/"libggml*.a; do
	if [[ -f "$lib" ]]; then
		cp "$lib" "${install_prefix}/lib/"
		cp "$lib" "${plugin_third_party}/lib/"
	fi
done

if [[ ! -f "${install_prefix}/lib/libwhisper.a" ]]; then
	echo "libwhisper.a not found after build" >&2
	exit 1
fi

echo "Built whisper static libs (${cmake_arch}) -> ${install_prefix}"
