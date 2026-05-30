import type { SlashCommand } from "./types";

export const listenSlashCommand: SlashCommand = {
	command: "/listen",
	description: "Start recording audio in this chat session.",
	helpText: `Start recording microphone and system audio.

  /listen

Records both mic and system audio by default. Use /stop-listening to
stop and save. The transcript will appear in the chat and can be
summarized by the AI.`,
	run(runtime) {
		if (runtime.isListenRecording()) {
			runtime.addMetaLine("Already recording. Use /stop-listening to stop.");
			return;
		}
		runtime.startListenRecording();
	},
};
