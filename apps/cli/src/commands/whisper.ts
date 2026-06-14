import process from "node:process";
import {
	ensureWhisperPluginSetup,
	isTranscriptionAvailable,
} from "@toby/core/listen/transcription-plugin";
import { getWhisperAssetStatus } from "@toby/core/listen/whisper-assets";
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

function deprecationNotice(): void {
	process.stderr.write(
		"Note: `toby whisper` is deprecated. Use `toby plugins setup whisper` and configure under Plugins → whisper.\n",
	);
}

export function registerWhisperCommand(program: Command): void {
	const whisper = program
		.command("whisper")
		.description(
			"Manage local whisper.cpp transcription assets (deprecated — use plugins setup whisper)",
		);

	whisper
		.command("setup")
		.description("Download the default whisper.cpp transcription model")
		.option("--force", "Re-download the model even if it already exists")
		.option("--quiet", "Suppress progress output")
		.action((options: WhisperSetupOptions) => {
			deprecationNotice();
			try {
				ensureWhisperPluginSetup({ forceModel: options.force });
				const result = getWhisperAssetStatus();
				log(
					chalk.green(`Whisper ready.\n  Model: ${result.modelPath}`),
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
		.description("Show whisper model installation status")
		.action(() => {
			deprecationNotice();
			const status = getWhisperAssetStatus();
			const config = resolveWhisperCppConfig();
			console.log(
				`transcription plugin: ${isTranscriptionAvailable() ? "available" : "missing"}`,
			);
			console.log("engine: embedded in toby-plugin-whisper");
			console.log(`model: ${status.modelInstalled ? "ready" : "missing"}`);
			console.log(`  path: ${status.modelPath}`);
			console.log(`language: ${config.language}`);
			if (!status.modelInstalled) {
				console.log("\nRun: toby plugins setup whisper");
			}
		});
}
