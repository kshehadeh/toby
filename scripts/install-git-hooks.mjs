import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const gitDir = path.join(repoRoot, ".git");
const hooksDir = path.join(gitDir, "hooks");

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function writeHook(name, body) {
	const hookPath = path.join(hooksDir, name);
	fs.writeFileSync(hookPath, body, { encoding: "utf8" });
	fs.chmodSync(hookPath, 0o755);
}

try {
	if (!fs.existsSync(gitDir)) {
		process.exit(0);
	}

	ensureDir(hooksDir);

	writeHook(
		"pre-commit",
		`#!/bin/sh
set -e

bunx lint-staged
`,
	);
} catch {
	// Never fail installs due to hook setup.
	process.exit(0);
}
