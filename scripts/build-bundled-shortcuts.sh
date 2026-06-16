#!/usr/bin/env bash
# Generate and sign Toby bundled Shortcuts for the macOS plugin setup flow.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="${repo_root}/apps/plugin-macos/Sources/TobyPluginMacOSLib/BundledShortcuts"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$out_dir"

write_manifest() {
	cat >"${out_dir}/manifest.json" <<'EOF'
{
	"shortcuts": [
		{
			"file": "TobyFocusOn.shortcut",
			"name": "TobyFocusOn",
			"description": "Turns on Do Not Disturb / Focus via Shortcuts."
		},
		{
			"file": "TobyFocusOff.shortcut",
			"name": "TobyFocusOff",
			"description": "Turns off Do Not Disturb / Focus via Shortcuts."
		}
	]
}
EOF
}

# GitHub Actions runners are not signed into iCloud, so `shortcuts sign` fails
# there even though committed signed shortcuts are already in the repo.
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
	if [[ -f "${out_dir}/TobyFocusOn.shortcut" && -f "${out_dir}/TobyFocusOff.shortcut" ]]; then
		echo "CI: using committed bundled shortcuts (signing requires iCloud)."
		write_manifest
		exit 0
	fi
fi

generate_shortcut() {
	local name="$1"
	local enabled="$2"
	local outfile="$3"
	python3 - "$name" "$enabled" "$outfile" <<'PY'
import plistlib
import sys
import uuid

name, enabled_str, outfile = sys.argv[1:4]
enabled = enabled_str.lower() == "true"
action_uuid = str(uuid.uuid4()).upper()
workflow = {
    "WFWorkflowActions": [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.dnd.set",
            "WFWorkflowActionParameters": {
                "UUID": action_uuid,
                "Enabled": enabled,
            },
        }
    ],
    "WFWorkflowClientRelease": "2.0",
    "WFWorkflowClientVersion": "900",
    "WFWorkflowIcon": {
        "WFWorkflowIconGlyphNumber": 59507,
        "WFWorkflowIconStartColor": 431817727,
    },
    "WFWorkflowImportQuestions": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowName": name,
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowTypes": ["NCWidget", "WatchKit", "ActionExtension"],
}
with open(outfile, "wb") as f:
    plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
PY
}

sign_shortcut() {
	local input="$1"
	local output="$2"
	local fallback="$3"

	# `shortcuts sign` often prints harmless debugDescription noise to stderr on
	# recent macOS; treat a written output file as success.
	if shortcuts sign --mode anyone --input "$input" --output "$output"; then
		return 0
	fi
	if [[ -f "$output" ]]; then
		return 0
	fi

	if [[ -f "$fallback" ]]; then
		echo "Warning: shortcuts sign failed; keeping existing $(basename "$output")" >&2
		cp "$fallback" "$output"
		return 0
	fi

	echo "Warning: shortcuts sign failed; bundling unsigned $(basename "$output")" >&2
	cp "$input" "$output"
}

echo "Generating unsigned shortcuts..."
generate_shortcut "TobyFocusOn" true "${tmp_dir}/TobyFocusOn.shortcut"
generate_shortcut "TobyFocusOff" false "${tmp_dir}/TobyFocusOff.shortcut"

for name in TobyFocusOn TobyFocusOff; do
	if [[ -f "${out_dir}/${name}.shortcut" ]]; then
		cp "${out_dir}/${name}.shortcut" "${tmp_dir}/${name}.committed.shortcut"
	fi
done

echo "Signing shortcuts..."
sign_shortcut \
	"${tmp_dir}/TobyFocusOn.shortcut" \
	"${out_dir}/TobyFocusOn.shortcut" \
	"${tmp_dir}/TobyFocusOn.committed.shortcut"
sign_shortcut \
	"${tmp_dir}/TobyFocusOff.shortcut" \
	"${out_dir}/TobyFocusOff.shortcut" \
	"${tmp_dir}/TobyFocusOff.committed.shortcut"

write_manifest

echo "Bundled shortcuts written to ${out_dir}"
