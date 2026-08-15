#!/usr/bin/env node
/**
 * Verify release payload contains expected Toby artifacts.
 * Usage: node scripts/verify-release-artifacts.mjs [directory]
 */
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve(process.argv[2] ?? "release-payload");
const required = ["toby", "bun"];

const requiredDirs = [
	"toby-plugin-sample-ts",
	"toby-plugin-slack",
	"toby-plugin-jira",
	"toby-plugin-notion",
	"toby-plugin-todoist",
	"toby-plugin-email",
	"toby-plugin-macos",
	"toby-plugin-applecontacts",
	"toby-plugin-applecalendar",
	"toby-plugin-applereminders",
	"toby-plugin-news",
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

for (const name of requiredDirs) {
	const dirPath = path.join(directory, name);
	if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
		missing.push(`${name} (directory)`);
		continue;
	}
	const manifestPath = path.join(dirPath, "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		missing.push(`${name}/manifest.json`);
	}
}

if (missing.length > 0) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	for (const item of missing) {
		console.error(`  - ${item}`);
	}
	process.exit(1);
}

const iconAssets = [
	"icons/ai/openai.png",
	"icons/ai/vercel.png",
	"icons/ai/ollama.png",
	"personas/toby.png",
	"personas/mailman.png",
];
for (const iconAsset of iconAssets) {
	if (!fs.existsSync(path.join(directory, iconAsset))) {
		console.error(`Missing or invalid release artifacts in ${directory}:`);
		console.error(`  - ${iconAsset}`);
		process.exit(1);
	}
}

const tobyApp = path.join(directory, "Toby.app");
const tobyAppExecutable = path.join(tobyApp, "Contents", "MacOS", "toby-app");
if (!fs.existsSync(tobyAppExecutable)) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	console.error("  - Toby.app/Contents/MacOS/toby-app");
	process.exit(1);
}

// Verify self-contained app bundle has resources in Contents/Resources/
const appResources = path.join(tobyApp, "Contents", "Resources");
const appResourceChecks = [
	"toby",
	"bun",
	"icons/ai/openai.png",
	"personas/toby.png",
];
for (const resource of appResourceChecks) {
	const resourcePath = path.join(appResources, resource);
	if (!fs.existsSync(resourcePath)) {
		console.error(`Missing self-contained app resource in ${directory}:`);
		console.error(`  - Toby.app/Contents/Resources/${resource}`);
		process.exit(1);
	}
}

console.log(`Release artifacts OK in ${directory}`);
