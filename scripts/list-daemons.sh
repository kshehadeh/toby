#!/usr/bin/env bash
# List all running Toby daemon and inbound plugin processes.
set -euo pipefail

daemons=$(ps -eo pid,lstart,command | grep "daemon run" | grep -v grep | grep -v "list-daemons" || true)
inbounds=$(ps -eo pid,lstart,command | grep "inbound run" | grep -v grep | grep -v "list-daemons" || true)

if [[ -z "$daemons" && -z "$inbounds" ]]; then
	echo "No Toby daemon or inbound processes running."
	exit 0
fi

# --- Daemons ---
if [[ -n "$daemons" ]]; then
	printf "%-7s  %-20s  %-6s  %-6s  %s\n" "PID" "STARTED" "PORT" "SOURCE" "COMMAND"
	printf "%-7s  %-20s  %-6s  %-6s  %s\n" "---" "-------" "----" "------" "-------"
	while IFS= read -r line; do
		pid=$(echo "$line" | awk '{print $1}')
		started=$(echo "$line" | awk '{print $2, $3, $4, $5}')
		cmd=$(echo "$line" | sed 's/^[^ ]* [^ ]* [^ ]* [^ ]* [^ ]* //')

		if echo "$cmd" | grep -q "Toby.app"; then
			source="app"
		else
			source="dev"
		fi

		# Probe daemon API to find which port this PID serves
		port="-"
		for p in 7847 7848 7849 7850; do
			resp_pid=$(curl -s --max-time 1 "http://127.0.0.1:$p/api/daemon/status" 2>/dev/null \
				| python3 -c "import sys,json; print(json.load(sys.stdin)['process']['pid'])" 2>/dev/null || echo "")
			if [[ "$resp_pid" == "$pid" ]]; then
				port="$p"
				break
			fi
		done

		short=$(echo "$cmd" | sed 's|.*/bun ||; s|/Users/[^/]*/dev/karim/toby/||; s|/Applications/Toby.app/Contents/Resources/||')
		printf "%-7s  %-20s  %-6s  %-6s  %s\n" "$pid" "$started" "$port" "$source" "$short"
	done <<< "$daemons"
fi

echo ""

# --- Inbound plugins ---
if [[ -n "$inbounds" ]]; then
	printf "%-7s  %-20s  %-18s  %s\n" "PID" "STARTED" "PLUGIN" "COMMAND"
	printf "%-7s  %-20s  %-18s  %s\n" "---" "-------" "------" "-------"
	while IFS= read -r line; do
		pid=$(echo "$line" | awk '{print $1}')
		started=$(echo "$line" | awk '{print $2, $3, $4, $5}')
		cmd=$(echo "$line" | sed 's/^[^ ]* [^ ]* [^ ]* [^ ]* [^ ]* //')

		plugin=$(echo "$cmd" | grep -oE "toby-plugin-[a-z]+" | head -1)
		[[ -z "$plugin" ]] && plugin="unknown"
		if echo "$cmd" | grep -q "Toby.app"; then
			plugin="$plugin (app)"
		fi

		short=$(echo "$cmd" | sed 's|.*/bun ||; s|/Users/[^/]*/dev/karim/toby/||; s|/Applications/Toby.app/Contents/Resources/||')
		printf "%-7s  %-20s  %-18s  %s\n" "$pid" "$started" "$plugin" "$short"
	done <<< "$inbounds"
fi
