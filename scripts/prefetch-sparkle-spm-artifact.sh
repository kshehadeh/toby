#!/usr/bin/env bash
# SwiftPM fetches Sparkle's binary zip itself and aborts on a GitHub HTTP 500
# after a few 50ms retries (badResponseStatusCode). Download the zip with curl
# and store it under SwiftPM's artifact cache key so later swift build/test
# copies the file instead of hitting the release CDN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOLVED="${ROOT}/apps/toby-app/Package.resolved"
ARTIFACTS_DIR="${TOBY_SWIFTPM_ARTIFACTS_DIR:-${HOME}/Library/Caches/org.swift.swiftpm/artifacts}"
print_path=0
if [[ "${1:-}" == "--print-path" ]]; then
	print_path=1
fi

# Status stays on stdout unless the caller wants only the cache path.
log() {
	if [[ "${print_path}" -eq 1 ]]; then
		echo "$@" >&2
	else
		echo "$@"
	fi
}

if [[ ! -f "${RESOLVED}" ]]; then
	echo "Package.resolved not found at ${RESOLVED}" >&2
	exit 1
fi

pin="$(
	python3 - "${RESOLVED}" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1]))
for pin in data.get("pins", []):
    if pin.get("identity") != "sparkle":
        continue
    state = pin["state"]
    location = pin["location"]
    if location.endswith(".git"):
        location = location[: -len(".git")]
    prefix = "https://github.com/"
    if not location.startswith(prefix):
        raise SystemExit(f"unexpected Sparkle location: {location}")
    revision = state["revision"]
    raw = "https://raw.githubusercontent.com/" + location[len(prefix) :] + f"/{revision}/Package.swift"
    print(state["version"])
    print(revision)
    print(raw)
    break
else:
    raise SystemExit("sparkle pin not found in Package.resolved")
PY
)"

version="$(sed -n '1p' <<<"${pin}")"
revision="$(sed -n '2p' <<<"${pin}")"
manifest_url="$(sed -n '3p' <<<"${pin}")"

manifest="$(mktemp)"
trap 'rm -f "${manifest}"' EXIT

fetch_manifest() {
	local attempt
	for attempt in 1 2 3 4 5; do
		if curl -fsSL --ipv4 --connect-timeout 20 --max-time 60 \
			--retry 0 \
			-o "${manifest}" \
			"${manifest_url}"; then
			return 0
		fi
		log "Sparkle Package.swift fetch failed (attempt ${attempt})"
		if [[ "${attempt}" -lt 5 ]]; then
			sleep $((attempt * 2))
		fi
	done
	return 1
}

meta=""
if fetch_manifest; then
	meta="$(
		python3 - "${manifest}" <<'PY'
import re
import sys

text = open(sys.argv[1]).read()

def grab(name: str) -> str:
    match = re.search(rf'^let {name} = "([^"]+)"', text, re.MULTILINE)
    if not match:
        raise SystemExit(f'Sparkle Package.swift is missing let {name} = "..."')
    return match.group(1)

tag = grab("tag")
checksum = grab("checksum")
if not re.fullmatch(r"[0-9a-f]{64}", checksum):
    raise SystemExit(f"Sparkle checksum is not 64 hex chars: {checksum}")
url = f"https://github.com/sparkle-project/Sparkle/releases/download/{tag}/Sparkle-for-Swift-Package-Manager.zip"
print(tag)
print(checksum)
print(url)
PY
	)"
fi

if [[ -z "${meta}" ]]; then
	if [[ "${print_path}" -eq 0 ]] && compgen -G "${ARTIFACTS_DIR}/https___github_com_sparkle_project_Sparkle_releases_download_*_Sparkle_for_Swift_Package_Manager_zip" >/dev/null; then
		log "Could not refresh the Sparkle manifest; using the cached zip."
		exit 0
	fi
	echo "Could not read Sparkle ${version} (${revision}) Package.swift from ${manifest_url}" >&2
	exit 1
fi

tag="$(sed -n '1p' <<<"${meta}")"
checksum="$(sed -n '2p' <<<"${meta}")"
url="$(sed -n '3p' <<<"${meta}")"

cache_key="$(
	python3 - "${url}" <<'PY'
import sys

url = sys.argv[1]
print("".join(ch if ch.isalnum() else "_" for ch in url))
PY
)"
dest="${ARTIFACTS_DIR}/${cache_key}"

sha256() {
	shasum -a 256 "$1" | awk '{print $1}'
}

if [[ -f "${dest}" ]] && [[ "$(sha256 "${dest}")" == "${checksum}" ]]; then
	log "Sparkle ${tag} binary artifact already cached."
	if [[ "${print_path}" -eq 1 ]]; then
		echo "${dest}"
	fi
	exit 0
fi

download="$(mktemp)"
rm_download() {
	rm -f "${download}" "${manifest}"
}
trap rm_download EXIT

install_download() {
	local actual
	actual="$(sha256 "${download}")"
	if [[ "${actual}" != "${checksum}" ]]; then
		echo "Sparkle zip checksum mismatch: expected ${checksum}, got ${actual}" >&2
		return 1
	fi
	mkdir -p "${ARTIFACTS_DIR}"
	local staged="${dest}.download"
	cp "${download}" "${staged}"
	chmod 600 "${staged}"
	mv "${staged}" "${dest}"
	log "Cached Sparkle ${tag} binary artifact for SwiftPM."
	if [[ "${print_path}" -eq 1 ]]; then
		echo "${dest}"
	fi
}

attempt=1
while [[ "${attempt}" -le 6 ]]; do
	rm -f "${download}"
	if curl -fsSL --ipv4 --connect-timeout 20 --max-time 180 \
		-H "Accept: application/octet-stream" \
		-o "${download}" \
		"${url}" && install_download; then
		exit 0
	fi
	log "Sparkle zip download failed (attempt ${attempt}): ${url}"
	if [[ "${attempt}" -lt 6 ]]; then
		sleep $((attempt * 3))
	fi
	attempt=$((attempt + 1))
done

if command -v gh >/dev/null 2>&1; then
	log "Falling back to gh release download for Sparkle ${tag}."
	gh_dir="$(mktemp -d)"
	if gh release download "${tag}" \
		--repo sparkle-project/Sparkle \
		--pattern 'Sparkle-for-Swift-Package-Manager.zip' \
		--dir "${gh_dir}" \
		--clobber; then
		mv "${gh_dir}/Sparkle-for-Swift-Package-Manager.zip" "${download}"
		rm -rf "${gh_dir}"
		if install_download; then
			exit 0
		fi
	else
		rm -rf "${gh_dir}"
	fi
fi

echo "Failed to download Sparkle ${tag} (${url}) after retries." >&2
exit 1
