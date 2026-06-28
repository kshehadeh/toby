#!/usr/bin/env node
/**
 * Verify release payload contains expected Toby artifacts.
 * Usage: node scripts/verify-release-artifacts.mjs [directory]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve(process.argv[2] ?? "release-payload");
const required = [
	"toby",
	"bun",
	"toby-plugin-websearch",
	"toby-plugin-applecalendar",
	"toby-plugin-macos",
	"toby-plugin-whisper",
];

const requiredDirs = [
	"toby-plugin-sample-ts",
	"toby-plugin-azuread",
	"toby-plugin-slack",
	"toby-plugin-jira",
	"toby-plugin-todoist",
	"toby-plugin-email",
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

const webIndex = path.join(directory, "web", "index.html");
if (!fs.existsSync(webIndex)) {
	console.error(`Missing or invalid release artifacts in ${directory}:`);
	console.error("  - web/index.html");
	process.exit(1);
}

const iconAssets = [
	"icons/ai/openai.png",
	"icons/ai/vercel.png",
	"icons/ai/ollama.png",
];
for (const iconAsset of iconAssets) {
	if (!fs.existsSync(path.join(directory, iconAsset))) {
		console.error(`Missing or invalid release artifacts in ${directory}:`);
		console.error(`  - ${iconAsset}`);
		process.exit(1);
	}
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
	"web/index.html",
	"icons/ai/openai.png",
	"toby-plugin-websearch",
	"toby-plugin-whisper",
];
for (const resource of appResourceChecks) {
	const resourcePath = path.join(appResources, resource);
	if (!fs.existsSync(resourcePath)) {
		console.error(`Missing self-contained app resource in ${directory}:`);
		console.error(`  - Toby.app/Contents/Resources/${resource}`);
		process.exit(1);
	}
}

if (process.platform === "darwin") {
	const whisperPluginPath = path.join(directory, "toby-plugin-whisper");
	const otool = spawnSync("otool", ["-L", whisperPluginPath], {
		encoding: "utf8",
	});
	if (otool.status !== 0) {
		console.error(
			`Failed to inspect toby-plugin-whisper linkage: ${otool.stderr}`,
		);
		process.exit(1);
	}
	if (otool.stdout.includes("@rpath/libwhisper")) {
		console.error(
			"toby-plugin-whisper links shared @rpath/libwhisper libraries; expected embedded static whisper.cpp.",
		);
		process.exit(1);
	}
}

console.log(`Release artifacts OK in ${directory}`);
