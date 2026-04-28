import { spawnSync } from "node:child_process";

const increment = process.argv[2];
const allowed = new Set(["patch", "minor", "major"]);

if (!increment || !allowed.has(increment)) {
	console.error("Usage: bun run release:ci -- <patch|minor|major>");
	process.exit(2);
}

const result = spawnSync("bunx", ["release-it", increment, "--ci"], {
	stdio: "inherit",
});

process.exit(result.status ?? 1);
