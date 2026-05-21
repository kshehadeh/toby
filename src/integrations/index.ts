import { applecalendarIntegrationModule } from "./applecalendar/index";
import { applemailIntegrationModule } from "./applemail/index";
import { azureAdIntegrationModule } from "./azuread/index";
import { gmailIntegrationModule } from "./gmail/index";
import { macosIntegrationModule } from "./macos/index";
import { slackIntegrationModule } from "./slack/index";
import { todoistIntegrationModule } from "./todoist/index";
import type {
	Integration,
	IntegrationCapability,
	IntegrationModule,
	ProviderCategory,
} from "./types";

const MODULES: IntegrationModule[] = [
	gmailIntegrationModule,
	todoistIntegrationModule,
	slackIntegrationModule,
	azureAdIntegrationModule,
	applemailIntegrationModule,
	applecalendarIntegrationModule,
	macosIntegrationModule,
];

export function getIntegrationModules(): IntegrationModule[] {
	return MODULES;
}

export function getIntegrationModule(
	name: string,
): IntegrationModule | undefined {
	return MODULES.find((m) => m.name === name);
}

export function getModulesWithCapability(
	capability: IntegrationCapability,
): IntegrationModule[] {
	return MODULES.filter((m) => m.capabilities.includes(capability));
}

export function getModulesForCategory(
	category: ProviderCategory,
): IntegrationModule[] {
	return MODULES.filter((m) => m.providerCategories?.includes(category));
}

export function getIntegrations(): Integration[] {
	return MODULES;
}

export function getIntegration(name: string): Integration | undefined {
	return getIntegrationModule(name);
}
