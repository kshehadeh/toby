import { formatLogEntry, readLogTail } from "../../../logging/chat-log";
import type { SlashCommand } from "./types";

export const logSlashCommand: SlashCommand = {
	command: "/log",
	description: "Show recent log entries.",
	helpText:
		"Display the last 50 entries from the circular debug log (~/.toby/toby.log).",
	run(runtime) {
		const entries = readLogTail(50);
		if (entries.length === 0) {
			runtime.addMetaLine("Log is empty.");
			return;
		}
		runtime.addMetaLine("--- Last 50 log entries ---");
		for (const entry of entries) {
			runtime.addMetaLine(formatLogEntry(entry));
		}
		runtime.addMetaLine(`--- ${entries.length} entries shown ---`);
	},
};
