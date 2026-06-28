#!/usr/bin/env bash
# Copy a bun-package (TypeScript) plugin into dist/ with dependencies.
# Called from the plugin's own directory — turbo runs each package's
# build script with cwd set to the package root.
#
# Usage (from a plugin's package.json "build" script):
#   bash ../../scripts/copy-bun-plugin-to-dist.sh

set -euo pipefail

dir_name="$(basename "$(pwd)")"
dist_name="toby-${dir_name}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dist_dir="${repo_root}/dist"

rm -rf "${dist_dir}/${dist_name}"
mkdir -p "${dist_dir}"
cp -R . "${dist_dir}/${dist_name}"
rm -rf \
	"${dist_dir}/${dist_name}/.turbo" \
	"${dist_dir}/${dist_name}/.build" \
	"${dist_dir}/${dist_name}/node_modules"

# Install production dependencies so the plugin is self-contained in dist/.
# Strip any workspace node_modules (which contains symlinks to the hoisted
# store) before installing fresh to avoid broken symlinks.
bun install --production --cwd "${dist_dir}/${dist_name}"

echo "Copied ${dist_name} to dist/ (with node_modules)"
