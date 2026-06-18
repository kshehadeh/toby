import type { SlashCommand } from "./types";

export const issueSlashCommand: SlashCommand = {
	command: "/issue",
	description: "Report a bug or feature request.",
	helpText:
		"Open a form to submit a bug report or feature request to the Toby GitHub repo.",
	run(runtime) {
		runtime.openIssueReport();
	},
};
