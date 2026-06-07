#!/usr/bin/env node
/**
 * Verify release payload contains expected Toby artifacts.
 * Usage: node scripts/verify-release-artifacts.mjs [directory]
 */
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve(process.argv[2] ?? "release-payload");
const required = [
	"toby",
	"toby-listener",
	"toby-plugin-sample",
	"toby-plugin-azuread",
	"toby-plugin-gmail",
	"toby-plugin-applemail",
	"toby-plugin-applecalendar",
	"toby-plugin-macos",
	"whisper-cli",
];

const missing = [];
for (const name of required) {
	const filePath = path.join(directory, name);
	if (!fs.existsSync(filePath)) {
		missing.push(name);
		continue;
	}
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
	} catch {
		missing.push(`${name} (not executable)`);
	}
}

if (missing.length > 0) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	for (const item of missing) {
		console.error(`  - ${item}`);
	}
	process.exit(1);
}

const webIndex = path.join(directory, "web", "index.html");
if (!fs.existsSync(webIndex)) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	console.error("  - web/index.html");
	process.exit(1);
}

const macosPluginBundle = path.join(
	directory,
	"TobyPluginMacOS_TobyPluginMacOSLib.bundle",
);
if (!fs.existsSync(macosPluginBundle)) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	console.error("  - TobyPluginMacOS_TobyPluginMacOSLib.bundle");
	process.exit(1);
}

console.log(`Release artifacts OK in ${directory}`);
