#!/usr/bin/env bash
# Install the latest Toby release from GitHub (no sudo).
#
# Downloads the Toby DMG, mounts it, and installs Toby.app into /Applications
# (or ~/Applications when /Applications is not writable). Toby is a single
# native app; there is no separate CLI, server, or plugins to install.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/toby/main/install-toby.sh | bash
#   ./install-toby.sh
#
# Environment:
#   TOBY_REPO         GitHub repo as owner/name (default: kshehadeh/toby)
#   TOBY_INSTALL_DIR  Where an older release put the `toby` CLI (removed if present; default $HOME/.local/bin)
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

# Older releases installed a `toby` CLI beside the app; it no longer exists.
for legacy in "${install_dir}/toby" "${install_dir}/icons" "${install_dir}/personas"; do
	if [[ -e "$legacy" ]]; then
		rm -rf "$legacy"
		echo "Removed legacy: $legacy"
	fi
done

echo "Done. Open Toby from ${applications_dir}."
