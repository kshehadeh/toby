#!/usr/bin/env bash
# Build and launch Toby (Dev) against the generic screenshot home (~/.toby-generic).
# Seeds that home on first run (or when --reseed is passed). Never touches ~/.toby.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${TOBY_GENERIC_DIR:-$HOME/.toby-generic}"
APP="$ROOT/dist/Toby (Dev).app"
RESEED=0

usage() {
	cat <<'EOF'
Usage: scripts/run-app-screenshots.sh [--reseed] [--help]

Build Toby (Dev) and open it with TOBY_DIR pointed at the generic screenshot
home (default: ~/.toby-generic). Seeds that directory if missing or incomplete.

Options:
  --reseed   Wipe and rebuild the generic home before launch
  --help     Show this help

Environment:
  TOBY_GENERIC_DIR   Override destination (default: ~/.toby-generic)
EOF
}

for arg in "$@"; do
	case "$arg" in
		--reseed) RESEED=1 ;;
		--help|-h)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $arg" >&2
			usage >&2
			exit 1
			;;
	esac
done

needs_seed() {
	[[ ! -d "$DEST" ]] && return 0
	[[ ! -f "$DEST/config.json" ]] && return 0
	[[ ! -f "$DEST/chat.sqlite" ]] && return 0
	return 1
}

if [[ "$RESEED" -eq 1 ]] || needs_seed; then
	if [[ "$RESEED" -eq 1 ]]; then
		echo "Re-seeding generic Toby home at $DEST …"
	else
		echo "Generic screenshot home missing or incomplete; seeding $DEST …"
	fi
	bun "$ROOT/scripts/seed-toby-generic-home.ts" "$DEST"
else
	echo "Using existing generic home: $DEST"
	echo "(pass --reseed to wipe and rebuild)"
fi

echo "Building Dev app…"
bun run build:app

if [[ ! -d "$APP" ]]; then
	echo "Error: expected app bundle at $APP" >&2
	exit 1
fi

# Prefer a single Dev instance bound to the generic home (not leftover ~/.toby).
if pgrep -f 'Toby \(Dev\)' >/dev/null 2>&1; then
	echo "Quitting existing Toby (Dev) so it restarts with TOBY_DIR=$DEST …"
	pkill -f 'Toby \(Dev\)' 2>/dev/null || true
	sleep 1
fi

echo "Launching with TOBY_DIR=$DEST"
open -n -g \
	--env "TOBY_DIR=${DEST}" \
	--env "TOBY_CREDENTIALS_KEY_BACKEND=plaintext" \
	"$APP"

echo "Done. Demo UI should show sample data (not your personal ~/.toby home)."
