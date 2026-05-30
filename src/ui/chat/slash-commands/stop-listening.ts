import fs from "node:fs";
import type { SlashCommand } from "./types";

export const stopListeningSlashCommand: SlashCommand = {
	command: "/stop-listening",
	description: "Stop recording and save the audio transcript.",
	helpText: `Stop the active recording and save it.

  /stop-listening

Stops the recording started by /listen, saves the audio, and
transcribes it. The transcript appears in the chat and can be
summarized by asking the AI.`,
	async run(runtime) {
		if (!runtime.isListenRecording()) {
			runtime.addMetaLine("No active recording. Use /listen to start.");
			return;
		}
		runtime.addMetaLine("Stopping and saving recording…");
		const result = await runtime.stopListenRecording("save");
		if (!result) {
			runtime.addMetaLine("Could not finalize recording.");
			return;
		}
		runtime.addMetaLine(`Recording saved to ${result.outputDir}`);
		if (result.transcript) {
			runtime.addMetaLine(`Transcript:\n${result.transcript}`);
		} else {
			runtime.addMetaLine(
				`Transcription not available — audio saved to ${result.outputDir}`,
			);
		}
	},
};

export function readTranscriptFile(outputDir: string): string | undefined {
	for (const name of ["transcript.txt"]) {
		const filePath = `${outputDir}/${name}`;
		if (fs.existsSync(filePath)) {
			const content = fs.readFileSync(filePath, "utf8").trim();
			if (content) return content;
		}
	}
	return undefined;
}
