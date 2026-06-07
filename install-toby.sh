#!/usr/bin/env bash
# Install the latest Toby release from GitHub (no sudo).
#
# Installs:
#   - toby → $TOBY_INSTALL_DIR (default ~/.local/bin)
#   - web UI → sibling web/ directory
#   - toby-listener, whisper-cli → ~/.toby/helpers/
#   - toby-plugin-sample, toby-plugin-azuread, toby-plugin-gmail, toby-plugin-todoist, toby-plugin-applemail, toby-plugin-applecalendar, toby-plugin-macos → ~/.toby/plugins/
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/toby/main/install-toby.sh | bash
#   ./install-toby.sh
#
# Environment:
#   TOBY_REPO         GitHub repo as owner/name (default: kshehadeh/toby)
#   TOBY_INSTALL_DIR  Directory for the binaries (default: $HOME/.local/bin)
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
	arm64) asset="toby-darwin-arm64" ;;
	x86_64) asset="toby-darwin-x64" ;;
	*)
		echo "Unsupported macOS architecture: $arch (need arm64 or x86_64)." >&2
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

asset="${asset}.zip"

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
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

echo "Installing Toby ${tag} (${asset}) from ${repo}..."
if ! curl -fsSL -o "${tmpdir}/toby.zip" "$download_url"; then
	echo "Download failed: ${download_url}" >&2
	echo "Check that this release exists and includes ${asset}." >&2
	exit 1
fi
unzip -q "${tmpdir}/toby.zip" -d "$tmpdir"
if [[ ! -f "${tmpdir}/toby" || ! -f "${tmpdir}/toby-listener" || ! -f "${tmpdir}/whisper-cli" ]]; then
	echo "Release archive is missing toby, toby-listener, or whisper-cli." >&2
	exit 1
fi
if [[ ! -f "${tmpdir}/web/index.html" ]]; then
	echo "Release archive is missing web/index.html." >&2
	exit 1
fi

has_sample_plugin=false
if [[ -f "${tmpdir}/toby-plugin-sample" ]]; then
	has_sample_plugin=true
fi

has_azuread_plugin=false
if [[ -f "${tmpdir}/toby-plugin-azuread" ]]; then
	has_azuread_plugin=true
fi

has_gmail_plugin=false
if [[ -f "${tmpdir}/toby-plugin-gmail" ]]; then
	has_gmail_plugin=true
fi

has_todoist_plugin=false
if [[ -f "${tmpdir}/toby-plugin-todoist" ]]; then
	has_todoist_plugin=true
fi

has_applemail_plugin=false
if [[ -f "${tmpdir}/toby-plugin-applemail" ]]; then
	has_applemail_plugin=true
fi

has_applecalendar_plugin=false
if [[ -f "${tmpdir}/toby-plugin-applecalendar" ]]; then
	has_applecalendar_plugin=true
fi

has_macos_plugin=false
if [[ -f "${tmpdir}/toby-plugin-macos" ]]; then
	has_macos_plugin=true
fi

# Only the `toby` binary goes on PATH (install_dir). All bundled helper
# binaries live under ~/.toby/helpers, and installable plugins under
# ~/.toby/plugins, so they don't clutter the user's bin directory.
toby_dir="${TOBY_DIR:-$HOME/.toby}"
toby_helpers_dir="${toby_dir}/helpers"
toby_plugins_dir="${toby_dir}/plugins"

chmod +x "${tmpdir}/toby"
mkdir -p "$install_dir"
mv "${tmpdir}/toby" "${install_dir}/toby"
echo "Installed: ${install_dir}/toby"

rm -rf "${install_dir}/web"
cp -R "${tmpdir}/web" "${install_dir}/web"
echo "Installed: ${install_dir}/web"

chmod +x "${tmpdir}/toby-listener"
mkdir -p "$toby_helpers_dir"
mv "${tmpdir}/toby-listener" "${toby_helpers_dir}/toby-listener"
echo "Installed: ${toby_helpers_dir}/toby-listener"

chmod +x "${tmpdir}/whisper-cli"
mv "${tmpdir}/whisper-cli" "${toby_helpers_dir}/whisper-cli"
echo "Installed: ${toby_helpers_dir}/whisper-cli"

if $has_sample_plugin; then
	chmod +x "${tmpdir}/toby-plugin-sample"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-sample" "${toby_plugins_dir}/toby-plugin-sample"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-sample"
fi

if $has_azuread_plugin; then
	chmod +x "${tmpdir}/toby-plugin-azuread"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-azuread" "${toby_plugins_dir}/toby-plugin-azuread"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-azuread"
fi

if $has_gmail_plugin; then
	chmod +x "${tmpdir}/toby-plugin-gmail"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-gmail" "${toby_plugins_dir}/toby-plugin-gmail"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-gmail"
fi

if $has_todoist_plugin; then
	chmod +x "${tmpdir}/toby-plugin-todoist"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-todoist" "${toby_plugins_dir}/toby-plugin-todoist"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-todoist"
fi

if $has_applemail_plugin; then
	chmod +x "${tmpdir}/toby-plugin-applemail"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-applemail" "${toby_plugins_dir}/toby-plugin-applemail"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-applemail"
fi

if $has_applecalendar_plugin; then
	chmod +x "${tmpdir}/toby-plugin-applecalendar"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-applecalendar" "${toby_plugins_dir}/toby-plugin-applecalendar"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-applecalendar"
fi

if $has_macos_plugin; then
	chmod +x "${tmpdir}/toby-plugin-macos"
	mkdir -p "$toby_plugins_dir"
	mv "${tmpdir}/toby-plugin-macos" "${toby_plugins_dir}/toby-plugin-macos"
	echo "Installed: ${toby_plugins_dir}/toby-plugin-macos"
	if [[ -d "${tmpdir}/TobyPluginMacOS_TobyPluginMacOSLib.bundle" ]]; then
		rm -rf "${toby_plugins_dir}/TobyPluginMacOS_TobyPluginMacOSLib.bundle"
		cp -R "${tmpdir}/TobyPluginMacOS_TobyPluginMacOSLib.bundle" "${toby_plugins_dir}/"
		echo "Installed: ${toby_plugins_dir}/TobyPluginMacOS_TobyPluginMacOSLib.bundle"
	fi
fi

# Remove legacy standalone helper if present (macOS integration is now a plugin).
if [[ -f "${toby_helpers_dir}/toby-macos" ]]; then
	rm -f "${toby_helpers_dir}/toby-macos"
	echo "Removed legacy helper: ${toby_helpers_dir}/toby-macos"
fi

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
