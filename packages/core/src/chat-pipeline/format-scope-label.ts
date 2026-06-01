import { getDefaultProvider } from "../config/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
} from "../integrations/types";
import type { IntegrationModule } from "../integrations/types";

export function formatScopeLabel(
	modules: readonly IntegrationModule[],
): string {
	if (modules.length === 0) {
		return "(none)";
	}
	const base = modules.map((m) => m.displayName).join(" + ");
	const defaultParts: string[] = [];
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const name = getDefaultProvider(cat);
		if (name && modules.some((m) => m.name === name)) {
			defaultParts.push(`${PROVIDER_CATEGORY_LABELS[cat]}=${name}`);
		}
	}
	if (defaultParts.length === 0) {
		return base;
	}
	return `${base} [defaults: ${defaultParts.join(", ")}]`;
}
