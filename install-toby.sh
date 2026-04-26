#!/usr/bin/env bash
# Install the latest Toby release from GitHub (no sudo).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/toby/main/install-toby.sh | bash
#   ./install-toby.sh
#
# Environment:
#   TOBY_REPO         GitHub repo as owner/name (default: kshehadeh/toby, or from git remote when run inside a clone)
#   TOBY_INSTALL_DIR  Directory for the binary (default: $HOME/.local/bin)
#   TOBY_VERSION      Exact tag to install, e.g. v0.2.0 (default: latest GitHub release)
#   GITHUB_TOKEN      Optional; raises API rate limits when set

set -euo pipefail

default_repo="kshehadeh/toby"
repo="${TOBY_REPO:-}"

if [[ -z "$repo" ]] && git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
	remote_url="$(git -C "$git_root" config --get remote.origin.url 2>/dev/null || true)"
	case "$remote_url" in
	*github.com:*/*.git)
		repo="${remote_url#*github.com:}"
		repo="${repo%.git}"
		;;
	https://github.com/*/*.git)
		repo="${remote_url#https://github.com/}"
		repo="${repo%.git}"
		;;
	https://github.com/*/*)
		repo="${remote_url#https://github.com/}"
		repo="${repo%.git}"
		;;
	esac
fi

repo="${repo:-$default_repo}"
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
	case "$arch" in
	aarch64 | arm64) asset="toby-linux-arm64" ;;
	x86_64) asset="toby-linux-x64" ;;
	*)
		echo "Unsupported Linux architecture: $arch (need aarch64/arm64 or x86_64)." >&2
		exit 1
		;;
	esac
	;;
*)
	echo "Unsupported operating system: $os (this installer supports macOS and Linux only)." >&2
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
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

echo "Installing Toby ${tag} (${asset}) from ${repo}..."
if ! curl -fsSL -o "${tmpdir}/toby" "$download_url"; then
	echo "Download failed: ${download_url}" >&2
	echo "Check that this release exists and includes ${asset}." >&2
	exit 1
fi

chmod +x "${tmpdir}/toby"
mkdir -p "$install_dir"
mv "${tmpdir}/toby" "${install_dir}/toby"
echo "Installed: ${install_dir}/toby"

if "${install_dir}/toby" --version >/dev/null 2>&1; then
	echo "Verified: $("${install_dir}/toby" --version)"
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
