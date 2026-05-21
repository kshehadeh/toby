import type { Command } from "commander";
import type { ListenSourceSelection } from "../listen/types";
import { runListenUI } from "../ui/listen/App";

interface ListenCommandOptions {
	readonly micOnly?: boolean;
	readonly systemOnly?: boolean;
	readonly helper?: string;
	readonly outDir?: string;
}

function resolveSources(options: ListenCommandOptions): ListenSourceSelection {
	if (options.micOnly && options.systemOnly) {
		throw new Error("Use only one of --mic-only or --system-only.");
	}
	if (options.micOnly) {
		return { mic: true, system: false };
	}
	if (options.systemOnly) {
		return { mic: false, system: true };
	}
	return { mic: true, system: true };
}

export function registerListenCommand(program: Command): void {
	program
		.command("listen")
		.description(
			"Record microphone and/or system audio in a foreground listener UI",
		)
		.option("--mic-only", "Record only microphone input")
		.option("--system-only", "Record only computer/system output audio")
		.option(
			"--helper <path>",
			"Path to the macOS audio helper (or set TOBY_AUDIO_HELPER)",
		)
		.option(
			"--out-dir <path>",
			"Directory for recordings (defaults to ~/.toby/listen/recordings)",
		)
		.action((options: ListenCommandOptions) => {
			runListenUI({
				sources: resolveSources(options),
				helperPath: options.helper,
				recordingsDir: options.outDir,
			});
		});
}
