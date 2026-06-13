import {
	getTuiServerEventLogPath,
	readServerEventLogTail,
} from "@toby/core/web/server-event-log";
import type { SlashCommand } from "./types";

export const apiLogSlashCommand: SlashCommand = {
	command: "/api-log",
	description: "Show recent server API traffic log.",
	helpText: `Open a scrollable viewer for the last 100 lines from ${getTuiServerEventLogPath()}.`,
	run(runtime) {
		const lines = readServerEventLogTail(100);
		runtime.openTextViewer(
			`Server API log (last ${lines.length} lines)`,
			lines.length > 0 ? lines : ["Log is empty."],
		);
	},
};
