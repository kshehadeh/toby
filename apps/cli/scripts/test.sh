#!/usr/bin/env bash
set -euo pipefail

test_home="$(mktemp -d "${TMPDIR:-/tmp}/toby-cli-test.XXXXXX")"
cleanup() {
	rm -rf "$test_home"
}
trap cleanup EXIT

TOBY_DIR="$test_home" \
TOBY_CREDENTIALS_KEY_BACKEND=memory \
bun test --isolate --max-concurrency=1 "$@"
