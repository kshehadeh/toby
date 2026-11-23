#!/usr/bin/env node
/**
 * Verify the release payload: a self-contained native Toby.app (no CLI,
 * Bun runtime, or plugins).
 * Usage: node scripts/verify-release-artifacts.mjs [directory]
 */
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve(process.argv[2] ?? "release-payload");
const app = path.join(directory, "Toby.app", "Contents");
const missing = [];

function expectFile(relative, { executable = false } = {}) {
	const full = path.join(app, relative);
	if (!fs.existsSync(full)) {
		missing.push(`Toby.app/Contents/${relative}`);
		return;
	}
	if (executable) {
		try {
			fs.accessSync(full, fs.constants.X_OK);
		} catch {
			missing.push(`Toby.app/Contents/${relative} (not executable)`);
		}
	}
}

expectFile("MacOS/toby-app", { executable: true });
expectFile("Info.plist");
expectFile("Frameworks/Sparkle.framework");
expectFile("Resources/AppIcon.icns");

const resources = path.join(app, "Resources");
const bundles = fs.existsSync(resources)
	? fs.readdirSync(resources).filter((name) => name.endsWith(".bundle"))
	: [];
const coreBundle = bundles.find((name) => name.endsWith("_TobyCore.bundle"));
if (!coreBundle) {
	missing.push("Toby.app/Contents/Resources/*_TobyCore.bundle");
} else {
	for (const asset of [
		"personas/toby.png",
		"personas/mailman.png",
		"mail-tools.json",
	]) {
		const candidates = [
			path.join(resources, coreBundle, asset),
			path.join(resources, coreBundle, "Resources", asset),
			path.join(
				resources,
				coreBundle,
				"Contents",
				"Resources",
				"Resources",
				asset,
			),
			path.join(resources, coreBundle, "Contents", "Resources", asset),
		];
		if (!candidates.some((candidate) => fs.existsSync(candidate))) {
			missing.push(`${coreBundle}: ${asset}`);
		}
	}
}

// Leftovers from the TypeScript era must not ship.
for (const legacy of ["toby", "bun", "web", "toby-listener"]) {
	if (fs.existsSync(path.join(resources, legacy))) {
		missing.push(
			`unexpected legacy resource: Toby.app/Contents/Resources/${legacy}`,
		);
	}
}

if (missing.length > 0) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	for (const item of missing) console.error(`  - ${item}`);
	process.exit(1);
}
console.log(`Release artifacts OK in ${directory}`);
