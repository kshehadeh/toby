import type { SlashCommand } from "./types";

export const restartServerSlashCommand: SlashCommand = {
	command: "/restart-server",
	description: "Restart the Toby server.",
	helpText:
		"Stops and starts the background server process, then reconnects this chat session to it. Schedules, inbound chat, and the HTTP API all run in the server.",
	run: (runtime) => runtime.restartServer(),
};
