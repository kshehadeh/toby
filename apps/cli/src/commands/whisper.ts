import process from "node:process";
import {
	ensureWhisperTranscriptionAssets,
	getWhisperAssetStatus,
} from "@toby/core/listen/whisper-assets";
import { resolveWhisperCppConfig } from "@toby/core/listen/whisper-config";
import chalk from "chalk";
import type { Command } from "commander";

interface WhisperSetupOptions {
	readonly force?: boolean;
	readonly quiet?: boolean;
}

function log(message: string, quiet?: boolean): void {
	if (quiet) return;
	console.log(message);
}

export function registerWhisperCommand(program: Command): void {
	const whisper = program
		.command("whisper")
		.description("Manage local whisper.cpp transcription assets");

	whisper
		.command("setup")
		.description(
			"Install whisper-cli and download the default transcription model",
		)
		.option("--force", "Re-download the model even if it already exists")
		.option("--quiet", "Suppress progress output")
		.action(async (options: WhisperSetupOptions) => {
			try {
				const result = await ensureWhisperTranscriptionAssets({
					forceModel: options.force,
					onProgress: (message) => log(message, options.quiet),
				});
				log(
					chalk.green(
						`Whisper ready.\n  CLI: ${result.whisperCliPath}\n  Model: ${result.modelPath}`,
					),
					options.quiet,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.quiet) {
					console.error(message);
				} else {
					console.error(chalk.red(message));
				}
				process.exitCode = 1;
			}
		});

	whisper
		.command("status")
		.description("Show whisper-cli and model installation status")
		.action(() => {
			const status = getWhisperAssetStatus();
			const config = resolveWhisperCppConfig();
			console.log(
				`whisper-cli: ${status.whisperCliInstalled ? "ready" : "missing"}`,
			);
			console.log(`  path: ${status.whisperCliPath}`);
			console.log(`model: ${status.modelInstalled ? "ready" : "missing"}`);
			console.log(`  path: ${status.modelPath}`);
			console.log(`language: ${config.language}`);
			if (!status.whisperCliInstalled || !status.modelInstalled) {
				console.log("\nRun: toby whisper setup");
			}
		});
}
