export {
	CONFIGURE_TREE_ACTION_KEYS,
	type ConfigureTreeContext,
	type SettingsItem,
} from "@toby/core/configure/tree";

import type { AIProviderInfo } from "@toby/core/ai/providers";
import {
	type ConfigureTreeContext,
	type SettingsItem,
	buildSettingsTree as buildCoreSettingsTree,
} from "@toby/core/configure/tree";
import type { ProviderCategory } from "@toby/core/integrations/types";
import { listListenRecordings } from "../../listen/session-controller";
import { formatListenSources } from "../../listen/types";
import { isDaemonRunning } from "../../schedules/daemon-status";

export function buildSettingsTree(
	personas: {
		name: string;
		ai: { provider: string; model: string };
		instructions: string;
		promptMode: "add" | "replace";
	}[],
	availableProviders: AIProviderInfo[],
	values: Record<string, string> = {},
	defaultProviders?: Partial<Record<ProviderCategory, string>>,
	listenRecordingsDir?: string,
): SettingsItem {
	const context: Partial<ConfigureTreeContext> = {
		listenRecordingsDir,
		listenRecordings: listListenRecordings(listenRecordingsDir),
		daemonRunning: isDaemonRunning().running,
		formatListenSources: (sources) =>
			formatListenSources({
				mic: sources.mic ?? false,
				system: sources.system ?? false,
			}),
	};
	return buildCoreSettingsTree(
		personas,
		availableProviders,
		values,
		defaultProviders,
		context,
	);
}
