import { clearToolResultCache } from "../../../chat-pipeline/tool-result-cache";
import type { SlashCommand } from "./types";

export const clearToolCacheSlashCommand: SlashCommand = {
	command: "/clear-tool-cache",
	description: "Clear cached read-only tool results.",
	helpText: "Remove all in-memory chat tool cache entries.",
	run(runtime) {
		const cleared = clearToolResultCache();
		runtime.addMetaLine(
			`Cleared tool cache (${cleared} entr${cleared === 1 ? "y" : "ies"}).`,
		);
	},
};
