#!/usr/bin/env bash
# Generate and sign Toby bundled Shortcuts for the macOS plugin setup flow.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="${repo_root}/apps/plugin-macos/Sources/TobyPluginMacOSLib/BundledShortcuts"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$out_dir"

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

echo "Generating unsigned shortcuts..."
generate_shortcut "Toby Focus On" true "${tmp_dir}/TobyFocusOn.shortcut"
generate_shortcut "Toby Focus Off" false "${tmp_dir}/TobyFocusOff.shortcut"

echo "Signing shortcuts..."
shortcuts sign --mode anyone --input "${tmp_dir}/TobyFocusOn.shortcut" --output "${out_dir}/TobyFocusOn.shortcut"
shortcuts sign --mode anyone --input "${tmp_dir}/TobyFocusOff.shortcut" --output "${out_dir}/TobyFocusOff.shortcut"

cat >"${out_dir}/manifest.json" <<'EOF'
{
  "shortcuts": [
    {
      "file": "TobyFocusOn.shortcut",
      "name": "Toby Focus On",
      "description": "Turns on Do Not Disturb / Focus via Shortcuts."
    },
    {
      "file": "TobyFocusOff.shortcut",
      "name": "Toby Focus Off",
      "description": "Turns off Do Not Disturb / Focus via Shortcuts."
    }
  ]
}
EOF

echo "Bundled shortcuts written to ${out_dir}"
