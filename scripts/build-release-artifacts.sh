#!/usr/bin/env bash
# Build the release payload: the self-contained native Toby.app in dist/.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

swift_arch="${SWIFT_ARCH:-arm64}"
mkdir -p dist

echo "Building native Toby.app ($(tr -d '[:space:]' < VERSION))..."
chmod +x scripts/build-app.sh
SWIFT_ARCH="${swift_arch}" TOBY_APP_VARIANT=production ./scripts/build-app.sh

node scripts/verify-release-artifacts.mjs dist
echo "Release artifacts ready in dist/"
