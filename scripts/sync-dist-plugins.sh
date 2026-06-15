#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
dist_dir="${repo_root}/dist"
toby_home="${TOBY_DIR:-"${HOME}/.toby"}"
plugins_dir="${toby_home}/plugins"

if [[ ! -d "${dist_dir}" ]]; then
	echo "Missing dist directory: ${dist_dir}" >&2
	exit 1
fi

mkdir -p "${plugins_dir}"

plugin_count=0
for plugin_path in "${dist_dir}"/toby-plugin-*; do
	if [[ ! -f "${plugin_path}" ]]; then
		continue
	fi
	plugin_name="$(basename "${plugin_path}")"
	plugin_id="${plugin_name#toby-plugin-}"
	if [[ ! "${plugin_id}" =~ ^[a-z0-9_-]+$ ]]; then
		echo "Skipping ${plugin_name} (not a plugin binary name)"
		continue
	fi
	cp "${plugin_path}" "${plugins_dir}/${plugin_name}"
	chmod +x "${plugins_dir}/${plugin_name}"
	echo "Synced ${plugin_name} -> ${plugins_dir}/${plugin_name}"
	plugin_count=$((plugin_count + 1))
done

bundle_count=0
for bundle_path in "${dist_dir}"/*.bundle; do
	if [[ ! -d "${bundle_path}" ]]; then
		continue
	fi
	bundle_name="$(basename "${bundle_path}")"
	ditto "${bundle_path}" "${plugins_dir}/${bundle_name}"
	echo "Synced ${bundle_name} -> ${plugins_dir}/${bundle_name}"
	bundle_count=$((bundle_count + 1))
done

if [[ "${plugin_count}" -eq 0 ]]; then
	echo "No dist/toby-plugin-* binaries found. Run a plugin build first." >&2
	exit 1
fi

echo "Synced ${plugin_count} plugin binary/binaries and ${bundle_count} bundle(s) into ${plugins_dir}."
