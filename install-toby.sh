#!/usr/bin/env bash
# Install the latest Toby release from GitHub (no sudo).
#
# Downloads the Toby DMG, mounts it, and installs:
#   - Toby.app → /Applications (or ~/Applications when /Applications is not writable)
#   - toby → $TOBY_INSTALL_DIR (default ~/.local/bin)
#   - bun runtime → ~/.toby/helpers/bun (for bun-package plugins)
#   - web UI → sibling web/ directory
#   - icon assets → sibling icons/ directory
#   - toby-plugin-* → ~/.toby/plugins/
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/toby/main/install-toby.sh | bash
#   ./install-toby.sh
#
# Environment:
#   TOBY_REPO         GitHub repo as owner/name (default: kshehadeh/toby)
#   TOBY_INSTALL_DIR  Directory for the CLI binary (default $HOME/.local/bin)
#   TOBY_VERSION      Exact tag to install, e.g. v0.2.0 (default: latest GitHub release)
#   GITHUB_TOKEN      Optional; raises API rate limits when set

set -euo pipefail

default_repo="kshehadeh/toby"
repo="${TOBY_REPO:-$default_repo}"
install_dir="${TOBY_INSTALL_DIR:-$HOME/.local/bin}"
pinned_version="${TOBY_VERSION:-}"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
Darwin)
	case "$arch" in
	arm64) asset="Toby-arm64.dmg" ;;
	*)
		echo "Unsupported macOS architecture: $arch (Toby releases are Apple Silicon only)." >&2
		exit 1
		;;
	esac
	;;
Linux)
	echo "Unsupported operating system: Linux. Toby releases are macOS-only." >&2
	exit 1
	;;
*)
	echo "Unsupported operating system: $os (this installer supports macOS only)." >&2
	exit 1
	;;
esac

api_latest="https://api.github.com/repos/${repo}/releases/latest"
curl_common=(-fsSL)
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
	curl_common+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi
curl_common+=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

if [[ -n "$pinned_version" ]]; then
	tag="$pinned_version"
else
	json="$(curl "${curl_common[@]}" "$api_latest")"
	if command -v jq >/dev/null 2>&1; then
		tag="$(printf '%s' "$json" | jq -r .tag_name)"
	else
		tag="$(printf '%s' "$json" | tr -d '\r' | tr '\n' ' ' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
	fi
	if [[ -z "$tag" || "$tag" == "null" ]]; then
		echo "Could not determine latest release tag for ${repo}." >&2
		exit 1
	fi
fi

download_url="https://github.com/${repo}/releases/download/${tag}/${asset}"
tmpdir="$(mktemp -d)"
cleanup() {
	[[ -n "${mount_point:-}" ]] && hdiutil detach "${mount_point}" -force >/dev/null 2>&1 || true
	rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "Installing Toby ${tag} (${asset}) from ${repo}..."
if ! curl -fsSL -o "${tmpdir}/Toby.dmg" "$download_url"; then
	echo "Download failed: ${download_url}" >&2
	echo "Check that this release exists and includes ${asset}." >&2
	exit 1
fi

echo "Mounting DMG..."
mount_output="$(hdiutil attach -nobrowse -noautoopen "${tmpdir}/Toby.dmg" 2>&1)"
mount_point="$(echo "$mount_output" | tail -1 | awk '{print $NF}')"

if [[ -z "$mount_point" || ! -d "$mount_point" ]]; then
	echo "Failed to mount DMG: $mount_output" >&2
	exit 1
fi

app_path="${mount_point}/Toby.app"
if [[ ! -d "$app_path" ]]; then
	echo "DMG does not contain Toby.app." >&2
	exit 1
fi

resources_dir="${app_path}/Contents/Resources"
if [[ ! -f "${resources_dir}/toby" ]]; then
	echo "Toby.app is missing Contents/Resources/toby." >&2
	exit 1
fi

# Install Toby.app to Applications
if [[ -w /Applications ]]; then
	applications_dir="/Applications"
else
	applications_dir="${HOME}/Applications"
fi
mkdir -p "$applications_dir"
rm -rf "${applications_dir}/Toby.app"
cp -R "$app_path" "${applications_dir}/Toby.app"
echo "Installed: ${applications_dir}/Toby.app"

# Install CLI binary to install_dir
toby_dir="${TOBY_DIR:-$HOME/.toby}"
toby_helpers_dir="${toby_dir}/helpers"
toby_plugins_dir="${toby_dir}/plugins"

chmod +x "${resources_dir}/toby"
mkdir -p "$install_dir"
cp "${resources_dir}/toby" "${install_dir}/toby"
echo "Installed: ${install_dir}/toby"

# Install web UI and icons next to the CLI
if [[ -d "${resources_dir}/web" ]]; then
	rm -rf "${install_dir}/web"
	cp -R "${resources_dir}/web" "${install_dir}/web"
	echo "Installed: ${install_dir}/web"
fi

if [[ -d "${resources_dir}/icons" ]]; then
	rm -rf "${install_dir}/icons"
	cp -R "${resources_dir}/icons" "${install_dir}/icons"
	echo "Installed: ${install_dir}/icons"
fi

# Install Bun runtime
if [[ -f "${resources_dir}/bun" ]]; then
	chmod +x "${resources_dir}/bun"
	mkdir -p "$toby_helpers_dir"
	cp "${resources_dir}/bun" "${toby_helpers_dir}/bun"
	echo "Installed: ${toby_helpers_dir}/bun"
fi

# Install all bundled plugins
mkdir -p "$toby_plugins_dir"
for entry in "${resources_dir}"/toby-plugin-*; do
	[[ -e "$entry" ]] || continue
	name="$(basename "$entry")"
	if [[ -f "$entry" ]]; then
		chmod +x "$entry"
		cp "$entry" "${toby_plugins_dir}/${name}"
	else
		rm -rf "${toby_plugins_dir}/${name}"
		cp -R "$entry" "${toby_plugins_dir}/${name}"
	fi
	echo "Installed: ${toby_plugins_dir}/${name}"
done

# Install plugin resource bundles
for entry in "${resources_dir}"/*.bundle; do
	[[ -e "$entry" ]] || continue
	name="$(basename "$entry")"
	rm -rf "${toby_plugins_dir}/${name}"
	cp -R "$entry" "${toby_plugins_dir}/"
	echo "Installed: ${toby_plugins_dir}/${name}"
done

# Run bun install for bun-package plugins
bun_runtime="${toby_helpers_dir}/bun"
if [[ -f "$bun_runtime" ]]; then
	for plugin_dir in "${toby_plugins_dir}"/toby-plugin-*/; do
		[[ -d "$plugin_dir" ]] || continue
		if [[ -f "${plugin_dir}/manifest.json" ]]; then
			rm -rf "${plugin_dir}node_modules"
			"$bun_runtime" install --cwd "$plugin_dir" >/dev/null 2>&1 || true
		fi
	done
fi

# Remove legacy standalone helpers if present
for legacy_helper in "${toby_helpers_dir}/toby-macos" "${toby_helpers_dir}/whisper-cli" "${toby_helpers_dir}/toby-listener"; do
	if [[ -f "$legacy_helper" ]]; then
		rm -f "$legacy_helper"
		echo "Removed legacy helper: $legacy_helper"
	fi
done

if "${install_dir}/toby" --version >/dev/null 2>&1; then
	echo "Verified: $("${install_dir}/toby" --version)"
fi

if "${install_dir}/toby" whisper setup --quiet; then
	echo "Installed whisper transcription model."
else
	echo "Note: Could not download whisper model. Run: toby whisper setup" >&2
fi

install_dir_abs="$(cd "$install_dir" && pwd -P 2>/dev/null || printf '%s' "$install_dir")"
path_entry=":${PATH}:"
if [[ "$path_entry" == *":${install_dir_abs}:"* ]]; then
	echo "${install_dir_abs} is already on your PATH."
	exit 0
fi
if [[ "$path_entry" == *":${install_dir}:"* ]]; then
	echo "${install_dir} is already on your PATH."
	exit 0
fi

echo
echo "${install_dir_abs} is not on your PATH, so running \"toby\" may not work until you add it."
echo
echo "Add this line to your shell profile, then open a new terminal (or run source on that file):"
echo
case "${SHELL:-}" in
*/fish)
	echo "  fish: mkdir -p ~/.config/fish && echo 'fish_add_path ${install_dir_abs}' >> ~/.config/fish/config.fish"
	;;
*/zsh)
	echo "  zsh:  echo 'export PATH=\"${install_dir_abs}:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
	;;
*/bash)
	echo "  bash: echo 'export PATH=\"${install_dir_abs}:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
	;;
*)
	echo "  export PATH=\"${install_dir_abs}:\$PATH\""
	echo
	echo "(Typical files: ~/.zshrc, ~/.bashrc, or ~/.profile for login shells.)"
	;;
esac
echo
