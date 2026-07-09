#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAST_DIR_FILE="$ROOT/.last-temp-dir"

# Read the last temp dir name if it exists
LAST_DIR=""
if [[ -f "$LAST_DIR_FILE" ]]; then
	LAST_DIR="$(cat "$LAST_DIR_FILE")"
fi

echo "=== Toby Sandbox Runner ==="
echo ""
if [[ -n "$LAST_DIR" ]]; then
	echo "Last temp directory: /tmp/$LAST_DIR"
else
	echo "No previous temp directory."
fi
echo ""
echo "Choose an option:"
echo "  1) Run with a temp directory"
echo "  2) Run with default home directory (~/.toby)"
echo ""
read -r -p "Selection [1/2]: " choice

case "$choice" in
	1)
		if [[ -n "$LAST_DIR" ]]; then
			read -r -p "Enter temp directory name [$LAST_DIR]: " dir_name
			dir_name="${dir_name:-$LAST_DIR}"
		else
			read -r -p "Enter temp directory name: " dir_name
		fi

		if [[ -z "$dir_name" ]]; then
			echo "Error: directory name cannot be empty."
			exit 1
		fi

		# Sanitize: strip leading/trailing slashes and spaces
		dir_name="$(echo "$dir_name" | sed 's/^[[:space:]\/]*//;s/[[:space:]\/]*$//')"

		TOBY_DIR="/tmp/$dir_name"
		mkdir -p "$TOBY_DIR"
		echo "$dir_name" > "$LAST_DIR_FILE"
		echo "Using TOBY_DIR=$TOBY_DIR"
		;;
	2)
		# Use default — unset TOBY_DIR if it was set in the environment
		unset TOBY_DIR
		echo "Using default home directory (~/.toby)"
		;;
	*)
		echo "Invalid selection. Exiting."
		exit 1
		;;
esac

echo ""

# Pass through to the underlying command (default: bun run dev)
exec env ${TOBY_DIR:+TOBY_DIR="$TOBY_DIR"} "$@" bun run dev
