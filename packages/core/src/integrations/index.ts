import { applecalendarIntegrationModule } from "./applecalendar/index";
import { applemailIntegrationModule } from "./applemail/index";
import { braveSearchIntegrationModule } from "./bravesearch/index";
import { jiraIntegrationModule } from "./jira/index";
import { macosIntegrationModule } from "./macos/index";
import { getPluginModules } from "./plugins/registry";
import { slackIntegrationModule } from "./slack/index";
import { todoistIntegrationModule } from "./todoist/index";
import type {
	Integration,
	IntegrationCapability,
	IntegrationModule,
	ProviderCategory,
} from "./types";

const BUILTIN_MODULES: IntegrationModule[] = [
	todoistIntegrationModule,
	slackIntegrationModule,
	applemailIntegrationModule,
	applecalendarIntegrationModule,
	macosIntegrationModule,
	braveSearchIntegrationModule,
	jiraIntegrationModule,
];

function allModules(): IntegrationModule[] {
	const pluginModules = getPluginModules();
	const byName = new Map<string, IntegrationModule>();
	for (const mod of BUILTIN_MODULES) {
		byName.set(mod.name, mod);
	}
	for (const mod of pluginModules) {
		if (!byName.has(mod.name)) {
			byName.set(mod.name, mod);
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getIntegrationModules(): IntegrationModule[] {
	return allModules();
}

export function getIntegrationModule(
	name: string,
): IntegrationModule | undefined {
	return allModules().find((m) => m.name === name);
}

export function getModulesWithCapability(
	capability: IntegrationCapability,
): IntegrationModule[] {
	return allModules().filter((m) => m.capabilities.includes(capability));
}

export function getModulesForCategory(
	category: ProviderCategory,
): IntegrationModule[] {
	return allModules().filter((m) => m.providerCategories?.includes(category));
}

export function getIntegrations(): Integration[] {
	return allModules();
}

export function getIntegration(name: string): Integration | undefined {
	return getIntegrationModule(name);
}

export function isBuiltinIntegration(name: string): boolean {
	return BUILTIN_MODULES.some((module) => module.name === name);
}

export { getPluginModules } from "./plugins/registry";
