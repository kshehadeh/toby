import { gmailIntegrationModule } from "./gmail/index";
import { todoistIntegrationModule } from "./todoist/index";
import type {
	Integration,
	IntegrationCapability,
	IntegrationModule,
} from "./types";

const MODULES: IntegrationModule[] = [
	gmailIntegrationModule,
	todoistIntegrationModule,
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

export function getIntegrations(): Integration[] {
	return MODULES;
}

export function getIntegration(name: string): Integration | undefined {
	return getIntegrationModule(name);
}
