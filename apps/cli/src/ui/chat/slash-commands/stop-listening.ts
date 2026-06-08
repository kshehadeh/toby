import { readListenTranscript } from "@toby/core/listen/recordings";
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
			runtime.addNoticeLine(
				"No active recording. Use /listen to start.",
				"info",
			);
			return;
		}
		runtime.addNoticeLine("Stopping and saving recording…", "info");
		const result = await runtime.stopListenRecording("save");
		if (!result) {
			runtime.addNoticeLine("Could not finalize recording.", "error");
			return;
		}
		runtime.addNoticeLine(`Recording saved to ${result.outputDir}`, "success");
		if (result.transcript) {
			runtime.addNoticeLine(
				`Transcript saved (${result.transcript.length} chars).`,
				"success",
			);
			runtime.addUserContextMessage(
				`[Recording transcript from /listen]\n${result.transcript}`,
			);
		} else {
			const reason = result.transcriptionError
				? ` Transcription failed: ${result.transcriptionError}`
				: "";
			runtime.addNoticeLine(
				`Transcription not available — audio saved to ${result.outputDir}.${reason}`,
				result.transcriptionError ? "error" : "info",
			);
		}
	},
};

export function readTranscriptFile(outputDir: string): string | undefined {
	const result = readListenTranscript(outputDir);
	return result.ok ? result.text : undefined;
}
