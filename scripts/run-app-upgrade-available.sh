#!/usr/bin/env bash
# Launch Toby (Dev) with the DEBUG update override so the toolbar download
# button and TipKit popover can be exercised without Sparkle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Toby (Dev).app"
BUNDLE_ID="dev.karim.toby.app.dev"
LATEST="${TOBY_DEBUG_LATEST_VERSION:-99.0.0}"
CURRENT="${TOBY_DEBUG_CURRENT_VERSION:-0.1.0}"

cd "$ROOT"
bun run build:app

pkill -f 'Toby \(Dev\)' 2>/dev/null || true
sleep 1

defaults delete "$BUNDLE_ID" toby.updateTip.dismissedVersion 2>/dev/null || true
defaults delete "$BUNDLE_ID" toby.updateTip.dismissedAt 2>/dev/null || true

open -n \
	--env "TOBY_DEBUG_LATEST_VERSION=${LATEST}" \
	--env "TOBY_DEBUG_CURRENT_VERSION=${CURRENT}" \
	"$APP"
